"use client";

import { useState } from "react";
import { Check, Info, Pencil, Trash2, X } from "lucide-react";
import {
  ActaSideLine,
  ActaSideTotal,
  formatDocDate,
  formatGramos,
} from "@/lib/orden-produccion";

const DASH = "—";
const MIN_ROWS = 5;

// Una sola pieza para las dos vistas del certificado (Ver Acta y Documentos)
// -- antes cada una tenia su propio componente y se desincronizaban cada vez
// que se agregaba una fase/aviso nuevo. "row" = una linea real (editable solo
// si el que la llama pasa onEditLine/onDeleteLine y editable=true, que hoy
// solo pasa en Ver Acta para lineas source=MANUAL). "group" es exclusivo de
// Documentos con familias historicas/split con mas de un evento real: agrupa
// las filas de cada corrida bajo su propia fecha/responsable. Los tipos viven
// en lib/orden-produccion.ts (no aca) para que ese modulo pueda construir el
// modelo de Documentos sin importar de este componente en circulo.

export function ActaSide({
  title,
  lines,
  fecha,
  responsable,
  totalRows,
  dataClass,
  actions,
  footer,
  onEditLine,
  onDeleteLine,
  onError,
}: {
  title: string;
  lines: ActaSideLine[];
  // Fecha/responsable del unico evento real de este lado -- null cuando
  // todavia no hay uno (muestra "Pendiente") o cuando `lines` ya trae varios
  // "group" (cada uno con su propia fecha, no hay una sola que mostrar arriba).
  fecha: string | null;
  responsable: string;
  totalRows?: ActaSideTotal[];
  // Clase de visibilidad para impresion selectiva (opEntregaData/
  // opRecepcionData en orden-produccion-doc.tsx); ausente en Ver Acta, que no
  // imprime por seccion.
  dataClass?: string;
  actions?: React.ReactNode;
  footer?: React.ReactNode;
  onEditLine?: (lineId: string, patch: { label?: string; quantity: string; unit_code?: string }) => Promise<unknown> | void;
  onDeleteLine?: (lineId: string) => Promise<unknown> | void;
  onError?: (message: string) => void;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editingSource, setEditingSource] = useState<string>("MANUAL");
  const [editLabel, setEditLabel] = useState("");
  const [editQuantity, setEditQuantity] = useState("");
  const [editUnit, setEditUnit] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  function startEdit(line: Extract<ActaSideLine, { kind: "row" }>) {
    setEditingId(line.id);
    setEditingSource(line.source);
    setEditLabel(line.label);
    setEditQuantity(line.quantity);
    setEditUnit(line.unit_code);
  }

  async function saveEdit(lineId: string) {
    if (!editQuantity || Number(editQuantity) <= 0) {
      onError?.("Indica la cantidad de la linea.");
      return;
    }
    if (editingSource !== "ADMIN_STOCK" && (!editLabel.trim() || !editUnit.trim())) {
      onError?.("Completa detalle, cantidad y unidad de la linea.");
      return;
    }
    setIsSaving(true);
    try {
      const patch = editingSource === "ADMIN_STOCK"
        ? { quantity: editQuantity }
        : { label: editLabel.trim(), quantity: editQuantity, unit_code: editUnit.trim() };
      await onEditLine?.(lineId, patch);
      setEditingId(null);
    } catch (nextError) {
      onError?.(nextError instanceof Error ? nextError.message : "No se pudo editar la linea.");
    } finally {
      setIsSaving(false);
    }
  }

  async function handleDelete(lineId: string) {
    setIsSaving(true);
    try {
      await onDeleteLine?.(lineId);
    } catch (nextError) {
      onError?.(nextError instanceof Error ? nextError.message : "No se pudo borrar la linea.");
    } finally {
      setIsSaving(false);
    }
  }

  const totals = totalRows ?? [];
  const hasGroups = lines.some((line) => line.kind === "group");
  const rowCount = lines.filter((line) => line.kind === "row").length;
  const blankCount = Math.max(0, MIN_ROWS - rowCount - totals.length);
  const wrap = (node: React.ReactNode) => (dataClass ? <span className={dataClass}>{node}</span> : node);

  return (
    <section className={`opCol actaDocCol${dataClass ? ` ${dataClass}` : ""}`}>
      <div className="opColHead">
        {title}
        {hasGroups ? null : fecha ? (
          <span className="opColSub"> · {formatDocDate(fecha) || DASH} · {responsable || DASH}</span>
        ) : (
          <span className="opColSubPending">
            <Info aria-hidden="true" size={12} /> Pendiente
          </span>
        )}
      </div>
      <table className="opTable">
        <thead>
          <tr>
            <th className="opThFecha">FECHA</th>
            <th className="opThGramos">CANTIDAD</th>
            <th>DETALLES</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((line, index) =>
              line.kind === "group" ? (
                <tr className="opGroupRow" key={`group-${index}`}>
                  <td colSpan={3}>
                    {wrap(
                      <>
                        {formatDocDate(line.fecha) || " "} · Responsable Inventario: {line.responsable}
                      </>
                    )}
                  </td>
                </tr>
              ) : editingId === line.id ? (
                <tr key={line.id}>
                  <td> </td>
                  <td className="opTdGramos">
                    <span className="actaDocInputs">
                      <input
                        className="field"
                        min="0"
                        onChange={(e) => setEditQuantity(e.target.value)}
                        step="0.0001"
                        style={{ width: 84 }}
                        type="number"
                        value={editQuantity}
                      />
                      {editingSource === "ADMIN_STOCK" ? (
                        <span>{editUnit}</span>
                      ) : (
                        <input
                          className="field"
                          onChange={(e) => setEditUnit(e.target.value)}
                          style={{ width: 40 }}
                          value={editUnit}
                        />
                      )}
                    </span>
                  </td>
                  <td>
                    <span className="actaDocInputs">
                      {editingSource === "ADMIN_STOCK" ? (
                        <span style={{ flex: 1 }}>{editLabel}</span>
                      ) : (
                        <input
                          className="field"
                          onChange={(e) => setEditLabel(e.target.value)}
                          style={{ flex: 1 }}
                          value={editLabel}
                        />
                      )}
                      <button aria-label="Guardar" className="iconOnlyButton" disabled={isSaving} onClick={() => void saveEdit(line.id)} type="button">
                        <Check aria-hidden="true" size={14} />
                      </button>
                      <button aria-label="Cancelar" className="iconOnlyButton" disabled={isSaving} onClick={() => setEditingId(null)} type="button">
                        <X aria-hidden="true" size={14} />
                      </button>
                    </span>
                  </td>
                </tr>
              ) : (
                <tr className="actaDocRow" key={line.id}>
                  <td> </td>
                  <td className="opTdGramos">
                    {wrap(
                      <>
                        {formatGramos(Number(line.quantity))} {line.unit_code}
                      </>
                    )}
                  </td>
                  <td>
                    <span className="actaDocDetail">
                      {wrap(<span>{line.label}</span>)}
                      {line.editable ? (
                        <span className="actaDocRowActions">
                          <button aria-label={`Editar ${line.label}`} className="iconOnlyButton" disabled={isSaving} onClick={() => startEdit(line)} type="button">
                            <Pencil aria-hidden="true" size={12} />
                          </button>
                          <button
                            aria-label={`Borrar ${line.label}`}
                            className="iconOnlyButton dangerIconButton"
                            disabled={isSaving}
                            onClick={() => void handleDelete(line.id)}
                            type="button"
                          >
                            <Trash2 aria-hidden="true" size={12} />
                          </button>
                        </span>
                      ) : null}
                    </span>
                  </td>
                </tr>
              )
            )}
            {totals.map((row, i) => (
              <tr
                className={`opSubtotalRow ${row.kind === "merma" ? "opSubtotalRowMerma" : "opSubtotalRowTotal"}`}
                key={`total-${i}`}
              >
                <td> </td>
                <td className="opTdGramos">{wrap(<>{formatGramos(row.quantity)} {row.unit}</>)}</td>
                <td>{wrap(<>{row.label}</>)}</td>
              </tr>
            ))}
            {Array.from({ length: blankCount }).map((_, i) => (
              <tr key={`blank-${i}`}>
                <td> </td>
                <td className="opTdGramos"> </td>
                <td> </td>
              </tr>
            ))}
          </tbody>
        </table>
      {actions}
      {footer}
    </section>
  );
}
