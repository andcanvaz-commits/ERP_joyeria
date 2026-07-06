# Productos Terminados Agrupados — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Agrupar productos terminados por nombre con filas expandibles en Inventario y eliminar el mantenimiento de productos terminados.

**Architecture:** Solo frontend. Tarea 1: vista agrupada en `inventory-dashboard.tsx` (estado local de grupos expandidos + agrupación memoizada sobre `displayItems`). Tarea 2: quitar sección, modal, query e import en `production-dashboard.tsx` y borrar `finished-products-manager.tsx`.

**Tech Stack:** Next.js/React/TypeScript. Typecheck en contenedor `web`.

**Spec:** `docs/superpowers/specs/2026-07-06-productos-terminados-agrupados-design.md`

## Global Constraints

- Sin cambios de backend ni de datos.
- Se conserva el filtro `receivedCodes` en `displayItems`.
- Botón "Salida" intacto en la pestaña Productos terminados.
- Textos UI en español. Typecheck: `docker compose exec -T web npx tsc --noEmit` → exit 0.

---

### Task 1: Vista agrupada en Inventario

**Files:**
- Modify: `frontend/components/inventory/inventory-dashboard.tsx`

**Interfaces:**
- Consumes: `displayItems` (línea ~487), `search` (estado línea ~215), `numericText`, `setViewingItem`, iconos `ChevronDown`/`ChevronRight` (ya importados), tipo `InventoryItem`.
- Produces: nada para otras tareas.

- [ ] **Step 1: Import de Fragment y estado de grupos expandidos**

En la línea 4 (imports de react), asegurar `Fragment`:

```tsx
import { Fragment, useEffect, useMemo, useRef, useState } from "react";
```

(Respetar los imports existentes reales; solo añadir `Fragment` si falta.)

Junto a los estados existentes (cerca de la línea 215):

```tsx
const [expandedGroups, setExpandedGroups] = useState<Set<string>>(new Set());
```

- [ ] **Step 2: Agrupación memoizada**

Después de la definición de `displayItems` (línea ~487):

```tsx
// Grupos por nombre (categoria): la descripcion de cada pieza es su modelo.
const finishedGroups = useMemo(() => {
  const map = new Map<string, InventoryItem[]>();
  for (const item of displayItems) {
    const list = map.get(item.name);
    if (list) list.push(item);
    else map.set(item.name, [item]);
  }
  return [...map.entries()]
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([name, groupItems]) => ({
      name,
      items: groupItems,
      totalStock: groupItems.reduce((acc, it) => acc + Number(it.current_stock), 0),
    }));
}, [displayItems]);
const searchActive = search.trim().length > 0;

function toggleGroup(name: string) {
  setExpandedGroups((current) => {
    const next = new Set(current);
    if (next.has(name)) next.delete(name);
    else next.add(name);
    return next;
  });
}
```

- [ ] **Step 3: Reemplazar el tbody de la tabla de productos terminados**

En la rama `itemFilter === "FINISHED_PRODUCT"` (línea ~902), reemplazar el `<tbody>` completo por:

