// Sade dil (Faz 3 / madde 2): ParamsCard satırları sade adla başlar, Yunan sembolleri ve formüller 'Sembolleri ve formülleri göster'
// anahtarının arkasındadır ('Tam' görünümde açık); ResultsCard kontrol satırları ve VerifyTallyPanel girişi sözlük terimi taşır;
// e2e'nin dayandığı metin ve düğme adları değişmez. Sunucu tarafı çizimle denetlenir (DOM gerekmez).
import type { DecisionCheck, DecisionParams, DecisionResult } from "@forum/shared";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DetailLevelProvider } from "../../lib/detailLevel";
import { findTerm, getTerm } from "../../lib/glossary";
import { PREF_KEYS, removePref, setPrefSync } from "../../lib/prefs";
import { ToastProvider } from "../../ui/Toast";
import { paramRows, ParamsCard, ParamsList, SYMBOLS_SWITCH_LABEL, symbolCount, toKeyValueItem } from "./ParamsCard";
import { ResultsCard } from "./ResultsCard";
import { VerifyTallyPanel } from "./VerifyTallyPanel";

vi.mock("../../auth/AuthContext", () => ({
  useAuth: () => ({ can: () => true, user: null, now: () => Date.UTC(2026, 9, 3) }),
  useServerNow: () => () => Date.UTC(2026, 9, 3),
}));

const R = (num: number, den: number) => ({ num, den });
const params = {
  tier: "T1",
  quorum: R(3, 10),
  threshold: R(3, 5),
  thresholdStrict: false,
  clusterFloor: R(2, 5),
  authorClusterFloor: null,
  overrideThreshold: R(2, 3),
  revoteThreshold: R(3, 5),
  significantShare: R(1, 10),
  significantMinMembers: 3,
  minVotesPerCluster: 2,
  minClusteredForBridge: 12,
  coldStartBump: R(1, 10),
  delegationCapFraction: R(1, 20),
  delegationMaxHops: 3,
  sponsorsRequired: 3,
  requiresExpert: true,
  expertCount: 3,
  expertDomains: [],
  durationsHours: { sponsoring: 168, deliberation: 96, voting: 96, extension: 24, objection: 72, reconciliation: 120 },
} as unknown as DecisionParams;

const render = (el: React.ReactElement) =>
  renderToStaticMarkup(
    <DetailLevelProvider>
      <ToastProvider>
        <MemoryRouter>{el}</MemoryRouter>
      </ToastProvider>
    </DetailLevelProvider>,
  );

/** Etiketleri (ve içlerindeki öznitelikleri) atar, HTML varlıklarını çözer: görünen düz metin. */
const text = (html: string) =>
  html
    .replace(/<[^>]*>/g, "")
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&");
const GREEK = /[α-ωΑ-Ω]/;
const buttonsOf = (html: string) => [...html.matchAll(/<button\b([^>]*)>([\s\S]*?)<\/button>/g)].map((m) => ({ attrs: m[1], text: text(m[2]) }));
const FORBIDDEN = ["Destekle", "Oyumu ver", "Daha fazla", "Sayımı kendim doğrulayayım", "Kapat", "Gerekçe", "Açıklama", "Azınlık raporu", "Düğüm"];

