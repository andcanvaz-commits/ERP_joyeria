# Familia de split: agrupar en UI + certificado unificado — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Tratar una familia de split (folio raíz + hijas nacidas por falta de materia prima) como una sola orden en la UI: una fila en "En proceso", un solo certificado imprimible, un solo ítem en Documentos.

**Architecture:** Cambios de frontend puros sobre `frontend/lib/orden-produccion.ts` (agrega helpers de agrupación y cambia el modelo de documento a multi-evento), `frontend/components/documentos/orden-produccion-doc.tsx` (render multi-evento), y los 3 componentes que construyen o consumen ese modelo: `documentos-dashboard.tsx`, `inventory-dashboard.tsx`, `production-dashboard.tsx`.

**Tech Stack:** Next.js 16, React 18, TypeScript strict. Sin infraestructura de tests de frontend — verificación por `npx tsc --noEmit` en `erp_joyeria-web-1` + checklist manual en navegador (documentado en el spec, a cargo del usuario si la extensión de Chrome no conecta).

## Global Constraints

- No romper el caso sin split (familia de 1 miembro): debe verse y comportarse exactamente igual que antes de este plan.
- `buildOrdenProduccion` y `canPrintEntrega`/`canPrintRecepcion` cambian de firma (reciben `ProductionRun[]`, no `ProductionRun`) — actualizar los 3 call sites en el mismo commit que el cambio de firma para no dejar el build roto entre tasks.
- Verificación de tipos: `docker exec erp_joyeria-web-1 npx tsc --noEmit` (0 errores esperado al final de cada task).
- Seguir el spec: `docs/superpowers/specs/2026-08-03-familia-split-certificado-unificado-design.md`.

---

### Task 1: `orden-produccion.ts` — helpers de familia + modelo multi-evento

**Files:**
- Modify: `frontend/lib/orden-produccion.ts`

**Interfaces:**
- Produces: `runFamilyKey(run: ProductionRun): string`; `groupRunFamilies(runs: ProductionRun[]): Map<string, ProductionRun[]>`; `getRunFamily(runs: ProductionRun[], run: ProductionRun): ProductionRun[]`; `OrdenProduccionModel.entrega: DocSide[]`; `OrdenProduccionModel.recepcion: DocSide[]`; `buildOrdenProduccion(family: ProductionRun[], itemNames: Map<string, string>): OrdenProduccionModel`; `canPrintEntrega(family: ProductionRun[]): boolean`; `canPrintRecepcion(family: ProductionRun[]): boolean` — los consumen Task 2 (render), Task 3, 4, 5 (call sites).

- [ ] **Step 1: Helpers de agrupación**

Después de `buildItemNameMap` (línea 38), agregar:

```ts
/** Clave de familia: el folio raiz si esta corrida es parte de un split,
 * si no su propio folio (o su id como ultimo recurso). */
export function runFamilyKey(run: ProductionRun): string {
  return run.root_production_code || run.production_code || run.id;
}

/** Agrupa corridas por familia (folio raiz + sus hijas), cada grupo
 * ordenado por production_code para que la raiz siempre quede primero. */
export function groupRunFamilies(runs: ProductionRun[]): Map<string, ProductionRun[]> {
  const groups = new Map<string, ProductionRun[]>();
  for (const run of runs) {
    const key = runFamilyKey(run);
    const existing = groups.get(key);
    if (existing) {
      existing.push(run);
    } else {
      groups.set(key, [run]);
    }
  }
  for (const group of groups.values()) {
    group.sort((a, b) => (a.production_code ?? "").localeCompare(b.production_code ?? ""));
  }
  return groups;
}

/** Atajo: la familia completa (dentro de `runs`) a la que pertenece `run`. */
export function getRunFamily(runs: ProductionRun[], run: ProductionRun): ProductionRun[] {
  const key = runFamilyKey(run);
  return runs.filter((candidate) => runFamilyKey(candidate) === key)
    .sort((a, b) => (a.production_code ?? "").localeCompare(b.production_code ?? ""));
}
```

- [ ] **Step 2: `OrdenProduccionModel` a multi-evento**

Cambiar:

```ts
export type OrdenProduccionModel = {
  folio: string;
  procesoNombre: string;
  cantidad: number;
  categoria: string;
  responsableProduccion: string;
  entrega: DocSide;
  recepcion: DocSide;
  cancelada: boolean;
};
```

a:

```ts
export type OrdenProduccionModel = {
  folio: string;
  procesoNombre: string;
  cantidad: number;
  categoria: string;
  responsableProduccion: string;
  entrega: DocSide[];
  recepcion: DocSide[];
  cancelada: boolean;
};
```

- [ ] **Step 3: `buildOrdenProduccion` recibe la familia completa**

Cambiar la firma y el cuerpo completo de la función (reemplaza el bloque
actual de `buildOrdenProduccion`, líneas ~41-100):

