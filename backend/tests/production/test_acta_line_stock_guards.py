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


# ---------------------------------------------------------------------------
# Fix A (review final, ronda 2): update_acta_line/delete_acta_line no
# miraban el estado de la orden ni del intento de etapa antes de mover stock
# real -- alcanzable desde "Ver reporte de etapas" -> abrir un intento pasado,
# cuyo modal de acta pasa onEditLine sin chequear nada. Dos escenarios reales:
#
# 1. Orden ya CANCELADA: cancel_run ya reverto a cero (via
#    _revert_admin_stock_lines) todo lo que las lineas con item_id movieron,
#    asi que el neto vuelve a leerse como 0 -- editar la cantidad ahi emite un
#    consumo/devolucion FRESCO y real sobre una orden muerta.
# 2. Intento de etapa ya APROBADA: approve_stage_attempt ya calculo la merma
#    de ESE intento y, si hubo perdida, ya creo el item de merma -- editar una
#    linea del intento despues desincroniza esos totales sin recalcular nada.
# ---------------------------------------------------------------------------


def test_update_acta_line_rejects_on_cancelled_order(
    db_session, production_service, current_user, admin_user, process
):
    supply = _supply(db_session, "Insumo orden cancelada")
    run, line = _order_level_line_with_item(
        db_session, production_service, current_user, ActaLineSource.PLAN, supply
    )

    cancelled = production_service.cancel_run(run.id, current_user, "motivo")
    assert cancelled.status == "CANCELADA"

    with pytest.raises(ProductionDomainError, match="cancelada"):
        production_service.update_acta_line(line.id, ActaLineUpdate(quantity=Decimal("8")), admin_user)

    db_session.refresh(supply)
    assert supply.current_stock == Decimal("50")  # nada se movio de mas


def test_delete_acta_line_rejects_on_cancelled_order(
    db_session, production_service, current_user, admin_user, process
):
    """delete_acta_line solo borra MANUAL/ADMIN_STOCK (una PLAN se rechaza
    antes, por un motivo distinto -- "Solo se pueden borrar lineas agregadas a
    mano"), asi que esta linea tiene que ser MANUAL para probar de verdad la
    guarda nueva de estado."""
    supply = _supply(db_session, "Insumo borrar orden cancelada")
    run, line = _order_level_line_with_item(
        db_session, production_service, current_user, ActaLineSource.MANUAL, supply
    )

    cancelled = production_service.cancel_run(run.id, current_user, "motivo")
    assert cancelled.status == "CANCELADA"

    with pytest.raises(ProductionDomainError, match="cancelada"):
        production_service.delete_acta_line(line.id, admin_user)

    db_session.refresh(supply)
    assert supply.current_stock == Decimal("50")
    assert production_service.repository.get_acta_line(line.id) is not None  # no se borro


def _started_attempt(db_session, production_service, current_user, process, raw_material, target_complement):
    from backend.modules.production.schemas import StageAttemptCreate, StageAttemptMaterialLine, StageAttemptProductLine

    raw_material.current_stock = Decimal("100")
    db_session.flush()
    order = production_service.create_order(ProductionOrderCreate(name="Orden etapa aprobada"), current_user)
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
    attempt_id = result.stage_attempts[0].id
    entrega_line = next(l for l in result.stage_attempts[0].acta_lines if l.side == "ENTREGA")
    recepcion_line = next(l for l in result.stage_attempts[0].acta_lines if l.side == "RECEPCION")
    return order.id, attempt_id, entrega_line, recepcion_line


def test_update_acta_line_allows_editing_on_approved_stage_attempt(
    db_session, production_service, current_user, process, raw_material, target_complement
):
    """Rodrigo, 2026-08-20: corregir una etapa YA aprobada es un caso real --
    solo se bloquea sobre una orden cancelada/recibida (esa si ya reverti
    todo a cero, editar ahi emitiria un movimiento fantasma)."""
    _run_id, attempt_id, entrega_line, _recepcion_line = _started_attempt(
        db_session, production_service, current_user, process, raw_material, target_complement
    )
    db_session.refresh(raw_material)
    assert raw_material.current_stock == Decimal("50")  # 100 - 50 entregado

    production_service.approve_stage_attempt(attempt_id, current_user)

    production_service.update_acta_line(entrega_line.id, ActaLineUpdate(quantity=Decimal("70")), current_user)

    db_session.refresh(raw_material)
    assert raw_material.current_stock == Decimal("30")  # 100 - 70, se movio el delta


