from dataclasses import dataclass, field
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
from backend.modules.shared.formatting import format_qty
from backend.modules.production.models import (
    ActaLineSide,
    ActaLineSource,
    AssemblyMode,
    AssemblyRecipe,
    AssemblyRecipeItem,
    ComplementRequestStatus,
    ProductionComplementRequest,
    ProductionProcess,
    ProductionProcessProductType,
    ProductionProcessStage,
    ProductionProcessStageIngredient,
    ProductionRun,
    ProductionRunActaLine,
    ProductionRunAdditionalMaterialRequest,
    ProductionRunAssemblyItem,
    ProductionRunProduct,
    ProductionRunStage,
    ProductionRunStageDecision,
    ProductionRunStageIngredient,
    ProductionRunStageStatus,
    ProductionRunStatus,
)

DECISION_STAGE_TYPES = {"DECISION", "CONTROL"}
from backend.modules.production.repository import ProductionProcessRepository
from backend.modules.production.schemas import (
    ActaLineCreate,
    ActaLineRead,
    ActaLineUpdate,
    AdditionalMaterialRequestCreate,
    AdditionalMaterialRequestRead,
    AdminActaLineCreate,
    AssemblyRecipeItemRead,
    AssemblyRecipeRead,
    AssemblyRecipeUpsert,
    ComplementReturnCreate,
    ProductionProcessCreate,
    ProductionProcessRead,
    ProductionProcessUpdate,
    ProductionRunCreate,
    ProductionRunRead,
    ProductionRunStageFinish,
    ReceiveFinishedProductPayload,
    RunAssemblyDefine,
    RunAssemblyLineCreate,
    RunProductsUpdate,
    StageWeightEdit,
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
        read.materials_approved_by_name = (
            name_for(run.materials_approved_by_user_id) or run.materials_approved_responsable_name
        )
        read.received_by_name = name_for(run.received_by_user_id) or run.received_responsable_name
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


def _waste_line_label(stage_name: str) -> str:
    """Etiqueta de la fila de merma por etapa. `stage_name` es dato libre del
    proceso (no hardcodeado): si el admin ya nombro la etapa "Etapa 2", no
    hay que anteponer otra vez "etapa" (salia "Merma etapa Etapa 2" -- bug
    reportado por Rodrigo, la palabra se repetia)."""
    if stage_name.strip().lower().startswith("etapa"):
        return f"Merma {stage_name}"
    return f"Merma etapa {stage_name}"


@dataclass
class _ResourceShortage:
    """Un recurso puntual (materia prima, complemento o insumo de etapa) que
    no alcanza. `shortages` en _MaterialCoverage junta TODOS los que esten
    cortos a la vez -- no solo el que manda la fraccion cubierta -- para que
    el aviso al usuario los liste todos (bug reportado: solo se mostraba
    uno, ej. faltaba materia prima Y un insumo a la vez y solo se avisaba de
    la materia prima)."""

    name: str
    unit: str
    available: Decimal
    needed: Decimal
    is_complement: bool


@dataclass
class _MaterialCoverage:
    """Resultado del calculo de cobertura: cuanto de `target_qty` (cantidad de
    materia prima, en su unidad) alcanza a cubrir el stock disponible, y cual
    es el recurso que manda (el mas corto, entre materia prima, complementos
    e insumos). `shortages` trae TODOS los recursos cortos, no solo el que
    manda."""

    covered_qty: Decimal
    target_qty: Decimal
    limiting_name: str
    limiting_available: Decimal
    limiting_unit: str
    limiting_required_per_unit: Decimal
    limiting_is_complement: bool
    shortages: list[_ResourceShortage] = field(default_factory=list)

    @property
    def is_partial(self) -> bool:
        return self.covered_qty < self.target_qty

    def shortage_message(self) -> str:
        origin = (
            " (complemento/insumo solicitado en la orden)"
            if self.limiting_is_complement
            else ""
        )
        return (
            f"Stock insuficiente de '{self.limiting_name}'{origin}: disponible "
            f"{format_qty(self.limiting_available)} {self.limiting_unit}, se requieren "
            f"{format_qty(self.limiting_required_per_unit)} {self.limiting_unit}."
        )


def _reservation_is_complete(run: ProductionRun) -> bool:
    """True si la corrida tiene reservado el 100% de lo que necesita: materia
    prima, cada complemento Y cada insumo de etapa pendiente."""
    if run.reserved_material_quantity < run.total_required_material:
        return False
    for complement in run.complements:
        if complement.status != ComplementRequestStatus.PENDING:
            continue
        if complement.reserved_quantity < complement.quantity:
            return False
    for stage in run.stages:
        for ingredient in stage.ingredients:
            if ingredient.reserved_quantity < ingredient.quantity:
                return False
    return True


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
                if item is None or item.item_type not in ("FINISHED_PRODUCT", "COMPLEMENT"):
                    raise ProductionDomainError(
                        "El destino seleccionado no existe como pieza en el inventario."
                    )
                if item.item_type == "FINISHED_PRODUCT":
                    if not item.product_code or len(item.product_code) != 7:
                        raise ProductionDomainError(
                            "La pieza destino debe tener un codigo de catalogo de 7 digitos."
                        )
                # COMPLEMENT: la joyeria fabrica su propio complemento; no
                # lleva codigo de catalogo (recetas/claves de modelo no aplican).

        if assembly_mode == AssemblyMode.ASSEMBLE:
            if len(products) != 1 or products[0].quantity != quantity:
                raise ProductionDomainError(
                    "En modo ensamblar el plan es un solo producto con la cantidad de la orden."
                )
            single = products[0]
            if single.target_item_id is not None:
                item = self.repository.session.get(InventoryItem, single.target_item_id)
                if item is not None and item.item_type != "FINISHED_PRODUCT":
                    raise ProductionDomainError(
                        "En ensamblar el producto final debe ser un producto terminado del catalogo."
                    )
            return

        total = sum((p.quantity for p in products), Decimal("0"))
        if total != quantity:
            raise ProductionDomainError(
                f"El plan de productos suma {total} y la orden fabrica {quantity}: deben coincidir."
            )

    def create_process(self, payload: ProductionProcessCreate) -> ProductionProcessRead:
        self._ensure_unique_stage_order(payload.stages)
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
                    ProductionProcessStageIngredient(inventory_item_id=ing.inventory_item_id)
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
        self._validate_product_types(payload.product_type_ids)
        process = self.repository.get(process_id)
        if process is None:
            raise ProductionNotFoundError("Proceso no encontrado.")

        process.name = payload.name
        process.description = payload.description
        process.version = payload.version
        process.waste_limit_percent = payload.waste_limit_percent
        process.is_active = payload.is_active
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
                    ProductionProcessStageIngredient(inventory_item_id=ing.inventory_item_id)
                    for ing in stage_data.ingredients
                ],
            )
            new_stages.append(stage)

        process.stages = new_stages
        # Reconciliar, NO reemplazar la coleccion entera. Con
        # `process.product_types = [...]` SQLAlchemy emite el INSERT de la fila
        # nueva antes del DELETE de la vieja en el mismo flush, y el unique
        # (process_id, product_type_id) lo rechaza: guardar un proceso sin
        # cambiarle los tipos daba 500. Tocando solo lo que cambio, un tipo que
        # sigue igual nunca se re-inserta.
        desired = list(payload.product_type_ids)
        current = {link.product_type_id: link for link in process.product_types}
        for type_id, link in current.items():
            if type_id not in desired:
                process.product_types.remove(link)
        for type_id in desired:
            if type_id not in current:
                process.product_types.append(
                    ProductionProcessProductType(product_type_id=type_id)
                )
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

        ensure_raw("Oro 18K")
        ensure_raw("Plata 925")

        for definition in EXAMPLE_PROCESSES:
            self.create_process(
                ProductionProcessCreate(
                    name=definition["name"],
                    description=definition["description"],
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

        # Cualquier materia prima del inventario es utilizable en cualquier
        # proceso: la cantidad que el usuario ingresa es directamente el
        # total de materia prima a usar (ya no hay ratio por unidad).
        from backend.modules.inventory.models import InventoryItem

        raw_material_item = self.repository.session.get(InventoryItem, payload.raw_material_item_id)
        if raw_material_item is None or raw_material_item.item_type != "RAW_MATERIAL":
            raise ProductionDomainError(
                "La materia prima seleccionada no existe en el inventario."
            )
        unit_code = raw_material_item.unit_code

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

        total_required = payload.quantity
        run = ProductionRun(
            process_id=process.id,
            process_name=process.name,
            quantity=payload.quantity,
            status=ProductionRunStatus.PENDING_INVENTORY,
            assembly_mode=payload.assembly_mode,
            raw_material_item_id=payload.raw_material_item_id,
            raw_material_unit_code=unit_code,
            total_required_material=total_required,
            waste_limit_percent=process.waste_limit_percent,
            expected_finished_weight=total_required,
            created_by_user_id=current_user.id,
            requested_at=datetime.utcnow(),
        )
        run.production_code = _generate_production_code(self.repository, datetime.utcnow().year)
        run_seq = int(run.production_code.split("-")[2]) if run.production_code else 0

        # Insumos: cada etapa activa puede tener insumos configurados
        # (whitelist en ProductionProcessStageIngredient); la orden debe
        # declarar la cantidad exacta de cada uno, ni de mas ni de menos.
        configured_ingredients = [
            (stage, ingredient)
            for stage in active_stages
            for ingredient in stage.ingredients
        ]
        payload_ingredient_ids = [line.process_stage_ingredient_id for line in payload.stage_ingredients]
        if len(payload_ingredient_ids) != len(set(payload_ingredient_ids)):
            raise ProductionDomainError("No repitas el mismo insumo en la solicitud.")
        configured_ids = {ingredient.id for _, ingredient in configured_ingredients}
        payload_ids = {line.process_stage_ingredient_id for line in payload.stage_ingredients}
        if configured_ids != payload_ids:
            raise ProductionDomainError(
                "Debes indicar la cantidad de cada insumo configurado en las etapas de este proceso."
            )
        payload_by_id = {line.process_stage_ingredient_id: line.quantity for line in payload.stage_ingredients}

        ingredient_items: dict = {}
        for _, ingredient in configured_ingredients:
            supply = self.repository.session.get(InventoryItem, ingredient.inventory_item_id)
            if supply is None:
                raise ProductionDomainError("Un insumo configurado ya no existe en el inventario.")
            ingredient_items[ingredient.id] = supply

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
                    ingredients=[
                        ProductionRunStageIngredient(
                            inventory_item_id=ingredient.inventory_item_id,
                            quantity=payload_by_id[ingredient.id],
                            unit_code=ingredient_items[ingredient.id].unit_code,
                        )
                        for ingredient in stage.ingredients
                    ],
                )
            )

        for line_order, product in enumerate(payload.products):
            run.products.append(
                ProductionRunProduct(
                    product_type_id=product.product_type_id,
                    target_item_id=product.target_item_id,
                    quantity=product.quantity,
                    line_order=line_order,
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

        # Acta persistida: sembrada con el plan de la orden (materia prima,
        # insumos, complementos, resultantes). Eventos reales la siguen
        # alimentando despues (aprobar materiales, material adicional,
        # merma por etapa, recepcion) — todavia no implementado.
        stage_by_source_id = {stage.source_stage_id: stage for stage in run.stages}
        entrega_order = 0
        run.acta_lines.append(
            ProductionRunActaLine(
                side=ActaLineSide.ENTREGA,
                label=raw_material_item.name,
                quantity=payload.quantity,
                unit_code=unit_code,
                item_id=raw_material_item.id,
                source=ActaLineSource.PLAN,
                line_order=entrega_order,
            )
        )
        entrega_order += 1
        for stage, ingredient in configured_ingredients:
            run.acta_lines.append(
                ProductionRunActaLine(
                    side=ActaLineSide.ENTREGA,
                    stage_id=stage_by_source_id[stage.id].id,
                    label=ingredient_items[ingredient.id].name,
                    quantity=payload_by_id[ingredient.id],
                    unit_code=ingredient_items[ingredient.id].unit_code,
                    item_id=ingredient_items[ingredient.id].id,
                    source=ActaLineSource.PLAN,
                    line_order=entrega_order,
                )
            )
            entrega_order += 1
        for complement, complement_item in zip(payload.complements, complement_items):
            run.acta_lines.append(
                ProductionRunActaLine(
                    side=ActaLineSide.ENTREGA,
                    label=complement_item.name,
                    quantity=complement.quantity,
                    unit_code=complement_item.unit_code,
                    item_id=complement_item.id,
                    source=ActaLineSource.PLAN,
                    line_order=entrega_order,
                )
            )
            entrega_order += 1

        from sqlalchemy import select
        from backend.modules.product_types.models import ProductType

        product_type_ids = {p.product_type_id for p in payload.products if p.product_type_id}
        product_types: dict = {}
        if product_type_ids:
            rows = self.repository.session.execute(
                select(ProductType).where(ProductType.id.in_(product_type_ids))
            ).scalars().all()
            product_types = {pt.id: pt for pt in rows}
        for line_order, product in enumerate(payload.products):
            if product.product_type_id:
                product_type = product_types.get(product.product_type_id)
                label = product_type.name if product_type else "Producto"
                # ProductType no define su propia unidad (el material/unidad se
                # decide en produccion, ver docstring del modelo) -- el
                # resultante hereda la unidad de la materia prima de ESTA
                # orden. Antes quedaba fijo en "und" sin importar que la orden
                # fuera en gramos, y una orden de 1g de materia prima terminaba
                # mostrando "1 und" del producto en vez de "1 g" (bug reportado).
                product_unit = unit_code
            else:
                target_item = self.repository.session.get(InventoryItem, product.target_item_id)
                label = target_item.name if target_item else "Producto"
                product_unit = target_item.unit_code if target_item else "und"
            run.acta_lines.append(
                ProductionRunActaLine(
                    side=ActaLineSide.RECEPCION,
                    label=label,
                    quantity=product.quantity,
                    unit_code=product_unit,
                    source=ActaLineSource.PLAN,
                    line_order=line_order,
                )
            )

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
                line_order=line_order,
            )
            for line_order, product in enumerate(payload.products)
        ]
        self.repository.flush()
        return self._read_with_names(run)

    def _next_split_code(self, root_code: str) -> str:
        """Siguiente sufijo de folio para una corrida hija: -B, -C, -D... El
        folio raiz (sin sufijo) es siempre la corrida original."""
        from sqlalchemy import select

        existing_codes = self.repository.session.execute(
            select(ProductionRun.production_code).where(
                ProductionRun.root_production_code == root_code
            )
        ).scalars().all()
        used_suffixes = {
            code.rsplit("-", 1)[-1]
            for code in existing_codes
            if code and code.startswith(f"{root_code}-")
        }
        letter_index = 1
        while True:
            letter = chr(ord("A") + letter_index)
            if letter not in used_suffixes:
                return f"{root_code}-{letter}"
            letter_index += 1

    def _split_run_for_partial_material(self, run: ProductionRun, covered_qty: Decimal) -> ProductionRun:
        """Reduce `run` a `covered_qty` (cantidad de materia prima, en su
        unidad) y crea una corrida hija ESPERANDO_MATERIAL con el remanente,
        mismo folio raiz. Reparte el plan de productos, los complementos y los
        insumos de etapa proporcionalmente a la MISMA fraccion que cubrio la
        materia prima."""
        original_quantity = run.quantity
        missing_qty = original_quantity - covered_qty
        root_code = run.root_production_code or run.production_code

        child = ProductionRun(
            process_id=run.process_id,
            process_name=run.process_name,
            quantity=missing_qty,
            status=ProductionRunStatus.WAITING_MATERIAL,
            assembly_mode=run.assembly_mode,
            raw_material_item_id=run.raw_material_item_id,
            raw_material_unit_code=run.raw_material_unit_code,
            total_required_material=missing_qty,
            waste_limit_percent=run.waste_limit_percent,
            expected_finished_weight=missing_qty,
            created_by_user_id=run.created_by_user_id,
            target_product_type_id=run.target_product_type_id,
            requested_at=datetime.utcnow(),
            root_production_code=root_code,
            parent_run_id=run.id,
        )
        child.production_code = self._next_split_code(root_code)

        process = self.repository.get(run.process_id)
        active_stages = (
            sorted((s for s in process.stages if s.is_active), key=lambda s: s.stage_order)
            if process is not None
            else []
        )
        code_parts = child.production_code.split("-") if child.production_code else []
        run_seq = int(code_parts[2]) if len(code_parts) > 2 else 0
        split_suffix = code_parts[3] if len(code_parts) > 3 else None
        ratio_missing = missing_qty / original_quantity if original_quantity > 0 else Decimal("0")
        run_stages_by_source = {stage.source_stage_id: stage for stage in run.stages}
        for stage in active_stages:
            stage_code = _stage_code_for(stage.name, run_seq, stage.stage_order)
            if split_suffix:
                stage_code = f"{stage_code}-{split_suffix}"
            run_stage = run_stages_by_source.get(stage.id)
            child_ingredients = []
            if run_stage is not None:
                for ingredient in list(run_stage.ingredients):
                    child_qty = ingredient.quantity * ratio_missing
                    ingredient.quantity = ingredient.quantity - child_qty
                    child_reserved = min(ingredient.reserved_quantity, child_qty)
                    ingredient.reserved_quantity = ingredient.reserved_quantity - child_reserved
                    if child_qty > 0:
                        child_ingredients.append(
                            ProductionRunStageIngredient(
                                inventory_item_id=ingredient.inventory_item_id,
                                quantity=child_qty,
                                reserved_quantity=child_reserved,
                                unit_code=ingredient.unit_code,
                            )
                        )
            child.stages.append(
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
                    stage_code=stage_code,
                    ingredients=child_ingredients,
                )
            )

        # Plan de productos: se llena el padre en el orden de las lineas
        # declaradas y el remanente de cada linea va a la hija. Sin
        # redondeo: la suma siempre cuadra exacto (montos continuos).
        remaining_parent_capacity = covered_qty
        for product in list(run.products):
            take = min(product.quantity, remaining_parent_capacity)
            remaining_parent_capacity -= take
            child_take = product.quantity - take
            product.quantity = take
            if child_take > 0:
                child.products.append(
                    ProductionRunProduct(
                        product_type_id=product.product_type_id,
                        target_item_id=product.target_item_id,
                        quantity=child_take,
                        line_order=product.line_order,
                    )
                )
        run.products = [product for product in run.products if product.quantity > 0]

        # Complementos: proporcional a la misma fraccion.
        for complement in list(run.complements):
            child_qty = complement.quantity * ratio_missing
            complement.quantity = complement.quantity - child_qty
            child_reserved = min(complement.reserved_quantity, child_qty)
            complement.reserved_quantity = complement.reserved_quantity - child_reserved
            if child_qty > 0:
                child.complements.append(
                    ProductionComplementRequest(
                        item_id=complement.item_id,
                        quantity=child_qty,
                        reserved_quantity=child_reserved,
                        unit_code=complement.unit_code,
                        status=ComplementRequestStatus.PENDING,
                    )
                )

        run.quantity = covered_qty
        run.total_required_material = covered_qty
        run.expected_finished_weight = run.total_required_material
        run.root_production_code = root_code
        child_material_reserved = min(
            run.reserved_material_quantity, child.total_required_material
        )
        run.reserved_material_quantity = run.reserved_material_quantity - child_material_reserved
        child.reserved_material_quantity = child_material_reserved

        self.repository.add_run(child)
        self.repository.flush()
        return child

    def _compute_coverage(self, run: ProductionRun, target_qty: Decimal) -> "_MaterialCoverage":
        """Cuanto de `target_qty` (cantidad de materia prima que se intenta
        cubrir) alcanza a cubrir el stock disponible HOY, considerando por
        igual materia prima, cada complemento pendiente y cada insumo de
        etapa: la fraccion mas corta entre todos manda, y esa MISMA fraccion
        se aplica a todos al partir la orden (ver _split_run_for_partial_material).

        Fuente unica del calculo: la usan tanto el preview (dry-run) como
        approve_materials (consume de verdad).
        """
        from backend.modules.inventory.models import InventoryItem

        if self.inventory_service is None:
            raise ProductionDomainError("Inventario no esta disponible.")
        raw_material = self.repository.session.get(InventoryItem, run.raw_material_item_id)
        if raw_material is None:
            raise ProductionDomainError("La materia prima de la orden ya no existe en inventario.")

        reserved_by_others = self.inventory_service.reserved_by_item(exclude_run_id=run.id)

        def available_of(item) -> Decimal:
            return item.current_stock - reserved_by_others.get(item.id, Decimal("0"))

        # target_qty puede ser menor que run.quantity (destinar parcial): el
        # resto de recursos (complementos, insumos de etapa) se evalua contra
        # esa MISMA fraccion, para que el preview refleje exactamente lo que
        # _split_run_for_partial_material haria si se procede.
        ratio = target_qty / run.quantity if run.quantity > 0 else Decimal("1")
        raw_needed = target_qty
        raw_available = available_of(raw_material)
        fraction = Decimal("1")
        coverage = _MaterialCoverage(
            covered_qty=target_qty,
            target_qty=target_qty,
            limiting_name=raw_material.name,
            limiting_available=raw_available,
            limiting_unit=raw_material.unit_code,
            limiting_required_per_unit=raw_needed,
            limiting_is_complement=False,
        )
        if raw_needed > 0 and raw_available < raw_needed:
            fraction = max(Decimal("0"), raw_available / raw_needed)
            coverage.shortages.append(
                _ResourceShortage(
                    name=raw_material.name,
                    unit=raw_material.unit_code,
                    available=raw_available,
                    needed=raw_needed,
                    is_complement=False,
                )
            )

        def consider(name: str, unit: str, available: Decimal, needed: Decimal) -> None:
            nonlocal fraction
            if needed <= 0:
                return
            if available < needed:
                coverage.shortages.append(
                    _ResourceShortage(name=name, unit=unit, available=available, needed=needed, is_complement=True)
                )
                candidate = max(Decimal("0"), available / needed)
                if candidate < fraction:
                    fraction = candidate
                    coverage.limiting_name = name
                    coverage.limiting_available = available
                    coverage.limiting_unit = unit
                    coverage.limiting_required_per_unit = needed
                    coverage.limiting_is_complement = True

        for complement in run.complements:
            if complement.status != ComplementRequestStatus.PENDING:
                continue
            item = self.repository.session.get(InventoryItem, complement.item_id)
            if item is None:
                raise ProductionDomainError("Un complemento solicitado ya no existe en inventario.")
            consider(item.name, item.unit_code, available_of(item), complement.quantity * ratio)

        for stage in run.stages:
            for ingredient in stage.ingredients:
                item = self.repository.session.get(InventoryItem, ingredient.inventory_item_id)
                if item is None:
                    raise ProductionDomainError("Un insumo solicitado ya no existe en inventario.")
                consider(item.name, item.unit_code, available_of(item), ingredient.quantity * ratio)

        coverage.covered_qty = max(Decimal("0"), min(target_qty, raw_needed * fraction))
        return coverage

    def preview_allocation(self, run_id: UUID, quantity_units: Decimal) -> "_MaterialCoverage":
        """Dry-run de `allocate_material`: NO consume, NO parte, NO cambia estado."""
        run = self.repository.get_run(run_id)
        if run is None:
            raise ProductionNotFoundError("Orden de produccion no encontrada.")
        if run.status != ProductionRunStatus.WAITING_MATERIAL:
            raise ProductionDomainError(
                "Solo se puede destinar material a ordenes en estado ESPERANDO_MATERIAL."
            )
        if quantity_units <= 0:
            raise ProductionDomainError("La cantidad a destinar debe ser mayor a cero.")
        if quantity_units > run.quantity:
            raise ProductionDomainError("No puedes destinar mas cantidad de la que la orden necesita.")
        if run.raw_material_item_id is None:
            raise ProductionDomainError("Esta orden no tiene materia prima asignada.")
        return self._compute_coverage(run, quantity_units)

    def reserve_material(
        self, run_id: UUID, quantity_units: Decimal, current_user: CurrentUser
    ) -> ProductionRunRead:
        """Guarda stock para esta corrida SIN consumirlo ni arrancarla.

        No hay movimiento de inventario: el material sigue fisicamente en su
        item. Lo unico que cambia es que deja de estar disponible para otras
        ordenes (ver InventoryService.available_stock). La corrida se queda en
        ESPERANDO_MATERIAL hasta que quede reservada al 100%.
        """
        run = self.repository.get_run(run_id)
        if run is None:
            raise ProductionNotFoundError("Orden de produccion no encontrada.")
        if run.status != ProductionRunStatus.WAITING_MATERIAL:
            raise ProductionDomainError(
                "Solo se puede reservar material para ordenes en estado ESPERANDO_MATERIAL."
            )
        if quantity_units <= 0:
            raise ProductionDomainError("La cantidad a reservar debe ser mayor a cero.")
        if quantity_units > run.quantity:
            raise ProductionDomainError("No puedes reservar mas cantidad de la que la orden necesita.")

        # Reserva RECURSO POR RECURSO, independiente. El minimo entre recursos
        # (_compute_coverage) responde "cuantas unidades puedo ARRANCAR"; aqui
        # la pregunta es otra: "que guardo de lo que acaba de llegar". Si llego
        # materia prima pero el complemento sigue en cero, la materia prima
        # igual se guarda y la orden espera el resto -- que es justamente el
        # punto de "reservar y esperar". Atarlo al minimo hacia que un recurso
        # en cero impidiera reservar el que si llego.
        from backend.modules.inventory.models import InventoryItem

        reserved_by_others = self.inventory_service.reserved_by_item(exclude_run_id=run.id)

        def free_for_this_run(item, already_mine: Decimal) -> Decimal:
            """Stock que esta corrida todavia puede tomar: el fisico menos lo
            que retienen otras corridas menos lo que ella ya tiene reservado."""
            free = item.current_stock - reserved_by_others.get(item.id, Decimal("0")) - already_mine
            return max(Decimal("0"), free)

        raw_material = self.repository.session.get(InventoryItem, run.raw_material_item_id)
        if raw_material is None:
            raise ProductionDomainError("La materia prima de la orden ya no existe en inventario.")

        added = Decimal("0")
        short_names: list[str] = []

        wanted = quantity_units
        pending = run.total_required_material - run.reserved_material_quantity
        take = min(wanted, pending, free_for_this_run(raw_material, run.reserved_material_quantity))
        if take > 0:
            run.reserved_material_quantity += take
            added += take
        elif pending > 0:
            short_names.append(raw_material.name)

        run_quantity = run.quantity or Decimal("0")
        for complement in run.complements:
            if complement.status != ComplementRequestStatus.PENDING:
                continue
            item = self.repository.session.get(InventoryItem, complement.item_id)
            if item is None:
                raise ProductionDomainError("Un complemento solicitado ya no existe en inventario.")
            wanted = complement.quantity * (quantity_units / run_quantity) if run_quantity > 0 else complement.quantity
            pending = complement.quantity - complement.reserved_quantity
            take = min(wanted, pending, free_for_this_run(item, complement.reserved_quantity))
            if take > 0:
                complement.reserved_quantity += take
                added += take
            elif pending > 0:
                short_names.append(item.name)

        for stage in run.stages:
            for ingredient in stage.ingredients:
                item = self.repository.session.get(InventoryItem, ingredient.inventory_item_id)
                if item is None:
                    raise ProductionDomainError("Un insumo solicitado ya no existe en inventario.")
                wanted = ingredient.quantity * (quantity_units / run_quantity) if run_quantity > 0 else ingredient.quantity
                pending = ingredient.quantity - ingredient.reserved_quantity
                take = min(wanted, pending, free_for_this_run(item, ingredient.reserved_quantity))
                if take > 0:
                    ingredient.reserved_quantity += take
                    added += take
                elif pending > 0:
                    short_names.append(item.name)

        # Reservar es idempotente: si la corrida ya tiene guardado todo lo que
        # habia libre, volver a pedirlo no es un error, es un no-op. Solo falla
        # cuando no se logro reservar nada Y la corrida tampoco tenia nada
        # guardado de antes -- ahi si no hay de donde sacar y hay que avisar.
        already_held = run.reserved_material_quantity + sum(
            (
                complement.reserved_quantity
                for complement in run.complements
                if complement.status == ComplementRequestStatus.PENDING
            ),
            Decimal("0"),
        ) + sum(
            (ingredient.reserved_quantity for stage in run.stages for ingredient in stage.ingredients),
            Decimal("0"),
        )
        if added <= 0 and already_held <= 0:
            faltantes = ", ".join(f"'{name}'" for name in short_names) or "los materiales de la orden"
            raise ProductionDomainError(
                f"No hay stock libre para reservar: {faltantes} sin disponible. "
                "El stock que existe ya esta reservado para otra orden o consumido."
            )

        self.repository.flush()
        return self._read_with_names(run)

    def release_material_reservation(self, run_id: UUID, current_user: CurrentUser) -> ProductionRunRead:
        """Devuelve al disponible todo lo reservado por esta corrida."""
        run = self.repository.get_run(run_id)
        if run is None:
            raise ProductionNotFoundError("Orden de produccion no encontrada.")
        if run.status != ProductionRunStatus.WAITING_MATERIAL:
            raise ProductionDomainError(
                "Solo se puede liberar la reserva de ordenes en estado ESPERANDO_MATERIAL."
            )
        run.reserved_material_quantity = Decimal("0")
        for complement in run.complements:
            complement.reserved_quantity = Decimal("0")
        for stage in run.stages:
            for ingredient in stage.ingredients:
                ingredient.reserved_quantity = Decimal("0")
        self.repository.flush()
        return self._read_with_names(run)

    def start_with_reserved_material(self, run_id: UUID, current_user: CurrentUser) -> ProductionRunRead:
        """Consume de verdad las reservas y arranca la corrida.

        Solo procede con la reserva COMPLETA: es la accion explicita del 5.5
        del handoff -- el usuario espero a juntar todo y recien ahora arranca.
        """
        run = self.repository.get_run(run_id)
        if run is None:
            raise ProductionNotFoundError("Orden de produccion no encontrada.")
        if run.status != ProductionRunStatus.WAITING_MATERIAL:
            raise ProductionDomainError(
                "Solo se puede iniciar con reserva una orden en estado ESPERANDO_MATERIAL."
            )
        if not _reservation_is_complete(run):
            raise ProductionDomainError(
                "La reserva todavia no cubre el 100% de la orden. Destina el material "
                "que falta o arranca con lo que alcanza."
            )
        run.status = ProductionRunStatus.PENDING_INVENTORY
        self.repository.flush()
        self.approve_materials(run.id, current_user)
        return self.start_run(run.id, current_user)

    def preview_approve_materials(self, run_id: UUID) -> "_MaterialCoverage":
        """Dry-run de aprobar materiales: cuanto se alcanza a cubrir HOY, sin
        tocar nada -- mismo calculo que approve_materials (_compute_coverage,
        incluye insumos por etapa), para la confirmacion previa cuando va a
        quedar parcial. El frontend no tiene los insumos de cada etapa en el
        listado de corridas, asi que antes calculaba la cobertura a mano SIN
        ellos (bug reportado: el aviso de split no los mencionaba)."""
        if self.inventory_service is None:
            raise ProductionDomainError("Inventario no esta disponible.")
        run = self.repository.get_run(run_id)
        if run is None:
            raise ProductionNotFoundError("Orden de produccion no encontrada.")
        if run.status != ProductionRunStatus.PENDING_INVENTORY:
            raise ProductionDomainError("Solo se puede previsualizar la aprobacion de ordenes pendientes de Inventario.")
        if run.raw_material_item_id is None:
            raise ProductionDomainError("Esta orden no tiene materia prima asignada.")
        return self._compute_coverage(run, run.quantity)

    def approve_materials(self, run_id: UUID, current_user: CurrentUser) -> ProductionRunRead:
        if self.inventory_service is None:
            raise ProductionDomainError("Inventario no esta disponible para aprobar materiales.")
        run = self.repository.get_run(run_id)
        if run is None:
            raise ProductionNotFoundError("Orden de produccion no encontrada.")
        if run.status != ProductionRunStatus.PENDING_INVENTORY:
            raise ProductionDomainError("Solo se pueden aprobar materiales de ordenes pendientes de Inventario.")

        from backend.modules.inventory.models import InventoryItem

        if run.raw_material_item_id is None:
            raise ProductionDomainError("Esta orden no tiene materia prima asignada.")
        raw_material = self.repository.session.get(InventoryItem, run.raw_material_item_id)
        if raw_material is None:
            raise ProductionDomainError("La materia prima de la orden ya no existe en inventario.")

        original_quantity = run.quantity
        coverage = self._compute_coverage(run, original_quantity)
        covered_qty = coverage.covered_qty

        if covered_qty <= 0:
            raise ProductionDomainError(coverage.shortage_message())
        if covered_qty < original_quantity:
            self._split_run_for_partial_material(run, covered_qty)

        # La reserva de esta corrida se vuelve consumo real ahora mismo: se
        # libera ANTES de mover stock para que el tope por reservado de
        # create_movement no se cuente a si mismo. Lo que quedo en la corrida
        # hija (si hubo split) conserva su parte y sigue reservado.
        run.reserved_material_quantity = Decimal("0")
        for complement in run.complements:
            complement.reserved_quantity = Decimal("0")
        for stage in run.stages:
            for ingredient in stage.ingredients:
                ingredient.reserved_quantity = Decimal("0")
        self.repository.flush()

        try:
            self.inventory_service.consume_material_for_production(
                item_id=run.raw_material_item_id,
                quantity=run.total_required_material,
                production_run_id=run.id,
                user_id=current_user.id,
                production_code=run.production_code or run.root_production_code,
            )
        except InventoryDomainError as exc:
            raise ProductionDomainError(str(exc)) from exc
        # El acta debe reflejar lo que de verdad se acaba de aprobar, no el
        # monto pre-split que sembro create_run (ver _sync_entrega_acta_line).
        self._sync_entrega_acta_line(
            run,
            item_id=run.raw_material_item_id,
            label=raw_material.name,
            quantity=run.total_required_material,
            unit_code=raw_material.unit_code,
        )
        # Insumos configurados por etapa: se entregan junto con la materia
        # prima (cantidad declarada al crear ESTA orden) y quedan como un
        # movimiento por insumo. Se lee de la corrida (run.stages), no del
        # proceso en vivo: editar el proceso despues no debe alterar ordenes
        # ya creadas, igual que el resto del dominio.
        for stage in sorted(run.stages, key=lambda item: item.stage_order):
            for ingredient in stage.ingredients:
                supply = self.repository.session.get(InventoryItem, ingredient.inventory_item_id)
                supply_name = supply.name if supply is not None else "insumo"
                try:
                    self.inventory_service.consume_material_for_production(
                        item_id=ingredient.inventory_item_id,
                        quantity=ingredient.quantity,
                        production_run_id=run.id,
                        user_id=current_user.id,
                        production_code=run.production_code or run.root_production_code,
                        reason=f"Consumo de insumo en etapa {stage.stage_order}. {stage.stage_name}.",
                    )
                except InventoryDomainError as exc:
                    raise ProductionDomainError(f"Insumo '{supply_name}': {exc}") from exc
                self._sync_entrega_acta_line(
                    run,
                    item_id=ingredient.inventory_item_id,
                    label=supply_name,
                    quantity=ingredient.quantity,
                    unit_code=ingredient.unit_code,
                    stage_id=stage.id,
                )
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
                    production_code=run.production_code or run.root_production_code,
                    reason=f"Complemento para ensamble: {item_name}.",
                )
            except InventoryDomainError as exc:
                raise ProductionDomainError(f"Complemento '{item_name}': {exc}") from exc
            complement.status = ComplementRequestStatus.APPROVED
            complement.approved_by_user_id = current_user.id
            complement.approved_at = now
            self._sync_entrega_acta_line(
                run,
                item_id=complement.item_id,
                label=item_name,
                quantity=complement.quantity,
                unit_code=complement.unit_code,
            )
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
        run.is_cancellation = False
        for complement in run.complements:
            if complement.status == ComplementRequestStatus.PENDING:
                complement.status = ComplementRequestStatus.REJECTED
        self.repository.flush()
        return self._read_with_names(run)

    def request_additional_material(
        self, run_id: UUID, payload: AdditionalMaterialRequestCreate, current_user: CurrentUser
    ) -> ProductionRunRead:
        """Pide un material que no se declaro al crear la orden, mientras esta
        EN_PROCESO. Pasa por el mismo circuito real de Inventario que los
        complementos/insumos de creacion: queda PENDIENTE hasta que Inventario
        lo aprueba (consume stock de verdad) o lo rechaza."""
        run = self.repository.get_run(run_id)
        if run is None:
            raise ProductionNotFoundError("Orden de produccion no encontrada.")
        if run.status != ProductionRunStatus.IN_PROGRESS:
            raise ProductionDomainError(
                "Solo se puede solicitar material adicional mientras la orden esta EN_PROCESO."
            )

        from backend.modules.inventory.models import InventoryItem

        item = self.repository.session.get(InventoryItem, payload.item_id)
        if item is None or item.item_type not in ("RAW_MATERIAL", "SUPPLY", "COMPLEMENT"):
            raise ProductionDomainError(
                "El material solicitado no existe en materia prima, insumos o complementos."
            )
        active_stage = next(
            (stage for stage in run.stages if stage.status == ProductionRunStageStatus.IN_PROGRESS), None
        )
        run.additional_material_requests.append(
            ProductionRunAdditionalMaterialRequest(
                stage_id=active_stage.id if active_stage else None,
                item_id=item.id,
                quantity=payload.quantity,
                unit_code=item.unit_code,
                status=ComplementRequestStatus.PENDING,
                note=(payload.note or "").strip() or None,
                requested_by_user_id=current_user.id,
            )
        )
        self.repository.flush()
        return self._read_with_names(run)

    def approve_additional_material(self, request_id: UUID, current_user: CurrentUser) -> ProductionRunRead:
        if self.inventory_service is None:
            raise ProductionDomainError("Inventario no esta disponible para aprobar material adicional.")
        request = self.repository.get_additional_material_request(request_id)
        if request is None:
            raise ProductionNotFoundError("Solicitud de material adicional no encontrada.")
        if request.status != ComplementRequestStatus.PENDING:
            raise ProductionDomainError("Esta solicitud ya fue procesada.")

        from backend.modules.inventory.models import InventoryItem

        run = request.run
        item = self.repository.session.get(InventoryItem, request.item_id)
        item_name = item.name if item is not None else "material adicional"
        stage_name = next((s.stage_name for s in run.stages if s.id == request.stage_id), None)
        try:
            self.inventory_service.consume_material_for_production(
                item_id=request.item_id,
                quantity=request.quantity,
                production_run_id=run.id,
                user_id=current_user.id,
                production_code=run.production_code or run.root_production_code,
                reason=(
                    f"Material adicional solicitado durante la etapa {stage_name}."
                    if stage_name
                    else "Material adicional solicitado durante la produccion."
                ),
            )
        except InventoryDomainError as exc:
            raise ProductionDomainError(f"Material adicional '{item_name}': {exc}") from exc
        request.status = ComplementRequestStatus.APPROVED
        request.approved_by_user_id = current_user.id
        request.approved_at = datetime.utcnow()

        # Si lo aprobado es MAS de la propia materia prima de la orden (no un
        # insumo/complemento aparte), el total que entro a la orden crece: la
        # merma automatica por etapa (_previous_stage_weight/
        # _accumulated_loss_percent) usa run.total_required_material como
        # base, asi que las etapas siguientes recalculan solas contra el
        # nuevo total. Las etapas ya finalizadas no se tocan retroactivamente.
        if request.item_id == run.raw_material_item_id:
            run.total_required_material += request.quantity
            if run.expected_finished_weight is not None:
                run.expected_finished_weight += request.quantity

        self._add_or_merge_acta_line(
            run,
            side=ActaLineSide.ENTREGA,
            stage_id=request.stage_id,
            label=item_name,
            quantity=request.quantity,
            unit_code=request.unit_code,
            item_id=request.item_id,
            source=ActaLineSource.AUTO,
        )
        self.repository.flush()
        return self._read_with_names(run)

    def reject_additional_material(
        self, request_id: UUID, reason: str | None, current_user: CurrentUser
    ) -> ProductionRunRead:
        request = self.repository.get_additional_material_request(request_id)
        if request is None:
            raise ProductionNotFoundError("Solicitud de material adicional no encontrada.")
        if request.status != ComplementRequestStatus.PENDING:
            raise ProductionDomainError("Esta solicitud ya fue procesada.")
        request.status = ComplementRequestStatus.REJECTED
        request.rejection_reason = (reason or "").strip() or None
        request.approved_by_user_id = current_user.id
        request.approved_at = datetime.utcnow()
        self.repository.flush()
        return self._read_with_names(request.run)

    def _cancel_run_core(self, run: ProductionRun, current_user: CurrentUser, reason: str | None) -> None:
        """Nucleo de la cancelacion: libera cualquier reserva y devuelve al
        inventario todo lo que la corrida ya consumio (materia prima, insumos,
        complementos), y la marca CANCELADA. Sin el chequeo de "hijo activo" --
        lo usa tanto cancel_run (una corrida sola, ese chequeo si aplica) como
        cancel_run_family (todas las corridas de la familia juntas, donde el
        chequeo no tiene sentido: se estan cancelando todas a la vez)."""
        if run.status == ProductionRunStatus.WAITING_MATERIAL:
            run.reserved_material_quantity = Decimal("0")
            for complement in run.complements:
                complement.reserved_quantity = Decimal("0")

        if run.materials_approved_at is not None:
            if self.inventory_service is None:
                raise ProductionDomainError("Inventario no esta disponible para revertir el consumo de esta orden.")
            self.inventory_service.reverse_production_consumption(
                run.id,
                current_user.id,
                reason=(
                    f"Reversion por cancelacion de orden {run.production_code or run.id}."
                    + (f" {reason}" if reason else "")
                ),
            )

        run.status = ProductionRunStatus.CANCELLED
        run.rejected_by_user_id = current_user.id
        run.rejection_reason = reason
        run.rejected_at = datetime.utcnow()
        run.is_cancellation = True
        for complement in run.complements:
            if complement.status == ComplementRequestStatus.PENDING:
                complement.status = ComplementRequestStatus.REJECTED
        for request in run.additional_material_requests:
            if request.status == ComplementRequestStatus.PENDING:
                request.status = ComplementRequestStatus.REJECTED
        self._cancel_orphaned_recipe(run)

    def _cancel_orphaned_recipe(self, run: ProductionRun) -> None:
        """Si esta corrida fue la que CREO una receta de ensamble (nadie mas la
        toco desde entonces, ver _upsert_recipe_items), al cancelarla la
        receta se borra con ella -- no tiene sentido dejarla viva sin la
        orden que la origino y que nunca se termino de verdad."""
        from sqlalchemy import select

        recipe = self.repository.session.execute(
            select(AssemblyRecipe).where(AssemblyRecipe.created_by_run_id == run.id)
        ).scalars().first()
        if recipe is not None:
            self.repository.session.delete(recipe)

    def cancel_run(self, run_id: UUID, current_user: CurrentUser, reason: str | None) -> ProductionRunRead:
        """Cancela una orden por error (etapa aceptada por equivocacion, dato mal
        tipeado, etc.): libera cualquier reserva y devuelve al inventario todo lo
        que la orden ya consumio (materia prima, insumos, complementos). No borra
        la fila -- igual criterio que InventoryService.delete_item: una orden con
        movimientos no se borra, se cancela, para no perder la trazabilidad del
        error ni romper actas/reportes que ya la referencian. El motivo es
        opcional -- no toda cancelacion tiene (o necesita) una explicacion."""
        reason = (reason or "").strip() or None
        run = self.repository.get_run(run_id)
        if run is None:
            raise ProductionNotFoundError("Orden de produccion no encontrada.")
        if run.status == ProductionRunStatus.RECEIVED:
            raise ProductionDomainError(
                "No se puede cancelar una orden ya recibida (ya se convirtio en producto terminado)."
            )
        if run.status == ProductionRunStatus.CANCELLED:
            raise ProductionDomainError("Esta orden ya esta cancelada.")

        from sqlalchemy import select

        active_child = self.repository.session.execute(
            select(ProductionRun.id).where(
                ProductionRun.parent_run_id == run.id,
                ProductionRun.status != ProductionRunStatus.CANCELLED,
            )
        ).first()
        if active_child is not None:
            raise ProductionDomainError(
                "Esta orden tiene una corrida hija activa (se dividio por falta de material). "
                "Cancela primero esa corrida hija, o cancela toda la familia junta desde 'Cancelar todo'."
            )

        self._cancel_run_core(run, current_user, reason)
        self.repository.flush()
        return self._read_with_names(run)

    def cancel_run_family(
        self, run_id: UUID, current_user: CurrentUser, reason: str | None
    ) -> list[ProductionRunRead]:
        """Cancela TODA la familia de una orden dividida (la raiz y cada corrida
        hija) de una sola vez, sin importar en que estado quedo cada una -- una
        corrida ya EN_PROCESO y su hermana todavia ESPERANDO_MATERIAL se
        cancelan juntas, revirtiendo a inventario lo que cada una ya haya
        consumido. Existe para el caso donde un split arranco solo una parte y
        el resto ya no tiene sentido seguir esperando: cancelar la raiz sola
        (cancel_run) lo bloquea el chequeo de "hijo activo"; esta funcion no
        lo tiene porque cancela a todos de una."""
        reason = (reason or "").strip() or None
        run = self.repository.get_run(run_id)
        if run is None:
            raise ProductionNotFoundError("Orden de produccion no encontrada.")

        root_code = run.root_production_code or run.production_code
        from sqlalchemy import or_, select

        family = (
            self.repository.session.execute(
                select(ProductionRun).where(
                    or_(
                        ProductionRun.production_code == root_code,
                        ProductionRun.root_production_code == root_code,
                    )
                )
            )
            .scalars()
            .all()
            if root_code is not None
            else [run]
        )
        if not family:
            family = [run]

        cancellable = [
            member
            for member in family
            if member.status not in (ProductionRunStatus.CANCELLED, ProductionRunStatus.RECEIVED)
        ]
        if not cancellable:
            raise ProductionDomainError("No hay ninguna parte de esta orden que se pueda cancelar.")

        for member in cancellable:
            self._cancel_run_core(member, current_user, reason)
        self.repository.flush()
        return [self._read_with_names(member) for member in cancellable]

    def allocate_material(
        self, run_id: UUID, quantity_units: Decimal, current_user: CurrentUser
    ) -> ProductionRunRead:
        """Inventario destina un ingreso nuevo (materia prima o complemento) a
        una corrida ESPERANDO_MATERIAL: aprueba materiales e inicia la corrida
        automaticamente. La cobertura real (cuanto alcanza) la calcula
        approve_materials considerando AMBOS recursos -- materia prima y cada
        complemento pendiente -- y toma el minimo; si alguno de los dos sigue
        corto, esta funcion no debe adelantarse a bloquear solo por materia
        prima: approve_materials es quien decide, parte de nuevo si hace falta
        y solo arranca lo que de verdad esta cubierto por completo."""
        run = self.repository.get_run(run_id)
        if run is None:
            raise ProductionNotFoundError("Orden de produccion no encontrada.")
        if run.status != ProductionRunStatus.WAITING_MATERIAL:
            raise ProductionDomainError(
                "Solo se puede destinar material a ordenes en estado ESPERANDO_MATERIAL."
            )
        if quantity_units <= 0:
            raise ProductionDomainError("La cantidad a destinar debe ser mayor a cero.")
        if quantity_units > run.quantity:
            raise ProductionDomainError("No puedes destinar mas cantidad de la que la orden necesita.")
        if run.raw_material_item_id is None:
            raise ProductionDomainError("Esta orden no tiene materia prima asignada.")

        if quantity_units < run.quantity:
            self._split_run_for_partial_material(run, quantity_units)

        run.status = ProductionRunStatus.PENDING_INVENTORY
        self.repository.flush()
        self.approve_materials(run.id, current_user)
        return self.start_run(run.id, current_user)

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
            # Sumado por item: dos aprobaciones del mismo insumo (ej. material
            # adicional pedido dos veces) son UN insumo con mas cantidad, no
            # dos filas separadas -- asi el acta y el picker de "Entregar
            # material" ven el total real disponible.
            #
            # Los complementos (run.complements) tambien generan su propio
            # movimiento CONSUMO_PRODUCCION al aprobarse (ver approve_materials)
            # -- sin excluirlos aqui, ese mismo movimiento aparecia OTRA VEZ
            # como si fuera un insumo aparte: la misma cantidad, dos filas, en
            # el picker de "Entregar material" (bug reportado).
            complement_item_ids = {c.item_id for c in run.complements}
            totals: dict = {}
            for m in by_run.get(run.id, []):
                if m.item_id == run.raw_material_item_id or m.item_id in complement_item_ids:
                    continue
                entry = totals.setdefault(m.item_id, {"quantity": Decimal("0"), "unit_code": m.unit_code})
                entry["quantity"] += m.quantity
            read.supply_consumptions = [
                SupplyConsumptionRead(
                    item_id=item_id,
                    name=names.get(item_id, "Insumo"),
                    quantity=entry["quantity"],
                    unit_code=entry["unit_code"],
                )
                for item_id, entry in totals.items()
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
        item_units: dict = {}
        if item_ids:
            rows = self.repository.session.execute(
                select(
                    InventoryItem.id, InventoryItem.name, InventoryItem.description, InventoryItem.unit_code
                ).where(InventoryItem.id.in_(item_ids))
            ).all()
            for item_id, name, description, unit_code in rows:
                item_names[item_id] = name
                target_names[item_id] = (description or "").strip() or name
                item_units[item_id] = unit_code
        for read in reads:
            for product in read.products:
                if product.product_type_id is not None:
                    product.product_name = type_names.get(product.product_type_id)
                else:
                    product.product_name = target_names.get(product.target_item_id)
                    product.unit_code = item_units.get(product.target_item_id)
            used_by_item: dict = {}
            for assembly_item in read.assembly_items:
                used_by_item[assembly_item.complement_item_id] = (
                    used_by_item.get(assembly_item.complement_item_id, Decimal("0")) + assembly_item.quantity
                )
            for complement in read.complements:
                complement.name = item_names.get(complement.item_id)
                complement.used_quantity = used_by_item.get(complement.item_id, Decimal("0"))
            for assembly_item in read.assembly_items:
                assembly_item.name = item_names.get(assembly_item.complement_item_id)

    def _attach_additional_materials(self, reads: list, runs: list) -> None:
        """Nombres de item/etapa/usuario para las solicitudes de material
        adicional pedidas mientras la corrida estaba EN_PROCESO."""
        from sqlalchemy import select
        from backend.modules.inventory.models import InventoryItem

        item_ids = {r.item_id for run in runs for r in run.additional_material_requests}
        item_names: dict = {}
        if item_ids:
            rows = self.repository.session.execute(
                select(InventoryItem.id, InventoryItem.name).where(InventoryItem.id.in_(item_ids))
            ).all()
            item_names = {row[0]: row[1] for row in rows}
        user_ids = [
            uid
            for run in runs
            for r in run.additional_material_requests
            for uid in (r.requested_by_user_id, r.approved_by_user_id)
        ]
        user_names = _resolve_run_user_names(self.repository.session, user_ids)
        for read, run in zip(reads, runs):
            stages_by_id = {stage.id: stage for stage in run.stages}
            read.additional_materials = [
                AdditionalMaterialRequestRead(
                    id=r.id,
                    item_id=r.item_id,
                    name=item_names.get(r.item_id),
                    quantity=r.quantity,
                    unit_code=r.unit_code,
                    status=r.status,
                    stage_id=r.stage_id,
                    stage_name=(stages_by_id[r.stage_id].stage_name if r.stage_id in stages_by_id else None),
                    note=r.note,
                    requested_by_name=user_names.get(str(r.requested_by_user_id)),
                    requested_at=r.requested_at,
                    approved_by_name=user_names.get(str(r.approved_by_user_id)) if r.approved_by_user_id else None,
                    approved_at=r.approved_at,
                    rejection_reason=r.rejection_reason,
                )
                for r in run.additional_material_requests
            ]

    def _attach_acta_lines(self, reads: list, runs: list) -> None:
        """Nombres de etapa/usuario para las lineas de la acta persistida."""
        user_ids = [line.created_by_user_id for run in runs for line in run.acta_lines]
        user_names = _resolve_run_user_names(self.repository.session, user_ids)
        for read, run in zip(reads, runs):
            stages_by_id = {stage.id: stage for stage in run.stages}
            read.acta_lines = [
                ActaLineRead(
                    id=line.id,
                    side=line.side,
                    label=line.label,
                    quantity=line.quantity,
                    unit_code=line.unit_code,
                    item_id=line.item_id,
                    source=line.source,
                    stage_id=line.stage_id,
                    stage_name=(stages_by_id[line.stage_id].stage_name if line.stage_id in stages_by_id else None),
                    note=line.note,
                    created_by_name=(
                        user_names.get(str(line.created_by_user_id)) if line.created_by_user_id else None
                    ),
                    created_at=line.created_at,
                )
                for line in run.acta_lines
            ]

    def _sync_entrega_acta_line(
        self,
        run: ProductionRun,
        *,
        item_id: UUID,
        label: str,
        quantity: Decimal,
        unit_code: str,
        stage_id: UUID | None = None,
    ) -> None:
        """Fija (no suma) la cantidad ENTREGA de `item_id` a lo que de verdad
        se aprobo/consumio en approve_materials. La linea PLAN que sembro
        create_run trae el monto pedido ANTES de saber si la orden se iba a
        partir por falta de stock -- si hubo split, esa linea se queda
        mostrando el pedido completo para siempre salvo que algo la corrija
        aca. La corrida hija ni siquiera tiene una linea (create_run solo
        corre para la raiz), asi que para ella esto crea la primera. Se
        empareja tambien por stage_id (no solo item_id): un mismo insumo
        puede estar configurado en dos etapas distintas de la misma corrida,
        y son dos lineas legitimas, no una a fusionar."""
        existing = next(
            (
                line
                for line in run.acta_lines
                if line.side == ActaLineSide.ENTREGA and line.item_id == item_id and line.stage_id == stage_id
            ),
            None,
        )
        if existing is not None:
            existing.quantity = quantity
            return
        line_order = sum(1 for line in run.acta_lines if line.side == ActaLineSide.ENTREGA)
        run.acta_lines.append(
            ProductionRunActaLine(
                side=ActaLineSide.ENTREGA,
                stage_id=stage_id,
                label=label,
                quantity=quantity,
                unit_code=unit_code,
                item_id=item_id,
                source=ActaLineSource.AUTO,
                line_order=line_order,
            )
        )

    def _add_or_merge_acta_line(
        self,
        run: ProductionRun,
        *,
        side: str,
        label: str,
        quantity: Decimal,
        unit_code: str,
        source: str,
        item_id: UUID | None = None,
        stage_id: UUID | None = None,
        note: str | None = None,
        created_by_user_id: UUID | None = None,
    ) -> None:
        """Si ya existe una linea del mismo lado y material, suma la cantidad
        ahi en vez de agregar otra fila -- volver a solicitar/registrar algo
        que ya esta en el acta es MAS de lo mismo, no un evento nuevo que
        merezca su propia linea.

        "El mismo material" se decide por item_id (identidad real de
        inventario) cuando se conoce -- dos items distintos pueden coincidir
        en nombre+unidad (ej. una materia prima y un insumo ambos llamados
        igual) y NO son lo mismo. Solo cuando no hay item_id (linea libre)
        se cae al match por texto, y unicamente contra otras lineas
        igualmente libres."""
        if item_id is not None:
            existing = next(
                (line for line in run.acta_lines if line.side == side and line.item_id == item_id),
                None,
            )
        else:
            existing = next(
                (
                    line
                    for line in run.acta_lines
                    if line.side == side and line.item_id is None and line.label == label and line.unit_code == unit_code
                ),
                None,
            )
        if existing is not None:
            existing.quantity += quantity
            return
        line_order = sum(1 for line in run.acta_lines if line.side == side)
        run.acta_lines.append(
            ProductionRunActaLine(
                side=side,
                stage_id=stage_id,
                label=label,
                quantity=quantity,
                unit_code=unit_code,
                item_id=item_id,
                source=source,
                line_order=line_order,
                note=note,
                created_by_user_id=created_by_user_id,
            )
        )

    def _apply_admin_acta_line_delta(
        self, line: ProductionRunActaLine, new_quantity: Decimal, current_user: CurrentUser
    ) -> None:
        """Aplica solo la diferencia entre lo que ya se movio para esta linea
        y `new_quantity` -- nunca edita un movimiento existente (todo cambio
        de stock nace de un InventoryMovement nuevo). Se usa al crear la
        linea (new_quantity = cantidad completa, nada movido todavia), al
        editar su cantidad, y al borrarla (new_quantity = 0, revierte el
        neto). No hace nada si la linea no tiene item_id (linea libre)."""
        if line.item_id is None:
            return
        increase_type = "CONSUMO_PRODUCCION" if line.side == ActaLineSide.ENTREGA else "DEVOLUCION_PRODUCCION"
        decrease_type = "DEVOLUCION_PRODUCCION" if line.side == ActaLineSide.ENTREGA else "CONSUMO_PRODUCCION"

        from sqlalchemy import select
        from backend.modules.inventory.models import InventoryMovement

        moved = self.repository.session.execute(
            select(InventoryMovement.movement_type, InventoryMovement.quantity).where(
                InventoryMovement.reference_type == "production_run_acta_line",
                InventoryMovement.reference_id == line.id,
            )
        ).all()
        net_so_far = sum(
            (qty if mtype == increase_type else -qty for mtype, qty in moved), Decimal("0")
        )
        delta = new_quantity - net_so_far
        if delta == 0:
            return
        movement_type = increase_type if delta > 0 else decrease_type
        run = line.run
        try:
            self.inventory_service.create_movement(
                InventoryMovementCreate(
                    item_id=line.item_id,
                    movement_type=movement_type,
                    quantity=abs(delta),
                    reason=f"Ajuste manual de administrador en acta: {line.label}.",
                    reference_type="production_run_acta_line",
                    reference_id=line.id,
                ),
                user_id=current_user.id,
                lot_code=run.production_code or run.root_production_code,
            )
        except InventoryDomainError as exc:
            raise ProductionDomainError(f"'{line.label}': {exc}") from exc

    def add_admin_acta_line(
        self, run_id: UUID, payload: AdminActaLineCreate, current_user: CurrentUser
    ) -> ProductionRunRead:
        """Boton de admin en la acta: agrega una linea en cualquier momento
        del proceso, con o sin item real de inventario. Con item_id mueve
        stock real de inmediato (sin aprobacion, ver
        _apply_admin_acta_line_delta); sin item_id es una linea libre igual
        que las MANUAL de siempre (nunca mueve stock). No reusa
        _add_or_merge_acta_line a proposito: cada correccion de admin es su
        propia fila, nunca se fusiona con una linea PLAN/AUTO existente del
        mismo item (eso le heredaria un source que no se puede borrar)."""
        run = self.repository.get_run(run_id)
        if run is None:
            raise ProductionNotFoundError("Orden de produccion no encontrada.")
        if run.event_lines:
            raise ProductionDomainError(
                "Esta orden ya tiene su acta cargada desde papel; no se pueden agregar lineas nuevas por este flujo."
            )

        if payload.item_id is None:
            if not payload.label or not payload.unit_code:
                raise ProductionDomainError("Escribe el detalle y la unidad de la linea.")
            line = ProductionRunActaLine(
                side=payload.side,
                label=payload.label.strip(),
                quantity=payload.quantity,
                unit_code=payload.unit_code.strip(),
                item_id=None,
                source=ActaLineSource.MANUAL,
                line_order=sum(1 for l in run.acta_lines if l.side == payload.side),
                note=(payload.note or "").strip() or None,
                created_by_user_id=current_user.id,
            )
            run.acta_lines.append(line)
            self.repository.flush()
            return self._read_with_names(run)

        if self.inventory_service is None:
            raise ProductionDomainError("Inventario no esta disponible para agregar esta linea.")

        from backend.modules.inventory.models import InventoryItem

        item = self.repository.session.get(InventoryItem, payload.item_id)
        if item is None:
            raise ProductionNotFoundError("Item de inventario no encontrado.")

        line = ProductionRunActaLine(
            side=payload.side,
            label=item.name,
            quantity=Decimal("0"),
            unit_code=item.unit_code,
            item_id=item.id,
            source=ActaLineSource.ADMIN_STOCK,
            line_order=sum(1 for l in run.acta_lines if l.side == payload.side),
            note=(payload.note or "").strip() or None,
            created_by_user_id=current_user.id,
        )
        run.acta_lines.append(line)
        self.repository.flush()
        self._apply_admin_acta_line_delta(line, payload.quantity, current_user)
        line.quantity = payload.quantity
        self.repository.flush()
        return self._read_with_names(run)

    def add_acta_line(self, run_id: UUID, payload: ActaLineCreate, current_user: CurrentUser) -> ProductionRunRead:
        """Agrega a mano una linea a la acta -- disponible en cualquier etapa
        de la orden, y tambien despues de recibida."""
        run = self.repository.get_run(run_id)
        if run is None:
            raise ProductionNotFoundError("Orden de produccion no encontrada.")
        self._add_or_merge_acta_line(
            run,
            side=payload.side,
            label=payload.label.strip(),
            quantity=payload.quantity,
            unit_code=payload.unit_code.strip(),
            item_id=payload.item_id,
            source=ActaLineSource.MANUAL,
            note=(payload.note or "").strip() or None,
            created_by_user_id=current_user.id,
        )
        self.repository.flush()
        return self._read_with_names(run)

    def update_acta_line(self, line_id: UUID, payload: ActaLineUpdate, current_user: CurrentUser) -> ProductionRunRead:
        """Edita una linea existente (de cualquier origen: plan, automatica o
        manual). Solo actualiza los campos que vengan en el payload."""
        line = self.repository.get_acta_line(line_id)
        if line is None:
            raise ProductionNotFoundError("Linea de acta no encontrada.")

        if line.source == ActaLineSource.ADMIN_STOCK:
            if payload.label is not None or payload.unit_code is not None:
                raise ProductionDomainError(
                    "Esta linea esta enlazada a un item de inventario: el detalle y la unidad no se editan a mano."
                )
            if payload.quantity is not None:
                self._apply_admin_acta_line_delta(line, payload.quantity, current_user)
                line.quantity = payload.quantity
            if payload.note is not None:
                line.note = payload.note.strip() or None
            self.repository.flush()
            return self._read_with_names(line.run)

        if payload.quantity is not None and line.side == ActaLineSide.RECEPCION and line.item_id is not None:
            cap = self._acta_line_max_quantity(line)
            if cap is not None and payload.quantity > cap:
                raise ProductionDomainError(
                    f"La cantidad ({format_qty(payload.quantity)} {line.unit_code}) supera lo que en realidad "
                    f"se entrego para este material ({format_qty(cap)} {line.unit_code})."
                )
        if payload.label is not None:
            line.label = payload.label.strip()
        if payload.quantity is not None:
            line.quantity = payload.quantity
        if payload.unit_code is not None:
            line.unit_code = payload.unit_code.strip()
        if payload.note is not None:
            line.note = payload.note.strip() or None
        self.repository.flush()
        return self._read_with_names(line.run)

    def _acta_line_max_quantity(self, line: ProductionRunActaLine) -> Decimal | None:
        """Techo real para editar una linea RECEPCION ligada a un item (uso o
        devolucion de insumo/complemento): no puede quedar, sumada a las demas
        lineas RECEPCION del mismo item, por encima de lo que de verdad se le
        entrego a la orden. Materia prima queda fuera -- esa se corrige por
        edit_stage_weight, que ya tiene su propia regla. Si el item no es un
        complemento ni un insumo conocido de esta orden, no hay techo (linea
        libre, sin identidad de inventario real detras)."""
        run = line.run
        if line.item_id == run.raw_material_item_id:
            return None
        other_logged = sum(
            (
                other.quantity
                for other in run.acta_lines
                if other.id != line.id and other.side == line.side and other.item_id == line.item_id
            ),
            Decimal("0"),
        )
        complement = next((c for c in run.complements if c.item_id == line.item_id), None)
        if complement is not None:
            return max(Decimal("0"), complement.quantity - other_logged)

        from sqlalchemy import select
        from backend.modules.inventory.models import InventoryMovement

        delivered = self.repository.session.execute(
            select(InventoryMovement.quantity).where(
                InventoryMovement.movement_type == "CONSUMO_PRODUCCION",
                InventoryMovement.reference_id == run.id,
                InventoryMovement.item_id == line.item_id,
            )
        ).scalars().all()
        if not delivered:
            return None
        return max(Decimal("0"), sum(delivered, Decimal("0")) - other_logged)

    def delete_acta_line(self, line_id: UUID, current_user: CurrentUser) -> ProductionRunRead:
        """Borra una linea agregada a mano (libre o enlazada a inventario).
        Las lineas planeadas o generadas automaticamente por un evento real
        no se borran -- son el rastro de lo que de verdad paso; si estan
        mal, se editan, no se esconden. Si la linea esta enlazada a
        inventario (ADMIN_STOCK), revierte el stock neto antes de borrarla."""
        line = self.repository.get_acta_line(line_id)
        if line is None:
            raise ProductionNotFoundError("Linea de acta no encontrada.")
        if line.source not in (ActaLineSource.MANUAL, ActaLineSource.ADMIN_STOCK):
            raise ProductionDomainError("Solo se pueden borrar lineas agregadas a mano.")
        if line.source == ActaLineSource.ADMIN_STOCK:
            self._apply_admin_acta_line_delta(line, Decimal("0"), current_user)
        run = line.run
        run.acta_lines.remove(line)
        self.repository.session.delete(line)
        self.repository.flush()
        return self._read_with_names(run)

    def _read_with_names(self, run: ProductionRun) -> ProductionRunRead:
        read = ProductionRunRead.model_validate(run)
        _populate_run_names(self.repository.session, [read], [run])
        self._attach_allowed_types([read], [run])
        self._attach_supply_consumptions([read], [run])
        self._attach_plan_names([read], [run])
        self._attach_additional_materials([read], [run])
        self._attach_acta_lines([read], [run])
        read.reservation_is_complete = _reservation_is_complete(run)
        return read

    def list_runs(self) -> list[ProductionRunRead]:
        runs = self.repository.list_runs()
        reads = [ProductionRunRead.model_validate(run) for run in runs]
        _populate_run_names(self.repository.session, reads, runs)
        self._attach_allowed_types(reads, runs)
        self._attach_supply_consumptions(reads, runs)
        self._attach_plan_names(reads, runs)
        self._attach_additional_materials(reads, runs)
        self._attach_acta_lines(reads, runs)
        for read, run in zip(reads, runs):
            read.reservation_is_complete = _reservation_is_complete(run)
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
                    f"El peso final ({format_qty(payload.final_weight)} {run.raw_material_unit_code}) no puede ser "
                    f"mayor que el material en proceso ({format_qty(reference)} {run.raw_material_unit_code})."
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
                if loss > 0:
                    recepcion_count = sum(1 for line in run.acta_lines if line.side == ActaLineSide.RECEPCION)
                    run.acta_lines.append(
                        ProductionRunActaLine(
                            side=ActaLineSide.RECEPCION,
                            stage_id=stage.id,
                            label=_waste_line_label(stage.stage_name),
                            quantity=loss,
                            unit_code=run.raw_material_unit_code,
                            item_id=run.raw_material_item_id,
                            source=ActaLineSource.AUTO,
                            line_order=recepcion_count,
                        )
                    )
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

    def edit_stage_weight(
        self, stage_id: UUID, payload: StageWeightEdit, current_user: CurrentUser
    ) -> ProductionRunRead:
        """Corrige el peso de una etapa YA finalizada (tipeo mal hecho al pesar).
        Solo antes de recibir: RECIBIDA ya uso estos pesos para mover inventario
        (producto terminado + merma), corregir despues descuadraria el stock."""
        stage = self.repository.get_run_stage(stage_id)
        if stage is None:
            raise ProductionNotFoundError("Etapa de produccion no encontrada.")
        run = stage.run
        if run.status in (ProductionRunStatus.RECEIVED, ProductionRunStatus.CANCELLED):
            raise ProductionDomainError(
                "No se puede editar el peso de una orden ya recibida o cancelada."
            )
        if stage.status != ProductionRunStageStatus.FINISHED:
            raise ProductionDomainError("Solo se puede corregir el peso de una etapa ya finalizada.")
        if not stage.requires_weighing:
            raise ProductionDomainError("Esta etapa no registra peso.")

        reference = self._previous_stage_weight(run, stage)
        if reference is not None and reference > 0 and payload.final_weight > reference:
            raise ProductionDomainError(
                f"El peso corregido ({format_qty(payload.final_weight)} {run.raw_material_unit_code}) no puede ser "
                f"mayor que el material que entro a la etapa ({format_qty(reference)} {run.raw_material_unit_code})."
            )

        # Mismo criterio que finish_stage: si la correccion deja la merma de
        # la etapa por encima del limite del proceso, queda registrada como
        # decision (weight_based=True) -- no un aviso pasivo que se olvida al
        # cerrar la ventana, sino el mismo rastro que deja el flujo normal
        # cuando se "pasa igualmente" una etapa fuera de condicion.
        if reference is not None and reference > 0:
            loss_percent = (reference - payload.final_weight) / reference * Decimal("100")
            if loss_percent > run.waste_limit_percent:
                self._record_decision(
                    run, stage, "APPROVED",
                    (payload.justification or "").strip() or (
                        f"Correccion de peso: {loss_percent:.2f}% de merma supera el limite "
                        f"{run.waste_limit_percent:.2f}%."
                    ),
                    True, payload.final_weight, None, current_user, len(stage.decisions) + 1,
                )

        if payload.initial_weight is not None:
            stage.initial_weight = payload.initial_weight
        stage.final_weight = payload.final_weight
        self._recompute_stage_waste_chain(run)
        self.repository.flush()
        return self._read_with_names(run)

    def _recompute_stage_waste_chain(self, run: ProductionRun) -> None:
        """Recalcula merma etapa por etapa desde el inicio, con la misma regla que
        finish_stage/_previous_stage_weight: la referencia de cada etapa pesada es
        el final_weight de la ultima etapa pesada anterior (o el material total si
        es la primera). Se corta en la primera etapa aun no finalizada -- lo que
        sigue no tiene peso todavia. Si la orden ya paso por _finish_run, sus
        totales (que son la suma de estas mermas) se recalculan tambien.

        finish_stage genera una linea AUTO en la acta persistida por cada merma de
        fase (ver ahi): al corregir el peso esa linea queda desactualizada si no
        se sincroniza aqui tambien -- por eso, para cada etapa recalculada, se
        actualiza/crea/borra su linea de merma segun el nuevo resultado."""
        ordered = sorted(run.stages, key=lambda item: item.stage_order)
        reference = run.total_required_material
        for stage in ordered:
            if stage.status != ProductionRunStageStatus.FINISHED:
                break
            if stage.requires_weighing and stage.final_weight is not None:
                if reference and reference > 0:
                    loss = max(Decimal("0"), reference - stage.final_weight)
                    stage.waste_weight = loss
                    stage.waste_percent = loss / reference * Decimal("100")
                else:
                    stage.waste_weight = None
                    stage.waste_percent = None
                reference = stage.final_weight
                self._sync_stage_waste_acta_line(run, stage)

        if run.finished_at is not None:
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
            # Mismo criterio que _finish_run: cantidad menos la merma total,
            # no el final_weight crudo de la ultima etapa (puede no pesar).
            if run.total_required_material is not None:
                run.actual_finished_weight = run.total_required_material - total_waste

    def _sync_stage_waste_acta_line(self, run: ProductionRun, stage: ProductionRunStage) -> None:
        """Mantiene en linea la fila AUTO de merma de esta etapa en la acta
        persistida con el `stage.waste_weight` recien recalculado -- misma
        fila que finish_stage crea la primera vez que la etapa termina con
        perdida (ver ahi). La busca por stage_id (a lo sumo una por etapa)."""
        existing = next(
            (
                line for line in run.acta_lines
                if line.side == ActaLineSide.RECEPCION
                and line.stage_id == stage.id
                and line.source == ActaLineSource.AUTO
            ),
            None,
        )
        loss = stage.waste_weight or Decimal("0")
        if loss <= 0:
            if existing is not None:
                run.acta_lines.remove(existing)
                self.repository.session.delete(existing)
            return
        if existing is not None:
            existing.quantity = loss
            return
        recepcion_count = sum(1 for line in run.acta_lines if line.side == ActaLineSide.RECEPCION)
        run.acta_lines.append(
            ProductionRunActaLine(
                side=ActaLineSide.RECEPCION,
                stage_id=stage.id,
                label=_waste_line_label(stage.stage_name),
                quantity=loss,
                unit_code=run.raw_material_unit_code,
                item_id=run.raw_material_item_id,
                source=ActaLineSource.AUTO,
                line_order=recepcion_count,
            )
        )

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

    def _model_part_for_piece(self, item_id: UUID) -> str | None:
        """Parte de modelo (categoria+modelo, 6 digitos, SIN el material) de
        una pieza de inventario: los ultimos 6 digitos de su codigo de
        catalogo. None si la pieza no tiene codigo de catalogo o no es
        producto terminado."""
        from backend.modules.inventory.models import InventoryItem

        item = self.repository.session.get(InventoryItem, item_id)
        if (
            item is None
            or item.item_type != "FINISHED_PRODUCT"
            or not item.product_code
            or len(item.product_code) != 7
        ):
            return None
        return item.product_code[1:]

    def _material_code_for_item(self, item_id: UUID | None) -> str | None:
        """Codigo de material (1 digito) de la materia prima de la orden,
        empatando su texto de material contra el catalogo. Los tipos de
        producto se comparten entre materiales, pero la receta de ensamble es
        propia de cada material; si la materia prima es nueva y no empata con
        ningun segmento MATERIAL, se crea uno (mismo criterio que la
        conversion de recepcion): sin esto, una materia prima recien creada
        nunca podria tener receta hasta despues de su primera conversion."""
        if item_id is None:
            return None
        from backend.modules.inventory.models import InventoryItem

        item = self.repository.session.get(InventoryItem, item_id)
        if item is None:
            return None
        text = (item.material_type or item.name or "").strip()
        if not text:
            return None
        if self.inventory_service is not None:
            return self.inventory_service.match_material_code(text)

        from sqlalchemy import select
        from backend.modules.catalog.models import CatalogSegment

        clean = text.upper()
        segments = self.repository.session.execute(
            select(CatalogSegment).where(
                CatalogSegment.kind == "MATERIAL",
                CatalogSegment.is_active.is_(True),
            )
        ).scalars().all()
        exact = next((s for s in segments if s.label.strip().upper() == clean), None)
        if exact is not None:
            return exact.code
        partial = sorted(
            (s for s in segments if s.label.strip().upper() in clean),
            key=lambda s: -len(s.label),
        )
        return partial[0].code if partial else None

    def _model_key_for_run(self, run: ProductionRun) -> str | None:
        """En modo ENSAMBLAR el plan tiene una sola fila: la clave completa es
        el material de la orden (raw_material_item_id) + la parte de modelo
        de la pieza destino, o de categoria+modelo si trae un tipo del
        catálogo. Requiere ambas partes; si alguna falta, no hay clave."""
        material_code = self._material_code_for_item(run.raw_material_item_id)
        if material_code is None:
            return None
        product = next(iter(run.products), None)
        if product is None:
            return None
        if product.target_item_id is not None:
            part = self._model_part_for_piece(product.target_item_id)
        elif product.product_type_id is not None:
            from backend.modules.product_types.models import ProductType

            product_type = self.repository.session.get(ProductType, product.product_type_id)
            part = None
            if product_type is not None:
                candidate = f"{product_type.category_code}{product_type.model_code}"
                part = candidate if len(candidate) == 6 else None
        else:
            part = None
        return f"{material_code}{part}" if part else None

    def _approved_complement_totals(self, run: ProductionRun) -> dict:
        """Suma por item de los complementos APROBADOS de la orden (lo que
        inventario realmente entregó, disponible para ensamblar)."""
        totals: dict = {}
        for complement in run.complements:
            if complement.status != ComplementRequestStatus.APPROVED:
                continue
            totals[complement.item_id] = totals.get(complement.item_id, Decimal("0")) + complement.quantity
        return totals

    def return_complement(
        self, complement_id: UUID, payload: ComplementReturnCreate, current_user: CurrentUser
    ) -> ProductionRunRead:
        """Devuelve a inventario el sobrante de un complemento aprobado: se
        desconto entero al aprobar (approve_materials). El sobrante devuelto
        se calcula siempre como `quantity - returned_quantity` (lo aprobado
        menos lo ya devuelto), sin importar lo que el ensamble haya marcado
        como usado (`assembly_items`) ni en que momento del proceso se
        registre la devolucion. Genera un movimiento DEVOLUCION_PRODUCCION
        real y una linea AUTO en la acta, lado RECEPCION."""
        if self.inventory_service is None:
            raise ProductionDomainError("Inventario no esta disponible para devolver el sobrante.")
        complement = self.repository.get_complement_request(complement_id)
        if complement is None:
            raise ProductionNotFoundError("Complemento no encontrado.")
        if complement.status != ComplementRequestStatus.APPROVED:
            raise ProductionDomainError("Solo se puede devolver un complemento ya aprobado (descontado de inventario).")

        run = complement.run
        remaining = complement.quantity - complement.returned_quantity
        if payload.quantity > remaining:
            raise ProductionDomainError(
                f"Solo quedan {format_qty(remaining)} {complement.unit_code} de sobrante para devolver."
            )

        from backend.modules.inventory.models import InventoryItem

        item = self.repository.session.get(InventoryItem, complement.item_id)
        item_name = item.name if item is not None else "complemento"
        try:
            self.inventory_service.return_material_from_production(
                item_id=complement.item_id,
                quantity=payload.quantity,
                production_run_id=run.id,
                user_id=current_user.id,
                production_code=run.production_code or run.root_production_code,
                reason=f"Devolucion de sobrante: {item_name}.",
            )
        except InventoryDomainError as exc:
            raise ProductionDomainError(f"Complemento '{item_name}': {exc}") from exc

        complement.returned_quantity += payload.quantity

        recepcion_count = sum(1 for line in run.acta_lines if line.side == ActaLineSide.RECEPCION)
        run.acta_lines.append(
            ProductionRunActaLine(
                side=ActaLineSide.RECEPCION,
                label=f"Devolucion: {item_name}",
                quantity=payload.quantity,
                unit_code=complement.unit_code,
                item_id=complement.item_id,
                source=ActaLineSource.AUTO,
                line_order=recepcion_count,
            )
        )
        self.repository.flush()
        return self._read_with_names(run)

    def _finish_run(self, run: ProductionRun, final_weight: Decimal | None) -> None:
        run.status = ProductionRunStatus.PENDING_RECEPTION
        run.finished_at = datetime.utcnow()
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
        # Peso real = cantidad menos la merma, SIEMPRE -- no el final_weight
        # crudo de "cualquiera haya sido la ultima etapa en terminar". Si esa
        # ultima etapa no pesa (ej. un control/ensamble despues de la etapa
        # que si pesa), final_weight llega None y el peso real quedaba en 0
        # aunque una etapa anterior si hubiera registrado un pesaje real
        # (bug reportado). total_waste ya suma la merma de TODAS las etapas
        # pesadas, sin importar cual termino ultimo.
        run.actual_finished_weight = (
            run.total_required_material - total_waste
            if run.total_required_material is not None
            else final_weight
        )

        # ENSAMBLAR se aplica solo con lo que ya se aprobo de cada complemento
        # (lo que Inventario de verdad entrego) -- ya se declaro una vez al
        # crear la orden, no se vuelve a pedir confirmacion aparte. Antes
        # quedaba assembly_pending=True y producción tenia que confirmar a
        # mano en "Definir ensamble"; ahora ese paso se hace solo (decision
        # de Rodrigo: "ya se lleno eso al inicio creando la orden").
        if run.assembly_mode == AssemblyMode.ASSEMBLE:
            self._auto_apply_assembly(run)

    def _auto_apply_assembly(self, run: ProductionRun) -> None:
        """Arma run.assembly_items con TODO lo aprobado de cada complemento
        (lo que Inventario de verdad entrego, ver _approved_complement_totals)
        y aprende la receta del model_key -- mismo resultado que
        define_run_assembly, pero automatico, sin esperar confirmacion."""
        approved = self._approved_complement_totals(run)
        run.assembly_items = [
            ProductionRunAssemblyItem(complement_item_id=item_id, quantity=quantity)
            for item_id, quantity in approved.items()
        ]
        run.assembly_pending = False
        if approved:
            model_key = self._model_key_for_run(run)
            if model_key is not None:
                lines = [
                    RunAssemblyLineCreate(complement_item_id=item_id, quantity=quantity)
                    for item_id, quantity in approved.items()
                ]
                self._upsert_recipe_items(model_key, lines, created_by_run_id=run.id)

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

        from backend.modules.inventory.models import InventoryItem

        approved = self._approved_complement_totals(run)
        for line in payload.items:
            item = self.repository.session.get(InventoryItem, line.complement_item_id)
            item_name = item.name if item is not None else "complemento"
            if line.complement_item_id not in approved:
                raise ProductionDomainError(
                    f"El complemento '{item_name}' no fue solicitado/aprobado en esta orden."
                )
            if line.quantity > approved[line.complement_item_id]:
                raise ProductionDomainError(
                    f"Complemento '{item_name}': el ensamble necesita {format_qty(line.quantity)} y la orden solo "
                    f"tiene {format_qty(approved[line.complement_item_id])} aprobados."
                )

        run.assembly_items = [
            ProductionRunAssemblyItem(
                complement_item_id=line.complement_item_id,
                quantity=line.quantity,
            )
            for line in payload.items
        ]
        run.assembly_pending = False

        # Receta aprendida: si la orden empata con una clave de modelo, se
        # guarda (o actualiza) esta combinación para que futuros ensambles del
        # mismo modelo se apliquen solos.
        model_key = self._model_key_for_run(run)
        if model_key is not None:
            self._upsert_recipe_items(model_key, payload.items, created_by_run_id=run.id)

        self.repository.flush()
        return self._read_with_names(run)

    def _upsert_recipe_items(
        self,
        model_key: str,
        lines: list[RunAssemblyLineCreate],
        created_by_run_id: UUID | None = None,
    ) -> None:
        """Reemplaza los items de la receta de ensamble de la clave de modelo
        (o la crea si aun no existe). Guarda la ultima cantidad total usada,
        como sugerencia de prellenado -- nunca se aplica sola.

        created_by_run_id solo se guarda al CREAR la receta (None = creada a
        mano en Mantenimiento, sin ligar a ninguna orden). Si la receta ya
        existia, esta llamada la ACTUALIZA y limpia created_by_run_id a None
        sin importar quien la esta tocando ahora: en cuanto una receta ya no
        es un dato exclusivo de la corrida que la origino -- otra corrida la
        reutilizo, o se edito a mano en Mantenimiento -- deja de ser
        candidata a borrarse sola si esa corrida original se cancela (ver
        cancel_run/_cancel_orphaned_recipe). Solo se borra sola la receta
        que nadie mas toco desde que se creo."""
        from sqlalchemy import select

        recipe = self.repository.session.execute(
            select(AssemblyRecipe).where(AssemblyRecipe.model_key == model_key)
        ).scalars().first()
        new_items = [
            AssemblyRecipeItem(
                complement_item_id=line.complement_item_id,
                quantity=line.quantity,
            )
            for line in lines
        ]
        if recipe is not None:
            recipe.items = new_items
            recipe.updated_at = datetime.utcnow()
            recipe.created_by_run_id = None
        else:
            recipe = AssemblyRecipe(model_key=model_key, items=new_items, created_by_run_id=created_by_run_id)
            self.repository.session.add(recipe)

    def list_assembly_recipe_model_keys(self) -> list[str]:
        """Claves de modelo que ya tienen receta de ensamble (para filtrar
        los pickers de asignacion)."""
        from sqlalchemy import select

        return list(
            self.repository.session.execute(
                select(AssemblyRecipe.model_key)
            ).scalars()
        )

    def list_assembly_recipes(self) -> list[AssemblyRecipeRead]:
        """Todas las recetas de ensamble con sus complementos (para la vista
        de mantenimiento)."""
        from sqlalchemy import select

        keys = self.repository.session.execute(
            select(AssemblyRecipe.model_key).order_by(AssemblyRecipe.model_key)
        ).scalars().all()
        return [self._recipe_read_for_key(key) for key in keys]

    def get_assembly_recipe(
        self,
        product_type_id: UUID | None,
        item_id: UUID | None,
        material_item_id: UUID | None = None,
    ) -> AssemblyRecipeRead:
        """Consulta la receta de ensamble aprendida para la clave de modelo de
        un tipo de producto, o para la pieza indicada (se resuelve su parte
        de modelo primero). La clave completa exige ademas la materia prima
        de la orden (material_item_id): sin ella no se puede saber a que
        material corresponde la receta, asi que se devuelve vacia (el flujo
        de creacion de orden siempre la envia)."""
        if (product_type_id is None) == (item_id is None):
            raise ProductionDomainError(
                "Indica el tipo de producto o la pieza (uno de los dos)."
            )
        if item_id is not None:
            part = self._model_part_for_piece(item_id)
        else:
            from backend.modules.product_types.models import ProductType

            product_type = self.repository.session.get(ProductType, product_type_id)
            part = None
            if product_type is not None:
                key = f"{product_type.category_code}{product_type.model_code}"
                part = key if len(key) == 6 else None
        material_code = self._material_code_for_item(material_item_id)
        if part is None or material_code is None:
            return AssemblyRecipeRead(model_key=None, items=[])
        return self._recipe_read_for_key(f"{material_code}{part}")

    def upsert_assembly_recipe(
        self, model_key: str, payload: AssemblyRecipeUpsert, current_user: CurrentUser
    ) -> AssemblyRecipeRead:
        """Crea o reemplaza manualmente la receta de ensamble de una clave de
        modelo (misma regla que la receta aprendida automaticamente)."""
        from sqlalchemy import select
        from backend.modules.inventory.models import InventoryItem

        if len(model_key) != 7 or not model_key.isdigit():
            raise ProductionDomainError("Clave de modelo inválida.")

        item_ids = [line.complement_item_id for line in payload.items]
        if len(item_ids) != len(set(item_ids)):
            raise ProductionDomainError("No repitas el mismo complemento en la receta.")

        items = self.repository.session.execute(
            select(InventoryItem).where(InventoryItem.id.in_(item_ids))
        ).scalars().all()
        items_by_id = {item.id: item for item in items}
        for line in payload.items:
            item = items_by_id.get(line.complement_item_id)
            if item is None:
                raise ProductionDomainError("El complemento indicado no existe.")
            if item.item_type != "COMPLEMENT":
                raise ProductionDomainError(f"'{item.name}' no es un complemento.")

        self._upsert_recipe_items(model_key, payload.items)
        self.repository.flush()
        return self._recipe_read_for_key(model_key)

    def delete_assembly_recipe(self, model_key: str) -> None:
        """Elimina la receta de ensamble de una clave de modelo."""
        from sqlalchemy import select

        recipe = self.repository.session.execute(
            select(AssemblyRecipe).where(AssemblyRecipe.model_key == model_key)
        ).scalars().first()
        if recipe is None:
            raise ProductionNotFoundError("Receta no encontrada.")
        self.repository.session.delete(recipe)
        self.repository.flush()

    def _recipe_read_for_key(self, model_key: str) -> AssemblyRecipeRead:
        from sqlalchemy import select
        from backend.modules.inventory.models import InventoryItem

        recipe = self.repository.session.execute(
            select(AssemblyRecipe).where(AssemblyRecipe.model_key == model_key)
        ).scalars().first()
        if recipe is None:
            return AssemblyRecipeRead(model_key=model_key, items=[])
        complement_ids = list({item.complement_item_id for item in recipe.items})
        names: dict = {}
        units: dict = {}
        materials: dict = {}
        if complement_ids:
            rows = self.repository.session.execute(
                select(InventoryItem.id, InventoryItem.name, InventoryItem.unit_code, InventoryItem.material_type).where(
                    InventoryItem.id.in_(complement_ids)
                )
            ).all()
            names = {row[0]: row[1] for row in rows}
            units = {row[0]: row[2] for row in rows}
            materials = {row[0]: row[3] for row in rows}
        items = [
            AssemblyRecipeItemRead(
                complement_item_id=item.complement_item_id,
                name=names.get(item.complement_item_id),
                unit_code=units.get(item.complement_item_id),
                material_type=materials.get(item.complement_item_id),
                quantity=item.quantity,
            )
            for item in recipe.items
        ]
        return AssemblyRecipeRead(model_key=model_key, items=items)

    def receive_finished_product(
        self, run_id: UUID, current_user: CurrentUser, payload: "ReceiveFinishedProductPayload | None" = None,
    ) -> ProductionRunRead:
        if self.inventory_service is None:
            raise ProductionDomainError("Inventario no esta disponible para recibir producto terminado.")
        run = self.repository.get_run(run_id)
        if run is None:
            raise ProductionNotFoundError("Orden de produccion no encontrada.")
        if run.status != ProductionRunStatus.PENDING_RECEPTION:
            raise ProductionDomainError("Solo se puede recibir una produccion finalizada y pendiente de recepcion.")
        if run.event_lines:
            # Corrida historica migrada (import de certificados de papel):
            # sus lineas de evento vienen del acta original, no de este flujo
            # en vivo. Recibirla aqui generaria un movimiento de inventario
            # real que el papel nunca respaldo. Ver Addendum en
            # docs/superpowers/specs/2026-08-04-certificados-historicos-design.md.
            raise ProductionDomainError("Esta orden ya tiene su acta cargada; no se puede recibir por este flujo.")
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
        # Orden de ensamble: el kardex del producto final debe contar los
        # complementos combinados, no una conversión genérica.
        assembly_note = None
        extra_grams_per_unit = None
        if run.assembly_mode == AssemblyMode.ASSEMBLE and run.assembly_items:
            from sqlalchemy import select

            item_ids = [entry.complement_item_id for entry in run.assembly_items]
            rows = self.repository.session.execute(
                select(InventoryItem).where(InventoryItem.id.in_(item_ids))
            ).all()
            complements = {row[0].id: row[0] for row in rows}
            names = {item_id: item.name for item_id, item in complements.items()}
            assembly_note = " + ".join(
                names.get(entry.complement_item_id, "complemento") for entry in run.assembly_items
            )
            # Lo devuelto (Rodrigo, 2026-08-16: "si se devuelven 5g de
            # dijes, el producto final pesa 100g + 5g, no 100g + 10g") resta
            # ACA tambien -- mismo criterio "usado = aprobado - devuelto"
            # que return_complement y returnableComplements, para que el
            # peso real del lote en inventario no cuente material que ya
            # volvio al estante.
            returned_by_item: dict = {}
            for complement in run.complements:
                returned_by_item[complement.item_id] = (
                    returned_by_item.get(complement.item_id, Decimal("0")) + complement.returned_quantity
                )
            # El ensamblado pesa lote + complementos: si el complemento se
            # mide en gramos, suma su cantidad total; si es por unidad con
            # peso_por_unidad conocido, suma cantidad x peso; sin dato de
            # peso no se inventa, no aporta.
            extra_grams = Decimal("0")
            for entry in run.assembly_items:
                item = complements.get(entry.complement_item_id)
                if item is None:
                    continue
                net_quantity = max(
                    Decimal("0"), entry.quantity - returned_by_item.get(entry.complement_item_id, Decimal("0"))
                )
                if item.unit_code == "g":
                    extra_grams += net_quantity
                elif item.weight_per_unit:
                    extra_grams += net_quantity * item.weight_per_unit
            if run.quantity and extra_grams > 0:
                extra_grams_per_unit = extra_grams / run.quantity
        for product in run.products:
            try:
                if product.target_item_id is not None:
                    target = self.repository.session.get(InventoryItem, product.target_item_id)
                    if target is not None and target.item_type == "COMPLEMENT":
                        self.inventory_service.convert_lot_to_complement(
                            lot.id, product.target_item_id, product.quantity, user_id=current_user.id
                        )
                        continue
                    conversion = LotConversionCreate(
                        target_item_id=product.target_item_id, quantity=product.quantity
                    )
                else:
                    conversion = LotConversionCreate(
                        product_type_id=product.product_type_id, quantity=product.quantity
                    )
                self.inventory_service.convert_lot_to_product(
                    lot.id,
                    conversion,
                    user_id=current_user.id,
                    assembly_note=assembly_note,
                    extra_grams_per_unit=extra_grams_per_unit,
                )
            except (InventoryDomainError, InventoryNotFoundError) as exc:
                raise ProductionDomainError(
                    f"No se pudo convertir el lote al producto planificado: {exc}"
                ) from exc

        if run.waste_weight and run.waste_weight > 0:
            if payload and payload.waste_item_id:
                waste_item = self.repository.session.get(InventoryItem, payload.waste_item_id)
                if waste_item is None or waste_item.item_type != "WASTE":
                    raise ProductionDomainError("El item de destino de merma no es valido.")
            elif payload and payload.waste_item_name and payload.waste_item_name.strip():
                waste_item = self.inventory_service.ensure_production_item(
                    item_type="WASTE",
                    name=payload.waste_item_name.strip(),
                    unit_code=run.raw_material_unit_code,
                )
            else:
                waste_item = self.inventory_service.ensure_production_item(
                    item_type="WASTE", name=f"Merma {run.process_name}", unit_code=run.raw_material_unit_code,
                )
            # ensure_production_item reutiliza un item existente por nombre
            # (case-insensitive) sin validar su unidad: la unidad solo se usa
            # al crear. Por eso la validacion vive aqui, cubriendo los tres
            # caminos (id explicito, nombre explicito, nombre automatico) en
            # un solo lugar en vez de repetirla por rama.
            if waste_item.unit_code != run.raw_material_unit_code:
                raise ProductionDomainError(
                    f"El item de destino de merma usa una unidad distinta "
                    f"({waste_item.unit_code} vs {run.raw_material_unit_code})."
                )
            self.inventory_service.create_movement(
                InventoryMovementCreate(
                    item_id=waste_item.id,
                    movement_type="INGRESO_PRODUCCION",
                    quantity=run.waste_weight,
                    reason=f"Merma recibida de {run.production_code or run.id}",
                    reference_type="production_run",
                    reference_id=run.id,
                ),
                user_id=current_user.id,
                lot_code=run.production_code,
            )

        # Con productos declarados (run.products), productoRealLines en el
        # frontend (frontend/lib/orden-produccion.ts) ya reconstruye este
        # mismo peso a partir de actual_finished_weight repartido entre los
        # productos -- esta linea AUTO quedaria duplicando el numero en
        # "Total recibido" (bug encontrado en review final, commits
        # d3c2787..7b4b2ef). Solo aporta valor para ordenes SIN productos
        # declarados (viejas/sin plan de resultantes), donde es el unico
        # registro del peso recibido.
        if run.actual_finished_weight is not None and not run.products:
            recepcion_count = sum(1 for line in run.acta_lines if line.side == ActaLineSide.RECEPCION)
            run.acta_lines.append(
                ProductionRunActaLine(
                    side=ActaLineSide.RECEPCION,
                    label="Peso final recibido",
                    quantity=run.actual_finished_weight,
                    unit_code=run.raw_material_unit_code,
                    item_id=run.raw_material_item_id,
                    source=ActaLineSource.AUTO,
                    line_order=recepcion_count,
                )
            )

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

