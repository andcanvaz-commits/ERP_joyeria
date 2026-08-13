# Cantidades directas en producción Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Quitar toda lógica de "cantidad por unidad" de producción (materia prima, complementos, insumos por etapa): todo se ingresa como cantidad directa en la unidad de medida del recurso, al crear la orden.

**Architecture:** Cambios en cascada dentro del módulo vertical `backend/modules/production/` (models → schemas → service → router sin cambios de firma) más una migración Alembic, y en `frontend/components/production/production-dashboard.tsx` + sus `lib`/`types` de apoyo. El split parcial por falta de stock pasa de "piezas cubiertas" a "fracción de cobertura" aplicada por igual a materia prima, complementos e insumos.

**Tech Stack:** FastAPI + SQLAlchemy 2.0 + Alembic + pytest (backend); Next.js 16 + React 18 + TypeScript, sin librerías de formularios (frontend).

## Global Constraints

- Español-first en UI, mensajes de error y nombres de estado; código en inglés (ver `CLAUDE.md`).
- `Numeric(14,4)` para toda cantidad/peso.
- Los `service.py` usan `flush()`, nunca `commit()`; nunca lanzar `HTTPException` desde un service — solo `ProductionDomainError`/`ProductionNotFoundError`.
- Toda columna de esquema nueva necesita su migración Alembic en `backend/alembic/versions/`.
- El stock jamás se edita a mano: todo cambio de `current_stock` nace de `InventoryService.create_movement`/`consume_material_for_production`.
- No agregar dependencias frontend sin pedirlo (nada de Zod/RHF/Tailwind).
- Spec de referencia: `docs/superpowers/specs/2026-08-13-cantidades-directas-produccion-design.md`.

---

## Task 1: Migración Alembic + modelos SQLAlchemy

**Files:**
- Create: `backend/alembic/versions/b3c4d5e6f7a8_cantidades_directas_produccion.py`
- Modify: `backend/modules/production/models.py:62-76` (`ProductionProcessMaterial`)
- Modify: `backend/modules/production/models.py:116-129` (`ProductionProcessStageIngredient`)
- Modify: `backend/modules/production/models.py:162-256` (`ProductionRun`, agrega import no aplica)
- Modify: `backend/modules/production/models.py:258-291` (`ProductionRunStage`, agrega relationship `ingredients`)
- Modify: `backend/modules/production/models.py:388-398` (`AssemblyRecipeItem`)
- Create (nueva clase en el mismo archivo): `ProductionRunStageIngredient`
- Test: `backend/tests/production/test_models_cantidades_directas.py`

**Interfaces:**
- Produce: `ProductionRunStageIngredient(id, run_stage_id, inventory_item_id, quantity, unit_code, reserved_quantity)` — nueva tabla `production_run_stage_ingredients`, relationship `ProductionRunStage.ingredients` (`back_populates="stage"`, `cascade="all, delete-orphan"`).
- Produce: `ProductionProcessMaterial` solo con `id, process_id, inventory_item_id` (sin `quantity_per_unit` ni `unit_code`).
- Produce: `ProductionProcessStageIngredient` solo con `id, stage_id, inventory_item_id` (sin `quantity` ni `unit_code`).
- Produce: `AssemblyRecipeItem.quantity` (renombrado desde `quantity_per_unit`).
- Produce: `ProductionRun` sin columna `raw_material_quantity_per_unit`.

- [ ] **Step 1: Escribir el test de modelos (falla porque las columnas/tabla aún no existen)**

```python
# backend/tests/production/test_models_cantidades_directas.py
import uuid
from decimal import Decimal

from backend.modules.production.models import (
    ProductionProcess,
    ProductionProcessMaterial,
    ProductionProcessStage,
    ProductionProcessStageIngredient,
    ProductionRun,
    ProductionRunStage,
    ProductionRunStageIngredient,
    ProductionRunStatus,
)


def test_process_material_has_no_ratio_columns(db_session, raw_material):
    process = ProductionProcess(
        name=f"Proceso {uuid.uuid4().hex[:6]}",
        waste_limit_percent=Decimal("1"),
        materials=[ProductionProcessMaterial(inventory_item_id=raw_material.id)],
        stages=[ProductionProcessStage(name="Etapa", stage_order=1)],
    )
    db_session.add(process)
    db_session.flush()

    assert not hasattr(ProductionProcessMaterial, "quantity_per_unit")
    assert not hasattr(ProductionProcessMaterial, "unit_code")


def test_stage_ingredient_has_no_quantity_column(db_session, raw_material):
    stage = ProductionProcessStage(name="Etapa", stage_order=1)
    stage.ingredients.append(ProductionProcessStageIngredient(inventory_item_id=raw_material.id))
    process = ProductionProcess(
        name=f"Proceso {uuid.uuid4().hex[:6]}",
        waste_limit_percent=Decimal("1"),
        materials=[ProductionProcessMaterial(inventory_item_id=raw_material.id)],
        stages=[stage],
    )
    db_session.add(process)
    db_session.flush()

    assert not hasattr(ProductionProcessStageIngredient, "quantity")
    assert not hasattr(ProductionProcessStageIngredient, "unit_code")


def test_run_stage_ingredient_round_trip(db_session, raw_material, current_user):
    run = ProductionRun(
        process_id=uuid.uuid4(),
        process_name="Proceso",
        quantity=Decimal("100"),
        status=ProductionRunStatus.PENDING_INVENTORY,
        raw_material_item_id=raw_material.id,
        raw_material_unit_code="g",
        total_required_material=Decimal("100"),
        waste_limit_percent=Decimal("1"),
        expected_finished_weight=Decimal("100"),
        created_by_user_id=current_user.id,
    )
    run.stages.append(
        ProductionRunStage(
            source_stage_id=uuid.uuid4(),
            stage_name="Fundicion",
            stage_order=1,
            ingredients=[
                ProductionRunStageIngredient(
                    inventory_item_id=raw_material.id,
                    quantity=Decimal("5"),
                    unit_code="und",
                )
            ],
        )
    )
    db_session.add(run)
    db_session.flush()
    db_session.expire_all()

    reloaded = db_session.get(ProductionRun, run.id)
    assert reloaded.stages[0].ingredients[0].quantity == Decimal("5")
    assert reloaded.stages[0].ingredients[0].reserved_quantity == Decimal("0")


def test_run_raw_material_quantity_per_unit_column_removed():
    assert not hasattr(ProductionRun, "raw_material_quantity_per_unit")
```

- [ ] **Step 2: Correr el test para confirmar que falla**

Run: `docker-compose exec api pytest backend/tests/production/test_models_cantidades_directas.py -v`
Expected: FAIL (columnas todavía existen / `ProductionRunStageIngredient` no existe / tabla sin migrar)

- [ ] **Step 3: Editar `backend/modules/production/models.py`**

Reemplazar `ProductionProcessMaterial` (líneas 62-76):

```python
class ProductionProcessMaterial(Base):
    __tablename__ = "production_process_materials"

    id: Mapped[PyUUID] = mapped_column(PG_UUID(as_uuid=True), primary_key=True, default=uuid4)
    process_id: Mapped[PyUUID] = mapped_column(
        ForeignKey("production_processes.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    inventory_item_id: Mapped[PyUUID] = mapped_column(PG_UUID(as_uuid=True), nullable=False)

    process: Mapped["ProductionProcess"] = relationship(back_populates="materials")
```

Reemplazar `ProductionProcessStageIngredient` (líneas 116-129):

```python
class ProductionProcessStageIngredient(Base):
    __tablename__ = "production_process_stage_ingredients"

    id: Mapped[PyUUID] = mapped_column(PG_UUID(as_uuid=True), primary_key=True, default=uuid4)
    stage_id: Mapped[PyUUID] = mapped_column(
        ForeignKey("production_process_stages.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    inventory_item_id: Mapped[PyUUID] = mapped_column(PG_UUID(as_uuid=True), nullable=False)

    stage: Mapped["ProductionProcessStage"] = relationship(back_populates="ingredients")
```

En `ProductionRun` (línea ~178), eliminar la línea:

```python
    raw_material_quantity_per_unit: Mapped[Decimal] = mapped_column(Numeric(14, 4), nullable=False)
```

En `ProductionRunStage` (dentro de la clase, después del atributo `waste_percent` y antes de `run: Mapped[ProductionRun]...`, línea ~283), agregar el nuevo relationship:

```python
    ingredients: Mapped[list["ProductionRunStageIngredient"]] = relationship(
        back_populates="stage",
        cascade="all, delete-orphan",
    )
```

Después de la clase `ProductionRunStageDecision` (después de línea 312), agregar la nueva clase:

```python
class ProductionRunStageIngredient(Base):
    __tablename__ = "production_run_stage_ingredients"

    id: Mapped[PyUUID] = mapped_column(PG_UUID(as_uuid=True), primary_key=True, default=uuid4)
    run_stage_id: Mapped[PyUUID] = mapped_column(
        ForeignKey("production_run_stages.id", ondelete="CASCADE"),
        nullable=False,
        index=True,
    )
    inventory_item_id: Mapped[PyUUID] = mapped_column(PG_UUID(as_uuid=True), nullable=False)
    quantity: Mapped[Decimal] = mapped_column(Numeric(14, 4), nullable=False)
    unit_code: Mapped[str] = mapped_column(String(20), nullable=False)
    # Guardado para esta orden pero todavia no consumido (mismo patron que
    # ProductionComplementRequest.reserved_quantity).
    reserved_quantity: Mapped[Decimal] = mapped_column(
        Numeric(14, 4), nullable=False, default=Decimal("0"), server_default="0"
    )

    stage: Mapped["ProductionRunStage"] = relationship(back_populates="ingredients")
```

En `AssemblyRecipeItem` (líneas 388-398), renombrar la columna:

```python
class AssemblyRecipeItem(Base):
    __tablename__ = "assembly_recipe_items"

    id: Mapped[PyUUID] = mapped_column(PG_UUID(as_uuid=True), primary_key=True, default=uuid4)
    recipe_id: Mapped[PyUUID] = mapped_column(
        ForeignKey("assembly_recipes.id", ondelete="CASCADE"), nullable=False, index=True
    )
    complement_item_id: Mapped[PyUUID] = mapped_column(PG_UUID(as_uuid=True), nullable=False)
    quantity: Mapped[Decimal] = mapped_column(Numeric(14, 4), nullable=False)

    recipe: Mapped["AssemblyRecipe"] = relationship(back_populates="items")
```

- [ ] **Step 4: Escribir la migración Alembic**

```python
# backend/alembic/versions/b3c4d5e6f7a8_cantidades_directas_produccion.py
"""cantidades directas en produccion: quitar unidad-por-gramo

Revision ID: b3c4d5e6f7a8
Revises: d0e1f2a3b4c5
Create Date: 2026-08-13 00:00:00.000000
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "b3c4d5e6f7a8"
down_revision = "d0e1f2a3b4c5"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.drop_column("production_process_materials", "quantity_per_unit")
    op.drop_column("production_process_materials", "unit_code")

    op.drop_column("production_process_stage_ingredients", "quantity")
    op.drop_column("production_process_stage_ingredients", "unit_code")

    op.drop_column("production_runs", "raw_material_quantity_per_unit")

    op.alter_column(
        "assembly_recipe_items", "quantity_per_unit", new_column_name="quantity"
    )
    # Recetas aprendidas: sus numeros eran gramos-por-pieza, no totales.
    # Reinterpretarlos como total daria sugerencias sin sentido; se reinician.
    op.execute("DELETE FROM assembly_recipe_items")
    op.execute("DELETE FROM assembly_recipes")

    op.create_table(
        "production_run_stage_ingredients",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "run_stage_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("production_run_stages.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("inventory_item_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("quantity", sa.Numeric(14, 4), nullable=False),
        sa.Column("unit_code", sa.String(20), nullable=False),
        sa.Column(
            "reserved_quantity", sa.Numeric(14, 4), nullable=False, server_default="0"
        ),
    )
    op.create_index(
        "ix_production_run_stage_ingredients_run_stage_id",
        "production_run_stage_ingredients",
        ["run_stage_id"],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_production_run_stage_ingredients_run_stage_id",
        table_name="production_run_stage_ingredients",
    )
    op.drop_table("production_run_stage_ingredients")

    op.alter_column(
        "assembly_recipe_items", "quantity", new_column_name="quantity_per_unit"
    )

    op.add_column(
        "production_runs",
        sa.Column("raw_material_quantity_per_unit", sa.Numeric(14, 4), nullable=False, server_default="1"),
    )
    op.alter_column("production_runs", "raw_material_quantity_per_unit", server_default=None)

    op.add_column(
        "production_process_stage_ingredients",
        sa.Column("quantity", sa.Numeric(14, 4), nullable=False, server_default="1"),
    )
    op.alter_column("production_process_stage_ingredients", "quantity", server_default=None)
    op.add_column(
        "production_process_stage_ingredients",
        sa.Column("unit_code", sa.String(20), nullable=False, server_default="g"),
    )
    op.alter_column("production_process_stage_ingredients", "unit_code", server_default=None)

    op.add_column(
        "production_process_materials",
        sa.Column("quantity_per_unit", sa.Numeric(14, 4), nullable=False, server_default="1"),
    )
    op.alter_column("production_process_materials", "quantity_per_unit", server_default=None)
    op.add_column(
        "production_process_materials",
        sa.Column("unit_code", sa.String(20), nullable=False, server_default="g"),
    )
    op.alter_column("production_process_materials", "unit_code", server_default=None)
```

- [ ] **Step 5: Aplicar la migración y correr el test**

Run:
```
docker-compose exec api alembic upgrade head
docker-compose exec api pytest backend/tests/production/test_models_cantidades_directas.py -v
```
Expected: PASS los 4 tests

- [ ] **Step 6: Commit**

```bash
git add backend/alembic/versions/b3c4d5e6f7a8_cantidades_directas_produccion.py backend/modules/production/models.py backend/tests/production/test_models_cantidades_directas.py
git commit -m "feat(production): quitar quantity_per_unit del esquema, agregar insumos por corrida"
```

---

## Task 2: Repository — eager load de insumos por corrida

**Files:**
- Modify: `backend/modules/production/repository.py:43-71`

**Interfaces:**
- Consumes: `ProductionRunStageIngredient` (Task 1)
- Produces: `get_run`/`list_runs` cargan `run.stages[].ingredients` sin lazy-load N+1.

No hay test dedicado: se verifica en Task 5 (falla `MissingGreenlet`/lazy-load si no está bien encadenado, ya que los services corren fuera de contexto async).

- [ ] **Step 1: Editar `get_run` y `list_runs`**

