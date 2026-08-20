"""Entrada al iniciar un intento de etapa: sin split, tope = stock
disponible (docs/superpowers/specs/2026-08-20-acta-v2-sin-splits-design.md)."""
from decimal import Decimal

import pytest

from backend.modules.product_types.models import ProductType  # noqa: F401
from backend.modules.production.schemas import (
    ProductionOrderCreate,
    StageAttemptCreate,
    StageAttemptMaterialLine,
    StageAttemptProductLine,
)
from backend.modules.production.service import ProductionDomainError


def _start_order(production_service, current_user):
    return production_service.create_order(ProductionOrderCreate(name="Orden material test"), current_user)


def _product(item, quantity="1") -> StageAttemptProductLine:
    return StageAttemptProductLine(target_item_id=item.id, quantity=Decimal(quantity))


def test_start_stage_attempt_without_materials_starts_directly(
    production_service, current_user, process, complement_item
):
    order = _start_order(production_service, current_user)

    result = production_service.start_stage_attempt(
        order.id,
        StageAttemptCreate(process_id=process.id, responsable_name="Ana", products=[_product(complement_item)]),
        current_user,
    )

    assert len(result.stage_attempts) == 1
    assert result.stage_attempts[0].status == "EN_PROCESO"
    assert result.stage_attempts[0].materials == []
    recepcion_lines = [l for l in result.acta_lines if l.side == "RECEPCION"]
    assert len(recepcion_lines) == 1
    assert recepcion_lines[0].quantity == Decimal("1")


def test_start_stage_attempt_requires_at_least_one_product(process):
    from pydantic import ValidationError

    with pytest.raises(ValidationError):
        StageAttemptCreate(process_id=process.id, responsable_name="Ana", products=[])


def test_start_stage_attempt_consumes_entrada_and_moves_stock(
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
            products=[_product(complement_item)],
        ),
        current_user,
    )

    assert len(result.stage_attempts) == 1
    attempt = result.stage_attempts[0]
    assert attempt.status == "EN_PROCESO"
    db_session.refresh(raw_material)
    assert raw_material.current_stock == Decimal("0")
    entrega_lines = [line for line in attempt.acta_lines if line.side == "ENTREGA"]
    assert len(entrega_lines) == 1
    assert entrega_lines[0].quantity == Decimal("100")


def test_start_stage_attempt_blocks_entrada_above_available_stock(
    db_session, production_service, current_user, process, raw_material, complement_item
):
    raw_material.current_stock = Decimal("60")
    db_session.flush()
    order = _start_order(production_service, current_user)

    with pytest.raises(ProductionDomainError, match="no hay suficiente stock"):
        production_service.start_stage_attempt(
            order.id,
            StageAttemptCreate(
                process_id=process.id,
                responsable_name="Ana",
                materials=[StageAttemptMaterialLine(item_id=raw_material.id, quantity=Decimal("100"))],
                products=[_product(complement_item)],
            ),
            current_user,
        )

    # No debe haber creado ningun intento a medias.
    order_after = production_service.repository.get_run(order.id)
    assert order_after.stage_attempts == []
    db_session.refresh(raw_material)
    assert raw_material.current_stock == Decimal("60")


def test_start_stage_attempt_blocks_entrada_with_zero_stock(
    db_session, production_service, current_user, process, raw_material, complement_item
):
    order = _start_order(production_service, current_user)

    with pytest.raises(ProductionDomainError, match="no hay suficiente stock"):
        production_service.start_stage_attempt(
            order.id,
            StageAttemptCreate(
                process_id=process.id,
                responsable_name="Ana",
                materials=[StageAttemptMaterialLine(item_id=raw_material.id, quantity=Decimal("1"))],
                products=[_product(complement_item)],
            ),
            current_user,
        )


def test_start_stage_attempt_multiple_products_move_stock_immediately(
    db_session, production_service, current_user, process, complement_item, target_complement
):
    order = _start_order(production_service, current_user)

    result = production_service.start_stage_attempt(
        order.id,
        StageAttemptCreate(
            process_id=process.id,
            responsable_name="Ana",
            products=[_product(complement_item, "2"), _product(target_complement, "3")],
        ),
        current_user,
    )

    attempt = result.stage_attempts[0]
    recepcion_lines = {l.item_id: l.quantity for l in attempt.acta_lines if l.side == "RECEPCION"}
    assert recepcion_lines[complement_item.id] == Decimal("2")
    assert recepcion_lines[target_complement.id] == Decimal("3")
    db_session.refresh(complement_item)
    db_session.refresh(target_complement)
    assert complement_item.current_stock == Decimal("2")
    assert target_complement.current_stock == Decimal("3")
