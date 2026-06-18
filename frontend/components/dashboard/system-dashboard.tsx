"use client";

import type { CSSProperties } from "react";
import { useEffect, useMemo, useState } from "react";
import { Boxes, Factory, Users } from "lucide-react";
import { getAccessToken } from "@/lib/api";
import { getCurrentUser, listUsers, type ManagedUser } from "@/lib/auth-api";
import { getInventorySummary, listInventoryItems, listInventoryMovements } from "@/lib/inventory-api";
import { listProcesses } from "@/lib/production-api";
import type { InventoryItem, InventoryItemType, InventoryMovement, InventorySummary } from "@/types/inventory";
import type { ProductionProcess } from "@/types/production";

const INVENTORY_TYPE_LABELS: Record<InventoryItemType, string> = {
  RAW_MATERIAL: "Materia prima",
  WORK_IN_PROGRESS: "En proceso",
  FINISHED_PRODUCT: "Terminados",
};

const MOVEMENT_TYPE_LABELS: Record<string, string> = {
  ENTRADA: "Entrada",
  SALIDA: "Salida",
  AJUSTE_POSITIVO: "Ajuste positivo",
  AJUSTE_NEGATIVO: "Ajuste negativo",
  CONSUMO_PRODUCCION: "Consumo produccion",
  INGRESO_PRODUCCION: "Ingreso produccion",
  MERMA: "Merma",
};

function numericText(value: string | null) {
  if (!value) return "0";
  const number = Number(value);
  return Number.isFinite(number) ? number.toLocaleString("es-EC", { maximumFractionDigits: 4 }) : value;
}

function movementDateLabel(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Sin fecha";
  return date.toLocaleDateString("es-EC", { day: "2-digit", month: "short" });
}

