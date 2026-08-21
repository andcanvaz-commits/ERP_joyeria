import type { ProductionRun } from "@/types/production";
import { buildOrdenProduccion, stageAttemptBalance } from "./orden-produccion";

/** Ultimo intento aprobado (por orden), o null si ninguno. */
function lastApprovedAttempt(attempts: NonNullable<ProductionRun["stage_attempts"]>) {
  return [...attempts].reverse().find((a) => a.status === "APROBADA") ?? null;
}

/** Peso actual de la orden: el ultimo peso registrado (inicial o final) entre
 * sus etapas, o el peso esperado si ninguna etapa peso todavia (flujo viejo).
 * Flujo nuevo (run.name presente, mismo discriminador que usa
 * run-stage-summary.tsx): mientras hay un intento EN_PROCESO es lo entregado
 * a esa etapa (lo que se sabe hasta ahora); si no, lo recibido real del
 * ultimo intento aprobado -- Rodrigo, 2026-08-21: "con datos que ya no
 * tienen sentido estar aqui", esto daba null/"—" siempre para ordenes
 * nuevas porque run.stages/total_required_material son del flujo viejo. */
export function runCurrentWeight(run: ProductionRun): string | null {
  if (run.name) {
    const attempts = [...(run.stage_attempts ?? [])].sort((a, b) => a.sequence_order - b.sequence_order);
    const active = attempts.find((a) => a.status === "EN_PROCESO");
    const target = active ?? lastApprovedAttempt(attempts);
    if (!target) return null;
    const model = buildOrdenProduccion([run], target.id);
    const row = active
      ? model.entregaTotalRows.find((r) => r.kind === "total")
      : model.recepcionTotalRows.find((r) => r.kind === "total");
    return row ? String(row.quantity) : null;
  }
  const stages = [...run.stages].sort((left, right) => left.stage_order - right.stage_order);
  let weight: string | null = null;
  for (const stage of stages) {
    if (stage.initial_weight) weight = stage.initial_weight;
    if (stage.final_weight) weight = stage.final_weight;
  }
  return weight ?? run.total_required_material ?? null;
}

/** Balance acumulado de la orden: merma real neta, o extra si en conjunto se
 * recibio mas de lo entregado (Rodrigo, 2026-08-21: "en los que haya extra
 * debe salir tambien") -- suma el balance de cada intento APROBADO
 * (stageAttemptBalance, misma fuente que el acta y "Reporte de etapas"),
 * restando cuando ese intento fue extra en vez de sumarlo como si fuera
 * perdida. Flujo viejo: solo merma, run.stages.waste_weight siempre suma. */
export function runCurrentBalance(run: ProductionRun): { quantity: number; kind: "merma" | "extra" } {
  if (run.name) {
    let net = 0;
    for (const attempt of run.stage_attempts ?? []) {
      if (attempt.status !== "APROBADA") continue;
      const balance = stageAttemptBalance(run, attempt.id);
      if (!balance) continue;
      net += balance.kind === "extra" ? -balance.quantity : balance.quantity;
    }
    return net >= 0 ? { quantity: net, kind: "merma" } : { quantity: -net, kind: "extra" };
  }
  const total = run.stages.reduce((sum, stage) => sum + Number(stage.waste_weight ?? "0"), 0);
  return { quantity: total, kind: "merma" };
}

export type RunCurrentStageInfo = { name: string; order: number; total: number };

/** Etapa en curso de la orden -- flujo nuevo: el intento EN_PROCESO (no hay
 * equivalente a "PENDIENTE" ahi, un intento nace ya EN_PROCESO al iniciarlo);
 * sin ninguno activo no hay "etapa actual" que resaltar (o no empezo, o ya
 * terminaron todas). Flujo viejo: igual que siempre. */
export function runCurrentStage(run: ProductionRun): RunCurrentStageInfo | null {
  if (run.name) {
    const attempts = [...(run.stage_attempts ?? [])].sort((a, b) => a.sequence_order - b.sequence_order);
    const active = attempts.find((a) => a.status === "EN_PROCESO");
    return active ? { name: active.process_name, order: active.sequence_order, total: attempts.length } : null;
  }
  const stage =
    run.stages.find((s) => s.status === "EN_PROCESO") ?? run.stages.find((s) => s.status === "PENDIENTE") ?? null;
  return stage ? { name: stage.stage_name, order: stage.stage_order, total: run.stages.length } : null;
}