```python
from backend.modules.production.models import (
    ProductionProcess,
    ProductionProcessStage,
    ProductionProcessStageIngredient,
    ProductionRun,
    ProductionRunStage,
)
```

Cambiar el import de arriba (línea 8) agregando `ProductionRunStage` ya está; falta nada nuevo en imports porque `ProductionRunStage` ya se importa.

```python
    def get_run(self, run_id: UUID) -> ProductionRun | None:
        statement = (
            select(ProductionRun)
            .options(
                selectinload(ProductionRun.stages).selectinload(ProductionRunStage.ingredients),
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
                selectinload(ProductionRun.stages).selectinload(ProductionRunStage.ingredients),
                selectinload(ProductionRun.event_lines),
            )
            .order_by(ProductionRun.requested_at.desc())
        )
        return list(self.session.execute(statement).scalars().all())
```

- [ ] **Step 2: Compileall rápido**

Run: `docker-compose exec api python -m compileall backend/modules/production/repository.py`
Expected: sin errores

- [ ] **Step 3: Commit**

```bash
git add backend/modules/production/repository.py
git commit -m "feat(production): eager-load de insumos por etapa de la corrida"
```

---

## Task 3: Schemas Pydantic

**Files:**
- Modify: `backend/modules/production/schemas.py` (múltiples bloques, detallados abajo)

**Interfaces:**
- Produce: `ProcessMaterialCreate/Read` sin `quantity_per_unit`/`unit_code`.
- Produce: `StageIngredientCreate/Read` sin `quantity`/`unit_code`.
- Produce: `RunStageIngredientCreate(process_stage_ingredient_id, quantity)`.
- Produce: `ProductionRunCreate.stage_ingredients: list[RunStageIngredientCreate]`, `quantity` sin `decimal_places=0`.
- Produce: `RunProductCreate.quantity` sin `decimal_places=0`.
- Produce: `RunAssemblyLineCreate.quantity` (renombrado desde `quantity_per_unit`).
- Produce: `AllocateMaterialPayload.quantity_units` sin `decimal_places=0` (pasa a representar cantidad de materia prima, no piezas).
- Produce: `ProductionRunRead` sin `raw_material_quantity_per_unit`.
- Consumes: nada de tareas previas (schemas puros).

- [ ] **Step 1: Editar `StageIngredientCreate`/`StageIngredientRead` (líneas 9-23)**

```python
class StageIngredientCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    inventory_item_id: UUID


class StageIngredientRead(BaseModel):
    model_config = ConfigDict(from_attributes=True, extra="forbid")

    id: UUID
    inventory_item_id: UUID
```

- [ ] **Step 2: Editar `ProcessMaterialCreate`/`ProcessMaterialRead` (líneas 26-40)**

```python
class ProcessMaterialCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    inventory_item_id: UUID


class ProcessMaterialRead(BaseModel):
    model_config = ConfigDict(from_attributes=True, extra="forbid")

    id: UUID
    inventory_item_id: UUID
```

- [ ] **Step 3: Quitar `decimal_places=0` de `RunProductCreate.quantity` y `ProductionRunCreate.quantity` (líneas 118-166)**

```python
class RunProductCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    product_type_id: UUID | None = None
    target_item_id: UUID | None = None
    # Cantidad en la unidad de medida del recurso (no necesariamente piezas
    # enteras: puede ser peso).
    quantity: Decimal = Field(gt=0)

    @model_validator(mode="after")
    def _check_one_target(self) -> "RunProductCreate":
        if (self.product_type_id is None) == (self.target_item_id is None):
            raise ValueError(
                "Cada producto del plan debe ser una pieza del inventario o un "
                "tipo del catalogo (uno de los dos)."
            )
        return self


class RunComplementCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    item_id: UUID
    quantity: Decimal = Field(gt=0)


class RunStageIngredientCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    process_stage_ingredient_id: UUID
    quantity: Decimal = Field(gt=0)


class RunProductsUpdate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    products: list[RunProductCreate] = Field(min_length=1)


class ProductionRunCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    process_id: UUID
    raw_material_item_id: UUID
    # Cantidad total de materia prima en la unidad de medida del item elegido
    # (gramos u otra): ya NO se multiplica por ningun factor.
    quantity: Decimal = Field(gt=0)
    assembly_mode: Literal["ASIGNAR", "ENSAMBLAR"] = "ASIGNAR"
    products: list[RunProductCreate] = Field(min_length=1)
    complements: list[RunComplementCreate] = Field(default_factory=list)
    # Cantidad total a usar de cada insumo configurado en las etapas activas
    # del proceso (obligatorio 1:1 contra la configuracion, ver validacion en
    # ProductionService.create_run).
    stage_ingredients: list[RunStageIngredientCreate] = Field(default_factory=list)
```

- [ ] **Step 4: Editar `AllocateMaterialPayload` (líneas 201-206)**

```python
class AllocateMaterialPayload(BaseModel):
    model_config = ConfigDict(extra="forbid")

    # Cantidad de materia prima (en la unidad de la orden) que se intenta
    # cubrir ahora mismo, no piezas.
    quantity_units: Decimal = Field(gt=0)
```

- [ ] **Step 5: Editar `RunAssemblyLineCreate`/`AssemblyRecipeItemRead`/`AssemblyRecipeUpsert` (líneas 311-344)**

```python
class RunAssemblyLineCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    complement_item_id: UUID
    # Cantidad total a usar de este complemento en el ensamble (no por unidad).
    quantity: Decimal = Field(gt=0, decimal_places=4)


class RunAssemblyDefine(BaseModel):
    model_config = ConfigDict(extra="forbid")

    items: list[RunAssemblyLineCreate] = Field(min_length=1)


class AssemblyRecipeItemRead(BaseModel):
    model_config = ConfigDict(from_attributes=True, extra="forbid")

    complement_item_id: UUID
    name: str | None = None
    unit_code: str | None = None
    material_type: str | None = None
    # Ultima cantidad total usada (sugerencia, no autoritativa).
    quantity: Decimal


class AssemblyRecipeRead(BaseModel):
    model_config = ConfigDict(from_attributes=True, extra="forbid")

    model_key: str | None = None
    items: list[AssemblyRecipeItemRead] = Field(default_factory=list)


class AssemblyRecipeUpsert(BaseModel):
    model_config = ConfigDict(extra="forbid")

    items: list[RunAssemblyLineCreate] = Field(min_length=1)
```

- [ ] **Step 6: Quitar `raw_material_quantity_per_unit` de `ProductionRunRead` (línea ~364)**

Borrar la línea:
```python
    raw_material_quantity_per_unit: Decimal
```
de la clase `ProductionRunRead` (queda `raw_material_item_id`, luego directo `raw_material_unit_code`).

- [ ] **Step 7: Compileall**

Run: `docker-compose exec api python -m compileall backend/modules/production/schemas.py`
Expected: sin errores

- [ ] **Step 8: Commit**

```bash
git add backend/modules/production/schemas.py
git commit -m "feat(production): schemas de cantidades directas (sin quantity_per_unit)"
```

---

## Task 4: Mantenimiento de procesos — quitar ratio de materiales e insumos

**Files:**
- Modify: `backend/modules/production/service.py:290-343` (`create_process`)
- Modify: `backend/modules/production/service.py:347-410` (`update_process`)
- Modify: `backend/modules/production/service.py:418-470` (`seed_example_processes`)
- Modify: `backend/tests/production/conftest.py:87-113` (fixture `process`)
- Test: `backend/tests/production/test_process_materials_validation.py` (reescritura)

**Interfaces:**
- Consumes: `ProductionProcessMaterial(inventory_item_id)`, `ProductionProcessStageIngredient(inventory_item_id)` (Task 1); `ProcessMaterialCreate`, `StageIngredientCreate` (Task 3).
- Produces: `ProductionService.create_process`/`update_process` sin usar `quantity_per_unit`/`unit_code`.

- [ ] **Step 1: Leer y actualizar el fixture `process` para no usar `quantity_per_unit`**

```python
# backend/tests/production/conftest.py:87-113
@pytest.fixture()
def process(db_session, raw_material) -> ProductionProcess:
    proc = ProductionProcess(
        name=f"Proceso test {uuid.uuid4().hex[:6]}",
        waste_limit_percent=Decimal("1"),
        is_active=True,
        materials=[
            ProductionProcessMaterial(inventory_item_id=raw_material.id)
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

- [ ] **Step 2: Escribir el test de mantenimiento (falla porque el service todavia exige `quantity_per_unit`)**

```python
# backend/tests/production/test_process_materials_validation.py (reescribir completo)
import uuid
from decimal import Decimal

from backend.modules.production.schemas import (
    ProcessMaterialCreate,
    ProductionProcessCreate,
    ProductionProcessStageCreate,
)


def _payload(raw_material_id) -> ProductionProcessCreate:
    return ProductionProcessCreate(
        name=f"Proceso {uuid.uuid4().hex[:6]}",
        materials=[ProcessMaterialCreate(inventory_item_id=raw_material_id)],
        stages=[ProductionProcessStageCreate(name="Etapa", order=1)],
    )


def test_create_process_without_ratio_fields(production_service, raw_material):
    read = production_service.create_process(_payload(raw_material.id))

    assert len(read.materials) == 1
    assert read.materials[0].inventory_item_id == raw_material.id
    assert not hasattr(read.materials[0], "quantity_per_unit")


def test_create_process_rejects_duplicate_material(production_service, raw_material):
    payload = _payload(raw_material.id)
    payload = payload.model_copy(
        update={"materials": [ProcessMaterialCreate(inventory_item_id=raw_material.id)] * 2}
    )
    import pytest
    from backend.modules.production.service import ProductionDomainError

    with pytest.raises(ProductionDomainError):
        production_service.create_process(payload)


def test_update_process_replaces_materials(production_service, process, raw_material, complement_item):
    payload = ProductionProcessCreate(
        name=process.name,
        materials=[
            ProcessMaterialCreate(inventory_item_id=raw_material.id),
            ProcessMaterialCreate(inventory_item_id=complement_item.id),
        ],
        stages=[ProductionProcessStageCreate(name="Etapa", order=1)],
    )
    read = production_service.update_process(process.id, payload)

    assert {m.inventory_item_id for m in read.materials} == {raw_material.id, complement_item.id}
```

Nota: `_validate_materials` ya existente valida duplicados por `inventory_item_id`; confirmar en Step 4 que sigue funcionando sin el campo de cantidad.

- [ ] **Step 3: Correr el test para confirmar que falla**

Run: `docker-compose exec api pytest backend/tests/production/test_process_materials_validation.py -v`
Expected: FAIL (`ProcessMaterialCreate` ya no tiene el campo, pero el service aun referencia `material.quantity_per_unit`)

- [ ] **Step 4: Editar `create_process`/`update_process`/`seed_example_processes` en `service.py`**

En `create_process` (línea ~327-334), reemplazar:

```python
            materials=[
                ProductionProcessMaterial(inventory_item_id=material.inventory_item_id)
                for material in payload.materials
            ],
```

En `update_process` (línea ~360-367), reemplazar:

```python
        process.materials = [
            ProductionProcessMaterial(inventory_item_id=material.inventory_item_id)
            for material in payload.materials
        ]
```

En ambos métodos, dentro de la construcción de `stages`/`ingredients` (líneas ~308-315 y ~381-388), reemplazar:

```python
                ingredients=[
                    ProductionProcessStageIngredient(inventory_item_id=ing.inventory_item_id)
                    for ing in stage_data.ingredients
                ],
```

En `seed_example_processes` (líneas ~452-463), reemplazar el bloque `materials=[...]`:

```python
                    materials=[
                        {"inventory_item_id": silver.id},
                        {"inventory_item_id": gold.id},
                    ],
```

- [ ] **Step 5: Correr el test para confirmar que pasa**

Run: `docker-compose exec api pytest backend/tests/production/test_process_materials_validation.py -v`
Expected: PASS los 3 tests

- [ ] **Step 6: Correr toda la suite de producción para detectar fixtures rotos por el cambio de `process`**

Run: `docker-compose exec api pytest backend/tests/production -v`
Expected: fallas ADICIONALES en `test_material_split.py`, `test_material_reservation.py`, `test_process_product_types.py`, `test_receive_merma.py` — se resuelven en las tareas siguientes (no se arreglan aquí).

- [ ] **Step 7: Commit**

```bash
git add backend/modules/production/service.py backend/tests/production/conftest.py backend/tests/production/test_process_materials_validation.py
git commit -m "feat(production): mantenimiento de procesos sin cantidad por unidad"
```

---

## Task 5: `create_run` — materia prima directa + insumos obligatorios

**Files:**
- Modify: `backend/modules/production/service.py:472-596` (`create_run`)
- Test: `backend/tests/production/test_run_creation_cantidades_directas.py` (nuevo)

**Interfaces:**
- Consumes: `ProductionRunCreate.stage_ingredients` (Task 3), `ProductionRunStageIngredient` (Task 1).
- Produces: `ProductionService.create_run` valida 1:1 los insumos configurados en las etapas activas del proceso contra `payload.stage_ingredients`, y los copia a `run.stages[].ingredients`.

- [ ] **Step 1: Escribir los tests (fallan: `create_run` no conoce `stage_ingredients`)**

```python
# backend/tests/production/test_run_creation_cantidades_directas.py
import uuid
from decimal import Decimal

import pytest

from backend.modules.production.models import ProductionProcessStageIngredient
from backend.modules.production.schemas import (
    ProductionRunCreate,
    RunProductCreate,
    RunStageIngredientCreate,
)
from backend.modules.production.service import ProductionDomainError


@pytest.fixture()
def supply_item(db_session):
    from backend.modules.inventory.models import InventoryItem

    item = InventoryItem(
        item_type="SUPPLY",
        name="Hilo test",
        sku=f"IN-TEST-{uuid.uuid4().hex[:8]}",
        unit_code="m",
        current_stock=Decimal("0"),
    )
    db_session.add(item)
    db_session.flush()
    return item


@pytest.fixture()
def process_with_ingredient(db_session, process, supply_item):
    ingredient = ProductionProcessStageIngredient(inventory_item_id=supply_item.id)
    process.stages[0].ingredients.append(ingredient)
    db_session.flush()
    return process


def test_create_run_uses_quantity_directly_as_total_material(
    production_service, current_user, process, raw_material, target_complement
):
    raw_material.current_stock = Decimal("500")
    payload = ProductionRunCreate(
        process_id=process.id,
        raw_material_item_id=raw_material.id,
        quantity=Decimal("37.5"),
        assembly_mode="ASIGNAR",
        products=[RunProductCreate(target_item_id=target_complement.id, quantity=Decimal("37.5"))],
    )
    run = production_service.create_run(payload, current_user)

    assert run.quantity == Decimal("37.5")
    assert run.total_required_material == Decimal("37.5")
    assert run.expected_finished_weight == Decimal("37.5")


