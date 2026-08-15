"use client";

import { useState } from "react";
import { Check, Pencil, Plus, Trash2, Undo2, X } from "lucide-react";
import { addActaLine, deleteActaLine, requestAdditionalMaterial, returnComplement, updateActaLine } from "@/lib/production-api";
import { formatDocDate, formatGramos } from "@/lib/orden-produccion";
import { MaterialCategoryPicker } from "@/components/production/material-category-picker";
import type { ProductionRun } from "@/types/production";
import type { InventoryItem } from "@/types/inventory";

const DASH = "—";
const MIN_ROWS = 5;

type ActaLine = NonNullable<ProductionRun["acta_lines"]>[number];
type Complement = NonNullable<ProductionRun["complements"]>[number];

// Misma pinta que el documento impreso (opDoc/opTable, ver
// components/documentos/orden-produccion-doc.tsx): las lineas se editan
// directo sobre las mismas celdas FECHA/CANTIDAD/DETALLES que despues salen
// en el papel. La columna FECHA queda en blanco fila por fila (igual que en
// el impreso: la fecha va una sola vez, en el subtitulo de la columna) y ahi
// mismo viven los botones de editar/borrar. Ya no hay "agregar linea" libre:
// lo que entra/sale de verdad nace de una accion real (ver EntregaAction /
// RecepcionActions mas abajo), nunca de texto suelto.
// Fila de total/balance: mismo lugar que una linea real, con su propia
// etiqueta en DETALLES ("Total entregado", "Total recibido", "Merma total")
// y un color distinto segun el tipo -- un total no es lo mismo que una
// merma, no deben leerse igual.
type TotalRow = { label: string; quantity: number; unit: string; kind: "total" | "merma" };

