# Acta v2: sin splits/reservas, Entrada/Producto multi-línea, QC universal — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** El flujo nuevo de producción (`ProductionRunStageAttempt`) deja de
tener split automático por falta de stock y reserva de material; Entrada
(materia prima/cualquier item) y Producto(s) resultante se declaran como
listas al iniciar la etapa y mueven stock de inmediato, editables después
exactamente como una línea "Agregar"; el control de calidad (✓/✗) es
universal, y ✗ ya no cierra la etapa, solo deja un registro.

**Architecture:** Un solo mecanismo (`_apply_admin_acta_line_delta`) mueve
stock para TODA línea de acta con `item_id` (Entrada, Producto, Agregar,
edición, reversión, cancelación), sin importar su `source`
(`PLAN`/`ADMIN_STOCK`/`AUTO`). Se retira el split
(`_material_coverage_ratio`, `WAITING_MATERIAL`,
`allocate_stage_attempt_material`) y la conversión por lote
(`get_or_create_finished_product_lot`/`convert_lot_to_product` ya no se
llaman desde el flujo nuevo, aunque siguen existiendo para el flujo viejo).
Nueva tabla `production_run_stage_attempt_decisions` guarda cada ✓/✗ con
motivo. El flujo VIEJO (`ProductionRunStage`, estados de `ProductionRun`
`PENDIENTE_INVENTARIO`/`ESPERANDO_MATERIAL`/`MATERIALES_APROBADOS`) no se
toca.

**Tech Stack:** FastAPI + SQLAlchemy 2.0 + Alembic (backend/modules/production,
backend/modules/inventory), Next.js 16 + React 18 (frontend/components/production).

## Global Constraints

- Español-first en labels, mensajes de error y nombres de estado (CLAUDE.md).
- Servicios levantan `ProductionDomainError`/`ProductionNotFoundError`, nunca
  `HTTPException` (CLAUDE.md) — el router traduce.
- Todo cambio de stock nace de un `InventoryMovement` vía
  `create_movement()`/`_apply_admin_acta_line_delta` (CLAUDE.md) — nunca se
  edita `current_stock` a mano.
- Columna nueva → migración Alembic (CLAUDE.md regla 5).
- No se toca el flujo viejo (`ProductionRunStage`, estados legacy de
  `ProductionRun`) — solo lectura histórica, sigue intacto.
- Backend tocado → `docker-compose exec api pytest`. Frontend tocado →
  `docker-compose exec web npm run build`.
- Spec completo:
  [docs/superpowers/specs/2026-08-20-acta-v2-sin-splits-design.md](../specs/2026-08-20-acta-v2-sin-splits-design.md)
  (incluye el addendum de unificación — léelo antes de tocar código).

---

### Task 1: Bitácora de decisiones por intento de etapa

**Files:**
- Modify: `backend/modules/production/models.py`
- Create: migración nueva en `backend/alembic/versions/` (correr
  `docker-compose exec api alembic revision -m "production_run_stage_attempt_decisions"`
  para obtener el nombre/hash real — no inventar el nombre del archivo)
- Modify: `backend/modules/production/schemas.py`
- Modify: `backend/modules/production/repository.py`
- Test: `backend/tests/production/test_stage_attempt_decisions.py` (nuevo)

**Interfaces:**
- Produces: modelo `ProductionRunStageAttemptDecision` (campos: `id`,
  `stage_attempt_id`, `decision: str` ("APROBADA"/"RECHAZADA"),
  `reason: str | None`, `decided_by_user_id`, `decided_at`); schema
  `StageAttemptDecisionRead` (`from_attributes=True`); campo
  `decisions: list[StageAttemptDecisionRead] = Field(default_factory=list)`
  agregado a `StageAttemptRead`; método
  `ProductionProcessRepository.list_stage_attempt_decisions(attempt_id) -> list[ProductionRunStageAttemptDecision]`.
- Consumes: nada de tareas anteriores.

- [ ] **Step 1: Agregar el modelo**

En `backend/modules/production/models.py`, después de la clase
`ProductionRunStageAttemptMaterial` (justo antes de la clase
`ProductionRun`, o al final del archivo si es más simple — usa el patrón de
imports/columnas ya existente en el archivo), agrega:

```python
class ProductionRunStageAttemptDecision(Base):
    """Bitacora de cada vez que se aprueba (check) o rechaza (x) un intento
    de etapa (flujo nuevo, control de calidad universal). A diferencia de
    ProductionRunStageAttempt.status, un rechazo NO cierra el intento -- solo
    queda esta fila como registro; el intento sigue EN_PROCESO y editable."""

    __tablename__ = "production_run_stage_attempt_decisions"

    id: Mapped[PyUUID] = mapped_column(PG_UUID(as_uuid=True), primary_key=True, default=uuid4)
    stage_attempt_id: Mapped[PyUUID] = mapped_column(
        ForeignKey("production_run_stage_attempts.id", ondelete="CASCADE"), nullable=False, index=True
    )
    decision: Mapped[str] = mapped_column(String(20), nullable=False)
    reason: Mapped[str | None] = mapped_column(Text, nullable=True)
    decided_by_user_id: Mapped[PyUUID] = mapped_column(PG_UUID(as_uuid=True), nullable=False)
    decided_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False, default=datetime.utcnow)
```

- [ ] **Step 2: Migración**

```bash
docker-compose exec api alembic revision -m "production_run_stage_attempt_decisions"
```

Edita el archivo generado (`backend/alembic/versions/<hash>_production_run_stage_attempt_decisions.py`):

```python
def upgrade() -> None:
    op.create_table(
        "production_run_stage_attempt_decisions",
        sa.Column("id", postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "stage_attempt_id",
            postgresql.UUID(as_uuid=True),
            sa.ForeignKey("production_run_stage_attempts.id", ondelete="CASCADE"),
            nullable=False,
        ),
        sa.Column("decision", sa.String(length=20), nullable=False),
        sa.Column("reason", sa.Text(), nullable=True),
        sa.Column("decided_by_user_id", postgresql.UUID(as_uuid=True), nullable=False),
        sa.Column("decided_at", sa.DateTime(timezone=True), nullable=False),
    )
    op.create_index(
        "ix_production_run_stage_attempt_decisions_stage_attempt_id",
        "production_run_stage_attempt_decisions",
        ["stage_attempt_id"],
    )


def downgrade() -> None:
    op.drop_index("ix_production_run_stage_attempt_decisions_stage_attempt_id", table_name="production_run_stage_attempt_decisions")
    op.drop_table("production_run_stage_attempt_decisions")
```

Ajusta imports (`sa`, `postgresql`) al patrón que ya usan otras migraciones
del mismo directorio (revisa una migración reciente, ej. la de
`c5d6e7f8a9b0_product_types_sin_materia_prima.py`, para el encabezado
exacto).

- [ ] **Step 3: Correr la migración**

```bash
docker-compose exec api alembic upgrade head
```

Expected: aplica sin error.

- [ ] **Step 4: Schema de lectura**

En `backend/modules/production/schemas.py`, agrega (cerca de
`StageDecisionRead`, para que quede junto a su análogo del flujo viejo):

```python
class StageAttemptDecisionRead(BaseModel):
    model_config = ConfigDict(from_attributes=True, extra="forbid")

    decision: str
    reason: str | None = None
    decided_by_name: str | None = None
    decided_at: datetime
```

Y en `StageAttemptRead`, agrega el campo:

```python
    decisions: list[StageAttemptDecisionRead] = Field(default_factory=list)
```

- [ ] **Step 5: Repository helper**

En `backend/modules/production/repository.py`, agrega (cerca de
`get_stage_attempt`, usando el mismo `self.session`):

```python
    def list_stage_attempt_decisions(self, attempt_id: UUID) -> list[ProductionRunStageAttemptDecision]:
        from sqlalchemy import select
        return list(
            self.session.execute(
                select(ProductionRunStageAttemptDecision)
                .where(ProductionRunStageAttemptDecision.stage_attempt_id == attempt_id)
                .order_by(ProductionRunStageAttemptDecision.decided_at.asc())
            ).scalars().all()
        )
```

(Importa `ProductionRunStageAttemptDecision` desde `.models` junto a los
demás imports de modelos del archivo.)

- [ ] **Step 6: Test de ida y vuelta**

Crea `backend/tests/production/test_stage_attempt_decisions.py`:

```python
"""Bitacora de decisiones (aprobar/rechazar) por intento de etapa -- ver
docs/superpowers/specs/2026-08-20-acta-v2-sin-splits-design.md."""
import uuid
from datetime import datetime, timezone
from decimal import Decimal

from backend.modules.product_types.models import ProductType  # noqa: F401
from backend.modules.production.models import ProductionRunStageAttemptDecision
from backend.modules.production.schemas import ProductionOrderCreate, StageAttemptCreate, StageAttemptProductTarget


def test_stage_attempt_decision_roundtrip(db_session, production_service, current_user, process, complement_item):
    order = production_service.create_order(ProductionOrderCreate(name="Orden decision test"), current_user)
    result = production_service.start_stage_attempt(
        order.id,
        StageAttemptCreate(process_id=process.id, responsable_name="Ana", product=StageAttemptProductTarget(target_item_id=complement_item.id)),
        current_user,
    )
    attempt_id = result.stage_attempts[0].id

    decision = ProductionRunStageAttemptDecision(
        stage_attempt_id=attempt_id,
        decision="RECHAZADA",
        reason="Pieza deforme",
        decided_by_user_id=current_user.id,
        decided_at=datetime.now(timezone.utc),
    )
    db_session.add(decision)
    db_session.flush()

    decisions = production_service.repository.list_stage_attempt_decisions(attempt_id)
    assert len(decisions) == 1
    assert decisions[0].decision == "RECHAZADA"
    assert decisions[0].reason == "Pieza deforme"
```

