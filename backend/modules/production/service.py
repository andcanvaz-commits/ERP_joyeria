from datetime import datetime
from uuid import UUID

from backend.modules.auth.dependencies import CurrentUser
from backend.modules.production.models import ProductionOrder, ProductionOrderStatus
from backend.modules.production.repository import ProductionOrderRepository
from backend.modules.production.schemas import ProductionOrderCreate, ProductionOrderRead
from backend.modules.shared.contracts.inventory import InventoryIntegrationPort


class ProductionService:
    def __init__(
        self,
        repository: ProductionOrderRepository,
        inventory_port: InventoryIntegrationPort,
    ) -> None:
        self.repository = repository
        self.inventory_port = inventory_port

    def create_order(self, payload: ProductionOrderCreate, current_user: CurrentUser) -> ProductionOrderRead:
        order = ProductionOrder(
            product_id=payload.product_id,
            process_template_id=payload.process_template_id,
            quantity=payload.quantity,
            notes=payload.notes,
            created_by_user_id=current_user.id,
            process_snapshot={},
        )
        self.repository.add(order)
        return ProductionOrderRead.model_validate(order)

    def start_order(self, order_id: UUID, current_user: CurrentUser) -> ProductionOrderRead:
        order = self.repository.get(order_id)
        if order is None:
            raise ValueError("Production order not found.")
        if order.status not in {ProductionOrderStatus.DRAFT, ProductionOrderStatus.PENDING}:
            raise ValueError("Production order cannot be started from its current status.")

        order.status = ProductionOrderStatus.IN_PROGRESS
        order.started_by_user_id = current_user.id
        order.started_at = datetime.utcnow()
        return ProductionOrderRead.model_validate(order)
