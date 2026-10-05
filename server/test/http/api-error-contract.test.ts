// docs/API.md hata sözleşmesi ↔ gerçek davranış (regresyon): desteklenmeyen yöntem 404 (405 yok), belgede `details` yazılan
// kodların details taşıması, uzunluk sınırlarının servisten önce şemada (400 validation) denetlenmesi.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { TEXT_LIMITS } from "@forum/shared";
import { SERVER_ROOT } from "../../src/core/config";
import { delegateBody, expertApplyBody, expertReportBody } from "../../src/http/schemas";
import { boot, type Harness } from "./harness";

const md = readFileSync(join(SERVER_ROOT, "..", "docs", "API.md"), "utf8");
/** "### Hata kodları" tablosunun satırları: [durum sütunu, kod sütunu]. */
const errorRows = (): [string, string][] => {
  const sec = md.slice(md.indexOf("### Hata kodları"), md.indexOf("### Yeniden gönderim"));
  return sec
    .split(/\r?\n/)
    .map((l) => /^\|\s*([0-9][0-9 /]*)\s*\|\s*([^|]+)\|/.exec(l))
    .filter((m): m is RegExpExecArray => m !== null)
    .map((m) => [m[1].trim(), m[2].trim()]);
};

describe("API.md hata sözleşmesi", () => {
  let h: Harness;
  beforeAll(async () => {
    h = await boot();
  });
  afterAll(async () => {
    await h.app.close();
  });

  it("tabloda 405 / method_not_allowed satırı yok; kayıtlı yola desteklenmeyen yöntem 404 not_found döner", async () => {
    const rows = errorRows();
    expect(rows.length).toBeGreaterThan(20);
    expect(rows.some(([s, c]) => s.includes("405") || c.includes("method_not_allowed"))).toBe(false);
    for (const [method, url] of [["PUT", "/api/health"], ["DELETE", "/api/proposals"], ["PATCH", "/api/health"], ["GET", "/api/auth/login"]] as const) {
      const r = await h.req(method, url);
      expect(r.statusCode, `${method} ${url}`).toBe(404);
      expect(r.json().error).toEqual({ code: "not_found", message: `İstenen uç nokta bulunamadı: ${method} ${url}` });
    }
  });

  it("credentials_length yalnız kırpılınca 3 karakterden kısa metinde; boş ve 5000+ karakter 400 validation (details.credentials)", async () => {
    expect(TEXT_LIMITS.expertCredentials).toEqual({ min: 3, max: 5000 });
    expect(md).toMatch(/`credentials_length` \| [^|]*3 karakterden kısa[^|]*5000 karakteri aşan metin şemada takılır: 400 `validation`, `details.credentials`/);
    const { token } = await h.member("Basvurucu");
    const apply = (credentials: string) => h.req("POST", "/api/experts/apply", { token, body: { domains: ["fy:Saglik"], credentials } });
    for (const c of ["ab", "   ", " a "]) {
      const e = (await apply(c)).json().error;
      expect(e.code, JSON.stringify(c)).toBe("credentials_length");
      expect(e.details.credentials).toBe(e.message);
    }
    for (const c of ["", "x".repeat(5001)]) {
      const r = await apply(c);
      expect(r.statusCode).toBe(400);
      const e = r.json().error;
      expect(e.code, `uzunluk ${c.length}`).toBe("validation");
      expect(typeof e.details.credentials).toBe("string");
    }
  });

  it("invalid_scope (POST /api/me/delegations) details.scope taşır; sıra 1–3 dışı şemada (validation, details.rank)", async () => {
    expect(md).toContain("`POST /api/me/delegations`'ta `invalid_scope` → `details.scope`");
    const a = await h.member("Vekil_Veren");
    const b = await h.member("Vekil_Alan");
    const bad = await h.req("POST", "/api/me/delegations", { token: a.token, body: { to: b.user.id, scope: "https://ornek.org/yok", rank: 1 } });
    expect(bad.statusCode).toBe(400);
    expect(bad.json().error.code).toBe("invalid_scope");
    expect(bad.json().error.details.scope).toBe(bad.json().error.message);
    const rank = await h.req("POST", "/api/me/delegations", { token: a.token, body: { to: b.user.id, scope: "*", rank: 4 } });
    expect(rank.json().error).toMatchObject({ code: "validation", details: { rank: expect.any(String) } });
  });

  it("şema üst sınırı servisinkine eşit: body_too_long / invalid_rank HTTP'ye ulaşamaz (belge bunu söyler)", () => {
    expect(md).toMatch(/servis içindeki eşdeğer kodlar\s+\(`body_too_long`, `invalid_rank`, `invalid_decision`/);
    const report = { assessment: "feasible", confidence: 0.5, risks: [], answers: [], body: "x".repeat(TEXT_LIMITS.expertReportBody.max + 1) };
    const r = expertReportBody.safeParse(report);
    expect(r.success).toBe(false);
    expect(r.error!.issues[0].path).toEqual(["body"]);
    expect(expertReportBody.safeParse({ ...report, body: "x".repeat(TEXT_LIMITS.expertReportBody.max) }).success).toBe(true);
    expect(expertApplyBody.safeParse({ domains: ["fy:Saglik"], credentials: "x".repeat(TEXT_LIMITS.expertCredentials.max + 1) }).success).toBe(false);
    for (const rank of [0, 4, 1.5]) expect(delegateBody.safeParse({ to: "u-1", scope: "*", rank }).success).toBe(false);
  });

  // ───── Test döngüsü tur 1: belgeye eklenen davranışlar ─────

  it("bozuk adresler tek tip gövdeyle 400 validation; 256 karaktere kadar kimlik şemaya ulaşır (API.md 'Bozuk adresler')", async () => {
    expect(md).toContain("Bozuk adresler de aynı gövdeyi alır.");
    const bad = await h.req("GET", "/api/users/%E0%A4%A");
    expect(bad.statusCode).toBe(400);
    expect(bad.json()).toEqual({ error: { code: "validation", message: expect.any(String) } });
    const tooLong = await h.req("POST", `/api/users/${"a".repeat(257)}/follow`);
    expect(tooLong.statusCode).toBe(400);
    expect(tooLong.json()).toEqual({ error: { code: "validation", message: expect.any(String) } });
    // 201–256: şema (kimlik en çok 200) → validation + alan adı
    const overSchema = await h.req("GET", `/api/users/${"a".repeat(201)}`);
    expect(overSchema.statusCode).toBe(400);
    expect(overSchema.json().error).toMatchObject({ code: "validation", details: { id: expect.any(String) } });
    // ≤ 200: olağan yanıt (kullanıcı yok)
    const missing = await h.req("GET", `/api/users/${"a".repeat(150)}`);
    expect(missing.statusCode).toBe(404);
    expect(missing.json().error.code).toBe("not_found");
  });

  it("güvenlik başlıkları her yanıtta: API, hata gövdesi ve yönlendirici hatası (API.md 'Güvenlik başlıkları')", async () => {
    expect(md).toContain("`X-Frame-Options: DENY` ve `Content-Security-Policy: frame-ancestors 'none'`");
    for (const url of ["/api/health", "/api/yok-boyle-bir-uc", "/api/users/%E0%A4%A"]) {
      const r = await h.req("GET", url);
      expect(r.headers["x-frame-options"], url).toBe("DENY");
      expect(r.headers["content-security-policy"], url).toBe("frame-ancestors 'none'");
      expect(r.headers["x-content-type-options"], url).toBe("nosniff");
    }
  });

  it("tablo yeni kodları ve kilitleri anar: unknown_domain, şifre teyidi kilidi, kapanmış hesaba ilişki", () => {
    const rows = errorRows();
    expect(rows.some(([s, c]) => s === "400" && c.includes("`unknown_domain`"))).toBe(true);
    expect(md).toMatch(/\| 429 \| `login_locked` \| [^|]*şifre teyidi kilidi[^|]*`\/api\/me\/password`/);
    expect(md).toMatch(/\| 409 \| `invalid_state` \| [^|]*kapanmış \(silinmiş ya da reddedilmiş\) bir hesaba takip, kefalet ya da yakınlık/);
  });

  it("GET /api/graph?types= (boş liste) hiç kenar vermez; tür verilmezse varsayılan türler (API.md graf satırı)", async () => {
    expect(md).toContain("boş `types=` hiç kenar vermez");
    const a = await h.member("Graf_A");
    const b = await h.member("Graf_B");
    await h.ok("POST", `/api/users/${b.user.id}/follow`, { token: a.token });
    const empty = await h.ok<{ edges: unknown[] }>("GET", "/api/graph?types=");
    expect(empty.edges).toEqual([]);
    const related = await h.ok<{ edges: unknown[] }>("GET", "/api/graph?types=RELATED_TO");
    expect(related.edges).toEqual([]);
    const def = await h.ok<{ edges: { type: string }[] }>("GET", "/api/graph");
    expect(def.edges.some((e) => e.type === "FOLLOWS")).toBe(true);
  });
});
