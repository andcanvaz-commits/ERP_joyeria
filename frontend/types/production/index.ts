export interface StageIngredient {
  id: string;
  inventory_item_id: string;
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

export type ProductionProcess = {
  id: string;
  name: string;
  code?: string | null;
  description: string | null;
  version: number;
  waste_limit_percent: string;
  is_active: boolean;
  stages: ProductionProcessStage[];
  // Tipos de producto del catálogo que este proceso puede producir (vacío = todos).
  product_type_ids?: string[];
};

// Receta de ensamble por clave de modelo (categoria+modelo): ultima cantidad
// total usada por complemento (sugerencia, no autoritativa).
export type AssemblyRecipe = {
  model_key: string | null;
  items: Array<{ complement_item_id: string; name?: string | null; unit_code?: string | null; material_type?: string | null; quantity: string }>;
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
  // Folio de la orden original cuando esta corrida nacio de un split por
  // falta de materia prima (null si nunca se partio).
  root_production_code?: string | null;
  // Corrida padre de la que se partio esta (null si es la original).
  parent_run_id?: string | null;
  quantity: string;
  status:
    | "PENDIENTE_INVENTARIO"
    | "MATERIALES_APROBADOS"
    | "EN_PROCESO"
    | "PENDIENTE_RECEPCION"
    | "RECIBIDA"
    | "CANCELADA"
    | "ESPERANDO_MATERIAL";
  raw_material_item_id: string | null;
  raw_material_unit_code: string;
  total_required_material: string;
  // Materia prima guardada para esta orden sin consumir todavía. Con
  // reservation_is_complete gobierna el botón "Iniciar con lo reservado".
  reserved_material_quantity?: string;
  reservation_is_complete?: boolean;
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
  products?: Array<{
    id: string;
    product_type_id?: string | null;
    product_name?: string | null;
    quantity: string;
    target_item_id?: string | null;
    unit_code?: string | null;
  }>;
  // Complementos de inventario solicitados para ensamblar.
  complements?: Array<{
    id: string;
    item_id: string;
    name?: string | null;
    quantity: string;
    // Guardado para esta orden pero todavía no consumido.
    reserved_quantity?: string;
    unit_code: string;
    status: string;
  }>;
  // Líneas de evento del acta de entrega/recepción para certificación histórica.
  event_lines?: Array<{ side: "ENTREGA" | "RECEPCION"; gramos: string; unidad: string; detalle: string | null; line_order: number }>;
  // Modo de destino del resultante: asignar a piezas existentes o ensamblar una nueva.
  assembly_mode: "ASIGNAR" | "ENSAMBLAR";
  // Indica si falta definir la combinacion de complementos del ensamble.
  assembly_pending: boolean;
  // Combinacion de complementos aplicada al ensamble (totales).
  assembly_items?: Array<{ id: string; complement_item_id: string; name?: string | null; quantity: string }>;
  // Material adicional pedido mientras la corrida esta EN_PROCESO.
  additional_materials?: Array<{
    id: string;
    item_id: string;
    name?: string | null;
    quantity: string;
    unit_code: string;
    status: "PENDIENTE" | "APROBADA" | "RECHAZADA";
    stage_id?: string | null;
    stage_name?: string | null;
    note?: string | null;
    requested_by_name?: string | null;
    requested_at: string;
    approved_by_name?: string | null;
    approved_at?: string | null;
    rejection_reason?: string | null;
  }>;
  // Acta persistida: que entro y que salio de la orden.
  acta_lines?: Array<{
    id: string;
    side: "ENTREGA" | "RECEPCION";
    label: string;
    quantity: string;
    unit_code: string;
    source: "PLAN" | "AUTO" | "MANUAL";
    stage_id?: string | null;
    stage_name?: string | null;
    note?: string | null;
    created_by_name?: string | null;
    created_at: string;
  }>;
};

/** Dry-run de "destinar": cuánto alcanza a cubrir el stock disponible hoy. */
export type AllocationPreview = {
  covered_qty: string;
  target_qty: string;
  is_partial: boolean;
  limiting_name: string;
  limiting_available: string;
  limiting_unit: string;
  limiting_required_per_unit: string;
  limiting_is_complement: boolean;
};

// Producto resultante elegido: pieza existente (targetItemId) o tipo del
// catálogo aún sin piezas (productTypeId); label es lo que se muestra elegido.
export type ProductChoice = {
  targetItemId?: string;
  productTypeId?: string;
  label: string;
};
