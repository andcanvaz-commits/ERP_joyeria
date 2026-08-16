import { ActaSide } from "@/components/production/acta-side";
import { OrdenProduccionModel } from "@/lib/orden-produccion";

export type DocMode = "entrega" | "recepcion" | "completo";

// Mismo componente que Ver Acta (components/production/acta-side.tsx): antes
// este documento tenia su propio SideColumn, calculaba las filas distinto y
// se desincronizaba de Ver Acta cada vez que se agregaba un aviso/fase nuevo
// (bug reportado varias veces). dataClass sigue siendo lo unico especifico de
// impresion (visibilidad selectiva por opMode-entrega/opMode-recepcion, ver
// globals.css) -- Ver Acta no lo usa porque no imprime por seccion.
export function OrdenProduccionDoc({
  model,
  mode
}: {
  model: OrdenProduccionModel;
  mode: DocMode;
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
          RESPONSABLE PRODUCCIÓN: <span>{model.responsableProduccion}</span>
        </div>

        <div className="opBody">
          <ActaSide
            dataClass="opEntregaData"
            fecha={model.entregaFecha}
            lines={model.entregaLines}
            responsable={model.entregaResponsable}
            title="ENTREGADO"
            totalRows={model.entregaTotalRows}
          />
          <div className="opDivider" aria-hidden="true" />
          <ActaSide
            dataClass="opRecepcionData"
            fecha={model.recepcionFecha}
            lines={model.recepcionLines}
            responsable={model.recepcionResponsable}
            title="RECIBIDO"
            totalRows={model.recepcionTotalRows}
          />
        </div>

        {model.cancelada ? <div className="opStamp opStampCancel">CANCELADO</div> : null}
      </article>
    </div>
  );
}
