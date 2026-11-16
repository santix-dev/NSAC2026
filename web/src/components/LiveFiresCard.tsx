"use client";

import { Satellite, WifiOff } from "lucide-react";
import { ageHours, ageLabel, localTime, summarizeLive, type LiveFiresResult } from "@/lib/firmsLive";
import { uiLocale } from "@/lib/i18n/translator";

/** Resumen de focos en tiempo casi real (FIRMS NRT) dentro del área visible. */
export default function LiveFiresCard({ live, onShowMap }: { live: LiveFiresResult | null; onShowMap?: () => void }) {
  const head = (
    <p className="flex items-center gap-2 text-sm font-semibold text-slate-100">
      <Satellite className="h-4 w-4 text-rose-300" aria-hidden /> Focos activos · últimas {(live?.days ?? 3) * 24} h
      {live?.ok && (
        <span className="rounded border border-emerald-700/60 bg-emerald-500/10 px-1.5 py-0.5 text-[9.5px] font-normal text-emerald-300">
          EN VIVO · FIRMS
        </span>
      )}
    </p>
  );
  if (!live) {
    return (
      <div className="rounded-xl border border-slate-800 bg-slate-900 p-3">
        {head}
        <p className="mt-2 text-[11.5px] text-slate-400">Consultando NASA FIRMS…</p>
      </div>
    );
  }
  if (!live.ok) {
    return (
      <div className="rounded-xl border border-slate-800 bg-slate-900 p-3">
        {head}
        <p className="mt-2 flex items-start gap-2 text-[11.5px] text-slate-400">
          <WifiOff className="mt-0.5 h-4 w-4 shrink-0 text-slate-500" aria-hidden />
          Sin datos en vivo{live.note ? `: ${live.note}` : ""}. No se muestran focos recientes hasta que FIRMS responda.
        </p>
      </div>
    );
  }
  const s = summarizeLive(live.fires);
  const failed = Object.entries(live.sources).filter(([, v]) => !v.ok);
  return (
    <div className="rounded-xl border border-slate-800 bg-slate-900 p-3">
      {head}
      {s.total === 0 ? (
        <p className="mt-2 text-[12px] text-emerald-300">Sin focos detectados en el área en las últimas {live.days * 24} h.</p>
      ) : (
        <>
          <div className="mt-2 grid grid-cols-3 gap-2 text-center">
            <div className="rounded-lg bg-slate-950 p-2">
              <p className="font-mono text-lg text-rose-300">{s.last24.toLocaleString(uiLocale())}</p>
              <p className="text-[10px] text-slate-500">últimas 24 h</p>
            </div>
            <div className="rounded-lg bg-slate-950 p-2">
              <p className="font-mono text-lg text-slate-100">{s.total.toLocaleString(uiLocale())}</p>
              <p className="text-[10px] text-slate-500">en {live.days * 24} h</p>
            </div>
            <div className="rounded-lg bg-slate-950 p-2">
              <p className="font-mono text-lg text-slate-100">{s.maxFrp.toFixed(0)}</p>
              <p className="text-[10px] text-slate-500">FRP máx (MW)</p>
            </div>
          </div>
          {s.latest && (
            <p className="mt-2 text-[11.5px] text-slate-300">
              Último: {localTime(s.latest.acq_datetime)} ({ageLabel(ageHours(s.latest))}) · {s.latest.instrument} {s.latest.satellite}
            </p>
          )}
          <p className="mt-1 text-[10.5px] text-slate-500">
            {Object.entries(s.bySat)
              .map(([k, v]) => `${k}: ${v}`)
              .join(" · ")}
          </p>
          {onShowMap && (
            <button type="button" onClick={onShowMap} className="mt-1 text-[12px] text-orange-300 hover:text-orange-200">
              Ver en el mapa →
            </button>
          )}
        </>
      )}
      {failed.length > 0 && (
        <p className="mt-1 text-[10.5px] text-amber-300">
          Sin respuesta de {failed.map(([k]) => k.replace("_NRT", "").replace("VIIRS_", "")).join(", ")}.
        </p>
      )}
      <p className="mt-1 text-[10px] text-slate-500">
        NASA FIRMS NRT, sin armonizar (detección, no conteo). Actualiza cada 15 min · consultado {localTime(live.fetchedAt)}.
      </p>
    </div>
  );
}
