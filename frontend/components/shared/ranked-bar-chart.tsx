"use client";

export type BarChartItem = {
  id: string;
  label: string;
  value: number;
};

// Maximo 2 decimales -- igual criterio que el resto de graficos del
// dashboard (category-donut.tsx): valores derivados de sumas/multiplicaciones
// no deben mostrar ruido de punto flotante.
function formatValue(value: number, unit: string): string {
  const text = value.toLocaleString("es-EC", { maximumFractionDigits: 2 });
  return unit ? `${text} ${unit}` : text;
}

/** Grafico de barras horizontal, ranking de una sola serie (magnitud por
 * categoria) -- una sola tonalidad porque el color no distingue identidad
 * aqui, la etiqueta lo hace (serie unica = sin leyenda). Barra crece desde
 * una base fija (izquierda), extremo redondeado en la punta, valor directo
 * en la punta en vez de tabla/tooltip aparte. */
export function RankedBarChart({
  items,
  emptyMessage,
  isLoading = false,
  unit = "",
}: {
  items: BarChartItem[];
  emptyMessage: string;
  isLoading?: boolean;
  unit?: string;
}) {
  if (items.length === 0) {
    return isLoading ? null : <div className="emptyState">{emptyMessage}</div>;
  }

  const max = Math.max(1, ...items.map((item) => item.value));

  return (
    <ul className="rankedBarChart">
      {items.map((item) => {
        const percent = Math.max(4, Math.round((item.value / max) * 100));
        return (
          <li className="rankedBarRow" key={item.id} title={`${item.label}: ${formatValue(item.value, unit)}`}>
            <span className="rankedBarLabel">{item.label}</span>
            <div className="rankedBarTrack">
              <div className="rankedBarFill" style={{ width: `${percent}%` }} />
            </div>
            <span className="rankedBarValue">{formatValue(item.value, unit)}</span>
          </li>
        );
      })}
    </ul>
  );
}
