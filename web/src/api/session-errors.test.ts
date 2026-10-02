// Açılışta /api/me yanıtının 5xx / "ulaşılamıyor" olması oturumun bittiği anlamına gelmez: yalnızca 401 oturumu kapatır,
// diğer hatalar bağlantı sorunu olarak gösterilir ve belirteç korunur. Bkz. bulgu #198.
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, isSessionRejected, toConnectionError } from "./client";
import { getMe } from "./endpoints";

afterEach(() => vi.unstubAllGlobals());

const reject = async (response: Response | Error): Promise<unknown> => {
  vi.stubGlobal("fetch", async () => {
    if (response instanceof Error) throw response;
    return response;
  });
  return getMe().then(
    () => {
      throw new Error("Hata bekleniyordu");
    },
    (e: unknown) => e,
  );
};

describe("/api/me hataları: oturum mu bitti, bağlantı mı sorunlu?", () => {
  it("yalnızca 401 oturumu reddedilmiş sayar", async () => {
    const e401 = await reject(new Response(JSON.stringify({ error: { code: "unauthorized", message: "Oturum gerekli" } }), { status: 401 }));
    expect(isSessionRejected(e401)).toBe(true);
  });

  it("502/503/504, boş 500 ve ağ hatası oturumu bitirmez ve bağlantı sorunu olarak gösterilir", async () => {
    for (const status of [502, 503, 504, 500]) {
      const e = await reject(new Response("", { status }));
      expect(e).toBeInstanceOf(ApiError);
      expect(isSessionRejected(e), `HTTP ${status}`).toBe(false);
      expect(toConnectionError(e)).toBe(e);
      expect((e as ApiError).code).toBe("unreachable");
    }
    const net = await reject(new TypeError("Failed to fetch"));
    expect(isSessionRejected(net)).toBe(false);
    expect(toConnectionError(net)).toMatchObject({ status: 0, code: "network" });
  });

  it("ApiError olmayan hata da bağlantı sorunu ApiError'una çevrilir", () => {
    const c = toConnectionError(new Error("beklenmeyen"));
    expect(c).toBeInstanceOf(ApiError);
    expect(c.isNetwork).toBe(true);
    expect(c.message).toBe("beklenmeyen");
  });
});
