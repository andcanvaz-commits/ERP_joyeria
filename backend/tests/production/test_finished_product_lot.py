"""Un solo lote FINISHED_PRODUCT por orden, alimentado de a poco por cada
etapa (ver docs/superpowers/plans/2026-08-19-rediseno-acta-y-ux-produccion.md
Task 2): la segunda llamada debe sumar al mismo item, no crear otro."""
import uuid
from decimal import Decimal

from sqlalchemy import select

from backend.modules.inventory.models import InventoryMovement
from backend.modules.production.models import ProductionRun, ProductionRunStatus
from backend.modules.product_types import models as _product_types_models  # noqa: F401


def _make_run(db_session, current_user, code):
    run = ProductionRun(
        name="Orden lote test",
        status=ProductionRunStatus.IN_PROGRESS,
        created_by_user_id=current_user.id,
        production_code=code,
    )
    db_session.add(run)
    db_session.flush()
    return run


def test_get_or_create_finished_product_lot_creates_once(db_session, production_service, current_user):
    run = _make_run(db_session, current_user, f"OP-TEST-{uuid.uuid4().hex[:6]}")
    inventory_service = production_service.inventory_service

    lot1 = inventory_service.get_or_create_finished_product_lot(
        run=run, quantity=Decimal("10"), material_type="Oro", purity="18k",
        received_by_user_id=current_user.id,
    )
    assert lot1.current_stock == Decimal("10")

    lot2 = inventory_service.get_or_create_finished_product_lot(
        run=run, quantity=Decimal("5"), material_type="Oro", purity="18k",
        received_by_user_id=current_user.id,
    )

    assert lot2.id == lot1.id
    db_session.refresh(lot1)
    assert lot1.current_stock == Decimal("15")

    lots = db_session.execute(
        select(InventoryMovement.item_id).where(
            InventoryMovement.movement_type == "INGRESO_PRODUCCION",
            InventoryMovement.reference_type == "production_order",
            InventoryMovement.reference_id == run.id,
        )
    ).scalars().all()
    assert len(set(lots)) == 1
