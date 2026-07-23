# Orden Unificada, Split de Resultantes y Complementos — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Modal única "Crear orden" en producción con proceso, material, cantidad, plan de productos resultantes (split) y solicitud de complementos; recepción de inventario crea los productos finales directamente; "Procesos terminados" queda de solo lectura para el jefe de producción.

**Architecture:** Dos tablas nuevas (`production_run_products`, `production_complement_requests`). La aprobación de materiales existente también aprueba/descuenta complementos. La recepción reutiliza `create_finished_product_lot` + `convert_lot_to_product` (herencia de material por gramos dominantes ya probada) para convertir el lote automáticamente según el plan. Nuevo `item_type = "COMPLEMENT"` con pestaña propia en inventario.

**Tech Stack:** FastAPI + SQLAlchemy 2.0 + Alembic + Pydantic v2 (backend), Next.js + React + TanStack Query (frontend). Stack corre en Docker: **solo `docker compose exec`, nunca up/down/restart** (regla del proyecto).

## Global Constraints

- Spec: `docs/superpowers/specs/2026-07-23-orden-unificada-complementos-design.md`.
- Nada de procesos/etapas quemados en código; todo desde BD.
- Todo cambio de stock vía movimientos de inventario (nunca editar `current_stock` directo).
- Permisos validados en backend (`ensure_permission` en production router; `require_permission` en inventory).
- `pg_dump` antes de correr la migración Alembic.
- No inventar datos de prueba en BD; si se crean para verificar, borrarlos después.
- No hay infraestructura de tests en el repo (cero `test_*.py`); la verificación es por compilación (`python -m py_compile`, `tsc`), migración y QA manual en la app. No introducir pytest en este plan.
- Frontend typecheck: borrar `frontend/.next/types/**/validator.ts` si `tsc` falla por él (regla de memoria).
- Comentarios en español, mismo estilo del código existente.

---

### Task 1: Migración y modelos backend (tablas nuevas)

**Files:**
- Modify: `backend/modules/production/models.py` (agregar 2 modelos + relationships)
- Create: `backend/alembic/versions/e3f4a5b6c7d8_run_products_and_complements.py`

**Interfaces:**
- Produces: modelos `ProductionRunProduct` (`run_id`, `product_type_id`, `quantity`) y `ProductionComplementRequest` (`run_id`, `item_id`, `quantity`, `unit_code`, `status`, `approved_by_user_id`, `approved_at`); relationships `ProductionRun.products` y `ProductionRun.complements`; constantes de estado `ComplementRequestStatus.PENDING/APPROVED/REJECTED` = `"PENDIENTE"/"APROBADA"/"RECHAZADA"`.

- [ ] **Step 1: Backup de la base**

```bash
docker compose exec -T db pg_dump -U postgres -d erp_joyeria > "backups/pre_run_products_$(date +%Y%m%d_%H%M%S).sql"
```
(Ajustar nombre de servicio/usuario/db a los del `docker-compose.yml` del repo; verificar con `docker compose ps` y `docker compose exec db env | grep POSTGRES`.)
Expected: archivo SQL no vacío en `backups/`.

- [ ] **Step 2: Agregar modelos en `backend/modules/production/models.py`**

Después de la clase `ProductionRunStatus` agregar:

```python
class ComplementRequestStatus:
    PENDING = "PENDIENTE"
    APPROVED = "APROBADA"
    REJECTED = "RECHAZADA"
```

Dentro de `ProductionRun`, junto a la relationship `stages`, agregar:

```python
    # Plan de productos resultantes declarado al crear la orden (split):
    # a qué tipos del catálogo se convierte el lote al recibirlo.
    products: Mapped[list["ProductionRunProduct"]] = relationship(
        back_populates="run",
        cascade="all, delete-orphan",
    )
    # Complementos de inventario solicitados para ensamblar con la producción.
    complements: Mapped[list["ProductionComplementRequest"]] = relationship(
        back_populates="run",
        cascade="all, delete-orphan",
    )
```

Al final del archivo agregar:

```python
class ProductionRunProduct(Base):
    __tablename__ = "production_run_products"

    id: Mapped[PyUUID] = mapped_column(PG_UUID(as_uuid=True), primary_key=True, default=uuid4)
    run_id: Mapped[PyUUID] = mapped_column(
        ForeignKey("production_runs.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    product_type_id: Mapped[PyUUID] = mapped_column(
        ForeignKey("product_types.id", ondelete="RESTRICT"),
        nullable=False,
        index=True,
    )
    quantity: Mapped[Decimal] = mapped_column(Numeric(14, 4), nullable=False)

    run: Mapped["ProductionRun"] = relationship(back_populates="products")


class ProductionComplementRequest(Base):
    __tablename__ = "production_complement_requests"

    id: Mapped[PyUUID] = mapped_column(PG_UUID(as_uuid=True), primary_key=True, default=uuid4)
    run_id: Mapped[PyUUID] = mapped_column(
        ForeignKey("production_runs.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    item_id: Mapped[PyUUID] = mapped_column(PG_UUID(as_uuid=True), nullable=False, index=True)
    quantity: Mapped[Decimal] = mapped_column(Numeric(14, 4), nullable=False)
    unit_code: Mapped[str] = mapped_column(String(20), nullable=False)
    status: Mapped[str] = mapped_column(
        String(20), nullable=False, default=ComplementRequestStatus.PENDING
    )
    approved_by_user_id: Mapped[PyUUID | None] = mapped_column(PG_UUID(as_uuid=True), nullable=True)
    approved_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)

    run: Mapped["ProductionRun"] = relationship(back_populates="complements")
```

- [ ] **Step 3: Crear migración Alembic**

Ver `down_revision` real: la última es `d2e3f4a5b6c7_inventory_item_weight_per_unit.py` (confirmar con `docker compose exec backend alembic heads`). Crear `backend/alembic/versions/e3f4a5b6c7d8_run_products_and_complements.py`:

