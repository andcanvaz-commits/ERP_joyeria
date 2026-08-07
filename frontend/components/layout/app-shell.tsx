"use client";

import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { BarChart3, Boxes, ChevronDown, ClipboardList, Factory, FileText, KeyRound, LayoutDashboard, LogOut, Menu, UserCircle, Wrench } from "lucide-react";
import { isAuthenticated } from "@/lib/api";
import { getCurrentUser, logout } from "@/lib/auth-api";
import { listProductionRuns } from "@/lib/production-api";
import { allowedRoutes, canAccess, homeRoute, normalizeRole } from "@/lib/roles";
import { useModalA11y } from "@/hooks/use-modal-a11y";

const navItems = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/mantenimientos", label: "Mantenimientos", icon: Wrench },
  { href: "/produccion", label: "Producción", icon: Factory },
  { href: "/inventario", label: "Inventario", icon: Boxes },
  { href: "/solicitudes", label: "Solicitudes", icon: ClipboardList },
  { href: "/documentos", label: "Documentos", icon: FileText },
  { href: "/reportes", label: "Estadísticas", icon: BarChart3 }
];

const pageTitles: Record<string, { title: string; subtitle: string }> = {
  "/dashboard": {
    title: "Dashboard",
    subtitle: "Resumen de procesos y usuarios",
  },
  "/produccion": {
    title: "Producción",
    subtitle: "Ejecución de procesos y seguimiento de etapas",
  },
  "/mantenimientos": {
    title: "Mantenimientos",
    subtitle: "Procesos, usuarios y configuraciones del sistema",
  },
  "/inventario": {
    title: "Inventario",
    subtitle: "Materia prima, productos en proceso y productos terminados",
  },
  "/reportes": {
    title: "Estadísticas",
    subtitle: "Resúmenes y salidas de información",
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
  const router = useRouter();
  const [menuOpen, setMenuOpen] = useState(false);
  // Drawer del sidebar en móvil (≤680px); en pantallas grandes no aplica.
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement | null>(null);
  const currentPage = pageTitles[pathname] ?? pageTitles["/dashboard"];

  useModalA11y();

  // Usuario en caché compartida (['me']): se pide una vez y otras pantallas lo
  // reutilizan sin volver a pedirlo.
  const { data: currentUser = null } = useQuery({
    queryKey: ["me"],
    queryFn: getCurrentUser,
    enabled: isAuthenticated(),
  });

  const role = normalizeRole(currentUser?.role);
  const visibleNav = currentUser ? navItems.filter((item) => allowedRoutes(role).includes(item.href)) : [];

  // Ordenes de produccion (cache compartida con Solicitudes). Se refresca sola
  // cada 30s para que el punto rojo del menu no quede desactualizado.
  const { data: navRuns = [] } = useQuery({
    queryKey: ["solicitudes"],
    queryFn: listProductionRuns,
    enabled: isAuthenticated() && Boolean(currentUser),
    refetchInterval: 10000,
    refetchOnWindowFocus: true,
  });

  // Pendientes por seccion: inventario aprueba/recibe; produccion inicia las
  // ordenes con materiales aprobados. El punto rojo aparece donde hay accion.
  const invPending = navRuns.filter(
    (run) =>
      (run.status === "PENDIENTE_INVENTARIO" || run.status === "PENDIENTE_RECEPCION") &&
      (run.event_lines ?? []).length === 0,
  ).length;
  const prodPending = navRuns.filter((run) => run.status === "MATERIALES_APROBADOS").length;
  const navBadges: Record<string, number> = {
    "/inventario": invPending,
    "/produccion": prodPending,
    "/solicitudes": role === "inventario" ? invPending : prodPending,
  };

  // Cambio forzado de contrasena temporal: se realiza en la pantalla de login.
  useEffect(() => {
    if (currentUser?.must_change_password && pathname !== "/login") {
      router.replace("/login");
    }
  }, [currentUser, pathname, router]);

  // Guard por rol: si la ruta no corresponde al rol, redirige a su inicio.
  useEffect(() => {
    if (!currentUser || currentUser.must_change_password) return;
    if (!canAccess(role, pathname)) {
      router.replace(homeRoute(role));
    }
  }, [currentUser, role, pathname, router]);

  // Cierra el menu de perfil al hacer clic fuera o presionar Escape.
  useEffect(() => {
    if (!menuOpen) return;
    function onPointerDown(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setMenuOpen(false);
    }
    document.addEventListener("mousedown", onPointerDown);
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.removeEventListener("mousedown", onPointerDown);
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [menuOpen]);

  // Al navegar se cierra el drawer; con Escape también.
  useEffect(() => {
    setSidebarOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!sidebarOpen) return;
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setSidebarOpen(false);
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [sidebarOpen]);

  function handleLogout() {
    setMenuOpen(false);
    void logout().finally(() => {
      window.location.href = "/login";
    });
  }

  return (
    <div className="appShell">
      {sidebarOpen ? (
        <div aria-hidden="true" className="sidebarBackdrop" onClick={() => setSidebarOpen(false)} />
      ) : null}
      <aside className={`sidebar${sidebarOpen ? " sidebarOpen" : ""}`}>
        <div className="brand">
          <div className="brandMark">Au</div>
          <div className="brandText">
            <span className="brandName">Fenix Global</span>
          </div>
        </div>
        <nav className="nav" aria-label="Navegacion principal">
          {visibleNav.map((item) => {
            const Icon = item.icon;
            const isActive = pathname === item.href;
            const badge = navBadges[item.href] ?? 0;
            return (
              <Link
                className={`navItem ${isActive ? "navItemActive" : ""}`}
                href={item.href}
                key={item.href}
                title={item.label}
              >
                <Icon aria-hidden="true" size={18} />
                <span>{item.label}</span>
                {badge > 0 ? (
                  <span className="navBadge" aria-label={`${badge} pendientes`}>{badge > 9 ? "9+" : badge}</span>
                ) : null}
              </Link>
            );
          })}
        </nav>
        <div className="profileMenu sidebarProfile" ref={menuRef}>
          <button
            aria-expanded={menuOpen}
            aria-haspopup="menu"
            className="profileTrigger"
            onClick={() => setMenuOpen((open) => !open)}
            type="button"
          >
            <UserCircle aria-hidden="true" size={26} />
            <div className="profileText">
              {/* Se trunca con puntos suspensivos si no cabe; el title deja
                  consultar el correo completo al pasar el mouse. */}
              <strong title={currentUser?.email ?? currentUser?.username ?? undefined}>
                {currentUser?.email ?? currentUser?.username ?? ""}
              </strong>
              <span>({currentUser?.role ?? ""})</span>
            </div>
            <ChevronDown aria-hidden="true" size={16} />
          </button>
          {menuOpen ? (
            <div className="profileDropdown" role="menu">
              <Link
                className="profileDropdownItem"
                href="/seguridad"
                onClick={() => setMenuOpen(false)}
                role="menuitem"
              >
                <KeyRound aria-hidden="true" size={16} />
                <span>Cambiar contrasena</span>
              </Link>
              <button
                className="profileDropdownItem"
                onClick={handleLogout}
                role="menuitem"
                type="button"
              >
                <LogOut aria-hidden="true" size={16} />
                <span>Cerrar sesion</span>
              </button>
            </div>
          ) : null}
        </div>
      </aside>
      <main className="mainArea">
        <header className="topbar">
          <button
            aria-expanded={sidebarOpen}
            aria-label="Abrir menu de navegacion"
            className="iconOnlyButton menuButton"
            onClick={() => setSidebarOpen(true)}
            type="button"
          >
            <Menu aria-hidden="true" size={20} />
          </button>
          <div className="topbarTitle">
            <strong>{currentPage.title}</strong>
            <span>{currentPage.subtitle}</span>
          </div>
          {/* Slot para acciones de la pagina (ej. bandeja de solicitudes en inventario). */}
          <div id="topbarSlot" className="topbarSlot" />
        </header>
        {children}
      </main>
    </div>
  );
}