```ts
/** Construye el modelo del comprobante "Orden de Producción" desde una
 * familia completa (folio raiz + hijas de split, o un solo run si nunca se
 * partio). Un evento de ENTREGA/RECEPCION por cada miembro que la tenga. */
export function buildOrdenProduccion(
  family: ProductionRun[],
  itemNames: Map<string, string>
): OrdenProduccionModel {
  const root = family.find((run) => !run.parent_run_id) ?? family[0];
  const materialName = itemNames.get(root.raw_material_item_id) ?? root.process_name;
  const materialUnit = root.raw_material_unit_code || "g";

  const entrega: DocSide[] = [];
  const recepcion: DocSide[] = [];

  for (const run of family) {
    if (run.materials_approved_at !== null) {
      const rows: DocRow[] = [
        { gramos: num(run.total_required_material), unidad: materialUnit, detalle: materialName }
      ];
      for (const supply of run.supply_consumptions ?? []) {
        rows.push({
          gramos: num(supply.quantity),
          unidad: supply.unit_code || "g",
          detalle: `Insumo: ${supply.name}`
        });
      }
      entrega.push({
        fecha: run.materials_approved_at,
        responsable: run.materials_approved_by_name ?? DASH,
        rows
      });
    }

    if (run.received_at !== null) {
      const rows: DocRow[] = [];
      if (run.actual_finished_weight !== null) {
        rows.push({
          gramos: num(run.actual_finished_weight),
          unidad: materialUnit,
          detalle: `Producto terminado: ${run.process_name}`
        });
      }
      for (const product of run.products ?? []) {
        rows.push({
          gramos: num(product.quantity),
          unidad: "und",
          detalle: `Producto final: ${product.product_name ?? "—"}`
        });
      }
      recepcion.push({
        fecha: run.received_at,
        responsable: run.received_by_name ?? DASH,
        rows
      });
    }
  }

  return {
    folio: root.root_production_code ?? root.production_code ?? DASH,
    procesoNombre: root.process_name,
    cantidad: family.reduce((total, run) => total + num(run.quantity), 0),
    categoria: materialName,
    responsableProduccion: root.created_by_name ?? DASH,
    entrega,
    recepcion,
    cancelada: family.every((run) => run.status === "CANCELADA")
  };
}
```

- [ ] **Step 4: `canPrintEntrega`/`canPrintRecepcion` reciben la familia**

Cambiar:

```ts
/** ¿La mitad de entrega ya puede imprimirse? (materiales aprobados) */
export function canPrintEntrega(run: ProductionRun): boolean {
  return run.materials_approved_at !== null;
}

/** ¿La mitad de recepción / el documento completo ya pueden imprimirse? (recibido) */
export function canPrintRecepcion(run: ProductionRun): boolean {
  return run.received_at !== null;
}
```

a:

```ts
/** ¿La familia completa ya arranco (nadie quedo ESPERANDO_MATERIAL)? Solo
 * ahi tiene sentido imprimir la entrega unificada. */
export function canPrintEntrega(family: ProductionRun[]): boolean {
  return (
    family.length > 0 &&
    family.some((run) => run.materials_approved_at !== null) &&
    !family.some((run) => run.status === "ESPERANDO_MATERIAL" || run.status === "PENDIENTE_INVENTARIO")
  );
}

/** ¿Toda la familia ya fue recibida (o cancelada)? Solo ahi la recepcion
 * unificada esta completa. */
export function canPrintRecepcion(family: ProductionRun[]): boolean {
  return (
    family.length > 0 &&
    family.some((run) => run.status === "RECIBIDA") &&
    family.every((run) => run.status === "RECIBIDA" || run.status === "CANCELADA")
  );
}
```

- [ ] **Step 5: Verificar tipos**

Run: `docker exec erp_joyeria-web-1 npx tsc --noEmit`
Expected: errores en `orden-produccion-doc.tsx`, `documentos-dashboard.tsx`, `inventory-dashboard.tsx` (llaman a estas funciones con la firma vieja) — se resuelven en las Tasks 2-4. Confirmar que NO hay errores dentro de `orden-produccion.ts` mismo.

- [ ] **Step 6: Commit**

```bash
git add frontend/lib/orden-produccion.ts
git commit -m "feat(documentos): modelo multi-evento y helpers de familia para el certificado unificado"
```

---

### Task 2: `orden-produccion-doc.tsx` — render multi-evento

**Files:**
- Modify: `frontend/components/documentos/orden-produccion-doc.tsx`

**Interfaces:**
- Consumes: `OrdenProduccionModel.entrega/recepcion: DocSide[]` (Task 1).

- [ ] **Step 1: `SideColumn` recibe una lista de eventos**

Reemplazar el componente completo `SideColumn` (líneas 7-50) por:

```tsx
function SideColumn({
  events,
  title,
  dataClass
}: {
  events: DocSide[];
  title: string;
  dataClass: string;
}) {
  type DisplayRow = { gramos: number; unidad: string; detalle: string } | null;
  type DisplayLine =
    | { kind: "group"; fecha: string | null; responsable: string }
    | { kind: "row"; row: DisplayRow };

  const lines: DisplayLine[] = [];
  for (const event of events) {
    lines.push({ kind: "group", fecha: event.fecha, responsable: event.responsable });
    for (const row of event.rows) {
      lines.push({ kind: "row", row });
    }
  }
  const rowCount = lines.filter((line) => line.kind === "row").length;
  for (let i = rowCount; i < MIN_ROWS; i += 1) {
    lines.push({ kind: "row", row: null });
  }
  if (events.length === 0) {
    lines.push({ kind: "group", fecha: null, responsable: DASH_RESPONSABLE });
    for (let i = 0; i < MIN_ROWS; i += 1) lines.push({ kind: "row", row: null });
  }

  return (
    <section className="opCol">
      <div className="opColHead">{title}</div>
      <table className="opTable">
        <thead>
          <tr>
            <th className="opThFecha">FECHA</th>
            <th className="opThGramos">CANTIDAD</th>
            <th>DETALLES</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((line, index) =>
            line.kind === "group" ? (
              <tr className="opGroupRow" key={`group-${index}`}>
                <td colSpan={3}>
                  <span className={dataClass}>
                    {formatDocDate(line.fecha) || " "} · Responsable Inventario: {line.responsable}
                  </span>
                </td>
              </tr>
            ) : (
              <tr key={`row-${index}`}>
                <td> </td>
                <td className="opTdGramos">{line.row ? <span className={dataClass}>{formatGramos(line.row.gramos)} {line.row.unidad}</span> : " "}</td>
                <td>{line.row ? <span className={dataClass}>{line.row.detalle}</span> : " "}</td>
              </tr>
            )
          )}
        </tbody>
      </table>
    </section>
  );
}

const DASH_RESPONSABLE = "—";
```

- [ ] **Step 2: Usar `events` en vez de `side` al renderizar**

Cambiar:

```tsx
        <div className="opBody">
          <SideColumn side={model.entrega} title="ENTREGADO" dataClass="opEntregaData" />
          <div className="opDivider" aria-hidden="true" />
          <SideColumn side={model.recepcion} title="RECIBIDO" dataClass="opRecepcionData" />
        </div>
```

a:

```tsx
        <div className="opBody">
          <SideColumn events={model.entrega} title="ENTREGADO" dataClass="opEntregaData" />
          <div className="opDivider" aria-hidden="true" />
          <SideColumn events={model.recepcion} title="RECIBIDO" dataClass="opRecepcionData" />
        </div>
```

- [ ] **Step 3: CSS de la fila de grupo**

En `frontend/app/globals.css`, buscar la regla `.opTable` (o cualquier
regla `.op*` existente) y agregar junto a las reglas de esa familia de
clases:

```css
.opGroupRow td {
  background: var(--surface-muted);
  font-weight: 700;
  padding: 3px 6px;
}
```

- [ ] **Step 4: Verificar tipos**

Run: `docker exec erp_joyeria-web-1 npx tsc --noEmit`
Expected: ya no hay errores dentro de `orden-produccion-doc.tsx`; siguen los de `documentos-dashboard.tsx` e `inventory-dashboard.tsx` (Tasks 3-4).

- [ ] **Step 5: Commit**

```bash
git add frontend/components/documentos/orden-produccion-doc.tsx frontend/app/globals.css
git commit -m "feat(documentos): render multi-evento en el comprobante de orden de produccion"
```

---

### Task 3: `documentos-dashboard.tsx` — un ítem por familia

**Files:**
- Modify: `frontend/components/documentos/documentos-dashboard.tsx`

**Interfaces:**
- Consumes: `groupRunFamilies`, `buildOrdenProduccion(family)`, `canPrintEntrega(family)`, `canPrintRecepcion(family)` (Task 1).

- [ ] **Step 1: Import**

Cambiar:

```ts
import {
  buildItemNameMap,
  buildOrdenProduccion,
  canPrintEntrega,
  canPrintRecepcion,
  formatDocDate
} from "@/lib/orden-produccion";
```

a:

```ts
import {
  buildItemNameMap,
  buildOrdenProduccion,
  canPrintEntrega,
  canPrintRecepcion,
  formatDocDate,
  groupRunFamilies
} from "@/lib/orden-produccion";
```

- [ ] **Step 2: Agrupar por familia y seleccionar por clave**

Cambiar:

```ts
  const runs = (data?.runs ?? []).filter((run) => run.status !== "CANCELADA");
  const items = data?.items ?? [];
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [printMode, setPrintMode] = useState<DocMode | null>(null);

  const itemNames = useMemo(() => buildItemNameMap(items), [items]);
  const selectedRun = runs.find((run) => run.id === selectedId) ?? null;
  const model = useMemo(
    () => (selectedRun ? buildOrdenProduccion(selectedRun, itemNames) : null),
    [selectedRun, itemNames]
  );
```