export function SystemDashboard() {
  const [processes, setProcesses] = useState<ProductionProcess[]>([]);
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [inventorySummary, setInventorySummary] = useState<InventorySummary | null>(null);
  const [inventoryItems, setInventoryItems] = useState<InventoryItem[]>([]);
  const [inventoryMovements, setInventoryMovements] = useState<InventoryMovement[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    async function loadDashboard() {
      if (!getAccessToken()) {
        window.location.href = "/login";
        return;
      }

      setIsLoading(true);
      setError(null);
      try {
        const [, nextProcesses, nextUsers, nextInventorySummary, nextInventoryItems, nextInventoryMovements] = await Promise.all([
          getCurrentUser(),
          listProcesses(),
          listUsers(),
          getInventorySummary(),
          listInventoryItems(),
          listInventoryMovements(),
        ]);
        setProcesses(nextProcesses);
        setUsers(nextUsers);
        setInventorySummary(nextInventorySummary);
        setInventoryItems(nextInventoryItems);
        setInventoryMovements(nextInventoryMovements);
      } catch (nextError) {
        setError(nextError instanceof Error ? nextError.message : "No se pudo cargar el dashboard.");
      } finally {
        setIsLoading(false);
      }
    }

    void loadDashboard();
  }, []);

  const totalStages = useMemo(
    () => processes.reduce((total, process) => total + process.stages.length, 0),
    [processes],
  );
  const activeUsers = users.filter((user) => user.is_active).length;
  const inactiveUsers = users.length - activeUsers;
  const activeUserPercent = users.length > 0 ? Math.round((activeUsers / users.length) * 100) : 0;
  const usersByRole = useMemo(() => {
    return users.reduce<Record<string, number>>((acc, user) => {
      acc[user.role] = (acc[user.role] ?? 0) + 1;
      return acc;
    }, {});
  }, [users]);
  const recentProcesses = processes.slice(0, 5);
  const recentUsers = users.slice(0, 5);
  const sortedInventoryMovements = useMemo(
    () => [...inventoryMovements].sort((left, right) => new Date(right.created_at).getTime() - new Date(left.created_at).getTime()),
    [inventoryMovements],
  );
  const recentInventoryMovements = sortedInventoryMovements.slice(0, 5);
  const inventoryByType = useMemo(() => {
    return inventoryItems.reduce<Record<InventoryItemType, number>>((acc, item) => {
      acc[item.item_type] = (acc[item.item_type] ?? 0) + 1;
      return acc;
    }, { RAW_MATERIAL: 0, WORK_IN_PROGRESS: 0, FINISHED_PRODUCT: 0 });
  }, [inventoryItems]);
  const lowStockItems = inventorySummary?.low_stock_items ?? 0;
  const totalInventoryItems = inventorySummary?.total_items ?? inventoryItems.length;
  const inventoryTypeEntries = Object.entries(inventoryByType) as Array<[InventoryItemType, number]>;
  const maxInventoryTypeTotal = Math.max(1, ...inventoryTypeEntries.map(([, total]) => total));
  const maxProcessStages = Math.max(1, ...recentProcesses.map((process) => process.stages.length));
  const roleEntries = Object.entries(usersByRole);
  const maxRoleUsers = Math.max(1, ...roleEntries.map(([, total]) => total));

  return (
    <div className="content">
      {error ? <div className="alert alertError">{error}</div> : null}

      <section className="summaryGrid" aria-label="Resumen del sistema">
        <article className="card metric">
          <Factory aria-hidden="true" size={22} />
          <span className="metricLabel">Procesos creados</span>
          <strong className="metricValue">{processes.length}</strong>
        </article>
        <article className="card metric">
          <Users aria-hidden="true" size={22} />
          <span className="metricLabel">Usuarios</span>
          <strong className="metricValue">{users.length}</strong>
        </article>
        <article className="card metric">
          <Boxes aria-hidden="true" size={22} />
          <span className="metricLabel">Items de inventario</span>
          <strong className="metricValue">{totalInventoryItems}</strong>
        </article>
      </section>

      <section className="dashboardVisualGrid dashboardVisualGridCompact" aria-label="Graficos del dashboard">
        <article className="card chartPanel">
          <div>
            <h2 className="panelTitle">Estado de usuarios</h2>
            <p className="panelText">{activeUsers} activos de {users.length}</p>
          </div>
          <div className="donutWrap">
            <div
              aria-label={`${activeUserPercent}% de usuarios activos`}
              className="donutChart"
              role="img"
              style={{ "--donut-value": `${activeUserPercent}%` } as CSSProperties}
            >
              <strong>{activeUserPercent}%</strong>
              <span>activos</span>
            </div>
            <div className="chartLegend">
              <span><i className="legendActive" />Activos</span>
              <span><i className="legendInactive" />Inactivos</span>
            </div>
          </div>
        </article>

        <article className="card chartPanel">
          <div>
            <h2 className="panelTitle">Procesos por etapas</h2>
            <p className="panelText">Comparacion rapida de configuracion</p>
          </div>
          <div className="barChartList">
            {recentProcesses.map((process) => {
              const width = Math.max(8, Math.round((process.stages.length / maxProcessStages) * 100));
              return (
                <div className="barChartRow" key={process.id}>
                  <span>{process.name}</span>
                  <div className="barTrack">
                    <div className="barFill" style={{ width: `${width}%` }} />
                  </div>
                  <small>{process.stages.length}</small>
                </div>
              );
            })}
            {!isLoading && recentProcesses.length === 0 ? <div className="emptyState">No hay procesos creados.</div> : null}
          </div>
        </article>

        <article className="card chartPanel">
          <div>
            <h2 className="panelTitle">Inventario por tipo</h2>
            <p className="panelText">{lowStockItems} items con stock bajo</p>
          </div>
          <div className="barChartList">
            {inventoryTypeEntries.map(([type, total]) => {
              const width = Math.max(8, Math.round((total / maxInventoryTypeTotal) * 100));
              return (
                <div className="barChartRow" key={type}>
                  <span>{INVENTORY_TYPE_LABELS[type]}</span>
                  <div className="barTrack">
                    <div className="barFill" style={{ width: `${width}%` }} />
                  </div>
                  <small>{total}</small>
                </div>
              );
            })}
            {!isLoading && inventoryItems.length === 0 ? <div className="emptyState">No hay inventario registrado.</div> : null}
          </div>
        </article>
      </section>

      <section className="dashboardGrid dashboardGridCompact" aria-label="Detalle del dashboard">
        <article className="card panelBody">
          <div className="panelHeader">
            <div>
              <h2 className="panelTitle">Procesos</h2>
              <p className="panelText">{totalStages} etapas configuradas</p>
            </div>
          </div>
          <div className="dashboardList">
            {recentProcesses.slice(0, 4).map((process) => (
              <div className="dashboardRow" key={process.id}>
                <div>
                  <strong>{process.name}</strong>
                  <span>{process.stages.length} etapas</span>
                </div>
                <small>{process.is_active ? "Activo" : "Inactivo"}</small>
              </div>
            ))}
            {!isLoading && recentProcesses.length === 0 ? (
              <div className="emptyState">No hay procesos creados.</div>
            ) : null}
            {isLoading ? <div className="emptyState">Cargando procesos...</div> : null}
          </div>
        </article>

        <article className="card panelBody">
          <div className="panelHeader">
            <div>
              <h2 className="panelTitle">Usuarios</h2>
              <p className="panelText">{inactiveUsers} usuarios inactivos</p>
            </div>
          </div>
          <div className="dashboardList">
            {recentUsers.slice(0, 4).map((user) => (
              <div className={`dashboardRow ${!user.is_active ? "dashboardRowMuted" : ""}`} key={user.id}>
                <div>
                  <strong>{user.first_name} {user.last_name}</strong>
                  <span>{user.email}</span>
                </div>
                <small>{user.role}</small>
              </div>
            ))}
            {!isLoading && recentUsers.length === 0 ? <div className="emptyState">No hay usuarios creados.</div> : null}
            {isLoading ? <div className="emptyState">Cargando usuarios...</div> : null}
          </div>
        </article>

        <article className="card panelBody">
          <h2 className="panelTitle">Roles</h2>
          <div className="dashboardList">
            {Object.entries(usersByRole).slice(0, 4).map(([role, total]) => (
              <div className="dashboardRow dashboardRoleRow" key={role}>
                <div>
                  <strong>{role}</strong>
                  <span>{total} usuarios</span>
                </div>
                <div className="miniBarTrack">
                  <div className="miniBarFill" style={{ width: `${Math.max(8, Math.round((total / maxRoleUsers) * 100))}%` }} />
                </div>
              </div>
            ))}
            {!isLoading && Object.keys(usersByRole).length === 0 ? (
              <div className="emptyState">Sin roles asignados.</div>
            ) : null}
          </div>
        </article>

        <article className="card panelBody">
          <div className="panelHeader">
            <div>
              <h2 className="panelTitle">Inventario</h2>
              <p className="panelText">Movimientos recientes</p>
            </div>
          </div>
          <div className="dashboardList">
            {recentInventoryMovements.slice(0, 4).map((movement) => (
              <div className="dashboardRow" key={movement.id}>
                <div>
                  <strong>{movement.item.name}</strong>
                  <span>{MOVEMENT_TYPE_LABELS[movement.movement_type] ?? movement.movement_type} - {movementDateLabel(movement.created_at)}</span>
                </div>
                <small>{numericText(movement.quantity)} {movement.unit_code}</small>
              </div>
            ))}
            {!isLoading && recentInventoryMovements.length === 0 ? (
              <div className="emptyState">No hay movimientos de inventario.</div>
            ) : null}
            {isLoading ? <div className="emptyState">Cargando inventario...</div> : null}
          </div>
        </article>
      </section>
    </div>
  );
}
