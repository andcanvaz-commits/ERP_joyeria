# Frontend: split de producción por falta de materia prima — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Dar superficie en el frontend a lo que el backend ya soporta: split automático de una orden de producción por falta de materia prima, y el endpoint para que inventario "destine" un ingreso nuevo a la corrida que quedó esperando.

**Architecture:** Cambios puramente de frontend (Next.js/React/TS) sobre `frontend/components/inventory/inventory-dashboard.tsx` y `frontend/components/production/production-dashboard.tsx`, más los tipos y funciones de API que consumen. Ningún endpoint nuevo — todo ya existe en `backend/modules/production` y `backend/modules/inventory` (mergeado en main).

**Tech Stack:** Next.js 16, React 18, TypeScript strict, TanStack Query, Lucide icons. Sin infraestructura de tests de frontend en este repo — la verificación de cada tarea es `npx tsc --noEmit` dentro del contenedor `erp_joyeria-web-1`, y la verificación final es manual en navegador.

## Global Constraints

- No hardcodear nombres de procesos/etapas/materiales (CLAUDE.md regla 1-4) — no aplica aquí, este trabajo es sobre estado (`ESPERANDO_MATERIAL`) y folios, no sobre procesos de joyería.
- Backend ya completo y no se toca en este plan.
- `AllocateMaterialPayload.quantity_units` es Decimal `decimal_places=0` (piezas enteras), `gt=0`, máximo = `missing_quantity` de esa corrida (el backend lo valida con "No puedes destinar mas unidades de las que la orden necesita.").
- Seguir el patrón visual existente del archivo que se edita (clases `modalWindow`, `modalHeader`, `modalActions`, `orderCodeTag`, `StatusPunch`, `emptyState`, `productionStatCard`, `productionRunListRow`) — no introducir un sistema de diseño paralelo.
- Verificación de tipos: `docker exec erp_joyeria-web-1 npx tsc --noEmit` (contenedor ya expone `/app` como raíz de `frontend/`). Confirmado limpio (sin errores) antes de empezar este plan.

---

### Task 1: Tipos — `ProductionRun` con estado y campos de split

**Files:**
- Modify: `frontend/types/production/index.ts`

**Interfaces:**
- Produces: `ProductionRun.status` incluye `"ESPERANDO_MATERIAL"`; `ProductionRun.root_production_code?: string | null`; `ProductionRun.parent_run_id?: string | null` — los consumen Task 4, 5, 6.

- [ ] **Step 1: Agregar el estado y los campos al tipo**

En `frontend/types/production/index.ts`, el tipo `ProductionRun` (líneas 86-144) tiene:

```ts
  status:
    | "PENDIENTE_INVENTARIO"
    | "MATERIALES_APROBADOS"
    | "EN_PROCESO"
    | "PENDIENTE_RECEPCION"
    | "RECIBIDA"
    | "CANCELADA";
```

Cambiar a:

```ts
  status:
    | "PENDIENTE_INVENTARIO"
    | "MATERIALES_APROBADOS"
    | "EN_PROCESO"
    | "PENDIENTE_RECEPCION"
    | "RECIBIDA"
    | "CANCELADA"
    | "ESPERANDO_MATERIAL";
```

Y en la misma interfaz, justo debajo de `production_code?: string | null;` (línea 90), agregar:

```ts
  // Folio de la orden original cuando esta corrida nacio de un split por
  // falta de materia prima (null si nunca se partio).
  root_production_code?: string | null;
  // Corrida padre de la que se partio esta (null si es la original).
  parent_run_id?: string | null;
```

- [ ] **Step 2: Verificar que el proyecto tipa sin errores**

Run: `docker exec erp_joyeria-web-1 npx tsc --noEmit`
Expected: sin salida (0 errores). El error esperable en este punto sería en `production-dashboard.tsx` si `runStatusLabel`/`runStatusTone` usan `Record<ProductionRun["status"], ...>` sin cubrir el nuevo valor — confirmarlo (ver Task 4).

- [ ] **Step 3: Commit**

```bash
git add frontend/types/production/index.ts
git commit -m "feat(produccion): tipos frontend para estado ESPERANDO_MATERIAL y folio raiz"
```

---

### Task 2: Tipos — aviso de órdenes esperando material en inventario

**Files:**
- Modify: `frontend/types/inventory/index.ts`

