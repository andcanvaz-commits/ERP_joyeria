"use client";

import { useEffect, useState } from "react";
import { X } from "lucide-react";

export type RankedBarItem = {
  id: string;
  label: string;
  value: number;
  displayValue: string;
};

const MAX_COLUMNS = 8;

/** Grafico de columnas verticales (base comun, tope dorado redondeado):
 * cantidad por categoria, escala relativa al mayor valor. Muestra las
 * MAX_COLUMNS mas altas para no forzar scroll horizontal (que cortaria el
 * tooltip); el resto queda accesible en "Ver tabla" (ventana aparte, sin
 * limite de filas). Crece desde 0 al montar, en cascada. */
export function RankedBarChart({
  title,
  items,
  emptyMessage,
  valueHeader = "Valor",
  isLoading = false
}: {
  title: string;
  items: RankedBarItem[];
  emptyMessage: string;
  valueHeader?: string;
  // Mientras carga no se muestra el mensaje vacio (evita el parpadeo
  // "no hay datos" antes de que llegue la respuesta).
  isLoading?: boolean;
}) {
  const [isTableOpen, setIsTableOpen] = useState(false);
  const [animated, setAnimated] = useState(false);
  const sorted = [...items].sort((a, b) => b.value - a.value);
  const visible = sorted.slice(0, MAX_COLUMNS);
  const max = Math.max(1, ...visible.map((item) => item.value));

  useEffect(() => {
    setAnimated(false);
    const id = requestAnimationFrame(() => setAnimated(true));
    return () => cancelAnimationFrame(id);
  }, [items.length]);

  if (items.length === 0) {
    return isLoading ? null : <div className="emptyState">{emptyMessage}</div>;
  }

  return (
    <div className="columnChart">
      <button className="chartTableToggle" onClick={() => setIsTableOpen(true)} type="button">
        Ver tabla
      </button>
      <div className="columnChartPlot">
        {visible.map((item, index) => {
          const heightPct = Math.max(6, Math.round((item.value / max) * 100));
          return (
            <div className="columnChartBar barMarkHit" key={item.id} tabIndex={0}>
              <div
                className="columnChartFill"
                style={{
                  height: animated ? `${heightPct}%` : "0%",
                  transitionDelay: `${index * 45}ms`
                }}
              />
              <span className="barTooltip columnTooltip" aria-hidden="true">
                <strong>{item.displayValue}</strong> · {item.label}
              </span>
            </div>
          );
        })}
      </div>
      <div className="columnChartAxis">
        {visible.map((item) => (
          <span className="columnChartLabel" key={item.id} title={item.label}>
            {item.label}
          </span>
        ))}
      </div>
      {sorted.length > MAX_COLUMNS ? (
        <p className="columnChartMore">+{sorted.length - MAX_COLUMNS} mas en la tabla</p>
      ) : null}

      {isTableOpen ? (
        <div className="modalBackdrop modalBackdropTop" role="dialog" aria-modal="true" aria-label={`${title} — tabla`}>
          <section className="modalWindow">
            <div className="modalHeader">
              <div>
                <h2>{title}</h2>
                <p className="panelText">Vista en tabla, sin pasar el mouse.</p>
              </div>
              <button aria-label="Cerrar" className="iconOnlyButton" onClick={() => setIsTableOpen(false)} type="button">
                <X aria-hidden="true" size={18} />
              </button>
            </div>
            <div className="tableWrap">
              <table className="table tableAuto">
                <thead>
                  <tr>
                    <th>Nombre</th>
                    <th className="num">{valueHeader}</th>
                  </tr>
                </thead>
                <tbody>
                  {sorted.map((item) => (
                    <tr key={item.id}>
                      <td>{item.label}</td>
                      <td className="num">{item.displayValue}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </section>
        </div>
      ) : null}
    </div>
  );
}
