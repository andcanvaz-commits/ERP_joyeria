import type { QueryClient } from "@tanstack/react-query";
import type { AdminMessage } from "@/lib/messages-api";

const STORAGE_PREFIX = "erp-messages-last-seen:";
const EPOCH = new Date(0).toISOString();

export function lastSeenQueryKey(userId: string | null) {
  return ["messages-last-seen", userId] as const;
}

function readStoredLastSeen(userId: string): string {
  if (typeof window === "undefined") return EPOCH;
  return window.localStorage.getItem(STORAGE_PREFIX + userId) ?? EPOCH;
}

/** queryFn de la cache compartida de "ultima vez que vi mensajes": lee de
 * localStorage (persiste entre sesiones) pero vive en react-query para que
 * marcar como leido en una pantalla (ej. el modal de Inventario) actualice
 * al toque el punto azul del menu lateral, sin recargar nada. */
export function lastSeenQueryFn(userId: string | null) {
  return () => (userId ? readStoredLastSeen(userId) : EPOCH);
}

/** Marca los mensajes como leidos ahora mismo: persiste y empuja el cambio a
 * cualquier componente que este mirando la misma queryKey. */
export function markMessagesSeen(queryClient: QueryClient, userId: string | null) {
  if (!userId) return;
  const now = new Date().toISOString();
  if (typeof window !== "undefined") {
    window.localStorage.setItem(STORAGE_PREFIX + userId, now);
  }
  queryClient.setQueryData(lastSeenQueryKey(userId), now);
}

/** Un mensaje cuenta como "sin leer" si su ultima actividad (la ultima
 * respuesta del hilo, o el mensaje original si nadie respondio aun) es mas
 * nueva que la ultima vez que este usuario vio la bandeja -- y esa actividad
 * no la genero el mismo usuario (mandar o responder no te deja un punto a
 * vos mismo). */
export function countUnreadMessages(messages: AdminMessage[], userId: string | null, lastSeen: string): number {
  if (!userId) return 0;
  const lastSeenAt = new Date(lastSeen).getTime();
  return messages.filter((message) => {
    const lastReply = message.replies[message.replies.length - 1];
    const activityAt = lastReply ? lastReply.created_at : message.created_at;
    const actorId = lastReply ? lastReply.sender_user_id : message.sender_user_id;
    if (actorId === userId) return false;
    return new Date(activityAt).getTime() > lastSeenAt;
  }).length;
}
