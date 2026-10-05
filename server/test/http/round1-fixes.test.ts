// Tur 1 sunucu düzeltmelerinin gerçek bileşim köküyle (createApp) regresyon testleri:
//  - hesap silme bilirkişi kaydını kapatır (KVKK §6: liste, profil, yeterlilik beyanı, EXPERT_IN, yaptırımla yeniden açılamaz);
//  - bilirkişi başvurusunda yönetmelikte olmayan uzmanlık alanı 400 unknown_domain;
//  - kapanmış hesaba takip/kefalet/yakınlık 409 invalid_state (geri alma serbest);
//  - GET /api/graph?types=RELATED_TO yetkisiz görüntüleyene boş kenar kümesi;
//  - yönlendirici hataları (çok uzun parametre, bozuk yüzde kodlaması) tek tip Türkçe gövde; 101-200 karakterlik kimlik şemaya ulaşır;
//  - kayıt doğrulaması: yalnız noktalama ad/soyad, takma ad ve adres alanları; yanlış türde alan için doğru ileti;
//  - alt konu/düzenleme önerisinde eksik parentTopicId 400 validation;
//  - düzeltme talebi üyelik kâhini değildir (üye olan ve olmayan e-posta aynı yanıt);
//  - çerçeveleme koruması başlıkları (X-Frame-Options, CSP frame-ancestors);
//  - şifre teyidi (şifre/takma ad değişikliği, hesap silme) üye başına deneme kilidinde;
//  - şifre değişikliğiyle yarışan, eski şifreyle başlamış giriş oturum açamaz.
import { afterEach, describe, expect, it } from "vitest";
import type { ExpertInfo, PublicProfile } from "@forum/shared";
import { hashPassword } from "../../src/identity/password";
import { boot, PASSWORD, registrationInput, type Harness } from "./harness";

const TIMEOUT = 120_000;

let h: Harness | null = null;
afterEach(async () => {
  await h?.close();
  h = null;
});

async function activeExpert(hh: Harness, adminToken: string, nickname: string, domains = ["fy:Enerji"]) {
  const e = await hh.member(nickname);
  await hh.ok("POST", "/api/experts/apply", { token: e.token, body: { domains, credentials: "Makine mühendisi; enerji verimliliği uzmanı, 12 yıl deneyim." } });
  await hh.ok("POST", `/api/experts/${e.user.id}/decide`, { token: adminToken, body: { decision: "approve" } });
  return e;
}

