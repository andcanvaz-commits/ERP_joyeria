"""Cancelar una orden de produccion (OP) por error -- etapa aceptada por
equivocacion, dato mal tipeado, etc. Debe liberar reservas y devolver al
inventario todo lo que la orden ya consumio, sin borrar la fila."""
import uuid
from decimal import Decimal

import pytest

# Import necesario aunque no se use directamente: registra la tabla
# product_types en el metadata de SQLAlchemy antes del flush (ProductionRun
# tiene un FK a product_types.id). Mismo patron que test_dynamic_flow.py.
from backend.modules.product_types.models import ProductType  # noqa: F401
from backend.modules.production.models import ProductionRun, ProductionRunStatus
from backend.modules.production.schemas import (
    ProductionOrderCreate,
    StageAttemptCreate,
    StageAttemptMaterialLine,
)
from backend.modules.production.service import ProductionDomainError, ProductionNotFoundError


def _run_with_consumed_material(
    db_session, production_service, current_user, process, raw_material, quantity=Decimal("100")
):
    raw_material.current_stock = quantity
    db_session.flush()
    order = production_service.create_order(ProductionOrderCreate(name="Orden cancel test"), current_user)
    production_service.start_stage_attempt(
        order.id,
        StageAttemptCreate(
            process_id=process.id,
            responsable_name="Ana",
            materials=[StageAttemptMaterialLine(item_id=raw_material.id, quantity=quantity)],
        ),
        current_user,
    )
    return production_service.repository.get_run(order.id)


def _create_split_family(db_session, production_service, current_user, process, raw_material):
    """Construye a mano una familia de dos corridas con codigo raiz
    compartido -- el flujo nuevo ya no parte ORDENES (el split ahora es por
    INTENTO DE ETAPA dentro de una misma orden, ver
    test_stage_attempt_material.py), pero cancel_run/cancel_run_family siguen
    operando sobre familias historicas que ya existen en la base real (ver
    docs/superpowers/specs/2026-08-19-automatizar-material-por-etapa-design.md)."""
    raw_material.current_stock = Decimal("60")
    db_session.flush()

    parent = ProductionRun(
        process_id=process.id,
        process_name=process.name,
        quantity=Decimal("60"),
        status=ProductionRunStatus.IN_PROGRESS,
        raw_material_item_id=raw_material.id,
        raw_material_unit_code=raw_material.unit_code,
        total_required_material=Decimal("60"),
        created_by_user_id=current_user.id,
    )
    db_session.add(parent)
    db_session.flush()
    parent.production_code = f"OP-TEST-{uuid.uuid4().hex[:6]}"
    parent.root_production_code = parent.production_code
    db_session.flush()

    child = ProductionRun(
        process_id=process.id,
        process_name=process.name,
        quantity=Decimal("40"),
        status=ProductionRunStatus.WAITING_MATERIAL,
        raw_material_item_id=raw_material.id,
        raw_material_unit_code=raw_material.unit_code,
        total_required_material=Decimal("40"),
        created_by_user_id=current_user.id,
        parent_run_id=parent.id,
        root_production_code=parent.production_code,
    )
    db_session.add(child)
    db_session.flush()
    child.production_code = f"{parent.production_code}-B"
    db_session.flush()

    production_service.inventory_service.consume_material_for_production(
        item_id=raw_material.id, quantity=Decimal("60"), production_run_id=parent.id, user_id=current_user.id,
    )
    db_session.flush()
    return parent.id, child


def test_cancel_from_in_progress_restores_consumed_stock(
    db_session, production_service, current_user, process, raw_material
):
    run = _run_with_consumed_material(db_session, production_service, current_user, process, raw_material)
    db_session.refresh(raw_material)
    assert raw_material.current_stock == Decimal("0")

    result = production_service.cancel_run(run.id, current_user, "Se acepto una etapa que no debia")

    assert result.status == "CANCELADA"
    # No es un rechazo de solicitud -- distingue "Orden cancelada" de
    # "Solicitud rechazada" en el historial de Inventario.
    assert result.is_cancellation is True
    db_session.refresh(raw_material)
    assert raw_material.current_stock == Decimal("100")
    reversions = [
        m for m in raw_material.movements
        if m.movement_type == "REVERSION_PRODUCCION" and m.reference_id == run.id
    ]
    assert len(reversions) == 1
    assert reversions[0].quantity == Decimal("100")


