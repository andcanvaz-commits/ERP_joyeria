"use client";

import { useEffect, useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { listProductionRuns } from "@/lib/production-api";
import type { ProductionRun } from "@/types/production";

function num(value: string | null | undefined): number {
  if (!value) return 0;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function fmt(value: number, decimals = 2): string {
  return value.toLocaleString("es-EC", { minimumFractionDigits: 0, maximumFractionDigits: decimals });
}

function monthKey(iso: string): string {
  return iso.slice(0, 7);
}

function monthLabel(key: string): string {
  if (!key) return "";
  const date = new Date(`${key}-01T00:00:00`);
  if (Number.isNaN(date.getTime())) return key;
  const label = date.toLocaleDateString("es-EC", { month: "long", year: "numeric" });
  return label.charAt(0).toUpperCase() + label.slice(1);
}

type ProcessAgg = { name: string; orders: number; units: number; waste: number; wastePctSum: number; wastePctCount: number };

type Aggregate = {
  orders: number;
  units: number;
  waste: number;
  avgWaste: number;
  unit: string;
  processes: ProcessAgg[];
  stageRework: { name: string; value: number }[];
  stageWaste: { name: string; waste: number; avgPct: number }[];
};

function aggregate(runs: ProductionRun[]): Aggregate {
  const orders = runs.length;
  const units = runs.reduce((acc, run) => acc + num(run.quantity), 0);
  const waste = runs.reduce((acc, run) => acc + num(run.waste_weight), 0);
  const pcts = runs.map((run) => num(run.waste_percent)).filter((value) => value > 0);
  const avgWaste = pcts.length ? pcts.reduce((a, b) => a + b, 0) / pcts.length : 0;
  const unit = runs.find((run) => run.raw_material_unit_code)?.raw_material_unit_code ?? "";

  const byProcess = new Map<string, ProcessAgg>();
  for (const run of runs) {
    const entry = byProcess.get(run.process_name) ?? {
      name: run.process_name,
      orders: 0,
      units: 0,
      waste: 0,
      wastePctSum: 0,
      wastePctCount: 0
    };
    entry.orders += 1;
    entry.units += num(run.quantity);
    entry.waste += num(run.waste_weight);
    const pct = num(run.waste_percent);
    if (pct > 0) {
      entry.wastePctSum += pct;
      entry.wastePctCount += 1;
    }
    byProcess.set(run.process_name, entry);
  }

  const byStage = new Map<string, number>();
  const byStageWaste = new Map<string, { waste: number; pctSum: number; pctCount: number }>();
  for (const run of runs) {
    for (const stage of run.stages) {
      const rejected = (stage.decisions ?? []).filter((d) => d.decision === "REJECTED").length;
      if (rejected > 0) byStage.set(stage.stage_name, (byStage.get(stage.stage_name) ?? 0) + rejected);

      const stageWasteWeight = num(stage.waste_weight);
      const stageWastePct = num(stage.waste_percent);
      if (stageWasteWeight > 0 || stageWastePct > 0) {
        const entry = byStageWaste.get(stage.stage_name) ?? { waste: 0, pctSum: 0, pctCount: 0 };
        entry.waste += stageWasteWeight;
        if (stageWastePct > 0) {
          entry.pctSum += stageWastePct;
          entry.pctCount += 1;
        }
        byStageWaste.set(stage.stage_name, entry);
      }
    }
  }

  return {
    orders,
    units,
    waste,
    avgWaste,
    unit,
    processes: [...byProcess.values()],
    stageRework: [...byStage.entries()].map(([name, value]) => ({ name, value })).sort((a, b) => b.value - a.value),
    stageWaste: [...byStageWaste.entries()]
      .map(([name, entry]) => ({
        name,
        waste: entry.waste,
        avgPct: entry.pctCount ? entry.pctSum / entry.pctCount : 0
      }))
      .sort((a, b) => b.waste - a.waste)
  };
}

function Delta({ current, previous, suffix = "" }: { current: number; previous: number | null; suffix?: string }) {
  if (previous === null) return null;
  const diff = current - previous;
  if (Math.abs(diff) < 0.005) return <span className="reportDelta reportDeltaFlat">Sin cambio</span>;
  const up = diff > 0;
  return (
    <span className={`reportDelta ${up ? "reportDeltaUp" : "reportDeltaDown"}`}>
      {up ? "▲" : "▼"} {fmt(Math.abs(diff))}{suffix} vs mes anterior
    </span>
  );
}

export function ReportesDashboard() {
  const { data: runs = [], isLoading } = useQuery({
    queryKey: ["reportes"],
    queryFn: listProductionRuns,
  });
  const [selectedMonth, setSelectedMonth] = useState("");

  const finished = useMemo(() => runs.filter((run) => run.finished_at), [runs]);
  const months = useMemo(
    () => Array.from(new Set(finished.map((run) => monthKey(run.finished_at as string)))).sort().reverse(),
    [finished]
  );

  useEffect(() => {
    if (!selectedMonth && months.length > 0) setSelectedMonth(months[0]);
  }, [months, selectedMonth]);

  const current = useMemo(
    () => aggregate(finished.filter((run) => monthKey(run.finished_at as string) === selectedMonth)),
    [finished, selectedMonth]
  );

  const previous = useMemo(() => {
    const index = months.indexOf(selectedMonth);
    const prevKey = index >= 0 && index + 1 < months.length ? months[index + 1] : null;
    if (!prevKey) return null;
    return aggregate(finished.filter((run) => monthKey(run.finished_at as string) === prevKey));
  }, [finished, months, selectedMonth]);

  const topProcess = [...current.processes].sort((a, b) => b.orders - a.orders)[0] ?? null;
  const topWaste = [...current.processes].filter((p) => p.waste > 0).sort((a, b) => b.waste - a.waste)[0] ?? null;
  const topStage = current.stageRework[0] ?? null;
  const processByUnits = [...current.processes].sort((a, b) => b.units - a.units);
  const wasteByProcess = [...current.processes].filter((p) => p.waste > 0).sort((a, b) => b.waste - a.waste);
  const wasteByStage = current.stageWaste;

  return (
    <div className="content">
      {isLoading ? (
        <section className="card panelBody"><div className="emptyState">Cargando reportes...</div></section>
      ) : finished.length === 0 ? null : (
        <>
          {/* Resumen ejecutivo */}
          <section className="card reportSummary">
            <div className="reportSummaryHead">
              <span className="reportEyebrow">Resumen del periodo</span>
              <strong>{monthLabel(selectedMonth)}</strong>
            </div>
            <div className="reportFigures">
              <div className="reportFigure">
                <span>Órdenes finalizadas</span>
                <strong>{current.orders}</strong>
                <Delta current={current.orders} previous={previous ? previous.orders : null} />
              </div>
              <div className="reportFigure">
                <span>Unidades producidas</span>
                <strong>{fmt(current.units)}</strong>
                <Delta current={current.units} previous={previous ? previous.units : null} />
              </div>
              <div className="reportFigure">
                <span>Merma total</span>
                <strong>{fmt(current.waste)}{current.unit ? ` ${current.unit}` : ""}</strong>
                <Delta current={current.waste} previous={previous ? previous.waste : null} suffix={current.unit ? ` ${current.unit}` : ""} />
              </div>
              <div className="reportFigure">
                <span>Merma promedio</span>
                <strong>{fmt(current.avgWaste)}%</strong>
                <Delta current={current.avgWaste} previous={previous ? previous.avgWaste : null} suffix="%" />
              </div>
            </div>
          </section>

          {/* Hallazgos clave */}
          <section className="insightGrid">
            <article className="insightTile insightProduct">
              <span className="reportEyebrow">Producto estrella</span>
              <strong>{topProcess ? topProcess.name : "—"}</strong>
              <span className="insightDetail">
                {topProcess ? `${topProcess.orders} órdenes · ${fmt(topProcess.units)} unidades` : "Sin datos este mes"}
              </span>
            </article>
            <article className="insightTile insightWaste">
              <span className="reportEyebrow">Mayor pérdida de material</span>
              <strong>{topWaste ? topWaste.name : "—"}</strong>
              <span className="insightDetail">
                {topWaste ? `${fmt(topWaste.waste)}${current.unit ? ` ${current.unit}` : ""} de merma` : "Sin merma registrada"}
              </span>
            </article>
            <article className="insightTile insightStage">
              <span className="reportEyebrow">Etapa crítica</span>
              <strong>{topStage ? topStage.name : "—"}</strong>
              <span className="insightDetail">
                {topStage ? `${topStage.value} reprocesos en el mes` : "Sin reprocesos este mes"}
              </span>
            </article>
          </section>

          {/* Producción por proceso */}
          <section className="card reportSection">
            <div className="panelHeader">
              <div>
                <h2 className="panelTitle">Producción por proceso</h2>
                <p className="panelText">Qué se fabricó más — base para decisiones de ventas.</p>
              </div>
            </div>
            <div className="tableWrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Proceso</th>
                    <th>Órdenes</th>
                    <th>Unidades</th>
                    <th>% de órdenes</th>
                    <th>Merma</th>
                  </tr>
                </thead>
                <tbody>
                  {processByUnits.length === 0 ? (
                    <tr><td colSpan={5}>Sin datos este mes.</td></tr>
                  ) : (
                    processByUnits.map((proc) => (
                      <tr key={proc.name}>
                        <td>{proc.name}</td>
                        <td className="num">{proc.orders}</td>
                        <td className="num">{fmt(proc.units)}</td>
                        <td className="num">{current.orders ? fmt((proc.orders / current.orders) * 100) : "0"}%</td>
                        <td className="num">{fmt(proc.waste)}{current.unit ? ` ${current.unit}` : ""}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>

          {/* Merma por proceso */}
          <section className="card reportSection">
            <div className="panelHeader">
              <div>
                <h2 className="panelTitle">Merma por proceso</h2>
                <p className="panelText">Dónde se pierde más material — base para decisiones de producción.</p>
              </div>
            </div>
            <div className="tableWrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Proceso</th>
                    <th>Merma (peso)</th>
                    <th>Merma promedio %</th>
                  </tr>
                </thead>
                <tbody>
                  {wasteByProcess.length === 0 ? (
                    <tr><td colSpan={3}>Sin merma registrada este mes.</td></tr>
                  ) : (
                    wasteByProcess.map((proc) => (
                      <tr key={proc.name}>
                        <td>{proc.name}</td>
                        <td className="num">{fmt(proc.waste)}{current.unit ? ` ${current.unit}` : ""}</td>
                        <td className="num">{proc.wastePctCount ? fmt(proc.wastePctSum / proc.wastePctCount) : "0"}%</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>

          {/* Merma por etapa */}
          <section className="card reportSection">
            <div className="panelHeader">
              <div>
                <h2 className="panelTitle">Merma por etapa</h2>
                <p className="panelText">En qué fase se pierde más material — suma de la merma registrada en cada etapa.</p>
              </div>
            </div>
            <div className="tableWrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Etapa</th>
                    <th>Merma (peso)</th>
                    <th>Merma promedio %</th>
                  </tr>
                </thead>
                <tbody>
                  {wasteByStage.length === 0 ? (
                    <tr><td colSpan={3}>Sin merma registrada por etapa este mes.</td></tr>
                  ) : (
                    wasteByStage.map((stage) => (
                      <tr key={stage.name}>
                        <td>{stage.name}</td>
                        <td className="num">{fmt(stage.waste)}{current.unit ? ` ${current.unit}` : ""}</td>
                        <td className="num">{fmt(stage.avgPct)}%</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>

          {/* Reprocesos por etapa */}
          <section className="card reportSection">
            <div className="panelHeader">
              <div>
                <h2 className="panelTitle">Reprocesos por etapa</h2>
                <p className="panelText">Etapas rechazadas con más frecuencia — calidad y cuellos de botella.</p>
              </div>
            </div>
            <div className="tableWrap">
              <table className="table">
                <thead>
                  <tr>
                    <th>Etapa</th>
                    <th>Rechazos</th>
                  </tr>
                </thead>
                <tbody>
                  {current.stageRework.length === 0 ? (
                    <tr><td colSpan={2}>Sin reprocesos este mes.</td></tr>
                  ) : (
                    current.stageRework.map((stage) => (
                      <tr key={stage.name}>
                        <td>{stage.name}</td>
                        <td className="num">{stage.value}</td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          </section>
        </>
      )}
    </div>
  );
}
