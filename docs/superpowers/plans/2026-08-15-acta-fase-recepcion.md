# Fases del lado RECIBIDO en acta/certificado Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** El lado RECIBIDO del certificado impreso (Documentos) y de la vista editable (Ver Acta) muestra un aviso "Aún no aprobado por inventario" antes de que inventario apruebe materiales, luego "Producto resultante" mientras no haya avance real de producción, y recién entonces la tabla real de recepción — en vez de mostrar siempre la misma tabla vacía sin importar el estado.

**Architecture:** Una función pura `actaRightPhase()` y un formateador `formatProductosResultantes()` en `frontend/lib/orden-produccion.ts` (módulo ya compartido por ambos consumidores) deciden la fase (`NO_APROBADO` / `SOLO_PRODUCTO` / `CONSTRUYENDO`) a partir de datos que ya viajan en `ProductionRun`. `orden-produccion-doc.tsx` (documento impreso, nivel familia) y `acta-view.tsx` (Ver Acta, nivel corrida) consumen esa fase para decidir si renderizan la tabla `opTable` o un bloque de aviso (`.opColNotice`, CSS nueva compartida). Cero cambios de backend.

**Tech Stack:** Next.js 16 / React 18 / TypeScript. Sin test runner de frontend (no hay Jest/Vitest en este proyecto) — la verificación es `npx tsc --noEmit` más revisión manual; así lo indica `CLAUDE.md` para este repo.

## Global Constraints

- Español-first: todo texto de usuario nuevo va en español (copy exacto: "Aún no aprobado por inventario", "Producto resultante").
- No agregar dependencias (`CLAUDE.md`: solo `@tanstack/react-query`, `lucide-react`, Next/React).
- No tocar backend/endpoints — todo el dato ya existe en `ProductionRun`.
- Familias históricas (`event_lines` no vacío) y canceladas: sin cambios de comportamiento.
- El lado ENTREGADO no cambia en ninguna fase.
- Estilo va en `frontend/app/globals.css`, reusando tokens existentes (`--doc-line`, `--doc-ink`, `--doc-ink-strong`).

---

### Task 1: Helpers compartidos en `orden-produccion.ts`

**Files:**
- Modify: `frontend/lib/orden-produccion.ts`

**Interfaces:**
- Produces: `export type ActaRightPhase = "NO_APROBADO" | "SOLO_PRODUCTO" | "CONSTRUYENDO"`; `export function actaRightPhase(params: { approved: boolean; stages: Array<{ requires_weighing: boolean; status: string }>; hasRecepcionLines: boolean }): ActaRightPhase`; `export function formatProductosResultantes(products: NonNullable<ProductionRun["products"]>): string`; `OrdenProduccionModel` gana los campos `recepcionPhase: ActaRightPhase` y `productosResultantes: string`, ambos poblados por `buildOrdenProduccion`.

- [ ] **Step 1: Agregar `ActaRightPhase` y `actaRightPhase()`**

En `frontend/lib/orden-produccion.ts`, después de la función `num()` (línea 41 actual) y antes de `buildItemNameMap`, insertar:

```ts
export type ActaRightPhase = "NO_APROBADO" | "SOLO_PRODUCTO" | "CONSTRUYENDO";

/** Fase del lado RECIBIDO del certificado/acta: sin aprobar todavia, aprobado
 * pero sin avance real, o con avance real que ya justifica mostrar la tabla.
 * Una etapa que pesa y termina en 0% de merma cuenta como avance real -- no
 * es "merma > 0" lo que dispara CONSTRUYENDO, es que de verdad se peso algo. */
export function actaRightPhase(params: {
  approved: boolean;
  stages: Array<{ requires_weighing: boolean; status: string }>;
  hasRecepcionLines: boolean;
}): ActaRightPhase {
  if (!params.approved) return "NO_APROBADO";
  const hasWeighedStage = params.stages.some(
    (s) => s.requires_weighing && s.status === "FINALIZADA"
  );
  if (hasWeighedStage || params.hasRecepcionLines) return "CONSTRUYENDO";
  return "SOLO_PRODUCTO";
}

function formatQty(value: number): string {
  return value.toLocaleString("es-EC", { maximumFractionDigits: 4 });
}

/** "Anillo Filigrana (5 und) · Cadena Barbada (3 und)" -- mismo formato que
 * RunSummaryRows en solicitudes-view.tsx. Agrupa por identidad real
 * (product_type_id / target_item_id), no por nombre, para no fusionar dos
 * productos distintos que compartan texto. */
export function formatProductosResultantes(
  products: NonNullable<ProductionRun["products"]>
): string {
  const merged = new Map<string, { label: string; quantity: number; unit: string }>();
  for (const p of products) {
    const key = p.product_type_id ?? p.target_item_id ?? p.product_name ?? "—";
    const qty = num(p.quantity);
    const existing = merged.get(key);
    if (existing) {
      existing.quantity += qty;
    } else {
      merged.set(key, { label: p.product_name ?? "—", quantity: qty, unit: p.unit_code || "und" });
    }
  }
  if (merged.size === 0) return "—";
  return [...merged.values()]
    .map((p) => `${p.label} (${formatQty(p.quantity)} ${p.unit})`)
    .join(" · ");
}
```

- [ ] **Step 2: Agregar los campos nuevos a `OrdenProduccionModel`**

En el mismo archivo, en la definición de `OrdenProduccionModel` (línea 21 actual), agregar dos campos al final del tipo:

```ts
export type OrdenProduccionModel = {
  folio: string;
  procesoNombre: string;
  cantidad: number | null;
  cantidadUnidad: string;
  categoria: string;
  responsableProduccion: string;
  entrega: DocSide[];
  recepcion: DocSide[];
  entregaTotalRows: DocTotalRow[];
  recepcionTotalRows: DocTotalRow[];
  cancelada: boolean;
  recepcionPhase: ActaRightPhase;
  productosResultantes: string;
};
```

- [ ] **Step 3: Calcular y devolver los campos nuevos en `buildOrdenProduccion`**

En la misma función, justo antes del `return { ... }` final (después del bloque que calcula `recepcionTotalRows`, alrededor de la línea 163 actual), agregar:

```ts
  const recepcionPhase: ActaRightPhase = isHistorical
    ? "CONSTRUYENDO"
    : actaRightPhase({
        approved: canPrintEntrega(family),
        stages: family.flatMap((run) => run.stages),
        hasRecepcionLines: family.some((run) =>
          (run.acta_lines ?? []).some((line) => line.side === "RECEPCION")
        ),
      });
  const productosResultantes = formatProductosResultantes(
    family.flatMap((run) => run.products ?? [])
  );
```

Y en el `return`, agregar los dos campos:

```ts
  return {
    folio: root.root_production_code ?? root.production_code ?? DASH,
    procesoNombre: root.process_name,
    cantidad: isHistorical ? null : family.reduce((total, run) => total + num(run.quantity), 0),
    cantidadUnidad: root.raw_material_unit_code,
    categoria: materialName,
    responsableProduccion: root.created_by_name ?? DASH,
    entrega,
    recepcion,
    entregaTotalRows,
    recepcionTotalRows,
    cancelada: family.every((run) => run.status === "CANCELADA"),
    recepcionPhase,
    productosResultantes
  };
```

`canPrintEntrega` está declarada más abajo en el mismo archivo (`export function`, hoisted) — no hace falta reordenar nada.

- [ ] **Step 4: Verificar tipos**

Run: `docker-compose exec -T web npx tsc --noEmit -p tsconfig.json`
Expected: sin salida (build limpio). Si marca error en `orden-produccion.ts`, revisar que `ProductionRun` siga importado arriba del archivo (ya lo está, línea 1) y que `family.flatMap((run) => run.products ?? [])` tipe como `NonNullable<ProductionRun["products"]>`.

