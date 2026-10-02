// ClampText saf yardımcıları: düğme etiketi ve kelime sayımı. Bkz. ui/ClampText.tsx.
import { describe, expect, it } from "vitest";
import { clampToggleLabel, countWords } from "./ClampText";

describe("countWords", () => {
  it("boşlukla ayrılmış sözcükleri sayar; satır sonu ve art arda boşluk tek ayraçtır", () => {
    expect(countWords("bir iki üç")).toBe(3);
    expect(countWords("  bir\n\niki \t üç  ")).toBe(3);
    expect(countWords("Madde 5'e göre, oylama %60 eşiğiyle yapılır.")).toBe(7);
  });

  it("boş, null ve yalnız boşluk 0", () => {
    expect(countWords("")).toBe(0);
    expect(countWords("   \n ")).toBe(0);
    expect(countWords(null)).toBe(0);
    expect(countWords(undefined)).toBe(0);
  });
});

describe("clampToggleLabel", () => {
  it("kısaltılmışken sözcük sayısını, açıkken 'Kısalt'ı yazar", () => {
    expect(clampToggleLabel(false, 412)).toBe("Tamamını göster (412 kelime)");
    expect(clampToggleLabel(true, 412)).toBe("Kısalt");
  });

  it("etiketler e2e'nin aradığı düğme adlarını içermez", () => {
    for (const label of [clampToggleLabel(false, 7), clampToggleLabel(true, 7)]) {
      for (const banned of ["Destekle", "Oyumu ver", "Daha fazla", "Sayımı kendim doğrulayayım", "Kapat"]) {
        expect(label.toLowerCase()).not.toContain(banned.toLowerCase());
      }
    }
  });
});
