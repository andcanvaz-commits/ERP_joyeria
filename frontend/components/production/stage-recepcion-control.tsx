"use client";

import { useState } from "react";
import { Undo2, X } from "lucide-react";
import { addAdminActaLine } from "@/lib/production-api";
import { formatGramos } from "@/lib/orden-produccion";
import type { ActaSideLine } from "@/lib/orden-produccion";
import type { InventoryItem } from "@/types/inventory";

type Candidate = { itemId: string; label: string; unitCode: string; available: number };

// Lo que se puede "recibir de vuelta" en una etapa: solo lo que YA se
// entrego en ESA misma etapa (lado ENTREGA), y solo insumos/complementos --
// la materia prima no se devuelve por aca, ya paso a formar parte del
// producto resultante (Rodrigo, 2026-08-20). Mismo calculo de sumatorias que
// ya usaba el viejo "Devolver sobrante" de nivel de orden, acotado a la
// etapa y con el tope explicito visible antes de escribir la cantidad.
function buildCandidates(
  entregaLines: ActaSideLine[],
  recepcionLines: ActaSideLine[],
  materialItems: InventoryItem[],
): Candidate[] {
  const itemsById = new Map(materialItems.map((item) => [item.id, item]));
  const entregadoByItem = new Map<string, number>();
  for (const line of entregaLines) {
    if (line.kind !== "row" || !line.item_id) continue;
    entregadoByItem.set(line.item_id, (entregadoByItem.get(line.item_id) ?? 0) + Number(line.quantity));
  }
  const recibidoByItem = new Map<string, number>();
  for (const line of recepcionLines) {
    if (line.kind !== "row" || !line.item_id) continue;
    recibidoByItem.set(line.item_id, (recibidoByItem.get(line.item_id) ?? 0) + Number(line.quantity));
  }
  const candidates: Candidate[] = [];
  for (const [itemId, entregado] of entregadoByItem) {
    const item = itemsById.get(itemId);
    if (!item || item.item_type === "RAW_MATERIAL") continue;
    const available = entregado - (recibidoByItem.get(itemId) ?? 0);
    if (available > 0.0001) {
      candidates.push({ itemId, label: item.name, unitCode: item.unit_code, available });
    }
  }
  return candidates;
}

export function StageRecepcionControl({
  runId,
  stageAttemptId,
  entregaLines,
  recepcionLines,
  materialItems,
  onChanged,
  onError,
  onSuccess,
}: {
  runId: string;
  stageAttemptId: string;
  entregaLines: ActaSideLine[];
  recepcionLines: ActaSideLine[];
  materialItems: InventoryItem[];
  onChanged: () => void | Promise<void>;
  onError: (message: string) => void;
  onSuccess: (message: string) => void;
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [pending, setPending] = useState<Candidate | null>(null);
  const [quantity, setQuantity] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  const candidates = buildCandidates(entregaLines, recepcionLines, materialItems);

  function close() {
    setIsOpen(false);
    setPending(null);
    setQuantity("");
    setLocalError(null);
  }

  async function handleConfirm() {
    if (!pending) return;
    if (!quantity || Number(quantity) <= 0) {
      setLocalError("Indica cuanto se devuelve.");
      return;
    }
    if (Number(quantity) > pending.available + 0.0001) {
      setLocalError(`Solo hay ${formatGramos(pending.available)} ${pending.unitCode} de "${pending.label}" sin recibir.`);
      return;
    }
    setLocalError(null);
    setIsSaving(true);
    try {
      await addAdminActaLine(runId, {
        side: "RECEPCION",
        item_id: pending.itemId,
        quantity,
        stage_attempt_id: stageAttemptId,
      });
      await onChanged();
      close();
      onSuccess("Recibido registrado.");
    } catch (nextError) {
      const message = nextError instanceof Error ? nextError.message : "No se pudo registrar lo recibido.";
      setLocalError(message);
      onError(message);
    } finally {
      setIsSaving(false);
    }
  }

  if (candidates.length === 0 && !isOpen) return null;

  return (
    <div className="actaDocAction">
      <button className="actaDocAddRow" onClick={() => setIsOpen(true)} type="button">
        <Undo2 aria-hidden="true" size={13} />
        Agregar
      </button>

      {isOpen ? (
        <div className="modalBackdrop modalBackdropTop" role="dialog" aria-modal="true" aria-label="Recibir de esta etapa">
          <section className="modalWindow">
            <div className="modalHeader">
              <div>
                <h2>Recibir de esta etapa</h2>
                <p>Solo lo que ya se entrego (insumos/complementos) puede volver -- elige uno y cuanto.</p>
              </div>
              <button aria-label="Cerrar" className="iconOnlyButton" onClick={close} type="button">
                <X aria-hidden="true" size={18} />
              </button>
            </div>

            {localError ? <div className="alert alertError">{localError}</div> : null}

            {pending ? (
              <div className="materialRow" style={{ alignItems: "flex-start", gap: 8, marginTop: 10 }}>
                <div className="field" style={{ flex: 1, display: "flex", alignItems: "center" }}>
                  {pending.label} · disponible {formatGramos(pending.available)} {pending.unitCode}
                </div>
                <input
                  aria-label="Cantidad a recibir"
                  autoFocus
                  className="field"
                  max={pending.available}
                  min="0.0001"
                  onChange={(e) => {
                    setQuantity(e.target.value);
                    setLocalError(null);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === "Enter" && !isSaving) {
                      e.preventDefault();
                      void handleConfirm();
                    }
                  }}
                  placeholder={pending.unitCode}
                  step="0.0001"
                  style={{ width: 110 }}
                  type="number"
                  value={quantity}
                />
                <button
                  className="button"
                  disabled={isSaving}
                  onClick={() => {
                    setPending(null);
                    setQuantity("");
                    setLocalError(null);
                  }}
                  type="button"
                >
                  Elegir otro
                </button>
                <button className="button buttonPrimary" disabled={isSaving} onClick={() => void handleConfirm()} type="button">
                  Recibir
                </button>
              </div>
            ) : candidates.length > 0 ? (
              <div className="tableWrap" style={{ marginTop: 10 }}>
                <table className="table">
                  <thead>
                    <tr>
                      <th>Material</th>
                      <th className="num">Disponible</th>
                    </tr>
                  </thead>
                  <tbody>
                    {candidates.map((candidate) => (
                      <tr
                        key={candidate.itemId}
                        onClick={() => {
                          setPending(candidate);
                          setQuantity(String(candidate.available));
                          setLocalError(null);
                        }}
                        style={{ cursor: "pointer" }}
                      >
                        <td>{candidate.label}</td>
                        <td className="num">{formatGramos(candidate.available)} {candidate.unitCode}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="emptyState">Nada pendiente de recibir.</div>
            )}
          </section>
        </div>
      ) : null}
    </div>
  );
}