def test_create_run_requires_every_configured_ingredient(
    production_service, current_user, process_with_ingredient, raw_material, target_complement
):
    payload = ProductionRunCreate(
        process_id=process_with_ingredient.id,
        raw_material_item_id=raw_material.id,
        quantity=Decimal("10"),
        assembly_mode="ASIGNAR",
        products=[RunProductCreate(target_item_id=target_complement.id, quantity=Decimal("10"))],
        stage_ingredients=[],
    )
    with pytest.raises(ProductionDomainError, match="insumo"):
        production_service.create_run(payload, current_user)


def test_create_run_rejects_unconfigured_ingredient(
    production_service, current_user, process, raw_material, target_complement, complement_item
):
    payload = ProductionRunCreate(
        process_id=process.id,
        raw_material_item_id=raw_material.id,
        quantity=Decimal("10"),
        assembly_mode="ASIGNAR",
        products=[RunProductCreate(target_item_id=target_complement.id, quantity=Decimal("10"))],
        stage_ingredients=[RunStageIngredientCreate(process_stage_ingredient_id=uuid.uuid4(), quantity=Decimal("1"))],
    )
    with pytest.raises(ProductionDomainError, match="insumo"):
        production_service.create_run(payload, current_user)


def test_create_run_copies_ingredient_quantity_to_run_stage(
    production_service, current_user, process_with_ingredient, raw_material, target_complement, supply_item
):
    config_id = process_with_ingredient.stages[0].ingredients[0].id
    payload = ProductionRunCreate(
        process_id=process_with_ingredient.id,
        raw_material_item_id=raw_material.id,
        quantity=Decimal("10"),
        assembly_mode="ASIGNAR",
        products=[RunProductCreate(target_item_id=target_complement.id, quantity=Decimal("10"))],
        stage_ingredients=[RunStageIngredientCreate(process_stage_ingredient_id=config_id, quantity=Decimal("3.5"))],
    )
    run_read = production_service.create_run(payload, current_user)
    run = production_service.repository.get_run(run_read.id)

    assert len(run.stages[0].ingredients) == 1
    assert run.stages[0].ingredients[0].inventory_item_id == supply_item.id
    assert run.stages[0].ingredients[0].quantity == Decimal("3.5")
    assert run.stages[0].ingredients[0].unit_code == "m"
```

- [ ] **Step 2: Correr los tests para confirmar que fallan**

Run: `docker-compose exec api pytest backend/tests/production/test_run_creation_cantidades_directas.py -v`
Expected: FAIL

- [ ] **Step 3: Editar `create_run` en `service.py`**

Reemplazar el bloque de resolución de materia prima (líneas ~483-503):

```python
        selected = next(
            (m for m in process.materials if m.inventory_item_id == payload.raw_material_item_id),
            None,
        )
        from backend.modules.inventory.models import InventoryItem

        item = self.repository.session.get(InventoryItem, payload.raw_material_item_id)
        if item is None or item.item_type != "RAW_MATERIAL":
            raise ProductionDomainError(
                "La materia prima seleccionada no existe en el inventario."
            )
        unit_code = item.unit_code
```

(Se elimina por completo el cálculo de `quantity_per_unit`: `selected` solo confirma que la materia prima está en la whitelist del proceso, pero ya no aporta ratio. Si se prefiere seguir exigiendo que esté configurada, dejar la validación `if selected is None: raise ...`; revisando el comentario original — "Cualquier materia prima del inventario es utilizable en cualquier proceso" — se mantiene ese comportamiento permisivo, por eso `selected` ya no se usa más que como dato informativo y puede quitarse la variable si no se usa en otro lado. Confirmar con `grep -n "selected" backend/modules/production/service.py` tras el cambio; si no queda ninguna otra referencia, borrar también la asignación de `selected`.)

Reemplazar la línea `total_required = quantity_per_unit * payload.quantity` (línea ~534) y la construcción de `run` (líneas 535-549):

```python
        total_required = payload.quantity
        run = ProductionRun(
            process_id=process.id,
            process_name=process.name,
            quantity=payload.quantity,
            status=ProductionRunStatus.PENDING_INVENTORY,
            assembly_mode=payload.assembly_mode,
            raw_material_item_id=payload.raw_material_item_id,
            raw_material_unit_code=unit_code,
            total_required_material=total_required,
            waste_limit_percent=process.waste_limit_percent,
            expected_finished_weight=total_required,
            created_by_user_id=current_user.id,
            requested_at=datetime.utcnow(),
        )
```

Agregar, justo antes de armar `run.stages.append(...)` (antes de línea ~553), la validación y resolución de insumos:

```python
        configured_ingredients = [
            (stage, ingredient)
            for stage in active_stages
            for ingredient in stage.ingredients
        ]
        configured_ids = {ingredient.id for _, ingredient in configured_ingredients}
        payload_ids = {line.process_stage_ingredient_id for line in payload.stage_ingredients}
        if configured_ids != payload_ids:
            raise ProductionDomainError(
                "Debes indicar la cantidad de cada insumo configurado en las etapas de este proceso."
            )
        payload_by_id = {line.process_stage_ingredient_id: line.quantity for line in payload.stage_ingredients}

        ingredient_items: dict = {}
        for _, ingredient in configured_ingredients:
            supply = self.repository.session.get(InventoryItem, ingredient.inventory_item_id)
            if supply is None:
                raise ProductionDomainError("Un insumo configurado ya no existe en el inventario.")
            ingredient_items[ingredient.id] = supply
```

Dentro del `for stage in sorted(active_stages, ...)` que arma `ProductionRunStage` (líneas ~553-568), agregar `ingredients=[...]` a la construcción:

```python
        for stage in sorted(active_stages, key=lambda item: item.stage_order):
            run.stages.append(
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
                    ingredients=[
                        ProductionRunStageIngredient(
                            inventory_item_id=ingredient.inventory_item_id,
                            quantity=payload_by_id[ingredient.id],
                            unit_code=ingredient_items[ingredient.id].unit_code,
                        )
                        for ingredient in stage.ingredients
                    ],
                )
            )
```

Agregar el import de `ProductionRunStageIngredient` junto a los demás imports de modelos al inicio del archivo (`from backend.modules.production.models import (..., ProductionRunStageIngredient, ...)`).

- [ ] **Step 4: Correr los tests para confirmar que pasan**

Run: `docker-compose exec api pytest backend/tests/production/test_run_creation_cantidades_directas.py -v`
Expected: PASS los 4 tests

- [ ] **Step 5: Correr toda la suite de producción**

Run: `docker-compose exec api pytest backend/tests/production -v`
Expected: `test_material_split.py`/`test_material_reservation.py`/`test_process_product_types.py`/`test_receive_merma.py` siguen fallando (se arreglan en Tasks 6-9); ningún test nuevo debe fallar por error de sintaxis/import.

- [ ] **Step 6: Commit**

```bash
git add backend/modules/production/service.py backend/tests/production/test_run_creation_cantidades_directas.py
git commit -m "feat(production): crear orden con cantidad directa e insumos obligatorios"
```

---

## Task 6: Cobertura por fracción (`_MaterialCoverage`/`_compute_coverage`)

**Files:**
- Modify: `backend/modules/production/service.py:141-171` (`_MaterialCoverage`)
- Modify: `backend/modules/production/service.py:763-829` (`_compute_coverage`)
- Test: `backend/tests/production/test_coverage_fraction.py` (nuevo)

**Interfaces:**
- Consumes: `ProductionRunStageIngredient` (Task 1), `run.stages[].ingredients` copiado por `create_run` (Task 5).
- Produces: `_compute_coverage(run, target_amount) -> _MaterialCoverage` donde `covered_qty`/`target_qty` son cantidades de materia prima (no piezas); `_MaterialCoverage.is_partial`/`shortage_message()` sin cambios de firma.

- [ ] **Step 1: Escribir el test (falla: la función actual sigue usando `raw_material_quantity_per_unit` y floor-division por piezas)**

```python
# backend/tests/production/test_coverage_fraction.py
from decimal import Decimal

from backend.modules.production.schemas import (
    ProductionRunCreate,
    RunComplementCreate,
    RunProductCreate,
)


def _create_asignar_run(production_service, current_user, process, raw_material, target_complement, quantity, complements=None):
    payload = ProductionRunCreate(
        process_id=process.id,
        raw_material_item_id=raw_material.id,
        quantity=Decimal(quantity),
        assembly_mode="ASIGNAR",
        products=[RunProductCreate(target_item_id=target_complement.id, quantity=Decimal(quantity))],
        complements=complements or [],
    )
    return production_service.create_run(payload, current_user)


def test_coverage_is_full_when_stock_is_enough(
    db_session, production_service, current_user, process, raw_material, target_complement
):
    raw_material.current_stock = Decimal("100")
    db_session.flush()
    run_read = _create_asignar_run(production_service, current_user, process, raw_material, target_complement, "80")
    run = production_service.repository.get_run(run_read.id)

    coverage = production_service._compute_coverage(run, run.total_required_material)

    assert coverage.covered_qty == Decimal("80")
    assert coverage.is_partial is False


def test_coverage_fraction_scales_raw_material_continuously(
    db_session, production_service, current_user, process, raw_material, target_complement
):
    raw_material.current_stock = Decimal("30")
    db_session.flush()
    run_read = _create_asignar_run(production_service, current_user, process, raw_material, target_complement, "100")
    run = production_service.repository.get_run(run_read.id)

    coverage = production_service._compute_coverage(run, run.total_required_material)

    assert coverage.covered_qty == Decimal("30")
    assert coverage.is_partial is True


def test_coverage_limited_by_shortest_complement(
    db_session, production_service, current_user, process, raw_material, target_complement, complement_item
):
    raw_material.current_stock = Decimal("100")
    complement_item.current_stock = Decimal("10")
    db_session.flush()
    run_read = _create_asignar_run(
        production_service, current_user, process, raw_material, target_complement, "100",
        complements=[RunComplementCreate(item_id=complement_item.id, quantity=Decimal("50"))],
    )
    run = production_service.repository.get_run(run_read.id)

    coverage = production_service._compute_coverage(run, run.total_required_material)

    # Complemento cubre 10/50 = 20% -> limita mas que la materia prima (100%).
    assert coverage.covered_qty == Decimal("20")
    assert coverage.limiting_is_complement is True
```

- [ ] **Step 2: Correr el test para confirmar que falla**

Run: `docker-compose exec api pytest backend/tests/production/test_coverage_fraction.py -v`
Expected: FAIL

- [ ] **Step 3: Reescribir `_MaterialCoverage` y `_compute_coverage`**

```python
@dataclass
class _MaterialCoverage:
    """Resultado del calculo de cobertura: cuanto de `target_qty` (cantidad de
    materia prima, en su unidad) alcanza a cubrir el stock disponible, y cual
    es el recurso que manda (el mas corto, entre materia prima, complementos
    e insumos)."""

    covered_qty: Decimal
    target_qty: Decimal
    limiting_name: str
    limiting_available: Decimal
    limiting_unit: str
    limiting_required_per_unit: Decimal
    limiting_is_complement: bool

    @property
    def is_partial(self) -> bool:
        return self.covered_qty < self.target_qty

    def shortage_message(self) -> str:
        origin = (
            " (complemento/insumo solicitado en la orden)"
            if self.limiting_is_complement
            else ""
        )
        return (
            f"Stock insuficiente de '{self.limiting_name}'{origin}: disponible "
            f"{self.limiting_available} {self.limiting_unit}, se requieren "
            f"{self.limiting_required_per_unit} {self.limiting_unit}."
        )
```

```python
    def _compute_coverage(self, run: ProductionRun, target_qty: Decimal) -> "_MaterialCoverage":
        """Cuanto de `target_qty` (cantidad de materia prima que se intenta
        cubrir) alcanza a cubrir el stock disponible HOY, considerando por
        igual materia prima, cada complemento pendiente y cada insumo de
        etapa: la fraccion mas corta entre todos manda, y esa MISMA fraccion
        se aplica a todos al partir la orden (ver _split_run_for_partial_material).

        Fuente unica del calculo: la usan tanto el preview (dry-run) como
        approve_materials (consume de verdad).
        """
        from backend.modules.inventory.models import InventoryItem

        if self.inventory_service is None:
            raise ProductionDomainError("Inventario no esta disponible.")
        raw_material = self.repository.session.get(InventoryItem, run.raw_material_item_id)
        if raw_material is None:
            raise ProductionDomainError("La materia prima de la orden ya no existe en inventario.")

        reserved_by_others = self.inventory_service.reserved_by_item(exclude_run_id=run.id)

        def available_of(item) -> Decimal:
            return item.current_stock - reserved_by_others.get(item.id, Decimal("0"))

        raw_needed = run.total_required_material
        raw_available = available_of(raw_material)
        fraction = Decimal("1")
        coverage = _MaterialCoverage(
            covered_qty=target_qty,
            target_qty=target_qty,
            limiting_name=raw_material.name,
            limiting_available=raw_available,
            limiting_unit=raw_material.unit_code,
            limiting_required_per_unit=raw_needed,
            limiting_is_complement=False,
        )
        if raw_needed > 0 and raw_available < raw_needed:
            fraction = max(Decimal("0"), raw_available / raw_needed)

        def consider(name: str, unit: str, available: Decimal, needed: Decimal) -> None:
            nonlocal fraction
            if needed <= 0:
                return
            if available < needed:
                candidate = max(Decimal("0"), available / needed)
                if candidate < fraction:
                    fraction = candidate
                    coverage.limiting_name = name
                    coverage.limiting_available = available
                    coverage.limiting_unit = unit
                    coverage.limiting_required_per_unit = needed
                    coverage.limiting_is_complement = True

        for complement in run.complements:
            if complement.status != ComplementRequestStatus.PENDING:
                continue
            item = self.repository.session.get(InventoryItem, complement.item_id)
            if item is None:
                raise ProductionDomainError("Un complemento solicitado ya no existe en inventario.")
            consider(item.name, item.unit_code, available_of(item), complement.quantity)

        for stage in run.stages:
            for ingredient in stage.ingredients:
                item = self.repository.session.get(InventoryItem, ingredient.inventory_item_id)
                if item is None:
                    raise ProductionDomainError("Un insumo solicitado ya no existe en inventario.")
                consider(item.name, item.unit_code, available_of(item), ingredient.quantity)

        coverage.covered_qty = max(Decimal("0"), min(target_qty, raw_needed * fraction))
        return coverage
