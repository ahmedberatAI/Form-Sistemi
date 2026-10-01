import { describe, expect, it } from "vitest";
import {
  ALGO_VERSION,
  decide,
  delegationCap,
  evaluateObjection,
  floorAbs,
  laplaceSupport,
  quorumRequired,
  rat,
  revealHash,
  sha256Hex,
  sponsorsRequired,
  verifyTally,
  voteCommitment,
  type DecisionInput,
  type DecisionParams,
  type EffectiveVote,
  type RevealEntry,
  type TallyPayload,
  type VoteChoice,
} from "@forum/shared";
import { defaultDecisionParams } from "../../src/governance";

const NOW = Date.UTC(2026, 9, 1);
const SIZES = { g0: 60, g1: 30, g2: 10 };

type Counts = [yes: number, no: number, abstain?: number];

/** { g0: [y, n, a], "-": [...] (kümelenmemiş) } → etkin oylar */
function votes(spec: Record<string, Counts>, tag = ""): EffectiveVote[] {
  const out: EffectiveVote[] = [];
  for (const [g, [y, n, a = 0]] of Object.entries(spec)) {
    const cluster = g === "-" ? null : g;
    const push = (choice: VoteChoice, count: number) => {
      for (let i = 0; i < count; i++) out.push({ voterKey: `${g}${tag}-${choice}-${i}`, choice, via: "direct", clusterId: cluster });
    };
    push("yes", y);
    push("no", n);
    push("abstain", a);
  }
  return out;
}

function input(over: Partial<DecisionInput> & { votes: EffectiveVote[] }): DecisionInput {
  return {
    params: defaultDecisionParams("T0"),
    round: 1,
    eligibleCount: 100,
    clusterSizes: SIZES,
    clusteredTotal: 100,
    k: 3,
    extensionAvailable: false,
    now: NOW,
    ...over,
  };
}

const T = (tier: "T0" | "T1" | "T2" | "DEL") => defaultDecisionParams(tier);
const check = (r: ReturnType<typeof decide>, key: string) => r.checks.find((c) => c.key === key);

// ───────────────────────── Yardımcı formüller ─────────────────────────

describe("floorAbs = ⌈1,5·√|E|⌉", () => {
  it("bilinen değerler", () => {
    const table: [number, number][] = [
      [0, 0], [1, 2], [2, 3], [3, 3], [4, 3], [5, 4], [8, 5], [9, 5], [10, 5], [15, 6], [16, 6], [17, 7],
      [30, 9], [36, 9], [37, 10], [40, 10], [100, 15], [101, 16], [400, 30], [10000, 150],
    ];
    for (const [e, f] of table) expect(floorAbs(e), `|E|=${e}`).toBe(f);
  });
  it("tamsayı tanımıyla birebir (en küçük f, 4f² ≥ 9|E|) — 1..5000", () => {
    let f = 0;
    for (let e = 1; e <= 5000; e++) {
      while (4 * f * f < 9 * e) f++;
      expect(floorAbs(e)).toBe(f);
    }
  });
});

describe("quorumRequired = min(|E|, max(⌈q·|E|⌉, floor_abs))", () => {
  it("büyük topluluklarda q·|E| ya da floor_abs'ın büyüğü", () => {
    expect(quorumRequired(rat(1, 5), 40)).toBe(10); // ⌈8⌉ < 10 (ALGORITMA §4.2 örneği: 18/40 ≥ 10)
    expect(quorumRequired(rat(1, 5), 100)).toBe(20);
    expect(quorumRequired(rat(2, 5), 100)).toBe(40);
    expect(quorumRequired(rat(3, 10), 15)).toBe(6); // ⌈4,5⌉=5 < floor_abs=6
    expect(quorumRequired(rat(1, 5), 1000)).toBe(200);
  });
  it("küçük |E|: gerekli katılım |E|'yi aşmaz (kabul imkânsız olmasın)", () => {
    expect(quorumRequired(rat(1, 5), 8)).toBe(5);
    expect(quorumRequired(rat(1, 5), 4)).toBe(3);
    expect(quorumRequired(rat(1, 5), 2)).toBe(2); // floor_abs(2)=3 > |E|
    expect(quorumRequired(rat(1, 5), 1)).toBe(1);
    expect(quorumRequired(rat(1, 5), 0)).toBe(0);
  });
});

describe("sponsorsRequired = max(2, min(5, ⌈√|M|/2⌉)); DEL = 1", () => {
  it("sınır değerleri", () => {
    const table: [number, number][] = [[0, 2], [1, 2], [16, 2], [17, 3], [36, 3], [37, 4], [64, 4], [65, 5], [100, 5], [101, 5], [10000, 5]];
    for (const [m, k] of table) expect(sponsorsRequired(m, "T0"), `|M|=${m}`).toBe(k);
    expect(sponsorsRequired(10000, "DEL")).toBe(1);
    expect(sponsorsRequired(5, null)).toBe(2);
  });
});

describe("delegationCap = max(2, ⌈0,05·|E|⌉)", () => {
  it("sınır değerleri", () => {
    expect(delegationCap(0)).toBe(2);
    expect(delegationCap(40)).toBe(2);
    expect(delegationCap(41)).toBe(3);
    expect(delegationCap(100)).toBe(5);
    expect(delegationCap(101)).toBe(6);
    expect(delegationCap(1000)).toBe(50);
    expect(delegationCap(100, rat(1, 10))).toBe(10);
  });
});

describe("laplaceSupport P_g = (1+Y)/(2+Y+N)", () => {
  it("indirgenmiş rasyonel döner", () => {
    expect(laplaceSupport(0, 0)).toEqual({ num: 1, den: 2 });
    expect(laplaceSupport(1, 0)).toEqual({ num: 2, den: 3 });
    expect(laplaceSupport(0, 1)).toEqual({ num: 1, den: 3 });
    expect(laplaceSupport(3, 7)).toEqual({ num: 1, den: 3 });
    expect(laplaceSupport(1, 2)).toEqual({ num: 2, den: 5 });
  });
});

