// Graf sayfasında hiçbir kenar türü seçilmediğinde istek "hiç kenar" demelidir. Eski hata: qs() boş diziyi atlıyordu, `types`
// parametresi düşüyordu ve sunucu varsayılan türleri (FOLLOWS, VOUCHES, DELEGATES_TO) döndürüyordu; "hiçbiri seçili değil" yine
// kenar gösteriyordu. Sunucu tarafı: boş `types=` → hiç kenar (server/test/graph/round1-fixes.test.ts).
import { afterEach, describe, expect, it, vi } from "vitest";
import { getGraph } from "./endpoints";

afterEach(() => vi.unstubAllGlobals());

function captureUrls(): string[] {
  const urls: string[] = [];
  vi.stubGlobal("fetch", async (url: unknown) => {
    urls.push(String(url));
    return new Response(JSON.stringify({ nodes: [], edges: [] }), { status: 200 });
  });
  return urls;
}

const queryOf = (url: string): URLSearchParams => new URLSearchParams(url.slice(url.indexOf("?") + 1));

describe("getGraph: kenar türü sorgusu", () => {
  it("boş tür listesi açık `types=` olarak gider (atlanmaz), limit de korunur", async () => {
    const urls = captureUrls();
    await getGraph({ types: [], limit: 500 });
    expect(urls).toHaveLength(1);
    const q = queryOf(urls[0]);
    expect(q.has("types")).toBe(true);
    expect(q.get("types")).toBe("");
    expect(q.get("limit")).toBe("500");
    expect(urls[0]).not.toMatch(/\?.*\?/); // tek soru işareti: ek sorgu & ile eklenir
  });

  it("seçili türler virgülle gider; tür verilmezse parametre yoktur (sunucu varsayılanı)", async () => {
    const urls = captureUrls();
    await getGraph({ types: ["FOLLOWS", "VOUCHES"], limit: 10 });
    await getGraph();
    expect(queryOf(urls[0]).get("types")).toBe("FOLLOWS,VOUCHES");
    expect(urls[1]).toMatch(/\/api\/graph$/);
  });
});
