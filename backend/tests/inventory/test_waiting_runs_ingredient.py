"""Un ingreso de insumo (SUPPLY) tambien debe disparar el aviso de 'destinar'
para ordenes ESPERANDO_MATERIAL que lo necesitan como insumo de etapa --
antes _find_waiting_production_runs solo miraba materia prima y
complementos, asi que agregar el insumo que faltaba nunca abria el modal
aunque fuera lo unico pendiente de la orden (bug reportado)."""
import uuid
from decimal import Decimal

from backend.modules.inventory.models import InventoryItem
from backend.modules.inventory.router import _find_waiting_production_runs
from backend.modules.production.models import ProductionRunStage, ProductionRunStageIngredient
from backend.tests.inventory.conftest import make_waiting_run


def _attach_stage_ingredient(db_session, run, item, quantity="10"):
    stage = ProductionRunStage(
        run_id=run.id,
        source_stage_id=uuid.uuid4(),
        stage_name="Etapa test",
        stage_order=1,
        requires_weighing=False,
        status="PENDIENTE",
    )
    db_session.add(stage)
    db_session.flush()
    ingredient = ProductionRunStageIngredient(
        run_stage_id=stage.id,
        inventory_item_id=item.id,
        quantity=Decimal(quantity),
        unit_code=item.unit_code,
    )
    db_session.add(ingredient)
    db_session.flush()
    return stage


def test_finds_waiting_run_that_needs_this_supply_as_stage_ingredient(db_session, raw_material):
    supply = InventoryItem(
        item_type="SUPPLY",
        name="Insumo test",
        sku=f"IN-TEST-{uuid.uuid4().hex[:8]}",
        unit_code="l",
        current_stock=Decimal("0"),
    )
    db_session.add(supply)
    db_session.flush()

    # La orden espera por OTRA cosa (otra materia prima) -- lo unico que la
    # liga a este insumo es la etapa.
    other_raw_material = InventoryItem(
        item_type="RAW_MATERIAL", name="Otra materia", sku=f"MP-TEST-{uuid.uuid4().hex[:8]}",
        unit_code="g", current_stock=Decimal("0"),
    )
    db_session.add(other_raw_material)
    db_session.flush()
    run = make_waiting_run(db_session, other_raw_material, 40)
    _attach_stage_ingredient(db_session, run, supply)

    result = _find_waiting_production_runs(db_session, supply.id)

    assert [r.id for r in result] == [run.id]


def test_does_not_find_runs_for_an_unrelated_supply(db_session, raw_material):
    supply = InventoryItem(
        item_type="SUPPLY", name="Insumo test", sku=f"IN-TEST-{uuid.uuid4().hex[:8]}",
        unit_code="l", current_stock=Decimal("0"),
    )
    other_supply = InventoryItem(
        item_type="SUPPLY", name="Otro insumo", sku=f"IN-TEST-{uuid.uuid4().hex[:8]}",
        unit_code="l", current_stock=Decimal("0"),
    )
    db_session.add_all([supply, other_supply])
    db_session.flush()

    run = make_waiting_run(db_session, raw_material, 40)
    _attach_stage_ingredient(db_session, run, supply)

    result = _find_waiting_production_runs(db_session, other_supply.id)

    assert result == []
