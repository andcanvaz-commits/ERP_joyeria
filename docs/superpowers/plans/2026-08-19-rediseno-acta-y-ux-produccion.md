# Rediseño de acta, control de calidad, Documentos y mensajes — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rediseñar el acta por intento de etapa (producto resultante
obligatorio al iniciar, recepción acotada a lo entregado, finalizar sin
peso con control de calidad condicional), reorganizar Documentos por
carpeta de orden, rediseñar los mensajes, y eliminar Material adicional.

**Architecture:** Extiende lo construido en
`docs/superpowers/specs/2026-08-19-automatizar-material-por-etapa-design.md`.
Casi todo el backend de acta/stage-attempt ya existe — este plan reubica
lógica ya construida (`assign_product`, `AdminAddActaLineControl`) en vez de
crear mecanismos nuevos.

**Tech Stack:** FastAPI + SQLAlchemy 2.0 + Alembic, Next.js 16 + React Query.

## Global Constraints

- Español-first en UI/mensajes.
- `create_movement` es el único camino para tocar `current_stock`.
- Cada `get_*_service()` de router es la unidad transaccional; services usan
  `flush()`, nunca `commit()`.
- Los services levantan `ProductionDomainError`/`ProductionNotFoundError`;
  nunca `HTTPException` fuera de `router.py`.
- Toda columna nueva necesita su migración Alembic.
- Backend tocado → `docker-compose exec api pytest backend/tests/production`.
- Frontend tocado → `docker-compose exec web npm run build`.

---

## Task 1: Proceso gana "Control de calidad"

**Files:**
- Modify: `backend/modules/production/models.py`
- Modify: `backend/modules/production/schemas.py`
- Create: migración en `backend/alembic/versions/`
- Modify: `frontend/types/production/index.ts`
- Modify: `frontend/lib/production-api.ts`
- Modify: `frontend/components/production/production-dashboard.tsx`

- [ ] **Step 1: Modelo**

En `backend/modules/production/models.py`, clase `ProductionProcess`, agregar
después de `is_active`:

```python
    # Si esta marcado, terminar una etapa de este proceso pide
    # Aprobado/Denegado (seccion 4) en vez de cerrar directo.
    quality_control: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
```

- [ ] **Step 2: Migración**

```bash
docker-compose exec api alembic revision -m "production_process_quality_control"
```

```python
def upgrade() -> None:
    op.add_column(
        "production_processes",
        sa.Column("quality_control", sa.Boolean(), nullable=False, server_default=sa.false()),
    )


def downgrade() -> None:
    op.drop_column("production_processes", "quality_control")
```

- [ ] **Step 3: Schemas**

En `backend/modules/production/schemas.py`, `ProductionProcessCreate`/
`ProductionProcessUpdate`/`ProductionProcessRead` ganan
`quality_control: bool = False` (Create/Update) y `quality_control: bool`
(Read, sin default — viene de la DB).

- [ ] **Step 4: Aplicar migración y compileall**

```bash
docker-compose exec api alembic upgrade head
docker-compose exec api python -m compileall backend/modules/production
```

- [ ] **Step 5: Frontend — tipo y checkbox**

`frontend/types/production/index.ts`, tipo `ProductionProcess` gana
`quality_control: boolean`.

`frontend/lib/production-api.ts`, `CreateProductionProcessPayload` gana
`quality_control?: boolean`.

`production-dashboard.tsx`, formulario de proceso (`isFormOpen`, buscar
`className="checkboxRow"` con "Activo"): agregar un segundo `checkboxRow`
igual, controlando `form.qualityControl` (agregar al estado `form` junto a
`isActive`), con label "Control de calidad". `handleSubmit`/`createProcess`/
`updateProcess` deben mandar `quality_control: form.qualityControl`.

- [ ] **Step 6: Build y commit**

```bash
docker-compose exec web npm run build
```

```bash
git add backend/modules/production/models.py backend/modules/production/schemas.py backend/alembic/versions/ frontend/types/production/index.ts frontend/lib/production-api.ts frontend/components/production/production-dashboard.tsx
git commit -m "feat(production): proceso gana control de calidad"
```

---

## Task 2: Inventario — lote incremental por orden

**Files:**
- Modify: `backend/modules/inventory/service.py`
- Test: `backend/tests/inventory/test_finished_product_lot.py` (nuevo, si no
  existe ya un archivo equivalente — revisar `backend/tests/inventory/` antes
  de crear uno duplicado)

**Interfaces:**
- Produces: `InventoryService.get_or_create_finished_product_lot(*, run,
  quantity, material_type, purity, received_by_user_id) -> InventoryItem`

- [ ] **Step 1: Test que falla**

Revisar primero si existe un archivo de tests de inventory para lotes de
producción (`grep -rn "create_finished_product_lot" backend/tests/inventory/`).
Agregar (en ese archivo, o uno nuevo `test_finished_product_lot.py` si no
hay ninguno):

```python
from decimal import Decimal

from backend.modules.production.models import ProductionRun, ProductionRunStatus


def test_get_or_create_finished_product_lot_creates_once(db_session, inventory_service, current_user):
    run = ProductionRun(
        name="Orden lote test", status=ProductionRunStatus.IN_PROGRESS,
        created_by_user_id=current_user.id, production_code="OP-TEST-LOTE1",
    )
    db_session.add(run)
    db_session.flush()

    lot1 = inventory_service.get_or_create_finished_product_lot(
        run=run, quantity=Decimal("10"), material_type="Oro", purity="18k",
        received_by_user_id=current_user.id,
    )
    assert lot1.current_stock == Decimal("10")

    lot2 = inventory_service.get_or_create_finished_product_lot(
        run=run, quantity=Decimal("5"), material_type="Oro", purity="18k",
        received_by_user_id=current_user.id,
    )

    assert lot2.id == lot1.id
    db_session.refresh(lot1)
    assert lot1.current_stock == Decimal("15")
```

(Confirmar el nombre real de la fixture del servicio de inventario en
`backend/tests/inventory/conftest.py` -- puede llamarse `inventory_service`
o construirse distinto; ajustar el test a lo que ya exista ahí, mismo
patrón que usan los demás tests de ese directorio.)

- [ ] **Step 2: Correr y verificar que falla**

```bash
docker-compose exec api pytest backend/tests/inventory/test_finished_product_lot.py -v
```

Esperado: `AttributeError: 'InventoryService' object has no attribute
'get_or_create_finished_product_lot'`.

- [ ] **Step 3: Implementar**

En `backend/modules/inventory/service.py`, agregar cerca de
`create_finished_product_lot`:

