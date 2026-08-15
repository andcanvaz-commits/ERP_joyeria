"""Peso real (run.actual_finished_weight) al terminar una orden.

Bug reportado: en un proceso de 2+ etapas donde la ULTIMA etapa no pesa (ej.
un control despues de la etapa que si pesa), _finish_run usaba el
final_weight crudo de esa ultima etapa (None) como "peso real", mostrando
0 en vez de la cantidad menos la merma real ya registrada en una etapa
anterior."""
from decimal import Decimal

import pytest

from backend.modules.production.models import ProductionProcess, ProductionProcessStage
from backend.modules.production.schemas import (
    ProductionRunCreate,
    ProductionRunStageFinish,
    RunProductCreate,
    StageWeightEdit,
)


@pytest.fixture()
def weigh_then_no_weigh_process(db_session) -> ProductionProcess:
    """Etapa 1 pesa, etapa 2 (ej. control final) no pesa."""
    proc = ProductionProcess(
        name="Fundicion y control test",
        waste_limit_percent=Decimal("100"),
        is_active=True,
        stages=[
            ProductionProcessStage(
                name="Fundicion", stage_type="PROCESS", stage_order=1, is_active=True, requires_weighing=True,
            ),
            ProductionProcessStage(
                name="Control final", stage_type="PROCESS", stage_order=2, is_active=True, requires_weighing=False,
            ),
        ],
    )
    db_session.add(proc)
    db_session.flush()
    return proc


def _run_through_both_stages(
    production_service, current_user, weigh_then_no_weigh_process, raw_material, target_complement, quantity, final_weight
):
    payload = ProductionRunCreate(
        process_id=weigh_then_no_weigh_process.id,
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
        stage1.id, ProductionRunStageFinish(final_weight=Decimal(final_weight)), current_user,
    )
    production_service.finish_stage(stage2.id, ProductionRunStageFinish(), current_user)
    return production_service.repository.get_run(run_read.id)


def test_actual_finished_weight_uses_quantity_minus_waste_not_last_stage_weight(
    db_session, production_service, current_user, weigh_then_no_weigh_process, raw_material, target_complement
):
    raw_material.current_stock = Decimal("2000")
    db_session.flush()
    # 88g requeridos, etapa 1 (la que pesa) termina en 87.4g -> 0.6g de merma.
    # La etapa 2 (control, no pesa) es la ultima en terminar -- final_weight
    # crudo de ESA etapa seria None, no 87.4.
    run = _run_through_both_stages(
        production_service, current_user, weigh_then_no_weigh_process, raw_material, target_complement, "88", "87.4"
    )

    assert run.status == "PENDIENTE_RECEPCION"
    assert run.waste_weight == Decimal("0.6")
    assert run.actual_finished_weight == Decimal("87.4")  # 88 - 0.6, no 0


def test_actual_finished_weight_recomputes_after_editing_the_weighed_stage(
    db_session, production_service, current_user, weigh_then_no_weigh_process, raw_material, target_complement
):
    raw_material.current_stock = Decimal("2000")
    db_session.flush()
    run = _run_through_both_stages(
        production_service, current_user, weigh_then_no_weigh_process, raw_material, target_complement, "88", "87.4"
    )
    stage1 = sorted(run.stages, key=lambda s: s.stage_order)[0]

    production_service.edit_stage_weight(stage1.id, StageWeightEdit(final_weight=Decimal("86")), current_user)

    db_session.refresh(run)
    assert run.waste_weight == Decimal("2")
    assert run.actual_finished_weight == Decimal("86")  # 88 - 2
