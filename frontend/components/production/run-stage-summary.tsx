"use client";

import { Pager, usePagination } from "@/components/shared/pager";
import type { ProductionRun } from "@/types/production";

function num(value: string | number | null | undefined) {
  if (value === null || value === undefined || value === "") return "0";
  const number = Number(value);
  return Number.isFinite(number) ? number.toLocaleString("es-EC", { maximumFractionDigits: 4 }) : String(value);
}

// Resumen por etapa de una orden: pesos, merma y decisiones. Compartido entre
// producción (fin de orden e historial) e inventario (merma por fase).
// En etapas que no pesan, el peso se hereda de la última etapa pesada anterior
// (el material sigue siendo el mismo) y se muestra atenuado.
export function RunStageSummaryTable({ run, pageSize = 5 }: { run: ProductionRun; pageSize?: number }) {
  const stages = [...run.stages].sort((a, b) => a.stage_order - b.stage_order);
  const unit = run.raw_material_unit_code || "g";
  let carried = Number(run.total_required_material ?? 0);
  const rows = stages.map((stage) => {
    const pending = stage.status === "PENDIENTE";
    const hasInitial = stage.initial_weight !== null && stage.initial_weight !== "";
    const initial = hasInitial ? Number(stage.initial_weight) : carried;
    const hasFinal = stage.final_weight !== null && stage.final_weight !== "";
    const final = hasFinal ? Number(stage.final_weight) : initial;
    if (!pending) carried = final;
    const decisions = stage.decisions ?? [];
    const decision = decisions.length > 0 ? decisions[decisions.length - 1] : null;
    return { stage, pending, initial, hasInitial, final, hasFinal, decision };
  });
  const pager = usePagination(rows, pageSize, run.id);
  const muted = { color: "var(--muted)" } as const;
  return (
    <div className="tableWrap pagedListFloor" style={{ minHeight: 200 }}>
      <table className="table tableAuto">
        <thead>
          <tr>
            <th>Etapa</th>
            <th className="num">Peso inicial</th>
            <th className="num">Peso final</th>
            <th className="num">Merma</th>
            <th className="num">%</th>
            <th>Decisión</th>
          </tr>
        </thead>
        <tbody>
          {pager.pageItems.map(({ stage, pending, initial, hasInitial, final, hasFinal, decision }) => (
            <tr key={stage.id}>
              <td>
                {stage.stage_order}. {stage.stage_name}
                {stage.phase_name ? <><br /><small style={muted}>{stage.phase_name}</small></> : null}
              </td>
              <td className="num" style={hasInitial ? undefined : muted}>{pending ? "—" : `${num(initial)} ${unit}`}</td>
              <td className="num" style={hasFinal ? undefined : muted}>{pending ? "—" : `${num(final)} ${unit}`}</td>
              <td className="num">{pending ? "—" : `${num(stage.waste_weight ?? 0)} ${unit}`}</td>
              <td className="num">{pending ? "—" : `${num(stage.waste_percent ?? 0)}%`}</td>
              <td>
                {decision ? (
                  <span title={decision.justification ?? undefined}>
                    {decision.decision === "APPROVED" ? "Aprobada" : "Rechazada"}
                    {decision.attempt_no > 1 ? ` (intento ${decision.attempt_no})` : ""}
                    {decision.decided_by_name ? ` · ${decision.decided_by_name}` : ""}
                  </span>
                ) : (
                  "—"
                )}
              </td>
            </tr>
          ))}
          {rows.length === 0 ? (
            <tr><td colSpan={6}><div className="emptyState">Esta orden no tiene etapas registradas.</div></td></tr>
          ) : null}
        </tbody>
      </table>
      <Pager {...pager} />
    </div>
  );
}
