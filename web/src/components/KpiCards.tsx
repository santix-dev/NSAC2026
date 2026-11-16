"use client";

import { Activity, CalendarRange, Scale, TrendingUp } from "lucide-react";
import { formatNumber, formatSigned } from "@/lib/stats";
import { MONTHS_LONG } from "@/lib/regions";

interface Props {
  selectedYear: number;
  /** Mes filtrado (1–12) o null = todo el año */
  month?: number | null;
  total: number;
  /** Celdas-día vistas por ambos sensores (denominador de la concordancia) */
  both?: number | null;
  rawTotal: number;
  modis?: number | null;
  viirs?: number | null;
  peakMonthLabel: string;
  peakValue: number;
  anomaly: number;
  alpha: number | null;
  calibrationNote: string;
}

function Card(props: { icon: React.ReactNode; label: string; value: string; sub: string; tone?: string }) {
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900 p-3">
      <p className="flex items-center gap-1.5 text-[11px] text-slate-400">
        {props.icon}
        {props.label}
      </p>
      <p className={`mt-1 font-mono text-xl font-semibold ${props.tone ?? "text-slate-50"}`}>{props.value}</p>
      <p className="mt-0.5 text-[10.5px] leading-snug text-slate-500">{props.sub}</p>
    </div>
  );
}

export default function KpiCards(p: Props) {
  const period = p.month ? `${MONTHS_LONG[p.month - 1].toLowerCase()} ${p.selectedYear}` : String(p.selectedYear);
  return (
    <div className="grid grid-cols-2 gap-3">
      <Card
        icon={<Activity className="h-3.5 w-3.5" aria-hidden />}
        label={`Celdas armonizadas ${period}`}
        value={formatNumber(p.total)}
        sub={
          p.both != null && p.modis != null && p.viirs != null
            ? `concordantes de ${formatNumber(p.both)} vistas por ambos · MODIS ${formatNumber(p.modis)} · VIIRS ${formatNumber(p.viirs)} celdas-día`
            : `${formatNumber(p.rawTotal)} detecciones crudas`
        }
      />
      <Card
        icon={<CalendarRange className="h-3.5 w-3.5" aria-hidden />}
        label={p.month ? "Día pico del mes" : "Mes pico"}
        value={p.peakMonthLabel}
        sub={`${formatNumber(p.peakValue)} celdas concordantes ${p.month ? "ese día" : "en el mes"}`}
      />
      <Card
        icon={<TrendingUp className="h-3.5 w-3.5" aria-hidden />}
        label={p.month ? `Anomalía de ${MONTHS_LONG[p.month - 1].toLowerCase()} vs. mediana` : "Anomalía vs. mediana"}
        value={`${formatSigned(p.anomaly)} %`}
        sub="(E − P50) / (P50 + 1), serie Armonizada, base 2013–2024"
        tone={p.anomaly > 0 ? "text-rose-300" : "text-emerald-300"}
      />
      <Card
        icon={<Scale className="h-3.5 w-3.5" aria-hidden />}
        label="Factor α · serie Combinación"
        value={p.alpha != null ? p.alpha.toFixed(3) : "—"}
        sub={p.calibrationNote}
      />
    </div>
  );
}
