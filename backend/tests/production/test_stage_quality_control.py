"""Finalizar etapa: la cantidad real del producto resultante se llena aca
(Rodrigo, 2026-08-20 -- ya no viene pre-llena del picker de iniciar etapa) y
recien aca se convierte el lote/mueve inventario. Tope y merma: "no se
trabaja por peso por unidad, es la misma cantidad de la unidad de medida de
la materia prima" (Rodrigo) -- el producto resultante no puede superar lo
entregado menos lo devuelto del mismo item, y la merma es lo que sobra sin
convertirse en producto ni devolverse. El control de calidad
(Aprobado/Denegado) solo aplica si el proceso lo tiene marcado en el banco
(docs/superpowers/plans/2026-08-19-rediseno-acta-y-ux-produccion.md)."""
import uuid
from decimal import Decimal

from backend.modules.product_types.models import ProductType  # noqa: F401
from backend.modules.production.schemas import (
    AdminActaLineCreate,
    ProductionOrderCreate,
    StageAttemptCreate,
    StageAttemptFinish,
    StageAttemptProductTarget,
)


def _start(production_service, current_user, process, target_complement):
    order = production_service.create_order(ProductionOrderCreate(name="Orden calidad test"), current_user)
    return production_service.start_stage_attempt(
        order.id,
        StageAttemptCreate(
            process_id=process.id,
            responsable_name="Ana",
            product=StageAttemptProductTarget(target_item_id=target_complement.id),
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

    finished = production_service.finish_stage_attempt(
        attempt.id, StageAttemptFinish(product_quantity=Decimal("1")), current_user
    )

    assert finished.stage_attempts[0].status == "APROBADA"


def test_finish_without_quality_control_ignores_rechazada_decision(
    db_session, production_service, current_user, process, target_complement
):
    process.quality_control = False
    db_session.flush()
    result = _start(production_service, current_user, process, target_complement)
    attempt = result.stage_attempts[0]

    finished = production_service.finish_stage_attempt(
        attempt.id, StageAttemptFinish(decision="RECHAZADA", product_quantity=Decimal("1")), current_user
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
        attempt.id,
        StageAttemptFinish(decision="RECHAZADA", rejection_reason="Pieza deforme", product_quantity=Decimal("1")),
        current_user,
    )

    rejected = finished.stage_attempts[0]
    assert rejected.status == "RECHAZADA"
    assert rejected.rejection_reason == "Pieza deforme"
    # El producto se registra igual, aunque la etapa haya sido rechazada
    # (Rodrigo: "usar ese producto mal hecho para iniciar otra etapa").
    recepcion_lines = [l for l in rejected.acta_lines if l.side == "RECEPCION"]
    assert len(recepcion_lines) == 1
    assert recepcion_lines[0].quantity == Decimal("1")


def test_finish_requires_product_quantity(
    db_session, production_service, current_user, process, target_complement
):
    import pytest
    from pydantic import ValidationError

    with pytest.raises(ValidationError):
        StageAttemptFinish()


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
            product=StageAttemptProductTarget(target_item_id=target_complement.id),
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
    # Devuelve 95 del mismo item -- queda 5 disponible, del cual 1 se
    # convierte en producto resultante y 4 quedan como merma real.
    production_service.add_admin_acta_line(
        order.id,
        AdminActaLineCreate(
            side="RECEPCION", item_id=supply.id, quantity=Decimal("95"), stage_attempt_id=attempt.id
        ),
        current_user,
    )

    finished = production_service.finish_stage_attempt(
        attempt.id, StageAttemptFinish(product_quantity=Decimal("1")), current_user
    )

    done = finished.stage_attempts[0]
    assert done.status == "APROBADA"
    # 100 entregado - 95 devuelto - 1 que se convirtio en producto = 4.
    assert done.merma_weight == Decimal("4")
    assert done.merma_percent == Decimal("4")


def test_finish_rejects_product_quantity_above_what_was_delivered(
    db_session, production_service, current_user, process, raw_material, target_complement
):
    """Rodrigo, 2026-08-20: "si puse 100 gramos de X para X producto, es la
    misma cantidad de gramos para el producto" -- 1000 unidades de un
    producto no pueden salir de 100g de materia prima entregados."""
    import pytest
    from backend.modules.production.service import ProductionDomainError
    from backend.modules.production.schemas import StageAttemptMaterialLine

    raw_material.current_stock = Decimal("100")
    db_session.flush()
    order = production_service.create_order(ProductionOrderCreate(name="Orden tope test"), current_user)
    result = production_service.start_stage_attempt(
        order.id,
        StageAttemptCreate(
            process_id=process.id,
            responsable_name="Ana",
            materials=[StageAttemptMaterialLine(item_id=raw_material.id, quantity=Decimal("100"))],
            product=StageAttemptProductTarget(target_item_id=target_complement.id),
        ),
        current_user,
    )
    attempt = result.stage_attempts[0]

    with pytest.raises(ProductionDomainError, match="supera lo que en realidad se entrego"):
        production_service.finish_stage_attempt(
            attempt.id, StageAttemptFinish(product_quantity=Decimal("1000")), current_user
        )

    # Exactamente el tope (100) si pasa.
    finished = production_service.finish_stage_attempt(
        attempt.id, StageAttemptFinish(product_quantity=Decimal("100")), current_user
    )
    done = finished.stage_attempts[0]
    assert done.status == "APROBADA"
    assert done.merma_weight == Decimal("0")
