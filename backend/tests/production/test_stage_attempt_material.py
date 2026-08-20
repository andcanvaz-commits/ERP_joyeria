"""Validacion de stock y split automatico al iniciar un intento de etapa
(docs/superpowers/specs/2026-08-19-automatizar-material-por-etapa-design.md)."""
import uuid
from decimal import Decimal

import pytest

# Import necesario aunque no se use directamente: registra la tabla
# product_types en el metadata de SQLAlchemy antes del flush (ProductionRun
# tiene un FK a product_types.id). Mismo patron que test_dynamic_flow.py.
from backend.modules.product_types.models import ProductType  # noqa: F401
from backend.modules.production.schemas import (
    ProductionOrderCreate,
    StageAttemptCreate,
    StageAttemptMaterialLine,
    StageAttemptProductTarget,
)
from backend.modules.production.service import ProductionDomainError, ProductionNotFoundError


def _start_order(production_service, current_user):
    return production_service.create_order(ProductionOrderCreate(name="Orden material test"), current_user)


def _product(item) -> StageAttemptProductTarget:
    return StageAttemptProductTarget(target_item_id=item.id)


def test_start_stage_attempt_without_materials_starts_directly(
    production_service, current_user, process, complement_item
):
    order = _start_order(production_service, current_user)

    result = production_service.start_stage_attempt(
        order.id,
        StageAttemptCreate(process_id=process.id, responsable_name="Ana", product=_product(complement_item)),
        current_user,
    )

    assert len(result.stage_attempts) == 1
    assert result.stage_attempts[0].status == "EN_PROCESO"
    assert result.stage_attempts[0].materials == []


def test_start_stage_attempt_requires_product(process):
    from pydantic import ValidationError

    with pytest.raises(ValidationError):
        StageAttemptCreate(process_id=process.id, responsable_name="Ana")


def test_start_stage_attempt_with_full_stock_consumes_and_starts(
    db_session, production_service, current_user, process, raw_material, complement_item
):
    raw_material.current_stock = Decimal("100")
    db_session.flush()
    order = _start_order(production_service, current_user)

    result = production_service.start_stage_attempt(
        order.id,
        StageAttemptCreate(
            process_id=process.id,
            responsable_name="Ana",
            materials=[StageAttemptMaterialLine(item_id=raw_material.id, quantity=Decimal("100"))],
            product=_product(complement_item),
        ),
        current_user,
    )

    assert len(result.stage_attempts) == 1
    attempt = result.stage_attempts[0]
    assert attempt.status == "EN_PROCESO"
    assert attempt.materials[0].quantity_requested == Decimal("100")
    assert attempt.materials[0].quantity_pending == Decimal("0")
    db_session.refresh(raw_material)
    assert raw_material.current_stock == Decimal("0")
    entrega_lines = [line for line in attempt.acta_lines if line.side == "ENTREGA"]
    assert len(entrega_lines) == 1
    assert entrega_lines[0].quantity == Decimal("100")


def test_start_stage_attempt_with_partial_stock_splits_into_two_attempts(
    db_session, production_service, current_user, process, raw_material, complement_item
):
    raw_material.current_stock = Decimal("60")
    db_session.flush()
    order = _start_order(production_service, current_user)

    result = production_service.start_stage_attempt(
        order.id,
        StageAttemptCreate(
            process_id=process.id,
            responsable_name="Ana",
            materials=[StageAttemptMaterialLine(item_id=raw_material.id, quantity=Decimal("100"))],
            product=_product(complement_item),
        ),
        current_user,
    )

    assert len(result.stage_attempts) == 2
    covered = next(a for a in result.stage_attempts if a.status == "EN_PROCESO")
    waiting = next(a for a in result.stage_attempts if a.status == "PENDIENTE_MATERIAL")
    assert covered.materials[0].quantity_requested == Decimal("60")
    assert covered.materials[0].quantity_pending == Decimal("0")
    assert waiting.materials[0].quantity_requested == Decimal("40")
    assert waiting.materials[0].quantity_pending == Decimal("40")
    assert waiting.attempt_no_for_process == covered.attempt_no_for_process + 1
    db_session.refresh(raw_material)
    assert raw_material.current_stock == Decimal("0")
    waiting_lines = [line for line in result.acta_lines if line.stage_attempt_id == waiting.id]
    assert waiting_lines == []


