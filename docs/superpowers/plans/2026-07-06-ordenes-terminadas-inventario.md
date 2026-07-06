# Pestaña "Órdenes terminadas" en Inventario — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Pestaña propia en Inventario para órdenes de producción RECIBIDA, separadas de la tabla de productos terminados.

**Architecture:** Solo frontend, un archivo: `inventory-dashboard.tsx`. Se agrega un valor de filtro local `"ORDENES_TERMINADAS"` al selector segmentado, una rama de tabla nueva que pinta `receivedRuns` (ya cargadas), y se eliminan las filas de runs de la tabla de productos terminados.

**Tech Stack:** Next.js/React/TypeScript. Typecheck dentro del contenedor `web` (node_modules local incompleto).

**Spec:** `docs/superpowers/specs/2026-07-06-ordenes-terminadas-inventario-design.md`

## Global Constraints

- Sin cambios de backend ni de datos.
- El botón "Salida" sigue solo en la pestaña Producto terminado (condición `itemFilter === "FINISHED_PRODUCT"` en la línea ~809 no se toca).
- Se conserva el filtro `receivedCodes` de `displayItems` (línea ~487): los items de inventario creados al recibir una orden siguen ocultos en la tabla de productos terminados (se representan en la nueva pestaña).
- Textos de UI en español.

---

### Task 1: Pestaña Órdenes terminadas

**Files:**
- Modify: `frontend/components/inventory/inventory-dashboard.tsx`

**Interfaces:**
- Consumes: `receivedRuns` (línea ~481: `productionRuns.filter((run) => run.status === "RECIBIDA")`), `setViewingRun` (modal existente), `numericText(value: string | null)`.
- Produces: nada consumido por otras tareas (tarea única).

- [ ] **Step 1: Ampliar tipo del filtro y agregar la pestaña**

En la línea ~36, cambiar el tipo del array y agregar la opción al final:

```tsx
const ITEM_TYPES: Array<{ value: InventoryItemType | "TODOS" | "ORDENES_TERMINADAS"; label: string }> = [
  { value: "RAW_MATERIAL", label: "Materia prima" },
  { value: "WORK_IN_PROGRESS", label: "Producto en proceso" },
  { value: "FINISHED_PRODUCT", label: "Producto terminado" },
  { value: "ORDENES_TERMINADAS", label: "Ordenes terminadas" },
];
```

(Si el array actual tiene una opción "TODOS", se conserva tal cual en su posición.)

En la línea ~213, ampliar el tipo del estado:

```tsx
const [itemFilter, setItemFilter] = useState<InventoryItemType | "TODOS" | "ORDENES_TERMINADAS">("RAW_MATERIAL");
```

- [ ] **Step 2: Subtítulo del panel**

En la cadena de subtítulos (línea ~771), agregar el caso nuevo antes del default:

```tsx
<p className="panelText">
  {itemFilter === "RAW_MATERIAL"
    ? "Ingresos manuales y facturas XML de materia prima"
    : itemFilter === "FINISHED_PRODUCT"
      ? "Salidas comerciales de productos terminados"
      : itemFilter === "ORDENES_TERMINADAS"
        ? "Ordenes de produccion recibidas en inventario"
        : "Seguimiento de productos en proceso"}
</p>
```

- [ ] **Step 3: Quitar las filas de runs de la tabla de productos terminados**

En la rama `itemFilter === "FINISHED_PRODUCT"` (línea ~899), eliminar por completo el bloque `{receivedRuns.map((run) => (...))}` (filas con key `recibida-${run.id}`) y ajustar el estado vacío para no depender de runs:

```tsx
{!isLoading && displayItems.length === 0 ? (
  <tr><td colSpan={7}><div className="emptyState">No hay productos terminados.</div></td></tr>
) : null}
```

- [ ] **Step 4: Nueva rama de tabla para la pestaña**

En el ternario de tablas (`RAW_MATERIAL ? ... : FINISHED_PRODUCT ? ... : (productos en proceso)`), insertar una rama antes del default:

```tsx
) : itemFilter === "ORDENES_TERMINADAS" ? (
  <div className="tableWrap">
    <table className="table inventoryItemsTable">
      <thead>
        <tr>
          <th>Codigo</th>
          <th>Proceso</th>
          <th className="num">Cantidad</th>
          <th className="num">Peso final</th>
          <th className="num">Merma %</th>
          <th>Recibida por</th>
          <th>Fecha recepcion</th>
          <th aria-label="Acciones" />
        </tr>
      </thead>
      <tbody>
        {receivedRuns.map((run) => (
          <tr key={run.id}>
            <td>{run.production_code ?? "—"}</td>
            <td>{run.process_name}</td>
            <td className="num">{numericText(run.quantity)} und</td>
            <td className="num">{run.actual_finished_weight ? `${numericText(run.actual_finished_weight)} g` : "—"}</td>
            <td className="num">{run.waste_percent ? `${numericText(run.waste_percent)}%` : "—"}</td>
            <td>{run.received_by_name ?? "—"}</td>
            <td>{run.received_at ? new Date(run.received_at).toLocaleDateString("es-EC", { day: "2-digit", month: "short", year: "numeric" }) : "—"}</td>
            <td>
              <div className="rowActions">
                <button className="iconTextButton" onClick={() => setViewingRun(run)} type="button">
                  <Eye aria-hidden="true" size={15} />
                  Visualizar
                </button>
              </div>
            </td>
          </tr>
        ))}
        {receivedRuns.length === 0 ? (
          <tr><td colSpan={8}><div className="emptyState">No hay ordenes terminadas.</div></td></tr>
        ) : null}
      </tbody>
    </table>
  </div>
```

- [ ] **Step 5: Typecheck en el contenedor web**

Run: `docker compose exec -T web npx tsc --noEmit`
Expected: exit 0, sin errores.

- [ ] **Step 6: Verificación funcional**

Con el stack corriendo, abrir `http://127.0.0.1:3000` → Inventario:
- Pestaña nueva "Ordenes terminadas" visible con la tabla (o estado vacío).
- Pestaña "Producto terminado" sin filas de órdenes y sin botón Salida ausente (el botón sigue ahí).
- Pestaña nueva sin botón Salida.

- [ ] **Step 7: Commit**

```bash
git add frontend/components/inventory/inventory-dashboard.tsx frontend/app/globals.css
git commit -m "feat(inventario): pestana ordenes terminadas; separa runs de productos terminados"
```

(Nota: `globals.css` lleva el fix ya hecho del menú de perfil hacia abajo; entra en este commit junto con los ajustes de columnas ya aplicados al dashboard.)
