import { apiRequest } from "@/lib/api";

export type AdminMessageReply = {
  id: string;
  sender_user_id: string;
  sender_name?: string | null;
  body: string;
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

export function listMessages() {
  return apiRequest<AdminMessage[]>("/api/messages");
}

export function sendMessage(body: string) {
  return apiRequest<AdminMessage>("/api/messages", {
    method: "POST",
    body: JSON.stringify({ body }),
  });
}

export function replyMessage(messageId: string, body: string) {
  return apiRequest<AdminMessage>(`/api/messages/${messageId}/reply`, {
    method: "POST",
    body: JSON.stringify({ body }),
  });
}
