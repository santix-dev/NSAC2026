/**
 * Motor de Prevención y Semáforo International Charter (METHODOLOGY.md §3).
 * Umbrales de la metodología: pendiente > 20°, NDVI alto, humedad < 15 %, ráfagas > 35 km/h,
 * foco > P90 histórico + pendiente crítica + alta nubosidad ⇒ recomendar activación del Charter.
 * El Charter solo puede activarlo un Usuario Autorizado (en Argentina, vía CONAE / SINAGIR);
 * la app emite una recomendación, no una activación.
 */
export const THRESHOLDS = {
  steepSlopeDeg: 20,
  highNdvi: 0.5,
  drySoilPct: 15,
  gustKmh: 35,
  highCloudPct: 50,
  steepShareCritical: 0.3,
} as const;

export interface AreaConditions {
  regionLabel: string;
  year: number;
  month: number;
  monthEvents: number;
  p75: number;
  p90: number;
  anomalyPct: number;
  meanSlope: number;
  steepShare: number; // fracción de celdas activas con pendiente > 20°
  meanNdvi: number;
  soilMoisture: number; // GLDAS-2.1 / SMAP (ETL) o modelo paramétrico sin base
  soilSource: string;
  gustKmh: number;
  gustSource: string;
  cloudCover: number;
  windDirDeg: number;
  windKmh: number;
  /** De dónde salen pendiente/humedad/NDVI/viento del escenario */
  basis?: "fire-cells" | "region" | "fire-cells-year";
}

export type Severity = "info" | "warning" | "critical";

export interface PreventionAction {
  id: string;
  title: string;
  detail: string;
  severity: Severity;
  triggered: boolean;
  evidence: string;
  sources: string[];
}

export function buildPreventionActions(c: AreaConditions): PreventionAction[] {
  const f = (v: number, d = 0) => v.toFixed(d);
  return [
    {
      id: "firebreaks",
      title: "Fajas cortafuegos en pie de ladera",
      detail:
        "Pendiente > 20° con alta carga vegetal: abrir/mantener fajas en la base de laderas y manejo de combustible en la interfaz urbano-forestal.",
      severity: "critical",
      triggered: c.meanSlope > THRESHOLDS.steepSlopeDeg && c.meanNdvi >= THRESHOLDS.highNdvi,
      evidence: `Pendiente media ${f(c.meanSlope, 1)}° · ${f(c.steepShare * 100)} % de celdas > 20° · NDVI ${c.meanNdvi.toFixed(2)}`,
      sources: ["NASA SRTM", "NASA MODIS NDVI (MOD13A3)"],
    },
    {
      id: "burn-ban",
      title: "Prohibición total de quemas + brigadistas preventivos",
      detail: "Humedad de suelo < 15 % con ráfagas > 35 km/h: suspender quemas autorizadas y pre-posicionar brigadas.",
      severity: "critical",
      triggered: c.soilMoisture < THRESHOLDS.drySoilPct && c.gustKmh > THRESHOLDS.gustKmh,
      evidence: `Humedad ${f(c.soilMoisture, 1)} % (${c.soilSource}) · ráfagas ${f(c.gustKmh)} km/h (${c.gustSource})`,
      sources: ["NASA GLDAS-2.1 / SMAP", "NASA POWER (WS10M_MAX)"],
    },
    {
      id: "fuel",
      title: "Manejo de biomasa en laderas expuestas",
      detail: "Pendiente pronunciada con vegetación densa aunque la humedad sea moderada: raleo y poda en franjas de 30 m.",
      severity: "warning",
      triggered: c.steepShare > THRESHOLDS.steepShareCritical && c.meanNdvi >= THRESHOLDS.highNdvi - 0.05,
      evidence: `${f(c.steepShare * 100)} % de celdas activas en pendiente crítica · NDVI ${c.meanNdvi.toFixed(2)}`,
      sources: ["NASA SRTM", "NASA MODIS NDVI (MOD13A3)"],
    },
    {
      id: "early-warning",
      title: "Alerta temprana por anomalía térmica",
      detail: "La actividad del mes supera el P75 histórico (2013–2024, serie Armonizada): reforzar vigilancia satelital diaria y comunicación comunitaria.",
      severity: "warning",
      triggered: c.monthEvents > c.p75 && c.monthEvents > 0,
      evidence: `${f(c.monthEvents)} celdas concordantes vs P75 ${f(c.p75, 1)} (anomalía ${c.anomalyPct >= 0 ? "+" : ""}${f(c.anomalyPct)} %)`,
      sources: ["NASA FIRMS (MODIS + VIIRS, celdas concordantes)"],
    },
    {
      id: "radar",
      title: "Priorizar radar SAR sobre sensores ópticos",
      detail: "Nubosidad alta: posible subdetección óptica/térmica; solicitar adquisiciones SAR (p. ej. SAOCOM banda L vía Charter) para humedad de suelo y cicatrices.",
      severity: "info",
      triggered: c.cloudCover >= THRESHOLDS.highCloudPct,
      evidence: `Nubosidad ${f(c.cloudCover)} % (MODIS Cloud Mask)`,
      sources: ["NASA MODIS (MOD09GA)", "CONAE SAOCOM (pedido)"],
    },
    {
      id: "downwind",
      title: "Vigilancia aguas abajo del viento",
      detail: `Viento dominante desde ${f(c.windDirDeg)}° a ${f(c.windKmh)} km/h: priorizar accesos y evacuación de poblaciones a sotavento.`,
      severity: "info",
      triggered: c.windKmh >= 20,
      evidence: `Viento ${f(c.windKmh)} km/h desde ${f(c.windDirDeg)}°`,
      sources: ["NASA POWER / MERRA-2", "Red IoT"],
    },
  ];
}

