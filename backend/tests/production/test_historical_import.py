from decimal import Decimal

import pytest

from backend.modules.production.models import ProductionRunEventLine, ProductionRunStatus
from backend.modules.production.schemas import ProductionRunCreate, RunProductCreate
from backend.modules.production.service import ProductionDomainError


def _create_run(production_service, current_user, process, raw_material, target_complement, quantity):
    payload = ProductionRunCreate(
        process_id=process.id,
        raw_material_item_id=raw_material.id,
        quantity=Decimal(quantity),
        assembly_mode="ASIGNAR",
        products=[RunProductCreate(target_item_id=target_complement.id, quantity=Decimal(quantity))],
        complements=[],
    )
    return production_service.create_run(payload, current_user)


def test_responsable_name_falls_back_to_free_text_when_no_user(
    db_session, production_service, current_user, process, raw_material, target_complement
):
    raw_material.current_stock = Decimal("2000")
    db_session.flush()
    run_read = _create_run(production_service, current_user, process, raw_material, target_complement, 10)
    run = production_service.repository.get_run(run_read.id)

    # Simula una corrida historica: fecha + nombre en texto, sin user_id.
    run.materials_approved_at = run.requested_at
    run.materials_approved_by_user_id = None
    run.materials_approved_responsable_name = "Santy"
    run.received_at = run.requested_at
    run.received_by_user_id = None
    run.received_responsable_name = "Rocío"
    db_session.flush()

    read = production_service._read_with_names(run)

    assert read.materials_approved_by_name == "Santy"
    assert read.received_by_name == "Rocío"


def test_responsable_name_prefers_real_user_over_free_text(
    db_session, production_service, current_user, process, raw_material, target_complement
):
    raw_material.current_stock = Decimal("2000")
    db_session.flush()
    run_read = _create_run(production_service, current_user, process, raw_material, target_complement, 10)
    approved = production_service.approve_materials(run_read.id, current_user)
    run = production_service.repository.get_run(approved.id)
    # Aunque hubiera un nombre en texto cargado por error, el usuario real gana.
    run.materials_approved_responsable_name = "Nombre que no deberia verse"
    db_session.flush()

    read = production_service._read_with_names(run)

    assert read.materials_approved_by_name == "jefe_test"


def test_event_lines_load_ordered_by_line_order(
    db_session, production_service, current_user, process, raw_material, target_complement
):
    raw_material.current_stock = Decimal("2000")
    db_session.flush()
    run_read = _create_run(production_service, current_user, process, raw_material, target_complement, 10)
    run = production_service.repository.get_run(run_read.id)
    run.event_lines.append(
        ProductionRunEventLine(side="ENTREGA", gramos=Decimal("5"), unidad="g", detalle="segunda", line_order=2)
    )
    run.event_lines.append(
        ProductionRunEventLine(side="ENTREGA", gramos=Decimal("10"), unidad="g", detalle="primera", line_order=1)
    )
    db_session.flush()
    db_session.expire_all()

    reloaded = production_service.repository.get_run(run_read.id)
    read = production_service._read_with_names(reloaded)

    assert [line.detalle for line in read.event_lines] == ["primera", "segunda"]


def test_receive_finished_product_rejects_historical_run(
    db_session, production_service, current_user, process, raw_material, target_complement
):
    """Una corrida historica migrada (con event_lines) nunca debe poder
    recibirse por el flujo en vivo: eso generaria un movimiento de
    inventario real que el certificado de papel nunca respaldo. Ver
    Addendum en docs/superpowers/specs/2026-08-04-certificados-historicos-design.md."""
    raw_material.current_stock = Decimal("2000")
    db_session.flush()
    run_read = _create_run(production_service, current_user, process, raw_material, target_complement, 10)
    run = production_service.repository.get_run(run_read.id)

    # Simula una corrida historica migrada: tiene event_lines y quedo
    # PENDIENTE_RECEPCION (entregaron mas veces de las que recibieron).
    run.event_lines.append(
        ProductionRunEventLine(side="ENTREGA", gramos=Decimal("5"), unidad="g", detalle=None, line_order=1)
    )
    run.status = ProductionRunStatus.PENDING_RECEPTION
    db_session.flush()

    with pytest.raises(ProductionDomainError):
        production_service.receive_finished_product(run.id, current_user)