```python
"""run products plan and complement requests

Revision ID: e3f4a5b6c7d8
Revises: d2e3f4a5b6c7
Create Date: 2026-07-23
"""
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "e3f4a5b6c7d8"
down_revision = "d2e3f4a5b6c7"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "production_run_products",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "run_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("production_runs.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column(
            "product_type_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("product_types.id", ondelete="RESTRICT"),
            nullable=False,
            index=True,
        ),
        sa.Column("quantity", sa.Numeric(14, 4), nullable=False),
    )
    op.create_table(
        "production_complement_requests",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "run_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("production_runs.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column("item_id", postgresql.UUID(as_uuid=True), nullable=False, index=True),
        sa.Column("quantity", sa.Numeric(14, 4), nullable=False),
        sa.Column("unit_code", sa.String(20), nullable=False),
        sa.Column("status", sa.String(20), nullable=False, server_default="PENDIENTE"),
        sa.Column("approved_by_user_id", postgresql.UUID(as_uuid=True), nullable=True),
        sa.Column("approved_at", sa.DateTime(timezone=True), nullable=True),
    )
    # Migrar el producto objetivo único existente como plan de una sola fila
    # (cantidad = cantidad de la orden). El campo viejo queda deprecado.
    op.execute(
        """
        INSERT INTO production_run_products (id, run_id, product_type_id, quantity)
        SELECT gen_random_uuid(), id, target_product_type_id, quantity
        FROM production_runs
        WHERE target_product_type_id IS NOT NULL
        """
    )


def downgrade() -> None:
    op.drop_table("production_complement_requests")
    op.drop_table("production_run_products")
```

Nota: si `gen_random_uuid()` no existe (Postgres < 13 sin pgcrypto), usar `uuid_generate_v4()` o habilitar `CREATE EXTENSION IF NOT EXISTS pgcrypto;` dentro del `upgrade()`.

- [ ] **Step 4: Compilar y migrar**

```bash
python -m py_compile backend/modules/production/models.py
docker compose exec backend alembic upgrade head
```
Expected: sin errores; `alembic current` muestra `e3f4a5b6c7d8`.

- [ ] **Step 5: Commit**

```bash
git add backend/modules/production/models.py backend/alembic/versions/e3f4a5b6c7d8_run_products_and_complements.py
git commit -m "feat(produccion): tablas de plan de resultantes y solicitudes de complementos"
```

---

### Task 2: item_type COMPLEMENT en backend de inventario

**Files:**
- Modify: `backend/modules/inventory/schemas.py:9` (Literal), `:154-162` (summary)
- Modify: `backend/modules/inventory/service.py:60-69` (prefijos y tipos manuales), `:325-339` (summary)

**Interfaces:**
- Produces: `item_type "COMPLEMENT"` válido en crear/editar/listar items, SKU `CO-####`, campo `complements: int` en `InventorySummary`.

- [ ] **Step 1: Ampliar Literal y summary en `schemas.py`**

```python
InventoryItemType = Literal["RAW_MATERIAL", "SUPPLY", "COMPLEMENT", "WORK_IN_PROGRESS", "FINISHED_PRODUCT"]
```

En `InventorySummary` agregar tras `supplies: int`:

```python
    complements: int
```

- [ ] **Step 2: Ampliar service**

En `ITEM_TYPE_PREFIXES` agregar `"COMPLEMENT": "CO",`. En `MANUALLY_MANAGED_TYPES` agregar `"COMPLEMENT"`:

```python
MANUALLY_MANAGED_TYPES = ("RAW_MATERIAL", "SUPPLY", "COMPLEMENT", "FINISHED_PRODUCT")
```

En `get_summary()` agregar al constructor de `InventorySummary`:

```python
            complements=sum(1 for item in items if item.item_type == "COMPLEMENT"),
```

- [ ] **Step 3: Compilar**

```bash
python -m py_compile backend/modules/inventory/schemas.py backend/modules/inventory/service.py
```
Expected: sin errores.

- [ ] **Step 4: Commit**

```bash
git add backend/modules/inventory/schemas.py backend/modules/inventory/service.py
git commit -m "feat(inventario): tipo de item COMPLEMENT con SKU CO-"
```

---

### Task 3: create_run con plan de resultantes y complementos + endpoint de edición del plan

**Files:**
- Modify: `backend/modules/production/schemas.py` (payloads y reads)
- Modify: `backend/modules/production/service.py` (create_run, helpers attach, update_run_products)
- Modify: `backend/modules/production/router.py` (PUT products)

**Interfaces:**
- Consumes: modelos de Task 1.
- Produces:
  - `ProductionRunCreate.products: list[RunProductCreate]` (min 1) y `.complements: list[RunComplementCreate]` (opcional). `RunProductCreate = {product_type_id: UUID, quantity: Decimal > 0}`; `RunComplementCreate = {item_id: UUID, quantity: Decimal > 0}`.
  - `ProductionRunRead.products: list[RunProductRead]` (`{id, product_type_id, product_name, quantity}`) y `.complements: list[RunComplementRead]` (`{id, item_id, name, quantity, unit_code, status}`).
  - `ProductionService.update_run_products(run_id, payload: RunProductsUpdate, current_user)`.
  - Endpoint `PUT /api/production/runs/{run_id}/products`.
  - `target_product_type_id` se mantiene en el read (compat), pero ya no se envía al crear.

- [ ] **Step 1: Schemas**

En `backend/modules/production/schemas.py`, antes de `ProductionRunCreate`:

```python
class RunProductCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    product_type_id: UUID
    quantity: Decimal = Field(gt=0)


class RunComplementCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    item_id: UUID
    quantity: Decimal = Field(gt=0)


class RunProductsUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    products: list[RunProductCreate] = Field(min_length=1)
```

`ProductionRunCreate` queda:

```python
class ProductionRunCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    process_id: UUID
    # Material con el que se fabricara: debe ser uno de los configurados en el proceso.
    raw_material_item_id: UUID
    quantity: Decimal = Field(gt=0)
    # Plan de resultantes (split): la suma de cantidades debe igualar quantity.
    products: list[RunProductCreate] = Field(min_length=1)
    # Complementos de inventario solicitados para ensamblar (opcional).
    complements: list[RunComplementCreate] = Field(default_factory=list)
```

(Eliminar `target_product_type_id` del create; el modal nuevo siempre manda `products`.)

Reads — antes de `ProductionRunRead`:

```python
class RunProductRead(BaseModel):
    model_config = ConfigDict(from_attributes=True, extra="forbid")

    id: UUID
    product_type_id: UUID
    product_name: str | None = None
    quantity: Decimal


class RunComplementRead(BaseModel):
    model_config = ConfigDict(from_attributes=True, extra="forbid")

    id: UUID
    item_id: UUID
    name: str | None = None
    quantity: Decimal
    unit_code: str
    status: str
```

En `ProductionRunRead` agregar (junto a `supply_consumptions`):

```python
    # Plan de resultantes (split) y complementos solicitados.
    products: list[RunProductRead] = Field(default_factory=list)
    complements: list[RunComplementRead] = Field(default_factory=list)
```

- [ ] **Step 2: Service — validación y creación del plan**

En `backend/modules/production/service.py`:

Imports: agregar `ComplementRequestStatus`, `ProductionComplementRequest`, `ProductionRunProduct` al import de models, y `RunProductsUpdate`, `RunProductRead`, `RunComplementRead` al import de schemas.

