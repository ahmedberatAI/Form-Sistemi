import { describe, it, expect } from "vitest";
import {
  merkleRoot, merkleProof, verifyMerklePath, sha256Hex, canonicalJson,
  isValidTckn, generateTckn, maskTckn, ageOn, createRng, weightedSampleWithoutReplacement,
  toRational, fracAtLeast, fracGreater, ceilMul, rat,
} from "@forum/shared";

describe("shared/crypto", () => {
  it("merkle kanıtı her boyut ve indeks için doğrulanır", () => {
    for (let n = 1; n <= 17; n++) {
      const txs = Array.from({ length: n }, (_, i) => sha256Hex("tx" + i));
      const root = merkleRoot(txs);
      for (let i = 0; i < n; i++) {
        const path = merkleProof(txs, i);
        expect(verifyMerklePath(txs[i], path, root)).toBe(true);
        expect(verifyMerklePath(sha256Hex("sahte"), path, root)).toBe(false);
      }
    }
  });
  it("kanonik JSON anahtar sırasından bağımsızdır", () => {
    expect(canonicalJson({ b: 1, a: [2, { d: 1, c: 2 }] })).toBe(canonicalJson({ a: [2, { c: 2, d: 1 }], b: 1 }));
    expect(canonicalJson({ a: undefined, b: null })).toBe('{"b":null}');
  });
});

describe("shared/tckn", () => {
  it("bilinen geçerli/geçersiz numaralar", () => {
    expect(isValidTckn("10000000146")).toBe(true);
    expect(isValidTckn("10000000147")).toBe(false);
    expect(isValidTckn("01234567890")).toBe(false);
    for (const s of ["123456789", "987654321", "555555555"]) expect(isValidTckn(generateTckn(s))).toBe(true);
    expect(maskTckn("10000000146")).toBe("100******46");
  });
  it("yaş hesabı", () => {
    const at = Date.UTC(2026, 9, 1);
    expect(ageOn("2008-10-01", at)).toBe(18);
    expect(ageOn("2008-10-02", at)).toBe(17);
  });
});

describe("shared/rng & rational", () => {
  it("aynı tohum aynı diziyi üretir", () => {
    const a = createRng("tohum"), b = createRng("tohum");
    for (let i = 0; i < 100; i++) expect(a.next()).toBe(b.next());
    const c = createRng("baska");
    expect(createRng("tohum").next()).not.toBe(c.next());
  });
  it("ağırlıklı örnekleme belirlenimci ve sıfır ağırlığı seçmez", () => {
    const items = ["a", "b", "c", "d", "e"];
    const w = [1, 0, 2, 1, 0.5];
    const s1 = weightedSampleWithoutReplacement(items, w, 3, createRng("x"));
    const s2 = weightedSampleWithoutReplacement(items, w, 3, createRng("x"));
    expect(s1).toEqual(s2);
    expect(s1).not.toContain("b");
    expect(new Set(s1).size).toBe(3);
  });
  it("rasyonel karşılaştırmalar", () => {
    expect(toRational(2 / 3)).toEqual(rat(2, 3));
    expect(toRational(0.6)).toEqual(rat(3, 5));
    expect(fracGreater(5, 10, rat(1, 2))).toBe(false);
    expect(fracAtLeast(5, 10, rat(1, 2))).toBe(true);
    expect(fracAtLeast(2, 3, rat(2, 3))).toBe(true);
    expect(ceilMul(rat(1, 5), 40)).toBe(8);
    expect(ceilMul(rat(1, 5), 41)).toBe(9);
  });
});
