import { apiRequest } from "@/lib/api";
import type { ProductionProcess } from "@/types/production";

export type CreateProductionProcessPayload = {
  name: string;
  description?: string | null;
  version?: number;
  is_active?: boolean;
  stages: Array<{
    name: string;
    description?: string | null;
    order: number;
    estimated_minutes?: number | null;
    requires_weighing: boolean;
    is_active?: boolean;
  }>;
};

export function listProcesses() {
  return apiRequest<ProductionProcess[]>("/api/production/processes");
}

export function createProcess(payload: CreateProductionProcessPayload) {
  return apiRequest<ProductionProcess>("/api/production/processes", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function updateProcess(processId: string, payload: CreateProductionProcessPayload) {
  return apiRequest<ProductionProcess>(`/api/production/processes/${processId}`, {
    method: "PUT",
    body: JSON.stringify(payload),
  });
}

export function deleteProcess(processId: string) {
  return apiRequest<void>(`/api/production/processes/${processId}`, {
    method: "DELETE",
  });
}