```

Nota: cuando `target_qty < raw_needed` (llamado desde `allocate_material`/`preview_allocation` sobre una corrida `ESPERANDO_MATERIAL` con un monto parcial a intentar), el resultado sigue siendo coherente porque `fraction` ya refleja disponible/necesario de TODA la orden y `covered_qty` se acota a `min(target_qty, raw_needed*fraction)`.

- [ ] **Step 4: Correr el test para confirmar que pasa**

Run: `docker-compose exec api pytest backend/tests/production/test_coverage_fraction.py -v`
Expected: PASS los 3 tests

- [ ] **Step 5: Commit**

```bash
git add backend/modules/production/service.py backend/tests/production/test_coverage_fraction.py
git commit -m "feat(production): cobertura por fraccion (materia prima+complementos+insumos)"
```

---

## Task 7: Split parcial — materia prima continua + insumos proporcionales

**Files:**
- Modify: `backend/modules/production/service.py:648-761` (`_split_run_for_partial_material`)
- Modify: `backend/tests/production/test_material_split.py` (reescritura completa)

**Interfaces:**
- Consumes: `_compute_coverage` (Task 6), `ProductionRunStageIngredient` (Task 1).
- Produces: `_split_run_for_partial_material(run, covered_qty)` reparte materia prima (continua, sin floor), complementos (ya proporcional, sin cambio de fórmula) e insumos (nuevo) entre `run` y la corrida hija.

- [ ] **Step 1: Reescribir `test_material_split.py` con las cantidades del nuevo modelo**

```python
# backend/tests/production/test_material_split.py
from decimal import Decimal

from backend.modules.production.models import ProductionProcessStageIngredient, ProductionRunStatus
from backend.modules.production.schemas import ProductionRunCreate, RunProductCreate, RunStageIngredientCreate
from backend.modules.production.service import ProductionDomainError


def _create_run(production_service, current_user, process, raw_material, target_complement, quantity, stage_ingredients=None):
    payload = ProductionRunCreate(
        process_id=process.id,
        raw_material_item_id=raw_material.id,
        quantity=Decimal(quantity),
        assembly_mode="ASIGNAR",
        products=[RunProductCreate(target_item_id=target_complement.id, quantity=Decimal(quantity))],
        complements=[],
        stage_ingredients=stage_ingredients or [],
    )
    return production_service.create_run(payload, current_user)


def test_split_run_creates_waiting_child_with_shared_root_code(
    db_session, production_service, current_user, process, raw_material, target_complement
):
    raw_material.current_stock = Decimal("60")  # 60% de 100g
    db_session.flush()

    run_read = _create_run(production_service, current_user, process, raw_material, target_complement, "100")
    run = production_service.repository.get_run(run_read.id)

    child = production_service._split_run_for_partial_material(run, Decimal("60"))

    assert run.quantity == Decimal("60")
    assert run.total_required_material == Decimal("60")
    assert run.root_production_code == run.production_code

    assert child.status == ProductionRunStatus.WAITING_MATERIAL
    assert child.quantity == Decimal("40")
    assert child.total_required_material == Decimal("40")
    assert child.parent_run_id == run.id
    assert child.root_production_code == run.root_production_code
    assert child.production_code == f"{run.production_code}-B"
    assert len(child.stages) == 1
    assert child.stages[0].stage_code != run.stages[0].stage_code
    assert child.stages[0].stage_code.endswith("-B")

    assert sum(p.quantity for p in run.products) == Decimal("60")
    assert sum(p.quantity for p in child.products) == Decimal("40")


def test_next_split_code_increments_letter_per_child(
    db_session, production_service, current_user, process, raw_material, target_complement
):
    raw_material.current_stock = Decimal("60")
    db_session.flush()
    run_read = _create_run(production_service, current_user, process, raw_material, target_complement, "100")
    run = production_service.repository.get_run(run_read.id)

    first_child = production_service._split_run_for_partial_material(run, Decimal("60"))
    second_child = production_service._split_run_for_partial_material(first_child, Decimal("25"))

    assert first_child.production_code == f"{run.production_code}-B"
    assert second_child.production_code == f"{run.production_code}-C"
    assert second_child.root_production_code == run.production_code

    codes = {run.stages[0].stage_code, first_child.stages[0].stage_code, second_child.stages[0].stage_code}
    assert len(codes) == 3


def test_split_run_splits_complements_proportionally(
    db_session, production_service, current_user, process, raw_material, target_complement, complement_item
):
    from backend.modules.production.schemas import RunComplementCreate

    raw_material.current_stock = Decimal("60")
    db_session.flush()

    payload = ProductionRunCreate(
        process_id=process.id,
        raw_material_item_id=raw_material.id,
        quantity=Decimal("100"),
        assembly_mode="ASIGNAR",
        products=[RunProductCreate(target_item_id=target_complement.id, quantity=Decimal("100"))],
        complements=[RunComplementCreate(item_id=complement_item.id, quantity=Decimal("50"))],
    )
    run_read = production_service.create_run(payload, current_user)
    run = production_service.repository.get_run(run_read.id)

    child = production_service._split_run_for_partial_material(run, Decimal("60"))

    assert run.complements[0].quantity == Decimal("30")
    assert child.complements[0].quantity == Decimal("20")
    assert run.complements[0].quantity + child.complements[0].quantity == Decimal("50")


def test_split_run_splits_stage_ingredients_proportionally(
    db_session, production_service, current_user, process, raw_material, target_complement
):
    from backend.modules.inventory.models import InventoryItem
    import uuid

    supply = InventoryItem(
        item_type="SUPPLY", name="Hilo", sku=f"IN-{uuid.uuid4().hex[:8]}", unit_code="m",
        current_stock=Decimal("0"),
    )
    db_session.add(supply)
    process.stages[0].ingredients.append(ProductionProcessStageIngredient(inventory_item_id=supply.id))
    db_session.flush()
    config_id = process.stages[0].ingredients[0].id

    raw_material.current_stock = Decimal("60")
    db_session.flush()

    run_read = _create_run(
        production_service, current_user, process, raw_material, target_complement, "100",
        stage_ingredients=[RunStageIngredientCreate(process_stage_ingredient_id=config_id, quantity=Decimal("10"))],
    )
    run = production_service.repository.get_run(run_read.id)

    child = production_service._split_run_for_partial_material(run, Decimal("60"))

    assert run.stages[0].ingredients[0].quantity == Decimal("6")
    assert child.stages[0].ingredients[0].quantity == Decimal("4")


def test_split_run_respects_declared_product_line_order_after_reload(
    db_session, production_service, current_user, process, raw_material, target_complement, complement_item
):
    raw_material.current_stock = Decimal("60")
    db_session.flush()

    payload = ProductionRunCreate(
        process_id=process.id,
        raw_material_item_id=raw_material.id,
        quantity=Decimal("100"),
        assembly_mode="ASIGNAR",
        products=[
            RunProductCreate(target_item_id=target_complement.id, quantity=Decimal("70")),
            RunProductCreate(target_item_id=complement_item.id, quantity=Decimal("30")),
        ],
        complements=[],
    )
    run_read = production_service.create_run(payload, current_user)

    db_session.expire_all()
    run = production_service.repository.get_run(run_read.id)

    child = production_service._split_run_for_partial_material(run, Decimal("60"))

    parent_lines = sorted(run.products, key=lambda p: p.line_order)
    assert [p.quantity for p in parent_lines] == [Decimal("60")]
    child_lines = sorted(child.products, key=lambda p: p.line_order)
    assert [p.quantity for p in child_lines] == [Decimal("10"), Decimal("30")]


def test_approve_materials_splits_when_stock_insufficient(
    db_session, production_service, current_user, process, raw_material, target_complement
):
    raw_material.current_stock = Decimal("60")
    db_session.flush()
    run_read = _create_run(production_service, current_user, process, raw_material, target_complement, "100")

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
    raw_material.current_stock = Decimal("200")
    db_session.flush()
    run_read = _create_run(production_service, current_user, process, raw_material, target_complement, "100")

    approved = production_service.approve_materials(run_read.id, current_user)

    assert approved.status == "MATERIALES_APROBADOS"
    assert approved.quantity == Decimal("100")
    children = [
        r for r in production_service.repository.list_runs()
        if r.parent_run_id == approved.id
    ]
    assert children == []


def test_approve_materials_raises_when_stock_covers_zero(
    db_session, production_service, current_user, process, raw_material, target_complement
):
    raw_material.current_stock = Decimal("0")
    db_session.flush()
    run_read = _create_run(production_service, current_user, process, raw_material, target_complement, "100")

    import pytest

    with pytest.raises(ProductionDomainError, match="Stock insuficiente"):
        production_service.approve_materials(run_read.id, current_user)

    run = production_service.repository.get_run(run_read.id)
    assert run.status == "PENDIENTE_INVENTARIO"
```

- [ ] **Step 2: Correr el test para confirmar que falla**

Run: `docker-compose exec api pytest backend/tests/production/test_material_split.py -v`
Expected: FAIL (`_split_run_for_partial_material` sigue usando `raw_material_quantity_per_unit`; `test_split_run_splits_stage_ingredients_proportionally` falla porque no reparte insumos)

- [ ] **Step 3: Reescribir `_split_run_for_partial_material`**

```python
    def _split_run_for_partial_material(self, run: ProductionRun, covered_qty: Decimal) -> ProductionRun:
        """Reduce `run` a `covered_qty` (cantidad de materia prima, en su
        unidad) y crea una corrida hija ESPERANDO_MATERIAL con el remanente,
        mismo folio raiz. Reparte el plan de productos, los complementos y los
        insumos de etapa proporcionalmente a la MISMA fraccion que cubrio la
        materia prima."""
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
            raw_material_unit_code=run.raw_material_unit_code,
            total_required_material=missing_qty,
            waste_limit_percent=run.waste_limit_percent,
            expected_finished_weight=missing_qty,
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
        code_parts = child.production_code.split("-") if child.production_code else []
        run_seq = int(code_parts[2]) if len(code_parts) > 2 else 0
        split_suffix = code_parts[3] if len(code_parts) > 3 else None
        ratio_missing = missing_qty / original_quantity if original_quantity > 0 else Decimal("0")
        run_stages_by_source = {stage.source_stage_id: stage for stage in run.stages}
        for stage in active_stages:
            stage_code = _stage_code_for(stage.name, run_seq, stage.stage_order)
            if split_suffix:
                stage_code = f"{stage_code}-{split_suffix}"
            run_stage = run_stages_by_source.get(stage.id)
            child_ingredients = []
            if run_stage is not None:
                for ingredient in list(run_stage.ingredients):
                    child_qty = ingredient.quantity * ratio_missing
                    ingredient.quantity = ingredient.quantity - child_qty
                    child_reserved = min(ingredient.reserved_quantity, child_qty)
                    ingredient.reserved_quantity = ingredient.reserved_quantity - child_reserved
                    if child_qty > 0:
                        child_ingredients.append(
                            ProductionRunStageIngredient(
                                inventory_item_id=ingredient.inventory_item_id,
                                quantity=child_qty,
                                reserved_quantity=child_reserved,
                                unit_code=ingredient.unit_code,
                            )
                        )
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
                    stage_code=stage_code,
                    ingredients=child_ingredients,
                )
            )

        # Plan de productos: se llena el padre en el orden de las lineas
        # declaradas y el remanente de cada linea va a la hija. Sin
        # redondeo: la suma siempre cuadra exacto (montos continuos).
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
                        line_order=product.line_order,
                    )
                )
        run.products = [product for product in run.products if product.quantity > 0]

        # Complementos: proporcional a la misma fraccion.
        for complement in list(run.complements):
            child_qty = complement.quantity * ratio_missing
            complement.quantity = complement.quantity - child_qty
            child_reserved = min(complement.reserved_quantity, child_qty)
            complement.reserved_quantity = complement.reserved_quantity - child_reserved
            if child_qty > 0:
                child.complements.append(
                    ProductionComplementRequest(
                        item_id=complement.item_id,
                        quantity=child_qty,
                        reserved_quantity=child_reserved,
                        unit_code=complement.unit_code,
                        status=ComplementRequestStatus.PENDING,
                    )
                )

        run.quantity = covered_qty
        run.total_required_material = covered_qty
        run.expected_finished_weight = run.total_required_material
        run.root_production_code = root_code
        child_material_reserved = min(
            run.reserved_material_quantity, child.total_required_material
        )
        run.reserved_material_quantity = run.reserved_material_quantity - child_material_reserved
        child.reserved_material_quantity = child_material_reserved

        self.repository.add_run(child)
        self.repository.flush()
        return child
