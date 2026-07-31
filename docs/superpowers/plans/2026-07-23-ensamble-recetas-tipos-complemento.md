# Ensamble con Recetas y Tipos de Complemento (v2) — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Orden de producción con modo Asignar/Ensamblar, recetas de ensamble aprendidas del primer ensamble manual, tipos de complemento con manager y drill-down, pickers visuales en lugar de combos, y complementos elegibles en el import XML.

**Architecture:** Se construye SOBRE la rama `feat/orden-unificada-complementos` (v1 completa). Cuatro tablas nuevas + columnas en tres tablas existentes. El auto-ensamble corre en `_finish_run`; el ensamble manual es un endpoint nuevo que además guarda la receta. La recepción no cambia de mecánica (lote → conversión), solo gana el destino por pieza y el bloqueo mientras falte definir el ensamble.

**Tech Stack:** FastAPI + SQLAlchemy 2.0 + Alembic + Pydantic v2; Next.js + React + TanStack Query. Docker: **solo `exec`, nunca up/down/restart**; stack actualmente APAGADO → verificación estática (`py_compile`, `tsc --noEmit` con node_modules ya instalado en host).

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-23-ensamble-recetas-tipos-complemento-design.md` (y v1 para lo que no cambia).
- Todo cambio de stock vía movimientos; el ensamble NO genera movimientos nuevos de complementos (ya descontados al aprobar materiales) — solo registra la combinación.
- Permisos en backend: producción define ensamble; mantenimiento/admin gestiona tipos de complemento; inventario recibe.
- Sin pytest (no existe infra de tests); verificación = `python -m py_compile` + `npx tsc --noEmit` (hoy en CERO errores — debe seguir así al final de cada task frontend).
- Comentarios y UI en español, terse, siguiendo el idiom de cada archivo.
- No inventar datos en BD. `pg_dump` antes de migrar (pendiente de stack, con la migración v1).
- Estados de ensamble: `assembly_mode` ∈ {`ASIGNAR`,`ENSAMBLAR`} (default `ASIGNAR`); `assembly_pending` bool.

---

### Task 1: Migración v2 + modelos backend

**Files:**
- Modify: `backend/modules/inventory/models.py` (ComplementType + columna en InventoryItem)
- Modify: `backend/modules/production/models.py` (recetas, assembly items, columnas de run y de plan)
- Create: `backend/alembic/versions/f4a5b6c7d8e9_ensamble_recetas_tipos_complemento.py`

**Interfaces:**
- Produces:
  - `ComplementType` (tabla `complement_types`: id, name String(120) único, is_active bool, created_at) en inventory/models.py.
  - `InventoryItem.complement_type_id: UUID | None` (FK `complement_types.id`, ondelete SET NULL).
  - `AssemblyRecipe` (tabla `assembly_recipes`: id, product_type_id FK único ondelete CASCADE, updated_at) con relationship `items` → `AssemblyRecipeItem` (tabla `assembly_recipe_items`: id, recipe_id FK CASCADE, complement_item_id UUID, quantity_per_unit Numeric(14,4)).
  - `ProductionRunAssemblyItem` (tabla `production_run_assembly_items`: id, run_id FK CASCADE index, complement_item_id UUID, quantity Numeric(14,4)) + relationship `ProductionRun.assembly_items` (cascade delete-orphan).
  - `ProductionRun.assembly_mode: str` (String(20), default `"ASIGNAR"`), `ProductionRun.assembly_pending: bool` (default False).
  - `ProductionRunProduct.product_type_id` → nullable; nueva `ProductionRunProduct.target_item_id: UUID | None` (sin FK cruzada de módulo: UUID plano, como los demás item_id de production).
  - Constantes `AssemblyMode.ASSIGN = "ASIGNAR"`, `AssemblyMode.ASSEMBLE = "ENSAMBLAR"` en production/models.py.

- [ ] **Step 1: Modelos**

En `backend/modules/inventory/models.py` (seguir el estilo del archivo; imports ya existentes):

```python
class ComplementType(Base):
    """Tipo de complemento para organizar la pestaña Complementos
    (ej. complementos de cadenas, de aretes). Solo catalogo, no inventario."""

    __tablename__ = "complement_types"

    id: Mapped[PyUUID] = mapped_column(PG_UUID(as_uuid=True), primary_key=True, default=uuid4)
    name: Mapped[str] = mapped_column(String(120), nullable=False, unique=True)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)
