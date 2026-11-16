/** Estado de la vista en la URL (?r=PATAGONIA&y=2025&s=riesgo) para compartir exactamente lo que se ve. */
import type { BBox, SeriesMode } from "@/types/fire";

export type Section = "resumen" | "riesgo" | "calendario" | "charter" | "datos";
export const SECTIONS: Section[] = ["resumen", "riesgo", "calendario", "charter", "datos"];

export interface UrlState {
  region?: string;
  bbox?: BBox;
  place?: string;
  year?: number;
  /** 1–12; ausente = todo el año */
  month?: number;
  section?: Section;
  mode?: SeriesMode;
}

export function readUrlState(): UrlState {
  if (typeof window === "undefined") return {};
  const p = new URLSearchParams(window.location.search);
  const out: UrlState = {};
  const r = p.get("r");
  if (r) out.region = r;
  const b = p.get("bbox")?.split(",").map(Number);
  if (b && b.length === 4 && b.every(Number.isFinite) && b[0] < b[2] && b[1] < b[3]) out.bbox = b as BBox;
  const place = p.get("lugar");
  if (place) out.place = place;
  const y = Number(p.get("y"));
  if (Number.isInteger(y) && y >= 2000 && y <= 2100) out.year = y;
  const mo = Number(p.get("m"));
  if (Number.isInteger(mo) && mo >= 1 && mo <= 12) out.month = mo;
  const s = p.get("s") as Section | null;
  if (s && SECTIONS.includes(s)) out.section = s;
  const m = p.get("serie");
  if (m === "raw" || m === "harmonized" || m === "combined" || m === "modis" || m === "viirs") out.mode = m;
  return out;
}

export function writeUrlState(s: UrlState): void {
  if (typeof window === "undefined") return;
  const p = new URLSearchParams();
  if (s.bbox && (!s.region || s.region === "CUSTOM")) {
    p.set("bbox", s.bbox.map((v) => v.toFixed(3)).join(","));
    if (s.place) p.set("lugar", s.place);
  } else if (s.region) p.set("r", s.region);
  if (s.year) p.set("y", String(s.year));
  if (s.month) p.set("m", String(s.month));
  if (s.section && s.section !== "resumen") p.set("s", s.section);
  if (s.mode && s.mode !== "harmonized") p.set("serie", s.mode);
  const url = `${window.location.pathname}?${p.toString()}`;
  if (url !== `${window.location.pathname}${window.location.search}`) window.history.replaceState(null, "", url);
}