**Nota:** este test usa `StageAttemptCreate(product=...)` (todavía la forma
vieja) porque Task 3 es la que cambia el schema a `products=[...]`. Si al
llegar a este paso Task 3 ya corrió antes (orden de ejecución distinto),
ajusta esta llamada a `products=[StageAttemptProductLine(target_item_id=complement_item.id, quantity=Decimal("1"))]`
y el import correspondiente.

- [ ] **Step 7: Correr el test**

Run: `docker-compose exec api pytest backend/tests/production/test_stage_attempt_decisions.py -v`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add backend/modules/production/models.py backend/modules/production/schemas.py backend/modules/production/repository.py backend/alembic/versions/ backend/tests/production/test_stage_attempt_decisions.py
git commit -m "feat(produccion): bitacora de decisiones (aprobar/rechazar) por intento de etapa"
```

---

### Task 2: Tope de stock centralizado en `_apply_admin_acta_line_delta`

**Files:**
- Modify: `backend/modules/production/service.py`
- Test: `backend/tests/production/test_admin_acta_line.py`

**Interfaces:**
- Consumes: nada nuevo.
- Produces: `_apply_admin_acta_line_delta` ahora bloquea cualquier consumo
  (`CONSUMO_PRODUCCION`, ENTREGA) que deje `current_stock` negativo, sin
  importar quién la llame (Task 3, 4 y 5 dependen de este chequeo único).

- [ ] **Step 1: Escribir el test que falla**

En `backend/tests/production/test_admin_acta_line.py`, agrega (junto a los
demás tests de `add_admin_acta_line`, reusando el patrón de fixtures ya
existente en el archivo):

```python
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
```

- [ ] **Step 2: Correr el test, debe fallar**

Run: `docker-compose exec api pytest backend/tests/production/test_admin_acta_line.py::test_add_admin_acta_line_entrega_blocks_when_quantity_exceeds_stock -v`
Expected: FAIL (hoy no hay tope de stock disponible en absoluto para ENTREGA en `add_admin_acta_line`, solo el chequeo de reserva).

- [ ] **Step 3: Implementar el tope**

En `backend/modules/production/service.py`, dentro de
`_apply_admin_acta_line_delta`, en el bloque
`if movement_type == "CONSUMO_PRODUCCION":` (busca el bloque que hoy
calcula `reserved`/`next_stock` para el chequeo de reserva), agrega el
chequeo de disponible ANTES del chequeo de reserva:

```python
        if movement_type == "CONSUMO_PRODUCCION":
            from backend.modules.inventory.models import InventoryItem

            item = self.repository.session.get(InventoryItem, line.item_id)
            if item is not None:
                if item.current_stock - abs(delta) < 0:
                    raise ProductionDomainError(
                        f"'{line.label}': no hay suficiente stock de '{item.name}'. "
                        f"Disponible: {format_qty(item.current_stock)} {item.unit_code}, "
                        f"se pidio {format_qty(abs(delta))} {item.unit_code}."
                    )
                reserved = self.inventory_service.reserved_stock(item.id)
                next_stock = item.current_stock - abs(delta)
                if reserved > 0 and next_stock < reserved:
                    raise ProductionDomainError(
                        f"'{line.label}': hay {format_qty(reserved)} {item.unit_code} de '{item.name}' "
                        f"reservados para ordenes de produccion en espera. Disponible para esta salida: "
                        f"{format_qty(item.current_stock - reserved)} {item.unit_code}. "
                        "Libera la reserva desde la orden si necesitas usar ese stock."
                    )
```

(Solo se agrega el `if item.current_stock - abs(delta) < 0: raise ...` — el
resto del bloque no cambia.)

- [ ] **Step 4: Correr el test, debe pasar**

Run: `docker-compose exec api pytest backend/tests/production/test_admin_acta_line.py -v`
Expected: PASS (todos, incluido el nuevo).

- [ ] **Step 5: Suite completa de producción**

Run: `docker-compose exec api pytest backend/tests/production -q`
Expected: PASS (si algo falla por depender de exceder stock a propósito,
son fixtures viejas que hay que ajustar — revisa el mensaje).

- [ ] **Step 6: Commit**

```bash
git add backend/modules/production/service.py backend/tests/production/test_admin_acta_line.py
git commit -m "feat(produccion): tope de stock disponible centralizado en _apply_admin_acta_line_delta"
```

---

### Task 3: `start_stage_attempt` sin split + control de calidad universal — cambio atómico

**Nota de alcance (corrección post-revisión, ver `.superpowers/sdd/task-3-report.md`
de la ejecución con subagentes):** esta tarea absorbe lo que originalmente era
la Task 4 separada. Razón: `start_stage_attempt` reescrito ya NO llena
`attempt.target_item_id`/`target_product_type_id` (el producto resultante
mueve stock de inmediato, no queda "destino pendiente" para convertir
después); pero el `finish_stage_attempt` viejo depende exactamente de esos
dos campos para convertir su lote. Dejar el rewrite de `start_stage_attempt`
solo, sin reemplazar `finish_stage_attempt` en el mismo cambio, deja el
código en un estado roto en tiempo de ejecución (y, peor, borrar
`StageAttemptFinish` sin tocar `finish_stage_attempt`/su import en
`router.py` en el mismo cambio rompe la carga del módulo completo — la app
entera no arranca). Por eso todo esto es una sola tarea, un solo lote de
commits, revisado junto.

Además, el grep amplio que hizo el subagente encontró más archivos de test
que usan la forma vieja (`product=`/`StageAttemptProductTarget`/
`StageAttemptFinish`) de los que el plan original anticipaba — se listan
abajo en Files.

**Files:**
- Modify: `backend/modules/production/schemas.py`
- Modify: `backend/modules/production/service.py`
- Modify: `backend/modules/production/router.py`
- Modify: `backend/tests/production/test_stage_attempt_material.py` (reescritura completa)
- Modify: `backend/tests/production/test_stage_quality_control.py` (reescritura completa)
- Modify (rename mecánico `product=StageAttemptProductTarget(...)` →
  `products=[StageAttemptProductLine(..., quantity=...)]`, y
  `StageAttemptFinish(...)`/`finish_stage_attempt(...)` →
  `StageAttemptReject(...)`/`reject_stage_attempt(...)` o
  `approve_stage_attempt(...)` según corresponda al caso de cada test):
  `backend/tests/production/test_admin_acta_line.py`,
  `backend/tests/production/test_stage_attempt_decisions.py`,
  `backend/tests/production/test_revert_stage_attempt.py`,
  `backend/tests/production/test_cancel_run.py`,
  `backend/tests/production/test_acta_edit.py`
  (`backend/tests/production/test_dynamic_flow.py` queda para Task 6 —
  tiene su propia tarea dedicada porque el volumen de usos ahí es mayor).

**Interfaces:**
- Consumes: `_apply_admin_acta_line_delta` con tope de stock (Task 2),
  `ProductionRunStageAttemptDecision` (Task 1).
- Produces: `StageAttemptProductLine` (schema), `StageAttemptCreate.products: list[StageAttemptProductLine]`,
  `StageAttemptReject` (schema), `ProductionService._resolve_or_create_finished_item(item_id, product_type_id, material_code) -> InventoryItem`
  (reusado por Task 4), `start_stage_attempt` reescrito sin split,
  `ProductionService.approve_stage_attempt(attempt_id, current_user)`,
  `ProductionService.reject_stage_attempt(attempt_id, payload, current_user)`,
  endpoints `POST /runs/stage-attempts/{id}/approve` y `.../reject`.

- [ ] **Step 1: Cambiar el schema**

En `backend/modules/production/schemas.py`, reemplaza `StageAttemptProductTarget`:

```python
class StageAttemptProductLine(BaseModel):
    """Una linea de producto resultante: destino (pieza real o tipo del
    catalogo + material) y su cantidad -- se agrega de inmediato como linea
    RECEPCION real al iniciar la etapa (Rodrigo, 2026-08-20: ya no se pide
    la cantidad al finalizar, ni hay lote intermedio)."""

    model_config = ConfigDict(extra="forbid")

    product_type_id: UUID | None = None
    target_item_id: UUID | None = None
    # Requerido si product_type_id y el item aun no existe (se crea al
    # vuelo, ver ProductionService._resolve_or_create_finished_item).
    material_code: str | None = None
    quantity: Decimal = Field(gt=0)

    @model_validator(mode="after")
    def _check_one_target(self) -> "StageAttemptProductLine":
        if (self.product_type_id is None) == (self.target_item_id is None):
            raise ValueError(
                "El producto resultante debe ser una pieza del inventario o un "
                "tipo del catalogo (uno de los dos)."
            )
        return self
