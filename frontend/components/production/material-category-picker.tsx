"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { listComplementTypes } from "@/lib/inventory-api";
import { listCatalogSegments } from "@/lib/catalog-api";
import { listProductTypes, type ProductType } from "@/lib/product-types-api";
import { Pager, usePagination } from "@/components/shared/pager";
import { ToastNotice } from "@/components/ui/toast-notice";
import type { InventoryItem, InventoryItemType } from "@/types/inventory";

const PAGE_SIZE = 10;
const SIN_TIPO = "__sin_tipo__";
const SIN_CATEGORIA = "__sin_categoria__";

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
  extraStep,
  allowProductTypeCreation = false,
  onSelectProductType,
  error,
  onDismissError,
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
    // Campo extra obligatorio para auditoria (motivo de un agregado hecho
    // DESPUES de que la etapa ya arranco -- ver AdminAddActaLineControl). Va
    // aca adentro y no como hermano del picker porque este es un modal
    // position:fixed: cualquier cosa renderizada afuera queda tapada por el
    // overlay y el usuario nunca la ve.
    note?: {
      value: string;
      onChange: (value: string) => void;
      label: string;
      placeholder?: string;
    };
  };
  // Paso alternativo controlado enteramente por el llamador (ej. elegir
  // material+unidad+cantidad para una pieza de catalogo sin stock todavia):
  // reemplaza la tabla de busqueda igual que quantityStep, pero sin una
  // forma fija -- el llamador arma su propio contenido.
  extraStep?: React.ReactNode;
  // Terminados: ademas de los items con stock, ofrece los Tipos de producto
  // (Mantenimiento) que todavia no tienen ninguna pieza de inventario --
  // Rodrigo, 2026-08-20: "necesito que me salgan productos terminados que
  // haya creado aunque no haya stock y poder seleccionarlo".
  allowProductTypeCreation?: boolean;
  onSelectProductType?: (productType: ProductType) => void;
  // Error de validacion/guardado del paso de cantidad: se muestra aqui mismo
  // (la ventana se queda abierta esperando el valor correcto), no en un
  // banner lejano fuera de la vista.
  error?: string | null;
  // Como limpiar `error` cuando el usuario cierra el aviso a mano -- si no
  // viene, el boton de cerrar del aviso no hace nada (el caller sigue
  // controlando `error` por su cuenta, ej. lo limpia solo al reintentar).
  onDismissError?: () => void;
}) {
  const [activeTab, setActiveTab] = useState<InventoryItemType>(allowedTypes[0]);
  const [search, setSearch] = useState("");
  const [drillType, setDrillType] = useState<string | null>(null);
  const { data: complementTypes = [] } = useQuery({ queryKey: ["complement-types"], queryFn: listComplementTypes });
  const { data: segments = [] } = useQuery({ queryKey: ["catalog-segments"], queryFn: listCatalogSegments });
  const { data: productTypes = [] } = useQuery({
    queryKey: ["product-types"],
    queryFn: listProductTypes,
    enabled: allowProductTypeCreation,
  });

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

  // Complementos se agrupan por tipo (broches, cadenas base, etc.) y
  // terminados por categoria del catalogo -- una lista plana de piezas que
  // comparten el mismo nombre (la categoria, ej. "ANILLOS") era indistinguible,
  // solo se diferenciaban por stock (Rodrigo, 2026-08-20). Al buscar se
  // aplana de vuelta (el termino ya filtra lo suficiente).
  const isComplementTab = activeTab === "COMPLEMENT";
  const isFinishedTab = activeTab === "FINISHED_PRODUCT";
  const showGrouped = (isComplementTab || isFinishedTab) && search.trim() === "";
  const complementTypeGroups = useMemo(() => {
    if (!isComplementTab || !showGrouped) return [];
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
      missingTypes: [] as ProductType[],
    }));
    groups.sort((a, b) => {
      if (a.code === SIN_TIPO) return 1;
      if (b.code === SIN_TIPO) return -1;
      return a.label.localeCompare(b.label);
    });
    return groups;
  }, [isComplementTab, showGrouped, candidates, complementTypes]);
  // Categoria = segundo/tercer digito del codigo de 7 (material+categoria+
  // modelo), igual que FinishedItemPicker (referencia ya usada en Inventario).
  // Ademas, si allowProductTypeCreation, se suman los Tipos de producto
  // (Mantenimiento) que todavia no tienen ninguna pieza de inventario en
  // ningun material -- se listan como "Sin stock" y al elegirlos se crea la
  // pieza real (Rodrigo, 2026-08-20).
  const finishedTypeGroups = useMemo(() => {
    if (!isFinishedTab || !showGrouped) return [];
    const catLabel = (code: string) => segments.find((s) => s.kind === "CATEGORY" && s.code === code)?.label ?? code;
    const byType = new Map<string, { pieces: InventoryItem[]; missingTypes: ProductType[] }>();
    const ensure = (key: string) => {
      let group = byType.get(key);
      if (!group) {
        group = { pieces: [], missingTypes: [] };
        byType.set(key, group);
      }
      return group;
    };
    for (const item of candidates) {
      const code = item.product_code ?? "";
      const key = code.length === 7 ? code.slice(1, 3) : SIN_CATEGORIA;
      ensure(key).pieces.push(item);
    }
    if (allowProductTypeCreation) {
      for (const productType of productTypes) {
        if (!productType.is_active) continue;
        const modelSuffix = `${productType.category_code}${productType.model_code}`;
        const hasStock = candidates.some((item) => (item.product_code ?? "").slice(1) === modelSuffix);
        if (hasStock) continue;
        ensure(productType.category_code).missingTypes.push(productType);
      }
    }
    const groups = [...byType.entries()].map(([key, group]) => ({
      code: key,
      label: key === SIN_CATEGORIA ? "Sin categoría" : catLabel(key),
      pieces: [...group.pieces].sort(
        (a, b) => (a.product_code ?? "").localeCompare(b.product_code ?? "") || a.sku.localeCompare(b.sku),
      ),
      missingTypes: [...group.missingTypes].sort((a, b) => (a.name ?? "").localeCompare(b.name ?? "")),
    }));
    groups.sort((a, b) => {
      if (a.code === SIN_CATEGORIA) return 1;
      if (b.code === SIN_CATEGORIA) return -1;
      return a.label.localeCompare(b.label);
    });
    return groups;
  }, [isFinishedTab, showGrouped, candidates, segments, allowProductTypeCreation, productTypes]);
  const typeGroups = isComplementTab ? complementTypeGroups : finishedTypeGroups;
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
          <div className="toastStack" aria-live="polite" style={{ marginTop: 10 }}>
            <ToastNotice kind="error" message={error} onClose={() => onDismissError?.()} compact />
          </div>
        ) : null}

        {quantityStep ? (
          <div style={{ marginTop: 10 }}>
            <div className="materialRow" style={{ alignItems: "flex-start", gap: 8 }}>
              <div className="field" style={{ flex: 1, display: "flex", alignItems: "center" }}>
                {quantityStep.item.name} · {quantityStep.item.unit_code}
              </div>
              <input
                aria-label="Cantidad"
                autoFocus
                className="field"
                min="0.0001"
                onChange={(e) => quantityStep.onQuantityChange(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !quantityStep.isSaving) {
                    e.preventDefault();
                    quantityStep.onConfirm();
                  }
                }}
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
            {quantityStep.note ? (
              <div className="materialRow" style={{ alignItems: "flex-start", gap: 8, marginTop: 8 }}>
                <input
                  aria-label={quantityStep.note.label}
                  className="field"
                  onChange={(e) => quantityStep.note?.onChange(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !quantityStep.isSaving) {
                      e.preventDefault();
                      quantityStep.onConfirm();
                    }
                  }}
                  placeholder={quantityStep.note.placeholder ?? quantityStep.note.label}
                  style={{ flex: 1 }}
                  type="text"
                  value={quantityStep.note.value}
                />
              </div>
            ) : null}
          </div>
        ) : extraStep ? (
          <div style={{ marginTop: 10 }}>{extraStep}</div>
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
              placeholder="Buscar por nombre o código..."
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
                          {isFinishedTab ? <th style={{ width: 110 }}>Código</th> : null}
                          <th>{isFinishedTab ? "Producto" : "Nombre"}</th>
                          {isFinishedTab ? <th>Material</th> : null}
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
                              {isFinishedTab ? <td>#{item.product_code}</td> : null}
                              <td>{isFinishedTab ? (item.description ?? "").trim() || item.name : item.name}</td>
                              {isFinishedTab ? <td>{item.material_type ?? "—"}</td> : null}
                              <td className="num">
                                {Number(item.current_stock).toLocaleString("es-EC")} {item.unit_code}
                                {isOut ? " — agotado" : ""}
                              </td>
                            </tr>
                          );
                        })}
                        {isFinishedTab && drilledGroup.missingTypes.length > 0
                          ? drilledGroup.missingTypes.map((productType) => (
                              <tr
                                key={`pt-${productType.id}`}
                                onClick={() => onSelectProductType?.(productType)}
                                style={{ cursor: "pointer" }}
                              >
                                <td>—</td>
                                <td>{productType.name ?? "—"}</td>
                                <td>—</td>
                                <td className="num">Sin stock — crear pieza</td>
                              </tr>
                            ))
                          : null}
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
                        <th>{isFinishedTab ? "Categoría" : "Tipo"}</th>
                        <th className="num">Piezas</th>
                        <th aria-label="Abrir" />
                      </tr>
                    </thead>
                    <tbody>
                      {typesPager.pageItems.map((group) => (
                        <tr key={group.code} onClick={() => setDrillType(group.code)} style={{ cursor: "pointer" }}>
                          <td><strong>{group.label}</strong></td>
                          <td className="num">{group.pieces.length + group.missingTypes.length}</td>
                          <td style={{ textAlign: "right" }}><ChevronRight aria-hidden="true" size={15} /></td>
                        </tr>
                      ))}
                      {typeGroups.length === 0 ? (
                        <tr>
                          <td colSpan={3}>
                            <div className="emptyState">No hay {isFinishedTab ? "productos terminados" : "complementos"} disponibles.</div>
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
                      {isFinishedTab ? <th style={{ width: 110 }}>Código</th> : null}
                      <th>{isFinishedTab ? "Producto" : "Nombre"}</th>
                      {isFinishedTab ? <th>Material</th> : null}
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
                          {isFinishedTab ? <td>#{item.product_code}</td> : null}
                          <td>{isFinishedTab ? (item.description ?? "").trim() || item.name : item.name}</td>
                          {isFinishedTab ? <td>{item.material_type ?? "—"}</td> : null}
                          <td className="num">
                            {Number(item.current_stock).toLocaleString("es-EC")} {item.unit_code}
                            {isOut ? " — agotado" : ""}
                          </td>
                        </tr>
                      );
                    })}
                    {candidates.length === 0 ? (
                      <tr>
                        <td colSpan={isFinishedTab ? 4 : 2}>
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
