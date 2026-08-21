"""Review final del sub-proyecto "acta v2 sin splits" (Fixes 2/3/4).

La unificacion del addendum (punto 1) hizo que CUALQUIER linea de acta con
item_id mueva stock real al editarse -- pero el gate admin, la reversion al
borrar y el calculo por delta seguian escritos pensando solo en las lineas
ADMIN_STOCK del boton "+":

- Fix 2: el gate admin-only de update_acta_line solo miraba
  `source == ADMIN_STOCK`, asi que una linea PLAN/MANUAL de nivel de orden con
  item_id dejaba mover inventario real a cualquiera con production.runs.update.
- Fix 3: delete_acta_line solo revertia stock para ADMIN_STOCK -- una linea
  MANUAL con item_id que ya habia movido stock (via update_acta_line) se
  borraba dejando el stock inflado.
- Fix 4: _apply_admin_acta_line_delta calcula el neto ya movido desde los
  movimientos referenciados por production_run_acta_line + line.id. En una
  orden del flujo VIEJO ese movimiento existe pero esta referenciado por
  production_run + run.id, asi que el neto da 0 y editar la linea emitiria un
  consumo FRESCO encima del original: doble consumo de oro real.

Ver docs/superpowers/specs/2026-08-20-acta-v2-sin-splits-design.md.
"""
import uuid
from decimal import Decimal

import pytest

# Import necesario aunque no se use directamente: registra la tabla
# product_types en el metadata de SQLAlchemy antes del flush (ProductionRun
# tiene un FK a product_types.id).
from backend.modules.product_types.models import ProductType  # noqa: F401
from backend.modules.inventory.models import InventoryItem
from backend.modules.production.models import ActaLineSource
from backend.modules.production.schemas import (
    ActaLineCreate,
    ActaLineUpdate,
    ProductionOrderCreate,
    StageAttemptCreate,
    StageAttemptMaterialLine,
    StageAttemptProductLine,
)
from backend.modules.production.service import ProductionDomainError


def _order_level_line_with_item(db_session, production_service, current_user, source, item, side="ENTREGA"):
    """Crea a mano una linea de acta a NIVEL DE ORDEN (stage_attempt_id nulo)
    enlazada a un item real, con el source pedido -- la forma que tienen las
    lineas PLAN de las ordenes viejas y las MANUAL de add_acta_line."""
    from backend.modules.production.models import ProductionRunActaLine

    order = production_service.create_order(
        ProductionOrderCreate(name=f"Orden nivel orden {uuid.uuid4().hex[:6]}"), current_user
    )
    run = production_service.repository.get_run(order.id)
    line = ProductionRunActaLine(
        side=side,
        label=item.name,
        quantity=Decimal("10"),
        unit_code=item.unit_code,
        item_id=item.id,
        source=source,
        line_order=0,
        created_by_user_id=current_user.id,
    )
    run.acta_lines.append(line)
    db_session.flush()
    return run, line


def _supply(db_session, name, stock="50", unit="und"):
    item = InventoryItem(
        item_type="SUPPLY", name=name, sku=f"IN-TEST-{uuid.uuid4().hex[:8]}",
        unit_code=unit, current_stock=Decimal(stock),
    )
    db_session.add(item)
    db_session.flush()
    return item


def test_update_order_level_plan_line_with_item_rejects_non_admin(
    db_session, production_service, current_user, process
):
    """Fix 2: una linea PLAN a nivel de orden con item_id mueve stock real al
    editarla (addendum, punto 1) -- el gate admin tiene que cubrirla igual que
    a una ADMIN_STOCK."""
    supply = _supply(db_session, "Insumo nivel orden")
    _run, line = _order_level_line_with_item(
        db_session, production_service, current_user, ActaLineSource.PLAN, supply
    )

    with pytest.raises(ProductionDomainError, match="Solo el administrador"):
        production_service.update_acta_line(line.id, ActaLineUpdate(quantity=Decimal("8")), current_user)

    db_session.refresh(supply)
    assert supply.current_stock == Decimal("50")  # el chequeo corta antes de mover stock


