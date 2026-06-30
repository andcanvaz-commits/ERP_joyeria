import { AppShell } from "@/components/layout/app-shell";

export default function SecurityPage() {
  return (
    <AppShell>
      <div className="content">
        <section className="card panelBody">
          <div className="panelHeader">
            <div>
              <h2 className="panelTitle">Seguridad</h2>
              <p className="panelText">Permisos, perfiles y controles de acceso.</p>
            </div>
          </div>
          <div className="emptyState">La administracion detallada de seguridad queda pendiente.</div>
        </section>
      </div>
    </AppShell>
  );
}
