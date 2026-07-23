"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { listComplementTypes } from "@/lib/inventory-api";
import { Pager, usePagination } from "@/components/shared/pager";
import type { InventoryItem } from "@/types/inventory";

const DRILL_PAGE_SIZE = 10;
const SIN_TIPO = "__sin_tipo__";

/**
 * Selector de un complemento del inventario (broches, cadenas base, etc.),
 * espejo de FinishedItemPicker pero agrupado por tipo de complemento en vez
 * del drill-down de catálogo. Grupo "Sin tipo" siempre al final.
 */
export function ComplementPicker({
  title,
  items,
  excludeIds,
  onSelect,
  onClose,
}: {
  title: string;
  items: InventoryItem[];
  excludeIds?: string[];
  onSelect: (item: InventoryItem) => void;
  onClose: () => void;
}) {
  const { data: complementTypes = [] } = useQuery({ queryKey: ["complement-types"], queryFn: listComplementTypes });
  const [drillType, setDrillType] = useState<string | null>(null);

  const candidates = useMemo(
    () =>
      items.filter(
        (item) =>
          item.item_type === "COMPLEMENT" &&
          !item.archived_at &&
          !(excludeIds ?? []).includes(item.id),
      ),
    [items, excludeIds],
  );

  // Agrupado por tipo de complemento; "Sin tipo" siempre al final.
  const typeGroups = useMemo(() => {
    const byType = new Map<string, InventoryItem[]>();
    for (const item of candidates) {
      const key = item.complement_type_id ?? SIN_TIPO;
      const list = byType.get(key);
      if (list) list.push(item);
      else byType.set(key, [item]);
    }
    const groups = [...byType.entries()].map(([key, pieces]) => ({
      code: key,
      label: key === SIN_TIPO ? "Sin tipo" : complementTypes.find((t) => t.id === key)?.name ?? "Sin tipo",
      pieces: [...pieces].sort((a, b) => a.name.localeCompare(b.name)),
      pieceCount: pieces.length,
    }));
    groups.sort((a, b) => {
      if (a.code === SIN_TIPO) return 1;
      if (b.code === SIN_TIPO) return -1;
      return a.label.localeCompare(b.label);
    });
    return groups;
  }, [candidates, complementTypes]);

  const drilledType = typeGroups.find((g) => g.code === drillType) ?? null;

  const typesPager = usePagination(typeGroups, DRILL_PAGE_SIZE);
  const piecesPager = usePagination(drilledType?.pieces ?? [], DRILL_PAGE_SIZE, drillType ?? "");

  return (
    <div className="modalBackdrop modalBackdropTop" role="dialog" aria-modal="true" aria-label={title}>
      <section className="modalWindow">
        <div className="modalHeader">
          <div>
            <h2>{title}</h2>
            <p className="panelText">Complementos disponibles · elige uno</p>
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
                    <th>Nombre</th>
                    <th>Tipo</th>
                    <th className="num">Stock</th>
                  </tr>
                </thead>
                <tbody>
                  {piecesPager.pageItems.map((item) => (
                    <tr key={item.id} onClick={() => onSelect(item)} style={{ cursor: "pointer" }}>
                      <td>{item.name}</td>
                      <td>{drilledType.label}</td>
                      <td className="num">
                        {Number(item.current_stock).toLocaleString("es-EC")} {item.unit_code}
                      </td>
                    </tr>
                  ))}
                  {drilledType.pieces.length === 0 ? (
                    <tr><td colSpan={3}><div className="emptyState">Sin complementos en este tipo.</div></td></tr>
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
                    <th className="num">Complementos</th>
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
                    <tr><td colSpan={3}><div className="emptyState">No hay complementos disponibles.</div></td></tr>
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
