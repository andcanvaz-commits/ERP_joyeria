"use client";

import { useEffect, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Boxes, CheckCircle2, Factory, ListChecks, Users } from "lucide-react";
import { isAuthenticated } from "@/lib/api";
import { getCurrentUser, listUsers } from "@/lib/auth-api";
import { getInventorySummary, listInventoryItems, listInventoryMovements } from "@/lib/inventory-api";
import { listProcesses, listProductionRuns } from "@/lib/production-api";
import { normalizeRole, type Role } from "@/lib/roles";
import { CategoryDonut } from "@/components/shared/category-donut";
import { useCountUp } from "@/hooks/use-count-up";
import type { InventoryItem, InventoryItemType } from "@/types/inventory";
import type { ProductionRun } from "@/types/production";

const INVENTORY_TYPE_LABELS: Record<InventoryItemType, string> = {
  RAW_MATERIAL: "Materia prima",
  SUPPLY: "Insumos",
  COMPLEMENT: "Complementos",
  WORK_IN_PROGRESS: "En proceso",
  FINISHED_PRODUCT: "Terminados",
  WASTE: "Merma",
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
  RECLASIFICACION_SALIDA: "Reclasificacion salida",
  RECLASIFICACION_ENTRADA: "Reclasificacion entrada",
};

const RUN_STATUS_LABELS: Record<ProductionRun["status"], string> = {
  PENDIENTE_INVENTARIO: "Pendiente inventario",
  MATERIALES_APROBADOS: "Materiales aprobados",
  EN_PROCESO: "En proceso",
  PENDIENTE_RECEPCION: "Pendiente recepcion",
  RECIBIDA: "Recibida",
  CANCELADA: "Cancelada",
  ESPERANDO_MATERIAL: "Esperando material",
};

function numericText(value: string | null) {
  if (!value) return "0";
  const number = Number(value);
  return Number.isFinite(number) ? number.toLocaleString("es-EC", { maximumFractionDigits: 4 }) : value;
}

