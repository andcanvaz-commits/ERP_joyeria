"use client";

import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Boxes, ListChecks, Package } from "lucide-react";
import { getInventorySummary, listInventoryItems, listInventoryMovements } from "@/lib/inventory-api";
import type { InventoryItem, InventoryMovement } from "@/types/inventory";
import { Pager, usePagination } from "@/components/shared/pager";
import { useCountUp } from "@/hooks/use-count-up";

const REPORT_PAGE_SIZE = 12;

const MOVEMENT_LABELS: Record<string, string> = {
  ENTRADA: "Entrada",
  SALIDA: "Salida",
  AJUSTE_POSITIVO: "Ajuste positivo",
  AJUSTE_NEGATIVO: "Ajuste negativo",
  CONSUMO_PRODUCCION: "Consumo produccion",
  INGRESO_PRODUCCION: "Ingreso produccion",
  MERMA: "Merma",
  CONVERSION_SALIDA: "Conversion salida",
  CONVERSION_ENTRADA: "Conversion entrada",
};

// Movimientos que representan ingreso de producto terminado (produccion del mes).
const PRODUCTION_IN = new Set(["ENTRADA", "INGRESO_PRODUCCION"]);

function num(value: string | number | null) {
  if (value === null || value === "") return "0";
  const n = Number(value);
  return Number.isFinite(n) ? n.toLocaleString("es-EC", { maximumFractionDigits: 4 }) : String(value);
}

function monthKey(iso: string) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function monthLabel(key: string) {
  if (!key) return "-";
  const [y, m] = key.split("-").map(Number);
  return new Date(y, m - 1, 1).toLocaleDateString("es-EC", { month: "long", year: "numeric" });
}

function dateLabel(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Sin fecha";
  return date.toLocaleDateString("es-EC", { day: "2-digit", month: "short", year: "numeric" });
}

async function fetchInventoryReportsBundle() {
  const [summary, items, movements] = await Promise.all([
    getInventorySummary(),
    listInventoryItems(),
    listInventoryMovements(),
  ]);
  return { summary, items, movements };
}

