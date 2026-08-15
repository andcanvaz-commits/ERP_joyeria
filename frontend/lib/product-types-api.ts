import { apiRequest } from "@/lib/api";

export type ProductType = {
  id: string;
  category_code: string;
  model_code: string;
  name: string | null;
  category_label: string;
  model_label: string;
  is_active: boolean;
};

export function listProductTypes() {
  return apiRequest<ProductType[]>("/api/product-types");
}

export function createProductType(payload: {
  category_code: string;
  // Opcional: sin él, el backend asigna el siguiente código libre del tipo.
  model_code?: string;
  name: string;
}) {
  return apiRequest<ProductType>("/api/product-types", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function deleteProductType(id: string) {
  return apiRequest<void>(`/api/product-types/${id}`, { method: "DELETE" });
}