**Interfaces:**
- Produces: `WaitingProductionRunSummary { run_id: string; production_code: string | null; root_production_code: string | null; missing_quantity: string }`; `InventoryMovement.waiting_production_runs: WaitingProductionRunSummary[]` — los consume Task 6.

- [ ] **Step 1: Agregar el tipo y el campo**

En `frontend/types/inventory/index.ts`, antes de `export type InventoryMovement = {` (línea 43), agregar:

```ts
export type WaitingProductionRunSummary = {
  run_id: string;
  production_code: string | null;
  root_production_code: string | null;
  missing_quantity: string;
};

```

Y dentro de `InventoryMovement`, después del campo `item: InventoryItem;` (línea 58), agregar:

```ts
  // Ordenes ESPERANDO_MATERIAL de esta materia prima: solo viene poblado en
  // la respuesta de un movimiento ENTRADA sobre un item RAW_MATERIAL.
  waiting_production_runs: WaitingProductionRunSummary[];
```

- [ ] **Step 2: Verificar que el proyecto tipa sin errores**

Run: `docker exec erp_joyeria-web-1 npx tsc --noEmit`
Expected: sin salida.

- [ ] **Step 3: Commit**

```bash
git add frontend/types/inventory/index.ts
git commit -m "feat(inventario): tipo WaitingProductionRunSummary en el frontend"
```

---

### Task 3: API — destinar material a una corrida

**Files:**
- Modify: `frontend/lib/production-api.ts`

**Interfaces:**
- Consumes: `ProductionRun` (Task 1).
- Produces: `allocateProductionRunMaterial(runId: string, quantityUnits: string): Promise<ProductionRun>` — lo consume Task 6.

- [ ] **Step 1: Agregar la función**

En `frontend/lib/production-api.ts`, después de `approveProductionRunMaterials` (líneas 108-112), agregar:

```ts
export function allocateProductionRunMaterial(runId: string, quantityUnits: string) {
  return apiRequest<ProductionRun>(`/api/production/runs/${runId}/allocate-material`, {
    method: "POST",
    body: JSON.stringify({ quantity_units: quantityUnits }),
  });
}
```

- [ ] **Step 2: Verificar que el proyecto tipa sin errores**

Run: `docker exec erp_joyeria-web-1 npx tsc --noEmit`
Expected: sin salida.

- [ ] **Step 3: Commit**

```bash
git add frontend/lib/production-api.ts
git commit -m "feat(produccion): funcion API allocateProductionRunMaterial"
```

---

### Task 4: Producción — soporte de estado ESPERANDO_MATERIAL y badge de folio raíz

**Files:**
- Modify: `frontend/components/production/production-dashboard.tsx`
- Modify: `frontend/app/globals.css`

**Interfaces:**
- Consumes: `ProductionRun.status === "ESPERANDO_MATERIAL"`, `root_production_code`, `parent_run_id` (Task 1).
- Produces: `waitingMaterialRuns: ProductionRun[]` (derivado), `runStatusLabel`/`runStatusTone` cubriendo `ESPERANDO_MATERIAL`, `rootBadge(run: ProductionRun): JSX.Element | null` — los consume Task 5 (misma sesión de edición, este task ya deja `rootBadge` aplicado en los 4 sitios existentes donde se pinta `production_code`).

- [ ] **Step 1: CSS del badge secundario**

En `frontend/app/globals.css`, después del bloque `.orderCodeTag.metalPlata { ... }` (termina en la línea con `border: 1px solid #D5DBE1;` seguida de `}`, alrededor de la línea 3610), agregar:

```css
/* Chip secundario: indica que esta orden es parte de un folio raiz (split
   por falta de materia prima). Tono neutro para no competir con el
   orderCodeTag principal. */
.rootBadgeTag {
  display: inline-block;
  margin-right: 6px;
  border-radius: 4px;
  background: var(--surface-muted);
  color: var(--muted);
  font-family: var(--font-mono, ui-monospace), monospace;
  font-size: 10px;
  font-weight: 600;
  padding: 1px 6px;
  vertical-align: middle;
}
```

- [ ] **Step 2: Derivado `waitingMaterialRuns`**

En `frontend/components/production/production-dashboard.tsx`, la línea:

```ts
  const finishedRuns = runs.filter((run) => run.status === "PENDIENTE_RECEPCION" || run.status === "RECIBIDA");
```

Agregar justo debajo:

```ts
  const waitingMaterialRuns = runs.filter((run) => run.status === "ESPERANDO_MATERIAL");
```

