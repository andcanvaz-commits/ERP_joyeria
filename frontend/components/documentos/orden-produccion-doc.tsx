import { DocSide, DocTotalRow, OrdenProduccionModel, formatDocDate, formatGramos } from "@/lib/orden-produccion";

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
  dataClass,
  totalRows
}: {
  events: DocSide[];
  title: string;
  dataClass: string;
  totalRows?: DocTotalRow[];
}) {
  // Un solo evento (caso normal, sin split): fecha/responsable van en el
  // subtitulo de la columna, no como fila de tabla — no tiene sentido
  // "agrupar" cuando hay un solo grupo. Con 2+ eventos (split real, varios
  // responsables/fechas) cada uno se distingue con su propia fila.
  const singleEvent = events.length === 1 ? events[0] : null;
  const lines: DisplayLine[] = [];
  if (events.length > 1) {
    for (const event of events) {
      lines.push({ kind: "group", fecha: event.fecha, responsable: event.responsable });
      for (const row of event.rows) {
        lines.push({ kind: "row", row });
      }
    }
  } else if (singleEvent) {
    for (const row of singleEvent.rows) {
      lines.push({ kind: "row", row });
    }
  }
  const totals = totalRows ?? [];
  const rowCount = lines.filter((line) => line.kind === "row").length;
  const blankCount = Math.max(0, MIN_ROWS - rowCount - totals.length);

  return (
    <section className="opCol">
      <div className="opColHead">
        {title}
        {singleEvent ? (
          <span className="opColSub">
            {" "}
            · {formatDocDate(singleEvent.fecha) || "—"} · {singleEvent.responsable || DASH_RESPONSABLE}
          </span>
        ) : null}
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
          {totals.map((row, index) => (
            <tr
              className={`opSubtotalRow ${row.kind === "merma" ? "opSubtotalRowMerma" : "opSubtotalRowTotal"}`}
              key={`total-${index}`}
            >
              <td> </td>
              <td className="opTdGramos"><span className={dataClass}>{formatGramos(row.gramos)} {row.unidad}</span></td>
              <td><span className={dataClass}>{row.label}</span></td>
            </tr>
          ))}
          {Array.from({ length: blankCount }).map((_, index) => (
            <tr key={`blank-${index}`}>
              <td> </td>
              <td className="opTdGramos"> </td>
              <td> </td>
            </tr>
          ))}
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
          {model.cantidad !== null ? <span className="opCantidad">Cantidad: {model.cantidad} {model.cantidadUnidad}</span> : null}
        </div>

        <div className="opBody">
          <SideColumn dataClass="opEntregaData" events={model.entrega} title="ENTREGADO" totalRows={model.entregaTotalRows} />
          <div className="opDivider" aria-hidden="true" />
          <SideColumn dataClass="opRecepcionData" events={model.recepcion} title="RECIBIDO" totalRows={model.recepcionTotalRows} />
        </div>

        {model.cancelada ? <div className="opStamp opStampCancel">CANCELADO</div> : null}
      </article>
    </div>
  );
}
