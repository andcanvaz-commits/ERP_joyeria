"""Cancelar una orden de produccion (OP) por error -- etapa aceptada por
equivocacion, dato mal tipeado, etc. Debe liberar reservas y devolver al
inventario todo lo que la orden ya consumio, sin borrar la fila."""
from decimal import Decimal

import pytest

from backend.modules.production.service import ProductionDomainError, ProductionNotFoundError
from backend.tests.production.test_allocate_material import _create_waiting_child
from backend.tests.production.test_material_reservation import _reserve_partial
from backend.tests.production.test_material_split import _create_run
from backend.tests.production.test_receive_merma import _run_to_pending_reception, weighed_process  # noqa: F401


def test_cancel_from_waiting_material_frees_the_reservation(
    db_session, production_service, current_user, process, raw_material, target_complement
):
    child = _reserve_partial(
        db_session, production_service, current_user, process, raw_material, target_complement
    )
    assert child.reserved_material_quantity == Decimal("25")

    result = production_service.cancel_run(child.id, current_user, "Etapa aceptada por error")

    assert result.status == "CANCELADA"
    db_session.refresh(child)
    assert child.reserved_material_quantity == Decimal("0")
    # Nunca se consumio de verdad: el stock fisico no se toco, solo se libero.
    db_session.refresh(raw_material)
    assert raw_material.current_stock == Decimal("25")
    assert production_service.inventory_service.available_stock(raw_material) == Decimal("25")


def test_cancel_from_in_progress_restores_consumed_stock(
    db_session, production_service, current_user, process, raw_material, target_complement
):
    raw_material.current_stock = Decimal("1000")
    db_session.flush()
    run_read = _create_run(production_service, current_user, process, raw_material, target_complement, 100)
    production_service.approve_materials(run_read.id, current_user)
    production_service.start_run(run_read.id, current_user)
    db_session.refresh(raw_material)
    assert raw_material.current_stock == Decimal("900")  # 100g consumidos directos

    result = production_service.cancel_run(run_read.id, current_user, "Se acepto una etapa que no debia")

    assert result.status == "CANCELADA"
    # No es un rechazo de solicitud (reject_materials) -- distingue "Orden
    # cancelada" de "Solicitud rechazada" en el historial de Inventario.
    assert result.is_cancellation is True
    db_session.refresh(raw_material)
    assert raw_material.current_stock == Decimal("1000")
    reversions = [
        m for m in raw_material.movements
        if m.movement_type == "REVERSION_PRODUCCION" and m.reference_id == run_read.id
    ]
    assert len(reversions) == 1
    assert reversions[0].quantity == Decimal("100")


def test_cancel_does_not_touch_average_cost(
    db_session, production_service, current_user, process, raw_material, target_complement
):
    """REVERSION_PRODUCCION devuelve gramos pero no es una compra: el costo
    promedio ponderado (kardex) debe quedar exactamente como estaba."""
    from backend.modules.inventory.schemas import InventoryMovementCreate

    production_service.inventory_service.create_movement(
        InventoryMovementCreate(
            item_id=raw_material.id, movement_type="ENTRADA", quantity=Decimal("1000"),
            unit_cost=Decimal("50"), reason="Compra inicial",
        ),
        user_id=current_user.id,
    )
    db_session.refresh(raw_material)
    cost_before = raw_material.average_cost
    assert cost_before == Decimal("50")

    run_read = _create_run(production_service, current_user, process, raw_material, target_complement, 100)
    production_service.approve_materials(run_read.id, current_user)
    production_service.start_run(run_read.id, current_user)

    production_service.cancel_run(run_read.id, current_user, "Error de tipeo en la cantidad")

    db_session.refresh(raw_material)
    assert raw_material.average_cost == cost_before


def test_cancel_from_pending_reception_restores_stock(
    db_session, production_service, current_user, weighed_process, raw_material, target_complement
):
    raw_material.current_stock = Decimal("2000")
    db_session.flush()
    run = _run_to_pending_reception(
        production_service, current_user, weighed_process, raw_material, target_complement, 100, "95"
    )
    assert run.status == "PENDIENTE_RECEPCION"
    db_session.refresh(raw_material)
    assert raw_material.current_stock == Decimal("1900")

    production_service.cancel_run(run.id, current_user, "La etapa se acepto por error, hay que rehacerla")

    db_session.refresh(raw_material)
    assert raw_material.current_stock == Decimal("2000")
    db_session.refresh(run)
    assert run.status == "CANCELADA"
    assert run.rejection_reason == "La etapa se acepto por error, hay que rehacerla"


def test_cancel_accepts_no_reason(
    db_session, production_service, current_user, process, raw_material, target_complement
):
    """El motivo es opcional -- no toda cancelacion tiene (o necesita) una
    explicacion. Cubre tanto None como cadena vacia/solo espacios."""
    raw_material.current_stock = Decimal("1000")
    db_session.flush()
    run_read = _create_run(production_service, current_user, process, raw_material, target_complement, 100)

    result = production_service.cancel_run(run_read.id, current_user, None)

    assert result.status == "CANCELADA"
    run = production_service.repository.get_run(run_read.id)
    assert run.rejection_reason is None


