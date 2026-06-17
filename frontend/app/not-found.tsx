import Link from "next/link";
import { AppShell } from "@/components/layout/app-shell";

export default function NotFoundPage() {
  return (
    <AppShell>
      <div className="content">
        <section className="card emptyState">
          <strong>Pagina no encontrada</strong>
          <span>La ruta solicitada todavia no existe en el ERP.</span>
          <Link className="button buttonPrimary" href="/produccion">
            Ir a produccion
          </Link>
        </section>
      </div>
    </AppShell>
  );
}
