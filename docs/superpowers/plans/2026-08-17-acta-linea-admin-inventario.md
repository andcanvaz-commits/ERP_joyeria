# Línea de acta agregada por admin, enlazada a inventario real — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Un botón "+ Agregar línea", visible solo para el rol admin, en la acta de producción (Ver Acta y Documentos, incluida familias con split) que permite elegir un ítem real de inventario (mueve stock de inmediato, sin aprobación) o escribir algo a mano con una unidad elegida de una lista (no mueve stock).

**Architecture:** Backend: nuevo endpoint admin-only `POST /runs/{run_id}/acta-lines/admin` que crea una `ProductionRunActaLine` — con `item_id` real usa un helper de "delta" que aplica solo la diferencia de stock contra `InventoryMovement`s ya rastreados por `reference_type="production_run_acta_line"` (reutilizado también al editar cantidad y al borrar, para nunca editar un movimiento existente). Frontend: un componente controlado (`AdminAddActaLineControl`) reutilizable desde Ver Acta y Documentos, montado en los slots `actions`/`footer` que `ActaSide` ya expone.

**Tech Stack:** FastAPI + SQLAlchemy 2.0 (backend), Next.js/React + TanStack Query (frontend). Sin dependencias nuevas.

## Global Constraints

- Español-first: labels, mensajes de error y textos de UI en español (ver CLAUDE.md).
- Ningún cambio de stock fuera de `InventoryService.create_movement` — nunca editar un `InventoryMovement` existente, solo agregar el delta.
- Sin migración de Alembic: no se agrega ninguna columna, solo un nuevo valor de string dentro de columnas `String` ya existentes.
- Permiso nuevo va en `ADMIN_ONLY_PRODUCTION_PERMISSIONS` (`backend/modules/production/router.py`), mismo patrón que `production.runs.delete`.
- Backend tocado → `docker-compose exec api pytest`. Frontend tocado → `docker-compose exec web npm run build`.

---

### Task 1: Schema `AdminActaLineCreate`

**Files:**
- Modify: `backend/modules/production/schemas.py`

**Interfaces:**
- Produces: `AdminActaLineCreate(side: Literal["ENTREGA","RECEPCION"], item_id: UUID | None, label: str | None, quantity: Decimal, unit_code: str | None, note: str | None)` — usado por Task 2.

- [ ] **Step 1: Agregar el schema**

Ubicar la clase `ActaLineUpdate` en `backend/modules/production/schemas.py` (ya vista en el archivo, justo después de `ActaLineCreate`) y agregar inmediatamente después de `ActaLineUpdate`:

```python
class AdminActaLineCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    side: Literal["ENTREGA", "RECEPCION"]
    # Si viene, la linea se enlaza a este item real y mueve inventario. Si es
    # None, es una linea libre (label/unit_code obligatorios, ver service).
    item_id: UUID | None = None
    label: str | None = Field(default=None, min_length=1, max_length=180)
    quantity: Decimal = Field(gt=0)
    unit_code: str | None = Field(default=None, min_length=1, max_length=20)
    note: str | None = Field(default=None, max_length=500)
```

- [ ] **Step 2: Verificar que importa sin errores de sintaxis**

Run: `docker-compose exec api python -m compileall backend/modules/production/schemas.py`
Expected: `Compiling 'backend/modules/production/schemas.py'...` sin errores.

- [ ] **Step 3: Commit**

```bash
git add backend/modules/production/schemas.py
git commit -m "feat(production): agrega schema AdminActaLineCreate"
```

---

### Task 2: Service — crear línea admin (`add_admin_acta_line` + helper de delta)

**Files:**
- Modify: `backend/modules/production/models.py`
- Modify: `backend/modules/production/service.py`
- Test: `backend/tests/production/test_admin_acta_line.py`

**Interfaces:**
- Consumes: `AdminActaLineCreate` (Task 1), `ProductionRunActaLine`, `ActaLineSource`, `ActaLineSide` (`models.py`), `InventoryMovementCreate` (`inventory/schemas.py`), `InventoryDomainError` (`inventory/service.py`) — todos ya importados en `service.py`.
- Produces: `ProductionService.add_admin_acta_line(run_id: UUID, payload: AdminActaLineCreate, current_user: CurrentUser) -> ProductionRunRead` y `ProductionService._apply_admin_acta_line_delta(line: ProductionRunActaLine, new_quantity: Decimal, current_user: CurrentUser) -> None` — ambos usados por Task 3 y Task 4.

- [ ] **Step 1: Agregar el valor `ADMIN_STOCK` al enum de string**

En `backend/modules/production/models.py`, la clase `ActaLineSource` (línea 137) queda:

```python
class ActaLineSource:
    # Sembrada automaticamente al crear la orden, con los valores planeados.
    PLAN = "PLAN"
    # Agregada automaticamente por un evento del sistema (material adicional
    # aprobado, etapa finalizada con merma, recepcion real).
    AUTO = "AUTO"
    # Agregada a mano por un usuario editando el acta.
    MANUAL = "MANUAL"
    # Agregada por el admin desde el boton "+" de la acta, enlazada a un
    # InventoryItem real -- a diferencia de MANUAL, esta SI genero un
    # InventoryMovement real (ver _apply_admin_acta_line_delta en service.py).
    ADMIN_STOCK = "ADMIN_STOCK"
```

- [ ] **Step 2: Escribir el test que falla (creación libre y creación enlazada)**

Crear `backend/tests/production/test_admin_acta_line.py`:

```python
"""Boton de admin en la acta: agregar una linea libre (nunca mueve stock) o
enlazada a un item real de inventario (mueve stock de inmediato, sin
aprobacion). Ver docs/superpowers/specs/2026-08-17-acta-linea-admin-inventario-design.md."""
import uuid
from decimal import Decimal

import pytest

from backend.modules.inventory.models import InventoryItem
from backend.modules.production.models import ActaLineSource
from backend.modules.production.schemas import AdminActaLineCreate, ProductionRunCreate, RunProductCreate
from backend.modules.production.service import ProductionDomainError, ProductionNotFoundError


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
```

- [ ] **Step 3: Correr los tests, confirmar que fallan por `add_admin_acta_line` inexistente**

Run: `docker-compose exec api pytest backend/tests/production/test_admin_acta_line.py -v`
Expected: `AttributeError: 'ProductionService' object has no attribute 'add_admin_acta_line'` (o similar) en todos los tests.

- [ ] **Step 4: Implementar `_apply_admin_acta_line_delta` y `add_admin_acta_line`**

En `backend/modules/production/service.py`, agregar estos dos métodos dentro de `ProductionService`, justo antes de `add_acta_line` (línea 1894 en el archivo actual):