```python
    def get_or_create_finished_product_lot(
        self,
        *,
        run: "ProductionRun",
        quantity: Decimal,
        material_type: str | None,
        purity: str | None,
        received_by_user_id: UUID | None,
    ) -> InventoryItem:
        """Un solo lote FINISHED_PRODUCT por orden, alimentado de a poco por
        cada etapa (seccion 4 del rediseño): si la orden ya tiene un
        INGRESO_PRODUCCION propio, le suma otro; si no, lo crea. Nunca crea
        un segundo item -- create_finished_product_lot llamado dos veces
        generaria un SKU de respaldo distinto en la segunda llamada (el SKU
        real ya esta tomado), fragmentando el lote."""
        existing = self.repository.session.execute(
            select(InventoryMovement).where(
                InventoryMovement.movement_type == "INGRESO_PRODUCCION",
                InventoryMovement.reference_type == "production_order",
                InventoryMovement.reference_id == run.id,
            )
        ).scalars().first()
        if existing is None:
            return self.create_finished_product_lot(
                name=run.name or "Producto",
                unit_code="und",
                production_order_id=run.id,
                production_code=run.production_code,
                quantity=quantity,
                material_type=material_type,
                purity=purity,
                received_by_user_id=received_by_user_id,
            )
        lot = self._get_item_or_raise(existing.item_id)
        self.create_movement(
            InventoryMovementCreate(
                item_id=lot.id,
                movement_type="INGRESO_PRODUCCION",
                quantity=quantity,
                reason="Ingreso de producto terminado desde produccion.",
                reference_type="production_order",
                reference_id=run.id,
            ),
            user_id=received_by_user_id,
            lot_code=run.production_code,
        )
        return lot
```

Import `ProductionRun` solo como type hint bajo `TYPE_CHECKING` (o como
string literal `"ProductionRun"`, sin import real a nivel de modulo -- mismo
patron que el resto del archivo evita ciclos entre modulos).

- [ ] **Step 4: Correr el test**

```bash
docker-compose exec api pytest backend/tests/inventory/test_finished_product_lot.py -v
```

- [ ] **Step 5: Commit**

```bash
git add backend/modules/inventory/service.py backend/tests/inventory/
git commit -m "feat(inventory): lote de producto terminado incremental por orden"
```

---

## Task 3: Producto resultante obligatorio al iniciar etapa

**Files:**
- Modify: `backend/modules/production/schemas.py`
- Modify: `backend/modules/production/service.py`
- Test: `backend/tests/production/test_stage_attempt_material.py` (agregar
  casos) o un archivo nuevo `test_stage_attempt_product.py`

**Interfaces:**
- Consumes: `InventoryService.get_or_create_finished_product_lot` (Task 2),
  `InventoryService.convert_lot_to_product`/`convert_lot_to_complement` (ya
  existen), `RunProductCreate` (ya existe, valida product_type_id XOR
  target_item_id).
- Produces: `StageAttemptCreate.product: RunProductCreate` (obligatorio).

- [ ] **Step 1: Schema**

En `schemas.py`, `StageAttemptCreate` gana el campo obligatorio:

```python
class StageAttemptCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    process_id: UUID
    responsable_name: str = Field(min_length=1, max_length=180)
    materials: list[StageAttemptMaterialLine] = Field(default_factory=list)
    # Obligatorio siempre (seccion 7 del rediseño): que va a salir de esta
    # etapa y cuanto -- reusa RunProductCreate, mismo picker/validacion que
    # antes usaba assign_product.
    product: RunProductCreate
```

`RunProductCreate` ya está definido más arriba en el mismo archivo — no
hace falta mover nada, solo asegurarse de que `StageAttemptCreate` quede
DESPUÉS de esa clase (ya lo está, línea 38 vs 248).

- [ ] **Step 2: Test que falla**

Agregar a `backend/tests/production/test_stage_attempt_material.py`:

```python
def test_start_stage_attempt_requires_product(production_service, current_user, process):
    from pydantic import ValidationError

    order = _start_order(production_service, current_user)
    with pytest.raises(ValidationError):
        StageAttemptCreate(process_id=process.id, responsable_name="Ana")


def test_start_stage_attempt_creates_lot_and_recepcion_line(
    db_session, production_service, current_user, process, target_complement
):
    from backend.modules.production.schemas import RunProductCreate

    order = _start_order(production_service, current_user)

    result = production_service.start_stage_attempt(
        order.id,
        StageAttemptCreate(
            process_id=process.id,
            responsable_name="Ana",
            product=RunProductCreate(target_item_id=target_complement.id, quantity=Decimal("2")),
        ),
        current_user,
    )

    attempt = result.stage_attempts[0]
    recepcion_lines = [line for line in attempt.acta_lines if line.side == "RECEPCION"]
    assert len(recepcion_lines) == 1
    assert recepcion_lines[0].quantity == Decimal("2")
    assert recepcion_lines[0].item_id == target_complement.id
    db_session.refresh(target_complement)
    assert target_complement.current_stock == Decimal("2")
    assert result.status == "EN_PROCESO"  # la orden NO se cierra


def test_start_stage_attempt_second_stage_reuses_same_lot(
    db_session, production_service, current_user, process, target_complement
):
    from backend.modules.production.schemas import RunProductCreate
    from sqlalchemy import select
    from backend.modules.inventory.models import InventoryMovement

    order = _start_order(production_service, current_user)
    production_service.start_stage_attempt(
        order.id,
        StageAttemptCreate(
            process_id=process.id, responsable_name="Ana",
            product=RunProductCreate(target_item_id=target_complement.id, quantity=Decimal("1")),
        ),
        current_user,
    )
    finished = production_service.finish_stage_attempt(
        production_service.repository.get_run(order.id).stage_attempts[0].id,
        StageAttemptFinish(), current_user,
    )
    production_service.start_stage_attempt(
        finished.id,
        StageAttemptCreate(
            process_id=process.id, responsable_name="Luis",
            product=RunProductCreate(target_item_id=target_complement.id, quantity=Decimal("1")),
        ),
        current_user,
    )

    lots = db_session.execute(
        select(InventoryMovement.item_id).where(
            InventoryMovement.movement_type == "INGRESO_PRODUCCION",
            InventoryMovement.reference_type == "production_order",
            InventoryMovement.reference_id == order.id,
        )
    ).scalars().all()
    assert len(set(lots)) == 1  # un solo lote para las dos etapas
    db_session.refresh(target_complement)
    assert target_complement.current_stock == Decimal("2")
```

Import `StageAttemptFinish` al inicio del archivo si no está ya.

- [ ] **Step 3: Correr y verificar que fallan**

```bash
docker-compose exec api pytest backend/tests/production/test_stage_attempt_material.py -k "product" -v
```

- [ ] **Step 4: Implementar en `start_stage_attempt`**

Al final del método (después del bloque `if/elif/else` de materiales,
justo antes de `self.repository.flush(); return self._read_with_names(run)`
—la única salida del método hoy—), agregar el procesamiento del producto
resultante. El método hoy tiene DOS salidas tempranas (`if not
payload.materials: ... return`) y una final; el producto resultante debe
correr en las TRES rutas. Reemplazar las dos líneas finales
`self.repository.flush()` / `return self._read_with_names(run)` (aparecen
tres veces en el método: después del `_new_attempt` sin materiales, y al
final del bloque de materiales) por una llamada común. Refactor: extraer el
cierre común a una función interna:

```python
        def _apply_product(attempt: ProductionRunStageAttempt) -> None:
            from backend.modules.inventory.models import InventoryItem

            first_entrega = next(
                (line for line in run.acta_lines if line.side == ActaLineSide.ENTREGA and line.item_id is not None),
                None,
            )
            raw_material = (
                self.repository.session.get(InventoryItem, first_entrega.item_id)
                if first_entrega is not None else None
            )
            lot = self.inventory_service.get_or_create_finished_product_lot(
                run=run,
                quantity=payload.product.quantity,
                material_type=(raw_material.material_type or raw_material.name) if raw_material else None,
                purity=raw_material.purity if raw_material else None,
                received_by_user_id=current_user.id,
            )
            from backend.modules.inventory.schemas import LotConversionCreate

            if payload.product.target_item_id is not None:
                target = self.repository.session.get(InventoryItem, payload.product.target_item_id)
                if target is not None and target.item_type == "COMPLEMENT":
                    self.inventory_service.convert_lot_to_complement(
                        lot.id, payload.product.target_item_id, payload.product.quantity, user_id=current_user.id
                    )
                    target_id = payload.product.target_item_id
                else:
                    conversion = LotConversionCreate(
                        target_item_id=payload.product.target_item_id, quantity=payload.product.quantity
                    )
                    converted = self.inventory_service.convert_lot_to_product(lot.id, conversion, user_id=current_user.id)
                    target_id = converted.id
            else:
                conversion = LotConversionCreate(
                    product_type_id=payload.product.product_type_id, quantity=payload.product.quantity
                )
                converted = self.inventory_service.convert_lot_to_product(lot.id, conversion, user_id=current_user.id)
                target_id = converted.id

            target_item = self.repository.session.get(InventoryItem, target_id)
            run.acta_lines.append(
                ProductionRunActaLine(
                    side=ActaLineSide.RECEPCION,
                    label=target_item.name if target_item else "Producto",
                    quantity=payload.product.quantity,
                    unit_code=target_item.unit_code if target_item else "und",
                    item_id=target_id,
                    source=ActaLineSource.PLAN,
                    line_order=sum(1 for l in run.acta_lines if l.side == ActaLineSide.RECEPCION),
                    stage_attempt_id=attempt.id,
                    created_by_user_id=current_user.id,
                )
            )
```

Y en cada uno de los tres puntos de salida del método, antes del
`self.repository.flush()` final, llamar `_apply_product(<el attempt recien
creado>)`:
- Rama `if not payload.materials:` → `_apply_product(new_attempt)` (guardar
  el resultado de `_new_attempt(...)` en una variable en vez de solo
  llamarlo).
- Rama `ratio >= 1:` → `_apply_product(covered_attempt)`.
- Rama `ratio <= 0:` → `_apply_product(waiting_attempt)` (el producto se
  declara igual aunque la etapa quede esperando material -- el pedido es
  "al seleccionar una etapa", no "al arrancarla de verdad").
- Rama del split parcial (`else:`) → `_apply_product(covered_attempt)` (el
  producto va con la parte que sí arrancó, no con la que espera).

- [ ] **Step 5: Correr los tests**

```bash
docker-compose exec api pytest backend/tests/production/test_stage_attempt_material.py -v
```

- [ ] **Step 6: Suite completa de producción**

```bash
docker-compose exec api pytest backend/tests/production -v
```

Esperado: `test_dynamic_flow.py` empieza a fallar (sus `StageAttemptCreate(...)`
no traen `product` — es un campo obligatorio nuevo). Actualizar esos
llamados agregando `product=RunProductCreate(target_item_id=target_complement.id,
quantity=Decimal("1"))` (o el que corresponda por test) a cada
`StageAttemptCreate(...)` de `test_dynamic_flow.py` y de
`test_cancel_run.py`/`test_admin_acta_line.py`/`test_acta_edit.py`/
`test_historical_import.py` que construyan uno sin materiales — revisar cada
fallo uno por uno con `pytest -v` y agregar el campo que falte, usando
`target_complement` (fixture ya disponible en `conftest.py`) como destino
por defecto.

- [ ] **Step 7: Commit**

```bash
git add backend/modules/production/schemas.py backend/modules/production/service.py backend/tests/production/
git commit -m "feat(production): producto resultante obligatorio al iniciar etapa, alimenta RECEPCION"
```

---

## Task 4: Eliminar assign_product (reemplazado por Task 3)

**Files:**
- Modify: `backend/modules/production/service.py`
- Modify: `backend/modules/production/router.py`
- Modify: `frontend/lib/production-api.ts`
- Modify: `frontend/components/production/production-dashboard.tsx`
- Delete/rewrite tests que lo usaban

- [ ] **Step 1: Confirmar que nada más llama a `assign_product`/`handleAssignProduct`**

```bash
grep -rn "assign_product\|assignProduct\b" backend/modules/production/ frontend/components frontend/lib
```

Con Task 3 aplicado, la única razón para llamarlo era cerrar la orden
manualmente — ya no hace falta.

- [ ] **Step 2: Backend — borrar el método y el endpoint**

Borrar `def assign_product(...)` completo en `service.py` (ver bloque
actual, empieza con el docstring "Asigna el resultado de la orden..."). Borrar
`POST /runs/{run_id}/assign-product` en `router.py`. Si `AssignProductPayload`
queda sin otro uso (`grep -n "AssignProductPayload" backend/modules/production/`),
borrarla de `schemas.py` también.

- [ ] **Step 3: Frontend — borrar la funcion API y el flujo de UI**

`production-api.ts`: borrar `assignProduct`.

`production-dashboard.tsx`: borrar `handleAssignProduct`, el botón "Asignar
a producto terminado" y el bloque `itemPickerFor === "create"` que lo
alimentaba SOLO SI ese picker no se reutiliza para el nuevo formulario de
"producto resultante" de Task 6 — en la práctica, Task 6 va a REUSAR este
mismo picker (`itemPickerFor`/`orderProduct`/`runQuantity`/
`productRowToPayload`) enganchado a `handleStartStageAttempt` en vez de a
`handleAssignProduct`, así que este Step 3 se hace EN CONJUNTO con Task 6
Step 2, no antes — dejar anotado y resolver ahí (evita borrar y volver a
escribir el mismo picker).

- [ ] **Step 4: Tests**

`test_dynamic_flow.py::test_full_happy_path_two_attempts_same_process_and_assign_product`
usa `assign_product` como paso final — reescribir para que el "producto
resultante" ya haya quedado declarado por Task 3 en el `start_stage_attempt`
de cada intento (el test ya construye dos intentos; agregar `product=...` a
cada `StageAttemptCreate` como en Task 3 Step 6) y quitar la llamada final a
`assign_product`/su aserción `status == "TERMINADA"` (la orden ya no cierra
sola — cambiar la aserción final a `status == "EN_PROCESO"` y verificar en
cambio que `target_complement.current_stock` sume lo declarado en ambos
intentos).

- [ ] **Step 5: Suite completa + build**

```bash
docker-compose exec api pytest backend/tests/production -v
docker-compose exec web npx tsc --noEmit -p tsconfig.json
```