a:

```ts
  const runs = (data?.runs ?? []).filter((run) => run.status !== "CANCELADA");
  const items = data?.items ?? [];
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [printMode, setPrintMode] = useState<DocMode | null>(null);

  const itemNames = useMemo(() => buildItemNameMap(items), [items]);
  const families = useMemo(() => groupRunFamilies(runs), [runs]);
  const familyList = useMemo(() => Array.from(families.entries()), [families]);
  const selectedFamily = selectedKey ? families.get(selectedKey) ?? null : null;
  const model = useMemo(
    () => (selectedFamily ? buildOrdenProduccion(selectedFamily, itemNames) : null),
    [selectedFamily, itemNames]
  );
```

- [ ] **Step 3: Lista de la izquierda: un botón por familia**

Cambiar:

```tsx
            {runs.map((run) => {
              const isSel = run.id === selectedId;
              return (
                <button
                  className={`processPicker${isSel ? " processPickerActive" : ""}`}
                  key={run.id}
                  onClick={() => setSelectedId(run.id)}
                  type="button"
                >
                  <span style={{ display: "grid", gap: 2, textAlign: "left" }}>
                    <strong style={{ color: "var(--text)", fontSize: 14 }}>
                      {run.production_code ?? "Sin folio"} · {run.process_name}
                    </strong>
                    <span>
                      {STATUS_LABEL[run.status]}
                      {run.received_at ? ` · Recibida ${formatDocDate(run.received_at)}` : ""}
                    </span>
                  </span>
                </button>
              );
            })}
```

a:

```tsx
            {familyList.map(([key, family]) => {
              const isSel = key === selectedKey;
              const root = family.find((run) => !run.parent_run_id) ?? family[0];
              const receivedCount = family.filter((run) => run.status === "RECIBIDA").length;
              const statusText =
                family.length === 1
                  ? STATUS_LABEL[family[0].status]
                  : `${receivedCount}/${family.length} recibidas`;
              return (
                <button
                  className={`processPicker${isSel ? " processPickerActive" : ""}`}
                  key={key}
                  onClick={() => setSelectedKey(key)}
                  type="button"
                >
                  <span style={{ display: "grid", gap: 2, textAlign: "left" }}>
                    <strong style={{ color: "var(--text)", fontSize: 14 }}>
                      {key} · {root.process_name}
                    </strong>
                    <span>{statusText}</span>
                  </span>
                </button>
              );
            })}
```

- [ ] **Step 4: Botones de imprimir usan la familia**

Cambiar:

```tsx
                  <button
                    className="button"
                    disabled={!canPrintEntrega(selectedRun)}
                    onClick={() => setPrintMode("entrega")}
                    type="button"
                  >
                    <Printer aria-hidden="true" size={16} />
                    Imprimir entrega
                  </button>
                  <button
                    className="button"
                    disabled={!canPrintRecepcion(selectedRun)}
                    onClick={() => setPrintMode("recepcion")}
                    type="button"
                  >
                    <Printer aria-hidden="true" size={16} />
                    Imprimir recepción
                  </button>
                  <button
                    className="button buttonPrimary"
                    disabled={!canPrintRecepcion(selectedRun)}
                    onClick={() => setPrintMode("completo")}
                    type="button"
                  >
                    <Printer aria-hidden="true" size={16} />
                    Imprimir completo
                  </button>
```

a:

```tsx
                  <button
                    className="button"
                    disabled={!selectedFamily || !canPrintEntrega(selectedFamily)}
                    onClick={() => setPrintMode("entrega")}
                    type="button"
                  >
                    <Printer aria-hidden="true" size={16} />
                    Imprimir entrega
                  </button>
                  <button
                    className="button"
                    disabled={!selectedFamily || !canPrintRecepcion(selectedFamily)}
                    onClick={() => setPrintMode("recepcion")}
                    type="button"
                  >
                    <Printer aria-hidden="true" size={16} />
                    Imprimir recepción
                  </button>
                  <button
                    className="button buttonPrimary"
                    disabled={!selectedFamily || !canPrintRecepcion(selectedFamily)}
                    onClick={() => setPrintMode("completo")}
                    type="button"
                  >
                    <Printer aria-hidden="true" size={16} />
                    Imprimir completo
                  </button>
```

- [ ] **Step 5: `model &&` sigue siendo la condición de la vista previa (sin cambio de nombre necesario)**

Verificar (sin editar) que las referencias restantes a `selectedRun` en el
archivo ya no existan — buscar `selectedRun` en el archivo:

Run: `grep -n "selectedRun" frontend/components/documentos/documentos-dashboard.tsx`
Expected: sin resultados (todo quedó como `selectedFamily`/`model`).

- [ ] **Step 6: Verificar tipos**