describe("ParamsCard satırları (saf)", () => {
  const rows = paramRows(params);

  it("etiketler sade ad: Yunan harfi ya da formül içermez; sembol ayrı alandadır", () => {
    for (const r of rows) {
      expect(r.label, r.key).not.toMatch(GREEK);
      expect(r.label, r.key).not.toMatch(/[⌈⌉√·]|_/);
      expect(r.value ?? "", r.key).not.toMatch(GREEK);
      expect(r.hint ?? "", r.key).not.toMatch(GREEK);
      expect(r.hint ?? "", r.key).not.toMatch(/[⌈⌉√]/);
    }
    // sade adlar korunur (e2e: 'Gerekli destekçi' metni)
    expect(rows.map((r) => r.label)).toEqual(
      expect.arrayContaining(["Katman", "Yeter sayı", "Onay eşiği", "Küme tabanı", "Aşma eşiği", "Yeniden oy eşiği", "Gerekli destekçi", "Bilirkişi"]),
    );
  });

  it("semboller etiketten ayrılmıştır ve doğru terimle eşleşir (τ onay eşiği, φ küme tabanı …)", () => {
    const by = Object.fromEntries(rows.map((r) => [r.key, r]));
    expect(by.threshold).toMatchObject({ symbol: "τ", term: "onay-esigi" });
    expect(by.clusterFloor).toMatchObject({ symbol: "φ", term: "kume-tabani" });
    expect(by.override).toMatchObject({ symbol: "ω", term: "asma-esigi" });
    expect(by.revote).toMatchObject({ symbol: "ρ", term: "yeniden-oy-esigi" });
    expect(by.quorum).toMatchObject({ symbol: "q", term: "yeter-sayi" });
    expect(by.sponsors).toMatchObject({ symbol: "K_s", term: "gerekli-destekci" });
    expect(by.minClustered.symbol).toBe("n_C,min");
    // satırın sembolü, terimin sözlükteki sembolüyle aynı (n_C,min soğuk başlangıç terimine ek bir ölçüdür, ayrı sayılır)
    for (const key of ["quorum", "threshold", "clusterFloor", "override", "revote", "significant", "minVotes", "coldStart", "delegationHops", "sponsors"]) {
      expect(by[key].symbol, key).toBe(getTerm(by[key].term!).symbol);
    }
  });

  it("her satırın terimi sözlükte var; yaklaşık 15 sembol/formül anahtarın arkasına girer", () => {
    for (const r of rows) if (r.term) expect(findTerm(r.term), r.key).toBeDefined();
    const { symbols, formulas } = symbolCount(rows);
    expect(symbols).toBeGreaterThanOrEqual(10);
    expect(formulas).toBeGreaterThanOrEqual(2);
    expect(rows.filter((r) => r.symbol || r.formula).length).toBeGreaterThanOrEqual(10);
  });

  it("yazarın grubu tabanı yalnız silme kararında (authorClusterFloor) çıkar; bilirkişi alanları etiketle yazılır", () => {
    expect(rows.some((r) => r.key === "authorClusterFloor")).toBe(false);
    const del = paramRows({ ...params, authorClusterFloor: R(1, 2) } as DecisionParams);
    const author = del.find((r) => r.key === "authorClusterFloor")!;
    expect(author.value).toBe("%50");
    expect(author.formula).toBe("Yazarın görüş grubunda P_g ≥ %50");
    const withDomains = paramRows({ ...params, expertDomains: ["a", "b"] } as DecisionParams, (iri) => iri.toUpperCase());
    expect(withDomains.find((r) => r.key === "expert")!.hint).toBe("Alanlar: A, B");
  });

  it("vekâlet sınırının formülü değerde değil, anahtarın arkasında", () => {
    const cap = rows.find((r) => r.key === "delegationCap")!;
    expect(cap.value).toBe("uygun seçmenin %5 oranı (en az 2 oy)");
    expect(cap.formula).toBe("max(2, ⌈%5 · |E|⌉)");
  });

  it("toKeyValueItem: anahtar kapalıyken sembol ve formül yok, açıkken sembol değerin yanında, formül ipucunun altında", () => {
    const threshold = rows.find((r) => r.key === "threshold")!;
    const cluster = rows.find((r) => r.key === "clusterFloor")!;
    const closed = toKeyValueItem(threshold, false, "T1");
    const open = toKeyValueItem(threshold, true, "T1");
    expect(text(renderToStaticMarkup(<>{closed.value}</>))).toBe("≥ %60");
    expect(text(renderToStaticMarkup(<>{open.value}</>))).toBe("≥ %60 (τ)");
    expect(toKeyValueItem(cluster, false, "T1").hint).toBeDefined(); // sade ipucu her zaman
    expect(text(renderToStaticMarkup(<>{toKeyValueItem(cluster, false, "T1").hint}</>))).not.toContain("P_g");
    expect(text(renderToStaticMarkup(<>{toKeyValueItem(cluster, true, "T1").hint}</>))).toContain("P_g ≥ φ");
    // ipucu ve formülü olmayan satır: hint yok
    expect(toKeyValueItem(rows.find((r) => r.key === "minClustered")!, false, "T1").hint).toBeUndefined();
  });
});

