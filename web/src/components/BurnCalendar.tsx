"use client";

import { useMemo } from "react";
import { CalendarDays, Cloud, Mountain } from "lucide-react";
import type { CalendarCell, Palette, SeriesMode } from "@/types/fire";
import { gradientCss, paletteColor, textOn } from "@/lib/colors";
import { MONTHS_LONG, MONTHS_SHORT, YEARS } from "@/lib/regions";
import { cellValue, formatNumber, hasSensorSeries, hasViirs, needsViirs, SERIES_INFO } from "@/lib/stats";
import SeriesToggle from "./SeriesToggle";

export const CLOUD_FLAG_PCT = 60;

interface Props {
  cells: CalendarCell[];
  mode: SeriesMode;
  onModeChange: (m: SeriesMode) => void;
  palette: Palette;
  onPaletteChange: (p: Palette) => void;
  excludeNonFire: boolean;
  onExcludeNonFireChange: (v: boolean) => void;
  selectedYear: number;
  onSelectYear: (y: number) => void;
  selectedMonth: number | null;
  onSelectMonth: (y: number, m: number) => void;
  alpha: number | null;
  loading: boolean;
}

function compact(v: number): string {
  if (v >= 10_000) return `${Math.round(v / 1000)}k`;
  if (v >= 1000) return `${(v / 1000).toFixed(1)}k`;
  if (v >= 100) return String(Math.round(v));
  return v >= 10 ? v.toFixed(0) : v.toFixed(1).replace(/\.0$/, "");
}

