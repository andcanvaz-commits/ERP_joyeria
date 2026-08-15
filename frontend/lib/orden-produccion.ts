import type { ProductionRun } from "@/types/production";
import type { InventoryItem } from "@/types/inventory";

// Tipos compartidos por el UNICO componente que renderiza una columna del
// certificado/acta (components/production/acta-side.tsx), usado tanto por
// Documentos (family, solo lectura) como por Ver Acta (un run, editable) --
// viven aca (no en acta-side.tsx) para que ninguno de los dos importe del
// otro en circulo.
export type ActaSideLine =
  | { kind: "row"; id: string; label: string; quantity: string; unit_code: string; editable: boolean }
  | { kind: "group"; fecha: string | null; responsable: string };

// Fila de total/balance: mismo lugar que una fila real, con su propia
// etiqueta ("Total entregado", "Total recibido", "Merma total") y un color
// distinto segun el tipo -- un total no es lo mismo que una merma, no deben
// leerse igual.
export type ActaSideTotal = { label: string; quantity: number; unit: string; kind: "total" | "merma" };

export type OrdenProduccionModel = {
  folio: string;
  procesoNombre: string;
  cantidad: number | null;
  cantidadUnidad: string;
  categoria: string;
  responsableProduccion: string;
  entregaLines: ActaSideLine[];
  entregaFecha: string | null;
  entregaResponsable: string;
  recepcionLines: ActaSideLine[];
  recepcionFecha: string | null;
  recepcionResponsable: string;
  entregaTotalRows: ActaSideTotal[];
  recepcionTotalRows: ActaSideTotal[];
  cancelada: boolean;
  recepcionPhase: ActaRightPhase;
  productosResultantes: string;
};

const DASH = "—"; // —

