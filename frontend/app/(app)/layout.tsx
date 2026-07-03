import { AppShell } from "@/components/layout/app-shell";

// Layout compartido de las rutas autenticadas: el AppShell (sidebar + topbar)
// se monta una sola vez y persiste al navegar entre pestañas, por lo que no
// parpadea ni se recarga. Solo cambia el contenido de la página.
export default function AppGroupLayout({ children }: { children: React.ReactNode }) {
  return <AppShell>{children}</AppShell>;
}
