"use client";

import { useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";
import { FileText, Printer } from "lucide-react";
import { listProductionRuns } from "@/lib/production-api";
import { listInventoryItems } from "@/lib/inventory-api";
import {
  buildItemNameMap,
  buildOrdenProduccion,
  canPrintEntrega,
  canPrintRecepcion,
  formatDocDate
} from "@/lib/orden-produccion";
import type { ProductionRun } from "@/types/production";
import type { InventoryItem } from "@/types/inventory";
import { DocMode, OrdenProduccionDoc } from "./orden-produccion-doc";

const STATUS_LABEL: Record<ProductionRun["status"], string> = {
  PENDIENTE_INVENTARIO: "Pendiente de inventario",
  MATERIALES_APROBADOS: "Materiales aprobados",
  EN_PROCESO: "En proceso",
  PENDIENTE_RECEPCION: "Pendiente de recepción",
  RECIBIDA: "Recibida",
  CANCELADA: "Cancelada"
};

export function DocumentosDashboard() {
  const [runs, setRuns] = useState<ProductionRun[]>([]);
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [printMode, setPrintMode] = useState<DocMode | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    Promise.all([listProductionRuns(), listInventoryItems("TODOS")])
      .then(([runList, itemList]) => {
        setRuns(runList);
        setItems(itemList);
      })
      .catch(() => undefined)
      .finally(() => setIsLoading(false));
  }, []);

  const itemNames = useMemo(() => buildItemNameMap(items), [items]);
  const selectedRun = runs.find((run) => run.id === selectedId) ?? null;
  const model = useMemo(
    () => (selectedRun ? buildOrdenProduccion(selectedRun, itemNames) : null),
    [selectedRun, itemNames]
  );

  useEffect(() => {
    if (!printMode) return;
    const timer = setTimeout(() => {
      window.print();
      setPrintMode(null);
    }, 60);
    return () => clearTimeout(timer);
  }, [printMode]);

  return (
    <div className="content">
      <section className="card panelBody">
        <div className="panelHeader">
          <div>
            <h2 className="panelTitle">Orden de Producción</h2>
            <p className="panelText">
              Selecciona una orden para ver e imprimir su comprobante. La entrega se imprime tras la
              aprobación de materiales y la recepción se sobreimprime en la misma hoja.
            </p>
          </div>
          <FileText aria-hidden="true" size={20} />
        </div>

        <div className="documentosLayout">
          <div className="documentosList">
            {isLoading ? <div className="emptyState">Cargando órdenes...</div> : null}
            {!isLoading && runs.length === 0 ? (
              <div className="emptyState">No hay órdenes registradas.</div>
            ) : null}
            {runs.map((run) => {
              const isSel = run.id === selectedId;
              return (
                <button
                  className={`processPicker${isSel ? " processPickerActive" : ""}`}
                  key={run.id}
                  onClick={() => setSelectedId(run.id)}
                  type="button"
                >
                  <span style={{ display: "grid", gap: 2, textAlign: "left" }}>
                    <strong style={{ color: "var(--text)", fontSize: 14 }}>
                      {run.production_code ?? "Sin folio"} · {run.process_name}
                    </strong>
                    <span>
                      {STATUS_LABEL[run.status]}
                      {run.received_at ? ` · Recibida ${formatDocDate(run.received_at)}` : ""}
                    </span>
                  </span>
                </button>
              );
            })}
          </div>

          <div className="documentosPreview">
            {model && selectedRun ? (
              <>
                <div className="documentosActions">
                  <button
                    className="button"
                    disabled={!canPrintEntrega(selectedRun)}
                    onClick={() => setPrintMode("entrega")}
                    type="button"
                  >
                    <Printer aria-hidden="true" size={16} />
                    Imprimir entrega
                  </button>
                  <button
                    className="button"
                    disabled={!canPrintRecepcion(selectedRun)}
                    onClick={() => setPrintMode("recepcion")}
                    type="button"
                  >
                    <Printer aria-hidden="true" size={16} />
                    Imprimir recepción
                  </button>
                  <button
                    className="button buttonPrimary"
                    disabled={!canPrintRecepcion(selectedRun)}
                    onClick={() => setPrintMode("completo")}
                    type="button"
                  >
                    <Printer aria-hidden="true" size={16} />
                    Imprimir completo
                  </button>
                </div>
                <div className="documentosPreviewFrame">
                  <OrdenProduccionDoc model={model} mode="completo" />
                </div>
              </>
            ) : (
              <div className="emptyState">Selecciona una orden para ver su comprobante.</div>
            )}
          </div>
        </div>
      </section>

      {printMode && model
        ? createPortal(
            <div className="printArea">
              <OrdenProduccionDoc model={model} mode={printMode} />
            </div>,
            document.body
          )
        : null}
    </div>
  );
}
