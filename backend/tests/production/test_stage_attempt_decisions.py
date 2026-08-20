"""Bitacora de decisiones (aprobar/rechazar) por intento de etapa -- ver
docs/superpowers/specs/2026-08-20-acta-v2-sin-splits-design.md."""
from datetime import datetime, timezone
from decimal import Decimal

from backend.modules.product_types.models import ProductType  # noqa: F401
from backend.modules.production.models import ProductionRunStageAttemptDecision
from backend.modules.production.schemas import ProductionOrderCreate, StageAttemptCreate, StageAttemptProductLine


def test_stage_attempt_decision_roundtrip(db_session, production_service, current_user, process, complement_item):
    order = production_service.create_order(ProductionOrderCreate(name="Orden decision test"), current_user)
    result = production_service.start_stage_attempt(
        order.id,
        StageAttemptCreate(
            process_id=process.id,
            responsable_name="Ana",
            products=[StageAttemptProductLine(target_item_id=complement_item.id, quantity=Decimal("1"))],
        ),
        current_user,
    )
    attempt_id = result.stage_attempts[0].id

    decision = ProductionRunStageAttemptDecision(
        stage_attempt_id=attempt_id,
        decision="RECHAZADA",
        reason="Pieza deforme",
        decided_by_user_id=current_user.id,
        decided_at=datetime.now(timezone.utc),
    )
    db_session.add(decision)
    db_session.flush()

    decisions = production_service.repository.list_stage_attempt_decisions(attempt_id)
    assert len(decisions) == 1
    assert decisions[0].decision == "RECHAZADA"
    assert decisions[0].reason == "Pieza deforme"