def test_delete_acta_line_allows_deleting_on_approved_stage_attempt(
    db_session, production_service, current_user, process, raw_material, target_complement
):
    """delete_acta_line solo borra MANUAL/ADMIN_STOCK -- la linea PLAN que crea
    start_stage_attempt no serviria para probar esta guarda (se rechaza antes,
    por "Solo se pueden borrar lineas agregadas a mano"). Se agrega una
    ADMIN_STOCK enlazada al mismo intento y se aprueba el intento: borrarla
    debe seguir funcionando y revertir el stock."""
    from backend.modules.production.schemas import AdminActaLineCreate

    run_id, attempt_id, _entrega_line, _recepcion_line = _started_attempt(
        db_session, production_service, current_user, process, raw_material, target_complement
    )
    supply = _supply(db_session, "Insumo etapa aprobada", stock="20")
    admin_result = production_service.add_admin_acta_line(
        run_id,
        AdminActaLineCreate(
            side="ENTREGA", item_id=supply.id, quantity=Decimal("3"),
            stage_attempt_id=attempt_id, note="ajuste de prueba",
        ),
        current_user,
    )
    admin_line = next(l for l in admin_result.acta_lines if l.item_id == supply.id)
    db_session.refresh(supply)
    assert supply.current_stock == Decimal("17")  # 20 - 3, movio stock al agregarla

    production_service.approve_stage_attempt(attempt_id, current_user)

    production_service.delete_acta_line(admin_line.id, current_user)

    db_session.refresh(supply)
    assert supply.current_stock == Decimal("20")  # revertido
    assert production_service.repository.get_acta_line(admin_line.id) is None


# ---------------------------------------------------------------------------
# Fix B (review final, ronda 2): _line_stock_lives_in_legacy_reference solo
# miraba CONSUMO_PRODUCCION/REVERSION_PRODUCCION referenciados por la orden --
# el flujo viejo tambien podia devolver sobrante con
# return_material_from_production (DEVOLUCION_PRODUCCION, misma referencia a
# nivel de orden). Una linea cuyo UNICO rastro sea esa devolucion se le
# escapaba al chequeo, dejando pasar la edicion (mismo riesgo de doble
# movimiento que el Fix 4 original evitaba para el consumo).
# ---------------------------------------------------------------------------


def test_update_acta_line_refuses_legacy_return_only_line(
    db_session, production_service, current_user, process, complement_item
):
    from backend.modules.production.models import (
        ActaLineSide,
        ProductionRun,
        ProductionRunActaLine,
        ProductionRunStageAttempt,
        ProductionRunStatus,
        StageAttemptStatus,
    )

    complement_item.current_stock = Decimal("2")
    db_session.flush()

    run = ProductionRun(
        process_id=process.id, process_name=process.name,
        status=ProductionRunStatus.IN_PROGRESS, created_by_user_id=current_user.id,
    )
    db_session.add(run)
    db_session.flush()
    run.production_code = f"OP-TEST-{uuid.uuid4().hex[:6]}"
    db_session.flush()

    # Unico movimiento run-referenciado de esta linea: una devolucion, no un
    # consumo -- exactamente el caso que el chequeo viejo dejaba pasar.
    production_service.inventory_service.return_material_from_production(
        item_id=complement_item.id, quantity=Decimal("2"), production_run_id=run.id, user_id=current_user.id,
    )
    db_session.refresh(complement_item)
    assert complement_item.current_stock == Decimal("4")

    attempt = ProductionRunStageAttempt(
        run_id=run.id, process_id=process.id, process_name=process.name,
        sequence_order=1, attempt_no_for_process=1, code="FUN-OP0001-01",
        status=StageAttemptStatus.IN_PROGRESS, unit_code="und",
    )
    run.stage_attempts.append(attempt)
    db_session.flush()

    line = ProductionRunActaLine(
        side=ActaLineSide.RECEPCION, label=complement_item.name, quantity=Decimal("2"),
        unit_code=complement_item.unit_code, item_id=complement_item.id, source=ActaLineSource.PLAN,
        line_order=0, stage_attempt_id=attempt.id, created_by_user_id=current_user.id,
    )
    run.acta_lines.append(line)
    db_session.flush()

    with pytest.raises(ProductionDomainError, match="flujo viejo"):
        production_service.update_acta_line(line.id, ActaLineUpdate(quantity=Decimal("5")), current_user)

    db_session.refresh(complement_item)
    assert complement_item.current_stock == Decimal("4")  # nada se movio de mas
    refreshed = production_service.repository.get_acta_line(line.id)
    assert refreshed.quantity == Decimal("2")  # el campo tampoco se toco
