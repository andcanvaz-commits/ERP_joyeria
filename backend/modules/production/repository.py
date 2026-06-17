from uuid import UUID

from sqlalchemy.orm import Session

from backend.modules.production.models import ProductionOrder


class ProductionOrderRepository:
    def __init__(self, session: Session) -> None:
        self.session = session

    def add(self, order: ProductionOrder) -> ProductionOrder:
        self.session.add(order)
        return order

    def get(self, order_id: UUID) -> ProductionOrder | None:
        return self.session.get(ProductionOrder, order_id)