Nuevo helper (junto a `_validate_product_types`):

```python
    def _validate_run_products(
        self, process: ProductionProcess, quantity: Decimal, products: list
    ) -> None:
        """Valida el plan de resultantes: tipos activos del catálogo, permitidos
        por el proceso (si restringe), sin repetidos y suma = cantidad."""
        type_ids = [p.product_type_id for p in products]
        if len(type_ids) != len(set(type_ids)):
            raise ProductionDomainError("No repitas el mismo producto resultante.")
        from backend.modules.product_types.models import ProductType

        allowed = {link.product_type_id for link in process.product_types}
        for type_id in type_ids:
            product_type = self.repository.session.get(ProductType, type_id)
            if product_type is None or not product_type.is_active:
                raise ProductionDomainError("Un producto resultante no existe o esta inactivo.")
            if allowed and type_id not in allowed:
                raise ProductionDomainError(
                    f"El proceso no puede producir '{product_type.name}'."
                )
        total = sum((p.quantity for p in products), Decimal("0"))
        if total != quantity:
            raise ProductionDomainError(
                f"El plan de productos suma {total} y la orden fabrica {quantity}: deben coincidir."
            )
```

En `create_run`, reemplazar el bloque de validación de `target_product_type_id` (líneas ~369-376) por:

```python
        self._validate_run_products(process, payload.quantity, payload.products)

        # Complementos: items de la pestaña Complementos del inventario.
        from backend.modules.inventory.models import InventoryItem

        complement_items = []
        for complement in payload.complements:
            item = self.repository.session.get(InventoryItem, complement.item_id)
            if item is None or item.item_type != "COMPLEMENT":
                raise ProductionDomainError(
                    "Un complemento solicitado no existe en la pestaña Complementos."
                )
            complement_items.append(item)
```

En el constructor de `ProductionRun` quitar `target_product_type_id=payload.target_product_type_id,` y, después del bucle de stages (antes de `self.repository.add_run(run)`), agregar:

```python
        for product in payload.products:
            run.products.append(
                ProductionRunProduct(
                    product_type_id=product.product_type_id,
                    quantity=product.quantity,
                )
            )
        for complement, item in zip(payload.complements, complement_items):
            run.complements.append(
                ProductionComplementRequest(
                    item_id=item.id,
                    quantity=complement.quantity,
                    unit_code=item.unit_code,
                    status=ComplementRequestStatus.PENDING,
                )
            )
```

Al final de `create_run` cambiar `return ProductionRunRead.model_validate(run)` por `return self._read_with_names(run)` (para que el plan y complementos salgan con nombres desde el primer response).

- [ ] **Step 3: Service — attach de nombres**

Nuevo helper junto a `_attach_supply_consumptions`:

```python
    def _attach_plan_names(self, reads: list, runs: list) -> None:
        """Nombres del plan de resultantes (tipo de producto) y de los
        complementos (item de inventario) para las vistas y el acta."""
        from sqlalchemy import select
        from backend.modules.inventory.models import InventoryItem
        from backend.modules.product_types.models import ProductType

        type_ids = {p.product_type_id for run in runs for p in run.products}
        item_ids = {c.item_id for run in runs for c in run.complements}
        type_names: dict = {}
        if type_ids:
            rows = self.repository.session.execute(
                select(ProductType.id, ProductType.name).where(ProductType.id.in_(type_ids))
            ).all()
            type_names = {row[0]: row[1] for row in rows}
        item_names: dict = {}
        if item_ids:
            rows = self.repository.session.execute(
                select(InventoryItem.id, InventoryItem.name).where(InventoryItem.id.in_(item_ids))
            ).all()
            item_names = {row[0]: row[1] for row in rows}
        for read in reads:
            for product in read.products:
                product.product_name = type_names.get(product.product_type_id)
            for complement in read.complements:
                complement.name = item_names.get(complement.item_id)
```

Llamar `self._attach_plan_names(reads, runs)` (o `[read], [run]`) dentro de `_read_with_names` y de `list_runs`, junto a los attach existentes.

- [ ] **Step 4: Service — editar el plan**

```python
    def update_run_products(
        self, run_id: UUID, payload: RunProductsUpdate, current_user: CurrentUser
    ) -> ProductionRunRead:
        run = self.repository.get_run(run_id)
        if run is None:
            raise ProductionNotFoundError("Orden de produccion no encontrada.")
        if run.status in (ProductionRunStatus.RECEIVED, ProductionRunStatus.CANCELLED):
            raise ProductionDomainError(
                "El plan de productos ya no se puede cambiar: la orden fue recibida o cancelada."
            )
        process = self.repository.get(run.process_id)
        if process is None:
            raise ProductionNotFoundError("Proceso de la orden no encontrado.")
        self._validate_run_products(process, run.quantity, payload.products)
        run.products = [
            ProductionRunProduct(
                product_type_id=product.product_type_id,
                quantity=product.quantity,
            )
            for product in payload.products
        ]
        self.repository.flush()
        return self._read_with_names(run)
```

- [ ] **Step 5: Router**

En `backend/modules/production/router.py` importar `RunProductsUpdate` y agregar:

```python
@router.put("/runs/{run_id}/products", response_model=ProductionRunRead)
def update_run_products(
    run_id: UUID,
    payload: RunProductsUpdate,
    current_user: CurrentUser = Depends(get_current_user),
    service: ProductionService = Depends(get_production_service),
) -> ProductionRunRead:
    # Solo produccion/admin: el plan es del jefe de produccion, no de inventario.
    if current_user.role == "Jefe de inventario":
        raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Solo produccion puede editar el plan.")
    ensure_permission(current_user, "production.runs.update")
    try:
        return service.update_run_products(run_id, payload, current_user)
    except ProductionNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except ProductionDomainError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc
```

- [ ] **Step 6: Compilar y probar en vivo**

```bash
python -m py_compile backend/modules/production/schemas.py backend/modules/production/service.py backend/modules/production/router.py
```
Backend con `--reload` dentro del contenedor toma los cambios solo (no reiniciar el stack). Probar por Swagger (`/docs`) con el token del jefe de producción: `POST /api/production/runs` con `products` que no suman → 409 con mensaje claro; que suman → 201 y el response trae `products` con `product_name`. Borrar la orden de prueba no es posible por API — usar cantidades reales solo si Rodrigo lo autoriza; si no, validar únicamente el caso 409 (no persiste nada).

- [ ] **Step 7: Commit**

```bash
git add backend/modules/production/schemas.py backend/modules/production/service.py backend/modules/production/router.py
git commit -m "feat(produccion): plan de resultantes con split y complementos en crear orden"
```

---

