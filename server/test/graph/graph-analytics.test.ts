import { describe, it, expect } from "vitest";
import { createGraphService } from "../../src/graph";
import { gini, kCoreComponents, propagateTrust } from "../../src/graph/analytics";
import { FakeLedger, insertUser, makeCtx, type TestCtx } from "../helpers/fakes";
import { addBallot, addExpert, addProposal, addSnapshot, addTally, T0 } from "./fixtures";

type Choice = "yes" | "no" | "abstain";

/** İki net blok: A bloğu ve B bloğu kapanmış önerilerde zıt oy verir (son öneride herkes "evet"). */
function twoBlocs(ctx: TestCtx, prefix = "") {
  const blocA = ["a1", "a2", "a3", "a4", "a5"].map((id) => insertUser(ctx.db, { id: prefix + id, nickname: prefix + id.toUpperCase() }));
  const blocB = ["b1", "b2", "b3", "b4", "b5"].map((id) => insertUser(ctx.db, { id: prefix + id, nickname: prefix + id.toUpperCase() }));
  const pattern: [Choice, Choice][] = [
    ["yes", "no"],
    ["yes", "no"],
    ["no", "yes"],
    ["yes", "no"],
    ["no", "yes"],
    ["yes", "yes"],
  ];
  pattern.forEach(([ca, cb], i) => {
    const p = addProposal(ctx.db, blocA[0], i % 2 ? "rejected" : "enacted", `${prefix}p${i}`);
    for (const u of blocA) addBallot(ctx.db, p, u, ca);
    for (const u of blocB) addBallot(ctx.db, p, u, cb);
  });
  // Açık bir önerideki oylar hesaba katılmaz
  const open = addProposal(ctx.db, blocA[0], "voting", `${prefix}open`);
  for (const u of [...blocA, ...blocB]) addBallot(ctx.db, open, u, "yes");
  return { blocA, blocB };
}

describe("graf analizi: saf yardımcılar", () => {
  it("gini", () => {
    expect(gini([])).toBe(0);
    expect(gini([0, 0, 0])).toBe(0);
    expect(gini([1, 1, 1, 1])).toBeCloseTo(0, 10);
    expect(gini([0, 0, 0, 2])).toBeCloseTo(0.75, 10);
  });

  it("k-çekirdek bileşenleri: 4-klik bulunur, zincir elenir", () => {
    const clique: [string, string][] = [
      ["a", "b"], ["a", "c"], ["a", "d"], ["b", "c"], ["b", "d"], ["c", "d"],
    ];
    const chain: [string, string][] = [["x", "y"], ["y", "z"], ["z", "w"], ["w", "v"]];
    expect(kCoreComponents([...clique, ...chain, ["d", "x"]], 3, 4)).toEqual([["a", "b", "c", "d"]]);
  });

  it("güven yayılımı: tohuma bağlı olmayan bileşen sıfır güven alır", () => {
    const t = propagateTrust(["s", "a", "b", "x", "y"], [{ a: "s", b: "a", w: 1 }, { a: "a", b: "b", w: 1 }, { a: "x", b: "y", w: 1 }], new Set(["s"]), 3);
    expect(t.get("a")!).toBeGreaterThan(0);
    expect(t.get("b")!).toBeGreaterThan(0);
    expect(t.get("x")).toBe(0);
    expect(t.get("y")).toBe(0);
  });
});