- [ ] **Step 5: Commit**

```bash
git add frontend/lib/orden-produccion.ts
git commit -m "feat(production): fase del lado recibido en el modelo del certificado"
```

---

### Task 2: Render en el documento impreso (`orden-produccion-doc.tsx`) + CSS

**Files:**
- Modify: `frontend/components/documentos/orden-produccion-doc.tsx`
- Modify: `frontend/app/globals.css`

**Interfaces:**
- Consumes: `ActaRightPhase`, `OrdenProduccionModel.recepcionPhase`, `OrdenProduccionModel.productosResultantes` (Task 1).
- Produces: clase CSS `.opColNotice` (compartida con Task 3).

- [ ] **Step 1: Importar el tipo nuevo**

En `frontend/components/documentos/orden-produccion-doc.tsx`, línea 1, cambiar:

```ts
import { DocSide, DocTotalRow, OrdenProduccionModel, formatDocDate, formatGramos } from "@/lib/orden-produccion";
```

por:

```ts
import { ActaRightPhase, DocSide, DocTotalRow, OrdenProduccionModel, formatDocDate, formatGramos } from "@/lib/orden-produccion";
```

- [ ] **Step 2: Agregar prop `notice` a `SideColumn` y ramificar el render**

Reemplazar la firma de `SideColumn` (líneas 13-23 actuales):

```tsx
function SideColumn({
  events,
  title,
  dataClass,
  totalRows
}: {
  events: DocSide[];
  title: string;
  dataClass: string;
  totalRows?: DocTotalRow[];
}) {
```

por:

```tsx
function SideColumn({
  events,
  title,
  dataClass,
  totalRows,
  notice
}: {
  events: DocSide[];
  title: string;
  dataClass: string;
  totalRows?: DocTotalRow[];
  notice?: { phase: ActaRightPhase; productos: string };
}) {
```

Reemplazar el `return` completo (líneas 46-103 actuales) por:

```tsx
  return (
    <section className="opCol">
      <div className="opColHead">
        {title}
        {singleEvent ? (
          <span className="opColSub">
            {" "}
            · {formatDocDate(singleEvent.fecha) || "—"} · {singleEvent.responsable || DASH_RESPONSABLE}
          </span>
        ) : null}
      </div>
      {notice && notice.phase !== "CONSTRUYENDO" ? (
        <div className="opColNotice">
          {notice.phase === "NO_APROBADO" ? (
            <span className={dataClass}>Aún no aprobado por inventario</span>
          ) : (
            <span className={dataClass}>
              <strong>Producto resultante</strong>
              <br />
              {notice.productos}
            </span>
          )}
        </div>
      ) : (
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
            {totals.map((row, index) => (
              <tr
                className={`opSubtotalRow ${row.kind === "merma" ? "opSubtotalRowMerma" : "opSubtotalRowTotal"}`}
                key={`total-${index}`}
              >
                <td> </td>
                <td className="opTdGramos"><span className={dataClass}>{formatGramos(row.gramos)} {row.unidad}</span></td>
                <td><span className={dataClass}>{row.label}</span></td>
              </tr>
            ))}
            {Array.from({ length: blankCount }).map((_, index) => (
              <tr key={`blank-${index}`}>
                <td> </td>
                <td className="opTdGramos"> </td>
                <td> </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
```

(El único cambio real es envolver la `<table>` original en un condicional: se muestra `.opColNotice` cuando hay `notice` y su fase no es `CONSTRUYENDO`, si no la tabla de siempre. Ramificar directo sobre `notice` — en vez de precalcular un booleano `showTable` aparte — es lo que deja a TypeScript angostar `notice` como definido dentro de esa rama.)

- [ ] **Step 3: Pasar `notice` desde `OrdenProduccionDoc`**

