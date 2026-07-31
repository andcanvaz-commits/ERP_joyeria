import type { CatalogSegment } from "@/lib/catalog-api";
import type { InventoryItem } from "@/types/inventory";

// Empata un texto de material con un segmento MATERIAL activo del catálogo:
// exacto primero; si no, el segmento cuya etiqueta esté contenida en el
// texto (ej. "ORO 18K" → ORO), tomando la etiqueta más larga que calce.
// Compartido por inventario (conversión de lote) y producción (clave de
// receta): misma regla, un solo lugar.
export function matchMaterialSegment(
  text: string | null | undefined,
  segments: CatalogSegment[],
): CatalogSegment | null {
  if (!text) return null;
  const clean = text.trim().toUpperCase();
  const materialSegments = segments.filter((segment) => segment.kind === "MATERIAL" && segment.is_active);
  const exact = materialSegments.find((segment) => segment.label.trim().toUpperCase() === clean);
  if (exact) return exact;
  const partial = materialSegments
    .filter((segment) => clean.includes(segment.label.trim().toUpperCase()))
    .sort((a, b) => b.label.length - a.label.length);
  return partial[0] ?? null;
}

// Código de material (1 dígito) de una pieza/materia prima de inventario,
// empatando (material_type ?? name) contra el catálogo. undefined si no hay
// texto o no calza con ningún segmento activo.
export function materialCodeForItem(
  item: InventoryItem | null | undefined,
  segments: CatalogSegment[],
): string | undefined {
  if (!item) return undefined;
  const match = matchMaterialSegment(item.material_type ?? item.name, segments);
  return match?.code ?? undefined;
}
