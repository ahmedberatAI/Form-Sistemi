// HTTP: GET /api/search, Listem (GET/PUT/DELETE /api/me/saved…), /api/proposals?sort=sana-gore ve /api/dashboard (son açılanlar
// YALNIZ X-Forum-Recent başlığıyla; sorgu dizesinde 400) — zod doğrulaması (q uzunluğu, limit ≤ 8, tür beyaz listesi, son açılanlar
// ≤ 20 UUID), CORS izinli başlık, yetki, idempotentlik, Kişisel sıralama tercihi, KVKK dökümü ve silme.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { Dashboard, PersonalizedProposalList, ProposalDetail, ProposalSummary, SavedList, SavedState, SearchResponse } from "@forum/shared";
import { redactUrl } from "../../src/http/server";
import { boot, PASSWORD, type Harness } from "./harness";

const TIMEOUT = 60_000;
const uuid = (i: number) => `00000000-0000-4000-8000-${String(i).padStart(12, "0")}`;
/** Son açılanlar başlığı (istemcinin gönderdiği biçim). */
const recentHeaders = (ids: string) => ({ "X-Forum-Recent": ids });

describe("HTTP: önerili arama, Listem ve kişisel sıra", () => {
  let h: Harness;
  let ayse: { token: string; user: { id: string } };
  let bora: { token: string; user: { id: string } };
  let enerji: ProposalDetail;
  let park: ProposalDetail;
  let taslak: ProposalDetail;

  beforeAll(async () => {
    h = await boot();
    ayse = await h.member("Ayse_Kesif");
    bora = await h.member("Bora_Kesif");
    const create = (token: string, title: string, categories: string[], submit = true) =>
      h.ok<ProposalDetail>("POST", "/api/proposals", {
        token,
        body: { kind: "topic", title, body: "Bu öneri mahallemizin ortak yaşam alanlarını iyileştirmek için hazırlanmıştır.", categories, submit },
      });
    enerji = await create(ayse.token, "Işıklandırma için güneş paneli", ["fy:Enerji"]);
    park = await create(bora.token, "Parka gölgelik ve bank", ["fy:YesilAlan"]);
    taslak = await create(bora.token, "Bora'nın gizli ışık taslağı", ["fy:Enerji"], false);
  }, TIMEOUT);
  afterAll(async () => {
    await h?.close();
  });

  describe("GET /api/search", () => {
    it("herkese açık; Türkçe duyarsız; başkasının taslağı görünmez, yazarınki görünür", async () => {
      const anon = await h.ok<SearchResponse>("GET", `/api/search?q=${encodeURIComponent("IŞIK")}`);
      expect(anon.items.map((i) => i.id)).toEqual([enerji.id]);
      expect(anon.items[0]).toMatchObject({ type: "proposal", match: "prefix", status: "sponsoring", kind: "topic", seq: enerji.seq, open: true });
      const own = await h.ok<SearchResponse>("GET", "/api/search?q=isik", { token: bora.token });
      expect(own.items.map((i) => i.id).sort()).toEqual([enerji.id, taslak.id].sort());
      const other = await h.ok<SearchResponse>("GET", `/api/search?q=%23K${taslak.seq}`, { token: ayse.token });
      expect(other.items).toEqual([]);
      expect((await h.ok<SearchResponse>("GET", `/api/search?q=K-${park.seq}`)).items).toEqual([expect.objectContaining({ id: park.id, match: "ref" })]);
    });

    it("doğrulama: q zorunlu ve en çok 100 karakter; limit 1–8", async () => {
      for (const url of ["/api/search", `/api/search?q=${"a".repeat(101)}`, "/api/search?q=park&limit=9", "/api/search?q=park&limit=0", "/api/search?q=park&limit=x"]) {
        const r = await h.req("GET", url);
        expect(r.statusCode, url).toBe(400);
        expect(r.json().error.code, url).toBe("validation");
      }
      expect((await h.req("GET", "/api/search")).json().error.details).toHaveProperty("q");
      expect((await h.req("GET", "/api/search?q=park&limit=9")).json().error.details).toHaveProperty("limit");
      const one = await h.ok<SearchResponse>("GET", "/api/search?q=a&limit=8");
      expect(one.items).toEqual([]); // tek karakter: boş sonuç (hata değil)
      expect((await h.ok<SearchResponse>("GET", `/api/search?q=${"a".repeat(100)}`)).items).toEqual([]);
    });
  });

  describe("Listem", () => {
    it("oturum zorunlu (401); tür beyaz listesi (400 validation, details.type)", async () => {
      expect((await h.req("GET", "/api/me/saved")).statusCode).toBe(401);
      expect((await h.req("PUT", `/api/me/saved/proposal/${park.id}`)).statusCode).toBe(401);
      expect((await h.req("DELETE", `/api/me/saved/proposal/${park.id}`)).statusCode).toBe(401);
      for (const type of ["user", "message", "PROPOSAL", "proposals"]) {
        const r = await h.req("PUT", `/api/me/saved/${type}/${park.id}`, { token: ayse.token });
        expect(r.statusCode, type).toBe(400);
        expect(r.json().error).toMatchObject({ code: "validation", details: { type: expect.any(String) } });
      }
    });

    it("PUT idempotent (savedAt değişmez); başkasının taslağı 404; liste yalnız sahibine; DELETE idempotent", async () => {
      const first = await h.ok<SavedState>("PUT", `/api/me/saved/proposal/${park.id}`, { token: ayse.token });
      expect(first).toEqual({ type: "proposal", id: park.id, saved: true, savedAt: expect.any(Number) });
      h.clock.advance(5 * 60_000);
      expect(await h.ok<SavedState>("PUT", `/api/me/saved/proposal/${park.id}`, { token: ayse.token })).toEqual(first);
      const hidden = await h.req("PUT", `/api/me/saved/proposal/${taslak.id}`, { token: ayse.token });
      expect(hidden.statusCode).toBe(404);
      expect((await h.req("PUT", "/api/me/saved/topic/olmayan-konu", { token: ayse.token })).statusCode).toBe(404);

      const mine = await h.ok<SavedList>("GET", "/api/me/saved", { token: ayse.token });
      expect(mine.items).toEqual([expect.objectContaining({ type: "proposal", id: park.id, savedAt: first.savedAt, proposal: expect.objectContaining({ id: park.id }) })]);
      expect((await h.ok<SavedList>("GET", "/api/me/saved", { token: bora.token })).items).toEqual([]);

      expect((await h.ok<ProposalDetail>("GET", `/api/proposals/${park.id}`, { token: ayse.token })).saved).toBe(true);
      expect((await h.ok<ProposalDetail>("GET", `/api/proposals/${park.id}`, { token: bora.token })).saved).toBe(false);
      expect("saved" in (await h.ok<ProposalDetail>("GET", `/api/proposals/${park.id}`))).toBe(false);

      const del = await h.ok<SavedState>("DELETE", `/api/me/saved/proposal/${park.id}`, { token: ayse.token });
      expect(del).toEqual({ type: "proposal", id: park.id, saved: false, savedAt: null });
      expect(await h.ok<SavedState>("DELETE", `/api/me/saved/proposal/${park.id}`, { token: ayse.token })).toEqual(del);
      // Başkasının taslağını çıkarma isteği de aynı yanıtı alır (varlık belli edilmez).
      expect((await h.ok<SavedState>("DELETE", `/api/me/saved/proposal/${taslak.id}`, { token: ayse.token })).saved).toBe(false);
      expect((await h.ok<SavedList>("GET", "/api/me/saved", { token: ayse.token })).items).toEqual([]);
    });
  });

  describe("GET /api/proposals?sort=sana-gore", () => {
    it("varsayılan yanıt dizi kalır; sana-gore aynı kümeyi PersonalizedProposalList olarak döner", async () => {
      const plain = await h.ok<ProposalSummary[]>("GET", "/api/proposals?limit=50");
      expect(Array.isArray(plain)).toBe(true);
      const anon = await h.ok<PersonalizedProposalList>("GET", "/api/proposals?sort=sana-gore&limit=50");
      expect(anon.personalized).toBe(false);
      expect(anon.items.map((p) => p.id)).toEqual(plain.map((p) => p.id));
      expect(anon.items.every((p) => p.score === null && p.reason === null)).toBe(true);

      const mineDefault = await h.ok<ProposalSummary[]>("GET", "/api/proposals?limit=50", { token: bora.token });
      const mine = await h.ok<PersonalizedProposalList>("GET", "/api/proposals?sort=sana-gore&limit=50", { token: bora.token });
      expect(mine.personalized).toBe(true);
      expect(mine.items.map((p) => p.id).sort()).toEqual(mineDefault.map((p) => p.id).sort());
      expect(mine.items.map((p) => p.id)).toContain(taslak.id); // yazarın kendi taslağı kümededir
      expect(mine.items.every((p) => p.reason !== null)).toBe(true);
    });

    it("son açılanlar X-Forum-Recent başlığıyla: virgülle en çok 20 UUID; fazlası, UUID olmayan ya da sort'suz kullanım 400 (details.recent)", async () => {
      const okur = await h.member("Okur_Kesif");
      const r = await h.ok<PersonalizedProposalList>("GET", "/api/proposals?sort=sana-gore", { token: okur.token, headers: recentHeaders(park.id) });
      expect(r.personalized).toBe(true);
      expect(r.items[0].id).toBe(park.id);
      const twenty = Array.from({ length: 20 }, (_, i) => uuid(i)).join(",");
      expect((await h.ok<PersonalizedProposalList>("GET", "/api/proposals?sort=sana-gore", { headers: recentHeaders(twenty) })).items.length).toBeGreaterThan(0);
      for (const recent of [Array.from({ length: 21 }, (_, i) => uuid(i)).join(","), "abc", `${park.id},topic-1`, `${park.id};DROP`]) {
        const bad = await h.req("GET", "/api/proposals?sort=sana-gore", { token: okur.token, headers: recentHeaders(recent) });
        expect(bad.statusCode, recent).toBe(400);
        expect(bad.json().error).toMatchObject({ code: "validation", details: { recent: expect.any(String) } });
      }
      const noSort = await h.req("GET", "/api/proposals", { headers: recentHeaders(park.id) });
      expect(noSort.statusCode).toBe(400);
      expect(noSort.json().error.details).toHaveProperty("recent");
      expect((await h.req("GET", "/api/proposals?sort=yeni")).statusCode).toBe(400);
    });

    it("sorgu dizesindeki recent her zaman 400: son açılanlar adres satırında (vekil günlüklerinde) iz bırakmaz", async () => {
      const okur = await h.member("Adres_Kesif");
      for (const url of [`/api/proposals?sort=sana-gore&recent=${park.id}`, `/api/proposals?recent=${park.id}`, `/api/dashboard?recent=${park.id}`]) {
        const r = await h.req("GET", url, { token: okur.token });
        expect(r.statusCode, url).toBe(400);
        expect(r.json().error).toMatchObject({ code: "validation", details: { recent: expect.stringContaining("X-Forum-Recent") } });
      }
    });

    it("CORS ön uçuşu X-Forum-Recent başlığına izin verir", async () => {
      const pre = await h.req("OPTIONS", "/api/dashboard", {
        headers: { origin: "http://localhost:5173", "access-control-request-method": "GET", "access-control-request-headers": "x-forum-recent,authorization" },
      });
      expect(pre.statusCode).toBeLessThan(300);
      expect(String(pre.headers["access-control-allow-headers"] ?? "").toLowerCase()).toContain("x-forum-recent");
    });
  });

  describe("GET /api/dashboard", () => {
    it("son açılanlar başlığı doğrulanır; oturumlu ve profilli görüntüleyende Şu an açık kişisel sırada; tercih kapatılınca varsayılan", async () => {
      expect((await h.req("GET", "/api/dashboard", { headers: recentHeaders("abc") })).statusCode).toBe(400);
      const anon = await h.ok<Dashboard>("GET", "/api/dashboard");
      expect(anon.openPersonalized).toBe(false);
      const pano = await h.member("Pano_Kesif");
      const warm = await h.ok<Dashboard>("GET", "/api/dashboard", { token: pano.token, headers: recentHeaders(park.id) });
      expect(warm.openPersonalized).toBe(true);
      expect(warm.open[0]).toMatchObject({ id: park.id, reason: expect.objectContaining({ kind: "interest" }), score: expect.any(Number) });
      expect(warm.open.map((p) => p.id).sort()).toEqual(anon.open.map((p) => p.id).sort());

      // "Kişisel sıralama" tercihi: PATCH /api/me/consents { personalRanking } → Me.personalRanking; kapalıyken varsayılan sıra
      const me = await h.ok<{ personalRanking: boolean }>("PATCH", "/api/me/consents", { token: pano.token, body: { personalRanking: false } });
      expect(me.personalRanking).toBe(false);
      const off = await h.ok<Dashboard>("GET", "/api/dashboard", { token: pano.token, headers: recentHeaders(park.id) });
      expect(off.openPersonalized).toBe(false);
      expect(off.open.map((p) => p.id)).toEqual(anon.open.map((p) => p.id));
      expect((await h.ok<{ personalRanking: boolean }>("GET", "/api/me", { token: pano.token })).personalRanking).toBe(false);
      const bad = await h.req("PATCH", "/api/me/consents", { token: pano.token, body: { personalRanking: "evet" } });
      expect(bad.statusCode).toBe(400);
      await h.ok("PATCH", "/api/me/consents", { token: pano.token, body: { personalRanking: true } });
      expect((await h.ok<Dashboard>("GET", "/api/dashboard", { token: pano.token, headers: recentHeaders(park.id) })).openPersonalized).toBe(true);
    });
  });

  describe("KVKK", () => {
    it("döküm savedItems içerir; hesap silmede Listem kayıtları silinir", async () => {
      const u = await h.member("Silinen_Kesif");
      await h.ok("PUT", `/api/me/saved/proposal/${enerji.id}`, { token: u.token });
      const exp = await h.ok<{ savedItems: { targetType: string; targetId: string }[] }>("GET", "/api/me/export", { token: u.token });
      expect(exp.savedItems).toEqual([expect.objectContaining({ targetType: "proposal", targetId: enerji.id })]);
      await h.ok("POST", "/api/me/erase", { token: u.token, body: { confirm: "SİL", password: PASSWORD } });
      expect(Number(h.services.ctx.db.get<{ c: number }>("SELECT COUNT(*) AS c FROM saved_items WHERE user_id = ?", u.user.id)!.c)).toBe(0);
    });
  });
});

describe("günlük: son açılanlar gizlenir", () => {
  it.each([
    ["/api/proposals?sort=sana-gore&recent=a,b", "/api/proposals?sort=sana-gore&recent=[gizli]"],
    ["/api/dashboard?recent=x&limit=3", "/api/dashboard?recent=[gizli]&limit=3"],
    ["/api/dashboard?rec%65nt=x", "/api/dashboard?rec%65nt=[gizli]"],
    ["/api/proposals?q=recent&limit=2", "/api/proposals?q=recent&limit=2"],
    ["/api/health", "/api/health"],
  ])("%s", (url, out) => {
    expect(redactUrl(url)).toBe(out);
  });
});
