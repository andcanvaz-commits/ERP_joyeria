# Certificados históricos (import Excel) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Importar las 37 órdenes históricas de `Joyeria/Ordenes de Producción.xlsx` como certificados reales del sistema (`production_runs` con folio `OP-2026-0001..0037`), preservando cada línea de detalle del papel y el nombre del responsable, sin tocar el stock actual.

**Architecture:** Dos columnas nuevas en `production_runs` (nombre de responsable en texto libre cuando no hay usuario) + una tabla nueva `production_run_event_lines` (líneas de detalle por evento de entrega/recepción) — ambas aditivas, cero cambio de comportamiento para órdenes en vivo. Un script de migración de datos (fuera del service layer, sin efectos de inventario) parsea el Excel y escribe las corridas directamente con SQLAlchemy. El frontend extiende `buildOrdenProduccion` para usar esas líneas cuando existen, y Documentos gana buscador + filtro para no saturarse.

**Tech Stack:** FastAPI, SQLAlchemy 2.0, Alembic, Pydantic v2, Next.js/React/TypeScript, pytest.

## Global Constraints

- No quemar nombres de procesos ni categorías en código — el proceso histórico se crea como dato (`ProductionProcess`), igual que cualquier proceso configurado por el administrador.
- No actualizar stock sin movimiento histórico — el import nunca llama a `consume_material_for_production` ni toca `current_stock`.
- Toda migración de esquema usa Alembic, guardada e idempotente (mismo patrón `_has_column`/`_has_table` que ya usa el repo).
- Las órdenes en vivo no cambian de comportamiento en ningún punto de este plan — todo lo nuevo es opt-in por presencia de datos (`event_lines` no vacío, nombre de responsable en texto sin usuario).
- Spec de referencia: `docs/superpowers/specs/2026-08-04-certificados-historicos-design.md`.

---

## File Structure

**Backend (crear):**
- `backend/alembic/versions/b1c2d3e4f5a6_historical_run_event_lines.py` — migración: tabla + 2 columnas.
- `backend/scripts/import_historical_orders.py` — script de import (parser Excel + dry-run + commit).
- `backend/tests/production/test_historical_import.py` — tests del parser y del fallback de nombre de responsable.

**Backend (modificar):**
- `backend/modules/production/models.py` — clase `ProductionRunEventLine`, columnas + relación en `ProductionRun`.
- `backend/modules/production/schemas.py` — `ProductionRunEventLineRead`, campo `event_lines` en `ProductionRunRead`.
- `backend/modules/production/repository.py` — eager-load de `event_lines` en `get_run`/`list_runs`.
- `backend/modules/production/service.py` — fallback de nombre de responsable en `_populate_run_names`.

**Frontend (modificar):**
- `frontend/types/production/index.ts` — campo `event_lines` en el tipo `ProductionRun`.
- `frontend/lib/orden-produccion.ts` — `OrdenProduccionModel.cantidad` nullable; `buildOrdenProduccion` usa `event_lines` cuando existen.
- `frontend/components/documentos/orden-produccion-doc.tsx` — ocultar la línea "Cantidad" cuando es `null`.
- `frontend/components/documentos/documentos-dashboard.tsx` — buscador + filtro Todas/En vivo/Históricas + agrupación por mes.

---

### Task 1: Migración Alembic — tabla `production_run_event_lines` + columnas de responsable en texto

**Files:**
- Create: `backend/alembic/versions/b1c2d3e4f5a6_historical_run_event_lines.py`

**Interfaces:**
- Produces: tabla `production_run_event_lines(id, run_id, side, gramos, unidad, detalle, line_order)`; columnas `production_runs.materials_approved_responsable_name`, `production_runs.received_responsable_name` (ambas `String(180)`, nullable).

- [ ] **Step 1: Escribir la migración**

```python
"""production_runs: event_lines historicas + nombre de responsable en texto

Revision ID: b1c2d3e4f5a6
Revises: c8d9e0f1a2b3
Create Date: 2026-08-04
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql


# revision identifiers, used by Alembic.
revision: str = "b1c2d3e4f5a6"
down_revision: Union[str, None] = "c8d9e0f1a2b3"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def _has_table(table: str) -> bool:
    inspector = sa.inspect(op.get_bind())
    return table in inspector.get_table_names()


def _has_column(table: str, column: str) -> bool:
    inspector = sa.inspect(op.get_bind())
    return column in {col["name"] for col in inspector.get_columns(table)}


def upgrade() -> None:
    if not _has_column("production_runs", "materials_approved_responsable_name"):
        op.add_column(
            "production_runs",
            sa.Column("materials_approved_responsable_name", sa.String(180), nullable=True),
        )
    if not _has_column("production_runs", "received_responsable_name"):
        op.add_column(
            "production_runs",
            sa.Column("received_responsable_name", sa.String(180), nullable=True),
        )
    if not _has_table("production_run_event_lines"):
        op.create_table(
            "production_run_event_lines",
            sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
            sa.Column(
                "run_id",
                postgresql.UUID(as_uuid=True),
                sa.ForeignKey("production_runs.id", ondelete="CASCADE"),
                nullable=False,
            ),
            sa.Column("side", sa.String(20), nullable=False),
            sa.Column("gramos", sa.Numeric(14, 4), nullable=False),
            sa.Column("unidad", sa.String(20), nullable=False),
            sa.Column("detalle", sa.Text(), nullable=True),
            sa.Column("line_order", sa.Integer(), nullable=False, server_default="0"),
        )
        op.create_index(
            "ix_production_run_event_lines_run_id",
            "production_run_event_lines",
            ["run_id"],
        )


def downgrade() -> None:
    if _has_table("production_run_event_lines"):
        op.drop_index("ix_production_run_event_lines_run_id", table_name="production_run_event_lines")
        op.drop_table("production_run_event_lines")
    if _has_column("production_runs", "received_responsable_name"):
        op.drop_column("production_runs", "received_responsable_name")
    if _has_column("production_runs", "materials_approved_responsable_name"):
        op.drop_column("production_runs", "materials_approved_responsable_name")
```

- [ ] **Step 2: Verificar que encadena bien con el head actual**

