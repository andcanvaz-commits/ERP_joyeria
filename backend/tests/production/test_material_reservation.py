"""Reserva de stock al destinar parcial.

Inventario destina stock a una corrida ESPERANDO_MATERIAL y puede elegir NO
arrancar todavia: el stock queda reservado (no consumido) para esa orden y
deja de estar disponible para el resto del sistema.
"""
from decimal import Decimal

import pytest

from backend.modules.inventory.schemas import InventoryMovementCreate
from backend.modules.production.service import ProductionDomainError
from backend.tests.production.test_allocate_material import _create_waiting_child


def _reserve_partial(db_session, production_service, current_user, process, raw_material, target_complement):
    """Deja una corrida hija de 40 g con stock para solo 25 g y esos 25 g
    ya reservados. Devuelve la hija."""
    _, child = _create_waiting_child(
        production_service, current_user, process, raw_material, target_complement
    )
    raw_material.current_stock = Decimal("25")  # cubre 25 de los 40 g
    db_session.flush()
    production_service.reserve_material(child.id, Decimal("40"), current_user)
    return child


def test_preview_reports_partial_without_touching_anything(
    db_session, production_service, current_user, process, raw_material, target_complement
):
    _, child = _create_waiting_child(
        production_service, current_user, process, raw_material, target_complement
    )
    raw_material.current_stock = Decimal("25")
    db_session.flush()

    preview = production_service.preview_allocation(child.id, Decimal("40"))

    assert preview.covered_qty == Decimal("25")
    assert preview.target_qty == Decimal("40")
    assert preview.is_partial is True
    assert preview.limiting_name == raw_material.name
    # Dry-run: ni stock, ni estado, ni reserva se movieron.
    db_session.refresh(raw_material)
    assert raw_material.current_stock == Decimal("25")
    db_session.refresh(child)
    assert child.status == "ESPERANDO_MATERIAL"
    assert child.reserved_material_quantity == Decimal("0")


def test_preview_reports_full_coverage_when_stock_is_enough(
    db_session, production_service, current_user, process, raw_material, target_complement
):
    _, child = _create_waiting_child(
        production_service, current_user, process, raw_material, target_complement
    )
    raw_material.current_stock = Decimal("40")
    db_session.flush()

    preview = production_service.preview_allocation(child.id, Decimal("40"))

    assert preview.covered_qty == Decimal("40")
    assert preview.is_partial is False


def test_reserve_holds_stock_without_consuming_or_starting(
    db_session, production_service, current_user, process, raw_material, target_complement
):
    child = _reserve_partial(
        db_session, production_service, current_user, process, raw_material, target_complement
    )

    db_session.refresh(child)
    # Reservado lo que de verdad alcanza (25 g), no los 40 g pedidos.
    assert child.reserved_material_quantity == Decimal("25")
    assert child.status == "ESPERANDO_MATERIAL"
    # El stock sigue fisicamente ahi: reservar NO es un movimiento.
    db_session.refresh(raw_material)
    assert raw_material.current_stock == Decimal("25")
    # Y no se partio la orden.
    assert child.quantity == Decimal("40")


def test_reserved_stock_is_not_available_to_another_run(
    db_session, production_service, current_user, process, raw_material, target_complement
):
    child = _reserve_partial(
        db_session, production_service, current_user, process, raw_material, target_complement
    )

    # Todo el stock fisico esta reservado para `child`: para cualquier otro
    # consumidor el disponible es 0.
    available = production_service.inventory_service.available_stock(raw_material)
    assert available == Decimal("0")

    reserved = production_service.inventory_service.reserved_stock(raw_material.id)
    assert reserved == Decimal("25")

    # ...pero para la propia corrida que lo reservo sigue disponible.
    own = production_service.inventory_service.available_stock(raw_material, exclude_run_id=child.id)
    assert own == Decimal("25")


def test_reserved_stock_blocks_a_manual_salida(
    db_session, production_service, current_user, process, raw_material, target_complement
):
    _reserve_partial(
        db_session, production_service, current_user, process, raw_material, target_complement
    )

    payload = InventoryMovementCreate(
        item_id=raw_material.id,
        movement_type="SALIDA",
        quantity=Decimal("10"),
        reason="Salida manual de prueba",
    )
    with pytest.raises(Exception, match="reservados"):
        production_service.inventory_service.create_movement(payload, user_id=current_user.id)

    db_session.refresh(raw_material)
    assert raw_material.current_stock == Decimal("25")


def test_release_returns_stock_to_available(
    db_session, production_service, current_user, process, raw_material, target_complement
):
    child = _reserve_partial(
        db_session, production_service, current_user, process, raw_material, target_complement
    )

    production_service.release_material_reservation(child.id, current_user)

    db_session.refresh(child)
    assert child.reserved_material_quantity == Decimal("0")
    assert production_service.inventory_service.available_stock(raw_material) == Decimal("25")


def test_start_reserved_rejects_incomplete_reservation(
    db_session, production_service, current_user, process, raw_material, target_complement
):
    child = _reserve_partial(
        db_session, production_service, current_user, process, raw_material, target_complement
    )

    with pytest.raises(ProductionDomainError, match="todavia no cubre el 100%"):
        production_service.start_with_reserved_material(child.id, current_user)

    db_session.refresh(child)
    assert child.status == "ESPERANDO_MATERIAL"


