# Automatizar material por etapa y eliminar el flujo viejo — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Eliminar la aprobación de materiales del flujo viejo de producción
(y su UI de "Solicitudes") y automatizar la validación de stock + split por
falta de material dentro de cada intento de etapa del flujo nuevo
(`start_stage_attempt`), con aprobación manual puntual solo cuando el split
deja un remanente.

**Architecture:** Todo el cambio vive en `backend/modules/production/` (nueva
tabla `production_run_stage_attempt_materials`, nuevo estado
`PENDIENTE_MATERIAL`, lógica de cobertura en `service.py`) y en tres
componentes de frontend (`production-dashboard.tsx`, `inventory-dashboard.tsx`,
`solicitudes-view.tsx`). No se toca el esquema de las tablas del flujo viejo
(se conservan para historial) — solo el código que las muta.

**Tech Stack:** FastAPI + SQLAlchemy 2.0 + Alembic (backend), Next.js 16 +
React Query (frontend). Ver spec:
`docs/superpowers/specs/2026-08-19-automatizar-material-por-etapa-design.md`.

## Global Constraints

- Español-first en UI/mensajes; código en inglés salvo enums de dominio.
- `create_movement`/`consume_material_for_production` son el único camino
  para tocar `current_stock` — nunca editarlo a mano.
- Cada `get_*_service()` de router es la unidad transaccional (commit/rollback
  automático) — los métodos de `service.py` usan `flush()`, nunca `commit()`.
- Los services levantan `ProductionDomainError`/`ProductionNotFoundError`;
  nunca `HTTPException` fuera de `router.py`.
- Toda columna nueva necesita su migración Alembic.
- Después de tocar backend: `docker-compose exec api pytest backend/tests/production`.
- Después de tocar frontend: `docker-compose exec web npm run build`.

---

## Task 1: Modelo — tabla de materiales por intento de etapa

**Files:**
- Modify: `backend/modules/production/models.py`
- Create: nueva migración en `backend/alembic/versions/`

**Interfaces:**
- Produces: `ProductionRunStageAttemptMaterial` (columnas `id`,
  `stage_attempt_id`, `item_id`, `unit_code`, `quantity_requested`,
  `quantity_pending`), `StageAttemptStatus.WAITING_MATERIAL = "PENDIENTE_MATERIAL"`,
  y `ProductionRunStageAttempt.materials` (relationship).

- [ ] **Step 1: Agregar el nuevo estado a `StageAttemptStatus`**

En `backend/modules/production/models.py`, la clase `StageAttemptStatus`
(cerca de `class StageAttemptStatus:` con `IN_PROGRESS`/`APPROVED`/`REJECTED`)
queda:

```python
class StageAttemptStatus:
    IN_PROGRESS = "EN_PROCESO"
    APPROVED = "APROBADA"
    REJECTED = "RECHAZADA"
    # Split por falta de stock al iniciar la etapa (o al asignar despues del
    # split): la parte cubierta arranca en IN_PROGRESS, el remanente queda
    # aca hasta que alguien apriete "Asignar material disponible"
    # (allocate_stage_attempt_material) y alcance el 100%.
    WAITING_MATERIAL = "PENDIENTE_MATERIAL"
```

- [ ] **Step 2: Agregar el modelo `ProductionRunStageAttemptMaterial`**

Inmediatamente después de la clase `ProductionRunStageAttempt` (después de su
atributo `run: Mapped["ProductionRun"] = relationship(back_populates="stage_attempts")`),
agregar:

```python
class ProductionRunStageAttemptMaterial(Base):
    """Una linea de material declarada al iniciar un intento de etapa (flujo
    nuevo, seccion 4). quantity_pending baja cada vez que se consume (al
    iniciar si alcanza, o via allocate_stage_attempt_material si quedo
    corta) -- llega a 0 cuando esta linea esta completamente cubierta."""

    __tablename__ = "production_run_stage_attempt_materials"

    id: Mapped[PyUUID] = mapped_column(PG_UUID(as_uuid=True), primary_key=True, default=uuid4)
    stage_attempt_id: Mapped[PyUUID] = mapped_column(
        ForeignKey("production_run_stage_attempts.id", ondelete="CASCADE"), nullable=False, index=True
    )
    item_id: Mapped[PyUUID] = mapped_column(PG_UUID(as_uuid=True), nullable=False)
    unit_code: Mapped[str] = mapped_column(String(20), nullable=False)
    quantity_requested: Mapped[Decimal] = mapped_column(Numeric(14, 4), nullable=False)
    quantity_pending: Mapped[Decimal] = mapped_column(Numeric(14, 4), nullable=False)

    stage_attempt: Mapped["ProductionRunStageAttempt"] = relationship(back_populates="materials")
```

- [ ] **Step 3: Agregar la relationship en `ProductionRunStageAttempt`**

En la clase `ProductionRunStageAttempt`, justo antes de la línea
`run: Mapped["ProductionRun"] = relationship(back_populates="stage_attempts")`,
agregar:

```python
    materials: Mapped[list["ProductionRunStageAttemptMaterial"]] = relationship(
        back_populates="stage_attempt",
        cascade="all, delete-orphan",
    )
```

- [ ] **Step 4: Generar y editar la migración**

```bash
docker-compose exec api alembic revision -m "production_run_stage_attempt_materials"
```

Editar el archivo generado en `backend/alembic/versions/` para que
`upgrade()`/`downgrade()` queden:

```python
def upgrade() -> None:
    op.create_table(
        "production_run_stage_attempt_materials",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "stage_attempt_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("production_run_stage_attempts.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("item_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("unit_code", sa.String(length=20), nullable=False),
        sa.Column("quantity_requested", sa.Numeric(14, 4), nullable=False),
        sa.Column("quantity_pending", sa.Numeric(14, 4), nullable=False),
    )
    op.create_index(
        "ix_production_run_stage_attempt_materials_stage_attempt_id",
        "production_run_stage_attempt_materials",
        ["stage_attempt_id"],
    )


def downgrade() -> None:
    op.drop_index(
        "ix_production_run_stage_attempt_materials_stage_attempt_id",
        table_name="production_run_stage_attempt_materials",
    )
    op.drop_table("production_run_stage_attempt_materials")
```

Confirmar que `import sqlalchemy as sa` y
`from sqlalchemy.dialects import postgresql` ya están en el header generado
(el template de Alembic de este repo los trae por defecto — si no están,
agregarlos).

- [ ] **Step 5: Aplicar la migración y verificar**

```bash
docker-compose exec api alembic upgrade head
docker-compose exec api python -m compileall backend/modules/production/models.py
```

Esperado: sin errores, la tabla nueva existe.

- [ ] **Step 6: Commit**

```bash
git add backend/modules/production/models.py backend/alembic/versions/
git commit -m "feat(production): tabla de materiales por intento de etapa + estado PENDIENTE_MATERIAL"
```

---

## Task 2: Repository — cargar `materials` con el intento

**Files:**
- Modify: `backend/modules/production/repository.py`

**Interfaces:**
- Consumes: `ProductionRunStageAttemptMaterial` (Task 1).
- Produces: `get_run`, `get_stage_attempt`, `list_runs` devuelven intentos con
  `.materials` ya cargado (sin N+1 al leer `run.stage_attempts[i].materials`).

- [ ] **Step 1: Import**

En `backend/modules/production/repository.py`, agregar
`ProductionRunStageAttemptMaterial` al import existente de
`backend.modules.production.models` (línea 8-16 actual).

- [ ] **Step 2: Extender `get_run`**

Cambiar:

```python
    def get_run(self, run_id: UUID) -> ProductionRun | None:
        statement = (
            select(ProductionRun)
            .options(
                selectinload(ProductionRun.stages).selectinload(ProductionRunStage.ingredients),
                selectinload(ProductionRun.event_lines),
                selectinload(ProductionRun.stage_attempts),
            )
            .where(ProductionRun.id == run_id)
        )
        return self.session.execute(statement).scalar_one_or_none()
```

a:

```python
    def get_run(self, run_id: UUID) -> ProductionRun | None:
        statement = (
            select(ProductionRun)
            .options(
                selectinload(ProductionRun.stages).selectinload(ProductionRunStage.ingredients),
                selectinload(ProductionRun.event_lines),
                selectinload(ProductionRun.stage_attempts).selectinload(ProductionRunStageAttempt.materials),
            )
            .where(ProductionRun.id == run_id)
        )
        return self.session.execute(statement).scalar_one_or_none()
```

- [ ] **Step 3: Mismo cambio en `list_runs`**

Aplicar el mismo `.selectinload(ProductionRunStageAttempt.materials)` encadenado
a `selectinload(ProductionRun.stage_attempts)` dentro de `list_runs`.

- [ ] **Step 4: Extender `get_stage_attempt`**

Cambiar:

```python
    def get_stage_attempt(self, attempt_id: UUID) -> ProductionRunStageAttempt | None:
        statement = (
            select(ProductionRunStageAttempt)
            .options(selectinload(ProductionRunStageAttempt.run).selectinload(ProductionRun.stage_attempts))
            .where(ProductionRunStageAttempt.id == attempt_id)
        )
        return self.session.execute(statement).scalar_one_or_none()
```

