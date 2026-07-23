"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Eye, X } from "lucide-react";
import { isAuthenticated } from "@/lib/api";
import { getCurrentUser } from "@/lib/auth-api";
import { normalizeRole } from "@/lib/roles";
import { listProductionRuns } from "@/lib/production-api";
import type { ProductionRun } from "@/types/production";

const STATUS_LABELS: Record<ProductionRun["status"], string> = {
  PENDIENTE_INVENTARIO: "Pendiente de inventario",
  MATERIALES_APROBADOS: "Materiales aprobados",
  EN_PROCESO: "En proceso",
  PENDIENTE_RECEPCION: "Pendiente de recepcion",
  RECIBIDA: "Recibida",
  CANCELADA: "Rechazada / cancelada",
};

const STAGE_STATUS_LABELS: Record<string, string> = {
  PENDIENTE: "Pendiente",
  EN_PROCESO: "En proceso",
  FINALIZADA: "Finalizada",
};

function dateTimeLabel(value: string | null) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString("es-EC", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
}

function num(value: string | null) {
  if (!value) return "0";
  const n = Number(value);
  return Number.isFinite(n) ? n.toLocaleString("es-EC", { maximumFractionDigits: 4 }) : value;
}

function RunDetail({ run, onClose }: { run: ProductionRun; onClose: () => void }) {
  const timeline: Array<[string, string | null]> = [
    ["Solicitada", run.requested_at],
    ["Materiales aprobados", run.materials_approved_at],
    ["Iniciada", run.started_at],
    ["Finalizada", run.finished_at],
    ["Recibida", run.received_at],
  ];
  return (
    <div className="modalBackdrop" role="dialog" aria-modal="true" aria-label="Detalle de solicitud">
      <section className="modalWindow processViewWindow">
        <div className="modalHeader">
          <div>
            <h2 style={{ fontFamily: "monospace", letterSpacing: 1 }}>{run.production_code ?? "Sin codigo"}</h2>
            <p>{run.process_name}</p>
          </div>
          <button aria-label="Cerrar" className="iconOnlyButton" onClick={onClose} type="button">
            <X aria-hidden="true" size={18} />
          </button>
        </div>

        <div className="summaryGrid">
          <article className="card metric">
            <span className="metricLabel">Estado</span>
            <strong className="metricValue" style={{ fontSize: 16 }}>{STATUS_LABELS[run.status]}</strong>
          </article>
          <article className="card metric">
            <span className="metricLabel">Cantidad</span>
            <strong className="metricValue">{num(run.quantity)}</strong>
          </article>
          <article className="card metric">
            <span className="metricLabel">Material requerido</span>
            <strong className="metricValue" style={{ fontSize: 18 }}>{num(run.total_required_material)} {run.raw_material_unit_code}</strong>
          </article>
        </div>

        <div className="credentialsStack">
          <span><strong>Proceso</strong>{run.process_name}</span>
          <span><strong>Material por unidad</strong>{num(run.raw_material_quantity_per_unit)} {run.raw_material_unit_code}</span>
          <span><strong>Peso esperado</strong>{num(run.expected_finished_weight)}</span>
          <span><strong>Peso real</strong>{run.actual_finished_weight ? num(run.actual_finished_weight) : "-"}</span>
          <span><strong>Merma</strong>{run.waste_weight ? `${num(run.waste_weight)} (${num(run.waste_percent)}%)` : "-"}</span>
          <span><strong>Limite de merma</strong>{num(run.waste_limit_percent)}%</span>
          <span><strong>Creada por</strong>{run.created_by_name ?? "-"}</span>
          <span><strong>Aprobada por</strong>{run.materials_approved_by_name ?? "-"}</span>
          <span><strong>Recibida por</strong>{run.received_by_name ?? "-"}</span>
          {run.status === "CANCELADA" ? (
            <span><strong>Rechazada por</strong>{run.rejected_by_name ?? "-"}{run.rejection_reason ? ` — ${run.rejection_reason}` : ""}</span>
          ) : null}
        </div>

        {(run.products ?? []).length > 0 ? (
          <div className="card panelBody">
            <div className="panelHeader"><div><h2 className="panelTitle">Productos resultantes</h2></div></div>
            <div className="dashboardList">
              {(run.products ?? []).map((product) => (
                <div className="dashboardRow" key={product.id}>
                  <div><strong>{product.product_name ?? "—"}</strong></div>
                  <small>{num(product.quantity)} und</small>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        {(run.complements ?? []).length > 0 ? (
          <div className="card panelBody">
            <div className="panelHeader"><div><h2 className="panelTitle">Complementos solicitados</h2></div></div>
            <div className="dashboardList">
              {(run.complements ?? []).map((complement) => (
                <div className="dashboardRow" key={complement.id}>
                  <div><strong>{complement.name ?? "—"}</strong></div>
                  <small>{num(complement.quantity)} {complement.unit_code} · {complement.status}</small>
                </div>
              ))}
            </div>
          </div>
        ) : null}

        <div className="card panelBody">
          <div className="panelHeader"><div><h2 className="panelTitle">Linea de tiempo</h2></div></div>
          <div className="dashboardList">
            {timeline.map(([label, value]) => (
              <div className="dashboardRow" key={label}>
                <div><strong>{label}</strong></div>
                <small>{dateTimeLabel(value)}</small>
              </div>
            ))}
          </div>
        </div>

        <div className="card panelBody">
          <div className="panelHeader"><div><h2 className="panelTitle">Etapas ({run.stages.length})</h2></div></div>
          <div className="tableWrap">
            <table className="table">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Etapa</th>
                  <th>Fase</th>
                  <th>Estado</th>
                  <th>Peso inicial</th>
                  <th>Peso final</th>
                </tr>
              </thead>
              <tbody>
                {[...run.stages].sort((a, b) => a.stage_order - b.stage_order).map((stage) => (
                  <tr key={stage.id}>
                    <td>{stage.stage_order}</td>
                    <td>{stage.stage_name}</td>
                    <td>{stage.phase_name ?? "-"}</td>
                    <td>{STAGE_STATUS_LABELS[stage.status] ?? stage.status}</td>
                    <td>{stage.initial_weight ? num(stage.initial_weight) : "-"}</td>
                    <td>{stage.final_weight ? num(stage.final_weight) : "-"}</td>
                  </tr>
                ))}
                {run.stages.length === 0 ? (
                  <tr><td colSpan={6}><div className="emptyState">Sin etapas.</div></td></tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </div>
      </section>
    </div>
  );
}

export function SolicitudesView() {
  const [selectedRun, setSelectedRun] = useState<ProductionRun | null>(null);

  const { data: currentUser, isLoading: isLoadingUser } = useQuery({
    queryKey: ["me"],
    queryFn: getCurrentUser,
    enabled: isAuthenticated(),
  });
  const {
    data: runs = [],
    isLoading: isLoadingRuns,
    error: queryError,
  } = useQuery({
    queryKey: ["solicitudes"],
    queryFn: listProductionRuns,
  });

  const role = currentUser ? normalizeRole(currentUser.role) : null;
  const userId = currentUser?.id ?? null;
  const isLoading = isLoadingUser || isLoadingRuns;
  const error = queryError instanceof Error ? queryError.message : null;

  const myRuns = useMemo(() => runs.filter((run) => run.created_by_user_id === userId), [runs, userId]);
  const respondedRuns = useMemo(() => runs.filter((run) => run.status !== "PENDIENTE_INVENTARIO"), [runs]);
  const pendingReception = useMemo(() => runs.filter((run) => run.status === "PENDIENTE_RECEPCION"), [runs]);

  if (role === null || isLoading) {
    return (
      <div className="content">
        <div className="emptyState">Cargando solicitudes...</div>
      </div>
    );
  }

  function detailButton(run: ProductionRun) {
    return (
      <button className="button" onClick={() => setSelectedRun(run)} type="button">
        <Eye aria-hidden="true" size={16} /> Ver mas
      </button>
    );
  }

  return (
    <div className="content">
      {error ? <div className="alert alertError">{error}</div> : null}

      {role === "produccion" ? (
        <section className="card panelBody">
          <div className="panelHeader">
            <div>
              <h2 className="panelTitle">Solicitudes enviadas a inventario</h2>
              <p className="panelText">Estado y detalle de las ordenes que enviaste</p>
            </div>
          </div>
          <div className="tableWrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Codigo</th>
                  <th>Proceso</th>
                  <th>Cantidad</th>
                  <th>Material requerido</th>
                  <th>Estado</th>
                  <th>Solicitada</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                {myRuns.map((run) => (
                  <tr key={run.id}>
                    <td>{run.production_code ?? "-"}</td>
                    <td>{run.process_name}</td>
                    <td>{num(run.quantity)}</td>
                    <td>{num(run.total_required_material)} {run.raw_material_unit_code}</td>
                    <td><span className="statusBadge">{STATUS_LABELS[run.status]}</span></td>
                    <td>{dateTimeLabel(run.requested_at)}</td>
                    <td>{detailButton(run)}</td>
                  </tr>
                ))}
                {myRuns.length === 0 ? (
                  <tr><td colSpan={7}><div className="emptyState">Aun no has enviado solicitudes.</div></td></tr>
                ) : null}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      {role === "inventario" ? (
        <>
          <section className="card panelBody">
            <div className="panelHeader">
              <div>
                <h2 className="panelTitle">Pendientes de recepcion</h2>
                <p className="panelText">Producto terminado por recibir en inventario</p>
              </div>
            </div>
            <div className="tableWrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Codigo</th>
                    <th>Proceso</th>
                    <th>Cantidad</th>
                    <th>Peso esperado</th>
                    <th>Peso real</th>
                    <th>Finalizada</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {pendingReception.map((run) => (
                    <tr key={run.id}>
                      <td>{run.production_code ?? "-"}</td>
                      <td>{run.process_name}</td>
                      <td>{num(run.quantity)}</td>
                      <td>{num(run.expected_finished_weight)}</td>
                      <td>{run.actual_finished_weight ? num(run.actual_finished_weight) : "-"}</td>
                      <td>{dateTimeLabel(run.finished_at)}</td>
                      <td>{detailButton(run)}</td>
                    </tr>
                  ))}
                  {pendingReception.length === 0 ? (
                    <tr><td colSpan={7}><div className="emptyState">No hay recepciones pendientes.</div></td></tr>
                  ) : null}
                </tbody>
              </table>
            </div>
            <p className="panelText">La recepcion y la aprobacion/rechazo se realizan en la seccion Inventario.</p>
          </section>

          <section className="card panelBody">
            <div className="panelHeader">
              <div>
                <h2 className="panelTitle">Solicitudes respondidas</h2>
                <p className="panelText">Historial de solicitudes que ya atendiste</p>
              </div>
            </div>
            <div className="tableWrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Codigo</th>
                    <th>Proceso</th>
                    <th>Cantidad</th>
                    <th>Material</th>
                    <th>Estado</th>
                    <th>Respondida por</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {respondedRuns.map((run) => (
                    <tr key={run.id}>
                      <td>{run.production_code ?? "-"}</td>
                      <td>{run.process_name}</td>
                      <td>{num(run.quantity)}</td>
                      <td>{num(run.total_required_material)} {run.raw_material_unit_code}</td>
                      <td><span className="statusBadge">{STATUS_LABELS[run.status]}</span></td>
                      <td>
                        {run.status === "CANCELADA"
                          ? run.rejected_by_name ?? "-"
                          : run.materials_approved_by_name ?? "-"}
                      </td>
                      <td>{detailButton(run)}</td>
                    </tr>
                  ))}
                  {respondedRuns.length === 0 ? (
                    <tr><td colSpan={7}><div className="emptyState">Aun no has respondido solicitudes.</div></td></tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </section>
        </>
      ) : null}

      {selectedRun ? <RunDetail run={selectedRun} onClose={() => setSelectedRun(null)} /> : null}
    </div>
  );
}
