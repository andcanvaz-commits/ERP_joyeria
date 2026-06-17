const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8000";
const TOKEN_KEY = "erp_joyeria_access_token";

export class ApiError extends Error {
  constructor(
    message: string,
    public readonly status: number,
  ) {
    super(message);
  }
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
    let message = `Error HTTP ${response.status}`;
    try {
      const body = (await response.json()) as { detail?: string };
      message = body.detail ?? message;
    } catch {
      // Keep the HTTP fallback message.
    }
    if (response.status === 401 && typeof window !== "undefined") {
      window.localStorage.removeItem(TOKEN_KEY);
      window.location.href = "/login";
    }
    throw new ApiError(message, response.status);
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
