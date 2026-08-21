"use client";

import { useState } from "react";
import { X } from "lucide-react";
import { deleteActaLine, updateActaLine } from "@/lib/production-api";
import { buildFamilyActaSides, buildRunActaSides } from "@/lib/orden-produccion";
import { ActaSide } from "@/components/production/acta-side";
import { AdminAddActaLineControl } from "@/components/production/admin-add-acta-line";
import { ToastNotice } from "@/components/ui/toast-notice";
import type { ProductionRun } from "@/types/production";
import type { InventoryItem } from "@/types/inventory";

const DASH = "—";

export function ActaView({
  run,
  family,
  // Opcionales con default seguro: Produccion, Inventario y Solicitudes ya
  // pasan estas dos props (Task 10b las cableo en los tres). Sin ellas el
  // boton de admin simplemente no aparece (AdminAddActaLineControl ya
  // retorna null si !isAdmin) -- el default cubre cualquier llamador nuevo
  // que todavia no las pase.
  inventoryItems = [],
  isAdmin = false,
  onClose,
  onChanged,
}: {
  run: ProductionRun;
  // Las demas corridas de la misma orden (padre + hijas de split), incluida
  // esta. Con 2+ miembros reales se muestra la acta SUMADA de toda la
  // familia (igual que Documentos) en vez de solo esta corrida -- pero las
  // acciones (editar linea, agregar de admin) siguen actuando sobre `run`
  // puntualmente, la que se abrio. Sin esta prop (o con una sola corrida) el
  // comportamiento es el de siempre: acta de un run.
  family?: ProductionRun[];
  inventoryItems?: InventoryItem[];
  isAdmin?: boolean;
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
                RESPONSABLE: <span>{headerRun.created_by_name ?? DASH}</span>
              </div>

              <div className="opBody">
                <ActaSide
                  // Por fila, no en bloque: esta acta puede mezclar lineas de
                  // NIVEL DE ORDEN (solo admin puede mover ese stock) con
                  // lineas de un intento de etapa (cualquiera del rol
                  // fusionado, ver update_acta_line/delete_acta_line) -- una
                  // sola bandera para toda la vista le quitaba el lapiz a un
                  // no-admin incluso en su propia linea de etapa.
                  canEditInventoryLines={(line) => isAdmin || Boolean(line.stage_attempt_id)}
                  actions={
                    <AdminAddActaLineControl
                      isAdmin={isAdmin}
                      items={inventoryItems}
                      onChanged={onChanged}
                      onError={flagError}
                      onSuccess={flagSuccess}
                      runId={headerRun.id}
                      side="ENTREGA"
                    />
                  }
                  fecha={sides.entregaFecha}
                  lines={sides.entregaLines}
                  onDeleteLine={(lineId) => deleteActaLine(lineId).then(() => onChanged())}
                  onEditLine={(lineId, patch) => updateActaLine(lineId, patch).then(() => onChanged())}
                  onError={flagError}
                  responsable={sides.entregaResponsable}
                  title="ENTREGADO"
                  totalRows={sides.entregaTotalRows}
                />
                <div className="opDivider" aria-hidden="true" />
                <ActaSide
                  canEditInventoryLines={(line) => isAdmin || Boolean(line.stage_attempt_id)}
                  fecha={sides.recepcionFecha}
                  footer={
                    <AdminAddActaLineControl
                      isAdmin={isAdmin}
                      items={inventoryItems}
                      onChanged={onChanged}
                      onError={flagError}
                      onSuccess={flagSuccess}
                      runId={headerRun.id}
                      side="RECEPCION"
                    />
                  }
                  lines={sides.recepcionLines}
                  onDeleteLine={(lineId) => deleteActaLine(lineId).then(() => onChanged())}
                  onEditLine={(lineId, patch) => updateActaLine(lineId, patch).then(() => onChanged())}
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
