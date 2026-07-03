import { apiRequest } from "@/lib/api";

export type Unit = {
  id: string;
  code: string;
  label: string;
  is_active: boolean;
};

export function listUnits() {
  return apiRequest<Unit[]>("/api/units");
}

export function createUnit(payload: { code: string; label: string }) {
  return apiRequest<Unit>("/api/units", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function deleteUnit(id: string) {
  return apiRequest<void>(`/api/units/${id}`, { method: "DELETE" });
}