```

En `InventoryItem` agregar junto a los demás campos opcionales:

```python
    # Tipo de complemento (solo items COMPLEMENT): organiza la pestaña por grupos.
    complement_type_id: Mapped[PyUUID | None] = mapped_column(
        ForeignKey("complement_types.id", ondelete="SET NULL"), nullable=True
    )
```

(Verificar que `ForeignKey`, `Boolean`, `DateTime`, `String`, `datetime`, `uuid4` estén importados; agregar los que falten.)

En `backend/modules/production/models.py`, junto a `ProductionRunStatus`:

```python
class AssemblyMode:
    ASSIGN = "ASIGNAR"
    ASSEMBLE = "ENSAMBLAR"
```

En `ProductionRun` agregar columnas (junto a `status`) y relationship (junto a `products`):

```python
    # Modo de la orden: ASIGNAR (split directo) o ENSAMBLAR (con complementos).
    assembly_mode: Mapped[str] = mapped_column(String(20), nullable=False, default=AssemblyMode.ASSIGN)
    # ENSAMBLAR sin receta aplicable: producción debe definir la combinación
    # antes de que inventario pueda recibir.
    assembly_pending: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
```

```python
    # Combinación de complementos aplicada al ensamble (cantidades totales).
    assembly_items: Mapped[list["ProductionRunAssemblyItem"]] = relationship(
        back_populates="run",
        cascade="all, delete-orphan",
    )
```

En `ProductionRunProduct`: `product_type_id` pasa a `nullable=True` y se agrega:

```python
    # Destino por pieza existente del inventario (opcional; excluyente con
    # product_type_id — exactamente uno de los dos).
    target_item_id: Mapped[PyUUID | None] = mapped_column(PG_UUID(as_uuid=True), nullable=True)
```

Al final del archivo:

```python
class AssemblyRecipe(Base):
    """Receta de ensamble por tipo de producto: qué complementos y cuántos POR
    UNIDAD. Se aprende del primer ensamble manual y luego aplica sola."""

    __tablename__ = "assembly_recipes"

    id: Mapped[PyUUID] = mapped_column(PG_UUID(as_uuid=True), primary_key=True, default=uuid4)
    product_type_id: Mapped[PyUUID] = mapped_column(
        ForeignKey("product_types.id", ondelete="CASCADE"), nullable=False, unique=True
    )
    updated_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)

    items: Mapped[list["AssemblyRecipeItem"]] = relationship(
        back_populates="recipe",
        cascade="all, delete-orphan",
    )


class AssemblyRecipeItem(Base):
    __tablename__ = "assembly_recipe_items"

    id: Mapped[PyUUID] = mapped_column(PG_UUID(as_uuid=True), primary_key=True, default=uuid4)
    recipe_id: Mapped[PyUUID] = mapped_column(
        ForeignKey("assembly_recipes.id", ondelete="CASCADE"), nullable=False, index=True
    )
    complement_item_id: Mapped[PyUUID] = mapped_column(PG_UUID(as_uuid=True), nullable=False)
    quantity_per_unit: Mapped[Decimal] = mapped_column(Numeric(14, 4), nullable=False)

    recipe: Mapped["AssemblyRecipe"] = relationship(back_populates="items")


class ProductionRunAssemblyItem(Base):
    __tablename__ = "production_run_assembly_items"

    id: Mapped[PyUUID] = mapped_column(PG_UUID(as_uuid=True), primary_key=True, default=uuid4)
    run_id: Mapped[PyUUID] = mapped_column(
        ForeignKey("production_runs.id", ondelete="CASCADE"), nullable=False, index=True
    )
    complement_item_id: Mapped[PyUUID] = mapped_column(PG_UUID(as_uuid=True), nullable=False)
    quantity: Mapped[Decimal] = mapped_column(Numeric(14, 4), nullable=False)

    run: Mapped["ProductionRun"] = relationship(back_populates="assembly_items")
