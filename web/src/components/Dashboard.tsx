"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertCircle, X } from "lucide-react";
import type {
  BBox,
  CalendarResult,
  EnvGridCell,
  HotspotsResult,
  MapLayers,
  Palette,
  RecurrenceCell,
  Region,
  RegionMonthEnv,
  SeriesMode,
} from "@/types/fire";
import {
  downloadText,
  getBurningCalendar,
  getCalibrationAlpha,
  getEnvGrid,
  getHotspots,
  getRecurrence,
  getRegionMonthEnv,
  getRegions,
  hotspotsToCsv,
  RECURRENCE_CELL_DEG,
} from "@/lib/fireService";
import { bboxCenter, CUSTOM_REGION, DEFAULT_REGION, FALLBACK_REGIONS, inBBox, IOT_STATIONS, MONTHS_LONG } from "@/lib/regions";
import { fetchLiveReadings, type LiveReadingsResult } from "@/lib/iot";
import { fetchLiveFires, summarizeLive, type LiveFiresResult } from "@/lib/firmsLive";
import { anomalyPct, monthlyBaseline, quantile } from "@/lib/stats";
import { computeSpreadVectors, dominantBearing, compassLabel } from "@/lib/spread";
import { buildSusceptibilityFromGrid } from "@/lib/susceptibility";
import { THRESHOLDS, type AreaConditions } from "@/lib/prevention";
import { readUrlState, writeUrlState, type Section } from "@/lib/urlState";
import TopBar from "./TopBar";
import Sidebar from "./Sidebar";
import MapSelector from "./MapSelector";
import type { WindOverlay } from "./MapView";
import BurnCalendar from "./BurnCalendar";
import AnomalyChart from "./AnomalyChart";
import MethodologyModal from "./MethodologyModal";
import SummaryPanel from "./panels/SummaryPanel";
import RiskPanel from "./panels/RiskPanel";
import CharterPanel from "./panels/CharterPanel";
import DataPanel from "./panels/DataPanel";

const DEFAULT_YEAR = 2025;
/** Cono de avance: velocidad de propagación ≈ 6 % de la velocidad del viento durante 6 h (regla empírica). */
const CONE_ROS_FRACTION = 0.06;
const CONE_HOURS = 6;

