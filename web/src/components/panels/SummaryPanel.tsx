"use client";

import { ArrowRight, Info } from "lucide-react";
import type { AreaConditions } from "@/lib/prevention";
import { evaluateCharter } from "@/lib/prevention";
import type { IotReading, IotSource } from "@/lib/iot";
import type { IotStation } from "@/lib/regions";
import type { Section } from "@/lib/urlState";
import KpiCards from "../KpiCards";
import LiveFiresCard from "../LiveFiresCard";
import type { LiveFiresResult } from "@/lib/firmsLive";
import { LIGHT, PreventionList, StationsCard, TrafficLight } from "../PreventionCharterPanel";

interface Props {
  regionLabel: string;
  scenarioLabel: string;
  conditions: AreaConditions | null;
  kpi: {
    total: number;
    rawTotal: number;
    modis: number | null;
    viirs: number | null;
    peakMonthLabel: string;
    peakValue: number;
    anomaly: number;
  };
  selectedYear: number;
  month: number | null;
  alpha: number | null;
  calibrationNote: string;
  iot: { station: IotStation; reading: IotReading }[];
  liveSource: IotSource | null;
  liveNote?: string;
  emptyMessage: string | null;
  liveFires: LiveFiresResult | null;
  onShowLive: () => void;
  onGo: (s: Section) => void;
}

export default function SummaryPanel(p: Props) {
  const charter = p.conditions ? evaluateCharter(p.conditions) : null;
  return (
    <div className="space-y-4">
      <LiveFiresCard live={p.liveFires} onShowMap={p.onShowLive} />

      {/* Estado del área */}
      <div className="rounded-xl border border-slate-800 bg-slate-900 p-4">
        <p className="text-[11px] uppercase tracking-wide text-slate-500">Estado del área · {p.scenarioLabel}</p>
        {charter && p.conditions ? (
          <div className="mt-1.5 flex items-start justify-between gap-3">
            <div>
              <p className={`text-lg font-semibold ${LIGHT[charter.status].text}`}>{LIGHT[charter.status].short}</p>
              <p className="mt-0.5 text-[12.5px] leading-snug text-slate-300">
                {charter.status === "red"
                  ? "Anomalía extrema en terreno crítico y con baja visibilidad satelital: corresponde pedir imágenes de emergencia."
                  : charter.status === "yellow"
                    ? "Actividad muy por encima de lo normal: preparar el pedido de imágenes y reforzar la vigilancia."
                    : "Actividad dentro de lo esperable para la época."}
              </p>
              <button
                type="button"
                onClick={() => p.onGo("charter")}
                className="mt-2 flex items-center gap-1 text-[12px] text-orange-300 hover:text-orange-200"
              >
                Ver criterios del Charter <ArrowRight className="h-3.5 w-3.5" aria-hidden />
              </button>
            </div>
            <TrafficLight status={charter.status} />
          </div>
        ) : (
          <p className="mt-2 flex items-start gap-2 text-[12.5px] text-slate-400">
            <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
            {p.emptyMessage ?? "Cargando condiciones del área…"}
          </p>
        )}
      </div>

      <KpiCards
        selectedYear={p.selectedYear}
        month={p.month}
        total={p.kpi.total}
        rawTotal={p.kpi.rawTotal}
        modis={p.kpi.modis}
        viirs={p.kpi.viirs}
        peakMonthLabel={p.kpi.peakMonthLabel}
        peakValue={p.kpi.peakValue}
        anomaly={p.kpi.anomaly}
        alpha={p.alpha}
        calibrationNote={p.calibrationNote}
      />

      {/* Qué hacer */}
      {p.conditions && (
        <div>
          <div className="mb-2 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-slate-100">Qué hacer</h3>
            <button type="button" onClick={() => p.onGo("riesgo")} className="flex items-center gap-1 text-[12px] text-orange-300 hover:text-orange-200">
              Todas las acciones <ArrowRight className="h-3.5 w-3.5" aria-hidden />
            </button>
          </div>
          <PreventionList conditions={p.conditions} onlyTriggered limit={3} />
        </div>
      )}

      <StationsCard iot={p.iot} liveSource={p.liveSource} liveNote={p.liveNote} compact />
    </div>
  );
}
