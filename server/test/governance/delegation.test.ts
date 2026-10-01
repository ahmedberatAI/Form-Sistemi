import { describe, expect, it } from "vitest";
import { createRng, decide, delegationCap, type VoteChoice } from "@forum/shared";
import type { DelegationEdge } from "../../src/core/contracts";
import { createGovernanceMath, defaultDecisionParams, normalizeScopeOrder, resolveEffectiveVotes, scopeOrderFor } from "../../src/governance";

let seq = 0;
function edge(from: string, to: string, opts: { scope?: string; rank?: number; createdAt?: number; id?: string } = {}): DelegationEdge {
  seq++;
  return { id: opts.id ?? `e${String(seq).padStart(4, "0")}`, from, to, scope: opts.scope ?? "*", rank: opts.rank ?? 1, createdAt: opts.createdAt ?? seq };
}

const EGITIM = "fy:Egitim";
const KAMU = "fy:KamuHizmetleri";
const SAGLIK = "fy:Saglik";

function resolve(over: {
  eligible: string[];
  direct?: Record<string, VoteChoice>;
  delegations?: DelegationEdge[];
  scopeOrder?: string[];
  cap?: number;
  maxHops?: number;
  clusters?: Record<string, string>;
}) {
  return resolveEffectiveVotes({
    eligible: over.eligible,
    direct: new Map(Object.entries(over.direct ?? {})),
    delegations: over.delegations ?? [],
    scopeOrder: over.scopeOrder ?? [EGITIM, KAMU, "*"],
    cap: over.cap ?? 10,
    maxHops: over.maxHops ?? 3,
    clusterOf: (u) => over.clusters?.[u] ?? null,
  });
}

const voteOf = (r: ReturnType<typeof resolve>, u: string) => r.votes.find((v) => v.voterKey === u);