```

Y cambia `StageAttemptCreate`:

```python
class StageAttemptCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    process_id: UUID
    responsable_name: str = Field(min_length=1, max_length=180)
    # Entrada: cualquier item de inventario que entra a esta etapa (ya no
    # solo materia prima). Sin tope de stock aca -- lo valida
    # _apply_admin_acta_line_delta al aplicar cada linea.
    materials: list[StageAttemptMaterialLine] = Field(default_factory=list)
    # Obligatorio: al menos un producto resultante, cada uno con su cantidad.
    products: list[StageAttemptProductLine] = Field(min_length=1)
```

Elimina `StageAttemptFinish` (más abajo, en este mismo task, la reemplaza
`StageAttemptReject` — Step 9).
Si `StageAttemptProductTarget` se usa en otro lado del archivo (busca
`grep -n StageAttemptProductTarget backend/modules/production/schemas.py`
antes de borrar la clase), ajusta esos usos también.

- [ ] **Step 2: Reescribir el test de materiales (falla primero)**

Reemplaza **todo el contenido** de
`backend/tests/production/test_stage_attempt_material.py` por:

```python
"""Entrada al iniciar un intento de etapa: sin split, tope = stock
disponible (docs/superpowers/specs/2026-08-20-acta-v2-sin-splits-design.md)."""
from decimal import Decimal

import pytest

from backend.modules.product_types.models import ProductType  # noqa: F401
from backend.modules.production.schemas import (
    ProductionOrderCreate,
    StageAttemptCreate,
    StageAttemptMaterialLine,
    StageAttemptProductLine,
)
from backend.modules.production.service import ProductionDomainError


def _start_order(production_service, current_user):
    return production_service.create_order(ProductionOrderCreate(name="Orden material test"), current_user)


def _product(item, quantity="1") -> StageAttemptProductLine:
    return StageAttemptProductLine(target_item_id=item.id, quantity=Decimal(quantity))


def test_start_stage_attempt_without_materials_starts_directly(
    production_service, current_user, process, complement_item
):
    order = _start_order(production_service, current_user)

    result = production_service.start_stage_attempt(
        order.id,
        StageAttemptCreate(process_id=process.id, responsable_name="Ana", products=[_product(complement_item)]),
        current_user,
    )

    assert len(result.stage_attempts) == 1
    assert result.stage_attempts[0].status == "EN_PROCESO"
    assert result.stage_attempts[0].materials == []
    recepcion_lines = [l for l in result.acta_lines if l.side == "RECEPCION"]
    assert len(recepcion_lines) == 1
    assert recepcion_lines[0].quantity == Decimal("1")


def test_start_stage_attempt_requires_at_least_one_product(process):
    from pydantic import ValidationError

    with pytest.raises(ValidationError):
        StageAttemptCreate(process_id=process.id, responsable_name="Ana", products=[])


def test_start_stage_attempt_consumes_entrada_and_moves_stock(
    db_session, production_service, current_user, process, raw_material, complement_item
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
            products=[_product(complement_item)],
        ),
        current_user,
    )

    assert len(result.stage_attempts) == 1
    attempt = result.stage_attempts[0]
    assert attempt.status == "EN_PROCESO"
    db_session.refresh(raw_material)
    assert raw_material.current_stock == Decimal("0")
    entrega_lines = [line for line in attempt.acta_lines if line.side == "ENTREGA"]
    assert len(entrega_lines) == 1
    assert entrega_lines[0].quantity == Decimal("100")


def test_start_stage_attempt_blocks_entrada_above_available_stock(
    db_session, production_service, current_user, process, raw_material, complement_item
):
    raw_material.current_stock = Decimal("60")
    db_session.flush()
    order = _start_order(production_service, current_user)

    with pytest.raises(ProductionDomainError, match="no hay suficiente stock"):
        production_service.start_stage_attempt(
            order.id,
            StageAttemptCreate(
                process_id=process.id,
                responsable_name="Ana",
                materials=[StageAttemptMaterialLine(item_id=raw_material.id, quantity=Decimal("100"))],
                products=[_product(complement_item)],
            ),
            current_user,
        )

    # No debe haber creado ningun intento a medias.
    order_after = production_service.repository.get_run(order.id)
    assert order_after.stage_attempts == []
    db_session.refresh(raw_material)
    assert raw_material.current_stock == Decimal("60")


def test_start_stage_attempt_blocks_entrada_with_zero_stock(
    db_session, production_service, current_user, process, raw_material, complement_item
):
    order = _start_order(production_service, current_user)

    with pytest.raises(ProductionDomainError, match="no hay suficiente stock"):
        production_service.start_stage_attempt(
            order.id,
            StageAttemptCreate(
                process_id=process.id,
                responsable_name="Ana",
                materials=[StageAttemptMaterialLine(item_id=raw_material.id, quantity=Decimal("1"))],
                products=[_product(complement_item)],
            ),
            current_user,
        )


def test_start_stage_attempt_multiple_products_move_stock_immediately(
    db_session, production_service, current_user, process, complement_item, target_complement
):
    order = _start_order(production_service, current_user)

    result = production_service.start_stage_attempt(
        order.id,
        StageAttemptCreate(
            process_id=process.id,
            responsable_name="Ana",
            products=[_product(complement_item, "2"), _product(target_complement, "3")],
        ),
        current_user,
    )

    attempt = result.stage_attempts[0]
    recepcion_lines = {l.item_id: l.quantity for l in attempt.acta_lines if l.side == "RECEPCION"}
    assert recepcion_lines[complement_item.id] == Decimal("2")
    assert recepcion_lines[target_complement.id] == Decimal("3")
    db_session.refresh(complement_item)
    db_session.refresh(target_complement)
    assert complement_item.current_stock == Decimal("2")
    assert target_complement.current_stock == Decimal("3")
```

- [ ] **Step 3: Correr el test, debe fallar**

Run: `docker-compose exec api pytest backend/tests/production/test_stage_attempt_material.py -v`
Expected: FAIL (import error / `products` no existe todavia en el service).

- [ ] **Step 4: Extraer el helper compartido de resolucion de item**

En `backend/modules/production/service.py`, dentro de `add_admin_acta_line`
hoy existe este bloque (léelo primero con
`grep -n "item = self.repository.session.get(InventoryItem, payload.item_id)" backend/modules/production/service.py`
para confirmar la línea exacta tras los cambios de Task 2):

```python
        if payload.item_id is not None:
            from backend.modules.inventory.models import InventoryItem

            item = self.repository.session.get(InventoryItem, payload.item_id)
            if item is None:
                raise ProductionNotFoundError("Item de inventario no encontrado.")
        else:
            if payload.side != ActaLineSide.RECEPCION:
                raise ProductionDomainError(
                    "Un producto de catalogo sin stock solo se puede agregar por el lado RECIBIDO."
                )
            if not payload.material_code or not payload.unit_code:
                raise ProductionDomainError("Elige el material y la unidad de la pieza nueva.")
            item = self.inventory_service.get_or_create_finished_item(
                payload.product_type_id, payload.material_code, payload.unit_code.strip()
            )
```

Extrae la rama `else` a un método nuevo, y deja `add_admin_acta_line`
llamándolo:

```python
    def _resolve_or_create_finished_item(
        self, product_type_id: UUID, material_code: str | None, unit_code: str | None
    ) -> "InventoryItem":
        """Resuelve (o crea) el item real detras de un product_type_id sin
        stock todavia -- compartido por add_admin_acta_line y
        start_stage_attempt (Producto resultante)."""
        if not material_code or not unit_code:
            raise ProductionDomainError("Elige el material y la unidad de la pieza nueva.")
        return self.inventory_service.get_or_create_finished_item(
            product_type_id, material_code, unit_code.strip()
        )
```

Y en `add_admin_acta_line`, la rama `else` queda:

```python
        else:
            if payload.side != ActaLineSide.RECEPCION:
                raise ProductionDomainError(
                    "Un producto de catalogo sin stock solo se puede agregar por el lado RECIBIDO."
                )
            item = self._resolve_or_create_finished_item(
                payload.product_type_id, payload.material_code, payload.unit_code
            )