Run: `docker exec erp_joyeria-web-1 npx tsc --noEmit`
Expected: ya no hay errores dentro de `documentos-dashboard.tsx`; sigue el de `inventory-dashboard.tsx` (Task 4).

- [ ] **Step 7: Commit**

```bash
git add frontend/components/documentos/documentos-dashboard.tsx
git commit -m "feat(documentos): un solo item por familia de split en el listado"
```

---

### Task 4: `inventory-dashboard.tsx` — preview automático family-aware

**Files:**
- Modify: `frontend/components/inventory/inventory-dashboard.tsx`

**Interfaces:**
- Consumes: `getRunFamily`, `buildOrdenProduccion(family)`, `canPrintEntrega(family)`, `canPrintRecepcion(family)` (Task 1).

- [ ] **Step 1: Import**

Cambiar:

```ts
import { buildItemNameMap, buildOrdenProduccion } from "@/lib/orden-produccion";
```

a:

```ts
import { buildItemNameMap, buildOrdenProduccion, canPrintEntrega, canPrintRecepcion, getRunFamily } from "@/lib/orden-produccion";
```

- [ ] **Step 2: `printPreview` guarda la familia, no un run**

Cambiar:

```ts
  const [printPreview, setPrintPreview] = useState<{ run: ProductionRun; mode: DocMode } | null>(null);
```

a:

```ts
  const [printPreview, setPrintPreview] = useState<{ family: ProductionRun[]; mode: DocMode } | null>(null);
```

- [ ] **Step 3: `handleApproveMaterials` ofrece preview solo si la familia ya arrancó completa**

Cambiar:

```ts
      void queryClient.invalidateQueries({ queryKey: ["inventory"] });
      void queryClient.invalidateQueries({ queryKey: ["solicitudes"] });
      void queryClient.invalidateQueries({ queryKey: ["production"] });
      setPrintPreview({ run: updated, mode: "entrega" });
```

(este bloque está dentro de `handleApproveMaterials`, justo antes del
`} catch (nextError) {` de esa función) a:

```ts
      void queryClient.invalidateQueries({ queryKey: ["inventory"] });
      void queryClient.invalidateQueries({ queryKey: ["solicitudes"] });
      void queryClient.invalidateQueries({ queryKey: ["production"] });
      const family = getRunFamily(nextRuns, updated);
      if (canPrintEntrega(family)) {
        setPrintPreview({ family, mode: "entrega" });
      }
```

- [ ] **Step 4: `handleAllocateRun` ofrece preview cuando el destino resuelve toda la familia**

Cambiar:

```ts
    try {
      const started = await allocateProductionRunMaterial(run.run_id, quantity);
      const nextRuns = await listProductionRuns();
      const splitChild = nextRuns.find((r) => r.status === "ESPERANDO_MATERIAL" && r.parent_run_id === started.id);
      setAllocateRuns((current) => current.filter((item) => item.run_id !== run.run_id));
      setSuccess(
        splitChild
          ? `Material destinado a la orden ${run.production_code ?? run.run_id}. Ese ingreso no alcanzo para todo: la orden se dividio de nuevo, ${numericText(splitChild.quantity)} unidades quedaron esperando material en ${splitChild.production_code}.`
          : `Material destinado a la orden ${run.production_code ?? run.run_id}.`,
      );
      await queryClient.invalidateQueries({ queryKey: ["inventory"] });
      await queryClient.invalidateQueries({ queryKey: ["production"] });
```

a:

```ts
    try {
      const started = await allocateProductionRunMaterial(run.run_id, quantity);
      const nextRuns = await listProductionRuns();
      const splitChild = nextRuns.find((r) => r.status === "ESPERANDO_MATERIAL" && r.parent_run_id === started.id);
      setAllocateRuns((current) => current.filter((item) => item.run_id !== run.run_id));
      setSuccess(
        splitChild
          ? `Material destinado a la orden ${run.production_code ?? run.run_id}. Ese ingreso no alcanzo para todo: la orden se dividio de nuevo, ${numericText(splitChild.quantity)} unidades quedaron esperando material en ${splitChild.production_code}.`
          : `Material destinado a la orden ${run.production_code ?? run.run_id}.`,
      );
      await queryClient.invalidateQueries({ queryKey: ["inventory"] });
      await queryClient.invalidateQueries({ queryKey: ["production"] });
      const family = getRunFamily(nextRuns, started);
      if (!splitChild && canPrintEntrega(family)) {
        setPrintPreview({ family, mode: "entrega" });
      }
```

- [ ] **Step 5: `handleReceiveFinishedProduct` ofrece preview solo si toda la familia ya fue recibida**

Cambiar:

```ts
      const updated = await receiveProductionRunFinishedProduct(run.id);
      setSuccess("Producto terminado recibido en inventario.");
      const nextRuns = await listProductionRuns();
      const remaining = nextRuns.filter((r) => r.status === "PENDIENTE_INVENTARIO" || r.status === "PENDIENTE_RECEPCION").length;
      if (remaining === 0) {
        setIsSolicitudesOpen(false);
      }
      void queryClient.invalidateQueries({ queryKey: ["inventory"] });
      void queryClient.invalidateQueries({ queryKey: ["solicitudes"] });
      void queryClient.invalidateQueries({ queryKey: ["production"] });
      setPrintPreview({ run: updated, mode: "recepcion" });
```

a:

```ts
      const updated = await receiveProductionRunFinishedProduct(run.id);
      setSuccess("Producto terminado recibido en inventario.");
      const nextRuns = await listProductionRuns();
      const remaining = nextRuns.filter((r) => r.status === "PENDIENTE_INVENTARIO" || r.status === "PENDIENTE_RECEPCION").length;
      if (remaining === 0) {
        setIsSolicitudesOpen(false);
      }
      void queryClient.invalidateQueries({ queryKey: ["inventory"] });
      void queryClient.invalidateQueries({ queryKey: ["solicitudes"] });
      void queryClient.invalidateQueries({ queryKey: ["production"] });
      const family = getRunFamily(nextRuns, updated);
      if (canPrintRecepcion(family)) {
        setPrintPreview({ family, mode: "recepcion" });
      }
```

- [ ] **Step 6: Render del preview usa la familia**

Cambiar (las dos ocurrencias, la de vista previa y la de impresión final):

```tsx
              <OrdenProduccionDoc model={buildOrdenProduccion(printPreview.run, docItemNames)} mode="completo" />
```

y

```tsx
              <OrdenProduccionDoc model={buildOrdenProduccion(printPreview.run, docItemNames)} mode={printingMode} />
```

a (respectivamente):

```tsx
              <OrdenProduccionDoc model={buildOrdenProduccion(printPreview.family, docItemNames)} mode="completo" />
```

```tsx
              <OrdenProduccionDoc model={buildOrdenProduccion(printPreview.family, docItemNames)} mode={printingMode} />
```

- [ ] **Step 7: Verificar tipos**

Run: `docker exec erp_joyeria-web-1 npx tsc --noEmit`
Expected: sin errores en todo el proyecto (última pieza pendiente).

- [ ] **Step 8: Commit**

```bash
git add frontend/components/inventory/inventory-dashboard.tsx
git commit -m "feat(inventario): preview de certificado family-aware, solo cuando la familia arranca o se recibe completa"
```

---

### Task 5: `production-dashboard.tsx` — fila de familia + modal de gestión conjunta

**Files:**
- Modify: `frontend/components/production/production-dashboard.tsx`

**Interfaces:**
- Consumes: `openRunStagesModal(run)` (ya existente), `groupRunFamilies` (Task 1).

- [ ] **Step 1: Import**

Cambiar:

```ts
import { StatusPunch } from "@/components/ui/status-punch";
```

a:

```ts
import { StatusPunch } from "@/components/ui/status-punch";
import { groupRunFamilies } from "@/lib/orden-produccion";
```

- [ ] **Step 2: Estado del modal de familia**

Junto a la declaración de `selectedRunForStages` (línea 335), agregar:

```ts
  const [familyRuns, setFamilyRuns] = useState<ProductionRun[] | null>(null);
```

- [ ] **Step 3: Derivar las familias que tienen al menos un miembro "En proceso"**

Cambiar:

```ts
  const inProgressRuns = runs.filter((run) => run.status === "EN_PROCESO");
```

a:

```ts
  const inProgressRuns = runs.filter((run) => run.status === "EN_PROCESO");
  const runFamilies = groupRunFamilies(runs);
  const inProgressFamilyKeys = Array.from(new Set(inProgressRuns.map((run) => run.root_production_code || run.production_code || run.id)));
  const inProgressFamilies = inProgressFamilyKeys.map((key) => runFamilies.get(key) ?? []).filter((family) => family.length > 0);
```

- [ ] **Step 4: La lista "En proceso" itera familias, no corridas sueltas**

Cambiar el bloque de renderizado (dentro de `{inProgressRuns.length > 0 ? (` — la condición pasa a usar `inProgressFamilies`):