def test_start_stage_attempt_with_zero_stock_creates_only_waiting_attempt(
    db_session, production_service, current_user, process, raw_material, complement_item
):
    order = _start_order(production_service, current_user)

    result = production_service.start_stage_attempt(
        order.id,
        StageAttemptCreate(
            process_id=process.id,
            responsable_name="Ana",
            materials=[StageAttemptMaterialLine(item_id=raw_material.id, quantity=Decimal("100"))],
            product=_product(complement_item),
        ),
        current_user,
    )

    assert len(result.stage_attempts) == 1
    waiting = result.stage_attempts[0]
    assert waiting.status == "PENDIENTE_MATERIAL"
    assert waiting.materials[0].quantity_pending == Decimal("100")
    db_session.refresh(raw_material)
    assert raw_material.current_stock == Decimal("0")


def test_start_stage_attempt_coverage_is_the_minimum_across_lines(
    db_session, production_service, current_user, process, raw_material, target_complement, complement_item
):
    raw_material.current_stock = Decimal("100")
    target_complement.current_stock = Decimal("3")
    db_session.flush()
    order = _start_order(production_service, current_user)

    result = production_service.start_stage_attempt(
        order.id,
        StageAttemptCreate(
            process_id=process.id,
            responsable_name="Ana",
            materials=[
                StageAttemptMaterialLine(item_id=raw_material.id, quantity=Decimal("100")),
                StageAttemptMaterialLine(item_id=target_complement.id, quantity=Decimal("10")),
            ],
            product=_product(complement_item),
        ),
        current_user,
    )

    covered = next(a for a in result.stage_attempts if a.status == "EN_PROCESO")
    lines_by_item = {m.item_id: m for m in covered.materials}
    assert lines_by_item[raw_material.id].quantity_requested == Decimal("30")
    assert lines_by_item[target_complement.id].quantity_requested == Decimal("3")


def test_allocate_stage_attempt_material_full_stock_starts_it(
    db_session, production_service, current_user, process, raw_material, complement_item
):
    order = _start_order(production_service, current_user)
    result = production_service.start_stage_attempt(
        order.id,
        StageAttemptCreate(
            process_id=process.id,
            responsable_name="Ana",
            materials=[StageAttemptMaterialLine(item_id=raw_material.id, quantity=Decimal("100"))],
            product=_product(complement_item),
        ),
        current_user,
    )
    waiting = next(a for a in result.stage_attempts if a.status == "PENDIENTE_MATERIAL")

    raw_material.current_stock = Decimal("100")
    db_session.flush()

    updated = production_service.allocate_stage_attempt_material(waiting.id, current_user)

    reloaded = next(a for a in updated.stage_attempts if a.id == waiting.id)
    assert reloaded.status == "EN_PROCESO"
    assert reloaded.materials[0].quantity_pending == Decimal("0")
    db_session.refresh(raw_material)
    assert raw_material.current_stock == Decimal("0")


