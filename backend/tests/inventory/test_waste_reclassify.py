from decimal import Decimal

import pytest

from backend.modules.inventory.repository import InventoryRepository
from backend.modules.inventory.service import InventoryDomainError, InventoryNotFoundError, InventoryService


@pytest.fixture()
def inventory_service(db_session) -> InventoryService:
    return InventoryService(repository=InventoryRepository(db_session))


def test_ensure_production_item_creates_waste_item_with_me_prefix(db_session, inventory_service):
    item = inventory_service.ensure_production_item(
        item_type="WASTE", name="Merma Cadenas", unit_code="g"
    )

    assert item.item_type == "WASTE"
    assert item.sku.startswith("ME-")
    assert item.current_stock == Decimal("0")


def test_ensure_production_item_reuses_existing_waste_item_by_exact_name(db_session, inventory_service):
    first = inventory_service.ensure_production_item(
        item_type="WASTE", name="Merma Cadenas", unit_code="g"
    )
    second = inventory_service.ensure_production_item(
        item_type="WASTE", name="Merma Cadenas", unit_code="g"
    )

    assert first.id == second.id
