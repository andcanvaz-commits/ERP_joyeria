from decimal import Decimal

from backend.modules.inventory.router import _find_waiting_production_runs
from backend.modules.production.models import ProductionRunStatus
from backend.tests.inventory.conftest import make_waiting_run


def test_finds_only_waiting_runs_for_the_given_item(db_session, raw_material):
    waiting = make_waiting_run(db_session, raw_material, 40)
    make_waiting_run(db_session, raw_material, 20, status=ProductionRunStatus.IN_PROGRESS)

    result = _find_waiting_production_runs(db_session, raw_material.id)

    assert [r.id for r in result] == [waiting.id]


def test_excludes_runs_for_other_items(db_session, raw_material):
    import uuid

    other_item_id = uuid.uuid4()
    from backend.tests.inventory.conftest import make_waiting_run as make_run

    run = make_run(db_session, raw_material, 10)
    run.raw_material_item_id = other_item_id
    db_session.flush()

    result = _find_waiting_production_runs(db_session, raw_material.id)

    assert result == []
