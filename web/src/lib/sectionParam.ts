// Derin bağlantı: `?bolum=<çapa>` bölümü açar, oraya kaydırır, odağı taşır ve parametreyi replace ile siler.
//   • Veri yüklendikten SONRA çalışır (`ready`); kart henüz çizilmediyse birkaç kare bekler.
//   • Parametre silindiği için aynı bağlantı tekrar çalışır, geçmiş kirlenmez ve Android geri tuşu önceki sayfaya döner.
//   • AppLayout'un "yol değişince başa kaydır" etkisi yalnız pathname değişince çalışır; veri yüklenmeden önce biter, çakışmaz.
//   • `?mesaj=` gibi diğer parametrelere dokunulmaz.
// Kullanım: useSectionParam(!loading && !!data) — çapa, hedef öğenin (Card anchor=…, Details id=…, herhangi bir öğe) id'sidir.
import { useEffect, useRef } from "react";
import { flushSync } from "react-dom";
import { useLocation, useSearchParams } from "react-router-dom";
import { revealSection } from "../ui/basic";
import { applyQueryValue, composeQueryUpdate } from "./hooks";

/** Sorgu parametresinin adı. */
export const SECTION_PARAM = "bolum";

// Çapa kimlikleri kısa, ASCII ve güvenli olmalı (id olarak kullanılır).
const ANCHOR_RE = /^[A-Za-z][A-Za-z0-9_-]{0,63}$/;

/** Parametre değerini doğrular; geçersizse null. */
export function parseSectionParam(raw: string | null | undefined): string | null {
  return raw && ANCHOR_RE.test(raw) ? raw : null;
}

/** Parametreyi siler, diğerlerini korur (girdi değiştirilmez). */
export function stripSectionParam(params: URLSearchParams, name: string = SECTION_PARAM): URLSearchParams {
  return applyQueryValue(params, name, "", "");
}

/** `?bolum=<çapa>` sorgu dizesi (başında ?); çapa geçersizse boş dize. */
export function sectionSearch(bolum: string | null | undefined): string {
  return parseSectionParam(bolum) ? `?${SECTION_PARAM}=${encodeURIComponent(bolum!)}` : "";
}

// Odak: önce çağıranın seçicisi, sonra katlanabilir kartın başlık düğmesi, sonra hedefteki ilk görünür denetim.
const FIRST_CONTROL = [
  'input:not([type="hidden"]):not([disabled])',
  "select:not([disabled])",
  "textarea:not([disabled])",
  "button:not([disabled])",
  "a[href]",
  "summary",
  '[tabindex]:not([tabindex="-1"])',
].join(",");

function isVisible(el: HTMLElement): boolean {
  return typeof el.checkVisibility === "function" ? el.checkVisibility() : el.getClientRects().length > 0;
}

/** Hedef bölümde odaklanacak öğeyi bulur. */
export function findSectionFocusTarget(section: HTMLElement, selector?: string): HTMLElement {
  if (selector) {
    const custom = section.querySelector<HTMLElement>(selector);
    if (custom && isVisible(custom)) return custom;
  }
  const toggle = section.classList.contains("card-collapsible") ? section.querySelector<HTMLElement>(":scope > .card-header .card-toggle") : null;
  if (toggle) return toggle;
  if (section.matches(FIRST_CONTROL)) return section;
  for (const el of Array.from(section.querySelectorAll<HTMLElement>(FIRST_CONTROL))) {
    if (isVisible(el)) return el;
  }
  return section;
}

export interface UseSectionParamOptions {
  /** Parametre adı (varsayılan "bolum") */
  param?: string;
  /** Çapa → odak seçicisi (ör. { itiraz: "textarea" }); verilmezse başlık düğmesi / ilk denetim */
  focus?: Record<string, string>;
}

const MAX_FRAMES = 40; // hedef çizilene kadar en çok ~0,7 sn beklenir

/**
 * `?bolum=<çapa>` varsa ve `ready` (veri yüklendi) doğruysa: hedefi açar, kaydırır, odağı taşır, parametreyi siler.
 * Hedef bulunamazsa parametre sessizce silinir.
 */
export function useSectionParam(ready: boolean, options: UseSectionParamOptions = {}): void {
  const param = options.param ?? SECTION_PARAM;
  const [params, setParams] = useSearchParams();
  const { pathname } = useLocation();
  const raw = params.get(param);
  const anchor = parseSectionParam(raw);

  // Geç çalışan geri çağrılar en güncel yönlendirme işlevini ve seçenekleri kullanır.
  const latest = useRef({ setParams, pathname, options });
  latest.current = { setParams, pathname, options };

  useEffect(() => {
    if (raw === null || !ready) return;
    let cancelled = false;
    let frame = 0;
    let tries = 0;

    const strip = () => {
      const { setParams: set, pathname: path } = latest.current;
      set((prev) => composeQueryUpdate(`${path}?${prev.toString()}`, prev, (p) => stripSectionParam(p, param)), { replace: true });
    };

    const run = () => {
      frame = 0;
      if (cancelled) return;
      const target = anchor ? document.getElementById(anchor) : null;
      if (anchor && !target && tries++ < MAX_FRAMES) {
        frame = requestAnimationFrame(run);
        return;
      }
      if (target) {
        // flushSync: açılan kartların gövdesi DOM'da görünür olmadan kaydırma/odak yanlış yere gider.
        flushSync(() => revealSection(target));
        const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
        target.scrollIntoView({ block: "start", behavior: reduce ? "auto" : "smooth" });
        const focusEl = findSectionFocusTarget(target, latest.current.options.focus?.[anchor!]);
        if (focusEl === target && !target.hasAttribute("tabindex")) target.setAttribute("tabindex", "-1");
        focusEl.focus({ preventScroll: true });
      }
      strip();
    };

    frame = requestAnimationFrame(run);
    return () => {
      cancelled = true;
      if (frame) cancelAnimationFrame(frame);
    };
  }, [raw, anchor, ready, param]);
}
