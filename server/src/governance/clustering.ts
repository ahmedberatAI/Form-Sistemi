// ALGORITMA.md §9: Polis benzeri görüş kümeleme — PCA (2 bileşen, kuvvet yinelemesi) + k-means++/Lloyd + siluet
// + permütasyon sıfır modeli (KC-1.0 r2, algo "pca2-kmeans-silhouette-null/2").
// SAF ve BELİRLENİMCİ: tüm rastgelelik tohumlu (createRng), satır/sütun sırası kimliklere göre sabit,
// kayan nokta toplamları her zaman aynı sırada yapılır.
import { createRng, hashCanonical, type Rng } from "@forum/shared";
import type { ClusterComputation, VoteMatrixEntry } from "../core/contracts";

export const CLUSTER_ALGO = "pca2-kmeans-silhouette-null/2";
/** Sıfır modeli olmayan ilk sürüm (yalnız karşılaştırma/simülasyon için). */
export const CLUSTER_ALGO_V1 = "pca2-kmeans-silhouette/1";
const PCA_ITERATIONS = 100;
const LLOYD_ITERATIONS = 100;
const KMEANS_RESTARTS = 10;
const MIN_SILHOUETTE = 0.25;
const NULL_PERMUTATIONS = 5;
const MIN_NULL_GAP = 0.1;
const MIN_USERS_FOR_SPLIT = 4;
const EPS = 1e-12;

export type Point = [number, number];

/** Merkezlenmiş oy matrisi (satır ana sıralı); eksik hücre = sütun ortalaması → 0. */
interface Matrix {
  n: number;
  m: number;
  data: Float64Array;
  observed: Uint8Array;
}

function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function round6(x: number): number {
  const r = Math.round(x * 1e6) / 1e6;
  return r === 0 ? 0 : r;
}

