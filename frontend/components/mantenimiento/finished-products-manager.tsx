"use client";

import { FormEvent, useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil, Plus, Save, Trash2, X } from "lucide-react";
import type { InventoryItem } from "@/types/inventory";
import { createInventoryItem, deleteInventoryItem, listInventoryItems, updateInventoryItem } from "@/lib/inventory-api";
import { confirmDelete, useConfirm } from "@/components/ui/confirm-dialog";

export function FinishedProductsManager({ mode, onClose }: { mode: "create" | "view"; onClose: () => void }) {
  const queryClient = useQueryClient();
  const { data: items = [], isLoading } = useQuery({
    queryKey: ["finished-products"],
    queryFn: () => listInventoryItems("FINISHED_PRODUCT"),
  });

  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [metal, setMetal] = useState("");
  const [purity, setPurity] = useState("");
  const [totalWeight, setTotalWeight] = useState("");
  const [elaborationDate, setElaborationDate] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const { confirm, dialog } = useConfirm();

  useEffect(() => {
    if (!success) return;
    const timer = setTimeout(() => setSuccess(null), 3000);
    return () => clearTimeout(timer);
  }, [success]);

  function resetForm() {
    setEditingId(null);
    setName("");
    setDescription("");
    setMetal("");
    setPurity("");
    setTotalWeight("");
    setElaborationDate("");
  }

  function startEdit(item: InventoryItem) {
    setEditingId(item.id);
    setName(item.name);
    setDescription(item.description ?? "");
    setMetal(item.material_type ?? "");
    setPurity(item.purity ?? "");
    setTotalWeight(item.total_weight ?? "");
    setElaborationDate(item.elaboration_date ?? "");
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
      setError("Escribe el nombre del producto.");
      return;
    }
    const payload = {
      item_type: "FINISHED_PRODUCT" as const,
      name: name.trim(),
      description: description.trim() || null,
      material_type: metal.trim() || null,
      purity: purity.trim() || null,
      total_weight: totalWeight.trim() ? totalWeight.trim() : null,
      elaboration_date: elaborationDate || null,
      unit_code: "und",
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
            <p className="panelText">Catálogo de productos terminados de la joyería.</p>
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
              <span>Producto</span>
              <input className="field" disabled={isSaving} maxLength={180} onChange={(e) => setName(e.target.value)} placeholder="Ej. Anillo modelo A" value={name} />
            </label>
            <label className="fieldGroup">
              <span>Metal principal</span>
              <input className="field" disabled={isSaving} maxLength={80} onChange={(e) => setMetal(e.target.value)} placeholder="Ej. Oro, Plata" value={metal} />
            </label>
          </div>
          <div className="materialRow">
            <label className="fieldGroup">
              <span>Ley / pureza</span>
              <input className="field" disabled={isSaving} maxLength={40} onChange={(e) => setPurity(e.target.value)} placeholder="Ej. 18K, 925" value={purity} />
            </label>
            <label className="fieldGroup">
              <span>Peso total (g)</span>
              <input className="field" disabled={isSaving} inputMode="decimal" onChange={(e) => setTotalWeight(e.target.value.replace(/[^0-9.]/g, ""))} placeholder="Ej. 12.5" value={totalWeight} />
            </label>
          </div>
          <div className="materialRow">
            <label className="fieldGroup">
              <span>Fecha de elaboración</span>
              <input className="field" disabled={isSaving} onChange={(e) => setElaborationDate(e.target.value)} type="date" value={elaborationDate} />
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
                <th>Producto</th>
                <th>Metal principal</th>
                <th>Ley/pureza</th>
                <th>Peso total</th>
                <th>Elaboración</th>
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
                  <td>{item.total_weight ?? "—"}</td>
                  <td>{item.elaboration_date ?? "—"}</td>
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
