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
  is_active: boolean;
  stages: ProductionProcessStage[];
};
