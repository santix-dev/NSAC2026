"use client";

import { useEffect, useRef, useState } from "react";
import {
  BookOpen,
  Check,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  Crosshair,
  Database,
  Link2,
  Loader2,
  MapPin,
  Search,
} from "lucide-react";
import type { BBox, DataSource, Region } from "@/types/fire";
import { FIRST_YEAR, LAST_YEAR, MONTHS_LONG, YEARS } from "@/lib/regions";
import { CustomBBoxForm } from "./AreaForms";
import BrandLogo from "./BrandLogo";
import LanguageSwitch from "./LanguageSwitch";

interface Props {
  regions: Region[];
  regionKey: string;
  regionLabel: string;
  bbox: BBox;
  year: number;
  dataSource: DataSource | null;
  onSelectRegion: (key: string) => void;
  onCustomArea: (bbox: BBox, label?: string) => void;
  onYear: (y: number) => void;
  month: number | null;
  onMonth: (m: number | null) => void;
  onOpenMethodology: () => void;
}

function useOutside(onOutside: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const down = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && onOutside();
    const key = (e: KeyboardEvent) => e.key === "Escape" && onOutside();
    document.addEventListener("mousedown", down);
    document.addEventListener("keydown", key);
    return () => {
      document.removeEventListener("mousedown", down);
      document.removeEventListener("keydown", key);
    };
  }, [onOutside]);
  return ref;
}

export default function TopBar(p: Props) {
  const [copied, setCopied] = useState(false);
  const share = async () => {
    try {
      const url = new URL(window.location.href);
      if (document.documentElement.lang === "en") url.searchParams.set("lang", "en");
      await navigator.clipboard.writeText(url.toString());
      setCopied(true);
      setTimeout(() => setCopied(false), 1800);
    } catch {
      /* el navegador no permite el portapapeles */
    }
  };

  return (
    <header className="z-[1100] border-b border-slate-800 bg-slate-950">
      <div className="flex flex-wrap items-center gap-2 px-3 py-2">
        <div className="mr-1">
          <BrandLogo />
        </div>

        <RegionPicker {...p} />
        <PlaceSearch onPick={p.onCustomArea} />
        <YearStepper year={p.year} onYear={p.onYear} />
        <select
          value={p.month ?? 0}
          onChange={(e) => p.onMonth(+e.target.value || null)}
          className={`rounded-lg border bg-slate-900 px-2 py-1.5 text-sm outline-none ${
            p.month ? "border-orange-600/70 text-orange-200" : "border-slate-800 text-slate-200"
          }`}
          aria-label="Mes"
          title="Filtrar mapa, escenario y Charter por mes"
        >
          <option value={0} className="bg-slate-900">
            Todo el año
          </option>
          {MONTHS_LONG.map((m, i) => (
            <option key={m} value={i + 1} className="bg-slate-900">
              {m}
            </option>
          ))}
        </select>

        <div className="ml-auto flex items-center gap-1.5">
          <span
            className={`hidden items-center gap-1 rounded-md border px-2 py-1 text-[11px] md:flex ${
              p.dataSource === "supabase"
                ? "border-emerald-800/70 bg-emerald-500/10 text-emerald-300"
                : "border-sky-800/70 bg-sky-500/10 text-sky-300"
            }`}
            title={
              p.dataSource === "supabase"
                ? "Datos reales servidos en vivo por Supabase"
                : "Base no disponible: copia estática de los mismos datos reales"
            }
          >
            <Database className="h-3.5 w-3.5" aria-hidden />
            <span className="hidden 2xl:inline">
              {p.dataSource === "supabase" ? "Datos en vivo" : p.dataSource === "snapshot" ? "Copia de datos reales" : "Cargando…"}
            </span>
          </span>
          <LanguageSwitch />
          <button
            type="button"
            onClick={share}
            className="flex items-center gap-1.5 rounded-lg border border-slate-800 px-2.5 py-1.5 text-xs text-slate-300 hover:bg-slate-900"
            title="Copiar un link a esta vista"
          >
            {copied ? <Check className="h-4 w-4 text-emerald-400" aria-hidden /> : <Link2 className="h-4 w-4" aria-hidden />}
            <span className="hidden sm:inline">{copied ? "Link copiado" : "Compartir"}</span>
          </button>
          <button
            type="button"
            onClick={p.onOpenMethodology}
            className="flex items-center gap-1.5 rounded-lg bg-orange-600 px-2.5 py-1.5 text-xs font-medium text-white hover:bg-orange-500"
          >
            <BookOpen className="h-4 w-4" aria-hidden />
            <span className="hidden sm:inline">Metodología e IA</span>
          </button>
        </div>
      </div>
    </header>
  );
}

