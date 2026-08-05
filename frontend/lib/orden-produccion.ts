import type { ProductionRun } from "@/types/production";
import type { InventoryItem } from "@/types/inventory";

/** Una fila de la tabla CANTIDAD / DETALLES del comprobante: cada una lleva su
 * propia unidad (g, und, ml…). */
export type DocRow = { gramos: number; unidad: string; detalle: string };

// Sin subtotal/total: las filas pueden mezclar unidades (g, und, ml…) y una
// suma única no tendría sentido.
export type DocSide = {
  fecha: string | null;
  responsable: string;
  rows: DocRow[];
};

export type OrdenProduccionModel = {
  folio: string;
  procesoNombre: string;
  cantidad: number | null;
  categoria: string;
  responsableProduccion: string;
  entrega: DocSide[];
  recepcion: DocSide[];
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
  const materialName = itemNames.get(root.raw_material_item_id) ?? root.process_name;
  const materialUnit = root.raw_material_unit_code || "g";

  const entrega: DocSide[] = [];
  const recepcion: DocSide[] = [];
  const isHistorical = family.some((run) => (run.event_lines ?? []).length > 0);

  for (const run of family) {
    const entregaLines = (run.event_lines ?? []).filter((line) => line.side === "ENTREGA");
    if (run.materials_approved_at !== null) {
      const rows: DocRow[] =
        entregaLines.length > 0
          ? entregaLines.map((line) => ({ gramos: num(line.gramos), unidad: line.unidad, detalle: line.detalle ?? "" }))
          : [{ gramos: num(run.total_required_material), unidad: materialUnit, detalle: materialName }];
      if (entregaLines.length === 0) {
        for (const supply of run.supply_consumptions ?? []) {
          rows.push({
            gramos: num(supply.quantity),
            unidad: supply.unit_code || "g",
            detalle: `Insumo: ${supply.name}`
          });
        }
      }
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
          : [];
      if (recepcionLines.length === 0) {
        if (run.actual_finished_weight !== null) {
          rows.push({
            gramos: num(run.actual_finished_weight),
            unidad: materialUnit,
            detalle: run.process_name
          });
        }
        for (const product of run.products ?? []) {
          rows.push({
            gramos: num(product.quantity),
            unidad: "und",
            detalle: `Producto final: ${product.product_name ?? "—"}`
          });
        }
      }
      recepcion.push({
        fecha: run.received_at,
        responsable: run.received_by_name ?? DASH,
        rows
      });
    }
  }

  return {
    folio: root.root_production_code ?? root.production_code ?? DASH,
    procesoNombre: root.process_name,
    cantidad: isHistorical ? null : family.reduce((total, run) => total + num(run.quantity), 0),
    categoria: materialName,
    responsableProduccion: root.created_by_name ?? DASH,
    entrega,
    recepcion,
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
