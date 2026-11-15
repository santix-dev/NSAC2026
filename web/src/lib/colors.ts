import type { Palette } from "@/types/fire";

/** Viridis (matplotlib) — accesible para daltonismo. Extremos #440154 → #fde725. */
export const VIRIDIS = ["#440154", "#482878", "#3e4989", "#31688e", "#26828e", "#1f9e89", "#35b779", "#6ece58", "#b5de2b", "#fde725"];
/** ColorBrewer YlOrRd (9 clases). */
export const YLORRD = ["#ffffcc", "#ffeda0", "#fed976", "#feb24c", "#fd8d3c", "#fc4e2a", "#e31a1c", "#bd0026", "#800026"];

const hex = (h: string) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16));
const toHex = (rgb: number[]) => `#${rgb.map((v) => Math.round(v).toString(16).padStart(2, "0")).join("")}`;

export function interpolate(stops: string[], t: number): string {
  const x = Math.min(1, Math.max(0, t)) * (stops.length - 1);
  const i = Math.min(Math.floor(x), stops.length - 2);
  const a = hex(stops[i]);
  const b = hex(stops[i + 1]);
  const f = x - i;
  return toHex(a.map((v, k) => v + (b[k] - v) * f));
}

export function paletteStops(p: Palette): string[] {
  return p === "viridis" ? VIRIDIS : YLORRD;
}

export function paletteColor(p: Palette, t: number): string {
  return interpolate(paletteStops(p), t);
}

/** Texto legible sobre un color de fondo (luminancia relativa). */
export function textOn(bg: string): string {
  const [r, g, b] = hex(bg).map((v) => {
    const c = v / 255;
    return c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  });
  return 0.2126 * r + 0.7152 * g + 0.0722 * b > 0.35 ? "#0f172a" : "#f8fafc";
}

export function gradientCss(p: Palette): string {
  return `linear-gradient(90deg, ${paletteStops(p).join(", ")})`;
}

export const RISK_COLORS = {
  Bajo: "#2c7bb6",
  Moderado: "#fdd835",
  Alto: "#fb8c00",
  Crítico: "#d7191c",
} as const;

/** Detecciones originales por sensor (naranja / cian: distinguibles con daltonismo rojo-verde) */
export const RAW_COLORS = { MODIS: "#f97316", VIIRS: "#22d3ee" } as const;
