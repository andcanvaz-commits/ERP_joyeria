from backend.modules.production.models import ProductionProcess, ProductionProcessStage
from backend.modules.production.repository import ProductionProcessRepository
from uuid import UUID

from backend.modules.production.schemas import ProductionProcessCreate, ProductionProcessRead, ProductionProcessUpdate


class ProductionDomainError(ValueError):
    pass


class ProductionNotFoundError(LookupError):
    pass


class ProductionService:
    def __init__(self, repository: ProductionProcessRepository) -> None:
        self.repository = repository

    def create_process(self, payload: ProductionProcessCreate) -> ProductionProcessRead:
        self._ensure_unique_stage_order(payload.stages)

        process = ProductionProcess(
            name=payload.name,
            description=payload.description,
            version=payload.version,
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
        process = self.repository.get(process_id)
        if process is None:
            raise ProductionNotFoundError("Proceso no encontrado.")

        process.name = payload.name
        process.description = payload.description
        process.version = payload.version
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

    @staticmethod
    def _ensure_unique_stage_order(stages: list) -> None:
        stage_orders = [stage.order for stage in stages]
        if len(stage_orders) != len(set(stage_orders)):
            raise ProductionDomainError("El orden de las etapas no puede repetirse.")
