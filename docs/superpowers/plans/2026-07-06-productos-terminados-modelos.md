# Productos Terminados como Modelos — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Productos terminados pasan a representar modelos (ej. "Cadena BB 45cm") con stock por unidad de medida; se consolidan las 178 piezas legacy en ~11 modelos.

**Architecture:** Sin cambios de esquema. Una migración de datos Alembic consolida filas `FINISHED_PRODUCT` agrupando por `(name, purity, unit_code)` y re-apunta movimientos. El form frontend se reescribe: nombre libre, metal desde materias primas (ley automática), unidad desde catálogo `units_of_measure`. Stock solo por movimientos.

**Tech Stack:** Alembic (SQL crudo con `op.execute`), Next.js/React/TypeScript, TanStack Query.

**Spec:** `docs/superpowers/specs/2026-07-06-productos-terminados-modelos-design.md`

## Global Constraints

- No quemar procesos ni etapas en código (CLAUDE.md).
- Stock nunca se edita directo; solo por movimientos de inventario.
- El stack corre en Docker: `docker compose exec api ...` para Alembic, `docker compose exec web ...` para tooling frontend. `node_modules` local está incompleto — typecheck SOLO dentro del contenedor `web`.
- No hay infraestructura de tests backend (`backend/tests/` no existe); la migración se verifica con consultas SQL explícitas antes/después.
- Textos de UI en español, como el resto del sistema.
- DB Postgres del compose: usuario `erp_joyeria`, db `erp_joyeria`.

---

### Task 1: Migración Alembic — consolidar productos terminados

**Files:**
- Create: `backend/alembic/versions/d0e1f2a3b4c5_consolidate_finished_products.py`

**Interfaces:**
- Consumes: head actual de Alembic `c9d0e1f2a3b4`; tablas `inventory_items`, `inventory_movements`.
- Produces: filas `FINISHED_PRODUCT` consolidadas (una por `(name, purity, unit_code)`), `material_type` normalizado (`99.99 → PLATA MIL`, `99.25 → PLATA LIGADA`), movimientos re-apuntados. Ninguna otra tabla referencia productos terminados (verificado: solo `inventory_movements.item_id` tiene FK; las columnas `*_item_id` de producción apuntan a materias primas).

- [ ] **Step 1: Capturar estado previo (baseline para verificar)**

```bash
docker compose exec -T db psql -U erp_joyeria -d erp_joyeria -c "SELECT COUNT(*) AS piezas, SUM(current_stock) AS stock_total FROM inventory_items WHERE item_type='FINISHED_PRODUCT';" -c "SELECT COUNT(*) AS movs FROM inventory_movements m JOIN inventory_items i ON i.id=m.item_id WHERE i.item_type='FINISHED_PRODUCT';"
```

Anotar los tres números (esperado: 178 piezas; stock_total y movs según DB actual).

- [ ] **Step 2: Escribir la migración**

Crear `backend/alembic/versions/d0e1f2a3b4c5_consolidate_finished_products.py`:

```python
"""Consolida productos terminados: piezas -> modelos.

Agrupa FINISHED_PRODUCT por (name, purity, unit_code); sobrevive la fila de
menor sku, acumula current_stock/total_weight, promedia average_cost ponderado
y re-apunta inventory_movements. Downgrade NO restaura las piezas originales
(consolidacion irreversible por diseno; ver spec 2026-07-06).

Revision ID: d0e1f2a3b4c5
Revises: c9d0e1f2a3b4
Create Date: 2026-07-06
"""
from typing import Sequence, Union

from alembic import op

# revision identifiers, used by Alembic.
revision: str = "d0e1f2a3b4c5"
down_revision: Union[str, None] = "c9d0e1f2a3b4"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    # 1. Normaliza material_type segun la ley (coincide con materias primas reales).
    op.execute(
        "UPDATE inventory_items SET material_type = 'PLATA MIL' "
        "WHERE item_type = 'FINISHED_PRODUCT' AND purity = '99.99'"
    )
    op.execute(
        "UPDATE inventory_items SET material_type = 'PLATA LIGADA' "
        "WHERE item_type = 'FINISHED_PRODUCT' AND purity = '99.25'"
    )

    # 2. Grupos: sobrevive la fila de menor sku por (name, purity, unit_code).
    op.execute(
        """
        CREATE TEMPORARY TABLE fp_groups ON COMMIT DROP AS
        SELECT
            (array_agg(id ORDER BY sku))[1] AS survivor_id,
            array_agg(id) AS all_ids,
            SUM(current_stock) AS stock_sum,
            SUM(COALESCE(total_weight, 0)) AS weight_sum,
            CASE WHEN SUM(current_stock) > 0
                 THEN SUM(current_stock * average_cost) / SUM(current_stock)
                 ELSE 0 END AS avg_cost
        FROM inventory_items
        WHERE item_type = 'FINISHED_PRODUCT'
        GROUP BY name, COALESCE(purity, ''), unit_code
        """
    )

    # 3. Re-apunta movimientos de las piezas absorbidas al modelo sobreviviente.
    op.execute(
        """
        UPDATE inventory_movements m
        SET item_id = g.survivor_id
        FROM fp_groups g
        WHERE m.item_id = ANY(g.all_ids) AND m.item_id <> g.survivor_id
        """
    )

    # 4. Acumula stock, peso y costo promedio ponderado en el sobreviviente.
    op.execute(
        """
        UPDATE inventory_items i
        SET current_stock = g.stock_sum,
            total_weight = g.weight_sum,
            average_cost = g.avg_cost
        FROM fp_groups g
        WHERE i.id = g.survivor_id
        """
    )

    # 5. Borra las piezas absorbidas.
    op.execute(
        """
        DELETE FROM inventory_items i
        USING fp_groups g
        WHERE i.id = ANY(g.all_ids) AND i.id <> g.survivor_id
        """
    )


def downgrade() -> None:
    # Irreversible: las piezas originales ya no existen tras consolidar.
    pass
```