- [ ] **Step 3: `runStatusLabel` y `runStatusTone`**

Cambiar:

```ts
  function runStatusLabel(status: ProductionRun["status"]) {
    const labels: Record<ProductionRun["status"], string> = {
      PENDIENTE_INVENTARIO: "Pendiente de Inventario",
      MATERIALES_APROBADOS: "Lista para iniciar",
      EN_PROCESO: "En proceso",
      PENDIENTE_RECEPCION: "Pendiente de recepción",
      RECIBIDA: "Recibida",
      CANCELADA: "Cancelada",
    };
    return labels[status] ?? status;
  }
```

a:

```ts
  function runStatusLabel(status: ProductionRun["status"]) {
    const labels: Record<ProductionRun["status"], string> = {
      PENDIENTE_INVENTARIO: "Pendiente de Inventario",
      MATERIALES_APROBADOS: "Lista para iniciar",
      EN_PROCESO: "En proceso",
      PENDIENTE_RECEPCION: "Pendiente de recepción",
      RECIBIDA: "Recibida",
      CANCELADA: "Cancelada",
      ESPERANDO_MATERIAL: "Esperando material",
    };
    return labels[status] ?? status;
  }
```

Y cambiar:

```ts
  function runStatusTone(status: ProductionRun["status"]): "neutral" | "active" | "done" | "danger" | "warning" {
    const tones: Record<ProductionRun["status"], "neutral" | "active" | "done" | "danger" | "warning"> = {
      PENDIENTE_INVENTARIO: "warning",
      MATERIALES_APROBADOS: "active",
      EN_PROCESO: "active",
      PENDIENTE_RECEPCION: "warning",
      RECIBIDA: "done",
      CANCELADA: "danger",
    };
    return tones[status] ?? "neutral";
  }
```

a:

```ts
  function runStatusTone(status: ProductionRun["status"]): "neutral" | "active" | "done" | "danger" | "warning" {
    const tones: Record<ProductionRun["status"], "neutral" | "active" | "done" | "danger" | "warning"> = {
      PENDIENTE_INVENTARIO: "warning",
      MATERIALES_APROBADOS: "active",
      EN_PROCESO: "active",
      PENDIENTE_RECEPCION: "warning",
      RECIBIDA: "done",
      CANCELADA: "danger",
      ESPERANDO_MATERIAL: "warning",
    };
    return tones[status] ?? "neutral";
  }
```

- [ ] **Step 4: Helper `rootBadge`**

Justo después del cierre de `runStatusTone` (después de `return tones[status] ?? "neutral"; }`) y antes de `function buildCalendarDays(monthKey: string) {`, agregar:

```ts
  // Chip "de <folio raiz>": solo cuando esta corrida es parte de un split
  // (su folio raiz existe y es distinto de su propio folio).
  function rootBadge(run: ProductionRun) {
    if (!run.root_production_code || run.root_production_code === run.production_code) return null;
    return (
      <span className="rootBadgeTag" title={`Parte de la orden ${run.root_production_code}`}>
        de {run.root_production_code}
      </span>
    );
  }
```

- [ ] **Step 5: Aplicar `rootBadge` en los 4 sitios donde se pinta `production_code`**

Sitio A — lista "En proceso" (dentro de `productionRunListRowHead`):

```tsx
                            {run.production_code ? (
                              <span style={{ fontFamily: "monospace", fontSize: 10, color: "var(--primary-strong)", fontWeight: 700, background: "#f3e9d6", borderRadius: 4, padding: "1px 5px", flexShrink: 0 }}>{run.production_code}</span>
                            ) : null}
                            <strong style={{ fontSize: 13, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{run.process_name}</strong>
```

a:

```tsx
                            {run.production_code ? (
                              <span style={{ fontFamily: "monospace", fontSize: 10, color: "var(--primary-strong)", fontWeight: 700, background: "#f3e9d6", borderRadius: 4, padding: "1px 5px", flexShrink: 0 }}>{run.production_code}</span>
                            ) : null}
                            {rootBadge(run)}
                            <strong style={{ fontSize: 13, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{run.process_name}</strong>
```

Sitio B — tabla "Procesos":

```tsx
                        <td>{run.production_code ? <span className="orderCodeTag">{run.production_code}</span> : "—"}</td>
```

a:

```tsx
                        <td>{run.production_code ? <span className="orderCodeTag">{run.production_code}</span> : "—"}{rootBadge(run)}</td>
```

