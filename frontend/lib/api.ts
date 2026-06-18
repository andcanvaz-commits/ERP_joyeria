export const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";
const TOKEN_KEY = "erp_joyeria_access_token";

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
  }
}

const FIELD_LABELS: Record<string, string> = {
  description: "descripcion",
  first_name: "nombre",
  item_id: "item",
  last_name: "apellido",
  name: "nombre",
  password: "contrasena",
  quantity: "cantidad",
  reason: "motivo",
  role: "rol",
  unit_code: "unidad",
  username: "usuario",
};

function friendlyStatusMessage(status: number) {
  if (status === 400) return "Revisa los datos ingresados e intenta nuevamente.";
  if (status === 401) return "Tu sesion vencio. Vuelve a iniciar sesion.";
  if (status === 403) return "No tienes permiso para realizar esta accion.";
  if (status === 404) return "No se encontro la informacion solicitada.";
  if (status === 409) return "No se pudo completar la accion porque entra en conflicto con la informacion actual.";
  if (status === 422) return "Hay datos incompletos o incorrectos. Revisa el formulario.";
  if (status >= 500) return "Ocurrio un problema interno. Intenta nuevamente en unos minutos.";
  return "No se pudo completar la accion. Intenta nuevamente.";
}

function friendlyValidationMessage(item: Record<string, unknown>) {
  const rawField = Array.isArray(item.loc) ? String(item.loc[item.loc.length - 1]) : "";
  const field = FIELD_LABELS[rawField] ?? rawField;
  const rawMessage = typeof item.msg === "string" ? item.msg.toLowerCase() : "";

  if (!field) return "Hay un dato incorrecto en el formulario.";
  if (rawMessage.includes("field required") || rawMessage.includes("missing")) return `Falta completar ${field}.`;
  if (rawMessage.includes("extra inputs")) return `Hay un dato que el sistema no esperaba. Revisa ${field}.`;
  if (rawMessage.includes("greater than")) return `${field} debe ser mayor que cero.`;
  if (rawMessage.includes("less than") || rawMessage.includes("at most")) return `${field} tiene un valor demasiado alto.`;
  if (rawMessage.includes("string should have at least")) return `${field} esta incompleto.`;
  if (rawMessage.includes("string should have at most")) return `${field} tiene demasiado texto.`;
  if (rawMessage.includes("valid decimal") || rawMessage.includes("number")) return `${field} debe ser un numero valido.`;
  if (rawMessage.includes("valid uuid")) return `Selecciona una opcion valida para ${field}.`;
  return `Revisa el campo ${field}.`;
}

function formatApiDetail(detail: unknown, fallback: string): string {
  if (typeof detail === "string") return detail || fallback;
  if (Array.isArray(detail)) {
    const messages = detail.map((item) => {
      if (typeof item === "string") return item;
      if (item && typeof item === "object") return friendlyValidationMessage(item as Record<string, unknown>);
      return fallback;
    });
    return messages.length > 0 ? messages.join(" ") : fallback;
  }
  if (detail && typeof detail === "object") return fallback;
  return fallback;
}

export async function apiRequest<T>(path: string, init?: RequestInit): Promise<T> {
  const token = typeof window !== "undefined" ? window.localStorage.getItem(TOKEN_KEY) : null;
  const response = await fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      "Content-Type": "application/json",
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...init?.headers,
    },
    cache: "no-store",
  });

  if (!response.ok) {
    let message = friendlyStatusMessage(response.status);
    try {
      const body = (await response.json()) as { detail?: unknown };
      message = formatApiDetail(body.detail, message);
    } catch {
      // Keep the HTTP fallback message.
    }
    if (response.status === 401 && typeof window !== "undefined") {
      window.localStorage.removeItem(TOKEN_KEY);
      window.location.href = "/login";
    }
    throw new ApiError(message, response.status);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return (await response.json()) as T;
}

export function saveAccessToken(token: string) {
  window.localStorage.setItem(TOKEN_KEY, token);
}

export function getAccessToken() {
  return typeof window !== "undefined" ? window.localStorage.getItem(TOKEN_KEY) : null;
}

export function clearAccessToken() {
  window.localStorage.removeItem(TOKEN_KEY);
}
