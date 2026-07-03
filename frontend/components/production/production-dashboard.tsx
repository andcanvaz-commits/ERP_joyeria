"use client";

import { FormEvent, useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { ArrowLeft, ArrowRight, ChevronLeft, ChevronRight, Eye, Factory, Pencil, Play, Plus, Ruler, Save, Trash2, UserPlus, Users, X } from "lucide-react";
import { UnitsManager } from "@/components/mantenimiento/units-manager";
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
import {
  createProcess,
  createProductionRun,
  deleteProcess,
  finishProductionRunStage,
  listProcesses,
  listProductionRuns,
  startProductionRun,
  updateProcess,
} from "@/lib/production-api";
import type { InventoryItem } from "@/types/inventory";
import type { ProductionProcess, ProductionRun, ProductionRunStage } from "@/types/production";
import { CaliperScale } from "@/components/ui/caliper-scale";
import { StatusBadge } from "@/components/ui/status-badge";
import { StatusPunch } from "@/components/ui/status-punch";

type StageForm = {
  name: string;
  description: string;
  phaseName: string;
  stageType: string;
  qualityCheck: string;
  reworkAction: string;
  reworkTargetOrder: string;
  requiresWeighing: boolean;
  ingredients: Array<{ inventoryItemId: string; quantity: string; unitCode: string }>;
};

type ProcessMaterialForm = {
  inventoryItemId: string;
  quantityPerUnit: string;
  unitCode: string;
};

type ProcessForm = {
  name: string;
  description: string;
  materials: ProcessMaterialForm[];
  wasteLimitPercent: string;
  stages: StageForm[];
};

type FormMode = "create" | "edit";
type UserFormMode = "create" | "edit";

const SYSTEM_ROLES = ["Jefe de producción", "Admin", "Jefe de inventario"];

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

const emptyProcessMaterial = (): ProcessMaterialForm => ({
  inventoryItemId: "",
  quantityPerUnit: "",
  unitCode: "g",
});

const emptyProcessForm = (): ProcessForm => ({
  name: "",
  description: "",
  materials: [emptyProcessMaterial()],
  wasteLimitPercent: "1",
  stages: [emptyStage()],
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
    materials: process.materials.length > 0
      ? process.materials.map((material) => ({
          inventoryItemId: material.inventory_item_id,
          quantityPerUnit: material.quantity_per_unit,
          unitCode: material.unit_code,
        }))
      : [emptyProcessMaterial()],
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
        quantity: String(ing.quantity),
        unitCode: ing.unit_code,
      })),
    })) : [emptyStage()],
  };
}

