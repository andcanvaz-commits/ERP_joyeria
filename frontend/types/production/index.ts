export type ProductionOrderStatus =
  | "BORRADOR"
  | "PENDIENTE"
  | "EN_PROCESO"
  | "PAUSADA"
  | "FINALIZADA"
  | "CANCELADA";

export type ProcessTemplateStage = {
  id: string;
  name: string;
  description: string | null;
  stage_order: number;
  estimated_minutes: number | null;
  requires_initial_weight: boolean;
  requires_final_weight: boolean;
  allows_waste: boolean;
  requires_observation: boolean;
  is_required: boolean;
  is_active: boolean;
};

export type ProcessTemplate = {
  id: string;
  product_id: string | null;
  name: string;
  description: string | null;
  version: number;
  is_active: boolean;
  stages: ProcessTemplateStage[];
};

export type ProductionOrderStage = {
  id: string;
  source_stage_id: string;
  stage_name: string;
  stage_description: string | null;
  stage_order: number;
  estimated_minutes: number | null;
  requires_initial_weight: boolean;
  requires_final_weight: boolean;
  allows_waste: boolean;
  requires_observation: boolean;
  is_required: boolean;
  status: string;
  initial_weight: string | null;
  final_weight: string | null;
  waste_weight: string | null;
  observations: string | null;
  started_at: string | null;
  finished_at: string | null;
};

export type ProductionOrder = {
  id: string;
  product_id: string;
  process_template_id: string;
  quantity: string;
  status: ProductionOrderStatus;
  process_snapshot: {
    name?: string;
    version?: number;
    stages?: unknown[];
  };
  notes: string | null;
  created_by_user_id: string;
  started_by_user_id: string | null;
  started_at: string | null;
  finished_at: string | null;
  stages: ProductionOrderStage[];
};
