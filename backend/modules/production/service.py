from datetime import datetime
from uuid import UUID

from backend.modules.auth.dependencies import CurrentUser
from backend.modules.production.models import (
    ProcessTemplate,
    ProcessTemplateStage,
    ProductionOrder,
    ProductionOrderStage,
    ProductionOrderStatus,
    ProductionStageStatus,
)
from backend.modules.production.repository import ProductionOrderRepository
from backend.modules.production.schemas import (
    ProcessTemplateCreate,
    ProcessTemplateRead,
    ProductionOrderCreate,
    ProductionOrderRead,
    ProductionStageFinish,
    ProductionStageStart,
)
from backend.modules.shared.contracts.inventory import InventoryIntegrationPort


class ProductionDomainError(ValueError):
    pass


class ProductionService:
    def __init__(
        self,
        repository: ProductionOrderRepository,
        inventory_port: InventoryIntegrationPort,
    ) -> None:
        self.repository = repository
        self.inventory_port = inventory_port

    def create_process_template(self, payload: ProcessTemplateCreate) -> ProcessTemplateRead:
        self._ensure_unique_stage_order(payload.stages)

        process_template = ProcessTemplate(
            name=payload.name,
            description=payload.description,
            product_id=payload.product_id,
            version=payload.version,
            is_active=payload.is_active,
            stages=[
                ProcessTemplateStage(
                    name=stage.name,
                    description=stage.description,
                    stage_order=stage.order,
                    estimated_minutes=stage.estimated_minutes,
                    requires_initial_weight=stage.requires_initial_weight,
                    requires_final_weight=stage.requires_final_weight,
                    allows_waste=stage.allows_waste,
                    requires_observation=stage.requires_observation,
                    is_required=stage.is_required,
                    is_active=stage.is_active,
                )
                for stage in payload.stages
            ],
        )
        self.repository.add_process_template(process_template)
        self.repository.flush()
        return ProcessTemplateRead.model_validate(process_template)

    def create_order(self, payload: ProductionOrderCreate, current_user: CurrentUser) -> ProductionOrderRead:
        process_template = self.repository.get_process_template(payload.process_template_id)
        if process_template is None:
            raise ProductionDomainError("Process template not found.")
        if not process_template.is_active:
            raise ProductionDomainError("Process template is not active.")
        if process_template.product_id is not None and process_template.product_id != payload.product_id:
            raise ProductionDomainError("Process template is not valid for the selected product.")

        active_stages = [stage for stage in process_template.stages if stage.is_active]
        if not active_stages:
            raise ProductionDomainError("Process template must have at least one active stage.")

        ordered_stages = sorted(active_stages, key=lambda stage: stage.stage_order)
        order = ProductionOrder(
            product_id=payload.product_id,
            process_template_id=payload.process_template_id,
            quantity=payload.quantity,
            status=ProductionOrderStatus.PENDING,
            notes=payload.notes,
            created_by_user_id=current_user.id,
            process_snapshot=self._build_process_snapshot(process_template, ordered_stages),
            stages=[
                ProductionOrderStage(
                    source_stage_id=stage.id,
                    stage_name=stage.name,
                    stage_description=stage.description,
                    stage_order=stage.stage_order,
                    estimated_minutes=stage.estimated_minutes,
                    requires_initial_weight=stage.requires_initial_weight,
                    requires_final_weight=stage.requires_final_weight,
                    allows_waste=stage.allows_waste,
                    requires_observation=stage.requires_observation,
                    is_required=stage.is_required,
                )
                for stage in ordered_stages
            ],
        )
        self.repository.add(order)
        self.repository.flush()
        return ProductionOrderRead.model_validate(order)

    def start_order(self, order_id: UUID, current_user: CurrentUser) -> ProductionOrderRead:
        order = self.repository.get(order_id)
        if order is None:
            raise ProductionDomainError("Production order not found.")
        if order.status not in {ProductionOrderStatus.DRAFT, ProductionOrderStatus.PENDING}:
            raise ProductionDomainError("Production order cannot be started from its current status.")

        order.status = ProductionOrderStatus.IN_PROGRESS
        order.started_by_user_id = current_user.id
        order.started_at = datetime.utcnow()
        order.updated_at = datetime.utcnow()
        return ProductionOrderRead.model_validate(order)

    def finish_order(self, order_id: UUID) -> ProductionOrderRead:
        order = self.repository.get(order_id)
        if order is None:
            raise ProductionDomainError("Production order not found.")
        if order.status != ProductionOrderStatus.IN_PROGRESS:
            raise ProductionDomainError("Only in-progress production orders can be finished.")

        unfinished_required_stages = [
            stage
            for stage in order.stages
            if stage.is_required and stage.status != ProductionStageStatus.FINISHED
        ]
        if unfinished_required_stages:
            raise ProductionDomainError("All required production stages must be finished first.")

        self.inventory_port.commit_finished_production(
            production_order_id=order.id,
            finished_product_id=order.product_id,
            finished_quantity=order.quantity,
        )
        order.status = ProductionOrderStatus.FINISHED
        order.finished_at = datetime.utcnow()
        order.updated_at = datetime.utcnow()
        return ProductionOrderRead.model_validate(order)

    def start_stage(self, stage_id: UUID, payload: ProductionStageStart) -> ProductionOrderRead:
        stage = self.repository.get_stage(stage_id)
        if stage is None:
            raise ProductionDomainError("Production stage not found.")
        order = stage.order
        if order.status != ProductionOrderStatus.IN_PROGRESS:
            raise ProductionDomainError("Production stage can only start when the order is in progress.")
        if stage.status != ProductionStageStatus.PENDING:
            raise ProductionDomainError("Production stage cannot be started from its current status.")
        if stage.requires_initial_weight and payload.initial_weight is None:
            raise ProductionDomainError("Initial weight is required for this production stage.")

        stage.status = ProductionStageStatus.IN_PROGRESS
        stage.initial_weight = payload.initial_weight
        stage.observations = payload.observations
        stage.started_at = datetime.utcnow()
        order.updated_at = datetime.utcnow()
        return ProductionOrderRead.model_validate(order)

    def finish_stage(self, stage_id: UUID, payload: ProductionStageFinish) -> ProductionOrderRead:
        stage = self.repository.get_stage(stage_id)
        if stage is None:
            raise ProductionDomainError("Production stage not found.")
        if stage.status != ProductionStageStatus.IN_PROGRESS:
            raise ProductionDomainError("Production stage cannot be finished from its current status.")
        if stage.requires_final_weight and payload.final_weight is None:
            raise ProductionDomainError("Final weight is required for this production stage.")
        if stage.allows_waste is False and payload.waste_weight is not None:
            raise ProductionDomainError("Waste cannot be registered for this production stage.")
        if stage.requires_observation and not payload.observations:
            raise ProductionDomainError("Observations are required for this production stage.")

        stage.status = ProductionStageStatus.FINISHED
        stage.final_weight = payload.final_weight
        stage.waste_weight = payload.waste_weight
        stage.observations = payload.observations
        stage.finished_at = datetime.utcnow()
        stage.order.updated_at = datetime.utcnow()
        return ProductionOrderRead.model_validate(stage.order)

    @staticmethod
    def _ensure_unique_stage_order(stages: list) -> None:
        stage_orders = [stage.order for stage in stages]
        if len(stage_orders) != len(set(stage_orders)):
            raise ProductionDomainError("Process template stage order values must be unique.")

    @staticmethod
    def _build_process_snapshot(
        process_template: ProcessTemplate,
        stages: list[ProcessTemplateStage],
    ) -> dict:
        return {
            "process_template_id": str(process_template.id),
            "name": process_template.name,
            "description": process_template.description,
            "version": process_template.version,
            "stages": [
                {
                    "source_stage_id": str(stage.id),
                    "name": stage.name,
                    "description": stage.description,
                    "order": stage.stage_order,
                    "estimated_minutes": stage.estimated_minutes,
                    "requires_initial_weight": stage.requires_initial_weight,
                    "requires_final_weight": stage.requires_final_weight,
                    "allows_waste": stage.allows_waste,
                    "requires_observation": stage.requires_observation,
                    "is_required": stage.is_required,
                }
                for stage in stages
            ],
        }
