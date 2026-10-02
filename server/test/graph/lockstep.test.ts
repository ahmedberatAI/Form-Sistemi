// graph.lockstep: kayan pencere + akışlı değerlendirme. Sonuç eski (tüm çiftleri bellekte toplayan) algoritmayla aynı kalmalı;
// aynı dakikadaki binlerce aynı seçim bellek/CPU patlatmamalı.
import { describe, expect, it } from "vitest";
import { createGraphService } from "../../src/graph";
import { kCoreComponents } from "../../src/graph/analytics";
import type { Db } from "../../src/db";
import { insertUser, makeCtx } from "../helpers/fakes";
import { addBallot, addProposal, T0 } from "./fixtures";

type Choice = "yes" | "no" | "abstain";

/** Eski algoritma (başvuru gerçeklemesi): tüm pencere çiftlerini üretir, sonra süzer. */
function referenceLockstep(db: Db, proposalId: string): string[][] {
  const top = db.get<{ r: number | null }>("SELECT MAX(round) AS r FROM ballots WHERE proposal_id = ?", proposalId);
  if (!top || top.r === null) return [];
  const ballots = db.all<{ user_id: string; choice: string; t: number }>(
    "SELECT user_id, choice, updated_at AS t FROM ballots WHERE proposal_id = ? AND round = ? ORDER BY updated_at, user_id",
    proposalId,
    top.r,
  );
  const candidates: [string, string][] = [];
  const byChoice = new Map<string, { user_id: string; t: number }[]>();
  for (const b of ballots) byChoice.set(b.choice, [...(byChoice.get(b.choice) ?? []), b]);
  for (const list of byChoice.values()) {
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length && Number(list[j].t) - Number(list[i].t) <= 60_000; j++) candidates.push([list[i].user_id, list[j].user_id]);
    }
  }
  if (candidates.length < 4) return [];
  const users = [...new Set(candidates.flat())];
  const history = new Map<string, Map<string, string>>();
  for (const h of db.all<{ p: string; u: string; c: string }>(
    `SELECT b.proposal_id AS p, b.user_id AS u, b.choice AS c FROM ballots b
     JOIN (SELECT proposal_id, MAX(round) AS r FROM ballots GROUP BY proposal_id) lr ON lr.proposal_id = b.proposal_id AND lr.r = b.round
     WHERE b.proposal_id <> ? AND b.user_id IN (SELECT value FROM json_each(?))`,
    proposalId,
    JSON.stringify(users),
  )) {
    const m = history.get(h.u) ?? new Map<string, string>();
    m.set(h.p, h.c);
    history.set(h.u, m);
  }
  const locked = candidates.filter(([x, y]) => {
    const hx = history.get(x);
    const hy = history.get(y);
    if (!hx || !hy) return false;
    let common = 0;
    let same = 0;
    for (const [p, c] of hx) {
      const o = hy.get(p);
      if (o === undefined) continue;
      common++;
      if (o === c) same++;
    }
    return common >= 3 && same * 10 >= common * 9;
  });
  return kCoreComponents(locked, 3, 4);
}

describe("graf analizi: lockstep kayan pencere", () => {
  it("rastgele küçük senaryoda eski algoritmayla aynı gruplar", () => {
    const ctx = makeCtx();
    const graph = createGraphService(ctx, { ledger: null });
    let seed = 12345;
    const rnd = () => {
      seed = (seed * 1103515245 + 12345) & 0x7fffffff;
      return seed / 0x7fffffff;
    };
    const choices: Choice[] = ["yes", "no", "abstain"];
    const users = Array.from({ length: 24 }, (_, i) => insertUser(ctx.db, { id: `u${i}`, nickname: `u${i}` }));
    // İki "kilit" öbeği geçmişte neredeyse hep aynı oyu verir; geri kalanlar rastgele.
    const bloc = (i: number) => (i < 6 ? "A" : i < 12 ? "B" : "R");
    for (let p = 0; p < 6; p++) {
      const id = addProposal(ctx.db, users[0], "enacted", `past${p}`);
      const a = choices[Math.floor(rnd() * 3)];
      const b = choices[Math.floor(rnd() * 3)];
      users.forEach((u, i) => addBallot(ctx.db, id, u, bloc(i) === "A" ? a : bloc(i) === "B" ? b : choices[Math.floor(rnd() * 3)]));
    }
    const target = addProposal(ctx.db, users[0], "voting", "target");
    users.forEach((u, i) => addBallot(ctx.db, target, u, i < 12 ? (i < 6 ? "yes" : "no") : choices[Math.floor(rnd() * 3)], { at: T0 + 86_400_000 + Math.floor(rnd() * 150_000) }));

    const expected = referenceLockstep(ctx.db, target);
    expect(expected.length).toBeGreaterThan(0); // senaryo anlamlı: en az bir grup bulunur
    expect(graph.lockstep(target).groups).toEqual(expected);
  });

  it("aynı pencerede binlerce aynı seçim: hızlı biter ve bellek patlamaz (geçmişi olmayanlar elenir)", () => {
    const ctx = makeCtx();
    const graph = createGraphService(ctx, { ledger: null });
    const n = 3000;
    const ids = Array.from({ length: n }, (_, i) => insertUser(ctx.db, { id: `m${i}`, nickname: `m${i}` }));
    const target = addProposal(ctx.db, ids[0], "voting", "target");
    ctx.db.tx(() => {
      for (const u of ids) addBallot(ctx.db, target, u, "yes", { at: T0 + 86_400_000 });
    });
    const t0 = performance.now();
    // Hiç geçmiş oyu yok: kimse ortak ≥3 eşiğini sağlayamaz; n²/2 çift üretilmeden biter.
    expect(graph.lockstep(target).groups).toEqual([]);
    expect(performance.now() - t0).toBeLessThan(2000);
  });

  it("geçmişi olan kalabalık aynı pencerede: akışlı değerlendirme, yalnız uyumlu grup döner", () => {
    const ctx = makeCtx();
    const graph = createGraphService(ctx, { ledger: null });
    const n = 900;
    const ids = Array.from({ length: n }, (_, i) => insertUser(ctx.db, { id: `k${i}`, nickname: `k${i}` }));
    ctx.db.tx(() => {
      // Her kişinin geçmişi kendine özgü (çiftler nadiren ≥%90 uzlaşır): 4 geçmiş öneride kişiye özgü örüntü.
      for (let p = 0; p < 4; p++) {
        const id = addProposal(ctx.db, ids[0], "enacted", `h${p}`);
        ids.forEach((u, i) => addBallot(ctx.db, id, u, i % 7 === 0 ? "yes" : (["yes", "no", "abstain"] as const)[(i * (p + 3) + p) % 3]));
      }
      const target = addProposal(ctx.db, ids[0], "voting", "target");
      for (const u of ids) addBallot(ctx.db, target, u, "yes", { at: T0 + 86_400_000 });
    });
    const t0 = performance.now();
    const { groups } = graph.lockstep("target");
    expect(performance.now() - t0).toBeLessThan(5000);
    // Sonuç eski algoritmayla aynı.
    expect(groups).toEqual(referenceLockstep(ctx.db, "target"));
  });
});
