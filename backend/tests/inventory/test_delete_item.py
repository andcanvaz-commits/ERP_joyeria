"""delete_item ya no debe borrar el historial de movimientos del item: si
tiene alguno (aunque el stock este en cero), el borrado se rechaza y hay que
archivar en su lugar. Solo se puede eliminar de verdad un item que nunca
tuvo movimiento (alta por error)."""
from decimal import Decimal
from uuid import uuid4

import pytest

from backend.modules.inventory.models import InventoryItem, InventoryMovement
from backend.modules.inventory.repository import InventoryRepository
from backend.modules.inventory.service import InventoryDomainError, InventoryService


@pytest.fixture()
def inventory_service(db_session) -> InventoryService:
    return InventoryService(repository=InventoryRepository(db_session))


def _raw_material(db_session, stock="0") -> InventoryItem:
    item = InventoryItem(
        item_type="RAW_MATERIAL",
        name=f"MP test {uuid4().hex[:6]}",
        sku=f"MP-TEST-{uuid4().hex[:8]}",
        unit_code="g",
        current_stock=Decimal(stock),
    )
    db_session.add(item)
    db_session.flush()
    return item


def test_delete_item_succeeds_when_no_movements(db_session, inventory_service):
    item = _raw_material(db_session, stock="0")

    inventory_service.delete_item(item.id)
    db_session.flush()

    assert db_session.get(InventoryItem, item.id) is None


def test_delete_item_blocked_when_has_movements_even_with_zero_stock(db_session, inventory_service):
    item = _raw_material(db_session, stock="0")
    movement = InventoryMovement(
        item_id=item.id, movement_type="ENTRADA", quantity=Decimal("5"), unit_code="g",
        reason="Entrada test",
    )
    db_session.add(movement)
    exit_movement = InventoryMovement(
        item_id=item.id, movement_type="SALIDA", quantity=Decimal("5"), unit_code="g",
        reason="Salida test",
    )
    db_session.add(exit_movement)
    db_session.flush()

    with pytest.raises(InventoryDomainError, match="movimientos"):
        inventory_service.delete_item(item.id)

    # El item y su historial siguen intactos.
    assert db_session.get(InventoryItem, item.id) is not None
    assert len(inventory_service.repository.list_movements(item.id)) == 2


def test_delete_item_still_blocked_when_stock_positive(db_session, inventory_service):
    item = _raw_material(db_session, stock="3")

    with pytest.raises(InventoryDomainError, match="stock"):
        inventory_service.delete_item(item.id)
