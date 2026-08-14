"""Material adicional pedido mientras la orden esta EN_PROCESO (pieza A)."""
import uuid
from decimal import Decimal

import pytest

from backend.modules.production.models import ActaLineSide, ActaLineSource
from backend.modules.production.schemas import (
    AdditionalMaterialRequestCreate,
    ProductionRunCreate,
    RunProductCreate,
)
from backend.modules.production.service import ProductionDomainError, ProductionNotFoundError


def _in_progress_run(production_service, current_user, process, raw_material, target_complement, quantity="10"):
    raw_material.current_stock = Decimal("1000")
    payload = ProductionRunCreate(
        process_id=process.id,
        raw_material_item_id=raw_material.id,
        quantity=Decimal(quantity),
        assembly_mode="ASIGNAR",
        products=[RunProductCreate(target_item_id=target_complement.id, quantity=Decimal(quantity))],
    )
    run_read = production_service.create_run(payload, current_user)
    production_service.approve_materials(run_read.id, current_user)
    production_service.start_run(run_read.id, current_user)
    return production_service.repository.get_run(run_read.id)


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
    raw_material.current_stock = Decimal("1000")
    payload = ProductionRunCreate(
        process_id=process.id,
        raw_material_item_id=raw_material.id,
        quantity=Decimal("10"),
        assembly_mode="ASIGNAR",
        products=[RunProductCreate(target_item_id=target_complement.id, quantity=Decimal("10"))],
    )
    run_read = production_service.create_run(payload, current_user)

    with pytest.raises(ProductionDomainError, match="EN_PROCESO"):
        production_service.request_additional_material(
            run_read.id,
            AdditionalMaterialRequestCreate(item_id=extra_supply.id, quantity=Decimal("2")),
            current_user,
        )


def test_request_creates_pending_with_active_stage(
    db_session, production_service, current_user, process, raw_material, target_complement, extra_supply
):
    run = _in_progress_run(production_service, current_user, process, raw_material, target_complement)
    active_stage = next(s for s in run.stages if s.status == "EN_PROCESO")

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
    assert request.stage_id == active_stage.id
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
