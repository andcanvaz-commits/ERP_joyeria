"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { BarChart3, Boxes, Factory, FileText, Hash, LayoutDashboard, LogOut, UserCircle, Wrench } from "lucide-react";
import { clearAccessToken, getAccessToken } from "@/lib/api";
import { getCurrentUser, type CurrentUser } from "@/lib/auth-api";
import { useModalA11y } from "@/hooks/use-modal-a11y";

const navItems = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/mantenimientos", label: "Mantenimientos", icon: Wrench },
  { href: "/codificacion", label: "Codificacion", icon: Hash },
  { href: "/produccion", label: "Produccion", icon: Factory },
  { href: "/inventario", label: "Inventario", icon: Boxes },
  { href: "/documentos", label: "Documentos", icon: FileText },
  { href: "/reportes", label: "Reportes", icon: BarChart3 }
];

const pageTitles: Record<string, { title: string; subtitle: string }> = {
  "/dashboard": {
    title: "Dashboard",
    subtitle: "Resumen de procesos y usuarios",
  },
  "/produccion": {
    title: "Produccion",
    subtitle: "Ejecucion de procesos y seguimiento de etapas",
  },
  "/mantenimientos": {
    title: "Mantenimientos",
    subtitle: "Procesos, usuarios y configuraciones del sistema",
  },
  "/codificacion": {
    title: "Codificacion",
    subtitle: "Codigos de productos, materiales y categorias",
  },
  "/inventario": {
    title: "Inventario",
    subtitle: "Materia prima, productos en proceso y productos terminados",
  },
  "/reportes": {
    title: "Reportes",
    subtitle: "Resumenes y salidas de informacion",
  },
  "/documentos": {
    title: "Documentos",
    subtitle: "Actas y comprobantes operativos",
  },
  "/seguridad": {
    title: "Seguridad",
    subtitle: "Permisos y controles de acceso",
  },
};

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [currentUser, setCurrentUser] = useState<CurrentUser | null>(null);
  const currentPage = pageTitles[pathname] ?? pageTitles["/dashboard"];

  useModalA11y();

  useEffect(() => {
    if (!getAccessToken()) return;
    getCurrentUser()
      .then(setCurrentUser)
      .catch(() => setCurrentUser(null));
  }, []);

  return (
    <div className="appShell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brandMark">Au</div>
          <div className="brandText">
            <span className="brandName">Fenix Global</span>
            <span className="brandMeta">Joyeria</span>
          </div>
        </div>
        <nav className="nav" aria-label="Navegacion principal">
          {navItems.map((item) => {
            const Icon = item.icon;
            const isActive = pathname === item.href;
            return (
              <Link
                className={`navItem ${isActive ? "navItemActive" : ""}`}
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
            <strong>{currentPage.title}</strong>
            <span>{currentPage.subtitle}</span>
          </div>
          <div className="profileMenu">
            <UserCircle aria-hidden="true" size={28} />
            <div className="profileText">
              <strong>{currentUser?.email ?? currentUser?.username ?? ""}</strong>
              <span>({currentUser?.role ?? ""})</span>
            </div>
            <button
              aria-label="Cerrar sesion"
              className="iconOnlyButton"
              onClick={() => {
                clearAccessToken();
                window.location.href = "/login";
              }}
              title="Salir"
              type="button"
            >
              <LogOut aria-hidden="true" size={18} />
            </button>
          </div>
        </header>
        {children}
      </main>
    </div>
  );
}