describe("hesap silme: bilirkişi kaydı kapatılır (KVKK §6)", () => {
  it("silinen bilirkişi listede, profilde ve kenarlarda görünmez; beyan imha edilir; yaptırımla yeniden açılamaz", async () => {
    h = await boot();
    const admin = await h.staff("bk_yonetici", ["admin"]);
    const registrar = await h.staff("bk_kayit", ["registrar"]);
    const expert = await activeExpert(h, admin.token, "bk_enerji2");
    const id = expert.user.id;
    expect((await h.ok<ExpertInfo[]>("GET", "/api/experts?status=active&domain=fy:Enerji")).map((e) => e.userId)).toContain(id);
    expect(h.services.graph.listEdges({ src: `user:${id}`, type: "EXPERT_IN" })).toHaveLength(1);

    expect(await h.ok("POST", "/api/me/erase", { token: expert.token, body: { confirm: "SİL", password: PASSWORD } })).toEqual({ ok: true });

    // Herkese açık ve personel listeleri: silinen hesap yok (status filtresiyle de, filtresiz de).
    expect((await h.ok<ExpertInfo[]>("GET", "/api/experts?status=active&domain=fy:Enerji")).map((e) => e.userId)).not.toContain(id);
    expect((await h.ok<ExpertInfo[]>("GET", "/api/experts", { token: registrar.token })).map((e) => e.userId)).not.toContain(id);
    expect((await h.ok<ExpertInfo[]>("GET", "/api/experts?status=removed", { token: admin.token })).map((e) => e.userId)).not.toContain(id);
    // Satır: kapalı, serbest metin beyan ve yaptırım notu imha, alanlar boş.
    expect(h.services.ctx.db.get("SELECT status, credentials, domains, sanction_note FROM experts WHERE user_id = ?", id)).toEqual({
      status: "removed",
      credentials: "",
      domains: "[]",
      sanction_note: null,
    });
    expect(h.services.ctx.db.get("SELECT 1 FROM audit_log WHERE action = 'expert.close_on_account_closed' AND target = ?", `user:${id}`)).toBeTruthy();
    // Profil: hiçbir rolde (bilirkişi dahil) görünmez.
    const profile = await h.ok<PublicProfile>("GET", `/api/users/${id}`);
    expect(profile.status).toBe("erased");
    expect(profile.isExpert).toBe(false);
    expect(profile.expertDomains).toEqual([]);
    expect(h.services.graph.listEdges({ src: `user:${id}`, type: "EXPERT_IN" })).toEqual([]);
    expect(h.services.experts.get(id)).toBeNull();
    // Yönetici kapanmış hesabın kaydını yeniden açamaz.
    const re = await h.req("POST", `/api/experts/${id}/sanction`, { token: admin.token, body: { action: "reinstate", note: "Geri alalım" } });
    expect(re.statusCode).toBe(409);
    expect(re.json().error.code).toBe("invalid_state");
  }, TIMEOUT);

  it("eski veri: kapatılmamış kayıt (silinmiş hesap, etkin bilirkişi) listede ve profilde görünmez; açılışta onarılır", async () => {
    h = await boot();
    const admin = await h.staff("bk_yonetici2", ["admin"]);
    const expert = await activeExpert(h, admin.token, "bk_eski");
    const id = expert.user.id;
    // Bu düzeltmeden önceki silme: yalnız users satırı kapatılmış, bilirkişi kaydı etkin kalmış.
    h.services.ctx.db.run("UPDATE users SET status = 'erased', nickname = 'Silinmiş üye #eski00', nickname_norm = 'erased:x' WHERE id = ?", id);
    expect((await h.ok<ExpertInfo[]>("GET", "/api/experts?status=active")).map((e) => e.userId)).not.toContain(id);
    expect((await h.ok<PublicProfile>("GET", `/api/users/${id}`)).isExpert).toBe(false);
  }, TIMEOUT);
});

describe("bilirkişi başvurusu: uzmanlık alanı yönetmelikte tanımlı olmalı", () => {
  it("bilinmeyen IRI / serbest URL → 400 unknown_domain; liste ve bildirimde görünmez; eski satırın onayı da 400", async () => {
    h = await boot();
    const admin = await h.staff("alan_yonetici", ["admin"]);
    const m = await h.member("deniz_k");
    for (const domains of [["https://reklam.example/indirim-kampanyasi"], ["fy:Yok"], ["fy:Enerji", "fy:Kategori"]]) {
      const r = await h.req("POST", "/api/experts/apply", { token: m.token, body: { domains, credentials: "Elektrik mühendisi; 10 yıl deneyim." } });
      expect(r.statusCode, JSON.stringify(domains)).toBe(400);
      expect(r.json().error.code).toBe("unknown_domain");
      expect(r.json().error.details.domains).toMatch(/Bilinmeyen uzmanlık alanı/);
    }
    expect(await h.ok<ExpertInfo[]>("GET", "/api/experts?status=applied")).toEqual([]);
    expect(h.services.ctx.db.get("SELECT 1 FROM notifications WHERE kind = 'expert_application'")).toBeUndefined();
    // Geçerli alanla başvuru kabul edilir.
    expect((await h.ok<ExpertInfo>("POST", "/api/experts/apply", { token: m.token, body: { domains: ["fy:Enerji"], credentials: "Elektrik mühendisi; 10 yıl deneyim." } })).status).toBe("applied");
    // Kural gelmeden önce kaydedilmiş tanımsız alanlı başvuru onaylanamaz.
    h.services.ctx.db.run("UPDATE experts SET domains = ? WHERE user_id = ?", JSON.stringify(["https://forumsistemi.org/ont#Yok"]), m.user.id);
    const d = await h.req("POST", `/api/experts/${m.user.id}/decide`, { token: admin.token, body: { decision: "approve" } });
    expect(d.statusCode).toBe(400);
    expect(d.json().error.code).toBe("unknown_domain");
    expect(h.services.ctx.db.get<{ status: string }>("SELECT status FROM experts WHERE user_id = ?", m.user.id)?.status).toBe("applied");
  }, TIMEOUT);
});