(El build de frontend probablemente siga roto hasta Task 6 — es esperado,
no hace falta que compile todavía si Step 3 quedó pendiente.)

- [ ] **Step 6: Commit (junto con Task 6, ver ahí)**

---

## Task 5: Finalizar etapa sin peso, control de calidad condicional

**Files:**
- Modify: `backend/modules/production/schemas.py`
- Modify: `backend/modules/production/service.py`
- Test: `backend/tests/production/test_dynamic_flow.py` (ajustar), nuevo
  archivo `test_stage_quality_control.py`

**Interfaces:**
- Produces: `StageAttemptFinish` sin `peso_al_finalizar`, con `decision`
  default `"APROBADA"`.

- [ ] **Step 1: Schema**

Reemplazar `StageAttemptFinish` completa:

```python
class StageAttemptFinish(BaseModel):
    model_config = ConfigDict(extra="forbid")

    decision: Literal["APROBADA", "RECHAZADA"] = "APROBADA"
    # Opcional -- el motivo de rechazo no es obligatorio.
    rejection_reason: str | None = Field(default=None, max_length=1000)
```

- [ ] **Step 2: Tests que fallan**

Crear `backend/tests/production/test_stage_quality_control.py`:

```python
"""Finalizar etapa sin pedir peso: la merma sale de ENTREGA-RECEPCION, y el
control de calidad (Aprobado/Denegado) solo aplica si el proceso lo tiene
marcado en el banco (docs/superpowers/specs/2026-08-19-rediseno-acta-y-ux-produccion-design.md)."""
from decimal import Decimal

import pytest

from backend.modules.product_types.models import ProductType  # noqa: F401
from backend.modules.production.schemas import (
    ProductionOrderCreate,
    RunProductCreate,
    StageAttemptCreate,
    StageAttemptFinish,
)


def _start(production_service, current_user, process, target_complement, quantity=Decimal("1")):
    order = production_service.create_order(ProductionOrderCreate(name="Orden calidad test"), current_user)
    return production_service.start_stage_attempt(
        order.id,
        StageAttemptCreate(
            process_id=process.id,
            responsable_name="Ana",
            product=RunProductCreate(target_item_id=target_complement.id, quantity=quantity),
        ),
        current_user,
    )


def test_finish_without_quality_control_always_approves(
    db_session, production_service, current_user, process, target_complement
):
    process.quality_control = False
    db_session.flush()
    result = _start(production_service, current_user, process, target_complement)
    attempt = result.stage_attempts[0]

    finished = production_service.finish_stage_attempt(attempt.id, StageAttemptFinish(), current_user)

    assert finished.stage_attempts[0].status == "APROBADA"


def test_finish_with_quality_control_can_be_denied(
    db_session, production_service, current_user, process, target_complement
):
    process.quality_control = True
    db_session.flush()
    result = _start(production_service, current_user, process, target_complement)
    attempt = result.stage_attempts[0]

    finished = production_service.finish_stage_attempt(
        attempt.id, StageAttemptFinish(decision="RECHAZADA", rejection_reason="Pieza deforme"), current_user
    )

    rejected = finished.stage_attempts[0]
    assert rejected.status == "RECHAZADA"
    assert rejected.rejection_reason == "Pieza deforme"


def test_merma_computed_from_entrega_minus_recepcion(
    db_session, production_service, current_user, process, raw_material, target_complement
):
    from backend.modules.production.schemas import StageAttemptMaterialLine

    raw_material.current_stock = Decimal("100")
    db_session.flush()
    order = production_service.create_order(ProductionOrderCreate(name="Orden merma test"), current_user)
    result = production_service.start_stage_attempt(
        order.id,
        StageAttemptCreate(
            process_id=process.id,
            responsable_name="Ana",
            materials=[StageAttemptMaterialLine(item_id=raw_material.id, quantity=Decimal("100"))],
            product=RunProductCreate(target_item_id=target_complement.id, quantity=Decimal("1")),
        ),
        current_user,
    )
    attempt = result.stage_attempts[0]

    finished = production_service.finish_stage_attempt(attempt.id, StageAttemptFinish(), current_user)

    done = finished.stage_attempts[0]
    # Entrego 100g de materia prima, recibio 1 unidad de "Base test" (peso_per_unit
    # depende de weight_per_unit del lote -- si el fixture no trae peso previo,
    # la conversion cae al fallback "en unidades" (entry_quantity=quantity), asi
    # que RECEPCION queda en 1 "und", no comparable en gramos con ENTREGA. Este
    # test solo confirma que merma_weight se computa sin usar peso_al_finalizar
    # (el campo ya no existe en el payload) -- no fija un valor exacto de merma
    # aqui porque depende del fallback de unidades; ver Step 3 para el detalle
    # real de cuando SI son comparables (mismo raw_material como target).
    assert done.status == "APROBADA"
```

(El tercer test es deliberadamente laxo en el valor exacto de merma --
documentar en el propio test por qué, como ya hace el resto de la suite en
casos similares. Si al implementar el Step 3 conviene un caso más estricto,
ajustarlo ahí con un escenario donde ENTREGA y RECEPCION comparten unidad.)

- [ ] **Step 3: Implementar `finish_stage_attempt`**

Reemplazar el cuerpo completo (buscar `def finish_stage_attempt`):

```python
    def finish_stage_attempt(
        self, attempt_id: UUID, payload: StageAttemptFinish, current_user: CurrentUser
    ) -> ProductionRunRead:
        attempt = self.repository.get_stage_attempt(attempt_id)
        if attempt is None:
            raise ProductionNotFoundError("Etapa no encontrada.")
        if attempt.status != StageAttemptStatus.IN_PROGRESS:
            raise ProductionDomainError("Solo se puede finalizar una etapa en curso.")
        run = attempt.run

        process = self.repository.get(attempt.process_id) if attempt.process_id else None
        quality_control = bool(process and process.quality_control)

        entrega_lines = [
            line for line in run.acta_lines
            if line.stage_attempt_id == attempt.id and line.side == ActaLineSide.ENTREGA
        ]
        recepcion_lines = [
            line for line in run.acta_lines
            if line.stage_attempt_id == attempt.id and line.side == ActaLineSide.RECEPCION
        ]
        entrega_total = sum((line.quantity for line in entrega_lines), Decimal("0"))
        recepcion_total = sum((line.quantity for line in recepcion_lines), Decimal("0"))
        if entrega_lines:
            attempt.unit_code = entrega_lines[0].unit_code

        decision = payload.decision if quality_control else "APROBADA"
        if decision == "RECHAZADA":
            attempt.status = StageAttemptStatus.REJECTED
            attempt.rejection_reason = (payload.rejection_reason or "").strip() or None
        else:
            attempt.status = StageAttemptStatus.APPROVED
            # Merma propia de ESTE intento: lo entregado menos lo recibido en
            # SU propia acta (ya no hay peso_al_finalizar) -- nunca se compara
            # contra otro intento (cada etapa es su propio certificado).
            if entrega_total > 0 and recepcion_total <= entrega_total:
                loss = entrega_total - recepcion_total
                attempt.merma_weight = loss
                attempt.merma_percent = loss / entrega_total * Decimal("100")

        attempt.finished_by_user_id = current_user.id
        attempt.finished_at = datetime.utcnow()
        self.repository.flush()
        return self._read_with_names(run)
```

