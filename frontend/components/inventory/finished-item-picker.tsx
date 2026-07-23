"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, Plus, X } from "lucide-react";
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
  excludeIds,
  requireStock = true,
  onSelect,
  onCreate,
  onClose,
}: {
  title: string;
  subtitle?: string;
  items: InventoryItem[];
  excludeIds?: string[];
  // false: la pieza es solo destino (no se consume), sirve aunque no tenga stock.
  requireStock?: boolean;
  onSelect: (item: InventoryItem) => void;
  // Si viene, muestra "Crear producto nuevo" para destinos que aún no existen.
  onCreate?: () => void;
  onClose: () => void;
}) {
  const { data: segments = [] } = useQuery({ queryKey: ["catalog-segments"], queryFn: listCatalogSegments });
  const [drillType, setDrillType] = useState<string | null>(null);

  // Solo piezas del catálogo (código de 7 dígitos), sin las ya elegidas.
  const candidates = useMemo(
    () =>
      items.filter(
        (item) =>
          item.item_type === "FINISHED_PRODUCT" &&
          !(excludeIds ?? []).includes(item.id) &&
          (!requireStock || Number(item.current_stock) > 0) &&
          (item.product_code ?? "").length === 7,
      ),
    [items, excludeIds, requireStock],
  );

  // Jerarquía plana tipo → piezas: el modelo (producto) es parte de la pieza.
  const typeGroups = useMemo(() => {
    const catLabel = (code: string) => segments.find((s) => s.kind === "CATEGORY" && s.code === code)?.label ?? code;
    const byType = new Map<string, InventoryItem[]>();
    for (const item of candidates) {
      const code = item.product_code as string;
      const typeCode = code.slice(1, 3);
      const list = byType.get(typeCode);
      if (list) list.push(item);
      else byType.set(typeCode, [item]);
    }
    return [...byType.entries()]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([code, pieces]) => ({
        code,
        label: catLabel(code),
        pieces: [...pieces].sort(
          (x, y) => (x.product_code ?? "").localeCompare(y.product_code ?? "") || x.sku.localeCompare(y.sku),
        ),
        pieceCount: pieces.length,
      }));
  }, [candidates, segments]);

  const drilledType = typeGroups.find((g) => g.code === drillType) ?? null;

  const typesPager = usePagination(typeGroups, DRILL_PAGE_SIZE);
  const piecesPager = usePagination(drilledType?.pieces ?? [], DRILL_PAGE_SIZE, drillType ?? "");

  return (
    <div className="modalBackdrop modalBackdropTop" role="dialog" aria-modal="true" aria-label={title}>
      <section className="modalWindow">
        <div className="modalHeader">
          <div>
            <h2>{title}</h2>
            <p className="panelText">{subtitle ?? (requireStock ? "Productos terminados con stock · elige uno" : "Productos terminados del catálogo · elige uno")}</p>
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
                      {/* Stock con equivalencia gramos ↔ unidades cuando hay
                          peso por unidad. */}
                      <td className="num">
                        {(() => {
                          const stock = Number(item.current_stock);
                          const wpu = Number(item.weight_per_unit ?? 0);
                          const base = `${stock.toLocaleString("es-EC")} ${item.unit_code}`;
                          if (!(wpu > 0)) return base;
                          if (item.unit_code === "g") {
                            return `${base} · ${Number((stock / wpu).toFixed(2)).toLocaleString("es-EC")} und`;
                          }
                          if (item.unit_code === "und") {
                            return `${base} · ${Number((stock * wpu).toFixed(2)).toLocaleString("es-EC")} g`;
                          }
                          return base;
                        })()}
                      </td>
                    </tr>
                  ))}
                  {drilledType.pieces.length === 0 ? (
                    <tr><td colSpan={4}><div className="emptyState">{requireStock ? "Sin piezas con stock en este tipo." : "Sin piezas en este tipo."}</div></td></tr>
                  ) : null}
                </tbody>
              </table>
              <Pager {...piecesPager} />
            </div>
          ) : (
            <div className="tableWrap pagedListFloor" style={{ flex: "1 1 auto" }}>
              <table className="table tableAuto">
                <thead>
                  <tr>
                    <th>Tipo</th>
                    <th className="num">Piezas</th>
                    <th aria-label="Abrir" />
                  </tr>
                </thead>
                <tbody>
                  {typesPager.pageItems.map((group) => (
                    <tr key={group.code} onClick={() => setDrillType(group.code)} style={{ cursor: "pointer" }}>
                      <td><strong>{group.label}</strong></td>
                      <td className="num">{group.pieceCount}</td>
                      <td style={{ textAlign: "right" }}><ChevronRight aria-hidden="true" size={15} /></td>
                    </tr>
                  ))}
                  {typeGroups.length === 0 ? (
                    <tr><td colSpan={3}><div className="emptyState">{requireStock ? "No hay productos terminados con stock." : "No hay productos terminados en el catálogo."}</div></td></tr>
                  ) : null}
                </tbody>
              </table>
              <Pager {...typesPager} />
            </div>
          )}
        </div>

        {onCreate ? (
          <div className="modalActions">
            <button className="button" onClick={onCreate} type="button">
              <Plus aria-hidden="true" size={14} />
              Crear producto nuevo
            </button>
          </div>
        ) : null}
      </section>
    </div>
  );
}
