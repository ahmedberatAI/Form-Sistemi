// #287: uzlaşı önbellek anahtarı yalnızca agreementInput()'un okuduğu veriye (kapanmış turlar) bağlıdır.
import { describe, it, expect, vi } from "vitest";
import { createGraphService } from "../../src/graph";
import { insertUser, makeCtx } from "../helpers/fakes";
import { addBallot, addProposal, addTally, T0 } from "./fixtures";

const BALLOT_READ = "FROM ballots WHERE proposal_id = ? AND round = ?";

function setup() {
  const ctx = makeCtx();
  const graph = createGraphService(ctx, { ledger: null });
  const users = ["u1", "u2", "u3", "u4"].map((id) => insertUser(ctx.db, { id, nickname: id.toUpperCase() }));
  for (let i = 0; i < 3; i++) {
    const p = addProposal(ctx.db, users[0], "enacted", `kapali-${i}`);
    for (const u of users) addBallot(ctx.db, p, u, "yes");
  }
  const open = addProposal(ctx.db, users[0], "voting", "acik");
  const reads = () => spy.mock.calls.filter((c) => String(c[0]).includes(BALLOT_READ)).length;
  const spy = vi.spyOn(ctx.db, "all");
  return { ctx, graph, users, open, reads };
}

describe("uzlaşı önbelleği: açık öneri oyları anahtarı değiştirmez", () => {
  it("oylama süren öneriye atılan oy yeniden hesaplamayı tetiklemez", () => {
    const { ctx, graph, users, open, reads } = setup();
    const first = graph.agreementCommunities("t");
    expect(first.count).toBe(1);
    const afterFirst = reads();
    expect(afterFirst).toBeGreaterThan(0);

    // Önbellek ısındı: aynı veriyle ikinci çağrı kapanmış tur oylarını yeniden okumaz.
    graph.agreementCommunities("t");
    expect(reads()).toBe(afterFirst);

    // Açık (oylama süren) öneriye oy → anahtar değişmez, yeniden hesaplama yok.
    addBallot(ctx.db, open, users[0], "yes", { at: T0 + 10_000 });
    addBallot(ctx.db, open, users[1], "no", { at: T0 + 20_000 });
    expect(graph.agreementCommunities("t")).toEqual(first);
    expect(reads()).toBe(afterFirst);

    // Açık önerinin ara sayımı (needs_more_votes) da kapanış sayılmaz → yine yeniden hesaplama yok.
    addTally(ctx.db, open, "needs_more_votes", 1, T0 + 30_000);
    graph.agreementCommunities("t");
    // (ara sayım tallies sayısını değiştirdiği için bir kez yeniden okunabilir; sonrasında yine sabit olmalı)
    const afterInterim = reads();
    addBallot(ctx.db, open, users[2], "yes", { at: T0 + 40_000 });
    graph.agreementCommunities("t");
    expect(reads()).toBe(afterInterim);
  });

  it("kapanmış tura ait veri değişince anahtar değişir (yeniden hesaplanır)", () => {
    const { ctx, graph, users, open, reads } = setup();
    graph.agreementCommunities("t");
    const before = reads();
    // Açık öneri kesin sayımla kapanır → artık girdidir.
    for (const u of users) addBallot(ctx.db, open, u, "yes", { at: T0 + 10_000 });
    addTally(ctx.db, open, "contested", 1, T0 + 50_000);
    graph.agreementCommunities("t");
    expect(reads()).toBeGreaterThan(before);
  });
});
