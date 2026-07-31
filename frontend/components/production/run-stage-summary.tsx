"use client";

import { Pager, usePagination } from "@/components/shared/pager";
import type { ProductionRun } from "@/types/production";

function num(value: string | number | null | undefined) {
  if (value === null || value === undefined || value === "") return "0";
  const number = Number(value);
  return Number.isFinite(number) ? number.toLocaleString("es-EC", { maximumFractionDigits: 4 }) : String(value);
}

// Tarjetas de merma de una orden: total, promedio por etapa con merma y etapa
// con mayor merma. Compartidas entre el resumen de producción y "Merma por
// fase" de inventario.
export function RunWasteHero({ run }: { run: ProductionRun }) {
  const unit = run.raw_material_unit_code || "g";
  const stagesWithWaste = run.stages.filter((stage) => Number(stage.waste_weight ?? "0") > 0);
  const totalWaste = stagesWithWaste.reduce((total, stage) => total + Number(stage.waste_weight ?? "0"), 0);
  const averageWaste = stagesWithWaste.length > 0 ? totalWaste / stagesWithWaste.length : 0;
  const worstStage = stagesWithWaste.reduce<ProductionRun["stages"][number] | null>(
    (worst, stage) => (!worst || Number(stage.waste_weight ?? "0") > Number(worst.waste_weight ?? "0") ? stage : worst),
    null,
  );
  // Devuelve solo filas: el llamador las mete en su propio .userPreviewGrid
  // para que todo el resumen comparta espaciado y líneas separadoras.
  return (
    <>
      <span>
        <strong>Merma total</strong>
        {num(totalWaste)} {unit}{run.waste_percent ? ` · ${num(run.waste_percent)}%` : ""}
      </span>
      <span>
        <strong>Promedio por etapa</strong>
        {num(averageWaste)} {unit}
      </span>
      <span>
        <strong>Mayor merma</strong>
        {worstStage ? `${worstStage.stage_name} (${num(worstStage.waste_weight ?? "0")} ${unit})` : "—"}
      </span>
    </>
  );
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
  // Altura de fila fija + relleno hasta completar la página: el modal no debe
  // cambiar de tamaño al pasar de página (preferencia de UI del proyecto).
  // Solo aplica si de verdad hay más de una página: con una sola página no
  // hay tamaño previo que igualar, y rellenar infla el modal sin motivo
  // (aparece scroll aunque el contenido real quepa de sobra).
  const ROW_HEIGHT = 36;
  const fillerCount = pager.pageCount > 1 ? Math.max(0, pageSize - pager.pageItems.length) : 0;
  const oneLine = {
    whiteSpace: "nowrap",
    overflow: "hidden",
    textOverflow: "ellipsis",
  } as const;
  return (
    <div className="tableWrap pagedListFloor">
      {/* Layout fijo: los anchos no se recalculan por página (la ventana no
          debe cambiar de tamaño al paginar). */}
      <table className="table tableAuto" style={{ tableLayout: "fixed", width: "100%", minWidth: 560 }}>
        <thead>
          <tr>
            <th style={{ width: "24%" }}>Etapa</th>
            <th className="num" style={{ width: "13%" }}>Peso inicial</th>
            <th className="num" style={{ width: "13%" }}>Peso final</th>
            <th className="num" style={{ width: "18%" }}>Merma</th>
            <th style={{ width: "32%" }}>Decisión</th>
          </tr>
        </thead>
        <tbody>
          {pager.pageItems.map(({ stage, pending, initial, hasInitial, final, hasFinal, decision }) => (
            <tr key={stage.id} style={{ height: ROW_HEIGHT }}>
              <td style={oneLine} title={stage.phase_name ? `${stage.stage_name} · ${stage.phase_name}` : stage.stage_name}>
                {stage.stage_order}. {stage.stage_name}
              </td>
              <td className="num" style={hasInitial ? oneLine : { ...oneLine, ...muted }}>{pending ? "—" : `${num(initial)} ${unit}`}</td>
              <td className="num" style={hasFinal ? oneLine : { ...oneLine, ...muted }}>{pending ? "—" : `${num(final)} ${unit}`}</td>
              <td className="num" style={oneLine}>{pending ? "—" : `${num(stage.waste_weight ?? 0)} ${unit} · ${num(stage.waste_percent ?? 0)}%`}</td>
              <td style={oneLine}>
                {decision ? (
                  <span title={`${decision.decision === "APPROVED" ? "Aprobada" : "Rechazada"}${decision.decided_by_name ? ` · ${decision.decided_by_name}` : ""}${decision.justification ? ` — ${decision.justification}` : ""}`}>
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
          {Array.from({ length: fillerCount }).map((_, index) => (
            <tr aria-hidden="true" key={`filler-${index}`} style={{ height: ROW_HEIGHT }}>
              <td colSpan={5} style={{ border: "none" }}>&nbsp;</td>
            </tr>
          ))}
          {rows.length === 0 ? (
            <tr><td colSpan={5}><div className="emptyState">Esta orden no tiene etapas registradas.</div></td></tr>
          ) : null}
        </tbody>
      </table>
      <Pager {...pager} />
    </div>
  );
}
