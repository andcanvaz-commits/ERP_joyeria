export type InventoryItemType = "RAW_MATERIAL" | "WORK_IN_PROGRESS" | "FINISHED_PRODUCT";

export type InventoryMovementType =
  | "ENTRADA"
  | "SALIDA"
  | "AJUSTE_POSITIVO"
  | "AJUSTE_NEGATIVO"
  | "CONSUMO_PRODUCCION"
  | "INGRESO_PRODUCCION"
  | "MERMA";

export type InventoryItem = {
  id: string;
  item_type: InventoryItemType;
  name: string;
  sku: string;
  product_code?: string | null;
  description: string | null;
  unit_code: string;
  minimum_stock: string | null;
  current_stock: string;
  material_type?: string | null;
  purity?: string | null;
  average_cost?: string;
};

export type InventoryMovement = {
  id: string;
  item_id: string;
  movement_type: InventoryMovementType;
  quantity: string;
  unit_code: string;
  unit_cost: string | null;
  lot_code?: string | null;
  reason: string;
  reference_type: string | null;
  reference_id: string | null;
  source_file_name: string | null;
  created_by: string | null;
  created_by_name?: string | null;
  created_at: string;
  item: InventoryItem;
};

export type InventorySummary = {
  raw_materials: number;
  work_in_progress: number;
  finished_products: number;
  low_stock_items: number;
  total_items: number;
};