```python
    def _apply_admin_acta_line_delta(
        self, line: ProductionRunActaLine, new_quantity: Decimal, current_user: CurrentUser
    ) -> None:
        """Aplica solo la diferencia entre lo que ya se movio para esta linea
        y `new_quantity` -- nunca edita un movimiento existente (todo cambio
        de stock nace de un InventoryMovement nuevo). Se usa al crear la
        linea (new_quantity = cantidad completa, nada movido todavia), al
        editar su cantidad, y al borrarla (new_quantity = 0, revierte el
        neto). No hace nada si la linea no tiene item_id (linea libre)."""
        if line.item_id is None:
            return
        increase_type = "CONSUMO_PRODUCCION" if line.side == ActaLineSide.ENTREGA else "DEVOLUCION_PRODUCCION"
        decrease_type = "DEVOLUCION_PRODUCCION" if line.side == ActaLineSide.ENTREGA else "CONSUMO_PRODUCCION"

        from sqlalchemy import select
        from backend.modules.inventory.models import InventoryMovement

        moved = self.repository.session.execute(
            select(InventoryMovement.movement_type, InventoryMovement.quantity).where(
                InventoryMovement.reference_type == "production_run_acta_line",
                InventoryMovement.reference_id == line.id,
            )
        ).all()
        net_so_far = sum(
            (qty if mtype == increase_type else -qty for mtype, qty in moved), Decimal("0")
        )
        delta = new_quantity - net_so_far
        if delta == 0:
            return
        movement_type = increase_type if delta > 0 else decrease_type
        run = line.run
        try:
            self.inventory_service.create_movement(
                InventoryMovementCreate(
                    item_id=line.item_id,
                    movement_type=movement_type,
                    quantity=abs(delta),
                    reason=f"Ajuste manual de administrador en acta: {line.label}.",
                    reference_type="production_run_acta_line",
                    reference_id=line.id,
                ),
                user_id=current_user.id,
                lot_code=run.production_code or run.root_production_code,
            )
        except InventoryDomainError as exc:
            raise ProductionDomainError(f"'{line.label}': {exc}") from exc

    def add_admin_acta_line(
        self, run_id: UUID, payload: AdminActaLineCreate, current_user: CurrentUser
    ) -> ProductionRunRead:
        """Boton de admin en la acta: agrega una linea en cualquier momento
        del proceso, con o sin item real de inventario. Con item_id mueve
        stock real de inmediato (sin aprobacion, ver
        _apply_admin_acta_line_delta); sin item_id es una linea libre igual
        que las MANUAL de siempre (nunca mueve stock). No reusa
        _add_or_merge_acta_line a proposito: cada correccion de admin es su
        propia fila, nunca se fusiona con una linea PLAN/AUTO existente del
        mismo item (eso le heredaria un source que no se puede borrar)."""
        run = self.repository.get_run(run_id)
        if run is None:
            raise ProductionNotFoundError("Orden de produccion no encontrada.")
        if run.event_lines:
            raise ProductionDomainError(
                "Esta orden ya tiene su acta cargada desde papel; no se pueden agregar lineas nuevas por este flujo."
            )

        if payload.item_id is None:
            if not payload.label or not payload.unit_code:
                raise ProductionDomainError("Escribe el detalle y la unidad de la linea.")
            line = ProductionRunActaLine(
                side=payload.side,
                label=payload.label.strip(),
                quantity=payload.quantity,
                unit_code=payload.unit_code.strip(),
                item_id=None,
                source=ActaLineSource.MANUAL,
                line_order=sum(1 for l in run.acta_lines if l.side == payload.side),
                note=(payload.note or "").strip() or None,
                created_by_user_id=current_user.id,
            )
            run.acta_lines.append(line)
            self.repository.flush()
            return self._read_with_names(run)

        from backend.modules.inventory.models import InventoryItem

        item = self.repository.session.get(InventoryItem, payload.item_id)
        if item is None:
            raise ProductionNotFoundError("Item de inventario no encontrado.")

        line = ProductionRunActaLine(
            side=payload.side,
            label=item.name,
            quantity=Decimal("0"),
            unit_code=item.unit_code,
            item_id=item.id,
            source=ActaLineSource.ADMIN_STOCK,
            line_order=sum(1 for l in run.acta_lines if l.side == payload.side),
            note=(payload.note or "").strip() or None,
            created_by_user_id=current_user.id,
        )
        run.acta_lines.append(line)
        self.repository.flush()
        self._apply_admin_acta_line_delta(line, payload.quantity, current_user)
        line.quantity = payload.quantity
        self.repository.flush()
        return self._read_with_names(run)
```

Agregar `AdminActaLineCreate` al bloque de imports de `backend/modules/production/schemas` en la parte superior de `service.py` (el bloque que empieza `from backend.modules.production.schemas import (` en la línea 40), junto a `ActaLineUpdate`.

- [ ] **Step 5: Correr los tests, confirmar que pasan**

Run: `docker-compose exec api pytest backend/tests/production/test_admin_acta_line.py -v`
Expected: 6 tests `PASSED`.

- [ ] **Step 6: Correr toda la suite de producción e inventario (nada roto)**

Run: `docker-compose exec api pytest backend/tests/production backend/tests/inventory -v`
Expected: todos `PASSED`.

- [ ] **Step 7: Commit**

```bash
git add backend/modules/production/models.py backend/modules/production/service.py backend/tests/production/test_admin_acta_line.py
git commit -m "feat(production): admin agrega linea de acta libre o enlazada a inventario real"
```

---

### Task 3: Service — editar cantidad de una línea `ADMIN_STOCK` ajusta stock

**Files:**
- Modify: `backend/modules/production/service.py`
- Test: `backend/tests/production/test_admin_acta_line.py`

**Interfaces:**
- Consumes: `_apply_admin_acta_line_delta` (Task 2).
- Produces: `update_acta_line` ahora soporta líneas `ADMIN_STOCK` (mismo nombre/firma que ya existe, sin cambios de tipo).

- [ ] **Step 1: Agregar los tests que fallan**

Agregar a `backend/tests/production/test_admin_acta_line.py`:

```python
from backend.modules.production.schemas import ActaLineUpdate


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
    assert supply.current_stock == Decimal("47")  # 50 - 5 + 3


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
```

- [ ] **Step 2: Correr, confirmar que fallan**

Run: `docker-compose exec api pytest backend/tests/production/test_admin_acta_line.py -k update_admin_stock -v`
Expected: `test_update_admin_stock_line_quantity_up_applies_only_delta` y `..._down_returns_stock` fallan por `AssertionError` (el stock no cambia porque `update_acta_line` no mueve inventario todavía); `..._rejects_label_or_unit_edit` falla porque no se levanta ninguna excepción.

- [ ] **Step 3: Implementar la rama `ADMIN_STOCK` en `update_acta_line`**

En `backend/modules/production/service.py`, el método `update_acta_line` (línea 1914 actual) queda:

```python
    def update_acta_line(self, line_id: UUID, payload: ActaLineUpdate, current_user: CurrentUser) -> ProductionRunRead:
        """Edita una linea existente (de cualquier origen: plan, automatica o
        manual). Solo actualiza los campos que vengan en el payload."""
        line = self.repository.get_acta_line(line_id)
        if line is None:
            raise ProductionNotFoundError("Linea de acta no encontrada.")

        if line.source == ActaLineSource.ADMIN_STOCK:
            if payload.label is not None or payload.unit_code is not None:
                raise ProductionDomainError(
                    "Esta linea esta enlazada a un item de inventario: el detalle y la unidad no se editan a mano."
                )
            if payload.quantity is not None:
                self._apply_admin_acta_line_delta(line, payload.quantity, current_user)
                line.quantity = payload.quantity
            if payload.note is not None:
                line.note = payload.note.strip() or None
            self.repository.flush()
            return self._read_with_names(line.run)

        if payload.quantity is not None and line.side == ActaLineSide.RECEPCION and line.item_id is not None:
            cap = self._acta_line_max_quantity(line)
            if cap is not None and payload.quantity > cap:
                raise ProductionDomainError(
                    f"La cantidad ({format_qty(payload.quantity)} {line.unit_code}) supera lo que en realidad "
                    f"se entrego para este material ({format_qty(cap)} {line.unit_code})."
                )
        if payload.label is not None:
            line.label = payload.label.strip()
        if payload.quantity is not None:
            line.quantity = payload.quantity
        if payload.unit_code is not None:
            line.unit_code = payload.unit_code.strip()
        if payload.note is not None:
            line.note = payload.note.strip() or None
        self.repository.flush()
        return self._read_with_names(line.run)
```

