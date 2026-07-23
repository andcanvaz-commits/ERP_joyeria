export interface StageIngredient {
  id: string;
  inventory_item_id: string;
  quantity: string;
  unit_code: string;
}

export type ProductionProcessStage = {
  id: string;
  name: string;
  description: string | null;
  phase_name: string | null;
  stage_type: string;
  quality_check: string | null;
  rework_action: string | null;
  rework_target_order?: number | null;
  stage_order: number;
  requires_weighing: boolean;
  is_active: boolean;
  ingredients?: StageIngredient[];
};

export type ProductionProcessMaterial = {
  id: string;
  inventory_item_id: string;
  quantity_per_unit: string;
  unit_code: string;
};

export type ProductionProcess = {
  id: string;
  name: string;
  code?: string | null;
  description: string | null;
  version: number;
  materials: ProductionProcessMaterial[];
  waste_limit_percent: string;
  is_active: boolean;
  stages: ProductionProcessStage[];
  // Tipos de producto del catálogo que este proceso puede producir (vacío = todos).
  product_type_ids?: string[];
};

export type ProductionRunStage = {
  id: string;
  source_stage_id: string;
  stage_name: string;
  stage_code?: string | null;
  phase_name: string | null;
  stage_type: string;
  quality_check: string | null;
  rework_action: string | null;
  stage_order: number;
  requires_weighing: boolean;
  status: "PENDIENTE" | "EN_PROCESO" | "FINALIZADA";
  scheduled_start_at: string | null;
  scheduled_finish_at: string | null;
  started_at: string | null;
  finished_at: string | null;
  initial_weight: string | null;
  final_weight: string | null;
  waste_weight: string | null;
  waste_percent: string | null;
  finished_by_name?: string | null;
  rework_target_order?: number | null;
  decisions?: StageDecision[];
};

export type StageDecision = {
  decision: "APPROVED" | "REJECTED";
  justification: string | null;
  weight_based: boolean;
  final_weight: string | null;
  returned_to_order: number | null;
  decided_by_name?: string | null;
  decided_at: string;
  attempt_no: number;
};

export type ProductionRun = {
  id: string;
  process_id: string;
  process_name: string;
  production_code?: string | null;
  quantity: string;
  status:
    | "PENDIENTE_INVENTARIO"
    | "MATERIALES_APROBADOS"
    | "EN_PROCESO"
    | "PENDIENTE_RECEPCION"
    | "RECIBIDA"
    | "CANCELADA";
  raw_material_item_id: string;
  raw_material_quantity_per_unit: string;
  raw_material_unit_code: string;
  total_required_material: string;
  waste_limit_percent: string;
  expected_finished_weight: string;
  actual_finished_weight: string | null;
  waste_weight: string | null;
  waste_percent: string | null;
  created_by_user_id: string;
  created_by_name?: string | null;
  started_by_name?: string | null;
  materials_approved_by_name?: string | null;
  received_by_name?: string | null;
  rejected_by_name?: string | null;
  rejection_reason?: string | null;
  rejected_at?: string | null;
  // Producto objetivo declarado al crear la orden (opcional).
  target_product_type_id?: string | null;
  requested_at: string;
  materials_approved_at: string | null;
  started_at: string | null;
  finished_at: string | null;
  received_at: string | null;
  stages: ProductionRunStage[];
  // Tipos de producto que el proceso de esta orden puede producir (vacío = todos).
  allowed_product_type_ids?: string[];
  // Insumos consumidos al aprobar materiales (para el acta de entrega).
  supply_consumptions?: Array<{ name: string; quantity: string; unit_code: string }>;
  // Plan de resultantes (split) declarado al crear la orden.
  products?: Array<{ id: string; product_type_id: string; product_name?: string | null; quantity: string }>;
  // Complementos de inventario solicitados para ensamblar.
  complements?: Array<{ id: string; item_id: string; name?: string | null; quantity: string; unit_code: string; status: string }>;
};
