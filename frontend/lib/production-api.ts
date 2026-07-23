import { apiRequest } from "@/lib/api";
import type { AssemblyRecipe, ProductionProcess, ProductionRun } from "@/types/production";

export type CreateProductionProcessPayload = {
  name: string;
  description?: string | null;
  version?: number;
  materials: Array<{
    inventory_item_id: string;
    quantity_per_unit: string;
    unit_code: string;
  }>;
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
    requires_weighing: boolean;
    is_active?: boolean;
    ingredients?: Array<{
      inventory_item_id: string;
      quantity: string;
      unit_code: string;
    }>;
  }>;
  // Tipos de producto del catálogo que el proceso puede producir (vacío = todos).
  product_type_ids?: string[];
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

export function createProductionRun(payload: {
  process_id: string;
  quantity: string;
  raw_material_item_id: string;
  // Modo de destino del resultante: asignar a piezas existentes o ensamblar una nueva.
  assembly_mode: "ASIGNAR" | "ENSAMBLAR";
  // Plan de resultantes: la suma de cantidades debe igualar quantity.
  products: Array<{ product_type_id?: string; target_item_id?: string; quantity: string }>;
  // Complementos solicitados al inventario (opcional).
  complements?: Array<{ item_id: string; quantity: string }>;
}) {
  return apiRequest<ProductionRun>("/api/production/runs", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function updateProductionRunProducts(
  runId: string,
  products: Array<{ product_type_id?: string; target_item_id?: string; quantity: string }>,
) {
  return apiRequest<ProductionRun>(`/api/production/runs/${runId}/products`, {
    method: "PUT",
    body: JSON.stringify({ products }),
  });
}

// Define la combinacion de complementos aplicada al ensamble del resultante.
export function defineRunAssembly(
  runId: string,
  items: Array<{ complement_item_id: string; quantity_per_unit: string }>,
) {
  return apiRequest<ProductionRun>(`/api/production/runs/${runId}/assembly`, {
    method: "POST",
    body: JSON.stringify({ items }),
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

export function getAssemblyRecipe(params: { productTypeId?: string; itemId?: string }) {
  const query = params.productTypeId
    ? `product_type_id=${params.productTypeId}`
    : `item_id=${params.itemId}`;
  return apiRequest<AssemblyRecipe>(`/api/production/assembly-recipes?${query}`);
}

export function upsertAssemblyRecipe(
  modelKey: string,
  items: Array<{ complement_item_id: string; quantity_per_unit: string }>,
) {
  return apiRequest<AssemblyRecipe>(`/api/production/assembly-recipes/${modelKey}`, {
    method: "PUT",
    body: JSON.stringify({ items }),
  });
}

export function listAssemblyRecipeModelKeys() {
  return apiRequest<string[]>("/api/production/assembly-recipes/types");
}