describe("ParamsCard (çizim)", () => {
  beforeEach(async () => {
    await removePref(PREF_KEYS.detail);
  });

  const card = () => <ParamsCard params={params} status="voting" votingRound={1} eligible={100} />;

  it("sade görünümde (kart gövdesi DOM'da) Yunan sembolü ve formül yok; anahtar kapalı", () => {
    const html = render(card());
    const body = text(html);
    expect(body).not.toMatch(GREEK);
    expect(body).not.toMatch(/[⌈⌉√]/);
    expect(body).not.toContain("|E|");
    expect(html).toMatch(/<button[^>]*role="switch"[^>]*aria-checked="false"/);
    expect(body).toContain(SYMBOLS_SWITCH_LABEL);
    // sade adlar ve değerler görünür (e2e: 'Gerekli destekçi')
    expect(body).toContain("Gerekli destekçi");
    expect(body).toContain("Onay eşiği");
    expect(body).toContain("≥ %60");
  });

  it("'Tam' görünümde anahtar açık gelir: semboller değerin yanında, formüller ve açıklama satırı görünür", () => {
    setPrefSync(PREF_KEYS.detail, "tam");
    const html = render(card());
    const body = text(html);
    expect(html).toMatch(/<button[^>]*role="switch"[^>]*aria-checked="true"/);
    for (const symbol of ["(τ)", "(φ)", "(ω)", "(ρ)", "(q)", "(K_s)", "(n_C,min)", "(σ)", "(μ)", "(δ)", "(H)"]) expect(body, symbol).toContain(symbol);
    expect(body).toContain("max(⌈q·|E|⌉, ⌈1,5·√|E|⌉), en fazla |E|");
    expect(body).toContain("P_g ≥ φ");
    expect(body).toContain("|E|: oylamadaki uygun seçmen sayısı");
  });

  it("etiketler sözlük terimi: dokunulabilir terim düğmeleri; katman rozeti açıklamalı", () => {
    const html = render(card());
    const terms = buttonsOf(html).filter((b) => b.attrs.includes('class="term"'));
    const labels = terms.map((b) => b.text);
    for (const l of ["Katman", "Yeter sayı", "Onay eşiği", "Küme tabanı", "Aşma eşiği", "Gerekli destekçi", "Bilirkişi"]) expect(labels, l).toContain(l);
    expect(terms.length).toBeGreaterThanOrEqual(14);
    for (const t of terms) expect(t.attrs).toContain('aria-haspopup="dialog"');
    const tier = buttonsOf(html).find((b) => b.attrs.includes("term-badge"))!;
    expect(tier.text).toBe("T1 · Nitelikli karar");
  });

  it("e2e sözleşmesi: bölge adı, kapalı başlık, hüküm ve çapa aynen; düğme adları yasak alt dizeleri içermez", () => {
    const html = render(card());
    expect(html).toContain('id="parametreler"');
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain("yeter sayı: en az 30 kişi (uygun seçmen oranı %30)");
    const names = [...buttonsOf(html).map((b) => b.text), ...[...html.matchAll(/aria-label="([^"]*)"/g)].map((m) => m[1])];
    for (const bad of FORBIDDEN) expect(names.filter((n) => n.toLocaleLowerCase("tr-TR").includes(bad.toLocaleLowerCase("tr-TR")))).toEqual([]);
    // kart başlığı düz metin: terim düğmesi başlığın içine girmez
    expect(html).toMatch(/<h[23][^>]*class="card-title"[^>]*><button[^>]*class="card-toggle"[^>]*>Karar parametreleri<\/button><\/h[23]>/);
  });

  it("ParamsList kartsız da kullanılır (ön denetim paneli): anahtar + satırlar, sade kipte semboller yok", () => {
    const html = render(<ParamsList params={params} />);
    expect(html).not.toContain("card-toggle");
    expect(html).toMatch(/role="switch"[^>]*aria-checked="false"/);
    expect(text(html)).not.toMatch(GREEK);
    expect(buttonsOf(html).filter((b) => b.attrs.includes('class="term"')).length).toBeGreaterThanOrEqual(14);
    setPrefSync(PREF_KEYS.detail, "tam");
    expect(text(render(<ParamsList params={params} />))).toContain("(τ)");
  });

  it("parametre yokken düz kart ve düğme yok", () => {
    expect(render(<ParamsCard params={null} status="draft" votingRound={0} />)).not.toContain("<button");
  });

  it("e2e: kanıt sütununda 'button.card-toggle' sayısı terim ve anahtar düğmelerinden etkilenmez", () => {
    const html = render(card());
    expect((html.match(/class="card-toggle"/g) ?? []).length).toBe(1);
    expect(html).not.toMatch(/<button[^>]*class="(?:term|param-switch)[^"]*card-toggle/);
  });
});

