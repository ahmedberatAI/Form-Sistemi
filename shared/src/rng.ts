// Tohumlu, belirlenimci sözde rastgele sayı üreteci (xoshiro128**).
// Aynı tohum → aynı dizi; sunucu, doğrulayıcılar ve tarayıcı aynı çekilişi yeniden üretebilir.
import { sha256 } from "@noble/hashes/sha2.js";
import { utf8ToBytes } from "@noble/hashes/utils.js";

export interface Rng {
  /** [0, 1) aralığında sayı */
  next(): number;
  nextUint32(): number;
  /** [0, n) aralığında tamsayı */
  int(n: number): number;
  shuffle<T>(arr: T[]): T[];
}

export function createRng(seed: string): Rng {
  const h = sha256(utf8ToBytes(seed));
  const view = new DataView(h.buffer, h.byteOffset, h.byteLength);
  let s0 = view.getUint32(0) >>> 0;
  let s1 = view.getUint32(4) >>> 0;
  let s2 = view.getUint32(8) >>> 0;
  let s3 = view.getUint32(12) >>> 0;
  if ((s0 | s1 | s2 | s3) === 0) s0 = 1;
  const rotl = (x: number, k: number) => ((x << k) | (x >>> (32 - k))) >>> 0;
  const nextUint32 = () => {
    const result = (rotl(Math.imul(s1, 5) >>> 0, 7) * 9) >>> 0;
    const t = (s1 << 9) >>> 0;
    s2 ^= s0;
    s3 ^= s1;
    s1 ^= s2;
    s0 ^= s3;
    s2 ^= t;
    s3 = rotl(s3, 11);
    s0 >>>= 0;
    s1 >>>= 0;
    s2 >>>= 0;
    return Math.imul(result, 1) >>> 0;
  };
  const next = () => nextUint32() / 4294967296;
  const int = (n: number) => {
    if (n <= 0) throw new Error("int: n > 0 olmalı");
    return Math.floor(next() * n);
  };
  const shuffle = <T>(arr: T[]): T[] => {
    const a = arr.slice();
    for (let i = a.length - 1; i > 0; i--) {
      const j = int(i + 1);
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  };
  return { next, nextUint32, int, shuffle };
}

/**
 * Ağırlıklı, yerine koymadan örnekleme (Efraimidis–Spirakis A-Res).
 * Belirlenimcilik için girdiler çağırandan önce kimliğe göre SIRALANMIŞ olmalıdır.
 * Ağırlığı ≤ 0 olan öğe seçilmez.
 */
export function weightedSampleWithoutReplacement<T>(items: T[], weights: number[], k: number, rng: Rng): T[] {
  const keyed: { item: T; key: number; idx: number }[] = [];
  items.forEach((item, idx) => {
    const w = weights[idx];
    if (!(w > 0)) return;
    const u = Math.max(rng.next(), Number.MIN_VALUE);
    keyed.push({ item, key: Math.log(u) / w, idx });
  });
  keyed.sort((a, b) => b.key - a.key || a.idx - b.idx);
  return keyed.slice(0, Math.max(0, k)).map((x) => x.item);
}
