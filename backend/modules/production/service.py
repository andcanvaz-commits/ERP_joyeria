from datetime import datetime
from decimal import Decimal
from uuid import UUID

from backend.modules.auth.dependencies import CurrentUser
from backend.modules.inventory.schemas import InventoryMovementCreate
from backend.modules.inventory.service import (
    InventoryDomainError,
    InventoryNotFoundError,
    InventoryService,
)
from backend.modules.production.models import (
    AssemblyMode,
    AssemblyRecipe,
    AssemblyRecipeItem,
    ComplementRequestStatus,
    ProductionComplementRequest,
    ProductionProcess,
    ProductionProcessMaterial,
    ProductionProcessProductType,
    ProductionProcessStage,
    ProductionProcessStageIngredient,
    ProductionRun,
    ProductionRunAssemblyItem,
    ProductionRunProduct,
    ProductionRunStage,
    ProductionRunStageDecision,
    ProductionRunStageStatus,
    ProductionRunStatus,
)

DECISION_STAGE_TYPES = {"DECISION", "CONTROL"}
from backend.modules.production.repository import ProductionProcessRepository
from backend.modules.production.schemas import (
    ProductionProcessCreate,
    ProductionProcessRead,
    ProductionProcessUpdate,
    ProductionRunCreate,
    ProductionRunRead,
    ProductionRunStageFinish,
    RunAssemblyDefine,
    RunProductsUpdate,
    SupplyConsumptionRead,
)


def _resolve_run_user_names(session, user_ids: list) -> dict:
    if not user_ids:
        return {}
    from sqlalchemy import select
    from backend.modules.auth.models import AuthUser
    unique_ids = list({uid for uid in user_ids if uid})
    if not unique_ids:
        return {}
    users = session.execute(select(AuthUser).where(AuthUser.id.in_(unique_ids))).scalars().all()
    result = {}
    for user in users:
        name = f"{user.first_name or ''} {user.last_name or ''}".strip()
        result[str(user.id)] = name or user.username
    return result


def _populate_run_names(session, reads: list, runs: list) -> None:
    """Resuelve los nombres de las cuentas que actuaron sobre cada orden y etapa
    (creo / inicio / aprobo / recibio / finalizo etapa) y los asigna a los reads."""
    ids: list = []
    for run in runs:
        ids.extend([
            run.created_by_user_id,
            run.started_by_user_id,
            run.materials_approved_by_user_id,
            run.received_by_user_id,
            run.rejected_by_user_id,
        ])
        for stage in run.stages:
            ids.append(stage.finished_by_user_id)
            for decision in stage.decisions:
                ids.append(decision.decided_by_user_id)
    names = _resolve_run_user_names(session, [i for i in ids if i])

    def name_for(value):
        return names.get(str(value)) if value else None

    for read, run in zip(reads, runs):
        read.created_by_name = name_for(run.created_by_user_id)
        read.started_by_name = name_for(run.started_by_user_id)
        read.materials_approved_by_name = name_for(run.materials_approved_by_user_id)
        read.received_by_name = name_for(run.received_by_user_id)
        read.rejected_by_name = name_for(run.rejected_by_user_id)
        stages_by_id = {str(stage.id): stage for stage in run.stages}
        for stage_read in read.stages:
            stage = stages_by_id.get(str(stage_read.id))
            if stage is not None:
                stage_read.finished_by_name = name_for(stage.finished_by_user_id)
                for decision_read, decision in zip(stage_read.decisions, stage.decisions):
                    decision_read.decided_by_name = name_for(decision.decided_by_user_id)


# Procesos de ejemplo tomados de los documentos de la joyeria (cadenas, monedas,
# medallas y casting). Viven solo como DATOS de siembra; el sistema sigue siendo
# generico y el administrador puede editarlos o crear procesos totalmente nuevos.
# Tipos de etapa: PROCESS, THERMAL, CHEMICAL, CONTROL, DECISION.
EXAMPLE_PROCESSES: tuple[dict, ...] = (
    {
        "name": "PLATA CADENA BB",
        "description": "Proceso de ejemplo.",
        "material_per_unit": Decimal("10.0000"),
        "waste_limit_percent": Decimal("1"),
        "stages": (
            {"name": "Fundicion", "stage_type": "THERMAL", "requires_weighing": True,
             "description": "El metal se funde y se prepara la materia prima."},
            {"name": "Control de calidad", "stage_type": "CONTROL", "requires_weighing": True,
             "description": "Se revisa la pieza y se aprueba o rechaza.",
             "quality_check": "Cumple el estandar de calidad?",
             "rework_action": "Si no cumple, regresa a Fundicion."},
            {"name": "Acabado", "stage_type": "PROCESS", "requires_weighing": True,
             "description": "Pulido y acabado final; la pieza queda lista."},
        ),
    },
)


def _generate_production_code(repository: "ProductionProcessRepository", year: int) -> str:
    seq = repository.next_run_seq_this_year(year)
    return f"OP-{year}-{seq:04d}"


def _stage_code_for(stage_name: str, run_seq: int, stage_order: int) -> str:
    prefix = "".join(c for c in stage_name.upper() if c.isalpha())[:3] or "ETB"
    return f"{prefix}-OP{run_seq:04d}-{stage_order:02d}"


class ProductionDomainError(ValueError):
    pass


class ProductionNotFoundError(LookupError):
    pass


