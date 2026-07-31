# Producción Parcial (Backend) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cuando falta materia prima al aprobar una orden de producción, partirla automáticamente en una corrida que arranca con el stock disponible y una corrida hija "ESPERANDO_MATERIAL" ligada al mismo folio; cuando inventario registra un ingreso de esa materia prima, puede "destinar" ese ingreso a la corrida hija, que se aprueba e inicia automáticamente (repitiendo el split si el ingreso tampoco alcanza para toda la hija).

**Architecture:** Todo el split vive en `ProductionService` (backend/modules/production/service.py), reutilizando `approve_materials`/`start_run` existentes en vez de duplicar la lógica de consumo. El "folio raíz" (`root_production_code`) agrupa las corridas partidas; cada corrida conserva su propio `production_code` con sufijo (`-B`, `-C`, ...) para trazabilidad de etapas/movimientos. El aviso al registrar un ingreso vive en el router de inventario (consulta directa a `production_runs`, sin acoplar los módulos a nivel de servicio).

**Tech Stack:** FastAPI, SQLAlchemy 2.0, Alembic, Pydantic v2, pytest (nuevo en este repo).

## Global Constraints

- El split parcial aplica únicamente a falta de **materia prima**. Falta de insumo o complemento configurado en el proceso sigue revirtiendo la aprobación completa sin partición (sin cambios ahí).
- Una corrida `ESPERANDO_MATERIAL` no se puede cancelar/rechazar desde la interfaz: queda esperando hasta que se le destine material.
- "Destinar material" aprueba e inicia la corrida automáticamente (sin paso manual adicional del jefe de producción).
- No se cambia el comportamiento de cancelación de órdenes en proceso (el sistema ya no lo permite; no se toca).
- No inventar datos de prueba persistentes: los tests usan una transacción que hace rollback siempre, nunca commitean contra la base real.
- Spec de referencia: `docs/superpowers/specs/2026-07-31-produccion-parcial-split-design.md`.

---

## File Structure

- `requirements.txt` — agrega `pytest` (nueva dependencia de desarrollo; no hay ninguna hoy en el repo).
- `pytest.ini` (nuevo, raíz del repo) — configura `testpaths`.
- `backend/tests/__init__.py`, `backend/tests/conftest.py` (nuevos) — fixture de sesión de DB real con rollback por test.
- `backend/tests/production/__init__.py`, `backend/tests/production/test_material_split.py` (nuevo) — cubre split en `approve_materials` y `allocate_material`.
- `backend/tests/inventory/__init__.py`, `backend/tests/inventory/test_waiting_runs.py` (nuevo) — cubre el helper de aviso de ingreso.
- `backend/alembic/versions/b7c8d9e0f1a2_produccion_parcial_split.py` (nuevo) — migración de columnas.
- `backend/modules/production/models.py` — nuevo status, columnas `root_production_code`/`parent_run_id`, quita `unique=True` de `production_code`.
- `backend/modules/production/schemas.py` — `AllocateMaterialPayload`, campos nuevos en `ProductionRunRead`.
- `backend/modules/production/service.py` — `_next_split_code`, `_split_run_for_partial_material`, cambios en `approve_materials`, nuevo `allocate_material`.
- `backend/modules/production/router.py` — endpoint `POST /runs/{run_id}/allocate-material`.
- `backend/modules/inventory/schemas.py` — `WaitingProductionRunSummary`, campo nuevo en `InventoryMovementRead`.
- `backend/modules/inventory/router.py` — helper `_find_waiting_production_runs`, wiring en `create_movement`.

---

### Task 1: Infraestructura de tests (pytest, primera vez en el repo)

**Files:**
- Modify: `requirements.txt`
- Create: `pytest.ini`
- Create: `backend/tests/__init__.py`
- Create: `backend/tests/conftest.py`

**Interfaces:**
- Produces: fixture `db_session` (SQLAlchemy `Session`, conectada a la DB real del contenedor, rollback automático al final de cada test) — la usan todas las tareas siguientes.

- [ ] **Step 1: Agregar pytest a requirements.txt**

Edita `requirements.txt` y agrega al final:

```
pytest==8.3.4
```

- [ ] **Step 2: Instalar pytest en el contenedor corriendo (para poder probar ya, sin rebuild)**

Run: `docker exec erp_joyeria-api-1 pip install --quiet pytest==8.3.4`
Expected: sin errores (el rebuild de imagen que fija esto para siempre lo hace Rodrigo cuando le toque reconstruir el stack; no se toca el ciclo de vida de docker en este plan).

- [ ] **Step 3: Crear pytest.ini en la raíz del repo**

Archivo `pytest.ini`:

```ini
[pytest]
testpaths = backend/tests
python_files = test_*.py
```

- [ ] **Step 4: Crear el paquete de tests**

Archivo `backend/tests/__init__.py` (vacío).

- [ ] **Step 5: Escribir conftest.py con la fixture de sesión con rollback**

Archivo `backend/tests/conftest.py`:

```python
import pytest
from sqlalchemy import create_engine
from sqlalchemy.orm import sessionmaker

from backend.modules.config.settings import settings


@pytest.fixture()
def db_session():
    """Sesion sobre una conexion con una transaccion que siempre se revierte:
    los tests nunca dejan datos en la base real."""
    engine = create_engine(settings.database_url)
    connection = engine.connect()
    transaction = connection.begin()
    session_factory = sessionmaker(bind=connection, autoflush=False, autocommit=False)
    session = session_factory()
    try:
        yield session
    finally:
        session.close()
        transaction.rollback()
        connection.close()
        engine.dispose()
```

- [ ] **Step 6: Test de humo para confirmar que la fixture conecta y revierte**

Archivo `backend/tests/test_conftest_smoke.py`:

```python
import uuid

from sqlalchemy import text

from backend.modules.inventory.models import InventoryItem


def test_db_session_rolls_back(db_session):
    sku = f"SMOKE-{uuid.uuid4().hex[:8]}"
    item = InventoryItem(
        item_type="RAW_MATERIAL",
        name="Item de humo",
        sku=sku,
        unit_code="g",
        current_stock=0,
    )
    db_session.add(item)
    db_session.flush()
    found = db_session.execute(
        text("SELECT sku FROM inventory_items WHERE sku = :sku"), {"sku": sku}
    ).scalar_one_or_none()
    assert found == sku
```

- [ ] **Step 7: Correr el test y verificar que pasa**

Run: `docker exec -w /app erp_joyeria-api-1 python -m pytest backend/tests/test_conftest_smoke.py -v`
Expected: `1 passed`

