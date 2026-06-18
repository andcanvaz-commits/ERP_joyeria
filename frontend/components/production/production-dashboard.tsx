"use client";

import { FormEvent, useEffect, useState } from "react";
import { ArrowLeft, ArrowRight, Eye, Factory, Pencil, Plus, Save, Trash2, UserPlus, Users, X } from "lucide-react";
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
import { createProcess, deleteProcess, listProcesses, updateProcess } from "@/lib/production-api";
import type { ProductionProcess } from "@/types/production";

type StageForm = {
  name: string;
  description: string;
  requiresWeighing: boolean;
  estimatedMinutes: string;
};

type ProcessForm = {
  name: string;
  description: string;
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
    stages: stages.length > 0 ? stages.map((stage) => ({
      name: stage.name,
      description: stage.description ?? "",
      requiresWeighing: stage.requires_weighing,
      estimatedMinutes: stage.estimated_minutes ? String(stage.estimated_minutes) : "",
    })) : [emptyStage()],
  };
}

export function ProductionDashboard() {
  const [form, setForm] = useState<ProcessForm>(emptyProcessForm);
  const [processes, setProcesses] = useState<ProductionProcess[]>([]);
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

  const selectedStage = form.stages[selectedStageIndex] ?? form.stages[0];
  async function loadData() {
    setIsLoading(true);
    setError(null);
    try {
      if (!getAccessToken()) {
        window.location.href = "/login";
        return;
      }
      const [user, nextProcesses, nextUsers] = await Promise.all([getCurrentUser(), listProcesses(), listUsers()]);
      setCurrentUser(user);
      setProcesses(nextProcesses);
      setUsers(nextUsers);
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

    return {
      name: processName,
      description: form.description.trim() || null,
      version: 1,
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

      <section className="maintenanceSection" aria-label="Mantenimientos de produccion">
        <h2>Produccion</h2>
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
