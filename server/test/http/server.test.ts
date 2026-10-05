// HTTP katmanı birim testleri (sahte servislerle): hata biçimi, yetki matrisi, CORS, SPA geri dönüşü, hız sınırı,
// içerik türleri ve rota başına özel davranışlar.
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { FastifyInstance } from "fastify";
import { fy } from "@forum/shared";
import { HOUR } from "../../src/core/clock";
import { badRequest, unprocessable } from "../../src/core/errors";
import { fakeUser, meOf, stubServer, stubServices, type StubApp } from "./stubs";

const apps: FastifyInstance[] = [];
async function server(s: StubApp, opts?: Parameters<typeof stubServer>[1]) {
  const app = await stubServer(s, opts);
  apps.push(app);
  return app;
}
afterEach(async () => {
  while (apps.length) await apps.pop()!.close();
});

const members = (s: StubApp) => ({
  member: s.addUser(fakeUser("uye")),
  pending: s.addUser(fakeUser("bekleyen", { status: "pending" })),
  minor: s.addUser(fakeUser("genc", { isAdult: false })),
  noConsent: s.addUser(fakeUser("rizasiz", { politicalConsent: false })),
  registrar: s.addUser(fakeUser("memur", { roles: ["member", "registrar"] })),
  auditor: s.addUser(fakeUser("denetci", { roles: ["member", "auditor"] })),
  admin: s.addUser(fakeUser("yonetici", { roles: ["member", "admin"] })),
});

