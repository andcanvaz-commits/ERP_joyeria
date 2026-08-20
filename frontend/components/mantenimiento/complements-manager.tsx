"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, Plus, Trash2, X } from "lucide-react";
import type { InventoryItem } from "@/types/inventory";
import { createComplementType, createInventoryItem, deleteInventoryItem, listComplementTypes, listInventoryItems } from "@/lib/inventory-api";
import { listUnits } from "@/lib/units-api";
import { confirmDelete, useConfirm } from "@/components/ui/confirm-dialog";
import { ToastNotice } from "@/components/ui/toast-notice";
import { Pager, usePagination } from "@/components/shared/pager";

const DRILL_PAGE_SIZE = 10;
// Clave sintetica para el grupo de complementos sin tipo asignado (o con un
// tipo que ya no existe/esta inactivo); nunca choca con un id real (uuid).
const NONE_TYPE_KEY = "__sin_tipo__";

function stockText(value: string) {
  const number = Number(value);
  return Number.isFinite(number) ? number.toLocaleString("es-EC", { maximumFractionDigits: 4 }) : value;
}

export function ComplementsManager({
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
  const { data: complementTypes = [] } = useQuery({ queryKey: ["complement-types"], queryFn: listComplementTypes });
  const { data: items = [], isLoading } = useQuery({
    queryKey: ["complements"],
    queryFn: () => listInventoryItems("COMPLEMENT"),
    enabled: mode === "view",
  });
  const { data: units = [] } = useQuery({ queryKey: ["units"], queryFn: listUnits });
  const activeComplementTypes = useMemo(() => complementTypes.filter((type) => type.is_active), [complementTypes]);

  // Opcion 1: nuevo tipo. Opcion 2: complemento (nombre + unidad) dentro de un tipo.
  const [newTypeName, setNewTypeName] = useState("");
  const [complTypeId, setComplTypeId] = useState("");
  const [complName, setComplName] = useState("");
  const [unitCode, setUnitCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const { confirm, dialog } = useConfirm();

  const unitOptions = useMemo(
    () => units.map((unit) => ({ value: unit.code, label: `${unit.label} (${unit.code})` })),
    [units],
  );

  // Drill-down de la vista: tipos → complementos. El grupo "SIN TIPO" siempre
  // va al final, incluso vacio, para que el destino de piezas huerfanas sea visible.
  const [drillTypeId, setDrillTypeId] = useState<string | null>(null);
  const typeGroups = useMemo(() => {
    const byType = new Map<string, { id: string; label: string; items: InventoryItem[] }>();
    for (const type of complementTypes) {
      if (type.is_active) byType.set(type.id, { id: type.id, label: type.name, items: [] });
    }
    const orphanItems: InventoryItem[] = [];
    for (const item of items) {
      const bucket = item.complement_type_id ? byType.get(item.complement_type_id) : undefined;
      if (bucket) bucket.items.push(item);
      else orphanItems.push(item);
    }
    const groups = [...byType.values()]
      .sort((a, b) => a.label.localeCompare(b.label))
      .map((g) => ({
        id: g.id,
        label: g.label,
        items: [...g.items].sort((a, b) => a.name.localeCompare(b.name)),
        count: g.items.length,
      }));
    groups.push({
      id: NONE_TYPE_KEY,
      label: "SIN TIPO",
      items: [...orphanItems].sort((a, b) => a.name.localeCompare(b.name)),
      count: orphanItems.length,
    });
    return groups;
  }, [complementTypes, items]);

  const drilledType = typeGroups.find((g) => g.id === drillTypeId) ?? null;

  // Paginación por nivel del drill-down; cada nivel vuelve a la página 1 al entrar.
  const typesPager = usePagination(typeGroups, DRILL_PAGE_SIZE);
  const itemsPager = usePagination(drilledType?.items ?? [], DRILL_PAGE_SIZE, drillTypeId ?? "");

  useEffect(() => {
    if (!success) return;
    const timer = setTimeout(() => setSuccess(null), 3000);
    return () => clearTimeout(timer);
  }, [success]);

  // Sin awaitear: invalidateQueries espera el refetch de las queries activas
  // (["production"] dispara ~7 requests en paralelo) — awaitearlo dejaba
  // isSaving atascado en true hasta que todo eso terminara, bloqueando el
  // boton de crear el siguiente complemento sin necesidad.
  function invalidate() {
    void queryClient.invalidateQueries({ queryKey: ["complements"] });
    void queryClient.invalidateQueries({ queryKey: ["inventory"] });
    void queryClient.invalidateQueries({ queryKey: ["complement-types"] });
    // Los selectores de materiales de proceso mezclan materia prima + insumos + complementos.
    void queryClient.invalidateQueries({ queryKey: ["production"] });
  }

  async function handleCreateType(event: FormEvent) {
    event.preventDefault();
    setError(null);
    if (!newTypeName.trim()) {
      setError("Escribe el nombre del nuevo tipo.");
      return;
    }
    setIsSaving(true);
    try {
      const created = await createComplementType(newTypeName.trim().toUpperCase());
      setNewTypeName("");
      setComplTypeId(created.id);
      setSuccess(`Tipo ${created.name} creado.`);
      void queryClient.invalidateQueries({ queryKey: ["complement-types"] });
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo crear el tipo.");
    } finally {
      setIsSaving(false);
    }
  }

  async function handleCreateComplement(event: FormEvent) {
    event.preventDefault();
    setError(null);
    if (!complTypeId) {
      setError("Selecciona el tipo.");
      return;
    }
    if (!complName.trim()) {
      setError("Escribe el nombre del complemento.");
      return;
    }
    const unit = unitCode || unitOptions[0]?.value || "und";
    setIsSaving(true);
    try {
      const created = await createInventoryItem({
        item_type: "COMPLEMENT",
        name: complName.trim().toUpperCase(),
        unit_code: unit,
        complement_type_id: complTypeId,
        description: null,
        material_type: null,
        purity: null,
      });
      setComplName("");
      setSuccess(`Complemento ${created.name} creado.`);
      invalidate();
      onCreated?.(created);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo crear el complemento.");
    } finally {
      setIsSaving(false);
    }
  }

  async function handleDelete(item: InventoryItem) {
    const ok = await confirmDelete(confirm, item.name);
    if (!ok) return;
    setError(null);
    try {
      await deleteInventoryItem(item.id);
      setSuccess("Complemento eliminado.");
      invalidate();
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo eliminar el complemento.");
    }
  }

  return (
    <div className="modalBackdrop" role="dialog" aria-modal="true" aria-label="Complementos">
      <section className="modalWindow">
        <div className="modalHeader">
          <div>
            <h2>{mode === "create" ? "Crear complemento" : "Complementos"}</h2>
            <p className="panelText">Broches, cadenas base y piezas para ensamblar, agrupadas por tipo.</p>
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

        {mode === "create" ? (
        <div style={{ display: "grid", gap: 12 }}>
          <form onSubmit={handleCreateType} className="formStep">
            <p className="formStepTitle"><strong>1. Crear un tipo nuevo</strong> (ej. COMPLEMENTOS DE CADENAS)</p>
            <div className="formStepGrid colsInputAction">
              <label className="fieldGroup">
                <span>Nombre del nuevo tipo</span>
                <input className="field" disabled={isSaving} maxLength={120} onChange={(e) => setNewTypeName(e.target.value)} placeholder="Ej. COMPLEMENTOS DE CADENAS" value={newTypeName} />
              </label>
              <button className="button buttonPrimary" disabled={isSaving || !newTypeName.trim()} type="submit">
                <Plus aria-hidden="true" size={14} /> Crear tipo
              </button>
            </div>
          </form>

          <div aria-hidden="true" className="formStepDivider">o</div>

          <form onSubmit={handleCreateComplement} className="formStep">
            <p className="formStepTitle"><strong>2. Crear un complemento</strong> dentro de un tipo</p>
            <div className="formStepGrid colsPairAction">
              <label className="fieldGroup">
                <span>Tipo</span>
                <select
                  className="field"
                  disabled={isSaving}
                  onChange={(e) => setComplTypeId(e.target.value)}
                  value={complTypeId}
                >
                  <option value="">Seleccionar tipo</option>
                  {activeComplementTypes.map((type) => (
                    <option key={type.id} value={type.id}>{type.name}</option>
                  ))}
                </select>
              </label>
              <label className="fieldGroup">
                <span>Nombre</span>
                <input className="field" disabled={isSaving} maxLength={180} onChange={(e) => setComplName(e.target.value)} placeholder="Ej. Broche de resorte" value={complName} />
              </label>
            </div>
            <div className="formStepGrid colsPairAction">
              <label className="fieldGroup">
                <span>Unidad</span>
                <select className="field" disabled={isSaving} onChange={(e) => setUnitCode(e.target.value)} value={unitCode || unitOptions[0]?.value || ""}>
                  {unitOptions.map((unit) => (
                    <option key={unit.value} value={unit.value}>{unit.label}</option>
                  ))}
                </select>
              </label>
              <button className="button buttonPrimary" disabled={isSaving || !complTypeId || !complName.trim()} type="submit">
                <Plus aria-hidden="true" size={14} /> Crear complemento
              </button>
            </div>
          </form>
        </div>
        ) : null}

        {mode === "view" ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 14, minHeight: typeGroups.length >= DRILL_PAGE_SIZE ? 460 : undefined }}>
          {drilledType ? (
            <div className="drillBar">
              <button className="button" onClick={() => setDrillTypeId(null)} type="button">
                <ChevronLeft aria-hidden="true" size={15} /> Volver
              </button>
              <span className="drillCrumbs">
                <button onClick={() => setDrillTypeId(null)} type="button">Tipos</button>
                <span className="drillCrumbSep">/</span>
                <span>{drilledType.label}</span>
              </span>
            </div>
          ) : null}

          {drilledType ? (
            <div className="tableWrap pagedListFloor" style={{ flex: "1 1 auto" }}>
              <table className="table tableAuto">
                <thead>
                  <tr>
                    <th style={{ width: 110 }}>SKU</th>
                    <th>Nombre</th>
                    <th>Unidad</th>
                    <th className="num">Stock</th>
                    <th aria-label="Acciones" />
                  </tr>
                </thead>
                <tbody>
                  {itemsPager.pageItems.map((item) => (
                    <tr key={item.id}>
                      <td><span className="orderCodeTag">{item.sku}</span></td>
                      <td>{item.name}</td>
                      <td>{item.unit_code}</td>
                      <td className="num">{stockText(item.current_stock)}</td>
                      <td style={{ textAlign: "right" }}>
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
                      </td>
                    </tr>
                  ))}
                  {!isLoading && drilledType.count === 0 ? (
                    <tr><td colSpan={5}><div className="emptyState">Sin complementos en este tipo.</div></td></tr>
                  ) : null}
                </tbody>
              </table>
              <Pager {...itemsPager} />
            </div>
          ) : (
            <div className="tableWrap pagedListFloor" style={{ flex: "1 1 auto" }}>
              <table className="table tableAuto">
                <thead>
                  <tr>
                    <th>Tipo</th>
                    <th className="num">Complementos</th>
                    <th aria-label="Abrir" />
                  </tr>
                </thead>
                <tbody>
                  {typesPager.pageItems.map((group) => (
                    <tr key={group.id} onClick={() => setDrillTypeId(group.id)} style={{ cursor: "pointer" }}>
                      <td><strong>{group.label}</strong></td>
                      <td className="num">{group.count}</td>
                      <td style={{ textAlign: "right" }}><ChevronRight aria-hidden="true" size={15} /></td>
                    </tr>
                  ))}
                  {!isLoading && typeGroups.length === 0 ? (
                    <tr><td colSpan={3}><div className="emptyState">Sin complementos. Crea el primero.</div></td></tr>
                  ) : null}
                </tbody>
              </table>
              <Pager {...typesPager} />
            </div>
          )}
        </div>
        ) : null}
      </section>
      {dialog}
    </div>
  );
}
