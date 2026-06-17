import { apiRequest, saveAccessToken } from "@/lib/api";

export type LoginResponse = {
  access_token: string;
  refresh_token: string;
  token_type: string;
};

export type CurrentUser = {
  id: string;
  username: string;
  role: string;
  permissions: string[];
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
