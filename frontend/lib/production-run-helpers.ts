import type { ProductionRun, ProductionRunStage } from "@/types/production";

/** Peso actual de la orden: el ultimo peso registrado (inicial o final) entre
 * sus etapas, o el peso esperado si ninguna etapa peso todavia. Ordenes del
 * flujo nuevo (sin `stages` viejas) no tienen un peso unico de orden -- cada
 * intento de etapa lleva el suyo propio, ver `stage_attempts`. */
export function runCurrentWeight(run: ProductionRun): string | null {
  const stages = [...run.stages].sort((left, right) => left.stage_order - right.stage_order);
  let weight: string | null = null;
  for (const stage of stages) {
    if (stage.initial_weight) weight = stage.initial_weight;
    if (stage.final_weight) weight = stage.final_weight;
  }
  return weight ?? run.total_required_material ?? null;
}

/** Merma acumulada: suma de la merma registrada etapa por etapa. */
export function runCurrentWaste(run: ProductionRun): number {
  return run.stages.reduce((total, stage) => total + Number(stage.waste_weight ?? "0"), 0);
}

/** Etapa en curso de la orden (o la siguiente pendiente si ninguna esta activa). */
export function runCurrentStage(run: ProductionRun): ProductionRunStage | null {
  return (
    run.stages.find((stage) => stage.status === "EN_PROCESO") ??
    run.stages.find((stage) => stage.status === "PENDIENTE") ??
    null
  );
}
