// Kayıt formu kuralları sunucudakiyle (server/src/identity/validation.ts › parseRegistration) aynıdır. Eski sapma: istemci takma adı
// NFKC'ye çevirmeden desene sokuyordu; tam genişlikli 'ａｌｉｃｅ' formda reddediliyor, sunucu ise 'alice'e çevirip kabul ediyordu.
// Burada her girdi için "istemci hangi alanları reddediyor" ile "sunucu hangi alanları reddediyor" kümeleri karşılaştırılır:
// biri sunucudan ayrışırsa test kırılır (kural kopyalarının sessizce ayrışmasına karşı).
import { generateTckn, type RegistrationInput } from "@forum/shared";
import { describe, expect, it } from "vitest";
import { parseRegistration } from "../../../server/src/identity/validation";
import { buildRegistrationInput, normalizeNicknameInput, normalizeTextInput, validate, type FieldKey, type FormState } from "./RegistrationForm";

const NOW = Date.UTC(2026, 9, 3, 12);
const TODAY = "2026-10-03";
const TCKN = generateTckn("123456789");

const base: FormState = {
  nickname: "alice_1",
  password: "sifre1234",
  password2: "sifre1234",
  firstName: "Ayşe",
  lastName: "Yılmaz",
  tckn: TCKN,
  birthDate: "1990-05-17",
  email: "ayse@example.com",
  phone: "0532 123 45 67",
  il: "Ankara",
  ilce: "Çankaya",
  mahalle: "Kızılay",
  acikAdres: "Atatürk Bulvarı No 12 Daire 3",
  postaKodu: "06420",
  kvkkNoticeAccepted: true,
  politicalConsent: true,
  aiConsent: false,
};

/** Formdaki ham değerlerden sunucuya giden yük (sunucu normalleştirmeyi kendisi yapar). */
function rawInput(s: FormState): unknown {
  return {
    nickname: s.nickname,
    password: s.password,
    firstName: s.firstName,
    lastName: s.lastName,
    tckn: s.tckn,
    birthDate: s.birthDate,
    email: s.email,
    phone: s.phone,
    address: { il: s.il, ilce: s.ilce, mahalle: s.mahalle, acikAdres: s.acikAdres, ...(s.postaKodu ? { postaKodu: s.postaKodu } : {}) },
    kvkkNoticeAccepted: s.kvkkNoticeAccepted,
    politicalConsent: s.politicalConsent,
    aiConsent: s.aiConsent,
  };
}

function clientInvalid(s: FormState): string[] {
  return Object.keys(validate(s, "self", TODAY)).sort();
}

function serverInvalid(input: unknown): string[] {
  try {
    parseRegistration(input, NOW);
    return [];
  } catch (e) {
    const details = (e as { details?: Record<string, string> }).details ?? {};
    return Object.keys(details)
      .map((k) => k.split(".").pop() as string)
      .sort();
  }
}

const rep = (ch: string, n: number) => ch.repeat(n);

