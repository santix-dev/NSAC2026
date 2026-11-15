/**
 * Logo de Foco Cero: isotipo (satélite + señal + foco sobre el planeta) y logotipo.
 * Versión para el tema oscuro de la app; el logo original está en /public/brand/foco-cero-logo.png.
 */
export function BrandMark({ className = "h-8 w-8" }: { className?: string }) {
  // eslint-disable-next-line @next/next/no-img-element
  return <img src="/brand/foco-cero-mark.svg" alt="" aria-hidden className={`${className} rounded-lg`} />;
}

export default function BrandLogo({ compact = false }: { compact?: boolean }) {
  return (
    <div className="flex items-center gap-2" aria-label="Foco Cero — Monitoreo satelital de puntos calientes">
      <BrandMark />
      {!compact && (
        <div className="hidden border-l border-slate-700 pl-2 leading-none sm:block">
          <p className="text-[15px] font-extrabold tracking-wide">
            <span className="text-slate-50">FOCO</span> <span className="text-[#ff6a00]">CERO</span>
          </p>
          <p className="mt-1 text-[8.5px] uppercase tracking-[0.18em] text-slate-500">
            Monitoreo satelital de puntos calientes
          </p>
        </div>
      )}
    </div>
  );
}