### Task 4: Aprobación/rechazo de inventario descuenta complementos

**Files:**
- Modify: `backend/modules/production/service.py:423-482` (`approve_materials`, `reject_materials`)

**Interfaces:**
- Consumes: `ProductionComplementRequest`, `ComplementRequestStatus` (Task 1); `InventoryService.consume_material_for_production` (existente).
- Produces: al aprobar materiales, cada complemento PENDIENTE genera movimiento `CONSUMO_PRODUCCION` y pasa a APROBADA; al rechazar la orden pasan a RECHAZADA. Los movimientos aparecen solos en `supply_consumptions` (acta de entrega) porque ese helper ya lista todos los `CONSUMO_PRODUCCION` de la orden.

- [ ] **Step 1: `approve_materials` — consumir complementos**

Después del bucle de insumos por etapa (tras el `for stage in ...` que consume `stage.ingredients`) y antes de `run.status = ProductionRunStatus.MATERIALS_APPROVED`, agregar:

```python
        # Complementos solicitados en la orden: se aprueban y descuentan junto
        # con la materia prima. Si falta stock, toda la aprobacion se revierte.
        from backend.modules.inventory.models import InventoryItem as _InventoryItem

        now = datetime.utcnow()
        for complement in run.complements:
            if complement.status != ComplementRequestStatus.PENDING:
                continue
            item = self.repository.session.get(_InventoryItem, complement.item_id)
            item_name = item.name if item is not None else "complemento"
            try:
                self.inventory_service.consume_material_for_production(
                    item_id=complement.item_id,
                    quantity=complement.quantity,
                    production_run_id=run.id,
                    user_id=current_user.id,
                    production_code=run.production_code,
                    reason=f"Complemento para ensamble: {item_name}.",
                )
            except InventoryDomainError as exc:
                raise ProductionDomainError(f"Complemento '{item_name}': {exc}") from exc
            complement.status = ComplementRequestStatus.APPROVED
            complement.approved_by_user_id = current_user.id
            complement.approved_at = now
```

- [ ] **Step 2: `reject_materials` — marcar rechazados**

Antes de `self.repository.flush()` en `reject_materials`:

```python
        for complement in run.complements:
            if complement.status == ComplementRequestStatus.PENDING:
                complement.status = ComplementRequestStatus.REJECTED
```

- [ ] **Step 3: Compilar**

```bash
python -m py_compile backend/modules/production/service.py
```
Expected: sin errores.

- [ ] **Step 4: Commit**

```bash
git add backend/modules/production/service.py
git commit -m "feat(produccion): aprobar materiales descuenta complementos solicitados"
```

---

### Task 5: Recepción crea productos finales directamente

**Files:**
- Modify: `backend/modules/production/service.py:770-799` (`receive_finished_product`)

**Interfaces:**
- Consumes: `InventoryService.convert_lot_to_product(lot_item_id, LotConversionCreate, user_id)` y `LotConversionCreate` (existentes, `backend/modules/inventory/schemas.py:80`); plan `run.products` (Task 1/3).
- Produces: al recibir, el lote OP se crea (trazabilidad + acta) y se convierte automáticamente según el plan; cada resultante hereda material/pureza por la lógica existente de conversión. Órdenes viejas sin plan conservan el comportamiento actual (lote queda para conversión manual del admin).

- [ ] **Step 1: Reemplazar el cuerpo de `receive_finished_product`**

```python
    def receive_finished_product(self, run_id: UUID, current_user: CurrentUser) -> ProductionRunRead:
        if self.inventory_service is None:
            raise ProductionDomainError("Inventario no esta disponible para recibir producto terminado.")
        run = self.repository.get_run(run_id)
        if run is None:
            raise ProductionNotFoundError("Orden de produccion no encontrada.")
        if run.status != ProductionRunStatus.PENDING_RECEPTION:
            raise ProductionDomainError("Solo se puede recibir una produccion finalizada y pendiente de recepcion.")

        # El lote hereda el material (metal) de la orden para que la conversión
        # a producto del catálogo no tenga que preguntarlo.
        from backend.modules.inventory.models import InventoryItem
        from backend.modules.inventory.schemas import LotConversionCreate

        raw_material = self.repository.session.get(InventoryItem, run.raw_material_item_id)
        lot = self.inventory_service.create_finished_product_lot(
            name=run.process_name,
            unit_code="und",
            production_order_id=run.id,
            production_code=run.production_code,
            quantity=run.quantity,
            material_type=(raw_material.material_type or raw_material.name) if raw_material else None,
            # La pureza de la materia prima viaja con el lote (trazabilidad).
            purity=raw_material.purity if raw_material else None,
            received_by_user_id=current_user.id,
        )
        # Con plan de resultantes: el lote se convierte aqui mismo en los
        # productos finales declarados (misma logica de conversion de siempre:
        # herencia de material, codigo de catalogo y par de movimientos).
        # Sin plan (ordenes viejas): el lote queda para conversion manual.
        for product in run.products:
            try:
                self.inventory_service.convert_lot_to_product(
                    lot.id,
                    LotConversionCreate(
                        product_type_id=product.product_type_id,
                        quantity=product.quantity,
                    ),
                    user_id=current_user.id,
                )
            except InventoryDomainError as exc:
                raise ProductionDomainError(
                    f"No se pudo convertir el lote al producto planificado: {exc}"
                ) from exc
        run.status = ProductionRunStatus.RECEIVED
        run.received_at = datetime.utcnow()
        run.received_by_user_id = current_user.id
        self.repository.flush()
        return self._read_with_names(run)
```

- [ ] **Step 2: Compilar**

```bash
python -m py_compile backend/modules/production/service.py
```
Expected: sin errores.

- [ ] **Step 3: Commit**

```bash
git add backend/modules/production/service.py
git commit -m "feat(produccion): recepcion convierte el lote al plan de resultantes"
```

---

### Task 6: Tipos y APIs del frontend

**Files:**
- Modify: `frontend/types/production/index.ts` (ProductionRun + payload)
- Modify: `frontend/types/inventory/index.ts` (InventoryItemType — localizar el Literal equivalente; si el tipo vive en otro archivo, ajustar ahí)
- Modify: `frontend/lib/production-api.ts`

**Interfaces:**
- Produces:
  - `ProductionRun.products?: Array<{id: string; product_type_id: string; product_name?: string | null; quantity: string}>`
  - `ProductionRun.complements?: Array<{id: string; item_id: string; name?: string | null; quantity: string; unit_code: string; status: string}>`
  - `createProductionRun` acepta `products` y `complements`; nueva `updateProductionRunProducts(runId, products)`.
  - `InventoryItemType` incluye `"COMPLEMENT"`.

