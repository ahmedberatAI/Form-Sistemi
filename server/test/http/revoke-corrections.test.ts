// HTTP (gerçek servisler): kefalet/yakınlık beyanını geri alma, kimlik verisi düzeltme talebi akışı, hız sınırı ortam değişkenleri.
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import type { FastifyInstance } from "fastify";
import type { AuditLogEntry, CorrectionRequestView, CorrectionReview, Me, PiiRecord, PublicProfile } from "@forum/shared";
import { DEFAULT_RATE_LIMIT, rateLimitFromEnv } from "../../src/http";
import { boot, type Harness } from "./harness";
import { fakeUser, meOf, stubServer, stubServices } from "./stubs";

const TIMEOUT = 120_000;

describe("kefalet ve yakınlık beyanını geri alma (DELETE)", () => {
  let h: Harness;
  let a: { token: string; user: Me };
  let b: { token: string; user: Me };
  let auditor: { token: string; user: Me };

  beforeAll(async () => {
    h = await boot();
    a = await h.member("geri_a");
    b = await h.member("geri_b");
    auditor = await h.staff("geri_denetci", ["auditor"]);
  }, TIMEOUT);
  afterAll(async () => {
    await h?.close();
  });

  it("kefalet: geri alınır, kenar silinmez (revoked_at), tekrar çağrı işlem yapmaz, denetim kaydı yazılır", async () => {
    await h.ok("POST", `/api/users/${b.user.id}/vouch`, { token: a.token, body: { level: "close" } });
    expect((await h.ok<PublicProfile>("GET", `/api/users/${b.user.id}`, { token: a.token })).stats.vouchedBy).toBe(1);

    const p = await h.ok<PublicProfile>("DELETE", `/api/users/${b.user.id}/vouch`, { token: a.token });
    expect(p.viewer?.vouched).toBeNull();
    expect(p.stats.vouchedBy).toBe(0);
    const edges = h.services.graph.listEdges({ src: a.user.id, dst: b.user.id, type: "VOUCHES", includeRevoked: true });
    expect(edges).toHaveLength(1);
    expect(h.services.ctx.db.get<{ revoked_at: number | null }>("SELECT revoked_at FROM graph_edges WHERE id = ?", edges[0].id)?.revoked_at).not.toBeNull();

    // İdempotent: kefalet yoksa işlem yapılmaz
    expect((await h.ok<PublicProfile>("DELETE", `/api/users/${b.user.id}/vouch`, { token: a.token })).viewer?.vouched).toBeNull();
    // Yalnız kendi kefaleti: b, a'nın verdiği (artık geri alınmış) kefalete dokunamaz; kendi kefaleti yoksa işlem yok
    await h.ok("POST", `/api/users/${b.user.id}/vouch`, { token: a.token, body: { level: "known" } });
    await h.ok("DELETE", `/api/users/${a.user.id}/vouch`, { token: b.token });
    expect((await h.ok<PublicProfile>("GET", `/api/users/${b.user.id}`, { token: a.token })).viewer?.vouched).toBe("known");

    const log = await h.ok<AuditLogEntry[]>("GET", "/api/admin/audit-log?action=graph.vouch_revoked", { token: auditor.token });
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ actorId: a.user.id, target: b.user.id });
    expect((await h.req("DELETE", `/api/users/${b.user.id}/vouch`)).statusCode).toBe(401);
  });

  it("yakınlık: yalnız beyan eden geri alır (karşı taraf 403), relatedByMe, ?kind süzgeci, kenar silinmez", async () => {
    await h.ok("POST", `/api/users/${b.user.id}/relate`, { token: a.token, body: { kind: "family" } });
    await h.ok("POST", `/api/users/${b.user.id}/relate`, { token: a.token, body: { kind: "business" } });
    const mine = await h.ok<PublicProfile>("GET", `/api/users/${b.user.id}`, { token: a.token });
    expect(mine.viewer?.related.slice().sort()).toEqual(["business", "family"]);
    expect(mine.viewer?.relatedByMe?.slice().sort()).toEqual(["business", "family"]);
    // Karşı taraf beyanı görür (kendisiyle ilgili) ama kendi beyanı değildir → geri alamaz
    const theirs = await h.ok<PublicProfile>("GET", `/api/users/${a.user.id}`, { token: b.token });
    expect(theirs.viewer?.related.slice().sort()).toEqual(["business", "family"]);
    expect(theirs.viewer?.relatedByMe).toEqual([]);
    const denied = await h.req("DELETE", `/api/users/${a.user.id}/relate?kind=family`, { token: b.token });
    expect(denied.statusCode).toBe(403);
    expect(denied.json().error.message).toMatch(/yalnızca beyan eden/);

    // Süzgeçli geri alma: yalnız "iş"
    let p = await h.ok<PublicProfile>("DELETE", `/api/users/${b.user.id}/relate?kind=business`, { token: a.token });
    expect(p.viewer?.relatedByMe).toEqual(["family"]);
    // Olmayan tür: işlem yok
    p = await h.ok<PublicProfile>("DELETE", `/api/users/${b.user.id}/relate?kind=household`, { token: a.token });
    expect(p.viewer?.relatedByMe).toEqual(["family"]);
    expect((await h.req("DELETE", `/api/users/${b.user.id}/relate?kind=arkadas`, { token: a.token })).statusCode).toBe(400);
    // Tümü
    p = await h.ok<PublicProfile>("DELETE", `/api/users/${b.user.id}/relate`, { token: a.token });
    expect(p.viewer?.related).toEqual([]);
    expect(p.viewer?.relatedByMe).toEqual([]);
    const all = h.services.graph.listEdges({ src: a.user.id, dst: b.user.id, type: "RELATED_TO", includeRevoked: true });
    expect(all).toHaveLength(2); // silinmedi, geri alındı
    expect(h.services.graph.listEdges({ src: a.user.id, dst: b.user.id, type: "RELATED_TO" })).toHaveLength(0);
    // Çıkar çatışması denetimi artık bu yakınlığı görmez
    expect(h.services.graph.conflictOfInterest(a.user.id, b.user.id).hard).toBe(false);

    // Geri alma yalnız denetim günlüğünde; hedef beyan edenin kendisi (karşı tarafın KVKK dökümüne düşmez)
    const log = await h.ok<AuditLogEntry[]>("GET", "/api/admin/audit-log?action=graph.relation_revoked", { token: auditor.token });
    expect(log).toHaveLength(2);
    expect(log.every((e) => e.target === a.user.id && (e.meta as { other: string }).other === b.user.id)).toBe(true);
    const exportB = await h.ok<{ accountEvents: { action: string }[] }>("GET", "/api/me/export", { token: b.token });
    expect(exportB.accountEvents.some((e) => e.action === "graph.relation_revoked")).toBe(false);
  });
});