```

- [ ] **Step 5: Reescribir `start_stage_attempt`**

Reemplaza el método completo (desde `def start_stage_attempt` hasta el
`return self._read_with_names(run)` que le sigue, justo antes de
`def finish_stage_attempt`) por:

```python
    def start_stage_attempt(
        self, run_id: UUID, payload: StageAttemptCreate, current_user: CurrentUser
    ) -> ProductionRunRead:
        run = self.repository.get_run(run_id)
        if run is None:
            raise ProductionNotFoundError("Orden de produccion no encontrada.")
        if run.status != ProductionRunStatus.IN_PROGRESS:
            raise ProductionDomainError("Solo se puede iniciar una etapa en una orden en proceso.")
        if self.repository.get_active_stage_attempt(run_id) is not None:
            raise ProductionDomainError(
                "Ya hay una etapa en curso para esta orden -- finalizala antes de iniciar otra."
            )

        process = self.repository.get(payload.process_id)
        if process is None:
            raise ProductionNotFoundError("Proceso no encontrado en el banco.")
        if not process.is_active:
            raise ProductionDomainError("El proceso no esta activo.")
        if self.inventory_service is None:
            raise ProductionDomainError("Inventario no esta disponible para iniciar esta etapa.")

        from backend.modules.inventory.models import InventoryItem

        # Fase 1: resolver todo ANTES de mover nada -- si algo falla (item
        # inexistente, material/unidad faltante), no queda ningun intento a
        # medias. El tope de stock lo valida _apply_admin_acta_line_delta en
        # la fase 2 (chequeo unico, ver Task 2).
        resolved_materials: list[tuple[InventoryItem, Decimal]] = []
        for line in payload.materials:
            item = self.repository.session.get(InventoryItem, line.item_id)
            if item is None:
                raise ProductionNotFoundError("Un material declarado para la etapa no existe en inventario.")
            resolved_materials.append((item, line.quantity))

        resolved_products: list[tuple[InventoryItem, Decimal]] = []
        for line in payload.products:
            if line.target_item_id is not None:
                item = self.repository.session.get(InventoryItem, line.target_item_id)
                if item is None:
                    raise ProductionNotFoundError("Un producto resultante declarado no existe en inventario.")
            else:
                item = self._resolve_or_create_finished_item(line.product_type_id, line.material_code, "g")
            resolved_products.append((item, line.quantity))

        sequence_order = len(run.stage_attempts) + 1
        attempt_no = (
            self.repository.count_stage_attempts_for_process(run_id, process.id, process.name) + 1
        )
        order_code = run.production_code or run.root_production_code
        attempt_code = _stage_attempt_code_for(order_code, process.name, attempt_no) if order_code else None

        attempt = ProductionRunStageAttempt(
            run_id=run.id,
            process_id=process.id,
            process_name=process.name,
            sequence_order=sequence_order,
            attempt_no_for_process=attempt_no,
            code=attempt_code,
            responsable_name=payload.responsable_name.strip(),
            status=StageAttemptStatus.IN_PROGRESS,
            started_by_user_id=current_user.id,
            started_at=datetime.utcnow(),
        )
        run.stage_attempts.append(attempt)
        self.repository.flush()

        def _add_line(item: InventoryItem, quantity: Decimal, side: str) -> None:
            line = ProductionRunActaLine(
                side=side,
                label=item.name,
                quantity=Decimal("0"),
                unit_code=item.unit_code,
                item_id=item.id,
                source=ActaLineSource.PLAN,
                line_order=sum(1 for l in run.acta_lines if l.side == side),
                created_by_user_id=current_user.id,
                stage_attempt_id=attempt.id,
            )
            run.acta_lines.append(line)
            self.repository.flush()
            self._apply_admin_acta_line_delta(line, quantity, current_user)
            line.quantity = quantity
            self.repository.flush()

        for item, quantity in resolved_materials:
            _add_line(item, quantity, ActaLineSide.ENTREGA)
            attempt.materials.append(
                ProductionRunStageAttemptMaterial(
                    item_id=item.id,
                    unit_code=item.unit_code,
                    quantity_requested=quantity,
                    quantity_pending=Decimal("0"),
                )
            )
        for item, quantity in resolved_products:
            _add_line(item, quantity, ActaLineSide.RECEPCION)

        self.repository.flush()
        return self._read_with_names(run)
```

Borra `_material_coverage_ratio` (ya no lo usa nadie tras este cambio —
confirma con
`grep -rn "_material_coverage_ratio" backend/` antes de borrar; si algo más
lo llama, no lo borres y avisa en el commit).

Borra también `allocate_stage_attempt_material` completo del service (su
único propósito -- el split -- desaparece con este task); el endpoint
correspondiente en el router se quita más abajo, en el Step 11 de este
mismo task.

- [ ] **Step 6: Correr el test del Step 2**

Run: `docker-compose exec api pytest backend/tests/production/test_stage_attempt_material.py -v`
Expected: PASS (todos).

**No hagas commit todavía — el schema y el service quedan en un estado que
no importa hasta que los Steps 9-11 (abajo) reemplacen `finish_stage_attempt`
en el mismo cambio. Sigue directo con el Step 7.**

- [ ] **Step 7: Schema `StageAttemptReject`**

En `backend/modules/production/schemas.py`, borra `StageAttemptFinish` (si
no lo borraste ya en el Step 1) y agrega:

```python
class StageAttemptReject(BaseModel):
    model_config = ConfigDict(extra="forbid")

    reason: str | None = Field(default=None, max_length=1000)
```

- [ ] **Step 8: Reescribir el test de calidad (falla primero)**

Reemplaza **todo el contenido** de
`backend/tests/production/test_stage_quality_control.py` por:

```python
"""Control de calidad universal (Rodrigo, 2026-08-20): toda etapa muestra
✔/✘. ✔ aprueba y calcula merma de los totales del acta (ya no hay
'cantidad de producto' que pedir, los productos ya movieron stock al
iniciar la etapa). ✘ NO cierra el intento -- solo deja un registro en la
bitacora y el acta sigue editable."""
import uuid
from decimal import Decimal

from sqlalchemy import select

from backend.modules.product_types.models import ProductType  # noqa: F401
from backend.modules.production.schemas import (
    AdminActaLineCreate,
    ProductionOrderCreate,
    StageAttemptCreate,
    StageAttemptProductLine,
    StageAttemptReject,
)


def _start(production_service, current_user, process, target_complement, quantity="1"):
    order = production_service.create_order(ProductionOrderCreate(name="Orden calidad test"), current_user)
    return production_service.start_stage_attempt(
        order.id,
        StageAttemptCreate(
            process_id=process.id,
            responsable_name="Ana",
            products=[StageAttemptProductLine(target_item_id=target_complement.id, quantity=Decimal(quantity))],
        ),
        current_user,
    )


def test_approve_closes_the_attempt(db_session, production_service, current_user, process, target_complement):
    result = _start(production_service, current_user, process, target_complement)
    attempt = result.stage_attempts[0]

    approved = production_service.approve_stage_attempt(attempt.id, current_user)

    assert approved.stage_attempts[0].status == "APROBADA"
    decisions = production_service.repository.list_stage_attempt_decisions(attempt.id)
    assert len(decisions) == 1
    assert decisions[0].decision == "APROBADA"


def test_reject_does_not_close_the_attempt(db_session, production_service, current_user, process, target_complement):
    result = _start(production_service, current_user, process, target_complement)
    attempt = result.stage_attempts[0]

    rejected = production_service.reject_stage_attempt(
        attempt.id, StageAttemptReject(reason="Pieza deforme"), current_user
    )

    assert rejected.stage_attempts[0].status == "EN_PROCESO"
    decisions = production_service.repository.list_stage_attempt_decisions(attempt.id)
    assert len(decisions) == 1
    assert decisions[0].decision == "RECHAZADA"
    assert decisions[0].reason == "Pieza deforme"

    # El intento sigue editable y se puede aprobar despues de corregir.
    approved = production_service.approve_stage_attempt(attempt.id, current_user)
    assert approved.stage_attempts[0].status == "APROBADA"
    decisions_after = production_service.repository.list_stage_attempt_decisions(attempt.id)
    assert len(decisions_after) == 2


def test_reject_reason_is_optional(db_session, production_service, current_user, process, target_complement):
    result = _start(production_service, current_user, process, target_complement)
    attempt = result.stage_attempts[0]

    rejected = production_service.reject_stage_attempt(attempt.id, StageAttemptReject(), current_user)

    assert rejected.stage_attempts[0].status == "EN_PROCESO"
    decisions = production_service.repository.list_stage_attempt_decisions(attempt.id)
    assert decisions[0].reason is None


def test_merma_computed_from_entrega_minus_recepcion_totals(
    db_session, production_service, current_user, process, target_complement
):
    """Merma = entrega_total - recepcion_total del intento, ya no hay
    'product_quantity' que pedir por separado."""
    from backend.modules.inventory.models import InventoryItem

    supply = InventoryItem(
        item_type="SUPPLY", name="Insumo test", sku=f"IN-TEST-{uuid.uuid4().hex[:8]}",
        unit_code="g", current_stock=Decimal("100"),
    )
    db_session.add(supply)
    db_session.flush()
    order = production_service.create_order(ProductionOrderCreate(name="Orden merma test"), current_user)
    result = production_service.start_stage_attempt(
        order.id,
        StageAttemptCreate(
            process_id=process.id,
            responsable_name="Ana",
            products=[StageAttemptProductLine(target_item_id=target_complement.id, quantity=Decimal("1"))],
        ),
        current_user,
    )
    attempt = result.stage_attempts[0]

    production_service.add_admin_acta_line(
        order.id,
        AdminActaLineCreate(side="ENTREGA", item_id=supply.id, quantity=Decimal("100"), stage_attempt_id=attempt.id, note="Se olvido al iniciar"),
        current_user,
    )
    # Devuelve 95 del mismo item -- de los 100 entregados, 95 vuelven, 1 se
    # convirtio en producto (linea PLAN ya creada al iniciar), quedan 4 de
    # merma.
    production_service.add_admin_acta_line(
        order.id,
        AdminActaLineCreate(side="RECEPCION", item_id=supply.id, quantity=Decimal("95"), stage_attempt_id=attempt.id),
        current_user,
    )

    approved = production_service.approve_stage_attempt(attempt.id, current_user)

    done = approved.stage_attempts[0]
    assert done.status == "APROBADA"
    # entrega_total = 100 (supply), recepcion_total = 95 (supply) + 1 (producto) = 96.
    assert done.merma_weight == Decimal("4")