Sitio C — lista "Finalizadas recientes":

```tsx
                        {run.production_code ? <span className="orderCodeTag">{run.production_code}</span> : null}
                        {run.process_name}
```

a:

```tsx
                        {run.production_code ? <span className="orderCodeTag">{run.production_code}</span> : null}
                        {rootBadge(run)}
                        {run.process_name}
```

Sitio D — encabezado del modal de gestión de etapas:

```tsx
                  {selectedRunForStages.production_code ? (
                    <span style={{ display: "inline-block", marginRight: 10, fontFamily: "monospace", fontSize: 13, color: "var(--primary-strong)", fontWeight: 700, background: "#f3e9d6", borderRadius: 5, padding: "2px 8px" }}>{selectedRunForStages.production_code}</span>
```

a:

```tsx
                  {selectedRunForStages.production_code ? (
                    <span style={{ display: "inline-block", marginRight: 10, fontFamily: "monospace", fontSize: 13, color: "var(--primary-strong)", fontWeight: 700, background: "#f3e9d6", borderRadius: 5, padding: "2px 8px" }}>{selectedRunForStages.production_code}</span>
```

(Sitio D queda tal cual el texto de apertura — agregar `{rootBadge(selectedRunForStages)}` inmediatamente después del `</span>` de cierre de ese bloque condicional, antes de que continúe el resto del header. Confirmar con `Read` la línea exacta donde cierra el `) : null}` de ese condicional antes de insertar, ya que el snippet de arriba está cortado por brevedad.)

- [ ] **Step 6: Verificar que el proyecto tipa sin errores**

Run: `docker exec erp_joyeria-web-1 npx tsc --noEmit`
Expected: sin salida.

- [ ] **Step 7: Commit**

```bash
git add frontend/components/production/production-dashboard.tsx frontend/app/globals.css
git commit -m "feat(produccion): estado ESPERANDO_MATERIAL y badge de folio raiz en tablero"
```

---

### Task 5: Producción — stat card y sección de solo lectura ESPERANDO_MATERIAL

**Files:**
- Modify: `frontend/components/production/production-dashboard.tsx`

**Interfaces:**
- Consumes: `waitingMaterialRuns`, `runStatusTone`, `rootBadge` (Task 4).

- [ ] **Step 1: Nueva stat card**

Cambiar:

```tsx
          <section className="productionStatsRow" aria-label="Metricas de produccion">
            <div className="productionStatCard">
              <strong>{runs.filter((r) => r.status === "PENDIENTE_INVENTARIO").length}</strong>
              <span>Esperando inventario</span>
            </div>
            <div className="productionStatCard">
              <strong>{approvedMaterialRuns.length}</strong>
              <span>Listas para iniciar</span>
            </div>
```

a:

```tsx
          <section className="productionStatsRow" aria-label="Metricas de produccion">
            <div className="productionStatCard">
              <strong>{runs.filter((r) => r.status === "PENDIENTE_INVENTARIO").length}</strong>
              <span>Esperando inventario</span>
            </div>
            <div className="productionStatCard">
              <strong>{waitingMaterialRuns.length}</strong>
              <span>Esperando material</span>
            </div>
            <div className="productionStatCard">
              <strong>{approvedMaterialRuns.length}</strong>
              <span>Listas para iniciar</span>
            </div>
```

- [ ] **Step 2: Nueva sección, entre "Main grid" y "Procesos"**

Cambiar:

```tsx
              ) : (
                <div className="emptyState">No hay procesos en transcurso.</div>
              )}
            </article>
          </section>

          {/* Procesos: listos para iniciar, en curso y terminados, en un solo lugar. */}
          <section className="card panelBody" aria-label="Procesos">
```

a:

```tsx
              ) : (
                <div className="emptyState">No hay procesos en transcurso.</div>
              )}
            </article>
          </section>

          {/* Ordenes que un split dejo esperando material: solo lectura aqui,
              se resuelven desde inventario (ver modal "Destinar material"). */}
          <section className="card panelBody" aria-label="Esperando material">
            <div className="panelHeader">
              <div>
                <h2 className="panelTitle">Esperando material</h2>
                <p className="panelText">{waitingMaterialRuns.length} {waitingMaterialRuns.length === 1 ? "orden espera" : "ordenes esperan"} materia prima</p>
              </div>
            </div>
            {waitingMaterialRuns.length > 0 ? (
              <div className="productionRunsVertical">
                {waitingMaterialRuns.map((run) => (
                  <div className="productionRunListRow" key={run.id}>
                    <div className="productionRunListRowHead">
                      <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0, overflow: "hidden" }}>
                        {run.production_code ? (
                          <span style={{ fontFamily: "monospace", fontSize: 10, color: "var(--primary-strong)", fontWeight: 700, background: "#f3e9d6", borderRadius: 4, padding: "1px 5px", flexShrink: 0 }}>{run.production_code}</span>
                        ) : null}
                        {rootBadge(run)}
                        <strong style={{ fontSize: 13, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{run.process_name}</strong>
                      </div>
                      <StatusPunch label={runStatusLabel(run.status)} tone={runStatusTone(run.status)} />
                    </div>
                    <div className="productionRunListRowMeta">
                      <span>Faltan {numericText(run.quantity)} und</span>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="emptyState">No hay ordenes esperando material.</div>
            )}
          </section>

          {/* Procesos: listos para iniciar, en curso y terminados, en un solo lugar. */}
          <section className="card panelBody" aria-label="Procesos">
```

- [ ] **Step 3: Verificar que el proyecto tipa sin errores**

Run: `docker exec erp_joyeria-web-1 npx tsc --noEmit`
Expected: sin salida.

- [ ] **Step 4: Commit**

```bash
git add frontend/components/production/production-dashboard.tsx
git commit -m "feat(produccion): seccion de solo lectura para ordenes ESPERANDO_MATERIAL"
```

---

### Task 6: Inventario — modal automático "Destinar material"

**Files:**
- Modify: `frontend/components/inventory/inventory-dashboard.tsx`

**Interfaces:**
- Consumes: `WaitingProductionRunSummary` (Task 2), `allocateProductionRunMaterial` (Task 3).

- [ ] **Step 1: Imports**

Cambiar:

```ts
import {
  approveProductionRunMaterials,
  rejectProductionRunMaterials,
  listProductionRuns,
  receiveProductionRunFinishedProduct,
} from "@/lib/production-api";
import type { InventoryItem, InventoryItemType, InventoryMovement, InventoryMovementType } from "@/types/inventory";
```

a:

```ts
import {
  allocateProductionRunMaterial,
  approveProductionRunMaterials,
  rejectProductionRunMaterials,
  listProductionRuns,
  receiveProductionRunFinishedProduct,
} from "@/lib/production-api";
import type { InventoryItem, InventoryItemType, InventoryMovement, InventoryMovementType, WaitingProductionRunSummary } from "@/types/inventory";
```

- [ ] **Step 2: Estado del modal**

Buscar la declaración de estado `isComplementPickerOpen` (o cualquier `useState` cercano a los estados de movimiento — usar `Grep` para `isMovementFormOpen` en el archivo si la referencia exacta se movió) y agregar junto a los demás `useState` de nivel de componente:

```ts
  const [allocateRuns, setAllocateRuns] = useState<WaitingProductionRunSummary[]>([]);
  const [allocateQuantities, setAllocateQuantities] = useState<Record<string, string>>({});
  const [allocateErrors, setAllocateErrors] = useState<Record<string, string>>({});
  const [allocatingRunId, setAllocatingRunId] = useState<string | null>(null);
```

- [ ] **Step 3: Trigger tras registrar el ingreso**

Cambiar (`handleCreateMovement`, ~línea 1528):

```ts
      await createInventoryMovement({
        ...movementForm,
        unit_cost: unitCost,
        // Motivo ya no se pide en el formulario; se usa uno por defecto.
        reason: movementForm.reason?.trim() || "Ingreso de materia prima",
        reference_type: null,
        reference_id: null,
      });
      setSuccess("Movimiento registrado correctamente.");
      setIsMovementFormOpen(false);
      setMovementForm(emptyMovementForm());
      await queryClient.invalidateQueries({ queryKey: ["inventory"] });
```

a:

```ts
      const created = await createInventoryMovement({
        ...movementForm,
        unit_cost: unitCost,
        // Motivo ya no se pide en el formulario; se usa uno por defecto.
        reason: movementForm.reason?.trim() || "Ingreso de materia prima",
        reference_type: null,
        reference_id: null,
      });
      setSuccess("Movimiento registrado correctamente.");
      setIsMovementFormOpen(false);
      setMovementForm(emptyMovementForm());
      await queryClient.invalidateQueries({ queryKey: ["inventory"] });
      if (created.waiting_production_runs.length > 0) {
        setAllocateRuns(created.waiting_production_runs);
        setAllocateQuantities(
          Object.fromEntries(
            created.waiting_production_runs.map((run) => [run.run_id, String(Number(run.missing_quantity))]),
          ),
        );
        setAllocateErrors({});
      }
```

