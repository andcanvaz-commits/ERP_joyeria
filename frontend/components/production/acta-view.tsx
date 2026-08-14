"use client";

import { useState } from "react";
import { Pencil, Plus, Trash2, X } from "lucide-react";
import { addActaLine, deleteActaLine, updateActaLine } from "@/lib/production-api";
import type { ProductionRun } from "@/types/production";

function numericText(value: string | number | null | undefined) {
  if (value === null || value === undefined || value === "") return "0";
  const number = Number(value);
  return Number.isFinite(number) ? number.toLocaleString("es-EC", { maximumFractionDigits: 4 }) : String(value);
}

const SOURCE_LABEL: Record<string, string> = {
  PLAN: "Plan",
  AUTO: "Automatica",
  MANUAL: "Manual",
};

type ActaLine = NonNullable<ProductionRun["acta_lines"]>[number];

function ActaSide({
  title,
  side,
  lines,
  runId,
  onChanged,
  onError,
}: {
  title: string;
  side: "ENTREGA" | "RECEPCION";
  lines: ActaLine[];
  runId: string;
  onChanged: () => void;
  onError: (message: string) => void;
}) {
  const [isAdding, setIsAdding] = useState(false);
  const [newLabel, setNewLabel] = useState("");
  const [newQuantity, setNewQuantity] = useState("");
  const [newUnit, setNewUnit] = useState("");
  const [newNote, setNewNote] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editLabel, setEditLabel] = useState("");
  const [editQuantity, setEditQuantity] = useState("");
  const [editUnit, setEditUnit] = useState("");
  const [editNote, setEditNote] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  function startEdit(line: ActaLine) {
    setEditingId(line.id);
    setEditLabel(line.label);
    setEditQuantity(line.quantity);
    setEditUnit(line.unit_code);
    setEditNote(line.note ?? "");
  }

  async function saveEdit(lineId: string) {
    if (!editLabel.trim() || !editQuantity || Number(editQuantity) <= 0 || !editUnit.trim()) {
      onError("Completa nombre, cantidad y unidad de la linea.");
      return;
    }
    setIsSaving(true);
    try {
      await updateActaLine(lineId, {
        label: editLabel.trim(),
        quantity: editQuantity,
        unit_code: editUnit.trim(),
        note: editNote.trim() || null,
      });
      setEditingId(null);
      onChanged();
    } catch (nextError) {
      onError(nextError instanceof Error ? nextError.message : "No se pudo editar la linea.");
    } finally {
      setIsSaving(false);
    }
  }

  async function handleDelete(lineId: string) {
    setIsSaving(true);
    try {
      await deleteActaLine(lineId);
      onChanged();
    } catch (nextError) {
      onError(nextError instanceof Error ? nextError.message : "No se pudo borrar la linea.");
    } finally {
      setIsSaving(false);
    }
  }

  async function handleAdd() {
    if (!newLabel.trim() || !newQuantity || Number(newQuantity) <= 0 || !newUnit.trim()) {
      onError("Completa nombre, cantidad y unidad de la linea.");
      return;
    }
    setIsSaving(true);
    try {
      await addActaLine(runId, {
        side,
        label: newLabel.trim(),
        quantity: newQuantity,
        unit_code: newUnit.trim(),
        note: newNote.trim() || null,
      });
      setIsAdding(false);
      setNewLabel("");
      setNewQuantity("");
      setNewUnit("");
      setNewNote("");
      onChanged();
    } catch (nextError) {
      onError(nextError instanceof Error ? nextError.message : "No se pudo agregar la linea.");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="fieldGroup">
      <span>{title}</span>
      <div className="tableWrap">
        <table className="table">
          <thead>
            <tr>
              <th>Material</th>
              <th>Etapa</th>
              <th className="num">Cantidad</th>
              <th>Origen</th>
              <th>Nota</th>
              <th aria-label="Acciones" />
            </tr>
          </thead>
          <tbody>
            {lines.map((line) => (
              <tr key={line.id}>
                {editingId === line.id ? (
                  <>
                    <td>
                      <input className="field" onChange={(e) => setEditLabel(e.target.value)} value={editLabel} />
                    </td>
                    <td>{line.stage_name ?? "—"}</td>
                    <td className="num">
                      <span style={{ display: "inline-flex", gap: 4 }}>
                        <input
                          className="field"
                          min="0"
                          onChange={(e) => setEditQuantity(e.target.value)}
                          step="0.0001"
                          style={{ width: 80 }}
                          type="number"
                          value={editQuantity}
                        />
                        <input
                          className="field"
                          onChange={(e) => setEditUnit(e.target.value)}
                          style={{ width: 60 }}
                          value={editUnit}
                        />
                      </span>
                    </td>
                    <td>{SOURCE_LABEL[line.source] ?? line.source}</td>
                    <td>
                      <input className="field" onChange={(e) => setEditNote(e.target.value)} value={editNote} />
                    </td>
                    <td>
                      <div style={{ display: "flex", gap: 4 }}>
                        <button className="button buttonPrimary" disabled={isSaving} onClick={() => void saveEdit(line.id)} type="button">
                          Guardar
                        </button>
                        <button className="button" disabled={isSaving} onClick={() => setEditingId(null)} type="button">
                          Cancelar
                        </button>
                      </div>
                    </td>
                  </>
                ) : (
                  <>
                    <td>{line.label}</td>
                    <td>{line.stage_name ?? "—"}</td>
                    <td className="num">{numericText(line.quantity)} {line.unit_code}</td>
                    <td>{SOURCE_LABEL[line.source] ?? line.source}</td>
                    <td>{line.note ?? "—"}</td>
                    <td>
                      <div style={{ display: "flex", gap: 4 }}>
                        <button
                          aria-label={`Editar ${line.label}`}
                          className="iconOnlyButton"
                          disabled={isSaving}
                          onClick={() => startEdit(line)}
                          type="button"
                        >
                          <Pencil aria-hidden="true" size={14} />
                        </button>
                        {line.source === "MANUAL" ? (
                          <button
                            aria-label={`Borrar ${line.label}`}
                            className="iconOnlyButton dangerIconButton"
                            disabled={isSaving}
                            onClick={() => void handleDelete(line.id)}
                            type="button"
                          >
                            <Trash2 aria-hidden="true" size={14} />
                          </button>
                        ) : null}
                      </div>
                    </td>
                  </>
                )}
              </tr>
            ))}
            {lines.length === 0 && !isAdding ? (
              <tr>
                <td colSpan={6}>
                  <div className="emptyState">Sin lineas todavia.</div>
                </td>
              </tr>
            ) : null}
            {isAdding ? (
              <tr>
                <td>
                  <input className="field" onChange={(e) => setNewLabel(e.target.value)} placeholder="Material" value={newLabel} />
                </td>
                <td>—</td>
                <td className="num">
                  <span style={{ display: "inline-flex", gap: 4 }}>
                    <input
                      className="field"
                      min="0"
                      onChange={(e) => setNewQuantity(e.target.value)}
                      placeholder="Cant."
                      step="0.0001"
                      style={{ width: 80 }}
                      type="number"
                      value={newQuantity}
                    />
                    <input
                      className="field"
                      onChange={(e) => setNewUnit(e.target.value)}
                      placeholder="Unidad"
                      style={{ width: 60 }}
                      value={newUnit}
                    />
                  </span>
                </td>
                <td>Manual</td>
                <td>
                  <input className="field" onChange={(e) => setNewNote(e.target.value)} placeholder="Nota (opcional)" value={newNote} />
                </td>
                <td>
                  <div style={{ display: "flex", gap: 4 }}>
                    <button className="button buttonPrimary" disabled={isSaving} onClick={() => void handleAdd()} type="button">
                      Agregar
                    </button>
                    <button className="button" disabled={isSaving} onClick={() => setIsAdding(false)} type="button">
                      Cancelar
                    </button>
                  </div>
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
      {!isAdding ? (
        <button className="button" onClick={() => setIsAdding(true)} style={{ marginTop: 8 }} type="button">
          <Plus aria-hidden="true" size={14} />
          Agregar linea
        </button>
      ) : null}
    </div>
  );
}

export function ActaView({
  run,
  onClose,
  onChanged,
}: {
  run: ProductionRun;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const lines = run.acta_lines ?? [];
  const entrega = lines.filter((line) => line.side === "ENTREGA");
  const recepcion = lines.filter((line) => line.side === "RECEPCION");

  return (
    <div className="modalBackdrop modalBackdropTop" role="dialog" aria-modal="true" aria-label="Acta de la orden">
      <section className="modalWindow processViewWindow">
        <div className="modalHeader">
          <div>
            <h2>Acta {run.production_code ?? ""}</h2>
            <p>{run.process_name} · qué entra y qué sale de la orden</p>
          </div>
          <button aria-label="Cerrar" className="iconOnlyButton" onClick={onClose} type="button">
            <X aria-hidden="true" size={18} />
          </button>
        </div>

        {error ? (
          <div className="processFlowCallout" style={{ color: "var(--danger, #b42318)" }}>
            {error}
          </div>
        ) : null}

        <ActaSide title="Entrega" side="ENTREGA" lines={entrega} runId={run.id} onChanged={onChanged} onError={setError} />
        <ActaSide title="Recepcion" side="RECEPCION" lines={recepcion} runId={run.id} onChanged={onChanged} onError={setError} />
      </section>
    </div>
  );
}
