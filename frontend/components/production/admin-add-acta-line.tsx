"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Plus } from "lucide-react";
import { addAdminActaLine } from "@/lib/production-api";
import { MaterialCategoryPicker } from "@/components/production/material-category-picker";
import { listUnits } from "@/lib/units-api";
import type { InventoryItem, InventoryItemType } from "@/types/inventory";

const ADMIN_PICKER_TYPES: InventoryItemType[] = [
  "RAW_MATERIAL",
  "SUPPLY",
  "COMPLEMENT",
  "WASTE",
  "FINISHED_PRODUCT",
];

// Dos botones solo-admin en la acta: elegir un item real de inventario (mueve
// stock de inmediato, sin aprobacion) o escribir algo a mano con una unidad
// de una lista (nunca mueve stock). Botones separados, no un link dentro del
// buscador -- MaterialCategoryPicker es un modal a pantalla completa
// (position: fixed), un link renderizado como hermano suyo queda tapado por
// el overlay y nunca se ve (bug real, reportado por Rodrigo probando).
export function AdminAddActaLineControl({
  side,
  runId,
  items,
  isAdmin,
  stageAttemptId,
  onChanged,
  onError,
  onSuccess,
}: {
  side: "ENTREGA" | "RECEPCION";
  runId: string;
  items: InventoryItem[];
  isAdmin: boolean;
  // Ligada a un intento de etapa del flujo nuevo (seccion 2.3): cualquiera
  // del rol fusionado opera el acta directo, ya no es admin-only -- ese gate
  // sigue aplicando solo al boton "+" viejo (linea de nivel de orden).
  stageAttemptId?: string;
  onChanged: () => void | Promise<void>;
  onError: (message: string) => void;
  onSuccess: (message: string) => void;
}) {
  const [mode, setMode] = useState<"closed" | "search" | "manual">("closed");
  const [pendingItem, setPendingItem] = useState<InventoryItem | null>(null);
  const [quantity, setQuantity] = useState("");
  const [manualLabel, setManualLabel] = useState("");
  const [manualUnit, setManualUnit] = useState("");
  const [isSaving, setIsSaving] = useState(false);
  const [localError, setLocalError] = useState<string | null>(null);
  const { data: units = [] } = useQuery({ queryKey: ["units"], queryFn: listUnits, enabled: mode === "manual" });

  if (!isAdmin && !stageAttemptId) return null;

  function reset() {
    setMode("closed");
    setPendingItem(null);
    setQuantity("");
    setManualLabel("");
    setManualUnit("");
    setLocalError(null);
  }

  async function submitLinked() {
    if (!pendingItem || !quantity || Number(quantity) <= 0) {
      setLocalError("Elige el item y su cantidad.");
      return;
    }
    setIsSaving(true);
    try {
      await addAdminActaLine(runId, { side, item_id: pendingItem.id, quantity, stage_attempt_id: stageAttemptId });
      // Espera a que la orden este al dia ANTES de cerrar/avisar (Rodrigo,
      // 2026-08-20: la suma no se veia actualizada antes de poder finalizar
      // etapa) -- si no se espera, el usuario puede seguir de largo con
      // datos todavia viejos.
      await onChanged();
      reset();
      onSuccess("Línea agregada: se descontó/sumó del inventario real.");
    } catch (nextError) {
      const message = nextError instanceof Error ? nextError.message : "No se pudo agregar la línea.";
      setLocalError(message);
      onError(message);
    } finally {
      setIsSaving(false);
    }
  }

  async function submitManual() {
    if (!manualLabel.trim() || !quantity || Number(quantity) <= 0 || !manualUnit) {
      setLocalError("Completa detalle, cantidad y unidad.");
      return;
    }
    setIsSaving(true);
    try {
      await addAdminActaLine(runId, { side, label: manualLabel.trim(), quantity, unit_code: manualUnit, stage_attempt_id: stageAttemptId });
      await onChanged();
      reset();
      onSuccess("Línea agregada. No se descontó del inventario (es texto libre).");
    } catch (nextError) {
      const message = nextError instanceof Error ? nextError.message : "No se pudo agregar la línea.";
      setLocalError(message);
      onError(message);
    } finally {
      setIsSaving(false);
    }
  }

  if (mode === "closed") {
    return (
      <div className="actaDocAction" style={{ display: "flex", gap: 14 }}>
        <button className="actaDocAddRow" onClick={() => setMode("search")} type="button">
          <Plus aria-hidden="true" size={13} />
          Agregar
        </button>
        <button className="actaDocAddRow" onClick={() => setMode("manual")} type="button">
          Escribir a mano
        </button>
      </div>
    );
  }

  if (mode === "manual") {
    const submitOnEnter = (e: React.KeyboardEvent) => {
      if (e.key === "Enter" && !isSaving) {
        e.preventDefault();
        void submitManual();
      }
    };
    return (
      <div className="actaDocAction">
        <div className="materialRow" style={{ alignItems: "flex-start", gap: 8, marginTop: 10 }}>
          <input
            aria-label="Detalle"
            className="field"
            onChange={(e) => setManualLabel(e.target.value)}
            onKeyDown={submitOnEnter}
            placeholder="Detalle"
            style={{ flex: 1 }}
            type="text"
            value={manualLabel}
          />
          <input
            aria-label="Cantidad"
            className="field"
            min="0.0001"
            onChange={(e) => setQuantity(e.target.value)}
            onKeyDown={submitOnEnter}
            step="0.0001"
            style={{ width: 100 }}
            type="number"
            value={quantity}
          />
          <select aria-label="Unidad" className="field" onChange={(e) => setManualUnit(e.target.value)} style={{ width: 90 }} value={manualUnit}>
            <option value="">Unidad...</option>
            {units.filter((u) => u.is_active).map((u) => (
              <option key={u.id} value={u.code}>{u.label}</option>
            ))}
          </select>
          <button className="button" disabled={isSaving} onClick={reset} type="button">Cancelar</button>
          <button className="button buttonPrimary" disabled={isSaving} onClick={() => void submitManual()} type="button">Agregar</button>
        </div>
        <p className="panelText">Esta línea no descuenta del inventario real.</p>
        {localError ? <p className="panelText" style={{ color: "var(--danger, #b3261e)" }}>{localError}</p> : null}
      </div>
    );
  }

  return (
    <div className="actaDocAction">
      <MaterialCategoryPicker
        allowedTypes={ADMIN_PICKER_TYPES}
        description="Busca el item real que se pasó registrar."
        error={localError}
        items={items}
        onClose={reset}
        onDismissError={() => setLocalError(null)}
        onSelect={(item) => {
          setPendingItem(item);
          setQuantity("");
          setLocalError(null);
        }}
        quantityStep={
          pendingItem
            ? {
                confirmLabel: "Agregar y mover inventario",
                isSaving,
                item: pendingItem,
                onBack: () => {
                  setPendingItem(null);
                  setLocalError(null);
                },
                onConfirm: () => void submitLinked(),
                onQuantityChange: (value) => {
                  setQuantity(value);
                  setLocalError(null);
                },
                quantity,
              }
            : undefined
        }
        title="Agregar línea de acta"
      />
    </div>
  );
}
