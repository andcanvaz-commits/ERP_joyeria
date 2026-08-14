"""CRUD de la acta persistida: agregar/editar/borrar lineas a mano (pieza D)."""
import uuid
from decimal import Decimal

import pytest

from backend.modules.production.models import ActaLineSource
from backend.modules.production.schemas import (
    ActaLineCreate,
    ActaLineUpdate,
    ProductionRunCreate,
    RunProductCreate,
)
from backend.modules.production.service import ProductionDomainError, ProductionNotFoundError


def _create_run(production_service, current_user, process, raw_material, target_complement, quantity="10"):
    raw_material.current_stock = Decimal("1000")
    payload = ProductionRunCreate(
        process_id=process.id,
        raw_material_item_id=raw_material.id,
        quantity=Decimal(quantity),
        assembly_mode="ASIGNAR",
        products=[RunProductCreate(target_item_id=target_complement.id, quantity=Decimal(quantity))],
    )
    run_read = production_service.create_run(payload, current_user)
    return production_service.repository.get_run(run_read.id)


def test_add_acta_line_creates_manual_line(
    db_session, production_service, current_user, process, raw_material, target_complement
):
    run = _create_run(production_service, current_user, process, raw_material, target_complement)

    run_read = production_service.add_acta_line(
        run.id,
        ActaLineCreate(side="ENTREGA", label="Ácido nítrico", quantity=Decimal("50"), unit_code="ml", note="Limpieza extra"),
        current_user,
    )

    manual_lines = [line for line in run_read.acta_lines if line.source == "MANUAL"]
    assert len(manual_lines) == 1
    assert manual_lines[0].label == "Ácido nítrico"
    assert manual_lines[0].quantity == Decimal("50")
    assert manual_lines[0].unit_code == "ml"
    assert manual_lines[0].note == "Limpieza extra"
    assert manual_lines[0].created_by_name is not None


def test_update_acta_line_changes_only_given_fields(
    db_session, production_service, current_user, process, raw_material, target_complement
):
    run = _create_run(production_service, current_user, process, raw_material, target_complement)
    run_read = production_service.add_acta_line(
        run.id,
        ActaLineCreate(side="ENTREGA", label="Ácido nítrico", quantity=Decimal("50"), unit_code="ml"),
        current_user,
    )
    line_id = [line for line in run_read.acta_lines if line.source == "MANUAL"][0].id

    updated = production_service.update_acta_line(line_id, ActaLineUpdate(quantity=Decimal("75")), current_user)

    manual_line = [line for line in updated.acta_lines if line.source == "MANUAL"][0]
    assert manual_line.quantity == Decimal("75")
    assert manual_line.label == "Ácido nítrico"
    assert manual_line.unit_code == "ml"


def test_update_acta_line_allows_editing_plan_line(
    db_session, production_service, current_user, process, raw_material, target_complement
):
    run = _create_run(production_service, current_user, process, raw_material, target_complement)
    plan_line = run.acta_lines[0]
    assert plan_line.source == "PLAN"

    updated = production_service.update_acta_line(
        plan_line.id, ActaLineUpdate(quantity=Decimal("99")), current_user
    )

    edited = next(line for line in updated.acta_lines if line.id == plan_line.id)
    assert edited.quantity == Decimal("99")
    assert edited.source == "PLAN"


def test_delete_manual_line_removes_it(
    db_session, production_service, current_user, process, raw_material, target_complement
):
    run = _create_run(production_service, current_user, process, raw_material, target_complement)
    run_read = production_service.add_acta_line(
        run.id,
        ActaLineCreate(side="ENTREGA", label="Ácido nítrico", quantity=Decimal("50"), unit_code="ml"),
        current_user,
    )
    line_id = [line for line in run_read.acta_lines if line.source == "MANUAL"][0].id

    result = production_service.delete_acta_line(line_id, current_user)

    assert all(line.id != line_id for line in result.acta_lines)


def test_delete_rejects_plan_line(
    db_session, production_service, current_user, process, raw_material, target_complement
):
    run = _create_run(production_service, current_user, process, raw_material, target_complement)
    plan_line = run.acta_lines[0]

    with pytest.raises(ProductionDomainError, match="a mano"):
        production_service.delete_acta_line(plan_line.id, current_user)


def test_update_missing_line_raises_not_found(production_service, current_user):
    with pytest.raises(ProductionNotFoundError):
        production_service.update_acta_line(uuid.uuid4(), ActaLineUpdate(quantity=Decimal("1")), current_user)