describe("sistem uçları ve hata biçimi", () => {
  it("GET /api/health → {ok:true}, önbelleğe alınmaz", async () => {
    const app = await server(stubServices());
    const r = await app.inject({ method: "GET", url: "/api/health" });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({ ok: true });
    expect(r.headers["cache-control"]).toBe("no-store");
    expect(r.headers["x-content-type-options"]).toBe("nosniff");
  });

  it("GET /api/system → community.systemInfo()", async () => {
    const info = { version: "1.0.0", now: 5, clockOffsetMs: 0, timeScale: 1, aiMode: "offline", aiModel: "x", ledger: { height: 1, validators: 4, healthy: 4 }, bylawVersion: 1, members: { verified: 0, pending: 0 } };
    const app = await server(stubServices({ forum: { community: { systemInfo: () => info as never } } }));
    const r = await app.inject({ method: "GET", url: "/api/system" });
    expect(r.json()).toEqual(info);
  });

  it("bilinmeyen /api yolu → JSON 404 not_found", async () => {
    const app = await server(stubServices());
    const r = await app.inject({ method: "GET", url: "/api/yok" });
    expect(r.statusCode).toBe(404);
    expect(r.headers["content-type"]).toMatch(/application\/json/);
    expect(r.json().error.code).toBe("not_found");
    expect(r.json().error.message).toMatch(/bulunamadı/);
  });

  it("zod doğrulama hatası → 400 validation + alan yolları ve Türkçe ileti", async () => {
    const app = await server(stubServices());
    const r = await app.inject({ method: "POST", url: "/api/auth/login", payload: { login: 5 } });
    expect(r.statusCode).toBe(400);
    const e = r.json().error;
    expect(e.code).toBe("validation");
    expect(e.details.login).toMatch(/metin bekleniyordu/);
    expect(e.details.password).toBe("Bu alan zorunludur.");
    expect(e.message).toBe("İstekte 2 hatalı alan var.");
  });

  it("iç içe alan yolu (öneri yaması) ayrıntıda görünür", async () => {
    const s = stubServices();
    const { member } = members(s);
    const app = await server(s);
    const r = await app.inject({
      method: "POST",
      url: "/api/ontology/validate-patch",
      headers: s.auth(member),
      payload: { patch: { ops: [{ op: "setProtection", article: "fy:M1", protection: "Yok" }], rationale: "" } },
    });
    expect(r.statusCode).toBe(400);
    expect(Object.keys(r.json().error.details)).toEqual(["patch.ops.0.protection"]);
  });

  it("geçersiz JSON → 400 validation; JSON olmayan içerik → 415; 1 MB üstü → 413", async () => {
    const app = await server(stubServices());
    const bad = await app.inject({ method: "POST", url: "/api/auth/login", headers: { "content-type": "application/json" }, payload: "{bozuk" });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error.code).toBe("validation");
    const media = await app.inject({ method: "POST", url: "/api/auth/login", headers: { "content-type": "text/plain" }, payload: "merhaba" });
    expect(media.statusCode).toBe(415);
    expect(media.json().error.code).toBe("unsupported_media_type");
    const big = await app.inject({
      method: "POST",
      url: "/api/auth/login",
      headers: { "content-type": "application/json" },
      payload: JSON.stringify({ login: "x".repeat(1024 * 1024 + 10), password: "y" }),
    });
    expect(big.statusCode).toBe(413);
    expect(big.json().error.code).toBe("payload_too_large");
  });

  it("boş JSON gövdesi kabul edilir (gövdesiz POST)", async () => {
    const s = stubServices({ identity: { logout: vi.fn() } });
    const { member } = members(s);
    const app = await server(s);
    const r = await app.inject({ method: "POST", url: "/api/auth/logout", headers: { ...s.auth(member), "content-type": "application/json" }, payload: "" });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual({ ok: true });
    expect(s.services.identity.logout).toHaveBeenCalledWith(member.token);
  });

  it("beklenmeyen hata → 500 internal; yığın izi sızmaz", async () => {
    const s = stubServices({
      forum: {
        topics: {
          list: () => {
            throw new Error("gizli ayrıntı /home/user/x.ts:42");
          },
        },
      },
    });
    const app = await server(s);
    const r = await app.inject({ method: "GET", url: "/api/topics" });
    expect(r.statusCode).toBe(500);
    expect(r.json()).toEqual({ error: { code: "internal", message: expect.stringMatching(/Beklenmeyen bir hata/) } });
    expect(r.body).not.toMatch(/gizli|\.ts|at /);
  });

  it("AppError → durum kodu + kod + ayrıntı (ör. 422 pii_detected, details.pii)", async () => {
    const pii = [{ kind: "phone", start: 3, end: 16, masked: "05** *** ** 12" }];
    const s = stubServices({
      forum: {
        messages: {
          post: async () => {
            throw unprocessable("pii_detected", "Mesajınızda kişisel veri olabilir.", { pii });
          },
        },
      },
    });
    const { member } = members(s);
    const app = await server(s);
    const r = await app.inject({ method: "POST", url: "/api/threads/topic/t1", headers: s.auth(member), payload: { body: "ara 0555 111 22 12", stance: "pro" } });
    expect(r.statusCode).toBe(422);
    expect(r.json().error).toEqual({ code: "pii_detected", message: "Mesajınızda kişisel veri olabilir.", details: { pii } });
  });

  it("geçersiz başlık türü → 400", async () => {
    const app = await server(stubServices());
    const r = await app.inject({ method: "GET", url: "/api/threads/kanal/1" });
    expect(r.statusCode).toBe(400);
    expect(r.json().error.details.type).toBeDefined();
  });

  it("GET /api/clusters/latest anlık görüntü yoksa null döner", async () => {
    const app = await server(stubServices({ forum: { clusters: { latest: () => null } } }));
    const r = await app.inject({ method: "GET", url: "/api/clusters/latest" });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toBeNull();
  });
});

