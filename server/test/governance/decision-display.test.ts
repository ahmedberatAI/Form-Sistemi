// ALGORITMA §4.2 r2 / §12.15: kontrol satırlarında ve gerekçe metninde gösterilen değer ve sınır, karşılaştırma sonucuyla çelişmez.
// Değerin hassasiyeti artırıldığında (yuvarlanmış hâli sınırınkiyle aynı göründüğü için) sınır da gerekirse aynı hassasiyetle
// yazılır: "%66,68 ≥ %66,7 ✔" ya da "%50,00 ≥ %50,0 ✘" gibi satırlar oluşmaz.
import { describe, expect, it } from "vitest";
import {
  createRng,
  decide,
  rat,
  ratMax,
  type DecisionInput,
  type DecisionParams,
  type DecisionResult,
  type EffectiveVote,
  type Rational,
  type VoteChoice,
} from "@forum/shared";
import { defaultDecisionParams } from "../../src/governance";

const NOW = Date.UTC(2026, 9, 1);

function votes(spec: Record<string, [number, number]>): EffectiveVote[] {
  const out: EffectiveVote[] = [];
  for (const [g, [y, n]] of Object.entries(spec)) {
    const push = (choice: VoteChoice, count: number) => {
      for (let i = 0; i < count; i++) out.push({ voterKey: `${g}-${choice}-${i}`, choice, via: "direct", clusterId: g === "-" ? null : g });
    };
    push("yes", y);
    push("no", n);
  }
  return out;
}

const coldInput = (params: DecisionParams, over: Partial<DecisionInput> = {}): DecisionInput => ({
  params,
  round: 1,
  eligibleCount: 2002,
  votes: votes({ "-": [1335, 667] }),
  clusterSizes: {},
  clusteredTotal: 0,
  k: 1,
  extensionAvailable: false,
  now: NOW,
  ...over,
});

const check = (r: DecisionResult, key: string) => r.checks.find((c) => c.key === key)!;

describe("decide — 2/3 eşiğinde değer ve sınır aynı hassasiyette", () => {
  it("soğuk başlangıç nitelikli çoğunluk (T2, DEL, T1): '%66,68 ≥ %66,67'", () => {
    for (const tier of ["T2", "DEL", "T1"] as const) {
      const r = decide(coldInput(defaultDecisionParams(tier)));
      expect(r.outcome, tier).toBe("accept");
      expect(check(r, "threshold"), tier).toMatchObject({ passed: true, value: "%66,68 (1335 kabul / 667 red)", required: "≥ %66,67" });
      expect(r.reason, tier).toBe("Nitelikli çoğunluk (%66,68 ≥ %66,67) sağlandı (soğuk başlangıç).");
    }
  });

  it("yeniden oylama: aşma eşiği ω = 2/3 ve güçlü itiraz ρ' = 2/3", () => {
    const contested = decide(coldInput(defaultDecisionParams("T0"), { round: 2, revote: { origin: "contested", strongObjection: false } }));
    expect(check(contested, "override")).toMatchObject({ passed: true, value: "%66,68", required: "≥ %66,67" });
    const strong = decide(coldInput(defaultDecisionParams("T0"), { round: 2, revote: { origin: "objection", strongObjection: true } }));
    expect(check(strong, "revote_threshold")).toMatchObject({ passed: true, value: "%66,68", required: "≥ %66,67" });
    expect(strong.reason).toBe("İtiraz sonrası yeniden oylamada %66,67 eşiği sağlandı.");
  });

  it("1/10000 hassasiyetli eşik: '%50,00 < %50,01' ve 'P=0,5000 < 0,5001' (çelişkili '≥ %50,0 ✘' yok)", () => {
    const p: DecisionParams = { ...defaultDecisionParams("T0"), threshold: rat(5001, 10000), thresholdStrict: false, clusterFloor: rat(5001, 10000) };
    const r = decide(coldInput(p, { votes: votes({ "-": [1000, 1000] }), eligibleCount: 2000, params: { ...p, coldStartBump: rat(0, 1) } }));
    expect(check(r, "threshold")).toMatchObject({ passed: false, value: "%50,00 (1000 kabul / 1000 red)", required: "≥ %50,01" });
    const bridged = decide({
      params: p,
      round: 1,
      eligibleCount: 1000,
      votes: votes({ g0: [600, 100], g1: [99, 99] }),
      clusterSizes: { g0: 700, g1: 300 },
      clusteredTotal: 1000,
      k: 2,
      extensionAvailable: false,
      now: NOW,
    });
    expect(check(bridged, "bridge:g1")).toMatchObject({ passed: false, value: "P=0,5000 (99 kabul / 99 red)", required: "≥ 0,5001" });
    expect(check(bridged, "bridge:g1").detail).not.toMatch(/0,50\b(?!0)/);
  });

  it("varsayılan gösterim değişmez: ayırt etmek gerekmiyorsa sınır 1 ondalık (%60,0) kalır", () => {
    const r = decide(coldInput(defaultDecisionParams("T1"), { eligibleCount: 3000, votes: votes({ g0: [1000, 500], g1: [499, 501] }), clusterSizes: { g0: 2000, g1: 1000 }, clusteredTotal: 3000, k: 2 }));
    expect(check(r, "threshold")).toMatchObject({ value: "%59,96 (1499 kabul / 1001 red)", required: "≥ %60,0" });
  });
});

