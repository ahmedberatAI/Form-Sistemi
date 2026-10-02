// Öneri sayfasındaki denetim kartlarının başlık yanı hükümleri (saf işlevler) ve kartların açılış durumu (sunucu tarafı çizim,
// DOM gerekmez): sorun yoksa kapalı, sorun varsa kendiliğinden açık, 'Tam' görünümde sorunsuz da açık. Bkz. AuditCard,
// ParamsCard, IntegrityCard, PhaseTimeline, LedgerList, VersionHistory, ExpertPanelCard.
import type { AuditReport, DecisionParams, ExpertDrawRecord, IntegrityWarning, ProposalDetail } from "@forum/shared";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DetailLevelProvider } from "../../lib/detailLevel";
import { PREF_KEYS, removePref, setPrefSync } from "../../lib/prefs";
import { ToastProvider } from "../../ui/Toast";
import { AuditCard, auditHasProblem, auditSummary } from "./AuditCard";
import { drawLabel, ExpertPanelCard, expertEvidenceMeta } from "./ExpertPanelCard";
import { IntegrityCard, integritySummary } from "./IntegrityCard";
import { LedgerCard, ledgerSummary } from "./LedgerList";
import { ParamsCard, paramsSummary, quorumCount } from "./ParamsCard";
import { PhaseTimelineCard, phaseTimelineSummary } from "./PhaseTimeline";
import { VersionHistory, versionHistorySummary } from "./VersionHistory";

vi.mock("../../auth/AuthContext", () => ({
  useAuth: () => ({ can: () => true, user: null, now: () => Date.UTC(2026, 9, 2) }),
  useServerNow: () => () => Date.UTC(2026, 9, 2),
}));

const R = (num: number, den: number) => ({ num, den });
const params = {
  tier: "T0",
  quorum: R(1, 5),
  threshold: R(3, 5),
  thresholdStrict: false,
  clusterFloor: R(2, 5),
  authorClusterFloor: null,
  overrideThreshold: R(2, 3),
  revoteThreshold: R(2, 3),
  significantShare: R(1, 10),
  significantMinMembers: 3,
  minVotesPerCluster: 2,
  minClusteredForBridge: 4,
  coldStartBump: R(1, 20),
  delegationCapFraction: R(1, 20),
  delegationMaxHops: 3,
  sponsorsRequired: 2,
  requiresExpert: false,
  expertCount: 0,
  expertDomains: [],
  durationsHours: { sponsoring: 72, deliberation: 72, voting: 48, extension: 24, objection: 24, reconciliation: 24 },
} as unknown as DecisionParams;

const finding = (severity: "violation" | "warning" | "info", code: string) => ({ severity, code, message: `${code} iletisi` });

const audit = (over: Partial<AuditReport> = {}): AuditReport =>
  ({
    admissible: true,
    tier: "T0",
    params,
    categories: [],
    inferredClasses: [],
    rightsAffected: [],
    requiresExpert: false,
    violations: [],
    warnings: [finding("warning", "x")],
    infos: [],
    appliedRules: [],
    bylawVersion: 1,
    bylawHash: "ab".repeat(32),
    checkedAt: Date.UTC(2026, 8, 10),
    ...over,
  }) as AuditReport;

const lockstep = (round: number, groupSize: number) => ({ kind: "lockstep", round, groupSize, message: "m", detectedAt: round }) as IntegrityWarning;

const render = (el: React.ReactElement) =>
  renderToStaticMarkup(
    <DetailLevelProvider>
      <ToastProvider>
        <MemoryRouter>{el}</MemoryRouter>
      </ToastProvider>
    </DetailLevelProvider>,
  );

