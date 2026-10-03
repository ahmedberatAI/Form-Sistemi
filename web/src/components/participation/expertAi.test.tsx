// Bilirkişi görüşü ve YZ özeti kartları: hüküm satırı (saf işlevler) ve kartların varsayılan görünürlüğü (sunucu tarafı çizim).
// Sade: raporlar tek satır, soru formu kapalı, ortak zemin/tartışmalı/açık sorular kapalı; azınlık görüşleri HER ZAMAN açık.
// Tam: hepsi açık. Bkz. ExpertPanelCard, AiSummaryCard.
import type { AiAnalysisInfo, ExpertPanelInfo, ExpertReportView, ProposalDetail } from "@forum/shared";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DetailLevelProvider } from "../../lib/detailLevel";
import { PREF_KEYS, removePref, setPrefSync } from "../../lib/prefs";
import { ToastProvider } from "../../ui/Toast";
import { aiEmptyLine, AiSummaryCard, aiSectionLabel, aiSummaryStats } from "./AiSummaryCard";
import { averageConfidence, ExpertPanelCard, expertVerdict } from "./ExpertPanelCard";

let canAll = true;
vi.mock("../../auth/AuthContext", () => ({
  useAuth: () => ({ can: () => canAll, user: null, now: () => Date.UTC(2026, 9, 2) }),
  useServerNow: () => () => Date.UTC(2026, 9, 2),
}));

const render = (el: React.ReactElement) =>
  renderToStaticMarkup(
    <DetailLevelProvider>
      <ToastProvider>
        <MemoryRouter>{el}</MemoryRouter>
      </ToastProvider>
    </DetailLevelProvider>,
  );

const report = (over: Partial<ExpertReportView> = {}): ExpertReportView => ({
  id: "r1",
  assignmentId: "a1",
  expertId: "e1",
  expertNickname: "bk_a",
  assessment: "feasible",
  confidence: 0.8,
  risks: ["Bütçe riski"],
  answers: [{ questionId: "q1", answer: "Evet, uygulanabilir." }],
  body: "RAPOR-GOVDESI metni",
  dissent: "KARSI-GORUS metni",
  lintIssues: [],
  contentHash: "ab".repeat(32),
  ledgerTx: null,
  createdAt: 1,
  ...over,
});

const panelOf = (over: Partial<ExpertPanelInfo> = {}): ExpertPanelInfo =>
  ({
    panelId: "pn1",
    proposalId: "p1",
    round: 1,
    createdAt: 1,
    isCounterPanel: false,
    noExpertAvailable: false,
    suspensiveFlag: false,
    seed: "ab".repeat(32),
    seedSource: { blockHeight: 3, blockHash: "cd".repeat(32), round: 1, proposalId: "p1" },
    ledgerTx: null,
    assignments: [],
    candidates: [],
    draws: [],
    reports: [],
    questions: [],
    ...over,
  }) as ExpertPanelInfo;

const proposalOf = (over: Partial<ProposalDetail> = {}): ProposalDetail =>
  ({ id: "p1", status: "deliberation", expertPanel: null, expertQuestions: [], params: null, aiAnalyses: [], ...over }) as unknown as ProposalDetail;

