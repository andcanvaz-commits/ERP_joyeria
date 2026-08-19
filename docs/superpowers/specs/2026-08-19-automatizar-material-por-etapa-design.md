# Automatizar material por etapa y eliminar el flujo viejo — Design

## Contexto

Hoy conviven dos flujos de producción en el código:

- **Flujo viejo** (`POST /api/production/runs`, estados
  `PENDIENTE_INVENTARIO → MATERIALES_APROBADOS → EN_PROCESO → PENDIENTE_RECEPCION
  → RECIBIDA`, con split por `ESPERANDO_MATERIAL`): tiene toda la aprobación de
  materiales, split automático por falta de stock y recepción final. **Ningún
  componente del frontend lo crea** (`createProductionRun` no se llama desde
  ningún lado) — solo queda vivo para aprobar/rechazar/recibir órdenes que ya
  estuvieran en esos estados. Confirmado con el usuario: la base de datos real
  no tiene ninguna orden pendiente en ese flujo ahora mismo.
- **Flujo nuevo** (`POST /api/production/orders`, el que usa
  `production-dashboard.tsx`): la orden nace con solo un nombre, cada etapa se
  abre con `start_stage_attempt` (proceso + responsable, **sin** materiales) y
  se cierra con `finish_stage_attempt` (peso final, ✔/✘). El acta se llena a
  mano después — hoy no valida stock, no hace split y no descuenta inventario
  automáticamente.

"Solicitudes" (`solicitudes-view.tsx`) mezcla hoy dos cosas: la cola de
aprobación del flujo viejo (muerta en la práctica) y el buzón de mensajes
libres Admin↔Producción/Inventario ("Bandeja de mensajes"). Este cambio:

1. Elimina el flujo viejo (endpoints, servicio, UI de aprobación). El buzón de
   mensajes **no se toca**.
2. Lleva la validación de stock y el split al flujo nuevo, disparada al
   iniciar cada etapa — automática cuando alcanza, con aprobación manual
   puntual cuando falta.

Decisiones ya confirmadas con el usuario (ver hilo de brainstorming):
- Se elimina solo la aprobación de materiales del flujo viejo, no el chat.
- Iniciar etapa declara materiales con cantidad (opcional por etapa — puede
  iniciarse sin nada, igual que hoy).