a:

```python
    def get_stage_attempt(self, attempt_id: UUID) -> ProductionRunStageAttempt | None:
        statement = (
            select(ProductionRunStageAttempt)
            .options(
                selectinload(ProductionRunStageAttempt.materials),
                selectinload(ProductionRunStageAttempt.run).selectinload(ProductionRun.stage_attempts),
            )
            .where(ProductionRunStageAttempt.id == attempt_id)
        )
        return self.session.execute(statement).scalar_one_or_none()
```

- [ ] **Step 5: Verificar sintaxis**

```bash
docker-compose exec api python -m compileall backend/modules/production/repository.py
```

- [ ] **Step 6: Commit**

```bash
git add backend/modules/production/repository.py
git commit -m "feat(production): eager-load de materials en las queries de stage attempts"
```

---

## Task 3: Schemas — declarar y leer materiales por intento

**Files:**
- Modify: `backend/modules/production/schemas.py`

**Interfaces:**
- Produces: `StageAttemptMaterialLine`, `StageAttemptCreate.materials`,
  `StageAttemptMaterialRead`, `StageAttemptRead.materials`,
  `StageAttemptRead.status` (ahora puede ser `"PENDIENTE_MATERIAL"`).

- [ ] **Step 1: `StageAttemptCreate` gana `materials`**

Reemplazar (líneas 336-341 actuales):

```python
class StageAttemptCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    process_id: UUID
    responsable_name: str = Field(min_length=1, max_length=180)
```

por:

```python
class StageAttemptMaterialLine(BaseModel):
    model_config = ConfigDict(extra="forbid")

    item_id: UUID
    quantity: Decimal = Field(gt=0)


class StageAttemptCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    process_id: UUID
    responsable_name: str = Field(min_length=1, max_length=180)
    # Opcional: si viene vacio, la etapa arranca directo (igual que hoy). Si
    # trae lineas, se valida contra stock disponible al iniciar (seccion B.3
    # del spec) -- puede terminar en split si no alcanza.
    materials: list[StageAttemptMaterialLine] = Field(default_factory=list)
```

- [ ] **Step 2: `StageAttemptRead` gana `materials`**

Justo antes de `class StageAttemptRead(BaseModel):` (línea 352 actual),
agregar:

```python
class StageAttemptMaterialRead(BaseModel):
    model_config = ConfigDict(from_attributes=True, extra="forbid")

    item_id: UUID
    name: str | None = None
    unit_code: str
    quantity_requested: Decimal
    quantity_pending: Decimal
```

Y dentro de `StageAttemptRead`, después del campo `acta_lines` (última línea
de la clase), agregar:

```python
    materials: list[StageAttemptMaterialRead] = Field(default_factory=list)
```

- [ ] **Step 3: Nuevo payload del endpoint de asignar material pendiente**

No hace falta un schema de request (el endpoint no recibe body, solo
`attempt_id` en la URL) — se documenta en Task 6.

- [ ] **Step 4: Verificar sintaxis**

```bash
docker-compose exec api python -m compileall backend/modules/production/schemas.py
```

- [ ] **Step 5: Commit**

```bash
git add backend/modules/production/schemas.py
git commit -m "feat(production): schemas para declarar y leer materiales por intento de etapa"
```

---

## Task 4: Service — cobertura de stock y arranque de etapa con split

**Files:**
- Modify: `backend/modules/production/service.py`
- Test: `backend/tests/production/test_stage_attempt_material.py` (nuevo)

**Interfaces:**
- Consumes: `ProductionRunStageAttemptMaterial` (Task 1),
  `StageAttemptCreate.materials`/`StageAttemptMaterialLine` (Task 3),
  `self.inventory_service.available_stock(item)` (ya existe,
  `backend/modules/inventory/service.py:321`),
  `self.inventory_service.consume_material_for_production(...)` (ya existe),
  `self._add_or_merge_acta_line(...)` (ya existe, `service.py:1567`),
  `self._stage_attempt_code_for(order_code, process_name, attempt_no)` (ya
  existe, función de módulo en `service.py:147`).
- Produces: `ProductionService._material_coverage_ratio(lines)`,
  `start_stage_attempt` con soporte de materiales (mismo nombre y firma que
  hoy, comportamiento extendido).

Fixtures usadas en los tests (`backend/tests/production/conftest.py`):
`production_service`, `current_user`, `process`, `raw_material` (`item_type=
"RAW_MATERIAL"`, `unit_code="g"`, `current_stock=Decimal("0")` por defecto),
`db_session`.

- [ ] **Step 1: Escribir los tests que fallan**

Crear `backend/tests/production/test_stage_attempt_material.py`:

```python
"""Validacion de stock y split automatico al iniciar un intento de etapa
(docs/superpowers/specs/2026-08-19-automatizar-material-por-etapa-design.md)."""
from decimal import Decimal

from backend.modules.production.schemas import ProductionOrderCreate, StageAttemptCreate, StageAttemptMaterialLine


def _start_order(production_service, current_user):
    return production_service.create_order(ProductionOrderCreate(name="Orden material test"), current_user)


def test_start_stage_attempt_without_materials_starts_directly(production_service, current_user, process):
    order = _start_order(production_service, current_user)

    result = production_service.start_stage_attempt(
        order.id, StageAttemptCreate(process_id=process.id, responsable_name="Ana"), current_user
    )

    assert len(result.stage_attempts) == 1
    assert result.stage_attempts[0].status == "EN_PROCESO"
    assert result.stage_attempts[0].materials == []


def test_start_stage_attempt_with_full_stock_consumes_and_starts(
    db_session, production_service, current_user, process, raw_material
):
    raw_material.current_stock = Decimal("100")
    db_session.flush()
    order = _start_order(production_service, current_user)

    result = production_service.start_stage_attempt(
        order.id,
        StageAttemptCreate(
            process_id=process.id,
            responsable_name="Ana",
            materials=[StageAttemptMaterialLine(item_id=raw_material.id, quantity=Decimal("100"))],
        ),
        current_user,
    )

    assert len(result.stage_attempts) == 1
    attempt = result.stage_attempts[0]
    assert attempt.status == "EN_PROCESO"
    assert attempt.materials[0].quantity_requested == Decimal("100")
    assert attempt.materials[0].quantity_pending == Decimal("0")
    db_session.refresh(raw_material)
    assert raw_material.current_stock == Decimal("0")
    entrega_lines = [line for line in attempt.acta_lines if line.side == "ENTREGA"]
    assert len(entrega_lines) == 1
    assert entrega_lines[0].quantity == Decimal("100")


def test_start_stage_attempt_with_partial_stock_splits_into_two_attempts(
    db_session, production_service, current_user, process, raw_material
):
    raw_material.current_stock = Decimal("60")
    db_session.flush()
    order = _start_order(production_service, current_user)

    result = production_service.start_stage_attempt(
        order.id,
        StageAttemptCreate(
            process_id=process.id,
            responsable_name="Ana",
            materials=[StageAttemptMaterialLine(item_id=raw_material.id, quantity=Decimal("100"))],
        ),
        current_user,
    )

    assert len(result.stage_attempts) == 2
    covered = next(a for a in result.stage_attempts if a.status == "EN_PROCESO")
    waiting = next(a for a in result.stage_attempts if a.status == "PENDIENTE_MATERIAL")
    assert covered.materials[0].quantity_requested == Decimal("60")
    assert covered.materials[0].quantity_pending == Decimal("0")
    assert waiting.materials[0].quantity_requested == Decimal("40")
    assert waiting.materials[0].quantity_pending == Decimal("40")
    assert waiting.attempt_no_for_process == covered.attempt_no_for_process + 1
    db_session.refresh(raw_material)
    assert raw_material.current_stock == Decimal("0")
    # Solo la parte cubierta genero movimiento/acta -- la pendiente no.
    waiting_lines = [line for line in result.acta_lines if line.stage_attempt_id == waiting.id]
    assert waiting_lines == []


def test_start_stage_attempt_with_zero_stock_creates_only_waiting_attempt(
    db_session, production_service, current_user, process, raw_material
):
    order = _start_order(production_service, current_user)

    result = production_service.start_stage_attempt(
        order.id,
        StageAttemptCreate(
            process_id=process.id,
            responsable_name="Ana",
            materials=[StageAttemptMaterialLine(item_id=raw_material.id, quantity=Decimal("100"))],
        ),
        current_user,
    )

    assert len(result.stage_attempts) == 1
    waiting = result.stage_attempts[0]
    assert waiting.status == "PENDIENTE_MATERIAL"
    assert waiting.materials[0].quantity_pending == Decimal("100")
    db_session.refresh(raw_material)
    assert raw_material.current_stock == Decimal("0")


def test_start_stage_attempt_coverage_is_the_minimum_across_lines(
    db_session, production_service, current_user, process, raw_material, target_complement
):
    raw_material.current_stock = Decimal("100")
    target_complement.current_stock = Decimal("3")
    db_session.flush()
    order = _start_order(production_service, current_user)

    result = production_service.start_stage_attempt(
        order.id,
        StageAttemptCreate(
            process_id=process.id,
            responsable_name="Ana",
            materials=[
                StageAttemptMaterialLine(item_id=raw_material.id, quantity=Decimal("100")),
                StageAttemptMaterialLine(item_id=target_complement.id, quantity=Decimal("10")),
            ],
        ),
        current_user,
    )

    # El complemento solo cubre 3/10 = 30%: ese es el ratio que manda para
    # AMBAS lineas, no solo la propia.
    covered = next(a for a in result.stage_attempts if a.status == "EN_PROCESO")
    lines_by_item = {m.item_id: m for m in covered.materials}
    assert lines_by_item[raw_material.id].quantity_requested == Decimal("30")
    assert lines_by_item[target_complement.id].quantity_requested == Decimal("3")
```

