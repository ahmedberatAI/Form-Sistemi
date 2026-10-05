// Idempotency-Key (bulgu #275): yanıtı belirsiz kalan gönderim (zaman aşımı, bağlantı kopması, vekil 502/503/504) aynı içerikle
// yeniden gönderilince AYNI anahtar kullanılır; sunucu işlemi tekrarlamaz. Kesin yanıt gelince anahtar unutulur.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError, IDEMPOTENCY_HEADER, newIdempotencyKey, request, setAuthToken } from "./client";
import { delegate, followUser, login, postMessage, relateUser, revokeDelegation, unfollowUser, unrelateUser, updateProposal, vote } from "./endpoints";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

/** Her çağrının Idempotency-Key başlığını kaydeden sahte fetch; yanıtlar sırayla verilir (Error → ağ hatası). */
function fakeFetch(...outcomes: (Response | Error)[]) {
  const keys: (string | null)[] = [];
  vi.stubGlobal("fetch", async (_url: unknown, init?: RequestInit) => {
    keys.push(new Headers(init?.headers).get(IDEMPOTENCY_HEADER));
    const next = outcomes.length > 1 ? outcomes.shift()! : outcomes[0];
    if (next instanceof Error) throw next;
    return next.clone();
  });
  return keys;
}
const ok = () => new Response(JSON.stringify({ id: "m1" }), { status: 200 });
const fail = (status: number, code: string) => new Response(JSON.stringify({ error: { code, message: "x" } }), { status });
const swallow = (p: Promise<unknown>) =>
  p.then(
    () => null,
    (e: unknown) => e,
  );
const send = (body = "Merhaba") => postMessage("topic", "t1", { body, stance: "pro" });

beforeEach(() => setAuthToken("belirtec-1"));
afterEach(() => {
  setAuthToken(null);
  vi.unstubAllGlobals();
});

describe("Idempotency-Key başlığı", () => {
  it("oturumlu değiştiren isteğe UUID anahtar eklenir; GET, oturumsuz istek ve /api/auth/* anahtarsızdır", async () => {
    const keys = fakeFetch(ok());
    await send();
    await request("/api/health");
    await login({ login: "a", password: "b" });
    setAuthToken(null);
    await send();
    expect(keys[0]).toMatch(UUID);
    expect(keys.slice(1)).toEqual([null, null, null]);
  });

  it("idempotencyKey: false başlığı kapatır; verilen anahtar aynen gönderilir", async () => {
    const keys = fakeFetch(ok());
    await request("/api/x", { method: "POST", body: {}, idempotencyKey: false });
    await request("/api/x", { method: "POST", body: {}, idempotencyKey: "benim-anahtarim-1" });
    expect(keys).toEqual([null, "benim-anahtarim-1"]);
  });

  it("başarılı gönderimden sonra aynı içerik yeni bir işlemdir (yeni anahtar)", async () => {
    const keys = fakeFetch(ok());
    await send();
    await send();
    expect(keys[0]).not.toBe(keys[1]);
  });
});

