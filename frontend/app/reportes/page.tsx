import { AppShell } from "@/components/layout/app-shell";

export default function ReportsPage() {
  return (
    <AppShell>
      <div className="content">
        <section className="card panelBody">
          <div className="panelHeader">
            <div>
              <h2 className="panelTitle">Reportes</h2>
              <p className="panelText">Resumenes y salidas de informacion del sistema.</p>
            </div>
          </div>
          <div className="emptyState">Esta seccion queda pendiente de configuracion.</div>
        </section>
      </div>
    </AppShell>
  );
}
