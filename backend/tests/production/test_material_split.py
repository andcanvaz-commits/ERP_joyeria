from decimal import Decimal

from backend.modules.production.models import ProductionRunStatus
from backend.modules.production.schemas import ProductionRunCreate, RunProductCreate


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


def test_split_run_creates_waiting_child_with_shared_root_code(
    db_session, production_service, current_user, process, raw_material, target_complement
):
    raw_material.current_stock = Decimal("600")  # alcanza para 60 de 100 unidades (10g c/u)
    db_session.flush()

    run_read = _create_run(production_service, current_user, process, raw_material, target_complement, 100)
    run = production_service.repository.get_run(run_read.id)

    child = production_service._split_run_for_partial_material(run, Decimal("60"))

    assert run.quantity == Decimal("60")
    assert run.total_required_material == Decimal("600")
    assert run.root_production_code == run.production_code

    assert child.status == ProductionRunStatus.WAITING_MATERIAL
    assert child.quantity == Decimal("40")
    assert child.parent_run_id == run.id
    assert child.root_production_code == run.root_production_code
    assert child.production_code == f"{run.production_code}-B"
    assert len(child.stages) == 1
    assert child.stages[0].stage_name == "Etapa unica"

    # El plan de productos se reparte exacto: 60 al padre, 40 a la hija.
    assert sum(p.quantity for p in run.products) == Decimal("60")
    assert sum(p.quantity for p in child.products) == Decimal("40")


def test_next_split_code_increments_letter_per_child(
    db_session, production_service, current_user, process, raw_material, target_complement
):
    raw_material.current_stock = Decimal("600")
    db_session.flush()
    run_read = _create_run(production_service, current_user, process, raw_material, target_complement, 100)
    run = production_service.repository.get_run(run_read.id)

    first_child = production_service._split_run_for_partial_material(run, Decimal("60"))
    second_child = production_service._split_run_for_partial_material(first_child, Decimal("25"))

    assert first_child.production_code == f"{run.production_code}-B"
    assert second_child.production_code == f"{run.production_code}-C"
    assert second_child.root_production_code == run.production_code


def test_split_run_splits_complements_proportionally(
    db_session, production_service, current_user, process, raw_material, target_complement, complement_item
):
    from backend.modules.production.schemas import RunComplementCreate

    raw_material.current_stock = Decimal("600")
    db_session.flush()

    payload = ProductionRunCreate(
        process_id=process.id,
        raw_material_item_id=raw_material.id,
        quantity=Decimal(100),
        assembly_mode="ASIGNAR",
        products=[RunProductCreate(target_item_id=target_complement.id, quantity=Decimal(100))],
        complements=[RunComplementCreate(item_id=complement_item.id, quantity=Decimal("50"))],
    )
    run_read = production_service.create_run(payload, current_user)
    run = production_service.repository.get_run(run_read.id)

    child = production_service._split_run_for_partial_material(run, Decimal("60"))

    assert run.complements[0].quantity == Decimal("30")
    assert child.complements[0].quantity == Decimal("20")
    assert run.complements[0].quantity + child.complements[0].quantity == Decimal("50")


def test_split_run_respects_declared_product_line_order_after_reload(
    db_session, production_service, current_user, process, raw_material, target_complement, complement_item
):
    raw_material.current_stock = Decimal("600")
    db_session.flush()

    payload = ProductionRunCreate(
        process_id=process.id,
        raw_material_item_id=raw_material.id,
        quantity=Decimal(100),
        assembly_mode="ASIGNAR",
        products=[
            RunProductCreate(target_item_id=target_complement.id, quantity=Decimal(70)),
            RunProductCreate(target_item_id=complement_item.id, quantity=Decimal(30)),
        ],
        complements=[],
    )
    run_read = production_service.create_run(payload, current_user)

    # Fuerza una relectura real desde la base (simula abrir la orden en otra
    # request, como hace approve_materials), para probar que order_by en la
    # relacion realmente ordena por line_order y no por casualidad.
    db_session.expire_all()
    run = production_service.repository.get_run(run_read.id)

    child = production_service._split_run_for_partial_material(run, Decimal("60"))

    parent_lines = sorted(run.products, key=lambda p: p.line_order)
    assert [p.quantity for p in parent_lines] == [Decimal("60")]
    child_lines = sorted(child.products, key=lambda p: p.line_order)
    assert [p.quantity for p in child_lines] == [Decimal("10"), Decimal("30")]