function ActaDocSide({
  title,
  lines,
  fecha,
  responsable,
  onError,
  actions,
  footer,
  totalRows,
}: {
  title: string;
  lines: ActaLine[];
  fecha: string | null;
  responsable: string;
  onError: (message: string) => void;
  actions?: React.ReactNode;
  footer?: React.ReactNode;
  totalRows?: TotalRow[];
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editLabel, setEditLabel] = useState("");
  const [editQuantity, setEditQuantity] = useState("");
  const [editUnit, setEditUnit] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  function startEdit(line: ActaLine) {
    setEditingId(line.id);
    setEditLabel(line.label);
    setEditQuantity(line.quantity);
    setEditUnit(line.unit_code);
  }

  async function saveEdit(lineId: string) {
    if (!editLabel.trim() || !editQuantity || Number(editQuantity) <= 0 || !editUnit.trim()) {
      onError("Completa detalle, cantidad y unidad de la linea.");
      return;
    }
    setIsSaving(true);
    try {
      await updateActaLine(lineId, {
        label: editLabel.trim(),
        quantity: editQuantity,
        unit_code: editUnit.trim(),
      });
      setEditingId(null);
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
    } catch (nextError) {
      onError(nextError instanceof Error ? nextError.message : "No se pudo borrar la linea.");
    } finally {
      setIsSaving(false);
    }
  }

  const totals = totalRows ?? [];
  const blankCount = Math.max(0, MIN_ROWS - lines.length - totals.length);

  return (
    <section className="opCol actaDocCol">
      <div className="opColHead">
        {title}
        <span className="opColSub"> · {formatDocDate(fecha) || DASH} · {responsable || DASH}</span>
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
          {lines.map((line) =>
            editingId === line.id ? (
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
                    <input
                      className="field"
                      onChange={(e) => setEditUnit(e.target.value)}
                      style={{ width: 40 }}
                      value={editUnit}
                    />
                  </span>
                </td>
                <td>
                  <span className="actaDocInputs">
                    <input
                      className="field"
                      onChange={(e) => setEditLabel(e.target.value)}
                      style={{ flex: 1 }}
                      value={editLabel}
                    />
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
                  {formatGramos(Number(line.quantity))} {line.unit_code}
                </td>
                <td>
                  <span className="actaDocDetail">
                    <span>{line.label}</span>
                    {line.source === "MANUAL" ? (
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
              key={`acta-total-${i}`}
            >
              <td> </td>
              <td className="opTdGramos">{formatGramos(row.quantity)} {row.unit}</td>
              <td>{row.label}</td>
            </tr>
          ))}
          {Array.from({ length: blankCount }).map((_, i) => (
            <tr key={`acta-blank-${i}`}>
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

// Lado Entrega: nada de texto libre — lo que entra a la orden mientras esta
// EN_PROCESO es una solicitud real a Inventario (mismo circuito y mismo
// picker que el boton "Solicitar material" de la ficha de la corrida). Queda
// PENDIENTE hasta que Inventario aprueba; recien ahi la acta se auto-alimenta.
function EntregaAction({
  run,
  materialItems,
  onChanged,
  onSuccess,
}: {
  run: ProductionRun;
  materialItems: InventoryItem[];
  onChanged: () => void;
  onSuccess: (message: string) => void;
}) {
  const [isPickerOpen, setIsPickerOpen] = useState(false);
  const [pendingItem, setPendingItem] = useState<InventoryItem | null>(null);
  const [quantity, setQuantity] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  // El error tiene que aparecer en esta misma ventana, no en un banner
  // lejos de donde el usuario esta mirando.
  const [localError, setLocalError] = useState<string | null>(null);

  if (run.status !== "EN_PROCESO") return null;

  function closePicker() {
    setIsPickerOpen(false);
    setPendingItem(null);
    setQuantity("");
    setLocalError(null);
  }

  async function handleSubmit() {
    if (!pendingItem || !quantity || Number(quantity) <= 0) {
      setLocalError("Elige el material y su cantidad.");
      return;
    }
    setLocalError(null);
    setIsSaving(true);
    try {
      await requestAdditionalMaterial(run.id, {
        item_id: pendingItem.id,
        quantity,
      });
      closePicker();
      onChanged();
      onSuccess("Solicitud enviada. Inventario debe aprobarla.");
    } catch (nextError) {
      setLocalError(nextError instanceof Error ? nextError.message : "No se pudo enviar la solicitud.");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="actaDocAction">
      <button className="actaDocAddRow" onClick={() => setIsPickerOpen(true)} type="button">
        <Plus aria-hidden="true" size={13} />
        Solicitar material
      </button>

      {isPickerOpen ? (
        <MaterialCategoryPicker
          allowedTypes={["RAW_MATERIAL", "SUPPLY", "COMPLEMENT"]}
          description="Elige el material que necesitas pedir para esta orden"
          error={localError}
          items={materialItems}
          onClose={closePicker}
          onSelect={(item) => {
            setPendingItem(item);
            setQuantity("");
            setLocalError(null);
          }}
          quantityStep={
            pendingItem
              ? {
                  confirmLabel: "Enviar solicitud",
                  isSaving,
                  item: pendingItem,
                  onBack: () => {
                    setPendingItem(null);
                    setLocalError(null);
                  },
                  onConfirm: () => void handleSubmit(),
                  onQuantityChange: (value) => {
                    setQuantity(value);
                    setLocalError(null);
                  },
                  quantity,
                }
              : undefined
          }
          title="Solicitar material"
        />
      ) : null}
    </div>
  );
}

// Complementos aprobados con sobrante por devolver (aprobado - usado en
// ensamble - ya devuelto > 0). Se usa tanto dentro de la acta como en el
// paso automatico al terminar la produccion (ver production-dashboard.tsx).
export function returnableComplements(run: ProductionRun): Array<Complement & { remaining: number }> {
  return (run.complements ?? [])
    .filter((c) => c.status === "APROBADA")
    .map((c) => ({
      ...c,
      remaining: Number(c.quantity) - Number(c.used_quantity ?? 0) - Number(c.returned_quantity ?? 0),
    }))
    .filter((c) => c.remaining > 0.0001);
}

// Lado Recepcion: la materia prima ya se reconcilia sola con la merma por
// etapa. Lo que falta es el sobrante de complementos e insumos — se
// aprueban/entregan enteros al aprobar materiales (approve_materials), pero
// el proceso puede no haber usado todo (ej. 100 "bolas 2.5" aprobadas, 80
// ensambladas, 20 sobran). Un solo boton, una sola lista: se elige el
// material y se anota cuanto sobro. Si es un complemento, "sobrante" significa que
// vuelve de verdad a inventario (returnComplement, movimiento real); si es
// un insumo no hay circuito de devolucion fisica establecido, asi que queda
// como linea MANUAL en la acta (registro de que no se uso, sin mover stock).
// Antes esto eran DOS botones separados ("Devolver sobrante" / "Entregar
// material") con listas casi identicas -- confundia mas de lo que ayudaba.
type ReturnCandidate =
  | { kind: "complemento"; id: string; label: string; unit_code: string; available: number }
  | { kind: "insumo"; id: string; item_id: string; label: string; unit_code: string; available: number };

// `available` es el tope real: no se puede anotar/devolver mas de lo que de
// verdad se entrego/aprobo — ya se resta lo que ya se registro antes en el
// acta para ese mismo item (por identidad real, no por texto: dos items
// distintos pueden llamarse igual).
export function buildReturnCandidates(run: ProductionRun): ReturnCandidate[] {
  const complementRows: ReturnCandidate[] = returnableComplements(run).map((c) => ({
    kind: "complemento",
    id: c.id,
    label: c.name ?? "Complemento",
    unit_code: c.unit_code,
    available: c.remaining,
  }));

  const recepcion = (run.acta_lines ?? []).filter((line) => line.side === "RECEPCION");
  const alreadyLogged = (itemId: string) =>
    recepcion.filter((line) => line.item_id === itemId).reduce((sum, line) => sum + Number(line.quantity), 0);
  const supplyRows: ReturnCandidate[] = (run.supply_consumptions ?? [])
    .map((s) => ({
      kind: "insumo" as const,
      id: s.item_id,
      item_id: s.item_id,
      label: s.name,
      unit_code: s.unit_code,
      available: Number(s.quantity) - alreadyLogged(s.item_id),
    }))
    .filter((candidate) => candidate.available > 0.0001);

  return [...complementRows, ...supplyRows];
}

// Contenido puro (sin boton ni ventana propia): lista de candidatos +
// formulario de cantidad. Se usa DENTRO de la ventana del picker que abre
// RecepcionActions, y tambien directo -- sin boton intermedio ni ventana
// anidada -- en el paso automatico al terminar la produccion
// (production-dashboard.tsx): ahi ya se sabe que hay sobrante por devolver,
// pedirle al usuario que ademas haga clic en un boton para verlo es un paso
// de mas.
export function ReturnCandidatesForm({
  run,
  onChanged,
  onError,
  onSuccess,
}: {
  run: ProductionRun;
  onChanged: () => void;
  onError: (message: string) => void;
  onSuccess?: (message: string) => void;
}) {
  const [pendingCandidate, setPendingCandidate] = useState<ReturnCandidate | null>(null);
  const [quantity, setQuantity] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);

  const candidates = buildReturnCandidates(run);

  if (candidates.length === 0) return null;

  async function handleConfirm() {
    if (!pendingCandidate) return;
    if (!quantity || Number(quantity) <= 0) {
      setLocalError("Indica cuanto sobro.");
      return;
    }
    if (Number(quantity) > pendingCandidate.available + 0.0001) {
      setLocalError(`Solo hay ${formatGramos(pendingCandidate.available)} ${pendingCandidate.unit_code} de "${pendingCandidate.label}" sin registrar.`);
      return;
    }
    setLocalError(null);
    setIsSaving(true);
    try {
      if (pendingCandidate.kind === "complemento") {
        await returnComplement(pendingCandidate.id, quantity);
      } else {
        await addActaLine(run.id, {
          side: "RECEPCION",
          label: pendingCandidate.label,
          quantity,
          unit_code: pendingCandidate.unit_code,
          item_id: pendingCandidate.item_id,
        });
      }
      setPendingCandidate(null);
      setQuantity("");
      onChanged();
      onSuccess?.("Sobrante devuelto a inventario.");
    } catch (nextError) {
      const message = nextError instanceof Error ? nextError.message : "No se pudo registrar el sobrante.";
      setLocalError(message);
      onError(message);
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <>
      {localError ? (
        <div className="processFlowCallout" style={{ color: "var(--danger, #b42318)", marginTop: 10 }}>
          {localError}
        </div>
      ) : null}

      {pendingCandidate ? (
        <div className="materialRow" style={{ alignItems: "flex-start", gap: 8, marginTop: 10 }}>
          <div className="field" style={{ flex: 1, display: "flex", alignItems: "center" }}>
            {pendingCandidate.label} · sobran {formatGramos(pendingCandidate.available)} {pendingCandidate.unit_code}
          </div>
          <input
            aria-label="Cantidad a devolver"
            autoFocus
            className="field"
            max={pendingCandidate.available}
            min="0.0001"
            onChange={(e) => {
              setQuantity(e.target.value);
              setLocalError(null);
            }}
            placeholder={pendingCandidate.unit_code}
            step="0.0001"
            style={{ width: 110 }}
            type="number"
            value={quantity}
          />
          <button
            className="button"
            disabled={isSaving}
            onClick={() => {
              setPendingCandidate(null);
              setQuantity("");
              setLocalError(null);
            }}
            type="button"
          >
            Elegir otro
          </button>
          <button className="button buttonPrimary" disabled={isSaving} onClick={() => void handleConfirm()} type="button">
            Devolver
          </button>
        </div>
      ) : (
        <div className="tableWrap" style={{ marginTop: 10 }}>
          <table className="table">
            <thead>
              <tr>
                <th>Material</th>
                <th className="num">Sobrante</th>
              </tr>
            </thead>
            <tbody>
              {candidates.map((candidate) => (
                <tr
                  key={`${candidate.kind}-${candidate.id}`}
                  onClick={() => {
                    setPendingCandidate(candidate);
                    setQuantity(String(candidate.available));
                    setLocalError(null);
                  }}
                  style={{ cursor: "pointer" }}
                >
                  <td>{candidate.label}</td>
                  <td className="num">{formatGramos(candidate.available)} {candidate.unit_code}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

export function RecepcionActions({
  run,
  onChanged,
  onError,
  onSuccess,
}: {
  run: ProductionRun;
  onChanged: () => void;
  onError: (message: string) => void;
  onSuccess?: (message: string) => void;
}) {
  const [isPickerOpen, setIsPickerOpen] = useState(false);

  if (buildReturnCandidates(run).length === 0) return null;

  return (
    <div className="actaDocAction">
      <button className="actaDocAddRow" onClick={() => setIsPickerOpen(true)} type="button">
        <Undo2 aria-hidden="true" size={13} />
        Devolver sobrante
      </button>

      {isPickerOpen ? (
        <div className="modalBackdrop modalBackdropTop" role="dialog" aria-modal="true" aria-label="Devolver sobrante">
          <section className="modalWindow">
            <div className="modalHeader">
              <div>
                <h2>Devolver sobrante</h2>
                <p>Complementos e insumos de esta orden que sobraron sin usar — elige uno y cuanto se devuelve.</p>
              </div>
              <button aria-label="Cerrar" className="iconOnlyButton" onClick={() => setIsPickerOpen(false)} type="button">
                <X aria-hidden="true" size={18} />
              </button>
            </div>
            <ReturnCandidatesForm onChanged={onChanged} onError={onError} onSuccess={onSuccess} run={run} />
          </section>
        </div>
      ) : null}
    </div>
  );
}

// Merma total, como fila del propio certificado (no una caja aparte): los
// gramos que entraron a producir NO quedan fijos -- se actualizan segun la
// merma que se va registrando. Por eso la fuente de la merma no es ninguna
// linea de la acta (ni "Merma etapa X" ni el producto resultante, que nace
// con la cantidad PLANEADA al crear la orden y nunca se corrige despues del
// pesaje real): es `stage.waste_weight`, el mismo numero que ya mantiene al
// dia finish_stage/_recompute_stage_waste_chain etapa por etapa, y que se
// convierte en run.waste_weight cuando la orden termina. Recibido = entregado
// menos esa merma acumulada; nunca una segunda cuenta aparte que termine
// restando (o sumando) la merma dos veces.
function sumByItem(lines: ActaLine[], itemId: string): number {
  return lines.filter((l) => l.item_id === itemId).reduce((sum, l) => sum + Number(l.quantity), 0);
}

function computeBalanceTotals(run: ProductionRun): { entregaTotalRows: TotalRow[]; recepcionTotalRows: TotalRow[] } {
  const unit = run.raw_material_unit_code;
  const rawMaterialId = run.raw_material_item_id;
  if (!unit || !rawMaterialId) return { entregaTotalRows: [], recepcionTotalRows: [] };
  const lines = run.acta_lines ?? [];
  const entregaTotal = sumByItem(lines.filter((l) => l.side === "ENTREGA"), rawMaterialId);
  if (entregaTotal <= 0) return { entregaTotalRows: [], recepcionTotalRows: [] };
  const mermaAcumulada = run.stages.reduce((sum, stage) => sum + Number(stage.waste_weight ?? 0), 0);
  const recepcionTotalRows: TotalRow[] = [
    { label: "Total recibido", quantity: entregaTotal - mermaAcumulada, unit, kind: "total" },
  ];
  // La fila de merma total solo tiene sentido "al final": finished_at queda
  // seteado en _finish_run sin importar si hubo o no una etapa que pese.
  // Antes de eso el proceso sigue en curso -- lo que "falta" en recibido no
  // es merma todavia, es simplemente material que aun no paso por una etapa.
  if (run.finished_at !== null) {
    recepcionTotalRows.push({ label: "Merma total", quantity: mermaAcumulada, unit, kind: "merma" });
  }
  return {
    entregaTotalRows: [{ label: "Total entregado", quantity: entregaTotal, unit, kind: "total" }],
    recepcionTotalRows,
  };
}

export function ActaView({
  run,
  materialItems,
  onClose,
  onChanged,
}: {
  run: ProductionRun;
  materialItems: InventoryItem[];
  onClose: () => void;
  onChanged: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  const lines = run.acta_lines ?? [];
  const entrega = lines.filter((line) => line.side === "ENTREGA");
  const recepcion = lines.filter((line) => line.side === "RECEPCION");
  const { entregaTotalRows, recepcionTotalRows } = computeBalanceTotals(run);

  function flagSuccess(message: string) {
    setError(null);
    setSuccess(message);
  }
  function flagError(message: string) {
    setSuccess(null);
    setError(message);
  }

  return (
    <div className="modalBackdrop modalBackdropTop" role="dialog" aria-modal="true" aria-label="Acta de la orden">
      <section className="modalWindow actaWindow">
        <div className="modalHeader">
          <div>
            <h2>Acta</h2>
            <p>Edita directo sobre el documento — es la misma vista que se imprime</p>
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
        {success ? (
          <div className="processFlowCallout" style={{ color: "var(--success, #1a7f37)" }}>
            {success}
          </div>
        ) : null}

        <div className="actaDocFrame">
          <div className="opDocWrap">
            <article className="opDoc actaDoc">
              <header className="opHeader">
                <div className="opTitleBar">ORDEN DE PRODUCCIÓN</div>
                <div className="opCategoryBar">{run.process_name}</div>
                <div className="opFolio">Nº {run.production_code ?? DASH}</div>
              </header>

              <div className="opBody">
                <ActaDocSide
                  actions={
                    <EntregaAction
                      materialItems={materialItems}
                      onChanged={onChanged}
                      onSuccess={flagSuccess}
                      run={run}
                    />
                  }
                  fecha={run.materials_approved_at}
                  lines={entrega}
                  onError={flagError}
                  responsable={run.materials_approved_by_name ?? DASH}
                  title="ENTREGADO"
                  totalRows={entregaTotalRows}
                />
                <div className="opDivider" aria-hidden="true" />
                <ActaDocSide
                  fecha={run.received_at}
                  footer={<RecepcionActions onChanged={onChanged} onError={flagError} onSuccess={flagSuccess} run={run} />}
                  lines={recepcion}
                  onError={flagError}
                  responsable={run.received_by_name ?? DASH}
                  title="RECIBIDO"
                  totalRows={recepcionTotalRows}
                />
              </div>
            </article>
          </div>
        </div>
      </section>
    </div>
  );
}
