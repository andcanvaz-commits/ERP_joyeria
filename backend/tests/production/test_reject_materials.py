"""Rechazar una solicitud de produccion (antes de aprobar materiales, todavia
PENDIENTE_INVENTARIO) es distinto de cancelar una orden ya avanzada -- ambas
dejan status CANCELADA, pero is_cancellation las distingue en el historial."""
import uuid
from decimal import Decimal

import pytest

from backend.modules.inventory.models import InventoryItem
from backend.modules.production.schemas import AdminActaLineCreate
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


# ---------------------------------------------------------------------------
# Finding (re-review, rama feature/acta-linea-admin-inventario): reject_materials
# ponia run.status = CANCELADA directo, sin pasar por _cancel_run_core -- una
# linea ADMIN_STOCK agregada mientras la orden todavia esta PENDIENTE_INVENTARIO
# (add_admin_acta_line no tiene guard de estado) quedaba con su stock consumido
# para siempre: una vez CANCELADA, cancel_run se niega a tocarla de nuevo.
# ---------------------------------------------------------------------------


def test_reject_materials_reverts_admin_stock_line_stock(
    db_session, production_service, current_user, process, raw_material, target_complement
):
    run_read = _create_run(production_service, current_user, process, raw_material, target_complement, 100)
    supply = InventoryItem(
        item_type="SUPPLY", name="Insumo olvidado", sku=f"IN-TEST-{uuid.uuid4().hex[:8]}",
        unit_code="und", current_stock=Decimal("50"),
    )
    db_session.add(supply)
    db_session.flush()
    production_service.add_admin_acta_line(
        run_read.id, AdminActaLineCreate(side="ENTREGA", item_id=supply.id, quantity=Decimal("5")), current_user,
    )
    db_session.refresh(supply)
    assert supply.current_stock == Decimal("45")

    result = production_service.reject_materials(run_read.id, current_user, "motivo")

    assert result.status == "CANCELADA"
    db_session.refresh(supply)
    assert supply.current_stock == Decimal("50")
