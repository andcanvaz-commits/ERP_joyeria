"""ENSAMBLAR se aplica solo al terminar produccion, con TODO lo aprobado de
cada complemento (lo que Inventario de verdad entrego) -- no se vuelve a
pedir confirmacion aparte, eso ya se declaro una vez al crear la orden
(decision de Rodrigo). define_run_assembly sigue existiendo como correccion
manual para ordenes que hayan quedado con assembly_pending=True de antes de
este cambio."""
from decimal import Decimal

import pytest

from backend.modules.production.schemas import (
    ComplementReturnCreate,
    ProductionRunCreate,
    ProductionRunStageFinish,
    RunAssemblyDefine,
    RunAssemblyLineCreate,
    RunComplementCreate,
    RunProductCreate,
)
from backend.modules.production.service import ProductionDomainError
from backend.modules.inventory.models import InventoryItem


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


def test_return_complement_ignores_what_assembly_marked_as_used(
    db_session, production_service, current_user, process, raw_material, complement_item, catalog_finished_item,
):
    """Rodrigo (2026-08-16): nada se marca 'usado' de forma independiente --
    usado = aprobado - devuelto, siempre. _auto_apply_assembly marca el 100%
    de lo aprobado como assembly_items al terminar la corrida (ver el test
    de arriba); si esa marca restara en 'remaining', devolver cualquier cosa
    despues de terminar la produccion seria imposible (remaining ya en 0)."""
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
    # El ensamble automatico ya marco los 5 aprobados como "usados".
    assert finished.assembly_items[0].quantity == Decimal("5")

    complement_id = finished.complements[0].id
    updated = production_service.return_complement(
        complement_id, ComplementReturnCreate(quantity=Decimal("2")), current_user
    )

    returned_complement = next(c for c in updated.complements if c.id == complement_id)
    assert returned_complement.returned_quantity == Decimal("2")


def test_return_complement_still_caps_at_approved_minus_returned(
    db_session, production_service, current_user, process, raw_material, complement_item, catalog_finished_item,
):
    """El tope sigue existiendo -- solo deja de contar lo 'usado' por el
    ensamble. No se puede devolver mas de lo aprobado menos lo ya devuelto."""
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
    complement_id = finished.complements[0].id

    with pytest.raises(ProductionDomainError, match="Solo quedan 5"):
        production_service.return_complement(
            complement_id, ComplementReturnCreate(quantity=Decimal("6")), current_user
        )


def test_receive_extra_grams_discounts_returned_complement(
    db_session, production_service, current_user, process, raw_material, complement_item, catalog_finished_item,
):
    """Rodrigo (2026-08-16): 100g de plata + 10g de dijes -- si se
    devuelven 5g de dijes ANTES de recibir, el producto final debe pesar
    100g + 5g, no 100g + 10g. extra_grams_per_unit hoy suma
    assembly_items[].quantity (el 100% marcado por el ensamble automatico),
    sin restar complement.returned_quantity -- mismo patron de bug que
    return_complement (Task 1) y returnableComplements (Task 2), en un
    tercer lugar que tambien necesita 'usado = aprobado - devuelto'."""
    raw_material.current_stock = Decimal("1000")
    complement_item.current_stock = Decimal("1000")
    complement_item.weight_per_unit = Decimal("1")
    # La suite corre contra una base de datos real ya poblada (ver
    # CLAUDE.md / conftest.py: db_session abre una transaccion real y hace
    # rollback, no hay sqlite ni base en memoria) con segmentos MATERIAL ya
    # existentes. convert_lot_to_product solo reusa `catalog_finished_item`
    # si su product_code[0] y material_type calzan EXACTO con el material
    # que arma para el lote (material_code + texto); si no, crea otra fila
    # nueva. Se fija aca el mismo material_code que va a resolver
    # `match_material_code` para el texto del raw_material, para apuntar la
    # conversion a `catalog_finished_item` en vez de a una fila nueva.
    material_code = production_service.inventory_service.match_material_code(raw_material.name)
    catalog_finished_item.material_type = raw_material.name
    catalog_finished_item.product_code = material_code + catalog_finished_item.product_code[1:]
    db_session.flush()

    payload = ProductionRunCreate(
        process_id=process.id,
        raw_material_item_id=raw_material.id,
        quantity=Decimal("100"),
        assembly_mode="ENSAMBLAR",
        products=[RunProductCreate(target_item_id=catalog_finished_item.id, quantity=Decimal("100"))],
        complements=[RunComplementCreate(item_id=complement_item.id, quantity=Decimal("10"))],
    )
    run_read = production_service.create_run(payload, current_user)
    production_service.approve_materials(run_read.id, current_user)
    production_service.start_run(run_read.id, current_user)
    run = production_service.repository.get_run(run_read.id)
    finished = production_service.finish_stage(
        run.stages[0].id, ProductionRunStageFinish(final_weight=Decimal("100")), current_user
    )
    # El ensamble automatico marco los 10 aprobados como "usados".
    assert finished.assembly_items[0].quantity == Decimal("10")

    complement_id = finished.complements[0].id
    production_service.return_complement(
        complement_id, ComplementReturnCreate(quantity=Decimal("5")), current_user
    )

    production_service.receive_finished_product(run.id, current_user)

    target = db_session.get(InventoryItem, catalog_finished_item.id)
    # weight_per_unit de la orden = total_required_material(100) / quantity(100) = 1 g/und.
    # extra_grams_per_unit correcto = (10 aprobado - 5 devuelto) / 100 = 0.05 g/und.
    # peso total por unidad = 1 + 0.05 = 1.05 -> 100 unidades convertidas = 105g.
    # Con el bug (sin restar lo devuelto): 1 + 0.10 = 1.10 -> 110g.
    assert target.current_stock == Decimal("105")