// Equivalente en gramos de un item: directo si su unidad ya es "g", o
// stock * peso_por_unidad para piezas con peso conocido. Sin esa info
// (insumos/complementos en "und" sin peso) no aporta gramos -- no todo el
// inventario tiene un equivalente real, y sumarlo como si lo tuviera
// falsearia el desglose.
function itemGrams(item: InventoryItem): number {
  const stock = Number(item.current_stock) || 0;
  if (item.unit_code === "g") return stock;
  const weightPerUnit = Number(item.weight_per_unit) || 0;
  return weightPerUnit > 0 ? stock * weightPerUnit : 0;
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
  const recentRuns = useMemo(
    () =>
      [...runs]
        .sort((a, b) => new Date(b.requested_at).getTime() - new Date(a.requested_at).getTime())
        .slice(0, 4),
    [runs],
  );

  const activeUsers = users.filter((user) => user.is_active).length;
  const inactiveUsers = users.length - activeUsers;
  // Solo activos, por rol -- el segmento "Inactivos" (abajo) cubre el resto,
  // asi el mismo grafico responde "activos" y "por rol" a la vez.
  const usersByRoleActive = useMemo(() => {
    return users.reduce<Record<string, number>>((acc, user) => {
      if (!user.is_active) return acc;
      acc[user.role] = (acc[user.role] ?? 0) + 1;
      return acc;
    }, {});
  }, [users]);
  const recentProcesses = processes.slice(0, 5);
  // Activos/inactivos: a diferencia de una porcion por proceso individual,
  // esto no depende de cuantos procesos existan -- siempre son 2 categorias.
  const activeProcesses = processes.filter((process) => process.is_active).length;
  const inactiveProcesses = processes.length - activeProcesses;
  const sortedInventoryMovements = useMemo(
    () => [...inventoryMovements].sort((left, right) => new Date(right.created_at).getTime() - new Date(left.created_at).getTime()),
    [inventoryMovements],
  );
  const recentInventoryMovements = sortedInventoryMovements.slice(0, 4);
  const inventoryByType = useMemo(() => {
    return inventoryItems.reduce<Record<InventoryItemType, number>>((acc, item) => {
      acc[item.item_type] = (acc[item.item_type] ?? 0) + 1;
      return acc;
    }, { RAW_MATERIAL: 0, SUPPLY: 0, COMPLEMENT: 0, WORK_IN_PROGRESS: 0, FINISHED_PRODUCT: 0, WASTE: 0 });
  }, [inventoryItems]);
  const totalInventoryItems = inventorySummary?.total_items ?? inventoryItems.length;
  const inventoryTypeEntries = Object.entries(inventoryByType) as Array<[InventoryItemType, number]>;
  // Desglose por peso real (gramos), no por cantidad de items -- para el
  // grafico "Inventario por tipo" del admin (el resto del sistema sigue
  // contando items, es informacion distinta).
  const inventoryGramsByType = useMemo(() => {
    const acc: Record<InventoryItemType, number> = { RAW_MATERIAL: 0, SUPPLY: 0, COMPLEMENT: 0, WORK_IN_PROGRESS: 0, FINISHED_PRODUCT: 0, WASTE: 0 };
    for (const item of inventoryItems) {
      acc[item.item_type] += itemGrams(item);
    }
    return Object.entries(acc) as Array<[InventoryItemType, number]>;
  }, [inventoryItems]);
  const totalInventoryGrams = inventoryGramsByType.reduce((sum, [, grams]) => sum + grams, 0);

  const movementsByType = useMemo(() => {
    return inventoryMovements.reduce<Record<string, number>>((acc, movement) => {
      acc[movement.movement_type] = (acc[movement.movement_type] ?? 0) + 1;
      return acc;
    }, {});
  }, [inventoryMovements]);
  const movementTypeEntries = Object.entries(movementsByType);
  const runsByProcess = useMemo(() => {
    return runs.reduce<Record<string, number>>((acc, run) => {
      acc[run.process_name] = (acc[run.process_name] ?? 0) + 1;
      return acc;
    }, {});
  }, [runs]);
  const runProcessEntries = Object.entries(runsByProcess).slice(0, 6);
  const maxRunProcess = Math.max(1, ...runProcessEntries.map(([, total]) => total));

  // Contadores animados de las tarjetas KPI: llamados siempre (nunca dentro
  // de los "if" de rol) para no violar las reglas de hooks — cada rama solo
  // usa el subconjunto que le corresponde.
  const processesCount = useCountUp(processes.length);
  const usersCount = useCountUp(users.length);
  const inventoryItemsCount = useCountUp(totalInventoryItems);
  const activeRunsCount = useCountUp(activeRuns.length);
  const finishedRunsCount = useCountUp(finishedRuns.length);
  const inventoryMovementsCount = useCountUp(inventoryMovements.length);

  // "Items de inventario" es un total sin desgloce -- en vez de abrir un
  // modal al hacer click, la tarjeta muestra este desglose por tipo al
  // pasar el mouse o enfocarla (mismo patron que el resto de tooltips del
  // dashboard: sin JS, solo CSS :hover/:focus-within sobre el contenedor).
  const inventoryBreakdownPopover = (
    <div aria-hidden="true" className="kpiPopover">
      <strong className="kpiPopoverTitle">Items por tipo</strong>
      {inventoryTypeEntries.map(([type, total]) => (
        <div className="kpiPopoverRow" key={type}>
          <span>{INVENTORY_TYPE_LABELS[type]}</span>
          <span>{total}</span>
        </div>
      ))}
    </div>
  );

  // Dashboard del administrador (diseno original completo).
  if (isAdmin) {
    return (
      <div className="content">
        {error ? <div className="alert alertError">{error}</div> : null}

        <section className="summaryGrid" aria-label="Resumen del sistema">
          <article className="card metric kpiCard">
            <Factory aria-hidden="true" size={22} />
            <span className="metricLabel kpiLabel">Procesos creados</span>
            <strong className="metricValue"><span className="kpiNum num">{processesCount}</span></strong>
          </article>
          <article className="card metric kpiCard">
            <Users aria-hidden="true" size={22} />
            <span className="metricLabel kpiLabel">Usuarios</span>
            <strong className="metricValue"><span className="kpiNum num">{usersCount}</span></strong>
          </article>
          <article className="card metric kpiCard kpiCardHoverable" tabIndex={0}>
            <Boxes aria-hidden="true" size={22} />
            <span className="metricLabel kpiLabel">Items de inventario</span>
            <strong className="metricValue"><span className="kpiNum num">{inventoryItemsCount}</span></strong>
            {inventoryBreakdownPopover}
          </article>
        </section>

        <section className="dashboardVisualGrid dashboardVisualGridSymmetric" aria-label="Graficos del dashboard">
          <article className="card chartPanel">
            <div>
              <h2 className="panelTitle">Usuarios</h2>
              <p className="panelText">{activeUsers} activos de {users.length}</p>
            </div>
            <CategoryDonut
              centerLabel="usuarios"
              emptyMessage="No hay usuarios creados."
              isLoading={isLoading}
              items={[
                ...Object.entries(usersByRoleActive).map(([roleName, total]) => ({
                  id: roleName,
                  label: roleName,
                  value: total,
                })),
                { id: "inactive", label: "Inactivos", value: inactiveUsers },
              ]}
            />
          </article>

          <article className="card chartPanel">
            <div>
              <h2 className="panelTitle">Inventario por tipo</h2>
              <p className="panelText">{numericText(String(totalInventoryGrams))} g en total</p>
            </div>
            <CategoryDonut
              centerLabel="g"
              emptyMessage="No hay inventario registrado."
              isLoading={isLoading}
              items={inventoryGramsByType.map(([type, grams]) => ({
                id: type,
                label: INVENTORY_TYPE_LABELS[type],
                value: grams,
              }))}
            />
          </article>

          <article className="card chartPanel chartPanelWide">
            <div>
              <h2 className="panelTitle">Procesos por etapas</h2>
              <p className="panelText">{processes.length} procesos creados</p>
            </div>
            <CategoryDonut
              centerLabel="etapas"
              emptyMessage="No hay procesos creados."
              isLoading={isLoading}
              items={processes.map((process) => ({
                id: process.id,
                label: process.name,
                value: process.stages.length,
              }))}
            />
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
            <strong className="metricValue"><span className="kpiNum num">{processesCount}</span></strong>
          </article>
          <article className="card metric kpiCard">
            <ListChecks aria-hidden="true" size={22} />
            <span className="metricLabel kpiLabel">Ordenes activas</span>
            <strong className="metricValue"><span className="kpiNum num">{activeRunsCount}</span></strong>
          </article>
          <article className="card metric kpiCard">
            <CheckCircle2 aria-hidden="true" size={22} />
            <span className="metricLabel kpiLabel">Ordenes recibidas</span>
            <strong className="metricValue"><span className="kpiNum num">{finishedRunsCount}</span></strong>
          </article>
        </section>

        <section className="dashboardVisualGrid dashboardVisualGridCompact" aria-label="Graficos de produccion">
          <article className="card chartPanel">
            <div>
              <h2 className="panelTitle">Estado de procesos</h2>
              <p className="panelText">{processes.length} procesos creados</p>
            </div>
            <CategoryDonut
              centerLabel="procesos"
              emptyMessage="No hay procesos creados."
              isLoading={isLoading}
              items={[
                { id: "active", label: "Activos", value: activeProcesses },
                { id: "inactive", label: "Inactivos", value: inactiveProcesses },
              ]}
            />
          </article>

          <article className="card chartPanel">
            <div>
              <h2 className="panelTitle">Ordenes por estado</h2>
              <p className="panelText">{pendingRuns.length} pendientes de inventario</p>
            </div>
            <CategoryDonut
              centerLabel="ordenes"
              emptyMessage="No hay ordenes registradas."
              isLoading={isLoading}
              items={runStatusEntries.map(([statusKey, total]) => ({
                id: statusKey,
                label: RUN_STATUS_LABELS[statusKey] ?? statusKey,
                value: total,
              }))}
            />
          </article>

          <article className="card chartPanel">
            <div>
              <h2 className="panelTitle">Avance de ordenes</h2>
              <p className="panelText">{finishedRuns.length} recibidas de {runs.length}</p>
            </div>
            <CategoryDonut
              centerLabel="ordenes"
              emptyMessage="No hay ordenes registradas."
              isLoading={isLoading}
              items={[
                { id: "received", label: "Recibidas", value: finishedRuns.length },
                { id: "pending", label: "En proceso", value: runs.length - finishedRuns.length },
              ]}
            />
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
          <article className="card metric kpiCard kpiCardHoverable" tabIndex={0}>
            <Boxes aria-hidden="true" size={22} />
            <span className="metricLabel kpiLabel">Items de inventario</span>
            <strong className="metricValue"><span className="kpiNum num">{inventoryItemsCount}</span></strong>
            {inventoryBreakdownPopover}
          </article>
          <article className="card metric kpiCard">
            <ListChecks aria-hidden="true" size={22} />
            <span className="metricLabel kpiLabel">Movimientos</span>
            <strong className="metricValue"><span className="kpiNum num">{inventoryMovementsCount}</span></strong>
          </article>
        </section>

        <section className="dashboardVisualGrid dashboardVisualGridCompact" aria-label="Graficos de inventario">
          <article className="card chartPanel">
            <div>
              <h2 className="panelTitle">Inventario por tipo</h2>
              <p className="panelText">{totalInventoryItems} items registrados</p>
            </div>
            <CategoryDonut
              centerLabel="items"
              emptyMessage="No hay inventario registrado."
              isLoading={isLoading}
              items={inventoryTypeEntries.map(([type, total]) => ({
                id: type,
                label: INVENTORY_TYPE_LABELS[type],
                value: total,
              }))}
            />
          </article>

          <article className="card chartPanel">
            <div>
              <h2 className="panelTitle">Movimientos por tipo</h2>
              <p className="panelText">{inventoryMovements.length} movimientos totales</p>
            </div>
            <CategoryDonut
              centerLabel="movs."
              emptyMessage="No hay movimientos."
              isLoading={isLoading}
              items={movementTypeEntries.map(([type, total]) => ({
                id: type,
                label: MOVEMENT_TYPE_LABELS[type] ?? type,
                value: total,
              }))}
            />
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
