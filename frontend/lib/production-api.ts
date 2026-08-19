import { apiRequest } from "@/lib/api";
import type { AllocationPreview, ProductionProcess, ProductionRun } from "@/types/production";

// Banco de procesos (seccion 3): un paso suelto reutilizable, sin sub-etapas
// ni insumos preconfigurados -- eso se agrega suelto por etapa en el acta.
export type CreateProductionProcessPayload = {
  name: string;
  description?: string | null;
  is_active?: boolean;
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
  // Cantidad total de materia prima en la unidad de medida del item elegido.
  quantity: string;
  raw_material_item_id: string;
  // Plan de resultantes: la suma de cantidades debe igualar quantity.
  products: Array<{ product_type_id?: string; target_item_id?: string; quantity: string }>;
  // Cantidad total de cada insumo configurado en las etapas activas del proceso (obligatorio 1:1).
  stage_ingredients?: Array<{ process_stage_ingredient_id: string; quantity: string }>;
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

export function rejectProductionRunMaterials(runId: string, reason?: string | null) {
  return apiRequest<ProductionRun>(`/api/production/runs/${runId}/reject-materials`, {
    method: "POST",
    body: JSON.stringify({ reason: reason ?? null }),
  });
}

export function cancelProductionRun(runId: string, reason?: string) {
  return apiRequest<ProductionRun>(`/api/production/runs/${runId}/cancel`, {
    method: "POST",
    body: JSON.stringify({ reason: reason?.trim() || null }),
  });
}

// Cancela toda la familia (raiz + corridas hijas de split) de una vez, sin
// importar en que estado quedo cada una -- para cuando un split arranco solo
// una parte y el resto ya no tiene sentido esperar. Puede llamarse con el id
// de cualquier miembro de la familia.
export function cancelProductionRunFamily(runId: string, reason?: string) {
  return apiRequest<ProductionRun[]>(`/api/production/runs/${runId}/cancel-family`, {
    method: "POST",
    body: JSON.stringify({ reason: reason?.trim() || null }),
  });
}

export function approveProductionRunMaterials(runId: string) {
  return apiRequest<ProductionRun>(`/api/production/runs/${runId}/approve-materials`, {
    method: "POST",
  });
}

export function allocateProductionRunMaterial(runId: string, quantityUnits: string) {
  return apiRequest<ProductionRun>(`/api/production/runs/${runId}/allocate-material`, {
    method: "POST",
    body: JSON.stringify({ quantity_units: quantityUnits }),
  });
}

/** Dry-run: cuánto cubriría destinar esta cantidad. No consume ni cambia estado. */
export function previewProductionRunAllocation(runId: string, quantityUnits: string) {
  return apiRequest<AllocationPreview>(`/api/production/runs/${runId}/allocation-preview`, {
    method: "POST",
    body: JSON.stringify({ quantity_units: quantityUnits }),
  });
}

/** Dry-run: cuánto cubriría aprobar materiales hoy, con todos los recursos
 * cortos (materia prima e insumos). No consume ni cambia estado. */
export function previewProductionRunApproveMaterials(runId: string) {
  return apiRequest<AllocationPreview>(`/api/production/runs/${runId}/approve-materials-preview`);
}

/** Guarda el stock para la orden sin consumirlo ni arrancarla. */
export function reserveProductionRunMaterial(runId: string, quantityUnits: string) {
  return apiRequest<ProductionRun>(`/api/production/runs/${runId}/reserve-material`, {
    method: "POST",
    body: JSON.stringify({ quantity_units: quantityUnits }),
  });
}

export function releaseProductionRunReservation(runId: string) {
  return apiRequest<ProductionRun>(`/api/production/runs/${runId}/release-reservation`, {
    method: "POST",
  });
}

/** Reserva completa: recién aquí se consume de verdad y arranca. */
export function startProductionRunWithReserved(runId: string) {
  return apiRequest<ProductionRun>(`/api/production/runs/${runId}/start-reserved`, {
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

export function editProductionRunStageWeight(
  stageId: string,
  payload: { initial_weight?: string | null; final_weight: string; justification?: string | null },
) {
  return apiRequest<ProductionRun>(`/api/production/runs/stages/${stageId}/edit-weight`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function receiveProductionRunFinishedProduct(runId: string, wasteItemId?: string, wasteItemName?: string) {
  return apiRequest<ProductionRun>(`/api/production/runs/${runId}/receive-finished`, {
    method: "POST",
    body: JSON.stringify({ waste_item_id: wasteItemId ?? null, waste_item_name: wasteItemName ?? null }),
  });
}

export function requestAdditionalMaterial(runId: string, payload: { item_id: string; quantity: string; note?: string | null }) {
  return apiRequest<ProductionRun>(`/api/production/runs/${runId}/additional-materials`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function approveAdditionalMaterial(requestId: string) {
  return apiRequest<ProductionRun>(`/api/production/runs/additional-materials/${requestId}/approve`, {
    method: "POST",
  });
}

export function rejectAdditionalMaterial(requestId: string, reason?: string | null) {
  return apiRequest<ProductionRun>(`/api/production/runs/additional-materials/${requestId}/reject`, {
    method: "POST",
    body: JSON.stringify({ reason: reason ?? null }),
  });
}

export function addActaLine(runId: string, payload: { side: "ENTREGA" | "RECEPCION"; label: string; quantity: string; unit_code: string; item_id?: string | null; note?: string | null }) {
  return apiRequest<ProductionRun>(`/api/production/runs/${runId}/acta-lines`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function addAdminActaLine(runId: string, payload: { side: "ENTREGA" | "RECEPCION"; item_id?: string | null; label?: string | null; quantity: string; unit_code?: string | null; note?: string | null; stage_attempt_id?: string | null }) {
  return apiRequest<ProductionRun>(`/api/production/runs/${runId}/acta-lines/admin`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function updateActaLine(lineId: string, payload: { label?: string; quantity?: string; unit_code?: string; note?: string | null }) {
  return apiRequest<ProductionRun>(`/api/production/runs/acta-lines/${lineId}`, {
    method: "PUT",
    body: JSON.stringify(payload),
  });
}

export function deleteActaLine(lineId: string) {
  return apiRequest<ProductionRun>(`/api/production/runs/acta-lines/${lineId}`, {
    method: "DELETE",
  });
}

// --- Flujo dinamico de produccion (docs/cambios-sistema-produccion.md seccion 4) ---

/** Crea la orden con solo un nombre libre, sin proceso ni materia prima fijos. */
export function createProductionOrder(name: string) {
  return apiRequest<ProductionRun>("/api/production/orders", {
    method: "POST",
    body: JSON.stringify({ name }),
  });
}

/** Elige un proceso del banco y arranca un intento de etapa (secuencial: una
 * etapa activa a la vez por orden). */
export function startStageAttempt(runId: string, payload: { process_id: string; responsable_name: string }) {
  return apiRequest<ProductionRun>(`/api/production/runs/${runId}/stage-attempts`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

/** Termina el intento activo: ✔ (APROBADA, calcula merma propia) o ✘
 * (RECHAZADA, motivo siempre opcional). */
export function finishStageAttempt(
  attemptId: string,
  payload: { peso_al_finalizar: string; decision: "APROBADA" | "RECHAZADA"; rejection_reason?: string | null },
) {
  return apiRequest<ProductionRun>(`/api/production/runs/stage-attempts/${attemptId}/finish`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

/** Asigna el avance actual a producto terminado, disponible en cualquier
 * momento de la orden (no solo al final) -- cierra la orden (TERMINADA). */
export function assignProduct(
  runId: string,
  products: Array<{ product_type_id?: string; target_item_id?: string; quantity: string }>,
) {
  return apiRequest<ProductionRun>(`/api/production/runs/${runId}/assign-product`, {
    method: "POST",
    body: JSON.stringify({ products }),
  });
}

