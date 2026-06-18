"use client";

import { FormEvent, useEffect, useState } from "react";
import { ArrowLeft, ArrowRight, ChevronLeft, ChevronRight, Clock, Eye, Factory, Pencil, Play, Plus, Save, Trash2, UserPlus, Users, X } from "lucide-react";
import { getAccessToken } from "@/lib/api";
import {
  activateUser,
  createUser,
  deactivateUser,
  deleteUser,
  getCurrentUser,
  listUsers,
  type CurrentUser,
  type ManagedUser,
  resetUserPassword,
  updateUser,
} from "@/lib/auth-api";
import { listInventoryItems } from "@/lib/inventory-api";
import { createProcess, createProductionRun, deleteProcess, finishProductionRunStage, listProcesses, listProductionRuns, updateProcess } from "@/lib/production-api";
import type { InventoryItem } from "@/types/inventory";
import type { ProductionProcess, ProductionRun, ProductionRunStage } from "@/types/production";

type StageForm = {
  name: string;
  description: string;
  requiresWeighing: boolean;
  estimatedMinutes: string;
};

type ProcessForm = {
  name: string;
  description: string;
  rawMaterialItemId: string;
  rawMaterialQuantityPerUnit: string;
  rawMaterialUnitCode: string;
  wasteLimitPercent: string;
  stages: StageForm[];
};

type FormMode = "create" | "edit";
type UserFormMode = "create" | "edit";

const SYSTEM_ROLES = ["Jefe de producción", "Admin", "Jefe de inventario"];

const emptyStage = (): StageForm => ({
  name: "",
  description: "",
  requiresWeighing: false,
  estimatedMinutes: "",
});

const emptyProcessForm = (): ProcessForm => ({
  name: "",
  description: "",
  rawMaterialItemId: "",
  rawMaterialQuantityPerUnit: "",
  rawMaterialUnitCode: "g",
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
    rawMaterialItemId: process.raw_material_item_id ?? "",
    rawMaterialQuantityPerUnit: process.raw_material_quantity_per_unit ?? "",
    rawMaterialUnitCode: process.raw_material_unit_code ?? "g",
    wasteLimitPercent: process.waste_limit_percent ?? "1",
    stages: stages.length > 0 ? stages.map((stage) => ({
      name: stage.name,
      description: stage.description ?? "",
      requiresWeighing: stage.requires_weighing,
      estimatedMinutes: stage.estimated_minutes ? String(stage.estimated_minutes) : "",
    })) : [emptyStage()],
  };
}

