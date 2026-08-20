"""Control de calidad universal (Rodrigo, 2026-08-20): toda etapa muestra
✔/✘. ✔ aprueba y calcula merma de los totales del acta (ya no hay
'cantidad de producto' que pedir, los productos ya movieron stock al
iniciar la etapa). ✘ NO cierra el intento -- solo deja un registro en la
bitacora y el acta sigue editable."""
import uuid
from decimal import Decimal

from sqlalchemy import select

from backend.modules.product_types.models import ProductType  # noqa: F401
from backend.modules.production.schemas import (
    AdminActaLineCreate,
    ProductionOrderCreate,
    StageAttemptCreate,
    StageAttemptProductLine,
    StageAttemptReject,
)


def _start(production_service, current_user, process, target_complement, quantity="1"):
    order = production_service.create_order(ProductionOrderCreate(name="Orden calidad test"), current_user)
    return production_service.start_stage_attempt(
        order.id,
        StageAttemptCreate(
            process_id=process.id,
            responsable_name="Ana",
            products=[StageAttemptProductLine(target_item_id=target_complement.id, quantity=Decimal(quantity))],
        ),
        current_user,
    )


def test_approve_closes_the_attempt(db_session, production_service, current_user, process, target_complement):
    result = _start(production_service, current_user, process, target_complement)
    attempt = result.stage_attempts[0]

    approved = production_service.approve_stage_attempt(attempt.id, current_user)

    assert approved.stage_attempts[0].status == "APROBADA"
    decisions = production_service.repository.list_stage_attempt_decisions(attempt.id)
    assert len(decisions) == 1
    assert decisions[0].decision == "APROBADA"


def test_reject_does_not_close_the_attempt(db_session, production_service, current_user, process, target_complement):
    result = _start(production_service, current_user, process, target_complement)
    attempt = result.stage_attempts[0]

    rejected = production_service.reject_stage_attempt(
        attempt.id, StageAttemptReject(reason="Pieza deforme"), current_user
    )

    assert rejected.stage_attempts[0].status == "EN_PROCESO"
    decisions = production_service.repository.list_stage_attempt_decisions(attempt.id)
    assert len(decisions) == 1
    assert decisions[0].decision == "RECHAZADA"
    assert decisions[0].reason == "Pieza deforme"

    # El intento sigue editable y se puede aprobar despues de corregir.
    approved = production_service.approve_stage_attempt(attempt.id, current_user)
    assert approved.stage_attempts[0].status == "APROBADA"
    decisions_after = production_service.repository.list_stage_attempt_decisions(attempt.id)
    assert len(decisions_after) == 2


def test_reject_reason_is_optional(db_session, production_service, current_user, process, target_complement):
    result = _start(production_service, current_user, process, target_complement)
    attempt = result.stage_attempts[0]

    rejected = production_service.reject_stage_attempt(attempt.id, StageAttemptReject(), current_user)

    assert rejected.stage_attempts[0].status == "EN_PROCESO"
    decisions = production_service.repository.list_stage_attempt_decisions(attempt.id)
    assert decisions[0].reason is None


def test_merma_computed_from_entrega_minus_recepcion_totals(
    db_session, production_service, current_user, process, target_complement
):
    """Merma = entrega_total - recepcion_total del intento, ya no hay
    'product_quantity' que pedir por separado."""
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
            products=[StageAttemptProductLine(target_item_id=target_complement.id, quantity=Decimal("1"))],
        ),
        current_user,
    )
    attempt = result.stage_attempts[0]

    production_service.add_admin_acta_line(
        order.id,
        AdminActaLineCreate(side="ENTREGA", item_id=supply.id, quantity=Decimal("100"), stage_attempt_id=attempt.id, note="Se olvido al iniciar"),
        current_user,
    )
    # Devuelve 95 del mismo item -- de los 100 entregados, 95 vuelven, 1 se
    # convirtio en producto (linea PLAN ya creada al iniciar), quedan 4 de
    # merma.
    production_service.add_admin_acta_line(
        order.id,
        AdminActaLineCreate(side="RECEPCION", item_id=supply.id, quantity=Decimal("95"), stage_attempt_id=attempt.id),
        current_user,
    )

    approved = production_service.approve_stage_attempt(attempt.id, current_user)

    done = approved.stage_attempts[0]
    assert done.status == "APROBADA"
    # entrega_total = 100 (supply), recepcion_total = 95 (supply) + 1 (producto) = 96.
    assert done.merma_weight == Decimal("4")


def test_merma_real_se_guarda_en_inventario_como_waste(
    db_session, production_service, current_user, process, raw_material, target_complement
):
    from backend.modules.inventory.models import InventoryItem
    from backend.modules.production.schemas import StageAttemptMaterialLine

    raw_material.current_stock = Decimal("100")
    db_session.flush()
    order = production_service.create_order(ProductionOrderCreate(name="Orden merma inventario"), current_user)
    result = production_service.start_stage_attempt(
        order.id,
        StageAttemptCreate(
            process_id=process.id,
            responsable_name="Ana",
            materials=[StageAttemptMaterialLine(item_id=raw_material.id, quantity=Decimal("100"))],
            products=[StageAttemptProductLine(target_item_id=target_complement.id, quantity=Decimal("90"))],
        ),
        current_user,
    )
    attempt_id = result.stage_attempts[0].id

    production_service.approve_stage_attempt(attempt_id, current_user)

    waste_item = db_session.execute(
        select(InventoryItem).where(
            InventoryItem.item_type == "WASTE",
            InventoryItem.name == f"Merma {process.name}",
        )
    ).scalar_one_or_none()
    assert waste_item is not None
    assert waste_item.current_stock == Decimal("10")
