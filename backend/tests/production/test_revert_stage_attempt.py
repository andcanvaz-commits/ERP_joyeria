"""Revertir y eliminar un intento de etapa ya terminado (Rodrigo, 2026-08-20:
"debo poder eliminar y revertir una etapa tambien"). A diferencia de cancelar
una orden (conserva la fila para no perder trazabilidad), una etapa mal
cargada simplemente deja de existir: se deshace su consumo de materia prima,
su conversion de producto resultante, y se borran sus lineas de acta y el
intento mismo.

Los movimientos de inventario no guardan a que etapa pertenecen (solo a la
orden) -- reverse_production_consumption/reverse_finished_product_lot (las
funciones que usa cancelar UNA ORDEN COMPLETA) se hicieron netas de lo ya
revertido para que revertir una etapa puntual y despues cancelar la orden
entera no dupliquen la devolucion (ver test_revert_then_cancel_run_does_not_double_revert)."""
import uuid
from decimal import Decimal

import pytest

from backend.modules.product_types.models import ProductType  # noqa: F401
from backend.modules.production.schemas import (
    AdminActaLineCreate,
    ProductionOrderCreate,
    StageAttemptCreate,
    StageAttemptFinish,
    StageAttemptMaterialLine,
    StageAttemptProductTarget,
)
from backend.modules.production.service import ProductionDomainError, ProductionNotFoundError
from backend.tests.production.test_cancel_run import _run_with_consumed_material


def test_revert_stage_attempt_restores_material_and_removes_conversion(
    db_session, production_service, current_user, process, raw_material, target_complement
):
    run = _run_with_consumed_material(db_session, production_service, current_user, process, raw_material, target_complement)
    attempt_id = run.stage_attempts[0].id
    production_service.finish_stage_attempt(
        attempt_id, StageAttemptFinish(product_quantity=Decimal("100")), current_user
    )
    db_session.refresh(raw_material)
    db_session.refresh(target_complement)
    assert raw_material.current_stock == Decimal("0")
    assert target_complement.current_stock == Decimal("100")

    result = production_service.revert_stage_attempt(attempt_id, current_user, "cargue mal la etapa")

    assert result.stage_attempts == []
    assert result.acta_lines == []
    db_session.refresh(raw_material)
    db_session.refresh(target_complement)
    assert raw_material.current_stock == Decimal("100")
    assert target_complement.current_stock == Decimal("0")


def test_revert_stage_attempt_reverts_admin_stock_supply_return(
    db_session, production_service, current_user, process, raw_material, target_complement
):
    from backend.modules.inventory.models import InventoryItem

    supply = InventoryItem(
        item_type="SUPPLY", name="Insumo test", sku=f"IN-TEST-{uuid.uuid4().hex[:8]}",
        unit_code="g", current_stock=Decimal("1000"),
    )
    db_session.add(supply)
    db_session.flush()
    order = production_service.create_order(ProductionOrderCreate(name="Orden revert insumo"), current_user)
    started = production_service.start_stage_attempt(
        order.id,
        StageAttemptCreate(
            process_id=process.id,
            responsable_name="Ana",
            product=StageAttemptProductTarget(target_item_id=target_complement.id),
        ),
        current_user,
    )
    attempt_id = started.stage_attempts[0].id
    production_service.add_admin_acta_line(
        order.id,
        AdminActaLineCreate(side="ENTREGA", item_id=supply.id, quantity=Decimal("100"), stage_attempt_id=attempt_id),
        current_user,
    )
    production_service.add_admin_acta_line(
        order.id,
        AdminActaLineCreate(side="RECEPCION", item_id=supply.id, quantity=Decimal("40"), stage_attempt_id=attempt_id),
        current_user,
    )
    production_service.finish_stage_attempt(
        attempt_id, StageAttemptFinish(product_quantity=Decimal("60")), current_user
    )
    db_session.refresh(supply)
    assert supply.current_stock == Decimal("940")  # 1000 - 100 entregado + 40 devuelto

    production_service.revert_stage_attempt(attempt_id, current_user, None)

    db_session.refresh(supply)
    assert supply.current_stock == Decimal("1000")  # entrega y devolucion, ambas revertidas


