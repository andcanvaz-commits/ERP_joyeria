"use client";

import { ChangeEvent, FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { Boxes, ChevronDown, ChevronLeft, ChevronRight, Download, Eye, Minus, Pencil, Plus, Printer, Save, Upload, X } from "lucide-react";
import { createPortal } from "react-dom";
import { getAccessToken } from "@/lib/api";
import { openableProps, stopClick } from "@/lib/a11y";
import { buildItemNameMap, buildOrdenProduccion } from "@/lib/orden-produccion";
import { OrdenProduccionDoc, type DocMode } from "@/components/documentos/orden-produccion-doc";
import { getCurrentUser, listUsers, type CurrentUser, type ManagedUser } from "@/lib/auth-api";
import {
  createInventoryItem,
  createInventoryMovement,
  downloadInventoryMovementSourceFile,
  getInventorySummary,
  listInventoryItems,
  listInventoryMovements,
  updateInventoryItem,
  type CreateInventoryMovementPayload,
  type SaveInventoryItemPayload,
} from "@/lib/inventory-api";
import {
  approveProductionRunMaterials,
  listProductionRuns,
  receiveProductionRunFinishedProduct,
} from "@/lib/production-api";
import type { InventoryItem, InventoryItemType, InventoryMovement, InventoryMovementType, InventorySummary } from "@/types/inventory";
import type { ProductionRun } from "@/types/production";

const ITEM_TYPES: Array<{ value: InventoryItemType | "TODOS"; label: string }> = [
  { value: "RAW_MATERIAL", label: "Materia prima" },
  { value: "WORK_IN_PROGRESS", label: "Producto en proceso" },
  { value: "FINISHED_PRODUCT", label: "Producto terminado" },
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
];

const RECENT_MOVEMENT_DAYS = 30;
const WEEK_DAYS = ["Lun", "Mar", "Mie", "Jue", "Vie", "Sab", "Dom"];

const emptyItemForm = (): SaveInventoryItemPayload => ({
  item_type: "RAW_MATERIAL",
  name: "",
  description: "",
  unit_code: "g",
});

const emptyMovementForm = (): CreateInventoryMovementPayload => ({
  item_id: "",
  movement_type: "ENTRADA",
  quantity: "",
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

function itemTypeLabel(type: InventoryItemType) {
  return ITEM_TYPES.find((item) => item.value === type)?.label ?? type;
}

function movementTypeLabel(type: InventoryMovementType) {
  return MOVEMENT_TYPES.find((item) => item.value === type)?.label ?? type;
}

function unitLabel(value: string) {
  return UNIT_OPTIONS.find((unit) => unit.value === value)?.label ?? `${value} (detectada)`;
}

function isXmlInvoiceItem(item: InventoryItem) {
  return item.description?.startsWith("Creado desde factura XML.") ?? false;
}

function numericText(value: string | null) {
  if (!value) return "0";
  const number = Number(value);
  return Number.isFinite(number) ? number.toLocaleString("es-EC", { maximumFractionDigits: 4 }) : value;
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

export function InventoryDashboard() {
  const xmlInputRef = useRef<HTMLInputElement | null>(null);
  const entryMenuRef = useRef<HTMLDivElement | null>(null);
  const [summary, setSummary] = useState<InventorySummary | null>(null);
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [movements, setMovements] = useState<InventoryMovement[]>([]);
  const [currentUser, setCurrentUser] = useState<CurrentUser | null>(null);
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [itemFilter, setItemFilter] = useState<InventoryItemType | "TODOS">("RAW_MATERIAL");
  const [search, setSearch] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [isItemFormOpen, setIsItemFormOpen] = useState(false);
  const [isMovementFormOpen, setIsMovementFormOpen] = useState(false);
  const [isEntryMenuOpen, setIsEntryMenuOpen] = useState(false);
  const [isMovementHistoryOpen, setIsMovementHistoryOpen] = useState(false);
  const [historyMonth, setHistoryMonth] = useState(() => monthKey(new Date()));
  const [selectedHistoryDate, setSelectedHistoryDate] = useState(() => dateKey(new Date()));
  const [viewingMovement, setViewingMovement] = useState<InventoryMovement | null>(null);
  const [viewingRun, setViewingRun] = useState<ProductionRun | null>(null);
  const [printPreview, setPrintPreview] = useState<{ run: ProductionRun; mode: DocMode } | null>(null);
  const [printingMode, setPrintingMode] = useState<DocMode | null>(null);
  const [itemForm, setItemForm] = useState<SaveInventoryItemPayload>(emptyItemForm);
  const [movementForm, setMovementForm] = useState<CreateInventoryMovementPayload>(emptyMovementForm);
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [viewingItem, setViewingItem] = useState<InventoryItem | null>(null);
  const [productionRuns, setProductionRuns] = useState<ProductionRun[]>([]);
  const [isSavingProduction, setIsSavingProduction] = useState(false);
  const [isSolicitudesOpen, setIsSolicitudesOpen] = useState(false);
  const [expandedSolicitudId, setExpandedSolicitudId] = useState<string | null>(null);

  async function loadInventory() {
    if (!getAccessToken()) {
      window.location.href = "/login";
      return;
    }

    setIsLoading(true);
    setError(null);
    try {
      const nextCurrentUser = await getCurrentUser();
      const canSeeAudit = nextCurrentUser.role === "admin" || nextCurrentUser.role === "Admin";
      const [nextSummary, nextItems, nextMovements, nextUsers, nextRuns] = await Promise.all([
        getInventorySummary(),
        listInventoryItems(),
        listInventoryMovements(),
        canSeeAudit ? listUsers() : Promise.resolve([]),
        listProductionRuns(),
      ]);
      setCurrentUser(nextCurrentUser);
      setUsers(nextUsers);
      setSummary(nextSummary);
      setItems(nextItems);
      setMovements(nextMovements);
      setProductionRuns(nextRuns);
      setMovementForm((current) => ({ ...current, item_id: current.item_id || nextItems[0]?.id || "" }));
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "No se pudo cargar inventario.");
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    void loadInventory();
  }, []);

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

  const filteredItems = useMemo(() => {
    const term = search.trim().toLowerCase();
    return items.filter((item) => {
      const matchesType = itemFilter === "TODOS" || item.item_type === itemFilter;
      const matchesSearch =
        term.length === 0 ||
        item.name.toLowerCase().includes(term) ||
        item.sku.toLowerCase().includes(term);
      return matchesType && matchesSearch;
    });
  }, [items, itemFilter, search]);
  const unitOptions = useMemo(() => {
    const options = [...UNIT_OPTIONS];
    for (const unitCode of [itemForm.unit_code, ...items.map((item) => item.unit_code)]) {
      if (unitCode && !options.some((option) => option.value === unitCode)) {
        options.push({ value: unitCode, label: unitLabel(unitCode) });
      }
    }
    return options;
  }, [itemForm.unit_code, items]);

  const usersById = useMemo(() => new Map(users.map((user) => [user.id, user])), [users]);
  const canSeeMovementAudit = currentUser?.role === "admin" || currentUser?.role === "Admin";
  const editingItem = editingItemId ? items.find((item) => item.id === editingItemId) ?? null : null;
  const isEditingXmlItem = editingItem ? isXmlInvoiceItem(editingItem) : false;
  const movementItemType: InventoryItemType = movementForm.movement_type === "SALIDA" ? "FINISHED_PRODUCT" : "RAW_MATERIAL";
  const movementItems = useMemo(
    () => items.filter((item) => item.item_type === movementItemType),
    [items, movementItemType],
  );
  const sortedMovements = useMemo(
    () => [...movements].sort((left, right) => new Date(right.created_at).getTime() - new Date(left.created_at).getTime()),
    [movements],
  );
  const lastMonthMovements = useMemo(() => {
    const minimumDate = new Date();
    minimumDate.setDate(minimumDate.getDate() - RECENT_MOVEMENT_DAYS);
    minimumDate.setHours(0, 0, 0, 0);
    return sortedMovements.filter((movement) => {
      const movementDate = new Date(movement.created_at);
      return !Number.isNaN(movementDate.getTime()) && movementDate >= minimumDate;
    });
  }, [sortedMovements]);
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
      setProductionRuns(nextRuns);
      const remaining = nextRuns.filter((r) => r.status === "PENDIENTE_INVENTARIO" || r.status === "PENDIENTE_RECEPCION").length;
      if (remaining === 0) {
        setIsSolicitudesOpen(false);
      }
      void loadInventory();
      setPrintPreview({ run: updated, mode: "entrega" });
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "No se pudo aprobar la salida de materia prima.");
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
      setProductionRuns(nextRuns);
      const remaining = nextRuns.filter((r) => r.status === "PENDIENTE_INVENTARIO" || r.status === "PENDIENTE_RECEPCION").length;
      if (remaining === 0) {
        setIsSolicitudesOpen(false);
      }
      void loadInventory();
      setPrintPreview({ run: updated, mode: "recepcion" });
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "No se pudo recibir el producto terminado.");
    } finally {
      setIsSavingProduction(false);
    }
  }

  const pendingInventoryRuns = productionRuns.filter((run) => run.status === "PENDIENTE_INVENTARIO");
  const pendingReceptionRuns = productionRuns.filter((run) => run.status === "PENDIENTE_RECEPCION");
  const receivedRuns = productionRuns.filter((run) => run.status === "RECIBIDA");
  const receivedCodes = new Set(receivedRuns.map((run) => run.production_code).filter(Boolean) as string[]);
  // En "Producto terminado": las órdenes recibidas se muestran como filas (con id OP);
  // ocultamos el item de stock auto-creado con ese mismo código para no duplicar.
  const displayItems =
    itemFilter === "FINISHED_PRODUCT" ? filteredItems.filter((item) => !receivedCodes.has(item.sku)) : filteredItems;

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
    setIsMovementHistoryOpen(true);
  }

  function openCreateItem() {
    setEditingItemId(null);
    setItemForm(emptyItemForm());
    setIsItemFormOpen(true);
  }

  function openManualEntry() {
    const firstRawMaterial = items.find((item) => item.item_type === "RAW_MATERIAL");
    setMovementForm({ ...emptyMovementForm(), item_id: firstRawMaterial?.id || "", movement_type: "ENTRADA" });
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

  function openEditItem(item: InventoryItem) {
    if (item.item_type !== "RAW_MATERIAL") return;
    setEditingItemId(item.id);
    setItemForm({
      item_type: item.item_type,
      name: item.name,
      description: item.description ?? "",
      unit_code: item.unit_code,
    });
    setIsItemFormOpen(true);
  }

  async function handleSaveItem(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIsSaving(true);
    setError(null);
    try {
      const payload = {
        ...itemForm,
        item_type: "RAW_MATERIAL" as const,
        description: isEditingXmlItem ? editingItem?.description ?? null : itemForm.description?.trim() || null,
        unit_code: isEditingXmlItem ? editingItem?.unit_code ?? itemForm.unit_code : itemForm.unit_code,
        minimum_stock: null,
      };
      if (editingItemId) {
        await updateInventoryItem(editingItemId, payload);
        setSuccess("Item actualizado correctamente.");
      } else {
        await createInventoryItem(payload);
        setSuccess("Item creado correctamente.");
      }
      setIsItemFormOpen(false);
      await loadInventory();
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
      await createInventoryMovement({
        ...movementForm,
        unit_cost: null,
        reference_type: null,
        reference_id: null,
      });
      setSuccess("Movimiento registrado correctamente.");
      setIsMovementFormOpen(false);
      setMovementForm(emptyMovementForm());
      await loadInventory();
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

    setIsSaving(true);
    setError(null);
    try {
      const content = await file.text();
      const invoice = parseInvoiceDetails(content);
      const details = invoice.details;
      if (details.length === 0) {
        throw new Error("No encontramos productos dentro de esta factura XML.");
      }

      let imported = 0;
      let nextItems = items;
      for (const detail of details) {
        let item = nextItems.find((candidate) => candidate.name.toLowerCase() === detail.description.toLowerCase());
        if (!item) {
          const metadata = [
            "Creado desde factura XML.",
            detail.code ? `Codigo factura: ${detail.code}.` : null,
            invoice.supplier ? `Proveedor: ${invoice.supplier}.` : null,
          ].filter(Boolean).join(" ");
          item = await createInventoryItem({
            item_type: "RAW_MATERIAL",
            name: detail.description,
            description: metadata,
            unit_code: detail.unitCode || "und",
            minimum_stock: null,
          });
          nextItems = [...nextItems, item];
        }

        const invoiceReference = invoice.invoiceNumber || invoice.accessKey || file.name;
        await createInventoryMovement({
          item_id: item.id,
          movement_type: "ENTRADA",
          quantity: detail.quantity,
          unit_cost: null,
          reason: `Ingreso por factura XML ${invoiceReference}`,
          reference_type: null,
          reference_id: null,
          source_file_name: file.name,
          source_file_mime: file.type || "application/xml",
          source_file_content: content,
        });
        imported += 1;
      }

      if (imported === 0) {
        throw new Error("No encontramos cantidades validas para ingresar al inventario.");
      }
      setSuccess(`Factura XML importada: ${imported} lineas registradas.`);
      await loadInventory();
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

      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <button
          className="solicitudesButton"
          onClick={() => { setIsSolicitudesOpen(true); setExpandedSolicitudId(null); }}
          type="button"
        >
          Solicitudes de produccion
          {pendingInventoryRuns.length + pendingReceptionRuns.length > 0 ? (
            <span className="solicitudesBadge">{pendingInventoryRuns.length + pendingReceptionRuns.length}</span>
          ) : null}
        </button>
      </div>

      <section className="inventoryShell">
        <article className="card panelBody inventoryPanel">
          <div className="panelHeader">
            <div>
              <h2 className="panelTitle">Inventario actual</h2>
              <p className="panelText">
                {itemFilter === "RAW_MATERIAL"
                  ? "Ingresos manuales y facturas XML de materia prima"
                  : itemFilter === "FINISHED_PRODUCT"
                    ? "Salidas comerciales de productos terminados"
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
                  <button className="button buttonPrimary" onClick={openCreateItem} type="button">
                    <Plus aria-hidden="true" size={17} />
                    Materia prima
                  </button>
                </>
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
            <div className="segmentedControl" aria-label="Filtrar por tipo">
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
            <input
              className="field searchField"
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Buscar por nombre o SKU"
              value={search}
            />
          </div>

          <div className="inventoryList">
            {itemFilter === "FINISHED_PRODUCT"
              ? receivedRuns.map((run) => (
                  <div className="inventoryItemRow" key={`recibida-${run.id}`}>
                    <div>
                      <strong>
                        {run.production_code ? <span className="orderCodeTag">{run.production_code}</span> : null}
                        {run.process_name}
                      </strong>
                      <span>Producto terminado · recibido</span>
                    </div>
                    <span className="stockPill">{run.quantity} und</span>
                  </div>
                ))
              : null}
            {displayItems.map((item) => (
              <article className="inventoryItemRow" key={item.id} {...openableProps(() => setViewingItem(item), `Ver detalle de ${item.name}`)}>
                <div>
                  <strong>{item.name}</strong>
                  <span>{item.sku} - {itemTypeLabel(item.item_type)}</span>
                </div>
                <div className="stockPill">
                  {numericText(item.current_stock)} {item.unit_code}
                </div>
                <div className="rowActions" onClick={stopClick}>
                  <button className="iconTextButton" onClick={() => setViewingItem(item)} type="button">
                    <Eye aria-hidden="true" size={15} />
                    Visualizar
                  </button>
                  {item.item_type === "RAW_MATERIAL" ? (
                    <>
                      <button className="iconTextButton" onClick={() => openEditItem(item)} type="button">
                        <Pencil aria-hidden="true" size={15} />
                        Editar
                      </button>
                    </>
                  ) : null}
                </div>
              </article>
            ))}
            {itemFilter === "WORK_IN_PROGRESS" ? (
              productionRuns.filter((r) => r.status === "EN_PROCESO").map((run) => (
                <div className="inventoryItemRow" key={`run-${run.id}`} style={{ borderColor: "#e3cfa6", background: "#faf6ee" }} {...openableProps(() => setViewingRun(run), `Ver avance de ${run.process_name}`)}>
                  <div>
                    <strong>
                      {run.production_code ? <span className="orderCodeTag">{run.production_code}</span> : null}
                      {run.process_name}
                    </strong>
                    <span>Orden en proceso · {run.quantity} unidades</span>
                  </div>
                  <span className="stockPill" style={{ background: "#f3e9d6" }}>{run.quantity} und</span>
                  <button className="iconTextButton" onClick={(event) => { event.stopPropagation(); setViewingRun(run); }} type="button">
                    <Eye aria-hidden="true" size={15} />
                    Visualizar
                  </button>
                </div>
              ))
            ) : null}
            {!isLoading
              && displayItems.length === 0
              && !(itemFilter === "WORK_IN_PROGRESS" && productionRuns.some((r) => r.status === "EN_PROCESO"))
              && !(itemFilter === "FINISHED_PRODUCT" && receivedRuns.length > 0)
              ? <div className="emptyState">No hay items para este filtro.</div> : null}
            {isLoading ? <div className="emptyState">Cargando inventario...</div> : null}
          </div>
        </article>

        <article className="card panelBody inventoryPanel">
          <div className="panelHeader">
            <div>
              <h2 className="panelTitle">Movimientos</h2>
              <p className="panelText">Movimientos de los ultimos 30 dias</p>
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
            {lastMonthMovements.map((movement) => (
              <article className="movementRow" key={movement.id} {...openableProps(() => setViewingMovement(movement), `Ver movimiento de ${movement.item.name}`)}>
                <div>
                  <strong>{movementTypeLabel(movement.movement_type)}</strong>
                  {movement.lot_code ? (
                    <span style={{ fontFamily: "monospace", fontSize: 11, color: "var(--primary-strong)", fontWeight: 700 }}>{movement.lot_code}</span>
                  ) : null}
                  <span>{movementDateLabel(movement.created_at)} - {movement.item.name}</span>
                </div>
                <div>
                  <strong>{numericText(movement.quantity)} {movement.unit_code}</strong>
                  <span>{movementTimeLabel(movement.created_at)}{movement.reason ? ` - ${movement.reason}` : ""}</span>
                  {movement.created_by_name ? <span>Por: {movement.created_by_name}</span> : null}
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
            {!isLoading && movements.length === 0 ? <div className="emptyState">No hay movimientos registrados.</div> : null}
            {!isLoading && movements.length > 0 && lastMonthMovements.length === 0 ? (
              <div className="emptyState">No hay movimientos en los ultimos 30 dias.</div>
            ) : null}
            {isLoading ? <div className="emptyState">Cargando movimientos...</div> : null}
          </div>
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
                <div>
                  <h3>{movementDateLabel(`${selectedHistoryDate}T00:00:00`)}</h3>
                  <p>{selectedDateMovements.length} movimientos registrados</p>
                </div>
                <div className="movementList movementHistoryEntries">
                  {selectedDateMovements.map((movement) => (
                    <article className="movementRow" key={movement.id} {...openableProps(() => setViewingMovement(movement), `Ver movimiento de ${movement.item.name}`)}>
                      <div>
                        <strong>{movementTypeLabel(movement.movement_type)}</strong>
                        {movement.lot_code ? (
                          <span style={{ fontFamily: "monospace", fontSize: 11, color: "var(--primary-strong)", fontWeight: 700 }}>{movement.lot_code}</span>
                        ) : null}
                        <span>{movementTimeLabel(movement.created_at)} - {movement.item.name}</span>
                      </div>
                      <div>
                        <strong>{numericText(movement.quantity)} {movement.unit_code}</strong>
                        <span>{movement.reason || "Sin motivo registrado"}</span>
                        {movement.created_by_name ? <span>Por: {movement.created_by_name}</span> : null}
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
                  {selectedDateMovements.length === 0 ? <div className="emptyState">No hay movimientos en esta fecha.</div> : null}
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
                <h2>{editingItemId ? "Editar item" : "Crear item"}</h2>
                <p>Mantenimiento de inventario</p>
              </div>
              <button aria-label="Cerrar" className="iconOnlyButton" onClick={() => setIsItemFormOpen(false)} type="button">
                <X aria-hidden="true" size={18} />
              </button>
            </div>
            <label className="fieldGroup">
              <span>Nombre</span>
              <input className="field" onChange={(event) => setItemForm((current) => ({ ...current, name: event.target.value }))} value={itemForm.name} />
            </label>
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
            <label className="fieldGroup">
              <span>Motivo</span>
              <textarea className="field textareaCompact" onChange={(event) => setMovementForm((current) => ({ ...current, reason: event.target.value }))} value={movementForm.reason} />
            </label>
            <div className="modalActions">
              <button className="button buttonPrimary" disabled={isSaving || !movementForm.item_id} type="submit">
                <Save aria-hidden="true" size={17} />
                {isSaving ? "Guardando" : "Registrar"}
              </button>
            </div>
          </form>
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
            <div className="userPreviewGrid">
              <span><strong>Stock actual</strong>{numericText(viewingItem.current_stock)} {viewingItem.unit_code}</span>
              <span><strong>Caso</strong>{itemTypeLabel(viewingItem.item_type)}</span>
              <span><strong>Identificador</strong>{viewingItem.sku}</span>
            </div>
            <p className="panelText">{viewingItem.description || "Sin descripcion"}</p>
          </section>
        </div>
      ) : null}

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
            <div className="userPreviewGrid">
              <span><strong>Cantidad</strong>{numericText(viewingMovement.quantity)} {viewingMovement.unit_code}</span>
              {viewingMovement.unit_cost ? <span><strong>Costo unitario</strong>{numericText(viewingMovement.unit_cost)}</span> : null}
              {viewingMovement.lot_code ? <span><strong>Lote</strong>{viewingMovement.lot_code}</span> : null}
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
                <p>{numericText(viewingRun.quantity)} unidades en proceso</p>
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
                  <div className="userPreviewGrid">
                    <span><strong>Etapa actual</strong>{current ? `${current.stage_order}. ${current.stage_name}` : "—"}</span>
                    <span><strong>Avance</strong>{done} de {stages.length} etapas</span>
                  </div>
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
                        <button
                          className="button buttonPrimary"
                          disabled={isSavingProduction}
                          onClick={() => void handleApproveMaterials(run)}
                          type="button"
                          style={{ flexShrink: 0 }}
                        >
                          Aprobar
                        </button>
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
                            <strong>Cantidad</strong>
                            <span>{numericText(run.quantity)} unidades</span>
                          </div>
                          <div className="solicitudDetailItem">
                            <strong>Material requerido</strong>
                            <span>{numericText(run.total_required_material)} {run.raw_material_unit_code}</span>
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
                            <strong>Finalizado</strong>
                            <span>{productionTimeLabel(run.finished_at)}</span>
                          </div>
                          <div className="solicitudDetailItem">
                            <strong>Merma</strong>
                            <span>{numericText(run.waste_percent)}%</span>
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