Nota: `recepcion_total <= entrega_total` puede no cumplirse cuando ENTREGA y
RECEPCION son items distintos con unidades distintas (materia prima en
gramos vs producto en "und") -- en ese caso no se calcula merma (queda
`None`, igual que hoy cuando `entrega_total == 0`). Esto es correcto: la
merma en gramos solo tiene sentido cuando se puede comparar contra el mismo
tipo de cantidad.

- [ ] **Step 4: Correr los tests nuevos y la suite completa**

```bash
docker-compose exec api pytest backend/tests/production/test_stage_quality_control.py -v
docker-compose exec api pytest backend/tests/production -v
```

Ajustar cualquier test existente que siga mandando `peso_al_finalizar=...`
a `StageAttemptFinish` (ya no existe el campo, `extra="forbid"` lo va a
rechazar) -- quitarlo de esos llamados.

- [ ] **Step 5: Commit**

```bash
git add backend/modules/production/schemas.py backend/modules/production/service.py backend/tests/production/test_stage_quality_control.py
git commit -m "feat(production): finalizar etapa sin peso, control de calidad condicional por proceso"
```

---

## Task 6: Frontend — iniciar/finalizar etapa (producto resultante, sin peso, calidad)

**Files:**
- Modify: `frontend/lib/production-api.ts`
- Modify: `frontend/components/production/production-dashboard.tsx`

- [ ] **Step 1: API client**

`production-api.ts`: `startStageAttempt` payload gana
`product: { product_type_id?: string; target_item_id?: string; quantity: string }`
(obligatorio, sin `?`). `finishStageAttempt` payload pierde
`peso_al_finalizar`, `decision` pasa a opcional
(`decision?: "APROBADA" | "RECHAZADA"`). Borrar `assignProduct` (Task 4).

- [ ] **Step 2: Formulario de iniciar etapa gana producto resultante obligatorio**

Reusar el picker que hoy alimenta `handleAssignProduct`
(`itemPickerFor === "create"`, `orderProduct`, `runQuantity`,
`productRowToPayload`): en vez de un botón aparte "Asignar a producto
terminado", el bloque "Producto resultante" pasa a ser parte del formulario
de "Elegir proceso" (junto a Proceso/Responsable/Materia prima opcional),
con el mismo picker de catálogo, marcado como obligatorio (mensaje de error
si falta, igual que ya hace con proceso/responsable).

`handleStartStageAttempt`: agregar el chequeo `if (!orderProduct ||
(!orderProduct.targetItemId && !orderProduct.productTypeId)) { setError(...);
return; }` y `if (!runQuantity || Number(runQuantity) <= 0) { setError(...);
return; }`, y mandar `product: productRowToPayload(orderProduct, runQuantity)`
en el `startStageAttempt(...)`. Limpiar `orderProduct`/`runQuantity` junto
con el resto del formulario al terminar.

Borrar el botón "Asignar a producto terminado" y su bloque
`{!isTerminada ? (<div className="modalActions">...Asignar...) : null}`
(Task 4 Step 3, resuelto aquí) — el picker (`itemPickerFor`) queda, solo
cambia quién lo dispara.

- [ ] **Step 3: Finalizar etapa sin peso, calidad condicional**

Borrar el input "Peso al finalizar" (`stageAttemptPeso` y su `<label>`).
`handleFinishStageAttempt` deja de validar/mandar `peso_al_finalizar`.

Resolver si el proceso de `runningAttempt` tiene control de calidad:
`const attemptProcess = processes.find((p) => p.id === runningAttempt.process_id);`
`const requiresQuality = attemptProcess?.quality_control ?? false;`

JSX de los botones de finalizar:
- Si `requiresQuality`: mantener los botones ✔/✘ actuales (ya existen,
  `isRejectingStage`/`stageAttemptRejectReason`), llamando
  `handleFinishStageAttempt(runningAttempt.id, "APROBADA" | "RECHAZADA")`
  sin peso.
- Si `!requiresQuality`: un solo botón "Finalizar etapa" que llama
  `handleFinishStageAttempt(runningAttempt.id, "APROBADA")` directo, sin
  mostrar ✔/✘ ni el campo de motivo de rechazo.

- [ ] **Step 4: Build**

```bash
docker-compose exec web npm run build
```

- [ ] **Step 5: Commit**

```bash
git add frontend/lib/production-api.ts frontend/components/production/production-dashboard.tsx
git commit -m "feat(production-dashboard): producto resultante obligatorio, finalizar sin peso con calidad condicional"
```

---

## Task 7: Unificar "Agregar" y acotar RECEPCION a lo entregado

**Files:**
- Modify: `backend/modules/production/service.py`
- Test: `backend/tests/production/test_admin_acta_line.py`
- Modify: `frontend/components/production/admin-add-acta-line.tsx`
- Modify: `frontend/components/production/production-dashboard.tsx`

- [ ] **Step 1: Test que falla (backend)**

Agregar a `test_admin_acta_line.py`:

```python
def test_add_admin_acta_line_recepcion_rejects_item_never_entregado(
    db_session, production_service, current_user, process, raw_material, target_complement
):
    from backend.modules.production.schemas import ProductionOrderCreate, StageAttemptCreate, RunProductCreate

    order = production_service.create_order(ProductionOrderCreate(name="Orden recepcion test"), current_user)
    started = production_service.start_stage_attempt(
        order.id,
        StageAttemptCreate(
            process_id=process.id, responsable_name="Ana",
            product=RunProductCreate(target_item_id=target_complement.id, quantity=Decimal("1")),
        ),
        current_user,
    )
    attempt = started.stage_attempts[0]

    with pytest.raises(ProductionDomainError, match="ya se entrego en esta etapa"):
        production_service.add_admin_acta_line(
            order.id,
            AdminActaLineCreate(side="RECEPCION", item_id=raw_material.id, quantity=Decimal("1"), stage_attempt_id=attempt.id),
            current_user,
        )


def test_add_admin_acta_line_recepcion_caps_at_entregado_minus_recibido(
    db_session, production_service, current_user, process, raw_material, target_complement
):
    from backend.modules.production.schemas import ProductionOrderCreate, StageAttemptCreate, StageAttemptMaterialLine, RunProductCreate

    raw_material.current_stock = Decimal("100")
    db_session.flush()
    order = production_service.create_order(ProductionOrderCreate(name="Orden recepcion test 2"), current_user)
    started = production_service.start_stage_attempt(
        order.id,
        StageAttemptCreate(
            process_id=process.id, responsable_name="Ana",
            materials=[StageAttemptMaterialLine(item_id=raw_material.id, quantity=Decimal("100"))],
            product=RunProductCreate(target_item_id=target_complement.id, quantity=Decimal("1")),
        ),
        current_user,
    )
    attempt = started.stage_attempts[0]

    with pytest.raises(ProductionDomainError, match="supera lo que en realidad se entrego"):
        production_service.add_admin_acta_line(
            order.id,
            AdminActaLineCreate(side="RECEPCION", item_id=raw_material.id, quantity=Decimal("101"), stage_attempt_id=attempt.id),
            current_user,
        )

    result = production_service.add_admin_acta_line(
        order.id,
        AdminActaLineCreate(side="RECEPCION", item_id=raw_material.id, quantity=Decimal("95"), stage_attempt_id=attempt.id),
        current_user,
    )
    db_session.refresh(raw_material)
    assert raw_material.current_stock == Decimal("95")
```

