"use client";

import { Pager, usePagination } from "@/components/shared/pager";
import { buildOrdenProduccion, stageAttemptBalance } from "@/lib/orden-produccion";
import type { ProductionRun } from "@/types/production";

function num(value: string | number | null | undefined) {
  if (value === null || value === undefined || value === "") return "0";
  const number = Number(value);
  return Number.isFinite(number) ? number.toLocaleString("es-EC", { maximumFractionDigits: 4 }) : String(value);
}

// Porcentajes: 2 decimales, no los 4 de los gramos (16,6667% es ilegible).
function percentText(value: string | number | null | undefined) {
  if (value === null || value === undefined || value === "") return "0";
  const number = Number(value);
  return Number.isFinite(number) ? number.toLocaleString("es-EC", { maximumFractionDigits: 2 }) : String(value);
}

// Fila normalizada, comun a las dos formas de merma que existen en el
// sistema (Rodrigo, 2026-08-20: el reporte de merma nunca se adapto al
// flujo nuevo -- "no se quedo en el historial ni se abrio el reporte"):
// flujo viejo = ProductionRunStage (run.stages), flujo nuevo = un intento de
// etapa (run.stage_attempts). Los dos componentes de abajo arman esta forma
// y listo, sin repetir la logica de por-etapa dos veces.
type WasteRow = {
  id: string;
  order: number;
  name: string;
  phaseName?: string | null;
  pending: boolean;
  initial: number;
  hasInitial: boolean;
  final: number;
  hasFinal: boolean;
  waste: number;
  wasteKind: "merma" | "extra";
  wastePercent: number;
  decisionLabel: "Aprobada" | "Rechazada" | null;
  decisionBy: string | null;
  decisionNote: string | null;
  attemptNo: number | null;
};

function rowsFromOldStages(run: ProductionRun): WasteRow[] {
  const stages = [...run.stages].sort((a, b) => a.stage_order - b.stage_order);
  let carried = Number(run.total_required_material ?? 0);
  return stages.map((stage) => {
    const pending = stage.status === "PENDIENTE";
    const hasInitial = stage.initial_weight !== null && stage.initial_weight !== "";
    const initial = hasInitial ? Number(stage.initial_weight) : carried;
    const hasFinal = stage.final_weight !== null && stage.final_weight !== "";
    const final = hasFinal ? Number(stage.final_weight) : initial;
    if (!pending) carried = final;
    const decisions = stage.decisions ?? [];
    const decision = decisions.length > 0 ? decisions[decisions.length - 1] : null;
    return {
      id: stage.id,
      order: stage.stage_order,
      name: stage.stage_name,
      phaseName: stage.phase_name,
      pending,
      initial,
      hasInitial,
      final,
      hasFinal,
      waste: Number(stage.waste_weight ?? 0),
      wasteKind: "merma",
      wastePercent: Number(stage.waste_percent ?? 0),
      decisionLabel: decision ? (decision.decision === "APPROVED" ? "Aprobada" : "Rechazada") : null,
      decisionBy: decision?.decided_by_name ?? null,
      decisionNote: decision?.justification ?? null,
      attemptNo: decision && decision.attempt_no > 1 ? decision.attempt_no : null,
    };
  });
}

function rowsFromStageAttempts(run: ProductionRun): WasteRow[] {
  const attempts = [...(run.stage_attempts ?? [])].sort((a, b) => a.sequence_order - b.sequence_order);
  return attempts.map((attempt) => {
    const model = buildOrdenProduccion([run], attempt.id);
    const initialRow = model.entregaTotalRows[0];
    const initial = initialRow ? initialRow.quantity : 0;
    // Peso final = Total recibido real de ESTE intento (misma fila que
    // muestra el acta) -- Rodrigo, 2026-08-21: "con datos que ya no tienen
    // sentido estar aqui". attempt.peso_al_finalizar es un campo muerto del
    // flujo viejo (nunca lo escribe approve_stage_attempt del flujo actual),
    // asi que salia siempre igual al peso inicial.
    const finalRow = model.recepcionTotalRows.find((row) => row.kind === "total");
    const hasFinal = Boolean(finalRow) && attempt.status !== "EN_PROCESO";
    const final = finalRow ? finalRow.quantity : initial;
    const balance = stageAttemptBalance(run, attempt.id);
    return {
      id: attempt.id,
      order: attempt.sequence_order,
      name: attempt.process_name,
      phaseName: null,
      pending: attempt.status === "EN_PROCESO",
      initial,
      hasInitial: Boolean(initialRow),
      final,
      hasFinal,
      waste: balance ? balance.quantity : 0,
      wasteKind: balance?.kind ?? "merma",
      wastePercent: balance && initial > 0 ? (balance.quantity / initial) * 100 : 0,
      decisionLabel: attempt.status === "APROBADA" ? "Aprobada" : attempt.status === "RECHAZADA" ? "Rechazada" : null,
      decisionBy: attempt.finished_by_name ?? null,
      decisionNote: attempt.rejection_reason ?? null,
      attemptNo: null,
    };
  });
}