- [ ] **Step 2: Correr los tests y verificar que fallan**

```bash
docker-compose exec api pytest backend/tests/production/test_stage_attempt_material.py -v
```

Esperado: fallan (`materials` no existe en `StageAttemptCreate` todavía en
runtime real, o el status nunca es `PENDIENTE_MATERIAL`, o AttributeError) —
confirma que Task 3 por sí sola no implementa el comportamiento.

- [ ] **Step 3: Imports nuevos en `service.py`**

Agregar `ROUND_DOWN` al import de `decimal` (línea 2 actual: `from decimal
import Decimal` pasa a `from decimal import ROUND_DOWN, Decimal`), y agregar
`ProductionRunStageAttemptMaterial` al import de
`backend.modules.production.models` (bloque de líneas 14-30 actual).

- [ ] **Step 4: Helper `_material_coverage_ratio`**

Agregar como método de `ProductionService`, cerca de `_validate_run_products`
(cualquier lugar dentro de la clase sirve; sugerido justo antes de
`create_run`):

```python
    def _material_coverage_ratio(self, lines: list[tuple["InventoryItem", Decimal]]) -> Decimal:
        """Minimo entre disponible/pedido de cada linea -- el recurso mas
        corto manda para TODAS las lineas por igual (si el complemento solo
        cubre 30%, la materia prima tambien arranca al 30%, no al 100%)."""
        if not lines:
            return Decimal("1")
        ratio = Decimal("1")
        for item, quantity in lines:
            available = self.inventory_service.available_stock(item)
            line_ratio = min(Decimal("1"), available / quantity) if quantity > 0 else Decimal("1")
            ratio = min(ratio, max(Decimal("0"), line_ratio))
        return ratio
```

- [ ] **Step 5: Extender `start_stage_attempt`**

El método actual (ver `service.py:2422-2463`) termina con:

```python
        attempt = ProductionRunStageAttempt(
            run_id=run.id,
            process_id=process.id,
            process_name=process.name,
            sequence_order=sequence_order,
            attempt_no_for_process=attempt_no,
            code=code,
            responsable_name=payload.responsable_name.strip(),
            status=StageAttemptStatus.IN_PROGRESS,
            started_by_user_id=current_user.id,
            started_at=datetime.utcnow(),
        )
        run.stage_attempts.append(attempt)
        self.repository.flush()
        return self._read_with_names(run)
```

Reemplazar ese bloque final por:

```python
        if not payload.materials:
            attempt = ProductionRunStageAttempt(
                run_id=run.id,
                process_id=process.id,
                process_name=process.name,
                sequence_order=sequence_order,
                attempt_no_for_process=attempt_no,
                code=code,
                responsable_name=payload.responsable_name.strip(),
                status=StageAttemptStatus.IN_PROGRESS,
                started_by_user_id=current_user.id,
                started_at=datetime.utcnow(),
            )
            run.stage_attempts.append(attempt)
            self.repository.flush()
            return self._read_with_names(run)

        from backend.modules.inventory.models import InventoryItem

        resolved: list[tuple[InventoryItem, Decimal]] = []
        for line in payload.materials:
            item = self.repository.session.get(InventoryItem, line.item_id)
            if item is None:
                raise ProductionNotFoundError("Un material declarado para la etapa no existe en inventario.")
            resolved.append((item, line.quantity))

        ratio = self._material_coverage_ratio(resolved)
        responsable = payload.responsable_name.strip()

        def _new_attempt(status: str, attempt_no_for_process: int, order_index: int) -> ProductionRunStageAttempt:
            attempt_code = _stage_attempt_code_for(order_code, process.name, attempt_no_for_process) if order_code else None
            new_attempt = ProductionRunStageAttempt(
                run_id=run.id,
                process_id=process.id,
                process_name=process.name,
                sequence_order=sequence_order + order_index,
                attempt_no_for_process=attempt_no_for_process,
                code=attempt_code,
                responsable_name=responsable,
                status=status,
                started_by_user_id=current_user.id,
                started_at=datetime.utcnow(),
            )
            run.stage_attempts.append(new_attempt)
            return new_attempt

        def _consume_line(attempt: ProductionRunStageAttempt, item: InventoryItem, quantity: Decimal) -> None:
            self.inventory_service.consume_material_for_production(
                item_id=item.id,
                quantity=quantity,
                production_run_id=run.id,
                user_id=current_user.id,
                production_code=order_code,
                reason=f"Consumo en etapa {process.name} ({attempt.code or attempt.id}).",
            )
            self._add_or_merge_acta_line(
                run,
                side=ActaLineSide.ENTREGA,
                label=item.name,
                quantity=quantity,
                unit_code=item.unit_code,
                source=ActaLineSource.PLAN,
                item_id=item.id,
                stage_attempt_id=attempt.id,
                created_by_user_id=current_user.id,
            )

        if ratio >= 1:
            covered_attempt = _new_attempt(StageAttemptStatus.IN_PROGRESS, attempt_no, 0)
            for item, quantity in resolved:
                _consume_line(covered_attempt, item, quantity)
                covered_attempt.materials.append(
                    ProductionRunStageAttemptMaterial(
                        item_id=item.id, unit_code=item.unit_code, quantity_requested=quantity, quantity_pending=Decimal("0")
                    )
                )
        elif ratio <= 0:
            waiting_attempt = _new_attempt(StageAttemptStatus.WAITING_MATERIAL, attempt_no, 0)
            for item, quantity in resolved:
                waiting_attempt.materials.append(
                    ProductionRunStageAttemptMaterial(
                        item_id=item.id, unit_code=item.unit_code, quantity_requested=quantity, quantity_pending=quantity
                    )
                )
        else:
            covered_attempt = _new_attempt(StageAttemptStatus.IN_PROGRESS, attempt_no, 0)
            waiting_attempt = _new_attempt(StageAttemptStatus.WAITING_MATERIAL, attempt_no + 1, 1)
            for item, quantity in resolved:
                covered_qty = (quantity * ratio).quantize(Decimal("0.0001"), rounding=ROUND_DOWN)
                remainder = quantity - covered_qty
                if covered_qty > 0:
                    _consume_line(covered_attempt, item, covered_qty)
                covered_attempt.materials.append(
                    ProductionRunStageAttemptMaterial(
                        item_id=item.id, unit_code=item.unit_code, quantity_requested=covered_qty, quantity_pending=Decimal("0")
                    )
                )
                waiting_attempt.materials.append(
                    ProductionRunStageAttemptMaterial(
                        item_id=item.id, unit_code=item.unit_code, quantity_requested=remainder, quantity_pending=remainder
                    )
                )

        self.repository.flush()
        return self._read_with_names(run)
```

Nota: `order_code` y `sequence_order`/`attempt_no`/`code` ya están calculados
más arriba en el método (líneas 2442-2447 actuales) — no se tocan, esta
sustitución es solo del bloque final citado arriba. `_stage_attempt_code_for`
ya está importado a nivel de módulo (función libre, no del self).

- [ ] **Step 6: Correr los tests de nuevo**

```bash
docker-compose exec api pytest backend/tests/production/test_stage_attempt_material.py -v
```

Esperado: los 5 tests pasan.

- [ ] **Step 7: Correr la suite completa de producción**

```bash
docker-compose exec api pytest backend/tests/production -v
```

Esperado: `test_dynamic_flow.py` sigue pasando (materials vacío por defecto,
comportamiento intacto). Si algo del flujo viejo falla, no tocarlo aquí —
se resuelve en Task 8/9.

- [ ] **Step 8: Commit**

```bash
git add backend/modules/production/service.py backend/tests/production/test_stage_attempt_material.py
git commit -m "feat(production): valida stock y hace split automatico al iniciar una etapa"
```

---

## Task 5: Service — asignar material a un intento pendiente

**Files:**
- Modify: `backend/modules/production/service.py`
- Test: `backend/tests/production/test_stage_attempt_material.py`

**Interfaces:**
- Consumes: `self.repository.get_stage_attempt` (Task 2),
  `self.repository.get_active_stage_attempt` (ya existe, `repository.py:59`),
  `self._material_coverage_ratio` (Task 4).
