"use client";

import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Boxes, ListChecks, Package } from "lucide-react";
import { getInventorySummary, listInventoryItems, listInventoryMovements } from "@/lib/inventory-api";
import type { InventoryItem, InventoryMovement, InventorySummary } from "@/types/inventory";

const MOVEMENT_LABELS: Record<string, string> = {
  ENTRADA: "Entrada",
  SALIDA: "Salida",
  AJUSTE_POSITIVO: "Ajuste positivo",
  AJUSTE_NEGATIVO: "Ajuste negativo",
  CONSUMO_PRODUCCION: "Consumo produccion",
  INGRESO_PRODUCCION: "Ingreso produccion",
  MERMA: "Merma",
};

function num(value: string | number | null) {
  if (value === null || value === "") return "0";
  const n = Number(value);
  return Number.isFinite(n) ? n.toLocaleString("es-EC", { maximumFractionDigits: 4 }) : String(value);
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

  const summary: InventorySummary | null = data?.summary ?? null;
  const items: InventoryItem[] = data?.items ?? [];
  const movements: InventoryMovement[] = data?.movements ?? [];
  const error = queryError instanceof Error ? queryError.message : queryError ? "No se pudieron cargar los reportes." : null;

  const finished = useMemo(
    () => items.filter((item) => item.item_type === "FINISHED_PRODUCT"),
    [items],
  );

  // Producción por categoría de producto (nombre): cuántos subtipos y stock total.
  const byCategory = useMemo(() => {
    const map = new Map<string, { subtipos: number; stock: number }>();
    for (const it of finished) {
      const cur = map.get(it.name) ?? { subtipos: 0, stock: 0 };
      cur.subtipos += 1;
      cur.stock += Number(it.current_stock) || 0;
      map.set(it.name, cur);
    }
    return [...map.entries()].sort((a, b) => b[1].stock - a[1].stock);
  }, [finished]);

  // Producción por ley / pureza.
  const byLey = useMemo(() => {
    const map = new Map<string, { productos: number; stock: number }>();
    for (const it of finished) {
      const k = it.purity ?? "Sin ley";
      const cur = map.get(k) ?? { productos: 0, stock: 0 };
      cur.productos += 1;
      cur.stock += Number(it.current_stock) || 0;
      map.set(k, cur);
    }
    return [...map.entries()].sort((a, b) => b[1].stock - a[1].stock);
  }, [finished]);

  const totalFinishedStock = useMemo(
    () => finished.reduce((acc, it) => acc + (Number(it.current_stock) || 0), 0),
    [finished],
  );

  const sortedMovements = useMemo(
    () => [...movements].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()),
    [movements],
  );

  return (
    <div className="content">
      {error ? <div className="alert alertError">{error}</div> : null}

      <section className="summaryGrid" aria-label="Resumen">
        <article className="card metric">
          <Package aria-hidden="true" size={22} />
          <span className="metricLabel">Productos terminados</span>
          <strong className="metricValue">{finished.length}</strong>
        </article>
        <article className="card metric">
          <Boxes aria-hidden="true" size={22} />
          <span className="metricLabel">Stock terminado (g)</span>
          <strong className="metricValue">{num(totalFinishedStock)}</strong>
        </article>
        <article className="card metric">
          <ListChecks aria-hidden="true" size={22} />
          <span className="metricLabel">Movimientos</span>
          <strong className="metricValue">{movements.length}</strong>
        </article>
      </section>

      <section className="card panelBody">
        <div className="panelHeader">
          <div>
            <h2 className="panelTitle">Producción por producto</h2>
            <p className="panelText">Subtipos y stock por categoría de producto terminado</p>
          </div>
        </div>
        <div className="tableWrap tableScroll">
          <table className="table">
            <thead>
              <tr>
                <th>Producto</th>
                <th className="num">Subtipos</th>
                <th className="num">Stock total (g)</th>
              </tr>
            </thead>
            <tbody>
              {byCategory.map(([name, agg]) => (
                <tr key={name}>
                  <td>{name}</td>
                  <td className="num">{agg.subtipos}</td>
                  <td className="num">{num(agg.stock)}</td>
                </tr>
              ))}
              {!isLoading && byCategory.length === 0 ? (
                <tr><td colSpan={3}><div className="emptyState">No hay producción registrada.</div></td></tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card panelBody">
        <div className="panelHeader">
          <div>
            <h2 className="panelTitle">Producción por ley</h2>
            <p className="panelText">Productos y stock por ley/pureza</p>
          </div>
        </div>
        <div className="tableWrap tableScroll">
          <table className="table">
            <thead>
              <tr>
                <th>Ley / pureza</th>
                <th className="num">Productos</th>
                <th className="num">Stock total (g)</th>
              </tr>
            </thead>
            <tbody>
              {byLey.map(([ley, agg]) => (
                <tr key={ley}>
                  <td>{ley}</td>
                  <td className="num">{agg.productos}</td>
                  <td className="num">{num(agg.stock)}</td>
                </tr>
              ))}
              {!isLoading && byLey.length === 0 ? (
                <tr><td colSpan={3}><div className="emptyState">No hay producción registrada.</div></td></tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card panelBody">
        <div className="panelHeader">
          <div>
            <h2 className="panelTitle">Kardex de movimientos</h2>
            <p className="panelText">{sortedMovements.length} movimientos</p>
          </div>
        </div>
        <div className="tableWrap tableScroll">
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
              {sortedMovements.map((movement) => (
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
              {!isLoading && sortedMovements.length === 0 ? (
                <tr>
                  <td colSpan={7}>
                    <div className="emptyState">No hay movimientos registrados.</div>
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
