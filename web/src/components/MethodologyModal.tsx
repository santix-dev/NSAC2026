"use client";

import { useEffect, useRef } from "react";
import { Bot, X } from "lucide-react";
import type { DataSource } from "@/types/fire";
import type { IotSource } from "@/lib/iot";

interface Props {
  liveSource?: IotSource | null;
  liveFiresOk?: boolean;
  open: boolean;
  onClose: () => void;
  alpha: number | null;
  dataSource: DataSource | null;
}

type Status = "Integrado" | "Copia estática" | "Sin conexión" | "Protocolo" | "No usado" | "En vivo";

/** Estado de cada fuente: Supabase en vivo o copia estática de los mismos datos reales (web/public/data). */
function sources(db: boolean, live: boolean, fires: boolean): { agency: string; product: string; variable: string; role: string; status: Status }[] {
  const etl: Status = db ? "Integrado" : "Copia estática";
  return [
    {
      agency: "NASA FIRMS",
      product: "MODIS C6.1 (1 km) + VIIRS 375 m: S-NPP hasta 01-11-2026, NOAA-20 desde 02-11-2026",
      variable: "Focos activos, FRP, confianza",
      role: "Serie 2000–2026 armonizada en grilla 0.01° (Etapas 1–4); NOAA-20 llevado a la escala S-NPP (α·β)",
      status: etl,
    },
    {
      agency: "NASA FIRMS NRT",
      product: "VIIRS NOAA-20 + NOAA-21 (375 m) + MODIS Terra/Aqua, últimas 72 h",
      variable: "Focos activos recientes",
      role: "Capa de detección en tiempo casi real (sin armonizar; no entra en el calendario)",
      status: fires ? "En vivo" : "Sin conexión",
    },
    {
      agency: "NOAA GOES-19 (vía NASA GIBS)",
      product: "ABI GeoColor y Fire Temperature RGB, cada 10 min (~1–2 km)",
      variable: "Humo, nubes y señal térmica",
      role: "Capa de imagen y animación de las últimas 6 h (solo visualización)",
      status: "En vivo",
    },
    {
      agency: "NASA SRTM",
      product: "DEM 30 m → pendiente media por celda 0.01° (Earth Engine)",
      variable: "slope_deg",
      role: "S_pendiente del ISF; regla de cortafuegos > 20°",
      status: etl,
    },
    {
      agency: "NASA GLDAS-2.1 + SMAP L3",
      product: "Humedad de suelo 0–10 cm (27 km) / superficial (9 km, desde 2015)",
      variable: "soil_moisture_pct",
      role: "H_suelo; regla de prohibición de quemas < 15 %",
      status: etl,
    },
    {
      agency: "NASA MODIS MOD13A3",
      product: "NDVI mensual 1 km (mes anterior a la celda-día)",
      variable: "ndvi_pre_fire",
      role: "Carga de combustible; regla de cortafuegos",
      status: etl,
    },
    {
      agency: "NASA MODIS MOD09GA",
      product: "Máscara de nubes diaria → % de días nublados por mes",
      variable: "cloud_cover_pct",
      role: "Incertidumbre óptica; criterio Charter",
      status: etl,
    },
    {
      agency: "NASA POWER / MERRA-2",
      product: "Viento mensual a 10 m (WS10M, WD10M), ~0.5°",
      variable: "wind_speed_kmh, wind_direction_deg",
      role: "V_viento del ISF; cono de avance; WS10M_MAX diario para la regla de ráfagas",
      status: etl,
    },
    {
      agency: "Meteomatics",
      product: "Modelo mix en 4 estaciones de la Comarca Andina (cada 10 min)",
      variable: "T, HR, viento, ráfagas, índice de humedad de suelo",
      role: "Condiciones actuales; regla de ráfagas > 35 km/h",
      status: live ? "En vivo" : "Sin conexión",
    },
    {
      agency: "CONAE SAOCOM 1A/1B",
      product: "SAR banda L — mapas de humedad de suelo",
      variable: "—",
      role: "Su producto cubre la región pampeana, no la Comarca Andina; se usa como pedido de emergencia vía Charter",
      status: "No usado",
    },
    {
      agency: "ESA Sentinel-2 MSI",
      product: "Severidad dNBR 10 m",
      variable: "—",
      role: "Mapeo post-evento vía Charter (la serie de NDVI usa MODIS, disponible desde 2000)",
      status: "Protocolo",
    },
    {
      agency: "International Charter",
      product: "Space & Major Disasters",
      variable: "—",
      role: "Pasadas de emergencia SAOCOM + Sentinel-2",
      status: "Protocolo",
    },
  ];
}

