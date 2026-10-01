// Şifre özeti: node:crypto scrypt. Biçim: scrypt$N$r$p$saltB64$hashB64
import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from "node:crypto";

const N = 16384;
const R = 8;
const P = 1;
const KEY_LEN = 32;
const SALT_LEN = 16;

/** Silinmiş / reddedilmiş hesaplarda şifre alanı: hiçbir girdiyle eşleşmez. */
export const INVALID_PASSWORD_HASH = "!devre-disi";

function scryptAsync(pw: string, salt: Buffer, keyLen: number, opts: ScryptOptions): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    scrypt(pw.normalize("NFKC"), salt, keyLen, opts, (err, key) => (err ? reject(err) : resolve(key)));
  });
}

export async function hashPassword(pw: string): Promise<string> {
  const salt = randomBytes(SALT_LEN);
  const key = await scryptAsync(pw, salt, KEY_LEN, { N, r: R, p: P });
  return `scrypt$${N}$${R}$${P}$${salt.toString("base64")}$${key.toString("base64")}`;
}

const DUMMY_SALT = Buffer.alloc(SALT_LEN, 7);

/** Hesap bulunmasa bile aynı sürede yanıt vermek için sahte doğrulama. */
export async function dummyVerify(pw: string): Promise<false> {
  await scryptAsync(pw, DUMMY_SALT, KEY_LEN, { N, r: R, p: P });
  return false;
}

export async function verifyPassword(stored: string, pw: string): Promise<boolean> {
  const parts = stored.split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return dummyVerify(pw);
  const n = Number(parts[1]);
  const r = Number(parts[2]);
  const p = Number(parts[3]);
  const powerOfTwo = Number.isInteger(n) && n > 1 && (n & (n - 1)) === 0;
  if (!powerOfTwo || n > 1 << 20 || !Number.isInteger(r) || r < 1 || r > 32 || !Number.isInteger(p) || p < 1 || p > 16) {
    return dummyVerify(pw);
  }
  const salt = Buffer.from(parts[4], "base64");
  const expected = Buffer.from(parts[5], "base64");
  if (expected.length < 16) return dummyVerify(pw);
  const key = await scryptAsync(pw, salt, expected.length, { N: n, r, p, maxmem: 256 * n * r + 1024 * 1024 });
  return timingSafeEqual(key, expected);
}
