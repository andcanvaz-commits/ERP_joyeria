"""Material adicional pedido mientras la orden esta EN_PROCESO (pieza A)."""
import uuid
from decimal import Decimal

import pytest

# Import necesario aunque no se use directamente: registra la tabla
# product_types en el metadata de SQLAlchemy antes del flush (ProductionRun
# tiene un FK a product_types.id). Mismo patron que test_dynamic_flow.py.
from backend.modules.product_types.models import ProductType  # noqa: F401
from backend.modules.production.models import ActaLineSide, ActaLineSource
from backend.modules.production.schemas import (
    AdditionalMaterialRequestCreate,
    ProductionOrderCreate,
    RunProductCreate,
    StageAttemptCreate,
)
from backend.modules.production.service import ProductionDomainError, ProductionNotFoundError


def _in_progress_run(production_service, current_user, process, raw_material, target_complement, quantity="10"):
    raw_material.current_stock = Decimal("1000")
    order = production_service.create_order(ProductionOrderCreate(name="Orden adicional test"), current_user)
    production_service.start_stage_attempt(
        order.id,
        StageAttemptCreate(
            process_id=process.id,
            responsable_name="Ana",
            product=RunProductCreate(target_item_id=target_complement.id, quantity=Decimal("1")),
        ),
        current_user,
    )
    return production_service.repository.get_run(order.id)


@pytest.fixture()
def extra_supply(db_session):
    from backend.modules.inventory.models import InventoryItem

    item = InventoryItem(
        item_type="SUPPLY", name="Lija extra", sku=f"IN-{uuid.uuid4().hex[:8]}", unit_code="und",
        current_stock=Decimal("5"),
    )
    db_session.add(item)
    db_session.flush()
    return item


def test_request_rejects_when_run_not_in_progress(
    db_session, production_service, current_user, process, raw_material, target_complement, extra_supply
):
    order = production_service.create_order(ProductionOrderCreate(name="Orden no en curso"), current_user)
    production_service.cancel_run(order.id, current_user, "motivo")

    with pytest.raises(ProductionDomainError, match="EN_PROCESO"):
        production_service.request_additional_material(
            order.id,
            AdditionalMaterialRequestCreate(item_id=extra_supply.id, quantity=Decimal("2")),
            current_user,
        )


def test_request_creates_pending_when_run_in_progress(
    db_session, production_service, current_user, process, raw_material, target_complement, extra_supply
):
    run = _in_progress_run(production_service, current_user, process, raw_material, target_complement)

    run_read = production_service.request_additional_material(
        run.id,
        AdditionalMaterialRequestCreate(item_id=extra_supply.id, quantity=Decimal("2"), note="Se gasto de mas"),
        current_user,
    )

    assert len(run_read.additional_materials) == 1
    request = run_read.additional_materials[0]
    assert request.status == "PENDIENTE"
    assert request.item_id == extra_supply.id
    assert request.quantity == Decimal("2")
    assert request.unit_code == extra_supply.unit_code
    # request_additional_material busca la etapa activa en run.stages (flujo
    # viejo) -- las ordenes del flujo nuevo nunca llenan esa lista (usan
    # stage_attempts), asi que stage_id queda None. Gap preexistente y fuera
    # de alcance de este cambio (additional_material_requests no se toca).
    assert request.stage_id is None
    assert request.note == "Se gasto de mas"


def test_approve_consumes_stock_and_adds_acta_line(
    db_session, production_service, current_user, process, raw_material, target_complement, extra_supply
):
    run = _in_progress_run(production_service, current_user, process, raw_material, target_complement)
    run_read = production_service.request_additional_material(
        run.id,
        AdditionalMaterialRequestCreate(item_id=extra_supply.id, quantity=Decimal("2")),
        current_user,
    )
    request_id = run_read.additional_materials[0].id

    result = production_service.approve_additional_material(request_id, current_user)

    assert result.additional_materials[0].status == "APROBADA"
    assert result.additional_materials[0].approved_by_name is not None
    db_session.refresh(extra_supply)
    assert extra_supply.current_stock == Decimal("3")

    updated_run = production_service.repository.get_run(run.id)
    auto_lines = [
        line for line in updated_run.acta_lines
        if line.side == ActaLineSide.ENTREGA and line.source == ActaLineSource.AUTO
    ]
    assert len(auto_lines) == 1
    assert auto_lines[0].label == extra_supply.name
    assert auto_lines[0].quantity == Decimal("2")


def test_approve_rejects_without_enough_stock(
    db_session, production_service, current_user, process, raw_material, target_complement, extra_supply
):
    run = _in_progress_run(production_service, current_user, process, raw_material, target_complement)
    run_read = production_service.request_additional_material(
        run.id,
        AdditionalMaterialRequestCreate(item_id=extra_supply.id, quantity=Decimal("999")),
        current_user,
    )
    request_id = run_read.additional_materials[0].id

    with pytest.raises(ProductionDomainError):
        production_service.approve_additional_material(request_id, current_user)

    updated_run = production_service.repository.get_run(run.id)
    assert updated_run.acta_lines == [] or all(
        line.source != ActaLineSource.AUTO for line in updated_run.acta_lines
    )


def test_reject_does_not_touch_stock_or_acta(
    db_session, production_service, current_user, process, raw_material, target_complement, extra_supply
):
    run = _in_progress_run(production_service, current_user, process, raw_material, target_complement)
    run_read = production_service.request_additional_material(
        run.id,
        AdditionalMaterialRequestCreate(item_id=extra_supply.id, quantity=Decimal("2")),
        current_user,
    )
    request_id = run_read.additional_materials[0].id

    result = production_service.reject_additional_material(request_id, "No hacia falta", current_user)

    assert result.additional_materials[0].status == "RECHAZADA"
    assert result.additional_materials[0].rejection_reason == "No hacia falta"
    db_session.refresh(extra_supply)
    assert extra_supply.current_stock == Decimal("5")


def test_approve_already_processed_request_raises(
    db_session, production_service, current_user, process, raw_material, target_complement, extra_supply
):
    run = _in_progress_run(production_service, current_user, process, raw_material, target_complement)
    run_read = production_service.request_additional_material(
        run.id,
        AdditionalMaterialRequestCreate(item_id=extra_supply.id, quantity=Decimal("2")),
        current_user,
    )
    request_id = run_read.additional_materials[0].id
    production_service.approve_additional_material(request_id, current_user)

    with pytest.raises(ProductionDomainError, match="ya fue procesada"):
        production_service.approve_additional_material(request_id, current_user)


def test_approve_missing_request_raises_not_found(production_service, current_user):
    with pytest.raises(ProductionNotFoundError):
        production_service.approve_additional_material(uuid.uuid4(), current_user)
