# Línea de acta agregada por admin, enlazada a inventario real — Design

## Contexto

Hoy la acta (`ProductionRunActaLine`, pieza B/C del plan de totales) ya soporta
líneas `MANUAL`: se editan y se borran (`update_acta_line`/`delete_acta_line`,
`acta-side.tsx`), pero **nunca mueven inventario real** — son puramente de
papel. El único código que las crea hoy es el flujo interno "devolver
sobrante" (`RecepcionActions` en `acta-view.tsx`, vía `addActaLine`). No existe
ningún botón para que un usuario agregue una fila nueva en blanco.

El usuario pidió una forma de que el **admin** agregue a la acta, en cualquier
momento del proceso e incluso desde Documentos, algo que se le haya pasado:
- Si el item existe en inventario, elegirlo de una búsqueda (no un texto libre
  que dependa de escribir el nombre exacto) y que **descuente/sume stock real
  de inmediato, sin pasar por el circuito de aprobación** (a diferencia de
  "material adicional", que sí requiere aprobación de inventario).
- Si no lo encuentra, escribirlo a mano igual, pero eligiendo la unidad de una
  lista (no texto libre) — y esa línea **no** toca inventario real, con aviso
  visible de eso.

Es un solo flujo con una bifurcación en el momento de cargar el dato, no dos
features separadas.

## Modelo

Nuevo valor en `ActaLineSource` (`backend/modules/production/models.py`):

```python
class ActaLineSource(str, enum.Enum):
    PLAN = "PLAN"
    AUTO = "AUTO"
    MANUAL = "MANUAL"
    # Agregada por el admin desde el nuevo boton "+", enlazada a un
    # InventoryItem real -- a diferencia de MANUAL, esta SI genero un
    # InventoryMovement real (ver seccion "Movimiento de inventario").
    ADMIN_STOCK = "ADMIN_STOCK"
```

`MANUAL` no cambia de significado (sigue sin tocar stock nunca) — el
formulario de texto libre del nuevo botón sigue creando líneas `MANUAL`, igual
que hoy. Sin tabla nueva, sin columnas nuevas, sin migración.

## Backend — Schemas (`backend/modules/production/schemas.py`)

```python
class AdminActaLineCreate(BaseModel):
    model_config = ConfigDict(extra="forbid")

    side: Literal["ENTREGA", "RECEPCION"]
    # Si viene, la linea se enlaza a este item real y mueve inventario.
    # Si es None, es una linea libre (label/unit_code obligatorios).
    item_id: UUID | None = None
    label: str | None = Field(default=None, min_length=1, max_length=180)
    quantity: Decimal = Field(gt=0)
    unit_code: str | None = Field(default=None, min_length=1, max_length=20)
    note: str | None = Field(default=None, max_length=500)
```

Validación en el service (no en el schema, necesita el `InventoryItem`):
- `item_id is None` → `label` y `unit_code` son obligatorios (si falta
  alguno, `ProductionDomainError`).
- `item_id is not None` → se ignoran `label`/`unit_code` si vinieran, se
  toman siempre de `item.name`/`item.unit_code` (mismo criterio que ya usan
  `approve_additional_material` y `_sync_entrega_acta_line`: el nombre real
  del item, no lo que haya escrito el usuario).

## Backend — Service (`backend/modules/production/service.py`)

**`add_admin_acta_line(run_id, payload, current_user) -> ProductionRunRead`**
- `run = self.repository.get_run(run_id)`; 404 si no existe.
- Sin restricción de `run.status` (aplica "en cualquier parte del proceso",
  igual que `add_acta_line` hoy) salvo que la orden tenga `event_lines`
  (histórica) — ahí se rechaza igual que ya rechaza `receive_finished_product`
  (`ProductionDomainError`, mismo mensaje que ese guard existente).
- Si `payload.item_id is None`: crea la línea directo (sin pasar por
  `_add_or_merge_acta_line` — ver nota abajo), `source=ActaLineSource.MANUAL`,
  `label=payload.label.strip()`, `unit_code=payload.unit_code.strip()`,
  `item_id=None`, sin movimiento de inventario.
- Si `payload.item_id is not None`:
  - Resuelve el `InventoryItem`; 404 de dominio si no existe.
  - Crea la línea con `source=ActaLineSource.ADMIN_STOCK`, `label=item.name`,
    `unit_code=item.unit_code`, `item_id=item.id`.
  - `self.repository.flush()` (necesita el `id` de la línea antes de mover
    inventario, para el `reference_id`).
  - Llama `self._apply_admin_acta_line_delta(line, payload.quantity,
    current_user)` (ver abajo) para aplicar el movimiento real.
- `flush()`, devuelve `self._read_with_names(run)`.

