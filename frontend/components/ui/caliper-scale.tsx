type CaliperScaleProps = {
  value: number;
  max: number;
  ticks?: number;
  limit?: number | null;
  limitMode?: "ceiling" | "floor";
  label?: string;
  ariaLabel?: string;
};

export function CaliperScale({
  value,
  max,
  ticks = 10,
  limit = null,
  limitMode = "ceiling",
  label,
  ariaLabel,
}: CaliperScaleProps) {
  const safeMax = max > 0 ? max : 1;
  const pct = Math.max(0, Math.min(100, (value / safeMax) * 100));
  const limitPct =
    limit != null ? Math.max(0, Math.min(100, (limit / safeMax) * 100)) : null;
  const over =
    limit != null &&
    (limitMode === "ceiling" ? value > limit : value < limit);

  return (
    <div
      className={`caliper ${over ? "caliperOver" : ""}`}
      role="img"
      aria-label={ariaLabel ?? `${value} de ${max}`}
    >
      <div className="caliperTrack">
        {Array.from({ length: ticks + 1 }).map((_, i) => (
          <span key={i} className="caliperTick" style={{ left: `${(i / ticks) * 100}%` }} />
        ))}
        <span className="caliperFill" style={{ width: `${pct}%` }} />
        {limitPct != null ? (
          <span className="caliperLimit" style={{ left: `${limitPct}%` }} aria-hidden="true" />
        ) : null}
        <span className="caliperMarker" style={{ left: `${pct}%` }} aria-hidden="true" />
      </div>
      {label ? <span className="caliperLabel num">{label}</span> : null}
    </div>
  );
}
