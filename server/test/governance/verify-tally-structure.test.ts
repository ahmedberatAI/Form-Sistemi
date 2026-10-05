// ALGORITMA §11 / §12: verifyTally'nin yapısal denetimleri (test döngüsü tur 1).
// Eski açık: taahhüt döngüsü `via !== "direct"` açıklamaları tümüyle atlıyordu. Defterde VOTE_COMMIT taahhüdü olan bir pusula
// "vekâletle" etiketlenip başka bir seçimle açıklanınca hiçbir denetime takılmıyordu; |E|'yi aşan hayali pusulalar da geçiyordu.
// Meşru sunucu ikisini de üretemez (forum/tally.ts: pusulası olan seçmen her zaman "direct", açıklamalar uygun seçmenlerden).
import { describe, expect, it } from "vitest";
import {
  ALGO_VERSION,
  decide,
  decisionInputFromTally,
  revealHash,
  verifyTally,
  voteCommitment,
  type RevealEntry,
  type TallyPayload,
  type VoteChoice,
} from "@forum/shared";
import { defaultDecisionParams } from "../../src/governance";

const T0 = defaultDecisionParams("T0");

/** Açıklamalardan kendi içinde tutarlı bir TALLY yükü kurar (revealHash, sonuç, toplamlar, inputsHash) — sahte sunucunun yapacağı gibi. */
function publish(reveals: RevealEntry[], eligibleCount = 5): TallyPayload {
  const base: TallyPayload = {
    proposalId: "p1",
    round: 1,
    algoVersion: ALGO_VERSION,
    params: T0,
    eligibleCount,
    clusterSizes: {},
    clusteredTotal: 0,
    k: 1,
    extensionAvailable: false,
    authorClusterId: null,
    revote: null,
    unrouted: 0,
    clusterSnapshotHash: "snap",
    revealHash: revealHash(reveals),
    outcome: "reject",
    totals: { eligible: eligibleCount, participants: 0, yes: 0, no: 0, abstain: 0, delegated: 0, unrouted: 0 },
    inputsHash: "",
    computedAt: Date.UTC(2026, 9, 1),
  };
  const r = decide(decisionInputFromTally(base, reveals));
  return { ...base, outcome: r.outcome, totals: r.totals, inputsHash: r.inputsHash };
}

const honest: RevealEntry[] = (["no", "no", "no", "yes", "yes"] as VoteChoice[]).map((choice, i) => ({
  ballotId: `b${i + 1}`,
  choice,
  salt: `s${i + 1}`,
  clusterId: null,
  via: "direct",
}));
const commitments = Object.fromEntries(honest.map((r) => [r.ballotId, voteCommitment("p1", 1, r.ballotId, r.choice, r.salt)]));

describe("verifyTally: taahhüt denetimi via etiketiyle atlatılamaz", () => {
  it("dürüst bülten ✔ (sonuç red)", () => {
    const tally = publish(honest);
    expect(tally.outcome).toBe("reject");
    const v = verifyTally(tally, honest, commitments);
    expect(v.mismatches).toEqual([]);
    expect(v.ok).toBe(true);
  });

  it("aynı değişiklik 'direct' etiketiyle zaten yakalanıyordu (karşılaştırma)", () => {
    const forged = honest.map((r) => (r.ballotId === "b1" ? { ...r, choice: "yes" as const } : r));
    const v = verifyTally(publish(forged), forged, commitments);
    expect(v.ok).toBe(false);
    expect(v.mismatches.join(" ")).toContain("Açıklanan oy taahhütle eşleşmiyor");
  });

  it("taahhüdü olan b1 ve b2 'vekâletle Kabul' açıklanınca sonuç kabule döner ama doğrulama ✘", () => {
    const forged = honest.map((r) => (r.ballotId === "b1" || r.ballotId === "b2" ? { ...r, choice: "yes" as const, salt: "", via: "delegated" as const } : r));
    const tally = publish(forged);
    expect(tally.outcome).toBe("accept"); // sahte bülten kendi içinde tutarlı (revealHash, toplamlar, inputsHash)
    const v = verifyTally(tally, forged, commitments);
    expect(v.ok).toBe(false);
    expect(v.mismatches.filter((m) => m.includes("vekâletle açıklanmış"))).toHaveLength(2);
  });

  it("taahhütsüz 4 hayali 'vekâlet' pusulası: katılım 9 > |E| 5 → ✘ (taahhüt haritası verilmese de)", () => {
    const phantom = [
      ...honest,
      ...[1, 2, 3, 4].map((i): RevealEntry => ({ ballotId: `ph${i}`, choice: "yes", salt: "", clusterId: null, via: "delegated" })),
    ];
    const tally = publish(phantom);
    expect(tally.totals.participants).toBe(9);
    expect(tally.outcome).toBe("accept");
    for (const v of [verifyTally(tally, phantom, commitments), verifyTally(tally, phantom)]) {
      expect(v.ok).toBe(false);
      expect(v.mismatches.join(" ")).toContain("Açıklanan oy sayısı (9) uygun seçmen sayısını (5) aşıyor");
    }
  });

  it("gerçek vekâlet oyu (taahhüdü yok, |E| içinde) uyuşmazlık değildir", () => {
    const four = honest.slice(0, 4);
    const withDelegated: RevealEntry[] = [...four, { ballotId: "b5", choice: "yes", salt: "", clusterId: null, via: "delegated" }];
    const fourCommitments = Object.fromEntries(four.map((r) => [r.ballotId, commitments[r.ballotId]]));
    const v = verifyTally(publish(withDelegated), withDelegated, fourCommitments);
    expect(v.mismatches).toEqual([]);
    expect(v.ok).toBe(true);
  });

  it("açıklama sayısı tam |E| olabilir (sınır dahil)", () => {
    expect(verifyTally(publish(honest, 5), honest, commitments).ok).toBe(true);
    const v = verifyTally(publish(honest, 4), honest, commitments);
    expect(v.ok).toBe(false);
    expect(v.mismatches.join(" ")).toContain("uygun seçmen sayısını (4) aşıyor");
  });
});
