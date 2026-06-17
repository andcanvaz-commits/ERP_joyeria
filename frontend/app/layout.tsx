import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "ERP Joyeria",
  description: "Sistema ERP para produccion e inventario de joyeria"
};

export default function RootLayout({
  children
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
