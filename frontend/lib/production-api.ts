import { apiRequest } from "@/lib/api";
import type { ProcessTemplate, ProductionOrder } from "@/types/production";

export type CreateProcessTemplatePayload = {
  name: string;
  description?: string | null;
  product_id?: string | null;
  version: number;
  is_active: boolean;
  stages: Array<{
    name: string;
    description?: string | null;
    order: number;
    estimated_minutes?: number | null;
    requires_initial_weight: boolean;
    requires_final_weight: boolean;
    allows_waste: boolean;
    requires_observation: boolean;
    is_required: boolean;
    is_active: boolean;
  }>;
};

export type CreateProductionOrderPayload = {
  product_id: string;
  quantity: string;
  process_template_id: string;
  notes?: string | null;
};

export function listProcessTemplates() {
  return apiRequest<ProcessTemplate[]>("/api/production/process-templates?is_active=true");
}

export function createProcessTemplate(payload: CreateProcessTemplatePayload) {
  return apiRequest<ProcessTemplate>("/api/production/process-templates", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function listProductionOrders() {
  return apiRequest<ProductionOrder[]>("/api/production/orders");
}

export function createProductionOrder(payload: CreateProductionOrderPayload) {
  return apiRequest<ProductionOrder>("/api/production/orders", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function startProductionOrder(orderId: string) {
  return apiRequest<ProductionOrder>(`/api/production/orders/${orderId}/start`, {
    method: "POST",
  });
}

export function pauseProductionOrder(orderId: string) {
  return apiRequest<ProductionOrder>(`/api/production/orders/${orderId}/pause`, {
    method: "POST",
  });
}

export function resumeProductionOrder(orderId: string) {
  return apiRequest<ProductionOrder>(`/api/production/orders/${orderId}/resume`, {
    method: "POST",
  });
}

export function cancelProductionOrder(orderId: string) {
  return apiRequest<ProductionOrder>(`/api/production/orders/${orderId}/cancel`, {
    method: "POST",
  });
}

export function startProductionStage(stageId: string, payload: { initial_weight?: string | null; observations?: string | null }) {
  return apiRequest<ProductionOrder>(`/api/production/stages/${stageId}/start`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function finishProductionStage(
  stageId: string,
  payload: { final_weight?: string | null; waste_weight?: string | null; observations?: string | null },
) {
  return apiRequest<ProductionOrder>(`/api/production/stages/${stageId}/finish`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}
