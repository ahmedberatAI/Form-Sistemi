import { describe, expect, it } from "vitest";
import { createRng } from "@forum/shared";
import type { VoteMatrixEntry } from "../../src/core/contracts";
import { CLUSTER_ALGO, computeClusters, createGovernanceMath } from "../../src/governance";
import { selectPartition } from "../../src/governance/clustering";

const uid = (i: number) => `u${String(i).padStart(3, "0")}`;
const pid = (j: number) => `p${String(j).padStart(2, "0")}`;
/** Walsh örüntüleri: blok b, öneri p'de (p >> b) & 1 = 0 ise "evet"; bloklar çifter çifter %50 uyuşur. */
const walsh = (b: number, p: number): 1 | -1 => (((p >> b) & 1) === 0 ? 1 : -1);

function blockHistory(blocks: number[], opts: { proposals?: number; flip?: number; participation?: number; seed?: string } = {}) {
  const { proposals = 32, flip = 0.1, participation = 0.75, seed = "tarih" } = opts;
  const rng = createRng(seed);
  const entries: VoteMatrixEntry[] = [];
  const blockOf: Record<string, number> = {};
  let u = 0;
  blocks.forEach((size, b) => {
    for (let i = 0; i < size; i++, u++) {
      blockOf[uid(u)] = b;
      for (let p = 0; p < proposals; p++) {
        if (rng.next() >= participation) continue;
        const s = walsh(b, p);
        entries.push({ userId: uid(u), proposalId: pid(p), value: rng.next() < flip ? (-s as 1 | -1) : s });
      }
    }
  });
  return { entries, blockOf };
}

describe("computeClusters (§9)", () => {
  const { entries, blockOf } = blockHistory([60, 30, 10]);

  it("60/30/10 bloklu oy geçmişinde K=3; bloklar eksiksiz ayrılır ve büyüklüğe göre g0/g1/g2", () => {
    const r = computeClusters(entries, "tohum-1");
    expect(r.algo).toBe(CLUSTER_ALGO);
    expect(r.k).toBe(3);
    expect(r.silhouette).toBeGreaterThan(0.5);
    expect(r.sizes).toEqual({ g0: 60, g1: 30, g2: 10 });
    expect(r.clusteredTotal).toBe(100);
    expect(r.excluded).toEqual([]);
    const blockToCluster = new Map<number, Set<string>>();
    for (const [u, g] of Object.entries(r.assignments)) {
      const b = blockOf[u];
      if (!blockToCluster.has(b)) blockToCluster.set(b, new Set());
      blockToCluster.get(b)!.add(g);
    }
    expect([...blockToCluster.get(0)!]).toEqual(["g0"]);
    expect([...blockToCluster.get(1)!]).toEqual(["g1"]);
    expect([...blockToCluster.get(2)!]).toEqual(["g2"]);
    expect(Object.keys(r.coords)).toHaveLength(100);
    for (const c of Object.values(r.coords)) expect(c.every(Number.isFinite)).toBe(true);
  });

  it("belirlenimci: aynı tohum → birebir aynı çıktı (outputHash dahil)", () => {
    const a = computeClusters(entries, "tohum-1");
    const b = computeClusters(entries, "tohum-1");
    expect(b).toEqual(a);
    expect(b.outputHash).toBe(a.outputHash);
    expect(a.seed).toBe("tohum-1");
  });

  it("farklı tohumlar kararlı veride aynı bölümlemeyi verir; inputHash tohumdan bağımsız", () => {
    const ref = computeClusters(entries, "tohum-1");
    for (const seed of ["a", "b", "c", "0000", "son-blok-hash|cluster|1759312800000"]) {
      const r = computeClusters(entries, seed);
      expect(r.k, seed).toBe(3);
      expect(r.assignments, seed).toEqual(ref.assignments);
      expect(r.inputHash, seed).toBe(ref.inputHash);
    }
  });

  it("girdi sırası sonucu değiştirmez (satır/sütun sırası kimliklerle sabit)", () => {
    const shuffled = createRng("karıştır").shuffle(entries);
    const a = computeClusters(entries, "s");
    const b = computeClusters(shuffled, "s");
    expect(b.inputHash).toBe(a.inputHash);
    expect(b.outputHash).toBe(a.outputHash);
  });

  it("az oylu kullanıcılar dışlanır (varsayılan min(7, sütun)); minVotes seçeneği uygulanır", () => {
    const extra: VoteMatrixEntry[] = [];
    for (let i = 0; i < 4; i++) for (let p = 0; p < 6; p++) extra.push({ userId: `yeni${i}`, proposalId: pid(p), value: walsh(0, p) });
    const r = computeClusters([...entries, ...extra], "s");
    expect(r.excluded).toEqual(["yeni0", "yeni1", "yeni2", "yeni3"]);
    expect(r.clusteredTotal).toBe(100);
    expect(r.assignments["yeni0"]).toBeUndefined();
    expect(r.coords["yeni0"]).toBeUndefined();
    const loose = computeClusters([...entries, ...extra], "s", { minVotes: 6 });
    expect(loose.excluded).toEqual([]);
    expect(loose.clusteredTotal).toBe(104);
    expect(loose.inputHash).not.toBe(r.inputHash);
  });

  it("sütun sayısı 7'den azsa eşik sütun sayısıdır", () => {
    const e: VoteMatrixEntry[] = [];
    for (let i = 0; i < 6; i++) for (let p = 0; p < 3; p++) if (!(i === 5 && p === 2)) e.push({ userId: uid(i), proposalId: pid(p), value: 1 });
    const r = computeClusters(e, "s");
    expect(r.excluded).toEqual([uid(5)]);
    expect(r.clusteredTotal).toBe(5);
  });

  it("homojen veri (herkes aynı görüşte, katılımı farklı) → K=1, tek küme g0", () => {
    const e: VoteMatrixEntry[] = [];
    const rng = createRng("homojen");
    for (let i = 0; i < 50; i++) for (let p = 0; p < 20; p++) if (rng.next() < 0.7) e.push({ userId: uid(i), proposalId: pid(p), value: walsh(1, p) });
    const r = computeClusters(e, "s");
    expect(r.k).toBe(1);
    expect(r.sizes).toEqual({ g0: r.clusteredTotal });
    expect(new Set(Object.values(r.assignments))).toEqual(new Set(["g0"]));
  });

  it("yapısız küçük veri: en iyi siluet < 0,25 → K=1 (kare köşeleri, siluet ≈ 0,17)", () => {
    const corners: [number, number][] = [[1, 1], [1, -1], [-1, 1], [-1, -1]];
    const e: VoteMatrixEntry[] = corners.flatMap(([a, b], i) => [
      { userId: uid(i), proposalId: "p0", value: a as 1 | -1 },
      { userId: uid(i), proposalId: "p1", value: b as 1 | -1 },
    ]);
    const r = computeClusters(e, "s");
    expect(r.k).toBe(1);
    expect(r.silhouette).toBeCloseTo((Math.SQRT2 + 1 - 2) / (Math.SQRT2 + 1), 5); // K=2 denemesinin değeri
    expect(r.sizes).toEqual({ g0: 4 });
  });

  it("n < 4 → K=1; boş girdi", () => {
    const e: VoteMatrixEntry[] = [
      { userId: "a", proposalId: "p", value: 1 },
      { userId: "b", proposalId: "p", value: -1 },
      { userId: "c", proposalId: "p", value: 0 },
    ];
    const r = computeClusters(e, "s");
    expect(r.k).toBe(1);
    expect(r.silhouette).toBe(0);
    expect(r.sizes).toEqual({ g0: 3 });
    const empty = computeClusters([], "s");
    expect(empty).toMatchObject({ k: 0, clusteredTotal: 0, assignments: {}, sizes: {}, excluded: [] });
  });

  it("K_max seçeneği: kMax=2 ile iki küme", () => {
    const r = computeClusters(entries, "s", { kMax: 2 });
    expect(r.k).toBe(2);
    expect(r.sizes.g0 + r.sizes.g1).toBe(100);
  });

  it("yinelenen (kullanıcı, öneri) girdisi ortalanır; geçersiz değer hata verir", () => {
    const dup = [...entries, { ...entries[0] }];
    expect(computeClusters(dup, "s").k).toBe(3);
    expect(() => computeClusters([{ userId: "a", proposalId: "p", value: 2 as never }], "s")).toThrow(/geçersiz oy değeri/);
  });

  it("selectPartition: özdeş noktalar → K=1; iki uzak öbek → K=2", () => {
    expect(selectPartition(Array.from({ length: 10 }, () => [0, 0] as [number, number]), "s", 5).k).toBe(1);
    const two = [...Array.from({ length: 10 }, (_, i) => [i * 0.01, 0] as [number, number]), ...Array.from({ length: 10 }, (_, i) => [5 + i * 0.01, 0] as [number, number])];
    const r = selectPartition(two, "s", 5);
    expect(r.k).toBe(2);
    expect(r.silhouette).toBeGreaterThan(0.9);
  });

  it("createGovernanceMath arayüzü aynı fonksiyonları sunar", () => {
    const math = createGovernanceMath();
    expect(math.computeClusters(entries, "tohum-1").outputHash).toBe(computeClusters(entries, "tohum-1").outputHash);
  });
});