describe("defaultDecisionParams (ALGORITMA §2 tablosu)", () => {
  it("katman parametreleri", () => {
    expect(T("T0")).toMatchObject({ quorum: rat(1, 5), threshold: rat(1, 2), thresholdStrict: true, clusterFloor: rat(3, 10), overrideThreshold: rat(2, 3), revoteThreshold: rat(3, 5), authorClusterFloor: null });
    expect(T("T1")).toMatchObject({ quorum: rat(3, 10), threshold: rat(3, 5), thresholdStrict: false, clusterFloor: rat(2, 5), overrideThreshold: rat(2, 3), revoteThreshold: rat(3, 5) });
    expect(T("T2")).toMatchObject({ quorum: rat(2, 5), threshold: rat(2, 3), thresholdStrict: false, clusterFloor: rat(2, 5), overrideThreshold: rat(3, 4), revoteThreshold: rat(2, 3) });
    expect(T("DEL")).toMatchObject({ quorum: rat(3, 10), threshold: rat(2, 3), thresholdStrict: false, clusterFloor: rat(3, 10), authorClusterFloor: rat(1, 2), overrideThreshold: rat(3, 4), revoteThreshold: rat(3, 4), sponsorsRequired: 1 });
    expect(T("T0")).toMatchObject({ significantShare: rat(1, 10), significantMinMembers: 3, minVotesPerCluster: 2, minClusteredForBridge: 12, coldStartBump: rat(1, 10), delegationCapFraction: rat(1, 20), delegationMaxHops: 3 });
    expect(defaultDecisionParams("T0", { verifiedMembers: 100 }).sponsorsRequired).toBe(5);
  });
});

// ───────────────────────── decide: ilk tur ─────────────────────────

