/**
 * Imágenes de incendios históricos exportadas offline con Earth Engine (etl/env/goes_events.py):
 * GOES-16/19 ABI (desde jul-2017) o MODIS Terra/Aqua (antes). Se sirven como archivos estáticos
 * desde /goes/<evento>/ y se dibujan como superposición de imagen en el mapa.
 */
import type { GoesProduct } from "./goes";

export interface GoesEventFrame {
  time: string; // ISO UTC
  file: string;
  sat: string;
}

export interface GoesEvent {
  id: string;
  name: string;
  region: string;
  days: string[]; // YYYY-MM-DD (hora AR)
  note?: string | null;
  bounds: [[number, number], [number, number]]; // [[sur, oeste], [norte, este]]
  sensors: string[];
  frames: Partial<Record<"natural" | "firetemp", GoesEventFrame[]>>;
}

let cache: Promise<GoesEvent[]> | null = null;

export function loadGoesEvents(): Promise<GoesEvent[]> {
  if (!cache) {
    cache = fetch("/goes/events.json")
      .then((r) => (r.ok ? r.json() : { events: [] }))
      .then((j) => (j.events ?? []) as GoesEvent[])
      .catch(() => []);
  }
  return cache;
}

export const eventProductKey = (p: GoesProduct): "natural" | "firetemp" => (p === "FireTemp" ? "firetemp" : "natural");

export function eventFrameUrl(ev: GoesEvent, f: GoesEventFrame): string {
  return `/goes/${ev.id}/${f.file}`;
}

/** Eventos cuyo día cae en ese año/mes y cuya área toca la vista. */
export function eventsFor(events: GoesEvent[], year: number, month: number, center: [number, number]): GoesEvent[] {
  const key = `${year}-${String(month).padStart(2, "0")}`;
  return events.filter((e) => {
    const [[s, w], [n, ea]] = e.bounds;
    const inView = center[0] >= s - 2 && center[0] <= n + 2 && center[1] >= w - 2 && center[1] <= ea + 2;
    return inView && e.days.some((d) => d.startsWith(key));
  });
}

/** Eventos de la misma zona (para ofrecer saltar a ellos cuando la fecha no tiene imagen). */
export function eventsNear(events: GoesEvent[], center: [number, number]): GoesEvent[] {
  return events.filter((e) => {
    const [[s, w], [n, ea]] = e.bounds;
    return center[0] >= s - 2 && center[0] <= n + 2 && center[1] >= w - 2 && center[1] <= ea + 2;
  });
}
