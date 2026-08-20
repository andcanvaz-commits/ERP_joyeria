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
    ActaLineUpdate,
    AdminActaLineCreate,
    ProductionOrderCreate,
    StageAttemptCreate,
    StageAttemptMaterialLine,
    StageAttemptProductLine,
)
from backend.modules.production.service import ProductionDomainError, ProductionNotFoundError
from backend.tests.production.test_cancel_run import _run_with_consumed_material


def test_revert_stage_attempt_restores_material_and_removes_conversion(
    db_session, production_service, current_user, process, raw_material, target_complement
):
    run = _run_with_consumed_material(db_session, production_service, current_user, process, raw_material, target_complement)
    attempt_id = run.stage_attempts[0].id
    production_service.approve_stage_attempt(attempt_id, current_user)
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
            products=[StageAttemptProductLine(target_item_id=target_complement.id, quantity=Decimal("60"))],
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
    production_service.approve_stage_attempt(attempt_id, current_user)
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
            products=[StageAttemptProductLine(target_item_id=target_complement.id, quantity=Decimal("1"))],
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
    production_service.approve_stage_attempt(attempt_id, current_user)

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

    started1 = production_service.start_stage_attempt(
        order.id,
        StageAttemptCreate(
            process_id=process.id, responsable_name="Ana",
            materials=[StageAttemptMaterialLine(item_id=raw_material.id, quantity=Decimal("100"))],
            products=[StageAttemptProductLine(target_item_id=target_complement.id, quantity=Decimal("100"))],
        ),
        current_user,
    )
    attempt1_id = started1.stage_attempts[0].id
    production_service.approve_stage_attempt(attempt1_id, current_user)

    started2 = production_service.start_stage_attempt(
        order.id,
        StageAttemptCreate(
            process_id=process.id, responsable_name="Luis",
            materials=[StageAttemptMaterialLine(item_id=raw_material.id, quantity=Decimal("100"))],
            products=[StageAttemptProductLine(target_item_id=target_complement.id, quantity=Decimal("100"))],
        ),
        current_user,
    )
    attempt2_id = next(a.id for a in started2.stage_attempts if a.status == "EN_PROCESO")
    production_service.approve_stage_attempt(attempt2_id, current_user)

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


# ---------------------------------------------------------------------------
# Regresion de la revision de f608339 (feat(produccion): start_stage_attempt
# sin split + control de calidad universal): revert_stage_attempt/
# _revert_admin_stock_lines se reescribieron para el mecanismo nuevo (stock
# directo, sin lote) y quedaron 3 bugs -- ver
# docs/superpowers/specs/2026-08-20-acta-v2-sin-splits-design.md, "Addendum:
# unificacion necesaria".
# ---------------------------------------------------------------------------


