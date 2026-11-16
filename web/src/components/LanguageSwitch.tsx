"use client";

import { useEffect, useState } from "react";
import { LANG_EVENT, readLang, setLang, startTranslator, stopTranslator, type Lang } from "@/lib/i18n/translator";

/** Selector de idioma: castellano (principal) o inglés (secundario). Guarda la elección en el navegador. */
export default function LanguageSwitch() {
  const [lang, setLangState] = useState<Lang>("es");

  useEffect(() => {
    const apply = (l: Lang) => {
      setLangState(l);
      if (l === "en") startTranslator();
      else stopTranslator();
    };
    apply(readLang());
    const onChange = (e: Event) => apply((e as CustomEvent<Lang>).detail);
    window.addEventListener(LANG_EVENT, onChange);
    return () => window.removeEventListener(LANG_EVENT, onChange);
  }, []);

  return (
    <div
      data-no-translate
      className="flex items-center gap-0.5 rounded-lg border border-slate-800 bg-slate-900 p-0.5 text-[11px]"
      role="group"
      aria-label="Idioma / Language"
    >
      {(
        [
          ["es", "ES", "Español"],
          ["en", "EN", "English"],
        ] as const
      ).map(([k, label, name]) => (
        <button
          key={k}
          type="button"
          onClick={() => setLang(k)}
          aria-pressed={lang === k}
          title={`${name} / ${k === "es" ? "Spanish" : "Inglés"}`}
          className={`rounded px-1.5 py-0.5 font-semibold ${lang === k ? "bg-slate-700 text-slate-50" : "text-slate-400 hover:text-slate-200"}`}
        >
          {label}
        </button>
      ))}
    </div>
  );
}
