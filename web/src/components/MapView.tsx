"use client";

import "leaflet/dist/leaflet.css";
import { Fragment, useEffect, useMemo, useState } from "react";
import L from "leaflet";
import type { FeatureCollection } from "geojson";
import {
  CircleMarker,
  GeoJSON,
  ImageOverlay,
  Pane,
  LayersControl,
  MapContainer,
  Marker,
  Polygon,
  Polyline,
  Popup,
  Rectangle,
  TileLayer,
  Tooltip,
  useMap,
} from "react-leaflet";
import type { BBox, HotspotRecord } from "@/types/fire";
import type { IotStation } from "@/lib/regions";
import { fmt, type IotReading } from "@/lib/iot";
import type { SpreadVector } from "@/lib/spread";
import type { SusceptibilityCell } from "@/lib/susceptibility";
import { compassLabel, destination } from "@/lib/spread";
import { HARM_SOURCE_COLORS, PRIORITY_COLORS, PRIORITY_LABEL, RAW_COLORS, RISK_COLORS } from "@/lib/colors";
import { ageHours, ageLabel, localTime, type LiveFire } from "@/lib/firmsLive";
import type { RawDetection } from "@/types/fire";
import { priorityOf, type CellPriority } from "@/lib/cellPriority";
import { GOES_MAX_NATIVE_ZOOM, goesTileUrl, type GoesProduct } from "@/lib/goes";

export interface GoesOverlay {
  product: GoesProduct;
  times: string[];
  index: number;
  opacity: number;
}

/** Escenas de un incendio histórico (Landsat / Sentinel-2 / MODIS), cada una con sus límites. */
export interface SceneOverlay {
  index: number;
  opacity: number;
  items: { url: string; bounds: [[number, number], [number, number]] }[];
}

export interface WindOverlay {
  origin: [number, number];
  fromDeg: number; // dirección meteorológica (desde dónde sopla)
  speedKmh: number;
  source: string;
  coneKm: number;
}

export interface MapViewProps {
  bbox: BBox;
  hotspots: HotspotRecord[];
  spread: SpreadVector[];
  susceptibility: SusceptibilityCell[];
  iot: { station: IotStation; reading: IotReading }[];
  wind: WindOverlay | null;
  liveFires: LiveFire[];
  /** Detecciones originales (sin armonizar). Si viene, reemplaza a las celdas armonizadas en el mapa. */
  rawPoints?: RawDetection[] | null;
  /** Color de las detecciones originales: por sensor o por prioridad de atención */
  rawColorBy?: "sensor" | "priority";
  /** Vista armonizada: prioridad de cada sensor dentro de la celda (relleno MODIS, contorno VIIRS) */
  cellPriority?: Map<string, CellPriority> | null;
  harmColorBy?: "priority" | "source";
  goes: GoesOverlay | null;
  scenes?: SceneOverlay | null;
  /** Encuadrar el mapa en estos límites (cambia `key` para volver a hacerlo) */
  focus?: { bounds: [[number, number], [number, number]]; key: number } | null;
  show: {
    live: boolean;
    hotspots: boolean;
    spread: boolean;
    susceptibility: boolean;
    iot: boolean;
    wind: boolean;
    park: boolean;
    goes: boolean;
  };
}

/** Color por antigüedad de la detección en tiempo casi real (rojo = última hora). */
export function liveColor(h: number): string {
  return h <= 6 ? "#ef4444" : h <= 24 ? "#f97316" : "#facc15";
}

const MAX_DRAWN_HOTSPOTS = 3500;
/** Clave pública de CARTO Basemaps (carto.com/basemaps/apikey). Sin ella se usa Esri Dark Gray. */
const CARTO_API_KEY = process.env.NEXT_PUBLIC_CARTO_API_KEY;

function FitBounds({ bbox }: { bbox: BBox }) {
  const map = useMap();
  useEffect(() => {
    map.invalidateSize();
    map.fitBounds(
      [
        [bbox[1], bbox[0]],
        [bbox[3], bbox[2]],
      ],
      { padding: [16, 16] },
    );
  }, [map, bbox]);
  return null;
}