describe("decide — T0 olağan", () => {
  it("genel çoğunluk + tüm anlamlı kümelerde köprü → accept; checks anahtarları ve Türkçe metinler", () => {
    const r = decide(input({ votes: votes({ g0: [30, 5], g1: [10, 5], g2: [3, 2] }) }));
    expect(r.outcome).toBe("accept");
    expect(r.algoVersion).toBe(ALGO_VERSION);
    expect(r.totals).toEqual({ eligible: 100, participants: 55, yes: 43, no: 12, abstain: 0, delegated: 0, unrouted: 0 });
    expect(r.quorumRequired).toBe(20);
    expect(r.quorumMet && r.thresholdMet && r.bridgeApplicable).toBe(true);
    expect(r.bridgeMet).toBe(true);
    expect(r.overrideMet).toBeNull();
    expect(r.checks.map((c) => c.key)).toEqual(["quorum", "threshold", "bridge:g0", "bridge:g1", "bridge:g2"]);
    expect(check(r, "quorum")).toMatchObject({ label: "Katılım (yeter sayı)", passed: true, value: "55/100", required: "≥ 20" });
    expect(check(r, "quorum")!.detail).toContain("⌈1,5·√100⌉ = 15");
    expect(check(r, "threshold")).toMatchObject({ label: "Onay oranı", passed: true, value: "%78,2 (43 kabul / 12 red)", required: "> %50,0" });
    expect(check(r, "threshold")!.detail).toBe("Çekimser oylar katılıma sayılır, onay oranına sayılmaz.");
    expect(check(r, "bridge:g2")).toMatchObject({ label: "Görüş Grubu C desteği (köprü testi)", passed: true, value: "P=0,57 (3 kabul / 2 red)", required: "≥ 0,30" });
    expect(r.reason).toContain("köprü desteği sağlandı");
    expect(r.clusters.map((c) => [c.clusterId, c.label, c.members, c.significant, c.passed])).toEqual([
      ["g0", "Görüş Grubu A", 60, true, true],
      ["g1", "Görüş Grubu B", 30, true, true],
      ["g2", "Görüş Grubu C", 10, true, true],
    ]);
    expect(r.computedAt).toBe(NOW);
  });

  it("T0 kesin eşik: tam %50 → reject; bir oy fazlası → accept", () => {
    const tie = decide(input({ votes: votes({ g0: [10, 10], g1: [5, 5], g2: [2, 2] }) }));
    expect(tie.thresholdMet).toBe(false);
    expect(tie.outcome).toBe("reject");
    expect(tie.reason).toContain("altında kaldı");
    expect(tie.thresholdStrict).toBe(true);
    const plus = decide(input({ votes: votes({ g0: [11, 10], g1: [5, 5], g2: [2, 2] }) }));
    expect(plus.outcome).toBe("accept");
  });

  it("Y+N=0 (yalnız çekimser) → a=0, eşik sağlanmaz", () => {
    const r = decide(input({ votes: votes({ g0: [0, 0, 25] }) }));
    expect(r.approval).toBe(0);
    expect(r.quorumMet).toBe(true);
    expect(r.thresholdMet).toBe(false);
    expect(r.outcome).toBe("reject");
  });

  it("aktif 'hayır' diyen azınlık → contested (gerekçede kümenin adı)", () => {
    const r = decide(input({ votes: votes({ g0: [40, 2], g1: [15, 5], g2: [0, 8] }) }));
    expect(r.thresholdMet).toBe(true);
    expect(r.bridgeMet).toBe(false);
    expect(r.outcome).toBe("contested");
    expect(check(r, "bridge:g2")).toMatchObject({ passed: false, value: "P=0,10 (0 kabul / 8 red)" });
    expect(r.reason).toContain("Görüş Grubu C");
    expect(r.reason).toContain("uzlaşma turu");
  });

  it("boykot eden küme engel olamaz: önce bir kez uzatma, sonra P_g = 1/2 ≥ φ (nötr) → accept", () => {
    const v = votes({ g0: [40, 5], g1: [15, 5] });
    const first = decide(input({ votes: v, extensionAvailable: true }));
    expect(first.outcome).toBe("needs_more_votes");
    expect(first.reason).toContain("bir kez uzatılıyor");
    expect(check(first, "participation_shortfall")).toMatchObject({ passed: false, detail: "Oylama bir kez uzatılır." });
    const after = decide(input({ votes: v, extensionAvailable: false }));
    expect(after.outcome).toBe("accept");
    expect(after.clusters.find((c) => c.clusterId === "g2")!.pg).toBe(0.5);
    expect(check(after, "bridge:g2")).toMatchObject({ passed: true, value: "P=0,50 (0 kabul / 0 red)" });
    expect(check(after, "bridge:g2")!.detail).toContain("Küme yeterince katılmadı");
    expect(check(after, "participation_shortfall")!.detail).toContain("Uzatma kullanıldı");
    // T1 (φ = 0,40) için de boykot engel değildir
    expect(decide(input({ params: T("T1"), votes: v })).outcome).toBe("accept");
  });

  it("μ_votes: tam 2 kabul/red oyu yeterli; 1 oy → yalnız uzatma varken needs_more_votes; çekimser sayılmaz", () => {
    expect(decide(input({ votes: votes({ g0: [40, 5], g1: [15, 5], g2: [1, 1] }), extensionAvailable: true })).outcome).toBe("accept");
    const one = votes({ g0: [40, 5], g1: [15, 5], g2: [1, 0] });
    expect(decide(input({ votes: one, extensionAvailable: true })).outcome).toBe("needs_more_votes");
    expect(decide(input({ votes: one, extensionAvailable: false })).outcome).toBe("accept");
    const abst = votes({ g0: [40, 5], g1: [15, 5], g2: [0, 0, 5] });
    expect(decide(input({ votes: abst, extensionAvailable: true })).outcome).toBe("needs_more_votes");
  });

  it("uzatma sonrası eksik kümede tek 'hayır': T0'da P=1/3 ≥ 0,30 geçer, T1'de 1/3 < 0,40 → contested", () => {
    const v = votes({ g0: [40, 5], g1: [15, 5], g2: [0, 1] });
    expect(decide(input({ votes: v })).outcome).toBe("accept");
    expect(decide(input({ params: T("T1"), votes: v })).outcome).toBe("contested");
  });

  it("yeter sayı: 19/20 → uzatma varken needs_more_votes, yoksa reject; tam 20 → geçer; çekimser katılıma sayılır", () => {
    const low = votes({ g0: [10, 2], g1: [4, 1], g2: [1, 1] }); // 19
    const ext = decide(input({ votes: low, extensionAvailable: true }));
    expect(ext.outcome).toBe("needs_more_votes");
    expect(ext.reason).toContain("Katılım yetersiz (19/20)");
    const rej = decide(input({ votes: low }));
    expect(rej.outcome).toBe("reject");
    expect(rej.quorumMet).toBe(false);
    expect(rej.reason).toContain("Yeter sayıya ulaşılamadı (19 katılım, gerekli 20)");
    expect(decide(input({ votes: votes({ g0: [11, 2], g1: [4, 1], g2: [1, 1] }) })).quorumMet).toBe(true);
    const withAbstain = decide(input({ votes: votes({ g0: [10, 2, 1], g1: [4, 1], g2: [1, 1] }) }));
    expect(withAbstain.totals.participants).toBe(20);
    expect(withAbstain.quorumMet).toBe(true);
  });

  it("kümelenmemiş seçmenler genel onaya ve katılıma sayılır, köprüye katılmaz", () => {
    const r = decide(input({ eligibleCount: 120, votes: votes({ g0: [10, 0], g1: [5, 0], g2: [2, 0], "-": [0, 16] }) }));
    expect(r.totals.participants).toBe(33);
    expect(r.thresholdMet).toBe(true); // 17 > 16
    expect(r.clusters.every((c) => c.passed === true)).toBe(true);
    expect(r.outcome).toBe("accept");
  });

  it("anlamlı küme sınırı σ_share: tam %10 anlamlı, altı değil", () => {
    const v = votes({ g0: [40, 2], g1: [10, 2], g2: [0, 6] });
    const exact = decide(input({ clusterSizes: { g0: 90, g1: 18, g2: 12 }, clusteredTotal: 120, votes: v }));
    expect(exact.clusters.find((c) => c.clusterId === "g2")!.significant).toBe(true);
    expect(exact.outcome).toBe("contested");
    const below = decide(input({ clusterSizes: { g0: 91, g1: 18, g2: 11 }, clusteredTotal: 120, votes: v }));
    const g2 = below.clusters.find((c) => c.clusterId === "g2")!;
    expect(g2.significant).toBe(false);
    expect(g2.passed).toBeNull();
    expect(g2.floor).toBeNull();
    expect(check(below, "bridge:g2")).toBeUndefined();
    expect(below.outcome).toBe("accept");
  });

  it("anlamlı küme sınırı σ_min: payı %10 olsa da 2 üyeli küme anlamlı değil; 3 üye anlamlı", () => {
    const v = votes({ g0: [8, 0], g1: [4, 0], g2: [0, 2] });
    const two = decide(input({ eligibleCount: 20, clusterSizes: { g0: 12, g1: 6, g2: 2 }, clusteredTotal: 20, votes: v }));
    expect(two.clusters.find((c) => c.clusterId === "g2")!.significant).toBe(false);
    expect(two.outcome).toBe("accept");
    const three = decide(input({ eligibleCount: 30, clusterSizes: { g0: 20, g1: 7, g2: 3 }, clusteredTotal: 30, votes: v }));
    expect(three.clusters.find((c) => c.clusterId === "g2")!.significant).toBe(true);
    expect(three.outcome).toBe("contested");
  });

  it("GAC: anlamlı kümelerin P_g geometrik ortalaması", () => {
    const r = decide(input({ votes: votes({ g0: [30, 5], g1: [10, 5], g2: [3, 2] }) }));
    const expected = Math.pow((31 / 37) * (11 / 17) * (4 / 7), 1 / 3);
    expect(r.gac).toBeCloseTo(expected, 12);
  });

  it("vekâletle gelen oy sayılır; unrouted yalnız raporlanır", () => {
    const v = votes({ g0: [30, 5], g1: [10, 5], g2: [3, 2] });
    v[0] = { ...v[0], via: "delegated" };
    v[1] = { ...v[1], via: "delegated" };
    const r = decide(input({ votes: v, unrouted: 4 }));
    expect(r.totals.delegated).toBe(2);
    expect(r.totals.unrouted).toBe(4);
  });
});

