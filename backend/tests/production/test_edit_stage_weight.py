"""Corregir el peso de una etapa ya finalizada (tipeo mal hecho al pesar).

Cubre: recalculo de la merma de esa etapa, el efecto en cascada sobre etapas
posteriores ya finalizadas (su referencia es el final_weight de la anterior),
el recalculo de los totales de la orden cuando ya paso por _finish_run, y los
bloqueos (orden recibida/cancelada, etapa no finalizada, etapa sin pesaje).
"""
from decimal import Decimal

import pytest

from backend.modules.production.models import ProductionProcess, ProductionProcessStage
from backend.modules.production.schemas import ProductionRunCreate, ProductionRunStageFinish, RunProductCreate, StageWeightEdit
from backend.modules.production.service import ProductionDomainError, ProductionNotFoundError
from backend.tests.production.test_receive_merma import _run_to_pending_reception, weighed_process  # noqa: F401


@pytest.fixture()
def two_stage_weighed_process(db_session) -> ProductionProcess:
    """Dos etapas que pesan, para probar el efecto cascada de una correccion."""
    proc = ProductionProcess(
        name="Fundicion y pulido test",
        waste_limit_percent=Decimal("100"),
        is_active=True,
        stages=[
            ProductionProcessStage(
                name="Fundicion", stage_type="PROCESS", stage_order=1, is_active=True, requires_weighing=True,
            ),
            ProductionProcessStage(
                name="Pulido", stage_type="PROCESS", stage_order=2, is_active=True, requires_weighing=True,
            ),
        ],
    )
    db_session.add(proc)
    db_session.flush()
    return proc