- [ ] **Step 8: Confirmar que el rollback realmente no dejó el registro (corre el mismo test dos veces)**

Run: `docker exec -w /app erp_joyeria-api-1 python -m pytest backend/tests/test_conftest_smoke.py -v`
Expected: `1 passed` de nuevo (si el rollback fallara, la segunda corrida chocaría con un `sku` duplicado solo si reusaras el mismo sku fijo; aquí cada corrida genera un sku random, así que la señal real de rollback correcto es que **no queda basura** — verifícalo con:)

Run: `docker exec erp_joyeria-db-1 psql -U erp_joyeria -d erp_joyeria -t -c "SELECT count(*) FROM inventory_items WHERE sku LIKE 'SMOKE-%';"`
Expected: `0`

- [ ] **Step 9: Commit**

```bash
git add requirements.txt pytest.ini backend/tests/__init__.py backend/tests/conftest.py backend/tests/test_conftest_smoke.py
git commit -m "test: agrega infraestructura pytest con sesion de DB en transaccion revertida"
```

---

### Task 2: Migración Alembic — columnas de split

**Files:**
- Create: `backend/alembic/versions/b7c8d9e0f1a2_produccion_parcial_split.py`

**Interfaces:**
- Produces: columnas `production_runs.root_production_code` (String(30), nullable, índice no-único) y `production_runs.parent_run_id` (UUID, FK a `production_runs.id`, nullable) — las usan Task 3 (modelo) y en adelante.
- Consumes: cabeza actual de Alembic `d8e9f0a1b2c3` (confirmado con `alembic heads` en el contenedor).

- [ ] **Step 1: Escribir la migración**

Archivo `backend/alembic/versions/b7c8d9e0f1a2_produccion_parcial_split.py`:

```python
"""produccion parcial: split de ordenes por falta de materia prima

Revision ID: b7c8d9e0f1a2
Revises: d8e9f0a1b2c3
Create Date: 2026-07-31
"""
import sqlalchemy as sa
from alembic import op
from sqlalchemy.dialects import postgresql

revision = "b7c8d9e0f1a2"
down_revision = "d8e9f0a1b2c3"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.add_column(
        "production_runs",
        sa.Column("root_production_code", sa.String(30), nullable=True),
    )
    op.add_column(
        "production_runs",
        sa.Column(
            "parent_run_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("production_runs.id", ondelete="SET NULL"),
            nullable=True,
        ),
    )
    op.create_index(
        "ix_production_runs_root_production_code",
        "production_runs",
        ["root_production_code"],
    )
    # production_code deja de ser unico: una orden partida por falta de
    # materia prima genera corridas hijas con el mismo folio raiz y un
    # sufijo propio (OP-2026-0001-B). El folio raiz es el "certificado".
    op.drop_index("ix_production_runs_production_code", table_name="production_runs")
    op.create_index(
        "ix_production_runs_production_code",
        "production_runs",
        ["production_code"],
    )
    op.execute("UPDATE production_runs SET root_production_code = production_code")


def downgrade() -> None:
    op.drop_index("ix_production_runs_production_code", table_name="production_runs")
    op.create_index(
        "ix_production_runs_production_code",
        "production_runs",
        ["production_code"],
        unique=True,
    )
    op.drop_index("ix_production_runs_root_production_code", table_name="production_runs")
    op.drop_column("production_runs", "parent_run_id")
    op.drop_column("production_runs", "root_production_code")
```

- [ ] **Step 2: Aplicar la migración en la DB del contenedor**

Run: `docker exec erp_joyeria-api-1 alembic upgrade head`
Expected: última línea `Running upgrade d8e9f0a1b2c3 -> b7c8d9e0f1a2, produccion parcial: split de ordenes por falta de materia prima`

- [ ] **Step 3: Verificar las columnas en la DB**

Run: `docker exec erp_joyeria-db-1 psql -U erp_joyeria -d erp_joyeria -c "\d production_runs" `
Expected: aparecen `root_production_code` y `parent_run_id`; el índice `ix_production_runs_production_code` ya **no** dice `UNIQUE`.

- [ ] **Step 4: Commit**

```bash
git add backend/alembic/versions/b7c8d9e0f1a2_produccion_parcial_split.py
git commit -m "feat(db): columnas root_production_code y parent_run_id para split de produccion"
```

---

### Task 3: Modelo — nuevo estado y columnas en `ProductionRun`

**Files:**
- Modify: `backend/modules/production/models.py:132-138` (clase `ProductionRunStatus`)
- Modify: `backend/modules/production/models.py:180` (columna `production_code`)

**Interfaces:**
- Consumes: columnas de Task 2.
- Produces: `ProductionRunStatus.WAITING_MATERIAL = "ESPERANDO_MATERIAL"`, atributos `ProductionRun.root_production_code: str | None` y `ProductionRun.parent_run_id: PyUUID | None` — los usa Task 5, 6, 7.

- [ ] **Step 1: Agregar el nuevo status**

En `backend/modules/production/models.py`, reemplaza:

```python
class ProductionRunStatus:
    PENDING_INVENTORY = "PENDIENTE_INVENTARIO"
    MATERIALS_APPROVED = "MATERIALES_APROBADOS"
    IN_PROGRESS = "EN_PROCESO"
    PENDING_RECEPTION = "PENDIENTE_RECEPCION"
    RECEIVED = "RECIBIDA"
    CANCELLED = "CANCELADA"
```

por:

```python
class ProductionRunStatus:
    PENDING_INVENTORY = "PENDIENTE_INVENTARIO"
    # Corrida creada por split (falta materia prima): no entra en la cola
    # normal de aprobacion; solo se activa cuando inventario le destina
    # material desde un ingreso nuevo (ver ProductionService.allocate_material).
    WAITING_MATERIAL = "ESPERANDO_MATERIAL"
    MATERIALS_APPROVED = "MATERIALES_APROBADOS"
    IN_PROGRESS = "EN_PROCESO"
    PENDING_RECEPTION = "PENDIENTE_RECEPCION"
    RECEIVED = "RECIBIDA"
    CANCELLED = "CANCELADA"
```

- [ ] **Step 2: Agregar las columnas nuevas y quitar la unicidad de `production_code`**

En la clase `ProductionRun`, reemplaza:

```python
    production_code: Mapped[str | None] = mapped_column(String(30), nullable=True, unique=True, index=True)
```

por:

