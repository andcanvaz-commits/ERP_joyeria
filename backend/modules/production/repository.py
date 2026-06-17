from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import selectinload
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
        statement = (
            select(ProductionOrder)
            .where(ProductionOrder.id == order_id)
            .options(selectinload(ProductionOrder.stages))
        )
        return self.session.execute(statement).scalar_one_or_none()

    def list_orders(
        self,
        *,
        status: str | None = None,
        product_id: UUID | None = None,
        limit: int = 50,
        offset: int = 0,
    ) -> list[ProductionOrder]:
        statement = (
            select(ProductionOrder)
            .options(selectinload(ProductionOrder.stages))
            .order_by(ProductionOrder.created_at.desc())
            .limit(limit)
            .offset(offset)
        )
        if status is not None:
            statement = statement.where(ProductionOrder.status == status)
        if product_id is not None:
            statement = statement.where(ProductionOrder.product_id == product_id)
        return list(self.session.execute(statement).scalars().all())

    def get_process_template(self, process_template_id: UUID) -> ProcessTemplate | None:
        statement = (
            select(ProcessTemplate)
            .where(ProcessTemplate.id == process_template_id)
            .options(selectinload(ProcessTemplate.stages))
        )
        return self.session.execute(statement).scalar_one_or_none()

    def list_process_templates(
        self,
        *,
        product_id: UUID | None = None,
        is_active: bool | None = None,
        limit: int = 50,
        offset: int = 0,
    ) -> list[ProcessTemplate]:
        statement = (
            select(ProcessTemplate)
            .options(selectinload(ProcessTemplate.stages))
            .order_by(ProcessTemplate.name.asc(), ProcessTemplate.version.desc())
            .limit(limit)
            .offset(offset)
        )
        if product_id is not None:
            statement = statement.where(ProcessTemplate.product_id == product_id)
        if is_active is not None:
            statement = statement.where(ProcessTemplate.is_active == is_active)
        return list(self.session.execute(statement).scalars().all())

    def get_stage(self, stage_id: UUID) -> ProductionOrderStage | None:
        return self.session.get(ProductionOrderStage, stage_id)

    def flush(self) -> None:
        self.session.flush()
