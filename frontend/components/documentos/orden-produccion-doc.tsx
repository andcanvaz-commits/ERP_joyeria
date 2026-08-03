import { DocSide, OrdenProduccionModel, formatDocDate, formatGramos } from "@/lib/orden-produccion";

export type DocMode = "entrega" | "recepcion" | "completo";

const MIN_ROWS = 5;
const DASH_RESPONSABLE = "—";

type DisplayRow = { gramos: number; unidad: string; detalle: string } | null;
type DisplayLine =
  | { kind: "group"; fecha: string | null; responsable: string }
  | { kind: "row"; row: DisplayRow };

function SideColumn({
  events,
  title,
  dataClass
}: {
  events: DocSide[];
  title: string;
  dataClass: string;
}) {
  const lines: DisplayLine[] = [];
  for (const event of events) {
    lines.push({ kind: "group", fecha: event.fecha, responsable: event.responsable });
    for (const row of event.rows) {
      lines.push({ kind: "row", row });
    }
  }
  const rowCount = lines.filter((line) => line.kind === "row").length;
  for (let i = rowCount; i < MIN_ROWS; i += 1) {
    lines.push({ kind: "row", row: null });
  }
  if (events.length === 0) {
    lines.push({ kind: "group", fecha: null, responsable: DASH_RESPONSABLE });
    for (let i = 0; i < MIN_ROWS; i += 1) lines.push({ kind: "row", row: null });
  }

  return (
    <section className="opCol">
      <div className="opColHead">{title}</div>
      <table className="opTable">
        <thead>
          <tr>
            <th className="opThFecha">FECHA</th>
            <th className="opThGramos">CANTIDAD</th>
            <th>DETALLES</th>
          </tr>
        </thead>
        <tbody>
          {lines.map((line, index) =>
            line.kind === "group" ? (
              <tr className="opGroupRow" key={`group-${index}`}>
                <td colSpan={3}>
                  <span className={dataClass}>
                    {formatDocDate(line.fecha) || " "} · Responsable Inventario: {line.responsable}
                  </span>
                </td>
              </tr>
            ) : (
              <tr key={`row-${index}`}>
                <td> </td>
                <td className="opTdGramos">{line.row ? <span className={dataClass}>{formatGramos(line.row.gramos)} {line.row.unidad}</span> : " "}</td>
                <td>{line.row ? <span className={dataClass}>{line.row.detalle}</span> : " "}</td>
              </tr>
            )
          )}
        </tbody>
      </table>
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
          <SideColumn events={model.entrega} title="ENTREGADO" dataClass="opEntregaData" />
          <div className="opDivider" aria-hidden="true" />
          <SideColumn events={model.recepcion} title="RECIBIDO" dataClass="opRecepcionData" />
        </div>

        {model.cancelada ? <div className="opStamp opStampCancel">CANCELADO</div> : null}
      </article>
    </div>
  );
}
