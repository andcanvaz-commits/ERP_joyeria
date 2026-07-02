// Normalizacion y permisos de navegacion por rol.
// El control de acceso real vive en el backend; esto solo decide que ve la UI.

export type Role = "admin" | "produccion" | "inventario" | "unknown";

export function normalizeRole(role?: string | null): Role {
  const value = (role ?? "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, ""); // quita acentos: "produccion" -> "produccion"
  if (value === "admin") return "admin";
  if (value.includes("produccion")) return "produccion";
  if (value.includes("inventario")) return "inventario";
  return "unknown";
}

export function allowedRoutes(role: Role): string[] {
  switch (role) {
    case "admin":
      return [
        "/dashboard",
        "/mantenimientos",
        "/codificacion",
        "/produccion",
        "/inventario",
        "/documentos",
        "/reportes",
        "/seguridad",
      ];
    case "produccion":
      return ["/dashboard", "/produccion", "/solicitudes", "/documentos", "/reportes", "/seguridad"];
    case "inventario":
      return ["/dashboard", "/inventario", "/solicitudes", "/documentos", "/reportes", "/seguridad"];
    default:
      return ["/seguridad"];
  }
}

export function homeRoute(role: Role): string {
  if (role === "produccion") return "/produccion";
  if (role === "inventario") return "/inventario";
  if (role === "admin") return "/dashboard";
  return "/seguridad";
}

export function canAccess(role: Role, path: string): boolean {
  return allowedRoutes(role).some((route) => path === route || path.startsWith(`${route}/`));
}
