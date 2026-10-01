// Tarayıcı yardımcıları: kullanıcıya özel bağlam (oturum belirteci localStorage'a önceden yazılır), sayfa/konsol hatası
// toplama, sayfanın "yerleşmesini" bekleme (yükleme göstergeleri biter), HashRouter yollarına gitme, 360 px taşma ölçümü.
import { expect, type Browser, type BrowserContext, type BrowserContextOptions, type Page } from "@playwright/test";
import type { Api } from "./api";

export interface Session {
  context: BrowserContext;
  page: Page;
  /** Toplanan sayfa hataları (pageerror) ve konsol hataları */
  errors: string[];
  close(): Promise<void>;
}

/** Sayfa ve konsol hatalarını toplar. Yalnızca hata düzeyi sayılır (uyarılar değil). */
export function trackErrors(page: Page, errors: string[]): void {
  page.on("pageerror", (err) => errors.push(`[pageerror] ${page.url()} :: ${err.message}`));
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(`[console] ${page.url()} :: ${msg.text()}`);
  });
}

interface NetState {
  inflight: number;
  lastChange: number;
}
const netStates = new WeakMap<Page, NetState>();

/** Süren ağ isteklerini sayar (sekme tıklaması gibi belge yüklemesi olmayan geçişlerde "ağ durulması"nı beklemek için). */
export function trackNetwork(page: Page): void {
  if (netStates.has(page)) return;
  const s: NetState = { inflight: 0, lastChange: Date.now() };
  netStates.set(page, s);
  page.on("request", () => {
    s.inflight++;
    s.lastChange = Date.now();
  });
  const done = () => {
    s.inflight = Math.max(0, s.inflight - 1);
    s.lastChange = Date.now();
  };
  page.on("requestfinished", done);
  page.on("requestfailed", done);
}

/** Süren istek kalmayana ve `quietMs` boyunca yeni istek başlamayana kadar bekler (koşul yoklaması, sabit uyku değil). */
export async function waitNetworkQuiet(page: Page, quietMs = 400, timeout = 30_000): Promise<void> {
  const s = netStates.get(page);
  if (!s) {
    await page.waitForLoadState("networkidle", { timeout }).catch(() => undefined);
    return;
  }
  await expect
    .poll(() => s.inflight === 0 && Date.now() - s.lastChange >= quietMs, { timeout, intervals: [50, 100, 100, 200], message: "ağ trafiği durulmadı" })
    .toBe(true);
}

/**
 * Yeni bir tarayıcı bağlamı açar. `as` verilirse o kullanıcının belirteci (API ile alınır, önbellekli)
 * localStorage["forum.token"]'a önceden yazılır: arayüz açılışta oturumu kendisi yükler.
 */
export async function openSession(browser: Browser, api: Api, opts: { as?: string; token?: string; contextOptions?: BrowserContextOptions } = {}): Promise<Session> {
  const token = opts.token ?? (opts.as ? await api.token(opts.as) : undefined);
  const context = await browser.newContext({
    baseURL: api.baseURL,
    locale: "tr-TR",
    timezoneId: "Europe/Istanbul",
    ...opts.contextOptions,
    storageState: token ? { cookies: [], origins: [{ origin: api.baseURL, localStorage: [{ name: "forum.token", value: token }] }] } : undefined,
  });
  const page = await context.newPage();
  const errors: string[] = [];
  trackErrors(page, errors);
  trackNetwork(page);
  return { context, page, errors, close: () => context.close() };
}

/** Yükleme göstergeleri (Spinner) kaybolana ve ağ trafiği durulana kadar bekler. */
export async function waitSettled(page: Page, timeout = 30_000): Promise<void> {
  await page.waitForLoadState("domcontentloaded");
  await expect(page.locator("#root > *").first()).toBeVisible({ timeout });
  await expect(page.locator(".spinner-wrap")).toHaveCount(0, { timeout });
  // Yoklama yapan sayfalar (defter 5 sn, öneri 30 sn) durulmayı geciktirmez: 400 ms sessizlik yeterli.
  await waitNetworkQuiet(page, 400, timeout);
  await expect(page.locator(".spinner-wrap")).toHaveCount(0, { timeout });
}

