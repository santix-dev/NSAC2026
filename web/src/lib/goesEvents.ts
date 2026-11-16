/**
 * Imágenes de incendios históricos elegidas offline con Earth Engine (etl/env/fire_imagery.py):
 * escenas Landsat 8/9 y Sentinel-2 (fuego activo en onda corta, 10–30 m) y MODIS Terra/Aqua
 * (columna de humo, 500 m), seleccionadas porque muestran el fuego o el humo de ESE incendio.
 * Se sirven como archivos estáticos desde /goes/<evento>/.
 */
import { uiLocale } from "@/lib/i18n/translator";
export type SceneProduct = "swir" | "natural";

export const SCENE_PRODUCTS: Record<SceneProduct, { label: string; hint: string }> = {
  swir: { label: "Fuego (onda corta)", hint: "Frente activo en naranja/amarillo; el humo casi no tapa" },
  natural: { label: "Color natural (humo)", hint: "Columna de humo y nubes como las vería el ojo" },
};

export interface FireScene {
  time: string; // ISO UTC
  day: string;
  sensor: string;
  resolution: string;
  hot_px: number | null;
  cloud: number;
  detections: number;
  products: Partial<Record<SceneProduct, { file: string; bounds: [[number, number], [number, number]] }>>;
}

export type StageKey = "pre" | "post" | "recovery";

export interface FireStage {
  label: string;
  time: string;
  day: string;
  sensor: string;
  resolution: string;
  cloud: number;
  snow: number;
  days_from_fire: number;
  products: Partial<Record<SceneProduct, { file: string; bounds: [[number, number], [number, number]] }>>;
}

export interface FireSeverity {
  file: string;
  bounds: [[number, number], [number, number]];
  pre: string;
  post: string;
  sensors: string[];
  classes: { name: string; min: number; max: number | null; color: string; ha: number }[];
  burned_ha: number;
}

export interface FireTimeline {
  fire_start: string;
  fire_end: string;
  stages: Partial<Record<StageKey, FireStage>>;
  severity?: FireSeverity;
}

export const STAGE_ORDER: StageKey[] = ["pre", "post", "recovery"];
export const STAGE_SHORT: Record<StageKey, string> = { pre: "Antes", post: "Después", recovery: "Recuperación" };

export function stageUrl(ev: FireEvent, st: FireStage, p: SceneProduct): string | null {
  const f = st.products[p] ?? st.products.natural;
  return f ? `/goes/${ev.id}/${f.file}` : null;
}

export function fmtDay(d: string): string {
  return new Date(`${d}T12:00:00Z`).toLocaleDateString(uiLocale(), { day: "numeric", month: "short", year: "numeric" });
}

export interface FireEvent {
  id: string;
  name: string;
  region: string;
  days: string[];
  center: [number, number];
  fire_bounds: [[number, number], [number, number]];
  scenes: FireScene[];
  timeline?: FireTimeline;
}

let cache: Promise<FireEvent[]> | null = null;

export function loadFireEvents(): Promise<FireEvent[]> {
  if (!cache) {
    cache = fetch("/goes/events.json")
      .then((r) => (r.ok ? r.json() : { events: [] }))
      .then((j) => ((j.events ?? []) as FireEvent[]).filter((e) => Array.isArray(e.scenes) && e.scenes.length > 0))
      .catch(() => []);
  }
  return cache;
}

export function sceneUrl(ev: FireEvent, s: FireScene, p: SceneProduct): string | null {
  const f = s.products[p] ?? s.products.natural ?? s.products.swir;
  return f ? `/goes/${ev.id}/${f.file}` : null;
}

export function sceneBounds(s: FireScene, p: SceneProduct): [[number, number], [number, number]] | null {
  return (s.products[p] ?? s.products.natural ?? s.products.swir)?.bounds ?? null;
}

const near = (e: FireEvent, c: [number, number], deg = 2.5) =>
  Math.abs(e.center[0] - c[0]) <= deg && Math.abs(e.center[1] - c[1]) <= deg * 1.4;

/** Incendios con escenas en ese año/mes cerca de la vista. */
export function eventsFor(events: FireEvent[], year: number, month: number, center: [number, number]): FireEvent[] {
  const key = `${year}-${String(month).padStart(2, "0")}`;
  return events.filter((e) => near(e, center) && e.scenes.some((s) => s.day.startsWith(key)));
}

/** Incendios de la misma zona (para ofrecer saltar a ellos). */
export function eventsNear(events: FireEvent[], center: [number, number]): FireEvent[] {
  return events.filter((e) => near(e, center));
}

export function sceneLabel(s: FireScene): string {
  const d = new Date(s.time);
  const day = d.toLocaleDateString(uiLocale(), { timeZone: "America/Argentina/Buenos_Aires", day: "numeric", month: "short", year: "numeric" });
  const what = s.hot_px && s.hot_px > 0 ? ` · fuego visible` : s.sensor.startsWith("MODIS") ? " · humo" : "";
  return `${day} · ${s.sensor} (${s.resolution})${what}`;
}
