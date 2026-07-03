type PunchTone = "neutral" | "active" | "done" | "danger" | "warning";

export function StatusPunch({ label, tone = "neutral" }: { label: string; tone?: PunchTone }) {
  return <span className={`punch punch-${tone}`}>{label}</span>;
}
