// Normalizacion y permisos de navegacion por rol.
// El control de acceso real vive en el backend; esto solo decide que ve la UI.

// "operaciones" = rol fusionado Produccion/Inventario (docs/cambios-sistema-produccion.md
// seccion 2): hereda las rutas que antes tenian por separado produccion e
// inventario, ya no hay dos identidades distintas en el frontend.
export type Role = "admin" | "operaciones" | "unknown";

export function normalizeRole(role?: string | null): Role {
  const value = (role ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, ""); // quita acentos: "produccion" -> "produccion"
  if (value === "admin") return "admin";
  if (value.includes("produccion") || value.includes("inventario")) return "operaciones";
  return "unknown";
}

export function allowedRoutes(role: Role): string[] {
  switch (role) {
    case "admin":
      return [
        "/dashboard",
        "/mantenimientos",
        "/produccion",
        "/inventario",
        "/solicitudes",
        "/documentos",
        "/reportes",
        "/seguridad",
      ];
    case "operaciones":
      return ["/dashboard", "/produccion", "/inventario", "/solicitudes", "/documentos", "/reportes", "/seguridad"];
    default:
      return ["/seguridad"];
  }
}

export function homeRoute(role: Role): string {
  if (role === "admin" || role === "operaciones") return "/dashboard";
  return "/seguridad";
}

export function canAccess(role: Role, path: string): boolean {
  return allowedRoutes(role).some((route) => path === route || path.startsWith(`${route}/`));
}