describe("graf analizi: uzlaşı toplulukları (Louvain)", () => {
  it("iki net blokta 2 topluluk bulur ve GRAPH_RUN kaydı yazar", () => {
    const ctx = makeCtx();
    const ledger = new FakeLedger(ctx.clock);
    const graph = createGraphService(ctx, { ledger });
    const { blocA, blocB } = twoBlocs(ctx, "üye-");
    const r = graph.agreementCommunities("tohum-1");
    expect(r.count).toBe(2);
    expect(r.modularity).toBeGreaterThan(0.3);
    const ca = new Set(blocA.map((u) => r.communities[u]));
    const cb = new Set(blocB.map((u) => r.communities[u]));
    expect(ca.size).toBe(1);
    expect(cb.size).toBe(1);
    expect([...ca][0]).not.toBe([...cb][0]);

    const runs = ledger.txs.filter((t) => t.type === "GRAPH_RUN");
    expect(runs).toHaveLength(1);
    expect(Object.keys(runs[0].payload).sort()).toEqual(["algo", "inputHash", "outputHash", "runId", "seed", "version"]);
    expect(runs[0].payload.seed).toBe("tohum-1");
    for (const u of [...blocA, ...blocB]) expect(JSON.stringify(runs[0].payload)).not.toContain(u);
    const row = ctx.db.get<{ id: string; ledger_tx: string; result: string }>("SELECT id, ledger_tx, result FROM graph_runs");
    expect(row?.id).toBe(runs[0].payload.runId);
    expect(row?.ledger_tx).toBe(runs[0].hash);
    expect(JSON.parse(row!.result)).toEqual(r);

    // Aynı girdi + aynı tohum: aynı sonuç, yeni kayıt yok
    expect(graph.agreementCommunities("tohum-1")).toEqual(r);
    expect(ctx.db.all("SELECT id FROM graph_runs")).toHaveLength(1);
  });

  it("tohumla belirlenimci: ayrı veritabanında aynı veri + aynı tohum → aynı sonuç ve özet", () => {
    const run = (seed: string) => {
      const ctx = makeCtx();
      const ledger = new FakeLedger(ctx.clock);
      const graph = createGraphService(ctx, { ledger });
      twoBlocs(ctx, "x-");
      const r = graph.agreementCommunities(seed);
      const tx = ledger.txs.find((t) => t.type === "GRAPH_RUN")!;
      return { r, inputHash: tx.payload.inputHash, outputHash: tx.payload.outputHash };
    };
    const first = run("sabit-tohum");
    const second = run("sabit-tohum");
    expect(second.r).toEqual(first.r);
    expect(second.inputHash).toBe(first.inputHash);
    expect(second.outputHash).toBe(first.outputHash);
  });

  it("veri yoksa boş sonuç ve kayıt yok", () => {
    const ctx = makeCtx();
    const ledger = new FakeLedger(ctx.clock);
    const graph = createGraphService(ctx, { ledger });
    expect(graph.agreementCommunities("t")).toEqual({ communities: {}, modularity: 0, count: 0 });
    expect(ledger.txs).toHaveLength(0);
  });

  it("ara sayım (needs_more_votes) kapanış sayılmaz; kesin sayım sayılır", () => {
    const ctx = makeCtx();
    const graph = createGraphService(ctx, { ledger: null });
    const users = ["c1", "c2", "c3", "c4"].map((id) => insertUser(ctx.db, { id, nickname: id }));
    const props = [0, 1, 2].map((i) => addProposal(ctx.db, users[0], "voting", `q${i}`));
    for (const p of props) for (const u of users) addBallot(ctx.db, p, u, "yes");
    for (const p of props) addTally(ctx.db, p, "needs_more_votes");
    expect(graph.agreementCommunities("t").count).toBe(0);
    for (const p of props) addTally(ctx.db, p, "contested", 1, T0 + 5000);
    expect(graph.agreementCommunities("t").count).toBe(1);
  });
});

describe("graf analizi: SybilRank", () => {
  it("kefaletsiz, yalnız birbirine kefil olan ve ≥2 şüpheli kefalet alan hesapları işaretler", () => {
    const ctx = makeCtx();
    const graph = createGraphService(ctx, { ledger: null });
    const admin = insertUser(ctx.db, { nickname: "Yönetici", roles: ["member", "admin"] });
    const h = ["h1", "h2", "h3", "h4", "h5"].map((n) => insertUser(ctx.db, { nickname: n }));
    const [s1, s2, s3, x] = ["s1", "s2", "s3", "x"].map((n) => insertUser(ctx.db, { nickname: n }));
    graph.vouch(admin, h[0], "close");
    graph.vouch(admin, h[1], "close");
    graph.vouch(admin, h[2], "close");
    graph.vouch(h[0], h[1], "known");
    graph.vouch(h[1], h[2], "known");
    graph.vouch(h[2], h[3], "known");
    graph.vouch(h[3], h[4], "known");
    graph.vouch(h[0], h[4], "known");
    graph.vouch(h[4], h[3], "close");
    graph.vouch(s2, s3, "close");
    graph.vouch(s3, s2, "close");
    graph.vouch(h[0], x, "known");
    graph.vouch(h[1], x, "suspicious");
    graph.vouch(h[2], x, "suspicious");

    const r = graph.sybilRank();
    expect(r.flagged).toEqual(expect.arrayContaining([s1, s2, s3, x]));
    for (const ok of [admin, ...h]) expect(r.flagged).not.toContain(ok);
    expect(r.scores[s1]).toBe(0);
    expect(r.scores[s2]).toBe(0);
    expect(Math.max(...Object.values(r.scores))).toBe(1);
    expect(r.scores[h[0]]).toBeGreaterThan(0);
  });

  it("yetkili tohum kefalet ağına bağlı değilse en eski doğrulanmış hesaplar tohum olur", () => {
    const ctx = makeCtx();
    const graph = createGraphService(ctx, { ledger: null });
    const old = insertUser(ctx.db, { nickname: "Kurucu", createdAt: Date.UTC(2025, 0, 1) });
    const others = ["o1", "o2", "o3"].map((n, i) => insertUser(ctx.db, { nickname: n, createdAt: Date.UTC(2026, 0, 2 + i) }));
    const lone = insertUser(ctx.db, { nickname: "Yalnız", createdAt: Date.UTC(2026, 1, 1) });
    graph.vouch(old, others[0], "close");
    graph.vouch(others[0], others[1], "close");
    graph.vouch(others[1], others[2], "close");
    graph.vouch(others[2], old, "known");
    const r = graph.sybilRank();
    expect(r.flagged).toContain(lone);
    expect(r.flagged).not.toContain(old);
    expect(r.flagged).not.toContain(others[0]);
  });
});

