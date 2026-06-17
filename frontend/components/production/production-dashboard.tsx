"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import { Clock, Factory, PackageCheck, PauseCircle, Play, Plus, RefreshCw, Scale, XCircle } from "lucide-react";
import { getCurrentUser, type CurrentUser } from "@/lib/auth-api";
import { clearAccessToken, getAccessToken } from "@/lib/api";
import {
  cancelProductionOrder,
  createProcessTemplate,
  createProductionOrder,
  finishProductionStage,
  listProcessTemplates,
  listProductionOrders,
  pauseProductionOrder,
  resumeProductionOrder,
  startProductionOrder,
  startProductionStage,
} from "@/lib/production-api";
import { StatusBadge } from "@/components/ui/status-badge";
import type { ProcessTemplate, ProductionOrder, ProductionOrderStage, ProductionOrderStatus } from "@/types/production";

type ProcessStageForm = {
  name: string;
  description: string;
  requiresWeighing: boolean;
  estimatedMinutes: string;
};

type ProcessForm = {
  name: string;
  description: string;
  stages: ProcessStageForm[];
};

const EXECUTION_STATUSES: Array<{ label: string; value: ProductionOrderStatus | "TODOS" }> = [
  { label: "Todos los estados", value: "TODOS" },
  { label: "Pendiente", value: "PENDIENTE" },
  { label: "En proceso", value: "EN_PROCESO" },
  { label: "Pausada", value: "PAUSADA" },
  { label: "Finalizada", value: "FINALIZADA" },
  { label: "Cancelada", value: "CANCELADA" },
];

function emptyProcessForm(): ProcessForm {
  return {
    name: "",
    description: "",
    stages: [
      { name: "", description: "", requiresWeighing: false, estimatedMinutes: "" },
      { name: "", description: "", requiresWeighing: false, estimatedMinutes: "" },
    ],
  };
}

function shortId(id: string) {
  return id.slice(0, 8);
}

function processName(execution: ProductionOrder, processes: ProcessTemplate[]) {
  return (
    execution.process_snapshot.name ??
    processes.find((process) => process.id === execution.process_template_id)?.name ??
    shortId(execution.process_template_id)
  );
}

function elapsedText(startedAt: string | null, now: number) {
  if (!startedAt) return "Sin iniciar";
  const elapsedSeconds = Math.max(0, Math.floor((now - new Date(startedAt).getTime()) / 1000));
  const hours = Math.floor(elapsedSeconds / 3600);
  const minutes = Math.floor((elapsedSeconds % 3600) / 60);
  const seconds = elapsedSeconds % 60;
  if (hours > 0) return `${hours}h ${minutes}m`;
  if (minutes > 0) return `${minutes}m ${seconds}s`;
  return `${seconds}s`;
}

function currentStage(execution: ProductionOrder) {
  return (
    execution.stages.find((stage) => stage.status === "EN_PROCESO") ??
    execution.stages.find((stage) => stage.status === "PENDIENTE") ??
    execution.stages[execution.stages.length - 1] ??
    null
  );
}

function stageDuration(stage: ProductionOrderStage) {
  return stage.estimated_minutes ? `${stage.estimated_minutes} min` : "Sin tiempo";
}

