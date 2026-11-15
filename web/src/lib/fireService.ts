/**
 * Acceso a datos de PyroSync — siempre datos REALES.
 *  1) Supabase (RPCs PostGIS y tablas: harmonized_hotspots, region_month_env, env_grid_clim, regions).
 *  2) Si no hay variables de Supabase o la base no responde: copia estática de los mismos datos
 *     (web/public/data, etl/export_web_snapshot.py). No hay datos sintéticos en la app.
 */
import type {
  BBox,
  CalendarCell,
  CalendarResult,
  DataSource,
  EnvGridCell,
  HotspotRecord,
  HotspotsResult,
  RecurrenceCell,
  Region,
  RegionMonthEnv,
} from "@/types/fire";
import { bboxIntersects, FALLBACK_REGIONS, hasCoverage, inBBox, YEARS } from "./regions";
import { loadSnapshot } from "./snapshot";
import { getSupabase, isSupabaseConfigured } from "./supabase";

export { isSupabaseConfigured };

const RPC_TIMEOUT_MS = 15_000;
export const MAX_EXPORT_ROWS = 10_000;
export const RECURRENCE_CELL_DEG = 0.05;
const PAGE = 1000; // la API de Supabase devuelve como máximo 1000 filas por pedido

function withTimeout<T>(p: PromiseLike<T>, label: string): Promise<T> {
  return Promise.race([
    Promise.resolve(p),
    new Promise<never>((_, reject) => setTimeout(() => reject(new Error(`${label}: timeout`)), RPC_TIMEOUT_MS)),
  ]);
}

async function rpc<T>(name: string, params: Record<string, unknown>): Promise<T> {
  const sb = getSupabase();
  if (!sb) throw new Error("Supabase no configurado");
  const { data, error } = await withTimeout(sb.rpc(name, params), name);
  if (error) throw new Error(`${name}: ${error.message}`);
  return data as T;
}

async function rpcAll<T>(name: string, params: Record<string, unknown>, maxRows = MAX_EXPORT_ROWS): Promise<T[]> {
  const sb = getSupabase();
  if (!sb) throw new Error("Supabase no configurado");
  const out: T[] = [];
  for (let from = 0; from < maxRows; from += PAGE) {
    const to = Math.min(from + PAGE, maxRows) - 1;
    const { data, error } = await withTimeout(sb.rpc(name, params).range(from, to), name);
    if (error) throw new Error(`${name}: ${error.message}`);
    const page = (data ?? []) as T[];
    out.push(...page);
    if (page.length < to - from + 1) break;
  }
  return out;
}

const bboxParams = (b: BBox) => ({ min_lon: b[0], min_lat: b[1], max_lon: b[2], max_lat: b[3] });
const fallbackNote = (err: unknown) =>
  `Base de datos no disponible (${(err as Error).message}); se muestra la copia estática de los datos reales.`;

// ---------------------------------------------------------------------------
// Regiones (catálogo)
// ---------------------------------------------------------------------------
let knownRegions: Region[] = FALLBACK_REGIONS;

export async function getRegions(): Promise<{ regions: Region[]; source: DataSource }> {
  const sb = getSupabase();
  if (!sb) return { regions: FALLBACK_REGIONS, source: "snapshot" };
  try {
    const { data, error } = await withTimeout(
      sb.from("regions").select("*").eq("active", true).order("sort_order"),
      "regions",
    );
    if (error || !data?.length) throw error ?? new Error("sin regiones");
    knownRegions = data.map((r) => ({
      key: r.key,
      name: r.name,
      subtitle: r.subtitle,
      role: r.role,
      country: r.country,
      bbox: [r.min_lon, r.min_lat, r.max_lon, r.max_lat] as BBox,
      isCalibration: r.is_calibration,
      calibrationRegion: r.calibration_region,
      defaultYear: r.default_year,
    }));
    return { regions: knownRegions, source: "supabase" };
  } catch {
    return { regions: FALLBACK_REGIONS, source: "snapshot" };
  }
}

function regionsIn(bbox: BBox): string[] {
  return knownRegions.filter((r) => bboxIntersects(r.bbox, bbox)).map((r) => r.key);
}

// ---------------------------------------------------------------------------
// Calendario Año × Mes
// ---------------------------------------------------------------------------
type PartialCell = Omit<CalendarCell, "has_coverage" | "cloud_from_model" | "cloud_origin">;

