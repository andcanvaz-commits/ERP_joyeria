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
  total_weight?: string | null;
  elaboration_date?: string | null;
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

export function archiveInventoryItem(itemId: string) {
  return apiRequest<InventoryItem>(`/api/inventory/items/${itemId}/archive`, { method: "POST" });
}

export function unarchiveInventoryItem(itemId: string) {
  return apiRequest<InventoryItem>(`/api/inventory/items/${itemId}/unarchive`, { method: "POST" });
}

// Devuelve null cuando el item nacio de una factura XML y se elimino junto
// con su unica entrada al revertir.
export function revertLastEntry(itemId: string) {
  return apiRequest<InventoryItem | null>(`/api/inventory/items/${itemId}/revert-last-entry`, {
    method: "POST",
  });
}

export type ConvertLotPayload = {
  material_code: string;
  product_type_id: string;
  quantity: string;
  material_type?: string | null;
};

// Convierte parcialmente un lote de proceso terminado en un producto del
// catálogo (par de movimientos CONVERSION_SALIDA/CONVERSION_ENTRADA).
export function convertLotToProduct(lotItemId: string, payload: ConvertLotPayload) {
  return apiRequest<InventoryItem>(`/api/inventory/lots/${lotItemId}/convert`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export type CombineProductsPayload = {
  sources: Array<{ item_id: string; quantity: string }>;
  material_code: string;
  product_type_id: string;
  quantity: string;
  material_type?: string | null;
};

// Ensambla varias piezas de productos terminados en un producto nuevo del
// catálogo (ej. cadena + dije = collar), todo por movimientos.
export function combineProducts(payload: CombineProductsPayload) {
  return apiRequest<InventoryItem>("/api/inventory/products/combine", {
    method: "POST",
    body: JSON.stringify(payload),
  });
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
