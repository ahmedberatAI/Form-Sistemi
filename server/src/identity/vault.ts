// Kimlik kasası kriptografisi: alan bazında AES-256-GCM, kullanıcıya özel DEK, HKDF ile türetilen anahtarlar,
// HMAC kör indeksler. Ana anahtar (MASTER_KEY) yalnızca bellekte tutulur; veritabanına hiçbir anahtar düz yazılmaz.
import { createCipheriv, createDecipheriv, createHmac, hkdfSync, randomBytes } from "node:crypto";
import type { AddressInput } from "@forum/shared";

/** Kasada şifreli tutulan alanlar (identity_vault.enc_<ad>) */
export const VAULT_FIELDS = ["first_name", "last_name", "tckn", "birth_date", "email", "phone", "address"] as const;
export type VaultField = (typeof VAULT_FIELDS)[number];

export const CURRENT_KEY_VERSION = 1;
const FORMAT = "v1";
const HKDF_SALT = Buffer.from("forum-sistemi/kimlik-kasasi/v1", "utf8");
const IV_LEN = 12;
const TAG_LEN = 16;

/** Bütünlük denetimi başarısız (yanlış anahtar, değiştirilmiş şifreli metin ya da AAD uyuşmazlığı). */
export class VaultIntegrityError extends Error {
  constructor(msg = "Kimlik kasası bütünlük denetimi başarısız.") {
    super(msg);
    this.name = "VaultIntegrityError";
  }
}

export function hkdf(ikm: Buffer, info: string, length = 32): Buffer {
  return Buffer.from(hkdfSync("sha256", ikm, HKDF_SALT, Buffer.from(info, "utf8"), length));
}

export function fieldAad(userId: string, field: string, keyVersion: number): Buffer {
  return Buffer.from(`${userId}|${field}|v${keyVersion}`, "utf8");
}

/** AES-256-GCM; çıktı biçimi `v1:<iv b64>:<ct b64>:<tag b64>` */
export function aesGcmSeal(key: Buffer, plaintext: Buffer, aad: Buffer): string {
  const iv = randomBytes(IV_LEN);
  const c = createCipheriv("aes-256-gcm", key, iv, { authTagLength: TAG_LEN });
  c.setAAD(aad);
  const ct = Buffer.concat([c.update(plaintext), c.final()]);
  const tag = c.getAuthTag();
  return `${FORMAT}:${iv.toString("base64")}:${ct.toString("base64")}:${tag.toString("base64")}`;
}

export function aesGcmOpen(key: Buffer, sealed: string, aad: Buffer): Buffer {
  const parts = sealed.split(":");
  if (parts.length !== 4 || parts[0] !== FORMAT) throw new VaultIntegrityError("Şifreli alan biçimi tanınmadı.");
  const iv = Buffer.from(parts[1], "base64");
  const ct = Buffer.from(parts[2], "base64");
  const tag = Buffer.from(parts[3], "base64");
  if (iv.length !== IV_LEN || tag.length !== TAG_LEN) throw new VaultIntegrityError("Şifreli alan biçimi tanınmadı.");
  try {
    const d = createDecipheriv("aes-256-gcm", key, iv, { authTagLength: TAG_LEN });
    d.setAAD(aad);
    d.setAuthTag(tag);
    return Buffer.concat([d.update(ct), d.final()]);
  } catch {
    throw new VaultIntegrityError();
  }
}

/** Alan anahtarı = HKDF(DEK, "alan:<ad>") */
export function sealField(dek: Buffer, userId: string, field: VaultField, keyVersion: number, plaintext: string): string {
  const key = hkdf(dek, `alan:${field}`);
  try {
    return aesGcmSeal(key, Buffer.from(plaintext, "utf8"), fieldAad(userId, field, keyVersion));
  } finally {
    key.fill(0);
  }
}

export function openField(dek: Buffer, userId: string, field: VaultField, keyVersion: number, sealed: string): string {
  const key = hkdf(dek, `alan:${field}`);
  try {
    return aesGcmOpen(key, sealed, fieldAad(userId, field, keyVersion)).toString("utf8");
  } finally {
    key.fill(0);
  }
}

// ───────────── Normalleştirme ─────────────

export function normalizeEmail(email: string): string {
  return email.normalize("NFKC").trim().toLowerCase();
}

export function tcknDigits(tckn: string): string {
  return tckn.replace(/\D/g, "");
}