export default function Dashboard() {
  const [ready, setReady] = useState(false);
  const [regions, setRegions] = useState<Region[]>(FALLBACK_REGIONS);
  const [regionKey, setRegionKey] = useState<string>(DEFAULT_REGION);
  const [customLabel, setCustomLabel] = useState<string | null>(null);
  const [bbox, setBbox] = useState<BBox>(FALLBACK_REGIONS[0].bbox);
  const [excludeNonFire, setExcludeNonFire] = useState(true);
  const [mode, setMode] = useState<SeriesMode>("harmonized");
  const [palette, setPalette] = useState<Palette>("viridis");
  const [selectedYear, setSelectedYear] = useState(DEFAULT_YEAR);
  /** Mes filtrado (1–12) o null = todo el año */
  const [selectedMonth, setSelectedMonth] = useState<number | null>(null);
  const [section, setSection] = useState<Section>("resumen");
  const [mobileOpen, setMobileOpen] = useState(false);
  const [layers, setLayers] = useState<MapLayers>({ live: true, park: true, goes: false, hotspots: true, spread: true, susceptibility: false, iot: true, wind: true });
  const [calendar, setCalendar] = useState<CalendarResult | null>(null);
  const [hotspots, setHotspots] = useState<HotspotsResult | null>(null);
  const [recurrence, setRecurrence] = useState<RecurrenceCell[]>([]);
  const [regionEnv, setRegionEnv] = useState<RegionMonthEnv[]>([]);
  const [envGrid, setEnvGrid] = useState<EnvGridCell[]>([]);
  const [alpha, setAlpha] = useState<number | null>(null);
  const [loadingCal, setLoadingCal] = useState(true);
  const [loadingHs, setLoadingHs] = useState(true);
  const [live, setLive] = useState<LiveReadingsResult | null>(null);
  const [liveFires, setLiveFires] = useState<LiveFiresResult | null>(null);
  const [methodologyOpen, setMethodologyOpen] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  // ---------------------------------------------------------------- inicio: catálogo + URL
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [{ regions: list }, url] = [await getRegions(), readUrlState()];
      if (cancelled) return;
      setRegions(list);
      if (url.bbox) {
        setRegionKey(CUSTOM_REGION);
        setBbox(url.bbox);
        setCustomLabel(url.place ?? null);
      } else {
        const r = list.find((x) => x.key === url.region) ?? list.find((x) => x.key === DEFAULT_REGION) ?? list[0];
        setRegionKey(r.key);
        setBbox(r.bbox);
        if (!url.year && r.defaultYear) setSelectedYear(r.defaultYear);
      }
      if (url.year) setSelectedYear(url.year);
      if (url.month) setSelectedMonth(url.month);
      if (url.section) setSection(url.section);
      if (url.mode) setMode(url.mode);
      setReady(true);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!ready) return;
    writeUrlState({
      region: regionKey,
      bbox: regionKey === CUSTOM_REGION ? bbox : undefined,
      place: customLabel ?? undefined,
      year: selectedYear,
      month: selectedMonth ?? undefined,
      section,
      mode,
    });
  }, [ready, regionKey, bbox, customLabel, selectedYear, selectedMonth, section, mode]);

  // ---------------------------------------------------------------- datos
  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    (async () => {
      setLoadingCal(true);
      const [cal, rec, a, renv] = await Promise.all([
        getBurningCalendar(bbox, excludeNonFire),
        getRecurrence(bbox, excludeNonFire),
        getCalibrationAlpha(),
        getRegionMonthEnv(bbox),
      ]);
      if (cancelled) return;
      setCalendar(cal);
      setRecurrence(rec.cells);
      setAlpha(a.alpha);
      setRegionEnv(renv);
      setLoadingCal(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [ready, bbox, excludeNonFire]);

  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    (async () => {
      setLoadingHs(true);
      const res = await getHotspots(bbox, `${selectedYear}-01-01`, `${selectedYear}-12-31`, excludeNonFire);
      if (cancelled) return;
      setHotspots(res);
      setLoadingHs(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [ready, bbox, selectedYear, excludeNonFire]);

  useEffect(() => {
    let cancelled = false;
    const load = async () => {
      const res = await fetchLiveReadings(IOT_STATIONS);
      if (!cancelled) setLive(res);
    };
    void load();
    const id = setInterval(load, 10 * 60_000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, []);

  // Focos en tiempo casi real del área visible (FIRMS NRT, caché de 15 min en el servidor)
  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    const load = async () => {
      const res = await fetchLiveFires(bbox);
      if (!cancelled) setLiveFires(res);
    };
    const t = setTimeout(() => {
      setLiveFires(null);
      void load();
    }, 0);
    const id = setInterval(load, 15 * 60_000);
    return () => {
      cancelled = true;
      clearTimeout(t);
      clearInterval(id);
    };
  }, [ready, bbox]);

  // ---------------------------------------------------------------- derivados
  const region = regions.find((r) => r.key === regionKey) ?? null;
  const regionLabel = region ? region.name : (customLabel ?? "Área personalizada");
  const cells = useMemo(() => calendar?.cells ?? [], [calendar]);
  const baseline = useMemo(() => monthlyBaseline(cells, mode), [cells, mode]);
  const baselineH = useMemo(() => monthlyBaseline(cells, "harmonized"), [cells]);
  const yearCells = useMemo(() => cells.filter((c) => c.year === selectedYear), [cells, selectedYear]);
  const hasAnyData = cells.some((c) => c.active_cells > 0);

  const scenarioMonth = useMemo(() => {
    if (selectedMonth) return selectedMonth;
    let best = 0;
    let month = 0;
    for (const c of yearCells) {
      if (c.has_coverage && c.harmonized_events > best) {
        best = c.harmonized_events;
        month = c.month;
      }
    }
    if (month) return month;
    const peak = baselineH.reduce((a, b) => (b.p50 > a.p50 ? b : a), baselineH[0]);
    return peak?.p50 > 0 ? peak.month : 1;
  }, [yearCells, baselineH, selectedMonth]);
  const scenarioLabel = `${MONTHS_LONG[scenarioMonth - 1]} ${selectedYear}`;

  useEffect(() => {
    if (!ready) return;
    let cancelled = false;
    getEnvGrid(bbox, scenarioMonth).then((g) => {
      if (!cancelled) setEnvGrid(g);
    });
    return () => {
      cancelled = true;
    };
  }, [ready, bbox, scenarioMonth]);

  const rows = useMemo(() => hotspots?.rows ?? [], [hotspots]);
  const vegRows = useMemo(() => rows.filter((r) => r.thermal_type === "VEGETATION"), [rows]);
  /** Lo que se dibuja en el mapa: todo el año o solo el mes filtrado */
  const mapRows = useMemo(
    () => (selectedMonth ? rows.filter((r) => Number(r.acq_date.slice(5, 7)) === selectedMonth) : rows),
    [rows, selectedMonth],
  );
  const spread = useMemo(() => computeSpreadVectors(mapRows), [mapRows]);
  const susceptibility = useMemo(
    () => buildSusceptibilityFromGrid(envGrid, recurrence, RECURRENCE_CELL_DEG),
    [envGrid, recurrence],
  );
  const isfLabel = susceptibility.length
    ? `Climatología real de ${MONTHS_LONG[scenarioMonth - 1].toLowerCase()} · celdas de 0,05°`
    : "Sin climatología para esta área";

  const iot = useMemo(() => {
    if (!live) return [];
    const byId = new Map(live.readings.map((r) => [r.stationId, r]));
    return IOT_STATIONS.flatMap((station) => {
      const reading = byId.get(station.id);
      return reading && inBBox(station.lat, station.lon, bbox) ? [{ station, reading }] : [];
    });
  }, [live, bbox]);

  /**
   * Condiciones del escenario (todas reales). Prioridad: celdas con focos del mes pico →
   * promedio regional del año-mes + pendiente de la grilla → focos de otros meses del año.
   * Sin ninguno de esos datos no se evalúa (null).
   */
  const conditions: AreaConditions | null = useMemo(() => {
    if (!calendar) return null;
    type S = { slope: number; ndvi: number; soil: number; wind: number; wdir: number };
    const monthRows = vegRows.filter((r) => Number(r.acq_date.slice(5, 7)) === scenarioMonth);
    const regionRows = regionEnv.filter((r) => r.year === selectedYear && r.month === scenarioMonth);
    const fromRows = (rs: typeof vegRows): S[] =>
      rs.map((r) => ({
        slope: r.slope_deg ?? 0,
        ndvi: r.ndvi_pre_fire ?? 0,
        soil: r.soil_moisture_pct ?? 0,
        wind: r.wind_speed_kmh ?? 0,
        wdir: r.wind_direction_deg ?? 0,
      }));
    let sample: S[] = [];
    let basis: AreaConditions["basis"];
    if (monthRows.length) {
      sample = fromRows(monthRows);
      basis = "fire-cells";
    } else if (regionRows.length && envGrid.length) {
      const avg = (k: keyof RegionMonthEnv) => {
        const v = regionRows.map((r) => r[k]).filter((x): x is number => typeof x === "number");
        return v.length ? v.reduce((a, b) => a + b, 0) / v.length : 0;
      };
      sample = envGrid.map((g) => ({
        slope: g.slope_deg ?? 0,
        ndvi: avg("ndvi"),
        soil: avg("soil_moisture_pct"),
        wind: avg("wind_speed_kmh"),
        wdir: avg("wind_direction_deg"),
      }));
      basis = "region";
    } else if (vegRows.length) {
      sample = fromRows(vegRows);
      basis = "fire-cells-year";
    } else {
      return null;
    }
    const mean = (k: keyof S) => sample.reduce((acc, x) => acc + x[k], 0) / sample.length;
    const sin = sample.reduce((acc, x) => acc + Math.sin((x.wdir * Math.PI) / 180), 0);
    const cos = sample.reduce((acc, x) => acc + Math.cos((x.wdir * Math.PI) / 180), 0);
    const cell = yearCells.find((c) => c.month === scenarioMonth);
    const b = baselineH[scenarioMonth - 1];
    const events = cell?.harmonized_events ?? 0;
    const wind = mean("wind");
    const maxes = monthRows.map((r) => r.wind_max_kmh).filter((x): x is number => typeof x === "number");
    const regionMax = regionRows.map((r) => r.wind_max_kmh).filter((x): x is number => typeof x === "number");
    let gustKmh = wind * 1.45;
    let gustSource = "estimada (viento medio × 1,45)";
    if (maxes.length) {
      gustKmh = quantile(maxes, 0.9);
      gustSource = `POWER viento máx. diario, P90 de ${maxes.length} celdas-día`;
    } else if (regionMax.length) {
      gustKmh = regionMax.reduce((x, y) => x + y, 0) / regionMax.length;
      gustSource = "POWER viento máx. del mes (región)";
    }
    return {
      regionLabel,
      year: selectedYear,
      month: scenarioMonth,
      monthEvents: events,
      p75: b?.p75 ?? 0,
      p90: b?.p90 ?? 0,
      anomalyPct: anomalyPct(events, b?.p50 ?? 0),
      meanSlope: mean("slope"),
      steepShare: sample.filter((x) => x.slope > THRESHOLDS.steepSlopeDeg).length / sample.length,
      meanNdvi: mean("ndvi"),
      soilMoisture: mean("soil"),
      soilSource: "GLDAS/SMAP",
      gustKmh,
      gustSource,
      cloudCover: cell?.avg_cloud_cover ?? 0,
      windDirDeg: ((Math.atan2(sin, cos) * 180) / Math.PI + 360) % 360,
      windKmh: wind,
      basis,
    };
  }, [calendar, vegRows, regionEnv, envGrid, scenarioMonth, yearCells, baselineH, selectedYear, regionLabel]);

  const windOverlay: WindOverlay | null = useMemo(() => {
    if (!conditions) return null;
    const monthRows = vegRows.filter((r) => Number(r.acq_date.slice(5, 7)) === scenarioMonth);
    const top = monthRows.reduce<(typeof monthRows)[number] | null>(
      (best, r) => ((r.max_frp ?? 0) > (best?.max_frp ?? -1) ? r : best),
      null,
    );
    return {
      origin: top ? [top.lat, top.lon] : bboxCenter(bbox),
      fromDeg: conditions.windDirDeg,
      speedKmh: conditions.windKmh,
      source: `NASA POWER · ${scenarioLabel}`,
      coneKm: conditions.windKmh * CONE_ROS_FRACTION * CONE_HOURS,
    };
  }, [conditions, vegRows, scenarioMonth, bbox, scenarioLabel]);

  const kpi = useMemo(() => {
    if (selectedMonth) {
      const cell = yearCells.find((c) => c.month === selectedMonth);
      const byDay = new Map<string, number>();
      for (const r of mapRows) if (r.thermal_type === "VEGETATION") byDay.set(r.acq_date, (byDay.get(r.acq_date) ?? 0) + r.harmonized_weight);
      let peakDay = "—";
      let peakValue = 0;
      byDay.forEach((v, d) => {
        if (v > peakValue) {
          peakValue = v;
          peakDay = `${Number(d.slice(8, 10))} ${MONTHS_LONG[selectedMonth - 1].slice(0, 3).toLowerCase()}`;
        }
      });
      const total = cell?.harmonized_events ?? 0;
      return {
        total,
        rawTotal: cell?.raw_events ?? 0,
        peakMonthLabel: peakDay,
        peakValue,
        anomaly: anomalyPct(total, baselineH[selectedMonth - 1]?.p50 ?? 0),
      };
    }
    const total = yearCells.reduce((s, c) => s + c.harmonized_events, 0);
    const rawTotal = yearCells.reduce((s, c) => s + c.raw_events, 0);
    const peak = yearCells.reduce((a, c) => (c.harmonized_events > (a?.harmonized_events ?? -1) ? c : a), yearCells[0]);
    const p50Total = baselineH.reduce((s, b) => s + b.p50, 0);
    return {
      total,
      rawTotal,
      peakMonthLabel: peak && peak.harmonized_events > 0 ? MONTHS_LONG[peak.month - 1] : "—",
      peakValue: peak?.harmonized_events ?? 0,
      anomaly: anomalyPct(total, p50Total),
    };
  }, [yearCells, baselineH, selectedMonth, mapRows]);

  const bearing = dominantBearing(spread);
  /** Día con más actividad del mes filtrado: la imagen GOES arranca ahí */
  const peakDay = useMemo(() => {
    if (!selectedMonth) return undefined;
    const byDay = new Map<string, number>();
    for (const r of mapRows) byDay.set(r.acq_date, (byDay.get(r.acq_date) ?? 0) + r.harmonized_weight);
    let best: string | undefined;
    let v = 0;
    byDay.forEach((w, d) => {
      if (w > v) {
        v = w;
        best = d;
      }
    });
    return best;
  }, [selectedMonth, mapRows]);
  const goesCenter = useMemo(() => bboxCenter(bbox), [bbox]);
  const liveSummaryText = useMemo(() => {
    if (!liveFires?.ok) return undefined;
    const s = summarizeLive(liveFires.fires);
    return s.total
      ? `Tiempo casi real: ${s.last24} focos en 24 h · ${s.total} en ${liveFires.days * 24} h`
      : `Tiempo casi real: sin focos en ${liveFires.days * 24} h`;
  }, [liveFires]);
  const regionNames = regions.map((r) => r.name).join(", ");
  const emptyMessage =
    !loadingCal && calendar && !hasAnyData
      ? `No hay focos procesados en esta área. Por ahora los datos cubren: ${regionNames}.`
      : !loadingCal && calendar && !conditions
        ? `Sin focos ni datos ambientales para ${selectedYear} en esta área.`
        : null;

  // ---------------------------------------------------------------- acciones
  const selectRegion = useCallback(
    (key: string) => {
      const r = regions.find((x) => x.key === key);
      if (!r) return;
      setRegionKey(key);
      setBbox(r.bbox);
      setCustomLabel(null);
    },
    [regions],
  );

  const customArea = useCallback((b: BBox, label?: string) => {
    setRegionKey(CUSTOM_REGION);
    setBbox(b);
    setCustomLabel(label ?? null);
  }, []);

  const exportCsv = useCallback(
    async (startYear: number, endYear: number) => {
      setExporting(true);
      try {
        const res = await getHotspots(bbox, `${startYear}-01-01`, `${endYear}-12-31`, excludeNonFire);
        const name = (region?.key ?? "area").toLowerCase();
        downloadText(`pyrosync_${name}_${startYear}-${endYear}.csv`, hotspotsToCsv(res.rows));
        setNotice(
          `${res.rows.length.toLocaleString("es-AR")} celdas-día exportadas` +
            (res.truncated ? " (límite de 10.000 filas; acotá el rango de años)." : "."),
        );
      } finally {
        setExporting(false);
      }
    },
    [bbox, excludeNonFire, region],
  );

  const warning = calendar?.warning ?? hotspots?.warning;

  return (
    <div className="flex h-dvh flex-col overflow-hidden bg-slate-950">
      <TopBar
        regions={regions}
        regionKey={regionKey}
        regionLabel={regionLabel}
        bbox={bbox}
        year={selectedYear}
        dataSource={calendar?.source ?? null}
        onSelectRegion={selectRegion}
        onCustomArea={customArea}
        onYear={setSelectedYear}
        month={selectedMonth}
        onMonth={setSelectedMonth}
        onOpenMethodology={() => setMethodologyOpen(true)}
      />

      {(warning || notice) && (
        <div className="z-[1080] border-b border-slate-800 bg-slate-900 px-3 py-1.5">
          {warning && (
            <p className="flex items-center gap-2 text-xs text-sky-200">
              <AlertCircle className="h-4 w-4 shrink-0" aria-hidden /> {warning}
            </p>
          )}
          {notice && (
            <p className="flex items-center justify-between gap-2 text-xs text-emerald-200">
              <span>{notice}</span>
              <button type="button" onClick={() => setNotice(null)} aria-label="Cerrar aviso" className="text-emerald-300 hover:text-white">
                <X className="h-4 w-4" />
              </button>
            </p>
          )}
        </div>
      )}

      <div className="relative flex min-h-0 flex-1">
        <Sidebar section={section} onSection={setSection} mobileOpen={mobileOpen} onMobileOpen={setMobileOpen}>
          {section === "resumen" && (
            <SummaryPanel
              regionLabel={regionLabel}
              scenarioLabel={scenarioLabel}
              conditions={conditions}
              kpi={kpi}
              selectedYear={selectedYear}
              month={selectedMonth}
              alpha={alpha}
              calibrationNote="Calibrado en Córdoba nov-2012 a 2024"
              iot={iot}
              liveSource={live?.source ?? null}
              liveNote={live?.note}
              emptyMessage={emptyMessage}
              liveFires={liveFires}
              onShowLive={() => setLayers((l) => ({ ...l, live: true }))}
              onGo={setSection}
            />
          )}
          {section === "riesgo" && (
            <RiskPanel
              susceptibility={susceptibility}
              isfLabel={isfLabel}
              showOnMap={layers.susceptibility}
              onToggleMap={() => setLayers((l) => ({ ...l, susceptibility: !l.susceptibility }))}
              conditions={conditions}
              iot={iot}
              liveSource={live?.source ?? null}
              liveNote={live?.note}
            />
          )}
          {section === "calendario" && (
            <div className="space-y-4">
              <BurnCalendar
                cells={cells}
                mode={mode}
                onModeChange={setMode}
                palette={palette}
                onPaletteChange={setPalette}
                excludeNonFire={excludeNonFire}
                onExcludeNonFireChange={setExcludeNonFire}
                selectedYear={selectedYear}
                onSelectYear={setSelectedYear}
                selectedMonth={selectedMonth}
                onSelectMonth={(y, m) => {
                  setSelectedYear(y);
                  setSelectedMonth(m);
                }}
                alpha={alpha}
                loading={loadingCal}
              />
              <details className="group space-y-2">
                <summary className="cursor-pointer list-none rounded-xl border border-slate-800 bg-slate-900 px-4 py-2.5 text-sm text-slate-200 hover:bg-slate-800/60 [&::-webkit-details-marker]:hidden">
                  <span className="mr-1 inline-block transition group-open:rotate-90">▸</span> Anomalía mensual {selectedYear} vs. 2001–2020
                </summary>
                <div className="mt-2">
                  <AnomalyChart yearCells={yearCells} baseline={baseline} mode={mode} selectedYear={selectedYear} regionLabel={regionLabel} />
                </div>
              </details>
            </div>
          )}
          {section === "charter" && <CharterPanel conditions={conditions} scenarioLabel={scenarioLabel} emptyMessage={emptyMessage} />}
          {section === "datos" && (
            <DataPanel
              bbox={bbox}
              year={selectedYear}
              exporting={exporting}
              onExport={exportCsv}
              alpha={alpha}
              dataSource={calendar?.source ?? null}
              liveSource={live?.source ?? null}
              liveFiresOk={liveFires?.ok ?? false}
              hasGrid={susceptibility.length > 0}
              onOpenMethodology={() => setMethodologyOpen(true)}
            />
          )}
        </Sidebar>

        <main className="relative min-w-0 flex-1 pb-[7.5rem] lg:pb-0">
          <MapSelector
            headline={region?.subtitle ? `${regionLabel} — ${region.subtitle}` : regionLabel}
            scenarioLabel={`Escenario: ${scenarioLabel}`}
            spreadSummary={
              bearing != null ? `Avance dominante hacia ${compassLabel(bearing)} (${bearing.toFixed(0)}°) en ${spread.length} eventos` : undefined
            }
            bbox={bbox}
            hotspots={mapRows}
            spread={spread}
            susceptibility={susceptibility}
            iot={iot}
            wind={windOverlay}
            layers={layers}
            onToggleLayer={(k) => setLayers((l) => ({ ...l, [k]: !l[k] }))}
            hotspotCount={mapRows.length}
            truncated={hotspots?.truncated ?? false}
            loading={loadingHs}
            isfLabel={isfLabel}
            emptyMessage={emptyMessage}
            liveFires={liveFires?.fires ?? []}
            liveSummary={liveSummaryText}
            goesDate={{ year: selectedYear, month: selectedMonth, preferredDay: peakDay, center: goesCenter }}
            onGoToDate={(y, m) => {
              setSelectedYear(y);
              setSelectedMonth(m);
            }}
          />
        </main>
      </div>

      <MethodologyModal
        open={methodologyOpen}
        onClose={() => setMethodologyOpen(false)}
        alpha={alpha}
        dataSource={calendar?.source ?? null}
        liveSource={live?.source ?? null}
        liveFiresOk={liveFires?.ok ?? false}
      />
    </div>
  );
}