describe("bilirkişi hükmü", () => {
  it("averageConfidence: ortalama; rapor yoksa null", () => {
    expect(averageConfidence([])).toBeNull();
    expect(averageConfidence([{ confidence: 0.8 }, { confidence: 0.6 }])).toBeCloseTo(0.7);
  });

  it("raporlu panel: rapor sayısı, değerlendirme dağılımı, ortalama güven ve soru sayısı", () => {
    const reports = [report({ id: "1" }), report({ id: "2", confidence: 0.8 })];
    expect(expertVerdict({ panel: panelOf({ reports }), questionCount: 2 })).toEqual({
      text: "2 rapor: 2 uygulanabilir · ort. güven %80 · 2 soru",
      tone: "neutral",
    });
    const mixed = [report({ id: "1" }), report({ id: "2", assessment: "infeasible", confidence: 0.6 }), report({ id: "3", assessment: "uncertain", confidence: 0.7 })];
    expect(expertVerdict({ panel: panelOf({ reports: mixed }), questionCount: 0 }).text).toBe(
      "3 rapor: 1 uygulanabilir · 1 uygulanamaz · 1 belirsiz · ort. güven %70 · soru yok",
    );
  });

  it("askı kuralı uygulandıysa uyarı tonu ve metni (renk tek başına anlam taşımaz)", () => {
    const v = expertVerdict({ panel: panelOf({ reports: [report()], suspensiveFlag: true }), questionCount: 1 });
    expect(v.tone).toBe("warning");
    expect(v.text).toBe("1 rapor: 1 uygulanabilir · ort. güven %80 · 1 soru · askı uyarısı var");
  });

  it("rapor yok: bekleyen bilirkişi sayısı (davet edilmiş ya da kabul etmiş); bulunamadıysa uyarı", () => {
    const assignments = [
      { id: "1", expertId: "a", nickname: "a", status: "invited", dueAt: 1 },
      { id: "2", expertId: "b", nickname: "b", status: "accepted", dueAt: 1 },
      { id: "3", expertId: "c", nickname: "c", status: "recused", dueAt: 1 },
    ] as ExpertPanelInfo["assignments"];
    expect(expertVerdict({ panel: panelOf({ assignments }), questionCount: 0 })).toEqual({
      text: "Henüz rapor yok · 2 bilirkişiden rapor bekleniyor · soru yok",
      tone: "neutral",
    });
    expect(expertVerdict({ panel: panelOf(), questionCount: 0 }).text).toBe("Henüz rapor yok · soru yok");
    expect(expertVerdict({ panel: panelOf({ noExpertAvailable: true }), questionCount: 0 })).toEqual({
      text: "Uygun bilirkişi yok · rapor yok · soru yok",
      tone: "warning",
    });
  });

  it("panel yok: tek satır; bilirkişi görüşü gerekliyse söyler, soru varsa sayısını ekler", () => {
    expect(expertVerdict({ panel: null, questionCount: 0 }).text).toBe("Henüz panel çekilmedi");
    expect(expertVerdict({ panel: null, questionCount: 0, requiresExpert: true }).text).toBe("Henüz panel çekilmedi · bilirkişi görüşü gerekli");
    expect(expertVerdict({ panel: null, questionCount: 2, requiresExpert: false }).text).toBe("Henüz panel çekilmedi · 2 soru");
  });
});

describe("YZ özeti yardımcıları", () => {
  it("aiSectionLabel: başlık ve sayı", () => {
    expect(aiSectionLabel("Ortak zemin", [{ text: "x", cites: [] }, { text: "y", cites: [] }])).toBe("Ortak zemin (2)");
    expect(aiSectionLabel("Açık sorular", undefined)).toBe("Açık sorular (0)");
  });

  it("aiSummaryStats: kapsam yüzdesi ve mesaj sayısı tek satırda; ikisi de yoksa null", () => {
    expect(aiSummaryStats({ coverage: 0.666, messageCount: 12 })).toBe("Kapsam: %67 (özette alıntılanan mesajların oranı) · özete giren mesaj: 12");
    expect(aiSummaryStats({ coverage: 0 })).toBe("Kapsam: %0 (özette alıntılanan mesajların oranı)");
    expect(aiSummaryStats({ messageCount: 0 })).toBe("özete giren mesaj: 0");
    expect(aiSummaryStats({})).toBeNull();
  });

  it("aiEmptyLine: azınlık görüşleri kuralı her zaman söylenir; üretemeyene kimin üretebileceği eklenir", () => {
    expect(aiEmptyLine(true)).toBe("Henüz YZ özeti yok — azınlık görüşleri, özet üretilince ayrı bölümde gösterilir.");
    expect(aiEmptyLine(false)).toBe("Henüz YZ özeti yok — azınlık görüşleri, özet üretilince ayrı bölümde gösterilir. Özeti doğrulanmış üyeler üretebilir.");
  });
});

