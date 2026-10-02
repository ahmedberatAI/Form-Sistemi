import { createHmac } from "node:crypto";
import { describe, it, expect, beforeEach } from "vitest";
import { sha256Hex, fy } from "@forum/shared";
import { createGraphService } from "../../src/graph";
import { AppError } from "../../src/core/errors";
import type { GraphService } from "../../src/core/contracts";
import { FakeLedger, insertUser, makeCtx, type TestCtx } from "../helpers/fakes";

function expectAppError(fn: () => unknown, status: number, code?: string): AppError {
  try {
    fn();
  } catch (e) {
    expect(e).toBeInstanceOf(AppError);
    const err = e as AppError;
    expect(err.status).toBe(status);
    if (code) expect(err.code).toBe(code);
    return err;
  }
  throw new Error("AppError bekleniyordu");
}

describe("graf: takip, kefalet, yakınlık", () => {
  let ctx: TestCtx;
  let graph: GraphService;
  let a: string, b: string, c: string;

  beforeEach(() => {
    ctx = makeCtx();
    graph = createGraphService(ctx, { ledger: null });
    a = insertUser(ctx.db, { nickname: "Ayşe" });
    b = insertUser(ctx.db, { nickname: "Bora" });
    c = insertUser(ctx.db, { nickname: "Cem" });
  });

  it("takip kenarı önekli düğümlerle oluşur, tekrar takip aynı kenarı döndürür", () => {
    const e = graph.follow(a, b);
    expect(e).toMatchObject({ src: `user:${a}`, dst: `user:${b}`, type: "FOLLOWS", weight: 1 });
    expect(graph.follow(a, `user:${b}`).id).toBe(e.id);
    expect(graph.listEdges({ src: a, type: "FOLLOWS" })).toHaveLength(1);
    expect(graph.distance(a, b, ["FOLLOWS"], 3)).toBe(1);
  });

  it("takibi bırakmak kenarı silmez, revoked_at doldurur", () => {
    const e = graph.follow(a, b);
    ctx.clock.advance(5000);
    graph.unfollow(a, b);
    expect(graph.listEdges({ src: a, type: "FOLLOWS" })).toHaveLength(0);
    const all = graph.listEdges({ src: a, type: "FOLLOWS", includeRevoked: true });
    expect(all.map((x) => x.id)).toEqual([e.id]);
    const row = ctx.db.get<{ revoked_at: number | null }>("SELECT revoked_at FROM graph_edges WHERE id = ?", e.id);
    expect(row?.revoked_at).toBe(ctx.clock.now());
    expect(graph.distance(a, b, ["FOLLOWS"], 3)).toBeNull();
    // yeniden takip yeni kenar üretir
    expect(graph.follow(a, b).id).not.toBe(e.id);
  });

  it("kendini takip ve bilinmeyen kullanıcı reddedilir", () => {
    expectAppError(() => graph.follow(a, a), 400, "self_follow");
    expectAppError(() => graph.follow(a, "yok-boyle-biri"), 404);
  });

  it("kefalet ağırlıkları: close 1,0 / known 0,7 / just_met 0,3 / suspicious −1", () => {
    expect(graph.vouch(a, b, "close").weight).toBe(1);
    expect(graph.vouch(a, c, "known").weight).toBe(0.7);
    expect(graph.vouch(b, c, "just_met").weight).toBe(0.3);
    const s = graph.vouch(c, a, "suspicious");
    expect(s.weight).toBe(-1);
    expect(s.meta).toEqual({ level: "suspicious" });
  });

  it("aynı kişiye yeni kefalet eskisini geri alır", () => {
    const first = graph.vouch(a, b, "just_met");
    expect(graph.vouch(a, b, "just_met").id).toBe(first.id);
    const second = graph.vouch(a, b, "close");
    expect(second.id).not.toBe(first.id);
    const active = graph.listEdges({ src: a, dst: b, type: "VOUCHES" });
    expect(active.map((x) => x.id)).toEqual([second.id]);
    expect(graph.listEdges({ src: a, dst: b, type: "VOUCHES", includeRevoked: true })).toHaveLength(2);
  });

  it("yakınlık beyanı meta.kind taşır ve iki yönde de tekrarlanmaz", () => {
    const r = graph.relate(a, b, "family");
    expect(r.type).toBe("RELATED_TO");
    expect(r.meta).toEqual({ kind: "family" });
    expect(graph.relate(b, a, "family").id).toBe(r.id);
    expect(graph.relate(b, a, "business").id).not.toBe(r.id);
    expectAppError(() => graph.relate(a, a, "household"), 400, "self_relation");
  });

  it("genel revokeEdge kenarı geri alır; bilinmeyen kenar 404", () => {
    const e = graph.addEdge({ src: `user:${a}`, dst: "topic:t1", type: "AUTHORED" });
    expect(graph.distance(a, "topic:t1", ["AUTHORED"], 1)).toBe(1);
    graph.revokeEdge(e.id);
    expect(graph.distance(a, "topic:t1", ["AUTHORED"], 1)).toBeNull();
    expectAppError(() => graph.revokeEdge("yok"), 404);
    expectAppError(() => graph.addEdge({ src: a, dst: b, type: "BILINMEYEN" as never }), 400, "invalid_edge_type");
  });

  it("rebuild: yeni hizmet örneği grafı SQLite'tan kurar (geri alınmış kenarlar hariç)", () => {
    graph.follow(a, b);
    graph.follow(b, c);
    graph.follow(a, c);
    graph.unfollow(a, c);
    const fresh = createGraphService(ctx, { ledger: null });
    expect(fresh.distance(a, c, ["FOLLOWS"], 5)).toBe(2);
  });
});

