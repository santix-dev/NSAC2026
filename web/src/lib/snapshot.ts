/**
 * Copia estática de los datos REALES (web/public/data, generada por etl/export_web_snapshot.py).
 * Se usa solo si Supabase no está configurado o no responde: mismos registros que la base,
 * nunca datos sintéticos.
 */
import type { EnvGridCell, HotspotRecord, RegionMonthEnv } from "@/types/fire";

export interface Snapshot {
  hotspots: HotspotRecord[];
  regionEnv: RegionMonthEnv[];
  grid: EnvGridCell[];
  alpha: number | null;
}

const STRING_COLS = new Set([
  "grid_cell_id", "region", "acq_date", "sensor_source", "thermal_type", "env_source", "cell_id",
  "acq_time", "sensor", "platform", "confidence", "in_calendar",
]);

function parseCsv<T>(text: string): T[] {
  const lines = text.trim().split(/\r?\n/);
  const head = lines[0].split(",");
  const out: T[] = [];
  for (let i = 1; i < lines.length; i++) {
    const cols = lines[i].split(",");
    const row: Record<string, string | number | null> = {};
    head.forEach((h, j) => {
      const v = cols[j];
      if (v === undefined || v === "") row[h] = null;
      else row[h] = STRING_COLS.has(h) ? v : Number(v);
    });
    out.push(row as T);
  }
  return out;
}

async function getText(path: string): Promise<string | null> {
  try {
    const res = await fetch(path);
    return res.ok ? await res.text() : null;
  } catch {
    return null;
  }
}

let cache: Promise<Snapshot> | null = null;

export function loadSnapshot(): Promise<Snapshot> {
  if (!cache) {
    cache = (async () => {
      const [h, r, g, m] = await Promise.all([
        getText("/data/hotspots.csv"),
        getText("/data/region_month_env.csv"),
        getText("/data/env_grid_clim.csv"),
        getText("/data/meta.json"),
      ]);
      if (!h) throw new Error("No se encontró la copia de datos (web/public/data/hotspots.csv)");
      let alpha: number | null = null;
      try {
        alpha = m ? (JSON.parse(m).alpha ?? null) : null;
      } catch {
        alpha = null;
      }
      return {
        hotspots: parseCsv<HotspotRecord>(h),
        regionEnv: r ? parseCsv<RegionMonthEnv>(r) : [],
        grid: g ? parseCsv<EnvGridCell>(g) : [],
        alpha,
      };
    })();
    cache.catch(() => {
      cache = null;
    });
  }
  return cache;
}

let rawCache: Promise<import("@/types/fire").RawDetection[] | null> | null = null;

/** Detecciones originales de la copia estática (se carga aparte y solo si se piden). */
export function loadSnapshotRaw(): Promise<import("@/types/fire").RawDetection[] | null> {
  if (!rawCache) {
    rawCache = getText("/data/raw_detections.csv").then((t) => {
      if (!t) return null;
      return parseCsv<Record<string, unknown>>(t).map((r) => ({
        ...(r as unknown as import("@/types/fire").RawDetection),
        in_calendar: String(r.in_calendar) === "True" || String(r.in_calendar) === "true" || r.in_calendar === 1,
      }));
    });
  }
  return rawCache;
}
