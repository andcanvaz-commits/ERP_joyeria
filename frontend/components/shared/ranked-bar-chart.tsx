"use client";

import { useEffect, useState } from "react";

export type RankedBarItem = {
  id: string;
  label: string;
  value: number;
  displayValue: string;
};

/** Lista de barras horizontales rankeadas (todas el mismo color, escala
 * relativa al mayor valor): usado para "cantidad por categoria" en los
 * dashboards. Cada fila lleva su tooltip (foco y hover), crece desde 0 al
 * montar (en cascada, fila por fila), y hay un toggle "Ver tabla" para la
 * vista accesible sin pasar el mouse. */
export function RankedBarChart({
  items,
  emptyMessage,
  valueHeader = "Valor",
  isLoading = false
}: {
  items: RankedBarItem[];
  emptyMessage: string;
  valueHeader?: string;
  // Mientras carga no se muestra el mensaje vacio (evita el parpadeo
  // "no hay datos" antes de que llegue la respuesta).
  isLoading?: boolean;
}) {
  const [showTable, setShowTable] = useState(false);
  const [animated, setAnimated] = useState(false);
  const max = Math.max(1, ...items.map((item) => item.value));

  useEffect(() => {
    setAnimated(false);
    const id = requestAnimationFrame(() => setAnimated(true));
    return () => cancelAnimationFrame(id);
  }, [items.length]);

  if (items.length === 0) {
    return isLoading ? null : <div className="emptyState">{emptyMessage}</div>;
  }

  return (
    <div className="rankedBarChart">
      <button className="chartTableToggle" onClick={() => setShowTable((current) => !current)} type="button">
        {showTable ? "Ver grafico" : "Ver tabla"}
      </button>
      {showTable ? (
        <div className="tableWrap">
          <table className="table tableAuto">
            <thead>
              <tr>
                <th>Nombre</th>
                <th className="num">{valueHeader}</th>
              </tr>
            </thead>
            <tbody>
              {items.map((item) => (
                <tr key={item.id}>
                  <td>{item.label}</td>
                  <td className="num">{item.displayValue}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="barChartList">
          {items.map((item, index) => {
            const width = Math.max(8, Math.round((item.value / max) * 100));
            return (
              <div className="barChartRow barMarkHit" key={item.id} tabIndex={0}>
                <span>{item.label}</span>
                <div className="barTrack">
                  <div
                    className="barFill"
                    style={{
                      width: animated ? `${width}%` : "0%",
                      transitionDelay: `${index * 45}ms`
                    }}
                  />
                </div>
                <small>{item.displayValue}</small>
                <span className="barTooltip" aria-hidden="true">
                  <strong>{item.displayValue}</strong> · {item.label}
                </span>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
