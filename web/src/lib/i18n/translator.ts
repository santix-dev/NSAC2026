/**
 * Traducción de la interfaz al inglés en el navegador (idioma secundario).
 *
 * La app está escrita en castellano. Con inglés activo, un MutationObserver traduce los textos
 * visibles (y title / aria-label / placeholder) usando el diccionario EN_PHRASES: frases completas
 * primero y fragmentos después, respetando límites de palabra. Solo cambia el valor de los nodos de
 * texto existentes (no agrega ni quita nodos), así que React sigue controlando el DOM. Al volver a
 * castellano se restauran los textos originales que no hayan cambiado desde entonces.
 */
import { EN_PHRASES } from "./en";

export type Lang = "es" | "en";
export const LANG_KEY = "foco-cero-lang";
export const LANG_EVENT = "foco-cero-lang";

const ATTRS = ["title", "aria-label", "placeholder"] as const;
const SKIP = new Set(["SCRIPT", "STYLE", "NOSCRIPT", "TEXTAREA"]);
const L = "\\p{L}";

interface Rule {
  re: RegExp;
  en: string;
}

let rules: Rule[] | null = null;
function buildRules(): Rule[] {
  const esc = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return [...EN_PHRASES]
    .sort((a, b) => b[0].length - a[0].length)
    .map(([es, en]) => {
      const body = esc(es).replace(/\\\{n\\\}/g, "([\\d.,]+)").replace(/ /g, "\\s+");
      const start = /^\p{L}/u.test(es) ? `(?<!${L})` : "";
      const end = /\p{L}$/u.test(es) ? `(?!${L})` : "";
      return { re: new RegExp(start + body + end, "gu"), en };
    });
}

/** Traduce un texto con el diccionario (frases largas primero). */
export function translate(text: string): string {
  if (!/\p{L}/u.test(text)) return text;
  rules ??= buildRules();
  let out = text;
  for (const r of rules) {
    if (!r.re.test(out)) continue;
    r.re.lastIndex = 0;
    out = out.replace(r.re, (_m, num?: string) => (num != null && r.en.includes("{n}") ? r.en.replace("{n}", num) : r.en));
  }
  return out;
}

const textOrig = new WeakMap<Text, { es: string; en: string }>();
const attrOrig = new WeakMap<Element, Map<string, { es: string; en: string }>>();
let observer: MutationObserver | null = null;
let origTitle: string | null = null;
const touchedText = new Set<WeakRef<Text>>();
const touchedEls = new Set<WeakRef<Element>>();

function doText(n: Text) {
  const p = n.parentElement;
  if (!p || SKIP.has(p.tagName) || p.closest("[data-no-translate]")) return;
  const cur = n.nodeValue ?? "";
  const prev = textOrig.get(n);
  if (prev && prev.en === cur) return; // ya traducido
  const en = translate(cur);
  if (en === cur) return;
  textOrig.set(n, { es: cur, en });
  touchedText.add(new WeakRef(n));
  n.nodeValue = en;
}

function doAttrs(el: Element) {
  if (el.closest("[data-no-translate]")) return;
  for (const a of ATTRS) {
    const cur = el.getAttribute(a);
    if (!cur) continue;
    let m = attrOrig.get(el);
    if (m?.get(a)?.en === cur) continue;
    const en = translate(cur);
    if (en === cur) continue;
    if (!m) {
      m = new Map();
      attrOrig.set(el, m);
      touchedEls.add(new WeakRef(el));
    }
    m.set(a, { es: cur, en });
    el.setAttribute(a, en);
  }
}

function walk(root: Node) {
  if (root.nodeType === Node.TEXT_NODE) return doText(root as Text);
  if (root.nodeType !== Node.ELEMENT_NODE) return;
  const el = root as Element;
  if (SKIP.has(el.tagName)) return;
  doAttrs(el);
  const tw = document.createTreeWalker(el, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT);
  let n = tw.nextNode();
  while (n) {
    if (n.nodeType === Node.TEXT_NODE) doText(n as Text);
    else doAttrs(n as Element);
    n = tw.nextNode();
  }
}

export function startTranslator() {
  if (observer || typeof document === "undefined") return;
  document.documentElement.lang = "en";
  walk(document.body);
  origTitle = document.title;
  document.title = translate(document.title);
  observer = new MutationObserver((muts) => {
    for (const m of muts) {
      if (m.type === "characterData") doText(m.target as Text);
      else if (m.type === "attributes") doAttrs(m.target as Element);
      else m.addedNodes.forEach(walk);
    }
  });
  observer.observe(document.body, {
    subtree: true,
    childList: true,
    characterData: true,
    attributes: true,
    attributeFilter: [...ATTRS],
  });
}

export function stopTranslator() {
  if (typeof document === "undefined") return;
  observer?.disconnect();
  observer = null;
  document.documentElement.lang = "es";
  if (origTitle != null) document.title = origTitle;
  origTitle = null;
  touchedText.forEach((ref) => {
    const n = ref.deref();
    const o = n && textOrig.get(n);
    if (n && o && n.nodeValue === o.en) n.nodeValue = o.es;
    if (n) textOrig.delete(n);
  });
  touchedText.clear();
  touchedEls.forEach((ref) => {
    const el = ref.deref();
    const m = el && attrOrig.get(el);
    if (el && m) m.forEach((o, a) => el.getAttribute(a) === o.en && el.setAttribute(a, o.es));
    if (el) attrOrig.delete(el);
  });
  touchedEls.clear();
}

export function readLang(): Lang {
  if (typeof window === "undefined") return "es";
  const q = new URLSearchParams(window.location.search).get("lang");
  if (q === "en" || q === "es") {
    try {
      window.localStorage.setItem(LANG_KEY, q);
    } catch {
      /* almacenamiento no disponible */
    }
    return q;
  }
  try {
    return window.localStorage.getItem(LANG_KEY) === "en" ? "en" : "es";
  } catch {
    return "es";
  }
}

export function setLang(lang: Lang) {
  try {
    window.localStorage.setItem(LANG_KEY, lang);
  } catch {
    /* almacenamiento no disponible */
  }
  // Recargar: así números y fechas se vuelven a formatear en el idioma elegido (la vista sigue en la URL)
  const url = new URL(window.location.href);
  url.searchParams.delete("lang");
  window.history.replaceState(null, "", url.toString());
  window.location.reload();
}

/** Formato de números y fechas según el idioma elegido (es-AR por defecto). */
export function uiLocale(): string {
  return typeof window !== "undefined" && readLang() === "en" ? "en-US" : "es-AR";
}
