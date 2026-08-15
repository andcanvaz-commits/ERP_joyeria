"""Si una corrida crea una receta de ensamble (nadie mas la toco desde
entonces) y esa corrida se cancela, la receta se borra con ella -- no debe
quedar viva sin la orden que la origino."""
from decimal import Decimal

from backend.modules.production.schemas import (
    AssemblyRecipeUpsert,
    ProductionRunCreate,
    ProductionRunStageFinish,
    RunAssemblyLineCreate,
    RunComplementCreate,
    RunProductCreate,
)


def _model_key(production_service, raw_material, catalog_finished_item):
    material_code = production_service._material_code_for_item(raw_material.id)
    part = production_service._model_part_for_piece(catalog_finished_item.id)
    return f"{material_code}{part}"


def _run_to_pending_reception_with_assembly_defined(
    production_service, current_user, process, raw_material, complement_item, catalog_finished_item
):
    """Crea una corrida ENSAMBLAR y la lleva a PENDIENTE_RECEPCION -- el
    ensamble se aplica solo con lo aprobado al terminar (_auto_apply_assembly),
    aprendiendo (o actualizando) la receta del model_key de una. Devuelve el
    run ORM."""
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
    return production_service.repository.get_run(run_read.id)


def test_cancel_deletes_recipe_the_run_created(
    db_session, production_service, current_user, process, raw_material, complement_item, catalog_finished_item
):
    raw_material.current_stock = Decimal("1000")
    complement_item.current_stock = Decimal("1000")
    db_session.flush()

    run = _run_to_pending_reception_with_assembly_defined(
        production_service, current_user, process, raw_material, complement_item, catalog_finished_item
    )
    model_key = _model_key(production_service, raw_material, catalog_finished_item)
    recipe = production_service.get_assembly_recipe(None, catalog_finished_item.id, raw_material.id)
    assert recipe.model_key == model_key
    assert len(recipe.items) == 1

    production_service.cancel_run(run.id, current_user, "ya no se necesita")

    # _recipe_read_for_key siempre devuelve el model_key consultado, exista o
    # no la receta -- lo que importa es que items quede vacio (borrada).
    recipe_after = production_service.get_assembly_recipe(None, catalog_finished_item.id, raw_material.id)
    assert recipe_after.items == []


def test_cancel_does_not_delete_a_recipe_another_run_already_reused(
    db_session, production_service, current_user, process, raw_material, complement_item, catalog_finished_item
):
    raw_material.current_stock = Decimal("2000")
    complement_item.current_stock = Decimal("2000")
    db_session.flush()

    first_run = _run_to_pending_reception_with_assembly_defined(
        production_service, current_user, process, raw_material, complement_item, catalog_finished_item
    )
    # Una segunda corrida reutiliza (actualiza) la misma receta: deja de ser
    # "solo de la primera corrida".
    second_run = _run_to_pending_reception_with_assembly_defined(
        production_service, current_user, process, raw_material, complement_item, catalog_finished_item
    )

    production_service.cancel_run(first_run.id, current_user, "motivo")

    recipe_after = production_service.get_assembly_recipe(None, catalog_finished_item.id, raw_material.id)
    assert len(recipe_after.items) == 1  # sigue viva, la segunda corrida la reclamo

    # Y cancelar la segunda (la que de verdad la "toco" al actualizarla) NO
    # la borra tampoco -- solo se borra sola si nadie la actualizo jamas.
    production_service.cancel_run(second_run.id, current_user, "motivo")
    recipe_still_there = production_service.get_assembly_recipe(None, catalog_finished_item.id, raw_material.id)
    assert len(recipe_still_there.items) == 1


def test_cancel_does_not_delete_a_recipe_created_by_hand_in_maintenance(
    db_session, production_service, current_user, process, raw_material, complement_item, catalog_finished_item
):
    raw_material.current_stock = Decimal("1000")
    complement_item.current_stock = Decimal("1000")
    db_session.flush()

    model_key = _model_key(production_service, raw_material, catalog_finished_item)
    production_service.upsert_assembly_recipe(
        model_key,
        AssemblyRecipeUpsert(items=[RunAssemblyLineCreate(complement_item_id=complement_item.id, quantity=Decimal("5"))]),
        current_user,
    )

    run = _run_to_pending_reception_with_assembly_defined(
        production_service, current_user, process, raw_material, complement_item, catalog_finished_item
    )
    production_service.cancel_run(run.id, current_user, "motivo")

    recipe_after = production_service.get_assembly_recipe(None, catalog_finished_item.id, raw_material.id)
    assert len(recipe_after.items) == 1  # nunca fue "de" la corrida, no se borra
