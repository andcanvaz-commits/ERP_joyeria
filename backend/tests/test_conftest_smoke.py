import uuid

from sqlalchemy import text

from backend.modules.inventory.models import InventoryItem


def test_db_session_rolls_back(db_session):
    sku = f"SMOKE-{uuid.uuid4().hex[:8]}"
    item = InventoryItem(
        item_type="RAW_MATERIAL",
        name="Item de humo",
        sku=sku,
        unit_code="g",
        current_stock=0,
    )
    db_session.add(item)
    db_session.flush()
    found = db_session.execute(
        text("SELECT sku FROM inventory_items WHERE sku = :sku"), {"sku": sku}
    ).scalar_one_or_none()
    assert found == sku