describe("graf analizi: kilit adım (lockstep)", () => {
  it("60 sn içinde aynı oyu veren ve geçmişte ≥%90 uzlaşan ≥4 kişilik grubu bulur", () => {
    const ctx = makeCtx();
    const graph = createGraphService(ctx, { ledger: null });
    const lock = ["l1", "l2", "l3", "l4", "l5"].map((id) => insertUser(ctx.db, { id, nickname: id }));
    const [late, contrarian, other] = ["o-late", "o-contra", "o-no"].map((id) => insertUser(ctx.db, { id, nickname: id }));
    const past: Choice[] = ["yes", "no", "yes", "yes"];
    past.forEach((c, i) => {
      const p = addProposal(ctx.db, lock[0], "enacted", `past${i}`);
      for (const u of [...lock, late]) addBallot(ctx.db, p, u, c);
      addBallot(ctx.db, p, contrarian, c === "yes" ? "no" : "yes");
      addBallot(ctx.db, p, other, c);
    });
    const target = addProposal(ctx.db, lock[0], "voting", "target");
    const t = T0 + 86_400_000;
    lock.forEach((u, i) => addBallot(ctx.db, target, u, "yes", { at: t + i * 10_000 }));
    addBallot(ctx.db, target, contrarian, "yes", { at: t + 20_000 });
    addBallot(ctx.db, target, late, "yes", { at: t + 5 * 60_000 });
    addBallot(ctx.db, target, other, "no", { at: t + 5_000 });

    expect(graph.lockstep(target).groups).toEqual([["l1", "l2", "l3", "l4", "l5"]]);
    expect(graph.lockstep("yok").groups).toEqual([]);
  });

  it("3 kişilik grup yetmez", () => {
    const ctx = makeCtx();
    const graph = createGraphService(ctx, { ledger: null });
    const lock = ["m1", "m2", "m3"].map((id) => insertUser(ctx.db, { id, nickname: id }));
    for (let i = 0; i < 4; i++) {
      const p = addProposal(ctx.db, lock[0], "enacted", `pp${i}`);
      for (const u of lock) addBallot(ctx.db, p, u, "yes");
    }
    const target = addProposal(ctx.db, lock[0], "voting", "tt");
    for (const u of lock) addBallot(ctx.db, target, u, "yes", { at: T0 + 100_000 });
    expect(graph.lockstep(target).groups).toEqual([]);
  });
});

