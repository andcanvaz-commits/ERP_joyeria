import { ActaSide } from "@/components/production/acta-side";
import { OrdenProduccionModel } from "@/lib/orden-produccion";

export type DocMode = "entrega" | "recepcion" | "completo";

// Mismo componente que Ver Acta (components/production/acta-side.tsx): antes
// este documento tenia su propio SideColumn, calculaba las filas distinto y
// se desincronizaba de Ver Acta cada vez que se agregaba un aviso/fase nuevo
// (bug reportado varias veces). dataClass sigue siendo lo unico especifico de
// impresion (visibilidad selectiva por opMode-entrega/opMode-recepcion, ver
// globals.css) -- Ver Acta no lo usa porque no imprime por seccion.
// entregaActions/recepcionFooter/onEditLine/onDeleteLine/onError: opcionales,
// solo la vista interactiva de Documentos los pasa (el boton de admin y la
// edicion de sus lineas) -- el portal que imprime de verdad
// (mode=printingMode) nunca los pasa, para que no salga nada de eso en el
// papel.
export function OrdenProduccionDoc({
  model,
  mode,
  entregaActions,
  recepcionFooter,
  recepcionPendingRow,
  onEditLine,
  onDeleteLine,
  onError,
}: {
  model: OrdenProduccionModel;
  mode: DocMode;
  entregaActions?: React.ReactNode;
  recepcionFooter?: React.ReactNode;
  // Fila extra en RECIBIDO para cargar la cantidad real del producto
  // resultante antes de finalizar la etapa (produccion-dashboard.tsx, etapa
  // en curso) -- Documentos nunca la pasa, ahi no hay nada pendiente que
  // cargar.
  recepcionPendingRow?: {
    label: string;
    quantity: string;
    onQuantityChange: (value: string) => void;
    disabled?: boolean;
  };
  onEditLine?: (lineId: string, patch: { label?: string; quantity: string; unit_code?: string }) => Promise<unknown> | void;
  onDeleteLine?: (lineId: string) => Promise<unknown> | void;
  onError?: (message: string) => void;
}) {
  return (
    <div className={`opDocWrap opMode-${mode}`}>
      <article className="opDoc">
        <header className="opHeader">
          <div className="opTitleBar">ORDEN DE PRODUCCIÓN</div>
          <div className="opCategoryBar">{model.categoria}</div>
          <div className="opFolio">Nº {model.folio}</div>
        </header>

        <div className="opResponsable">
          NOMBRE: <span>{model.procesoNombre}</span>
        </div>
        <div className="opResponsable">
          RESPONSABLE: <span>{model.responsableProduccion}</span>
        </div>

        <div className="opBody">
          <ActaSide
            actions={entregaActions}
            dataClass="opEntregaData"
            fecha={model.entregaFecha}
            lines={model.entregaLines}
            onDeleteLine={onDeleteLine}
            onEditLine={onEditLine}
            onError={onError}
            responsable={model.entregaResponsable}
            title="ENTREGADO"
            totalRows={model.entregaTotalRows}
          />
          <div className="opDivider" aria-hidden="true" />
          <ActaSide
            dataClass="opRecepcionData"
            fecha={model.recepcionFecha}
            footer={recepcionFooter}
            lines={model.recepcionLines}
            onDeleteLine={onDeleteLine}
            onEditLine={onEditLine}
            onError={onError}
            pendingRow={recepcionPendingRow}
            responsable={model.recepcionResponsable}
            title="RECIBIDO"
            totalRows={model.recepcionTotalRows}
          />
        </div>

        {model.cancelada ? <div className="opStamp opStampCancel">CANCELADO</div> : null}
        {model.rechazada ? <div className="opStamp opStampReject">RECHAZADO POR CONTROL DE CALIDAD</div> : null}
      </article>
    </div>
  );
}