```

- [ ] **Step 2: Migración**

`backend/alembic/versions/f4a5b6c7d8e9_ensamble_recetas_tipos_complemento.py` — `down_revision = "e3f4a5b6c7d8"` (confirmar que sigue siendo head con grep en versions/):

```python
"""ensamble: recetas, tipos de complemento y modo de orden

Revision ID: f4a5b6c7d8e9
Revises: e3f4a5b6c7d8
Create Date: 2026-07-23
"""
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "f4a5b6c7d8e9"
down_revision = "e3f4a5b6c7d8"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "complement_types",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("name", sa.String(120), nullable=False, unique=True),
        sa.Column("is_active", sa.Boolean(), nullable=False, server_default=sa.true()),
        sa.Column("created_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.add_column(
        "inventory_items",
        sa.Column(
            "complement_type_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("complement_types.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )
    op.create_table(
        "assembly_recipes",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "product_type_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("product_types.id", ondelete="CASCADE"),
            nullable=False,
            unique=True,
        ),
        sa.Column("updated_at", sa.DateTime(timezone=True), nullable=False, server_default=sa.func.now()),
    )
    op.create_table(
        "assembly_recipe_items",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "recipe_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("assembly_recipes.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column("complement_item_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("quantity_per_unit", sa.Numeric(14, 4), nullable=False),
    )
    op.create_table(
        "production_run_assembly_items",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "run_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("production_runs.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column("complement_item_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("quantity", sa.Numeric(14, 4), nullable=False),
    )
    op.add_column(
        "production_runs",
        sa.Column("assembly_mode", sa.String(20), nullable=False, server_default="ASIGNAR"),
    )
    op.add_column(
        "production_runs",
        sa.Column("assembly_pending", sa.Boolean(), nullable=False, server_default=sa.false()),
    )
    op.alter_column("production_run_products", "product_type_id", nullable=True)
    op.add_column(
        "production_run_products",
        sa.Column("target_item_id", postgresql.UUID(as_uuid=True), nullable=True),
    )


def downgrade() -> None:
    op.drop_column("production_run_products", "target_item_id")
    op.alter_column("production_run_products", "product_type_id", nullable=False)
    op.drop_column("production_runs", "assembly_pending")
    op.drop_column("production_runs", "assembly_mode")
    op.drop_table("production_run_assembly_items")
    op.drop_table("assembly_recipe_items")
    op.drop_table("assembly_recipes")
    op.drop_column("inventory_items", "complement_type_id")
    op.drop_table("complement_types")
```

- [ ] **Step 3: Compilar** — `python -m py_compile backend/modules/inventory/models.py backend/modules/production/models.py backend/alembic/versions/f4a5b6c7d8e9_ensamble_recetas_tipos_complemento.py` → sin errores. (Migración NO se aplica: stack apagado.)

- [ ] **Step 4: Commit** — `feat(db): recetas de ensamble, tipos de complemento y modo de orden`

---

### Task 2: CRUD de tipos de complemento + campo en items (backend)

**Files:**
- Modify: `backend/modules/inventory/schemas.py`, `backend/modules/inventory/service.py`, `backend/modules/inventory/router.py`

**Interfaces:**
- Produces:
  - Schemas: `ComplementTypeCreate {name: str min1 max120}`, `ComplementTypeRead {id, name, is_active}` (from_attributes).
  - `InventoryItemCreate/Update/Read` ganan `complement_type_id: UUID | None = None`.
  - Service: `list_complement_types()`, `create_complement_type(payload)`, `update_complement_type(id, payload)`, `delete_complement_type(id)` (delete: 409 si hay items COMPLEMENT usándolo — contarlos con select; mensaje en español). `create_item`/`update_item` persisten `complement_type_id` (validar que exista y esté activo cuando venga, y que el item sea COMPLEMENT; si el item no es COMPLEMENT, ignorar/anular el campo).
  - Router: `GET/POST /complement-types`, `PUT/DELETE /complement-types/{type_id}` con el mismo patrón de permisos que los endpoints de items existentes en ese router (copiar el decorador/dependencia de un CRUD vecino, p.ej. el de items).

- [ ] **Step 1: Schemas** (código conforme a interfaces; espejo de patrones existentes del archivo, `extra="forbid"`).
- [ ] **Step 2: Service** (validaciones y mensajes en español; ver regla delete arriba; import `ComplementType` desde models).
- [ ] **Step 3: Router** (espejo de endpoints de items: mismo manejo de errores Domain→409 / NotFound→404).
- [ ] **Step 4: Compilar** — py_compile de los tres archivos.
- [ ] **Step 5: Commit** — `feat(inventario): crud de tipos de complemento y campo en items`

---

### Task 3: create_run v2 — modo, destino por pieza y validaciones (backend)

**Files:**
- Modify: `backend/modules/production/schemas.py`, `backend/modules/production/service.py`

**Interfaces:**
- Consumes: `AssemblyMode`, columnas nuevas (Task 1).
- Produces:
  - `RunProductCreate`: `product_type_id: UUID | None = None`, `target_item_id: UUID | None = None`, `quantity` igual; model_validator (Pydantic v2 `@model_validator(mode="after")`) exige exactamente uno de los dos.
  - `ProductionRunCreate.assembly_mode: Literal["ASIGNAR", "ENSAMBLAR"] = "ASIGNAR"`.
  - `RunProductRead` gana `target_item_id: UUID | None = None` y `product_name` se llena también para piezas (nombre/descr de la pieza).
  - `ProductionRunRead` gana `assembly_mode: str`, `assembly_pending: bool`, `assembly_items: list[RunAssemblyItemRead]` (`{id, complement_item_id, name: str | None, quantity: Decimal}`).
  - `_validate_run_products(process, quantity, products, assembly_mode)`:
    - fila con `target_item_id`: el item existe, `item_type == "FINISHED_PRODUCT"`, `product_code` de 7 dígitos (mensaje si no); el check de tipos permitidos del proceso aplica solo a filas con `product_type_id`.
    - `ASIGNAR`: ≥1 fila, suma == quantity (igual que hoy).
    - `ENSAMBLAR`: exactamente 1 fila y su quantity == quantity de la orden (mensaje claro si no).
  - `create_run` setea `assembly_mode` y `target_item_id` en las filas; `_attach_plan_names` resuelve nombre también desde `target_item_id` (descripción o nombre de la pieza, mismo criterio que la UI: `(description or '').strip() or name`).

- [ ] **Step 1: Schemas** (validator one-of con mensaje español).
- [ ] **Step 2: Service** (validaciones + creación + attach de nombres para piezas: una query batch por `target_item_id`s, igual que el batch existente de tipos).
- [ ] **Step 3: Compilar** — py_compile schemas + service.
- [ ] **Step 4: Commit** — `feat(produccion): modo asignar/ensamblar y destino por pieza en el plan`

---

### Task 4: Auto-ensamble, ensamble manual con receta y bloqueo de recepción (backend)

**Files:**
- Modify: `backend/modules/production/service.py`, `backend/modules/production/schemas.py`, `backend/modules/production/router.py`

**Interfaces:**
- Consumes: `AssemblyRecipe`, `AssemblyRecipeItem`, `ProductionRunAssemblyItem`, `ComplementRequestStatus` (v1).
- Produces:
  - Schema `RunAssemblyDefine { items: list[RunAssemblyLineCreate] min1 }`, `RunAssemblyLineCreate { complement_item_id: UUID, quantity_per_unit: Decimal gt 0 }`.
  - Helper `_resolve_plan_product_type_id(run) -> UUID | None`: del plan (modo ENSAMBLAR hay 1 fila): si la fila tiene `product_type_id` → ese; si tiene `target_item_id` → buscar la pieza y empatar `ProductType` con `category_code == product_code[1:3]` y `model_code == product_code[3:7]` (None si no empata).
  - En `_finish_run(run, final_weight)`: al final, si `run.assembly_mode == AssemblyMode.ASSEMBLE`:
    1. `type_id = self._resolve_plan_product_type_id(run)`; receta = select AssemblyRecipe por type_id (con items) si type_id.
    2. Complementos aprobados de la orden: dict `{item_id: sum(quantity)}` de `run.complements` con status APROBADA.
    3. Si hay receta y PARA CADA item de la receta `quantity_per_unit * run.quantity <= aprobado[item]` → crear `ProductionRunAssemblyItem(complement_item_id, quantity=quantity_per_unit * run.quantity)` por item, `assembly_pending = False`. Si no (sin receta o no cubre) → `assembly_pending = True`.
  - `define_run_assembly(run_id, payload, current_user)`:
    - run existe; `assembly_mode == ENSAMBLAR`; `status == PENDIENTE_RECEPCION`; `assembly_pending` True (si ya está definida → 409 "El ensamble ya está definido.").
    - Sin repetidos; cada `complement_item_id` debe estar entre los complementos APROBADOS de la orden; `quantity_per_unit * run.quantity <= cantidad aprobada` de ese item (mensaje con el nombre del item).
    - Reemplaza `run.assembly_items` con los totales; `assembly_pending = False`.
    - Guarda receta: si `_resolve_plan_product_type_id(run)` devuelve type_id → upsert `AssemblyRecipe` de ese tipo (reemplazar items con los `quantity_per_unit` del payload, `updated_at = utcnow`). Si no hay type_id, no se guarda receta (la combinación de la orden queda registrada igual).
  - `receive_finished_product`: guard al inicio (tras el check de status): si `run.assembly_mode == ENSAMBLAR and run.assembly_pending` → `ProductionDomainError("Producción debe definir el ensamble antes de recibir.")`.
  - Router: `POST /runs/{run_id}/assembly` — mismo bloqueo de rol que el PUT de products (inventario 403; `ensure_permission("production.runs.update")`).
  - `_read_with_names`/`list_runs`: attach de nombres para `assembly_items` (batch igual que complementos).

- [ ] **Step 1: Schemas + helper + _finish_run** (código conforme; comentarios español).
- [ ] **Step 2: define_run_assembly + guard + router.**
- [ ] **Step 3: Compilar** — py_compile de los tres archivos.
- [ ] **Step 4: Commit** — `feat(produccion): auto-ensamble por receta y ensamble manual que aprende`

---

### Task 5: Recepción con destino por pieza + acta con ensamble (backend)

**Files:**
- Modify: `backend/modules/production/service.py` (`receive_finished_product`)

**Interfaces:**
- Consumes: `LotConversionCreate` acepta `target_item_id` (ya existente en inventory/schemas.py:80-92).
- Produces: el loop de conversión usa por fila `target_item_id` si existe, si no `product_type_id`:

```python
        for product in run.products:
            conversion = (
                LotConversionCreate(target_item_id=product.target_item_id, quantity=product.quantity)
                if product.target_item_id is not None
                else LotConversionCreate(product_type_id=product.product_type_id, quantity=product.quantity)
            )
            try:
                self.inventory_service.convert_lot_to_product(
                    lot.id, conversion, user_id=current_user.id
                )
            except (InventoryDomainError, InventoryNotFoundError) as exc:
                raise ProductionDomainError(
                    f"No se pudo convertir el lote al producto planificado: {exc}"
                ) from exc
```

- [ ] **Step 1: Editar el loop** (reemplazo quirúrgico; nada más cambia en el método aparte del guard ya agregado en Task 4).
- [ ] **Step 2: Compilar** — py_compile service.
- [ ] **Step 3: Commit** — `feat(produccion): recepcion convierte a pieza o tipo segun el plan`

---

### Task 6: Tipos y APIs frontend

**Files:**
- Modify: `frontend/types/production/index.ts`, `frontend/types/inventory/index.ts`, `frontend/lib/production-api.ts`, `frontend/lib/inventory-api.ts`

**Interfaces:**
- Produces:
  - `ProductionRun`: `assembly_mode: "ASIGNAR" | "ENSAMBLAR"`, `assembly_pending: boolean`, `assembly_items?: Array<{id: string; complement_item_id: string; name?: string | null; quantity: string}>`; fila de `products` gana `target_item_id?: string | null`.
  - `InventoryItem` gana `complement_type_id?: string | null`. Nuevo `export type ComplementType = { id: string; name: string; is_active: boolean };`.
  - `production-api.ts`: `createProductionRun` payload gana `assembly_mode: "ASIGNAR" | "ENSAMBLAR"` y las filas de `products` aceptan `{ product_type_id?: string; target_item_id?: string; quantity: string }`; nueva `defineRunAssembly(runId, items: Array<{complement_item_id: string; quantity_per_unit: string}>)` → POST `/api/production/runs/${runId}/assembly` body `{ items }`.
  - `inventory-api.ts`: `listComplementTypes()`, `createComplementType(name)`, `updateComplementType(id, payload)`, `deleteComplementType(id)` contra `/api/inventory/complement-types`; `SaveInventoryItemPayload` gana `complement_type_id?: string | null`.
- tsc: fallará SOLO en el call-site de `createProductionRun` (production-dashboard) por `assembly_mode` — se arregla en Task 8; ningún otro error nuevo.

- [ ] **Step 1: Tipos.** — [ ] **Step 2: APIs.** — [ ] **Step 3: tsc (registrar el único error esperado).** — [ ] **Step 4: Commit** — `feat(front): tipos y api de ensamble y tipos de complemento`

---

### Task 7: Manager de tipos de complemento + complementos agrupados + XML

**Files:**
- Create: `frontend/components/mantenimiento/complement-types-manager.tsx`
- Modify: `frontend/components/mantenimiento/complements-manager.tsx`, `frontend/components/production/production-dashboard.tsx` (tiles mantenimiento), `frontend/components/inventory/inventory-dashboard.tsx`

**Interfaces:**
- Consumes: APIs de Task 6.
- Produces:
  1. `ComplementTypesManager`: espejo del manager más simple existente (leer `units-manager.tsx` y copiar su estructura) para CRUD de nombres de tipo; query key `["complement-types"]`.
  2. Mantenimiento (production-dashboard, variante maintenance): en la sección "Complementos" agregar dos tiles más ("Crear tipo de complemento" / "Tipos de complemento" con conteo) usando `dataModal` type `"complementTypes"` (extender unión + branch de render, patrón exacto de los tiles v1).
  3. `complements-manager.tsx`: el form gana select "Tipo" (de `listComplementTypes()` activos, opcional) y envía `complement_type_id`; la lista muestra el tipo.
  4. Pestaña Complementos en inventory-dashboard: agrupar por tipo con drill-down (nivel tipos: nombre + nº items + stock; nivel items: la tabla actual), MISMO patrón del drill de FINISHED_PRODUCT en ese archivo (buscar `drilledGroup` / `setDrillGroup`); ítems sin tipo → grupo "Sin tipo". Cargar `listComplementTypes()` con query `["complement-types"]`.
  5. XML import (inventory-dashboard): `COMPLEMENT` pasa a ser elegible en la revisión manual de líneas: el select de tipo por línea (~línea 3532) agrega opción "Complemento"; `defaultType` (~línea 1511) devuelve `"COMPLEMENT"` cuando `itemFilter === "COMPLEMENT"`. La verificación línea-por-línea existente no cambia.
- tsc: cero errores nuevos (el de `createProductionRun` de Task 6 sigue siendo el único, hasta Task 8).

- [ ] **Step 1: Manager + tiles.** — [ ] **Step 2: Form complementos con tipo.** — [ ] **Step 3: Drill-down pestaña.** — [ ] **Step 4: XML elegible.** — [ ] **Step 5: tsc.** — [ ] **Step 6: Commit** — `feat(inventario): tipos de complemento con drill-down y xml elegible`

---

### Task 8: Modal Crear orden v2 — modo y pickers visuales

**Files:**
- Create: `frontend/components/inventory/complement-picker.tsx`
- Modify: `frontend/components/production/production-dashboard.tsx`

**Interfaces:**
- Consumes: `FinishedItemPicker` (`frontend/components/inventory/finished-item-picker.tsx` — props: title, items, requireStock, onSelect(item), onCreate?, onClose), `CatalogProductPicker` (`frontend/components/inventory/catalog-product-picker.tsx` — leerlo y usar sus props reales para elegir TIPO de producto; es el que usa la conversión para "Elegir del catálogo" por tipo), APIs Task 6.
- Produces:
  1. `ComplementPicker`: espejo de `FinishedItemPicker` pero sobre ítems COMPLEMENT agrupados por tipo de complemento (drill tipo → ítems; usa `listComplementTypes()` para labels; grupo "Sin tipo" al final). `onSelect(item)` devuelve el ítem; cantidades se editan fuera.
  2. Modal Crear orden:
     - Toggle de modo (dos botones segmentados, estilo `.button` activo/inactivo del archivo): **Asignar** | **Ensamblar**; estado `assemblyMode`.
     - ASIGNAR: filas como v1 pero el select de producto se reemplaza por botón "Elegir producto" que abre `FinishedItemPicker` (requireStock=false, items = productos terminados del inventario — agregar fetch de `listInventoryItems("FINISHED_PRODUCT")` al bundle de producción) con `onCreate` → abre `CatalogProductPicker` para elegir TIPO (productos aún sin piezas). La fila guarda `{ targetItemId? , productTypeId?, label, quantity }` y muestra el label elegido.
     - ENSAMBLAR: un solo "Elegir producto final" (mismos pickers) sin cantidad propia (usa la cantidad de la orden); ocultar filas de split.
     - Complementos: el botón "Solicitar complementos" abre `ComplementPicker`; cada selección agrega fila (label + cantidad editable), lista debajo como v1.
     - `handleCreateProductionOrder`: payload v2 (`assembly_mode`, filas con `target_item_id`/`product_type_id`); validación de suma solo en ASIGNAR; en ENSAMBLAR manda una fila con `quantity = runQuantity`.
     - `renderProductRows`/modal "Editar productos" (v1): actualizar para el nuevo shape de fila (label + picker en lugar de combo). El PUT de products manda `target_item_id`/`product_type_id` según la fila.
- tsc: CERO errores al terminar.

- [ ] **Step 1: ComplementPicker.** — [ ] **Step 2: Bundle + estado + toggle.** — [ ] **Step 3: Pickers en filas y ensamble.** — [ ] **Step 4: Handler + editar plan.** — [ ] **Step 5: tsc = 0.** — [ ] **Step 6: Commit** — `feat(produccion): crear orden con modo ensamblar y pickers visuales`

---

### Task 9: Ventana "Definir ensamble" + acta y solicitudes

**Files:**
- Modify: `frontend/components/production/production-dashboard.tsx`, `frontend/lib/orden-produccion.ts`, `frontend/components/solicitudes/solicitudes-view.tsx`

**Interfaces:**
- Consumes: `defineRunAssembly` (Task 6); `run.assembly_pending`, `run.complements` (APROBADA), `run.assembly_items`.
- Produces:
  1. Producción: donde se listan órdenes en `PENDIENTE_RECEPCION` (sección Movimientos/las cards de finalizadas — ubicar por `PENDIENTE_RECEPCION` en el archivo), si `run.assembly_pending` → botón destacado "Definir ensamble" que abre modal nueva (adaptación de la ventana de combinar de inventario, versión reducida): tabla de complementos APROBADOS de la orden (nombre, cantidad aprobada, input "por unidad"), preview del total (`por unidad × unidades`), validación `total ≤ aprobado` por fila y ≥1 fila con cantidad; submit → `defineRunAssembly`; success "Ensamble definido. La receta quedó guardada para el futuro."; reload.
  2. Acta (`buildOrdenProduccion`): en recepción, si la orden tiene `assembly_items`, agregar una fila por complemento de la combinación: `detalle: "Ensamble: {name} × {quantity}"` con unidad del complemento (buscar unit en `run.complements` por item_id; fallback "und"). El producto final ya sale de `run.products` (v1).
  3. Solicitudes (`RunDetail`): sección "Ensamble aplicado" (si `assembly_items` no vacío) con nombre × cantidad; badge "Ensamble pendiente" cuando `assembly_pending`.
- tsc: CERO errores.

- [ ] **Step 1: Modal definir ensamble.** — [ ] **Step 2: Acta.** — [ ] **Step 3: Solicitudes.** — [ ] **Step 4: tsc = 0.** — [ ] **Step 5: Commit** — `feat(produccion): definir ensamble manual y acta con combinacion`

---

### Task 10: Verificación

- [ ] **Step 1:** `python -m py_compile` de todos los .py tocados + `npx tsc --noEmit` = 0.
- [ ] **Step 2 (PENDIENTE de stack):** pg_dump → `alembic upgrade head` (aplica e3f4a5b6c7d8 y f4a5b6c7d8e9) → QA:
  1. Crear tipo de complemento; crear complemento con tipo; entrada de stock; verificar drill por tipo; XML con línea clasificada COMPLEMENT.
  2. Orden ASIGNAR con picker (pieza y tipo nuevos) → flujo v1 completo.
  3. Orden ENSAMBLAR sin receta → finalizar → "Definir ensamble" → recibir → acta con ensamble; verificar receta guardada.
  4. Segunda orden ENSAMBLAR del mismo producto → auto-ensamble (sin paso manual) → recibir.
  5. Recepción bloqueada (409) mientras ensamble pendiente.
- [ ] **Step 3:** Actualizar spec si hay desvíos; commit final.
