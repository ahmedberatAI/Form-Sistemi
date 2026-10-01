import { describe, expect, it } from "vitest";
import { generateTckn } from "@forum/shared";
import { detectPii, PseudonymMasker, redactPii, sanitizeForModel } from "../../src/ai";

const TCKN = generateTckn("123456789");
const TCKN2 = generateTckn("345678912");
const IBAN = "TR33 0006 1005 1978 6457 8413 26";

const kinds = (t: string) => detectPii(t).map((f) => f.kind);
const slices = (t: string) => detectPii(t).map((f) => t.slice(f.start, f.end));

describe("detectPii", () => {
  it("geçerli TCKN'yi bulur, geçersiz 11 haneli sayıyı bulmaz", () => {
    const t = `Kimlik numaram ${TCKN} olarak kayıtlı.`;
    const f = detectPii(t);
    expect(f).toHaveLength(1);
    expect(f[0].kind).toBe("tckn");
    expect(t.slice(f[0].start, f[0].end)).toBe(TCKN);
    expect(f[0].masked).toBe(TCKN.slice(0, 3) + "******" + TCKN.slice(9));
    expect(kinds("Sipariş no 12345678901 hazır.")).toEqual([]);
    expect(kinds("Toplam 2026 yılında 150 kişi katıldı.")).toEqual([]);
  });

  it("aralıklı TCKN ve daha uzun sayı içindeki 11 haneyi ayırt eder", () => {
    const spaced = `${TCKN.slice(0, 3)} ${TCKN.slice(3, 6)} ${TCKN.slice(6, 9)} ${TCKN.slice(9)}`;
    expect(kinds(`TC: ${spaced}`)).toEqual(["tckn"]);
    expect(kinds(`Kod: 9${TCKN}9`)).toEqual([]);
  });

  it("IBAN'ı boşluklu ve boşluksuz bulur", () => {
    expect(slices(`IBAN: ${IBAN} hesabına`)).toEqual([IBAN]);
    const compact = IBAN.replace(/ /g, "");
    expect(slices(`hesap ${compact}.`)).toEqual([compact]);
    const f = detectPii(`IBAN: ${IBAN}`)[0];
    expect(f.kind).toBe("iban");
    expect(f.masked.startsWith("TR33")).toBe(true);
    expect(f.masked.endsWith("26")).toBe(true);
    expect(f.masked).not.toContain("1978");
  });

  it("telefon numaralarını farklı biçimlerde bulur", () => {
    for (const p of ["0532 123 45 67", "05321234567", "+90 532 123 45 67", "+905321234567", "0 212 345 67 89", "0212-345-67-89", "532 123 45 67", "0090 532 123 4567"]) {
      const t = `Beni ${p} numarasından arayın.`;
      const f = detectPii(t);
      expect(f.map((x) => x.kind), p).toEqual(["phone"]);
      expect(t.slice(f[0].start, f[0].end), p).toBe(p);
    }
  });

  it("e-posta adresini bulur ve maskeler", () => {
    const t = "Yazın: ayse.yilmaz+forum@ornek.com.tr adresine.";
    const f = detectPii(t);
    expect(f.map((x) => x.kind)).toEqual(["email"]);
    expect(t.slice(f[0].start, f[0].end)).toBe("ayse.yilmaz+forum@ornek.com.tr");
    expect(f[0].masked).toMatch(/^ay\*+tr$/);
  });

  it("adres sezgiseli: birden çok işaret ya da işaret + numara", () => {
    const t = "Adresim Atatürk Mah. Gül Sok. No: 5 Daire 3, Çankaya.";
    const f = detectPii(t);
    expect(f.map((x) => x.kind)).toEqual(["address"]);
    expect(t.slice(f[0].start, f[0].end)).toBe("Atatürk Mah. Gül Sok. No: 5 Daire 3");
    expect(kinds("Cumhuriyet Caddesi No: 12 önünde buluşalım")).toEqual(["address"]);
    expect(kinds("Lale Sokak 14 numarada oturuyor")).toEqual(["address"]);
  });

  it("adres olmayan mahalle/daire kullanımlarını işaretlemez", () => {
    expect(kinds("Parka yalnızca X mahallesinden olanlar girebilsin")).toEqual([]);
    expect(kinds("Bu mahallede sokak hayvanları için mama kabı konulsun.")).toEqual([]);
    expect(kinds("Belediyenin ilgili dairesi bu konuda bilgi versin.")).toEqual([]);
  });

  it("çok türlü metinde çakışmasız ve sıralı bulgular döndürür", () => {
    const t = `Ad: Ali, TC ${TCKN2}, tel 0532 123 45 67, e-posta ali@ornek.com, IBAN ${IBAN}, adres Kızılay Mah. Lale Sok. No: 7.`;
    const f = detectPii(t);
    expect(f.map((x) => x.kind)).toEqual(["tckn", "phone", "email", "iban", "address"]);
    for (let i = 1; i < f.length; i++) expect(f[i].start).toBeGreaterThanOrEqual(f[i - 1].end);
    for (const x of f) {
      expect(x.masked.length).toBe(x.end - x.start);
      expect(x.masked).toContain("*");
    }
  });

  it("boş metin için boş liste", () => {
    expect(detectPii("")).toEqual([]);
  });
});

describe("maskeleme", () => {
  it("redactPii yer tutucular koyar", () => {
    const t = `TC ${TCKN} tel 0532 123 45 67 posta a@b.com`;
    expect(redactPii(t)).toBe("TC [TCKN] tel [TELEFON] posta [E-POSTA]");
  });

  it("@takma_ad kalıplarını tutarlı K-kodlarıyla değiştirir; e-postayı takma ad sanmaz", () => {
    const m = new PseudonymMasker(4);
    expect(m.mask("@ahmet_b ve @Zeynep.K, sonra yine @AHMET_B")).toBe("@K4 ve @K5, sonra yine @K4");
    const s = sanitizeForModel("Bana ali@ornek.com yazın @veli_42");
    expect(s).toBe("Bana [E-POSTA] yazın @K1");
  });
});