- Produces: `ProductionService.allocate_stage_attempt_material(attempt_id,
  current_user) -> ProductionRunRead`.

- [ ] **Step 1: Tests que fallan**

Agregar a `test_stage_attempt_material.py`:

```python
import uuid

import pytest

from backend.modules.production.service import ProductionDomainError, ProductionNotFoundError


def test_allocate_stage_attempt_material_full_stock_starts_it(
    db_session, production_service, current_user, process, raw_material
):
    order = _start_order(production_service, current_user)
    result = production_service.start_stage_attempt(
        order.id,
        StageAttemptCreate(
            process_id=process.id,
            responsable_name="Ana",
            materials=[StageAttemptMaterialLine(item_id=raw_material.id, quantity=Decimal("100"))],
        ),
        current_user,
    )
    waiting = next(a for a in result.stage_attempts if a.status == "PENDIENTE_MATERIAL")

    raw_material.current_stock = Decimal("100")
    db_session.flush()

    updated = production_service.allocate_stage_attempt_material(waiting.id, current_user)

    reloaded = next(a for a in updated.stage_attempts if a.id == waiting.id)
    assert reloaded.status == "EN_PROCESO"
    assert reloaded.materials[0].quantity_pending == Decimal("0")
    db_session.refresh(raw_material)
    assert raw_material.current_stock == Decimal("0")


def test_allocate_stage_attempt_material_partial_stock_keeps_waiting(
    db_session, production_service, current_user, process, raw_material
):
    order = _start_order(production_service, current_user)
    result = production_service.start_stage_attempt(
        order.id,
        StageAttemptCreate(
            process_id=process.id,
            responsable_name="Ana",
            materials=[StageAttemptMaterialLine(item_id=raw_material.id, quantity=Decimal("100"))],
        ),
        current_user,
    )
    waiting = next(a for a in result.stage_attempts if a.status == "PENDIENTE_MATERIAL")

    raw_material.current_stock = Decimal("30")
    db_session.flush()

    updated = production_service.allocate_stage_attempt_material(waiting.id, current_user)

    reloaded = next(a for a in updated.stage_attempts if a.id == waiting.id)
    assert reloaded.status == "PENDIENTE_MATERIAL"
    assert reloaded.materials[0].quantity_pending == Decimal("70")
    db_session.refresh(raw_material)
    assert raw_material.current_stock == Decimal("0")


def test_allocate_stage_attempt_material_no_stock_is_a_noop(
    production_service, current_user, process, raw_material
):
    order = _start_order(production_service, current_user)
    result = production_service.start_stage_attempt(
        order.id,
        StageAttemptCreate(
            process_id=process.id,
            responsable_name="Ana",
            materials=[StageAttemptMaterialLine(item_id=raw_material.id, quantity=Decimal("100"))],
        ),
        current_user,
    )
    waiting = next(a for a in result.stage_attempts if a.status == "PENDIENTE_MATERIAL")

    updated = production_service.allocate_stage_attempt_material(waiting.id, current_user)

    reloaded = next(a for a in updated.stage_attempts if a.id == waiting.id)
    assert reloaded.status == "PENDIENTE_MATERIAL"
    assert reloaded.materials[0].quantity_pending == Decimal("100")


def test_allocate_stage_attempt_material_full_stock_but_another_attempt_active_stays_waiting(
    db_session, production_service, current_user, process, raw_material
):
    # Stock parcial (60/100) al iniciar: la cubierta arranca EN_PROCESO YA y
    # sigue asi (nunca se finaliza en este test) -- la que queda esperando es
    # el remanente de 40.
    raw_material.current_stock = Decimal("60")
    db_session.flush()
    order = _start_order(production_service, current_user)
    result = production_service.start_stage_attempt(
        order.id,
        StageAttemptCreate(
            process_id=process.id,
            responsable_name="Ana",
            materials=[StageAttemptMaterialLine(item_id=raw_material.id, quantity=Decimal("100"))],
        ),
        current_user,
    )
    waiting = next(a for a in result.stage_attempts if a.status == "PENDIENTE_MATERIAL")
    covered = next(a for a in result.stage_attempts if a.status == "EN_PROCESO")
    assert waiting.materials[0].quantity_pending == Decimal("40")

    # Llega stock nuevo que alcanza para cubrir el remanente completo.
    raw_material.current_stock = Decimal("40")
    db_session.flush()

    updated = production_service.allocate_stage_attempt_material(waiting.id, current_user)
    reloaded_covered = next(a for a in updated.stage_attempts if a.id == covered.id)
    reloaded_waiting = next(a for a in updated.stage_attempts if a.id == waiting.id)
    # La cubierta sigue EN_PROCESO (no se toco) -- por eso la que esperaba NO
    # puede pasar a EN_PROCESO todavia, aunque ya tenga el 100% del material.
    assert reloaded_covered.status == "EN_PROCESO"
    assert reloaded_waiting.status == "PENDIENTE_MATERIAL"
    assert reloaded_waiting.materials[0].quantity_pending == Decimal("0")
    db_session.refresh(raw_material)
    assert raw_material.current_stock == Decimal("0")


def test_allocate_stage_attempt_material_wrong_status_raises(production_service, current_user, process):
    order = _start_order(production_service, current_user)
    result = production_service.start_stage_attempt(
        order.id, StageAttemptCreate(process_id=process.id, responsable_name="Ana"), current_user
    )
    running = result.stage_attempts[0]

    with pytest.raises(ProductionDomainError, match="PENDIENTE_MATERIAL"):
        production_service.allocate_stage_attempt_material(running.id, current_user)


def test_allocate_stage_attempt_material_unknown_id_raises_not_found(production_service, current_user):
    with pytest.raises(ProductionNotFoundError):
        production_service.allocate_stage_attempt_material(uuid.uuid4(), current_user)
```

Nota sobre `test_allocate_stage_attempt_material_full_stock_but_another_attempt_active_stays_waiting`:
como no hay stock al iniciar (`raw_material.current_stock` default `0`), el
split del Task 4 crea la cubierta con `covered_qty = 0` (no genera acta
line ni consumo, solo la fila `ProductionRunStageAttemptMaterial` con
`quantity_requested=0`) y la cubierta queda igual `IN_PROGRESS` (bloqueando
la secuencial) — exactamente el escenario real que se quiere cubrir: hay un
intento activo, y el que estaba esperando ya junta el 100% pero no puede
arrancar todavía.

- [ ] **Step 2: Correr y verificar que fallan**

```bash
docker-compose exec api pytest backend/tests/production/test_stage_attempt_material.py -k allocate -v
```

Esperado: `AttributeError: 'ProductionService' object has no attribute
'allocate_stage_attempt_material'`.

- [ ] **Step 3: Implementar `allocate_stage_attempt_material`**

Agregar en `service.py`, inmediatamente después de `finish_stage_attempt`
(ver `service.py:2465-2502`):

```python
    def allocate_stage_attempt_material(self, attempt_id: UUID, current_user: CurrentUser) -> ProductionRunRead:
        attempt = self.repository.get_stage_attempt(attempt_id)
        if attempt is None:
            raise ProductionNotFoundError("Intento de etapa no encontrado.")
        if attempt.status != StageAttemptStatus.WAITING_MATERIAL:
            raise ProductionDomainError("Solo se puede asignar material a un intento en PENDIENTE_MATERIAL.")
        run = attempt.run

        from backend.modules.inventory.models import InventoryItem

        pending_lines = [line for line in attempt.materials if line.quantity_pending > 0]
        resolved = [
            (self.repository.session.get(InventoryItem, line.item_id), line)
            for line in pending_lines
        ]
        for item, line in resolved:
            if item is None:
                raise ProductionDomainError("Un material pendiente de este intento ya no existe en inventario.")

        ratio = self._material_coverage_ratio([(item, line.quantity_pending) for item, line in resolved])
        if ratio > 0:
            for item, line in resolved:
                covered_qty = (line.quantity_pending * ratio).quantize(Decimal("0.0001"), rounding=ROUND_DOWN)
                if covered_qty <= 0:
                    continue
                self.inventory_service.consume_material_for_production(
                    item_id=item.id,
                    quantity=covered_qty,
                    production_run_id=run.id,
                    user_id=current_user.id,
                    production_code=run.production_code or run.root_production_code,
                    reason=f"Material asignado a etapa {attempt.process_name} ({attempt.code or attempt.id}).",
                )
                self._add_or_merge_acta_line(
                    run,
                    side=ActaLineSide.ENTREGA,
                    label=item.name,
                    quantity=covered_qty,
                    unit_code=item.unit_code,
                    source=ActaLineSource.AUTO,
                    item_id=item.id,
                    stage_attempt_id=attempt.id,
                    created_by_user_id=current_user.id,
                )
                line.quantity_pending -= covered_qty

        if all(line.quantity_pending <= 0 for line in attempt.materials):
            if self.repository.get_active_stage_attempt(run.id) is None:
                attempt.status = StageAttemptStatus.IN_PROGRESS
                attempt.started_at = datetime.utcnow()

        self.repository.flush()
        return self._read_with_names(run)
```

