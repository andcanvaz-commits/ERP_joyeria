"use client";

import { FormEvent, Fragment, useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, Plus, Trash2, X } from "lucide-react";
import { createCatalogSegment, listCatalogSegments, metalTagClass } from "@/lib/catalog-api";
import { listInventoryItems } from "@/lib/inventory-api";
import { createProductType, deleteProductType, listProductTypes } from "@/lib/product-types-api";
import { confirmDelete, useConfirm } from "@/components/ui/confirm-dialog";
import { Pager, usePagination } from "@/components/shared/pager";

const DRILL_PAGE_SIZE = 10;

export function ProductTypesManager({ mode, onClose }: { mode: "create" | "view"; onClose: () => void }) {
  const queryClient = useQueryClient();
  const { data: segments = [] } = useQuery({ queryKey: ["catalog-segments"], queryFn: listCatalogSegments });
  const { data: types = [], isLoading } = useQuery({ queryKey: ["product-types"], queryFn: listProductTypes });
  const { data: finishedItems = [] } = useQuery({
    queryKey: ["finished-products"],
    queryFn: () => listInventoryItems("FINISHED_PRODUCT"),
    enabled: mode === "view",
  });

  // Solo segmentos activos: los MODEL heredados del Excel que eran nombres de
  // producto quedaron inactivos (migracion b4c5d6e7f8a9) y no deben ofrecerse.
  const categories = segments.filter((s) => s.kind === "CATEGORY" && s.is_active);
  // Opcion 1: nuevo tipo. Opcion 2: nueva categoria dentro de un tipo.
  // Opcion 3: producto (nombre) con tipo+categoria existentes.
  const [newTypeLabel, setNewTypeLabel] = useState("");
  const [catParentCode, setCatParentCode] = useState("");
  const [newCategoryLabel, setNewCategoryLabel] = useState("");
  const [prodTypeCode, setProdTypeCode] = useState("");
  const [prodCatCode, setProdCatCode] = useState("");
  const [prodName, setProdName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const { confirm, dialog } = useConfirm();

  const prodModels = segments.filter((s) => s.kind === "MODEL" && s.is_active && s.parent_code === prodTypeCode);

  // Productos ya presentes en inventario, agrupados por codigo + nombre (description
  // de la pieza). Se omiten los que ya estan definidos aqui con ese tipo+categoria+nombre.
  const inventoryProducts = useMemo(() => {
    const grouped = new Map<string, { code: string; name: string }>();
    for (const item of finishedItems) {
      if (!item.product_code || item.product_code.length !== 7) continue;
      const name = (item.description ?? "").trim().toUpperCase() || "SIN NOMBRE";
      grouped.set(`${item.product_code}|${name}`, { code: item.product_code, name });
    }
    const defined = new Set(types.map((t) => `${t.category_code}${t.model_code}|${t.name ?? ""}`));
    return [...grouped.values()]
      .filter((p) => !defined.has(`${p.code.slice(1)}|${p.name}`))
      .map((p) => ({ ...p, categoryCode: p.code.slice(1, 3), modelCode: p.code.slice(3) }))
      .sort((a, b) => a.code.localeCompare(b.code) || a.name.localeCompare(b.name));
  }, [finishedItems, types]);

  // Drill-down de la vista: tipos → categorías → productos, cada nivel con su tabla.
  const [drillType, setDrillType] = useState<string | null>(null);
  const [drillCat, setDrillCat] = useState<string | null>(null);
  const typeGroups = useMemo(() => {
    const catLabel = (code: string) => segments.find((s) => s.kind === "CATEGORY" && s.code === code)?.label ?? code;
    const modelLabel = (code: string, parent: string) =>
      segments.find((s) => s.kind === "MODEL" && s.code === code && s.parent_code === parent)?.label ?? code;
    const byType = new Map<string, Map<string, { defined: typeof types; inventory: { code: string; name: string }[] }>>();
    const ensure = (cat: string, model: string) => {
      let cats = byType.get(cat);
      if (!cats) {
        cats = new Map();
        byType.set(cat, cats);
      }
      let entry = cats.get(model);
      if (!entry) {
        entry = { defined: [], inventory: [] };
        cats.set(model, entry);
      }
      return entry;
    };
    for (const t of types) ensure(t.category_code, t.model_code).defined.push(t);
    for (const p of inventoryProducts) ensure(p.categoryCode, p.modelCode).inventory.push({ code: p.code, name: p.name });
    return [...byType.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([code, cats]) => {
        const catList = [...cats.entries()]
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([modelCode, entry]) => ({
            code: modelCode,
            label: modelLabel(modelCode, code),
            defined: [...entry.defined].sort((x, y) => (x.name ?? "").localeCompare(y.name ?? "")),
            inventory: [...entry.inventory].sort((x, y) => x.name.localeCompare(y.name)),
          }));
        return {
          code,
          label: catLabel(code),
          cats: catList,
          productCount: catList.reduce((acc, c) => acc + c.defined.length + c.inventory.length, 0),
        };
      });
  }, [types, inventoryProducts, segments]);

  const drilledType = typeGroups.find((g) => g.code === drillType) ?? null;
  const drilledCat = drilledType?.cats.find((c) => c.code === drillCat) ?? null;

  // Paginación por nivel del drill-down; cada nivel vuelve a la página 1 al entrar.
  const typesPager = usePagination(typeGroups, DRILL_PAGE_SIZE);
  const catsPager = usePagination(drilledType?.cats ?? [], DRILL_PAGE_SIZE, drillType ?? "");
  const productRows = useMemo(
    () =>
      drilledCat
        ? [
            ...drilledCat.defined.map((t) => ({ kind: "defined" as const, defined: t, inventory: null })),
            ...drilledCat.inventory.map((p) => ({ kind: "inventory" as const, defined: null, inventory: p })),
          ]
        : [],
    [drilledCat],
  );
  const productsPager = usePagination(productRows, DRILL_PAGE_SIZE, `${drillType ?? ""}/${drillCat ?? ""}`);

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
      setCatParentCode(created.code);
      setProdTypeCode(created.code);
      setProdCatCode("");
      setSuccess(`Tipo #${created.code} ${created.label} creado.`);
      await queryClient.invalidateQueries({ queryKey: ["catalog-segments"] });
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo crear el tipo.");
    } finally {
      setIsSaving(false);
    }
  }

  async function handleCreateCategory(event: FormEvent) {
    event.preventDefault();
    setError(null);
    if (!catParentCode) {
      setError("Selecciona el tipo donde irá la categoría.");
      return;
    }
    if (!newCategoryLabel.trim()) {
      setError("Escribe el nombre de la nueva categoría.");
      return;
    }
    setIsSaving(true);
    try {
      const created = await createCatalogSegment({
        kind: "MODEL",
        label: newCategoryLabel.trim().toUpperCase(),
        parent_code: catParentCode,
      });
      setNewCategoryLabel("");
      setProdTypeCode(catParentCode);
      setProdCatCode(created.code);
      setSuccess(`Categoría #${created.code} ${created.label} creada.`);
      await queryClient.invalidateQueries({ queryKey: ["catalog-segments"] });
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo crear la categoría.");
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
    if (!prodCatCode) {
      setError("Selecciona la categoría.");
      return;
    }
    if (!prodName.trim()) {
      setError("Escribe el nombre del producto.");
      return;
    }
    setIsSaving(true);
    try {
      const created = await createProductType({
        category_code: prodTypeCode,
        model_code: prodCatCode,
        name: prodName.trim().toUpperCase(),
      });
      setProdName("");
      setSuccess(`Producto ${created.name ?? ""} creado.`);
      await queryClient.invalidateQueries({ queryKey: ["product-types"] });
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
      await queryClient.invalidateQueries({ queryKey: ["product-types"] });
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
            <p className="panelText">Tipo, categoría y nombre del catálogo; el material se define en producción.</p>
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

          <form onSubmit={handleCreateCategory} className="formStep">
            <p className="formStepTitle"><strong>2. Crear una categoría</strong> dentro de un tipo existente</p>
            <div className="formStepGrid colsPairAction">
              <label className="fieldGroup">
                <span>Tipo</span>
                <select className="field" disabled={isSaving} onChange={(e) => setCatParentCode(e.target.value)} value={catParentCode}>
                  <option value="">Seleccionar tipo</option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.code}>#{c.code} {c.label}</option>
                  ))}
                </select>
              </label>
              <label className="fieldGroup">
                <span>Nombre de la nueva categoría</span>
                <input className="field" disabled={isSaving} maxLength={120} onChange={(e) => setNewCategoryLabel(e.target.value)} placeholder="Ej. FILIGRANA" value={newCategoryLabel} />
              </label>
              <button className="button buttonPrimary" disabled={isSaving || !catParentCode || !newCategoryLabel.trim()} type="submit">
                <Plus aria-hidden="true" size={14} /> Crear categoría
              </button>
            </div>
          </form>

          <div aria-hidden="true" className="formStepDivider">o</div>

          <form onSubmit={handleCreateProduct} className="formStep">
            <p className="formStepTitle"><strong>3. Crear un producto</strong> con tipo y categoría existentes</p>
            <div className="formStepGrid colsPairAction">
              <label className="fieldGroup">
                <span>Tipo</span>
                <select
                  className="field"
                  disabled={isSaving}
                  onChange={(e) => {
                    setProdTypeCode(e.target.value);
                    setProdCatCode("");
                  }}
                  value={prodTypeCode}
                >
                  <option value="">Seleccionar tipo</option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.code}>#{c.code} {c.label}</option>
                  ))}
                </select>
              </label>
              <label className="fieldGroup">
                <span>Categoría</span>
                <select className="field" disabled={isSaving || !prodTypeCode} onChange={(e) => setProdCatCode(e.target.value)} value={prodCatCode}>
                  <option value="">{prodTypeCode ? (prodModels.length ? "Seleccionar categoría" : "Sin categorías; crea una en la opción 2") : "Elige primero el tipo"}</option>
                  {prodModels.map((m) => (
                    <option key={m.id} value={m.code}>#{m.code} {m.label}</option>
                  ))}
                </select>
              </label>
            </div>
            <div className="formStepGrid colsInputAction">
              <label className="fieldGroup">
                <span>Nombre del producto</span>
                <input className="field" disabled={isSaving} maxLength={180} onChange={(e) => setProdName(e.target.value)} placeholder="Ej. ORQUIDEA FILIGRANA" value={prodName} />
              </label>
              <button className="button buttonPrimary" disabled={isSaving || !prodTypeCode || !prodCatCode || !prodName.trim()} type="submit">
                <Plus aria-hidden="true" size={14} /> Crear producto
              </button>
            </div>
          </form>
        </div>
        ) : null}

        {mode === "view" ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 14, minHeight: 540 }}>
          {drilledType ? (
            <div className="drillBar">
              <button
                className="button"
                onClick={() => (drilledCat ? setDrillCat(null) : setDrillType(null))}
                type="button"
              >
                <ChevronLeft aria-hidden="true" size={15} /> Volver
              </button>
              <span className="drillCrumbs">
                <button onClick={() => { setDrillType(null); setDrillCat(null); }} type="button">Tipos</button>
                <span className="drillCrumbSep">/</span>
                {drilledCat ? (
                  <>
                    <button onClick={() => setDrillCat(null)} type="button">{drilledType.label}</button>
                    <span className="drillCrumbSep">/</span>
                    <span>{drilledCat.label}</span>
                  </>
                ) : (
                  <span>{drilledType.label}</span>
                )}
              </span>
            </div>
          ) : null}

          {drilledCat && drilledType ? (
            <div className="tableWrap pagedListFloor" style={{ flex: "1 1 auto" }}>
              <table className="table tableAuto">
                <thead>
                  <tr>
                    <th style={{ width: 110 }}>Código</th>
                    <th>Nombre</th>
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
                        <td />
                      </tr>
                    );
                  })}
                  {drilledCat.defined.length === 0 && drilledCat.inventory.length === 0 ? (
                    <tr><td colSpan={3}><div className="emptyState">Sin productos en esta categoría.</div></td></tr>
                  ) : null}
                </tbody>
              </table>
              <Pager {...productsPager} />
            </div>
          ) : drilledType ? (
            <div className="tableWrap pagedListFloor" style={{ flex: "1 1 auto" }}>
              <table className="table tableAuto">
                <thead>
                  <tr>
                    <th style={{ width: 90 }}>#</th>
                    <th>Categoría</th>
                    <th className="num">Productos</th>
                    <th aria-label="Abrir" />
                  </tr>
                </thead>
                <tbody>
                  {catsPager.pageItems.map((cat) => (
                    <tr key={cat.code} onClick={() => setDrillCat(cat.code)} style={{ cursor: "pointer" }}>
                      <td><span className="orderCodeTag">#{cat.code}</span></td>
                      <td><strong>{cat.label}</strong></td>
                      <td className="num">{cat.defined.length + cat.inventory.length}</td>
                      <td style={{ textAlign: "right" }}><ChevronRight aria-hidden="true" size={15} /></td>
                    </tr>
                  ))}
                  {drilledType.cats.length === 0 ? (
                    <tr><td colSpan={4}><div className="emptyState">Sin categorías en este tipo.</div></td></tr>
                  ) : null}
                </tbody>
              </table>
              <Pager {...catsPager} />
            </div>
          ) : (
            <div className="tableWrap pagedListFloor" style={{ flex: "1 1 auto" }}>
              <table className="table tableAuto">
                <thead>
                  <tr>
                    <th style={{ width: 90 }}>#</th>
                    <th>Tipo</th>
                    <th className="num">Categorías</th>
                    <th className="num">Productos</th>
                    <th aria-label="Abrir" />
                  </tr>
                </thead>
                <tbody>
                  {typesPager.pageItems.map((group) => (
                    <tr key={group.code} onClick={() => setDrillType(group.code)} style={{ cursor: "pointer" }}>
                      <td><span className="orderCodeTag">#{group.code}</span></td>
                      <td><strong>{group.label}</strong></td>
                      <td className="num">{group.cats.length}</td>
                      <td className="num">{group.productCount}</td>
                      <td style={{ textAlign: "right" }}><ChevronRight aria-hidden="true" size={15} /></td>
                    </tr>
                  ))}
                  {!isLoading && typeGroups.length === 0 ? (
                    <tr><td colSpan={5}><div className="emptyState">Sin tipos de producto. Crea el primero.</div></td></tr>
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
