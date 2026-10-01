// Oturum belirteçleri: <sessionId>.<HMAC-SHA256(tokenKey, sessionId) base64url>
// Veritabanında yalnızca sessionId tutulur; imza anahtarı olmadan geçerli belirteç üretilemez.
import { createHmac, randomBytes, timingSafeEqual } from "node:crypto";

/** 180 gün (simüle saat). Demo kipinde saat TIME_SCALE kat hızlı akar (60 → yaklaşık 3 gerçek gün). */
export const SESSION_TTL_MS = 180 * 24 * 3_600_000;

export function keyBytes(k: string): Buffer {
  return /^[0-9a-fA-F]+$/.test(k) && k.length >= 32 && k.length % 2 === 0 ? Buffer.from(k, "hex") : Buffer.from(k, "utf8");
}

export interface TokenSigner {
  newSessionId(): string;
  sign(sessionId: string): string;
  /** İmza geçerliyse sessionId, değilse null. */
  verify(token: string): string | null;
}

export function createTokenSigner(tokenKey: string): TokenSigner {
  const key = keyBytes(tokenKey);
  if (key.length < 16) throw new Error("Oturum imza anahtarı (TOKEN_KEY) en az 16 bayt olmalıdır.");
  const mac = (id: string) => createHmac("sha256", key).update(`oturum:${id}`, "utf8").digest("base64url");
  return {
    newSessionId: () => randomBytes(32).toString("base64url"),
    sign: (id) => `${id}.${mac(id)}`,
    verify(token) {
      if (typeof token !== "string" || token.length > 512) return null;
      const dot = token.lastIndexOf(".");
      if (dot <= 0) return null;
      const id = token.slice(0, dot);
      if (!/^[A-Za-z0-9_-]+$/.test(id)) return null;
      // base64url dizesi olduğu gibi karşılaştırılır (dolgu bitlerindeki oynamalar da reddedilir).
      const given = Buffer.from(token.slice(dot + 1), "utf8");
      const expected = Buffer.from(mac(id), "utf8");
      if (given.length !== expected.length || !timingSafeEqual(given, expected)) return null;
      return id;
    },
  };
}