```python
    # Ya no es unico: una orden partida por falta de materia prima genera
    # corridas hijas con el mismo root_production_code (el "certificado") y
    # su propio production_code con sufijo (OP-2026-0001-B, -C, ...).
    production_code: Mapped[str | None] = mapped_column(String(30), nullable=True, index=True)
    root_production_code: Mapped[str | None] = mapped_column(String(30), nullable=True, index=True)
    parent_run_id: Mapped[PyUUID | None] = mapped_column(
        ForeignKey("production_runs.id", ondelete="SET NULL"), nullable=True
    )
```

- [ ] **Step 3: Verificar que el módulo importa sin errores**

Run: `docker exec -w /app erp_joyeria-api-1 python -c "from backend.modules.production import models; print(models.ProductionRunStatus.WAITING_MATERIAL)"`
Expected: `ESPERANDO_MATERIAL`

- [ ] **Step 4: Commit**

```bash
git add backend/modules/production/models.py
git commit -m "feat(produccion): estado ESPERANDO_MATERIAL y columnas de split en ProductionRun"
```

---

### Task 4: Schemas — payload de destinar material y campos nuevos en el read

**Files:**
- Modify: `backend/modules/production/schemas.py`

**Interfaces:**
- Produces: `AllocateMaterialPayload(quantity_units: Decimal)` — la consume Task 8 (router). `ProductionRunRead.root_production_code`, `ProductionRunRead.parent_run_id` — los consume el frontend en un plan posterior.

- [ ] **Step 1: Agregar `AllocateMaterialPayload`**

En `backend/modules/production/schemas.py`, justo debajo de `MaterialRejectPayload`:

```python
class AllocateMaterialPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")

    # En unidades de producto (piezas), no en peso: inventario piensa en
    # "cuantas piezas cubro", no convierte gramos a mano.
    quantity_units: Decimal = Field(gt=0, decimal_places=0)
```

- [ ] **Step 2: Agregar los campos nuevos a `ProductionRunRead`**

En `ProductionRunRead`, después de la línea `production_code: str | None = None`, agrega:

```python
    root_production_code: str | None = None
    parent_run_id: UUID | None = None
```

- [ ] **Step 3: Verificar que el módulo importa sin errores**

Run: `docker exec -w /app erp_joyeria-api-1 python -c "from backend.modules.production import schemas; schemas.AllocateMaterialPayload(quantity_units=5)"`
Expected: sin excepción.

- [ ] **Step 4: Commit**

```bash
git add backend/modules/production/schemas.py
git commit -m "feat(produccion): schema AllocateMaterialPayload y campos de folio raiz en ProductionRunRead"
```

---

### Task 5: Servicio — helpers de split (`_next_split_code`, `_split_run_for_partial_material`)

**Files:**
- Modify: `backend/modules/production/service.py` (agrega métodos privados a `ProductionService`, colócalos justo antes de `def approve_materials`, línea 562)
- Test: `backend/tests/production/__init__.py` (nuevo, vacío)
- Test: `backend/tests/production/conftest.py` (nuevo — fixtures compartidas de esta carpeta)
- Test: `backend/tests/production/test_material_split.py` (nuevo)

**Interfaces:**
- Consumes: `ProductionRunStatus.WAITING_MATERIAL`, `ProductionRun.root_production_code/parent_run_id` (Task 3).
- Produces: `ProductionService._split_run_for_partial_material(run: ProductionRun, covered_qty: Decimal) -> ProductionRun` (devuelve la corrida hija ya persistida con `flush()`) y `ProductionService._next_split_code(root_code: str) -> str` — los consume Task 6 y Task 7.

- [ ] **Step 1: Crear las fixtures compartidas de producción**

Archivo `backend/tests/production/__init__.py` (vacío).

Archivo `backend/tests/production/conftest.py`:

```python
import uuid
from decimal import Decimal

import pytest

from backend.modules.auth.dependencies import CurrentUser
from backend.modules.inventory.models import InventoryItem
from backend.modules.inventory.repository import InventoryRepository
from backend.modules.inventory.service import InventoryService
from backend.modules.production.models import (
    ProductionProcess,
    ProductionProcessMaterial,
    ProductionProcessStage,
)
from backend.modules.production.repository import ProductionProcessRepository
from backend.modules.production.service import ProductionService


@pytest.fixture()
def current_user() -> CurrentUser:
    return CurrentUser(id=uuid.uuid4(), username="jefe_test", role="Jefe de producción", permissions=frozenset())


@pytest.fixture()
def production_service(db_session) -> ProductionService:
    return ProductionService(
        repository=ProductionProcessRepository(db_session),
        inventory_service=InventoryService(repository=InventoryRepository(db_session)),
    )


@pytest.fixture()
def raw_material(db_session) -> InventoryItem:
    item = InventoryItem(
        item_type="RAW_MATERIAL",
        name="Oro test",
        sku=f"MP-TEST-{uuid.uuid4().hex[:8]}",
        unit_code="g",
        current_stock=Decimal("0"),
    )
    db_session.add(item)
    db_session.flush()
    return item


@pytest.fixture()
def target_complement(db_session) -> InventoryItem:
    item = InventoryItem(
        item_type="COMPLEMENT",
        name="Base test",
        sku=f"CO-TEST-{uuid.uuid4().hex[:8]}",
        unit_code="und",
        current_stock=Decimal("0"),
    )
    db_session.add(item)
    db_session.flush()
    return item


@pytest.fixture()
def process(db_session, raw_material) -> ProductionProcess:
    proc = ProductionProcess(
        name=f"Proceso test {uuid.uuid4().hex[:6]}",
        waste_limit_percent=Decimal("1"),
        is_active=True,
        materials=[
            ProductionProcessMaterial(
                inventory_item_id=raw_material.id,
                quantity_per_unit=Decimal("10"),
                unit_code="g",
            )
        ],
        stages=[
            ProductionProcessStage(
                name="Etapa unica",
                stage_type="PROCESS",
                stage_order=1,
                is_active=True,
                requires_weighing=False,
            )
        ],
    )
    db_session.add(proc)
    db_session.flush()
    return proc
```

- [ ] **Step 2: Escribir el test que exige la existencia de los helpers (falla primero)**

Archivo `backend/tests/production/test_material_split.py`:

