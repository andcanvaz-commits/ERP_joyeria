"use client";

import { ChangeEvent, FormEvent, Fragment, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Boxes, CalendarDays, ChevronDown, ChevronLeft, ChevronRight, Download, Eye, FlaskConical, History, Inbox, Minus, Pencil, Plus, Printer, Repeat, RotateCcw, Save, SlidersHorizontal, Trash2, Upload, X } from "lucide-react";
import { createPortal } from "react-dom";
import { isAuthenticated } from "@/lib/api";
import { openableProps, stopClick } from "@/lib/a11y";
import { buildItemNameMap, buildOrdenProduccion } from "@/lib/orden-produccion";
import { OrdenProduccionDoc, type DocMode } from "@/components/documentos/orden-produccion-doc";
import { getCurrentUser, listUsers } from "@/lib/auth-api";
import { confirmDelete, useConfirm } from "@/components/ui/confirm-dialog";
import { ToastNotice } from "@/components/ui/toast-notice";
import { listCatalogSegments, metalTagClass } from "@/lib/catalog-api";
import { matchMaterialSegment as matchMaterialSegmentShared } from "@/lib/material-match";
import { listUnits } from "@/lib/units-api";
import { listProductTypes } from "@/lib/product-types-api";
import { FinishedItemPicker } from "@/components/inventory/finished-item-picker";
import { ComplementPicker } from "@/components/inventory/complement-picker";
import { ProductTypesManager } from "@/components/mantenimiento/product-types-manager";
import {
  archiveInventoryItem,
  combineProducts,
  convertLotToProduct,
  createInventoryItem,
  createInventoryMovement,
  deleteInventoryItem,
  downloadInventoryMovementSourceFile,
  getInventorySummary,
  listComplementTypes,
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
import { RunStageSummaryTable, RunWasteHero } from "@/components/production/run-stage-summary";

const ITEM_TYPES: Array<{ value: InventoryItemType | "TODOS" | "ORDENES_TERMINADAS"; label: string }> = [
  { value: "RAW_MATERIAL", label: "Materia prima" },
  { value: "SUPPLY", label: "Insumos" },
  { value: "COMPLEMENT", label: "Complementos" },
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
// complementTypeId solo aplica a lineas nuevas de tipo COMPLEMENT. manualLink
// marca un vinculo manual hecho con el picker, valido solo para esta importacion.
type XmlImportLine = XmlInvoiceDetail & {
  itemType: InventoryItemType;
  existingItem: InventoryItem | null;
  complementTypeId: string | null;
  manualLink?: boolean;
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

// Conversión y ensamble son UNA operación: la flecha del detalle ya dice de
// qué a qué; la etiqueta no distingue entrada/salida.
function movementOperationLabel(movement: { movement_type: InventoryMovementType; reference_type?: string | null }) {
  if (movement.movement_type === "CONVERSION_ENTRADA" || movement.movement_type === "CONVERSION_SALIDA") {
    return movement.reference_type === "product_assembly" ? "Ensamble" : "Conversión";
  }
  return movementTypeLabel(movement.movement_type);
}

// Stock de un item con su equivalencia: gramos ↔ unidades cuando el item
// tiene peso por unidad; su unidad base cuando no. Formato único para todo
// el sistema ("40 g · 4 und").
function itemStockText(item: InventoryItem) {
  const stock = Number(item.current_stock);
  const wpu = Number(item.weight_per_unit ?? 0);
  const base = `${numericText(item.current_stock)} ${item.unit_code}`;
  if (!(wpu > 0) || !Number.isFinite(stock)) return base;
  if (item.unit_code === "g") {
    return `${base} · ${numericText(String(Number((stock / wpu).toFixed(2))))} und`;
  }
  if (item.unit_code === "und") {
    return `${base} · ${numericText(String(Number((stock * wpu).toFixed(2))))} g`;
  }
  return base;
}

// Cantidad de un movimiento con su equivalencia: items en gramos con peso
// por unidad muestran también unidades; items en unidades (lotes) muestran
// también gramos. Sin dato de peso, solo la cantidad base.
function movementAmountText(movement: InventoryMovement) {
  const quantity = Number(movement.quantity);
  const wpu = Number(movement.item.weight_per_unit ?? 0);
  const base = `${numericText(movement.quantity)} ${movement.unit_code}`;
  if (!(wpu > 0) || !Number.isFinite(quantity)) return base;
  if (movement.unit_code === "g") {
    return `${base} · ${numericText(String(Number((quantity / wpu).toFixed(2))))} und`;
  }
  if (movement.unit_code === "und") {
    return `${base} · ${numericText(String(Number((quantity * wpu).toFixed(2))))} g`;
  }
  return base;
}

// Detalle del kardex por lado de la operación: si el item RECIBIÓ, dice qué
// se sumó y de dónde vino ("Desde 1x test + 2x TEST"); si el item APORTÓ,
// dice a dónde fue ("A producto TEST3 (4120002)"). El relato completo queda
// en el tooltip y en el panel de movimientos.
function kardexDetail(movement: InventoryMovement) {
  const raw = (movement.reason ?? "").trim();
  if (!raw) return "—";
  const match = raw.match(/^(?:conversion|conversión|ensamble):\s*(.+?)\s*(?:->|→)\s*(.+)$/i);
  if (!match) return raw;
  const [, from, to] = match;
  return movementSign(movement.movement_type) > 0 ? `Desde ${from}` : `A producto ${to}`;
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
  // Cambiar de pestaña vuelve al nivel tipos del drill-down de complementos.
  useEffect(() => {
    setComplementDrillGroup(null);
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
  // Drill-down de complementos: nivel actual (tipo → items). Estado propio,
  // no comparte el de producto terminado.
  const [complementDrillGroup, setComplementDrillGroup] = useState<string | null>(null);
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
  // Tipo de item que originó el modal de movimiento (fijado al abrirlo): decide
  // si el selector de item es el flat select o el picker de complementos.
  const [movementEntryType, setMovementEntryType] = useState<InventoryItemType | null>(null);
  const [isComplementPickerOpen, setIsComplementPickerOpen] = useState(false);
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [viewingItem, setViewingItem] = useState<InventoryItem | null>(null);
  // Borrador de factura XML: se revisa y clasifica cada linea antes de importar.
  const [xmlImportDraft, setXmlImportDraft] = useState<XmlImportDraft | null>(null);
  // Linea (indice dentro del borrador) para la que se abrio el picker de
  // "vincular a existente"; null = cerrado.
  const [linkPickerLineIndex, setLinkPickerLineIndex] = useState<number | null>(null);
  const [linkPickerSearch, setLinkPickerSearch] = useState("");
  // Filtro de seccion dentro del picker de vincular (TODOS = las tres).
  const [linkPickerType, setLinkPickerType] = useState<"TODOS" | InventoryItemType>("TODOS");
  const [isArchivedOpen, setIsArchivedOpen] = useState(false);
  // Orden cuya etapa actual se consulta (quien avanzo a esa etapa y cuando).
  const [stageInfoRun, setStageInfoRun] = useState<ProductionRun | null>(null);
  // Orden terminada cuyo historial de merma por fase se revisa.
  const [wasteHistoryRun, setWasteHistoryRun] = useState<ProductionRun | null>(null);
  // Orden terminada cuya recepcion se consulta (quien la recibio y cuando).
  const [receptionInfoRun, setReceptionInfoRun] = useState<ProductionRun | null>(null);
  // Conversión de lote de proceso terminado a producto del catálogo.
  const [convertRun, setConvertRun] = useState<ProductionRun | null>(null);
  // Destino de la conversión: pieza existente (target_item_id) o tipo del
  // catálogo (product_type_id, ej. producto recién creado). Uno de los dos.
  const [convertForm, setConvertForm] = useState({ material_code: "", material_type: "", product_type_id: "", target_item_id: "", quantity: "" });
  const [isConverting, setIsConverting] = useState(false);
  // Rechazo de solicitud de materiales: modal con motivo.
  const [rejectRun, setRejectRun] = useState<ProductionRun | null>(null);
  const [rejectReason, setRejectReason] = useState("");
  // Detalle de un rechazo ya registrado (desde movimientos/historial).
  const [rejectionInfoRun, setRejectionInfoRun] = useState<ProductionRun | null>(null);
  // Ensamble de piezas de productos terminados en un producto nuevo.
  const [isCombineOpen, setIsCombineOpen] = useState(false);
  // Piezas elegidas por ventana de catálogo; cantidad individual por pieza
  // POR ENSAMBLE (default 1) y número de ensambles iguales a producir.
  const [combineForm, setCombineForm] = useState({
    sources: [] as { itemId: string; quantity: string }[],
    material_code: "",
    material_type: "",
    purity: "",
    // Destino: pieza existente (target_item_id) o tipo del catálogo
    // (product_type_id, ej. producto recién creado). Uno de los dos.
    product_type_id: "",
    target_item_id: "",
    assemblies: "1",
  });
  const [isCombining, setIsCombining] = useState(false);
  // Ventana para agregar una pieza al ensamble.
  const [isPiecePickerOpen, setIsPiecePickerOpen] = useState(false);
  // Flujo del lote de proceso terminado: la ventana principal ofrece
  // "Agregar al catálogo" (conversión) o "Combinar" con un producto terminado.
  const [lotAction, setLotAction] = useState<"convert" | "combine" | null>(null);
  // Selector de producto del catálogo (drill-down); el modo dice a qué
  // formulario se escribe la selección.
  const [targetPickerFor, setTargetPickerFor] = useState<"combine" | "convert" | null>(null);
  // Alta de un producto nuevo del catálogo como destino de la conversión o
  // del ensamble (cuando la pieza aún no existe en el inventario).
  const [creatingTargetFor, setCreatingTargetFor] = useState<"convert" | "combine" | null>(null);
  // Ventana "ver materiales" de una categoría: materiales, piezas y stock.
  // Selector de la pieza de producto terminado con la que se combina el lote.
  const [isPartnerPickerOpen, setIsPartnerPickerOpen] = useState(false);
  // Edición del material de la pieza (lápiz junto al valor automático).
  const [materialEditFor, setMaterialEditFor] = useState<"convert" | "combine" | null>(null);
  // Kardex de cualquier item (pieza o lote); se abre desde su Visualizar.
  const [kardexItem, setKardexItem] = useState<InventoryItem | null>(null);
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

  useEffect(() => {
    if (itemFilter === "ORDENES_TERMINADAS") {
      setItemFilter("RAW_MATERIAL");
    }
  }, [itemFilter]);

  // "Procesos terminados" ya no vive en inventario: la sección Procesos de
  // producción lista las órdenes; aquí solo quedan los stocks.
  const visibleItemTypes = ITEM_TYPES.filter((tab) => tab.value !== "ORDENES_TERMINADAS");

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
    refetchInterval: 10000,
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

  // Tipos de complemento del catalogo: agrupan la pestaña Complementos.
  const { data: complementTypes = [] } = useQuery({
    queryKey: ["complement-types"],
    queryFn: listComplementTypes,
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
    if (!kardexItem) return [] as Array<{ movement: InventoryMovement; balanceAfter: number }>;
    const ascending = movements
      .filter((movement) => movement.item_id === kardexItem.id)
      .sort((left, right) => new Date(left.created_at).getTime() - new Date(right.created_at).getTime());
    let balance = 0;
    const withBalance = ascending.map((movement) => {
      balance += movementSign(movement.movement_type) * Number(movement.quantity);
      return { movement, balanceAfter: balance };
    });
    return withBalance.reverse();
  }, [movements, kardexItem]);
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
  // Insumos y complementos comparten el mismo formulario simple: nombre y
  // unidad, sin material ni pureza.
  const isSimpleItem = itemForm.item_type === "SUPPLY" || itemForm.item_type === "COMPLEMENT";
  // Salidas: productos terminados. Entradas: SOLO el tipo de la pestaña desde
  // la que se abrió (materia prima, insumos o complementos) — sin mezclar.
  const movementItemTypes: InventoryItemType[] =
    movementForm.movement_type === "SALIDA"
      ? ["FINISHED_PRODUCT"]
      : movementEntryType === "RAW_MATERIAL" || movementEntryType === "SUPPLY" || movementEntryType === "COMPLEMENT"
        ? [movementEntryType]
        : ["RAW_MATERIAL", "SUPPLY", "COMPLEMENT"];
  const movementItems = useMemo(
    () => items.filter((item) => !item.archived_at && movementItemTypes.includes(item.item_type)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [items, movementForm.movement_type, movementEntryType],
  );
  const movementSelectedItem = movementForm.item_id
    ? items.find((item) => item.id === movementForm.item_id) ?? null
    : null;
  // Archivados de la pestaña ACTIVA: cada menú (materia prima, insumos,
  // complementos, productos terminados) tiene su propia vista de archivados, no compartida.
  const archivedItems = useMemo(
    () =>
      items
        .filter((item) => item.archived_at && item.item_type === itemFilter)
        .sort((left, right) => (right.archived_at ?? "").localeCompare(left.archived_at ?? "")),
    [items, itemFilter],
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

  // Peso final efectivo de la orden (misma regla que el backend): el pesado
  // real al finalizar o el de la última etapa que pesó; una orden que nunca
  // pesó terminó con su peso inicial (materia prima total).
  function runFinalWeight(run: ProductionRun): number | null {
    const actual = Number(run.actual_finished_weight ?? 0);
    if (actual > 0) return actual;
    const weighed = [...run.stages]
      .sort((left, right) => left.stage_order - right.stage_order)
      .filter((stage) => Number(stage.final_weight ?? 0) > 0);
    if (weighed.length > 0) return Number(weighed[weighed.length - 1].final_weight);
    const initial = Number(run.total_required_material ?? 0);
    return initial > 0 ? initial : null;
  }

  // Cantidad producida de una orden con su equivalente en gramos.
  function runQuantityText(run: ProductionRun) {
    const total = runFinalWeight(run);
    return `${numericText(run.quantity)} unidades${total ? ` · ${numericText(String(total))} g` : ""}`;
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
  // Solicitudes rechazadas: también son parte del historial de inventario.
  const rejectedRuns = useMemo(
    () => productionRuns.filter((run) => run.status === "CANCELADA" && run.rejected_at),
    [productionRuns],
  );
  const rejectionDateKey = (run: ProductionRun) => {
    const date = new Date(run.rejected_at ?? "");
    return Number.isNaN(date.getTime()) ? null : dateKey(date);
  };
  const movementCountsByDate = useMemo(() => {
    const counts = sortedMovements.reduce<Map<string, number>>((acc, movement) => {
      const key = movementDateKey(movement);
      if (!key) return acc;
      acc.set(key, (acc.get(key) ?? 0) + 1);
      return acc;
    }, new Map());
    for (const run of rejectedRuns) {
      const key = rejectionDateKey(run);
      if (key) counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return counts;
  }, [sortedMovements, rejectedRuns]);
  // Registros del día: movimientos + rechazos de solicitudes, en orden temporal.
  const selectedDateEntries = useMemo(() => {
    const moves = sortedMovements
      .filter((movement) => movement.movement_type !== "CONVERSION_SALIDA")
      .filter((movement) => movementDateKey(movement) === selectedHistoryDate)
      .map((movement) => ({ kind: "movement" as const, movement, run: null, at: new Date(movement.created_at).getTime() }));
    const rejections = rejectedRuns
      .filter((run) => rejectionDateKey(run) === selectedHistoryDate)
      .map((run) => ({ kind: "rejection" as const, movement: null, run, at: new Date(run.rejected_at ?? "").getTime() }));
    return [...moves, ...rejections].sort((left, right) => right.at - left.at);
  }, [selectedHistoryDate, sortedMovements, rejectedRuns]);
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
      movement.movement_type !== "CONVERSION_SALIDA" &&
      matchesSearchTokens(historySearch, [
        movement.item.name,
        movement.item.sku,
        movement.item.material_type,
        itemTypeLabel(movement.item.item_type),
        movementOperationLabel(movement),
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
      void queryClient.invalidateQueries({ queryKey: ["production"] });
      setPrintPreview({ run: updated, mode: "entrega" });
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "No se pudo aprobar la salida de materia prima.");
    } finally {
      setIsSavingProduction(false);
    }
  }

  function openRejectModal(run: ProductionRun) {
    setRejectReason("");
    setRejectRun(run);
  }

  async function handleRejectMaterials(run: ProductionRun, reason: string) {
    setError(null);
    setIsSavingProduction(true);
    try {
      await rejectProductionRunMaterials(run.id, reason);
      setRejectRun(null);
      setSuccess("Solicitud rechazada. La orden fue cancelada.");
      const nextRuns = await listProductionRuns();
      const remaining = nextRuns.filter((r) => r.status === "PENDIENTE_INVENTARIO" || r.status === "PENDIENTE_RECEPCION").length;
      if (remaining === 0) {
        setIsSolicitudesOpen(false);
      }
      void queryClient.invalidateQueries({ queryKey: ["inventory"] });
      void queryClient.invalidateQueries({ queryKey: ["solicitudes"] });
      void queryClient.invalidateQueries({ queryKey: ["production"] });
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
      void queryClient.invalidateQueries({ queryKey: ["production"] });
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
        ...(convertForm.material_code ? { material_code: convertForm.material_code } : {}),
        material_type: convertForm.material_type.trim() || null,
        ...(convertForm.target_item_id
          ? { target_item_id: convertForm.target_item_id }
          : { product_type_id: convertForm.product_type_id }),
        quantity: convertForm.quantity,
      });
      setSuccess("Lote convertido en productos terminados.");
      setConvertRun(null);
      setConvertForm({ material_code: "", material_type: "", product_type_id: "", target_item_id: "", quantity: "" });
      // Un material nuevo crea su segmento en el catálogo: refrescar etiquetas.
      await queryClient.invalidateQueries({ queryKey: ["inventory"] });
      await queryClient.invalidateQueries({ queryKey: ["catalog-segments"] });
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "No se pudo convertir el lote.");
    } finally {
      setIsConverting(false);
    }
  }

  // Empata el texto de material de una pieza con el segmento del catálogo
  // (para armar el código de producto). Lógica compartida con producción
  // (lib/material-match.ts): exacto primero; si no, el segmento cuya
  // etiqueta esté contenida en el texto (ej. "ORO 18K" → ORO), tomando la
  // etiqueta más larga que calce.
  function matchMaterialSegment(text: string | null | undefined) {
    return matchMaterialSegmentShared(text, catalogSegments);
  }

  // REGLA ÚNICA: el material y la pureza del ensamble son los de la pieza
  // que aporta MÁS GRAMOS, y punto (el dígito del código ya distingue
  // material; no hay textos combinados). Empate o aporte desconocido → la
  // primera pieza. El lápiz permite elegir otro; el backend aplica la misma
  // regla como respaldo.
  function deriveCombineMaterial(sources: { itemId: string; quantity?: string }[]) {
    const materialSegments = catalogSegments.filter((segment) => segment.kind === "MATERIAL" && segment.is_active);
    const selected = sources
      .map((line) => ({ line, item: items.find((item) => item.id === line.itemId) }))
      .filter((entry): entry is { line: { itemId: string; quantity?: string }; item: InventoryItem } =>
        Boolean(entry.item),
      );
    if (selected.length === 0) return { material_code: "", material_type: "", purity: "" };
    let dominant = selected[0];
    let best: number | null = null;
    const allKnown = selected.every(({ item }) => Number(item.weight_per_unit ?? 0) > 0);
    if (allKnown) {
      for (const entry of selected) {
        const qty = Number(entry.line.quantity ?? "1");
        const grams = Number(entry.item.weight_per_unit) * (Number.isFinite(qty) && qty > 0 ? qty : 1);
        if (best === null || grams > best) {
          best = grams;
          dominant = entry;
        }
      }
    }
    const digit = dominant.item.product_code?.[0];
    const segment = materialSegments.find((candidate) => candidate.code === digit);
    const label = segment?.label ?? dominant.item.material_type?.trim() ?? "";
    // Segmento para el código: el de la pieza dominante; si no tiene, el de
    // cualquier pieza con código válido.
    const fallbackCode = selected
      .map(({ item }) => item.product_code?.[0])
      .find((code) => code && materialSegments.some((candidate) => candidate.code === code));
    return {
      material_code: segment?.code ?? fallbackCode ?? "",
      material_type: label,
      purity: (dominant.item.purity ?? "").trim(),
    };
  }

  async function handleCombineProducts(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setIsCombining(true);
    try {
      await combineProducts({
        // Cantidad por pieza POR ENSAMBLE × número de ensambles = total que
        // se descuenta de cada pieza; se producen `assemblies` resultantes.
        sources: combineForm.sources.map((line) => ({
          item_id: line.itemId,
          quantity: String(Number(line.quantity) * Number(combineForm.assemblies)),
        })),
        material_code: combineForm.material_code,
        material_type: combineForm.material_type.trim() || null,
        ...(combineForm.target_item_id
          ? { target_item_id: combineForm.target_item_id }
          : { product_type_id: combineForm.product_type_id }),
        quantity: combineForm.assemblies,
        purity: combineForm.purity.trim() || null,
      });
      setSuccess("Piezas ensambladas en producto terminado.");
      setIsCombineOpen(false);
      await queryClient.invalidateQueries({ queryKey: ["inventory"] });
      await queryClient.invalidateQueries({ queryKey: ["catalog-segments"] });
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "No se pudo ensamblar el producto.");
    } finally {
      setIsCombining(false);
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
  // Piezas agotadas se quedan con su semáforo hasta que se archiven (misma
  // lógica que materia prima/insumos); archivadas salen de la vista pero
  // siguen existiendo y los selectores de destino las ofrecen: una nueva
  // asignación o ensamble las reactiva solas.
  const displayItems =
    itemFilter === "FINISHED_PRODUCT" ? filteredItems.filter((item) => !receivedCodes.has(item.sku)) : filteredItems;

  // Grupos por nombre (categoria) y dentro por producto del catalogo SIN el
  // material (categoria+modelo): un mismo producto puede existir en varios
  // materiales y cada material es una seccion del producto, no otro producto.
  const finishedGroups = useMemo(() => {
    const modelLabels = new Map<string, string>();
    for (const segment of catalogSegments) {
      if (segment.kind === "MODEL" && segment.parent_code) {
        modelLabels.set(`${segment.parent_code}${segment.code}`, segment.label);
      }
    }
    const categoryLabel = (code: string) =>
      catalogSegments.find((segment) => segment.kind === "CATEGORY" && segment.code === code)?.label ?? null;
    const materialLabel = (digit: string) =>
      catalogSegments.find((segment) => segment.kind === "MATERIAL" && segment.code === digit)?.label ?? "SIN MATERIAL";
    // Nivel 1 por CATEGORÍA del código, no por nombre: productos distintos de
    // la misma categoría (ej. TEST y TEST3) viven bajo el mismo tipo. Piezas
    // sin código de producto agrupan por nombre.
    const map = new Map<string, InventoryItem[]>();
    for (const item of displayItems) {
      const pcode = item.product_code ?? "";
      const key = pcode.length === 7 ? `cat:${pcode.slice(1, 3)}` : `name:${item.name}`;
      const list = map.get(key);
      if (list) list.push(item);
      else map.set(key, [item]);
    }
    const groups = [...map.entries()].map(([key, groupItems]) => {
      const sorted = [...groupItems].sort((a, b) => a.sku.localeCompare(b.sku));
      const categoryCode = key.startsWith("cat:") ? key.slice(4) : "—";
      const name = key.startsWith("cat:")
        ? categoryLabel(categoryCode) ?? sorted[0]?.name ?? categoryCode
        : sorted[0]?.name ?? "—";
      // Producto = categoria+modelo (código sin el dígito de material).
      const byModel = new Map<string, InventoryItem[]>();
      for (const item of sorted) {
        const pcode = item.product_code ?? "";
        const modelKey = pcode.length === 7 ? pcode.slice(1) : "";
        const list = byModel.get(modelKey);
        if (list) list.push(item);
        else byModel.set(modelKey, [item]);
      }
      const buildMaterials = (modelCode: string, modelItems: InventoryItem[]) => {
        // Secciones por material dentro del producto.
        const byMaterial = new Map<string, InventoryItem[]>();
        for (const item of modelItems) {
          const digit = (item.product_code ?? "").length === 7 ? (item.product_code as string)[0] : "";
          const list = byMaterial.get(digit);
          if (list) list.push(item);
          else byMaterial.set(digit, [item]);
        }
        return [...byMaterial.entries()]
          .sort(([a], [b]) => a.localeCompare(b))
          .map(([digit, materialItems]) => ({
            digit,
            fullCode: digit && modelCode ? `${digit}${modelCode}` : "",
            // Sin dígito de material: cae al texto del material de la pieza.
            label: digit ? materialLabel(digit) : materialItems[0]?.material_type?.trim() || "SIN MATERIAL",
            items: materialItems,
            stock: materialItems.reduce((acc, it) => acc + Number(it.current_stock), 0),
          }));
      };
      const models = [...byModel.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .flatMap(([modelCode, modelItems]) => {
          // Tipos distintos pueden compartir código (TEST y TEST3, ambos
          // x530001): si hay varios nombres en el mismo modelo, cada nombre
          // es su propio producto en la lista.
          const names = [...new Set(modelItems.map((item) => item.name))].sort((a, b) => a.localeCompare(b));
          const buckets =
            names.length > 1
              ? names.map((pieceName) => ({
                  key: `${modelCode}|${pieceName}`,
                  label: pieceName,
                  items: modelItems.filter((item) => item.name === pieceName),
                }))
              : [
                  {
                    key: modelCode,
                    label: modelCode ? modelLabels.get(modelCode) ?? "SIN MODELO" : "SIN MODELO",
                    items: modelItems,
                  },
                ];
          return buckets.map((bucket) => ({
            key: bucket.key,
            code: modelCode,
            label: bucket.label,
            materials: buildMaterials(modelCode, bucket.items),
            items: bucket.items,
            totalStock: bucket.items.reduce((acc, it) => acc + Number(it.current_stock), 0),
          }));
        });
      return {
        name,
        categoryCode,
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
  // Nivel piezas (tipo → productos directo): listado plano de las piezas del
  // tipo elegido, ordenado por código.
  const pieceRows = useMemo(() => {
    if (searchActive) {
      return displayItems.map((item) => ({ kind: "item" as const, item, material: null as null }));
    }
    const items = (drilledGroup?.models ?? []).flatMap((model) => model.items);
    return items.map((item) => ({ kind: "item" as const, item, material: null as null }));
  }, [searchActive, displayItems, drilledGroup]);
  const piecesPager = usePagination(pieceRows, TAB_PAGE_SIZE, `${drillGroup ?? ""}|${search}`);
  // Drill-down de complementos: tipo → items. Sin tipo (o tipo eliminado) cae
  // al grupo "Sin tipo", que siempre queda al final.
  const complementTypeNameById = useMemo(
    () => new Map(complementTypes.map((type) => [type.id, type.name])),
    [complementTypes],
  );
  const complementGroups = useMemo(() => {
    const byName = new Map<string, InventoryItem[]>();
    for (const item of displayItems) {
      const name = (item.complement_type_id && complementTypeNameById.get(item.complement_type_id)) || "Sin tipo";
      const list = byName.get(name);
      if (list) list.push(item);
      else byName.set(name, [item]);
    }
    const groups = [...byName.entries()].map(([name, groupItems]) => ({
      name,
      items: groupItems,
      itemCount: groupItems.length,
      totalStock: groupItems.reduce((acc, it) => acc + Number(it.current_stock), 0),
      unitCode: groupItems[0]?.unit_code ?? "und",
    }));
    return groups.sort((a, b) => {
      if (a.name === "Sin tipo") return 1;
      if (b.name === "Sin tipo") return -1;
      return a.name.localeCompare(b.name);
    });
  }, [displayItems, complementTypeNameById]);
  const complementDrilledGroup = complementGroups.find((g) => g.name === complementDrillGroup) ?? null;
  const complementGroupsPager = usePagination(complementGroups, TAB_PAGE_SIZE, filterKey);
  const complementItemRows = useMemo(() => {
    if (searchActive) return displayItems.map((item) => ({ item }));
    return (complementDrilledGroup?.items ?? []).map((item) => ({ item }));
  }, [searchActive, displayItems, complementDrilledGroup]);
  const complementItemsPager = usePagination(complementItemRows, TAB_PAGE_SIZE, `${complementDrillGroup ?? ""}|${search}`);
  const receivedRunsPager = usePagination(receivedRunsFiltered, TAB_PAGE_SIZE, filterKey);
  const wipRows = [
    ...inProcessRunsFiltered.map((run) => ({ kind: "run" as const, run, item: null })),
    ...displayItems.map((item) => ({ kind: "item" as const, run: null, item })),
  ];
  const wipPager = usePagination(wipRows, TAB_PAGE_SIZE, filterKey);
  // Últimos movimientos de todo el inventario, sin filtro por pestaña ni fecha.
  // Los rechazos de solicitudes también son movimientos de inventario.
  const movementPanelEntries = useMemo(() => {
    // Conversión/ensamble = una operación: se muestra solo la ENTRADA (su
    // detalle ya cuenta la salida); el asiento de salida vive en el kardex
    // del item de origen.
    const moves = sortedMovements
      .filter((movement) => movement.movement_type !== "CONVERSION_SALIDA")
      .map((movement) => ({
        kind: "movement" as const,
        movement,
        run: null,
        at: new Date(movement.created_at).getTime(),
      }));
    const rejections = rejectedRuns.map((run) => ({
      kind: "rejection" as const,
      movement: null,
      run,
      at: new Date(run.rejected_at ?? "").getTime(),
    }));
    return [...moves, ...rejections].sort((left, right) => right.at - left.at);
  }, [sortedMovements, rejectedRuns]);
  const movementsPager = usePagination(movementPanelEntries, MOVEMENTS_PAGE_SIZE);
  const kardexPager = usePagination(viewingItemKardex, MOVEMENTS_PAGE_SIZE, kardexItem?.id ?? "");
  // Archivados: 5 por página dentro del modal; vuelve a la primera al abrir.
  const archivedPager = usePagination(archivedItems, 5, String(isArchivedOpen));
  // Lineas de factura XML en revision: 5 por página dentro del modal.
  const xmlLinesPager = usePagination(xmlImportDraft?.lines ?? [], 5, xmlImportDraft?.fileName ?? "");
  // Etapas del historial de merma: en orden de proceso, 5 por página.
  const wasteStages = useMemo(
    () => (wasteHistoryRun ? [...wasteHistoryRun.stages].sort((left, right) => left.stage_order - right.stage_order) : []),
    [wasteHistoryRun],
  );
  // Historial por calendario: 4 por página (el panel de movimientos sigue en 3).
  const historyDayPager = usePagination(selectedDateEntries, 4, selectedHistoryDate);
  const historySearchEntries = useMemo(
    () =>
      historySearchResults.map((movement) => ({
        kind: "movement" as const,
        movement,
        run: null,
        at: new Date(movement.created_at).getTime(),
      })),
    [historySearchResults],
  );
  const historyResultsPager = usePagination(historySearchEntries, 4, historySearch);

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
    // Preselecciona un item del tipo de la pestaña activa (materia prima, insumo o complemento).
    const entryType = itemFilter === "SUPPLY" ? "SUPPLY" : itemFilter === "COMPLEMENT" ? "COMPLEMENT" : "RAW_MATERIAL";
    const firstItem = entryType === "COMPLEMENT" ? undefined : items.find((item) => item.item_type === entryType);
    setMovementForm({ ...emptyMovementForm(), item_id: firstItem?.id || "", movement_type: "ENTRADA" });
    setMovementEntryType(entryType);
    setIsMovementFormOpen(true);
    setIsEntryMenuOpen(false);
  }

  function openFinishedProductExit() {
    const firstFinishedProduct = items.find((item) => item.item_type === "FINISHED_PRODUCT");
    setMovementForm({ ...emptyMovementForm(), item_id: firstFinishedProduct?.id || "", movement_type: "SALIDA" });
    setMovementEntryType("FINISHED_PRODUCT");
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
      const materialType = itemForm.material_type?.trim() || "";
      if (!isEditingXmlItem && !materialType) {
        setError(
          itemForm.item_type === "SUPPLY"
            ? "Escribe el nombre del insumo."
            : itemForm.item_type === "COMPLEMENT"
              ? "Escribe el nombre del complemento."
              : "Escribe el tipo de materia prima.",
        );
        setIsSaving(false);
        return;
      }
      const payload = {
        ...itemForm,
        // Para materia prima el nombre ES el tipo (ya no hay campo Nombre aparte);
        // para insumos y complementos el campo es directamente el nombre.
        name: isEditingXmlItem ? itemForm.name : materialType,
        description: isEditingXmlItem ? editingItem?.description ?? null : itemForm.description?.trim() || null,
        unit_code: isEditingXmlItem ? editingItem?.unit_code ?? itemForm.unit_code : itemForm.unit_code,
        material_type: isEditingXmlItem ? editingItem?.material_type ?? null : isSimpleItem ? null : materialType,
        purity: isEditingXmlItem ? editingItem?.purity ?? null : isSimpleItem ? null : itemForm.purity?.trim() || null,
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
    if (!movementForm.item_id) {
      setError("Elige el complemento.");
      return;
    }
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

      // Pre-clasifica cada linea: nombre ya existente en inventario entra a
      // ese item (tipo bloqueado); si es nueva, default segun la pestaña activa.
      const defaultType: InventoryItemType =
        itemFilter === "SUPPLY" ? "SUPPLY" : itemFilter === "COMPLEMENT" ? "COMPLEMENT" : "RAW_MATERIAL";
      const lines = invoice.details.map<XmlImportLine>((detail) => {
        const matches = items.filter(
          (candidate) =>
            (candidate.item_type === "RAW_MATERIAL" || candidate.item_type === "SUPPLY" || candidate.item_type === "COMPLEMENT") &&
            candidate.name.toLowerCase() === detail.description.toLowerCase(),
        );
        const existingItem = matches.find((candidate) => candidate.item_type === defaultType) ?? matches[0] ?? null;
        return { ...detail, itemType: existingItem?.item_type ?? defaultType, existingItem, complementTypeId: null };
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
    const missingComplementType = xmlImportDraft.lines.some(
      (line) => !line.existingItem && line.itemType === "COMPLEMENT" && !line.complementTypeId,
    );
    if (missingComplementType) {
      setError("Elige el tipo de complemento en las líneas marcadas como complemento.");
      return;
    }
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
            complement_type_id: line.itemType === "COMPLEMENT" ? line.complementTypeId : undefined,
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
          {error ? <ToastNotice key={error} kind="error" message={error} onClose={() => setError(null)} progress /> : null}
          {success ? <ToastNotice key={success} kind="success" message={success} onClose={() => setSuccess(null)} progress /> : null}
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
                    : itemFilter === "COMPLEMENT"
                      ? "Empaques y accesorios para ensamble de produccion"
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
              {itemFilter === "COMPLEMENT" ? (
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
              {(itemFilter === "RAW_MATERIAL" || itemFilter === "SUPPLY" || itemFilter === "COMPLEMENT" || itemFilter === "FINISHED_PRODUCT") &&
              archivedItems.length > 0 ? (
                <button className="button" onClick={() => setIsArchivedOpen(true)} type="button">
                  <Inbox aria-hidden="true" size={17} />
                  Archivados ({archivedItems.length})
                </button>
              ) : null}
              {itemFilter === "FINISHED_PRODUCT" ? (
                <>
                  <button className="button" onClick={openFinishedProductExit} type="button">
                    <Minus aria-hidden="true" size={17} />
                    Salida
                  </button>
                  <button
                    className="button"
                    onClick={() => {
                      setCombineForm({
                        sources: [],
                        material_code: "",
                        material_type: "",
                        purity: "",
                        product_type_id: "",
                        target_item_id: "",
                        assemblies: "1",
                      });
                      setIsCombineOpen(true);
                    }}
                    type="button"
                  >
                    <Repeat aria-hidden="true" size={17} />
                    Ensamblar
                  </button>
                </>
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
              {visibleItemTypes.map((type) => (
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
                        <td style={{ maxWidth: 240, overflow: "hidden", textOverflow: "ellipsis" }} title={item.description ?? undefined}>{item.description ?? "—"}</td>
                        <td>{item.purity ?? "—"}</td>
                        <td className="num">{itemStockText(item)}</td>
                        <td><span className={`stockBadge stockBadge--${status.level}`}>{status.label}</span></td>
                        <td className="num">$ {numericText(averageCost)}</td>
                        <td className="num">$ {numericText(String(totalValue))}</td>
                        <td>
                          <div className="rowActions">
                            {canArchive(item) ? (
                              <button
                                aria-label="Archivar item agotado"
                                className={`iconOnlyButton${suggestion ? " archiveSuggested" : ""}`}
                                onClick={() => void handleArchiveItem(item)}
                                title={suggestion ?? "Archivar item agotado"}
                                type="button"
                              >
                                <Inbox aria-hidden="true" size={15} />
                              </button>
                            ) : null}
                            <button aria-label="Visualizar" className="iconOnlyButton" onClick={() => setViewingItem(item)} title="Visualizar" type="button">
                              <Eye aria-hidden="true" size={15} />
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
                        <td style={{ maxWidth: 240, overflow: "hidden", textOverflow: "ellipsis" }} title={item.description ?? undefined}>{item.description ?? "—"}</td>
                        <td className="num">{itemStockText(item)}</td>
                        <td><span className={`stockBadge stockBadge--${status.level}`}>{status.label}</span></td>
                        <td className="num">$ {numericText(averageCost)}</td>
                        <td className="num">$ {numericText(String(totalValue))}</td>
                        <td>
                          <div className="rowActions">
                            {canArchive(item) ? (
                              <button
                                aria-label="Archivar item agotado"
                                className={`iconOnlyButton${suggestion ? " archiveSuggested" : ""}`}
                                onClick={() => void handleArchiveItem(item)}
                                title={suggestion ?? "Archivar item agotado"}
                                type="button"
                              >
                                <Inbox aria-hidden="true" size={15} />
                              </button>
                            ) : null}
                            <button aria-label="Visualizar" className="iconOnlyButton" onClick={() => setViewingItem(item)} title="Visualizar" type="button">
                              <Eye aria-hidden="true" size={15} />
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
          ) : itemFilter === "COMPLEMENT" ? (
            <div style={{ display: "flex", flexDirection: "column", flex: "1 1 auto", gap: 10, minHeight: 0 }}>
              {complementDrilledGroup ? (
                <div className="drillBar">
                  <button className="button" onClick={() => setComplementDrillGroup(null)} type="button">
                    <ChevronLeft aria-hidden="true" size={15} /> Volver
                  </button>
                  <span className="drillCrumbs">
                    <button onClick={() => setComplementDrillGroup(null)} type="button">Complementos</button>
                    <span className="drillCrumbSep">/</span>
                    <span>{complementDrilledGroup.name}</span>
                  </span>
                </div>
              ) : null}

              {searchActive || complementDrilledGroup ? (
                // Nivel items (o búsqueda global): la tabla de complementos de siempre.
                <div className="tableWrap">
                  <table className="table inventoryItemsTable">
                    <thead>
                      <tr>
                        <th className="num" style={{ width: 40 }}>#</th>
                        <th>Complemento</th>
                        <th>Ley/pureza</th>
                        <th className="num">Stock</th>
                        <th>Estado</th>
                        <th aria-label="Acciones" />
                      </tr>
                    </thead>
                    <tbody>
                      {complementItemsPager.pageItems.map((row, index) => {
                        const item = row.item;
                        const status = stockStatus(item);
                        const suggestion = archiveSuggestion(item);
                        return (
                          <tr key={item.id}>
                            <td className="num">{complementItemsPager.page * complementItemsPager.pageSize + index + 1}</td>
                            <td>{item.name}</td>
                            <td>{item.purity ?? "—"}</td>
                            <td className="num">{itemStockText(item)}</td>
                            <td><span className={`stockBadge stockBadge--${status.level}`}>{status.label}</span></td>
                            <td>
                              <div className="rowActions">
                                {canArchive(item) ? (
                                  <button
                                    aria-label="Archivar item agotado"
                                    className={`iconOnlyButton${suggestion ? " archiveSuggested" : ""}`}
                                    onClick={() => void handleArchiveItem(item)}
                                    title={suggestion ?? "Archivar item agotado"}
                                    type="button"
                                  >
                                    <Inbox aria-hidden="true" size={15} />
                                  </button>
                                ) : null}
                                <button aria-label="Visualizar" className="iconOnlyButton" onClick={() => setViewingItem(item)} title="Visualizar" type="button">
                                  <Eye aria-hidden="true" size={15} />
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                      {searchActive && complementItemRows.length === 0 ? (
                        <tr><td colSpan={6}><div className="emptyState">Sin resultados para la búsqueda.</div></td></tr>
                      ) : null}
                      {!isLoading && !searchActive && complementItemRows.length === 0 ? (
                        <tr><td colSpan={6}><div className="emptyState">Sin complementos registrados. Crea el primero.</div></td></tr>
                      ) : null}
                      {isLoading ? (
                        <tr><td colSpan={6}><div className="emptyState">Cargando inventario...</div></td></tr>
                      ) : null}
                    </tbody>
                  </table>
                  <Pager {...complementItemsPager} />
                </div>
              ) : (
                // Nivel tipos: headers de tipo.
                <div className="tableWrap">
                  <table className="table inventoryItemsTable tableAuto">
                    <thead>
                      <tr>
                        <th>Tipo</th>
                        <th className="num">Complementos</th>
                        <th className="num">Stock</th>
                        <th aria-label="Abrir" />
                      </tr>
                    </thead>
                    <tbody>
                      {complementGroupsPager.pageItems.map((group) => (
                        <tr key={group.name} onClick={() => setComplementDrillGroup(group.name)} style={{ cursor: "pointer" }}>
                          <td><strong>{group.name}</strong></td>
                          <td className="num">{group.itemCount}</td>
                          <td className="num">{numericText(String(group.totalStock))} {group.unitCode}</td>
                          <td style={{ textAlign: "right" }}><ChevronRight aria-hidden="true" size={15} /></td>
                        </tr>
                      ))}
                      {!isLoading && complementGroups.length === 0 ? (
                        <tr><td colSpan={4}><div className="emptyState">Sin complementos registrados. Crea el primero.</div></td></tr>
                      ) : null}
                      {isLoading ? (
                        <tr><td colSpan={4}><div className="emptyState">Cargando inventario...</div></td></tr>
                      ) : null}
                    </tbody>
                  </table>
                  <Pager {...complementGroupsPager} />
                </div>
              )}
            </div>
          ) : itemFilter === "FINISHED_PRODUCT" ? (
            <div style={{ display: "flex", flexDirection: "column", flex: "1 1 auto", gap: 10, minHeight: 0 }}>
              {drilledGroup ? (
                <div className="drillBar">
                  <button className="button" onClick={() => setDrillGroup(null)} type="button">
                    <ChevronLeft aria-hidden="true" size={15} /> Volver
                  </button>
                  <span className="drillCrumbs">
                    <button onClick={() => setDrillGroup(null)} type="button">Productos</button>
                    <span className="drillCrumbSep">/</span>
                    <span>{drilledGroup.name}</span>
                  </span>
                </div>
              ) : null}

              {searchActive || drilledGroup ? (
                // Nivel piezas (o búsqueda global): headers de pieza.
                <div className="tableWrap">
                  <table className="table inventoryItemsTable tableAuto">
                    <thead>
                      <tr>
                        <th>Lote</th>
                        <th>Producto</th>
                        <th>Metal principal</th>
                        <th>Ley/pureza</th>
                        <th className="num">Stock</th>
                        <th>Estado</th>
                        <th aria-label="Acciones" />
                      </tr>
                    </thead>
                    <tbody>
                      {piecesPager.pageItems.map((row) => {
                        if (!row.item) return null;
                        const item = row.item;
                        const status = stockStatus(item);
                        const suggestion = archiveSuggestion(item);
                        return (
                          <tr key={item.id}>
                            <td>{item.sku}</td>
                            <td>{(item.description ?? "").trim() || item.name}</td>
                            <td>{item.material_type ?? "—"}</td>
                            <td>{item.purity ?? "—"}</td>
                            <td className="num">{itemStockText(item)}</td>
                            <td><span className={`stockBadge stockBadge--${status.level}`}>{status.label}</span></td>
                            <td>
                              <div className="rowActions">
                                {canArchive(item) ? (
                                  <button
                                    aria-label="Archivar pieza agotada"
                                    className={`iconOnlyButton${suggestion ? " archiveSuggested" : ""}`}
                                    onClick={() => void handleArchiveItem(item)}
                                    title={suggestion ?? "Archivar pieza agotada"}
                                    type="button"
                                  >
                                    <Inbox aria-hidden="true" size={15} />
                                  </button>
                                ) : null}
                                <button aria-label="Visualizar" className="iconOnlyButton" onClick={(event) => { event.stopPropagation(); setViewingItem(item); }} title="Visualizar" type="button">
                                  <Eye aria-hidden="true" size={15} />
                                </button>
                              </div>
                            </td>
                          </tr>
                        );
                      })}
                      {searchActive && displayItems.length === 0 ? (
                        <tr><td colSpan={7}><div className="emptyState">Sin resultados para la búsqueda.</div></td></tr>
                      ) : null}
                    </tbody>
                  </table>
                  <Pager {...piecesPager} />
                </div>
              ) : (
                // Nivel tipos: headers de tipo.
                <div className="tableWrap">
                  <table className="table inventoryItemsTable tableAuto">
                    <thead>
                      <tr>
                        <th>Tipo</th>
                        <th className="num">Productos</th>
                        <th className="num">Stock</th>
                        <th aria-label="Abrir" />
                      </tr>
                    </thead>
                    <tbody>
                      {finishedTypesPager.pageItems.map((group) => (
                        <tr key={group.name} onClick={() => setDrillGroup(group.name)} style={{ cursor: "pointer" }}>
                          <td><strong>{group.name}</strong></td>
                          <td className="num">{group.models.length}</td>
                          <td className="num">{numericText(String(group.totalStock))} {group.unitCode}</td>
                          <td style={{ textAlign: "right" }}><ChevronRight aria-hidden="true" size={15} /></td>
                        </tr>
                      ))}
                      {!isLoading && finishedGroups.length === 0 ? (
                        <tr><td colSpan={4}><div className="emptyState">No hay productos terminados.</div></td></tr>
                      ) : null}
                      {isLoading ? (
                        <tr><td colSpan={4}><div className="emptyState">Cargando inventario...</div></td></tr>
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
                    <th className="num">Stock</th>
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
                      {/* Stock ACTUAL del lote (baja con cada conversión):
                          unidades restantes y su peso equivalente (restante ×
                          gramos por unidad del peso final de la orden). */}
                      <td className="num">{(() => {
                        const units = lotItem ? lotStock : Number(run.quantity);
                        const total = runFinalWeight(run);
                        const perUnit = total && Number(run.quantity) > 0 ? total / Number(run.quantity) : null;
                        const grams = perUnit !== null ? Number((units * perUnit).toFixed(2)) : null;
                        return `${numericText(String(units))} und${grams !== null ? ` · ${numericText(String(grams))} g` : ""}`;
                      })()}</td>
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
                          <button aria-label="Visualizar" className="iconOnlyButton" onClick={() => setViewingRun(run)} title="Visualizar" type="button">
                            <Eye aria-hidden="true" size={15} />
                          </button>
                          <button
                            aria-label="Agregar al catálogo o combinar"
                            className="iconOnlyButton"
                            disabled={!lotItem || lotStock <= 0}
                            onClick={() => {
                              // Material de la pieza: automático del lote; si el
                              // lote no lo trae (lotes viejos), sale de la materia
                              // prima de la orden de producción.
                              const rawMaterial = items.find((candidate) => candidate.id === run.raw_material_item_id) ?? null;
                              const lotMaterial =
                                lotItem?.material_type?.trim() ||
                                rawMaterial?.material_type?.trim() ||
                                rawMaterial?.name ||
                                "";
                              setConvertForm({
                                material_code: matchMaterialSegment(lotMaterial)?.code ?? "",
                                material_type: lotMaterial,
                                product_type_id: "",
                                target_item_id: "",
                                quantity: "",
                              });
                              setLotAction(null);
                              setMaterialEditFor(null);
                              setConvertRun(run);
                            }}
                            title={!lotItem || lotStock <= 0 ? "Lote agotado" : "Agregar al catálogo o combinar"}
                            type="button"
                          >
                            <Repeat aria-hidden="true" size={15} />
                          </button>
                        </div>
                      </td>
                    </tr>
                    );
                  })}
                  {receivedRunsFiltered.length === 0 ? (
                    <tr><td colSpan={6}><div className="emptyState">{anyAdvancedFilter ? "Sin procesos para los filtros." : "No hay procesos terminados."}</div></td></tr>
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
                        <td className="num">
                          <button
                            className="iconTextButton"
                            onClick={() => setWasteHistoryRun(run)}
                            title="Ver merma por fase"
                            type="button"
                          >
                            {numericText(String(currentWaste))} {run.raw_material_unit_code}
                          </button>
                        </td>
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
                            <button aria-label="Visualizar" className="iconOnlyButton" onClick={() => setViewingRun(run)} title="Visualizar" type="button">
                              <Eye aria-hidden="true" size={15} />
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
                      <td className="num">{itemStockText(item)}</td>
                      <td className="num">—</td>
                      <td className="num">—</td>
                      <td>—</td>
                      <td>—</td>
                      <td>
                        <div className="rowActions">
                          <button aria-label="Visualizar" className="iconOnlyButton" onClick={() => setViewingItem(item)} title="Visualizar" type="button">
                            <Eye aria-hidden="true" size={15} />
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
              aria-label="Abrir historial por calendario"
              className="iconTextButton"
              disabled={movements.length === 0}
              onClick={openMovementHistory}
              title="Historial por calendario"
              type="button"
            >
              <CalendarDays aria-hidden="true" size={16} />
              Historial
            </button>
          </div>
          <div className="movementList">
            {movementsPager.pageItems.map((entry) => {
              if (entry.kind === "rejection" && entry.run) {
                const run = entry.run;
                return (
                  <article className="movementRow" key={`rej-${run.id}`} {...openableProps(() => setRejectionInfoRun(run), `Ver rechazo de ${run.process_name}`)}>
                    <div>
                      <strong className="dangerText">Solicitud rechazada</strong>
                      {run.production_code ? (
                        <span style={{ fontFamily: "monospace", fontSize: 11, color: "var(--primary-strong)", fontWeight: 700 }}>{run.production_code}</span>
                      ) : null}
                      <span>{movementDateLabel(run.rejected_at ?? "")} - {run.process_name}</span>
                    </div>
                    <div>
                      <strong className="num">{numericText(run.total_required_material)} {run.raw_material_unit_code}</strong>
                      <span>
                        {movementTimeLabel(run.rejected_at ?? "")}
                        {run.rejection_reason ? ` - ${run.rejection_reason}` : " - Sin motivo"}
                        {run.rejected_by_name ? ` · ${run.rejected_by_name}` : ""}
                      </span>
                    </div>
                    <span className="rowActions" onClick={stopClick}>
                      <button className="iconTextButton" onClick={() => setRejectionInfoRun(run)} type="button">
                        <Eye aria-hidden="true" size={15} />
                        Visualizar
                      </button>
                    </span>
                  </article>
                );
              }
              if (!entry.movement) return null;
              const movement = entry.movement;
              return (
              <article className="movementRow" key={movement.id} {...openableProps(() => setViewingMovement(movement), `Ver movimiento de ${movement.item.name}`)}>
                <div>
                  <strong>{movementOperationLabel(movement)}</strong>
                  {movement.lot_code ? (
                    <span style={{ fontFamily: "monospace", fontSize: 11, color: "var(--primary-strong)", fontWeight: 700 }}>{movement.lot_code}</span>
                  ) : null}
                  <span>{movementDateLabel(movement.created_at)} - {movement.item.name}</span>
                </div>
                <div>
                  <strong className="num">{movementAmountText(movement)}</strong>
                  <span>
                    {movementTimeLabel(movement.created_at)}
                    {movement.reason ? ` - ${movement.reason}` : ""}
                    {movement.created_by_name ? ` · ${movement.created_by_name}` : ""}
                  </span>
                </div>
                <span className="rowActions" onClick={stopClick}>
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
                  {movement.id === sortedMovements[0]?.id && canSeeAudit && movement.movement_type === "ENTRADA" && withinRevertWindow(movement.created_at) ? (
                    <button className="iconTextButton dangerText" onClick={() => void handleRevertLastEntry(movement.item)} type="button">
                      <RotateCcw aria-hidden="true" size={15} />
                      Revertir
                    </button>
                  ) : null}
                </span>
              </article>
              );
            })}
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
                      <p>{selectedDateEntries.length} registros</p>
                    </>
                  )}
                </div>
                <div className="movementList movementHistoryEntries pagedListFloor">
                  {(historySearchActive ? historyResultsPager : historyDayPager).pageItems.map((entry) => {
                    if (entry.kind === "rejection" && entry.run) {
                      const run = entry.run;
                      return (
                        <article className="movementRow" key={`rej-${run.id}`} {...openableProps(() => setRejectionInfoRun(run), `Ver rechazo de ${run.process_name}`)}>
                          <div>
                            <strong className="dangerText">Solicitud rechazada</strong>
                            {run.production_code ? (
                              <span style={{ fontFamily: "monospace", fontSize: 11, color: "var(--primary-strong)", fontWeight: 700 }}>{run.production_code}</span>
                            ) : null}
                            <span>
                              {historySearchActive ? `${movementDateLabel(run.rejected_at ?? "")} · ` : ""}
                              {movementTimeLabel(run.rejected_at ?? "")} - {run.process_name}
                            </span>
                          </div>
                          <div>
                            <strong className="num">{numericText(run.total_required_material)} {run.raw_material_unit_code}</strong>
                            <span>
                              {run.rejection_reason || "Sin motivo registrado"}
                              {run.rejected_by_name ? ` · ${run.rejected_by_name}` : ""}
                            </span>
                          </div>
                          <span className="rowActions" onClick={stopClick}>
                            <button className="iconTextButton" onClick={() => setRejectionInfoRun(run)} type="button">
                              <Eye aria-hidden="true" size={15} />
                              Visualizar
                            </button>
                          </span>
                        </article>
                      );
                    }
                    if (!entry.movement) return null;
                    const movement = entry.movement;
                    return (
                    <article className="movementRow" key={movement.id} {...openableProps(() => setViewingMovement(movement), `Ver movimiento de ${movement.item.name}`)}>
                      <div>
                        <strong>{movementOperationLabel(movement)}</strong>
                        {movement.lot_code ? (
                          <span style={{ fontFamily: "monospace", fontSize: 11, color: "var(--primary-strong)", fontWeight: 700 }}>{movement.lot_code}</span>
                        ) : null}
                        <span>
                          {historySearchActive ? `${movementDateLabel(movement.created_at)} · ` : ""}
                          {movementTimeLabel(movement.created_at)} - {movement.item.name}
                        </span>
                      </div>
                      <div>
                        <strong className="num">{movementAmountText(movement)}</strong>
                        <span>
                          {movement.reason || "Sin motivo registrado"}
                          {movement.created_by_name ? ` · ${movement.created_by_name}` : ""}
                        </span>
                      </div>
                      <span className="rowActions" onClick={stopClick}>
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
                    </article>
                    );
                  })}
                  {historySearchActive && historySearchResults.length === 0 ? (
                    <div className="emptyState">Sin coincidencias en el historial. Prueba con otro dato: nombre, tipo, usuario o fecha.</div>
                  ) : null}
                  {!historySearchActive && selectedDateEntries.length === 0 ? (
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
                <h2>
                  {editingItemId
                    ? "Editar item"
                    : itemForm.item_type === "SUPPLY"
                      ? "Crear insumo"
                      : itemForm.item_type === "COMPLEMENT"
                        ? "Crear complemento"
                        : "Crear item"}
                </h2>
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
                <span>{isSimpleItem ? "Nombre" : "Tipo"}</span>
                <input
                  className="field"
                  onChange={(event) => setItemForm((current) => ({ ...current, material_type: event.target.value }))}
                  placeholder={isSimpleItem ? "Ej. Bórax, Ácido para baño" : "Ej. Oro, Plata"}
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
            {!isEditingXmlItem && !isSimpleItem ? (
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
              {movementEntryType === "COMPLEMENT" && movementForm.movement_type !== "SALIDA" ? (
                <button className="button" onClick={() => setIsComplementPickerOpen(true)} type="button">
                  {movementSelectedItem ? `${movementSelectedItem.name} · ${movementSelectedItem.sku}` : "Elegir complemento"}
                </button>
              ) : (
                <select className="field" onChange={(event) => setMovementForm((current) => ({ ...current, item_id: event.target.value }))} value={movementForm.item_id}>
                  <option value="">Seleccionar item</option>
                  {movementItems.map((item) => (
                    <option key={item.id} value={item.id}>{item.name} - {item.sku}</option>
                  ))}
                </select>
              )}
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

      {isComplementPickerOpen ? (
        <ComplementPicker
          title="Elegir complemento"
          items={items}
          onSelect={(item) => {
            setMovementForm((current) => ({ ...current, item_id: item.id }));
            setIsComplementPickerOpen(false);
          }}
          onClose={() => setIsComplementPickerOpen(false)}
        />
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

      {wasteHistoryRun ? (
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
            <div className="userPreviewGrid">
              <RunWasteHero run={wasteHistoryRun} />
            </div>
            <RunStageSummaryTable run={wasteHistoryRun} />
          </section>
        </div>
      ) : null}

      {rejectionInfoRun ? (
        <div className="modalBackdrop modalBackdropTop" role="dialog" aria-modal="true" aria-label="Detalle del rechazo">
          <section className="modalWindow processViewWindow">
            <div className="modalHeader">
              <div>
                <h2>Solicitud rechazada</h2>
                <p>{rejectionInfoRun.production_code ?? rejectionInfoRun.process_name} · {rejectionInfoRun.process_name}</p>
              </div>
              <button aria-label="Cerrar" className="iconOnlyButton" onClick={() => setRejectionInfoRun(null)} type="button">
                <X aria-hidden="true" size={18} />
              </button>
            </div>
            <div className="userPreviewGrid">
              <span><strong>Rechazada por</strong>{rejectionInfoRun.rejected_by_name ?? "—"}{rejectionInfoRun.rejected_at ? ` · ${productionTimeLabel(rejectionInfoRun.rejected_at)}` : ""}</span>
              <span><strong>Solicitada por</strong>{rejectionInfoRun.created_by_name ?? "—"}{rejectionInfoRun.requested_at ? ` · ${productionTimeLabel(rejectionInfoRun.requested_at)}` : ""}</span>
              <span><strong>Cantidad</strong>{numericText(rejectionInfoRun.quantity)} und</span>
              <span>
                <strong>Material solicitado</strong>
                {items.find((item) => item.id === rejectionInfoRun.raw_material_item_id)?.name ?? "—"} ·{" "}
                {numericText(rejectionInfoRun.total_required_material)} {rejectionInfoRun.raw_material_unit_code}
              </span>
              <span><strong>Motivo</strong>{rejectionInfoRun.rejection_reason || "Sin motivo registrado"}</span>
            </div>
          </section>
        </div>
      ) : null}

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
              <span><strong>Peso final</strong>{(() => { const weight = runFinalWeight(receptionInfoRun); return weight ? `${numericText(String(weight))} g` : "—"; })()}</span>
            </div>
          </section>
        </div>
      ) : null}

      {convertRun && lotAction === null ? (() => {
        const lotItem = items.find((item) => item.sku === convertRun.production_code) ?? null;
        const lotStock = lotItem ? Number(lotItem.current_stock) : 0;
        return (
          <div className="modalBackdrop" role="dialog" aria-modal="true" aria-label="Lote de proceso terminado">
            <section className="modalWindow processFormWindow">
              <div className="modalHeader">
                <div>
                  <h2>¿Qué hacer con el lote?</h2>
                  <p>
                    {convertRun.production_code ?? "Sin folio"} · {convertRun.process_name} · Disponible:{" "}
                    {numericText(String(lotStock))} und
                  </p>
                </div>
                <button aria-label="Cerrar" className="iconOnlyButton" onClick={() => setConvertRun(null)} type="button">
                  <X aria-hidden="true" size={18} />
                </button>
              </div>
              <div className="maintenanceGrid">
                <button
                  className="maintenanceTile"
                  onClick={() => {
                    // Directo al selector del catálogo; el formulario queda debajo.
                    setLotAction("convert");
                    setTargetPickerFor("convert");
                  }}
                  type="button"
                >
                  <Plus aria-hidden="true" size={22} />
                  <strong>Agregar al catálogo</strong>
                  <span>Convertir piezas del lote en un producto del catálogo.</span>
                </button>
                <button
                  className="maintenanceTile"
                  onClick={() => setIsPartnerPickerOpen(true)}
                  type="button"
                >
                  <Repeat aria-hidden="true" size={22} />
                  <strong>Combinar</strong>
                  <span>Unir piezas del lote con un producto terminado (ej. cadena + dije).</span>
                </button>
              </div>
            </section>
          </div>
        );
      })() : null}

      {convertRun && lotAction === "convert" ? (() => {
        const lotItem = items.find((item) => item.sku === convertRun.production_code) ?? null;
        const lotStock = lotItem ? Number(lotItem.current_stock) : 0;
        // Destino: pieza del inventario (flujo normal) o tipo recién creado.
        const targetPiece = items.find((item) => item.id === convertForm.target_item_id) ?? null;
        const selectedType = productTypes.find((type) => type.id === convertForm.product_type_id) ?? null;
        const previewCode = targetPiece?.product_code
          ? convertForm.material_code
            ? `${convertForm.material_code}${targetPiece.product_code.slice(1)}`
            : targetPiece.product_code
          : convertForm.material_code && selectedType
            ? `${convertForm.material_code}${selectedType.category_code}${selectedType.model_code}`
            : null;
        const quantityNumber = Number(convertForm.quantity);
        const quantityValid = Number.isFinite(quantityNumber) && quantityNumber > 0 && quantityNumber <= lotStock;
        return (
          <div className="modalBackdrop" role="dialog" aria-modal="true" aria-label="Agregar al catálogo">
            <form className="modalWindow processFormWindow" onSubmit={handleConvertLot}>
              <div className="modalHeader">
                <div>
                  <h2>Agregar al catálogo</h2>
                  <p>
                    {convertRun.production_code ?? "Sin folio"} · {convertRun.process_name} · Disponible:{" "}
                    {numericText(String(lotStock))} und
                  </p>
                </div>
                <button aria-label="Volver" className="iconOnlyButton" onClick={() => setLotAction(null)} type="button">
                  <X aria-hidden="true" size={18} />
                </button>
              </div>
              <div className="fieldGroup">
                <span>Producto del catálogo</span>
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <button className="button" onClick={() => setTargetPickerFor("convert")} type="button">
                    <Pencil aria-hidden="true" size={14} />
                    {convertForm.target_item_id || convertForm.product_type_id ? "Cambiar" : "Elegir del catálogo"}
                  </button>
                  {targetPiece ? (
                    <span style={{ fontSize: 13, display: "inline-flex", alignItems: "center", gap: 6 }}>
                      {targetPiece.product_code ? (
                        <span className={`orderCodeTag${metalTagClass(targetPiece.product_code)}`}>#{targetPiece.product_code}</span>
                      ) : null}
                      {(targetPiece.description ?? "").trim() || targetPiece.name}
                    </span>
                  ) : selectedType ? (
                    <span style={{ fontSize: 13 }}>
                      {selectedType.category_label} · {selectedType.model_label}{selectedType.name ? ` · ${selectedType.name}` : ""}
                    </span>
                  ) : (
                    <span style={{ fontSize: 13, color: "var(--muted)" }}>Sin elegir</span>
                  )}
                </div>
              </div>
              <div className="fieldGroup">
                <span>Material de la pieza</span>
                {/* Material fijo: el de fabricación del lote, sin selector.
                    El segmento para el código lo resuelve el backend. */}
                <span style={{ fontSize: 13, color: convertForm.material_type ? undefined : "var(--muted)" }}>
                  {convertForm.material_type || "Sin material"}
                </span>
              </div>
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
                {convertForm.quantity && Number.isFinite(quantityNumber) && quantityNumber > lotStock ? (
                  <small style={{ color: "var(--danger, #c0392b)" }}>
                    Stock insuficiente: el lote tiene {numericText(String(lotStock))} und
                  </small>
                ) : null}
              </label>
              {previewCode ? (
                <p className="panelText">Código de producto resultante: <strong>{previewCode}</strong></p>
              ) : null}
              <div className="modalActions">
                <button
                  className="button buttonPrimary"
                  disabled={isConverting || !(convertForm.target_item_id || convertForm.product_type_id) || !quantityValid}
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

      {isCombineOpen ? (() => {
        const combinable = items.filter(
          (item) => item.item_type === "FINISHED_PRODUCT" && Number(item.current_stock) > 0,
        );
        const materials = catalogSegments.filter((segment) => segment.kind === "MATERIAL" && segment.is_active);
        const activeTypes = productTypes.filter((type) => type.is_active);
        const selectedType = activeTypes.find((type) => type.id === combineForm.product_type_id) ?? null;
        // Destino: pieza del inventario (flujo normal) o tipo recién creado.
        const targetPiece = items.find((item) => item.id === combineForm.target_item_id) ?? null;
        const previewCode = combineForm.material_code && targetPiece?.product_code
          ? `${combineForm.material_code}${targetPiece.product_code.slice(1)}`
          : combineForm.material_code && selectedType
            ? `${combineForm.material_code}${selectedType.category_code}${selectedType.model_code}`
            : null;
        const pieces = combineForm.sources
          .map((line) => combinable.find((candidate) => candidate.id === line.itemId))
          .filter((item): item is InventoryItem => Boolean(item));
        // Cantidad individual por pieza (default 1); cada pieza debe tener
        // stock para cubrir la suya. Piezas medidas en gramos con gramos por
        // unidad: su disponible en unidades es stock ÷ gramos por unidad.
        const availableUnits = (item: InventoryItem) => {
          const wpu = Number(item.weight_per_unit ?? 0);
          return item.unit_code === "g" && wpu > 0
            ? Math.floor(Number(item.current_stock) / wpu)
            : Number(item.current_stock);
        };
        // El ensamble opera en unidades: piezas con peso por unidad muestran
        // unidades disponibles y su equivalente en gramos.
        const stockLabel = (item: InventoryItem) => {
          const wpu = Number(item.weight_per_unit ?? 0);
          if (item.unit_code === "g" && wpu > 0) {
            return `${numericText(String(availableUnits(item)))} und · ${numericText(item.current_stock)} g`;
          }
          if (item.unit_code === "und" && wpu > 0) {
            const grams = Number((Number(item.current_stock) * wpu).toFixed(2));
            return `${numericText(item.current_stock)} und · ${numericText(String(grams))} g`;
          }
          return `${numericText(item.current_stock)} ${item.unit_code}`;
        };
        const lineEntries = combineForm.sources.map((line) => ({
          line,
          item: combinable.find((candidate) => candidate.id === line.itemId) ?? null,
        }));
        const lineQuantityValid = (line: { quantity: string }) => {
          const value = Number(line.quantity);
          return Number.isFinite(value) && value > 0;
        };
        const linesValid = combineForm.sources.every(lineQuantityValid);
        const assembliesOut = Number(combineForm.assemblies);
        const assembliesValid = Number.isFinite(assembliesOut) && assembliesOut > 0;
        // Consumo total por pieza = cantidad por ensamble × ensambles.
        const shortPieces = lineEntries
          .filter(
            (entry) =>
              entry.item &&
              lineQuantityValid(entry.line) &&
              assembliesValid &&
              Number(entry.line.quantity) * assembliesOut > availableUnits(entry.item),
          )
          .map((entry) => entry.item as InventoryItem);
        const canSubmit =
          pieces.length >= 2 &&
          pieces.length === combineForm.sources.length &&
          Boolean(combineForm.material_code) &&
          Boolean(combineForm.target_item_id || combineForm.product_type_id) &&
          linesValid &&
          assembliesValid &&
          shortPieces.length === 0;
        return (
          <div className="modalBackdrop" role="dialog" aria-modal="true" aria-label="Ensamblar producto">
            <form className="modalWindow processFormWindow" onSubmit={handleCombineProducts}>
              <div className="modalHeader">
                <div>
                  <h2>Ensamblar producto</h2>
                  <p>Combina piezas existentes en un producto nuevo del catálogo</p>
                </div>
                <button aria-label="Cerrar" className="iconOnlyButton" onClick={() => setIsCombineOpen(false)} type="button">
                  <X aria-hidden="true" size={18} />
                </button>
              </div>
              <div className="fieldGroup">
                <span>Piezas que se combinan (mínimo 2)</span>
                {combineForm.sources.map((line, index) => {
                  const lineItem = combinable.find((candidate) => candidate.id === line.itemId);
                  if (!lineItem) return null;
                  const short =
                    lineQuantityValid(line) &&
                    assembliesValid &&
                    Number(line.quantity) * assembliesOut > availableUnits(lineItem);
                  return (
                    <div key={line.itemId} style={{ display: "flex", flexDirection: "column", gap: 2 }}>
                      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
                        {lineItem.product_code ? (
                          <span className={`orderCodeTag${metalTagClass(lineItem.product_code)}`}>#{lineItem.product_code}</span>
                        ) : (
                          <span className="orderCodeTag">{lineItem.sku}</span>
                        )}
                        <span style={{ fontSize: 13, flex: 1 }}>
                          {/* Lotes (sin código de producto) se nombran por su
                              nombre; su descripción es texto genérico. */}
                          {(lineItem.product_code && (lineItem.description ?? "").trim()) || lineItem.name}
                        </span>
                        <input
                          aria-label="Cantidad de esta pieza"
                          className="field"
                          min="1"
                          onChange={(event) =>
                            setCombineForm((current) => ({
                              ...current,
                              sources: current.sources.map((source, idx) =>
                                idx === index ? { ...source, quantity: event.target.value } : source,
                              ),
                            }))
                          }
                          step="1"
                          style={{ width: 72 }}
                          type="number"
                          value={line.quantity}
                        />
                        <span style={{ fontSize: 13, color: short ? "var(--danger, #c0392b)" : "var(--muted)" }}>
                          Stock: {stockLabel(lineItem)}
                        </span>
                        <button
                          aria-label="Quitar pieza"
                          className="iconOnlyButton dangerIconButton"
                          onClick={() =>
                            setCombineForm((current) => {
                              const sources = current.sources.filter((_, idx) => idx !== index);
                              return { ...current, sources, ...deriveCombineMaterial(sources) };
                            })
                          }
                          type="button"
                        >
                          <X aria-hidden="true" size={14} />
                        </button>
                      </div>
                      {short ? (
                        <small style={{ color: "var(--danger, #c0392b)" }}>
                          Stock insuficiente: disponible {numericText(String(availableUnits(lineItem)))} und
                        </small>
                      ) : null}
                    </div>
                  );
                })}
                {combineForm.sources.length === 0 ? (
                  <span style={{ fontSize: 13, color: "var(--muted)" }}>Sin piezas: agrega desde el catálogo.</span>
                ) : null}
                <button className="button" onClick={() => setIsPiecePickerOpen(true)} type="button">
                  <Plus aria-hidden="true" size={14} />
                  Agregar pieza
                </button>
              </div>
              <div className="fieldGroup">
                <span>Producto resultante</span>
                <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <button className="button" onClick={() => setTargetPickerFor("combine")} type="button">
                    <Pencil aria-hidden="true" size={14} />
                    {combineForm.target_item_id || combineForm.product_type_id ? "Cambiar" : "Elegir del catálogo"}
                  </button>
                  {targetPiece ? (
                    <span style={{ fontSize: 13, display: "inline-flex", alignItems: "center", gap: 6 }}>
                      {targetPiece.product_code ? (
                        <span className={`orderCodeTag${metalTagClass(targetPiece.product_code)}`}>#{targetPiece.product_code}</span>
                      ) : null}
                      {(targetPiece.description ?? "").trim() || targetPiece.name}
                    </span>
                  ) : selectedType ? (
                    <span style={{ fontSize: 13 }}>
                      {selectedType.category_label} · {selectedType.model_label}{selectedType.name ? ` · ${selectedType.name}` : ""}
                    </span>
                  ) : (
                    <span style={{ fontSize: 13, color: "var(--muted)" }}>Sin elegir</span>
                  )}
                </div>
              </div>
              {/* Regla absoluta: material y pureza = los de la pieza con más
                  gramos. Solo lectura, sin edición. */}
              <div className="fieldGroup">
                <span>Material de la pieza</span>
                <span style={{ fontSize: 13, color: combineForm.material_type ? undefined : "var(--muted)" }}>
                  {combineForm.material_type || "Se llena al elegir las piezas"}
                </span>
                {combineForm.material_type && !combineForm.material_code ? (
                  <small style={{ color: "var(--muted)" }}>El material no está en el catálogo.</small>
                ) : null}
              </div>
              {combineForm.purity ? (
                <div className="fieldGroup">
                  <span>Pureza de la pieza</span>
                  <span style={{ fontSize: 13 }}>{combineForm.purity}</span>
                </div>
              ) : null}
              <label className="fieldGroup">
                <span>Ensambles a producir</span>
                <input
                  className="field"
                  min="1"
                  onChange={(event) =>
                    setCombineForm((current) => ({ ...current, assemblies: event.target.value }))
                  }
                  step="1"
                  type="number"
                  value={combineForm.assemblies}
                />
              </label>
              {linesValid && assembliesValid && shortPieces.length === 0 && pieces.length >= 2 ? (
                <p className="panelText">
                  Por ensamble se descuenta la cantidad de cada pieza; se crean{" "}
                  <strong>{numericText(String(assembliesOut))}</strong> producto(s) resultante(s).
                </p>
              ) : null}
              {previewCode ? (
                <p className="panelText">Código de producto resultante: <strong>{previewCode}</strong></p>
              ) : null}
              <div className="modalActions">
                <button className="button buttonPrimary" disabled={isCombining || !canSubmit} type="submit">
                  <Repeat aria-hidden="true" size={17} />
                  {isCombining ? "Ensamblando" : "Ensamblar"}
                </button>
              </div>
            </form>
          </div>
        );
      })() : null}

      {targetPickerFor === "convert" && convertRun ? (() => {
        const lotItem = items.find((item) => item.sku === convertRun.production_code) ?? null;
        return (
          <FinishedItemPicker
            title="¿A qué producto se agrega?"
            subtitle="Piezas del catálogo · el material será el de fabricación del lote"
            items={items}
            excludeIds={lotItem ? [lotItem.id] : []}
            requireStock={false}
            onSelect={(piece) => {
              setConvertForm((current) => ({ ...current, target_item_id: piece.id, product_type_id: "" }));
              setTargetPickerFor(null);
            }}
            onCreate={() => {
              setTargetPickerFor(null);
              setCreatingTargetFor("convert");
            }}
            onClose={() => {
              // Cerrar sin elegir: si el formulario de conversión aún no tiene
              // destino, no hay nada que mostrar; vuelve a la ventana principal.
              if (!convertForm.target_item_id && !convertForm.product_type_id) setLotAction(null);
              setTargetPickerFor(null);
            }}
          />
        );
      })() : targetPickerFor === "combine" ? (
        <FinishedItemPicker
          title="¿Qué producto resulta?"
          subtitle="Piezas del catálogo · elige el producto final del ensamble"
          items={items}
          requireStock={false}
          onSelect={(piece) => {
            setCombineForm((current) => ({ ...current, target_item_id: piece.id, product_type_id: "" }));
            setTargetPickerFor(null);
          }}
          onCreate={() => {
            setTargetPickerFor(null);
            setCreatingTargetFor("combine");
          }}
          onClose={() => setTargetPickerFor(null)}
        />
      ) : null}

      {creatingTargetFor ? (
        <ProductTypesManager
          mode="create"
          onClose={() => setCreatingTargetFor(null)}
          onProductCreated={(created) => {
            if (creatingTargetFor === "convert") {
              setConvertForm((current) => ({ ...current, product_type_id: created.id, target_item_id: "" }));
            } else {
              setCombineForm((current) => ({ ...current, product_type_id: created.id, target_item_id: "" }));
            }
            setCreatingTargetFor(null);
          }}
        />
      ) : null}

      {isPartnerPickerOpen && convertRun ? (() => {
        const lotItem = items.find((item) => item.sku === convertRun.production_code) ?? null;
        return (
          <FinishedItemPicker
            title="¿Con qué se combina?"
            subtitle={`Lote ${convertRun.production_code ?? "sin folio"} · elige el producto terminado`}
            items={items}
            excludeIds={lotItem ? [lotItem.id] : []}
            onSelect={(partner) => {
              if (!lotItem) return;
              // El ensamble arranca con el lote y la pieza elegida; cantidades
              // por pieza y producto resultante se definen en el modal.
              const sources = [
                { itemId: lotItem.id, quantity: "1" },
                { itemId: partner.id, quantity: "1" },
              ];
              setCombineForm({
                sources,
                product_type_id: "",
                target_item_id: "",
                assemblies: "1",
                ...deriveCombineMaterial(sources),
              });
              setIsPartnerPickerOpen(false);
              setConvertRun(null);
              setLotAction(null);
              setIsCombineOpen(true);
            }}
            onClose={() => setIsPartnerPickerOpen(false)}
          />
        );
      })() : null}

      {isPiecePickerOpen ? (
        <FinishedItemPicker
          title="Agregar pieza"
          subtitle="Productos terminados con stock · elige la pieza que se suma al ensamble"
          items={items}
          excludeIds={combineForm.sources.map((line) => line.itemId)}
          onSelect={(piece) => {
            setCombineForm((current) => {
              const sources = [...current.sources, { itemId: piece.id, quantity: "1" }];
              return { ...current, sources, ...deriveCombineMaterial(sources) };
            });
            setIsPiecePickerOpen(false);
          }}
          onClose={() => setIsPiecePickerOpen(false)}
        />
      ) : null}

      {rejectRun ? (
        <div className="modalBackdrop modalBackdropTop" role="dialog" aria-modal="true" aria-label="Rechazar solicitud">
          <form
            className="modalWindow processFormWindow"
            onSubmit={(event) => {
              event.preventDefault();
              if (rejectRun) void handleRejectMaterials(rejectRun, rejectReason);
            }}
          >
            <div className="modalHeader">
              <div>
                <h2>Rechazar solicitud</h2>
                <p>
                  {rejectRun.production_code ? `${rejectRun.production_code} · ` : ""}{rejectRun.process_name} ·{" "}
                  {numericText(rejectRun.total_required_material)} {rejectRun.raw_material_unit_code}
                </p>
              </div>
              <button aria-label="Cerrar" className="iconOnlyButton" onClick={() => setRejectRun(null)} type="button">
                <X aria-hidden="true" size={18} />
              </button>
            </div>
            <label className="fieldGroup">
              <span>Motivo del rechazo (opcional)</span>
              <textarea
                className="field textarea"
                maxLength={1000}
                onChange={(event) => setRejectReason(event.target.value)}
                rows={3}
                value={rejectReason}
              />
            </label>
            <p className="panelText">La orden quedará cancelada y el rechazo se registrará en el historial de inventario.</p>
            <div className="modalActions">
              <button className="button" onClick={() => setRejectRun(null)} type="button">
                Cancelar
              </button>
              <button className="button buttonDanger" disabled={isSavingProduction} type="submit">
                {isSavingProduction ? "Rechazando" : "Rechazar solicitud"}
              </button>
            </div>
          </form>
        </div>
      ) : null}

      {isArchivedOpen ? (
        <div className="modalBackdrop" role="dialog" aria-modal="true" aria-label="Items archivados">
          <section className="modalWindow processViewWindow">
            <div className="modalHeader">
              <div>
                <h2>Archivados</h2>
                {/* Vista propia de la pestaña activa, no compartida. */}
                <p>{itemTypeLabel(itemFilter as InventoryItemType)} · {archivedItems.length} items fuera del inventario activo</p>
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
                    {/* Ancho fijo: el select de tipo de complemento aparece y
                        desaparece; sin esto la columna salta y rompe la ventana. */}
                    <th style={{ width: 360 }}>Seccion</th>
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
                          <span style={{ display: "flex", alignItems: "center", gap: 6 }}>
                            {itemTypeLabel(line.existingItem.item_type)} · {line.existingItem.sku}
                            {line.manualLink ? (
                              <button
                                aria-label="Deshacer vinculo"
                                className="iconOnlyButton"
                                onClick={() =>
                                  setXmlImportDraft((current) => {
                                    if (!current) return current;
                                    const nextLines = current.lines.map((candidate, candidateIndex) =>
                                      candidateIndex === lineIndex
                                        ? { ...candidate, existingItem: null, manualLink: false, complementTypeId: null }
                                        : candidate,
                                    );
                                    return { ...current, lines: nextLines };
                                  })
                                }
                                title="Deshacer vinculo"
                                type="button"
                              >
                                <X aria-hidden="true" size={13} />
                              </button>
                            ) : null}
                          </span>
                        ) : (
                          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                            <div style={{ display: "flex", gap: 8 }}>
                              <select
                                className="field"
                                onChange={(event) =>
                                  setXmlImportDraft((current) => {
                                    if (!current) return current;
                                    const nextType = event.target.value as InventoryItemType;
                                    const nextLines = current.lines.map((candidate, candidateIndex) =>
                                      candidateIndex === lineIndex
                                        ? { ...candidate, itemType: nextType, complementTypeId: nextType === "COMPLEMENT" ? candidate.complementTypeId : null }
                                        : candidate,
                                    );
                                    return { ...current, lines: nextLines };
                                  })
                                }
                                style={{ flex: 1, minWidth: 0 }}
                                value={line.itemType}
                              >
                                <option value="RAW_MATERIAL">Materia prima</option>
                                <option value="SUPPLY">Insumo</option>
                                <option value="COMPLEMENT">Complemento</option>
                              </select>
                              {line.itemType === "COMPLEMENT" ? (
                                <select
                                  className="field"
                                  onChange={(event) =>
                                    setXmlImportDraft((current) => {
                                      if (!current) return current;
                                      const nextLines = current.lines.map((candidate, candidateIndex) =>
                                        candidateIndex === lineIndex ? { ...candidate, complementTypeId: event.target.value || null } : candidate,
                                      );
                                      return { ...current, lines: nextLines };
                                    })
                                  }
                                  style={{ flex: 1, minWidth: 0 }}
                                  value={line.complementTypeId ?? ""}
                                >
                                  <option value="">Tipo de complemento…</option>
                                  {complementTypes.map((type) => (
                                    <option key={type.id} value={type.id}>{type.name}</option>
                                  ))}
                                </select>
                              ) : null}
                            </div>
                            <button
                              className="iconTextButton"
                              onClick={() => { setLinkPickerLineIndex(lineIndex); setLinkPickerSearch(""); setLinkPickerType("TODOS"); }}
                              style={{ alignSelf: "flex-start" }}
                              title="Vincular a existente"
                              type="button"
                            >
                              <Repeat aria-hidden="true" size={14} />
                              Vincular a existente
                            </button>
                          </div>
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

      {xmlImportDraft && linkPickerLineIndex !== null ? (
        <div className="modalBackdrop modalBackdropTop" role="dialog" aria-modal="true" aria-label="Vincular a existente">
          <section className="modalWindow">
            <div className="modalHeader">
              <div>
                <h2>Vincular a existente</h2>
                <p className="panelText">Elige el item del inventario al que entra esta linea (solo para esta importacion).</p>
              </div>
              <button aria-label="Cerrar" className="iconOnlyButton" onClick={() => setLinkPickerLineIndex(null)} type="button">
                <X aria-hidden="true" size={18} />
              </button>
            </div>
            <div style={{ display: "flex", gap: 8, marginTop: 12, marginBottom: 12 }}>
              <input
                className="field"
                onChange={(event) => setLinkPickerSearch(event.target.value)}
                placeholder="Buscar por nombre…"
                style={{ flex: 1, minWidth: 0 }}
                type="text"
                value={linkPickerSearch}
              />
              <select
                aria-label="Filtrar por seccion"
                className="field"
                onChange={(event) => setLinkPickerType(event.target.value as "TODOS" | InventoryItemType)}
                style={{ width: 180 }}
                value={linkPickerType}
              >
                <option value="TODOS">Todas las secciones</option>
                <option value="RAW_MATERIAL">Materia prima</option>
                <option value="SUPPLY">Insumos</option>
                <option value="COMPLEMENT">Complementos</option>
              </select>
            </div>
            <div className="tableWrap pagedListFloor" style={{ minHeight: 200, maxHeight: 360, overflowY: "auto" }}>
              <table className="table tableAuto">
                <thead>
                  <tr>
                    <th>Nombre</th>
                    <th>Tipo</th>
                    <th>SKU</th>
                    <th className="num">Stock</th>
                  </tr>
                </thead>
                <tbody>
                  {items
                    .filter(
                      (candidate) =>
                        (candidate.item_type === "RAW_MATERIAL" ||
                          candidate.item_type === "SUPPLY" ||
                          candidate.item_type === "COMPLEMENT") &&
                        (linkPickerType === "TODOS" || candidate.item_type === linkPickerType) &&
                        !candidate.archived_at &&
                        candidate.name.toLowerCase().includes(linkPickerSearch.trim().toLowerCase()),
                    )
                    .map((candidate) => (
                      <tr
                        key={candidate.id}
                        onClick={() => {
                          const targetIndex = linkPickerLineIndex;
                          setXmlImportDraft((current) => {
                            if (!current) return current;
                            const nextLines = current.lines.map((line, lineIndex) =>
                              lineIndex === targetIndex
                                ? { ...line, existingItem: candidate, itemType: candidate.item_type, complementTypeId: null, manualLink: true }
                                : line,
                            );
                            return { ...current, lines: nextLines };
                          });
                          setLinkPickerLineIndex(null);
                        }}
                        style={{ cursor: "pointer" }}
                      >
                        <td>{candidate.name}</td>
                        <td>{itemTypeLabel(candidate.item_type)}</td>
                        <td>{candidate.sku}</td>
                        <td className="num">
                          {Number(candidate.current_stock).toLocaleString("es-EC")} {candidate.unit_code}
                        </td>
                      </tr>
                    ))}
                  {items.filter(
                    (candidate) =>
                      (candidate.item_type === "RAW_MATERIAL" ||
                        candidate.item_type === "SUPPLY" ||
                        candidate.item_type === "COMPLEMENT") &&
                      (linkPickerType === "TODOS" || candidate.item_type === linkPickerType) &&
                      !candidate.archived_at &&
                      candidate.name.toLowerCase().includes(linkPickerSearch.trim().toLowerCase()),
                  ).length === 0 ? (
                    <tr><td colSpan={4}><div className="emptyState">Sin resultados.</div></td></tr>
                  ) : null}
                </tbody>
              </table>
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
                <strong>{itemStockText(viewingItem)}</strong>
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
              <button className="button" onClick={() => setKardexItem(viewingItem)} type="button">
                <History aria-hidden="true" size={15} />
                Kardex
              </button>
            </div>
          </section>
        </div>
      ) : null}

      {kardexItem ? (
        <div className="modalBackdrop modalBackdropTop" role="dialog" aria-modal="true" aria-label="Kardex del item">
          <section className="modalWindow processViewWindow kardexWindow">
            <div className="modalHeader">
              <div>
                <h2>Kardex</h2>
                <p>{kardexItem.name} · {viewingItemKardex.length} movimientos</p>
              </div>
              <button aria-label="Cerrar" className="iconOnlyButton" onClick={() => setKardexItem(null)} type="button">
                <X aria-hidden="true" size={18} />
              </button>
            </div>
            <div className="tableWrap pagedListFloor" style={{ minHeight: 180 }}>
              <table className="table tableAuto kardexTable">
                <thead>
                  <tr>
                    <th>Fecha</th>
                    <th>Tipo</th>
                    <th>Detalle</th>
                    <th className="num">Cantidad</th>
                    <th className="num">Saldo</th>
                  </tr>
                </thead>
                <tbody>
                  {kardexPager.pageItems.map(({ movement, balanceAfter }) => (
                    <tr key={movement.id}>
                      <td>{movementDateLabel(movement.created_at)}</td>
                      <td>{movementOperationLabel(movement)}</td>
                      <td style={{ maxWidth: 300, overflow: "hidden", textOverflow: "ellipsis" }} title={movement.reason ?? undefined}>
                        {kardexDetail(movement)}
                      </td>
                      <td className="num">{movementSign(movement.movement_type) > 0 ? "+" : "−"}{movementAmountText(movement)}</td>
                      <td className="num">{(() => {
                        const wpu = Number(kardexItem.weight_per_unit ?? 0);
                        const base = `${numericText(String(balanceAfter))} ${movement.unit_code}`;
                        if (!(wpu > 0)) return base;
                        if (movement.unit_code === "g") {
                          return `${base} · ${numericText(String(Number((balanceAfter / wpu).toFixed(2))))} und`;
                        }
                        if (movement.unit_code === "und") {
                          return `${base} · ${numericText(String(Number((balanceAfter * wpu).toFixed(2))))} g`;
                        }
                        return base;
                      })()}</td>
                    </tr>
                  ))}
                  {viewingItemKardex.length === 0 ? (
                    <tr><td colSpan={5}><div className="emptyState">Sin movimientos para este item.</div></td></tr>
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
                <h2>{movementOperationLabel(viewingMovement)}</h2>
                <p>{viewingMovement.item.name}{viewingMovement.lot_code ? ` · ${viewingMovement.lot_code}` : ""}</p>
              </div>
              <button aria-label="Cerrar" className="iconOnlyButton" onClick={() => setViewingMovement(null)} type="button">
                <X aria-hidden="true" size={18} />
              </button>
            </div>
            <div className="fichaHero">
              <div className="fichaHeroItem">
                <strong>{movementAmountText(viewingMovement)}</strong>
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
                  {runQuantityText(viewingRun)}
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
                      <span><strong>Cantidad</strong>{runQuantityText(viewingRun)}</span>
                      <span><strong>Fecha</strong>{viewingRun.received_at ? productionTimeLabel(viewingRun.received_at) : "—"}</span>
                      <span><strong>Recibido por</strong>{viewingRun.received_by_name ?? "—"}</span>
                    </div>
                  ) : (
                    <div className="userPreviewGrid">
                      <span><strong>Lote (OP)</strong>{viewingRun.production_code ?? "—"}</span>
                      <span><strong>Proceso</strong>{viewingRun.process_name}</span>
                      <span><strong>Cantidad</strong>{runQuantityText(viewingRun)}</span>
                      <span><strong>Creado por</strong>{viewingRun.created_by_name ?? "—"}{viewingRun.requested_at ? ` · ${productionTimeLabel(viewingRun.requested_at)}` : ""}</span>
                      <span><strong>Etapas</strong>{current ? `Etapa ${current.stage_order}. ${current.stage_name}` : `${done} de ${stages.length}`}</span>
                    </div>
                  )}
                  {viewingRun.status !== "RECIBIDA" ? (
                    <RunStageSummaryTable run={viewingRun} />
                  ) : null}
                  {(() => {
                    // Kardex del lote, igual que en la ficha de cualquier item.
                    const lotItem = items.find((item) => item.sku === viewingRun.production_code) ?? null;
                    if (!lotItem) return null;
                    return (
                      <div className="modalActions">
                        <button className="button" onClick={() => setKardexItem(lotItem)} type="button">
                          <History aria-hidden="true" size={15} />
                          Kardex
                        </button>
                      </div>
                    );
                  })()}
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
                            onClick={() => openRejectModal(run)}
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
                            <span>{runQuantityText(run)}</span>
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
                            <span>{runQuantityText(run)}</span>
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
                            <span>{(() => { const weight = runFinalWeight(run); return weight ? numericText(String(weight)) : "-"; })()}</span>
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
