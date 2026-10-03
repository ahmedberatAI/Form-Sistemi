// Faz 2 (sade arayüz) ortak yardımcıları: 'Bu sayfada' gezinmesinin her bağlantısını gezme, kaydırmanın bitmesini bekleme,
// hedefin sabit üst çubuğun altında kalmadığını denetleme ve sayfa ölçümü (ekran boyu, kelime, tıklanabilir öğe, rozet).
// 01-tarama (extra) ve 06-sadelik aynı yardımcıları kullanır; böylece sözleşme tek yerde yazılıdır.
import { expect, type Locator, type Page } from "@playwright/test";

/** Öneri sayfasındaki 'Bu sayfada' gezinmesi (<nav aria-label="Bu sayfada">). */
export function onThisPage(page: Page): Locator {
  return page.getByRole("navigation", { name: "Bu sayfada" });
}

/** Kaydırma durana kadar bekler (yumuşak kaydırma ~0,3-0,6 sn sürer): scrollY art arda 3 yoklamada aynı kalmalı. */
export async function waitScrollSettled(page: Page): Promise<void> {
  let last = Number.NaN;
  let stable = 0;
  await expect
    .poll(
      async () => {
        const y = await page.evaluate(() => Math.round(window.scrollY));
        stable = y === last ? stable + 1 : 0;
        last = y;
        return stable;
      },
      { intervals: [100], timeout: 8_000, message: "sayfa kaydırması durmadı" },
    )
    .toBeGreaterThanOrEqual(3);
}

/** Alt gezinmenin (telefon) üst kenarı ya da pencerenin altı: içeriğin görünebildiği son piksel. */
export async function visibleAreaBottom(page: Page): Promise<number> {
  return page.evaluate(() => {
    const nav = document.querySelector<HTMLElement>(".bottom-nav");
    const shown = nav && getComputedStyle(nav).display !== "none";
    return shown ? nav.getBoundingClientRect().top : window.innerHeight;
  });
}

/** Sabit üst çubuğun (başlık + varsa masaüstü gezinme satırı) alt kenarı. */
export async function stickyHeaderBottom(page: Page): Promise<number> {
  return page.evaluate(() => document.querySelector(".app-header")?.getBoundingClientRect().bottom ?? 0);
}

/**
 * Derin bağlantı hedefinin kaydırma sonrası durumu: görünür alanda, sabit üst çubuğun ALTINDA ve odak hedefin içinde.
 * (scroll-margin-top eksikse başlık çubuğun altında kalır; sayfa sonuna yaklaşıldığında hedef daha aşağıda olabilir, sorun değil.)
 */
export async function expectSectionReached(page: Page, target: Locator, label: string): Promise<void> {
  await expect(target, `${label}: hedef bölüm sayfada olmalı`).toBeAttached();
  await waitScrollSettled(page);
  await expect(target, `${label}: hedef bölüm görünür alana gelmeli`).toBeInViewport();
  const { top } = await target.evaluate((el) => ({ top: el.getBoundingClientRect().top }));
  const headerBottom = await stickyHeaderBottom(page);
  expect(top, `${label}: hedefin üstü (${Math.round(top)} px) sabit üst çubuğun (${Math.round(headerBottom)} px) altında kalmamalı`).toBeGreaterThanOrEqual(headerBottom - 1);
  await expect
    .poll(() => target.evaluate((el) => el.contains(document.activeElement)), { message: `${label}: odak hedef bölümün içine taşınmalı` })
    .toBe(true);
}

/**
 * 'Bu sayfada' gezinmesindeki her bağlantıya sırayla tıklar: ?bolum= parametresi replace ile silinmeli, hedef bölüm sayfada
 * olmalı, görünür alana gelmeli, üst çubuğun altında kalmamalı ve odak içine taşınmalı. Tıklanan bağlantı adlarını döndürür.
 */
export async function clickEveryOnThisPage(page: Page): Promise<string[]> {
  const nav = onThisPage(page);
  await expect(nav).toBeVisible();
  const links = nav.getByRole("link");
  const total = await links.count();
  expect(total, "'Bu sayfada' en az Metin, Tartışma ve Kanıtlar bağlantılarını içermeli").toBeGreaterThanOrEqual(3);
  const clicked: string[] = [];
  for (let i = 0; i < total; i++) {
    const link = links.nth(i);
    const label = (await link.innerText()).trim().replace(/\s+/g, " ");
    const anchor = /[?&]bolum=([A-Za-z0-9_-]+)/.exec((await link.getAttribute("href")) ?? "")?.[1];
    expect(anchor, `'${label}' bağlantısı ?bolum=<çapa> taşımalı`).toBeTruthy();
    await link.click();
    // useSectionParam parametreyi replace ile siler: geçmiş kirlenmez, aynı bağlantı yeniden çalışır.
    await expect(page, `'${label}' sonrası adreste ?bolum kalmamalı`).not.toHaveURL(/[?&]bolum=/);
    await expectSectionReached(page, page.locator(`#${anchor}`), `'${label}'`);
    clicked.push(label);
  }
  return clicked;
}