- [ ] **Step 3: Aplicar la migración**

```bash
docker compose exec -T api alembic upgrade head
```

Expected: `Running upgrade c9d0e1f2a3b4 -> d0e1f2a3b4c5` sin errores.

- [ ] **Step 4: Verificar resultado contra baseline**

```bash
docker compose exec -T db psql -U erp_joyeria -d erp_joyeria -c "SELECT name, material_type, purity, unit_code, current_stock FROM inventory_items WHERE item_type='FINISHED_PRODUCT' ORDER BY name;" -c "SELECT COUNT(*) AS movs, COUNT(DISTINCT m.item_id) AS items_con_movs FROM inventory_movements m JOIN inventory_items i ON i.id=m.item_id WHERE i.item_type='FINISHED_PRODUCT';" -c "SELECT COUNT(*) AS huerfanos FROM inventory_movements m LEFT JOIN inventory_items i ON i.id=m.item_id WHERE i.id IS NULL;"
```

Expected:
- ~11 filas (una por nombre; ARETES y ANILLOS con PLATA LIGADA/99.25, resto PLATA MIL/99.99).
- `SUM(current_stock)` de esas filas == stock_total del Step 1 (verificar con `SELECT SUM(current_stock)...`).
- `movs` == movs del Step 1 (ningún movimiento perdido).
- `huerfanos` == 0.

- [ ] **Step 5: Commit**

```bash
git add backend/alembic/versions/d0e1f2a3b4c5_consolidate_finished_products.py
git commit -m "feat(inventario): consolida productos terminados en modelos (migracion de datos)"
```

---

### Task 2: Form de productos terminados — modelo con metal y unidad

**Files:**
- Modify: `frontend/components/mantenimiento/finished-products-manager.tsx` (reescritura del form y tabla)

**Interfaces:**
- Consumes: `listInventoryItems(itemType)` y `SaveInventoryItemPayload` de `frontend/lib/inventory-api.ts`; `listUnits(): Promise<Unit[]>` de `frontend/lib/units-api.ts` (`Unit = { id, code, label, is_active }`); tipo `InventoryItem` de `frontend/types/inventory`.
- Produces: form sin dependencia de procesos (se revierte el import de `listProcesses` del diff de trabajo actual). Payload envía `total_weight: null` y `elaboration_date: null` (campos de pieza, ya no se usan).

- [ ] **Step 1: Reescribir el componente**

Reemplazar el contenido completo de `frontend/components/mantenimiento/finished-products-manager.tsx` por:

```tsx
"use client";

import { FormEvent, useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil, Plus, Save, Trash2, X } from "lucide-react";
import type { InventoryItem } from "@/types/inventory";
import { createInventoryItem, deleteInventoryItem, listInventoryItems, updateInventoryItem } from "@/lib/inventory-api";
import { listUnits } from "@/lib/units-api";
import { confirmDelete, useConfirm } from "@/components/ui/confirm-dialog";

export function FinishedProductsManager({ mode, onClose }: { mode: "create" | "view"; onClose: () => void }) {
  const queryClient = useQueryClient();
  const { data: items = [], isLoading } = useQuery({
    queryKey: ["finished-products"],
    queryFn: () => listInventoryItems("FINISHED_PRODUCT"),
  });
  const { data: rawMaterials = [] } = useQuery({
    queryKey: ["raw-materials"],
    queryFn: () => listInventoryItems("RAW_MATERIAL"),
  });
  const { data: units = [] } = useQuery({ queryKey: ["units"], queryFn: listUnits });
  const activeUnits = units.filter((unit) => unit.is_active);

  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [materialItemId, setMaterialItemId] = useState("");
  const [unitCode, setUnitCode] = useState("");
  const [description, setDescription] = useState("");
  // Valores actuales del item al editar; se conservan si no se re-elige materia prima.
  const [fallbackMetal, setFallbackMetal] = useState("");
  const [fallbackPurity, setFallbackPurity] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const { confirm, dialog } = useConfirm();

  const selectedMaterial = rawMaterials.find((item) => item.id === materialItemId) ?? null;
  const purity = selectedMaterial ? (selectedMaterial.purity ?? "") : fallbackPurity;

  useEffect(() => {
    if (!success) return;
    const timer = setTimeout(() => setSuccess(null), 3000);
    return () => clearTimeout(timer);
  }, [success]);

  function resetForm() {
    setEditingId(null);
    setName("");
    setMaterialItemId("");
    setUnitCode("");
    setDescription("");
    setFallbackMetal("");
    setFallbackPurity("");
  }

  function startEdit(item: InventoryItem) {
    setEditingId(item.id);
    setName(item.name);
    setDescription(item.description ?? "");
    setUnitCode(item.unit_code);
    setFallbackMetal(item.material_type ?? "");
    setFallbackPurity(item.purity ?? "");
    // Preselecciona si el metal actual coincide con una materia prima registrada.
    const material = rawMaterials.find((raw) => raw.name === item.material_type);
    setMaterialItemId(material?.id ?? "");
    setError(null);
  }

  async function handleDelete(item: InventoryItem) {
    const ok = await confirmDelete(confirm, item.name);
    if (!ok) return;
    setError(null);
    try {
      await deleteInventoryItem(item.id);
      setSuccess("Producto terminado eliminado.");
      await queryClient.invalidateQueries({ queryKey: ["finished-products"] });
      await queryClient.invalidateQueries({ queryKey: ["inventory"] });
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo eliminar el producto.");
    }
  }

  async function handleAdd(event: FormEvent) {
    event.preventDefault();
    setError(null);
    if (!name.trim()) {
      setError("Escribe el nombre del modelo.");
      return;
    }
    if (!editingId && !selectedMaterial) {
      setError("Selecciona el metal (materia prima).");
      return;
    }
    if (!unitCode) {
      setError("Selecciona la unidad de medida.");
      return;
    }
    const payload = {
      item_type: "FINISHED_PRODUCT" as const,
      name: name.trim(),
      description: description.trim() || null,
      material_type: selectedMaterial ? selectedMaterial.name : fallbackMetal.trim() || null,
      purity: purity.trim() || null,
      total_weight: null,
      elaboration_date: null,
      unit_code: unitCode,
      minimum_stock: null,
    };
    setIsSaving(true);
    try {
      if (editingId) {
        await updateInventoryItem(editingId, payload);
        setSuccess("Producto terminado actualizado.");
      } else {
        await createInventoryItem(payload);
        setSuccess("Producto terminado creado.");
      }
      resetForm();
      await queryClient.invalidateQueries({ queryKey: ["finished-products"] });
      await queryClient.invalidateQueries({ queryKey: ["inventory"] });
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo guardar el producto.");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="modalBackdrop" role="dialog" aria-modal="true" aria-label="Productos terminados">
      <section className="modalWindow">
        <div className="modalHeader">
          <div>
            <h2>{mode === "create" ? "Crear producto terminado" : "Productos terminados"}</h2>
            <p className="panelText">Cada producto es un modelo; las existencias entran por movimientos de inventario.</p>
          </div>
          <button aria-label="Cerrar" className="iconOnlyButton" onClick={onClose} type="button">
            <X aria-hidden="true" size={18} />
          </button>
        </div>

        {error || success ? (
          <div className="toastStack" aria-live="polite">
            {error ? <div className="notice noticeError noticeCompact" key={error} style={{ pointerEvents: "auto" }}><span className="noticeInner">{error}</span></div> : null}
            {success ? <div className="notice noticeSuccess noticeCompact" key={success} style={{ pointerEvents: "auto" }}><span className="noticeInner">{success}</span></div> : null}
          </div>
        ) : null}

        {mode === "create" || editingId ? (
        <form onSubmit={handleAdd} style={{ display: "grid", gap: 12 }}>
          <div className="materialRow">
            <label className="fieldGroup">
              <span>Nombre del modelo</span>
              <input className="field" disabled={isSaving} maxLength={180} onChange={(e) => setName(e.target.value)} placeholder="Ej. Cadena BB 45cm" value={name} />
            </label>
            <label className="fieldGroup">
              <span>Metal (materia prima)</span>
              <select className="field" disabled={isSaving} onChange={(e) => setMaterialItemId(e.target.value)} value={materialItemId}>
                <option value="">Seleccionar materia prima</option>
                {rawMaterials.map((item) => (
                  <option key={item.id} value={item.id}>{item.name}</option>
                ))}
              </select>
            </label>
          </div>
          <div className="materialRow">
            <label className="fieldGroup">
              <span>Ley / pureza</span>
              <input className="field" disabled readOnly value={purity || "—"} />
            </label>
            <label className="fieldGroup">
              <span>Unidad de medida</span>
              <select className="field" disabled={isSaving} onChange={(e) => setUnitCode(e.target.value)} value={unitCode}>
                <option value="">Seleccionar unidad</option>
                {activeUnits.map((unit) => (
                  <option key={unit.id} value={unit.code}>{unit.label} ({unit.code})</option>
                ))}
              </select>
            </label>
          </div>
          <div className="materialRow">
            <label className="fieldGroup">
              <span>Descripción</span>
              <input className="field" disabled={isSaving} maxLength={1000} onChange={(e) => setDescription(e.target.value)} value={description} />
            </label>
          </div>
          <div className="modalActions">
            {editingId ? (
              <button className="button" disabled={isSaving} onClick={resetForm} type="button">Cancelar</button>
            ) : null}
            <button className="button buttonPrimary" disabled={isSaving} type="submit">
              {editingId ? <Save aria-hidden="true" size={14} /> : <Plus aria-hidden="true" size={14} />}
              {editingId ? " Guardar cambios" : " Crear producto"}
            </button>
          </div>
        </form>
        ) : null}

        {mode === "view" ? (
        <div className="tableWrap" style={{ marginTop: 14, maxHeight: 200, overflowY: "auto" }}>
          <table className="table">
            <thead>
              <tr>
                <th style={{ width: 40 }}>#</th>
                <th>Modelo</th>
                <th>Metal</th>
                <th>Ley</th>
                <th>Unidad</th>
                <th>Stock actual</th>
                <th aria-label="Acciones" />
              </tr>
            </thead>
            <tbody>
              {items.map((item, index) => (
                <tr key={item.id}>
                  <td className="num">{index + 1}</td>
                  <td>{item.name}</td>
                  <td>{item.material_type ?? "—"}</td>
                  <td>{item.purity ?? "—"}</td>
                  <td>{item.unit_code}</td>
                  <td className="num">{item.current_stock}</td>
                  <td style={{ textAlign: "right" }}>
                    <span className="rowActions" style={{ justifyContent: "flex-end" }}>
                      <button aria-label={`Editar ${item.name}`} className="iconOnlyButton" onClick={() => startEdit(item)} type="button">
                        <Pencil aria-hidden="true" size={14} />
                      </button>
                      <button
                        aria-label={`Eliminar ${item.name}`}
                        className="iconOnlyButton dangerIconButton"
                        disabled={Number(item.current_stock) > 0}
                        title={Number(item.current_stock) > 0 ? "Deja el stock en cero para poder eliminar" : "Eliminar"}
                        onClick={() => void handleDelete(item)}
                        type="button"
                      >
                        <Trash2 aria-hidden="true" size={14} />
                      </button>
                    </span>
                  </td>
                </tr>
              ))}
              {!isLoading && items.length === 0 ? (
                <tr>
                  <td colSpan={7}><div className="emptyState">Sin productos terminados. Crea el primero.</div></td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
        ) : null}
      </section>
      {dialog}
    </div>
  );
}
```

- [ ] **Step 2: Typecheck dentro del contenedor web**

```bash
docker compose exec -T web npx tsc --noEmit
```

Expected: sin errores en `finished-products-manager.tsx` (errores pre-existentes de otros archivos, si los hay, se ignoran).

- [ ] **Step 3: Verificación funcional contra la app corriendo**

Con el stack arriba (`docker compose ps` → web/api/db Up), verificar por API (misma superficie que usa el form):

```bash
docker compose exec -T db psql -U erp_joyeria -d erp_joyeria -c "SELECT name, material_type, purity, unit_code, current_stock FROM inventory_items WHERE item_type='FINISHED_PRODUCT' ORDER BY name LIMIT 15;"
```

Expected: los ~11 modelos consolidados listados; abrir `http://127.0.0.1:3000` → Mantenimientos → Productos terminados y confirmar visualmente: tabla con columnas Modelo/Metal/Ley/Unidad/Stock actual, form con selects de materia prima y unidad, ley solo lectura.

- [ ] **Step 4: Commit**

```bash
git add frontend/components/mantenimiento/finished-products-manager.tsx
git commit -m "feat(mantenimientos): producto terminado como modelo (metal desde materias primas, unidad configurable)"
```
