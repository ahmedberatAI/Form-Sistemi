// Yönetmelik sürümü değişince ontoloji önbelleği tazelenir (invalidateOntology gerçekten çağrılır). Bkz. bulgu #145.
import { afterEach, describe, expect, it, vi } from "vitest";
import { loadOntology, syncOntologyWithBylawVersion } from "./categories";

afterEach(() => vi.unstubAllGlobals());

const ontologyAt = (version: number) => ({
  version: { version, hash: `h${version}`, createdAt: 0, viaProposalId: null, ledgerTx: null },
  categories: [],
  rights: [],
  articles: [],
  deletionGrounds: [],
  objectionGrounds: [],
  contentLabels: [],
  tiers: [],
  params: [],
});

describe("ontoloji önbelleği ve yönetmelik sürümü", () => {
  it("sistem bilgisindeki sürüm farklıysa önbellek tazelenir, aynıysa istek atılmaz", async () => {
    let serverVersion = 1;
    const fetchMock = vi.fn(async () => new Response(JSON.stringify(ontologyAt(serverVersion)), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    expect((await loadOntology(true)).version.version).toBe(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Aynı sürüm: önbellek korunur, yeni istek yok.
    expect(syncOntologyWithBylawVersion(1)).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(1);

    // Yeni yönetmelik yürürlüğe girdi: önbellek geçersiz kılınır ve yeniden yüklenir.
    serverVersion = 2;
    expect(syncOntologyWithBylawVersion(2)).toBe(true);
    expect((await loadOntology()).version.version).toBe(2); // sürmekte olan yeniden yüklemeyi bekler
    expect(fetchMock).toHaveBeenCalledTimes(2);

    // Tazelenmiş önbellek yeni sürümle uyumlu: tekrar istek yok.
    expect(syncOntologyWithBylawVersion(2)).toBe(false);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
