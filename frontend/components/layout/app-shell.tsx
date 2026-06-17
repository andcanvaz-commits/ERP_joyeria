import Link from "next/link";
import { BarChart3, Boxes, Factory, FileText, LayoutDashboard, Shield, Users } from "lucide-react";

const navItems = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/produccion", label: "Produccion", icon: Factory, active: true },
  { href: "/inventario", label: "Inventario", icon: Boxes },
  { href: "/reportes", label: "Reportes", icon: BarChart3 },
  { href: "/documentos", label: "Documentos", icon: FileText },
  { href: "/usuarios", label: "Usuarios", icon: Users },
  { href: "/seguridad", label: "Seguridad", icon: Shield }
];

export function AppShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="appShell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brandMark">ERP</div>
          <div className="brandText">
            <span className="brandName">Joyeria</span>
            <span className="brandMeta">Operacion interna</span>
          </div>
        </div>
        <nav className="nav" aria-label="Navegacion principal">
          {navItems.map((item) => {
            const Icon = item.icon;
            return (
              <Link
                className={`navItem ${item.active ? "navItemActive" : ""}`}
                href={item.href}
                key={item.href}
              >
                <Icon aria-hidden="true" size={18} />
                <span>{item.label}</span>
              </Link>
            );
          })}
        </nav>
      </aside>
      <main className="mainArea">
        <header className="topbar">
          <div className="topbarTitle">
            <strong>Produccion</strong>
            <span>Configuracion de procesos y ejecucion operativa</span>
          </div>
        </header>
        {children}
      </main>
    </div>
  );
}