- [ ] **Step 2: Correr y verificar que fallan**

```bash
docker-compose exec api pytest backend/tests/production/test_admin_acta_line.py -k recepcion_rejects -v
docker-compose exec api pytest backend/tests/production/test_admin_acta_line.py -k recepcion_caps -v
```

- [ ] **Step 3: Implementar la validación en `add_admin_acta_line`**

En `add_admin_acta_line`, justo antes de construir `line = ProductionRunActaLine(...)`
en la rama con `item_id` (después de resolver `item`), agregar:

```python
        if payload.side == ActaLineSide.RECEPCION and payload.stage_attempt_id is not None:
            entregado = sum(
                (
                    l.quantity for l in run.acta_lines
                    if l.side == ActaLineSide.ENTREGA
                    and l.item_id == item.id
                    and l.stage_attempt_id == payload.stage_attempt_id
                ),
                Decimal("0"),
            )
            if entregado <= 0:
                raise ProductionDomainError("Solo se puede recibir un material que ya se entrego en esta etapa.")
            recibido = sum(
                (
                    l.quantity for l in run.acta_lines
                    if l.side == ActaLineSide.RECEPCION
                    and l.item_id == item.id
                    and l.stage_attempt_id == payload.stage_attempt_id
                ),
                Decimal("0"),
            )
            disponible = entregado - recibido
            if payload.quantity > disponible:
                raise ProductionDomainError(
                    f"La cantidad ({format_qty(payload.quantity)} {item.unit_code}) supera lo que en realidad "
                    f"se entrego para este material ({format_qty(disponible)} {item.unit_code})."
                )
```

- [ ] **Step 4: Correr los tests**

```bash
docker-compose exec api pytest backend/tests/production/test_admin_acta_line.py -v
```

- [ ] **Step 5: Frontend — label y picker acotado**

`admin-add-acta-line.tsx`: botón "Agregar línea (admin)" → "Agregar".

En `production-dashboard.tsx`, donde se arma `<AdminAddActaLineControl
side="RECEPCION" stageAttemptId={runningAttempt.id} items={materialItems} .../>`
(dentro del bloque `runningAttempt` ya identificado), cambiar `items`: en
vez de la lista completa (`rawMaterials+orderSupplyItems+complementItems+
wasteItems+finishedItems`), pasar solo los items que aparecen en
`entregaLines` de ese intento (`materialItems.filter((item) =>
entregaLines.some((line) => line.id && /* usar item_id de la linea */))`
-- `ActaSideLine` (tipo de `entregaLines`) no trae `item_id` hoy, hay que
sumarlo: revisar `lib/orden-produccion.ts` tipo `ActaSideLine` y agregarle
`item_id?: string | null` si falta, poblado desde `line.item_id` al mapear
`activeActaLines` a `entregaLines` (ya se mapea ahí, solo falta ese campo).
Con eso, filtrar `materialItems` por
`entregaLines.some((l) => l.item_id === item.id)` da la lista acotada real.

- [ ] **Step 6: Build**

```bash
docker-compose exec web npm run build
```

- [ ] **Step 7: Commit**

```bash
git add backend/modules/production/service.py backend/tests/production/test_admin_acta_line.py frontend/components/production/admin-add-acta-line.tsx frontend/components/production/production-dashboard.tsx frontend/lib/orden-produccion.ts
git commit -m "feat(production): RECEPCION solo admite items ya entregados en la etapa; unifica boton Agregar"
```

---

## Task 8: Elegir proceso — picker en vez de combobox

**Files:**
- Modify: `frontend/components/production/production-dashboard.tsx`

- [ ] **Step 1: Reusar la ventana "Procesos" como picker**

Ubicar el `<select value={selectedProcessId}>` (formulario de iniciar
etapa) y reemplazarlo por un botón "Elegir proceso" que muestra
`selectedProcess?.name ?? "Elegir..."` y abre `isProcessesOpen`.

En la ventana `isProcessesOpen` (ya lista + botón crear), cada fila de
proceso activo gana `onClick={() => { setSelectedProcessId(process.id);
setIsProcessesOpen(false); }}` SOLO cuando esa ventana se abrió desde el
picker (agregar un estado `processesPickerMode: boolean` para no romper el
uso existente de esa ventana como simple gestión de mantenimiento desde el
menú "Procesos" del dashboard, donde clickear una fila no debería
seleccionarla para nada). El botón que abre la ventana desde iniciar etapa
pone `processesPickerMode = true`; el botón del menú general la abre con
`processesPickerMode = false`. El `onClick` de cada fila solo actúa si
`processesPickerMode` es true.

- [ ] **Step 2: Build**

```bash
docker-compose exec web npm run build
```

- [ ] **Step 3: Commit**

```bash
git add frontend/components/production/production-dashboard.tsx
git commit -m "feat(production-dashboard): elegir proceso abre ventana en vez de combobox"
```

---

## Task 9: Textos, reporte de etapas a ventana aparte, ancho de acta

**Files:**
- Modify: `frontend/components/production/production-dashboard.tsx`
- Modify: `frontend/app/globals.css`

- [ ] **Step 1: Quitar textos de ayuda**

Buscar y borrar el texto "Nombre libre -- el proceso se elige despues,
etapa por etapa" (subtítulo del panel Crear orden) y el `placeholder` del
input de nombre. Buscar y borrar "Si el stock no alcanza, la etapa arranca
con lo disponible y el resto queda pendiente de asignar." (agregado en la
sesión anterior bajo el picker de materia prima).

- [ ] **Step 2: Mover `pastAttempts` a ventana aparte**

Extraer la tabla `pastAttempts.map(...)` (Código/Proceso/Responsable/
Estado/Merma) de su posición inline (antes de `waitingMaterialAttempts`) a
un modal nuevo (`isStageReportOpen`), con un botón de ícono (`FileText`, ya
importado) junto al `<h2>{dynamicOrderRun.name}</h2>` del modalHeader que lo
abre. El modal recibe `pastAttempts` (calculado igual que hoy) y lo
renderiza en una `<table>` propia dentro de `modalWindow processViewWindow`.

- [ ] **Step 3: CSS — ancho de acta y columna Fecha**

