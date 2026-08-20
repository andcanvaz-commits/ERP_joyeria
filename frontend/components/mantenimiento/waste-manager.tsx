"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Pencil, Plus, Save, Trash2, X } from "lucide-react";
import type { InventoryItem } from "@/types/inventory";
import { createInventoryItem, deleteInventoryItem, listInventoryItems, updateInventoryItem } from "@/lib/inventory-api";
import { listUnits } from "@/lib/units-api";
import { confirmDelete, useConfirm } from "@/components/ui/confirm-dialog";
import { ToastNotice } from "@/components/ui/toast-notice";
import { Pager, usePagination } from "@/components/shared/pager";

// Mantenimiento de mermas (Rodrigo, 2026-08-20): produccion ya las crea
// solas al finalizar una etapa con merma real (InventoryService.
// get_or_create_waste_item, nombradas "Merma {proceso}"), pero tambien
// deben poder crearse/editarse a mano aca, igual que materia prima/insumo/
// complemento. Material y ley se guardan porque la merma de oro y plata no
// son lo mismo (mismo criterio del resto del sistema).
export function WasteManager({
  mode,
  onClose,
  onCreated,
  tabs,
}: {
  mode: "create" | "view";
  onClose: () => void;
  onCreated?: (item: InventoryItem) => void;
  tabs?: React.ReactNode;
}) {
  const queryClient = useQueryClient();
  const { data: items = [], isLoading } = useQuery({
    queryKey: ["waste-items"],
    queryFn: () => listInventoryItems("WASTE"),
  });
  const itemsPager = usePagination(items, 6);
  const { data: units = [] } = useQuery({ queryKey: ["units"], queryFn: listUnits });

  const [editingId, setEditingId] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [materialType, setMaterialType] = useState("");
  const [purity, setPurity] = useState("");
  const [description, setDescription] = useState("");
  const [unitCode, setUnitCode] = useState("");
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
    setMaterialType("");
    setPurity("");
    setDescription("");
    setUnitCode("");
  }

  function startEdit(item: InventoryItem) {
    setEditingId(item.id);
    setName(item.name);
    setMaterialType(item.material_type ?? "");
    setPurity(item.purity ?? "");
    setDescription(item.description ?? "");
    setUnitCode(item.unit_code);
    setError(null);
  }

  function invalidate() {
    void queryClient.invalidateQueries({ queryKey: ["waste-items"] });
    void queryClient.invalidateQueries({ queryKey: ["inventory"] });
  }

  async function handleDelete(item: InventoryItem) {
    const ok = await confirmDelete(confirm, item.name);
    if (!ok) return;
    setError(null);
    try {
      await deleteInventoryItem(item.id);
      setSuccess("Merma eliminada.");
      invalidate();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo eliminar la merma.");
    }
  }

  const unitOptions = useMemo(
    () => units.map((unit) => ({ value: unit.code, label: `${unit.label} (${unit.code})` })),
    [units],
  );

  async function handleAdd(event: FormEvent) {
    event.preventDefault();
    setError(null);
    if (!name.trim()) {
      setError("Escribe el nombre de la merma.");
      return;
    }
    const unit = unitCode || unitOptions[0]?.value || "g";
    const payload = {
      item_type: "WASTE" as const,
      name: name.trim(),
      material_type: materialType.trim() || null,
      description: description.trim() || null,
      purity: purity.trim() || null,
      unit_code: unit,
    };
    setIsSaving(true);
    try {
      if (editingId) {
        await updateInventoryItem(editingId, payload);
        setSuccess("Merma actualizada.");
      } else {
        const created = await createInventoryItem(payload);
        setSuccess("Merma creada.");
        onCreated?.(created);
      }
      resetForm();
      invalidate();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo guardar la merma.");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="modalBackdrop" role="dialog" aria-modal="true" aria-label="Mermas">
      <section className="modalWindow">
        <div className="modalHeader">
          <div>
            <h2>{mode === "create" ? "Crear merma" : "Mermas"}</h2>
            <p className="panelText">Merma real acumulada por material (nombre, ley y unidad).</p>
          </div>
          <button aria-label="Cerrar" className="iconOnlyButton" onClick={onClose} type="button">
            <X aria-hidden="true" size={18} />
          </button>
        </div>

        {tabs}

        {error || success ? (
          <div className="toastStack" aria-live="polite">
            {error ? <ToastNotice key={error} kind="error" message={error} onClose={() => setError(null)} compact /> : null}
            {success ? <ToastNotice key={success} kind="success" message={success} onClose={() => setSuccess(null)} compact /> : null}
          </div>
        ) : null}

        {mode === "create" || editingId ? (
        <form onSubmit={handleAdd} style={{ display: "grid", gap: 12 }}>
          <div className="materialRow">
            <label className="fieldGroup">
              <span>Nombre</span>
              <input className="field" disabled={isSaving} maxLength={180} onChange={(e) => setName(e.target.value)} placeholder="Ej. Merma Fundición" value={name} />
            </label>
            <label className="fieldGroup">
              <span>Material</span>
              <input className="field" disabled={isSaving} maxLength={80} onChange={(e) => setMaterialType(e.target.value)} placeholder="Ej. Oro, Plata" value={materialType} />
            </label>
          </div>
          <div className="materialRow">
            <label className="fieldGroup">
              <span>Ley / pureza</span>
              <input className="field" disabled={isSaving} maxLength={40} onChange={(e) => setPurity(e.target.value)} placeholder="Ej. 18K, 925" value={purity} />
            </label>
            <label className="fieldGroup">
              <span>Unidad</span>
              <select className="field" disabled={isSaving} onChange={(e) => setUnitCode(e.target.value)} value={unitCode || unitOptions[0]?.value || ""}>
                {unitOptions.map((unit) => (
                  <option key={unit.value} value={unit.value}>{unit.label}</option>
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
              {editingId ? " Guardar cambios" : " Crear merma"}
            </button>
          </div>
        </form>
        ) : null}

        {mode === "view" ? (
        <div className="tableWrap pagedListFloor" style={{ marginTop: 14, minHeight: itemsPager.total > itemsPager.pageSize ? 320 : undefined }}>
          <table className="table">
            <thead>
              <tr>
                <th style={{ width: 40 }}>#</th>
                <th>Nombre</th>
                <th>Material</th>
                <th>Ley/pureza</th>
                <th className="num">Stock</th>
                <th>Unidad</th>
                <th aria-label="Acciones" />
              </tr>
            </thead>
            <tbody>
              {itemsPager.pageItems.map((item, index) => (
                <tr key={item.id}>
                  <td className="num">{itemsPager.page * itemsPager.pageSize + index + 1}</td>
                  <td>{item.name}</td>
                  <td>{item.material_type ?? "—"}</td>
                  <td>{item.purity ?? "—"}</td>
                  <td className="num">{item.current_stock}</td>
                  <td>{item.unit_code}</td>
                  <td style={{ textAlign: "right" }}>
                    <span className="rowActions" style={{ justifyContent: "flex-end" }}>
                      <button
                        aria-label={`Editar ${item.name}`}
                        className="iconOnlyButton"
                        onClick={() => startEdit(item)}
                        type="button"
                      >
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
                  <td colSpan={7}><div className="emptyState">Sin mermas. Se crean solas al finalizar una etapa con merma, o crea una a mano.</div></td>
                </tr>
              ) : null}
            </tbody>
          </table>
          <Pager {...itemsPager} />
        </div>
        ) : null}
      </section>
      {dialog}
    </div>
  );
}