export interface PageMetrics {
  /** document.scrollHeight / innerHeight (bir ondalık) */
  screens: number;
  scrollHeight: number;
  innerHeight: number;
  /** <main> içinde görünen sözcük sayısı */
  words: number;
  /** <main> içinde görünen tıklanabilir öğeler (bağlantı, düğme, giriş alanı, summary, sekme) */
  clickable: number;
  /** <main> içinde görünen rozet ve kategori etiketi sayısı */
  badges: number;
  /** #tartisma bölümünün başladığı ekran (varsa; 1 = ilk ekran) */
  discussionScreen: number | null;
}

/** Sayfa ölçümü (annotation için; kesin beklenti değil). Gizli (hidden / display:none) öğeler sayılmaz. */
export function measurePage(page: Page): Promise<PageMetrics> {
  return page.evaluate(() => {
    const ih = window.innerHeight;
    const sh = document.documentElement.scrollHeight;
    const main = document.querySelector("main") ?? document.body;
    const visible = (el: Element) => (el as HTMLElement).checkVisibility?.() ?? (el as HTMLElement).getClientRects().length > 0;
    const count = (sel: string) => Array.from(main.querySelectorAll(sel)).filter(visible).length;
    const text = (main as HTMLElement).innerText ?? "";
    const disc = document.getElementById("tartisma");
    return {
      screens: Math.round((sh / ih) * 10) / 10,
      scrollHeight: sh,
      innerHeight: ih,
      words: text.split(/\s+/).filter(Boolean).length,
      clickable: count('a[href], button, input:not([type="hidden"]), select, textarea, summary, [role="tab"]'),
      badges: count(".badge, .cat-tag"),
      discussionScreen: disc ? Math.round(((disc.getBoundingClientRect().top + window.scrollY) / ih + 1) * 10) / 10 : null,
    };
  });
}

/** Ölçümü tek satır özet olarak yazar. */
export function describeMetrics(m: PageMetrics): string {
  const disc = m.discussionScreen !== null ? ` · tartışma ${String(m.discussionScreen).replace(".", ",")}. ekranda` : "";
  return `${String(m.screens).replace(".", ",")} ekran · ${m.words} kelime · ${m.clickable} tıklanabilir · ${m.badges} rozet/etiket${disc}`;
}

export interface ContrastIssue {
  /** Öğenin kısa tarifi (etiket.sınıflar) */
  element: string;
  text: string;
  ratio: number;
  /** Gereken en düşük oran (büyük metinde 3, diğerlerinde 4,5) */
  need: number;
  fg: string;
  bg: string;
}

/**
 * WCAG AA metin kontrastı taraması: `scope` içindeki, kendi metni olan görünür öğelerin yazı rengini, üstlerindeki yarı saydam
 * katmanlar birleştirilmiş arka planla karşılaştırır. Arka planı gradyan/görsel olan, devre dışı ve yalnız ekran okuyucuya açık
 * öğeler atlanır. Renkler tarayıcının kendisiyle (canvas) çözülür; color-mix() gibi biçimler de doğru işlenir.
 */