- [ ] **Step 1: Tipos**

En `frontend/types/production/index.ts`, dentro de `ProductionRun` (junto a `supply_consumptions`):

```ts
  // Plan de resultantes (split) declarado al crear la orden.
  products?: Array<{ id: string; product_type_id: string; product_name?: string | null; quantity: string }>;
  // Complementos de inventario solicitados para ensamblar.
  complements?: Array<{ id: string; item_id: string; name?: string | null; quantity: string; unit_code: string; status: string }>;
```

En el tipo `InventoryItemType` del frontend (buscar `"SUPPLY"` en `frontend/types/inventory/`), agregar `"COMPLEMENT"` a la unión.

- [ ] **Step 2: production-api.ts**

Reemplazar `createProductionRun` y agregar la de plan:

```ts
export function createProductionRun(payload: {
  process_id: string;
  quantity: string;
  raw_material_item_id: string;
  // Plan de resultantes: la suma de cantidades debe igualar quantity.
  products: Array<{ product_type_id: string; quantity: string }>;
  // Complementos solicitados al inventario (opcional).
  complements?: Array<{ item_id: string; quantity: string }>;
}) {
  return apiRequest<ProductionRun>("/api/production/runs", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function updateProductionRunProducts(
  runId: string,
  products: Array<{ product_type_id: string; quantity: string }>,
) {
  return apiRequest<ProductionRun>(`/api/production/runs/${runId}/products`, {
    method: "PUT",
    body: JSON.stringify({ products }),
  });
}
```

- [ ] **Step 3: Typecheck**

```bash
cd frontend && npx tsc --noEmit
```
Expected: fallará en `production-dashboard.tsx` porque `createProductionRun` ahora exige `products` — eso se arregla en Task 8. Registrar que ese es el único error nuevo (más los preexistentes de `.next` si aplica).

- [ ] **Step 4: Commit**

```bash
git add frontend/types frontend/lib/production-api.ts
git commit -m "feat(front): tipos y api de plan de resultantes y complementos"
```

---

### Task 7: Pestaña "Complementos" en inventario

**Files:**
- Modify: `frontend/components/inventory/inventory-dashboard.tsx:46-52` (tabs), `:700` (tipos de movimiento), `:1717` (botón crear), `:2586-2604` (form labels), y el label helper `itemTypeLabel` (buscar su definición en el mismo archivo)

**Interfaces:**
- Consumes: `item_type "COMPLEMENT"` del backend (Task 2), tipo TS (Task 6).
- Produces: pestaña "Complementos" con listado genérico (misma tabla que materia prima/insumos), crear/editar/archivar, entradas de stock y kardex — la lógica genérica existente aplica sola al agregar el tipo.

- [ ] **Step 1: Tab**

En `ITEM_TYPES` insertar tras Insumos:

```ts
  { value: "COMPLEMENT", label: "Complementos" },
```

- [ ] **Step 2: Elegibilidad de movimientos**

Línea ~700: entradas/ajustes deben incluir complementos:

```ts
  const movementItemTypes: InventoryItemType[] =
    movementForm.movement_type === "SALIDA" ? ["FINISHED_PRODUCT"] : ["RAW_MATERIAL", "SUPPLY", "COMPLEMENT"];
```

- [ ] **Step 3: Crear item desde la pestaña**

Línea ~1717: agregar `|| itemFilter === "COMPLEMENT"` a la condición que muestra el botón de crear, y donde se setea `itemForm.item_type` por pestaña usar el filtro activo (seguir el patrón exacto del código: buscar dónde `entryType`/`itemForm.item_type` se deriva de `itemFilter` — línea ~1307 — e incluir `COMPLEMENT`).

En el form del item (~2586-2604): tratar `COMPLEMENT` como `SUPPLY` (label "Nombre", sin material/pureza):

```ts
const isSimpleItem = itemForm.item_type === "SUPPLY" || itemForm.item_type === "COMPLEMENT";
```
y reemplazar las comparaciones `=== "SUPPLY"` de ese bloque por `isSimpleItem`. Título del modal: `itemForm.item_type === "COMPLEMENT" ? "Crear complemento" : ...`.

- [ ] **Step 4: Label del tipo**

En `itemTypeLabel` (buscar `function itemTypeLabel` o mapa equivalente) agregar `COMPLEMENT → "Complemento"`.

- [ ] **Step 5: Typecheck + verificación visual**

```bash
cd frontend && npx tsc --noEmit
```
Abrir inventario en el navegador: pestaña Complementos lista vacía, crear un complemento de prueba (con permiso de Rodrigo; si no, solo verificar que el form abre), semáforo/kardex funcionan.

- [ ] **Step 6: Commit**

```bash
git add frontend/components/inventory/inventory-dashboard.tsx
git commit -m "feat(inventario): pestaña complementos con la logica de las demas"
```

---

### Task 8: Modal "Crear orden" en producción

**Files:**
- Modify: `frontend/components/production/production-dashboard.tsx:1216-1259` (panel Nueva orden → botón + modal), `:779-809` (handler), estado nuevo cerca de `:238-260`, fetch bundle `:152-167`

**Interfaces:**
- Consumes: `createProductionRun` con `products`/`complements` (Task 6); `listInventoryItems("COMPLEMENT")`; `productTypesList` (ya cargado, línea 211); `selectedProcess.product_type_ids` para filtrar el combo.
- Produces: botón único **Crear orden** que abre modal con Proceso, Material, Cantidad, filas de Productos resultantes (+ agregar), y botón **Solicitar complementos** que despliega el picker de complementos. Validación en cliente: suma del split = cantidad.

- [ ] **Step 1: Estado y datos**

En `fetchProductionBundle` agregar complementos al Promise.all (solo variante production):

```ts
    variant === "production" ? listInventoryItems("COMPLEMENT") : Promise.resolve([]),
```
y exponer `complements: nextComplements` en el objeto retornado (ajustar la destructuración). En el componente: `const complementItems = bundle?.complements ?? EMPTY_RAW_MATERIALS;`

Estado nuevo:

```ts
  const [isCreateOrderOpen, setIsCreateOrderOpen] = useState(false);
  // Filas del split: tipo de producto del catálogo + cantidad.
  const [orderProducts, setOrderProducts] = useState<Array<{ productTypeId: string; quantity: string }>>([
    { productTypeId: "", quantity: "" },
  ]);
  // Complementos solicitados: item + cantidad.
  const [orderComplements, setOrderComplements] = useState<Array<{ itemId: string; quantity: string }>>([]);
  const [isComplementsOpen, setIsComplementsOpen] = useState(false);
```

- [ ] **Step 2: Handler**

