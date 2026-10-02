// #207 GET /api/me/export: Content-Disposition yalnız başarılı dökümden sonra eklenir.
// #15/#80/#160/#322 GET /api/admin/users: rota ham SQL çalıştırmaz; CommunityService.adminUsers'a devreder.
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { AdminUserRow, Me } from "@forum/shared";
import { boot, type Harness } from "./harness";

const TIMEOUT = 120_000;

describe("GET /api/me/export", () => {
  let h: Harness;
  let m: { token: string; user: Me };

  beforeAll(async () => {
    h = await boot();
    m = await h.member("disari_aktar");
  }, TIMEOUT);
  afterAll(async () => {
    await h?.close();
  });

  it("başarıda indirme başlığı vardır", async () => {
    const r = await h.req("GET", "/api/me/export", { token: m.token });
    expect(r.statusCode).toBe(200);
    expect(r.headers["content-disposition"]).toBe('attachment; filename="kvkk-verilerim.json"');
  });

  it("döküm hata verirse hata gövdesi dosya olarak inmez (başlık yok)", async () => {
    const spy = vi.spyOn(h.services.identity, "exportOwnData").mockImplementation(() => {
      throw new Error("döküm başarısız");
    });
    try {
      const r = await h.req("GET", "/api/me/export", { token: m.token });
      expect(r.statusCode).toBeGreaterThanOrEqual(500);
      expect(r.headers["content-disposition"]).toBeUndefined();
    } finally {
      spy.mockRestore();
    }
  });
});

describe("GET /api/admin/users", () => {
  let h: Harness;

  beforeAll(async () => {
    h = await boot();
  }, TIMEOUT);
  afterAll(async () => {
    await h?.close();
  });

  it("yalnız yönetici; liste servisten gelir (rol/uzman/arama), kişisel veri yok", async () => {
    const admin = await h.staff("yonetici_x", ["admin"]);
    const plain = await h.member("sade_uye");
    expect((await h.req("GET", "/api/admin/users", { token: plain.token })).statusCode).toBe(403);

    const rows = await h.ok<AdminUserRow[]>("GET", "/api/admin/users", { token: admin.token });
    const adm = rows.find((u) => u.nickname === "yonetici_x");
    expect(adm).toMatchObject({ roles: ["member", "admin"], isExpert: false, expertDomains: [], isAdult: true, status: "verified" });
    expect(Object.keys(adm!).sort()).toEqual(
      ["expertDomains", "id", "isAdult", "isExpert", "joinedAt", "nickname", "politicalConsent", "reputation", "roles", "status", "verifiedAt"].sort(),
    );

    const spy = vi.spyOn(h.services.forum.community, "adminUsers");
    const found = await h.ok<AdminUserRow[]>("GET", "/api/admin/users?q=SADE", { token: admin.token });
    expect(spy).toHaveBeenCalledWith("SADE");
    expect(found.map((u) => u.nickname)).toEqual(["sade_uye"]);
    // LIKE joker karakterleri kaçırılır: "_" tüm kullanıcıları eşlemez
    expect(await h.ok<AdminUserRow[]>("GET", "/api/admin/users?q=%25", { token: admin.token })).toEqual([]);
    spy.mockRestore();
  });
});
