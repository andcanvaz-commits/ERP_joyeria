from decimal import Decimal

import pytest

from backend.modules.inventory.models import InventoryItem
from backend.modules.production.models import (
    ProductionProcess,
    ProductionProcessMaterial,
    ProductionProcessStage,
)
from backend.modules.production.schemas import (
    ProductionRunCreate,
    ProductionRunStageFinish,
    ReceiveFinishedProductPayload,
    RunProductCreate,
)
from backend.modules.production.service import ProductionDomainError


@pytest.fixture()
def weighed_process(db_session, raw_material) -> ProductionProcess:
    """Variante del fixture `process`: una sola etapa que SI pesa, y limite de
    merma alto para que no dispare el flujo de rechazo por peso al finalizar
    con una perdida grande a proposito en los tests."""
    proc = ProductionProcess(
        name="Cadenas test",
        waste_limit_percent=Decimal("100"),
        is_active=True,
        materials=[
            ProductionProcessMaterial(
                inventory_item_id=raw_material.id, quantity_per_unit=Decimal("10"), unit_code="g",
            )
        ],
        stages=[
            ProductionProcessStage(
                name="Etapa pesada", stage_type="PROCESS", stage_order=1, is_active=True,
                requires_weighing=True,
            )
        ],
    )
    db_session.add(proc)
    db_session.flush()
    return proc


def _run_to_pending_reception(
    production_service, current_user, weighed_process, raw_material, target_complement, quantity, final_weight
):
    payload = ProductionRunCreate(
        process_id=weighed_process.id,
        raw_material_item_id=raw_material.id,
        quantity=Decimal(quantity),
        assembly_mode="ASIGNAR",
        products=[RunProductCreate(target_item_id=target_complement.id, quantity=Decimal(quantity))],
        complements=[],
    )
    run_read = production_service.create_run(payload, current_user)
    production_service.approve_materials(run_read.id, current_user)
    production_service.start_run(run_read.id, current_user)
    run = production_service.repository.get_run(run_read.id)
    stage = run.stages[0]
    production_service.finish_stage(
        stage.id,
        ProductionRunStageFinish(initial_weight=run.total_required_material, final_weight=Decimal(final_weight)),
        current_user,
    )
    return production_service.repository.get_run(run_read.id)


def test_receive_with_waste_creates_waste_item_and_posts_ingreso_produccion(
    db_session, production_service, current_user, weighed_process, raw_material, target_complement
):
    raw_material.current_stock = Decimal("2000")
    db_session.flush()
    # 10 unidades x 10g = 100g requeridos; termina en 95g -> 5g de merma.
    run = _run_to_pending_reception(
        production_service, current_user, weighed_process, raw_material, target_complement, 10, "95"
    )
    assert run.waste_weight == Decimal("5")

    production_service.receive_finished_product(run.id, current_user)

    waste_item = (
        db_session.query(InventoryItem)
        .filter(InventoryItem.item_type == "WASTE", InventoryItem.name == "Merma Cadenas test")
        .one()
    )
    assert waste_item.current_stock == Decimal("5")
    movements = [m for m in waste_item.movements if m.movement_type == "INGRESO_PRODUCCION"]
    assert len(movements) == 1
    assert movements[0].quantity == Decimal("5")
    assert movements[0].reference_type == "production_run"
    assert movements[0].reference_id == run.id


def test_receive_reuses_same_waste_item_across_runs_of_same_process(
    db_session, production_service, current_user, weighed_process, raw_material, target_complement
):
    raw_material.current_stock = Decimal("2000")
    db_session.flush()
    first = _run_to_pending_reception(
        production_service, current_user, weighed_process, raw_material, target_complement, 10, "95"
    )
    production_service.receive_finished_product(first.id, current_user)

    second = _run_to_pending_reception(
        production_service, current_user, weighed_process, raw_material, target_complement, 10, "97"
    )
    production_service.receive_finished_product(second.id, current_user)

    waste_items = (
        db_session.query(InventoryItem)
        .filter(InventoryItem.item_type == "WASTE", InventoryItem.name == "Merma Cadenas test")
        .all()
    )
    assert len(waste_items) == 1
    assert waste_items[0].current_stock == Decimal("8")  # 5 + 3


def test_receive_with_zero_waste_creates_no_waste_item(
    db_session, production_service, current_user, weighed_process, raw_material, target_complement
):
    raw_material.current_stock = Decimal("2000")
    db_session.flush()
    # Peso final igual al requerido: cero merma.
    run = _run_to_pending_reception(
        production_service, current_user, weighed_process, raw_material, target_complement, 10, "100"
    )
    assert run.waste_weight == Decimal("0")

    production_service.receive_finished_product(run.id, current_user)

    assert (
        db_session.query(InventoryItem)
        .filter(InventoryItem.item_type == "WASTE", InventoryItem.name == "Merma Cadenas test")
        .count()
        == 0
    )


