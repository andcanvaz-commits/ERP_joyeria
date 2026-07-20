"use client";

import { ChangeEvent, FormEvent, Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Boxes, ChevronDown, ChevronLeft, ChevronRight, Download, Eye, FlaskConical, History, Inbox, Minus, Plus, Printer, Repeat, RotateCcw, Save, SlidersHorizontal, Trash2, Upload, X } from "lucide-react";
import { createPortal } from "react-dom";
import { isAuthenticated } from "@/lib/api";
import { openableProps, stopClick } from "@/lib/a11y";
import { buildItemNameMap, buildOrdenProduccion } from "@/lib/orden-produccion";
import { OrdenProduccionDoc, type DocMode } from "@/components/documentos/orden-produccion-doc";
import { getCurrentUser, listUsers } from "@/lib/auth-api";
import { confirmDelete, useConfirm } from "@/components/ui/confirm-dialog";
import { listCatalogSegments, metalTagClass } from "@/lib/catalog-api";
import { listUnits } from "@/lib/units-api";
import { listProductTypes } from "@/lib/product-types-api";
import {
  archiveInventoryItem,
  convertLotToProduct,
  createInventoryItem,
  createInventoryMovement,
  deleteInventoryItem,
  downloadInventoryMovementSourceFile,
  getInventorySummary,
  listInventoryItems,
  listInventoryMovements,
  revertLastEntry,
  unarchiveInventoryItem,
  updateInventoryItem,
  type CreateInventoryMovementPayload,
  type SaveInventoryItemPayload,
} from "@/lib/inventory-api";
import {
  approveProductionRunMaterials,
  rejectProductionRunMaterials,
  listProductionRuns,
  receiveProductionRunFinishedProduct,
} from "@/lib/production-api";
import type { InventoryItem, InventoryItemType, InventoryMovement, InventoryMovementType } from "@/types/inventory";
import type { ProductionRun, ProductionRunStage } from "@/types/production";
import { Pager, usePagination } from "@/components/shared/pager";
import { RunStageSummaryTable } from "@/components/production/run-stage-summary";

const ITEM_TYPES: Array<{ value: InventoryItemType | "TODOS" | "ORDENES_TERMINADAS"; label: string }> = [
  { value: "RAW_MATERIAL", label: "Materia prima" },
  { value: "SUPPLY", label: "Insumos" },
  { value: "WORK_IN_PROGRESS", label: "Productos en proceso" },
  { value: "ORDENES_TERMINADAS", label: "Procesos terminados" },
  { value: "FINISHED_PRODUCT", label: "Productos terminados" },
];

const UNIT_OPTIONS = [
  { value: "g", label: "Gramos (g)" },
  { value: "kg", label: "Kilogramos (kg)" },
  { value: "mg", label: "Miligramos (mg)" },
  { value: "oz_t", label: "Onza troy (oz t)" },
  { value: "dwt", label: "Pennyweight (dwt)" },
  { value: "ct", label: "Quilates / carats (ct)" },
  { value: "und", label: "Unidad (und)" },
];

const MOVEMENT_TYPES: Array<{ value: InventoryMovementType; label: string }> = [
  { value: "ENTRADA", label: "Entrada" },
  { value: "SALIDA", label: "Salida" },
  { value: "AJUSTE_POSITIVO", label: "Ajuste positivo" },
  { value: "AJUSTE_NEGATIVO", label: "Ajuste negativo" },
  { value: "CONSUMO_PRODUCCION", label: "Consumo produccion" },
  { value: "INGRESO_PRODUCCION", label: "Ingreso produccion" },
  { value: "MERMA", label: "Merma" },
  { value: "CONVERSION_SALIDA", label: "Conversion salida" },
  { value: "CONVERSION_ENTRADA", label: "Conversion entrada" },
];

// Estados de orden de produccion para el filtro de las pestañas de procesos.
const ORDER_STATUS_OPTIONS: Array<{ value: ProductionRun["status"]; label: string }> = [
  { value: "PENDIENTE_INVENTARIO", label: "Pendiente de inventario" },
  { value: "MATERIALES_APROBADOS", label: "Materiales aprobados" },
  { value: "EN_PROCESO", label: "En proceso" },
  { value: "PENDIENTE_RECEPCION", label: "Pendiente de recepción" },
  { value: "RECIBIDA", label: "Recibida" },
  { value: "CANCELADA", label: "Cancelada" },
];

// Espeja INVENTORY_REVERT_WINDOW_HOURS del backend (el backend valida siempre).
const REVERT_WINDOW_HOURS = 24;

function withinRevertWindow(createdAt: string) {
  const created = new Date(createdAt).getTime();
  return Number.isFinite(created) && Date.now() - created <= REVERT_WINDOW_HOURS * 60 * 60 * 1000;
}
const WEEK_DAYS = ["Lun", "Mar", "Mie", "Jue", "Vie", "Sab", "Dom"];

const emptyItemForm = (): SaveInventoryItemPayload => ({
  item_type: "RAW_MATERIAL",
  name: "",
  description: "",
  unit_code: "g",
  material_type: "",
  purity: "",
});

const emptyMovementForm = (): CreateInventoryMovementPayload => ({
  item_id: "",
  movement_type: "ENTRADA",
  quantity: "",
  unit_cost: "",
  reason: "",
  reference_type: null,
  reference_id: null,
});

type XmlInvoiceDetail = {
  code: string | null;
  description: string;
  quantity: string;
  unitCode: string | null;
};

// Linea de factura en revision: tipo elegible solo si el item no existe aun.
type XmlImportLine = XmlInvoiceDetail & {
  itemType: InventoryItemType;
  existingItem: InventoryItem | null;
};

type XmlImportDraft = {
  fileName: string;
  fileMime: string;
  content: string;
  supplier: string | null;
  invoiceNumber: string;
  accessKey: string | null;
  lines: XmlImportLine[];
};

function itemTypeLabel(type: InventoryItemType) {
  return ITEM_TYPES.find((item) => item.value === type)?.label ?? type;
}

function movementTypeLabel(type: InventoryMovementType) {
  return MOVEMENT_TYPES.find((item) => item.value === type)?.label ?? type;
}

// Signo del movimiento sobre el stock: suma entradas/ingresos/ajustes+ y resta
// salidas/consumos/merma/ajustes-. Base del saldo corrido del kardex.
function movementSign(type: InventoryMovementType) {
  return type === "ENTRADA" || type === "INGRESO_PRODUCCION" || type === "AJUSTE_POSITIVO" || type === "CONVERSION_ENTRADA" ? 1 : -1;
}

function unitLabel(value: string) {
  return UNIT_OPTIONS.find((unit) => unit.value === value)?.label ?? `${value} (detectada)`;
}

function isXmlInvoiceItem(item: InventoryItem) {
  return item.description?.startsWith("Creado desde factura XML.") ?? false;
}

// Dias sin movimientos (con stock agotado) a partir de los cuales se sugiere archivar.
const ARCHIVE_SUGGEST_DAYS = 90;

// Busqueda tolerante: ignora mayusculas y acentos. Cada palabra del termino
// debe aparecer en ALGUN campo del registro (nombre, tipo, SKU, fecha...),
// asi la busqueda funciona sin importar por cual dato empiece el usuario.
function normalizeSearchText(value: string | null | undefined) {
  return (value ?? "").toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
}

function matchesSearchTokens(term: string, fields: Array<string | null | undefined>) {
  const tokens = normalizeSearchText(term).split(/\s+/).filter(Boolean);
  if (tokens.length === 0) return true;
  const haystack = normalizeSearchText(fields.filter(Boolean).join(" "));
  return tokens.every((token) => haystack.includes(token));
}

function numericText(value: string | null) {
  if (!value) return "0";
  const number = Number(value);
  return Number.isFinite(number) ? number.toLocaleString("es-EC", { maximumFractionDigits: 4 }) : value;
}

