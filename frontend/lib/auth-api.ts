import { apiRequest, saveAccessToken } from "@/lib/api";

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
  saveAccessToken(tokenPair.access_token);
  return tokenPair;
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
