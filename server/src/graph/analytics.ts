// Graf modülünün saf (yan etkisiz) hesapları: Gini, SybilRank benzeri güven yayılımı, oy uzlaşısı çiftleri,
// k-çekirdek bileşenleri ve topluluk numaralarının kanonikleştirilmesi. Tümü belirlenimcidir.

/** Gini katsayısı (0 = eşit dağılım, 1'e yakın = tek elde yoğunlaşma). Boş ya da toplamı 0 ise 0. */
export function gini(values: number[]): number {
  const n = values.length;
  if (n === 0) return 0;
  const xs = values.slice().sort((a, b) => a - b);
  const total = xs.reduce((s, x) => s + x, 0);
  if (total <= 0) return 0;
  let weighted = 0;
  xs.forEach((x, i) => {
    weighted += (i + 1) * x;
  });
  return (2 * weighted) / (n * total) - (n + 1) / n;
}

export interface WeightedPair {
  a: string;
  b: string;
  w: number;
}

/**
 * SybilRank benzeri, erken kesilen (iterations adım) tembel rastgele yürüyüşle güven yayılımı.
 * Toplam güven = düğüm sayısı; tohumlara eşit bölünür. Her adımda düğüm güvenin yarısını tutar, yarısını
 * komşularına kenar ağırlığıyla orantılı dağıtır (tembellik iki parçalı graflarda salınımı önler).
 * Dönen değer derece-normalize güvendir: T(v) / W(v) (W: ağırlıklı derece; derecesiz düğüm için 0).
 */
export function propagateTrust(nodes: string[], edges: WeightedPair[], seeds: Set<string>, iterations: number): Map<string, number> {
  const adj = new Map<string, Map<string, number>>();
  for (const n of nodes) adj.set(n, new Map());
  for (const { a, b, w } of edges) {
    if (a === b || !(w > 0) || !adj.has(a) || !adj.has(b)) continue;
    adj.get(a)!.set(b, (adj.get(a)!.get(b) ?? 0) + w);
    adj.get(b)!.set(a, (adj.get(b)!.get(a) ?? 0) + w);
  }
  const deg = new Map<string, number>();
  for (const [n, nb] of adj) {
    let s = 0;
    for (const w of nb.values()) s += w;
    deg.set(n, s);
  }
  let trust = new Map<string, number>();
  const seedList = nodes.filter((n) => seeds.has(n));
  for (const n of nodes) trust.set(n, 0);
  if (seedList.length > 0) for (const s of seedList) trust.set(s, nodes.length / seedList.length);
  for (let it = 0; it < iterations; it++) {
    const next = new Map<string, number>();
    for (const n of nodes) next.set(n, 0);
    for (const n of nodes) {
      const t = trust.get(n)!;
      if (t === 0) continue;
      const d = deg.get(n)!;
      if (d <= 0) {
        next.set(n, next.get(n)! + t);
        continue;
      }
      next.set(n, next.get(n)! + t / 2);
      for (const [m, w] of adj.get(n)!) next.set(m, next.get(m)! + ((t / 2) * w) / d);
    }
    trust = next;
  }
  const out = new Map<string, number>();
  for (const n of nodes) {
    const d = deg.get(n)!;
    out.set(n, d > 0 ? trust.get(n)! / d : 0);
  }
  return out;
}

/**
 * SybilRank triyajının kalibrasyonu (ARASTIRMA §12.12, §17). SybilRank'in güvenceleri büyük ve hızlı karışan grafları varsayar;
 * küçük ve seyrek kefalet ağlarında tohumdan güven almayan (sıfır güvenli) dürüst hesaplar çoğunluktadır. Bu yüzden işaret
 * yalnız KANIT bulunduğunda konur:
 *  1. Doğrudan kanıt: en az `suspiciousLimit` farklı doğrulanmış üyenin "şüpheli" kefaleti (ağ boyutundan bağımsız).
 *  2. Graf kuralları yalnız kefalet ağına katılan (pozitif kefalet derecesi > 0) doğrulanmış hesap sayısı ≥ `minNetwork` iken:
 *     a. Genç hesap (doğrulanalı `youngMs`'den az) ve güveni sıfır ya da göreli tabanın (ortanca pozitif güvenin
 *        `relativeFloor` katı) altında → yeni açılmış sahte hesap kümesi imzası;
 *     b. Güveni sıfır ve hiçbir tohum içermeyen, en az `regionMin` üyeli bir kefalet bileşeninde → yerleşik sahte bölge;
 *     c. Güveni pozitif ama göreli tabanın altında ve pozitif güvenliler arasında en alttaki `tailShare` (%5) dilimde
 *        → az saldırı kenarıyla bağlanmış bölge (SybilRank'in klasik kesimi).
 *  Hiç kefaleti olmayan yalnız hesaplar "bilinmiyor" sayılır, işaretlenmez (yeni dürüst üyeler de böyledir).
 * İşaret yalnız inceleme kuyruğu içindir; hiçbir hakkı kısıtlamaz.
 */
