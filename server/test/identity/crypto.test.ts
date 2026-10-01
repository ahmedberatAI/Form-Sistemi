import { describe, expect, it } from "vitest";
import { randomBytes } from "node:crypto";
import { sha256Hex } from "@forum/shared";
import { hashPassword, INVALID_PASSWORD_HASH, verifyPassword } from "../../src/identity/password";
import { createTokenSigner } from "../../src/identity/sessions";
import { createVault, normalizeHousehold, openField, sealField, VaultIntegrityError } from "../../src/identity/vault";

const MASTER = "11".repeat(32);

describe("kasa: alan bazında AES-256-GCM", () => {
  const dek = randomBytes(32);

  it("şifreler ve çözer; biçim v1:<iv>:<ct>:<tag>", () => {
    const s = sealField(dek, "u1", "tckn", 1, "12345678950");
    expect(s).toMatch(/^v1:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+:[A-Za-z0-9+/=]+$/);
    expect(s).not.toContain("12345678950");
    expect(openField(dek, "u1", "tckn", 1, s)).toBe("12345678950");
    expect(sealField(dek, "u1", "tckn", 1, "12345678950")).not.toBe(s); // rastgele IV
  });

  it("AAD (kullanıcı, alan, anahtar sürümü) değişince çözme başarısız olur", () => {
    const s = sealField(dek, "u1", "first_name", 1, "Ayşe");
    expect(() => openField(dek, "u2", "first_name", 1, s)).toThrow(VaultIntegrityError);
    expect(() => openField(dek, "u1", "last_name", 1, s)).toThrow(VaultIntegrityError);
    expect(() => openField(dek, "u1", "first_name", 2, s)).toThrow(VaultIntegrityError);
  });

  it("yanlış DEK ya da kurcalanmış şifreli metin reddedilir", () => {
    const s = sealField(dek, "u1", "email", 1, "a@b.co");
    expect(() => openField(randomBytes(32), "u1", "email", 1, s)).toThrow(VaultIntegrityError);
    const [v, iv, ct, tag] = s.split(":");
    const bad = Buffer.from(ct, "base64");
    bad[0] ^= 1;
    expect(() => openField(dek, "u1", "email", 1, [v, iv, bad.toString("base64"), tag].join(":"))).toThrow(VaultIntegrityError);
    expect(() => openField(dek, "u1", "email", 1, "v2:x:y:z")).toThrow(VaultIntegrityError);
  });

  it("DEK, ana anahtardan türetilen KEK ile sarılır ve kullanıcıya bağlıdır", () => {
    const vault = createVault(MASTER);
    const { dek: d, wrapped } = vault.newDek("u1");
    expect(wrapped.startsWith("v1:")).toBe(true);
    expect(vault.unwrapDek("u1", 1, wrapped).equals(d)).toBe(true);
    expect(() => vault.unwrapDek("u2", 1, wrapped)).toThrow(VaultIntegrityError);
    expect(() => createVault("22".repeat(32)).unwrapDek("u1", 1, wrapped)).toThrow(VaultIntegrityError);
  });

  it("geçersiz ana anahtar reddedilir", () => {
    expect(() => createVault("kisa")).toThrow(/MASTER_KEY/);
  });
});

describe("kör indeksler", () => {
  const vault = createVault(MASTER);

  it("anahtarlı ve belirlenimci; düz SHA-256 değil", () => {
    const a = vault.tcknIndex("10000000146");
    expect(a).toMatch(/^[0-9a-f]{64}$/);
    expect(vault.tcknIndex("10000000146")).toBe(a);
    expect(a).not.toBe(sha256Hex("10000000146"));
    expect(createVault("22".repeat(32)).tcknIndex("10000000146")).not.toBe(a);
  });

  it("e-posta NFKC + küçük harf + boşluk kırpma ile normalleştirilir", () => {
    expect(vault.emailIndex("  Ayse.Yilmaz@Ornek.COM ")).toBe(vault.emailIndex("ayse.yilmaz@ornek.com"));
  });

  it("hane indeksi yazım farklılıklarına dayanıklı, farklı adreste farklı", () => {
    const a = { il: "Ankara", ilce: "Çankaya", mahalle: "Kızılay Mahallesi", acikAdres: "Atatürk Bulvarı No: 12 Daire 4" };
    const b = { il: "ANKARA", ilce: "ÇANKAYA", mahalle: "Kızılay Mah.", acikAdres: "Atatürk Blv.  No 12 D:4" };
    expect(normalizeHousehold(a)).toBe(normalizeHousehold(b));
    expect(vault.householdIndex(a)).toBe(vault.householdIndex(b));
    expect(vault.householdIndex({ ...a, acikAdres: "Atatürk Bulvarı No: 14 Daire 4" })).not.toBe(vault.householdIndex(a));
  });

  it("memberRef takma ve anahtarlıdır", () => {
    const r = vault.memberRef("u1");
    expect(r).toMatch(/^[0-9a-f]{64}$/);
    expect(r).not.toContain("u1");
    expect(vault.memberRef("u1")).toBe(r);
    expect(vault.memberRef("u2")).not.toBe(r);
  });
});

describe("şifre özeti (scrypt)", () => {
  it("scrypt$N$r$p$tuz$özet biçiminde; doğru/yanlış şifre", async () => {
    const h = await hashPassword("Gizli1234");
    expect(h).toMatch(/^scrypt\$16384\$8\$1\$[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+$/);
    expect(await verifyPassword(h, "Gizli1234")).toBe(true);
    expect(await verifyPassword(h, "Gizli12345")).toBe(false);
    expect(await hashPassword("Gizli1234")).not.toBe(h);
  });

  it("geçersiz/imha edilmiş özet hiçbir şifreyle eşleşmez", async () => {
    expect(await verifyPassword(INVALID_PASSWORD_HASH, "Gizli1234")).toBe(false);
    expect(await verifyPassword("scrypt$3$8$1$AAAA$AAAA", "x")).toBe(false);
  });
});

describe("oturum belirteci", () => {
  const signer = createTokenSigner("22".repeat(32));

  it("imzalı belirteç doğrulanır; kurcalama reddedilir", () => {
    const id = signer.newSessionId();
    const t = signer.sign(id);
    expect(signer.verify(t)).toBe(id);
    const [sid, sig] = t.split(".");
    const flip = (s: string, i: number) => s.slice(0, i) + (s[i] === "A" ? "B" : "A") + s.slice(i + 1);
    expect(signer.verify(`${sid}.${flip(sig, 0)}`)).toBeNull();
    expect(signer.verify(`${sid}.${flip(sig, sig.length - 1)}`)).toBeNull();
    expect(signer.verify(`${flip(sid, 3)}.${sig}`)).toBeNull();
    expect(signer.verify(sid)).toBeNull();
    expect(signer.verify("")).toBeNull();
    expect(createTokenSigner("33".repeat(32)).verify(t)).toBeNull();
  });
});
