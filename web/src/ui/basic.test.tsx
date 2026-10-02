// Card ve Details: yeni isteğe bağlı prop'lar yokken işaretleme bugünküyle aynıdır; katlanabilir kart WAI-ARIA
// akordeon desenini (h2 > button[aria-expanded][aria-controls]) ve 'tam' kipte açık gelmeyi sağlar. Sunucu tarafı
// çizimle denetlenir (DOM gerekmez).
import { renderToStaticMarkup } from "react-dom/server";
import { beforeEach, describe, expect, it } from "vitest";
import { DetailLevelProvider } from "../lib/detailLevel";
import { PREF_KEYS, removePref, setPrefSync } from "../lib/prefs";
import { Card, Details } from "./basic";

/** useId çıktılarını (_R_…_) sıra numarasıyla değiştirir; elle verilen id'lere dokunmaz. */
function normalize(html: string): string {
  const ids = new Map<string, string>();
  return html.replace(/(id|aria-labelledby|aria-controls|aria-describedby)="(_R_[^"]*)"/g, (_m, attr: string, v: string) => {
    if (!ids.has(v)) ids.set(v, `#${ids.size + 1}`);
    return `${attr}="${ids.get(v)}"`;
  });
}

const render = (el: React.ReactElement) => normalize(renderToStaticMarkup(el));

describe("Card: yeni prop'lar yokken bugünkü işaretleme", () => {
  it("başlık, alt başlık, eylemler ve altlıkla birebir aynı", () => {
    const html = render(
      <Card title="Başlık" subtitle="Alt" actions={<b>x</b>} footer="f">
        gövde
      </Card>,
    );
    expect(html).toBe(
      '<section class="card" aria-labelledby="#1"><header class="card-header"><div class="card-heading"><h2 class="card-title" id="#1">Başlık</h2><p class="card-subtitle">Alt</p></div><div class="card-actions"><b>x</b></div></header><div class="card-body">gövde</div><footer class="card-footer">f</footer></section>',
    );
  });

  it("tone, headingLevel ve id aynen çalışır; başlıksız kart bölge adı taşımaz", () => {
    expect(render(<Card title="T" tone="warning" headingLevel={3} id="x">a</Card>)).toBe(
      '<section class="card card-warning" id="x" aria-labelledby="#1"><header class="card-header"><div class="card-heading"><h3 class="card-title" id="#1">T</h3></div></header><div class="card-body">a</div></section>',
    );
    expect(render(<Card>a</Card>)).toBe('<section class="card"><div class="card-body">a</div></section>');
  });

  it("collapsible olmayan kartta summary başlığın dışında, anchor id olur", () => {
    const html = render(
      <Card title="T" summary="hüküm" anchor="ontoloji">
        a
      </Card>,
    );
    expect(html).toContain('id="ontoloji"');
    expect(html).toContain('<h2 class="card-title" id="#1">T</h2><p class="card-summary">hüküm</p>');
    expect(html).not.toContain("<button");
  });
});

