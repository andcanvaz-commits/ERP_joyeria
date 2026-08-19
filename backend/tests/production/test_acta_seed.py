"""Siembra de la acta persistida al crear una orden (pieza B)."""
import uuid
from decimal import Decimal

from backend.modules.production.models import ActaLineSide, ActaLineSource
from backend.modules.production.schemas import ProductionRunCreate, RunProductCreate


def test_create_run_seeds_entrega_line_for_raw_material(
    db_session, production_service, current_user, process, raw_material, target_complement
):
    raw_material.current_stock = Decimal("1000")
    db_session.flush()

    payload = ProductionRunCreate(
        process_id=process.id,
        raw_material_item_id=raw_material.id,
        quantity=Decimal("37.5"),
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
        products=[RunProductCreate(product_type_id=product_type.id, quantity=Decimal("5"))],
    )
    run_read = production_service.create_run(payload, current_user)
    run = production_service.repository.get_run(run_read.id)

    recepcion = [line for line in run.acta_lines if line.side == ActaLineSide.RECEPCION]
    assert len(recepcion) == 1
    assert recepcion[0].label == product_type.name
    assert recepcion[0].unit_code == raw_material.unit_code
    assert recepcion[0].quantity == Decimal("5")
