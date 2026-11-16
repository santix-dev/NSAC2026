"use client";

import type { SeriesMode } from "@/types/fire";
import { SERIES_INFO } from "@/lib/stats";

const ORDER: SeriesMode[] = ["harmonized", "combined", "modis", "viirs", "raw"];

/** Selector de serie: Armonizada · Combinación · MODIS · VIIRS · Cruda (calendario, gráfico y mapa). */
export default function SeriesToggle({
  mode,
  onChange,
  disabled = [],
  compact = false,
}: {
  mode: SeriesMode;
  onChange: (m: SeriesMode) => void;
  disabled?: SeriesMode[];
  compact?: boolean;
}) {
  return (
    <div className="flex rounded-md border border-slate-800 bg-slate-950 p-0.5" role="group" aria-label="Serie de datos">
      {ORDER.map((m) => {
        const off = disabled.includes(m);
        return (
          <button
            key={m}
            type="button"
            aria-pressed={mode === m}
            disabled={off}
            title={off ? "Disponible cuando se aplique la migración 006 en Supabase" : SERIES_INFO[m].desc}
            onClick={() => onChange(m)}
            className={`flex-1 rounded px-2 py-0.5 text-[11px] transition disabled:opacity-35 ${
              mode === m ? "bg-slate-700 text-slate-50" : "text-slate-400 hover:text-slate-200"
            }`}
          >
            {compact ? SERIES_INFO[m].short : m === "harmonized" ? "Armonizada" : SERIES_INFO[m].short}
          </button>
        );
      })}
    </div>
  );
}
