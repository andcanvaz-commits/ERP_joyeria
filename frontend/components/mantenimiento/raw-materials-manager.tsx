"use client";

import { FormEvent, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil, Plus, Save, Trash2, X } from "lucide-react";
import type { InventoryItem } from "@/types/inventory";
import { createInventoryItem, deleteInventoryItem, listInventoryItems, updateInventoryItem } from "@/lib/inventory-api";
import { listUnits } from "@/lib/units-api";
import { confirmDelete, useConfirm } from "@/components/ui/confirm-dialog";

export function RawMaterialsManager({ mode, onClose }: { mode: "create" | "view"; onClose: () => void }) {
  const queryClient = useQueryClient();
  const { data: items = [], isLoading } = useQuery({
    queryKey: ["raw-materials"],
    queryFn: () => listInventoryItems("RAW_MATERIAL"),
  });
  const { data: units = [] } = useQuery({ queryKey: ["units"], queryFn: listUnits });

  const [editingId, setEditingId] = useState<string | null>(null);
  const [materialType, setMaterialType] = useState("");
  const [description, setDescription] = useState("");
  const [purity, setPurity] = useState("");
  const [unitCode, setUnitCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const { confirm, dialog } = useConfirm();

  function resetForm() {
    setEditingId(null);
    setMaterialType("");
    setDescription("");
    setPurity("");
    setUnitCode("");
  }

  function startEdit(item: InventoryItem) {
    setEditingId(item.id);
    setMaterialType(item.material_type ?? item.name);
    setDescription(item.description ?? "");
    setPurity(item.purity ?? "");
    setUnitCode(item.unit_code);
    setError(null);
  }

  async function handleDelete(item: InventoryItem) {
    const ok = await confirmDelete(confirm, item.material_type ?? item.name);
    if (!ok) return;
    setError(null);
    try {
      await deleteInventoryItem(item.id);
      await queryClient.invalidateQueries({ queryKey: ["raw-materials"] });
      await queryClient.invalidateQueries({ queryKey: ["inventory"] });
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo eliminar la materia prima.");
    }
  }

  const unitOptions = useMemo(
    () => units.map((unit) => ({ value: unit.code, label: `${unit.label} (${unit.code})` })),
    [units],
  );

  async function handleAdd(event: FormEvent) {
    event.preventDefault();
    setError(null);
    if (!materialType.trim()) {
      setError("Escribe el tipo de materia prima.");
      return;
    }
    const unit = unitCode || unitOptions[0]?.value || "g";
    const payload = {
      item_type: "RAW_MATERIAL" as const,
      name: materialType.trim(),
      material_type: materialType.trim(),
      description: description.trim() || null,
      purity: purity.trim() || null,
      unit_code: unit,
      minimum_stock: null,
    };
    setIsSaving(true);
    try {
      if (editingId) {
        await updateInventoryItem(editingId, payload);
      } else {
        await createInventoryItem(payload);
      }
      resetForm();
      await queryClient.invalidateQueries({ queryKey: ["raw-materials"] });
      await queryClient.invalidateQueries({ queryKey: ["inventory"] });
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo guardar la materia prima.");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="modalBackdrop" role="dialog" aria-modal="true" aria-label="Materias primas">
      <section className="modalWindow">
        <div className="modalHeader">
          <div>
            <h2>{mode === "create" ? "Crear materia prima" : "Materias primas"}</h2>
            <p className="panelText">Materias primas del inventario (tipo, ley y unidad).</p>
          </div>
          <button aria-label="Cerrar" className="iconOnlyButton" onClick={onClose} type="button">
            <X aria-hidden="true" size={18} />
          </button>
        </div>

        {error ? (
          <div className="toastStack" aria-live="polite">
            <div className="notice noticeError" key={error} style={{ paddingBottom: 13, pointerEvents: "auto" }}><span className="noticeInner">{error}</span></div>
          </div>
        ) : null}

        {mode === "create" || editingId ? (
        <form onSubmit={handleAdd} style={{ display: "grid", gap: 12 }}>
          <div className="materialRow">
            <label className="fieldGroup">
              <span>Tipo</span>
              <input className="field" disabled={isSaving} maxLength={80} onChange={(e) => setMaterialType(e.target.value)} placeholder="Ej. Oro, Plata" value={materialType} />
            </label>
            <label className="fieldGroup">
              <span>Ley / pureza</span>
              <input className="field" disabled={isSaving} maxLength={40} onChange={(e) => setPurity(e.target.value)} placeholder="Ej. 18K, 925" value={purity} />
            </label>
          </div>
          <div className="materialRow">
            <label className="fieldGroup">
              <span>Unidad</span>
              <select className="field" disabled={isSaving} onChange={(e) => setUnitCode(e.target.value)} value={unitCode || unitOptions[0]?.value || ""}>
                {unitOptions.map((unit) => (
                  <option key={unit.value} value={unit.value}>{unit.label}</option>
                ))}
              </select>
            </label>
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
              {editingId ? " Guardar cambios" : " Crear materia prima"}
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
                <th>Tipo</th>
                <th>Ley/pureza</th>
                <th>Unidad</th>
                <th aria-label="Acciones" />
              </tr>
            </thead>
            <tbody>
              {items.map((item, index) => (
                <tr key={item.id}>
                  <td className="num">{index + 1}</td>
                  <td>{item.material_type ?? item.name}</td>
                  <td>{item.purity ?? "—"}</td>
                  <td>{item.unit_code}</td>
                  <td style={{ textAlign: "right" }}>
                    <span className="rowActions" style={{ justifyContent: "flex-end" }}>
                      <button
                        aria-label={`Editar ${item.material_type ?? item.name}`}
                        className="iconOnlyButton"
                        onClick={() => startEdit(item)}
                        type="button"
                      >
                        <Pencil aria-hidden="true" size={14} />
                      </button>
                      <button
                        aria-label={`Eliminar ${item.material_type ?? item.name}`}
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
                  <td colSpan={5}><div className="emptyState">Sin materias primas. Crea la primera.</div></td>
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