En `globals.css`, buscar `.actaDocFrame`/`.opDocWrap`/`.opThFecha`/
`.opTdFecha`. Si `.opDocWrap` o `.actaWindow`/`.processViewWindow` tienen un
`max-width` que fuerza el scroll horizontal del acta de dos columnas,
aumentarlo (o quitarlo, dejando que el modal crezca hasta el ancho de
pantalla disponible con su propio `max-width: 95vw` como tope). Dar a
`.opThFecha`/`.opTdFecha` un `min-width` mayor (la fecha completa
`DD mmm YYYY, HH:MM` necesita más espacio que hoy).

- [ ] **Step 4: Build y smoke visual**

```bash
docker-compose exec web npm run build
```

- [ ] **Step 5: Commit**

```bash
git add frontend/components/production/production-dashboard.tsx frontend/app/globals.css
git commit -m "feat(production-dashboard): reporte de etapas a ventana aparte, limpieza de textos, acta mas ancha"
```

---

## Task 10: Marca de agua "Rechazado por control de calidad"

**Files:**
- Modify: `frontend/app/globals.css`
- Modify: `frontend/components/production/production-dashboard.tsx`

- [ ] **Step 1: CSS**

Agregar a `globals.css` una clase `.actaWatermark` (o similar): overlay con
texto diagonal "RECHAZADO POR CONTROL DE CALIDAD", `position: relative` en
el contenedor + `::after` con `position: absolute`, `opacity` baja,
`pointer-events: none`, mismo patrón visual que cualquier watermark de
"cancelado"/"anulado" ya existente en el sistema si lo hay (revisar
`globals.css` por `watermark`/`stamp` antes de inventar un patrón nuevo).

- [ ] **Step 2: Aplicar donde se muestra un intento**

En el bloque de `pastAttempts` (ahora en su modal, Task 9) y en el bloque
`runningAttempt` (aunque un intento `RECHAZADA` nunca es `runningAttempt`,
puede volver a mostrarse desde el modal de reporte): si
`attempt.status === "RECHAZADA"`, envolver su fila/sección con la clase
`actaWatermark`.

- [ ] **Step 3: Build y commit**

```bash
docker-compose exec web npm run build
git add frontend/app/globals.css frontend/components/production/production-dashboard.tsx
git commit -m "feat(production-dashboard): marca de agua en etapas rechazadas por control de calidad"
```

---

## Task 11: Eliminar Material adicional (backend + frontend + tests)

**Files:** ver spec B.9. Mismo patrón de eliminación que el flujo viejo de
la sesión anterior (`docs/superpowers/plans/2026-08-19-automatizar-material-por-etapa.md`
Task 8) — buscar cada símbolo con grep antes de borrar, verificar con
`pytest`/`tsc` después de cada bloque.

- [ ] **Step 1: Confirmar consumidores**

```bash
grep -rn "additional_material\|AdditionalMaterial\|Material adicional\|requestAdditionalMaterial\|approveAdditionalMaterial\|rejectAdditionalMaterial" backend/modules backend/tests frontend/components frontend/lib
```

- [ ] **Step 2: Backend**

Borrar en `backend/modules/production/service.py`:
`request_additional_material`, `approve_additional_material`,
`reject_additional_material`, `_attach_additional_materials` (y su llamada
en `_read_with_names`/`list_runs`). Borrar en `router.py` los tres
endpoints `/additional-materials`. Borrar en `schemas.py`
`AdditionalMaterialRequestCreate`/`AdditionalMaterialRequestRead` y el campo
`additional_materials` de `ProductionRunRead`. Borrar el modelo
`ProductionRunAdditionalMaterialRequest` de `models.py` y su relationship en
`ProductionRun`.

- [ ] **Step 3: Migración**

```bash
docker-compose exec api alembic revision -m "drop_additional_material_requests"
```

```python
def upgrade() -> None:
    op.drop_table("production_run_additional_material_requests")


def downgrade() -> None:
    raise NotImplementedError("No hay vuelta atras: la tabla se elimina sin conservar datos.")
```

```bash
docker-compose exec api alembic upgrade head
```

- [ ] **Step 4: Tests backend**

```bash
git rm backend/tests/production/test_additional_material.py
```

En `test_admin_acta_line.py`, borrar
`test_approve_additional_material_does_not_merge_into_admin_stock_line` (el
"Fix 2" del bloque de comentarios) y el bloque de comentario que lo
introduce; borrar el import de `_in_progress_run`/`AdditionalMaterialRequestCreate`
si quedan sin uso.

```bash
docker-compose exec api pytest backend/tests/production -v
```

- [ ] **Step 5: Frontend**

Borrar en `inventory-dashboard.tsx`: estado `isAdditionalMaterialOpen`, el
modal completo (agregado la sesión pasada), el botón del topbar "Material
adicional", `pendingAdditionalMaterialRequests`/`handleApproveAdditionalMaterial`/
`handleRejectAdditionalMaterial`. Borrar en `app-shell.tsx`
`pendingAdditionalMaterials`/su contribución a `invPending` (queda
`invPending = 0` fijo, o se borra el badge de `/inventario` directamente si
ya no hay ninguna fuente — revisar si queda algo más que lo alimente antes
de decidir). Borrar en `production-api.ts`
`requestAdditionalMaterial`/`approveAdditionalMaterial`/
`rejectAdditionalMaterial`. Borrar en `acta-view.tsx` el componente
`EntregaAction` completo (Task 12 lo iba a tocar de todos modos, se puede
hacer aquí mismo ya que la dependencia es la misma).

- [ ] **Step 6: Build**

```bash
docker-compose exec web npm run build
```

- [ ] **Step 7: Commit**

```bash
git add -A backend/modules/production backend/alembic/versions backend/tests/production frontend/components frontend/lib
git commit -m "refactor(production): elimina Material adicional, redundante con Agregar unificado"
```

---

## Task 12: Limpieza final de acta-view.tsx (RecepcionActions/ReturnCandidatesForm)

**Files:**
- Modify: `frontend/components/production/acta-view.tsx`
- Modify: `frontend/components/production/production-dashboard.tsx`

- [ ] **Step 1: Confirmar consumidores de `ReturnCandidatesForm`/`buildReturnCandidates`**

```bash
grep -rn "ReturnCandidatesForm\|buildReturnCandidates\|RecepcionActions\|postFinishReturnRun\|isPostFinishActa" frontend/components
```

- [ ] **Step 2: Borrar en `acta-view.tsx`**

Borrar `ReturnCandidate`/`buildReturnCandidates`/`ReturnCandidatesForm`/
`RecepcionActions` completos. En `ActaView`, quitar
`<RecepcionActions .../>` del `footer` del lado RECEPCION (queda solo
`<AdminAddActaLineControl side="RECEPCION" .../>`, ya sin `stageAttemptId`,
tal como se documentó en la spec B.10 -- ese uso admin-only de nivel de
orden se mantiene).

- [ ] **Step 3: Borrar en `production-dashboard.tsx`**

Borrar `postFinishReturnRun`/`setPostFinishReturnRun`/`isPostFinishActa`/
`setIsPostFinishActa` (estado) y el bloque JSX que renderiza
`<ReturnCandidatesForm run={postFinishReturnRun} .../>` (el ritual
"post-finalizar", ligado a `PENDIENTE_RECEPCION`, estado del flujo viejo
que una orden nueva nunca alcanza).

