"""Siembra de la acta persistida al crear una orden (pieza B)."""
import uuid
from decimal import Decimal

from backend.modules.production.models import (
    ActaLineSide,
    ActaLineSource,
    ProductionProcessStageIngredient,
)
from backend.modules.production.schemas import (
    ProductionRunCreate,
    RunComplementCreate,
    RunProductCreate,
    RunStageIngredientCreate,
)


def test_create_run_seeds_entrega_line_for_raw_material(
    db_session, production_service, current_user, process, raw_material, target_complement
):
    raw_material.current_stock = Decimal("1000")
    db_session.flush()

    payload = ProductionRunCreate(
        process_id=process.id,
        raw_material_item_id=raw_material.id,
        quantity=Decimal("37.5"),
        assembly_mode="ASIGNAR",
        products=[RunProductCreate(target_item_id=target_complement.id, quantity=Decimal("37.5"))],
    )
    run_read = production_service.create_run(payload, current_user)
    run = production_service.repository.get_run(run_read.id)

    entrega = [line for line in run.acta_lines if line.side == ActaLineSide.ENTREGA]
    assert len(entrega) == 1
    assert entrega[0].label == raw_material.name
    assert entrega[0].quantity == Decimal("37.5")
    assert entrega[0].unit_code == raw_material.unit_code
    assert entrega[0].source == ActaLineSource.PLAN
    assert entrega[0].stage_id is None


def test_create_run_seeds_recepcion_line_for_target_item(
    db_session, production_service, current_user, process, raw_material, target_complement
):
    raw_material.current_stock = Decimal("1000")
    db_session.flush()

    payload = ProductionRunCreate(
        process_id=process.id,
        raw_material_item_id=raw_material.id,
        quantity=Decimal("10"),
        assembly_mode="ASIGNAR",
        products=[RunProductCreate(target_item_id=target_complement.id, quantity=Decimal("10"))],
    )
    run_read = production_service.create_run(payload, current_user)
    run = production_service.repository.get_run(run_read.id)

    recepcion = [line for line in run.acta_lines if line.side == ActaLineSide.RECEPCION]
    assert len(recepcion) == 1
    assert recepcion[0].label == target_complement.name
    assert recepcion[0].quantity == Decimal("10")
    assert recepcion[0].unit_code == target_complement.unit_code
    assert recepcion[0].source == ActaLineSource.PLAN


def test_create_run_seeds_entrega_lines_for_stage_ingredients_and_complements(
    db_session, production_service, current_user, process, raw_material, target_complement, complement_item
):
    from backend.modules.inventory.models import InventoryItem

    supply = InventoryItem(
        item_type="SUPPLY", name="Hilo", sku=f"IN-{uuid.uuid4().hex[:8]}", unit_code="m",
        current_stock=Decimal("0"),
    )
    db_session.add(supply)
    db_session.flush()
    process.stages[0].ingredients.append(ProductionProcessStageIngredient(inventory_item_id=supply.id))
    db_session.flush()
    config_id = process.stages[0].ingredients[0].id

    raw_material.current_stock = Decimal("1000")
    complement_item.current_stock = Decimal("1000")
    db_session.flush()

    payload = ProductionRunCreate(
        process_id=process.id,
        raw_material_item_id=raw_material.id,
        quantity=Decimal("10"),
        assembly_mode="ASIGNAR",
        products=[RunProductCreate(target_item_id=target_complement.id, quantity=Decimal("10"))],
        complements=[RunComplementCreate(item_id=complement_item.id, quantity=Decimal("2"))],
        stage_ingredients=[RunStageIngredientCreate(process_stage_ingredient_id=config_id, quantity=Decimal("3.5"))],
    )
    run_read = production_service.create_run(payload, current_user)
    run = production_service.repository.get_run(run_read.id)

    entrega = sorted(
        [line for line in run.acta_lines if line.side == ActaLineSide.ENTREGA],
        key=lambda line: line.line_order,
    )
    assert len(entrega) == 3
    assert entrega[0].label == raw_material.name
    assert entrega[1].label == supply.name
    assert entrega[1].quantity == Decimal("3.5")
    assert entrega[1].unit_code == "m"
    assert entrega[1].stage_id == run.stages[0].id
    assert entrega[2].label == complement_item.name
    assert entrega[2].quantity == Decimal("2")
    assert entrega[2].source == ActaLineSource.PLAN


def test_create_run_seeds_recepcion_line_for_product_type(
    db_session, production_service, current_user, process, raw_material
):
    """ProductType no define su propia unidad (el material/unidad se decide
    en produccion): el resultante hereda la unidad de la materia prima de
    ESTA orden -- una orden en gramos produce gramos, no "unidades" fijas sin
    relacion con lo que de verdad se peso (bug reportado: 1g de materia
    prima terminaba mostrando "1 und" del producto en el acta)."""
    from backend.modules.product_types.models import ProductType

    product_type = ProductType(
        category_code="14", model_code=uuid.uuid4().hex[:4], name=f"TIPO TEST {uuid.uuid4().hex[:4]}",
    )
    db_session.add(product_type)
    db_session.flush()

    raw_material.current_stock = Decimal("1000")
    db_session.flush()

    payload = ProductionRunCreate(
        process_id=process.id,
        raw_material_item_id=raw_material.id,
        quantity=Decimal("5"),
        assembly_mode="ASIGNAR",
        products=[RunProductCreate(product_type_id=product_type.id, quantity=Decimal("5"))],
    )
    run_read = production_service.create_run(payload, current_user)
    run = production_service.repository.get_run(run_read.id)

    recepcion = [line for line in run.acta_lines if line.side == ActaLineSide.RECEPCION]
    assert len(recepcion) == 1
    assert recepcion[0].label == product_type.name
    assert recepcion[0].unit_code == raw_material.unit_code
    assert recepcion[0].quantity == Decimal("5")