// ───────────── ResultsCard ve VerifyTallyPanel ─────────────

const check = (key: string, label: string, over: Partial<DecisionCheck> = {}): DecisionCheck => ({ key, label, passed: true, value: "41/57", required: "≥ 12", detail: `${key} açıklaması`, ...over });
const cluster = (id: string, over = {}) => ({ clusterId: id, label: `Görüş Grubu ${id.toUpperCase()}`, members: 10, significant: true, yes: 7, no: 2, abstain: 1, voted: 10, pg: 0.73, floor: 0.4, passed: true, ...over });
const result = (over: Partial<DecisionResult> = {}): DecisionResult =>
  ({
    algoVersion: "KC-1.0",
    round: 1,
    outcome: "accept",
    totals: { eligible: 57, participants: 41, yes: 30, no: 8, abstain: 3, delegated: 4, unrouted: 1 },
    approval: 30 / 38,
    quorumRequired: 12,
    thresholdUsed: R(3, 5),
    thresholdStrict: false,
    quorumMet: true,
    thresholdMet: true,
    bridgeApplicable: true,
    bridgeMet: true,
    overrideMet: null,
    gac: 0.71,
    clusters: [cluster("g0"), cluster("g1")],
    checks: [check("quorum", "Katılım (yeter sayı)"), check("threshold", "Onay oranı"), check("bridge:g0", "A desteği (köprü testi)"), check("bridge:g1", "B desteği (köprü testi)")],
    reason: "Genel onay ve köprü desteği sağlandı.",
    inputsHash: "ab".repeat(32),
    computedAt: Date.UTC(2026, 9, 3),
    ...over,
  }) as DecisionResult;