Run: `cd backend && python -m alembic heads`
Expected: una sola head, `b1c2d3e4f5a6` (antes era `c8d9e0f1a2b3`).

*(Requiere el stack de Docker arriba — `docker exec erp_joyeria-api-1 python -m alembic heads` si se corre dentro del contenedor. Si el stack está abajo, este paso queda pendiente hasta que el usuario lo levante — no lo levantes vos.)*

- [ ] **Step 3: Aplicar la migración**

Run: `docker exec erp_joyeria-api-1 python -m alembic upgrade head`
Expected: log de Alembic mostrando `b1c2d3e4f5a6` aplicada sin error.

- [ ] **Step 4: Commit**

```bash
git add backend/alembic/versions/b1c2d3e4f5a6_historical_run_event_lines.py
git commit -m "feat(produccion): tabla de lineas de evento y responsable en texto para ordenes historicas"
```

---

### Task 2: Modelo `ProductionRunEventLine` + columnas nuevas en `ProductionRun`

**Files:**
- Modify: `backend/modules/production/models.py`

**Interfaces:**
- Consumes: nada nuevo (solo `Base`, `Mapped`, `mapped_column`, `relationship` ya importados en el archivo).
- Produces: clase `ProductionRunEventLine` (atributos `id`, `run_id`, `side`, `gramos`, `unidad`, `detalle`, `line_order`, relación `run`); `ProductionRun.materials_approved_responsable_name: str | None`, `ProductionRun.received_responsable_name: str | None`, `ProductionRun.event_lines: list[ProductionRunEventLine]`.

- [ ] **Step 1: Agregar las columnas nuevas a `ProductionRun`**

En `backend/modules/production/models.py`, dentro de la clase `ProductionRun`, justo debajo de `rejection_reason` (línea ~197):

```python
    rejection_reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    # Nombre de responsable en texto libre: se usa cuando no hay
    # materials_approved_by_user_id/received_by_user_id (ordenes historicas
    # migradas de papel, sin cuenta de usuario real). Si el user_id existe,
    # el nombre resuelto por cuenta siempre gana (ver _populate_run_names).
    materials_approved_responsable_name: Mapped[str | None] = mapped_column(String(180), nullable=True)
    received_responsable_name: Mapped[str | None] = mapped_column(String(180), nullable=True)
```

- [ ] **Step 2: Agregar la relación `event_lines` a `ProductionRun`**

Justo debajo de la relación `complements` (después de la línea `)` que cierra `complements: Mapped[list["ProductionComplementRequest"]] = relationship(...)`, antes de `assembly_items`):

```python
    # Lineas de detalle por evento de entrega/recepcion (solo ordenes
    # historicas migradas: una corrida en vivo nunca las llena). Cuando
    # existen para un lado, el certificado las usa en vez de la fila unica
    # calculada de total_required_material — ver buildOrdenProduccion.
    event_lines: Mapped[list["ProductionRunEventLine"]] = relationship(
        back_populates="run",
        cascade="all, delete-orphan",
        order_by="ProductionRunEventLine.line_order",
    )
```

- [ ] **Step 3: Agregar la clase `ProductionRunEventLine`**

Al final del archivo, después de la clase `ProductionRunAssemblyItem`:

```python
class ProductionRunEventLine(Base):
    __tablename__ = "production_run_event_lines"

    id: Mapped[PyUUID] = mapped_column(PG_UUID(as_uuid=True), primary_key=True, default=uuid4)
    run_id: Mapped[PyUUID] = mapped_column(
        ForeignKey("production_runs.id", ondelete="CASCADE"), nullable=False, index=True
    )
    side: Mapped[str] = mapped_column(String(20), nullable=False)
    gramos: Mapped[Decimal] = mapped_column(Numeric(14, 4), nullable=False)
    unidad: Mapped[str] = mapped_column(String(20), nullable=False)
    detalle: Mapped[str | None] = mapped_column(Text, nullable=True)
    line_order: Mapped[int] = mapped_column(Integer, nullable=False, default=0)

    run: Mapped["ProductionRun"] = relationship(back_populates="event_lines")


class ProductionRunEventSide:
    ENTREGA = "ENTREGA"
    RECEPCION = "RECEPCION"
```

- [ ] **Step 4: Verificar que el modulo importa sin errores**

Run: `docker exec erp_joyeria-api-1 python -c "import backend.modules.production.models"`
Expected: sin salida, exit code 0.

- [ ] **Step 5: Commit**

```bash
git add backend/modules/production/models.py
git commit -m "feat(produccion): modelo ProductionRunEventLine y columnas de responsable en texto"
```

---

### Task 3: Schema `ProductionRunEventLineRead` + campo `event_lines` en `ProductionRunRead`

**Files:**
- Modify: `backend/modules/production/schemas.py`

**Interfaces:**
- Consumes: `ProductionRunEventLine` (Task 2, vía `from_attributes`).
- Produces: `ProductionRunEventLineRead(side: str, gramos: Decimal, unidad: str, detalle: str | None, line_order: int)`; campo `ProductionRunRead.event_lines: list[ProductionRunEventLineRead]`.

- [ ] **Step 1: Agregar el schema de línea, junto a `SupplyConsumptionRead`**

En `backend/modules/production/schemas.py`, después de la clase `SupplyConsumptionRead` (línea ~237):

```python
class ProductionRunEventLineRead(BaseModel):
    model_config = ConfigDict(from_attributes=True, extra="forbid")

    side: str
    gramos: Decimal
    unidad: str
    detalle: str | None = None
    line_order: int
```

- [ ] **Step 2: Agregar el campo a `ProductionRunRead`**

En la clase `ProductionRunRead`, justo debajo de `supply_consumptions` (línea ~349):

```python
    supply_consumptions: list[SupplyConsumptionRead] = Field(default_factory=list)
    # Lineas de detalle por evento (solo ordenes historicas migradas).
    event_lines: list[ProductionRunEventLineRead] = Field(default_factory=list)
```

- [ ] **Step 3: Verificar import**

Run: `docker exec erp_joyeria-api-1 python -c "import backend.modules.production.schemas"`
Expected: sin salida, exit code 0.

- [ ] **Step 4: Commit**

```bash
git add backend/modules/production/schemas.py
git commit -m "feat(produccion): schema ProductionRunEventLineRead"
```