def test_cancel_does_not_touch_average_cost(db_session, production_service, current_user, process, raw_material):
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

    order = production_service.create_order(ProductionOrderCreate(name="Orden costo test"), current_user)
    production_service.start_stage_attempt(
        order.id,
        StageAttemptCreate(
            process_id=process.id,
            responsable_name="Ana",
            materials=[StageAttemptMaterialLine(item_id=raw_material.id, quantity=Decimal("100"))],
        ),
        current_user,
    )

    production_service.cancel_run(order.id, current_user, "Error de tipeo en la cantidad")

    db_session.refresh(raw_material)
    assert raw_material.average_cost == cost_before


def test_cancel_accepts_no_reason(db_session, production_service, current_user, process, raw_material):
    """El motivo es opcional -- no toda cancelacion tiene (o necesita) una
    explicacion."""
    order = production_service.create_order(ProductionOrderCreate(name="Orden sin motivo"), current_user)

    result = production_service.cancel_run(order.id, current_user, None)

    assert result.status == "CANCELADA"
    run = production_service.repository.get_run(order.id)
    assert run.rejection_reason is None


def test_cancel_rejects_an_already_cancelled_run(db_session, production_service, current_user, process, raw_material):
    order = production_service.create_order(ProductionOrderCreate(name="Orden doble cancel"), current_user)
    production_service.cancel_run(order.id, current_user, "primera cancelacion")

    with pytest.raises(ProductionDomainError, match="ya esta cancelada"):
        production_service.cancel_run(order.id, current_user, "segundo intento")


def test_cancel_unknown_run_raises_not_found(production_service, current_user):
    with pytest.raises(ProductionNotFoundError):
        production_service.cancel_run(uuid.uuid4(), current_user, "motivo")


def test_cancel_rejects_when_an_active_child_split_exists(
    db_session, production_service, current_user, process, raw_material
):
    parent_id, child = _create_split_family(db_session, production_service, current_user, process, raw_material)

    with pytest.raises(ProductionDomainError, match="hija"):
        production_service.cancel_run(parent_id, current_user, "motivo")

    # Cancelando primero la hija, el padre si se puede cancelar despues.
    production_service.cancel_run(child.id, current_user, "hija cancelada")
    result = production_service.cancel_run(parent_id, current_user, "ahora si")
    assert result.status == "CANCELADA"


def test_cancel_run_family_cancels_parent_and_waiting_child_together(
    db_session, production_service, current_user, process, raw_material
):
    """Un split donde solo el padre arranco (60g consumidos) y la hija sigue
    ESPERANDO_MATERIAL (nunca consumidos): cancelar la familia desde el padre
    cancela y revierte ambas de una, sin tener que cancelar la hija primero."""
    parent_id, child = _create_split_family(db_session, production_service, current_user, process, raw_material)
    db_session.refresh(raw_material)
    assert raw_material.current_stock == Decimal("0")  # 60g consumidos por el padre

    results = production_service.cancel_run_family(parent_id, current_user, "split ya no tiene sentido")

    assert {r.status for r in results} == {"CANCELADA"}
    assert {r.id for r in results} == {parent_id, child.id}
    db_session.refresh(raw_material)
    assert raw_material.current_stock == Decimal("60")  # revertidos los 60g consumidos
    assert production_service.inventory_service.available_stock(raw_material) == Decimal("60")


def test_cancel_run_family_from_child_also_cancels_parent(
    db_session, production_service, current_user, process, raw_material
):
    """Da igual desde cual miembro de la familia se dispara: siempre se
    resuelve la familia completa por root_production_code."""
    parent_id, child = _create_split_family(db_session, production_service, current_user, process, raw_material)

    results = production_service.cancel_run_family(child.id, current_user, "motivo")

    assert {r.id for r in results} == {parent_id, child.id}


def test_cancel_run_family_skips_already_cancelled_members(
    db_session, production_service, current_user, process, raw_material
):
    parent_id, child = _create_split_family(db_session, production_service, current_user, process, raw_material)
    production_service.cancel_run(child.id, current_user, "cancelada antes")

    results = production_service.cancel_run_family(parent_id, current_user, "ahora el resto")

    assert {r.id for r in results} == {parent_id}


def test_cancel_run_family_unknown_run_raises_not_found(production_service, current_user):
    with pytest.raises(ProductionNotFoundError):
        production_service.cancel_run_family(uuid.uuid4(), current_user, "motivo")
