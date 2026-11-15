"use client";

import { useMemo } from "react";
import { BarChart3 } from "lucide-react";
import {
  Area,
  Bar,
  CartesianGrid,
  Cell,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { CalendarCell, MonthlyBaseline, SeriesMode } from "@/types/fire";
import { MONTHS_SHORT } from "@/lib/regions";
import { anomalyPct, baselineYears, cellValue, formatNumber, formatSigned, SERIES_INFO } from "@/lib/stats";

interface Props {
  yearCells: CalendarCell[];
  baseline: MonthlyBaseline[];
  mode: SeriesMode;
  selectedYear: number;
  regionLabel: string;
}

export default function AnomalyChart({ yearCells, baseline, mode, selectedYear, regionLabel }: Props) {
  const data = useMemo(
    () =>
      baseline.map((b) => {
        const c = yearCells.find((x) => x.month === b.month);
        const value = c && c.has_coverage ? cellValue(c, mode) : null;
        return {
          month: MONTHS_SHORT[b.month - 1],
          value,
          p50: b.p50,
          p75: b.p75,
          p90: b.p90,
          band: [b.p25, b.p75] as [number, number],
          anomaly: value == null ? null : anomalyPct(value, b.p50),
          critical: value != null && value > b.p75,
        };
      }),
    [baseline, yearCells, mode],
  );

  const total = data.reduce((s, d) => s + (d.value ?? 0), 0);
  const totalP50 = baseline.reduce((s, b) => s + b.p50, 0);
  const critical = data.filter((d) => d.critical).length;

  return (
    <section className="flex flex-col rounded-xl border border-slate-800 bg-slate-900">
      <div className="border-b border-slate-800 px-4 py-3">
        <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-100">
          <BarChart3 className="h-4 w-4 text-orange-400" aria-hidden /> {selectedYear} vs. Mediana Histórica — {regionLabel}
        </h2>
        <p className="mt-0.5 text-[11px] text-slate-400">
          Línea base {baselineYears(mode)[0]}–{baselineYears(mode)[1]} · barras rojas: mes &gt; P75 (Período Crítico de Alerta) · serie{" "}
          {SERIES_INFO[mode].label.toLowerCase()} ({SERIES_INFO[mode].unit})
        </p>
        <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 font-mono text-[11px] text-slate-300">
          <span>
            Total {selectedYear}: <b>{formatNumber(total, 1)}</b>
          </span>
          <span>
            Σ P50: <b>{formatNumber(totalP50, 1)}</b>
          </span>
          <span className={total > totalP50 ? "text-rose-300" : "text-emerald-300"}>
            Anomalía anual: {formatSigned(anomalyPct(total, totalP50))} %
          </span>
          <span className={critical ? "text-rose-300" : "text-slate-400"}>Meses críticos: {critical}</span>
        </div>
      </div>
      <div className="h-[320px] px-2 py-3">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} margin={{ top: 8, right: 16, bottom: 0, left: 0 }}>
            <CartesianGrid stroke="#1e293b" vertical={false} />
            <XAxis dataKey="month" tick={{ fill: "#94a3b8", fontSize: 11 }} axisLine={{ stroke: "#334155" }} tickLine={false} />
            <YAxis tick={{ fill: "#94a3b8", fontSize: 11 }} axisLine={false} tickLine={false} width={44} />
            <Tooltip
              contentStyle={{ background: "#0f172a", border: "1px solid #1e293b", borderRadius: 8, fontSize: 12 }}
              labelStyle={{ color: "#e2e8f0" }}
              formatter={(value, name) => {
                if (Array.isArray(value)) return [`${formatNumber(Number(value[0]), 1)} – ${formatNumber(Number(value[1]), 1)}`, name];
                return [value == null ? "—" : formatNumber(Number(value), 1), name];
              }}
            />
            <Legend wrapperStyle={{ fontSize: 11, color: "#cbd5e1" }} />
            <Area dataKey="band" name="Banda P25–P75" stroke="none" fill="#64748b" fillOpacity={0.25} isAnimationActive={false} />
            <Bar dataKey="value" name={`${selectedYear}`} fill="#35b779" radius={[3, 3, 0, 0]} maxBarSize={34} isAnimationActive={false}>
              {data.map((d, i) => (
                <Cell key={i} fill={d.critical ? "#f43f5e" : "#35b779"} />
              ))}
            </Bar>
            <Line dataKey="p50" name="Mediana P50" stroke="#fde725" strokeWidth={2} dot={false} isAnimationActive={false} />
            <Line dataKey="p75" name="Umbral crítico P75" stroke="#fb923c" strokeDasharray="6 4" strokeWidth={1.5} dot={false} isAnimationActive={false} />
            <Line dataKey="p90" name="P90 (criterio Charter)" stroke="#f43f5e" strokeDasharray="2 4" strokeWidth={1.5} dot={false} isAnimationActive={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </section>
  );
}