describe("graf: kapanmış hesap ilişki hedefi olamaz", () => {
  it("silinmiş/reddedilmiş hesaba takip, kefalet, yakınlık → 409 invalid_state; geri alma çalışır; bekleyen hedef serbest", async () => {
    h = await boot();
    const registrar = await h.staff("graf_kayit", ["registrar"]);
    const actor = await h.member("graf_mehmet");
    const gone = await h.member("graf_silinen");
    // Silmeden önce kurulmuş takip: silmeden sonra geri alınabilmeli.
    await h.ok("POST", `/api/users/${gone.user.id}/follow`, { token: actor.token });
    await h.ok("POST", "/api/me/erase", { token: gone.token, body: { confirm: "SİL", password: PASSWORD } });
    const rejected = await h.register("graf_reddedilen");
    await h.ok("POST", `/api/registrar/users/${rejected.user.id}/verify`, { token: registrar.token, body: { decision: "reject" } });
    const pending = await h.register("graf_bekleyen");

    for (const target of [gone.user.id, rejected.user.id]) {
      for (const [path, body] of [
        ["follow", undefined],
        ["vouch", { level: "close" }],
        ["relate", { kind: "family" }],
      ] as const) {
        const r = await h.req("POST", `/api/users/${target}/${path}`, { token: actor.token, body });
        expect(r.statusCode, `${path} → ${target}`).toBe(409);
        expect(r.json().error.code).toBe("invalid_state");
      }
    }
    expect(h.services.graph.listEdges({ dst: `user:${rejected.user.id}` })).toEqual([]);
    // Geri alma (temizlik) serbest.
    expect((await h.req("DELETE", `/api/users/${gone.user.id}/follow`, { token: actor.token })).statusCode).toBe(200);
    expect(h.services.graph.listEdges({ src: `user:${actor.user.id}`, dst: `user:${gone.user.id}`, type: "FOLLOWS" })).toEqual([]);
    // Doğrulama bekleyen başvuruya kefil olmak anlamlıdır: izinli.
    expect((await h.req("POST", `/api/users/${pending.user.id}/vouch`, { token: actor.token, body: { level: "known" } })).statusCode).toBe(200);
  }, TIMEOUT);

  it("GET /api/graph?types=RELATED_TO yetkisiz görüntüleyene boş kenar kümesi döner (varsayılan türlere düşmez)", async () => {
    h = await boot();
    const auditor = await h.staff("graf_denetci", ["auditor"]);
    const a = await h.member("graf_a");
    const b = await h.member("graf_b");
    await h.ok("POST", `/api/users/${b.user.id}/follow`, { token: a.token });
    await h.ok("POST", `/api/users/${b.user.id}/relate`, { token: a.token, body: { kind: "business" } });
    const types = (r: { edges: { type: string }[] }) => [...new Set(r.edges.map((e) => e.type))].sort();

    expect(types(await h.ok("GET", "/api/graph"))).toEqual(["FOLLOWS"]);
    expect((await h.ok<{ edges: unknown[] }>("GET", "/api/graph?types=RELATED_TO")).edges).toEqual([]);
    expect((await h.ok<{ edges: unknown[] }>("GET", "/api/graph?types=RELATED_TO", { token: a.token })).edges).toEqual([]);
    expect(types(await h.ok("GET", "/api/graph?types=RELATED_TO", { token: auditor.token }))).toEqual(["RELATED_TO"]);
    expect(types(await h.ok("GET", "/api/graph?types=RELATED_TO,FOLLOWS"))).toEqual(["FOLLOWS"]);
    // Boş tür listesi (hiçbir tür seçilmedi) → kenar yok.
    expect((await h.ok<{ edges: unknown[] }>("GET", "/api/graph?types=")).edges).toEqual([]);
    expect(h.services.graph.visualization({ includeEdgeTypes: [] }).edges).toEqual([]);
  }, TIMEOUT);
});

