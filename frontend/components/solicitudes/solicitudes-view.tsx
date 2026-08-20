"use client";

import { useEffect, useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Trash2 } from "lucide-react";
import { isAuthenticated } from "@/lib/api";
import { getCurrentUser } from "@/lib/auth-api";
import { normalizeRole } from "@/lib/roles";
import { deleteMessage, listMessages, replyMessage, sendMessage, type AdminMessage } from "@/lib/messages-api";
import { markMessagesSeen, type MessagesScope } from "@/lib/messages-read-state";
import { confirmDelete, useConfirm } from "@/components/ui/confirm-dialog";
import { dateKey } from "@/lib/calendar";

function dateTimeLabel(value: string | null) {
  if (!value) return "-";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "-";
  return date.toLocaleString("es-EC", { day: "2-digit", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
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
  const { confirm, dialog } = useConfirm();

  const { data: messages = [] } = useQuery({
    queryKey: ["admin-messages", scope],
    queryFn: () => listMessages(scope),
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

  async function handleReply(messageId: string, replyBody: string) {
    setLocalError(null);
    setIsSaving(true);
    try {
      await replyMessage(messageId, replyBody);
      markMessagesSeen(queryClient, userId, scope);
      await queryClient.invalidateQueries({ queryKey: ["admin-messages"] });
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
  const groups = groupMessagesByDay(messages);

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
            rows={2}
            value={body}
          />
          <button className="button buttonPrimary" disabled={isSaving || !body.trim()} onClick={() => void handleSend()} type="button">
            Enviar
          </button>
        </div>
      ) : null}
      <div className="messageList">
        {groups.map((group) => (
          <div key={group.key}>
            <div className="messageDaySeparator">{group.label}</div>
            {group.items.map((m) => (
              <MessageThread
                currentUserId={userId}
                isSaving={isSaving}
                key={m.id}
                message={m}
                onDelete={role === "admin" ? handleDelete : undefined}
                onReply={handleReply}
              />
            ))}
          </div>
        ))}
        {messages.length === 0 ? <div className="emptyState">Sin mensajes.</div> : null}
      </div>
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
