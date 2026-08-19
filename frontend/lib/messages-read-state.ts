import type { QueryClient } from "@tanstack/react-query";
import type { AdminMessage } from "@/lib/messages-api";

const STORAGE_PREFIX = "erp-messages-last-seen:";
const EPOCH = new Date(0).toISOString();

// Dos superficies separadas, cada una con su propio "hasta cuando vi esto":
// la bandeja de Comunicados y el modal de Mensajes dentro de Inventario. Si
// mandas un mensaje desde una, esa se marca vista al toque (estabas ahi
// mirandola) pero la OTRA sigue avisando -- asi el punto de aviso siempre
// senala "el otro lado todavia no vio esto".
export type MessagesScope = "solicitudes" | "inventario";

export function lastSeenQueryKey(userId: string | null, scope: MessagesScope) {
  return ["messages-last-seen", scope, userId] as const;
}

function readStoredLastSeen(userId: string, scope: MessagesScope): string {
  if (typeof window === "undefined") return EPOCH;
  return window.localStorage.getItem(`${STORAGE_PREFIX}${scope}:${userId}`) ?? EPOCH;
}

/** queryFn de la cache compartida de "ultima vez que vi mensajes": lee de
 * localStorage (persiste entre sesiones) pero vive en react-query para que
 * marcar como leido en una pantalla (ej. el modal de Inventario) actualice
 * al toque el punto de esa misma superficie, sin recargar nada. */
export function lastSeenQueryFn(userId: string | null, scope: MessagesScope) {
  return () => (userId ? readStoredLastSeen(userId, scope) : EPOCH);
}

/** Marca los mensajes de una superficie como leidos ahora mismo: persiste y
 * empuja el cambio a cualquier componente que este mirando esa misma
 * queryKey. No toca la otra superficie. */
export function markMessagesSeen(queryClient: QueryClient, userId: string | null, scope: MessagesScope) {
  if (!userId) return;
  const now = new Date().toISOString();
  if (typeof window !== "undefined") {
    window.localStorage.setItem(`${STORAGE_PREFIX}${scope}:${userId}`, now);
  }
  queryClient.setQueryData(lastSeenQueryKey(userId, scope), now);
}

/** Un mensaje cuenta como "sin leer" si su ultima actividad (la ultima
 * respuesta del hilo, o el mensaje original si nadie respondio aun) es mas
 * nueva que la ultima vez que este usuario vio ESA superficie. */
export function countUnreadMessages(messages: AdminMessage[], userId: string | null, lastSeen: string): number {
  if (!userId) return 0;
  const lastSeenAt = new Date(lastSeen).getTime();
  return messages.filter((message) => {
    const lastReply = message.replies[message.replies.length - 1];
    const activityAt = lastReply ? lastReply.created_at : message.created_at;
    return new Date(activityAt).getTime() > lastSeenAt;
  }).length;
}
