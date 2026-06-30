import type { Metadata } from "next";
import { Inter, Cormorant_Garamond } from "next/font/google";
import "./globals.css";

const sans = Inter({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-sans"
});

const serif = Cormorant_Garamond({
  subsets: ["latin"],
  display: "swap",
  weight: ["500", "600", "700"],
  variable: "--font-serif"
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
    <html lang="es" className={`${sans.variable} ${serif.variable}`}>
      <body>{children}</body>
    </html>
  );
}
