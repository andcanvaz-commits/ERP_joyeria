from decimal import Decimal

from backend.modules.production.schemas import (
    ProductionRunCreate,
    RunProductCreate,
)


def _create_asignar_run(production_service, current_user, process, raw_material, target_complement, quantity):
    payload = ProductionRunCreate(
        process_id=process.id,
        raw_material_item_id=raw_material.id,
        quantity=Decimal(quantity),
        products=[RunProductCreate(target_item_id=target_complement.id, quantity=Decimal(quantity))],
    )
    return production_service.create_run(payload, current_user)


def test_coverage_is_full_when_stock_is_enough(
    db_session, production_service, current_user, process, raw_material, target_complement
):
    raw_material.current_stock = Decimal("100")
    db_session.flush()
    run_read = _create_asignar_run(production_service, current_user, process, raw_material, target_complement, "80")
    run = production_service.repository.get_run(run_read.id)

    coverage = production_service._compute_coverage(run, run.total_required_material)

    assert coverage.covered_qty == Decimal("80")
    assert coverage.is_partial is False


def test_coverage_fraction_scales_raw_material_continuously(
    db_session, production_service, current_user, process, raw_material, target_complement
):
    raw_material.current_stock = Decimal("30")
    db_session.flush()
    run_read = _create_asignar_run(production_service, current_user, process, raw_material, target_complement, "100")
    run = production_service.repository.get_run(run_read.id)

    coverage = production_service._compute_coverage(run, run.total_required_material)

    assert coverage.covered_qty == Decimal("30")
    assert coverage.is_partial is True
