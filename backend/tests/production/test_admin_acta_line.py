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
    from backend.modules.production.schemas import StageAttemptCreate, StageAttemptMaterialLine, StageAttemptProductLine

    raw_material.current_stock = Decimal("1000")
    db_session.flush()
    order = production_service.create_order(ProductionOrderCreate(name="Orden a cancelar con acta admin"), current_user)
    production_service.start_stage_attempt(
        order.id,
        StageAttemptCreate(
            process_id=process.id,
            responsable_name="Ana",
            materials=[StageAttemptMaterialLine(item_id=raw_material.id, quantity=Decimal("100"))],
            products=[StageAttemptProductLine(target_item_id=target_complement.id, quantity=Decimal("1"))],
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
    """Entrega materia prima (obligatoria, Task 6 fix Rodrigo 2026-08-20) y un
    insumo (SUPPLY) -- la materia prima ya no se puede devolver por RECEPCION
    (pasa a formar parte del producto), solo insumos/complementos."""
    from backend.modules.inventory.models import InventoryItem
    from backend.modules.production.schemas import AdminActaLineCreate, StageAttemptCreate, StageAttemptMaterialLine, StageAttemptProductLine

    raw_material.current_stock = Decimal("1000")
    db_session.flush()
    order = production_service.create_order(ProductionOrderCreate(name="Orden recepcion test"), current_user)
    started = production_service.start_stage_attempt(
        order.id,
        StageAttemptCreate(
            process_id=process.id,
            responsable_name="Ana",
            materials=[StageAttemptMaterialLine(item_id=raw_material.id, quantity=Decimal(entregado))],
            products=[StageAttemptProductLine(target_item_id=target_complement.id, quantity=Decimal("1"))],
        ),
        current_user,
    )
    attempt = started.stage_attempts[0]

    supply = InventoryItem(
        item_type="SUPPLY", name="Insumo test", sku=f"IN-TEST-{uuid.uuid4().hex[:8]}",
        unit_code="und", current_stock=Decimal("1000"),
    )
    db_session.add(supply)
    db_session.flush()
    production_service.add_admin_acta_line(
        order.id,
        AdminActaLineCreate(
            side="ENTREGA", item_id=supply.id, quantity=Decimal(entregado),
            stage_attempt_id=attempt.id, note="Insumo agregado en setup de test",
        ),
        current_user,
    )
    return order, attempt, supply


def test_add_admin_acta_line_recepcion_rejects_raw_material(
    db_session, production_service, current_user, process, raw_material, target_complement
):
    """La materia prima ya se convirtio en el producto resultante -- no se
    devuelve por RECEPCION, sin importar si se entrego en esta etapa."""
    order, attempt, _supply = _start_with_entrega(db_session, production_service, current_user, process, raw_material, target_complement)

    with pytest.raises(ProductionDomainError, match="no se devuelve por aca"):
        production_service.add_admin_acta_line(
            order.id,
            AdminActaLineCreate(side="RECEPCION", item_id=raw_material.id, quantity=Decimal("1"), stage_attempt_id=attempt.id),
            current_user,
        )


def test_add_admin_acta_line_recepcion_allows_extra_never_entregado(
    db_session, production_service, current_user, process, raw_material, target_complement
):
    """Devolucion 'extra': un item que nunca aparecio en ENTREGA de esta etapa
    (fuera de lo entregado) se puede recibir igual, sin tope -- Rodrigo,
    2026-08-20: produccion a veces devuelve algo que no estaba en lo
    entregado, y eso debe sumar al stock igual."""
    from backend.modules.inventory.models import InventoryItem

    order, attempt, _supply = _start_with_entrega(db_session, production_service, current_user, process, raw_material, target_complement)
    other_item = InventoryItem(
        item_type="SUPPLY", name="Otro insumo", sku=f"IN-TEST-{uuid.uuid4().hex[:8]}",
        unit_code="und", current_stock=Decimal("10"),
    )
    db_session.add(other_item)
    db_session.flush()

    result = production_service.add_admin_acta_line(
        order.id,
        AdminActaLineCreate(side="RECEPCION", item_id=other_item.id, quantity=Decimal("500"), stage_attempt_id=attempt.id),
        current_user,
    )

    db_session.refresh(other_item)
    assert other_item.current_stock == Decimal("510")  # 10 + 500 devuelto, sin tope
    lines = [l for l in result.acta_lines if l.item_id == other_item.id and l.side == "RECEPCION"]
    assert len(lines) == 1
    assert lines[0].quantity == Decimal("500")


def test_add_admin_acta_line_entrega_post_arranque_requires_note(
    db_session, production_service, current_user, process, raw_material, target_complement
):
    """Rodrigo, 2026-08-20: agregar materia prima/entrada DESPUES de que la
    etapa ya arranco exige motivo (auditoria) -- las lineas iniciales (Task 3,
    start_stage_attempt) no pasan por aca, asi que nunca lo piden."""
    order, attempt, supply = _start_with_entrega(db_session, production_service, current_user, process, raw_material, target_complement)

    with pytest.raises(ProductionDomainError, match="motivo"):
        production_service.add_admin_acta_line(
            order.id,
            AdminActaLineCreate(side="ENTREGA", item_id=supply.id, quantity=Decimal("1"), stage_attempt_id=attempt.id),
            current_user,
        )

    production_service.add_admin_acta_line(
        order.id,
        AdminActaLineCreate(side="ENTREGA", item_id=supply.id, quantity=Decimal("1"), stage_attempt_id=attempt.id, note="Se me olvido"),
        current_user,
    )


def test_add_admin_acta_line_free_text_entrega_post_arranque_requires_note(
    db_session, production_service, current_user, process, raw_material, target_complement
):
    """Bug encontrado en review de 6ebcd83: una linea libre (sin item_id ni
    product_type_id) devolvia antes de llegar al chequeo de motivo, asi que
    un admin podia agregar ENTREGA post-arranque sin auditoria con solo
    escribir label/unit_code en vez de enlazar un item real. El chequeo debe
    aplicar igual sin importar el tipo de linea."""
    order, attempt, _supply = _start_with_entrega(db_session, production_service, current_user, process, raw_material, target_complement)

    with pytest.raises(ProductionDomainError, match="motivo"):
        production_service.add_admin_acta_line(
            order.id,
            AdminActaLineCreate(
                side="ENTREGA", label="Tornillo prestado", quantity=Decimal("2"), unit_code="und",
                stage_attempt_id=attempt.id,
            ),
            current_user,
        )

    result = production_service.add_admin_acta_line(
        order.id,
        AdminActaLineCreate(
            side="ENTREGA", label="Tornillo prestado", quantity=Decimal("2"), unit_code="und",
            stage_attempt_id=attempt.id, note="Se me olvido",
        ),
        current_user,
    )
    lines = [l for l in result.acta_lines if l.source == "MANUAL" and l.label == "Tornillo prestado"]
    assert len(lines) == 1
    assert lines[0].item_id is None


def test_add_admin_acta_line_entrega_sin_stage_attempt_no_requires_note(
    db_session, production_service, current_user, process, raw_material, target_complement
):
    """A nivel de orden (ActaView/Documentos, sin stage_attempt_id) no hay
    'etapa ya arrancada' que perder de vista -- no exige motivo."""
    run = _create_run(production_service, current_user, process, raw_material, target_complement)
    supply = InventoryItem(
        item_type="SUPPLY", name="Insumo sin motivo", sku=f"IN-TEST-{uuid.uuid4().hex[:8]}",
        unit_code="und", current_stock=Decimal("10"),
    )
    db_session.add(supply)
    db_session.flush()

    production_service.add_admin_acta_line(
        run.id,
        AdminActaLineCreate(side="ENTREGA", item_id=supply.id, quantity=Decimal("5")),
        current_user,
    )


def test_add_admin_acta_line_recepcion_never_requires_note(
    db_session, production_service, current_user, process, raw_material, target_complement
):
    order, attempt, supply = _start_with_entrega(db_session, production_service, current_user, process, raw_material, target_complement)

    production_service.add_admin_acta_line(
        order.id,
        AdminActaLineCreate(side="RECEPCION", item_id=supply.id, quantity=Decimal("1"), stage_attempt_id=attempt.id),
        current_user,
    )


def test_add_admin_acta_line_recepcion_without_stage_attempt_id_skips_check(
    db_session, production_service, current_user, process, raw_material, target_complement
):
    """El tope de cantidad (ya eliminado del todo, Rodrigo 2026-08-20) nunca
    aplico a lineas de nivel de orden (ActaView, admin-only, sin
    stage_attempt_id) -- siguen sin tope. La prohibicion de devolver materia
    prima si es universal (no depende de stage_attempt_id): ver
    test_add_admin_acta_line_recepcion_rejects_raw_material_without_stage_attempt_id."""
    order, attempt, _supply = _start_with_entrega(db_session, production_service, current_user, process, raw_material, target_complement)

    result = production_service.add_admin_acta_line(
        order.id,
        AdminActaLineCreate(side="RECEPCION", item_id=target_complement.id, quantity=Decimal("500")),
        current_user,
    )

    lines = [l for l in result.acta_lines if l.item_id == target_complement.id and l.side == "RECEPCION" and l.stage_attempt_id is None]
    assert len(lines) == 1
    assert lines[0].quantity == Decimal("500")


def test_add_admin_acta_line_recepcion_rejects_raw_material_without_stage_attempt_id(
    db_session, production_service, current_user, process, raw_material, target_complement
):
    """La prohibicion de devolver materia prima por RECEPCION es universal:
    tambien aplica a lineas de nivel de orden, sin stage_attempt_id."""
    order, attempt, _supply = _start_with_entrega(db_session, production_service, current_user, process, raw_material, target_complement)

    with pytest.raises(ProductionDomainError, match="no se devuelve por aca"):
        production_service.add_admin_acta_line(
            order.id,
            AdminActaLineCreate(side="RECEPCION", item_id=raw_material.id, quantity=Decimal("500")),
            current_user,
        )


def test_add_admin_acta_line_recepcion_creates_finished_item_from_product_type(
    db_session, production_service, current_user, process, raw_material, target_complement
):
    """Un Tipo de producto de Mantenimiento (sin material, sin item de
    inventario todavia) se puede agregar por RECEPCION eligiendo material y
    unidad -- crea la pieza de catalogo en el momento y le suma la cantidad
    (Rodrigo, 2026-08-20: 'necesito que me salgan productos terminados que
    haya creado aunque no haya stock y poder seleccionarlo')."""
    from sqlalchemy import select

    from backend.modules.catalog.models import CatalogSegment
    from backend.modules.product_types.models import ProductType

    order, attempt, _supply = _start_with_entrega(db_session, production_service, current_user, process, raw_material, target_complement)

    material = CatalogSegment(kind="MATERIAL", code="9", label="Oro test material")
    db_session.add(material)
    product_type = ProductType(category_code="88", model_code="8801", name="Anillo nuevo test")
    db_session.add(product_type)
    db_session.flush()

    result = production_service.add_admin_acta_line(
        order.id,
        AdminActaLineCreate(
            side="RECEPCION",
            product_type_id=product_type.id,
            material_code="9",
            quantity=Decimal("3"),
            unit_code="und",
            stage_attempt_id=attempt.id,
        ),
        current_user,
    )

    from backend.modules.inventory.models import InventoryItem

    created = db_session.execute(
        select(InventoryItem).where(InventoryItem.product_code == "9888801")
    ).scalar_one()
    assert created.current_stock == Decimal("3")
    assert created.material_type == "Oro test material"
    assert created.name == "Anillo nuevo test"
    lines = [l for l in result.acta_lines if l.item_id == created.id and l.side == "RECEPCION"]
    assert len(lines) == 1
    assert lines[0].quantity == Decimal("3")

    # Reusa la misma fila (no duplica) si se agrega de nuevo.
    production_service.add_admin_acta_line(
        order.id,
        AdminActaLineCreate(
            side="RECEPCION",
            product_type_id=product_type.id,
            material_code="9",
            quantity=Decimal("2"),
            unit_code="und",
            stage_attempt_id=attempt.id,
        ),
        current_user,
    )
    db_session.refresh(created)
    assert created.current_stock == Decimal("5")
    all_created = db_session.execute(
        select(InventoryItem).where(InventoryItem.product_code == "9888801")
    ).scalars().all()
    assert len(all_created) == 1


def test_add_admin_acta_line_entrega_rejects_product_type_id(
    db_session, production_service, current_user, process, raw_material, target_complement
):
    """No se puede 'entregar' una pieza que todavia no existe en stock."""
    from backend.modules.catalog.models import CatalogSegment
    from backend.modules.product_types.models import ProductType

    order, attempt, _supply = _start_with_entrega(db_session, production_service, current_user, process, raw_material, target_complement)

    material = CatalogSegment(kind="MATERIAL", code="9", label="Oro test material")
    db_session.add(material)
    product_type = ProductType(category_code="88", model_code="8802", name="Otro test")
    db_session.add(product_type)
    db_session.flush()

    with pytest.raises(ProductionDomainError, match="solo se puede agregar por el lado RECIBIDO"):
        production_service.add_admin_acta_line(
            order.id,
            AdminActaLineCreate(
                side="ENTREGA",
                product_type_id=product_type.id,
                material_code="9",
                quantity=Decimal("1"),
                unit_code="und",
                stage_attempt_id=attempt.id,
                # Nota presente para que el chequeo de motivo (que ahora corre
                # antes que cualquier validacion de branch, ver fix del review
                # de 6ebcd83) no tape el error que este test en realidad
                # quiere probar.
                note="Se me olvido",
            ),
            current_user,
        )


def test_update_acta_line_plan_line_moves_stock(
    db_session, production_service, current_user, process, raw_material, target_complement
):
    """Una linea PLAN (Entrada/Producto de start_stage_attempt) se edita
    igual que una ADMIN_STOCK -- el stock se ajusta al delta (design doc
    2026-08-20, addendum de unificacion, punto 1)."""
    from backend.modules.production.schemas import StageAttemptCreate, StageAttemptMaterialLine, StageAttemptProductLine

    raw_material.current_stock = Decimal("100")
    db_session.flush()
    order = production_service.create_order(ProductionOrderCreate(name="Orden edit plan test"), current_user)
    result = production_service.start_stage_attempt(
        order.id,
        StageAttemptCreate(
            process_id=process.id,
            responsable_name="Ana",
            materials=[StageAttemptMaterialLine(item_id=raw_material.id, quantity=Decimal("50"))],
            products=[StageAttemptProductLine(target_item_id=target_complement.id, quantity=Decimal("1"))],
        ),
        current_user,
    )
    attempt = result.stage_attempts[0]
    entrega_line = next(l for l in attempt.acta_lines if l.side == "ENTREGA")

    production_service.update_acta_line(entrega_line.id, ActaLineUpdate(quantity=Decimal("70")), current_user)

    db_session.refresh(raw_material)
    assert raw_material.current_stock == Decimal("30")  # 100 - 70


def test_add_admin_acta_line_entrega_blocks_when_quantity_exceeds_stock(
    db_session, production_service, current_user, process, raw_material, target_complement
):
    """Rodrigo, 2026-08-20: 'solo puedo ingresar maximo la cantidad que hay
    en inventario, para la parte izquierda del acta' -- ENTREGA nunca puede
    dejar el stock negativo, sin importar reservas."""
    run = _create_run(production_service, current_user, process, raw_material, target_complement)
    supply = InventoryItem(
        item_type="SUPPLY", name="Insumo topado", sku=f"IN-TEST-{uuid.uuid4().hex[:8]}",
        unit_code="und", current_stock=Decimal("10"),
    )
    db_session.add(supply)
    db_session.flush()

    with pytest.raises(ProductionDomainError, match="no hay suficiente stock"):
        production_service.add_admin_acta_line(
            run.id,
            AdminActaLineCreate(side="ENTREGA", item_id=supply.id, quantity=Decimal("11")),
            current_user,
        )

    production_service.add_admin_acta_line(
        run.id,
        AdminActaLineCreate(side="ENTREGA", item_id=supply.id, quantity=Decimal("10")),
        current_user,
    )
    db_session.refresh(supply)
    assert supply.current_stock == Decimal("0")