Reemplazar `handleCreateProductionOrder` (validaciones existentes + nuevas):

```ts
  async function handleCreateProductionOrder() {
    if (!selectedProcess) { setError("Selecciona un proceso para producir."); return; }
    if (!runQuantity || Number(runQuantity) <= 0) { setError("Ingresa una cantidad valida para fabricar."); return; }
    if (!selectedMaterialId) { setError("Selecciona la materia prima con la que se fabricará esta orden."); return; }
    const products = orderProducts.filter((row) => row.productTypeId && Number(row.quantity) > 0);
    if (products.length === 0) { setError("Agrega al menos un producto resultante."); return; }
    const splitTotal = products.reduce((sum, row) => sum + Number(row.quantity), 0);
    if (splitTotal !== Number(runQuantity)) {
      setError(`El plan de productos suma ${splitTotal} y la orden fabrica ${runQuantity}: deben coincidir.`);
      return;
    }
    const complements = orderComplements.filter((row) => row.itemId && Number(row.quantity) > 0);

    setError(null);
    setSuccess(null);
    setIsSaving(true);
    try {
      await createProductionRun({
        process_id: selectedProcess.id,
        quantity: runQuantity,
        raw_material_item_id: selectedMaterialId,
        products: products.map((row) => ({ product_type_id: row.productTypeId, quantity: row.quantity })),
        complements: complements.map((row) => ({ item_id: row.itemId, quantity: row.quantity })),
      });
      setSuccess("Orden creada. Inventario debe aprobar la salida de materia prima y complementos.");
      setIsCreateOrderOpen(false);
      setOrderProducts([{ productTypeId: "", quantity: "" }]);
      setOrderComplements([]);
      await reload();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "No se pudo crear la orden de produccion.");
    } finally {
      setIsSaving(false);
    }
  }
```

- [ ] **Step 3: UI — botón + modal**

Reemplazar el contenido del panel `productionCreatePanel` (líneas 1224-1258, conservando el `panelHeader`) por un solo botón:

```tsx
              <button className="button buttonPrimary" onClick={() => setIsCreateOrderOpen(true)} type="button">
                <Plus aria-hidden="true" size={16} />
                Crear orden
              </button>
```

Agregar el modal junto a los demás modales del componente (patrón `modalBackdrop`/`modalWindow` existente):

```tsx
      {isCreateOrderOpen ? (
        <div className="modalBackdrop" role="dialog" aria-modal="true">
          <section className="modalWindow">
            <div className="modalHeader">
              <div>
                <h2>Crear orden</h2>
                <p>Proceso, material, cantidad y productos resultantes</p>
              </div>
              <button aria-label="Cerrar" className="iconOnlyButton" onClick={() => setIsCreateOrderOpen(false)} type="button">
                <X aria-hidden="true" size={18} />
              </button>
            </div>

            <div className="materialRow">
              <label className="fieldGroup">
                <span>Proceso</span>
                <select className="field" onChange={(e) => setSelectedProcessId(e.target.value)} value={selectedProcess?.id ?? ""}>
                  <option value="">Seleccionar proceso</option>
                  {activeProcesses.map((p) => (
                    <option key={p.id} value={p.id}>{p.name}</option>
                  ))}
                </select>
              </label>
              <label className="fieldGroup">
                <span>Material</span>
                <select className="field" onChange={(e) => setSelectedMaterialId(e.target.value)} value={selectedMaterialId}>
                  <option value="">Seleccionar material</option>
                  {rawMaterials.filter((item) => item.item_type === "RAW_MATERIAL").map((item) => (
                    <option key={item.id} value={item.id}>
                      {item.name} · {numericText(item.current_stock)} {item.unit_code}
                    </option>
                  ))}
                </select>
              </label>
            </div>
            <label className="fieldGroup">
              <span>Cantidad a fabricar</span>
              <input className="field" min="1" onChange={(e) => setRunQuantity(e.target.value)} step="1" type="number" value={runQuantity} />
            </label>

            {/* Split de productos resultantes: la suma debe igualar la cantidad. */}
            <div className="fieldGroup">
              <span>Productos resultantes</span>
              {orderProducts.map((row, index) => (
                <div className="materialRow" key={index}>
                  <select
                    className="field"
                    onChange={(e) => setOrderProducts((rows) => rows.map((r, i) => (i === index ? { ...r, productTypeId: e.target.value } : r)))}
                    value={row.productTypeId}
                  >
                    <option value="">Seleccionar producto</option>
                    {productTypesList
                      .filter((type) => {
                        const allowed = selectedProcess?.product_type_ids ?? [];
                        return allowed.length === 0 || allowed.includes(type.id);
                      })
                      .map((type) => (
                        <option key={type.id} value={type.id}>{type.name}</option>
                      ))}
                  </select>
                  <input
                    className="field"
                    min="1"
                    onChange={(e) => setOrderProducts((rows) => rows.map((r, i) => (i === index ? { ...r, quantity: e.target.value } : r)))}
                    placeholder="Cantidad"
                    step="1"
                    type="number"
                    value={row.quantity}
                  />
                  {orderProducts.length > 1 ? (
                    <button aria-label="Quitar producto" className="iconOnlyButton" onClick={() => setOrderProducts((rows) => rows.filter((_, i) => i !== index))} type="button">
                      <Trash2 aria-hidden="true" size={15} />
                    </button>
                  ) : null}
                </div>
              ))}
              <button className="button" onClick={() => setOrderProducts((rows) => [...rows, { productTypeId: "", quantity: "" }])} type="button">
                <Plus aria-hidden="true" size={14} /> Agregar producto
              </button>
            </div>

            {/* Complementos del inventario para ensamblar con lo producido. */}
            <div className="fieldGroup">
              <button className="button" onClick={() => setIsComplementsOpen((open) => !open)} type="button">
                <Boxes aria-hidden="true" size={14} />
                Solicitar complementos{orderComplements.length > 0 ? ` (${orderComplements.length})` : ""}
              </button>
              {isComplementsOpen ? (
                <>
                  {orderComplements.map((row, index) => (
                    <div className="materialRow" key={index}>
                      <select
                        className="field"
                        onChange={(e) => setOrderComplements((rows) => rows.map((r, i) => (i === index ? { ...r, itemId: e.target.value } : r)))}
                        value={row.itemId}
                      >
                        <option value="">Seleccionar complemento</option>
                        {complementItems.filter((item) => !item.archived_at).map((item) => (
                          <option key={item.id} value={item.id}>
                            {item.name} · {numericText(item.current_stock)} {item.unit_code}
                          </option>
                        ))}
                      </select>
                      <input
                        className="field"
                        min="0.0001"
                        onChange={(e) => setOrderComplements((rows) => rows.map((r, i) => (i === index ? { ...r, quantity: e.target.value } : r)))}
                        placeholder="Cantidad"
                        step="0.0001"
                        type="number"
                        value={row.quantity}
                      />
                      <button aria-label="Quitar complemento" className="iconOnlyButton" onClick={() => setOrderComplements((rows) => rows.filter((_, i) => i !== index))} type="button">
                        <Trash2 aria-hidden="true" size={15} />
                      </button>
                    </div>
                  ))}
                  <button className="button" onClick={() => setOrderComplements((rows) => [...rows, { itemId: "", quantity: "" }])} type="button">
                    <Plus aria-hidden="true" size={14} /> Agregar complemento
                  </button>
                </>
              ) : null}
            </div>

            <button
              className="button buttonPrimary"
              disabled={isSaving || !selectedProcess || !selectedMaterialId}
              onClick={() => void handleCreateProductionOrder()}
              type="button"
            >
              <Play aria-hidden="true" size={16} />
              Crear orden
            </button>
          </section>
        </div>
      ) : null}
```

