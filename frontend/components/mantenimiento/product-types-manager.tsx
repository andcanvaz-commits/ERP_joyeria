"use client";

import { FormEvent, Fragment, useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, Plus, Trash2, X } from "lucide-react";
import { createCatalogSegment, listCatalogSegments, metalTagClass } from "@/lib/catalog-api";
import { listInventoryItems } from "@/lib/inventory-api";
import { createProductType, deleteProductType, listProductTypes, type ProductType } from "@/lib/product-types-api";
import { confirmDelete, useConfirm } from "@/components/ui/confirm-dialog";
import { ToastNotice } from "@/components/ui/toast-notice";
import { Pager, usePagination } from "@/components/shared/pager";

const DRILL_PAGE_SIZE = 10;

export function ProductTypesManager({
  mode,
  onClose,
  onProductCreated,
}: {
  mode: "create" | "view";
  onClose: () => void;
  // Avisa al padre cuando se crea un producto (opción 3) para poder
  // auto-seleccionarlo, ej. como destino de un ensamble.
  onProductCreated?: (created: ProductType) => void;
}) {
  const queryClient = useQueryClient();
  const { data: segments = [] } = useQuery({ queryKey: ["catalog-segments"], queryFn: listCatalogSegments });
  const { data: types = [], isLoading } = useQuery({ queryKey: ["product-types"], queryFn: listProductTypes });
  const { data: finishedItems = [] } = useQuery({
    queryKey: ["finished-products"],
    queryFn: () => listInventoryItems("FINISHED_PRODUCT"),
    enabled: mode === "view",
  });

  const categories = segments.filter((s) => s.kind === "CATEGORY" && s.is_active);
  // Opcion 1: nuevo tipo. Opcion 2: producto (nombre) dentro de un tipo; el
  // código de modelo lo asigna el sistema (jerarquía = tipo → producto).
  const [newTypeLabel, setNewTypeLabel] = useState("");
  const [prodTypeCode, setProdTypeCode] = useState("");
  const [prodName, setProdName] = useState("");
  const [prodPrice, setProdPrice] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const { confirm, dialog } = useConfirm();

  // Productos ya presentes en inventario, agrupados por codigo + nombre (description
  // de la pieza). Se omiten los que ya estan definidos aqui con ese tipo+categoria+nombre.
  const inventoryProducts = useMemo(() => {
    const grouped = new Map<string, { code: string; name: string }>();
    for (const item of finishedItems) {
      if (!item.product_code || item.product_code.length !== 7) continue;
      // Piezas nacidas por conversión/ensamble no traen descripción: su
      // nombre de producto vive en `name` (el del tipo del catálogo).
      const name = (item.description ?? "").trim().toUpperCase() || item.name.trim().toUpperCase() || "SIN NOMBRE";
      grouped.set(`${item.product_code}|${name}`, { code: item.product_code, name });
    }
    const defined = new Set(types.map((t) => `${t.category_code}${t.model_code}|${t.name ?? ""}`));
    return [...grouped.values()]
      .filter((p) => !defined.has(`${p.code.slice(1)}|${p.name}`))
      .map((p) => ({ ...p, categoryCode: p.code.slice(1, 3), modelCode: p.code.slice(3) }))
      .sort((a, b) => a.code.localeCompare(b.code) || a.name.localeCompare(b.name));
  }, [finishedItems, types]);

  // Drill-down de la vista: tipos → productos (el código de modelo vive en el
  // producto; ya no hay nivel intermedio de categorías).
  const [drillType, setDrillType] = useState<string | null>(null);
  const typeGroups = useMemo(() => {
    const catLabel = (code: string) => segments.find((s) => s.kind === "CATEGORY" && s.code === code)?.label ?? code;
    const byType = new Map<string, { defined: typeof types; inventory: { code: string; name: string }[] }>();
    const ensure = (cat: string) => {
      let entry = byType.get(cat);
      if (!entry) {
        entry = { defined: [], inventory: [] };
        byType.set(cat, entry);
      }
      return entry;
    };
    for (const t of types) {
      if (t.is_active) ensure(t.category_code).defined.push(t);
    }
    for (const p of inventoryProducts) ensure(p.categoryCode).inventory.push({ code: p.code, name: p.name });
    return [...byType.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([code, entry]) => ({
        code,
        label: catLabel(code),
        defined: [...entry.defined].sort(
          (x, y) => x.model_code.localeCompare(y.model_code) || (x.name ?? "").localeCompare(y.name ?? ""),
        ),
        inventory: [...entry.inventory].sort((x, y) => x.code.localeCompare(y.code) || x.name.localeCompare(y.name)),
        productCount: entry.defined.length + entry.inventory.length,
      }));
  }, [types, inventoryProducts, segments]);

  const drilledType = typeGroups.find((g) => g.code === drillType) ?? null;

  // Paginación por nivel del drill-down; cada nivel vuelve a la página 1 al entrar.
  const typesPager = usePagination(typeGroups, DRILL_PAGE_SIZE);
  const productRows = useMemo(
    () =>
      drilledType
        ? [
            ...drilledType.defined.map((t) => ({ kind: "defined" as const, defined: t, inventory: null })),
            ...drilledType.inventory.map((p) => ({ kind: "inventory" as const, defined: null, inventory: p })),
          ]
        : [],
    [drilledType],
  );
  const productsPager = usePagination(productRows, DRILL_PAGE_SIZE, drillType ?? "");

  useEffect(() => {
    if (!success) return;
    const timer = setTimeout(() => setSuccess(null), 3000);
    return () => clearTimeout(timer);
  }, [success]);

  async function handleCreateType(event: FormEvent) {
    event.preventDefault();
    setError(null);
    if (!newTypeLabel.trim()) {
      setError("Escribe el nombre del nuevo tipo.");
      return;
    }
    setIsSaving(true);
    try {
      const created = await createCatalogSegment({ kind: "CATEGORY", label: newTypeLabel.trim().toUpperCase() });
      setNewTypeLabel("");
      setProdTypeCode(created.code);
      setSuccess(`Tipo #${created.code} ${created.label} creado.`);
      void queryClient.invalidateQueries({ queryKey: ["catalog-segments"] });
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo crear el tipo.");
    } finally {
      setIsSaving(false);
    }
  }

  async function handleCreateProduct(event: FormEvent) {
    event.preventDefault();
    setError(null);
    if (!prodTypeCode) {
      setError("Selecciona el tipo.");
      return;
    }
    if (!prodName.trim()) {
      setError("Escribe el nombre del producto.");
      return;
    }
    setIsSaving(true);
    try {
      // Sin código de modelo: el backend asigna el siguiente libre del tipo.
      const created = await createProductType({
        category_code: prodTypeCode,
        name: prodName.trim().toUpperCase(),
        price: prodPrice.trim() || null,
      });
      setProdName("");
      setProdPrice("");
      setSuccess(`Producto ${created.name ?? ""} creado.`);
      void queryClient.invalidateQueries({ queryKey: ["product-types"] });
      onProductCreated?.(created);
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo crear el producto.");
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
      setSuccess("Producto eliminado.");
      void queryClient.invalidateQueries({ queryKey: ["product-types"] });
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo eliminar el producto.");
    }
  }

  return (
    <div className="modalBackdrop" role="dialog" aria-modal="true" aria-label="Tipos de producto terminado">
      <section className="modalWindow">
        <div className="modalHeader">
          <div>
            <h2>{mode === "create" ? "Crear tipo de producto" : "Tipos de producto"}</h2>
            <p className="panelText">Tipo y producto del catálogo; el código y el material los pone el sistema.</p>
          </div>
          <button aria-label="Cerrar" className="iconOnlyButton" onClick={onClose} type="button">
            <X aria-hidden="true" size={18} />
          </button>
        </div>

        {error || success ? (
          <div className="toastStack" aria-live="polite">
            {error ? <ToastNotice key={error} kind="error" message={error} onClose={() => setError(null)} compact /> : null}
            {success ? <ToastNotice key={success} kind="success" message={success} onClose={() => setSuccess(null)} compact /> : null}
          </div>
        ) : null}

        {mode === "create" ? (
        <div style={{ display: "grid", gap: 12 }}>
          <form onSubmit={handleCreateType} className="formStep">
            <p className="formStepTitle"><strong>1. Crear un tipo nuevo</strong> (ej. ANILLOS, TOBILLERAS)</p>
            <div className="formStepGrid colsInputAction">
              <label className="fieldGroup">
                <span>Nombre del nuevo tipo</span>
                <input className="field" disabled={isSaving} maxLength={120} onChange={(e) => setNewTypeLabel(e.target.value)} placeholder="Ej. TOBILLERAS" value={newTypeLabel} />
              </label>
              <button className="button buttonPrimary" disabled={isSaving || !newTypeLabel.trim()} type="submit">
                <Plus aria-hidden="true" size={14} /> Crear tipo
              </button>
            </div>
          </form>

          <div aria-hidden="true" className="formStepDivider">o</div>

          <form onSubmit={handleCreateProduct} className="formStep">
            <p className="formStepTitle"><strong>2. Crear un producto</strong> dentro de un tipo existente (el código lo asigna el sistema)</p>
            <div className="formStepGrid colsPairAction">
              <label className="fieldGroup">
                <span>Tipo</span>
                <select
                  className="field"
                  disabled={isSaving}
                  onChange={(e) => setProdTypeCode(e.target.value)}
                  value={prodTypeCode}
                >
                  <option value="">Seleccionar tipo</option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.code}>{c.label}</option>
                  ))}
                </select>
              </label>
              <label className="fieldGroup">
                <span>Nombre del producto</span>
                <input className="field" disabled={isSaving} maxLength={180} onChange={(e) => setProdName(e.target.value)} placeholder="Ej. ORQUIDEA FILIGRANA" value={prodName} />
              </label>
            </div>
            <div className="formStepGrid colsPairAction">
              <label className="fieldGroup">
                <span>Precio referencial (opcional)</span>
                <input className="field" disabled={isSaving} min="0" onChange={(e) => setProdPrice(e.target.value)} placeholder="Ej. 120.00" step="0.01" type="number" value={prodPrice} />
              </label>
              <button className="button buttonPrimary" disabled={isSaving || !prodTypeCode || !prodName.trim()} type="submit">
                <Plus aria-hidden="true" size={14} /> Crear producto
              </button>
            </div>
          </form>
        </div>
        ) : null}

        {mode === "view" ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 14, minHeight: typeGroups.length >= DRILL_PAGE_SIZE ? 460 : undefined }}>
          {drilledType ? (
            <div className="drillBar">
              <button className="button" onClick={() => setDrillType(null)} type="button">
                <ChevronLeft aria-hidden="true" size={15} /> Volver
              </button>
              <span className="drillCrumbs">
                <button onClick={() => setDrillType(null)} type="button">Tipos</button>
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
                    <th style={{ width: 110 }}>Código</th>
                    <th>Producto</th>
                    <th className="num">Precio</th>
                    <th aria-label="Acciones" />
                  </tr>
                </thead>
                <tbody>
                  {productsPager.pageItems.map((row) => {
                    if (row.kind === "defined" && row.defined) {
                      const t = row.defined;
                      return (
                        <tr key={t.id}>
                          <td><span className="orderCodeTag">#{t.category_code}{t.model_code}</span></td>
                          <td>{t.name ?? "—"}</td>
                          <td className="num">{t.price ? `$ ${Number(t.price).toLocaleString("es-EC", { minimumFractionDigits: 2 })}` : "—"}</td>
                          <td style={{ textAlign: "right" }}>
                            <button
                              aria-label={`Eliminar ${t.name ?? t.model_label}`}
                              className="iconOnlyButton dangerIconButton"
                              onClick={() => void handleDelete(t.id, t.name ?? `${t.category_label} / ${t.model_label}`)}
                              type="button"
                            >
                              <Trash2 aria-hidden="true" size={14} />
                            </button>
                          </td>
                        </tr>
                      );
                    }
                    if (!row.inventory) return null;
                    const p = row.inventory;
                    return (
                      <tr key={`${p.code}-${p.name}`}>
                        <td><span className={`orderCodeTag${metalTagClass(p.code)}`}>#{p.code}</span></td>
                        <td>{p.name}</td>
                        <td className="num">—</td>
                        <td />
                      </tr>
                    );
                  })}
                  {drilledType.productCount === 0 ? (
                    <tr><td colSpan={4}><div className="emptyState">Sin productos en este tipo.</div></td></tr>
                  ) : null}
                </tbody>
              </table>
              <Pager {...productsPager} />
            </div>
          ) : (
            <div className="tableWrap pagedListFloor" style={{ flex: "1 1 auto" }}>
              <table className="table tableAuto">
                <thead>
                  <tr>
                    <th>Tipo</th>
                    <th className="num">Productos</th>
                    <th aria-label="Abrir" />
                  </tr>
                </thead>
                <tbody>
                  {typesPager.pageItems.map((group) => (
                    <tr key={group.code} onClick={() => setDrillType(group.code)} style={{ cursor: "pointer" }}>
                      <td><strong>{group.label}</strong></td>
                      <td className="num">{group.productCount}</td>
                      <td style={{ textAlign: "right" }}><ChevronRight aria-hidden="true" size={15} /></td>
                    </tr>
                  ))}
                  {!isLoading && typeGroups.length === 0 ? (
                    <tr><td colSpan={3}><div className="emptyState">Sin tipos de producto. Crea el primero.</div></td></tr>
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