describe("resolveEffectiveVotes (§5)", () => {
  it("doğrudan oy önceliklidir: oy veren kişinin vekâleti askıya alınır", () => {
    const r = resolve({ eligible: ["u", "d"], direct: { u: "no", d: "yes" }, delegations: [edge("u", "d")] });
    expect(voteOf(r, "u")).toEqual({ voterKey: "u", choice: "no", via: "direct", clusterId: null });
    expect(r.loads).toEqual({});
  });

  it("vekâletle gelen oy kişinin KENDİ kümesine sayılır", () => {
    const r = resolve({ eligible: ["u", "d"], direct: { d: "yes" }, delegations: [edge("u", "d")], clusters: { u: "g2", d: "g0" } });
    expect(voteOf(r, "u")).toEqual({ voterKey: "u", choice: "yes", via: "delegated", clusterId: "g2" });
    expect(voteOf(r, "d")).toEqual({ voterKey: "d", choice: "yes", via: "direct", clusterId: "g0" });
    expect(r.loads).toEqual({ d: 1 });
  });

  it("kapsam sırası: önerinin özel kategorisi '*'dan önce gelir", () => {
    const delegations = [edge("u", "genel"), edge("u", "egitimci", { scope: EGITIM })];
    const direct = { genel: "no" as VoteChoice, egitimci: "yes" as VoteChoice };
    const eligible = ["u", "genel", "egitimci"];
    expect(voteOf(resolve({ eligible, direct, delegations, scopeOrder: [EGITIM, "*"] }), "u")!.choice).toBe("yes");
    expect(voteOf(resolve({ eligible, direct, delegations, scopeOrder: [SAGLIK] }), "u")!.choice).toBe("no"); // kategori eşleşmez → "*"
  });

  it("kapsam sırası en özelden genele: önce gelen kategori kazanır", () => {
    const delegations = [edge("u", "kamucu", { scope: KAMU }), edge("u", "egitimci", { scope: EGITIM })];
    const direct = { kamucu: "no" as VoteChoice, egitimci: "yes" as VoteChoice };
    const eligible = ["u", "kamucu", "egitimci"];
    expect(voteOf(resolve({ eligible, direct, delegations, scopeOrder: [EGITIM, KAMU] }), "u")!.choice).toBe("yes");
    expect(voteOf(resolve({ eligible, direct, delegations, scopeOrder: [KAMU, EGITIM] }), "u")!.choice).toBe("no");
  });

  it("'*' kapsam listesinde yoksa sona eklenir; ortadaysa sona taşınır", () => {
    expect(normalizeScopeOrder([EGITIM])).toEqual([EGITIM, "*"]);
    expect(normalizeScopeOrder(["*", EGITIM, EGITIM, KAMU])).toEqual([EGITIM, KAMU, "*"]);
    const r = resolve({ eligible: ["u", "d"], direct: { d: "abstain" }, delegations: [edge("u", "d")], scopeOrder: [EGITIM] });
    expect(voteOf(r, "u")!.choice).toBe("abstain");
  });

  it("scopeOrderFor: derinliğe göre en özelden genele, eşitlikte IRI, sonra '*'", () => {
    const depth: Record<string, number> = { "fy:A": 1, "fy:A1": 2, "fy:B": 1, "fy:A1x": 3 };
    expect(scopeOrderFor(["fy:B", "fy:A", "fy:A1x", "fy:A1", "fy:A"], (i) => depth[i])).toEqual(["fy:A1x", "fy:A1", "fy:A", "fy:B", "*"]);
  });

  it("rank sırası: en düşük rank'tan başlanır; oy vermeyen delegeden sonrakine geçilir", () => {
    const eligible = ["u", "d1", "d2"];
    const delegations = [edge("u", "d2", { rank: 2 }), edge("u", "d1", { rank: 1 })];
    expect(voteOf(resolve({ eligible, direct: { d1: "no", d2: "yes" }, delegations }), "u")!.choice).toBe("no");
    expect(voteOf(resolve({ eligible, direct: { d2: "yes" }, delegations }), "u")!.choice).toBe("yes");
  });

  it("zincir en fazla H=3 adım: u→a→b→c tamam, u→a→b→c→d yok", () => {
    const eligible = ["u", "a", "b", "c", "d"];
    const chain = [edge("u", "a"), edge("a", "b"), edge("b", "c")];
    const ok = resolve({ eligible, direct: { c: "yes" }, delegations: chain });
    expect(voteOf(ok, "u")!.choice).toBe("yes");
    expect(ok.loads).toEqual({ c: 3 }); // u, a, b
    const tooLong = resolve({ eligible, direct: { d: "yes" }, delegations: [...chain, edge("c", "d")] });
    expect(voteOf(tooLong, "u")).toBeUndefined();
    expect(voteOf(tooLong, "a")!.choice).toBe("yes"); // a→b→c→d = 3 adım
    expect(tooLong.loads).toEqual({ d: 3 }); // a, b, c
    const oneHop = resolve({ eligible, direct: { c: "yes" }, delegations: chain, maxHops: 1 });
    expect(oneHop.votes.map((v) => v.voterKey)).toEqual(["b", "c"]);
    expect(resolve({ eligible, direct: { c: "yes" }, delegations: chain, maxHops: 0 }).votes.map((v) => v.voterKey)).toEqual(["c"]);
  });

  it("döngü ziyaret kümesiyle kesilir; döngüden çıkış varsa sıradaki tercih izlenir", () => {
    const eligible = ["u", "a", "b", "c"];
    const cyc = resolve({ eligible, delegations: [edge("u", "a"), edge("a", "b"), edge("b", "u")] });
    expect(cyc.votes).toEqual([]);
    const exit = resolve({ eligible, direct: { c: "no" }, delegations: [edge("u", "a"), edge("a", "u", { rank: 1 }), edge("a", "c", { rank: 2 })] });
    expect(voteOf(exit, "u")!.choice).toBe("no");
    expect(voteOf(exit, "a")!.choice).toBe("no");
    expect(exit.loads).toEqual({ c: 2 });
    expect(resolve({ eligible: ["u"], delegations: [edge("u", "u")] }).votes).toEqual([]);
  });

  it("delegateOf: oyu uygulanan (zincir sonundaki) delege; doğrudan oy verenler ve sınırı aşanlar izde yok", () => {
    // u → a (oy yok) → c (oy verdi); v → c; w → c ama sınır 2 → w unrouted (oluşturma sırası: u, v, w)
    const r = resolve({
      eligible: ["u", "a", "c", "v", "w"],
      direct: { c: "no" },
      delegations: [edge("u", "a", { createdAt: 1 }), edge("a", "c", { createdAt: 2 }), edge("v", "c", { createdAt: 3 }), edge("w", "c", { createdAt: 4 })],
      cap: 3,
    });
    expect(r.delegateOf).toEqual({ a: "c", u: "c", v: "c" });
    expect(r.loads).toEqual({ c: 3 });
    expect(r.unrouted).toEqual(["w"]);
    expect(r.delegateOf.c).toBeUndefined(); // doğrudan oy veren
    // u'nun izi ara halka a değil, oyu uygulanan c'dir
    expect(voteOf(r, "u")).toMatchObject({ choice: "no", via: "delegated" });
    // vekâlet yoksa iz boş
    expect(resolve({ eligible: ["x"], direct: { x: "yes" } }).delegateOf).toEqual({});
  });

  it("derinlik öncelikli: üst tercihin zinciri, alt tercihin doğrudan oyundan önce gelir", () => {
    const r = resolve({ eligible: ["u", "d1", "x", "d2"], direct: { x: "no", d2: "yes" }, delegations: [edge("u", "d1", { rank: 1 }), edge("d1", "x"), edge("u", "d2", { rank: 2 })] });
    expect(voteOf(r, "u")!.choice).toBe("no");
  });

  it("sınır (cap): taşanlar unrouted; sıra vekâlet oluşturma zamanı, sonra kullanıcı kimliği", () => {
    const eligible = ["d", "u1", "u2", "u3", "u4", "u5"];
    const delegations = [
      edge("u5", "d", { createdAt: 10 }),
      edge("u4", "d", { createdAt: 20 }),
      edge("u3", "d", { createdAt: 20 }),
      edge("u2", "d", { createdAt: 30 }),
      edge("u1", "d", { createdAt: 40 }),
    ];
    const r = resolve({ eligible, direct: { d: "yes" }, delegations, cap: 3 });
    expect(r.votes.filter((v) => v.via === "delegated").map((v) => v.voterKey)).toEqual(["u3", "u4", "u5"]);
    expect(r.unrouted).toEqual(["u1", "u2"]);
    expect(r.capped).toEqual(["d"]);
    expect(r.loads).toEqual({ d: 3 });
    // girdi sırası önemsiz
    const shuffled = resolve({ eligible: eligible.slice().reverse(), direct: { d: "yes" }, delegations: createRng("k").shuffle(delegations), cap: 3 });
    expect(shuffled).toEqual(r);
  });

  it("sınır dolunca alt tercihe kaydırılmaz (§5.4: oyları kullanılmamış olur)", () => {
    const r = resolve({
      eligible: ["d", "e", "u1", "u2"],
      direct: { d: "yes", e: "no" },
      delegations: [edge("u1", "d", { createdAt: 1 }), edge("u2", "d", { createdAt: 2 }), edge("u2", "e", { rank: 2, createdAt: 3 })],
      cap: 1,
    });
    expect(voteOf(r, "u1")!.choice).toBe("yes");
    expect(voteOf(r, "u2")).toBeUndefined();
    expect(r.unrouted).toEqual(["u2"]);
  });

  it("sınır sıralaması zincirde delegatörün kendi ilk adım vekâletinin zamanını kullanır", () => {
    const r = resolve({
      eligible: ["d", "a", "u"],
      direct: { d: "no" },
      delegations: [edge("a", "d", { createdAt: 50 }), edge("u", "a", { createdAt: 5 })],
      cap: 1,
    });
    expect(voteOf(r, "u")!.choice).toBe("no");
    expect(r.unrouted).toEqual(["a"]);
  });

  it("uygun seçmen olmayan delege atlanır: ne oy kaynağı ne ara halka; sıradaki tercihe düşülür", () => {
    const eligible = ["u", "v", "d"];
    const direct = { yazar: "yes" as VoteChoice, d: "no" as VoteChoice };
    const skip = resolve({ eligible, direct, delegations: [edge("u", "yazar", { rank: 1 }), edge("u", "d", { rank: 2 })] });
    expect(voteOf(skip, "u")!.choice).toBe("no");
    expect(voteOf(skip, "yazar")).toBeUndefined(); // E dışındaki doğrudan oy sayılmaz
    const via = resolve({ eligible, direct, delegations: [edge("v", "yazar"), edge("yazar", "d")] });
    expect(voteOf(via, "v")).toBeUndefined();
  });

  it("çıktı belirlenimci ve voterKey'e göre sıralı; decide ile yinelenen anahtar üretmez", () => {
    const users = Array.from({ length: 40 }, (_, i) => `k${String(i).padStart(2, "0")}`);
    const rng = createRng("vekalet");
    const direct: Record<string, VoteChoice> = {};
    const delegations: DelegationEdge[] = [];
    users.forEach((u, i) => {
      if (i % 3 === 0) direct[u] = rng.next() < 0.6 ? "yes" : "no";
      else delegations.push(edge(u, users[rng.int(users.length)], { rank: 1 }), edge(u, users[rng.int(users.length)], { rank: 2 }));
    });
    const clusters = Object.fromEntries(users.map((u, i) => [u, `g${i % 2}`]));
    const a = resolve({ eligible: users, direct, delegations, cap: delegationCap(users.length), clusters });
    const b = resolve({ eligible: users.slice().reverse(), direct, delegations: delegations.slice().reverse(), cap: delegationCap(users.length), clusters });
    expect(b).toEqual(a);
    const keys = a.votes.map((v) => v.voterKey);
    expect(keys).toEqual(keys.slice().sort());
    for (const load of Object.values(a.loads)) expect(load).toBeLessThanOrEqual(2);
    const total = a.votes.length + a.unrouted.length;
    expect(total).toBeLessThanOrEqual(users.length);
    const r = decide({
      params: defaultDecisionParams("T0"),
      round: 1,
      eligibleCount: users.length,
      votes: a.votes,
      clusterSizes: { g0: 20, g1: 20 },
      clusteredTotal: 40,
      k: 2,
      extensionAvailable: false,
      unrouted: a.unrouted.length,
      now: 0,
    });
    expect(r.totals.delegated).toBe(a.votes.filter((v) => v.via === "delegated").length);
    expect(r.totals.unrouted).toBe(a.unrouted.length);
  });

  it("createGovernanceMath().resolveEffectiveVotes aynı sonucu verir", () => {
    const input = { eligible: ["u", "d"], direct: new Map<string, VoteChoice>([["d", "yes"]]), delegations: [edge("u", "d")], scopeOrder: ["*"], cap: 2, maxHops: 3, clusterOf: () => null };
    expect(createGovernanceMath().resolveEffectiveVotes(input)).toEqual(resolveEffectiveVotes(input));
  });
});
