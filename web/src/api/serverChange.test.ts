// Sunucu adresi değişince eski sunucunun oturum belirteci yeni adrese GÖNDERİLMEZ: belirteç (bellekte ve cihazda) unutulur ve
// "serverchange" olayı yayılır (AuthContext oturumu kapatır). Ayarlar sayfası adresi değiştirmeden önce eski sunucuda çıkış yapar.
import { afterEach, describe, expect, it, vi } from "vitest";
import { getPref, PREF_KEYS, setPref } from "../lib/prefs";
import { changeServer } from "../pages/SettingsPage";
import { getAuthToken, onServerChange, request, sameServer, setAuthToken, setServerUrl } from "./client";

vi.mock("../auth/AuthContext", () => ({ useAuth: () => ({}), useServerNow: () => Date.now }));

afterEach(() => vi.unstubAllGlobals());

/** fetch taklidi: gönderilen adres ve Authorization başlığı kaydedilir. */
function captureFetch() {
  const sent: { url: string; auth: string | null }[] = [];
  vi.stubGlobal("fetch", async (url: string, init?: RequestInit) => {
    const headers = (init?.headers ?? {}) as Record<string, string>;
    sent.push({ url, auth: headers.Authorization ?? null });
    return new Response(JSON.stringify({ ok: true }), { status: 200 });
  });
  return sent;
}

describe("sunucu adresi değişimi ve oturum belirteci", () => {
  it("adres değişince belirteç unutulur: yeni adrese giden istek Authorization taşımaz, cihazdaki belirteç silinir, olay yayılır", async () => {
    await setServerUrl("http://127.0.0.1:4440");
    setAuthToken("zeynep-4440-belirteci");
    await setPref(PREF_KEYS.token, "zeynep-4440-belirteci");
    const sent = captureFetch();
    await request("/api/system");
    expect(sent[0]).toEqual({ url: "http://127.0.0.1:4440/api/system", auth: "Bearer zeynep-4440-belirteci" });

    const changed = vi.fn();
    const off = onServerChange(changed);
    await setServerUrl("http://127.0.0.1:4442");
    off();
    expect(changed).toHaveBeenCalledTimes(1);
    expect(getAuthToken()).toBeNull();
    expect(await getPref(PREF_KEYS.token)).toBeNull();

    await request("/api/system");
    await request("/api/me");
    expect(sent.slice(1)).toEqual([
      { url: "http://127.0.0.1:4442/api/system", auth: null },
      { url: "http://127.0.0.1:4442/api/me", auth: null },
    ]);
  });

  it("aynı sunucuyu gösteren yazım farkı (büyük harf, sondaki / ya da /api) oturumu kapatmaz", async () => {
    await setServerUrl("http://forum.test:4000");
    setAuthToken("t2");
    const changed = vi.fn();
    const off = onServerChange(changed);
    await setServerUrl("HTTP://Forum.test:4000/api/");
    off();
    expect(changed).not.toHaveBeenCalled();
    expect(getAuthToken()).toBe("t2");
  });

  it("oturum yokken adres değişimi olay yaymaz", async () => {
    setAuthToken(null);
    const changed = vi.fn();
    const off = onServerChange(changed);
    await setServerUrl("http://baska.test:5000");
    off();
    expect(changed).not.toHaveBeenCalled();
  });

  it("sameServer: boş adres sayfanın kökenidir; port ya da makine farkı başka sunucudur", () => {
    expect(sameServer("", "http://localhost:5173", "http://localhost:5173")).toBe(true);
    expect(sameServer("http://a.test:1", "http://a.test:2", "")).toBe(false);
    expect(sameServer("http://a.test:1/", "http://A.TEST:1/api", "")).toBe(true);
    expect(sameServer("", "http://kotu.test", "http://localhost:5173")).toBe(false);
  });
});

describe("Ayarlar › sunucu adresi: önce eski sunucuda çıkış, sonra adres", () => {
  const deps = (current: string, hasSession: boolean) => {
    const calls: string[] = [];
    return {
      calls,
      d: {
        current: async () => current,
        defaultUrl: "",
        hasSession,
        logout: async () => void calls.push("logout"),
        set: async (u: string | null) => void calls.push(`set:${u}`),
      },
    };
  };

  it("başka sunucuya geçerken oturum açıksa çıkış adres değişmeden ÖNCE yapılır", async () => {
    const { calls, d } = deps("http://127.0.0.1:4440", true);
    expect(await changeServer("http://127.0.0.1:4442", d)).toEqual({ changed: true, loggedOut: true });
    expect(calls).toEqual(["logout", "set:http://127.0.0.1:4442"]);
  });

  it("aynı sunucu (yazım farkı) ya da oturum yoksa çıkış yapılmaz", async () => {
    const same = deps("http://127.0.0.1:4440", true);
    expect(await changeServer("http://127.0.0.1:4440/", same.d)).toEqual({ changed: false, loggedOut: false });
    expect(same.calls).toEqual(["set:http://127.0.0.1:4440/"]);
    const anon = deps("http://127.0.0.1:4440", false);
    expect(await changeServer(null, anon.d)).toMatchObject({ loggedOut: false });
    expect(anon.calls).toEqual(["set:null"]);
  });
});