function normalize(v: Float64Array): boolean {
  let ss = 0;
  for (let j = 0; j < v.length; j++) ss += v[j] * v[j];
  const norm = Math.sqrt(ss);
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

function rowDot(data: Float64Array, i: number, m: number, v: Float64Array): number {
  const off = i * m;
  let s = 0;
  for (let j = 0; j < m; j++) s += data[off + j] * v[j];
  return s;
}

/** XᵀX'in baskın özvektörü (kuvvet yinelemesi, başlangıç U(−0,5; 0,5)ᵐ). Matris sıfırsa sıfır vektör döner. */
function powerIteration(data: Float64Array, n: number, m: number, rng: Rng): Float64Array {
  const v = new Float64Array(m);
  for (let j = 0; j < m; j++) v[j] = rng.next() - 0.5;
  if (!normalize(v)) {
    if (m === 0) return v;
    v[0] = 1;
  }
  const xv = new Float64Array(n);
  const w = new Float64Array(m);
  for (let it = 0; it < PCA_ITERATIONS; it++) {
    for (let i = 0; i < n; i++) xv[i] = rowDot(data, i, m, v);
    w.fill(0);
    for (let i = 0; i < n; i++) {
      const off = i * m;
      const s = xv[i];
      for (let j = 0; j < m; j++) w[j] += data[off + j] * s;
    }
    if (!normalize(w)) return new Float64Array(m);
    v.set(w);
  }
  canonicalSign(v);
  return v;
}

/** İki bileşenli PCA (deflasyonla) → kullanıcı koordinatları. */
function pca2(M: Matrix, rng: Rng): Point[] {
  const { n, m, data } = M;
  const v1 = powerIteration(data, n, m, rng);
  const deflated = new Float64Array(data.length);
  for (let i = 0; i < n; i++) {
    const p = rowDot(data, i, m, v1);
    const off = i * m;
    for (let j = 0; j < m; j++) deflated[off + j] = data[off + j] - p * v1[j];
  }
  const v2 = powerIteration(deflated, n, m, rng);
  const points: Point[] = new Array(n);
  for (let i = 0; i < n; i++) points[i] = [rowDot(data, i, m, v1), rowDot(data, i, m, v2)];
  return points;
}

/** Sıfır modeli: her sütunun gözlenen değerleri, o sütunda oy vermiş satırlar arasında tohumlu karıştırılır. */
function permuteColumns(M: Matrix, rng: Rng): Matrix {
  const { n, m } = M;
  const data = new Float64Array(M.data);
  for (let j = 0; j < m; j++) {
    const rows: number[] = [];
    for (let i = 0; i < n; i++) if (M.observed[i * m + j]) rows.push(i);
    const vals = rng.shuffle(rows.map((i) => M.data[i * m + j]));
    rows.forEach((i, k) => (data[i * m + j] = vals[k]));
  }
  return { n, m, data, observed: M.observed };
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
 * §9.4: K ∈ 2..min(kMax, n−1) için k-means (`${seed}|kmeans|K|r` tohumlarıyla 10 başlangıç);
 * en yüksek ortalama siluet (eşitlikte küçük K). Geçerli bölümleme yoksa (n < 4 ya da özdeş noktalar) null.
 * Eşik uygulanmaz; eşikler computeClusters'ta.
 */
export function bestPartition(points: Point[], seed: string, kMax: number): { k: number; silhouette: number; labels: Int32Array } | null {
  const n = points.length;
  if (n < MIN_USERS_FOR_SPLIT) return null;
  let best: { k: number; silhouette: number; labels: Int32Array } | null = null;
  for (let K = 2; K <= Math.min(kMax, n - 1); K++) {
    const labels = kmeans(points, K, seed);
    if (nonEmpty(labels, K) < 2) continue;
    const sil = meanSilhouette(points, labels, K);
    if (!best || sil > best.silhouette) best = { k: K, silhouette: sil, labels };
  }
  return best;
}

export interface ClusterDiagnostics {
  algo: string;
  /** Eşiklerden önce siluetin en yüksek olduğu K (yoksa 1) ve siluet değeri */
  candidateK: number;
  candidateSilhouette: number;
  /** Sıfır modeli siluet ortalaması; hesaplanmadıysa (n < 4, aday yok, siluet < 0,25 ya da v1) null */
  nullSilhouette: number | null;
  /** K = 1'e düşürme nedeni */
  rejectedBy: "too_few" | "no_partition" | "silhouette" | "null_gap" | null;
}

/**
 * ALGORITMA.md §9 (KC-1.0 r2).
 * - Aynı (kullanıcı, öneri) için birden çok girdi varsa hücre değeri bunların ortalamasıdır (sıradan bağımsız).
 * - K ≥ 2 yalnızca siluet ≥ 0,25 VE siluet − siluet_sıfır ≥ 0,10 ise kabul edilir. siluet_sıfır: sütunları
 *   `${seed}|null|i` (i = 0..4) tohumlarıyla karıştırılmış matriste aynı boru hattının en iyi siluetinin ortalaması.
 * - `silhouette`: seçilen bölümlemenin değeri; K = 1 sonucunda eşik öncesi en iyi aday (aday yoksa 0).
 * - `inputHash` tohumu içermez (ClusterService aynı girdiyi tanır); `outputHash` sıfır siluetini de içerir.
 * - `mode.nullModel = false` yalnız karşılaştırma içindir (v1 davranışı, algo "pca2-kmeans-silhouette/1").
 */
export function computeClustersDetailed(
  entries: VoteMatrixEntry[],
  seed: string,
  opts: { minVotes?: number; kMax?: number } = {},
  mode: { nullModel?: boolean } = {},
): { result: ClusterComputation; diagnostics: ClusterDiagnostics } {
  const useNull = mode.nullModel !== false;
  const algo = useNull ? CLUSTER_ALGO : CLUSTER_ALGO_V1;
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
  const inputHash = hashCanonical({ algo, minVotes, kMax: opts.kMax ?? null, entries: sortedEntries });

  // Katılım: çekimser (0) dahil en az minVotes oy.
  const participants: string[] = [];
  const excluded: string[] = [];
  for (const u of users) (cells.get(u)!.size >= minVotes ? participants : excluded).push(u);
  const n = participants.length;

  // Sütun ortalamaları (yalnız katılımcıların gözlenen hücreleri); eksik hücre = ortalama → merkezlenmiş 0.
  const colSum = new Float64Array(m);
  const colCnt = new Int32Array(m);
  const raw = new Float64Array(n * m);
  const observed = new Uint8Array(n * m);
  participants.forEach((u, i) => {
    const row = cells.get(u)!;
    proposals.forEach((p, j) => {
      const c = row.get(p);
      if (!c) return;
      const v = c.sum / c.count;
      raw[i * m + j] = v;
      observed[i * m + j] = 1;
      colSum[j] += v;
      colCnt[j]++;
    });
  });
  const data = new Float64Array(n * m);
  for (let j = 0; j < m; j++) {
    const mean = colCnt[j] > 0 ? colSum[j] / colCnt[j] : 0;
    for (let i = 0; i < n; i++) if (observed[i * m + j]) data[i * m + j] = raw[i * m + j] - mean;
  }
  const M: Matrix = { n, m, data, observed };

  const points = pca2(M, createRng(`${seed}|pca`));
  const kMax = opts.kMax ?? Math.min(5, 2 + Math.floor(n / 12));
  const cand = bestPartition(points, seed, kMax);

  const diagnostics: ClusterDiagnostics = {
    algo,
    candidateK: cand?.k ?? 1,
    candidateSilhouette: cand?.silhouette ?? 0,
    nullSilhouette: null,
    rejectedBy: null,
  };
  let accepted = cand;
  if (n < MIN_USERS_FOR_SPLIT) {
    diagnostics.rejectedBy = "too_few";
  } else if (!cand) {
    diagnostics.rejectedBy = "no_partition";
  } else if (cand.silhouette < MIN_SILHOUETTE) {
    diagnostics.rejectedBy = "silhouette";
    accepted = null;
  } else if (useNull) {
    let acc = 0;
    for (let i = 0; i < NULL_PERMUTATIONS; i++) {
      const base = `${seed}|null|${i}`;
      const permuted = permuteColumns(M, createRng(base));
      const nullPoints = pca2(permuted, createRng(`${base}|pca`));
      acc += bestPartition(nullPoints, base, kMax)?.silhouette ?? 0;
    }
    const nullSil = acc / NULL_PERMUTATIONS;
    diagnostics.nullSilhouette = nullSil;
    if (cand.silhouette - nullSil < MIN_NULL_GAP) {
      diagnostics.rejectedBy = "null_gap";
      accepted = null;
    }
  }
  const bestSil = cand?.silhouette ?? 0;

  // Yeniden numaralandırma: büyüklük ↓, merkez x ↑, merkez y ↑, ilk üye sırası ↑.
  const groups = new Map<number, number[]>();
  for (let i = 0; i < n; i++) {
    const l = accepted ? accepted.labels[i] : 0;
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
  const nullSilhouette = useNull ? (diagnostics.nullSilhouette === null ? null : round6(diagnostics.nullSilhouette)) : undefined;
  const outputHash = hashCanonical({ algo, k, silhouette, nullSilhouette, assignments, coords, sizes, clusteredTotal: n, excluded });
  return {
    result: { algo, k, silhouette, assignments, coords, sizes, clusteredTotal: n, excluded, inputHash, outputHash, seed },
    diagnostics,
  };
}

export function computeClusters(entries: VoteMatrixEntry[], seed: string, opts: { minVotes?: number; kMax?: number } = {}): ClusterComputation {
  return computeClustersDetailed(entries, seed, opts).result;
}