def test_start_reserved_consumes_and_starts_once_complete(
    db_session, production_service, current_user, process, raw_material, target_complement
):
    child = _reserve_partial(
        db_session, production_service, current_user, process, raw_material, target_complement
    )
    # Llega el resto del material y se reserva tambien: 40 g en total.
    raw_material.current_stock = Decimal("40")
    db_session.flush()
    production_service.reserve_material(child.id, Decimal("15"), current_user)
    db_session.refresh(child)
    assert child.reserved_material_quantity == Decimal("40")

    result = production_service.start_with_reserved_material(child.id, current_user)

    assert result.status == "EN_PROCESO"
    assert result.quantity == Decimal("40")
    # Recien aqui se consume de verdad, y la reserva se libera al hacerlo.
    db_session.refresh(raw_material)
    assert raw_material.current_stock == Decimal("0")
    db_session.refresh(child)
    assert child.reserved_material_quantity == Decimal("0")
    # Sin corridas nietas: no se partio nada porque la reserva cubria todo.
    grandchildren = [
        r for r in production_service.repository.list_runs() if r.parent_run_id == child.id
    ]
    assert grandchildren == []


def test_reserve_rejects_when_nothing_is_available(
    db_session, production_service, current_user, process, raw_material, target_complement
):
    _, child = _create_waiting_child(
        production_service, current_user, process, raw_material, target_complement
    )
    raw_material.current_stock = Decimal("0")
    db_session.flush()

    with pytest.raises(ProductionDomainError, match="No hay stock libre para reservar"):
        production_service.reserve_material(child.id, Decimal("40"), current_user)


def test_reserve_rejects_more_units_than_the_run_needs(
    db_session, production_service, current_user, process, raw_material, target_complement
):
    _, child = _create_waiting_child(
        production_service, current_user, process, raw_material, target_complement
    )

    with pytest.raises(ProductionDomainError, match="No puedes reservar mas"):
        production_service.reserve_material(child.id, Decimal("999"), current_user)


def test_list_items_exposes_reserved_and_available(
    db_session, production_service, current_user, process, raw_material, target_complement
):
    _reserve_partial(
        db_session, production_service, current_user, process, raw_material, target_complement
    )

    items = production_service.inventory_service.list_items("RAW_MATERIAL")
    read = next(item for item in items if item.id == raw_material.id)

    assert read.current_stock == Decimal("25")
    assert read.reserved_stock == Decimal("25")
    assert read.available_stock == Decimal("0")


def test_split_carries_the_reservation_to_the_child_run(
    db_session, production_service, current_user, process, raw_material, target_complement
):
    """Al partir una corrida reservada, los gramos reservados se reparten:
    no se pierden ni se duplican."""
    child = _reserve_partial(
        db_session, production_service, current_user, process, raw_material, target_complement
    )
    run = production_service.repository.get_run(child.id)
    reserved_before = run.reserved_material_quantity

    grandchild = production_service._split_run_for_partial_material(run, Decimal("25"))

    assert run.reserved_material_quantity + grandchild.reserved_material_quantity == reserved_before


def test_reserve_material_covers_stage_ingredients_too(
    db_session, production_service, current_user, process, raw_material, target_complement
):
    from backend.modules.inventory.models import InventoryItem
    from backend.modules.production.models import ProductionRunStageIngredient
    from backend.modules.production.schemas import ProductionRunCreate, RunProductCreate
    from backend.modules.production.service import _reservation_is_complete
    import uuid

    supply = InventoryItem(
        item_type="SUPPLY", name="Hilo", sku=f"IN-{uuid.uuid4().hex[:8]}", unit_code="m",
        # Alcanza justo para el 50% que va a cubrir la aprobacion (10 * 0.5),
        # asi la aprobacion no queda bloqueada por el insumo.
        current_stock=Decimal("5"),
    )
    db_session.add(supply)
    db_session.flush()

    raw_material.current_stock = Decimal("50")
    db_session.flush()

    payload = ProductionRunCreate(
        process_id=process.id,
        raw_material_item_id=raw_material.id,
        quantity=Decimal("100"),
        products=[RunProductCreate(target_item_id=target_complement.id, quantity=Decimal("100"))],
    )
    run_read = production_service.create_run(payload, current_user)
    # El banco de procesos ya no preconfigura insumos (seccion 3): se agrega
    # directo a la etapa ya materializada de la corrida.
    run = production_service.repository.get_run(run_read.id)
    run.stages[0].ingredients.append(
        ProductionRunStageIngredient(inventory_item_id=supply.id, quantity=Decimal("10"), unit_code=supply.unit_code)
    )
    db_session.flush()
    approved = production_service.approve_materials(run_read.id, current_user)
    assert approved.quantity == Decimal("50")

    children = [r for r in production_service.repository.list_runs() if r.parent_run_id == approved.id]
    child = children[0]
    assert child.stages[0].ingredients[0].quantity == Decimal("5")

    supply.current_stock = Decimal("2")
    db_session.flush()
    production_service.reserve_material(child.id, Decimal("50"), current_user)
    db_session.refresh(child)

    assert child.stages[0].ingredients[0].reserved_quantity == Decimal("2")
    assert _reservation_is_complete(child) is False
