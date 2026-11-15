import type { CalendarCell, MonthlyBaseline, SeriesMode } from "@/types/fire";
import { BASELINE_END, BASELINE_START } from "./regions";

/** Cuantil con interpolación lineal (equivalente a numpy.percentile por defecto). */
export function quantile(values: number[], q: number): number {
  if (values.length === 0) return 0;
  const s = [...values].sort((a, b) => a - b);
  const pos = (s.length - 1) * q;
  const lo = Math.floor(pos);
  const hi = Math.ceil(pos);
  return s[lo] + (s[hi] - s[lo]) * (pos - lo);
}

export function cellValue(c: CalendarCell, mode: SeriesMode): number {
  switch (mode) {
    case "harmonized":
      return c.harmonized_events;
    case "modis":
      return c.modis_cells ?? 0;
    case "viirs":
      return c.viirs_cells ?? 0;
    default:
      return c.raw_events;
  }
}

export const SERIES_INFO: Record<SeriesMode, { label: string; short: string; unit: string; desc: string }> = {
  harmonized: { label: "Armonizada", short: "Armonizada", unit: "eventos armonizados", desc: "MODIS + VIIRS en grilla 1 km con peso α para celdas solo-VIIRS: serie continua 2000–2026." },
  modis: { label: "Solo MODIS", short: "MODIS", unit: "celdas-día MODIS", desc: "Celdas de 1 km con al menos una detección MODIS (Terra/Aqua, 1 km). Serie completa desde nov-2000." },
  viirs: { label: "Solo VIIRS", short: "VIIRS", unit: "celdas-día VIIRS", desc: "Celdas de 1 km con al menos una detección VIIRS (375 m; S-NPP hasta 01-11-2026, NOAA-20 después). Empieza en nov-2012." },
  raw: { label: "Cruda (suma)", short: "Cruda", unit: "detecciones crudas", desc: "Detecciones de ambos sensores sumadas sin armonizar: muestra el salto artificial de 2012." },
};

/** Si la base todavía no devuelve las series por sensor (migración 006 pendiente). */
export function hasSensorSeries(cells: CalendarCell[]): boolean {
  return cells.some((c) => c.modis_cells != null);
}

/** Primer mes con VIIRS 375 m en FIRMS (S-NPP): 20-nov-2012 */
export const VIIRS_START = { year: 2012, month: 11 };
export const hasViirs = (year: number, month: number) =>
  year > VIIRS_START.year || (year === VIIRS_START.year && month >= VIIRS_START.month);

/** Período de referencia: 2001–2020 (METHODOLOGY.md); para la serie solo-VIIRS, 2013–2024 (VIIRS no existe antes). */
export function baselineYears(mode: SeriesMode): [number, number] {
  return mode === "viirs" ? [2013, 2024] : [BASELINE_START, BASELINE_END];
}

/** Línea base mensual P25/P50/P75/P90 sobre el período de referencia. */
export function monthlyBaseline(cells: CalendarCell[], mode: SeriesMode): MonthlyBaseline[] {
  const [y0, y1] = baselineYears(mode);
  return Array.from({ length: 12 }, (_, i) => {
    const month = i + 1;
    const vals = cells
      .filter((c) => c.month === month && c.year >= y0 && c.year <= y1 && c.has_coverage)
      .map((c) => cellValue(c, mode));
    return {
      month,
      p25: quantile(vals, 0.25),
      p50: quantile(vals, 0.5),
      p75: quantile(vals, 0.75),
      p90: quantile(vals, 0.9),
    };
  });
}

/** Anomalía (%) = (E − P50) / (P50 + 1) × 100 */
export function anomalyPct(value: number, p50: number): number {
  return ((value - p50) / (p50 + 1)) * 100;
}

export function formatNumber(v: number, digits = 0): string {
  return v.toLocaleString("es-AR", { maximumFractionDigits: digits, minimumFractionDigits: digits });
}

export function formatSigned(v: number, digits = 0): string {
  return `${v >= 0 ? "+" : ""}${formatNumber(v, digits)}`;
}