```python
from decimal import Decimal

from backend.modules.production.models import ProductionRunStatus
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


def test_split_run_creates_waiting_child_with_shared_root_code(
    db_session, production_service, current_user, process, raw_material, target_complement
):
    raw_material.current_stock = Decimal("600")  # alcanza para 60 de 100 unidades (10g c/u)
    db_session.flush()

    run_read = _create_run(production_service, current_user, process, raw_material, target_complement, 100)
    run = production_service.repository.get_run(run_read.id)

    child = production_service._split_run_for_partial_material(run, Decimal("60"))

    assert run.quantity == Decimal("60")
    assert run.total_required_material == Decimal("600")
    assert run.root_production_code == run.production_code

    assert child.status == ProductionRunStatus.WAITING_MATERIAL
    assert child.quantity == Decimal("40")
    assert child.parent_run_id == run.id
    assert child.root_production_code == run.root_production_code
    assert child.production_code == f"{run.production_code}-B"
    assert len(child.stages) == 1
    assert child.stages[0].stage_name == "Etapa unica"

    # El plan de productos se reparte exacto: 60 al padre, 40 a la hija.
    assert sum(p.quantity for p in run.products) == Decimal("60")
    assert sum(p.quantity for p in child.products) == Decimal("40")


def test_next_split_code_increments_letter_per_child(
    db_session, production_service, current_user, process, raw_material, target_complement
):
    raw_material.current_stock = Decimal("600")
    db_session.flush()
    run_read = _create_run(production_service, current_user, process, raw_material, target_complement, 100)
    run = production_service.repository.get_run(run_read.id)

    first_child = production_service._split_run_for_partial_material(run, Decimal("60"))
    second_child = production_service._split_run_for_partial_material(first_child, Decimal("25"))

    assert first_child.production_code == f"{run.production_code}-B"
    assert second_child.production_code == f"{run.production_code}-C"
    assert second_child.root_production_code == run.production_code
```

- [ ] **Step 3: Correr el test y verificar que falla (el método no existe todavía)**

Run: `docker exec -w /app erp_joyeria-api-1 python -m pytest backend/tests/production/test_material_split.py -v`
Expected: `AttributeError: 'ProductionService' object has no attribute '_split_run_for_partial_material'`

- [ ] **Step 4: Implementar `_next_split_code` y `_split_run_for_partial_material`**

En `backend/modules/production/service.py`, inmediatamente antes de `def approve_materials(self, run_id: UUID, current_user: CurrentUser) -> ProductionRunRead:` (línea 562), agrega estos dos métodos a la clase `ProductionService`:

```python
    def _next_split_code(self, root_code: str) -> str:
        """Siguiente sufijo de folio para una corrida hija: -B, -C, -D... El
        folio raiz (sin sufijo) es siempre la corrida original."""
        from sqlalchemy import select

        existing_codes = self.repository.session.execute(
            select(ProductionRun.production_code).where(
                ProductionRun.root_production_code == root_code
            )
        ).scalars().all()
        used_suffixes = {
            code.rsplit("-", 1)[-1]
            for code in existing_codes
            if code and code.startswith(f"{root_code}-")
        }
        letter_index = 1
        while True:
            letter = chr(ord("A") + letter_index)
            if letter not in used_suffixes:
                return f"{root_code}-{letter}"
            letter_index += 1

    def _split_run_for_partial_material(self, run: ProductionRun, covered_qty: Decimal) -> ProductionRun:
        """Reduce `run` a `covered_qty` unidades y crea una corrida hija
        ESPERANDO_MATERIAL con el remanente, mismo folio raiz. Reparte el plan
        de productos (piezas enteras, llenado del padre primero) y los
        complementos solicitados (proporcional) entre ambas."""
        original_quantity = run.quantity
        missing_qty = original_quantity - covered_qty
        root_code = run.root_production_code or run.production_code

        child = ProductionRun(
            process_id=run.process_id,
            process_name=run.process_name,
            quantity=missing_qty,
            status=ProductionRunStatus.WAITING_MATERIAL,
            assembly_mode=run.assembly_mode,
            raw_material_item_id=run.raw_material_item_id,
            raw_material_quantity_per_unit=run.raw_material_quantity_per_unit,
            raw_material_unit_code=run.raw_material_unit_code,
            total_required_material=run.raw_material_quantity_per_unit * missing_qty,
            waste_limit_percent=run.waste_limit_percent,
            expected_finished_weight=run.raw_material_quantity_per_unit * missing_qty,
            created_by_user_id=run.created_by_user_id,
            target_product_type_id=run.target_product_type_id,
            requested_at=datetime.utcnow(),
            root_production_code=root_code,
            parent_run_id=run.id,
        )
        child.production_code = self._next_split_code(root_code)

        process = self.repository.get(run.process_id)
        active_stages = (
            sorted((s for s in process.stages if s.is_active), key=lambda s: s.stage_order)
            if process is not None
            else []
        )
        run_seq = int(child.production_code.split("-")[2]) if child.production_code else 0
        for stage in active_stages:
            child.stages.append(
                ProductionRunStage(
                    source_stage_id=stage.id,
                    stage_name=stage.name,
                    phase_name=stage.phase_name,
                    stage_type=stage.stage_type,
                    quality_check=stage.quality_check,
                    rework_action=stage.rework_action,
                    rework_target_order=stage.rework_target_order,
                    stage_order=stage.stage_order,
                    requires_weighing=stage.requires_weighing,
                    status=ProductionRunStageStatus.PENDING,
                    stage_code=_stage_code_for(stage.name, run_seq, stage.stage_order),
                )
            )

        # Plan de productos: piezas enteras, se llena el padre en el orden de
        # las lineas declaradas y el remanente de cada linea va a la hija.
        # Sin division/redondeo: la suma siempre cuadra exacto.
        remaining_parent_capacity = covered_qty
        for product in list(run.products):
            take = min(product.quantity, remaining_parent_capacity)
            remaining_parent_capacity -= take
            child_take = product.quantity - take
            product.quantity = take
            if child_take > 0:
                child.products.append(
                    ProductionRunProduct(
                        product_type_id=product.product_type_id,
                        target_item_id=product.target_item_id,
                        quantity=child_take,
                    )
                )
        run.products = [product for product in run.products if product.quantity > 0]

        # Complementos: proporcional (no son piezas enteras necesariamente).
        ratio_missing = missing_qty / original_quantity
        for complement in list(run.complements):
            child_qty = complement.quantity * ratio_missing
            complement.quantity = complement.quantity - child_qty
            if child_qty > 0:
                child.complements.append(
                    ProductionComplementRequest(
                        item_id=complement.item_id,
                        quantity=child_qty,
                        unit_code=complement.unit_code,
                        status=ComplementRequestStatus.PENDING,
                    )
                )

        run.quantity = covered_qty
        run.total_required_material = run.raw_material_quantity_per_unit * covered_qty
        run.expected_finished_weight = run.total_required_material
        run.root_production_code = root_code

        self.repository.add_run(child)
        self.repository.flush()
        return child
```