---

### Task 4: Eager-load de `event_lines` en el repositorio

**Files:**
- Modify: `backend/modules/production/repository.py:43-49` (`get_run`) y `:59-65` (`list_runs`)

**Interfaces:**
- Consumes: `ProductionRun.event_lines` (Task 2).
- Produces: nada nuevo — mismo shape de retorno, solo evita N+1 al cargar `event_lines` junto con `stages`.

- [ ] **Step 1: Agregar el import de la relación**

`get_run` y `list_runs` ya usan `selectinload(ProductionRun.stages)`; se agrega un segundo `.options(...)` para `event_lines`:

```python
    def get_run(self, run_id: UUID) -> ProductionRun | None:
        statement = (
            select(ProductionRun)
            .options(
                selectinload(ProductionRun.stages),
                selectinload(ProductionRun.event_lines),
            )
            .where(ProductionRun.id == run_id)
        )
        return self.session.execute(statement).scalar_one_or_none()
```

```python
    def list_runs(self) -> list[ProductionRun]:
        statement = (
            select(ProductionRun)
            .options(
                selectinload(ProductionRun.stages),
                selectinload(ProductionRun.event_lines),
            )
            .order_by(ProductionRun.requested_at.desc())
        )
        return list(self.session.execute(statement).scalars().all())
```

- [ ] **Step 2: Verificar import**

Run: `docker exec erp_joyeria-api-1 python -c "import backend.modules.production.repository"`
Expected: sin salida, exit code 0.

- [ ] **Step 3: Commit**

```bash
git add backend/modules/production/repository.py
git commit -m "perf(produccion): eager-load de event_lines junto con stages"
```

---

### Task 5: Fallback de nombre de responsable en texto libre

**Files:**
- Modify: `backend/modules/production/service.py:85-93` (dentro de `_populate_run_names`)
- Test: `backend/tests/production/test_historical_import.py`

**Interfaces:**
- Consumes: `run.materials_approved_responsable_name`, `run.received_responsable_name` (Task 2).
- Produces: `read.materials_approved_by_name` / `read.received_by_name` siguen siendo `str | None`, ahora con fallback — ninguna otra función del archivo cambia de firma.

- [ ] **Step 1: Escribir el test que prueba el fallback (falla primero)**

Crear `backend/tests/production/test_historical_import.py`:

```python
from decimal import Decimal

from backend.modules.production.models import ProductionRunEventLine, ProductionRunStatus
from backend.modules.production.schemas import ProductionRunCreate, RunProductCreate


def _create_run(production_service, current_user, process, raw_material, target_complement, quantity):
    payload = ProductionRunCreate(
        process_id=process.id,
        raw_material_item_id=raw_material.id,
        quantity=Decimal(quantity),
        assembly_mode="ASIGNAR",
        products=[RunProductCreate(target_item_id=target_complement.id, quantity=Decimal(quantity))],
        complements=[],
    )
    return production_service.create_run(payload, current_user)


def test_responsable_name_falls_back_to_free_text_when_no_user(
    db_session, production_service, current_user, process, raw_material, target_complement
):
    raw_material.current_stock = Decimal("2000")
    db_session.flush()
    run_read = _create_run(production_service, current_user, process, raw_material, target_complement, 10)
    run = production_service.repository.get_run(run_read.id)

    # Simula una corrida historica: fecha + nombre en texto, sin user_id.
    run.materials_approved_at = run.requested_at
    run.materials_approved_by_user_id = None
    run.materials_approved_responsable_name = "Santy"
    run.received_at = run.requested_at
    run.received_by_user_id = None
    run.received_responsable_name = "Rocío"
    db_session.flush()

    read = production_service._read_with_names(run)

    assert read.materials_approved_by_name == "Santy"
    assert read.received_by_name == "Rocío"


def test_responsable_name_prefers_real_user_over_free_text(
    db_session, production_service, current_user, process, raw_material, target_complement
):
    raw_material.current_stock = Decimal("2000")
    db_session.flush()
    run_read = _create_run(production_service, current_user, process, raw_material, target_complement, 10)
    approved = production_service.approve_materials(run_read.id, current_user)
    run = production_service.repository.get_run(approved.id)
    # Aunque hubiera un nombre en texto cargado por error, el usuario real gana.
    run.materials_approved_responsable_name = "Nombre que no deberia verse"
    db_session.flush()

    read = production_service._read_with_names(run)

    assert read.materials_approved_by_name == "jefe_test"


def test_event_lines_load_ordered_by_line_order(
    db_session, production_service, current_user, process, raw_material, target_complement
):
    raw_material.current_stock = Decimal("2000")
    db_session.flush()
    run_read = _create_run(production_service, current_user, process, raw_material, target_complement, 10)
    run = production_service.repository.get_run(run_read.id)
    run.event_lines.append(
        ProductionRunEventLine(side="ENTREGA", gramos=Decimal("5"), unidad="g", detalle="segunda", line_order=2)
    )
    run.event_lines.append(
        ProductionRunEventLine(side="ENTREGA", gramos=Decimal("10"), unidad="g", detalle="primera", line_order=1)
    )
    db_session.flush()
    db_session.expire_all()

    reloaded = production_service.repository.get_run(run_read.id)
    read = production_service._read_with_names(reloaded)

    assert [line.detalle for line in read.event_lines] == ["primera", "segunda"]
```

- [ ] **Step 2: Correr los tests y verificar que fallan**

Run: `docker exec erp_joyeria-api-1 python -m pytest backend/tests/production/test_historical_import.py -v`
Expected: FAIL — `materials_approved_by_name` sale `None` en vez de `"Santy"` (todavía no existe el fallback), y el tercer test falla porque `event_lines` no existe aún en `ProductionRunRead` hasta que Task 3/4 estén aplicadas. *(Si se ejecuta este task en orden después de 1-4, ese tercer assert ya debería andar — el que prueba el fallback real es el primero.)*

- [ ] **Step 3: Implementar el fallback**

En `backend/modules/production/service.py`, dentro de `_populate_run_names` (línea ~88-93):

