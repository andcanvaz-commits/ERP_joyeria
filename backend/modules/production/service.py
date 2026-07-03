from datetime import datetime
from decimal import Decimal
from uuid import UUID

from backend.modules.auth.dependencies import CurrentUser
from backend.modules.inventory.schemas import InventoryMovementCreate
from backend.modules.inventory.service import InventoryDomainError, InventoryService
from backend.modules.production.models import (
    ProductionProcess,
    ProductionProcessMaterial,
    ProductionProcessStage,
    ProductionProcessStageIngredient,
    ProductionRun,
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

    def create_process(self, payload: ProductionProcessCreate) -> ProductionProcessRead:
        self._ensure_unique_stage_order(payload.stages)
        self._validate_materials(payload.materials)

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
        )
        self.repository.add(process)
        self.repository.flush()
        return ProductionProcessRead.model_validate(process)

    def list_processes(self) -> list[ProductionProcessRead]:
        return [ProductionProcessRead.model_validate(process) for process in self.repository.list()]

    def update_process(self, process_id: UUID, payload: ProductionProcessUpdate) -> ProductionProcessRead:
        self._ensure_unique_stage_order(payload.stages)
        self._validate_materials(payload.materials)
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
        self.repository.flush()
        return ProductionProcessRead.model_validate(process)

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

        # Solo se puede fabricar con un material configurado en el proceso.
        selected = next(
            (m for m in process.materials if m.inventory_item_id == payload.raw_material_item_id),
            None,
        )
        if selected is None:
            raise ProductionDomainError(
                "El material seleccionado no esta configurado en este proceso."
            )

        active_stages = [stage for stage in process.stages if stage.is_active]
        if not active_stages:
            raise ProductionDomainError("El proceso debe tener al menos una etapa activa.")

        total_required = selected.quantity_per_unit * payload.quantity
        run = ProductionRun(
            process_id=process.id,
            process_name=process.name,
            quantity=payload.quantity,
            status=ProductionRunStatus.PENDING_INVENTORY,
            raw_material_item_id=selected.inventory_item_id,
            raw_material_quantity_per_unit=selected.quantity_per_unit,
            raw_material_unit_code=selected.unit_code,
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

        self.repository.add_run(run)
        self.repository.flush()
        self.inventory_service.reserve_materials_for_production(
            production_order_id=run.id,
            requirements=(),
        )
        self.repository.flush()
        return ProductionRunRead.model_validate(run)

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

    def _read_with_names(self, run: ProductionRun) -> ProductionRunRead:
        read = ProductionRunRead.model_validate(run)
        _populate_run_names(self.repository.session, [read], [run])
        return read

    def list_runs(self) -> list[ProductionRunRead]:
        runs = self.repository.list_runs()
        reads = [ProductionRunRead.model_validate(run) for run in runs]
        _populate_run_names(self.repository.session, reads, runs)
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

    def receive_finished_product(self, run_id: UUID, current_user: CurrentUser) -> ProductionRunRead:
        if self.inventory_service is None:
            raise ProductionDomainError("Inventario no esta disponible para recibir producto terminado.")
        run = self.repository.get_run(run_id)
        if run is None:
            raise ProductionNotFoundError("Orden de produccion no encontrada.")
        if run.status != ProductionRunStatus.PENDING_RECEPTION:
            raise ProductionDomainError("Solo se puede recibir una produccion finalizada y pendiente de recepcion.")

        self.inventory_service.create_finished_product_lot(
            name=run.process_name,
            unit_code="und",
            production_order_id=run.id,
            production_code=run.production_code,
            quantity=run.quantity,
            received_by_user_id=current_user.id,
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
            if item_type != "RAW_MATERIAL":
                raise ProductionDomainError(
                    "Solo se pueden usar materias primas del inventario."
                )
