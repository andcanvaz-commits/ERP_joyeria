import type { Metadata, Viewport } from "next";
import { IBM_Plex_Sans, IBM_Plex_Mono, Marcellus } from "next/font/google";
import "./globals.css";
import { Providers } from "./providers";

const display = IBM_Plex_Sans({
  subsets: ["latin"],
  display: "swap",
  weight: ["600", "700"],
  variable: "--font-display",
});

// Serif lapidaria (estilo inscripcion de grabador) solo para identidad y titulos;
// los datos siguen en Plex Sans/Mono.
const serif = Marcellus({
  subsets: ["latin"],
  display: "swap",
  weight: "400",
  variable: "--font-serif",
});

const body = IBM_Plex_Sans({
  subsets: ["latin"],
  display: "swap",
  weight: ["400", "500", "600"],
  variable: "--font-body",
});

const mono = IBM_Plex_Mono({
  subsets: ["latin"],
  display: "swap",
  weight: ["400", "500"],
  variable: "--font-mono",
  // Solo aparece en códigos de lote (tras cargar datos): sin preload para no
  // disparar la advertencia de "preloaded but not used" del navegador.
  preload: false,
});

export const metadata: Metadata = {
  title: "Fénix Global",
  description: "Sistema ERP para produccion e inventario de joyeria"
};

// Escala correcta en celulares y tablets; el zoom del usuario queda permitido.
export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es" className={`${display.variable} ${serif.variable} ${body.variable} ${mono.variable}`}>
      <body>
        <Providers>{children}</Providers>
      </body>
    </html>
  );
}