- [ ] **Step 4: Correr, confirmar que pasan**

Run: `docker-compose exec api pytest backend/tests/production/test_admin_acta_line.py -v`
Expected: 9 tests `PASSED`.

- [ ] **Step 5: Suite completa**

Run: `docker-compose exec api pytest backend/tests/production backend/tests/inventory -v`
Expected: todos `PASSED` (en particular `test_acta_edit.py`, que ya cubre el camino no-`ADMIN_STOCK` de `update_acta_line`, sigue pasando).

- [ ] **Step 6: Commit**

```bash
git add backend/modules/production/service.py backend/tests/production/test_admin_acta_line.py
git commit -m "feat(production): editar cantidad de linea admin ajusta inventario por delta"
```

---

### Task 4: Service — borrar una línea `ADMIN_STOCK` revierte el stock

**Files:**
- Modify: `backend/modules/production/service.py`
- Test: `backend/tests/production/test_admin_acta_line.py`

**Interfaces:**
- Consumes: `_apply_admin_acta_line_delta` (Task 2).
- Produces: `delete_acta_line` ahora acepta `source == ADMIN_STOCK` (mismo nombre/firma existente).

- [ ] **Step 1: Agregar los tests que fallan**

Agregar a `backend/tests/production/test_admin_acta_line.py`:

```python
def test_delete_admin_stock_line_reverts_stock(
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

    updated = production_service.delete_acta_line(line_id, current_user)

    db_session.refresh(supply)
    assert supply.current_stock == Decimal("50")
    assert all(l.id != line_id for l in updated.acta_lines)


def test_delete_admin_stock_line_blocks_if_stock_insufficient_to_revert(
    db_session, production_service, current_user, process, raw_material, target_complement
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
        production_service.delete_acta_line(line_id, current_user)

    db_session.refresh(complement)
    assert complement.current_stock == Decimal("1")
    refreshed = production_service.repository.get_acta_line(line_id)
    assert refreshed is not None
```

- [ ] **Step 2: Correr, confirmar que fallan**

Run: `docker-compose exec api pytest backend/tests/production/test_admin_acta_line.py -k delete_admin_stock -v`
Expected: `test_delete_admin_stock_line_reverts_stock` falla con `ProductionDomainError: Solo se pueden borrar lineas agregadas a mano.` (guard actual solo acepta `MANUAL`); el segundo test falla porque esa misma excepción sale, pero por el motivo equivocado (no llega a intentar revertir stock) — confirmar leyendo el mensaje del error antes de seguir.

- [ ] **Step 3: Implementar**

En `backend/modules/production/service.py`, `delete_acta_line` (línea 1975 actual) queda:

```python
    def delete_acta_line(self, line_id: UUID, current_user: CurrentUser) -> ProductionRunRead:
        """Borra una linea agregada a mano (libre o enlazada a inventario).
        Las lineas planeadas o generadas automaticamente por un evento real
        no se borran -- son el rastro de lo que de verdad paso; si estan
        mal, se editan, no se esconden. Si la linea esta enlazada a
        inventario (ADMIN_STOCK), revierte el stock neto antes de borrarla."""
        line = self.repository.get_acta_line(line_id)
        if line is None:
            raise ProductionNotFoundError("Linea de acta no encontrada.")
        if line.source not in (ActaLineSource.MANUAL, ActaLineSource.ADMIN_STOCK):
            raise ProductionDomainError("Solo se pueden borrar lineas agregadas a mano.")
        if line.source == ActaLineSource.ADMIN_STOCK:
            self._apply_admin_acta_line_delta(line, Decimal("0"), current_user)
        run = line.run
        run.acta_lines.remove(line)
        self.repository.session.delete(line)
        self.repository.flush()
        return self._read_with_names(run)
```

- [ ] **Step 4: Correr, confirmar que pasan**

Run: `docker-compose exec api pytest backend/tests/production/test_admin_acta_line.py -v`
Expected: 11 tests `PASSED`.

- [ ] **Step 5: Suite completa de producción e inventario**

Run: `docker-compose exec api pytest backend/tests/production backend/tests/inventory -v`
Expected: todos `PASSED`.

- [ ] **Step 6: Commit**

```bash
git add backend/modules/production/service.py backend/tests/production/test_admin_acta_line.py
git commit -m "feat(production): borrar linea admin revierte el stock movido"
```

---

### Task 5: Router — endpoint admin-only

**Files:**
- Modify: `backend/modules/production/router.py`
- Test: `backend/tests/production/test_admin_acta_line_permission.py`

**Interfaces:**
- Consumes: `ProductionService.add_admin_acta_line` (Task 2), `AdminActaLineCreate` (Task 1).
- Produces: `POST /api/production/runs/{run_id}/acta-lines/admin` — permiso `"production.acta-lines.admin-stock"`.

- [ ] **Step 1: Escribir el test de permiso que falla**

Crear `backend/tests/production/test_admin_acta_line_permission.py`:

```python
"""Solo admin puede pegarle al boton de agregar linea de acta enlazada a
inventario (o libre) -- mismo patron que
backend/tests/maintenance/test_admin_only_permissions.py pero para el
permiso propio de produccion."""
from uuid import uuid4

import pytest
from fastapi import HTTPException

from backend.modules.auth.dependencies import CurrentUser
from backend.modules.production.router import ensure_permission

NON_ADMIN_ROLES = ["Jefe de inventario", "Jefe de producción", "unknown"]


def _user(role: str) -> CurrentUser:
    return CurrentUser(id=uuid4(), username="tester", role=role, permissions=frozenset())


@pytest.mark.parametrize("role", NON_ADMIN_ROLES)
def test_admin_stock_permission_rejects_non_admin(role):
    with pytest.raises(HTTPException) as exc_info:
        ensure_permission(_user(role), "production.acta-lines.admin-stock")
    assert exc_info.value.status_code == 403


@pytest.mark.parametrize("role", ["admin", "Admin"])
def test_admin_stock_permission_allows_admin(role):
    ensure_permission(_user(role), "production.acta-lines.admin-stock")  # no debe levantar excepcion
```

- [ ] **Step 2: Correr, confirmar que falla**

Run: `docker-compose exec api pytest backend/tests/production/test_admin_acta_line_permission.py -v`
Expected: todos fallan porque `"production.acta-lines.admin-stock"` no está en `ADMIN_ONLY_PRODUCTION_PERMISSIONS`, así que cae al atajo genérico de `ensure_permission` y no rechaza a `"Jefe de producción"` (que sí tiene permisos que empiezan con `"production."`).

- [ ] **Step 3: Agregar el permiso y el endpoint**

En `backend/modules/production/router.py`, `ADMIN_ONLY_PRODUCTION_PERMISSIONS` (línea 77) queda:

```python
ADMIN_ONLY_PRODUCTION_PERMISSIONS = {
    # Cancelar una orden y borrar una plantilla de proceso son exclusivos del
    # administrador -- ni el jefe de produccion pasa por el atajo generico de
    # abajo para estos dos permisos puntuales.
    "production.runs.delete": "Solo el administrador puede cancelar una orden de produccion.",
    "production.processes.delete": "Solo el administrador puede eliminar un proceso.",
    "production.acta-lines.admin-stock": "Solo el administrador puede agregar una linea de acta enlazada a inventario o de texto libre desde este boton.",
}
```