describe("decide — soğuk başlangıç (§4.4)", () => {
  it("n_C < 12 → köprü uygulanamaz; T0 eşiği 0,60 ve ≥", () => {
    const base = { clusterSizes: { g0: 7, g1: 4 }, clusteredTotal: 11, k: 2, eligibleCount: 20 };
    const exact = decide(input({ ...base, votes: votes({ "-": [6, 4] }) }));
    expect(exact.bridgeApplicable).toBe(false);
    expect(exact.bridgeMet).toBeNull();
    expect(exact.thresholdUsed).toEqual(rat(3, 5));
    expect(exact.thresholdStrict).toBe(false);
    expect(exact.outcome).toBe("accept");
    expect(exact.reason).toContain("soğuk başlangıç");
    expect(check(exact, "cold_start")).toMatchObject({ label: "Görüş verisi (soğuk başlangıç)", passed: true, value: "kümelenmiş 11 kişi, K=2", required: "≥ 12 kişi ve K ≥ 2" });
    expect(check(exact, "cold_start")!.detail).toContain("Yeterli görüş verisi yok");
    expect(check(exact, "threshold")!.required).toBe("≥ %60,0");
    // 5/9 > 1/2 ama < 0,60
    expect(decide(input({ ...base, votes: votes({ "-": [5, 4] }) })).outcome).toBe("reject");
  });

  it("n_C tam 12 ve K ≥ 2 → köprü uygulanır; K = 1 → soğuk başlangıç", () => {
    const v = votes({ g0: [6, 3], g1: [2, 1] });
    expect(decide(input({ eligibleCount: 12, clusterSizes: { g0: 8, g1: 4 }, clusteredTotal: 12, k: 2, votes: v })).bridgeApplicable).toBe(true);
    const k1 = decide(input({ eligibleCount: 40, clusterSizes: { g0: 40 }, clusteredTotal: 40, k: 1, votes: v }));
    expect(k1.bridgeApplicable).toBe(false);
    expect(k1.thresholdUsed).toEqual(rat(3, 5));
  });

  it("hiç anlamlı küme yoksa köprü uygulanamaz (yorum 3)", () => {
    const sizes: Record<string, number> = {};
    for (let i = 0; i < 7; i++) sizes[`g${i}`] = 2;
    const r = decide(input({ eligibleCount: 14, clusterSizes: sizes, clusteredTotal: 14, k: 7, votes: votes({ g0: [2, 0], g1: [2, 0], g2: [0, 2] }) }));
    expect(r.clusters.every((c) => !c.significant)).toBe(true);
    expect(r.bridgeApplicable).toBe(false);
    expect(check(r, "cold_start")).toBeDefined();
  });

  it("τ+δ en çok 2/3: T1 → 2/3 (0,70 değil), T2 ve DEL → 2/3; tam 2/3 kabul", () => {
    const cold = { clusterSizes: {}, clusteredTotal: 0, k: 1, eligibleCount: 30 };
    for (const tier of ["T1", "T2", "DEL"] as const) {
      const ok = decide(input({ ...cold, params: T(tier), votes: votes({ "-": [10, 5] }) }));
      expect(ok.thresholdUsed, tier).toEqual(rat(2, 3));
      expect(ok.outcome, tier).toBe("accept");
      expect(decide(input({ ...cold, params: T(tier), votes: votes({ "-": [13, 7] }) })).outcome, tier).toBe("reject"); // 0,65
    }
  });
});

describe("decide — T1 / T2 rasyonel sınırlar", () => {
  it("T1: a = 0,6 tam → kabul; 0,59 → red; φ = 0,40 tam sınırda geçer", () => {
    expect(decide(input({ params: T("T1"), votes: votes({ g0: [18, 10], g1: [10, 5], g2: [2, 2] }) })).outcome).toBe("accept"); // 30/50
    expect(decide(input({ params: T("T1"), votes: votes({ g0: [40, 30], g1: [17, 9], g2: [2, 2] }) })).outcome).toBe("reject"); // 59/100
    const exactFloor = decide(input({ params: T("T1"), votes: votes({ g0: [40, 5], g1: [15, 5], g2: [1, 2] }) }));
    expect(exactFloor.clusters.find((c) => c.clusterId === "g2")!.passed).toBe(true); // 2/5
    expect(exactFloor.outcome).toBe("accept");
    const below = decide(input({ params: T("T1"), votes: votes({ g0: [40, 5], g1: [15, 5], g2: [1, 3] }) }));
    expect(below.outcome).toBe("contested"); // 2/6 < 2/5
    expect(check(below, "bridge:g2")!.required).toBe("≥ 0,40");
  });

  it("T2: a = 2/3 tam → kabul; 19/29 → red; yeter sayı %40", () => {
    const ok = decide(input({ params: T("T2"), votes: votes({ g0: [12, 6], g1: [6, 3], g2: [2, 1] }) }));
    expect(ok.quorumRequired).toBe(40);
    expect(ok.quorumMet).toBe(false);
    const big = decide(input({ params: T("T2"), votes: votes({ g0: [16, 8], g1: [8, 4], g2: [4, 2] }) })); // 28/42
    expect(big.quorumMet).toBe(true);
    expect(big.thresholdMet).toBe(true);
    expect(big.outcome).toBe("accept");
    expect(check(big, "threshold")!.required).toBe("≥ %66,7");
    const under = decide(input({ params: T("T2"), votes: votes({ g0: [15, 8], g1: [8, 4], g2: [4, 2] }) })); // 27/41
    expect(under.outcome).toBe("reject");
  });
});

