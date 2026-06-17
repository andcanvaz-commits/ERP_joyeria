from uuid import UUID

from sqlalchemy.orm import Session

from backend.modules.production.models import ProcessTemplate, ProductionOrder, ProductionOrderStage


class ProductionOrderRepository:
    def __init__(self, session: Session) -> None:
        self.session = session

    def add(self, order: ProductionOrder) -> ProductionOrder:
        self.session.add(order)
        return order

    def add_process_template(self, process_template: ProcessTemplate) -> ProcessTemplate:
        self.session.add(process_template)
        return process_template

    def get(self, order_id: UUID) -> ProductionOrder | None:
        return self.session.get(ProductionOrder, order_id)

    def get_process_template(self, process_template_id: UUID) -> ProcessTemplate | None:
        return self.session.get(ProcessTemplate, process_template_id)

    def get_stage(self, stage_id: UUID) -> ProductionOrderStage | None:
        return self.session.get(ProductionOrderStage, stage_id)

    def flush(self) -> None:
        self.session.flush()