def test_allocate_stage_attempt_material_partial_stock_keeps_waiting(
    db_session, production_service, current_user, process, raw_material, complement_item
):
    order = _start_order(production_service, current_user)
    result = production_service.start_stage_attempt(
        order.id,
        StageAttemptCreate(
            process_id=process.id,
            responsable_name="Ana",
            materials=[StageAttemptMaterialLine(item_id=raw_material.id, quantity=Decimal("100"))],
            product=_product(complement_item),
        ),
        current_user,
    )
    waiting = next(a for a in result.stage_attempts if a.status == "PENDIENTE_MATERIAL")

    raw_material.current_stock = Decimal("30")
    db_session.flush()

    updated = production_service.allocate_stage_attempt_material(waiting.id, current_user)

    reloaded = next(a for a in updated.stage_attempts if a.id == waiting.id)
    assert reloaded.status == "PENDIENTE_MATERIAL"
    assert reloaded.materials[0].quantity_pending == Decimal("70")
    db_session.refresh(raw_material)
    assert raw_material.current_stock == Decimal("0")


def test_allocate_stage_attempt_material_no_stock_is_a_noop(
    production_service, current_user, process, raw_material, complement_item
):
    order = _start_order(production_service, current_user)
    result = production_service.start_stage_attempt(
        order.id,
        StageAttemptCreate(
            process_id=process.id,
            responsable_name="Ana",
            materials=[StageAttemptMaterialLine(item_id=raw_material.id, quantity=Decimal("100"))],
            product=_product(complement_item),
        ),
        current_user,
    )
    waiting = next(a for a in result.stage_attempts if a.status == "PENDIENTE_MATERIAL")

    updated = production_service.allocate_stage_attempt_material(waiting.id, current_user)

    reloaded = next(a for a in updated.stage_attempts if a.id == waiting.id)
    assert reloaded.status == "PENDIENTE_MATERIAL"
    assert reloaded.materials[0].quantity_pending == Decimal("100")


def test_allocate_stage_attempt_material_full_stock_but_another_attempt_active_stays_waiting(
    db_session, production_service, current_user, process, raw_material, complement_item
):
    # Stock parcial (60/100) al iniciar: la cubierta arranca EN_PROCESO YA y
    # sigue asi (nunca se finaliza en este test) -- la que queda esperando es
    # el remanente de 40.
    raw_material.current_stock = Decimal("60")
    db_session.flush()
    order = _start_order(production_service, current_user)
    result = production_service.start_stage_attempt(
        order.id,
        StageAttemptCreate(
            process_id=process.id,
            responsable_name="Ana",
            materials=[StageAttemptMaterialLine(item_id=raw_material.id, quantity=Decimal("100"))],
            product=_product(complement_item),
        ),
        current_user,
    )
    waiting = next(a for a in result.stage_attempts if a.status == "PENDIENTE_MATERIAL")
    covered = next(a for a in result.stage_attempts if a.status == "EN_PROCESO")
    assert waiting.materials[0].quantity_pending == Decimal("40")

    raw_material.current_stock = Decimal("40")
    db_session.flush()

    updated = production_service.allocate_stage_attempt_material(waiting.id, current_user)
    reloaded_covered = next(a for a in updated.stage_attempts if a.id == covered.id)
    reloaded_waiting = next(a for a in updated.stage_attempts if a.id == waiting.id)
    assert reloaded_covered.status == "EN_PROCESO"
    assert reloaded_waiting.status == "PENDIENTE_MATERIAL"
    assert reloaded_waiting.materials[0].quantity_pending == Decimal("0")
    db_session.refresh(raw_material)
    assert raw_material.current_stock == Decimal("0")


def test_allocate_stage_attempt_material_wrong_status_raises(
    production_service, current_user, process, complement_item
):
    order = _start_order(production_service, current_user)
    result = production_service.start_stage_attempt(
        order.id,
        StageAttemptCreate(process_id=process.id, responsable_name="Ana", product=_product(complement_item)),
        current_user,
    )
    running = result.stage_attempts[0]

    with pytest.raises(ProductionDomainError, match="PENDIENTE_MATERIAL"):
        production_service.allocate_stage_attempt_material(running.id, current_user)


def test_allocate_stage_attempt_material_unknown_id_raises_not_found(production_service, current_user):
    with pytest.raises(ProductionNotFoundError):
        production_service.allocate_stage_attempt_material(uuid.uuid4(), current_user)
