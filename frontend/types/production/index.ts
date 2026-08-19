// Banco de procesos (docs/cambios-sistema-produccion.md seccion 3): un paso
// suelto reutilizable, sin sub-etapas ni insumos preconfigurados -- eso se
// agrega suelto por etapa en el acta (mismo mecanismo ADMIN_STOCK/MANUAL).
export type ProductionProcess = {
  id: string;
  name: string;
  code?: string | null;
  description: string | null;
  is_active: boolean;
  quality_control: boolean;
};

// Linea de material declarada al iniciar (o pendiente de asignar en) un
// intento de etapa. quantity_pending > 0 significa que todavia falta cubrir
// esa parte -- baja a 0 cuando allocate_stage_attempt_material la completa.
export type StageAttemptMaterial = {
  item_id: string;
  name?: string | null;
  unit_code: string;
  quantity_requested: string;
  quantity_pending: string;
};

// Intento de etapa del flujo nuevo (un ✔ o ✘): reemplaza ProductionRunStage
// para ordenes creadas con el flujo dinamico. Cada uno tiene su propia acta
// y su propia merma, independiente de los demas intentos de la orden.
export type StageAttempt = {
  id: string;
  run_id: string;
  process_id?: string | null;
  process_name: string;
  sequence_order: number;
  attempt_no_for_process: number;
  code?: string | null;
  responsable_name?: string | null;
  // PENDIENTE_MATERIAL: split automatico por falta de stock al iniciar la
  // etapa -- ver allocate_stage_attempt_material para asignarle el resto.
  status: "EN_PROCESO" | "APROBADA" | "RECHAZADA" | "PENDIENTE_MATERIAL";
  rejection_reason?: string | null;
  peso_al_finalizar?: string | null;
  unit_code?: string | null;
  merma_weight?: string | null;
  merma_percent?: string | null;
  started_by_name?: string | null;
  started_at: string;
  finished_by_name?: string | null;
  finished_at?: string | null;
  acta_lines?: ProductionRun["acta_lines"];
  materials: StageAttemptMaterial[];
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
  // Nulos en ordenes del flujo nuevo (ver `name`/`stage_attempts` abajo).
  process_id: string | null;
  process_name: string | null;
  // Nombre libre de la orden (flujo nuevo, seccion 4.1). Null en ordenes viejas.
  name?: string | null;
  production_code?: string | null;
  // Folio de la orden original cuando esta corrida nacio de un split por
  // falta de materia prima (null si nunca se partio).
  root_production_code?: string | null;
  // Corrida padre de la que se partio esta (null si es la original).
  parent_run_id?: string | null;
  quantity: string | null;
  status:
    | "PENDIENTE_INVENTARIO"
    | "MATERIALES_APROBADOS"
    | "EN_PROCESO"
    | "PENDIENTE_RECEPCION"
    | "RECIBIDA"
    | "CANCELADA"
    | "ESPERANDO_MATERIAL"
    | "TERMINADA";
  raw_material_item_id: string | null;
  raw_material_unit_code: string | null;
  total_required_material: string | null;
  // Materia prima guardada para esta orden sin consumir todavía. Con
  // reservation_is_complete gobierna el botón "Iniciar con lo reservado".
  reserved_material_quantity?: string;
  reservation_is_complete?: boolean;
  waste_limit_percent: string | null;
  expected_finished_weight: string | null;
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
  // false = rechazo de solicitud (antes de aprobar); true = cancelacion de
  // una orden ya avanzada (con reversion de inventario). Distingue
  // "Solicitud rechazada" de "Orden cancelada" en el historial.
  is_cancellation?: boolean;
  // Producto objetivo declarado al crear la orden (opcional).
  target_product_type_id?: string | null;
  requested_at: string;
  materials_approved_at: string | null;
  started_at: string | null;
  finished_at: string | null;
  received_at: string | null;
  // Flujo VIEJO: vacio en ordenes nuevas.
  stages: ProductionRunStage[];
  // Flujo NUEVO (seccion 4): un intento por ✔/✘. Vacio en ordenes viejas.
  stage_attempts?: StageAttempt[];
  // Tipos de producto que el proceso de esta orden puede producir (vacío = todos).
  allowed_product_type_ids?: string[];
  // Insumos consumidos al aprobar materiales (para el acta de entrega).
  supply_consumptions?: Array<{ item_id: string; name: string; quantity: string; unit_code: string }>;
  // Plan de resultantes (split) declarado al crear la orden.
  products?: Array<{
    id: string;
    product_type_id?: string | null;
    product_name?: string | null;
    quantity: string;
    target_item_id?: string | null;
    unit_code?: string | null;
  }>;
  // Líneas de evento del acta de entrega/recepción para certificación histórica.
  event_lines?: Array<{ side: "ENTREGA" | "RECEPCION"; gramos: string; unidad: string; detalle: string | null; line_order: number }>;
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
    // Item real de inventario detras de la linea (identidad, no texto):
    // permite distinguir materia prima de insumos/complementos aunque
    // coincidan en nombre, y sumar/reconciliar por item real.
    item_id?: string | null;
    source: "PLAN" | "AUTO" | "MANUAL" | "ADMIN_STOCK";
    stage_id?: string | null;
    // Intento de etapa del flujo nuevo al que pertenece esta linea (vacio =
    // linea de nivel de orden o del flujo viejo).
    stage_attempt_id?: string | null;
    stage_name?: string | null;
    note?: string | null;
    created_by_name?: string | null;
    created_at: string;
  }>;
};

// Un recurso puntual (materia prima, complemento o insumo de etapa) que no
// alcanza -- una orden puede estar corta de varios a la vez.
export type MaterialShortage = {
  name: string;
  unit: string;
  available: string;
  needed: string;
  is_complement: boolean;
};

/** Dry-run de "destinar" o de "aprobar materiales": cuánto alcanza a cubrir
 * el stock disponible hoy. `shortages` trae TODOS los recursos cortos, no
 * solo el que manda la fracción cubierta (limiting_*). */
export type AllocationPreview = {
  covered_qty: string;
  target_qty: string;
  is_partial: boolean;
  limiting_name: string;
  limiting_available: string;
  limiting_unit: string;
  limiting_required_per_unit: string;
  limiting_is_complement: boolean;
  shortages: MaterialShortage[];
};

// Producto resultante elegido: pieza existente (targetItemId) o tipo del
// catálogo aún sin piezas (productTypeId); label es lo que se muestra elegido.
export type ProductChoice = {
  targetItemId?: string;
  productTypeId?: string;
  label: string;
};