- [ ] **Step 5: Correr los tests y verificar que pasan**

Run: `docker exec -w /app erp_joyeria-api-1 python -m pytest backend/tests/production/test_material_split.py -v`
Expected: `2 passed`

- [ ] **Step 6: Commit**

```bash
git add backend/tests/production/ backend/modules/production/service.py
git commit -m "feat(produccion): split de corridas por falta de materia prima (helpers)"
```

---

### Task 6: Servicio — `approve_materials` parte automáticamente cuando falta materia prima

**Files:**
- Modify: `backend/modules/production/service.py:562-579` (inicio de `approve_materials`)
- Test: `backend/tests/production/test_material_split.py` (agrega casos)

**Interfaces:**
- Consumes: `ProductionService._split_run_for_partial_material` (Task 5).
- Produces: comportamiento nuevo de `approve_materials` — split automático si falta materia prima y el stock cubre al menos 1 unidad; error igual que antes si no cubre ninguna. Sin cambios en la firma.

- [ ] **Step 1: Agregar los casos de test (fallan porque `approve_materials` aún no parte)**

Agrega al final de `backend/tests/production/test_material_split.py`:

```python
from backend.modules.production.service import ProductionDomainError


def test_approve_materials_splits_when_stock_insufficient(
    db_session, production_service, current_user, process, raw_material, target_complement
):
    raw_material.current_stock = Decimal("600")
    db_session.flush()
    run_read = _create_run(production_service, current_user, process, raw_material, target_complement, 100)

    approved = production_service.approve_materials(run_read.id, current_user)

    assert approved.status == "MATERIALES_APROBADOS"
    assert approved.quantity == Decimal("60")
    db_session.refresh(raw_material)
    assert raw_material.current_stock == Decimal("0")

    children = [
        r for r in production_service.repository.list_runs()
        if r.parent_run_id == approved.id
    ]
    assert len(children) == 1
    assert children[0].status == "ESPERANDO_MATERIAL"
    assert children[0].quantity == Decimal("40")
    assert children[0].root_production_code == approved.production_code


def test_approve_materials_no_split_when_stock_sufficient(
    db_session, production_service, current_user, process, raw_material, target_complement
):
    raw_material.current_stock = Decimal("2000")
    db_session.flush()
    run_read = _create_run(production_service, current_user, process, raw_material, target_complement, 100)

    approved = production_service.approve_materials(run_read.id, current_user)

    assert approved.status == "MATERIALES_APROBADOS"
    assert approved.quantity == Decimal("100")
    children = [
        r for r in production_service.repository.list_runs()
        if r.parent_run_id == approved.id
    ]
    assert children == []


def test_approve_materials_raises_when_stock_covers_zero_units(
    db_session, production_service, current_user, process, raw_material, target_complement
):
    raw_material.current_stock = Decimal("5")  # menos de 10g (1 unidad)
    db_session.flush()
    run_read = _create_run(production_service, current_user, process, raw_material, target_complement, 100)

    import pytest

    with pytest.raises(ProductionDomainError, match="Stock insuficiente"):
        production_service.approve_materials(run_read.id, current_user)

    run = production_service.repository.get_run(run_read.id)
    assert run.status == "PENDIENTE_INVENTARIO"
```

- [ ] **Step 2: Correr los tests y verificar que fallan**

Run: `docker exec -w /app erp_joyeria-api-1 python -m pytest backend/tests/production/test_material_split.py -v -k approve_materials`
Expected: `test_approve_materials_splits_when_stock_insufficient` falla (hoy `approve_materials` lanza `ProductionDomainError` en vez de partir); `test_approve_materials_no_split_when_stock_sufficient` puede pasar ya (comportamiento sin cambios); `test_approve_materials_raises_when_stock_covers_zero_units` puede pasar ya.

- [ ] **Step 3: Modificar `approve_materials` para partir automáticamente**

En `backend/modules/production/service.py`, reemplaza el inicio de `approve_materials` (desde `def approve_materials` hasta el primer `try/except` del consumo de materia prima, líneas 562-579):

```python
    def approve_materials(self, run_id: UUID, current_user: CurrentUser) -> ProductionRunRead:
        if self.inventory_service is None:
            raise ProductionDomainError("Inventario no esta disponible para aprobar materiales.")
        run = self.repository.get_run(run_id)
        if run is None:
            raise ProductionNotFoundError("Orden de produccion no encontrada.")
        if run.status != ProductionRunStatus.PENDING_INVENTORY:
            raise ProductionDomainError("Solo se pueden aprobar materiales de ordenes pendientes de Inventario.")

        from backend.modules.inventory.models import InventoryItem

        raw_material = self.repository.session.get(InventoryItem, run.raw_material_item_id)
        if raw_material is None:
            raise ProductionDomainError("La materia prima de la orden ya no existe en inventario.")

        # Si falta materia prima, la orden se parte: la porcion que el stock
        # alcanza a cubrir sigue su curso normal aqui mismo; el remanente
        # queda como corrida hija ESPERANDO_MATERIAL bajo el mismo folio raiz
        # (ver ProductionService.allocate_material para como se resuelve).
        if raw_material.current_stock < run.total_required_material:
            covered_qty = raw_material.current_stock // run.raw_material_quantity_per_unit
            if covered_qty <= 0:
                raise ProductionDomainError(
                    f"Stock insuficiente de '{raw_material.name}': disponible "
                    f"{raw_material.current_stock} {raw_material.unit_code}, se requieren "
                    f"{run.raw_material_quantity_per_unit} {raw_material.unit_code} para 1 unidad."
                )
            self._split_run_for_partial_material(run, covered_qty)

        try:
            self.inventory_service.consume_material_for_production(
                item_id=run.raw_material_item_id,
                quantity=run.total_required_material,
                production_run_id=run.id,
                user_id=current_user.id,
                production_code=run.production_code,
            )
        except InventoryDomainError as exc:
            raise ProductionDomainError(str(exc)) from exc
```

El resto del método (insumos por etapa, complementos, `run.status = ProductionRunStatus.MATERIALS_APPROVED`, etc.) queda exactamente igual — no lo toques.

- [ ] **Step 4: Correr los tests y verificar que pasan**

Run: `docker exec -w /app erp_joyeria-api-1 python -m pytest backend/tests/production/test_material_split.py -v`
Expected: `5 passed`