export function ProductionDashboard({ variant = "production" }: { variant?: "production" | "maintenance" }) {
  const [form, setForm] = useState<ProcessForm>(emptyProcessForm);
  const [processes, setProcesses] = useState<ProductionProcess[]>([]);
  const [runs, setRuns] = useState<ProductionRun[]>([]);
  const [rawMaterials, setRawMaterials] = useState<InventoryItem[]>([]);
  const [currentUser, setCurrentUser] = useState<CurrentUser | null>(null);
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [isFormOpen, setIsFormOpen] = useState(false);
  const [isProcessesOpen, setIsProcessesOpen] = useState(false);
  const [isUserCreateOpen, setIsUserCreateOpen] = useState(false);
  const [isUsersOpen, setIsUsersOpen] = useState(false);
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
    email: string;
    role: string;
    temporaryPassword: string;
  } | null>(null);
  const [selectedProcessId, setSelectedProcessId] = useState("");
  const [runQuantity, setRunQuantity] = useState("1");
  const [stageWeights, setStageWeights] = useState<Record<string, string>>({});
  const [isRunStagesOpen, setIsRunStagesOpen] = useState(false);
  const [selectedRunForStages, setSelectedRunForStages] = useState<ProductionRun | null>(null);
  const [isStatsModalOpen, setIsStatsModalOpen] = useState(false);
  const [selectedStatsRun, setSelectedStatsRun] = useState<ProductionRun | null>(null);
  const [isHistoryOpen, setIsHistoryOpen] = useState(false);
  const [historyMonth, setHistoryMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [selectedHistoryDate, setSelectedHistoryDate] = useState(() => new Date().toISOString().slice(0, 10));
  const [hasInitializedHistory, setHasInitializedHistory] = useState(false);

  const selectedStage = form.stages[selectedStageIndex] ?? form.stages[0];
  async function loadData() {
    setIsLoading(true);
    setError(null);
    try {
      if (!getAccessToken()) {
        window.location.href = "/login";
        return;
      }
      const [user, nextProcesses, nextUsers, nextRuns, nextRawMaterials] = await Promise.all([
        getCurrentUser(),
        listProcesses(),
        listUsers(),
        listProductionRuns(),
        listInventoryItems("RAW_MATERIAL"),
      ]);
      setCurrentUser(user);
      setProcesses(nextProcesses);
      setUsers(nextUsers);
      setRuns(nextRuns);
      setRawMaterials(nextRawMaterials);
      setSelectedRunForStages((current) => (current ? nextRuns.find((run) => run.id === current.id) ?? null : null));
      setSelectedStatsRun((current) => (current ? nextRuns.find((run) => run.id === current.id) ?? null : null));
      setSelectedProcessId((current) => current || nextProcesses.find((process) => process.is_active)?.id || "");
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "No se pudo cargar produccion.");
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    void loadData();
  }, []);

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
  const activeProcesses = processes.filter((process) => process.is_active);
  const selectedProcess = processes.find((process) => process.id === selectedProcessId) ?? activeProcesses[0] ?? null;
  const selectedMaterial = rawMaterials.find((item) => item.id === selectedProcess?.raw_material_item_id) ?? null;
  const requiredMaterial = selectedProcess?.raw_material_quantity_per_unit && runQuantity
    ? Number(selectedProcess.raw_material_quantity_per_unit) * Number(runQuantity)
    : 0;
  const activeRun = runs.find((run) => run.status === "EN_PROCESO") ?? null;
  const currentRunStage = activeRun?.stages.find((stage) => stage.status === "EN_PROCESO") ?? null;
  const inProgressRuns = runs.filter((run) => run.status === "EN_PROCESO" || run.status === "PAUSADA");
  const finishedRuns = runs.filter((run) => run.status === "FINALIZADA");
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

  function stageTimingLabel(stage: ProductionRunStage) {
    if (stage.status === "FINALIZADA") return "Finalizada";
    if (stage.status === "PENDIENTE") return "Pendiente";
    if (!stage.scheduled_finish_at) return "En proceso";
    const delay = Math.ceil((Date.now() - new Date(stage.scheduled_finish_at).getTime()) / 60000);
    return delay > 0 ? `Retrasada ${delay} min` : "A tiempo";
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
    setIsRunStagesOpen(true);
  }

  function closeRunStagesModal() {
    setIsRunStagesOpen(false);
    setSelectedRunForStages(null);
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

  function updateStage(field: keyof StageForm, value: string | boolean) {
    setForm((current) => ({
      ...current,
      stages: current.stages.map((stage, index) =>
        index === selectedStageIndex ? { ...stage, [field]: value } : stage,
      ),
    }));
  }

  function buildPayload() {
    const processName = form.name.trim();
    const stages = form.stages.map((stage) => ({
      name: stage.name.trim(),
      description: stage.description.trim(),
      requiresWeighing: stage.requiresWeighing,
      estimatedMinutes: stage.estimatedMinutes.trim(),
    }));

    if (!processName) {
      throw new Error("El nombre del proceso es obligatorio.");
    }
    if (stages.some((stage) => !stage.name)) {
      throw new Error("Todas las etapas agregadas deben tener nombre.");
    }
    if (stages.some((stage) => stage.estimatedMinutes && Number(stage.estimatedMinutes) < 1)) {
      throw new Error("El tiempo de duracion de cada etapa debe ser mayor a cero.");
    }
    if (!form.rawMaterialItemId || !form.rawMaterialQuantityPerUnit || Number(form.rawMaterialQuantityPerUnit) <= 0) {
      throw new Error("Selecciona la materia prima y la cantidad por unidad del proceso.");
    }

    return {
      name: processName,
      description: form.description.trim() || null,
      version: 1,
      raw_material_item_id: form.rawMaterialItemId,
      raw_material_quantity_per_unit: form.rawMaterialQuantityPerUnit,
      raw_material_unit_code: form.rawMaterialUnitCode || "g",
      waste_limit_percent: "1",
      is_active: true,
      stages: stages.map((stage, index) => ({
        name: stage.name,
        description: stage.description || null,
        order: index + 1,
        estimated_minutes: stage.estimatedMinutes ? Number(stage.estimatedMinutes) : null,
        requires_weighing: stage.requiresWeighing,
        is_active: true,
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
      await loadData();
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

  async function handleDelete(process: ProductionProcess) {
    const confirmed = window.confirm(`Eliminar proceso "${process.name}"?`);
    if (!confirmed) return;

    setError(null);
    setSuccess(null);
    try {
      await deleteProcess(process.id);
      setSuccess("Proceso eliminado.");
      await loadData();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "No se pudo eliminar el proceso.");
    }
  }

  async function handleStartRun() {
    if (!selectedProcess) {
      setError("Selecciona un proceso para producir.");
      return;
    }
    if (!runQuantity || Number(runQuantity) <= 0) {
      setError("Ingresa una cantidad valida para fabricar.");
      return;
    }

    setError(null);
    setSuccess(null);
    setIsSaving(true);
    try {
      await createProductionRun({ process_id: selectedProcess.id, quantity: runQuantity });
      setSuccess("Produccion iniciada. Inventario registro el consumo de materia prima.");
      await loadData();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "No se pudo iniciar produccion.");
    } finally {
      setIsSaving(false);
    }
  }

  async function handleFinishStage(stage: ProductionRunStage, confirmEarlyFinish = false) {
    setError(null);
    setSuccess(null);
    setIsSaving(true);
    try {
      const finalWeight = stageWeights[stage.id]?.trim() || null;
      await finishProductionRunStage(stage.id, {
        final_weight: finalWeight,
        confirm_early_finish: confirmEarlyFinish,
      });
      setStageWeights((current) => ({ ...current, [stage.id]: "" }));
      setSuccess("Etapa registrada correctamente.");
      await loadData();
    } catch (nextError) {
      const message = nextError instanceof Error ? nextError.message : "No se pudo finalizar la etapa.";
      if (message.includes("antes del tiempo estimado")) {
        const confirmed = window.confirm(`${message}\n\nDeseas confirmar de todos modos?`);
        if (confirmed) {
          await handleFinishStage(stage, true);
          return;
        }
      }
      setError(message);
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
          email: response.user.email,
          role: response.user.role,
          temporaryPassword: response.temporary_password,
        });
        setSuccess("Usuario creado correctamente.");
      }
      await loadData();
      setIsUserCreateOpen(false);
      if (userFormMode === "edit" && returnToUsers) {
        setIsUsersOpen(true);
        setReturnToUsers(false);
      }
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "No se pudo guardar el usuario.");
    }
  }

  async function handleDeleteUser(user: ManagedUser) {
    if (user.id === currentUser?.id) {
      setError("No puedes eliminar tu propia sesion.");
      return;
    }
    const confirmed = window.confirm(`Eliminar usuario "${user.username}"?`);
    if (!confirmed) return;

    setError(null);
    setSuccess(null);
    try {
      await deleteUser(user.id);
      setSuccess("Usuario eliminado.");
      await loadData();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "No se pudo eliminar el usuario.");
    }
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
      await loadData();
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
      await loadData();
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
        email: response.user.email,
        role: response.user.role,
        temporaryPassword: response.temporary_password,
      });
      setSuccess("Contrasena restablecida correctamente.");
      await loadData();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "No se pudo restablecer la contrasena.");
    }
  }

  return (
    <div className="content">
      {error || success ? (
        <div className="toastStack" aria-live="polite">
          {error ? <div className="notice noticeError">{error}</div> : null}
          {success ? <div className="notice noticeSuccess">{success}</div> : null}
        </div>
      ) : null}

      {variant === "maintenance" ? (
        <>
          <section className="maintenanceSection" aria-label="Mantenimientos de produccion">
            <h2>Procesos</h2>
            <div className="maintenanceGrid">
              <button className="maintenanceTile" disabled={!canCreate || isLoading} onClick={openCreateForm} type="button">
                <Factory aria-hidden="true" size={22} />
                <strong>Crear proceso</strong>
                <span>Nombre del proceso y etapas configurables.</span>
              </button>
              <button
                className="maintenanceTile"
                disabled={isLoading}
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
        </>
      ) : (
        <>
          <section className="productionOpsGrid" aria-label="Operacion de produccion">
            <article className="card panelBody productionStartPanel">
              <div className="panelHeader">
                <div>
                  <h2 className="panelTitle">Produccion</h2>
                  <p className="panelText">Procesos creados en mantenimiento listos para fabricar</p>
                </div>
                <Play aria-hidden="true" size={22} />
              </div>
              <label className="fieldGroup">
                <span>Proceso</span>
                <select className="field" onChange={(event) => setSelectedProcessId(event.target.value)} value={selectedProcess?.id ?? ""}>
                  {activeProcesses.map((process) => (
                    <option key={process.id} value={process.id}>{process.name}</option>
                  ))}
                </select>
              </label>
              <label className="fieldGroup">
                <span>Cantidad a fabricar</span>
                <input className="field" min="0.0001" onChange={(event) => setRunQuantity(event.target.value)} step="0.0001" type="number" value={runQuantity} />
              </label>
              <div className="productionMaterialPreview">
                <span>
                  <strong>Materia prima</strong>
                  {selectedMaterial?.name ?? "Sin materia prima configurada"}
                </span>
                <span>
                  <strong>Consumo total</strong>
                  {numericText(requiredMaterial)} {selectedProcess?.raw_material_unit_code ?? selectedMaterial?.unit_code ?? ""}
                </span>
                <span>
                  <strong>Stock disponible</strong>
                  {selectedMaterial ? `${numericText(selectedMaterial.current_stock)} ${selectedMaterial.unit_code}` : "0"}
                </span>
              </div>
              <button className="button buttonPrimary" disabled={isSaving || !selectedProcess} onClick={() => void handleStartRun()} type="button">
                <Play aria-hidden="true" size={17} />
                Empezar
              </button>
            </article>

            <article className="card panelBody productionTimelinePanel">
              <div className="panelHeader">
                <div>
                  <h2 className="panelTitle">Procesos en transcurso</h2>
                  <p className="panelText">{inProgressRuns.length} procesos activos</p>
                </div>
                <Clock aria-hidden="true" size={22} />
              </div>
              {inProgressRuns.length > 0 ? (
                <div className="productionRunningList">
                  {inProgressRuns.map((run) => {
                    const currentStage = run.stages.find((stage) => stage.status === "EN_PROCESO") ?? run.stages.find((stage) => stage.status === "PENDIENTE") ?? null;
                    return (
                      <article className="productionCard productionCardCompact" key={run.id}>
                        <div className="productionCardHeader">
                          <div>
                            <strong>{run.process_name}</strong>
                            <span>{run.quantity} unidades</span>
                          </div>
                          <span className="statusPill">{run.status === "PAUSADA" ? "Pausado" : "En curso"}</span>
                        </div>
                        <p className="panelText">{currentStage ? `Etapa actual: ${currentStage.stage_name}` : "Proceso listo para continuar"}</p>
                        <div className="productionCardMeta">
                          <span>Inicio: {timeLabel(run.started_at)}</span>
                          <span>Material: {numericText(run.total_required_material)} {run.raw_material_unit_code}</span>
                        </div>
                        <div className="rowActions">
                          <button className="button buttonPrimary" onClick={() => openRunStagesModal(run)} type="button">
                            Ver etapas
                          </button>
                        </div>
                      </article>
                    );
                  })}
                </div>
              ) : (
                <div className="emptyState">No hay procesos en transcurso.</div>
              )}
            </article>
          </section>

          <section className="productionOpsGrid" aria-label="Historial de produccion">
            <article className="card panelBody productionTimelinePanel">
              <div className="panelHeader">
                <div>
                  <h2 className="panelTitle">Historial de procesos</h2>
                  <p className="panelText">Últimos procesos finalizados</p>
                </div>
                <button
                  aria-label="Ver historial completo"
                  className="iconOnlyButton"
                  disabled={finishedRuns.length === 0}
                  onClick={() => setIsHistoryOpen(true)}
                  title="Historial completo"
                  type="button"
                >
                  <Eye aria-hidden="true" size={22} />
                </button>
              </div>
              {recentFinishedRuns.length > 0 ? (
                <div className="productionHistoryList">
                  {recentFinishedRuns.map((run) => (
                    <article className="productionCard productionCardCompact" key={run.id}>
                      <div className="productionCardHeader">
                        <div>
                          <strong>{run.process_name}</strong>
                          <span>{run.quantity} unidades</span>
                        </div>
                        <button className="iconOnlyButton" onClick={() => setIsHistoryOpen(true)} type="button" aria-label="Ver historial de procesos">
                          <Eye aria-hidden="true" size={18} />
                        </button>
                      </div>
                      <p className="panelText">Finalizado: {timeLabel(run.finished_at)}</p>
                      <div className="productionCardMeta">
                        <span>Merma: {numericText(run.waste_weight)} {run.raw_material_unit_code}</span>
                        <span>{numericText(run.waste_percent)}%</span>
                      </div>
                    </article>
                  ))}
                </div>
              ) : (
                <div className="emptyState">No hay historial disponible.</div>
              )}
            </article>
          </section>
        </>
      )}

      {isRunStagesOpen && selectedRunForStages ? (
        <div className="modalBackdrop" role="dialog" aria-modal="true" aria-label="Etapas del proceso">
          <section className="modalWindow processViewWindow">
            <div className="modalHeader">
              <div>
                <h2>{selectedRunForStages.process_name}</h2>
                <p>{selectedRunForStages.quantity} unidades</p>
              </div>
              <button className="iconOnlyButton" onClick={closeRunStagesModal} type="button">
                <X aria-hidden="true" size={18} />
              </button>
            </div>
            <div className="stageSummaryList">
              {selectedRunForStages.stages.map((stage, index, stages) => {
                const canManage = canManageStage(stage, index, stages);
                return (
                  <div className="stageSummary" key={stage.id}>
                    <div>
                      <strong>{stage.stage_order}. {stage.stage_name}</strong>
                      <span>{stageTimingLabel(stage)}</span>
                    </div>
                    <small>{timeLabel(stage.scheduled_start_at)} - {timeLabel(stage.scheduled_finish_at)}</small>
                    {canManage ? (
                      <div className="stageFinishBox">
                        {stage.requires_weighing ? (
                          <input
                            className="field"
                            min="0"
                            onChange={(event) => setStageWeights((current) => ({ ...current, [stage.id]: event.target.value }))}
                            placeholder="Peso final"
                            step="0.0001"
                            type="number"
                            value={stageWeights[stage.id] ?? ""}
                          />
                        ) : null}
                        <button className="button" onClick={() => void handleFinishStage(stage)} type="button">
                          {stage.status === "PENDIENTE" ? "Iniciar y terminar etapa" : "Finalizar etapa"}
                        </button>
                      </div>
                    ) : null}
                  </div>
                );
              })}
            </div>
          </section>
        </div>
      ) : null}

      {isStatsModalOpen && selectedStatsRun ? (
        <div className="modalBackdrop" role="dialog" aria-modal="true" aria-label="Estadisticas del proceso">
          <section className="modalWindow processViewWindow">
            <div className="modalHeader">
              <div>
                <h2>{selectedStatsRun.process_name}</h2>
                <p>{selectedStatsRun.quantity} unidades</p>
              </div>
              <button className="iconOnlyButton" onClick={closeStatsModal} type="button">
                <X aria-hidden="true" size={18} />
              </button>
            </div>
            <div className="userPreviewGrid">
              <span>
                <strong>Estado</strong>
                {selectedStatsRun.status}
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
              <button className="iconOnlyButton" onClick={() => setIsHistoryOpen(false)} type="button">
                <X aria-hidden="true" size={18} />
              </button>
            </div>
            <div className="movementHistoryLayout">
              <section className="movementCalendarPanel" aria-label="Calendario de procesos">
                <div className="movementCalendarHeader">
                  <button className="iconOnlyButton" onClick={() => moveHistoryMonth(-1)} type="button">
                    <ChevronLeft aria-hidden="true" size={18} />
                  </button>
                  <strong>{monthLabel(currentHistoryMonth)}</strong>
                  <button className="iconOnlyButton" onClick={() => moveHistoryMonth(1)} type="button">
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
                    <article className="movementRow" key={run.id}>
                      <div>
                        <strong>{run.process_name}</strong>
                        <span>{timeLabel(run.finished_at)}</span>
                      </div>
                      <div>
                        <strong>{run.quantity} unidades</strong>
                        <span>{numericText(run.waste_percent)}% merma</span>
                        <span>{numericText(run.waste_weight)} {run.raw_material_unit_code}</span>
                      </div>
                      <button className="button buttonSecondary" onClick={() => openStatsModal(run)} type="button">
                        Ver estadisticas
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
              <button className="iconOnlyButton" onClick={closeProcessForm} type="button">
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

            <div className="formGrid">
              <label className="fieldGroup">
                <span>Materia prima por unidad</span>
                <select
                  className="field"
                  disabled={isSaving}
                  onChange={(event) => {
                    const material = rawMaterials.find((item) => item.id === event.target.value);
                    setForm((current) => ({
                      ...current,
                      rawMaterialItemId: event.target.value,
                      rawMaterialUnitCode: material?.unit_code ?? current.rawMaterialUnitCode,
                    }));
                  }}
                  value={form.rawMaterialItemId}
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
                  onChange={(event) => setForm((current) => ({ ...current, rawMaterialQuantityPerUnit: event.target.value }))}
                  step="0.0001"
                  type="number"
                  value={form.rawMaterialQuantityPerUnit}
                />
              </label>
              <label className="fieldGroup">
                <span>Unidad de materia prima</span>
                <input className="field" disabled value={form.rawMaterialUnitCode} />
              </label>
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
                    <label className="checkControl">
                      <input
                        checked={selectedStage.requiresWeighing}
                        disabled={isSaving}
                        onChange={(event) => updateStage("requiresWeighing", event.target.checked)}
                        type="checkbox"
                      />
                      <span>Requiere pesaje</span>
                    </label>
                    <label className="fieldGroup">
                      <span>Tiempo estimado en minutos</span>
                      <input
                        aria-label="Tiempo estimado en minutos"
                        className="field"
                        disabled={isSaving}
                        min="1"
                        onChange={(event) => updateStage("estimatedMinutes", event.target.value)}
                        placeholder="Ejemplo: 30"
                        type="number"
                        value={selectedStage.estimatedMinutes}
                      />
                    </label>
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

      {isProcessesOpen ? (
        <div className="modalBackdrop" role="dialog" aria-modal="true" aria-label="Procesos creados">
          <section className="modalWindow processesWindow">
            <div className="modalHeader">
              <div>
                <h2>Procesos</h2>
                <p>{processes.length} procesos creados</p>
              </div>
              <button className="iconOnlyButton" onClick={() => setIsProcessesOpen(false)} type="button">
                <X aria-hidden="true" size={18} />
              </button>
            </div>

            <div className="processesLayout">
              <div className="processList">
                {processes.map((process) => (
                  <article className="processRow" key={process.id}>
                    <button
                      className="linkButton"
                      onClick={() => {
                        setViewingProcess(process);
                      }}
                      type="button"
                    >
                      {process.name}
                    </button>
                    <span>{process.stages.length} etapas</span>
                    <div className="rowActions">
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
          <section className="modalWindow processViewWindow">
            <div className="modalHeader">
              <div>
                <h2>{viewingProcess.name}</h2>
                <p>{viewingProcess.stages.length} etapas configuradas</p>
              </div>
              <button className="iconOnlyButton" onClick={() => setViewingProcess(null)} type="button">
                <X aria-hidden="true" size={18} />
              </button>
            </div>
            <p className="panelText">{viewingProcess.description || "Sin descripcion"}</p>
            <div className="stageSummaryList">
              {viewingProcess.stages.map((stage) => (
                <div className="stageSummary" key={stage.id}>
                  <strong>{stage.stage_order}. {stage.name}</strong>
                  <span>{stage.description || "Sin descripcion"}</span>
                  <small>
                    {stage.requires_weighing ? "Requiere pesaje" : "Sin pesaje"} -{" "}
                    {stage.estimated_minutes ? `${stage.estimated_minutes} min` : "Sin duracion"}
                  </small>
                </div>
              ))}
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
              <button className="iconOnlyButton" onClick={closeUserForm} type="button">
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
              <button className="iconOnlyButton" onClick={() => setIsUsersOpen(false)} type="button">
                <X aria-hidden="true" size={18} />
              </button>
            </div>
            <div className="processList">
              {users.map((user) => (
                <article className={`processRow userRow ${!user.is_active ? "userRowInactive" : ""}`} key={user.id}>
                  <div className="userRowHeader">
                    <strong>{user.first_name} {user.last_name}</strong>
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
                  <div className="rowActions">
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
              <button className="iconOnlyButton" onClick={() => setViewingUser(null)} type="button">
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
              <button className="iconOnlyButton" onClick={() => setGeneratedCredentials(null)} type="button">
                <X aria-hidden="true" size={18} />
              </button>
            </div>
            <div className="credentialsStack">
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
    </div>
  );
}
