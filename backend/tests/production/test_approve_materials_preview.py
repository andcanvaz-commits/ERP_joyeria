"""Dry-run de aprobar materiales: debe listar TODOS los recursos cortos a la
vez (materia prima e insumos por etapa), no solo el que manda la fraccion
cubierta -- bug reportado con un caso real donde faltaban ambos a la vez y
el aviso solo mencionaba la materia prima."""
import uuid
from decimal import Decimal

import pytest

from backend.modules.inventory.models import InventoryItem
from backend.modules.production.models import ProductionRunStageIngredient
from backend.modules.production.schemas import ProductionRunCreate, RunProductCreate
from backend.modules.production.service import ProductionDomainError, ProductionNotFoundError


@pytest.fixture()
def supply_item(db_session) -> InventoryItem:
    item = InventoryItem(
        item_type="SUPPLY",
        name="Insumo test",
        sku=f"IN-TEST-{uuid.uuid4().hex[:8]}",
        unit_code="l",
        current_stock=Decimal("0"),
    )
    db_session.add(item)
    db_session.flush()
    return item


def _create_run_short_on_everything(
    db_session, production_service, current_user, process, raw_material, target_complement, supply_item
):
    """300g de materia prima (solo 150 disponibles), 300l de insumo (solo 100 disponibles)."""
    raw_material.current_stock = Decimal("150")
    supply_item.current_stock = Decimal("100")

    payload = ProductionRunCreate(
        process_id=process.id,
        raw_material_item_id=raw_material.id,
        quantity=Decimal("300"),
        products=[RunProductCreate(target_item_id=target_complement.id, quantity=Decimal("300"))],
    )
    run_read = production_service.create_run(payload, current_user)
    # El banco de procesos ya no preconfigura insumos (seccion 3): se agrega
    # directo a la etapa ya materializada de la corrida, como haria el "+"
    # del acta en el flujo real.
    run = production_service.repository.get_run(run_read.id)
    run.stages[0].ingredients.append(
        ProductionRunStageIngredient(
            inventory_item_id=supply_item.id, quantity=Decimal("300"), unit_code=supply_item.unit_code
        )
    )
    db_session.flush()
    return run_read


def test_preview_lists_every_short_resource(
    db_session, production_service, current_user, process, raw_material, target_complement, supply_item
):
    run_read = _create_run_short_on_everything(
        db_session, production_service, current_user, process, raw_material, target_complement, supply_item
    )

    preview = production_service.preview_approve_materials(run_read.id)

    assert preview.is_partial is True
    names = {s.name for s in preview.shortages}
    assert names == {raw_material.name, supply_item.name}
    by_name = {s.name: s for s in preview.shortages}
    assert by_name[raw_material.name].available == Decimal("150")
    assert by_name[raw_material.name].needed == Decimal("300")
    assert by_name[raw_material.name].is_complement is False
    assert by_name[supply_item.name].available == Decimal("100")
    assert by_name[supply_item.name].needed == Decimal("300")
    assert by_name[supply_item.name].is_complement is True


def test_preview_does_not_mutate_anything(
    db_session, production_service, current_user, process, raw_material, target_complement, supply_item
):
    run_read = _create_run_short_on_everything(
        db_session, production_service, current_user, process, raw_material, target_complement, supply_item
    )

    production_service.preview_approve_materials(run_read.id)

    db_session.refresh(raw_material)
    db_session.refresh(supply_item)
    assert raw_material.current_stock == Decimal("150")
    assert supply_item.current_stock == Decimal("100")
    run = production_service.repository.get_run(run_read.id)
    assert run.status == "PENDIENTE_INVENTARIO"


def test_preview_only_for_pending_inventory_runs(
    db_session, production_service, current_user, process, raw_material, target_complement, supply_item
):
    run_read = _create_run_short_on_everything(
        db_session, production_service, current_user, process, raw_material, target_complement, supply_item
    )
    raw_material.current_stock = Decimal("1000")
    supply_item.current_stock = Decimal("1000")
    db_session.flush()
    production_service.approve_materials(run_read.id, current_user)

    with pytest.raises(ProductionDomainError, match="pendientes de Inventario"):
        production_service.preview_approve_materials(run_read.id)


def test_preview_unknown_run_raises_not_found(production_service):
    with pytest.raises(ProductionNotFoundError):
        production_service.preview_approve_materials(uuid.uuid4())