describe("yetki matrisi", () => {
  it("oturumsuz → 401 (Türkçe)", async () => {
    const app = await server(stubServices());
    for (const [method, url] of [
      ["GET", "/api/me"],
      ["POST", "/api/proposals"],
      ["GET", "/api/admin/users"],
      ["POST", "/api/experts/lint"],
    ] as const) {
      const r = await app.inject({ method, url, payload: method === "POST" ? {} : undefined });
      expect(r.statusCode, `${method} ${url}`).toBe(401);
      expect(r.json().error).toMatchObject({ code: "unauthorized", message: "Oturum açmanız gerekiyor." });
    }
  });

  it("geçersiz belirteç oturumsuz sayılır", async () => {
    const app = await server(stubServices());
    const r = await app.inject({ method: "GET", url: "/api/me", headers: { authorization: "Bearer sahte" } });
    expect(r.statusCode).toBe(401);
  });

  it("üye yönetici ucuna erişemez → 403", async () => {
    const s = stubServices();
    const { member } = members(s);
    const app = await server(s);
    const r = await app.inject({ method: "GET", url: "/api/admin/users", headers: s.auth(member) });
    expect(r.statusCode).toBe(403);
    expect(r.json().error.code).toBe("forbidden");
    expect(r.json().error.message).toMatch(/Yönetici/);
  });

  it("doğrulanmamış üye öneri oluşturamaz → 403 not_verified", async () => {
    const s = stubServices();
    const { pending } = members(s);
    const app = await server(s);
    const r = await app.inject({ method: "POST", url: "/api/proposals", headers: s.auth(pending), payload: { kind: "topic", title: "x", body: "y", categories: [] } });
    expect(r.statusCode).toBe(403);
    expect(r.json().error.details.reason).toBe("not_verified");
  });

  it("oy: reşit olmayan ve rıza vermeyen → 403; uygun üye servise ulaşır", async () => {
    const receipt = { proposalId: "p1", round: 1, ballotId: "b", choice: "yes", salt: "s", commitment: "c", txHash: null, castAt: 1 };
    const vote = vi.fn(async () => receipt as never);
    const s = stubServices({ forum: { proposals: { vote } } });
    const { minor, noConsent, member } = members(s);
    const app = await server(s);
    const a = await app.inject({ method: "POST", url: "/api/proposals/p1/vote", headers: s.auth(minor), payload: { choice: "yes" } });
    expect(a.statusCode).toBe(403);
    expect(a.json().error.details.reason).toBe("not_adult");
    const b = await app.inject({ method: "POST", url: "/api/proposals/p1/vote", headers: s.auth(noConsent), payload: { choice: "yes" } });
    expect(b.json().error.details.reason).toBe("political_consent_required");
    const c = await app.inject({ method: "POST", url: "/api/proposals/p1/vote", headers: s.auth(member), payload: { choice: "yes" } });
    expect(c.statusCode).toBe(200);
    expect(c.json()).toEqual(receipt);
    expect(vote).toHaveBeenCalledWith(expect.objectContaining({ id: member.id }), "p1", "yes");
  });

  it("denetçi kayıt memurunun okuma uçlarını kullanır ama doğrulama yapamaz; yönetici her ikisini de yapar", async () => {
    const verify = vi.fn(async (_a: string, id: string) => meOf(fakeUser(id)));
    const s = stubServices({ identity: { listPending: () => [{ id: "u1", nickname: "yeni", createdAt: 3 }], verify } });
    const { auditor, admin, registrar, member } = members(s);
    const app = await server(s);
    expect((await app.inject({ method: "GET", url: "/api/registrar/pending", headers: s.auth(auditor) })).json()).toEqual([{ id: "u1", nickname: "yeni", createdAt: 3 }]);
    expect((await app.inject({ method: "GET", url: "/api/registrar/pending", headers: s.auth(member) })).statusCode).toBe(403);
    const payload = { decision: "approve" };
    expect((await app.inject({ method: "POST", url: "/api/registrar/users/u1/verify", headers: s.auth(auditor), payload })).statusCode).toBe(403);
    expect((await app.inject({ method: "POST", url: "/api/registrar/users/u1/verify", headers: s.auth(registrar), payload })).statusCode).toBe(200);
    expect((await app.inject({ method: "POST", url: "/api/registrar/users/u1/verify", headers: s.auth(admin), payload })).statusCode).toBe(200);
    expect(verify).toHaveBeenCalledWith(registrar.id, "u1", "approve", undefined);
  });

  it("gizli mesaj yalnız denetçi (ve yönetici)", async () => {
    const readHidden = vi.fn(() => ({ messageId: "m1", body: "x", versions: [], accessLogged: true as const }));
    const s = stubServices({ forum: { messages: { readHidden } } });
    const { member, auditor } = members(s);
    const app = await server(s);
    expect((await app.inject({ method: "GET", url: "/api/messages/m1/hidden", headers: s.auth(member) })).statusCode).toBe(403);
    expect((await app.inject({ method: "GET", url: "/api/messages/m1/hidden", headers: s.auth(auditor) })).statusCode).toBe(200);
  });

  it("bilirkişi uçları etkin bilirkişi ister", async () => {
    const s = stubServices({
      experts: {
        get: (id) => (id === "u-bilirkisi" ? ({ status: "active" } as never) : null),
        assignmentsFor: () => [{ assignmentId: "a1", proposalId: "p1", status: "invited", dueAt: 9 }],
        panel: () => ({ questions: [{ id: "q1", body: "Soru?", minorityGuaranteed: true, proposalId: "p1", authorId: "x", authorNickname: "x", createdAt: 1 }] }) as never,
      },
      forum: { proposals: { get: () => ({ title: "Bisiklet yolu", seq: 7 }) as never } },
    });
    const { member } = members(s);
    const expert = s.addUser(fakeUser("bilirkisi"));
    const app = await server(s);
    expect((await app.inject({ method: "GET", url: "/api/me/assignments", headers: s.auth(member) })).statusCode).toBe(403);
    const r = await app.inject({ method: "GET", url: "/api/me/assignments", headers: s.auth(expert) });
    expect(r.json()).toEqual([
      { assignmentId: "a1", proposalId: "p1", proposalTitle: "Bisiklet yolu", proposalSeq: 7, status: "invited", dueAt: 9, questions: [{ id: "q1", body: "Soru?", minorityGuaranteed: true }] },
    ]);
  });
});