def test_merma_real_se_guarda_en_inventario_como_waste(
    db_session, production_service, current_user, process, raw_material, target_complement
):
    from backend.modules.inventory.models import InventoryItem
    from backend.modules.production.schemas import StageAttemptMaterialLine

    raw_material.current_stock = Decimal("100")
    db_session.flush()
    order = production_service.create_order(ProductionOrderCreate(name="Orden merma inventario"), current_user)
    result = production_service.start_stage_attempt(
        order.id,
        StageAttemptCreate(
            process_id=process.id,
            responsable_name="Ana",
            materials=[StageAttemptMaterialLine(item_id=raw_material.id, quantity=Decimal("100"))],
            products=[StageAttemptProductLine(target_item_id=target_complement.id, quantity=Decimal("90"))],
        ),
        current_user,
    )
    attempt_id = result.stage_attempts[0].id

    production_service.approve_stage_attempt(attempt_id, current_user)

    waste_item = db_session.execute(
        select(InventoryItem).where(
            InventoryItem.item_type == "WASTE",
            InventoryItem.name == f"Merma {process.name}",
        )
    ).scalar_one_or_none()
    assert waste_item is not None
    assert waste_item.current_stock == Decimal("10")
```

**Nota sobre `raw_material`**: la materia prima ya NO se puede devolver por
RECEPCION (regla vigente, sin cambios de este spec) -- por eso el test de
merma usa `raw_material` como Entrada y `target_complement` como Producto:
100 entregado - 90 convertido a producto = 10 de merma, sin que la materia
prima aparezca del lado RECEPCION.

- [ ] **Step 9: Correr el test, debe fallar**

Run: `docker-compose exec api pytest backend/tests/production/test_stage_quality_control.py -v`
Expected: FAIL (`approve_stage_attempt`/`reject_stage_attempt` no existen todavia).

- [ ] **Step 10: Implementar `approve_stage_attempt`/`reject_stage_attempt`**

En `backend/modules/production/service.py`, reemplaza el método
`finish_stage_attempt` completo (desde `def finish_stage_attempt` hasta su
`return self._read_with_names(run)`) por estos dos métodos:

```python
    def approve_stage_attempt(self, attempt_id: UUID, current_user: CurrentUser) -> ProductionRunRead:
        """✔: cierra el intento. La merma es entrega_total - recepcion_total
        de ESTE intento -- ambos ya estan en el acta (Entrada y Producto
        resultante mueven stock de inmediato desde start_stage_attempt/
        Agregar), no hay 'cantidad' que pedir ni lote que convertir aca."""
        attempt = self.repository.get_stage_attempt(attempt_id)
        if attempt is None:
            raise ProductionNotFoundError("Etapa no encontrada.")
        if attempt.status != StageAttemptStatus.IN_PROGRESS:
            raise ProductionDomainError("Solo se puede aprobar una etapa en curso.")
        run = attempt.run

        entrega_lines = [
            line for line in run.acta_lines
            if line.stage_attempt_id == attempt.id and line.side == ActaLineSide.ENTREGA
        ]
        recepcion_lines = [
            line for line in run.acta_lines
            if line.stage_attempt_id == attempt.id and line.side == ActaLineSide.RECEPCION
        ]
        if entrega_lines:
            attempt.unit_code = entrega_lines[0].unit_code
        entrega_total = sum((l.quantity for l in entrega_lines), Decimal("0"))
        recepcion_total = sum((l.quantity for l in recepcion_lines), Decimal("0"))

        attempt.status = StageAttemptStatus.APPROVED
        if entrega_total > 0:
            loss = max(Decimal("0"), entrega_total - recepcion_total)
            attempt.merma_weight = loss
            attempt.merma_percent = loss / entrega_total * Decimal("100")
            if loss > 0:
                from backend.modules.inventory.models import InventoryItem

                first_entrega = next((l for l in entrega_lines if l.item_id is not None), None)
                raw_material = (
                    self.repository.session.get(InventoryItem, first_entrega.item_id)
                    if first_entrega is not None else None
                )
                self.inventory_service.get_or_create_waste_item(
                    process_name=attempt.process_name,
                    quantity=loss,
                    unit_code=attempt.unit_code or "g",
                    material_type=(raw_material.material_type or raw_material.name) if raw_material else None,
                    purity=raw_material.purity if raw_material else None,
                    created_by_user_id=current_user.id,
                    stage_attempt_id=attempt.id,
                )

        attempt.finished_by_user_id = current_user.id
        attempt.finished_at = datetime.utcnow()
        self.repository.session.add(
            ProductionRunStageAttemptDecision(
                stage_attempt_id=attempt.id,
                decision="APROBADA",
                reason=None,
                decided_by_user_id=current_user.id,
                decided_at=datetime.utcnow(),
            )
        )
        self.repository.flush()
        return self._read_with_names(run)

    def reject_stage_attempt(
        self, attempt_id: UUID, payload: StageAttemptReject, current_user: CurrentUser
    ) -> ProductionRunRead:
        """✘: NO cierra el intento -- solo deja registro en la bitacora. El
        acta sigue editable y se puede volver a intentar (aprobar o
        rechazar de nuevo) despues de corregir."""
        attempt = self.repository.get_stage_attempt(attempt_id)
        if attempt is None:
            raise ProductionNotFoundError("Etapa no encontrada.")
        if attempt.status != StageAttemptStatus.IN_PROGRESS:
            raise ProductionDomainError("Solo se puede rechazar una etapa en curso.")
        run = attempt.run

        self.repository.session.add(
            ProductionRunStageAttemptDecision(
                stage_attempt_id=attempt.id,
                decision="RECHAZADA",
                reason=(payload.reason or "").strip() or None,
                decided_by_user_id=current_user.id,
                decided_at=datetime.utcnow(),
            )
        )
        self.repository.flush()
        return self._read_with_names(run)
```

(Importa `ProductionRunStageAttemptDecision` y `StageAttemptReject` en los
imports de módulo si no están ya.)

- [ ] **Step 11: `_attach_stage_attempts` debe traer `decisions`, y router**

Busca el método `_attach_stage_attempts` en `service.py`
(`grep -n "_attach_stage_attempts" backend/modules/production/service.py`)
y agrega, para cada `StageAttemptRead` construido, la asignación:

```python
read.decisions = [
    StageAttemptDecisionRead(
        decision=d.decision,
        reason=d.reason,
        decided_by_name=names.get(d.decided_by_user_id),
        decided_at=d.decided_at,
    )
    for d in self.repository.list_stage_attempt_decisions(attempt.id)
]
```

dentro del loop que ya arma cada `StageAttemptRead` (sigue el patrón que ya
usa ese método para `materials`/`acta_lines` — resuelve `names` con el mismo
mecanismo de `_resolve_user_names` que ya usa el resto del archivo para
`decided_by_user_id`).

En `backend/modules/production/router.py`, reemplaza el endpoint
`finish_stage_attempt` (import de `StageAttemptFinish` incluido) por:

```python
@router.post("/runs/stage-attempts/{attempt_id}/approve", response_model=ProductionRunRead)
def approve_stage_attempt(
    attempt_id: UUID,
    current_user: CurrentUser = Depends(get_current_user),
    service: ProductionService = Depends(get_production_service),
) -> ProductionRunRead:
    """Control de calidad universal: ✔ cierra la etapa y calcula la merma."""
    ensure_permission(current_user, "production.runs.update")
    try:
        return service.approve_stage_attempt(attempt_id, current_user)
    except ProductionNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except ProductionDomainError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc


@router.post("/runs/stage-attempts/{attempt_id}/reject", response_model=ProductionRunRead)
def reject_stage_attempt(
    attempt_id: UUID,
    payload: StageAttemptReject,
    current_user: CurrentUser = Depends(get_current_user),
    service: ProductionService = Depends(get_production_service),
) -> ProductionRunRead:
    """✘: no cierra la etapa, solo deja registro (motivo opcional)."""
    ensure_permission(current_user, "production.runs.update")
    try:
        return service.reject_stage_attempt(attempt_id, payload, current_user)
    except ProductionNotFoundError as exc:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)) from exc
    except ProductionDomainError as exc:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(exc)) from exc