def test_update_order_level_manual_line_with_item_rejects_non_admin(
    db_session, production_service, current_user, process
):
    """Fix 2, misma regla para MANUAL con item_id: add_acta_line no mueve
    stock al crear, pero editarle la cantidad si."""
    supply = _supply(db_session, "Insumo manual nivel orden")
    _run, line = _order_level_line_with_item(
        db_session, production_service, current_user, ActaLineSource.MANUAL, supply
    )

    with pytest.raises(ProductionDomainError, match="Solo el administrador"):
        production_service.update_acta_line(line.id, ActaLineUpdate(quantity=Decimal("8")), current_user)

    db_session.refresh(supply)
    assert supply.current_stock == Decimal("50")


def test_admin_can_update_order_level_plan_line_with_item(
    db_session, production_service, current_user, admin_user, process
):
    """La otra cara del Fix 2: el admin si puede, y el stock se mueve por el
    delta contra el neto ya movido (aca 0 -- la linea nunca movio nada)."""
    supply = _supply(db_session, "Insumo admin nivel orden")
    _run, line = _order_level_line_with_item(
        db_session, production_service, current_user, ActaLineSource.PLAN, supply
    )

    production_service.update_acta_line(line.id, ActaLineUpdate(quantity=Decimal("8")), admin_user)

    db_session.refresh(supply)
    assert supply.current_stock == Decimal("42")  # 50 - 8 (ENTREGA)


def test_update_stage_attempt_line_still_allowed_for_merged_role(
    db_session, production_service, current_user, process, raw_material, target_complement
):
    """No regresion del Fix 2: la excepcion "cualquiera del rol fusionado
    opera el acta de la etapa" sigue viva -- una linea CON stage_attempt_id la
    edita current_user (Produccion/Inventario, no admin)."""
    raw_material.current_stock = Decimal("100")
    db_session.flush()
    order = production_service.create_order(ProductionOrderCreate(name="Orden etapa rol fusionado"), current_user)
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
    entrega_line = next(l for l in result.stage_attempts[0].acta_lines if l.side == "ENTREGA")

    production_service.update_acta_line(entrega_line.id, ActaLineUpdate(quantity=Decimal("70")), current_user)

    db_session.refresh(raw_material)
    assert raw_material.current_stock == Decimal("30")


def test_delete_manual_line_with_item_reverts_the_stock_it_moved(
    db_session, production_service, admin_user, current_user, process
):
    """Fix 3: la secuencia que antes creaba stock de la nada -- crear linea
    MANUAL RECEPCION con item_id (add_acta_line NO mueve stock), editarle la
    cantidad (ahora SI mueve stock) y borrarla (MANUAL es borrable, pero
    delete_acta_line solo revertia ADMIN_STOCK). Neto esperado: cero."""
    order = production_service.create_order(ProductionOrderCreate(name="Orden borrar manual"), current_user)
    run = production_service.repository.get_run(order.id)
    complement = InventoryItem(
        item_type="COMPLEMENT", name="Broche conjurado", sku=f"CO-TEST-{uuid.uuid4().hex[:8]}",
        unit_code="und", current_stock=Decimal("4"),
    )
    db_session.add(complement)
    db_session.flush()

    run_read = production_service.add_acta_line(
        run.id,
        ActaLineCreate(
            side="RECEPCION", label=complement.name, quantity=Decimal("2"),
            unit_code="und", item_id=complement.id,
        ),
        current_user,
    )
    line_id = [l for l in run_read.acta_lines if l.item_id == complement.id][0].id
    db_session.refresh(complement)
    assert complement.current_stock == Decimal("4")  # add_acta_line no mueve stock

    production_service.update_acta_line(line_id, ActaLineUpdate(quantity=Decimal("9")), admin_user)
    db_session.refresh(complement)
    assert complement.current_stock == Decimal("13")  # 4 + 9, ahora si movio stock real

    production_service.delete_acta_line(line_id, admin_user)

    db_session.refresh(complement)
    assert complement.current_stock == Decimal("4")  # revertido, no queda stock conjurado


