export type InventoryItemType = "RAW_MATERIAL" | "SUPPLY" | "COMPLEMENT" | "WORK_IN_PROGRESS" | "FINISHED_PRODUCT" | "WASTE";

export type InventoryMovementType =
  | "ENTRADA"
  | "SALIDA"
  | "AJUSTE_POSITIVO"
  | "AJUSTE_NEGATIVO"
  | "CONSUMO_PRODUCCION"
  | "INGRESO_PRODUCCION"
  | "MERMA"
  | "CONVERSION_SALIDA"
  | "CONVERSION_ENTRADA"
  | "RECLASIFICACION_SALIDA"
  | "RECLASIFICACION_ENTRADA";

export type InventoryItem = {
  id: string;
  item_type: InventoryItemType;
  name: string;
  sku: string;
  product_code?: string | null;
  source_lot_sku?: string | null;
  description: string | null;
  unit_code: string;
  minimum_stock: string | null;
  current_stock: string;
  material_type?: string | null;
  purity?: string | null;
  average_cost?: string;
  total_weight?: string | null;
  // Gramos por unidad (solo piezas nacidas por conversión con el sistema).
  weight_per_unit?: string | null;
  elaboration_date?: string | null;
  archived_at?: string | null;
  // Tipo de complemento del catalogo (solo aplica a item_type COMPLEMENT).
  complement_type_id?: string | null;
};

export type ComplementType = {
  id: string;
  name: string;
  is_active: boolean;
};

export type WaitingProductionRunSummary = {
  run_id: string;
  production_code: string | null;
  root_production_code: string | null;
  process_name: string | null;
  missing_quantity: string;
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
  // Ordenes ESPERANDO_MATERIAL de esta materia prima: solo viene poblado en
  // la respuesta de un movimiento ENTRADA sobre un item RAW_MATERIAL.
  waiting_production_runs: WaitingProductionRunSummary[];
};

export type InventorySummary = {
  raw_materials: number;
  supplies: number;
  work_in_progress: number;
  finished_products: number;
  low_stock_items: number;
  total_items: number;
};