describe("drawWeighted (§8 kura)", () => {
  const cands = [
    { id: "c", weight: 1 },
    { id: "a", weight: 1.5 },
    { id: "b", weight: 0.5 },
    { id: "d", weight: 0 },
    { id: "e", weight: 1 },
  ];
  const math = createGovernanceMath();

  it("aynı tohum → aynı seçim; aday sırası önemsiz; ağırlığı 0 olan seçilmez", () => {
    const a = math.drawWeighted(cands, 3, "blok|öneri|1");
    const b = math.drawWeighted(cands.slice().reverse(), 3, "blok|öneri|1");
    expect(a.map((c) => c.id)).toEqual(b.map((c) => c.id));
    expect(a).toHaveLength(3);
    expect(a.some((c) => c.id === "d")).toBe(false);
    expect(new Set(a.map((c) => c.id)).size).toBe(3);
  });

  it("aday azsa hepsi (pozitif ağırlıklılar) alınır", () => {
    expect(math.drawWeighted(cands, 10, "x").map((c) => c.id).sort()).toEqual(["a", "b", "c", "e"]);
    expect(math.drawWeighted([], 3, "x")).toEqual([]);
  });

  it("ağırlıklar seçim sıklığına yansır", () => {
    const counts: Record<string, number> = {};
    for (let i = 0; i < 2000; i++) {
      const [first] = math.drawWeighted(cands, 1, `t${i}`);
      counts[first.id] = (counts[first.id] ?? 0) + 1;
    }
    expect(counts.a).toBeGreaterThan(counts.c);
    expect(counts.c).toBeGreaterThan(counts.b);
    expect(counts.d).toBeUndefined();
  });
});
