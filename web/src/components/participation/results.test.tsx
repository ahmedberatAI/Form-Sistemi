// Sonuç kartı ve sayım doğrulama paneli: saf hüküm işlevleri ve (sunucu tarafı çizimle, DOM gerekmeden) düzen sözleşmeleri.
// Sözleşmeler: 'Önce hüküm' sırası; köprü açılırı sorun varsa kendiliğinden açık, 'Tam' görünümde her zaman açık; e2e'nin dayandığı
// bölge/düğme adları aynen; yeni düğme/bölge adları yasak alt dizeleri içermez. Bkz. ResultsCard, VerifyTallyPanel.
import type { ClusterResult, DecisionCheck, DecisionResult, MinorityReport } from "@forum/shared";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DetailLevelProvider } from "../../lib/detailLevel";
import { PREF_KEYS, removePref, setPrefSync } from "../../lib/prefs";
import { ToastProvider } from "../../ui/Toast";
import {
  approvalTexts,
  bridgeIsInformational,
  bridgeSummary,
  bridgeVerdict,
  checkShowsNote,
  clusterPgFloorText,
  collapsedChecks,
  MinorityReportList,
  planChecks,
  ResultsCard,
  totalsLine,
} from "./ResultsCard";
import { roundTone, roundVerdict, VERIFY_LEAD, VerifyTallyPanel, verifyProgressLabel } from "./VerifyTallyPanel";

vi.mock("../../auth/AuthContext", () => ({
  useAuth: () => ({ can: () => true, user: null, now: () => Date.UTC(2026, 9, 3) }),
  useServerNow: () => () => Date.UTC(2026, 9, 3),
}));

const cluster = (id: string, over: Partial<ClusterResult> = {}): ClusterResult => ({
  clusterId: id,
  label: `Görüş Grubu ${id.toUpperCase()}`,
  members: 10,
  significant: true,
  yes: 7,
  no: 2,
  abstain: 1,
  voted: 10,
  pg: 0.73,
  floor: 0.4,
  passed: true,
  ...over,
});

const check = (key: string, over: Partial<DecisionCheck> = {}): DecisionCheck => ({
  key,
  label: `Kontrol ${key}`,
  passed: true,
  value: "41/57",
  required: "≥ 12",
  detail: `${key} açıklaması`,
  ...over,
});

const result = (over: Partial<DecisionResult> = {}): DecisionResult => ({
  algoVersion: "KC-1.0",
  round: 1,
  outcome: "accept",
  totals: { eligible: 57, participants: 41, yes: 30, no: 8, abstain: 3, delegated: 4, unrouted: 1 },
  approval: 30 / 38,
  quorumRequired: 12,
  thresholdUsed: { num: 3, den: 5 },
  thresholdStrict: false,
  quorumMet: true,
  thresholdMet: true,
  bridgeApplicable: true,
  bridgeMet: true,
  overrideMet: null,
  gac: 0.71,
  clusters: [cluster("g0"), cluster("g1"), cluster("g2")],
  checks: [check("quorum"), check("threshold"), check("bridge:g0"), check("bridge:g1"), check("bridge:g2")],
  reason: "Genel onay (%79) ve tüm anlamlı görüş gruplarında köprü desteği sağlandı.",
  inputsHash: "ab".repeat(32),
  computedAt: Date.UTC(2026, 9, 3),
  ...over,
});

const report = (n: number): MinorityReport => ({
  id: `r${n}`,
  proposalId: "p1",
  authorId: `u${n}`,
  authorNickname: `uye${n}`,
  clusterId: "g1",
  body: `Azınlık görüşü ${n}`,
  createdAt: Date.UTC(2026, 9, 3),
});

const render = (el: React.ReactElement) =>
  renderToStaticMarkup(
    <DetailLevelProvider>
      <ToastProvider>
        <MemoryRouter>{el}</MemoryRouter>
      </ToastProvider>
    </DetailLevelProvider>,
  );

/** class'ında `cls` geçen <details> açılış etiketi. */
const detailsTag = (html: string, cls: string): string => html.match(new RegExp(`<details[^>]*${cls}[^>]*>`))?.[0] ?? "";
const isOpen = (tag: string) => /\sopen=""/.test(tag);
const count = (html: string, s: string) => html.split(s).length - 1;

