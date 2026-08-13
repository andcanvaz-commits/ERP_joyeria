import uuid
from decimal import Decimal

# Import necesario aunque no se use directamente: registra la tabla
# product_types en el metadata de SQLAlchemy antes del flush. ProductionRun
# tiene un FK a product_types.id (target_product_type_id) y este archivo, a
# diferencia del resto de tests de produccion, construye ProductionRun
# directo sin pasar por ProductionService (que ya importa ProductType
# localmente antes de tocar una corrida).
from backend.modules.product_types.models import ProductType  # noqa: F401
from backend.modules.production.models import (
    ProductionProcess,
    ProductionProcessMaterial,
    ProductionProcessStage,
    ProductionProcessStageIngredient,
    ProductionRun,
    ProductionRunStage,
    ProductionRunStageIngredient,
    ProductionRunStatus,
)


def test_process_material_has_no_ratio_columns(db_session, raw_material):
    process = ProductionProcess(
        name=f"Proceso {uuid.uuid4().hex[:6]}",
        waste_limit_percent=Decimal("1"),
        materials=[ProductionProcessMaterial(inventory_item_id=raw_material.id)],
        stages=[ProductionProcessStage(name="Etapa", stage_order=1)],
    )
    db_session.add(process)
    db_session.flush()

    assert not hasattr(ProductionProcessMaterial, "quantity_per_unit")
    assert not hasattr(ProductionProcessMaterial, "unit_code")


def test_stage_ingredient_has_no_quantity_column(db_session, raw_material):
    stage = ProductionProcessStage(name="Etapa", stage_order=1)
    stage.ingredients.append(ProductionProcessStageIngredient(inventory_item_id=raw_material.id))
    process = ProductionProcess(
        name=f"Proceso {uuid.uuid4().hex[:6]}",
        waste_limit_percent=Decimal("1"),
        materials=[ProductionProcessMaterial(inventory_item_id=raw_material.id)],
        stages=[stage],
    )
    db_session.add(process)
    db_session.flush()

    assert not hasattr(ProductionProcessStageIngredient, "quantity")
    assert not hasattr(ProductionProcessStageIngredient, "unit_code")


def test_run_stage_ingredient_round_trip(db_session, raw_material, current_user):
    run = ProductionRun(
        process_id=uuid.uuid4(),
        process_name="Proceso",
        quantity=Decimal("100"),
        status=ProductionRunStatus.PENDING_INVENTORY,
        raw_material_item_id=raw_material.id,
        raw_material_unit_code="g",
        total_required_material=Decimal("100"),
        waste_limit_percent=Decimal("1"),
        expected_finished_weight=Decimal("100"),
        created_by_user_id=current_user.id,
    )
    run.stages.append(
        ProductionRunStage(
            source_stage_id=uuid.uuid4(),
            stage_name="Fundicion",
            stage_order=1,
            ingredients=[
                ProductionRunStageIngredient(
                    inventory_item_id=raw_material.id,
                    quantity=Decimal("5"),
                    unit_code="und",
                )
            ],
        )
    )
    db_session.add(run)
    db_session.flush()
    db_session.expire_all()

    reloaded = db_session.get(ProductionRun, run.id)
    assert reloaded.stages[0].ingredients[0].quantity == Decimal("5")
    assert reloaded.stages[0].ingredients[0].reserved_quantity == Decimal("0")


def test_run_raw_material_quantity_per_unit_column_removed():
    assert not hasattr(ProductionRun, "raw_material_quantity_per_unit")