```

Agregar `ProductionRunStageIngredient` al import de modelos si aún no está (ya se agregó en Task 5).

Nota: `ratio_missing` ahora se calcula ANTES del loop de etapas (se movió arriba respecto al original) porque el reparto de insumos lo necesita durante ese loop; el reparto de complementos más abajo reusa la misma variable en vez de recalcularla.

- [ ] **Step 4: Correr el test para confirmar que pasa**

Run: `docker-compose exec api pytest backend/tests/production/test_material_split.py -v`
Expected: PASS los 8 tests

- [ ] **Step 5: Commit**

```bash
git add backend/modules/production/service.py backend/tests/production/test_material_split.py
git commit -m "feat(production): split parcial continuo, insumos incluidos en el reparto"
```

---

## Task 8: Aprobación, reserva y destino — consumir desde la corrida, no del proceso

**Files:**
- Modify: `backend/modules/production/service.py:980-1094` (`approve_materials`, incluye consumo de insumos)
- Modify: `backend/modules/production/service.py:831-978` (`preview_allocation`, `reserve_material`, `release_material_reservation`, `start_with_reserved_material`)
- Modify: `backend/modules/production/service.py:1095-1146` (`allocate_material`)
- Modify: `backend/modules/production/service.py:174-184` (`_reservation_is_complete`)
- Modify: `backend/tests/production/test_material_reservation.py` (reescritura)

**Interfaces:**
- Consumes: `_compute_coverage` (Task 6), `run.stages[].ingredients` (Task 5/7).
- Produces: `approve_materials` consume insumos desde `run.stages[].ingredients` (no desde `process.stages[].ingredients`); `reserve_material`/`release_material_reservation`/`_reservation_is_complete` cubren insumos igual que complementos.

- [ ] **Step 1: Reescribir `test_material_reservation.py` (leer el archivo actual primero para preservar los casos que no cambian de fondo)**

Antes de escribir, correr `docker-compose exec api pytest backend/tests/production/test_material_reservation.py -v` para ver qué casos existen hoy y confirmar cuáles quedan igual (los que no dependen de piezas) vs cuáles usan `quantity_per_unit`/`quantity_units` como piezas. Reescribir cada caso que falle reemplazando: cantidades de la orden ya no se multiplican por ratio (usar `quantity` = gramos directos) y `quantity_units` en `allocate_material`/`preview_allocation`/`reserve_material` pasa a ser gramos de materia prima, no piezas. Agregar un caso nuevo:

```python
def test_reserve_material_covers_stage_ingredients_too(
    db_session, production_service, current_user, process, raw_material, target_complement
):
    from backend.modules.inventory.models import InventoryItem
    from backend.modules.production.models import ProductionProcessStageIngredient, ProductionRunStatus
    from backend.modules.production.schemas import ProductionRunCreate, RunProductCreate, RunStageIngredientCreate
    import uuid

    supply = InventoryItem(
        item_type="SUPPLY", name="Hilo", sku=f"IN-{uuid.uuid4().hex[:8]}", unit_code="m",
        current_stock=Decimal("2"),
    )
    db_session.add(supply)
    process.stages[0].ingredients.append(ProductionProcessStageIngredient(inventory_item_id=supply.id))
    db_session.flush()
    config_id = process.stages[0].ingredients[0].id

    raw_material.current_stock = Decimal("0")
    db_session.flush()

    payload = ProductionRunCreate(
        process_id=process.id,
        raw_material_item_id=raw_material.id,
        quantity=Decimal("100"),
        assembly_mode="ASIGNAR",
        products=[RunProductCreate(target_item_id=target_complement.id, quantity=Decimal("100"))],
        stage_ingredients=[RunStageIngredientCreate(process_stage_ingredient_id=config_id, quantity=Decimal("10"))],
    )
    run_read = production_service.create_run(payload, current_user)
    run = production_service.repository.get_run(run_read.id)
    assert run.status == ProductionRunStatus.WAITING_MATERIAL

    production_service.reserve_material(run.id, Decimal("100"), current_user)
    db_session.refresh(run)

    assert run.stages[0].ingredients[0].reserved_quantity == Decimal("2")
    assert production_service._reservation_is_complete(run) is False  # insumo incompleto (2 de 10)
```

Nota: para que este test tenga sentido, `create_run` debe dejar la orden en `ESPERANDO_MATERIAL` cuando la materia prima no alcanza NADA (`raw_material.current_stock = 0`). Verificar: hoy `create_run` siempre deja la orden en `PENDING_INVENTORY`; el paso a `WAITING_MATERIAL` ocurre recien en `approve_materials`. Ajustar el test: llamar primero `production_service.approve_materials(run_read.id, current_user)` (que al no cubrir nada de materia prima debe lanzar `ProductionDomainError`, no crear `WAITING_MATERIAL` automáticamente — revisar Step 2 del Task 6/7: `approve_materials` solo splitea si `covered_qty>0`; con stock=0 lanza error). Para este test, usar en cambio `raw_material.current_stock = Decimal("50")` (50% cobertura) y verificar que tras `approve_materials` la corrida hija queda en `WAITING_MATERIAL`, y sobre ESA hija se prueba `reserve_material`:

```python
def test_reserve_material_covers_stage_ingredients_too(
    db_session, production_service, current_user, process, raw_material, target_complement
):
    from backend.modules.inventory.models import InventoryItem
    from backend.modules.production.models import ProductionProcessStageIngredient
    from backend.modules.production.schemas import ProductionRunCreate, RunProductCreate, RunStageIngredientCreate
    import uuid

    supply = InventoryItem(
        item_type="SUPPLY", name="Hilo", sku=f"IN-{uuid.uuid4().hex[:8]}", unit_code="m",
        current_stock=Decimal("0"),
    )
    db_session.add(supply)
    process.stages[0].ingredients.append(ProductionProcessStageIngredient(inventory_item_id=supply.id))
    db_session.flush()
    config_id = process.stages[0].ingredients[0].id

    raw_material.current_stock = Decimal("50")
    db_session.flush()

    payload = ProductionRunCreate(
        process_id=process.id,
        raw_material_item_id=raw_material.id,
        quantity=Decimal("100"),
        assembly_mode="ASIGNAR",
        products=[RunProductCreate(target_item_id=target_complement.id, quantity=Decimal("100"))],
        stage_ingredients=[RunStageIngredientCreate(process_stage_ingredient_id=config_id, quantity=Decimal("10"))],
    )
    run_read = production_service.create_run(payload, current_user)
    approved = production_service.approve_materials(run_read.id, current_user)
    assert approved.quantity == Decimal("50")

    children = [r for r in production_service.repository.list_runs() if r.parent_run_id == approved.id]
    child = children[0]
    assert child.stages[0].ingredients[0].quantity == Decimal("5")

    supply.current_stock = Decimal("2")
    db_session.flush()
    production_service.reserve_material(child.id, Decimal("50"), current_user)
    db_session.refresh(child)

    assert child.stages[0].ingredients[0].reserved_quantity == Decimal("2")
    assert production_service._reservation_is_complete(child) is False
```

- [ ] **Step 2: Correr los tests de reserva para confirmar que fallan**

Run: `docker-compose exec api pytest backend/tests/production/test_material_reservation.py -v`
Expected: FAIL (varios por `raw_material_quantity_per_unit` ya no existe / cantidades en piezas ya no aplican; el nuevo test falla porque `reserve_material` no toca insumos)

- [ ] **Step 3: Editar `_reservation_is_complete`**

```python
def _reservation_is_complete(run: ProductionRun) -> bool:
    """True si la corrida tiene reservado el 100% de lo que necesita: materia
    prima, cada complemento Y cada insumo de etapa pendiente."""
    if run.reserved_material_quantity < run.total_required_material:
        return False
    for complement in run.complements:
        if complement.status != ComplementRequestStatus.PENDING:
            continue
        if complement.reserved_quantity < complement.quantity:
            return False
    for stage in run.stages:
        for ingredient in stage.ingredients:
            if ingredient.reserved_quantity < ingredient.quantity:
                return False
    return True
```

- [ ] **Step 4: Editar `approve_materials` — consumir insumos desde `run.stages`, no desde `process.stages`**

Reemplazar el bloque (líneas ~1025-1048):

```python
        # Insumos configurados por etapa: se entregan junto con la materia
        # prima (cantidad declarada al crear ESTA orden) y quedan como un
        # movimiento por insumo. Se lee de la corrida (run.stages), no del
        # proceso en vivo: editar el proceso despues no debe alterar ordenes
        # ya creadas, igual que el resto del dominio.
        for stage in sorted(run.stages, key=lambda item: item.stage_order):
            for ingredient in stage.ingredients:
                supply = self.repository.session.get(InventoryItem, ingredient.inventory_item_id)
                supply_name = supply.name if supply is not None else "insumo"
                try:
                    self.inventory_service.consume_material_for_production(
                        item_id=ingredient.inventory_item_id,
                        quantity=ingredient.quantity,
                        production_run_id=run.id,
                        user_id=current_user.id,
                        production_code=run.production_code or run.root_production_code,
                        reason=f"Consumo de insumo en etapa {stage.stage_order}. {stage.stage_name}.",
                    )
                except InventoryDomainError as exc:
                    raise ProductionDomainError(f"Insumo '{supply_name}': {exc}") from exc
                ingredient.reserved_quantity = Decimal("0")
```

Esto reemplaza el bloque anterior que hacía `process = self.repository.get(run.process_id)` y recorría `process.stages`; ese bloque completo (incluida la línea `process = self.repository.get(run.process_id)` si ya no se usa para otra cosa en el método — verificar con `grep -n "process = self.repository.get(run.process_id)" backend/modules/production/service.py` dentro de `approve_materials`) se borra si no queda otra referencia a `process` en el método.

También, en el bloque previo de la función (líneas ~1010-1013) donde se resetea `complement.reserved_quantity = Decimal("0")` antes de consumir, agregar el reseteo simétrico de insumos:

```python
        run.reserved_material_quantity = Decimal("0")
        for complement in run.complements:
            complement.reserved_quantity = Decimal("0")
        for stage in run.stages:
            for ingredient in stage.ingredients:
                ingredient.reserved_quantity = Decimal("0")
        self.repository.flush()
```

(La línea `ingredient.reserved_quantity = Decimal("0")` dentro del loop de consumo del Step anterior queda redundante con este reseteo previo; dejar solo UNA de las dos — se recomienda mantener el reseteo temprano junto a materia prima/complementos, como hace hoy el código, y quitar la línea repetida dentro del loop de consumo.)

- [ ] **Step 5: Editar `reserve_material` — agregar insumos al reparto de reserva**

Dentro de `reserve_material` (líneas ~904-918), después del loop de complementos, agregar el loop de insumos:

```python
        run_quantity = run.quantity or Decimal("0")
        for complement in run.complements:
            if complement.status != ComplementRequestStatus.PENDING:
                continue
            item = self.repository.session.get(InventoryItem, complement.item_id)
            if item is None:
                raise ProductionDomainError("Un complemento solicitado ya no existe en inventario.")
            wanted = complement.quantity * (quantity_units / run_quantity) if run_quantity > 0 else complement.quantity
            pending = complement.quantity - complement.reserved_quantity
            take = min(wanted, pending, free_for_this_run(item, complement.reserved_quantity))
            if take > 0:
                complement.reserved_quantity += take
                added += take
            elif pending > 0:
                short_names.append(item.name)

        for stage in run.stages:
            for ingredient in stage.ingredients:
                item = self.repository.session.get(InventoryItem, ingredient.inventory_item_id)
                if item is None:
                    raise ProductionDomainError("Un insumo solicitado ya no existe en inventario.")
                wanted = ingredient.quantity * (quantity_units / run_quantity) if run_quantity > 0 else ingredient.quantity
                pending = ingredient.quantity - ingredient.reserved_quantity
                take = min(wanted, pending, free_for_this_run(item, ingredient.reserved_quantity))
                if take > 0:
                    ingredient.reserved_quantity += take
                    added += take
                elif pending > 0:
                    short_names.append(item.name)
```

Nota: el `per_unit = complement.quantity / run_quantity` original se reemplaza aquí por `complement.quantity * (quantity_units / run_quantity)` — álgebra equivalente (`per_unit * quantity_units`), reescrito para reusar el mismo patrón en insumos sin declarar una variable `per_unit` intermedia dos veces. Ajustar también el bloque de complementos existente a esta misma forma por consistencia (o dejar `per_unit` y agregar el de insumos igual con su propio `per_unit`; cualquiera de las dos formas es aceptable, mantener una sola por legibilidad).

Actualizar también el chequeo de `already_held` (líneas ~924-931) para incluir insumos:

```python
        already_held = run.reserved_material_quantity + sum(
            (
                complement.reserved_quantity
                for complement in run.complements
                if complement.status == ComplementRequestStatus.PENDING
            ),
            Decimal("0"),
        ) + sum(
            (ingredient.reserved_quantity for stage in run.stages for ingredient in stage.ingredients),
            Decimal("0"),
        )
```

- [ ] **Step 6: Editar `release_material_reservation` — liberar insumos también**

```python
    def release_material_reservation(self, run_id: UUID, current_user: CurrentUser) -> ProductionRunRead:
        run = self.repository.get_run(run_id)
        if run is None:
            raise ProductionNotFoundError("Orden de produccion no encontrada.")
        if run.status != ProductionRunStatus.WAITING_MATERIAL:
            raise ProductionDomainError(
                "Solo se puede liberar la reserva de ordenes en estado ESPERANDO_MATERIAL."
            )
        run.reserved_material_quantity = Decimal("0")
        for complement in run.complements:
            complement.reserved_quantity = Decimal("0")
        for stage in run.stages:
            for ingredient in stage.ingredients:
                ingredient.reserved_quantity = Decimal("0")
        self.repository.flush()
        return self._read_with_names(run)
```

- [ ] **Step 7: Renombrar el parámetro `quantity_units` a `target_material_qty` en `allocate_material`/`preview_allocation`/`reserve_material` (opcional, solo docstrings/comentarios)**

No es necesario renombrar el parámetro en Python (mantiene compatibilidad con el router), pero actualizar los docstrings/comentarios que dicen "unidades"/"piezas" a "cantidad de materia prima" en `preview_allocation` (línea ~840-843: `"No puedes destinar mas unidades de las que la orden necesita."` → `"No puedes destinar mas cantidad de la que la orden necesita."`), `reserve_material` (línea ~867: mismo mensaje), y `allocate_material` (línea ~1115-1116: mismo mensaje).

- [ ] **Step 8: Correr los tests**

Run: `docker-compose exec api pytest backend/tests/production/test_material_reservation.py -v`
Expected: PASS todos

- [ ] **Step 9: Correr toda la suite de producción**

Run: `docker-compose exec api pytest backend/tests/production -v`
Expected: solo quedan fallando `test_process_product_types.py` y `test_receive_merma.py` (Task 9 los arregla)

- [ ] **Step 10: Commit**

```bash
git add backend/modules/production/service.py backend/tests/production/test_material_reservation.py
git commit -m "feat(production): reserva y aprobacion cubren insumos, consumo desde la corrida"
```

---

## Task 9: Ensamble sin auto-aplicar + recetas renombradas

**Files:**
- Modify: `backend/modules/production/service.py:1539-1586` (`_finish_run`, bloque de auto-ensamble)
- Modify: `backend/modules/production/service.py:1587-1665` (`define_run_assembly`, `_upsert_recipe_items`)
- Modify: `backend/modules/production/service.py:1760-1792` (`_recipe_read_for_key`)
- Modify: `backend/tests/production/test_process_product_types.py`, `backend/tests/production/test_receive_merma.py` (ajustar fixtures/cantidades a `ProcessMaterialCreate` sin ratio)
- Test: `backend/tests/production/test_assembly_no_autoapply.py` (nuevo)

**Interfaces:**
- Consumes: `RunAssemblyLineCreate.quantity` (Task 3), `AssemblyRecipeItem.quantity` (Task 1).
- Produces: `_finish_run` deja siempre `assembly_pending=True` en ENSAMBLAR; `define_run_assembly` compara `line.quantity` directo (sin `* run.quantity`); `_upsert_recipe_items`/`_recipe_read_for_key` usan `quantity`.

- [ ] **Step 1: Escribir el test (falla: hoy la orden se auto-aplica sola si la receta alcanza)**

```python
# backend/tests/production/test_assembly_no_autoapply.py
from decimal import Decimal