Agregar `AdminActaLineCreate` al import de `backend.modules.production.schemas` (línea 10-32), junto a `ActaLineUpdate`. Agregar el endpoint nuevo justo después de `add_acta_line` (línea 492-505 actual):

```python
@router.post("/runs/{run_id}/acta-lines/admin", response_model=ProductionRunRead)
def add_admin_acta_line(
    run_id: UUID,
    payload: AdminActaLineCreate,
    current_user: CurrentUser = Depends(get_current_user),
    service: ProductionService = Depends(get_production_service),
) -> ProductionRunRead:
    ensure_permission(current_user, "production.acta-lines.admin-stock")
    try:
        return service.add_admin_acta_line(run_id, payload, current_user)
    except ProductionNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except ProductionDomainError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc
```

- [ ] **Step 4: Correr, confirmar que pasan**

Run: `docker-compose exec api pytest backend/tests/production/test_admin_acta_line_permission.py -v`
Expected: 5 tests `PASSED`.

- [ ] **Step 5: Suite completa de producción**

Run: `docker-compose exec api pytest backend/tests/production -v`
Expected: todos `PASSED`.

- [ ] **Step 6: Commit**

```bash
git add backend/modules/production/router.py backend/tests/production/test_admin_acta_line_permission.py
git commit -m "feat(production): endpoint admin-only para agregar linea de acta"
```

---

### Task 6: Frontend — cliente API

**Files:**
- Modify: `frontend/lib/production-api.ts`

**Interfaces:**
- Produces: `addAdminActaLine(runId: string, payload: { side: "ENTREGA" | "RECEPCION"; item_id?: string | null; label?: string | null; quantity: string; unit_code?: string | null; note?: string | null }): Promise<ProductionRun>` — usado por Task 9.

- [ ] **Step 1: Agregar la función**

En `frontend/lib/production-api.ts`, justo después de `addActaLine` (línea 228-233 actual):

```typescript
export function addAdminActaLine(runId: string, payload: { side: "ENTREGA" | "RECEPCION"; item_id?: string | null; label?: string | null; quantity: string; unit_code?: string | null; note?: string | null }) {
  return apiRequest<ProductionRun>(`/api/production/runs/${runId}/acta-lines/admin`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}
```

- [ ] **Step 2: Verificar tipos**

Run: `docker-compose exec web npx tsc --noEmit -p tsconfig.json`
Expected: sin errores nuevos relacionados a `production-api.ts`.

- [ ] **Step 3: Commit**

```bash
git add frontend/lib/production-api.ts
git commit -m "feat(production): cliente API para addAdminActaLine"
```

---

### Task 7: Frontend — `source` en `ActaSideLine` y `editable` para `ADMIN_STOCK`

**Files:**
- Modify: `frontend/lib/orden-produccion.ts`

**Interfaces:**
- Produces: `ActaSideLine` (variante `row`) gana el campo `source: string`. Usado por Task 8 (edición condicional) y Task 9/11 (gating de controles).

- [ ] **Step 1: Extender el tipo**

En `frontend/lib/orden-produccion.ts`, línea 9-11, el tipo queda:

```typescript
export type ActaSideLine =
  | { kind: "row"; id: string; label: string; quantity: string; unit_code: string; editable: boolean; source: string }
  | { kind: "group"; fecha: string | null; responsable: string };
```

- [ ] **Step 2: Actualizar los 7 lugares que construyen una fila `row`**

`productoRealLines` (línea 110-117) — fila sintética, nunca editable, `source` fijo:

```typescript
  return [...merged.entries()].map(([key, p]) => ({
    kind: "row" as const,
    id: `producto-real-${key}`,
    label: `Producto: ${p.label}`,
    quantity: String(p.quantity),
    unit_code: p.unit,
    editable: false,
    source: "AUTO",
  }));
```

`buildRunActaSides`, lado ENTREGA (línea 186-188):

```typescript
  const entregaLines: ActaSideLine[] = lines
    .filter((l) => l.side === "ENTREGA")
    .map((l) => ({ kind: "row" as const, id: l.id, label: l.label, quantity: l.quantity, unit_code: l.unit_code, editable: l.source === "MANUAL" || l.source === "ADMIN_STOCK", source: l.source }));
```

`buildRunActaSides`, lado RECEPCION (línea 196-201):

```typescript
  const recepcionLines: ActaSideLine[] = [
    ...productoRealLines(realProductsForRun(run), run.raw_material_unit_code),
    ...lines
      .filter((l) => l.side === "RECEPCION" && l.source !== "PLAN" && l.stage_id == null)
      .map((l) => ({ kind: "row" as const, id: l.id, label: l.label, quantity: l.quantity, unit_code: l.unit_code, editable: l.source === "MANUAL" || l.source === "ADMIN_STOCK", source: l.source })),
  ];
```

`entregaRowsForRun` (línea 258-273) — la rama de `event_lines` históricos se queda `editable: false` con `source: "AUTO"` (nunca editable, no importa el valor real); la rama de `acta_lines` ahora sí calcula `editable`/`source` igual que `buildRunActaSides` (esto es lo que habilita el botón de editar en Documentos, incluidas familias con split):

```typescript
function entregaRowsForRun(run: ProductionRun): Extract<ActaSideLine, { kind: "row" }>[] {
  const eventLines = (run.event_lines ?? []).filter((line) => line.side === "ENTREGA");
  if (eventLines.length > 0) {
    return eventLines.map((line, i) => ({
      kind: "row" as const,
      id: `${run.id}-ent-ev-${i}`,
      label: line.detalle ?? "",
      quantity: line.gramos,
      unit_code: line.unidad,
      editable: false,
      source: "AUTO",
    }));
  }
  return (run.acta_lines ?? [])
    .filter((line) => line.side === "ENTREGA")
    .map((line) => ({ kind: "row" as const, id: line.id, label: line.label, quantity: line.quantity, unit_code: line.unit_code, editable: line.source === "MANUAL" || line.source === "ADMIN_STOCK", source: line.source }));
}
```

`recepcionRowsForRun` (línea 281-296), mismo criterio:

```typescript
function recepcionRowsForRun(run: ProductionRun): Extract<ActaSideLine, { kind: "row" }>[] {
  const eventLines = (run.event_lines ?? []).filter((line) => line.side === "RECEPCION");
  if (eventLines.length > 0) {
    return eventLines.map((line, i) => ({
      kind: "row" as const,
      id: `${run.id}-rec-ev-${i}`,
      label: line.detalle ?? "",
      quantity: line.gramos,
      unit_code: line.unidad,
      editable: false,
      source: "AUTO",
    }));
  }
  return (run.acta_lines ?? [])
    .filter((line) => line.side === "RECEPCION" && line.source !== "PLAN" && line.stage_id == null)
    .map((line) => ({ kind: "row" as const, id: line.id, label: line.label, quantity: line.quantity, unit_code: line.unit_code, editable: line.source === "MANUAL" || line.source === "ADMIN_STOCK", source: line.source }));
}
```

- [ ] **Step 3: Verificar tipos**

Run: `docker-compose exec web npx tsc --noEmit -p tsconfig.json`
Expected: sin errores (si aparece un error de propiedad `source` faltante en algún otro lugar que construya `ActaSideLine`, agregarla ahí también antes de continuar).

- [ ] **Step 4: Commit**

```bash
git add frontend/lib/orden-produccion.ts
git commit -m "feat(production): ActaSideLine expone source, editable incluye ADMIN_STOCK"
```

---

### Task 8: Frontend — `acta-side.tsx` edita solo cantidad en líneas `ADMIN_STOCK`