```

Quita también el endpoint `allocate_stage_attempt_material` completo y el
import de `StageAttemptFinish` (reemplázalo por `StageAttemptReject` en el
bloque de imports de `schemas`).

- [ ] **Step 12: Correr el test del Step 8**

Run: `docker-compose exec api pytest backend/tests/production/test_stage_quality_control.py -v`
Expected: PASS todos.

- [ ] **Step 13: Arreglar el rename mecánico en los 5 archivos de test adicionales**

`test_admin_acta_line.py`, `test_stage_attempt_decisions.py`,
`test_revert_stage_attempt.py`, `test_cancel_run.py` y `test_acta_edit.py`
usan la forma vieja y van a fallar en colección/ejecución tras los Steps
1-12. Por cada uso:

- `StageAttemptCreate(..., product=StageAttemptProductTarget(target_item_id=X))`
  → `StageAttemptCreate(..., products=[StageAttemptProductLine(target_item_id=X, quantity=Decimal("1"))])`
  (usa `Decimal("1")` salvo que el test verifique el valor exacto del
  producto, en cuyo caso usa la cantidad que el test necesite).
- `production_service.finish_stage_attempt(id, StageAttemptFinish(product_quantity=Decimal(N)), user)`
  → si el test esperaba `APROBADA`: `production_service.approve_stage_attempt(id, user)`.
  → si el test esperaba `RECHAZADA` con motivo: `production_service.reject_stage_attempt(id, StageAttemptReject(reason=...), user)`
    — y AJUSTA la aserción: el intento queda `EN_PROCESO`, no `RECHAZADA`
    (la regla cambió, ver Step 10 — si el test dependía de que quedara
    cerrado tras el rechazo, esa aserción ya no aplica).

Corre cada archivo por separado hasta que pase:

```bash
docker-compose exec api pytest backend/tests/production/test_admin_acta_line.py backend/tests/production/test_stage_attempt_decisions.py backend/tests/production/test_revert_stage_attempt.py backend/tests/production/test_cancel_run.py backend/tests/production/test_acta_edit.py -v
```

Expected: PASS todos.

- [ ] **Step 14: Suite completa de producción**

Run: `docker-compose exec api pytest backend/tests/production -q`
Expected: PASS en todo, salvo `test_dynamic_flow.py` (tarea dedicada, ver
Task 6 más abajo — confirma que ES el único archivo que sigue fallando y
por qué, antes de continuar).

- [ ] **Step 15: Commit**

Uno o más commits está bien (ej. uno para el schema+start_stage_attempt,
otro para approve/reject+router, otro para los renames mecánicos de test)
-- lo que importa es que todos queden aplicados antes de reportar, ya que
el estado intermedio entre ellos no compila. Sugerido:

```bash
git add backend/modules/production/schemas.py backend/modules/production/service.py backend/modules/production/router.py backend/tests/production/test_stage_attempt_material.py backend/tests/production/test_stage_quality_control.py backend/tests/production/test_admin_acta_line.py backend/tests/production/test_stage_attempt_decisions.py backend/tests/production/test_revert_stage_attempt.py backend/tests/production/test_cancel_run.py backend/tests/production/test_acta_edit.py
git commit -m "feat(produccion): start_stage_attempt sin split + control de calidad universal (aprobar/rechazar) -- cambio atomico"
```

---

### Task 4: `add_admin_acta_line` — quita tope RECEPCION, exige motivo en ENTREGA post-arranque

**Files:**
- Modify: `backend/modules/production/schemas.py` (nada nuevo si Task 3 ya
  dejó `AdminActaLineCreate.note` como está — solo confirma que sigue
  siendo `str | None` opcional a nivel de tipo)
- Modify: `backend/modules/production/service.py`
- Test: `backend/tests/production/test_admin_acta_line.py`

**Interfaces:**
- Consumes: tope de stock de Task 2 (ya cubre ENTREGA automáticamente).
- Produces: `add_admin_acta_line` sin tope alguno para RECEPCION; exige
  `note` no vacío cuando `side == ENTREGA` y `stage_attempt_id is not None`.

- [ ] **Step 1: Test que falla — motivo obligatorio**

Agrega a `backend/tests/production/test_admin_acta_line.py`:

```python
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
```

- [ ] **Step 2: Correr, debe fallar**

Run: `docker-compose exec api pytest backend/tests/production/test_admin_acta_line.py -k requires_note -v`
Expected: FAIL (hoy `note` nunca es obligatorio).

- [ ] **Step 3: Quitar tope RECEPCION y agregar motivo obligatorio**

En `add_admin_acta_line`, ubica el bloque
`if payload.side == ActaLineSide.RECEPCION and payload.stage_attempt_id is not None:`
(el que valida `entregado`/`disponible`, ya reducido por la sesión anterior
a solo aplicar cuando `entregado > 0`). Reemplázalo por:

```python
        if payload.side == ActaLineSide.ENTREGA and payload.stage_attempt_id is not None:
            if not payload.note or not payload.note.strip():
                raise ProductionDomainError(
                    "Indica el motivo: esta linea se agrega despues de haber iniciado la etapa."
                )
```

(Esto BORRA por completo el chequeo de "no se devuelve materia prima"/
`entregado`/`disponible` para RECEPCION — ya no aplica ningun tope a
RECEPCION en ningun caso, y agrega el chequeo de motivo para ENTREGA.)

**Atencion:** esto también borra la validación
`"La materia prima no se devuelve por aca -- ya paso a formar parte del
producto resultante"`. Si quieres conservar esa regla (materia prima nunca
se recibe de vuelta), agrégala de nuevo como un chequeo aparte, ANTES del
bloque de arriba:

```python
        if payload.side == ActaLineSide.RECEPCION and item.item_type == "RAW_MATERIAL":
            raise ProductionDomainError(
                "La materia prima no se devuelve por aca -- ya paso a formar parte del producto resultante."
            )
```

(Confirma con el spec si esta regla se mantiene — sí, no está en la lista de
cosas eliminadas del spec de este sub-proyecto, solo se elimina el TOPE de
cantidad, no la prohibición de devolver materia prima.)

- [ ] **Step 4: Correr los tests**

Run: `docker-compose exec api pytest backend/tests/production/test_admin_acta_line.py -v`
Expected: PASS todos. Revisa si algún test viejo de esta suite asumía el
tope de RECEPCION (ej. `test_add_admin_acta_line_recepcion_caps_at_entregado_minus_recibido`,
de la sesión anterior) — ese test ya no aplica con esta regla nueva,
bórralo (el spec de este sub-proyecto elimina explícitamente ese tope).

- [ ] **Step 5: Commit**

```bash
git add backend/modules/production/service.py backend/tests/production/test_admin_acta_line.py
git commit -m "feat(produccion): RECEPCION sin tope de stock, ENTREGA post-arranque exige motivo (auditoria)"
```

---

### Task 5: Unifica edición/reversión/cancelación bajo `_apply_admin_acta_line_delta`

**Files:**
- Modify: `backend/modules/production/service.py`
- Test: `backend/tests/production/test_revert_stage_attempt.py`
- Test: `backend/tests/production/test_admin_acta_line.py` (edición de líneas PLAN)

**Interfaces:**
- Consumes: todo lo anterior.
- Produces: `update_acta_line`/`delete_acta_line`/`revert_stage_attempt`/
  `_cancel_run_core` generalizados (ver addendum del spec).

- [ ] **Step 1: Test que falla — editar una línea PLAN mueve stock**

Agrega a `backend/tests/production/test_admin_acta_line.py`:

```python
def test_update_acta_line_plan_line_moves_stock(
    db_session, production_service, current_user, process, raw_material, target_complement
):
    """Una linea PLAN (Entrada/Producto de start_stage_attempt) se edita
    igual que una ADMIN_STOCK -- el stock se ajusta al delta."""
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

    from backend.modules.production.schemas import ActaLineUpdate

    production_service.update_acta_line(entrega_line.id, ActaLineUpdate(quantity=Decimal("70")), current_user)

    db_session.refresh(raw_material)
    assert raw_material.current_stock == Decimal("30")  # 100 - 70
```

- [ ] **Step 2: Correr, debe fallar**

Run: `docker-compose exec api pytest backend/tests/production/test_admin_acta_line.py::test_update_acta_line_plan_line_moves_stock -v`
Expected: FAIL (`current_stock` queda en 50, no en 30 — hoy `update_acta_line`
no mueve inventario para líneas `PLAN`).

- [ ] **Step 3: Arreglar `update_acta_line`**

Reemplaza el método completo (usa
`grep -n "def update_acta_line" backend/modules/production/service.py` para
ubicarlo exacto) por:

```python
    def update_acta_line(self, line_id: UUID, payload: ActaLineUpdate, current_user: CurrentUser) -> ProductionRunRead:
        """Edita una linea existente. Si esta enlazada a un item real
        (cualquier source: PLAN, AUTO o ADMIN_STOCK), el cambio de cantidad
        mueve inventario -- editable "tal y como si se hubiera agregado
        desde el Agregar" (Rodrigo, 2026-08-20). Solo las lineas MANUAL sin
        item_id son texto puro, sin efecto en stock."""
        line = self.repository.get_acta_line(line_id)
        if line is None:
            raise ProductionNotFoundError("Linea de acta no encontrada.")

        if line.source == ActaLineSource.ADMIN_STOCK:
            if line.stage_attempt_id is None and current_user.role not in {"admin", "Admin"}:
                raise ProductionDomainError("Solo el administrador puede editar una linea enlazada a inventario.")
            if payload.label is not None or payload.unit_code is not None:
                raise ProductionDomainError(
                    "Esta linea esta enlazada a un item de inventario: el detalle y la unidad no se editan a mano."
                )

        if line.item_id is not None:
            if payload.quantity is not None:
                self._apply_admin_acta_line_delta(line, payload.quantity, current_user)
                line.quantity = payload.quantity
            if payload.note is not None:
                line.note = payload.note.strip() or None
            self.repository.flush()
            return self._read_with_names(line.run)

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

Borra el método `_acta_line_max_quantity` completo (código muerto tras
esto — confirma con `grep -rn "_acta_line_max_quantity" backend/` que nada
más lo usa antes de borrar).

- [ ] **Step 4: Correr el test del Step 1**

Run: `docker-compose exec api pytest backend/tests/production/test_admin_acta_line.py -v`
Expected: PASS todos.

- [ ] **Step 5: Test que falla — revertir un intento con producto resultante**

Agrega a `backend/tests/production/test_revert_stage_attempt.py` (sigue el
patrón de fixtures que ya usa ese archivo):

```python
def test_revert_stage_attempt_reverts_producto_resultante(
    db_session, production_service, current_user, process, target_complement
):
    from backend.modules.production.schemas import ProductionOrderCreate, StageAttemptCreate, StageAttemptProductLine

    order = production_service.create_order(ProductionOrderCreate(name="Orden revert producto"), current_user)
    result = production_service.start_stage_attempt(
        order.id,
        StageAttemptCreate(
            process_id=process.id,
            responsable_name="Ana",
            products=[StageAttemptProductLine(target_item_id=target_complement.id, quantity=Decimal("5"))],
        ),
        current_user,
    )
    attempt_id = result.stage_attempts[0].id
    db_session.refresh(target_complement)
    assert target_complement.current_stock == Decimal("5")

    production_service.approve_stage_attempt(attempt_id, current_user)
    production_service.revert_stage_attempt(attempt_id, current_user, "prueba")

    db_session.refresh(target_complement)
    assert target_complement.current_stock == Decimal("0")
```

(Ajusta el import de `Decimal` si el archivo no lo tiene ya arriba.)

- [ ] **Step 6: Correr, debe fallar**

Run: `docker-compose exec api pytest backend/tests/production/test_revert_stage_attempt.py::test_revert_stage_attempt_reverts_producto_resultante -v`
Expected: FAIL (`reverse_stage_attempt_product` es no-op sin lote, el stock
del producto queda en 5 en vez de volver a 0).

- [ ] **Step 7: Simplificar `revert_stage_attempt`**

En el método `revert_stage_attempt`, reemplaza el bloque:

```python
        try:
            for line in lines:
                if line.item_id is None:
                    continue
                if line.source == ActaLineSource.ADMIN_STOCK:
                    self._apply_admin_acta_line_delta(line, Decimal("0"), current_user)
                elif line.side == ActaLineSide.ENTREGA and line.source in (ActaLineSource.PLAN, ActaLineSource.AUTO):
                    self.inventory_service.create_movement(
                        InventoryMovementCreate(
                            item_id=line.item_id,
                            movement_type="REVERSION_PRODUCCION",
                            quantity=line.quantity,
                            reason=revert_reason,
                            reference_type="production_run",
                            reference_id=run.id,
                        ),
                        user_id=current_user.id,
                    )
                elif line.side == ActaLineSide.RECEPCION and line.source == ActaLineSource.PLAN:
                    self.inventory_service.reverse_stage_attempt_product(
                        run_id=run.id,
                        target_id=line.item_id,
                        quantity=line.quantity,
                        user_id=current_user.id,
                        reason=revert_reason,
                    )
```

por:

```python
        try:
            for line in lines:
                if line.item_id is not None:
                    self._apply_admin_acta_line_delta(line, Decimal("0"), current_user)
```

(La línea `revert_reason` de arriba queda sin uso en este bloque -- déjala
si `reverse_waste_item`, más abajo en el mismo método, la sigue usando;
confírmalo antes de borrarla.)

- [ ] **Step 8: Correr el test del Step 5**

Run: `docker-compose exec api pytest backend/tests/production/test_revert_stage_attempt.py -v`
Expected: PASS todos (revisa que los tests viejos de este archivo, que
prueban revertir Entrada/materia prima consumida por `start_stage_attempt`,
sigan pasando -- ahora esas líneas también son `_apply_admin_acta_line_delta`
desde adentro, así que deberían revertir igual).

- [ ] **Step 9: Generalizar `_cancel_run_core`/`_revert_admin_stock_lines`**

Renombra `_revert_admin_stock_lines` a `_revert_item_linked_lines` (o deja
el nombre si prefieres no tocar el nombre del método, con tal de ampliar el
filtro) y cambia su cuerpo:

```python
    def _revert_admin_stock_lines(self, run: ProductionRun, current_user: CurrentUser) -> None:
        """Revierte cualquier linea con item real (PLAN, AUTO o ADMIN_STOCK)
        -- para ordenes del flujo viejo esto es un no-op para sus lineas PLAN
        (esas referencian el movimiento por run.id via
        consume_material_for_production, no por linea; ver
        _apply_admin_acta_line_delta, que calcula net_so_far=0 y no hace
        nada)."""
        for line in run.acta_lines:
            if line.item_id is not None:
                if self.inventory_service is None:
                    raise ProductionDomainError(
                        "Inventario no esta disponible para revertir el consumo de esta orden."
                    )
                self._apply_admin_acta_line_delta(line, Decimal("0"), current_user)
```

(Solo cambia la condición `line.source == ActaLineSource.ADMIN_STOCK and
line.item_id is not None` por `line.item_id is not None`; el resto del
cuerpo y el nombre del método no cambian, para no tener que tocar su único
caller en `_cancel_run_core`.)

- [ ] **Step 10: Suite completa de producción**

Run: `docker-compose exec api pytest backend/tests/production -q`
Expected: PASS completo (salvo `test_dynamic_flow.py`, que es Task 6).

- [ ] **Step 11: Commit**

```bash
git add backend/modules/production/service.py backend/tests/production/test_revert_stage_attempt.py backend/tests/production/test_admin_acta_line.py
git commit -m "fix(produccion): unifica edicion/reversion/cancelacion de lineas de acta bajo _apply_admin_acta_line_delta"
```

---

### Task 6: `test_dynamic_flow.py` y suite completa verde

**Files:**
- Modify: `backend/tests/production/test_dynamic_flow.py`

**Interfaces:**
- Consumes: todo lo anterior.
- Produces: nada nuevo — solo deja la suite completa en verde.

- [ ] **Step 1: Ver qué falla**

Run: `docker-compose exec api pytest backend/tests/production/test_dynamic_flow.py -v 2>&1 | tail -60`

- [ ] **Step 2: Ajustar cada uso roto**

Por cada `StageAttemptCreate(..., product=StageAttemptProductTarget(...))`,
cambia a
`StageAttemptCreate(..., products=[StageAttemptProductLine(..., quantity=Decimal("N"))])`
(elige una cantidad razonable acorde al test, ej. `Decimal("1")` si el test
no verifica el valor del producto). Por cada
`production_service.finish_stage_attempt(id, StageAttemptFinish(...), user)`,
cambia a `production_service.approve_stage_attempt(id, user)` (si el test
esperaba `RECHAZADA`, usa `reject_stage_attempt(id, StageAttemptReject(reason=...), user)`
y ajusta la aserción: el intento queda `EN_PROCESO`, no `RECHAZADA` — si el
test dependía de que quedara cerrado tras el rechazo, esa aserción ya no
aplica bajo la regla nueva y debe actualizarse para reflejarla).

- [ ] **Step 3: Correr hasta que pase**

Run: `docker-compose exec api pytest backend/tests/production/test_dynamic_flow.py -v`
Expected: PASS todos.

- [ ] **Step 4: Suite completa del backend**

Run: `docker-compose exec api pytest -q 2>&1 | tail -40`
Expected: PASS completo (toda la suite, no solo `production/`) — confirma
que nada en `inventory`/`reportes`/otros módulos dependía de algo que este
plan tocó (`_apply_admin_acta_line_delta`, `update_acta_line`,
`revert_stage_attempt`, `_cancel_run_core`).

- [ ] **Step 5: Commit**

```bash
git add backend/tests/production/test_dynamic_flow.py
git commit -m "test(produccion): actualiza test_dynamic_flow.py al nuevo schema de products/approve-reject"
```

---

### Task 7: Frontend — lib de API

**Files:**
- Modify: `frontend/lib/production-api.ts`

**Interfaces:**
- Consumes: endpoints de Task 3 (`approve`/`reject`) y schema de Task 3
  (`products`).
- Produces: `approveStageAttempt(attemptId)`, `rejectStageAttempt(attemptId, {reason})`,
  `startStageAttempt(runId, payload)` con `products` en vez de `product`.

- [ ] **Step 1: Ubicar las funciones actuales**

```bash
grep -n "finishStageAttempt\|allocateStageAttemptMaterial\|startStageAttempt" frontend/lib/production-api.ts
```

- [ ] **Step 2: Reemplazar**

Cambia la firma de `startStageAttempt` para que su payload use
`products: Array<{ product_type_id?: string | null; target_item_id?: string | null; material_code?: string | null; quantity: string }>`
en vez de `product: {...}` (mismo tipo que ya tenga `product_type_id`/`target_item_id`,
solo pasa a ser un array con `quantity` agregado por línea).

Reemplaza la función `finishStageAttempt(...)` por:

```typescript
export function approveStageAttempt(attemptId: string) {
  return apiRequest<ProductionRun>(`/api/production/runs/stage-attempts/${attemptId}/approve`, {
    method: "POST",
  });
}