/** Matriz 2000–2026 × 12. Meses sin focos: nubosidad del promedio regional real (MODIS) o sin dato. */
function completeCalendar(partial: PartialCell[], regionEnv: RegionMonthEnv[]): CalendarCell[] {
  const byKey = new Map(partial.map((c) => [`${c.year}-${c.month}`, c]));
  const regCloud = new Map<string, number[]>();
  for (const r of regionEnv) {
    if (r.cloud_cover_pct == null) continue;
    const k = `${r.year}-${r.month}`;
    regCloud.set(k, [...(regCloud.get(k) ?? []), r.cloud_cover_pct]);
  }
  const perSensor = partial.some((p) => p.modis_cells != null);
  const sensor = (v: number | null | undefined) => (perSensor ? Number(v ?? 0) : null);
  const cells: CalendarCell[] = [];
  for (const year of YEARS) {
    for (let month = 1; month <= 12; month++) {
      const cov = hasCoverage(year, month);
      const key = `${year}-${month}`;
      const c = byKey.get(key);
      const reg = regCloud.get(key);
      let cloud: number | null = c?.avg_cloud_cover ?? null;
      let origin: CalendarCell["cloud_origin"] = cloud != null ? "cells" : null;
      if (cloud == null && cov && reg?.length) {
        cloud = reg.reduce((a, b) => a + b, 0) / reg.length;
        origin = "region";
      }
      cells.push({
        year,
        month,
        has_coverage: cov,
        harmonized_events: c?.harmonized_events ?? 0,
        raw_events: c?.raw_events ?? 0,
        active_cells: c?.active_cells ?? 0,
        avg_frp: c?.avg_frp ?? null,
        avg_cloud_cover: cloud,
        cloud_from_model: origin !== "cells",
        cloud_origin: origin,
        avg_soil_moisture: c?.avg_soil_moisture ?? null,
        avg_slope: c?.avg_slope ?? null,
        avg_wind_speed: c?.avg_wind_speed ?? null,
        avg_wind_direction: c?.avg_wind_direction ?? null,
        avg_ndvi: c?.avg_ndvi ?? null,
        modis_cells: sensor(c?.modis_cells),
        viirs_cells: sensor(c?.viirs_cells),
        both_cells: sensor(c?.both_cells),
      });
    }
  }
  return cells;
}

function aggregateCalendar(rows: HotspotRecord[]): PartialCell[] {
  interface Acc {
    w: number; raw: number; n: number; nM: number; nV: number; nB: number; frp: number; nFrp: number; cloud: number; soil: number;
    slope: number; wind: number; sin: number; cos: number; ndvi: number; nEnv: number;
  }
  const acc = new Map<string, Acc>();
  for (const r of rows) {
    const key = r.acq_date.slice(0, 7);
    let a = acc.get(key);
    if (!a) {
      a = { w: 0, raw: 0, n: 0, nM: 0, nV: 0, nB: 0, frp: 0, nFrp: 0, cloud: 0, soil: 0, slope: 0, wind: 0, sin: 0, cos: 0, ndvi: 0, nEnv: 0 };
      acc.set(key, a);
    }
    a.w += r.harmonized_weight;
    a.raw += r.raw_detections_count;
    a.n += 1;
    if (r.sensor_source !== "VIIRS") a.nM++;
    if (r.sensor_source !== "MODIS") a.nV++;
    if (r.sensor_source === "BOTH") a.nB++;
    if (r.max_frp != null) {
      a.frp += r.max_frp;
      a.nFrp++;
    }
    if (r.cloud_cover_pct != null) {
      a.cloud += r.cloud_cover_pct;
      a.soil += r.soil_moisture_pct ?? 0;
      a.slope += r.slope_deg ?? 0;
      a.wind += r.wind_speed_kmh ?? 0;
      const rad = ((r.wind_direction_deg ?? 0) * Math.PI) / 180;
      a.sin += Math.sin(rad);
      a.cos += Math.cos(rad);
      a.ndvi += r.ndvi_pre_fire ?? 0;
      a.nEnv++;
    }
  }
  return [...acc.entries()].map(([key, a]) => {
    const env = a.nEnv > 0;
    return {
      year: Number(key.slice(0, 4)),
      month: Number(key.slice(5, 7)),
      harmonized_events: Math.round(a.w * 10) / 10,
      raw_events: a.raw,
      active_cells: a.n,
      avg_frp: a.nFrp ? a.frp / a.nFrp : null,
      avg_cloud_cover: env ? a.cloud / a.nEnv : null,
      avg_soil_moisture: env ? a.soil / a.nEnv : null,
      avg_slope: env ? a.slope / a.nEnv : null,
      avg_wind_speed: env ? a.wind / a.nEnv : null,
      avg_wind_direction: env ? ((Math.atan2(a.sin, a.cos) * 180) / Math.PI + 360) % 360 : null,
      avg_ndvi: env ? a.ndvi / a.nEnv : null,
      modis_cells: a.nM,
      viirs_cells: a.nV,
      both_cells: a.nB,
    };
  });
}