En la misma archivo, en `OrdenProduccionDoc` (línea 106 actual en adelante), cambiar la llamada del lado RECIBIDO:

```tsx
<SideColumn dataClass="opRecepcionData" events={model.recepcion} title="RECIBIDO" totalRows={model.recepcionTotalRows} />
```

por:

```tsx
<SideColumn
  dataClass="opRecepcionData"
  events={model.recepcion}
  notice={{ phase: model.recepcionPhase, productos: model.productosResultantes }}
  title="RECIBIDO"
  totalRows={model.recepcionTotalRows}
/>
```

La llamada del lado ENTREGADO (`opEntregaData`) queda exactamente igual — sin `notice`, `showTable` siempre `true` ahí.

- [ ] **Step 4: CSS de `.opColNotice`**

En `frontend/app/globals.css`, después de la regla `.opTotal` (línea 4776-4783 actual, justo antes de `.opStamp`), agregar:

```css
.opColNotice {
  border: 1px solid var(--doc-line);
  border-radius: 6px;
  min-height: 150px;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 4px;
  padding: 14px 10px;
  text-align: center;
  font-size: 13px;
  color: var(--doc-ink-strong);
}

.opColNotice strong {
  font-size: 11px;
  font-weight: 800;
  text-transform: uppercase;
  letter-spacing: 0.5px;
}
```

(`min-height: 150px` aproxima el alto visual de la tabla de 5 filas que reemplaza — 26px por fila + encabezado.)

- [ ] **Step 5: Verificar tipos**

Run: `docker-compose exec -T web npx tsc --noEmit -p tsconfig.json`
Expected: sin salida.

- [ ] **Step 6: Commit**

```bash
git add frontend/components/documentos/orden-produccion-doc.tsx frontend/app/globals.css
git commit -m "feat(production): certificado impreso muestra aviso/producto resultante en RECIBIDO"
```

---

### Task 3: Render en "Ver acta" (`acta-view.tsx`)

**Files:**
- Modify: `frontend/components/production/acta-view.tsx`

**Interfaces:**
- Consumes: `ActaRightPhase`, `actaRightPhase()`, `formatProductosResultantes()` (Task 1); clase CSS `.opColNotice` (Task 2).

- [ ] **Step 1: Importar los helpers nuevos**

En `frontend/components/production/acta-view.tsx`, línea 6, cambiar:

```ts
import { formatDocDate, formatGramos } from "@/lib/orden-produccion";
```

por:

```ts
import { ActaRightPhase, actaRightPhase, formatDocDate, formatGramos, formatProductosResultantes } from "@/lib/orden-produccion";
```

- [ ] **Step 2: Agregar prop `notice` a `ActaDocSide` y ramificar el render**

Cambiar la firma de `ActaDocSide` (líneas 31-49 actuales), agregando `notice` al objeto de props:

```tsx
function ActaDocSide({
  title,
  lines,
  fecha,
  responsable,
  onError,
  actions,
  footer,
  totalRows,
  notice,
}: {
  title: string;
  lines: ActaLine[];
  fecha: string | null;
  responsable: string;
  onError: (message: string) => void;
  actions?: React.ReactNode;
  footer?: React.ReactNode;
  totalRows?: TotalRow[];
  notice?: { phase: ActaRightPhase; productos: string };
}) {
```

Luego, en el `return` de `ActaDocSide` (líneas 97-204 actuales), envolver el `<table className="opTable">...</table>` existente igual que en Task 2: ramificar directo sobre `notice` (no precalcular un booleano aparte, así TypeScript angosta `notice` como definido dentro de esa rama) — si hay `notice` y su fase no es `CONSTRUYENDO`, renderizar en su lugar:

```tsx
<div className="opColNotice">
  {notice.phase === "NO_APROBADO" ? (
    <span>Aún no aprobado por inventario</span>
  ) : (
    <>
      <strong>Producto resultante</strong>
      <span>{notice.productos}</span>
    </>
  )}
</div>
```

