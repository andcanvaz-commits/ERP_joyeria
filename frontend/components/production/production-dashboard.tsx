"use client";

import { FormEvent, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ArrowRight, Boxes, CalendarDays, Check, CheckCheck, ChevronDown, ChevronLeft, ChevronRight, Eye, Factory, FileText, FlaskConical, Hourglass, Pencil, Play, Plus, Printer, Puzzle, Ruler, Save, Trash2, UserPlus, Users, X } from "lucide-react";
import { ProductTypesManager } from "@/components/mantenimiento/product-types-manager";
import { UnitsManager } from "@/components/mantenimiento/units-manager";
import { RawMaterialsManager } from "@/components/mantenimiento/raw-materials-manager";
import { SuppliesManager } from "@/components/mantenimiento/supplies-manager";
import { ComplementsManager } from "@/components/mantenimiento/complements-manager";
import { FinishedItemPicker } from "@/components/inventory/finished-item-picker";
import { MaterialCategoryPicker } from "@/components/production/material-category-picker";
import { AdminAddActaLineControl } from "@/components/production/admin-add-acta-line";
import { StageRecepcionControl } from "@/components/production/stage-recepcion-control";
import { OrdenProduccionDoc } from "@/components/documentos/orden-produccion-doc";
import { ActaView } from "@/components/production/acta-view";
import { CatalogProductPicker } from "@/components/inventory/catalog-product-picker";
import { ComplementPicker } from "@/components/inventory/complement-picker";
import { isAuthenticated } from "@/lib/api";
import { openableProps, stopClick } from "@/lib/a11y";
import {
  activateUser,
  createUser,
  deactivateUser,
  deleteUser,
  getCurrentUser,
  listUsers,
  type ManagedUser,
  resetUserPassword,
  updateUser,
} from "@/lib/auth-api";
import { listInventoryItems } from "@/lib/inventory-api";
import { listProductTypes } from "@/lib/product-types-api";
import { listUnits } from "@/lib/units-api";
import {
  addAdminActaLine,
  allocateStageAttemptMaterial,
  cancelProductionRun,
  cancelProductionRunFamily,
  createProcess,
  createProductionOrder,
  deleteActaLine,
  deleteProcess,
  finishOrder,
  finishStageAttempt,
  listProcesses,
  listProductionRuns,
  revertStageAttempt,
  startStageAttempt,
  updateActaLine,
  updateProcess,
  updateProductionRunProducts,
} from "@/lib/production-api";
import type { InventoryItem } from "@/types/inventory";
import type { ProductChoice, ProductionProcess, ProductionRun, ProductionRunStage } from "@/types/production";
import { CaliperScale } from "@/components/ui/caliper-scale";
import { Pager, usePagination } from "@/components/shared/pager";
import { RunStageSummaryTable, RunWasteHero } from "@/components/production/run-stage-summary";
import { StatusBadge } from "@/components/ui/status-badge";
import { ToastNotice } from "@/components/ui/toast-notice";
import { StatusPunch } from "@/components/ui/status-punch";
import { buildOrdenProduccion, getRunFamily, groupRunFamilies } from "@/lib/orden-produccion";
import { runCurrentStage, runCurrentWeight } from "@/lib/production-run-helpers";
import { useCountUp } from "@/hooks/use-count-up";

// Banco de procesos (docs/cambios-sistema-produccion.md seccion 3): un paso
// suelto reutilizable, sin sub-etapas ni insumos preconfigurados -- eso se
// agrega suelto por etapa en el acta (mismo mecanismo ADMIN_STOCK/MANUAL).
type ProcessForm = {
  name: string;
  description: string;
  qualityControl: boolean;
};

type FormMode = "create" | "edit";
type UserFormMode = "create" | "edit";

const SYSTEM_ROLES = ["Admin", "Producción/Inventario"];

const MATERIAL_TYPE_LABEL: Record<string, string> = {
  RAW_MATERIAL: "Materia prima",
  COMPLEMENT: "Complemento",
  WASTE: "Merma",
  SUPPLY: "Insumo",
};

const itemTypeLabel = (type: string): string => MATERIAL_TYPE_LABEL[type] ?? type;

// Solo para etiquetar el tipo de etapa de ORDENES VIEJAS (ProductionRunStage,
// flujo historico) -- el banco de procesos nuevo ya no tiene sub-etapas.
const STAGE_TYPES: { value: string; label: string }[] = [
  { value: "PROCESS", label: "Proceso" },
  { value: "THERMAL", label: "Proceso térmico" },
  { value: "CHEMICAL", label: "Proceso químico" },
  { value: "CONTROL", label: "Control / Revisión" },
];

const stageTypeLabel = (value: string): string =>
  STAGE_TYPES.find((type) => type.value === value)?.label ?? value;

const emptyProcessForm = (): ProcessForm => ({
  name: "",
  description: "",
  qualityControl: false,
});

const emptyUserForm = () => ({
  first_name: "",
  last_name: "",
  role: "Admin",
});

function processToForm(process: ProductionProcess): ProcessForm {
  return {
    name: process.name,
    description: process.description ?? "",
    qualityControl: process.quality_control,
  };
}

async function fetchProductionBundle(variant: "production" | "maintenance") {
  const [nextProcesses, nextUsers, nextRuns, nextRawMaterials, nextSupplies, nextComplements, nextWaste, nextFinishedItems] = await Promise.all([
    listProcesses(),
    variant === "maintenance" ? listUsers() : Promise.resolve([]),
    variant === "production" ? listProductionRuns() : Promise.resolve([]),
    listInventoryItems("RAW_MATERIAL"),
    listInventoryItems("SUPPLY"),
    variant === "production" ? listInventoryItems("COMPLEMENT") : Promise.resolve([]),
    variant === "production" ? listInventoryItems("WASTE") : Promise.resolve([]),
    variant === "production" ? listInventoryItems("FINISHED_PRODUCT") : Promise.resolve([]),
  ]);
  return {
    processes: nextProcesses,
    users: nextUsers,
    runs: nextRuns,
    // Un item archivado no debe poder elegirse para una orden nueva en vivo.
    rawMaterials: nextRawMaterials.filter((item) => !item.archived_at),
    // Los insumos aqui solo se usan para RESOLVER el nombre en la tabla de
    // "insumos de este proceso" (ya vienen fijados por el proceso, no se
    // eligen aqui): un insumo archivado sigue necesitando mostrar su nombre.
    supplies: nextSupplies,
    complements: nextComplements,
    waste: nextWaste,
    finishedItems: nextFinishedItems,
  };
}

const EMPTY_PROCESSES: ProductionProcess[] = [];
const EMPTY_USERS: ManagedUser[] = [];
const EMPTY_RUNS: ProductionRun[] = [];
const EMPTY_RAW_MATERIALS: InventoryItem[] = [];