describe("hesap uçları", () => {
  it('POST /api/me/erase: "SİL" yoksa 400; yanlış şifre 400; doğruysa vekâletler geri alınır ve kripto-imha', async () => {
    const revoke = vi.fn();
    const eraseSelf = vi.fn(async () => undefined);
    const closeExpert = vi.fn(() => 0);
    const s = stubServices({
      identity: { verifyPassword: async (_u, pw) => pw === "doğru-şifre", eraseSelf },
      experts: { closeForClosedAccount: closeExpert },
      graph: {
        delegations: (userId?: string) =>
          [
            { id: "d1", from: "u-uye", to: "u-x", scope: "*", rank: 1, createdAt: 1 },
            { id: "d2", from: "u-y", to: "u-uye", scope: "*", rank: 1, createdAt: 1 },
          ].filter((d) => !userId || d.from === userId),
        revokeDelegation: revoke,
      },
    });
    const { member } = members(s);
    const app = await server(s);
    const no = await app.inject({ method: "POST", url: "/api/me/erase", headers: s.auth(member), payload: { confirm: "sil", password: "doğru-şifre" } });
    expect(no.statusCode).toBe(400);
    expect(no.json().error.details.confirm).toMatch(/SİL/);
    const wrong = await app.inject({ method: "POST", url: "/api/me/erase", headers: s.auth(member), payload: { confirm: "SİL", password: "yanlış" } });
    expect(wrong.statusCode).toBe(400);
    expect(wrong.json().error.code).toBe("wrong_password");
    expect(eraseSelf).not.toHaveBeenCalled();
    expect(closeExpert).not.toHaveBeenCalled();
    // Ayrışık (NFD) yazılmış "SİL" de NFC'de eşleşir.
    const ok = await app.inject({ method: "POST", url: "/api/me/erase", headers: s.auth(member), payload: { confirm: "SİL", password: "doğru-şifre" } });
    expect(ok.statusCode).toBe(200);
    // Bilirkişi kaydı aynı işlemde kapatılır (KVKK §6).
    expect(closeExpert.mock.calls).toEqual([["u-uye"]]);
    expect(revoke.mock.calls).toEqual([
      ["d1", "u-uye"],
      ["d2", "u-y"],
    ]);
    expect(s.notifier.sent.map((n) => n.userId)).toEqual(["u-y"]);
    expect(eraseSelf).toHaveBeenCalledWith("u-uye");
  });

  it("POST /api/me/delegations: kapsam ontolojide yoksa 400, varsa graph.delegate (kısa IRI genişletilir)", async () => {
    const delegate = vi.fn((from: string, to: string, scope: string, rank: number) => ({ id: "d", from, to, toNickname: "x", scope, rank, createdAt: 1 }));
    const s = stubServices({
      ontology: { categories: () => [{ iri: fy("Ulasim"), label: "Ulaşım", parent: null, requiresExpert: false, keywords: [], children: [{ iri: fy("TopluTasima"), label: "Toplu taşıma", parent: fy("Ulasim"), requiresExpert: false, keywords: [], children: [] }] }] },
      graph: { delegate },
    });
    const { member, pending } = members(s);
    const app = await server(s);
    expect((await app.inject({ method: "POST", url: "/api/me/delegations", headers: s.auth(pending), payload: { to: "u-x", scope: "*", rank: 1 } })).statusCode).toBe(403);
    const bad = await app.inject({ method: "POST", url: "/api/me/delegations", headers: s.auth(member), payload: { to: "u-x", scope: "fy:Yok", rank: 1 } });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error.code).toBe("invalid_scope");
    const ok = await app.inject({ method: "POST", url: "/api/me/delegations", headers: s.auth(member), payload: { to: "u-x", scope: "fy:TopluTasima", rank: 2 } });
    expect(ok.statusCode).toBe(200);
    expect(delegate).toHaveBeenCalledWith(member.id, "u-x", fy("TopluTasima"), 2);
    const star = await app.inject({ method: "POST", url: "/api/me/delegations", headers: s.auth(member), payload: { to: "u-x", scope: "*", rank: 1 } });
    expect(star.statusCode).toBe(200);
  });

  it("POST /api/me/password mevcut belirteci korur", async () => {
    const changePassword = vi.fn(async () => undefined);
    const s = stubServices({ identity: { changePassword } });
    const { member } = members(s);
    const app = await server(s);
    const r = await app.inject({ method: "POST", url: "/api/me/password", headers: s.auth(member), payload: { oldPassword: "a", newPassword: "b" } });
    expect(r.statusCode).toBe(200);
    expect(changePassword).toHaveBeenCalledWith(member.id, "a", "b", member.token);
  });

  it("POST /api/auth/register: kayıt + giriş → AuthResponse; kimlik modülünün doğrulama hatası aynen döner", async () => {
    const register = vi.fn(async (input: { nickname: string }) => {
      if (!input.nickname) throw badRequest("validation", "Takma ad zorunludur.", { nickname: "Takma ad zorunludur." });
      return { user: meOf(fakeUser(input.nickname, { status: "pending" })) };
    });
    const login = vi.fn(async (n: string) => ({ token: "t", user: meOf(fakeUser(n, { status: "pending" })) }));
    const s = stubServices({ identity: { register: register as never, login } });
    const app = await server(s);
    const bad = await app.inject({ method: "POST", url: "/api/auth/register", payload: { nickname: "" } });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error.details).toEqual({ nickname: "Takma ad zorunludur." });
    const ok = await app.inject({ method: "POST", url: "/api/auth/register", payload: { nickname: "ayse", password: "Gizli-Sifre-123" } });
    expect(ok.statusCode).toBe(200);
    expect(ok.json()).toMatchObject({ token: "t", user: { nickname: "ayse", status: "pending" } });
    expect(login).toHaveBeenCalledWith("ayse", "Gizli-Sifre-123");
  });
});