function arrowHead(end: [number, number], bearing: number, km: number): [number, number][] {
  return [destination(end, bearing + 180 - 28, km), end, destination(end, bearing + 180 + 28, km)];
}

const iotIcon = L.divIcon({
  className: "iot-marker",
  html: `<div style="width:26px;height:26px;border-radius:9999px;background:#0e7490;border:2px solid #67e8f9;box-shadow:0 0 0 4px rgba(103,232,249,.18);display:flex;align-items:center;justify-content:center;color:#ecfeff;font:600 9px/1 ui-monospace,monospace">IoT</div>`,
  iconSize: [26, 26],
  iconAnchor: [13, 13],
  popupAnchor: [0, -14],
});


function Row({ k, v }: { k: string; v: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", gap: 12 }}>
      <span style={{ color: "#94a3b8" }}>{k}</span>
      <span style={{ fontFamily: "ui-monospace, monospace" }}>{v}</span>
    </div>
  );
}

/** Comparativa de prioridad por sensor dentro de una celda armonizada (una fila por sensor). */
function PriorityCompare({ m, v }: { m: 1 | 2 | 3 | 4 | null; v: 1 | 2 | 3 | 4 | null }) {
  const line = (sensor: string, lv: 1 | 2 | 3 | 4, ring: boolean) => (
    <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "2px 0" }}>
      <span style={{ width: 44, color: "#94a3b8" }}>{sensor}</span>
      <span
        style={{
          width: 11,
          height: 11,
          borderRadius: 9999,
          flexShrink: 0,
          background: ring ? "transparent" : PRIORITY_COLORS[lv],
          border: ring ? `2.5px solid ${PRIORITY_COLORS[lv]}` : "1px solid #0f172a",
        }}
      />
      <span style={{ fontWeight: 700, color: PRIORITY_COLORS[lv] }}>{PRIORITY_LABEL[lv]}</span>
    </div>
  );
  const diff = m && v ? Math.abs(m - v) : null;
  return (
    <div style={{ margin: "6px 0", padding: "6px 8px", borderRadius: 6, background: "#0f172a", border: "1px solid #1e293b" }}>
      <div style={{ fontSize: 10, letterSpacing: 0.4, textTransform: "uppercase", color: "#64748b", marginBottom: 2 }}>
        Prioridad de atención
      </div>
      {m ? line("MODIS", m, false) : null}
      {v ? line("VIIRS", v, true) : null}
      {diff != null && (
        <div style={{ marginTop: 3, fontWeight: 600, color: diff === 0 ? "#4ade80" : "#fbbf24" }}>
          {diff === 0 ? "✓ Coinciden" : `≠ Difieren en ${diff} nivel${diff > 1 ? "es" : ""}`}
        </div>
      )}
      {(!m || !v) && (
        <div style={{ marginTop: 3, color: "#94a3b8" }}>{m ? "Detectado solo por MODIS" : "Detectado solo por VIIRS"}</div>
      )}
    </div>
  );
}

/** Formato grados-minutos-segundos para radio / GPS de brigadas. */
function dms(v: number, pos: string, neg: string): string {
  const a = Math.abs(v);
  const d = Math.floor(a);
  const m = Math.floor((a - d) * 60);
  const s = ((a - d) * 60 - m) * 60;
  return `${d}°${String(m).padStart(2, "0")}'${s.toFixed(1).padStart(4, "0")}"${v < 0 ? neg : pos}`;
}