function num(value: string | null | undefined): number {
  if (value === null || value === undefined || value === "") return 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

export type ActaRightPhase = "SOLO_PRODUCTO" | "CONSTRUYENDO";

/** Fase del lado RECIBIDO del certificado/acta. La aprobacion de inventario
 * es del lado ENTREGA, no de RECEPCION -- sin aprobar todavia, RECEPCION no
 * lleva ningun aviso especial, se queda en blanco (CONSTRUYENDO con tabla
 * vacia, igual que siempre). Solo cuando ya se aprobo y todavia no hay avance
 * real (ninguna etapa que pesa termino, sin devoluciones) tiene sentido un
 * aviso: que producto sera el resultante. Una etapa que pesa y termina en 0%
 * de merma cuenta como avance real -- no es "merma > 0" lo que dispara
 * CONSTRUYENDO, es que de verdad se peso algo. */
export function actaRightPhase(params: {
  approved: boolean;
  stages: Array<{ requires_weighing: boolean; status: string }>;
  hasRecepcionLines: boolean;
}): ActaRightPhase {
  if (!params.approved) return "CONSTRUYENDO";
  const hasWeighedStage = params.stages.some(
    (s) => s.requires_weighing && s.status === "FINALIZADA"
  );
  if (hasWeighedStage || params.hasRecepcionLines) return "CONSTRUYENDO";
  return "SOLO_PRODUCTO";
}

function formatQty(value: number): string {
  return value.toLocaleString("es-EC", { maximumFractionDigits: 4 });
}

/** "Anillo Filigrana (5 und) · Cadena Barbada (3 und)" -- mismo formato que
 * RunSummaryRows en solicitudes-view.tsx. Agrupa por identidad real
 * (product_type_id / target_item_id), no por nombre, para no fusionar dos
 * productos distintos que compartan texto. */
export function formatProductosResultantes(
  products: NonNullable<ProductionRun["products"]>
): string {
  const merged = new Map<string, { label: string; quantity: number; unit: string }>();
  for (const p of products) {
    const key = p.product_type_id ?? p.target_item_id ?? p.product_name ?? "—";
    const qty = num(p.quantity);
    const existing = merged.get(key);
    if (existing) {
      existing.quantity += qty;
    } else {
      merged.set(key, { label: p.product_name ?? "—", quantity: qty, unit: p.unit_code || "und" });
    }
  }
  if (merged.size === 0) return "—";
  return [...merged.values()]
    .map((p) => `${p.label} (${formatQty(p.quantity)} ${p.unit})`)
    .join(" · ");
}

/** Mapa inventory_item_id → nombre, a partir de la lista de inventario. */
export function buildItemNameMap(items: InventoryItem[]): Map<string, string> {
  return new Map(items.map((item) => [item.id, item.name]));
}

/** Clave de familia: el folio raiz si esta corrida es parte de un split,
 * si no su propio folio (o su id como ultimo recurso). */
export function runFamilyKey(run: ProductionRun): string {
  return run.root_production_code || run.production_code || run.id;
}

/** Agrupa corridas por familia (folio raiz + sus hijas), cada grupo
 * ordenado por production_code para que la raiz siempre quede primero. */
export function groupRunFamilies(runs: ProductionRun[]): Map<string, ProductionRun[]> {
  const groups = new Map<string, ProductionRun[]>();
  for (const run of runs) {
    const key = runFamilyKey(run);
    const existing = groups.get(key);
    if (existing) {
      existing.push(run);
    } else {
      groups.set(key, [run]);
    }
  }
  for (const group of groups.values()) {
    group.sort((a, b) => (a.production_code ?? "").localeCompare(b.production_code ?? ""));
  }
  return groups;
}

/** Atajo: la familia completa (dentro de `runs`) a la que pertenece `run`. */
export function getRunFamily(runs: ProductionRun[], run: ProductionRun): ProductionRun[] {
  const key = runFamilyKey(run);
  return runs.filter((candidate) => runFamilyKey(candidate) === key)
    .sort((a, b) => (a.production_code ?? "").localeCompare(b.production_code ?? ""));
}

/** Filas ENTREGA de un run: historicas (event_lines) tienen precedencia, si
 * no la acta persistida (acta_lines) -- misma fuente y mismo orden que Ver
 * Acta, sin filtrar por source (PLAN incluido: es "la parte de entrega" que
 * el certificado muestra desde el principio, antes de aprobar). */
function entregaRowsForRun(run: ProductionRun): Extract<ActaSideLine, { kind: "row" }>[] {
  const eventLines = (run.event_lines ?? []).filter((line) => line.side === "ENTREGA");
  if (eventLines.length > 0) {
    return eventLines.map((line, i) => ({
      kind: "row" as const,
      id: `${run.id}-ent-ev-${i}`,
      label: line.detalle ?? "",
      quantity: line.gramos,
      unit_code: line.unidad,
      editable: false,
    }));
  }
  return (run.acta_lines ?? [])
    .filter((line) => line.side === "ENTREGA")
    .map((line) => ({ kind: "row" as const, id: line.id, label: line.label, quantity: line.quantity, unit_code: line.unit_code, editable: false }));
}

/** Filas RECEPCION de un run -- misma fuente que Ver Acta, y mismo filtro: la
 * linea PLAN (producto resultante planeado, sembrada al crear la orden) no
 * es un recibo real, se queda fuera (esa info ya la da el aviso "Producto
 * resultante"); mostrarla como fila hacia que Ver Acta y Documentos
 * divergieran (Ver Acta la mostraba sin filtrar, Documentos no la contaba
 * como dato asi que no empujaba el evento -- bug reportado). */
function recepcionRowsForRun(run: ProductionRun): Extract<ActaSideLine, { kind: "row" }>[] {
  const eventLines = (run.event_lines ?? []).filter((line) => line.side === "RECEPCION");
  if (eventLines.length > 0) {
    return eventLines.map((line, i) => ({
      kind: "row" as const,
      id: `${run.id}-rec-ev-${i}`,
      label: line.detalle ?? "",
      quantity: line.gramos,
      unit_code: line.unidad,
      editable: false,
    }));
  }
  return (run.acta_lines ?? [])
    .filter((line) => line.side === "RECEPCION" && line.source !== "PLAN")
    .map((line) => ({ kind: "row" as const, id: line.id, label: line.label, quantity: line.quantity, unit_code: line.unit_code, editable: false }));
}

/** Mismo criterio que actaRightPhase para CONSTRUYENDO: recepcion real
 * (linea no-PLAN, evento historico, recepcion final) o una etapa que pesa ya
 * termino (aunque sin devolucion todavia). Sin esto, un pesaje sin devolucion
 * dejaba el evento de recepcion sin empujar y el certificado divergia de Ver
 * Acta, que ya mostraba fila por fila con la misma condicion. */
function recepcionHasData(run: ProductionRun, familyHasWeighedStage: boolean): boolean {
  if ((run.event_lines ?? []).some((line) => line.side === "RECEPCION")) return true;
  if (run.received_at !== null) return true;
  if (familyHasWeighedStage) return true;
  return (run.acta_lines ?? []).some((line) => line.side === "RECEPCION" && line.source !== "PLAN");
}

/** Arma un lado (ENTREGA o RECEPCION) para toda la familia: un solo header
 * (fecha/responsable) + filas planas cuando solo un miembro tiene datos de
 * ese lado -- el caso normal, sin split -- para que se vea IGUAL que Ver
 * Acta (que solo conoce un run). Con 2+ miembros con datos (split real) se
 * agrupa cada uno bajo su propia fecha/responsable, unico caso donde
 * Documentos necesita algo que Ver Acta no. */
function buildSide(
  family: ProductionRun[],
  pick: (run: ProductionRun) => { hasData: boolean; fecha: string | null; responsable: string; rows: Extract<ActaSideLine, { kind: "row" }>[] }
): { lines: ActaSideLine[]; fecha: string | null; responsable: string } {
  const withData = family.map(pick).filter((entry) => entry.hasData);
  if (withData.length === 0) return { lines: [], fecha: null, responsable: DASH };
  if (withData.length === 1) {
    const [only] = withData;
    return { lines: only.rows, fecha: only.fecha, responsable: only.responsable };
  }
  const lines: ActaSideLine[] = [];
  for (const entry of withData) {
    lines.push({ kind: "group", fecha: entry.fecha, responsable: entry.responsable });
    lines.push(...entry.rows);
  }
  return { lines, fecha: null, responsable: DASH };
}

/** Construye el modelo del comprobante "Orden de Producción" desde una
 * familia completa (folio raiz + hijas de split, o un solo run si nunca se
 * partio). Misma forma (ActaSideLine[]) y mismo componente (ActaSide) que
 * usa Ver Acta -- para una familia sin split (el caso normal) el resultado
 * es identico a lo que Ver Acta mostraria para ese unico run. */
export function buildOrdenProduccion(
  family: ProductionRun[],
  itemNames: Map<string, string>
): OrdenProduccionModel {
  const root = family.find((run) => !run.parent_run_id) ?? family[0];
  const materialName = (root.raw_material_item_id ? itemNames.get(root.raw_material_item_id) : undefined) ?? root.process_name;
  const isHistorical = family.some((run) => (run.event_lines ?? []).length > 0);
  const familyHasWeighedStage = family
    .flatMap((run) => run.stages)
    .some((s) => s.requires_weighing && s.status === "FINALIZADA");

  const entregaSide = buildSide(family, (run) => ({
    hasData: entregaRowsForRun(run).length > 0,
    fecha: run.materials_approved_at,
    responsable: run.materials_approved_by_name ?? DASH,
    rows: entregaRowsForRun(run),
  }));

  const recepcionSide = buildSide(family, (run) => ({
    hasData: recepcionHasData(run, familyHasWeighedStage),
    fecha: run.received_at,
    responsable: run.received_by_name ?? DASH,
    rows: recepcionRowsForRun(run),
  }));

  // Totales entregado/recibido/merma: misma logica que la vista editable del
  // acta (acta-view.tsx computeBalanceTotals) -- los gramos que entraron a
  // producir no quedan fijos, se actualizan segun la merma real registrada
  // (stage.waste_weight de cada etapa de cada miembro de la familia), no
  // segun ninguna linea de la acta. No aplica a familias historicas
  // (event_lines, migradas de papel): esas no necesariamente reconciliaban.
  // Sin aprobar todavia no hay total que mostrar -- la materia prima PLAN se
  // siembra al crear la orden, asi que sumar por item_id sin chequear
  // aprobacion daba un total desde el dia 1.
  const rawUnit = root.raw_material_unit_code;
  const rawMaterialId = root.raw_material_item_id;
  const entregaTotalRows: ActaSideTotal[] = [];
  const recepcionTotalRows: ActaSideTotal[] = [];
  if (!isHistorical && rawUnit && rawMaterialId && canPrintEntrega(family)) {
    const entregaTotal = family
      .flatMap((run) => run.acta_lines ?? [])
      .filter((line) => line.side === "ENTREGA" && line.item_id === rawMaterialId)
      .reduce((sum, line) => sum + num(line.quantity), 0);
    if (entregaTotal > 0) {
      const mermaAcumulada = family
        .flatMap((run) => run.stages)
        .reduce((sum, stage) => sum + num(stage.waste_weight), 0);
      entregaTotalRows.push({ label: "Total entregado", quantity: entregaTotal, unit: rawUnit, kind: "total" });
      recepcionTotalRows.push({ label: "Total recibido", quantity: entregaTotal - mermaAcumulada, unit: rawUnit, kind: "total" });
      // "Al final": es UNA sola acta para toda la familia (padre + hijas de
      // split) -- la merma total recien tiene sentido cuando TODAS las
      // corridas activas terminaron su ultima etapa, no apenas una.
      const allFinished = family.every((run) => run.finished_at !== null || run.status === "CANCELADA");
      if (allFinished) {
        recepcionTotalRows.push({ label: "Merma total", quantity: mermaAcumulada, unit: rawUnit, kind: "merma" });
      }
    }
  }

  const recepcionPhase: ActaRightPhase = isHistorical
    ? "CONSTRUYENDO"
    : actaRightPhase({
        approved: canPrintEntrega(family),
        stages: family.flatMap((run) => run.stages),
        // La linea RECEPCION "PLAN" (producto resultante planeado) se siembra
        // al crear la orden -- no es avance real, no debe disparar CONSTRUYENDO.
        hasRecepcionLines: family.some((run) =>
          (run.acta_lines ?? []).some((line) => line.side === "RECEPCION" && line.source !== "PLAN")
        ),
      });
  const productosResultantes = formatProductosResultantes(
    family.flatMap((run) => run.products ?? [])
  );

  return {
    folio: root.root_production_code ?? root.production_code ?? DASH,
    procesoNombre: root.process_name,
    cantidad: isHistorical ? null : family.reduce((total, run) => total + num(run.quantity), 0),
    cantidadUnidad: root.raw_material_unit_code,
    categoria: materialName,
    responsableProduccion: root.created_by_name ?? DASH,
    entregaLines: entregaSide.lines,
    entregaFecha: entregaSide.fecha,
    entregaResponsable: entregaSide.responsable,
    recepcionLines: recepcionSide.lines,
    recepcionFecha: recepcionSide.fecha,
    recepcionResponsable: recepcionSide.responsable,
    entregaTotalRows,
    recepcionTotalRows,
    cancelada: family.every((run) => run.status === "CANCELADA"),
    recepcionPhase,
    productosResultantes
  };
}

/** Formatea gramos con dos decimales (números tabulares en el documento). */
export function formatGramos(value: number): string {
  return value.toLocaleString("es-EC", { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

/** Formatea una fecha ISO a dd/mm/aaaa; vacío si no hay fecha. */
export function formatDocDate(iso: string | null): string {
  if (!iso) return "";
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString("es-EC", { day: "2-digit", month: "2-digit", year: "numeric" });
}

/** ¿La familia completa ya arranco (nadie quedo ESPERANDO_MATERIAL)? Solo
 * ahi tiene sentido imprimir la entrega unificada. */
export function canPrintEntrega(family: ProductionRun[]): boolean {
  return (
    family.length > 0 &&
    family.some((run) => run.materials_approved_at !== null) &&
    !family.some((run) => run.status === "ESPERANDO_MATERIAL" || run.status === "PENDIENTE_INVENTARIO")
  );
}

/** ¿Toda la familia ya fue recibida (o cancelada)? Solo ahi la recepcion
 * unificada esta completa.
 *
 * Excepcion: una familia historica migrada (alguna corrida trae
 * event_lines) puede quedar con miembros PENDIENTE_RECEPCION para siempre
 * — el papel entrego mas veces de las que recibio y esa recepcion nunca
 * va a ocurrir (no se inventa un cierre que el papel no tiene). Para esas
 * familias basta con que algun miembro se haya recibido de verdad. */
export function canPrintRecepcion(family: ProductionRun[]): boolean {
  if (family.length === 0) return false;
  const isHistorical = family.some((run) => (run.event_lines ?? []).length > 0);
  if (isHistorical) {
    return family.some((run) => run.received_at !== null);
  }
  return (
    family.some((run) => run.status === "RECIBIDA") &&
    family.every((run) => run.status === "RECIBIDA" || run.status === "CANCELADA")
  );
}