- Cuando alcanza el stock: automático, sin paso manual ("como aprobar pero
  automático").
- Cuando NO alcanza: la parte cubierta arranca ya (se descuenta), el resto
  queda pendiente **dentro de la misma orden** (no una orden hija) y necesita
  un botón manual de asignar/aprobar — no arranca solo con el próximo ingreso.
- "Recibir al finalizar etapa": **no** se automatiza — terminar una etapa
  sigue sin tocar inventario. Asignar a producto terminado (`assign_product`)
  sigue siendo opcional en cualquier etapa, expuesto ahora bajo un botón
  "Finalizar orden" (sin cambio de backend, es un reetiquetado/exposición de
  lo que ya existe).
- `additional_material_requests` (pedir material extra durante una etapa en
  curso) **no cambia** — sigue con su aprobación manual actual, es un
  mecanismo aparte.

---

## Parte A — Eliminar el flujo viejo

### Backend: se borra

**`backend/modules/production/service.py`** — métodos:
`create_run`, `approve_materials`, `reject_materials`, `allocate_material`,
`preview_allocation`, `preview_approve_materials`, `reserve_material`,
`release_material_reservation`, `start_with_reserved_material`, `start_run`,
`finish_stage` (la vieja, sobre `ProductionRunStage`), `edit_stage_weight`,
`receive_finished_product`, `_compute_coverage`, `_split_run_for_partial_material`,
`_reservation_is_complete`, `_MaterialCoverage`, `_ResourceShortage` y
cualquier helper que solo sirva a esos (revisar con grep de usos antes de
borrar cada uno — algunos, como `_sync_entrega_acta_line`, los sigue usando
`request_additional_material`/`approve_additional_material`, esos **no** se
tocan).

**`backend/modules/production/router.py`** — endpoints:
`POST /runs` (create_run viejo), `POST /runs/{id}/approve-materials`,
`POST /runs/{id}/reject-materials`, `POST /runs/{id}/allocate-material`,
`POST /runs/{id}/allocation-preview`, `GET /runs/{id}/approve-materials-preview`,
`POST /runs/{id}/reserve-material`, `POST /runs/{id}/release-reservation`,
`POST /runs/{id}/start-reserved`, `POST /runs/{id}/start`,
`POST /runs/stages/{id}/finish`, `POST /runs/stages/{id}/edit-weight`,
`POST /runs/{id}/receive-finished`.

**Queda igual** (genérico, no es del flujo viejo pese a las apariencias):
`cancel_run` / `cancel_run_family` / sus endpoints — cancelan una orden en
cualquier estado y revierten lo que haya consumido. Ver fix necesario en la
Parte B.5.

**Schemas** (`schemas.py`): borrar `ProductionRunCreate`,
`MaterialRejectPayload` (si solo la usa reject_materials — confirmar, también
la usa `reject_additional_material`: si es compartido, **no** se borra, solo
se borra lo que quede huérfano), `AllocateMaterialPayload`,
`AllocationPreviewRead`, `ProductionRunStageFinish`, `StageWeightEdit`,
`ReceiveFinishedProductPayload`, y cualquier campo de `ProductionRunRead` que
solo alimente esas pantallas (revisar antes de borrar campos — `ProductionRunRead`
lo consume también el histórico vía `list_runs`/Documentos, así que los
campos de **lectura** que describen órdenes ya `RECIBIDA` existentes deben
seguir — no se borra el modelo `ProductionRun`/`ProductionRunStage`/columnas,
solo el código que las **muta**).

**No se toca el esquema de BD**: `ProductionRunStage`, `ProductionRunStageIngredient`,
las columnas `reserved_material_quantity`, `total_required_material`, etc.
quedan en la tabla — las usa el histórico (Documentos, reportes, órdenes ya
`RECIBIDA`). Solo se borra el código que las **escribe** desde ahora. No hace
falta migración de Alembic para esta parte.

### Frontend: se borra

- `solicitudes-view.tsx`: quitar toda la sección de corridas
  `PENDIENTE_INVENTARIO`/`ESPERANDO_MATERIAL`/etc. (imports `listProductionRuns`,
  `getRunFamily`, `RunStageSummaryTable`, `ActaView` si solo los usaba esa
  sección) — queda solo el chat de mensajes.
- `production-dashboard.tsx` / `inventory-dashboard.tsx`: quitar botones y
  modales de aprobar/rechazar/destinar/reservar/recibir del flujo viejo y las
  llamadas a `lib/production-api.ts` correspondientes (`approveMaterials`,
  `rejectMaterials`, `allocateMaterial`, `previewAllocation`,
  `previewApproveMaterials`, `reserveMaterial`, `releaseReservation`,
  `startReservedRun`, `startRun`, `finishRunStage` viejo, `editStageWeight`,
  `receiveFinishedProduct`, `createProductionRun`).
- `frontend/lib/production-api.ts`: borrar esas funciones.
- `frontend/types/production/index.ts`: limpiar tipos que solo describían el
  payload/response de lo borrado (dejar los de lectura que el histórico usa).

### Tests: se borran o se reescriben

Archivos que testean **solo** flujo viejo → se borran enteros:
`test_reject_materials.py`, `test_allocate_material.py`,
`test_material_reservation.py`, `test_approve_materials_preview.py`,
`test_material_split.py`, `test_coverage_fraction.py`,
`test_error_message_formatting.py` (confirmar que solo cubre
`shortage_message`/coverage viejo antes de borrar).

`test_cancel_run.py` → se reescribe: los casos que arman el escenario con
`create_run`/`approve_materials`/`WAITING_MATERIAL`/`PENDIENTE_RECEPCION` se
adaptan al flujo nuevo (`create_order` + `start_stage_attempt` con
materiales que consumen stock real), conservando el propósito de cada test
(cancelar restaura stock consumido, no se puede cancelar una `RECIBIDA`, no
se puede cancelar dos veces). El caso de "hijo activo por split" se adapta al
nuevo split por intento de etapa (Parte B).

`test_historical_import.py` → **revisar caso por caso, no borrar entero**:
usa `create_run`/`approve_materials` solo como fixture para armar una corrida
con `event_lines` y probar que `receive_finished_product` la rechaza. Como
`receive_finished_product` desaparece, ese test puntual se borra; pero si hay
otros tests en el archivo que solo verifican lectura de `event_lines` (no
mutación del flujo viejo), esos se conservan adaptando el fixture a
`ProductionRun` construido directo en el test (sin pasar por `create_run`).

Los demás archivos de la lista (`test_acta_auto.py`, `test_edit_stage_weight.py`
[ojo: puede ser el edit-weight NUEVO de `finish_stage_attempt`, confirmar cuál
antes de tocar], `test_receive_merma.py`, `test_actual_finished_weight.py`,
`test_acta_seed.py`, `test_acta_edit.py`, `test_admin_acta_line.py`) — revisar
uno por uno: si solo usan `create_run`/`approve_materials` como fixture para
llegar a un estado con acta, adaptar el fixture al flujo nuevo; si prueban
comportamiento específico del flujo viejo, borrar esa porción.

---

## Parte B — Material automático por etapa (flujo nuevo)

### B.1 Modelo — `backend/modules/production/models.py`

Nueva tabla, una fila por línea de material pedida en un intento de etapa:

```python
class ProductionRunStageAttemptMaterial(Base):
    """Una linea de material declarada al iniciar un intento de etapa (flujo
    nuevo). quantity_pending baja cada vez que se consume (al iniciar si
    alcanza, o via allocate_stage_attempt_material si quedo corta) -- llega a
    0 cuando esta linea esta completamente cubierta."""

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

En `ProductionRunStageAttempt`, agregar:

```python
    materials: Mapped[list["ProductionRunStageAttemptMaterial"]] = relationship(
        back_populates="stage_attempt",
        cascade="all, delete-orphan",
    )
```

En `StageAttemptStatus`, agregar `WAITING_MATERIAL = "PENDIENTE_MATERIAL"`
junto a `IN_PROGRESS`/`APPROVED`/`REJECTED`.

Migración Alembic nueva: crea la tabla (columna `status` de
`production_run_stage_attempts` ya es `String(20)`, no necesita migración
para el nuevo valor).

### B.2 Schemas — `backend/modules/production/schemas.py`

```python
class StageAttemptMaterialLine(BaseModel):
    model_config = ConfigDict(extra="forbid")
    item_id: UUID
    quantity: Decimal = Field(gt=0)


class StageAttemptCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")
    process_id: UUID
    responsable_name: str = Field(min_length=1, max_length=180)
    materials: list[StageAttemptMaterialLine] = Field(default_factory=list)
```

`StageAttemptRead` (o el `ProductionRunRead` embebido que ya arma
`_read_with_names`) gana:

```python
class StageAttemptMaterialRead(BaseModel):
    model_config = ConfigDict(from_attributes=True, extra="forbid")
    item_id: UUID
    name: str | None = None
    unit_code: str
    quantity_requested: Decimal
    quantity_pending: Decimal
```

y el read de intento de etapa gana `materials: list[StageAttemptMaterialRead]`
y `status` ahora puede valer `"PENDIENTE_MATERIAL"`.

### B.3 Service — `backend/modules/production/service.py`

**Helper nuevo** `_material_coverage_ratio(self, lines: list[tuple[InventoryItem, Decimal]]) -> Decimal`:
para cada `(item, quantity)`, `ratio_i = min(1, available_stock(item) / quantity)`
(usar `self.inventory_service.available_stock(item)`); devuelve el mínimo de
todos los `ratio_i`, clamped a `[0, 1]`. Si `lines` está vacía, devuelve `1`
(nada que cubrir = arranca directo, caso "sin materiales" de hoy).

**`start_stage_attempt`** — mismas validaciones de hoy (run `EN_PROCESO`, sin
intento `EN_PROCESO` activo, proceso existe y activo) y misma construcción del
`ProductionRunStageAttempt` base. Después, si `payload.materials` está vacío:
igual que hoy, `status=EN_PROCESO`, listo. Si no está vacío:

1. Resolver cada `item_id` a `InventoryItem` (404 si no existe).
2. `ratio = self._material_coverage_ratio([(item, line.quantity) for ...])`.
3. Si `ratio >= 1`: crear el intento con `status=EN_PROCESO`; para cada línea,
   `self.inventory_service.consume_material_for_production(item_id=item.id,
   quantity=line.quantity, production_run_id=run.id, user_id=current_user.id,
   production_code=order_code, reason=f"Consumo en etapa {process.name}
   ({code}).")`, agregar `ProductionRunActaLine` (`side=ENTREGA`,
   `stage_attempt_id=attempt.id`, `item_id=item.id`, `quantity=line.quantity`,
   `unit_code=item.unit_code`, `source=ActaLineSource.PLAN`,
   `line_order=<siguiente>`), y una fila
   `ProductionRunStageAttemptMaterial(quantity_requested=line.quantity,
   quantity_pending=Decimal("0"))`.
4. Si `0 < ratio < 1`: crear **dos** intentos con el mismo `process_id` (el
   segundo consume otro `sequence_order`/`attempt_no_for_process`/`code`, ver
   `_stage_attempt_code_for` — llamarlo dos veces, el segundo con
   `attempt_no_for_process + 1`):
   - Intento A, `status=EN_PROCESO`: para cada línea, `covered = (line.quantity
     * ratio).quantize(Decimal("0.0001"), rounding=ROUND_DOWN)`; consumir
     `covered` igual que el paso 3 (movimiento + acta line +
     `ProductionRunStageAttemptMaterial(quantity_requested=covered,
     quantity_pending=0)`).
   - Intento B, `status=PENDIENTE_MATERIAL`: para cada línea,
     `remainder = line.quantity - covered`; **sin** movimiento ni acta line
     todavía, solo `ProductionRunStageAttemptMaterial(quantity_requested=remainder,
     quantity_pending=remainder)`.
5. Si `ratio <= 0`: crear **solo** el intento B (`PENDIENTE_MATERIAL`) con
   `quantity_pending = quantity_requested = line.quantity` para cada línea —
   nada arranca todavía.

**`allocate_stage_attempt_material(attempt_id, current_user)`** — nuevo:
1. `attempt = self.repository.get_stage_attempt(attempt_id)`; 404 si no
   existe; `ProductionDomainError` si `attempt.status != WAITING_MATERIAL`.
2. Para las líneas con `quantity_pending > 0`, recalcular
   `ratio = self._material_coverage_ratio([(item, line.quantity_pending) for ...])`.
3. Si `ratio <= 0`: no hacer nada, devolver el estado actual sin error (para
   que el botón "Reintentar" sea seguro de apretar aunque todavía no haya
   stock).
4. Si `ratio > 0`: para cada línea, `covered = (line.quantity_pending *
   ratio).quantize(...)`; si `covered > 0`, consumir igual que en el arranque
   (movimiento + agregar/mergear la `ProductionRunActaLine` de esa línea —
   reusar `_add_or_merge_acta_line` si el `item_id` ya tiene una línea ENTREGA
   para este `stage_attempt_id`, si no, crear una nueva) y restar
   `line.quantity_pending -= covered`.
5. Si después de esto **todas** las líneas quedaron en `quantity_pending == 0`:
   - Si `self.repository.get_active_stage_attempt(run.id) is None`:
     `attempt.status = EN_PROCESO`, `attempt.started_at = datetime.utcnow()`.
   - Si hay otro intento `EN_PROCESO`: dejar `attempt.status = WAITING_MATERIAL`
     tal cual (material completo, pero bloqueado por la regla de "una etapa a
     la vez") — el mismo botón, reintentado después de terminar la otra etapa,
     lo arranca (no hay nada más que consumir, solo hace el chequeo del punto
     5 y pasa).
6. Devolver `self._read_with_names(run)`.

Permiso: mismo `production.runs.update` que el resto.

### B.4 Router — `backend/modules/production/router.py`

```
POST /runs/stage-attempts/{attempt_id}/allocate-material   production.runs.update
```

Mismo patrón try/except que los demás (`ProductionNotFoundError` → 404,
`ProductionDomainError` → 409).

### B.5 Fix necesario en `cancel_run` / `cancel_run_family`

`_cancel_run_core` hoy solo llama `reverse_production_consumption` si
`run.materials_approved_at is not None` — ese campo solo lo pone el flujo
viejo. Con B.3, una orden del flujo nuevo también puede tener movimientos
`CONSUMO_PRODUCCION` reales (via `start_stage_attempt`/
`allocate_stage_attempt_material`). `reverse_production_consumption` ya es
seguro de llamar siempre (suma los movimientos `CONSUMO_PRODUCCION` con
`reference_id=run.id`, si no hay ninguno no hace nada) — **quitar el `if
run.materials_approved_at is not None:` y llamarlo siempre que
`self.inventory_service` exista**, sin gate. Sin esto, cancelar una orden
nueva que ya consumió material por una etapa dejaría el stock consumido sin
revertir — bug de este cambio si no se corrige.

### B.6 Frontend — `production-dashboard.tsx`

- Formulario de "iniciar etapa": agrega una lista opcional de materiales
  (picker de item — reusar `MaterialCategoryPicker` con
  `allowedTypes: ["RAW_MATERIAL", "SUPPLY", "COMPLEMENT"]` — + cantidad, se
  pueden agregar varias líneas) antes de confirmar. Llama a
  `startStageAttempt(runId, { process_id, responsable_name, materials })`.
- Si la respuesta trae un intento en `PENDIENTE_MATERIAL` para esa orden,
  mostrarlo inline junto al intento activo (badge "Falta material") con las
  líneas pendientes (`materials` con `quantity_pending > 0`) y un botón
  "Asignar material disponible" → `allocateStageAttemptMaterial(attemptId)`.
- Botón "Finalizar orden": visible cuando no hay ningún intento
  `EN_PROCESO`/`PENDIENTE_MATERIAL` para la orden; abre el modal existente de
  `assign_product` (sin cambio de comportamiento, solo se expone como acción
  de cierre explícita en vez de un botón suelto de "asignar producto").

### B.7 Tests nuevos

`backend/tests/production/test_stage_attempt_material.py`:
- Iniciar etapa sin materiales: igual que hoy, `EN_PROCESO` directo.
- Iniciar etapa con materiales y stock completo: consume stock real
  (`InventoryItem.current_stock` baja), crea acta ENTREGA con
  `stage_attempt_id`, intento queda `EN_PROCESO`, `materials` con
  `quantity_pending == 0`.
- Iniciar etapa con stock parcial (ej. pide 100, hay 60): crea dos intentos —
  uno `EN_PROCESO` con 60 consumidos, otro `PENDIENTE_MATERIAL` con 40
  pendientes; stock del item baja solo en 60.
- Iniciar etapa sin stock (0 disponible): un solo intento
  `PENDIENTE_MATERIAL`, nada se consume.
- `allocate_stage_attempt_material` con stock ahora completo: consume el
  resto, pasa a `EN_PROCESO` (si no hay otro intento activo).
- `allocate_stage_attempt_material` con stock todavía parcial: consume lo que
  alcanza, resta `quantity_pending`, se queda `PENDIENTE_MATERIAL`.
- `allocate_stage_attempt_material` con material completo pero otro intento
  `EN_PROCESO` en la misma orden: consume igual, pero no cambia de estado
  (sigue `PENDIENTE_MATERIAL`) hasta que se vuelve a llamar sin ese bloqueo.
- Cancelar una orden con un intento `EN_PROCESO` que ya consumió material:
  `cancel_run` restaura el stock consumido (cubre el fix de B.5).

### B.8 Fuera de alcance (limitación aceptada v1)

No hay forma de abandonar un intento `PENDIENTE_MATERIAL` individual sin
cancelar la orden entera (`cancel_run`). Es aceptable: `cancel_run` ya revierte
correctamente cualquier consumo parcial que ese intento haya alcanzado a
hacer (B.5), así que cancelar la orden completa es la vía de escape si un
split queda pendiente para siempre. Si en el futuro hace falta rechazar solo
el remanente sin tocar el resto de la orden, es una extensión aparte.

---

## Testing / verificación

- `docker-compose exec api pytest backend/tests/production` — suite completa
  del módulo tras cada sub-paso.
- `docker-compose exec api alembic upgrade head` — nueva migración de B.1.
- `docker-compose exec web npm run build` — tras los cambios de
  `production-dashboard.tsx`/`solicitudes-view.tsx`.
- Verificación manual en navegador: iniciar etapa con stock parcial, ver el
  split, asignar el remanente, y cancelar una orden con material consumido
  para confirmar que el stock vuelve.
