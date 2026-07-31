"use client";

import type { CSSProperties } from "react";
import { useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Boxes, CheckCircle2, Factory, ListChecks, Users } from "lucide-react";
import { isAuthenticated } from "@/lib/api";
import { getCurrentUser, listUsers } from "@/lib/auth-api";
import { getInventorySummary, listInventoryItems, listInventoryMovements } from "@/lib/inventory-api";
import { listProcesses, listProductionRuns } from "@/lib/production-api";
import { normalizeRole, type Role } from "@/lib/roles";
import type { InventoryItemType } from "@/types/inventory";
import type { ProductionRun } from "@/types/production";

const INVENTORY_TYPE_LABELS: Record<InventoryItemType, string> = {
  RAW_MATERIAL: "Materia prima",
  SUPPLY: "Insumos",
  COMPLEMENT: "Complementos",
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
  CONVERSION_SALIDA: "Conversion salida",
  CONVERSION_ENTRADA: "Conversion entrada",
};

const RUN_STATUS_LABELS: Record<ProductionRun["status"], string> = {
  PENDIENTE_INVENTARIO: "Pendiente inventario",
  MATERIALES_APROBADOS: "Materiales aprobados",
  EN_PROCESO: "En proceso",
  PENDIENTE_RECEPCION: "Pendiente recepcion",
  RECIBIDA: "Recibida",
  CANCELADA: "Cancelada",
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

async function fetchDashboardBundle(role: Role) {
  const isAdmin = role === "admin";
  const showProcesses = isAdmin || role === "produccion";
  const showInventory = isAdmin || role === "inventario";

  const [processes, runs, users, inventorySummary, inventoryItems, inventoryMovements] = await Promise.all([
    showProcesses ? listProcesses() : Promise.resolve([]),
    role === "produccion" ? listProductionRuns() : Promise.resolve([]),
    isAdmin ? listUsers() : Promise.resolve([]),
    showInventory ? getInventorySummary() : Promise.resolve(null),
    showInventory ? listInventoryItems() : Promise.resolve([]),
    showInventory ? listInventoryMovements() : Promise.resolve([]),
  ]);

  return { processes, runs, users, inventorySummary, inventoryItems, inventoryMovements };
}

export function SystemDashboard() {
  useEffect(() => {
    if (!isAuthenticated()) {
      window.location.href = "/login";
    }
  }, []);

  const { data: me, error: meError } = useQuery({
    queryKey: ["me"],
    queryFn: getCurrentUser,
    enabled: isAuthenticated(),
  });

  const role: Role = me ? normalizeRole(me.role) : "unknown";

  const {
    data,
    isLoading: isBundleLoading,
    error: bundleErrorRaw,
  } = useQuery({
    queryKey: ["system-dashboard", role],
    queryFn: () => fetchDashboardBundle(role),
    enabled: Boolean(me),
  });

  const processes = data?.processes ?? [];
  const runs = data?.runs ?? [];
  const users = data?.users ?? [];
  const inventorySummary = data?.inventorySummary ?? null;
  const inventoryItems = data?.inventoryItems ?? [];
  const inventoryMovements = data?.inventoryMovements ?? [];

  const isLoading = !me || isBundleLoading;
  const queryError = meError ?? bundleErrorRaw;
  const error = queryError ? (queryError instanceof Error ? queryError.message : "No se pudo cargar el dashboard.") : null;

  const isAdmin = role === "admin";
  const isProduction = role === "produccion";
  const isInventory = role === "inventario";

  const totalStages = useMemo(
    () => processes.reduce((total, process) => total + process.stages.length, 0),
    [processes],
  );
  const activeRuns = runs.filter((run) => run.status === "MATERIALES_APROBADOS" || run.status === "EN_PROCESO");
  const finishedRuns = runs.filter((run) => run.status === "RECIBIDA");
  const pendingRuns = runs.filter((run) => run.status === "PENDIENTE_INVENTARIO");
  const runsByStatus = useMemo(() => {
    return runs.reduce<Record<string, number>>((acc, run) => {
      acc[run.status] = (acc[run.status] ?? 0) + 1;
      return acc;
    }, {});
  }, [runs]);
  const runStatusEntries = Object.entries(runsByStatus) as Array<[ProductionRun["status"], number]>;
  const maxRunStatus = Math.max(1, ...runStatusEntries.map(([, total]) => total));
  const recentRuns = useMemo(
    () =>
      [...runs]
        .sort((a, b) => new Date(b.requested_at).getTime() - new Date(a.requested_at).getTime())
        .slice(0, 4),
    [runs],
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
  const recentInventoryMovements = sortedInventoryMovements.slice(0, 4);
  const inventoryByType = useMemo(() => {
    return inventoryItems.reduce<Record<InventoryItemType, number>>((acc, item) => {
      acc[item.item_type] = (acc[item.item_type] ?? 0) + 1;
      return acc;
    }, { RAW_MATERIAL: 0, SUPPLY: 0, COMPLEMENT: 0, WORK_IN_PROGRESS: 0, FINISHED_PRODUCT: 0 });
  }, [inventoryItems]);
  const totalInventoryItems = inventorySummary?.total_items ?? inventoryItems.length;
  const inventoryTypeEntries = Object.entries(inventoryByType) as Array<[InventoryItemType, number]>;
  const maxInventoryTypeTotal = Math.max(1, ...inventoryTypeEntries.map(([, total]) => total));
  const maxProcessStages = Math.max(1, ...recentProcesses.map((process) => process.stages.length));
  const maxRoleUsers = Math.max(1, ...Object.values(usersByRole));

  // Donut de avance de ordenes (produccion) y salud de stock (inventario).
  const receivedPercent = runs.length ? Math.round((finishedRuns.length / runs.length) * 100) : 0;
  const movementsByType = useMemo(() => {
    return inventoryMovements.reduce<Record<string, number>>((acc, movement) => {
      acc[movement.movement_type] = (acc[movement.movement_type] ?? 0) + 1;
      return acc;
    }, {});
  }, [inventoryMovements]);
  const movementTypeEntries = Object.entries(movementsByType);
  const maxMovementType = Math.max(1, ...movementTypeEntries.map(([, total]) => total));
  const runsByProcess = useMemo(() => {
    return runs.reduce<Record<string, number>>((acc, run) => {
      acc[run.process_name] = (acc[run.process_name] ?? 0) + 1;
      return acc;
    }, {});
  }, [runs]);
  const runProcessEntries = Object.entries(runsByProcess).slice(0, 6);
  const maxRunProcess = Math.max(1, ...runProcessEntries.map(([, total]) => total));

  // Dashboard del administrador (diseno original completo).
  if (isAdmin) {
    return (
      <div className="content">
        {error ? <div className="alert alertError">{error}</div> : null}

        <section className="summaryGrid" aria-label="Resumen del sistema">
          <article className="card metric kpiCard">
            <Factory aria-hidden="true" size={22} />
            <span className="metricLabel kpiLabel">Procesos creados</span>
            <strong className="metricValue"><span className="kpiNum num">{processes.length}</span></strong>
          </article>
          <article className="card metric kpiCard">
            <Users aria-hidden="true" size={22} />
            <span className="metricLabel kpiLabel">Usuarios</span>
            <strong className="metricValue"><span className="kpiNum num">{users.length}</span></strong>
          </article>
          <article className="card metric kpiCard">
            <Boxes aria-hidden="true" size={22} />
            <span className="metricLabel kpiLabel">Items de inventario</span>
            <strong className="metricValue"><span className="kpiNum num">{totalInventoryItems}</span></strong>
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
              <p className="panelText">{totalInventoryItems} items registrados</p>
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
              {Object.entries(usersByRole).slice(0, 4).map(([roleName, total]) => (
                <div className="dashboardRow dashboardRoleRow" key={roleName}>
                  <div>
                    <strong>{roleName}</strong>
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
              {recentInventoryMovements.map((movement) => (
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

  // Dashboard del jefe de produccion.
  if (isProduction) {
    return (
      <div className="content">
        {error ? <div className="alert alertError">{error}</div> : null}

        <section className="summaryGrid" aria-label="Resumen de produccion">
          <article className="card metric kpiCard">
            <Factory aria-hidden="true" size={22} />
            <span className="metricLabel kpiLabel">Procesos creados</span>
            <strong className="metricValue"><span className="kpiNum num">{processes.length}</span></strong>
          </article>
          <article className="card metric kpiCard">
            <ListChecks aria-hidden="true" size={22} />
            <span className="metricLabel kpiLabel">Ordenes activas</span>
            <strong className="metricValue"><span className="kpiNum num">{activeRuns.length}</span></strong>
          </article>
          <article className="card metric kpiCard">
            <CheckCircle2 aria-hidden="true" size={22} />
            <span className="metricLabel kpiLabel">Ordenes recibidas</span>
            <strong className="metricValue"><span className="kpiNum num">{finishedRuns.length}</span></strong>
          </article>
        </section>

        <section className="dashboardVisualGrid dashboardVisualGridCompact" aria-label="Graficos de produccion">
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
              <h2 className="panelTitle">Ordenes por estado</h2>
              <p className="panelText">{pendingRuns.length} pendientes de inventario</p>
            </div>
            <div className="barChartList">
              {runStatusEntries.map(([statusKey, total]) => {
                const width = Math.max(8, Math.round((total / maxRunStatus) * 100));
                return (
                  <div className="barChartRow" key={statusKey}>
                    <span>{RUN_STATUS_LABELS[statusKey] ?? statusKey}</span>
                    <div className="barTrack">
                      <div className="barFill" style={{ width: `${width}%` }} />
                    </div>
                    <small>{total}</small>
                  </div>
                );
              })}
              {!isLoading && runStatusEntries.length === 0 ? <div className="emptyState">No hay ordenes registradas.</div> : null}
            </div>
          </article>

          <article className="card chartPanel">
            <div>
              <h2 className="panelTitle">Avance de ordenes</h2>
              <p className="panelText">{finishedRuns.length} recibidas de {runs.length}</p>
            </div>
            <div className="donutWrap">
              <div
                aria-label={`${receivedPercent}% de ordenes recibidas`}
                className="donutChart"
                role="img"
                style={{ "--donut-value": `${receivedPercent}%` } as CSSProperties}
              >
                <strong>{receivedPercent}%</strong>
                <span>recibidas</span>
              </div>
              <div className="chartLegend">
                <span><i className="legendActive" />Recibidas</span>
                <span><i className="legendInactive" />En proceso</span>
              </div>
            </div>
          </article>
        </section>

        <section className="dashboardGrid dashboardGridCompact" aria-label="Detalle de produccion">
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
                <h2 className="panelTitle">Ordenes recientes</h2>
                <p className="panelText">{activeRuns.length} en curso</p>
              </div>
            </div>
            <div className="dashboardList">
              {recentRuns.map((run) => (
                <div className="dashboardRow" key={run.id}>
                  <div>
                    <strong>{run.production_code ?? run.process_name}</strong>
                    <span>{run.process_name}</span>
                  </div>
                  <small>{RUN_STATUS_LABELS[run.status] ?? run.status}</small>
                </div>
              ))}
              {!isLoading && recentRuns.length === 0 ? (
                <div className="emptyState">No hay ordenes registradas.</div>
              ) : null}
              {isLoading ? <div className="emptyState">Cargando ordenes...</div> : null}
            </div>
          </article>

          <article className="card panelBody">
            <div className="panelHeader">
              <div>
                <h2 className="panelTitle">Ordenes por proceso</h2>
                <p className="panelText">Distribucion de la produccion</p>
              </div>
            </div>
            <div className="dashboardList">
              {runProcessEntries.map(([processName, total]) => (
                <div className="dashboardRow dashboardRoleRow" key={processName}>
                  <div>
                    <strong>{processName}</strong>
                    <span>{total} ordenes</span>
                  </div>
                  <div className="miniBarTrack">
                    <div className="miniBarFill" style={{ width: `${Math.max(8, Math.round((total / maxRunProcess) * 100))}%` }} />
                  </div>
                </div>
              ))}
              {!isLoading && runProcessEntries.length === 0 ? (
                <div className="emptyState">No hay ordenes registradas.</div>
              ) : null}
            </div>
          </article>

          <article className="card panelBody">
            <div className="panelHeader">
              <div>
                <h2 className="panelTitle">Pendientes de inventario</h2>
                <p className="panelText">{pendingRuns.length} esperando aprobacion</p>
              </div>
            </div>
            <div className="dashboardList">
              {pendingRuns.slice(0, 4).map((run) => (
                <div className="dashboardRow" key={run.id}>
                  <div>
                    <strong>{run.production_code ?? run.process_name}</strong>
                    <span>{numericText(run.total_required_material)} {run.raw_material_unit_code}</span>
                  </div>
                  <small>Cant. {numericText(run.quantity)}</small>
                </div>
              ))}
              {!isLoading && pendingRuns.length === 0 ? (
                <div className="emptyState">Sin solicitudes pendientes.</div>
              ) : null}
            </div>
          </article>
        </section>
      </div>
    );
  }

  // Dashboard del jefe de inventario.
  if (isInventory) {
    return (
      <div className="content">
        {error ? <div className="alert alertError">{error}</div> : null}

        <section className="summaryGrid" aria-label="Resumen de inventario">
          <article className="card metric kpiCard">
            <Boxes aria-hidden="true" size={22} />
            <span className="metricLabel kpiLabel">Items de inventario</span>
            <strong className="metricValue"><span className="kpiNum num">{totalInventoryItems}</span></strong>
          </article>
          <article className="card metric kpiCard">
            <ListChecks aria-hidden="true" size={22} />
            <span className="metricLabel kpiLabel">Movimientos</span>
            <strong className="metricValue"><span className="kpiNum num">{inventoryMovements.length}</span></strong>
          </article>
        </section>

        <section className="dashboardVisualGrid dashboardVisualGridCompact" aria-label="Graficos de inventario">
          <article className="card chartPanel">
            <div>
              <h2 className="panelTitle">Inventario por tipo</h2>
              <p className="panelText">{totalInventoryItems} items registrados</p>
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

          <article className="card chartPanel">
            <div>
              <h2 className="panelTitle">Movimientos por tipo</h2>
              <p className="panelText">{inventoryMovements.length} movimientos totales</p>
            </div>
            <div className="barChartList">
              {movementTypeEntries.map(([type, total]) => {
                const width = Math.max(8, Math.round((total / maxMovementType) * 100));
                return (
                  <div className="barChartRow" key={type}>
                    <span>{MOVEMENT_TYPE_LABELS[type] ?? type}</span>
                    <div className="barTrack">
                      <div className="barFill" style={{ width: `${width}%` }} />
                    </div>
                    <small>{total}</small>
                  </div>
                );
              })}
              {!isLoading && movementTypeEntries.length === 0 ? <div className="emptyState">No hay movimientos.</div> : null}
            </div>
          </article>
        </section>

        <section className="dashboardGrid dashboardGridCompact" aria-label="Detalle de inventario">
          <article className="card panelBody">
            <div className="panelHeader">
              <div>
                <h2 className="panelTitle">Movimientos recientes</h2>
                <p className="panelText">Ultimos movimientos de inventario</p>
              </div>
            </div>
            <div className="dashboardList">
              {recentInventoryMovements.map((movement) => (
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

  return (
    <div className="content">
      {error ? <div className="alert alertError">{error}</div> : null}
      {isLoading ? <div className="emptyState">Cargando dashboard...</div> : null}
    </div>
  );
}