describe("hüküm işlevleri", () => {
  it("totalsLine: tek satır toplamlar", () => {
    expect(totalsLine(result().totals)).toBe("57 uygun · 41 katıldı · Kabul 30 · Red 8 · Çekimser 3");
    expect(totalsLine({ ...result().totals, eligible: 1234 })).toContain("1.234 uygun");
  });

  it("bridgeSummary: sınanan grupların kaçı tabanı aştı + GAC", () => {
    expect(bridgeSummary(result())).toBe("3/3 anlamlı grup tabanı aştı · GAC 0,71");
    const failing = result({ clusters: [cluster("g0"), cluster("g1", { passed: false }), cluster("g2", { significant: false, passed: null })] });
    expect(bridgeSummary(failing)).toBe("1/2 anlamlı grup tabanı aştı · GAC 0,71");
    expect(bridgeSummary(result({ gac: null }))).toBe("3/3 anlamlı grup tabanı aştı");
  });

  it("bridgeSummary: nötr sayılan grup, soğuk başlangıç ve yalnız bilgi turu açıkça yazılır", () => {
    const neutral = result({ clusters: [cluster("g0"), cluster("g1", { passed: null })] });
    expect(bridgeSummary(neutral)).toBe("1/1 anlamlı grup tabanı aştı · 1 grup nötr sayıldı · GAC 0,71");
    const allNeutral = result({ clusters: [cluster("g0", { passed: null })] });
    expect(bridgeSummary(allNeutral)).toBe("Anlamlı grupların hiçbiri sınanamadı (nötr sayıldı) · GAC 0,71");
    const cold = result({ bridgeApplicable: false, bridgeMet: null, gac: null, clusters: [cluster("g0", { passed: null })] });
    expect(bridgeSummary(cold)).toBe("Köprü testi uygulanmadı (soğuk başlangıç)");
    expect(bridgeSummary(result(), true)).toBe("3/3 anlamlı grup tabanı aştı · bu turda yalnız bilgi · GAC 0,71");
  });

  it("bridgeIsInformational: yalnız itiraz sonrası yeniden oylamada küme tabanları uygulanmaz", () => {
    expect(bridgeIsInformational({ round: 2 }, "objection")).toBe(true);
    expect(bridgeIsInformational({ round: 2 }, "contested")).toBe(false);
    expect(bridgeIsInformational({ round: 1 }, "objection")).toBe(false);
    expect(bridgeIsInformational({ round: 2 }, null)).toBe(false);
  });

  it("bridgeVerdict: failed / neutral / passed / none", () => {
    expect(bridgeVerdict(result())).toBe("passed");
    expect(bridgeVerdict(result({ bridgeMet: false, clusters: [cluster("g0", { passed: false })] }))).toBe("failed");
    // köprü sağlanamadı ama hiçbir küme satırı başarısız değil (ör. yazar kümesi koruması): yine failed
    expect(bridgeVerdict(result({ bridgeMet: false }))).toBe("failed");
    expect(bridgeVerdict(result({ clusters: [cluster("g0"), cluster("g1", { passed: false })] }))).toBe("failed");
    expect(bridgeVerdict(result({ clusters: [cluster("g0"), cluster("g1", { passed: null })] }))).toBe("neutral");
    // anlamlı olmayan küme (passed null) nötr sayılmaz
    expect(bridgeVerdict(result({ clusters: [cluster("g0"), cluster("g1", { significant: false, passed: null })] }))).toBe("passed");
    expect(bridgeVerdict(result({ bridgeApplicable: false, bridgeMet: null, clusters: [cluster("g0", { passed: null })] }))).toBe("none");
    expect(bridgeVerdict(result({ clusters: [] }))).toBe("none");
    // yalnız bilgi turunda başarısız taban uyarı üretmez
    expect(bridgeVerdict(result({ bridgeMet: false, clusters: [cluster("g0", { passed: false })] }), true)).toBe("none");
  });

  it("checkShowsNote: başarısız, nötr kümenin köprü satırı ve asgari oy kontrolü satır içi; diğerleri açılırda", () => {
    const clusters = [cluster("g0"), cluster("g1", { passed: null })];
    expect(checkShowsNote({ key: "quorum", passed: false }, clusters)).toBe(true);
    expect(checkShowsNote({ key: "quorum", passed: true }, clusters)).toBe(false);
    expect(checkShowsNote({ key: "bridge:g0", passed: true }, clusters)).toBe(false);
    expect(checkShowsNote({ key: "bridge:g1", passed: true }, clusters)).toBe(true);
    expect(checkShowsNote({ key: "participation_shortfall", passed: true }, clusters)).toBe(true);
    expect(checkShowsNote({ key: "bridge:gX", passed: true }, clusters)).toBe(false);
  });
});

