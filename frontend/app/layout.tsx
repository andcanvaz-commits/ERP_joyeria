import type { Metadata } from "next";
import { Saira_Condensed, Hanken_Grotesk, IBM_Plex_Mono } from "next/font/google";
import "./globals.css";

const display = Saira_Condensed({
  subsets: ["latin"],
  display: "swap",
  weight: ["600", "700"],
  variable: "--font-display",
});

const body = Hanken_Grotesk({
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
});

export const metadata: Metadata = {
  title: "Fenix Global - ERP Joyeria",
  description: "Sistema ERP para produccion e inventario de joyeria"
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es" className={`${display.variable} ${body.variable} ${mono.variable}`}>
      <body>{children}</body>
    </html>
  );
}
