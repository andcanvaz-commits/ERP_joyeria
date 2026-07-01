import { apiRequest } from "@/lib/api";
import type { ProductionProcess, ProductionRun } from "@/types/production";

export type CreateProductionProcessPayload = {
  name: string;
  product_code?: string | null;
  description?: string | null;
  version?: number;
  raw_material_item_id?: string | null;
  raw_material_quantity_per_unit?: string | null;
  raw_material_unit_code?: string | null;
  waste_limit_percent?: string;
  is_active?: boolean;
  stages: Array<{
    name: string;
    description?: string | null;
    phase_name?: string | null;
    stage_type?: string;
    quality_check?: string | null;
    rework_action?: string | null;
    order: number;
    estimated_minutes?: number | null;
    requires_weighing: boolean;
    is_active?: boolean;
    ingredients?: Array<{
      inventory_item_id: string;
      quantity: string;
      unit_code: string;
    }>;
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

export function listProductionRuns() {
  return apiRequest<ProductionRun[]>("/api/production/runs");
}

export function createProductionRun(payload: { process_id: string; quantity: string }) {
  return apiRequest<ProductionRun>("/api/production/runs", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function rejectProductionRunMaterials(runId: string, reason?: string | null) {
  return apiRequest<ProductionRun>(`/api/production/runs/${runId}/reject-materials`, {
    method: "POST",
    body: JSON.stringify({ reason: reason ?? null }),
  });
}

export function approveProductionRunMaterials(runId: string) {
  return apiRequest<ProductionRun>(`/api/production/runs/${runId}/approve-materials`, {
    method: "POST",
  });
}

export function startProductionRun(runId: string) {
  return apiRequest<ProductionRun>(`/api/production/runs/${runId}/start`, {
    method: "POST",
  });
}

export function finishProductionRunStage(
  stageId: string,
  payload: {
    initial_weight?: string | null;
    final_weight?: string | null;
    confirm_early_finish?: boolean;
    decision?: "APPROVED" | "REJECTED";
    justification?: string | null;
  },
) {
  return apiRequest<ProductionRun>(`/api/production/runs/stages/${stageId}/finish`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function receiveProductionRunFinishedProduct(runId: string) {
  return apiRequest<ProductionRun>(`/api/production/runs/${runId}/receive-finished`, {
    method: "POST",
  });
}