def _run_with_two_finished_stages(
    production_service, current_user, two_stage_weighed_process, raw_material, target_complement,
    quantity, stage1_final, stage2_final,
):
    payload = ProductionRunCreate(
        process_id=two_stage_weighed_process.id,
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
    stage1, stage2 = sorted(run.stages, key=lambda s: s.stage_order)
    production_service.finish_stage(
        stage1.id, ProductionRunStageFinish(final_weight=Decimal(stage1_final)), current_user,
    )
    production_service.finish_stage(
        stage2.id, ProductionRunStageFinish(final_weight=Decimal(stage2_final)), current_user,
    )
    return production_service.repository.get_run(run_read.id)


def test_edit_recomputes_waste_of_the_edited_stage_and_run_totals(
    db_session, production_service, current_user, weighed_process, raw_material, target_complement
):
    raw_material.current_stock = Decimal("2000")
    db_session.flush()
    # 100g requeridos, termina en 95g -> 5g de merma.
    run = _run_to_pending_reception(
        production_service, current_user, weighed_process, raw_material, target_complement, 100, "95"
    )
    stage = run.stages[0]
    assert stage.waste_weight == Decimal("5")
    assert run.waste_weight == Decimal("5")
    assert run.actual_finished_weight == Decimal("95")

    result = production_service.edit_stage_weight(
        stage.id, StageWeightEdit(final_weight=Decimal("90")), current_user
    )

    assert result.status == "PENDIENTE_RECEPCION"
    db_session.refresh(stage)
    assert stage.final_weight == Decimal("90")
    assert stage.waste_weight == Decimal("10")
    assert stage.waste_percent == Decimal("10")
    db_session.refresh(run)
    assert run.waste_weight == Decimal("10")
    assert run.actual_finished_weight == Decimal("90")


def test_edit_syncs_the_auto_waste_line_in_the_acta(
    db_session, production_service, current_user, weighed_process, raw_material, target_complement
):
    """finish_stage crea una linea AUTO de merma en la acta persistida; al
    corregir el peso esa linea debe quedar sincronizada, no desactualizada."""
    from backend.modules.production.models import ActaLineSide, ActaLineSource

    raw_material.current_stock = Decimal("2000")
    db_session.flush()
    run = _run_to_pending_reception(
        production_service, current_user, weighed_process, raw_material, target_complement, 100, "95"
    )
    stage = run.stages[0]

    def waste_line():
        return next(
            line for line in run.acta_lines
            if line.side == ActaLineSide.RECEPCION and line.stage_id == stage.id and line.source == ActaLineSource.AUTO
        )

    assert waste_line().quantity == Decimal("5")

    production_service.edit_stage_weight(stage.id, StageWeightEdit(final_weight=Decimal("90")), current_user)
    db_session.refresh(run)
    assert waste_line().quantity == Decimal("10")

    # Corrige a un peso sin merma: la linea auto debe desaparecer, no quedar en 0.
    production_service.edit_stage_weight(stage.id, StageWeightEdit(final_weight=Decimal("100")), current_user)
    db_session.refresh(run)
    assert all(
        not (line.side == ActaLineSide.RECEPCION and line.stage_id == stage.id and line.source == ActaLineSource.AUTO)
        for line in run.acta_lines
    )


def test_edit_cascades_to_later_finished_stages(
    db_session, production_service, current_user, two_stage_weighed_process, raw_material, target_complement
):
    raw_material.current_stock = Decimal("2000")
    db_session.flush()
    # 100g requeridos. Fundicion termina en 90 (merma 10), pulido en 80
    # (merma 10 respecto a 90).
    run = _run_with_two_finished_stages(
        production_service, current_user, two_stage_weighed_process, raw_material, target_complement, 100, "90", "80"
    )
    stage1, stage2 = sorted(run.stages, key=lambda s: s.stage_order)
    assert stage1.waste_weight == Decimal("10")
    assert stage2.waste_weight == Decimal("10")
    assert run.waste_weight == Decimal("20")

    # Corrige fundicion: en realidad quedo en 85, no 90 (tipeo). Pulido sigue
    # en 80 tal cual se registro, pero SU merma debe recalcularse contra el
    # nuevo 85, no contra el 90 original.
    production_service.edit_stage_weight(stage1.id, StageWeightEdit(final_weight=Decimal("85")), current_user)

    db_session.refresh(stage1)
    db_session.refresh(stage2)
    db_session.refresh(run)
    assert stage1.waste_weight == Decimal("15")  # 100 - 85
    assert stage2.waste_weight == Decimal("5")   # 85 - 80
    assert run.waste_weight == Decimal("20")     # 15 + 5, la suma no cambia
    assert run.actual_finished_weight == Decimal("80")  # ultima etapa, sin tocar


def test_edit_while_run_still_in_progress_only_touches_finished_stages(
    db_session, production_service, current_user, two_stage_weighed_process, raw_material, target_complement
):
    """Corregir la primera etapa mientras la segunda sigue EN_PROCESO (sin
    peso aun) no debe tocar los totales de la orden -- todavia no existen."""
    raw_material.current_stock = Decimal("2000")
    db_session.flush()
    payload = ProductionRunCreate(
        process_id=two_stage_weighed_process.id,
        raw_material_item_id=raw_material.id,
        quantity=Decimal(100),
        assembly_mode="ASIGNAR",
        products=[RunProductCreate(target_item_id=target_complement.id, quantity=Decimal(100))],
        complements=[],
    )
    run_read = production_service.create_run(payload, current_user)
    production_service.approve_materials(run_read.id, current_user)
    production_service.start_run(run_read.id, current_user)
    run = production_service.repository.get_run(run_read.id)
    stage1, stage2 = sorted(run.stages, key=lambda s: s.stage_order)
    production_service.finish_stage(stage1.id, ProductionRunStageFinish(final_weight=Decimal("90")), current_user)
    assert run.finished_at is None
    assert run.waste_weight is None

    production_service.edit_stage_weight(stage1.id, StageWeightEdit(final_weight=Decimal("85")), current_user)

    db_session.refresh(stage1)
    assert stage1.waste_weight == Decimal("15")
    db_session.refresh(run)
    assert run.finished_at is None
    assert run.waste_weight is None  # aun no se llega a _finish_run


def test_edit_rejects_on_received_run(
    db_session, production_service, current_user, weighed_process, raw_material, target_complement
):
    raw_material.current_stock = Decimal("2000")
    db_session.flush()
    run = _run_to_pending_reception(
        production_service, current_user, weighed_process, raw_material, target_complement, 100, "95"
    )
    production_service.receive_finished_product(run.id, current_user)
    stage = run.stages[0]

    with pytest.raises(ProductionDomainError, match="recibida"):
        production_service.edit_stage_weight(stage.id, StageWeightEdit(final_weight=Decimal("90")), current_user)


def test_edit_rejects_when_stage_not_finished(
    db_session, production_service, current_user, weighed_process, raw_material, target_complement
):
    raw_material.current_stock = Decimal("2000")
    db_session.flush()
    payload = ProductionRunCreate(
        process_id=weighed_process.id,
        raw_material_item_id=raw_material.id,
        quantity=Decimal(100),
        assembly_mode="ASIGNAR",
        products=[RunProductCreate(target_item_id=target_complement.id, quantity=Decimal(100))],
        complements=[],
    )
    run_read = production_service.create_run(payload, current_user)
    production_service.approve_materials(run_read.id, current_user)
    production_service.start_run(run_read.id, current_user)
    run = production_service.repository.get_run(run_read.id)
    stage = run.stages[0]
    assert stage.status == "EN_PROCESO"

    with pytest.raises(ProductionDomainError, match="ya finalizada"):
        production_service.edit_stage_weight(stage.id, StageWeightEdit(final_weight=Decimal("90")), current_user)


def test_edit_rejects_when_stage_does_not_require_weighing(
    db_session, production_service, current_user, process, raw_material, target_complement
):
    """`process` (fixture del conftest) tiene una sola etapa que NO pesa."""
    raw_material.current_stock = Decimal("2000")
    db_session.flush()
    payload = ProductionRunCreate(
        process_id=process.id,
        raw_material_item_id=raw_material.id,
        quantity=Decimal(100),
        assembly_mode="ASIGNAR",
        products=[RunProductCreate(target_item_id=target_complement.id, quantity=Decimal(100))],
        complements=[],
    )
    run_read = production_service.create_run(payload, current_user)
    production_service.approve_materials(run_read.id, current_user)
    production_service.start_run(run_read.id, current_user)
    run = production_service.repository.get_run(run_read.id)
    stage = run.stages[0]
    production_service.finish_stage(stage.id, ProductionRunStageFinish(), current_user)
    db_session.refresh(stage)
    assert stage.status == "FINALIZADA"

    with pytest.raises(ProductionDomainError, match="no registra peso"):
        production_service.edit_stage_weight(stage.id, StageWeightEdit(final_weight=Decimal("1")), current_user)


def test_edit_rejects_weight_above_material_that_entered_the_stage(
    db_session, production_service, current_user, weighed_process, raw_material, target_complement
):
    """Un peso corregido mayor al material que entro a la etapa es error de
    captura (el material no puede crecer) -- misma regla que finish_stage."""
    raw_material.current_stock = Decimal("2000")
    db_session.flush()
    run = _run_to_pending_reception(
        production_service, current_user, weighed_process, raw_material, target_complement, 100, "95"
    )
    stage = run.stages[0]

    with pytest.raises(ProductionDomainError, match="no puede ser"):
        production_service.edit_stage_weight(
            stage.id, StageWeightEdit(final_weight=Decimal("105")), current_user
        )

    db_session.refresh(stage)
    assert stage.final_weight == Decimal("95")  # sin cambios, la correccion se rechazo


def test_edit_cascades_rejects_weight_above_previous_finished_stage(
    db_session, production_service, current_user, two_stage_weighed_process, raw_material, target_complement
):
    raw_material.current_stock = Decimal("2000")
    db_session.flush()
    run = _run_with_two_finished_stages(
        production_service, current_user, two_stage_weighed_process, raw_material, target_complement, 100, "90", "80"
    )
    stage1, stage2 = sorted(run.stages, key=lambda s: s.stage_order)

    # Pulido (stage2) no puede corregirse a mas de lo que salio de fundicion (90).
    with pytest.raises(ProductionDomainError, match="no puede ser"):
        production_service.edit_stage_weight(
            stage2.id, StageWeightEdit(final_weight=Decimal("91")), current_user
        )


def test_edit_records_a_decision_when_correction_overruns_waste_limit(
    db_session, production_service, current_user, weighed_process, raw_material, target_complement
):
    """Mismo rastro que el flujo normal (finish_stage 'pasar igualmente' una
    etapa fuera de condicion): si la correccion deja la merma de la etapa por
    encima del limite del proceso, no es un aviso pasivo -- queda una
    ProductionRunStageDecision (weight_based=True)."""
    raw_material.current_stock = Decimal("2000")
    db_session.flush()
    # 100g requeridos, termina en 95g -> 5% de merma (dentro del limite 100%).
    run = _run_to_pending_reception(
        production_service, current_user, weighed_process, raw_material, target_complement, 100, "95"
    )
    run.waste_limit_percent = Decimal("10")
    db_session.flush()
    stage = run.stages[0]
    assert stage.decisions == []

    # Corrige a 85g -> 15% de merma, supera el limite de 10% recien seteado.
    production_service.edit_stage_weight(
        stage.id, StageWeightEdit(final_weight=Decimal("85"), justification="Repesaje: bascula mal calibrada"),
        current_user,
    )

    db_session.refresh(stage)
    assert len(stage.decisions) == 1
    decision = stage.decisions[0]
    assert decision.decision == "APPROVED"
    assert decision.weight_based is True
    assert decision.final_weight == Decimal("85")
    assert decision.justification == "Repesaje: bascula mal calibrada"


def test_edit_within_waste_limit_does_not_record_a_decision(
    db_session, production_service, current_user, weighed_process, raw_material, target_complement
):
    raw_material.current_stock = Decimal("2000")
    db_session.flush()
    run = _run_to_pending_reception(
        production_service, current_user, weighed_process, raw_material, target_complement, 100, "95"
    )
    stage = run.stages[0]

    # weighed_process.waste_limit_percent es 100: 90g (10% de merma) no supera nada.
    production_service.edit_stage_weight(stage.id, StageWeightEdit(final_weight=Decimal("90")), current_user)

    db_session.refresh(stage)
    assert stage.decisions == []


def test_edit_unknown_stage_raises_not_found(production_service, current_user):
    import uuid

    with pytest.raises(ProductionNotFoundError):
        production_service.edit_stage_weight(uuid.uuid4(), StageWeightEdit(final_weight=Decimal("1")), current_user)