```tsx
              {inProgressRuns.length > 0 ? (
                <div className="productionRunsVertical">
                  {inProgressRuns.map((run) => {
                    const currentStage = run.stages.find((s) => s.status === "EN_PROCESO") ?? run.stages.find((s) => s.status === "PENDIENTE") ?? null;
                    const doneCount = run.stages.filter((s) => s.status === "FINALIZADA").length;
                    return (
                      <div className="productionRunListRow" key={run.id} {...openableProps(() => openRunStagesModal(run), `Gestionar orden ${run.process_name}`)}>
                        {/* Title row: name + code left, timing + button right */}
                        <div className="productionRunListRowHead">
                          <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0, overflow: "hidden" }}>
                            {run.production_code ? (
                              <span style={{ fontFamily: "monospace", fontSize: 10, color: "var(--primary-strong)", fontWeight: 700, background: "#f3e9d6", borderRadius: 4, padding: "1px 5px", flexShrink: 0 }}>{run.production_code}</span>
                            ) : null}
                            {rootBadge(run)}
                            <strong style={{ fontSize: 13, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{run.process_name}</strong>
                          </div>
                          <div style={{ display: "flex", alignItems: "center", gap: 5, flexShrink: 0 }} onClick={stopClick}>
                            <button className="button buttonPrimary runInlineBtn" onClick={() => openRunStagesModal(run)} type="button">
                              Gestionar
                            </button>
                          </div>
                        </div>
                        {/* Meta: current stage + qty + started */}
                        <div className="productionRunListRowMeta">
                          {currentStage ? <span>{currentStage.stage_order}. {currentStage.stage_name}</span> : null}
                          {currentStage ? <span aria-hidden="true">·</span> : null}
                          <span>{numericText(run.quantity)} und</span>
                          <span aria-hidden="true">·</span>
                          <span>Inició {hourLabel(run.started_at)}</span>
                        </div>
                        {/* Progress: caliper scale for stage advance */}
                        <CaliperScale
                          ariaLabel="Avance de la orden"
                          label={`${doneCount}/${run.stages.length}`}
                          max={run.stages.length}
                          ticks={run.stages.length}
                          value={doneCount}
                        />
                        {/* Tiempo transcurrido desde el inicio de la orden. */}
                        <div className="productionRunListRowMeta">
                          <span>Tiempo en proceso: {elapsedLabel(run.started_at, nowTick)}</span>
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="emptyState">No hay procesos en transcurso.</div>
              )}
```

a:

```tsx
              {inProgressFamilies.length > 0 ? (
                <div className="productionRunsVertical">
                  {inProgressFamilies.map((family) => {
                    if (family.length === 1) {
                      const run = family[0];
                      const currentStage = run.stages.find((s) => s.status === "EN_PROCESO") ?? run.stages.find((s) => s.status === "PENDIENTE") ?? null;
                      const doneCount = run.stages.filter((s) => s.status === "FINALIZADA").length;
                      return (
                        <div className="productionRunListRow" key={run.id} {...openableProps(() => openRunStagesModal(run), `Gestionar orden ${run.process_name}`)}>
                          <div className="productionRunListRowHead">
                            <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0, overflow: "hidden" }}>
                              {run.production_code ? (
                                <span style={{ fontFamily: "monospace", fontSize: 10, color: "var(--primary-strong)", fontWeight: 700, background: "#f3e9d6", borderRadius: 4, padding: "1px 5px", flexShrink: 0 }}>{run.production_code}</span>
                              ) : null}
                              {rootBadge(run)}
                              <strong style={{ fontSize: 13, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{run.process_name}</strong>
                            </div>
                            <div style={{ display: "flex", alignItems: "center", gap: 5, flexShrink: 0 }} onClick={stopClick}>
                              <button className="button buttonPrimary runInlineBtn" onClick={() => openRunStagesModal(run)} type="button">
                                Gestionar
                              </button>
                            </div>
                          </div>
                          <div className="productionRunListRowMeta">
                            {currentStage ? <span>{currentStage.stage_order}. {currentStage.stage_name}</span> : null}
                            {currentStage ? <span aria-hidden="true">·</span> : null}
                            <span>{numericText(run.quantity)} und</span>
                            <span aria-hidden="true">·</span>
                            <span>Inició {hourLabel(run.started_at)}</span>
                          </div>
                          <CaliperScale
                            ariaLabel="Avance de la orden"
                            label={`${doneCount}/${run.stages.length}`}
                            max={run.stages.length}
                            ticks={run.stages.length}
                            value={doneCount}
                          />
                          <div className="productionRunListRowMeta">
                            <span>Tiempo en proceso: {elapsedLabel(run.started_at, nowTick)}</span>
                          </div>
                        </div>
                      );
                    }

                    const root = family.find((r) => !r.parent_run_id) ?? family[0];
                    const activeCount = family.filter((r) => r.status === "EN_PROCESO").length;
                    const waitingCount = family.filter((r) => r.status === "ESPERANDO_MATERIAL").length;
                    return (
                      <div className="productionRunListRow" key={root.root_production_code ?? root.production_code} {...openableProps(() => setFamilyRuns(family), `Ver familia de la orden ${root.process_name}`)}>
                        <div className="productionRunListRowHead">
                          <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0, overflow: "hidden" }}>
                            <span style={{ fontFamily: "monospace", fontSize: 10, color: "var(--primary-strong)", fontWeight: 700, background: "#f3e9d6", borderRadius: 4, padding: "1px 5px", flexShrink: 0 }}>
                              {root.root_production_code ?? root.production_code}
                            </span>
                            <span className="rootBadgeTag">Familia · {family.length} corridas</span>
                            <strong style={{ fontSize: 13, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{root.process_name}</strong>
                          </div>
                          <div style={{ display: "flex", alignItems: "center", gap: 5, flexShrink: 0 }} onClick={stopClick}>
                            <button className="button buttonPrimary runInlineBtn" onClick={() => setFamilyRuns(family)} type="button">
                              Ver familia
                            </button>
                          </div>
                        </div>
                        <div className="productionRunListRowMeta">
                          <span>{activeCount} en proceso</span>
                          {waitingCount > 0 ? (
                            <>
                              <span aria-hidden="true">·</span>
                              <span>{waitingCount} esperando material</span>
                            </>
                          ) : null}
                        </div>
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="emptyState">No hay procesos en transcurso.</div>
              )}
```