describe("graf: mesafe", () => {
  it("yönsüz BFS, yalnız verilen tipler ve maxDepth", () => {
    const ctx = makeCtx();
    const graph = createGraphService(ctx, { ledger: null });
    const [u1, u2, u3, u4, u5] = ["U1", "U2", "U3", "U4", "U5"].map((n) => insertUser(ctx.db, { nickname: n }));
    graph.follow(u1, u2);
    graph.vouch(u3, u2, "known"); // yön ters: yönsüz arama yine bulur
    graph.relate(u3, u4, "business");
    expect(graph.distance(u1, u1, ["FOLLOWS"], 0)).toBe(0);
    expect(graph.distance(u1, u3, ["FOLLOWS", "VOUCHES"], 3)).toBe(2);
    expect(graph.distance(u1, u3, ["FOLLOWS"], 3)).toBeNull();
    expect(graph.distance(u1, u3, ["FOLLOWS", "VOUCHES"], 1)).toBeNull();
    expect(graph.distance(u1, u4, ["FOLLOWS", "VOUCHES", "RELATED_TO"], 3)).toBe(3);
    expect(graph.distance(`user:${u4}`, u1, ["FOLLOWS", "VOUCHES", "RELATED_TO"], 3)).toBe(3);
    expect(graph.distance(u1, u5, ["FOLLOWS", "VOUCHES", "RELATED_TO"], 10)).toBeNull();
  });
});