- [ ] **Step 4: Handler de destinar**

Después de `handleReceiveFinishedProduct` (termina con el `finally { setIsSavingProduction(false); } }` de ese bloque), agregar:

```ts
  async function handleAllocateRun(run: WaitingProductionRunSummary) {
    const quantity = allocateQuantities[run.run_id] ?? String(Number(run.missing_quantity));
    setAllocateErrors((current) => ({ ...current, [run.run_id]: "" }));
    setAllocatingRunId(run.run_id);
    try {
      await allocateProductionRunMaterial(run.run_id, quantity);
      setAllocateRuns((current) => current.filter((item) => item.run_id !== run.run_id));
      setSuccess(`Material destinado a la orden ${run.production_code ?? run.run_id}.`);
      await queryClient.invalidateQueries({ queryKey: ["inventory"] });
      await queryClient.invalidateQueries({ queryKey: ["production"] });
    } catch (nextError) {
      setAllocateErrors((current) => ({
        ...current,
        [run.run_id]: nextError instanceof Error ? nextError.message : "No se pudo destinar el material.",
      }));
    } finally {
      setAllocatingRunId(null);
    }
  }
```

- [ ] **Step 5: JSX del modal**

Después del cierre del modal de registrar movimiento (`</form>` seguido de `</div>` y `) : null}` — el bloque que termina en la línea `      ) : null}` justo antes de `{isComplementPickerOpen ? (`), agregar:

```tsx
      {allocateRuns.length > 0 ? (
        <div className="modalBackdrop" role="dialog" aria-modal="true" aria-label="Destinar material">
          <section className="modalWindow processViewWindow">
            <div className="modalHeader">
              <div>
                <h2>Ordenes esperando esta materia prima</h2>
                <p>Este ingreso puede cubrir corridas que quedaron esperando material.</p>
              </div>
              <button aria-label="Cerrar" className="iconOnlyButton" onClick={() => setAllocateRuns([])} type="button">
                <X aria-hidden="true" size={18} />
              </button>
            </div>
            <div className="tableWrap">
              <table className="table tableAuto">
                <thead>
                  <tr>
                    <th>Orden</th>
                    <th className="num">Falta</th>
                    <th className="num">Destinar</th>
                    <th aria-label="Accion" />
                  </tr>
                </thead>
                <tbody>
                  {allocateRuns.map((run) => (
                    <tr key={run.run_id}>
                      <td>
                        <span className="orderCodeTag">{run.production_code ?? run.run_id}</span>
                        {run.root_production_code && run.root_production_code !== run.production_code ? (
                          <span className="rootBadgeTag">de {run.root_production_code}</span>
                        ) : null}
                      </td>
                      <td className="num">{numericText(run.missing_quantity)}</td>
                      <td className="num">
                        <input
                          className="field"
                          max={Number(run.missing_quantity)}
                          min="1"
                          onChange={(event) =>
                            setAllocateQuantities((current) => ({ ...current, [run.run_id]: event.target.value }))
                          }
                          step="1"
                          style={{ width: 90 }}
                          type="number"
                          value={allocateQuantities[run.run_id] ?? String(Number(run.missing_quantity))}
                        />
                      </td>
                      <td>
                        <button
                          className="button buttonPrimary"
                          disabled={allocatingRunId === run.run_id}
                          onClick={() => void handleAllocateRun(run)}
                          type="button"
                        >
                          <Repeat aria-hidden="true" size={14} />
                          {allocatingRunId === run.run_id ? "Destinando" : "Destinar"}
                        </button>
                        {allocateErrors[run.run_id] ? (
                          <div>
                            <small style={{ color: "var(--danger, #c0392b)" }}>{allocateErrors[run.run_id]}</small>
                          </div>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      ) : null}

```

`Repeat` ya está importado de `lucide-react` en este archivo (usado en otro lugar); no requiere un nuevo import de icono. `numericText` es la función de formato ya definida a nivel de módulo (línea 241) en este mismo archivo.