describe("hüküm cümleleri", () => {
  it("auditSummary: uygunluk, katman ve ihlal/uyarı sayıları", () => {
    expect(auditSummary(audit())).toBe("✔ Yönetmeliğe uygun · Olağan karar (T0) · 1 uyarı");
    expect(auditSummary(audit({ warnings: [] }))).toBe("✔ Yönetmeliğe uygun · Olağan karar (T0) · uyarı yok");
    expect(auditSummary(audit({ admissible: false, tier: "T3", violations: [finding("violation", "a"), finding("violation", "b")] }))).toBe(
      "✘ Yönetmeliğe aykırı · Değiştirilemez hüküm (T3) · 2 ihlal · 1 uyarı",
    );
  });

  it("auditHasProblem: aykırılık ya da en az bir ihlal sorundur, yalnız uyarı değildir", () => {
    expect(auditHasProblem({ admissible: true, violations: [] })).toBe(false);
    expect(auditHasProblem(audit())).toBe(false);
    expect(auditHasProblem({ admissible: false, violations: [] })).toBe(true);
    expect(auditHasProblem({ admissible: true, violations: [finding("violation", "v")] })).toBe(true);
  });

  it("quorumCount: yeter sayı bir ORANDIR; kişi karşılığı yalnız biliniyorsa yazılır", () => {
    expect(quorumCount(params, 100, null)).toBe(20);
    expect(quorumCount(params, 0, 7)).toBe(7); // uygun seçmen bilinmiyor → son sonuçtaki değer
    expect(quorumCount(params, undefined, 0)).toBeNull();
    expect(quorumCount(params, null, null)).toBeNull();
    expect(quorumCount({ quorum: R(1, 0) }, 100, null)).toBeNull(); // bozuk oran kişiye çevrilmez
  });

  it("paramsSummary: eşik, yeter sayı (oran ve varsa kişi sayısı) ve sabitlenme durumu", () => {
    expect(paramsSummary(params, true)).toBe("Onay eşiği ≥ %60 · yeter sayı: uygun seçmen oranı %20 · oylamada sabitlendi");
    expect(paramsSummary(params, false, 12)).toBe("Onay eşiği ≥ %60 · yeter sayı: en az 12 kişi (uygun seçmen oranı %20) · henüz sabitlenmedi");
    expect(paramsSummary({ ...params, thresholdStrict: true }, true)).toContain("Onay eşiği > %60");
  });

  it("integritySummary: grup sayısı ve en büyük grup; uyarı yoksa boş", () => {
    expect(integritySummary([])).toBe("");
    expect(integritySummary([lockstep(1, 6)])).toBe("⚠ Kilit adım oy grubu: 1 · en büyüğü 6 kişi · karar değişmedi");
    expect(integritySummary([lockstep(1, 6), lockstep(2, 3)])).toBe("⚠ Kilit adım oy grubu: 2 · en büyüğü 6 kişi · karar değişmedi");
  });

  it("phaseTimelineSummary: geçiş sayısı ve defterdeki oranı", () => {
    const ev = (ledgerTx: string | null) => ({ from: null, to: "sponsoring", at: 1, reason: "", ledgerTx });
    expect(phaseTimelineSummary({ events: [] })).toBe("Henüz evre geçişi yok");
    expect(phaseTimelineSummary({ events: [ev("a"), ev("b")] as never })).toBe("2 evre geçişi · hepsi defterde");
    expect(phaseTimelineSummary({ events: [ev("a"), ev(null)] as never })).toBe("2 evre geçişi · 1/2 defterde");
  });

  it("ledgerSummary: toplam işlem ve en yeni işlemin türü (sunucu toplamları listeden önce gelir)", () => {
    const txs = [
      { type: "TALLY", txHash: "h1", at: 5 },
      { type: "VOTE_COMMIT", txHash: "h2", at: 3 },
    ];
    expect(ledgerSummary([], undefined)).toBe("Henüz defter kaydı yok");
    expect(ledgerSummary(txs, undefined)).toBe("2 işlem · son: Sayım sonucu");
    expect(ledgerSummary(txs, { TALLY: 1, VOTE_COMMIT: 63 })).toBe("64 işlem · son: Sayım sonucu");
    // en yeni işlem listenin başında olmak zorunda değil
    expect(ledgerSummary([...txs].reverse(), undefined)).toBe("2 işlem · son: Sayım sonucu");
  });

  it("versionHistorySummary: sürüm sayısı ve son değişiklik tarihi (başka yıldaysa yıl da)", () => {
    const d = new Date(2026, 8, 10, 12).getTime();
    expect(versionHistorySummary([])).toBe("Sürüm kaydı yok");
    expect(versionHistorySummary([{ createdAt: d }])).toBe("1 sürüm · değişiklik yok");
    expect(versionHistorySummary([{ createdAt: d - 1000 }, { createdAt: d }])).toBe("2 sürüm · son değişiklik 10 Eyl");
    // sıra önemsiz: en yeni sürüm bulunur
    expect(versionHistorySummary([{ createdAt: d }, { createdAt: d - 86_400_000 }])).toBe("2 sürüm · son değişiklik 10 Eyl");
    expect(versionHistorySummary([{ createdAt: d - 1000 }, { createdAt: d }], new Date(2027, 1, 1).getTime())).toBe("2 sürüm · son değişiklik 10 Eyl 2026");
    expect(versionHistorySummary([{ createdAt: d - 1000 }, { createdAt: d }], new Date(2026, 11, 1).getTime())).toBe("2 sürüm · son değişiklik 10 Eyl");
  });

  it("expertEvidenceMeta ve drawLabel", () => {
    expect(expertEvidenceMeta({ round: 1, assignments: [1, 2, 3] as never, candidates: [1] as never })).toBe("1. kura · 3 atama · 1 aday");
    expect(expertEvidenceMeta({ round: 2, assignments: [], candidates: [] })).toBe("2. kura");
    const draw = (over: Partial<ExpertDrawRecord>) => ({ txHash: "h", kind: "panel", round: 1, at: 1, ...over }) as ExpertDrawRecord;
    expect(drawLabel(draw({}))).toBe("1. kura — panel çekilişi");
    expect(drawLabel(draw({ kind: "counter", round: 2 }))).toBe("2. kura — karşı bilirkişi paneli");
    expect(drawLabel(draw({ kind: "substitute", reason: "recused", substitute: 1 } as Partial<ExpertDrawRecord>))).toBe("1. kuranın 1. yedek çekilişi (çekinme sonrası)");
  });
});