/** Coordenadas del punto con botón para copiar (decimal) y formato GMS. */
function Coords({ lat, lon, note }: { lat: number; lon: number; note?: string }) {
  const [copied, setCopied] = useState(false);
  const dec = `${lat.toFixed(5)}, ${lon.toFixed(5)}`;
  return (
    <div style={{ margin: "4px 0 6px", padding: "4px 6px", borderRadius: 6, background: "#0f172a", border: "1px solid #334155" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
        <span style={{ fontFamily: "ui-monospace, monospace", color: "#e2e8f0" }}>{dec}</span>
        <button
          type="button"
          onClick={() => {
            void navigator.clipboard?.writeText(dec).then(() => {
              setCopied(true);
              setTimeout(() => setCopied(false), 1500);
            });
          }}
          style={{ fontSize: 10, padding: "1px 6px", borderRadius: 4, border: "1px solid #475569", color: copied ? "#6ee7b7" : "#cbd5e1", background: "transparent", cursor: "pointer" }}
          aria-label="Copiar coordenadas"
        >
          {copied ? "Copiado" : "Copiar"}
        </button>
      </div>
      <div style={{ fontFamily: "ui-monospace, monospace", fontSize: 10, color: "#94a3b8" }}>
        {dms(lat, "N", "S")} {dms(lon, "E", "O")}
      </div>
      {note && <div style={{ fontSize: 10, color: "#64748b" }}>{note}</div>}
    </div>
  );
}

/** Límites de áreas protegidas (PN Los Alerces), GeoJSON estático en /data. */
function useProtectedAreas(enabled: boolean): FeatureCollection | null {
  const [fc, setFc] = useState<FeatureCollection | null>(null);
  useEffect(() => {
    if (!enabled || fc) return;
    let cancelled = false;
    fetch("/data/protected_areas.geojson")
      .then((r) => (r.ok ? r.json() : null))
      .then((j) => {
        if (!cancelled && j) setFc(j);
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [enabled, fc]);
  return fc;
}

function FocusBounds({ focus }: { focus: { bounds: [[number, number], [number, number]]; key: number } }) {
  const map = useMap();
  useEffect(() => {
    map.flyToBounds(focus.bounds, { padding: [30, 30], duration: 0.8 });
  }, [map, focus.key, focus.bounds]);
  return null;
}

const PLATFORM_LABEL: Record<string, string> = { SNPP: "Suomi-NPP", N20: "NOAA-20", N21: "NOAA-21", Terra: "Terra", Aqua: "Aqua" };

export default function MapView({ bbox, hotspots, spread, susceptibility, iot, wind, liveFires, rawPoints, rawColorBy = "sensor", cellPriority = null, harmColorBy = "source", goes, scenes, focus, show }: MapViewProps) {
  const parks = useProtectedAreas(show.park);
  const drawn = useMemo(
    () =>
      hotspots.length > MAX_DRAWN_HOTSPOTS
        ? [...hotspots].sort((a, b) => (b.max_frp ?? 0) - (a.max_frp ?? 0)).slice(0, MAX_DRAWN_HOTSPOTS)
        : hotspots,
    [hotspots],
  );

  const cone = useMemo(() => {
    if (!wind) return null;
    const toward = (wind.fromDeg + 180) % 360;
    const arc: [number, number][] = [];
    for (let a = -22; a <= 22; a += 4) arc.push(destination(wind.origin, toward + a, wind.coneKm));
    const tip = destination(wind.origin, toward, wind.coneKm * 0.55);
    return { toward, polygon: [wind.origin, ...arc] as [number, number][], tip };
  }, [wind]);

  const center: [number, number] = [(bbox[1] + bbox[3]) / 2, (bbox[0] + bbox[2]) / 2];

  return (
    <MapContainer center={center} zoom={8} preferCanvas className="h-full w-full" scrollWheelZoom>
      <FitBounds bbox={bbox} />

      {show.goes && goes && goes.times.length > 0 && (
        <Pane name="goes" style={{ zIndex: 350 }}>
          {goes.times.map((t, i) => (
            <TileLayer
              key={`${goes.product}-${t}`}
              url={goesTileUrl(goes.product, t)}
              maxNativeZoom={GOES_MAX_NATIVE_ZOOM}
              opacity={i === goes.index ? goes.opacity : 0}
              attribution="GOES-19 ABI · NOAA / NASA GIBS"
            />
          ))}
        </Pane>
      )}

      {show.goes && scenes && scenes.items.length > 0 && (
        <Pane name="scenes" style={{ zIndex: 360 }}>
          {scenes.items.map((it, i) =>
            // solo se montan la escena actual y las vecinas (precarga) para no bajar todas
            Math.abs(i - scenes.index) <= 1 && it.url ? (
              <ImageOverlay
                key={it.url}
                url={it.url}
                bounds={it.bounds}
                opacity={i === scenes.index ? scenes.opacity : 0}
                attribution="USGS Landsat · ESA Sentinel-2 · NASA MODIS vía Google Earth Engine"
              />
            ) : null,
          )}
        </Pane>
      )}

      {focus && <FocusBounds focus={focus} />}

      {show.park && parks && (
        <GeoJSON
          key="parks"
          data={parks}
          style={(f) =>
            f?.properties?.kind === "reserve"
              ? { color: "#a3e635", weight: 1.6, dashArray: "2 4", fillColor: "#a3e635", fillOpacity: 0.04 }
              : { color: "#4ade80", weight: 2.2, dashArray: "6 4", fillColor: "#22c55e", fillOpacity: 0.07 }
          }
          onEachFeature={(f, layer) => {
            const p = (f.properties ?? {}) as Record<string, string | number>;
            layer.bindTooltip(String(p.name ?? "Área protegida"), { sticky: true });
            layer.bindPopup(
              `<strong>${p.name}</strong><br/><span style="color:#94a3b8">${p.designation ?? ""}</span><br/>` +
                `Superficie ≈ ${Number(p.area_km2 ?? 0).toLocaleString("es-AR")} km² · ${p.operator ?? ""}<br/>` +
                `<span style="color:#64748b;font-size:10px">${p.source ?? ""}</span>`,
            );
          }}
        />
      )}
      <LayersControl position="bottomleft">
        {CARTO_API_KEY ? (
          <LayersControl.BaseLayer checked name="Oscuro (CARTO)">
            <TileLayer
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> &copy; <a href="https://carto.com/attributions">CARTO</a>'
              url={`https://basemaps.cartocdn.com/rastertiles/dark_all/{z}/{x}/{y}.png?key=${encodeURIComponent(CARTO_API_KEY)}`}
              maxZoom={19}
            />
          </LayersControl.BaseLayer>
        ) : (
          <LayersControl.BaseLayer checked name="Oscuro (Esri)">
            <TileLayer
              attribution="Tiles &copy; Esri — Esri, HERE, Garmin, &copy; OpenStreetMap contributors"
              url="https://server.arcgisonline.com/ArcGIS/rest/services/Canvas/World_Dark_Gray_Base/MapServer/tile/{z}/{y}/{x}"
              maxZoom={16}
            />
          </LayersControl.BaseLayer>
        )}
        <LayersControl.BaseLayer name="Relieve (OpenTopoMap)">
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>, SRTM | &copy; <a href="https://opentopomap.org">OpenTopoMap</a> (CC-BY-SA)'
            url="https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png"
            maxZoom={17}
          />
        </LayersControl.BaseLayer>
        <LayersControl.BaseLayer name="Satélite (Esri)">
          <TileLayer
            attribution="Tiles &copy; Esri — Source: Esri, Maxar, Earthstar Geographics"
            url="https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}"
            maxZoom={18}
          />
        </LayersControl.BaseLayer>
      </LayersControl>

      <Rectangle
        bounds={[
          [bbox[1], bbox[0]],
          [bbox[3], bbox[2]],
        ]}
        pathOptions={{ color: "#f97316", weight: 1.5, dashArray: "6 6", fill: false }}
      />

      {show.susceptibility &&
        susceptibility.map((c, i) => (
          <Rectangle
            key={`s${i}`}
            bounds={c.bounds}
            pathOptions={{ stroke: false, fillColor: RISK_COLORS[c.level], fillOpacity: 0.42 }}
          >
            <Popup>
              <strong>Susceptibilidad: {c.level}</strong> (ISF {c.isf.toFixed(0)}/100)
              <Row k="Pendiente SRTM" v={`${c.slope.toFixed(1)}°`} />
              <Row k="Humedad de suelo" v={`${c.soil.toFixed(1)} %`} />
              <Row k="Viento POWER" v={`${c.wind.toFixed(1)} km/h`} />
              <Row k="Recurrencia histórica" v={`${c.recurrence} celdas-día`} />
              <p style={{ marginTop: 6, color: "#94a3b8" }}>
                {c.source === "real"
                  ? "Climatología real del mes: SRTM · GLDAS/SMAP · NASA POWER (celda 0,05°)."
                  : "Variables ambientales: modelo paramétrico."}
              </p>
            </Popup>
          </Rectangle>
        ))}

      {show.hotspots &&
        rawPoints &&
        rawPoints.map((d, i) => {
          const industrial = d.thermal_type === "VOLCANIC_INDUSTRIAL";
          const t = (d.acq_time ?? "").padStart(4, "0");
          const iso = `${d.acq_date}T${t.slice(0, 2)}:${t.slice(2)}:00Z`;
          return (
            <CircleMarker
              key={`raw-${i}-${d.acq_date}-${d.lat}-${d.lon}`}
              center={[d.lat, d.lon]}
              radius={d.sensor === "MODIS" ? 4.5 : 3}
              pathOptions={{
                color: industrial ? "#c084fc" : d.in_calendar ? "#0f172a" : "#e2e8f0",
                weight: industrial ? 1.5 : 0.7,
                dashArray: d.in_calendar ? undefined : "2 2",
                fillColor: industrial
                  ? "#a855f7"
                  : rawColorBy === "priority" && d.priority_level
                    ? PRIORITY_COLORS[d.priority_level]
                    : RAW_COLORS[d.sensor],
                fillOpacity: d.in_calendar ? 0.85 : 0.45,
              }}
            >
              <Popup>
                <strong>
                  Detección original {d.sensor} · {d.acq_date} {t.slice(0, 2)}:{t.slice(2)} UTC
                </strong>
                <Coords
                  lat={d.lat}
                  lon={d.lon}
                  note={`Centro del píxel FIRMS (${d.sensor === "MODIS" ? "1 km" : "375 m"}), posición real sin grilla`}
                />
                <Row k="Satélite" v={`${d.sensor} ${PLATFORM_LABEL[d.platform ?? ""] ?? d.platform ?? ""}`} />
                <Row k="Hora local (AR)" v={localTime(iso)} />
                <Row k="Confianza" v={d.confidence ?? "—"} />
                {d.priority_level ? (
                  <Row
                    k={`Prioridad (escala ${d.sensor})`}
                    v={`${PRIORITY_LABEL[d.priority_level]} · índice ${d.priority_score ?? "—"}/100`}
                  />
                ) : null}
                <Row k="FRP" v={d.frp != null ? `${d.frp.toFixed(1)} MW` : "—"} />
                {d.delta_t != null && <Row k="ΔT (4 − 11 µm)" v={`${Number(d.delta_t).toFixed(1)} K`} />}
                <Row k="Tipo térmico" v={industrial ? "Volcánico/Industrial" : "Vegetación"} />
                <Row
                  k="En la serie armonizada"
                  v={d.in_calendar ? "Sí" : "No (plataforma extra: solo registro)"}
                />
                <p style={{ marginTop: 6, color: "#94a3b8" }}>
                  NASA FIRMS, tras el filtro de calidad. Sin armonizar: cada punto es una detección del satélite.
                </p>
              </Popup>
            </CircleMarker>
          );
        })}

      {show.hotspots &&
        !rawPoints &&
        drawn.map((h) => {
          const industrial = h.thermal_type === "VOLCANIC_INDUSTRIAL";
          const pr = cellPriority ? priorityOf(cellPriority, h) : null;
          const byPrio = harmColorBy === "priority" && pr != null && !industrial;
          const baseR = (2.5 + Math.min(4, Math.log2(1 + h.raw_detections_count))) * (0.6 + 0.4 * Math.min(1, h.harmonized_weight));
          return (
            <CircleMarker
              key={`${h.grid_cell_id}-${h.acq_date}`}
              center={[h.lat, h.lon]}
              radius={byPrio ? Math.max(baseR, 4) + 1.5 : baseR}
              pathOptions={
                byPrio
                  ? {
                      // relleno = prioridad MODIS · contorno = prioridad VIIRS
                      // solo MODIS → círculo relleno con borde fino · solo VIIRS → anillo de su color
                      fillColor: PRIORITY_COLORS[(pr.m ?? pr.v ?? 1) as 1 | 2 | 3 | 4],
                      fillOpacity: pr.m ? 0.9 : 0.15,
                      color: pr.v ? PRIORITY_COLORS[pr.v] : "#0f172a",
                      weight: pr.v ? 3 : 0.8,
                    }
                  : {
                      color: industrial ? "#c084fc" : "#0f172a",
                      weight: industrial ? 1.5 : 0.6,
                      fillColor: industrial ? "#a855f7" : HARM_SOURCE_COLORS[h.sensor_source],
                      fillOpacity: 0.9,
                    }
              }
            >
              <Popup>
                <strong>
                  {h.acq_date} · celda {h.grid_cell_id}
                </strong>
                <Coords lat={h.lat} lon={h.lon} note="Centro de la celda 0,01° (~1 km) de la grilla armonizada" />
                <Row
                  k="Sensor"
                  v={h.sensor_source === "BOTH" ? "MODIS y VIIRS" : h.sensor_source === "VIIRS" ? "Solo VIIRS (peso α)" : "Solo MODIS"}
                />
                {pr && (pr.m || pr.v) ? <PriorityCompare m={pr.m} v={pr.v} /> : null}
                <Row k="Peso armonizado" v={h.harmonized_weight.toFixed(3)} />
                <Row k="Detecciones crudas" v={String(h.raw_detections_count)} />
                <Row k="FRP máx" v={h.max_frp != null ? `${h.max_frp.toFixed(1)} MW` : "—"} />
                <Row k="Tipo térmico" v={industrial ? "Volcánico/Industrial" : "Vegetación"} />
                <Row k="Pendiente" v={h.slope_deg != null ? `${h.slope_deg.toFixed(1)}°` : "—"} />
                <Row k="Humedad suelo" v={h.soil_moisture_pct != null ? `${h.soil_moisture_pct.toFixed(1)} %` : "—"} />
                <Row k="Nubosidad" v={h.cloud_cover_pct != null ? `${h.cloud_cover_pct.toFixed(0)} %` : "—"} />
                <Row
                  k="Viento"
                  v={
                    h.wind_speed_kmh != null
                      ? `${h.wind_speed_kmh.toFixed(0)} km/h ${compassLabel(h.wind_direction_deg ?? 0)}`
                      : "—"
                  }
                />
                <Row k="NDVI previo" v={h.ndvi_pre_fire != null ? h.ndvi_pre_fire.toFixed(2) : "—"} />
                <Row k="Viento máx. del día" v={h.wind_max_kmh != null ? `${h.wind_max_kmh.toFixed(0)} km/h` : "—"} />
                <p style={{ marginTop: 6, color: "#94a3b8" }}>
                  {h.env_source === "PARAMETRIC"
                    ? "Variables ambientales: modelo paramétrico."
                    : "Variables: SRTM · GLDAS/SMAP · MODIS NDVI y nubes · NASA POWER."}
                </p>
              </Popup>
            </CircleMarker>
          );
        })}

      {show.spread &&
        spread.map((v) => (
          <Fragment key={`v${v.id}`}>
            <Polyline positions={v.path} pathOptions={{ color: "#fbbf24", weight: 1.5, opacity: 0.55, dashArray: "3 5" }} />
            <Polyline positions={[v.start, v.end]} pathOptions={{ color: "#fde047", weight: 3, opacity: 0.95 }}>
              <Tooltip sticky>
                Avance {compassLabel(v.bearingDeg)} ({v.bearingDeg.toFixed(0)}°) · {v.distanceKm.toFixed(1)} km en {v.days} días
                <br />
                {v.startDate} → {v.endDate} · {v.cellDays} celdas-día
              </Tooltip>
            </Polyline>
            <Polyline
              positions={arrowHead(v.end, v.bearingDeg, Math.max(Math.min(v.distanceKm * 0.25, 2.5), 0.7))}
              pathOptions={{ color: "#fde047", weight: 3 }}
            />
          </Fragment>
        ))}

      {show.wind && wind && cone && (
        <>
          <Polygon
            positions={cone.polygon}
            pathOptions={{ color: "#38bdf8", weight: 1.5, dashArray: "4 4", fillColor: "#38bdf8", fillOpacity: 0.22 }}
          >
            <Tooltip sticky>
              Cono de avance probable · viento {wind.speedKmh.toFixed(0)} km/h desde {compassLabel(wind.fromDeg)} (
              {wind.fromDeg.toFixed(0)}°) · {wind.coneKm.toFixed(1)} km en 6 h (heurístico)
            </Tooltip>
          </Polygon>
          <Polyline positions={[wind.origin, cone.tip]} pathOptions={{ color: "#7dd3fc", weight: 3 }} />
          <Polyline
            positions={arrowHead(cone.tip, cone.toward, Math.max(wind.coneKm * 0.08, 0.6))}
            pathOptions={{ color: "#7dd3fc", weight: 3 }}
          />
        </>
      )}

      {show.live &&
        liveFires.map((f, i) => {
          const h = ageHours(f);
          return (
            <CircleMarker
              key={`live-${i}-${f.acq_datetime}-${f.lat}`}
              center={[f.lat, f.lon]}
              radius={f.instrument === "MODIS" ? 6 : 4.5}
              pathOptions={{ color: "#ffffff", weight: 1.4, fillColor: liveColor(h), fillOpacity: h <= 24 ? 0.95 : 0.6 }}
            >
              <Popup>
                <strong>Foco en tiempo casi real · {ageLabel(h)}</strong>
                <Coords lat={f.lat} lon={f.lon} note={`Centro del píxel ${f.instrument === "MODIS" ? "1 km" : "375 m"} (FIRMS)`} />
                <Row k="Detectado" v={`${localTime(f.acq_datetime)} (hora AR)`} />
                <Row k="Satélite" v={`${f.instrument} ${f.satellite}`} />
                <Row k="Resolución" v={f.instrument === "MODIS" ? "1 km" : "375 m"} />
                <Row k="FRP" v={f.frp != null ? `${f.frp.toFixed(1)} MW` : "—"} />
                <Row k="Confianza" v={f.confidence || "—"} />
                <Row k="Pasada" v={f.daynight === "D" ? "Diurna" : f.daynight === "N" ? "Nocturna" : "—"} />
                <p style={{ marginTop: 6, color: "#94a3b8" }}>
                  NASA FIRMS {f.source.replace("_", " ")} · sin armonizar (capa de detección).
                </p>
              </Popup>
            </CircleMarker>
          );
        })}

      {show.iot &&
        iot.map(({ station, reading }) => (
          <Marker key={station.id} position={[station.lat, station.lon]} icon={iotIcon}>
            <Tooltip direction="top" offset={[0, -12]}>
              {station.name} · {fmt(reading.temperature_c, 1, " °C")}
            </Tooltip>
            <Popup minWidth={210}>
              <strong>
                Estación {station.name} ({station.id})
              </strong>
              <Coords lat={station.lat} lon={station.lon} />
              <div style={{ color: "#fbbf24", fontSize: 10, marginBottom: 4 }}>
                Meteomatics (modelo mix) ·{" "}
                {new Date(reading.timestamp).toLocaleTimeString("es-AR")}
              </div>
              <Row k="Temperatura" v={fmt(reading.temperature_c, 1, " °C")} />
              <Row k="Humedad relativa" v={fmt(reading.relative_humidity_pct, 0, " %")} />
              <Row
                k="Viento"
                v={`${fmt(reading.wind_speed_kmh, 0, " km/h")} ${reading.wind_direction_deg != null ? compassLabel(reading.wind_direction_deg) : ""}`}
              />
              <Row k="Ráfagas (1 h)" v={fmt(reading.wind_gust_kmh, 0, " km/h")} />
              <Row k="Índice humedad suelo" v={fmt(reading.soil_moisture_index, 2)} />
              <Row k="Altitud" v={`${station.elevation_m} m`} />
            </Popup>
          </Marker>
        ))}
    </MapContainer>
  );
}