**Files:**
- Modify: `frontend/components/production/acta-side.tsx`

**Interfaces:**
- Consumes: `ActaSideLine.source` (Task 7).

- [ ] **Step 1: Guardar el `source` de la línea en edición y ramificar el formulario**

En `frontend/components/production/acta-side.tsx`, agregar estado nuevo junto a los existentes (línea 56-60):

```typescript
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingSource, setEditingSource] = useState<string>("MANUAL");
  const [editLabel, setEditLabel] = useState("");
  const [editQuantity, setEditQuantity] = useState("");
  const [editUnit, setEditUnit] = useState("");
  const [isSaving, setIsSaving] = useState(false);
```

`startEdit` (línea 62-67) queda:

```typescript
  function startEdit(line: Extract<ActaSideLine, { kind: "row" }>) {
    setEditingId(line.id);
    setEditingSource(line.source);
    setEditLabel(line.label);
    setEditQuantity(line.quantity);
    setEditUnit(line.unit_code);
  }
```

`saveEdit` (línea 69-83) queda — para `ADMIN_STOCK` solo valida y envía la cantidad:

```typescript
  async function saveEdit(lineId: string) {
    if (!editQuantity || Number(editQuantity) <= 0) {
      onError?.("Indica la cantidad de la linea.");
      return;
    }
    if (editingSource !== "ADMIN_STOCK" && (!editLabel.trim() || !editUnit.trim())) {
      onError?.("Completa detalle, cantidad y unidad de la linea.");
      return;
    }
    setIsSaving(true);
    try {
      const patch = editingSource === "ADMIN_STOCK"
        ? { quantity: editQuantity }
        : { label: editLabel.trim(), quantity: editQuantity, unit_code: editUnit.trim() };
      await onEditLine?.(lineId, patch);
      setEditingId(null);
    } catch (nextError) {
      onError?.(nextError instanceof Error ? nextError.message : "No se pudo editar la linea.");
    } finally {
      setIsSaving(false);
    }
  }
```

`onEditLine` en las props del componente (línea 52) amplía su tipo de patch para aceptar un subconjunto parcial:

```typescript
  onEditLine?: (lineId: string, patch: { label?: string; quantity: string; unit_code?: string }) => Promise<unknown> | void;
```

- [ ] **Step 2: Renderizar el formulario de edición condicional**

La fila de edición (línea 134-172) queda — cuando `editingSource === "ADMIN_STOCK"`, el label y la unidad se muestran como texto fijo (no inputs):

```tsx
              ) : editingId === line.id ? (
                <tr key={line.id}>
                  <td> </td>
                  <td className="opTdGramos">
                    <span className="actaDocInputs">
                      <input
                        className="field"
                        min="0"
                        onChange={(e) => setEditQuantity(e.target.value)}
                        step="0.0001"
                        style={{ width: 84 }}
                        type="number"
                        value={editQuantity}
                      />
                      {editingSource === "ADMIN_STOCK" ? (
                        <span>{editUnit}</span>
                      ) : (
                        <input
                          className="field"
                          onChange={(e) => setEditUnit(e.target.value)}
                          style={{ width: 40 }}
                          value={editUnit}
                        />
                      )}
                    </span>
                  </td>
                  <td>
                    <span className="actaDocInputs">
                      {editingSource === "ADMIN_STOCK" ? (
                        <span style={{ flex: 1 }}>{editLabel}</span>
                      ) : (
                        <input
                          className="field"
                          onChange={(e) => setEditLabel(e.target.value)}
                          style={{ flex: 1 }}
                          value={editLabel}
                        />
                      )}
                      <button aria-label="Guardar" className="iconOnlyButton" disabled={isSaving} onClick={() => void saveEdit(line.id)} type="button">
                        <Check aria-hidden="true" size={14} />
                      </button>
                      <button aria-label="Cancelar" className="iconOnlyButton" disabled={isSaving} onClick={() => setEditingId(null)} type="button">
                        <X aria-hidden="true" size={14} />
                      </button>
                    </span>
                  </td>
                </tr>
```

- [ ] **Step 3: Verificar tipos y build**

Run: `docker-compose exec web npx tsc --noEmit -p tsconfig.json`
Expected: sin errores.

- [ ] **Step 4: Commit**

```bash
git add frontend/components/production/acta-side.tsx
git commit -m "feat(production): editar linea ADMIN_STOCK solo permite cambiar cantidad"
```

---

### Task 9: Frontend — componente `AdminAddActaLineControl`

**Files:**
- Create: `frontend/components/production/admin-add-acta-line.tsx`

**Interfaces:**
- Consumes: `addAdminActaLine` (Task 6), `MaterialCategoryPicker` (`@/components/production/material-category-picker`), `listUnits`/`Unit` (`@/lib/units-api`), `InventoryItem`/`InventoryItemType` (`@/types/inventory`).
- Produces: `AdminAddActaLineControl({ side, runId, items, isAdmin, onChanged, onError, onSuccess }): JSX.Element | null` — usado por Task 10 y Task 11.

- [ ] **Step 1: Crear el componente**