Nota de estilo: respetar preferencias de UI de Rodrigo (cero relleno, orden claro). Si el modal excede el alto, usar la clase de ventana con scroll ya existente (`processViewWindow`).

- [ ] **Step 4: Editar el plan después de crear (spec: split ajustable)**

Estado nuevo:

```ts
  const [editPlanRun, setEditPlanRun] = useState<ProductionRun | null>(null);
  const [editPlanRows, setEditPlanRows] = useState<Array<{ productTypeId: string; quantity: string }>>([]);
```

Abridor (usar en el header del modal de etapas —"Gestionar"— y en el modal de resumen `openStatsModal` cuando `run.status !== "RECIBIDA" && run.status !== "CANCELADA"`):

```tsx
                <button className="iconTextButton" onClick={() => {
                  setEditPlanRows((run.products ?? []).map((p) => ({ productTypeId: p.product_type_id, quantity: p.quantity })));
                  setEditPlanRun(run);
                }} type="button">
                  <Pencil aria-hidden="true" size={14} />
                  Editar productos
                </button>
```

Modal (mismas filas del split del modal de crear — reutilizar el mismo JSX extrayéndolo a una función local `renderProductRows(rows, setRows)` para no duplicar):

```tsx
      {editPlanRun ? (
        <div className="modalBackdrop" role="dialog" aria-modal="true">
          <section className="modalWindow">
            <div className="modalHeader">
              <div>
                <h2>Editar productos resultantes</h2>
                <p>{editPlanRun.production_code ?? ""} · fabrica {numericText(editPlanRun.quantity)} und</p>
              </div>
              <button aria-label="Cerrar" className="iconOnlyButton" onClick={() => setEditPlanRun(null)} type="button">
                <X aria-hidden="true" size={18} />
              </button>
            </div>
            {renderProductRows(editPlanRows, setEditPlanRows)}
            <button
              className="button buttonPrimary"
              disabled={isSaving}
              onClick={() => void (async () => {
                const rows = editPlanRows.filter((row) => row.productTypeId && Number(row.quantity) > 0);
                const total = rows.reduce((sum, row) => sum + Number(row.quantity), 0);
                if (total !== Number(editPlanRun.quantity)) {
                  setError(`El plan suma ${total} y la orden fabrica ${numericText(editPlanRun.quantity)}: deben coincidir.`);
                  return;
                }
                setIsSaving(true);
                try {
                  await updateProductionRunProducts(editPlanRun.id, rows.map((row) => ({ product_type_id: row.productTypeId, quantity: row.quantity })));
                  setSuccess("Plan de productos actualizado.");
                  setEditPlanRun(null);
                  await reload();
                } catch (nextError) {
                  setError(nextError instanceof Error ? nextError.message : "No se pudo actualizar el plan.");
                } finally {
                  setIsSaving(false);
                }
              })()}
              type="button"
            >
              <Save aria-hidden="true" size={15} />
              Guardar plan
            </button>
          </section>
        </div>
      ) : null}
```

Nota: el combo de tipos en `renderProductRows` filtra por `allowed_product_type_ids` del run cuando se edita (viene en `ProductionRun`), o por `selectedProcess.product_type_ids` cuando se crea.

- [ ] **Step 5: Typecheck + prueba visual**

```bash
cd frontend && npx tsc --noEmit
```
Expected: sin errores nuevos (el de Task 6 queda resuelto). En navegador: abrir modal, validar mensaje de suma incorrecta, crear orden solo con autorización de Rodrigo.

- [ ] **Step 6: Commit**

```bash
git add frontend/components/production/production-dashboard.tsx
git commit -m "feat(produccion): modal crear orden con split de resultantes y complementos"
```

---

### Task 9: "Procesos terminados" a producción; inventario lo pierde (admin conserva legado)

**Files:**
- Modify: `frontend/components/inventory/inventory-dashboard.tsx:46-52` (tabs por rol)
- Modify: `frontend/components/production/production-dashboard.tsx` (nueva sección/modal "Procesos terminados")

**Interfaces:**
- Consumes: `runs` con estado `RECIBIDA` (ya viene en el bundle de producción), `RunStageSummaryTable`/`RunWasteHero` (ya importados en production-dashboard), `openStatsModal` existente.
- Produces: en producción, sección "Procesos terminados" solo lectura (código OP, proceso, cantidad, merma total con drill a merma por fase, fecha de recepción). En inventario, la pestaña `ORDENES_TERMINADAS` solo la ve admin (legado para convertir lotes viejos); el jefe de inventario ya no la ve.

- [ ] **Step 1: Inventario — pestaña solo admin**

`ITEM_TYPES` es constante de módulo; convertir el render de tabs para filtrar por rol. Donde se mapean las pestañas (buscar `ITEM_TYPES.map` en el archivo), filtrar:

```ts
  const visibleItemTypes = ITEM_TYPES.filter(
    (tab) => tab.value !== "ORDENES_TERMINADAS" || canSeeAudit, // canSeeAudit = admin (línea ~477)
  );
```
y mapear `visibleItemTypes` en lugar de `ITEM_TYPES`. Si `itemFilter` quedó en `ORDENES_TERMINADAS` para un no-admin (estado persistido), resetear a `"RAW_MATERIAL"` en un `useEffect`.

- [ ] **Step 2: Producción — sección "Procesos terminados"**

En `production-dashboard.tsx` (variante production), después de la sección "Movimientos" (línea ~1392), agregar:

