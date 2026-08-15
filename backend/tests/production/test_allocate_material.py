from decimal import Decimal

import pytest

from backend.modules.production.service import ProductionDomainError, ProductionNotFoundError
from backend.tests.production.test_material_split import _create_run


def _create_waiting_child(production_service, current_user, process, raw_material, target_complement):
    """100 g pedidos, stock alcanza para 60: aprobar parte y deja una hija
    ESPERANDO_MATERIAL de 40 g. Devuelve (padre_id, hija)."""
    raw_material.current_stock = Decimal("60")
    run_read = _create_run(production_service, current_user, process, raw_material, target_complement, 100)
    approved = production_service.approve_materials(run_read.id, current_user)
    children = [
        r for r in production_service.repository.list_runs() if r.parent_run_id == approved.id
    ]
    return approved.id, children[0]


def test_allocate_material_full_amount_starts_run(
    db_session, production_service, current_user, process, raw_material, target_complement
):
    _, child = _create_waiting_child(production_service, current_user, process, raw_material, target_complement)
    raw_material.current_stock = Decimal("40")  # cubre los 40 g faltantes
    db_session.flush()

    result = production_service.allocate_material(child.id, Decimal("40"), current_user)

    assert result.status == "EN_PROCESO"
    assert result.quantity == Decimal("40")
    db_session.refresh(raw_material)
    assert raw_material.current_stock == Decimal("0")
    grandchildren = [
        r for r in production_service.repository.list_runs() if r.parent_run_id == child.id
    ]
    assert grandchildren == []


def test_allocate_material_partial_amount_splits_again(
    db_session, production_service, current_user, process, raw_material, target_complement
):
    _, child = _create_waiting_child(production_service, current_user, process, raw_material, target_complement)
    raw_material.current_stock = Decimal("25")  # solo cubre 25 de los 40 g faltantes
    db_session.flush()

    result = production_service.allocate_material(child.id, Decimal("25"), current_user)

    assert result.status == "EN_PROCESO"
    assert result.quantity == Decimal("25")
    grandchildren = [
        r for r in production_service.repository.list_runs() if r.parent_run_id == child.id
    ]
    assert len(grandchildren) == 1
    assert grandchildren[0].status == "ESPERANDO_MATERIAL"
    assert grandchildren[0].quantity == Decimal("15")
    assert grandchildren[0].root_production_code == child.root_production_code
    assert grandchildren[0].production_code == f"{child.root_production_code}-C"


def test_allocate_material_rejects_more_than_needed(
    db_session, production_service, current_user, process, raw_material, target_complement
):
    _, child = _create_waiting_child(production_service, current_user, process, raw_material, target_complement)

    with pytest.raises(ProductionDomainError, match="No puedes destinar mas"):
        production_service.allocate_material(child.id, Decimal("999"), current_user)


def test_allocate_material_starts_what_is_covered_and_splits_the_rest(
    db_session, production_service, current_user, process, raw_material, target_complement
):
    """Destinar mas de lo que el stock cubre NO es un error: approve_materials
    es la unica fuente de verdad, arranca lo que alcanza y deja el remanente
    esperando. (Antes esto lanzaba 'Stock insuficiente' por una validacion
    prematura que solo miraba materia prima; ver seccion 3 del handoff.)"""
    _, child = _create_waiting_child(production_service, current_user, process, raw_material, target_complement)
    raw_material.current_stock = Decimal("10")  # solo cubre 10 de los 40 g pedidos
    db_session.flush()

    result = production_service.allocate_material(child.id, Decimal("40"), current_user)

    assert result.status == "EN_PROCESO"
    assert result.quantity == Decimal("10")
    grandchildren = [
        r for r in production_service.repository.list_runs() if r.parent_run_id == child.id
    ]
    assert len(grandchildren) == 1
    assert grandchildren[0].quantity == Decimal("30")
    assert grandchildren[0].status == "ESPERANDO_MATERIAL"


def test_allocate_material_rejects_when_nothing_is_covered(
    db_session, production_service, current_user, process, raw_material, target_complement
):
    _, child = _create_waiting_child(production_service, current_user, process, raw_material, target_complement)
    raw_material.current_stock = Decimal("0")
    db_session.flush()

    with pytest.raises(ProductionDomainError, match="Stock insuficiente"):
        production_service.allocate_material(child.id, Decimal("40"), current_user)


def test_allocate_material_rejects_wrong_status(
    db_session, production_service, current_user, process, raw_material, target_complement
):
    raw_material.current_stock = Decimal("2000")
    run_read = _create_run(production_service, current_user, process, raw_material, target_complement, 100)

    with pytest.raises(ProductionDomainError, match="ESPERANDO_MATERIAL"):
        production_service.allocate_material(run_read.id, Decimal("10"), current_user)


def test_allocate_material_missing_run_raises_not_found(production_service, current_user):
    import uuid

    with pytest.raises(ProductionNotFoundError):
        production_service.allocate_material(uuid.uuid4(), Decimal("1"), current_user)


def test_preview_allocation_scales_complement_need_to_the_requested_partial_amount(
    db_session, production_service, current_user, process, raw_material, complement_item, catalog_finished_item
):
    """_compute_coverage evaluaba el complemento contra su necesidad COMPLETA
    (la de toda la orden) incluso cuando el preview era para destinar solo
    una fraccion del faltante -- eso inflaba shortages de complementos que en
    realidad si alcanzan para la porcion que se esta por destinar (bug
    reportado: 'Ordenes esperando este material' via allocate-preview)."""
    from backend.modules.production.schemas import (
        ProductionRunCreate,
        RunComplementCreate,
        RunProductCreate,
    )

    raw_material.current_stock = Decimal("60")  # cubre 60 de 100 g pedidos
    complement_item.current_stock = Decimal("1000")
    db_session.flush()

    payload = ProductionRunCreate(
        process_id=process.id,
        raw_material_item_id=raw_material.id,
        quantity=Decimal("100"),
        assembly_mode="ASIGNAR",
        products=[RunProductCreate(target_item_id=catalog_finished_item.id, quantity=Decimal("100"))],
        complements=[RunComplementCreate(item_id=complement_item.id, quantity=Decimal("100"))],
    )
    run_read = production_service.create_run(payload, current_user)
    production_service.approve_materials(run_read.id, current_user)
    child = next(
        r for r in production_service.repository.list_runs() if r.parent_run_id == run_read.id
    )
    # La hija quedo necesitando 40 g de materia prima y (proporcional, misma
    # fraccion que partio el padre) 40 unidades del complemento.
    assert child.quantity == Decimal("40")
    assert child.complements[0].quantity == Decimal("40")

    # Destinar solo 10 de esos 40 g deberia exigir solo 10 del complemento,
    # no los 40 completos.
    raw_material.current_stock = Decimal("10")
    complement_item.current_stock = Decimal("10")
    db_session.flush()

    preview = production_service.preview_allocation(child.id, Decimal("10"))

    assert preview.is_partial is False
    assert preview.covered_qty == Decimal("10")
    assert preview.shortages == []