describe("yönetim uçları", () => {
  it("saat ileri alma: ManualClock ilerler, tick geçiş kalmayana kadar (en çok 5) çalışır, denetim günlüğüne yazılır", async () => {
    const batches = [[{ proposalId: "p1", seq: 1, from: "deliberation", to: "voting", reason: "süre doldu" }], [{ proposalId: "p2", seq: 2, from: "voting", to: "enacted", reason: "kabul" }], []];
    const tick = vi.fn(async () => (batches.shift() ?? []) as never);
    const s = stubServices({ forum: { lifecycle: { tick } } });
    const { admin, member } = members(s);
    const app = await server(s);
    const t0 = s.ctx.clock.now();
    expect((await app.inject({ method: "POST", url: "/api/admin/clock/advance", headers: s.auth(member), payload: { hours: 2 } })).statusCode).toBe(403);
    expect((await app.inject({ method: "POST", url: "/api/admin/clock/advance", headers: s.auth(admin), payload: { hours: 0.5 } })).statusCode).toBe(400);
    expect((await app.inject({ method: "POST", url: "/api/admin/clock/advance", headers: s.auth(admin), payload: { hours: 721 } })).statusCode).toBe(400);
    const r = await app.inject({ method: "POST", url: "/api/admin/clock/advance", headers: s.auth(admin), payload: { hours: 72 } });
    expect(r.statusCode).toBe(200);
    expect(s.ctx.clock.now()).toBe(t0 + 72 * HOUR);
    expect(r.json()).toEqual({
      transitions: [
        { proposalId: "p1", seq: 1, from: "deliberation", to: "voting", reason: "süre doldu" },
        { proposalId: "p2", seq: 2, from: "voting", to: "enacted", reason: "kabul" },
      ],
      now: t0 + 72 * HOUR,
    });
    expect(tick).toHaveBeenCalledTimes(3);
    const log = s.ctx.db.get<{ action: string; actor_id: string }>("SELECT action, actor_id FROM audit_log WHERE action = 'admin.clock_advance'");
    expect(log).toEqual({ action: "admin.clock_advance", actor_id: admin.id });
  });

  it("tick en çok 5 tur döner", async () => {
    const tick = vi.fn(async () => [{ proposalId: "p", seq: 1, from: "voting", to: "voting", reason: "x" }] as never);
    const s = stubServices({ forum: { lifecycle: { tick } } });
    const { admin } = members(s);
    const app = await server(s);
    const r = await app.inject({ method: "POST", url: "/api/admin/tick", headers: s.auth(admin) });
    expect(r.json().transitions).toHaveLength(5);
    expect(tick).toHaveBeenCalledTimes(5);
  });

  it("GET /api/admin/users: yalnız yönetici; arama sorgusunu CommunityService.adminUsers'a devreder (rota SQL çalıştırmaz)", async () => {
    const rows = [{ id: "u1", nickname: "Çiğdem" }];
    const adminUsers = vi.fn(() => rows as never);
    const s = stubServices({ forum: { community: { adminUsers } } });
    const { admin, member } = members(s);
    const app = await server(s);
    expect((await app.inject({ method: "GET", url: "/api/admin/users", headers: s.auth(member) })).statusCode).toBe(403);
    expect(adminUsers).not.toHaveBeenCalled();
    const r = await app.inject({ method: "GET", url: `/api/admin/users?q=${encodeURIComponent("çiğ")}`, headers: s.auth(admin) });
    expect(r.statusCode).toBe(200);
    expect(r.json()).toEqual(rows);
    expect(adminUsers).toHaveBeenCalledWith("çiğ");
  });
});

