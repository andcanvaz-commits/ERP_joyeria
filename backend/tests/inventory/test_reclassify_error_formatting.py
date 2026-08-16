from decimal import Decimal
from uuid import uuid4

import pytest

from backend.modules.inventory.models import InventoryItem, InventoryMovement
from backend.modules.inventory.repository import InventoryRepository
from backend.modules.inventory.service import InventoryDomainError, InventoryService


@pytest.fixture()
def inventory_service(db_session) -> InventoryService:
    return InventoryService(repository=InventoryRepository(db_session))


def _make_waste_item(db_session, name, stock):
    item = InventoryItem(
        item_type="WASTE", name=name, sku=f"ME-TEST-{uuid4().hex[:8]}", unit_code="g",
        current_stock=Decimal(stock),
    )
    db_session.add(item)
    db_session.flush()
    return item


def _make_ingreso_produccion_movement(db_session, item, quantity, run_id):
    movement = InventoryMovement(
        item_id=item.id, movement_type="INGRESO_PRODUCCION", quantity=Decimal(quantity), unit_code=item.unit_code,
        reason="Merma recibida de OP-TEST-0001", reference_type="production_run", reference_id=run_id,
    )
    db_session.add(movement)
    db_session.flush()
    return movement


def test_reclassify_waste_error_strips_trailing_decimal_zeros(db_session, inventory_service):
    source = _make_waste_item(db_session, "Merma Cadenas", "10.5000")
    target = _make_waste_item(db_session, "Merma Medallas", 0)
    movement = _make_ingreso_produccion_movement(db_session, source, 20, uuid4())

    with pytest.raises(InventoryDomainError) as exc_info:
        inventory_service.reclassify_waste_movement(
            movement.id, target_item_id=target.id, quantity=None, user_id=None
        )

    message = str(exc_info.value)
    assert "10.5 " in message
    assert "10.5000" not in message