describe("decide — DEL (silme) yazar kümesi koruması", () => {
  const del = (over: Partial<DecisionInput> & { votes: EffectiveVote[] }) => input({ params: T("DEL"), ...over });

  it("yazarın kümesinde P < 0,50 → contested (köprü tabanı 0,30 geçilse bile)", () => {
    const r = decide(del({ authorClusterId: "g1", votes: votes({ g0: [40, 2], g1: [4, 6], g2: [3, 1] }) }));
    expect(check(r, "bridge:g1")!.passed).toBe(true); // 5/12 ≥ 0,30
    expect(check(r, "author_cluster")).toMatchObject({ label: "Mesaj yazarının kümesi (Görüş Grubu B)", passed: false, value: "P=0,42 (4 kabul / 6 red)", required: "≥ 0,50" });
    expect(r.bridgeMet).toBe(false);
    expect(r.outcome).toBe("contested");
    expect(r.reason).toContain("mesaj yazarının kümesi");
  });

  it("yazarın kümesinde P = 0,50 tam → geçer", () => {
    const r = decide(del({ authorClusterId: "g1", votes: votes({ g0: [40, 2], g1: [5, 5], g2: [3, 1] }) }));
    expect(check(r, "author_cluster")!.passed).toBe(true);
    expect(r.outcome).toBe("accept");
  });

  it("yazar kümelenmemişse koşul uygulanmaz", () => {
    const r = decide(del({ authorClusterId: null, votes: votes({ g0: [40, 2], g1: [8, 6], g2: [3, 1] }) }));
    expect(check(r, "author_cluster")).toBeUndefined();
    expect(r.outcome).toBe("accept");
  });

  it("yazarın kümesi anlamlı olmasa da (küçük) koşul uygulanır", () => {
    const r = decide(del({ authorClusterId: "g3", clusterSizes: { ...SIZES, g3: 2 }, clusteredTotal: 102, votes: votes({ g0: [40, 2], g1: [10, 2], g2: [3, 1], g3: [0, 2] }) }));
    expect(r.clusters.find((c) => c.clusterId === "g3")!.significant).toBe(false);
    expect(check(r, "author_cluster")!.passed).toBe(false);
    expect(r.outcome).toBe("contested");
  });

  it("köprü uygulanamasa da (soğuk başlangıç) yazar kümelenmişse koruma uygulanır (yorum 2)", () => {
    const r = decide(del({ eligibleCount: 15, authorClusterId: "g1", clusterSizes: { g0: 6, g1: 4 }, clusteredTotal: 10, k: 2, votes: votes({ g0: [6, 0], "-": [3, 0], g1: [0, 2] }) }));
    expect(r.bridgeApplicable).toBe(false);
    expect(r.thresholdMet).toBe(true); // 9/11 ≥ 2/3
    expect(r.bridgeMet).toBe(false);
    expect(r.outcome).toBe("contested");
  });

  it("DEL eşiği 2/3 ≥ (tam 2/3 kabul)", () => {
    const r = decide(del({ authorClusterId: "g0", votes: votes({ g0: [14, 6], g1: [4, 2], g2: [2, 2] }) })); // 20/30
    expect(r.thresholdMet).toBe(true);
    expect(r.outcome).toBe("accept");
  });
});

// ───────────────────────── decide: yeniden oylama ─────────────────────────