- [ ] **Step 5: Commit**

```bash
git add backend/modules/production/service.py backend/tests/production/test_material_split.py
git commit -m "feat(produccion): approve_materials parte la orden cuando falta materia prima"
```

---

### Task 7: Servicio — `allocate_material` ("destinar al proceso faltante")

**Files:**
- Modify: `backend/modules/production/service.py` (nuevo método `allocate_material`, colócalo justo después de `reject_materials`, antes de `start_run`)
- Test: `backend/tests/production/test_allocate_material.py` (nuevo)

**Interfaces:**
- Consumes: `ProductionService._split_run_for_partial_material` (Task 5), `approve_materials`/`start_run` existentes.
- Produces: `ProductionService.allocate_material(run_id: UUID, quantity_units: Decimal, current_user: CurrentUser) -> ProductionRunRead` — lo consume Task 8 (router).

- [ ] **Step 1: Escribir los tests (fallan porque el método no existe)**

Archivo `backend/tests/production/test_allocate_material.py`:

```python
from decimal import Decimal

import pytest

from backend.modules.production.service import ProductionDomainError, ProductionNotFoundError
from backend.tests.production.test_material_split import _create_run


def _create_waiting_child(production_service, current_user, process, raw_material, target_complement):
    """100 unidades pedidas, stock alcanza para 60: aprobar parte y deja una
    hija ESPERANDO_MATERIAL de 40 unidades. Devuelve (padre_id, hija)."""
    raw_material.current_stock = Decimal("600")
    run_read = _create_run(production_service, current_user, process, raw_material, target_complement, 100)
    approved = production_service.approve_materials(run_read.id, current_user)
    children = [
        r for r in production_service.repository.list_runs() if r.parent_run_id == approved.id
    ]
    return approved.id, children[0]


def test_allocate_material_full_amount_starts_run(
    db_session, production_service, current_user, process, raw_material, target_complement
):
    _, child = _create_waiting_child(production_service, current_user, process, raw_material, target_complement)
    raw_material.current_stock = Decimal("400")  # cubre las 40 unidades faltantes
    db_session.flush()

    result = production_service.allocate_material(child.id, Decimal("40"), current_user)

    assert result.status == "EN_PROCESO"
    assert result.quantity == Decimal("40")
    db_session.refresh(raw_material)
    assert raw_material.current_stock == Decimal("0")
    grandchildren = [
        r for r in production_service.repository.list_runs() if r.parent_run_id == child.id
    ]
    assert grandchildren == []


def test_allocate_material_partial_amount_splits_again(
    db_session, production_service, current_user, process, raw_material, target_complement
):
    _, child = _create_waiting_child(production_service, current_user, process, raw_material, target_complement)
    raw_material.current_stock = Decimal("250")  # solo cubre 25 de las 40 faltantes
    db_session.flush()

    result = production_service.allocate_material(child.id, Decimal("25"), current_user)

    assert result.status == "EN_PROCESO"
    assert result.quantity == Decimal("25")
    grandchildren = [
        r for r in production_service.repository.list_runs() if r.parent_run_id == child.id
    ]
    assert len(grandchildren) == 1
    assert grandchildren[0].status == "ESPERANDO_MATERIAL"
    assert grandchildren[0].quantity == Decimal("15")
    assert grandchildren[0].root_production_code == child.root_production_code
    assert grandchildren[0].production_code == f"{child.root_production_code}-C"


def test_allocate_material_rejects_more_than_needed(
    db_session, production_service, current_user, process, raw_material, target_complement
):
    _, child = _create_waiting_child(production_service, current_user, process, raw_material, target_complement)

    with pytest.raises(ProductionDomainError, match="No puedes destinar mas"):
        production_service.allocate_material(child.id, Decimal("999"), current_user)


def test_allocate_material_rejects_insufficient_stock(
    db_session, production_service, current_user, process, raw_material, target_complement
):
    _, child = _create_waiting_child(production_service, current_user, process, raw_material, target_complement)
    raw_material.current_stock = Decimal("100")  # solo cubre 10 de las 40 pedidas
    db_session.flush()

    with pytest.raises(ProductionDomainError, match="Stock insuficiente"):
        production_service.allocate_material(child.id, Decimal("40"), current_user)


def test_allocate_material_rejects_wrong_status(
    db_session, production_service, current_user, process, raw_material, target_complement
):
    raw_material.current_stock = Decimal("2000")
    run_read = _create_run(production_service, current_user, process, raw_material, target_complement, 100)

    with pytest.raises(ProductionDomainError, match="ESPERANDO_MATERIAL"):
        production_service.allocate_material(run_read.id, Decimal("10"), current_user)


def test_allocate_material_missing_run_raises_not_found(production_service, current_user):
    import uuid

    with pytest.raises(ProductionNotFoundError):
        production_service.allocate_material(uuid.uuid4(), Decimal("1"), current_user)
```

- [ ] **Step 2: Correr los tests y verificar que fallan**

Run: `docker exec -w /app erp_joyeria-api-1 python -m pytest backend/tests/production/test_allocate_material.py -v`
Expected: `AttributeError: 'ProductionService' object has no attribute 'allocate_material'`

- [ ] **Step 3: Implementar `allocate_material`**

En `backend/modules/production/service.py`, agrega este método a la clase `ProductionService` inmediatamente después de `reject_materials` (antes de `def start_run`):

```python
    def allocate_material(
        self, run_id: UUID, quantity_units: Decimal, current_user: CurrentUser
    ) -> ProductionRunRead:
        """Inventario destina un ingreso nuevo a una corrida ESPERANDO_MATERIAL:
        aprueba materiales e inicia la corrida automaticamente. Si el ingreso no
        alcanza para toda la corrida, la parte de nuevo (mismo folio raiz)."""
        run = self.repository.get_run(run_id)
        if run is None:
            raise ProductionNotFoundError("Orden de produccion no encontrada.")
        if run.status != ProductionRunStatus.WAITING_MATERIAL:
            raise ProductionDomainError(
                "Solo se puede destinar material a ordenes en estado ESPERANDO_MATERIAL."
            )
        if quantity_units <= 0:
            raise ProductionDomainError("La cantidad a destinar debe ser mayor a cero.")
        if quantity_units > run.quantity:
            raise ProductionDomainError("No puedes destinar mas unidades de las que la orden necesita.")

        from backend.modules.inventory.models import InventoryItem

        raw_material = self.repository.session.get(InventoryItem, run.raw_material_item_id)
        if raw_material is None:
            raise ProductionDomainError("La materia prima de la orden ya no existe en inventario.")

        required_material = run.raw_material_quantity_per_unit * quantity_units
        if raw_material.current_stock < required_material:
            raise ProductionDomainError(
                f"Stock insuficiente de '{raw_material.name}': disponible "
                f"{raw_material.current_stock} {raw_material.unit_code}, se requieren "
                f"{required_material} {raw_material.unit_code}."
            )

        if quantity_units < run.quantity:
            self._split_run_for_partial_material(run, quantity_units)

        run.status = ProductionRunStatus.PENDING_INVENTORY
        self.repository.flush()
        self.approve_materials(run.id, current_user)
        return self.start_run(run.id, current_user)
```