const STATUS_STYLE: Record<Status, string> = {
  Integrado: "border-emerald-700/60 bg-emerald-500/10 text-emerald-300",
  "Copia estática": "border-sky-700/60 bg-sky-500/10 text-sky-300",
  "Sin conexión": "border-slate-700 bg-slate-800 text-slate-400",
  Protocolo: "border-sky-700/60 bg-sky-500/10 text-sky-300",
  "No usado": "border-slate-700 bg-slate-800 text-slate-400",
  "En vivo": "border-emerald-700/60 bg-emerald-500/10 text-emerald-300",
};

function H(props: { children: React.ReactNode }) {
  return <h3 className="mb-2 mt-6 text-sm font-semibold uppercase tracking-wide text-orange-300">{props.children}</h3>;
}

function Formula(props: { children: React.ReactNode }) {
  return (
    <pre className="my-2 overflow-x-auto rounded-md border border-slate-800 bg-slate-950 px-3 py-2 font-mono text-[12px] text-slate-100">
      {props.children}
    </pre>
  );
}

export default function MethodologyModal({ open, onClose, alpha, dataSource, liveSource, liveFiresOk = false }: Props) {
  const closeRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    if (!open) return;
    closeRef.current?.focus();
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    document.addEventListener("keydown", onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[2000] flex items-start justify-center overflow-y-auto bg-slate-950/80 p-4 backdrop-blur-sm" onMouseDown={onClose}>
      <div
        role="dialog"
        aria-modal="true"
        aria-labelledby="methodology-title"
        className="relative my-8 w-full max-w-4xl rounded-2xl border border-slate-800 bg-slate-900 p-6 text-sm leading-relaxed text-slate-300 shadow-2xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <button
          ref={closeRef}
          type="button"
          onClick={onClose}
          className="absolute right-4 top-4 rounded-md p-1 text-slate-400 hover:bg-slate-800 hover:text-slate-100"
          aria-label="Cerrar"
        >
          <X className="h-5 w-5" />
        </button>

        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img
          src="/brand/foco-cero-logo.jpg"
          alt="Foco Cero — Monitoreo satelital de puntos calientes"
          className="mb-4 w-full max-w-md rounded-lg border border-slate-800"
        />
        <h2 id="methodology-title" className="pr-10 text-lg font-semibold text-slate-50">
          Metodología Multi-Agencia &amp; Uso de IA
        </h2>
        <p className="mt-1 text-slate-400">
          Foco Cero · NASA Space Apps Challenge 2026 · <i>Harmonization of MODIS and VIIRS Hot Spots</i> (con CONAE)
        </p>

        <H>1. Armonización MODIS (1 km) + VIIRS (375 m)</H>
        <ol className="list-decimal space-y-1 pl-5">
          <li>
            <b>Calidad radiométrica:</b> MODIS <code>confidence ≥ 30</code>; VIIRS <code>confidence ∈ {"{n, h}"}</code>.
          </li>
          <li>
            <b>Máscara geológica/industrial:</b> celdas de 0,01° con &gt; 8 años distintos o &gt; 40 días/año ⇒{" "}
            <code>VOLCANIC_INDUSTRIAL</code>, excluidas del análisis de biomasa.
          </li>
          <li>
            <b>Grilla unificada 0,01° (~1 km):</b> los sub-píxeles VIIRS de una misma celda y día colapsan en 1 celda-día.
          </li>
          <li>
            <b>Calibración cruzada en Sierras de Córdoba (2012–2024)</b> y transferencia a Patagonia Andina:
            <Formula>
              {"α = Σ N_MODIS,grid / Σ N_VIIRS,grid\n" +
                "Fórmula base:  peso = 1 (con MODIS) | α (solo VIIRS)\n" +
                "Variante B:    peso = 1 (antes de 2012) | α (con VIIRS) | 0 (solo MODIS desde 2012)"}
            </Formula>
            La variante usada la define el ETL (<code>--harmonization</code>). Con datos reales FIRMS, la relación
            armonizada/solo-MODIS en 2012–2024 es 1,67–1,73 con la fórmula base y 1,00–1,10 con la variante B.{" "}
            Córdoba tiene el registro más continuo y con menor nubosidad del país, por eso allí se estima α
            {alpha != null && (
              <>
                {" "}
                (<b className="font-mono text-slate-100">α = {alpha.toFixed(4)}</b>
                )
              </>
            )}
            ; Patagonia, con inviernos muy nublados, recibe el mismo factor para eliminar el salto artificial de 2012.
          </li>
        </ol>
        <p className="mt-2 text-slate-400">
          Calendario: línea base = mediana mensual P50 2001–2020; anomalía = (E − P50)/(P50 + 1)·100; mes crítico &gt; P75.
        </p>

        <H>1b. Prioridad de atención por foco (escala propia de cada sensor)</H>
        <p>
          Cada detección original se clasifica en <b>Bajo · Medio · Alto · Extremo</b> dentro de la escala de <b>su propio
          sensor</b>. No es una escala común: «VIIRS · Alto» significa «de los focos más intensos que VIIRS suele ver», no
          que equivalga a «MODIS · Alto».
        </p>
        <ul className="list-disc space-y-1 pl-5">
          <li>
            <b>Densidad de potencia radiativa:</b> <code>FRP / (scan × track)</code> en MW/km² (la FRP por píxel crece con el
            tamaño del píxel hacia el borde de la franja).
          </li>
          <li>
            <b>Contraste térmico:</b> <code>ΔT = T(4 µm) − T(11 µm)</code> (MODIS banda 21/22 − 31; VIIRS I4 − I5), con
            percentiles separados de día y de noche. FIRMS no incluye la temperatura de fondo: ΔT es el mismo sustituto en
            ambos sensores. VIIRS I4 se satura a ~367 K; esos focos reciben el contraste máximo.
          </li>
          <li>
            <b>Índice:</b> <code>IP = 0,5·P(FRP/km²) + 0,5·P(ΔT)</code>, con P = percentil dentro del sensor en su período de
            referencia (MODIS 2000–2024, VIIRS S-NPP 2012–2024). Cortes fijos: P50 / P80 / P95 del índice → Medio / Alto /
            Extremo. NOAA-20/21 usan la escala VIIRS.
          </li>
          <li>
            <b>Diagnóstico con los datos reales:</b> en MODIS, FRP/km² y ΔT están muy correlacionados (Spearman 0,95); en VIIRS
            de día casi nada (0,06) por la saturación. Cambiar el peso entre 0,3 y 0,7 casi no altera la clasificación
            (kappa ponderado ≥ 0,89).
          </li>
        </ul>

        <H>2. Susceptibilidad y propagación en Patagonia Andina</H>
        <Formula>{"ISF = 0,30·S_pendiente + 0,30·(100 − H_suelo) + 0,20·V_viento + 0,20·R_histórico"}</Formula>
        <ul className="list-disc space-y-1 pl-5">
          <li>S: 0° → 0, ≥ 30° → 100 (SRTM). H: humedad volumétrica del suelo (GLDAS-2.1 / SMAP).</li>
          <li>
            V: 0 → 60 km/h normalizado a 0 → 100; R: celdas-día históricas / P95 del área. Clases: Bajo &lt; 40 ≤ Moderado
            &lt; 55 ≤ Alto &lt; 70 ≤ Crítico. <span className="text-slate-400">(Normalizaciones de V, R y clases: supuestos de implementación.)</span>
          </li>
          <li>
            Vectores de propagación: celdas-día agrupadas en eventos (vecindad ≤ 6 km, hueco ≤ 2 días); flecha = desplazamiento
            del centroide entre el primer y el último día.
          </li>
          <li>
            Cono de avance: 6 h a una velocidad de propagación del 6 % de la velocidad del viento, ±22° a sotavento
            (regla empírica, indicativa).
          </li>
        </ul>

        <H>3. Prevención e International Charter</H>
        <ul className="list-disc space-y-1 pl-5">
          <li>Pendiente &gt; 20° + NDVI alto ⇒ fajas cortafuegos en pie de ladera y manejo de combustible en la interfaz.</li>
          <li>Humedad de suelo &lt; 15 % + ráfagas &gt; 35 km/h ⇒ prohibición de quemas y brigadistas preventivos.</li>
          <li>
            Mes &gt; P90 histórico + pendiente crítica + nubosidad ≥ 50 % ⇒ <b>recomendar</b> activar el Charter (pasadas
            SAOCOM y Sentinel-2). La activación formal la realiza un Usuario Autorizado (en Argentina, vía CONAE / SINAGIR).
          </li>
        </ul>

        <H>4. Fuentes y estado de integración en esta versión</H>
        <div className="overflow-x-auto">
          <table className="w-full text-[12px]">
            <thead className="text-left text-slate-500">
              <tr className="border-b border-slate-800">
                <th className="py-1.5 pr-3 font-normal">Fuente</th>
                <th className="pr-3 font-normal">Producto</th>
                <th className="pr-3 font-normal">Variable</th>
                <th className="pr-3 font-normal">Rol</th>
                <th className="font-normal">Estado</th>
              </tr>
            </thead>
            <tbody>
              {sources(dataSource === "supabase", liveSource === "meteomatics", liveFiresOk).map((s) => (
                <tr key={s.agency} className="border-b border-slate-800/70 align-top">
                  <td className="py-1.5 pr-3 font-medium text-slate-100">{s.agency}</td>
                  <td className="pr-3">{s.product}</td>
                  <td className="pr-3 font-mono text-[11px]">{s.variable}</td>
                  <td className="pr-3">{s.role}</td>
                  <td>
                    <span className={`whitespace-nowrap rounded border px-1.5 py-0.5 text-[10.5px] ${STATUS_STYLE[s.status]}`}>
                      {s.status}
                    </span>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="mt-2 text-[12px] text-slate-400">
          <b>Integrado</b>: valores reales procesados por el ETL (<code>etl/env/</code>: Earth Engine + NASA POWER) y
          servidos desde Supabase (<code>env_source = &apos;AUX&apos;</code>). <b>Copia estática</b>: si la base no responde, la
          app lee una copia de esos mismos datos reales exportada por <code>etl/export_web_snapshot.py</code>; nunca genera
          valores. El mapa de susceptibilidad (ISF) usa la grilla real <code>env_grid_clim</code> (climatología mensual 0,05° de
          SRTM, GLDAS/SMAP y POWER); donde no existe, no se dibuja. <b>Sin conexión</b>: si Meteomatics no responde, las
          estaciones no muestran ni evalúan lecturas. Las ráfagas usan el viento máximo diario de NASA POWER (<code>WS10M_MAX</code>, máximo de promedios horarios, no ráfaga instantánea); si falta, se estiman como viento medio × 1,45.
        </p>

        <H>5. Declaración de uso de IA</H>
        <div className="flex gap-3 rounded-lg border border-slate-800 bg-slate-950 p-3">
          <Bot className="mt-0.5 h-5 w-5 shrink-0 text-orange-300" aria-hidden />
          <div className="space-y-1.5">
            <p>
              El equipo usó <b>Claude (Anthropic)</b> como asistente de desarrollo para escribir el pipeline ETL en Python,
              el esquema y las funciones SQL/PostGIS, la aplicación Next.js y un generador sintético usado solo para probar el ETL
              (<code>--generate-sample</code>), que la aplicación no utiliza.
            </p>
            <p>
              Las fórmulas científicas provienen de la metodología definida por el equipo (2 desarrolladores backend + 1
              geólogo), que revisa y valida los resultados. La IA no se usó para producir observaciones: todos los valores que
              muestra la app provienen de NASA FIRMS, Earth Engine (SRTM, GLDAS, SMAP, MODIS), NASA POWER y Meteomatics, y cada
              uno indica su fuente en la interfaz y en el CSV exportado.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