export function scanContrast(page: Page, scope = "main"): Promise<ContrastIssue[]> {
  return page.evaluate(async (scopeSel) => {
    // Süren geçişler (ör. düğme rengi) bitsin: yarı geçişte ölçülen renk yanlış kontrast verir.
    await Promise.all(document.getAnimations().map((a) => a.finished.catch(() => undefined)));
    const canvas = document.createElement("canvas");
    canvas.width = canvas.height = 1;
    const g = canvas.getContext("2d", { willReadFrequently: true })!;
    const rgba = (css: string): [number, number, number, number] => {
      g.clearRect(0, 0, 1, 1);
      g.fillStyle = "#000";
      g.fillStyle = css;
      g.fillRect(0, 0, 1, 1);
      const d = g.getImageData(0, 0, 1, 1).data;
      return [d[0], d[1], d[2], d[3] / 255];
    };
    const over = (top: number[], bottom: number[]): [number, number, number, number] => {
      const a = top[3] + bottom[3] * (1 - top[3]);
      if (a === 0) return [0, 0, 0, 0];
      return [0, 1, 2].map((i) => (top[i] * top[3] + bottom[i] * bottom[3] * (1 - top[3])) / a).concat(a) as [number, number, number, number];
    };
    const lum = (c: number[]) => {
      const f = (v: number) => {
        const s = v / 255;
        return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
      };
      return 0.2126 * f(c[0]) + 0.7152 * f(c[1]) + 0.0722 * f(c[2]);
    };
    const visible = (el: Element) => (el as HTMLElement).checkVisibility?.({ checkOpacity: true, checkVisibilityCSS: true }) ?? true;
    const describe = (el: Element) => {
      const cls = typeof (el as HTMLElement).className === "string" && (el as HTMLElement).className ? `.${(el as HTMLElement).className.trim().split(/\s+/).slice(0, 3).join(".")}` : "";
      return `${el.tagName.toLowerCase()}${cls}`;
    };
    const issues: { element: string; text: string; ratio: number; need: number; fg: string; bg: string }[] = [];
    const seen = new Set<string>();
    const root = document.querySelector(scopeSel) ?? document.body;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    for (let n = walker.nextNode(); n; n = walker.nextNode()) {
      const text = (n.textContent ?? "").replace(/\s+/g, " ").trim();
      const el = n.parentElement;
      if (!text || !el || !visible(el)) continue;
      if (el.closest("[disabled], [aria-disabled='true'], .sr-only, script, style, option")) continue;
      const r = el.getBoundingClientRect();
      if (r.width < 2 || r.height < 2) continue; // 1 px'lik sr-only kırpmaları
      const cs = getComputedStyle(el);
      // Arka plan: yukarı doğru yarı saydam katmanlar birleştirilir; gradyan/görsel varsa atla
      let bg: number[] = [0, 0, 0, 0];
      let skip = false;
      let opacity = 1;
      for (let a: Element | null = el; a; a = a.parentElement) {
        const s = getComputedStyle(a);
        opacity *= Number(s.opacity);
        if (s.backgroundImage && s.backgroundImage !== "none") {
          skip = true;
          break;
        }
        bg = over(bg, rgba(s.backgroundColor));
        if (bg[3] >= 0.999) break;
      }
      if (skip) continue;
      if (bg[3] < 0.999) bg = over(bg, [255, 255, 255, 1]); // kök saydamsa tarayıcı beyaz çizer
      const fgRaw = rgba(cs.color);
      const fg = over([fgRaw[0], fgRaw[1], fgRaw[2], fgRaw[3] * opacity], bg);
      const l1 = lum(fg);
      const l2 = lum(bg);
      const ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
      const px = parseFloat(cs.fontSize);
      const bold = Number(cs.fontWeight) >= 700;
      const large = px >= 24 || (bold && px >= 18.66);
      const need = large ? 3 : 4.5;
      if (ratio + 0.005 < need) {
        const key = `${describe(el)}|${text.slice(0, 30)}`;
        if (seen.has(key)) continue;
        seen.add(key);
        issues.push({ element: describe(el), text: text.slice(0, 60), ratio: Math.round(ratio * 100) / 100, need, fg: `rgb(${fg.slice(0, 3).map(Math.round).join(",")})`, bg: `rgb(${bg.slice(0, 3).map(Math.round).join(",")})` });
      }
    }
    return issues;
  }, scope);
}

// ───────────────────────────── Faz 3 yardımcıları ─────────────────────────────

/**
 * e2e'nin ayrılmış düğme/bağlantı/bölge adı parçaları (plan: 'Test sözleşmeleri'). Yeni düğme, bağlantı ve bölge adları bunları
 * İÇERMEZ (büyük/küçük harf ve Türkçe i/İ ayrımı gözetmeden).
 */
export const RESERVED_NAME_PARTS = ["Destekle", "Oyumu ver", "Daha fazla", "Sayımı kendim doğrulayayım", "Kapat", "Gerekçe", "Açıklama", "Azınlık raporu", "Düğüm"] as const;

/** Verilen adın içerdiği ayrılmış parçalar (boşsa ad güvenlidir). */
export function reservedParts(name: string): string[] {
  const low = name.toLocaleLowerCase("tr-TR");
  return RESERVED_NAME_PARTS.filter((r) => low.includes(r.toLocaleLowerCase("tr-TR")));
}

/** Yunan harfleri (τ, φ, ω, ρ, σ, μ, δ …): 'ilk okumada sembol yok' denetimi için. */
export const GREEK = /[Ͱ-Ͽ]/;

/** Türkiye'de yaz saati yoktur (UTC+3 sabit, 2016'dan beri): bildirim tarih gruplarının sınırları buradan hesaplanır. */
const TR_OFFSET_MS = 3 * 3_600_000;
const DAY_MS = 24 * 3_600_000;

/** Bildirimin tarih grubu (web/src/lib/notificationKinds.ts › ageGroupOf ile aynı kural, Europe/Istanbul takvimiyle). */
export function notificationGroupOf(createdAt: number, now: number): "Bugün" | "Bu hafta" | "Daha eski" {
  const startOfToday = Math.floor((now + TR_OFFSET_MS) / DAY_MS) * DAY_MS - TR_OFFSET_MS;
  if (createdAt >= startOfToday) return "Bugün";
  return createdAt >= startOfToday - 6 * DAY_MS ? "Bu hafta" : "Daha eski";
}
