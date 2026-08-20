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
    StageAttemptProductLine,
    StageAttemptReject,
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
    # Cantidad del producto resultante se declara al iniciar la etapa (ya no
    # al finalizar, Rodrigo 2026-08-20) -- 1 por intento, igual que antes.
    product = StageAttemptProductLine(target_item_id=target_complement.id, quantity=Decimal("1"))

    order = production_service.create_order(ProductionOrderCreate(name="Orden dinamica test"), current_user)

    attempt1 = production_service.start_stage_attempt(
        order.id,
        StageAttemptCreate(process_id=process.id, responsable_name="Juan Perez", products=[product]),
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
            side="ENTREGA", item_id=supply.id, quantity=Decimal("100"), stage_attempt_id=running.id,
            note="Insumo adicional para la etapa",
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

    finished1 = production_service.approve_stage_attempt(running.id, current_user)
    done_attempt = finished1.stage_attempts[0]
    assert done_attempt.status == "APROBADA"
    # 100 entregado - 95 devuelto - 1 que se convirtio en producto = 4.
    assert done_attempt.merma_weight == Decimal("4")
    assert done_attempt.merma_percent == Decimal("4")

    # Segunda etapa, MISMO proceso: attempt_no_for_process debe ser 2, con
    # su propio codigo -02 (seccion 8), y su propia merma independiente.
    attempt2 = production_service.start_stage_attempt(
        order.id,
        StageAttemptCreate(process_id=process.id, responsable_name="Maria Lopez", products=[product]),
        current_user,
    )
    running2 = next(a for a in attempt2.stage_attempts if a.status == "EN_PROCESO")
    assert running2.attempt_no_for_process == 2
    assert running2.code == f"{order.production_code}-{process.name.upper()[:4]}-02"

    production_service.add_admin_acta_line(
        order.id,
        AdminActaLineCreate(
            side="ENTREGA", item_id=supply.id, quantity=Decimal("95"), stage_attempt_id=running2.id,
            note="Insumo adicional para la etapa",
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
    finished2 = production_service.approve_stage_attempt(running2.id, current_user)
    second_attempt = next(a for a in finished2.stage_attempts if a.code and a.code.endswith("-02"))
    # 95 - 90 - 1 = 4, independiente del primer intento.
    assert second_attempt.merma_weight == Decimal("4")

    # El producto resultante ya se declaro al iniciar cada etapa (Task 3):
    # la orden sigue EN_PROCESO -- ya no cierra sola -- y el target acumulo
    # las dos declaraciones (1 + 1).
    assert finished2.status == "EN_PROCESO"
    db_session.refresh(target_complement)
    assert target_complement.current_stock == Decimal("2")


def test_reject_stage_attempt_optional_reason_keeps_attempt_open_for_correction(
    db_session, production_service, current_user, process, target_complement
):
    """Rediseno 2026-08-20: el rechazo (x) ya NO cierra el intento -- solo
    queda una fila en la bitacora de decisiones y el intento sigue
    EN_PROCESO, editable, para que se corrija el acta y se vuelva a aprobar
    o rechazar el MISMO intento (no hay "reiniciar con otro proceso": eso
    pertenecia al split por falta de stock, que ya no existe)."""
    product = StageAttemptProductLine(target_item_id=target_complement.id, quantity=Decimal("1"))

    order = production_service.create_order(ProductionOrderCreate(name="Orden rechazo test"), current_user)
    attempt = production_service.start_stage_attempt(
        order.id,
        StageAttemptCreate(process_id=process.id, responsable_name="Ana", products=[product]),
        current_user,
    )
    running = attempt.stage_attempts[0]

    # Motivo opcional -- Rodrigo: "no, opcional". No debe exigirlo.
    rejected = production_service.reject_stage_attempt(running.id, StageAttemptReject(reason=None), current_user)
    rejected_attempt = rejected.stage_attempts[0]
    assert rejected_attempt.status == "EN_PROCESO"
    assert rejected_attempt.decisions[-1].decision == "RECHAZADA"
    assert rejected_attempt.decisions[-1].reason is None

    # Como el intento sigue abierto, se puede corregir y aprobar el mismo
    # intento a continuacion (no uno nuevo).
    approved = production_service.approve_stage_attempt(running.id, current_user)
    approved_attempt = approved.stage_attempts[0]
    assert approved_attempt.status == "APROBADA"
    assert approved_attempt.id == running.id
    assert len(approved.stage_attempts) == 1


def test_cannot_start_a_second_attempt_while_one_is_in_progress(
    db_session, production_service, current_user, process, target_complement
):
    product = StageAttemptProductLine(target_item_id=target_complement.id, quantity=Decimal("1"))
    order = production_service.create_order(ProductionOrderCreate(name="Orden secuencial test"), current_user)
    production_service.start_stage_attempt(
        order.id,
        StageAttemptCreate(process_id=process.id, responsable_name="Ana", products=[product]),
        current_user,
    )

    with pytest.raises(ProductionDomainError, match="etapa en curso"):
        production_service.start_stage_attempt(
            order.id,
            StageAttemptCreate(process_id=process.id, responsable_name="Otro", products=[product]),
            current_user,
        )


def test_start_stage_attempt_unknown_process_raises_not_found(production_service, current_user, target_complement):
    import uuid

    order = production_service.create_order(ProductionOrderCreate(name="Orden test"), current_user)
    product = StageAttemptProductLine(target_item_id=target_complement.id, quantity=Decimal("1"))

    with pytest.raises(ProductionNotFoundError):
        production_service.start_stage_attempt(
            order.id,
            StageAttemptCreate(process_id=uuid.uuid4(), responsable_name="Ana", products=[product]),
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
    product = StageAttemptProductLine(target_item_id=target_complement.id, quantity=Decimal("1"))
    order = production_service.create_order(ProductionOrderCreate(name="Orden a finalizar"), current_user)
    started = production_service.start_stage_attempt(
        order.id,
        StageAttemptCreate(process_id=process.id, responsable_name="Ana", products=[product]),
        current_user,
    )
    production_service.approve_stage_attempt(started.stage_attempts[0].id, current_user)

    finished = production_service.finish_order(order.id, current_user)

    assert finished.status == "TERMINADA"


def test_finish_order_rejects_with_active_stage(
    db_session, production_service, current_user, process, target_complement
):
    product = StageAttemptProductLine(target_item_id=target_complement.id, quantity=Decimal("1"))
    order = production_service.create_order(ProductionOrderCreate(name="Orden con etapa activa"), current_user)
    production_service.start_stage_attempt(
        order.id,
        StageAttemptCreate(process_id=process.id, responsable_name="Ana", products=[product]),
        current_user,
    )

    with pytest.raises(ProductionDomainError, match="etapa en curso"):
        production_service.finish_order(order.id, current_user)


def test_finish_order_unknown_run_raises_not_found(production_service, current_user):
    import uuid

    with pytest.raises(ProductionNotFoundError):
        production_service.finish_order(uuid.uuid4(), current_user)
