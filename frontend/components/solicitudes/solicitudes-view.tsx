"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Eye, FileText, Printer, Trash2, X } from "lucide-react";
import { isAuthenticated } from "@/lib/api";
import { getCurrentUser } from "@/lib/auth-api";
import { normalizeRole } from "@/lib/roles";
import { listProductionRuns } from "@/lib/production-api";
import { getRunFamily } from "@/lib/orden-produccion";
import { listInventoryItems } from "@/lib/inventory-api";
import { deleteMessage, listMessages, replyMessage, sendMessage, type AdminMessage } from "@/lib/messages-api";
import { markMessagesSeen, type MessagesScope } from "@/lib/messages-read-state";
import { RunStageSummaryTable } from "@/components/production/run-stage-summary";
import { ActaView } from "@/components/production/acta-view";
import { confirmDelete, useConfirm } from "@/components/ui/confirm-dialog";
import type { ProductionRun } from "@/types/production";

const STATUS_LABELS: Record<ProductionRun["status"], string> = {
  PENDIENTE_INVENTARIO: "Pendiente de inventario",
  MATERIALES_APROBADOS: "Materiales aprobados",
  EN_PROCESO: "En proceso",
  PENDIENTE_RECEPCION: "Pendiente de recepcion",
  RECIBIDA: "Recibida",
  CANCELADA: "Rechazada / cancelada",
  ESPERANDO_MATERIAL: "Esperando material",
  TERMINADA: "Terminada",
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
          {products.map((p) => `${p.product_name ?? "—"} (${num(p.quantity)} ${p.unit_code || unit})`).join(" · ")}
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

// Mensaje libre Admin <-> Produccion/Inventario (docs/cambios-sistema-produccion.md
// seccion 2.2): una ida y una vuelta de texto, no una orden ni un aceptar/
// rechazar. Historial permanente, misma lista para los dos lados.
function initials(name: string | null | undefined) {
  if (!name) return "?";
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  return (parts[0][0] + (parts[1]?.[0] ?? "")).toUpperCase();
}

// Un hilo por mensaje: cualquiera de los dos lados (admin o Produccion/
// Inventario) puede seguir agregando respuestas, no hay un unico round-trip.
function MessageThread({
  message,
  currentUserId,
  isSaving,
  onReply,
  onDelete,
}: {
  message: AdminMessage;
  currentUserId: string | null;
  isSaving: boolean;
  onReply: (messageId: string, body: string) => void | Promise<void>;
  onDelete?: (messageId: string) => void | Promise<void>;
}) {
  const [replyText, setReplyText] = useState("");
  const senderName = message.sender_name ?? "Admin";
  return (
    <div className="messageCard">
      <div className="messageCardHead">
        <span className="messageAvatar" aria-hidden="true">{initials(senderName)}</span>
        <div className="messageCardMeta">
          <strong>{senderName}</strong>
          <span>{dateTimeLabel(message.created_at)}</span>
        </div>
        {onDelete ? (
          <button
            aria-label="Eliminar mensaje"
            className="iconOnlyButton"
            disabled={isSaving}
            onClick={() => void onDelete(message.id)}
            title="Eliminar mensaje"
            type="button"
          >
            <Trash2 aria-hidden="true" size={16} />
          </button>
        ) : null}
      </div>
      <p className="messageBody">{message.body}</p>
      {message.replies.map((reply) => (
        <div className={`messageReply${reply.sender_user_id === currentUserId ? " messageReplyMine" : ""}`} key={reply.id}>
          <div className="messageCardMeta">
            <strong>{reply.sender_name ?? "Respuesta"}</strong>
            <span>{dateTimeLabel(reply.created_at)}</span>
          </div>
          <p className="messageBody">{reply.body}</p>
        </div>
      ))}
      <div className="messageReplyPending">
        <textarea
          className="field"
          onChange={(e) => setReplyText(e.target.value)}
          placeholder="Escribe tu respuesta..."
          rows={2}
          value={replyText}
        />
        <button
          className="button buttonPrimary"
          disabled={isSaving || !replyText.trim()}
          onClick={() => {
            void onReply(message.id, replyText.trim());
            setReplyText("");
          }}
          type="button"
        >
          Responder
        </button>
      </div>
    </div>
  );
}

export function MessagesPanel({
  role,
  userId,
  scope,
}: {
  role: "admin" | "operaciones";
  userId: string | null;
  scope: MessagesScope;
}) {
  const queryClient = useQueryClient();
  const [body, setBody] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const { confirm, dialog } = useConfirm();

  const { data: messages = [] } = useQuery({
    queryKey: ["admin-messages"],
    queryFn: listMessages,
  });

  // Mandar o responder desde ACA cuenta como haber visto esta superficie: el
  // punto de aviso de esta pantalla se apaga, pero el de la otra queda
  // prendido hasta que el otro lado entre a ver esto.
  async function handleSend() {
    if (!body.trim()) {
      setLocalError("Escribe el mensaje.");
      return;
    }
    setLocalError(null);
    setIsSaving(true);
    try {
      await sendMessage(body.trim());
      setBody("");
      await queryClient.invalidateQueries({ queryKey: ["admin-messages"] });
      markMessagesSeen(queryClient, userId, scope);
    } catch (nextError) {
      setLocalError(nextError instanceof Error ? nextError.message : "No se pudo enviar el mensaje.");
    } finally {
      setIsSaving(false);
    }
  }

  async function handleReply(messageId: string, replyBody: string) {
    setLocalError(null);
    setIsSaving(true);
    try {
      await replyMessage(messageId, replyBody);
      await queryClient.invalidateQueries({ queryKey: ["admin-messages"] });
      markMessagesSeen(queryClient, userId, scope);
    } catch (nextError) {
      setLocalError(nextError instanceof Error ? nextError.message : "No se pudo responder el mensaje.");
    } finally {
      setIsSaving(false);
    }
  }

  async function handleDelete(messageId: string) {
    if (!(await confirmDelete(confirm, "este mensaje"))) return;
    setLocalError(null);
    setIsSaving(true);
    try {
      await deleteMessage(messageId);
      await queryClient.invalidateQueries({ queryKey: ["admin-messages"] });
    } catch (nextError) {
      setLocalError(nextError instanceof Error ? nextError.message : "No se pudo eliminar el mensaje.");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <section className="card panelBody">
      <div className="panelHeader">
        <div>
          <h2 className="panelTitle">{role === "admin" ? "Mensajes con Produccion/Inventario" : "Mensajes del Admin"}</h2>
          <p className="panelText">Comunicacion libre -- cualquiera de los dos lados puede responder</p>
        </div>
      </div>
      {localError ? <div className="alert alertError">{localError}</div> : null}
      {role === "admin" ? (
        <div className="messageComposer">
          <textarea
            className="field"
            onChange={(e) => setBody(e.target.value)}
            placeholder="Ej: Necesito 20kg de este producto para el 30 de agosto"
            rows={2}
            value={body}
          />
          <button className="button buttonPrimary" disabled={isSaving || !body.trim()} onClick={() => void handleSend()} type="button">
            Enviar
          </button>
        </div>
      ) : null}
      <div className="messageList">
        {messages.map((m) => (
          <MessageThread
            currentUserId={userId}
            isSaving={isSaving}
            key={m.id}
            message={m}
            onDelete={role === "admin" ? handleDelete : undefined}
            onReply={handleReply}
          />
        ))}
        {messages.length === 0 ? <div className="emptyState">Sin mensajes.</div> : null}
      </div>
      {dialog}
    </section>
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
  const isAdmin = currentUser?.role === "admin" || currentUser?.role === "Admin";
  const isLoading = isLoadingUser || isLoadingRuns;
  const error = queryError instanceof Error ? queryError.message : null;

  // Esta pantalla siempre muestra la bandeja de mensajes (para admin y
  // operaciones): entrar aqui ya cuenta como haberla visto.
  useEffect(() => {
    if (role === "admin" || role === "operaciones") markMessagesSeen(queryClient, userId, "solicitudes");
  }, [role, userId, queryClient]);

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

  function rowActions(run: ProductionRun) {
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 4, alignItems: "flex-start" }}>
        <button className="button" onClick={() => setActaRun(run)} type="button">
          <FileText aria-hidden="true" size={14} /> Ver acta
        </button>
        <button className="button" onClick={() => setSelectedRun(run)} type="button">
          <Eye aria-hidden="true" size={16} /> Ver mas
        </button>
      </div>
    );
  }

  return (
    <div className="content">
      {error ? <div className="alert alertError">{error}</div> : null}

      {role === "admin" || role === "operaciones" ? (
        <MessagesPanel role={role} scope="solicitudes" userId={userId} />
      ) : null}

      {role === "operaciones" ? (
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
                    <td>{rowActions(run)}</td>
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

      {role === "operaciones" ? (
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
                      <td>{rowActions(run)}</td>
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
                      <td>{rowActions(run)}</td>
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
          family={getRunFamily(runs, actaRun)}
          inventoryItems={materialItems}
          isAdmin={isAdmin}
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