- [ ] **Step 5: Modal de familia**

Después del modal que abre en `isRunStagesOpen && selectedRunForStages`
(buscar dónde cierra ese bloque `) : null}` correspondiente — usar `Grep`
para `isRunStagesOpen && selectedRunForStages` y ubicar el `) : null}` que
le sigue en el mismo nivel de indentación), agregar inmediatamente después:

```tsx
      {familyRuns ? (
        <div className="modalBackdrop" role="dialog" aria-modal="true" aria-label="Familia de la orden">
          <section className="modalWindow processViewWindow">
            <div className="modalHeader">
              <div>
                <h2>Orden {familyRuns[0].root_production_code ?? familyRuns[0].production_code}</h2>
                <p>{familyRuns.length} corridas de esta orden, dividida por falta de materia prima</p>
              </div>
              <button aria-label="Cerrar" className="iconOnlyButton" onClick={() => setFamilyRuns(null)} type="button">
                <X aria-hidden="true" size={18} />
              </button>
            </div>
            <div className="tableWrap">
              <table className="table tableAuto">
                <thead>
                  <tr>
                    <th>Orden</th>
                    <th>Estado</th>
                    <th className="num">Cantidad</th>
                    <th aria-label="Accion" />
                  </tr>
                </thead>
                <tbody>
                  {familyRuns.map((familyRun) => (
                    <tr key={familyRun.id}>
                      <td><span className="orderCodeTag">{familyRun.production_code}</span></td>
                      <td><StatusPunch label={runStatusLabel(familyRun.status)} tone={runStatusTone(familyRun.status)} /></td>
                      <td className="num">{numericText(familyRun.quantity)} und</td>
                      <td>
                        <button
                          className="button buttonPrimary"
                          onClick={() => {
                            setFamilyRuns(null);
                            openRunStagesModal(familyRun);
                          }}
                          type="button"
                        >
                          Gestionar
                        </button>
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

- [ ] **Step 6: Verificar tipos**

Run: `docker exec erp_joyeria-web-1 npx tsc --noEmit`
Expected: sin errores en todo el proyecto.

- [ ] **Step 7: Commit**

```bash
git add frontend/components/production/production-dashboard.tsx
git commit -m "feat(produccion): fila de familia colapsada en En proceso + modal de gestion conjunta"
```

---

### Task 6: Verificación manual end-to-end

**Files:** ninguno (solo verificación).

- [ ] **Step 1: Confirmar stack arriba**

Run: `docker ps --format "{{.Names}}\t{{.Status}}"`
Expected: `erp_joyeria-web-1`, `erp_joyeria-api-1`, `erp_joyeria-db-1` en `Up`.

- [ ] **Step 2-6: Seguir el "Plan de verificación manual" del spec**

Ejecutar los 5 pasos descritos en
`docs/superpowers/specs/2026-08-03-familia-split-certificado-unificado-design.md`
(sección final): split → fila única en "En proceso" → modal de familia →
Documentos con un solo ítem → habilitación de impresión solo cuando la
familia arranca/se recibe completa → certificado con múltiples bloques de
ENTREGADO/RECIBIDO.

No requiere commit (task de verificación).

---

## Self-Review

**Cobertura del spec:**
- §1 helpers de familia + modelo multi-evento → Task 1.
- §2 render multi-evento → Task 2.
- §3 un ítem por familia en Documentos → Task 3.
- §4 preview automático family-aware → Task 4.
- §5 fila de familia + modal en tablero de producción → Task 5.
- Plan de verificación manual del spec → Task 6.

**Consistencia de tipos:** `buildOrdenProduccion(family: ProductionRun[], ...)`, `canPrintEntrega(family: ProductionRun[])`, `canPrintRecepcion(family: ProductionRun[])` (Task 1) son exactamente las firmas que Tasks 3 y 4 llaman. `groupRunFamilies`/`getRunFamily` (Task 1) son lo que Tasks 3, 4 y 5 importan — mismos nombres en los 3 sitios. `printPreview.family` (Task 4) reemplaza a `printPreview.run` de forma consistente en los 2 usos de renderizado del mismo Task 4.
