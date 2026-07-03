import { API_URL, apiRequest } from "@/lib/api";
import type {
  InventoryItem,
  InventoryItemType,
  InventoryMovement,
  InventoryMovementType,
  InventorySummary,
} from "@/types/inventory";

export type SaveInventoryItemPayload = {
  item_type: InventoryItemType;
  name: string;
  description: string | null;
  unit_code: string;
  minimum_stock?: string | null;
  material_type?: string | null;
  purity?: string | null;
};

export type CreateInventoryMovementPayload = {
  item_id: string;
  movement_type: InventoryMovementType;
  quantity: string;
  unit_cost?: string | null;
  reason: string;
  reference_type?: string | null;
  reference_id?: string | null;
  source_file_name?: string | null;
  source_file_mime?: string | null;
  source_file_content?: string | null;
};

export function getInventorySummary() {
  return apiRequest<InventorySummary>("/api/inventory/summary");
}

export function listInventoryItems(itemType?: InventoryItemType | "TODOS") {
  const query = itemType && itemType !== "TODOS" ? `?item_type=${itemType}` : "";
  return apiRequest<InventoryItem[]>(`/api/inventory/items${query}`);
}

export function createInventoryItem(payload: SaveInventoryItemPayload) {
  return apiRequest<InventoryItem>("/api/inventory/items", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function updateInventoryItem(itemId: string, payload: SaveInventoryItemPayload) {
  return apiRequest<InventoryItem>(`/api/inventory/items/${itemId}`, {
    method: "PUT",
    body: JSON.stringify(payload),
  });
}

export function deleteInventoryItem(itemId: string) {
  return apiRequest<void>(`/api/inventory/items/${itemId}`, { method: "DELETE" });
}

export function listInventoryMovements(itemId?: string) {
  const query = itemId ? `?item_id=${itemId}` : "";
  return apiRequest<InventoryMovement[]>(`/api/inventory/movements${query}`);
}

export function createInventoryMovement(payload: CreateInventoryMovementPayload) {
  return apiRequest<InventoryMovement>("/api/inventory/movements", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export async function downloadInventoryMovementSourceFile(movementId: string) {
  const response = await fetch(`${API_URL}/api/inventory/movements/${movementId}/source-file`, {
    credentials: "include",
    cache: "no-store",
  });
  if (!response.ok) {
    if (response.status === 404) throw new Error("Este movimiento no tiene un XML asociado.");
    if (response.status === 403) throw new Error("No tienes permiso para descargar este archivo.");
    throw new Error("No se pudo descargar el XML. Intenta nuevamente.");
  }
  return response.blob();
}