export function InventoryReports() {
  const { data, isLoading, error: queryError } = useQuery({
    queryKey: ["inventory-reports"],
    queryFn: fetchInventoryReportsBundle,
  });

  const items: InventoryItem[] = data?.items ?? [];
  const movements: InventoryMovement[] = data?.movements ?? [];
  const error = queryError instanceof Error ? queryError.message : queryError ? "No se pudieron cargar los reportes." : null;

  const itemsById = useMemo(() => new Map(items.map((it) => [it.id, it])), [items]);

  // Meses disponibles a partir de las fechas de los movimientos (desc).
  const months = useMemo(() => {
    const set = new Set<string>();
    for (const m of movements) {
      const k = monthKey(m.created_at);
      if (k) set.add(k);
    }
    return [...set].sort((a, b) => b.localeCompare(a));
  }, [movements]);

  const [selectedMonth, setSelectedMonth] = useState<string>("");
  const activeMonth = selectedMonth || months[0] || "";

  const monthMovements = useMemo(
    () =>
      movements
        .filter((m) => monthKey(m.created_at) === activeMonth)
        .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()),
    [movements, activeMonth],
  );

  // Ingreso de producto terminado en el mes.
  const finishedIn = useMemo(
    () =>
      monthMovements.filter(
        (m) => m.item.item_type === "FINISHED_PRODUCT" && PRODUCTION_IN.has(m.movement_type),
      ),
    [monthMovements],
  );

  const byCategory = useMemo(() => {
    const map = new Map<string, { subtipos: Set<string>; cantidad: number }>();
    for (const m of finishedIn) {
      const cur = map.get(m.item.name) ?? { subtipos: new Set<string>(), cantidad: 0 };
      cur.subtipos.add(m.item_id);
      cur.cantidad += Number(m.quantity) || 0;
      map.set(m.item.name, cur);
    }
    return [...map.entries()]
      .map(([name, v]) => ({ name, subtipos: v.subtipos.size, cantidad: v.cantidad }))
      .sort((a, b) => b.cantidad - a.cantidad);
  }, [finishedIn]);

  const byLey = useMemo(() => {
    const map = new Map<string, { productos: Set<string>; cantidad: number }>();
    for (const m of finishedIn) {
      const k = itemsById.get(m.item_id)?.purity ?? "Sin ley";
      const cur = map.get(k) ?? { productos: new Set<string>(), cantidad: 0 };
      cur.productos.add(m.item_id);
      cur.cantidad += Number(m.quantity) || 0;
      map.set(k, cur);
    }
    return [...map.entries()]
      .map(([ley, v]) => ({ ley, productos: v.productos.size, cantidad: v.cantidad }))
      .sort((a, b) => b.cantidad - a.cantidad);
  }, [finishedIn, itemsById]);

  const totalProducido = useMemo(
    () => finishedIn.reduce((acc, m) => acc + (Number(m.quantity) || 0), 0),
    [finishedIn],
  );

  // Solo se anima lo que es un conteo entero; "Producido (g)" es un peso
  // decimal y useCountUp redondea, asi que queda sin animar (num() ya lo
  // formatea con su precision real).
  const productsInCount = useCountUp(new Set(finishedIn.map((m) => m.item_id)).size);
  const monthMovementsCount = useCountUp(monthMovements.length);

  const byCategoryPager = usePagination(byCategory, REPORT_PAGE_SIZE, activeMonth);
  const byLeyPager = usePagination(byLey, REPORT_PAGE_SIZE, activeMonth);
  const kardexPager = usePagination(monthMovements, REPORT_PAGE_SIZE, activeMonth);

  return (
    <div className="content">
      {error ? <div className="alert alertError">{error}</div> : null}

      <div className="pageHeader">
        <p style={{ margin: 0, maxWidth: 740 }}>
          Reportes de inventario y producción. Los datos cambian según el mes seleccionado.
        </p>
        <div className="actions">
          <label className="fieldGroup" style={{ minWidth: 220 }}>
            <span>Periodo</span>
            <select className="field" disabled={months.length === 0} onChange={(e) => setSelectedMonth(e.target.value)} value={activeMonth}>
              {months.length === 0 ? <option value="">Sin datos</option> : null}
              {months.map((month) => (
                <option key={month} value={month}>{monthLabel(month)}</option>
              ))}
            </select>
          </label>
        </div>
      </div>

      <section className="summaryGrid" aria-label="Resumen del mes">
        <article className="card metric kpiCard">
          <Package aria-hidden="true" size={22} />
          <span className="metricLabel">Productos con ingreso</span>
          <strong className="metricValue">{productsInCount}</strong>
        </article>
        <article className="card metric kpiCard">
          <Boxes aria-hidden="true" size={22} />
          <span className="metricLabel">Producido (g)</span>
          <strong className="metricValue">{num(totalProducido)}</strong>
        </article>
        <article className="card metric kpiCard">
          <ListChecks aria-hidden="true" size={22} />
          <span className="metricLabel">Movimientos del mes</span>
          <strong className="metricValue">{monthMovementsCount}</strong>
        </article>
      </section>

      <section className="card panelBody">
        <div className="panelHeader">
          <div>
            <h2 className="panelTitle">Producción por producto</h2>
            <p className="panelText">Subtipos y cantidad producida en {monthLabel(activeMonth)}</p>
          </div>
        </div>
        <div className="tableWrap">
          <table className="table">
            <thead>
              <tr>
                <th>Producto</th>
                <th className="num">Subtipos</th>
                <th className="num">Producido (g)</th>
              </tr>
            </thead>
            <tbody>
              {byCategoryPager.pageItems.map((row) => (
                <tr key={row.name}>
                  <td>{row.name}</td>
                  <td className="num">{row.subtipos}</td>
                  <td className="num">{num(row.cantidad)}</td>
                </tr>
              ))}
              {!isLoading && byCategory.length === 0 ? (
                <tr><td colSpan={3}><div className="emptyState">Sin producción en este mes.</div></td></tr>
              ) : null}
            </tbody>
          </table>
          <Pager {...byCategoryPager} />
        </div>
      </section>

      <section className="card panelBody">
        <div className="panelHeader">
          <div>
            <h2 className="panelTitle">Producción por ley</h2>
            <p className="panelText">Productos y cantidad por ley/pureza en {monthLabel(activeMonth)}</p>
          </div>
        </div>
        <div className="tableWrap">
          <table className="table">
            <thead>
              <tr>
                <th>Ley / pureza</th>
                <th className="num">Productos</th>
                <th className="num">Producido (g)</th>
              </tr>
            </thead>
            <tbody>
              {byLeyPager.pageItems.map((row) => (
                <tr key={row.ley}>
                  <td>{row.ley}</td>
                  <td className="num">{row.productos}</td>
                  <td className="num">{num(row.cantidad)}</td>
                </tr>
              ))}
              {!isLoading && byLey.length === 0 ? (
                <tr><td colSpan={3}><div className="emptyState">Sin producción en este mes.</div></td></tr>
              ) : null}
            </tbody>
          </table>
          <Pager {...byLeyPager} />
        </div>
      </section>

      <section className="card panelBody">
        <div className="panelHeader">
          <div>
            <h2 className="panelTitle">Kardex de movimientos</h2>
            <p className="panelText">{monthMovements.length} movimientos en {monthLabel(activeMonth)}</p>
          </div>
        </div>
        <div className="tableWrap">
          <table className="table">
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Item</th>
                <th>Tipo</th>
                <th className="num">Cantidad</th>
                <th>Unidad</th>
                <th>Lote</th>
                <th>Usuario</th>
              </tr>
            </thead>
            <tbody>
              {kardexPager.pageItems.map((movement) => (
                <tr key={movement.id}>
                  <td>{dateLabel(movement.created_at)}</td>
                  <td>{movement.item.name}</td>
                  <td>{MOVEMENT_LABELS[movement.movement_type] ?? movement.movement_type}</td>
                  <td className="num">{num(movement.quantity)}</td>
                  <td>{movement.unit_code}</td>
                  <td>{movement.lot_code ?? "-"}</td>
                  <td>{movement.created_by_name ?? "-"}</td>
                </tr>
              ))}
              {!isLoading && monthMovements.length === 0 ? (
                <tr>
                  <td colSpan={7}>
                    <div className="emptyState">No hay movimientos en este mes.</div>
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
          <Pager {...kardexPager} />
        </div>
      </section>
    </div>
  );
}