// [alan, değer, açıklama]
const CASES: [keyof FormState, string, string][] = [
  ["nickname", "ａｌｉｃｅ", "tam genişlikli harfler (NFKC → alice)"],
  ["nickname", "ＡＬＩＣＥ_１", "tam genişlikli büyük harf ve rakam"],
  ["nickname", "  alice  ", "baştaki/sondaki boşluk"],
  ["nickname", "ali ce", "içinde boşluk"],
  ["nickname", "al", "çok kısa"],
  ["nickname", "ａｌ", "tam genişlikli çok kısa"],
  ["nickname", rep("a", 32), "tam 32 karakter"],
  ["nickname", rep("a", 33), "33 karakter"],
  ["nickname", rep("ａ", 32), "tam genişlikli 32 karakter"],
  ["nickname", rep("ａ", 33), "tam genişlikli 33 karakter"],
  ["nickname", "İlker_ç", "Türkçe harfler"],
  ["nickname", "alice@x", "geçersiz karakter"],
  ["nickname", "emoji😀ad", "emoji"],
  ["nickname", "㈱ab", "NFKC ile genişleyen karakter"],
  ["firstName", "Ayşe Nur", "iki sözcüklü ad"],
  ["firstName", "  Ayşe   Nur  ", "fazla boşluk"],
  ["firstName", "Ａｙｓｅ", "tam genişlikli harfler"],
  ["firstName", "A1", "rakam içeren ad"],
  ["firstName", "", "boş ad"],
  ["firstName", "   ", "yalnız boşluk"],
  ["firstName", rep("a", 64), "64 karakter"],
  ["firstName", rep("a", 65), "65 karakter"],
  ["firstName", "O'Neil", "kesme işareti"],
  ["lastName", "Çelik-Yıldız", "tire"],
  ["lastName", rep("b", 65), "65 karakter soyad"],
  ["lastName", "Bey2", "rakam içeren soyad"],
  ["email", "a@b.co", "en kısa geçerli"],
  ["email", "ａ@ｂ.ｃｏｍ", "tam genişlikli e-posta"],
  ["email", " ayse@example.com ", "boşluklu e-posta"],
  ["email", "a@b", "alan adında nokta yok"],
  ["email", "a..b@c.com", "ardışık nokta"],
  ["email", "a b@c.com", "boşluk"],
  ["email", ".a@c.com", "noktayla başlıyor"],
  ["email", "a@b.c", "tek harfli uzantı"],
  ["email", `${rep("x", 250)}@b.co`, "254'ten uzun (255)"],
  ["email", `${rep("x", 249)}@b.co`, "tam 254"],
  ["email", "", "boş"],
  ["il", "A", "il çok kısa"],
  ["il", " Ａ ", "tam genişlikli çok kısa il"],
  ["il", rep("i", 64), "il 64"],
  ["il", rep("i", 65), "il 65"],
  ["ilce", rep("c", 65), "ilçe 65"],
  ["mahalle", rep("m", 128), "mahalle 128"],
  ["mahalle", rep("m", 129), "mahalle 129"],
  ["mahalle", "M", "mahalle çok kısa"],
  ["acikAdres", "abcd", "açık adres 4"],
  ["acikAdres", "abcde", "açık adres 5"],
  ["acikAdres", "  ab  cd  ", "boşluklar sadeleşince 5'ten kısa"],
  ["acikAdres", rep("a", 500), "açık adres 500"],
  ["acikAdres", rep("a", 501), "açık adres 501"],
  ["acikAdres", `${rep("a b ", 200)}`, "çok boşluklu uzun adres"],
  ["postaKodu", "1234", "4 haneli posta kodu"],
  ["postaKodu", "１２３４５", "tam genişlikli rakamlı posta kodu"],
  ["postaKodu", "", "posta kodu yok"],
  ["birthDate", "2000-02-30", "takvimde olmayan gün"],
  ["birthDate", "1899-12-31", "1900'den önce"],
  ["birthDate", TODAY, "bugün"],
  ["birthDate", "2026-10-02", "dün"],
  ["birthDate", "2026-10-04", "yarın"],
  ["birthDate", "1900-01-01", "alt sınır"],
  ["birthDate", "", "boş"],
  ["phone", "05321234567", "05 biçimi"],
  ["phone", "+905321234567", "+90 biçimi"],
  ["phone", "00905321234567", "0090 biçimi"],
  ["phone", "0 (532) 123-45-67", "ayraçlı"],
  ["phone", "０５３２１２３４５６７", "tam genişlikli rakamlar"],
  ["phone", "1234", "geçersiz"],
  ["password", "kisa1", "8'den kısa"],
  ["password", "sadeceharfler", "rakamsız"],
  ["password", "12345678", "harfsiz"],
  ["password", `a1${rep("x", 126)}`, "128"],
  ["password", `a1${rep("x", 127)}`, "129"],
];