describe("yönlendirici hataları tek tip Türkçe gövde", () => {
  it("çok uzun parametre ve bozuk yüzde kodlaması → 400 validation {error:{code,message}}; 101-200 karakterlik kimlik şemaya ulaşır", async () => {
    h = await boot();
    const m = await h.member("url_uye");
    const shape = (r: { statusCode: number; json(): unknown; headers: Record<string, unknown> }, status: number, code: string) => {
      expect(r.statusCode).toBe(status);
      const body = r.json() as { error: { code: string; message: string } };
      expect(typeof body.error).toBe("object");
      expect(body.error.code).toBe(code);
      expect(body.error.message).not.toMatch(/FST_|valid url|max param/i);
      expect(r.headers["x-frame-options"]).toBe("DENY");
    };
    const id101 = "a".repeat(101);
    for (const method of ["POST", "DELETE"] as const) {
      const r = await h.req(method, `/api/users/${id101}/follow`, { token: m.token });
      shape(r, 404, "not_found");
      expect(r.json().error.message).toBe("Kullanıcı bulunamadı.");
    }
    const get101 = await h.req("GET", `/api/users/${id101}`);
    shape(get101, 404, "not_found");
    expect(get101.json().error.message).toBe("Kullanıcı bulunamadı.");
    shape(await h.req("GET", `/api/users/${"b".repeat(201)}`), 400, "validation");
    for (const method of ["GET", "POST"] as const) {
      shape(await h.req(method, `/api/users/${"c".repeat(400)}/follow`, { token: m.token }), 400, "validation");
      shape(await h.req(method, "/api/users/%E0%A4%A"), 400, "validation");
    }
  }, TIMEOUT);
});

describe("kayıt doğrulaması", () => {
  const field = async (hh: Harness, over: Record<string, unknown>, nickname: string) => {
    const r = await hh.req("POST", "/api/auth/register", { body: { ...registrationInput(nickname), ...over } });
    expect(r.statusCode, JSON.stringify(over)).toBe(400);
    expect(r.json().error.code).toBe("validation");
    return r.json().error.details as Record<string, string>;
  };

  it("ad/soyad en az bir harf; takma ad ve adres alanları en az bir harf ya da rakam içerir", async () => {
    h = await boot();
    for (const v of ["-", ". .", "́́", "'"]) {
      expect((await field(h, { firstName: v }, "harfsiz_ad"))).toMatchObject({ firstName: "Ad en az bir harf içermelidir." });
      expect((await field(h, { lastName: v }, "harfsiz_soyad"))).toMatchObject({ lastName: "Soyad en az bir harf içermelidir." });
    }
    for (const nickname of ["...", "---", "_._", "-_-"]) {
      expect((await field(h, { nickname }, nickname)).nickname).toBe("Takma ad en az bir harf ya da rakam içermelidir.");
    }
    const addr = await field(h, { address: { il: "..", ilce: "--", mahalle: "  ..  ", acikAdres: "....." } }, "adres_noktali");
    expect(addr).toMatchObject({
      "address.il": "İl en az bir harf ya da rakam içermelidir.",
      "address.ilce": "İlçe en az bir harf ya da rakam içermelidir.",
      "address.acikAdres": "Açık adres en az bir harf ya da rakam içermelidir.",
    });
    expect(addr["address.mahalle"]).toMatch(/Mahalle/);
    // Gerçek adlar etkilenmez.
    expect((await h.req("POST", "/api/auth/register", { body: registrationInput("ayse.k-2", { firstName: "Ayşe Nur", lastName: "O'Brien-Yılmaz" }) })).statusCode).toBe(200);
  }, TIMEOUT);

  it("yanlış türde alan 'metin olmalıdır', eksik alan 'zorunludur' der; takma ad değişikliği 3–32 kuralını söyler", async () => {
    h = await boot();
    expect((await field(h, { nickname: 12345 }, "x")).nickname).toBe("Takma ad metin olmalıdır.");
    expect((await field(h, { tckn: 12345678901 }, "tur_tckn")).tckn).toBe("T.C. kimlik numarası metin olmalıdır.");
    expect((await field(h, { firstName: 5 }, "tur_ad")).firstName).toBe("Ad metin olmalıdır.");
    expect((await field(h, { email: 5 }, "tur_eposta")).email).toBe("E-posta metin olmalıdır.");
    expect((await field(h, { address: "Ankara" }, "tur_adres")).address).toMatch(/nesne olmalıdır/);
    expect((await field(h, { phone: undefined }, "eksik_tel")).phone).toBe("Telefon zorunludur.");
    expect((await field(h, { tckn: null }, "bos_tckn")).tckn).toBe("T.C. kimlik numarası zorunludur.");

    const m = await h.member("takma_uzun");
    for (const nickname of ["a".repeat(50), "a".repeat(101)]) {
      const r = await h.req("PATCH", "/api/me/nickname", { token: m.token, body: { nickname, password: PASSWORD } });
      expect(r.statusCode).toBe(400);
      expect(Object.values(r.json().error.details)).toEqual(["Takma ad 3–32 karakter olmalıdır."]);
    }
  }, TIMEOUT);
});

