"""Rechazar una solicitud de produccion (antes de aprobar materiales, todavia
PENDIENTE_INVENTARIO) es distinto de cancelar una orden ya avanzada -- ambas
dejan status CANCELADA, pero is_cancellation las distingue en el historial."""
from decimal import Decimal

import pytest

from backend.modules.production.service import ProductionDomainError, ProductionNotFoundError
from backend.tests.production.test_material_split import _create_run


def test_reject_materials_is_not_flagged_as_cancellation(
    db_session, production_service, current_user, process, raw_material, target_complement
):
    raw_material.current_stock = Decimal("1000")
    db_session.flush()
    run_read = _create_run(production_service, current_user, process, raw_material, target_complement, 100)

    result = production_service.reject_materials(run_read.id, current_user, "no hay presupuesto")

    assert result.status == "CANCELADA"
    assert result.is_cancellation is False
    assert result.rejection_reason == "no hay presupuesto"


def test_reject_materials_only_from_pending_inventory(
    db_session, production_service, current_user, process, raw_material, target_complement
):
    raw_material.current_stock = Decimal("1000")
    db_session.flush()
    run_read = _create_run(production_service, current_user, process, raw_material, target_complement, 100)
    production_service.approve_materials(run_read.id, current_user)

    with pytest.raises(ProductionDomainError, match="pendiente de Inventario"):
        production_service.reject_materials(run_read.id, current_user, "motivo")


def test_reject_materials_unknown_run_raises_not_found(production_service, current_user):
    import uuid

    with pytest.raises(ProductionNotFoundError):
        production_service.reject_materials(uuid.uuid4(), current_user, "motivo")
