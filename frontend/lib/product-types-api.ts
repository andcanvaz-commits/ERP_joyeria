import { apiRequest } from "@/lib/api";

export type ProductType = {
  id: string;
  category_code: string;
  model_code: string;
  product_code: string;
  category_label: string;
  model_label: string;
  raw_material_item_id: string;
  raw_material_name: string;
  purity: string | null;
  is_active: boolean;
};

export function listProductTypes() {
  return apiRequest<ProductType[]>("/api/product-types");
}

export function createProductType(payload: {
  category_code: string;
  model_code: string;
  raw_material_item_id: string;
}) {
  return apiRequest<ProductType>("/api/product-types", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function deleteProductType(id: string) {
  return apiRequest<void>(`/api/product-types/${id}`, { method: "DELETE" });
}
