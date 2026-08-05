import uuid
from decimal import Decimal

import pytest

from backend.modules.inventory.models import InventoryItem
from backend.modules.production.service import ProductionDomainError
from backend.modules.production.schemas import (
    ProcessMaterialCreate,
    ProductionProcessCreate,
    ProductionProcessStageCreate,
)


def _make_item(db_session, item_type: str) -> InventoryItem:
    item = InventoryItem(
        item_type=item_type,
        name=f"{item_type} test",
        sku=f"{item_type[:2]}-TEST-{uuid.uuid4().hex[:8]}",
        unit_code="g" if item_type != "COMPLEMENT" else "und",
        current_stock=Decimal("0"),
    )
    db_session.add(item)
    db_session.flush()
    return item


def _payload(item: InventoryItem) -> ProductionProcessCreate:
    return ProductionProcessCreate(
        name=f"Proceso test {uuid.uuid4().hex[:6]}",
        materials=[
            ProcessMaterialCreate(
                inventory_item_id=item.id,
                quantity_per_unit=Decimal("5"),
                unit_code=item.unit_code,
            )
        ],
        stages=[
            ProductionProcessStageCreate(name="Etapa unica", order=1),
        ],
    )


@pytest.mark.parametrize("item_type", ["RAW_MATERIAL", "COMPLEMENT", "WASTE"])
def test_create_process_accepts_material_types(db_session, production_service, item_type):
    item = _make_item(db_session, item_type)
    result = production_service.create_process(_payload(item))
    assert result.materials[0].inventory_item_id == item.id


def test_create_process_rejects_supply_material(db_session, production_service):
    item = _make_item(db_session, "SUPPLY")
    with pytest.raises(ProductionDomainError):
        production_service.create_process(_payload(item))
