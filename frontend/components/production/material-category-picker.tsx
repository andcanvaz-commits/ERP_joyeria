"use client";

import { useMemo, useState } from "react";
import { X } from "lucide-react";
import { Pager, usePagination } from "@/components/shared/pager";
import type { InventoryItem, InventoryItemType } from "@/types/inventory";

const PAGE_SIZE = 10;

const TAB_LABEL: Record<InventoryItemType, string> = {
  RAW_MATERIAL: "Materia prima",
  SUPPLY: "Insumos",
  COMPLEMENT: "Complementos",
  WASTE: "Merma",
  WORK_IN_PROGRESS: "En proceso",
  FINISHED_PRODUCT: "Terminados",
};

/**
 * Selector de materiales para procesos/etapas: tabs por categoria (segun
 * allowedTypes), buscador y tabla con stock. Espejo del picker de inventario
 * (FinishedItemPicker/ComplementPicker) pero sin drill-down, para RAW_MATERIAL,
 * COMPLEMENT, WASTE o SUPPLY segun el contexto que lo abre.
 */
export function MaterialCategoryPicker({
  title,
  items,
  allowedTypes,
  excludeIds,
  requireStock = false,
  onSelect,
  onClose,
}: {
  title: string;
  items: InventoryItem[];
  allowedTypes: InventoryItemType[];
  excludeIds?: string[];
  // true: items sin stock se muestran deshabilitados (no elegibles) — uso en
  // insumos de etapa, que se consumen de inmediato al avanzar.
  requireStock?: boolean;
  onSelect: (item: InventoryItem) => void;
  onClose: () => void;
}) {
  const [activeTab, setActiveTab] = useState<InventoryItemType>(allowedTypes[0]);
  const [search, setSearch] = useState("");

  const candidates = useMemo(() => {
    const term = search.trim().toLowerCase();
    return items
      .filter(
        (item) =>
          item.item_type === activeTab &&
          !item.archived_at &&
          !(excludeIds ?? []).includes(item.id) &&
          (term === "" || item.name.toLowerCase().includes(term) || item.sku.toLowerCase().includes(term)),
      )
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [items, activeTab, excludeIds, search]);

  const pager = usePagination(candidates, PAGE_SIZE, `${activeTab}-${search}`);

  return (
    <div className="modalBackdrop modalBackdropTop" role="dialog" aria-modal="true" aria-label={title}>
      <section className="modalWindow">
        <div className="modalHeader">
          <div>
            <h2>{title}</h2>
            <p className="panelText">Elige un material y luego define su cantidad por unidad</p>
          </div>
          <button aria-label="Cerrar" className="iconOnlyButton" onClick={onClose} type="button">
            <X aria-hidden="true" size={18} />
          </button>
        </div>

        {allowedTypes.length > 1 ? (
          <div className="rowActions" style={{ marginTop: 10 }}>
            {allowedTypes.map((type) => (
              <button
                className={`button${activeTab === type ? " buttonPrimary" : ""}`}
                key={type}
                onClick={() => setActiveTab(type)}
                type="button"
              >
                {TAB_LABEL[type]}
              </button>
            ))}
          </div>
        ) : null}

        <input
          aria-label="Buscar material"
          className="field searchField"
          onChange={(event) => setSearch(event.target.value)}
          placeholder="Buscar por nombre o SKU..."
          style={{ marginTop: 10 }}
          type="text"
          value={search}
        />

        <div className="tableWrap pagedListFloor" style={{ marginTop: 10 }}>
          <table className="table tableAuto">
            <thead>
              <tr>
                <th>Nombre</th>
                <th className="num">Stock</th>
              </tr>
            </thead>
            <tbody>
              {pager.pageItems.map((item) => {
                const isOut = requireStock && Number(item.current_stock) <= 0;
                return (
                  <tr
                    className={isOut ? "inventoryItemInactive" : undefined}
                    key={item.id}
                    onClick={isOut ? undefined : () => onSelect(item)}
                    style={{ cursor: isOut ? "not-allowed" : "pointer" }}
                  >
                    <td>{item.name}</td>
                    <td className="num">
                      {Number(item.current_stock).toLocaleString("es-EC")} {item.unit_code}
                      {isOut ? " — agotado" : ""}
                    </td>
                  </tr>
                );
              })}
              {candidates.length === 0 ? (
                <tr>
                  <td colSpan={2}>
                    <div className="emptyState">No hay {TAB_LABEL[activeTab].toLowerCase()} disponibles.</div>
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
          <Pager {...pager} />
        </div>
      </section>
    </div>
  );
}