/** "%66,68 (…)" / "P=0,5000 (…)" / "%66,68" → sayı; kesir (yedek gösterim) → null. */
function shownNumber(text: string): number | null {
  const token = text.split(" ")[0].replace(/^P=/, "").replace(/^%/, "");
  if (token.includes("/")) return null;
  return Number(token.replace(",", "."));
}
const shownBound = (required: string): { op: string; n: number } => {
  const [op, raw] = required.split(" ");
  return { op, n: Number(raw.replace(/^%/, "").replace(",", ".")) };
};
const cmpRat = (num: number, den: number, b: Rational): number => Math.sign(num * b.den - b.num * den);

describe("decide — özellik: gösterilen değer/sınır karşılaştırması gerçek karşılaştırmayla aynı", () => {
  it("rastgele 1/10000 hassasiyetli eşikler ve oy dağılımları", () => {
    const rng = createRng("gosterim-tutarliligi");
    let checked = 0;
    for (let iter = 0; iter < 1500; iter++) {
      const tier = (["T0", "T1", "T2", "DEL"] as const)[rng.int(4)];
      const base = defaultDecisionParams(tier);
      const pick = (lo: number, hi: number) => rat(lo + rng.int(hi - lo + 1), 10000);
      const params: DecisionParams = {
        ...base,
        threshold: rng.int(4) === 0 ? rat(2, 3) : pick(3000, 8000),
        clusterFloor: rng.int(4) === 0 ? rat(1, 3) : pick(2000, 6000),
        overrideThreshold: rng.int(3) === 0 ? rat(2, 3) : pick(5000, 9000),
        revoteThreshold: pick(5000, 8000),
        coldStartBump: rng.int(2) === 0 ? rat(0, 1) : base.coldStartBump,
        ...(tier === "DEL" ? { authorClusterFloor: pick(4000, 6000) } : {}),
      };
      const total = 200 + rng.int(3000);
      const g0 = Math.floor(total * 0.6);
      const g1 = total - g0;
      const sp: Record<string, [number, number]> = {};
      for (const [g, size] of [["g0", g0], ["g1", g1]] as const) {
        const voted = Math.floor(size * (0.5 + rng.next() / 2));
        const y = rng.int(voted + 1);
        sp[g] = [y, voted - y];
      }
      const round = rng.int(3) === 0 ? 2 : 1;
      const revote = round === 2 ? { origin: rng.int(2) === 0 ? ("contested" as const) : ("objection" as const), strongObjection: rng.int(2) === 0 } : null;
      const input: DecisionInput = {
        params,
        round: round as 1 | 2,
        eligibleCount: total,
        votes: votes(sp),
        clusterSizes: { g0, g1 },
        clusteredTotal: total,
        k: rng.int(3) === 0 ? 1 : 2,
        extensionAvailable: false,
        authorClusterId: tier === "DEL" ? "g1" : null,
        revote,
        now: NOW,
      };
      const r = decide(input);
      const Y = r.totals.yes;
      const N = r.totals.no;
      const rows: { key: string; num: number; den: number; bound: Rational }[] = [{ key: "threshold", num: Y, den: Y + N, bound: r.thresholdUsed }];
      if (revote?.origin === "contested") rows.push({ key: "override", num: Y, den: Y + N, bound: params.overrideThreshold });
      if (revote?.origin === "objection") {
        rows.push({ key: "revote_threshold", num: Y, den: Y + N, bound: revote.strongObjection ? ratMax(params.revoteThreshold, rat(2, 3)) : params.revoteThreshold });
      }
      for (const g of ["g0", "g1"]) rows.push({ key: `bridge:${g}`, num: 1 + sp[g][0], den: 2 + sp[g][0] + sp[g][1], bound: params.clusterFloor });
      if (params.authorClusterFloor) rows.push({ key: "author_cluster", num: 1 + sp.g1[0], den: 2 + sp.g1[0] + sp.g1[1], bound: params.authorClusterFloor });
      for (const row of rows) {
        const c = r.checks.find((x) => x.key === row.key);
        if (!c || row.den === 0) continue;
        const v = shownNumber(c.value);
        if (v === null) continue;
        const b = shownBound(c.required);
        const truth = cmpRat(row.num, row.den, row.bound);
        const shown = Math.sign(Math.round(v * 10000) - Math.round(b.n * 10000));
        expect(shown, `${tier} ${row.key}: ${c.value} ${c.required} (gerçek ${row.num}/${row.den} vs ${row.bound.num}/${row.bound.den})`).toBe(truth);
        checked++;
      }
    }
    expect(checked).toBeGreaterThan(3000);
  });
});