def test_revert_stage_attempt_old_flow_lot_then_cancel_does_not_double_subtract(
    db_session, production_service, current_user, process, raw_material, catalog_finished_item
):
    """Bug 1: un run del flujo VIEJO (de antes de f608339) tiene un lote
    intermedio -- finish_stage_attempt, ya borrado, era la unica funcion que
    lo creaba (via get_or_create_finished_product_lot + convert_lot_to_product),
    asi se simula a mano aca. Revertir la etapa debe usar
    reverse_stage_attempt_product (la MISMA referencia "production_order" que
    reverse_finished_product_lot usa despues para no repetir la resta) --
    no un AJUSTE_NEGATIVO plano con reference_type="production_run", que la
    deja invisible para esa funcion y duplica la resta del destino al cancelar
    la orden completa."""
    from sqlalchemy import select

    from backend.modules.inventory.models import InventoryMovement
    from backend.modules.inventory.schemas import LotConversionCreate
    from backend.modules.production.models import (
        ActaLineSide,
        ActaLineSource,
        ProductionRun,
        ProductionRunActaLine,
        ProductionRunStageAttempt,
        ProductionRunStatus,
        StageAttemptStatus,
    )

    raw_material.current_stock = Decimal("100")
    db_session.flush()
    inventory_service = production_service.inventory_service

    run = ProductionRun(
        process_id=process.id,
        process_name=process.name,
        status=ProductionRunStatus.IN_PROGRESS,
        raw_material_item_id=raw_material.id,
        raw_material_unit_code=raw_material.unit_code,
        created_by_user_id=current_user.id,
    )
    db_session.add(run)
    db_session.flush()
    run.production_code = f"OP-TEST-{uuid.uuid4().hex[:6]}"
    db_session.flush()

    # Consumo de materia prima al estilo viejo (consume_material_for_production,
    # referenciado por production_run/run.id -- lo que reverse_production_consumption
    # espera).
    inventory_service.consume_material_for_production(
        item_id=raw_material.id, quantity=Decimal("100"), production_run_id=run.id, user_id=current_user.id,
    )

    attempt = ProductionRunStageAttempt(
        run_id=run.id, process_id=process.id, process_name=process.name,
        sequence_order=1, attempt_no_for_process=1, code="FUN-OP0001-01",
        status=StageAttemptStatus.APPROVED, target_item_id=catalog_finished_item.id,
        peso_al_finalizar=Decimal("100"), unit_code="g",
    )
    run.stage_attempts.append(attempt)
    db_session.flush()

    entrega_line = ProductionRunActaLine(
        side=ActaLineSide.ENTREGA, label=raw_material.name, quantity=Decimal("100"),
        unit_code="g", item_id=raw_material.id, source=ActaLineSource.PLAN,
        line_order=0, stage_attempt_id=attempt.id, created_by_user_id=current_user.id,
    )
    run.acta_lines.append(entrega_line)
    db_session.flush()

    # El lote intermedio, igual que lo dejaba la finish_stage_attempt borrada.
    lot = inventory_service.get_or_create_finished_product_lot(
        run=run, quantity=Decimal("100"), material_type="Oro", purity="18k",
        received_by_user_id=current_user.id, unit_code="g",
    )
    converted = inventory_service.convert_lot_to_product(
        lot.id, LotConversionCreate(target_item_id=catalog_finished_item.id, quantity=Decimal("100")),
        user_id=current_user.id,
    )
    target = db_session.get(type(catalog_finished_item), converted.id)
    assert target.current_stock == Decimal("100")

    recepcion_line = ProductionRunActaLine(
        side=ActaLineSide.RECEPCION, label=target.name, quantity=Decimal("100"),
        unit_code="g", item_id=target.id, source=ActaLineSource.PLAN,
        line_order=0, stage_attempt_id=attempt.id, created_by_user_id=current_user.id,
    )
    run.acta_lines.append(recepcion_line)
    db_session.flush()

    production_service.revert_stage_attempt(attempt.id, current_user, "revierto etapa del flujo viejo")

    db_session.refresh(raw_material)
    db_session.refresh(target)
    assert raw_material.current_stock == Decimal("100")
    assert target.current_stock == Decimal("0")

    # La reversion de arriba debe haber quedado marcada con la MISMA
    # referencia que usa reverse_finished_product_lot -- si no, cancelar la
    # orden completa ahora repetiria la resta y dejaria el destino en negativo
    # (bloqueado) o de menos.
    marker = db_session.execute(
        select(InventoryMovement).where(
            InventoryMovement.item_id == target.id,
            InventoryMovement.movement_type == "AJUSTE_NEGATIVO",
            InventoryMovement.reference_type == "production_order",
            InventoryMovement.reference_id == run.id,
        )
    ).scalars().all()
    assert len(marker) == 1
    assert marker[0].quantity == Decimal("100")

    # Cancela la orden completa: reverse_finished_product_lot debe ver la
    # reversion de arriba ya hecha (misma referencia) y no repetirla.
    production_service.cancel_run(run.id, current_user, "cancelacion total tras revertir la etapa")

    db_session.refresh(raw_material)
    db_session.refresh(target)
    assert raw_material.current_stock == Decimal("100")  # sin doble reversion
    assert target.current_stock == Decimal("0")  # sin doble resta (bug 1)


