"""Dry-run de aprobar materiales: debe listar TODOS los recursos cortos a la
vez (materia prima, complementos e insumos por etapa), no solo el que manda
la fraccion cubierta -- bug reportado con un caso real donde faltaban los
tres a la vez y el aviso solo mencionaba la materia prima."""
import uuid
from decimal import Decimal

import pytest

from backend.modules.inventory.models import InventoryItem
from backend.modules.production.models import ProductionProcessStageIngredient
from backend.modules.production.schemas import (
    ProductionRunCreate,
    RunComplementCreate,
    RunProductCreate,
    RunStageIngredientCreate,
)
from backend.modules.production.service import ProductionDomainError, ProductionNotFoundError


@pytest.fixture()
def supply_item(db_session) -> InventoryItem:
    item = InventoryItem(
        item_type="SUPPLY",
        name="Insumo test",
        sku=f"IN-TEST-{uuid.uuid4().hex[:8]}",
        unit_code="l",
        current_stock=Decimal("0"),
    )
    db_session.add(item)
    db_session.flush()
    return item


def _create_run_short_on_everything(
    db_session, production_service, current_user, process, raw_material, target_complement, supply_item
):
    """300g de materia prima (solo 150 disponibles), 200 und de complemento
    (solo 100 disponibles), 300l de insumo (solo 100 disponibles)."""
    raw_material.current_stock = Decimal("150")
    target_complement.current_stock = Decimal("100")
    supply_item.current_stock = Decimal("100")

    stage = process.stages[0]
    stage_ingredient = ProductionProcessStageIngredient(stage_id=stage.id, inventory_item_id=supply_item.id)
    db_session.add(stage_ingredient)
    db_session.flush()

    payload = ProductionRunCreate(
        process_id=process.id,
        raw_material_item_id=raw_material.id,
        quantity=Decimal("300"),
        assembly_mode="ASIGNAR",
        products=[RunProductCreate(target_item_id=target_complement.id, quantity=Decimal("300"))],
        complements=[RunComplementCreate(item_id=target_complement.id, quantity=Decimal("200"))],
        stage_ingredients=[
            RunStageIngredientCreate(process_stage_ingredient_id=stage_ingredient.id, quantity=Decimal("300"))
        ],
    )
    return production_service.create_run(payload, current_user)


def test_preview_lists_every_short_resource(
    db_session, production_service, current_user, process, raw_material, target_complement, supply_item
):
    run_read = _create_run_short_on_everything(
        db_session, production_service, current_user, process, raw_material, target_complement, supply_item
    )

    preview = production_service.preview_approve_materials(run_read.id)

    assert preview.is_partial is True
    names = {s.name for s in preview.shortages}
    assert names == {raw_material.name, target_complement.name, supply_item.name}
    by_name = {s.name: s for s in preview.shortages}
    assert by_name[raw_material.name].available == Decimal("150")
    assert by_name[raw_material.name].needed == Decimal("300")
    assert by_name[raw_material.name].is_complement is False
    assert by_name[target_complement.name].available == Decimal("100")
    assert by_name[target_complement.name].needed == Decimal("200")
    assert by_name[target_complement.name].is_complement is True
    assert by_name[supply_item.name].available == Decimal("100")
    assert by_name[supply_item.name].needed == Decimal("300")
    assert by_name[supply_item.name].is_complement is True


def test_preview_does_not_mutate_anything(
    db_session, production_service, current_user, process, raw_material, target_complement, supply_item
):
    run_read = _create_run_short_on_everything(
        db_session, production_service, current_user, process, raw_material, target_complement, supply_item
    )

    production_service.preview_approve_materials(run_read.id)

    db_session.refresh(raw_material)
    db_session.refresh(target_complement)
    db_session.refresh(supply_item)
    assert raw_material.current_stock == Decimal("150")
    assert target_complement.current_stock == Decimal("100")
    assert supply_item.current_stock == Decimal("100")
    run = production_service.repository.get_run(run_read.id)
    assert run.status == "PENDIENTE_INVENTARIO"


def test_preview_only_for_pending_inventory_runs(
    db_session, production_service, current_user, process, raw_material, target_complement, supply_item
):
    run_read = _create_run_short_on_everything(
        db_session, production_service, current_user, process, raw_material, target_complement, supply_item
    )
    raw_material.current_stock = Decimal("1000")
    target_complement.current_stock = Decimal("1000")
    supply_item.current_stock = Decimal("1000")
    db_session.flush()
    production_service.approve_materials(run_read.id, current_user)

    with pytest.raises(ProductionDomainError, match="pendientes de Inventario"):
        production_service.preview_approve_materials(run_read.id)


def test_preview_unknown_run_raises_not_found(production_service):
    with pytest.raises(ProductionNotFoundError):
        production_service.preview_approve_materials(uuid.uuid4())
