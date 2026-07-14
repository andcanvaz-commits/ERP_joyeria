import { apiRequest } from "@/lib/api";

export type ProductType = {
  id: string;
  category_code: string;
  model_code: string;
  name: string | null;
  price: string | null;
  category_label: string;
  model_label: string;
  is_active: boolean;
};

export function listProductTypes() {
  return apiRequest<ProductType[]>("/api/product-types");
}

export function createProductType(payload: {
  category_code: string;
  model_code: string;
  name: string;
  price?: string | null;
}) {
  return apiRequest<ProductType>("/api/product-types", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function deleteProductType(id: string) {
  return apiRequest<void>(`/api/product-types/${id}`, { method: "DELETE" });
}
