"""Boton de admin en la acta: agregar una linea libre (nunca mueve stock) o
enlazada a un item real de inventario (mueve stock de inmediato, sin
aprobacion). Ver docs/superpowers/specs/2026-08-17-acta-linea-admin-inventario-design.md.

Incluye tambien los 4 findings del review final de la rama
feature/acta-linea-admin-inventario:
- Fix 1: solo admin puede editar/borrar una linea ADMIN_STOCK
  (update_acta_line/delete_acta_line), no solo agregarla.
- Fix 2: el merge por item_id de _add_or_merge_acta_line/_sync_entrega_acta_line
  nunca puede aterrizar sobre una linea ADMIN_STOCK.
- Fix 3: cancelar una orden revierte tambien las lineas ADMIN_STOCK.
- Fix 4: la linea ADMIN_STOCK que consume (ENTREGA) respeta el stock
  reservado para otras ordenes ESPERANDO_MATERIAL."""
import uuid
from decimal import Decimal

import pytest

# Import necesario aunque no se use directamente: registra la tabla
# product_types en el metadata de SQLAlchemy antes del flush (ProductionRun
# tiene un FK a product_types.id). Mismo patron que test_dynamic_flow.py.
from backend.modules.product_types.models import ProductType  # noqa: F401
from backend.modules.auth.dependencies import CurrentUser
from backend.modules.inventory.models import InventoryItem
from backend.modules.production.models import ActaLineSource
from backend.modules.production.repository import ProductionProcessRepository
from backend.modules.production.schemas import (
    ActaLineCreate,
    ActaLineUpdate,
    AdminActaLineCreate,
    ProductionOrderCreate,
)
from backend.modules.production.service import ProductionDomainError, ProductionNotFoundError, ProductionService


@pytest.fixture()
def admin_user(db_session) -> CurrentUser:
    from backend.modules.auth.models import AuthUser

    user_id = uuid.uuid4()
    auth_user = AuthUser(
        id=user_id,
        username="admin_test",
        email="admin@test.local",
        password_hash="mock_hashed",
        role="admin",
    )
    db_session.add(auth_user)
    db_session.flush()

    return CurrentUser(id=user_id, username="admin_test", role="admin", permissions=frozenset())


def _create_run(production_service, current_user, process, raw_material, target_complement, quantity="10"):
    raw_material.current_stock = Decimal("1000")
    order = production_service.create_order(ProductionOrderCreate(name="Orden admin acta test"), current_user)
    return production_service.repository.get_run(order.id)


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
    db_session, production_service, current_user, admin_user, process, raw_material, target_complement
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

    production_service.update_acta_line(line_id, ActaLineUpdate(quantity=Decimal("8")), admin_user)

    db_session.refresh(supply)
    assert supply.current_stock == Decimal("42")  # 50 - 5 - 3 (delta), no 50 - 8 dos veces