def test_cancel_run_chained_stages_does_not_spuriously_fail_on_reversal_order(
    db_session, production_service, current_user, process, raw_material, target_complement, complement_item
):
    """Bug 2: etapa 1 produce X (target_complement); etapa 2 consume X como
    Entrada y produce Y (complement_item). Al cancelar la orden completa,
    revertir la RECEPCION de la etapa 1 (resta X) antes que la ENTREGA de la
    etapa 2 (devuelve X) encuentra X en 0 -- ya lo consumio la etapa 2 hacia
    adelante -- y el chequeo de stock de _apply_admin_acta_line_delta lo
    bloquea sin que haya, en neto, ningun problema real. Fix: procesar TODAS
    las reversiones ENTREGA antes que las RECEPCION."""
    raw_material.current_stock = Decimal("100")
    db_session.flush()
    order = production_service.create_order(ProductionOrderCreate(name="Orden encadenada"), current_user)

    started1 = production_service.start_stage_attempt(
        order.id,
        StageAttemptCreate(
            process_id=process.id, responsable_name="Ana",
            materials=[StageAttemptMaterialLine(item_id=raw_material.id, quantity=Decimal("100"))],
            products=[StageAttemptProductLine(target_item_id=target_complement.id, quantity=Decimal("100"))],
        ),
        current_user,
    )
    attempt1_id = started1.stage_attempts[0].id
    production_service.approve_stage_attempt(attempt1_id, current_user)

    db_session.refresh(raw_material)
    db_session.refresh(target_complement)
    assert raw_material.current_stock == Decimal("0")
    assert target_complement.current_stock == Decimal("100")

    started2 = production_service.start_stage_attempt(
        order.id,
        StageAttemptCreate(
            process_id=process.id, responsable_name="Luis",
            materials=[StageAttemptMaterialLine(item_id=target_complement.id, quantity=Decimal("100"))],
            products=[StageAttemptProductLine(target_item_id=complement_item.id, quantity=Decimal("100"))],
        ),
        current_user,
    )
    attempt2_id = next(a.id for a in started2.stage_attempts if a.status == "EN_PROCESO")
    production_service.approve_stage_attempt(attempt2_id, current_user)

    db_session.refresh(target_complement)
    db_session.refresh(complement_item)
    assert target_complement.current_stock == Decimal("0")
    assert complement_item.current_stock == Decimal("100")

    # No debe lanzar ProductionDomainError por un chequeo de stock espurio.
    production_service.cancel_run(order.id, current_user, "ya no se necesita esta orden")

    db_session.refresh(raw_material)
    db_session.refresh(target_complement)
    db_session.refresh(complement_item)
    assert raw_material.current_stock == Decimal("100")
    assert target_complement.current_stock == Decimal("0")
    assert complement_item.current_stock == Decimal("0")


def test_revert_stage_attempt_after_editing_recepcion_line_uses_ledger_not_stale_quantity(
    db_session, production_service, current_user, process, raw_material, target_complement
):
    """Bug 3: revert_stage_attempt revertia por line.quantity en vez de por
    el ledger de movimientos (reference_type="production_run_acta_line").
    update_acta_line, para una linea PLAN, solo cambia el campo quantity --
    no vuelve a mover stock -- asi que despues de editarla, line.quantity
    (lo que dice el acta) y el ledger (lo que en verdad se movio) quedan
    desalineados. _apply_admin_acta_line_delta(line, 0, ...) revierte por el
    ledger, sin importar que diga line.quantity."""
    raw_material.current_stock = Decimal("100")
    db_session.flush()
    order = production_service.create_order(ProductionOrderCreate(name="Orden edicion + revert"), current_user)
    started = production_service.start_stage_attempt(
        order.id,
        StageAttemptCreate(
            process_id=process.id, responsable_name="Ana",
            materials=[StageAttemptMaterialLine(item_id=raw_material.id, quantity=Decimal("100"))],
            products=[StageAttemptProductLine(target_item_id=target_complement.id, quantity=Decimal("50"))],
        ),
        current_user,
    )
    attempt_id = started.stage_attempts[0].id
    run = production_service.repository.get_run(order.id)
    recepcion_line = next(
        line for line in run.acta_lines
        if line.stage_attempt_id == attempt_id and line.side == "RECEPCION"
    )
    db_session.refresh(target_complement)
    assert target_complement.current_stock == Decimal("50")  # lo que en verdad se movio

    # Editar la linea a mano: el campo cambia (40), pero el ledger real de
    # movimientos sigue en 50 -- update_acta_line no vuelve a mover stock
    # para una linea PLAN.
    production_service.update_acta_line(recepcion_line.id, ActaLineUpdate(quantity=Decimal("40")), current_user)
    db_session.refresh(target_complement)
    assert target_complement.current_stock == Decimal("50")  # sin cambios reales de stock

    production_service.approve_stage_attempt(attempt_id, current_user)
    production_service.revert_stage_attempt(attempt_id, current_user, "corrijo etapa")

    db_session.refresh(target_complement)
    db_session.refresh(raw_material)
    # Si revirtiera por line.quantity (40, el valor editado y stale) en vez
    # del ledger (50, lo que en verdad se movio), target_complement quedaria
    # en 10 -- 1 unidad de menos que nunca se devolvio.
    assert target_complement.current_stock == Decimal("0")
    assert raw_material.current_stock == Decimal("100")
