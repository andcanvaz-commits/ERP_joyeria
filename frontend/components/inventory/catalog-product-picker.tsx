"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, Plus, X } from "lucide-react";
import { listCatalogSegments } from "@/lib/catalog-api";
import { listProductTypes, type ProductType } from "@/lib/product-types-api";
import { ProductTypesManager } from "@/components/mantenimiento/product-types-manager";
import { Pager, usePagination } from "@/components/shared/pager";

const DRILL_PAGE_SIZE = 10;

/**
 * Selector de producto del catálogo con el mismo drill-down del inventario de
 * productos terminados (tipos → categorías → productos). Al dar clic en un
 * producto se selecciona y cierra. Incluye "Crear producto nuevo", que abre el
 * mantenimiento de productos terminados y deja el creado auto-seleccionado.
 */
export function CatalogProductPicker({
  title,
  subtitle,
  selectedId,
  allowedTypeIds,
  onSelect,
  onClose,
}: {
  title: string;
  subtitle?: string;
  selectedId?: string;
  // Si viene con elementos, solo se ofrecen esos tipos y no se puede crear
  // (el proceso de la orden declara qué produce; el backend rechazaría otro).
  allowedTypeIds?: string[];
  onSelect: (type: ProductType) => void;
  onClose: () => void;
}) {
  const { data: segments = [] } = useQuery({ queryKey: ["catalog-segments"], queryFn: listCatalogSegments });
  const { data: types = [] } = useQuery({ queryKey: ["product-types"], queryFn: listProductTypes });
  const [isCreating, setIsCreating] = useState(false);
  const [drillType, setDrillType] = useState<string | null>(null);
  const [drillCat, setDrillCat] = useState<string | null>(null);

  const allowed = allowedTypeIds ?? [];
  const canCreate = allowed.length === 0;
  const active = useMemo(
    () => types.filter((type) => type.is_active && (allowed.length === 0 || allowed.includes(type.id))),
    [types, allowed],
  );

  // Drill-down tipos → categorías → productos, igual que el mantenimiento.
  const typeGroups = useMemo(() => {
    const catLabel = (code: string) => segments.find((s) => s.kind === "CATEGORY" && s.code === code)?.label ?? code;
    const modelLabel = (code: string, parent: string) =>
      segments.find((s) => s.kind === "MODEL" && s.code === code && s.parent_code === parent)?.label ?? code;
    const byType = new Map<string, Map<string, ProductType[]>>();
    for (const type of active) {
      let cats = byType.get(type.category_code);
      if (!cats) {
        cats = new Map();
        byType.set(type.category_code, cats);
      }
      const list = cats.get(type.model_code);
      if (list) list.push(type);
      else cats.set(type.model_code, [type]);
    }
    return [...byType.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([code, cats]) => {
        const catList = [...cats.entries()]
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([modelCode, products]) => ({
            code: modelCode,
            label: modelLabel(modelCode, code),
            products: [...products].sort((x, y) => (x.name ?? "").localeCompare(y.name ?? "")),
          }));
        return {
          code,
          label: catLabel(code),
          cats: catList,
          productCount: catList.reduce((acc, c) => acc + c.products.length, 0),
        };
      });
  }, [active, segments]);

  const drilledType = typeGroups.find((g) => g.code === drillType) ?? null;
  const drilledCat = drilledType?.cats.find((c) => c.code === drillCat) ?? null;

  const typesPager = usePagination(typeGroups, DRILL_PAGE_SIZE);
  const catsPager = usePagination(drilledType?.cats ?? [], DRILL_PAGE_SIZE, drillType ?? "");
  const productsPager = usePagination(drilledCat?.products ?? [], DRILL_PAGE_SIZE, `${drillType ?? ""}/${drillCat ?? ""}`);

  if (isCreating) {
    return (
      <ProductTypesManager
        mode="create"
        onClose={() => setIsCreating(false)}
        onProductCreated={(created) => {
          setIsCreating(false);
          onSelect(created);
        }}
      />
    );
  }

  return (
    <div className="modalBackdrop modalBackdropTop" role="dialog" aria-modal="true" aria-label={title}>
      <section className="modalWindow">
        <div className="modalHeader">
          <div>
            <h2>{title}</h2>
            <p className="panelText">{subtitle ?? "Catálogo de productos terminados · elige uno"}</p>
          </div>
          <button aria-label="Cerrar" className="iconOnlyButton" onClick={onClose} type="button">
            <X aria-hidden="true" size={18} />
          </button>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 10, marginTop: 14, minHeight: typeGroups.length >= DRILL_PAGE_SIZE ? 460 : undefined }}>
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
                    <th className="num">Precio</th>
                  </tr>
                </thead>
                <tbody>
                  {productsPager.pageItems.map((type) => (
                    <tr
                      key={type.id}
                      onClick={() => onSelect(type)}
                      style={{ cursor: "pointer", background: selectedId === type.id ? "var(--accent-soft, rgba(0,0,0,0.06))" : undefined }}
                    >
                      <td><span className="orderCodeTag">#{type.category_code}{type.model_code}</span></td>
                      <td>{type.name ?? "—"}</td>
                      <td className="num">{type.price ? `$ ${Number(type.price).toLocaleString("es-EC", { minimumFractionDigits: 2 })}` : "—"}</td>
                    </tr>
                  ))}
                  {drilledCat.products.length === 0 ? (
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
                      <td className="num">{cat.products.length}</td>
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
                  {typeGroups.length === 0 ? (
                    <tr><td colSpan={5}><div className="emptyState">Sin productos en el catálogo.</div></td></tr>
                  ) : null}
                </tbody>
              </table>
              <Pager {...typesPager} />
            </div>
          )}
        </div>

        {canCreate ? (
          <div className="modalActions">
            <button className="button" onClick={() => setIsCreating(true)} type="button">
              <Plus aria-hidden="true" size={14} />
              Crear producto nuevo
            </button>
          </div>
        ) : null}
      </section>
    </div>
  );
}
