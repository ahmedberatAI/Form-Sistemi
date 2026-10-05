// Gerçek bileşim köküyle (createApp) hesap korumaları:
//  - #14/#81/#159/#280 POST /api/me/erase: ön koşullar (şifre, son yönetici) her yan etkiden önce; vekâlet geri alımları ve
//    kripto-imha tek işlemde; bildirimler işlem sonrası.
//  - #226 POST /api/auth/login: hesap (tanımlayıcı) başına kilit → 429 login_locked + Retry-After.
//  - #106 PUT /api/admin/users/:id/roles: doğrulanmamış hesaba personel rolü → 409 not_verified.
import { afterEach, describe, expect, it, vi } from "vitest";
import { boot, PASSWORD, type Harness } from "./harness";

const TIMEOUT = 120_000;

let h: Harness | null = null;
afterEach(async () => {
  vi.restoreAllMocks();
  await h?.close();
  h = null;
});

const revokedNotices = (hh: Harness, userId: string) =>
  hh.services.ctx.db.all("SELECT 1 FROM notifications WHERE user_id = ? AND kind = 'delegation_revoked'", userId).length;

const delegationActions = async (hh: Harness) => {
  await hh.services.ledger.flush();
  return hh.services.ledger.findTxs({ type: "DELEGATION" }).map((t) => t.payload.action);
};

describe("POST /api/me/erase", () => {
  it("son yönetici: 409 last_admin; vekâletlere dokunulmaz, bildirim ve defter iptal kaydı yok", async () => {
    h = await boot();
    const admin = await h.staff("tek_yonetici", ["admin"]);
    const giver = await h.member("vekalet_veren");
    const taker = await h.member("vekalet_alan");
    const { graph } = h.services;
    graph.delegate(giver.user.id, admin.user.id, "*", 1);
    graph.delegate(admin.user.id, taker.user.id, "*", 1);

    const r = await h.req("POST", "/api/me/erase", { token: admin.token, body: { confirm: "SİL", password: PASSWORD } });
    expect(r.statusCode).toBe(409);
    expect(r.json().error.code).toBe("last_admin");

    expect(graph.delegations(admin.user.id)).toHaveLength(1);
    expect(graph.delegations().filter((d) => d.to === admin.user.id)).toHaveLength(1);
    expect(graph.distance(giver.user.id, admin.user.id, ["DELEGATES_TO"], 2)).toBe(1);
    expect(revokedNotices(h, giver.user.id)).toBe(0);
    expect(await delegationActions(h)).not.toContain("revoke");
    expect(h.services.identity.me(admin.user.id).status).toBe("verified");
  }, TIMEOUT);

  it("yanlış şifre: 400 wrong_password; hiçbir yan etki yok", async () => {
    h = await boot();
    const target = await h.member("sifre_yanlis");
    const giver = await h.member("veren_uye");
    h.services.graph.delegate(giver.user.id, target.user.id, "*", 1);
    const r = await h.req("POST", "/api/me/erase", { token: target.token, body: { confirm: "SİL", password: "Baska-Sifre-1" } });
    expect(r.statusCode).toBe(400);
    expect(r.json().error.code).toBe("wrong_password");
    expect(h.services.graph.delegations(giver.user.id)).toHaveLength(1);
    expect(revokedNotices(h, giver.user.id)).toBe(0);
  }, TIMEOUT);

  it("başarılı silme: vekâletler geri alınır, veren üyeye (iki vekâlet olsa da) tek bildirim, hesap imha", async () => {
    h = await boot();
    await h.staff("ilk_yonetici", ["admin"]);
    const admin = await h.staff("ikinci_yonetici", ["admin"]);
    const giver = await h.member("iki_vekalet");
    const taker = await h.member("vekil_uye");
    const { graph } = h.services;
    graph.delegate(giver.user.id, admin.user.id, "*", 1);
    graph.delegate(giver.user.id, admin.user.id, "*", 2);
    graph.delegate(admin.user.id, taker.user.id, "*", 1);

    expect(await h.ok("POST", "/api/me/erase", { token: admin.token, body: { confirm: "SİL", password: PASSWORD } })).toEqual({ ok: true });
    expect(graph.delegations(admin.user.id)).toEqual([]);
    expect(graph.delegations().filter((d) => d.to === admin.user.id)).toEqual([]);
    expect(revokedNotices(h, giver.user.id)).toBe(1);
    expect(revokedNotices(h, taker.user.id)).toBe(0);
    expect((await delegationActions(h)).filter((a) => a === "revoke")).toHaveLength(3);
    expect(h.services.identity.me(admin.user.id).status).toBe("erased");
  }, TIMEOUT);

  it("vekâlet geri alımı işlem içinde başarısız olursa imha ve önceki geri alımlar da geri alınır; deftere 'silindi' yazılmaz", async () => {
    h = await boot();
    const target = await h.member("kaskad_basarisiz");
    const giver = await h.member("bekleyen_veren");
    const taker = await h.member("bekleyen_alan");
    const { graph, identity, ledger } = h.services;
    graph.delegate(target.user.id, taker.user.id, "*", 1);
    graph.delegate(giver.user.id, target.user.id, "*", 1);
    await ledger.flush();
    const erasedBefore = ledger.findTxs({ type: "MEMBER_ERASED" }).length;
    // İlk geri alım (kendi verdiği) gerçekleşir, ikincisi (kendisine verilen) "disk dolu" ile patlar.
    const real = graph.revokeDelegation.bind(graph);
    let calls = 0;
    vi.spyOn(graph, "revokeDelegation").mockImplementation((id, by) => {
      if (++calls === 2) throw new Error("disk dolu");
      real(id, by);
    });
    const r = await h.req("POST", "/api/me/erase", { token: target.token, body: { confirm: "SİL", password: PASSWORD } });
    expect(r.statusCode).toBe(500);
    vi.restoreAllMocks();
    expect(identity.me(target.user.id).status).toBe("verified");
    expect(identity.getPii(h.services.ctx.db.get<{ id: string }>("SELECT id FROM users WHERE nickname = 'kayit_memuru'")!.id, target.user.id, "Geri alma kontrolü").firstName).toBe("Deneme");
    expect(graph.delegations(target.user.id)).toHaveLength(1);
    expect(graph.delegations(giver.user.id)).toHaveLength(1);
    // Bellek içi graf da yeniden kuruldu: geri alınan kenar yeniden görünür.
    expect(graph.distance(target.user.id, taker.user.id, ["DELEGATES_TO"], 2)).toBe(1);
    expect(revokedNotices(h, giver.user.id)).toBe(0);
    await ledger.flush();
    expect(ledger.findTxs({ type: "MEMBER_ERASED" }).length).toBe(erasedBefore);
    // İşlem içinde başarılı olan ilk geri alımın DELEGATION "revoke" kaydı da deftere ulaşmaz (COMMIT'e ertelenmişti; hayalet kayıt yok).
    expect(calls).toBe(2);
    expect(await delegationActions(h)).not.toContain("revoke");
    expect(h.services.ctx.db.get<{ c: number }>("SELECT COUNT(*) AS c FROM ledger_outbox")!.c).toBe(0);
  }, TIMEOUT);
});

