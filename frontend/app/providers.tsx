"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { useState } from "react";

// Caché de datos en cliente. Al navegar entre pestañas, los datos ya cargados se
// muestran al instante desde caché y se revalidan en segundo plano si están
// obsoletos, en vez de re-pedir todo en cada visita.
export function Providers({ children }: { children: React.ReactNode }) {
  const [client] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            staleTime: 30_000, // 30s: dentro de esa ventana no re-pide al navegar
            gcTime: 5 * 60_000, // 5min en caché tras dejar de usarse
            refetchOnWindowFocus: false,
            retry: 1,
          },
        },
      }),
  );
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
