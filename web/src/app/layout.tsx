import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  metadataBase: new URL("https://nsac2026.vercel.app"),
  title: "Foco Cero — Monitoreo satelital de puntos calientes | MODIS + VIIRS armonizados",
  applicationName: "Foco Cero",
  description:
    "Calendario de focos de calor 2000–2026 armonizado (MODIS 1 km + VIIRS 375 m) con calibración transferida desde Sierras de Córdoba, susceptibilidad, prevención e International Charter. NASA Space Apps Challenge 2026.",
  openGraph: {
    title: "Foco Cero — Monitoreo satelital de puntos calientes",
    description: "Focos de calor MODIS + VIIRS armonizados 2000–2026 para la Patagonia Andina. NASA Space Apps Challenge 2026.",
    locale: "es_AR",
    type: "website",
  },
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="es">
      <body className="min-h-screen bg-slate-950 text-slate-200 antialiased">{children}</body>
    </html>
  );
}