describe("Card collapsible", () => {
  beforeEach(async () => {
    await removePref(PREF_KEYS.detail);
  });

  it("sade kipte kapalı: başlık düğmesi aria-expanded=false, gövde hidden ve DOM'da", () => {
    const html = render(
      <Card title="Ontoloji denetimi" collapsible summary="✔ Uygun · 1 uyarı" subtitle="açıklama" actions={<i>rozet</i>} footer="alt" anchor="ontoloji">
        <span>içerik</span>
      </Card>,
    );
    // Bölge adı yine başlık metnidir: section aria-labelledby → h2; düğme h2'nin İÇİNDE.
    expect(html).toContain('<section class="card card-collapsible" id="ontoloji" aria-labelledby="#1">');
    expect(html).toContain('<h2 class="card-title" id="#1"><button type="button" class="card-toggle" aria-expanded="false" aria-controls="#2" aria-describedby="#3">Ontoloji denetimi</button></h2>');
    // Hüküm başlığın dışında, düğmeye aria-describedby ile bağlı
    expect(html).toContain('<p class="card-summary" id="#3">✔ Uygun · 1 uyarı</p>');
    expect(html.indexOf("</h2>")).toBeLessThan(html.indexOf('class="card-summary"'));
    // actions her zaman görünür (gizli gövdenin dışında)
    expect(html).toContain('<div class="card-actions"><i>rozet</i></div>');
    // gövde ve altlık gizli ama bağlı; alt başlık gövdenin içinde
    expect(html).toContain('<div class="card-body" id="#2" hidden="">');
    expect(html).toContain('<p class="card-subtitle card-subtitle-body">açıklama</p><span>içerik</span>');
    expect(html).toContain('<footer class="card-footer" hidden="">alt</footer>');
  });

  it("defaultOpen açık başlatır (sorun varsa kendiliğinden açık)", () => {
    const html = render(
      <Card title="T" collapsible defaultOpen>
        a
      </Card>,
    );
    expect(html).toContain('aria-expanded="true"');
    expect(html).toContain("is-open");
    expect(html).not.toContain("hidden");
  });

  it("defaultOpen=false 'tam' kipte de kapalı kalır", () => {
    setPrefSync(PREF_KEYS.detail, "tam");
    const html = render(
      <DetailLevelProvider>
        <Card title="T" collapsible defaultOpen={false}>
          a
        </Card>
      </DetailLevelProvider>,
    );
    expect(html).toContain('aria-expanded="false"');
  });

  it("'tam' kipte defaultOpen verilmemiş kart açık gelir; openInFull=false olan gelmez", () => {
    setPrefSync(PREF_KEYS.detail, "tam");
    const html = render(
      <DetailLevelProvider>
        <Card title="A" collapsible>
          a
        </Card>
        <Card title="B" collapsible openInFull={false}>
          b
        </Card>
      </DetailLevelProvider>,
    );
    expect(html.match(/aria-expanded="true"/g)).toHaveLength(1);
    expect(html.match(/aria-expanded="false"/g)).toHaveLength(1);
  });

  it("başlıksız collapsible düz karta düşer (tıklanacak bir şey yok)", () => {
    expect(render(<Card collapsible>a</Card>)).toBe('<section class="card"><div class="card-body">a</div></section>');
  });
});

describe("Details", () => {
  beforeEach(async () => {
    await removePref(PREF_KEYS.detail);
  });

  it("yeni prop'lar yokken bugünkü işaretleme", () => {
    expect(render(<Details summary="S">c</Details>)).toBe('<details class="details"><summary>S</summary><div class="details-body">c</div></details>');
    expect(render(<Details summary="S" open className="x">c</Details>)).toBe('<details class="details x" open=""><summary>S</summary><div class="details-body">c</div></details>');
  });

  it("meta özetin sağında ayrı bir öğedir; id çapa olur", () => {
    const html = render(
      <Details summary="Kura kayıtları" meta="3" id="kura">
        c
      </Details>,
    );
    expect(html).toBe(
      '<details class="details" id="kura"><summary class="details-has-meta"><span class="details-summary-text">Kura kayıtları</span><span class="details-meta">3</span></summary><div class="details-body">c</div></details>',
    );
  });

  it("'tam' kipte açık gelir; açık değer ve openInFull=false bunu ezer", () => {
    setPrefSync(PREF_KEYS.detail, "tam");
    const html = render(
      <DetailLevelProvider>
        <Details summary="A">a</Details>
        <Details summary="B" open={false}>
          b
        </Details>
        <Details summary="C" openInFull={false}>
          c
        </Details>
      </DetailLevelProvider>,
    );
    expect(html.match(/<details[^>]*>/g)).toEqual(['<details class="details" open="">', '<details class="details">', '<details class="details">']);
  });
});
