from uuid import UUID

from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from backend.modules.inventory.models import InventoryItem, InventoryMovement


class InventoryRepository:
    def __init__(self, session: Session) -> None:
        self.session = session

    def add_item(self, item: InventoryItem) -> InventoryItem:
        self.session.add(item)
        return item

    def get_item(self, item_id: UUID) -> InventoryItem | None:
        return self.session.get(InventoryItem, item_id)

    def get_item_by_sku(self, sku: str) -> InventoryItem | None:
        statement = select(InventoryItem).where(InventoryItem.sku == sku)
        return self.session.execute(statement).scalar_one_or_none()

    def get_movement(self, movement_id: UUID) -> InventoryMovement | None:
        return self.session.get(InventoryMovement, movement_id)

    def list_items(self, item_type: str | None = None) -> list[InventoryItem]:
        statement = select(InventoryItem).order_by(InventoryItem.item_type.asc(), InventoryItem.name.asc())
        if item_type:
            statement = statement.where(InventoryItem.item_type == item_type)
        return list(self.session.execute(statement).scalars().all())

    def add_movement(self, movement: InventoryMovement) -> InventoryMovement:
        self.session.add(movement)
        return movement

    def list_movements(self, item_id: UUID | None = None) -> list[InventoryMovement]:
        statement = (
            select(InventoryMovement)
            .options(selectinload(InventoryMovement.item))
            .order_by(InventoryMovement.created_at.desc())
        )
        if item_id:
            statement = statement.where(InventoryMovement.item_id == item_id)
        return list(self.session.execute(statement).scalars().all())

    def flush(self) -> None:
        self.session.flush()
