// Tur 1 graf düzeltmeleri:
//  - kalıcı kaybeden göstergesi önbellekli (ana sayfa panosu her yoklamada oy tablosunu yeniden okumaz); yeni sayım ya da yeni
//    küme anlık görüntüsü yeniden hesaplatır;
//  - uzlaşı önbellek anahtarı oy tablosunu taramaz;
//  - kapanmış hesap takip/kefalet/yakınlık hedefi olamaz (geri alma serbest);
//  - visualization: boş tür listesi → kenar yok, verilmemiş → varsayılan türler.
import { describe, expect, it, vi } from "vitest";
import { createGraphService } from "../../src/graph";
import { insertUser, makeCtx } from "../helpers/fakes";
import { addBallot, addProposal, addSnapshot, addTally, T0 } from "./fixtures";

const BALLOT_ROUND_READ = "FROM ballots WHERE proposal_id = ? AND round = ?";

function scene() {
  const ctx = makeCtx();
  const graph = createGraphService(ctx, { ledger: null });
  const a = ["a1", "a2", "a3"].map((id) => insertUser(ctx.db, { id, nickname: id }));
  const b = ["b1", "b2"].map((id) => insertUser(ctx.db, { id, nickname: id }));
  addSnapshot(ctx.db, Object.fromEntries([...a.map((id) => [id, "g0"]), ...b.map((id) => [id, "g1"])]), {}, { at: T0 - 1000 });
  for (let i = 0; i < 3; i++) {
    const p = addProposal(ctx.db, a[0], "enacted");
    for (const u of a) addBallot(ctx.db, p, u, "yes");
    for (const u of b) addBallot(ctx.db, p, u, "no");
    addTally(ctx.db, p, "accept", 1, T0 + 1000 + i);
  }
  return { ctx, graph, a, b };
}

describe("kalıcı kaybeden göstergesi önbelleği", () => {
  it("aynı veride ikinci çağrı oy okumaz; yeni kesin sayım ve yeni anlık görüntü yeniden hesaplatır", () => {
    const { ctx, graph, a, b } = scene();
    const spy = vi.spyOn(ctx.db, "all");
    const reads = () => spy.mock.calls.filter((c) => String(c[0]).includes(BALLOT_ROUND_READ)).length;
    const first = graph.permanentLoser();
    expect(first).toEqual([
      { clusterId: "g0", lostShare: 0, decisions: 3 },
      { clusterId: "g1", lostShare: 1, decisions: 3 },
    ]);
    const afterFirst = reads();
    expect(afterFirst).toBeGreaterThan(0);
    expect(graph.permanentLoser()).toEqual(first);
    expect(reads()).toBe(afterFirst);
    // Döndürülen değer değiştirilse bile önbellek bozulmaz.
    graph.permanentLoser()[0].lostShare = 99;
    expect(graph.permanentLoser()).toEqual(first);

    // Yeni kesin sayım (g1 kazanır) → yeniden hesaplanır.
    const p = addProposal(ctx.db, a[0], "rejected");
    for (const u of a) addBallot(ctx.db, p, u, "yes");
    for (const u of b) addBallot(ctx.db, p, u, "no");
    addTally(ctx.db, p, "reject", 1, T0 + 5000);
    const second = graph.permanentLoser();
    expect(reads()).toBeGreaterThan(afterFirst);
    expect(second).toEqual([
      { clusterId: "g0", lostShare: 0.25, decisions: 4 },
      { clusterId: "g1", lostShare: 0.75, decisions: 4 },
    ]);
    // Yeni anlık görüntü (herkes tek kümede) → yeniden hesaplanır.
    addSnapshot(ctx.db, Object.fromEntries([...a, ...b].map((id) => [id, "g0"])), {}, { at: T0 + 9000 });
    expect(graph.permanentLoser().map((x) => x.clusterId)).toEqual(["g0"]);
    expect(graph.stats().permanentLoser).toEqual(graph.permanentLoser());
  });

  it("uzlaşı önbellek anahtarı oy tablosunu taramaz (sıcak çağrıda hiç oy sorgusu yok)", () => {
    const { ctx, graph } = scene();
    graph.agreementCommunities("t");
    const getSpy = vi.spyOn(ctx.db, "get");
    const allSpy = vi.spyOn(ctx.db, "all");
    graph.agreementCommunities("t");
    const sqls = [...getSpy.mock.calls, ...allSpy.mock.calls].map((c) => String(c[0]));
    expect(sqls.some((s) => /FROM\s+ballots/i.test(s))).toBe(false);
  });
});

describe("kapanmış hesap ilişki hedefi olamaz", () => {
  it("silinmiş/reddedilmiş hedefe follow/vouch/relate → 409 invalid_state; unfollow serbest; bekleyen hedef serbest", () => {
    const ctx = makeCtx();
    const graph = createGraphService(ctx, { ledger: null });
    const me = insertUser(ctx.db, { nickname: "ben" });
    const erased = insertUser(ctx.db, { nickname: "silinen" });
    const rejected = insertUser(ctx.db, { nickname: "reddedilen", status: "rejected" });
    const pending = insertUser(ctx.db, { nickname: "bekleyen", status: "pending" });
    graph.follow(me, erased);
    ctx.db.run("UPDATE users SET status = 'erased' WHERE id = ?", erased);
    for (const target of [erased, rejected]) {
      expect(() => graph.follow(me, target)).toThrow(expect.objectContaining({ status: 409, code: "invalid_state" }));
      expect(() => graph.vouch(me, target, "close")).toThrow(expect.objectContaining({ status: 409, code: "invalid_state" }));
      expect(() => graph.relate(me, target, "family")).toThrow(expect.objectContaining({ status: 409, code: "invalid_state" }));
    }
    graph.unfollow(me, erased);
    expect(graph.listEdges({ src: me, dst: erased, type: "FOLLOWS" })).toEqual([]);
    expect(graph.vouch(me, pending, "known").type).toBe("VOUCHES");
    expect(graph.follow(me, pending).type).toBe("FOLLOWS");
  });

  it("visualization: boş tür listesi kenarsız, verilmemiş liste varsayılan türlerle döner", () => {
    const ctx = makeCtx();
    const graph = createGraphService(ctx, { ledger: null });
    const x = insertUser(ctx.db, { nickname: "x" });
    const y = insertUser(ctx.db, { nickname: "y" });
    graph.follow(x, y);
    graph.relate(x, y, "business");
    expect(graph.visualization({ includeEdgeTypes: [] }).edges).toEqual([]);
    expect(graph.visualization({}).edges.map((e) => e.type)).toEqual(["FOLLOWS"]);
    expect(graph.visualization({ includeEdgeTypes: ["RELATED_TO"] }).edges).toEqual([]); // özel kenar yalnız includePrivate ile
    expect(graph.visualization({ includeEdgeTypes: ["RELATED_TO"], includePrivate: true }).edges.map((e) => e.type)).toEqual(["RELATED_TO"]);
  });
});
