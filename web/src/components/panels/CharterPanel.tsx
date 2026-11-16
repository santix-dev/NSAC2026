"use client";

import { ExternalLink, Info } from "lucide-react";
import type { AreaConditions } from "@/lib/prevention";
import { CharterCard } from "../PreventionCharterPanel";

export default function CharterPanel({
  conditions,
  scenarioLabel,
  emptyMessage,
}: {
  conditions: AreaConditions | null;
  scenarioLabel: string;
  emptyMessage: string | null;
}) {
  return (
    <div className="space-y-4">
      {conditions ? (
        <CharterCard conditions={conditions} scenarioLabel={scenarioLabel} />
      ) : (
        <p className="flex items-start gap-2 rounded-xl border border-slate-800 bg-slate-900 p-4 text-[12.5px] text-slate-400">
          <Info className="mt-0.5 h-4 w-4 shrink-0" aria-hidden /> {emptyMessage ?? "Sin datos para evaluar el Charter."}
        </p>
      )}
      <div className="rounded-xl border border-slate-800 bg-slate-900 p-4 text-[12px] leading-relaxed text-slate-300">
        <h3 className="mb-1.5 text-sm font-semibold text-slate-100">Cómo se evalúa</h3>
        <p>
          El semáforo recomienda activar el International Charter (Space &amp; Major Disasters) cuando se cumplen los tres
          criterios: la actividad del mes supera el percentil 90 histórico (2013–2024, serie Armonizada), el terreno tiene pendiente crítica
          (SRTM) y la nubosidad (MODIS) limita la observación óptica. Con dos criterios queda en pre-alerta.
        </p>
        <p className="mt-2">
          La activación formal la pide un Usuario Autorizado: en Argentina, a través de CONAE o el SINAGIR. La app emite una
          recomendación, no una activación. Las imágenes de emergencia típicas son radar SAR (por ejemplo, SAOCOM) y ópticas
          de alta resolución (Sentinel-2) para mapear severidad.
        </p>
        <a
          href="https://disasterscharter.org/"
          target="_blank"
          rel="noopener noreferrer"
          className="mt-2 inline-flex items-center gap-1 text-orange-300 hover:text-orange-200"
        >
          disasterscharter.org <ExternalLink className="h-3.5 w-3.5" aria-hidden />
        </a>
      </div>
    </div>
  );
}