describe("decide — yeniden oylama (round 2)", () => {
  const contested = { round: 2 as const, revote: { origin: "contested" as const, strongObjection: false } };
  const objection = (strong = false) => ({ round: 2 as const, revote: { origin: "objection" as const, strongObjection: strong } });

  it("contested kökenli: köprü artık sağlanıyorsa kabul", () => {
    const r = decide(input({ ...contested, votes: votes({ g0: [30, 10], g1: [10, 5], g2: [2, 3] }) }));
    expect(r.outcome).toBe("accept");
    expect(r.reason).toBe("Yeniden oylamada genel onay ve köprü desteği sağlandı.");
    expect(check(r, "override")).toMatchObject({ label: "Aşma eşiği (yeniden oylama)", required: "≥ %66,7" });
  });

  it("contested kökenli: köprü yine sağlanamazsa a ≥ ω (2/3 tam) ile aşılır; altında red", () => {
    const over = decide(input({ ...contested, votes: votes({ g0: [30, 2], g1: [10, 8], g2: [0, 10] }) })); // 40/60
    expect(over.bridgeMet).toBe(false);
    expect(over.overrideMet).toBe(true);
    expect(over.outcome).toBe("accept");
    expect(over.reason).toContain("aşma eşiği (%66,7) sağlandı");
    const under = decide(input({ ...contested, votes: votes({ g0: [29, 2], g1: [10, 9], g2: [0, 10] }) })); // 39/60
    expect(under.overrideMet).toBe(false);
    expect(under.outcome).toBe("reject");
    expect(under.reason).toContain("ne köprü desteği ne de aşma eşiği");
  });

  it("ikinci turda contested dönmez; T2/DEL için ω = 3/4", () => {
    const v = votes({ g0: [40, 2], g1: [10, 8], g2: [0, 10] }); // 50/70 = 0,714
    for (const tier of ["T2", "DEL"] as const) {
      const r = decide(input({ ...contested, params: T(tier), votes: v }));
      expect(r.outcome, tier).toBe("reject");
      expect(r.overrideMet, tier).toBe(false);
    }
    expect(decide(input({ ...contested, params: T("T1"), votes: v })).outcome).toBe("accept");
    const ok = decide(input({ ...contested, params: T("T2"), votes: votes({ g0: [45, 3], g1: [15, 2], g2: [0, 10] }) })); // 60/75
    expect(ok.outcome).toBe("accept");
  });

  it("yeniden oylamada uzatma bir kez daha kullanılabilir (yeter sayı ya da küme eksiği)", () => {
    const low = votes({ g0: [10, 2], g1: [4, 1], g2: [1, 1] });
    expect(decide(input({ ...contested, votes: low, extensionAvailable: true })).outcome).toBe("needs_more_votes");
    expect(decide(input({ ...contested, votes: low, extensionAvailable: false })).outcome).toBe("reject");
    const shortfall = votes({ g0: [40, 2], g1: [10, 8], g2: [0, 1] });
    expect(decide(input({ ...contested, votes: shortfall, extensionAvailable: true })).outcome).toBe("needs_more_votes");
  });

  it("itiraz kökenli: a ≥ ρ (0,60 tam) kabul, altı red; küme tabanları uygulanmaz ama hesaplanır", () => {
    const r = decide(input({ ...objection(), votes: votes({ g0: [28, 10], g1: [2, 0], g2: [0, 10] }) })); // 30/50
    expect(r.outcome).toBe("accept");
    expect(r.clusters.find((c) => c.clusterId === "g2")!.pg).toBeCloseTo(1 / 12, 12);
    expect(check(r, "revote_threshold")).toMatchObject({ label: "Yeniden oylama eşiği (itiraz sonrası)", passed: true, required: "≥ %60,0" });
    expect(check(r, "revote_threshold")!.detail).toContain("Küme tabanları bu turda uygulanmaz");
    expect(r.reason).toContain("%60,0 eşiği sağlandı");
    const under = decide(input({ ...objection(), votes: votes({ g0: [57, 30], g1: [2, 1], g2: [0, 10] }) })); // 59/100
    expect(under.outcome).toBe("reject");
  });

  it("itiraz kökenli: küme oy eksiği uzatma tetiklemez (köprü bu turda kullanılmaz)", () => {
    const r = decide(input({ ...objection(), votes: votes({ g0: [30, 10], g1: [10, 5], g2: [0, 0] }), extensionAvailable: true }));
    expect(r.outcome).toBe("accept");
    expect(check(r, "participation_shortfall")).toBeUndefined();
  });

  it("güçlü itiraz: ρ' = max(ρ, 2/3)", () => {
    const sixty = votes({ g0: [28, 10], g1: [2, 0], g2: [0, 10] }); // 0,60
    const twoThirds = votes({ g0: [30, 5], g1: [10, 5], g2: [0, 10] }); // 40/60
    expect(decide(input({ ...objection(true), votes: sixty })).outcome).toBe("reject");
    const r = decide(input({ ...objection(true), votes: twoThirds }));
    expect(r.outcome).toBe("accept");
    expect(check(r, "revote_threshold")!.required).toBe("≥ %66,7");
    expect(check(r, "revote_threshold")!.detail).toContain("2/3");
    // DEL: ρ = 3/4 > 2/3 kalır
    const del = decide(input({ ...objection(true), params: T("DEL"), votes: twoThirds }));
    expect(del.outcome).toBe("reject");
    expect(check(del, "revote_threshold")!.required).toBe("≥ %75,0");
  });
});

describe("decide — hatalar ve özet", () => {
  it("yinelenen voterKey hata verir", () => {
    const v = votes({ g0: [3, 0] });
    v.push({ ...v[0] });
    expect(() => decide(input({ votes: v }))).toThrow(/yinelenen oy anahtarı/);
  });
  it("T3 oylanamaz", () => {
    const p: DecisionParams = { ...T("T0"), tier: "T3" };
    expect(() => decide(input({ params: p, votes: [] }))).toThrow(/T3/);
  });
  it("round=2 revote bilgisi ister", () => {
    expect(() => decide(input({ round: 2, votes: [] }))).toThrow(/revote/);
  });
  it("inputsHash oy sırasından bağımsız; oy değişince değişir; now özetlenmez", () => {
    const v = votes({ g0: [30, 5], g1: [10, 5], g2: [3, 2] });
    const a = decide(input({ votes: v }));
    const b = decide(input({ votes: v.slice().reverse(), now: NOW + 1 }));
    expect(a.inputsHash).toBe(b.inputsHash);
    const changed = v.slice();
    changed[0] = { ...changed[0], choice: "no" };
    expect(decide(input({ votes: changed })).inputsHash).not.toBe(a.inputsHash);
  });
  it("|E| = 0 ve hiç oy yoksa yeter sayı sağlanmaz", () => {
    const r = decide(input({ eligibleCount: 0, clusterSizes: {}, clusteredTotal: 0, k: 1, votes: [] }));
    expect(r.quorumRequired).toBe(0);
    expect(r.quorumMet).toBe(false);
    expect(r.outcome).toBe("reject");
  });
  it("küçük |E|: |E| = 2 iken iki oyla kabul mümkün", () => {
    const r = decide(input({ eligibleCount: 2, clusterSizes: {}, clusteredTotal: 0, k: 1, votes: votes({ "-": [2, 0] }) }));
    expect(r.quorumRequired).toBe(2);
    expect(r.outcome).toBe("accept");
  });
  it("küçük |E| = 8: floor_abs = 5 baskın; 4 katılım yetmez", () => {
    const base = { eligibleCount: 8, clusterSizes: {}, clusteredTotal: 0, k: 1 };
    expect(decide(input({ ...base, votes: votes({ "-": [4, 0] }) })).outcome).toBe("reject");
    expect(decide(input({ ...base, votes: votes({ "-": [3, 2] }) })).outcome).toBe("accept"); // 0,6 ≥ 0,6
  });
});