describe("kimlik verisi düzeltme talebi (HTTP)", () => {
  let h: Harness;
  let member: { token: string; user: Me };
  let registrar: { token: string; user: Me };
  let auditor: { token: string; user: Me };

  beforeAll(async () => {
    h = await boot();
    member = await h.member("duzeltme_uye", { lastName: "Eskisoy" });
    registrar = await h.staff("duzeltme_memur", ["registrar"]);
    auditor = await h.staff("duzeltme_denetci", ["auditor"]);
  }, TIMEOUT);
  afterAll(async () => {
    await h?.close();
  });

  it("üye talep açar → memur listeler, amaçla inceler, onaylar → üye yeni bilgiyi görür", async () => {
    const bad = await h.req("POST", "/api/me/corrections", { token: member.token, body: { changes: { lastName: "Yenisoy" }, reason: "kısa" } });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error.details).toHaveProperty("reason");

    const req = await h.ok<CorrectionRequestView>("POST", "/api/me/corrections", {
      token: member.token,
      body: { changes: { lastName: "Yenisoy" }, reason: "Soyadım mahkeme kararıyla değişti." },
    });
    expect(req).toMatchObject({ status: "pending", fields: ["lastName"], nickname: "duzeltme_uye" });
    expect((await h.req("POST", "/api/me/corrections", { token: member.token, body: { changes: { lastName: "Başka" }, reason: "İkinci talep denemesi yapıyorum." } })).statusCode).toBe(409);

    // Yetki: üye memur uçlarını kullanamaz; denetçi listeler ama karar veremez
    expect((await h.req("GET", "/api/registrar/corrections", { token: member.token })).statusCode).toBe(403);
    expect((await h.ok<CorrectionRequestView[]>("GET", "/api/registrar/corrections", { token: auditor.token })).map((c) => c.id)).toEqual([req.id]);
    expect((await h.req("POST", `/api/registrar/corrections/${req.id}/decide`, { token: auditor.token, body: { decision: "approve" } })).statusCode).toBe(403);

    // İncelemeden karar → 409 review_required
    const early = await h.req("POST", `/api/registrar/corrections/${req.id}/decide`, { token: registrar.token, body: { decision: "approve" } });
    expect(early.statusCode).toBe(409);
    expect(early.json().error.code).toBe("review_required");

    const review = await h.ok<CorrectionReview>("POST", `/api/registrar/corrections/${req.id}/review`, {
      token: registrar.token,
      body: { purpose: "Üyenin bilgi düzeltme talebi" },
    });
    expect(review.current.lastName).toBe("Eskisoy");
    expect(review.proposed.lastName).toBe("Yenisoy");
    expect(review.reason).toContain("mahkeme");

    const done = await h.ok<CorrectionRequestView>("POST", `/api/registrar/corrections/${req.id}/decide`, {
      token: registrar.token,
      body: { decision: "approve", note: "Mahkeme kararı görüldü" },
    });
    expect(done.status).toBe("approved");
    expect(await h.ok<CorrectionRequestView[]>("GET", "/api/registrar/corrections", { token: registrar.token })).toEqual([]);
    expect((await h.ok<CorrectionRequestView[]>("GET", "/api/registrar/corrections?status=all", { token: registrar.token }))[0].status).toBe("approved");
    expect((await h.req("GET", "/api/registrar/corrections?status=bilinmeyen", { token: registrar.token })).statusCode).toBe(400);

    const pii = await h.ok<PiiRecord>("POST", `/api/registrar/users/${member.user.id}/pii`, { token: registrar.token, body: { purpose: "Düzeltme sonrası kontrol" } });
    expect(pii.lastName).toBe("Yenisoy");
    const mine = await h.ok<CorrectionRequestView[]>("GET", "/api/me/corrections", { token: member.token });
    expect(mine[0]).toMatchObject({ status: "approved", decisionNote: "Mahkeme kararı görüldü", reason: "Soyadım mahkeme kararıyla değişti." });
    const exp = await h.ok<{ personalData: { lastName: string }; piiAccessLog: { purpose: string }[] }>("GET", "/api/me/export", { token: member.token });
    expect(exp.personalData.lastName).toBe("Yenisoy");
    expect(exp.piiAccessLog.map((l) => l.purpose)).toContain("Üyenin bilgi düzeltme talebi");
  });

  it("üye bekleyen talebini geri çeker; başkasının talebi 404", async () => {
    const req = await h.ok<CorrectionRequestView>("POST", "/api/me/corrections", {
      token: member.token,
      body: { changes: { phone: "0533 222 33 44" }, reason: "Telefon numaram değişti." },
    });
    const other = await h.member("duzeltme_diger");
    expect((await h.req("POST", `/api/me/corrections/${req.id}/withdraw`, { token: other.token })).statusCode).toBe(404);
    const w = await h.ok<CorrectionRequestView>("POST", `/api/me/corrections/${req.id}/withdraw`, { token: member.token });
    expect(w.status).toBe("withdrawn");
    expect((await h.req("POST", "/api/me/corrections")).statusCode).toBe(401);
  });
});