class ProductionService:
    def __init__(self, repository: ProductionProcessRepository, inventory_service: InventoryService | None = None) -> None:
        self.repository = repository
        self.inventory_service = inventory_service

    def _next_process_code(self) -> str:
        from sqlalchemy import select

        codes = self.repository.session.execute(select(ProductionProcess.code)).scalars().all()
        nums = [int(code) for code in codes if code and code.isdigit()]
        return str(max(nums) + 1 if nums else 2000)

    def _process_read(self, process: ProductionProcess) -> ProductionProcessRead:
        read = ProductionProcessRead.model_validate(process)
        read.product_type_ids = [link.product_type_id for link in process.product_types]
        return read

    def _validate_product_types(self, product_type_ids: list) -> None:
        if not product_type_ids:
            return
        if len(product_type_ids) != len(set(product_type_ids)):
            raise ProductionDomainError("No repitas el mismo tipo de producto en el proceso.")
        from sqlalchemy import select
        from backend.modules.product_types.models import ProductType

        found = set(
            self.repository.session.execute(
                select(ProductType.id).where(ProductType.id.in_(product_type_ids))
            ).scalars()
        )
        missing = [pid for pid in product_type_ids if pid not in found]
        if missing:
            raise ProductionDomainError("Un tipo de producto seleccionado no existe en el catalogo.")

    def _validate_run_products(
        self,
        process: ProductionProcess,
        quantity: Decimal,
        products: list,
        assembly_mode: str = AssemblyMode.ASSIGN,
    ) -> None:
        """Valida el plan de resultantes: tipos activos del catalogo o piezas
        existentes del inventario, permitidos por el proceso (si restringe, solo
        aplica a tipos), sin repetidos y reglas de cantidad segun el modo."""
        keys = [p.product_type_id or p.target_item_id for p in products]
        if len(keys) != len(set(keys)):
            raise ProductionDomainError("No repitas el mismo producto resultante.")

        from backend.modules.product_types.models import ProductType
        from backend.modules.inventory.models import InventoryItem

        allowed = {link.product_type_id for link in process.product_types}
        for product in products:
            if product.product_type_id is not None:
                product_type = self.repository.session.get(ProductType, product.product_type_id)
                if product_type is None or not product_type.is_active:
                    raise ProductionDomainError("Un producto resultante no existe o esta inactivo.")
                if allowed and product.product_type_id not in allowed:
                    raise ProductionDomainError(
                        f"El proceso no puede producir '{product_type.name}'."
                    )
            else:
                item = self.repository.session.get(InventoryItem, product.target_item_id)
                if item is None or item.item_type != "FINISHED_PRODUCT":
                    raise ProductionDomainError(
                        "El destino seleccionado no existe como pieza en el inventario."
                    )
                if not item.product_code or len(item.product_code) != 7:
                    raise ProductionDomainError(
                        "La pieza destino debe tener un codigo de catalogo de 7 digitos."
                    )

        if assembly_mode == AssemblyMode.ASSEMBLE:
            if len(products) != 1 or products[0].quantity != quantity:
                raise ProductionDomainError(
                    "En modo ensamblar el plan es un solo producto con la cantidad de la orden."
                )
            return

        total = sum((p.quantity for p in products), Decimal("0"))
        if total != quantity:
            raise ProductionDomainError(
                f"El plan de productos suma {total} y la orden fabrica {quantity}: deben coincidir."
            )

    def create_process(self, payload: ProductionProcessCreate) -> ProductionProcessRead:
        self._ensure_unique_stage_order(payload.stages)
        self._validate_materials(payload.materials)
        self._validate_product_types(payload.product_type_ids)

        stages = []
        for stage_data in payload.stages:
            stage = ProductionProcessStage(
                name=stage_data.name,
                description=stage_data.description,
                phase_name=stage_data.phase_name,
                stage_type=stage_data.stage_type,
                quality_check=stage_data.quality_check,
                rework_action=stage_data.rework_action,
                rework_target_order=stage_data.rework_target_order,
                stage_order=stage_data.order,
                requires_weighing=stage_data.requires_weighing,
                is_active=stage_data.is_active,
                ingredients=[
                    ProductionProcessStageIngredient(
                        inventory_item_id=ing.inventory_item_id,
                        quantity=ing.quantity,
                        unit_code=ing.unit_code,
                    )
                    for ing in stage_data.ingredients
                ],
            )
            stages.append(stage)

        process = ProductionProcess(
            name=payload.name,
            code=self._next_process_code(),
            description=payload.description,
            version=payload.version,
            waste_limit_percent=payload.waste_limit_percent,
            is_active=payload.is_active,
            stages=stages,
            materials=[
                ProductionProcessMaterial(
                    inventory_item_id=material.inventory_item_id,
                    quantity_per_unit=material.quantity_per_unit,
                    unit_code=material.unit_code,
                )
                for material in payload.materials
            ],
            product_types=[
                ProductionProcessProductType(product_type_id=type_id)
                for type_id in payload.product_type_ids
            ],
        )
        self.repository.add(process)
        self.repository.flush()
        return self._process_read(process)

    def list_processes(self) -> list[ProductionProcessRead]:
        return [self._process_read(process) for process in self.repository.list()]

    def update_process(self, process_id: UUID, payload: ProductionProcessUpdate) -> ProductionProcessRead:
        self._ensure_unique_stage_order(payload.stages)
        self._validate_materials(payload.materials)
        self._validate_product_types(payload.product_type_ids)
        process = self.repository.get(process_id)
        if process is None:
            raise ProductionNotFoundError("Proceso no encontrado.")

        process.name = payload.name
        process.description = payload.description
        process.version = payload.version
        process.waste_limit_percent = payload.waste_limit_percent
        process.is_active = payload.is_active
        process.materials = [
            ProductionProcessMaterial(
                inventory_item_id=material.inventory_item_id,
                quantity_per_unit=material.quantity_per_unit,
                unit_code=material.unit_code,
            )
            for material in payload.materials
        ]
        new_stages = []
        for stage_data in payload.stages:
            stage = ProductionProcessStage(
                name=stage_data.name,
                description=stage_data.description,
                phase_name=stage_data.phase_name,
                stage_type=stage_data.stage_type,
                quality_check=stage_data.quality_check,
                rework_action=stage_data.rework_action,
                rework_target_order=stage_data.rework_target_order,
                stage_order=stage_data.order,
                requires_weighing=stage_data.requires_weighing,
                is_active=stage_data.is_active,
                ingredients=[
                    ProductionProcessStageIngredient(
                        inventory_item_id=ing.inventory_item_id,
                        quantity=ing.quantity,
                        unit_code=ing.unit_code,
                    )
                    for ing in stage_data.ingredients
                ],
            )
            new_stages.append(stage)

        process.stages = new_stages
        process.product_types = [
            ProductionProcessProductType(product_type_id=type_id)
            for type_id in payload.product_type_ids
        ]
        self.repository.flush()
        return self._process_read(process)

    def delete_process(self, process_id: UUID) -> None:
        process = self.repository.get(process_id)
        if process is None:
            raise ProductionNotFoundError("Proceso no encontrado.")
        self.repository.delete(process)

    def seed_example_processes(self) -> None:
        """Siembra el proceso de ejemplo SOLO en una base nueva (sin procesos).

        Nunca borra ni modifica datos existentes: si ya hay procesos, no hace nada,
        así el arranque jamás elimina lo que el usuario creó."""
        if self.inventory_service is None:
            return
        if self.repository.list():
            return

        def ensure_raw(name: str):
            item = self.inventory_service.ensure_production_item(
                item_type="RAW_MATERIAL", name=name, unit_code="g",
            )
            if item.current_stock <= 0:
                self.inventory_service.create_movement(
                    InventoryMovementCreate(
                        item_id=item.id,
                        movement_type="ENTRADA",
                        quantity=Decimal("5000"),
                        reason="Stock inicial de ejemplo para produccion.",
                    ),
                    user_id=None,
                )
            return item

        gold = ensure_raw("Oro 18K")
        silver = ensure_raw("Plata 925")

        for definition in EXAMPLE_PROCESSES:
            self.create_process(
                ProductionProcessCreate(
                    name=definition["name"],
                    description=definition["description"],
                    materials=[
                        {
                            "inventory_item_id": silver.id,
                            "quantity_per_unit": definition["material_per_unit"],
                            "unit_code": silver.unit_code,
                        },
                        {
                            "inventory_item_id": gold.id,
                            "quantity_per_unit": definition["material_per_unit"],
                            "unit_code": gold.unit_code,
                        },
                    ],
                    waste_limit_percent=definition["waste_limit_percent"],
                    stages=[
                        {"order": index + 1, **stage}
                        for index, stage in enumerate(definition["stages"])
                    ],
                )
            )

    def create_run(self, payload: ProductionRunCreate, current_user: CurrentUser) -> ProductionRunRead:
        if self.inventory_service is None:
            raise ProductionDomainError("Inventario no esta disponible para iniciar produccion.")
        process = self.repository.get(payload.process_id)
        if process is None:
            raise ProductionNotFoundError("Proceso no encontrado.")
        if not process.is_active:
            raise ProductionDomainError("El proceso no esta activo.")
        if not process.materials:
            raise ProductionDomainError("El proceso no tiene materias primas configuradas.")

        # Cualquier materia prima del inventario es utilizable en cualquier
        # proceso. Si esta configurada en el proceso se usa su cantidad por
        # unidad; si no, se usa la cantidad estandar del proceso (la de su
        # primer material configurado).
        selected = next(
            (m for m in process.materials if m.inventory_item_id == payload.raw_material_item_id),
            None,
        )
        if selected is not None:
            quantity_per_unit = selected.quantity_per_unit
            unit_code = selected.unit_code
        else:
            from backend.modules.inventory.models import InventoryItem

            item = self.repository.session.get(InventoryItem, payload.raw_material_item_id)
            if item is None or item.item_type != "RAW_MATERIAL":
                raise ProductionDomainError(
                    "La materia prima seleccionada no existe en el inventario."
                )
            quantity_per_unit = process.materials[0].quantity_per_unit
            unit_code = item.unit_code

        active_stages = [stage for stage in process.stages if stage.is_active]
        if not active_stages:
            raise ProductionDomainError("El proceso debe tener al menos una etapa activa.")

        self._validate_run_products(
            process, payload.quantity, payload.products, payload.assembly_mode
        )

        if payload.assembly_mode == AssemblyMode.ASSEMBLE and not payload.complements:
            raise ProductionDomainError(
                "Una orden de ensamble necesita al menos un complemento solicitado."
            )

        complement_item_ids = [complement.item_id for complement in payload.complements]
        if len(complement_item_ids) != len(set(complement_item_ids)):
            raise ProductionDomainError("No repitas el mismo complemento en la solicitud.")

        # Complementos: items de la pestaña Complementos del inventario.
        from backend.modules.inventory.models import InventoryItem

        complement_items = []
        for complement in payload.complements:
            item = self.repository.session.get(InventoryItem, complement.item_id)
            if item is None or item.item_type != "COMPLEMENT":
                raise ProductionDomainError(
                    "Un complemento solicitado no existe en la pestaña Complementos."
                )
            complement_items.append(item)

        total_required = quantity_per_unit * payload.quantity
        run = ProductionRun(
            process_id=process.id,
            process_name=process.name,
            quantity=payload.quantity,
            status=ProductionRunStatus.PENDING_INVENTORY,
            assembly_mode=payload.assembly_mode,
            raw_material_item_id=payload.raw_material_item_id,
            raw_material_quantity_per_unit=quantity_per_unit,
            raw_material_unit_code=unit_code,
            total_required_material=total_required,
            waste_limit_percent=process.waste_limit_percent,
            expected_finished_weight=total_required,
            created_by_user_id=current_user.id,
            requested_at=datetime.utcnow(),
        )
        run.production_code = _generate_production_code(self.repository, datetime.utcnow().year)
        run_seq = int(run.production_code.split("-")[2]) if run.production_code else 0

        for stage in sorted(active_stages, key=lambda item: item.stage_order):
            run.stages.append(
                ProductionRunStage(
                    source_stage_id=stage.id,
                    stage_name=stage.name,
                    phase_name=stage.phase_name,
                    stage_type=stage.stage_type,
                    quality_check=stage.quality_check,
                    rework_action=stage.rework_action,
                    rework_target_order=stage.rework_target_order,
                    stage_order=stage.stage_order,
                    requires_weighing=stage.requires_weighing,
                    status=ProductionRunStageStatus.PENDING,
                    stage_code=_stage_code_for(stage.name, run_seq, stage.stage_order),
                )
            )

        for product in payload.products:
            run.products.append(
                ProductionRunProduct(
                    product_type_id=product.product_type_id,
                    target_item_id=product.target_item_id,
                    quantity=product.quantity,
                )
            )
        for complement, item in zip(payload.complements, complement_items):
            run.complements.append(
                ProductionComplementRequest(
                    item_id=item.id,
                    quantity=complement.quantity,
                    unit_code=item.unit_code,
                    status=ComplementRequestStatus.PENDING,
                )
            )

        self.repository.add_run(run)
        self.repository.flush()
        self.inventory_service.reserve_materials_for_production(
            production_order_id=run.id,
            requirements=(),
        )
        self.repository.flush()
        return self._read_with_names(run)

    def update_run_products(
        self, run_id: UUID, payload: RunProductsUpdate, current_user: CurrentUser
    ) -> ProductionRunRead:
        run = self.repository.get_run(run_id)
        if run is None:
            raise ProductionNotFoundError("Orden de produccion no encontrada.")
        if run.status in (ProductionRunStatus.RECEIVED, ProductionRunStatus.CANCELLED):
            raise ProductionDomainError(
                "El plan de productos ya no se puede cambiar: la orden fue recibida o cancelada."
            )
        process = self.repository.get(run.process_id)
        if process is None:
            raise ProductionNotFoundError("Proceso de la orden no encontrado.")
        self._validate_run_products(
            process, run.quantity, payload.products, run.assembly_mode
        )
        run.products = [
            ProductionRunProduct(
                product_type_id=product.product_type_id,
                target_item_id=product.target_item_id,
                quantity=product.quantity,
            )
            for product in payload.products
        ]
        self.repository.flush()
        return self._read_with_names(run)

    def approve_materials(self, run_id: UUID, current_user: CurrentUser) -> ProductionRunRead:
        if self.inventory_service is None:
            raise ProductionDomainError("Inventario no esta disponible para aprobar materiales.")
        run = self.repository.get_run(run_id)
        if run is None:
            raise ProductionNotFoundError("Orden de produccion no encontrada.")
        if run.status != ProductionRunStatus.PENDING_INVENTORY:
            raise ProductionDomainError("Solo se pueden aprobar materiales de ordenes pendientes de Inventario.")
        try:
            self.inventory_service.consume_material_for_production(
                item_id=run.raw_material_item_id,
                quantity=run.total_required_material,
                production_run_id=run.id,
                user_id=current_user.id,
                production_code=run.production_code,
            )
        except InventoryDomainError as exc:
            raise ProductionDomainError(str(exc)) from exc
        # Insumos configurados por etapa: se entregan junto con la materia prima
        # (cantidad fija por orden) y quedan como un movimiento por insumo.
        # Si falta stock de algun insumo, la aprobacion completa se revierte.
        process = self.repository.get(run.process_id)
        if process is not None:
            from backend.modules.inventory.models import InventoryItem

            for stage in sorted(process.stages, key=lambda item: item.stage_order):
                if not stage.is_active:
                    continue
                for ingredient in stage.ingredients:
                    supply = self.repository.session.get(InventoryItem, ingredient.inventory_item_id)
                    supply_name = supply.name if supply is not None else "insumo"
                    try:
                        self.inventory_service.consume_material_for_production(
                            item_id=ingredient.inventory_item_id,
                            quantity=ingredient.quantity,
                            production_run_id=run.id,
                            user_id=current_user.id,
                            production_code=run.production_code,
                            reason=f"Consumo de insumo en etapa {stage.stage_order}. {stage.name}.",
                        )
                    except InventoryDomainError as exc:
                        raise ProductionDomainError(f"Insumo '{supply_name}': {exc}") from exc
        # Complementos solicitados en la orden: se aprueban y descuentan junto
        # con la materia prima. Si falta stock, toda la aprobacion se revierte.
        from backend.modules.inventory.models import InventoryItem as _InventoryItem

        now = datetime.utcnow()
        for complement in run.complements:
            if complement.status != ComplementRequestStatus.PENDING:
                continue
            item = self.repository.session.get(_InventoryItem, complement.item_id)
            item_name = item.name if item is not None else "complemento"
            try:
                self.inventory_service.consume_material_for_production(
                    item_id=complement.item_id,
                    quantity=complement.quantity,
                    production_run_id=run.id,
                    user_id=current_user.id,
                    production_code=run.production_code,
                    reason=f"Complemento para ensamble: {item_name}.",
                )
            except InventoryDomainError as exc:
                raise ProductionDomainError(f"Complemento '{item_name}': {exc}") from exc
            complement.status = ComplementRequestStatus.APPROVED
            complement.approved_by_user_id = current_user.id
            complement.approved_at = now
        run.status = ProductionRunStatus.MATERIALS_APPROVED
        run.materials_approved_at = datetime.utcnow()
        run.materials_approved_by_user_id = current_user.id
        self.repository.flush()
        return self._read_with_names(run)

    def reject_materials(self, run_id: UUID, current_user: CurrentUser, reason: str | None) -> ProductionRunRead:
        run = self.repository.get_run(run_id)
        if run is None:
            raise ProductionNotFoundError("Orden de produccion no encontrada.")
        if run.status != ProductionRunStatus.PENDING_INVENTORY:
            raise ProductionDomainError("Solo se puede rechazar una orden pendiente de Inventario.")
        run.status = ProductionRunStatus.CANCELLED
        run.rejected_by_user_id = current_user.id
        run.rejection_reason = (reason or "").strip() or None
        run.rejected_at = datetime.utcnow()
        for complement in run.complements:
            if complement.status == ComplementRequestStatus.PENDING:
                complement.status = ComplementRequestStatus.REJECTED
        self.repository.flush()
        return self._read_with_names(run)

    def start_run(self, run_id: UUID, current_user: CurrentUser) -> ProductionRunRead:
        run = self.repository.get_run(run_id)
        if run is None:
            raise ProductionNotFoundError("Orden de produccion no encontrada.")
        if run.status != ProductionRunStatus.MATERIALS_APPROVED:
            raise ProductionDomainError("Inventario debe aprobar la salida de materia prima antes de iniciar.")

        started_at = datetime.utcnow()
        run.status = ProductionRunStatus.IN_PROGRESS
        run.started_at = started_at
        run.started_by_user_id = current_user.id

        ordered_stages = sorted(run.stages, key=lambda item: item.stage_order)
        for index, stage in enumerate(ordered_stages):
            stage.status = ProductionRunStageStatus.IN_PROGRESS if index == 0 else ProductionRunStageStatus.PENDING
            stage.started_at = started_at if index == 0 else None

        self.repository.flush()
        return self._read_with_names(run)

    def _attach_allowed_types(self, reads: list, runs: list) -> None:
        """Copia a cada orden los tipos de producto que su proceso puede producir
        (para filtrar el combo al convertir el lote). Vacio = todos."""
        from sqlalchemy import select

        process_ids = list({run.process_id for run in runs})
        if not process_ids:
            return
        links = self.repository.session.execute(
            select(
                ProductionProcessProductType.process_id,
                ProductionProcessProductType.product_type_id,
            ).where(ProductionProcessProductType.process_id.in_(process_ids))
        ).all()
        by_process: dict = {}
        for process_id, type_id in links:
            by_process.setdefault(process_id, []).append(type_id)
        for read, run in zip(reads, runs):
            read.allowed_product_type_ids = by_process.get(run.process_id, [])

    def _attach_supply_consumptions(self, reads: list, runs: list) -> None:
        """Insumos consumidos por cada orden (movimientos CONSUMO_PRODUCCION que
        no son la materia prima principal). Alimenta el acta de entrega."""
        from sqlalchemy import select
        from backend.modules.inventory.models import InventoryItem, InventoryMovement

        run_ids = [run.id for run in runs]
        if not run_ids:
            return
        movements = self.repository.session.execute(
            select(InventoryMovement).where(
                InventoryMovement.movement_type == "CONSUMO_PRODUCCION",
                InventoryMovement.reference_id.in_(run_ids),
            )
        ).scalars().all()
        item_ids = list({m.item_id for m in movements})
        names = {}
        if item_ids:
            rows = self.repository.session.execute(
                select(InventoryItem.id, InventoryItem.name).where(InventoryItem.id.in_(item_ids))
            ).all()
            names = {row[0]: row[1] for row in rows}
        by_run: dict = {}
        for movement in movements:
            by_run.setdefault(movement.reference_id, []).append(movement)
        for read, run in zip(reads, runs):
            read.supply_consumptions = [
                SupplyConsumptionRead(
                    name=names.get(m.item_id, "Insumo"),
                    quantity=m.quantity,
                    unit_code=m.unit_code,
                )
                for m in by_run.get(run.id, [])
                if m.item_id != run.raw_material_item_id
            ]

    def _attach_plan_names(self, reads: list, runs: list) -> None:
        """Nombres del plan de resultantes (tipo de producto o pieza destino),
        de los complementos y de la combinacion de ensamble aplicada, para las
        vistas y el acta."""
        from sqlalchemy import select
        from backend.modules.inventory.models import InventoryItem
        from backend.modules.product_types.models import ProductType

        type_ids = {p.product_type_id for run in runs for p in run.products if p.product_type_id}
        target_item_ids = {p.target_item_id for run in runs for p in run.products if p.target_item_id}
        item_ids = {c.item_id for run in runs for c in run.complements}
        assembly_item_ids = {a.complement_item_id for run in runs for a in run.assembly_items}
        item_ids |= assembly_item_ids
        item_ids |= target_item_ids
        type_names: dict = {}
        if type_ids:
            rows = self.repository.session.execute(
                select(ProductType.id, ProductType.name).where(ProductType.id.in_(type_ids))
            ).all()
            type_names = {row[0]: row[1] for row in rows}
        item_names: dict = {}
        target_names: dict = {}
        if item_ids:
            rows = self.repository.session.execute(
                select(
                    InventoryItem.id, InventoryItem.name, InventoryItem.description
                ).where(InventoryItem.id.in_(item_ids))
            ).all()
            for item_id, name, description in rows:
                item_names[item_id] = name
                target_names[item_id] = (description or "").strip() or name
        for read in reads:
            for product in read.products:
                if product.product_type_id is not None:
                    product.product_name = type_names.get(product.product_type_id)
                else:
                    product.product_name = target_names.get(product.target_item_id)
            for complement in read.complements:
                complement.name = item_names.get(complement.item_id)
            for assembly_item in read.assembly_items:
                assembly_item.name = item_names.get(assembly_item.complement_item_id)

    def _read_with_names(self, run: ProductionRun) -> ProductionRunRead:
        read = ProductionRunRead.model_validate(run)
        _populate_run_names(self.repository.session, [read], [run])
        self._attach_allowed_types([read], [run])
        self._attach_supply_consumptions([read], [run])
        self._attach_plan_names([read], [run])
        return read

    def list_runs(self) -> list[ProductionRunRead]:
        runs = self.repository.list_runs()
        reads = [ProductionRunRead.model_validate(run) for run in runs]
        _populate_run_names(self.repository.session, reads, runs)
        self._attach_allowed_types(reads, runs)
        self._attach_supply_consumptions(reads, runs)
        self._attach_plan_names(reads, runs)
        return reads

    def finish_stage(self, stage_id: UUID, payload: ProductionRunStageFinish, current_user: CurrentUser) -> ProductionRunRead:
        if self.inventory_service is None:
            raise ProductionDomainError("Inventario no esta disponible para finalizar produccion.")
        stage = self.repository.get_run_stage(stage_id)
        if stage is None:
            raise ProductionNotFoundError("Etapa de produccion no encontrada.")
        run = stage.run
        if run.status != ProductionRunStatus.IN_PROGRESS:
            raise ProductionDomainError("La produccion ya no esta en proceso.")
        if stage.status not in (ProductionRunStageStatus.PENDING, ProductionRunStageStatus.IN_PROGRESS):
            raise ProductionDomainError("Solo se puede finalizar la etapa en curso.")
        if stage.requires_weighing and payload.final_weight is None:
            raise ProductionDomainError("Esta etapa requiere registrar el nuevo pesaje.")

        now = datetime.utcnow()

        requires_decision = stage.stage_type in DECISION_STAGE_TYPES or bool(stage.quality_check)

        # Condición de peso: el límite de merma se controla sobre la merma ACUMULADA
        # (desde el material inicial hasta esta etapa), no sobre una sola fase.
        # El material no puede crecer: un peso mayor al que entró a la fase es
        # error de captura y contaminaría la merma de las fases siguientes.
        if stage.requires_weighing and payload.final_weight is not None:
            reference = self._previous_stage_weight(run, stage)
            if reference is not None and reference > 0 and payload.final_weight > reference:
                raise ProductionDomainError(
                    f"El peso final ({payload.final_weight} {run.raw_material_unit_code}) no puede ser "
                    f"mayor que el material en proceso ({reference} {run.raw_material_unit_code})."
                )

        weight_based = False
        auto_justification: str | None = None
        if stage.requires_weighing and payload.final_weight is not None:
            cumulative_pct = self._accumulated_loss_percent(run, payload.final_weight)
            if cumulative_pct is not None and cumulative_pct > run.waste_limit_percent:
                weight_based = True
                auto_justification = (
                    f"La merma acumulada de {cumulative_pct:.2f}% supera el límite permitido "
                    f"{run.waste_limit_percent:.2f}% tras esta etapa."
                )

        if requires_decision and payload.decision is None:
            raise ProductionDomainError("Selecciona aprobar o rechazar esta etapa.")

        attempt_no = len(stage.decisions) + 1

        if stage.status == ProductionRunStageStatus.PENDING:
            stage.status = ProductionRunStageStatus.IN_PROGRESS
            stage.started_at = stage.started_at or now
        stage.initial_weight = payload.initial_weight
        stage.final_weight = payload.final_weight

        # ── Rechazo: registrar intento y devolver el flujo ──────────────
        if requires_decision and payload.decision == "REJECTED":
            justification = (payload.justification or "").strip() or auto_justification

            target_order = stage.rework_target_order
            if not target_order or target_order < 1:
                target_order = stage.stage_order - 1 if stage.stage_order > 1 else stage.stage_order

            self._record_decision(
                run, stage, "REJECTED", justification, weight_based,
                payload.final_weight, target_order, current_user, attempt_no,
            )

            target_stage = None
            for candidate in sorted(run.stages, key=lambda item: item.stage_order):
                if candidate.stage_order < target_order:
                    continue
                candidate.status = ProductionRunStageStatus.PENDING
                if candidate.stage_order > target_order:
                    candidate.started_at = None
                    candidate.finished_at = None
                    candidate.initial_weight = None
                    candidate.final_weight = None
                    candidate.waste_weight = None
                    candidate.waste_percent = None
                else:
                    target_stage = candidate
            if target_stage is not None:
                target_stage.status = ProductionRunStageStatus.IN_PROGRESS
                target_stage.started_at = now
                target_stage.finished_at = None

            self.repository.flush()
            return self._read_with_names(run)

        # ── Aprobación / etapa normal: finalizar y avanzar ──────────────
        # Registrar si es etapa de decisión, o si se pasó pese a que el peso no
        # cumple la condición (queda constancia del override del usuario).
        if requires_decision or weight_based:
            note = (payload.justification or "").strip() or auto_justification
            self._record_decision(
                run, stage, "APPROVED", note,
                weight_based, payload.final_weight, None, current_user, attempt_no,
            )

        stage.finished_at = now
        stage.finished_by_user_id = current_user.id
        stage.status = ProductionRunStageStatus.FINISHED

        # Registrar la merma de esta fase: material que entró (peso de la fase pesada
        # anterior, o material total si es la primera) menos el peso con el que sale.
        # Así se puede sumar fase por fase y saber dónde se perdió material.
        if stage.requires_weighing and stage.final_weight is not None:
            reference = self._previous_stage_weight(run, stage)
            if reference and reference > 0:
                loss = max(Decimal("0"), reference - stage.final_weight)
                stage.waste_weight = loss
                stage.waste_percent = loss / reference * Decimal("100")
            else:
                stage.waste_weight = None
                stage.waste_percent = None

        next_stage = next(
            (
                candidate
                for candidate in sorted(run.stages, key=lambda item: item.stage_order)
                if candidate.status == ProductionRunStageStatus.PENDING
            ),
            None,
        )
        if next_stage is not None:
            next_stage.status = ProductionRunStageStatus.IN_PROGRESS
            next_stage.started_at = now
            self.repository.flush()
            return self._read_with_names(run)

        self._finish_run(run, payload.final_weight)
        self.repository.flush()
        return self._read_with_names(run)

    def _previous_stage_weight(self, run: ProductionRun, stage: ProductionRunStage) -> Decimal | None:
        """Peso de referencia para validar una etapa: el peso final de la etapa pesada
        anterior; si no hay, el material total requerido de la orden."""
        prior = [
            candidate
            for candidate in run.stages
            if candidate.stage_order < stage.stage_order and candidate.final_weight is not None
        ]
        if prior:
            prior.sort(key=lambda item: item.stage_order)
            return prior[-1].final_weight
        return run.total_required_material

    def _accumulated_loss_percent(self, run: ProductionRun, final_weight: Decimal) -> Decimal | None:
        """Merma acumulada (%) desde el material inicial hasta el peso indicado.
        La base es la materia prima total que entró a la orden."""
        base = run.total_required_material
        if not base or base <= 0:
            return None
        return (base - final_weight) / base * Decimal("100")

    def _record_decision(
        self,
        run: ProductionRun,
        stage: ProductionRunStage,
        decision: str,
        justification: str | None,
        weight_based: bool,
        final_weight: Decimal | None,
        returned_to_order: int | None,
        current_user: CurrentUser,
        attempt_no: int,
    ) -> None:
        stage.decisions.append(
            ProductionRunStageDecision(
                run_id=run.id,
                decision=decision,
                justification=justification,
                weight_based=weight_based,
                final_weight=final_weight,
                returned_to_order=returned_to_order,
                decided_by_user_id=current_user.id,
                attempt_no=attempt_no,
            )
        )

    def _resolve_plan_product_type_id(self, run: ProductionRun) -> UUID | None:
        """En modo ENSAMBLAR el plan tiene una sola fila: si ya trae el tipo de
        producto se usa directo; si trae una pieza destino, se busca su tipo
        empatando el código de catálogo (categoría + modelo) de la pieza."""
        product = next(iter(run.products), None)
        if product is None:
            return None
        if product.product_type_id is not None:
            return product.product_type_id
        if product.target_item_id is None:
            return None

        from sqlalchemy import select
        from backend.modules.inventory.models import InventoryItem
        from backend.modules.product_types.models import ProductType

        item = self.repository.session.get(InventoryItem, product.target_item_id)
        if item is None or not item.product_code or len(item.product_code) != 7:
            return None
        code = item.product_code
        product_type = self.repository.session.execute(
            select(ProductType).where(
                ProductType.category_code == code[1:3],
                ProductType.model_code == code[3:7],
            )
        ).scalars().first()
        return product_type.id if product_type is not None else None

    def _approved_complement_totals(self, run: ProductionRun) -> dict:
        """Suma por item de los complementos APROBADOS de la orden (lo que
        inventario realmente entregó, disponible para ensamblar)."""
        totals: dict = {}
        for complement in run.complements:
            if complement.status != ComplementRequestStatus.APPROVED:
                continue
            totals[complement.item_id] = totals.get(complement.item_id, Decimal("0")) + complement.quantity
        return totals

    def _finish_run(self, run: ProductionRun, final_weight: Decimal | None) -> None:
        run.status = ProductionRunStatus.PENDING_RECEPTION
        run.finished_at = datetime.utcnow()
        run.actual_finished_weight = final_weight
        # Merma total = suma de la merma registrada en cada fase.
        # El % se calcula sobre la materia prima total que entró a la orden.
        total_waste = sum(
            (stage.waste_weight for stage in run.stages if stage.waste_weight is not None),
            Decimal("0"),
        )
        run.waste_weight = total_waste
        run.waste_percent = (
            total_waste / run.total_required_material * Decimal("100")
            if run.total_required_material
            else Decimal("0")
        )

        # Auto-ensamble: si la orden es ENSAMBLAR y existe una receta aprendida
        # para su tipo de producto, y los complementos aprobados alcanzan para
        # cubrirla completa, se aplica sola y la orden queda lista para recibir.
        # Si no hay receta o no alcanza, queda pendiente de definir manualmente.
        if run.assembly_mode == AssemblyMode.ASSEMBLE:
            from sqlalchemy import select

            type_id = self._resolve_plan_product_type_id(run)
            recipe = None
            if type_id is not None:
                recipe = self.repository.session.execute(
                    select(AssemblyRecipe).where(AssemblyRecipe.product_type_id == type_id)
                ).scalars().first()

            approved = self._approved_complement_totals(run)
            covers_recipe = recipe is not None and all(
                item.quantity_per_unit * run.quantity <= approved.get(item.complement_item_id, Decimal("0"))
                for item in recipe.items
            )
            if covers_recipe:
                for item in recipe.items:
                    run.assembly_items.append(
                        ProductionRunAssemblyItem(
                            complement_item_id=item.complement_item_id,
                            quantity=item.quantity_per_unit * run.quantity,
                        )
                    )
                run.assembly_pending = False
            else:
                run.assembly_pending = True

    def define_run_assembly(
        self, run_id: UUID, payload: RunAssemblyDefine, current_user: CurrentUser
    ) -> ProductionRunRead:
        run = self.repository.get_run(run_id)
        if run is None:
            raise ProductionNotFoundError("Orden de produccion no encontrada.")
        if run.assembly_mode != AssemblyMode.ASSEMBLE:
            raise ProductionDomainError("Esta orden no es de ensamble.")
        if run.status != ProductionRunStatus.PENDING_RECEPTION:
            raise ProductionDomainError(
                "El ensamble se define cuando la producción está pendiente de recepción."
            )
        if not run.assembly_pending:
            raise ProductionDomainError("El ensamble ya está definido.")

        item_ids = [line.complement_item_id for line in payload.items]
        if len(item_ids) != len(set(item_ids)):
            raise ProductionDomainError("No repitas el mismo complemento en el ensamble.")

        from sqlalchemy import select
        from backend.modules.inventory.models import InventoryItem

        approved = self._approved_complement_totals(run)
        for line in payload.items:
            item = self.repository.session.get(InventoryItem, line.complement_item_id)
            item_name = item.name if item is not None else "complemento"
            if line.complement_item_id not in approved:
                raise ProductionDomainError(
                    f"El complemento '{item_name}' no fue solicitado/aprobado en esta orden."
                )
            needed = line.quantity_per_unit * run.quantity
            if needed > approved[line.complement_item_id]:
                raise ProductionDomainError(
                    f"Complemento '{item_name}': el ensamble necesita {needed} y la orden solo "
                    f"tiene {approved[line.complement_item_id]} aprobados."
                )

        run.assembly_items = [
            ProductionRunAssemblyItem(
                complement_item_id=line.complement_item_id,
                quantity=line.quantity_per_unit * run.quantity,
            )
            for line in payload.items
        ]
        run.assembly_pending = False

        # Receta aprendida: si la orden empata con un tipo de producto del
        # catálogo, se guarda (o actualiza) esta combinación para que futuros
        # ensambles del mismo tipo se apliquen solos.
        type_id = self._resolve_plan_product_type_id(run)
        if type_id is not None:
            recipe = self.repository.session.execute(
                select(AssemblyRecipe).where(AssemblyRecipe.product_type_id == type_id)
            ).scalars().first()
            new_items = [
                AssemblyRecipeItem(
                    complement_item_id=line.complement_item_id,
                    quantity_per_unit=line.quantity_per_unit,
                )
                for line in payload.items
            ]
            if recipe is not None:
                recipe.items = new_items
                recipe.updated_at = datetime.utcnow()
            else:
                recipe = AssemblyRecipe(product_type_id=type_id, items=new_items)
                self.repository.session.add(recipe)

        self.repository.flush()
        return self._read_with_names(run)

    def receive_finished_product(self, run_id: UUID, current_user: CurrentUser) -> ProductionRunRead:
        if self.inventory_service is None:
            raise ProductionDomainError("Inventario no esta disponible para recibir producto terminado.")
        run = self.repository.get_run(run_id)
        if run is None:
            raise ProductionNotFoundError("Orden de produccion no encontrada.")
        if run.status != ProductionRunStatus.PENDING_RECEPTION:
            raise ProductionDomainError("Solo se puede recibir una produccion finalizada y pendiente de recepcion.")
        if run.assembly_mode == AssemblyMode.ASSEMBLE and run.assembly_pending:
            raise ProductionDomainError("Producción debe definir el ensamble antes de recibir.")

        # El lote hereda el material (metal) de la orden para que la conversión
        # a producto del catálogo no tenga que preguntarlo.
        from backend.modules.inventory.models import InventoryItem
        from backend.modules.inventory.schemas import LotConversionCreate

        raw_material = self.repository.session.get(InventoryItem, run.raw_material_item_id)
        lot = self.inventory_service.create_finished_product_lot(
            name=run.process_name,
            unit_code="und",
            production_order_id=run.id,
            production_code=run.production_code,
            quantity=run.quantity,
            material_type=(raw_material.material_type or raw_material.name) if raw_material else None,
            # La pureza de la materia prima viaja con el lote (trazabilidad).
            purity=raw_material.purity if raw_material else None,
            received_by_user_id=current_user.id,
        )
        # Con plan de resultantes: el lote se convierte aqui mismo en los
        # productos finales declarados (misma logica de conversion de siempre:
        # herencia de material, codigo de catalogo y par de movimientos).
        # Sin plan (ordenes viejas): el lote queda para conversion manual.
        for product in run.products:
            conversion = (
                LotConversionCreate(target_item_id=product.target_item_id, quantity=product.quantity)
                if product.target_item_id is not None
                else LotConversionCreate(product_type_id=product.product_type_id, quantity=product.quantity)
            )
            try:
                self.inventory_service.convert_lot_to_product(
                    lot.id, conversion, user_id=current_user.id
                )
            except (InventoryDomainError, InventoryNotFoundError) as exc:
                raise ProductionDomainError(
                    f"No se pudo convertir el lote al producto planificado: {exc}"
                ) from exc
        run.status = ProductionRunStatus.RECEIVED
        run.received_at = datetime.utcnow()
        run.received_by_user_id = current_user.id
        self.repository.flush()
        return self._read_with_names(run)

    @staticmethod
    def _ensure_unique_stage_order(stages: list) -> None:
        stage_orders = [stage.order for stage in stages]
        if len(stage_orders) != len(set(stage_orders)):
            raise ProductionDomainError("El orden de las etapas no puede repetirse.")

    def _validate_materials(self, materials: list) -> None:
        item_ids = [material.inventory_item_id for material in materials]
        if len(item_ids) != len(set(item_ids)):
            raise ProductionDomainError("No repitas la misma materia prima en el proceso.")
        from sqlalchemy import select
        from backend.modules.inventory.models import InventoryItem

        rows = self.repository.session.execute(
            select(InventoryItem.id, InventoryItem.item_type).where(
                InventoryItem.id.in_(item_ids)
            )
        ).all()
        item_types = {row[0]: row[1] for row in rows}
        for item_id in item_ids:
            item_type = item_types.get(item_id)
            if item_type is None:
                raise ProductionDomainError(
                    "Una materia prima seleccionada no existe en el inventario."
                )
            if item_type not in ("RAW_MATERIAL", "SUPPLY"):
                raise ProductionDomainError(
                    "Solo se pueden usar materias primas o insumos del inventario."
                )