export type CharterStatus = "green" | "yellow" | "red";

export interface CharterEvaluation {
  status: CharterStatus;
  met: number;
  criteria: { label: string; met: boolean; value: string; threshold: string }[];
  recommendation: string;
}

export function evaluateCharter(c: AreaConditions): CharterEvaluation {
  const criteria = [
    {
      label: "Anomalía térmica > P90 histórico",
      met: c.monthEvents > c.p90 && c.monthEvents > 0,
      value: `${c.monthEvents.toFixed(1)} eventos`,
      threshold: `P90 = ${c.p90.toFixed(1)}`,
    },
    {
      label: "Pendiente crítica (SRTM)",
      met: c.meanSlope > THRESHOLDS.steepSlopeDeg || c.steepShare > THRESHOLDS.steepShareCritical,
      value: `${c.meanSlope.toFixed(1)}° · ${(c.steepShare * 100).toFixed(0)} % > 20°`,
      threshold: `> 20° o > ${THRESHOLDS.steepShareCritical * 100} % del área`,
    },
    {
      label: "Alta nubosidad (incertidumbre óptica)",
      met: c.cloudCover >= THRESHOLDS.highCloudPct,
      value: `${c.cloudCover.toFixed(0)} %`,
      threshold: `≥ ${THRESHOLDS.highCloudPct} %`,
    },
  ];
  const met = criteria.filter((k) => k.met).length;
  const status: CharterStatus = met === 3 ? "red" : met === 2 ? "yellow" : "green";
  const recommendation =
    status === "red"
      ? "Recomendar activación del International Charter: solicitar pasadas de emergencia SAOCOM (radar todo-tiempo) y Sentinel-2 (severidad dNBR 10 m) a través de un Usuario Autorizado (CONAE / SINAGIR)."
      : status === "yellow"
        ? "Pre-alerta: preparar el pedido al Charter y monitorear la evolución; programar adquisiciones SAOCOM/Sentinel-2 por canales nacionales."
        : "Sin criterios de activación: monitoreo rutinario con FIRMS y adquisiciones programadas.";
  return { status, met, criteria, recommendation };
}