- [ ] **Step 4: Router**

En `backend/modules/production/router.py`, agregar después del endpoint
`finish_stage_attempt` (ver `router.py:185-200`):

```python
@router.post("/runs/stage-attempts/{attempt_id}/allocate-material", response_model=ProductionRunRead)
def allocate_stage_attempt_material(
    attempt_id: UUID,
    current_user: CurrentUser = Depends(get_current_user),
    service: ProductionService = Depends(get_production_service),
) -> ProductionRunRead:
    """Asigna stock recien disponible a un intento PENDIENTE_MATERIAL --
    consume lo que alcance y, si queda 100% cubierto y no hay otro intento
    EN_PROCESO en la orden, lo arranca."""
    ensure_permission(current_user, "production.runs.update")
    try:
        return service.allocate_stage_attempt_material(attempt_id, current_user)
    except ProductionNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except ProductionDomainError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc
```

- [ ] **Step 5: Correr los tests**

```bash
docker-compose exec api pytest backend/tests/production/test_stage_attempt_material.py -v
```

Esperado: todos pasan.

- [ ] **Step 6: Commit**

```bash
git add backend/modules/production/service.py backend/modules/production/router.py backend/tests/production/test_stage_attempt_material.py
git commit -m "feat(production): endpoint para asignar material a un intento PENDIENTE_MATERIAL"
```

---

## Task 6: Service — mostrar `materials` en las lecturas

**Files:**
- Modify: `backend/modules/production/service.py`

**Interfaces:**
- Consumes: `StageAttemptMaterialRead` (Task 3).
- Produces: `read.stage_attempts[i].materials` poblado en
  `_attach_stage_attempts` (usado por `_read_with_names`/`list_runs`).

- [ ] **Step 1: Test (extiende el de Task 4)**

Ya cubierto: `test_start_stage_attempt_with_full_stock_consumes_and_starts`
y los demás de Task 4/5 ya assertan sobre `attempt.materials[...]` — si
`_attach_stage_attempts` no los llena, esos tests fallan con
`IndexError`/lista vacía. No hace falta un test nuevo dedicado; si Task 4/5
ya están en verde con este step aplicado, esto queda cubierto.

- [ ] **Step 2: Import**

Agregar `StageAttemptMaterialRead` al import de
`backend.modules.production.schemas` al inicio de `service.py` (buscar el
bloque `from backend.modules.production.schemas import (...)`).

- [ ] **Step 3: Poblar nombres de item y armar `materials`**

En `_attach_stage_attempts` (`service.py:1473-1517`), antes del bucle
`for read, run in zip(reads, runs):`, agregar la resolución de nombres:

```python
        from sqlalchemy import select
        from backend.modules.inventory.models import InventoryItem

        material_item_ids = list({
            m.item_id for run in runs for attempt in run.stage_attempts for m in attempt.materials
        })
        material_item_names: dict = {}
        if material_item_ids:
            rows = self.repository.session.execute(
                select(InventoryItem.id, InventoryItem.name).where(InventoryItem.id.in_(material_item_ids))
            ).all()
            material_item_names = {row[0]: row[1] for row in rows}
```

Y dentro del `StageAttemptRead(...)` que arma cada intento, agregar el campo
`materials` (después de `acta_lines=[...]`, con la coma correspondiente):

```python
                    materials=[
                        StageAttemptMaterialRead(
                            item_id=m.item_id,
                            name=material_item_names.get(m.item_id),
                            unit_code=m.unit_code,
                            quantity_requested=m.quantity_requested,
                            quantity_pending=m.quantity_pending,
                        )
                        for m in attempt.materials
                    ],
```

- [ ] **Step 4: Correr toda la suite de producción**

```bash
docker-compose exec api pytest backend/tests/production -v
```

Esperado: todos los tests de `test_stage_attempt_material.py` en verde.

- [ ] **Step 5: Commit**

```bash
git add backend/modules/production/service.py
git commit -m "feat(production): expone materials en la lectura de cada intento de etapa"
```

---

## Task 7: Fix — `cancel_run` revierte consumo del flujo nuevo

**Files:**
- Modify: `backend/modules/production/service.py`
- Test: `backend/tests/production/test_cancel_run.py`

**Interfaces:**
- Consumes: `self.inventory_service.reverse_production_consumption` (ya
  existe, `backend/modules/inventory/service.py:470` — suma movimientos
  `CONSUMO_PRODUCCION` con `reference_id=run_id`; si no hay ninguno no hace
  nada, seguro de llamar siempre).

Sin este fix, cancelar una orden del flujo nuevo que ya consumió material vía
`start_stage_attempt`/`allocate_stage_attempt_material` (Task 4/5) no
revertiría ese stock — bug introducido por este cambio si no se corrige.

- [ ] **Step 1: Test que falla**

Agregar a `backend/tests/production/test_cancel_run.py`:

```python
from backend.modules.production.schemas import ProductionOrderCreate, StageAttemptCreate, StageAttemptMaterialLine


def test_cancel_run_restores_stock_consumed_by_a_new_flow_stage_attempt(
    db_session, production_service, current_user, process, raw_material
):
    raw_material.current_stock = Decimal("100")
    db_session.flush()

    order = production_service.create_order(ProductionOrderCreate(name="Orden a cancelar"), current_user)
    production_service.start_stage_attempt(
        order.id,
        StageAttemptCreate(
            process_id=process.id,
            responsable_name="Ana",
            materials=[StageAttemptMaterialLine(item_id=raw_material.id, quantity=Decimal("100"))],
        ),
        current_user,
    )
    db_session.refresh(raw_material)
    assert raw_material.current_stock == Decimal("0")

    result = production_service.cancel_run(order.id, current_user, "Cancelada por error")

    assert result.status == "CANCELADA"
    db_session.refresh(raw_material)
    assert raw_material.current_stock == Decimal("100")
```

(`Decimal` ya está importado en el archivo si sigue el patrón de los tests
existentes de `test_cancel_run.py` — si no, agregar `from decimal import
Decimal` al inicio.)

- [ ] **Step 2: Correr y verificar que falla**

```bash
docker-compose exec api pytest backend/tests/production/test_cancel_run.py -k new_flow_stage_attempt -v
```

Esperado: falla, `raw_material.current_stock == Decimal("0")` (no se
revirtió).

- [ ] **Step 3: Quitar el gate en `_cancel_run_core`**

En `service.py` (`_cancel_run_core`, ver `service.py:1119-1150`), cambiar:

```python
        if run.materials_approved_at is not None:
            if self.inventory_service is None:
                raise ProductionDomainError("Inventario no esta disponible para revertir el consumo de esta orden.")
            self.inventory_service.reverse_production_consumption(
                run.id,
                current_user.id,
                reason=(
                    f"Reversion por cancelacion de orden {run.production_code or run.id}."
                    + (f" {reason}" if reason else "")
                ),
            )
```

a:

```python
        # reverse_production_consumption suma los movimientos
        # CONSUMO_PRODUCCION con reference_id=run.id -- si no hay ninguno no
        # hace nada, es seguro llamarlo siempre (antes solo se llamaba si
        # materials_approved_at, un campo exclusivo del flujo viejo; el
        # flujo nuevo tambien puede haber consumido via start_stage_attempt/
        # allocate_stage_attempt_material y con el gate viejo esa reversion
        # no pasaba).
        if self.inventory_service is None:
            raise ProductionDomainError("Inventario no esta disponible para revertir el consumo de esta orden.")
        self.inventory_service.reverse_production_consumption(
            run.id,
            current_user.id,
            reason=(
                f"Reversion por cancelacion de orden {run.production_code or run.id}."
                + (f" {reason}" if reason else "")
            ),
        )
```

- [ ] **Step 4: Correr los tests**

```bash
docker-compose exec api pytest backend/tests/production/test_cancel_run.py -v
```

Esperado: todos pasan, incluido el nuevo.

- [ ] **Step 5: Commit**

```bash
git add backend/modules/production/service.py backend/tests/production/test_cancel_run.py
git commit -m "fix(production): cancel_run revierte tambien el consumo del flujo nuevo"
```

---

## Task 8: Eliminar el flujo viejo — backend

**Files:**
- Modify: `backend/modules/production/service.py`
- Modify: `backend/modules/production/router.py`
- Modify: `backend/modules/production/schemas.py`
- Modify/Delete: varios en `backend/tests/production/`

**Interfaces:** ninguna nueva — solo eliminación. `cancel_run`/
`cancel_run_family` y `request_additional_material`/
`approve_additional_material`/`reject_additional_material` **no se tocan**.

- [ ] **Step 1: Confirmar en vivo que no hay ninguna orden del flujo viejo pendiente**

```bash
docker-compose exec api python -c "
from backend.modules.database.session import SessionLocal
from backend.modules.production.models import ProductionRun, ProductionRunStatus
from sqlalchemy import select
with SessionLocal() as s:
    pending = s.execute(select(ProductionRun.production_code, ProductionRun.status).where(
        ProductionRun.status.in_([
            ProductionRunStatus.PENDING_INVENTORY,
            ProductionRunStatus.MATERIALS_APPROVED,
            ProductionRunStatus.WAITING_MATERIAL,
            ProductionRunStatus.PENDING_RECEPTION,
        ])
    )).all()
    print(pending)
"
```