describe("ExpertPanelCard: varsayılan görünürlük", () => {
  beforeEach(async () => {
    canAll = true;
    await removePref(PREF_KEYS.detail);
  });

  const withReports = () =>
    proposalOf({
      expertPanel: panelOf({
        reports: [report({ id: "r1" }), report({ id: "r2", expertId: "e2", expertNickname: "bk_b", confidence: 0.8, lintIssues: [{ quote: "hukuka aykırıdır", kind: "legal", message: "hukuki nitelendirme" }] })],
        questions: [{ id: "q1", proposalId: "p1", authorId: "u1", authorNickname: "ayse", body: "SORU-METNI", minorityGuaranteed: true, createdAt: 2 }],
      }),
    });

  it("Sade: hüküm başlıkta, raporlar tek satır ve gövde kapalı, soru formu kapalı", () => {
    const html = render(<ExpertPanelCard proposal={withReports()} onUpdated={() => undefined} />);
    expect(html).toContain("2 rapor: 2 uygulanabilir · ort. güven %80 · 1 soru");
    expect(html).toContain("Raporlar (2)");
    expect(html).toContain("@bk_a");
    expect(html).toContain("@bk_b");
    expect(html).toContain("⚠ 1 hukuki nitelendirme uyarısı");
    // iki rapor düğmesi, ikisi de kapalı; gövde DOM'da hidden ile bağlı kalır (içerik silinmez)
    expect(html.match(/Raporu oku/g)).toHaveLength(2);
    expect(html).not.toContain("Raporu gizle");
    expect(html.match(/<button[^>]*aria-expanded="false"[^>]*aria-controls=[^>]*>Raporu oku/g)).toHaveLength(2);
    expect(html).toMatch(/<div class="expert-report-body"[^>]*hidden=""[^>]*>/);
    expect(html).toContain("RAPOR-GOVDESI metni");
    expect(html).toContain("Sorulara yanıtlar (1)");
    expect(html).toContain("KARSI-GORUS metni");
    // sorular görünür, form kapalı
    expect(html).toContain("Bilirkişiye sorular (1)");
    expect(html).toContain("SORU-METNI");
    expect(html).toContain("Azınlık güvenceli");
    expect(html).toMatch(/<button[^>]*aria-expanded="false"[^>]*>Soru sor<\/button>/);
    expect(html).toMatch(/<div id="[^"]*" hidden="">\s*<form/);
    // rolü anlatan cümle (eski altbaşlık) altlıkta durur
    expect(html).toContain("Bilirkişi danışmandır; oy ağırlığı yoktur, oyu 1&#x27;dir.");
    // kura kanıtı Faz 1'deki gibi tek açılırda
    expect(html).toContain("Kura ve adillik kanıtı");
  });

  it("Tam: rapor gövdeleri ve soru formu açık gelir", () => {
    setPrefSync(PREF_KEYS.detail, "tam");
    const html = render(<ExpertPanelCard proposal={withReports()} onUpdated={() => undefined} />);
    expect(html.match(/Raporu gizle/g)).toHaveLength(2);
    expect(html).not.toContain("Raporu oku");
    expect(html).not.toMatch(/<div class="expert-report-body"[^>]*hidden/);
    expect(html).toContain("Soru formunu gizle");
    expect(html).not.toMatch(/<div id="[^"]*" hidden="">\s*<form/);
  });

  it("Soru formu yalnız doğrulanmış üyede ve açık öneride vardır", () => {
    canAll = false;
    const html = render(<ExpertPanelCard proposal={withReports()} onUpdated={() => undefined} />);
    expect(html).toContain("SORU-METNI");
    expect(html).not.toContain("Soru sor");
    expect(html).not.toContain("<form");
    canAll = true;
    const closed = render(<ExpertPanelCard proposal={{ ...withReports(), status: "enacted" } as ProposalDetail} onUpdated={() => undefined} />);
    expect(closed).not.toContain("Soru sor");
    expect(closed).not.toContain("<form");
  });

  it("Panel yok: tek satır hüküm, V için talep düğmesi, kural cümlesi 'Panel ne zaman çekilir?' açılırında", () => {
    const html = render(<ExpertPanelCard proposal={proposalOf({ params: { requiresExpert: true } as never })} onUpdated={() => undefined} />);
    expect(html).toContain("Henüz panel çekilmedi · bilirkişi görüşü gerekli");
    expect(html).toContain("Bilirkişi paneli talep et");
    expect(html).toContain("Panel ne zaman çekilir?");
    expect(html).toContain("kurayla çekilir");
    expect(html).toContain('id="bilirkisi"');
    expect(html).toContain("Henüz soru yok.");
    canAll = false;
    expect(render(<ExpertPanelCard proposal={proposalOf()} onUpdated={() => undefined} />)).not.toContain("Bilirkişi paneli talep et");
  });

  it("Rapor yokken panel: kural cümlesi görünür, 'Raporlar' başlığı çıkmaz; bulunamadıysa uyarı kalır", () => {
    const html = render(<ExpertPanelCard proposal={proposalOf({ expertPanel: panelOf() })} onUpdated={() => undefined} />);
    expect(html).toContain("Süre içinde rapor gelmezse oylama raporsuz başlar");
    expect(html).not.toContain("Raporlar (");
    const none = render(<ExpertPanelCard proposal={proposalOf({ expertPanel: panelOf({ noExpertAvailable: true }) })} onUpdated={() => undefined} />);
    expect(none).toContain("Bilirkişi bulunamadı");
    expect(none).toContain("card-summary-warning");
    expect(none).not.toContain("Süre içinde rapor gelmezse");
  });
});

