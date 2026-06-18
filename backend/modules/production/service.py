from datetime import datetime, timedelta
from decimal import Decimal
from uuid import UUID

from backend.modules.auth.dependencies import CurrentUser
from backend.modules.inventory.schemas import InventoryMovementCreate
from backend.modules.inventory.service import InventoryDomainError, InventoryService
from backend.modules.production.models import (
    ProductionProcess,
    ProductionProcessStage,
    ProductionRun,
    ProductionRunStage,
    ProductionRunStageStatus,
    ProductionRunStatus,
)
from backend.modules.production.repository import ProductionProcessRepository
from backend.modules.production.schemas import (
    ProductionProcessCreate,
    ProductionProcessRead,
    ProductionProcessUpdate,
    ProductionRunCreate,
    ProductionRunRead,
    ProductionRunStageFinish,
)


class ProductionDomainError(ValueError):
    pass


class ProductionNotFoundError(LookupError):
    pass


class ProductionService:
    def __init__(self, repository: ProductionProcessRepository, inventory_service: InventoryService | None = None) -> None:
        self.repository = repository
        self.inventory_service = inventory_service

    def create_process(self, payload: ProductionProcessCreate) -> ProductionProcessRead:
        self._ensure_unique_stage_order(payload.stages)
        self._ensure_material_configuration(payload.raw_material_item_id, payload.raw_material_quantity_per_unit)

        process = ProductionProcess(
            name=payload.name,
            description=payload.description,
            version=payload.version,
            raw_material_item_id=payload.raw_material_item_id,
            raw_material_quantity_per_unit=payload.raw_material_quantity_per_unit,
            raw_material_unit_code=payload.raw_material_unit_code,
            waste_limit_percent=payload.waste_limit_percent,
            is_active=payload.is_active,
            stages=[
                ProductionProcessStage(
                    name=stage.name,
                    description=stage.description,
                    stage_order=stage.order,
                    estimated_minutes=stage.estimated_minutes,
                    requires_weighing=stage.requires_weighing,
                    is_active=stage.is_active,
                )
                for stage in payload.stages
            ],
        )
        self.repository.add(process)
        self.repository.flush()
        return ProductionProcessRead.model_validate(process)

    def list_processes(self) -> list[ProductionProcessRead]:
        return [ProductionProcessRead.model_validate(process) for process in self.repository.list()]

    def update_process(self, process_id: UUID, payload: ProductionProcessUpdate) -> ProductionProcessRead:
        self._ensure_unique_stage_order(payload.stages)
        self._ensure_material_configuration(payload.raw_material_item_id, payload.raw_material_quantity_per_unit)
        process = self.repository.get(process_id)
        if process is None:
            raise ProductionNotFoundError("Proceso no encontrado.")

        process.name = payload.name
        process.description = payload.description
        process.version = payload.version
        process.raw_material_item_id = payload.raw_material_item_id
        process.raw_material_quantity_per_unit = payload.raw_material_quantity_per_unit
        process.raw_material_unit_code = payload.raw_material_unit_code
        process.waste_limit_percent = payload.waste_limit_percent
        process.is_active = payload.is_active
        process.stages = [
            ProductionProcessStage(
                name=stage.name,
                description=stage.description,
                stage_order=stage.order,
                estimated_minutes=stage.estimated_minutes,
                requires_weighing=stage.requires_weighing,
                is_active=stage.is_active,
            )
            for stage in payload.stages
        ]
        self.repository.flush()
        return ProductionProcessRead.model_validate(process)

    def delete_process(self, process_id: UUID) -> None:
        process = self.repository.get(process_id)
        if process is None:
            raise ProductionNotFoundError("Proceso no encontrado.")
        self.repository.delete(process)

    def seed_demo_processes(self) -> None:
        if self.inventory_service is None:
            return

        gold = self.inventory_service.ensure_production_item(
            item_type="RAW_MATERIAL",
            name="Oro 18K demo",
            unit_code="g",
        )
        if gold.current_stock <= 0:
            self.inventory_service.create_movement(
                InventoryMovementCreate(
                    item_id=gold.id,
                    movement_type="ENTRADA",
                    quantity=Decimal("1000"),
                    reason="Stock inicial demo para produccion.",
                ),
                user_id=None,
            )

        demo_processes = (
            ("Monedas de oro", "Proceso demo editable para fabricar monedas.", Decimal("8.5000")),
            ("Cadenas de oro", "Proceso demo editable para fabricar cadenas.", Decimal("12.0000")),
        )
        existing_by_name = {process.name.strip().lower(): process for process in self.repository.list()}
        for name, description, material_per_unit in demo_processes:
            existing = existing_by_name.get(name.lower())
            if existing is not None:
                existing.raw_material_item_id = gold.id
                existing.raw_material_quantity_per_unit = material_per_unit
                existing.raw_material_unit_code = gold.unit_code
                existing.waste_limit_percent = Decimal("4")
                continue
            self.create_process(
                ProductionProcessCreate(
                    name=name,
                    description=description,
                    raw_material_item_id=gold.id,
                    raw_material_quantity_per_unit=material_per_unit,
                    raw_material_unit_code=gold.unit_code,
                    waste_limit_percent=Decimal("4"),
                    stages=[
                        {"name": "Preparacion", "order": 1, "estimated_minutes": 20, "requires_weighing": True},
                        {"name": "Trabajo principal", "order": 2, "estimated_minutes": 45, "requires_weighing": True},
                        {"name": "Control final", "order": 3, "estimated_minutes": 15, "requires_weighing": True},
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
        if process.raw_material_item_id is None or process.raw_material_quantity_per_unit is None:
            raise ProductionDomainError("El proceso no tiene materia prima por unidad configurada.")

        active_stages = [stage for stage in process.stages if stage.is_active]
        if not active_stages:
            raise ProductionDomainError("El proceso debe tener al menos una etapa activa.")

        started_at = datetime.utcnow()
        total_required = process.raw_material_quantity_per_unit * payload.quantity
        run = ProductionRun(
            process_id=process.id,
            process_name=process.name,
            quantity=payload.quantity,
            raw_material_item_id=process.raw_material_item_id,
            raw_material_quantity_per_unit=process.raw_material_quantity_per_unit,
            raw_material_unit_code=process.raw_material_unit_code or "",
            total_required_material=total_required,
            waste_limit_percent=process.waste_limit_percent,
            expected_finished_weight=total_required,
            created_by_user_id=current_user.id,
            started_at=started_at,
        )

        next_start = started_at
        for index, stage in enumerate(sorted(active_stages, key=lambda item: item.stage_order)):
            estimated = stage.estimated_minutes or 0
            next_finish = next_start + timedelta(minutes=estimated)
            run.stages.append(
                ProductionRunStage(
                    source_stage_id=stage.id,
                    stage_name=stage.name,
                    stage_order=stage.stage_order,
                    estimated_minutes=stage.estimated_minutes,
                    requires_weighing=stage.requires_weighing,
                    status=ProductionRunStageStatus.IN_PROGRESS if index == 0 else ProductionRunStageStatus.PENDING,
                    scheduled_start_at=next_start,
                    scheduled_finish_at=next_finish,
                    started_at=started_at if index == 0 else None,
                )
            )
            next_start = next_finish

        self.repository.add_run(run)
        self.repository.flush()
        try:
            self.inventory_service.reserve_materials_for_production(
                production_order_id=run.id,
                requirements=(),
            )
            self.inventory_service.consume_material_for_production(
                item_id=run.raw_material_item_id,
                quantity=run.total_required_material,
                production_run_id=run.id,
                user_id=current_user.id,
            )
        except InventoryDomainError as exc:
            raise ProductionDomainError(str(exc)) from exc
        self.repository.flush()
        return ProductionRunRead.model_validate(run)

    def list_runs(self) -> list[ProductionRunRead]:
        return [ProductionRunRead.model_validate(run) for run in self.repository.list_runs()]

    def finish_stage(self, stage_id: UUID, payload: ProductionRunStageFinish) -> ProductionRunRead:
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
        scheduled_finish_at = stage.scheduled_finish_at.replace(tzinfo=None) if stage.scheduled_finish_at else None
        if scheduled_finish_at and now < scheduled_finish_at and not payload.confirm_early_finish:
            raise ProductionDomainError("La etapa esta terminando antes del tiempo estimado. Confirma para continuar.")

        if stage.status == ProductionRunStageStatus.PENDING:
            stage.status = ProductionRunStageStatus.IN_PROGRESS
            stage.started_at = now

        stage.initial_weight = payload.initial_weight
        stage.final_weight = payload.final_weight
        stage.finished_at = now
        stage.status = ProductionRunStageStatus.FINISHED

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
            return ProductionRunRead.model_validate(run)

        self._finish_run(run, payload.final_weight)
        self.repository.flush()
        return ProductionRunRead.model_validate(run)

    def _finish_run(self, run: ProductionRun, final_weight: Decimal | None) -> None:
        finished_item = self.inventory_service.ensure_production_item(
            item_type="FINISHED_PRODUCT",
            name=run.process_name,
            unit_code="und",
        )
        self.inventory_service.commit_finished_production(
            production_order_id=run.id,
            finished_product_id=finished_item.id,
            finished_quantity=run.quantity,
        )
        run.status = ProductionRunStatus.FINISHED
        run.finished_at = datetime.utcnow()
        run.actual_finished_weight = final_weight
        if final_weight is not None:
            waste = max(Decimal("0"), run.expected_finished_weight - final_weight)
            run.waste_weight = waste
            run.waste_percent = (waste / run.expected_finished_weight * Decimal("100")) if run.expected_finished_weight else Decimal("0")

    @staticmethod
    def _ensure_unique_stage_order(stages: list) -> None:
        stage_orders = [stage.order for stage in stages]
        if len(stage_orders) != len(set(stage_orders)):
            raise ProductionDomainError("El orden de las etapas no puede repetirse.")

    @staticmethod
    def _ensure_material_configuration(item_id: UUID | None, quantity_per_unit: Decimal | None) -> None:
        if (item_id is None) != (quantity_per_unit is None):
            raise ProductionDomainError("Configura materia prima y cantidad por unidad juntas.")
