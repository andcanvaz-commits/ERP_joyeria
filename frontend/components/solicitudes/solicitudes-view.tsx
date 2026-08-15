"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Eye, Printer, X } from "lucide-react";
import { isAuthenticated } from "@/lib/api";
import { getCurrentUser } from "@/lib/auth-api";
import { normalizeRole } from "@/lib/roles";
import { listProductionRuns } from "@/lib/production-api";
import { listInventoryItems } from "@/lib/inventory-api";
import { RunStageSummaryTable } from "@/components/production/run-stage-summary";
import { ActaView } from "@/components/production/acta-view";
import type { ProductionRun } from "@/types/production";

const STATUS_LABELS: Record<ProductionRun["status"], string> = {
  PENDIENTE_INVENTARIO: "Pendiente de inventario",
  MATERIALES_APROBADOS: "Materiales aprobados",
  EN_PROCESO: "En proceso",
  PENDIENTE_RECEPCION: "Pendiente de recepcion",
  RECIBIDA: "Recibida",
  CANCELADA: "Rechazada / cancelada",
  ESPERANDO_MATERIAL: "Esperando material",
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

// Porcentajes: 2 decimales, no los 4 de los gramos (16,6667% es ilegible).
function percentText(value: string | null) {
  if (!value) return "0";
  const n = Number(value);
  return Number.isFinite(n) ? n.toLocaleString("es-EC", { maximumFractionDigits: 2 }) : value;
}

/** Filas del resumen de una solicitud. Devuelve solo <span>: el llamador las
 * mete en su propio .userPreviewGrid (mismo contrato que RunWasteHero). Existe
 * para que la ficha en pantalla y la hoja impresa salgan del MISMO codigo y no
 * puedan divergir. */
function RunSummaryRows({ run }: { run: ProductionRun }) {
  const unit = run.raw_material_unit_code || "g";
  const products = run.products ?? [];
  const complements = run.complements ?? [];
  const assemblyItems = run.assembly_items ?? [];

  // Las fechas van como una fila cada una dentro de la misma ficha, en vez de
  // un panel "Linea de tiempo" aparte: es la mitad de alto y se lee igual.
  const timeline: Array<[string, string | null]> = [
    ["Solicitada", run.requested_at],
    ["Materiales aprobados", run.materials_approved_at],
    ["Iniciada", run.started_at],
    ["Finalizada", run.finished_at],
    ["Recibida", run.received_at],
  ];

  return (
    <>
      {run.assembly_pending ? <span><strong>Ensamble</strong>Pendiente de definir</span> : null}
      <span>
        <strong>Material requerido</strong>
        {num(run.total_required_material)} {unit}
      </span>
      <span>
        <strong>Peso real</strong>
        {run.actual_finished_weight ? `${num(run.actual_finished_weight)} ${unit}` : "—"}
      </span>
      <span>
        <strong>Merma</strong>
        {run.waste_weight ? `${num(run.waste_weight)} ${unit} (${percentText(run.waste_percent)}%)` : "—"}
        {` · limite ${percentText(run.waste_limit_percent)}%`}
      </span>
      <span><strong>Creada por</strong>{run.created_by_name ?? "—"}</span>
      <span><strong>Aprobada por</strong>{run.materials_approved_by_name ?? "—"}</span>
      <span><strong>Recibida por</strong>{run.received_by_name ?? "—"}</span>
      {run.status === "CANCELADA" ? (
        <span>
          <strong>Rechazada por</strong>
          {run.rejected_by_name ?? "—"}{run.rejection_reason ? ` — ${run.rejection_reason}` : ""}
        </span>
      ) : null}
      {products.length > 0 ? (
        <span>
          <strong>Productos</strong>
          {products.map((p) => `${p.product_name ?? "—"} (${num(p.quantity)} ${p.unit_code || "und"})`).join(" · ")}
        </span>
      ) : null}
      {complements.length > 0 ? (
        <span>
          <strong>Complementos</strong>
          {complements.map((c) => `${c.name ?? "—"} (${num(c.quantity)} ${c.unit_code})`).join(" · ")}
        </span>
      ) : null}
      {assemblyItems.length > 0 ? (
        <span>
          <strong>Ensamble aplicado</strong>
          {assemblyItems.map((i) => `${i.name ?? "—"} (${num(i.quantity)})`).join(" · ")}
        </span>
      ) : null}
      {timeline.map(([label, value]) => (
        <span key={label}><strong>{label}</strong>{dateTimeLabel(value)}</span>
      ))}
    </>
  );
}

/** Detalle de una solicitud. Sigue el patron de ficha del resto del sistema
 * (modalHeader + userPreviewGrid + RunStageSummaryTable), no cards anidadas:
 * antes apilaba 3 KPIs grandes y 4 paneles con su propio titulo, lo que
 * obligaba a un scroll larguisimo y no se parecia a ninguna otra ficha. */
function RunDetail({
  run,
  onClose,
  onPrint,
  onViewActa,
}: {
  run: ProductionRun;
  onClose: () => void;
  onPrint: () => void;
  onViewActa: () => void;
}) {
  return (
    <div className="modalBackdrop" role="dialog" aria-modal="true" aria-label="Detalle de solicitud">
      <section className="modalWindow processViewWindow">
        <div className="modalHeader">
          <div>
            <h2>{run.production_code ?? "Sin codigo"}</h2>
            <p>{run.process_name} · {STATUS_LABELS[run.status]}</p>
          </div>
          <button aria-label="Cerrar" className="iconOnlyButton" onClick={onClose} type="button">
            <X aria-hidden="true" size={18} />
          </button>
        </div>

        <div className="userPreviewGrid">
          <RunSummaryRows run={run} />
        </div>

        {/* Tabla compartida: pagina de 5 en 5, asi una orden de muchas etapas
            deja de estirar el modal sin fin. */}
        <RunStageSummaryTable run={run} />

        <div className="modalActions">
          <button className="button" onClick={onViewActa} type="button">
            Ver acta
          </button>
          <button className="button buttonPrimary" onClick={onPrint} type="button">
            <Printer aria-hidden="true" size={14} />
            Imprimir
          </button>
        </div>
      </section>
    </div>
  );
}

export function SolicitudesView() {
  const queryClient = useQueryClient();
  const [selectedRun, setSelectedRun] = useState<ProductionRun | null>(null);
  const [actaRun, setActaRun] = useState<ProductionRun | null>(null);
  // Impresion: el documento se monta en un portal fuera del arbol de la app
  // (@media print oculta todo menos .printArea) y se dispara window.print()
  // tras un tick, para que el navegador alcance a pintarlo. Mismo patron que
  // el reporte de merma de produccion.
  const [printingRun, setPrintingRun] = useState<ProductionRun | null>(null);
  useEffect(() => {
    if (!printingRun) return;
    const timer = setTimeout(() => {
      window.print();
      setPrintingRun(null);
    }, 60);
    return () => clearTimeout(timer);
  }, [printingRun]);

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
  // Solo se pide cuando de verdad se necesita (abrir el acta): esta pantalla
  // normalmente no toca inventario para nada mas.
  const { data: materialItems = [] } = useQuery({
    queryKey: ["inventory-items-all"],
    queryFn: () => listInventoryItems(),
    enabled: actaRun !== null,
  });

  const role = currentUser ? normalizeRole(currentUser.role) : null;
  const userId = currentUser?.id ?? null;
  const isLoading = isLoadingUser || isLoadingRuns;
  const error = queryError instanceof Error ? queryError.message : null;

  // El acta es editable: si queda abierta mientras se guarda un cambio,
  // tiene que reflejar la orden fresca, no la foto de cuando se abrio.
  useEffect(() => {
    setActaRun((current) => (current ? runs.find((run) => run.id === current.id) ?? null : current));
  }, [runs]);

  const myRuns = useMemo(() => runs.filter((run) => run.created_by_user_id === userId), [runs, userId]);
  const respondedRuns = useMemo(() => runs.filter((run) => run.status !== "PENDIENTE_INVENTARIO"), [runs]);
  // Las corridas historicas migradas (con event_lines) no deben aparecer
  // como pendientes de recepcion en vivo: esa recepcion nunca va a ocurrir
  // y el backend la rechaza (ver ProductionService.receive_finished_product).
  const pendingReception = useMemo(
    () => runs.filter((run) => run.status === "PENDIENTE_RECEPCION" && (run.event_lines ?? []).length === 0),
    [runs],
  );

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
                    <td>{num(run.total_required_material)} {run.raw_material_unit_code}</td>
                    <td><span className="statusBadge">{STATUS_LABELS[run.status]}</span></td>
                    <td>{dateTimeLabel(run.requested_at)}</td>
                    <td>{detailButton(run)}</td>
                  </tr>
                ))}
                {myRuns.length === 0 ? (
                  <tr><td colSpan={6}><div className="emptyState">Aun no has enviado solicitudes.</div></td></tr>
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
                      <td>{run.actual_finished_weight ? num(run.actual_finished_weight) : "-"}</td>
                      <td>{dateTimeLabel(run.finished_at)}</td>
                      <td>{detailButton(run)}</td>
                    </tr>
                  ))}
                  {pendingReception.length === 0 ? (
                    <tr><td colSpan={6}><div className="emptyState">No hay recepciones pendientes.</div></td></tr>
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
                    <tr><td colSpan={6}><div className="emptyState">Aun no has respondido solicitudes.</div></td></tr>
                  ) : null}
                </tbody>
              </table>
            </div>
          </section>
        </>
      ) : null}

      {selectedRun ? (
        <RunDetail
          onClose={() => setSelectedRun(null)}
          onPrint={() => setPrintingRun(selectedRun)}
          onViewActa={() => setActaRun(selectedRun)}
          run={selectedRun}
        />
      ) : null}

      {actaRun ? (
        <ActaView
          materialItems={materialItems}
          onChanged={() => void queryClient.invalidateQueries({ queryKey: ["solicitudes"] })}
          onClose={() => setActaRun(null)}
          run={actaRun}
        />
      ) : null}

      {printingRun
        ? createPortal(
            <div className="printArea">
              <div className="printDoc">
                <h1>Solicitud de produccion</h1>
                <h2>{printingRun.production_code ?? "Sin codigo"} · {printingRun.process_name}</h2>
                <p>
                  Estado: {STATUS_LABELS[printingRun.status]} · Solicitada: {dateTimeLabel(printingRun.requested_at)}
                </p>
                <div className="userPreviewGrid">
                  <RunSummaryRows run={printingRun} />
                </div>
                {/* print: sin paginacion, la hoja lleva todas las etapas. */}
                <RunStageSummaryTable print run={printingRun} />
              </div>
            </div>,
            document.body,
          )
        : null}
    </div>
  );
}
