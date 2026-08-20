"""Flujo dinamico de produccion (docs/cambios-sistema-produccion.md secciones
2.3, 3, 4, 5, 8): crear orden solo con nombre, elegir proceso del banco etapa
por etapa, acta directa sin aprobacion, asignar a producto terminado en
cualquier momento."""
import uuid
from decimal import Decimal

import pytest

# Import necesario aunque no se use directamente: registra la tabla
# product_types en el metadata de SQLAlchemy antes del flush (ProductionRun
# tiene un FK a product_types.id). Mismo patron que
# test_models_cantidades_directas.py.
from backend.modules.product_types.models import ProductType  # noqa: F401
from backend.modules.production.schemas import (
    AdminActaLineCreate,
    ProductionOrderCreate,
    StageAttemptCreate,
    StageAttemptFinish,
    StageAttemptProductTarget,
)
from backend.modules.production.service import ProductionDomainError, ProductionNotFoundError


def test_create_order_needs_only_a_name(production_service, current_user):
    order = production_service.create_order(ProductionOrderCreate(name="Cadenas cubanas lote agosto"), current_user)

    assert order.name == "Cadenas cubanas lote agosto"
    assert order.status == "EN_PROCESO"
    assert order.production_code is not None
    assert order.stage_attempts == []


def test_full_happy_path_two_attempts_same_process(
    db_session, production_service, current_user, process, raw_material, target_complement
):
    from backend.modules.inventory.models import InventoryItem

    raw_material.current_stock = Decimal("2000")
    supply = InventoryItem(
        item_type="SUPPLY", name="Insumo test", sku=f"IN-TEST-{uuid.uuid4().hex[:8]}",
        unit_code="g", current_stock=Decimal("1000"),
    )
    db_session.add(supply)
    db_session.flush()
    product = StageAttemptProductTarget(target_item_id=target_complement.id)

    order = production_service.create_order(ProductionOrderCreate(name="Orden dinamica test"), current_user)

    attempt1 = production_service.start_stage_attempt(
        order.id,
        StageAttemptCreate(process_id=process.id, responsable_name="Juan Perez", product=product),
        current_user,
    )
    running = attempt1.stage_attempts[0]
    assert running.status == "EN_PROCESO"
    assert running.attempt_no_for_process == 1
    assert running.code == f"{order.production_code}-{process.name.upper()[:4]}-01"

    # Entrega directa a la etapa activa -- sin aprobacion, mueve stock ya.
    # La materia prima no se devuelve por RECEPCION (fix Rodrigo 2026-08-20:
    # ya paso a formar parte del producto resultante) -- la merma de esta
    # prueba se demuestra con un insumo (SUPPLY), que si puede devolverse.
    production_service.add_admin_acta_line(
        order.id,
        AdminActaLineCreate(
            side="ENTREGA", item_id=supply.id, quantity=Decimal("100"), stage_attempt_id=running.id
        ),
        current_user,
    )
    db_session.refresh(supply)
    assert supply.current_stock == Decimal("900")

    # Devuelve 95 del mismo item (sobrante) -- la merma sale de esta resta,
    # no de un peso al finalizar (Task 5). La linea RECEPCION del producto
    # resultante (target_complement, declarada al iniciar la etapa) es un
    # item distinto y no cuenta para esta merma.
    production_service.add_admin_acta_line(
        order.id,
        AdminActaLineCreate(
            side="RECEPCION", item_id=supply.id, quantity=Decimal("95"), stage_attempt_id=running.id
        ),
        current_user,
    )

    finished1 = production_service.finish_stage_attempt(
        running.id, StageAttemptFinish(decision="APROBADA", product_quantity=Decimal("1")), current_user
    )
    done_attempt = finished1.stage_attempts[0]
    assert done_attempt.status == "APROBADA"
    # 100 entregado - 95 devuelto - 1 que se convirtio en producto = 4.
    assert done_attempt.merma_weight == Decimal("4")
    assert done_attempt.merma_percent == Decimal("4")

    # Segunda etapa, MISMO proceso: attempt_no_for_process debe ser 2, con
    # su propio codigo -02 (seccion 8), y su propia merma independiente.
    attempt2 = production_service.start_stage_attempt(
        order.id,
        StageAttemptCreate(process_id=process.id, responsable_name="Maria Lopez", product=product),
        current_user,
    )
    running2 = next(a for a in attempt2.stage_attempts if a.status == "EN_PROCESO")
    assert running2.attempt_no_for_process == 2
    assert running2.code == f"{order.production_code}-{process.name.upper()[:4]}-02"

    production_service.add_admin_acta_line(
        order.id,
        AdminActaLineCreate(
            side="ENTREGA", item_id=supply.id, quantity=Decimal("95"), stage_attempt_id=running2.id
        ),
        current_user,
    )
    production_service.add_admin_acta_line(
        order.id,
        AdminActaLineCreate(
            side="RECEPCION", item_id=supply.id, quantity=Decimal("90"), stage_attempt_id=running2.id
        ),
        current_user,
    )
    finished2 = production_service.finish_stage_attempt(
        running2.id, StageAttemptFinish(decision="APROBADA", product_quantity=Decimal("1")), current_user
    )
    second_attempt = next(a for a in finished2.stage_attempts if a.code and a.code.endswith("-02"))
    # 95 - 90 - 1 = 4, independiente del primer intento.
    assert second_attempt.merma_weight == Decimal("4")

    # El producto resultante ya se declaro al iniciar cada etapa (Task 3):
    # la orden sigue EN_PROCESO -- ya no cierra sola -- y el target acumulo
    # las dos declaraciones (1 + 1).
    assert finished2.status == "EN_PROCESO"
    db_session.refresh(target_complement)
    assert target_complement.current_stock == Decimal("2")