```tsx
"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { addAdminActaLine } from "@/lib/production-api";
import { MaterialCategoryPicker } from "@/components/production/material-category-picker";
import { listUnits } from "@/lib/units-api";
import type { InventoryItem } from "@/types/inventory";

const ADMIN_PICKER_TYPES: InventoryItem["item_type"][] = [
  "RAW_MATERIAL",
  "SUPPLY",
  "COMPLEMENT",
  "WASTE",
  "FINISHED_PRODUCT",
];

// Boton "+" solo-admin en la acta: elegir un item real de inventario (mueve
// stock de inmediato, sin aprobacion) o escribir algo a mano con una unidad
// de una lista (nunca mueve stock). La busqueda del picker YA hace de
// "reconocer coincidencia" -- si el admin no encuentra el item ahi, pasa al
// formulario manual con el link de abajo.
export function AdminAddActaLineControl({
  side,
  runId,
  items,
  isAdmin,
  onChanged,
  onError,
  onSuccess,
}: {
  side: "ENTREGA" | "RECEPCION";
  runId: string;
  items: InventoryItem[];
  isAdmin: boolean;
  onChanged: () => void;
  onError: (message: string) => void;
  onSuccess: (message: string) => void;
}) {
  const [mode, setMode] = useState<"closed" | "search" | "manual">("closed");
  const [pendingItem, setPendingItem] = useState<InventoryItem | null>(null);
  const [quantity, setQuantity] = useState("");
  const [manualLabel, setManualLabel] = useState("");
  const [manualUnit, setManualUnit] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const { data: units = [] } = useQuery({ queryKey: ["units"], queryFn: listUnits, enabled: mode === "manual" });

  if (!isAdmin) return null;

  function reset() {
    setMode("closed");
    setPendingItem(null);
    setQuantity("");
    setManualLabel("");
    setManualUnit("");
    setLocalError(null);
  }

  async function submitLinked() {
    if (!pendingItem || !quantity || Number(quantity) <= 0) {
      setLocalError("Elige el item y su cantidad.");
      return;
    }
    setIsSaving(true);
    try {
      await addAdminActaLine(runId, { side, item_id: pendingItem.id, quantity });
      reset();
      onChanged();
      onSuccess("Linea agregada: se descontó/sumó del inventario real.");
    } catch (nextError) {
      setLocalError(nextError instanceof Error ? nextError.message : "No se pudo agregar la linea.");
    } finally {
      setIsSaving(false);
    }
  }

  async function submitManual() {
    if (!manualLabel.trim() || !quantity || Number(quantity) <= 0 || !manualUnit) {
      setLocalError("Completa detalle, cantidad y unidad.");
      return;
    }
    setIsSaving(true);
    try {
      await addAdminActaLine(runId, { side, label: manualLabel.trim(), quantity, unit_code: manualUnit });
      reset();
      onChanged();
      onSuccess("Linea agregada. No se descontó del inventario (es texto libre).");
    } catch (nextError) {
      setLocalError(nextError instanceof Error ? nextError.message : "No se pudo agregar la linea.");
    } finally {
      setIsSaving(false);
    }
  }

  if (mode === "closed") {
    return (
      <div className="actaDocAction">
        <button className="actaDocAddRow" onClick={() => setMode("search")} type="button">
          <Plus aria-hidden="true" size={13} />
          Agregar línea (admin)
        </button>
      </div>
    );
  }

  if (mode === "manual") {
    return (
      <div className="actaDocAction">
        <div className="materialRow" style={{ alignItems: "flex-start", gap: 8, marginTop: 10 }}>
          <input
            aria-label="Detalle"
            className="field"
            onChange={(e) => setManualLabel(e.target.value)}
            placeholder="Detalle"
            style={{ flex: 1 }}
            type="text"
            value={manualLabel}
          />
          <input
            aria-label="Cantidad"
            className="field"
            min="0.0001"
            onChange={(e) => setQuantity(e.target.value)}
            step="0.0001"
            style={{ width: 100 }}
            type="number"
            value={quantity}
          />
          <select aria-label="Unidad" className="field" onChange={(e) => setManualUnit(e.target.value)} style={{ width: 90 }} value={manualUnit}>
            <option value="">Unidad...</option>
            {units.filter((u) => u.is_active).map((u) => (
              <option key={u.id} value={u.code}>{u.label}</option>
            ))}
          </select>
          <button className="button" disabled={isSaving} onClick={reset} type="button">Cancelar</button>
          <button className="button buttonPrimary" disabled={isSaving} onClick={() => void submitManual()} type="button">Agregar</button>
        </div>
        <p className="panelText">Esta línea no descuenta del inventario real.</p>
        {localError ? <p className="panelText" style={{ color: "var(--danger, #b3261e)" }}>{localError}</p> : null}
      </div>
    );
  }

  return (
    <div className="actaDocAction">
      <MaterialCategoryPicker
        allowedTypes={ADMIN_PICKER_TYPES}
        description="Busca el item real que se pasó registrar. Si no lo encuentras, escríbelo a mano."
        error={localError}
        items={items}
        onClose={reset}
        onDismissError={() => setLocalError(null)}
        onSelect={(item) => {
          setPendingItem(item);
          setQuantity("");
          setLocalError(null);
        }}
        quantityStep={
          pendingItem
            ? {
                confirmLabel: "Agregar y mover inventario",
                isSaving,
                item: pendingItem,
                onBack: () => {
                  setPendingItem(null);
                  setLocalError(null);
                },
                onConfirm: () => void submitLinked(),
                onQuantityChange: (value) => {
                  setQuantity(value);
                  setLocalError(null);
                },
                quantity,
              }
            : undefined
        }
        title="Agregar línea de acta"
      />
      {!pendingItem ? (
        <button className="actaDocAddRow" onClick={() => { setMode("manual"); setLocalError(null); }} style={{ marginTop: 8 }} type="button">
          No lo encuentro, escribir a mano
        </button>
      ) : null}
    </div>
  );
}
```

- [ ] **Step 2: Verificar tipos**

Run: `docker-compose exec web npx tsc --noEmit -p tsconfig.json`
Expected: sin errores. Si `InventoryItem["item_type"]` no es un tipo indexable así, revisar `frontend/types/inventory/index.ts` para el nombre exacto del tipo unión (`InventoryItemType`) y usar ese en su lugar (`import type { InventoryItemType } from "@/types/inventory";` y `const ADMIN_PICKER_TYPES: InventoryItemType[] = [...]`).

- [ ] **Step 3: Commit**

```bash
git add frontend/components/production/admin-add-acta-line.tsx
git commit -m "feat(production): componente AdminAddActaLineControl"
```

---

### Task 10: Frontend — wiring en Ver Acta (`acta-view.tsx` + `production-dashboard.tsx`)

**Files:**
- Modify: `frontend/components/production/acta-view.tsx`
- Modify: `frontend/components/production/production-dashboard.tsx`

**Interfaces:**
- Consumes: `AdminAddActaLineControl` (Task 9).

- [ ] **Step 1: `ActaView` recibe `isAdmin` e `inventoryItems`**

En `frontend/components/production/acta-view.tsx`, agregar el import:

```typescript
import { AdminAddActaLineControl } from "@/components/production/admin-add-acta-line";
```

La firma de `ActaView` (buscar `export function ActaView({` en el archivo) gana dos props nuevas: `isAdmin: boolean` e `inventoryItems: InventoryItem[]`. Los dos `<ActaSide>` (línea 437-466) quedan:

```tsx
                <ActaSide
                  actions={
                    <>
                      <EntregaAction
                        materialItems={materialItems}
                        onChanged={onChanged}
                        onSuccess={flagSuccess}
                        run={run}
                      />
                      <AdminAddActaLineControl
                        isAdmin={isAdmin}
                        items={inventoryItems}
                        onChanged={onChanged}
                        onError={flagError}
                        onSuccess={flagSuccess}
                        runId={headerRun.id}
                        side="ENTREGA"
                      />
                    </>
                  }
                  fecha={sides.entregaFecha}
                  lines={sides.entregaLines}
                  onDeleteLine={(lineId) => deleteActaLine(lineId)}
                  onEditLine={(lineId, patch) => updateActaLine(lineId, patch)}
                  onError={flagError}
                  responsable={sides.entregaResponsable}
                  title="ENTREGADO"
                  totalRows={sides.entregaTotalRows}
                />
                <div className="opDivider" aria-hidden="true" />
                <ActaSide
                  fecha={sides.recepcionFecha}
                  footer={
                    <>
                      <RecepcionActions onChanged={onChanged} onError={flagError} onSuccess={flagSuccess} run={run} />
                      <AdminAddActaLineControl
                        isAdmin={isAdmin}
                        items={inventoryItems}
                        onChanged={onChanged}
                        onError={flagError}
                        onSuccess={flagSuccess}
                        runId={headerRun.id}
                        side="RECEPCION"
                      />
                    </>
                  }
                  lines={sides.recepcionLines}
                  onDeleteLine={(lineId) => deleteActaLine(lineId)}
                  onEditLine={(lineId, patch) => updateActaLine(lineId, patch)}
                  onError={flagError}
                  responsable={sides.recepcionResponsable}
                  title="RECIBIDO"
                  totalRows={sides.recepcionTotalRows}
                />
```

`runId={headerRun.id}` (no `run.id`): en una familia con split, `headerRun` ya es la corrida raíz (línea 392 del archivo) — toda línea admin nueva se ata ahí, sin importar desde qué pierna del split se abrió Ver Acta.

- [ ] **Step 2: `production-dashboard.tsx` pasa las props nuevas**

En `frontend/components/production/production-dashboard.tsx`, el render de `<ActaView>` (línea 4276-4284) queda:

```tsx
      {actaRun ? (
        <ActaView
          family={getRunFamily(runs, actaRun)}
          inventoryItems={[...rawMaterials, ...orderSupplyItems, ...complementItems, ...wasteItems, ...finishedItems]}
          isAdmin={isAdmin}
          materialItems={[...rawMaterials, ...orderSupplyItems, ...complementItems]}
          onChanged={() => void reload()}
          onClose={() => closeActaModal()}
          run={actaRun}
        />
      ) : null}
```