function RegionPicker(p: Props) {
  const [open, setOpen] = useState(false);
  const [custom, setCustom] = useState(false);
  const [q, setQ] = useState("");
  const ref = useOutside(() => {
    setOpen(false);
    setCustom(false);
  });
  const filtered = p.regions.filter((r) =>
    `${r.name} ${r.subtitle ?? ""} ${r.country}`.toLowerCase().includes(q.trim().toLowerCase()),
  );
  const byCountry = new Map<string, Region[]>();
  for (const r of filtered) byCountry.set(r.country, [...(byCountry.get(r.country) ?? []), r]);

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        aria-expanded={open}
        className="flex max-w-[260px] items-center gap-2 rounded-lg border border-slate-700 bg-slate-900 px-3 py-1.5 text-left hover:border-slate-600"
      >
        <MapPin className="h-4 w-4 shrink-0 text-orange-400" aria-hidden />
        <span className="truncate text-sm font-medium text-slate-100">{p.regionLabel}</span>
        <ChevronDown className="h-4 w-4 shrink-0 text-slate-500" aria-hidden />
      </button>
      {open && (
        <div className="absolute left-0 top-full z-[1200] mt-1.5 w-80 rounded-xl border border-slate-800 bg-slate-900 p-2 shadow-2xl">
          {custom ? (
            <CustomBBoxForm
              bbox={p.bbox}
              onApply={(b) => {
                p.onCustomArea(b, "Área personalizada");
                setOpen(false);
                setCustom(false);
              }}
              onCancel={() => setCustom(false)}
            />
          ) : (
            <>
              <label className="flex items-center gap-2 rounded-md border border-slate-800 bg-slate-950 px-2 py-1.5">
                <Search className="h-3.5 w-3.5 text-slate-500" aria-hidden />
                <input
                  autoFocus
                  value={q}
                  onChange={(e) => setQ(e.target.value)}
                  placeholder="Filtrar regiones…"
                  className="w-full bg-transparent text-sm text-slate-100 outline-none placeholder:text-slate-600"
                />
              </label>
              <div className="mt-2 max-h-72 overflow-y-auto">
                {[...byCountry.entries()].map(([country, list]) => (
                  <div key={country} className="mb-1">
                    <p className="px-2 py-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500">{country}</p>
                    {list.map((r) => (
                      <button
                        key={r.key}
                        type="button"
                        onClick={() => {
                          p.onSelectRegion(r.key);
                          setOpen(false);
                        }}
                        className={`flex w-full items-start gap-2 rounded-md px-2 py-1.5 text-left hover:bg-slate-800 ${
                          p.regionKey === r.key ? "bg-slate-800" : ""
                        }`}
                      >
                        <span className="min-w-0 flex-1">
                          <span className="block text-sm text-slate-100">{r.name}</span>
                          <span className="block truncate text-[11px] text-slate-500">{r.subtitle}</span>
                        </span>
                        {r.role && (
                          <span
                            className={`mt-0.5 shrink-0 rounded px-1.5 py-0.5 text-[10px] ${
                              r.isCalibration ? "bg-sky-500/15 text-sky-300" : "bg-orange-500/15 text-orange-300"
                            }`}
                          >
                            {r.role}
                          </span>
                        )}
                      </button>
                    ))}
                  </div>
                ))}
                {!filtered.length && <p className="px-2 py-3 text-xs text-slate-500">Sin regiones con ese nombre.</p>}
              </div>
              <button
                type="button"
                onClick={() => setCustom(true)}
                className="mt-1 flex w-full items-center gap-2 rounded-md border-t border-slate-800 px-2 pb-1 pt-2 text-left text-sm text-slate-300 hover:text-white"
              >
                <Crosshair className="h-4 w-4" aria-hidden /> Área por coordenadas…
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}

interface Place {
  name: string;
  detail: string;
  bbox: BBox;
}

/** Búsqueda de lugares en todo el mundo (OpenStreetMap Nominatim). */
function PlaceSearch({ onPick }: { onPick: (bbox: BBox, label?: string) => void }) {
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Place[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen] = useState(false);
  const ref = useOutside(() => setOpen(false));

  useEffect(() => {
    const term = q.trim();
    if (term.length < 3) return;
    const ctrl = new AbortController();
    const t = setTimeout(async () => {
      setLoading(true);
      try {
        const url = `https://nominatim.openstreetmap.org/search?format=jsonv2&limit=6&accept-language=es&q=${encodeURIComponent(term)}`;
        const res = await fetch(url, { signal: ctrl.signal });
        const data: { display_name: string; name?: string; boundingbox: string[]; lat: string; lon: string }[] = await res.json();
        setResults(
          data.map((d) => {
            const [s, n, w, e] = d.boundingbox.map(Number);
            const lat = Number(d.lat);
            const lon = Number(d.lon);
            // área de análisis centrada en el lugar: su extensión, con mínimo 0,5° y máximo 5° por lado
            const half = (a: number, b: number) => Math.min(Math.max((b - a) / 2, 0.25), 2.5);
            const hl = half(s, n);
            const hw = half(w, e);
            return {
              name: d.name || d.display_name.split(",")[0],
              detail: d.display_name,
              bbox: [lon - hw, lat - hl, lon + hw, lat + hl] as BBox,
            };
          }),
        );
        setOpen(true);
      } catch {
        /* búsqueda cancelada o sin red */
      } finally {
        setLoading(false);
      }
    }, 400);
    return () => {
      clearTimeout(t);
      ctrl.abort();
    };
  }, [q]);

  return (
    <div ref={ref} className="relative order-last w-full sm:order-none sm:w-64">
      <label className="flex items-center gap-2 rounded-lg border border-slate-800 bg-slate-900 px-2.5 py-1.5">
        {loading ? (
          <Loader2 className="h-4 w-4 animate-spin text-slate-500" aria-hidden />
        ) : (
          <Search className="h-4 w-4 text-slate-500" aria-hidden />
        )}
        <input
          value={q}
          onChange={(e) => {
            setQ(e.target.value);
            if (e.target.value.trim().length < 3) setResults([]);
          }}
          onFocus={() => results.length && setOpen(true)}
          placeholder="Buscar un lugar del mundo…"
          className="w-full bg-transparent text-sm text-slate-100 outline-none placeholder:text-slate-600"
          aria-label="Buscar lugar"
        />
      </label>
      {open && results.length > 0 && (
        <ul className="absolute left-0 right-0 top-full z-[1200] mt-1.5 overflow-hidden rounded-xl border border-slate-800 bg-slate-900 shadow-2xl">
          {results.map((r, i) => (
            <li key={i}>
              <button
                type="button"
                onClick={() => {
                  onPick(r.bbox, r.name);
                  setOpen(false);
                  setQ(r.name);
                }}
                className="block w-full px-3 py-2 text-left hover:bg-slate-800"
              >
                <span className="block text-sm text-slate-100">{r.name}</span>
                <span className="block truncate text-[11px] text-slate-500">{r.detail}</span>
              </button>
            </li>
          ))}
          <li className="border-t border-slate-800 px-3 py-1 text-[10px] text-slate-600">Búsqueda: © OpenStreetMap Nominatim</li>
        </ul>
      )}
    </div>
  );
}

function YearStepper({ year, onYear }: { year: number; onYear: (y: number) => void }) {
  const btn = "rounded-md p-1 text-slate-400 hover:bg-slate-800 hover:text-white disabled:opacity-30";
  return (
    <div className="flex items-center rounded-lg border border-slate-800 bg-slate-900 px-1">
      <button type="button" className={btn} disabled={year <= FIRST_YEAR} onClick={() => onYear(year - 1)} aria-label="Año anterior">
        <ChevronLeft className="h-4 w-4" />
      </button>
      <select
        value={year}
        onChange={(e) => onYear(+e.target.value)}
        className="bg-transparent px-1 py-1 font-mono text-sm text-slate-100 outline-none"
        aria-label="Año"
      >
        {YEARS.map((y) => (
          <option key={y} value={y} className="bg-slate-900">
            {y}
          </option>
        ))}
      </select>
      <button type="button" className={btn} disabled={year >= LAST_YEAR} onClick={() => onYear(year + 1)} aria-label="Año siguiente">
        <ChevronRight className="h-4 w-4" />
      </button>
    </div>
  );
}