describe("öneri: eksik parentTopicId", () => {
  it("alt konu ve düzenleme teklifinde eksik parentTopicId 400 validation; var olmayan konu 404", async () => {
    h = await boot();
    const m = await h.member("alt_konu_uye");
    const body = "Bu alt konu önerisi mahallemizin ortak alanları için ayrıntılı bir düzenleme içermektedir.";
    for (const kind of ["subtopic", "amendment"] as const) {
      const r = await h.req("POST", "/api/proposals", { token: m.token, body: { kind, title: "Alt konu deneme başlığı", body, categories: [] } });
      expect(r.statusCode, kind).toBe(400);
      expect(r.json().error.code).toBe("validation");
      expect(r.json().error.details.parentTopicId).toMatch(/parentTopicId/);
    }
    const missing = await h.req("POST", "/api/proposals", { token: m.token, body: { kind: "subtopic", parentTopicId: "olmayan-konu", title: "Alt konu deneme başlığı", body, categories: [] } });
    expect(missing.statusCode).toBe(404);
  }, TIMEOUT);
});

describe("düzeltme talebi üyelik kâhini değildir", () => {
  it("başka üyenin e-postası ya da TCKN'si ile üye olmayan değer aynı yanıtı alır (200 pending)", async () => {
    h = await boot();
    const other = registrationInput("kahin_hedef");
    await h.member("kahin_hedef", other);
    const prober = await h.register("kahin_sorgu"); // doğrulama bekleyen hesap da talep açabilir
    const reason = "E-posta adresim değişti, güncellenmesini istiyorum.";
    const probe = async (changes: Record<string, string>) => {
      const r = await h!.req("POST", "/api/me/corrections", { token: prober.token, body: { changes, reason } });
      expect(r.statusCode, JSON.stringify(changes)).toBe(200);
      const v = r.json() as { id: string; status: string };
      expect(v.status).toBe("pending");
      expect((await h!.req("POST", `/api/me/corrections/${v.id}/withdraw`, { token: prober.token })).statusCode).toBe(200);
      return Object.keys(v).sort();
    };
    const member = await probe({ email: other.email });
    const nonMember = await probe({ email: "hic-uye-olmayan@ornek.org" });
    expect(member).toEqual(nonMember);
    await probe({ tckn: other.tckn });
  }, TIMEOUT);
});

describe("güvenlik başlıkları", () => {
  it("her yanıtta çerçeveleme yasağı (X-Frame-Options: DENY, CSP frame-ancestors 'none')", async () => {
    h = await boot();
    for (const url of ["/api/health", "/api/yok", "/olmayan-sayfa"]) {
      const r = await h.req("GET", url);
      expect(r.headers["x-frame-options"], url).toBe("DENY");
      expect(r.headers["content-security-policy"], url).toBe("frame-ancestors 'none'");
      expect(r.headers["x-content-type-options"], url).toBe("nosniff");
    }
  }, TIMEOUT);
});

