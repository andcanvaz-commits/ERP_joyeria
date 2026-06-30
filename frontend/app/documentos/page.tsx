import { AppShell } from "@/components/layout/app-shell";

export default function DocumentsPage() {
  return (
    <AppShell>
      <div className="content">
        <section className="card panelBody">
          <div className="panelHeader">
            <div>
              <h2 className="panelTitle">Documentos</h2>
              <p className="panelText">Actas, comprobantes y documentos operativos.</p>
            </div>
          </div>
          <div className="emptyState">Los formatos imprimibles se agregaran cuando se defina el diseno final.</div>
        </section>
      </div>
    </AppShell>
  );
}