Esperado: `[]`. Si NO está vacío, parar aquí y avisar — hay que resolver esas
órdenes (aprobar/rechazar/recibir vía la API todavía viva en este punto)
antes de seguir con este task.

- [ ] **Step 2: Borrar los métodos del service**

En `backend/modules/production/service.py`, borrar por completo los
siguientes métodos (buscar cada `def` y borrar hasta el siguiente `def` al
mismo nivel de indentación): `create_run`, `approve_materials`,
`reject_materials`, `preview_approve_materials`, `allocate_material`,
`preview_allocation` (si existe con ese nombre exacto — confirmar junto a
`allocation-preview` en el router, es la función que arma
`AllocationPreviewRead`), `reserve_material`, `release_material_reservation`,
`start_with_reserved_material`, `start_run`, `finish_stage` (la que opera
sobre `stage_id`/`ProductionRunStage`, **no** `finish_stage_attempt`),
`edit_stage_weight`, `receive_finished_product`.

También borrar las funciones/clases de módulo que solo usan esos métodos:
`_compute_coverage`, `_split_run_for_partial_material`,
`_reservation_is_complete`, `_MaterialCoverage`, `_ResourceShortage`,
`_reservation_is_complete` (dataclasses `field`/`dataclass` en el import de
`dataclasses` puede quedar sin uso — revisar con `python -m pyflakes` en el
Step 5 y limpiar el import si aplica).

**Antes de borrar cada uno, correr un grep para confirmar que nada del flujo
nuevo lo usa:**

```bash
grep -n "_compute_coverage\|_split_run_for_partial_material\|_reservation_is_complete\|_MaterialCoverage\|_ResourceShortage" backend/modules/production/service.py backend/modules/production/schemas.py
```

Si `_reservation_is_complete` sigue apareciendo en `_read_with_names`/
`list_runs` (línea `read.reservation_is_complete = _reservation_is_complete(run)`,
ver `service.py:1902` y `1916`), borrar también esas dos líneas y el campo
`reservation_is_complete` de `ProductionRunRead` (Step 4).

- [ ] **Step 3: Borrar los endpoints del router**

En `backend/modules/production/router.py`, borrar los endpoints (función +
decorador `@router...`) para: `POST /runs` (`create_run`),
`POST /runs/{run_id}/approve-materials`, `POST /runs/{run_id}/reject-materials`,
`POST /runs/{run_id}/allocate-material`, `POST /runs/{run_id}/allocation-preview`,
`GET /runs/{run_id}/approve-materials-preview`, `POST /runs/{run_id}/reserve-material`,
`POST /runs/{run_id}/release-reservation`, `POST /runs/{run_id}/start-reserved`,
`POST /runs/{run_id}/start`, `POST /runs/stages/{stage_id}/finish`,
`POST /runs/stages/{stage_id}/edit-weight`, `POST /runs/{run_id}/receive-finished`.

`GET /runs` (`list_runs`), `PUT /runs/{run_id}/products`,
`POST /runs/{run_id}/cancel`, `POST /runs/{run_id}/cancel-family` **quedan**
(son de lectura/cancelación genérica, no del flujo viejo).

- [ ] **Step 4: Limpiar schemas huérfanos**

En `backend/modules/production/schemas.py`, borrar (si `grep` confirma que
ya nadie los usa tras el Step 2/3): `ProductionRunCreate`,
`AllocateMaterialPayload`, `AllocationPreviewRead`, `MaterialShortageRead`,
`ProductionRunStageFinish`, `StageWeightEdit`, `ReceiveFinishedProductPayload`.
`MaterialRejectPayload` **queda** (la sigue usando
`reject_additional_material`). Quitar `reservation_is_complete` de
`ProductionRunRead` solo si el Step 2 confirmó que ya nada lo llena.

```bash
grep -rn "ProductionRunCreate\|AllocateMaterialPayload\|AllocationPreviewRead\|MaterialShortageRead\|ProductionRunStageFinish\|StageWeightEdit\|ReceiveFinishedProductPayload" backend/modules/production/
```

Cada uno debe aparecer solo en su propia definición tras el borrado — si
aparece en otro lado, no borrarlo todavía y anotar dónde para revisar.

- [ ] **Step 5: Verificar sintaxis e imports sueltos**

```bash
docker-compose exec api python -m compileall backend/modules/production
docker-compose exec api python -c "import ast, sys
tree = ast.parse(open('backend/modules/production/service.py').read())
print('OK')"
```

Revisar a mano el bloque de imports al inicio de `service.py` y
`schemas.py`: si `field`/`dataclass` (de `dataclasses`) ya no se usan en
ningún otro lado del archivo, quitarlos del import.

- [ ] **Step 6: Borrar y reescribir tests del flujo viejo**

Borrar enteros (testean solo flujo viejo, sin nada rescatable):
`backend/tests/production/test_reject_materials.py`,
`test_allocate_material.py`, `test_material_reservation.py`,
`test_approve_materials_preview.py`, `test_material_split.py`,
`test_coverage_fraction.py`.

```bash
git rm backend/tests/production/test_reject_materials.py \
  backend/tests/production/test_allocate_material.py \
  backend/tests/production/test_material_reservation.py \
  backend/tests/production/test_approve_materials_preview.py \
  backend/tests/production/test_material_split.py \
  backend/tests/production/test_coverage_fraction.py
```

Para los siete restantes (`test_error_message_formatting.py`,
`test_acta_auto.py`, `test_edit_stage_weight.py`,
`test_run_creation_cantidades_directas.py`, `test_receive_merma.py`,
`test_actual_finished_weight.py`, `test_acta_seed.py`, `test_acta_edit.py`,
`test_admin_acta_line.py`, `test_historical_import.py`): correr cada uno
individualmente, ver qué falla, y decidir caso por caso:

```bash
docker-compose exec api pytest backend/tests/production/test_error_message_formatting.py -v
docker-compose exec api pytest backend/tests/production/test_acta_auto.py -v
docker-compose exec api pytest backend/tests/production/test_edit_stage_weight.py -v
docker-compose exec api pytest backend/tests/production/test_run_creation_cantidades_directas.py -v
docker-compose exec api pytest backend/tests/production/test_receive_merma.py -v
docker-compose exec api pytest backend/tests/production/test_actual_finished_weight.py -v
docker-compose exec api pytest backend/tests/production/test_acta_seed.py -v
docker-compose exec api pytest backend/tests/production/test_acta_edit.py -v
docker-compose exec api pytest backend/tests/production/test_admin_acta_line.py -v
docker-compose exec api pytest backend/tests/production/test_historical_import.py -v
```

Regla de decisión por archivo: si el test usa `create_run`/`approve_materials`
**solo como fixture** para llegar a un estado con acta/etapas (no verifica
comportamiento del flujo viejo en sí), reemplazar ese fixture por
`create_order` + `start_stage_attempt` (con o sin `materials`, según haga
falta un intento con acta) y dejar el resto del test igual. Si el test
verifica comportamiento que ya no existe (ej. `receive_finished_product`
rechazando corridas históricas), borrar solo esa función de test, no el
archivo entero, salvo que quede vacío.

- [ ] **Step 7: Suite completa en verde**

```bash
docker-compose exec api pytest backend/tests/production -v
```

Esperado: 0 fallos. Si algo del resto del backend importaba algo borrado
(ej. otro módulo referenciando `ProductionRunCreate`), correr también:

```bash
docker-compose exec api pytest backend
```

- [ ] **Step 8: Commit**

```bash
git add -A backend/modules/production backend/tests/production
git commit -m "refactor(production): elimina la aprobacion de materiales del flujo viejo"
```

---

## Task 9: Frontend — API client y tipos

**Files:**
- Modify: `frontend/lib/production-api.ts`
- Modify: `frontend/types/production/index.ts`

**Interfaces:**
- Produces: `startStageAttempt(runId, { process_id, responsable_name,
  materials? })`, `allocateStageAttemptMaterial(attemptId)`.

- [ ] **Step 1: `types/production/index.ts` — `StageAttempt` y estado nuevo**

Cambiar (líneas 15-35 actuales):

```typescript
export type StageAttempt = {
  id: string;
  run_id: string;
  process_id?: string | null;
  process_name: string;
  sequence_order: number;
  attempt_no_for_process: number;
  code?: string | null;
  responsable_name?: string | null;
  status: "EN_PROCESO" | "APROBADA" | "RECHAZADA";
  rejection_reason?: string | null;
  peso_al_finalizar?: string | null;
  unit_code?: string | null;
  merma_weight?: string | null;
  merma_percent?: string | null;
  started_by_name?: string | null;
  started_at: string;
  finished_by_name?: string | null;
  finished_at?: string | null;
  acta_lines?: ProductionRun["acta_lines"];
};
```

a:

