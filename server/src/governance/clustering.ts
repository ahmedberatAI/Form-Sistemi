// ALGORITMA.md §9: Polis benzeri görüş kümeleme — PCA (2 bileşen, kuvvet yinelemesi) + k-means++/Lloyd + siluet.
// SAF ve BELİRLENİMCİ: tüm rastgelelik tohumlu (createRng), satır/sütun sırası kimliklere göre sabit,
// kayan nokta toplamları her zaman aynı sırada yapılır.
import { createRng, hashCanonical, type Rng } from "@forum/shared";
import type { ClusterComputation, VoteMatrixEntry } from "../core/contracts";

export const CLUSTER_ALGO = "pca2-kmeans-silhouette/1";
const PCA_ITERATIONS = 100;
const LLOYD_ITERATIONS = 100;
const KMEANS_RESTARTS = 10;
const MIN_SILHOUETTE = 0.25;
const MIN_USERS_FOR_SPLIT = 4;
const EPS = 1e-12;

export type Point = [number, number];

function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function round6(x: number): number {
  const r = Math.round(x * 1e6) / 1e6;
  return r === 0 ? 0 : r;
}

function dot(a: Float64Array, b: Float64Array): number {
  let s = 0;
  for (let j = 0; j < a.length; j++) s += a[j] * b[j];
  return s;
}

function normalize(v: Float64Array): boolean {
  const norm = Math.sqrt(dot(v, v));
  if (!(norm > EPS)) return false;
  for (let j = 0; j < v.length; j++) v[j] /= norm;
  return true;
}

/** İşaret kanonikleştirme: mutlak değeri en büyük bileşen (eşitlikte ilk) pozitif olur. */
function canonicalSign(v: Float64Array): void {
  let idx = 0;
  for (let j = 1; j < v.length; j++) if (Math.abs(v[j]) > Math.abs(v[idx])) idx = j;
  if (v.length > 0 && v[idx] < 0) for (let j = 0; j < v.length; j++) v[j] = -v[j];
}

/** XᵀX'in baskın özvektörü (kuvvet yinelemesi). Matris sıfırsa sıfır vektör döner. */
function powerIteration(X: Float64Array[], m: number, rng: Rng): Float64Array {
  let v = new Float64Array(m);
  for (let j = 0; j < m; j++) v[j] = rng.next() - 0.5;
  if (!normalize(v)) {
    if (m === 0) return v;
    v[0] = 1;
  }
  const xv = new Float64Array(X.length);
  for (let it = 0; it < PCA_ITERATIONS; it++) {
    for (let i = 0; i < X.length; i++) xv[i] = dot(X[i], v);
    const w = new Float64Array(m);
    for (let i = 0; i < X.length; i++) {
      const row = X[i];
      const s = xv[i];
      for (let j = 0; j < m; j++) w[j] += row[j] * s;
    }
    if (!normalize(w)) return new Float64Array(m);
    v = w;
  }
  canonicalSign(v);
  return v;
}

function dist2(a: Point, b: Point): number {
  const dx = a[0] - b[0];
  const dy = a[1] - b[1];
  return dx * dx + dy * dy;
}

/** k-means++ başlangıcı + Lloyd. Eşitlikte en küçük merkez indeksi seçilir; boş küme eski merkezini korur. */
function kmeansOnce(points: Point[], K: number, rng: Rng): { labels: Int32Array; inertia: number } {
  const n = points.length;
  const centers: Point[] = [];
  const chosen = new Set<number>();
  const first = rng.int(n);
  centers.push([points[first][0], points[first][1]]);
  chosen.add(first);
  const d2 = new Float64Array(n);
  for (let i = 0; i < n; i++) d2[i] = dist2(points[i], centers[0]);
  while (centers.length < K) {
    let total = 0;
    for (let i = 0; i < n; i++) total += d2[i];
    let pick = -1;
    if (total > 0) {
      const r = rng.next() * total;
      let acc = 0;
      for (let i = 0; i < n; i++) {
        if (d2[i] <= 0) continue;
        acc += d2[i];
        if (acc > r) {
          pick = i;
          break;
        }
      }
      if (pick < 0) for (let i = n - 1; i >= 0; i--) if (d2[i] > 0) { pick = i; break; }
    }
    if (pick < 0) for (let i = 0; i < n; i++) if (!chosen.has(i)) { pick = i; break; }
    if (pick < 0) break;
    chosen.add(pick);
    const c: Point = [points[pick][0], points[pick][1]];
    centers.push(c);
    for (let i = 0; i < n; i++) d2[i] = Math.min(d2[i], dist2(points[i], c));
  }

  const labels = new Int32Array(n).fill(-1);
  for (let it = 0; it < LLOYD_ITERATIONS; it++) {
    let changed = false;
    for (let i = 0; i < n; i++) {
      let best = 0;
      let bestD = dist2(points[i], centers[0]);
      for (let c = 1; c < centers.length; c++) {
        const d = dist2(points[i], centers[c]);
        if (d < bestD) {
          bestD = d;
          best = c;
        }
      }
      if (labels[i] !== best) {
        labels[i] = best;
        changed = true;
      }
    }
    if (!changed) break;
    const sx = new Float64Array(centers.length);
    const sy = new Float64Array(centers.length);
    const cnt = new Int32Array(centers.length);
    for (let i = 0; i < n; i++) {
      sx[labels[i]] += points[i][0];
      sy[labels[i]] += points[i][1];
      cnt[labels[i]]++;
    }
    for (let c = 0; c < centers.length; c++) if (cnt[c] > 0) centers[c] = [sx[c] / cnt[c], sy[c] / cnt[c]];
  }
  let inertia = 0;
  for (let i = 0; i < n; i++) inertia += dist2(points[i], centers[labels[i]]);
  return { labels, inertia };
}

