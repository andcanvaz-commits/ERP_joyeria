"""CRUD de la acta persistida: agregar/editar/borrar lineas a mano (pieza D)."""
import uuid
from decimal import Decimal

import pytest

# Import necesario aunque no se use directamente: registra la tabla
# product_types en el metadata de SQLAlchemy antes del flush (ProductionRun
# tiene un FK a product_types.id). Mismo patron que test_dynamic_flow.py.
from backend.modules.product_types.models import ProductType  # noqa: F401
from backend.modules.production.models import ActaLineSource
from backend.modules.production.schemas import (
    ActaLineCreate,
    ActaLineUpdate,
    ProductionOrderCreate,
)
from backend.modules.production.service import ProductionDomainError, ProductionNotFoundError


def _create_run(production_service, current_user, process, raw_material, target_complement, quantity="10"):
    raw_material.current_stock = Decimal("1000")
    order = production_service.create_order(ProductionOrderCreate(name="Orden acta edit test"), current_user)
    return production_service.repository.get_run(order.id)


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
    from backend.modules.production.schemas import RunProductCreate, StageAttemptCreate, StageAttemptMaterialLine

    raw_material.current_stock = Decimal("100")
    db_session.flush()
    order = production_service.create_order(ProductionOrderCreate(name="Orden con etapa"), current_user)
    started = production_service.start_stage_attempt(
        order.id,
        StageAttemptCreate(
            process_id=process.id,
            responsable_name="Ana",
            materials=[StageAttemptMaterialLine(item_id=raw_material.id, quantity=Decimal("100"))],
            product=RunProductCreate(target_item_id=target_complement.id, quantity=Decimal("1")),
        ),
        current_user,
    )
    run = production_service.repository.get_run(started.id)
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
    from backend.modules.production.schemas import RunProductCreate, StageAttemptCreate, StageAttemptMaterialLine

    raw_material.current_stock = Decimal("100")
    db_session.flush()
    order = production_service.create_order(ProductionOrderCreate(name="Orden con etapa"), current_user)
    started = production_service.start_stage_attempt(
        order.id,
        StageAttemptCreate(
            process_id=process.id,
            responsable_name="Ana",
            materials=[StageAttemptMaterialLine(item_id=raw_material.id, quantity=Decimal("100"))],
            product=RunProductCreate(target_item_id=target_complement.id, quantity=Decimal("1")),
        ),
        current_user,
    )
    run = production_service.repository.get_run(started.id)
    plan_line = run.acta_lines[0]

    with pytest.raises(ProductionDomainError, match="a mano"):
        production_service.delete_acta_line(plan_line.id, current_user)


def test_update_missing_line_raises_not_found(production_service, current_user):
    with pytest.raises(ProductionNotFoundError):
        production_service.update_acta_line(uuid.uuid4(), ActaLineUpdate(quantity=Decimal("1")), current_user)


def test_update_recepcion_line_rejects_quantity_above_what_the_item_delivered(
    db_session, production_service, current_user, process, raw_material, target_complement
):
    """Bug reportado: se entregaron 9 de un insumo, se anoto un uso de 8 en el
    acta (RECEPCION, MANUAL), y editar esa linea a 25 no debia dejar pasar --
    nunca se entrego tanto de ese insumo a la orden."""
    from backend.modules.inventory.models import InventoryItem, InventoryMovement

    run = _create_run(production_service, current_user, process, raw_material, target_complement)
    supply = InventoryItem(
        item_type="SUPPLY", name="Insumo test", sku=f"IN-TEST-{uuid.uuid4().hex[:8]}",
        unit_code="und", current_stock=Decimal("0"),
    )
    db_session.add(supply)
    db_session.flush()
    db_session.add(
        InventoryMovement(
            item_id=supply.id, movement_type="CONSUMO_PRODUCCION", quantity=Decimal("9"),
            unit_code="und", reason="test", reference_type="production_run", reference_id=run.id,
        )
    )
    db_session.flush()

    run_read = production_service.add_acta_line(
        run.id,
        ActaLineCreate(side="RECEPCION", label="Insumo test", quantity=Decimal("8"), unit_code="und", item_id=supply.id),
        current_user,
    )
    line_id = [line for line in run_read.acta_lines if line.item_id == supply.id][0].id

    with pytest.raises(ProductionDomainError, match="supera lo que en realidad"):
        production_service.update_acta_line(line_id, ActaLineUpdate(quantity=Decimal("25")), current_user)

    # 9 es el techo real (lo unico que entro): si cabe.
    updated = production_service.update_acta_line(line_id, ActaLineUpdate(quantity=Decimal("9")), current_user)
    edited = next(line for line in updated.acta_lines if line.id == line_id)
    assert edited.quantity == Decimal("9")