export const SYBIL_PARAMS = {
  suspiciousLimit: 2,
  minNetwork: 20,
  relativeFloor: 0.1,
  tailShare: 0.05,
  regionMin: 4,
  youngMs: 14 * 24 * 3_600_000,
} as const;

export type SybilReason = "reported" | "young_low_trust" | "seedless_region" | "low_trust_tail";

export interface SybilInput {
  /** Doğrulanmış kullanıcılar (belirlenimci sıra için sıralı verilmesi önerilir) */
  nodes: string[];
  /** Doğrulanmış kullanıcılar arasındaki pozitif kefalet kenarları */
  pairs: WeightedPair[];
  seeds: Set<string>;
  /** Kullanıcı → onu "şüpheli" olarak işaretleyen farklı doğrulanmış üye sayısı */
  suspicious: Map<string, number>;
  /** Genç hesaplar (doğrulanalı youngMs'den az) */
  young: Set<string>;
  iterations: number;
}

export interface SybilResult {
  /** Derece-normalize güven (propagateTrust) */
  trust: Map<string, number>;
  flagged: string[];
  reasons: Map<string, SybilReason>;
  /** Kefalet ağına katılan hesap sayısı ve graf kurallarının uygulanıp uygulanmadığı */
  participants: number;
  graphRulesApplied: boolean;
}

/** Yönsüz bağlı bileşenler: düğüm → bileşen numarası, numara → üyeler. */
export function connectedComponents(nodes: string[], edges: { a: string; b: string }[]): { of: Map<string, number>; members: string[][] } {
  const adj = new Map<string, string[]>(nodes.map((n) => [n, []]));
  for (const { a, b } of edges) {
    if (a === b || !adj.has(a) || !adj.has(b)) continue;
    adj.get(a)!.push(b);
    adj.get(b)!.push(a);
  }
  const of = new Map<string, number>();
  const members: string[][] = [];
  for (const start of nodes) {
    if (of.has(start)) continue;
    const idx = members.length;
    const comp: string[] = [];
    const stack = [start];
    of.set(start, idx);
    while (stack.length) {
      const n = stack.pop()!;
      comp.push(n);
      for (const m of adj.get(n)!) {
        if (of.has(m)) continue;
        of.set(m, idx);
        stack.push(m);
      }
    }
    members.push(comp);
  }
  return { of, members };
}

export type SybilParams = { readonly [K in keyof typeof SYBIL_PARAMS]: number };

export function classifySybil(input: SybilInput, params: SybilParams = SYBIL_PARAMS): SybilResult {
  const { nodes, pairs, seeds, suspicious, young, iterations } = input;
  const trust = propagateTrust(nodes, pairs, seeds, iterations);
  const reasons = new Map<string, SybilReason>();
  for (const id of nodes) if ((suspicious.get(id) ?? 0) >= params.suspiciousLimit) reasons.set(id, "reported");

  const degree = new Map<string, number>();
  for (const { a, b, w } of pairs) {
    if (a === b || !(w > 0)) continue;
    degree.set(a, (degree.get(a) ?? 0) + w);
    degree.set(b, (degree.get(b) ?? 0) + w);
  }
  const participants = nodes.filter((n) => (degree.get(n) ?? 0) > 0);
  const graphRulesApplied = participants.length >= params.minNetwork;
  if (graphRulesApplied) {
    const ranked = participants.filter((n) => !seeds.has(n));
    const positive = ranked.filter((n) => trust.get(n)! > 0);
    const floor = params.relativeFloor * median(positive.map((n) => trust.get(n)!));
    const comps = connectedComponents(participants, pairs.filter((p) => p.w > 0));
    const seedless = comps.members.map((m) => !m.some((n) => seeds.has(n)));
    const tail = new Set(
      positive
        .slice()
        .sort((x, y) => trust.get(x)! - trust.get(y)! || (x < y ? -1 : x > y ? 1 : 0))
        .slice(0, Math.floor(params.tailShare * positive.length)),
    );
    for (const id of ranked) {
      if (reasons.has(id)) continue;
      const t = trust.get(id)!;
      const low = t <= 0 || t < floor;
      const c = comps.of.get(id)!;
      if (young.has(id) && low) reasons.set(id, "young_low_trust");
      else if (t <= 0 && seedless[c] && comps.members[c].length >= params.regionMin) reasons.set(id, "seedless_region");
      else if (t > 0 && t < floor && tail.has(id)) reasons.set(id, "low_trust_tail");
    }
  }
  return { trust, flagged: nodes.filter((n) => reasons.has(n)), reasons, participants: participants.length, graphRulesApplied };
}