(`isAdmin` ya existe en este archivo, línea 630.)

- [ ] **Step 3: Verificar tipos y build**

Run: `docker-compose exec web npx tsc --noEmit -p tsconfig.json`
Expected: sin errores.

Run: `docker-compose exec web npm run build`
Expected: build exitoso.

- [ ] **Step 4: Commit**

```bash
git add frontend/components/production/acta-view.tsx frontend/components/production/production-dashboard.tsx
git commit -m "feat(production): boton de admin para agregar linea de acta en Ver Acta"
```

---

### Task 10b: Frontend — mismo botón en Ver Acta desde Inventario y Solicitudes

**Contexto (agregada tras Task 10):** `ActaView` no solo se monta desde
`production-dashboard.tsx` — también se abre, sin pasar `isAdmin`/
`inventoryItems`, desde `frontend/components/inventory/inventory-dashboard.tsx`
(línea ~5475) y `frontend/components/solicitudes/solicitudes-view.tsx` (línea
~387). El Task 10 dejó esas dos props opcionales (`isAdmin = false`,
`inventoryItems = []`) para no romper esos dos call sites — correcto para no
romper el build, pero deja el botón de admin invisible ahí. Rodrigo confirmó
(2026-08-17) que debe verse en los tres lugares.

**Files:**
- Modify: `frontend/components/inventory/inventory-dashboard.tsx`
- Modify: `frontend/components/solicitudes/solicitudes-view.tsx`

**Interfaces:**
- Consumes: `ActaView`'s `isAdmin`/`inventoryItems` props (ya opcionales, Task 10).

- [ ] **Step 1: `inventory-dashboard.tsx` pasa `isAdmin`/`inventoryItems`**

Este archivo ya calcula `canSeeAudit = currentUser?.role === "admin" ||
currentUser?.role === "Admin"` (línea ~610) — es el mismo chequeo de admin,
con otro nombre. Ya tiene `items` (la lista completa de inventario, usada hoy
en `materialItems={items}` en el `<ActaView>` de la línea ~5475-5481). El
`<ActaView>` queda:

```tsx
      {actaRun ? (
        <ActaView
          family={getRunFamily(productionRuns, actaRun)}
          inventoryItems={items}
          isAdmin={canSeeAudit}
          materialItems={items}
          onChanged={() => void queryClient.invalidateQueries({ queryKey: ["inventory"] })}
          onClose={() => setActaRun(null)}
          run={actaRun}
        />
      ) : null}
```

- [ ] **Step 2: `solicitudes-view.tsx` pasa `isAdmin`/`inventoryItems`**

Este archivo ya tiene `currentUser` (línea ~185, `useQuery` con
`getCurrentUser`) y `materialItems` (línea ~200, `useQuery` con
`listInventoryItems()` sin argumento — ya trae todos los tipos). No existe
todavía ninguna variable `isAdmin`/`canSeeAudit` en este archivo — agregar,
junto a la definición de `role`/`userId` (línea ~206-207):

```typescript
  const isAdmin = currentUser?.role === "admin" || currentUser?.role === "Admin";
```

El `<ActaView>` (línea ~386-394) queda:

```tsx
      {actaRun ? (
        <ActaView
          family={getRunFamily(runs, actaRun)}
          inventoryItems={materialItems}
          isAdmin={isAdmin}
          materialItems={materialItems}
          onChanged={() => void queryClient.invalidateQueries({ queryKey: ["solicitudes"] })}
          onClose={() => setActaRun(null)}
          run={actaRun}
        />
      ) : null}
```

- [ ] **Step 3: Verificar tipos y build**

Run: `docker-compose exec web npx tsc --noEmit -p tsconfig.json`
Expected: sin errores.

Run: `docker-compose exec web npm run build`
Expected: build exitoso.

- [ ] **Step 4: Commit**

```bash
git add frontend/components/inventory/inventory-dashboard.tsx frontend/components/solicitudes/solicitudes-view.tsx
git commit -m "feat(production): boton de admin en Ver Acta tambien desde Inventario y Solicitudes"
```

---

### Task 11: Frontend — wiring en Documentos (`orden-produccion-doc.tsx` + `documentos-dashboard.tsx`)

**Files:**
- Modify: `frontend/components/documentos/orden-produccion-doc.tsx`
- Modify: `frontend/components/documentos/documentos-dashboard.tsx`

**Interfaces:**
- Consumes: `AdminAddActaLineControl` (Task 9).

- [ ] **Step 1: `OrdenProduccionDoc` acepta slots opcionales de acciones y handlers de edición**

`frontend/components/documentos/orden-produccion-doc.tsx` queda:

```tsx
import { ActaSide } from "@/components/production/acta-side";
import { OrdenProduccionModel } from "@/lib/orden-produccion";

export type DocMode = "entrega" | "recepcion" | "completo";

// Mismo componente que Ver Acta (components/production/acta-side.tsx): antes
// este documento tenia su propio SideColumn, calculaba las filas distinto y
// se desincronizaba de Ver Acta cada vez que se agregaba un aviso/fase nuevo
// (bug reportado varias veces). dataClass sigue siendo lo unico especifico de
// impresion (visibilidad selectiva por opMode-entrega/opMode-recepcion, ver
// globals.css) -- Ver Acta no lo usa porque no imprime por seccion.
// entregaActions/recepcionFooter/onEditLine/onDeleteLine/onError: opcionales,
// solo la vista interactiva de Documentos los pasa (el boton de admin y la
// edicion de sus lineas) -- el portal que imprime de verdad
// (mode=printingMode) nunca los pasa, para que no salga nada de eso en el
// papel.
export function OrdenProduccionDoc({
  model,
  mode,
  entregaActions,
  recepcionFooter,
  onEditLine,
  onDeleteLine,
  onError,
}: {
  model: OrdenProduccionModel;
  mode: DocMode;
  entregaActions?: React.ReactNode;
  recepcionFooter?: React.ReactNode;
  onEditLine?: (lineId: string, patch: { label?: string; quantity: string; unit_code?: string }) => Promise<unknown> | void;
  onDeleteLine?: (lineId: string) => Promise<unknown> | void;
  onError?: (message: string) => void;
}) {
  return (
    <div className={`opDocWrap opMode-${mode}`}>
      <article className="opDoc">
        <header className="opHeader">
          <div className="opTitleBar">ORDEN DE PRODUCCIÓN</div>
          <div className="opCategoryBar">{model.categoria}</div>
          <div className="opFolio">Nº {model.folio}</div>
        </header>

        <div className="opResponsable">
          RESPONSABLE PRODUCCIÓN: <span>{model.responsableProduccion}</span>
        </div>

        <div className="opBody">
          <ActaSide
            actions={entregaActions}
            dataClass="opEntregaData"
            fecha={model.entregaFecha}
            lines={model.entregaLines}
            onDeleteLine={onDeleteLine}
            onEditLine={onEditLine}
            onError={onError}
            responsable={model.entregaResponsable}
            title="ENTREGADO"
            totalRows={model.entregaTotalRows}
          />
          <div className="opDivider" aria-hidden="true" />
          <ActaSide
            dataClass="opRecepcionData"
            fecha={model.recepcionFecha}
            footer={recepcionFooter}
            lines={model.recepcionLines}
            onDeleteLine={onDeleteLine}
            onEditLine={onEditLine}
            onError={onError}
            responsable={model.recepcionResponsable}
            title="RECIBIDO"
            totalRows={model.recepcionTotalRows}
          />
        </div>

        {model.cancelada ? <div className="opStamp opStampCancel">CANCELADO</div> : null}
      </article>
    </div>
  );
}
```