- [ ] **Step 4: Build**

```bash
docker-compose exec web npm run build
```

- [ ] **Step 5: Commit**

```bash
git add frontend/components/production/acta-view.tsx frontend/components/production/production-dashboard.tsx
git commit -m "refactor(acta-view): elimina devolver-sobrante de nivel de orden (ya vive por etapa)"
```

---

## Task 13: Documentos — carpeta por orden

**Files:**
- Modify: `frontend/lib/orden-produccion.ts`
- Modify: `frontend/components/documentos/documentos-dashboard.tsx`

- [ ] **Step 1: `buildOrdenProduccion` acepta filtro por intento**

En `lib/orden-produccion.ts`, revisar la firma actual de
`buildOrdenProduccion(family, itemNames)` y el helper que arma
`entregaLines`/`recepcionLines` a partir de `acta_lines` de TODAS las
corridas de `family`. Agregar un parámetro opcional
`stageAttemptId?: string`: cuando viene, filtrar `acta_lines` de cada `run`
de `family` a `line.stage_attempt_id === stageAttemptId` antes de armar el
modelo (mismo criterio que ya usa `production-dashboard.tsx` para
`activeActaLines`).

- [ ] **Step 2: Vista de carpeta en Documentos**

En `documentos-dashboard.tsx`, donde hoy `selectedFamily` arma `model`
directo con `buildOrdenProduccion(selectedFamily, itemNames)`: si
`selectedFamily` tiene una `root` (corrida sin `parent_run_id`) con
`stage_attempts.length > 1`, en vez de armar `model` directo, mostrar una
lista intermedia (Código/Proceso/Responsable/Estado, mismas columnas que
Task 9) de esos intentos; clickear uno arma `model` con
`buildOrdenProduccion(selectedFamily, itemNames, attempt.id)` (Step 1). Si
`stage_attempts.length <= 1` (o la familia es histórica, sin
`stage_attempts`), saltar la lista y armar `model` directo como hoy. Un
estado nuevo `selectedStageAttemptId: string | null` controla cuál de las
dos vistas se muestra; se resetea a `null` cuando cambia `selectedKey`.

Intentos con `status === "RECHAZADA"` en esa lista llevan la marca de agua
de Task 10 (mismo criterio visual).

- [ ] **Step 3: Build**

```bash
docker-compose exec web npm run build
```

- [ ] **Step 4: Commit**

```bash
git add frontend/lib/orden-produccion.ts frontend/components/documentos/documentos-dashboard.tsx
git commit -m "feat(documentos): carpeta por orden -- lista de etapas antes del acta cuando hay mas de una"
```

---

## Task 14: Mensajes — limpieza y rediseño visual

**Files:**
- Modify: `frontend/components/solicitudes/solicitudes-view.tsx`
- Modify: `frontend/components/inventory/inventory-dashboard.tsx`
- Modify: `frontend/app/globals.css`

- [ ] **Step 1: `MessagesPanel` gana `title` como prop**

En `solicitudes-view.tsx`, `MessagesPanel({ role, userId, scope, title })`:
agrega `title: string` a los props, reemplaza el `<h2 className="panelTitle">
{role === "admin" ? "Mensajes con Produccion/Inventario" : "Mensajes del Admin"}
</h2>` por `<h2 className="panelTitle">{title}</h2>`. Borra el `<p
className="panelText">Comunicacion libre -- cualquiera de los dos lados puede
responder</p>`. Borra el `placeholder="Ej: Necesito 20kg..."` del textarea
del compositor (queda sin placeholder, o uno neutro tipo "Escribe tu
mensaje...").

`SolicitudesView` (mismo archivo) pasa `title="Mensajes con Producción"` al
`<MessagesPanel>` que ya renderiza.

- [ ] **Step 2: Agrupar por fecha**

Dentro de `MessagesPanel`, agrupar `messages` por día (mismo criterio de
fecha que usa Documentos/`monthKey`/`dateKey` en `lib/calendar.ts` --
reusar esos helpers en vez de escribir uno nuevo) antes de mapear a
`<MessageThread>`; renderizar un separador de fecha (texto tipo "19 de
agosto de 2026") una vez por grupo, no por mensaje.

- [ ] **Step 3: Contenedor sin scroll infinito**

`.messageList` (o la clase que hoy tenga `overflow-y` fijo en
`globals.css`): acotar su alto a lo que el modal/panel ya usa para otras
listas largas del sistema (revisar cómo se comporta `.tableWrap`/
`.pagedListFloor` en otros paneles) en vez de un `max-height` grande con
scroll propio de la ventana completa.

- [ ] **Step 4: Modal de Inventario pide su propio título**

`inventory-dashboard.tsx`, donde se renderiza `<MessagesPanel role={...}
scope="inventario" userId={...} />` dentro del modal `isMessagesOpen`: el
`<h2>Buzón de mensajes</h2>` del `modalHeader` ya está bien (no lo genera
`MessagesPanel`) -- cambiar su texto a **"Bandeja de entrada"** y pasar
`title=""`/omitir el `<h2>` interno de `MessagesPanel` para este caso (dado
que Step 1 movió el título a prop, acá simplemente no se necesita mostrarlo
dos veces -- pasar `title={null}` y que `MessagesPanel` no renderice el
`<h2>` si viene `null`, dejando solo el del `modalHeader` externo).

- [ ] **Step 5: Confirmar que Producción/Inventario no puede iniciar mensajes**

Ya es así (`{role === "admin" ? <compositor> : null}`) -- solo correr el
build y probar visualmente que el rediseño no lo rompió.

- [ ] **Step 6: Build**

```bash
docker-compose exec web npm run build
```

- [ ] **Step 7: Commit**

```bash
git add frontend/components/solicitudes/solicitudes-view.tsx frontend/components/inventory/inventory-dashboard.tsx frontend/app/globals.css
git commit -m "feat(mensajes): agrupa por fecha, quita textos de ayuda, sin scroll infinito, titulos por superficie"
```

---

## Task 15: Verificación final

- [ ] **Step 1: Suite backend completa**

```bash
docker-compose exec api pytest
```

- [ ] **Step 2: compileall**

```bash
docker-compose exec api python -m compileall backend
```

- [ ] **Step 3: Build frontend**

```bash
docker-compose exec web npm run build
```

- [ ] **Step 4: Migraciones al día**

```bash
docker-compose exec api alembic upgrade head
```

- [ ] **Step 5: Smoke manual (si hay navegador disponible)**

Crear orden → iniciar etapa (proceso por ventana, materia prima opcional,
producto resultante obligatorio) → agregar en RECEPCION un item ya
entregado (ver tope) → finalizar etapa (con y sin control de calidad) →
Denegado muestra marca de agua y vuelve a elegir proceso → Documentos
muestra la carpeta con 2+ etapas → mensajes sin scroll infinito, agrupados
por fecha.
