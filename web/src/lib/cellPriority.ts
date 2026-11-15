/**
 * Prioridad de atención de cada sensor dentro de una celda armonizada (0,01° × día).
 *
 * La celda armonizada cuenta "hubo fuego"; la prioridad vive en las detecciones originales.
 * Acá se cruzan: para cada celda-día se toma el nivel MÁXIMO de las detecciones MODIS y el de las
 * VIIRS que caen en ella (misma regla de celda que el ETL: floor(lat·100)_floor(lon·100)).
 * Cada nivel está en la escala PROPIA de su sensor (etl/priority_scale.py): que coincidan significa
 * que ambos sensores ubican ese fuego en el mismo escalón relativo, no que midan lo mismo.
 */
import type { HotspotRecord, RawDetection } from "@/types/fire";

export type Level = 1 | 2 | 3 | 4;
export interface CellPriority {
  m: Level | null;
  v: Level | null;
}
export type Agreement = "all" | "same" | "diff";

export const cellKey = (lat: number, lon: number, date: string) =>
  `${Math.floor(lat * 100)}_${Math.floor(lon * 100)}|${date}`;

export function buildCellPriority(rows: RawDetection[] | null | undefined): Map<string, CellPriority> {
  const map = new Map<string, CellPriority>();
  if (!rows) return map;
  for (const r of rows) {
    if (!r.in_calendar || !r.priority_level) continue; // solo plataformas de la serie armonizada
    const k = cellKey(r.lat, r.lon, r.acq_date);
    const c = map.get(k) ?? { m: null, v: null };
    const lv = Number(r.priority_level) as Level;
    if (r.sensor === "MODIS") c.m = c.m == null || lv > c.m ? lv : c.m;
    else c.v = c.v == null || lv > c.v ? lv : c.v;
    map.set(k, c);
  }
  return map;
}

export const priorityOf = (map: Map<string, CellPriority>, h: HotspotRecord): CellPriority =>
  map.get(`${h.grid_cell_id}|${h.acq_date}`) ?? { m: null, v: null };

export function passesAgreement(p: CellPriority, h: HotspotRecord, a: Agreement): boolean {
  if (a === "all") return true;
  if (h.sensor_source !== "BOTH" || p.m == null || p.v == null) return false;
  return a === "same" ? p.m === p.v : p.m !== p.v;
}

export interface Concordance {
  /** matrix[MODIS-1][VIIRS-1] */
  matrix: number[][];
  n: number;
  exactPct: number;
  within1Pct: number;
  kappa: number | null;
  /** celdas vistas por ambos sensores sin prioridad en alguno de los dos (detecciones fuera de la serie) */
  missing: number;
}

/** Matriz de concordancia MODIS × VIIRS sobre las celdas vistas por ambos sensores. */
export function concordance(cells: HotspotRecord[], map: Map<string, CellPriority>): Concordance {
  const matrix = [0, 1, 2, 3].map(() => [0, 0, 0, 0]);
  let n = 0;
  let missing = 0;
  for (const h of cells) {
    if (h.sensor_source !== "BOTH") continue;
    const p = priorityOf(map, h);
    if (p.m == null || p.v == null) {
      missing++;
      continue;
    }
    matrix[p.m - 1][p.v - 1]++;
    n++;
  }
  let exact = 0;
  let within1 = 0;
  for (let i = 0; i < 4; i++)
    for (let j = 0; j < 4; j++) {
      if (i === j) exact += matrix[i][j];
      if (Math.abs(i - j) <= 1) within1 += matrix[i][j];
    }
  // kappa ponderado cuadrático
  let kappa: number | null = null;
  if (n > 0) {
    const row = matrix.map((r) => r.reduce((a, b) => a + b, 0) / n);
    const col = [0, 1, 2, 3].map((j) => matrix.reduce((a, r) => a + r[j], 0) / n);
    let obs = 0;
    let exp = 0;
    for (let i = 0; i < 4; i++)
      for (let j = 0; j < 4; j++) {
        const w = ((i - j) * (i - j)) / 9;
        obs += (w * matrix[i][j]) / n;
        exp += w * row[i] * col[j];
      }
    kappa = exp > 0 ? 1 - obs / exp : null;
  }
  return {
    matrix,
    n,
    exactPct: n ? (100 * exact) / n : 0,
    within1Pct: n ? (100 * within1) / n : 0,
    kappa,
    missing,
  };
}