describe("kontrol görünümü (planChecks)", () => {
  const clusters = [cluster("g0"), cluster("g1"), cluster("g2")];
  const checks = [check("quorum"), check("threshold"), check("bridge:g0"), check("bridge:g1"), check("bridge:g2")];

  it("geçen kontroller rozet olur, geçen ikiden çok köprü satırı tek rozette birleşir", () => {
    const views = planChecks(checks, clusters);
    expect(views.map((v) => v.kind)).toEqual(["chip", "chip", "bridge"]);
    expect(views[2]).toMatchObject({ kind: "bridge", checks: [{ key: "bridge:g0" }, { key: "bridge:g1" }, { key: "bridge:g2" }] });
    expect(collapsedChecks(views).map((c) => c.key)).toEqual(["quorum", "threshold", "bridge:g0", "bridge:g1", "bridge:g2"]); // hiçbir kontrol kaybolmaz
  });

  it("başarısız kontrol tam satır kalır; kalan tek köprü satırı kendi etiketiyle rozet olur", () => {
    const failing = [check("quorum"), check("bridge:g0"), check("bridge:g1", { passed: false }), check("threshold")];
    const views = planChecks(failing, clusters);
    expect(views.map((v) => v.kind)).toEqual(["chip", "chip", "row", "chip"]);
    expect(views[1]).toMatchObject({ kind: "chip", check: { key: "bridge:g0" } });
    expect(views[2]).toMatchObject({ kind: "row", check: { key: "bridge:g1" } });
    // başarısız satır açılırda tekrarlanmaz
    expect(collapsedChecks(views).map((c) => c.key)).toEqual(["quorum", "bridge:g0", "threshold"]);
  });

  it("nötr sayılan kümenin köprü satırı tam satır, diğerleri tek birleşik rozet (rozet satırdan önce gelir)", () => {
    const views = planChecks(checks, [cluster("g0"), cluster("g1", { passed: null }), cluster("g2")]);
    expect(views.map((v) => v.kind)).toEqual(["chip", "chip", "bridge", "row"]);
    expect(views[2]).toMatchObject({ checks: [{ key: "bridge:g0" }, { key: "bridge:g2" }] });
    expect(views[3]).toMatchObject({ check: { key: "bridge:g1" } });
  });

  it("küme tabanlarının uygulanmadığı turda köprü satırları birleştirilmez", () => {
    const views = planChecks(checks, clusters, true);
    expect(views.map((v) => v.kind)).toEqual(["chip", "chip", "chip", "chip", "chip"]);
  });
});