def test_cancel_rejects_a_received_run(
    db_session, production_service, current_user, weighed_process, raw_material, target_complement
):
    raw_material.current_stock = Decimal("2000")
    db_session.flush()
    run = _run_to_pending_reception(
        production_service, current_user, weighed_process, raw_material, target_complement, 100, "95"
    )
    production_service.receive_finished_product(run.id, current_user)

    with pytest.raises(ProductionDomainError, match="ya recibida"):
        production_service.cancel_run(run.id, current_user, "motivo")


def test_cancel_rejects_an_already_cancelled_run(
    db_session, production_service, current_user, process, raw_material, target_complement
):
    child = _reserve_partial(
        db_session, production_service, current_user, process, raw_material, target_complement
    )
    production_service.cancel_run(child.id, current_user, "primera cancelacion")

    with pytest.raises(ProductionDomainError, match="ya esta cancelada"):
        production_service.cancel_run(child.id, current_user, "segundo intento")


def test_cancel_rejects_when_an_active_child_split_exists(
    db_session, production_service, current_user, process, raw_material, target_complement
):
    parent_id, child = _create_waiting_child(
        production_service, current_user, process, raw_material, target_complement
    )

    with pytest.raises(ProductionDomainError, match="hija"):
        production_service.cancel_run(parent_id, current_user, "motivo")

    # Cancelando primero la hija, el padre si se puede cancelar despues.
    production_service.cancel_run(child.id, current_user, "hija cancelada")
    result = production_service.cancel_run(parent_id, current_user, "ahora si")
    assert result.status == "CANCELADA"


def test_cancel_unknown_run_raises_not_found(production_service, current_user):
    import uuid

    with pytest.raises(ProductionNotFoundError):
        production_service.cancel_run(uuid.uuid4(), current_user, "motivo")


def test_cancel_run_family_cancels_parent_and_waiting_child_together(
    db_session, production_service, current_user, process, raw_material, target_complement
):
    """Un split donde solo el padre arranco (60g consumidos) y la hija sigue
    ESPERANDO_MATERIAL (40g reservados, nunca consumidos): cancelar la
    familia desde el padre cancela y revierte ambas de una, sin tener que
    cancelar la hija primero."""
    parent_id, child = _create_waiting_child(
        production_service, current_user, process, raw_material, target_complement
    )
    db_session.refresh(raw_material)
    assert raw_material.current_stock == Decimal("0")  # 60g consumidos por el padre

    results = production_service.cancel_run_family(parent_id, current_user, "split ya no tiene sentido")

    assert {r.status for r in results} == {"CANCELADA"}
    assert {r.id for r in results} == {parent_id, child.id}
    db_session.refresh(raw_material)
    assert raw_material.current_stock == Decimal("60")  # revertidos los 60g consumidos
    assert production_service.inventory_service.available_stock(raw_material) == Decimal("60")


def test_cancel_run_family_from_child_also_cancels_parent(
    db_session, production_service, current_user, process, raw_material, target_complement
):
    """Da igual desde cual miembro de la familia se dispara: siempre se
    resuelve la familia completa por root_production_code."""
    parent_id, child = _create_waiting_child(
        production_service, current_user, process, raw_material, target_complement
    )

    results = production_service.cancel_run_family(child.id, current_user, "motivo")

    assert {r.id for r in results} == {parent_id, child.id}


def test_cancel_run_family_skips_already_cancelled_members(
    db_session, production_service, current_user, process, raw_material, target_complement
):
    parent_id, child = _create_waiting_child(
        production_service, current_user, process, raw_material, target_complement
    )
    production_service.cancel_run(child.id, current_user, "cancelada antes")

    results = production_service.cancel_run_family(parent_id, current_user, "ahora el resto")

    assert {r.id for r in results} == {parent_id}


def test_cancel_run_family_unknown_run_raises_not_found(production_service, current_user):
    import uuid

    with pytest.raises(ProductionNotFoundError):
        production_service.cancel_run_family(uuid.uuid4(), current_user, "motivo")


def test_cancel_run_restores_stock_consumed_by_a_new_flow_stage_attempt(
    db_session, production_service, current_user, process, raw_material
):
    from backend.modules.product_types.models import ProductType  # noqa: F401
    from backend.modules.production.schemas import (
        ProductionOrderCreate,
        StageAttemptCreate,
        StageAttemptMaterialLine,
    )

    raw_material.current_stock = Decimal("100")
    db_session.flush()

    order = production_service.create_order(ProductionOrderCreate(name="Orden a cancelar"), current_user)
    production_service.start_stage_attempt(
        order.id,
        StageAttemptCreate(
            process_id=process.id,
            responsable_name="Ana",
            materials=[StageAttemptMaterialLine(item_id=raw_material.id, quantity=Decimal("100"))],
        ),
        current_user,
    )
    db_session.refresh(raw_material)
    assert raw_material.current_stock == Decimal("0")

    result = production_service.cancel_run(order.id, current_user, "Cancelada por error")

    assert result.status == "CANCELADA"
    db_session.refresh(raw_material)
    assert raw_material.current_stock == Decimal("100")
