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
};

const DASH = "—"; // —

function num(value: string | null | undefined): number {
  if (value === null || value === undefined || value === "") return 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

/** Productos resultantes de UNA corrida con la cantidad REAL producida, no
 * la planeada -- vacio mientras la corrida sigue en curso (`finished_at`
 * null): el lado RECIBIDO no debe adelantar un numero que todavia no se
 * sabe. Al terminar, `run.actual_finished_weight` (peso real = entregado
 * menos merma real, ver `_finish_run` en backend/modules/production/service.py)
 * se reparte entre las lineas de producto declaradas en la MISMA proporcion
 * que se planearon -- si una corrida declaro dos productos 70/30, el peso
 * real tambien se reparte 70/30, igual que hace `_split_run_for_partial_material`
 * al partir una orden. En ENSAMBLAR (siempre 1 solo producto, create_run
 * lo exige) el peso de la pieza no es solo materia prima: se le suma lo
 * que de verdad se incorporo de cada complemento aprobado -- aprobado
 * menos devuelto, en la misma unidad de la materia prima, sin conversion
 * de peso por unidad (Rodrigo, 2026-08-16: "sin nada por unidad, sumas y
 * punto"). Si nada se devolvio, usado = todo lo aprobado. */
function realProductsForRun(run: ProductionRun): NonNullable<ProductionRun["products"]> {
  if (run.finished_at === null || run.actual_finished_weight === null || run.actual_finished_weight === undefined) {
    return [];
  }
  const products = run.products ?? [];
  const plannedTotal = products.reduce((sum, p) => sum + num(p.quantity), 0);
  if (plannedTotal <= 0) return [];
  const ratio = Number(run.actual_finished_weight) / plannedTotal;
  const scaled = products.map((p) => ({ ...p, quantity: String(num(p.quantity) * ratio) }));
  if (run.assembly_mode === "ENSAMBLAR" && scaled.length === 1) {
    const unit = run.raw_material_unit_code;
    const complementWeight = (run.complements ?? [])
      .filter((c) => c.status === "APROBADA" && c.unit_code === unit)
      .reduce((sum, c) => sum + (num(c.quantity) - num(c.returned_quantity)), 0);
    if (complementWeight > 0) {
      scaled[0] = { ...scaled[0], quantity: String(num(scaled[0].quantity) + complementWeight) };
    }
  }
  return scaled;
}

/** Convierte productos (ya con cantidad REAL, ver `realProductsForRun`) en
 * filas normales del lado RECIBIDO -- mismo formato que cualquier otra fila
 * (cantidad en su propia columna), no un aviso aparte con estilo distinto:
 * antes vivian en un bloque de texto fusionado ("Producto: X (400g) · Y
 * (100g)") que ademas mostraba el plan fijo desde el dia 1 -- Rodrigo:
 * "esa parte del acta debe estar vacia hasta que no se acabe...ahi si
 * aparece en la fila la cantidad exacta de lo que se produjo". Agrupa por
 * identidad real (product_type_id / target_item_id), no por nombre, para no
 * fusionar dos productos distintos que compartan texto. */
function productoRealLines(
  products: NonNullable<ProductionRun["products"]>,
  fallbackUnit: string
): Extract<ActaSideLine, { kind: "row" }>[] {
  const merged = new Map<string, { label: string; quantity: number; unit: string }>();
  for (const p of products) {
    const key = p.product_type_id ?? p.target_item_id ?? p.product_name ?? "—";
    const qty = num(p.quantity);
    const existing = merged.get(key);
    if (existing) {
      existing.quantity += qty;
    } else {
      merged.set(key, { label: p.product_name ?? "—", quantity: qty, unit: p.unit_code || fallbackUnit });
    }
  }
  return [...merged.entries()].map(([key, p]) => ({
    kind: "row" as const,
    id: `producto-real-${key}`,
    label: `Producto: ${p.label}`,
    quantity: String(p.quantity),
    unit_code: p.unit,
    editable: false,
  }));
}

function sumRowsByUnit(lines: ActaSideLine[], unit: string): number {
  return lines
    .filter((l): l is Extract<ActaSideLine, { kind: "row" }> => l.kind === "row" && l.unit_code === unit)
    .reduce((sum, l) => sum + num(l.quantity), 0);
}

// Los totales son la suma LITERAL de las filas que YA se muestran
// (entregaLines/recepcionLines, construidas por el caller) -- ni una
// formula de "entregado - merma - devoluciones" ni "producto + filas"
// calculada aparte, para que el total nunca pueda desincronizarse de lo
// impreso (fue la causa raiz de tres correcciones seguidas de este plan).
// "Merma Etapa X" no aparece en recepcionLines (se filtra al armarlas, ver
// buildRunActaSides/recepcionRowsForRun) -- por eso no hace falta
// excluirla aca: sumar recepcionLines tal cual ya da el numero correcto.
function computeRunTotals(
  run: ProductionRun,
  entregaLines: ActaSideLine[],
  recepcionLines: ActaSideLine[]
): { entregaTotalRows: ActaSideTotal[]; recepcionTotalRows: ActaSideTotal[] } {
  const unit = run.raw_material_unit_code;
  const rawMaterialId = run.raw_material_item_id;
  if (!unit || !rawMaterialId) return { entregaTotalRows: [], recepcionTotalRows: [] };
  // Sin aprobar todavia no hay total que mostrar -- la materia prima PLAN se
  // siembra al crear la orden, asi que sumar sin este chequeo daba un
  // "Total entregado"/"Total recibido" desde el dia 1, antes de que
  // inventario aprobara nada.
  if (run.materials_approved_at === null) return { entregaTotalRows: [], recepcionTotalRows: [] };
  const entregaTotal = sumRowsByUnit(entregaLines, unit);
  if (entregaTotal <= 0) return { entregaTotalRows: [], recepcionTotalRows: [] };

  const mermaAcumulada = run.stages.reduce((sum, stage) => sum + num(stage.waste_weight), 0);
  const recepcionTotal = sumRowsByUnit(recepcionLines, unit);

  const recepcionTotalRows: ActaSideTotal[] = [
    { label: "Total recibido", quantity: recepcionTotal, unit, kind: "total" },
  ];
  // La fila de merma total solo tiene sentido "al final": finished_at queda
  // seteado en _finish_run sin importar si hubo o no una etapa que pese.
  // Antes de eso el proceso sigue en curso -- lo que "falta" en recibido no
  // es merma todavia, es simplemente material que aun no paso por una etapa.
  if (run.finished_at !== null) {
    recepcionTotalRows.push({ label: "Merma total", quantity: mermaAcumulada, unit, kind: "merma" });
  }
  return {
    entregaTotalRows: [{ label: "Total entregado", quantity: entregaTotal, unit, kind: "total" }],
    recepcionTotalRows,
  };
}

export type RunActaSides = {
  entregaLines: ActaSideLine[];
  entregaFecha: string | null;
  entregaResponsable: string;
  recepcionLines: ActaSideLine[];
  recepcionFecha: string | null;
  recepcionResponsable: string;
  entregaTotalRows: ActaSideTotal[];
  recepcionTotalRows: ActaSideTotal[];
};

/** El acta completa de UN run: filas, totales y fase -- FUENTE UNICA para
 * Ver Acta y para Documentos cuando la familia es un solo run (el caso
 * normal, sin split). No hay una version "equivalente" separada para cada
 * vista: ambas llaman esta misma funcion, así no pueden divergir de nuevo. */
export function buildRunActaSides(run: ProductionRun): RunActaSides {
  const lines = run.acta_lines ?? [];
  const entregaLines: ActaSideLine[] = lines
    .filter((l) => l.side === "ENTREGA")
    .map((l) => ({ kind: "row" as const, id: l.id, label: l.label, quantity: l.quantity, unit_code: l.unit_code, editable: l.source === "MANUAL" }));
  // La linea RECEPCION "PLAN" (producto resultante planeado, sembrada al
  // crear la orden) no es un recibo real -- se queda fuera de las filas
  // mostradas; el producto resultante REAL se antepone abajo, vacio
  // mientras la corrida sigue en curso (ver productoRealLines). Las de
  // merma por etapa (stage_id != null) tampoco se muestran como fila --
  // solo "Merma total" (Rodrigo, 2026-08-16: la de arriba estaba
  // repetida con la de abajo).
  const recepcionLines: ActaSideLine[] = [
    ...productoRealLines(realProductsForRun(run), run.raw_material_unit_code),
    ...lines
      .filter((l) => l.side === "RECEPCION" && l.source !== "PLAN" && l.stage_id == null)
      .map((l) => ({ kind: "row" as const, id: l.id, label: l.label, quantity: l.quantity, unit_code: l.unit_code, editable: l.source === "MANUAL" })),
  ];

  const { entregaTotalRows, recepcionTotalRows } = computeRunTotals(run, entregaLines, recepcionLines);

  return {
    entregaLines,
    entregaFecha: run.materials_approved_at,
    entregaResponsable: run.materials_approved_by_name ?? DASH,
    recepcionLines,
    recepcionFecha: run.received_at,
    recepcionResponsable: run.received_by_name ?? DASH,
    entregaTotalRows,
    recepcionTotalRows,
  };
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
    .filter((line) => line.side === "RECEPCION" && line.source !== "PLAN" && line.stage_id == null)
    .map((line) => ({ kind: "row" as const, id: line.id, label: line.label, quantity: line.quantity, unit_code: line.unit_code, editable: false }));
}

/** ¿Este run tiene avance real del lado RECIBIDO? Recepcion real (linea
 * no-PLAN, evento historico, recepcion final) o una etapa que pesa ya
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

  // Caso normal (sin split, la enorme mayoria de las ordenes): exactamente
  // la misma acta que "Ver acta" muestra para ese run -- misma funcion, cero
  // logica separada que pueda volver a divergir.
  if (!isHistorical && family.length === 1) {
    const sides = buildRunActaSides(root);
    return {
      folio: root.root_production_code ?? root.production_code ?? DASH,
      procesoNombre: root.process_name,
      categoria: materialName,
      responsableProduccion: root.created_by_name ?? DASH,
      entregaLines: sides.entregaLines,
      entregaFecha: sides.entregaFecha,
      entregaResponsable: sides.entregaResponsable,
      recepcionLines: sides.recepcionLines,
      recepcionFecha: sides.recepcionFecha,
      recepcionResponsable: sides.recepcionResponsable,
      entregaTotalRows: sides.entregaTotalRows,
      recepcionTotalRows: sides.recepcionTotalRows,
      cancelada: root.status === "CANCELADA",
    };
  }

  // Split real (2+ corridas activas) o familia historica (event_lines,
  // migrada de papel): se agrega por corrida (buildFamilyActaSides).
  const sides = buildFamilyActaSides(family);
  return {
    folio: root.root_production_code ?? root.production_code ?? DASH,
    procesoNombre: root.process_name,
    categoria: materialName,
    responsableProduccion: root.created_by_name ?? DASH,
    entregaLines: sides.entregaLines,
    entregaFecha: sides.entregaFecha,
    entregaResponsable: sides.entregaResponsable,
    recepcionLines: sides.recepcionLines,
    recepcionFecha: sides.recepcionFecha,
    recepcionResponsable: sides.recepcionResponsable,
    entregaTotalRows: sides.entregaTotalRows,
    recepcionTotalRows: sides.recepcionTotalRows,
    cancelada: family.every((run) => run.status === "CANCELADA"),
  };
}

/** El acta de una FAMILIA completa (2+ corridas activas por split, o una
 * familia historica migrada de papel): mismo shape que buildRunActaSides,
 * sumando/agrupando todos los miembros -- fuente unica para Documentos
 * (buildOrdenProduccion) y para Ver Acta cuando la corrida que se abre
 * pertenece a una familia dividida, asi ninguna de las dos vuelve a
 * divergir de lo que la otra muestra. */
export function buildFamilyActaSides(family: ProductionRun[]): RunActaSides {
  const root = family.find((run) => !run.parent_run_id) ?? family[0];
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

  const rawUnit = root.raw_material_unit_code;
  const rawMaterialId = root.raw_material_item_id;
  const familyRealProducts = family.flatMap((run) => realProductsForRun(run));
  // Solo aporta cada corrida que ya termino (realProductsForRun devuelve
  // vacio mientras sigue en curso) -- si el padre ya acabo y la hija sigue
  // ESPERANDO_MATERIAL, la familia muestra unicamente lo real del padre, no
  // el plan completo de ambos.
  const recepcionLines: ActaSideLine[] = [
    ...productoRealLines(familyRealProducts, root.raw_material_unit_code),
    ...recepcionSide.lines,
  ];

  // Totales entregado/recibido/merma para la familia completa: suma
  // LITERAL de las filas YA construidas arriba (entregaSide.lines,
  // recepcionLines) -- mismo criterio que computeRunTotals, para que el
  // total nunca pueda desincronizarse de lo impreso. No aplica a familias
  // historicas (event_lines, migradas de papel): esas no necesariamente
  // reconciliaban. Sin aprobar todavia no hay total que mostrar.
  const entregaTotalRows: ActaSideTotal[] = [];
  const recepcionTotalRows: ActaSideTotal[] = [];
  if (!isHistorical && rawUnit && rawMaterialId && canPrintEntrega(family)) {
    const entregaTotal = sumRowsByUnit(entregaSide.lines, rawUnit);
    if (entregaTotal > 0) {
      const mermaAcumulada = family
        .flatMap((run) => run.stages)
        .reduce((sum, stage) => sum + num(stage.waste_weight), 0);
      const recepcionTotal = sumRowsByUnit(recepcionLines, rawUnit);
      entregaTotalRows.push({ label: "Total entregado", quantity: entregaTotal, unit: rawUnit, kind: "total" });
      recepcionTotalRows.push({ label: "Total recibido", quantity: recepcionTotal, unit: rawUnit, kind: "total" });
      // "Al final": es UNA sola acta para toda la familia (padre + hijas de
      // split) -- la merma total recien tiene sentido cuando TODAS las
      // corridas activas terminaron su ultima etapa, no apenas una.
      const allFinished = family.every((run) => run.finished_at !== null || run.status === "CANCELADA");
      if (allFinished) {
        recepcionTotalRows.push({ label: "Merma total", quantity: mermaAcumulada, unit: rawUnit, kind: "merma" });
      }
    }
  }

  return {
    entregaLines: entregaSide.lines,
    entregaFecha: entregaSide.fecha,
    entregaResponsable: entregaSide.responsable,
    recepcionLines,
    recepcionFecha: recepcionSide.fecha,
    recepcionResponsable: recepcionSide.responsable,
    entregaTotalRows,
    recepcionTotalRows,
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