describe("graf: vekâlet", () => {
  let ctx: TestCtx;
  let ledger: FakeLedger;
  let graph: GraphService;
  let a: string, b: string, c: string, d: string, pending: string;

  beforeEach(() => {
    ctx = makeCtx();
    ledger = new FakeLedger(ctx.clock);
    graph = createGraphService(ctx, { ledger });
    a = insertUser(ctx.db, { nickname: "Ayşe" });
    b = insertUser(ctx.db, { nickname: "Bora" });
    c = insertUser(ctx.db, { nickname: "Cem" });
    d = insertUser(ctx.db, { nickname: "Deniz" });
    pending = insertUser(ctx.db, { nickname: "Bekleyen", status: "pending", verifiedAt: null });
  });

  it("vekâlet görünümü takma adı ve kapsamı içerir; fy: kısa adı tam IRI'ye açılır", () => {
    const v = graph.delegate(a, b, "fy:Ulasim", 1);
    expect(v).toMatchObject({ from: a, to: b, toNickname: "Bora", scope: fy("Ulasim"), rank: 1, createdAt: ctx.clock.now() });
    expect(graph.delegations(a)).toEqual([{ id: v.id, from: a, to: b, scope: fy("Ulasim"), rank: 1, createdAt: v.createdAt }]);
  });

  it("döngü reddedilir: A→B→C varken C→A", () => {
    graph.delegate(a, b, "*", 1);
    graph.delegate(b, c, "*", 1);
    const err = expectAppError(() => graph.delegate(c, a, "*", 1), 409, "delegation_cycle");
    expect(err.message).toMatch(/döngü/);
    expect(graph.delegations(c)).toHaveLength(0);
  });

  it("döngü reddi kapsamdan bağımsızdır", () => {
    graph.delegate(a, b, "*", 1);
    graph.delegate(b, c, fy("Ulasim"), 2);
    expectAppError(() => graph.delegate(c, a, fy("Cevre"), 3), 409, "delegation_cycle");
    expectAppError(() => graph.delegate(b, a, fy("Saglik"), 1), 409, "delegation_cycle");
    // döngü yoksa farklı yöne vekâlet serbest
    expect(graph.delegate(c, d, "*", 1).to).toBe(d);
  });

  it("aynı (kapsam, sıra) için yeni vekâlet eskisinin yerine geçer", () => {
    const first = graph.delegate(a, b, "*", 1);
    ctx.clock.advance(1000);
    const second = graph.delegate(a, c, "*", 1);
    ctx.clock.advance(1000);
    const third = graph.delegate(a, d, "*", 2);
    expect(graph.delegations(a).map((x) => x.id)).toEqual([second.id, third.id]);
    const old = graph.listEdges({ src: a, type: "DELEGATES_TO", includeRevoked: true }).find((e) => e.id === first.id);
    expect(old).toBeDefined();
    expect(ctx.db.get<{ revoked_at: number | null }>("SELECT revoked_at FROM graph_edges WHERE id = ?", first.id)?.revoked_at).not.toBeNull();
    // aynısı tekrar verilirse yeni kenar oluşmaz
    expect(graph.delegate(a, c, "*", 1).id).toBe(second.id);
    const actions = ledger.txs.filter((t) => t.type === "DELEGATION").map((t) => t.payload.action);
    expect(actions).toEqual(["create", "revoke", "create", "create"]);
  });

  it("doğrulanmamış hedefe, kendine, geçersiz sıra/kapsama vekâlet reddedilir", () => {
    expectAppError(() => graph.delegate(a, pending, "*", 1), 422, "delegate_not_verified");
    expectAppError(() => graph.delegate(a, a, "*", 1), 400, "self_delegation");
    expectAppError(() => graph.delegate(a, b, "*", 0), 400, "invalid_rank");
    expectAppError(() => graph.delegate(a, b, "*", 4), 400, "invalid_rank");
    expectAppError(() => graph.delegate(a, b, "geçersiz kapsam", 1), 400, "invalid_scope");
    expectAppError(() => graph.delegate(a, "yok", "*", 1), 404);
    expect(graph.delegations()).toHaveLength(0);
  });

  it("vekâleti yalnız sahibi geri alabilir", () => {
    const v = graph.delegate(a, b, "*", 1);
    expectAppError(() => graph.revokeDelegation(v.id, b), 403);
    expectAppError(() => graph.revokeDelegation("yok", a), 404);
    graph.revokeDelegation(v.id, a);
    expect(graph.delegations(a)).toHaveLength(0);
    graph.revokeDelegation(v.id, a); // tekrar: etkisiz
    const rows = ledger.txs.filter((t) => t.type === "DELEGATION");
    expect(rows.map((t) => t.payload.action)).toEqual(["create", "revoke"]);
    // geri alınan vekâlet döngü kontrolünü artık etkilemez
    expect(graph.delegate(b, a, "*", 1).to).toBe(a);
  });

  it("delegations() tüm aktif vekâletleri createdAt sonra id sırasıyla döndürür", () => {
    const v1 = graph.delegate(a, b, "*", 1);
    ctx.clock.advance(10);
    const v2 = graph.delegate(c, b, "*", 1);
    const v3 = graph.delegate(d, b, "*", 1);
    const sameTime = [v2, v3].sort((x, y) => (x.id < y.id ? -1 : 1)).map((x) => x.id);
    expect(graph.delegations().map((x) => x.id)).toEqual([v1.id, ...sameTime]);
  });

  it("DELEGATION defter yükünde ham kullanıcı kimliği yok; taahhüt sunucu sırrıyla HMAC", () => {
    const v = graph.delegate(a, b, fy("Ulasim"), 2);
    graph.revokeDelegation(v.id, a);
    const txs = ledger.txs.filter((t) => t.type === "DELEGATION");
    expect(txs).toHaveLength(2);
    const preimage = `${a}|${b}|${fy("Ulasim")}|2|${v.id}`;
    const expected = createHmac("sha256", ctx.config.voteKey).update(preimage, "utf8").digest("hex");
    for (const t of txs) {
      expect(Object.keys(t.payload).sort()).toEqual(["action", "commitment", "edgeId"]);
      expect(t.payload.commitment).toBe(expected);
      // Sırrı bilmeyen, defterdeki edgeId ve aday üye çiftleriyle düz SHA-256 hesaplayarak eşleştiremez
      expect(t.payload.commitment).not.toBe(sha256Hex(preimage));
      expect(t.payload.commitment).toMatch(/^[0-9a-f]{64}$/);
      const raw = JSON.stringify(t.payload);
      expect(raw).not.toContain(a);
      expect(raw).not.toContain(b);
      expect(raw).not.toContain("Bora");
    }
    const row = ctx.db.get<{ ledger_tx: string | null }>("SELECT ledger_tx FROM graph_edges WHERE id = ?", v.id);
    expect(row?.ledger_tx).toBe(txs[0].hash);
  });

  it("addEdge ile DELEGATES_TO da aynı doğrulamalardan geçer", () => {
    graph.addEdge({ src: `user:${a}`, dst: `user:${b}`, type: "DELEGATES_TO", scope: "*", rank: 1 });
    expectAppError(() => graph.addEdge({ src: b, dst: a, type: "DELEGATES_TO", scope: "*", rank: 1 }), 409, "delegation_cycle");
  });
});

