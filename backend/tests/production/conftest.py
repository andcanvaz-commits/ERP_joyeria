import uuid
from decimal import Decimal

import pytest

from backend.modules.auth.dependencies import CurrentUser
from backend.modules.inventory.models import InventoryItem
from backend.modules.inventory.repository import InventoryRepository
from backend.modules.inventory.service import InventoryService
from backend.modules.production.models import ProductionProcess
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
        role="Producción/Inventario",
    )
    db_session.add(auth_user)
    db_session.flush()

    return CurrentUser(id=user_id, username="jefe_test", role="Producción/Inventario", permissions=frozenset())


@pytest.fixture()
def admin_user(db_session) -> CurrentUser:
    """Admin real: el unico que puede mover stock editando/borrando una linea
    de acta enlazada a inventario a NIVEL DE ORDEN (ver update_acta_line/
    delete_acta_line). Las lineas de un intento de etapa no piden admin."""
    from backend.modules.auth.models import AuthUser

    user_id = uuid.uuid4()
    auth_user = AuthUser(
        id=user_id,
        username="admin_test",
        email="admin@test.local",
        password_hash="mock_hashed",
        role="admin",
    )
    db_session.add(auth_user)
    db_session.flush()

    return CurrentUser(id=user_id, username="admin_test", role="admin", permissions=frozenset())


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
def catalog_finished_item(db_session) -> InventoryItem:
    item = InventoryItem(
        item_type="FINISHED_PRODUCT",
        name="Anillo test",
        sku=f"PT-TEST-{uuid.uuid4().hex[:8]}",
        unit_code="und",
        current_stock=Decimal("0"),
        product_code="1010001",
    )
    db_session.add(item)
    db_session.flush()
    return item


@pytest.fixture()
def process(db_session) -> ProductionProcess:
    proc = ProductionProcess(
        name=f"Proceso test {uuid.uuid4().hex[:6]}",
        is_active=True,
    )
    db_session.add(proc)
    db_session.flush()
    return proc