function moneyText(value: number) {
  return value.toLocaleString("es-EC", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function itemTotalValue(item: InventoryItem) {
  return Number(item.current_stock) * Number(item.average_cost ?? "0");
}

// Nivel de stock: agotado / ok (sin concepto de stock mínimo).
function stockStatus(item: InventoryItem): { level: "ok" | "out"; label: string } {
  if (Number(item.current_stock) <= 0) return { level: "out", label: "Agotado" };
  return { level: "ok", label: "OK" };
}

function dateKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function monthKey(date: Date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  return `${year}-${month}`;
}

function movementDateKey(movement: InventoryMovement) {
  const date = new Date(movement.created_at);
  return Number.isNaN(date.getTime()) ? null : dateKey(date);
}

function buildCalendarDays(selectedMonth: string) {
  const [year, month] = selectedMonth.split("-").map(Number);
  const firstDay = new Date(year, month - 1, 1);
  const daysInMonth = new Date(year, month, 0).getDate();
  const leadingEmptyDays = (firstDay.getDay() + 6) % 7;
  const days: Array<{ key: string; label: string; isEmpty: boolean }> = [];

  for (let index = 0; index < leadingEmptyDays; index += 1) {
    days.push({ key: `empty-${index}`, label: "", isEmpty: true });
  }

  for (let day = 1; day <= daysInMonth; day += 1) {
    days.push({
      key: dateKey(new Date(year, month - 1, day)),
      label: String(day),
      isEmpty: false,
    });
  }

  return days;
}

function getXmlText(parent: Element | Document, selector: string) {
  return parent.querySelector(selector)?.textContent?.trim() || null;
}

function hasParserError(documentXml: Document) {
  return documentXml.getElementsByTagName("parsererror").length > 0;
}

function parseXmlDocument(content: string) {
  const documentXml = new DOMParser().parseFromString(content, "text/xml");
  if (hasParserError(documentXml)) {
    throw new Error("No pudimos leer el archivo. Verifica que sea una factura XML valida.");
  }
  return documentXml;
}

function getInvoiceDocument(content: string) {
  const outerDocument = parseXmlDocument(content);
  const comprobante = getXmlText(outerDocument, "comprobante");
  if (!comprobante) return outerDocument;
  return parseXmlDocument(comprobante);
}

function parseInvoiceDetails(content: string) {
  const invoiceDocument = getInvoiceDocument(content);
  const supplier = getXmlText(invoiceDocument, "infoTributaria > razonSocial") || getXmlText(invoiceDocument, "razonSocial");
  const accessKey = getXmlText(invoiceDocument, "infoTributaria > claveAcceso") || getXmlText(invoiceDocument, "claveAcceso");
  const establishment = getXmlText(invoiceDocument, "infoTributaria > estab");
  const emissionPoint = getXmlText(invoiceDocument, "infoTributaria > ptoEmi");
  const sequential = getXmlText(invoiceDocument, "infoTributaria > secuencial");
  const invoiceNumber = [establishment, emissionPoint, sequential].filter(Boolean).join("-");
  const details = Array.from(invoiceDocument.querySelectorAll("detalle"))
    .map<XmlInvoiceDetail | null>((detail) => {
      const description = getXmlText(detail, "descripcion");
      const quantity = getXmlText(detail, "cantidad");
      const code = getXmlText(detail, "codigoPrincipal");
      const unitCode = getXmlText(detail, "unidadMedida");
      if (!description || !quantity || Number(quantity) <= 0) return null;
      return { code, description, quantity, unitCode };
    })
    .filter((detail): detail is XmlInvoiceDetail => Boolean(detail));

  return { accessKey, details, invoiceNumber, supplier };
}

async function fetchInventoryBundle(canSeeAudit: boolean) {
  const [summary, items, movements, users, runs] = await Promise.all([
    getInventorySummary(),
    listInventoryItems(),
    listInventoryMovements(),
    canSeeAudit ? listUsers() : Promise.resolve([]),
    listProductionRuns(),
  ]);
  return { summary, items, movements, users, runs };
}

export function InventoryDashboard() {
  const xmlInputRef = useRef<HTMLInputElement | null>(null);
  const entryMenuRef = useRef<HTMLDivElement | null>(null);
  const queryClient = useQueryClient();
  const [itemFilter, setItemFilter] = useState<InventoryItemType | "TODOS" | "ORDENES_TERMINADAS">("RAW_MATERIAL");
  // Pastilla deslizante del filtro: sigue a la pestaña activa.
  const segmentedRef = useRef<HTMLDivElement | null>(null);
  const [sliderRect, setSliderRect] = useState<{ left: number; top: number; width: number; height: number } | null>(null);
  useLayoutEffect(() => {
    const measure = () => {
      const active = segmentedRef.current?.querySelector<HTMLButtonElement>(".segmentActive");
      if (active) {
        setSliderRect({ left: active.offsetLeft, top: active.offsetTop, width: active.offsetWidth, height: active.offsetHeight });
      }
    };
    measure();
    window.addEventListener("resize", measure);
    return () => window.removeEventListener("resize", measure);
  }, [itemFilter]);
  const [search, setSearch] = useState("");
  // Panel de filtros avanzados (se abre con el icono junto a la busqueda).
  const [showFilters, setShowFilters] = useState(false);
  const filterMenuRef = useRef<HTMLDivElement | null>(null);
  const [stockFilter, setStockFilter] = useState<"TODOS" | "ok" | "low" | "out">("TODOS");
  const [typeText, setTypeText] = useState("");
  const [descText, setDescText] = useState("");
  const [purityText, setPurityText] = useState("");
  const [orderStatusFilter, setOrderStatusFilter] = useState<"TODOS" | ProductionRun["status"]>("TODOS");
  const [dateFrom, setDateFrom] = useState("");
  const [dateTo, setDateTo] = useState("");
  // Filtro rapido: mostrar solo items en o bajo su stock minimo (KPI clickeable).
  // Grupos de productos terminados expandidos (por nombre de categoria).
  // Drill-down de producto terminado: nivel actual (tipo → categoría → piezas).
  const [drillGroup, setDrillGroup] = useState<string | null>(null);
  const [drillModel, setDrillModel] = useState<string | null>(null);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [isItemFormOpen, setIsItemFormOpen] = useState(false);
  const [isMovementFormOpen, setIsMovementFormOpen] = useState(false);
  const [isEntryMenuOpen, setIsEntryMenuOpen] = useState(false);
  const [isMovementHistoryOpen, setIsMovementHistoryOpen] = useState(false);
  const [historyMonth, setHistoryMonth] = useState(() => monthKey(new Date()));
  // Busqueda global dentro del historial: item, tipo, motivo, usuario, lote o fecha.
  const [historySearch, setHistorySearch] = useState("");
  const [selectedHistoryDate, setSelectedHistoryDate] = useState(() => dateKey(new Date()));
  const [viewingMovement, setViewingMovement] = useState<InventoryMovement | null>(null);
  const [viewingRun, setViewingRun] = useState<ProductionRun | null>(null);
  const [printPreview, setPrintPreview] = useState<{ run: ProductionRun; mode: DocMode } | null>(null);
  const [printingMode, setPrintingMode] = useState<DocMode | null>(null);
  const [itemForm, setItemForm] = useState<SaveInventoryItemPayload>(emptyItemForm);
  const [movementForm, setMovementForm] = useState<CreateInventoryMovementPayload>(emptyMovementForm);
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [viewingItem, setViewingItem] = useState<InventoryItem | null>(null);
  // Borrador de factura XML: se revisa y clasifica cada linea antes de importar.
  const [xmlImportDraft, setXmlImportDraft] = useState<XmlImportDraft | null>(null);
  const [isArchivedOpen, setIsArchivedOpen] = useState(false);
  // Orden cuya etapa actual se consulta (quien avanzo a esa etapa y cuando).
  const [stageInfoRun, setStageInfoRun] = useState<ProductionRun | null>(null);
  // Orden terminada cuyo historial de merma por fase se revisa.
  const [wasteHistoryRun, setWasteHistoryRun] = useState<ProductionRun | null>(null);
  // Orden terminada cuya recepcion se consulta (quien la recibio y cuando).
  const [receptionInfoRun, setReceptionInfoRun] = useState<ProductionRun | null>(null);
  // Conversión de lote de proceso terminado a producto del catálogo.
  const [convertRun, setConvertRun] = useState<ProductionRun | null>(null);
  const [convertForm, setConvertForm] = useState({ material_code: "", product_type_id: "", quantity: "" });
  const [isConverting, setIsConverting] = useState(false);
  const [isKardexOpen, setIsKardexOpen] = useState(false);
  const [isSavingProduction, setIsSavingProduction] = useState(false);
  const [isSolicitudesOpen, setIsSolicitudesOpen] = useState(false);
  const [expandedSolicitudId, setExpandedSolicitudId] = useState<string | null>(null);
  // Confirmaciones por modal (nada de window.confirm); doble confirmacion para borrar.
  const { confirm, dialog: confirmDialog } = useConfirm();
  // Slot del topbar (AppShell) donde se inyecta la bandeja de solicitudes.
  const [topbarSlot, setTopbarSlot] = useState<HTMLElement | null>(null);
  useEffect(() => {
    setTopbarSlot(document.getElementById("topbarSlot"));
  }, []);

  useEffect(() => {
    if (!isAuthenticated()) {
      window.location.href = "/login";
    }
  }, []);

  const { data: currentUser } = useQuery({
    queryKey: ["me"],
    queryFn: getCurrentUser,
    enabled: isAuthenticated(),
  });
  const canSeeAudit = currentUser?.role === "admin" || currentUser?.role === "Admin";

  const {
    data,
    isLoading: isBundleLoading,
    error: bundleError,
  } = useQuery({
    queryKey: ["inventory"],
    queryFn: () => fetchInventoryBundle(canSeeAudit),
    enabled: Boolean(currentUser),
    // Las órdenes nacen en la ventana del jefe de producción: esta vista debe
    // ver solicitudes nuevas sola (sin F5), igual que el badge del menú.
    refetchInterval: 30000,
    refetchOnWindowFocus: true,
  });

  const { data: units = [] } = useQuery({
    queryKey: ["units"],
    queryFn: listUnits,
    enabled: Boolean(currentUser),
  });

  // Segmentos del catalogo para etiquetar modelos (FILIGRANA, VARIOS...).
  const { data: catalogSegments = [] } = useQuery({
    queryKey: ["catalog-segments"],
    queryFn: listCatalogSegments,
    enabled: Boolean(currentUser),
  });

  // Tipos de producto del catálogo para la conversión de lotes.
  const { data: productTypes = [] } = useQuery({
    queryKey: ["product-types"],
    queryFn: listProductTypes,
    enabled: Boolean(currentUser),
  });

  const summary = data?.summary ?? null;
  const items = data?.items ?? [];
  const movements = data?.movements ?? [];
  const users = data?.users ?? [];
  const productionRuns = data?.runs ?? [];
  const isLoading = !currentUser || isBundleLoading;

  useEffect(() => {
    if (bundleError) {
      setError(bundleError instanceof Error ? bundleError.message : "No se pudo cargar inventario.");
    }
  }, [bundleError]);

  useEffect(() => {
    if (items.length === 0) return;
    setMovementForm((current) => ({ ...current, item_id: current.item_id || items[0]?.id || "" }));
  }, [items]);

  // El kardex se abre desde la ficha; al cambiar o cerrar el item vuelve cerrado.
  useEffect(() => {
    setIsKardexOpen(false);
  }, [viewingItem?.id]);

  useEffect(() => {
    if (!error && !success) return;
    const timeout = window.setTimeout(() => {
      setError(null);
      setSuccess(null);
    }, 5000);
    return () => window.clearTimeout(timeout);
  }, [error, success]);

  useEffect(() => {
    if (!isEntryMenuOpen) return;

    function handlePointerDown(event: PointerEvent) {
      const target = event.target;
      if (target instanceof Node && entryMenuRef.current?.contains(target)) return;
      setIsEntryMenuOpen(false);
    }

    document.addEventListener("pointerdown", handlePointerDown);
    return () => document.removeEventListener("pointerdown", handlePointerDown);
  }, [isEntryMenuOpen]);

  // Rango de fechas activo (aplica a las órdenes: recepción / inicio).
  const withinDateRange = (value: string | null | undefined) => {
    if (!dateFrom && !dateTo) return true;
    if (!value) return false;
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return false;
    if (dateFrom && date < new Date(`${dateFrom}T00:00:00`)) return false;
    if (dateTo && date > new Date(`${dateTo}T23:59:59`)) return false;
    return true;
  };
  const anyAdvancedFilter =
    stockFilter !== "TODOS" ||
    typeText.trim() !== "" ||
    descText.trim() !== "" ||
    purityText.trim() !== "" ||
    orderStatusFilter !== "TODOS" ||
    Boolean(dateFrom) ||
    Boolean(dateTo);
  function clearFilters() {
    setStockFilter("TODOS");
    setTypeText("");
    setDescText("");
    setPurityText("");
    setOrderStatusFilter("TODOS");
    setDateFrom("");
    setDateTo("");
  }
  // Cierra el panel de filtros al hacer clic fuera o presionar Escape.
  useEffect(() => {
    if (!showFilters) return;
    function onPointerDown(event: PointerEvent) {
      const target = event.target;
      if (target instanceof Node && filterMenuRef.current?.contains(target)) return;
      setShowFilters(false);
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setShowFilters(false);
    }
    document.addEventListener("pointerdown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("pointerdown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [showFilters]);

  // Opciones de los combos Tipo y Pureza: valores distintos de los items del
  // tipo activo (materia prima, insumos, terminados...). Vacio = todos.
  const typeOptions = useMemo(() => {
    const set = new Set<string>();
    for (const item of items) {
      if (item.archived_at) continue;
      if (itemFilter !== "TODOS" && item.item_type !== itemFilter) continue;
      // Solo el metal/tipo (Oro, Plata). La ley (18K/925) va en el combo Pureza.
      if (item.material_type?.trim()) set.add(item.material_type.trim());
    }
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [items, itemFilter]);
  const purityOptions = useMemo(() => {
    const set = new Set<string>();
    for (const item of items) {
      if (item.archived_at) continue;
      if (itemFilter !== "TODOS" && item.item_type !== itemFilter) continue;
      if (item.purity?.trim()) set.add(item.purity.trim());
    }
    return [...set].sort((a, b) => a.localeCompare(b));
  }, [items, itemFilter]);

  const filteredItems = useMemo(() => {
    const desc = descText.trim().toLowerCase();
    return items.filter((item) => {
      // Archivados fuera del inventario activo; se consultan en su propio panel.
      if (item.archived_at) return false;
      const matchesType = itemFilter === "TODOS" || item.item_type === itemFilter;
      // Busqueda descentralizada: cualquier dato visible del item cuenta.
      const matchesSearch = matchesSearchTokens(search, [
        item.name,
        item.sku,
        item.material_type,
        item.purity,
        item.description,
        item.product_code,
        item.unit_code,
        itemTypeLabel(item.item_type),
        stockStatus(item).label,
      ]);
      const matchesStock = stockFilter === "TODOS" || stockStatus(item).level === stockFilter;
      const matchesTypeSel = !typeText || item.material_type === typeText;
      const matchesDesc = !desc || (item.description ?? "").toLowerCase().includes(desc);
      const matchesPuritySel = !purityText || item.purity === purityText;
      return matchesType && matchesSearch && matchesStock && matchesTypeSel && matchesDesc && matchesPuritySel;
    });
  }, [items, itemFilter, search, stockFilter, typeText, descText, purityText]);
  // Valor total de la materia prima listada: suma de stock x costo promedio.
  // Se muestra como fila de total en la columna "Valor total" de esa pestaña.
  const rawMaterialsValue = useMemo(
    () =>
      items
        .filter((item) => item.item_type === "RAW_MATERIAL")
        .reduce((total, item) => total + itemTotalValue(item), 0),
    [items],
  );
  // Mismo total para la pestaña de insumos.
  const suppliesValue = useMemo(
    () =>
      items
        .filter((item) => item.item_type === "SUPPLY")
        .reduce((total, item) => total + itemTotalValue(item), 0),
    [items],
  );
  // Kardex del item abierto: sus movimientos con saldo corrido (mas reciente
  // primero). El saldo se calcula en orden cronologico ascendente.
  const viewingItemKardex = useMemo(() => {
    if (!viewingItem) return [] as Array<{ movement: InventoryMovement; balanceAfter: number }>;
    const ascending = movements
      .filter((movement) => movement.item_id === viewingItem.id)
      .sort((left, right) => new Date(left.created_at).getTime() - new Date(right.created_at).getTime());
    let balance = 0;
    const withBalance = ascending.map((movement) => {
      balance += movementSign(movement.movement_type) * Number(movement.quantity);
      return { movement, balanceAfter: balance };
    });
    return withBalance.reverse();
  }, [movements, viewingItem]);
  const unitOptions = useMemo(() => {
    // Base dinamica: unidades gestionadas desde Mantenimiento > Datos. Si aun no
    // cargan, cae a las unidades por defecto para no dejar el combo vacio.
    // El item guarda la ABREVIATURA (unit.code, ej. "g"); el combo la muestra
    // por su nombre (unit.label, ej. "Gramos"). Asi el inventario muestra "50 g".
    const base = units.length > 0
      ? units.map((unit) => ({ value: unit.code, label: `${unit.label} (${unit.code})` }))
      : [...UNIT_OPTIONS];
    const options = [...base];
    for (const unitCode of [itemForm.unit_code, ...items.map((item) => item.unit_code)]) {
      if (unitCode && !options.some((option) => option.value === unitCode)) {
        options.push({ value: unitCode, label: unitCode });
      }
    }
    return options;
  }, [itemForm.unit_code, items, units]);

  const usersById = useMemo(() => new Map(users.map((user) => [user.id, user])), [users]);
  const canSeeMovementAudit = currentUser?.role === "admin" || currentUser?.role === "Admin";
  const editingItem = editingItemId ? items.find((item) => item.id === editingItemId) ?? null : null;
  const isEditingXmlItem = editingItem ? isXmlInvoiceItem(editingItem) : false;
  // Salidas: productos terminados. Entradas: materia prima e insumos.
  const movementItemTypes: InventoryItemType[] =
    movementForm.movement_type === "SALIDA" ? ["FINISHED_PRODUCT"] : ["RAW_MATERIAL", "SUPPLY"];
  const movementItems = useMemo(
    () => items.filter((item) => !item.archived_at && movementItemTypes.includes(item.item_type)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [items, movementForm.movement_type],
  );
  const archivedItems = useMemo(
    () =>
      items
        .filter((item) => item.archived_at)
        .sort((left, right) => (right.archived_at ?? "").localeCompare(left.archived_at ?? "")),
    [items],
  );
  // Fecha del ultimo movimiento por item: base para sugerir archivado de
  // items agotados sin actividad reciente.
  const lastMovementByItem = useMemo(() => {
    const map = new Map<string, number>();
    for (const movement of movements) {
      const time = new Date(movement.created_at).getTime();
      if (!Number.isNaN(time)) map.set(movement.item_id, Math.max(map.get(movement.item_id) ?? 0, time));
    }
    return map;
  }, [movements]);

  // Todo item agotado se puede archivar; si ademas lleva meses sin movimiento,
  // el tooltip lo sugiere explicitamente.
  function canArchive(item: InventoryItem) {
    return !item.archived_at && Number(item.current_stock) <= 0;
  }

  // Peso actual de una orden en proceso: ultimo peso final registrado en sus
  // etapas; si aun no hay, el peso inicial mas reciente; si nada, el material
  // total entregado a la orden.
  function runCurrentWeight(run: ProductionRun) {
    const stages = [...run.stages].sort((left, right) => left.stage_order - right.stage_order);
    let weight: string | null = null;
    for (const stage of stages) {
      if (stage.initial_weight) weight = stage.initial_weight;
      if (stage.final_weight) weight = stage.final_weight;
    }
    return weight ?? run.total_required_material;
  }

  // Merma acumulada: suma de la merma registrada etapa por etapa.
  function runCurrentWaste(run: ProductionRun) {
    return run.stages.reduce((total, stage) => total + Number(stage.waste_weight ?? "0"), 0);
  }

  function runCurrentStage(run: ProductionRun) {
    return (
      run.stages.find((stage) => stage.status === "EN_PROCESO") ??
      run.stages.find((stage) => stage.status === "PENDIENTE") ??
      null
    );
  }

  function archiveSuggestion(item: InventoryItem) {
    if (!canArchive(item)) return null;
    const lastMovement = lastMovementByItem.get(item.id);
    if (!lastMovement) return null;
    const days = Math.floor((Date.now() - lastMovement) / 86_400_000);
    if (days < ARCHIVE_SUGGEST_DAYS) return null;
    return `Agotado y sin movimientos hace ${Math.floor(days / 30)} meses`;
  }
  const sortedMovements = useMemo(
    () => [...movements].sort((left, right) => new Date(right.created_at).getTime() - new Date(left.created_at).getTime()),
    [movements],
  );
  const movementCountsByDate = useMemo(() => {
    return sortedMovements.reduce<Map<string, number>>((counts, movement) => {
      const key = movementDateKey(movement);
      if (!key) return counts;
      counts.set(key, (counts.get(key) ?? 0) + 1);
      return counts;
    }, new Map());
  }, [sortedMovements]);
  const selectedDateMovements = useMemo(
    () => sortedMovements.filter((movement) => movementDateKey(movement) === selectedHistoryDate),
    [selectedHistoryDate, sortedMovements],
  );
  const calendarDays = useMemo(() => buildCalendarDays(historyMonth), [historyMonth]);
  const historyMonthLabel = useMemo(() => {
    const [year, month] = historyMonth.split("-").map(Number);
    return new Date(year, month - 1, 1).toLocaleDateString("es-EC", { month: "long", year: "numeric" });
  }, [historyMonth]);

  function movementActorName(userId: string | null) {
    if (!userId) return "Sistema";
    const user = usersById.get(userId);
    if (!user) return "Usuario no disponible";
    return `${user.first_name} ${user.last_name}`.trim() || user.username || user.email;
  }

  function movementTimeLabel(value: string) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "";
    return date.toLocaleTimeString("es-EC", { hour: "2-digit", minute: "2-digit" });
  }

  function movementDateLabel(value: string) {
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "Sin fecha";
    return date.toLocaleDateString("es-EC", { day: "2-digit", month: "long", year: "numeric" });
  }

  // Resultados globales del buscador del historial: cruza item, tipo de
  // movimiento, motivo, usuario, lote, unidad y fecha (texto o 2026-07-16).
  const historySearchActive = historySearch.trim().length > 0;
  const historySearchResults = useMemo(() => {
    if (!historySearchActive) return [] as InventoryMovement[];
    return sortedMovements.filter((movement) =>
      matchesSearchTokens(historySearch, [
        movement.item.name,
        movement.item.sku,
        movement.item.material_type,
        itemTypeLabel(movement.item.item_type),
        movementTypeLabel(movement.movement_type),
        movement.reason,
        movement.lot_code,
        movement.created_by_name,
        movement.unit_code,
        movementDateLabel(movement.created_at),
        movementDateKey(movement),
      ]),
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [historySearch, historySearchActive, sortedMovements]);

  function moveHistoryMonth(direction: -1 | 1) {
    const [year, month] = historyMonth.split("-").map(Number);
    const nextDate = new Date(year, month - 1 + direction, 1);
    const nextMonth = monthKey(nextDate);
    setHistoryMonth(nextMonth);
    const firstMovementDate = sortedMovements.find((movement) => movementDateKey(movement)?.startsWith(nextMonth));
    setSelectedHistoryDate(firstMovementDate ? movementDateKey(firstMovementDate) ?? `${nextMonth}-01` : `${nextMonth}-01`);
  }

  function productionTimeLabel(value: string | null | undefined) {
    if (!value) return "—";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "—";
    return date.toLocaleString("es-EC", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
  }

  async function handleApproveMaterials(run: ProductionRun) {
    setError(null);
    setIsSavingProduction(true);
    try {
      const updated = await approveProductionRunMaterials(run.id);
      setSuccess("Salida de materia prima aprobada. Produccion ya puede iniciar.");
      const nextRuns = await listProductionRuns();
      const remaining = nextRuns.filter((r) => r.status === "PENDIENTE_INVENTARIO" || r.status === "PENDIENTE_RECEPCION").length;
      if (remaining === 0) {
        setIsSolicitudesOpen(false);
      }
      void queryClient.invalidateQueries({ queryKey: ["inventory"] });
      void queryClient.invalidateQueries({ queryKey: ["solicitudes"] });
      setPrintPreview({ run: updated, mode: "entrega" });
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "No se pudo aprobar la salida de materia prima.");
    } finally {
      setIsSavingProduction(false);
    }
  }

  async function handleRejectMaterials(run: ProductionRun) {
    const reason = window.prompt("Motivo del rechazo (opcional):", "");
    if (reason === null) return;
    setError(null);
    setIsSavingProduction(true);
    try {
      await rejectProductionRunMaterials(run.id, reason);
      setSuccess("Solicitud rechazada. La orden fue cancelada.");
      const nextRuns = await listProductionRuns();
      const remaining = nextRuns.filter((r) => r.status === "PENDIENTE_INVENTARIO" || r.status === "PENDIENTE_RECEPCION").length;
      if (remaining === 0) {
        setIsSolicitudesOpen(false);
      }
      void queryClient.invalidateQueries({ queryKey: ["inventory"] });
      void queryClient.invalidateQueries({ queryKey: ["solicitudes"] });
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "No se pudo rechazar la solicitud.");
    } finally {
      setIsSavingProduction(false);
    }
  }

  async function handleReceiveFinishedProduct(run: ProductionRun) {
    setError(null);
    setIsSavingProduction(true);
    try {
      const updated = await receiveProductionRunFinishedProduct(run.id);
      setSuccess("Producto terminado recibido en inventario.");
      const nextRuns = await listProductionRuns();
      const remaining = nextRuns.filter((r) => r.status === "PENDIENTE_INVENTARIO" || r.status === "PENDIENTE_RECEPCION").length;
      if (remaining === 0) {
        setIsSolicitudesOpen(false);
      }
      void queryClient.invalidateQueries({ queryKey: ["inventory"] });
      void queryClient.invalidateQueries({ queryKey: ["solicitudes"] });
      setPrintPreview({ run: updated, mode: "recepcion" });
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "No se pudo recibir el producto terminado.");
    } finally {
      setIsSavingProduction(false);
    }
  }

  async function handleConvertLot(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!convertRun) return;
    const lotItem = items.find((item) => item.sku === convertRun.production_code) ?? null;
    if (!lotItem) {
      setError("No se encontró el lote de esta orden en el inventario.");
      return;
    }
    setError(null);
    setIsConverting(true);
    try {
      await convertLotToProduct(lotItem.id, {
        material_code: convertForm.material_code,
        product_type_id: convertForm.product_type_id,
        quantity: convertForm.quantity,
      });
      setSuccess("Lote convertido en productos terminados.");
      setConvertRun(null);
      setConvertForm({ material_code: "", product_type_id: "", quantity: "" });
      await queryClient.invalidateQueries({ queryKey: ["inventory"] });
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "No se pudo convertir el lote.");
    } finally {
      setIsConverting(false);
    }
  }

  const pendingInventoryRuns = productionRuns.filter((run) => run.status === "PENDIENTE_INVENTARIO");
  const pendingReceptionRuns = productionRuns.filter((run) => run.status === "PENDIENTE_RECEPCION");
  const receivedRuns = productionRuns.filter((run) => run.status === "RECIBIDA");
  const inProcessRuns = productionRuns.filter((run) => run.status === "EN_PROCESO");
  // Órdenes tras aplicar los filtros de fecha y estado (pestañas de procesos).
  const receivedRunsFiltered = receivedRuns.filter(
    (run) => (orderStatusFilter === "TODOS" || run.status === orderStatusFilter) && withinDateRange(run.received_at),
  );
  const inProcessRunsFiltered = inProcessRuns.filter(
    (run) => (orderStatusFilter === "TODOS" || run.status === orderStatusFilter) && withinDateRange(run.started_at ?? run.requested_at),
  );
  const receivedCodes = new Set(receivedRuns.map((run) => run.production_code).filter(Boolean) as string[]);
  // En "Producto terminado": las órdenes recibidas se muestran como filas (con id OP);
  // ocultamos el item de stock auto-creado con ese mismo código para no duplicar.
  const displayItems =
    itemFilter === "FINISHED_PRODUCT" ? filteredItems.filter((item) => !receivedCodes.has(item.sku)) : filteredItems;

  // Grupos por nombre (categoria) y dentro por modelo de catalogo
  // (product_code = material+categoria+modelo); la descripcion es la variante.
  const finishedGroups = useMemo(() => {
    const modelLabels = new Map<string, string>();
    for (const segment of catalogSegments) {
      if (segment.kind === "MODEL" && segment.parent_code) {
        modelLabels.set(`${segment.parent_code}${segment.code}`, segment.label);
      }
    }
    const map = new Map<string, InventoryItem[]>();
    for (const item of displayItems) {
      const list = map.get(item.name);
      if (list) list.push(item);
      else map.set(item.name, [item]);
    }
    const groups = [...map.entries()].map(([name, groupItems]) => {
      const sorted = [...groupItems].sort((a, b) => a.sku.localeCompare(b.sku));
      const byModel = new Map<string, InventoryItem[]>();
      for (const item of sorted) {
        const pcode = item.product_code ?? "";
        const list = byModel.get(pcode);
        if (list) list.push(item);
        else byModel.set(pcode, [item]);
      }
      const models = [...byModel.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([pcode, modelItems]) => ({
          pcode,
          // material(1)+categoria(2)+modelo(4): el label sale de categoria+modelo.
          label: pcode.length === 7 ? modelLabels.get(pcode.slice(1)) ?? "SIN MODELO" : "SIN MODELO",
          items: modelItems,
          totalStock: modelItems.reduce((acc, it) => acc + Number(it.current_stock), 0),
        }));
      return {
        name,
        categoryCode: sorted[0]?.product_code?.slice(1, 3) ?? "—",
        models,
        pieceCount: sorted.length,
        totalStock: sorted.reduce((acc, it) => acc + Number(it.current_stock), 0),
        unitCode: sorted[0]?.unit_code ?? "g",
      };
    });
    // Orden fijo por codigo de tipo (#01, #02, ...), no alfabetico por nombre.
    return groups.sort((a, b) => a.categoryCode.localeCompare(b.categoryCode) || a.name.localeCompare(b.name));
  }, [displayItems, catalogSegments]);
  const searchActive = search.trim().length > 0;
  const drilledGroup = finishedGroups.find((g) => g.name === drillGroup) ?? null;
  const drilledModel = drilledGroup?.models.find((m) => m.pcode === drillModel) ?? null;

  // Paginación de listados: reemplaza el scroll interno de los paneles.
  // Pestañas del panel principal: 10 por página (llenan el recuadro fijo).
  // Movimientos, kardex e historial: de 3 en 3.
  const TAB_PAGE_SIZE = 10;
  const MOVEMENTS_PAGE_SIZE = 3;
  // Clave de reinicio de paginación: incluye los filtros para volver a la
  // primera página cuando cambian.
  const filterKey = `${itemFilter}|${search}|${stockFilter}|${typeText}|${descText}|${purityText}|${orderStatusFilter}|${dateFrom}|${dateTo}`;
  const rawItemsPager = usePagination(displayItems, TAB_PAGE_SIZE, filterKey);
  const finishedTypesPager = usePagination(finishedGroups, TAB_PAGE_SIZE, filterKey);
  const finishedCatsPager = usePagination(drilledGroup?.models ?? [], TAB_PAGE_SIZE, drillGroup ?? "");
  const piecesPager = usePagination(
    searchActive ? displayItems : drilledModel?.items ?? [],
    TAB_PAGE_SIZE,
    `${drillGroup ?? ""}|${drillModel ?? ""}|${search}`,
  );
  const receivedRunsPager = usePagination(receivedRunsFiltered, TAB_PAGE_SIZE, filterKey);
  const wipRows = [
    ...inProcessRunsFiltered.map((run) => ({ kind: "run" as const, run, item: null })),
    ...displayItems.map((item) => ({ kind: "item" as const, run: null, item })),
  ];
  const wipPager = usePagination(wipRows, TAB_PAGE_SIZE, filterKey);
  // Últimos movimientos de todo el inventario, sin filtro por pestaña ni fecha.
  const movementsPager = usePagination(sortedMovements, MOVEMENTS_PAGE_SIZE);
  const kardexPager = usePagination(viewingItemKardex, MOVEMENTS_PAGE_SIZE, viewingItem?.id ?? "");
  // Archivados: 5 por página dentro del modal; vuelve a la primera al abrir.
  const archivedPager = usePagination(archivedItems, 5, String(isArchivedOpen));
  // Lineas de factura XML en revision: 5 por página dentro del modal.
  const xmlLinesPager = usePagination(xmlImportDraft?.lines ?? [], 5, xmlImportDraft?.fileName ?? "");
  // Etapas del historial de merma: en orden de proceso, 5 por página.
  const wasteStages = useMemo(
    () => (wasteHistoryRun ? [...wasteHistoryRun.stages].sort((left, right) => left.stage_order - right.stage_order) : []),
    [wasteHistoryRun],
  );
  const historyDayPager = usePagination(selectedDateMovements, MOVEMENTS_PAGE_SIZE, selectedHistoryDate);
  const historyResultsPager = usePagination(historySearchResults, MOVEMENTS_PAGE_SIZE, historySearch);

  const docItemNames = useMemo(() => buildItemNameMap(items), [items]);

  useEffect(() => {
    if (!printingMode) return;
    const timer = setTimeout(() => {
      window.print();
      setPrintingMode(null);
    }, 60);
    return () => clearTimeout(timer);
  }, [printingMode]);

  function openMovementHistory() {
    const firstMovement = sortedMovements[0];
    const firstDateKey = firstMovement ? movementDateKey(firstMovement) : dateKey(new Date());
    setSelectedHistoryDate(firstDateKey ?? dateKey(new Date()));
    setHistoryMonth((firstDateKey ?? dateKey(new Date())).slice(0, 7));
    setHistorySearch("");
    setIsMovementHistoryOpen(true);
  }

  function openCreateItem() {
    setEditingItemId(null);
    setItemForm(emptyItemForm());
    setIsItemFormOpen(true);
  }

  function openManualEntry() {
    // Preselecciona un item del tipo de la pestaña activa (materia prima o insumo).
    const entryType = itemFilter === "SUPPLY" ? "SUPPLY" : "RAW_MATERIAL";
    const firstItem = items.find((item) => item.item_type === entryType);
    setMovementForm({ ...emptyMovementForm(), item_id: firstItem?.id || "", movement_type: "ENTRADA" });
    setIsMovementFormOpen(true);
    setIsEntryMenuOpen(false);
  }

  function openFinishedProductExit() {
    const firstFinishedProduct = items.find((item) => item.item_type === "FINISHED_PRODUCT");
    setMovementForm({ ...emptyMovementForm(), item_id: firstFinishedProduct?.id || "", movement_type: "SALIDA" });
    setIsMovementFormOpen(true);
  }

  function openXmlInvoiceInput() {
    setIsEntryMenuOpen(false);
    xmlInputRef.current?.click();
  }

  async function handleDeleteItem(item: InventoryItem) {
    const ok = await confirmDelete(confirm, item.material_type ?? item.name);
    if (!ok) return;
    setError(null);
    try {
      await deleteInventoryItem(item.id);
      setSuccess("Materia prima eliminada.");
      await queryClient.invalidateQueries({ queryKey: ["inventory"] });
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo eliminar la materia prima.");
    }
  }

  async function handleRevertLastEntry(item: InventoryItem) {
    const ok = await confirm({
      title: "Revertir último lote",
      message: `¿Revertir la última entrada de lote de "${item.material_type ?? item.name}"? Se ajustarán el stock y el costo promedio.`,
      confirmLabel: "Revertir",
      danger: true,
    });
    if (!ok) return;
    setError(null);
    try {
      const remainingItem = await revertLastEntry(item.id);
      setSuccess(remainingItem ? "Último lote revertido." : "Último lote revertido; el item creado por la factura también se eliminó.");
      setViewingItem(null);
      await queryClient.invalidateQueries({ queryKey: ["inventory"] });
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo revertir el lote.");
    }
  }

  async function handleArchiveItem(item: InventoryItem) {
    const ok = await confirm({
      title: "Archivar item",
      message: `¿Archivar "${item.material_type ?? item.name}"? Se oculta del inventario activo conservando su historial. Una nueva entrada lo reactiva automáticamente.`,
      confirmLabel: "Archivar",
    });
    if (!ok) return;
    setError(null);
    try {
      await archiveInventoryItem(item.id);
      setViewingItem(null);
      setSuccess("Item archivado.");
      await queryClient.invalidateQueries({ queryKey: ["inventory"] });
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo archivar el item.");
    }
  }

  async function handleUnarchiveItem(item: InventoryItem) {
    setError(null);
    try {
      await unarchiveInventoryItem(item.id);
      setSuccess("Item restaurado al inventario activo.");
      await queryClient.invalidateQueries({ queryKey: ["inventory"] });
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo restaurar el item.");
    }
  }

  async function handleDeleteArchivedItem(item: InventoryItem) {
    // Doble confirmacion: borra el item y todo su kardex, sin vuelta atras.
    const ok = await confirmDelete(confirm, item.material_type ?? item.name);
    if (!ok) return;
    setError(null);
    try {
      await deleteInventoryItem(item.id);
      setSuccess("Item eliminado permanentemente junto con su historial.");
      await queryClient.invalidateQueries({ queryKey: ["inventory"] });
    } catch (err) {
      setError(err instanceof Error ? err.message : "No se pudo eliminar el item.");
    }
  }

  async function handleSaveItem(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSaving(true);
    setError(null);
    try {
      const isSupply = itemForm.item_type === "SUPPLY";
      const materialType = itemForm.material_type?.trim() || "";
      if (!isEditingXmlItem && !materialType) {
        setError(isSupply ? "Escribe el nombre del insumo." : "Escribe el tipo de materia prima.");
        setIsSaving(false);
        return;
      }
      const payload = {
        ...itemForm,
        // Para materia prima el nombre ES el tipo (ya no hay campo Nombre aparte);
        // para insumos el campo es directamente el nombre.
        name: isEditingXmlItem ? itemForm.name : materialType,
        description: isEditingXmlItem ? editingItem?.description ?? null : itemForm.description?.trim() || null,
        unit_code: isEditingXmlItem ? editingItem?.unit_code ?? itemForm.unit_code : itemForm.unit_code,
        material_type: isEditingXmlItem ? editingItem?.material_type ?? null : isSupply ? null : materialType,
        purity: isEditingXmlItem ? editingItem?.purity ?? null : isSupply ? null : itemForm.purity?.trim() || null,
      };
      if (editingItemId) {
        await updateInventoryItem(editingItemId, payload);
        setSuccess("Item actualizado correctamente.");
      } else {
        await createInventoryItem(payload);
        setSuccess("Item creado correctamente.");
      }
      setIsItemFormOpen(false);
      await queryClient.invalidateQueries({ queryKey: ["inventory"] });
      // Los selectores de materiales de procesos mezclan materia prima + insumos.
      await queryClient.invalidateQueries({ queryKey: ["process-materials"] });
      await queryClient.invalidateQueries({ queryKey: ["production"] });
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "No se pudo guardar el item.");
    } finally {
      setIsSaving(false);
    }
  }

  async function handleCreateMovement(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSaving(true);
    setError(null);
    try {
      const unitCost =
        movementForm.movement_type === "ENTRADA" && movementForm.unit_cost
          ? movementForm.unit_cost
          : null;
      await createInventoryMovement({
        ...movementForm,
        unit_cost: unitCost,
        // Motivo ya no se pide en el formulario; se usa uno por defecto.
        reason: movementForm.reason?.trim() || "Ingreso de materia prima",
        reference_type: null,
        reference_id: null,
      });
      setSuccess("Movimiento registrado correctamente.");
      setIsMovementFormOpen(false);
      setMovementForm(emptyMovementForm());
      await queryClient.invalidateQueries({ queryKey: ["inventory"] });
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "No se pudo registrar el movimiento.");
    } finally {
      setIsSaving(false);
    }
  }

  async function handleXmlInvoice(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;

    setError(null);
    try {
      const content = await file.text();
      const invoice = parseInvoiceDetails(content);
      if (invoice.details.length === 0) {
        throw new Error("No encontramos productos dentro de esta factura XML.");
      }

      // Pre-clasifica cada linea: si el nombre ya existe en inventario entra a ese
      // item (tipo bloqueado); si es nueva, default segun la pestaña activa.
      const defaultType: InventoryItemType = itemFilter === "SUPPLY" ? "SUPPLY" : "RAW_MATERIAL";
      const lines = invoice.details.map<XmlImportLine>((detail) => {
        const matches = items.filter(
          (candidate) =>
            (candidate.item_type === "RAW_MATERIAL" || candidate.item_type === "SUPPLY") &&
            candidate.name.toLowerCase() === detail.description.toLowerCase(),
        );
        const existingItem = matches.find((candidate) => candidate.item_type === defaultType) ?? matches[0] ?? null;
        return { ...detail, itemType: existingItem?.item_type ?? defaultType, existingItem };
      });

      setIsEntryMenuOpen(false);
      setXmlImportDraft({
        fileName: file.name,
        fileMime: file.type || "application/xml",
        content,
        supplier: invoice.supplier,
        invoiceNumber: invoice.invoiceNumber,
        accessKey: invoice.accessKey,
        lines,
      });
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "No se pudo leer la factura XML.");
    }
  }

  async function handleConfirmXmlImport() {
    if (!xmlImportDraft) return;
    setIsSaving(true);
    setError(null);
    try {
      let imported = 0;
      let nextItems = items;
      for (const line of xmlImportDraft.lines) {
        let item =
          line.existingItem ??
          nextItems.find(
            (candidate) =>
              candidate.item_type === line.itemType &&
              candidate.name.toLowerCase() === line.description.toLowerCase(),
          );
        if (!item) {
          const metadata = [
            "Creado desde factura XML.",
            line.code ? `Codigo factura: ${line.code}.` : null,
            xmlImportDraft.supplier ? `Proveedor: ${xmlImportDraft.supplier}.` : null,
          ].filter(Boolean).join(" ");
          item = await createInventoryItem({
            item_type: line.itemType,
            name: line.description,
            description: metadata,
            unit_code: line.unitCode || "und",
          });
          nextItems = [...nextItems, item];
        }

        const invoiceReference = xmlImportDraft.invoiceNumber || xmlImportDraft.accessKey || xmlImportDraft.fileName;
        await createInventoryMovement({
          item_id: item.id,
          movement_type: "ENTRADA",
          quantity: line.quantity,
          unit_cost: null,
          reason: `Ingreso por factura XML ${invoiceReference}`,
          reference_type: null,
          reference_id: null,
          source_file_name: xmlImportDraft.fileName,
          source_file_mime: xmlImportDraft.fileMime,
          source_file_content: xmlImportDraft.content,
        });
        imported += 1;
      }

      setXmlImportDraft(null);
      setSuccess(`Factura XML importada: ${imported} lineas registradas.`);
      await queryClient.invalidateQueries({ queryKey: ["inventory"] });
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "No se pudo importar la factura XML.");
    } finally {
      setIsSaving(false);
    }
  }

  async function handleDownloadMovementSourceFile(movement: InventoryMovement) {
    if (!movement.source_file_name) return;
    setError(null);
    try {
      const blob = await downloadInventoryMovementSourceFile(movement.id);
      const url = window.URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = url;
      link.download = movement.source_file_name;
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.URL.revokeObjectURL(url);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "No se pudo descargar el XML.");
    }
  }

  return (
    <div className="content">
      {(error || success) ? (
        <div className="toastStack" aria-live="polite" aria-atomic="true">
          {error ? (
            <div className="notice noticeError" key={error}>
              <span className="noticeInner">{error}</span>
              <span className="toastProgressBar" aria-hidden="true" />
            </div>
          ) : null}
          {success ? (
            <div className="notice noticeSuccess" key={success}>
              <span className="noticeInner">{success}</span>
              <span className="toastProgressBar" aria-hidden="true" />
            </div>
          ) : null}
        </div>
      ) : null}

      <section className="summaryGrid" aria-label="Resumen de inventario">
        <article className="card metric">
          <Boxes aria-hidden="true" size={22} />
          <span className="metricLabel">Materia prima</span>
          <strong className="metricValue">{summary?.raw_materials ?? 0}</strong>
        </article>
        <article className="card metric">
          <FlaskConical aria-hidden="true" size={22} />
          <span className="metricLabel">Insumos</span>
          <strong className="metricValue">{summary?.supplies ?? 0}</strong>
        </article>
        <article className="card metric">
          <Boxes aria-hidden="true" size={22} />
          <span className="metricLabel">En proceso</span>
          <strong className="metricValue">{summary?.work_in_progress ?? 0}</strong>
        </article>
        <article className="card metric">
          <Boxes aria-hidden="true" size={22} />
          <span className="metricLabel">Terminados</span>
          <strong className="metricValue">{summary?.finished_products ?? 0}</strong>
        </article>
      </section>

      {topbarSlot
        ? createPortal(
            <button
              className="topbarInbox"
              onClick={() => { setIsSolicitudesOpen(true); setExpandedSolicitudId(null); }}
              type="button"
              aria-label="Bandeja de solicitudes de produccion"
            >
              <Inbox aria-hidden="true" size={18} />
              Solicitudes
              {pendingInventoryRuns.length + pendingReceptionRuns.length > 0 ? (
                <span className="solicitudesBadge">{pendingInventoryRuns.length + pendingReceptionRuns.length}</span>
              ) : null}
            </button>,
            topbarSlot,
          )
        : null}

      <section className="inventoryShell">
        <article className="card panelBody inventoryPanel">
          <div className="panelHeader">
            <div>
              <h2 className="panelTitle">Inventario actual</h2>
              <p className="panelText">
                {itemFilter === "RAW_MATERIAL"
                  ? "Ingresos manuales y facturas XML de materia prima"
                  : itemFilter === "SUPPLY"
                    ? "Quimicos y materiales auxiliares de fabricacion"
                    : itemFilter === "FINISHED_PRODUCT"
                      ? "Salidas comerciales de productos terminados"
                      : itemFilter === "ORDENES_TERMINADAS"
                        ? "Ordenes de produccion recibidas en inventario"
                        : "Seguimiento de productos en proceso"}
              </p>
            </div>
            <div className="rowActions">
              {itemFilter === "RAW_MATERIAL" ? (
                <>
                  <div className="actionMenu" ref={entryMenuRef}>
                    <button className="button" onClick={() => setIsEntryMenuOpen((current) => !current)} type="button">
                      <Plus aria-hidden="true" size={17} />
                      Entrada
                      <ChevronDown aria-hidden="true" size={15} />
                    </button>
                    {isEntryMenuOpen ? (
                      <div className="actionMenuPanel">
                        <button onClick={openManualEntry} type="button">
                          <Plus aria-hidden="true" size={16} />
                          <span>
                            <strong>Manual</strong>
                            <small>Registrar ingreso directo</small>
                          </span>
                        </button>
                        <button onClick={openXmlInvoiceInput} type="button">
                          <Upload aria-hidden="true" size={16} />
                          <span>
                            <strong>Factura XML</strong>
                            <small>Importar lineas de compra</small>
                          </span>
                        </button>
                      </div>
                    ) : null}
                  </div>
                </>
              ) : null}
              {itemFilter === "SUPPLY" ? (
                <div className="actionMenu" ref={entryMenuRef}>
                  <button className="button" onClick={() => setIsEntryMenuOpen((current) => !current)} type="button">
                    <Plus aria-hidden="true" size={17} />
                    Entrada
                    <ChevronDown aria-hidden="true" size={15} />
                  </button>
                  {isEntryMenuOpen ? (
                    <div className="actionMenuPanel">
                      <button onClick={openManualEntry} type="button">
                        <Plus aria-hidden="true" size={16} />
                        <span>
                          <strong>Manual</strong>
                          <small>Registrar ingreso directo</small>
                        </span>
                      </button>
                      <button onClick={openXmlInvoiceInput} type="button">
                        <Upload aria-hidden="true" size={16} />
                        <span>
                          <strong>Factura XML</strong>
                          <small>Importar lineas de compra</small>
                        </span>
                      </button>
                    </div>
                  ) : null}
                </div>
              ) : null}
              {(itemFilter === "RAW_MATERIAL" || itemFilter === "SUPPLY") && archivedItems.length > 0 ? (
                <button className="button" onClick={() => setIsArchivedOpen(true)} type="button">
                  <Inbox aria-hidden="true" size={17} />
                  Archivados ({archivedItems.length})
                </button>
              ) : null}
              {itemFilter === "FINISHED_PRODUCT" ? (
                <button className="button" onClick={openFinishedProductExit} type="button">
                  <Minus aria-hidden="true" size={17} />
                  Salida
                </button>
              ) : null}
              <input accept=".xml,text/xml" hidden onChange={handleXmlInvoice} ref={xmlInputRef} type="file" />
            </div>
          </div>

          <div className="toolbar">
            <div className={`segmentedControl${sliderRect ? " hasSlider" : ""}`} aria-label="Filtrar por tipo" ref={segmentedRef}>
              {sliderRect ? (
                <span
                  aria-hidden="true"
                  className="segmentSlider"
                  style={{
                    height: sliderRect.height,
                    top: 0,
                    left: 0,
                    transform: `translate(${sliderRect.left}px, ${sliderRect.top}px)`,
                    width: sliderRect.width,
                  }}
                />
              ) : null}
              {ITEM_TYPES.map((type) => (
                <button
                  className={itemFilter === type.value ? "segmentActive" : ""}
                  key={type.value}
                  onClick={() => {
                    setIsEntryMenuOpen(false);
                    setItemFilter(type.value);
                  }}
                  type="button"
                >
                  {type.label}
                </button>
              ))}
            </div>
            <div className="searchGroup" ref={filterMenuRef}>
              <input
                className="field searchField"
                onChange={(event) => setSearch(event.target.value)}
                placeholder="Buscar por nombre, tipo, SKU, ley, descripción o estado"
                value={search}
              />
              <button
                className={`iconOnlyButton filterToggle${showFilters || anyAdvancedFilter ? " filterToggleActive" : ""}`}
                onClick={() => setShowFilters((open) => !open)}
                type="button"
                aria-label="Filtros"
                aria-expanded={showFilters}
                title="Filtros"
              >
                <SlidersHorizontal aria-hidden="true" size={17} />
                {anyAdvancedFilter ? <span className="filterDot" aria-hidden="true" /> : null}
              </button>

              {showFilters ? (
                <div className="filterPanel" role="dialog" aria-label="Filtros de inventario">
                  <div className="filterPanelHead">
                    <strong>Filtros</strong>
                    <button className="iconOnlyButton" onClick={() => setShowFilters(false)} type="button" aria-label="Cerrar filtros">
                      <X aria-hidden="true" size={16} />
                    </button>
                  </div>

                  {itemFilter !== "ORDENES_TERMINADAS" ? (
                    <>
                      <label className="filterField">
                        <span>Tipo</span>
                        <select className="field" value={typeText} onChange={(event) => setTypeText(event.target.value)}>
                          <option value="">Todos</option>
                          {typeOptions.map((type) => (
                            <option key={type} value={type}>{type}</option>
                          ))}
                        </select>
                      </label>
                      <label className="filterField">
                        <span>Ley / pureza</span>
                        <select className="field" value={purityText} onChange={(event) => setPurityText(event.target.value)}>
                          <option value="">Todas</option>
                          {purityOptions.map((purity) => (
                            <option key={purity} value={purity}>{purity}</option>
                          ))}
                        </select>
                      </label>
                      <label className="filterField">
                        <span>Descripción</span>
                        <input className="field" value={descText} onChange={(event) => setDescText(event.target.value)} placeholder="Texto en la descripción" />
                      </label>
                      <label className="filterField">
                        <span>Estado de stock</span>
                        <select className="field" value={stockFilter} onChange={(event) => setStockFilter(event.target.value as typeof stockFilter)}>
                          <option value="TODOS">Todos</option>
                          <option value="ok">OK</option>
                          <option value="low">Bajo</option>
                          <option value="out">Agotado</option>
                        </select>
                      </label>
                    </>
                  ) : null}

                  {itemFilter === "ORDENES_TERMINADAS" || itemFilter === "WORK_IN_PROGRESS" ? (
                    <>
                      <label className="filterField">
                        <span>Estado de orden</span>
                        <select className="field" value={orderStatusFilter} onChange={(event) => setOrderStatusFilter(event.target.value as typeof orderStatusFilter)}>
                          <option value="TODOS">Todos</option>
                          {ORDER_STATUS_OPTIONS.map((status) => (
                            <option key={status.value} value={status.value}>{status.label}</option>
                          ))}
                        </select>
                      </label>
                      <label className="filterField">
                        <span>Desde</span>
                        <input className="field" type="date" value={dateFrom} max={dateTo || undefined} onChange={(event) => setDateFrom(event.target.value)} />
                      </label>
                      <label className="filterField">
                        <span>Hasta</span>
                        <input className="field" type="date" value={dateTo} min={dateFrom || undefined} onChange={(event) => setDateTo(event.target.value)} />
                      </label>
                    </>
                  ) : null}

                  <div className="filterPanelActions">
                    <button className="button" onClick={clearFilters} type="button" disabled={!anyAdvancedFilter}>
                      <X aria-hidden="true" size={14} />
                      Limpiar
                    </button>
                    <button className="button buttonPrimary" onClick={() => setShowFilters(false)} type="button">
                      Aplicar
                    </button>
                  </div>
                </div>
              ) : null}
            </div>
          </div>

          {itemFilter === "RAW_MATERIAL" ? (
            <div className="tableWrap">
              <table className="table inventoryItemsTable">
                <thead>
                  <tr>
                    <th className="num" style={{ width: 40 }}>#</th>
                    <th>Tipo</th>
                    <th>Descripción</th>
                    <th>Ley/pureza</th>
                    <th className="num">Stock</th>
                    <th>Estado</th>
                    <th className="num">Costo promedio</th>
                    <th className="num">Valor total</th>
                    <th aria-label="Acciones" />
                  </tr>
                </thead>
                <tbody>
                  {rawItemsPager.pageItems.map((item, index) => {
                    const averageCost = item.average_cost ?? "0";
                    const totalValue = Number(item.current_stock) * Number(averageCost);
                    const status = stockStatus(item);
                    const suggestion = archiveSuggestion(item);
                    return (
                      <tr key={item.id}>
                        <td className="num">{rawItemsPager.page * rawItemsPager.pageSize + index + 1}</td>
                        <td>{item.material_type ?? item.name}</td>
                        <td>{item.description ?? "—"}</td>
                        <td>{item.purity ?? "—"}</td>
                        <td className="num">{numericText(item.current_stock)} {item.unit_code}</td>
                        <td><span className={`stockBadge stockBadge--${status.level}`}>{status.label}</span></td>
                        <td className="num">$ {numericText(averageCost)}</td>
                        <td className="num">$ {numericText(String(totalValue))}</td>
                        <td>
                          <div className="rowActions">
                            {canArchive(item) ? (
                              <button
                                className={`iconTextButton${suggestion ? " archiveSuggested" : ""}`}
                                onClick={() => void handleArchiveItem(item)}
                                title={suggestion ?? "Archivar item agotado"}
                                type="button"
                              >
                                <Inbox aria-hidden="true" size={15} />
                                Archivar
                              </button>
                            ) : null}
                            <button className="iconTextButton" onClick={() => setViewingItem(item)} type="button">
                              <Eye aria-hidden="true" size={15} />
                              Visualizar
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                  {!isLoading && displayItems.length === 0 ? (
                    <tr>
                      <td colSpan={9}>
                        <div className="emptyState">No hay items para este filtro.</div>
                      </td>
                    </tr>
                  ) : null}
                  {isLoading ? (
                    <tr>
                      <td colSpan={9}>
                        <div className="emptyState">Cargando inventario...</div>
                      </td>
                    </tr>
                  ) : null}
                </tbody>
                {!isLoading && displayItems.length > 0 ? (
                  <tfoot>
                    <tr className="totalRow">
                      <td colSpan={7}>Valor total de materia prima</td>
                      <td className="num">$ {moneyText(rawMaterialsValue)}</td>
                      <td />
                    </tr>
                  </tfoot>
                ) : null}
              </table>
              <Pager {...rawItemsPager} />
            </div>
          ) : itemFilter === "SUPPLY" ? (
            <div className="tableWrap">
              <table className="table inventoryItemsTable">
                <thead>
                  <tr>
                    <th className="num" style={{ width: 40 }}>#</th>
                    <th>Insumo</th>
                    <th>Descripción</th>
                    <th className="num">Stock</th>
                    <th>Estado</th>
                    <th className="num">Costo promedio</th>
                    <th className="num">Valor total</th>
                    <th aria-label="Acciones" />
                  </tr>
                </thead>
                <tbody>
                  {rawItemsPager.pageItems.map((item, index) => {
                    const averageCost = item.average_cost ?? "0";
                    const totalValue = Number(item.current_stock) * Number(averageCost);
                    const status = stockStatus(item);
                    const suggestion = archiveSuggestion(item);
                    return (
                      <tr key={item.id}>
                        <td className="num">{rawItemsPager.page * rawItemsPager.pageSize + index + 1}</td>
                        <td>{item.name}</td>
                        <td>{item.description ?? "—"}</td>
                        <td className="num">{numericText(item.current_stock)} {item.unit_code}</td>
                        <td><span className={`stockBadge stockBadge--${status.level}`}>{status.label}</span></td>
                        <td className="num">$ {numericText(averageCost)}</td>
                        <td className="num">$ {numericText(String(totalValue))}</td>
                        <td>
                          <div className="rowActions">
                            {canArchive(item) ? (
                              <button
                                className={`iconTextButton${suggestion ? " archiveSuggested" : ""}`}
                                onClick={() => void handleArchiveItem(item)}
                                title={suggestion ?? "Archivar item agotado"}
                                type="button"
                              >
                                <Inbox aria-hidden="true" size={15} />
                                Archivar
                              </button>
                            ) : null}
                            <button className="iconTextButton" onClick={() => setViewingItem(item)} type="button">
                              <Eye aria-hidden="true" size={15} />
                              Visualizar
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                  {!isLoading && displayItems.length === 0 ? (
                    <tr><td colSpan={8}><div className="emptyState">Sin insumos registrados. Crea el primero.</div></td></tr>
                  ) : null}
                  {isLoading ? (
                    <tr><td colSpan={8}><div className="emptyState">Cargando inventario...</div></td></tr>
                  ) : null}
                </tbody>
                {!isLoading && displayItems.length > 0 ? (
                  <tfoot>
                    <tr className="totalRow">
                      <td colSpan={6}>Valor total de insumos</td>
                      <td className="num">$ {moneyText(suppliesValue)}</td>
                      <td />
                    </tr>
                  </tfoot>
                ) : null}
              </table>
              <Pager {...rawItemsPager} />
            </div>
          ) : itemFilter === "FINISHED_PRODUCT" ? (
            <div style={{ display: "flex", flexDirection: "column", flex: "1 1 auto", gap: 10, minHeight: 0 }}>
              {drilledGroup ? (
                <div className="drillBar">
                  <button
                    className="button"
                    onClick={() => (drilledModel ? setDrillModel(null) : setDrillGroup(null))}
                    type="button"
                  >
                    <ChevronLeft aria-hidden="true" size={15} /> Volver
                  </button>
                  <span className="drillCrumbs">
                    <button onClick={() => { setDrillGroup(null); setDrillModel(null); }} type="button">Productos</button>
                    <span className="drillCrumbSep">/</span>
                    {drilledModel ? (
                      <>
                        <button onClick={() => setDrillModel(null)} type="button">{drilledGroup.name}</button>
                        <span className="drillCrumbSep">/</span>
                        <span>{drilledModel.label}</span>
                      </>
                    ) : (
                      <span>{drilledGroup.name}</span>
                    )}
                  </span>
                </div>
              ) : null}

              {searchActive || drilledModel ? (
                // Nivel piezas (o búsqueda global): headers de pieza.
                <div className="tableWrap">
                  <table className="table inventoryItemsTable tableAuto">
                    <thead>
                      <tr>
                        <th>Lote</th>
                        <th>Descripción</th>
                        <th>Metal principal</th>
                        <th>Ley/pureza</th>
                        <th className="num">Stock</th>
                        <th aria-label="Acciones" />
                      </tr>
                    </thead>
                    <tbody>
                      {piecesPager.pageItems.map((item) => (
                        <tr key={item.id}>
                          <td>{item.sku}</td>
                          <td>{item.description ?? "—"}</td>
                          <td>{item.material_type ?? "—"}</td>
                          <td>{item.purity ?? "—"}</td>
                          <td className="num">{numericText(item.current_stock)} {item.unit_code}</td>
                          <td>
                            <div className="rowActions">
                              <button className="iconTextButton" onClick={(event) => { event.stopPropagation(); setViewingItem(item); }} type="button">
                                <Eye aria-hidden="true" size={15} />
                                Visualizar
                              </button>
                            </div>
                          </td>
                        </tr>
                      ))}
                      {searchActive && displayItems.length === 0 ? (
                        <tr><td colSpan={6}><div className="emptyState">Sin resultados para la búsqueda.</div></td></tr>
                      ) : null}
                    </tbody>
                  </table>
                  <Pager {...piecesPager} />
                </div>
              ) : drilledGroup ? (
                // Nivel categorías del tipo elegido: headers de categoría.
                <div className="tableWrap">
                  <table className="table inventoryItemsTable tableAuto">
                    <thead>
                      <tr>
                        <th>#</th>
                        <th>Categoría</th>
                        <th className="num">Piezas</th>
                        <th className="num">Stock</th>
                        <th aria-label="Abrir" />
                      </tr>
                    </thead>
                    <tbody>
                      {finishedCatsPager.pageItems.map((model) => (
                        <tr key={model.pcode} onClick={() => setDrillModel(model.pcode)} style={{ cursor: "pointer" }}>
                          <td><span className={`orderCodeTag${metalTagClass(model.pcode)}`}>#{model.pcode || "—"}</span></td>
                          <td><strong>{model.label}</strong></td>
                          <td className="num">{model.items.length}</td>
                          <td className="num">{numericText(String(model.totalStock))} {drilledGroup.unitCode}</td>
                          <td style={{ textAlign: "right" }}><ChevronRight aria-hidden="true" size={15} /></td>
                        </tr>
                      ))}
                      {drilledGroup.models.length === 0 ? (
                        <tr><td colSpan={5}><div className="emptyState">Este tipo aún no tiene piezas en inventario.</div></td></tr>
                      ) : null}
                    </tbody>
                  </table>
                  <Pager {...finishedCatsPager} />
                </div>
              ) : (
                // Nivel tipos: headers de tipo.
                <div className="tableWrap">
                  <table className="table inventoryItemsTable tableAuto">
                    <thead>
                      <tr>
                        <th>#</th>
                        <th>Tipo</th>
                        <th className="num">Categorías</th>
                        <th className="num">Stock</th>
                        <th aria-label="Abrir" />
                      </tr>
                    </thead>
                    <tbody>
                      {finishedTypesPager.pageItems.map((group) => (
                        <tr key={group.name} onClick={() => setDrillGroup(group.name)} style={{ cursor: "pointer" }}>
                          <td><span className="orderCodeTag">#{group.categoryCode}</span></td>
                          <td><strong>{group.name}</strong></td>
                          <td className="num">{group.models.length}</td>
                          <td className="num">{numericText(String(group.totalStock))} {group.unitCode}</td>
                          <td style={{ textAlign: "right" }}><ChevronRight aria-hidden="true" size={15} /></td>
                        </tr>
                      ))}
                      {!isLoading && finishedGroups.length === 0 ? (
                        <tr><td colSpan={5}><div className="emptyState">No hay productos terminados.</div></td></tr>
                      ) : null}
                      {isLoading ? (
                        <tr><td colSpan={5}><div className="emptyState">Cargando inventario...</div></td></tr>
                      ) : null}
                    </tbody>
                  </table>
                  <Pager {...finishedTypesPager} />
                </div>
              )}
            </div>
          ) : itemFilter === "ORDENES_TERMINADAS" ? (
            <div className="tableWrap">
              <table className="table inventoryItemsTable">
                <thead>
                  <tr>
                    <th>#</th>
                    <th>Proceso</th>
                    <th className="num">Cantidad</th>
                    <th className="num">Peso final</th>
                    <th className="num">Merma final</th>
                    <th>Fecha de recepción</th>
                    <th aria-label="Acciones" />
                  </tr>
                </thead>
                <tbody>
                  {receivedRunsPager.pageItems.map((run) => {
                    const finalWaste = run.waste_weight ? Number(run.waste_weight) : runCurrentWaste(run);
                    const lotItem = items.find((item) => item.sku === run.production_code) ?? null;
                    const lotStock = lotItem ? Number(lotItem.current_stock) : 0;
                    return (
                    <tr key={run.id}>
                      <td>{run.production_code ?? "—"}</td>
                      <td>{run.process_name}</td>
                      <td className="num">{numericText(run.quantity)} und</td>
                      <td className="num">{run.actual_finished_weight ? `${numericText(run.actual_finished_weight)} g` : "—"}</td>
                      <td className="num">
                        <button
                          className="iconTextButton"
                          onClick={() => setWasteHistoryRun(run)}
                          title="Ver historial de merma por fase"
                          type="button"
                        >
                          {finalWaste > 0 ? `${numericText(String(finalWaste))} g` : "0 g"}
                          {run.waste_percent ? ` · ${numericText(run.waste_percent)}%` : ""}
                        </button>
                      </td>
                      <td>
                        <button
                          className="iconTextButton"
                          onClick={() => setReceptionInfoRun(run)}
                          title="Ver quien recibio esta orden"
                          type="button"
                        >
                          {run.received_at ? new Date(run.received_at).toLocaleDateString("es-EC", { day: "2-digit", month: "short", year: "numeric" }) : "—"}
                        </button>
                      </td>
                      <td>
                        <div className="rowActions">
                          <button className="iconTextButton" onClick={() => setViewingRun(run)} type="button">
                            <Eye aria-hidden="true" size={15} />
                            Visualizar
                          </button>
                          <button
                            className="iconTextButton"
                            disabled={!lotItem || lotStock <= 0}
                            onClick={() => {
                              setConvertForm({ material_code: "", product_type_id: "", quantity: "" });
                              setConvertRun(run);
                            }}
                            title={!lotItem || lotStock <= 0 ? "Lote agotado" : "Convertir lote en productos del catálogo"}
                            type="button"
                          >
                            <Repeat aria-hidden="true" size={15} />
                            Convertir
                          </button>
                        </div>
                      </td>
                    </tr>
                    );
                  })}
                  {receivedRunsFiltered.length === 0 ? (
                    <tr><td colSpan={7}><div className="emptyState">{anyAdvancedFilter ? "Sin procesos para los filtros." : "No hay procesos terminados."}</div></td></tr>
                  ) : null}
                </tbody>
              </table>
              <Pager {...receivedRunsPager} />
            </div>
          ) : (
          <div className="tableWrap">
            <table className="table inventoryItemsTable">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Proceso</th>
                  <th className="num">Cantidad</th>
                  <th className="num">Peso actual</th>
                  <th className="num">Merma actual</th>
                  <th>Etapa actual</th>
                  <th>Fecha de inicio</th>
                  <th aria-label="Acciones" />
                </tr>
              </thead>
              <tbody>
                {wipPager.pageItems.map((row) => {
                  if (row.kind === "run" && row.run) {
                    const run = row.run;
                    const currentStage = runCurrentStage(run);
                    const currentWaste = runCurrentWaste(run);
                    return (
                      <tr key={`run-${run.id}`}>
                        <td>{run.production_code ? <span className="orderCodeTag">{run.production_code}</span> : "—"}</td>
                        <td>{run.process_name}</td>
                        <td className="num">{numericText(run.quantity)} und</td>
                        <td className="num">{numericText(runCurrentWeight(run))} {run.raw_material_unit_code}</td>
                        <td className="num">{numericText(String(currentWaste))} {run.raw_material_unit_code}</td>
                        <td>
                          {currentStage ? (
                            <button
                              className="iconTextButton"
                              onClick={() => setStageInfoRun(run)}
                              title="Ver quien avanzo a esta etapa"
                              type="button"
                            >
                              {currentStage.stage_name} ({currentStage.stage_order}/{run.stages.length})
                            </button>
                          ) : (
                            "—"
                          )}
                        </td>
                        <td>
                          {productionTimeLabel(run.started_at)}
                          {run.started_by_name ? <><br /><small>Inició: {run.started_by_name}</small></> : null}
                        </td>
                        <td>
                          <div className="rowActions">
                            <button className="iconTextButton" onClick={() => setViewingRun(run)} type="button">
                              <Eye aria-hidden="true" size={15} />
                              Visualizar
                            </button>
                          </div>
                        </td>
                      </tr>
                    );
                  }
                  if (!row.item) return null;
                  const item = row.item;
                  return (
                    <tr key={item.id}>
                      <td>{item.sku}</td>
                      <td>{item.name}</td>
                      <td className="num">{numericText(item.current_stock)} {item.unit_code}</td>
                      <td className="num">—</td>
                      <td className="num">—</td>
                      <td>—</td>
                      <td>—</td>
                      <td>
                        <div className="rowActions">
                          <button className="iconTextButton" onClick={() => setViewingItem(item)} type="button">
                            <Eye aria-hidden="true" size={15} />
                            Visualizar
                          </button>
                        </div>
                      </td>
                    </tr>
                  );
                })}
                {!isLoading && displayItems.length === 0 && inProcessRunsFiltered.length === 0 ? (
                  <tr><td colSpan={8}><div className="emptyState">{anyAdvancedFilter ? "Sin productos en proceso para los filtros." : "No hay productos en proceso."}</div></td></tr>
                ) : null}
                {isLoading ? (
                  <tr><td colSpan={8}><div className="emptyState">Cargando inventario...</div></td></tr>
                ) : null}
              </tbody>
            </table>
            <Pager {...wipPager} />
          </div>
          )}
        </article>

        <article className="card panelBody inventoryPanel">
          <div className="panelHeader">
            <div>
              <h2 className="panelTitle">Movimientos</h2>
              <p className="panelText">Ultimos movimientos registrados</p>
            </div>
            <button
              aria-label="Visualizar historial completo"
              className="iconOnlyButton"
              disabled={movements.length === 0}
              onClick={openMovementHistory}
              title="Historial completo"
              type="button"
            >
              <Eye aria-hidden="true" size={17} />
            </button>
          </div>
          <div className="movementList">
            {movementsPager.pageItems.map((movement, index) => (
              <article className="movementRow" key={movement.id} {...openableProps(() => setViewingMovement(movement), `Ver movimiento de ${movement.item.name}`)}>
                <div>
                  <strong>{movementTypeLabel(movement.movement_type)}</strong>
                  {movement.lot_code ? (
                    <span style={{ fontFamily: "monospace", fontSize: 11, color: "var(--primary-strong)", fontWeight: 700 }}>{movement.lot_code}</span>
                  ) : null}
                  <span>{movementDateLabel(movement.created_at)} - {movement.item.name}</span>
                </div>
                <div>
                  <strong className="num">{numericText(movement.quantity)} {movement.unit_code}</strong>
                  <span>
                    {movementTimeLabel(movement.created_at)}
                    {movement.reason ? ` - ${movement.reason}` : ""}
                    {movement.created_by_name ? ` · ${movement.created_by_name}` : ""}
                  </span>
                  <span className="rowActions" onClick={stopClick} style={{ marginTop: 2 }}>
                    {movement.source_file_name ? (
                      <button className="iconTextButton" onClick={() => void handleDownloadMovementSourceFile(movement)} type="button">
                        <Download aria-hidden="true" size={15} />
                        XML
                      </button>
                    ) : null}
                    <button className="iconTextButton" onClick={() => setViewingMovement(movement)} type="button">
                      <Eye aria-hidden="true" size={15} />
                      Visualizar
                    </button>
                    {movementsPager.page === 0 && index === 0 && canSeeAudit && movement.movement_type === "ENTRADA" && withinRevertWindow(movement.created_at) ? (
                      <button className="iconTextButton dangerText" onClick={() => void handleRevertLastEntry(movement.item)} type="button">
                        <RotateCcw aria-hidden="true" size={15} />
                        Revertir
                      </button>
                    ) : null}
                  </span>
                </div>
              </article>
            ))}
            {!isLoading && movements.length === 0 ? <div className="emptyState">No hay movimientos registrados.</div> : null}
            {isLoading ? <div className="emptyState">Cargando movimientos...</div> : null}
          </div>
          <Pager {...movementsPager} />
        </article>
      </section>

      {isMovementHistoryOpen ? (
        <div className="modalBackdrop" role="dialog" aria-modal="true" aria-label="Historial completo de movimientos">
          <section className="modalWindow movementHistoryWindow">
            <div className="modalHeader">
              <div>
                <h2>Historial de movimientos</h2>
                <p>Selecciona una fecha para revisar sus movimientos</p>
              </div>
              <button aria-label="Cerrar" className="iconOnlyButton" onClick={() => setIsMovementHistoryOpen(false)} type="button">
                <X aria-hidden="true" size={18} />
              </button>
            </div>
            <div className="movementHistoryLayout">
              <section className="movementCalendarPanel" aria-label="Calendario de movimientos">
                <div className="movementCalendarHeader">
                  <button aria-label="Mes anterior" className="iconOnlyButton" onClick={() => moveHistoryMonth(-1)} type="button">
                    <ChevronLeft aria-hidden="true" size={18} />
                  </button>
                  <strong>{historyMonthLabel}</strong>
                  <button aria-label="Mes siguiente" className="iconOnlyButton" onClick={() => moveHistoryMonth(1)} type="button">
                    <ChevronRight aria-hidden="true" size={18} />
                  </button>
                </div>
                <div className="movementCalendarWeekdays">
                  {WEEK_DAYS.map((day) => <span key={day}>{day}</span>)}
                </div>
                <div className="movementCalendarGrid">
                  {calendarDays.map((day) => {
                    const count = movementCountsByDate.get(day.key) ?? 0;
                    return day.isEmpty ? (
                      <span className="movementCalendarEmpty" key={day.key} />
                    ) : (
                      <button
                        className={`movementCalendarDay ${selectedHistoryDate === day.key ? "movementCalendarSelected" : ""} ${count > 0 ? "movementCalendarHasMovements" : ""}`}
                        key={day.key}
                        onClick={() => setSelectedHistoryDate(day.key)}
                        type="button"
                      >
                        <span>{day.label}</span>
                        {count > 0 ? <strong>{count}</strong> : null}
                      </button>
                    );
                  })}
                </div>
              </section>

              <section className="movementDateDetail">
                <input
                  className="field searchField"
                  onChange={(event) => setHistorySearch(event.target.value)}
                  placeholder="Buscar por item, tipo, motivo, usuario, lote o fecha"
                  value={historySearch}
                />
                <div>
                  {historySearchActive ? (
                    <>
                      <h3>Resultados de búsqueda</h3>
                      <p>{historySearchResults.length} movimientos en todo el historial</p>
                    </>
                  ) : (
                    <>
                      <h3>{movementDateLabel(`${selectedHistoryDate}T00:00:00`)}</h3>
                      <p>{selectedDateMovements.length} movimientos registrados</p>
                    </>
                  )}
                </div>
                <div className="movementList movementHistoryEntries pagedListFloor">
                  {(historySearchActive ? historyResultsPager : historyDayPager).pageItems.map((movement) => (
                    <article className="movementRow" key={movement.id} {...openableProps(() => setViewingMovement(movement), `Ver movimiento de ${movement.item.name}`)}>
                      <div>
                        <strong>{movementTypeLabel(movement.movement_type)}</strong>
                        {movement.lot_code ? (
                          <span style={{ fontFamily: "monospace", fontSize: 11, color: "var(--primary-strong)", fontWeight: 700 }}>{movement.lot_code}</span>
                        ) : null}
                        <span>
                          {historySearchActive ? `${movementDateLabel(movement.created_at)} · ` : ""}
                          {movementTimeLabel(movement.created_at)} - {movement.item.name}
                        </span>
                      </div>
                      <div>
                        <strong className="num">{numericText(movement.quantity)} {movement.unit_code}</strong>
                        <span>
                          {movement.reason || "Sin motivo registrado"}
                          {movement.created_by_name ? ` · ${movement.created_by_name}` : ""}
                        </span>
                        <span className="rowActions" onClick={stopClick} style={{ marginTop: 2 }}>
                          {movement.source_file_name ? (
                            <button className="iconTextButton" onClick={() => void handleDownloadMovementSourceFile(movement)} type="button">
                              <Download aria-hidden="true" size={15} />
                              XML
                            </button>
                          ) : null}
                          <button className="iconTextButton" onClick={() => setViewingMovement(movement)} type="button">
                            <Eye aria-hidden="true" size={15} />
                            Visualizar
                          </button>
                        </span>
                      </div>
                    </article>
                  ))}
                  {historySearchActive && historySearchResults.length === 0 ? (
                    <div className="emptyState">Sin coincidencias en el historial. Prueba con otro dato: nombre, tipo, usuario o fecha.</div>
                  ) : null}
                  {!historySearchActive && selectedDateMovements.length === 0 ? (
                    <div className="emptyState">No hay movimientos en esta fecha.</div>
                  ) : null}
                  <Pager {...(historySearchActive ? historyResultsPager : historyDayPager)} />
                </div>
              </section>
            </div>
          </section>
        </div>
      ) : null}

      {isItemFormOpen ? (
        <div className="modalBackdrop" role="dialog" aria-modal="true" aria-label="Mantenimiento de item">
          <form className="modalWindow processFormWindow" onSubmit={handleSaveItem}>
            <div className="modalHeader">
              <div>
                <h2>{editingItemId ? "Editar item" : itemForm.item_type === "SUPPLY" ? "Crear insumo" : "Crear item"}</h2>
                <p>Mantenimiento de inventario</p>
              </div>
              <button aria-label="Cerrar" className="iconOnlyButton" onClick={() => setIsItemFormOpen(false)} type="button">
                <X aria-hidden="true" size={18} />
              </button>
            </div>
            {isEditingXmlItem ? (
              <label className="fieldGroup">
                <span>Nombre</span>
                <input className="field" onChange={(event) => setItemForm((current) => ({ ...current, name: event.target.value }))} value={itemForm.name} />
              </label>
            ) : (
              <label className="fieldGroup">
                <span>{itemForm.item_type === "SUPPLY" ? "Nombre" : "Tipo"}</span>
                <input
                  className="field"
                  onChange={(event) => setItemForm((current) => ({ ...current, material_type: event.target.value }))}
                  placeholder={itemForm.item_type === "SUPPLY" ? "Ej. Bórax, Ácido para baño" : "Ej. Oro, Plata"}
                  value={itemForm.material_type ?? ""}
                />
              </label>
            )}
            {!isEditingXmlItem ? (
              <label className="fieldGroup">
                <span>Unidad</span>
                <select className="field" onChange={(event) => setItemForm((current) => ({ ...current, unit_code: event.target.value }))} value={itemForm.unit_code}>
                  {unitOptions.map((unit) => (
                    <option key={unit.value} value={unit.value}>{unit.label}</option>
                  ))}
                </select>
              </label>
            ) : null}
            {!isEditingXmlItem && itemForm.item_type !== "SUPPLY" ? (
              <label className="fieldGroup">
                <span>Ley / pureza</span>
                <input
                  className="field"
                  onChange={(event) => setItemForm((current) => ({ ...current, purity: event.target.value }))}
                  placeholder="Ej. 18K, 925"
                  value={itemForm.purity ?? ""}
                />
              </label>
            ) : null}
            {!isEditingXmlItem ? (
              <label className="fieldGroup">
                <span>Descripcion</span>
                <textarea className="field textareaCompact" onChange={(event) => setItemForm((current) => ({ ...current, description: event.target.value }))} value={itemForm.description ?? ""} />
              </label>
            ) : null}
            <div className="modalActions">
              <button className="button buttonPrimary" disabled={isSaving} type="submit">
                <Save aria-hidden="true" size={17} />
                {isSaving ? "Guardando" : "Guardar"}
              </button>
            </div>
          </form>
        </div>
      ) : null}

      {isMovementFormOpen ? (
        <div className="modalBackdrop" role="dialog" aria-modal="true" aria-label="Movimiento de inventario">
          <form className="modalWindow processFormWindow" onSubmit={handleCreateMovement}>
            <div className="modalHeader">
              <div>
                <h2>{movementForm.movement_type === "SALIDA" ? "Registrar salida" : "Registrar ingreso"}</h2>
                <p>Todo movimiento manual queda trazado en inventario</p>
              </div>
              <button aria-label="Cerrar" className="iconOnlyButton" onClick={() => setIsMovementFormOpen(false)} type="button">
                <X aria-hidden="true" size={18} />
              </button>
            </div>
            <label className="fieldGroup">
              <span>Item</span>
              <select className="field" onChange={(event) => setMovementForm((current) => ({ ...current, item_id: event.target.value }))} value={movementForm.item_id}>
                <option value="">Seleccionar item</option>
                {movementItems.map((item) => (
                  <option key={item.id} value={item.id}>{item.name} - {item.sku}</option>
                ))}
              </select>
            </label>
            <label className="fieldGroup">
              <span>Cantidad</span>
              <input className="field" min="0.0001" onChange={(event) => setMovementForm((current) => ({ ...current, quantity: event.target.value }))} step="0.0001" type="number" value={movementForm.quantity} />
            </label>
            {movementForm.movement_type === "ENTRADA" ? (
              <>
                <label className="fieldGroup">
                  <span>Costo por gramo</span>
                  <input
                    className="field"
                    min="0"
                    onChange={(event) => setMovementForm((current) => ({ ...current, unit_cost: event.target.value }))}
                    step="0.0001"
                    type="number"
                    value={movementForm.unit_cost ?? ""}
                  />
                </label>
              </>
            ) : null}
            <div className="modalActions">
              <button className="button buttonPrimary" disabled={isSaving || !movementForm.item_id} type="submit">
                <Save aria-hidden="true" size={17} />
                {isSaving ? "Guardando" : "Registrar"}
              </button>
            </div>
          </form>
        </div>
      ) : null}

      {stageInfoRun ? (() => {
        const stage = runCurrentStage(stageInfoRun);
        const previousStage = stage
          ? [...stageInfoRun.stages]
              .sort((left, right) => left.stage_order - right.stage_order)
              .filter((candidate) => candidate.stage_order < stage.stage_order)
              .pop() ?? null
          : null;
        // Quien avanzo: el que finalizo la etapa anterior; en la primera etapa,
        // quien inicio la produccion.
        const advancedBy = previousStage ? previousStage.finished_by_name : stageInfoRun.started_by_name;
        const advancedAt = stage?.started_at ?? previousStage?.finished_at ?? stageInfoRun.started_at;
        return (
          <div className="modalBackdrop" role="dialog" aria-modal="true" aria-label="Detalle de etapa actual">
            <section className="modalWindow processViewWindow">
              <div className="modalHeader">
                <div>
                  <h2>{stage?.stage_name ?? "Etapa actual"}</h2>
                  <p>
                    {stageInfoRun.production_code ?? stageInfoRun.process_name} · etapa {stage?.stage_order ?? "—"} de {stageInfoRun.stages.length}
                  </p>
                </div>
                <button aria-label="Cerrar" className="iconOnlyButton" onClick={() => setStageInfoRun(null)} type="button">
                  <X aria-hidden="true" size={18} />
                </button>
              </div>
              <div className="userPreviewGrid">
                <span><strong>Avanzó a esta etapa</strong>{advancedBy ?? "—"}</span>
                <span><strong>Cuándo</strong>{advancedAt ? productionTimeLabel(advancedAt) : "—"}</span>
                <span><strong>Estado</strong>{stage?.status === "EN_PROCESO" ? "En proceso" : stage?.status === "PENDIENTE" ? "Pendiente" : stage?.status ?? "—"}</span>
                {previousStage ? (
                  <span><strong>Etapa anterior</strong>{previousStage.stage_name}{previousStage.finished_by_name ? ` · finalizó ${previousStage.finished_by_name}` : ""}</span>
                ) : null}
              </div>
            </section>
          </div>
        );
      })() : null}

      {wasteHistoryRun ? (() => {
        const stagesWithWaste = wasteStages.filter((stage) => Number(stage.waste_weight ?? "0") > 0);
        const totalWaste = stagesWithWaste.reduce((total, stage) => total + Number(stage.waste_weight ?? "0"), 0);
        const averageWaste = stagesWithWaste.length > 0 ? totalWaste / stagesWithWaste.length : 0;
        const worstStage = stagesWithWaste.reduce<ProductionRunStage | null>(
          (worst, stage) => (!worst || Number(stage.waste_weight ?? "0") > Number(worst.waste_weight ?? "0") ? stage : worst),
          null,
        );
        return (
          <div className="modalBackdrop" role="dialog" aria-modal="true" aria-label="Historial de merma por fase">
            <section className="modalWindow processViewWindow">
              <div className="modalHeader">
                <div>
                  <h2>Merma por fase</h2>
                  <p>{wasteHistoryRun.production_code ?? wasteHistoryRun.process_name} · {wasteStages.length} etapas</p>
                </div>
                <button aria-label="Cerrar" className="iconOnlyButton" onClick={() => setWasteHistoryRun(null)} type="button">
                  <X aria-hidden="true" size={18} />
                </button>
              </div>
              <div className="fichaHero">
                <div className="fichaHeroItem">
                  <strong>{numericText(String(totalWaste))} g</strong>
                  <span>Merma total{wasteHistoryRun.waste_percent ? ` (${numericText(wasteHistoryRun.waste_percent)}%)` : ""}</span>
                </div>
                <div className="fichaHeroItem">
                  <strong>{numericText(String(averageWaste))} g</strong>
                  <span>Promedio por etapa con merma</span>
                </div>
                <div className="fichaHeroItem">
                  <strong>{worstStage ? worstStage.stage_name : "—"}</strong>
                  <span>Etapa con mayor merma{worstStage ? ` (${numericText(worstStage.waste_weight ?? "0")} g)` : ""}</span>
                </div>
              </div>
              <RunStageSummaryTable run={wasteHistoryRun} />
            </section>
          </div>
        );
      })() : null}

      {receptionInfoRun ? (
        <div className="modalBackdrop" role="dialog" aria-modal="true" aria-label="Detalle de recepcion">
          <section className="modalWindow processViewWindow">
            <div className="modalHeader">
              <div>
                <h2>Recepción de orden</h2>
                <p>{receptionInfoRun.production_code ?? receptionInfoRun.process_name} · {receptionInfoRun.process_name}</p>
              </div>
              <button aria-label="Cerrar" className="iconOnlyButton" onClick={() => setReceptionInfoRun(null)} type="button">
                <X aria-hidden="true" size={18} />
              </button>
            </div>
            <div className="userPreviewGrid">
              <span><strong>Recibida por</strong>{receptionInfoRun.received_by_name ?? "—"}</span>
              <span><strong>Cuándo</strong>{productionTimeLabel(receptionInfoRun.received_at)}</span>
              <span><strong>Cantidad</strong>{numericText(receptionInfoRun.quantity)} und</span>
              <span><strong>Peso final</strong>{receptionInfoRun.actual_finished_weight ? `${numericText(receptionInfoRun.actual_finished_weight)} g` : "—"}</span>
            </div>
          </section>
        </div>
      ) : null}

      {convertRun ? (() => {
        const lotItem = items.find((item) => item.sku === convertRun.production_code) ?? null;
        const lotStock = lotItem ? Number(lotItem.current_stock) : 0;
        const materials = catalogSegments.filter((segment) => segment.kind === "MATERIAL" && segment.is_active);
        const activeTypes = productTypes.filter((type) => type.is_active);
        const selectedType = activeTypes.find((type) => type.id === convertForm.product_type_id) ?? null;
        const previewCode = convertForm.material_code && selectedType
          ? `${convertForm.material_code}${selectedType.category_code}${selectedType.model_code}`
          : null;
        const quantityNumber = Number(convertForm.quantity);
        const quantityValid = Number.isFinite(quantityNumber) && quantityNumber > 0 && quantityNumber <= lotStock;
        return (
          <div className="modalBackdrop" role="dialog" aria-modal="true" aria-label="Convertir lote en productos">
            <form className="modalWindow processFormWindow" onSubmit={handleConvertLot}>
              <div className="modalHeader">
                <div>
                  <h2>Convertir lote</h2>
                  <p>
                    {convertRun.production_code ?? "Sin folio"} · {convertRun.process_name} · Disponible:{" "}
                    {numericText(String(lotStock))} und
                  </p>
                </div>
                <button aria-label="Cerrar" className="iconOnlyButton" onClick={() => setConvertRun(null)} type="button">
                  <X aria-hidden="true" size={18} />
                </button>
              </div>
              <label className="fieldGroup">
                <span>Material</span>
                <select
                  className="field"
                  onChange={(event) => setConvertForm((current) => ({ ...current, material_code: event.target.value }))}
                  value={convertForm.material_code}
                >
                  <option value="">Seleccionar material</option>
                  {materials.map((segment) => (
                    <option key={segment.id} value={segment.code}>{segment.label}</option>
                  ))}
                </select>
              </label>
              <label className="fieldGroup">
                <span>Tipo de producto</span>
                <select
                  className="field"
                  onChange={(event) => setConvertForm((current) => ({ ...current, product_type_id: event.target.value }))}
                  value={convertForm.product_type_id}
                >
                  <option value="">Seleccionar tipo</option>
                  {activeTypes.map((type) => (
                    <option key={type.id} value={type.id}>
                      {type.category_label} · {type.model_label}{type.name ? ` · ${type.name}` : ""}
                    </option>
                  ))}
                </select>
              </label>
              <label className="fieldGroup">
                <span>Cantidad a convertir (máx. {numericText(String(lotStock))})</span>
                <input
                  className="field"
                  max={lotStock}
                  min="1"
                  onChange={(event) => setConvertForm((current) => ({ ...current, quantity: event.target.value }))}
                  step="1"
                  type="number"
                  value={convertForm.quantity}
                />
              </label>
              {previewCode ? (
                <p className="panelText">Código de producto resultante: <strong>{previewCode}</strong></p>
              ) : null}
              <div className="modalActions">
                <button
                  className="button buttonPrimary"
                  disabled={isConverting || !convertForm.material_code || !convertForm.product_type_id || !quantityValid}
                  type="submit"
                >
                  <Repeat aria-hidden="true" size={17} />
                  {isConverting ? "Convirtiendo" : "Convertir"}
                </button>
              </div>
            </form>
          </div>
        );
      })() : null}

      {isArchivedOpen ? (
        <div className="modalBackdrop" role="dialog" aria-modal="true" aria-label="Items archivados">
          <section className="modalWindow processViewWindow">
            <div className="modalHeader">
              <div>
                <h2>Archivados</h2>
                <p>{archivedItems.length} items fuera del inventario activo</p>
              </div>
              <button aria-label="Cerrar" className="iconOnlyButton" onClick={() => setIsArchivedOpen(false)} type="button">
                <X aria-hidden="true" size={18} />
              </button>
            </div>
            <p className="panelText">Un item archivado conserva todo su kardex y vuelve solo al inventario si recibe una nueva entrada. Eliminar borra el item y su historial para siempre.</p>
            <div className="tableWrap pagedListFloor" style={{ minHeight: 200 }}>
              <table className="table tableAuto archivedTable">
                <thead>
                  <tr>
                    <th>Item</th>
                    <th>Seccion</th>
                    <th>Archivado</th>
                    <th aria-label="Acciones" />
                  </tr>
                </thead>
                <tbody>
                  {archivedPager.pageItems.map((item) => (
                    <tr key={item.id}>
                      <td>{item.material_type ?? item.name} · {item.sku}</td>
                      <td>{itemTypeLabel(item.item_type)}</td>
                      <td>{item.archived_at ? movementDateLabel(item.archived_at) : "—"}</td>
                      <td>
                        <div className="rowActions">
                          <button aria-label="Restaurar" className="iconOnlyButton" onClick={() => void handleUnarchiveItem(item)} title="Restaurar" type="button">
                            <RotateCcw aria-hidden="true" size={15} />
                          </button>
                          <button aria-label="Eliminar" className="iconOnlyButton dangerText" onClick={() => void handleDeleteArchivedItem(item)} title="Eliminar" type="button">
                            <Trash2 aria-hidden="true" size={15} />
                          </button>
                        </div>
                      </td>
                    </tr>
                  ))}
                  {archivedItems.length === 0 ? (
                    <tr><td colSpan={4}><div className="emptyState">No hay items archivados.</div></td></tr>
                  ) : null}
                </tbody>
              </table>
              <Pager {...archivedPager} />
            </div>
          </section>
        </div>
      ) : null}

      {xmlImportDraft ? (
        <div className="modalBackdrop" role="dialog" aria-modal="true" aria-label="Importar factura XML">
          <section className="modalWindow processViewWindow">
            <div className="modalHeader">
              <div>
                <h2>Importar factura XML</h2>
                <p>{[xmlImportDraft.supplier, xmlImportDraft.invoiceNumber].filter(Boolean).join(" · ") || xmlImportDraft.fileName}</p>
              </div>
              <button aria-label="Cerrar" className="iconOnlyButton" onClick={() => setXmlImportDraft(null)} type="button">
                <X aria-hidden="true" size={18} />
              </button>
            </div>
            <p className="panelText">Revisa a que seccion entra cada linea. Las lineas que ya existen en inventario entran a su item actual.</p>
            <div className="tableWrap pagedListFloor" style={{ minHeight: 200 }}>
              <table className="table tableAuto">
                <thead>
                  <tr>
                    <th>Linea</th>
                    <th>Cantidad</th>
                    <th>Seccion</th>
                  </tr>
                </thead>
                <tbody>
                  {xmlLinesPager.pageItems.map((line, index) => {
                    // Índice real dentro del borrador (la página solo muestra un tramo).
                    const lineIndex = xmlLinesPager.page * xmlLinesPager.pageSize + index;
                    return (
                    <tr key={`${line.description}-${lineIndex}`}>
                      <td>{line.description}</td>
                      <td>{numericText(line.quantity)} {line.unitCode || "und"}</td>
                      <td>
                        {line.existingItem ? (
                          <span>{itemTypeLabel(line.existingItem.item_type)} · {line.existingItem.sku}</span>
                        ) : (
                          <select
                            className="field"
                            onChange={(event) =>
                              setXmlImportDraft((current) => {
                                if (!current) return current;
                                const nextLines = current.lines.map((candidate, candidateIndex) =>
                                  candidateIndex === lineIndex ? { ...candidate, itemType: event.target.value as InventoryItemType } : candidate,
                                );
                                return { ...current, lines: nextLines };
                              })
                            }
                            value={line.itemType}
                          >
                            <option value="RAW_MATERIAL">Materia prima</option>
                            <option value="SUPPLY">Insumo</option>
                          </select>
                        )}
                      </td>
                    </tr>
                    );
                  })}
                </tbody>
              </table>
              <Pager {...xmlLinesPager} />
            </div>
            <div className="modalActions">
              <button className="button" disabled={isSaving} onClick={() => setXmlImportDraft(null)} type="button">
                Cancelar
              </button>
              <button className="button buttonPrimary" disabled={isSaving} onClick={handleConfirmXmlImport} type="button">
                <Save aria-hidden="true" size={17} />
                {isSaving ? "Importando" : `Importar ${xmlImportDraft.lines.length} ${xmlImportDraft.lines.length === 1 ? "linea" : "lineas"}`}
              </button>
            </div>
          </section>
        </div>
      ) : null}

      {viewingItem ? (
        <div className="modalBackdrop" role="dialog" aria-modal="true" aria-label="Detalle de item">
          <section className="modalWindow processViewWindow">
            <div className="modalHeader">
              <div>
                <h2>{viewingItem.name}</h2>
                <p>{viewingItem.sku} - {itemTypeLabel(viewingItem.item_type)}</p>
              </div>
              <button aria-label="Cerrar" className="iconOnlyButton" onClick={() => setViewingItem(null)} type="button">
                <X aria-hidden="true" size={18} />
              </button>
            </div>
            <div className="fichaHero">
              <div className="fichaHeroItem">
                <strong>{numericText(viewingItem.current_stock)} {viewingItem.unit_code}</strong>
                <span>Stock actual</span>
              </div>
              {viewingItem.purity ? (
                <div className="fichaHeroItem">
                  <strong>{viewingItem.purity}</strong>
                  <span>Ley / pureza</span>
                </div>
              ) : null}
            </div>
            <div className="userPreviewGrid">
              {viewingItem.material_type ? <span><strong>Tipo</strong>{viewingItem.material_type}</span> : null}
              {viewingItem.source_lot_sku ? <span><strong>Lote de origen</strong>{viewingItem.source_lot_sku}</span> : null}
              <span><strong>Costo promedio</strong>$ {numericText(viewingItem.average_cost ?? "0")}</span>
              <span><strong>Valor total</strong>$ {moneyText(itemTotalValue(viewingItem))}</span>
              <span>
                <strong>Estado</strong>
                <span className={`stockBadge stockBadge--${stockStatus(viewingItem).level}`}>{stockStatus(viewingItem).label}</span>
              </span>
            </div>
            <p className="panelText">{viewingItem.description || "Sin descripcion"}</p>
            <div className="modalActions">
              <button className="button" onClick={() => setIsKardexOpen(true)} type="button">
                <History aria-hidden="true" size={15} />
                Kardex ({viewingItemKardex.length})
              </button>
            </div>
          </section>
        </div>
      ) : null}

      {viewingItem && isKardexOpen ? (
        <div className="modalBackdrop" role="dialog" aria-modal="true" aria-label="Kardex del item">
          <section className="modalWindow processViewWindow">
            <div className="modalHeader">
              <div>
                <h2>Kardex</h2>
                <p>{viewingItem.name} · {viewingItemKardex.length} movimientos</p>
              </div>
              <button aria-label="Cerrar" className="iconOnlyButton" onClick={() => setIsKardexOpen(false)} type="button">
                <X aria-hidden="true" size={18} />
              </button>
            </div>
            <div className="tableWrap pagedListFloor" style={{ minHeight: 180 }}>
              <table className="table tableAuto kardexTable">
                <thead>
                  <tr>
                    <th>Fecha</th>
                    <th>Tipo</th>
                    <th className="num">Cantidad</th>
                    <th className="num">Saldo</th>
                  </tr>
                </thead>
                <tbody>
                  {kardexPager.pageItems.map(({ movement, balanceAfter }) => (
                    <tr key={movement.id}>
                      <td>{movementDateLabel(movement.created_at)}</td>
                      <td>{movementTypeLabel(movement.movement_type)}</td>
                      <td className="num">{movementSign(movement.movement_type) > 0 ? "+" : "−"}{numericText(movement.quantity)} {movement.unit_code}</td>
                      <td className="num">{numericText(String(balanceAfter))} {movement.unit_code}</td>
                    </tr>
                  ))}
                  {viewingItemKardex.length === 0 ? (
                    <tr><td colSpan={4}><div className="emptyState">Sin movimientos para este item.</div></td></tr>
                  ) : null}
                </tbody>
              </table>
              <Pager {...kardexPager} />
            </div>
          </section>
        </div>
      ) : null}

      {confirmDialog}

      {viewingMovement ? (
        <div className="modalBackdrop" role="dialog" aria-modal="true" aria-label="Detalle de movimiento">
          <section className="modalWindow processViewWindow">
            <div className="modalHeader">
              <div>
                <h2>{movementTypeLabel(viewingMovement.movement_type)}</h2>
                <p>{viewingMovement.item.name}{viewingMovement.lot_code ? ` · ${viewingMovement.lot_code}` : ""}</p>
              </div>
              <button aria-label="Cerrar" className="iconOnlyButton" onClick={() => setViewingMovement(null)} type="button">
                <X aria-hidden="true" size={18} />
              </button>
            </div>
            <div className="fichaHero">
              <div className="fichaHeroItem">
                <strong>{numericText(viewingMovement.quantity)} {viewingMovement.unit_code}</strong>
                <span>Cantidad</span>
              </div>
            </div>
            <div className="userPreviewGrid">
              {viewingMovement.unit_cost ? <span><strong>Costo unitario</strong>{numericText(viewingMovement.unit_cost)}</span> : null}
              {viewingMovement.lot_code ? <span><strong>Lote (OP)</strong>{viewingMovement.lot_code}</span> : null}
              {viewingMovement.item.product_code ? <span><strong>Producto</strong>{viewingMovement.item.product_code}</span> : null}
              <span><strong>Fecha</strong>{movementDateLabel(viewingMovement.created_at)} - {movementTimeLabel(viewingMovement.created_at)}</span>
              {viewingMovement.created_by_name ? <span><strong>Registrado por</strong>{viewingMovement.created_by_name}</span> : null}
              {viewingMovement.source_file_name ? <span><strong>Archivo</strong>{viewingMovement.source_file_name}</span> : null}
            </div>
            <p className="panelText">{viewingMovement.reason || "Sin motivo registrado"}</p>
            {viewingMovement.source_file_name ? (
              <div className="modalActions">
                <button className="button" onClick={() => void handleDownloadMovementSourceFile(viewingMovement)} type="button">
                  <Download aria-hidden="true" size={16} />
                  Descargar XML
                </button>
              </div>
            ) : null}
          </section>
        </div>
      ) : null}

      {viewingRun ? (
        <div className="modalBackdrop" role="dialog" aria-modal="true" aria-label="Avance de produccion">
          <section className="modalWindow processViewWindow">
            <div className="modalHeader">
              <div>
                <h2>
                  {viewingRun.production_code ? <span className="orderCodeTag">{viewingRun.production_code}</span> : null}
                  {viewingRun.process_name}
                </h2>
                <p>
                  {numericText(viewingRun.quantity)} unidades
                </p>
              </div>
              <button aria-label="Cerrar" className="iconOnlyButton" onClick={() => setViewingRun(null)} type="button">
                <X aria-hidden="true" size={18} />
              </button>
            </div>
            {(() => {
              const stages = [...viewingRun.stages].sort((a, b) => a.stage_order - b.stage_order);
              const current = stages.find((s) => s.status === "EN_PROCESO") ?? stages.find((s) => s.status === "PENDIENTE") ?? null;
              const done = stages.filter((s) => s.status === "FINALIZADA").length;
              return (
                <>
                  {viewingRun.status === "RECIBIDA" ? (
                    <div className="userPreviewGrid">
                      <span><strong>Lote (OP)</strong>{viewingRun.production_code ?? "—"}</span>
                      <span><strong>Proceso</strong>{viewingRun.process_name}</span>
                      <span><strong>Cantidad</strong>{numericText(viewingRun.quantity)} unidades</span>
                      <span><strong>Fecha</strong>{viewingRun.received_at ? productionTimeLabel(viewingRun.received_at) : "—"}</span>
                      <span><strong>Recibido por</strong>{viewingRun.received_by_name ?? "—"}</span>
                    </div>
                  ) : (
                    <div className="userPreviewGrid">
                      <span><strong>Lote (OP)</strong>{viewingRun.production_code ?? "—"}</span>
                      <span><strong>Proceso</strong>{viewingRun.process_name}</span>
                      <span><strong>Cantidad</strong>{numericText(viewingRun.quantity)} unidades</span>
                      <span><strong>Creado por</strong>{viewingRun.created_by_name ?? "—"}{viewingRun.requested_at ? ` · ${productionTimeLabel(viewingRun.requested_at)}` : ""}</span>
                      <span><strong>Etapas</strong>{current ? `Etapa ${current.stage_order}. ${current.stage_name}` : `${done} de ${stages.length}`}</span>
                    </div>
                  )}
                  {viewingRun.status !== "RECIBIDA" ? (
                    <div className="stageTimelineList">
                      {stages.map((stage) => (
                        <div className={`stageTimelineItem stageTimelineItem${stage.status}`} key={stage.id}>
                          <div className="stageTimelineHead">
                            <div className="stageTimelineLeft">
                              <span className={`stageTimelineNum ${stage.status === "FINALIZADA" ? "stageTimelineNumDone" : stage.status === "EN_PROCESO" ? "stageTimelineNumActive" : ""}`}>{stage.stage_order}</span>
                              <div>
                                <strong>{stage.stage_name}</strong>
                                <span>{stage.status === "FINALIZADA" ? "Finalizada" : stage.status === "EN_PROCESO" ? "En proceso" : "Pendiente"}</span>
                              </div>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  ) : null}
                </>
              );
            })()}
          </section>
        </div>
      ) : null}

      {printPreview ? (
        <div className="modalBackdrop modalBackdropTop" role="dialog" aria-modal="true" aria-label="Vista previa del comprobante">
          <section className="modalWindow documentosPrintModal">
            <div className="modalHeader">
              <div>
                <h2>Comprobante de orden</h2>
                <p>{printPreview.mode === "entrega" ? "Mitad de entrega de materiales" : "Mitad de recepción de producto terminado"}</p>
              </div>
              <button aria-label="Cerrar" className="iconOnlyButton" onClick={() => setPrintPreview(null)} type="button">
                <X aria-hidden="true" size={18} />
              </button>
            </div>
            <div className="documentosPreviewFrame">
              <OrdenProduccionDoc model={buildOrdenProduccion(printPreview.run, docItemNames)} mode="completo" />
            </div>
            <div className="modalActions">
              <button className="button" onClick={() => setPrintPreview(null)} type="button">
                Cerrar
              </button>
              <button className="button buttonPrimary" onClick={() => setPrintingMode(printPreview.mode)} type="button">
                <Printer aria-hidden="true" size={16} />
                Imprimir {printPreview.mode === "entrega" ? "entrega" : "recepción"}
              </button>
            </div>
          </section>
        </div>
      ) : null}

      {printingMode && printPreview
        ? createPortal(
            <div className="printArea">
              <OrdenProduccionDoc model={buildOrdenProduccion(printPreview.run, docItemNames)} mode={printingMode} />
            </div>,
            document.body
          )
        : null}

      {isSolicitudesOpen ? (
        <div className="modalBackdrop" role="dialog" aria-modal="true" aria-label="Solicitudes de produccion">
          <section className="modalWindow solicitudesModal">
            <div className="modalHeader">
              <div>
                <h2>Solicitudes de produccion</h2>
                <p>{pendingInventoryRuns.length + pendingReceptionRuns.length} solicitudes pendientes</p>
              </div>
              <button aria-label="Cerrar" className="iconOnlyButton" onClick={() => setIsSolicitudesOpen(false)} type="button">
                <X aria-hidden="true" size={18} />
              </button>
            </div>

            {pendingInventoryRuns.length > 0 ? (
              <>
                <h3 style={{ margin: "4px 0 8px", fontSize: 14, fontWeight: 800, color: "var(--muted)" }}>
                  Salida de materia prima ({pendingInventoryRuns.length})
                </h3>
                <div style={{ display: "grid", gap: 10 }}>
                  {pendingInventoryRuns.map((run) => (
                    <div className="solicitudCard" key={run.id}>
                      <div className="solicitudCardHead">
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <strong>
                            {run.production_code ? <span className="orderCodeTag">{run.production_code}</span> : null}
                            {run.process_name}
                          </strong>
                          <span style={{ display: "block", color: "var(--muted)", fontSize: 13 }}>
                            {numericText(run.total_required_material)} {run.raw_material_unit_code} · {productionTimeLabel(run.requested_at)}
                          </span>
                        </div>
                        <div style={{ display: "flex", gap: 6, flexShrink: 0 }}>
                          <button
                            className="button buttonPrimary"
                            disabled={isSavingProduction}
                            onClick={() => void handleApproveMaterials(run)}
                            type="button"
                          >
                            Aprobar
                          </button>
                          <button
                            className="button buttonDanger"
                            disabled={isSavingProduction}
                            onClick={() => void handleRejectMaterials(run)}
                            type="button"
                          >
                            Rechazar
                          </button>
                        </div>
                      </div>
                      <button
                        className="solicitudCardToggle"
                        onClick={() => setExpandedSolicitudId(expandedSolicitudId === run.id ? null : run.id)}
                        type="button"
                        aria-label="Ver detalle"
                      >
                        <Eye aria-hidden="true" size={14} />
                        {expandedSolicitudId === run.id ? "Ocultar detalle" : "Ver detalle"}
                      </button>
                      {expandedSolicitudId === run.id ? (
                        <div className="solicitudCardDetail">
                          <div className="solicitudDetailItem">
                            <strong>Solicitado</strong>
                            <span>{productionTimeLabel(run.requested_at)}</span>
                          </div>
                          <div className="solicitudDetailItem">
                            <strong>Proceso</strong>
                            <span>{run.process_name}</span>
                          </div>
                          <div className="solicitudDetailItem">
                            <strong>Cantidad</strong>
                            <span>{numericText(run.quantity)} unidades</span>
                          </div>
                          <div className="solicitudDetailItem">
                            <strong>Material por unidad</strong>
                            <span>{numericText(run.raw_material_quantity_per_unit)} {run.raw_material_unit_code}</span>
                          </div>
                          <div className="solicitudDetailItem">
                            <strong>Material requerido</strong>
                            <span>{numericText(run.total_required_material)} {run.raw_material_unit_code}</span>
                          </div>
                          <div className="solicitudDetailItem">
                            <strong>Peso esperado</strong>
                            <span>{numericText(run.expected_finished_weight)}</span>
                          </div>
                          <div className="solicitudDetailItem">
                            <strong>Etapas</strong>
                            <span>{run.stages.length}</span>
                          </div>
                          <div className="solicitudDetailItem">
                            <strong>Solicitada por</strong>
                            <span>{run.created_by_name ?? "-"}</span>
                          </div>
                        </div>
                      ) : null}
                    </div>
                  ))}
                </div>
              </>
            ) : null}

            {pendingReceptionRuns.length > 0 ? (
              <>
                <h3 style={{ margin: "12px 0 8px", fontSize: 14, fontWeight: 800, color: "var(--muted)" }}>
                  Recepcion de producto terminado ({pendingReceptionRuns.length})
                </h3>
                <div style={{ display: "grid", gap: 10 }}>
                  {pendingReceptionRuns.map((run) => (
                    <div className="solicitudCard receptionRequestCard" key={run.id}>
                      <div className="solicitudCardHead">
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <strong>
                            {run.production_code ? <span className="orderCodeTag">{run.production_code}</span> : null}
                            {run.process_name}
                          </strong>
                          <span style={{ display: "block", color: "var(--muted)", fontSize: 13 }}>
                            {numericText(run.quantity)} unidades · Merma: {run.waste_percent ?? 0}%
                          </span>
                        </div>
                        <button
                          className="button buttonPrimary"
                          disabled={isSavingProduction}
                          onClick={() => void handleReceiveFinishedProduct(run)}
                          type="button"
                          style={{ flexShrink: 0 }}
                        >
                          Recibir
                        </button>
                      </div>
                      <button
                        className="solicitudCardToggle"
                        onClick={() => setExpandedSolicitudId(expandedSolicitudId === `recv-${run.id}` ? null : `recv-${run.id}`)}
                        type="button"
                        aria-label="Ver detalle"
                      >
                        <Eye aria-hidden="true" size={14} />
                        {expandedSolicitudId === `recv-${run.id}` ? "Ocultar detalle" : "Ver detalle"}
                      </button>
                      {expandedSolicitudId === `recv-${run.id}` ? (
                        <div className="solicitudCardDetail">
                          <div className="solicitudDetailItem">
                            <strong>Proceso</strong>
                            <span>{run.process_name}</span>
                          </div>
                          <div className="solicitudDetailItem">
                            <strong>Cantidad</strong>
                            <span>{numericText(run.quantity)} unidades</span>
                          </div>
                          <div className="solicitudDetailItem">
                            <strong>Finalizado</strong>
                            <span>{productionTimeLabel(run.finished_at)}</span>
                          </div>
                          <div className="solicitudDetailItem">
                            <strong>Peso esperado</strong>
                            <span>{numericText(run.expected_finished_weight)}</span>
                          </div>
                          <div className="solicitudDetailItem">
                            <strong>Peso real</strong>
                            <span>{run.actual_finished_weight ? numericText(run.actual_finished_weight) : "-"}</span>
                          </div>
                          <div className="solicitudDetailItem">
                            <strong>Merma</strong>
                            <span>{run.waste_weight ? `${numericText(run.waste_weight)} (${numericText(run.waste_percent)}%)` : `${numericText(run.waste_percent)}%`}</span>
                          </div>
                          <div className="solicitudDetailItem">
                            <strong>Limite de merma</strong>
                            <span>{numericText(run.waste_limit_percent)}%</span>
                          </div>
                        </div>
                      ) : null}
                    </div>
                  ))}
                </div>
              </>
            ) : null}
          </section>
        </div>
      ) : null}
    </div>
  );
}