const ADDRESS_ABBREV: Record<string, string> = {
  mah: "mahalle",
  mh: "mahalle",
  mahallesi: "mahalle",
  cad: "cadde",
  cd: "cadde",
  caddesi: "cadde",
  sok: "sokak",
  sk: "sokak",
  sokağı: "sokak",
  bulv: "bulvar",
  blv: "bulvar",
  bulvarı: "bulvar",
  apt: "apartman",
  apartmanı: "apartman",
  sit: "site",
  sitesi: "site",
  no: "no",
  numara: "no",
  nu: "no",
  d: "daire",
  daire: "daire",
  k: "kat",
};

function normalizeAddressPart(s: string): string {
  return s
    .normalize("NFKC")
    .toLocaleLowerCase("tr-TR")
    .replace(/[.,;:/\\#'"()\-–—_]+/g, " ")
    .replace(/(\d)([^\d\s])/gu, "$1 $2")
    .replace(/([^\d\s])(\d)/gu, "$1 $2")
    .split(/\s+/)
    .filter(Boolean)
    .map((w) => ADDRESS_ABBREV[w] ?? w)
    .join(" ");
}

/** Hane kör indeksinin girdisi: il|ilçe|mahalle|açık adres (posta kodu hariç) */
export function normalizeHousehold(a: Pick<AddressInput, "il" | "ilce" | "mahalle" | "acikAdres">): string {
  return [a.il, a.ilce, a.mahalle, a.acikAdres].map(normalizeAddressPart).join("|");
}

// ───────────── Anahtar hiyerarşisi ─────────────

export interface Vault {
  /** Yeni rastgele DEK üretir ve ana anahtardan türetilen KEK ile sarar. */
  newDek(userId: string, keyVersion?: number): { dek: Buffer; wrapped: string };
  unwrapDek(userId: string, keyVersion: number, wrapped: string): Buffer;
  blindIndex(kind: "tckn" | "email" | "household", normalized: string): string;
  tcknIndex(tckn: string): string;
  emailIndex(email: string): string;
  householdIndex(address: Pick<AddressInput, "il" | "ilce" | "mahalle" | "acikAdres">): string;
  /** Defterde kullanılan takma kimlik: HMAC(HKDF(master,"member-ref"), userId) hex — kişisel veri içermez. */
  memberRef(userId: string): string;
}

export function parseMasterKey(hex: string): Buffer {
  if (typeof hex !== "string" || !/^[0-9a-fA-F]{64,}$/.test(hex) || hex.length % 2 !== 0) {
    throw new Error("Kimlik kasası ana anahtarı (MASTER_KEY) en az 32 baytlık onaltılık (hex) dize olmalıdır.");
  }
  return Buffer.from(hex, "hex");
}

export function createVault(masterKeyHex: string): Vault {
  const master = parseMasterKey(masterKeyHex);
  const keks = new Map<number, Buffer>();
  const kek = (v: number): Buffer => {
    let k = keks.get(v);
    if (!k) {
      k = hkdf(master, `kek:v${v}`);
      keks.set(v, k);
    }
    return k;
  };
  const bidxKeys = {
    tckn: hkdf(master, "bidx:tckn"),
    email: hkdf(master, "bidx:email"),
    household: hkdf(master, "bidx:household"),
  };
  const memberRefKey = hkdf(master, "member-ref");
  const hmacHex = (key: Buffer, data: string) => createHmac("sha256", key).update(data, "utf8").digest("hex");

  const vault: Vault = {
    newDek(userId, keyVersion = CURRENT_KEY_VERSION) {
      const dek = randomBytes(32);
      const wrapped = aesGcmSeal(kek(keyVersion), dek, fieldAad(userId, "dek", keyVersion));
      return { dek, wrapped };
    },
    unwrapDek(userId, keyVersion, wrapped) {
      const dek = aesGcmOpen(kek(keyVersion), wrapped, fieldAad(userId, "dek", keyVersion));
      if (dek.length !== 32) throw new VaultIntegrityError();
      return dek;
    },
    blindIndex(kind, normalized) {
      return hmacHex(bidxKeys[kind], normalized);
    },
    tcknIndex: (tckn) => vault.blindIndex("tckn", tcknDigits(tckn)),
    emailIndex: (email) => vault.blindIndex("email", normalizeEmail(email)),
    householdIndex: (address) => vault.blindIndex("household", normalizeHousehold(address)),
    memberRef: (userId) => hmacHex(memberRefKey, userId),
  };
  return vault;
}
