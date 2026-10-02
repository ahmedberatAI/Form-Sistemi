// Zaman aşımı sayacı yanıt gövdesi okunurken de işlemeli: başlıklar gelip gövde donarsa istek sonsuza dek asılı kalmamalı.
// Bkz. bulgu #208.
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, request } from "./client";

afterEach(() => vi.unstubAllGlobals());

/** Başlıkları hemen dönen ama gövdesi (abort edilene kadar) hiç bitmeyen sahte yanıt */
const stalledBodyFetch = vi.fn(async (_url: unknown, init?: RequestInit) => ({
  ok: true,
  status: 200,
  text: () =>
    new Promise<string>((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => reject(new DOMException("Aborted", "AbortError")), { once: true });
    }),
}));

describe("request(): gövde okuma zaman aşımı", () => {
  it("gövde donarsa 'timeout' ApiError ile biter", async () => {
    vi.stubGlobal("fetch", stalledBodyFetch);
    const err = await request("/api/health", { timeoutMs: 30 }).then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).toBeInstanceOf(ApiError);
    expect(err).toMatchObject({ status: 0, code: "timeout" });
  });

  it("çağıranın kendi iptali gövde okunurken AbortError olarak aynen iletilir", async () => {
    vi.stubGlobal("fetch", stalledBodyFetch);
    const ctrl = new AbortController();
    const p = request("/api/health", { timeoutMs: 5000, signal: ctrl.signal });
    setTimeout(() => ctrl.abort(), 20);
    const err = await p.then(
      () => null,
      (e: unknown) => e,
    );
    expect(err).not.toBeInstanceOf(ApiError);
    expect((err as DOMException).name).toBe("AbortError");
  });

  it("gövde zamanında okunursa normal çalışır", async () => {
    vi.stubGlobal("fetch", async () => new Response(JSON.stringify({ ok: true }), { status: 200 }));
    await expect(request<{ ok: boolean }>("/api/health", { timeoutMs: 1000 })).resolves.toEqual({ ok: true });
  });
});