describe("içerik türleri ve özel uçlar", () => {
  it("GET /api/ontology/turtle → text/turtle; charset=utf-8", async () => {
    const exportTurtle = vi.fn((v?: number) => `@prefix fy: <https://forumsistemi.org/ont#> . # sürüm ${v ?? "güncel"}\n`);
    const app = await server(stubServices({ ontology: { exportTurtle } }));
    const r = await app.inject({ method: "GET", url: "/api/ontology/turtle?version=2" });
    expect(r.statusCode).toBe(200);
    expect(r.headers["content-type"]).toBe("text/turtle; charset=utf-8");
    expect(r.body).toContain("sürüm 2");
    expect(exportTurtle).toHaveBeenCalledWith(2);
  });

  it("GET /api/graph: RELATED_TO yalnız denetçi/yöneticiye", async () => {
    const visualization = vi.fn((opts: { includeEdgeTypes?: string[] }) => ({
      nodes: [],
      edges: [
        { source: "a", target: "b", type: "FOLLOWS" as const, weight: 1 },
        { source: "a", target: "b", type: "RELATED_TO" as const, weight: 1 },
      ],
      opts,
    }));
    const s = stubServices({ graph: { visualization } });
    const { auditor } = members(s);
    const app = await server(s);
    const anon = await app.inject({ method: "GET", url: "/api/graph?types=FOLLOWS,RELATED_TO&limit=50" });
    expect(anon.statusCode).toBe(200);
    expect(visualization).toHaveBeenLastCalledWith({ includeEdgeTypes: ["FOLLOWS"], limit: 50, includePrivate: false, viewerId: null });
    expect(anon.json().edges.map((e: { type: string }) => e.type)).toEqual(["FOLLOWS"]);
    expect(anon.json()).not.toHaveProperty("opts");
    const aud = await app.inject({ method: "GET", url: "/api/graph?types=FOLLOWS,RELATED_TO", headers: s.auth(auditor) });
    expect(visualization).toHaveBeenLastCalledWith({ includeEdgeTypes: ["FOLLOWS", "RELATED_TO"], limit: undefined, includePrivate: true, viewerId: auditor.id });
    expect(aud.json().edges).toHaveLength(2);
    const bad = await app.inject({ method: "GET", url: "/api/graph?types=FOLLOWS,YOK" });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error.details.types).toMatch(/YOK/);
  });

  it("POST /api/experts/lint: YZ rızası yoksa çevrimdışı zorlanır ve etiket eklenir", async () => {
    const lintExpertReport = vi.fn(async () => ({ issues: [{ quote: "suçtur", kind: "legal_qualification", message: "Hukuki nitelendirme" }], offline: true, model: "offline-heuristic" }));
    const s = stubServices({ ai: { lintExpertReport } });
    const { member } = members(s);
    const app = await server(s);
    const r = await app.inject({ method: "POST", url: "/api/experts/lint", headers: s.auth(member), payload: { text: "Bu eylem suçtur." } });
    expect(r.statusCode).toBe(200);
    expect(lintExpertReport).toHaveBeenCalledWith("Bu eylem suçtur.", { forceOffline: true });
    expect(r.json().aiLabel).toMatch(/^Yapay zekâ ile üretildi · çevrimdışı sezgisel mod · /);
  });

  it("defter: blok listesi gövdesiz başlık + txTypes; bilinmeyen düğüm 404; doğrulayıcı anahtarları", async () => {
    const block = { height: 2, round: 0, hash: "h", prevHash: "p", time: 1, proposer: "v1", txRoot: "r", txCount: 1, commitSigs: [], txs: [{ type: "TALLY" }] };
    const s = stubServices({
      ledger: {
        listBlocks: vi.fn(() => [block] as never),
        latestBlock: () => ({ height: 2, hash: "h", time: 1 }),
        status: () => ({ validators: [{ id: "v1", publicKey: "pk1" }] }) as never,
      },
    });
    const app = await server(s);
    const r = await app.inject({ method: "GET", url: "/api/ledger/blocks?limit=5" });
    expect(r.json()).toEqual({ blocks: [{ height: 2, round: 0, hash: "h", prevHash: "p", time: 1, proposer: "v1", txRoot: "r", txCount: 1, commitSigs: [], txTypes: ["TALLY"] }], height: 2 });
    expect(s.services.ledger.listBlocks).toHaveBeenCalledWith({ from: undefined, limit: 5 });
    expect((await app.inject({ method: "GET", url: "/api/ledger/blocks/2?node=v9" })).statusCode).toBe(404);
    expect((await app.inject({ method: "GET", url: "/api/ledger/validators" })).json()).toEqual({ chainId: "forum-sistemi-1", validators: [{ id: "v1", publicKey: "pk1" }] });
    expect((await app.inject({ method: "GET", url: "/api/ledger/txs/xyz" })).statusCode).toBe(400);
  });
});