```python
    for read, run in zip(reads, runs):
        read.created_by_name = name_for(run.created_by_user_id)
        read.started_by_name = name_for(run.started_by_user_id)
        read.materials_approved_by_name = (
            name_for(run.materials_approved_by_user_id) or run.materials_approved_responsable_name
        )
        read.received_by_name = name_for(run.received_by_user_id) or run.received_responsable_name
        read.rejected_by_name = name_for(run.rejected_by_user_id)
```

- [ ] **Step 4: Correr los tests y verificar que pasan**

Run: `docker exec erp_joyeria-api-1 python -m pytest backend/tests/production/test_historical_import.py -v`
Expected: 3 passed.

- [ ] **Step 5: Correr toda la suite de producción para confirmar que no rompiste nada**

Run: `docker exec erp_joyeria-api-1 python -m pytest backend/tests/production/ -v`
Expected: todos los tests existentes (`test_allocate_material.py`, `test_material_split.py`) siguen en passed.

- [ ] **Step 6: Commit**

```bash
git add backend/modules/production/service.py backend/tests/production/test_historical_import.py
git commit -m "feat(produccion): responsable en texto libre cae cuando no hay usuario real"
```

---

### Task 6: Script de import — parser del Excel + inserción con dry-run

**Files:**
- Create: `backend/scripts/import_historical_orders.py`
- Create: `backend/scripts/__init__.py` (si no existe ya un `__init__.py` en `backend/scripts/`)

**Interfaces:**
- Consumes: `backend.modules.database.session.SessionLocal`, modelos `ProductionRun`, `ProductionRunStage`, `ProductionRunEventLine`, `ProductionProcess`, `ProductionProcessStage`, `backend.modules.auth.models.AuthUser`, `backend.modules.inventory.models.InventoryItem`.
- Produces: función `parse_orders(xlsx_path: Path) -> list[HistoricalOrder]` (reusable/testeable sin DB) y el flujo `main()` de CLI.

- [ ] **Step 1: Verificar si existe `backend/scripts/__init__.py`**

Run: `ls "C:\Users\MSI I7\Desktop\Trabajo\Joyeria\RPSistema\ERP_joyeria\backend\scripts" 2>&1 || echo "no existe"`

Si no existe el directorio, crear `backend/scripts/__init__.py` vacío antes del siguiente paso.

- [ ] **Step 2: Escribir el script completo**

