import uuid
from decimal import Decimal

import pytest

from backend.modules.auth.dependencies import CurrentUser
from backend.modules.inventory.models import InventoryItem
from backend.modules.inventory.repository import InventoryRepository
from backend.modules.inventory.service import InventoryService
from backend.modules.production.models import (
    ProductionProcess,
    ProductionProcessMaterial,
    ProductionProcessStage,
)
from backend.modules.production.repository import ProductionProcessRepository
from backend.modules.production.service import ProductionService


@pytest.fixture()
def current_user(db_session) -> CurrentUser:
    from backend.modules.auth.models import AuthUser

    user_id = uuid.uuid4()
    auth_user = AuthUser(
        id=user_id,
        username="jefe_test",
        email="jefe@test.local",
        password_hash="mock_hashed",
        role="Jefe de producción",
    )
    db_session.add(auth_user)
    db_session.flush()

    return CurrentUser(id=user_id, username="jefe_test", role="Jefe de producción", permissions=frozenset())


@pytest.fixture()
def production_service(db_session) -> ProductionService:
    return ProductionService(
        repository=ProductionProcessRepository(db_session),
        inventory_service=InventoryService(repository=InventoryRepository(db_session)),
    )


@pytest.fixture()
def raw_material(db_session) -> InventoryItem:
    item = InventoryItem(
        item_type="RAW_MATERIAL",
        name="Oro test",
        sku=f"MP-TEST-{uuid.uuid4().hex[:8]}",
        unit_code="g",
        current_stock=Decimal("0"),
    )
    db_session.add(item)
    db_session.flush()
    return item


@pytest.fixture()
def target_complement(db_session) -> InventoryItem:
    item = InventoryItem(
        item_type="COMPLEMENT",
        name="Base test",
        sku=f"CO-TEST-{uuid.uuid4().hex[:8]}",
        unit_code="und",
        current_stock=Decimal("0"),
    )
    db_session.add(item)
    db_session.flush()
    return item


@pytest.fixture()
def complement_item(db_session) -> InventoryItem:
    item = InventoryItem(
        item_type="COMPLEMENT",
        name="Complemento test",
        sku=f"CO-TEST-{uuid.uuid4().hex[:8]}",
        unit_code="und",
        current_stock=Decimal("0"),
    )
    db_session.add(item)
    db_session.flush()
    return item


@pytest.fixture()
def process(db_session, raw_material) -> ProductionProcess:
    proc = ProductionProcess(
        name=f"Proceso test {uuid.uuid4().hex[:6]}",
        waste_limit_percent=Decimal("1"),
        is_active=True,
        materials=[
            ProductionProcessMaterial(inventory_item_id=raw_material.id)
        ],
        stages=[
            ProductionProcessStage(
                name="Etapa unica",
                stage_type="PROCESS",
                stage_order=1,
                is_active=True,
                requires_weighing=False,
            )
        ],
    )
    db_session.add(proc)
    db_session.flush()
    return proc