```typescript
export type StageAttemptMaterial = {
  item_id: string;
  name?: string | null;
  unit_code: string;
  quantity_requested: string;
  quantity_pending: string;
};

export type StageAttempt = {
  id: string;
  run_id: string;
  process_id?: string | null;
  process_name: string;
  sequence_order: number;
  attempt_no_for_process: number;
  code?: string | null;
  responsable_name?: string | null;
  status: "EN_PROCESO" | "APROBADA" | "RECHAZADA" | "PENDIENTE_MATERIAL";
  rejection_reason?: string | null;
  peso_al_finalizar?: string | null;
  unit_code?: string | null;
  merma_weight?: string | null;
  merma_percent?: string | null;
  started_by_name?: string | null;
  started_at: string;
  finished_by_name?: string | null;
  finished_at?: string | null;
  acta_lines?: ProductionRun["acta_lines"];
  materials: StageAttemptMaterial[];
};
```

- [ ] **Step 2: `production-api.ts` — `startStageAttempt` gana `materials`**

Cambiar:

```typescript
export function startStageAttempt(runId: string, payload: { process_id: string; responsable_name: string }) {
  return apiRequest<ProductionRun>(`/api/production/runs/${runId}/stage-attempts`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}
```

a:

```typescript
export function startStageAttempt(
  runId: string,
  payload: {
    process_id: string;
    responsable_name: string;
    materials?: Array<{ item_id: string; quantity: string }>;
  },
) {
  return apiRequest<ProductionRun>(`/api/production/runs/${runId}/stage-attempts`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

/** Asigna stock recien disponible a un intento PENDIENTE_MATERIAL: consume lo
 * que alcance y, si queda 100% cubierto y no hay otro intento activo, lo
 * arranca. */
export function allocateStageAttemptMaterial(attemptId: string) {
  return apiRequest<ProductionRun>(`/api/production/runs/stage-attempts/${attemptId}/allocate-material`, {
    method: "POST",
  });
}
```

- [ ] **Step 3: Borrar las funciones del flujo viejo**

Borrar de `production-api.ts`: `createProductionRun`,
`approveProductionRunMaterials`, `allocateProductionRunMaterial`,
`previewProductionRunAllocation`, `previewProductionRunApproveMaterials`,
`reserveProductionRunMaterial`, `releaseProductionRunReservation`,
`startProductionRunWithReserved`, `startProductionRun`,
`finishProductionRunStage`, `editProductionRunStageWeight`,
`receiveProductionRunFinishedProduct`. `rejectProductionRunMaterials`
**queda** solo si algo más la usa tras el Task 10/11 — si no, bórrala también
aquí (`grep -rn "rejectProductionRunMaterials" frontend/components` primero).

- [ ] **Step 4: `types/production/index.ts` — limpiar `AllocationPreview`**

Si tras el Task 10/11 nada del frontend usa `AllocationPreview`/
`MaterialShortage` (confirmar con grep antes de tocar los dashboards, o
dejarlo para el final de Task 11), borrarlos. Si hay dudas, dejar este step
para el final de Task 11 en vez de aquí.

- [ ] **Step 5: Build**

```bash
docker-compose exec web npm run build
```

Esperado: falla en este punto (los dashboards todavía importan las funciones
borradas) — es normal, se resuelve en Task 10/11. Confirmar que el error es
justo "no exported member" de las funciones borradas, no otra cosa.

- [ ] **Step 6: Commit**

```bash
git add frontend/lib/production-api.ts frontend/types/production/index.ts
git commit -m "feat(production): cliente API para materiales por intento de etapa; quita el flujo viejo"
```

---

## Task 10: Frontend — `production-dashboard.tsx`

**Files:**
- Modify: `frontend/components/production/production-dashboard.tsx`

- [ ] **Step 1: Quitar el flujo viejo**

Borrar (buscar cada función por nombre y eliminar su cuerpo completo, más
cualquier botón/JSX que la invoque): `handleStartApprovedRun`
(`startProductionRun`), `handleStartReserved` (`startProductionRunWithReserved`),
`handleFinishStage`/`saveStageWeight`/`handleSaveStageWeight`/
`stageWeightEditFailsCondition` (`finishProductionRunStage`/
`editProductionRunStageWeight`, operan sobre `ProductionRunStage`, no
`StageAttempt`). Buscar también el modal/sección que las renderiza (estados
como `selectedRunForStages`, `editingStageId`, `editWeightValue`,
`stageWeights`, `stageChoice`, `reservationRunId`, `rejectJustification`) y
quitar la UI asociada si solo servía a estos handlers — verificar con grep
antes de borrar cada estado, algunos pueden ser compartidos:

```bash
grep -n "selectedRunForStages\|editingStageId\|stageWeights\b" frontend/components/production/production-dashboard.tsx
```

- [ ] **Step 2: Formulario de iniciar etapa — agregar materiales**

Ubicar el handler que llama `startStageAttempt` (`production-dashboard.tsx:1070`,
dentro de la función que arma el intento — leer 30 líneas alrededor para ver
el nombre exacto y el estado del formulario). Agregar al estado del
formulario una lista `stageMaterials: Array<{ itemId: string; quantity: string
}>` (inicial `[]`), con botones "Agregar material"/"Quitar" que empujan/sacan
filas, cada fila con un `MaterialCategoryPicker` (`allowedTypes:
["RAW_MATERIAL", "SUPPLY", "COMPLEMENT"]`, mismo patrón que su uso en
`production-dashboard.tsx:2271`) + input de cantidad. Al confirmar, pasar:

```typescript
const started = await startStageAttempt(dynamicOrderRun.id, {
  process_id: selectedProcessId,
  responsable_name: responsableName,
  materials: stageMaterials
    .filter((line) => line.itemId && line.quantity.trim())
    .map((line) => ({ item_id: line.itemId, quantity: line.quantity.trim() })),
});
```

(sustituir `selectedProcessId`/`responsableName` por los nombres de variable
reales del handler existente en la línea 1070 — leer el código actual antes
de aplicar este cambio).

- [ ] **Step 3: Mostrar el intento `PENDIENTE_MATERIAL` y botón de asignar**

En la sección donde se listan `run.stage_attempts` (buscar
`stage_attempts.map` o similar), si un intento tiene
`status === "PENDIENTE_MATERIAL"`, mostrar un badge "Falta material" y sus
`materials.filter((m) => Number(m.quantity_pending) > 0)` (nombre, pendiente,
unidad), con un botón:

```tsx
<button
  className="button buttonPrimary"
  onClick={() => void handleAllocateStageAttemptMaterial(attempt.id)}
  type="button"
>
  Asignar material disponible
</button>
```

y el handler:

```typescript
async function handleAllocateStageAttemptMaterial(attemptId: string) {
  setError(null);
  setIsSaving(true);
  try {
    await allocateStageAttemptMaterial(attemptId);
    setSuccess("Material asignado.");
    await reload();
  } catch (nextError) {
    setError(nextError instanceof Error ? nextError.message : "No se pudo asignar el material.");
  } finally {
    setIsSaving(false);
  }
}
```

Importar `allocateStageAttemptMaterial` desde `@/lib/production-api` en el
bloque de imports existente (línea 51 actual ya trae `startStageAttempt` del
mismo módulo).

- [ ] **Step 4: Exponer "Finalizar orden"**

Ubicar el botón/flujo actual que llama `assignProduct` (`production-dashboard.tsx:1137`).
Si hoy solo aparece dentro de un sub-modal de "asignar producto", agregar
(o renombrar, si ya existe un botón equivalente) un botón visible "Finalizar
orden" en la vista principal de una orden `EN_PROCESO`, habilitado solo
cuando `!run.stage_attempts.some((a) => a.status === "EN_PROCESO" || a.status
=== "PENDIENTE_MATERIAL")`, que abre el mismo modal de asignar producto ya
existente. No se cambia el handler que llama `assignProduct`, solo dónde/
cuándo se ofrece el botón.

- [ ] **Step 5: Build**

```bash
docker-compose exec web npm run build
```

Esperado: puede seguir fallando si `inventory-dashboard.tsx`/
`solicitudes-view.tsx` todavía importan funciones borradas — confirmar que
los errores restantes están solo en esos dos archivos.

- [ ] **Step 6: Commit**

```bash
git add frontend/components/production/production-dashboard.tsx
git commit -m "feat(production-dashboard): materiales al iniciar etapa, split pendiente y finalizar orden"
```

---

## Task 11: Frontend — `inventory-dashboard.tsx` y `solicitudes-view.tsx`

**Files:**
- Modify: `frontend/components/inventory/inventory-dashboard.tsx`
- Modify: `frontend/components/solicitudes/solicitudes-view.tsx`
- Modify: `frontend/components/layout/app-shell.tsx`

- [ ] **Step 1: `inventory-dashboard.tsx` — borrar el panel "Solicitudes de producción"**

