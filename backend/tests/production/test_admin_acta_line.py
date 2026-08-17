"""Boton de admin en la acta: agregar una linea libre (nunca mueve stock) o
enlazada a un item real de inventario (mueve stock de inmediato, sin
aprobacion). Ver docs/superpowers/specs/2026-08-17-acta-linea-admin-inventario-design.md."""
import uuid
from decimal import Decimal

import pytest

from backend.modules.inventory.models import InventoryItem
from backend.modules.production.models import ActaLineSource
from backend.modules.production.repository import ProductionProcessRepository
from backend.modules.production.schemas import (
    ActaLineUpdate,
    AdminActaLineCreate,
    ProductionRunCreate,
    RunProductCreate,
)
from backend.modules.production.service import ProductionDomainError, ProductionNotFoundError, ProductionService


def _create_run(production_service, current_user, process, raw_material, target_complement, quantity="10"):
    raw_material.current_stock = Decimal("1000")
    payload = ProductionRunCreate(
        process_id=process.id,
        raw_material_item_id=raw_material.id,
        quantity=Decimal(quantity),
        assembly_mode="ASIGNAR",
        products=[RunProductCreate(target_item_id=target_complement.id, quantity=Decimal(quantity))],
    )
    run_read = production_service.create_run(payload, current_user)
    return production_service.repository.get_run(run_read.id)


def test_add_admin_acta_line_free_text_does_not_move_stock(
    db_session, production_service, current_user, process, raw_material, target_complement
):
    run = _create_run(production_service, current_user, process, raw_material, target_complement)

    result = production_service.add_admin_acta_line(
        run.id,
        AdminActaLineCreate(side="ENTREGA", label="Tornillo prestado", quantity=Decimal("2"), unit_code="und"),
        current_user,
    )

    lines = [l for l in result.acta_lines if l.source == "MANUAL" and l.label == "Tornillo prestado"]
    assert len(lines) == 1
    assert lines[0].item_id is None
    assert lines[0].quantity == Decimal("2")


def test_add_admin_acta_line_free_text_requires_label_and_unit(
    db_session, production_service, current_user, process, raw_material, target_complement
):
    run = _create_run(production_service, current_user, process, raw_material, target_complement)

    with pytest.raises(ProductionDomainError, match="detalle y la unidad"):
        production_service.add_admin_acta_line(
            run.id, AdminActaLineCreate(side="ENTREGA", quantity=Decimal("2")), current_user
        )


def test_add_admin_acta_line_linked_entrega_consumes_stock(
    db_session, production_service, current_user, process, raw_material, target_complement
):
    run = _create_run(production_service, current_user, process, raw_material, target_complement)
    supply = InventoryItem(
        item_type="SUPPLY", name="Insumo olvidado", sku=f"IN-TEST-{uuid.uuid4().hex[:8]}",
        unit_code="und", current_stock=Decimal("50"),
    )
    db_session.add(supply)
    db_session.flush()

    result = production_service.add_admin_acta_line(
        run.id,
        AdminActaLineCreate(side="ENTREGA", item_id=supply.id, quantity=Decimal("5")),
        current_user,
    )

    db_session.refresh(supply)
    assert supply.current_stock == Decimal("45")
    lines = [l for l in result.acta_lines if l.item_id == supply.id]
    assert len(lines) == 1
    assert lines[0].source == "ADMIN_STOCK"
    assert lines[0].label == "Insumo olvidado"
    assert lines[0].unit_code == "und"
    assert lines[0].quantity == Decimal("5")


def test_add_admin_acta_line_linked_recepcion_adds_stock(
    db_session, production_service, current_user, process, raw_material, target_complement
):
    run = _create_run(production_service, current_user, process, raw_material, target_complement)
    complement = InventoryItem(
        item_type="COMPLEMENT", name="Broche olvidado", sku=f"CO-TEST-{uuid.uuid4().hex[:8]}",
        unit_code="und", current_stock=Decimal("10"),
    )
    db_session.add(complement)
    db_session.flush()

    production_service.add_admin_acta_line(
        run.id,
        AdminActaLineCreate(side="RECEPCION", item_id=complement.id, quantity=Decimal("3")),
        current_user,
    )

    db_session.refresh(complement)
    assert complement.current_stock == Decimal("13")


def test_add_admin_acta_line_missing_item_raises_not_found(
    db_session, production_service, current_user, process, raw_material, target_complement
):
    run = _create_run(production_service, current_user, process, raw_material, target_complement)

    with pytest.raises(ProductionNotFoundError):
        production_service.add_admin_acta_line(
            run.id,
            AdminActaLineCreate(side="ENTREGA", item_id=uuid.uuid4(), quantity=Decimal("1")),
            current_user,
        )


