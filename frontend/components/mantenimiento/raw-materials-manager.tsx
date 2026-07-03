"use client";

import { FormEvent, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2, X } from "lucide-react";
import type { InventoryItem } from "@/types/inventory";
import { createInventoryItem, deleteInventoryItem, listInventoryItems } from "@/lib/inventory-api";
import { listUnits } from "@/lib/units-api";
import { confirmDelete, useConfirm } from "@/components/ui/confirm-dialog";

export function RawMaterialsManager({ onClose }: { onClose: () => void }) {
  const queryClient = useQueryClient();
  const { data: items = [], isLoading } = useQuery({
    queryKey: ["raw-materials"],
    queryFn: () => listInventoryItems("RAW_MATERIAL"),
  });
  const { data: units = [] } = useQuery({ queryKey: ["units"], queryFn: listUnits });

  const [materialType, setMaterialType] = useState("");
  const [description, setDescription] = useState("");
  const [purity, setPurity] = useState("");
  const [unitCode, setUnitCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const { confirm, dialog } = useConfirm();

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
    setIsSaving(true);
    try {
      await createInventoryItem({
        item_type: "RAW_MATERIAL",
        name: materialType.trim(),
        material_type: materialType.trim(),
        description: description.trim() || null,
        purity: purity.trim() || null,
        unit_code: unit,
        minimum_stock: null,
      });
      setMaterialType("");
      setDescription("");
      setPurity("");
      setUnitCode("");
      await queryClient.invalidateQueries({ queryKey: ["raw-materials"] });
      await queryClient.invalidateQueries({ queryKey: ["inventory"] });
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo crear la materia prima.");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="modalBackdrop" role="dialog" aria-modal="true" aria-label="Materias primas">
      <section className="modalWindow">
        <div className="modalHeader">
          <div>
            <h2>Materias primas</h2>
            <p className="panelText">Crea las materias primas del inventario.</p>
          </div>
          <button aria-label="Cerrar" className="iconOnlyButton" onClick={onClose} type="button">
            <X aria-hidden="true" size={18} />
          </button>
        </div>

        {error ? <div className="notice noticeError">{error}</div> : null}

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
            <button className="button buttonPrimary" disabled={isSaving} type="submit">
              <Plus aria-hidden="true" size={14} /> Crear materia prima
            </button>
          </div>
        </form>

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
                    <button
                      aria-label={`Eliminar ${item.material_type ?? item.name}`}
                      className="iconOnlyButton dangerIconButton"
                      onClick={() => void handleDelete(item)}
                      type="button"
                    >
                      <Trash2 aria-hidden="true" size={14} />
                    </button>
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
      </section>
      {dialog}
    </div>
  );
}