**Nota — no reusa `_add_or_merge_acta_line`.** Esa función fusiona con una
línea existente del mismo lado+`item_id` (para no duplicar filas cuando se
vuelve a pedir lo mismo). Para `ADMIN_STOCK` eso es peligroso: si el item
coincide con el de una línea `PLAN`/`AUTO` ya existente (ej. la propia materia
prima), fusionarse le heredaría ese `source` y la línea dejaría de poder
borrarse/revertirse (el guard de borrado exige `source` editable). Cada
corrección de admin es siempre su propia fila nueva, siempre
`source=ADMIN_STOCK`, sin excepción.

**`_apply_admin_acta_line_delta(self, line, new_quantity, current_user) -> None`**
Aplica solo la diferencia entre lo ya movido para esta línea y `new_quantity`
— nunca edita un movimiento existente (regla del proyecto: todo cambio de
stock nace de un `InventoryMovement` nuevo, ver `CLAUDE.md`). Se usa tanto al
crear la línea (`new_quantity = payload.quantity`, nada movido todavía) como
al editar su cantidad, como al borrarla (`new_quantity = 0`).

```python
def _apply_admin_acta_line_delta(
    self, line: ProductionRunActaLine, new_quantity: Decimal, current_user: CurrentUser
) -> None:
    if line.item_id is None:
        return  # linea libre, nunca mueve inventario
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
```

`reference_type="production_run_acta_line"` es nuevo (los demás usan
`"production_run"`) — a propósito, para poder aislar el rastro de exactamente
esta línea sin mezclarse con el resto de movimientos de la corrida.

**`update_acta_line`** (existente, se extiende): si `line.source ==
ActaLineSource.ADMIN_STOCK` y `payload.quantity is not None`, después de
aplicar `line.quantity = payload.quantity` llama
`self._apply_admin_acta_line_delta(line, payload.quantity, current_user)`
antes del `flush()` final. Si `payload.label`/`payload.unit_code` vienen para
una línea `ADMIN_STOCK`, se ignoran (el nombre/unidad los define el item, no
se editan a mano) — devuelve `ProductionDomainError` si se intenta, para que
el frontend directamente no ofrezca esos campos en el editor de estas líneas.

**`delete_acta_line`** (existente, se extiende): el guard pasa a aceptar
`source in (ActaLineSource.MANUAL, ActaLineSource.ADMIN_STOCK)`. Si es
`ADMIN_STOCK`, antes de `run.acta_lines.remove(line)` llama
`self._apply_admin_acta_line_delta(line, Decimal("0"), current_user)` para
revertir el stock que quedara neto.

## Backend — Router

```
POST /runs/{run_id}/acta-lines/admin    production.acta-lines.admin-stock
```

Nuevo permiso en `ADMIN_ONLY_PRODUCTION_PERMISSIONS` (`router.py`):

```python
"production.acta-lines.admin-stock": "Solo el administrador puede agregar una linea de acta enlazada a inventario o de texto libre desde este boton.",
```

El endpoint existente `POST /runs/{run_id}/acta-lines` (`add_acta_line`) **no
se toca** — sigue con `production.runs.update`, lo sigue usando solo el flujo
interno de "devolver sobrante". `update_acta_line`/`delete_acta_line` (mismos
endpoints existentes) tampoco cambian de permiso: siguen en
`production.runs.update`, la restricción admin-only para `ADMIN_STOCK` ya la
impone el propio guard del service (nadie más pudo haber creado una línea con
ese `source`, así que en la práctica solo un admin edita/borra una).

## Frontend

**`acta-side.tsx`**: nuevo botón "+ Agregar línea" al pie de la tabla (junto a
`footer`), solo si el caller pasa `onAddLine` (igual patrón que
`onEditLine`/`onDeleteLine` — opcional, así Documentos puede omitirlo si algún
caso no aplica). Abre un modal de dos pasos:
1. `MaterialCategoryPicker` con `allowedTypes` = los 6 tipos de
   `InventoryItemType` (sin filtrar), buscador ya existente hace de
   "reconocer coincidencia" — no hace falta un fuzzy-matcher nuevo. Al elegir
   un item, pide cantidad (`quantityStep`, ya soportado por el picker) y
   confirma → `addAdminActaLine(runId, { side, item_id, quantity })`.