El `return` completo queda:

```tsx
  return (
    <section className="opCol actaDocCol">
      <div className="opColHead">
        {title}
        <span className="opColSub"> · {formatDocDate(fecha) || DASH} · {responsable || DASH}</span>
      </div>
      {notice && notice.phase !== "CONSTRUYENDO" ? (
        <div className="opColNotice">
          {notice.phase === "NO_APROBADO" ? (
            <span>Aún no aprobado por inventario</span>
          ) : (
            <>
              <strong>Producto resultante</strong>
              <span>{notice.productos}</span>
            </>
          )}
        </div>
      ) : (
        <table className="opTable">
          <thead>
            <tr>
              <th className="opThFecha">FECHA</th>
              <th className="opThGramos">CANTIDAD</th>
              <th>DETALLES</th>
            </tr>
          </thead>
          <tbody>
            {lines.map((line) =>
              editingId === line.id ? (
                <tr key={line.id}>
                  <td> </td>
                  <td className="opTdGramos">
                    <span className="actaDocInputs">
                      <input
                        className="field"
                        min="0"
                        onChange={(e) => setEditQuantity(e.target.value)}
                        step="0.0001"
                        style={{ width: 84 }}
                        type="number"
                        value={editQuantity}
                      />
                      <input
                        className="field"
                        onChange={(e) => setEditUnit(e.target.value)}
                        style={{ width: 40 }}
                        value={editUnit}
                      />
                    </span>
                  </td>
                  <td>
                    <span className="actaDocInputs">
                      <input
                        className="field"
                        onChange={(e) => setEditLabel(e.target.value)}
                        style={{ flex: 1 }}
                        value={editLabel}
                      />
                      <button aria-label="Guardar" className="iconOnlyButton" disabled={isSaving} onClick={() => void saveEdit(line.id)} type="button">
                        <Check aria-hidden="true" size={14} />
                      </button>
                      <button aria-label="Cancelar" className="iconOnlyButton" disabled={isSaving} onClick={() => setEditingId(null)} type="button">
                        <X aria-hidden="true" size={14} />
                      </button>
                    </span>
                  </td>
                </tr>
              ) : (
                <tr className="actaDocRow" key={line.id}>
                  <td> </td>
                  <td className="opTdGramos">
                    {formatGramos(Number(line.quantity))} {line.unit_code}
                  </td>
                  <td>
                    <span className="actaDocDetail">
                      <span>{line.label}</span>
                      {line.source === "MANUAL" ? (
                        <span className="actaDocRowActions">
                          <button aria-label={`Editar ${line.label}`} className="iconOnlyButton" disabled={isSaving} onClick={() => startEdit(line)} type="button">
                            <Pencil aria-hidden="true" size={12} />
                          </button>
                          <button
                            aria-label={`Borrar ${line.label}`}
                            className="iconOnlyButton dangerIconButton"
                            disabled={isSaving}
                            onClick={() => void handleDelete(line.id)}
                            type="button"
                          >
                            <Trash2 aria-hidden="true" size={12} />
                          </button>
                        </span>
                      ) : null}
                    </span>
                  </td>
                </tr>
              )
            )}
            {totals.map((row, i) => (
              <tr
                className={`opSubtotalRow ${row.kind === "merma" ? "opSubtotalRowMerma" : "opSubtotalRowTotal"}`}
                key={`acta-total-${i}`}
              >
                <td> </td>
                <td className="opTdGramos">{formatGramos(row.quantity)} {row.unit}</td>
                <td>{row.label}</td>
              </tr>
            ))}
            {Array.from({ length: blankCount }).map((_, i) => (
              <tr key={`acta-blank-${i}`}>
                <td> </td>
                <td className="opTdGramos"> </td>
                <td> </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      {actions}
      {footer}
    </section>
  );
}
```

