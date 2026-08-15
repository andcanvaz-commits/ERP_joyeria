"""ENSAMBLAR se aplica solo al terminar produccion, con TODO lo aprobado de
cada complemento (lo que Inventario de verdad entrego) -- no se vuelve a
pedir confirmacion aparte, eso ya se declaro una vez al crear la orden
(decision de Rodrigo). define_run_assembly sigue existiendo como correccion
manual para ordenes que hayan quedado con assembly_pending=True de antes de
este cambio."""
from decimal import Decimal

import pytest

from backend.modules.production.schemas import (
    ProductionRunCreate,
    ProductionRunStageFinish,
    RunAssemblyDefine,
    RunAssemblyLineCreate,
    RunComplementCreate,
    RunProductCreate,
)
from backend.modules.production.service import ProductionDomainError


def test_finish_run_auto_applies_assembly_from_approved_complements(
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

    finished = production_service.finish_stage(
        run.stages[0].id, ProductionRunStageFinish(final_weight=Decimal("95")), current_user
    )

    assert finished.assembly_pending is False
    assert len(finished.assembly_items) == 1
    assert finished.assembly_items[0].complement_item_id == complement_item.id
    assert finished.assembly_items[0].quantity == Decimal("5")

    # Tambien aprende la receta del model_key -- mismo efecto que
    # define_run_assembly, solo que automatico.
    material_code = production_service._material_code_for_item(raw_material.id)
    part = production_service._model_part_for_piece(catalog_finished_item.id)
    model_key = f"{material_code}{part}"
    recipe = production_service._recipe_read_for_key(model_key)
    assert len(recipe.items) == 1
    assert recipe.items[0].quantity == Decimal("5")


def test_ensamblar_without_complements_is_rejected_at_creation(
    db_session, production_service, current_user, process, raw_material, catalog_finished_item,
):
    """_auto_apply_assembly asume que toda orden ENSAMBLAR que llega a
    PENDIENTE_RECEPCION tiene al menos un complemento aprobado -- esta regla
    (ya existente en create_run) es lo que lo garantiza; sin ella,
    _approved_complement_totals podria venir vacio."""
    raw_material.current_stock = Decimal("1000")
    db_session.flush()

    payload = ProductionRunCreate(
        process_id=process.id,
        raw_material_item_id=raw_material.id,
        quantity=Decimal("100"),
        assembly_mode="ENSAMBLAR",
        products=[RunProductCreate(target_item_id=catalog_finished_item.id, quantity=Decimal("100"))],
        complements=[],
    )

    with pytest.raises(ProductionDomainError, match="al menos un complemento"):
        production_service.create_run(payload, current_user)


def test_define_run_assembly_still_works_as_manual_correction(
    db_session, production_service, current_user, process, raw_material, complement_item, catalog_finished_item,
):
    """Escotilla de escape para ordenes que hayan quedado con
    assembly_pending=True de antes de que el ensamble se empezara a aplicar
    solo -- se simula ese estado a mano."""
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

    run.assembly_pending = True
    run.assembly_items = []
    db_session.flush()

    defined = production_service.define_run_assembly(
        run_read.id,
        RunAssemblyDefine(items=[RunAssemblyLineCreate(complement_item_id=complement_item.id, quantity=Decimal("5"))]),
        current_user,
    )

    assert defined.assembly_pending is False
    assert defined.assembly_items[0].quantity == Decimal("5")

    with pytest.raises(ProductionDomainError, match="ya está definido"):
        production_service.define_run_assembly(
            run_read.id,
            RunAssemblyDefine(items=[RunAssemblyLineCreate(complement_item_id=complement_item.id, quantity=Decimal("5"))]),
            current_user,
        )