describe("hız sınırı ortam değişkenleri (RATE_LIMIT_GLOBAL / RATE_LIMIT_AUTH)", () => {
  const apps: FastifyInstance[] = [];
  afterEach(async () => {
    while (apps.length) await apps.pop()!.close();
  });

  it("varsayılanlar 300 / 20; değerler okunur; ikisi 0 → kapalı; geçersiz değer açık hata", () => {
    expect(rateLimitFromEnv({})).toEqual({ global: DEFAULT_RATE_LIMIT.global, auth: DEFAULT_RATE_LIMIT.auth });
    expect(rateLimitFromEnv({ RATE_LIMIT_GLOBAL: "1000", RATE_LIMIT_AUTH: " 500 " })).toEqual({ global: 1000, auth: 500 });
    expect(rateLimitFromEnv({ RATE_LIMIT_GLOBAL: "0", RATE_LIMIT_AUTH: "0" })).toBe(false);
    expect(rateLimitFromEnv({ RATE_LIMIT_GLOBAL: "", RATE_LIMIT_AUTH: "0" })).toEqual({ global: 300, auth: 0 });
    expect(() => rateLimitFromEnv({ RATE_LIMIT_AUTH: "-1" })).toThrow(/RATE_LIMIT_AUTH/);
    expect(() => rateLimitFromEnv({ RATE_LIMIT_GLOBAL: "çok" })).toThrow(/RATE_LIMIT_GLOBAL/);
    expect(() => rateLimitFromEnv({ RATE_LIMIT_GLOBAL: "2.5" })).toThrow(/tam sayı/);
  });

  it("genel 0: genel sınır yok ama giriş sınırı çalışır; giriş 0: giriş sınırsız, genel sınır çalışır", async () => {
    const s = stubServices({ identity: { login: async () => ({ token: "t", user: meOf(fakeUser("a")) }) } });
    const onlyAuth = await stubServer(s, { rateLimit: { global: 0, auth: 2 } });
    apps.push(onlyAuth);
    for (let i = 0; i < 5; i++) expect((await onlyAuth.inject({ method: "GET", url: "/api/health" })).statusCode).toBe(200);
    const login = () => onlyAuth.inject({ method: "POST", url: "/api/auth/login", payload: { login: "a", password: "b" } });
    expect([(await login()).statusCode, (await login()).statusCode, (await login()).statusCode]).toEqual([200, 200, 429]);

    const onlyGlobal = await stubServer(s, { rateLimit: { global: 4, auth: 0 } });
    apps.push(onlyGlobal);
    // auth/* uçları genel sayaçtan muaftır; giriş sınırı 0 → sınırsız. Diğer uçlar genel sayaçla sınırlanır.
    const logins: number[] = [];
    for (let i = 0; i < 6; i++) logins.push((await onlyGlobal.inject({ method: "POST", url: "/api/auth/login", payload: { login: "a", password: "b" } })).statusCode);
    expect(logins).toEqual([200, 200, 200, 200, 200, 200]);
    const health: number[] = [];
    for (let i = 0; i < 5; i++) health.push((await onlyGlobal.inject({ method: "GET", url: "/api/health" })).statusCode);
    expect(health).toEqual([200, 200, 200, 200, 429]);
  });
});