/**
 * §9.4 yorumu: tek bir k-means++ başlangıcı farklı tohumlarda farklı yerel en iyilere takılabildiği için
 * aynı tohumdan türetilen 10 başlangıç denenir; en düşük atalet (eşitlikte ilk) seçilir.
 */
function kmeans(points: Point[], K: number, seed: string): Int32Array {
  let best: { labels: Int32Array; inertia: number } | null = null;
  for (let r = 0; r < KMEANS_RESTARTS; r++) {
    const run = kmeansOnce(points, K, createRng(`${seed}|kmeans|${K}|${r}`));
    if (!best || run.inertia < best.inertia) best = run;
  }
  return best!.labels;
}

/** Ortalama siluet (Öklid). Tek elemanlı kümedeki nokta için s = 0. */
function meanSilhouette(points: Point[], labels: Int32Array, K: number): number {
  const n = points.length;
  const sizes = new Int32Array(K);
  for (let i = 0; i < n; i++) sizes[labels[i]]++;
  const sums = new Float64Array(K);
  let total = 0;
  for (let i = 0; i < n; i++) {
    sums.fill(0);
    for (let j = 0; j < n; j++) {
      if (i === j) continue;
      sums[labels[j]] += Math.sqrt(dist2(points[i], points[j]));
    }
    const own = labels[i];
    if (sizes[own] <= 1) continue;
    const a = sums[own] / (sizes[own] - 1);
    let b = Infinity;
    for (let c = 0; c < K; c++) if (c !== own && sizes[c] > 0) b = Math.min(b, sums[c] / sizes[c]);
    if (!Number.isFinite(b)) continue;
    const mx = Math.max(a, b);
    if (mx > 0) total += (b - a) / mx;
  }
  return n > 0 ? total / n : 0;
}

function nonEmpty(labels: Int32Array, K: number): number {
  const seen = new Set<number>();
  for (const l of labels) seen.add(l);
  return Math.min(seen.size, K);
}

/**
 * §9.4: K ∈ 2..min(kMax, n−1) için k-means; en yüksek ortalama siluet (eşitlikte küçük K).
 * n < 4 ya da en iyi siluet < 0,25 → K = 1 (tüm etiketler 0). `silhouette`: seçilen K'nın değeri;
 * K = 1 sonucunda denenen en iyi değer (hiç denenmediyse 0).
 */
export function selectPartition(points: Point[], seed: string, kMax: number): { k: number; silhouette: number; labels: Int32Array } {
  const n = points.length;
  if (n < MIN_USERS_FOR_SPLIT) return { k: 1, silhouette: 0, labels: new Int32Array(n) };
  let best: { k: number; silhouette: number; labels: Int32Array } | null = null;
  for (let K = 2; K <= Math.min(kMax, n - 1); K++) {
    const labels = kmeans(points, K, seed);
    if (nonEmpty(labels, K) < 2) continue;
    const sil = meanSilhouette(points, labels, K);
    if (!best || sil > best.silhouette) best = { k: K, silhouette: sil, labels };
  }
  if (!best) return { k: 1, silhouette: 0, labels: new Int32Array(n) };
  if (best.silhouette < MIN_SILHOUETTE) return { k: 1, silhouette: best.silhouette, labels: new Int32Array(n) };
  return best;
}

/**
 * ALGORITMA.md §9.
 * - Aynı (kullanıcı, öneri) için birden çok girdi varsa hücre değeri bunların ortalamasıdır (sıradan bağımsız).
 * - `silhouette`: bkz. selectPartition.
 * - `inputHash` tohumu içermez: aynı oy geçmişi aynı özeti verir (ClusterService yeniden kullanım için karşılaştırır).
 */