describe("ResultsCard: kontrol satırları sözlük terimi", () => {
  beforeEach(async () => {
    await removePref(PREF_KEYS.detail);
  });

  const whyOf = (html: string) => html.slice(html.indexOf('aria-label="Neden bu sonuç?"'), html.indexOf("Görüş grupları ve köprü testi"));

  it("geçen kontroller rozet: sunucu etiketi aynen, tamamı terim düğmesi; birleşik köprü rozeti de", () => {
    const why = whyOf(render(<ResultsCard result={result()} />));
    const labels = buttonsOf(why).map((b) => b.text);
    expect(labels).toEqual(["Katılım (yeter sayı)", "Onay oranı", "Köprü testi: 2 grup tabanı aştı"]);
    expect(why).toContain("Köprü testi: 2 grup tabanı aştı"); // metin bitişik kalır
    expect(why.match(/class="why-chip why-ok"/g)).toHaveLength(3);
  });

  it("başarısız kontrol tam satır: terim düğmesi <strong> içinde, değer ve 'gerekli' yanında; açıklama metni değişmez", () => {
    const failing = result({ checks: [check("threshold", "Onay oranı", { passed: false, value: "%50", required: "≥ %60", detail: "eşik açıklaması" })], outcome: "reject" });
    const why = whyOf(render(<ResultsCard result={failing} />));
    expect(why).toMatch(/<strong><button[^>]*class="term"[^>]*>Onay oranı<\/button><\/strong>: %50/);
    expect(text(why)).toContain("(gerekli ≥ %60)");
    expect(text(why)).toContain("eşik açıklaması");
  });

  it("tanınmayan kontrol anahtarı düz metin kalır; 'Kontrol ayrıntıları' listesine terim girmez", () => {
    const html = render(<ResultsCard result={result({ checks: [check("quorum", "Q"), check("recount_error", "Bağımsız yeniden sayım")] })} />);
    const why = whyOf(html);
    expect(buttonsOf(why).map((b) => b.text)).toEqual(["Q"]);
    expect(text(why)).toContain("Bağımsız yeniden sayım");
    const details = html.slice(html.indexOf("Kontrol ayrıntıları"), html.indexOf("Görüş grupları ve köprü testi"));
    expect(details).not.toContain('class="term"');
    expect(details).toContain("<strong>Q:</strong>");
  });

  it("P_g, GAC ve 'girdi özeti' açıklanır; görüş grupları özeti (Details başlığı) düz metin kalır", () => {
    const html = render(<ResultsCard result={result()} />);
    const summary = html.slice(html.indexOf("<summary", html.indexOf("result-bridge")), html.indexOf("</summary>", html.indexOf("result-bridge")));
    expect(summary).not.toContain("<button");
    const labels = buttonsOf(html).filter((b) => b.attrs.includes('class="term"')).map((b) => b.text);
    expect(labels).toEqual(expect.arrayContaining(["P_g", "Grup bilgili uzlaşı (GAC)", "girdi özeti"]));
    expect(html).toContain("boykot bir engel aracı değildir");
    expect(text(html)).toContain("girdi özeti ");
  });

  it("köprü açılırının içinde terimin günlük karşılığı görünür metin olarak yazılır (başlıkta değil)", () => {
    const html = render(<ResultsCard result={result()} />);
    const section = html.slice(html.indexOf('aria-label="Görüş grupları"'));
    const first = section.slice(section.indexOf("<p"), section.indexOf("</p>") + 4);
    expect(text(first)).toBe(`Köprü testi — ${getTerm("kopru-testi").plain}.`);
    const summary = html.slice(html.indexOf("<summary", html.indexOf("result-bridge")), html.indexOf("</summary>", html.indexOf("result-bridge")));
    expect(summary).toContain("Görüş grupları ve köprü testi");
    expect(summary).not.toContain("<button");
  });

  it("e2e sözleşmesi: yasak alt dizeler düğme/bölge adlarında yok", () => {
    const html = render(<ResultsCard result={result()} />);
    const names = [...buttonsOf(html).map((b) => b.text), ...[...html.matchAll(/aria-label="([^"]*)"/g)].map((m) => m[1])];
    for (const bad of FORBIDDEN) expect(names.filter((n) => n.toLocaleLowerCase("tr-TR").includes(bad.toLocaleLowerCase("tr-TR")) && n !== "Azınlık raporları")).toEqual([]);
  });
});

describe("VerifyTallyPanel: 'Neyi denetler?' sözlük terimi", () => {
  beforeEach(async () => {
    await removePref(PREF_KEYS.detail);
  });

  const html = () => render(<VerifyTallyPanel proposalId="p1" results={[result()]} />);

  it("terimler yalnız 'Neyi denetler?' girişinde; düğmeden önceki tek cümle ve ilk düğme aynen", () => {
    const h = html();
    const firstButton = h.indexOf("<button");
    expect(h.slice(0, firstButton)).not.toContain('class="term"');
    expect(h.slice(firstButton, h.indexOf("</button>", firstButton))).toContain("Sayımı kendim doğrulayayım");
    const intro = h.slice(h.indexOf("Neyi denetler?"));
    const terms = buttonsOf(intro).filter((b) => b.attrs.includes('class="term"')).map((b) => b.text);
    expect(terms).toEqual(["Defterdeki", "taahhüdüyle"]);
    expect(text(intro)).toContain("Defterdeki oy açıklamaları (BALLOT_REVEAL) ve sayım kaydı (TALLY) indirilir");
    expect(text(intro)).toContain("defterdeki son taahhüdüyle karşılaştırılır");
  });

  it("vekâletle sayılan oyların taahhütle denetlenemediği açıkça söylenir (#218)", () => {
    const intro = text(html().slice(html().indexOf("Neyi denetler?")));
    expect(intro).toContain("Vekâletle sayılan oylar");
    expect(intro).toContain("taahhütle denetlenemez");
    expect(intro).toContain("bağımsızca kanıtlayamaz");
  });

  it("e2e sözleşmesi: başlık ve düğme adı iki kez, çapa ve action tonu aynen; yasak alt dizeler yok", () => {
    const h = html();
    expect(h.split("Sayımı kendim doğrulayayım").length - 1).toBe(2);
    expect(h).toContain('id="dogrula"');
    expect(h).toContain("card-action");
    const names = buttonsOf(h).map((b) => b.text).filter((n) => !n.includes("Sayımı kendim doğrulayayım"));
    for (const bad of FORBIDDEN) expect(names.filter((n) => n.toLocaleLowerCase("tr-TR").includes(bad.toLocaleLowerCase("tr-TR")))).toEqual([]);
  });
});
