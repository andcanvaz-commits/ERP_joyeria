export type ProductionProcessStage = {
  id: string;
  name: string;
  description: string | null;
  stage_order: number;
  estimated_minutes: number | null;
  requires_weighing: boolean;
  is_active: boolean;
};

export type ProductionProcess = {
  id: string;
  name: string;
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
};

export type ProductionRun = {
  id: string;
  process_id: string;
  process_name: string;
  quantity: string;
  status: "EN_PROCESO" | "FINALIZADA" | "CANCELADA";
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
  started_at: string;
  finished_at: string | null;
  stages: ProductionRunStage[];
};