def test_reject_stage_attempt_optional_reason_and_restart_with_different_process(
    db_session, production_service, current_user, process, raw_material, target_complement
):
    from backend.modules.production.models import ProductionProcess

    process.quality_control = True
    other_process = ProductionProcess(name="Laminado test", is_active=True)
    db_session.add(other_process)
    db_session.flush()
    product = StageAttemptProductTarget(target_item_id=target_complement.id)

    order = production_service.create_order(ProductionOrderCreate(name="Orden rechazo test"), current_user)
    attempt = production_service.start_stage_attempt(
        order.id,
        StageAttemptCreate(process_id=process.id, responsable_name="Ana", product=product),
        current_user,
    )
    running = attempt.stage_attempts[0]

    # Motivo opcional -- Rodrigo: "no, opcional". No debe exigirlo.
    rejected = production_service.finish_stage_attempt(
        running.id, StageAttemptFinish(decision="RECHAZADA", product_quantity=Decimal("1")), current_user
    )
    rejected_attempt = rejected.stage_attempts[0]
    assert rejected_attempt.status == "RECHAZADA"
    assert rejected_attempt.rejection_reason is None

    # El rechazo no repite el proceso solo -- el usuario elige de nuevo,
    # puede ser uno distinto (seccion 4).
    restarted = production_service.start_stage_attempt(
        order.id,
        StageAttemptCreate(process_id=other_process.id, responsable_name="Luis", product=product),
        current_user,
    )
    new_running = next(a for a in restarted.stage_attempts if a.status == "EN_PROCESO")
    assert new_running.process_id == other_process.id
    assert new_running.attempt_no_for_process == 1
    assert new_running.sequence_order == 2


def test_cannot_start_a_second_attempt_while_one_is_in_progress(
    db_session, production_service, current_user, process, target_complement
):
    product = StageAttemptProductTarget(target_item_id=target_complement.id)
    order = production_service.create_order(ProductionOrderCreate(name="Orden secuencial test"), current_user)
    production_service.start_stage_attempt(
        order.id,
        StageAttemptCreate(process_id=process.id, responsable_name="Ana", product=product),
        current_user,
    )

    with pytest.raises(ProductionDomainError, match="etapa en curso"):
        production_service.start_stage_attempt(
            order.id,
            StageAttemptCreate(process_id=process.id, responsable_name="Otro", product=product),
            current_user,
        )


def test_start_stage_attempt_unknown_process_raises_not_found(production_service, current_user, target_complement):
    import uuid

    order = production_service.create_order(ProductionOrderCreate(name="Orden test"), current_user)
    product = StageAttemptProductTarget(target_item_id=target_complement.id)

    with pytest.raises(ProductionNotFoundError):
        production_service.start_stage_attempt(
            order.id,
            StageAttemptCreate(process_id=uuid.uuid4(), responsable_name="Ana", product=product),
            current_user,
        )


# ---------------------------------------------------------------------------
# Finalizar la orden completa (Rodrigo, 2026-08-20): cada etapa ya declaro su
# producto resultante -- cerrar la orden no mueve inventario, solo la saca de
# "en curso".
# ---------------------------------------------------------------------------


def test_finish_order_closes_run_without_active_stage(
    db_session, production_service, current_user, process, target_complement
):
    product = StageAttemptProductTarget(target_item_id=target_complement.id)
    order = production_service.create_order(ProductionOrderCreate(name="Orden a finalizar"), current_user)
    started = production_service.start_stage_attempt(
        order.id,
        StageAttemptCreate(process_id=process.id, responsable_name="Ana", product=product),
        current_user,
    )
    production_service.finish_stage_attempt(started.stage_attempts[0].id, StageAttemptFinish(product_quantity=Decimal("1")), current_user)

    finished = production_service.finish_order(order.id, current_user)

    assert finished.status == "TERMINADA"


def test_finish_order_rejects_with_active_stage(
    db_session, production_service, current_user, process, target_complement
):
    product = StageAttemptProductTarget(target_item_id=target_complement.id)
    order = production_service.create_order(ProductionOrderCreate(name="Orden con etapa activa"), current_user)
    production_service.start_stage_attempt(
        order.id,
        StageAttemptCreate(process_id=process.id, responsable_name="Ana", product=product),
        current_user,
    )

    with pytest.raises(ProductionDomainError, match="etapa en curso"):
        production_service.finish_order(order.id, current_user)


def test_finish_order_unknown_run_raises_not_found(production_service, current_user):
    import uuid

    with pytest.raises(ProductionNotFoundError):
        production_service.finish_order(uuid.uuid4(), current_user)
