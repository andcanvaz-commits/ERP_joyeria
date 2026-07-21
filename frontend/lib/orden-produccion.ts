import type { ProductionRun } from "@/types/production";
import type { InventoryItem } from "@/types/inventory";

/** Una fila de la tabla GRAMOS / DETALLES del comprobante. La unidad permite
 * listar insumos que no van en gramos (und, ml…); solo las filas en gramos
 * suman al total. */
export type DocRow = { gramos: number; unidad: string; detalle: string };

export type DocSide = {
  fecha: string | null;
  responsable: string;
  rows: DocRow[];
  total: number;
};

export type OrdenProduccionModel = {
  folio: string;
  procesoNombre: string;
  cantidad: number;
  categoria: string;
  responsableProduccion: string;
  entrega: DocSide;
  recepcion: DocSide;
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

/** Construye el modelo del comprobante "Orden de Producción" desde una orden real. */
export function buildOrdenProduccion(
  run: ProductionRun,
  itemNames: Map<string, string>
): OrdenProduccionModel {
  const materialName = itemNames.get(run.raw_material_item_id) ?? run.process_name;

  const materialUnit = run.raw_material_unit_code || "g";
  const entregaRows: DocRow[] = [
    { gramos: num(run.total_required_material), unidad: materialUnit, detalle: materialName }
  ];
  // Insumos que salieron de inventario junto con la materia prima (pueden
  // tener otra unidad de medida: se listan con ella y no suman al total).
  for (const supply of run.supply_consumptions ?? []) {
    entregaRows.push({
      gramos: num(supply.quantity),
      unidad: supply.unit_code || "g",
      detalle: `Insumo: ${supply.name}`
    });
  }

  // Recepción: solo lo que realmente entra a inventario (el producto). La merma
  // no se "recibe": queda registrada en el kardex y el resumen del proceso.
  const recepcionRows: DocRow[] = [];
  if (run.actual_finished_weight !== null) {
    recepcionRows.push({
      gramos: num(run.actual_finished_weight),
      unidad: materialUnit,
      detalle: `Producto terminado: ${run.process_name}`
    });
  }

  // Total solo en gramos: no se mezclan unidades distintas en una misma suma.
  const sum = (rows: DocRow[]) =>
    rows.filter((row) => row.unidad === "g").reduce((acc, row) => acc + row.gramos, 0);

  return {
    folio: run.production_code ?? DASH,
    procesoNombre: run.process_name,
    cantidad: num(run.quantity),
    categoria: materialName,
    responsableProduccion: run.created_by_name ?? DASH,
    entrega: {
      fecha: run.materials_approved_at,
      responsable: run.materials_approved_by_name ?? DASH,
      rows: entregaRows,
      total: sum(entregaRows)
    },
    recepcion: {
      fecha: run.received_at,
      responsable: run.received_by_name ?? DASH,
      rows: recepcionRows,
      total: sum(recepcionRows)
    },
    cancelada: run.status === "CANCELADA"
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

/** ¿La mitad de entrega ya puede imprimirse? (materiales aprobados) */
export function canPrintEntrega(run: ProductionRun): boolean {
  return run.materials_approved_at !== null;
}

/** ¿La mitad de recepción / el documento completo ya pueden imprimirse? (recibido) */
export function canPrintRecepcion(run: ProductionRun): boolean {
  return run.received_at !== null;
}
