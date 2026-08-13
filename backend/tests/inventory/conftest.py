import uuid
from decimal import Decimal

import pytest

from backend.modules.inventory.models import InventoryItem
from backend.modules.production.models import ProductionRun, ProductionRunStatus

# ProductionRun.target_product_type_id referencia "product_types.id" por
# string. En el flujo real, ProductionService importa ese modelo antes de
# crear una corrida, lo que registra la tabla en el metadata de SQLAlchemy.
# Estos tests construyen ProductionRun directamente (sin pasar por el
# servicio), asi que sin este import el primer flush revienta con
# NoReferencedTableError al no encontrar "product_types" en el metadata.
from backend.modules.product_types import models as _product_types_models  # noqa: F401


@pytest.fixture()
def raw_material(db_session) -> InventoryItem:
    item = InventoryItem(
        item_type="RAW_MATERIAL",
        name="Plata test",
        sku=f"MP-TEST-{uuid.uuid4().hex[:8]}",
        unit_code="g",
        current_stock=Decimal("0"),
    )
    db_session.add(item)
    db_session.flush()
    return item


def make_waiting_run(db_session, raw_material, quantity, status=ProductionRunStatus.WAITING_MATERIAL):
    run = ProductionRun(
        process_id=uuid.uuid4(),
        process_name="Proceso test",
        quantity=Decimal(quantity),
        status=status,
        raw_material_item_id=raw_material.id,
        raw_material_unit_code="g",
        total_required_material=Decimal(quantity),
        waste_limit_percent=Decimal("1"),
        expected_finished_weight=Decimal(quantity),
        created_by_user_id=uuid.uuid4(),
        production_code=f"OP-TEST-{uuid.uuid4().hex[:6]}",
    )
    db_session.add(run)
    db_session.flush()
    return run
