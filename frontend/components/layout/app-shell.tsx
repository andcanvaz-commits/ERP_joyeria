"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useState } from "react";
import { BarChart3, Boxes, FileText, LayoutDashboard, LogOut, Settings, Shield, UserCircle } from "lucide-react";
import { clearAccessToken, getAccessToken } from "@/lib/api";
import { getCurrentUser, type CurrentUser } from "@/lib/auth-api";

const navItems = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/produccion", label: "Mantenimientos", icon: Settings },
  { href: "/inventario", label: "Inventario", icon: Boxes },
  { href: "/reportes", label: "Reportes", icon: BarChart3 },
  { href: "/documentos", label: "Documentos", icon: FileText },
  { href: "/seguridad", label: "Seguridad", icon: Shield }
];

const pageTitles: Record<string, { title: string; subtitle: string }> = {
  "/dashboard": {
    title: "Dashboard",
    subtitle: "Resumen de procesos y usuarios",
  },
  "/produccion": {
    title: "Mantenimientos del sistema",
    subtitle: "Administracion de configuraciones base",
  },
  "/inventario": {
    title: "Inventario",
    subtitle: "Materia prima, productos en proceso y productos terminados",
  },
};

export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const [currentUser, setCurrentUser] = useState<CurrentUser | null>(null);
  const currentPage = pageTitles[pathname] ?? pageTitles["/dashboard"];

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
          <div className="brandMark">ERP</div>
          <div className="brandText">
            <span className="brandName">Joyeria</span>
            <span className="brandMeta">Operacion interna</span>
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
              <strong>{currentUser?.username ?? "admin"}</strong>
              <span>{currentUser?.role ?? "admin"}</span>
            </div>
            <button
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
