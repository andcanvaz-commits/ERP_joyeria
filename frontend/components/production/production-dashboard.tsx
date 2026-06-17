import { ClipboardList, Factory, PackageCheck, PauseCircle, Plus, RefreshCw } from "lucide-react";
import { StatusBadge } from "@/components/ui/status-badge";
import type { ProductionOrderSummary } from "@/types/production";

const demoOrders: ProductionOrderSummary[] = [
  {
    id: "OP-0001",
    productName: "Producto configurado",
    processName: "Proceso dinamico",
    quantity: "12.0000",
    status: "PENDIENTE",
    stages: "0 / 4",
    inventoryHandoff: "Pendiente de integracion"
  },
  {
    id: "OP-0002",
    productName: "Producto configurado",
    processName: "Proceso dinamico",
    quantity: "6.0000",
    status: "EN_PROCESO",
    stages: "2 / 5",
    inventoryHandoff: "Pendiente de integracion"
  },
  {
    id: "OP-0003",
    productName: "Producto configurado",
    processName: "Proceso dinamico",
    quantity: "3.0000",
    status: "PAUSADA",
    stages: "1 / 3",
    inventoryHandoff: "Pendiente de integracion"
  }
];

const metrics = [
  { label: "Ordenes activas", value: "3" },
  { label: "En proceso", value: "1" },
  { label: "Pausadas", value: "1" },
  { label: "Pendientes inventario", value: "3" }
];

export function ProductionDashboard() {
  return (
    <div className="content">
      <section className="pageHeader">
        <div>
          <h1>Produccion</h1>
          <p>
            Control operativo de ordenes, etapas dinamicas y seguimiento del traspaso pendiente hacia inventario.
          </p>
        </div>
        <div className="actions">
          <button className="button" type="button">
            <RefreshCw aria-hidden="true" size={17} />
            Actualizar
          </button>
          <button className="button buttonPrimary" type="button">
            <Plus aria-hidden="true" size={17} />
            Nueva orden
          </button>
        </div>
      </section>

      <section className="summaryGrid" aria-label="Resumen de produccion">
        {metrics.map((metric) => (
          <article className="card metric" key={metric.label}>
            <span className="metricLabel">{metric.label}</span>
            <strong className="metricValue">{metric.value}</strong>
          </article>
        ))}
      </section>

      <section className="card">
        <div className="toolbar">
          <div className="filters">
            <input className="field" placeholder="Buscar orden" aria-label="Buscar orden" />
            <select className="field" aria-label="Estado">
              <option>Todos los estados</option>
              <option>Pendiente</option>
              <option>En proceso</option>
              <option>Pausada</option>
              <option>Finalizada</option>
              <option>Cancelada</option>
            </select>
          </div>
          <button className="button" type="button">
            <ClipboardList aria-hidden="true" size={17} />
            Plantillas
          </button>
        </div>
        <div className="tableWrap">
          <table className="table">
            <thead>
              <tr>
                <th>Orden</th>
                <th>Producto</th>
                <th>Proceso</th>
                <th>Cantidad</th>
                <th>Estado</th>
                <th>Etapas</th>
                <th>Inventario</th>
              </tr>
            </thead>
            <tbody>
              {demoOrders.map((order) => (
                <tr key={order.id}>
                  <td>{order.id}</td>
                  <td>{order.productName}</td>
                  <td>{order.processName}</td>
                  <td>{order.quantity}</td>
                  <td>
                    <StatusBadge status={order.status} />
                  </td>
                  <td>{order.stages}</td>
                  <td>{order.inventoryHandoff}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="integrationPanel">
        <article className="card panelBody">
          <h2 className="panelTitle">Etapas dinamicas</h2>
          <p className="panelText">
            Las ordenes deben usar plantillas configuradas desde datos y conservar snapshots historicos de sus etapas.
          </p>
          <div className="emptyState">
            <Factory aria-hidden="true" size={26} />
            <span>La conexion con datos reales quedara disponible cuando JWT y permisos esten listos.</span>
          </div>
        </article>
        <article className="card panelBody">
          <h2 className="panelTitle">Integracion con inventario</h2>
          <p className="panelText">
            Produccion solo muestra el punto de entrega; inventario sera responsable de disponibilidad, reservas y movimientos.
          </p>
          <div className="actions">
            <button className="button" type="button">
              <PauseCircle aria-hidden="true" size={17} />
              Pausar
            </button>
            <button className="button" type="button">
              <PackageCheck aria-hidden="true" size={17} />
              Finalizar
            </button>
          </div>
        </article>
      </section>
    </div>
  );
}
