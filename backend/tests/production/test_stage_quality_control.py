"""Finalizar etapa sin pedir peso: la merma sale de comparar ENTREGA contra
lo devuelto del MISMO item en RECEPCION, y el control de calidad
(Aprobado/Denegado) solo aplica si el proceso lo tiene marcado en el banco
(docs/superpowers/plans/2026-08-19-rediseno-acta-y-ux-produccion.md Task 5)."""
import uuid
from decimal import Decimal

from backend.modules.product_types.models import ProductType  # noqa: F401
from backend.modules.production.schemas import (
    AdminActaLineCreate,
    ProductionOrderCreate,
    RunProductCreate,
    StageAttemptCreate,
    StageAttemptFinish,
)


def _start(production_service, current_user, process, target_complement, quantity=Decimal("1")):
    order = production_service.create_order(ProductionOrderCreate(name="Orden calidad test"), current_user)
    return production_service.start_stage_attempt(
        order.id,
        StageAttemptCreate(
            process_id=process.id,
            responsable_name="Ana",
            product=RunProductCreate(target_item_id=target_complement.id, quantity=quantity),
        ),
        current_user,
    )


def test_finish_without_quality_control_always_approves(
    db_session, production_service, current_user, process, target_complement
):
    process.quality_control = False
    db_session.flush()
    result = _start(production_service, current_user, process, target_complement)
    attempt = result.stage_attempts[0]

    finished = production_service.finish_stage_attempt(attempt.id, StageAttemptFinish(), current_user)

    assert finished.stage_attempts[0].status == "APROBADA"


def test_finish_without_quality_control_ignores_rechazada_decision(
    db_session, production_service, current_user, process, target_complement
):
    process.quality_control = False
    db_session.flush()
    result = _start(production_service, current_user, process, target_complement)
    attempt = result.stage_attempts[0]

    finished = production_service.finish_stage_attempt(
        attempt.id, StageAttemptFinish(decision="RECHAZADA"), current_user
    )

    assert finished.stage_attempts[0].status == "APROBADA"


def test_finish_with_quality_control_can_be_denied(
    db_session, production_service, current_user, process, target_complement
):
    process.quality_control = True
    db_session.flush()
    result = _start(production_service, current_user, process, target_complement)
    attempt = result.stage_attempts[0]

    finished = production_service.finish_stage_attempt(
        attempt.id, StageAttemptFinish(decision="RECHAZADA", rejection_reason="Pieza deforme"), current_user
    )

    rejected = finished.stage_attempts[0]
    assert rejected.status == "RECHAZADA"
    assert rejected.rejection_reason == "Pieza deforme"


def test_merma_computed_from_entrega_minus_same_item_recepcion(
    db_session, production_service, current_user, process, raw_material, target_complement
):
    # La materia prima ya no se puede devolver por RECEPCION (fix Rodrigo
    # 2026-08-20: ya paso a formar parte del producto resultante) -- la merma
    # se demuestra con un insumo (SUPPLY), que si puede devolverse.
    from backend.modules.inventory.models import InventoryItem

    supply = InventoryItem(
        item_type="SUPPLY", name="Insumo test", sku=f"IN-TEST-{uuid.uuid4().hex[:8]}",
        unit_code="g", current_stock=Decimal("100"),
    )
    db_session.add(supply)
    db_session.flush()
    order = production_service.create_order(ProductionOrderCreate(name="Orden merma test"), current_user)
    result = production_service.start_stage_attempt(
        order.id,
        StageAttemptCreate(
            process_id=process.id,
            responsable_name="Ana",
            product=RunProductCreate(target_item_id=target_complement.id, quantity=Decimal("1")),
        ),
        current_user,
    )
    attempt = result.stage_attempts[0]

    production_service.add_admin_acta_line(
        order.id,
        AdminActaLineCreate(
            side="ENTREGA", item_id=supply.id, quantity=Decimal("100"), stage_attempt_id=attempt.id
        ),
        current_user,
    )
    # Devuelve 95 del mismo item -- 5g de merma real. La linea RECEPCION del
    # producto resultante (target_complement, declarada al iniciar la etapa)
    # es un item distinto y no debe contarse para esta merma.
    production_service.add_admin_acta_line(
        order.id,
        AdminActaLineCreate(
            side="RECEPCION", item_id=supply.id, quantity=Decimal("95"), stage_attempt_id=attempt.id
        ),
        current_user,
    )

    finished = production_service.finish_stage_attempt(attempt.id, StageAttemptFinish(), current_user)

    done = finished.stage_attempts[0]
    assert done.status == "APROBADA"
    assert done.merma_weight == Decimal("5")
    assert done.merma_percent == Decimal("5")
