"""Auto-alimentacion de la acta persistida con eventos reales (pieza C):
merma por etapa al finalizarla, y peso final al recibir el producto."""
from decimal import Decimal

from backend.modules.production.models import ActaLineSide, ActaLineSource
from backend.modules.production.schemas import (
    ProductionRunCreate,
    ProductionRunStageFinish,
    RunProductCreate,
)
from backend.tests.production.test_receive_merma import weighed_process  # noqa: F401


def test_finish_stage_adds_merma_line_when_there_is_waste(
    db_session, production_service, current_user, weighed_process, raw_material, target_complement
):
    raw_material.current_stock = Decimal("2000")
    db_session.flush()
    payload = ProductionRunCreate(
        process_id=weighed_process.id,
        raw_material_item_id=raw_material.id,
        quantity=Decimal("100"),
        products=[RunProductCreate(target_item_id=target_complement.id, quantity=Decimal("100"))],
    )
    run_read = production_service.create_run(payload, current_user)
    production_service.approve_materials(run_read.id, current_user)
    production_service.start_run(run_read.id, current_user)
    run = production_service.repository.get_run(run_read.id)
    stage = run.stages[0]
    stage.requires_weighing = True
    db_session.flush()

    production_service.finish_stage(
        stage.id,
        ProductionRunStageFinish(initial_weight=run.total_required_material, final_weight=Decimal("95")),
        current_user,
    )

    updated_run = production_service.repository.get_run(run.id)
    merma_lines = [
        line for line in updated_run.acta_lines
        if line.side == ActaLineSide.RECEPCION and line.source == ActaLineSource.AUTO
    ]
    assert len(merma_lines) == 1
    assert merma_lines[0].quantity == Decimal("5")
    assert merma_lines[0].stage_id == stage.id
    # El banco de procesos ya no tiene sub-etapas (seccion 3): stage_name ==
    # process.name.
    assert "Cadenas test" in merma_lines[0].label


def test_finish_stage_does_not_add_line_when_no_waste(
    db_session, production_service, current_user, weighed_process, raw_material, target_complement
):
    raw_material.current_stock = Decimal("2000")
    db_session.flush()
    payload = ProductionRunCreate(
        process_id=weighed_process.id,
        raw_material_item_id=raw_material.id,
        quantity=Decimal("100"),
        products=[RunProductCreate(target_item_id=target_complement.id, quantity=Decimal("100"))],
    )
    run_read = production_service.create_run(payload, current_user)
    production_service.approve_materials(run_read.id, current_user)
    production_service.start_run(run_read.id, current_user)
    run = production_service.repository.get_run(run_read.id)
    stage = run.stages[0]
    stage.requires_weighing = True
    db_session.flush()

    production_service.finish_stage(
        stage.id,
        ProductionRunStageFinish(initial_weight=run.total_required_material, final_weight=Decimal("100")),
        current_user,
    )

    updated_run = production_service.repository.get_run(run.id)
    auto_lines = [line for line in updated_run.acta_lines if line.source == ActaLineSource.AUTO]
    assert auto_lines == []


def test_receive_does_not_add_peso_final_recibido_line_when_products_declared(
    db_session, production_service, current_user, weighed_process, raw_material, target_complement
):
    # Cuando la orden declara productos resultantes, productoRealLines en el
    # frontend (frontend/lib/orden-produccion.ts) ya reconstruye este mismo
    # peso a partir de actual_finished_weight repartido entre los productos.
    # Si el backend tambien agregara la linea AUTO "Peso final recibido",
    # "Total recibido" quedaria duplicado (bug de la review final, commits
    # d3c2787..7b4b2ef).
    raw_material.current_stock = Decimal("2000")
    db_session.flush()
    payload = ProductionRunCreate(
        process_id=weighed_process.id,
        raw_material_item_id=raw_material.id,
        quantity=Decimal("100"),
        products=[RunProductCreate(target_item_id=target_complement.id, quantity=Decimal("100"))],
    )
    run_read = production_service.create_run(payload, current_user)
    production_service.approve_materials(run_read.id, current_user)
    production_service.start_run(run_read.id, current_user)
    run = production_service.repository.get_run(run_read.id)
    run.stages[0].requires_weighing = True
    db_session.flush()
    production_service.finish_stage(
        run.stages[0].id,
        ProductionRunStageFinish(initial_weight=run.total_required_material, final_weight=Decimal("95")),
        current_user,
    )

    production_service.receive_finished_product(run.id, current_user)

    updated_run = production_service.repository.get_run(run.id)
    peso_lines = [
        line for line in updated_run.acta_lines
        if line.side == ActaLineSide.RECEPCION and line.source == ActaLineSource.AUTO and line.label == "Peso final recibido"
    ]
    assert peso_lines == []


def test_receive_adds_peso_final_recibido_line_when_no_products_declared(
    db_session, production_service, current_user, weighed_process, raw_material, target_complement
):
    # Sin productos declarados (ordenes viejas o sin plan de resultantes),
    # esta linea AUTO es el unico registro del peso recibido, asi que debe
    # seguir generandose. ProductionRunCreate.products exige min_length=1 hoy
    # (no hay forma de mandar un payload con products=[] por este flujo), asi
    # que para simular el estado legado (filas de antes de que products fuera
    # obligatorio) se crea la orden normal y se vacia run.products a mano.
    raw_material.current_stock = Decimal("2000")
    db_session.flush()
    payload = ProductionRunCreate(
        process_id=weighed_process.id,
        raw_material_item_id=raw_material.id,
        quantity=Decimal("100"),
        products=[RunProductCreate(target_item_id=target_complement.id, quantity=Decimal("100"))],
    )
    run_read = production_service.create_run(payload, current_user)
    production_service.approve_materials(run_read.id, current_user)
    production_service.start_run(run_read.id, current_user)
    run = production_service.repository.get_run(run_read.id)
    run.products = []
    run.stages[0].requires_weighing = True
    db_session.flush()
    production_service.finish_stage(
        run.stages[0].id,
        ProductionRunStageFinish(initial_weight=run.total_required_material, final_weight=Decimal("95")),
        current_user,
    )

    production_service.receive_finished_product(run.id, current_user)

    updated_run = production_service.repository.get_run(run.id)
    peso_lines = [
        line for line in updated_run.acta_lines
        if line.side == ActaLineSide.RECEPCION and line.source == ActaLineSource.AUTO and line.label == "Peso final recibido"
    ]
    assert len(peso_lines) == 1
    assert peso_lines[0].quantity == Decimal("95")
