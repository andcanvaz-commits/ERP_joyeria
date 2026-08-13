from decimal import Decimal

from backend.modules.production.schemas import (
    AssemblyRecipeUpsert,
    ProductionRunCreate,
    ProductionRunStageFinish,
    RunAssemblyDefine,
    RunAssemblyLineCreate,
    RunComplementCreate,
    RunProductCreate,
)


def test_finish_run_never_autoapplies_even_with_existing_recipe(
    db_session, production_service, current_user, process, raw_material, complement_item, catalog_finished_item,
):
    # Crea una receta previa para el model_key de la pieza destino.
    material_code = production_service._material_code_for_item(raw_material.id)
    part = production_service._model_part_for_piece(catalog_finished_item.id)
    model_key = f"{material_code}{part}"
    production_service.upsert_assembly_recipe(
        model_key,
        AssemblyRecipeUpsert(items=[RunAssemblyLineCreate(complement_item_id=complement_item.id, quantity=Decimal("5"))]),
        current_user,
    )

    raw_material.current_stock = Decimal("1000")
    complement_item.current_stock = Decimal("1000")
    db_session.flush()

    payload = ProductionRunCreate(
        process_id=process.id,
        raw_material_item_id=raw_material.id,
        quantity=Decimal("100"),
        assembly_mode="ENSAMBLAR",
        products=[RunProductCreate(target_item_id=catalog_finished_item.id, quantity=Decimal("100"))],
        complements=[RunComplementCreate(item_id=complement_item.id, quantity=Decimal("5"))],
    )
    run_read = production_service.create_run(payload, current_user)
    production_service.approve_materials(run_read.id, current_user)
    production_service.start_run(run_read.id, current_user)
    run = production_service.repository.get_run(run_read.id)
    stage = run.stages[0]

    finished = production_service.finish_stage(
        stage.id, ProductionRunStageFinish(final_weight=Decimal("95")), current_user
    )

    assert finished.assembly_pending is True
    assert finished.assembly_items == []


def test_define_run_assembly_compares_quantity_directly(
    db_session, production_service, current_user, process, raw_material, complement_item, catalog_finished_item,
):
    raw_material.current_stock = Decimal("1000")
    complement_item.current_stock = Decimal("1000")
    db_session.flush()

    payload = ProductionRunCreate(
        process_id=process.id,
        raw_material_item_id=raw_material.id,
        quantity=Decimal("100"),
        assembly_mode="ENSAMBLAR",
        products=[RunProductCreate(target_item_id=catalog_finished_item.id, quantity=Decimal("100"))],
        complements=[RunComplementCreate(item_id=complement_item.id, quantity=Decimal("5"))],
    )
    run_read = production_service.create_run(payload, current_user)
    production_service.approve_materials(run_read.id, current_user)
    production_service.start_run(run_read.id, current_user)
    run = production_service.repository.get_run(run_read.id)
    production_service.finish_stage(
        run.stages[0].id, ProductionRunStageFinish(final_weight=Decimal("95")), current_user
    )

    defined = production_service.define_run_assembly(
        run_read.id,
        RunAssemblyDefine(items=[RunAssemblyLineCreate(complement_item_id=complement_item.id, quantity=Decimal("5"))]),
        current_user,
    )

    assert defined.assembly_pending is False
    assert defined.assembly_items[0].quantity == Decimal("5")

    import pytest
    from backend.modules.production.service import ProductionDomainError

    # Otra orden igual, pidiendo mas de lo aprobado: debe fallar.
    run_read_2 = production_service.create_run(payload, current_user)
    production_service.approve_materials(run_read_2.id, current_user)
    production_service.start_run(run_read_2.id, current_user)
    run_2 = production_service.repository.get_run(run_read_2.id)
    production_service.finish_stage(
        run_2.stages[0].id, ProductionRunStageFinish(final_weight=Decimal("95")), current_user
    )
    with pytest.raises(ProductionDomainError, match="necesita"):
        production_service.define_run_assembly(
            run_read_2.id,
            RunAssemblyDefine(items=[RunAssemblyLineCreate(complement_item_id=complement_item.id, quantity=Decimal("6"))]),
            current_user,
        )
