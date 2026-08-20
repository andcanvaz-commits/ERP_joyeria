import { apiRequest } from "@/lib/api";
import type { MessagesScope } from "@/lib/messages-read-state";

export type MessageDecision = "APROBADA" | "RECHAZADA";

export type AdminMessageReply = {
  id: string;
  sender_user_id: string;
  sender_name?: string | null;
  decision: MessageDecision;
  body: string | null;
  created_at: string;
};

export type AdminMessage = {
  id: string;
  sender_user_id: string;
  sender_name?: string | null;
  body: string;
  created_at: string;
  replies: AdminMessageReply[];
};

// scope determina que buzon se ve: "solicitudes" (Bandeja de mensajes) e
// "inventario" son la misma conversacion, pero un mensaje eliminado desde
// uno sigue visible en el otro (ver hidden_from_* en el backend).
export function listMessages(scope: MessagesScope) {
  return apiRequest<AdminMessage[]>(`/api/messages?scope=${scope}`);
}

export function sendMessage(body: string) {
  return apiRequest<AdminMessage>("/api/messages", {
    method: "POST",
    body: JSON.stringify({ body }),
  });
}

export function replyMessage(messageId: string, decision: MessageDecision, body: string | null) {
  return apiRequest<AdminMessage>(`/api/messages/${messageId}/reply`, {
    method: "POST",
    body: JSON.stringify({ decision, body: body?.trim() || null }),
  });
}

export function deleteMessage(messageId: string, scope: MessagesScope) {
  return apiRequest<void>(`/api/messages/${messageId}?scope=${scope}`, {
    method: "DELETE",
  });
}
