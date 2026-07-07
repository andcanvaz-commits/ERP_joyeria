"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Plus, Trash2, X } from "lucide-react";
import { createCatalogSegment, listCatalogSegments } from "@/lib/catalog-api";
import { listInventoryItems } from "@/lib/inventory-api";
import { createProductType, deleteProductType, listProductTypes } from "@/lib/product-types-api";
import { confirmDelete, useConfirm } from "@/components/ui/confirm-dialog";

const NEW = "__new__";

export function ProductTypesManager({ mode, onClose }: { mode: "create" | "view"; onClose: () => void }) {
  const queryClient = useQueryClient();
  const { data: segments = [] } = useQuery({ queryKey: ["catalog-segments"], queryFn: listCatalogSegments });
  const { data: rawMaterials = [] } = useQuery({
    queryKey: ["raw-materials"],
    queryFn: () => listInventoryItems("RAW_MATERIAL"),
  });
  const { data: types = [], isLoading } = useQuery({ queryKey: ["product-types"], queryFn: listProductTypes });
  const { data: finishedItems = [] } = useQuery({
    queryKey: ["finished-products"],
    queryFn: () => listInventoryItems("FINISHED_PRODUCT"),
    enabled: mode === "view",
  });

  const categories = segments.filter((s) => s.kind === "CATEGORY");
  const [categoryCode, setCategoryCode] = useState("");
  const [newCategoryLabel, setNewCategoryLabel] = useState("");
  const [modelCode, setModelCode] = useState("");
  const [newModelLabel, setNewModelLabel] = useState("");
  const [materialItemId, setMaterialItemId] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const { confirm, dialog } = useConfirm();

  const models = segments.filter((s) => s.kind === "MODEL" && s.parent_code === categoryCode);
  const selectedMaterial = rawMaterials.find((item) => item.id === materialItemId) ?? null;
  // Vista previa del digito de material; el backend calcula el definitivo desde el catalogo.
  const materialText = selectedMaterial?.material_type?.toUpperCase() ?? "";
  const materialDigit = materialText.includes("ORO") ? "1" : materialText.includes("PLATA") ? "2" : "?";
  const codePreview = `${materialDigit}${categoryCode && categoryCode !== NEW ? categoryCode : "??"}${modelCode && modelCode !== NEW ? modelCode : "????"}`;

  // Pares tipo->categoria ya presentes en inventario (derivados del product_code de las piezas).
  const inventoryPairs = useMemo(() => {
    const seen = new Map<string, number>();
    for (const item of finishedItems) {
      if (item.product_code && item.product_code.length === 7) {
        seen.set(item.product_code, (seen.get(item.product_code) ?? 0) + 1);
      }
    }
    const definedCodes = new Set(types.map((t) => t.product_code));
    const labelOf = (kind: string, code: string, parent?: string) =>
      segments.find((s) => s.kind === kind && s.code === code && (kind === "MODEL" ? s.parent_code === parent : true))?.label ?? code;
    return [...seen.entries()]
      .filter(([code]) => !definedCodes.has(code))
      .map(([code, count]) => ({
        code,
        categoryCode: code.slice(1, 3),
        modelCode: code.slice(3),
        categoryLabel: labelOf("CATEGORY", code.slice(1, 3)),
        modelLabel: labelOf("MODEL", code.slice(3), code.slice(1, 3)),
        pieces: count,
      }))
      .sort((a, b) => a.code.localeCompare(b.code));
  }, [finishedItems, types, segments]);

  useEffect(() => {
    if (!success) return;
    const timer = setTimeout(() => setSuccess(null), 3000);
    return () => clearTimeout(timer);
  }, [success]);

  async function handleAdd(event: FormEvent) {
    event.preventDefault();
    setError(null);
    if (!categoryCode || (categoryCode === NEW && !newCategoryLabel.trim())) {
      setError("Selecciona o escribe el tipo.");
      return;
    }
    if (!modelCode || (modelCode === NEW && !newModelLabel.trim())) {
      setError("Selecciona o escribe la categoría.");
      return;
    }
    if (!selectedMaterial) {
      setError("Selecciona la materia prima.");
      return;
    }
    setIsSaving(true);
    try {
      let cat = categoryCode;
      if (cat === NEW) {
        const created = await createCatalogSegment({ kind: "CATEGORY", label: newCategoryLabel.trim().toUpperCase() });
        cat = created.code;
      }
      let model = modelCode;
      if (model === NEW) {
        const created = await createCatalogSegment({ kind: "MODEL", label: newModelLabel.trim().toUpperCase(), parent_code: cat });
        model = created.code;
      }
      await createProductType({ category_code: cat, model_code: model, raw_material_item_id: selectedMaterial.id });
      setCategoryCode("");
      setNewCategoryLabel("");
      setModelCode("");
      setNewModelLabel("");
      setMaterialItemId("");
      setSuccess("Tipo de producto creado.");
      await queryClient.invalidateQueries({ queryKey: ["product-types"] });
      await queryClient.invalidateQueries({ queryKey: ["catalog-segments"] });
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo crear el tipo.");
    } finally {
      setIsSaving(false);
    }
  }

  async function handleDelete(id: string, label: string) {
    const ok = await confirmDelete(confirm, label);
    if (!ok) return;
    setError(null);
    try {
      await deleteProductType(id);
      setSuccess("Tipo eliminado.");
      await queryClient.invalidateQueries({ queryKey: ["product-types"] });
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo eliminar el tipo.");
    }
  }

  return (
    <div className="modalBackdrop" role="dialog" aria-modal="true" aria-label="Tipos de producto terminado">
      <section className="modalWindow">
        <div className="modalHeader">
          <div>
            <h2>{mode === "create" ? "Crear tipo de producto" : "Tipos de producto"}</h2>
            <p className="panelText">Tipo y categoría del catálogo; la materia prima fija el metal del código.</p>
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
        <form onSubmit={handleAdd} style={{ display: "grid", gap: 12 }}>
          <div className="materialRow">
            <label className="fieldGroup">
              <span>Tipo</span>
              <select
                className="field"
                disabled={isSaving}
                onChange={(e) => {
                  setCategoryCode(e.target.value);
                  setModelCode("");
                }}
                value={categoryCode}
              >
                <option value="">Seleccionar tipo</option>
                {categories.map((c) => (
                  <option key={c.id} value={c.code}>#{c.code} {c.label}</option>
                ))}
                <option value={NEW}>+ Crear nuevo tipo...</option>
              </select>
            </label>
            {categoryCode === NEW ? (
              <label className="fieldGroup">
                <span>Nombre del nuevo tipo</span>
                <input className="field" disabled={isSaving} maxLength={120} onChange={(e) => setNewCategoryLabel(e.target.value)} placeholder="Ej. TOBILLERAS" value={newCategoryLabel} />
              </label>
            ) : null}
          </div>
          <div className="materialRow">
            <label className="fieldGroup">
              <span>Categoría</span>
              <select
                className="field"
                disabled={isSaving || !categoryCode || (categoryCode === NEW && !newCategoryLabel.trim())}
                onChange={(e) => setModelCode(e.target.value)}
                value={modelCode}
              >
                <option value="">{categoryCode ? "Seleccionar categoría" : "Elige primero el tipo"}</option>
                {categoryCode !== NEW
                  ? models.map((m) => (
                      <option key={m.id} value={m.code}>#{m.code} {m.label}</option>
                    ))
                  : null}
                <option value={NEW}>+ Crear nueva categoría...</option>
              </select>
            </label>
            {modelCode === NEW ? (
              <label className="fieldGroup">
                <span>Nombre de la nueva categoría</span>
                <input className="field" disabled={isSaving} maxLength={120} onChange={(e) => setNewModelLabel(e.target.value)} placeholder="Ej. FILIGRANA" value={newModelLabel} />
              </label>
            ) : null}
          </div>
          <div className="materialRow">
            <label className="fieldGroup">
              <span>Materia prima</span>
              <select className="field" disabled={isSaving} onChange={(e) => setMaterialItemId(e.target.value)} value={materialItemId}>
                <option value="">Seleccionar materia prima</option>
                {rawMaterials.map((item) => (
                  <option key={item.id} value={item.id}>{item.name}</option>
                ))}
              </select>
            </label>
            <label className="fieldGroup">
              <span>Ley / pureza</span>
              <input className="field" disabled readOnly value={selectedMaterial?.purity ?? "—"} />
            </label>
          </div>
          <p className="panelText">Código resultante: <span className="orderCodeTag">#{codePreview}</span></p>
          <div className="modalActions">
            <button className="button buttonPrimary" disabled={isSaving} type="submit">
              <Plus aria-hidden="true" size={14} /> Crear tipo
            </button>
          </div>
        </form>
        ) : null}

        {mode === "view" ? (
        <div className="tableWrap" style={{ marginTop: 14, maxHeight: 320, overflowY: "auto" }}>
          <table className="table">
            <thead>
              <tr>
                <th>#</th>
                <th>Tipo</th>
                <th>Categoría</th>
                <th>Materia prima</th>
                <th>Origen</th>
                <th aria-label="Acciones" />
              </tr>
            </thead>
            <tbody>
              {types.map((t) => (
                <tr key={t.id}>
                  <td><span className="orderCodeTag">#{t.product_code}</span></td>
                  <td>#{t.category_code} {t.category_label}</td>
                  <td>#{t.model_code} {t.model_label}</td>
                  <td>{t.raw_material_name}{t.purity ? ` (${t.purity})` : ""}</td>
                  <td>Definido</td>
                  <td style={{ textAlign: "right" }}>
                    <button
                      aria-label={`Eliminar ${t.product_code}`}
                      className="iconOnlyButton dangerIconButton"
                      onClick={() => void handleDelete(t.id, `${t.category_label} / ${t.model_label}`)}
                      type="button"
                    >
                      <Trash2 aria-hidden="true" size={14} />
                    </button>
                  </td>
                </tr>
              ))}
              {inventoryPairs.map((p) => (
                <tr key={p.code}>
                  <td><span className="orderCodeTag">#{p.code}</span></td>
                  <td>#{p.categoryCode} {p.categoryLabel}</td>
                  <td>#{p.modelCode} {p.modelLabel}</td>
                  <td>—</td>
                  <td>En inventario ({p.pieces} {p.pieces === 1 ? "pieza" : "piezas"})</td>
                  <td />
                </tr>
              ))}
              {!isLoading && types.length === 0 && inventoryPairs.length === 0 ? (
                <tr><td colSpan={6}><div className="emptyState">Sin tipos de producto. Crea el primero.</div></td></tr>
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