```python
"""Import de las 37 ordenes historicas de "Ordenes de Produccion.xlsx" como
production_runs reales (folio OP-2026-0001..0037). Ver
docs/superpowers/specs/2026-08-04-certificados-historicos-design.md.

Uso:
    python -m backend.scripts.import_historical_orders \
        --xlsx "C:/Users/MSI I7/Desktop/Trabajo/Joyeria/Ordenes de Producción.xlsx" \
        --created-by-username <username>
        [--commit]

Sin --commit corre en modo dry-run: parsea, resuelve material y usuario,
imprime el resumen, no escribe nada en la base.
"""
from __future__ import annotations

import argparse
import datetime as dt
from dataclasses import dataclass, field
from decimal import Decimal
from pathlib import Path
from uuid import UUID, uuid4

import openpyxl

from backend.modules.auth.models import AuthUser
from backend.modules.database.session import SessionLocal
from backend.modules.inventory.models import InventoryItem
from backend.modules.production.models import (
    ProductionProcess,
    ProductionProcessStage,
    ProductionRun,
    ProductionRunEventLine,
    ProductionRunStage,
    ProductionRunStageStatus,
    ProductionRunStatus,
)

SHEETS = ("1-18", "19-37")
PROCESS_NAME = "Producción histórica migrada"


@dataclass
class EventLine:
    gramos: Decimal
    detalle: str | None


@dataclass
class Event:
    fecha: dt.date | None
    lines: list[EventLine] = field(default_factory=list)


@dataclass
class HistoricalOrder:
    order_id: int
    order_name: str | None
    responsable: str | None
    material: str | None
    entrega_events: list[Event] = field(default_factory=list)
    recibido_events: list[Event] = field(default_factory=list)


def _parse_side_events(rows: list[tuple], start_index: int) -> tuple[list[Event], int]:
    """`start_index` apunta a la fila 'Entregado'/'Recibido'; la fila
    start_index+1 es el encabezado 'Fecha'. Devuelve los eventos (un grupo
    por cada fecha real, blancos se pegan al grupo anterior) y el indice de
    la siguiente fila sin consumir."""
    events: list[Event] = []
    j = start_index + 2
    while j < len(rows):
        row = rows[j]
        if row[0] in ("Tipo", "ID"):
            break
        cell = row[0]
        gramos_raw = row[1]
        detalle = row[2] if len(row) > 2 else None
        if isinstance(cell, dt.datetime):
            events.append(Event(fecha=cell.date()))
        if gramos_raw is not None and events:
            try:
                gramos = Decimal(str(gramos_raw))
            except Exception:
                gramos = None
            if gramos is not None:
                events[-1].lines.append(EventLine(gramos=gramos, detalle=str(detalle).strip() if detalle else None))
        elif gramos_raw is not None and not events:
            # Fila con gramos antes de cualquier fecha (no deberia pasar en
            # el archivo real, pero por si acaso arranca un grupo sin fecha).
            events.append(Event(fecha=None))
            try:
                events[-1].lines.append(EventLine(gramos=Decimal(str(gramos_raw)), detalle=str(detalle).strip() if detalle else None))
            except Exception:
                pass
        j += 1
    return events, j


def parse_orders(xlsx_path: Path) -> list[HistoricalOrder]:
    wb = openpyxl.load_workbook(xlsx_path, data_only=True)
    orders: list[HistoricalOrder] = []
    for sheet_name in SHEETS:
        ws = wb[sheet_name]
        rows = list(ws.iter_rows(min_row=1, max_row=ws.max_row, values_only=True))
        i = 0
        while i < len(rows):
            row = rows[i]
            if row[0] == "ID":
                header = rows[i + 1]
                order = HistoricalOrder(
                    order_id=int(header[0]),
                    order_name=(str(header[1]).strip() if header[1] else None),
                    responsable=(str(header[2]).strip() if header[2] else None),
                    material=(str(header[3]).strip() if header[3] else None),
                )
                j = i + 2
                while j < len(rows) and rows[j][0] != "ID":
                    if rows[j][0] == "Entregado":
                        order.entrega_events, j = _parse_side_events(rows, j)
                        continue
                    if rows[j][0] == "Recibido":
                        order.recibido_events, j = _parse_side_events(rows, j)
                        continue
                    j += 1
                orders.append(order)
                i = j
            else:
                i += 1
    orders.sort(key=lambda o: o.order_id)
    return orders


def _resolve_raw_material(session, name_hint: str) -> InventoryItem:
    from sqlalchemy import select

    candidates = list(
        session.execute(
            select(InventoryItem)
            .where(InventoryItem.item_type == "RAW_MATERIAL")
            .where(InventoryItem.name.ilike(f"%{name_hint}%"))
        ).scalars()
    )
    if len(candidates) != 1:
        names = ", ".join(c.name for c in candidates) or "(ninguno)"
        raise SystemExit(
            f"No se pudo resolver un unico item RAW_MATERIAL para '{name_hint}'. "
            f"Candidatos encontrados: {names}. Ajusta el filtro o crea/renombra el item primero."
        )
    return candidates[0]


def _resolve_user(session, username: str) -> AuthUser:
    from sqlalchemy import select

    user = session.execute(select(AuthUser).where(AuthUser.username == username)).scalar_one_or_none()
    if user is None:
        raise SystemExit(f"No existe ningun usuario con username '{username}'.")
    return user


def _get_or_create_process(session) -> ProductionProcess:
    from sqlalchemy import select

    existing = session.execute(
        select(ProductionProcess).where(ProductionProcess.name == PROCESS_NAME)
    ).scalar_one_or_none()
    if existing is not None:
        return existing
    process = ProductionProcess(
        name=PROCESS_NAME,
        description="Proceso generico para las ordenes migradas del Excel historico de papel.",
        waste_limit_percent=Decimal("100"),
        is_active=False,
        stages=[
            ProductionProcessStage(name="Entregado", stage_type="PROCESS", stage_order=1, is_active=True),
            ProductionProcessStage(name="Recibido", stage_type="PROCESS", stage_order=2, is_active=True),
        ],
    )
    session.add(process)
    session.flush()
    return process


def _next_folio_numbers(count: int) -> list[str]:
    return [f"OP-2026-{n:04d}" for n in range(1, count + 1)]


def build_runs_for_order(
    order: HistoricalOrder,
    folio: str,
    process: ProductionProcess,
    raw_material: InventoryItem,
    created_by_user_id: UUID,
) -> list[ProductionRun]:
    entrega_count = len(order.entrega_events)
    recibido_count = len(order.recibido_events)
    total = max(entrega_count, recibido_count, 1)

    runs: list[ProductionRun] = []
    for index in range(total):
        entrega = order.entrega_events[index] if index < entrega_count else None
        recibido = order.recibido_events[index] if index < recibido_count else None

        entrega_total = sum((line.gramos for line in entrega.lines), Decimal("0")) if entrega else Decimal("0")
        recibido_total = sum((line.gramos for line in recibido.lines), Decimal("0")) if recibido else Decimal("0")
        # raw_material_quantity_per_unit no se usa para mostrar (event_lines
        # lo reemplaza), pero es NOT NULL: se guarda el total entregado de
        # esta corrida (o 1 si no hay entrega) para que quantity=1 * eso siga
        # siendo un total_required_material internamente consistente.
        per_unit = entrega_total if entrega_total > 0 else Decimal("1")

        run = ProductionRun(
            id=uuid4(),
            process_id=process.id,
            process_name=order.order_name or f"Orden histórica {order.order_id}",
            quantity=Decimal("1"),
            status=ProductionRunStatus.RECEIVED if recibido else ProductionRunStatus.PENDING_RECEPTION,
            assembly_mode="ASIGNAR",
            raw_material_item_id=raw_material.id,
            raw_material_quantity_per_unit=per_unit,
            raw_material_unit_code=raw_material.unit_code,
            total_required_material=per_unit,
            waste_limit_percent=process.waste_limit_percent,
            expected_finished_weight=per_unit,
            actual_finished_weight=recibido_total if recibido else None,
            production_code=folio if index == 0 else f"{folio}-{chr(ord('A') + index)}",
            root_production_code=folio,
            created_by_user_id=created_by_user_id,
            requested_at=dt.datetime.combine(
                (entrega.fecha if entrega and entrega.fecha else (recibido.fecha if recibido and recibido.fecha else dt.date(2026, 1, 1))),
                dt.time(9, 0),
            ),
        )
        if entrega:
            run.materials_approved_at = dt.datetime.combine(entrega.fecha, dt.time(9, 0)) if entrega.fecha else run.requested_at
            run.materials_approved_responsable_name = order.responsable
            for line_order, line in enumerate(entrega.lines):
                run.event_lines.append(
                    ProductionRunEventLine(
                        side="ENTREGA",
                        gramos=line.gramos,
                        unidad=raw_material.unit_code,
                        detalle=line.detalle,
                        line_order=line_order,
                    )
                )
        if recibido:
            run.received_at = dt.datetime.combine(recibido.fecha, dt.time(9, 0)) if recibido.fecha else run.requested_at
            run.received_responsable_name = order.responsable
            for line_order, line in enumerate(recibido.lines):
                run.event_lines.append(
                    ProductionRunEventLine(
                        side="RECEPCION",
                        gramos=line.gramos,
                        unidad=raw_material.unit_code,
                        detalle=line.detalle,
                        line_order=line_order,
                    )
                )
        run.stages = [
            ProductionRunStage(
                source_stage_id=stage.id,
                stage_name=stage.name,
                stage_type=stage.stage_type,
                stage_order=stage.stage_order,
                status=ProductionRunStageStatus.FINISHED,
                stage_code=f"{run.production_code}-{stage.stage_order}",
            )
            for stage in sorted(process.stages, key=lambda s: s.stage_order)
        ]
        runs.append(run)
    return runs


def main() -> None:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--xlsx", type=Path, required=True)
    parser.add_argument("--created-by-username", type=str, required=True)
    parser.add_argument("--commit", action="store_true", help="Sin esta flag corre en modo dry-run.")
    args = parser.parse_args()

    orders = parse_orders(args.xlsx)
    print(f"Ordenes parseadas del Excel: {len(orders)}")

    session = SessionLocal()
    try:
        user = _resolve_user(session, args.created_by_username)
        raw_material = _resolve_raw_material(session, "plata")
        process = _get_or_create_process(session)
        folios = _next_folio_numbers(len(orders))

        all_runs: list[ProductionRun] = []
        for order, folio in zip(orders, folios):
            runs = build_runs_for_order(order, folio, process, raw_material, user.id)
            all_runs.extend(runs)
            entrega_n = len(order.entrega_events)
            recibido_n = len(order.recibido_events)
            print(
                f"  {folio}: orden Excel #{order.order_id} '{order.order_name}' — "
                f"{len(runs)} corrida(s) ({entrega_n} entregas, {recibido_n} recepciones)"
            )

        print()
        print(f"Material mapeado: '{raw_material.name}' ({raw_material.id})")
        print(f"Proceso: '{process.name}' ({process.id})")
        print(f"Usuario: '{user.username}' ({user.id})")
        print(f"Total corridas a insertar: {len(all_runs)}")
        print(f"Rango de folios raiz: {folios[0]} .. {folios[-1]}")

        if not args.commit:
            print()
            print("Modo dry-run: no se escribio nada. Corre de nuevo con --commit para confirmar.")
            session.rollback()
            return

        for run in all_runs:
            session.add(run)
        session.commit()
        print()
        print(f"Listo: {len(all_runs)} corridas insertadas.")
    finally:
        session.close()


if __name__ == "__main__":
    main()
```

