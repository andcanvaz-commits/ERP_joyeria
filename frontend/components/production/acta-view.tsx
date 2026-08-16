"use client";

import { useState } from "react";
import { Plus, Undo2, X } from "lucide-react";
import { addActaLine, deleteActaLine, requestAdditionalMaterial, returnComplement, updateActaLine } from "@/lib/production-api";
import { buildFamilyActaSides, buildRunActaSides, formatGramos } from "@/lib/orden-produccion";
import { ActaSide } from "@/components/production/acta-side";
import { MaterialCategoryPicker } from "@/components/production/material-category-picker";
import { ToastNotice } from "@/components/ui/toast-notice";
import type { ProductionRun } from "@/types/production";
import type { InventoryItem } from "@/types/inventory";

const DASH = "—";

type Complement = NonNullable<ProductionRun["complements"]>[number];

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
        <div className="toastStack" aria-live="polite" style={{ marginTop: 10 }}>
          <ToastNotice kind="error" message={localError} onClose={() => setLocalError(null)} compact />
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

export function ActaView({
  run,
  family,
  materialItems,
  onClose,
  onChanged,
}: {
  run: ProductionRun;
  // Las demas corridas de la misma orden (padre + hijas de split), incluida
  // esta. Con 2+ miembros reales se muestra la acta SUMADA de toda la
  // familia (igual que Documentos) en vez de solo esta corrida -- pero las
  // acciones (solicitar material, devolver sobrante, editar linea) siguen
  // actuando sobre `run` puntualmente, la que se abrio. Sin esta prop (o con
  // una sola corrida) el comportamiento es el de siempre: acta de un run.
  family?: ProductionRun[];
  materialItems: InventoryItem[];
  onClose: () => void;
  onChanged: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);
  // Misma funcion que arma la acta para Documentos cuando la orden no esta
  // partida (buildOrdenProduccion en lib/orden-produccion.ts) -- una sola
  // fuente para las dos vistas, no dos calculos que puedan divergir. Con
  // split real (2+ miembros en `family`) se usa la version sumada, tambien
  // compartida con Documentos.
  const isSplitFamily = (family?.length ?? 1) > 1;
  const sides = isSplitFamily ? buildFamilyActaSides(family as ProductionRun[]) : buildRunActaSides(run);
  // Con familia dividida el encabezado es el de la RAIZ (folio compartido,
  // ej. "OP-2026-0042" en vez de "-B"): es una sola acta para toda la orden,
  // sin importar desde cual pierna se abrio.
  const headerRun = isSplitFamily ? (family as ProductionRun[]).find((r) => !r.parent_run_id) ?? run : run;

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

        {error || success ? (
          <div className="toastStack" aria-live="polite" aria-atomic="true">
            {error ? <ToastNotice key={error} kind="error" message={error} onClose={() => setError(null)} compact /> : null}
            {success ? <ToastNotice key={success} kind="success" message={success} onClose={() => setSuccess(null)} compact /> : null}
          </div>
        ) : null}

        <div className="actaDocFrame">
          <div className="opDocWrap">
            <article className="opDoc actaDoc">
              <header className="opHeader">
                <div className="opTitleBar">ORDEN DE PRODUCCIÓN</div>
                <div className="opCategoryBar">{headerRun.process_name}</div>
                <div className="opFolio">Nº {headerRun.root_production_code ?? headerRun.production_code ?? DASH}</div>
              </header>

              <div className="opResponsable">
                RESPONSABLE PRODUCCIÓN: <span>{headerRun.created_by_name ?? DASH}</span>
              </div>

              <div className="opBody">
                <ActaSide
                  actions={
                    <EntregaAction
                      materialItems={materialItems}
                      onChanged={onChanged}
                      onSuccess={flagSuccess}
                      run={run}
                    />
                  }
                  fecha={sides.entregaFecha}
                  lines={sides.entregaLines}
                  onDeleteLine={(lineId) => deleteActaLine(lineId)}
                  onEditLine={(lineId, patch) => updateActaLine(lineId, patch)}
                  onError={flagError}
                  responsable={sides.entregaResponsable}
                  title="ENTREGADO"
                  totalRows={sides.entregaTotalRows}
                />
                <div className="opDivider" aria-hidden="true" />
                <ActaSide
                  fecha={sides.recepcionFecha}
                  footer={<RecepcionActions onChanged={onChanged} onError={flagError} onSuccess={flagSuccess} run={run} />}
                  lines={sides.recepcionLines}
                  onDeleteLine={(lineId) => deleteActaLine(lineId)}
                  onEditLine={(lineId, patch) => updateActaLine(lineId, patch)}
                  onError={flagError}
                  responsable={sides.recepcionResponsable}
                  title="RECIBIDO"
                  totalRows={sides.recepcionTotalRows}
                />
              </div>
            </article>
          </div>
        </div>
      </section>
    </div>
  );
}