```tsx
<tbody>
  {finishedGroups.map((group) => {
    const isExpanded = searchActive || expandedGroups.has(group.name);
    return (
      <Fragment key={group.name}>
        <tr onClick={() => toggleGroup(group.name)} style={{ cursor: "pointer" }}>
          <td className="num">
            {isExpanded ? <ChevronDown aria-hidden="true" size={15} /> : <ChevronRight aria-hidden="true" size={15} />}
          </td>
          <td colSpan={4}><strong>{group.name}</strong> · {group.items.length} {group.items.length === 1 ? "pieza" : "piezas"}</td>
          <td className="num"><strong>{numericText(String(group.totalStock))} {group.items[0]?.unit_code ?? "g"}</strong></td>
          <td />
        </tr>
        {isExpanded
          ? group.items.map((item) => (
              <tr key={item.id}>
                <td />
                <td>{item.sku}</td>
                <td>{item.description ?? "—"}</td>
                <td>{item.material_type ?? "—"}</td>
                <td>{item.purity ?? "—"}</td>
                <td className="num">{numericText(item.current_stock)} {item.unit_code}</td>
                <td>
                  <div className="rowActions">
                    <button className="iconTextButton" onClick={(event) => { event.stopPropagation(); setViewingItem(item); }} type="button">
                      <Eye aria-hidden="true" size={15} />
                      Visualizar
                    </button>
                  </div>
                </td>
              </tr>
            ))
          : null}
      </Fragment>
    );
  })}
  {!isLoading && finishedGroups.length === 0 ? (
    <tr><td colSpan={7}><div className="emptyState">No hay productos terminados.</div></td></tr>
  ) : null}
  {isLoading ? (
    <tr><td colSpan={7}><div className="emptyState">Cargando inventario...</div></td></tr>
  ) : null}
</tbody>
```

El `<thead>` no cambia (# · Producto · Descripción · Metal principal · Ley/pureza · Stock · acciones).

- [ ] **Step 4: Typecheck**

Run: `docker compose exec -T web npx tsc --noEmit`
Expected: exit 0.

- [ ] **Step 5: Commit**

```bash
git add frontend/components/inventory/inventory-dashboard.tsx
git commit -m "feat(inventario): productos terminados agrupados por nombre con filas expandibles"
```

---

### Task 2: Eliminar mantenimiento de productos terminados

**Files:**
- Modify: `frontend/components/production/production-dashboard.tsx`
- Delete: `frontend/components/mantenimiento/finished-products-manager.tsx`

**Interfaces:**
- Consumes: nada de Task 1.
- Produces: nada.

- [ ] **Step 1: Quitar import**

Línea 8, eliminar:

```tsx
import { FinishedProductsManager } from "@/components/mantenimiento/finished-products-manager";
```

- [ ] **Step 2: Quitar query del listado**

Líneas ~195-197, eliminar:

```tsx
const { data: finishedProductsList = EMPTY_RAW_MATERIALS } = useQuery({
  queryKey: ["finished-products"],
  ...
});
```

(Eliminar el bloque completo de esa query; verificar con grep que `finishedProductsList` no tenga más usos que el tile eliminado en Step 4.)

- [ ] **Step 3: Estrechar tipo de dataModal**

Línea ~217:

```tsx
const [dataModal, setDataModal] = useState<{ type: "units" | "materials"; mode: "create" | "view" } | null>(null);
```

- [ ] **Step 4: Quitar sección de tiles**

Líneas ~1098-1112, eliminar la sección completa:

```tsx
<section className="maintenanceSection" aria-label="Productos terminados">
  <h2>Productos terminados</h2>
  ...
</section>
```

- [ ] **Step 5: Quitar render del modal**

Línea ~2057, eliminar:

```tsx
{dataModal?.type === "finished" ? <FinishedProductsManager mode={dataModal.mode} onClose={() => setDataModal(null)} /> : null}
```

- [ ] **Step 6: Borrar el componente**

```bash
git rm frontend/components/mantenimiento/finished-products-manager.tsx
```

- [ ] **Step 7: Typecheck**

Run: `docker compose exec -T web npx tsc --noEmit`
Expected: exit 0 (si `finishedProductsList` o `FinishedProductsManager` quedaron referenciados, fallará aquí — eliminar el uso restante).

- [ ] **Step 8: Verificación funcional**

Abrir `http://127.0.0.1:3000` → Inventario → Productos terminados: 11 grupos colapsados; clic expande piezas; buscador expande grupos coincidentes. Mantenimientos: sin sección de productos terminados.

- [ ] **Step 9: Commit**

```bash
git add frontend/components/production/production-dashboard.tsx
git commit -m "feat(mantenimientos): elimina mantenimiento de productos terminados"
```
