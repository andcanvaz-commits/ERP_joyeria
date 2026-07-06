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