async function snapshotRowsIn(bbox: BBox, excludeNonFire: boolean): Promise<HotspotRecord[]> {
  const s = await loadSnapshot();
  return s.hotspots.filter(
    (r) => inBBox(r.lat, r.lon, bbox) && (!excludeNonFire || r.thermal_type === "VEGETATION"),
  );
}

async function snapshotCalendar(bbox: BBox, excludeNonFire: boolean, warning?: string): Promise<CalendarResult> {
  const [rows, env] = await Promise.all([snapshotRowsIn(bbox, excludeNonFire), getRegionMonthEnv(bbox, true)]);
  return { cells: completeCalendar(aggregateCalendar(rows), env), source: "snapshot", warning };
}

export async function getBurningCalendar(bbox: BBox, excludeNonFire: boolean): Promise<CalendarResult> {
  if (!isSupabaseConfigured()) return snapshotCalendar(bbox, excludeNonFire);
  try {
    const [data, regionEnv] = await Promise.all([
      rpc<PartialCell[]>("get_burning_calendar_env", { ...bboxParams(bbox), exclude_non_fire: excludeNonFire }),
      getRegionMonthEnv(bbox),
    ]);
    return { cells: completeCalendar(data ?? [], regionEnv), source: "supabase" };
  } catch (err) {
    return snapshotCalendar(bbox, excludeNonFire, fallbackNote(err));
  }
}

// ---------------------------------------------------------------------------
// Variables ambientales reales
// ---------------------------------------------------------------------------
/** Promedios reales región × año × mes. [] si el área no toca ninguna región con datos. */
export async function getRegionMonthEnv(bbox: BBox, forceSnapshot = false): Promise<RegionMonthEnv[]> {
  const regions = regionsIn(bbox);
  if (!regions.length) return [];
  const sb = forceSnapshot ? null : getSupabase();
  if (sb) {
    try {
      const out: RegionMonthEnv[] = [];
      for (let from = 0; ; from += PAGE) {
        const { data, error } = await withTimeout(
          sb.from("region_month_env").select("*").in("region", regions)
            .order("region").order("year").order("month").range(from, from + PAGE - 1),
          "region_month_env",
        );
        if (error) throw error;
        out.push(...((data ?? []) as RegionMonthEnv[]));
        if (!data || data.length < PAGE) break;
      }
      return out;
    } catch {
      /* respaldo abajo */
    }
  }
  try {
    const s = await loadSnapshot();
    return s.regionEnv.filter((r) => regions.includes(r.region));
  } catch {
    return [];
  }
}

/** Climatología real del mes en celdas de 0,05° (env_grid_clim). [] si no hay datos para el área. */
export async function getEnvGrid(bbox: BBox, month: number): Promise<EnvGridCell[]> {
  if (!regionsIn(bbox).length) return [];
  const inside = (g: EnvGridCell) => g.month === month && inBBox(g.lat, g.lon, bbox);
  const sb = getSupabase();
  if (sb) {
    try {
      const out: EnvGridCell[] = [];
      for (let from = 0; ; from += PAGE) {
        const { data, error } = await withTimeout(
          sb.from("env_grid_clim").select("*").eq("month", month)
            .gte("lat", bbox[1]).lte("lat", bbox[3]).gte("lon", bbox[0]).lte("lon", bbox[2])
            .order("cell_id").range(from, from + PAGE - 1),
          "env_grid_clim",
        );
        if (error) throw error;
        out.push(...((data ?? []) as EnvGridCell[]));
        if (!data || data.length < PAGE) break;
      }
      if (out.length) return out;
    } catch {
      /* respaldo abajo */
    }
  }
  try {
    const s = await loadSnapshot();
    return s.grid.filter(inside);
  } catch {
    return [];
  }
}