2. Link "No lo encuentro, escribir a mano" cambia a un formulario: input de
   label + input de cantidad + `<select>` de unidad (poblado con
   `listUnits()`, solo `is_active`) + texto fijo "Esta línea no descuenta del
   inventario" → confirma → `addAdminActaLine(runId, { side, label, quantity,
   unit_code })` (sin `item_id`).

Edición de una línea `ADMIN_STOCK` existente (pencil icon, ya soportado por
`ActaSide`): el formulario inline de edición solo muestra el campo cantidad
(no label/unidad, vienen del item) cuando `line.source === "ADMIN_STOCK"`
— se distingue de una `MANUAL` (que sigue editando los tres campos como hoy)
por un nuevo campo `source` que se agrega a `ActaSideLine`.

**`lib/production-api.ts`**: nueva función
`addAdminActaLine(runId, payload)` → `POST /api/production/runs/{runId}/acta-lines/admin`.

**`lib/orden-produccion.ts`**: `ActaSideLine` (variante `row`) agrega
`source: string` (ya viaja en `ActaLineRead`, solo falta mapearlo al armar
`entregaLines`/`recepcionLines` en `buildRunActaSides`/`buildFamilyActaSides`/
`entregaRowsForRun`/etc.) y `editable` pasa a ser verdadero también para
`ADMIN_STOCK` además de `MANUAL` (hoy probablemente ya filtra por
`source === "MANUAL"` en esos builders — hay que revisar cada sitio donde se
arma `editable` y agregar la condición).

**`acta-view.tsx`** (Ver Acta, un solo run): pasa `onAddLine` a ambos
`ActaSide`, solo si `currentUser.role` es admin (mismo criterio que ya usa el
frontend en otros lados — el backend igual lo re-valida). `side` fijo según
cuál instancia de `ActaSide` sea (ENTREGA/RECEPCION), `runId = run.id`.

**Documentos** (`orden-produccion-doc.tsx` + su padre en
`components/documentos/`): mismo `onAddLine`, gateado admin igual, pero el
`runId` que recibe el padre para pasar hacia abajo es siempre
`family.find(r => !r.parent_run_id)?.id ?? family[0].id` (el root de la
familia — mismo criterio que ya usa `buildFamilyActaSides`/
`buildOrdenProduccion` para elegir el run "representativo"). Sin split
(`family.length === 1`) es simplemente ese único run. Se omite el botón por
completo si la familia es histórica (`event_lines` no vacío en algún
miembro) — mismo criterio ya usado para excluir a las históricas del resto de
esta lógica de acta viva.

## Qué NO hace esta pieza

- No agrega conversión de unidades a los totales: si el admin agrega una
  línea en una unidad distinta a `run.raw_material_unit_code`, aparece en la
  tabla pero no entra a "Total entregado"/"Total recibido" — mismo
  comportamiento que ya tienen hoy insumos/complementos con otra unidad.
- No cambia el endpoint/flujo de "material adicional" (con aprobación) ni el
  de "devolver sobrante" — siguen exactamente igual.
- No permite editar `label`/`unit_code` de una línea `ADMIN_STOCK` (vienen
  fijos del item); si el item elegido fue el equivocado, se borra (revierte
  stock) y se agrega de nuevo con el correcto.

## Testing

- `backend/tests/production/test_admin_acta_line.py`:
  - Crear línea con `item_id` en ENTREGA baja `InventoryItem.current_stock`
    real y genera `InventoryMovement(movement_type=CONSUMO_PRODUCCION,
    reference_type="production_run_acta_line")`.
  - Crear línea con `item_id` en RECEPCION sube el stock
    (`DEVOLUCION_PRODUCCION`).
  - Crear línea sin `item_id` (label+unit_code) no genera ningún
    `InventoryMovement`.
  - Editar la cantidad de una línea `ADMIN_STOCK` hacia arriba/abajo genera
    exactamente el movimiento delta esperado (no dos movimientos completos).
  - Borrar una línea `ADMIN_STOCK` revierte el stock a como estaba antes de
    crearla (verificar `current_stock` antes/después del ciclo
    crear→editar→borrar).
  - Borrar deja stock negativo si ya no hay suficiente → `ProductionDomainError`,
    la línea NO se borra (se queda como estaba).
  - Falta `item_id` y falta `label`/`unit_code` → error de validación.
  - Endpoint sin rol admin → 403 (probar con "Jefe de producción" y "Jefe de
    inventario", ambos con `production.runs.update` pero no admin).
  - Orden con `event_lines` (histórica) → `ProductionDomainError` al intentar
    agregar.
- Suite completa de producción e inventario después del cambio
  (`docker-compose exec api pytest`).
- `docker-compose exec web npm run build`.
- Manual en navegador: agregar línea enlazada en ENTREGA de una orden
  `EN_PROCESO` real, confirmar que el stock del item bajó en Inventario;
  agregar línea libre, confirmar que aparece con el aviso y no se movió
  stock; borrar la enlazada, confirmar que el stock volvió; repetir todo
  desde Documentos con una orden con split.
