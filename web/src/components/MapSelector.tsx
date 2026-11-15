"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { CloudSun, Pause, Play, Trees } from "lucide-react";
import {
  fetchGoesMonth,
  fetchGoesTimes,
  GOES_HISTORY_NOTE,
  GOES_PRODUCTS,
  goesLocalLabel,
  goesTileExists,
  type GoesProduct,
} from "@/lib/goes";
import { MONTHS_LONG } from "@/lib/regions";
import {
  eventsFor,
  eventsNear,
  loadFireEvents,
  SCENE_PRODUCTS,
  sceneBounds,
  sceneLabel,
  sceneUrl,
  fmtDay,
  STAGE_ORDER,
  STAGE_SHORT,
  stageUrl,
  type FireEvent,
  type SceneProduct,
  type StageKey,
} from "@/lib/goesEvents";
import { ChevronLeft, ChevronRight, Crosshair } from "lucide-react";
import dynamic from "next/dynamic";
import { ChevronDown, Flame, Layers, Loader2, Navigation, Radio, Route, Satellite, ShieldAlert, Wind } from "lucide-react";
import type { MapLayers, SeriesMode } from "@/types/fire";
import SeriesToggle from "./SeriesToggle";
import type { MapViewProps } from "./MapView";
import type { Agreement, CellPriority, Concordance } from "@/lib/cellPriority";
import { HARM_SOURCE_COLORS, PRIORITY_COLORS, PRIORITY_LABEL, RAW_COLORS, RISK_COLORS } from "@/lib/colors";
import { compassLabel } from "@/lib/spread";

const MapView = dynamic(() => import("./MapView"), {
  ssr: false,
  loading: () => <div className="flex h-full items-center justify-center text-sm text-slate-500">Cargando mapa…</div>,
});

interface Props extends Omit<MapViewProps, "show" | "goes"> {
  layers: MapLayers;
  onToggleLayer: (k: keyof MapLayers) => void;
  headline: string;
  scenarioLabel: string;
  hotspotCount: number;
  truncated: boolean;
  loading: boolean;
  isfLabel?: string;
  emptyMessage?: string | null;
  spreadSummary?: string;
  liveSummary?: string;
  /** Fecha elegida en la app: con mes, la imagen GOES sigue ese mes; sin mes, últimas 6 h. */
  goesDate: { year: number; month: number | null; preferredDay?: string; center: [number, number] };
  countUnit?: string;
  harmSources: Record<"BOTH" | "MODIS" | "VIIRS", boolean>;
  harmCounts: Record<"BOTH" | "MODIS" | "VIIRS", number>;
  onHarmSources: (v: Record<"BOTH" | "MODIS" | "VIIRS", boolean>) => void;
  /** Prioridad MODIS/VIIRS por celda armonizada (clave grid_cell_id|fecha) */
  cellPriority?: Map<string, CellPriority> | null;
  harmPriority?: {
    colorBy: "priority" | "source";
    onColorBy: (v: "priority" | "source") => void;
    agree: Agreement;
    onAgree: (v: Agreement) => void;
    concordance: Concordance | null;
    loading: boolean;
  };
  rawInfo?: {
    loading: boolean;
    available: boolean;
    truncated: boolean;
    includeExtra: boolean;
    onIncludeExtra: (v: boolean) => void;
    colorBy: "sensor" | "priority";
    onColorBy: (v: "sensor" | "priority") => void;
    minPriority: 0 | 2 | 3 | 4;
    onMinPriority: (v: 0 | 2 | 3 | 4) => void;
  } | null;
  /** Serie de focos que se dibuja: armonizada, solo MODIS, solo VIIRS o cruda */
  mode: SeriesMode;
  onModeChange: (m: SeriesMode) => void;
  sensorSeries: boolean;
  /** Saltar a otra fecha (para los incendios históricos con imagen) */
  onGoToDate?: (year: number, month: number) => void;
}

const LAYER_DEFS: { key: keyof MapLayers; label: string; hint: string; Icon: typeof Flame }[] = [
  { key: "live", label: "Focos en tiempo casi real", hint: "NOAA-20/21 + MODIS · últimas 72 h", Icon: Satellite },
  { key: "goes", label: "Imagen satelital (humo)", hint: "GOES-19 reciente · incendios históricos GOES-16/MODIS", Icon: CloudSun },
  { key: "park", label: "Áreas protegidas", hint: "PN Los Alerces, su Reserva y PN Lago Puelo", Icon: Trees },
  { key: "hotspots", label: "Focos armonizados", hint: "MODIS + VIIRS · celda 1 km", Icon: Flame },
  { key: "spread", label: "Avance de incendios", hint: "Dirección de cada evento", Icon: Route },
  { key: "susceptibility", label: "Riesgo (ISF)", hint: "Pendiente, suelo, viento, historia", Icon: ShieldAlert },
  { key: "iot", label: "Estaciones", hint: "Condiciones actuales", Icon: Radio },
  { key: "wind", label: "Viento y cono de avance", hint: "NASA POWER · 6 h", Icon: Wind },
];