def test_receive_with_explicit_waste_item_id_overrides_default(
    db_session, production_service, current_user, weighed_process, raw_material, target_complement
):
    raw_material.current_stock = Decimal("2000")
    db_session.flush()
    other_waste = InventoryItem(
        item_type="WASTE", name="Merma manual", sku="ME-TEST-0001", unit_code="g", current_stock=Decimal("0"),
    )
    db_session.add(other_waste)
    db_session.flush()

    run = _run_to_pending_reception(
        production_service, current_user, weighed_process, raw_material, target_complement, 10, "95"
    )

    production_service.receive_finished_product(
        run.id, current_user, ReceiveFinishedProductPayload(waste_item_id=other_waste.id)
    )

    db_session.refresh(other_waste)
    assert other_waste.current_stock == Decimal("5")
    assert db_session.query(InventoryItem).filter(InventoryItem.name == "Merma Cadenas test").count() == 0


def test_receive_rejects_waste_item_id_that_is_not_waste_type(
    db_session, production_service, current_user, weighed_process, raw_material, target_complement
):
    raw_material.current_stock = Decimal("2000")
    db_session.flush()
    run = _run_to_pending_reception(
        production_service, current_user, weighed_process, raw_material, target_complement, 10, "95"
    )

    with pytest.raises(ProductionDomainError, match="destino de merma"):
        production_service.receive_finished_product(
            run.id, current_user, ReceiveFinishedProductPayload(waste_item_id=target_complement.id)
        )


def test_receive_rejects_waste_item_id_with_mismatched_unit_code(
    db_session, production_service, current_user, weighed_process, raw_material, target_complement
):
    raw_material.current_stock = Decimal("2000")
    db_session.flush()
    # La orden pesa en "g" (materiales del weighed_process); este item de
    # merma esta en "und", una unidad incompatible.
    mismatched_waste = InventoryItem(
        item_type="WASTE", name="Merma unidades distintas", sku="ME-TEST-0002", unit_code="und",
        current_stock=Decimal("0"),
    )
    db_session.add(mismatched_waste)
    db_session.flush()

    run = _run_to_pending_reception(
        production_service, current_user, weighed_process, raw_material, target_complement, 10, "95"
    )

    with pytest.raises(ProductionDomainError, match="unidad distinta"):
        production_service.receive_finished_product(
            run.id, current_user, ReceiveFinishedProductPayload(waste_item_id=mismatched_waste.id)
        )


def test_receive_rejects_auto_named_waste_item_with_mismatched_unit_code(
    db_session, production_service, current_user, weighed_process, raw_material, target_complement
):
    """El camino de nombre automatico ("Merma <proceso>") pasa por
    ensure_production_item, que reutiliza un item existente por nombre sin
    mirar su unidad. La validacion de unidad debe cubrir tambien este camino,
    no solo el de waste_item_id explicito."""
    raw_material.current_stock = Decimal("2000")
    db_session.flush()
    # Mismo nombre que resolveria el fallback automatico para este proceso,
    # pero con una unidad incompatible con la orden (que pesa en "g").
    preexisting_waste = InventoryItem(
        item_type="WASTE", name="Merma Cadenas test", sku="ME-TEST-0003", unit_code="und",
        current_stock=Decimal("0"),
    )
    db_session.add(preexisting_waste)
    db_session.flush()

    run = _run_to_pending_reception(
        production_service, current_user, weighed_process, raw_material, target_complement, 10, "95"
    )

    with pytest.raises(ProductionDomainError, match="unidad distinta"):
        production_service.receive_finished_product(run.id, current_user)


def test_receive_rejects_named_waste_item_with_mismatched_unit_code(
    db_session, production_service, current_user, weighed_process, raw_material, target_complement
):
    """Mismo caso que el anterior pero via waste_item_name explicito (el
    texto que Inventario escribe a mano en el modal de recepcion)."""
    raw_material.current_stock = Decimal("2000")
    db_session.flush()
    preexisting_waste = InventoryItem(
        item_type="WASTE", name="Merma escrita a mano", sku="ME-TEST-0004", unit_code="und",
        current_stock=Decimal("0"),
    )
    db_session.add(preexisting_waste)
    db_session.flush()

    run = _run_to_pending_reception(
        production_service, current_user, weighed_process, raw_material, target_complement, 10, "95"
    )

    with pytest.raises(ProductionDomainError, match="unidad distinta"):
        production_service.receive_finished_product(
            run.id, current_user, ReceiveFinishedProductPayload(waste_item_name="Merma escrita a mano")
        )