// Fuente unica de filas por-etapa: el flujo nuevo (root.name presente,
// mismo discriminador que usa el resto de production-dashboard.tsx) usa
// stage_attempts; el viejo usa stages.
function wasteRows(run: ProductionRun): WasteRow[] {
  return run.name ? rowsFromStageAttempts(run) : rowsFromOldStages(run);
}

// Tarjetas de merma de una orden: total, promedio por etapa con merma y etapa
// con mayor merma. Compartidas entre el resumen de producción y "Merma por
// fase" de inventario.
export function RunWasteHero({ run }: { run: ProductionRun }) {
  const unit = run.raw_material_unit_code || "g";
  const rows = wasteRows(run);
  // Solo merma real -- una etapa con extra (se recibio de mas) no es una
  // perdida, no debe sumar aca como si lo fuera.
  const stagesWithWaste = rows.filter((row) => row.wasteKind === "merma" && row.waste > 0);
  const totalWaste = stagesWithWaste.reduce((total, row) => total + row.waste, 0);
  const averageWaste = stagesWithWaste.length > 0 ? totalWaste / stagesWithWaste.length : 0;
  const worstStage = stagesWithWaste.reduce<WasteRow | null>(
    (worst, row) => (!worst || row.waste > worst.waste ? row : worst),
    null,
  );
  // waste_percent de nivel de orden solo lo calcula el flujo viejo (_finish_run)
  // -- el nuevo no inventa un porcentaje sin la base real (Rodrigo: nada de
  // datos de prueba/inventados).
  return (
    <>
      <span>
        <strong>Merma total</strong>
        {num(totalWaste)} {unit}{run.waste_percent ? ` · ${percentText(run.waste_percent)}%` : ""}
      </span>
      <span>
        <strong>Promedio por etapa</strong>
        {num(averageWaste)} {unit}
      </span>
      <span>
        <strong>Mayor merma</strong>
        {worstStage ? `${worstStage.name} (${num(worstStage.waste)} ${unit})` : "—"}
      </span>
    </>
  );
}

// Resumen por etapa de una orden: pesos, merma y decisiones. Compartido entre
// producción (fin de orden e historial) e inventario (merma por fase).
// En etapas que no pesan, el peso se hereda de la última etapa pesada anterior
// (el material sigue siendo el mismo) y se muestra atenuado.
export function RunStageSummaryTable({ run, pageSize = 5, print = false }: { run: ProductionRun; pageSize?: number; print?: boolean }) {
  const unit = run.raw_material_unit_code || "g";
  const rows = wasteRows(run);
  const pager = usePagination(rows, pageSize, run.id);
  // Impresion: todas las filas de una, sin paginar.
  const visibleRows = print ? rows : pager.pageItems;
  const muted = { color: "var(--muted)" } as const;
  // Altura de fila fija + relleno hasta completar la página: el modal no debe
  // cambiar de tamaño al pasar de página (preferencia de UI del proyecto).
  // Solo aplica si de verdad hay más de una página: con una sola página no
  // hay tamaño previo que igualar, y rellenar infla el modal sin motivo
  // (aparece scroll aunque el contenido real quepa de sobra).
  const ROW_HEIGHT = 36;
  const fillerCount = !print && pager.pageCount > 1 ? Math.max(0, pageSize - pager.pageItems.length) : 0;
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
            <th className="num" style={{ width: "18%" }}>Balance</th>
            <th style={{ width: "32%" }}>Decisión</th>
          </tr>
        </thead>
        <tbody>
          {visibleRows.map((row) => (
            <tr key={row.id} style={{ height: ROW_HEIGHT }}>
              <td style={oneLine} title={row.phaseName ? `${row.name} · ${row.phaseName}` : row.name}>
                {row.order}. {row.name}
              </td>
              <td className="num" style={row.hasInitial ? oneLine : { ...oneLine, ...muted }}>{row.pending ? "—" : `${num(row.initial)} ${unit}`}</td>
              <td className="num" style={row.hasFinal ? oneLine : { ...oneLine, ...muted }}>{row.pending ? "—" : `${num(row.final)} ${unit}`}</td>
              <td className="num" style={oneLine}>
                {row.pending ? (
                  "—"
                ) : row.waste === 0 ? (
                  `0 ${unit} · ${percentText(row.wastePercent)}%`
                ) : (
                  <span style={row.wasteKind === "extra" ? { color: "#1e8449" } : { color: "var(--danger)" }}>
                    {row.wasteKind === "extra" ? "+" : "-"}{num(row.waste)} {unit} · {percentText(row.wastePercent)}%
                  </span>
                )}
              </td>
              <td style={oneLine}>
                {row.decisionLabel ? (
                  <span title={`${row.decisionLabel}${row.decisionBy ? ` · ${row.decisionBy}` : ""}${row.decisionNote ? ` — ${row.decisionNote}` : ""}`}>
                    {row.decisionLabel}
                    {row.attemptNo ? ` (intento ${row.attemptNo})` : ""}
                    {row.decisionBy ? ` · ${row.decisionBy}` : ""}
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
      {print ? null : <Pager {...pager} />}
    </div>
  );
}
