"use client";

import { useEffect, useMemo, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CalendarDays, Check, ChevronLeft, ChevronRight, Trash2, X } from "lucide-react";
import { isAuthenticated } from "@/lib/api";
import { getCurrentUser } from "@/lib/auth-api";
import { normalizeRole } from "@/lib/roles";
import { deleteMessage, listMessages, replyMessage, sendMessage, type AdminMessage, type MessageDecision } from "@/lib/messages-api";
import { markMessagesSeen, type MessagesScope } from "@/lib/messages-read-state";
import { confirmDelete, useConfirm } from "@/components/ui/confirm-dialog";
import { WEEK_DAYS, buildCalendarDays, dateKey, monthKey } from "@/lib/calendar";

function timeLabel(value: string | null) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleTimeString("es-EC", { hour: "2-digit", minute: "2-digit" });
}

function dayLabel(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Sin fecha";
  return date.toLocaleDateString("es-EC", { day: "numeric", month: "long", year: "numeric" });
}

// Agrupa mensajes por dia (mas reciente primero) -- separador de fecha una
// vez por grupo, no por mensaje.
function groupMessagesByDay(messages: AdminMessage[]): Array<{ key: string; label: string; items: AdminMessage[] }> {
  const groups = new Map<string, AdminMessage[]>();
  for (const message of messages) {
    const key = dateKey(new Date(message.created_at));
    const existing = groups.get(key);
    if (existing) existing.push(message);
    else groups.set(key, [message]);
  }
  return [...groups.entries()]
    .sort((a, b) => b[0].localeCompare(a[0]))
    .map(([key, items]) => ({ key, label: dayLabel(items[0].created_at), items }));
}

// Solicitud del admin + respuesta de Produccion/Inventario (Rodrigo,
// 2026-08-20): dos partes fijas por cuadro, no un chat -- la respuesta es
// Aprobar/Rechazar con comentario opcional, una sola vez por solicitud.
function MessageThread({
  message,
  role,
  isSaving,
  onReply,
  onDelete,
}: {
  message: AdminMessage;
  role: "admin" | "operaciones";
  isSaving: boolean;
  onReply: (messageId: string, decision: MessageDecision, body: string) => void | Promise<void>;
  onDelete?: (messageId: string) => void | Promise<void>;
}) {
  const [comment, setComment] = useState("");
  const reply = message.replies[0] ?? null;
  return (
    <article className="requestCard">
      <header className="requestCardHead">
        <div className="requestCardMeta">
          <strong>{message.sender_name ?? "Admin"} solicita</strong>
          <span>{timeLabel(message.created_at)}</span>
        </div>
        {onDelete ? (
          <button
            aria-label="Eliminar solicitud"
            className="iconOnlyButton"
            disabled={isSaving}
            onClick={() => void onDelete(message.id)}
            title="Eliminar solicitud"
            type="button"
          >
            <Trash2 aria-hidden="true" size={15} />
          </button>
        ) : null}
      </header>
      <p className="requestBody">{message.body}</p>
      {reply ? (
        <div className={`requestDecision ${reply.decision === "APROBADA" ? "requestDecisionOk" : "requestDecisionNo"}`}>
          <strong>
            {reply.decision === "APROBADA" ? <Check aria-hidden="true" size={14} /> : <X aria-hidden="true" size={14} />}
            {reply.decision === "APROBADA" ? "Aprobado" : "Rechazado"} · {reply.sender_name ?? "Producción/Inventario"} · {timeLabel(reply.created_at)}
          </strong>
          {reply.body ? <p>{reply.body}</p> : null}
        </div>
      ) : role === "operaciones" ? (
        <div className="requestActions">
          <textarea
            className="field"
            onChange={(e) => setComment(e.target.value)}
            placeholder="Comentario opcional..."
            rows={1}
            value={comment}
          />
          <div className="requestActionButtons">
            <button
              className="button buttonDanger"
              disabled={isSaving}
              onClick={() => void onReply(message.id, "RECHAZADA", comment)}
              type="button"
            >
              Rechazar
            </button>
            <button
              className="button buttonPrimary"
              disabled={isSaving}
              onClick={() => void onReply(message.id, "APROBADA", comment)}
              type="button"
            >
              Aprobar
            </button>
          </div>
        </div>
      ) : (
        <p className="requestPending">Esperando respuesta de Producción/Inventario.</p>
      )}
    </article>
  );
}