- [ ] **Step 4: Correr los tests y verificar que pasan**

Run: `docker exec -w /app erp_joyeria-api-1 python -m pytest backend/tests/production/test_allocate_material.py -v`
Expected: `6 passed`

- [ ] **Step 5: Correr toda la suite de producción para confirmar que nada se rompió**

Run: `docker exec -w /app erp_joyeria-api-1 python -m pytest backend/tests/production/ -v`
Expected: todos los tests pasan (los de Task 5 y 6 incluidos).

- [ ] **Step 6: Commit**

```bash
git add backend/modules/production/service.py backend/tests/production/test_allocate_material.py
git commit -m "feat(produccion): allocate_material destina un ingreso a una corrida ESPERANDO_MATERIAL"
```

---

### Task 8: Router — endpoint `POST /runs/{run_id}/allocate-material`

**Files:**
- Modify: `backend/modules/production/router.py`

**Interfaces:**
- Consumes: `ProductionService.allocate_material` (Task 7), `AllocateMaterialPayload` (Task 4).
- Produces: endpoint HTTP nuevo, sin cambios de firma en nada existente.

- [ ] **Step 1: Importar el schema nuevo**

En `backend/modules/production/router.py`, reemplaza el bloque de import de `backend.modules.production.schemas` (líneas 10-22):

```python
from backend.modules.production.schemas import (
    AssemblyRecipeRead,
    AssemblyRecipeUpsert,
    ProductionProcessCreate,
    ProductionProcessRead,
    ProductionProcessUpdate,
    ProductionRunCreate,
    ProductionRunRead,
    MaterialRejectPayload,
    ProductionRunStageFinish,
    RunAssemblyDefine,
    RunProductsUpdate,
)
```

por:

```python
from backend.modules.production.schemas import (
    AllocateMaterialPayload,
    AssemblyRecipeRead,
    AssemblyRecipeUpsert,
    ProductionProcessCreate,
    ProductionProcessRead,
    ProductionProcessUpdate,
    ProductionRunCreate,
    ProductionRunRead,
    MaterialRejectPayload,
    ProductionRunStageFinish,
    RunAssemblyDefine,
    RunProductsUpdate,
)
```

- [ ] **Step 2: Agregar el endpoint**

Después de `reject_run_materials` (línea 188) y antes de `start_run` (línea 190), agrega:

```python
@router.post("/runs/{run_id}/allocate-material", response_model=ProductionRunRead)
def allocate_run_material(
    run_id: UUID,
    payload: AllocateMaterialPayload,
    current_user: CurrentUser = Depends(get_current_user),
    service: ProductionService = Depends(get_production_service),
) -> ProductionRunRead:
    # Igual que approve-materials: inventario puede destinar material a una
    # orden que quedo esperando por falta de stock.
    ensure_permission(current_user, "production.runs.update")
    try:
        return service.allocate_material(run_id, payload.quantity_units, current_user)
    except ProductionNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except ProductionDomainError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc
```

- [ ] **Step 3: Verificar que la app arranca sin errores de import**

Run: `docker exec erp_joyeria-api-1 python -c "from backend.app.main import app; print('ok')"`
Expected: `ok`

- [ ] **Step 4: Probar el endpoint manualmente contra la API viva**

Con el stack corriendo, entra a `http://localhost:8001/docs` (Swagger, `ENABLE_DOCS=true` en desarrollo) e inicia sesión como jefe de inventario o admin para tener la cookie de sesión; confirma que aparece `POST /api/production-orders/runs/{run_id}/allocate-material` (el prefijo real de montaje lo define `backend/app/main.py` — verifícalo ahí si el path no coincide) y que devuelve 404/409 con los mensajes esperados al probarlo contra una orden que no está en `ESPERANDO_MATERIAL`.

- [ ] **Step 5: Commit**

```bash
git add backend/modules/production/router.py
git commit -m "feat(produccion): endpoint POST runs/{id}/allocate-material"
```

---

### Task 9: Inventario — schema del aviso de órdenes esperando material

**Files:**
- Modify: `backend/modules/inventory/schemas.py`

**Interfaces:**
- Produces: `WaitingProductionRunSummary(run_id, production_code, root_production_code, missing_quantity)`, campo `InventoryMovementRead.waiting_production_runs: list[WaitingProductionRunSummary]` (default `[]`, no rompe a nadie que ya consuma `InventoryMovementRead`) — los consume Task 10.

- [ ] **Step 1: Agregar el schema y el campo**

En `backend/modules/inventory/schemas.py`, justo antes de `class InventoryMovementRead(BaseModel):`, agrega:

```python
class WaitingProductionRunSummary(BaseModel):
    model_config = ConfigDict(from_attributes=True, extra="forbid")

    run_id: UUID
    production_code: str | None = None
    root_production_code: str | None = None
    missing_quantity: Decimal
```

Y dentro de `InventoryMovementRead`, agrega al final de la lista de campos:

```python
    # Ordenes ESPERANDO_MATERIAL de esta materia prima: se llena solo en la
    # respuesta de un ENTRADA, para que el frontend ofrezca "destinar".
    waiting_production_runs: list[WaitingProductionRunSummary] = Field(default_factory=list)
```

- [ ] **Step 2: Verificar que el módulo importa sin errores**

Run: `docker exec erp_joyeria-api-1 python -c "from backend.modules.inventory import schemas; print(schemas.WaitingProductionRunSummary)"`
Expected: imprime la clase sin excepción.

- [ ] **Step 3: Commit**

```bash
git add backend/modules/inventory/schemas.py
git commit -m "feat(inventario): schema WaitingProductionRunSummary para el aviso de ingreso"
```

---

### Task 10: Inventario — aviso de órdenes esperando material al registrar un ingreso