describe("CORS", () => {
  const origins = ["http://localhost", "http://localhost:5173", "capacitor://localhost", "https://localhost"];

  it("izinli kökenler yansıtılır; diğerleri yansıtılmaz", async () => {
    const app = await server(stubServices({}, { corsOrigins: origins }));
    for (const origin of ["http://localhost", "capacitor://localhost", "http://localhost:5173"]) {
      const r = await app.inject({ method: "GET", url: "/api/health", headers: { origin } });
      expect(r.headers["access-control-allow-origin"], origin).toBe(origin);
    }
    const evil = await app.inject({ method: "GET", url: "/api/health", headers: { origin: "https://kotu.example" } });
    expect(evil.headers["access-control-allow-origin"]).toBeUndefined();
  });

  it("ön uçuş (OPTIONS) Authorization başlığına ve PATCH/DELETE yöntemlerine izin verir", async () => {
    const app = await server(stubServices({}, { corsOrigins: origins }));
    const r = await app.inject({
      method: "OPTIONS",
      url: "/api/me/consents",
      headers: { origin: "capacitor://localhost", "access-control-request-method": "PATCH", "access-control-request-headers": "authorization,content-type" },
    });
    expect(r.statusCode).toBe(204);
    expect(r.headers["access-control-allow-origin"]).toBe("capacitor://localhost");
    expect(String(r.headers["access-control-allow-methods"])).toMatch(/PATCH/);
    expect(String(r.headers["access-control-allow-methods"])).toMatch(/DELETE/);
    expect(String(r.headers["access-control-allow-headers"]).toLowerCase()).toMatch(/authorization/);
  });

  it('"*" yapılandırmasında her köken kabul edilir; hata yanıtlarında da CORS başlığı bulunur', async () => {
    const app = await server(stubServices({}, { corsOrigins: ["*"] }));
    const r = await app.inject({ method: "GET", url: "/api/me", headers: { origin: "http://192.168.1.5:8080" } });
    expect(r.statusCode).toBe(401);
    expect(r.headers["access-control-allow-origin"]).toBe("http://192.168.1.5:8080");
  });
});

