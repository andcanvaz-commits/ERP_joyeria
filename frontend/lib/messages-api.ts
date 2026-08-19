import { apiRequest } from "@/lib/api";

export type AdminMessage = {
  id: string;
  sender_user_id: string;
  sender_name?: string | null;
  body: string;
  status: "PENDIENTE" | "ACEPTADA" | "RECHAZADA";
  created_at: string;
  responded_by_user_id?: string | null;
  responded_by_name?: string | null;
  responded_at?: string | null;
};

export function listMessages() {
  return apiRequest<AdminMessage[]>("/api/messages");
}

export function sendMessage(body: string) {
  return apiRequest<AdminMessage>("/api/messages", {
    method: "POST",
    body: JSON.stringify({ body }),
  });
}

export function respondMessage(messageId: string, status: "ACEPTADA" | "RECHAZADA") {
  return apiRequest<AdminMessage>(`/api/messages/${messageId}/respond`, {
    method: "POST",
    body: JSON.stringify({ status }),
  });
}
