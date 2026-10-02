// Hata sınırı: tembel paket parçası hatası tanınır, TEK otomatik yeniden yükleme hakkı verilir ve hata ekranı
// Türkçe iletiyle iki eylemi ("Sayfayı yeniden yükle", "Ana sayfaya dön") sunar. Bkz. bulgu #194.
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import { claimChunkReload, ErrorBoundary, isChunkLoadError } from "./ErrorBoundary";

describe("ErrorBoundary", () => {
  it("paket parçası yükleme hatalarını tanır", () => {
    expect(isChunkLoadError(new TypeError("Failed to fetch dynamically imported module: http://x/assets/Page-abc.js"))).toBe(true);
    expect(isChunkLoadError(new TypeError("error loading dynamically imported module"))).toBe(true);
    expect(isChunkLoadError(new TypeError("Importing a module script failed."))).toBe(true);
    expect(isChunkLoadError(Object.assign(new Error("Loading chunk 7 failed."), { name: "ChunkLoadError" }))).toBe(true);
    expect(isChunkLoadError(new TypeError("Cannot read properties of undefined (reading 'x')"))).toBe(false);
    expect(isChunkLoadError(null)).toBe(false);
  });

  it("paket parçası hatasında tek yeniden yükleme: kısa sürede ikincisi verilmez, depo erişilemezse hiç verilmez", () => {
    let stored: string | null = null;
    const read = () => stored;
    const write = (v: string) => {
      stored = v;
    };
    expect(claimChunkReload(1_000_000, read, write)).toBe(true);
    expect(claimChunkReload(1_005_000, read, write)).toBe(false); // yenilemeden sonra hâlâ hata: döngü yok
    expect(claimChunkReload(1_100_000, read, write)).toBe(true); // çok sonra yeni bir dağıtım: yine bir hak
    expect(
      claimChunkReload(
        2_000_000,
        () => {
          throw new Error("sessionStorage kapalı");
        },
        write,
      ),
    ).toBe(false);
  });

  it("hata durumunda Türkçe ileti ve iki eylem gösterir; hatasız çocukları aynen çizer", () => {
    const ok = renderToStaticMarkup(createElement(ErrorBoundary, null, createElement("p", null, "içerik")));
    expect(ok).toBe("<p>içerik</p>");

    const state = ErrorBoundary.getDerivedStateFromError(new Error("kırıldı"));
    const boundary = new ErrorBoundary({ children: null });
    boundary.state = state;
    const html = renderToStaticMarkup(boundary.render() as never);
    expect(html).toContain("Bir şeyler ters gitti");
    expect(html).toContain("Sayfayı yeniden yükle");
    expect(html).toContain("Ana sayfaya dön");
    expect(html).toContain('href="#/"');
  });
});