export function ProductionDashboard({ variant = "production" }: { variant?: "production" | "maintenance" }) {
  const queryClient = useQueryClient();

  const { data: currentUser = null, error: meError } = useQuery({
    queryKey: ["me"],
    queryFn: getCurrentUser,
    enabled: isAuthenticated(),
  });

  const {
    data: bundle,
    isLoading: isBundleLoading,
    error: bundleError,
  } = useQuery({
    queryKey: ["production", variant],
    queryFn: () => fetchProductionBundle(variant),
    enabled: Boolean(currentUser),
    // Materiales y aprobaciones cambian en la ventana del jefe de inventario:
    // ambas variantes deben enterarse solas (sin F5), igual que el badge del menú.
    refetchInterval: 30000,
    refetchOnWindowFocus: true,
  });

  // Mismas queryKeys que los managers de mantenimiento: al crear/eliminar alli
  // se invalidan y estos conteos se refrescan solos.
  const { data: unitsList = [] } = useQuery({
    queryKey: ["units"],
    queryFn: listUnits,
    enabled: Boolean(currentUser) && variant === "maintenance",
  });
  // Stock cambia desde Inventario (Entrada), que solo invalida ["inventory"]
  // — sin refetch propio esta lista (usada con stock real en el picker de
  // materiales del proceso) queda vieja hasta recargar la pagina.
  const { data: rawMaterialsList = EMPTY_RAW_MATERIALS } = useQuery({
    queryKey: ["raw-materials"],
    queryFn: () => listInventoryItems("RAW_MATERIAL"),
    enabled: Boolean(currentUser) && variant === "maintenance",
    refetchInterval: 30000,
    refetchOnWindowFocus: true,
  });
  // Tipos de producto del catálogo: tile, selector del form de proceso y
  // combo de producto objetivo al crear orden.
  const { data: productTypesList = [] } = useQuery({
    queryKey: ["product-types"],
    queryFn: listProductTypes,
    enabled: Boolean(currentUser),
  });
  const { data: suppliesList = EMPTY_RAW_MATERIALS } = useQuery({
    queryKey: ["supplies"],
    queryFn: () => listInventoryItems("SUPPLY"),
    enabled: Boolean(currentUser) && variant === "maintenance",
    refetchInterval: 30000,
    refetchOnWindowFocus: true,
  });
  const { data: complementsList = EMPTY_RAW_MATERIALS } = useQuery({
    queryKey: ["complements"],
    queryFn: () => listInventoryItems("COMPLEMENT"),
    enabled: Boolean(currentUser) && variant === "maintenance",
    refetchInterval: 30000,
    refetchOnWindowFocus: true,
  });
  // Merma reclasificada: opcion elegible como material de proceso (materia
  // prima/complementos/merma), igual que en el picker de Inventario.
  const { data: wasteList = EMPTY_RAW_MATERIALS } = useQuery({
    queryKey: ["waste-items"],
    queryFn: () => listInventoryItems("WASTE"),
    enabled: Boolean(currentUser) && variant === "maintenance",
    refetchInterval: 30000,
    refetchOnWindowFocus: true,
  });
  const processes = bundle?.processes ?? EMPTY_PROCESSES;
  const users = bundle?.users ?? EMPTY_USERS;
  const runs = bundle?.runs ?? EMPTY_RUNS;
  const rawMaterials = bundle?.rawMaterials ?? EMPTY_RAW_MATERIALS;
  const orderSupplyItems = bundle?.supplies ?? EMPTY_RAW_MATERIALS;
  const complementItems = bundle?.complements ?? EMPTY_RAW_MATERIALS;
  const wasteItems = bundle?.waste ?? EMPTY_RAW_MATERIALS;
  const finishedItems = bundle?.finishedItems ?? EMPTY_RAW_MATERIALS;
  const isLoading = !currentUser || isBundleLoading;

  // Invalidación cruzada: las acciones de producción cambian lo que muestran
  // inventario (productos en proceso, solicitudes) y el badge del menú. Sin
  // esto, navegar a esas vistas en el mismo navegador muestra datos viejos.
  const reload = () =>
    Promise.all([
      queryClient.invalidateQueries({ queryKey: ["production", variant] }),
      queryClient.invalidateQueries({ queryKey: ["inventory"] }),
      queryClient.invalidateQueries({ queryKey: ["solicitudes"] }),
    ]);

  const [form, setForm] = useState<ProcessForm>(emptyProcessForm);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [isProcessesOpen, setIsProcessesOpen] = useState(false);
  // La misma ventana "Procesos" sirve de picker cuando se abre desde "Elegir
  // proceso" (iniciar etapa): clickear una fila elige en vez de solo abrir
  // el detalle. Desde el menu de mantenimiento se abre en modo gestion
  // normal (false).
  const [processesPickerMode, setProcessesPickerMode] = useState(false);
  const [isUserCreateOpen, setIsUserCreateOpen] = useState(false);
  const [isUsersOpen, setIsUsersOpen] = useState(false);
  const [dataModal, setDataModal] = useState<{ type: "units" | "materials" | "supplies" | "complements" | "productTypes"; mode: "create" | "view" } | null>(null);
  const [returnToProcesses, setReturnToProcesses] = useState(false);
  const [returnToUsers, setReturnToUsers] = useState(false);
  const [userFormMode, setUserFormMode] = useState<UserFormMode>("create");
  const [editingUserId, setEditingUserId] = useState<string | null>(null);
  const [userForm, setUserForm] = useState(emptyUserForm);
  const [formMode, setFormMode] = useState<FormMode>("create");
  const [editingProcessId, setEditingProcessId] = useState<string | null>(null);
  const [viewingProcess, setViewingProcess] = useState<ProductionProcess | null>(null);
  const [viewingUser, setViewingUser] = useState<ManagedUser | null>(null);
  const [generatedCredentials, setGeneratedCredentials] = useState<{
    title: string;
    username: string;
    email: string;
    role: string;
    temporaryPassword: string;
  } | null>(null);
  // Reutilizado por el flujo nuevo (seccion 4) para elegir el proceso del
  // banco al iniciar un intento de etapa -- ya no hay wizard de creacion con
  // proceso+material+insumos de un tiron.
  const [selectedProcessId, setSelectedProcessId] = useState("");
  // Cantidad real del producto resultante, llenada a mano al FINALIZAR la
  // etapa (Rodrigo, 2026-08-20 -- no debe salir pre-llena, el picker de
  // iniciar etapa solo elige el destino, no la cantidad).
  const [runQuantity, setRunQuantity] = useState("");
  const [isRunStagesOpen, setIsRunStagesOpen] = useState(false);
  // Reporte de etapas ya terminadas de la orden (codigo/proceso/responsable/
  // estado/merma) -- ventana aparte, ya no ocupa espacio arriba del acta.
  const [isStageReportOpen, setIsStageReportOpen] = useState(false);
  // Etapa (ya terminada o rechazada) elegida en el reporte para revisar su
  // acta completa -- ver/editar/borrar lineas, aunque ya no este activa
  // (Rodrigo: "no me sale nada para revisar visualmente esa etapa").
  const [viewingAttemptId, setViewingAttemptId] = useState<string | null>(null);
  const [selectedRunForStages, setSelectedRunForStages] = useState<ProductionRun | null>(null);
  const [cancelRun, setCancelRun] = useState<ProductionRun | null>(null);
  const [cancelRunReason, setCancelRunReason] = useState("");
  const [isCancellingRun, setIsCancellingRun] = useState(false);
  // Cancelar TODA la familia (raiz + hijas de split) de una vez -- para cuando
  // un split arranco solo una parte y el resto ya no tiene sentido esperar.
  const [cancelFamilyRuns, setCancelFamilyRuns] = useState<ProductionRun[] | null>(null);
  const [cancelFamilyReason, setCancelFamilyReason] = useState("");
  const [isCancellingFamily, setIsCancellingFamily] = useState(false);
  const [showResponsables, setShowResponsables] = useState(false);
  // Modal "Crear orden" del flujo nuevo: solo pide el nombre libre (seccion 4.1).
  const [isCreateOrderOpen, setIsCreateOrderOpen] = useState(false);
  const [newOrderName, setNewOrderName] = useState("");
  // Orden del flujo nuevo cuyo panel de etapas/acta esta abierto.
  const [dynamicOrderRun, setDynamicOrderRun] = useState<ProductionRun | null>(null);
  const [stageResponsableName, setStageResponsableName] = useState("");
  // Materia prima + cantidad de la etapa que se esta por iniciar: sale
  // directo como linea ENTREGA del acta apenas se crea el intento (Rodrigo:
  // "eso sale directo en el entregados del acta").
  const [isStageMaterialPickerOpen, setIsStageMaterialPickerOpen] = useState(false);
  const [stagePickerPendingItem, setStagePickerPendingItem] = useState<InventoryItem | null>(null);
  const [stagePickerQuantity, setStagePickerQuantity] = useState("");
  const [stageMaterialItem, setStageMaterialItem] = useState<InventoryItem | null>(null);
  const [stageMaterialQuantity, setStageMaterialQuantity] = useState("");
  // El motivo de rechazo solo se pide cuando de verdad se va a rechazar (✘):
  // mientras tanto no hay decision tomada, no tiene sentido mostrarlo.
  const [isRejectingStage, setIsRejectingStage] = useState(false);
  const [stageAttemptRejectReason, setStageAttemptRejectReason] = useState("");
  // Producto único elegido con los pickers (pieza o tipo de catálogo). "create"
  // ahora alimenta "Asignar a producto terminado" del flujo nuevo (disponible
  // en cualquier momento de la orden, seccion 4.3) -- ya no hay wizard.
  const [orderProduct, setOrderProduct] = useState<ProductChoice | null>(null);
  const [editPlanRun, setEditPlanRun] = useState<ProductionRun | null>(null);
  const [editPlanProduct, setEditPlanProduct] = useState<ProductChoice | null>(null);
  // Picker de pieza abierto: "create" = modal Asignar a producto terminado
  // (flujo nuevo), "edit" = modal Editar producto resultante (flujo viejo).
  const [itemPickerFor, setItemPickerFor] = useState<"create" | "edit" | null>(null);
  // Pestaña activa del picker de producto: productos terminados o
  // complementos (la joyeria fabrica sus propios complementos).
  const [assignPickerTab, setAssignPickerTab] = useState<"PRODUCTOS" | "COMPLEMENTOS">("PRODUCTOS");
  // Tick por minuto para el tiempo transcurrido de las ordenes en proceso.
  const [nowTick, setNowTick] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNowTick(Date.now()), 60000);
    return () => clearInterval(timer);
  }, []);
  const [isStatsModalOpen, setIsStatsModalOpen] = useState(false);
  const [selectedStatsRun, setSelectedStatsRun] = useState<ProductionRun | null>(null);
  // Acta de un intento puntual, vista de solo lectura desde el resumen/
  // historial (Rodrigo, 2026-08-20: "deberia poder ver todos los procesos y
  // las actas individuales") -- flujo nuevo, la orden ya esta TERMINADA asi
  // que no hay nada que editar aca.
  const [viewingStatsAttemptId, setViewingStatsAttemptId] = useState<string | null>(null);
  // Acta editable: disponible en cualquier etapa de la orden y tambien
  // despues de recibida (ver ActaView).
  const [actaRun, setActaRun] = useState<ProductionRun | null>(null);
  // Ventana con las demas partes de una orden dividida.
  const [familyRuns, setFamilyRuns] = useState<ProductionRun[] | null>(null);
  const [printingWasteRun, setPrintingWasteRun] = useState<ProductionRun | null>(null);
  useEffect(() => {
    if (!printingWasteRun) return;
    const timer = setTimeout(() => {
      window.print();
      setPrintingWasteRun(null);
    }, 60);
    return () => clearTimeout(timer);
  }, [printingWasteRun]);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [historyMonth, setHistoryMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [selectedHistoryDate, setSelectedHistoryDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [hasInitializedHistory, setHasInitializedHistory] = useState(false);
  const [stageModalIndex, setStageModalIndex] = useState(0);
  const [stageModalKey, setStageModalKey] = useState(0);
  const [stageModalDir, setStageModalDir] = useState<"right" | "left">("right");
  const [confirmDialog, setConfirmDialog] = useState<{
    title: string;
    message: string;
    confirmLabel: string;
    isDanger: boolean;
    onConfirm: () => void;
  } | null>(null);

  function runFinisherName(run: ProductionRun): string {
    const finished = run.stages.filter((s) => s.finished_at && s.finished_by_name);
    if (finished.length === 0) return "—";
    finished.sort((a, b) => a.stage_order - b.stage_order);
    return finished[finished.length - 1].finished_by_name ?? "—";
  }

  useEffect(() => {
    if (!isAuthenticated()) {
      window.location.href = "/login";
    }
  }, []);

  useEffect(() => {
    const queryError = meError ?? bundleError;
    if (queryError) {
      setError(queryError instanceof Error ? queryError.message : "No se pudo cargar produccion.");
    }
  }, [meError, bundleError]);

  useEffect(() => {
    setSelectedRunForStages((current) => (current ? runs.find((run) => run.id === current.id) ?? null : current));
    setSelectedStatsRun((current) => (current ? runs.find((run) => run.id === current.id) ?? null : current));
    setActaRun((current) => (current ? runs.find((run) => run.id === current.id) ?? null : current));
  }, [runs]);


  useEffect(() => {
    if (!error && !success) return;
    const timeout = window.setTimeout(() => {
      setError(null);
      setSuccess(null);
    }, 5000);
    return () => window.clearTimeout(timeout);
  }, [error, success]);

  const isAdmin = currentUser?.role === "admin" || currentUser?.role === "Admin";
  const canCreate = isAdmin || currentUser?.permissions.includes("production.processes.create") === true;
  const canUpdate = isAdmin || currentUser?.permissions.includes("production.processes.update") === true;
  const canDelete = isAdmin || currentUser?.permissions.includes("production.processes.delete") === true;
  const canCancelRun = isAdmin || currentUser?.permissions.includes("production.runs.delete") === true;

  function showConfirm(title: string, message: string, onConfirm: () => void, isDanger = true, confirmLabel = "Confirmar") {
    setConfirmDialog({ title, message, onConfirm, isDanger, confirmLabel });
  }
  const activeProcesses = processes.filter((process) => process.is_active);
  // Proceso elegido para iniciar un intento de etapa (flujo nuevo, seccion 4.2).
  const selectedProcess = processes.find((process) => process.id === selectedProcessId) ?? null;

  const approvedMaterialRuns = runs.filter((run) => run.status === "MATERIALES_APROBADOS");
  const inProgressRuns = runs.filter((run) => run.status === "EN_PROCESO");
  // Ordenes migradas del Excel historico (event_lines no vacio) no son
  // trabajo activo de piso: no deben aparecer en las vistas operativas de
  // Produccion (terminados/recibidos/pendientes), solo existen para su
  // certificado en Documentos.
  // TERMINADA es el estado del flujo nuevo (finish_order) -- sin esto las
  // ordenes dinamicas terminadas nunca aparecian en el historial (Rodrigo,
  // 2026-08-20: "no esta en el historial de produccion").
  const finishedRuns = runs.filter(
    (run) =>
      (run.status === "PENDIENTE_RECEPCION" || run.status === "RECIBIDA" || run.status === "TERMINADA") &&
      (run.event_lines ?? []).length === 0
  );
  // Igual que "En proceso": una orden dividida cuenta una sola vez entre las
  // recientes, con boton para ver las demas partes en ventana.
  const recentFinishedFamilies = Array.from(groupRunFamilies(finishedRuns).entries()).slice(0, 3);
  const receivedRuns = runs
    .filter((run) => run.status === "RECIBIDA" && (run.event_lines ?? []).length === 0)
    .sort((a, b) => (b.received_at ?? "").localeCompare(a.received_at ?? ""));
  const pendingReceptionRuns = runs
    .filter((run) => run.status === "PENDIENTE_RECEPCION" && (run.event_lines ?? []).length === 0)
    .sort((a, b) => (b.finished_at ?? "").localeCompare(a.finished_at ?? ""));
  // Tabla unificada "Procesos": listos para iniciar, en curso y terminados, en ese orden.
  const processRows = [
    ...[...approvedMaterialRuns].sort((a, b) => (b.materials_approved_at ?? "").localeCompare(a.materials_approved_at ?? "")),
    ...[...inProgressRuns].sort((a, b) => (b.started_at ?? "").localeCompare(a.started_at ?? "")),
    ...pendingReceptionRuns,
    ...receivedRuns,
  ];
  // Agrupa "Procesos" por familia: una orden partida se colapsa en la fila de
  // su raiz, con las demas partes desplegables debajo.
  const processFamilies = Array.from(groupRunFamilies(processRows).entries());

  useEffect(() => {
    if (finishedRuns.length === 0 || hasInitializedHistory) {
      return;
    }

    const latestRun = finishedRuns[0];
    const nextDate = (latestRun.finished_at ?? "").slice(0, 10) || new Date().toISOString().slice(0, 10);
    setHistoryMonth(nextDate.slice(0, 7));
    setSelectedHistoryDate(nextDate);
    setHasInitializedHistory(true);
  }, [finishedRuns, hasInitializedHistory]);

  function numericText(value: string | number | null | undefined) {
    if (value === null || value === undefined || value === "") return "0";
    const number = Number(value);
    return Number.isFinite(number) ? number.toLocaleString("es-EC", { maximumFractionDigits: 4 }) : String(value);
  }

  // Porcentajes: 2 decimales, no los 4 de los gramos (16,6667% es ilegible).
  function percentText(value: string | number | null | undefined) {
    if (value === null || value === undefined || value === "") return "0";
    const number = Number(value);
    return Number.isFinite(number) ? number.toLocaleString("es-EC", { maximumFractionDigits: 2 }) : String(value);
  }

  function timeLabel(value: string | null) {
    if (!value) return "Pendiente";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "Pendiente";
    return date.toLocaleString("es-EC", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
  }

  // Tiempo transcurrido desde el inicio: "3 d 4 h", "2 h 15 min" o "45 min".
  function elapsedLabel(startedAt: string | null, now: number) {
    if (!startedAt) return "—";
    const start = new Date(startedAt).getTime();
    if (Number.isNaN(start) || now <= start) return "0 min";
    const minutes = Math.floor((now - start) / 60000);
    const days = Math.floor(minutes / 1440);
    const hours = Math.floor((minutes % 1440) / 60);
    const mins = minutes % 60;
    if (days > 0) return `${days} d ${hours} h`;
    if (hours > 0) return `${hours} h ${mins} min`;
    return `${mins} min`;
  }

  function hourLabel(value: string | null) {
    if (!value) return "Pendiente";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "Pendiente";
    return date.toLocaleTimeString("es-EC", { hour: "2-digit", minute: "2-digit" });
  }

  function runStatusLabel(status: ProductionRun["status"]) {
    const labels: Record<ProductionRun["status"], string> = {
      PENDIENTE_INVENTARIO: "Pendiente de Inventario",
      MATERIALES_APROBADOS: "Lista para iniciar",
      EN_PROCESO: "En proceso",
      PENDIENTE_RECEPCION: "Pendiente de recepción",
      RECIBIDA: "Recibida",
      CANCELADA: "Cancelada",
      ESPERANDO_MATERIAL: "Esperando material",
      TERMINADA: "Terminada",
    };
    return labels[status] ?? status;
  }

  // Fecha contextual por estado: la más relevante para cada etapa del flujo.
  // Cuenta ordenes distintas, no corridas sueltas: una orden partida en
  // varias corridas (mismo folio raiz) cuenta una sola vez.
  function countOrders(list: ProductionRun[]): number {
    return groupRunFamilies(list).size;
  }

  function processRowDate(run: ProductionRun) {
    if (run.status === "MATERIALES_APROBADOS") return timeLabel(run.materials_approved_at);
    if (run.status === "EN_PROCESO") return timeLabel(run.started_at);
    if (run.status === "RECIBIDA") return timeLabel(run.received_at);
    return timeLabel(run.finished_at);
  }

  // Merma solo cuando hay dato registrado; evita "0 g" ruidoso en filas sin merma aun.
  function processRowWaste(run: ProductionRun) {
    if (!run.waste_weight && !run.waste_percent) return "—";
    const parts: string[] = [];
    if (run.waste_weight) parts.push(`${numericText(run.waste_weight)} g`);
    if (run.waste_percent) parts.push(`${percentText(run.waste_percent)}%`);
    return parts.join(" · ");
  }

  // Acciones por fila de "Procesos": reutilizada tanto para la fila raiz
  // como para las partes desplegadas de una orden dividida.
  function processRowActions(run: ProductionRun) {
    return (
      <div style={{ display: "flex", gap: 6, justifyContent: "flex-end" }}>
        {run.status === "EN_PROCESO" ? (
          <button
            className="button buttonPrimary"
            onClick={() => (run.name ? setDynamicOrderRun(run) : openRunStagesModal(run))}
            type="button"
          >
            Gestionar
          </button>
        ) : null}
        {run.status === "PENDIENTE_RECEPCION" || run.status === "RECIBIDA" ? (
          <>
            {run.status === "PENDIENTE_RECEPCION" ? (
              <button aria-label="Corregir pesos" className="iconOnlyButton" onClick={() => openRunStagesModal(run)} title="Corregir pesos" type="button">
                <Pencil aria-hidden="true" size={14} />
              </button>
            ) : null}
            <button aria-label="Visualizar" className="iconOnlyButton" onClick={() => openStatsModal(run)} title="Visualizar" type="button">
              <Eye aria-hidden="true" size={14} />
            </button>
          </>
        ) : null}
      </div>
    );
  }

  function runStatusTone(status: ProductionRun["status"]): "neutral" | "active" | "done" | "danger" | "warning" {
    const tones: Record<ProductionRun["status"], "neutral" | "active" | "done" | "danger" | "warning"> = {
      PENDIENTE_INVENTARIO: "warning",
      MATERIALES_APROBADOS: "active",
      EN_PROCESO: "active",
      PENDIENTE_RECEPCION: "warning",
      RECIBIDA: "done",
      CANCELADA: "danger",
      ESPERANDO_MATERIAL: "warning",
      TERMINADA: "done",
    };
    return tones[status] ?? "neutral";
  }

  // Chip "de <folio raiz>": solo cuando esta corrida es parte de un split
  // (su folio raiz existe y es distinto de su propio folio).
  function rootBadge(run: ProductionRun) {
    if (!run.root_production_code || run.root_production_code === run.production_code) return null;
    return (
      <span className="rootBadgeTag" title={`Parte de la orden ${run.root_production_code}`}>
        de {run.root_production_code}
      </span>
    );
  }

  function buildCalendarDays(monthKey: string) {
    const [yearText, monthText] = monthKey.split("-");
    const year = Number(yearText);
    const month = Number(monthText);

    if (!Number.isFinite(year) || !Number.isFinite(month)) {
      return [];
    }

    const firstDay = new Date(year, month - 1, 1);
    const daysInMonth = new Date(year, month, 0).getDate();
    const leadingDays = (firstDay.getDay() + 6) % 7;
    const totalSlots = Math.ceil((leadingDays + daysInMonth) / 7) * 7;

    return Array.from({ length: totalSlots }, (_, index) => {
      const dayNumber = index - leadingDays + 1;
      const isValid = dayNumber > 0 && dayNumber <= daysInMonth;
      const dayKey = isValid
        ? `${year}-${String(month).padStart(2, "0")}-${String(dayNumber).padStart(2, "0")}`
        : `empty-${index}`;
      return {
        key: dayKey,
        label: isValid ? String(dayNumber) : "",
        isValid,
      };
    });
  }

  function moveHistoryMonth(step: number) {
    if (!historyMonth) return;
    const [yearText, monthText] = historyMonth.split("-");
    const year = Number(yearText);
    const month = Number(monthText);
    if (!Number.isFinite(year) || !Number.isFinite(month)) return;

    const nextDate = new Date(year, month - 1 + step, 1);
    const nextMonth = `${nextDate.getFullYear()}-${String(nextDate.getMonth() + 1).padStart(2, "0")}`;
    const matchingRun = finishedRuns.find((run) => (run.finished_at ?? "").slice(0, 7) === nextMonth);
    const nextDay = matchingRun
      ? (matchingRun.finished_at ?? "").slice(0, 10)
      : `${nextMonth}-01`;
    setHistoryMonth(nextMonth);
    setSelectedHistoryDate(nextDay);
  }

  function monthLabel(monthKey: string) {
    if (!monthKey) return "Historial";
    const date = new Date(`${monthKey}-01T00:00:00`);
    if (Number.isNaN(date.getTime())) return "Historial";
    return date.toLocaleDateString("es-EC", { month: "long", year: "numeric" });
  }

  function getRunProgress(run: ProductionRun): number {
    if (!run.stages.length) return 0;
    const done = run.stages.filter((s) => s.status === "FINALIZADA").length;
    return Math.round((done / run.stages.length) * 100);
  }

  function getElapsedLabel(isoDate: string | null): string {
    if (!isoDate) return "—";
    const diff = Math.floor((Date.now() - new Date(isoDate).getTime()) / 60000);
    if (diff < 60) return `${diff} min`;
    const hours = Math.floor(diff / 60);
    const mins = diff % 60;
    return mins > 0 ? `${hours}h ${mins}min` : `${hours}h`;
  }

  function nextStageInModal(stagesCount: number) {
    setStageModalDir("right");
    setStageModalKey((k) => k + 1);
    setStageModalIndex((i) => (i + 1) % stagesCount);
  }

  function prevStageInModal(stagesCount: number) {
    setStageModalDir("left");
    setStageModalKey((k) => k + 1);
    setStageModalIndex((i) => (i - 1 + stagesCount) % stagesCount);
  }

  function openRunStagesModal(run: ProductionRun) {
    // Cierra la ventana de partes si se abrio desde ahi: al terminar de
    // gestionar y cerrar el resumen, debe volver al panel principal, no
    // quedar la ventana de partes atras.
    setFamilyRuns(null);
    setSelectedRunForStages(run);
    const activeIndex = run.stages.findIndex((s) => s.status !== "FINALIZADA");
    setStageModalIndex(activeIndex >= 0 ? activeIndex : 0);
    setStageModalKey(0);
    setIsRunStagesOpen(true);
  }

  function closeRunStagesModal() {
    setIsRunStagesOpen(false);
    setSelectedRunForStages(null);
    setStageModalIndex(0);
    setStageModalKey(0);
  }

  // Cancelar solo tiene sentido antes de recibir: una vez RECIBIDA la orden ya
  // se convirtio en producto terminado (revertir eso es otro flujo, mas riesgoso).
  function canRunBeCancelled(run: ProductionRun) {
    return run.status !== "RECIBIDA" && run.status !== "CANCELADA";
  }

  function openCancelRunModal(run: ProductionRun) {
    setCancelRunReason("");
    setCancelRun(run);
  }

  async function handleCancelRun(run: ProductionRun, reason: string) {
    setError(null);
    setIsCancellingRun(true);
    try {
      await cancelProductionRun(run.id, reason.trim() || undefined);
      setCancelRun(null);
      setSuccess(`Orden ${run.production_code ?? ""} cancelada. Inventario fue restaurado.`.trim());
      closeRunStagesModal();
      setDynamicOrderRun((current) => (current?.id === run.id ? null : current));
      await reload();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "No se pudo cancelar la orden.");
    } finally {
      setIsCancellingRun(false);
    }
  }

  function openCancelFamilyModal(runs: ProductionRun[]) {
    setCancelFamilyReason("");
    setCancelFamilyRuns(runs);
  }

  async function handleCancelRunFamily(runs: ProductionRun[], reason: string) {
    setError(null);
    setIsCancellingFamily(true);
    try {
      await cancelProductionRunFamily(runs[0].id, reason.trim() || undefined);
      setCancelFamilyRuns(null);
      setFamilyRuns(null);
      closeRunStagesModal();
      const folio = runs[0].root_production_code ?? runs[0].production_code ?? "";
      setSuccess(`Orden ${folio} y sus partes fueron canceladas. Inventario fue restaurado.`.trim());
      await reload();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "No se pudo cancelar la orden.");
    } finally {
      setIsCancellingFamily(false);
    }
  }

  function openStatsModal(run: ProductionRun) {
    // Mismo motivo que openRunStagesModal: no dejar la ventana de partes atras.
    setFamilyRuns(null);
    setSelectedStatsRun(run);
    setShowResponsables(false);
    setIsStatsModalOpen(true);
  }

  function closeStatsModal() {
    setIsStatsModalOpen(false);
    setSelectedStatsRun(null);
    setViewingStatsAttemptId(null);
  }

  function closeActaModal() {
    setActaRun(null);
  }

  const currentHistoryMonth = historyMonth || (new Date().toISOString().slice(0, 7));
  const historyDays = buildCalendarDays(currentHistoryMonth);
  const selectedDateRuns = selectedHistoryDate
    ? finishedRuns.filter((run) => (run.finished_at ?? "").slice(0, 10) === selectedHistoryDate)
    : [];
  // Historial por calendario: 4 procesos por página, la ventana no se estira.
  const historyRunsPager = usePagination(selectedDateRuns, 4, selectedHistoryDate);

  function openCreateForm(returnToProcessesAfter = false) {
    setForm(emptyProcessForm());
    setFormMode("create");
    setEditingProcessId(null);
    setReturnToProcesses(returnToProcessesAfter);
    setIsProcessesOpen(false);
    setError(null);
    setSuccess(null);
    setIsFormOpen(true);
  }

  function openEditForm(process: ProductionProcess) {
    setForm(processToForm(process));
    setFormMode("edit");
    setEditingProcessId(process.id);
    setReturnToProcesses(true);
    setError(null);
    setSuccess(null);
    setIsProcessesOpen(false);
    setIsFormOpen(true);
  }

  function closeProcessForm() {
    setIsFormOpen(false);
    if (returnToProcesses) {
      setIsProcessesOpen(true);
      setReturnToProcesses(false);
    }
  }

  function openCreateUserForm() {
    setUserFormMode("create");
    setEditingUserId(null);
    setReturnToUsers(false);
    setUserForm(emptyUserForm());
    setError(null);
    setSuccess(null);
    setIsUserCreateOpen(true);
  }

  function openEditUserForm(user: ManagedUser) {
    setUserFormMode("edit");
    setEditingUserId(user.id);
    setReturnToUsers(true);
    setUserForm({
      first_name: user.first_name,
      last_name: user.last_name,
      role: user.role,
    });
    setError(null);
    setSuccess(null);
    setIsUsersOpen(false);
    setIsUserCreateOpen(true);
  }

  function closeUserForm() {
    setIsUserCreateOpen(false);
    if (returnToUsers) {
      setIsUsersOpen(true);
      setReturnToUsers(false);
    }
  }

  function buildPayload() {
    const processName = form.name.trim();

    if (!processName) {
      throw new Error("El nombre del proceso es obligatorio.");
    }

    return {
      name: processName,
      description: form.description.trim() || null,
      // Ya no se maneja desde el mantenimiento (Rodrigo, 2026-08-20) --
      // siempre activo; si algun proceso viejo quedo inactivo, guardarlo de
      // nuevo lo reactiva (no hay otra forma de tocarlo sin este checkbox).
      is_active: true,
      quality_control: form.qualityControl,
    };
  }

  async function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSuccess(null);
    setIsSaving(true);
    try {
      const payload = buildPayload();
      if (formMode === "edit" && editingProcessId) {
        await updateProcess(editingProcessId, payload);
        setSuccess("Proceso actualizado correctamente.");
      } else {
        await createProcess(payload);
        setSuccess("Proceso creado correctamente.");
      }
      await reload();
      setIsFormOpen(false);
      if (returnToProcesses) {
        setIsProcessesOpen(true);
        setReturnToProcesses(false);
      }
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "No se pudo guardar el proceso.");
    } finally {
      setIsSaving(false);
    }
  }

  function handleDelete(process: ProductionProcess) {
    showConfirm(
      "Eliminar proceso",
      `¿Deseas eliminar el proceso "${process.name}"? Esta acción no se puede deshacer.`,
      async () => {
        setError(null);
        setSuccess(null);
        try {
          await deleteProcess(process.id);
          setSuccess("Proceso eliminado.");
          await reload();
        } catch (nextError) {
          setError(nextError instanceof Error ? nextError.message : "No se pudo eliminar el proceso.");
        }
      },
      true,
      "Eliminar"
    );
  }

  // Convierte el producto elegido al shape que espera el backend: solo se
  // manda la clave del identificador realmente elegido (nunca ambas, nunca
  // undefined) para no pisar la regla del backend de una sola referencia por fila.
  function productRowToTarget(product: ProductChoice) {
    const payload: { product_type_id?: string; target_item_id?: string } = {};
    if (product.targetItemId) payload.target_item_id = product.targetItemId;
    else if (product.productTypeId) payload.product_type_id = product.productTypeId;
    return payload;
  }

  // --- Flujo dinamico de produccion (docs/cambios-sistema-produccion.md seccion 4) ---

  async function handleCreateOrder() {
    const name = newOrderName.trim();
    if (!name) {
      setError("Escribe el nombre de la orden.");
      return;
    }
    setError(null);
    setSuccess(null);
    setIsSaving(true);
    try {
      const created = await createProductionOrder(name);
      setSuccess("Orden creada.");
      setIsCreateOrderOpen(false);
      setNewOrderName("");
      await reload();
      setDynamicOrderRun(created);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "No se pudo crear la orden.");
    } finally {
      setIsSaving(false);
    }
  }

  function closeStageMaterialPicker() {
    setIsStageMaterialPickerOpen(false);
    setStagePickerPendingItem(null);
    setStagePickerQuantity("");
  }

  function confirmStageMaterial() {
    if (!stagePickerPendingItem || !stagePickerQuantity || Number(stagePickerQuantity) <= 0) return;
    setStageMaterialItem(stagePickerPendingItem);
    setStageMaterialQuantity(stagePickerQuantity);
    closeStageMaterialPicker();
  }

  async function handleStartStageAttempt() {
    if (!dynamicOrderRun) return;
    if (!selectedProcessId) {
      setError("Elige el proceso para esta etapa.");
      return;
    }
    if (!stageResponsableName.trim()) {
      setError("Escribe el nombre del responsable.");
      return;
    }
    if (!stageMaterialItem || !stageMaterialQuantity || Number(stageMaterialQuantity) <= 0) {
      setError("Elige la materia prima de esta etapa.");
      return;
    }
    if (!orderProduct || (!orderProduct.targetItemId && !orderProduct.productTypeId)) {
      setError("Elige el producto resultante de esta etapa.");
      return;
    }
    setError(null);
    setSuccess(null);
    setIsSaving(true);
    try {
      // El backend valida stock disponible y hace split automatico si no
      // alcanza (ver start_stage_attempt) -- ya no se fuerza el movimiento a
      // mano con addAdminActaLine.
      const materials = [{ item_id: stageMaterialItem.id, quantity: stageMaterialQuantity }];
      const started = await startStageAttempt(dynamicOrderRun.id, {
        process_id: selectedProcessId,
        responsable_name: stageResponsableName.trim(),
        materials,
        product: productRowToTarget(orderProduct),
      });
      setDynamicOrderRun(started);
      setSelectedProcessId("");
      setStageResponsableName("");
      setStageMaterialItem(null);
      setStageMaterialQuantity("");
      setOrderProduct(null);
      await reload();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "No se pudo iniciar la etapa.");
    } finally {
      setIsSaving(false);
    }
  }

  async function handleAllocateStageAttemptMaterial(attemptId: string) {
    if (!dynamicOrderRun) return;
    setError(null);
    setSuccess(null);
    setIsSaving(true);
    try {
      const updated = await allocateStageAttemptMaterial(attemptId);
      setDynamicOrderRun(updated);
      setSuccess("Material asignado.");
      await reload();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "No se pudo asignar el material.");
    } finally {
      setIsSaving(false);
    }
  }

  async function handleFinishOrder() {
    if (!dynamicOrderRun) return;
    setError(null);
    setSuccess(null);
    setIsSaving(true);
    try {
      const updated = await finishOrder(dynamicOrderRun.id);
      // Mismo comportamiento que el flujo viejo (Rodrigo, 2026-08-20: "se
      // abria sola al terminar y se quedaba en el visualizar del
      // historial") -- cierra el panel en vivo y abre el reporte de merma.
      setDynamicOrderRun(null);
      openStatsModal(updated);
      setSuccess("Orden finalizada.");
      await reload();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "No se pudo finalizar la orden.");
    } finally {
      setIsSaving(false);
    }
  }

  async function handleRevertStageAttempt(attemptId: string) {
    if (!dynamicOrderRun) return;
    setError(null);
    setSuccess(null);
    setIsSaving(true);
    try {
      const updated = await revertStageAttempt(attemptId);
      setDynamicOrderRun(updated);
      setViewingAttemptId(null);
      setSuccess("Etapa revertida y eliminada.");
      await reload();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "No se pudo revertir la etapa.");
    } finally {
      setIsSaving(false);
    }
  }

  async function handleFinishStageAttempt(attemptId: string, decision: "APROBADA" | "RECHAZADA") {
    if (!runQuantity || Number(runQuantity) <= 0) {
      setError("Ingresa la cantidad real del producto resultante.");
      return;
    }
    setError(null);
    setSuccess(null);
    setIsSaving(true);
    try {
      const updated = await finishStageAttempt(attemptId, {
        product_quantity: runQuantity,
        decision,
        rejection_reason: decision === "RECHAZADA" ? stageAttemptRejectReason.trim() || null : null,
      });
      setDynamicOrderRun(updated);
      setRunQuantity("");
      setStageAttemptRejectReason("");
      setIsRejectingStage(false);
      setSuccess(decision === "APROBADA" ? "Etapa aprobada." : "Etapa rechazada.");
      await reload();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "No se pudo terminar la etapa.");
    } finally {
      setIsSaving(false);
    }
  }

  async function handleSaveUser(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(null);
    setSuccess(null);

    const firstName = userForm.first_name.trim();
    const lastName = userForm.last_name.trim();
    if (!firstName || !lastName) {
      setError("Nombre y apellido son obligatorios.");
      return;
    }

    try {
      if (userFormMode === "edit" && editingUserId) {
        await updateUser(editingUserId, {
          first_name: firstName,
          last_name: lastName,
          role: userForm.role,
        });
        setSuccess("Usuario actualizado correctamente.");
      } else {
        const response = await createUser({
          first_name: firstName,
          last_name: lastName,
          role: userForm.role,
        });
        setGeneratedCredentials({
          title: "Usuario creado",
          username: response.user.username,
          email: response.user.email,
          role: response.user.role,
          temporaryPassword: response.temporary_password,
        });
        setSuccess("Usuario creado correctamente.");
      }
      await reload();
      setIsUserCreateOpen(false);
      if (userFormMode === "edit" && returnToUsers) {
        setIsUsersOpen(true);
        setReturnToUsers(false);
      }
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "No se pudo guardar el usuario.");
    }
  }

  function handleDeleteUser(user: ManagedUser) {
    if (user.id === currentUser?.id) {
      setError("No puedes eliminar tu propia sesion.");
      return;
    }
    showConfirm(
      "Eliminar usuario",
      `¿Deseas eliminar al usuario "${user.first_name} ${user.last_name}"? Esta acción no se puede deshacer.`,
      async () => {
        setError(null);
        setSuccess(null);
        try {
          await deleteUser(user.id);
          setSuccess("Usuario eliminado.");
          await reload();
        } catch (nextError) {
          setError(nextError instanceof Error ? nextError.message : "No se pudo eliminar el usuario.");
        }
      },
      true,
      "Eliminar"
    );
  }

  async function handleDeactivateUser(user: ManagedUser) {
    if (user.id === currentUser?.id) {
      setError("No puedes desactivar tu propia sesion.");
      return;
    }

    setError(null);
    setSuccess(null);
    try {
      const updatedUser = await deactivateUser(user.id);
      setViewingUser((current) => (current?.id === updatedUser.id ? updatedUser : current));
      setSuccess("Usuario desactivado.");
      await reload();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "No se pudo desactivar el usuario.");
    }
  }

  async function handleActivateUser(user: ManagedUser) {
    setError(null);
    setSuccess(null);
    try {
      const updatedUser = await activateUser(user.id);
      setViewingUser((current) => (current?.id === updatedUser.id ? updatedUser : current));
      setSuccess("Usuario activado.");
      await reload();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "No se pudo activar el usuario.");
    }
  }

  async function handleResetPassword(user: ManagedUser) {
    setError(null);
    setSuccess(null);
    try {
      const response = await resetUserPassword(user.id);
      setViewingUser((current) => (current?.id === response.user.id ? response.user : current));
      setGeneratedCredentials({
        title: "Contrasena restablecida",
        username: response.user.username,
        email: response.user.email,
        role: response.user.role,
        temporaryPassword: response.temporary_password,
      });
      setSuccess("Contrasena restablecida correctamente.");
      await reload();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "No se pudo restablecer la contrasena.");
    }
  }

  // Aplica la selección de un picker (pieza o tipo) al producto único de la
  // modal correspondiente ("create" = producto resultante obligatorio al
  // iniciar una etapa, "edit" = Editar producto resultante del flujo viejo).
  function applyProductChoice(kind: "create" | "edit", patch: ProductChoice) {
    if (kind === "create") {
      setOrderProduct(patch);
    } else {
      setEditPlanProduct(patch);
    }
  }

  // Ids de tipos permitidos para el CatalogProductPicker según modal. El
  // flujo nuevo ya no restringe por proceso (el banco de procesos no declara
  // que tipos produce cada paso) -- sin restriccion, permite elegir cualquiera.
  function allowedTypeIdsForPicker(kind: "create" | "edit"): string[] {
    return kind === "create" ? [] : editPlanRun?.allowed_product_type_ids ?? [];
  }

  // Contadores animados de la barra de metricas de produccion.
  const waitingMaterialCount = useCountUp(
    runs.reduce(
      (total, run) => total + (run.stage_attempts ?? []).filter((a) => a.status === "PENDIENTE_MATERIAL").length,
      0,
    ),
  );
  const inProgressCount = useCountUp(countOrders(inProgressRuns));
  const finishedCount = useCountUp(countOrders(finishedRuns));

  return (
    <div className="content">
      {error || success ? (
        <div className="toastStack" aria-live="polite" aria-atomic="true">
          {error ? <ToastNotice key={error} kind="error" message={error} onClose={() => setError(null)} progress /> : null}
          {success ? <ToastNotice key={success} kind="success" message={success} onClose={() => setSuccess(null)} progress /> : null}
        </div>
      ) : null}

      {variant === "maintenance" ? (
        <>
          <section className="maintenanceSection" aria-label="Mantenimientos de produccion">
            <h2>Procesos</h2>
            <div className="maintenanceGrid">
              <button className="maintenanceTile" disabled={currentUser !== null && !canCreate} onClick={() => openCreateForm()} type="button">
                <Factory aria-hidden="true" size={22} />
                <strong>Crear proceso</strong>
                <span>Nombre del proceso y etapas configurables.</span>
              </button>
              <button
                className="maintenanceTile"
                onClick={() => {
                  setProcessesPickerMode(false);
                  setIsProcessesOpen(true);
                }}
                type="button"
              >
                <Eye aria-hidden="true" size={22} />
                <strong>Procesos</strong>
                <span>{processes.length} procesos creados.</span>
              </button>
            </div>
          </section>

          <section className="maintenanceSection" aria-label="Mantenimientos de usuarios">
            <h2>Usuarios</h2>
            <div className="maintenanceGrid">
              <button className="maintenanceTile" onClick={openCreateUserForm} type="button">
                <UserPlus aria-hidden="true" size={22} />
                <strong>Crear usuario</strong>
                <span>Registro de usuarios del sistema.</span>
              </button>
              <button className="maintenanceTile" onClick={() => setIsUsersOpen(true)} type="button">
                <Users aria-hidden="true" size={22} />
                <strong>Usuarios</strong>
                <span>{users.length} usuarios creados.</span>
              </button>
            </div>
          </section>

          <section className="maintenanceSection" aria-label="Unidades de medida">
            <h2>Unidades de medida</h2>
            <div className="maintenanceGrid">
              <button className="maintenanceTile" onClick={() => setDataModal({ type: "units", mode: "create" })} type="button">
                <Plus aria-hidden="true" size={22} />
                <strong>Crear unidad</strong>
                <span>Nueva unidad de medida.</span>
              </button>
              <button className="maintenanceTile" onClick={() => setDataModal({ type: "units", mode: "view" })} type="button">
                <Ruler aria-hidden="true" size={22} />
                <strong>Unidades de medida</strong>
                <span>{unitsList.length} unidades creadas.</span>
              </button>
            </div>
          </section>

          <section className="maintenanceSection" aria-label="Materias primas">
            <h2>Materias primas</h2>
            <div className="maintenanceGrid">
              <button className="maintenanceTile" onClick={() => setDataModal({ type: "materials", mode: "create" })} type="button">
                <Plus aria-hidden="true" size={22} />
                <strong>Crear materia prima</strong>
                <span>Nueva materia prima.</span>
              </button>
              <button className="maintenanceTile" onClick={() => setDataModal({ type: "materials", mode: "view" })} type="button">
                <Boxes aria-hidden="true" size={22} />
                <strong>Materias primas</strong>
                <span>{rawMaterialsList.length} materias primas creadas.</span>
              </button>
            </div>
          </section>

          <section className="maintenanceSection" aria-label="Insumos">
            <h2>Insumos</h2>
            <div className="maintenanceGrid">
              <button className="maintenanceTile" onClick={() => setDataModal({ type: "supplies", mode: "create" })} type="button">
                <Plus aria-hidden="true" size={22} />
                <strong>Crear insumo</strong>
                <span>Nuevo quimico o material auxiliar.</span>
              </button>
              <button className="maintenanceTile" onClick={() => setDataModal({ type: "supplies", mode: "view" })} type="button">
                <FlaskConical aria-hidden="true" size={22} />
                <strong>Insumos</strong>
                <span>{suppliesList.length} insumos creados.</span>
              </button>
            </div>
          </section>

          <section className="maintenanceSection" aria-label="Complementos">
            <h2>Complementos</h2>
            <div className="maintenanceGrid">
              <button className="maintenanceTile" onClick={() => setDataModal({ type: "complements", mode: "create" })} type="button">
                <Plus aria-hidden="true" size={22} />
                <strong>Crear complemento</strong>
                <span>Broches, cadenas base y piezas para ensamblar.</span>
              </button>
              <button className="maintenanceTile" onClick={() => setDataModal({ type: "complements", mode: "view" })} type="button">
                <Puzzle aria-hidden="true" size={22} />
                <strong>Complementos</strong>
                <span>{complementsList.length} complementos creados.</span>
              </button>
            </div>
          </section>

          <section className="maintenanceSection" aria-label="Productos terminados">
            <h2>Productos terminados</h2>
            <div className="maintenanceGrid">
              <button className="maintenanceTile" onClick={() => setDataModal({ type: "productTypes", mode: "create" })} type="button">
                <Plus aria-hidden="true" size={22} />
                <strong>Crear tipo de producto</strong>
                <span>Tipo, categoría y materia prima.</span>
              </button>
              <button className="maintenanceTile" onClick={() => setDataModal({ type: "productTypes", mode: "view" })} type="button">
                <FileText aria-hidden="true" size={22} />
                <strong>Tipos de producto</strong>
                <span>{productTypesList.length} tipos de producto creados.</span>
              </button>
            </div>
          </section>

        </>
      ) : (
        <>
          {/* Stats bar */}
          <section className="productionStatsRow" aria-label="Metricas de produccion">
            {waitingMaterialCount > 0 ? (
              <div className="productionStatCard">
                <Hourglass aria-hidden="true" size={20} />
                <strong>{waitingMaterialCount}</strong>
                <span>Etapas esperando material</span>
              </div>
            ) : null}
            <div className="productionStatCard">
              <Play aria-hidden="true" size={20} />
              <strong>{inProgressCount}</strong>
              <span>En proceso</span>
            </div>
            <div className="productionStatCard">
              <CheckCheck aria-hidden="true" size={20} />
              <strong>{finishedCount}</strong>
              <span>Finalizadas</span>
            </div>
          </section>

          {/* Main grid: create order + carousel */}
          <section className="productionMainGrid" aria-label="Operacion de produccion">
            {/* Create order */}
            <article className="card panelBody productionCreatePanel">
              <div className="panelHeader">
                <div>
                  <h2 className="panelTitle">Nueva orden</h2>
                  <p className="panelText">Selecciona proceso y cantidad a fabricar</p>
                </div>
                <Play aria-hidden="true" size={20} />
              </div>
              <button className="button buttonPrimary" onClick={() => setIsCreateOrderOpen(true)} type="button">
                <Plus aria-hidden="true" size={16} />
                Crear orden
              </button>
            </article>

            {/* In-progress horizontal scroll */}
            <article className="card panelBody">
              <div className="panelHeader">
                <div>
                  <h2 className="panelTitle">En proceso</h2>
                  <p className="panelText">{countOrders(inProgressRuns)} {countOrders(inProgressRuns) === 1 ? "orden activa" : "ordenes activas"}</p>
                </div>
              </div>
              {inProgressRuns.length > 0 ? (
                <div className="productionRunsVertical">
                  {Array.from(groupRunFamilies(inProgressRuns).entries()).map(([key, family]) => {
                    const root = family.find((r) => !r.parent_run_id) ?? family[0];
                    const otherParts = family.filter((r) => r.id !== root.id);
                    const isSplit = otherParts.length > 0;
                    // Orden del flujo nuevo: siempre tiene `name`, aun antes de
                    // iniciar su primera etapa -- stage_attempts vacio no sirve
                    // como discriminador (bug reportado: "Gestionar" abria el
                    // modal viejo con 0/0 etapas).
                    const isDynamic = Boolean(root.name);
                    const primaryAction = () =>
                      isDynamic ? setDynamicOrderRun(root) : isSplit ? setFamilyRuns(family) : openRunStagesModal(root);
                    const runningAttempt = isDynamic ? (root.stage_attempts ?? []).find((a) => a.status === "EN_PROCESO") ?? null : null;
                    const lastAttempt = isDynamic
                      ? [...(root.stage_attempts ?? [])].sort((a, b) => b.sequence_order - a.sequence_order)[0] ?? null
                      : null;
                    const approvedCount = isDynamic ? (root.stage_attempts ?? []).filter((a) => a.status === "APROBADA").length : 0;
                    const currentStage = root.stages.find((s) => s.status === "EN_PROCESO") ?? root.stages.find((s) => s.status === "PENDIENTE") ?? null;
                    const doneCount = root.stages.filter((s) => s.status === "FINALIZADA").length;
                    const totalQuantity = isSplit
                      ? family.reduce((total, part) => total + Number(part.quantity), 0)
                      : Number(root.quantity);
                    return (
                      <div className="productionRunListRow" key={key} {...openableProps(primaryAction, `${isSplit ? "Ver partes de" : "Gestionar"} orden ${root.name ?? root.process_name}`)}>
                        {/* Title row: name + code left, timing + button right */}
                        <div className="productionRunListRowHead">
                          <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0, overflow: "hidden" }}>
                            {root.production_code ? (
                              <span style={{ fontFamily: "monospace", fontSize: 10, color: "var(--primary-strong)", fontWeight: 700, background: "#f3e9d6", borderRadius: 4, padding: "1px 5px", flexShrink: 0 }}>{root.production_code}</span>
                            ) : null}
                            {isSplit ? (
                              <button className="rootBadgeTag" onClick={(event) => { event.stopPropagation(); setFamilyRuns(family); }} style={{ cursor: "pointer", border: "none" }} type="button">
                                +{otherParts.length} partes
                              </button>
                            ) : (
                              rootBadge(root)
                            )}
                            <strong style={{ fontSize: 13, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{isDynamic ? root.name : root.process_name}</strong>
                          </div>
                          <div style={{ display: "flex", alignItems: "center", gap: 5, flexShrink: 0 }} onClick={stopClick}>
                            <button className="button buttonPrimary runInlineBtn" onClick={primaryAction} type="button">
                              {isSplit ? "Ver partes" : "Gestionar"}
                            </button>
                          </div>
                        </div>
                        {isDynamic ? (
                          <>
                            {/* Meta: etapa activa (o la ultima) + creada */}
                            <div className="productionRunListRowMeta">
                              {runningAttempt ? (
                                <span>{runningAttempt.process_name} · en curso</span>
                              ) : lastAttempt ? (
                                <span>{lastAttempt.process_name} · {lastAttempt.status === "APROBADA" ? "aprobada" : "rechazada"}</span>
                              ) : (
                                <span>Sin etapa iniciada</span>
                              )}
                              <span aria-hidden="true">·</span>
                              <span>Creada {hourLabel(root.requested_at)}</span>
                            </div>
                            <div className="productionRunListRowMeta">
                              <span>{approvedCount} {approvedCount === 1 ? "etapa aprobada" : "etapas aprobadas"}</span>
                              <span aria-hidden="true">·</span>
                              <span>Tiempo en proceso: {elapsedLabel(root.requested_at, nowTick)}</span>
                            </div>
                          </>
                        ) : (
                          <>
                            {/* Meta: current stage + qty + started */}
                            <div className="productionRunListRowMeta">
                              {currentStage ? <span>{currentStage.stage_order}. {currentStage.stage_name}</span> : null}
                              {currentStage ? <span aria-hidden="true">·</span> : null}
                              <span>{numericText(totalQuantity)} {root.raw_material_unit_code}</span>
                              {isSplit ? null : (
                                <>
                                  <span aria-hidden="true">·</span>
                                  <span>Inició {hourLabel(root.started_at)}</span>
                                </>
                              )}
                            </div>
                            {/* Progress: caliper scale for stage advance */}
                            <CaliperScale
                              ariaLabel="Avance de la orden"
                              label={`${doneCount}/${root.stages.length}`}
                              max={root.stages.length}
                              ticks={root.stages.length}
                              value={doneCount}
                            />
                            {/* Tiempo transcurrido desde el inicio de la orden. */}
                            <div className="productionRunListRowMeta">
                              <span>Tiempo en proceso: {elapsedLabel(root.started_at, nowTick)}</span>
                            </div>
                          </>
                        )}
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="emptyState">No hay procesos en transcurso.</div>
              )}
            </article>
          </section>

          {/* Procesos: listos para iniciar, en curso y terminados, en un solo lugar. */}
          <section className="card panelBody" aria-label="Procesos">
            <div className="panelHeader">
              <div>
                <h2 className="panelTitle">Procesos</h2>
                <p className="panelText">Ordenes listas para iniciar, en curso y terminadas</p>
              </div>
            </div>
            {processRows.length > 0 ? (
              <div className="tableWrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>Proceso</th>
                      <th className="num">Cantidad</th>
                      <th className="num">Peso actual</th>
                      <th>Etapa actual</th>
                      <th>Estado</th>
                      <th>Fecha</th>
                      <th className="num">Merma</th>
                      <th aria-label="Acciones" />
                    </tr>
                  </thead>
                  <tbody>
                    {processFamilies.map(([key, family]) => {
                      const root = family.find((r) => !r.parent_run_id) ?? family[0];
                      const otherParts = family.filter((r) => r.id !== root.id);
                      // Orden del flujo nuevo: siempre tiene `name` (seccion 4.1), aun
                      // antes de iniciar su primera etapa (stage_attempts todavia vacio
                      // en ese momento -- no sirve como discriminador).
                      const isDynamic = Boolean(root.name);
                      const rootStage = runCurrentStage(root);
                      const lastAttempt = isDynamic
                        ? [...(root.stage_attempts ?? [])].sort((a, b) => b.sequence_order - a.sequence_order)[0]
                        : null;
                      const rowClick = isDynamic
                        ? () => setDynamicOrderRun(root)
                        : otherParts.length > 0
                          ? () => setFamilyRuns(family)
                          : undefined;
                      return (
                        <tr key={key} onClick={rowClick} style={rowClick ? { cursor: "pointer" } : undefined}>
                          <td>
                            {root.production_code ? <span className="orderCodeTag">{root.production_code}</span> : "—"}
                            {otherParts.length > 0 ? (
                              <span className="rootBadgeTag">+{otherParts.length} partes</span>
                            ) : (
                              rootBadge(root)
                            )}
                          </td>
                          <td>{isDynamic ? (root.name ?? root.production_code) : root.process_name}</td>
                          <td className="num">{isDynamic ? "—" : `${numericText(root.quantity)} ${root.raw_material_unit_code}`}</td>
                          <td className="num">{isDynamic ? "—" : `${numericText(runCurrentWeight(root))} ${root.raw_material_unit_code}`}</td>
                          <td>
                            {isDynamic
                              ? lastAttempt
                                ? `${lastAttempt.process_name} (${lastAttempt.attempt_no_for_process})`
                                : "Sin etapas todavia"
                              : rootStage
                                ? `${rootStage.stage_order}. ${rootStage.stage_name}`
                                : "—"}
                          </td>
                          <td><StatusPunch label={runStatusLabel(root.status)} tone={runStatusTone(root.status)} /></td>
                          <td>{processRowDate(root)}</td>
                          <td className="num">{processRowWaste(root)}</td>
                          <td onClick={stopClick}>{isDynamic ? null : processRowActions(root)}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="emptyState">No hay procesos.</div>
            )}
          </section>

          {/* History */}
          <section className="card panelBody productionMovementsPanel" aria-label="Movimientos de produccion">
            <div className="panelHeader">
              <div>
                <h2 className="panelTitle">Movimientos</h2>
                <p className="panelText">Movimientos de los ultimos 30 dias</p>
              </div>
              <button
                aria-label="Abrir historial por calendario"
                className="iconTextButton"
                disabled={finishedRuns.length === 0}
                onClick={() => setIsHistoryOpen(true)}
                title="Historial por calendario"
                type="button"
              >
                <CalendarDays aria-hidden="true" size={16} />
                Historial
              </button>
            </div>
            {recentFinishedFamilies.length > 0 ? (
              <div className="readyToStartList">
                {recentFinishedFamilies.map(([key, family]) => {
                  const root = family.find((r) => !r.parent_run_id) ?? family[0];
                  const otherParts = family.filter((r) => r.id !== root.id);
                  const isSplit = otherParts.length > 0;
                  const primaryAction = () => (isSplit ? setFamilyRuns(family) : openStatsModal(root));
                  // Flujo nuevo: process_name/quantity/waste_percent son de
                  // nivel de orden y no existen (viven por etapa, en
                  // stage_attempts) -- root.name es el titulo y la merma se
                  // suma de cada intento (Rodrigo, 2026-08-20).
                  const rootLabel = root.process_name ?? root.name ?? "—";
                  const rootIsDynamic = Boolean(root.name);
                  const rootWaste = rootIsDynamic
                    ? (root.stage_attempts ?? []).reduce((sum, a) => sum + Number(a.merma_weight ?? 0), 0)
                    : Number(root.waste_weight ?? 0);
                  const rootUnit = root.raw_material_unit_code ?? root.stage_attempts?.[0]?.unit_code ?? "g";
                  return (
                    <div className="readyToStartRow" key={key} {...openableProps(primaryAction, `${isSplit ? "Ver partes de" : "Ver resumen de"} ${rootLabel}`)}>
                      <div className="readyToStartInfo">
                        <strong>
                          {root.production_code ? <span className="orderCodeTag">{root.production_code}</span> : null}
                          {isSplit ? (
                            <button className="rootBadgeTag" onClick={(event) => { event.stopPropagation(); setFamilyRuns(family); }} style={{ cursor: "pointer", border: "none" }} type="button">
                              +{otherParts.length} partes
                            </button>
                          ) : (
                            rootBadge(root)
                          )}
                          {rootLabel}
                        </strong>
                        <span>
                          {rootIsDynamic
                            ? `Merma: ${numericText(rootWaste)} ${rootUnit}`
                            : `${numericText(root.quantity)} ${root.raw_material_unit_code} · Merma: ${percentText(root.waste_percent)}%`}
                          {" "}· Finalizado: {timeLabel(root.finished_at)} · Finalizó: {runFinisherName(root)}
                        </span>
                      </div>
                      <div style={{ display: "flex", gap: 6, flexShrink: 0 }} onClick={stopClick}>
                        {isSplit ? (
                          <button className="iconTextButton" onClick={() => setFamilyRuns(family)} type="button">
                            <Eye aria-hidden="true" size={14} />
                            Ver partes
                          </button>
                        ) : (
                          <>
                            {root.status === "PENDIENTE_RECEPCION" ? (
                              <button aria-label="Corregir pesos" className="iconOnlyButton" onClick={() => openRunStagesModal(root)} title="Corregir pesos" type="button">
                                <Pencil aria-hidden="true" size={14} />
                              </button>
                            ) : null}
                            <button aria-label="Visualizar" className="iconOnlyButton" onClick={() => openStatsModal(root)} title="Visualizar" type="button">
                              <Eye aria-hidden="true" size={14} />
                            </button>
                          </>
                        )}
                      </div>
                    </div>
                  );
                })}
              </div>
            ) : (
              <div className="emptyState">No hay historial disponible.</div>
            )}
          </section>

        </>
      )}

      {/* Crear orden (flujo nuevo, seccion 4.1): solo el nombre libre. El
          proceso/etapa se eligen despues, uno a la vez, desde el panel de la
          orden recien creada. */}
      {isCreateOrderOpen ? (
        <div className="modalBackdrop" role="dialog" aria-modal="true" aria-label="Crear orden">
          <form
            className="modalWindow"
            onSubmit={(event) => {
              event.preventDefault();
              void handleCreateOrder();
            }}
          >
            <div className="modalHeader">
              <div>
                <h2>Crear orden</h2>
              </div>
              <button aria-label="Cerrar" className="iconOnlyButton" onClick={() => setIsCreateOrderOpen(false)} type="button">
                <X aria-hidden="true" size={18} />
              </button>
            </div>
            <label className="fieldGroup">
              <span>Nombre de la orden</span>
              <input
                autoFocus
                className="field"
                disabled={isSaving}
                maxLength={255}
                onChange={(event) => setNewOrderName(event.target.value)}
                value={newOrderName}
              />
            </label>
            <div className="modalActions">
              <button className="button buttonPrimary" disabled={isSaving} type="submit">
                <Save aria-hidden="true" size={17} />
                {isSaving ? "Creando" : "Crear orden"}
              </button>
            </div>
          </form>
        </div>
      ) : null}

      {/* Panel de la orden del flujo nuevo: etapas anteriores, etapa activa
          (acta directa + finalizar, con Aprobado/Denegado solo si el
          proceso tiene control de calidad), y el formulario de elegir
          proceso + producto resultante obligatorio (seccion 4). */}
      {dynamicOrderRun ? (() => {
        const runningAttempt = (dynamicOrderRun.stage_attempts ?? []).find((a) => a.status === "EN_PROCESO") ?? null;
        const waitingMaterialAttempts = (dynamicOrderRun.stage_attempts ?? []).filter(
          (a) => a.status === "PENDIENTE_MATERIAL",
        );
        const pastAttempts = (dynamicOrderRun.stage_attempts ?? [])
          .filter((a) => a.id !== runningAttempt?.id && a.status !== "PENDIENTE_MATERIAL")
          .sort((a, b) => a.sequence_order - b.sequence_order);
        const isTerminada = dynamicOrderRun.status === "TERMINADA" || dynamicOrderRun.status === "CANCELADA";
        return (
          <>
          <div className="modalBackdrop" role="dialog" aria-modal="true" aria-label="Orden">
            <section className="modalWindow processViewWindow">
              <div className="modalHeader">
                <div>
                  <h2>{dynamicOrderRun.name ?? dynamicOrderRun.production_code}</h2>
                  <p>{dynamicOrderRun.production_code} · <StatusPunch label={runStatusLabel(dynamicOrderRun.status)} tone={runStatusTone(dynamicOrderRun.status)} /></p>
                </div>
                <div style={{ display: "flex", gap: 6 }}>
                  {pastAttempts.length > 0 ? (
                    <button
                      aria-label="Ver reporte de etapas"
                      className="iconOnlyButton"
                      onClick={() => setIsStageReportOpen(true)}
                      type="button"
                    >
                      <FileText aria-hidden="true" size={18} />
                    </button>
                  ) : null}
                  <button
                    aria-label="Cerrar"
                    className="iconOnlyButton"
                    onClick={() => {
                      setDynamicOrderRun(null);
                      setIsStageReportOpen(false);
                      setViewingAttemptId(null);
                    }}
                    type="button"
                  >
                    <X aria-hidden="true" size={18} />
                  </button>
                </div>
              </div>

              {waitingMaterialAttempts.length > 0 ? (
                <div style={{ display: "grid", gap: 10, marginTop: 12 }}>
                  {waitingMaterialAttempts.map((attempt) => (
                    <div className="solicitudCard" key={attempt.id}>
                      <div className="solicitudCardHead">
                        <div style={{ flex: 1, minWidth: 0 }}>
                          <strong>
                            {attempt.code ? <span className="orderCodeTag">{attempt.code}</span> : null}
                            {attempt.process_name} · Falta material
                          </strong>
                          <span style={{ display: "block", color: "var(--muted)", fontSize: 13 }}>
                            {attempt.materials
                              .filter((m) => Number(m.quantity_pending) > 0)
                              .map((m) => `${m.name ?? m.item_id}: faltan ${numericText(m.quantity_pending)} ${m.unit_code}`)
                              .join(" · ")}
                          </span>
                        </div>
                        <button
                          className="button buttonPrimary"
                          disabled={isSaving}
                          onClick={() => void handleAllocateStageAttemptMaterial(attempt.id)}
                          style={{ flexShrink: 0 }}
                          type="button"
                        >
                          Asignar material disponible
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : null}

              {runningAttempt ? (() => {
                const orderId = dynamicOrderRun.id;
                // isSaving prendido durante el refresh (Rodrigo, 2026-08-20:
                // "cuando agrego el valor no se adjunta a la sumatoria antes
                // de poner finalizar etapa") -- Agregar/Recibir disparaban el
                // refresco sin esperarlo, asi que se podia tocar Finalizar
                // etapa con la suma todavia vieja. isSaving ya deshabilita
                // ese boton, asi que prenderlo aca lo bloquea hasta que la
                // orden este de verdad al dia.
                async function refreshDynamicOrder() {
                  setIsSaving(true);
                  try {
                    await reload();
                    const fresh = (await listProductionRuns()).find((r) => r.id === orderId);
                    if (fresh) setDynamicOrderRun(fresh);
                  } finally {
                    setIsSaving(false);
                  }
                }
                const materialItems = [...rawMaterials, ...orderSupplyItems, ...complementItems, ...wasteItems, ...finishedItems];
                const runningModel = buildOrdenProduccion([dynamicOrderRun], runningAttempt.id);
                const entregaLines = runningModel.entregaLines;
                const recepcionLines = runningModel.recepcionLines;
                return (
                  <section className="card panelBody" style={{ marginTop: 12 }}>
                    {/* Mismo componente que arma Documentos (Rodrigo, 2026-08-20:
                        "solamente tienes que compartir el componente que muestra
                        el acta en documentos pero ponerlo aca") -- ya trae su
                        propia cabecera (NOMBRE = proceso, RESPONSABLE = el texto
                        libre de "Responsable: X"), asi que el panelHeader de
                        arriba con esos mismos datos sobraba. */}
                    <div className="actaDocFrame">
                      <OrdenProduccionDoc
                        entregaActions={
                          <AdminAddActaLineControl
                            isAdmin
                            items={materialItems}
                            onChanged={refreshDynamicOrder}
                            onError={setError}
                            onSuccess={setSuccess}
                            runId={dynamicOrderRun.id}
                            side="ENTREGA"
                            stageAttemptId={runningAttempt.id}
                          />
                        }
                        mode="completo"
                        model={runningModel}
                        onDeleteLine={(lineId) => deleteActaLine(lineId).then(refreshDynamicOrder)}
                        onEditLine={(lineId, patch) => updateActaLine(lineId, patch).then(refreshDynamicOrder)}
                        onError={setError}
                        recepcionFooter={
                          <StageRecepcionControl
                            entregaLines={entregaLines}
                            materialItems={materialItems}
                            onChanged={refreshDynamicOrder}
                            onError={setError}
                            onSuccess={setSuccess}
                            recepcionLines={recepcionLines}
                            runId={dynamicOrderRun.id}
                            stageAttemptId={runningAttempt.id}
                          />
                        }
                        recepcionPendingRow={
                          runningAttempt.target_label
                            ? {
                                label: runningAttempt.target_label,
                                onQuantityChange: setRunQuantity,
                                quantity: runQuantity,
                                disabled: isSaving,
                              }
                            : undefined
                        }
                      />
                    </div>

                    {(() => {
                      const attemptProcess = processes.find((p) => p.id === runningAttempt.process_id);
                      const requiresQuality = attemptProcess?.quality_control ?? false;
                      if (!requiresQuality) {
                        return (
                          <div className="modalActions">
                            <button
                              className="button buttonPrimary"
                              disabled={isSaving}
                              onClick={() => void handleFinishStageAttempt(runningAttempt.id, "APROBADA")}
                              type="button"
                            >
                              Finalizar etapa
                            </button>
                          </div>
                        );
                      }
                      return (
                        <>
                          {/* Motivo de rechazo: solo aparece despues de tocar ✘, nunca antes
                              (Rodrigo: "motivo de rechazo solo debe salir si se pone la x"). */}
                          {isRejectingStage ? (
                            <label className="fieldGroup">
                              <span>Motivo de rechazo (opcional)</span>
                              <input
                                autoFocus
                                className="field"
                                disabled={isSaving}
                                maxLength={1000}
                                onChange={(event) => setStageAttemptRejectReason(event.target.value)}
                                value={stageAttemptRejectReason}
                              />
                            </label>
                          ) : null}
                          <div className="modalActions">
                            {isRejectingStage ? (
                              <>
                                <button
                                  className="button"
                                  disabled={isSaving}
                                  onClick={() => {
                                    setIsRejectingStage(false);
                                    setStageAttemptRejectReason("");
                                  }}
                                  type="button"
                                >
                                  Cancelar
                                </button>
                                <button
                                  aria-label="Confirmar rechazo"
                                  className="iconOnlyButton dangerIconButton"
                                  disabled={isSaving}
                                  onClick={() => void handleFinishStageAttempt(runningAttempt.id, "RECHAZADA")}
                                  type="button"
                                >
                                  <X aria-hidden="true" size={18} />
                                </button>
                              </>
                            ) : (
                              <>
                                <button
                                  aria-label="Rechazar etapa"
                                  className="iconOnlyButton dangerIconButton"
                                  disabled={isSaving}
                                  onClick={() => setIsRejectingStage(true)}
                                  type="button"
                                >
                                  <X aria-hidden="true" size={18} />
                                </button>
                                <button
                                  aria-label="Aprobar etapa"
                                  className="iconOnlyButton successIconButton"
                                  disabled={isSaving}
                                  onClick={() => void handleFinishStageAttempt(runningAttempt.id, "APROBADA")}
                                  type="button"
                                >
                                  <Check aria-hidden="true" size={18} />
                                </button>
                              </>
                            )}
                          </div>
                        </>
                      );
                    })()}
                  </section>
                );
              })() : !isTerminada ? (
                <section className="card panelBody" style={{ marginTop: 12 }}>
                  <div className="panelHeader">
                    <div>
                      <h2 className="panelTitle">Elegir proceso</h2>
                      <p className="panelText">Banco de procesos</p>
                    </div>
                  </div>
                  <label className="fieldGroup">
                    <span>Proceso</span>
                    <button
                      className="button"
                      disabled={isSaving}
                      onClick={() => {
                        setProcessesPickerMode(true);
                        setIsProcessesOpen(true);
                      }}
                      type="button"
                    >
                      {selectedProcess ? selectedProcess.name : "Elegir proceso..."}
                    </button>
                  </label>
                  <label className="fieldGroup">
                    <span>Responsable</span>
                    <input
                      className="field"
                      disabled={isSaving}
                      maxLength={180}
                      onChange={(event) => setStageResponsableName(event.target.value)}
                      value={stageResponsableName}
                    />
                  </label>
                  <label className="fieldGroup">
                    <span>Materia prima</span>
                    <button className="button" disabled={isSaving} onClick={() => setIsStageMaterialPickerOpen(true)} type="button">
                      {stageMaterialItem
                        ? `${stageMaterialItem.name} · ${numericText(stageMaterialQuantity)} ${stageMaterialItem.unit_code}`
                        : "Elegir..."}
                    </button>
                  </label>
                  <label className="fieldGroup">
                    <span>Producto resultante</span>
                    <button
                      className="button"
                      disabled={isSaving}
                      onClick={() => {
                        setAssignPickerTab("PRODUCTOS");
                        setItemPickerFor("create");
                      }}
                      type="button"
                    >
                      {orderProduct ? orderProduct.label : "Elegir..."}
                    </button>
                  </label>
                  <div className="modalActions">
                    <button className="button buttonPrimary" disabled={isSaving} onClick={() => void handleStartStageAttempt()} type="button">
                      Iniciar etapa
                    </button>
                  </div>

                  {isStageMaterialPickerOpen ? (
                    <MaterialCategoryPicker
                      allowedTypes={["RAW_MATERIAL", "SUPPLY", "COMPLEMENT", "WASTE", "FINISHED_PRODUCT"]}
                      description="Elige la materia prima o cualquier item de inventario que entra a esta etapa"
                      items={[...rawMaterials, ...orderSupplyItems, ...complementItems, ...wasteItems, ...finishedItems]}
                      onClose={closeStageMaterialPicker}
                      onSelect={(item) => {
                        setStagePickerPendingItem(item);
                        setStagePickerQuantity("");
                      }}
                      quantityStep={
                        stagePickerPendingItem
                          ? {
                              confirmLabel: "Elegir",
                              isSaving: false,
                              item: stagePickerPendingItem,
                              onBack: () => setStagePickerPendingItem(null),
                              onConfirm: confirmStageMaterial,
                              onQuantityChange: setStagePickerQuantity,
                              quantity: stagePickerQuantity,
                            }
                          : undefined
                      }
                      title="Materia prima o insumo de la etapa"
                    />
                  ) : null}
                </section>
              ) : null}

              {!isTerminada ? (
                <div className="modalActions" style={{ marginTop: 12 }}>
                  {pastAttempts.length > 0 ? (
                    <button className="button buttonPrimary" disabled={isSaving} onClick={() => void handleFinishOrder()} type="button">
                      <CheckCheck aria-hidden="true" size={16} />
                      Finalizar orden
                    </button>
                  ) : null}
                  {canCancelRun && canRunBeCancelled(dynamicOrderRun) ? (
                    <button className="button buttonDanger" onClick={() => openCancelRunModal(dynamicOrderRun)} type="button">
                      <Trash2 aria-hidden="true" size={15} />
                      Cancelar orden
                    </button>
                  ) : null}
                </div>
              ) : null}
            </section>
          </div>

          {isStageReportOpen ? (
            <div className="modalBackdrop modalBackdropAnchor modalBackdropTop" role="dialog" aria-modal="true" aria-label="Reporte de etapas">
              <section className="modalWindow processViewWindow">
                <div className="modalHeader">
                  <div>
                    <h2>Reporte de etapas</h2>
                    <p>{dynamicOrderRun.name ?? dynamicOrderRun.production_code}</p>
                  </div>
                  <button aria-label="Cerrar" className="iconOnlyButton" onClick={() => setIsStageReportOpen(false)} type="button">
                    <X aria-hidden="true" size={18} />
                  </button>
                </div>
                <div className="stageFlow">
                  {[...pastAttempts, ...(runningAttempt ? [runningAttempt] : [])]
                    .sort((a, b) => a.sequence_order - b.sequence_order)
                    .map((attempt, index, arr) => (
                      <div className="stageFlowNode" key={attempt.id}>
                        <div
                          className={`stageFlowCard stageFlowCard-${
                            attempt.status === "APROBADA"
                              ? "aprobada"
                              : attempt.status === "RECHAZADA"
                                ? "rechazada"
                                : "enProceso"
                          }`}
                          onClick={attempt.status !== "EN_PROCESO" ? () => setViewingAttemptId(attempt.id) : undefined}
                          style={attempt.status !== "EN_PROCESO" ? { cursor: "pointer" } : undefined}
                        >
                          {attempt.code ? <span className="orderCodeTag">{attempt.code}</span> : null}
                          <strong>{attempt.process_name}</strong>
                          <span>{attempt.responsable_name ?? "—"}</span>
                          <span style={{ display: "flex", alignItems: "center", gap: 4 }}>
                            {attempt.status === "APROBADA"
                              ? "Aprobada"
                              : attempt.status === "RECHAZADA"
                                ? "Rechazada"
                                : "En proceso"}
                            {attempt.status !== "EN_PROCESO" ? <Eye aria-hidden="true" size={13} /> : null}
                          </span>
                        </div>
                        {index < arr.length - 1 ? <ArrowRight aria-hidden="true" className="stageFlowArrow" size={20} /> : null}
                      </div>
                    ))}
                </div>
                <div className="tableWrap">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Codigo</th>
                        <th>Proceso</th>
                        <th>Responsable</th>
                        <th>Estado</th>
                        <th className="num">Merma</th>
                        <th aria-label="Ver acta"></th>
                      </tr>
                    </thead>
                    <tbody>
                      {pastAttempts.map((attempt) => (
                        <tr key={attempt.id} onClick={() => setViewingAttemptId(attempt.id)} style={{ cursor: "pointer" }}>
                          <td>{attempt.code ?? "—"}</td>
                          <td>{attempt.process_name}</td>
                          <td>{attempt.responsable_name ?? "—"}</td>
                          <td><span className="statusBadge">{attempt.status === "APROBADA" ? "Aprobada" : "Rechazada"}</span></td>
                          <td className="num">{attempt.merma_weight ? `${numericText(attempt.merma_weight)} ${attempt.unit_code ?? ""}` : "—"}</td>
                          <td><Eye aria-hidden="true" size={15} /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </section>
            </div>
          ) : null}

          {viewingAttemptId ? (() => {
            const viewingOrderId = dynamicOrderRun.id;
            async function refreshViewingOrder() {
              setIsSaving(true);
              try {
                await reload();
                const fresh = (await listProductionRuns()).find((r) => r.id === viewingOrderId);
                if (fresh) setDynamicOrderRun(fresh);
              } finally {
                setIsSaving(false);
              }
            }
            const viewingAttempt = (dynamicOrderRun.stage_attempts ?? []).find((a) => a.id === viewingAttemptId);
            if (!viewingAttempt) return null;
            const viewMaterialItems = [...rawMaterials, ...orderSupplyItems, ...complementItems, ...wasteItems, ...finishedItems];
            const viewingModel = buildOrdenProduccion([dynamicOrderRun], viewingAttempt.id);
            const viewEntregaLines = viewingModel.entregaLines;
            const viewRecepcionLines = viewingModel.recepcionLines;
            return (
              <div className="modalBackdrop modalBackdropAnchor modalBackdropTop" role="dialog" aria-modal="true" aria-label="Acta de la etapa">
                <section className="modalWindow processViewWindow">
                  <div className="modalHeader">
                    <div>
                      <h2>Acta de la etapa</h2>
                      <p>{viewingAttempt.status === "APROBADA" ? "Aprobada" : viewingAttempt.status === "RECHAZADA" ? "Rechazada" : "En proceso"}</p>
                    </div>
                    <button aria-label="Cerrar" className="iconOnlyButton" onClick={() => setViewingAttemptId(null)} type="button">
                      <X aria-hidden="true" size={18} />
                    </button>
                  </div>
                  <div className="actaDocFrame">
                    <OrdenProduccionDoc
                      entregaActions={
                        <AdminAddActaLineControl
                          isAdmin
                          items={viewMaterialItems}
                          onChanged={() => void refreshViewingOrder()}
                          onError={setError}
                          onSuccess={setSuccess}
                          runId={dynamicOrderRun.id}
                          side="ENTREGA"
                          stageAttemptId={viewingAttempt.id}
                        />
                      }
                      mode="completo"
                      model={viewingModel}
                      onDeleteLine={(lineId) => deleteActaLine(lineId).then(() => refreshViewingOrder())}
                      onEditLine={(lineId, patch) => updateActaLine(lineId, patch).then(() => refreshViewingOrder())}
                      onError={setError}
                      recepcionFooter={
                        <StageRecepcionControl
                          entregaLines={viewEntregaLines}
                          materialItems={viewMaterialItems}
                          onChanged={() => void refreshViewingOrder()}
                          onError={setError}
                          onSuccess={setSuccess}
                          recepcionLines={viewRecepcionLines}
                          runId={dynamicOrderRun.id}
                          stageAttemptId={viewingAttempt.id}
                        />
                      }
                    />
                  </div>
                  {canCancelRun ? (
                    <div className="modalActions">
                      <button
                        className="button buttonDanger"
                        disabled={isSaving}
                        onClick={() =>
                          showConfirm(
                            "Eliminar y revertir etapa",
                            `Esto deshace el consumo de materia prima y la conversion del producto resultante de "${viewingAttempt.process_name}" (${viewingAttempt.code ?? "sin codigo"}), y borra la etapa por completo. No se puede deshacer.`,
                            () => void handleRevertStageAttempt(viewingAttempt.id),
                            true,
                            "Eliminar y revertir",
                          )
                        }
                        type="button"
                      >
                        <Trash2 aria-hidden="true" size={15} />
                        Eliminar y revertir etapa
                      </button>
                    </div>
                  ) : null}
                </section>
              </div>
            );
          })() : null}
          </>
        );
      })() : null}

      {/* Picker de pieza terminada (o complemento) para el producto único de
          la orden (producto resultante obligatorio al iniciar etapa, o
          Editar producto del flujo viejo). "Crear producto nuevo" pasa al
          picker de tipo del catálogo, para productos que aún no tienen
          piezas. Se muestran dos pestañas: productos terminados y
          complementos (la joyeria fabrica sus propios complementos). */}
      {itemPickerFor ? (() => {
        const tabsBar = (
          <div className="materialRow" style={{ gap: 8 }}>
            <button
              className={`button${assignPickerTab === "PRODUCTOS" ? " buttonPrimary" : ""}`}
              onClick={() => setAssignPickerTab("PRODUCTOS")}
              type="button"
            >
              Productos terminados
            </button>
            <button
              className={`button${assignPickerTab === "COMPLEMENTOS" ? " buttonPrimary" : ""}`}
              onClick={() => setAssignPickerTab("COMPLEMENTOS")}
              type="button"
            >
              Complementos
            </button>
          </div>
        );

        if (assignPickerTab === "COMPLEMENTOS") {
          return (
            <ComplementPicker
              items={complementItems}
              onClose={() => setItemPickerFor(null)}
              onSelect={(item) => {
                applyProductChoice(itemPickerFor, { targetItemId: item.id, label: item.name });
                setItemPickerFor(null);
              }}
              tabs={tabsBar}
              title="Elegir producto"
            />
          );
        }

        return (
          <CatalogProductPicker
            allowedTypeIds={allowedTypeIdsForPicker(itemPickerFor)}
            onClose={() => setItemPickerFor(null)}
            onSelect={(type) => {
              const label = type.name?.trim() || `${type.category_code}${type.model_code}`;
              applyProductChoice(itemPickerFor, { productTypeId: type.id, label });
              setItemPickerFor(null);
            }}
            subtitle="Tipos de producto terminado · elige uno"
            tabs={tabsBar}
            title="Elegir producto"
          />
        );
      })() : null}

      {isRunStagesOpen && selectedRunForStages ? (
        <div className="modalBackdrop modalBackdropAnchor modalBackdropTop" role="dialog" aria-modal="true">
          <section className="modalWindow processViewWindow">
            <div className="modalHeader">
              <div>
                <h2>
                  {selectedRunForStages.production_code ? (
                    <span style={{ display: "inline-block", marginRight: 10, fontFamily: "monospace", fontSize: 13, color: "var(--primary-strong)", fontWeight: 700, background: "#f3e9d6", borderRadius: 5, padding: "2px 8px" }}>{selectedRunForStages.production_code}</span>
                  ) : null}
                  {rootBadge(selectedRunForStages)}
                  {selectedRunForStages.process_name}
                </h2>
                <p>
                  {numericText(selectedRunForStages.quantity)} {selectedRunForStages.raw_material_unit_code}
                </p>
              </div>
              <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
                {(() => {
                  if (!canCancelRun || !canRunBeCancelled(selectedRunForStages)) return null;
                  const family = getRunFamily(runs, selectedRunForStages);
                  // Con una hermana todavia activa, "Cancelar orden" sola
                  // siempre rebota contra el backend -- se ofrece directo
                  // "Cancelar todo" para no repetir el mismo error.
                  const hasActiveSibling = family.some(
                    (member) => member.id !== selectedRunForStages.id && member.status !== "CANCELADA"
                  );
                  if (hasActiveSibling) {
                    return (
                      <button className="button buttonDanger" onClick={() => openCancelFamilyModal(family)} type="button">
                        <Trash2 aria-hidden="true" size={15} />
                        Cancelar todo
                      </button>
                    );
                  }
                  return (
                    <button
                      className="button buttonDanger"
                      onClick={() => openCancelRunModal(selectedRunForStages)}
                      type="button"
                    >
                      <Trash2 aria-hidden="true" size={15} />
                      Cancelar orden
                    </button>
                  );
                })()}
                <button aria-label="Cerrar" className="iconOnlyButton" onClick={closeRunStagesModal} type="button">
                  <X aria-hidden="true" size={18} />
                </button>
              </div>
            </div>

            {/* Global progress bar */}
            <div>
              <div style={{ display: "flex", justifyContent: "space-between", fontSize: 12, color: "var(--muted)", fontWeight: 700, marginBottom: 6 }}>
                <span>Progreso total</span>
                <span>{selectedRunForStages.stages.filter((s) => s.status === "FINALIZADA").length} / {selectedRunForStages.stages.length} etapas · {getRunProgress(selectedRunForStages)}%</span>
              </div>
              <div className="progressTrack">
                <div
                  className="progressFill"
                  style={{ width: `${getRunProgress(selectedRunForStages)}%` }}
                />
              </div>
            </div>

            {/* Stage carousel nav */}
            {selectedRunForStages.stages.length > 0 ? (() => {
              const stages = selectedRunForStages.stages;
              const safeIndex = stageModalIndex % stages.length;
              const stage = stages[safeIndex];
              return (
                <>
                  <div className="stageCarouselNav">
                    <button
                      className="iconOnlyButton"
                      disabled={stages.length <= 1}
                      onClick={() => prevStageInModal(stages.length)}
                      type="button"
                      aria-label="Etapa anterior"
                    >
                      <ChevronLeft aria-hidden="true" size={18} />
                    </button>
                    <span className="carouselCounter">Etapa {safeIndex + 1} de {stages.length}</span>
                    <button
                      className="iconOnlyButton"
                      disabled={stages.length <= 1}
                      onClick={() => nextStageInModal(stages.length)}
                      type="button"
                      aria-label="Siguiente etapa"
                    >
                      <ChevronRight aria-hidden="true" size={18} />
                    </button>
                  </div>

                  <div
                    className={`stageCarouselCard stageTimeline${stage.status} ${stageModalDir === "right" ? "slideFromRight" : "slideFromLeft"}`}
                    key={stageModalKey}
                  >
                    <div className="stageCarouselHead">
                      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                        <span className={`stageTimelineNum ${stage.status === "FINALIZADA" ? "stageTimelineNumDone" : stage.status === "EN_PROCESO" ? "stageTimelineNumActive" : ""}`}>
                          {stage.stage_order}
                        </span>
                        <div>
                          <strong style={{ fontSize: 16 }}>{stage.stage_name}</strong>
                          {stage.stage_code ? (
                            <span style={{ fontFamily: "monospace", fontSize: 11, color: "var(--muted)", display: "block" }}>{stage.stage_code}</span>
                          ) : null}
                          <div style={{ marginTop: 4 }}><StatusBadge status={stage.status} /></div>
                        </div>
                      </div>
                    </div>

                    {stage.quality_check ? (
                      <div className="processFlowCallout processFlowCalloutCheck">
                        <strong>Control de calidad</strong>{stage.quality_check}
                      </div>
                    ) : null}
                    {stage.rework_action ? (
                      <div className="processFlowCallout processFlowCalloutRework">
                        <strong>Si no cumple</strong>{stage.rework_action}
                      </div>
                    ) : null}


                    {stage.started_at ? (
                      <div className="userPreviewGrid">
                        <span>
                          <strong>Inició</strong>
                          {hourLabel(stage.started_at)}
                        </span>
                        {stage.finished_at ? (
                          <span>
                            <strong>Finalizó</strong>
                            {hourLabel(stage.finished_at)}
                            {stage.finished_by_name ? ` · ${stage.finished_by_name}` : ""}
                          </span>
                        ) : null}
                      </div>
                    ) : null}

                    {stage.status === "FINALIZADA" && stage.waste_weight !== null ? (
                      <div
                        className="processFlowCallout"
                        style={{
                          color: Number(stage.waste_percent ?? 0) > Number(selectedRunForStages.waste_limit_percent)
                            ? "var(--danger, #b42318)"
                            : "var(--muted)",
                        }}
                      >
                        <strong>Merma de esta fase</strong>
                        {numericText(stage.waste_weight)} {selectedRunForStages.raw_material_unit_code} · {percentText(stage.waste_percent)}%
                      </div>
                    ) : null}

                    {stage.decisions && stage.decisions.length > 0 ? (
                      <div className="stageDecisions">
                        {stage.decisions.map((decision, decisionIndex) => (
                          <div
                            className={`stageDecisionRow ${decision.decision === "REJECTED" ? "stageDecisionReject" : "stageDecisionApprove"}`}
                            key={decisionIndex}
                          >
                            <strong>
                              {decision.decision === "REJECTED" ? "Rechazo" : "Aprobación"}
                              {(stage.decisions?.length ?? 0) > 1 || decision.attempt_no > 1 ? ` · intento ${decision.attempt_no}` : ""}
                            </strong>
                            {decision.justification ? <span>{decision.justification}</span> : null}
                            <small>
                              {decision.decided_by_name ?? ""}
                              {decision.decided_at ? ` · ${timeLabel(decision.decided_at)}` : ""}
                              {decision.returned_to_order ? ` · regresó a etapa ${decision.returned_to_order}` : ""}
                            </small>
                          </div>
                        ))}
                      </div>
                    ) : null}

                  </div>

                  {/* Stats shown only when run is finished */}
                  {selectedRunForStages.status === "PENDIENTE_RECEPCION" || selectedRunForStages.status === "RECIBIDA" ? (
                    <div className="productionStats">
                      <span>
                        <strong>Peso real</strong>
                        {numericText(selectedRunForStages.actual_finished_weight)} {selectedRunForStages.raw_material_unit_code}
                      </span>
                      <span>
                        <strong>Merma acumulada</strong>
                        {numericText(selectedRunForStages.waste_weight)} {selectedRunForStages.raw_material_unit_code} · {percentText(selectedRunForStages.waste_percent)}%
                        {Number(selectedRunForStages.waste_percent ?? 0) > Number(selectedRunForStages.waste_limit_percent)
                          ? ` · ⚠ supera el ${percentText(selectedRunForStages.waste_limit_percent)}%`
                          : ""}
                      </span>
                    </div>
                  ) : null}

                  <div className="fieldGroup">
                    <span>Acta y materiales</span>
                    <button className="button" onClick={() => setActaRun(selectedRunForStages)} style={{ marginTop: 8 }} type="button">
                      Ver acta
                    </button>
                  </div>
                </>
              );
            })() : null}
          </section>
        </div>
      ) : null}

      {cancelRun ? (
        <div className="modalBackdrop modalBackdropTop" role="dialog" aria-modal="true" aria-label="Cancelar orden">
          <form
            className="modalWindow processFormWindow"
            onSubmit={(event) => {
              event.preventDefault();
              if (cancelRun) void handleCancelRun(cancelRun, cancelRunReason);
            }}
          >
            <div className="modalHeader">
              <div>
                <h2>Cancelar orden</h2>
                <p>
                  {cancelRun.production_code ? `${cancelRun.production_code} · ` : ""}{cancelRun.name ?? cancelRun.process_name}
                </p>
              </div>
              <button aria-label="Cerrar" className="iconOnlyButton" onClick={() => setCancelRun(null)} type="button">
                <X aria-hidden="true" size={18} />
              </button>
            </div>
            <label className="fieldGroup">
              <span>Motivo de la cancelación (opcional)</span>
              <textarea
                className="field textarea"
                maxLength={1000}
                onChange={(event) => setCancelRunReason(event.target.value)}
                rows={3}
                value={cancelRunReason}
              />
            </label>
            <p className="panelText">
              La orden quedará cancelada y se restaurará al inventario todo lo que ya consumió (materia prima,
              insumos). No se puede deshacer.
            </p>
            <div className="modalActions">
              <button className="button" onClick={() => setCancelRun(null)} type="button">
                Volver
              </button>
              <button className="button buttonDanger" disabled={isCancellingRun} type="submit">
                {isCancellingRun ? "Cancelando" : "Cancelar orden"}
              </button>
            </div>
          </form>
        </div>
      ) : null}

      {familyRuns ? (
        <div className="modalBackdrop" role="dialog" aria-modal="true" aria-label="Partes de la orden">
          <section className="modalWindow processViewWindow">
            <div className="modalHeader">
              <div>
                <h2>Orden {familyRuns[0].root_production_code ?? familyRuns[0].production_code}</h2>
                <p>Dividida en {familyRuns.length} partes por falta de materia prima</p>
              </div>
              {canCancelRun && familyRuns.some(canRunBeCancelled) ? (
                <button className="button buttonDanger" onClick={() => openCancelFamilyModal(familyRuns)} type="button">
                  Cancelar todo
                </button>
              ) : null}
              <button aria-label="Cerrar" className="iconOnlyButton" onClick={() => setFamilyRuns(null)} type="button">
                <X aria-hidden="true" size={18} />
              </button>
            </div>
            <div className="tableWrap">
              <table className="table tableAuto">
                <thead>
                  <tr>
                    <th>Orden</th>
                    <th>Estado</th>
                    <th className="num">Cantidad</th>
                    <th>Inició</th>
                    <th aria-label="Accion" />
                  </tr>
                </thead>
                <tbody>
                  {familyRuns.map((familyRun) => (
                    <tr key={familyRun.id}>
                      <td><span className="orderCodeTag">{familyRun.production_code}</span></td>
                      <td><StatusPunch label={runStatusLabel(familyRun.status)} tone={runStatusTone(familyRun.status)} /></td>
                      <td className="num">{numericText(familyRun.quantity)} {familyRun.raw_material_unit_code}</td>
                      <td>{familyRun.started_at ? hourLabel(familyRun.started_at) : "—"}</td>
                      <td>{processRowActions(familyRun)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      ) : null}

      {cancelFamilyRuns ? (
        <div className="modalBackdrop modalBackdropTop" role="dialog" aria-modal="true" aria-label="Cancelar toda la orden">
          <form
            className="modalWindow processFormWindow"
            onSubmit={(event) => {
              event.preventDefault();
              void handleCancelRunFamily(cancelFamilyRuns, cancelFamilyReason);
            }}
          >
            <div className="modalHeader">
              <div>
                <h2>Cancelar toda la orden</h2>
                <p>
                  {cancelFamilyRuns[0].root_production_code ?? cancelFamilyRuns[0].production_code} ·{" "}
                  {cancelFamilyRuns.length} partes
                </p>
              </div>
              <button aria-label="Cerrar" className="iconOnlyButton" onClick={() => setCancelFamilyRuns(null)} type="button">
                <X aria-hidden="true" size={18} />
              </button>
            </div>
            <label className="fieldGroup">
              <span>Motivo de la cancelación (opcional)</span>
              <textarea
                className="field textarea"
                maxLength={1000}
                onChange={(event) => setCancelFamilyReason(event.target.value)}
                rows={3}
                value={cancelFamilyReason}
              />
            </label>
            <p className="panelText">
              Se cancelarán las {cancelFamilyRuns.length} partes de esta orden, sin importar en qué estado esté cada
              una, y se restaurará al inventario todo lo que ya se haya consumido. No se puede deshacer.
            </p>
            <div className="modalActions">
              <button className="button" onClick={() => setCancelFamilyRuns(null)} type="button">
                Volver
              </button>
              <button className="button buttonDanger" disabled={isCancellingFamily} type="submit">
                {isCancellingFamily ? "Cancelando" : "Cancelar todo"}
              </button>
            </div>
          </form>
        </div>
      ) : null}

      {isStatsModalOpen && selectedStatsRun ? (
        <div className="modalBackdrop modalBackdropTop" role="dialog" aria-modal="true" aria-label="Estadisticas del proceso">
          <section className="modalWindow processViewWindow">
            <div className="modalHeader">
              <div>
                <h2>{selectedStatsRun.process_name ?? selectedStatsRun.name ?? "—"}</h2>
                {selectedStatsRun.name ? null : <p>{numericText(selectedStatsRun.quantity)} {selectedStatsRun.raw_material_unit_code}</p>}
              </div>
              <button aria-label="Cerrar" className="iconOnlyButton" onClick={closeStatsModal} type="button">
                <X aria-hidden="true" size={18} />
              </button>
            </div>
            <div className="userPreviewGrid">
              <span>
                <strong>Estado</strong>
                <StatusPunch label={runStatusLabel(selectedStatsRun.status)} tone={runStatusTone(selectedStatsRun.status)} />
              </span>
              <RunWasteHero run={selectedStatsRun} />
              <span>
                <button
                  className="iconTextButton"
                  onClick={() => setShowResponsables((current) => !current)}
                  type="button"
                >
                  <strong>Responsables</strong>
                  <ChevronDown
                    aria-hidden="true"
                    size={14}
                    style={{ transform: showResponsables ? "rotate(180deg)" : undefined, transition: "transform 0.15s" }}
                  />
                </button>
              </span>
              {showResponsables ? (
                <>
                  <span>
                    <strong>Inició</strong>
                    {selectedStatsRun.started_by_name ?? "—"} · {timeLabel(selectedStatsRun.started_at)}
                  </span>
                  <span>
                    <strong>Finalizó</strong>
                    {runFinisherName(selectedStatsRun)} · {timeLabel(selectedStatsRun.finished_at)}
                  </span>
                </>
              ) : null}
            </div>
            <RunStageSummaryTable run={selectedStatsRun} />
            {/* Flujo nuevo: cada intento tiene su propia acta -- "Ver acta"
                (una sola, de toda la orden) no aplicaba (Rodrigo, 2026-08-20:
                "deberia poder ver todos los procesos y las actas
                individuales"). Click en la fila abre el acta de ESE
                intento, solo lectura (la orden ya esta TERMINADA). */}
            {selectedStatsRun.stage_attempts && selectedStatsRun.stage_attempts.length > 0 ? (
              <div className="tableWrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Codigo</th>
                      <th>Proceso</th>
                      <th>Responsable</th>
                      <th>Estado</th>
                      <th className="num">Merma</th>
                      <th aria-label="Ver acta"></th>
                    </tr>
                  </thead>
                  <tbody>
                    {[...selectedStatsRun.stage_attempts]
                      .sort((a, b) => a.sequence_order - b.sequence_order)
                      .map((attempt) => (
                        <tr key={attempt.id} onClick={() => setViewingStatsAttemptId(attempt.id)} style={{ cursor: "pointer" }}>
                          <td>{attempt.code ?? "—"}</td>
                          <td>{attempt.process_name}</td>
                          <td>{attempt.started_by_name ?? "—"}</td>
                          <td><span className="statusBadge">{attempt.status === "APROBADA" ? "Aprobada" : attempt.status === "RECHAZADA" ? "Rechazada" : "En proceso"}</span></td>
                          <td className="num">{attempt.merma_weight ? `${numericText(attempt.merma_weight)} ${attempt.unit_code ?? ""}` : "—"}</td>
                          <td><Eye aria-hidden="true" size={15} /></td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
            ) : null}
            <div className="modalActions">
              {selectedStatsRun.stage_attempts && selectedStatsRun.stage_attempts.length > 0 ? null : (
                <button className="button" onClick={() => setActaRun(selectedStatsRun)} type="button">
                  Ver acta
                </button>
              )}
              <button className="button buttonPrimary" onClick={() => setPrintingWasteRun(selectedStatsRun)} type="button">
                <Printer aria-hidden="true" size={14} />
                Imprimir
              </button>
            </div>
          </section>
        </div>
      ) : null}

      {viewingStatsAttemptId && selectedStatsRun ? (() => {
        const model = buildOrdenProduccion([selectedStatsRun], viewingStatsAttemptId);
        return (
          <div className="modalBackdrop modalBackdropAnchor modalBackdropTop" role="dialog" aria-modal="true" aria-label="Acta de la etapa">
            <section className="modalWindow processViewWindow">
              <div className="modalHeader">
                <div>
                  <h2>Acta de la etapa</h2>
                </div>
                <button aria-label="Cerrar" className="iconOnlyButton" onClick={() => setViewingStatsAttemptId(null)} type="button">
                  <X aria-hidden="true" size={18} />
                </button>
              </div>
              <div className="actaDocFrame">
                <OrdenProduccionDoc model={model} mode="completo" />
              </div>
            </section>
          </div>
        );
      })() : null}

      {printingWasteRun
        ? createPortal(
            <div className="printArea">
              <div className="wasteReportPrint">
                <h1>Reporte de merma</h1>
                <h2>
                  {printingWasteRun.production_code ?? printingWasteRun.process_name ?? printingWasteRun.name} · {printingWasteRun.process_name ?? printingWasteRun.name}
                </h2>
                <p>
                  {printingWasteRun.name ? null : <>{numericText(printingWasteRun.quantity)} {printingWasteRun.raw_material_unit_code} · </>}
                  Estado: {runStatusLabel(printingWasteRun.status)}
                  {printingWasteRun.finished_at ? ` · Finalizó: ${timeLabel(printingWasteRun.finished_at)}` : ""}
                </p>
                <div className="userPreviewGrid">
                  <RunWasteHero run={printingWasteRun} />
                </div>
                <RunStageSummaryTable run={printingWasteRun} print />
              </div>
            </div>,
            document.body
          )
        : null}

      {isHistoryOpen ? (
        <div className="modalBackdrop" role="dialog" aria-modal="true" aria-label="Historial de procesos">
          <section className="modalWindow movementHistoryWindow">
            <div className="modalHeader">
              <div>
                <h2>Historial de procesos</h2>
                <p>{finishedRuns.length} procesos registrados</p>
              </div>
              <button aria-label="Cerrar" className="iconOnlyButton" onClick={() => setIsHistoryOpen(false)} type="button">
                <X aria-hidden="true" size={18} />
              </button>
            </div>
            <div className="movementHistoryLayout">
              <section className="movementCalendarPanel" aria-label="Calendario de procesos">
                <div className="movementCalendarHeader">
                  <button aria-label="Mes anterior" className="iconOnlyButton" onClick={() => moveHistoryMonth(-1)} type="button">
                    <ChevronLeft aria-hidden="true" size={18} />
                  </button>
                  <strong>{monthLabel(currentHistoryMonth)}</strong>
                  <button aria-label="Mes siguiente" className="iconOnlyButton" onClick={() => moveHistoryMonth(1)} type="button">
                    <ChevronRight aria-hidden="true" size={18} />
                  </button>
                </div>
                <div className="movementCalendarWeekdays">
                  <span>Lu</span>
                  <span>Ma</span>
                  <span>Mi</span>
                  <span>Ju</span>
                  <span>Vi</span>
                  <span>Sa</span>
                  <span>Do</span>
                </div>
                <div className="movementCalendarGrid">
                  {historyDays.map((day) => {
                    if (!day.isValid) {
                      return <span className="movementCalendarEmpty" key={day.key} />;
                    }
                    const count = finishedRuns.filter((run) => (run.finished_at ?? "").slice(0, 10) === day.key).length;
                    const isSelected = day.key === selectedHistoryDate;
                    return (
                      <button
                        className={`movementCalendarDay ${isSelected ? "movementCalendarSelected" : ""} ${count > 0 ? "movementCalendarHasMovements" : ""}`}
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
                  <h3>{selectedHistoryDate ? new Date(`${selectedHistoryDate}T00:00:00`).toLocaleDateString("es-EC", { weekday: "long", day: "numeric", month: "long" }) : "Sin fecha"}</h3>
                  <p>{selectedDateRuns.length} procesos registrados</p>
                </div>
                <div className="movementList movementHistoryEntries">
                  {historyRunsPager.pageItems.map((run) => {
                    const runLabel = run.process_name ?? run.name ?? "—";
                    const runIsDynamic = Boolean(run.name);
                    const runWaste = runIsDynamic
                      ? (run.stage_attempts ?? []).reduce((sum, a) => sum + Number(a.merma_weight ?? 0), 0)
                      : Number(run.waste_weight ?? 0);
                    const runUnit = run.raw_material_unit_code ?? run.stage_attempts?.[0]?.unit_code ?? "g";
                    return (
                    <article className="movementRow" key={run.id} {...openableProps(() => openStatsModal(run), `Ver resumen de ${runLabel}`)}>
                      <div style={{ gridColumn: "1 / -2" }}>
                        <strong>{run.production_code ? `${run.production_code} · ` : ""}{runLabel}</strong>
                        <span>
                          {runIsDynamic ? null : <>{numericText(run.quantity)} {run.raw_material_unit_code} · </>}
                          Merma: {numericText(runWaste)} {runUnit}
                          {runIsDynamic ? null : <> · {percentText(run.waste_percent)}%</>}
                          {" "}· {timeLabel(run.finished_at)} · Finalizó: {runFinisherName(run)}
                        </span>
                      </div>
                      <button
                        className="iconTextButton"
                        onClick={(event) => { event.stopPropagation(); openStatsModal(run); }}
                        type="button"
                      >
                        <Eye aria-hidden="true" size={14} />
                        Visualizar
                      </button>
                    </article>
                    );
                  })}
                  {selectedDateRuns.length === 0 ? <div className="emptyState">No hay procesos en esta fecha.</div> : null}
                </div>
                <Pager {...historyRunsPager} />
              </section>
            </div>
          </section>
        </div>
      ) : null}

      {isFormOpen ? (
        <div className="modalBackdrop" role="dialog" aria-modal="true" aria-label="Formulario de proceso">
          <form className="modalWindow processFormWindow" onSubmit={handleSubmit}>
            <div className="modalHeader">
              <div>
                <h2>{formMode === "edit" ? "Editar proceso" : "Crear proceso"}</h2>
                <p>Banco de procesos -- un paso suelto reutilizable</p>
              </div>
              <button aria-label="Cerrar" className="iconOnlyButton" onClick={closeProcessForm} type="button">
                <X aria-hidden="true" size={18} />
              </button>
            </div>

            <label className="fieldGroup">
              <span>Nombre del proceso</span>
              <input
                className="field"
                disabled={isSaving}
                maxLength={180}
                onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
                value={form.name}
              />
            </label>

            <label className="fieldGroup">
              <span>Descripcion</span>
              <textarea
                className="field textarea"
                disabled={isSaving}
                maxLength={1000}
                onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))}
                value={form.description}
              />
            </label>

            <label className="checkboxRow">
              <input
                checked={form.qualityControl}
                disabled={isSaving}
                onChange={(event) => setForm((current) => ({ ...current, qualityControl: event.target.checked }))}
                type="checkbox"
              />
              <span>Control de calidad</span>
            </label>

            <div className="modalActions">
              <button className="button buttonPrimary" disabled={isSaving} type="submit">
                <Save aria-hidden="true" size={17} />
                {isSaving ? "Guardando" : "Guardar"}
              </button>
            </div>
          </form>
        </div>
      ) : null}

      {dataModal?.type === "units" ? <UnitsManager mode={dataModal.mode} onClose={() => setDataModal(null)} /> : null}
      {dataModal?.type === "materials" ? <RawMaterialsManager mode={dataModal.mode} onClose={() => setDataModal(null)} /> : null}
      {dataModal?.type === "supplies" ? <SuppliesManager mode={dataModal.mode} onClose={() => setDataModal(null)} /> : null}
      {dataModal?.type === "complements" ? <ComplementsManager mode={dataModal.mode} onClose={() => setDataModal(null)} /> : null}
      {dataModal?.type === "productTypes" ? <ProductTypesManager mode={dataModal.mode} onClose={() => setDataModal(null)} /> : null}

      {isProcessesOpen ? (() => {
        const listedProcesses = processesPickerMode ? activeProcesses : processes;
        return (
          <div className="modalBackdrop" role="dialog" aria-modal="true" aria-label="Procesos creados">
            <section className="modalWindow processesWindow">
              <div className="modalHeader">
                <div>
                  <h2>{processesPickerMode ? "Elegir proceso" : "Procesos"}</h2>
                  <p>{listedProcesses.length} procesos {processesPickerMode ? "disponibles" : "creados"}</p>
                </div>
                <div style={{ display: "flex", gap: 6 }}>
                  {processesPickerMode ? (
                    <button className="button" onClick={() => openCreateForm(true)} type="button">
                      <Factory aria-hidden="true" size={15} />
                      Crear proceso
                    </button>
                  ) : null}
                  <button
                    aria-label="Cerrar"
                    className="iconOnlyButton"
                    onClick={() => {
                      setIsProcessesOpen(false);
                      setProcessesPickerMode(false);
                    }}
                    type="button"
                  >
                    <X aria-hidden="true" size={18} />
                  </button>
                </div>
              </div>

              <div className="processesLayout">
                <div className="processList">
                  {listedProcesses.map((process) =>
                    processesPickerMode ? (
                      <article
                        className="processRow"
                        key={process.id}
                        {...openableProps(
                          () => {
                            setSelectedProcessId(process.id);
                            setIsProcessesOpen(false);
                            setProcessesPickerMode(false);
                          },
                          `Elegir proceso ${process.name}`,
                        )}
                      >
                        <span className="linkButton">
                          {process.code ? <span className="orderCodeTag">{process.code}</span> : null}
                          {process.name}
                        </span>
                      </article>
                    ) : (
                      <article className="processRow" key={process.id} {...openableProps(() => setViewingProcess(process), `Ver proceso ${process.name}`)}>
                        <button
                          className="linkButton"
                          onClick={() => {
                            setViewingProcess(process);
                          }}
                          type="button"
                        >
                          {process.code ? <span className="orderCodeTag">{process.code}</span> : null}
                          {process.name}
                        </button>
                        <div className="rowActions" onClick={stopClick}>
                          <button
                            className="iconTextButton"
                            onClick={() => {
                              setViewingProcess(process);
                            }}
                            type="button"
                          >
                            <Eye aria-hidden="true" size={15} />
                            Visualizar
                          </button>
                          <button className="iconTextButton" disabled={!canUpdate} onClick={() => openEditForm(process)} type="button">
                            <Pencil aria-hidden="true" size={15} />
                            Editar
                          </button>
                          <button
                            className="iconTextButton dangerText"
                            disabled={!canDelete}
                            onClick={() => void handleDelete(process)}
                            type="button"
                          >
                            <Trash2 aria-hidden="true" size={15} />
                            Eliminar
                          </button>
                        </div>
                      </article>
                    ),
                  )}
                  {!isLoading && listedProcesses.length === 0 ? (
                    <div className="emptyState">
                      {processesPickerMode ? "No hay procesos activos." : "No hay procesos creados."}
                    </div>
                  ) : null}
                </div>

              </div>
            </section>
          </div>
        );
      })() : null}

      {viewingProcess ? (
        <div className="modalBackdrop" role="dialog" aria-modal="true" aria-label="Detalle del proceso">
          <section className="modalWindow processFlowWindow">
            <div className="modalHeader">
              <div>
                <h2>{viewingProcess.name}</h2>
                {viewingProcess.code ? <p>Proceso {viewingProcess.code}</p> : null}
              </div>
              <button aria-label="Cerrar" className="iconOnlyButton" onClick={() => setViewingProcess(null)} type="button">
                <X aria-hidden="true" size={18} />
              </button>
            </div>

            {viewingProcess.description ? (
              <p className="panelText">{viewingProcess.description}</p>
            ) : null}
          </section>
        </div>
      ) : null}

      {isUserCreateOpen ? (
        <div className="modalBackdrop" role="dialog" aria-modal="true" aria-label="Crear usuario">
          <form className="modalWindow processFormWindow" onSubmit={handleSaveUser}>
            <div className="modalHeader">
              <div>
                <h2>{userFormMode === "edit" ? "Editar usuario" : "Crear usuario"}</h2>
                <p>Mantenimiento de usuarios</p>
              </div>
              <button aria-label="Cerrar" className="iconOnlyButton" onClick={closeUserForm} type="button">
                <X aria-hidden="true" size={18} />
              </button>
            </div>
            <label className="fieldGroup">
              <span>Nombre</span>
              <input
                className="field"
                maxLength={120}
                onChange={(event) => setUserForm((current) => ({ ...current, first_name: event.target.value }))}
                value={userForm.first_name}
              />
            </label>
            <label className="fieldGroup">
              <span>Apellido</span>
              <input
                className="field"
                maxLength={120}
                onChange={(event) => setUserForm((current) => ({ ...current, last_name: event.target.value }))}
                value={userForm.last_name}
              />
            </label>
            <label className="fieldGroup">
              <span>Rol</span>
              <select
                className="field"
                onChange={(event) => setUserForm((current) => ({ ...current, role: event.target.value }))}
                value={userForm.role}
              >
                {SYSTEM_ROLES.map((role) => (
                  <option key={role} value={role}>
                    {role}
                  </option>
                ))}
              </select>
            </label>
            <div className="modalActions">
              <button className="button buttonPrimary" type="submit">
                <Save aria-hidden="true" size={17} />
                Guardar
              </button>
            </div>
          </form>
        </div>
      ) : null}

      {isUsersOpen ? (
        <div className="modalBackdrop" role="dialog" aria-modal="true" aria-label="Usuarios">
          <section className="modalWindow processesWindow">
            <div className="modalHeader">
              <div>
                <h2>Usuarios</h2>
                <p>Mantenimiento de usuarios</p>
              </div>
              <button aria-label="Cerrar" className="iconOnlyButton" onClick={() => setIsUsersOpen(false)} type="button">
                <X aria-hidden="true" size={18} />
              </button>
            </div>
            <div className="processList">
              {users.map((user) => (
                <article className={`processRow userRow ${!user.is_active ? "userRowInactive" : ""}`} key={user.id} {...openableProps(() => setViewingUser(user), `Ver usuario ${user.first_name} ${user.last_name}`)}>
                  <div className="userRowHeader" onClick={stopClick}>
                    <strong>
                      {user.employee_code ? <span className="orderCodeTag">{user.employee_code}</span> : null}
                      {user.first_name} {user.last_name}
                    </strong>
                    {user.is_active ? (
                      <button
                        className="iconTextButton dangerText"
                        disabled={user.id === currentUser?.id}
                        onClick={() => void handleDeactivateUser(user)}
                        type="button"
                      >
                        <X aria-hidden="true" size={15} />
                        Desactivar
                      </button>
                    ) : (
                      <button className="iconTextButton successText" onClick={() => void handleActivateUser(user)} type="button">
                        <Plus aria-hidden="true" size={15} />
                        Activar
                      </button>
                    )}
                  </div>
                  <span>{user.email}</span>
                  <div className="rowActions" onClick={stopClick}>
                    <button className="iconTextButton" onClick={() => setViewingUser(user)} type="button">
                      <Eye aria-hidden="true" size={15} />
                      Visualizar
                    </button>
                    <button className="iconTextButton" onClick={() => openEditUserForm(user)} type="button">
                      <Pencil aria-hidden="true" size={15} />
                      Editar
                    </button>
                    <button
                      className="iconTextButton dangerText"
                      disabled={user.id === currentUser?.id}
                      onClick={() => void handleDeleteUser(user)}
                      type="button"
                    >
                      <Trash2 aria-hidden="true" size={15} />
                      Eliminar
                    </button>
                  </div>
                </article>
              ))}
              {users.length === 0 ? <div className="emptyState">No hay usuarios creados.</div> : null}
            </div>
          </section>
        </div>
      ) : null}

      {viewingUser ? (
        <div className="modalBackdrop" role="dialog" aria-modal="true" aria-label="Detalle del usuario">
          <section className="modalWindow processViewWindow">
            <div className="modalHeader">
              <div>
                <h2>{viewingUser.first_name} {viewingUser.last_name}</h2>
                <p>Vista previa del usuario</p>
              </div>
              <button aria-label="Cerrar" className="iconOnlyButton" onClick={() => setViewingUser(null)} type="button">
                <X aria-hidden="true" size={18} />
              </button>
            </div>
            <div className="userPreviewGrid">
              <span>
                <strong>Usuario generado</strong>
                {viewingUser.username}
              </span>
              <span>
                <strong>Correo generado</strong>
                {viewingUser.email}
              </span>
              <span>
                <strong>Rol</strong>
                {viewingUser.role}
              </span>
              <span>
                <strong>Estado</strong>
                {viewingUser.is_active ? "Activo" : "Inactivo"}
              </span>
            </div>
            <div className="rowActions">
              <button className="iconTextButton" onClick={() => void handleResetPassword(viewingUser)} type="button">
                <Save aria-hidden="true" size={15} />
                Restablecer contrasena
              </button>
            </div>
          </section>
        </div>
      ) : null}

      {generatedCredentials ? (
        <div className="modalBackdrop" role="dialog" aria-modal="true" aria-label="Credenciales temporales">
          <section className="modalWindow processViewWindow">
            <div className="modalHeader">
              <div>
                <h2>{generatedCredentials.title}</h2>
              <p>{generatedCredentials.role}</p>
              </div>
              <button aria-label="Cerrar" className="iconOnlyButton" onClick={() => setGeneratedCredentials(null)} type="button">
                <X aria-hidden="true" size={18} />
              </button>
            </div>
            <div className="credentialsStack">
              <span>
                <strong>Usuario</strong>
                {generatedCredentials.username}
              </span>
              <span>
                <strong>Correo</strong>
                {generatedCredentials.email}
              </span>
              <span>
                <strong>Contrasena temporal</strong>
                {generatedCredentials.temporaryPassword}
              </span>
              <span>
                <strong>Rol</strong>
                {generatedCredentials.role}
              </span>
            </div>
          </section>
        </div>
      ) : null}

      {confirmDialog ? (
        <div className="confirmBackdrop" role="dialog" aria-modal="true" aria-label={confirmDialog.title}>
          <div className="confirmDialog">
            <h3>{confirmDialog.title}</h3>
            <p>{confirmDialog.message}</p>
            <div className="confirmDialogActions">
              <button
                className="button"
                onClick={() => setConfirmDialog(null)}
                type="button"
              >
                Cancelar
              </button>
              <button
                className={`button ${confirmDialog.isDanger ? "buttonDanger" : "buttonPrimary"}`}
                onClick={() => {
                  const { onConfirm } = confirmDialog;
                  setConfirmDialog(null);
                  onConfirm();
                }}
                type="button"
              >
                {confirmDialog.confirmLabel}
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {actaRun ? (
        <ActaView
          family={getRunFamily(runs, actaRun)}
          inventoryItems={[...rawMaterials, ...orderSupplyItems, ...complementItems, ...wasteItems, ...finishedItems]}
          isAdmin={isAdmin}
          onChanged={() => void reload()}
          onClose={() => closeActaModal()}
          run={actaRun}
        />
      ) : null}
    </div>
  );
}
