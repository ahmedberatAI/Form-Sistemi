// Erişilebilirlik için stil sözleşmeleri (DOM'suz; styles.css metninden):
//  • 1.4.11 Metin dışı kontrast: metin alanı kenarı (--input-border) bitişik zeminlere karşı en az 3:1, üç tema bloğunda da.
//  • 1.4.3 Kontrast: 'yaşanmadı' evre etiketi opaklıkla soldurulmaz (yalnız süs noktası soluk).
//  • 2.4.7 Odak görünür: sekme paneli (tabIndex=0) klavye odağında çerçeve gösterir.
//  • 2.4.11 Odak gizlenmez: html scroll-padding yapışkan üst çubuğu (ve < 900 px'de alt gezinmeyi) hesaba katar.
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const css = readFileSync(new URL("../styles.css", import.meta.url), "utf8");

/** `selector {` ile başlayan (satır başında) ilk kuralın gövdesi; yoksa null. */
function rule(selector: string, from = 0): string | null {
  const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const m = new RegExp(`^\\s*${esc} \\{`, "m").exec(css.slice(from));
  if (!m) return null;
  const open = from + m.index + m[0].length - 1;
  let depth = 0;
  for (let i = open; i < css.length; i++) {
    if (css[i] === "{") depth++;
    else if (css[i] === "}" && --depth === 0) return css.slice(open + 1, i);
  }
  return null;
}

function blockAfter(from: number): string {
  const open = css.indexOf("{", from);
  let depth = 0;
  for (let i = open; i < css.length; i++) {
    if (css[i] === "{") depth++;
    else if (css[i] === "}" && --depth === 0) return css.slice(open + 1, i);
  }
  throw new Error("blok yok");
}
const decl = (block: string): Record<string, string> => Object.fromEntries([...block.matchAll(/--([\w-]+)\s*:\s*([^;]+);/g)].map((m) => [m[1], m[2].trim()]));
const ROOT = decl(blockAfter(css.search(/^:root \{/m)));
const DARK = decl(blockAfter(css.search(/^:root\[data-theme="dark"\] \{/m)));
const SYSTEM_DARK = decl(blockAfter(css.indexOf(":root:not(", css.indexOf("@media (prefers-color-scheme: dark)"))));
const THEMES = { açık: ROOT, "koyu (Ayarlar)": { ...ROOT, ...DARK }, "koyu (sistem)": { ...ROOT, ...SYSTEM_DARK } };

function lum(hex: string): number {
  const h = hex.replace("#", "");
  const f = (v: number) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(h.slice(i, i + 2), 16) / 255);
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}
const contrast = (a: string, b: string) => {
  const [l1, l2] = [lum(a), lum(b)];
  return (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
};

describe("1.4.11: metin alanı kenarı", () => {
  it(".input kenarını --input-border ile çizer (ayırıcı --border-strong ile değil)", () => {
    const input = rule(".input");
    expect(input).toContain("border: 1px solid var(--input-border)");
  });

  for (const [name, vars] of Object.entries(THEMES)) {
    it(`${name}: --input-border kart, sayfa ve ikincil zemine karşı en az 3:1`, () => {
      const border = vars["input-border"];
      expect(border, "--input-border tanımlı").toMatch(/^#[0-9a-f]{6}$/i);
      for (const bg of ["surface", "bg", "surface-2"]) {
        expect(contrast(border, vars[bg]), `--input-border / --${bg}`).toBeGreaterThanOrEqual(3);
      }
    });
  }
});

describe("1.4.3: 'yaşanmadı' evre etiketi soldurulmaz", () => {
  it(".phase-skipped ve noktası opaklık taşımaz (noktadaki evre numarası da metindir)", () => {
    const skipped = rule(".phase-skipped");
    expect(skipped).not.toBeNull();
    expect(skipped).not.toMatch(/opacity/);
    expect(skipped).toContain("line-through");
    // Eski hata (e2e kontrast taraması, #K-23): soluk nokta, içindeki "2"/"3" numarasını 2,3:1'e düşürüyordu.
    const dot = rule(".phase-skipped .phase-dot");
    expect(dot).not.toBeNull();
    expect(dot).not.toMatch(/opacity/);
    expect(dot).toMatch(/background:\s*transparent/);
    expect(dot).toMatch(/color:\s*var\(--text-muted\)/);
  });

  for (const [name, vars] of Object.entries(THEMES)) {
    it(`${name}: yaşanmadı evresinin numarası ve etiketi (--text-muted) pil zemininde (--surface) en az 4,5:1`, () => {
      expect(contrast(vars["text-muted"], vars.surface)).toBeGreaterThanOrEqual(4.5);
    });
  }

  it("sıradaki doğrulama adımı (.vstep-idle) da opaklıkla soldurulmaz", () => {
    expect(rule(".vstep-idle")).not.toMatch(/opacity/);
  });
});

describe("2.4.7: sekme paneli odak göstergesi", () => {
  it("panelin temel kuralı çerçeveyi kaldırmaz; :focus-visible görünür çerçeve çizer", () => {
    expect(rule(".tab-panel")).not.toMatch(/outline\s*:\s*none/);
    expect(rule(".tab-panel:focus-visible")).toMatch(/outline:\s*3px solid var\(--focus\)/);
  });
});

describe("2.4.11: odak yapışkan çubukların altında kalmaz", () => {
  it("html scroll-padding-top üst çubuğun yüksekliğini (--sticky-h) içerir", () => {
    const html = rule("html");
    expect(html).toMatch(/scroll-padding-top:\s*calc\(var\(--sticky-h\)/);
  });

  it("alt gezinmenin göründüğü genişlikte (< 900 px) scroll-padding-bottom alt gezinmeyi içerir", () => {
    const at = css.indexOf("@media (max-width: 899.98px)");
    expect(at).toBeGreaterThan(-1);
    const block = blockAfter(at);
    expect(block).toMatch(/scroll-padding-bottom:\s*calc\(var\(--bottom-nav-h\)/);
    // alt gezinme 900 px ve üstünde gizlidir: aynı eşik
    expect(css).toMatch(/@media \(min-width: 900px\) \{[^}]*:root \{\s*--nav-h/);
  });
});
