"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { listComplementTypes } from "@/lib/inventory-api";
import { Pager, usePagination } from "@/components/shared/pager";
import type { InventoryItem, InventoryItemType } from "@/types/inventory";

const PAGE_SIZE = 10;
const SIN_TIPO = "__sin_tipo__";

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
  description = "Elige un material y luego define su cantidad por unidad",
  items,
  allowedTypes,
  excludeIds,
  requireStock = false,
  onSelect,
  onClose,
  quantityStep,
  error,
}: {
  title: string;
  description?: string;
  items: InventoryItem[];
  allowedTypes: InventoryItemType[];
  excludeIds?: string[];
  // true: items sin stock se muestran deshabilitados (no elegibles) — uso en
  // insumos de etapa, que se consumen de inmediato al avanzar.
  requireStock?: boolean;
  onSelect: (item: InventoryItem) => void;
  onClose: () => void;
  // Si viene, la ventana se queda abierta tras elegir y muestra este paso de
  // cantidad EN LA MISMA ventana (en vez de cerrar y pedirla en otro lado).
  // El llamador es quien controla el item elegido y decide cuando limpiarlo.
  quantityStep?: {
    item: InventoryItem;
    quantity: string;
    onQuantityChange: (value: string) => void;
    onConfirm: () => void;
    onBack: () => void;
    confirmLabel?: string;
    isSaving?: boolean;
  };
  // Error de validacion/guardado del paso de cantidad: se muestra aqui mismo
  // (la ventana se queda abierta esperando el valor correcto), no en un
  // banner lejano fuera de la vista.
  error?: string | null;
}) {
  const [activeTab, setActiveTab] = useState<InventoryItemType>(allowedTypes[0]);
  const [search, setSearch] = useState("");
  const [drillType, setDrillType] = useState<string | null>(null);
  const { data: complementTypes = [] } = useQuery({ queryKey: ["complement-types"], queryFn: listComplementTypes });

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

  // Complementos se agrupan por tipo (broches, cadenas base, etc.) igual que
  // ComplementPicker: una lista plana de decenas de complementos sin
  // distinguir categoria era imposible de recorrer. Al buscar se aplana de
  // vuelta (el termino ya filtra lo suficiente).
  const isComplementTab = activeTab === "COMPLEMENT";
  const showGrouped = isComplementTab && search.trim() === "";
  const typeGroups = useMemo(() => {
    if (!showGrouped) return [];
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
      pieces,
    }));
    groups.sort((a, b) => {
      if (a.code === SIN_TIPO) return 1;
      if (b.code === SIN_TIPO) return -1;
      return a.label.localeCompare(b.label);
    });
    return groups;
  }, [showGrouped, candidates, complementTypes]);
  const drilledGroup = typeGroups.find((g) => g.code === drillType) ?? null;
  const typesPager = usePagination(typeGroups, PAGE_SIZE, activeTab);
  const piecesPager = usePagination(drilledGroup?.pieces ?? [], PAGE_SIZE, drillType ?? "");

  return (
    <div className="modalBackdrop modalBackdropTop" role="dialog" aria-modal="true" aria-label={title}>
      <section className="modalWindow">
        <div className="modalHeader">
          <div>
            <h2>{title}</h2>
            <p className="panelText">{description}</p>
          </div>
          <button aria-label="Cerrar" className="iconOnlyButton" onClick={onClose} type="button">
            <X aria-hidden="true" size={18} />
          </button>
        </div>

        {error ? (
          <div className="processFlowCallout" style={{ color: "var(--danger, #b42318)", marginTop: 10 }}>
            {error}
          </div>
        ) : null}

        {quantityStep ? (
          <div className="materialRow" style={{ alignItems: "flex-start", gap: 8, marginTop: 10 }}>
            <div className="field" style={{ flex: 1, display: "flex", alignItems: "center" }}>
              {quantityStep.item.name} · {quantityStep.item.unit_code}
            </div>
            <input
              aria-label="Cantidad"
              autoFocus
              className="field"
              min="0.0001"
              onChange={(e) => quantityStep.onQuantityChange(e.target.value)}
              placeholder={quantityStep.item.unit_code}
              step="0.0001"
              style={{ width: 110 }}
              type="number"
              value={quantityStep.quantity}
            />
            <button className="button" disabled={quantityStep.isSaving} onClick={quantityStep.onBack} type="button">
              Elegir otro
            </button>
            <button className="button buttonPrimary" disabled={quantityStep.isSaving} onClick={quantityStep.onConfirm} type="button">
              {quantityStep.confirmLabel ?? "Confirmar"}
            </button>
          </div>
        ) : (
          <>
            {allowedTypes.length > 1 ? (
              <div className="rowActions" style={{ marginTop: 10 }}>
                {allowedTypes.map((type) => (
                  <button
                    className={`button${activeTab === type ? " buttonPrimary" : ""}`}
                    key={type}
                    onClick={() => {
                      setActiveTab(type);
                      setDrillType(null);
                    }}
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
              onChange={(event) => {
                setSearch(event.target.value);
                setDrillType(null);
              }}
              placeholder="Buscar por nombre o SKU..."
              style={{ marginTop: 10 }}
              type="text"
              value={search}
            />

            {showGrouped ? (
              drilledGroup ? (
                <>
                  <div className="drillBar" style={{ marginTop: 10 }}>
                    <button className="button" onClick={() => setDrillType(null)} type="button">
                      <ChevronLeft aria-hidden="true" size={15} /> Volver
                    </button>
                    <span className="drillCrumbs">
                      <button onClick={() => setDrillType(null)} type="button">Tipos</button>
                      <span className="drillCrumbSep">/</span>
                      <span>{drilledGroup.label}</span>
                    </span>
                  </div>
                  <div className="tableWrap pagedListFloor" style={{ marginTop: 10 }}>
                    <table className="table tableAuto">
                      <thead>
                        <tr>
                          <th>Nombre</th>
                          <th className="num">Stock</th>
                        </tr>
                      </thead>
                      <tbody>
                        {piecesPager.pageItems.map((item) => {
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
                      </tbody>
                    </table>
                    <Pager {...piecesPager} />
                  </div>
                </>
              ) : (
                <div className="tableWrap pagedListFloor" style={{ marginTop: 10 }}>
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
                          <td className="num">{group.pieces.length}</td>
                          <td style={{ textAlign: "right" }}><ChevronRight aria-hidden="true" size={15} /></td>
                        </tr>
                      ))}
                      {typeGroups.length === 0 ? (
                        <tr>
                          <td colSpan={3}>
                            <div className="emptyState">No hay complementos disponibles.</div>
                          </td>
                        </tr>
                      ) : null}
                    </tbody>
                  </table>
                  <Pager {...typesPager} />
                </div>
              )
            ) : (
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
            )}
          </>
        )}
      </section>
    </div>
  );
}