def test_revert_stage_attempt_rejects_in_progress(
    db_session, production_service, current_user, process, target_complement
):
    order = production_service.create_order(ProductionOrderCreate(name="Orden revert en curso"), current_user)
    started = production_service.start_stage_attempt(
        order.id,
        StageAttemptCreate(
            process_id=process.id,
            responsable_name="Ana",
            product=StageAttemptProductTarget(target_item_id=target_complement.id),
        ),
        current_user,
    )
    attempt_id = started.stage_attempts[0].id

    with pytest.raises(ProductionDomainError, match="ya terminada"):
        production_service.revert_stage_attempt(attempt_id, current_user, None)


def test_revert_stage_attempt_blocks_when_product_already_moved(
    db_session, production_service, current_user, process, raw_material, target_complement
):
    run = _run_with_consumed_material(db_session, production_service, current_user, process, raw_material, target_complement)
    attempt_id = run.stage_attempts[0].id
    production_service.finish_stage_attempt(
        attempt_id, StageAttemptFinish(product_quantity=Decimal("100")), current_user
    )

    # Ya se movio de ahi (ej. se vendio/salio): no queda suficiente para revertir.
    target_complement.current_stock = Decimal("0")
    db_session.flush()

    with pytest.raises(ProductionDomainError, match="No se puede revertir"):
        production_service.revert_stage_attempt(attempt_id, current_user, None)

    reloaded = production_service.repository.get_run(run.id)
    assert len(reloaded.stage_attempts) == 1  # no se borro nada


def test_revert_stage_attempt_unknown_id_raises_not_found(production_service, current_user):
    with pytest.raises(ProductionNotFoundError):
        production_service.revert_stage_attempt(uuid.uuid4(), current_user, None)


def test_revert_then_cancel_run_does_not_double_revert(
    db_session, production_service, current_user, process, raw_material, target_complement
):
    """Dos etapas del mismo proceso, cada una consume 100g y convierte 100
    unidades de target_complement. Se revierte SOLO la primera; despues se
    cancela la orden completa. El resultado final debe ser el mismo que si
    nunca hubiera pasado nada -- ni raw_material ni target_complement deben
    terminar con numeros de mas o de menos por la doble reversion."""
    raw_material.current_stock = Decimal("200")
    db_session.flush()
    order = production_service.create_order(ProductionOrderCreate(name="Orden doble reversion"), current_user)
    product = StageAttemptProductTarget(target_item_id=target_complement.id)

    started1 = production_service.start_stage_attempt(
        order.id,
        StageAttemptCreate(
            process_id=process.id, responsable_name="Ana",
            materials=[StageAttemptMaterialLine(item_id=raw_material.id, quantity=Decimal("100"))],
            product=product,
        ),
        current_user,
    )
    attempt1_id = started1.stage_attempts[0].id
    production_service.finish_stage_attempt(
        attempt1_id, StageAttemptFinish(product_quantity=Decimal("100")), current_user
    )

    started2 = production_service.start_stage_attempt(
        order.id,
        StageAttemptCreate(
            process_id=process.id, responsable_name="Luis",
            materials=[StageAttemptMaterialLine(item_id=raw_material.id, quantity=Decimal("100"))],
            product=product,
        ),
        current_user,
    )
    attempt2_id = next(a.id for a in started2.stage_attempts if a.status == "EN_PROCESO")
    production_service.finish_stage_attempt(
        attempt2_id, StageAttemptFinish(product_quantity=Decimal("100")), current_user
    )

    db_session.refresh(raw_material)
    db_session.refresh(target_complement)
    assert raw_material.current_stock == Decimal("0")
    assert target_complement.current_stock == Decimal("200")

    # Revierte SOLO la primera etapa.
    production_service.revert_stage_attempt(attempt1_id, current_user, "error de tipeo")
    db_session.refresh(raw_material)
    db_session.refresh(target_complement)
    assert raw_material.current_stock == Decimal("100")  # devuelto lo de la etapa 1
    assert target_complement.current_stock == Decimal("100")  # quitado lo de la etapa 1

    # Cancela la orden completa (todavia tiene la etapa 2 activa/aprobada).
    production_service.cancel_run(order.id, current_user, "ya no se necesita")

    db_session.refresh(raw_material)
    db_session.refresh(target_complement)
    # Si hubiera doble reversion, raw_material terminaria en 200 (100 de mas)
    # y target_complement en negativo o bloqueado. El resultado correcto es
    # que cancelar solo termina de revertir lo que quedaba (la etapa 2).
    assert raw_material.current_stock == Decimal("200")
    assert target_complement.current_stock == Decimal("0")
