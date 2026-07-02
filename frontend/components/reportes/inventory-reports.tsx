"use client";

import { useEffect, useMemo, useState } from "react";
import { AlertTriangle, Boxes, ListChecks } from "lucide-react";
import { getInventorySummary, listInventoryItems, listInventoryMovements } from "@/lib/inventory-api";
import type { InventoryItem, InventoryItemType, InventoryMovement, InventorySummary } from "@/types/inventory";

const TYPE_LABELS: Record<InventoryItemType, string> = {
  RAW_MATERIAL: "Materia prima",
  WORK_IN_PROGRESS: "En proceso",
  FINISHED_PRODUCT: "Terminados",
};

const MOVEMENT_LABELS: Record<string, string> = {
  ENTRADA: "Entrada",
  SALIDA: "Salida",
  AJUSTE_POSITIVO: "Ajuste positivo",
  AJUSTE_NEGATIVO: "Ajuste negativo",
  CONSUMO_PRODUCCION: "Consumo produccion",
  INGRESO_PRODUCCION: "Ingreso produccion",
  MERMA: "Merma",
};

function num(value: string | null) {
  if (!value) return "0";
  const n = Number(value);
  return Number.isFinite(n) ? n.toLocaleString("es-EC", { maximumFractionDigits: 4 }) : value;
}

function dateLabel(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Sin fecha";
  return date.toLocaleDateString("es-EC", { day: "2-digit", month: "short", year: "numeric" });
}

function isLowStock(item: InventoryItem) {
  if (item.minimum_stock === null) return false;
  return Number(item.current_stock) <= Number(item.minimum_stock);
}

export function InventoryReports() {
  const [summary, setSummary] = useState<InventorySummary | null>(null);
  const [items, setItems] = useState<InventoryItem[]>([]);
  const [movements, setMovements] = useState<InventoryMovement[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function load() {
      setIsLoading(true);
      setError(null);
      try {
        const [nextSummary, nextItems, nextMovements] = await Promise.all([
          getInventorySummary(),
          listInventoryItems(),
          listInventoryMovements(),
        ]);
        setSummary(nextSummary);
        setItems(nextItems);
        setMovements(nextMovements);
      } catch (nextError) {
        setError(nextError instanceof Error ? nextError.message : "No se pudieron cargar los reportes.");
      } finally {
        setIsLoading(false);
      }
    }
    void load();
  }, []);

  const lowStock = useMemo(() => items.filter(isLowStock), [items]);
  const sortedItems = useMemo(
    () => [...items].sort((a, b) => a.name.localeCompare(b.name, "es")),
    [items],
  );
  const recentMovements = useMemo(
    () =>
      [...movements]
        .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
        .slice(0, 25),
    [movements],
  );

  return (
    <div className="content">
      {error ? <div className="alert alertError">{error}</div> : null}

      <section className="summaryGrid" aria-label="Resumen de inventario">
        <article className="card metric">
          <Boxes aria-hidden="true" size={22} />
          <span className="metricLabel">Items registrados</span>
          <strong className="metricValue">{summary?.total_items ?? items.length}</strong>
        </article>
        <article className="card metric">
          <AlertTriangle aria-hidden="true" size={22} />
          <span className="metricLabel">Stock bajo</span>
          <strong className="metricValue">{summary?.low_stock_items ?? lowStock.length}</strong>
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
            <h2 className="panelTitle">Stock bajo</h2>
            <p className="panelText">Items en o por debajo del minimo</p>
          </div>
        </div>
        <div className="tableWrap">
          <table className="table">
            <thead>
              <tr>
                <th>Item</th>
                <th>Tipo</th>
                <th>Stock actual</th>
                <th>Minimo</th>
                <th>Unidad</th>
              </tr>
            </thead>
            <tbody>
              {lowStock.map((item) => (
                <tr key={item.id}>
                  <td>{item.name}</td>
                  <td>{TYPE_LABELS[item.item_type]}</td>
                  <td>{num(item.current_stock)}</td>
                  <td>{num(item.minimum_stock)}</td>
                  <td>{item.unit_code}</td>
                </tr>
              ))}
              {!isLoading && lowStock.length === 0 ? (
                <tr>
                  <td colSpan={5}>
                    <div className="emptyState">No hay items con stock bajo.</div>
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card panelBody">
        <div className="panelHeader">
          <div>
            <h2 className="panelTitle">Stock actual</h2>
            <p className="panelText">Existencias por item</p>
          </div>
        </div>
        <div className="tableWrap">
          <table className="table">
            <thead>
              <tr>
                <th>Item</th>
                <th>SKU</th>
                <th>Tipo</th>
                <th>Stock actual</th>
                <th>Minimo</th>
                <th>Unidad</th>
              </tr>
            </thead>
            <tbody>
              {sortedItems.map((item) => (
                <tr key={item.id}>
                  <td>{item.name}</td>
                  <td>{item.sku}</td>
                  <td>{TYPE_LABELS[item.item_type]}</td>
                  <td>{num(item.current_stock)}</td>
                  <td>{item.minimum_stock === null ? "-" : num(item.minimum_stock)}</td>
                  <td>{item.unit_code}</td>
                </tr>
              ))}
              {!isLoading && sortedItems.length === 0 ? (
                <tr>
                  <td colSpan={6}>
                    <div className="emptyState">No hay inventario registrado.</div>
                  </td>
                </tr>
              ) : null}
            </tbody>
          </table>
        </div>
      </section>

      <section className="card panelBody">
        <div className="panelHeader">
          <div>
            <h2 className="panelTitle">Kardex de movimientos</h2>
            <p className="panelText">Ultimos 25 movimientos</p>
          </div>
        </div>
        <div className="tableWrap">
          <table className="table">
            <thead>
              <tr>
                <th>Fecha</th>
                <th>Item</th>
                <th>Tipo</th>
                <th>Cantidad</th>
                <th>Unidad</th>
                <th>Lote</th>
                <th>Usuario</th>
              </tr>
            </thead>
            <tbody>
              {recentMovements.map((movement) => (
                <tr key={movement.id}>
                  <td>{dateLabel(movement.created_at)}</td>
                  <td>{movement.item.name}</td>
                  <td>{MOVEMENT_LABELS[movement.movement_type] ?? movement.movement_type}</td>
                  <td>{num(movement.quantity)}</td>
                  <td>{movement.unit_code}</td>
                  <td>{movement.lot_code ?? "-"}</td>
                  <td>{movement.created_by_name ?? "-"}</td>
                </tr>
              ))}
              {!isLoading && recentMovements.length === 0 ? (
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
