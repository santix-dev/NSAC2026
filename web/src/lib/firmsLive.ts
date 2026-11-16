/**
 * Focos en tiempo casi real (NASA FIRMS NRT: VIIRS NOAA-20/21 + MODIS) vía /api/firms-live.
 * Capa de detección operativa: no se armoniza ni se suma al calendario histórico.
 * Si la ruta falla NO se inventan focos: la UI muestra "sin datos en vivo" y el motivo.
 */
import type { BBox } from "@/types/fire";
import type { LiveFire } from "@/app/api/firms-live/route";
import { uiLocale } from "@/lib/i18n/translator";

export type { LiveFire };

export interface LiveFiresResult {
  ok: boolean;
  fires: LiveFire[];
  fetchedAt: string;
  days: number;
  sources: Record<string, { ok: boolean; count?: number; error?: string }>;
  note?: string;
}

export const LIVE_DAYS = 3;

export async function fetchLiveFires(bbox: BBox, days = LIVE_DAYS): Promise<LiveFiresResult> {
  const now = new Date().toISOString();
  try {
    const res = await fetch(`/api/firms-live?bbox=${bbox.map((x) => x.toFixed(2)).join(",")}&days=${days}`);
    const body = await res.json();
    if (!res.ok) return { ok: false, fires: [], fetchedAt: now, days, sources: {}, note: body?.error ?? `HTTP ${res.status}` };
    return { ok: true, fires: body.fires ?? [], fetchedAt: body.fetchedAt ?? now, days, sources: body.sources ?? {} };
  } catch (e) {
    return { ok: false, fires: [], fetchedAt: now, days, sources: {}, note: (e as Error).message };
  }
}

/** Horas transcurridas desde la detección. */
export function ageHours(f: LiveFire, now = Date.now()): number {
  return Math.max(0, (now - Date.parse(f.acq_datetime)) / 3_600_000);
}

export function ageLabel(h: number): string {
  if (h < 1) return "hace < 1 h";
  if (h < 48) return `hace ${Math.round(h)} h`;
  return `hace ${Math.round(h / 24)} días`;
}

/** Hora local de Argentina (UTC−3) para los popups. */
export function localTime(iso: string): string {
  return new Date(iso).toLocaleString(uiLocale(), {
    timeZone: "America/Argentina/Buenos_Aires",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function summarizeLive(fires: LiveFire[], now = Date.now()) {
  const last24 = fires.filter((f) => ageHours(f, now) <= 24);
  const bySat: Record<string, number> = {};
  for (const f of fires) bySat[f.satellite] = (bySat[f.satellite] ?? 0) + 1;
  const maxFrp = fires.reduce((m, f) => Math.max(m, f.frp ?? 0), 0);
  return { total: fires.length, last24: last24.length, bySat, latest: fires[0] ?? null, maxFrp };
}
