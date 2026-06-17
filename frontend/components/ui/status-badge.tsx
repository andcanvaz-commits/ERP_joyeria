const statusClassByValue: Record<string, string> = {
  PENDIENTE: "statusPending",
  EN_PROCESO: "statusProgress",
  PAUSADA: "statusPaused",
  FINALIZADA: "statusFinished",
  CANCELADA: "statusCancelled",
  BORRADOR: "statusPending"
};

const statusLabelByValue: Record<string, string> = {
  BORRADOR: "Borrador",
  PENDIENTE: "Pendiente",
  EN_PROCESO: "En proceso",
  PAUSADA: "Pausada",
  FINALIZADA: "Finalizada",
  CANCELADA: "Cancelada"
};

export function StatusBadge({ status }: { status: string }) {
  const statusClass = statusClassByValue[status] ?? "statusPending";
  const label = statusLabelByValue[status] ?? status;

  return <span className={`statusBadge ${statusClass}`}>{label}</span>;
}