// ---------------------------------------------------------------------------
// Celdas-día (mapa y exportación)
// ---------------------------------------------------------------------------
export async function getHotspots(
  bbox: BBox,
  startDate: string,
  endDate: string,
  excludeNonFire: boolean,
  maxRows = MAX_EXPORT_ROWS,
): Promise<HotspotsResult> {
  const snapshot = async (warning?: string): Promise<HotspotsResult> => {
    const all = (await snapshotRowsIn(bbox, excludeNonFire))
      .filter((r) => r.acq_date >= startDate && r.acq_date <= endDate)
      .reverse();
    return { rows: all.slice(0, maxRows), truncated: all.length > maxRows, source: "snapshot", warning };
  };
  if (!isSupabaseConfigured()) return snapshot();
  try {
    const rows = await rpcAll<HotspotRecord>(
      "get_hotspots_env",
      { ...bboxParams(bbox), start_date: startDate, end_date: endDate, exclude_non_fire: excludeNonFire, max_rows: maxRows },
      maxRows,
    );
    return { rows, truncated: rows.length >= maxRows, source: "supabase" };
  } catch (err) {
    return snapshot(fallbackNote(err));
  }
}

/** Recurrencia histórica (celdas-día activas 2000–2026) en una grilla de 0,05°. */
export async function getRecurrence(
  bbox: BBox,
  excludeNonFire: boolean,
): Promise<{ cells: RecurrenceCell[]; source: DataSource }> {
  const snapshot = async () => {
    const acc = new Map<string, RecurrenceCell>();
    for (const r of await snapshotRowsIn(bbox, excludeNonFire)) {
      const lat_idx = Math.floor(r.lat / RECURRENCE_CELL_DEG);
      const lon_idx = Math.floor(r.lon / RECURRENCE_CELL_DEG);
      const k = `${lat_idx}_${lon_idx}`;
      const c = acc.get(k) ?? { lat_idx, lon_idx, cell_days: 0 };
      c.cell_days++;
      acc.set(k, c);
    }
    return { cells: [...acc.values()], source: "snapshot" as const };
  };
  if (!isSupabaseConfigured()) return snapshot();
  try {
    const cells = await rpcAll<RecurrenceCell>(
      "get_cell_recurrence",
      { ...bboxParams(bbox), cell_size: RECURRENCE_CELL_DEG, exclude_non_fire: excludeNonFire },
      50_000,
    );
    return { cells, source: "supabase" };
  } catch {
    return snapshot();
  }
}

/** α de calibración (Córdoba): en la base es el peso de cualquier celda-día solo-VIIRS. */
export async function getCalibrationAlpha(): Promise<{ alpha: number | null; source: DataSource }> {
  const snapshot = async () => {
    try {
      return { alpha: (await loadSnapshot()).alpha, source: "snapshot" as const };
    } catch {
      return { alpha: null, source: "snapshot" as const };
    }
  };
  const sb = getSupabase();
  if (!sb) return snapshot();
  try {
    const { data, error } = await withTimeout(
      sb
        .from("harmonized_hotspots")
        .select("harmonized_weight")
        .eq("sensor_source", "VIIRS")
        .order("acq_date", { ascending: true }) // α de S-NPP (calibración); NOAA-20 usa α·β desde 02-11-2026
        .limit(1),
      "alpha",
    );
    if (error) throw error;
    return { alpha: data?.[0]?.harmonized_weight ?? null, source: "supabase" };
  } catch {
    return snapshot();
  }
}

// ---------------------------------------------------------------------------
// Exportación CSV
// ---------------------------------------------------------------------------
export const CSV_COLUMNS: (keyof HotspotRecord)[] = [
  "grid_cell_id", "region", "acq_date", "lat", "lon", "harmonized_weight", "raw_detections_count",
  "sensor_source", "max_frp", "thermal_type", "slope_deg", "soil_moisture_pct", "cloud_cover_pct",
  "wind_speed_kmh", "wind_direction_deg", "ndvi_pre_fire", "wind_max_kmh", "env_source",
];

export function hotspotsToCsv(rows: HotspotRecord[]): string {
  const esc = (v: unknown) => {
    if (v == null) return "";
    const s = String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [CSV_COLUMNS.join(",")];
  for (const r of rows) lines.push(CSV_COLUMNS.map((c) => esc(r[c])).join(","));
  return lines.join("\n");
}

export function downloadText(filename: string, text: string, mime = "text/csv;charset=utf-8") {
  const blob = new Blob(["﻿", text], { type: mime });
  const href = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = href;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  URL.revokeObjectURL(href);
}