def test_add_admin_acta_line_linked_requires_inventory_service(
    db_session, production_service, current_user, process, raw_material, target_complement
):
    """La rama enlazada a un item real necesita inventory_service; la rama de
    texto libre nunca lo toca, asi que debe seguir funcionando sin el (ver
    finding de review sobre c512712: guard solo en el call site, no dentro de
    _apply_admin_acta_line_delta)."""
    run = _create_run(production_service, current_user, process, raw_material, target_complement)
    supply = InventoryItem(
        item_type="SUPPLY", name="Insumo sin inventario", sku=f"IN-TEST-{uuid.uuid4().hex[:8]}",
        unit_code="und", current_stock=Decimal("50"),
    )
    db_session.add(supply)
    db_session.flush()

    service_without_inventory = ProductionService(
        repository=ProductionProcessRepository(db_session), inventory_service=None,
    )

    with pytest.raises(ProductionDomainError, match="Inventario no esta disponible"):
        service_without_inventory.add_admin_acta_line(
            run.id,
            AdminActaLineCreate(side="ENTREGA", item_id=supply.id, quantity=Decimal("5")),
            current_user,
        )

    result = service_without_inventory.add_admin_acta_line(
        run.id,
        AdminActaLineCreate(side="ENTREGA", label="Tornillo prestado", quantity=Decimal("2"), unit_code="und"),
        current_user,
    )

    lines = [l for l in result.acta_lines if l.source == "MANUAL" and l.label == "Tornillo prestado"]
    assert len(lines) == 1
    assert lines[0].item_id is None
    assert lines[0].quantity == Decimal("2")


def test_add_admin_acta_line_rejects_historical_run(
    db_session, production_service, current_user, process, raw_material, target_complement
):
    from backend.modules.production.models import ProductionRunEventLine

    run = _create_run(production_service, current_user, process, raw_material, target_complement)
    run.event_lines.append(
        ProductionRunEventLine(side="ENTREGA", detalle="Historico", gramos=Decimal("10"), unidad="g")
    )
    db_session.flush()

    with pytest.raises(ProductionDomainError, match="acta cargada desde papel"):
        production_service.add_admin_acta_line(
            run.id, AdminActaLineCreate(side="ENTREGA", label="X", quantity=Decimal("1"), unit_code="g"),
            current_user,
        )


def test_update_admin_stock_line_quantity_up_applies_only_delta(
    db_session, production_service, current_user, process, raw_material, target_complement
):
    run = _create_run(production_service, current_user, process, raw_material, target_complement)
    supply = InventoryItem(
        item_type="SUPPLY", name="Insumo olvidado", sku=f"IN-TEST-{uuid.uuid4().hex[:8]}",
        unit_code="und", current_stock=Decimal("50"),
    )
    db_session.add(supply)
    db_session.flush()
    result = production_service.add_admin_acta_line(
        run.id, AdminActaLineCreate(side="ENTREGA", item_id=supply.id, quantity=Decimal("5")), current_user,
    )
    line_id = [l for l in result.acta_lines if l.item_id == supply.id][0].id

    production_service.update_acta_line(line_id, ActaLineUpdate(quantity=Decimal("8")), current_user)

    db_session.refresh(supply)
    assert supply.current_stock == Decimal("42")  # 50 - 5 - 3 (delta), no 50 - 8 dos veces


def test_update_admin_stock_line_quantity_down_returns_stock(
    db_session, production_service, current_user, process, raw_material, target_complement
):
    run = _create_run(production_service, current_user, process, raw_material, target_complement)
    supply = InventoryItem(
        item_type="SUPPLY", name="Insumo olvidado", sku=f"IN-TEST-{uuid.uuid4().hex[:8]}",
        unit_code="und", current_stock=Decimal("50"),
    )
    db_session.add(supply)
    db_session.flush()
    result = production_service.add_admin_acta_line(
        run.id, AdminActaLineCreate(side="ENTREGA", item_id=supply.id, quantity=Decimal("5")), current_user,
    )
    line_id = [l for l in result.acta_lines if l.item_id == supply.id][0].id

    production_service.update_acta_line(line_id, ActaLineUpdate(quantity=Decimal("2")), current_user)

    db_session.refresh(supply)
    assert supply.current_stock == Decimal("48")  # 50 - 5 + 3


def test_update_admin_stock_line_rejects_label_or_unit_edit(
    db_session, production_service, current_user, process, raw_material, target_complement
):
    run = _create_run(production_service, current_user, process, raw_material, target_complement)
    supply = InventoryItem(
        item_type="SUPPLY", name="Insumo olvidado", sku=f"IN-TEST-{uuid.uuid4().hex[:8]}",
        unit_code="und", current_stock=Decimal("50"),
    )
    db_session.add(supply)
    db_session.flush()
    result = production_service.add_admin_acta_line(
        run.id, AdminActaLineCreate(side="ENTREGA", item_id=supply.id, quantity=Decimal("5")), current_user,
    )
    line_id = [l for l in result.acta_lines if l.item_id == supply.id][0].id

    with pytest.raises(ProductionDomainError, match="no se editan a mano"):
        production_service.update_acta_line(line_id, ActaLineUpdate(label="Otro nombre"), current_user)