// ───────────────────────── evaluateObjection (§6) ─────────────────────────

describe("evaluateObjection", () => {
  const firstRound = votes({ g0: [40, 4], g1: [10, 5], g2: [1, 8] });
  const noKeys = (g: string, n: number) => Array.from({ length: n }, (_, i) => ({ voterKey: `${g}-no-${i}`, clusterId: g === "-" ? null : g }));
  const base = { eligibleCount: 100, firstRoundVotes: firstRound, clusterSizes: SIZES, clusteredTotal: 100, params: T("T0") };

  it("kural (a): anlamlı kümede imzacı ≥ max(3, ⌈0,75·N_g⌉)", () => {
    const ok = evaluateObjection({ ...base, signatures: noKeys("g2", 6) }); // ⌈6⌉
    expect(ok.valid).toBe(true);
    expect(ok.rule).toBe("cluster");
    expect(ok.perCluster.find((p) => p.clusterId === "g2")).toEqual({ clusterId: "g2", signers: 6, noVoters: 8, required: 6 });
    expect(ok.explanation).toContain("Görüş Grubu C içinde red oyu verenlerin en az %75'i");
    const notYet = evaluateObjection({ ...base, signatures: noKeys("g2", 5) });
    expect(notYet.valid).toBe(false);
    expect(notYet.rule).toBeNull();
    expect(notYet.explanation).toContain("İtiraz henüz geçerli değil");
  });

  it("kural (a): en az 3 imza şartı (N_g = 2 iken 2 imza yetmez)", () => {
    const fr = votes({ g0: [40, 4], g1: [10, 5], g2: [5, 2] });
    const r = evaluateObjection({ ...base, firstRoundVotes: fr, signatures: noKeys("g2", 2) });
    expect(r.perCluster.find((p) => p.clusterId === "g2")!.required).toBe(3);
    expect(r.valid).toBe(false);
  });

  it("kural (a) yalnız anlamlı kümede: küçük kümenin tüm red oyları yetmez", () => {
    const fr = [...firstRound, ...votes({ g3: [0, 3] })];
    const r = evaluateObjection({ ...base, firstRoundVotes: fr, clusterSizes: { ...SIZES, g3: 3 }, clusteredTotal: 103, signatures: noKeys("g3", 3) });
    expect(r.valid).toBe(false);
  });

  it("kural (b): toplam ≥ ⌈0,10·|E|⌉ ve en az 2 farklı küme; kümelenmemiş küme sayılmaz", () => {
    const fr = [...firstRound, ...votes({ "-": [0, 7] })];
    const cross = evaluateObjection({ ...base, firstRoundVotes: fr, signatures: [...noKeys("g0", 2), ...noKeys("g1", 3), ...noKeys("g2", 3), ...noKeys("-", 2)] });
    expect(cross.perCluster.every((p) => p.signers < p.required)).toBe(true); // (a) tek başına sağlanmıyor
    expect(cross.crossClusterRequired).toBe(10);
    expect(cross.valid).toBe(true);
    expect(cross.rule).toBe("cross_cluster");
    expect(cross.explanation).toContain("en az iki farklı görüş grubundan");
    const oneCluster = evaluateObjection({ ...base, firstRoundVotes: fr, signatures: [...noKeys("g1", 3), ...noKeys("-", 7)] });
    expect(oneCluster.signers).toBe(10);
    expect(oneCluster.valid).toBe(false);
    const nine = evaluateObjection({ ...base, firstRoundVotes: fr, signatures: [...noKeys("g0", 2), ...noKeys("g1", 3), ...noKeys("g2", 3), ...noKeys("-", 1)] });
    expect(nine.valid).toBe(false);
  });

  it("'no' vermeyen imzacılar ve yinelenen imzalar süzülür", () => {
    const sigs = [
      ...noKeys("g2", 5),
      { voterKey: "g2-yes-0", clusterId: "g2" }, // kabul oyu
      { voterKey: "yok-0", clusterId: "g2" }, // oy vermemiş
      { voterKey: "g2-no-0", clusterId: "g2" }, // yinelenen
    ];
    const r = evaluateObjection({ ...base, signatures: sigs });
    expect(r.signers).toBe(5);
    expect(r.valid).toBe(false);
  });

  it("güçlü itiraz: imzacılar kümenin TÜM üyelerinin ≥ 2/3'ü", () => {
    const fr = votes({ g0: [40, 4], g1: [10, 5], g2: [0, 10] });
    const strong = evaluateObjection({ ...base, firstRoundVotes: fr, signatures: noKeys("g2", 8) }); // ⌈7,5⌉ = 8 ≥ ⌈6,67⌉ = 7
    expect(strong.valid).toBe(true);
    expect(strong.strong).toBe(true);
    expect(strong.explanation).toContain("en az 2/3");
    // 8 red oyu varken 6 imza (a) için yeterli ama 6 < ⌈2/3·10⌉ = 7 → güçlü değil
    const weak = evaluateObjection({ ...base, signatures: noKeys("g2", 6) });
    expect(weak.valid).toBe(true);
    expect(weak.strong).toBe(false);
  });
});

// ───────────────────────── verifyTally ─────────────────────────