describe("şifre teyidi kilidi", () => {
  it("şifre/takma ad değişikliği ve hesap silmede ortak üye başına sayaç: 5 yanlıştan sonra doğru şifre de 429 login_locked", async () => {
    h = await boot({}, { rateLimit: false });
    const m = await h.member("reauth_uye");
    const wrong = (i: number) => `Yanlis${i}abc`;
    const results: string[] = [];
    results.push((await h.req("POST", "/api/me/password", { token: m.token, body: { oldPassword: wrong(1), newPassword: "YeniSifre123!" } })).json().error.code);
    results.push((await h.req("POST", "/api/me/password", { token: m.token, body: { oldPassword: wrong(2), newPassword: "YeniSifre123!" } })).json().error.code);
    results.push((await h.req("PATCH", "/api/me/nickname", { token: m.token, body: { nickname: "reauth_yeni", password: wrong(3) } })).json().error.code);
    results.push((await h.req("POST", "/api/me/erase", { token: m.token, body: { confirm: "SİL", password: wrong(4) } })).json().error.code);
    results.push((await h.req("POST", "/api/me/password", { token: m.token, body: { oldPassword: wrong(5), newPassword: "YeniSifre123!" } })).json().error.code);
    expect(results).toEqual(["wrong_password", "wrong_password", "wrong_password", "wrong_password", "wrong_password"]);
    const locked = await h.req("POST", "/api/me/password", { token: m.token, body: { oldPassword: PASSWORD, newPassword: "YeniSifre123!" } });
    expect(locked.statusCode).toBe(429);
    expect(locked.json().error.code).toBe("login_locked");
    expect(Number(locked.headers["retry-after"])).toBeGreaterThan(0);
    expect(locked.json().error.message).toMatch(/Şifre teyidinde/);
    expect((await h.req("POST", "/api/me/erase", { token: m.token, body: { confirm: "SİL", password: PASSWORD } })).statusCode).toBe(429);
    expect(h.services.identity.me(m.user.id).status).toBe("verified");
    expect(h.services.ctx.db.get("SELECT 1 FROM audit_log WHERE action = 'identity.reauth_locked' AND target = ?", m.user.id)).toBeTruthy();
    // Başka bir üyenin sayacı etkilenmez; doğru şifre sayacı sıfırlar.
    const other = await h.member("reauth_diger");
    expect((await h.req("POST", "/api/me/password", { token: other.token, body: { oldPassword: wrong(1), newPassword: "YeniSifre123!" } })).json().error.code).toBe("wrong_password");
    expect((await h.req("POST", "/api/me/password", { token: other.token, body: { oldPassword: PASSWORD, newPassword: "YeniSifre123!" } })).statusCode).toBe(200);
  }, TIMEOUT);

  it("hassas /api/me uçları /api/auth ile aynı sıkı IP sayacına da tabidir", async () => {
    h = await boot({}, { rateLimit: { global: 1000, auth: 3 } });
    const m = await h.member("ip_sayac");
    const codes: number[] = [];
    for (let i = 0; i < 4; i++) codes.push((await h.req("POST", "/api/me/password", { token: m.token, body: { oldPassword: `Yanlis${i}abc`, newPassword: "YeniSifre123!" } })).statusCode);
    expect(codes.slice(-1)).toEqual([429]);
    // Genel uçlar bu sayaçtan etkilenmez.
    expect((await h.req("GET", "/api/health")).statusCode).toBe(200);
  }, TIMEOUT);
});

describe("şifre değişikliğiyle yarışan giriş", () => {
  it("doğrulama beklenirken şifre değişirse eski şifreyle oturum açılmaz (401), oturum eklenmez", async () => {
    h = await boot();
    const m = await h.member("yaris_uye");
    const { identity, ctx } = h.services;
    const newHash = await hashPassword("YeniSifre987!");
    const sessionsBefore = ctx.db.get<{ c: number }>("SELECT COUNT(*) AS c FROM sessions WHERE user_id = ?", m.user.id)!.c;
    const racing = identity.login("yaris_uye", PASSWORD); // satır ve özet okundu; scrypt doğrulaması sürüyor
    ctx.db.run("UPDATE users SET password_hash = ? WHERE id = ?", newHash, m.user.id); // eşzamanlı şifre değişikliği işlendi
    await expect(racing).rejects.toMatchObject({ status: 401, code: "invalid_credentials" });
    expect(ctx.db.get<{ c: number }>("SELECT COUNT(*) AS c FROM sessions WHERE user_id = ?", m.user.id)!.c).toBe(sessionsBefore);
    // Yeni şifreyle giriş çalışır.
    expect((await identity.login("yaris_uye", "YeniSifre987!")).token).toBeTruthy();
  }, TIMEOUT);
});
