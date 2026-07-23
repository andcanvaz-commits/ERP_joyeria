"use client";

import { FormEvent, useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2, X } from "lucide-react";
import { createComplementType, deleteComplementType, listComplementTypes } from "@/lib/inventory-api";
import { confirmDelete, useConfirm } from "@/components/ui/confirm-dialog";
import { Pager, usePagination } from "@/components/shared/pager";

export function ComplementTypesManager({ mode, onClose }: { mode: "create" | "view"; onClose: () => void }) {
  const queryClient = useQueryClient();
  const { data: types = [], isLoading } = useQuery({ queryKey: ["complement-types"], queryFn: listComplementTypes });
  const typesPager = usePagination(types, 8);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const { confirm, dialog } = useConfirm();

  useEffect(() => {
    if (!success) return;
    const timer = setTimeout(() => setSuccess(null), 3000);
    return () => clearTimeout(timer);
  }, [success]);

  async function invalidate() {
    await queryClient.invalidateQueries({ queryKey: ["complement-types"] });
    await queryClient.invalidateQueries({ queryKey: ["inventory"] });
  }

  async function handleAdd(event: FormEvent) {
    event.preventDefault();
    setError(null);
    if (!name.trim()) {
      setError("Escribe el nombre del tipo de complemento.");
      return;
    }
    setIsSaving(true);
    try {
      await createComplementType(name.trim());
      setName("");
      setSuccess("Tipo de complemento creado.");
      await invalidate();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo agregar el tipo de complemento.");
    } finally {
      setIsSaving(false);
    }
  }

  async function handleDelete(id: string, label: string) {
    const ok = await confirmDelete(confirm, label);
    if (!ok) return;
    setError(null);
    try {
      await deleteComplementType(id);
      setSuccess("Tipo de complemento eliminado.");
      await invalidate();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo eliminar el tipo de complemento.");
    }
  }

  return (
    <div className="modalBackdrop" role="dialog" aria-modal="true" aria-label="Tipos de complemento">
      <section className="modalWindow" style={mode === "create" ? { width: "min(520px, 100%)" } : undefined}>
        <div className="modalHeader">
          <div>
            <h2>{mode === "create" ? "Crear tipo de complemento" : "Tipos de complemento"}</h2>
            <p className="panelText">Agrupan los complementos (ej. broche, cierre, cadena base) al crearlos y en el inventario.</p>
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
              onChange={(event) => setName(event.target.value)}
              placeholder="ej. Broche"
              value={name}
            />
          </label>
          <button className="button buttonPrimary" disabled={isSaving} type="submit" style={{ flexShrink: 0 }}>
            <Plus aria-hidden="true" size={14} /> Agregar
          </button>
        </form>
        ) : null}

        {mode === "view" ? (
        <div className="tableWrap pagedListFloor" style={{ marginTop: 14, minHeight: typesPager.total > typesPager.pageSize ? 400 : undefined }}>
          <table className="table">
            <thead>
              <tr>
                <th style={{ width: 40 }}>#</th>
                <th>Nombre</th>
                <th aria-label="Acciones" />
              </tr>
            </thead>
            <tbody>
              {typesPager.pageItems.map((type, index) => (
                <tr key={type.id}>
                  <td className="num">{typesPager.page * typesPager.pageSize + index + 1}</td>
                  <td>{type.name}</td>
                  <td style={{ textAlign: "right" }}>
                    <button
                      aria-label={`Eliminar ${type.name}`}
                      className="iconOnlyButton dangerIconButton"
                      onClick={() => void handleDelete(type.id, type.name)}
                      type="button"
                    >
                      <Trash2 aria-hidden="true" size={14} />
                    </button>
                  </td>
                </tr>
              ))}
              {!isLoading && types.length === 0 ? (
                <tr>
                  <td colSpan={3}>
                    <div className="emptyState">Sin tipos de complemento. Agrega el primero.</div>
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
          <Pager {...typesPager} />
        </div>
        ) : null}
      </section>
      {dialog}
    </div>
  );
}