from backend.modules.production.schemas import (
    AssemblyRecipeUpsert,
    ProductionRunCreate,
    ProductionRunStageFinish,
    RunAssemblyDefine,
    RunAssemblyLineCreate,
    RunComplementCreate,
    RunProductCreate,
)


def test_finish_run_never_autoapplies_even_with_existing_recipe(
    db_session, production_service, current_user, process, raw_material, complement_item, catalog_finished_item,
):
    # Crea una receta previa para el model_key de la pieza destino.
    material_code = production_service._material_code_for_item(raw_material.id)
    part = production_service._model_part_for_piece(catalog_finished_item.id)
    model_key = f"{material_code}{part}"
    production_service.upsert_assembly_recipe(
        model_key,
        AssemblyRecipeUpsert(items=[RunAssemblyLineCreate(complement_item_id=complement_item.id, quantity=Decimal("5"))]),
        current_user,
    )

    raw_material.current_stock = Decimal("1000")
    complement_item.current_stock = Decimal("1000")
    db_session.flush()

    payload = ProductionRunCreate(
        process_id=process.id,
        raw_material_item_id=raw_material.id,
        quantity=Decimal("100"),
        assembly_mode="ENSAMBLAR",
        products=[RunProductCreate(target_item_id=catalog_finished_item.id, quantity=Decimal("100"))],
        complements=[RunComplementCreate(item_id=complement_item.id, quantity=Decimal("5"))],
    )
    run_read = production_service.create_run(payload, current_user)
    production_service.approve_materials(run_read.id, current_user)
    production_service.start_run(run_read.id, current_user)
    run = production_service.repository.get_run(run_read.id)
    stage = run.stages[0]

    finished = production_service.finish_stage(
        stage.id, ProductionRunStageFinish(final_weight=Decimal("95")), current_user
    )

    assert finished.assembly_pending is True
    assert finished.assembly_items == []


def test_define_run_assembly_compares_quantity_directly(
    db_session, production_service, current_user, process, raw_material, complement_item, catalog_finished_item,
):
    raw_material.current_stock = Decimal("1000")
    complement_item.current_stock = Decimal("1000")
    db_session.flush()

    payload = ProductionRunCreate(
        process_id=process.id,
        raw_material_item_id=raw_material.id,
        quantity=Decimal("100"),
        assembly_mode="ENSAMBLAR",
        products=[RunProductCreate(target_item_id=catalog_finished_item.id, quantity=Decimal("100"))],
        complements=[RunComplementCreate(item_id=complement_item.id, quantity=Decimal("5"))],
    )
    run_read = production_service.create_run(payload, current_user)
    production_service.approve_materials(run_read.id, current_user)
    production_service.start_run(run_read.id, current_user)
    run = production_service.repository.get_run(run_read.id)
    production_service.finish_stage(
        run.stages[0].id, ProductionRunStageFinish(final_weight=Decimal("95")), current_user
    )

    defined = production_service.define_run_assembly(
        run_read.id,
        RunAssemblyDefine(items=[RunAssemblyLineCreate(complement_item_id=complement_item.id, quantity=Decimal("5"))]),
        current_user,
    )

    assert defined.assembly_pending is False
    assert defined.assembly_items[0].quantity == Decimal("5")

    import pytest
    from backend.modules.production.service import ProductionDomainError

    # Otra orden igual, pidiendo mas de lo aprobado: debe fallar.
    run_read_2 = production_service.create_run(payload, current_user)
    production_service.approve_materials(run_read_2.id, current_user)
    production_service.start_run(run_read_2.id, current_user)
    run_2 = production_service.repository.get_run(run_read_2.id)
    production_service.finish_stage(
        run_2.stages[0].id, ProductionRunStageFinish(final_weight=Decimal("95")), current_user
    )
    with pytest.raises(ProductionDomainError, match="necesita"):
        production_service.define_run_assembly(
            run_read_2.id,
            RunAssemblyDefine(items=[RunAssemblyLineCreate(complement_item_id=complement_item.id, quantity=Decimal("6"))]),
            current_user,
        )
```

Agregar el fixture `catalog_finished_item` a `backend/tests/production/conftest.py` si no existe ya uno equivalente (revisar antes con `grep -n "FINISHED_PRODUCT" backend/tests/production/conftest.py`; si no existe, crearlo):

```python
@pytest.fixture()
def catalog_finished_item(db_session) -> InventoryItem:
    item = InventoryItem(
        item_type="FINISHED_PRODUCT",
        name="Anillo test",
        sku=f"PT-TEST-{uuid.uuid4().hex[:8]}",
        unit_code="und",
        current_stock=Decimal("0"),
        product_code="1010001",
    )
    db_session.add(item)
    db_session.flush()
    return item
```

- [ ] **Step 2: Correr los tests para confirmar que fallan**

Run: `docker-compose exec api pytest backend/tests/production/test_assembly_no_autoapply.py -v`
Expected: FAIL

- [ ] **Step 3: Editar `_finish_run` — quitar el bloque de auto-aplicar**

Reemplazar (líneas ~1556-1585):

```python
        # ENSAMBLAR siempre queda pendiente de definir a mano, aunque exista
        # una receta previa para el model_key: la receta es solo una
        # sugerencia de prellenado en el frontend (define_run_assembly), no se
        # aplica sola. El usuario confirma o edita las cantidades cada vez.
        if run.assembly_mode == AssemblyMode.ASSEMBLE:
            run.assembly_pending = True
```

- [ ] **Step 4: Editar `define_run_assembly`**

Reemplazar el loop de validación (líneas ~1608-1621) y la construcción de `assembly_items` (líneas ~1623-1629):

```python
        approved = self._approved_complement_totals(run)
        for line in payload.items:
            item = self.repository.session.get(InventoryItem, line.complement_item_id)
            item_name = item.name if item is not None else "complemento"
            if line.complement_item_id not in approved:
                raise ProductionDomainError(
                    f"El complemento '{item_name}' no fue solicitado/aprobado en esta orden."
                )
            if line.quantity > approved[line.complement_item_id]:
                raise ProductionDomainError(
                    f"Complemento '{item_name}': el ensamble necesita {line.quantity} y la orden solo "
                    f"tiene {approved[line.complement_item_id]} aprobados."
                )

        run.assembly_items = [
            ProductionRunAssemblyItem(
                complement_item_id=line.complement_item_id,
                quantity=line.quantity,
            )
            for line in payload.items
        ]
```

- [ ] **Step 5: Editar `_upsert_recipe_items`**

```python
    def _upsert_recipe_items(
        self, model_key: str, lines: list[RunAssemblyLineCreate]
    ) -> None:
        """Reemplaza los items de la receta de ensamble de la clave de modelo
        (o la crea si aun no existe). Guarda la ultima cantidad total usada,
        como sugerencia de prellenado -- nunca se aplica sola."""
        from sqlalchemy import select

        recipe = self.repository.session.execute(
            select(AssemblyRecipe).where(AssemblyRecipe.model_key == model_key)
        ).scalars().first()
        new_items = [
            AssemblyRecipeItem(
                complement_item_id=line.complement_item_id,
                quantity=line.quantity,
            )
            for line in lines
        ]
        if recipe is not None:
            recipe.items = new_items
            recipe.updated_at = datetime.utcnow()
        else:
            recipe = AssemblyRecipe(model_key=model_key, items=new_items)
            self.repository.session.add(recipe)
