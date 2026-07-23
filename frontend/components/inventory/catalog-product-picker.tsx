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
 * productos terminados (tipos → productos). Al dar clic en un producto se
 * selecciona y cierra. Incluye "Crear producto nuevo", que abre el
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

  const allowed = allowedTypeIds ?? [];
  const canCreate = allowed.length === 0;
  const active = useMemo(
    () => types.filter((type) => type.is_active && (allowed.length === 0 || allowed.includes(type.id))),
    [types, allowed],
  );

  // Drill-down tipos → productos, igual que el mantenimiento.
  const typeGroups = useMemo(() => {
    const catLabel = (code: string) => segments.find((s) => s.kind === "CATEGORY" && s.code === code)?.label ?? code;
    const byType = new Map<string, ProductType[]>();
    for (const type of active) {
      const list = byType.get(type.category_code);
      if (list) list.push(type);
      else byType.set(type.category_code, [type]);
    }
    return [...byType.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([code, products]) => ({
        code,
        label: catLabel(code),
        products: [...products].sort(
          (x, y) => x.model_code.localeCompare(y.model_code) || (x.name ?? "").localeCompare(y.name ?? ""),
        ),
        productCount: products.length,
      }));
  }, [active, segments]);

  const drilledType = typeGroups.find((g) => g.code === drillType) ?? null;

  const typesPager = usePagination(typeGroups, DRILL_PAGE_SIZE);
  const productsPager = usePagination(drilledType?.products ?? [], DRILL_PAGE_SIZE, drillType ?? "");

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
                  {drilledType.products.length === 0 ? (
                    <tr><td colSpan={3}><div className="emptyState">Sin productos en este tipo.</div></td></tr>
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
                  {typeGroups.length === 0 ? (
                    <tr><td colSpan={3}><div className="emptyState">Sin productos en el catálogo.</div></td></tr>
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
