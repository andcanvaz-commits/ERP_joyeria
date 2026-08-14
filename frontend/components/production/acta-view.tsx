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
function ActaDocSide({
  title,
  lines,
  fecha,
  responsable,
  onError,
  actions,
  footer,
}: {
  title: string;
  lines: ActaLine[];
  fecha: string | null;
  responsable: string;
  onError: (message: string) => void;
  actions?: React.ReactNode;
  footer?: React.ReactNode;
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

  const blankCount = Math.max(0, MIN_ROWS - lines.length);

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
                      style={{ width: 64 }}
                      type="number"
                      value={editQuantity}
                    />
                    <input
                      className="field"
                      onChange={(e) => setEditUnit(e.target.value)}
                      style={{ width: 44 }}
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
  // Igual que EntregarMaterialAction: el error tiene que aparecer en esta
  // misma ventana, no en un banner lejos de donde el usuario esta mirando.
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
// etapa. Lo que falta es el sobrante de complementos — se aprueba y se
// descuenta entero al aprobar materiales (approve_materials), pero el
// ensamble puede no haber usado todo (ej. 100 "bolas 2.5" aprobadas, 80
// ensambladas, 20 sobran) — esas se devuelven a inventario aqui.
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
  const [returningId, setReturningId] = useState<string | null>(null);
  const [quantity, setQuantity] = useState("");
  const [isSaving, setIsSaving] = useState(false);

  const returnable = returnableComplements(run);

  if (returnable.length === 0) return null;

  function startReturn(complement: Complement & { remaining: number }) {
    setReturningId(complement.id);
    setQuantity(String(complement.remaining));
  }

  async function handleReturn(complementId: string) {
    if (!quantity || Number(quantity) <= 0) {
      onError("Indica cuanto se devuelve.");
      return;
    }
    setIsSaving(true);
    try {
      await returnComplement(complementId, quantity);
      setReturningId(null);
      onChanged();
      onSuccess?.("Sobrante devuelto a inventario.");
    } catch (nextError) {
      onError(nextError instanceof Error ? nextError.message : "No se pudo devolver el sobrante.");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="actaDocAction actaDocReturns">
      <span className="actaDocActionLabel">Sobrante de complementos por devolver</span>
      {returnable.map((complement) => (
        <div className="actaDocActionForm" key={complement.id}>
          <span style={{ flex: 1, minWidth: 120 }}>
            {complement.name ?? "Complemento"} · sobran {formatGramos(complement.remaining)} {complement.unit_code}
          </span>
          {returningId === complement.id ? (
            <>
              <input
                aria-label="Cantidad a devolver"
                className="field"
                max={complement.remaining}
                min="0.0001"
                onChange={(e) => setQuantity(e.target.value)}
                step="0.0001"
                style={{ width: 90 }}
                type="number"
                value={quantity}
              />
              <button className="button" disabled={isSaving} onClick={() => setReturningId(null)} type="button">
                Cancelar
              </button>
              <button className="button buttonPrimary" disabled={isSaving} onClick={() => void handleReturn(complement.id)} type="button">
                Devolver
              </button>
            </>
          ) : (
            <button className="button" onClick={() => startReturn(complement)} type="button">
              <Undo2 aria-hidden="true" size={14} />
              Devolver sobrante
            </button>
          )}
        </div>
      ))}
    </div>
  );
}

type UsageCandidate = { key: string; item_id: string; label: string; unit_code: string; available: number };

// Materia prima ya se reconcilia sola con la merma por etapa: solo entran
// aqui complementos e insumos (lo que "se uso" sin que el sistema calcule
// automaticamente cuando). `available` es el tope real: no se puede anotar
// mas uso del que de verdad se entrego/aprobo — ya se resta lo que ya se
// registro antes en el acta para ese mismo item (por identidad real, no por
// texto: dos items distintos pueden llamarse igual).
function buildUsageCandidates(run: ProductionRun): UsageCandidate[] {
  const recepcion = (run.acta_lines ?? []).filter((line) => line.side === "RECEPCION");
  const alreadyLogged = (itemId: string) =>
    recepcion.filter((line) => line.item_id === itemId).reduce((sum, line) => sum + Number(line.quantity), 0);

  const supplies = (run.supply_consumptions ?? []).map((s) => ({
    key: `supply:${s.item_id}`,
    item_id: s.item_id,
    label: s.name,
    unit_code: s.unit_code,
    available: Number(s.quantity) - alreadyLogged(s.item_id),
  }));
  const complements = (run.complements ?? [])
    .filter((c) => c.status === "APROBADA")
    .map((c) => {
      const delivered = Number(c.quantity) - Number(c.used_quantity ?? 0) - Number(c.returned_quantity ?? 0);
      return {
        key: `complement:${c.item_id}`,
        item_id: c.item_id,
        label: c.name ?? "Complemento",
        unit_code: c.unit_code,
        available: delivered - alreadyLogged(c.item_id),
      };
    });
  return [...supplies, ...complements].filter((candidate) => candidate.available > 0.0001);
}

// Lado Recepcion, segunda accion: complementos/insumos que de verdad se
// usaron en el proceso pero el sistema no calcula automaticamente cuando
// (a diferencia de la merma de materia prima, que es automatica etapa por
// etapa). Elegis uno de la ventana y anotas la cantidad a mano — queda como
// linea MANUAL de la acta, editable/borrable despues.
function EntregarMaterialAction({
  run,
  onChanged,
  onSuccess,
}: {
  run: ProductionRun;
  onChanged: () => void;
  onSuccess: (message: string) => void;
}) {
  const [isPickerOpen, setIsPickerOpen] = useState(false);
  const [pendingItem, setPendingItem] = useState<UsageCandidate | null>(null);
  const [quantity, setQuantity] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  // Error local a esta ventana: la validacion (o el fallo de guardado) tiene
  // que aparecer aqui mismo, junto al campo que hay que corregir -- no en el
  // banner de arriba del acta, que queda fuera de la vista y no deja claro
  // que la ventana sigue abierta esperando el valor correcto.
  const [localError, setLocalError] = useState<string | null>(null);

  const candidates = buildUsageCandidates(run);
  if (candidates.length === 0) return null;

  function closePicker() {
    setIsPickerOpen(false);
    setPendingItem(null);
    setQuantity("");
    setLocalError(null);
  }

  async function handleSubmit() {
    if (!pendingItem || !quantity || Number(quantity) <= 0) {
      setLocalError("Elige que se uso y su cantidad.");
      return;
    }
    if (Number(quantity) > pendingItem.available + 0.0001) {
      setLocalError(
        `Solo hay ${formatGramos(pendingItem.available)} ${pendingItem.unit_code} de "${pendingItem.label}" sin registrar.`,
      );
      return;
    }
    setLocalError(null);
    setIsSaving(true);
    try {
      await addActaLine(run.id, {
        side: "RECEPCION",
        label: pendingItem.label,
        quantity,
        unit_code: pendingItem.unit_code,
        item_id: pendingItem.item_id,
      });
      closePicker();
      onChanged();
      onSuccess("Uso registrado en el acta.");
    } catch (nextError) {
      setLocalError(nextError instanceof Error ? nextError.message : "No se pudo registrar el uso.");
    } finally {
      setIsSaving(false);
    }
  }

  return (
    <div className="actaDocAction">
      <button className="actaDocAddRow" onClick={() => setIsPickerOpen(true)} type="button">
        <Plus aria-hidden="true" size={13} />
        Entregar material
      </button>

      {isPickerOpen ? (
        <div className="modalBackdrop modalBackdropTop" role="dialog" aria-modal="true" aria-label="Entregar material">
          <section className="modalWindow">
            <div className="modalHeader">
              <div>
                <h2>Entregar material</h2>
                <p>Complementos e insumos de esta orden que el sistema no calcula solo — elige uno y anota cuanto se uso.</p>
              </div>
              <button aria-label="Cerrar" className="iconOnlyButton" onClick={closePicker} type="button">
                <X aria-hidden="true" size={18} />
              </button>
            </div>

            {localError ? (
              <div className="processFlowCallout" style={{ color: "var(--danger, #b42318)", marginTop: 10 }}>
                {localError}
              </div>
            ) : null}

            {pendingItem ? (
              <div className="materialRow" style={{ alignItems: "flex-start", gap: 8, marginTop: 10 }}>
                <div className="field" style={{ flex: 1, display: "flex", alignItems: "center" }}>
                  {pendingItem.label} · disponible {formatGramos(pendingItem.available)} {pendingItem.unit_code}
                </div>
                <input
                  aria-label="Cantidad"
                  autoFocus
                  className="field"
                  max={pendingItem.available}
                  min="0.0001"
                  onChange={(e) => {
                    setQuantity(e.target.value);
                    setLocalError(null);
                  }}
                  placeholder={pendingItem.unit_code}
                  step="0.0001"
                  style={{ width: 110 }}
                  type="number"
                  value={quantity}
                />
                <button
                  className="button"
                  disabled={isSaving}
                  onClick={() => {
                    setPendingItem(null);
                    setQuantity("");
                    setLocalError(null);
                  }}
                  type="button"
                >
                  Elegir otro
                </button>
                <button className="button buttonPrimary" disabled={isSaving} onClick={() => void handleSubmit()} type="button">
                  Registrar
                </button>
              </div>
            ) : (
              <div className="tableWrap" style={{ marginTop: 10 }}>
                <table className="table">
                  <thead>
                    <tr>
                      <th>Material</th>
                      <th className="num">Disponible</th>
                    </tr>
                  </thead>
                  <tbody>
                    {candidates.map((item) => (
                      <tr
                        key={item.key}
                        onClick={() => {
                          setPendingItem(item);
                          setQuantity("");
                          setLocalError(null);
                        }}
                        style={{ cursor: "pointer" }}
                      >
                        <td>{item.label}</td>
                        <td className="num">{formatGramos(item.available)} {item.unit_code}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </section>
        </div>
      ) : null}
    </div>
  );
}

// Balance de materia prima: lo unico que se puede reconciliar con un simple
// resta, porque entra y sale en la MISMA unidad todo el tiempo (insumos y
// complementos son pools aparte, con sus propias unidades — no se suman
// aqui). Entregada (PLAN + material adicional aprobado de la propia materia
// prima) menos la merma de cada etapa tiene que dar el peso final recibido;
// si no da, algo quedo sin registrar.
function MateriaPrimaBalance({ run }: { run: ProductionRun }) {
  const rawMaterialId = run.raw_material_item_id;
  if (!rawMaterialId) return null;
  const lines = run.acta_lines ?? [];
  const entregada = lines
    .filter((l) => l.side === "ENTREGA" && l.item_id === rawMaterialId)
    .reduce((sum, l) => sum + Number(l.quantity), 0);
  const merma = lines
    .filter((l) => l.side === "RECEPCION" && l.item_id === rawMaterialId && l.label.startsWith("Merma etapa"))
    .reduce((sum, l) => sum + Number(l.quantity), 0);
  if (entregada <= 0) return null;
  const pesoFinalLine = lines.find(
    (l) => l.side === "RECEPCION" && l.item_id === rawMaterialId && l.label === "Peso final recibido",
  );
  const pesoFinal = pesoFinalLine ? Number(pesoFinalLine.quantity) : null;
  const esperado = entregada - merma;
  const unit = run.raw_material_unit_code;
  const diff = pesoFinal !== null ? esperado - pesoFinal : null;
  const reconciles = diff !== null && Math.abs(diff) < 0.01;

  return (
    <div className="actaBalance">
      <span className="opColSub">BALANCE DE MATERIA PRIMA</span>
      <div className="actaBalanceRow">
        <span>Entregada</span>
        <strong>{formatGramos(entregada)} {unit}</strong>
      </div>
      <div className="actaBalanceRow">
        <span>Merma</span>
        <strong>{formatGramos(merma)} {unit}</strong>
      </div>
      <div className="actaBalanceRow">
        <span>Peso final recibido</span>
        <strong>{pesoFinal !== null ? `${formatGramos(pesoFinal)} ${unit}` : "aun sin pesar"}</strong>
      </div>
      {diff !== null ? (
        <div className={`actaBalanceRow actaBalanceCheck${reconciles ? "" : " actaBalanceMismatch"}`}>
          <span>{reconciles ? "Cuadra" : "No cuadra"}</span>
          <strong>
            {reconciles
              ? `${formatGramos(esperado)} ${unit}`
              : `esperado ${formatGramos(esperado)} ${unit} · diferencia ${formatGramos(Math.abs(diff))} ${unit}`}
          </strong>
        </div>
      ) : null}
    </div>
  );
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
                />
                <div className="opDivider" aria-hidden="true" />
                <ActaDocSide
                  fecha={run.received_at}
                  footer={
                    <>
                      <RecepcionActions onChanged={onChanged} onError={flagError} onSuccess={flagSuccess} run={run} />
                      <EntregarMaterialAction onChanged={onChanged} onSuccess={flagSuccess} run={run} />
                    </>
                  }
                  lines={recepcion}
                  onError={flagError}
                  responsable={run.received_by_name ?? DASH}
                  title="RECIBIDO"
                />
              </div>

              <MateriaPrimaBalance run={run} />
            </article>
          </div>
        </div>
      </section>
    </div>
  );
}
