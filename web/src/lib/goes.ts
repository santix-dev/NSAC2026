/**
 * Imágenes GOES-19 (GOES-Este, ABI) servidas por NASA GIBS como mosaicos WMTS con dimensión de tiempo.
 * GIBS publica una imagen cada 10 min (con algunas horas de demora y huecos); acá se consulta qué
 * horarios existen (DescribeDomains) y se arma la secuencia para la animación.
 * Son mosaicos de imagen, como el mapa base: no pasan por la base de datos ni se armonizan.
 */
import { uiLocale } from "@/lib/i18n/translator";
export type GoesProduct = "GeoColor" | "FireTemp";

export const GOES_PRODUCTS: Record<GoesProduct, { layer: string; label: string; hint: string }> = {
  GeoColor: {
    layer: "GOES-East_ABI_GeoColor",
    label: "Color natural (GeoColor)",
    hint: "Humo y nubes de día; infrarrojo de noche",
  },
  FireTemp: {
    layer: "GOES-East_ABI_FireTemp",
    label: "Temperatura de fuego (RGB)",
    hint: "Focos intensos en amarillo/blanco; útil de noche",
  },
};

const GIBS = "https://gibs.earthdata.nasa.gov/wmts/epsg3857/best";
const MATRIX = "GoogleMapsCompatible_Level7";
export const GOES_MAX_NATIVE_ZOOM = 7;

export function goesTileUrl(product: GoesProduct, time: string): string {
  return `${GIBS}/${GOES_PRODUCTS[product].layer}/default/${time}/${MATRIX}/{z}/{y}/{x}.png`;
}

const iso = (d: Date) => d.toISOString().slice(0, 19) + "Z";

/** Expande "inicio/fin/PT10M" (separados por coma) en horarios ISO. */
export function expandDomain(domain: string): string[] {
  const out: string[] = [];
  for (const part of domain.split(",")) {
    const [a, b, step] = part.trim().split("/");
    if (!a) continue;
    const start = Date.parse(a);
    const end = b ? Date.parse(b) : start;
    const mins = Number(/PT(\d+)M/.exec(step ?? "")?.[1] ?? 10);
    for (let t = start; t <= end; t += mins * 60_000) out.push(iso(new Date(t)));
  }
  return out;
}

/**
 * GIBS conserva los mosaicos GOES-Este ~90 días (comprobado nov-2026: GeoColor desde ~16-ago-2026;
 * FireTemp solo ~4 días). Sus metadatos todavía listan horarios viejos —incluida la era GOES-16—
 * pero esos mosaicos ya no existen (404). Por eso además de la lista se prueba un mosaico real.
 */
export const GOES_RETENTION_DAYS = 88;
export const GOES_HISTORY_NOTE =
  "NASA GIBS conserva unos 90 días de GOES-Este; el archivo completo (GOES-16 desde 2017, GOES-19 desde abr-2025) está en NOAA/Earth Engine.";

/** Todos los horarios publicados entre dos fechas (puede incluir horarios ya purgados). */
export async function fetchGoesDomain(product: GoesProduct, start: Date, end: Date): Promise<string[]> {
  const url = `${GIBS}/1.0.0/${GOES_PRODUCTS[product].layer}/default/${MATRIX}/all/${iso(start)}--${iso(end)}.xml`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`GIBS ${res.status}`);
  const domain = /<Domain>([^<]*)<\/Domain>/.exec(await res.text())?.[1] ?? "";
  return expandDomain(domain).filter((t) => {
    const ms = Date.parse(t);
    return ms >= start.getTime() && ms <= end.getTime();
  });
}

const AR_OFFSET_MS = 3 * 3_600_000; // Argentina UTC−3 (sin horario de verano)
/** Día local de Argentina (YYYY-MM-DD) de un horario UTC. */
export const arDay = (t: string) => new Date(Date.parse(t) - AR_OFFSET_MS).toISOString().slice(0, 10);

/**
 * Días de un mes (hora AR) con imagen GOES todavía disponible en GIBS, y sus horarios cada `everyMin`.
 */
export async function fetchGoesMonth(
  product: GoesProduct,
  year: number,
  month: number,
  everyMin = 30,
): Promise<Map<string, string[]>> {
  const start = new Date(Date.UTC(year, month - 1, 1) + AR_OFFSET_MS);
  const end = new Date(Math.min(Date.UTC(year, month, 1) + AR_OFFSET_MS - 1, Date.now()));
  const cutoff = Date.now() - GOES_RETENTION_DAYS * 86_400_000;
  const days = new Map<string, string[]>();
  if (end.getTime() < cutoff) return days;
  const all = await fetchGoesDomain(product, new Date(Math.max(start.getTime(), cutoff)), end);
  for (const t of all) {
    if (new Date(t).getUTCMinutes() % everyMin !== 0) continue;
    const d = arDay(t);
    if (!days.has(d)) days.set(d, []);
    days.get(d)!.push(t);
  }
  return days;
}

/** Comprueba que el mosaico exista de verdad (z5 sobre el punto dado). */
export async function goesTileExists(product: GoesProduct, time: string, lat: number, lon: number): Promise<boolean> {
  const z = 5;
  const n = 2 ** z;
  const x = Math.floor(((lon + 180) / 360) * n);
  const r = (lat * Math.PI) / 180;
  const y = Math.floor(((1 - Math.log(Math.tan(r) + 1 / Math.cos(r)) / Math.PI) / 2) * n);
  try {
    const res = await fetch(goesTileUrl(product, time).replace("{z}", String(z)).replace("{y}", String(y)).replace("{x}", String(x)));
    return res.ok;
  } catch {
    return false;
  }
}

/**
 * Horarios disponibles en las últimas `hours` horas, uno cada `everyMin` minutos (para animar sin
 * pedir 36 juegos de mosaicos). Siempre incluye el más reciente.
 */
export async function fetchGoesTimes(product: GoesProduct, hours = 6, everyMin = 30): Promise<string[]> {
  const end = new Date();
  const start = new Date(end.getTime() - hours * 3_600_000);
  const url = `${GIBS}/1.0.0/${GOES_PRODUCTS[product].layer}/default/${MATRIX}/all/${iso(start)}--${iso(end)}.xml`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`GIBS ${res.status}`);
  const xml = await res.text();
  const domain = /<Domain>([^<]*)<\/Domain>/.exec(xml)?.[1] ?? "";
  const all = expandDomain(domain);
  if (!all.length) return [];
  const picked = all.filter((t) => new Date(t).getUTCMinutes() % everyMin === 0);
  const last = all[all.length - 1];
  if (picked[picked.length - 1] !== last) picked.push(last);
  return picked;
}

export function goesLocalLabel(t: string): string {
  return new Date(t).toLocaleString(uiLocale(), {
    timeZone: "America/Argentina/Buenos_Aires",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}