let navSeq = 0;

/**
 * HashRouter yoluna tam sayfa yüklemesiyle gider (ör. "/oneriler/abc") ve sayfanın yerleşmesini bekler.
 * Adrese benzersiz bir sorgu eklenir: yalnızca # sonrası değişen bir gezinme belgeyi yeniden yüklemez, veriyi de
 * her zaman yeniden çekmez (başka bir bağlamda yapılan değişiklikler görünmeyebilir).
 */
export async function gotoApp(page: Page, path: string): Promise<void> {
  const hash = `#${path.startsWith("/") ? path : `/${path}`}`;
  await page.goto(`/?_=${++navSeq}${hash}`);
  await waitSettled(page);
}

/** Sayfayı yeniden yükler (başka bir bağlamda yapılan değişiklikleri görmek için) ve yerleşmesini bekler. */
export async function reloadApp(page: Page): Promise<void> {
  await page.reload();
  await waitSettled(page);
}

export interface OverflowReport {
  scrollWidth: number;
  innerWidth: number;
  overflow: number;
  /** Görünür alanın sağına taşan öğeler (tanı için) */
  offenders: string[];
}

/**
 * Yatay taşma: document.documentElement.scrollWidth - innerWidth (0 olmalı) ve taşan öğelerin kısa tarifi.
 * Açık bir pencere (<dialog>, üst katmanda; gövde kaydırması kilitli) varsa pencerenin kendisi de ölçülür:
 * görünür alanın dışına taşmamalı ve içeriği yatay kaydırma gerektirmemeli.
 */
export function measureOverflow(page: Page): Promise<OverflowReport> {
  return page.evaluate(() => {
    const de = document.documentElement;
    const iw = window.innerWidth;
    const offenders: string[] = [];
    const describe = (el: Element) => {
      const cls = typeof (el as HTMLElement).className === "string" && (el as HTMLElement).className ? `.${(el as HTMLElement).className.trim().split(/\s+/).join(".")}` : "";
      return `${el.tagName.toLowerCase()}${cls}`;
    };
    if (de.scrollWidth > iw) {
      for (const el of Array.from(document.querySelectorAll<HTMLElement>("body *"))) {
        const r = el.getBoundingClientRect();
        if (r.width > 0 && r.right > iw + 0.5) {
          offenders.push(`${describe(el)} (sağ kenar ${Math.round(r.right)} px)`);
          if (offenders.length >= 8) break;
        }
      }
    }
    let dialogOverflow = 0;
    for (const dlg of Array.from(document.querySelectorAll<HTMLDialogElement>("dialog[open]"))) {
      const r = dlg.getBoundingClientRect();
      const out = Math.max(0, r.right - iw, -r.left);
      if (out > 0.5) {
        dialogOverflow = Math.max(dialogOverflow, Math.ceil(out));
        offenders.push(`${describe(dlg)} görünür alandan ${Math.ceil(out)} px taşıyor`);
      }
      for (const el of [dlg, ...Array.from(dlg.querySelectorAll<HTMLElement>(".modal-inner, .modal-body, .modal-footer"))]) {
        const extra = el.scrollWidth - el.clientWidth;
        if (extra > 1) {
          dialogOverflow = Math.max(dialogOverflow, extra);
          offenders.push(`${describe(el)} içeriği ${extra} px yatay kaydırma gerektiriyor`);
        }
      }
    }
    return { scrollWidth: de.scrollWidth, innerWidth: iw, overflow: Math.max(de.scrollWidth - iw, dialogOverflow), offenders };
  });
}

/** Bildirim (toast) metni görünene kadar bekler. */
export async function expectToast(page: Page, text: string | RegExp): Promise<void> {
  await expect(page.locator(".toast").filter({ hasText: text }).first()).toBeVisible();
}

/** Açık onay penceresinde (yerel <dialog>) düğmeye basar. */
export async function confirmDialog(page: Page, title: string | RegExp, confirmLabel: string | RegExp): Promise<void> {
  const dialog = page.getByRole("dialog", { name: title });
  await expect(dialog).toBeVisible();
  await dialog.getByRole("button", { name: confirmLabel }).click();
  await expect(dialog).toBeHidden();
}