export function computeClusters(
  entries: VoteMatrixEntry[],
  seed: string,
  opts: { minVotes?: number; kMax?: number } = {},
): ClusterComputation {
  const cells = new Map<string, Map<string, { sum: number; count: number }>>();
  const proposalSet = new Set<string>();
  for (const e of entries) {
    if (e.value !== 1 && e.value !== -1 && e.value !== 0) throw new Error(`computeClusters: geçersiz oy değeri ${String(e.value)}`);
    proposalSet.add(e.proposalId);
    let row = cells.get(e.userId);
    if (!row) cells.set(e.userId, (row = new Map()));
    const c = row.get(e.proposalId);
    if (c) {
      c.sum += e.value;
      c.count++;
    } else row.set(e.proposalId, { sum: e.value, count: 1 });
  }
  const users = [...cells.keys()].sort(cmp);
  const proposals = [...proposalSet].sort(cmp);
  const m = proposals.length;
  const minVotes = opts.minVotes ?? Math.min(7, m);

  const sortedEntries = entries
    .map((e) => [e.userId, e.proposalId, e.value] as [string, string, number])
    .sort((a, b) => cmp(a[0], b[0]) || cmp(a[1], b[1]) || a[2] - b[2]);
  const inputHash = hashCanonical({ algo: CLUSTER_ALGO, minVotes, kMax: opts.kMax ?? null, entries: sortedEntries });

  const participants: string[] = [];
  const excluded: string[] = [];
  for (const u of users) (cells.get(u)!.size >= minVotes ? participants : excluded).push(u);
  const n = participants.length;

  // Sütun ortalamaları (yalnız katılımcıların gözlenen hücreleri); eksik hücre = ortalama → merkezlenmiş 0.
  const colSum = new Float64Array(m);
  const colCnt = new Int32Array(m);
  const raw: (number | null)[][] = participants.map((u) => {
    const row = cells.get(u)!;
    return proposals.map((p, j) => {
      const c = row.get(p);
      if (!c) return null;
      const v = c.sum / c.count;
      colSum[j] += v;
      colCnt[j]++;
      return v;
    });
  });
  const means = new Float64Array(m);
  for (let j = 0; j < m; j++) means[j] = colCnt[j] > 0 ? colSum[j] / colCnt[j] : 0;
  const X: Float64Array[] = raw.map((r) => {
    const row = new Float64Array(m);
    for (let j = 0; j < m; j++) row[j] = r[j] === null ? 0 : (r[j] as number) - means[j];
    return row;
  });

  // PCA: iki bileşen, deflasyon.
  const pcaRng = createRng(`${seed}|pca`);
  const v1 = powerIteration(X, m, pcaRng);
  const deflated = X.map((row) => {
    const p = dot(row, v1);
    const d = new Float64Array(m);
    for (let j = 0; j < m; j++) d[j] = row[j] - p * v1[j];
    return d;
  });
  const v2 = powerIteration(deflated, m, pcaRng);
  const points: Point[] = X.map((row) => [dot(row, v1), dot(row, v2)]);

  const kMax = opts.kMax ?? Math.min(5, 2 + Math.floor(n / 12));
  const { k: bestK, silhouette: bestSil, labels: bestLabels } = selectPartition(points, seed, kMax);

  // Yeniden numaralandırma: büyüklük ↓, merkez x ↑, merkez y ↑, ilk üye sırası ↑.
  const groups = new Map<number, number[]>();
  for (let i = 0; i < n; i++) {
    const l = bestK === 1 ? 0 : bestLabels[i];
    let g = groups.get(l);
    if (!g) groups.set(l, (g = []));
    g.push(i);
  }
  const ordered = [...groups.values()]
    .map((members) => {
      let sx = 0;
      let sy = 0;
      for (const i of members) {
        sx += points[i][0];
        sy += points[i][1];
      }
      return { members, cx: sx / members.length, cy: sy / members.length };
    })
    .sort((a, b) => b.members.length - a.members.length || a.cx - b.cx || a.cy - b.cy || a.members[0] - b.members[0]);

  const label = new Array<string>(n);
  const sizes: Record<string, number> = {};
  ordered.forEach((g, idx) => {
    const id = `g${idx}`;
    sizes[id] = g.members.length;
    for (const i of g.members) label[i] = id;
  });
  const assignments: Record<string, string> = {};
  const coords: Record<string, [number, number]> = {};
  participants.forEach((u, i) => {
    assignments[u] = label[i];
    coords[u] = [round6(points[i][0]), round6(points[i][1])];
  });

  const k = ordered.length;
  const silhouette = round6(bestSil);
  const outputHash = hashCanonical({ algo: CLUSTER_ALGO, k, silhouette, assignments, coords, sizes, clusteredTotal: n, excluded });
  return { algo: CLUSTER_ALGO, k, silhouette, assignments, coords, sizes, clusteredTotal: n, excluded, inputHash, outputHash, seed };
}