describe("graf analizi: kalıcı kaybeden göstergesi", () => {
  it("son anlık görüntüdeki kümeler için çoğunluğun kaybettiği kesin kararların oranı", () => {
    const ctx = makeCtx();
    const graph = createGraphService(ctx, { ledger: null });
    const ga = ["ga1", "ga2", "ga3"].map((id) => insertUser(ctx.db, { id, nickname: id }));
    const gb = ["gb1", "gb2", "gb3"].map((id) => insertUser(ctx.db, { id, nickname: id }));
    // Eski anlık görüntü (yok sayılmalı) ve en yeni anlık görüntü
    addSnapshot(ctx.db, Object.fromEntries([...ga, ...gb].map((u) => [u, "g0"])), {}, { at: T0 - 1000 });
    addSnapshot(ctx.db, { ...Object.fromEntries(ga.map((u) => [u, "g0"])), ...Object.fromEntries(gb.map((u) => [u, "g1"])) }, {}, { at: T0 });

    const vote = (p: string, a: Choice, b: Choice, round = 1) => {
      for (const u of ga) addBallot(ctx.db, p, u, a, { round });
      for (const u of gb) addBallot(ctx.db, p, u, b, { round });
    };
    const p1 = addProposal(ctx.db, ga[0], "enacted");
    vote(p1, "yes", "no");
    addTally(ctx.db, p1, "accept"); // gb kaybetti
    const p2 = addProposal(ctx.db, ga[0], "rejected");
    vote(p2, "yes", "no");
    addTally(ctx.db, p2, "reject"); // ga kaybetti
    const p3 = addProposal(ctx.db, ga[0], "enacted");
    vote(p3, "yes", "no");
    addTally(ctx.db, p3, "accept"); // gb kaybetti
    const p4 = addProposal(ctx.db, ga[0], "voting");
    vote(p4, "no", "yes");
    addTally(ctx.db, p4, "needs_more_votes"); // sayılmaz
    const p5 = addProposal(ctx.db, ga[0], "enacted");
    vote(p5, "no", "yes", 1);
    addTally(ctx.db, p5, "contested", 1);
    vote(p5, "yes", "no", 2);
    addTally(ctx.db, p5, "accept", 2, T0 + 9000); // son tur: gb kaybetti
    const p6 = addProposal(ctx.db, ga[0], "enacted");
    for (const u of ga) addBallot(ctx.db, p6, u, "abstain");
    for (const u of gb) addBallot(ctx.db, p6, u, "yes");
    addTally(ctx.db, p6, "accept"); // ga'nın çoğunluğu yok → ga için sayılmaz

    expect(graph.stats().permanentLoser).toEqual([
      { clusterId: "g0", lostShare: 0.25, decisions: 4 },
      { clusterId: "g1", lostShare: 0.6, decisions: 5 },
    ]);
  });

  it("anlık görüntü yoksa boş", () => {
    const ctx = makeCtx();
    expect(createGraphService(ctx, { ledger: null }).stats().permanentLoser).toEqual([]);
  });
});

