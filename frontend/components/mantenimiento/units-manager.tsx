"use client";

import { FormEvent, useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2, X } from "lucide-react";
import { createUnit, deleteUnit, listUnits } from "@/lib/units-api";
import { confirmDelete, useConfirm } from "@/components/ui/confirm-dialog";
import { Pager, usePagination } from "@/components/shared/pager";

export function UnitsManager({ mode, onClose }: { mode: "create" | "view"; onClose: () => void }) {
  const queryClient = useQueryClient();
  const { data: units = [], isLoading } = useQuery({ queryKey: ["units"], queryFn: listUnits });
  const unitsPager = usePagination(units, 8);
  const [label, setLabel] = useState("");
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const { confirm, dialog } = useConfirm();

  useEffect(() => {
    if (!success) return;
    const timer = setTimeout(() => setSuccess(null), 3000);
    return () => clearTimeout(timer);
  }, [success]);

  async function handleAdd(event: FormEvent) {
    event.preventDefault();
    setError(null);
    if (!label.trim() || !code.trim()) {
      setError("Escribe el nombre y la abreviatura de la unidad.");
      return;
    }
    setIsSaving(true);
    try {
      await createUnit({ label: label.trim(), code: code.trim() });
      setLabel("");
      setCode("");
      setSuccess("Unidad creada.");
      await queryClient.invalidateQueries({ queryKey: ["units"] });
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo agregar la unidad.");
    } finally {
      setIsSaving(false);
    }
  }

  async function handleDelete(id: string, name: string) {
    const ok = await confirmDelete(confirm, name);
    if (!ok) return;
    setError(null);
    try {
      await deleteUnit(id);
      setSuccess("Unidad eliminada.");
      await queryClient.invalidateQueries({ queryKey: ["units"] });
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo eliminar la unidad.");
    }
  }

  return (
    <div className="modalBackdrop" role="dialog" aria-modal="true" aria-label="Unidades de medida">
      <section className="modalWindow">
        <div className="modalHeader">
          <div>
            <h2>{mode === "create" ? "Crear unidad de medida" : "Unidades de medida"}</h2>
            <p className="panelText">Alimentan el combo de unidad al crear materias primas en inventario.</p>
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

        {mode === "create" ? (
        <form onSubmit={handleAdd} style={{ display: "flex", gap: 10, alignItems: "flex-end" }}>
          <label className="fieldGroup" style={{ flex: 1, minWidth: 0 }}>
            <span>Nombre</span>
            <input
              className="field"
              disabled={isSaving}
              maxLength={120}
              onChange={(event) => setLabel(event.target.value)}
              placeholder="ej. Gramos"
              value={label}
            />
          </label>
          <label className="fieldGroup" style={{ width: 120 }}>
            <span>Abreviatura</span>
            <input
              className="field"
              disabled={isSaving}
              maxLength={20}
              onChange={(event) => setCode(event.target.value)}
              placeholder="ej. g"
              value={code}
            />
          </label>
          <button className="button buttonPrimary" disabled={isSaving} type="submit" style={{ flexShrink: 0 }}>
            <Plus aria-hidden="true" size={14} /> Agregar
          </button>
        </form>
        ) : null}

        {mode === "view" ? (
        <div className="tableWrap pagedListFloor" style={{ marginTop: 14, minHeight: 400 }}>
          <table className="table">
            <thead>
              <tr>
                <th style={{ width: 40 }}>#</th>
                <th>Nombre</th>
                <th>Abreviatura</th>
                <th aria-label="Acciones" />
              </tr>
            </thead>
            <tbody>
              {unitsPager.pageItems.map((unit, index) => (
                <tr key={unit.id}>
                  <td className="num">{unitsPager.page * unitsPager.pageSize + index + 1}</td>
                  <td>{unit.label}</td>
                  <td>{unit.code}</td>
                  <td style={{ textAlign: "right" }}>
                    <button
                      aria-label={`Eliminar ${unit.code}`}
                      className="iconOnlyButton dangerIconButton"
                      onClick={() => void handleDelete(unit.id, unit.label)}
                      type="button"
                    >
                      <Trash2 aria-hidden="true" size={14} />
                    </button>
                  </td>
                </tr>
              ))}
              {!isLoading && units.length === 0 ? (
                <tr>
                  <td colSpan={4}>
                    <div className="emptyState">Sin unidades. Agrega la primera.</div>
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
          <Pager {...unitsPager} />
        </div>
        ) : null}
      </section>
      {dialog}
    </div>
  );
}