- [ ] **Step 3: Test del parser puro (sin DB) — escribir el test primero**

Crear `backend/tests/production/test_historical_import_parser.py`:

```python
from pathlib import Path

from backend.scripts.import_historical_orders import parse_orders

XLSX_PATH = Path(r"C:\Users\MSI I7\Desktop\Trabajo\Joyeria\Ordenes de Producción.xlsx")


def test_parses_37_orders():
    orders = parse_orders(XLSX_PATH)
    assert len(orders) == 37
    assert [o.order_id for o in orders] == list(range(1, 38))


def test_order_1_medallas_shape():
    orders = parse_orders(XLSX_PATH)
    order = next(o for o in orders if o.order_id == 1)
    assert order.order_name == "Medallas"
    assert order.responsable == "Santy"
    assert len(order.entrega_events) == 2
    assert len(order.recibido_events) == 1
    assert len(order.recibido_events[0].lines) == 11


def test_order_8_asymmetric_event_counts():
    orders = parse_orders(XLSX_PATH)
    order = next(o for o in orders if o.order_id == 8)
    assert len(order.entrega_events) == 3
    assert len(order.recibido_events) == 5
```

- [ ] **Step 4: Correr el test del parser**

Run: `docker exec erp_joyeria-api-1 python -m pytest backend/tests/production/test_historical_import_parser.py -v`
Expected: 3 passed. *(Si algun conteo no calza exacto con lo que arme el parser, ajustar `_parse_side_events` hasta que los 3 tests pasen — los numeros de `order 1` y `order 8` ya se verificaron manualmente contra el Excel real durante el diseño.)*

- [ ] **Step 5: Correr en modo dry-run contra la base real y revisar el resumen con el usuario**

Run:
```
docker exec erp_joyeria-api-1 python -m backend.scripts.import_historical_orders \
  --xlsx "/tmp/ordenes.xlsx" \
  --created-by-username <username que confirme Rodrigo>
```

(Copiar antes el xlsx al contenedor: `docker cp "Joyeria/Ordenes de Producción.xlsx" erp_joyeria-api-1:/tmp/ordenes.xlsx`)

Expected: imprime las 37 líneas de resumen, material y usuario resueltos, termina en "Modo dry-run: no se escribió nada". **No pasar a `--commit` sin que el usuario revise y apruebe esta salida.**

- [ ] **Step 6: Commit**

```bash
git add backend/scripts/import_historical_orders.py backend/scripts/__init__.py backend/tests/production/test_historical_import_parser.py
git commit -m "feat(produccion): script de import de ordenes historicas del Excel"
```

---

### Task 7: Frontend — tipo `ProductionRun.event_lines`

**Files:**
- Modify: `frontend/types/production/index.ts`

**Interfaces:**
- Consumes: nada (solo tipos).
- Produces: `ProductionRun["event_lines"]: Array<{ side: "ENTREGA" | "RECEPCION"; gramos: string; unidad: string; detalle: string | null; line_order: number }>`.

- [ ] **Step 1: Agregar el campo**

Junto al campo `complements` de `ProductionRun` (línea ~143 según la última lectura), agregar:

```typescript
  event_lines?: Array<{ side: "ENTREGA" | "RECEPCION"; gramos: string; unidad: string; detalle: string | null; line_order: number }>;
```

- [ ] **Step 2: Verificar tipos**

