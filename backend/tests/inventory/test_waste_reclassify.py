from decimal import Decimal
from uuid import uuid4

import pytest

from backend.modules.inventory.models import InventoryItem, InventoryMovement
from backend.modules.inventory.repository import InventoryRepository
from backend.modules.inventory.service import InventoryDomainError, InventoryNotFoundError, InventoryService


@pytest.fixture()
def inventory_service(db_session) -> InventoryService:
    return InventoryService(repository=InventoryRepository(db_session))


def test_ensure_production_item_creates_waste_item_with_me_prefix(db_session, inventory_service):
    unique_name = f"Merma Cadenas {uuid4().hex[:8]}"
    item = inventory_service.ensure_production_item(
        item_type="WASTE", name=unique_name, unit_code="g"
    )

    assert item.item_type == "WASTE"
    assert item.sku.startswith("ME-")
    assert item.current_stock == Decimal("0")


def test_ensure_production_item_reuses_existing_waste_item_by_exact_name(db_session, inventory_service):
    unique_name = f"Merma Cadenas {uuid4().hex[:8]}"
    first = inventory_service.ensure_production_item(
        item_type="WASTE", name=unique_name, unit_code="g"
    )
    second = inventory_service.ensure_production_item(
        item_type="WASTE", name=unique_name, unit_code="g"
    )

    assert first.id == second.id


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


def test_reclassify_waste_moves_quantity_between_items(db_session, inventory_service):
    source = _make_waste_item(db_session, "Merma Cadenas", 10)
    target = _make_waste_item(db_session, "Merma Medallas", 0)
    movement = _make_ingreso_produccion_movement(db_session, source, 10, uuid4())

    result = inventory_service.reclassify_waste_movement(
        movement.id, target_item_id=target.id, quantity=None, user_id=None
    )

    assert len(result) == 2
    assert result[0].movement_type == "RECLASIFICACION_SALIDA"
    assert result[1].movement_type == "RECLASIFICACION_ENTRADA"
    assert result[0].reference_id == movement.reference_id
    assert result[1].reference_id == movement.reference_id
    db_session.refresh(source)
    db_session.refresh(target)
    assert source.current_stock == Decimal("0")
    assert target.current_stock == Decimal("10")


def test_reclassify_waste_partial_quantity(db_session, inventory_service):
    source = _make_waste_item(db_session, "Merma Cadenas", 10)
    target = _make_waste_item(db_session, "Merma Medallas", 0)
    movement = _make_ingreso_produccion_movement(db_session, source, 10, uuid4())

    inventory_service.reclassify_waste_movement(
        movement.id, target_item_id=target.id, quantity=Decimal("4"), user_id=None
    )

    db_session.refresh(source)
    db_session.refresh(target)
    assert source.current_stock == Decimal("6")
    assert target.current_stock == Decimal("4")


def test_reclassify_waste_rejects_more_than_available_stock(db_session, inventory_service):
    source = _make_waste_item(db_session, "Merma Cadenas", 3)
    target = _make_waste_item(db_session, "Merma Medallas", 0)
    movement = _make_ingreso_produccion_movement(db_session, source, 10, uuid4())
    # El item origen ya bajo a 3 (parte se consumio en otro lado); el
    # movimiento original decia 10, pero solo quedan 3 disponibles.
    source.current_stock = Decimal("3")
    db_session.flush()

    with pytest.raises(InventoryDomainError, match="Solo quedan 3"):
        inventory_service.reclassify_waste_movement(
            movement.id, target_item_id=target.id, quantity=None, user_id=None
        )


def test_reclassify_waste_rejects_non_ingreso_produccion_movement(db_session, inventory_service):
    source = _make_waste_item(db_session, "Merma Cadenas", 10)
    target = _make_waste_item(db_session, "Merma Medallas", 0)
    other_movement = InventoryMovement(
        item_id=source.id, movement_type="AJUSTE_POSITIVO", quantity=Decimal("10"), unit_code="g",
        reason="Ajuste manual", reference_type=None, reference_id=None,
    )
    db_session.add(other_movement)
    db_session.flush()

    with pytest.raises(InventoryDomainError, match="Solo se puede reclasificar"):
        inventory_service.reclassify_waste_movement(
            other_movement.id, target_item_id=target.id, quantity=None, user_id=None
        )


def test_reclassify_waste_rejects_target_that_is_not_waste_type(db_session, inventory_service):
    source = _make_waste_item(db_session, "Merma Cadenas", 10)
    not_waste = InventoryItem(
        item_type="RAW_MATERIAL", name="Plata", sku=f"MP-TEST-{uuid4().hex[:8]}", unit_code="g",
        current_stock=Decimal("0"),
    )
    db_session.add(not_waste)
    db_session.flush()
    movement = _make_ingreso_produccion_movement(db_session, source, 10, uuid4())

    with pytest.raises(InventoryDomainError, match="tipo desperdicio"):
        inventory_service.reclassify_waste_movement(
            movement.id, target_item_id=not_waste.id, quantity=None, user_id=None
        )


def test_reclassify_waste_rejects_target_with_mismatched_unit_code(db_session, inventory_service):
    source = _make_waste_item(db_session, "Merma Cadenas", 10)
    target = InventoryItem(
        item_type="WASTE", name="Merma Medallas und", sku=f"ME-TEST-{uuid4().hex[:8]}", unit_code="und",
        current_stock=Decimal("0"),
    )
    db_session.add(target)
    db_session.flush()
    movement = _make_ingreso_produccion_movement(db_session, source, 10, uuid4())

    with pytest.raises(InventoryDomainError, match="unidades distintas"):
        inventory_service.reclassify_waste_movement(
            movement.id, target_item_id=target.id, quantity=None, user_id=None
        )
