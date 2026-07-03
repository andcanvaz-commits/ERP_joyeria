import { StatusPunch } from "./status-punch";

const toneByValue: Record<string, "neutral" | "active" | "done" | "danger" | "warning"> = {
  BORRADOR: "neutral",
  PENDIENTE: "neutral",
  EN_PROCESO: "active",
  PAUSADA: "warning",
  FINALIZADA: "done",
  CANCELADA: "danger",
};

const statusLabelByValue: Record<string, string> = {
  BORRADOR: "Borrador",
  PENDIENTE: "Pendiente",
  EN_PROCESO: "En proceso",
  PAUSADA: "Pausada",
  FINALIZADA: "Finalizada",
  CANCELADA: "Cancelada",
};

export function StatusBadge({ status }: { status: string }) {
  const tone = toneByValue[status] ?? "neutral";
  const label = statusLabelByValue[status] ?? status;
  return <StatusPunch label={label} tone={tone} />;
}
