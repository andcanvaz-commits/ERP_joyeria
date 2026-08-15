"use client";

import { FormEvent, useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ArrowRight, Boxes, CalendarDays, CheckCheck, CheckCircle2, ChevronDown, ChevronLeft, ChevronRight, Clock, Eye, Factory, FileText, FlaskConical, Hourglass, Pencil, Play, Plus, Printer, Puzzle, Ruler, Save, ScrollText, Trash2, UserPlus, Users, X } from "lucide-react";
import { ProductTypesManager } from "@/components/mantenimiento/product-types-manager";
import { UnitsManager } from "@/components/mantenimiento/units-manager";
import { RawMaterialsManager } from "@/components/mantenimiento/raw-materials-manager";
import { SuppliesManager } from "@/components/mantenimiento/supplies-manager";
import { ComplementsManager } from "@/components/mantenimiento/complements-manager";
import { FinishedItemPicker } from "@/components/inventory/finished-item-picker";
import { MaterialCategoryPicker } from "@/components/production/material-category-picker";
import { CreateOrderWizard } from "@/components/production/create-order-wizard";
import { ActaView, ReturnCandidatesForm, buildReturnCandidates } from "@/components/production/acta-view";
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
import { listCatalogSegments, type CatalogSegment } from "@/lib/catalog-api";
import { materialCodeForItem } from "@/lib/material-match";
import { listProductTypes } from "@/lib/product-types-api";
import { listUnits } from "@/lib/units-api";
import {
  cancelProductionRun,
  cancelProductionRunFamily,
  createProcess,
  createProductionRun,
  defineRunAssembly,
  deleteAssemblyRecipe,
  deleteProcess,
  editProductionRunStageWeight,
  finishProductionRunStage,
  getAssemblyRecipe,
  listAssemblyRecipeModelKeys,
  listAssemblyRecipes,
  listProcesses,
  listProductionRuns,
  startProductionRun,
  startProductionRunWithReserved,
  updateProcess,
  updateProductionRunProducts,
  upsertAssemblyRecipe,
} from "@/lib/production-api";
import type { InventoryItem } from "@/types/inventory";
import type { AssemblyRecipe, ProductChoice, ProductionProcess, ProductionRun, ProductionRunStage } from "@/types/production";
import { CaliperScale } from "@/components/ui/caliper-scale";
import { Pager, usePagination } from "@/components/shared/pager";
import { RunStageSummaryTable, RunWasteHero } from "@/components/production/run-stage-summary";
import { StatusBadge } from "@/components/ui/status-badge";
import { ToastNotice } from "@/components/ui/toast-notice";
import { StatusPunch } from "@/components/ui/status-punch";
import { getRunFamily, groupRunFamilies } from "@/lib/orden-produccion";
import { runCurrentStage, runCurrentWeight } from "@/lib/production-run-helpers";
import { useCountUp } from "@/hooks/use-count-up";

type StageForm = {
  name: string;
  description: string;
  phaseName: string;
  stageType: string;
  qualityCheck: string;
  reworkAction: string;
  reworkTargetOrder: string;
  requiresWeighing: boolean;
  ingredients: Array<{ inventoryItemId: string; unitCode: string }>;
};

type ProcessForm = {
  name: string;
  description: string;
  wasteLimitPercent: string;
  stages: StageForm[];
  // Tipos de producto del catálogo que el proceso puede producir (vacío = todos).
  productTypeIds: string[];
};

type FormMode = "create" | "edit";
type UserFormMode = "create" | "edit";

const SYSTEM_ROLES = ["Jefe de producción", "Admin", "Jefe de inventario"];

const MATERIAL_TYPE_LABEL: Record<string, string> = {
  RAW_MATERIAL: "Materia prima",
  COMPLEMENT: "Complemento",
  WASTE: "Merma",
  SUPPLY: "Insumo",
};

const itemTypeLabel = (type: string): string => MATERIAL_TYPE_LABEL[type] ?? type;

const STAGE_TYPES: { value: string; label: string }[] = [
  { value: "PROCESS", label: "Proceso" },
  { value: "THERMAL", label: "Proceso térmico" },
  { value: "CHEMICAL", label: "Proceso químico" },
  { value: "CONTROL", label: "Control / Revisión" },
];

const stageTypeLabel = (value: string): string =>
  STAGE_TYPES.find((type) => type.value === value)?.label ?? value;

const emptyStage = (): StageForm => ({
  name: "",
  description: "",
  phaseName: "",
  stageType: "PROCESS",
  qualityCheck: "",
  reworkAction: "",
  reworkTargetOrder: "",
  requiresWeighing: false,
  ingredients: [],
});

const emptyProcessForm = (): ProcessForm => ({
  name: "",
  description: "",
  wasteLimitPercent: "1",
  stages: [emptyStage()],
  productTypeIds: [],
});

const emptyUserForm = () => ({
  first_name: "",
  last_name: "",
  role: "Admin",
});

