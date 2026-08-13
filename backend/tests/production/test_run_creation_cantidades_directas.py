import uuid
from decimal import Decimal

import pytest

from backend.modules.production.models import ProductionProcessStageIngredient
from backend.modules.production.schemas import (
    ProductionRunCreate,
    RunProductCreate,
    RunStageIngredientCreate,
)
from backend.modules.production.service import ProductionDomainError


@pytest.fixture()
def supply_item(db_session):
    from backend.modules.inventory.models import InventoryItem

    item = InventoryItem(
        item_type="SUPPLY",
        name="Hilo test",
        sku=f"IN-TEST-{uuid.uuid4().hex[:8]}",
        unit_code="m",
        current_stock=Decimal("0"),
    )
    db_session.add(item)
    db_session.flush()
    return item


@pytest.fixture()
def process_with_ingredient(db_session, process, supply_item):
    ingredient = ProductionProcessStageIngredient(inventory_item_id=supply_item.id)
    process.stages[0].ingredients.append(ingredient)
    db_session.flush()
    return process


def test_create_run_uses_quantity_directly_as_total_material(
    production_service, current_user, process, raw_material, target_complement
):
    raw_material.current_stock = Decimal("500")
    payload = ProductionRunCreate(
        process_id=process.id,
        raw_material_item_id=raw_material.id,
        quantity=Decimal("37.5"),
        assembly_mode="ASIGNAR",
        products=[RunProductCreate(target_item_id=target_complement.id, quantity=Decimal("37.5"))],
    )
    run = production_service.create_run(payload, current_user)

    assert run.quantity == Decimal("37.5")
    assert run.total_required_material == Decimal("37.5")
    assert run.expected_finished_weight == Decimal("37.5")


def test_create_run_requires_every_configured_ingredient(
    production_service, current_user, process_with_ingredient, raw_material, target_complement
):
    payload = ProductionRunCreate(
        process_id=process_with_ingredient.id,
        raw_material_item_id=raw_material.id,
        quantity=Decimal("10"),
        assembly_mode="ASIGNAR",
        products=[RunProductCreate(target_item_id=target_complement.id, quantity=Decimal("10"))],
        stage_ingredients=[],
    )
    with pytest.raises(ProductionDomainError, match="insumo"):
        production_service.create_run(payload, current_user)


def test_create_run_rejects_unconfigured_ingredient(
    production_service, current_user, process, raw_material, target_complement, complement_item
):
    payload = ProductionRunCreate(
        process_id=process.id,
        raw_material_item_id=raw_material.id,
        quantity=Decimal("10"),
        assembly_mode="ASIGNAR",
        products=[RunProductCreate(target_item_id=target_complement.id, quantity=Decimal("10"))],
        stage_ingredients=[RunStageIngredientCreate(process_stage_ingredient_id=uuid.uuid4(), quantity=Decimal("1"))],
    )
    with pytest.raises(ProductionDomainError, match="insumo"):
        production_service.create_run(payload, current_user)


def test_create_run_copies_ingredient_quantity_to_run_stage(
    production_service, current_user, process_with_ingredient, raw_material, target_complement, supply_item
):
    config_id = process_with_ingredient.stages[0].ingredients[0].id
    payload = ProductionRunCreate(
        process_id=process_with_ingredient.id,
        raw_material_item_id=raw_material.id,
        quantity=Decimal("10"),
        assembly_mode="ASIGNAR",
        products=[RunProductCreate(target_item_id=target_complement.id, quantity=Decimal("10"))],
        stage_ingredients=[RunStageIngredientCreate(process_stage_ingredient_id=config_id, quantity=Decimal("3.5"))],
    )
    run_read = production_service.create_run(payload, current_user)
    run = production_service.repository.get_run(run_read.id)

    assert len(run.stages[0].ingredients) == 1
    assert run.stages[0].ingredients[0].inventory_item_id == supply_item.id
    assert run.stages[0].ingredients[0].quantity == Decimal("3.5")
    assert run.stages[0].ingredients[0].unit_code == "m"
