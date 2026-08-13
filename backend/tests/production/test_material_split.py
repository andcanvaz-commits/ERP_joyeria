from decimal import Decimal

from backend.modules.production.models import ProductionProcessStageIngredient, ProductionRunStatus
from backend.modules.production.schemas import ProductionRunCreate, RunProductCreate, RunStageIngredientCreate
from backend.modules.production.service import ProductionDomainError


def _create_run(production_service, current_user, process, raw_material, target_complement, quantity, stage_ingredients=None):
    payload = ProductionRunCreate(
        process_id=process.id,
        raw_material_item_id=raw_material.id,
        quantity=Decimal(quantity),
        assembly_mode="ASIGNAR",
        products=[RunProductCreate(target_item_id=target_complement.id, quantity=Decimal(quantity))],
        complements=[],
        stage_ingredients=stage_ingredients or [],
    )
    return production_service.create_run(payload, current_user)


def test_split_run_creates_waiting_child_with_shared_root_code(
    db_session, production_service, current_user, process, raw_material, target_complement
):
    raw_material.current_stock = Decimal("60")  # 60% de 100g
    db_session.flush()

    run_read = _create_run(production_service, current_user, process, raw_material, target_complement, "100")
    run = production_service.repository.get_run(run_read.id)

    child = production_service._split_run_for_partial_material(run, Decimal("60"))

    assert run.quantity == Decimal("60")
    assert run.total_required_material == Decimal("60")
    assert run.root_production_code == run.production_code

    assert child.status == ProductionRunStatus.WAITING_MATERIAL
    assert child.quantity == Decimal("40")
    assert child.total_required_material == Decimal("40")
    assert child.parent_run_id == run.id
    assert child.root_production_code == run.root_production_code
    assert child.production_code == f"{run.production_code}-B"
    assert len(child.stages) == 1
    assert child.stages[0].stage_code != run.stages[0].stage_code
    assert child.stages[0].stage_code.endswith("-B")

    assert sum(p.quantity for p in run.products) == Decimal("60")
    assert sum(p.quantity for p in child.products) == Decimal("40")


def test_next_split_code_increments_letter_per_child(
    db_session, production_service, current_user, process, raw_material, target_complement
):
    raw_material.current_stock = Decimal("60")
    db_session.flush()
    run_read = _create_run(production_service, current_user, process, raw_material, target_complement, "100")
    run = production_service.repository.get_run(run_read.id)

    first_child = production_service._split_run_for_partial_material(run, Decimal("60"))
    second_child = production_service._split_run_for_partial_material(first_child, Decimal("25"))

    assert first_child.production_code == f"{run.production_code}-B"
    assert second_child.production_code == f"{run.production_code}-C"
    assert second_child.root_production_code == run.production_code

    codes = {run.stages[0].stage_code, first_child.stages[0].stage_code, second_child.stages[0].stage_code}
    assert len(codes) == 3


def test_split_run_splits_complements_proportionally(
    db_session, production_service, current_user, process, raw_material, target_complement, complement_item
):
    from backend.modules.production.schemas import RunComplementCreate

    raw_material.current_stock = Decimal("60")
    db_session.flush()

    payload = ProductionRunCreate(
        process_id=process.id,
        raw_material_item_id=raw_material.id,
        quantity=Decimal("100"),
        assembly_mode="ASIGNAR",
        products=[RunProductCreate(target_item_id=target_complement.id, quantity=Decimal("100"))],
        complements=[RunComplementCreate(item_id=complement_item.id, quantity=Decimal("50"))],
    )
    run_read = production_service.create_run(payload, current_user)
    run = production_service.repository.get_run(run_read.id)

    child = production_service._split_run_for_partial_material(run, Decimal("60"))

    assert run.complements[0].quantity == Decimal("30")
    assert child.complements[0].quantity == Decimal("20")
    assert run.complements[0].quantity + child.complements[0].quantity == Decimal("50")


