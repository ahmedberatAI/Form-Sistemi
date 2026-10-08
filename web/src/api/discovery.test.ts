// Keşif uçlarının istemci sözleşmesi (docs/API.md "Önerili arama", "Kişisel sıralama", Listem): yöntem, yol, sorgu dizesi ve başlık.
// 'Son açılanlar' yalnız doluysa ve virgülle birleştirilmiş tek X-Forum-Recent BAŞLIĞI olarak gider — adres satırında asla (ters vekil
// günlükleri); boş dizi başlık üretmez. Varsayılan öneri listesi ve pano istekleri eskisi gibi parametresizdir.
import { afterEach, describe, expect, it, vi } from "vitest";
import { getDashboard, getSaved, listProposals, listProposalsForYou, saveItem, search, unsaveItem } from "./endpoints";

afterEach(() => vi.unstubAllGlobals());

interface Call {
  url: string;
  method: string;
  body: string | undefined;
  headers: Record<string, string>;
}

function capture(response: unknown = {}): Call[] {
  const calls: Call[] = [];
  vi.stubGlobal("fetch", async (url: unknown, init?: RequestInit) => {
    const headers = Object.fromEntries(Object.entries((init?.headers ?? {}) as Record<string, string>).map(([k, v]) => [k.toLowerCase(), v]));
    calls.push({ url: String(url), method: init?.method ?? "GET", body: init?.body as string | undefined, headers });
    return new Response(JSON.stringify(response), { status: 200 });
  });
  return calls;
}

const A = "11111111-1111-4111-8111-111111111111";
const B = "22222222-2222-4222-8222-222222222222";
const query = (url: string) => new URLSearchParams(url.includes("?") ? url.slice(url.indexOf("?") + 1) : "");
const path = (url: string) => (url.includes("?") ? url.slice(0, url.indexOf("?")) : url);

describe("önerili arama", () => {
  it("GET /api/search?q=&limit= (metin kodlanır)", async () => {
    const calls = capture({ q: "x", items: [], total: { proposals: 0, topics: 0 } });
    await search("#K12 çevre&yol", 8);
    expect(calls[0].method).toBe("GET");
    expect(path(calls[0].url)).toBe("/api/search");
    expect(query(calls[0].url).get("q")).toBe("#K12 çevre&yol");
    expect(query(calls[0].url).get("limit")).toBe("8");
  });

  it("limit verilmezse parametre yok (sunucu varsayılanı 8)", async () => {
    const calls = capture({ q: "x", items: [], total: { proposals: 0, topics: 0 } });
    await search("bisiklet");
    expect([...query(calls[0].url).keys()]).toEqual(["q"]);
  });
});

describe("Listem", () => {
  it("GET /api/me/saved; PUT ve DELETE /api/me/saved/:type/:id (yol parçaları kodlanır)", async () => {
    const calls = capture({ items: [] });
    await getSaved();
    await saveItem("proposal", A);
    await unsaveItem("topic", "t/1");
    expect(calls.map((c) => [c.method, c.url])).toEqual([
      ["GET", "/api/me/saved"],
      ["PUT", `/api/me/saved/proposal/${A}`],
      ["DELETE", "/api/me/saved/topic/t%2F1"],
    ]);
  });
});

describe("kişisel sıra ve pano", () => {
  it("'Size göre': sort=sana-gore + aynı süzgeç ve limit; son açılanlar virgülle tek X-Forum-Recent başlığı, adreste değil", async () => {
    const calls = capture({ personalized: true, items: [] });
    await listProposalsForYou({ limit: 500, status: "open" }, [A, B]);
    const q = query(calls[0].url);
    expect(path(calls[0].url)).toBe("/api/proposals");
    expect(q.get("sort")).toBe("sana-gore");
    expect(q.get("limit")).toBe("500");
    expect(q.get("status")).toBe("open");
    expect(q.has("recent")).toBe(false);
    expect(calls[0].url).not.toContain(A);
    expect(calls[0].headers["x-forum-recent"]).toBe(`${A},${B}`);
  });

  it("son açılanlar boşsa başlık gönderilmez", async () => {
    const calls = capture({ personalized: false, items: [] });
    await listProposalsForYou({ limit: 10 }, []);
    await listProposalsForYou();
    expect(calls[0].headers).not.toHaveProperty("x-forum-recent");
    expect(query(calls[1].url).get("sort")).toBe("sana-gore");
    expect(calls[1].headers).not.toHaveProperty("x-forum-recent");
  });

  it("varsayılan liste eskisi gibi: sort ve recent yok", async () => {
    const calls = capture([]);
    await listProposals({ limit: 500 });
    expect(calls[0].url).toBe("/api/proposals?limit=500");
  });

  it("pano: adres her zaman parametresiz; son açılanlar yalnız doluysa başlıkta", async () => {
    const calls = capture({});
    await getDashboard();
    await getDashboard([]);
    await getDashboard([A]);
    expect(calls.map((c) => c.url)).toEqual(["/api/dashboard", "/api/dashboard", "/api/dashboard"]);
    expect(calls.map((c) => c.headers["x-forum-recent"])).toEqual([undefined, undefined, A]);
  });
});
