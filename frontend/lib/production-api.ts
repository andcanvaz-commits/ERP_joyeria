import { apiRequest } from "@/lib/api";
import type { ProductionProcess, ProductionRun } from "@/types/production";

// Banco de procesos (seccion 3): un paso suelto reutilizable, sin sub-etapas
// ni insumos preconfigurados -- eso se agrega suelto por etapa en el acta.
export type CreateProductionProcessPayload = {
  name: string;
  description?: string | null;
  is_active?: boolean;
  quality_control?: boolean;
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

export function updateProductionRunProducts(
  runId: string,
  products: Array<{ product_type_id?: string; target_item_id?: string; quantity: string }>,
) {
  return apiRequest<ProductionRun>(`/api/production/runs/${runId}/products`, {
    method: "PUT",
    body: JSON.stringify({ products }),
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
 * etapa activa a la vez por orden). Si vienen `materials`, valida stock: si
 * alcanza arranca directo (consume ya); si falta, hace split automatico --
 * la parte cubierta arranca EN_PROCESO y el resto queda PENDIENTE_MATERIAL
 * hasta que alguien lo asigne con allocateStageAttemptMaterial. */
export function startStageAttempt(
  runId: string,
  payload: {
    process_id: string;
    responsable_name: string;
    materials?: Array<{ item_id: string; quantity: string }>;
    product: { product_type_id?: string; target_item_id?: string; quantity: string };
  },
) {
  return apiRequest<ProductionRun>(`/api/production/runs/${runId}/stage-attempts`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

/** Asigna stock recien disponible a un intento PENDIENTE_MATERIAL: consume lo
 * que alcance y, si queda 100% cubierto y no hay otro intento activo en la
 * orden, lo arranca. */
export function allocateStageAttemptMaterial(attemptId: string) {
  return apiRequest<ProductionRun>(`/api/production/runs/stage-attempts/${attemptId}/allocate-material`, {
    method: "POST",
  });
}

/** Termina el intento activo: sin peso -- la merma sale de comparar ENTREGA
 * contra lo devuelto del mismo item en RECEPCION. decision solo importa si
 * el proceso tiene control de calidad; si no, el backend fuerza APROBADA. */
export function finishStageAttempt(
  attemptId: string,
  payload?: { decision?: "APROBADA" | "RECHAZADA"; rejection_reason?: string | null },
) {
  return apiRequest<ProductionRun>(`/api/production/runs/stage-attempts/${attemptId}/finish`, {
    method: "POST",
    body: JSON.stringify(payload ?? {}),
  });
}