def test_update_admin_stock_line_quantity_down_returns_stock(
    db_session, production_service, current_user, admin_user, process, raw_material, target_complement
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

    production_service.update_acta_line(line_id, ActaLineUpdate(quantity=Decimal("2")), admin_user)

    db_session.refresh(supply)
    assert supply.current_stock == Decimal("48")  # 50 - 5 + 3


def test_update_admin_stock_line_rejects_label_or_unit_edit(
    db_session, production_service, current_user, admin_user, process, raw_material, target_complement
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
        production_service.update_acta_line(line_id, ActaLineUpdate(label="Otro nombre"), admin_user)


def test_delete_admin_stock_line_reverts_stock(
    db_session, production_service, current_user, admin_user, process, raw_material, target_complement
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

    updated = production_service.delete_acta_line(line_id, admin_user)

    db_session.refresh(supply)
    assert supply.current_stock == Decimal("50")
    assert all(l.id != line_id for l in updated.acta_lines)


def test_delete_admin_stock_line_blocks_if_stock_insufficient_to_revert(
    db_session, production_service, current_user, admin_user, process, raw_material, target_complement
):
    """Linea RECEPCION admin sumo 3 unidades; si ese stock ya se gasto en
    otro lado, revertir (una SALIDA) dejaria el stock negativo -- debe
    fallar y la linea debe seguir existiendo."""
    run = _create_run(production_service, current_user, process, raw_material, target_complement)
    complement = InventoryItem(
        item_type="COMPLEMENT", name="Broche olvidado", sku=f"CO-TEST-{uuid.uuid4().hex[:8]}",
        unit_code="und", current_stock=Decimal("10"),
    )
    db_session.add(complement)
    db_session.flush()
    result = production_service.add_admin_acta_line(
        run.id, AdminActaLineCreate(side="RECEPCION", item_id=complement.id, quantity=Decimal("3")), current_user,
    )
    line_id = [l for l in result.acta_lines if l.item_id == complement.id][0].id
    complement.current_stock = Decimal("1")  # se gasto en otro lado despues de sumarse
    db_session.flush()

    with pytest.raises(ProductionDomainError):
        production_service.delete_acta_line(line_id, admin_user)

    db_session.refresh(complement)
    assert complement.current_stock == Decimal("1")
    refreshed = production_service.repository.get_acta_line(line_id)
    assert refreshed is not None


# ---------------------------------------------------------------------------
# Fix 1 (review final): update_acta_line/delete_acta_line solo estaban
# gateadas por el permiso generico "production.runs.update" -- que tanto
# Jefe de produccion como Jefe de inventario tienen. Sin este chequeo dentro
# del service, cualquiera de los dos podia editar/borrar una linea ADMIN_STOCK
# (mover stock real) sin pasar nunca por el permiso admin-only del boton "+".
# ---------------------------------------------------------------------------


def test_update_admin_stock_line_rejects_non_admin(
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

    with pytest.raises(ProductionDomainError, match="Solo el administrador"):
        production_service.update_acta_line(line_id, ActaLineUpdate(quantity=Decimal("8")), current_user)

    db_session.refresh(supply)
    assert supply.current_stock == Decimal("45")  # sin tocar: el chequeo corta antes de mover stock


def test_delete_admin_stock_line_rejects_non_admin(
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

    with pytest.raises(ProductionDomainError, match="Solo el administrador"):
        production_service.delete_acta_line(line_id, current_user)

    db_session.refresh(supply)
    assert supply.current_stock == Decimal("45")
    refreshed = production_service.repository.get_acta_line(line_id)
    assert refreshed is not None


def test_admin_can_update_and_delete_admin_stock_line(
    db_session, production_service, current_user, admin_user, process, raw_material, target_complement
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

    production_service.update_acta_line(line_id, ActaLineUpdate(quantity=Decimal("8")), admin_user)
    db_session.refresh(supply)
    assert supply.current_stock == Decimal("42")  # 50 - 5 - 3

    updated = production_service.delete_acta_line(line_id, admin_user)
    db_session.refresh(supply)
    assert supply.current_stock == Decimal("50")
    assert all(l.id != line_id for l in updated.acta_lines)


def test_non_admin_can_still_update_and_delete_a_manual_line(
    db_session, production_service, current_user, process, raw_material, target_complement
):
    """No regression: el chequeo admin es solo para ADMIN_STOCK -- una linea
    MANUAL (libre, nunca movio inventario real) la sigue pudiendo editar y
    borrar cualquiera con permiso production.runs.update, como siempre."""
    run = _create_run(production_service, current_user, process, raw_material, target_complement)
    run_read = production_service.add_acta_line(
        run.id,
        ActaLineCreate(side="ENTREGA", label="Tornillo prestado", quantity=Decimal("2"), unit_code="und"),
        current_user,
    )
    line_id = [l for l in run_read.acta_lines if l.label == "Tornillo prestado"][0].id

    updated = production_service.update_acta_line(line_id, ActaLineUpdate(quantity=Decimal("3")), current_user)
    assert [l for l in updated.acta_lines if l.id == line_id][0].quantity == Decimal("3")

    final = production_service.delete_acta_line(line_id, current_user)
    assert all(l.id != line_id for l in final.acta_lines)


# ---------------------------------------------------------------------------
# Fix 3 (review final, decision de Rodrigo): cancelar una orden con una linea
# ADMIN_STOCK debe revertir tambien el stock que esa linea movio -- no solo
# el consumo normal via reverse_production_consumption.
# ---------------------------------------------------------------------------


def test_cancel_run_reverts_admin_stock_line_stock(
    db_session, production_service, current_user, process, raw_material, target_complement
):
    run = _create_run(production_service, current_user, process, raw_material, target_complement)
    supply = InventoryItem(
        item_type="SUPPLY", name="Insumo olvidado", sku=f"IN-TEST-{uuid.uuid4().hex[:8]}",
        unit_code="und", current_stock=Decimal("50"),
    )
    db_session.add(supply)
    db_session.flush()
    production_service.add_admin_acta_line(
        run.id, AdminActaLineCreate(side="ENTREGA", item_id=supply.id, quantity=Decimal("5")), current_user,
    )
    db_session.refresh(supply)
    assert supply.current_stock == Decimal("45")

    result = production_service.cancel_run(run.id, current_user, "motivo")

    assert result.status == "CANCELADA"
    db_session.refresh(supply)
    assert supply.current_stock == Decimal("50")


def test_cancel_run_reverts_admin_stock_line_alongside_stage_attempt_consumption(
    db_session, production_service, current_user, process, raw_material, target_complement
):
    """La linea ADMIN_STOCK se revierte pase lo que pase con el consumo
    normal de la orden (flujo nuevo: start_stage_attempt)."""
    from backend.modules.production.schemas import RunProductCreate, StageAttemptCreate, StageAttemptMaterialLine

    raw_material.current_stock = Decimal("1000")
    db_session.flush()
    order = production_service.create_order(ProductionOrderCreate(name="Orden a cancelar con acta admin"), current_user)
    production_service.start_stage_attempt(
        order.id,
        StageAttemptCreate(
            process_id=process.id,
            responsable_name="Ana",
            materials=[StageAttemptMaterialLine(item_id=raw_material.id, quantity=Decimal("100"))],
            product=RunProductCreate(target_item_id=target_complement.id, quantity=Decimal("1")),
        ),
        current_user,
    )
    db_session.refresh(raw_material)
    assert raw_material.current_stock == Decimal("900")

    supply = InventoryItem(
        item_type="SUPPLY", name="Insumo olvidado", sku=f"IN-TEST-{uuid.uuid4().hex[:8]}",
        unit_code="und", current_stock=Decimal("50"),
    )
    db_session.add(supply)
    db_session.flush()
    production_service.add_admin_acta_line(
        order.id, AdminActaLineCreate(side="ENTREGA", item_id=supply.id, quantity=Decimal("5")), current_user,
    )
    db_session.refresh(supply)
    assert supply.current_stock == Decimal("45")

    result = production_service.cancel_run(order.id, current_user, "motivo")

    assert result.status == "CANCELADA"
    db_session.refresh(raw_material)
    assert raw_material.current_stock == Decimal("1000")  # consumo normal revertido
    db_session.refresh(supply)
    assert supply.current_stock == Decimal("50")  # linea admin tambien revertida


def test_admin_stock_line_allows_consuming_unreserved_stock(
    db_session, production_service, current_user, process, raw_material, target_complement
):
    """Control positivo: si nada esta reservado, la linea admin consume
    normal (el chequeo nuevo no rompe el caso sin conflicto)."""
    run = _create_run(production_service, current_user, process, raw_material, target_complement)
    raw_material.current_stock = Decimal("100")
    db_session.flush()

    result = production_service.add_admin_acta_line(
        run.id, AdminActaLineCreate(side="ENTREGA", item_id=raw_material.id, quantity=Decimal("10")), current_user,
    )

    db_session.refresh(raw_material)
    assert raw_material.current_stock == Decimal("90")
    lines = [l for l in result.acta_lines if l.item_id == raw_material.id and l.source == "ADMIN_STOCK"]
    assert len(lines) == 1


# ---------------------------------------------------------------------------
# RECEPCION acotada a lo entregado en la misma etapa (docs/superpowers/plans/
# 2026-08-19-rediseno-acta-y-ux-produccion.md Task 7): solo se puede recibir
# un item que ya se entrego en ese intento, y como maximo lo que quede sin
# recibir todavia.
# ---------------------------------------------------------------------------


def _start_with_entrega(db_session, production_service, current_user, process, raw_material, target_complement, entregado="100"):
    from backend.modules.production.schemas import RunProductCreate, StageAttemptCreate, StageAttemptMaterialLine

    raw_material.current_stock = Decimal("1000")
    db_session.flush()
    order = production_service.create_order(ProductionOrderCreate(name="Orden recepcion test"), current_user)
    started = production_service.start_stage_attempt(
        order.id,
        StageAttemptCreate(
            process_id=process.id,
            responsable_name="Ana",
            materials=[StageAttemptMaterialLine(item_id=raw_material.id, quantity=Decimal(entregado))],
            product=RunProductCreate(target_item_id=target_complement.id, quantity=Decimal("1")),
        ),
        current_user,
    )
    return order, started.stage_attempts[0]


def test_add_admin_acta_line_recepcion_rejects_item_never_entregado(
    db_session, production_service, current_user, process, raw_material, target_complement
):
    from backend.modules.inventory.models import InventoryItem

    order, attempt = _start_with_entrega(db_session, production_service, current_user, process, raw_material, target_complement)
    other_item = InventoryItem(
        item_type="RAW_MATERIAL", name="Otro material", sku=f"MP-TEST-{uuid.uuid4().hex[:8]}",
        unit_code="g", current_stock=Decimal("10"),
    )
    db_session.add(other_item)
    db_session.flush()

    with pytest.raises(ProductionDomainError, match="ya se entrego en esta etapa"):
        production_service.add_admin_acta_line(
            order.id,
            AdminActaLineCreate(side="RECEPCION", item_id=other_item.id, quantity=Decimal("1"), stage_attempt_id=attempt.id),
            current_user,
        )


def test_add_admin_acta_line_recepcion_caps_at_entregado_minus_recibido(
    db_session, production_service, current_user, process, raw_material, target_complement
):
    order, attempt = _start_with_entrega(db_session, production_service, current_user, process, raw_material, target_complement)

    with pytest.raises(ProductionDomainError, match="supera lo que en realidad se entrego"):
        production_service.add_admin_acta_line(
            order.id,
            AdminActaLineCreate(side="RECEPCION", item_id=raw_material.id, quantity=Decimal("101"), stage_attempt_id=attempt.id),
            current_user,
        )

    production_service.add_admin_acta_line(
        order.id,
        AdminActaLineCreate(side="RECEPCION", item_id=raw_material.id, quantity=Decimal("60"), stage_attempt_id=attempt.id),
        current_user,
    )
    db_session.refresh(raw_material)
    assert raw_material.current_stock == Decimal("960")  # 1000 - 100 entregado + 60 recibido

    # Ya recibio 60 de 100 -- solo quedan 40 disponibles para recibir.
    with pytest.raises(ProductionDomainError, match="supera lo que en realidad se entrego"):
        production_service.add_admin_acta_line(
            order.id,
            AdminActaLineCreate(side="RECEPCION", item_id=raw_material.id, quantity=Decimal("41"), stage_attempt_id=attempt.id),
            current_user,
        )

    production_service.add_admin_acta_line(
        order.id,
        AdminActaLineCreate(side="RECEPCION", item_id=raw_material.id, quantity=Decimal("40"), stage_attempt_id=attempt.id),
        current_user,
    )
    db_session.refresh(raw_material)
    assert raw_material.current_stock == Decimal("1000")  # todo devuelto


def test_add_admin_acta_line_recepcion_without_stage_attempt_id_skips_check(
    db_session, production_service, current_user, process, raw_material, target_complement
):
    """La restriccion solo aplica a lineas de RECEPCION ligadas a una etapa
    (stage_attempt_id) -- las de nivel de orden (ActaView, admin-only) no
    tienen ese concepto y siguen sin tope."""
    order, attempt = _start_with_entrega(db_session, production_service, current_user, process, raw_material, target_complement)

    result = production_service.add_admin_acta_line(
        order.id,
        AdminActaLineCreate(side="RECEPCION", item_id=raw_material.id, quantity=Decimal("500")),
        current_user,
    )

    lines = [l for l in result.acta_lines if l.item_id == raw_material.id and l.side == "RECEPCION" and l.stage_attempt_id is None]
    assert len(lines) == 1
    assert lines[0].quantity == Decimal("500")