export function ProductionDashboard() {
  const [processes, setProcesses] = useState<ProcessTemplate[]>([]);
  const [executions, setExecutions] = useState<ProductionOrder[]>([]);
  const [processForm, setProcessForm] = useState<ProcessForm>(emptyProcessForm);
  const [selectedProcessId, setSelectedProcessId] = useState("");
  const [rawMaterialQuantity, setRawMaterialQuantity] = useState("1");
  const [selectedExecutionId, setSelectedExecutionId] = useState<string | null>(null);
  const [stageInputs, setStageInputs] = useState<Record<string, { weight: string; waste: string; observations: string }>>({});
  const [statusFilter, setStatusFilter] = useState<ProductionOrderStatus | "TODOS">("TODOS");
  const [search, setSearch] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isSavingProcess, setIsSavingProcess] = useState(false);
  const [isStartingProcess, setIsStartingProcess] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [currentUser, setCurrentUser] = useState<CurrentUser | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const [now, setNow] = useState(Date.now());

  useEffect(() => {
    const interval = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(interval);
  }, []);

  async function loadProductionData() {
    setIsLoading(true);
    setError(null);
    try {
      if (!getAccessToken()) {
        window.location.href = "/login";
        return;
      }
      const [user, nextProcesses, nextExecutions] = await Promise.all([
        getCurrentUser(),
        listProcessTemplates(),
        listProductionOrders(),
      ]);
      setCurrentUser(user);
      setProcesses(nextProcesses);
      setExecutions(nextExecutions);
      setSelectedProcessId((current) => current || nextProcesses[0]?.id || "");
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "No se pudo cargar produccion.");
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    void loadProductionData();
  }, []);

  const filteredExecutions = useMemo(() => {
    return executions.filter((execution) => {
      const matchesStatus = statusFilter === "TODOS" || execution.status === statusFilter;
      const term = search.trim().toLowerCase();
      const matchesSearch =
        term.length === 0 ||
        execution.id.toLowerCase().includes(term) ||
        processName(execution, processes).toLowerCase().includes(term);
      return matchesStatus && matchesSearch;
    });
  }, [executions, processes, search, statusFilter]);

  const selectedExecution = useMemo(() => {
    return executions.find((execution) => execution.id === selectedExecutionId) ?? filteredExecutions[0] ?? null;
  }, [executions, filteredExecutions, selectedExecutionId]);

  const metrics = useMemo(() => {
    return [
      { label: "Procesos creados", value: String(processes.length) },
      { label: "Procesos activos", value: String(executions.filter((execution) => execution.status === "EN_PROCESO").length) },
      { label: "Pausados", value: String(executions.filter((execution) => execution.status === "PAUSADA").length) },
      { label: "Pendientes", value: String(executions.filter((execution) => execution.status === "PENDIENTE").length) },
    ];
  }, [executions, processes]);

  const canCreateProcess = currentUser?.permissions.includes("production.process_templates.create") ?? false;
  const canStartProcess = currentUser?.permissions.includes("production.create") ?? false;
  const canOperateProcess = currentUser?.permissions.includes("production.start") ?? false;

  function updateStageForm(index: number, field: keyof ProcessStageForm, value: string | boolean) {
    setProcessForm((current) => ({
      ...current,
      stages: current.stages.map((stage, stageIndex) =>
        stageIndex === index ? { ...stage, [field]: value } : stage,
      ),
    }));
  }

  function updateStageInput(stageId: string, field: "weight" | "waste" | "observations", value: string) {
    setStageInputs((current) => ({
      ...current,
      [stageId]: { ...(current[stageId] ?? { weight: "", waste: "", observations: "" }), [field]: value },
    }));
  }

  async function handleCreateProcess(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const activeStages = processForm.stages
      .map((stage) => ({
        ...stage,
        name: stage.name.trim(),
        description: stage.description.trim(),
        estimatedMinutes: stage.estimatedMinutes.trim(),
      }))
      .filter((stage) => stage.name.length > 0);

    if (!processForm.name.trim()) {
      setError("El nombre del proceso es obligatorio.");
      return;
    }
    if (activeStages.length === 0) {
      setError("El proceso debe tener al menos una etapa.");
      return;
    }

    setIsSavingProcess(true);
    setError(null);
    setSuccess(null);
    try {
      const process = await createProcessTemplate({
        name: processForm.name.trim(),
        description: processForm.description.trim() || null,
        product_id: null,
        version: 1,
        is_active: true,
        stages: activeStages.map((stage, index) => ({
          name: stage.name,
          description: stage.description || null,
          order: index + 1,
          estimated_minutes: stage.estimatedMinutes ? Number(stage.estimatedMinutes) : null,
          requires_initial_weight: stage.requiresWeighing,
          requires_final_weight: stage.requiresWeighing,
          allows_waste: stage.requiresWeighing,
          requires_observation: false,
          is_required: true,
          is_active: true,
        })),
      });
      setProcessForm(emptyProcessForm());
      setSelectedProcessId(process.id);
      setSuccess("Proceso creado.");
      await loadProductionData();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "No se pudo crear el proceso.");
    } finally {
      setIsSavingProcess(false);
    }
  }

  async function handleStartProcess(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selectedProcessId) {
      setError("Selecciona un proceso creado.");
      return;
    }
    if (Number(rawMaterialQuantity) <= 0) {
      setError("La cantidad de materia prima debe ser mayor a cero.");
      return;
    }

    setIsStartingProcess(true);
    setError(null);
    setSuccess(null);
    try {
      const execution = await createProductionOrder({
        product_id: crypto.randomUUID(),
        quantity: rawMaterialQuantity,
        process_template_id: selectedProcessId,
        notes: `Materia prima inicial: ${rawMaterialQuantity}`,
      });
      await startProductionOrder(execution.id);
      setRawMaterialQuantity("1");
      setSelectedExecutionId(execution.id);
      setSuccess("Proceso iniciado.");
      await loadProductionData();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "No se pudo iniciar el proceso.");
    } finally {
      setIsStartingProcess(false);
    }
  }

  async function runExecutionAction(id: string, action: (id: string) => Promise<ProductionOrder>, message: string) {
    setBusyId(id);
    setError(null);
    setSuccess(null);
    try {
      const execution = await action(id);
      setSelectedExecutionId(execution.id);
      setSuccess(message);
      await loadProductionData();
    } catch (nextError) {
      setError(nextError instanceof Error ? nextError.message : "No se pudo ejecutar la accion.");
    } finally {
      setBusyId(null);
    }
  }

  async function startStage(stageId: string) {
    const input = stageInputs[stageId] ?? { weight: "", waste: "", observations: "" };
    await runExecutionAction(
      stageId,
      () =>
        startProductionStage(stageId, {
          initial_weight: input.weight || null,
          observations: input.observations || null,
        }),
      "Etapa iniciada.",
    );
  }

  async function advanceStage(stageId: string) {
    const input = stageInputs[stageId] ?? { weight: "", waste: "", observations: "" };
    await runExecutionAction(
      stageId,
      () =>
        finishProductionStage(stageId, {
          final_weight: input.weight || null,
          waste_weight: input.waste || null,
          observations: input.observations || null,
        }),
      "Etapa finalizada.",
    );
  }

  return (
    <div className="content">
      <section className="pageHeader">
        <div>
          <h1>Produccion</h1>
          <p>Configuracion de procesos y ejecucion operativa por etapas para el jefe de produccion.</p>
          {currentUser ? (
            <p className="sessionLine">
              Sesion: {currentUser.username} · {currentUser.role}
            </p>
          ) : null}
        </div>
        <div className="actions">
          <button className="button" disabled={isLoading} onClick={() => void loadProductionData()} type="button">
            <RefreshCw aria-hidden="true" size={17} />
            Actualizar
          </button>
          <button
            className="button"
            onClick={() => {
              clearAccessToken();
              window.location.href = "/login";
            }}
            type="button"
          >
            Salir
          </button>
        </div>
      </section>

      {error ? <div className="notice noticeError">{error}</div> : null}
      {success ? <div className="notice noticeSuccess">{success}</div> : null}

      <section className="summaryGrid" aria-label="Resumen de produccion">
        {metrics.map((metric) => (
          <article className="card metric" key={metric.label}>
            <span className="metricLabel">{metric.label}</span>
            <strong className="metricValue">{metric.value}</strong>
          </article>
        ))}
      </section>

      <section className="formGrid">
        {canCreateProcess ? (
        <form className="card panelBody" onSubmit={handleCreateProcess}>
          <h2 className="panelTitle">Crear proceso</h2>
          <input
            className="field"
            maxLength={180}
            onChange={(event) => setProcessForm((current) => ({ ...current, name: event.target.value }))}
            placeholder="Nombre del proceso"
            value={processForm.name}
          />
          <textarea
            className="field textarea"
            maxLength={1000}
            onChange={(event) => setProcessForm((current) => ({ ...current, description: event.target.value }))}
            placeholder="Descripcion del proceso"
            value={processForm.description}
          />
          <div className="stageFormList">
            {processForm.stages.map((stage, index) => (
              <div className="stageFormItem" key={index}>
                <strong>Etapa {index + 1}</strong>
                <input
                  className="field"
                  maxLength={180}
                  onChange={(event) => updateStageForm(index, "name", event.target.value)}
                  placeholder="Nombre"
                  value={stage.name}
                />
                <textarea
                  className="field textareaCompact"
                  maxLength={1000}
                  onChange={(event) => updateStageForm(index, "description", event.target.value)}
                  placeholder="Descripcion"
                  value={stage.description}
                />
                <div className="stageOptions">
                  <label className="checkControl">
                    <input
                      checked={stage.requiresWeighing}
                      onChange={(event) => updateStageForm(index, "requiresWeighing", event.target.checked)}
                      type="checkbox"
                    />
                    <span>Requiere pesaje</span>
                  </label>
                  <input
                    className="field"
                    min="1"
                    onChange={(event) => updateStageForm(index, "estimatedMinutes", event.target.value)}
                    placeholder="Duracion min"
                    type="number"
                    value={stage.estimatedMinutes}
                  />
                </div>
              </div>
            ))}
          </div>
          <button
            className="button"
            onClick={() =>
              setProcessForm((current) => ({
                ...current,
                stages: [...current.stages, { name: "", description: "", requiresWeighing: false, estimatedMinutes: "" }],
              }))
            }
            type="button"
          >
            <Plus aria-hidden="true" size={17} />
            Agregar etapa
          </button>
          <button className="button buttonPrimary" disabled={isSavingProcess} type="submit">
            <Factory aria-hidden="true" size={17} />
            {isSavingProcess ? "Guardando" : "Crear proceso"}
          </button>
        </form>
        ) : (
          <section className="card panelBody">
            <h2 className="panelTitle">Crear proceso</h2>
            <div className="emptyState">Tu cuenta puede revisar procesos, pero no crear configuracion.</div>
          </section>
        )}

        {canStartProcess ? (
        <form className="card panelBody" onSubmit={handleStartProcess}>
          <h2 className="panelTitle">Jefe de produccion</h2>
          <select
            className="field"
            onChange={(event) => setSelectedProcessId(event.target.value)}
            value={selectedProcessId}
          >
            <option value="">Selecciona proceso</option>
            {processes.map((process) => (
              <option key={process.id} value={process.id}>
                {process.name} · {process.stages.length} etapas
              </option>
            ))}
          </select>
          <input
            className="field"
            min="0.0001"
            onChange={(event) => setRawMaterialQuantity(event.target.value)}
            placeholder="Cantidad de materia prima"
            step="0.0001"
            type="number"
            value={rawMaterialQuantity}
          />
          <button className="button buttonPrimary" disabled={isStartingProcess || processes.length === 0} type="submit">
            <Play aria-hidden="true" size={17} />
            {isStartingProcess ? "Iniciando" : "Iniciar proceso"}
          </button>
          <div className="templateList">
            {processes.map((process) => (
              <button
                className={`processPicker ${selectedProcessId === process.id ? "processPickerActive" : ""}`}
                key={process.id}
                onClick={() => setSelectedProcessId(process.id)}
                type="button"
              >
                <strong>{process.name}</strong>
                <span>{process.stages.length} etapas</span>
              </button>
            ))}
          </div>
        </form>
        ) : (
          <section className="card panelBody">
            <h2 className="panelTitle">Jefe de produccion</h2>
            <div className="templateList">
              {processes.map((process) => (
                <div className="templateItem" key={process.id}>
                  <strong>{process.name}</strong>
                  <span>{process.stages.length} etapas</span>
                </div>
              ))}
            </div>
          </section>
        )}
      </section>

      <section className="card">
        <div className="toolbar">
          <div className="filters">
            <input
              className="field"
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Buscar proceso en ejecucion"
              value={search}
            />
            <select
              className="field"
              onChange={(event) => setStatusFilter(event.target.value as ProductionOrderStatus | "TODOS")}
              value={statusFilter}
            >
              {EXECUTION_STATUSES.map((statusOption) => (
                <option key={statusOption.value} value={statusOption.value}>
                  {statusOption.label}
                </option>
              ))}
            </select>
          </div>
          <span className="metricLabel">{filteredExecutions.length} procesos</span>
        </div>
        <div className="tableWrap">
          <table className="table">
            <thead>
              <tr>
                <th>Proceso</th>
                <th>Materia prima</th>
                <th>Estado</th>
                <th>Etapa actual</th>
                <th>Tiempo proceso</th>
                <th>Acciones</th>
              </tr>
            </thead>
            <tbody>
              {filteredExecutions.map((execution) => {
                const stage = currentStage(execution);
                const isBusy = busyId === execution.id;
                return (
                  <tr key={execution.id}>
                    <td>
                      <button className="linkButton" onClick={() => setSelectedExecutionId(execution.id)} type="button">
                        {processName(execution, processes)}
                      </button>
                    </td>
                    <td>{execution.quantity}</td>
                    <td>
                      <StatusBadge status={execution.status} />
                    </td>
                    <td>{stage ? `${stage.stage_order}. ${stage.stage_name}` : "Sin etapas"}</td>
                    <td>{elapsedText(execution.started_at, now)}</td>
                    <td>
                      <div className="rowActions">
                        {canOperateProcess && execution.status === "EN_PROCESO" ? (
                          <button
                            className="iconTextButton"
                            disabled={isBusy}
                            onClick={() => void runExecutionAction(execution.id, pauseProductionOrder, "Proceso pausado.")}
                            type="button"
                          >
                            <PauseCircle aria-hidden="true" size={15} />
                            Pausar
                          </button>
                        ) : null}
                        {canOperateProcess && execution.status === "PAUSADA" ? (
                          <button
                            className="iconTextButton"
                            disabled={isBusy}
                            onClick={() => void runExecutionAction(execution.id, resumeProductionOrder, "Proceso reanudado.")}
                            type="button"
                          >
                            <Play aria-hidden="true" size={15} />
                            Reanudar
                          </button>
                        ) : null}
                        {canOperateProcess && !["FINALIZADA", "CANCELADA"].includes(execution.status) ? (
                          <button
                            className="iconTextButton dangerText"
                            disabled={isBusy}
                            onClick={() => void runExecutionAction(execution.id, cancelProductionOrder, "Proceso cancelado.")}
                            type="button"
                          >
                            <XCircle aria-hidden="true" size={15} />
                            Cancelar
                          </button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
          {!isLoading && filteredExecutions.length === 0 ? (
            <div className="emptyState">
              <Factory aria-hidden="true" size={26} />
              <span>No hay procesos en ejecucion para los filtros actuales.</span>
            </div>
          ) : null}
          {isLoading ? <div className="emptyState">Cargando produccion...</div> : null}
        </div>
      </section>

      <section className="card panelBody">
        <h2 className="panelTitle">Avance por etapas</h2>
        {selectedExecution ? (
          <>
            <p className="panelText">
              {processName(selectedExecution, processes)} · Materia prima {selectedExecution.quantity} ·{" "}
              {elapsedText(selectedExecution.started_at, now)}
            </p>
            <div className="stageTimeline">
              {selectedExecution.stages.map((stage) => {
                const input = stageInputs[stage.id] ?? { weight: "", waste: "", observations: "" };
                const canStart = selectedExecution.status === "EN_PROCESO" && stage.status === "PENDIENTE";
                const canAdvance = selectedExecution.status === "EN_PROCESO" && stage.status === "EN_PROCESO";
                const isBusy = busyId === stage.id;
                return (
                  <article className="stageItem" key={stage.id}>
                    <div className="stageHeader">
                      <div>
                        <strong>
                          {stage.stage_order}. {stage.stage_name}
                        </strong>
                        <p className="panelText">{stage.stage_description || "Sin descripcion"}</p>
                      </div>
                      <StatusBadge status={stage.status} />
                    </div>
                    <div className="stageMeta">
                      <span>
                        <Clock aria-hidden="true" size={15} />
                        Duracion: {stageDuration(stage)}
                      </span>
                      <span>
                        <Clock aria-hidden="true" size={15} />
                        Transcurrido: {elapsedText(stage.started_at, now)}
                      </span>
                      {stage.requires_initial_weight || stage.requires_final_weight ? (
                        <span>
                          <Scale aria-hidden="true" size={15} />
                          Requiere pesaje
                        </span>
                      ) : null}
                    </div>
                    <div className="stageGrid">
                      {stage.requires_initial_weight || stage.requires_final_weight ? (
                        <input
                          className="field"
                          min="0.0001"
                          onChange={(event) => updateStageInput(stage.id, "weight", event.target.value)}
                          placeholder="Peso"
                          step="0.0001"
                          type="number"
                          value={input.weight}
                        />
                      ) : null}
                      {stage.allows_waste ? (
                        <input
                          className="field"
                          min="0"
                          onChange={(event) => updateStageInput(stage.id, "waste", event.target.value)}
                          placeholder="Merma"
                          step="0.0001"
                          type="number"
                          value={input.waste}
                        />
                      ) : null}
                      <input
                        className="field"
                        onChange={(event) => updateStageInput(stage.id, "observations", event.target.value)}
                        placeholder="Observacion"
                        value={input.observations}
                      />
                    </div>
                    <div className="rowActions">
                      <button
                        className="iconTextButton"
                        disabled={!canOperateProcess || !canStart || isBusy}
                        onClick={() => void startStage(stage.id)}
                        type="button"
                      >
                        <Play aria-hidden="true" size={15} />
                        Iniciar etapa
                      </button>
                      <button
                        className="iconTextButton"
                        disabled={!canOperateProcess || !canAdvance || isBusy}
                        onClick={() => void advanceStage(stage.id)}
                        type="button"
                      >
                        <PackageCheck aria-hidden="true" size={15} />
                        Avanzar
                      </button>
                    </div>
                  </article>
                );
              })}
            </div>
          </>
        ) : (
          <div className="emptyState">
            <Factory aria-hidden="true" size={26} />
            <span>Inicia o selecciona un proceso para avanzar por sus etapas.</span>
          </div>
        )}
      </section>
    </div>
  );
}