Run: `cd frontend && npx tsc --noEmit -p .`
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add frontend/types/production/index.ts
git commit -m "feat(produccion): tipo event_lines en ProductionRun"
```

---

### Task 8: `buildOrdenProduccion` usa `event_lines` cuando existen; `cantidad` nullable

**Files:**
- Modify: `frontend/lib/orden-produccion.ts`

**Interfaces:**
- Consumes: `run.event_lines` (Task 7).
- Produces: `OrdenProduccionModel.cantidad: number | null` (cambia de `number` — todo consumidor debe tolerar `null`, ver Task 9).

- [ ] **Step 1: Cambiar el tipo de `cantidad`**

```typescript
export type OrdenProduccionModel = {
  folio: string;
  procesoNombre: string;
  cantidad: number | null;
  categoria: string;
  responsableProduccion: string;
  entrega: DocSide[];
  recepcion: DocSide[];
  cancelada: boolean;
};
```

- [ ] **Step 2: Usar `event_lines` en la construcción de `entrega`/`recepcion`, y calcular `cantidad`**

Reemplazar el cuerpo de `buildOrdenProduccion` (desde `const entrega: DocSide[] = [];` hasta el `return`):

```typescript
  const entrega: DocSide[] = [];
  const recepcion: DocSide[] = [];
  const isHistorical = family.some((run) => (run.event_lines ?? []).length > 0);

  for (const run of family) {
    const entregaLines = (run.event_lines ?? []).filter((line) => line.side === "ENTREGA");
    if (run.materials_approved_at !== null) {
      const rows: DocRow[] =
        entregaLines.length > 0
          ? entregaLines.map((line) => ({ gramos: num(line.gramos), unidad: line.unidad, detalle: line.detalle ?? "" }))
          : [{ gramos: num(run.total_required_material), unidad: materialUnit, detalle: materialName }];
      if (entregaLines.length === 0) {
        for (const supply of run.supply_consumptions ?? []) {
          rows.push({
            gramos: num(supply.quantity),
            unidad: supply.unit_code || "g",
            detalle: `Insumo: ${supply.name}`
          });
        }
      }
      entrega.push({
        fecha: run.materials_approved_at,
        responsable: run.materials_approved_by_name ?? DASH,
        rows
      });
    }

    const recepcionLines = (run.event_lines ?? []).filter((line) => line.side === "RECEPCION");
    if (run.received_at !== null) {
      const rows: DocRow[] =
        recepcionLines.length > 0
          ? recepcionLines.map((line) => ({ gramos: num(line.gramos), unidad: line.unidad, detalle: line.detalle ?? "" }))
          : [];
      if (recepcionLines.length === 0) {
        if (run.actual_finished_weight !== null) {
          rows.push({
            gramos: num(run.actual_finished_weight),
            unidad: materialUnit,
            detalle: `Producto terminado: ${run.process_name}`
          });
        }
        for (const product of run.products ?? []) {
          rows.push({
            gramos: num(product.quantity),
            unidad: "und",
            detalle: `Producto final: ${product.product_name ?? "—"}`
          });
        }
      }
      recepcion.push({
        fecha: run.received_at,
        responsable: run.received_by_name ?? DASH,
        rows
      });
    }
  }

  return {
    folio: root.root_production_code ?? root.production_code ?? DASH,
    procesoNombre: root.process_name,
    cantidad: isHistorical ? null : family.reduce((total, run) => total + num(run.quantity), 0),
    categoria: materialName,
    responsableProduccion: root.created_by_name ?? DASH,
    entrega,
    recepcion,
    cancelada: family.every((run) => run.status === "CANCELADA")
  };
```

- [ ] **Step 3: Verificar tipos**

Run: `cd frontend && npx tsc --noEmit -p .`
Expected: falla en `orden-produccion-doc.tsx` (línea `Cantidad: {model.cantidad}`) — esperado, se arregla en el próximo task.

- [ ] **Step 4: Commit (junto con Task 9, o commit intermedio si preferís separarlo)**

```bash
git add frontend/lib/orden-produccion.ts
git commit -m "feat(produccion): buildOrdenProduccion usa event_lines cuando existen, cantidad nullable"
```

---

### Task 9: Ocultar "Cantidad" cuando es `null`

**Files:**
- Modify: `frontend/components/documentos/orden-produccion-doc.tsx`

**Interfaces:**
- Consumes: `OrdenProduccionModel.cantidad: number | null` (Task 8).

- [ ] **Step 1: Cambiar el render de la línea de cantidad**

```tsx
        <div className="opResponsable">
          RESPONSABLE PRODUCCIÓN: <span>{model.responsableProduccion}</span>
          {model.cantidad !== null ? <span className="opCantidad">Cantidad: {model.cantidad}</span> : null}
        </div>
```

- [ ] **Step 2: Verificar tipos**

Run: `cd frontend && npx tsc --noEmit -p .`
Expected: exit 0.

- [ ] **Step 3: Commit**

```bash
git add frontend/components/documentos/orden-produccion-doc.tsx
git commit -m "fix(documentos): ocultar linea de cantidad cuando no aplica (ordenes historicas)"
```

---

### Task 10: Documentos — buscador + filtro Todas/En vivo/Históricas + agrupación por mes

**Files:**
- Modify: `frontend/components/documentos/documentos-dashboard.tsx`

**Interfaces:**
- Consumes: `groupRunFamilies`, `ProductionRun.event_lines` (Task 7).
- Produces: sin cambios de API pública del componente (`DocumentosDashboard` sigue sin props).

- [ ] **Step 1: Agregar estado de búsqueda/filtro y helpers de clasificación**

Después de `const [printMode, setPrintMode] = useState<DocMode | null>(null);`:

```typescript
  const [search, setSearch] = useState("");
  const [kindFilter, setKindFilter] = useState<"ALL" | "LIVE" | "HISTORICAL">("ALL");

  function isHistoricalFamily(family: ProductionRun[]): boolean {
    return family.some((run) => (run.event_lines ?? []).length > 0);
  }

  function familyMonthKey(family: ProductionRun[]): string {
    const root = family.find((run) => !run.parent_run_id) ?? family[0];
    const date = new Date(root.requested_at);
    if (Number.isNaN(date.getTime())) return "Sin fecha";
    return date.toLocaleDateString("es-EC", { month: "long", year: "numeric" });
  }
```

- [ ] **Step 2: Filtrar y agrupar `familyList` por mes antes de renderizar la lista**

Reemplazar:
```typescript
  const familyList = useMemo(() => Array.from(families.entries()), [families]);
```
por:
```typescript
  const familyList = useMemo(() => {
    const term = search.trim().toLowerCase();
    return Array.from(families.entries()).filter(([key, family]) => {
      const historical = isHistoricalFamily(family);
      if (kindFilter === "LIVE" && historical) return false;
      if (kindFilter === "HISTORICAL" && !historical) return false;
      if (!term) return true;
      const root = family.find((run) => !run.parent_run_id) ?? family[0];
      const haystack = [
        key,
        root.process_name,
        root.created_by_name ?? "",
        root.materials_approved_by_name ?? "",
        root.received_by_name ?? ""
      ].join(" ").toLowerCase();
      return haystack.includes(term);
    });
  }, [families, search, kindFilter]);

  const familyGroups = useMemo(() => {
    const groups = new Map<string, Array<[string, ProductionRun[]]>>();
    for (const entry of familyList) {
      const monthKey = familyMonthKey(entry[1]);
      const list = groups.get(monthKey) ?? [];
      list.push(entry);
      groups.set(monthKey, list);
    }
    return Array.from(groups.entries());
  }, [familyList]);