export default function MapSelector(props: Props) {
  const { layers, onToggleLayer, wind } = props;
  const [layersOpen, setLayersOpen] = useState(false);
  const ref = useRef<HTMLElement>(null);
  // Panel de capas abierto solo si el mapa es ancho (escritorio); en mapas angostos tapa el contexto.
  useEffect(() => {
    const t = setTimeout(() => setLayersOpen((ref.current?.clientWidth ?? 0) >= 900), 0);
    return () => clearTimeout(t);
  }, []);
  const toward = wind ? (wind.fromDeg + 180) % 360 : 0;

  // ---- GOES-19: horarios disponibles y animación (sigue el año/mes elegido)
  const [goesProduct, setGoesProduct] = useState<GoesProduct>("GeoColor");
  const [goesDays, setGoesDays] = useState<Map<string, string[]>>(new Map());
  const [goesDay, setGoesDay] = useState<string | null>(null);
  const [goesTimes, setGoesTimes] = useState<string[]>([]);
  const [goesIndex, setGoesIndex] = useState(0);
  const [goesOpacity, setGoesOpacity] = useState(0.8);
  const [goesPlaying, setGoesPlaying] = useState(false);
  const [goesError, setGoesError] = useState<string | null>(null);
  /** Incendio histórico exportado con Earth Engine que cubre la fecha elegida */
  // Incendios históricos con escenas elegidas offline (Landsat / Sentinel-2 / MODIS)
  const [allEvents, setAllEvents] = useState<FireEvent[]>([]);
  const [eventId, setEventId] = useState<string | null>(null);
  const [sceneIdx, setSceneIdx] = useState(0);
  const [sceneProduct, setSceneProduct] = useState<SceneProduct>("swir");
  /** Apartado del incendio: imágenes durante el fuego, o Antes / Después / Recuperación / Severidad */
  const [fireTab, setFireTab] = useState<"during" | "timeline">("during");
  const [stage, setStage] = useState<StageKey | "severity">("pre");
  const { year: gYear, month: gMonth, preferredDay, center } = props.goesDate;
  const historic = gMonth != null;

  // Lista de horarios: últimas 6 h, o los días del mes elegido
  useEffect(() => {
    if (!layers.goes) return;
    let cancelled = false;
    const load = async () => {
      setGoesPlaying(false);
      try {
        if (!historic) {
          const t = await fetchGoesTimes(goesProduct);
          if (cancelled) return;
          setGoesDays(new Map());
          setGoesDay(null);
          setGoesTimes(t);
          setGoesIndex(Math.max(0, t.length - 1));
          setGoesError(t.length ? null : "Sin imagen GOES reciente en NASA GIBS");
          return;
        }
        // Archivo de NASA GIBS (~90 días)
        const days = await fetchGoesMonth(goesProduct, gYear, gMonth!);
        if (cancelled) return;
        setGoesDays(days);
        const keys = [...days.keys()];
        if (!keys.length) {
          setGoesDay(null);
          setGoesTimes([]);
          setGoesError(`Sin imagen GOES para esta fecha (${MONTHS_LONG[gMonth! - 1].toLowerCase()} ${gYear}).`);
          return;
        }
        setGoesDay(preferredDay && days.has(preferredDay) ? preferredDay : keys[keys.length - 1]);
      } catch (e) {
        if (!cancelled) setGoesError(`No se pudo consultar NASA GIBS (${(e as Error).message})`);
      }
    };
    void load();
    const id = historic ? undefined : setInterval(load, 10 * 60_000);
    return () => {
      cancelled = true;
      if (id) clearInterval(id);
    };
  }, [layers.goes, goesProduct, historic, gYear, gMonth, preferredDay, center]);

  // Día elegido → horarios de ese día; se arranca a media tarde (mejor luz para ver humo)
  useEffect(() => {
    if (!historic || !goesDay) return;
    const t = goesDays.get(goesDay) ?? [];
    let cancelled = false;
    const noon = t.findIndex((x) => new Date(x).getUTCHours() >= 18);
    const idx = noon >= 0 ? noon : Math.max(0, t.length - 1);
    const timer = setTimeout(() => {
      setGoesTimes(t);
      setGoesIndex(idx);
      setGoesError(null);
    }, 0);
    // Los metadatos de GIBS listan horarios ya purgados: se verifica un mosaico real
    if (t[idx])
      void goesTileExists(goesProduct, t[idx], center[0], center[1]).then((ok) => {
        if (!cancelled && !ok) setGoesError("Sin imagen GOES para esta fecha (ya no está en el archivo de NASA GIBS).");
      });
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [historic, goesDay, goesDays, goesProduct, center]);

  // ---- incendios históricos: catálogo y evento del mes elegido
  useEffect(() => {
    if (!layers.goes) return;
    let cancelled = false;
    void loadFireEvents().then((e) => !cancelled && setAllEvents(e));
    return () => {
      cancelled = true;
    };
  }, [layers.goes]);
  const monthEvents = useMemo(
    () => (historic ? eventsFor(allEvents, gYear, gMonth!, center) : []),
    [allEvents, historic, gYear, gMonth, center],
  );
  const nearEvents = useMemo(() => eventsNear(allEvents, center), [allEvents, center]);
  const fireEvent = monthEvents.find((e) => e.id === eventId) ?? monthEvents[0] ?? null;
  const scenes = useMemo(() => {
    if (!fireEvent) return [];
    const key = `${gYear}-${String(gMonth).padStart(2, "0")}`;
    const inMonth = fireEvent.scenes.filter((s) => s.day.startsWith(key));
    return inMonth.length ? inMonth : fireEvent.scenes;
  }, [fireEvent, gYear, gMonth]);
  // Escena inicial: la que más fuego muestra (o la del día pico)
  useEffect(() => {
    if (!scenes.length) return;
    let best = scenes.findIndex((s) => s.day === preferredDay);
    const hottest = scenes.reduce((b, s, i) => ((s.hot_px ?? 0) > (scenes[b].hot_px ?? 0) ? i : b), 0);
    if ((scenes[hottest].hot_px ?? 0) > 0) best = hottest;
    const t = setTimeout(() => setSceneIdx(Math.max(0, best)), 0);
    return () => clearTimeout(t);
  }, [scenes, preferredDay]);
  const scene = scenes[Math.min(sceneIdx, scenes.length - 1)] ?? null;
  const timeline = fireEvent?.timeline;
  const timelineItem = useMemo(() => {
    if (!fireEvent || !timeline) return null;
    if (stage === "severity") return timeline.severity ? { url: `/goes/${fireEvent.id}/${timeline.severity.file}`, bounds: timeline.severity.bounds } : null;
    const st = timeline.stages[stage];
    if (!st) return null;
    const url = stageUrl(fireEvent, st, sceneProduct);
    const b = (st.products[sceneProduct] ?? st.products.natural)?.bounds;
    return url && b ? { url, bounds: b } : null;
  }, [fireEvent, timeline, stage, sceneProduct]);
  const [focus, setFocus] = useState<{ bounds: [[number, number], [number, number]]; key: number } | null>(null);
  // Al aparecer un incendio histórico, el mapa se acerca solo a su recuadro
  const fireId = fireEvent?.id;
  const fireBounds = fireEvent?.fire_bounds;
  useEffect(() => {
    if (!fireId || !fireBounds) return;
    const t = setTimeout(() => setFocus({ bounds: fireBounds, key: Date.now() }), 0);
    return () => clearTimeout(t);
  }, [fireId]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!goesPlaying || goesTimes.length < 2) return;
    const id = setInterval(() => setGoesIndex((i) => (i + 1) % goesTimes.length), 900);
    return () => clearInterval(id);
  }, [goesPlaying, goesTimes.length]);


  return (
    <section ref={ref} className="relative h-full w-full bg-slate-900" aria-label="Mapa">
      <MapView
        bbox={props.bbox}
        hotspots={props.hotspots}
        spread={props.spread}
        susceptibility={props.susceptibility}
        iot={props.iot}
        wind={wind}
        liveFires={props.liveFires}
        rawPoints={props.rawPoints}
        rawColorBy={props.rawInfo?.colorBy ?? "sensor"}
        cellPriority={props.cellPriority ?? null}
        harmColorBy={props.harmPriority?.colorBy ?? "source"}
        goes={
          layers.goes && !goesError && !fireEvent
            ? {
                product: goesProduct,
                times: goesTimes,
                index: goesIndex,
                opacity: goesOpacity,
              }
            : null
        }
        scenes={
          layers.goes && fireEvent && fireTab === "timeline" && timelineItem
            ? { index: 0, opacity: goesOpacity, items: [timelineItem] }
            : layers.goes && fireEvent && scenes.length
              ? {
                  index: Math.min(sceneIdx, scenes.length - 1),
                  opacity: goesOpacity,
                  items: scenes.map((s) => ({ url: sceneUrl(fireEvent, s, sceneProduct) ?? "", bounds: sceneBounds(s, sceneProduct)! })),
                }
              : null
        }
        focus={focus}
        show={layers}
      />

      {/* Contexto actual */}
      <div className="pointer-events-none absolute left-14 top-3 z-[1000] flex max-w-[calc(100%-11.5rem)] flex-col gap-2 sm:max-w-sm">
        <div className="pointer-events-auto rounded-lg border border-slate-800 bg-slate-950/90 px-3 py-2 shadow-xl backdrop-blur">
          <p className="truncate text-sm font-semibold text-slate-100">{props.headline}</p>
          <p className="flex items-center gap-1.5 text-[11px] text-slate-400">
            {props.loading && <Loader2 className="h-3 w-3 animate-spin" aria-hidden />}
            {props.scenarioLabel} · {props.hotspotCount.toLocaleString("es-AR")} {props.countUnit ?? "celdas-día"}
            {props.truncated && " (límite 10.000)"}
          </p>
          {props.spreadSummary && layers.spread && <p className="text-[11px] text-slate-500">{props.spreadSummary}</p>}
          {layers.hotspots && (
            <div className="mt-1.5">
              <SeriesToggle mode={props.mode} onChange={props.onModeChange} compact />
              <p className="mt-0.5 text-[10px] text-slate-500">
                {props.mode === "harmonized"
                  ? "Mapa: celdas de 1 km armonizadas (MODIS + VIIRS con peso α)."
                  : props.rawInfo?.loading
                    ? "Cargando detecciones originales…"
                    : props.rawInfo && !props.rawInfo.available
                      ? "Las detecciones originales todavía no se cargaron en la base (upload_supabase.py --raw-only)."
                      : props.mode === "modis"
                        ? "Mapa: detecciones originales MODIS (píxel 1 km), en su posición real."
                        : props.mode === "viirs"
                          ? "Mapa: detecciones originales VIIRS (píxel 375 m), en su posición real."
                          : "Mapa: todas las detecciones originales, sin armonizar."}
                {props.rawInfo?.truncated ? " Se muestran las primeras 15.000; elegí un mes para ver todo." : ""}
              </p>
              {props.mode === "harmonized" && (
                <div className="mt-1 flex flex-wrap gap-x-2.5 gap-y-0.5 text-[10.5px] text-slate-300">
                  {(
                    [
                      ["BOTH", "Ambos"],
                      ["MODIS", "Solo MODIS"],
                      ["VIIRS", "Solo VIIRS (α)"],
                    ] as const
                  ).map(([k, l]) => (
                    <label key={k} className="flex cursor-pointer items-center gap-1">
                      <input
                        type="checkbox"
                        checked={props.harmSources[k]}
                        onChange={() => props.onHarmSources({ ...props.harmSources, [k]: !props.harmSources[k] })}
                        className="h-3 w-3"
                        style={{ accentColor: HARM_SOURCE_COLORS[k] }}
                      />
                      <span className="inline-block h-2 w-2 rounded-full" style={{ background: HARM_SOURCE_COLORS[k] }} />
                      {l} <span className="font-mono text-slate-500">{props.harmCounts[k].toLocaleString("es-AR")}</span>
                    </label>
                  ))}
                </div>
              )}
              {props.mode === "harmonized" && props.harmPriority && (
                <HarmPriorityControls hp={props.harmPriority} />
              )}
              {props.rawInfo && props.rawInfo.available && (
                <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-[10.5px] text-slate-300">
                  <span className="text-slate-500">Color:</span>
                  {(
                    [
                      ["priority", "Prioridad"],
                      ["sensor", "Sensor"],
                    ] as const
                  ).map(([k, l]) => (
                    <button
                      key={k}
                      type="button"
                      onClick={() => props.rawInfo!.onColorBy(k)}
                      className={`rounded px-1.5 py-0.5 ${
                        props.rawInfo!.colorBy === k ? "bg-slate-700 text-slate-50" : "text-slate-400 hover:text-slate-200"
                      }`}
                    >
                      {l}
                    </button>
                  ))}
                  <select
                    value={props.rawInfo.minPriority}
                    onChange={(e) => props.rawInfo!.onMinPriority(Number(e.target.value) as 0 | 2 | 3 | 4)}
                    className="rounded border border-slate-700 bg-slate-900 px-1 py-0.5 text-[10.5px] text-slate-200"
                    aria-label="Prioridad mínima"
                  >
                    <option value={0}>Todas las prioridades</option>
                    <option value={2}>Medio o más</option>
                    <option value={3}>Alto o más</option>
                    <option value={4}>Solo extremo</option>
                  </select>
                </div>
              )}
              {props.rawInfo && props.mode !== "modis" && props.rawInfo.available && (
                <label className="mt-0.5 flex cursor-pointer items-center gap-1 text-[10px] text-slate-400">
                  <input
                    type="checkbox"
                    checked={props.rawInfo.includeExtra}
                    onChange={(e) => props.rawInfo!.onIncludeExtra(e.target.checked)}
                    className="h-3 w-3 accent-cyan-400"
                  />
                  Incluir NOAA-20/21 que no entran en la serie (borde punteado)
                </label>
              )}
            </div>
          )}
          {props.liveSummary && layers.live && <p className="text-[11px] text-rose-300">{props.liveSummary}</p>}
        </div>
        {layers.wind && wind && (
          <div className="pointer-events-auto flex w-fit items-center gap-2.5 rounded-lg border border-slate-800 bg-slate-950/90 px-3 py-2 shadow-xl backdrop-blur">
            <div className="relative flex h-10 w-10 items-center justify-center rounded-full border border-slate-700">
              <span className="absolute top-0.5 text-[8px] text-slate-500">N</span>
              <Navigation className="h-5 w-5 text-sky-300" style={{ transform: `rotate(${toward - 45}deg)` }} aria-label={`Avance hacia ${compassLabel(toward)}`} />
            </div>
            <div className="leading-tight">
              <p className="font-mono text-sm text-slate-100">{wind.speedKmh.toFixed(0)} km/h</p>
              <p className="text-[10.5px] text-slate-400">
                desde {compassLabel(wind.fromDeg)} ({wind.fromDeg.toFixed(0)}°)
              </p>
              <p className="text-[10px] text-slate-500">{wind.source}</p>
            </div>
          </div>
        )}
        {props.emptyMessage && (
          <div className="pointer-events-auto rounded-lg border border-amber-800/60 bg-amber-950/80 px-3 py-2 text-[12px] text-amber-200 shadow-xl">
            {props.emptyMessage}
          </div>
        )}
      </div>

      {/* Capas */}
      <fieldset className={`absolute right-3 top-3 z-[1000] rounded-lg ${layersOpen ? "w-56" : "w-auto"} border border-slate-800 bg-slate-950/90 shadow-xl backdrop-blur`}>
        <legend className="sr-only">Capas del mapa</legend>
        <button
          type="button"
          onClick={() => setLayersOpen(!layersOpen)}
          aria-expanded={layersOpen}
          className="flex w-full items-center gap-1.5 px-3 py-2 text-[11px] font-semibold uppercase tracking-wide text-slate-400"
        >
          <Layers className="h-3.5 w-3.5" aria-hidden /> Capas
          <ChevronDown className={`ml-auto h-3.5 w-3.5 transition ${layersOpen ? "" : "-rotate-90"}`} aria-hidden />
        </button>
        {layersOpen && (
          <div className="px-1.5 pb-1.5">
            {LAYER_DEFS.map(({ key, label, hint, Icon }) => (
              <label key={key} className="flex cursor-pointer items-start gap-2 rounded-md px-1.5 py-1 hover:bg-slate-800/70">
                <input
                  type="checkbox"
                  checked={layers[key]}
                  onChange={() => onToggleLayer(key)}
                  className="mt-0.5 h-3.5 w-3.5 accent-orange-500"
                />
                <Icon className="mt-0.5 h-3.5 w-3.5 shrink-0 text-slate-400" aria-hidden />
                <span className="leading-tight">
                  <span className="block text-xs text-slate-100">{label}</span>
                  <span className="block text-[10px] text-slate-500">{hint}</span>
                </span>
              </label>
            ))}
          </div>
        )}
      </fieldset>

      {/* Incendio histórico: escenas que muestran el fuego / humo */}
      {layers.goes && fireEvent && scene && (
        <div className="absolute bottom-6 left-1/2 z-[1000] w-[min(460px,calc(100%-1.5rem))] -translate-x-1/2 rounded-lg border border-slate-800 bg-slate-950/90 px-3 py-2 text-[11px] text-slate-300 shadow-xl backdrop-blur">
          <div className="flex items-center gap-2">
            {monthEvents.length > 1 ? (
              <select
                value={fireEvent.id}
                onChange={(e) => setEventId(e.target.value)}
                className="min-w-0 flex-1 truncate rounded border border-slate-700 bg-slate-900 px-1.5 py-0.5 text-[11px] font-semibold text-slate-100"
                aria-label="Incendio"
              >
                {monthEvents.map((e) => (
                  <option key={e.id} value={e.id}>
                    {e.name}
                  </option>
                ))}
              </select>
            ) : (
              <p className="min-w-0 flex-1 truncate text-[12px] font-semibold text-slate-100">{fireEvent.name}</p>
            )}
            <button
              type="button"
              onClick={() => setFocus({ bounds: fireEvent.fire_bounds, key: Date.now() })}
              className="flex shrink-0 items-center gap-1 rounded-md border border-orange-700/70 bg-orange-500/10 px-2 py-0.5 text-[11px] text-orange-200 hover:bg-orange-500/20"
            >
              <Crosshair className="h-3.5 w-3.5" aria-hidden /> Ir al incendio
            </button>
          </div>
          <div className="mt-1.5 flex rounded border border-slate-700 p-0.5 text-[11px]" role="tablist" aria-label="Apartado del incendio">
            {(
              [
                ["during", "Durante el incendio"],
                ["timeline", "Antes y después"],
              ] as const
            ).map(([k, l]) => (
              <button
                key={k}
                type="button"
                role="tab"
                aria-selected={fireTab === k}
                disabled={k === "timeline" && !timeline}
                title={k === "timeline" && !timeline ? "Todavía no se generaron (fire_imagery.py --stages-only)" : undefined}
                onClick={() => setFireTab(k)}
                className={`flex-1 rounded px-2 py-0.5 disabled:opacity-40 ${fireTab === k ? "bg-orange-500/20 text-orange-200" : "text-slate-400 hover:text-slate-200"}`}
              >
                {l}
              </button>
            ))}
          </div>
          {fireTab === "timeline" && timeline ? (
            <div className="mt-1.5">
              <div className="grid grid-cols-4 gap-1">
                {[...STAGE_ORDER, "severity" as const].map((k) => {
                  const st = k === "severity" ? null : timeline.stages[k];
                  const has = k === "severity" ? !!timeline.severity : !!st;
                  return (
                    <button
                      key={k}
                      type="button"
                      disabled={!has}
                      onClick={() => setStage(k)}
                      className={`rounded border px-1 py-1 text-center leading-tight disabled:opacity-35 ${
                        stage === k ? "border-orange-500/80 bg-orange-500/15 text-orange-100" : "border-slate-700 text-slate-300 hover:bg-slate-800"
                      }`}
                    >
                      <span className="block text-[11px] font-semibold">{k === "severity" ? "Severidad" : STAGE_SHORT[k]}</span>
                      <span className="block text-[9.5px] text-slate-400">
                        {k === "severity"
                          ? timeline.severity
                            ? `${timeline.severity.burned_ha.toLocaleString("es-AR")} ha`
                            : "—"
                          : st
                            ? fmtDay(st.day)
                            : k === "recovery"
                              ? "aún no"
                              : "sin imagen"}
                      </span>
                    </button>
                  );
                })}
              </div>
              {stage === "severity" && timeline.severity ? (
                <div className="mt-1.5">
                  <div className="flex flex-wrap gap-x-2 gap-y-0.5">
                    {timeline.severity.classes.map((c) => (
                      <span key={c.name} className="flex items-center gap-1 text-[10.5px] text-slate-300">
                        <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: c.color }} />
                        {c.name} <span className="font-mono text-slate-400">{c.ha.toLocaleString("es-AR")} ha</span>
                      </span>
                    ))}
                  </div>
                  <p className="mt-1 text-[10px] text-slate-500">
                    dNBR = NBR antes ({fmtDay(timeline.severity.pre)}) − NBR después ({fmtDay(timeline.severity.post)}), NBR = (NIR − SWIR2)/(NIR + SWIR2);
                    clases USGS (Key &amp; Benson). {timeline.severity.sensors.join(" / ")}, nubes enmascaradas. Superficie dentro del recuadro del incendio.
                  </p>
                </div>
              ) : stage !== "severity" && timeline.stages[stage] ? (
                <>
                  <div className="mt-1.5 flex flex-wrap items-center gap-2">
                    <div className="flex rounded border border-slate-700 p-0.5" role="group" aria-label="Producto">
                      {(Object.keys(SCENE_PRODUCTS) as SceneProduct[]).map((p) => (
                        <button
                          key={p}
                          type="button"
                          aria-pressed={sceneProduct === p}
                          onClick={() => setSceneProduct(p)}
                          className={`rounded px-2 py-0.5 text-[11px] ${sceneProduct === p ? "bg-slate-700 text-white" : "text-slate-400 hover:text-slate-200"}`}
                        >
                          {p === "swir" ? "Onda corta (quemado)" : SCENE_PRODUCTS[p].label}
                        </button>
                      ))}
                    </div>
                    <label className="flex items-center gap-1 text-slate-400">
                      Opacidad
                      <input type="range" min={0.2} max={1} step={0.1} value={goesOpacity} onChange={(e) => setGoesOpacity(+e.target.value)} className="w-16 accent-sky-400" />
                    </label>
                  </div>
                  <p className="mt-1 text-[10px] text-slate-500">
                    {(() => {
                      const st = timeline.stages[stage]!;
                      const rel = st.days_from_fire;
                      const when = stage === "pre" ? `${Math.abs(rel)} días antes del inicio` : `${rel} días después del fin (${fmtDay(timeline.fire_end)})`;
                      return `${st.label}: ${st.sensor} (${st.resolution}), ${fmtDay(st.day)} · ${when} · nubes ${Math.round(st.cloud * 100)} %.`;
                    })()}{" "}
                    {sceneProduct === "swir" ? "En onda corta lo quemado se ve marrón oscuro/rojizo y la vegetación sana verde." : ""}
                  </p>
                </>
              ) : null}
            </div>
          ) : (
          <>
          <div className="mt-1.5 flex items-center gap-1.5">
            <button
              type="button"
              disabled={sceneIdx <= 0}
              onClick={() => setSceneIdx((i) => Math.max(0, i - 1))}
              className="rounded border border-slate-700 p-0.5 hover:bg-slate-800 disabled:opacity-30"
              aria-label="Imagen anterior"
            >
              <ChevronLeft className="h-3.5 w-3.5" />
            </button>
            <select
              value={Math.min(sceneIdx, scenes.length - 1)}
              onChange={(e) => setSceneIdx(+e.target.value)}
              className="min-w-0 flex-1 rounded border border-slate-700 bg-slate-900 px-1.5 py-0.5 text-[11px] text-slate-200"
              aria-label="Imagen"
            >
              {scenes.map((s, i) => (
                <option key={s.time + s.sensor} value={i}>
                  {sceneLabel(s)}
                </option>
              ))}
            </select>
            <button
              type="button"
              disabled={sceneIdx >= scenes.length - 1}
              onClick={() => setSceneIdx((i) => Math.min(scenes.length - 1, i + 1))}
              className="rounded border border-slate-700 p-0.5 hover:bg-slate-800 disabled:opacity-30"
              aria-label="Imagen siguiente"
            >
              <ChevronRight className="h-3.5 w-3.5" />
            </button>
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            <div className="flex rounded border border-slate-700 p-0.5" role="group" aria-label="Producto">
              {(Object.keys(SCENE_PRODUCTS) as SceneProduct[]).map((p) => (
                <button
                  key={p}
                  type="button"
                  aria-pressed={sceneProduct === p}
                  onClick={() => setSceneProduct(p)}
                  className={`rounded px-2 py-0.5 text-[11px] ${sceneProduct === p ? "bg-slate-700 text-white" : "text-slate-400 hover:text-slate-200"}`}
                >
                  {SCENE_PRODUCTS[p].label}
                </button>
              ))}
            </div>
            <label className="flex items-center gap-1 text-slate-400">
              Opacidad
              <input type="range" min={0.2} max={1} step={0.1} value={goesOpacity} onChange={(e) => setGoesOpacity(+e.target.value)} className="w-16 accent-sky-400" />
            </label>
            <label className="ml-auto flex cursor-pointer items-center gap-1 text-slate-400" title="Los puntos de focos tapan la imagen">
              <input
                type="checkbox"
                checked={!layers.hotspots}
                onChange={() => {
                  onToggleLayer("hotspots");
                  if (layers.hotspots === layers.spread) onToggleLayer("spread");
                }}
                className="h-3 w-3 accent-orange-500"
              />
              Ver imagen limpia
            </label>
          </div>
          <p className="mt-1 text-[10px] text-slate-500">
            {SCENE_PRODUCTS[sceneProduct].hint}.{" "}
            {scene.hot_px ? `${scene.hot_px.toLocaleString("es-AR")} píxeles de fuego activo · ` : ""}
            {scene.detections ? `${scene.detections} detecciones FIRMS ese día · ` : ""}nubes {Math.round(scene.cloud * 100)} % ·{" "}
            {scenes.length} imágenes elegidas por mostrar fuego o humo (Earth Engine).
          </p>
          </>
          )}
        </div>
      )}

      {/* GOES-19: reproductor */}
      {layers.goes && !fireEvent && (
        <div className="absolute bottom-6 left-1/2 z-[1000] w-[min(420px,calc(100%-1.5rem))] -translate-x-1/2 rounded-lg border border-slate-800 bg-slate-950/90 px-3 py-2 text-[11px] text-slate-300 shadow-xl backdrop-blur">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setGoesPlaying(!goesPlaying)}
              disabled={goesTimes.length < 2}
              className="rounded-md border border-slate-700 p-1 text-slate-200 hover:bg-slate-800 disabled:opacity-40"
              aria-label={goesPlaying ? "Pausar animación" : "Reproducir últimas 6 h"}
            >
              {goesPlaying ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
            </button>
            <input
              type="range"
              min={0}
              max={Math.max(0, goesTimes.length - 1)}
              value={goesIndex}
              onChange={(e) => {
                setGoesPlaying(false);
                setGoesIndex(+e.target.value);
              }}
              className="flex-1 accent-sky-400"
              aria-label="Horario de la imagen"
            />
            <span className="w-24 text-right font-mono text-slate-100">
              {goesTimes[goesIndex] ? goesLocalLabel(goesTimes[goesIndex]) : "—"}
            </span>
          </div>
          <div className="mt-1.5 flex flex-wrap items-center gap-2">
            {historic && goesDays.size > 0 && (
              <select
                value={goesDay ?? ""}
                onChange={(e) => setGoesDay(e.target.value)}
                className="rounded border border-slate-700 bg-slate-900 px-1.5 py-0.5 text-[11px] text-slate-200"
                aria-label="Día de la imagen"
              >
                {[...goesDays.keys()].map((d) => (
                  <option key={d} value={d}>
                    {Number(d.slice(8, 10))} {MONTHS_LONG[Number(d.slice(5, 7)) - 1].slice(0, 3).toLowerCase()}
                    {d === preferredDay ? " · día pico" : ""}
                  </option>
                ))}
              </select>
            )}
            <select
              value={goesProduct}
              onChange={(e) => setGoesProduct(e.target.value as GoesProduct)}
              className="rounded border border-slate-700 bg-slate-900 px-1.5 py-0.5 text-[11px] text-slate-200"
              aria-label="Producto GOES"
            >
              {(Object.keys(GOES_PRODUCTS) as GoesProduct[]).map((k) => (
                <option key={k} value={k}>
                  {GOES_PRODUCTS[k].label}
                </option>
              ))}
            </select>
            <label className="flex items-center gap-1 text-slate-400">
              Opacidad
              <input
                type="range"
                min={0.2}
                max={1}
                step={0.1}
                value={goesOpacity}
                onChange={(e) => setGoesOpacity(+e.target.value)}
                className="w-16 accent-sky-400"
              />
            </label>
            <span className="ml-auto text-[10px] text-slate-500">
              GOES-19 ABI · NASA GIBS · hora AR
            </span>
          </div>
          <p className="mt-1 text-[10px] text-slate-500">
            {goesError ? (
              <span className="text-amber-300">
                {goesError} <span className="text-slate-500">{GOES_HISTORY_NOTE}</span>
              </span>
            ) : historic ? (
              `${GOES_PRODUCTS[goesProduct].hint}. ${MONTHS_LONG[gMonth! - 1]} ${gYear}: ${goesDays.size} días con imagen; ${goesTimes.length} imágenes del día (cada 30 min).`
            ) : (
              `${GOES_PRODUCTS[goesProduct].hint}. Últimas 6 h cada 30 min (${goesTimes.length} imágenes). Elegí un mes arriba para ver fechas pasadas.`
            )}
          </p>
          {goesError && nearEvents.length > 0 && props.onGoToDate && (
            <div className="mt-1.5 flex flex-wrap items-center gap-1">
              <span className="text-[10px] text-slate-400">Incendios con imagen histórica:</span>
              {nearEvents.map((ev) => {
                const d = ev.days[0];
                return (
                  <button
                    key={ev.id}
                    type="button"
                    onClick={() => props.onGoToDate!(Number(d.slice(0, 4)), Number(d.slice(5, 7)))}
                    className="rounded border border-sky-800/70 bg-sky-500/10 px-1.5 py-0.5 text-[10px] text-sky-200 hover:bg-sky-500/20"
                    title={ev.name}
                  >
                    {MONTHS_LONG[Number(d.slice(5, 7)) - 1].slice(0, 3).toLowerCase()} {d.slice(0, 4)}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* Leyenda */}
      <div className="absolute bottom-6 right-3 z-[1000] hidden max-w-[240px] space-y-2 rounded-lg border border-slate-800 bg-slate-950/90 p-2.5 text-[10.5px] text-slate-300 shadow-xl backdrop-blur sm:block">
        {layers.park && (
          <div className="space-y-0.5">
            <p className="flex items-center gap-1.5">
              <span className="inline-block h-2.5 w-4 rounded-sm border-2 border-dashed border-green-400 bg-green-500/10" /> Parque Nacional
            </p>
            <p className="flex items-center gap-1.5">
              <span className="inline-block h-2.5 w-4 rounded-sm border-2 border-dotted border-lime-400 bg-lime-400/5" /> Reserva Nacional
            </p>
          </div>
        )}
        {layers.live && (
          <div>
            <p className="mb-1 text-slate-400">Tiempo casi real (borde blanco)</p>
            <div className="flex gap-2">
              {[["#ef4444", "≤ 6 h"], ["#f97316", "≤ 24 h"], ["#facc15", "≤ 72 h"]].map(([c, l]) => (
                <span key={l} className="flex items-center gap-1">
                  <span className="inline-block h-2.5 w-2.5 rounded-full border border-white" style={{ background: c }} /> {l}
                </span>
              ))}
            </div>
          </div>
        )}
        {layers.hotspots && props.rawPoints && props.rawInfo?.colorBy === "priority" && (
          <div className="space-y-0.5">
            <p className="text-slate-400">Prioridad de atención</p>
            {([4, 3, 2, 1] as const).map((l) => (
              <p key={l} className="flex items-center gap-1.5">
                <span className="inline-block h-2.5 w-2.5 rounded-full border border-slate-900" style={{ background: PRIORITY_COLORS[l] }} />{" "}
                {PRIORITY_LABEL[l]}
              </p>
            ))}
            <p className="max-w-[11rem] text-[9.5px] leading-tight text-slate-500">
              Escala propia de cada sensor (FRP/km² + ΔT 4–11 µm). Círculo grande = MODIS, chico = VIIRS.
            </p>
          </div>
        )}
        {layers.hotspots && props.rawPoints && props.rawInfo?.colorBy !== "priority" && (
          <div className="space-y-0.5">
            <p className="text-slate-400">Detecciones originales</p>
            <p className="flex items-center gap-1.5">
              <span className="inline-block h-3 w-3 rounded-full border border-slate-900" style={{ background: RAW_COLORS.MODIS }} /> MODIS (1 km)
            </p>
            <p className="flex items-center gap-1.5">
              <span className="inline-block h-2.5 w-2.5 rounded-full border border-slate-900" style={{ background: RAW_COLORS.VIIRS }} /> VIIRS (375 m)
            </p>
          </div>
        )}
        {layers.hotspots && !props.rawPoints && props.harmPriority?.colorBy === "priority" && (
          <div className="space-y-0.5">
            <p className="text-slate-400">Celda armonizada: prioridad por sensor</p>
            <table className="border-separate border-spacing-x-1.5 border-spacing-y-0.5 text-[10.5px]">
              <thead>
                <tr className="text-[9.5px] text-slate-500">
                  <th className="text-left font-normal">Escala</th>
                  <th className="font-normal">Solo MODIS</th>
                  <th className="font-normal">Solo VIIRS</th>
                  <th className="font-normal">Ambos</th>
                </tr>
              </thead>
              <tbody>
                {([4, 3, 2, 1] as const).map((l) => (
                  <tr key={l}>
                    <td style={{ color: PRIORITY_COLORS[l] }}>{PRIORITY_LABEL[l]}</td>
                    <td className="text-center">
                      <span className="inline-block h-3 w-3 rounded-full border border-slate-900" style={{ background: PRIORITY_COLORS[l] }} />
                    </td>
                    <td className="text-center">
                      <span className="inline-block h-3 w-3 rounded-full" style={{ border: `2.5px solid ${PRIORITY_COLORS[l]}` }} />
                    </td>
                    <td className="text-center">
                      <span
                        className="inline-block h-3.5 w-3.5 rounded-full"
                        style={{ background: PRIORITY_COLORS[l], border: `2.5px solid ${PRIORITY_COLORS[l]}`, boxShadow: "inset 0 0 0 1px #0f172a" }}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            <p className="max-w-[12rem] text-[9.5px] leading-tight text-slate-500">
              Solo MODIS = círculo relleno · Solo VIIRS = anillo · Ambos = relleno MODIS + anillo VIIRS (mismo color = coinciden).
              Cada sensor usa su propia escala.
            </p>
          </div>
        )}
        {layers.hotspots && !props.rawPoints && props.harmPriority?.colorBy !== "priority" && (
          <div className="space-y-0.5">
            <p className="text-slate-400">Celda armonizada de 1 km vista por…</p>
            <p className="flex items-center gap-1.5">
              <span className="inline-block h-3 w-3 rounded-full border border-slate-900" style={{ background: HARM_SOURCE_COLORS.BOTH }} /> Ambos sensores · peso 1
            </p>
            <p className="flex items-center gap-1.5">
              <span className="inline-block h-3 w-3 rounded-full border border-slate-900" style={{ background: HARM_SOURCE_COLORS.MODIS }} /> Solo MODIS · peso 1
            </p>
            <p className="flex items-center gap-1.5">
              <span className="inline-block h-2.5 w-2.5 rounded-full border border-slate-900" style={{ background: HARM_SOURCE_COLORS.VIIRS }} /> Solo VIIRS · peso α
            </p>
            <p className="mt-1 flex items-center gap-1.5">
              <span className="inline-block h-2.5 w-2.5 rounded-full border border-purple-300 bg-purple-500" /> Fuente fija (industrial)
            </p>
          </div>
        )}
        {layers.spread && (
          <p className="flex items-center gap-1.5">
            <span className="inline-block h-0.5 w-5 bg-yellow-300" /> Avance del incendio (inicio → fin)
          </p>
        )}
        {layers.susceptibility && (
          <div>
            {props.isfLabel && <p className="mb-1 text-slate-400">{props.isfLabel}</p>}
            <div className="flex flex-wrap gap-x-2 gap-y-1">
              {Object.entries(RISK_COLORS).map(([k, c]) => (
                <span key={k} className="flex items-center gap-1">
                  <span className="inline-block h-2.5 w-2.5 rounded-sm" style={{ background: c }} /> {k}
                </span>
              ))}
            </div>
          </div>
        )}
        {layers.wind && (
          <p className="flex items-center gap-1.5">
            <span className="inline-block h-2.5 w-4 rounded-sm border border-dashed border-sky-400 bg-sky-400/20" /> Cono de avance probable (6 h)
          </p>
        )}
      </div>
    </section>
  );
}


/** Controles de la vista armonizada: color por prioridad y matriz de concordancia MODIS × VIIRS. */
function HarmPriorityControls({ hp }: { hp: NonNullable<Props["harmPriority"]> }) {
  const [open, setOpen] = useState(false);
  const c = hp.concordance;
  return (
    <div className="mt-1 space-y-1 text-[10.5px] text-slate-300">
      <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
        <span className="text-slate-500">Color:</span>
        {(
          [
            ["priority", "Prioridad"],
            ["source", "Sensor"],
          ] as const
        ).map(([k, l]) => (
          <button
            key={k}
            type="button"
            onClick={() => hp.onColorBy(k)}
            className={`rounded px-1.5 py-0.5 ${hp.colorBy === k ? "bg-slate-700 text-slate-50" : "text-slate-400 hover:text-slate-200"}`}
          >
            {l}
          </button>
        ))}
        <select
          value={hp.agree}
          onChange={(e) => hp.onAgree(e.target.value as Agreement)}
          className="rounded border border-slate-700 bg-slate-900 px-1 py-0.5 text-[10.5px] text-slate-200"
          aria-label="Concordancia entre sensores"
        >
          <option value="all">Todas las celdas</option>
          <option value="same">Ambos, misma prioridad</option>
          <option value="diff">Ambos, prioridad distinta</option>
        </select>
      </div>
      {hp.loading ? (
        <p className="text-slate-500">Cargando prioridades por sensor…</p>
      ) : c && c.n > 0 ? (
        <div>
          <button type="button" onClick={() => setOpen((o) => !o)} className="text-left text-slate-300 hover:text-slate-100">
            Concordancia en {c.n.toLocaleString("es-AR")} celdas vistas por ambos: <b>{c.exactPct.toFixed(0)} %</b> mismo nivel ·{" "}
            {c.within1Pct.toFixed(0)} % a ±1 · kappa {c.kappa != null ? c.kappa.toFixed(2) : "—"} {open ? "▴" : "▾"}
          </button>
          {open && (
            <div className="mt-1">
              <table className="border-collapse font-mono text-[10px]">
                <thead>
                  <tr>
                    <th className="pr-1 text-left font-normal text-slate-500">MODIS ↓ · VIIRS →</th>
                    {([1, 2, 3, 4] as const).map((j) => (
                      <th key={j} className="px-1 font-normal" style={{ color: PRIORITY_COLORS[j] }}>
                        {PRIORITY_LABEL[j].slice(0, 3)}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {([1, 2, 3, 4] as const).map((i) => (
                    <tr key={i}>
                      <td className="pr-1" style={{ color: PRIORITY_COLORS[i] }}>
                        {PRIORITY_LABEL[i]}
                      </td>
                      {([1, 2, 3, 4] as const).map((j) => (
                        <td
                          key={j}
                          className={`px-1 text-right ${i === j ? "bg-slate-700/70 text-slate-50" : "text-slate-400"}`}
                        >
                          {c.matrix[i - 1][j - 1]}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
              <p className="mt-0.5 max-w-xs text-[9.5px] leading-tight text-slate-500">
                Cada sensor usa su propia escala: la diagonal indica que ambos ubican el fuego en el mismo escalón relativo.
                En la celda se toma el nivel máximo de cada sensor (VIIRS suele tener varios píxeles por celda).
                {c.missing ? ` ${c.missing} celdas sin prioridad de algún sensor.` : ""}
              </p>
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