describe("AiSummaryCard: varsayılan görünürlük", () => {
  beforeEach(async () => {
    canAll = true;
    await removePref(PREF_KEYS.detail);
  });

  const pt = (text: string, cites: string[] = []) => ({ text, cites });
  const analysis = (output: unknown): AiAnalysisInfo => ({
    id: "an1",
    task: "summarize",
    targetType: "proposal",
    targetId: "p1",
    model: "offline-heuristic",
    offline: true,
    output,
    label: "Yapay zekâ ile üretildi · offline · 2 Eki",
    approvedBy: null,
    createdAt: 5,
    ledgerTx: null,
  });
  const summary = {
    commonGround: [pt("ORTAK-1"), pt("ORTAK-2")],
    contested: [pt("TARTISMALI-1")],
    minorityViews: [pt("AZINLIK-1", ["m1"])],
    openQuestions: [],
    coverage: 0.5,
    messageCount: 7,
  };
  const withSummary = () => proposalOf({ aiAnalyses: [analysis(summary)] });

  it("Sade: azınlık görüşleri açık ve açılırların dışında; diğer üç bölüm başlık ve sayıyla kapalı; kapsam metin", () => {
    const html = render(<AiSummaryCard proposal={withSummary()} messages={new Map()} onNewAnalysis={() => undefined} />);
    expect(html).toContain('data-ai-generated="true"');
    expect(html).toContain("YZ danışmandır, karar vermez.");
    // azınlık görüşleri bölümü bir <details> içinde değildir ve ilk sıradadır
    const minority = html.indexOf('aria-label="Azınlık görüşleri"');
    expect(minority).toBeGreaterThan(-1);
    expect(html.slice(0, minority)).not.toContain("<details");
    expect(html).toContain("AZINLIK-1");
    expect(html.indexOf("Ortak zemin (2)")).toBeGreaterThan(minority);
    // üç bölüm: kapalı <details> (open yok), metin DOM'da
    expect(html).toContain("Ortak zemin (2)");
    expect(html).toContain("Tartışmalı noktalar (1)");
    expect(html.match(/<details/g)).toHaveLength(2);
    expect(html).not.toMatch(/<details[^>]*open/);
    expect(html).toContain("ORTAK-1");
    // boş bölüm açılacak bir şey olmadığından tek satır
    expect(html).toContain("Açık sorular (0)");
    expect(html).toContain("Açık soru yok.");
    // kapsam çubuğu yerine metin
    expect(html).not.toContain('role="progressbar"');
    expect(html).toContain("Kapsam: %50 (özette alıntılanan mesajların oranı) · özete giren mesaj: 7");
    // alıntı düğmesi korunur
    expect(html).toContain("cite-link");
  });

  it("derin bağlantı çapası #yz (?bolum=yz) özetli ve özetsiz kartta; 'danışmandır' notu kartta bir kez (AiLabel notu tekrar edilmez)", () => {
    const html = render(<AiSummaryCard proposal={withSummary()} messages={new Map()} onNewAnalysis={() => undefined} />);
    expect(html).toMatch(/<section class="card"[^>]*\bid="yz"/);
    expect(html.match(/danışman|danışma niteliğinde/g)).toEqual(["danışman", "danışma niteliğinde"]); // altyazı + bölge adı (aria-label)
    expect(html).not.toContain("ai-note");
    expect(html).toContain('aria-label="Yapay zekâ çıktısı (danışma niteliğinde)"');
    const empty = render(<AiSummaryCard proposal={proposalOf()} messages={new Map()} onNewAnalysis={() => undefined} />);
    expect(empty).toMatch(/\bid="yz"/);
  });

  it("Tam: bölümler açık gelir; azınlık görüşleri yine açık", () => {
    setPrefSync(PREF_KEYS.detail, "tam");
    const html = render(<AiSummaryCard proposal={withSummary()} messages={new Map()} onNewAnalysis={() => undefined} />);
    expect(html.match(/<details[^>]*open/g)).toHaveLength(2);
    expect(html).toContain("AZINLIK-1");
  });

  it("Azınlık görüşü yoksa bölüm yine görünür ve nedenini söyler", () => {
    const html = render(
      <AiSummaryCard proposal={proposalOf({ aiAnalyses: [analysis({ ...summary, minorityViews: [] })] })} messages={new Map()} onNewAnalysis={() => undefined} />,
    );
    expect(html).toContain('aria-label="Azınlık görüşleri"');
    expect(html).toContain("Henüz azınlık görüşü yok.");
  });

  it("Özet yok: tek satır ve (V için) [Özet üret]; boş başlık ve boş durum kutusu yok", () => {
    const html = render(<AiSummaryCard proposal={proposalOf()} messages={new Map()} onNewAnalysis={() => undefined} />);
    expect(html).toContain("Henüz YZ özeti yok — azınlık görüşleri, özet üretilince ayrı bölümde gösterilir.");
    expect(html).toContain("Özet üret");
    expect(html).not.toContain("Henüz özet yok");
    expect(html).not.toContain('class="empty"');
    expect(html).not.toContain("<h4");
    expect(html).not.toContain("<details");
    canAll = false;
    const guest = render(<AiSummaryCard proposal={proposalOf()} messages={new Map()} onNewAnalysis={() => undefined} />);
    expect(guest).not.toContain("Özet üret");
    expect(guest).toContain("Özeti doğrulanmış üyeler üretebilir.");
  });
});