export function MessagesPanel({
  role,
  userId,
  scope,
  title,
}: {
  role: "admin" | "operaciones";
  userId: string | null;
  scope: MessagesScope;
  // null = no renderiza titulo propio (el caller ya tiene uno, ej. el
  // modalHeader de Inventario) -- si se omite, usa el titulo por defecto.
  title?: string | null;
}) {
  const queryClient = useQueryClient();
  const [body, setBody] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const [isCalendarOpen, setIsCalendarOpen] = useState(false);
  const [calendarMonth, setCalendarMonth] = useState(() => monthKey(new Date()));
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const { confirm, dialog } = useConfirm();

  const { data: messages = [] } = useQuery({
    queryKey: ["admin-messages", scope],
    queryFn: () => listMessages(scope),
  });

  const messageCountsByDate = useMemo(() => {
    const counts = new Map<string, number>();
    for (const message of messages) {
      const key = dateKey(new Date(message.created_at));
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }
    return counts;
  }, [messages]);
  const calendarDays = useMemo(() => buildCalendarDays(calendarMonth), [calendarMonth]);
  const calendarMonthLabel = useMemo(() => {
    const [year, month] = calendarMonth.split("-").map(Number);
    return new Date(year, month - 1, 1).toLocaleDateString("es-EC", { month: "long", year: "numeric" });
  }, [calendarMonth]);

  function moveCalendarMonth(direction: -1 | 1) {
    const [year, month] = calendarMonth.split("-").map(Number);
    setCalendarMonth(monthKey(new Date(year, month - 1 + direction, 1)));
  }

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
      // Marcar visto ANTES de invalidar: si se invalida primero, el refetch
      // trae el mensaje recien mandado y el punto de esta misma superficie
      // prende un instante (con el "visto" todavia viejo) antes de apagarse.
      markMessagesSeen(queryClient, userId, scope);
      await queryClient.invalidateQueries({ queryKey: ["admin-messages"] });
    } catch (nextError) {
      setLocalError(nextError instanceof Error ? nextError.message : "No se pudo enviar el mensaje.");
    } finally {
      setIsSaving(false);
    }
  }

  async function handleReply(messageId: string, decision: MessageDecision, replyBody: string) {
    setLocalError(null);
    setIsSaving(true);
    try {
      await replyMessage(messageId, decision, replyBody);
      markMessagesSeen(queryClient, userId, scope);
      await queryClient.invalidateQueries({ queryKey: ["admin-messages"] });
    } catch (nextError) {
      setLocalError(nextError instanceof Error ? nextError.message : "No se pudo responder la solicitud.");
    } finally {
      setIsSaving(false);
    }
  }

  async function handleDelete(messageId: string) {
    if (!(await confirmDelete(confirm, "este mensaje"))) return;
    setLocalError(null);
    setIsSaving(true);
    try {
      await deleteMessage(messageId, scope);
      await queryClient.invalidateQueries({ queryKey: ["admin-messages"] });
    } catch (nextError) {
      setLocalError(nextError instanceof Error ? nextError.message : "No se pudo eliminar el mensaje.");
    } finally {
      setIsSaving(false);
    }
  }

  const resolvedTitle =
    title === null ? null : title ?? (role === "admin" ? "Mensajes con Producción/Inventario" : "Mensajes del Admin");
  const allGroups = groupMessagesByDay(messages);
  const groups = selectedDate ? allGroups.filter((group) => group.key === selectedDate) : allGroups;

  return (
    <section className="card panelBody">
      {resolvedTitle ? (
        <div className="panelHeader">
          <div>
            <h2 className="panelTitle">{resolvedTitle}</h2>
          </div>
        </div>
      ) : null}
      {localError ? <div className="alert alertError">{localError}</div> : null}
      {role === "admin" ? (
        <div className="messageComposer">
          <textarea
            className="field"
            onChange={(e) => setBody(e.target.value)}
            placeholder="Escribe la solicitud..."
            rows={2}
            value={body}
          />
          <button className="button buttonPrimary" disabled={isSaving || !body.trim()} onClick={() => void handleSend()} type="button">
            Enviar
          </button>
        </div>
      ) : null}
      <div className="messagesToolbar">
        {selectedDate ? (
          <button className="iconTextButton" onClick={() => setSelectedDate(null)} type="button">
            <X aria-hidden="true" size={15} />
            Ver todos
          </button>
        ) : <span />}
        <button
          aria-label="Abrir historial por calendario"
          className="iconTextButton"
          disabled={messages.length === 0}
          onClick={() => {
            setCalendarMonth(selectedDate ? selectedDate.slice(0, 7) : monthKey(new Date()));
            setIsCalendarOpen(true);
          }}
          title="Historial por calendario"
          type="button"
        >
          <CalendarDays aria-hidden="true" size={16} />
          Historial
        </button>
      </div>
      <div className="messageListShell">
        <div className="messageList">
          {groups.map((group) => (
            <div key={group.key}>
              <div className="messageDaySeparator"><span>{group.label}</span></div>
              {group.items.map((m) => (
                <MessageThread
                  isSaving={isSaving}
                  key={m.id}
                  message={m}
                  onDelete={role === "admin" ? handleDelete : undefined}
                  onReply={handleReply}
                  role={role}
                />
              ))}
            </div>
          ))}
          {groups.length === 0 ? <div className="emptyState">Sin mensajes{selectedDate ? " ese día" : ""}.</div> : null}
        </div>
      </div>
      {isCalendarOpen ? (
        <div className="modalBackdrop" role="dialog" aria-modal="true" aria-label="Historial de mensajes por calendario">
          <section className="modalWindow messageCalendarWindow">
            <div className="modalHeader">
              <div>
                <h2>Historial de mensajes</h2>
                <p>Selecciona una fecha</p>
              </div>
              <button aria-label="Cerrar" className="iconOnlyButton" onClick={() => setIsCalendarOpen(false)} type="button">
                <X aria-hidden="true" size={18} />
              </button>
            </div>
            <section className="movementCalendarPanel" aria-label="Calendario de mensajes">
              <div className="movementCalendarHeader">
                <button aria-label="Mes anterior" className="iconOnlyButton" onClick={() => moveCalendarMonth(-1)} type="button">
                  <ChevronLeft aria-hidden="true" size={18} />
                </button>
                <strong>{calendarMonthLabel}</strong>
                <button aria-label="Mes siguiente" className="iconOnlyButton" onClick={() => moveCalendarMonth(1)} type="button">
                  <ChevronRight aria-hidden="true" size={18} />
                </button>
              </div>
              <div className="movementCalendarWeekdays">
                {WEEK_DAYS.map((day) => <span key={day}>{day}</span>)}
              </div>
              <div className="movementCalendarGrid">
                {calendarDays.map((day) => {
                  const count = messageCountsByDate.get(day.key) ?? 0;
                  return day.isEmpty ? (
                    <span className="movementCalendarEmpty" key={day.key} />
                  ) : (
                    <button
                      className={`movementCalendarDay ${selectedDate === day.key ? "movementCalendarSelected" : ""} ${count > 0 ? "movementCalendarHasMovements" : ""}`}
                      disabled={count === 0}
                      key={day.key}
                      onClick={() => {
                        setSelectedDate(day.key);
                        setIsCalendarOpen(false);
                      }}
                      type="button"
                    >
                      <span>{day.label}</span>
                      {count > 0 ? <strong>{count}</strong> : null}
                    </button>
                  );
                })}
              </div>
            </section>
          </section>
        </div>
      ) : null}
      {dialog}
    </section>
  );
}

export function SolicitudesView() {
  const queryClient = useQueryClient();
  const { data: currentUser, isLoading } = useQuery({
    queryKey: ["me"],
    queryFn: getCurrentUser,
    enabled: isAuthenticated(),
  });
  const role = currentUser ? normalizeRole(currentUser.role) : null;
  const userId = currentUser?.id ?? null;

  // Esta pantalla siempre muestra la bandeja de mensajes: entrar aqui ya
  // cuenta como haberla visto.
  useEffect(() => {
    if (role === "admin" || role === "operaciones") markMessagesSeen(queryClient, userId, "solicitudes");
  }, [role, userId, queryClient]);

  if (role === null || isLoading) {
    return (
      <div className="content">
        <div className="emptyState">Cargando mensajes...</div>
      </div>
    );
  }

  return (
    <div className="content">
      {role === "admin" || role === "operaciones" ? (
        <MessagesPanel role={role} scope="solicitudes" title="Mensajes con Producción" userId={userId} />
      ) : null}
    </div>
  );
}