function processToForm(process: ProductionProcess): ProcessForm {
  const stages = process.stages.length > 0 ? process.stages : [];
  return {
    name: process.name,
    description: process.description ?? "",
    wasteLimitPercent: process.waste_limit_percent ?? "1",
    stages: stages.length > 0 ? stages.map((stage) => ({
      name: stage.name,
      description: stage.description ?? "",
      phaseName: stage.phase_name ?? "",
      stageType: stage.stage_type ?? "PROCESS",
      qualityCheck: stage.quality_check ?? "",
      reworkAction: stage.rework_action ?? "",
      reworkTargetOrder: stage.rework_target_order ? String(stage.rework_target_order) : "",
      requiresWeighing: stage.requires_weighing,
      ingredients: (stage.ingredients ?? []).map((ing) => ({
        inventoryItemId: String(ing.inventory_item_id),
        unitCode: "",
      })),
    })) : [emptyStage()],
    productTypeIds: (process.product_type_ids ?? []).map(String),
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
const EMPTY_RECIPE_MODEL_KEYS: string[] = [];
const EMPTY_ASSEMBLY_RECIPES: AssemblyRecipe[] = [];
const EMPTY_CATALOG_SEGMENTS: CatalogSegment[] = [];

// Indicador de receta en el picker de "Elegir producto" (modo ENSAMBLAR): sin
// receta muestra el icono apagado; con receta, además de marcarlo, permite
// ver los complementos al pasar el mouse o al hacer clic (queda fijo hasta
// volver a hacer clic). Componente a nivel de módulo para no perder el
// estado de apertura en cada render del picker.
function RecipeBadgeIcon({ recipe }: { recipe: AssemblyRecipe | null }) {
  const [open, setOpen] = useState(false);
  const [pinned, setPinned] = useState(false);
  const [coords, setCoords] = useState<{ top: number; left: number } | null>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  if (!recipe) {
    return (
      <span
        title="Sin receta"
        style={{
          display: "grid",
          placeItems: "center",
          width: 22,
          height: 22,
          borderRadius: 999,
          border: "1px solid var(--muted)",
        }}
      >
        <ScrollText aria-hidden="true" color="var(--muted)" size={13} />
      </span>
    );
  }

  function showPreview() {
    const rect = buttonRef.current?.getBoundingClientRect();
    if (rect) setCoords({ top: rect.bottom + 6, left: Math.max(8, rect.right - 220) });
    setOpen(true);
  }

  return (
    <span style={{ position: "relative", display: "inline-block" }}>
      <button
        ref={buttonRef}
        type="button"
        title="Con receta · clic para ver vista previa"
        onMouseEnter={showPreview}
        onMouseLeave={() => !pinned && setOpen(false)}
        onClick={(event) => {
          stopClick(event);
          setPinned((current) => {
            const next = !current;
            if (next) showPreview();
            else setOpen(false);
            return next;
          });
        }}
        style={{
          display: "grid",
          placeItems: "center",
          width: 22,
          height: 22,
          borderRadius: 999,
          background: "var(--primary-strong, #b3261e)",
          border: "none",
          cursor: "pointer",
          padding: 0,
        }}
      >
        <ScrollText aria-hidden="true" color="#ffffff" size={13} />
      </button>
      {open && coords
        ? createPortal(
            <div
              onClick={stopClick}
              onMouseEnter={() => setOpen(true)}
              onMouseLeave={() => !pinned && setOpen(false)}
              style={{
                position: "fixed",
                top: coords.top,
                left: coords.left,
                zIndex: 1000,
                background: "var(--surface)",
                border: "1px solid var(--border)",
                borderRadius: 8,
                padding: "10px 12px",
                minWidth: 200,
                maxWidth: 260,
                boxShadow: "0 8px 24px rgba(0,0,0,0.22)",
              }}
            >
              <strong style={{ display: "block", marginBottom: 6, fontSize: 12 }}>Receta de ensamble</strong>
              <ul style={{ margin: 0, padding: 0, listStyle: "none", display: "flex", flexDirection: "column", gap: 4 }}>
                {recipe.items.map((item) => (
                  <li
                    key={item.complement_item_id}
                    style={{ fontSize: 12, display: "flex", justifyContent: "space-between", gap: 10 }}
                  >
                    <span>
                      {item.name ?? "—"}
                      {item.material_type ? <span style={{ color: "var(--muted)" }}> · {item.material_type}</span> : null}
                    </span>
                    <span style={{ color: "var(--muted)" }}>
                      {item.quantity}
                      {item.unit_code ? ` ${item.unit_code}` : ""}
                    </span>
                  </li>
                ))}
              </ul>
            </div>,
            document.body,
          )
        : null}
    </span>
  );
}

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
  // Claves de modelo que ya tienen receta de ensamble: filtra los pickers en
  // modo ASIGNAR (esos modelos solo se fabrican por ENSAMBLAR) y, en
  // mantenimiento, el picker de "Crear receta" (solo piezas sin receta aún).
  const { data: recipeModelKeys = EMPTY_RECIPE_MODEL_KEYS } = useQuery({
    queryKey: ["assembly-recipe-model-keys"],
    queryFn: listAssemblyRecipeModelKeys,
    enabled: Boolean(currentUser),
  });
  // Piezas de producto terminado para el picker de "Crear receta" en
  // mantenimiento (misma queryKey que ProductTypesManager, comparten caché).
  const { data: finishedProductsList = EMPTY_RAW_MATERIALS } = useQuery({
    queryKey: ["finished-products"],
    queryFn: () => listInventoryItems("FINISHED_PRODUCT"),
    enabled: Boolean(currentUser) && variant === "maintenance",
  });
  // Segmentos del catálogo (para resolver el código de material de la
  // materia prima elegida): la clave de receta ahora incluye el material.
  // En mantenimiento se usan para decodificar las claves de las recetas.
  const { data: catalogSegments = EMPTY_CATALOG_SEGMENTS } = useQuery({
    queryKey: ["catalog-segments"],
    queryFn: listCatalogSegments,
    enabled: Boolean(currentUser),
  });
  // Recetas completas (con complementos): alimenta la vista de mantenimiento
  // Y el indicador de receta del picker ENSAMBLAR en Crear orden (variant
  // "production") -- antes solo se pedia en mantenimiento, asi que ese
  // indicador SIEMPRE mostraba "Sin receta" fuera de mantenimiento aunque la
  // receta existiera de verdad (bug reportado: recien se veia la data real
  // al abrir el panel de definir receta, que consulta aparte y sin ese gate).
  const { data: assemblyRecipes = EMPTY_ASSEMBLY_RECIPES } = useQuery({
    queryKey: ["assembly-recipes"],
    queryFn: listAssemblyRecipes,
    enabled: Boolean(currentUser),
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
  // Corrida cuya reserva se esta iniciando o liberando (bloquea sus botones).
  const [reservationRunId, setReservationRunId] = useState<string | null>(null);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [isProcessesOpen, setIsProcessesOpen] = useState(false);
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
  const [selectedStageIndex, setSelectedStageIndex] = useState(0);
  const [isIngredientPickerOpen, setIsIngredientPickerOpen] = useState(false);
  const [viewingProcess, setViewingProcess] = useState<ProductionProcess | null>(null);
  const [viewingUser, setViewingUser] = useState<ManagedUser | null>(null);
  const [generatedCredentials, setGeneratedCredentials] = useState<{
    title: string;
    username: string;
    email: string;
    role: string;
    temporaryPassword: string;
  } | null>(null);
  const [selectedProcessId, setSelectedProcessId] = useState("");
  const [selectedMaterialId, setSelectedMaterialId] = useState("");
  const [runQuantity, setRunQuantity] = useState("1");
  // Cantidad a usar de cada insumo configurado en las etapas activas del
  // proceso elegido, tecleada al crear la orden (clave = id de la fila de
  // configuracion ProductionProcessStageIngredient).
  const [stageIngredientQuantities, setStageIngredientQuantities] = useState<Record<string, string>>({});
  const [stageWeights, setStageWeights] = useState<Record<string, string>>({});
  const [stageChoice, setStageChoice] = useState<Record<string, "PASS" | "REJECT">>({});
  const [rejectJustification, setRejectJustification] = useState("");
  const [isRunStagesOpen, setIsRunStagesOpen] = useState(false);
  const [selectedRunForStages, setSelectedRunForStages] = useState<ProductionRun | null>(null);
  const [cancelRun, setCancelRun] = useState<ProductionRun | null>(null);
  const [cancelRunReason, setCancelRunReason] = useState("");
  const [isCancellingRun, setIsCancellingRun] = useState(false);
  // Cancelar TODA la familia (raiz + hijas de split) de una vez -- para cuando
  // un split arranco solo una parte y el resto ya no tiene sentido esperar.
  const [cancelFamilyRuns, setCancelFamilyRuns] = useState<ProductionRun[] | null>(null);
  const [cancelFamilyReason, setCancelFamilyReason] = useState("");
  const [isCancellingFamily, setIsCancellingFamily] = useState(false);
  const [editingStageId, setEditingStageId] = useState<string | null>(null);
  const [editWeightValue, setEditWeightValue] = useState("");
  const [isSavingStageWeight, setIsSavingStageWeight] = useState(false);
  const [showResponsables, setShowResponsables] = useState(false);
  const [isCreateOrderOpen, setIsCreateOrderOpen] = useState(false);
  // Modo de destino del resultante: asignar a una pieza/tipo existente o
  // ensamblar un único producto final (usa la cantidad de la orden).
  const [assemblyMode, setAssemblyMode] = useState<"ASIGNAR" | "ENSAMBLAR">("ASIGNAR");
  // Producto único elegido con los pickers (pieza o tipo de catálogo).
  const [orderProduct, setOrderProduct] = useState<ProductChoice | null>(null);
  // Receta de ensamble del producto elegido en ENSAMBLAR (complementos +
  // cantidad por unidad); se usa para calcular la solicitud automática. `key`
  // identifica el producto que la originó (targetItemId o productTypeId) para
  // no enviar al submit una receta de una selección anterior/obsoleta.
  const [orderRecipe, setOrderRecipe] = useState<{ key: string; recipe: AssemblyRecipe } | null>(null);
  // Evita condiciones de carrera: cada búsqueda de receta incrementa este
  // contador y solo aplica su resultado si sigue siendo la más reciente.
  const recipeLookupSeq = useRef(0);
  // Tipo de producto para el que se está definiendo la receta (modal abierta
  // cuando no es null). Las filas empiezan vacías.
  const [recipeModalModelKey, setRecipeModalModelKey] = useState<string | null>(null);
  const [recipeLines, setRecipeLines] = useState<Array<{ itemId: string; label: string; unitCode: string; perUnit: string }>>([]);
  const [isRecipeComplementPickerOpen, setIsRecipeComplementPickerOpen] = useState(false);
  // Origen de la modal de receta: "order" = flujo de Crear orden (ENSAMBLAR,
  // toca orderProduct/orderRecipe); "maintenance" = tile "Crear receta" (no
  // debe tocar el estado de la orden en curso).
  const [recipeModalContext, setRecipeModalContext] = useState<"order" | "maintenance">("order");
  // Picker de pieza abierto desde el tile "Crear receta" de mantenimiento.
  const [isMaintenanceRecipePickerOpen, setIsMaintenanceRecipePickerOpen] = useState(false);
  // Modal "Recetas" de mantenimiento: lista las recetas de ensamble existentes.
  const [isRecipesViewOpen, setIsRecipesViewOpen] = useState(false);
  const [editPlanRun, setEditPlanRun] = useState<ProductionRun | null>(null);
  const [editPlanProduct, setEditPlanProduct] = useState<ProductChoice | null>(null);
  // Orden a la que se le esta definiendo el ensamble (complementos APROBADOS
  // + cantidad por unidad); se cierra a null tras guardar o cancelar.
  const [assemblyRun, setAssemblyRun] = useState<ProductionRun | null>(null);
  const [assemblyLines, setAssemblyLines] = useState<Array<{ itemId: string; perUnit: string }>>([]);
  // Picker de pieza/tipo abierto: "create" = modal Crear orden, "edit" = modal
  // Editar producto resultante.
  const [itemPickerFor, setItemPickerFor] = useState<"create" | "edit" | null>(null);
  const [typePickerFor, setTypePickerFor] = useState<"create" | "edit" | null>(null);
  // Pestaña activa del picker de producto en modo ASIGNAR: productos
  // terminados o complementos (la joyeria fabrica sus propios complementos).
  const [assignPickerTab, setAssignPickerTab] = useState<"PRODUCTOS" | "COMPLEMENTOS">("PRODUCTOS");
  // Tick por minuto para el tiempo transcurrido de las ordenes en proceso.
  const [nowTick, setNowTick] = useState(() => Date.now());
  useEffect(() => {
    const timer = setInterval(() => setNowTick(Date.now()), 60000);
    return () => clearInterval(timer);
  }, []);
  const [isStatsModalOpen, setIsStatsModalOpen] = useState(false);
  const [selectedStatsRun, setSelectedStatsRun] = useState<ProductionRun | null>(null);
  // Acta editable: disponible en cualquier etapa de la orden y tambien
  // despues de recibida (ver ActaView).
  const [actaRun, setActaRun] = useState<ProductionRun | null>(null);
  // Ritual automatico al terminar la ultima etapa: 1) si queda sobrante de
  // complementos por devolver, se pide (opcional) antes que nada; 2) se abre
  // la acta como quedaria, con opcion a entregar material faltante o corregir
  // algo mal tipeado; 3) recien ahi el resumen/reporte de merma de siempre.
  const [postFinishReturnRun, setPostFinishReturnRun] = useState<ProductionRun | null>(null);
  const [isPostFinishActa, setIsPostFinishActa] = useState(false);
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

  const selectedStage = form.stages[selectedStageIndex] ?? form.stages[0];

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
    setPostFinishReturnRun((current) => (current ? runs.find((run) => run.id === current.id) ?? null : current));
  }, [runs]);

  // Si ya no queda nada por devolver (se devolvio todo dentro de esta misma
  // ventana), el paso 1 del ritual automatico no tiene mas sentido -- sigue
  // solo al paso 2 (acta) en vez de quedar con la ventana vacia esperando un
  // clic en "Continuar".
  useEffect(() => {
    if (postFinishReturnRun && buildReturnCandidates(postFinishReturnRun).length === 0) {
      continueFromReturnStep();
    }
  }, [postFinishReturnRun]);


  // Cambiar el material con un producto ya elegido en ENSAMBLAR: la clave de
  // receta depende del material, así que hay que volver a resolverla.
  useEffect(() => {
    if (assemblyMode === "ENSAMBLAR" && orderProduct) {
      void loadOrderRecipeForChoice(orderProduct);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedMaterialId]);

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
  const selectedProcess = processes.find((process) => process.id === selectedProcessId) ?? null;
  const selectedMaterial = rawMaterials.find((item) => item.id === selectedMaterialId) ?? null;
  // Insumos configurados en las etapas activas del proceso elegido: se piden
  // obligatorios al crear la orden, igual que los complementos.
  const configuredStageIngredients = (selectedProcess?.stages ?? []).flatMap((stage) =>
    (stage.ingredients ?? []).map((ing) => ({
      configId: ing.id,
      stageName: stage.name,
      inventoryItemId: ing.inventory_item_id,
    })),
  );
  // Código de material (1 dígito) de la materia prima elegida: la clave de
  // receta ahora es material+categoria+modelo. Sin material elegido no se
  // puede saber qué piezas/tipos ya tienen receta, así que no se excluye
  // nada (mejor mostrar de más que ocultar sin poder saberlo).
  const orderMaterialCode = materialCodeForItem(selectedMaterial, catalogSegments);

  const approvedMaterialRuns = runs.filter((run) => run.status === "MATERIALES_APROBADOS");
  const inProgressRuns = runs.filter((run) => run.status === "EN_PROCESO");
  // Ordenes migradas del Excel historico (event_lines no vacio) no son
  // trabajo activo de piso: no deben aparecer en las vistas operativas de
  // Produccion (terminados/recibidos/pendientes), solo existen para su
  // certificado en Documentos.
  const finishedRuns = runs.filter(
    (run) => (run.status === "PENDIENTE_RECEPCION" || run.status === "RECIBIDA") && (run.event_lines ?? []).length === 0
  );
  const waitingMaterialRuns = runs.filter((run) => run.status === "ESPERANDO_MATERIAL");
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
        {run.status === "MATERIALES_APROBADOS" ? (
          <button
            className="button buttonPrimary"
            disabled={isSaving}
            onClick={() => void handleStartApprovedRun(run)}
            type="button"
          >
            <Play aria-hidden="true" size={14} />
            Iniciar
          </button>
        ) : null}
        {run.status === "EN_PROCESO" ? (
          <button className="button buttonPrimary" onClick={() => openRunStagesModal(run)} type="button">
            Gestionar
          </button>
        ) : null}
        {run.status === "PENDIENTE_RECEPCION" || run.status === "RECIBIDA" ? (
          <>
            {run.assembly_pending ? (
              <button className="button buttonPrimary" onClick={() => openAssemblyModal(run)} type="button">
                <Puzzle aria-hidden="true" size={14} />
                Definir ensamble
              </button>
            ) : null}
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

  function canManageStage(stage: ProductionRunStage, index: number, stages: ProductionRunStage[]) {
    if (stage.status === "FINALIZADA" || stage.status === "EN_PROCESO") {
      return stage.status === "EN_PROCESO";
    }
    const previousStages = stages.slice(0, index);
    return previousStages.every((previousStage) => previousStage.status === "FINALIZADA");
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

  function openEditStageWeight(stage: ProductionRunStage) {
    setEditingStageId(stage.id);
    setEditWeightValue(stage.final_weight != null ? String(stage.final_weight) : "");
  }

  function closeEditStageWeight() {
    setEditingStageId(null);
    setEditWeightValue("");
  }

  // Correccion de peso fuera de condicion (merma > limite): mismo patron que
  // approveStage en el flujo normal -- un modal de confirmacion con botones,
  // nunca un guardado silencioso. Al confirmar, el backend deja el mismo
  // rastro que "pasar igualmente" una etapa (ProductionRunStageDecision,
  // weight_based=True) -- ver edit_stage_weight.
  function stageWeightEditFailsCondition(stage: ProductionRunStage, current: number): { fails: boolean; reason: string } {
    const reference = stageReferenceWeight(stage);
    const limit = Number(selectedRunForStages?.waste_limit_percent ?? 0);
    if (!(reference > 0) || !Number.isFinite(current) || current < 0 || current > reference) {
      return { fails: false, reason: "" };
    }
    const loss = ((reference - current) / reference) * 100;
    if (loss > limit) {
      return { fails: true, reason: `La correccion implica una pérdida de ${loss.toFixed(2)}% (supera el límite ${limit.toFixed(2)}%).` };
    }
    return { fails: false, reason: "" };
  }

  async function saveStageWeight(stage: ProductionRunStage, value: string, justification?: string) {
    setError(null);
    setIsSavingStageWeight(true);
    try {
      await editProductionRunStageWeight(stage.id, { final_weight: value, justification: justification ?? null });
      setSuccess("Peso corregido.");
      closeEditStageWeight();
      await reload();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "No se pudo corregir el peso.");
    } finally {
      setIsSavingStageWeight(false);
    }
  }

  async function handleSaveStageWeight(stage: ProductionRunStage) {
    const value = editWeightValue.trim();
    if (!value) {
      setError("Ingresa el peso corregido.");
      return;
    }
    const check = stageWeightEditFailsCondition(stage, Number(value));
    if (check.fails) {
      showConfirm(
        "Peso fuera de la condición",
        `${check.reason} ¿Deseas guardar la corrección igualmente? Quedará registrado.`,
        () => void saveStageWeight(stage, value, check.reason),
        false,
        "Guardar igualmente"
      );
      return;
    }
    await saveStageWeight(stage, value);
  }

  function openStatsModal(run: ProductionRun) {
    // Mismo motivo que openRunStagesModal: no dejar la ventana de partes atras.
    setFamilyRuns(null);
    setSelectedStatsRun(run);
    setShowResponsables(false);
    setIsStatsModalOpen(true);
  }

  // Abre "Definir ensamble": semilla de filas desde los complementos APROBADA
  // de la orden, con "por unidad" vacio para que el jefe de produccion lo llene.
  function openAssemblyModal(run: ProductionRun) {
    const approved = (run.complements ?? []).filter((complement) => complement.status === "APROBADA");
    setAssemblyLines(approved.map((complement) => ({ itemId: complement.item_id, perUnit: "" })));
    setAssemblyRun(run);
  }

  function closeAssemblyModal() {
    setAssemblyRun(null);
    setAssemblyLines([]);
  }

  async function handleDefineAssembly() {
    if (!assemblyRun) return;
    const lines = assemblyLines.filter((line) => Number(line.perUnit) > 0);
    if (lines.length === 0) return;
    if (lines.some((line) => (line.perUnit.split(".")[1]?.length ?? 0) > 4)) {
      setError("Máximo 4 decimales.");
      return;
    }
    setError(null);
    setSuccess(null);
    setIsSaving(true);
    try {
      await defineRunAssembly(
        assemblyRun.id,
        lines.map((line) => ({ complement_item_id: line.itemId, quantity: line.perUnit })),
      );
      setSuccess("Ensamble definido. La receta quedó guardada para el futuro.");
      closeAssemblyModal();
      await reload();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "No se pudo definir el ensamble.");
    } finally {
      setIsSaving(false);
    }
  }

  function closeStatsModal() {
    setIsStatsModalOpen(false);
    setSelectedStatsRun(null);
  }

  // Paso 1 -> 2 del ritual automatico al terminar produccion: de devolver
  // sobrante (opcional) se pasa a la acta.
  function continueFromReturnStep() {
    const run = postFinishReturnRun;
    setPostFinishReturnRun(null);
    if (run) {
      setIsPostFinishActa(true);
      setActaRun(run);
    }
  }

  // Paso 2 -> 3: al cerrar la acta abierta por el ritual automatico, recien
  // ahi se abre el resumen/reporte de merma de siempre (flujo normal). Si la
  // acta se abrio a mano ("Ver acta"), isPostFinishActa es false y solo cierra.
  function closeActaModal() {
    const run = actaRun;
    setActaRun(null);
    if (isPostFinishActa) {
      setIsPostFinishActa(false);
      if (run) openStatsModal(run);
    }
  }

  const currentHistoryMonth = historyMonth || (new Date().toISOString().slice(0, 7));
  const historyDays = buildCalendarDays(currentHistoryMonth);
  const selectedDateRuns = selectedHistoryDate
    ? finishedRuns.filter((run) => (run.finished_at ?? "").slice(0, 10) === selectedHistoryDate)
    : [];
  // Historial por calendario: 4 procesos por página, la ventana no se estira.
  const historyRunsPager = usePagination(selectedDateRuns, 4, selectedHistoryDate);

  function openCreateForm() {
    setForm(emptyProcessForm());
    setSelectedStageIndex(0);
    setFormMode("create");
    setEditingProcessId(null);
    setReturnToProcesses(false);
    setError(null);
    setSuccess(null);
    setIsFormOpen(true);
  }

  function openEditForm(process: ProductionProcess) {
    setForm(processToForm(process));
    setSelectedStageIndex(0);
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

  function addStage() {
    setForm((current) => {
      const nextStages = [...current.stages, emptyStage()];
      setSelectedStageIndex(nextStages.length - 1);
      return { ...current, stages: nextStages };
    });
  }

  function removeCurrentStage() {
    setForm((current) => {
      if (current.stages.length === 1) return current;
      const nextStages = current.stages.filter((_, index) => index !== selectedStageIndex);
      setSelectedStageIndex((currentIndex) => Math.max(0, Math.min(currentIndex, nextStages.length - 1)));
      return { ...current, stages: nextStages };
    });
  }

  function addStageIngredient(item: InventoryItem) {
    updateStage({
      ingredients: [...selectedStage.ingredients, { inventoryItemId: item.id, unitCode: item.unit_code }],
    });
    setIsIngredientPickerOpen(false);
  }

  function updateStage(fieldOrPatch: keyof StageForm | Partial<StageForm>, value?: string | boolean | Array<{ inventoryItemId: string; unitCode: string }>) {
    setForm((current) => ({
      ...current,
      stages: current.stages.map((stage, index) => {
        if (index !== selectedStageIndex) return stage;
        if (typeof fieldOrPatch === "string") {
          return { ...stage, [fieldOrPatch]: value };
        }
        return { ...stage, ...fieldOrPatch };
      }),
    }));
  }

  function buildPayload() {
    const processName = form.name.trim();

    if (!processName) {
      throw new Error("El nombre del proceso es obligatorio.");
    }
    if (form.stages.some((stage) => !stage.name.trim())) {
      throw new Error("Todas las etapas agregadas deben tener nombre.");
    }

    return {
      name: processName,
      description: form.description.trim() || null,
      version: 1,
      waste_limit_percent: "1",
      is_active: true,
      product_type_ids: form.productTypeIds,
      stages: form.stages.map((stage, index) => ({
        name: stage.name.trim(),
        description: stage.description.trim() || null,
        phase_name: stage.phaseName.trim() || null,
        stage_type: stage.stageType || "PROCESS",
        quality_check: stage.qualityCheck.trim() || null,
        rework_action: stage.reworkAction.trim() || null,
        rework_target_order: stage.reworkTargetOrder ? Number(stage.reworkTargetOrder) : null,
        order: index + 1,
        requires_weighing: stage.requiresWeighing,
        is_active: true,
        ingredients: stage.ingredients
          .filter((ing) => ing.inventoryItemId)
          .map((ing) => ({
            inventory_item_id: ing.inventoryItemId,
          })),
      })),
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
      if (formMode === "edit" && returnToProcesses) {
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
  function productRowToPayload(product: ProductChoice, quantity: string) {
    const payload: { product_type_id?: string; target_item_id?: string; quantity: string } = { quantity };
    if (product.targetItemId) payload.target_item_id = product.targetItemId;
    else if (product.productTypeId) payload.product_type_id = product.productTypeId;
    return payload;
  }

  async function handleCreateProductionOrder() {
    if (!selectedProcess) {
      setError("Selecciona un proceso para producir.");
      return;
    }
    if (!runQuantity || Number(runQuantity) <= 0) {
      setError("Ingresa una cantidad valida para fabricar.");
      return;
    }
    if (!selectedMaterialId) {
      setError("Selecciona la materia prima con la que se fabricará esta orden.");
      return;
    }

    if (!orderProduct || (!orderProduct.targetItemId && !orderProduct.productTypeId)) {
      setError(
        assemblyMode === "ENSAMBLAR"
          ? "Elige el producto final a ensamblar."
          : "Elige el producto a fabricar."
      );
      return;
    }

    const missingIngredient = configuredStageIngredients.find(
      (ing) => !(Number(stageIngredientQuantities[ing.configId]) > 0),
    );
    if (missingIngredient) {
      setError("Ingresa la cantidad de todos los insumos de este proceso.");
      return;
    }

    const productsPayload = [productRowToPayload(orderProduct, runQuantity)];

    // ASIGNAR no solicita complementos. ENSAMBLAR usa las cantidades totales
    // definidas a mano en orderRecipe (formulario editable, ver Task 15) --
    // nunca se calculan solas multiplicando por la cantidad de la orden.
    let complementsPayload: Array<{ item_id: string; quantity: string }> = [];
    if (assemblyMode === "ENSAMBLAR") {
      const productKey = orderProduct.targetItemId ?? orderProduct.productTypeId;
      if (!orderRecipe || orderRecipe.key !== productKey || orderRecipe.recipe.items.length === 0) {
        setError("Este producto necesita complementos definidos para ensamblar.");
        return;
      }
      complementsPayload = orderRecipe.recipe.items.map((item) => ({
        item_id: item.complement_item_id,
        quantity: String(Number(item.quantity)),
      }));
    }

    const stageIngredientsPayload = configuredStageIngredients.map((ing) => ({
      process_stage_ingredient_id: ing.configId,
      quantity: stageIngredientQuantities[ing.configId],
    }));

    setError(null);
    setSuccess(null);
    setIsSaving(true);
    try {
      await createProductionRun({
        process_id: selectedProcess.id,
        quantity: runQuantity,
        raw_material_item_id: selectedMaterialId,
        assembly_mode: assemblyMode,
        products: productsPayload,
        complements: complementsPayload,
        stage_ingredients: stageIngredientsPayload,
      });
      setSuccess("Orden creada. Inventario debe aprobar la salida de materia prima y complementos.");
      setIsCreateOrderOpen(false);
      resetCreateOrderState();
      await reload();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "No se pudo crear la orden de produccion.");
    } finally {
      setIsSaving(false);
    }
  }

  async function handleStartApprovedRun(run: ProductionRun) {
    setError(null);
    setSuccess(null);
    setIsSaving(true);
    try {
      await startProductionRun(run.id);
      setSuccess("Produccion iniciada.");
      await reload();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "No se pudo iniciar la produccion.");
    } finally {
      setIsSaving(false);
    }
  }

  /** Reserva completa: recien aqui se consume de verdad y arranca la orden. */
  async function handleStartReserved(run: ProductionRun) {
    setError(null);
    setSuccess(null);
    setReservationRunId(run.id);
    try {
      await startProductionRunWithReserved(run.id);
      setSuccess(`Produccion iniciada con el material reservado (${run.production_code ?? ""}).`);
      await reload();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "No se pudo iniciar con lo reservado.");
    } finally {
      setReservationRunId(null);
    }
  }


  async function handleFinishStage(
    stage: ProductionRunStage,
    options: { decision?: "APPROVED" | "REJECTED"; justification?: string } = {}
  ) {
    setError(null);
    setSuccess(null);
    setIsSaving(true);
    try {
      const finalWeight = stageWeights[stage.id]?.trim() || null;
      const updatedRun = await finishProductionRunStage(stage.id, {
        final_weight: finalWeight,
        decision: options.decision,
        justification: options.justification,
      });
      setStageWeights((current) => ({ ...current, [stage.id]: "" }));
      setStageChoice((current) => {
        const next = { ...current };
        delete next[stage.id];
        return next;
      });
      setRejectJustification("");
      setSuccess(
        options.decision === "REJECTED"
          ? "Etapa rechazada. La produccion regreso a la etapa correspondiente."
          : "Etapa registrada correctamente."
      );
      await reload();
      if (updatedRun.status === "PENDIENTE_RECEPCION") {
        // Última fase terminada: se cierra el detalle de etapas.
        setSelectedRunForStages(null);
        setSuccess("Producción finalizada. Pendiente de recepción en inventario.");
        // Es UNA sola acta por familia (padre + hijas de split): el ritual
        // automatico (devolver sobrante -> acta) solo tiene sentido cuando
        // la ULTIMA pierna termina. Si otra pierna de la misma orden sigue
        // EN_PROCESO, la acta de esta corrida por si sola esta incompleta
        // (le falta lo que la otra pierna todavia no entrego/recibio) --
        // mostrarla ahi confunde mas de lo que ayuda (bug reportado).
        const nextRuns = await listProductionRuns();
        const family = getRunFamily(nextRuns, updatedRun);
        const familyFinished = family.every(
          (member) => member.finished_at !== null || member.status === "CANCELADA"
        );
        if (familyFinished) {
          if (buildReturnCandidates(updatedRun).length > 0) {
            setPostFinishReturnRun(updatedRun);
          } else {
            setIsPostFinishActa(true);
            setActaRun(updatedRun);
          }
        }
        return;
      }
      if (options.decision === "REJECTED") {
        // Volver en pantalla a la tarjeta de la etapa destino.
        const targetOrder = stage.rework_target_order ?? (stage.stage_order > 1 ? stage.stage_order - 1 : stage.stage_order);
        setStageModalDir("left");
        setStageModalKey((k) => k + 1);
        setStageModalIndex(Math.max(0, targetOrder - 1));
      } else if (selectedRunForStages && selectedRunForStages.stages.length > 1) {
        // Auto-avanzar a la siguiente etapa.
        const total = selectedRunForStages.stages.length;
        const next = Math.min(stageModalIndex + 1, total - 1);
        if (next !== stageModalIndex) {
          setStageModalDir("right");
          setStageModalKey((k) => k + 1);
          setStageModalIndex(next);
        }
      }
    } catch (nextError) {
      const message = nextError instanceof Error ? nextError.message : "No se pudo finalizar la etapa.";
      setError(message);
    } finally {
      setIsSaving(false);
    }
  }

  function stageRequiresDecision(stage: ProductionRunStage) {
    return stage.stage_type === "DECISION" || stage.stage_type === "CONTROL" || Boolean(stage.quality_check);
  }

  // Peso de referencia: el peso final de la etapa pesada anterior, o el material total.
  function stageReferenceWeight(stage: ProductionRunStage): number {
    const run = selectedRunForStages;
    if (!run) return 0;
    const prior = run.stages
      .filter((s) => s.stage_order < stage.stage_order && s.final_weight !== null)
      .sort((a, b) => a.stage_order - b.stage_order);
    const last = prior[prior.length - 1];
    if (last?.final_weight) return Number(last.final_weight);
    return Number(run.total_required_material ?? 0);
  }

  // ¿El peso registrado incumple la condición (pérdida sobre el límite de merma)?
  function stageWeightFailsCondition(stage: ProductionRunStage): { fails: boolean; reason: string } {
    if (!stage.requires_weighing) return { fails: false, reason: "" };
    const current = Number(stageWeights[stage.id]);
    const reference = stageReferenceWeight(stage);
    const limit = Number(selectedRunForStages?.waste_limit_percent ?? 0);
    if (!(reference > 0) || !Number.isFinite(current) || current < 0) return { fails: false, reason: "" };
    const loss = ((reference - current) / reference) * 100;
    if (loss > limit) {
      return { fails: true, reason: `Peso ${current} implica una pérdida de ${loss.toFixed(2)}% (supera el límite ${limit.toFixed(2)}%).` };
    }
    return { fails: false, reason: "" };
  }

  function selectStageChoice(stage: ProductionRunStage, choice: "PASS" | "REJECT") {
    if (choice === "REJECT") {
      setRejectJustification(stageWeightFailsCondition(stage).reason);
    }
    setStageChoice((current) => ({ ...current, [stage.id]: choice }));
  }

  function clearStageChoice(stageId: string) {
    setStageChoice((current) => {
      const next = { ...current };
      delete next[stageId];
      return next;
    });
    setRejectJustification("");
  }

  // Aprobar/finalizar; si el peso no cumple la condición, confirmar el override.
  function approveStage(stage: ProductionRunStage, decision?: "APPROVED") {
    const check = stageWeightFailsCondition(stage);
    const run = () => void handleFinishStage(stage, decision ? { decision } : {});
    if (check.fails) {
      showConfirm(
        "Peso fuera de la condición",
        `${check.reason} ¿Deseas pasar la etapa igualmente? Quedará registrado.`,
        run,
        false,
        "Pasar igualmente"
      );
      return;
    }
    run();
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

  // Control de producto único compartido por la modal Crear orden y la modal
  // Editar producto resultante: botón "Elegir producto" que abre el picker de
  // piezas, o "Cambiar" una vez ya hay uno elegido.
  function renderProductChooser(current: ProductChoice | null, onOpenPicker: () => void) {
    return (
      <div className="materialRow">
        <button
          className="button"
          onClick={onOpenPicker}
          style={{ flex: 1, justifyContent: "flex-start" }}
          type="button"
        >
          {current?.label || "Elegir producto"}
        </button>
        {current?.label ? (
          <button className="button" onClick={onOpenPicker} type="button">
            Cambiar
          </button>
        ) : null}
      </div>
    );
  }

  // Tras elegir producto en modo ENSAMBLAR: consulta su receta. La clave de
  // receta ahora incluye el material de la orden, así que sin material
  // elegido no se puede resolver: se avisa y se limpia la selección. Sin
  // receta y con tipo resoluble, abre la modal para crearla; sin tipo
  // resoluble, no se puede ensamblar y se limpia la selección.
  async function loadOrderRecipeForChoice(choice: ProductChoice) {
    setError(null);
    if (!selectedMaterialId) {
      setError("Elige primero el material.");
      setOrderProduct(null);
      setOrderRecipe(null);
      return;
    }
    const seq = ++recipeLookupSeq.current;
    try {
      const recipe = choice.targetItemId
        ? await getAssemblyRecipe({ itemId: choice.targetItemId, materialItemId: selectedMaterialId })
        : await getAssemblyRecipe({ productTypeId: choice.productTypeId, materialItemId: selectedMaterialId });

      if (seq !== recipeLookupSeq.current) return;

      if (!recipe.model_key) {
        setError("Esta pieza no tiene tipo en el catálogo: usa Asignar.");
        setOrderProduct(null);
        setOrderRecipe(null);
        return;
      }
      // Siempre se pide escribir la cantidad de nuevo, aunque ya exista una
      // receta previa: solo se reusa la LISTA de complementos (cuales hacen
      // falta), nunca el valor guardado -- Rodrigo: no debe salir con el
      // ultimo valor, debe salir vacio para llenarlo de nuevo cada vez.
      setOrderRecipe(null);
      setRecipeLines(
        recipe.items.map((item) => ({
          itemId: item.complement_item_id,
          label: item.name ?? "Complemento",
          unitCode: item.unit_code ?? "",
          perUnit: "",
        })),
      );
      setRecipeModalContext("order");
      setRecipeModalModelKey(recipe.model_key);
    } catch (nextError) {
      if (seq !== recipeLookupSeq.current) return;
      setError(nextError instanceof Error ? nextError.message : "No se pudo cargar la receta.");
      setOrderProduct(null);
      setOrderRecipe(null);
    }
  }

  // Aplica la selección de un picker (pieza o tipo) al producto único de la
  // modal correspondiente ("create" = Crear orden, "edit" = Editar producto).
  function applyProductChoice(kind: "create" | "edit", patch: ProductChoice) {
    if (kind === "create") {
      setOrderProduct(patch);
      setOrderRecipe(null);
      if (assemblyMode === "ENSAMBLAR") {
        void loadOrderRecipeForChoice(patch);
      }
    } else {
      setEditPlanProduct(patch);
    }
  }

  // Abre el picker correcto para el producto de "Crear orden": tipo del
  // catálogo en ENSAMBLAR (la receta depende del material+tipo, no de una
  // pieza puntual), pieza/tipo existente en ASIGNAR.
  function handleOpenProductPicker() {
    if (assemblyMode === "ENSAMBLAR") {
      setTypePickerFor("create");
    } else {
      setAssignPickerTab("PRODUCTOS");
      setItemPickerFor("create");
    }
  }

  // Cambiar de modo limpia el producto elegido y su receta: en ASIGNAR se
  // destina a una pieza/tipo existente, en ENSAMBLAR es el producto final que
  // arrastra la receta de complementos que lo ensambla.
  function handleAssemblyModeChange(mode: "ASIGNAR" | "ENSAMBLAR") {
    if (mode === assemblyMode) return;
    recipeLookupSeq.current += 1;
    setAssemblyMode(mode);
    setOrderProduct(null);
    setOrderRecipe(null);
    setRecipeModalModelKey(null);
    setRecipeLines([]);
  }

  // Cierra la modal de crear orden: limpia producto, modo, cantidad, receta y
  // pickers abiertos para esa modal. Se usa en éxito y en el botón X.
  function resetCreateOrderState() {
    recipeLookupSeq.current += 1;
    setOrderProduct(null);
    setAssemblyMode("ASIGNAR");
    setRunQuantity("1");
    setStageIngredientQuantities({});
    setOrderRecipe(null);
    setRecipeModalModelKey(null);
    setRecipeLines([]);
    setIsRecipeComplementPickerOpen(false);
    setItemPickerFor((current) => (current === "create" ? null : current));
    setTypePickerFor((current) => (current === "create" ? null : current));
  }

  // Cierra la modal de receta. clearProduct=true (X/Cancelar): sin receta no
  // hay ensamble, así que se limpia también la selección de producto — pero
  // solo si la modal se abrió desde Crear orden; desde mantenimiento no hay
  // producto de orden que limpiar.
  function closeRecipeModal(clearProduct: boolean) {
    setRecipeModalModelKey(null);
    setRecipeLines([]);
    setIsRecipeComplementPickerOpen(false);
    if (clearProduct && recipeModalContext === "order") {
      setOrderProduct(null);
      setOrderRecipe(null);
    }
    setRecipeModalContext("order");
  }

  function addRecipeLine(item: InventoryItem) {
    setRecipeLines((current) => [...current, { itemId: item.id, label: item.name, unitCode: item.unit_code, perUnit: "" }]);
    setIsRecipeComplementPickerOpen(false);
  }

  function removeRecipeLine(itemId: string) {
    setRecipeLines((current) => current.filter((line) => line.itemId !== itemId));
  }

  function updateRecipeLinePerUnit(itemId: string, value: string) {
    setRecipeLines((current) =>
      current.map((line) => (line.itemId === itemId ? { ...line, perUnit: value } : line))
    );
  }

  async function handleSaveRecipe() {
    if (!recipeModalModelKey) return;
    if (recipeLines.length === 0 || recipeLines.some((line) => !(Number(line.perUnit) > 0))) {
      setError("Completa la cantidad de todos los complementos (o quita los que sobren).");
      return;
    }
    if (recipeLines.some((line) => (line.perUnit.split(".")[1]?.length ?? 0) > 4)) {
      setError("Máximo 4 decimales.");
      return;
    }

    setError(null);
    setSuccess(null);
    setIsSaving(true);
    try {
      const saved = await upsertAssemblyRecipe(
        recipeModalModelKey,
        recipeLines.map((line) => ({ complement_item_id: line.itemId, quantity: line.perUnit })),
      );
      if (recipeModalContext === "order") {
        const key = orderProduct ? orderProduct.targetItemId ?? orderProduct.productTypeId ?? recipeModalModelKey : recipeModalModelKey;
        setOrderRecipe({ key, recipe: saved });
      }
      setRecipeModalModelKey(null);
      setRecipeLines([]);
      setRecipeModalContext("order");
      setSuccess("Complementos guardados.");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["assembly-recipe-model-keys"] }),
        queryClient.invalidateQueries({ queryKey: ["assembly-recipes"] }),
      ]);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "No se pudo guardar la receta.");
    } finally {
      setIsSaving(false);
    }
  }

  async function handleDeleteRecipe(modelKey: string) {
    setError(null);
    setSuccess(null);
    try {
      await deleteAssemblyRecipe(modelKey);
      setSuccess("Receta eliminada.");
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ["assembly-recipe-model-keys"] }),
        queryClient.invalidateQueries({ queryKey: ["assembly-recipes"] }),
      ]);
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "No se pudo eliminar la receta.");
    }
  }

  // Describe la clave de una receta (material+categoría+modelo, 7 dígitos):
  // prefiere la pieza de inventario con ese código de producto; si no hay
  // pieza, decodifica la clave contra el catálogo de segmentos.
  function describeRecipeKey(key: string): { product: string; material: string } {
    const material =
      catalogSegments.find((segment) => segment.kind === "MATERIAL" && segment.code === key.slice(0, 1))?.label ??
      `Material ${key.slice(0, 1)}`;
    const piece = finishedProductsList.find((item) => item.product_code === key);
    if (piece) {
      const description = piece.description?.trim();
      return { product: description ? description : piece.name, material };
    }
    const model = catalogSegments.find(
      (segment) => segment.kind === "MODEL" && segment.parent_code === key.slice(1, 3) && segment.code === key.slice(3),
    );
    const category = catalogSegments.find((segment) => segment.kind === "CATEGORY" && segment.code === key.slice(1, 3));
    return { product: model?.label ?? category?.label ?? key, material };
  }

  // Ids de tipos permitidos para el CatalogProductPicker según modal (el
  // proceso/orden declara qué produce; [] = sin restricción, permite crear).
  // La exclusión de tipos con receta (solo se fabrican por ENSAMBLAR) se
  // aplica aparte con excludeTypeIds, sin tocar esta semántica.
  function allowedTypeIdsForPicker(kind: "create" | "edit"): string[] {
    return kind === "create"
      ? selectedProcess?.product_type_ids ?? []
      : editPlanRun?.allowed_product_type_ids ?? [];
  }

  // Contadores animados de la barra de metricas de produccion.
  const pendingInventoryCount = useCountUp(countOrders(runs.filter((r) => r.status === "PENDIENTE_INVENTARIO")));
  const waitingMaterialCount = useCountUp(countOrders(waitingMaterialRuns));
  const approvedMaterialCount = useCountUp(countOrders(approvedMaterialRuns));
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
              <button className="maintenanceTile" disabled={currentUser !== null && !canCreate} onClick={openCreateForm} type="button">
                <Factory aria-hidden="true" size={22} />
                <strong>Crear proceso</strong>
                <span>Nombre del proceso y etapas configurables.</span>
              </button>
              <button
                className="maintenanceTile"
                onClick={() => setIsProcessesOpen(true)}
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

          <section className="maintenanceSection" aria-label="Recetas de ensamble">
            <h2>Recetas de ensamble</h2>
            <div className="maintenanceGrid">
              <button className="maintenanceTile" onClick={() => setIsMaintenanceRecipePickerOpen(true)} type="button">
                <ScrollText aria-hidden="true" size={22} />
                <strong>Crear receta</strong>
                <span>Complementos y cantidad a usar de un producto.</span>
              </button>
              <button className="maintenanceTile" onClick={() => setIsRecipesViewOpen(true)} type="button">
                <FileText aria-hidden="true" size={22} />
                <strong>Recetas</strong>
                <span>{assemblyRecipes.length} recetas creadas.</span>
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
            <div className="productionStatCard">
              <Clock aria-hidden="true" size={20} />
              <strong>{pendingInventoryCount}</strong>
              <span>Esperando inventario</span>
            </div>
            {waitingMaterialCount > 0 ? (
              <div className="productionStatCard">
                <Hourglass aria-hidden="true" size={20} />
                <strong>{waitingMaterialCount}</strong>
                <span>Esperando material</span>
              </div>
            ) : null}
            <div className="productionStatCard">
              <CheckCircle2 aria-hidden="true" size={20} />
              <strong>{approvedMaterialCount}</strong>
              <span>Listas para iniciar</span>
            </div>
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
                    const primaryAction = () => (isSplit ? setFamilyRuns(family) : openRunStagesModal(root));
                    const currentStage = root.stages.find((s) => s.status === "EN_PROCESO") ?? root.stages.find((s) => s.status === "PENDIENTE") ?? null;
                    const doneCount = root.stages.filter((s) => s.status === "FINALIZADA").length;
                    const totalQuantity = isSplit
                      ? family.reduce((total, part) => total + Number(part.quantity), 0)
                      : Number(root.quantity);
                    return (
                      <div className="productionRunListRow" key={key} {...openableProps(primaryAction, `${isSplit ? "Ver partes de" : "Gestionar"} orden ${root.process_name}`)}>
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
                            <strong style={{ fontSize: 13, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{root.process_name}</strong>
                          </div>
                          <div style={{ display: "flex", alignItems: "center", gap: 5, flexShrink: 0 }} onClick={stopClick}>
                            <button className="button buttonPrimary runInlineBtn" onClick={primaryAction} type="button">
                              {isSplit ? "Ver partes" : "Gestionar"}
                            </button>
                          </div>
                        </div>
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
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="emptyState">No hay procesos en transcurso.</div>
              )}
            </article>
          </section>

          {/* Ordenes que un split dejo esperando material: solo lectura aqui,
              se resuelven desde inventario (ver modal "Destinar material").
              Sin ordenes esperando, la seccion no se muestra (nada que revisar). */}
          {waitingMaterialRuns.length > 0 ? (
            <section className="card panelBody" aria-label="Esperando material">
              <div className="panelHeader">
                <div>
                  <h2 className="panelTitle">Esperando material</h2>
                  <p className="panelText">{countOrders(waitingMaterialRuns)} {countOrders(waitingMaterialRuns) === 1 ? "orden espera" : "ordenes esperan"} materia prima</p>
                </div>
              </div>
              <div className="productionRunsVertical">
                {waitingMaterialRuns.map((run) => (
                  <div className="productionRunListRow" key={run.id}>
                    <div className="productionRunListRowHead">
                      <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0, overflow: "hidden" }}>
                        {run.production_code ? (
                          <span style={{ fontFamily: "monospace", fontSize: 10, color: "var(--primary-strong)", fontWeight: 700, background: "#f3e9d6", borderRadius: 4, padding: "1px 5px", flexShrink: 0 }}>{run.production_code}</span>
                        ) : null}
                        {rootBadge(run)}
                        <strong style={{ fontSize: 13, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{run.process_name}</strong>
                      </div>
                      <StatusPunch label={runStatusLabel(run.status)} tone={runStatusTone(run.status)} />
                    </div>
                    <div className="productionRunListRowMeta">
                      <span>Faltan {numericText(run.quantity)} {run.raw_material_unit_code}</span>
                      {/* Reserva: inventario destino stock pero eligio esperar a
                          completar todo antes de arrancar (5.5/5.6 del handoff). */}
                      {Number(run.reserved_material_quantity ?? 0) > 0 ? (
                        <span>
                          Reservado {numericText(run.reserved_material_quantity ?? "0")} de{" "}
                          {numericText(run.total_required_material)} {run.raw_material_unit_code}
                        </span>
                      ) : null}
                    </div>
                    {/* Liberar la reserva es decision de Inventario (fue quien
                        la creo, desde el modal "Destinar material") -- ese
                        boton vive ahora en el panel de Solicitudes de
                        Inventario, no aca (bug reportado: se confundia con
                        una accion de Produccion). */}
                    {Number(run.reserved_material_quantity ?? 0) > 0 ? (
                      <div style={{ display: "flex", gap: 6, marginTop: 6, flexWrap: "wrap" }}>
                        {run.reservation_is_complete ? (
                          <button
                            className="button buttonPrimary"
                            disabled={reservationRunId === run.id}
                            onClick={() => void handleStartReserved(run)}
                            type="button"
                          >
                            {reservationRunId === run.id ? "Iniciando" : "Iniciar con lo reservado"}
                          </button>
                        ) : (
                          <span className="panelText">Reserva incompleta: falta material para iniciar.</span>
                        )}
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            </section>
          ) : null}

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
                      const rootStage = runCurrentStage(root);
                      return (
                        <tr
                          key={key}
                          onClick={otherParts.length > 0 ? () => setFamilyRuns(family) : undefined}
                          style={otherParts.length > 0 ? { cursor: "pointer" } : undefined}
                        >
                          <td>
                            {root.production_code ? <span className="orderCodeTag">{root.production_code}</span> : "—"}
                            {otherParts.length > 0 ? (
                              <span className="rootBadgeTag">+{otherParts.length} partes</span>
                            ) : (
                              rootBadge(root)
                            )}
                          </td>
                          <td>{root.process_name}</td>
                          <td className="num">{numericText(root.quantity)} {root.raw_material_unit_code}</td>
                          <td className="num">{numericText(runCurrentWeight(root))} {root.raw_material_unit_code}</td>
                          <td>{rootStage ? `${rootStage.stage_order}. ${rootStage.stage_name}` : "—"}</td>
                          <td><StatusPunch label={runStatusLabel(root.status)} tone={runStatusTone(root.status)} /></td>
                          <td>{processRowDate(root)}</td>
                          <td className="num">{processRowWaste(root)}</td>
                          <td onClick={stopClick}>{processRowActions(root)}</td>
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
                  return (
                    <div className="readyToStartRow" key={key} {...openableProps(primaryAction, `${isSplit ? "Ver partes de" : "Ver resumen de"} ${root.process_name}`)}>
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
                          {root.process_name}
                        </strong>
                        <span>{numericText(root.quantity)} {root.raw_material_unit_code} · Merma: {percentText(root.waste_percent)}% · Finalizado: {timeLabel(root.finished_at)} · Finalizó: {runFinisherName(root)}</span>
                      </div>
                      <div style={{ display: "flex", gap: 6, flexShrink: 0 }} onClick={stopClick}>
                        {isSplit ? (
                          <button className="iconTextButton" onClick={() => setFamilyRuns(family)} type="button">
                            <Eye aria-hidden="true" size={14} />
                            Ver partes
                          </button>
                        ) : (
                          <>
                            {root.assembly_pending ? (
                              <button
                                className="button buttonPrimary"
                                onClick={() => openAssemblyModal(root)}
                                type="button"
                              >
                                <Puzzle aria-hidden="true" size={14} />
                                Definir ensamble
                              </button>
                            ) : null}
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

      <CreateOrderWizard
        isOpen={isCreateOrderOpen}
        onClose={() => {
          setIsCreateOrderOpen(false);
          resetCreateOrderState();
        }}
        isSaving={isSaving}
        onError={setError}
        processes={activeProcesses}
        selectedProcessId={selectedProcessId}
        onSelectProcess={setSelectedProcessId}
        rawMaterials={rawMaterials}
        selectedMaterialId={selectedMaterialId}
        onSelectMaterial={setSelectedMaterialId}
        selectedMaterial={selectedMaterial}
        suppliesList={orderSupplyItems}
        configuredStageIngredients={configuredStageIngredients}
        stageIngredientQuantities={stageIngredientQuantities}
        onChangeStageIngredientQuantity={(configId, value) =>
          setStageIngredientQuantities((current) => ({ ...current, [configId]: value }))
        }
        assemblyMode={assemblyMode}
        onChangeAssemblyMode={handleAssemblyModeChange}
        orderProduct={orderProduct}
        renderProductChooser={renderProductChooser}
        onOpenProductPicker={handleOpenProductPicker}
        runQuantity={runQuantity}
        onChangeRunQuantity={setRunQuantity}
        onSubmit={() => void handleCreateProductionOrder()}
      />

      {/* Definir ensamble: combinacion de complementos APROBADOS de la orden.
          Se guarda como receta a futuro (cantidad total, no por unidad). */}
      {assemblyRun ? (() => {
        const approvedComplements = (assemblyRun.complements ?? []).filter((complement) => complement.status === "APROBADA");
        const hasValidLine = assemblyLines.some((line) => Number(line.perUnit) > 0);
        const hasExcess = assemblyLines.some((line) => {
          const qty = Number(line.perUnit);
          if (!(qty > 0)) return false;
          const complement = approvedComplements.find((candidate) => candidate.item_id === line.itemId);
          const approvedQty = complement ? Number(complement.quantity) : 0;
          return qty > approvedQty;
        });
        const canSubmitAssembly = hasValidLine && !hasExcess;
        return (
          <div className="modalBackdrop modalBackdropTop" role="dialog" aria-modal="true" aria-label="Definir ensamble">
            <section className="modalWindow processViewWindow">
              <div className="modalHeader">
                <div>
                  <h2>Definir ensamble</h2>
                  <p>{assemblyRun.production_code ?? ""} · fabrica {numericText(assemblyRun.quantity)} {assemblyRun.raw_material_unit_code}</p>
                </div>
                <button aria-label="Cerrar" className="iconOnlyButton" onClick={closeAssemblyModal} type="button">
                  <X aria-hidden="true" size={18} />
                </button>
              </div>
              {approvedComplements.length > 0 ? (
                <div className="tableWrap">
                  <table className="table">
                    <thead>
                      <tr>
                        <th>Complemento</th>
                        <th className="num">Aprobado</th>
                        <th className="num">Cantidad a usar</th>
                      </tr>
                    </thead>
                    <tbody>
                      {approvedComplements.map((complement) => {
                        const line = assemblyLines.find((candidate) => candidate.itemId === complement.item_id);
                        const qty = line?.perUnit ?? "";
                        const qtyNumber = Number(qty);
                        const approvedQty = Number(complement.quantity);
                        const exceeds = qtyNumber > 0 && qtyNumber > approvedQty;
                        return (
                          <tr key={complement.id}>
                            <td>{complement.name ?? "—"}</td>
                            <td className="num">{numericText(complement.quantity)} {complement.unit_code}</td>
                            <td className="num">
                              <input
                                aria-label={`Cantidad a usar de ${complement.name ?? "complemento"}`}
                                className="field"
                                min="0"
                                onChange={(event) => {
                                  const value = event.target.value;
                                  setAssemblyLines((current) =>
                                    current.map((candidate) =>
                                      candidate.itemId === complement.item_id ? { ...candidate, perUnit: value } : candidate,
                                    ),
                                  );
                                }}
                                step="0.0001"
                                style={{ width: 90 }}
                                type="number"
                                value={qty}
                              />
                              {exceeds ? (
                                <small style={{ display: "block", color: "var(--danger, #c0392b)" }}>
                                  Supera lo aprobado
                                </small>
                              ) : null}
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              ) : (
                <div className="emptyState">Esta orden no tiene complementos aprobados.</div>
              )}
              <div className="modalActions">
                <button
                  className="button buttonPrimary"
                  disabled={isSaving || !canSubmitAssembly}
                  onClick={() => void handleDefineAssembly()}
                  type="button"
                >
                  <Puzzle aria-hidden="true" size={15} />
                  {isSaving ? "Guardando" : "Definir ensamble"}
                </button>
              </div>
            </section>
          </div>
        );
      })() : null}

      {/* Picker de pieza terminada (o complemento) para el producto único de
          la orden (Crear orden o Editar producto). "Crear producto nuevo"
          pasa al picker de tipo del catálogo, para productos que aún no
          tienen piezas. En modo ASIGNAR se muestran dos pestañas: productos
          terminados y complementos (la joyeria fabrica sus propios
          complementos). En ENSAMBLAR solo productos terminados: las recetas
          de ensamble no aplican a complementos. */}
      {itemPickerFor ? (() => {
        const isAssignContext =
          itemPickerFor === "create"
            ? assemblyMode === "ASIGNAR"
            : editPlanRun?.assembly_mode === "ASIGNAR";
        const tabsBar = isAssignContext ? (
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
        ) : null;

        if (isAssignContext && assignPickerTab === "COMPLEMENTOS") {
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

        if (isAssignContext) {
          // ASIGNAR elige el mismo TIPO de producto que ENSAMBLAR (lista
          // compartida): el material lo pone la orden, no la pieza puntual.
          return (
            <CatalogProductPicker
              allowedTypeIds={allowedTypeIdsForPicker(itemPickerFor)}
              excludeTypeIds={
                itemPickerFor === "create" && orderMaterialCode
                  ? productTypesList
                      .filter((type) => recipeModelKeys.includes(`${orderMaterialCode}${type.category_code}${type.model_code}`))
                      .map((type) => type.id)
                  : undefined
              }
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
        }

        return (
          <FinishedItemPicker
            items={finishedItems}
            onClose={() => setItemPickerFor(null)}
            onCreate={() => {
              setTypePickerFor(itemPickerFor);
              setItemPickerFor(null);
            }}
            onSelect={(item) => {
              const label = (item.description ?? "").trim() || item.name;
              applyProductChoice(itemPickerFor, { targetItemId: item.id, label });
              setItemPickerFor(null);
            }}
            requireStock={false}
            tabs={tabsBar}
            title="Elegir producto"
          />
        );
      })() : null}

      {typePickerFor ? (
        <CatalogProductPicker
          allowedTypeIds={allowedTypeIdsForPicker(typePickerFor)}
          excludeTypeIds={
            assemblyMode === "ASIGNAR" && typePickerFor === "create" && orderMaterialCode
              ? productTypesList
                  .filter((type) => recipeModelKeys.includes(`${orderMaterialCode}${type.category_code}${type.model_code}`))
                  .map((type) => type.id)
              : undefined
          }
          onClose={() => setTypePickerFor(null)}
          onSelect={(type) => {
            const label = type.name?.trim() || `${type.category_code}${type.model_code}`;
            applyProductChoice(typePickerFor, { productTypeId: type.id, label });
            setTypePickerFor(null);
          }}
          rowBadge={
            assemblyMode === "ENSAMBLAR" && typePickerFor === "create"
              ? (type) => {
                  const key = `${orderMaterialCode ?? ""}${type.category_code}${type.model_code}`;
                  const recipe = assemblyRecipes.find((candidate) => candidate.model_key === key) ?? null;
                  return <RecipeBadgeIcon recipe={recipe} />;
                }
              : undefined
          }
          title="Elegir tipo de producto"
        />
      ) : null}

      {/* Modal "Recetas" de mantenimiento: lista las recetas de ensamble
          existentes con sus complementos; Editar abre la modal de receta
          prellenada con las líneas actuales. */}
      {isRecipesViewOpen ? (
        <div className="modalBackdrop" role="dialog" aria-modal="true" aria-label="Recetas de ensamble">
          <section className="modalWindow processViewWindow">
            <div className="modalHeader">
              <div>
                <h2>Recetas de ensamble</h2>
                <p>Ultima cantidad usada de cada complemento</p>
              </div>
              <button aria-label="Cerrar" className="iconOnlyButton" onClick={() => setIsRecipesViewOpen(false)} type="button">
                <X aria-hidden="true" size={18} />
              </button>
            </div>

            {assemblyRecipes.length === 0 ? (
              <p className="panelText">Aún no hay recetas de ensamble.</p>
            ) : (
              <div className="tableWrap">
                <table className="table tableAuto">
                  <thead>
                    <tr>
                      <th>Código</th>
                      <th>Producto</th>
                      <th>Material</th>
                      <th>Complementos</th>
                      <th aria-label="Acciones" />
                    </tr>
                  </thead>
                  <tbody>
                    {assemblyRecipes.map((recipe) => {
                      const modelKey = recipe.model_key;
                      if (!modelKey) return null;
                      const { product, material } = describeRecipeKey(modelKey);
                      return (
                        <tr key={modelKey}>
                          <td>{modelKey}</td>
                          <td>{product}</td>
                          <td>{material}</td>
                          <td>
                            {recipe.items.map((item) => (
                              <div key={item.complement_item_id}>
                                {numericText(item.quantity)} {item.unit_code ?? ""} × {item.name ?? "Complemento"}
                                {item.material_type ? ` (${item.material_type})` : ""}
                              </div>
                            ))}
                          </td>
                          <td>
                            <div style={{ display: "flex", gap: 4 }}>
                              <button
                                aria-label={`Editar receta ${modelKey}`}
                                className="iconOnlyButton"
                                onClick={() => {
                                  setIsRecipesViewOpen(false);
                                  setRecipeModalContext("maintenance");
                                  setRecipeLines(
                                    recipe.items.map((item) => ({
                                      itemId: item.complement_item_id,
                                      label: item.name ?? "Complemento",
                                      unitCode: item.unit_code ?? "",
                                      perUnit: String(Number(item.quantity)),
                                    })),
                                  );
                                  setRecipeModalModelKey(modelKey);
                                }}
                                title="Editar receta"
                                type="button"
                              >
                                <Pencil aria-hidden="true" size={16} />
                              </button>
                              <button
                                aria-label={`Eliminar receta ${modelKey}`}
                                className="iconOnlyButton"
                                onClick={() =>
                                  showConfirm(
                                    "Eliminar receta",
                                    `¿Eliminar la receta de ${product} (${material})? Esta acción no se puede deshacer.`,
                                    () => void handleDeleteRecipe(modelKey),
                                    true,
                                    "Eliminar",
                                  )
                                }
                                title="Eliminar receta"
                                type="button"
                              >
                                <Trash2 aria-hidden="true" size={16} />
                              </button>
                            </div>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>
      ) : null}

      {/* Picker de pieza para el tile "Crear receta" de mantenimiento: solo
          piezas con código completo de 7 dígitos que aún no tienen receta. */}
      {isMaintenanceRecipePickerOpen ? (
        <FinishedItemPicker
          items={finishedProductsList.filter((item) => {
            const code = item.product_code;
            return typeof code === "string" && code.length === 7 && !recipeModelKeys.includes(code);
          })}
          onClose={() => setIsMaintenanceRecipePickerOpen(false)}
          onSelect={(item) => {
            const code = item.product_code;
            if (!code) return;
            setRecipeModalContext("maintenance");
            setRecipeLines([]);
            setRecipeModalModelKey(code);
            setIsMaintenanceRecipePickerOpen(false);
          }}
          requireStock={false}
          title="Elegir producto"
        />
      ) : null}

      {/* Modal de receta: se abre cuando el tipo elegido en ENSAMBLAR no tiene
          receta aún, o desde el tile "Crear receta" de mantenimiento. Cerrar
          (X) también limpia la selección de producto de la orden, pero solo
          si la modal vino de Crear orden (recipeModalContext === "order"). */}
      {recipeModalModelKey ? (
        <div className="modalBackdrop modalBackdropTop" role="dialog" aria-modal="true" aria-label="Definir receta">
          <section className="modalWindow processViewWindow">
            <div className="modalHeader">
              <div>
                <h2>Definir receta</h2>
                <p>
                  {(() => {
                    const { product, material } = describeRecipeKey(recipeModalModelKey);
                    return `${product} · ${material} — complementos y cantidad a usar`;
                  })()}
                </p>
              </div>
              <button aria-label="Cerrar" className="iconOnlyButton" onClick={() => closeRecipeModal(true)} type="button">
                <X aria-hidden="true" size={18} />
              </button>
            </div>

            {recipeLines.length > 0 ? (
              <div className="tableWrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Complemento</th>
                      <th className="num">Cantidad</th>
                      <th aria-label="Quitar" />
                    </tr>
                  </thead>
                  <tbody>
                    {recipeLines.map((line) => (
                      <tr key={line.itemId}>
                        <td>{line.label}</td>
                        <td className="num">
                          <span style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
                            <input
                              aria-label={`Cantidad de ${line.label}, en ${line.unitCode || "su unidad"}`}
                              className="field"
                              min="0"
                              onChange={(event) => updateRecipeLinePerUnit(line.itemId, event.target.value)}
                              step="0.0001"
                              style={{ width: 90 }}
                              type="number"
                              value={line.perUnit}
                            />
                            <span style={{ color: "var(--muted)", fontSize: 13 }}>{line.unitCode}</span>
                          </span>
                        </td>
                        <td>
                          <button
                            aria-label={`Quitar ${line.label}`}
                            className="iconOnlyButton"
                            onClick={() => removeRecipeLine(line.itemId)}
                            type="button"
                          >
                            <Trash2 aria-hidden="true" size={15} />
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="emptyState">Sin complementos agregados.</div>
            )}

            <div className="modalActions">
              <button className="button" onClick={() => setIsRecipeComplementPickerOpen(true)} type="button">
                <Plus aria-hidden="true" size={14} />
                Elegir complementos
              </button>
              <button
                className="button buttonPrimary"
                disabled={isSaving || recipeLines.length === 0 || recipeLines.some((line) => !(Number(line.perUnit) > 0))}
                onClick={() => void handleSaveRecipe()}
                type="button"
              >
                <Save aria-hidden="true" size={15} />
                {isSaving ? "Guardando" : "Guardar"}
              </button>
            </div>
          </section>
        </div>
      ) : null}

      {isRecipeComplementPickerOpen ? (
        <ComplementPicker
          excludeIds={recipeLines.map((line) => line.itemId)}
          items={variant === "maintenance" ? complementsList : complementItems}
          onClose={() => setIsRecipeComplementPickerOpen(false)}
          onSelect={(item) => addRecipeLine(item)}
          title="Elegir complementos"
        />
      ) : null}

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
              const canManage = canManageStage(stage, safeIndex, stages);
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

                    {canManage && stage.status === "EN_PROCESO" && stageRequiresDecision(stage) ? (
                      <div className="stageChoiceGroup">
                        <span className="stageChoiceHint">Selecciona una condición para continuar:</span>
                        <button
                          className={`stageChoice stageChoiceYes ${stageChoice[stage.id] === "PASS" ? "stageChoiceActive" : ""}`}
                          onClick={() => selectStageChoice(stage, "PASS")}
                          type="button"
                        >
                          <strong>Sí, cumple</strong>
                          <span>{stage.quality_check || "La etapa cumple la condición."}</span>
                        </button>
                        <button
                          className={`stageChoice stageChoiceNo ${stageChoice[stage.id] === "REJECT" ? "stageChoiceActive" : ""}`}
                          onClick={() => selectStageChoice(stage, "REJECT")}
                          type="button"
                        >
                          <strong>No cumple</strong>
                          <span>{stage.rework_action || "No cumple; el flujo regresa a la etapa indicada."}</span>
                        </button>
                      </div>
                    ) : (
                      <>
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
                      </>
                    )}


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

                    {stage.status === "FINALIZADA" && stage.requires_weighing && canRunBeCancelled(selectedRunForStages) ? (
                      editingStageId === stage.id ? (
                        <div className="stageFinishBox">
                          <input
                            autoFocus
                            className="field"
                            min="0"
                            onChange={(e) => setEditWeightValue(e.target.value)}
                            placeholder="Peso corregido"
                            step="0.0001"
                            type="number"
                            value={editWeightValue}
                          />
                          {(() => {
                            const reference = stageReferenceWeight(stage);
                            const current = Number(editWeightValue);
                            if (!(reference > 0) || !Number.isFinite(current) || editWeightValue.trim() === "") return null;
                            if (current > reference) {
                              return (
                                <div className="processFlowCallout" style={{ color: "var(--danger, #b42318)" }}>
                                  El peso no puede superar el material que entró a esta etapa ({numericText(reference)} {selectedRunForStages.raw_material_unit_code}).
                                </div>
                              );
                            }
                            const check = stageWeightEditFailsCondition(stage, current);
                            if (check.fails) {
                              return (
                                <div className="processFlowCallout" style={{ color: "var(--danger, #b42318)" }}>
                                  ⚠ {check.reason} Al guardar se pedirá confirmación y quedará registrado.
                                </div>
                              );
                            }
                            return null;
                          })()}
                          <div className="modalActions">
                            <button className="button" onClick={closeEditStageWeight} type="button">
                              Cancelar
                            </button>
                            <button
                              className="button buttonPrimary"
                              disabled={isSavingStageWeight}
                              onClick={() => void handleSaveStageWeight(stage)}
                              type="button"
                            >
                              {isSavingStageWeight ? "Guardando" : "Guardar peso"}
                            </button>
                          </div>
                        </div>
                      ) : (
                        <button
                          className="button"
                          onClick={() => openEditStageWeight(stage)}
                          style={{ alignSelf: "flex-start" }}
                          type="button"
                        >
                          <Pencil aria-hidden="true" size={14} />
                          Corregir peso
                        </button>
                      )
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

                    {canManage ? (
                      <div className="stageFinishBox">
                        {stage.requires_weighing ? (
                          <input
                            className="field"
                            min="0"
                            onChange={(e) => setStageWeights((c) => ({ ...c, [stage.id]: e.target.value }))}
                            placeholder="Peso"
                            step="0.0001"
                            type="number"
                            value={stageWeights[stage.id] ?? ""}
                          />
                        ) : null}
                        {stageRequiresDecision(stage) ? (
                          stageChoice[stage.id] === "REJECT" ? (
                            <div className="stageRejectBox">
                              <textarea
                                className="stageRejectInput"
                                onChange={(e) => setRejectJustification(e.target.value)}
                                placeholder="Justificación (opcional)"
                                value={rejectJustification}
                              />
                              <span className="stageRejectHint">
                                {stage.rework_target_order
                                  ? `La producción regresará a la etapa ${stage.rework_target_order}.`
                                  : "La producción regresará a la etapa anterior."}
                              </span>
                              <div style={{ display: "flex", gap: 8 }}>
                                <button
                                  className="button"
                                  disabled={isSaving}
                                  onClick={() => clearStageChoice(stage.id)}
                                  style={{ flex: 1 }}
                                  type="button"
                                >
                                  Cancelar
                                </button>
                                <button
                                  className="button buttonDanger"
                                  disabled={isSaving}
                                  onClick={() => void handleFinishStage(stage, { decision: "REJECTED", justification: rejectJustification.trim() || undefined })}
                                  style={{ flex: 1 }}
                                  type="button"
                                >
                                  Confirmar rechazo
                                </button>
                              </div>
                            </div>
                          ) : stageChoice[stage.id] === "PASS" ? (
                            <button
                              className="button buttonPrimary"
                              disabled={isSaving}
                              onClick={() => approveStage(stage, "APPROVED")}
                              type="button"
                            >
                              Finalizar etapa
                            </button>
                          ) : (
                            <button className="button" disabled type="button" title="Selecciona una condición arriba">
                              Selecciona una condición
                            </button>
                          )
                        ) : (
                          <button className="button buttonPrimary" disabled={isSaving} onClick={() => approveStage(stage)} type="button">
                            {stage.status === "PENDIENTE" ? "Iniciar y finalizar" : "Finalizar etapa"}
                          </button>
                        )}
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

                  {/* Solicitudes de material fuera de lo declarado al crear la
                      orden. La solicitud misma ahora se hace desde la acta
                      (lado Entregado, boton "Solicitar material"). Una vez
                      APROBADA ya quedo como linea AUTO en la acta -- mostrarla
                      aqui tambien seria la misma info duplicada, asi que solo
                      se listan las que siguen pendientes de que Inventario
                      responda (o las que rechazo). */}
                  <div className="fieldGroup">
                    <span>Acta y materiales</span>
                    {(() => {
                      const openRequests = (selectedRunForStages.additional_materials ?? []).filter(
                        (request) => request.status !== "APROBADA",
                      );
                      return openRequests.length > 0 ? (
                        <div className="tableWrap">
                          <table className="table">
                            <thead>
                              <tr>
                                <th>Material</th>
                                <th>Etapa</th>
                                <th className="num">Cantidad</th>
                                <th>Estado</th>
                              </tr>
                            </thead>
                            <tbody>
                              {openRequests.map((request) => (
                                <tr key={request.id}>
                                  <td>{request.name ?? request.item_id}</td>
                                  <td>{request.stage_name ?? "—"}</td>
                                  <td className="num">{numericText(request.quantity)} {request.unit_code}</td>
                                  <td><StatusPunch label={request.status} tone={request.status === "RECHAZADA" ? "danger" : "warning"} /></td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      ) : null;
                    })()}

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
                  {cancelRun.production_code ? `${cancelRun.production_code} · ` : ""}{cancelRun.process_name}
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
              insumos, complementos). No se puede deshacer.
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
                <h2>{selectedStatsRun.process_name}</h2>
                <p>{numericText(selectedStatsRun.quantity)} {selectedStatsRun.raw_material_unit_code}</p>
              </div>
              {/* Producción finalizada: el producto ya no se edita aquí (el
                  plan se cambia solo mientras la orden sigue en proceso). */}
              {selectedStatsRun.assembly_pending ? (
                <button
                  className="button buttonPrimary"
                  onClick={() => openAssemblyModal(selectedStatsRun)}
                  type="button"
                >
                  <Puzzle aria-hidden="true" size={14} />
                  Definir ensamble
                </button>
              ) : null}
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
            <div className="modalActions">
              <button className="button" onClick={() => setActaRun(selectedStatsRun)} type="button">
                Ver acta
              </button>
              <button className="button buttonPrimary" onClick={() => setPrintingWasteRun(selectedStatsRun)} type="button">
                <Printer aria-hidden="true" size={14} />
                Imprimir
              </button>
            </div>
          </section>
        </div>
      ) : null}

      {printingWasteRun
        ? createPortal(
            <div className="printArea">
              <div className="wasteReportPrint">
                <h1>Reporte de merma</h1>
                <h2>
                  {printingWasteRun.production_code ?? printingWasteRun.process_name} · {printingWasteRun.process_name}
                </h2>
                <p>
                  {numericText(printingWasteRun.quantity)} {printingWasteRun.raw_material_unit_code} · Estado: {runStatusLabel(printingWasteRun.status)}
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
                  {historyRunsPager.pageItems.map((run) => (
                    <article className="movementRow" key={run.id} {...openableProps(() => openStatsModal(run), `Ver resumen de ${run.process_name}`)}>
                      <div style={{ gridColumn: "1 / -2" }}>
                        <strong>{run.production_code ? `${run.production_code} · ` : ""}{run.process_name}</strong>
                        <span>
                          {numericText(run.quantity)} {run.raw_material_unit_code} · Merma: {numericText(run.waste_weight)} {run.raw_material_unit_code} ·{" "}
                          {percentText(run.waste_percent)}% · {timeLabel(run.finished_at)} · Finalizó: {runFinisherName(run)}
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
                  ))}
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
                <p>Etapa {selectedStageIndex + 1} de {form.stages.length}</p>
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

            <section className="stageSingleWindow">
              <div className="stageTopActions">
                <strong>Etapa {selectedStageIndex + 1}</strong>
                <div className="rowActions">
                  <button
                    aria-label="Agregar etapa"
                    className="iconOnlyButton"
                    onClick={addStage}
                    title="Agregar etapa"
                    type="button"
                  >
                    <Plus aria-hidden="true" size={17} />
                  </button>
                  {selectedStageIndex > 0 ? (
                    <button
                      aria-label="Eliminar etapa"
                      className="iconOnlyButton dangerIconButton"
                      onClick={removeCurrentStage}
                      title="Eliminar etapa"
                      type="button"
                    >
                      <Trash2 aria-hidden="true" size={17} />
                    </button>
                  ) : null}
                </div>
              </div>

              <div className="stageNavigator">
                <button
                  className="iconOnlyButton stageArrow stageArrowLeft"
                  disabled={selectedStageIndex === 0}
                  onClick={() => setSelectedStageIndex((current) => Math.max(0, current - 1))}
                  type="button"
                >
                  <ArrowLeft aria-hidden="true" size={18} />
                </button>
                <button
                  className="iconOnlyButton stageArrow stageArrowRight"
                  disabled={selectedStageIndex >= form.stages.length - 1}
                  onClick={() => setSelectedStageIndex((current) => Math.min(form.stages.length - 1, current + 1))}
                  type="button"
                >
                  <ArrowRight aria-hidden="true" size={18} />
                </button>

                <div className="stageContent">
                  <label className="fieldGroup">
                    <span>Nombre</span>
                    <input
                      className="field"
                      disabled={isSaving}
                      maxLength={180}
                      onChange={(event) => updateStage("name", event.target.value)}
                      value={selectedStage.name}
                    />
                  </label>
                  <label className="fieldGroup">
                    <span>Descripcion</span>
                    <textarea
                      className="field textareaCompact"
                      disabled={isSaving}
                      maxLength={1000}
                      onChange={(event) => updateStage("description", event.target.value)}
                      value={selectedStage.description}
                    />
                  </label>
                  <div className="stageOptions">
                    <label className="fieldGroup">
                      <span>Tipo de etapa</span>
                      <select
                        className="field"
                        disabled={isSaving}
                        onChange={(event) => {
                          const value = event.target.value;
                          if (value === "DECISION" || value === "CONTROL") {
                            updateStage("stageType", value);
                          } else {
                            updateStage({ stageType: value, qualityCheck: "", reworkAction: "", reworkTargetOrder: "" });
                          }
                        }}
                        value={selectedStage.stageType}
                      >
                        {STAGE_TYPES.map((type) => (
                          <option key={type.value} value={type.value}>
                            {type.label}
                          </option>
                        ))}
                      </select>
                    </label>
                    <label className="fieldGroup">
                      <span>Fase (opcional)</span>
                      <input
                        className="field"
                        disabled={isSaving}
                        maxLength={120}
                        onChange={(event) => updateStage("phaseName", event.target.value)}
                        placeholder="Ejemplo: Fase 2 - Fabricacion"
                        value={selectedStage.phaseName}
                      />
                    </label>
                  </div>
                  {selectedStage.stageType === "DECISION" || selectedStage.stageType === "CONTROL" ? (
                    <>
                      <label className="fieldGroup">
                        <span>Control de calidad / pregunta</span>
                        <textarea
                          className="field textareaCompact"
                          disabled={isSaving}
                          maxLength={1000}
                          onChange={(event) => updateStage("qualityCheck", event.target.value)}
                          placeholder="Ejemplo: ¿El hilo cumple con el grosor requerido?"
                          value={selectedStage.qualityCheck}
                        />
                      </label>
                      <label className="fieldGroup">
                        <span>Accion si no cumple / reproceso</span>
                        <textarea
                          className="field textareaCompact"
                          disabled={isSaving}
                          maxLength={1000}
                          onChange={(event) => updateStage("reworkAction", event.target.value)}
                          placeholder="Ejemplo: Si no cumple, regresa a Fundicion para reprocesar."
                          value={selectedStage.reworkAction}
                        />
                      </label>
                      <label className="fieldGroup">
                        <span>Volver a esta etapa si se rechaza</span>
                        <select
                          className="field"
                          disabled={isSaving}
                          onChange={(event) => updateStage("reworkTargetOrder", event.target.value)}
                          value={selectedStage.reworkTargetOrder}
                        >
                          <option value="">Etapa anterior (por defecto)</option>
                          {form.stages.slice(0, selectedStageIndex).map((earlier, earlierIndex) => (
                            <option key={earlierIndex} value={String(earlierIndex + 1)}>
                              {earlierIndex + 1}. {earlier.name.trim() || `Etapa ${earlierIndex + 1}`}
                            </option>
                          ))}
                        </select>
                      </label>
                    </>
                  ) : null}
                  <div className="stageOptions">
                    <label className="checkControl">
                      <input
                        checked={selectedStage.requiresWeighing}
                        disabled={isSaving}
                        onChange={(event) => updateStage("requiresWeighing", event.target.checked)}
                        type="checkbox"
                      />
                      <span>Requiere pesaje</span>
                    </label>
                  </div>

                  {/* Ingredients section */}
                  <div className="fieldGroup">
                    <span>Materiales que entran en esta etapa</span>
                    <div className="ingredientList">
                      {selectedStage.ingredients.map((ing, ingIndex) => {
                        const selectedItem = suppliesList.find((m) => m.id === ing.inventoryItemId);
                        return (
                          <div key={ingIndex} style={{ display: "flex", gap: 8, alignItems: "center" }}>
                            <span className="field" style={{ flex: 1, display: "flex", alignItems: "center" }}>
                              {selectedItem ? `${selectedItem.name} · ${selectedItem.unit_code}` : ing.inventoryItemId}
                            </span>
                            <button
                              type="button"
                              className="iconOnlyButton dangerIconButton"
                              onClick={() => {
                                updateStage({
                                  ingredients: selectedStage.ingredients.filter((_, idx) => idx !== ingIndex),
                                });
                              }}
                              aria-label="Quitar material"
                            >
                              <X aria-hidden="true" size={14} />
                            </button>
                          </div>
                        );
                      })}
                      <button type="button" className="button" onClick={() => setIsIngredientPickerOpen(true)}>
                        <Plus aria-hidden="true" size={14} />
                        Agregar material
                      </button>
                    </div>
                  </div>
                </div>
              </div>
            </section>

            <div className="modalActions">
              <button className="button buttonPrimary" disabled={isSaving} type="submit">
                <Save aria-hidden="true" size={17} />
                {isSaving ? "Guardando" : "Guardar"}
              </button>
            </div>
          </form>
        </div>
      ) : null}

      {isIngredientPickerOpen ? (
        <MaterialCategoryPicker
          allowedTypes={["SUPPLY"]}
          excludeIds={selectedStage.ingredients.map((ing) => ing.inventoryItemId)}
          items={suppliesList}
          onClose={() => setIsIngredientPickerOpen(false)}
          onSelect={addStageIngredient}
          requireStock
          title="Agregar insumo de la etapa"
        />
      ) : null}

      {dataModal?.type === "units" ? <UnitsManager mode={dataModal.mode} onClose={() => setDataModal(null)} /> : null}
      {dataModal?.type === "materials" ? <RawMaterialsManager mode={dataModal.mode} onClose={() => setDataModal(null)} /> : null}
      {dataModal?.type === "supplies" ? <SuppliesManager mode={dataModal.mode} onClose={() => setDataModal(null)} /> : null}
      {dataModal?.type === "complements" ? <ComplementsManager mode={dataModal.mode} onClose={() => setDataModal(null)} /> : null}
      {dataModal?.type === "productTypes" ? <ProductTypesManager mode={dataModal.mode} onClose={() => setDataModal(null)} /> : null}

      {isProcessesOpen ? (
        <div className="modalBackdrop" role="dialog" aria-modal="true" aria-label="Procesos creados">
          <section className="modalWindow processesWindow">
            <div className="modalHeader">
              <div>
                <h2>Procesos</h2>
                <p>{processes.length} procesos creados</p>
              </div>
              <button aria-label="Cerrar" className="iconOnlyButton" onClick={() => setIsProcessesOpen(false)} type="button">
                <X aria-hidden="true" size={18} />
              </button>
            </div>

            <div className="processesLayout">
              <div className="processList">
                {processes.map((process) => (
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
                    <span>{process.stages.length} etapas</span>
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
                ))}
                {!isLoading && processes.length === 0 ? <div className="emptyState">No hay procesos creados.</div> : null}
              </div>

            </div>
          </section>
        </div>
      ) : null}

      {viewingProcess ? (
        <div className="modalBackdrop" role="dialog" aria-modal="true" aria-label="Detalle del proceso">
          <section className="modalWindow processFlowWindow">
            <div className="modalHeader">
              <div>
                <h2>{viewingProcess.name}</h2>
                <p>
                  {viewingProcess.code ? `Proceso ${viewingProcess.code} · ` : ""}
                  {viewingProcess.stages.length} etapas · v{viewingProcess.version ?? 1}
                </p>
              </div>
              <button aria-label="Cerrar" className="iconOnlyButton" onClick={() => setViewingProcess(null)} type="button">
                <X aria-hidden="true" size={18} />
              </button>
            </div>

            {viewingProcess.description ? (
              <p className="panelText">{viewingProcess.description}</p>
            ) : null}

            <div className="processFlowInfoBar">
              <div className="processFlowMeta">
                <strong>Limite de merma</strong>
                <span>{viewingProcess.waste_limit_percent ? `${percentText(viewingProcess.waste_limit_percent)}%` : "Sin configurar"}</span>
              </div>
            </div>

            <div className="processFlowList">
              {viewingProcess.stages.map((stage, index) => {
                const isLast = index === viewingProcess.stages.length - 1;
                const prevStage = viewingProcess.stages[index - 1];
                const isFirstInPhase = stage.phase_name && stage.phase_name !== (prevStage?.phase_name ?? null);
                const stageTypeClass = `processFlowStage${stage.stage_type ?? "PROCESS"}`;
                const hasMeta = stage.requires_weighing;
                return (
                  <div key={stage.id}>
                    {isFirstInPhase ? (
                      <div className="processFlowPhaseHeader">
                        <span className="processFlowPhaseLabel">{stage.phase_name}</span>
                      </div>
                    ) : null}
                    <div className={`processFlowStage ${stageTypeClass}`}>
                      <div className="processFlowStageHead">
                        <div className="processFlowStageTitle">
                          <span className="processFlowStageOrder">{stage.stage_order}</span>
                          <span className="processFlowStageName">{stage.name}</span>
                        </div>
                        <span className="processFlowTypeBadge">{stageTypeLabel(stage.stage_type ?? "PROCESS")}</span>
                      </div>
                      {stage.description ? (
                        <p className="processFlowStageDesc">{stage.description}</p>
                      ) : null}
                      {stage.quality_check ? (
                        <div className="processFlowCallout processFlowCalloutCheck">
                          <strong>Control de calidad</strong>
                          {stage.quality_check}
                        </div>
                      ) : null}
                      {stage.rework_action ? (
                        <div className="processFlowCallout processFlowCalloutRework">
                          <strong>Si no cumple / reproceso</strong>
                          {stage.rework_action}
                        </div>
                      ) : null}
                      {hasMeta ? (
                        <div className="processFlowStageFoot">
                          {stage.requires_weighing ? <span className="processFlowTag">⚖ Requiere pesaje</span> : null}
                        </div>
                      ) : null}
                    </div>
                    {!isLast ? (
                      <div className="processFlowConnector" aria-hidden="true">
                        <span>↓</span>
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
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

      {postFinishReturnRun ? (
        <div className="modalBackdrop modalBackdropTop" role="dialog" aria-modal="true" aria-label="Sobrante por devolver">
          <section className="modalWindow">
            <div className="modalHeader">
              <div>
                <h2>Sobrante por devolver</h2>
                <p>
                  {postFinishReturnRun.production_code ?? postFinishReturnRun.process_name} quedó con complementos
                  o insumos que no se usaron enteros. Devuélvelos ahora o continúa — es opcional, se puede hacer
                  después desde la acta.
                </p>
              </div>
              <button
                aria-label="Cerrar"
                className="iconOnlyButton"
                onClick={() => continueFromReturnStep()}
                type="button"
              >
                <X aria-hidden="true" size={18} />
              </button>
            </div>
            <ReturnCandidatesForm onChanged={() => void reload()} onError={setError} run={postFinishReturnRun} />
            <div className="modalActions">
              <button className="button buttonPrimary" onClick={() => continueFromReturnStep()} type="button">
                Continuar
              </button>
            </div>
          </section>
        </div>
      ) : null}

      {actaRun ? (
        <ActaView
          materialItems={[...rawMaterials, ...orderSupplyItems, ...complementItems]}
          onChanged={() => void reload()}
          onClose={() => closeActaModal()}
          run={actaRun}
        />
      ) : null}
    </div>
  );
}