Borrar (nombres verificados, buscar cada uno con grep antes de tocar —
las líneas se van a mover a medida que se borra):
- Imports: `allocateProductionRunMaterial`, `approveProductionRunMaterials`,
  `previewProductionRunAllocation`, `previewProductionRunApproveMaterials`,
  `rejectProductionRunMaterials`, `releaseProductionRunReservation`,
  `reserveProductionRunMaterial`, `receiveProductionRunFinishedProduct`.
- Estado: `approveSplitConfirm`, `allocateRuns`, `partialConfirm`, `rejectRun`,
  `rejectReason`, `isSolicitudesOpen`, `expandedSolicitudId`,
  `allocateQuantities`, `allocateErrors`, `allocatingRunId`.
- Funciones: `rejectionEntryLabel`, `handleApproveClick`,
  `handleApproveMaterials`, `openRejectModal`, `handleRejectMaterials`,
  `handleReleaseReservation`, `handleReceiveFinishedProduct`,
  `handleAllocateRun`, `handleReserveForRun`, `runAllocation`.
- JSX: el botón de nav que abre `isSolicitudesOpen` (`inventory-dashboard.tsx:2215-2221`),
  el panel `allocateRuns.length > 0 ? (...)` (`~3566-3730`), el modal
  `rejectRun ? (...)` (`~4560-4600`), el modal `isSolicitudesOpen ? (...)`
  ("Solicitudes de produccion", `~5154-5420`), el modal
  `approveSplitConfirm ? (...)` (`~5426` en adelante).
- `totalPendingSolicitudes` y el `useEffect` que lo usa para autocerrar el
  modal (`~1456-1467`) — borrar junto con el modal.

`handleApproveAdditionalMaterial`/`handleRejectAdditionalMaterial`
(material adicional, `~1203-1233`) **quedan intactos** — son del mecanismo
de `additional_material_requests`, fuera de este cambio.

Verificar al final que no queda ninguna referencia suelta:

```bash
grep -n "isSolicitudesOpen\|allocateRuns\|partialConfirm\|rejectRun\|approveSplitConfirm\|WaitingProductionRunSummary" frontend/components/inventory/inventory-dashboard.tsx
```

Esperado: sin resultados (o solo el import de tipos si decides no borrarlo
todavía — en ese caso, borrar también `WaitingProductionRunSummary` del
import de `@/types/inventory` en la línea 60).

- [ ] **Step 2: `solicitudes-view.tsx` — dejar solo el buzón de mensajes**

Reemplazar el archivo completo (mismo path,
`frontend/components/solicitudes/solicitudes-view.tsx`) para que
`SolicitudesView` quede así, quitando todo lo del flujo viejo
(`RunDetail`, `RunSummaryRows`, `STATUS_LABELS`, `myRuns`/`respondedRuns`/
`pendingReception`, `ActaView`/`RunStageSummaryTable`/`getRunFamily`/
`listProductionRuns`/`listInventoryItems`, impresión de "Solicitud de
producción"). `MessagesPanel`, `MessageThread`, `initials`, `dateTimeLabel`
quedan igual, tal cual están hoy (líneas 1-350 actuales del archivo, sin
tocar).

Después de la función `MessagesPanel` (que termina en la línea 350 actual),
reemplazar todo el resto del archivo (líneas 352-616 actuales, desde
`export function SolicitudesView()` hasta el final) por:

```tsx
export function SolicitudesView() {
  const queryClient = useQueryClient();
  const { data: currentUser, isLoading } = useQuery({
    queryKey: ["me"],
    queryFn: getCurrentUser,
    enabled: isAuthenticated(),
  });
  const role = currentUser ? normalizeRole(currentUser.role) : null;
  const userId = currentUser?.id ?? null;

  // Esta pantalla siempre muestra la bandeja de mensajes: entrar aqui ya
  // cuenta como haberla visto.
  useEffect(() => {
    if (role === "admin" || role === "operaciones") markMessagesSeen(queryClient, userId, "solicitudes");
  }, [role, userId, queryClient]);

  if (role === null || isLoading) {
    return (
      <div className="content">
        <div className="emptyState">Cargando mensajes...</div>
      </div>
    );
  }

  return (
    <div className="content">
      {role === "admin" || role === "operaciones" ? (
        <MessagesPanel role={role} scope="solicitudes" userId={userId} />
      ) : null}
    </div>
  );
}
```

Y en el bloque de imports al inicio del archivo (líneas 1-17 actuales),
dejar solo lo que `MessagesPanel`/`MessageThread`/el `SolicitudesView` nuevo
usan:

```tsx
"use client";

import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Trash2 } from "lucide-react";
import { isAuthenticated } from "@/lib/api";
import { getCurrentUser } from "@/lib/auth-api";
import { normalizeRole } from "@/lib/roles";
import { deleteMessage, listMessages, replyMessage, sendMessage, type AdminMessage } from "@/lib/messages-api";
import { markMessagesSeen, type MessagesScope } from "@/lib/messages-read-state";
import { confirmDelete, useConfirm } from "@/components/ui/confirm-dialog";
```

(quitar `createPortal`, `Eye`, `FileText`, `Printer`, `X`,
`listProductionRuns`, `getRunFamily`, `listInventoryItems`,
`RunStageSummaryTable`, `ActaView`, `type ProductionRun` — ya no se usan en
este archivo).

- [ ] **Step 3: `app-shell.tsx` — badge de pendientes**

En `frontend/components/layout/app-shell.tsx` (líneas 89-114 actuales),
cambiar:

```typescript
  const pendingAdditionalMaterials = navRuns.reduce(
    (total, run) =>
      run.status === "EN_PROCESO"
        ? total + (run.additional_materials ?? []).filter((request) => request.status === "PENDIENTE").length
        : total,
    0,
  );
  const invPending =
    navRuns.filter(
      (run) =>
        (run.status === "PENDIENTE_INVENTARIO" || run.status === "PENDIENTE_RECEPCION") &&
        (run.event_lines ?? []).length === 0,
    ).length + pendingAdditionalMaterials;
  const prodPending = navRuns.filter((run) => run.status === "MATERIALES_APROBADOS").length;
  // El punto rojo de "hay que actuar" es de Inventario/Produccion: Bandeja
  // de mensajes ya es solo mensajeria, no hereda ese aviso.
  const navBadges: Record<string, number> = {
    "/inventario": invPending,
    "/produccion": prodPending,
  };
```

a:

```typescript
  const pendingAdditionalMaterials = navRuns.reduce(
    (total, run) =>
      run.status === "EN_PROCESO"
        ? total + (run.additional_materials ?? []).filter((request) => request.status === "PENDIENTE").length
        : total,
    0,
  );
  // Intentos de etapa en PENDIENTE_MATERIAL (split automatico que quedo
  // corto de stock, ver allocate_stage_attempt_material): el punto rojo de
  // Produccion ahora avisa de esto en vez de "materiales aprobados", que ya
  // no existe.
  const pendingStageMaterial = navRuns.reduce(
    (total, run) => total + (run.stage_attempts ?? []).filter((attempt) => attempt.status === "PENDIENTE_MATERIAL").length,
    0,
  );
  const invPending = pendingAdditionalMaterials;
  const prodPending = pendingStageMaterial;
  // El punto rojo de "hay que actuar" es de Inventario/Produccion: Bandeja
  // de mensajes ya es solo mensajeria, no hereda ese aviso.
  const navBadges: Record<string, number> = {
    "/inventario": invPending,
    "/produccion": prodPending,
  };
```

- [ ] **Step 4: Build**

```bash
docker-compose exec web npm run build
```

Esperado: sin errores.

- [ ] **Step 5: Commit**

```bash
git add frontend/components/inventory/inventory-dashboard.tsx frontend/components/solicitudes/solicitudes-view.tsx frontend/components/layout/app-shell.tsx
git commit -m "refactor(frontend): elimina la UI de Solicitudes del flujo viejo, deja solo el buzon de mensajes"
```

---

## Task 12: Verificación final

**Files:** ninguno (solo verificación).

- [ ] **Step 1: Suite backend completa**

```bash
docker-compose exec api pytest
```

Esperado: 0 fallos.

- [ ] **Step 2: Chequeo de sintaxis global**

```bash
docker-compose exec api python -m compileall backend
```

- [ ] **Step 3: Build frontend**

```bash
docker-compose exec web npm run build
```

Esperado: build exitoso.

- [ ] **Step 4: Migraciones al día**

```bash
docker-compose exec api alembic upgrade head
```

- [ ] **Step 5: Smoke manual (navegador)**

Con la app corriendo: crear una orden nueva, iniciar una etapa con un
material del que hay poco stock (ver el split: un intento arranca, el otro
queda "Falta material"), agregar stock al item y apretar "Asignar material
disponible" (el intento pendiente arranca), cancelar una orden con material
ya consumido y confirmar que el stock vuelve en Inventario, y confirmar que
la navegación a "Bandeja de mensajes" ya no muestra ninguna cola de
aprobación, solo el chat.

- [ ] **Step 6: Commit final (si quedó algo suelto)**

```bash
git status
```

Si hay cambios sin commitear (typos corregidos durante el smoke test, etc.),
commitearlos con un mensaje descriptivo puntual.
