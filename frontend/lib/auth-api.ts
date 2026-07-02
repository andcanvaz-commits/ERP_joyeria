import { apiRequest, clearAuthenticated, markAuthenticated } from "@/lib/api";

export type LoginResponse = {
  access_token: string;
  refresh_token: string;
  token_type: string;
};

export type CurrentUser = {
  id: string;
  username: string;
  first_name: string;
  last_name: string;
  email: string;
  role: string;
  employee_code?: string | null;
  permissions: string[];
  is_active: boolean;
  must_change_password?: boolean;
};

export type ManagedUser = CurrentUser;

export type SaveUserPayload = {
  first_name: string;
  last_name: string;
  role: string;
};

export type UserCredentialResponse = {
  user: ManagedUser;
  temporary_password: string;
};

export async function login(username: string, password: string) {
  const tokenPair = await apiRequest<LoginResponse>("/api/auth/login", {
    method: "POST",
    body: JSON.stringify({ username, password }),
  });
  // El token viaja en cookie HttpOnly (Set-Cookie). Solo marcamos la bandera de UI.
  markAuthenticated();
  return tokenPair;
}

export function changePassword(currentPassword: string, newPassword: string) {
  return apiRequest<void>("/api/auth/change-password", {
    method: "POST",
    body: JSON.stringify({ current_password: currentPassword, new_password: newPassword }),
  });
}

export function setInitialPassword(newPassword: string) {
  return apiRequest<void>("/api/auth/set-initial-password", {
    method: "POST",
    body: JSON.stringify({ new_password: newPassword }),
  });
}

export async function logout() {
  try {
    await apiRequest<void>("/api/auth/logout", { method: "POST" });
  } finally {
    clearAuthenticated();
  }
}

export function getCurrentUser() {
  return apiRequest<CurrentUser>("/api/auth/me");
}

export function listUsers() {
  return apiRequest<ManagedUser[]>("/api/auth/users");
}

export function createUser(payload: SaveUserPayload) {
  return apiRequest<UserCredentialResponse>("/api/auth/users", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function updateUser(userId: string, payload: SaveUserPayload) {
  return apiRequest<ManagedUser>(`/api/auth/users/${userId}`, {
    method: "PUT",
    body: JSON.stringify(payload),
  });
}

export function deleteUser(userId: string) {
  return apiRequest<void>(`/api/auth/users/${userId}`, {
    method: "DELETE",
  });
}

export function deactivateUser(userId: string) {
  return apiRequest<ManagedUser>(`/api/auth/users/${userId}/deactivate`, {
    method: "POST",
  });
}

export function activateUser(userId: string) {
  return apiRequest<ManagedUser>(`/api/auth/users/${userId}/activate`, {
    method: "POST",
  });
}

export function resetUserPassword(userId: string) {
  return apiRequest<UserCredentialResponse>(`/api/auth/users/${userId}/reset-password`, {
    method: "POST",
  });
}