- [ ] **Step 6: Verificar que el proyecto tipa sin errores**

Run: `docker exec erp_joyeria-web-1 npx tsc --noEmit`
Expected: sin salida.

- [ ] **Step 7: Commit**

```bash
git add frontend/components/inventory/inventory-dashboard.tsx
git commit -m "feat(inventario): modal automatico para destinar material a ordenes ESPERANDO_MATERIAL"
```

---

### Task 7: Verificación manual end-to-end en navegador

**Files:** ninguno (solo verificación).

**Interfaces:**
- Consumes: todo lo anterior, corriendo en `erp_joyeria-web-1` + `erp_joyeria-api-1`.

- [ ] **Step 1: Confirmar que el stack está arriba**

Run: `docker ps --format "{{.Names}}\t{{.Status}}"`
Expected: `erp_joyeria-web-1`, `erp_joyeria-api-1`, `erp_joyeria-db-1` en estado `Up`.

- [ ] **Step 2: Preparar el escenario en el navegador**

1. Como jefe de producción, crear una orden cuya materia prima elegida tenga stock insuficiente para toda la cantidad pedida (o bajar el stock disponible de una materia prima antes de crear la orden, para forzarlo).
2. Como jefe de inventario, abrir la solicitud pendiente y "Aprobar salida de materia prima".
3. Confirmar en el tablero de producción: la orden original avanza (`MATERIALES_APROBADOS`/sigue su curso) y aparece una corrida nueva en la sección "Esperando material" con folio `<original>-B` y el chip "de `<original>`".

- [ ] **Step 3: Probar el modal automático**

1. Como jefe de inventario, registrar un ingreso de esa misma materia prima.
2. Confirmar que, al guardar, se abre solo el modal "Ordenes esperando esta materia prima" listando la corrida `-B` con su cantidad faltante precargada en el input.

- [ ] **Step 4: Destinar parcialmente**

1. En el modal, bajar la cantidad a destinar por debajo de lo que falta y hacer click en "Destinar".
2. Confirmar: la fila desaparece del modal, aparece el toast de éxito, la corrida `-B` pasa a `EN_PROCESO` en el tablero, y aparece una nueva corrida `-C` en "Esperando material" con el remanente y el chip "de `<original>`".

- [ ] **Step 5: Destinar el resto**

1. Registrar otro ingreso de la misma materia prima cubriendo lo que falta.
2. En el modal, destinar la cantidad completa precargada para `-C`.
3. Confirmar: la sección "Esperando material" del tablero queda vacía (muestra el empty state), y `-C` pasa a `EN_PROCESO`.

- [ ] **Step 6: Caso de error**

1. Provocar un nuevo split (repetir Step 2 con otra orden) para tener una fila en el modal.
2. Intentar destinar más unidades de las que la corrida necesita (editar el input a un número mayor al máximo).
3. Confirmar: mensaje de error inline en esa fila ("No puedes destinar mas unidades..."), la fila sigue en el modal, el modal no se cierra.

- [ ] **Step 7: Revisión visual final**

Confirmar con `docker exec erp_joyeria-web-1 npx tsc --noEmit` que no quedó ningún error de tipos tras las pruebas manuales (por si se tocó algo en el camino), y hacer una revisión visual de que el badge "de `<folio>`" no rompe el layout en pantallas angostas (recursos: DevTools responsive, ~375px de ancho) en el tablero de producción y en el modal de inventario.

No requiere commit (task de verificación, sin cambios de código).

---

## Self-Review

**Cobertura del spec:**
- Tipos y API (spec §1) → Tasks 1-3.
- Modal automático de inventario (spec §2) → Task 6.
- Sección ESPERANDO_MATERIAL de solo lectura + badge de folio raíz (spec §3) → Tasks 4-5.
- Plan de verificación manual del spec → Task 7 (mismos 5 pasos, expandidos con las acciones UI concretas).

**Consistencia de tipos:** `allocateProductionRunMaterial(runId: string, quantityUnits: string)` (Task 3) es lo que Task 6 llama; `WaitingProductionRunSummary` (Task 2) es el tipo que Task 6 recibe de `InventoryMovement.waiting_production_runs`; `rootBadge` (Task 4) es lo que Task 5 y Task 6 reutilizan como patrón visual (Task 6 no puede importar la función de otro componente — reimplementa el mismo chip inline con la clase CSS compartida `rootBadgeTag`, que sí es común vía `globals.css`).