async function fetchProductionBundle(variant: "production" | "maintenance") {
  const [nextProcesses, nextUsers, nextRuns, nextRawMaterials] = await Promise.all([
    listProcesses(),
    variant === "maintenance" ? listUsers() : Promise.resolve([]),
    variant === "production" ? listProductionRuns() : Promise.resolve([]),
    listInventoryItems("RAW_MATERIAL"),
  ]);
  return {
    processes: nextProcesses,
    users: nextUsers,
    runs: nextRuns,
    rawMaterials: nextRawMaterials,
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
  });

  const processes = bundle?.processes ?? EMPTY_PROCESSES;
  const users = bundle?.users ?? EMPTY_USERS;
  const runs = bundle?.runs ?? EMPTY_RUNS;
  const rawMaterials = bundle?.rawMaterials ?? EMPTY_RAW_MATERIALS;
  const isLoading = !currentUser || isBundleLoading;

  const reload = () => queryClient.invalidateQueries({ queryKey: ["production", variant] });

  const [form, setForm] = useState<ProcessForm>(emptyProcessForm);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [isProcessesOpen, setIsProcessesOpen] = useState(false);
  const [isUserCreateOpen, setIsUserCreateOpen] = useState(false);
  const [isUsersOpen, setIsUsersOpen] = useState(false);
  const [isUnitsOpen, setIsUnitsOpen] = useState(false);
  const [returnToProcesses, setReturnToProcesses] = useState(false);
  const [returnToUsers, setReturnToUsers] = useState(false);
  const [userFormMode, setUserFormMode] = useState<UserFormMode>("create");
  const [editingUserId, setEditingUserId] = useState<string | null>(null);
  const [userForm, setUserForm] = useState(emptyUserForm);
  const [formMode, setFormMode] = useState<FormMode>("create");
  const [editingProcessId, setEditingProcessId] = useState<string | null>(null);
  const [selectedStageIndex, setSelectedStageIndex] = useState(0);
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
  const [stageWeights, setStageWeights] = useState<Record<string, string>>({});
  const [stageChoice, setStageChoice] = useState<Record<string, "PASS" | "REJECT">>({});
  const [rejectJustification, setRejectJustification] = useState("");
  const [isRunStagesOpen, setIsRunStagesOpen] = useState(false);
  const [selectedRunForStages, setSelectedRunForStages] = useState<ProductionRun | null>(null);
  const [isStatsModalOpen, setIsStatsModalOpen] = useState(false);
  const [selectedStatsRun, setSelectedStatsRun] = useState<ProductionRun | null>(null);
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
  }, [runs]);

  useEffect(() => {
    setSelectedProcessId((current) => current || processes.find((process) => process.is_active)?.id || "");
  }, [processes]);

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

  function showConfirm(title: string, message: string, onConfirm: () => void, isDanger = true, confirmLabel = "Confirmar") {
    setConfirmDialog({ title, message, onConfirm, isDanger, confirmLabel });
  }
  const activeProcesses = processes.filter((process) => process.is_active);
  const selectedProcess = processes.find((process) => process.id === selectedProcessId) ?? activeProcesses[0] ?? null;
  const selectedProcessMaterial = selectedProcess?.materials.find((material) => material.inventory_item_id === selectedMaterialId) ?? null;
  const selectedMaterial = rawMaterials.find((item) => item.id === selectedProcessMaterial?.inventory_item_id) ?? null;
  const requiredMaterial = selectedProcessMaterial?.quantity_per_unit && runQuantity
    ? Number(selectedProcessMaterial.quantity_per_unit) * Number(runQuantity)
    : 0;

  useEffect(() => {
    const materials = selectedProcess?.materials ?? [];
    setSelectedMaterialId((current) => {
      if (current && materials.some((material) => material.inventory_item_id === current)) {
        return current;
      }
      return materials[0]?.inventory_item_id ?? "";
    });
  }, [selectedProcess]);
  const approvedMaterialRuns = runs.filter((run) => run.status === "MATERIALES_APROBADOS");
  const inProgressRuns = runs.filter((run) => run.status === "EN_PROCESO");
  const finishedRuns = runs.filter((run) => run.status === "PENDIENTE_RECEPCION" || run.status === "RECIBIDA");
  const recentFinishedRuns = finishedRuns.slice(0, 3);

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

  function timeLabel(value: string | null) {
    if (!value) return "Pendiente";
    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return "Pendiente";
    return date.toLocaleString("es-EC", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
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
      MATERIALES_APROBADOS: "Materiales aprobados",
      EN_PROCESO: "En proceso",
      PENDIENTE_RECEPCION: "Pendiente de recepcion",
      RECIBIDA: "Recibida",
      CANCELADA: "Cancelada",
    };
    return labels[status] ?? status;
  }

  function runStatusTone(status: ProductionRun["status"]): "neutral" | "active" | "done" | "danger" | "warning" {
    const tones: Record<ProductionRun["status"], "neutral" | "active" | "done" | "danger" | "warning"> = {
      PENDIENTE_INVENTARIO: "warning",
      MATERIALES_APROBADOS: "active",
      EN_PROCESO: "active",
      PENDIENTE_RECEPCION: "warning",
      RECIBIDA: "done",
      CANCELADA: "danger",
    };
    return tones[status] ?? "neutral";
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

  function openStatsModal(run: ProductionRun) {
    setSelectedStatsRun(run);
    setIsStatsModalOpen(true);
  }

  function closeStatsModal() {
    setIsStatsModalOpen(false);
    setSelectedStatsRun(null);
  }

  const currentHistoryMonth = historyMonth || (new Date().toISOString().slice(0, 7));
  const historyDays = buildCalendarDays(currentHistoryMonth);
  const selectedDateRuns = selectedHistoryDate
    ? finishedRuns.filter((run) => (run.finished_at ?? "").slice(0, 10) === selectedHistoryDate)
    : [];

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

  function addProcessMaterial() {
    setForm((current) => ({
      ...current,
      materials: [...current.materials, emptyProcessMaterial()],
    }));
  }

  function removeProcessMaterial(materialIndex: number) {
    setForm((current) => {
      if (current.materials.length === 1) return current;
      return {
        ...current,
        materials: current.materials.filter((_, index) => index !== materialIndex),
      };
    });
  }

  function updateProcessMaterial(materialIndex: number, patch: Partial<ProcessMaterialForm>) {
    setForm((current) => ({
      ...current,
      materials: current.materials.map((material, index) =>
        index === materialIndex ? { ...material, ...patch } : material
      ),
    }));
  }

  function updateStage(fieldOrPatch: keyof StageForm | Partial<StageForm>, value?: string | boolean | Array<{ inventoryItemId: string; quantity: string; unitCode: string }>) {
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
    if (
      form.materials.length === 0 ||
      form.materials.some((material) => !material.inventoryItemId || !material.quantityPerUnit || Number(material.quantityPerUnit) <= 0)
    ) {
      throw new Error("Agrega al menos una materia prima con su cantidad por unidad.");
    }
    const materialIds = form.materials.map((material) => material.inventoryItemId);
    if (new Set(materialIds).size !== materialIds.length) {
      throw new Error("No repitas la misma materia prima.");
    }

    return {
      name: processName,
      description: form.description.trim() || null,
      version: 1,
      materials: form.materials.map((material) => ({
        inventory_item_id: material.inventoryItemId,
        quantity_per_unit: material.quantityPerUnit,
        unit_code: material.unitCode || "g",
      })),
      waste_limit_percent: "1",
      is_active: true,
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
          .filter((ing) => ing.inventoryItemId && ing.quantity)
          .map((ing) => ({
            inventory_item_id: ing.inventoryItemId,
            quantity: ing.quantity,
            unit_code: ing.unitCode || rawMaterials.find((m) => m.id === ing.inventoryItemId)?.unit_code || "g",
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

  async function handleCreateProductionOrder() {
    if (!selectedProcess) {
      setError("Selecciona un proceso para producir.");
      return;
    }
    if (!runQuantity || Number(runQuantity) <= 0) {
      setError("Ingresa una cantidad valida para fabricar.");
      return;
    }
    const materialBelongsToProcess = selectedProcess.materials.some(
      (material) => material.inventory_item_id === selectedMaterialId
    );
    if (!selectedMaterialId || !materialBelongsToProcess) {
      setError("Selecciona la materia prima con la que se fabricará esta orden.");
      return;
    }

    setError(null);
    setSuccess(null);
    setIsSaving(true);
    try {
      await createProductionRun({
        process_id: selectedProcess.id,
        quantity: runQuantity,
        raw_material_item_id: selectedMaterialId,
      });
      setSuccess("Orden creada. Inventario debe aprobar la salida de materia prima.");
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

  async function handleFinishStage(
    stage: ProductionRunStage,
    options: { decision?: "APPROVED" | "REJECTED"; justification?: string } = {}
  ) {
    setError(null);
    setSuccess(null);
    setIsSaving(true);
    try {
      const finalWeight = stageWeights[stage.id]?.trim() || null;
      await finishProductionRunStage(stage.id, {
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

  return (
    <div className="content">
      {error || success ? (
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

          <section className="maintenanceSection" aria-label="Datos del sistema">
            <h2>Datos</h2>
            <div className="maintenanceGrid">
              <button className="maintenanceTile" onClick={() => setIsUnitsOpen(true)} type="button">
                <Ruler aria-hidden="true" size={22} />
                <strong>Unidades de medida</strong>
                <span>Gestiona las unidades del inventario.</span>
              </button>
            </div>
          </section>
        </>
      ) : (
        <>
          {/* Stats bar */}
          <section className="productionStatsRow" aria-label="Metricas de produccion">
            <div className="productionStatCard">
              <strong>{runs.filter((r) => r.status === "PENDIENTE_INVENTARIO").length}</strong>
              <span>Esperando inventario</span>
            </div>
            <div className="productionStatCard">
              <strong>{approvedMaterialRuns.length}</strong>
              <span>Listas para iniciar</span>
            </div>
            <div className="productionStatCard">
              <strong>{inProgressRuns.length}</strong>
              <span>En proceso</span>
            </div>
            <div className="productionStatCard">
              <strong>{finishedRuns.length}</strong>
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
              <div className="materialRow">
                <label className="fieldGroup">
                  <span>Proceso</span>
                  <select className="field" onChange={(e) => setSelectedProcessId(e.target.value)} value={selectedProcess?.id ?? ""}>
                    <option value="">Seleccionar proceso</option>
                    {activeProcesses.map((p) => (
                      <option key={p.id} value={p.id}>{p.name}</option>
                    ))}
                  </select>
                </label>
                <label className="fieldGroup">
                  <span>Material</span>
                  <select className="field" onChange={(e) => setSelectedMaterialId(e.target.value)} value={selectedMaterialId}>
                    <option value="">Seleccionar material</option>
                    {(selectedProcess?.materials ?? []).map((material) => (
                      <option key={material.id} value={material.inventory_item_id}>
                        {rawMaterials.find((item) => item.id === material.inventory_item_id)?.name ?? material.inventory_item_id}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <label className="fieldGroup">
                <span>Cantidad a fabricar</span>
                <input className="field" min="0.0001" onChange={(e) => setRunQuantity(e.target.value)} step="0.0001" type="number" value={runQuantity} />
              </label>
              <button
                className="button buttonPrimary"
                disabled={isSaving || !selectedProcess || !selectedMaterialId}
                onClick={() => void handleCreateProductionOrder()}
                type="button"
              >
                <Play aria-hidden="true" size={16} />
                Crear orden
              </button>
            </article>

            {/* In-progress horizontal scroll */}
            <article className="card panelBody">
              <div className="panelHeader">
                <div>
                  <h2 className="panelTitle">En proceso</h2>
                  <p className="panelText">{inProgressRuns.length} {inProgressRuns.length === 1 ? "orden activa" : "ordenes activas"}</p>
                </div>
              </div>
              {inProgressRuns.length > 0 ? (
                <div className="productionRunsVertical">
                  {inProgressRuns.map((run) => {
                    const currentStage = run.stages.find((s) => s.status === "EN_PROCESO") ?? run.stages.find((s) => s.status === "PENDIENTE") ?? null;
                    const doneCount = run.stages.filter((s) => s.status === "FINALIZADA").length;
                    return (
                      <div className="productionRunListRow" key={run.id} {...openableProps(() => openRunStagesModal(run), `Gestionar orden ${run.process_name}`)}>
                        {/* Title row: name + code left, timing + button right */}
                        <div className="productionRunListRowHead">
                          <div style={{ display: "flex", alignItems: "center", gap: 6, minWidth: 0, overflow: "hidden" }}>
                            {run.production_code ? (
                              <span style={{ fontFamily: "monospace", fontSize: 10, color: "var(--primary-strong)", fontWeight: 700, background: "#f3e9d6", borderRadius: 4, padding: "1px 5px", flexShrink: 0 }}>{run.production_code}</span>
                            ) : null}
                            <strong style={{ fontSize: 13, whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>{run.process_name}</strong>
                          </div>
                          <div style={{ display: "flex", alignItems: "center", gap: 5, flexShrink: 0 }} onClick={stopClick}>
                            <button className="button buttonPrimary runInlineBtn" onClick={() => openRunStagesModal(run)} type="button">
                              Gestionar
                            </button>
                          </div>
                        </div>
                        {/* Meta: current stage + qty + started */}
                        <div className="productionRunListRowMeta">
                          {currentStage ? <span>{currentStage.stage_order}. {currentStage.stage_name}</span> : null}
                          {currentStage ? <span aria-hidden="true">·</span> : null}
                          <span>{numericText(run.quantity)} und</span>
                          <span aria-hidden="true">·</span>
                          <span>Inició {hourLabel(run.started_at)}</span>
                        </div>
                        {/* Progress: caliper scale for stage advance */}
                        <CaliperScale
                          ariaLabel="Avance de la orden"
                          label={`${doneCount}/${run.stages.length}`}
                          max={run.stages.length}
                          ticks={run.stages.length}
                          value={doneCount}
                        />
                        {run.waste_limit_percent ? (
                          <CaliperScale
                            ariaLabel="Merma frente al limite"
                            label={`${Number(run.waste_percent ?? 0).toFixed(1)}%`}
                            limit={Number(run.waste_limit_percent)}
                            limitMode="ceiling"
                            max={Math.max(Number(run.waste_limit_percent) * 2, 1)}
                            value={Number(run.waste_percent ?? 0)}
                          />
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              ) : (
                <div className="emptyState">No hay procesos en transcurso.</div>
              )}
            </article>
          </section>

          {/* Ready to start */}
          {approvedMaterialRuns.length > 0 ? (
            <section className="card panelBody" aria-label="Listas para iniciar">
              <div className="panelHeader">
                <div>
                  <h2 className="panelTitle">Listas para iniciar</h2>
                  <p className="panelText">{approvedMaterialRuns.length} ordenes con materiales aprobados</p>
                </div>
                <Play aria-hidden="true" size={20} />
              </div>
              <div className="readyToStartList">
                {approvedMaterialRuns.map((run) => (
                  <div className="readyToStartRow" key={run.id}>
                    <div className="readyToStartInfo">
                      <strong>{run.process_name}</strong>
                      <span>{run.quantity} unidades · Material: {numericText(run.total_required_material)} {run.raw_material_unit_code} · Aprobado: {timeLabel(run.materials_approved_at)}</span>
                    </div>
                    <button
                      className="button buttonPrimary"
                      disabled={isSaving}
                      onClick={() => void handleStartApprovedRun(run)}
                      type="button"
                    >
                      <Play aria-hidden="true" size={15} />
                      Iniciar
                    </button>
                  </div>
                ))}
              </div>
            </section>
          ) : null}

          {/* History */}
          <section className="card panelBody" aria-label="Historial de produccion">
            <div className="panelHeader">
              <div>
                <h2 className="panelTitle">Historial reciente</h2>
                <p className="panelText">Ultimas producciones finalizadas</p>
              </div>
              <button
                aria-label="Ver historial completo"
                className="iconOnlyButton"
                disabled={finishedRuns.length === 0}
                onClick={() => setIsHistoryOpen(true)}
                type="button"
              >
                <Eye aria-hidden="true" size={20} />
              </button>
            </div>
            {recentFinishedRuns.length > 0 ? (
              <div className="readyToStartList">
                {recentFinishedRuns.map((run) => (
                  <div className="readyToStartRow" key={run.id} {...openableProps(() => openStatsModal(run), `Ver resumen de ${run.process_name}`)}>
                    <div className="readyToStartInfo">
                      <strong>
                        {run.production_code ? <span className="orderCodeTag">{run.production_code}</span> : null}
                        {run.process_name}
                      </strong>
                      <span>{run.quantity} unidades · Merma: {numericText(run.waste_percent)}% · Finalizado: {timeLabel(run.finished_at)} · Finalizó: {runFinisherName(run)}</span>
                    </div>
                    <button className="iconTextButton" onClick={(event) => { event.stopPropagation(); openStatsModal(run); }} type="button">
                      <Eye aria-hidden="true" size={14} />
                      Visualizar
                    </button>
                  </div>
                ))}
              </div>
            ) : (
              <div className="emptyState">No hay historial disponible.</div>
            )}
          </section>
        </>
      )}

      {isRunStagesOpen && selectedRunForStages ? (
        <div className="modalBackdrop modalBackdropAnchor" role="dialog" aria-modal="true">
          <section className="modalWindow processViewWindow">
            <div className="modalHeader">
              <div>
                <h2>
                  {selectedRunForStages.production_code ? (
                    <span style={{ display: "inline-block", marginRight: 10, fontFamily: "monospace", fontSize: 13, color: "var(--primary-strong)", fontWeight: 700, background: "#f3e9d6", borderRadius: 5, padding: "2px 8px" }}>{selectedRunForStages.production_code}</span>
                  ) : null}
                  {selectedRunForStages.process_name}
                </h2>
                <p style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  {numericText(selectedRunForStages.quantity)} unidades
                  <StatusPunch label={runStatusLabel(selectedRunForStages.status)} tone={runStatusTone(selectedRunForStages.status)} />
                </p>
              </div>
              <button aria-label="Cerrar" className="iconOnlyButton" onClick={closeRunStagesModal} type="button">
                <X aria-hidden="true" size={18} />
              </button>
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
                      <div style={{ fontSize: 12, color: "var(--muted)" }}>
                        Inició {hourLabel(stage.started_at)}
                        {stage.finished_at ? ` · Finalizó ${hourLabel(stage.finished_at)}` : ""}
                        {stage.finished_at && stage.finished_by_name ? ` · por ${stage.finished_by_name}` : ""}
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
                        {numericText(stage.waste_weight)} {selectedRunForStages.raw_material_unit_code} · {numericText(stage.waste_percent)}%
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
                              {decision.decision === "REJECTED" ? "Rechazo" : "Aprobación"} · intento {decision.attempt_no}
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
                        <strong>Peso esperado</strong>
                        {numericText(selectedRunForStages.expected_finished_weight)} {selectedRunForStages.raw_material_unit_code}
                      </span>
                      <span>
                        <strong>Peso real</strong>
                        {numericText(selectedRunForStages.actual_finished_weight)} {selectedRunForStages.raw_material_unit_code}
                      </span>
                      <span>
                        <strong>Merma acumulada</strong>
                        {numericText(selectedRunForStages.waste_weight)} {selectedRunForStages.raw_material_unit_code} · {numericText(selectedRunForStages.waste_percent)}%
                        {Number(selectedRunForStages.waste_percent ?? 0) > Number(selectedRunForStages.waste_limit_percent)
                          ? ` · ⚠ supera el ${numericText(selectedRunForStages.waste_limit_percent)}%`
                          : ""}
                      </span>
                    </div>
                  ) : null}
                </>
              );
            })() : null}
          </section>
        </div>
      ) : null}

      {isStatsModalOpen && selectedStatsRun ? (
        <div className="modalBackdrop modalBackdropTop" role="dialog" aria-modal="true" aria-label="Estadisticas del proceso">
          <section className="modalWindow processViewWindow">
            <div className="modalHeader">
              <div>
                <h2>{selectedStatsRun.process_name}</h2>
                <p>{selectedStatsRun.quantity} unidades</p>
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
              <span>
                <strong>Inicio</strong>
                {timeLabel(selectedStatsRun.started_at)}
              </span>
              <span>
                <strong>Fin</strong>
                {timeLabel(selectedStatsRun.finished_at)}
              </span>
              <span>
                <strong>Merma</strong>
                {numericText(selectedStatsRun.waste_weight)} {selectedStatsRun.raw_material_unit_code}
              </span>
              <span>
                <strong>% merma</strong>
                {numericText(selectedStatsRun.waste_percent)}%
              </span>
              <span>
                <strong>Resultado</strong>
                {Number(selectedStatsRun.waste_percent ?? 0) <= Number(selectedStatsRun.waste_limit_percent) ? "Dentro del limite" : "Fuera del limite"}
              </span>
              <span>
                <strong>Finalizó</strong>
                {runFinisherName(selectedStatsRun)}
              </span>
            </div>
          </section>
        </div>
      ) : null}

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
                  {selectedDateRuns.map((run) => (
                    <article className="movementRow" key={run.id} {...openableProps(() => openStatsModal(run), `Ver resumen de ${run.process_name}`)}>
                      <div>
                        <strong>{run.process_name}</strong>
                        <span>{timeLabel(run.finished_at)}</span>
                        <span>Finalizó: {runFinisherName(run)}</span>
                      </div>
                      <div>
                        <strong>{run.quantity} unidades</strong>
                        <span>{numericText(run.waste_percent)}% merma</span>
                        <span>{numericText(run.waste_weight)} {run.raw_material_unit_code}</span>
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

            <div className="fieldGroup">
              <span>Materias primas del proceso</span>
              <div className="materialList">
                {form.materials.map((material, materialIndex) => (
                  <div key={materialIndex} style={{ display: "flex", gap: 8, alignItems: "end" }}>
                    <div className="materialRow" style={{ flex: 1 }}>
                      <label className="fieldGroup">
                        <span>Materia prima</span>
                        <select
                          className="field"
                          disabled={isSaving}
                          onChange={(event) => {
                            const selected = rawMaterials.find((item) => item.id === event.target.value);
                            updateProcessMaterial(materialIndex, {
                              inventoryItemId: event.target.value,
                              unitCode: selected?.unit_code ?? material.unitCode,
                            });
                          }}
                          value={material.inventoryItemId}
                        >
                          <option value="">Seleccionar materia prima</option>
                          {rawMaterials.map((item) => (
                            <option key={item.id} value={item.id}>{item.name} - {item.current_stock} {item.unit_code}</option>
                          ))}
                        </select>
                      </label>
                      <label className="fieldGroup">
                        <span>Cantidad usada por unidad</span>
                        <input
                          className="field"
                          disabled={isSaving}
                          min="0.0001"
                          onChange={(event) => updateProcessMaterial(materialIndex, { quantityPerUnit: event.target.value })}
                          step="0.0001"
                          type="number"
                          value={material.quantityPerUnit}
                        />
                      </label>
                    </div>
                    {form.materials.length > 1 ? (
                      <button
                        aria-label="Quitar materia prima"
                        className="iconOnlyButton dangerIconButton"
                        disabled={isSaving}
                        onClick={() => removeProcessMaterial(materialIndex)}
                        type="button"
                      >
                        <X aria-hidden="true" size={14} />
                      </button>
                    ) : null}
                  </div>
                ))}
              </div>
              <button className="button" disabled={isSaving} onClick={addProcessMaterial} type="button">
                <Plus aria-hidden="true" size={14} />
                Agregar materia prima
              </button>
            </div>

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
                      {selectedStage.ingredients.map((ing, ingIndex) => (
                        <div key={ingIndex} style={{ display: "flex", gap: 8, alignItems: "center" }}>
                          <select
                            className="field"
                            value={ing.inventoryItemId}
                            onChange={(e) => {
                              const selected = rawMaterials.find((m) => m.id === e.target.value);
                              updateStage({
                                ingredients: selectedStage.ingredients.map((item, idx) =>
                                  idx === ingIndex
                                    ? { ...item, inventoryItemId: e.target.value, unitCode: selected?.unit_code ?? item.unitCode }
                                    : item
                                ),
                              });
                            }}
                            style={{ flex: 2 }}
                          >
                            <option value="">Seleccionar material</option>
                            {rawMaterials.map((m) => (
                              <option key={m.id} value={m.id}>{m.name} ({m.unit_code})</option>
                            ))}
                          </select>
                          <input
                            className="field"
                            type="number"
                            min="0"
                            step="0.0001"
                            placeholder="Cantidad"
                            value={ing.quantity}
                            onChange={(e) => {
                              updateStage({
                                ingredients: selectedStage.ingredients.map((item, idx) =>
                                  idx === ingIndex ? { ...item, quantity: e.target.value } : item
                                ),
                              });
                            }}
                            style={{ flex: 1, minWidth: 90 }}
                          />
                          <span style={{ color: "var(--muted)", fontSize: 12, fontWeight: 700, minWidth: 30 }}>
                            {rawMaterials.find((m) => m.id === ing.inventoryItemId)?.unit_code ?? ""}
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
                      ))}
                      <button
                        type="button"
                        className="button"
                        onClick={() => {
                          updateStage({
                            ingredients: [...selectedStage.ingredients, { inventoryItemId: "", quantity: "", unitCode: "" }],
                          });
                        }}
                      >
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

      {isUnitsOpen ? <UnitsManager onClose={() => setIsUnitsOpen(false)} /> : null}

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
              <div className="processFlowMeta" style={{ gridColumn: "span 2" }}>
                <strong>Materias primas</strong>
                <span>
                  {viewingProcess.materials.length > 0
                    ? viewingProcess.materials
                        .map((material) => {
                          const name = rawMaterials.find((item) => item.id === material.inventory_item_id)?.name ?? material.inventory_item_id;
                          return `${name}: ${material.quantity_per_unit} ${material.unit_code}`;
                        })
                        .join(" · ")
                    : "Sin configurar"}
                </span>
              </div>
              <div className="processFlowMeta">
                <strong>Limite de merma</strong>
                <span>{viewingProcess.waste_limit_percent ? `${viewingProcess.waste_limit_percent}%` : "Sin configurar"}</span>
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
    </div>
  );
}