- [ ] **Step 3: Calcular la fase en `ActaView` y pasarla al lado RECIBIDO**

En `ActaView` (línea 585 actual en adelante), después de la línea `const { entregaTotalRows, recepcionTotalRows } = computeBalanceTotals(run);` (línea 601 actual), agregar:

```tsx
  const recepcionPhase = actaRightPhase({
    approved: run.materials_approved_at !== null,
    stages: run.stages,
    hasRecepcionLines: recepcion.length > 0,
  });
  const productosResultantes = formatProductosResultantes(run.products ?? []);
```

Luego, en la llamada a `<ActaDocSide>` del lado RECIBIDO (título "RECIBIDO", líneas 663-671 actuales), agregar la prop `notice`:

```tsx
<ActaDocSide
  fecha={run.received_at}
  footer={<RecepcionActions onChanged={onChanged} onError={flagError} onSuccess={flagSuccess} run={run} />}
  lines={recepcion}
  notice={{ phase: recepcionPhase, productos: productosResultantes }}
  onError={flagError}
  responsable={run.received_by_name ?? DASH}
  title="RECIBIDO"
  totalRows={recepcionTotalRows}
/>
```

La llamada del lado ENTREGADO (título "ENTREGADO") queda exactamente igual, sin `notice`.

- [ ] **Step 4: Verificar tipos**

Run: `docker-compose exec -T web npx tsc --noEmit -p tsconfig.json`
Expected: sin salida.

- [ ] **Step 5: Commit**

```bash
git add frontend/components/production/acta-view.tsx
git commit -m "feat(production): Ver Acta muestra aviso/producto resultante en RECIBIDO"
```

---

### Task 4: Verificación final

**Files:** ninguno nuevo — solo comandos de verificación sobre lo hecho en Tasks 1-3.

- [ ] **Step 1: Type-check completo del frontend**

Run: `docker-compose exec -T web npx tsc --noEmit -p tsconfig.json`
Expected: sin salida (limpio).

- [ ] **Step 2: Intentar build completo**

Run: `docker-compose exec -T web npm run build`
Expected: puede fallar en la etapa de fuentes de Google (`@vercel/turbopack-next/internal/font/google/font` module not found) si el contenedor no tiene salida a internet en este entorno — es una falla de red preexistente, no relacionada con este cambio (ya se confirmó en esta misma sesión antes de tocar este código). Si falla exactamente con ese error de fuentes y ningún otro, el `tsc` del Step 1 es la señal válida. Si falla con cualquier otro error (sobre `orden-produccion.ts`, `orden-produccion-doc.tsx` o `acta-view.tsx`), es una regresión real — hay que pararse y arreglarla antes de seguir.

- [ ] **Step 3: Dejar constancia de la verificación manual pendiente**

Este cambio es puramente visual (qué se renderiza en el lado RECIBIDO según el estado de la orden) y no hay test runner de frontend en este repo — `tsc`/`build` confirman que compila, no que se ve bien. Falta una pasada visual real en navegador con 3 órdenes (una en cada fase) antes de dar el feature por completamente verificado — dejarlo anotado explícitamente en vez de asumir que "compila" equivale a "se ve bien":
1. Orden recién creada (`PENDIENTE_INVENTARIO`) → Ver Acta y Documentos muestran "Aún no aprobado por inventario" del lado derecho.
2. Orden con materiales aprobados, ninguna etapa terminada → lado derecho muestra "Producto resultante" con la lista correcta.
3. Terminar una etapa que pesa (o devolver un sobrante) → lado derecho pasa a la tabla real con totales, igual que antes de este cambio.

- [ ] **Step 4: Commit final si Step 3 quedó pendiente de anotar en el spec**

No hay cambios de código en este task — nada que commitear salvo que se ajuste algo al revisar visualmente (en cuyo caso, commit normal describiendo el ajuste).