```

- [ ] **Step 6: Editar `_recipe_read_for_key`**

Cambiar la línea `quantity_per_unit=item.quantity_per_unit` (línea ~1788) a `quantity=item.quantity`.

- [ ] **Step 7: Ajustar `test_process_product_types.py` y `test_receive_merma.py`**

Leer ambos archivos, y en cualquier `ProcessMaterialCreate(...)`/`ProductionProcessMaterial(...)` quitar `quantity_per_unit`/`unit_code`; en cualquier `ProductionRunCreate(quantity=...)` que dependiera de la multiplicación por ratio, ajustar el valor esperado para que sea directo (igual que en Task 7). Ejecutar cada archivo individualmente después de editar para confirmar.

- [ ] **Step 8: Correr los tests para confirmar que pasan**

Run:
```
docker-compose exec api pytest backend/tests/production/test_assembly_no_autoapply.py -v
docker-compose exec api pytest backend/tests/production/test_process_product_types.py -v
docker-compose exec api pytest backend/tests/production/test_receive_merma.py -v
```
Expected: PASS todos

- [ ] **Step 9: Commit**

```bash
git add backend/modules/production/service.py backend/tests/production/test_assembly_no_autoapply.py backend/tests/production/test_process_product_types.py backend/tests/production/test_receive_merma.py backend/tests/production/conftest.py
git commit -m "feat(production): ensamble siempre manual, recetas guardan cantidad total"
```

---

## Task 10: Script de importación histórica

**Files:**
- Modify: `backend/scripts/import_historical_orders.py:220-247`

**Interfaces:**
- Consumes: `ProductionRun` sin `raw_material_quantity_per_unit` (Task 1).

- [ ] **Step 1: Editar el bloque que arma `ProductionRun`**

Leer `backend/scripts/import_historical_orders.py:200-250` primero para confirmar el contexto exacto, luego quitar la línea `raw_material_quantity_per_unit=per_unit,` de la construcción de `ProductionRun` (la variable `per_unit` se sigue usando para `total_required_material`/`expected_finished_weight`, solo se quita el argumento que ya no existe en el modelo).

- [ ] **Step 2: Verificar sintaxis**

Run: `docker-compose exec api python -m compileall backend/scripts/import_historical_orders.py`
Expected: sin errores

- [ ] **Step 3: Commit**

```bash
git add backend/scripts/import_historical_orders.py
git commit -m "fix(scripts): import historico sin raw_material_quantity_per_unit"
```

---

## Task 11: Suite completa de backend

**Files:** ninguno (solo verificación)

- [ ] **Step 1: Correr toda la suite de backend**

Run: `docker-compose exec api pytest`
Expected: 0 failed. Si algo falla fuera de `backend/tests/production/` (por ejemplo tests de `inventory` que referencien `quantity_per_unit` de producción), diagnosticar con `grep -rn "quantity_per_unit\|raw_material_quantity_per_unit" backend/` y corregir el archivo encontrado antes de continuar — no debe quedar ninguna referencia viva salvo en el `downgrade()` de migraciones viejas (histórico, no se toca).

- [ ] **Step 2: Confirmar que no quedan referencias muertas**

Run: `grep -rn "quantity_per_unit" backend/modules backend/scripts`
Expected: sin resultados (todo lo de producción quedó renombrado o eliminado)

---

## Task 12: Frontend — tipos y cliente API

**Files:**
- Modify: `frontend/types/production/index.ts:1-48` (`StageIngredient`, `ProductionProcessMaterial`, `AssemblyRecipe`)
- Modify: `frontend/types/production/index.ts:86-166` (`ProductionRun`: quitar `raw_material_quantity_per_unit`)
- Modify: `frontend/lib/production-api.ts` (payloads de `createProcess`/`updateProcess`, `createProductionRun`, `defineRunAssembly`, `upsertAssemblyRecipe`)

**Interfaces:**
- Produce: tipos y funciones cliente alineados con los schemas del Task 3.

- [ ] **Step 1: Editar `frontend/types/production/index.ts`**

```typescript
export interface StageIngredient {
  id: string;
  inventory_item_id: string;
}
```

```typescript
export type ProductionProcessMaterial = {
  id: string;
  inventory_item_id: string;
};
```

```typescript
// Receta de ensamble por clave de modelo (categoria+modelo): ultima cantidad
// total usada por complemento (sugerencia, no autoritativa).
export type AssemblyRecipe = {
  model_key: string | null;
  items: Array<{ complement_item_id: string; name?: string | null; unit_code?: string | null; material_type?: string | null; quantity: string }>;
};
```

En `ProductionRun`, quitar la línea `raw_material_quantity_per_unit: string;` (línea 106).

- [ ] **Step 2: Editar `frontend/lib/production-api.ts`**

```typescript
export type CreateProductionProcessPayload = {
  name: string;
  description?: string | null;
  version?: number;
  materials: Array<{
    inventory_item_id: string;
  }>;
  waste_limit_percent?: string;
  is_active?: boolean;
  stages: Array<{
    name: string;
    description?: string | null;
    phase_name?: string | null;
    stage_type?: string;
    quality_check?: string | null;
    rework_action?: string | null;
    order: number;
    requires_weighing: boolean;
    is_active?: boolean;
    ingredients?: Array<{
      inventory_item_id: string;
    }>;
  }>;
  product_type_ids?: string[];
};
```

```typescript
export function createProductionRun(payload: {
  process_id: string;
  quantity: string;
  raw_material_item_id: string;
  assembly_mode: "ASIGNAR" | "ENSAMBLAR";
  products: Array<{ product_type_id?: string; target_item_id?: string; quantity: string }>;
  complements?: Array<{ item_id: string; quantity: string }>;
  stage_ingredients?: Array<{ process_stage_ingredient_id: string; quantity: string }>;
}) {
  return apiRequest<ProductionRun>("/api/production/runs", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}
```

```typescript
export function defineRunAssembly(
  runId: string,
  items: Array<{ complement_item_id: string; quantity: string }>,
) {
  return apiRequest<ProductionRun>(`/api/production/runs/${runId}/assembly`, {
    method: "POST",
    body: JSON.stringify({ items }),
  });
}
```

```typescript
export function upsertAssemblyRecipe(
  modelKey: string,
  items: Array<{ complement_item_id: string; quantity: string }>,
) {
  return apiRequest<AssemblyRecipe>(`/api/production/assembly-recipes/${modelKey}`, {
    method: "PUT",
    body: JSON.stringify({ items }),
  });
}
```

- [ ] **Step 3: Compilar TypeScript**

Run: `docker-compose exec web npm run build`
Expected: FALLA aquí (esperado) — `production-dashboard.tsx` todavía usa los campos viejos. Los errores del build apuntan exactamente a las líneas que las Tasks 13-15 corrigen; no se arreglan en esta tarea.

- [ ] **Step 4: Commit**

```bash
git add frontend/types/production/index.ts frontend/lib/production-api.ts
git commit -m "feat(production): tipos y cliente API sin quantity_per_unit"
```

---

## Task 13: Frontend — mantenimiento de procesos (materiales e insumos sin cantidad)

**Files:**
- Modify: `frontend/components/production/production-dashboard.tsx:77-180` (`ProcessMaterialForm`, `processToForm`)
- Modify: `frontend/components/production/production-dashboard.tsx:1065-1161` (`addProcessMaterial`, `updateProcessMaterial`, `buildPayload`)
- Modify: `frontend/components/production/production-dashboard.tsx:3357-3403` (fila de materia prima en el formulario)
- Modify: `frontend/components/production/production-dashboard.tsx:3561-3610` (fila de insumo por etapa en el formulario)

**Interfaces:**
- Consumes: tipos del Task 12.

- [ ] **Step 1: Editar tipos de formulario (líneas 65-91)**

```typescript
type StageForm = {
  name: string;
  description: string;
  phaseName: string;
  stageType: string;
  qualityCheck: string;
  reworkAction: string;
  reworkTargetOrder: string;
  requiresWeighing: boolean;
  ingredients: Array<{ inventoryItemId: string; unitCode: string }>;
};

type ProcessMaterialForm = {
  inventoryItemId: string;
  unitCode: string;
};
```

- [ ] **Step 2: Editar `processToForm` (líneas 152-180)**

```typescript
function processToForm(process: ProductionProcess): ProcessForm {
  const stages = process.stages.length > 0 ? process.stages : [];
  return {
    name: process.name,
    description: process.description ?? "",
    materials: process.materials.map((material) => ({
      inventoryItemId: material.inventory_item_id,
      unitCode: "",
    })),
    wasteLimitPercent: process.waste_limit_percent ?? "1",
    stages: stages.length > 0 ? stages.map((stage) => ({
      name: stage.name,
      description: stage.description ?? "",
      phaseName: stage.phase_name ?? "",
      stageType: stage.stage_type ?? "PROCESS",
      qualityCheck: stage.quality_check ?? "",
      reworkAction: stage.rework_action ?? "",
      reworkTargetOrder: stage.rework_target_order ? String(stage.rework_target_order) : "",
      requiresWeighing: stage.requires_weighing,
      ingredients: (stage.ingredients ?? []).map((ing) => ({
        inventoryItemId: String(ing.inventory_item_id),
        unitCode: "",
      })),
    })) : [emptyStage()],
    productTypeIds: (process.product_type_ids ?? []).map(String),
  };
}
```

(`unitCode` queda solo para mostrar la unidad del item elegido en la UI del picker, ya no viaja al payload.)

- [ ] **Step 3: Editar `addProcessMaterial`, `addStageIngredient`, `buildPayload` (líneas 1065-1161)**

```typescript
  function addProcessMaterial(item: InventoryItem) {
    setForm((current) => ({
      ...current,
      materials: [...current.materials, { inventoryItemId: item.id, unitCode: item.unit_code }],
    }));
    setIsMaterialPickerOpen(false);
  }
```

```typescript
  function addStageIngredient(item: InventoryItem) {
    updateStage({
      ingredients: [...selectedStage.ingredients, { inventoryItemId: item.id, unitCode: item.unit_code }],
    });
    setIsIngredientPickerOpen(false);
  }
```

Quitar `updateProcessMaterial` por completo (ya no hay campo editable en la fila de materia prima; solo agregar/quitar). Buscar sus usos con `grep -n "updateProcessMaterial" frontend/components/production/production-dashboard.tsx` y confirmar que solo aparecía en la fila que se borra en el Step 4 — si es así, eliminar la función.

```typescript
  function buildPayload() {
    const processName = form.name.trim();

    if (!processName) {
      throw new Error("El nombre del proceso es obligatorio.");
    }
    if (form.stages.some((stage) => !stage.name.trim())) {
      throw new Error("Todas las etapas agregadas deben tener nombre.");
    }
    if (form.materials.length === 0) {
      throw new Error("Agrega al menos una materia prima.");
    }
    const materialIds = form.materials.map((material) => material.inventoryItemId);
    if (new Set(materialIds).size !== materialIds.length) {
      throw new Error("No repitas la misma materia prima.");
    }

    return {
      name: processName,
      description: form.description.trim() || null,
      version: 1,
      materials: form.materials.map((material) => ({
        inventory_item_id: material.inventoryItemId,
      })),
      waste_limit_percent: "1",
      is_active: true,
      product_type_ids: form.productTypeIds,
      stages: form.stages.map((stage, index) => ({
        name: stage.name.trim(),
        description: stage.description.trim() || null,
        phase_name: stage.phaseName.trim() || null,
        stage_type: stage.stageType || "PROCESS",
        quality_check: stage.qualityCheck.trim() || null,
        rework_action: stage.reworkAction.trim() || null,
        rework_target_order: stage.reworkTargetOrder ? Number(stage.reworkTargetOrder) : null,
        order: index + 1,
        requires_weighing: stage.requiresWeighing,
        is_active: true,
        ingredients: stage.ingredients
          .filter((ing) => ing.inventoryItemId)
          .map((ing) => ({
            inventory_item_id: ing.inventoryItemId,
          })),
      })),
    };
  }
```

- [ ] **Step 4: Editar la fila de materia prima en el formulario (líneas 3357-3403)**

```tsx
            <div className="fieldGroup">
              <span>Materias primas del proceso</span>
              <div className="materialList">
                {form.materials.map((material, materialIndex) => {
                  const selectedItem = processMaterialPool.find((item) => item.id === material.inventoryItemId);
                  return (
                    <div key={materialIndex} style={{ display: "flex", gap: 8, alignItems: "center" }}>
                      <div className="field" style={{ flex: 1, display: "flex", alignItems: "center" }}>
                        {selectedItem
                          ? `${selectedItem.name} · ${itemTypeLabel(selectedItem.item_type)} · ${selectedItem.unit_code}`
                          : material.inventoryItemId}
                      </div>
                      <button
                        aria-label="Quitar material"
                        className="iconOnlyButton dangerIconButton"
                        disabled={isSaving}
                        onClick={() => removeProcessMaterial(materialIndex)}
                        type="button"
                      >
                        <X aria-hidden="true" size={14} />
                      </button>
                    </div>
                  );
                })}
              </div>
              <button className="button" disabled={isSaving} onClick={() => setIsMaterialPickerOpen(true)} type="button">
                <Plus aria-hidden="true" size={14} />
                Agregar material
              </button>
            </div>
```

- [ ] **Step 5: Editar la fila de insumo por etapa (líneas 3561-3610)**

```tsx
                  <div className="fieldGroup">
                    <span>Materiales que entran en esta etapa</span>
                    <div className="ingredientList">
                      {selectedStage.ingredients.map((ing, ingIndex) => {
                        const selectedItem = suppliesList.find((m) => m.id === ing.inventoryItemId);
                        return (
                          <div key={ingIndex} style={{ display: "flex", gap: 8, alignItems: "center" }}>
                            <span className="field" style={{ flex: 1, display: "flex", alignItems: "center" }}>
                              {selectedItem ? `${selectedItem.name} · ${selectedItem.unit_code}` : ing.inventoryItemId}
                            </span>
                            <button
                              type="button"
                              className="iconOnlyButton dangerIconButton"
                              onClick={() => {
                                updateStage({
                                  ingredients: selectedStage.ingredients.filter((_, idx) => idx !== ingIndex),
                                });
                              }}
                              aria-label="Quitar material"
                            >
                              <X aria-hidden="true" size={14} />
                            </button>
                          </div>
                        );
                      })}
                      <button type="button" className="button" onClick={() => setIsIngredientPickerOpen(true)}>
                        <Plus aria-hidden="true" size={14} />
                        Agregar material
                      </button>
                    </div>
                  </div>
```

- [ ] **Step 6: Buscar y limpiar referencias residuales**

Run: `grep -n "quantityPerUnit\|quantity_per_unit\|updateProcessMaterial" frontend/components/production/production-dashboard.tsx`
Expected: sin resultados dentro de las secciones de mantenimiento de proceso (pueden quedar resultados en las secciones de receta/ensamble, que se limpian en Task 15).

- [ ] **Step 7: Commit**

```bash
git add frontend/components/production/production-dashboard.tsx
git commit -m "feat(production): mantenimiento de procesos sin cantidad por unidad en UI"
```

---

## Task 14: Frontend — creación de orden (cantidad decimal + insumos obligatorios)

**Files:**
- Modify: `frontend/components/production/production-dashboard.tsx:481-483` (estado `runQuantity`)
- Modify: `frontend/components/production/production-dashboard.tsx:1220-1288` (`handleCreateProductionOrder`)
- Modify: `frontend/components/production/production-dashboard.tsx:1674-1687` (`resetCreateOrderState`)
- Modify: `frontend/components/production/production-dashboard.tsx:2306-2387` (JSX de la modal "Crear orden")

**Interfaces:**
- Consumes: `createProductionRun` con `stage_ingredients` (Task 12).
- Produces: nuevo estado `stageIngredientQuantities: Record<string, string>` (clave = `process_stage_ingredient_id`).

- [ ] **Step 1: Agregar estado nuevo junto a `runQuantity` (línea 483)**

```typescript
  const [runQuantity, setRunQuantity] = useState("1");
  // Cantidad a usar de cada insumo configurado en las etapas activas del
  // proceso elegido, tecleada al crear la orden (clave = id de la fila de
  // configuracion ProductionProcessStageIngredient).
  const [stageIngredientQuantities, setStageIngredientQuantities] = useState<Record<string, string>>({});
```

- [ ] **Step 2: Calcular la lista de insumos configurados del proceso elegido (agregar cerca de `selectedMaterial`, línea ~623)**

```typescript
  const selectedMaterial = orderMaterialPool.find((item) => item.id === selectedMaterialId) ?? null;
  // Insumos configurados en las etapas activas del proceso elegido: se piden
  // obligatorios al crear la orden, igual que los complementos.
  const configuredStageIngredients = (selectedProcess?.stages ?? []).flatMap((stage) =>
    (stage.ingredients ?? []).map((ing) => ({
      configId: ing.id,
      stageName: stage.name,
      inventoryItemId: ing.inventory_item_id,
    })),
  );
```

- [ ] **Step 3: Editar `resetCreateOrderState` (líneas 1676-1687)**

```typescript
  function resetCreateOrderState() {
    recipeLookupSeq.current += 1;
    setOrderProduct(null);
    setAssemblyMode("ASIGNAR");
    setRunQuantity("1");
    setStageIngredientQuantities({});
    setOrderRecipe(null);
    setRecipeModalModelKey(null);
    setRecipeLines([]);
    setIsRecipeComplementPickerOpen(false);
    setItemPickerFor((current) => (current === "create" ? null : current));
    setTypePickerFor((current) => (current === "create" ? null : current));
  }
```

- [ ] **Step 4: Editar `handleCreateProductionOrder` (líneas 1220-1288)**

```typescript
  async function handleCreateProductionOrder() {
    if (!selectedProcess) {
      setError("Selecciona un proceso para producir.");
      return;
    }
    if (!runQuantity || Number(runQuantity) <= 0) {
      setError("Ingresa una cantidad valida para fabricar.");
      return;
    }
    if (!selectedMaterialId) {
      setError("Selecciona la materia prima con la que se fabricará esta orden.");
      return;
    }

    if (!orderProduct || (!orderProduct.targetItemId && !orderProduct.productTypeId)) {
      setError(
        assemblyMode === "ENSAMBLAR"
          ? "Elige el producto final a ensamblar."
          : "Elige el producto a fabricar."
      );
      return;
    }

    const missingIngredient = configuredStageIngredients.find(
      (ing) => !(Number(stageIngredientQuantities[ing.configId]) > 0),
    );
    if (missingIngredient) {
      setError("Ingresa la cantidad de todos los insumos de este proceso.");
      return;
    }

    const productsPayload = [productRowToPayload(orderProduct, runQuantity)];

    // ASIGNAR no solicita complementos. ENSAMBLAR usa las cantidades totales
    // definidas a mano en orderRecipe (formulario editable, ver Task 15) --
    // nunca se calculan solas multiplicando por la cantidad de la orden.
    let complementsPayload: Array<{ item_id: string; quantity: string }> = [];
    if (assemblyMode === "ENSAMBLAR") {
      const productKey = orderProduct.targetItemId ?? orderProduct.productTypeId;
      if (!orderRecipe || orderRecipe.key !== productKey || orderRecipe.recipe.items.length === 0) {
        setError("Este producto necesita complementos definidos para ensamblar.");
        return;
      }
      complementsPayload = orderRecipe.recipe.items.map((item) => ({
        item_id: item.complement_item_id,
        quantity: String(Number(item.quantity)),
      }));
    }

    const stageIngredientsPayload = configuredStageIngredients.map((ing) => ({
      process_stage_ingredient_id: ing.configId,
      quantity: stageIngredientQuantities[ing.configId],
    }));

    setError(null);
    setSuccess(null);
    setIsSaving(true);
    try {
      await createProductionRun({
        process_id: selectedProcess.id,
        quantity: runQuantity,
        raw_material_item_id: selectedMaterialId,
        assembly_mode: assemblyMode,
        products: productsPayload,
        complements: complementsPayload,
        stage_ingredients: stageIngredientsPayload,
      });
      setSuccess("Orden creada. Inventario debe aprobar la salida de materia prima y complementos.");
      setIsCreateOrderOpen(false);
      resetCreateOrderState();
      await reload();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "No se pudo crear la orden de produccion.");
    } finally {
      setIsSaving(false);
    }
  }
