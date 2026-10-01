// Kayan nokta hatası olmadan oran karşılaştırmaları (ALGORITMA.md §4.5).
import type { Rational } from "./types";

export function gcd(a: number, b: number): number {
  a = Math.abs(a);
  b = Math.abs(b);
  while (b) [a, b] = [b, a % b];
  return a || 1;
}

export function rat(num: number, den: number): Rational {
  if (!Number.isInteger(num) || !Number.isInteger(den) || den <= 0) throw new Error(`Geçersiz rasyonel ${num}/${den}`);
  const g = gcd(num, den);
  return { num: num / g, den: den / g };
}

/** Ondalık değeri 1/10000 hassasiyetle rasyonele çevirir; 2/3, 1/3, 3/4 gibi değerleri tanır. */
export function toRational(x: number): Rational {
  if (!Number.isFinite(x) || x < 0) throw new Error(`toRational: geçersiz değer ${x}`);
  const known: [number, number][] = [
    [1, 3],
    [2, 3],
    [1, 6],
    [5, 6],
  ];
  for (const [n, d] of known) if (Math.abs(x - n / d) < 5e-4) return rat(n, d);
  return rat(Math.round(x * 10000), 10000);
}

export function ratToNumber(r: Rational): number {
  return r.num / r.den;
}

export function ratToPercent(r: Rational, digits = 1): string {
  return "%" + (ratToNumber(r) * 100).toFixed(digits).replace(".", ",");
}

/** part/whole > r  (whole = 0 ise false) */
export function fracGreater(part: number, whole: number, r: Rational): boolean {
  if (whole <= 0) return false;
  return part * r.den > r.num * whole;
}

/** part/whole ≥ r  (whole = 0 ise false) */
export function fracAtLeast(part: number, whole: number, r: Rational): boolean {
  if (whole <= 0) return false;
  return part * r.den >= r.num * whole;
}

export function ratMin(a: Rational, b: Rational): Rational {
  return a.num * b.den <= b.num * a.den ? a : b;
}

export function ratMax(a: Rational, b: Rational): Rational {
  return a.num * b.den >= b.num * a.den ? a : b;
}

export function ratAdd(a: Rational, b: Rational): Rational {
  return rat(a.num * b.den + b.num * a.den, a.den * b.den);
}

/** ⌈r · n⌉ tamsayı aritmetiğiyle (n ≥ 0). */
export function ceilMul(r: Rational, n: number): number {
  return Math.floor((r.num * n + r.den - 1) / r.den);
}