- [ ] **Step 2: `documentos-dashboard.tsx` — currentUser, estado de error/éxito, y el root run de la familia seleccionada**

En `frontend/components/documentos/documentos-dashboard.tsx`, la línea 7 (`import { listProductionRuns } from "@/lib/production-api";`) queda:

```typescript
import { addAdminActaLine, deleteActaLine, listProductionRuns, updateActaLine } from "@/lib/production-api";
```

Y agregar, junto a los demás imports del archivo:

```typescript
import { getCurrentUser } from "@/lib/auth-api";
import { AdminAddActaLineControl } from "@/components/production/admin-add-acta-line";
import { ToastNotice } from "@/components/ui/toast-notice";
```

Dentro de `DocumentosDashboard`, después de la query de `data` (línea 50-53), agregar:

```typescript
  const { data: currentUser } = useQuery({ queryKey: ["current-user"], queryFn: getCurrentUser });
  const isAdmin = currentUser?.role === "admin" || currentUser?.role === "Admin";
  const [docError, setDocError] = useState<string | null>(null);
  const [docSuccess, setDocSuccess] = useState<string | null>(null);
```

(Agregar `useQuery` ya está importado; agregar `useState` al import de React si no cubre ya `docError`/`docSuccess` — el archivo ya importa `useEffect, useMemo, useState` en la línea 3, así que `useState` ya está disponible.)

Después de la definición de `selectedFamily`/`model` (línea 201-205), agregar el id del run raíz:

```typescript
  const selectedRootRunId = selectedFamily
    ? (selectedFamily.find((r) => !r.parent_run_id) ?? selectedFamily[0]).id
    : null;
```

- [ ] **Step 3: Renderizar el aviso y pasar los controles al `OrdenProduccionDoc` interactivo**

En el bloque `{model && selectedFamily ? (` (línea 317-351), agregar el `ToastNotice` y las props nuevas:

```tsx
            {model && selectedFamily ? (
              <>
                {docError || docSuccess ? (
                  <div className="toastStack" aria-live="polite" aria-atomic="true">
                    {docError ? <ToastNotice key={docError} kind="error" message={docError} onClose={() => setDocError(null)} compact /> : null}
                    {docSuccess ? <ToastNotice key={docSuccess} kind="success" message={docSuccess} onClose={() => setDocSuccess(null)} compact /> : null}
                  </div>
                ) : null}
                <div className="documentosActions">
                  <button
                    className="button"
                    disabled={!selectedFamily || !canPrintEntrega(selectedFamily)}
                    onClick={() => setPrintMode("entrega")}
                    type="button"
                  >
                    <Printer aria-hidden="true" size={16} />
                    Imprimir entrega
                  </button>
                  <button
                    className="button"
                    disabled={!selectedFamily || !canPrintRecepcion(selectedFamily)}
                    onClick={() => setPrintMode("recepcion")}
                    type="button"
                  >
                    <Printer aria-hidden="true" size={16} />
                    Imprimir recepción
                  </button>
                  <button
                    className="button buttonPrimary"
                    disabled={!selectedFamily || !canPrintRecepcion(selectedFamily)}
                    onClick={() => setPrintMode("completo")}
                    type="button"
                  >
                    <Printer aria-hidden="true" size={16} />
                    Imprimir completo
                  </button>
                </div>
                <div className="documentosPreviewFrame">
                  <OrdenProduccionDoc
                    entregaActions={
                      selectedRootRunId && !isHistoricalFamily(selectedFamily) ? (
                        <AdminAddActaLineControl
                          isAdmin={isAdmin}
                          items={items}
                          onChanged={() => void refetch()}
                          onError={setDocError}
                          onSuccess={setDocSuccess}
                          runId={selectedRootRunId}
                          side="ENTREGA"
                        />
                      ) : null
                    }
                    mode="completo"
                    model={model}
                    onDeleteLine={(lineId) => deleteActaLine(lineId).then(() => refetch())}
                    onEditLine={(lineId, patch) => updateActaLine(lineId, patch).then(() => refetch())}
                    onError={setDocError}
                    recepcionFooter={
                      selectedRootRunId && !isHistoricalFamily(selectedFamily) ? (
                        <AdminAddActaLineControl
                          isAdmin={isAdmin}
                          items={items}
                          onChanged={() => void refetch()}
                          onError={setDocError}
                          onSuccess={setDocSuccess}
                          runId={selectedRootRunId}
                          side="RECEPCION"
                        />
                      ) : null
                    }
                  />
                </div>
              </>
            ) : (
              <div className="emptyState">Selecciona una orden para ver su comprobante.</div>
            )}
```

`refetch` viene de desestructurar la query original: cambiar `const { data, isLoading } = useQuery({...})` (línea 50) por `const { data, isLoading, refetch } = useQuery({...})`.

El portal de impresión real (línea ~461, `{printingMode && printPreview ? createPortal(...)}`) **no** recibe `entregaActions`/`recepcionFooter`/`onEditLine`/`onDeleteLine` — se deja exactamente igual que hoy, así el botón nunca sale en el papel impreso.

- [ ] **Step 4: Verificar tipos y build**

Run: `docker-compose exec web npx tsc --noEmit -p tsconfig.json`
Expected: sin errores.

Run: `docker-compose exec web npm run build`
Expected: build exitoso.

- [ ] **Step 5: Commit**

```bash
git add frontend/components/documentos/orden-produccion-doc.tsx frontend/components/documentos/documentos-dashboard.tsx
git commit -m "feat(documentos): boton de admin para agregar linea de acta, incluida familias con split"
```

---

### Task 12: Verificación final

**Files:** ninguno (solo comandos y checklist manual).

- [ ] **Step 1: Suite completa de backend**

Run: `docker-compose exec api pytest`
Expected: todos los tests `PASSED`, sin regresiones fuera de los archivos tocados.

- [ ] **Step 2: Build de frontend**

Run: `docker-compose exec web npm run build`
Expected: build exitoso sin errores ni warnings de tipos nuevos.

- [ ] **Step 3: Checklist manual en navegador (requiere el stack de Docker ya levantado por Rodrigo — no lo levantes vos)**

En una orden `EN_PROCESO` real, como usuario admin:
1. Abrir "Ver Acta" → botón "Agregar línea (admin)" del lado ENTREGA visible; con otro rol (Jefe de producción / Jefe de inventario) el botón no debe aparecer.
2. Buscar un ítem real de inventario con stock, agregarlo con cantidad → confirmar en Inventario que `current_stock` bajó exactamente esa cantidad, y que la fila aparece en la acta con el ícono de editar (lápiz).
3. Editar la cantidad de esa línea hacia arriba y hacia abajo → confirmar que el stock se ajusta por la diferencia, no por el total dos veces.
4. Borrarla → confirmar que el stock vuelve al valor original y la fila desaparece.
5. Repetir con "No lo encuentro, escribir a mano": agregar una línea libre con una unidad de la lista → confirmar que aparece con el aviso "no se descontó del inventario" y que el stock del ítem real que sí existe con ese nombre (si hay uno) no se tocó.
6. Ir a Documentos, elegir la misma orden (y una con split, si hay una disponible) → confirmar que el mismo botón aparece en la vista previa interactiva y funciona igual, y que **no** aparece en el documento impreso real (usar "Imprimir completo" y revisar la vista previa de impresión).
