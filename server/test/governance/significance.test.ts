// "Anlamlı görüş grubu" kuralı (ALGORITMA.md §1): tek işlev (shared `isSignificant`); eşikler yönetmelikle değişebilir,
// bu yüzden sayım da sayım dışı görünümler de aynı işlevi ve yürürlükteki parametreleri kullanır.
import { describe, expect, it } from "vitest";
import { decide, isSignificant, rat, type DecisionInput, type EffectiveVote } from "@forum/shared";
import { defaultDecisionParams } from "../../src/governance";

const NOW = Date.UTC(2026, 9, 1);

describe("isSignificant (n_g ≥ σ_min ve n_g / n_C ≥ σ_share)", () => {
  const dflt = { significantShare: rat(1, 10), significantMinMembers: 3 };

  it("varsayılan eşikler (σ_share = 1/10, σ_min = 3): ikisi de sağlanmalı, sınır dahildir", () => {
    expect(isSignificant(3, 30, dflt)).toBe(true); // tam %10 ve tam 3 üye
    expect(isSignificant(3, 31, dflt)).toBe(false); // pay %9,67 < %10
    expect(isSignificant(2, 12, dflt)).toBe(false); // pay yeterli (%16,7) ama üye sayısı < 3
    expect(isSignificant(60, 100, dflt)).toBe(true);
  });

  it("kümelenmiş toplam 0 ise hiçbir küme anlamlı değildir", () => {
    expect(isSignificant(0, 0, dflt)).toBe(false);
    expect(isSignificant(5, 0, dflt)).toBe(false);
  });

  it("eşikler değişince sonuç değişir (yönetmelik yaması): σ_share = 1/5, σ_min = 5", () => {
    const strict = { significantShare: rat(1, 5), significantMinMembers: 5 };
    expect(isSignificant(4, 10, strict)).toBe(false); // pay yeterli (%40) ama üye sayısı < 5
    expect(isSignificant(5, 30, strict)).toBe(false); // üye sayısı yeterli ama pay %16,7 < %20
    expect(isSignificant(6, 30, strict)).toBe(true); // tam %20
    expect(isSignificant(3, 30, dflt)).toBe(true); // aynı küme varsayılan eşiklerle anlamlıydı
    expect(isSignificant(3, 30, strict)).toBe(false); // sıkılaşan eşiklerle değil
  });

  it("DecisionParams'ın tamamını da kabul eder (sayım bu biçimde çağırır)", () => {
    expect(isSignificant(10, 100, defaultDecisionParams("T0"))).toBe(true);
    expect(isSignificant(9, 100, defaultDecisionParams("T0"))).toBe(false);
  });
});

describe("decide() ile aynı kural: anlamlı küme işaretleri isSignificant ile birebir", () => {
  // g0 = 60, g1 = 20, g2 = 9, g3 = 6, g4 = 5 (toplam 100)
  const SIZES = { g0: 60, g1: 20, g2: 9, g3: 6, g4: 5 };

  function votes(): EffectiveVote[] {
    const out: EffectiveVote[] = [];
    for (const [g, n] of Object.entries(SIZES)) {
      for (let i = 0; i < n; i++) out.push({ voterKey: `${g}-${i}`, choice: i % 3 === 0 ? "no" : "yes", via: "direct", clusterId: g });
    }
    return out;
  }

  const base = (params: DecisionInput["params"]): DecisionInput => ({
    params,
    round: 1,
    eligibleCount: 100,
    clusterSizes: SIZES,
    clusteredTotal: 100,
    k: 5,
    extensionAvailable: false,
    now: NOW,
    votes: votes(),
  });

  it.each([
    ["varsayılan (1/10, 3)", rat(1, 10), 3],
    ["σ_share = 0,2", rat(1, 5), 3],
    ["σ_min = 5", rat(1, 10), 5],
    ["σ_share = 0,05 ve σ_min = 6", rat(1, 20), 6],
  ] as const)("%s", (_ad, share, min) => {
    const params = { ...defaultDecisionParams("T0"), significantShare: share, significantMinMembers: min };
    const r = decide(base(params));
    expect(r.clusters.length).toBe(5);
    for (const c of r.clusters) {
      expect(c.significant, `${c.clusterId} (${c.members})`).toBe(isSignificant(SIZES[c.clusterId as keyof typeof SIZES], 100, params));
    }
  });

  it("eşikleri değiştirmek anlamlı küme kümesini gerçekten değiştirir (test yanlış-geçmesin)", () => {
    const sig = (share: ReturnType<typeof rat>, min: number) =>
      decide(base({ ...defaultDecisionParams("T0"), significantShare: share, significantMinMembers: min }))
        .clusters.filter((c) => c.significant)
        .map((c) => c.clusterId);
    expect(sig(rat(1, 10), 3).sort()).toEqual(["g0", "g1"]);
    expect(sig(rat(1, 20), 3).sort()).toEqual(["g0", "g1", "g2", "g3", "g4"]);
    expect(sig(rat(1, 10), 6).sort()).toEqual(["g0", "g1"]);
    expect(sig(rat(1, 20), 6).sort()).toEqual(["g0", "g1", "g2", "g3"]);
  });
});
