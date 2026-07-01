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
  estimated_minutes: number | null;
  requires_weighing: boolean;
  is_active: boolean;
  ingredients?: StageIngredient[];
};

export type ProductionProcess = {
  id: string;
  name: string;
  code?: string | null;
  product_code?: string | null;
  description: string | null;
  version: number;
  raw_material_item_id: string | null;
  raw_material_quantity_per_unit: string | null;
  raw_material_unit_code: string | null;
  waste_limit_percent: string;
  is_active: boolean;
  stages: ProductionProcessStage[];
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
  estimated_minutes: number | null;
  requires_weighing: boolean;
  status: "PENDIENTE" | "EN_PROCESO" | "FINALIZADA";
  scheduled_start_at: string | null;
  scheduled_finish_at: string | null;
  started_at: string | null;
  finished_at: string | null;
  initial_weight: string | null;
  final_weight: string | null;
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
  product_code?: string | null;
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
  requested_at: string;
  materials_approved_at: string | null;
  started_at: string | null;
  finished_at: string | null;
  received_at: string | null;
  stages: ProductionRunStage[];
};
