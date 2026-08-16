from decimal import Decimal

import pytest

from backend.modules.production.models import ProductionProcess, ProductionProcessStage
from backend.modules.production.schemas import ProductionRunCreate, ProductionRunStageFinish, RunProductCreate
from backend.modules.production.service import ProductionDomainError


@pytest.fixture()
def weighed_process(db_session) -> ProductionProcess:
    proc = ProductionProcess(
        name="Cadenas formato test",
        waste_limit_percent=Decimal("100"),
        is_active=True,
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


def test_finish_stage_weight_error_has_no_trailing_zeros(
    db_session, production_service, current_user, weighed_process, raw_material, target_complement
):
    raw_material.current_stock = Decimal("2000.0000")
    db_session.flush()
    payload = ProductionRunCreate(
        process_id=weighed_process.id,
        raw_material_item_id=raw_material.id,
        quantity=Decimal("400.0000"),
        assembly_mode="ASIGNAR",
        products=[RunProductCreate(target_item_id=target_complement.id, quantity=Decimal("400.0000"))],
        complements=[],
    )
    run_read = production_service.create_run(payload, current_user)
    production_service.approve_materials(run_read.id, current_user)
    production_service.start_run(run_read.id, current_user)
    run = production_service.repository.get_run(run_read.id)

    with pytest.raises(ProductionDomainError) as exc_info:
        production_service.finish_stage(
            run.stages[0].id,
            ProductionRunStageFinish(final_weight=Decimal("5000.0000")),
            current_user,
        )

    message = str(exc_info.value)
    assert "400 g" in message
    assert "400.0000" not in message
