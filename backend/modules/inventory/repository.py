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

    def delete_item(self, item: InventoryItem) -> None:
        self.session.delete(item)

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

    def delete_movement(self, movement: InventoryMovement) -> None:
        self.session.delete(movement)

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

    def count_entrada_movements_for_item_this_year(self, item_id, year: int) -> int:
        from sqlalchemy import extract, func
        from backend.modules.inventory.models import InventoryMovement
        result = self.session.execute(
            select(func.count(InventoryMovement.id)).where(
                InventoryMovement.item_id == item_id,
                InventoryMovement.movement_type == "ENTRADA",
                extract("year", InventoryMovement.created_at) == year,
            )
        ).scalar_one_or_none()
        return int(result or 0)

    def flush(self) -> None:
        self.session.flush()