export function rejectStageAttempt(attemptId: string, payload: { reason?: string | null }) {
  return apiRequest<ProductionRun>(`/api/production/runs/stage-attempts/${attemptId}/reject`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}
```

Borra `allocateStageAttemptMaterial(...)` por completo.

- [ ] **Step 3: Build**

Run: `docker-compose exec web npm run build 2>&1 | tail -60`
Expected: errores de TypeScript en `production-dashboard.tsx` por los
nombres/formas que cambiaron aquí (`finishStageAttempt`,
`allocateStageAttemptMaterial`, `product:` en vez de `products:`) — eso es
esperado, Task 8 los arregla. Anota la lista de errores para Task 8.

- [ ] **Step 4: Commit**

```bash
git add frontend/lib/production-api.ts
git commit -m "feat(produccion): approveStageAttempt/rejectStageAttempt reemplazan finishStageAttempt; products como lista"
```

---

### Task 8: Frontend — Entrada/Producto multi-línea, ✓/✗ universal, quita checkbox QC

**Files:**
- Modify: `frontend/components/production/production-dashboard.tsx`

**Interfaces:**
- Consumes: Task 7 (`approveStageAttempt`/`rejectStageAttempt`,
  `startStageAttempt` con `products`).
- Produces: UI actualizada; no expone nada a otras tareas.

**Nota para quien ejecute esta tarea:** este archivo tiene ~4-5k líneas.
Antes de tocar nada, corre:

```bash
grep -n "isStageMaterialPickerOpen\|stagePickerPendingItem\|recepcionPendingRow\|runQuantity\|quality_control\|allocateStageAttemptMaterial\|finishStageAttempt\|requiresQuality\|PENDIENTE_MATERIAL" frontend/components/production/production-dashboard.tsx
```

para ubicar cada punto exacto (los números de línea habrán cambiado desde
que se escribió este plan). Lee cada bloque completo antes de editarlo — no
apliques los diffs de abajo a ciegas por número de línea.

- [ ] **Step 1: Quitar el checkbox de control de calidad**

En el formulario de crear/editar proceso, quita el campo/checkbox
"Control de calidad" del JSX y del estado `form.qualityControl`. En el
payload que arma `quality_control: form.qualityControl` (buscado arriba),
cambia a `quality_control: true` fijo (o quita el campo del payload si el
backend ya lo ignora — pero el modelo `ProductionProcess.quality_control`
sigue existiendo en este plan, así que envíalo siempre `true` para que
procesos nuevos queden consistentes con los viejos que ya lo tengan
`true`).

- [ ] **Step 2: Entrada como lista editable**

Donde hoy el formulario de "iniciar etapa" tiene un único picker de
"materia prima" (`isStageMaterialPickerOpen`/`stagePickerPendingItem`/
`stagePickerQuantity`), cambia el estado de "un item pendiente" a un array:
`const [entradaLines, setEntradaLines] = useState<Array<{ item: InventoryItem; quantity: string }>>([])`.
Agrega un botón "+ Agregar entrada" que abre el mismo `MaterialCategoryPicker`
ya usado (mismos `allowedTypes`, mismo `items`), y al elegir un item +
cantidad, hace `setEntradaLines((prev) => [...prev, { item, quantity }])` en
vez de guardar un solo pendiente. Renderiza la lista con un botón "Quitar"
por fila (`setEntradaLines((prev) => prev.filter((_, i) => i !== index))`).
Al armar el payload de `startStageAttempt`, mapea
`entradaLines.map((l) => ({ item_id: l.item.id, quantity: l.quantity }))`
a `materials`.

- [ ] **Step 3: Producto resultante como lista editable**

Mismo patrón que el Step 2 pero para productos: reemplaza el botón único
"Producto resultante" (`orderProduct`/`itemPickerFor`) por una lista
`productoLines: Array<{ target: {productTypeId?, targetItemId?}, materialCode?: string, quantity: string }>`.
Reusa el picker de producto ya existente (`FinishedItemPicker`/
`CatalogProductPicker` + el flujo de creación de pieza sin stock que ya
existe en `AdminAddActaLineControl` para pedir material+unidad cuando el
destino es un `product_type_id` sin item todavía) para elegir destino +
cantidad por fila. Exige mínimo 1 fila antes de habilitar "Iniciar etapa".
Al armar el payload, mapea cada fila a
`{ target_item_id, product_type_id, material_code, quantity }` (`products`).

- [ ] **Step 4: Quitar `recepcionPendingRow`/`runQuantity`**

Busca dónde `OrdenProduccionDoc`/`ActaSide` recibe `recepcionPendingRow`
(la fila de "cantidad final del producto" que hoy se pide en el acta de la
etapa corriendo) y quita esa prop y el estado `runQuantity`/`setRunQuantity`
que la alimentaba — ya no hace falta, el producto resultante ya está en el
acta desde que se inicia la etapa (Task 3).

- [ ] **Step 5: Botones ✓/✗ universales**

Donde hoy se decide entre "Finalizar etapa" (proceso sin `quality_control`)
y Aprobado/Denegado (con `quality_control`) — busca el bloque que arranca
en `const requiresQuality = attemptProcess?.quality_control ?? false;` —
reemplázalo por dos botones siempre visibles:

```tsx
<div className="modalActions">
  <button
    className="button buttonPrimary"
    disabled={isSaving}
    onClick={() => void handleApproveStageAttempt(runningAttempt.id)}
    type="button"
  >
    <Check aria-hidden="true" size={16} />
    Aprobar
  </button>
  <button
    className="button buttonDanger"
    disabled={isSaving}
    onClick={() => setRejectingAttemptId(runningAttempt.id)}
    type="button"
  >
    <X aria-hidden="true" size={16} />
    Rechazar
  </button>
</div>
```

`handleApproveStageAttempt` llama `approveStageAttempt(attemptId)` +
`refreshDynamicOrder()` + `setSuccess(...)`, con manejo de error igual al
resto del archivo (`try/catch` -> `setError`). `rejectingAttemptId` abre un
modal simple con un `<textarea>`/`<input>` de motivo (opcional) y un botón
"Confirmar rechazo" que llama `rejectStageAttempt(attemptId, { reason })` +
`refreshDynamicOrder()` — **no** cierra la vista de la etapa (a diferencia
de aprobar, que sí puede volver a la lista ya que el intento queda
cerrado).

- [ ] **Step 6: Quitar UI de "Asignar material disponible"/`PENDIENTE_MATERIAL`**

Busca cualquier botón/rama que llame `allocateStageAttemptMaterial` o
renderice distinto para `status === "PENDIENTE_MATERIAL"` en la vista de
etapas, y quítalo (ya no puede ocurrir ese estado para intentos nuevos).

- [ ] **Step 7: Build**

Run: `docker-compose exec web npm run build 2>&1 | tail -80`
Expected: build limpio, sin errores de TypeScript ni variables sin usar.

- [ ] **Step 8: Commit**

```bash
git add frontend/components/production/production-dashboard.tsx
git commit -m "feat(produccion): Entrada/Producto resultante como listas editables, boton Aprobar/Rechazar universal"
```

---

### Task 9: Verificación final

**Files:** ninguno.

- [ ] **Step 1: Backend completo**

Run: `docker-compose exec api pytest -q`
Expected: PASS completo, 0 failed.

- [ ] **Step 2: Frontend build**

Run: `docker-compose exec web npm run build`
Expected: build limpio.

- [ ] **Step 3: Smoke manual (deja esto para Rodrigo, no lo ejecutes tú)**

Documenta en el mensaje final estos pasos para que Rodrigo los pruebe:
1. Crear orden, iniciar etapa con 2 Entradas + 2 Productos resultantes —
   confirmar que ambos lados del acta ya muestran las líneas con stock
   movido de inmediato.
2. Intentar una Entrada por encima del stock disponible — debe bloquear
   nombrando el disponible real.
3. Rechazar (✗) con motivo — confirmar que la etapa sigue editable (no se
   cierra) y que el motivo quedó en la bitácora (aunque la vista de
   auditoría en sí es sub-proyecto C, aparte).
4. Aprobar (✓) — confirmar que la merma se calculó de los totales del acta.
5. Agregar una Entrada de más por "Agregar" sin motivo — debe bloquear;
   con motivo — debe pasar.
6. Crear un proceso nuevo — confirmar que ya no aparece el checkbox de
   control de calidad.
7. Editar la cantidad de una línea de Entrada ya cargada — confirmar que
   el stock del item se ajusta al nuevo valor.

No hay commit para esta tarea.
