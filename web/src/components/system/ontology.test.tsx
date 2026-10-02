// Keşif sayfalarının açıklayıcıları ve Yönetmelik › Maddeler bölümleri: sayfa başına tek cümle özet + kapalı açılır,
// bölüm başına yerel <details> (ilk bölüm açık; 'tam' kipte hepsi açık), metin DOM'da tam kalır. Sunucu tarafı çizimle denetlenir.
import type { ArticleInfo } from "@forum/shared";
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it } from "vitest";
import { DetailLevelProvider } from "../../lib/detailLevel";
import { PREF_KEYS, removePref, setPrefSync } from "../../lib/prefs";
import { LedgerExplainer } from "./ledger";
import { ArticlesView, ModelExplainer, partDefaultOpen } from "./ontology";

const article = (n: number, part: string | undefined, protection: ArticleInfo["protection"] = "Olagan"): ArticleInfo => ({
  iri: `https://forum.example/yonetmelik#Madde${n}`,
  number: `Madde ${n}`,
  title: `Başlık ${n}`,
  text: `Metin ${n}`,
  protection,
  part,
});

const ARTICLES = [article(1, "Birinci Bölüm"), article(2, "Birinci Bölüm", "Nitelikli"), article(3, "İkinci Bölüm"), article(4, undefined, "Degistirilemez")];

const render = (el: React.ReactElement) => renderToStaticMarkup(<DetailLevelProvider>{el}</DetailLevelProvider>);
const detailsTags = (html: string) => html.match(/<details[^>]*>/g) ?? [];

describe("Yönetmelik › Maddeler: bölüm başına yerel details", () => {
  beforeEach(async () => {
    await removePref(PREF_KEYS.detail);
  });

  it("varsayılan açıklık: ilk bölüm açık ya da arama/süzgeç varken hepsi açık; diğerleri yoğunluğa uyar", () => {
    expect(partDefaultOpen(0, false)).toBe(true);
    expect(partDefaultOpen(1, false)).toBeUndefined();
    expect(partDefaultOpen(5, false)).toBeUndefined();
    for (const i of [0, 1, 5]) expect(partDefaultOpen(i, true)).toBe(true);
  });

  it("sade kipte yalnız ilk bölüm açık; sayılar özet satırında; bütün maddeler DOM'da", () => {
    const html = render(<ArticlesView articles={ARTICLES} />);
    const tags = detailsTags(html);
    expect(tags).toHaveLength(3); // Birinci, İkinci, Diğer hükümler
    expect(tags[0]).toContain(" open");
    expect(tags[1]).not.toContain(" open");
    expect(tags[2]).not.toContain(" open");
    expect(html).toContain('<span class="details-summary-text">Birinci Bölüm</span><span class="details-meta">2 fıkra</span>');
    expect(html).toContain('<span class="details-summary-text">Diğer hükümler</span><span class="details-meta">1 fıkra</span>');
    for (let n = 1; n <= 4; n++) expect(html).toContain(`Metin ${n}`);
  });

  it("'tam' kipte bütün bölümler açık gelir", () => {
    setPrefSync(PREF_KEYS.detail, "tam");
    const tags = detailsTags(render(<ArticlesView articles={ARTICLES} />));
    expect(tags).toHaveLength(3);
    for (const t of tags) expect(t).toContain(" open");
  });

  it("koruma düzeyi sayıları ve arama/süzgeç denetimleri yerinde kalır", () => {
    const html = render(<ArticlesView articles={ARTICLES} />);
    expect(html).toContain("Maddelerde ara");
    expect(html).toContain("Koruma düzeyi");
    // Rozet satırı: Olağan 2 (Madde 1 ve 3), Nitelikli 1, Değiştirilemez 1
    expect(html.match(/<span class="small muted">(\d+) fıkra<\/span>/g)).toEqual([
      '<span class="small muted">1 fıkra</span>',
      '<span class="small muted">1 fıkra</span>',
      '<span class="small muted">2 fıkra</span>',
    ]);
  });

  it("madde yoksa bölüm kutusu çizilmez", () => {
    const html = render(<ArticlesView articles={[]} />);
    expect(detailsTags(html)).toHaveLength(0);
    expect(html).toContain("Eşleşen madde yok");
  });
});

describe("açıklayıcılar: tek cümle özet + kapalı 'Bu sayfa ne gösteriyor?'", () => {
  beforeEach(async () => {
    await removePref(PREF_KEYS.detail);
  });

  it("Defter: sade kipte kapalı, içerik DOM'da tam, sekme (tablist) içermez", () => {
    const html = render(<LedgerExplainer />);
    expect(detailsTags(html)).toEqual(['<details class="details">']);
    expect(html).toContain("<summary>Bu sayfa ne gösteriyor?</summary>");
    expect(html).toContain("Defterde ne var, ne yok?");
    expect(html).toContain("SHA-256(tuz ‖ metin)");
    expect(html).toContain("siyasi seçim için değildir");
    expect(html).not.toContain("tablist");
  });

  it("Yönetmelik: sade kipte kapalı, altı madde DOM'da, sekme (tablist) içermez", () => {
    const html = render(<ModelExplainer />);
    expect(detailsTags(html)).toEqual(['<details class="details">']);
    expect(html).toContain("Yönetmelik nasıl çalışır?");
    expect(html.match(/<li>/g)).toHaveLength(6);
    expect(html).not.toContain("tablist");
  });

  it("'tam' kipte açıklayıcılar açık gelir", () => {
    setPrefSync(PREF_KEYS.detail, "tam");
    expect(detailsTags(render(<LedgerExplainer />))).toEqual(['<details class="details" open="">']);
    expect(detailsTags(render(<ModelExplainer />))).toEqual(['<details class="details" open="">']);
  });

  it("yeni adlar e2e sözleşmesindeki düğme/bölge adlarıyla çakışmaz", () => {
    const html = render(
      <>
        <LedgerExplainer />
        <ModelExplainer />
      </>,
    );
    const summary = html.match(/<summary>([^<]*)<\/summary>/g) ?? [];
    expect(summary).toEqual(["<summary>Bu sayfa ne gösteriyor?</summary>", "<summary>Bu sayfa ne gösteriyor?</summary>"]);
    for (const banned of ["Destekle", "Oyumu ver", "Daha fazla", "Sayımı kendim doğrulayayım", "Kapat"]) {
      for (const s of summary) expect(s).not.toContain(banned);
    }
  });
});