def _old_flow_run_with_run_scoped_consumption(db_session, production_service, current_user, process, raw_material):
    """Reconstruye una orden del flujo VIEJO: el consumo de materia prima lo
    emitio consume_material_for_production (reference_type="production_run" +
    run.id), no la linea de acta -- exactamente como quedaron las filas
    historicas reales en la base (mismo patron que el test lot-backed de
    test_revert_stage_attempt.py)."""
    from backend.modules.production.models import (
        ActaLineSide,
        ProductionRun,
        ProductionRunActaLine,
        ProductionRunStageAttempt,
        ProductionRunStatus,
        StageAttemptStatus,
    )

    raw_material.current_stock = Decimal("100")
    db_session.flush()

    run = ProductionRun(
        process_id=process.id,
        process_name=process.name,
        status=ProductionRunStatus.IN_PROGRESS,
        raw_material_item_id=raw_material.id,
        raw_material_unit_code=raw_material.unit_code,
        created_by_user_id=current_user.id,
    )
    db_session.add(run)
    db_session.flush()
    run.production_code = f"OP-TEST-{uuid.uuid4().hex[:6]}"
    db_session.flush()

    production_service.inventory_service.consume_material_for_production(
        item_id=raw_material.id, quantity=Decimal("100"), production_run_id=run.id, user_id=current_user.id,
    )
    db_session.refresh(raw_material)
    assert raw_material.current_stock == Decimal("0")

    attempt = ProductionRunStageAttempt(
        run_id=run.id, process_id=process.id, process_name=process.name,
        sequence_order=1, attempt_no_for_process=1, code="FUN-OP0001-01",
        status=StageAttemptStatus.IN_PROGRESS, unit_code="g",
    )
    run.stage_attempts.append(attempt)
    db_session.flush()

    line = ProductionRunActaLine(
        side=ActaLineSide.ENTREGA, label=raw_material.name, quantity=Decimal("100"),
        unit_code="g", item_id=raw_material.id, source=ActaLineSource.PLAN,
        line_order=0, stage_attempt_id=attempt.id, created_by_user_id=current_user.id,
    )
    run.acta_lines.append(line)
    db_session.flush()
    return run, line


def test_update_acta_line_refuses_legacy_run_scoped_line(
    db_session, production_service, current_user, process, raw_material
):
    """Fix 4: la linea PLAN de una orden del flujo VIEJO dice 100 g y esos
    100 g se consumieron de verdad, pero bajo la referencia de la ORDEN. Para
    _apply_admin_acta_line_delta esa linea "nunca movio nada" (net_so_far=0),
    asi que editarle la cantidad emitiria un consumo FRESCO encima del
    original (doble consumo de oro real). Debe rechazarse con un mensaje
    honesto, sin crear ningun movimiento nuevo."""
    from sqlalchemy import select

    from backend.modules.inventory.models import InventoryMovement

    _run, line = _old_flow_run_with_run_scoped_consumption(
        db_session, production_service, current_user, process, raw_material
    )
    movements_before = db_session.execute(
        select(InventoryMovement.id).where(InventoryMovement.item_id == raw_material.id)
    ).all()

    with pytest.raises(ProductionDomainError, match="flujo viejo"):
        production_service.update_acta_line(line.id, ActaLineUpdate(quantity=Decimal("120")), current_user)

    db_session.refresh(raw_material)
    assert raw_material.current_stock == Decimal("0")  # sin segundo consumo
    movements_after = db_session.execute(
        select(InventoryMovement.id).where(InventoryMovement.item_id == raw_material.id)
    ).all()
    assert len(movements_after) == len(movements_before)
    refreshed = production_service.repository.get_acta_line(line.id)
    assert refreshed.quantity == Decimal("100")  # el campo tampoco se toco


def test_update_acta_line_allows_new_flow_line_of_the_same_item(
    db_session, production_service, current_user, process, raw_material, target_complement
):
    """La guarda del Fix 4 es por LINEA, no por item: una orden del flujo
    nuevo que consume el mismo item (sin movimientos a nombre de la orden)
    sigue siendo editable con normalidad."""
    raw_material.current_stock = Decimal("100")
    db_session.flush()
    order = production_service.create_order(ProductionOrderCreate(name="Orden flujo nuevo mismo item"), current_user)
    result = production_service.start_stage_attempt(
        order.id,
        StageAttemptCreate(
            process_id=process.id,
            responsable_name="Ana",
            materials=[StageAttemptMaterialLine(item_id=raw_material.id, quantity=Decimal("60"))],
            products=[StageAttemptProductLine(target_item_id=target_complement.id, quantity=Decimal("1"))],
        ),
        current_user,
    )
    entrega_line = next(l for l in result.stage_attempts[0].acta_lines if l.side == "ENTREGA")

    production_service.update_acta_line(entrega_line.id, ActaLineUpdate(quantity=Decimal("80")), current_user)

    db_session.refresh(raw_material)
    assert raw_material.current_stock == Decimal("20")  # 100 - 80, un solo consumo neto
