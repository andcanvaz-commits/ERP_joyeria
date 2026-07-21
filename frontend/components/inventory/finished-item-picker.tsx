"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { listCatalogSegments, metalTagClass } from "@/lib/catalog-api";
import { Pager, usePagination } from "@/components/shared/pager";
import type { InventoryItem } from "@/types/inventory";

const DRILL_PAGE_SIZE = 10;

/**
 * Selector de una pieza de producto terminado del inventario (con stock),
 * con el mismo drill-down del catálogo: tipos → categorías → piezas.
 * Se usa para elegir con qué producto terminado se combina un lote.
 */
export function FinishedItemPicker({
  title,
  subtitle,
  items,
  excludeId,
  onSelect,
  onClose,
}: {
  title: string;
  subtitle?: string;
  items: InventoryItem[];
  excludeId?: string;
  onSelect: (item: InventoryItem) => void;
  onClose: () => void;
}) {
  const { data: segments = [] } = useQuery({ queryKey: ["catalog-segments"], queryFn: listCatalogSegments });
  const [drillType, setDrillType] = useState<string | null>(null);
  const [drillCat, setDrillCat] = useState<string | null>(null);

  // Solo piezas del catálogo con stock (código de 7 dígitos), nunca el lote mismo.
  const candidates = useMemo(
    () =>
      items.filter(
        (item) =>
          item.item_type === "FINISHED_PRODUCT" &&
          item.id !== excludeId &&
          Number(item.current_stock) > 0 &&
          (item.product_code ?? "").length === 7,
      ),
    [items, excludeId],
  );

  const typeGroups = useMemo(() => {
    const catLabel = (code: string) => segments.find((s) => s.kind === "CATEGORY" && s.code === code)?.label ?? code;
    const modelLabel = (code: string, parent: string) =>
      segments.find((s) => s.kind === "MODEL" && s.code === code && s.parent_code === parent)?.label ?? code;
    const byType = new Map<string, Map<string, InventoryItem[]>>();
    for (const item of candidates) {
      const code = item.product_code as string;
      const typeCode = code.slice(1, 3);
      const modelCode = code.slice(3);
      let cats = byType.get(typeCode);
      if (!cats) {
        cats = new Map();
        byType.set(typeCode, cats);
      }
      const list = cats.get(modelCode);
      if (list) list.push(item);
      else cats.set(modelCode, [item]);
    }
    return [...byType.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([code, cats]) => {
        const catList = [...cats.entries()]
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([modelCode, pieces]) => ({
            code: modelCode,
            label: modelLabel(modelCode, code),
            pieces: [...pieces].sort(
              (x, y) => (x.product_code ?? "").localeCompare(y.product_code ?? "") || x.name.localeCompare(y.name),
            ),
          }));
        return {
          code,
          label: catLabel(code),
          cats: catList,
          pieceCount: catList.reduce((acc, c) => acc + c.pieces.length, 0),
        };
      });
  }, [candidates, segments]);

  const drilledType = typeGroups.find((g) => g.code === drillType) ?? null;
  const drilledCat = drilledType?.cats.find((c) => c.code === drillCat) ?? null;

  const typesPager = usePagination(typeGroups, DRILL_PAGE_SIZE);
  const catsPager = usePagination(drilledType?.cats ?? [], DRILL_PAGE_SIZE, drillType ?? "");
  const piecesPager = usePagination(drilledCat?.pieces ?? [], DRILL_PAGE_SIZE, `${drillType ?? ""}/${drillCat ?? ""}`);

  return (
    <div className="modalBackdrop modalBackdropTop" role="dialog" aria-modal="true" aria-label={title}>
      <section className="modalWindow">
        <div className="modalHeader">
          <div>
            <h2>{title}</h2>
            <p className="panelText">{subtitle ?? "Productos terminados con stock · elige uno"}</p>
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
                    <th>Material</th>
                    <th className="num">Stock</th>
                  </tr>
                </thead>
                <tbody>
                  {piecesPager.pageItems.map((item) => (
                    <tr key={item.id} onClick={() => onSelect(item)} style={{ cursor: "pointer" }}>
                      <td><span className={`orderCodeTag${metalTagClass(item.product_code)}`}>#{item.product_code}</span></td>
                      <td>{(item.description ?? "").trim() || item.name}</td>
                      <td>{item.material_type ?? "—"}</td>
                      <td className="num">{Number(item.current_stock).toLocaleString("es-EC")} {item.unit_code}</td>
                    </tr>
                  ))}
                  {drilledCat.pieces.length === 0 ? (
                    <tr><td colSpan={4}><div className="emptyState">Sin piezas con stock en esta categoría.</div></td></tr>
                  ) : null}
                </tbody>
              </table>
              <Pager {...piecesPager} />
            </div>
          ) : drilledType ? (
            <div className="tableWrap pagedListFloor" style={{ flex: "1 1 auto" }}>
              <table className="table tableAuto">
                <thead>
                  <tr>
                    <th style={{ width: 90 }}>#</th>
                    <th>Categoría</th>
                    <th className="num">Piezas</th>
                    <th aria-label="Abrir" />
                  </tr>
                </thead>
                <tbody>
                  {catsPager.pageItems.map((cat) => (
                    <tr key={cat.code} onClick={() => setDrillCat(cat.code)} style={{ cursor: "pointer" }}>
                      <td><span className="orderCodeTag">#{cat.code}</span></td>
                      <td><strong>{cat.label}</strong></td>
                      <td className="num">{cat.pieces.length}</td>
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
                    <th className="num">Piezas</th>
                    <th aria-label="Abrir" />
                  </tr>
                </thead>
                <tbody>
                  {typesPager.pageItems.map((group) => (
                    <tr key={group.code} onClick={() => setDrillType(group.code)} style={{ cursor: "pointer" }}>
                      <td><span className="orderCodeTag">#{group.code}</span></td>
                      <td><strong>{group.label}</strong></td>
                      <td className="num">{group.cats.length}</td>
                      <td className="num">{group.pieceCount}</td>
                      <td style={{ textAlign: "right" }}><ChevronRight aria-hidden="true" size={15} /></td>
                    </tr>
                  ))}
                  {typeGroups.length === 0 ? (
                    <tr><td colSpan={5}><div className="emptyState">No hay productos terminados con stock.</div></td></tr>
                  ) : null}
                </tbody>
              </table>
              <Pager {...typesPager} />
            </div>
          )}
        </div>
      </section>
    </div>
  );
}