describe("SPA geri dönüşü (webDist)", () => {
  let dir = "";
  afterEach(() => {
    if (dir) rmSync(dir, { recursive: true, force: true });
    dir = "";
  });

  it("/api dışı GET → index.html; var olan dosya → kendisi; /api/yok ve eksik dosya → JSON 404", async () => {
    dir = mkdtempSync(join(tmpdir(), "forum-web-"));
    writeFileSync(join(dir, "index.html"), "<!doctype html><title>Forum</title><div id=root></div>");
    mkdirSync(join(dir, "assets"));
    writeFileSync(join(dir, "assets", "app.js"), "console.log(1)");
    const app = await server(stubServices({}, { webDist: dir }));

    const spa = await app.inject({ method: "GET", url: "/oneriler/123" });
    expect(spa.statusCode).toBe(200);
    expect(spa.headers["content-type"]).toMatch(/text\/html/);
    expect(spa.body).toContain("<title>Forum</title>");

    const root = await app.inject({ method: "GET", url: "/" });
    expect(root.statusCode).toBe(200);
    expect(root.body).toContain("<title>Forum</title>");

    const js = await app.inject({ method: "GET", url: "/assets/app.js" });
    expect(js.statusCode).toBe(200);
    expect(js.body).toBe("console.log(1)");

    const api = await app.inject({ method: "GET", url: "/api/yok" });
    expect(api.statusCode).toBe(404);
    expect(api.json().error.code).toBe("not_found");

    const missing = await app.inject({ method: "GET", url: "/assets/yok.js" });
    expect(missing.statusCode).toBe(404);
    expect(missing.json().error.code).toBe("not_found");

    const post = await app.inject({ method: "POST", url: "/oneriler/123", payload: {} });
    expect(post.statusCode).toBe(404);

    expect((await app.inject({ method: "GET", url: "/api/health" })).json()).toEqual({ ok: true });
  });

  it("webDist yoksa /api dışı yollar da JSON 404", async () => {
    const app = await server(stubServices({}, { webDist: join(tmpdir(), "olmayan-klasor-xyz") }));
    const r = await app.inject({ method: "GET", url: "/oneriler/123" });
    expect(r.statusCode).toBe(404);
    expect(r.json().error.code).toBe("not_found");
  });
});

describe("hız sınırı", () => {
  it("/api/auth/* ortak sayaçla sınırlanır → 429 rate_limited (Türkçe, Retry-After)", async () => {
    const s = stubServices({ identity: { login: async () => ({ token: "t", user: meOf(fakeUser("a")) }) } });
    const app = await server(s, { rateLimit: { global: 300, auth: 3 } });
    const login = () => app.inject({ method: "POST", url: "/api/auth/login", payload: { login: "a", password: "b" } });
    expect((await login()).statusCode).toBe(200);
    expect((await login()).statusCode).toBe(200);
    // Kayıt ucu aynı sayacı paylaşır (3. istek: sınır içinde; sahte kimlik servisinde register olmadığından 500).
    expect((await app.inject({ method: "POST", url: "/api/auth/register", payload: {} })).statusCode).not.toBe(429);
    const r = await login();
    expect(r.statusCode).toBe(429);
    expect(r.json().error.code).toBe("rate_limited");
    expect(r.json().error.message).toMatch(/Çok fazla istek gönderdiniz/);
    expect(Number(r.headers["retry-after"])).toBeGreaterThan(0);
    // Genel sayaç ayrıdır: diğer uçlar çalışmaya devam eder.
    expect((await app.inject({ method: "GET", url: "/api/health" })).statusCode).toBe(200);
  });

  it("genel sınır aşılınca 429", async () => {
    const app = await server(stubServices(), { rateLimit: { global: 3, auth: 20 } });
    const codes: number[] = [];
    for (let i = 0; i < 4; i++) codes.push((await app.inject({ method: "GET", url: "/api/health" })).statusCode);
    expect(codes).toEqual([200, 200, 200, 429]);
  });
});
