"use client";

import { useEffect, useState } from "react";
import { Info } from "lucide-react";

export type DonutSegment = {
  id: string;
  label: string;
  value: number;
  // Cuando la categoria mezcla unidades de medida distintas (ej. insumos
  // en g/ml/und), sumarlas todas como si fueran una sola unidad miente.
  // Si viene, la leyenda muestra un icono de info con este desglose real
  // en vez del valor+unidad formateado.
  breakdown?: { label: string; value: number; unit: string }[];
};

// Paleta categorica dentro de la familia oro/grafito ya establecida (nunca
// colores geenericos de la skill de dataviz): alterna tonos de oro y plata
// para maximizar contraste entre segmentos adyacentes.
const SEGMENT_COLORS = ["#A67C34", "#64707D", "#D8AD5E", "#47525E", "#7A5A22", "#8F97A3"];
const OTHER_COLOR = "#B8B2A4";
const MAX_SEGMENTS = 6;

// Mas de MAX_SEGMENTS categorias colapsan en "Otros" -- evita anillos
// ilegibles con muchas porciones finas y mantiene la leyenda siempre
// completa (nunca truncada), a diferencia del grafico de columnas anterior.
function buildSegments(items: DonutSegment[]): DonutSegment[] {
  const sorted = [...items].filter((item) => item.value > 0).sort((a, b) => b.value - a.value);
  if (sorted.length <= MAX_SEGMENTS) return sorted;
  const head = sorted.slice(0, MAX_SEGMENTS - 1);
  const restTotal = sorted.slice(MAX_SEGMENTS - 1).reduce((sum, item) => sum + item.value, 0);
  return [...head, { id: "__other__", label: "Otros", value: restTotal }];
}

// Maximo 2 decimales -- sin esto, valores derivados de multiplicaciones
// (ej. stock * peso_por_unidad) salen con ruido de punto flotante
// (42026.299999999996 en vez de 42.026,30).
function formatValue(value: number): string {
  return value.toLocaleString("es-EC", { maximumFractionDigits: 2 });
}

/** Anillo multi-categoria con leyenda siempre visible (nombre completo,
 * valor y porcentaje) -- reemplaza el grafico de columnas, cuyas etiquetas
 * se truncaban a unos pocos caracteres. Barre desde 0 al montar; el hover
 * o foco en un segmento o fila de leyenda resalta el otro (misma data en
 * ambos, no hace falta tooltip flotante). */
export function CategoryDonut({
  items,
  emptyMessage,
  isLoading = false,
  centerLabel = "total",
  unit = "",
}: {
  items: DonutSegment[];
  emptyMessage: string;
  isLoading?: boolean;
  centerLabel?: string;
  // Sufijo agregado a cada valor de la leyenda (ej. "g"). El total del
  // centro no lo lleva -- ya tiene su propio centerLabel como unidad.
  unit?: string;
}) {
  const segments = buildSegments(items);
  const total = segments.reduce((sum, item) => sum + item.value, 0);
  const [animated, setAnimated] = useState(false);
  const [hoveredId, setHoveredId] = useState<string | null>(null);

  useEffect(() => {
    setAnimated(false);
    const id = requestAnimationFrame(() => setAnimated(true));
    return () => cancelAnimationFrame(id);
  }, [items.length, total]);

  if (items.length === 0 || total === 0) {
    return isLoading ? null : <div className="emptyState">{emptyMessage}</div>;
  }

  const size = 168;
  const stroke = 22;
  const radius = (size - stroke) / 2;
  const circumference = 2 * Math.PI * radius;
  let cumulative = 0;

  // El numero central encoge segun sus digitos -- sin esto, un total
  // grande (ej. "42.026,3" en gramos) se salia del circulo interno del
  // anillo, que un conteo chico ("12") nunca necesito.
  const totalText = formatValue(total);
  const totalFontSize = Math.max(14, Math.min(30, 190 / totalText.length));

  return (
    <div className="categoryDonut">
      <svg className="categoryDonutRing" height={size} viewBox={`0 0 ${size} ${size}`} width={size}>
        <circle cx={size / 2} cy={size / 2} fill="none" r={radius} stroke="var(--border)" strokeWidth={stroke} />
        {segments.map((segment, index) => {
          const length = (segment.value / total) * circumference;
          const gap = segments.length > 1 ? 2 : 0;
          const dash = Math.max(0, length - gap);
          const offset = -cumulative;
          cumulative += length;
          const color = segment.id === "__other__" ? OTHER_COLOR : SEGMENT_COLORS[index % SEGMENT_COLORS.length];
          const isDimmed = hoveredId !== null && hoveredId !== segment.id;
          return (
            <circle
              className="categoryDonutSegment"
              cx={size / 2}
              cy={size / 2}
              fill="none"
              key={segment.id}
              onBlur={() => setHoveredId(null)}
              onFocus={() => setHoveredId(segment.id)}
              onMouseEnter={() => setHoveredId(segment.id)}
              onMouseLeave={() => setHoveredId(null)}
              r={radius}
              stroke={color}
              strokeDasharray={animated ? `${dash} ${circumference - dash}` : `0 ${circumference}`}
              strokeDashoffset={offset}
              strokeWidth={isDimmed ? stroke - 4 : stroke}
              style={{ opacity: isDimmed ? 0.45 : 1, transitionDelay: `${index * 60}ms` }}
              tabIndex={0}
              transform={`rotate(-90 ${size / 2} ${size / 2})`}
            >
              <title>{`${segment.label}: ${formatValue(segment.value)}${unit ? ` ${unit}` : ""}`}</title>
            </circle>
          );
        })}
        <text className="categoryDonutTotal" style={{ fontSize: totalFontSize }} textAnchor="middle" x={size / 2} y={size / 2 - 3}>
          {totalText}
        </text>
        <text className="categoryDonutCenterLabel" textAnchor="middle" x={size / 2} y={size / 2 + 14}>
          {centerLabel}
        </text>
      </svg>
      <ul className="categoryDonutLegend">
        {segments.map((segment, index) => {
          const color = segment.id === "__other__" ? OTHER_COLOR : SEGMENT_COLORS[index % SEGMENT_COLORS.length];
          const percent = total > 0 ? Math.round((segment.value / total) * 100) : 0;
          return (
            <li
              className={`categoryDonutLegendRow ${hoveredId === segment.id ? "categoryDonutLegendRowActive" : ""}`}
              key={segment.id}
              onBlur={() => setHoveredId(null)}
              onFocus={() => setHoveredId(segment.id)}
              onMouseEnter={() => setHoveredId(segment.id)}
              onMouseLeave={() => setHoveredId(null)}
              tabIndex={0}
            >
              <span aria-hidden="true" className="categoryDonutSwatch" style={{ background: color }} />
              <span className="categoryDonutLegendLabel">{segment.label}</span>
              {segment.breakdown ? (
                <span className="categoryDonutInfo" tabIndex={0}>
                  <Info aria-hidden="true" size={14} />
                  <span className="kpiPopover categoryDonutInfoPopover" role="tooltip">
                    {segment.breakdown.map((line) => (
                      <span className="kpiPopoverRow" key={line.label}>
                        <span>{line.label}</span>
                        <span>{formatValue(line.value)} {line.unit}</span>
                      </span>
                    ))}
                  </span>
                </span>
              ) : (
                <span className="categoryDonutLegendValue">{formatValue(segment.value)}{unit ? ` ${unit}` : ""}</span>
              )}
              <span className="categoryDonutLegendPercent">{percent}%</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
