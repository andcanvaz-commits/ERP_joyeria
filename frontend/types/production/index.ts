export type ProductionOrderStatus =
  | "BORRADOR"
  | "PENDIENTE"
  | "EN_PROCESO"
  | "PAUSADA"
  | "FINALIZADA"
  | "CANCELADA";

export type ProductionOrderSummary = {
  id: string;
  productName: string;
  processName: string;
  quantity: string;
  status: ProductionOrderStatus;
  stages: string;
  inventoryHandoff: string;
};