describe("graf: çıkar çatışması (§8 adım 3–4)", () => {
  let ctx: TestCtx;
  let graph: GraphService;
  let expert: string, author: string, mid: string, other: string, far: string;

  beforeEach(() => {
    ctx = makeCtx();
    graph = createGraphService(ctx, { ledger: null });
    expert = insertUser(ctx.db, { nickname: "Bilirkişi" });
    author = insertUser(ctx.db, { nickname: "Yazar" });
    mid = insertUser(ctx.db, { nickname: "Ara" });
    other = insertUser(ctx.db, { nickname: "Diğer" });
    far = insertUser(ctx.db, { nickname: "Uzak" });
  });

  it("aynı kişi kesin çatışmadır", () => {
    const r = graph.conflictOfInterest(author, author);
    expect(r.hard).toBe(true);
    expect(r.distance).toBe(0);
  });

  it("üçüncü kişi aracılı 2 adımlık yakınlık zinciri kesin değil, yumuşak çatışmadır (#221)", () => {
    graph.relate(expert, mid, "family");
    graph.relate(author, mid, "business");
    const r = graph.conflictOfInterest(expert, author);
    expect(r.hard).toBe(false);
    expect(r.soft).toBe(0.5);
    expect(r.reasons.join(" ")).toMatch(/2 adımlık/);
  });

  it("yazarın beyan ettiği doğrudan yakınlık kesin çatışmadır (#221)", () => {
    graph.relate(author, expert, "family");
    expect(graph.conflictOfInterest(expert, author)).toMatchObject({ hard: true, soft: 0 });
  });

  it("doğrudan yakınlık türü gerekçede yazılır; 4 adım kesin değildir", () => {
    graph.relate(expert, author, "household");
    expect(graph.conflictOfInterest(expert, author).reasons[0]).toMatch(/hane/);
    const ctx2 = makeCtx();
    const g2 = createGraphService(ctx2, { ledger: null });
    const ids = ["E", "X1", "X2", "X3", "A"].map((n) => insertUser(ctx2.db, { nickname: n }));
    for (let i = 0; i < 4; i++) g2.relate(ids[i], ids[i + 1], "family");
    expect(g2.conflictOfInterest(ids[0], ids[4])).toMatchObject({ hard: false, soft: 0 });
    // 3 adımlık zincir de yalnız yumuşak çatışmadır (kesin dışlama yalnız doğrudan kenar ya da aynı hane)
    expect(g2.conflictOfInterest(ids[0], ids[3])).toMatchObject({ hard: false, soft: 0.5 });
  });

  it("aynı hane (householdOf) kesin çatışma; null hane eşleşmez", () => {
    const households: Record<string, string | null> = { [expert]: "h-1", [author]: "h-1", [other]: null, [far]: null };
    const householdOf = (id: string) => households[id] ?? null;
    const r = graph.conflictOfInterest(expert, author, { householdOf });
    expect(r.hard).toBe(true);
    expect(r.reasons).toContain("Yazarla aynı hanede yaşıyor.");
    expect(graph.conflictOfInterest(other, far, { householdOf }).hard).toBe(false);
  });

  it("yumuşak çatışma: mesafe 1 → 1,0; mesafe 2 → 0,5; uzak → 0", () => {
    graph.follow(expert, author);
    expect(graph.conflictOfInterest(expert, author)).toMatchObject({ hard: false, soft: 1, distance: 1 });
    graph.delegate(other, mid, "*", 1);
    graph.vouch(author, mid, "known");
    expect(graph.conflictOfInterest(other, author)).toMatchObject({ hard: false, soft: 0.5, distance: 2 });
    const r = graph.conflictOfInterest(far, author);
    expect(r).toMatchObject({ hard: false, soft: 0, distance: null });
    expect(r.reasons).toEqual([]);
  });
});