```tsx
          {/* Procesos terminados: solo lectura — mermas y datos de recepción. */}
          <section className="card panelBody" aria-label="Procesos terminados">
            <div className="panelHeader">
              <div>
                <h2 className="panelTitle">Procesos terminados</h2>
                <p className="panelText">Mermas e información de las órdenes recibidas</p>
              </div>
            </div>
            {receivedRuns.length > 0 ? (
              <div className="tableWrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>Proceso</th>
                      <th className="num">Cantidad</th>
                      <th className="num">Merma final</th>
                      <th>Recibida</th>
                      <th aria-label="Acciones" />
                    </tr>
                  </thead>
                  <tbody>
                    {receivedRuns.map((run) => (
                      <tr key={run.id}>
                        <td>{run.production_code ?? "—"}</td>
                        <td>{run.process_name}</td>
                        <td className="num">{numericText(run.quantity)} und</td>
                        <td className="num">
                          {run.waste_weight ? `${numericText(run.waste_weight)} g` : "0 g"}
                          {run.waste_percent ? ` · ${numericText(run.waste_percent)}%` : ""}
                        </td>
                        <td>{timeLabel(run.received_at)}</td>
                        <td>
                          <button className="iconTextButton" onClick={() => openStatsModal(run)} type="button">
                            <Eye aria-hidden="true" size={14} />
                            Visualizar
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="emptyState">No hay procesos terminados.</div>
            )}
          </section>
```

Definir `receivedRuns` junto a los demás derivados de `runs` (buscar `inProgressRuns` en el componente):

```ts
  const receivedRuns = runs
    .filter((run) => run.status === "RECIBIDA")
    .sort((a, b) => (b.received_at ?? "").localeCompare(a.received_at ?? ""));
```

El modal de stats existente (`openStatsModal`) ya muestra merma por fase (`RunStageSummaryTable` + `RunWasteHero`) — no duplicar.

- [ ] **Step 3: Typecheck + verificación**

```bash
cd frontend && npx tsc --noEmit
```
En navegador: como jefe de inventario la pestaña "Procesos terminados" no aparece; como jefe de producción la sección lista órdenes recibidas y "Visualizar" abre el resumen con mermas; como admin la pestaña legada sigue en inventario.

- [ ] **Step 4: Commit**

```bash
git add frontend/components/inventory/inventory-dashboard.tsx frontend/components/production/production-dashboard.tsx
git commit -m "feat(produccion): procesos terminados de solo lectura para produccion"
```

---

### Task 10: Acta con resultantes y complementos + detalle de solicitudes

**Files:**
- Modify: `frontend/lib/orden-produccion.ts:40-90` (`buildOrdenProduccion`)
- Modify: `frontend/components/solicitudes/solicitudes-view.tsx:40-138` (`RunDetail`)

**Interfaces:**
- Consumes: `run.products` y `run.complements` (Task 6). Los complementos aprobados ya aparecen en `run.supply_consumptions` (son movimientos `CONSUMO_PRODUCCION`), así que la mitad de ENTREGA del acta los trae sola.
- Produces: acta de recepción lista los productos finales creados; detalle de solicitud muestra plan y complementos con estado.

- [ ] **Step 1: Acta — recepción con resultantes**

En `buildOrdenProduccion`, después del push de `actual_finished_weight` a `recepcionRows`, agregar:

```ts
  // Productos finales creados al recibir (plan de resultantes de la orden).
  for (const product of run.products ?? []) {
    recepcionRows.push({
      gramos: num(product.quantity),
      unidad: "und",
      detalle: `Producto final: ${product.product_name ?? "—"}`
    });
  }
```

- [ ] **Step 2: Detalle de solicitud — plan y complementos**

En `RunDetail` (solicitudes-view), después del bloque `credentialsStack`, agregar:

```tsx
        {(run.products ?? []).length > 0 ? (
          <div className="card panelBody">
            <div className="panelHeader"><div><h2 className="panelTitle">Productos resultantes</h2></div></div>
            <div className="dashboardList">
              {(run.products ?? []).map((product) => (
                <div className="dashboardRow" key={product.id}>
                  <div><strong>{product.product_name ?? "—"}</strong></div>
                  <small>{num(product.quantity)} und</small>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {(run.complements ?? []).length > 0 ? (
          <div className="card panelBody">
            <div className="panelHeader"><div><h2 className="panelTitle">Complementos solicitados</h2></div></div>
            <div className="dashboardList">
              {(run.complements ?? []).map((complement) => (
                <div className="dashboardRow" key={complement.id}>
                  <div><strong>{complement.name ?? "—"}</strong></div>
                  <small>{num(complement.quantity)} {complement.unit_code} · {complement.status}</small>
                </div>
              ))}
            </div>
          </div>
        ) : null}
```

- [ ] **Step 3: Typecheck**

```bash
cd frontend && npx tsc --noEmit
```
Expected: sin errores.

- [ ] **Step 4: Commit**

```bash
git add frontend/lib/orden-produccion.ts frontend/components/solicitudes/solicitudes-view.tsx
git commit -m "feat(solicitudes): acta y detalle con resultantes y complementos"
```

---

### Task 11: Verificación end-to-end y cierre

**Files:** ninguno (verificación) — más el spec si hay desvíos.

- [ ] **Step 1: Compilación total**

```bash
python -m py_compile backend/modules/production/models.py backend/modules/production/schemas.py backend/modules/production/service.py backend/modules/production/router.py backend/modules/inventory/schemas.py backend/modules/inventory/service.py
cd frontend && npx tsc --noEmit
```
Expected: cero errores.

- [ ] **Step 2: QA manual con Rodrigo (o con su permiso para datos temporales, borrándolos después)**

Flujo completo:
1. Inventario: crear complemento `CO-` con stock (ENTRADA).
2. Producción: **Crear orden** → proceso + material + cantidad 10 → split 5 y 5 en dos tipos → solicitar 2 complementos → crear.
3. Inventario (Solicitudes): la solicitud muestra plan y complementos; aprobar materiales → kardex registra `CONSUMO_PRODUCCION` del metal, insumos de etapas y complementos; acta de ENTREGA lista los complementos.
4. Producción: iniciar, avanzar etapas con pesos, finalizar.
5. Inventario: recibir → acta de RECEPCIÓN lista los 2 productos finales (5 + 5); pestaña Productos terminados muestra las piezas con material heredado; el lote OP queda en stock 0.
6. Producción: sección "Procesos terminados" muestra la orden con su merma; jefe de inventario ya no ve esa pestaña; admin sí (legado).
7. Rechazar una segunda orden → complementos quedan RECHAZADA y no se descuenta stock.

- [ ] **Step 3: Actualizar spec si hubo desvíos y commit final**

```bash
git add -A
git commit -m "docs(spec): ajustes post-implementacion orden unificada"
```
