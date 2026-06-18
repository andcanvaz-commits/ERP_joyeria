"use client";

import { ChangeEvent, FormEvent, useEffect, useMemo, useRef, useState } from "react";
import { Boxes, ChevronLeft, ChevronRight, Download, Eye, Pencil, Plus, Save, X } from "lucide-react";
import { getAccessToken } from "@/lib/api";
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
import type { InventoryItem, InventoryItemType, InventoryMovement, InventoryMovementType, InventorySummary } from "@/types/inventory";

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
  const [isMovementHistoryOpen, setIsMovementHistoryOpen] = useState(false);
  const [historyMonth, setHistoryMonth] = useState(() => monthKey(new Date()));
  const [selectedHistoryDate, setSelectedHistoryDate] = useState(() => dateKey(new Date()));
  const [itemForm, setItemForm] = useState<SaveInventoryItemPayload>(emptyItemForm);
  const [movementForm, setMovementForm] = useState<CreateInventoryMovementPayload>(emptyMovementForm);
  const [editingItemId, setEditingItemId] = useState<string | null>(null);
  const [viewingItem, setViewingItem] = useState<InventoryItem | null>(null);

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
      const [nextSummary, nextItems, nextMovements, nextUsers] = await Promise.all([
        getInventorySummary(),
        listInventoryItems(),
        listInventoryMovements(),
        canSeeAudit ? listUsers() : Promise.resolve([]),
      ]);
      setCurrentUser(nextCurrentUser);
      setUsers(nextUsers);
      setSummary(nextSummary);
      setItems(nextItems);
      setMovements(nextMovements);
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
        <div className="toastStack">
          {error ? <div className="notice noticeError">{error}</div> : null}
          {success ? <div className="notice noticeSuccess">{success}</div> : null}
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

      <section className="inventoryShell">
        <article className="card panelBody inventoryPanel">
          <div className="panelHeader">
            <div>
              <h2 className="panelTitle">Inventario actual</h2>
              <p className="panelText">Ingresos manuales y facturas XML de materia prima</p>
            </div>
            <div className="rowActions">
              <button className="button" onClick={() => {
                setMovementForm({ ...emptyMovementForm(), movement_type: "ENTRADA" });
                setIsMovementFormOpen(true);
              }} type="button">
                <Plus aria-hidden="true" size={17} />
                Entrada
              </button>
              <button className="button" onClick={() => {
                setMovementForm({ ...emptyMovementForm(), movement_type: "SALIDA" });
                setIsMovementFormOpen(true);
              }} type="button">
                <Plus aria-hidden="true" size={17} />
                Salida
              </button>
              <button className="button" onClick={() => xmlInputRef.current?.click()} type="button">
                <Plus aria-hidden="true" size={17} />
                Factura XML
              </button>
              <input accept=".xml,text/xml" hidden onChange={handleXmlInvoice} ref={xmlInputRef} type="file" />
              <button className="button buttonPrimary" onClick={openCreateItem} type="button">
                <Plus aria-hidden="true" size={17} />
                Materia prima
              </button>
            </div>
          </div>

          <div className="toolbar">
            <div className="segmentedControl" aria-label="Filtrar por tipo">
              {ITEM_TYPES.map((type) => (
                <button
                  className={itemFilter === type.value ? "segmentActive" : ""}
                  key={type.value}
                  onClick={() => setItemFilter(type.value)}
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
            {filteredItems.map((item) => (
              <article className="inventoryItemRow" key={item.id}>
                <div>
                  <strong>{item.name}</strong>
                  <span>{item.sku} - {itemTypeLabel(item.item_type)}</span>
                </div>
                <div className="stockPill">
                  {numericText(item.current_stock)} {item.unit_code}
                </div>
                <div className="rowActions">
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
            {!isLoading && filteredItems.length === 0 ? <div className="emptyState">No hay items para este filtro.</div> : null}
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
              <div className="movementRow" key={movement.id}>
                <div>
                  <strong>{movementTypeLabel(movement.movement_type)}</strong>
                  <span>{movementDateLabel(movement.created_at)} - {movement.item.name}</span>
                </div>
                <div>
                  <strong>{numericText(movement.quantity)} {movement.unit_code}</strong>
                  <span>{movementTimeLabel(movement.created_at)}{movement.reason ? ` - ${movement.reason}` : ""}</span>
                  {canSeeMovementAudit ? <span>Registrado por: {movementActorName(movement.created_by)}</span> : null}
                  {movement.source_file_name ? (
                    <button className="iconTextButton" onClick={() => void handleDownloadMovementSourceFile(movement)} type="button">
                      <Download aria-hidden="true" size={15} />
                      XML
                    </button>
                  ) : null}
                </div>
              </div>
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
              <button className="iconOnlyButton" onClick={() => setIsMovementHistoryOpen(false)} type="button">
                <X aria-hidden="true" size={18} />
              </button>
            </div>
            <div className="movementHistoryLayout">
              <section className="movementCalendarPanel" aria-label="Calendario de movimientos">
                <div className="movementCalendarHeader">
                  <button className="iconOnlyButton" onClick={() => moveHistoryMonth(-1)} type="button">
                    <ChevronLeft aria-hidden="true" size={18} />
                  </button>
                  <strong>{historyMonthLabel}</strong>
                  <button className="iconOnlyButton" onClick={() => moveHistoryMonth(1)} type="button">
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
                    <div className="movementRow" key={movement.id}>
                      <div>
                        <strong>{movementTypeLabel(movement.movement_type)}</strong>
                        <span>{movementTimeLabel(movement.created_at)} - {movement.item.name}</span>
                      </div>
                      <div>
                        <strong>{numericText(movement.quantity)} {movement.unit_code}</strong>
                        <span>{movement.reason || "Sin motivo registrado"}</span>
                        {canSeeMovementAudit ? <span>Registrado por: {movementActorName(movement.created_by)}</span> : null}
                        {movement.source_file_name ? (
                          <button className="iconTextButton" onClick={() => void handleDownloadMovementSourceFile(movement)} type="button">
                            <Download aria-hidden="true" size={15} />
                            XML
                          </button>
                        ) : null}
                      </div>
                    </div>
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
              <button className="iconOnlyButton" onClick={() => setIsItemFormOpen(false)} type="button">
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
                <h2>Registrar ingreso</h2>
                <p>Todo ingreso manual queda trazado como movimiento</p>
              </div>
              <button className="iconOnlyButton" onClick={() => setIsMovementFormOpen(false)} type="button">
                <X aria-hidden="true" size={18} />
              </button>
            </div>
            <label className="fieldGroup">
              <span>Item</span>
              <select className="field" onChange={(event) => setMovementForm((current) => ({ ...current, item_id: event.target.value }))} value={movementForm.item_id}>
                <option value="">Seleccionar item</option>
                {items.filter((item) => item.item_type === "RAW_MATERIAL").map((item) => (
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
              <button className="iconOnlyButton" onClick={() => setViewingItem(null)} type="button">
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
    </div>
  );
}