export default function BurnCalendar(props: Props) {
  const { cells, mode, palette, selectedYear } = props;

  const { byYear, max, annual } = useMemo(() => {
    const byYear = new Map<number, CalendarCell[]>();
    let max = 0;
    const annual = new Map<number, number>();
    for (const c of cells) {
      if (!byYear.has(c.year)) byYear.set(c.year, []);
      byYear.get(c.year)!.push(c);
      const v = cellValue(c, mode);
      if (c.has_coverage) max = Math.max(max, v);
      annual.set(c.year, (annual.get(c.year) ?? 0) + v);
    }
    byYear.forEach((arr) => arr.sort((a, b) => a.month - b.month));
    return { byYear, max, annual, maxAnnual: Math.max(...annual.values(), 1) };
  }, [cells, mode]);

  // Escala raíz cuadrada: preserva contraste entre años normales y años extremos
  const scale = (v: number) => (max > 0 ? Math.sqrt(v / max) : 0);
  const sensorSeries = hasSensorSeries(props.cells);
  const seg = (active: boolean) =>
    `rounded px-2 py-0.5 text-[11px] transition ${active ? "bg-slate-700 text-slate-50" : "text-slate-400 hover:text-slate-200"}`;

  return (
    <section className="rounded-xl border border-slate-800 bg-slate-900">
      <div className="space-y-2 border-b border-slate-800 px-3 py-2.5">
        <div className="flex items-center justify-between gap-2">
          <h2 className="flex items-center gap-1.5 text-sm font-semibold text-slate-100">
            <CalendarDays className="h-4 w-4 text-orange-400" aria-hidden /> Calendario de focos
          </h2>
          <div className="flex rounded-md border border-slate-800 bg-slate-950 p-0.5" role="group" aria-label="Paleta">
            <button type="button" className={seg(palette === "viridis")} aria-pressed={palette === "viridis"} onClick={() => props.onPaletteChange("viridis")}>
              Viridis
            </button>
            <button type="button" className={seg(palette === "ylorrd")} aria-pressed={palette === "ylorrd"} onClick={() => props.onPaletteChange("ylorrd")}>
              YlOrRd
            </button>
          </div>
        </div>
        <SeriesToggle mode={mode} onChange={props.onModeChange} disabled={sensorSeries ? [] : ["modis", "viirs"]} />
        <label className="flex cursor-pointer items-center gap-2 text-[11px] text-slate-300">
          <input
            type="checkbox"
            checked={props.excludeNonFire}
            onChange={(e) => props.onExcludeNonFireChange(e.target.checked)}
            className="h-3.5 w-3.5 accent-orange-500"
          />
          <Mountain className="h-3.5 w-3.5 text-slate-400" aria-hidden />
          Ocultar fuentes fijas (volcanes / industria)
        </label>
        <p className="text-[10.5px] leading-snug text-slate-500">
          {SERIES_INFO[mode].desc}
          {mode === "combined" ? ` α = ${props.alpha?.toFixed(3) ?? "—"}.` : ""}{" "}
          Tocá una celda para ver ese mes en el mapa.
        </p>
      </div>

      <div className={`px-2 py-2 ${props.loading ? "opacity-50" : ""}`}>
        <table className="w-full table-fixed border-separate" style={{ borderSpacing: 1.5 }}>
          <thead>
            <tr>
              <th className="w-9" />
              {MONTHS_SHORT.map((m) => (
                <th key={m} className="text-center text-[9px] font-normal text-slate-500">
                  {m.charAt(0)}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {YEARS.map((year) => {
              const row = byYear.get(year) ?? [];
              const sel = year === selectedYear;
              const total = annual.get(year) ?? 0;
              return (
                <tr key={year} className={year === 2012 ? "[&>td]:border-t [&>td]:border-dashed [&>td]:border-sky-500/60" : ""}>
                  <td>
                    <button
                      type="button"
                      onClick={() => props.onSelectYear(year)}
                      title={`${year}: ${formatNumber(total, mode === "combined" ? 1 : 0)} en el año`}
                      className={`w-full rounded px-0.5 text-left font-mono text-[9.5px] leading-[13px] ${
                        sel ? "bg-orange-500/20 text-orange-300" : "text-slate-500 hover:text-slate-100"
                      }`}
                    >
                      {String(year).slice(2)}
                      {year === 2012 && <span className="text-sky-400">*</span>}
                    </button>
                  </td>
                  {row.map((c) => {
                    const v = cellValue(c, mode);
                    if (!c.has_coverage || (needsViirs(mode) && !hasViirs(year, c.month))) {
                      return (
                        <td key={c.month} className="h-[13px] rounded-[2px] bg-[repeating-linear-gradient(45deg,#0f172a,#0f172a_2px,#1e293b_2px,#1e293b_4px)]" title={c.has_coverage ? "Sin VIIRS (empieza en nov-2012)" : "Sin cobertura de datos"} />
                      );
                    }
                    const bg = paletteColor(palette, scale(v));
                    const cloudy = (c.avg_cloud_cover ?? 0) >= CLOUD_FLAG_PCT;
                    const isSel = sel && props.selectedMonth === c.month;
                    return (
                      <td key={c.month} className="p-0">
                        <button
                          type="button"
                          onClick={() => props.onSelectMonth(year, c.month)}
                          className={`relative block h-[13px] w-full rounded-[2px] ${
                            isSel ? "outline outline-2 outline-white" : sel ? "outline outline-1 outline-orange-400/80" : ""
                          }`}
                          style={{ background: bg }}
                          title={`${MONTHS_LONG[c.month - 1]} ${year}: ${formatNumber(v, mode === "combined" ? 1 : 0)} ${
                            SERIES_INFO[mode].unit
                          }${c.modis_cells != null ? ` (MODIS ${c.modis_cells} · VIIRS ${c.viirs_cells} · ambos ${c.both_cells} celdas-día)` : ""} · ${c.active_cells} celdas-día · nubosidad ${c.avg_cloud_cover?.toFixed(0) ?? "—"} %${
                            c.cloud_origin === "region" ? " (promedio regional MODIS)" : ""
                          }${cloudy ? " — baja visibilidad óptica: posible subdetección de focos" : ""}`}
                          aria-label={`${MONTHS_LONG[c.month - 1]} ${year}: ${compact(v)}`}
                        >
                          {cloudy && (
                            <span className="absolute right-[1px] top-[1px] h-[3px] w-[3px] rounded-full" style={{ background: textOn(bg) }} />
                          )}
                        </button>
                      </td>
                    );
                  })}
                </tr>
              );
            })}
          </tbody>
        </table>

        <div className="mt-2 space-y-1 px-1 text-[10px] text-slate-400">
          <span className="flex items-center gap-2">
            0
            <span className="inline-block h-2 w-28 rounded-sm" style={{ background: gradientCss(palette) }} />
            {compact(max)} <span className="text-slate-500">(escala √)</span>
          </span>
          <span className="flex flex-wrap items-center gap-x-3 gap-y-1">
            <span className="flex items-center gap-1">
              <Cloud className="h-3 w-3" aria-hidden /> punto = nubosidad ≥ {CLOUD_FLAG_PCT} %
            </span>
            <span className="flex items-center gap-1">
              <span className="inline-block h-2 w-3 bg-[repeating-linear-gradient(45deg,#0f172a,#0f172a_2px,#1e293b_2px,#1e293b_4px)]" /> sin cobertura
            </span>
            <span className="text-sky-400">12* inicio VIIRS (nov-2012)</span>
          </span>
        </div>
      </div>
    </section>
  );
}