describe("kayıt formu ↔ sunucu kuralları: aynı girdi için aynı alanlar reddedilir", () => {
  it("temel örnek her iki tarafta da geçerli", () => {
    expect(clientInvalid(base)).toEqual([]);
    expect(serverInvalid(rawInput(base))).toEqual([]);
  });

  it.each(CASES)("%s = %j (%s)", (field, value, _why) => {
    const s: FormState = { ...base, [field]: value };
    if (field === "password") s.password2 = value;
    const server = serverInvalid(rawInput(s));
    expect(clientInvalid(s)).toEqual(server);
    // İstemci kabul ediyorsa, istemcinin gönderdiği (normalleştirilmiş) yük de sunucuda geçerlidir.
    if (server.length === 0) expect(serverInvalid(buildRegistrationInput(s))).toEqual([]);
  });

  it("rıza kutusu işaretli değilse aydınlatma onayı iki tarafta da hata", () => {
    const s: FormState = { ...base, kvkkNoticeAccepted: false };
    expect(clientInvalid(s)).toEqual(["kvkkNoticeAccepted"]);
    expect(serverInvalid(rawInput(s))).toEqual(["kvkkNoticeAccepted"]);
  });
});

describe("tam genişlikli takma ad (eski hata)", () => {
  it("istemci reddetmez, sunucuya normal harflerle gider", () => {
    const s: FormState = { ...base, nickname: "ａｌｉｃｅ" };
    expect(validate(s, "self", TODAY).nickname).toBeUndefined();
    expect(buildRegistrationInput(s).nickname).toBe("alice");
    expect(parseRegistration(buildRegistrationInput(s), NOW).nickname).toBe("alice");
  });

  it("kayıt memuru kipinde de aynı kural geçerli", () => {
    const s: FormState = { ...base, nickname: "ＢＯＢ_２" };
    expect(validate(s, "registrar", TODAY).nickname).toBeUndefined();
  });

  it("normalleştirme sonrası da geçersizse hâlâ reddedilir (ör. içinde boşluk)", () => {
    expect(validate({ ...base, nickname: "ａｌ ｉｃｅ" }, "self", TODAY).nickname).toMatch(/boşluk/);
    expect(validate({ ...base, nickname: "ａｂ" }, "self", TODAY).nickname).toBe("Takma ad 3–32 karakter olmalıdır.");
  });
});

describe("gönderilen girdi sunucudaki normalleştirmeyle aynı biçimde", () => {
  it("takma ad NFKC + kırpma; metin alanları NFKC, kırpma ve boşluk sadeleştirme; e-posta NFKC + kırpma", () => {
    expect(normalizeNicknameInput("  ＡＬＩＣＥ  ")).toBe("ALICE");
    expect(normalizeTextInput("  Ａｙｓｅ \t  Nur ")).toBe("Ayse Nur");
    const input: RegistrationInput = buildRegistrationInput({
      ...base,
      nickname: " ａｌｉｃｅ ",
      firstName: "  Ayşe   Nur ",
      email: " ａ@ｂ.com ",
      il: "  Ankara ",
      acikAdres: "  Atatürk   Bulvarı  12 ",
      postaKodu: " 06420 ",
    });
    expect(input).toMatchObject({ nickname: "alice", firstName: "Ayşe Nur", email: "a@b.com" });
    expect(input.address).toEqual({ il: "Ankara", ilce: "Çankaya", mahalle: "Kızılay", acikAdres: "Atatürk Bulvarı 12", postaKodu: "06420" });
  });

  it("posta kodu boşsa adrese hiç eklenmez", () => {
    expect("postaKodu" in buildRegistrationInput({ ...base, postaKodu: "  " }).address).toBe(false);
  });
});

describe("hata iletileri (kullanıcıya gösterilen)", () => {
  const msg = (k: FieldKey, over: Partial<FormState>) => validate({ ...base, ...over }, "self", TODAY)[k];

  it("sınırlar adlarıyla söylenir", () => {
    expect(msg("firstName", { firstName: rep("a", 65) })).toBe("Ad en fazla 64 karakter olabilir.");
    expect(msg("il", { il: "A" })).toBe("İl en az 2 karakter olmalıdır.");
    expect(msg("mahalle", { mahalle: rep("m", 129) })).toBe("Mahalle en fazla 128 karakter olabilir.");
    expect(msg("acikAdres", { acikAdres: "" })).toBe("Açık adres zorunludur.");
    expect(msg("email", { email: `${rep("x", 250)}@b.co` })).toBe("E-posta adresi çok uzun.");
    expect(msg("email", { email: "a@b" })).toBe("Geçerli bir e-posta adresi girin.");
  });
});
