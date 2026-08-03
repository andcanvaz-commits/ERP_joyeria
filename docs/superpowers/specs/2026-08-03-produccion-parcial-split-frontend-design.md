# Frontend: split de producción por falta de materia prima

Fecha: 2026-08-03
Continúa: `docs/superpowers/plans/2026-07-31-produccion-parcial-split-backend.md` (backend completo, 10/10 tasks, mergeado en main).

## Contexto

El backend ya soporta que una orden de producción se "parta" automáticamente
cuando el stock de materia prima no alcanza para toda la cantidad pedida:

- `approve_materials` reduce la orden original a lo que el stock cubre y crea
  una corrida hija en estado `ESPERANDO_MATERIAL` (mismo `root_production_code`,
  `production_code` con sufijo `-B`, `-C`, ...).
- `POST /api/production/runs/{id}/allocate-material` (payload
  `{quantity_units}`, en piezas) permite a inventario destinar un ingreso
  nuevo a una corrida `ESPERANDO_MATERIAL`: si el ingreso no alcanza para
  toda la corrida, la parte de nuevo.
- `POST /api/inventory/movements` con `movement_type: "ENTRADA"` sobre un item
  `RAW_MATERIAL` devuelve `waiting_production_runs: WaitingProductionRunSummary[]`
  — las corridas `ESPERANDO_MATERIAL` que necesitan justo esa materia prima.

Nada de esto tiene todavía superficie en el frontend. Este spec cubre:

1. Modal automático "Destinar material" al registrar un ingreso.
2. Sección de solo lectura `ESPERANDO_MATERIAL` en el tablero de producción.
3. Badge de folio raíz donde una orden es parte de un split.

## Decisiones (confirmadas con el usuario)

- El modal de destinar material se **abre automáticamente** justo después de
  guardar un ingreso con `waiting_production_runs` no vacío. No es un banner
  descartable.
- La sección `ESPERANDO_MATERIAL` del tablero de producción es **solo
  lectura**. Destinar material se hace únicamente desde inventario — evita
  duplicar lógica de stock en dos pantallas.

## 1. Tipos y API

### `frontend/types/production/index.ts`

- `ProductionRun.status` agrega `"ESPERANDO_MATERIAL"` al union existente.
- `ProductionRun` agrega:
  - `root_production_code?: string | null`
  - `parent_run_id?: string | null`

### `frontend/types/inventory/index.ts`

- Nuevo tipo:

```ts
export type WaitingProductionRunSummary = {
  run_id: string;
  production_code: string | null;
  root_production_code: string | null;
  missing_quantity: string;
};
```

- `InventoryMovement` agrega `waiting_production_runs: WaitingProductionRunSummary[]`
  (siempre presente, default `[]` en el backend).

### `frontend/lib/production-api.ts`

Nueva función, mismo patrón que `approveProductionRunMaterials`:

```ts
export function allocateProductionRunMaterial(runId: string, quantityUnits: string) {
  return apiRequest<ProductionRun>(`/api/production/runs/${runId}/allocate-material`, {
    method: "POST",
    body: JSON.stringify({ quantity_units: quantityUnits }),
  });
}
```

## 2. Inventario — modal "Destinar material"

Archivo: `frontend/components/inventory/inventory-dashboard.tsx`.

- Nuevo estado local: `allocateModalRuns: WaitingProductionRunSummary[] | null`
  y, por fila, un mapa de cantidad editable (`Record<string, string>`,
  inicializado a `missing_quantity` de cada fila) y error inline por fila.
- En `handleCreateMovement`, tras el `await createInventoryMovement(...)`
  exitoso: si `movement.waiting_production_runs.length > 0`, setear
  `allocateModalRuns` con esa lista (además de cerrar el form de ingreso como
  ya hace hoy).
