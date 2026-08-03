import { Eye } from "lucide-react";
import type { ProductionRun } from "@/types/production";
import { runCurrentStage, runCurrentWaste, runCurrentWeight } from "@/lib/production-run-helpers";

function numText(value: string | number | null | undefined): string {
  if (value === null || value === undefined || value === "") return "0";
  const number = Number(value);
  return Number.isFinite(number) ? number.toLocaleString("es-EC", { maximumFractionDigits: 4 }) : String(value);
}

function dateLabel(value: string | null | undefined): string {
  if (!value) return "—";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "—";
  return date.toLocaleString("es-EC", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" });
}

/** Encabezado de la tabla "productos en proceso" compartido entre inventario
 * y produccion. `withManage` agrega la columna de accion "Gestionar". */
export function WorkInProgressTableHead() {
  return (
    <tr>
      <th>Orden</th>
      <th>Folio raíz</th>
      <th>Proceso</th>
      <th className="num">Cantidad</th>
      <th className="num">Peso actual</th>
      <th className="num">Merma actual</th>
      <th>Etapa actual</th>
      <th>Fecha de inicio</th>
      <th aria-label="Acciones" />
    </tr>
  );
}

export const WORK_IN_PROGRESS_COLUMN_COUNT = 9;

/** Fila de una orden en proceso, misma info en inventario y produccion.
 * `onWasteHistory`/`onStageInfo` habilitan los popovers de detalle (solo
 * inventario los usa hoy); `onManage` agrega el boton de gestion (solo
 * produccion, que es quien puede operar la orden). */
export function WorkInProgressRunRow({
  run,
  onView,
  onWasteHistory,
  onStageInfo,
  onManage
}: {
  run: ProductionRun;
  onView: (run: ProductionRun) => void;
  onWasteHistory?: (run: ProductionRun) => void;
  onStageInfo?: (run: ProductionRun) => void;
  onManage?: (run: ProductionRun) => void;
}) {
  const currentStage = runCurrentStage(run);
  const currentWaste = runCurrentWaste(run);
  const rootCode = run.root_production_code && run.root_production_code !== run.production_code
    ? run.root_production_code
    : null;

  return (
    <tr>
      <td>{run.production_code ? <span className="orderCodeTag">{run.production_code}</span> : "—"}</td>
      <td>{rootCode ? <span className="rootBadgeTag">de {rootCode}</span> : "—"}</td>
      <td>{run.process_name}</td>
      <td className="num">{numText(run.quantity)} und</td>
      <td className="num">{numText(runCurrentWeight(run))} {run.raw_material_unit_code}</td>
      <td className="num">
        {onWasteHistory ? (
          <button className="iconTextButton" onClick={() => onWasteHistory(run)} title="Ver merma por fase" type="button">
            {numText(String(currentWaste))} {run.raw_material_unit_code}
          </button>
        ) : (
          <>{numText(String(currentWaste))} {run.raw_material_unit_code}</>
        )}
      </td>
      <td>
        {currentStage ? (
          onStageInfo ? (
            <button className="iconTextButton" onClick={() => onStageInfo(run)} title="Ver quien avanzo a esta etapa" type="button">
              {currentStage.stage_name} ({currentStage.stage_order}/{run.stages.length})
            </button>
          ) : (
            <>{currentStage.stage_name} ({currentStage.stage_order}/{run.stages.length})</>
          )
        ) : (
          "—"
        )}
      </td>
      <td>
        {dateLabel(run.started_at)}
        {run.started_by_name ? <><br /><small>Inició: {run.started_by_name}</small></> : null}
      </td>
      <td>
        <div className="rowActions">
          <button aria-label="Visualizar" className="iconOnlyButton" onClick={() => onView(run)} title="Visualizar" type="button">
            <Eye aria-hidden="true" size={15} />
          </button>
          {onManage ? (
            <button className="button buttonPrimary" onClick={() => onManage(run)} type="button">
              Gestionar
            </button>
          ) : null}
        </div>
      </td>
    </tr>
  );
}
