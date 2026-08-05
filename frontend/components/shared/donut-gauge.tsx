"use client";

import type { CSSProperties } from "react";

/** Dona de 2 segmentos (activo/inactivo, recibido/en curso, etc.) con
 * leyenda y tooltip en foco/hover. No es un grafico multi-categoria: es
 * un gauge de proporcion, un solo hue (var(--primary)) contra el track. */
export function DonutGauge({
  percent,
  centerLabel,
  primary,
  secondary
}: {
  percent: number;
  centerLabel: string;
  primary: { label: string; value: number };
  secondary: { label: string; value: number };
}) {
  return (
    <div className="donutWrap">
      <div
        aria-label={`${percent}% ${centerLabel}. ${primary.label}: ${primary.value}. ${secondary.label}: ${secondary.value}.`}
        className="donutChart barMarkHit"
        role="img"
        tabIndex={0}
        style={{ "--donut-value": `${percent}%` } as CSSProperties}
      >
        <strong>{percent}%</strong>
        <span>{centerLabel}</span>
        <span aria-hidden="true" className="barTooltip donutTooltip">
          <strong>{primary.label}: {primary.value}</strong> · {secondary.label}: {secondary.value}
        </span>
      </div>
      <div className="chartLegend">
        <span><i className="legendActive" />{primary.label} ({primary.value})</span>
        <span><i className="legendInactive" />{secondary.label} ({secondary.value})</span>
      </div>
    </div>
  );
}