- Modal nuevo (reutiliza clases `modalWindow` / `modalHeader` / `button
  buttonPrimary` ya usadas en el archivo):
  - Título: "Órdenes esperando esta materia prima".
  - Texto: cuántas corridas están esperando, referencia al ingreso recién
    registrado.
  - Una fila por corrida: `orderCodeTag` con `production_code`; si
    `root_production_code !== production_code`, chip secundario "de
    {root_production_code}"; cantidad faltante; input numérico (entero, min
    1, max `missing_quantity`, default `missing_quantity`); botón "Destinar".
  - Al hacer click en "Destinar" de una fila: llama
    `allocateProductionRunMaterial(run_id, cantidad)`. Éxito → quita esa fila
    del estado local, invalida `["inventory"]` y `["production"]`. Error →
    guarda el mensaje del backend en el error inline de esa fila (no cierra
    el modal, no afecta otras filas).
  - El modal se puede cerrar en cualquier momento (botón "Cerrar" /
    click fuera, mismo patrón que otros modales del archivo). Filas no
    resueltas simplemente no se destinan ahora; seguirán apareciendo en
    `ESPERANDO_MATERIAL` en el tablero de producción y en el próximo ingreso
    de esa materia prima.
- Validación de cantidad: mismo criterio que el backend (entero, >0, ≤
  missing_quantity) para dar feedback antes del round-trip; el backend queda
  como fuente de verdad si igual se manda algo inválido.

## 3. Producción — sección `ESPERANDO_MATERIAL` y badge de folio raíz

Archivo: `frontend/components/production/production-dashboard.tsx`.

- Nuevo derivado: `waitingMaterialRuns = runs.filter((run) => run.status === "ESPERANDO_MATERIAL")`.
- Nueva stat card en `productionStatsRow`, junto a las 4 existentes:
  `{waitingMaterialRuns.length}` / "Esperando material".
- Nueva sección (mismo patrón visual que "En proceso": `card panelBody` +
  `productionRunsVertical` con filas `productionRunListRow`), sin botón de
  acción por fila (es solo lectura):
  - Título "Esperando material" + subtítulo con el conteo.
  - Cada fila: `orderCodeTag` con `production_code`; si
    `root_production_code && root_production_code !== production_code`, chip
    "de {root_production_code}" junto al código; nombre del proceso; cantidad
    faltante (`{numericText(run.quantity)} und`); `StatusPunch` tono
    `warning` con label "Esperando material".
  - Empty state: "No hay órdenes esperando material." cuando la lista está
    vacía (sección puede ocultarse si count es 0 para no ocupar espacio
    permanente — igual criterio que otras secciones condicionales del
    archivo).
- `runStatusLabel` y `runStatusTone`: agregar entrada `ESPERANDO_MATERIAL` →
  label "Esperando material", tono `warning`.
- Badge de folio raíz reutilizable: donde ya se pinta `orderCodeTag` con
  `run.production_code` (tabla "Procesos" fila ~1780, lista "En proceso" fila
  ~1715, modal de detalle ~1855, stats modal ~2759), agregar junto al chip
  existente un chip secundario condicional cuando
  `run.root_production_code && run.root_production_code !== run.production_code`:
  texto "de {root_production_code}", mismo tamaño/familia tipográfica que
  `orderCodeTag` pero tono neutro (no el dorado de `orderCodeTag`, para no
  competir visualmente con el código principal).

## Fuera de alcance

- Acción de "destinar material" desde el tablero de producción (decidido:
  solo lectura ahí).
- Notificaciones push/email cuando llega el ingreso que resuelve una espera.
- Tests automatizados de frontend (el repo no tiene infraestructura de tests
  de frontend hoy; validación es manual en navegador).

## Plan de verificación manual

1. Crear una orden cuya materia prima no alcance para toda la cantidad →
   aprobar materiales desde inventario → confirmar que la orden padre queda
   `MATERIALES_APROBADOS`/avanza normalmente y aparece una nueva corrida
   `ESPERANDO_MATERIAL` en el tablero de producción con folio `-B` y chip "de
   {folio raíz}".
2. Registrar un ingreso de esa misma materia prima → confirmar que el modal
   "Destinar material" se abre solo, listando la corrida `-B`.
3. Destinar menos unidades de las que faltan → confirmar que se crea `-C`
   `ESPERANDO_MATERIAL` con el remanente y `-B` queda `EN_PROCESO`.
4. Destinar el resto en un segundo ingreso → confirmar que `-C` también
   arranca y ya no quedan corridas esperando esa materia prima (sección
   `ESPERANDO_MATERIAL` vacía / oculta).
5. Probar el caso de error: intentar destinar más unidades de las que la
   corrida necesita → confirmar mensaje de error inline sin cerrar el modal.