describe("POST /api/auth/login: hesap başına kilit", () => {
  it("5 hatalı denemeden sonra doğru şifre de 429 login_locked + Retry-After; var olmayan ad için aynı yanıt", async () => {
    h = await boot();
    await h.member("kilit_deneme");
    const attempt = (login: string, password: string) => h!.req("POST", "/api/auth/login", { body: { login, password } });
    for (let i = 0; i < 5; i++) {
      expect((await attempt("kilit_deneme", "Yanlis-Sifre-1")).statusCode).toBe(401);
      expect((await attempt("hic_olmayan", "Yanlis-Sifre-1")).statusCode).toBe(401);
    }
    const locked = await attempt("Kilit_Deneme", PASSWORD);
    expect(locked.statusCode).toBe(429);
    expect(locked.json().error.code).toBe("login_locked");
    expect(Number(locked.headers["retry-after"])).toBeGreaterThan(800);
    expect(Number(locked.headers["retry-after"])).toBeLessThanOrEqual(900);
    const ghost = await attempt("hic_olmayan", "Yanlis-Sifre-1");
    expect(ghost.statusCode).toBe(429);
    expect(ghost.json().error.message).toBe(locked.json().error.message);
    expect(ghost.headers["retry-after"]).toBeTruthy();
    // Kilit diğer hesapları etkilemez.
    expect((await h.login("kayit_memuru")).user.nickname).toBe("kayit_memuru");
  }, TIMEOUT);
});

describe("PUT /api/admin/users/:id/roles", () => {
  it("doğrulanmamış (bekleyen) hesaba personel rolü → 409 not_verified; onaydan sonra verilebilir", async () => {
    h = await boot();
    const admin = await h.staff("rol_yonetici", ["admin", "registrar"]);
    const pending = await h.register("bekleyen_aday");
    const r = await h.req("PUT", `/api/admin/users/${pending.user.id}/roles`, { token: admin.token, body: { roles: ["auditor"] } });
    expect(r.statusCode).toBe(409);
    expect(r.json().error.code).toBe("not_verified");
    expect(r.json().error.message).toMatch(/Denetçi rolü yalnızca kimliği doğrulanmış/);
    await h.ok("POST", `/api/registrar/users/${pending.user.id}/verify`, { token: admin.token, body: { decision: "approve" } });
    const me = await h.ok<{ roles: string[] }>("PUT", `/api/admin/users/${pending.user.id}/roles`, { token: admin.token, body: { roles: ["auditor"] } });
    expect(me.roles).toEqual(["member", "auditor"]);
  }, TIMEOUT);
});