def test_split_run_splits_stage_ingredients_proportionally(
    db_session, production_service, current_user, process, raw_material, target_complement
):
    from backend.modules.inventory.models import InventoryItem
    import uuid

    supply = InventoryItem(
        item_type="SUPPLY", name="Hilo", sku=f"IN-{uuid.uuid4().hex[:8]}", unit_code="m",
        current_stock=Decimal("0"),
    )
    db_session.add(supply)
    db_session.flush()
    process.stages[0].ingredients.append(ProductionProcessStageIngredient(inventory_item_id=supply.id))
    db_session.flush()
    config_id = process.stages[0].ingredients[0].id

    raw_material.current_stock = Decimal("60")
    db_session.flush()

    run_read = _create_run(
        production_service, current_user, process, raw_material, target_complement, "100",
        stage_ingredients=[RunStageIngredientCreate(process_stage_ingredient_id=config_id, quantity=Decimal("10"))],
    )
    run = production_service.repository.get_run(run_read.id)

    child = production_service._split_run_for_partial_material(run, Decimal("60"))

    assert run.stages[0].ingredients[0].quantity == Decimal("6")
    assert child.stages[0].ingredients[0].quantity == Decimal("4")


def test_split_run_respects_declared_product_line_order_after_reload(
    db_session, production_service, current_user, process, raw_material, target_complement, complement_item
):
    raw_material.current_stock = Decimal("60")
    db_session.flush()

    payload = ProductionRunCreate(
        process_id=process.id,
        raw_material_item_id=raw_material.id,
        quantity=Decimal("100"),
        assembly_mode="ASIGNAR",
        products=[
            RunProductCreate(target_item_id=target_complement.id, quantity=Decimal("70")),
            RunProductCreate(target_item_id=complement_item.id, quantity=Decimal("30")),
        ],
        complements=[],
    )
    run_read = production_service.create_run(payload, current_user)

    db_session.expire_all()
    run = production_service.repository.get_run(run_read.id)

    child = production_service._split_run_for_partial_material(run, Decimal("60"))

    parent_lines = sorted(run.products, key=lambda p: p.line_order)
    assert [p.quantity for p in parent_lines] == [Decimal("60")]
    child_lines = sorted(child.products, key=lambda p: p.line_order)
    assert [p.quantity for p in child_lines] == [Decimal("10"), Decimal("30")]


def test_approve_materials_splits_when_stock_insufficient(
    db_session, production_service, current_user, process, raw_material, target_complement
):
    raw_material.current_stock = Decimal("60")
    db_session.flush()
    run_read = _create_run(production_service, current_user, process, raw_material, target_complement, "100")

    approved = production_service.approve_materials(run_read.id, current_user)

    assert approved.status == "MATERIALES_APROBADOS"
    assert approved.quantity == Decimal("60")
    db_session.refresh(raw_material)
    assert raw_material.current_stock == Decimal("0")

    children = [
        r for r in production_service.repository.list_runs()
        if r.parent_run_id == approved.id
    ]
    assert len(children) == 1
    assert children[0].status == "ESPERANDO_MATERIAL"
    assert children[0].quantity == Decimal("40")
    assert children[0].root_production_code == approved.production_code


def test_approve_materials_no_split_when_stock_sufficient(
    db_session, production_service, current_user, process, raw_material, target_complement
):
    raw_material.current_stock = Decimal("200")
    db_session.flush()
    run_read = _create_run(production_service, current_user, process, raw_material, target_complement, "100")

    approved = production_service.approve_materials(run_read.id, current_user)

    assert approved.status == "MATERIALES_APROBADOS"
    assert approved.quantity == Decimal("100")
    children = [
        r for r in production_service.repository.list_runs()
        if r.parent_run_id == approved.id
    ]
    assert children == []


def test_approve_materials_raises_when_stock_covers_zero(
    db_session, production_service, current_user, process, raw_material, target_complement
):
    raw_material.current_stock = Decimal("0")
    db_session.flush()
    run_read = _create_run(production_service, current_user, process, raw_material, target_complement, "100")

    import pytest

    with pytest.raises(ProductionDomainError, match="Stock insuficiente"):
        production_service.approve_materials(run_read.id, current_user)

    run = production_service.repository.get_run(run_read.id)
    assert run.status == "PENDIENTE_INVENTARIO"
