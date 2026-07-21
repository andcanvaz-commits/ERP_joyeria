import { DocSide, OrdenProduccionModel, formatDocDate, formatGramos } from "@/lib/orden-produccion";

export type DocMode = "entrega" | "recepcion" | "completo";

const MIN_ROWS = 5;

function SideColumn({
  side,
  title,
  dataClass
}: {
  side: DocSide;
  title: string;
  dataClass: string;
}) {
  const rows: (typeof side.rows[number] | null)[] = [...side.rows];
  while (rows.length < MIN_ROWS) rows.push(null);

  return (
    <section className="opCol">
      <div className="opColHead">{title}</div>
      <div className="opColMeta">
        <span>
          Fecha: <strong className={dataClass}>{formatDocDate(side.fecha) || " "}</strong>
        </span>
        <span>
          Responsable Inventario: <strong className={dataClass}>{side.responsable}</strong>
        </span>
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
          {rows.map((row, index) => (
            <tr key={index}>
              <td>{row && index === 0 ? <span className={dataClass}>{formatDocDate(side.fecha)}</span> : " "}</td>
              <td className="opTdGramos">{row ? <span className={dataClass}>{formatGramos(row.gramos)} {row.unidad}</span> : " "}</td>
              <td>{row ? <span className={dataClass}>{row.detalle}</span> : " "}</td>
            </tr>
          ))}
          <tr className="opSubtotalRow">
            <td />
            <td className="opTdGramos">
              <span className={dataClass}>{formatGramos(side.total)} {side.totalUnidad}</span>
            </td>
            <td>Subtotal</td>
          </tr>
        </tbody>
      </table>
      <div className="opTotal">
        TOTAL: <span className={dataClass}>{formatGramos(side.total)} {side.totalUnidad}</span>
      </div>
    </section>
  );
}

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
          <span className="opCantidad">Cantidad: {model.cantidad}</span>
        </div>

        <div className="opBody">
          <SideColumn side={model.entrega} title="ENTREGADO" dataClass="opEntregaData" />
          <div className="opDivider" aria-hidden="true" />
          <SideColumn side={model.recepcion} title="RECIBIDO" dataClass="opRecepcionData" />
        </div>

        {model.cancelada ? <div className="opStamp opStampCancel">CANCELADO</div> : null}
      </article>
    </div>
  );
}