describe("graf analizi: istatistik ve görselleştirme", () => {
  function scene() {
    const ctx = makeCtx();
    const ledger = new FakeLedger(ctx.clock);
    const graph = createGraphService(ctx, { ledger });
    const { blocA, blocB } = twoBlocs(ctx);
    const pending = insertUser(ctx.db, { nickname: "Bekleyen", status: "pending", verifiedAt: null });
    const [a1, a2, a3] = blocA;
    const [b1, b2] = blocB;
    graph.follow(a1, a2);
    graph.follow(a2, a3);
    graph.follow(a3, b1); // köprü
    graph.follow(b1, b2);
    graph.vouch(a1, b1, "known");
    graph.delegate(a2, b1, "*", 1);
    graph.delegate(a3, b1, "*", 1);
    graph.relate(a1, a2, "family");
    graph.follow(pending, a1); // doğrulanmamış uca bağlı kenar görselleştirmede yer almaz
    addExpert(ctx.db, a3);
    addExpert(ctx.db, b2, "suspended");
    addSnapshot(
      ctx.db,
      { ...Object.fromEntries(blocA.map((u) => [u, "g0"])), ...Object.fromEntries(blocB.map((u) => [u, "g1"])) },
      Object.fromEntries([...blocA, ...blocB].map((u, i) => [u, [i, -i] as [number, number]])),
      { seed: "kume-tohumu" },
    );
    return { ctx, ledger, graph, blocA, blocB, pending };
  }

  it("stats: yapı ve değerler", () => {
    const { graph, ledger, blocA, blocB } = scene();
    const s = graph.stats();
    expect(s.nodes).toBe(10); // yalnız doğrulanmış üyeler
    expect(s.edges).toBe(9); // aktif, user-user (doğrulanmamış uçlu takip dahil)
    expect(s.communities).toBe(2);
    expect(s.modularity).toBeGreaterThan(0.3);
    expect(s.maxDelegationLoad).toBe(2);
    // 10 üyeden yalnız birinin yükü 2 → Gini = 0,9
    expect(s.delegationGini).toBeCloseTo(0.9, 6);
    expect(s.brokers.length).toBeGreaterThan(0);
    expect(s.brokers.length).toBeLessThanOrEqual(5);
    const nicknames = new Map([...blocA, ...blocB].map((u) => [u, u.toUpperCase()]));
    for (const b of s.brokers) {
      expect(b.nickname).toBe(nicknames.get(b.userId));
      expect(b.score).toBeGreaterThan(0);
    }
    // b1, b2'yi geri kalanlara bağlayan tek düğüm; a2, a1–a3 arasındaki iki en kısa yoldan birinde
    expect(s.brokers.map((b) => b.userId)).toEqual([blocB[0], blocA[1]]);
    expect(typeof s.sybilFlagged).toBe("number");
    expect(s.permanentLoser.map((p) => p.clusterId)).toEqual(["g0", "g1"]);
    // Louvain, son anlık görüntünün tohumuyla bir kez çalışır
    const runs = ledger.txs.filter((t) => t.type === "GRAPH_RUN");
    expect(runs).toHaveLength(1);
    expect(runs[0].payload.seed).toBe("kume-tohumu");
    graph.stats();
    expect(ledger.txs.filter((t) => t.type === "GRAPH_RUN")).toHaveLength(1);
  });

  it("visualization: düğüm alanları ve varsayılan kenar tipleri", () => {
    const { graph, blocA, blocB, pending } = scene();
    const v = graph.visualization({});
    expect(v.nodes).toHaveLength(10);
    expect(v.nodes.some((n) => n.id === pending)).toBe(false);
    const byId = new Map(v.nodes.map((n) => [n.id, n]));
    const a3 = byId.get(blocA[2])!;
    expect(a3).toMatchObject({ label: blocA[2].toUpperCase(), cluster: "g0", isExpert: true, x: 2, y: -2 });
    expect(typeof a3.pagerank).toBe("number");
    expect(typeof a3.sybilFlag).toBe("boolean");
    expect(byId.get(blocB[1])!.isExpert).toBe(false);
    expect(byId.get(blocB[0])!.cluster).toBe("g1");
    const ca = byId.get(blocA[0])!.community;
    expect(ca).not.toBeNull();
    expect(byId.get(blocB[0])!.community).not.toBe(ca);
    // düğümler pagerank'e göre azalan sırada; bağlantı alan b1, yalıtılmış a5'ten önde
    for (let i = 1; i < v.nodes.length; i++) expect(v.nodes[i - 1].pagerank).toBeGreaterThanOrEqual(v.nodes[i].pagerank);
    expect(byId.get(blocB[0])!.pagerank).toBeGreaterThan(byId.get(blocA[4])!.pagerank);

    const types = new Set(v.edges.map((e) => e.type));
    expect([...types].sort()).toEqual(["DELEGATES_TO", "FOLLOWS", "VOUCHES"]);
    expect(v.edges).toHaveLength(7);
    expect(v.edges).toContainEqual({ source: blocA[0], target: blocB[0], type: "VOUCHES", weight: 0.7 });

    // İzin listesi: RELATED_TO yalnız includePrivate === true iken; AGREES hiçbir zaman
    expect(graph.visualization({ includeEdgeTypes: ["RELATED_TO"] }).edges).toEqual([]);
    expect(graph.visualization({ includeEdgeTypes: ["RELATED_TO", "FOLLOWS"] }).edges.some((e) => e.type === "RELATED_TO")).toBe(false);
    const rel = graph.visualization({ includeEdgeTypes: ["RELATED_TO"], includePrivate: true } as Parameters<typeof graph.visualization>[0]);
    expect(rel.edges).toEqual([{ source: blocA[0], target: blocA[1], type: "RELATED_TO", weight: 1 }]);
    graph.addEdge({ src: blocA[0], dst: blocB[0], type: "AGREES", weight: 1 });
    const agrees = graph.visualization({ includeEdgeTypes: ["AGREES"], includePrivate: true } as Parameters<typeof graph.visualization>[0]);
    expect(agrees.edges).toEqual([]);

    const top = graph.visualization({ limit: 2 });
    expect(top.nodes).toHaveLength(2);
    const ids = new Set(top.nodes.map((n) => n.id));
    for (const e of top.edges) expect(ids.has(e.source) && ids.has(e.target)).toBe(true);
  });

  it("pagerank ve brokers yalnız kullanıcı kimlikleriyle (öneksiz) döner; önbellek yazımda yenilenir", () => {
    const { graph, blocA, blocB } = scene();
    const pr = graph.pagerank();
    expect(Object.keys(pr)).toHaveLength(10);
    expect(Object.keys(pr).every((k) => !k.includes(":"))).toBe(true);
    const sum = Object.values(pr).reduce((s, x) => s + x, 0);
    expect(sum).toBeCloseTo(1, 4);
    expect(graph.brokers(1)).toHaveLength(1);
    const before = graph.pagerank()[blocB[4]];
    for (const u of [...blocA, ...blocB.slice(0, 3)]) graph.follow(u, blocB[4]);
    expect(graph.pagerank()[blocB[4]]).toBeGreaterThan(before);
  });
});