describe("verifyTally — defterden bağımsız yeniden sayım", () => {
  const proposalId = "prop-1";
  const ballotOf = (u: string) => sha256Hex(`oy-anahtari|${u}|${proposalId}|1`);

  function serverTally(ballots: { user: string; choice: VoteChoice; cluster: string | null; via: "direct" | "delegated" }[]) {
    const reveals: RevealEntry[] = ballots.map((b, i) => ({ ballotId: ballotOf(b.user), choice: b.choice, salt: `tuz${i}`, clusterId: b.cluster, via: b.via }));
    const commitments: Record<string, string> = {};
    for (const r of reveals) if (r.via === "direct") commitments[r.ballotId] = voteCommitment(proposalId, 1, r.ballotId, r.choice, r.salt);
    const params = T("T0");
    // Sunucu decide'ı kendi sırasıyla (sıralamadan) voterKey = ballotId ile çağırır.
    const result = decide({
      params,
      round: 1,
      eligibleCount: 40,
      votes: ballots.map((b) => ({ voterKey: ballotOf(b.user), choice: b.choice, via: b.via, clusterId: b.cluster })),
      clusterSizes: { g0: 20, g1: 12 },
      clusteredTotal: 32,
      k: 2,
      extensionAvailable: false,
      authorClusterId: null,
      revote: null,
      unrouted: 1,
      now: NOW,
    });
    const tally: TallyPayload = {
      proposalId,
      round: 1,
      algoVersion: ALGO_VERSION,
      params,
      eligibleCount: 40,
      clusterSizes: { g0: 20, g1: 12 },
      clusteredTotal: 32,
      k: 2,
      extensionAvailable: false,
      authorClusterId: null,
      revote: null,
      unrouted: 1,
      clusterSnapshotHash: "snap",
      revealHash: revealHash(reveals),
      outcome: result.outcome,
      totals: result.totals,
      inputsHash: result.inputsHash,
      computedAt: NOW,
    };
    return { reveals, commitments, tally, result };
  }

  const ballots = [
    ...Array.from({ length: 10 }, (_, i) => ({ user: `a${i}`, choice: "yes" as VoteChoice, cluster: "g0", via: "direct" as const })),
    ...Array.from({ length: 3 }, (_, i) => ({ user: `b${i}`, choice: "no" as VoteChoice, cluster: "g0", via: "direct" as const })),
    ...Array.from({ length: 5 }, (_, i) => ({ user: `c${i}`, choice: "yes" as VoteChoice, cluster: "g1", via: "direct" as const })),
    { user: "d0", choice: "no" as VoteChoice, cluster: "g1", via: "direct" as const },
    { user: "d1", choice: "abstain" as VoteChoice, cluster: null, via: "direct" as const },
    { user: "e0", choice: "yes" as VoteChoice, cluster: "g1", via: "delegated" as const },
  ];

  it("doğru bülten ✔ ve inputsHash sunucununkiyle birebir", () => {
    const { reveals, commitments, tally, result } = serverTally(ballots);
    expect(result.outcome).toBe("accept");
    const v = verifyTally(tally, reveals.slice().reverse(), commitments);
    expect(v.mismatches).toEqual([]);
    expect(v.ok).toBe(true);
    expect(v.recomputed.inputsHash).toBe(result.inputsHash);
    expect(v.recomputed.totals).toEqual(result.totals);
  });

  it("açıklanan oy değiştirilmiş ✘", () => {
    const { reveals, commitments, tally } = serverTally(ballots);
    const bad = reveals.map((r, i) => (i === 0 ? { ...r, choice: "no" as VoteChoice } : r));
    const v = verifyTally(tally, bad, commitments);
    expect(v.ok).toBe(false);
    expect(v.mismatches.some((m) => m.includes("revealHash"))).toBe(true);
    expect(v.mismatches.some((m) => m.startsWith("Açıklanan oy taahhütle eşleşmiyor"))).toBe(true);
    expect(v.mismatches.some((m) => m.startsWith('Toplam "yes" farklı'))).toBe(true);
    expect(v.mismatches).toContain("Girdi özeti (inputsHash) eşleşmiyor");
  });

  it("taahhüt uyuşmazlığı ✘", () => {
    const { reveals, commitments, tally } = serverTally(ballots);
    const tampered = { ...commitments, [reveals[2].ballotId]: sha256Hex("sahte") };
    const v = verifyTally(tally, reveals, tampered);
    expect(v.ok).toBe(false);
    expect(v.mismatches).toEqual([`Açıklanan oy taahhütle eşleşmiyor: ${reveals[2].ballotId.slice(0, 12)}…`]);
  });

  it("eksik açıklama ✘ (taahhüdü var, bültende yok)", () => {
    const { reveals, commitments, tally } = serverTally(ballots);
    const missing = reveals.filter((_, i) => i !== 4);
    const v = verifyTally(tally, missing, commitments);
    expect(v.ok).toBe(false);
    expect(v.mismatches).toContain(`Taahhüdü olan oy açıklanmamış: ${reveals[4].ballotId.slice(0, 12)}…`);
  });

  it("doğrudan oyun taahhüdü yoksa ✘; vekâlet girdisi taahhüt gerektirmez", () => {
    const { reveals, commitments, tally } = serverTally(ballots);
    const fewer = { ...commitments };
    delete fewer[reveals[0].ballotId];
    const v = verifyTally(tally, reveals, fewer);
    expect(v.mismatches).toEqual([`Doğrudan oyun taahhüdü defterde yok: ${reveals[0].ballotId.slice(0, 12)}…`]);
  });

  it("yinelenen açıklama, sonuç ve sürüm uyuşmazlıkları ✘", () => {
    const { reveals, commitments, tally } = serverTally(ballots);
    const dup = verifyTally(tally, [...reveals, reveals[0]], commitments);
    expect(dup.mismatches.some((m) => m.startsWith("Aynı oy pusulası iki kez açıklanmış"))).toBe(true);
    const wrongOutcome = verifyTally({ ...tally, outcome: "reject" }, reveals, commitments);
    expect(wrongOutcome.mismatches).toEqual(["Sonuç farklı: defterde reject, yeniden sayımda accept"]);
    const wrongVersion = verifyTally({ ...tally, algoVersion: "KC-0.9" }, reveals, commitments);
    expect(wrongVersion.mismatches).toContain("Algoritma sürümü farklı: KC-0.9 ≠ KC-1.0");
  });

  it("commitments verilmezse yalnız sayım denetlenir", () => {
    const { reveals, tally } = serverTally(ballots);
    expect(verifyTally(tally, reveals).ok).toBe(true);
  });
});