```

- [ ] **Step 5: Editar el JSX de la modal "Crear orden" (líneas 2306-2387) — quitar `step="1"`/validación entera y agregar sección de insumos**

```tsx
            <label className="fieldGroup">
              <span>Cantidad a fabricar {selectedMaterial ? `(${selectedMaterial.unit_code})` : ""}</span>
              <input className="field" min="0.0001" onChange={(e) => setRunQuantity(e.target.value)} step="0.0001" type="number" value={runQuantity} />
            </label>

            {configuredStageIngredients.length > 0 ? (
              <div className="fieldGroup">
                <span>Insumos de este proceso</span>
                <div className="tableWrap">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Insumo</th>
                        <th>Etapa</th>
                        <th className="num">Cantidad</th>
                      </tr>
                    </thead>
                    <tbody>
                      {configuredStageIngredients.map((ing) => {
                        const item = rawMaterials.find((candidate) => candidate.id === ing.inventoryItemId);
                        return (
                          <tr key={ing.configId}>
                            <td>{item?.name ?? ing.inventoryItemId}</td>
                            <td>{ing.stageName}</td>
                            <td className="num">
                              <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                                <input
                                  aria-label={`Cantidad de ${item?.name ?? "insumo"}`}
                                  className="field"
                                  min="0"
                                  onChange={(event) =>
                                    setStageIngredientQuantities((current) => ({
                                      ...current,
                                      [ing.configId]: event.target.value,
                                    }))
                                  }
                                  step="0.0001"
                                  style={{ width: 90 }}
                                  type="number"
                                  value={stageIngredientQuantities[ing.configId] ?? ""}
                                />
                                <span style={{ color: "var(--muted)", fontSize: 13 }}>{item?.unit_code ?? ""}</span>
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>
            ) : null}

            <button
              className="button buttonPrimary"
              disabled={isSaving || !selectedProcess || !selectedMaterialId}
              onClick={() => void handleCreateProductionOrder()}
              type="button"
            >
              <Play aria-hidden="true" size={16} />
              Crear orden
            </button>
```

(Reemplaza el bloque original que iba desde `<label className="fieldGroup"><span>Cantidad a fabricar</span>` hasta el botón "Crear orden".)

- [ ] **Step 6: Commit**

```bash
git add frontend/components/production/production-dashboard.tsx
git commit -m "feat(production): crear orden pide cantidad decimal e insumos obligatorios"
```

---

## Task 15: Frontend — complementos/ensamble siempre editables (sin auto-cálculo)

**Files:**
- Modify: `frontend/components/production/production-dashboard.tsx:1608-1645` (`loadOrderRecipeForChoice`)
- Modify: `frontend/components/production/production-dashboard.tsx:1704-1755` (`addRecipeLine`, `updateRecipeLinePerUnit`, `handleSaveRecipe`)
- Modify: `frontend/components/production/production-dashboard.tsx:2391-2490` (modal "Definir ensamble")
- Modify: `frontend/components/production/production-dashboard.tsx:2654-2657` (fila de receta en "Recetas de ensamble")
- Modify: `frontend/components/production/production-dashboard.tsx:2669-2678` (prellenado al editar receta)
- Modify: `frontend/components/production/production-dashboard.tsx:2758-2799` (JSX modal "Definir receta")

**Interfaces:**
- Consumes: `AssemblyRecipe.items[].quantity` (Task 12), `defineRunAssembly`/`upsertAssemblyRecipe` con `quantity` (Task 12).

- [ ] **Step 1: Editar `loadOrderRecipeForChoice` — SIEMPRE abrir el formulario editable, prellenado si hay receta**

```typescript
  async function loadOrderRecipeForChoice(choice: ProductChoice) {
    setError(null);
    if (!selectedMaterialId) {
      setError("Elige primero el material.");
      setOrderProduct(null);
      setOrderRecipe(null);
      return;
    }
    const key = choice.targetItemId ?? choice.productTypeId ?? "";
    const seq = ++recipeLookupSeq.current;
    try {
      const recipe = choice.targetItemId
        ? await getAssemblyRecipe({ itemId: choice.targetItemId, materialItemId: selectedMaterialId })
        : await getAssemblyRecipe({ productTypeId: choice.productTypeId, materialItemId: selectedMaterialId });

      if (seq !== recipeLookupSeq.current) return;

      if (!recipe.model_key) {
        setError("Esta pieza no tiene tipo en el catálogo: usa Asignar.");
        setOrderProduct(null);
        setOrderRecipe(null);
        return;
      }
      // Siempre se pide confirmar/editar los complementos, aunque ya exista
      // una receta previa: sus valores solo prellenan como sugerencia.
      setOrderRecipe(null);
      setRecipeLines(
        recipe.items.map((item) => ({
          itemId: item.complement_item_id,
          label: item.name ?? "Complemento",
          unitCode: item.unit_code ?? "",
          perUnit: String(Number(item.quantity)),
        })),
      );
      setRecipeModalContext("order");
      setRecipeModalModelKey(recipe.model_key);
    } catch (nextError) {
      if (seq !== recipeLookupSeq.current) return;
      setError(nextError instanceof Error ? nextError.message : "No se pudo cargar la receta.");
      setOrderProduct(null);
      setOrderRecipe(null);
    }
  }
```

(El campo interno `perUnit` del estado `recipeLines` se deja con ese nombre para minimizar el diff, pero ahora representa "cantidad total", no "por unidad" — ver Step 4 para el rótulo visible.)

- [ ] **Step 2: Editar `handleSaveRecipe`**

```typescript
  async function handleSaveRecipe() {
    if (!recipeModalModelKey) return;
    if (recipeLines.length === 0 || recipeLines.some((line) => !(Number(line.perUnit) > 0))) {
      setError("Completa la cantidad de todos los complementos (o quita los que sobren).");
      return;
    }
    if (recipeLines.some((line) => (line.perUnit.split(".")[1]?.length ?? 0) > 4)) {
      setError("Máximo 4 decimales.");
      return;
    }

    setError(null);
    setSuccess(null);
    setIsSaving(true);
    try {
      const saved = await upsertAssemblyRecipe(
        recipeModalModelKey,
        recipeLines.map((line) => ({ complement_item_id: line.itemId, quantity: line.perUnit })),
      );
      if (recipeModalContext === "order") {
        const key = orderProduct ? orderProduct.targetItemId ?? orderProduct.productTypeId ?? recipeModalModelKey : recipeModalModelKey;
        setOrderRecipe({ key, recipe: saved });
      }
      setRecipeModalModelKey(null);
      setRecipeLines([]);
      setRecipeModalContext("order");
      setSuccess("Complementos guardados.");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["assembly-recipe-model-keys"] }),
        queryClient.invalidateQueries({ queryKey: ["assembly-recipes"] }),
      ]);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "No se pudo guardar.");
    } finally {
      setIsSaving(false);
    }
  }
```

- [ ] **Step 3: Editar el modal "Definir ensamble" (líneas 2391-2490) — quitar la multiplicación por `runQuantity`**

```tsx
      {assemblyRun ? (() => {
        const approvedComplements = (assemblyRun.complements ?? []).filter((complement) => complement.status === "APROBADA");
        const hasValidLine = assemblyLines.some((line) => Number(line.perUnit) > 0);
        const hasExcess = assemblyLines.some((line) => {
          const qty = Number(line.perUnit);
          if (!(qty > 0)) return false;
          const complement = approvedComplements.find((candidate) => candidate.item_id === line.itemId);
          const approvedQty = complement ? Number(complement.quantity) : 0;
          return qty > approvedQty;
        });
        const canSubmitAssembly = hasValidLine && !hasExcess;
        return (
          <div className="modalBackdrop modalBackdropTop" role="dialog" aria-modal="true" aria-label="Definir ensamble">
            <section className="modalWindow processViewWindow">
              <div className="modalHeader">
                <div>
                  <h2>Definir ensamble</h2>
                  <p>{assemblyRun.production_code ?? ""} · fabrica {numericText(assemblyRun.quantity)} {assemblyRun.raw_material_unit_code}</p>
                </div>
                <button aria-label="Cerrar" className="iconOnlyButton" onClick={closeAssemblyModal} type="button">
                  <X aria-hidden="true" size={18} />
                </button>
              </div>
              {approvedComplements.length > 0 ? (
                <div className="tableWrap">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Complemento</th>
                        <th className="num">Aprobado</th>
                        <th className="num">Cantidad a usar</th>
                      </tr>
                    </thead>
                    <tbody>
                      {approvedComplements.map((complement) => {
                        const line = assemblyLines.find((candidate) => candidate.itemId === complement.item_id);
                        const qty = line?.perUnit ?? "";
                        const qtyNumber = Number(qty);
                        const approvedQty = Number(complement.quantity);
                        const exceeds = qtyNumber > 0 && qtyNumber > approvedQty;
                        return (
                          <tr key={complement.id}>
                            <td>{complement.name ?? "—"}</td>
                            <td className="num">{numericText(complement.quantity)} {complement.unit_code}</td>
                            <td className="num">
                              <input
                                aria-label={`Cantidad a usar de ${complement.name ?? "complemento"}`}
                                className="field"
                                min="0"
                                onChange={(event) => {
                                  const value = event.target.value;
                                  setAssemblyLines((current) =>
                                    current.map((candidate) =>
                                      candidate.itemId === complement.item_id ? { ...candidate, perUnit: value } : candidate,
                                    ),
                                  );
                                }}
                                step="0.0001"
                                style={{ width: 90 }}
                                type="number"
                                value={qty}
                              />
                              {exceeds ? (
                                <small style={{ display: "block", color: "var(--danger, #c0392b)" }}>
                                  Supera lo aprobado
                                </small>
                              ) : null}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="emptyState">Esta orden no tiene complementos aprobados.</div>
              )}
              <div className="modalActions">
                <button
                  className="button buttonPrimary"
                  disabled={isSaving || !canSubmitAssembly}
                  onClick={() => void handleDefineAssembly()}
                  type="button"
                >
                  <Puzzle aria-hidden="true" size={15} />
                  {isSaving ? "Guardando" : "Definir ensamble"}
                </button>
              </div>
            </section>
          </div>
        );
      })() : null}
```

- [ ] **Step 4: Buscar `handleDefineAssembly` y actualizar el payload que arma (usa `defineRunAssembly`)**

```
grep -n "async function handleDefineAssembly" frontend/components/production/production-dashboard.tsx
```

Leer esa función y cambiar cualquier `{ complement_item_id: line.itemId, quantity_per_unit: line.perUnit }` a `{ complement_item_id: line.itemId, quantity: line.perUnit }` (coincide con la firma nueva de `defineRunAssembly` del Task 12).

- [ ] **Step 5: Editar la fila de receta en "Recetas de ensamble" (líneas 2654-2657) y el prellenado al editar (líneas 2669-2678)**

```tsx
                            {recipe.items.map((item) => (
                              <div key={item.complement_item_id}>
                                {numericText(item.quantity)} {item.unit_code ?? ""} × {item.name ?? "Complemento"}
                                {item.material_type ? ` (${item.material_type})` : ""}
                              </div>
                            ))}
```

```tsx
                                  setRecipeLines(
                                    recipe.items.map((item) => ({
                                      itemId: item.complement_item_id,
                                      label: item.name ?? "Complemento",
                                      unitCode: item.unit_code ?? "",
                                      perUnit: String(Number(item.quantity)),
                                    })),
                                  );
```

- [ ] **Step 6: Editar rótulos del modal "Definir receta" (líneas 2758-2799) — "Por unidad" → "Cantidad"**

```tsx
                    <tr>
                      <th>Complemento</th>
                      <th className="num">Cantidad</th>
                      <th aria-label="Quitar" />
                    </tr>
```

```tsx
                            <input
                              aria-label={`Cantidad de ${line.label}, en ${line.unitCode || "su unidad"}`}
                              className="field"
                              min="0"
                              onChange={(event) => updateRecipeLinePerUnit(line.itemId, event.target.value)}
                              step="0.0001"
                              style={{ width: 90 }}
                              type="number"
                              value={line.perUnit}
                            />
```

También cambiar el título/descripción del header de la modal (buscar `<h2>Definir receta</h2>` y el texto `"complementos y cantidad por unidad"`) a `"complementos y cantidad a usar"`, y el header de "Recetas de ensamble" (`<p>Complementos por unidad de cada producto</p>`) a `<p>Ultima cantidad usada de cada complemento</p>`.

- [ ] **Step 7: Buscar referencias residuales**

Run: `grep -n "quantity_per_unit\|Por unidad\|perUnit \* run" frontend/components/production/production-dashboard.tsx`
Expected: sin resultados

- [ ] **Step 8: Commit**

```bash
git add frontend/components/production/production-dashboard.tsx
git commit -m "feat(production): complementos y ensamble siempre editables, sin auto-calculo"
```

---

## Task 16: Frontend — build y verificación manual

**Files:** ninguno (solo verificación)

- [ ] **Step 1: Build de TypeScript**

Run: `docker-compose exec web npm run build`
Expected: sin errores. Si aparecen, son referencias residuales a campos eliminados (`quantity_per_unit`, `raw_material_quantity_per_unit`, `updateProcessMaterial`) — corregirlas antes de continuar.

- [ ] **Step 2: Lint**

Run: `docker-compose exec web npm run lint`
Expected: sin errores nuevos.

- [ ] **Step 3: Verificación manual en navegador (checklist, no automatizable sin suite E2E)**

Con el stack corriendo (`docker-compose up`, ya levantado por el usuario):
1. Mantenimiento → Procesos → crear/editar un proceso: la fila de materia prima ya no pide cantidad; agregar un insumo a una etapa tampoco pide cantidad.
2. Producción → Crear orden: elegir proceso con insumos configurados, confirmar que aparece la sección "Insumos de este proceso" con inputs obligatorios; "Cantidad a fabricar" acepta decimales.
3. Crear orden en modo ENSAMBLAR sobre un producto con receta previa: confirmar que SIEMPRE abre el formulario de complementos prellenado (no se auto-envía sin mostrarlo).
4. Terminar una orden ENSAMBLAR hasta la última etapa: confirmar que queda `assembly_pending` y hay que definir el ensamble a mano en "Definir ensamble", aunque exista receta previa para ese modelo.
5. Provocar un split por falta de stock (materia prima insuficiente) en una orden con insumos configurados: confirmar que la corrida hija en "Esperando material" refleja proporción correcta.

Reportar cualquier desviación antes de cerrar la tarea.

- [ ] **Step 4: Commit (si hubo ajustes durante la verificación)**

```bash
git add -A
git commit -m "fix(production): ajustes tras verificacion manual de cantidades directas"
```

(Omitir este commit si no hubo cambios.)

---

## Self-Review

**Cobertura del spec:**
- Creación de orden (spec §1) → Tasks 3, 5, 14.
- Mantenimiento de procesos (spec §2) → Tasks 3, 4, 13.
- Complementos y ensamble (spec §3) → Tasks 3, 9, 15.
- Split parcial por fracción (spec §4) → Tasks 6, 7.
- Insumos por etapa (spec §5) → Tasks 1, 3, 5, 7, 8, 13, 14.
- Migraciones de esquema (spec §6) → Task 1.
- Tests a reescribir (spec §7) → Tasks 4, 7, 8, 9, 11.
- Frontend a tocar (spec §8) → Tasks 12-16.

**Placeholders:** ninguno pendiente; cada paso trae código completo o instrucciones de `grep`/lectura previa explícitas antes de editar (necesarias porque varias funciones son largas y el archivo se edita en más de una tarea).

**Consistencia de tipos:** `RunStageIngredientCreate(process_stage_ingredient_id, quantity)` (Task 3) se usa igual en `create_run` (Task 5), en el payload frontend (Task 12/14) y en los tests (Task 5/7/8). `AssemblyRecipeItem.quantity`/`RunAssemblyLineCreate.quantity` (Task 1/3) se usa consistente en `define_run_assembly`, `_upsert_recipe_items`, `_recipe_read_for_key` (Task 9) y en el frontend (Task 12/15).
