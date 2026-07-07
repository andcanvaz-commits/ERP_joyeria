import { apiRequest } from "@/lib/api";

export type SegmentKind = "MATERIAL" | "CATEGORY" | "MODEL";

export type CatalogSegment = {
  id: string;
  kind: SegmentKind;
  code: string;
  label: string;
  parent_code: string | null;
  is_active: boolean;
};

export const SEGMENT_WIDTH: Record<SegmentKind, number> = {
  MATERIAL: 1,
  CATEGORY: 2,
  MODEL: 4
};

export function listCatalogSegments() {
  return apiRequest<CatalogSegment[]>("/api/catalog/segments");
}

export function createCatalogSegment(payload: {
  kind: SegmentKind;
  label: string;
  parent_code?: string | null;
  code?: string | null;
}) {
  return apiRequest<CatalogSegment>("/api/catalog/segments", {
    method: "POST",
    body: JSON.stringify(payload)
  });
}

export function deleteCatalogSegment(segmentId: string) {
  return apiRequest<void>(`/api/catalog/segments/${segmentId}`, { method: "DELETE" });
}

/** Clase extra del sello de código según metal: primer dígito 1 = oro, 2 = plata. */
export function metalTagClass(code: string | null | undefined): string {
  if (!code) return "";
  if (code.startsWith("1")) return " metalOro";
  if (code.startsWith("2")) return " metalPlata";
  return "";
}

/** Arma el código de producto de 11 dígitos: material(1)+categoría(2)+modelo(4)+medida(4).
 * El modelo/tipo es un valor real; solo la medida cae a 9999 cuando no hay talla. */
export function buildProductCode(material: string, category: string, model: string, measure: string): string {
  const m = (material || "0").padStart(1, "0").slice(-1);
  const c = (category || "00").padStart(2, "0").slice(-2);
  const md = (model || "0000").padStart(4, "0").slice(-4);
  const me = (measure || "9999").padStart(4, "0").slice(-4);
  return `${m}${c}${md}${me}`;
}