export interface VoteRow {
  proposal: string;
  user: string;
  choice: string;
}

export interface AgreementPair {
  a: string;
  b: string;
  common: number;
  same: number;
}

/** Her kullanıcı çifti için ortak oy ve aynı oy sayıları (a < b; yalnız en az minCommon ortak oyu olanlar). */
export function agreementPairs(votes: VoteRow[], minCommon: number): AgreementPair[] {
  const users = [...new Set(votes.map((v) => v.user))].sort();
  const index = new Map(users.map((u, i) => [u, i] as const));
  const n = users.length;
  const byProposal = new Map<string, { i: number; c: string }[]>();
  for (const v of votes) {
    const list = byProposal.get(v.proposal) ?? [];
    list.push({ i: index.get(v.user)!, c: v.choice });
    byProposal.set(v.proposal, list);
  }
  const common = new Map<number, number>();
  const same = new Map<number, number>();
  for (const list of byProposal.values()) {
    list.sort((x, y) => x.i - y.i);
    for (let x = 0; x < list.length; x++) {
      for (let y = x + 1; y < list.length; y++) {
        if (list[x].i === list[y].i) continue;
        const key = list[x].i * n + list[y].i;
        common.set(key, (common.get(key) ?? 0) + 1);
        if (list[x].c === list[y].c) same.set(key, (same.get(key) ?? 0) + 1);
      }
    }
  }
  const out: AgreementPair[] = [];
  for (const [key, c] of common) {
    if (c < minCommon) continue;
    out.push({ a: users[Math.floor(key / n)], b: users[key % n], common: c, same: same.get(key) ?? 0 });
  }
  out.sort((p, q) => (p.a < q.a ? -1 : p.a > q.a ? 1 : p.b < q.b ? -1 : p.b > q.b ? 1 : 0));
  return out;
}

/** k-çekirdek (her üyenin grup içinde en az k komşusu) içindeki, en az minSize üyeli bağlı bileşenler. */
export function kCoreComponents(edges: [string, string][], k: number, minSize: number): string[][] {
  const adj = new Map<string, Set<string>>();
  for (const [a, b] of edges) {
    if (a === b) continue;
    if (!adj.has(a)) adj.set(a, new Set());
    if (!adj.has(b)) adj.set(b, new Set());
    adj.get(a)!.add(b);
    adj.get(b)!.add(a);
  }
  let changed = true;
  while (changed) {
    changed = false;
    for (const [n, nb] of [...adj]) {
      if (nb.size >= k) continue;
      for (const m of nb) adj.get(m)?.delete(n);
      adj.delete(n);
      changed = true;
    }
  }
  const seen = new Set<string>();
  const groups: string[][] = [];
  for (const start of [...adj.keys()].sort()) {
    if (seen.has(start)) continue;
    const comp: string[] = [];
    const stack = [start];
    seen.add(start);
    while (stack.length) {
      const n = stack.pop()!;
      comp.push(n);
      for (const m of adj.get(n)!) {
        if (seen.has(m)) continue;
        seen.add(m);
        stack.push(m);
      }
    }
    if (comp.length >= minSize) groups.push(comp.sort());
  }
  return groups.sort((x, y) => y.length - x.length || (x[0] < y[0] ? -1 : x[0] > y[0] ? 1 : 0));
}

/** Topluluk numaralarını büyüklüğe (azalan), eşitlikte en küçük üye kimliğine göre 0,1,2… olarak yeniden numaralandırır. */
export function canonicalCommunities(mapping: Record<string, number>): { communities: Record<string, number>; count: number } {
  const groups = new Map<number, string[]>();
  for (const node of Object.keys(mapping).sort()) {
    const c = mapping[node];
    const list = groups.get(c) ?? [];
    list.push(node);
    groups.set(c, list);
  }
  const ordered = [...groups.values()].sort((x, y) => y.length - x.length || (x[0] < y[0] ? -1 : x[0] > y[0] ? 1 : 0));
  const communities: Record<string, number> = {};
  ordered.forEach((members, idx) => {
    for (const m of members) communities[m] = idx;
  });
  return { communities, count: ordered.length };
}

export const round6 = (x: number): number => (Number.isFinite(x) ? Math.round(x * 1e6) / 1e6 : 0);

/** Ortanca (boşsa 0). */
export function median(values: number[]): number {
  if (values.length === 0) return 0;
  const xs = values.slice().sort((a, b) => a - b);
  const mid = Math.floor(xs.length / 2);
  return xs.length % 2 ? xs[mid] : (xs[mid - 1] + xs[mid]) / 2;
}