describe("ResultsCard düzeni", () => {
  beforeEach(async () => {
    await removePref(PREF_KEYS.detail);
  });

  it("e2e sözleşmesi: bölge '1. tur sonucu', .card-actions içinde 'Kabul' rozeti; 2. turda başlık ve alt başlık", () => {
    const html = render(<ResultsCard result={result()} />);
    expect(html).toContain("1. tur sonucu");
    expect(html).toMatch(/class="card-actions"[^>]*><span class="badge[^"]*"[^>]*>Kabul</);
    expect(html).toContain('aria-label="Neden bu sonuç?"');
    expect(html).not.toContain("Yeniden oylama sonucu");
    const r2 = render(<ResultsCard result={result({ round: 2 })} reconciliationOrigin="objection" />);
    expect(r2).toContain("Yeniden oylama sonucu");
    expect(r2).toContain("İtiraz sonrası yeniden oylama");
  });

  it("önce hüküm: gerekçe → tek satır toplamlar → iki çubuk → Neden bu sonuç? → köprü → ayrıntılı sayılar → vekâlet → azınlık → algoritma", () => {
    const html = render(<ResultsCard result={result()} minorityReports={[report(1)]} myEffectiveVia={{ delegateNickname: "deniz", choice: "yes" }} />);
    const order = [
      "Gerekçe:",
      "57 uygun · 41 katıldı · Kabul 30 · Red 8 · Çekimser 3",
      'aria-label="Katılım"',
      'aria-label="Onay oranı (kabul / (kabul + red))"',
      'aria-label="Neden bu sonuç?"',
      "Görüş grupları ve köprü testi",
      "Ayrıntılı sayılar",
      "Doğrudan oy vermediniz",
      'aria-label="Azınlık raporları"',
      "Algoritma KC-1.0",
    ].map((s) => html.indexOf(s));
    expect(order.every((i) => i >= 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    expect(html).toContain("3/3 anlamlı grup tabanı aştı · GAC 0,71");
  });

  it("olağan durumda köprü ve sayı açılırları kapalı; yedi kutu ve görünür açıklamalar DOM'da", () => {
    const html = render(<ResultsCard result={result()} />);
    expect(isOpen(detailsTag(html, "result-bridge"))).toBe(false);
    expect(isOpen(detailsTag(html, "result-counts"))).toBe(false);
    for (const label of ["Uygun seçmen", "Katılım", "Kabul", "Red", "Çekimser", "Vekâletle", "Yönlendirilemeyen"]) expect(html).toContain(`<dt>${label}</dt>`);
    // Eskiden yalnız title olan açıklamalar görünür metin
    expect(html).toContain("doğrudan oy vermeyen, oyu vekâlet zinciriyle sayılan kişi");
    expect(html).toContain("delegenin vekâlet sınırı aşıldığı için oyu kullanılamayan kişi");
    expect(html).not.toContain('title="Doğrudan oy vermeyen');
    expect(html).toContain("vekâletle 4 · yönlendirilemeyen 1");
    // P_g tablosu ve boykot açıklaması açılırın içinde, DOM'da
    expect(html).toContain("Taban φ");
    expect(html).toContain("boykot bir engel aracı değildir");
  });

  it("başarısız grup tabanı ya da köprü: açılır kendiliğinden açık, ✘ ve danger metni", () => {
    const failing = result({ outcome: "contested", bridgeMet: false, clusters: [cluster("g0"), cluster("g1", { passed: false })] });
    const html = render(<ResultsCard result={failing} />);
    const tag = detailsTag(html, "result-bridge");
    expect(isOpen(tag)).toBe(true);
    expect(html).toContain("result-verdict-fail");
    expect(html).toContain("✘");
    expect(html).toContain("1/2 anlamlı grup tabanı aştı");
  });

  it("nötr sayılan grup (muaf): açılır açık, ⚠ ve warning metni", () => {
    const html = render(<ResultsCard result={result({ clusters: [cluster("g0"), cluster("g1", { passed: null })] })} />);
    expect(isOpen(detailsTag(html, "result-bridge"))).toBe(true);
    expect(html).toContain("result-verdict-warn");
    expect(html).toContain("1 grup nötr sayıldı");
  });

  it("soğuk başlangıç: köprü açılırı kapalı, özet 'uygulanmadı'; not 'Ayrıntılı sayılar' içinde; çubuk etiketi soğuk başlangıcı söyler", () => {
    const cold = result({ bridgeApplicable: false, bridgeMet: null, gac: null, clusters: [cluster("g0", { passed: null })] });
    const html = render(<ResultsCard result={cold} />);
    expect(isOpen(detailsTag(html, "result-bridge"))).toBe(false);
    expect(html).toContain("Köprü testi uygulanmadı (soğuk başlangıç)");
    const note = html.indexOf("Yeterli görüş verisi yok; köprü testi yerine nitelikli çoğunluk arandı");
    expect(note).toBeGreaterThan(html.indexOf("Ayrıntılı sayılar"));
    expect(html).toContain("soğuk başlangıç: nitelikli çoğunluk");
    // köprü uygulanabilirken not çizilmez
    expect(render(<ResultsCard result={result()} />)).not.toContain("Yeterli görüş verisi yok; köprü testi yerine");
  });

  it("grup bilgisi yoksa açılır yerine tek satır not", () => {
    const html = render(<ResultsCard result={result({ clusters: [], bridgeApplicable: false, bridgeMet: null, gac: null })} />);
    expect(html).toContain("Bu oylamada görüş grubu (küme) bilgisi yok");
    expect(html).not.toContain("result-bridge");
  });

  it("itiraz sonrası yeniden oylamada başarısız taban yalnız bilgidir: açılır kapalı kalır", () => {
    const r = result({ round: 2, bridgeMet: false, clusters: [cluster("g0"), cluster("g1", { passed: false })] });
    const html = render(<ResultsCard result={r} reconciliationOrigin="objection" />);
    expect(isOpen(detailsTag(html, "result-bridge"))).toBe(false);
    expect(html).toContain("bu turda yalnız bilgi");
    expect(html).not.toContain("result-verdict-fail");
    // tartışmalı sonuç sonrası yeniden oylamada küme tabanı kuralın parçasıdır
    expect(isOpen(detailsTag(render(<ResultsCard result={r} reconciliationOrigin="contested" />), "result-bridge"))).toBe(true);
  });

  it("'Neden bu sonuç?': geçenler rozet, başarısız kontrol açıklamasıyla tam satır; rozetlerin tam metni 'Kontrol ayrıntıları' açılırında", () => {
    const r = result({ checks: [check("quorum", { detail: "yeter sayı açıklaması" }), check("threshold", { passed: false, detail: "eşik açıklaması" })] });
    const html = render(<ResultsCard result={r} />);
    const section = html.slice(html.indexOf('aria-label="Neden bu sonuç?"'));
    const details = section.indexOf("Kontrol ayrıntıları");
    expect(details).toBeGreaterThan(-1);
    expect(section).toContain("why-chip");
    expect(section.indexOf("eşik açıklaması")).toBeLessThan(details); // satır içi, açılırdan önce
    expect(section.indexOf("yeter sayı açıklaması")).toBeGreaterThan(details); // açılırın içinde
    expect(count(html, "eşik açıklaması")).toBe(1); // çiftlenmez
    expect(section).toContain("(gerekli ≥ 12)");
    expect(isOpen(detailsTag(section, "details"))).toBe(false);
  });

  it("olağan sonuçta 5 kontrol 3 rozete iner (yeter sayı, onay oranı, birleşik köprü); hepsi açılırda tam metinle", () => {
    const html = render(<ResultsCard result={result()} />);
    expect(count(html, "why-chip")).toBe(3);
    expect(html).toContain("Köprü testi: 3 grup tabanı aştı");
    expect(html).not.toContain("why-fail");
    expect(html).toContain("5 kontrol");
    for (const key of ["quorum", "threshold", "bridge:g0", "bridge:g1", "bridge:g2"]) expect(html).toContain(`Kontrol ${key}:`);
  });

  it("tüm kontroller satır içinde gösteriliyorsa ayrıntı açılırı çizilmez", () => {
    const r = result({ checks: [check("threshold", { passed: false })] });
    expect(render(<ResultsCard result={r} />)).not.toContain("Kontrol ayrıntıları");
  });

  it("'Tam' görünümde tüm açılırlar açık gelir", () => {
    setPrefSync(PREF_KEYS.detail, "tam");
    const html = render(<ResultsCard result={result()} minorityReports={[report(1)]} />);
    const tags = html.match(/<details[^>]*>/g) ?? [];
    expect(tags.length).toBeGreaterThanOrEqual(3); // köprü, sayılar, kontrol açıklamaları
    expect(tags.every(isOpen)).toBe(true);
  });

  it("azınlık raporları: ilk 2 görünür, fazlası 'Tümünü göster (n)'; 'Tam' görünümde hepsi", () => {
    const three = [report(1), report(2), report(3)];
    const html = render(<ResultsCard result={result()} minorityReports={three} />);
    expect(html).toContain("Azınlık raporları (3)");
    expect(html).toContain("Azınlık görüşü 1");
    expect(html).toContain("Azınlık görüşü 2");
    expect(html).not.toContain("Azınlık görüşü 3");
    expect(html).toContain("Tümünü göster (3)");
    expect(html).toMatch(/aria-expanded="false"[^>]*aria-controls|aria-controls[^>]*aria-expanded="false"/);

    setPrefSync(PREF_KEYS.detail, "tam");
    const full = render(<ResultsCard result={result()} minorityReports={three} />);
    expect(full).toContain("Azınlık görüşü 3");
    expect(full).toContain("Daha az göster");
    expect(full).not.toContain("Tümünü göster (3)");
  });

  it("MinorityReportList: sınır verilmezse (Uzlaşma paneli) hepsi görünür ve düğme yok; iki rapor sınırı aşmaz", () => {
    const five = [1, 2, 3, 4, 5].map(report);
    const all = render(<MinorityReportList reports={five} />);
    expect(count(all, "<li ")).toBe(5);
    expect(all).not.toContain("<button");
    const two = render(<MinorityReportList reports={five.slice(0, 2)} initialCount={2} />);
    expect(count(two, "<li ")).toBe(2);
    expect(two).not.toContain("<button");
  });

  it("test sözleşmesi: yasak alt dizeler düğme/bölge adlarında yok", () => {
    const html = render(<ResultsCard result={result()} minorityReports={[report(1), report(2), report(3)]} />);
    const names = [...html.matchAll(/aria-label="([^"]*)"/g)].map((m) => m[1]);
    const buttons = [...html.matchAll(/<button[^>]*>([\s\S]*?)<\/button>/g)].map((m) => m[1].replace(/<[^>]+>/g, ""));
    for (const forbidden of ["Sayımı kendim doğrulayayım", "Oyumu ver", "Destekle", "Daha fazla", "Kapat", "Azınlık raporu"]) {
      expect([...names, ...buttons].filter((n) => n.includes(forbidden)).filter((n) => !(forbidden === "Azınlık raporu" && n === "Azınlık raporları"))).toEqual([]);
    }
  });
});

describe("VerifyTallyPanel düzeni", () => {
  beforeEach(async () => {
    await removePref(PREF_KEYS.detail);
  });

  const panel = () => <VerifyTallyPanel proposalId="p1" results={[result()]} />;

  it("e2e sözleşmesi: 'Sayımı kendim doğrulayayım' başlığı ve düğmesi hep görünür; kart #dogrula çapasını taşır ve katlanmaz", () => {
    const html = render(panel());
    expect(html).toContain('id="dogrula"');
    expect(html).toContain("<h3");
    expect(count(html, "Sayımı kendim doğrulayayım")).toBe(2); // başlık + düğme
    expect(html).toMatch(/<button[^>]*>(<[^>]+>)*[^<]*Sayımı kendim doğrulayayım/);
    expect(html).not.toContain("card-toggle");
  });

  it("önce tek cümle, sonra düğme, sonra 'Neyi denetler?' (teknik giriş içeride)", () => {
    const html = render(panel());
    const lead = html.indexOf(VERIFY_LEAD);
    const button = html.indexOf("<button");
    const intro = html.indexOf("Neyi denetler?");
    const tech = html.indexOf("BALLOT_REVEAL");
    expect(lead).toBeGreaterThan(-1);
    expect(lead).toBeLessThan(button);
    expect(button).toBeLessThan(intro);
    expect(intro).toBeLessThan(tech);
    expect(isOpen(detailsTag(html, "verify-intro"))).toBe(false);
    // odak ?bolum=dogrula ile ilk denetime (düğmeye) gider: düğmeden önce bağlantı/giriş/özet yok
    expect(html.slice(0, button)).not.toMatch(/<(a|input|select|textarea|summary)[\s>]/);
    expect(VERIFY_LEAD).not.toContain("Sayımı kendim doğrulayayım");
  });

  it("'Tam' görünümde 'Neyi denetler?' açık gelir", () => {
    setPrefSync(PREF_KEYS.detail, "tam");
    expect(isOpen(detailsTag(render(panel()), "verify-intro"))).toBe(true);
  });
});

// ───────────── Sınıra yakın değerlerin gösterimi (ALGORİTMA §4.2 r2, §12.15) ─────────────

describe("gösterilen değer karşılaştırma sonucuyla çelişmez", () => {
  it("küme tablosu: P_g 14/47 = 0,2979 < taban 0,30 → '0,298 | 0,30' (eskiden '0,30 | 0,30 | ✘')", () => {
    expect(clusterPgFloorText({ pg: 14 / 47, floor: 0.3, yes: 13, no: 32 })).toEqual({ pg: "0,298", floor: "0,30" });
    // T1: 16 kabul / 25 red → P_g 17/43 = 0,3953 < 0,40
    expect(clusterPgFloorText({ pg: 17 / 43, floor: 0.4, yes: 16, no: 25 })).toEqual({ pg: "0,395", floor: "0,40" });
    // Sınır yuvarlanınca karşılaştırma çelişirse sınırın da hassasiyeti artar: 2/3 iken P_g 0,6668 "0,6668 ≥ 0,67" görünmesin
    expect(clusterPgFloorText({ pg: 0.6668, floor: 2 / 3, yes: 0, no: 0 })).toEqual({ pg: "0,6668", floor: "0,6667" });
  });

  it("küme tablosu: ayırt edilebilen ve tam eşit değerler bugünkü 2 basamakla kalır; taban yoksa '—'", () => {
    expect(clusterPgFloorText({ pg: 0.73, floor: 0.4, yes: 7, no: 2 })).toEqual({ pg: "0,73", floor: "0,40" });
    expect(clusterPgFloorText({ pg: 3 / 10, floor: 0.3, yes: 2, no: 6 })).toEqual({ pg: "0,30", floor: "0,30" });
    expect(clusterPgFloorText({ pg: 0.5, floor: null, yes: 0, no: 0 })).toEqual({ pg: "0,50", floor: "—" });
  });

  it("onay çubuğu: 1499/2500 = %59,96 eşik %60'ın altında → '%59,96' ve 'Eşik: ≥ %60,0' (eskiden '%60' / '≥ %60')", () => {
    const r = { approval: 1499 / 2500, totals: { ...result().totals, yes: 1499, no: 1001 }, thresholdUsed: { num: 3, den: 5 }, thresholdStrict: false };
    expect(approvalTexts(r)).toEqual({ value: "%59,96", threshold: "≥ %60,0" });
    const html = render(<ResultsCard result={result({ ...r, outcome: "reject", thresholdMet: false })} />);
    expect(html).toContain("%59,96 (1499/2500)");
    expect(html).toContain("Eşik: ≥ %60,0");
  });

  it("onay çubuğu: ayırt edilebilen değerde bugünkü biçim korunur; tam eşitlikte sınırla aynı yazılır", () => {
    expect(approvalTexts({ approval: 30 / 38, totals: result().totals, thresholdUsed: { num: 3, den: 5 }, thresholdStrict: false })).toEqual({ value: "%78,9", threshold: "≥ %60" });
    const eq = { approval: 0.5, totals: { ...result().totals, yes: 4, no: 4 }, thresholdUsed: { num: 1, den: 2 }, thresholdStrict: true };
    expect(approvalTexts(eq)).toEqual({ value: "%50", threshold: "> %50" });
  });

  it("ResultsCard tablosu P_g'yi tabandan ayırt edilebilir yazar", () => {
    const html = render(<ResultsCard result={result({ bridgeMet: false, clusters: [cluster("g0"), cluster("g2", { yes: 13, no: 32, pg: 14 / 47, floor: 0.3, passed: false })] })} />);
    expect(html).toContain("<strong>0,298</strong>");
    expect(html).not.toContain("<strong>0,30</strong>");
  });
});

describe("sayım doğrulaması hükmü: geçici hata BAŞARISIZ değildir", () => {
  it("uyuşmazlık → BAŞARISIZ (kırmızı); sonuç alınamadı → uyarı; bloğa girmedi → bilgi; hepsi tuttu → yeşil", () => {
    expect([roundVerdict({ ok: false, pending: false, inconclusive: null }), roundTone({ ok: false, pending: false, inconclusive: null })]).toEqual(["doğrulama BAŞARISIZ", "error"]);
    const inc = { ok: true, pending: true, inconclusive: "Sunucunun hız sınırına takıldı" };
    expect([roundVerdict(inc), roundTone(inc)]).toEqual(["sonuç alınamadı, yeniden deneyin", "warning"]);
    expect(roundTone({ ok: true, pending: true, inconclusive: null })).toBe("info");
    expect([roundVerdict({ ok: true, pending: false, inconclusive: null }), roundTone({ ok: true, pending: false, inconclusive: null })]).toEqual(["sayım doğrulandı", "success"]);
  });

  it("ilerleme metni: doğrulanan taahhüt sayısı ve hız sınırı beklemesi", () => {
    expect(verifyProgressLabel(null)).toBe("Bülten indiriliyor ve sayım yeniden yapılıyor…");
    expect(verifyProgressLabel({ done: 120, total: 1251, waitingMs: 0 })).toBe("Oy taahhütleri defterden doğrulanıyor: 120/1.251…");
    expect(verifyProgressLabel({ done: 120, total: 1251, waitingMs: 53_200 })).toContain("hız sınırı nedeniyle 54 sn bekleniyor");
  });
});
