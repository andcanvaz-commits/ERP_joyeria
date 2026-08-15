import type { ProductionRun } from "@/types/production";
import type { InventoryItem } from "@/types/inventory";

/** Una fila de la tabla CANTIDAD / DETALLES del comprobante: cada una lleva su
 * propia unidad (g, und, ml…). */
export type DocRow = { gramos: number; unidad: string; detalle: string };

export type DocSide = {
  fecha: string | null;
  responsable: string;
  rows: DocRow[];
};

// Fila de total/balance: mismo lugar que una fila real, con su propia
// etiqueta ("Total entregado", "Total recibido", "Merma total") y un color
// distinto segun el tipo -- misma logica y misma pinta que la vista editable
// del acta (acta-view.tsx), para que el certificado impreso y el editable no
// se contradigan.
export type DocTotalRow = { label: string; gramos: number; unidad: string; kind: "total" | "merma" };

export type OrdenProduccionModel = {
  folio: string;
  procesoNombre: string;
  cantidad: number | null;
  cantidadUnidad: string;
  categoria: string;
  responsableProduccion: string;
  entrega: DocSide[];
  recepcion: DocSide[];
  entregaTotalRows: DocTotalRow[];
  recepcionTotalRows: DocTotalRow[];
  cancelada: boolean;
};

const DASH = "—"; // —

function num(value: string | null | undefined): number {
  if (value === null || value === undefined || value === "") return 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
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

/** Construye el modelo del comprobante "Orden de Producción" desde una
 * familia completa (folio raiz + hijas de split, o un solo run si nunca se
 * partio). Un evento de ENTREGA/RECEPCION por cada miembro que la tenga. */
export function buildOrdenProduccion(
  family: ProductionRun[],
  itemNames: Map<string, string>
): OrdenProduccionModel {
  const root = family.find((run) => !run.parent_run_id) ?? family[0];
  const materialName = (root.raw_material_item_id ? itemNames.get(root.raw_material_item_id) : undefined) ?? root.process_name;

  const entrega: DocSide[] = [];
  const recepcion: DocSide[] = [];
  const isHistorical = family.some((run) => (run.event_lines ?? []).length > 0);

  for (const run of family) {
    const entregaLines = (run.event_lines ?? []).filter((line) => line.side === "ENTREGA");
    if (run.materials_approved_at !== null) {
      // Historica (papel): sus propias lineas. Corrida en vivo: la acta
      // persistida (run.acta_lines), la misma fuente que se ve/edita en
      // "Ver acta" — incluye lo planeado y lo agregado durante el proceso.
      const rows: DocRow[] =
        entregaLines.length > 0
          ? entregaLines.map((line) => ({ gramos: num(line.gramos), unidad: line.unidad, detalle: line.detalle ?? "" }))
          : (run.acta_lines ?? [])
              .filter((line) => line.side === "ENTREGA")
              .map((line) => ({ gramos: num(line.quantity), unidad: line.unit_code, detalle: line.label }));
      entrega.push({
        fecha: run.materials_approved_at,
        responsable: run.materials_approved_by_name ?? DASH,
        rows
      });
    }

    const recepcionLines = (run.event_lines ?? []).filter((line) => line.side === "RECEPCION");
    if (run.received_at !== null) {
      const rows: DocRow[] =
        recepcionLines.length > 0
          ? recepcionLines.map((line) => ({ gramos: num(line.gramos), unidad: line.unidad, detalle: line.detalle ?? "" }))
          : (run.acta_lines ?? [])
              .filter((line) => line.side === "RECEPCION")
              .map((line) => ({ gramos: num(line.quantity), unidad: line.unit_code, detalle: line.label }));
      recepcion.push({
        fecha: run.received_at,
        responsable: run.received_by_name ?? DASH,
        rows
      });
    }
  }

  // Totales entregado/recibido/merma: misma logica que la vista editable del
  // acta (acta-view.tsx computeBalanceTotals) -- los gramos que entraron a
  // producir no quedan fijos, se actualizan segun la merma real registrada
  // (stage.waste_weight de cada etapa de cada miembro de la familia), no
  // segun ninguna linea de la acta (ni "Merma etapa X" ni el producto
  // resultante, que nace con la cantidad PLANEADA y nunca se corrige
  // despues del pesaje). No aplica a familias historicas (event_lines,
  // migradas de papel): esas no necesariamente reconciliaban.
  const rawUnit = root.raw_material_unit_code;
  const rawMaterialId = root.raw_material_item_id;
  const entregaTotalRows: DocTotalRow[] = [];
  const recepcionTotalRows: DocTotalRow[] = [];
  if (!isHistorical && rawUnit && rawMaterialId) {
    const entregaTotal = family
      .flatMap((run) => run.acta_lines ?? [])
      .filter((line) => line.side === "ENTREGA" && line.item_id === rawMaterialId)
      .reduce((sum, line) => sum + num(line.quantity), 0);
    if (entregaTotal > 0) {
      const mermaAcumulada = family
        .flatMap((run) => run.stages)
        .reduce((sum, stage) => sum + num(stage.waste_weight), 0);
      entregaTotalRows.push({ label: "Total entregado", gramos: entregaTotal, unidad: rawUnit, kind: "total" });
      recepcionTotalRows.push({ label: "Total recibido", gramos: entregaTotal - mermaAcumulada, unidad: rawUnit, kind: "total" });
      // "Al final": es UNA sola acta para toda la familia (padre + hijas de
      // split) -- la merma total recien tiene sentido cuando TODAS las
      // corridas activas terminaron su ultima etapa, no apenas una. Antes
      // se disparaba con que UNA sola corrida tuviera finished_at, y una
      // familia con una pierna aun EN_PROCESO mostraba "perdido" todo lo que
      // esa pierna simplemente no habia entregado todavia (bug reportado).
      const allFinished = family.every((run) => run.finished_at !== null || run.status === "CANCELADA");
      if (allFinished) {
        recepcionTotalRows.push({ label: "Merma total", gramos: mermaAcumulada, unidad: rawUnit, kind: "merma" });
      }
    }
  }

  return {
    folio: root.root_production_code ?? root.production_code ?? DASH,
    procesoNombre: root.process_name,
    cantidad: isHistorical ? null : family.reduce((total, run) => total + num(run.quantity), 0),
    cantidadUnidad: root.raw_material_unit_code,
    categoria: materialName,
    responsableProduccion: root.created_by_name ?? DASH,
    entrega,
    recepcion,
    entregaTotalRows,
    recepcionTotalRows,
    cancelada: family.every((run) => run.status === "CANCELADA")
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
