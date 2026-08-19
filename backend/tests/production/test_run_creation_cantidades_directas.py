import uuid
from decimal import Decimal

import pytest

from backend.modules.production.schemas import ProductionRunCreate, RunProductCreate, RunStageIngredientCreate
from backend.modules.production.service import ProductionDomainError


def test_create_run_uses_quantity_directly_as_total_material(
    production_service, current_user, process, raw_material, target_complement
):
    raw_material.current_stock = Decimal("500")
    payload = ProductionRunCreate(
        process_id=process.id,
        raw_material_item_id=raw_material.id,
        quantity=Decimal("37.5"),
        products=[RunProductCreate(target_item_id=target_complement.id, quantity=Decimal("37.5"))],
    )
    run = production_service.create_run(payload, current_user)

    assert run.quantity == Decimal("37.5")
    assert run.total_required_material == Decimal("37.5")
    assert run.expected_finished_weight == Decimal("37.5")


def test_create_run_rejects_unconfigured_ingredient(
    production_service, current_user, process, raw_material, target_complement, complement_item
):
    payload = ProductionRunCreate(
        process_id=process.id,
        raw_material_item_id=raw_material.id,
        quantity=Decimal("10"),
        products=[RunProductCreate(target_item_id=target_complement.id, quantity=Decimal("10"))],
        stage_ingredients=[RunStageIngredientCreate(process_stage_ingredient_id=uuid.uuid4(), quantity=Decimal("1"))],
    )
    with pytest.raises(ProductionDomainError, match="insumo"):
        production_service.create_run(payload, current_user)


def test_create_run_rejects_duplicate_ingredient_line(
    production_service, current_user, process, raw_material, target_complement
):
    dup_id = uuid.uuid4()
    payload = ProductionRunCreate(
        process_id=process.id,
        raw_material_item_id=raw_material.id,
        quantity=Decimal("10"),
        products=[RunProductCreate(target_item_id=target_complement.id, quantity=Decimal("10"))],
        stage_ingredients=[
            RunStageIngredientCreate(process_stage_ingredient_id=dup_id, quantity=Decimal("3.5")),
            RunStageIngredientCreate(process_stage_ingredient_id=dup_id, quantity=Decimal("1")),
        ],
    )
    with pytest.raises(ProductionDomainError, match="insumo|repitas"):
        production_service.create_run(payload, current_user)