**Files:**
- Modify: `backend/modules/inventory/router.py`
- Test: `backend/tests/inventory/__init__.py` (nuevo, vacío)
- Test: `backend/tests/inventory/conftest.py` (nuevo)
- Test: `backend/tests/inventory/test_waiting_runs.py` (nuevo)

**Interfaces:**
- Consumes: `WaitingProductionRunSummary` (Task 9), modelo `ProductionRun`/`ProductionRunStatus` (Task 3).
- Produces: helper `_find_waiting_production_runs(session, item_id: UUID) -> list[ProductionRun]` en `backend/modules/inventory/router.py` — testeable sin HTTP; wiring en `create_movement` para que la respuesta de un `ENTRADA` de materia prima incluya las órdenes esperando ese ítem.

- [ ] **Step 1: Fixtures de inventario para el test**

Archivo `backend/tests/inventory/__init__.py` (vacío).

Archivo `backend/tests/inventory/conftest.py`:

```python
import uuid
from decimal import Decimal

import pytest

from backend.modules.inventory.models import InventoryItem
from backend.modules.production.models import ProductionRun, ProductionRunStatus


@pytest.fixture()
def raw_material(db_session) -> InventoryItem:
    item = InventoryItem(
        item_type="RAW_MATERIAL",
        name="Plata test",
        sku=f"MP-TEST-{uuid.uuid4().hex[:8]}",
        unit_code="g",
        current_stock=Decimal("0"),
    )
    db_session.add(item)
    db_session.flush()
    return item


def make_waiting_run(db_session, raw_material, quantity, status=ProductionRunStatus.WAITING_MATERIAL):
    run = ProductionRun(
        process_id=uuid.uuid4(),
        process_name="Proceso test",
        quantity=Decimal(quantity),
        status=status,
        raw_material_item_id=raw_material.id,
        raw_material_quantity_per_unit=Decimal("10"),
        raw_material_unit_code="g",
        total_required_material=Decimal(quantity) * Decimal("10"),
        waste_limit_percent=Decimal("1"),
        expected_finished_weight=Decimal(quantity) * Decimal("10"),
        created_by_user_id=uuid.uuid4(),
        production_code=f"OP-TEST-{uuid.uuid4().hex[:6]}",
    )
    db_session.add(run)
    db_session.flush()
    return run
```

- [ ] **Step 2: Escribir el test del helper (falla porque no existe)**

Archivo `backend/tests/inventory/test_waiting_runs.py`:

```python
from decimal import Decimal

from backend.modules.inventory.router import _find_waiting_production_runs
from backend.modules.production.models import ProductionRunStatus
from backend.tests.inventory.conftest import make_waiting_run


def test_finds_only_waiting_runs_for_the_given_item(db_session, raw_material):
    waiting = make_waiting_run(db_session, raw_material, 40)
    make_waiting_run(db_session, raw_material, 20, status=ProductionRunStatus.IN_PROGRESS)

    result = _find_waiting_production_runs(db_session, raw_material.id)

    assert [r.id for r in result] == [waiting.id]


def test_excludes_runs_for_other_items(db_session, raw_material):
    import uuid

    other_item_id = uuid.uuid4()
    from backend.tests.inventory.conftest import make_waiting_run as make_run

    run = make_run(db_session, raw_material, 10)
    run.raw_material_item_id = other_item_id
    db_session.flush()

    result = _find_waiting_production_runs(db_session, raw_material.id)

    assert result == []
```

- [ ] **Step 3: Correr el test y verificar que falla**

Run: `docker exec -w /app erp_joyeria-api-1 python -m pytest backend/tests/inventory/test_waiting_runs.py -v`
Expected: `ImportError: cannot import name '_find_waiting_production_runs'`

- [ ] **Step 4: Implementar el helper y conectarlo a `create_movement`**

En `backend/modules/inventory/router.py`, agrega esta función a nivel de módulo (después de `INVENTORY_ADMIN_ONLY`, línea 43):

```python
def _find_waiting_production_runs(session, item_id):
    """Ordenes ESPERANDO_MATERIAL que necesitan este item de materia prima:
    candidatas para el aviso de 'destinar' al registrar un ingreso."""
    from sqlalchemy import select
    from backend.modules.production.models import ProductionRun, ProductionRunStatus

    return list(
        session.execute(
            select(ProductionRun).where(
                ProductionRun.raw_material_item_id == item_id,
                ProductionRun.status == ProductionRunStatus.WAITING_MATERIAL,
            )
        ).scalars().all()
    )
```

Luego, en `create_movement` (línea 265-283), reemplaza:

```python
    try:
        return service.create_movement(payload, user_id=current_user.id)
    except InventoryNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except InventoryDomainError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc
```

por:

```python
    try:
        result = service.create_movement(payload, user_id=current_user.id)
    except InventoryNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except InventoryDomainError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc

    if payload.movement_type == "ENTRADA" and result.item.item_type == "RAW_MATERIAL":
        from backend.modules.inventory.schemas import WaitingProductionRunSummary

        waiting_runs = _find_waiting_production_runs(service.repository.session, payload.item_id)
        result.waiting_production_runs = [
            WaitingProductionRunSummary(
                run_id=run.id,
                production_code=run.production_code,
                root_production_code=run.root_production_code or run.production_code,
                missing_quantity=run.quantity,
            )
            for run in waiting_runs
        ]
    return result
```

- [ ] **Step 5: Correr los tests y verificar que pasan**

Run: `docker exec -w /app erp_joyeria-api-1 python -m pytest backend/tests/inventory/test_waiting_runs.py -v`
Expected: `2 passed`

- [ ] **Step 6: Verificar que la app sigue arrancando**

Run: `docker exec erp_joyeria-api-1 python -c "from backend.app.main import app; print('ok')"`
Expected: `ok`

- [ ] **Step 7: Correr toda la suite completa una última vez**

Run: `docker exec -w /app erp_joyeria-api-1 python -m pytest backend/tests -v`
Expected: todos los tests pasan.

- [ ] **Step 8: Commit**

```bash
git add backend/modules/inventory/router.py backend/tests/inventory/
git commit -m "feat(inventario): aviso de ordenes esperando material al registrar un ingreso"
```

---

## Fuera de alcance de este plan (sigue en un plan aparte)

El frontend (`frontend/components/inventory/inventory-dashboard.tsx`): modal de "destinar material" tras registrar un ingreso, sección `ESPERANDO_MATERIAL` en el tablero de producción, badge de folio raíz. Depende de que los endpoints de este plan ya existan y estén probados — se planea por separado una vez esto esté mergeado.