describe("yanıtı belirsiz kalan gönderimin yeniden denenmesi", () => {
  it("ağ hatasından sonra aynı içerik AYNI anahtarla gider; başarıdan sonra anahtar unutulur", async () => {
    const keys = fakeFetch(new TypeError("Failed to fetch"), ok(), ok());
    expect(await swallow(send())).toMatchObject({ status: 0, code: "network" });
    await send();
    await send();
    expect(keys[1]).toBe(keys[0]);
    expect(keys[2]).not.toBe(keys[0]);
  });

  it("zaman aşımından sonra aynı anahtar; ileti yeniden göndermenin güvenli olduğunu söyler", async () => {
    const keys: (string | null)[] = [];
    let stall = true;
    vi.stubGlobal("fetch", (_url: unknown, init?: RequestInit) => {
      keys.push(new Headers(init?.headers).get(IDEMPOTENCY_HEADER));
      if (!stall) return Promise.resolve(ok());
      return new Promise((_r, reject) => init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError"))));
    });
    const opts = { method: "POST" as const, body: { body: "Merhaba" }, timeoutMs: 10 };
    const err = await swallow(request("/api/threads/topic/t1", opts));
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ code: "timeout" });
    expect((err as ApiError).message).toMatch(/çift kayıt oluşmaz/);
    stall = false;
    await request("/api/threads/topic/t1", opts);
    await request("/api/threads/topic/t1", opts);
    expect(keys[0]).toMatch(UUID);
    expect(keys[1]).toBe(keys[0]);
    expect(keys[2]).not.toBe(keys[0]);
  });

  it("GET zaman aşımında ileti değişmez (anahtar yok)", async () => {
    vi.stubGlobal("fetch", (_url: unknown, init?: RequestInit) => new Promise((_r, reject) => init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")))));
    const err = await swallow(request("/api/health", { timeoutMs: 10 }));
    expect((err as ApiError).message).toBe("Sunucu zamanında yanıt vermedi. Lütfen tekrar deneyin.");
  });

  it("vekil 502/503/504 ve 409 idempotency_in_progress belirsizdir: anahtar korunur", async () => {
    for (const r of [fail(502, "unreachable"), fail(503, "x"), fail(504, "x"), fail(409, "idempotency_in_progress")]) {
      const keys = fakeFetch(r, ok());
      await swallow(send(`metin ${r.status}`));
      await send(`metin ${r.status}`);
      expect(keys[1], `HTTP ${r.status}`).toBe(keys[0]);
    }
  });

  it("sunucunun kesin hatası (ör. 422) işlemi bitirir: yeniden gönderim yeni anahtar alır", async () => {
    const keys = fakeFetch(fail(422, "pii_detected"), ok());
    await swallow(send());
    await send();
    expect(keys[1]).not.toBe(keys[0]);
  });

  it("farklı içerik farklı anahtar alır; araya aynı kaynağa başka istek girerse eski belirsiz deneme unutulur", async () => {
    const keys = fakeFetch(new TypeError("Failed to fetch"));
    await swallow(send("bir"));
    await swallow(send("bir"));
    expect(keys[1]).toBe(keys[0]); // ardışık yeniden gönderim: aynı anahtar
    await swallow(send("iki"));
    expect(keys[2]).not.toBe(keys[0]);
    await swallow(send("bir"));
    expect(keys[3]).not.toBe(keys[0]); // "iki" araya girdi: "bir" artık yeni bir istektir
    expect(keys[3]).not.toBe(keys[2]);
  });

  it("oturum değişince belirsiz denemeler unutulur", async () => {
    const keys = fakeFetch(new TypeError("Failed to fetch"));
    await swallow(send("bir"));
    setAuthToken("belirtec-2");
    await swallow(send("bir"));
    expect(keys[1]).not.toBe(keys[0]);
  });

  it("ilgisiz bir kaynağa yapılan istek belirsiz denemeyi geçersiz kılmaz", async () => {
    const keys = fakeFetch(new TypeError("Failed to fetch"), ok(), ok());
    await swallow(send("bir"));
    await vote("p1", "yes");
    await send("bir");
    expect(keys[2]).toBe(keys[0]);
  });
});

describe("geri alınan değişiklik eski anahtarla sessizce yutulmaz (aynı kaynağa sonraki kesin yanıt)", () => {
  it("oy: Evet (belirsiz) → Hayır (başarılı) → Evet yeni anahtar alır", async () => {
    const keys = fakeFetch(new TypeError("Failed to fetch"), ok(), ok());
    await swallow(vote("p1", "yes"));
    await vote("p1", "no");
    await vote("p1", "yes");
    expect(keys[1]).not.toBe(keys[0]);
    expect(keys[2]).not.toBe(keys[0]);
    expect(keys[2]).not.toBe(keys[1]);
  });

  it("oy: Evet (belirsiz) → Hayır (belirsiz) → Evet de yeni anahtar alır", async () => {
    const keys = fakeFetch(new TypeError("Failed to fetch"));
    await swallow(vote("p1", "yes"));
    await swallow(vote("p1", "no"));
    await swallow(vote("p1", "yes"));
    expect(keys[2]).not.toBe(keys[0]);
  });

  it("takip: POST (belirsiz) → DELETE (başarılı) → POST yeni anahtar alır", async () => {
    const keys = fakeFetch(new TypeError("Failed to fetch"), ok(), ok());
    await swallow(followUser("u1"));
    await unfollowUser("u1");
    await followUser("u1");
    expect(keys[2]).not.toBe(keys[0]);
  });

  it("ilişki: POST (belirsiz) → DELETE ?kind (başarılı) → POST yeni anahtar alır (sorgu dizesi kaynağı değiştirmez)", async () => {
    const keys = fakeFetch(new TypeError("Failed to fetch"), ok(), ok());
    await swallow(relateUser("u1", "family"));
    await unrelateUser("u1", "family");
    await relateUser("u1", "family");
    expect(keys[2]).not.toBe(keys[0]);
  });

  it("taslak: A (belirsiz) → B (başarılı) → A yeni anahtar alır", async () => {
    const keys = fakeFetch(new TypeError("Failed to fetch"), ok(), ok());
    const A = { title: "Başlık A", body: "Gövde A" };
    await swallow(updateProposal("p1", A));
    await updateProposal("p1", { title: "Başlık B", body: "Gövde B" });
    await updateProposal("p1", A);
    expect(keys[2]).not.toBe(keys[0]);
  });

  it("vekâlet: ver (belirsiz) → geri al (alt kaynak, başarılı) → aynı vekâleti ver yeni anahtar alır", async () => {
    const keys = fakeFetch(new TypeError("Failed to fetch"), ok(), ok());
    const req = { to: "u2", scope: "*", rank: 1 };
    await swallow(delegate(req));
    await revokeDelegation("d1");
    await delegate(req);
    expect(keys[2]).not.toBe(keys[0]);
  });

  it("anahtarı elle verilen istek de aynı kaynaktaki belirsiz denemeyi geçersiz kılar", async () => {
    const keys = fakeFetch(new TypeError("Failed to fetch"), ok(), ok());
    await swallow(vote("p1", "yes"));
    await request("/api/proposals/p1/vote", { method: "POST", body: { choice: "no" }, idempotencyKey: "elle-verilen-anahtar" });
    await vote("p1", "yes");
    expect(keys[2]).not.toBe(keys[0]);
  });
});

describe("newIdempotencyKey", () => {
  it("randomUUID yoksa (güvenli olmayan bağlam) getRandomValues ile UUID v4 üretir", () => {
    const real = globalThis.crypto;
    vi.stubGlobal("crypto", { getRandomValues: (a: Uint8Array<ArrayBuffer>) => real.getRandomValues(a) });
    const a = newIdempotencyKey();
    const b = newIdempotencyKey();
    expect(a).toMatch(UUID);
    expect(b).toMatch(UUID);
    expect(a).not.toBe(b);
  });
});