```

- [ ] **Step 3: Agregar los controles de búsqueda/filtro y renderizar agrupado por mes**

Reemplazar el bloque `<div className="documentosList">...{familyList.map(...)}...</div>` completo por:

```tsx
          <div className="documentosList">
            <div style={{ display: "grid", gap: 8, marginBottom: 4 }}>
              <input
                aria-label="Buscar por folio, proceso o responsable"
                className="field"
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Buscar folio, proceso, responsable..."
                type="text"
                value={search}
              />
              <div style={{ display: "flex", gap: 6 }}>
                {(["ALL", "LIVE", "HISTORICAL"] as const).map((option) => (
                  <button
                    className={`button${kindFilter === option ? " buttonPrimary" : ""}`}
                    key={option}
                    onClick={() => setKindFilter(option)}
                    type="button"
                  >
                    {option === "ALL" ? "Todas" : option === "LIVE" ? "En vivo" : "Históricas"}
                  </button>
                ))}
              </div>
            </div>
            {isLoading ? <div className="emptyState">Cargando órdenes...</div> : null}
            {!isLoading && runs.length === 0 ? (
              <div className="emptyState">No hay órdenes registradas.</div>
            ) : null}
            {!isLoading && runs.length > 0 && familyList.length === 0 ? (
              <div className="emptyState">Ninguna orden coincide con la búsqueda/filtro.</div>
            ) : null}
            {familyGroups.map(([monthLabel, entries]) => (
              <div key={monthLabel} style={{ display: "grid", gap: 6 }}>
                <span style={{ fontSize: 12, fontWeight: 800, color: "var(--muted)", textTransform: "uppercase", marginTop: 6 }}>
                  {monthLabel}
                </span>
                {entries.map(([key, family]) => {
                  const isSel = key === selectedKey;
                  const root = family.find((run) => !run.parent_run_id) ?? family[0];
                  const receivedCount = family.filter((run) => run.status === "RECIBIDA").length;
                  const statusText =
                    family.length === 1
                      ? STATUS_LABEL[family[0].status]
                      : `${receivedCount}/${family.length} recibidas`;
                  return (
                    <button
                      className={`processPicker${isSel ? " processPickerActive" : ""}`}
                      key={key}
                      onClick={() => setSelectedKey(key)}
                      type="button"
                    >
                      <span style={{ display: "grid", gap: 2, textAlign: "left" }}>
                        <strong style={{ color: "var(--text)", fontSize: 14 }}>
                          {key} · {root.process_name}
                        </strong>
                        <span>{statusText}</span>
                      </span>
                    </button>
                  );
                })}
              </div>
            ))}
          </div>
```

- [ ] **Step 4: Verificar tipos**

Run: `cd frontend && npx tsc --noEmit -p .`
Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add frontend/components/documentos/documentos-dashboard.tsx
git commit -m "feat(documentos): buscador, filtro en vivo/historicas y agrupacion por mes"
```

---

### Task 11: Import real (ejecución asistida, no automática)

**Files:** ninguno — este task es operativo, no de código.

- [ ] **Step 1: Confirmar con el usuario el username de la cuenta a usar como `created_by`** (ya definido: su propia cuenta admin — pedirle el `username` exacto en ese momento).

- [ ] **Step 2: Copiar el Excel al contenedor y correr el dry-run**

```bash
docker cp "Joyeria/Ordenes de Producción.xlsx" erp_joyeria-api-1:/tmp/ordenes.xlsx
docker exec erp_joyeria-api-1 python -m backend.scripts.import_historical_orders \
  --xlsx /tmp/ordenes.xlsx --created-by-username <username>
```

- [ ] **Step 3: Mostrarle el resumen al usuario y esperar su confirmación explícita** antes de agregar `--commit`.

- [ ] **Step 4: Correr con `--commit`**

```bash
docker exec erp_joyeria-api-1 python -m backend.scripts.import_historical_orders \
  --xlsx /tmp/ordenes.xlsx --created-by-username <username> --commit
```

- [ ] **Step 5: Verificación manual (checklist de la spec)**

1. Documentos → buscar folio `OP-2026-0001`, confirmar que aparece.
2. Buscar "Santy", confirmar que filtra.
3. Abrir orden 16 ("Fundir 1 Barra") — un evento por lado, sin fila de responsable de más.
4. Abrir orden 8 ("Máquinas") — 3 entregas / 5 recepciones, cada una con su fecha/responsable/líneas propias.
5. Crear una orden nueva en vivo, confirmar que sale `OP-2026-0038`.
6. Kardex de Plata: confirmar que `current_stock` no cambió por el import.

---

## Self-Review

**Cobertura de la spec:** folio real (Task 6/11) ✓, familia asimétrica (Task 6 `build_runs_for_order`) ✓, `production_run_event_lines` (Task 1-4) ✓, responsable en texto (Task 2, 5) ✓, proceso genérico (Task 6 `_get_or_create_process`) ✓, material Plata resuelto por nombre (Task 6 `_resolve_raw_material`) ✓, cantidad oculta (Task 8-9) ✓, estado RECIBIDA/PENDIENTE_RECEPCION por corrida (Task 6) ✓, sin movimientos de inventario (Task 6 nunca llama `inventory_service`) ✓, import único con dry-run (Task 6 Step 5, Task 11) ✓, `created_by_user_id` real (Task 6 `--created-by-username`, Task 11) ✓, filtro/búsqueda en Documentos (Task 10) ✓.

**Placeholders:** ninguno — cada step tiene código completo o comando exacto.

**Consistencia de tipos:** `ProductionRunEventLine.side` es `String(20)` en el modelo (Task 2) y se usa como literal `"ENTREGA"`/`"RECEPCION"` en el script (Task 6) y el frontend (Task 7-8) — coincide. `event_lines` como nombre de relación/campo es igual en modelo (Task 2), schema (Task 3) y tipo frontend (Task 7). `materials_approved_responsable_name`/`received_responsable_name` iguales en modelo (Task 2), migración (Task 1) y service (Task 5).