describe("kartların açılış durumu ve hükmün yeri", () => {
  beforeEach(async () => {
    await removePref(PREF_KEYS.detail);
  });

  it("AuditCard: sorun yoksa kapalı; ihlalde açık ve hüküm danger renginde; 'Tam' kipte sorunsuz da açık", () => {
    const closed = render(<AuditCard audit={audit()} />);
    expect(closed).toContain('aria-expanded="false"');
    expect(closed).toContain("✔ Yönetmeliğe uygun · Olağan karar (T0) · 1 uyarı");
    expect(closed).toContain('id="ontoloji"');

    const bad = render(<AuditCard audit={audit({ admissible: false, tier: "T3", violations: [finding("violation", "immutable_target")] })} />);
    expect(bad).toContain('aria-expanded="true"');
    expect(bad).toContain("card-summary-danger");

    setPrefSync(PREF_KEYS.detail, "tam");
    expect(render(<AuditCard audit={audit()} />)).toContain('aria-expanded="true"');
  });

  it("AuditCard: denetim yoksa düz kart (ontoloji çapası kalır, düğme yok)", () => {
    const html = render(<AuditCard audit={null} />);
    expect(html).toContain('id="ontoloji"');
    expect(html).not.toContain("<button");
  });

  it("IntegrityCard: uyarı varsa iki kipte de açık; uyarı yoksa hiçbir şey çizilmez", () => {
    const w = [lockstep(1, 6)];
    expect(render(<IntegrityCard warnings={w} />)).toContain('aria-expanded="true"');
    setPrefSync(PREF_KEYS.detail, "tam");
    expect(render(<IntegrityCard warnings={w} />)).toContain('aria-expanded="true"');
    expect(render(<IntegrityCard warnings={[]} />)).not.toContain("<section");
  });

  it("ParamsCard: kapalı başlar, hüküm başlığın dışındadır; parametre yoksa düz kart", () => {
    const html = render(<ParamsCard params={params} status="voting" votingRound={1} eligible={100} />);
    expect(html).toContain('aria-expanded="false"');
    expect(html).toContain("yeter sayı: en az 20 kişi (uygun seçmen oranı %20)");
    expect(html).toContain('id="parametreler"');
    expect(render(<ParamsCard params={null} status="draft" votingRound={0} />)).not.toContain("<button");
  });

  it("PhaseTimelineCard: 'Sonraki evreler' açılırı sürüyorsa var, terminal evrede yok", () => {
    const base = {
      status: "deliberation",
      events: [{ from: null, to: "sponsoring", at: 1, reason: "r", ledgerTx: "ab".repeat(32) }],
      params,
      kind: "topic",
      createdAt: 1,
      phaseEndsAt: null,
    };
    const html = render(<PhaseTimelineCard proposal={base as unknown as ProposalDetail} />);
    expect(html).toContain("Sonraki evreler");
    expect(html).toContain('id="evreler"');
    expect(render(<PhaseTimelineCard proposal={{ ...base, status: "enacted" } as unknown as ProposalDetail} />)).not.toContain("Sonraki evreler");
  });

  it("LedgerCard: hüküm başlığın yanında, kart kapalı", () => {
    const html = render(<LedgerCard txs={[{ type: "TALLY", txHash: "ab".repeat(32), at: 5 }]} totals={undefined} />);
    expect(html).toContain("1 işlem · son: Sayım sonucu");
    expect(html).toContain('aria-expanded="false"');
  });

  it("VersionHistory: fark görünümü 'Sürümleri karşılaştır' açılırında; kapalı başlar, diffDefaultOpen ya da 'Tam' kipte açık", () => {
    const versions = [
      { version: 1, title: "a", body: "x", createdAt: 1, contentHash: "ab".repeat(32) },
      { version: 2, title: "a", body: "y", createdAt: 2, contentHash: "cd".repeat(32) },
    ];
    const closed = render(<VersionHistory current={2} versions={versions} />);
    expect(closed).toContain("Sürümleri karşılaştır");
    expect(closed).not.toMatch(/<details[^>]*open/);
    expect(render(<VersionHistory current={2} diffDefaultOpen versions={versions} />)).toMatch(/<details[^>]*open/);
    setPrefSync(PREF_KEYS.detail, "tam");
    expect(render(<VersionHistory current={2} versions={versions} />)).toMatch(/<details[^>]*open/);
  });

  it("ExpertPanelCard: kura kanıtı tek açılırda; raporlar ve sorular açılırın dışında", () => {
    const panel = {
      round: 1,
      createdAt: 1,
      isCounterPanel: false,
      noExpertAvailable: false,
      suspensiveFlag: false,
      seed: "ab".repeat(32),
      seedSource: { blockHeight: 3, blockHash: "cd".repeat(32), round: 1 },
      ledgerTx: null,
      assignments: [{ id: "a1", expertId: "e1", nickname: "bk", status: "assigned", dueAt: 5, recuseReason: null }],
      candidates: [{ userId: "u1", nickname: "adayx", weight: 1, softConflict: 0, excludedReason: null }],
      draws: [{ txHash: "ef".repeat(32), kind: "panel", round: 1, selected: 1, at: 2 }],
      reports: [],
      questions: [],
    };
    const p = { id: "p1", status: "deliberation", expertPanel: panel, expertQuestions: [], params: null } as unknown as ProposalDetail;
    const html = render(<ExpertPanelCard proposal={p} onUpdated={() => undefined} />);
    const evidenceStart = html.indexOf("Kura ve adillik kanıtı");
    expect(evidenceStart).toBeGreaterThan(-1);
    expect(html).toContain("1. kura · 1 atama · 1 aday");
    expect(html).toContain('id="kura"');
    expect(html).toContain('id="bilirkisi"');
    const detailsEnd = html.indexOf("</details>", html.lastIndexOf("Aday havuzu")) + "</details>".length;
    expect(html.indexOf("Bilirkişiye sorular (0)")).toBeGreaterThan(detailsEnd);
    for (const t of ["Kura tohumu", "Atamalar", "Kura kayıtları (1)", "Aday havuzu (1)"]) {
      expect(html.indexOf(t)).toBeGreaterThan(evidenceStart);
      expect(html.indexOf(t)).toBeLessThan(detailsEnd);
    }
  });
});
