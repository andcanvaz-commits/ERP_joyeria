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

/** Cierra la orden completa: cada etapa ya declaro su producto resultante,
 * asi que no mueve inventario -- solo la saca de "en curso". Solo se puede
 * llamar sin ninguna etapa activa. */
export function finishOrder(runId: string) {
  return apiRequest<ProductionRun>(`/api/production/runs/${runId}/finish`, {
    method: "POST",
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

export function addActaLine(runId: string, payload: { side: "ENTREGA" | "RECEPCION"; label: string; quantity: string; unit_code: string; item_id?: string | null; note?: string | null }) {
  return apiRequest<ProductionRun>(`/api/production/runs/${runId}/acta-lines`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function addAdminActaLine(runId: string, payload: { side: "ENTREGA" | "RECEPCION"; item_id?: string | null; product_type_id?: string | null; material_code?: string | null; label?: string | null; quantity: string; unit_code?: string | null; note?: string | null; stage_attempt_id?: string | null }) {
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
 * etapa activa a la vez por orden). `materials` (Entrada) y `products`
 * (Producto resultante) mueven stock de inmediato -- sin split ni reserva:
 * si una Entrada pide mas de lo que hay en stock, el backend rechaza la
 * llamada entera (nada queda a medias). */
export function startStageAttempt(
  runId: string,
  payload: {
    process_id: string;
    responsable_name: string;
    materials?: Array<{ item_id: string; quantity: string }>;
    // Solo el destino -- la cantidad real se llena al finalizar (Rodrigo, 2026-08-20).
    products: Array<{ product_type_id?: string | null; target_item_id?: string | null; material_code?: string | null; quantity: string }>;
  },
) {
  return apiRequest<ProductionRun>(`/api/production/runs/${runId}/stage-attempts`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function approveStageAttempt(attemptId: string) {
  return apiRequest<ProductionRun>(`/api/production/runs/stage-attempts/${attemptId}/approve`, {
    method: "POST",
  });
}

export function rejectStageAttempt(attemptId: string, payload: { reason?: string | null }) {
  return apiRequest<ProductionRun>(`/api/production/runs/stage-attempts/${attemptId}/reject`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

/** Revierte y elimina un intento de etapa ya terminado (Rodrigo, 2026-08-20):
 * deshace su consumo de materia prima y la conversion de su producto
 * resultante, y borra sus lineas y el intento mismo -- a diferencia de
 * cancelar una orden (conserva la fila), una etapa mal cargada deja de
 * existir. Solo aplica a intentos APROBADA/RECHAZADA. */
export function revertStageAttempt(attemptId: string, reason?: string) {
  return apiRequest<ProductionRun>(`/api/production/runs/stage-attempts/${attemptId}/revert`, {
    method: "POST",
    body: JSON.stringify({ reason: reason?.trim() || null }),
  });
}

