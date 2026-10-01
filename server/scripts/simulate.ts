// Monte Carlo simülasyonu: Köprülü Çoğunluk (KC-1.0) ile basit çoğunluğun karşılaştırması.
// Çalıştırma: npm run sim -w server  →  docs/SIMULASYON.md dosyasını (Türkçe) yeniden üretir.
// Gerçek decide(), evaluateObjection(), computeClusters() ve resolveEffectiveVotes() kullanılır.
// Tüm rastgelelik tohumludur (createRng): aynı tohum → aynı rapor.
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  createRng,
  decide,
  delegationCap,
  evaluateObjection,
  floorAbs,
  quorumRequired,
  ratToPercent,
  type DecisionOutcome,
  type DecisionParams,
  type DecisionResult,
  type EffectiveVote,
  type Rng,
  type VoteChoice,
} from "@forum/shared";
import type { ClusterComputation, DelegationEdge, VoteMatrixEntry } from "../src/core/contracts";
import { computeClusters, defaultDecisionParams, resolveEffectiveVotes } from "../src/governance";

const MASTER_SEED = "KC-1.0/simulasyon/2026-10";
const OUT = fileURLToPath(new URL("../../docs/SIMULASYON.md", import.meta.url));

// ───────────────────────── Biçim ve yardımcılar ─────────────────────────

const pct = (x: number, d = 1) => (Number.isFinite(x) ? "%" + (x * 100).toFixed(d).replace(".", ",") : "—");
const num = (x: number, d = 2) => (Number.isFinite(x) ? x.toFixed(d).replace(".", ",") : "—");
const logistic = (x: number) => 1 / (1 + Math.exp(-x));
const BLOCK = ["A", "B", "C", "D", "E"];

function gauss(rng: Rng): number {
  const u = Math.max(rng.next(), 1e-12);
  return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * rng.next());
}

function table(head: string[], rows: (string | number)[][]): string[] {
  return [`| ${head.join(" | ")} |`, `|${head.map(() => "---").join("|")}|`, ...rows.map((r) => `| ${r.join(" | ")} |`)];
}

function mean(xs: number[]): number {
  return xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : NaN;
}

function gini(xs: number[]): number {
  const v = xs.filter((x) => x > 0).sort((a, b) => a - b);
  const n = v.length;
  if (n === 0) return 0;
  const total = v.reduce((a, b) => a + b, 0);
  let acc = 0;
  v.forEach((x, i) => (acc += (2 * (i + 1) - n - 1) * x));
  return acc / (n * total);
}

// ───────────────────────── Nüfus ve oy modeli ─────────────────────────

interface Person {
  id: string;
  block: number;
  bias: number; // kişisel eğilim (logit)
  newcomer: boolean; // oy geçmişi yok → kümelenmemiş
}

interface Pop {
  people: Person[];
  sizes: number[];
  blockOf: Map<string, number>;
}

/** Öneri: blok başına logit destek ve (isteğe bağlı) blok başına katılım olasılığı. */
interface Spec {
  logits: number[];
  turnout?: number[];
}

const BASE_TURNOUT = 0.55;
const ABSTAIN = 0.04;
const VOTE_NOISE = 0.6;
const EXT_FACTOR = 0.35; // uzatmada oy vermemişlerin katılma olasılığı çarpanı

function makePop(sizes: number[], rng: Rng, newcomerShare = 0.05): Pop {
  const people: Person[] = [];
  sizes.forEach((size, b) => {
    for (let i = 0; i < size; i++) {
      people.push({ id: `k${String(people.length).padStart(4, "0")}`, block: b, bias: 0.5 * gauss(rng), newcomer: rng.next() < newcomerShare });
    }
  });
  return { people, sizes, blockOf: new Map(people.map((p) => [p.id, p.block])) };
}

function choose(p: Person, spec: Spec, rng: Rng): VoteChoice {
  if (rng.next() < ABSTAIN) return "abstain";
  return rng.next() < logistic(spec.logits[p.block] + p.bias + VOTE_NOISE * gauss(rng)) ? "yes" : "no";
}

function castVotes(pop: Pop, spec: Spec, rng: Rng, opts: { only?: (p: Person) => boolean; turnoutScale?: number } = {}): Map<string, VoteChoice> {
  const votes = new Map<string, VoteChoice>();
  for (const p of pop.people) {
    if (opts.only && !opts.only(p)) continue;
    const t = (spec.turnout?.[p.block] ?? BASE_TURNOUT) * (opts.turnoutScale ?? 1);
    if (rng.next() >= t) continue;
    votes.set(p.id, choose(p, spec, rng));
  }
  return votes;
}

/** Uzatma: henüz oy vermemişlerin bir kısmı geç katılır (oy verenler değişmez). */
function extendVotes(pop: Pop, spec: Spec, votes: Map<string, VoteChoice>, rng: Rng): Map<string, VoteChoice> {
  const out = new Map(votes);
  for (const p of pop.people) {
    if (out.has(p.id)) continue;
    const t = (spec.turnout?.[p.block] ?? BASE_TURNOUT) * EXT_FACTOR;
    if (rng.next() < t) out.set(p.id, choose(p, spec, rng));
  }
  return out;
}

/** Blok bağıntılı geçmiş öneri üreteci: ortak değer + bloğa özgü sapma. */
function historySpec(nBlocks: number, spread = 1.6): (rng: Rng) => Spec {
  return (rng) => {
    const c = 0.8 * gauss(rng);
    return { logits: Array.from({ length: nBlocks }, () => c + spread * gauss(rng)) };
  };
}

function toEntries(votes: Map<string, VoteChoice>, proposalId: string): VoteMatrixEntry[] {
  return [...votes].map(([userId, c]) => ({ userId, proposalId, value: c === "yes" ? 1 : c === "no" ? -1 : 0 }));
}

function makeHistory(pop: Pop, rng: Rng, count: number, gen: (rng: Rng) => Spec, prefix: string): VoteMatrixEntry[] {
  const entries: VoteMatrixEntry[] = [];
  for (let i = 0; i < count; i++) {
    entries.push(...toEntries(castVotes(pop, gen(rng), rng, { only: (p) => !p.newcomer }), `${prefix}${String(i).padStart(4, "0")}`));
  }
  return entries;
}

// ───────────────────────── Küme anlık görüntüsü ─────────────────────────

interface Snap {
  comp: ClusterComputation;
  clusterOf: (u: string) => string | null;
  /** her kümenin çoğunluk bloğu */
  majorityBlock: Record<string, number>;
  /** kişilerin kümelerinin çoğunluk bloğuyla eşleşme oranı */
  purity: number;
}

function snapshot(pop: Pop, entries: VoteMatrixEntry[], seed: string): Snap {
  const comp = computeClusters(entries, seed);
  const counts: Record<string, number[]> = {};
  for (const [u, g] of Object.entries(comp.assignments)) {
    const c = (counts[g] ??= new Array(pop.sizes.length).fill(0));
    c[pop.blockOf.get(u)!]++;
  }
  const majorityBlock: Record<string, number> = {};
  let pure = 0;
  for (const [g, c] of Object.entries(counts)) {
    const b = c.indexOf(Math.max(...c));
    majorityBlock[g] = b;
    pure += c[b];
  }
  return { comp, clusterOf: (u) => comp.assignments[u] ?? null, majorityBlock, purity: comp.clusteredTotal ? pure / comp.clusteredTotal : 0 };
}

/** Blok, kendi çoğunlukta olduğu ve üyelerinin yarısından fazlasını içeren ANLAMLI bir kümeyle temsil ediliyor mu? */
function blockProtected(pop: Pop, snap: Snap, block: number, p: DecisionParams): boolean {
  const members = pop.people.filter((x) => x.block === block).map((x) => x.id);
  for (const [g, size] of Object.entries(snap.comp.sizes)) {
    if (snap.majorityBlock[g] !== block) continue;
    const inside = members.filter((u) => snap.comp.assignments[u] === g).length;
    const significant = size >= p.significantMinMembers && size * p.significantShare.den >= p.significantShare.num * snap.comp.clusteredTotal;
    if (significant && inside * 2 > members.length) return true;
  }
  return false;
}

function describeSnap(snap: Snap): string {
  const parts = Object.entries(snap.comp.sizes).map(([g, n]) => `${g}=${n} (blok ${BLOCK[snap.majorityBlock[g]]})`);
  return `K=${snap.comp.k}, siluet ${num(snap.comp.silhouette)}, saflık ${pct(snap.purity)}, kümelenmiş ${snap.comp.clusteredTotal}, dışlanan ${snap.comp.excluded.length} — ${parts.join(", ")}`;
}

// ───────────────────────── Süreç modeli (ALGORITMA §3) ─────────────────────────

interface Env {
  pop: Pop;
  snap: Snap;
  params: DecisionParams;
  authorClusterId?: string | null;
}

function effective(env: Env, votes: Map<string, VoteChoice>): EffectiveVote[] {
  return [...votes].map(([u, c]) => ({ voterKey: u, choice: c, via: "direct" as const, clusterId: env.snap.clusterOf(u) }));
}

function decideRound(
  env: Env,
  votes: EffectiveVote[],
  round: 1 | 2,
  extensionAvailable: boolean,
  revote: { origin: "contested" | "objection"; strongObjection: boolean } | null = null,
  overrides: { k?: number } = {},
): DecisionResult {
  return decide({
    params: env.params,
    round,
    eligibleCount: env.pop.people.length,
    votes,
    clusterSizes: env.snap.comp.sizes,
    clusteredTotal: env.snap.comp.clusteredTotal,
    k: overrides.k ?? env.snap.comp.k,
    extensionAvailable,
    authorClusterId: env.authorClusterId ?? null,
    revote,
    now: 0,
  });
}

interface RunOpts {
  /** blok başına: ilk turda "no" diyenlerin itirazı imzalama olasılığı */
  objection?: number[];
  /** uzlaşma sonrası (metin revize edilmişse) yeniden oylamadaki tercihler */
  revoteSpec?: Spec;
}

interface RunResult {
  firstRaw: DecisionOutcome; // uzatmadan önce
  first: DecisionOutcome; // uzatmadan sonra (ilk tur kesin sonucu)
  firstResult: DecisionResult;
  objection: "none" | "invalid" | "valid";
  revote: "contested" | "objection" | null;
  override: boolean;
  enacted: boolean;
  hours: number;
  round1: Map<string, VoteChoice>;
  smPass: boolean;
}

function smOutcome(env: Env, v1: Map<string, VoteChoice>, v1x: Map<string, VoteChoice>): boolean {
  const req = quorumRequired(env.params.quorum, env.pop.people.length);
  const count = (v: Map<string, VoteChoice>) => {
    let y = 0;
    let n = 0;
    for (const c of v.values()) c === "yes" ? y++ : c === "no" ? n++ : 0;
    return { y, n, p: v.size };
  };
  let c = count(v1);
  if (c.p < req) c = count(v1x);
  return c.p >= req && c.p > 0 && c.y > c.n;
}

/** Bir önerinin tam yolu (ilk tur → [uzatma] → itiraz penceresi → [uzlaşma → yeniden oylama]) ve eşlenik basit çoğunluk. */
function runProposal(env: Env, spec: Spec, rng: Rng, opts: RunOpts = {}): RunResult {
  const d = env.params.durationsHours;
  const v1 = castVotes(env.pop, spec, rng);
  const v1x = extendVotes(env.pop, spec, v1, rng);
  const smPass = smOutcome(env, v1, v1x);

  let hours = d.voting;
  let round1 = v1;
  let r = decideRound(env, effective(env, v1), 1, true);
  const firstRaw = r.outcome;
  if (r.outcome === "needs_more_votes") {
    round1 = v1x;
    hours += d.extension;
    r = decideRound(env, effective(env, v1x), 1, false);
  }
  const res: RunResult = { firstRaw, first: r.outcome, firstResult: r, objection: "none", revote: null, override: false, enacted: false, hours, round1, smPass };

  let revote: { origin: "contested" | "objection"; strongObjection: boolean } | null = null;
  if (r.outcome === "accept") {
    if (env.params.tier === "DEL" || d.objection === 0) {
      res.enacted = true;
      return res;
    }
    res.hours += d.objection;
    const signatures = [];
    for (const [u, c] of round1) {
      if (c !== "no") continue;
      const prob = opts.objection?.[env.pop.blockOf.get(u)!] ?? 0;
      if (prob > 0 && rng.next() < prob) signatures.push({ voterKey: u, clusterId: env.snap.clusterOf(u) });
    }
    if (signatures.length === 0) {
      res.enacted = true;
      return res;
    }
    const ev = evaluateObjection({
      eligibleCount: env.pop.people.length,
      firstRoundVotes: effective(env, round1),
      signatures,
      clusterSizes: env.snap.comp.sizes,
      clusteredTotal: env.snap.comp.clusteredTotal,
      params: env.params,
    });
    res.objection = ev.valid ? "valid" : "invalid";
    if (!ev.valid) {
      res.enacted = true;
      return res;
    }
    revote = { origin: "objection", strongObjection: ev.strong };
  } else if (r.outcome === "contested") {
    revote = { origin: "contested", strongObjection: false };
  } else {
    return res;
  }

  res.revote = revote.origin;
  res.hours += d.reconciliation + d.voting;
  const spec2 = opts.revoteSpec ?? spec;
  const v2 = castVotes(env.pop, spec2, rng);
  let r2 = decideRound(env, effective(env, v2), 2, true, revote);
  if (r2.outcome === "needs_more_votes") {
    res.hours += d.extension;
    r2 = decideRound(env, effective(env, extendVotes(env.pop, spec2, v2, rng)), 2, false, revote);
  }
  res.enacted = r2.outcome === "accept";
  res.override = res.enacted && r2.overrideMet === true && !(r2.thresholdMet && r2.bridgeMet !== false);
  return res;
}

interface Agg {
  n: number;
  sm: number;
  firstRawNeeds: number;
  first: Record<DecisionOutcome, number>;
  objectionValid: number;
  revote: number;
  override: number;
  enacted: number;
  hours: number[];
}

function aggregate(runs: RunResult[]): Agg {
  const a: Agg = { n: runs.length, sm: 0, firstRawNeeds: 0, first: { accept: 0, contested: 0, reject: 0, needs_more_votes: 0 }, objectionValid: 0, revote: 0, override: 0, enacted: 0, hours: [] };
  for (const r of runs) {
    if (r.smPass) a.sm++;
    if (r.firstRaw === "needs_more_votes") a.firstRawNeeds++;
    a.first[r.first]++;
    if (r.objection === "valid") a.objectionValid++;
    if (r.revote) a.revote++;
    if (r.override) a.override++;
    if (r.enacted) a.enacted++;
    a.hours.push(r.hours);
  }
  return a;
}

function repeat(env: Env, spec: Spec | ((rng: Rng) => Spec), n: number, seed: string, opts: RunOpts = {}): Agg {
  const rng = createRng(seed);
  const runs: RunResult[] = [];
  for (let i = 0; i < n; i++) runs.push(runProposal(env, typeof spec === "function" ? spec(rng) : spec, rng, opts));
  return aggregate(runs);
}

function approxApproval(pop: Pop, spec: Spec): number {
  // Beklenen onay (gürültü ve kişisel eğilim yaklaşık; yalnız tablo açıklaması için)
  let y = 0;
  let t = 0;
  pop.sizes.forEach((size, b) => {
    const turnout = spec.turnout?.[b] ?? BASE_TURNOUT;
    const w = size * turnout;
    y += w * logistic(spec.logits[b] / Math.sqrt(1 + (Math.PI * (0.25 + VOTE_NOISE ** 2)) / 8));
    t += w;
  });
  return t ? y / t : 0;
}

// ───────────────────────── Senaryolar ─────────────────────────

const out: string[] = [];
const summary: string[] = [];
const log = (s: string) => console.log(s);
const t0 = performance.now();

const T0 = defaultDecisionParams("T0");
const T1 = defaultDecisionParams("T1");
const HIST = 40;

// Standart nüfus: 60/30/10, |E| = 300, %5 yeni üye (kümelenmemiş)
const stdRng = createRng(`${MASTER_SEED}|std`);
const stdPop = makePop([180, 90, 30], stdRng);
const stdHist = makeHistory(stdPop, stdRng, HIST, historySpec(3), "h");
const stdSnap = snapshot(stdPop, stdHist, `${MASTER_SEED}|std|cluster`);
const stdEnv: Env = { pop: stdPop, snap: stdSnap, params: T0 };
const clusterOfBlock = (b: number) => Object.keys(stdSnap.majorityBlock).find((g) => stdSnap.majorityBlock[g] === b) ?? "—";
log(`Standart küme anlık görüntüsü: ${describeSnap(stdSnap)}`);

function specRow(name: string, spec: Spec, a: Agg, extra: (string | number)[] = []): (string | number)[] {
  return [
    name,
    spec.logits.map((l) => num(l, 1)).join(" / "),
    pct(approxApproval(stdPop, spec), 0),
    pct(a.sm / a.n),
    pct(a.first.accept / a.n),
    pct(a.first.contested / a.n),
    pct(a.first.reject / a.n),
    pct(a.enacted / a.n),
    ...extra,
  ];
}

const HEAD = ["Öneri tipi", "Logit A / B / C", "≈ onay", "Basit çoğunluk: kabul", "KÇ 1. tur kabul", "KÇ 1. tur contested", "KÇ 1. tur red", "KÇ nihai kabul"];

// (a) Azınlığa zarar veren öneriler
const N_A = 1000;
const scA = [
  { name: "C'ye zararlı (A+B evet, C güçlü hayır)", spec: { logits: [1.5, 0.5, -3] } as Spec, objection: [0, 0, 0.8] },
  { name: "B'ye zararlı (A evet, B güçlü hayır)", spec: { logits: [2.0, -2.5, 0.5] } as Spec, objection: [0, 0.8, 0] },
  { name: "B ve C'ye zararlı (yalnız A evet)", spec: { logits: [2.5, -2.0, -2.5] } as Spec, objection: [0, 0.8, 0.8] },
];
const aRows: (string | number)[][] = [];
const aAggs: Agg[] = [];
scA.forEach((s, i) => {
  const a = repeat(stdEnv, s.spec, N_A, `${MASTER_SEED}|a|${i}`, { objection: s.objection });
  aAggs.push(a);
  aRows.push(specRow(s.name, s.spec, a, [pct(a.override / a.n)]));
});
const softened = repeat(stdEnv, scA[0].spec, N_A, `${MASTER_SEED}|a|soft`, { objection: scA[0].objection, revoteSpec: { logits: [1.3, 0.6, -0.5] } });
aRows.push(specRow("C'ye zararlı; uzlaşmada metin yumuşatılır (yeniden oylama: 1,3 / 0,6 / −0,5)", scA[0].spec, softened, [pct(softened.override / softened.n)]));
log(`(a) tamam ${Math.round(performance.now() - t0)} ms`);

// (b) Köprü kuran öneriler
const N_B = 1000;
const scB = [
  { name: "Geniş destek (herkes ılımlı evet)", spec: { logits: [1.2, 1.0, 0.8] } as Spec },
  { name: "Zayıf ama ortak destek", spec: { logits: [0.5, 0.4, 0.3] } as Spec },
  { name: "A+B evet, C kararsız", spec: { logits: [1.5, 1.0, 0.0] } as Spec },
  { name: "Ortak ret (herkes hayır)", spec: { logits: [-1.0, -0.8, -0.6] } as Spec },
];
const bRows: (string | number)[][] = [];
const bAggs: Agg[] = [];
scB.forEach((s, i) => {
  const a = repeat(stdEnv, s.spec, N_B, `${MASTER_SEED}|b|${i}`, { objection: [0.3, 0.3, 0.3] });
  bAggs.push(a);
  bRows.push(specRow(s.name, s.spec, a, [pct(a.firstRawNeeds / a.n), num(mean(a.hours) / 24, 1)]));
});
const bT1 = repeat({ ...stdEnv, params: T1 }, scB[0].spec, N_B, `${MASTER_SEED}|b|T1`, { objection: [0.3, 0.3, 0.3] });
bRows.push(specRow("Geniş destek — T1 (nitelikli)", scB[0].spec, bT1, [pct(bT1.firstRawNeeds / bT1.n), num(mean(bT1.hours) / 24, 1)]));
log(`(b) tamam ${Math.round(performance.now() - t0)} ms`);

// (c) Azınlık tiranlığı / liberum veto: %10'luk C bloğu her şeye aktif "hayır" der ve itiraz eder
const N_C = 500;
const scC = [
  { name: "Çok popüler (A, B güçlü evet)", spec: { logits: [2.5, 2.0, -4] } as Spec },
  { name: "Popüler", spec: { logits: [1.5, 1.0, -4] } as Spec },
  { name: "Az farkla popüler", spec: { logits: [1.0, 0.3, -4] } as Spec },
  { name: "Popüler; C bölünmüş (yarısı evet)", spec: { logits: [1.5, 1.0, 0.0] } as Spec },
];
const cRows: (string | number)[][] = [];
const cAggs: Agg[] = [];
scC.forEach((s, i) => {
  const a = repeat(stdEnv, s.spec, N_C, `${MASTER_SEED}|c|${i}`, { objection: [0, 0, 1.0] });
  cAggs.push(a);
  cRows.push([
    s.name,
    s.spec.logits.map((l) => num(l, 1)).join(" / "),
    pct(approxApproval(stdPop, s.spec), 0),
    pct(a.first.accept / a.n),
    pct(a.first.contested / a.n),
    pct(a.objectionValid / a.n),
    pct(a.override / a.n),
    pct(a.enacted / a.n),
    "%0,0",
    num(mean(a.hours) / 24, 1),
  ]);
});
log(`(c) tamam ${Math.round(performance.now() - t0)} ms`);

// (d) Boykot
const N_D = 500;
const scD = [
  { name: "C aktif hayır (katılım %55)", spec: { logits: [1.5, 1.0, -3], turnout: [0.55, 0.55, 0.55] } as Spec, params: T0 },
  { name: "C boykot (katılım %0)", spec: { logits: [1.5, 1.0, -3], turnout: [0.55, 0.55, 0] } as Spec, params: T0 },
  { name: "C neredeyse boykot (katılım %3)", spec: { logits: [1.5, 1.0, -3], turnout: [0.55, 0.55, 0.03] } as Spec, params: T0 },
  { name: "C neredeyse boykot — T1 (φ = 0,40)", spec: { logits: [1.5, 1.0, -3], turnout: [0.55, 0.55, 0.03] } as Spec, params: T1 },
  { name: "B aktif hayır", spec: { logits: [2.0, -2.5, 0.5], turnout: [0.55, 0.55, 0.55] } as Spec, params: T0 },
  { name: "B boykot", spec: { logits: [2.0, -2.5, 0.5], turnout: [0.55, 0, 0.55] } as Spec, params: T0 },
];
const dRows: (string | number)[][] = [];
const dAggs: Agg[] = [];
scD.forEach((s, i) => {
  const a = repeat({ ...stdEnv, params: s.params }, s.spec, N_D, `${MASTER_SEED}|d|${i}`);
  dAggs.push(a);
  dRows.push([s.name, pct(a.sm / a.n), pct(a.firstRawNeeds / a.n), pct(a.first.accept / a.n), pct(a.first.contested / a.n), pct(a.enacted / a.n)]);
});
log(`(d) tamam ${Math.round(performance.now() - t0)} ms`);

// (e) Küçük N ve soğuk başlangıç
const smallNs: { E: number; sizes: number[] }[] = [
  { E: 8, sizes: [5, 2, 1] },
  { E: 15, sizes: [9, 4, 2] },
  { E: 30, sizes: [18, 9, 3] },
];
const smallTypes = [
  { name: "Geniş destek", spec: { logits: [1.2, 1.0, 0.8], turnout: [0.65, 0.65, 0.65] } as Spec },
  { name: "Dar çoğunluk", spec: { logits: [0.6, -0.2, -0.4], turnout: [0.65, 0.65, 0.65] } as Spec },
  { name: "C'ye zararlı", spec: { logits: [1.5, 0.5, -3], turnout: [0.65, 0.65, 0.65] } as Spec },
];
const E_REPS = 30;
const E_PER = 40;
const eRows: (string | number)[][] = [];
const eInfo: (string | number)[][] = [];
for (const { E, sizes } of smallNs) {
  const perType = smallTypes.map(() => [] as RunResult[]);
  let bridgeApplicable = 0;
  let kSum = 0;
  let protectedC = 0;
  for (let rep = 0; rep < E_REPS; rep++) {
    const rng = createRng(`${MASTER_SEED}|e|${E}|${rep}`);
    const pop = makePop(sizes, rng, 0);
    const snap = snapshot(pop, makeHistory(pop, rng, 30, historySpec(3), "h"), `${MASTER_SEED}|e|${E}|${rep}|cluster`);
    const env: Env = { pop, snap, params: T0 };
    kSum += snap.comp.k;
    if (blockProtected(pop, snap, 2, T0)) protectedC++;
    smallTypes.forEach((t, i) => {
      for (let j = 0; j < E_PER; j++) {
        const r = runProposal(env, t.spec, rng, { objection: [0, 0, 0.8] });
        perType[i].push(r);
        if (i === 0 && j === 0 && r.firstResult.bridgeApplicable) bridgeApplicable++;
      }
    });
  }
  eInfo.push([E, sizes.join("/"), quorumRequired(T0.quorum, E), floorAbs(E), num(kSum / E_REPS, 1), pct(bridgeApplicable / E_REPS, 0), pct(protectedC / E_REPS, 0)]);
  smallTypes.forEach((t, i) => {
    const a = aggregate(perType[i]);
    eRows.push([E, t.name, pct(a.sm / a.n), pct(a.firstRawNeeds / a.n), pct(a.first.accept / a.n), pct(a.first.contested / a.n), pct(a.enacted / a.n)]);
  });
}
log(`(e) tamam ${Math.round(performance.now() - t0)} ms`);

// (f) Vekâlet yoğunlaşması ve sınır (cap)
const F_PROPOSALS = 300;
const fRng = createRng(`${MASTER_SEED}|f`);
const fInfluencers: string[] = [];
const fDelegations: DelegationEdge[] = [];
{
  // 15 "ünlü" delege: 12'si A'dan, 2'si B'den, 1'i C'den; Zipf ağırlıkları
  const byBlock = [0, 1, 2].map((b) => stdPop.people.filter((p) => p.block === b && !p.newcomer).map((p) => p.id));
  fInfluencers.push(...byBlock[0].slice(0, 12), ...byBlock[1].slice(0, 2), byBlock[2][0]);
  const weights = fInfluencers.map((_, i) => 1 / (i + 1));
  const pickInfluencer = (): string => {
    const total = weights.reduce((a, b) => a + b, 0);
    let r = fRng.next() * total;
    for (let i = 0; i < weights.length; i++) if ((r -= weights[i]) <= 0) return fInfluencers[i];
    return fInfluencers[weights.length - 1];
  };
  const own = (b: number) => fInfluencers.filter((u) => stdPop.blockOf.get(u) === b);
  let created = 0;
  for (const p of stdPop.people) {
    if (fInfluencers.includes(p.id) || fRng.next() >= 0.6) continue;
    let to: string;
    const r = fRng.next();
    if (r < 0.7) to = pickInfluencer();
    else if (r < 0.85 && own(p.block).length > 0) to = own(p.block)[fRng.int(own(p.block).length)];
    else to = stdPop.people[fRng.int(stdPop.people.length)].id; // sıradan bir üye (zincir oluşabilir)
    if (to === p.id) continue;
    fDelegations.push({ id: `d${created}`, from: p.id, to, scope: "*", rank: 1, createdAt: created++ });
  }
}
const fCap = delegationCap(stdPop.people.length);
const fStats = { cap: { maxLoad: [] as number[], top: [] as number[], gini: [] as number[], unrouted: [] as number[], participation: [] as number[], accept: 0, contested: 0 }, none: { maxLoad: [] as number[], top: [] as number[], gini: [] as number[], unrouted: [] as number[], participation: [] as number[], accept: 0, contested: 0 } };
let fDiff = 0;
let fCrossC = 0;
let fCDelegated = 0;
const fGen = (rng: Rng): Spec => {
  const c = 0.6 * gauss(rng);
  return { logits: [c + 1.2 * gauss(rng), c + 1.2 * gauss(rng), c + 1.2 * gauss(rng)], turnout: [0.3, 0.3, 0.3] };
};
for (let i = 0; i < F_PROPOSALS; i++) {
  const spec = fGen(fRng);
  const direct = castVotes(stdPop, spec, fRng);
  for (const inf of fInfluencers) if (!direct.has(inf) && fRng.next() < 0.95) direct.set(inf, choose(stdPop.people.find((p) => p.id === inf)!, spec, fRng));
  const outcomes: Record<string, DecisionOutcome> = {};
  for (const [key, cap] of [["cap", fCap], ["none", 1e9]] as const) {
    const res = resolveEffectiveVotes({ eligible: stdPop.people.map((p) => p.id), direct, delegations: fDelegations, scopeOrder: ["*"], cap, maxHops: 3, clusterOf: stdSnap.clusterOf });
    const loads = Object.values(res.loads);
    const delegatedTotal = loads.reduce((a, b) => a + b, 0);
    const s = fStats[key];
    s.maxLoad.push(loads.length ? Math.max(...loads) : 0);
    s.top.push(delegatedTotal ? Math.max(...loads) / stdPop.people.length : 0);
    s.gini.push(gini(loads));
    s.unrouted.push(res.unrouted.length);
    s.participation.push(res.votes.length / stdPop.people.length);
    const r = decideRound(stdEnv, res.votes, 1, false);
    outcomes[key] = r.outcome;
    if (r.outcome === "accept") s.accept++;
    if (r.outcome === "contested") s.contested++;
    if (key === "cap") {
      for (const v of res.votes) {
        if (v.via !== "delegated" || stdPop.blockOf.get(v.voterKey) !== 2) continue;
        fCDelegated++;
      }
    }
  }
  if (outcomes.cap !== outcomes.none) fDiff++;
}
{
  // C üyelerinin vekâletlerinden kaçı C dışından bir delegeye gidiyor (yapısal ölçü)
  const cDel = fDelegations.filter((e) => stdPop.blockOf.get(e.from) === 2);
  fCrossC = cDel.length ? cDel.filter((e) => stdPop.blockOf.get(e.to) !== 2).length / cDel.length : 0;
}
log(`(f) tamam ${Math.round(performance.now() - t0)} ms`);

// (g) Kalıcı kaybeden: 200 karar boyunca blokların kaybettiği karar oranı
const G_REPS = 8;
const G_DECISIONS = 200;
const AFFINITY = [
  [1, 0.2, -0.6],
  [0.2, 1, 0.4],
  [-0.6, 0.4, 1],
];
function streamSpec(pop: Pop, rng: Rng): Spec {
  if (rng.next() < 0.25) {
    const c = 1.0 + 0.5 * gauss(rng);
    return { logits: [0, 1, 2].map(() => c + 0.4 * gauss(rng)) };
  }
  const total = pop.sizes.reduce((a, b) => a + b, 0);
  let r = rng.next() * total;
  let author = 0;
  for (let b = 0; b < pop.sizes.length; b++) if ((r -= pop.sizes[b]) < 0) { author = b; break; }
  const la = 1.6 + 0.5 * gauss(rng);
  return { logits: [0, 1, 2].map((b) => (b === author ? la : AFFINITY[author][b] * la + 1.0 * gauss(rng))) };
}
type GMethod = "sm" | "kc";
const gStats: Record<GMethod, { lost: number[]; harmed: number[]; blocked: number[]; decided: number[]; enacted: number }> = {
  sm: { lost: [0, 0, 0], harmed: [0, 0, 0], blocked: [0, 0, 0], decided: [0, 0, 0], enacted: 0 },
  kc: { lost: [0, 0, 0], harmed: [0, 0, 0], blocked: [0, 0, 0], decided: [0, 0, 0], enacted: 0 },
};
const gHours: number[] = [];
let gContested = 0;
let gOverride = 0;
let gObjection = 0;
for (let rep = 0; rep < G_REPS; rep++) {
  const rng = createRng(`${MASTER_SEED}|g|${rep}`);
  const pop = makePop([180, 90, 30], rng);
  const history = makeHistory(pop, rng, HIST, (r) => streamSpec(pop, r), "h");
  let snap = snapshot(pop, history, `${MASTER_SEED}|g|${rep}|0`);
  for (let dIdx = 0; dIdx < G_DECISIONS; dIdx++) {
    if (dIdx > 0 && dIdx % 50 === 0) snap = snapshot(pop, history, `${MASTER_SEED}|g|${rep}|${dIdx}`);
    const env: Env = { pop, snap, params: T0 };
    const spec = streamSpec(pop, rng);
    const r = runProposal(env, spec, rng, { objection: [0.5, 0.5, 0.5] });
    history.push(...toEntries(r.round1, `s${String(dIdx).padStart(4, "0")}`));
    if (r.first === "contested") gContested++;
    if (r.override) gOverride++;
    if (r.objection === "valid") gObjection++;
    gHours.push(r.hours);
    const yes = [0, 0, 0];
    const no = [0, 0, 0];
    for (const [u, c] of r.round1) {
      const b = pop.blockOf.get(u)!;
      if (c === "yes") yes[b]++;
      else if (c === "no") no[b]++;
    }
    for (const [m, pass] of [["sm", r.smPass], ["kc", r.enacted]] as [GMethod, boolean][]) {
      const s = gStats[m];
      if (pass) s.enacted++;
      for (let b = 0; b < 3; b++) {
        if (yes[b] === no[b]) continue;
        const wants = yes[b] > no[b];
        s.decided[b]++;
        if (wants !== pass) s.lost[b]++;
        if (!wants && pass) s.harmed[b]++;
        if (wants && !pass) s.blocked[b]++;
      }
    }
  }
}
const G_TOTAL = G_REPS * G_DECISIONS;
log(`(g) tamam ${Math.round(performance.now() - t0)} ms`);

// (h) Kümeleme sağlığı: homojen nüfusta siluet kuralı (§9.4) ve permütasyon sıfır modeli
function permuted(entries: VoteMatrixEntry[], seed: string): VoteMatrixEntry[] {
  const rng = createRng(seed);
  const byP = new Map<string, VoteMatrixEntry[]>();
  for (const e of entries) {
    let l = byP.get(e.proposalId);
    if (!l) byP.set(e.proposalId, (l = []));
    l.push(e);
  }
  const res: VoteMatrixEntry[] = [];
  for (const p of [...byP.keys()].sort()) {
    const es = byP.get(p)!;
    const vals = rng.shuffle(es.map((e) => e.value));
    es.forEach((e, i) => res.push({ ...e, value: vals[i] }));
  }
  return res;
}
const H_SEEDS = 5;
const hRows: (string | number)[][] = [];
const hPop = { homo: [] as number[], block: [] as number[] };
let hSpuriousContested = 0;
let hColdDiff = 0;
let hDecisions = 0;
for (const [label, sizes, spread] of [
  ["60/30/10 bloklu", [180, 90, 30], 1.6],
  ["Homojen (tek blok)", [300], 0],
  ["Homojen + güçlü bireysel gürültü", [300], 0],
] as [string, number[], number][]) {
  const ks: number[] = [];
  const sils: number[] = [];
  const nulls: number[] = [];
  const purities: number[] = [];
  for (let s = 0; s < H_SEEDS; s++) {
    const rng = createRng(`${MASTER_SEED}|h|${label}|${s}`);
    const pop = makePop(sizes, rng, 0);
    if (label.includes("gürültü")) for (const p of pop.people) p.bias = 1.5 * gauss(rng);
    const gen = sizes.length > 1 ? historySpec(3, spread) : (r: Rng) => ({ logits: [0.8 * gauss(r)] });
    const hist = makeHistory(pop, rng, HIST, gen, "h");
    const snap = snapshot(pop, hist, `${MASTER_SEED}|h|${label}|${s}|c`);
    ks.push(snap.comp.k);
    sils.push(snap.comp.silhouette);
    purities.push(snap.purity);
    nulls.push(mean([0, 1, 2].map((i) => computeClusters(permuted(hist, `${label}|${s}|perm${i}`), `${MASTER_SEED}|h|null`).silhouette)));
    if (sizes.length === 1) {
      const env: Env = { pop, snap, params: T0 };
      for (let j = 0; j < 100; j++) {
        const spec: Spec = { logits: [0.2 + 0.8 * gauss(rng)] };
        const v = effective(env, castVotes(pop, spec, rng));
        const real = decideRound(env, v, 1, false);
        const cold = decideRound(env, v, 1, false, null, { k: 1 });
        hDecisions++;
        if (real.outcome === "contested") hSpuriousContested++;
        if (real.outcome !== cold.outcome) hColdDiff++;
      }
    }
  }
  (sizes.length > 1 ? hPop.block : hPop.homo).push(mean(sils) - mean(nulls));
  hRows.push([label, ks.join(", "), num(mean(sils), 3), num(mean(nulls), 3), num(mean(sils) - mean(nulls), 3), sizes.length > 1 ? pct(mean(purities)) : "—"]);
}
log(`(h) tamam ${Math.round(performance.now() - t0)} ms`);

// ───────────────────────── Rapor ─────────────────────────

const aC = aAggs[0];
const aB = aAggs[1];
const aBC = aAggs[2];
const bBroad = bAggs[0];
const cVery = cAggs[0];
const cNarrow = cAggs[2];
const dBoycott = dAggs[1];
const dActive = dAggs[0];

summary.push(
  `- **Çoğunluk tiranlığı:** C'ye (%10) zarar veren önerilerin basit çoğunlukta ${pct(aC.sm / aC.n)}'i geçiyor; KÇ'de ilk tur kabul ${pct(aC.first.accept / aC.n)}, nihai kabul ${pct(aC.enacted / aC.n)} (geçenler yalnızca yeniden oylamada ω = 2/3 ile). B'ye zararlı önerilerde: basit çoğunluk ${pct(aB.sm / aB.n)}, KÇ nihai ${pct(aB.enacted / aB.n)}. Yalnız A'nın istediği önerilerde: ${pct(aBC.sm / aBC.n)} → ${pct(aBC.enacted / aBC.n)}.`,
  `- **İyi önerileri engellemiyor:** Geniş destekli önerilerin kabul oranı basit çoğunlukta ${pct(bBroad.sm / bBroad.n)}, KÇ'de ${pct(bBroad.enacted / bBroad.n)}; ortalama süre ${num(mean(bBroad.hours) / 24, 1)} gün.`,
  `- **Liberum veto yok:** %10'luk blok her öneriye aktif "hayır" deyip itiraz etse de çok popüler öneriler KÇ'de ${pct(cVery.enacted / cVery.n)} oranında yürürlüğe giriyor (gecikme: ortalama ${num(mean(cVery.hours) / 24, 1)} gün). Azınlık yalnızca 2/3'ün altında kalan önerileri durdurabiliyor (az farkla popüler: ${pct(cNarrow.enacted / cNarrow.n)}).`,
  `- **Boykot işe yaramıyor:** C boykot ettiğinde önerilerin ${pct(dBoycott.firstRawNeeds / dBoycott.n)}'i bir kez uzatılıyor ve nihai kabul ${pct(dBoycott.enacted / dBoycott.n)}; aynı öneriye aktif "hayır" dendiğinde ilk tur contested oranı ${pct(dActive.first.contested / dActive.n)}.`,
  `- **Vekâlet sınırı:** sınır (${fCap}) ile tek bir delegenin taşıdığı en fazla oy ${num(mean(fStats.cap.maxLoad), 1)} (|E|'nin ${pct(mean(fStats.cap.top))}'i); sınırsız durumda ${num(mean(fStats.none.maxLoad), 1)} (${pct(mean(fStats.none.top))}).`,
  `- **Kalıcı kaybeden:** C bloğunun istemediği halde kabul edilen karar oranı basit çoğunlukta ${pct(gStats.sm.harmed[2] / G_TOTAL)}, KÇ'de ${pct(gStats.kc.harmed[2] / G_TOTAL)}; C'nin toplam kaybetme oranı ${pct(gStats.sm.lost[2] / gStats.sm.decided[2])} → ${pct(gStats.kc.lost[2] / gStats.kc.decided[2])}.`,
  `- **Kümeleme uyarısı:** §9.4'teki "siluet < 0,25 → K = 1" kuralı 2 boyutlu PCA uzayında homojen nüfusta tetiklenmiyor (bulunan K: ${hRows[1][1]}); bkz. (h).`,
);

out.push(
  "# Simülasyon Raporu — Köprülü Çoğunluk (KÇ-1.0) ve Basit Çoğunluk",
  "",
  "> Bu dosya `npm run sim -w server` (`server/scripts/simulate.ts`) tarafından **üretilir**; elle düzenlemeyin.",
  `> Ana tohum: \`${MASTER_SEED}\`. Tüm rastgelelik tohumludur; aynı kod ve tohumla aynı rapor üretilir.`,
  "",
  "## Özet",
  "",
  ...summary,
  "",
  "## Yöntem",
  "",
  "- **Gerçek kod:** Her karar `@forum/shared` içindeki `decide()` ve `evaluateObjection()` ile; kümeler `computeClusters()` ile simüle oy geçmişinden; vekâlet `resolveEffectiveVotes()` ile hesaplanır. Basitleştirilmiş bir yeniden uygulama kullanılmaz.",
  "- **Nüfus:** Bloklar A/B/C (%60/%30/%10). Standart nüfus |E| = 300; üyelerin %5'i yeni üyedir (oy geçmişi yok → kümelenmemiş; genel onaya sayılır, köprüye katılmaz). Her kişinin kalıcı bir eğilimi vardır (logit, N(0; 0,5²)).",
  `- **Oy modeli:** Öneri, blok başına bir logit destek ile tanımlanır. Kişi \`katılım\` olasılığıyla (varsayılan %${Math.round(BASE_TURNOUT * 100)}) oy verir; %${Math.round(ABSTAIN * 100)} çekimser; aksi halde P(evet) = σ(logit_blok + eğilim + N(0; ${num(VOTE_NOISE, 1)}²)). Uzatmada oy vermemişler katılım × ${num(EXT_FACTOR, 2)} olasılıkla geç katılır.`,
  `- **Küme anlık görüntüsü:** ${HIST} kapanmış önerilik geçmişten (ortak değer + bloğa özgü sapma, sapma ölçeği 1,6) hesaplanır. Standart nüfus için: ${describeSnap(stdSnap)}.`,
  "- **Süreç (ALGORITMA §3):** ilk tur → (gerekirse bir kez uzatma) → kabulse itiraz penceresi (`evaluateObjection`) → geçerli itiraz ya da contested ise uzlaşma + yeniden oylama (uzatma hakkı yeniden). Yeniden oylamada tercihler aynı dağılımdan yeniden örneklenir (ikna/değişiklik etkisi yok, aksi belirtilmedikçe) — bu, KÇ için **kötümser** bir varsayımdır.",
  "- **Basit çoğunluk (karşılaştırma):** aynı ilk tur oyları; aynı yeter sayı kuralı (`min(|E|, max(⌈q·|E|⌉, ⌈1,5·√|E|⌉))`), yeter sayı yoksa bir kez uzatma; kabul ⇔ evet > hayır. Köprü, itiraz ve yeniden oylama yok.",
  "- **≈ onay** sütunu yalnız yönlendirme amaçlı yaklaşık beklenen onaydır; asıl oranlar simülasyondan gelir.",
  "",
  "Kullanılan parametreler (ALGORITMA §2 varsayılanları):",
  "",
  ...table(
    ["Katman", "q", "τ", "φ", "ω", "ρ", "Süreler (oylama/uzatma/itiraz/uzlaşma, saat)"],
    (["T0", "T1"] as const).map((t) => {
      const p = defaultDecisionParams(t);
      const d = p.durationsHours;
      return [t, ratToPercent(p.quorum, 0), `${p.thresholdStrict ? ">" : "≥"} ${ratToPercent(p.threshold, 0)}`, ratToPercent(p.clusterFloor, 0), ratToPercent(p.overrideThreshold), ratToPercent(p.revoteThreshold, 0), `${d.voting}/${d.extension}/${d.objection}/${d.reconciliation}`];
    }),
  ),
  "",
  "Ortak: σ_share = %10, σ_min = 3, μ_votes = 2, n_C,min = 12, δ_cold = +0,10 (en çok 2/3), cap = max(2, ⌈0,05·|E|⌉), H = 3.",
  "",
  "## (a) Azınlığa zarar veren öneriler",
  "",
  `Tohum: \`${MASTER_SEED}|a|*\`; her satır ${N_A} öneri; T0; standart nüfus (|E| = 300). Zarar gören bloğun "hayır" diyen üyeleri itirazı %80 olasılıkla imzalar.`,
  "",
  ...table([...HEAD, "Aşma (ω) ile kabul"], aRows),
  "",
  `**Yorum.** Basit çoğunlukta azınlığa zarar veren önerilerin çoğu doğrudan geçer. KÇ'de azınlık kümesinin Laplace desteği tabanın (φ = 0,30) altında kaldığı için bu öneriler ilk turda **contested** olur ve uzlaşmaya gider. Yeniden oylamada öneri yalnızca a ≥ 2/3 ile (ω) geçebilir; bu nedenle C'ye zararlı önerilerin nihai kabul oranı ${pct(aC.enacted / aC.n)}'e iner. Bu öneriler ancak geniş bir nitelikli çoğunlukla geçebilir. Uzlaşmada metin azınlığın itirazına göre yumuşatıldığında (son satır) kabul oranı ${pct(softened.enacted / softened.n)} olur: mekanizmanın amacı önerileri öldürmek değil, **azınlığı da kazanan** bir metne zorlamaktır.`,
  "",
  "## (b) Köprü kuran (geniş destekli) öneriler",
  "",
  `Tohum: \`${MASTER_SEED}|b|*\`; her satır ${N_B} öneri; "hayır" diyenler %30 olasılıkla itiraz imzalar.`,
  "",
  ...table([...HEAD, "1. turda uzatma", "Ort. süre (gün)"], bRows),
  "",
  `**Yorum.** Bütün kümelerin desteklediği önerilerde iki yöntem neredeyse aynı oranda kabul eder (geniş destek: ${pct(bBroad.sm / bBroad.n)} ve ${pct(bBroad.enacted / bBroad.n)}). KÇ iyi önerileri engellemez; maliyeti, kabul edilen önerilerde itiraz penceresi kadar (T0: 48 saat) gecikmedir. C'nin kararsız kaldığı durumda Laplace yumuşatması C'yi nötr (P ≈ 0,5) sayar ve öneri geçer. Ortak ret durumunda iki yöntem de reddeder. T1'de eşik %60 olduğu için kabul oranı daha düşüktür; bu katmanın tasarımıdır.`,
  "",
  "## (c) Azınlık tiranlığı / liberum veto",
  "",
  `Tohum: \`${MASTER_SEED}|c|*\`; her satır ${N_C} öneri. C bloğu (%10) **her** öneriye güçlü "hayır" der (logit −4) ve "hayır" diyen her C üyesi itirazı imzalar. "Küme vetosu" sütunu, aşma eşiği olmayan saf bir eşzamanlı çoğunluk kuralının (her anlamlı küme P_g ≥ φ olmadan asla kabul yok) sonucudur.`,
  "",
  ...table(["Öneri tipi", "Logit A / B / C", "≈ onay", "KÇ 1. tur kabul", "KÇ 1. tur contested", "Geçerli itiraz", "Aşma (ω) ile kabul", "KÇ nihai kabul", "Küme vetosu: kabul", "Ort. süre (gün)"], cRows),
  "",
  `**Yorum.** %10'luk blok popüler bir öneriyi **süresiz engelleyemez**: güçlü "hayır" öneriyi bir kez uzlaşmaya gönderir (erteleme), ardından yeniden oylamada 2/3 eşiği aşılırsa öneri yürürlüğe girer. Çok popüler önerilerde nihai kabul ${pct(cVery.enacted / cVery.n)}'dir. Bedeli ortalama ${num(mean(cVery.hours) / 24, 1)} günlük bir gecikmedir. Uzlaşma turu en fazla bir kez yaşanır ve yeniden oylamadan sonra itiraz yoktur; bu nedenle azınlık aynı öneriyi ikinci kez durduramaz. Saf küme vetosu bu önerilerin hepsini kalıcı olarak durdururdu. Yalnızca az farkla popüler önerilerde (onay 2/3'ün altında) azınlığın aktif muhalefeti sonucu değiştirir (${pct(cNarrow.enacted / cNarrow.n)}). Bu, tasarımın bilinçli bir sonucudur: bir azınlığın güçlü itiraz ettiği bir kararı almak için nitelikli çoğunluk gerekir. C bölündüğünde öneri ilk turda kabul edilir ve C'nin "hayır" diyenleri itiraz eder. İtiraz geçerliyse yeniden oylamada ρ (%60) ya da güçlü itirazda 2/3 aranır.`,
  "",
  "## (d) Boykot",
  "",
  `Tohum: \`${MASTER_SEED}|d|*\`; her satır ${N_D} öneri; itiraz yok.`,
  "",
  ...table(["Senaryo", "Basit çoğunluk: kabul", "1. turda uzatma", "KÇ 1. tur kabul (uzatma sonrası)", "KÇ 1. tur contested", "KÇ nihai kabul"], dRows),
  "",
  `**Yorum.** Hiç oy vermeyen bir küme için P_g = (1+0)/(2+0) = 1/2 ≥ φ olur. Bu yüzden boykot **bir engel aracı değildir**. Boykot yalnızca μ_votes eksikliği nedeniyle tek seferlik uzatmayı tetikler (${pct(dBoycott.firstRawNeeds / dBoycott.n)}); uzatmadan sonra küme nötr sayılır ve öneri geçer (${pct(dBoycott.enacted / dBoycott.n)}). Azınlık bir kararı ancak *aktif olarak hayır diyerek* durdurabilir. **Dikkat (T1/T2):** Uzatmadan sonra bir kümede yalnızca tek bir "hayır" oyu varsa P_g = 1/3 olur. Bu değer T0 tabanını (0,30) geçer ama T1/T2 tabanının (0,40) altında kalır. Bu durumda büyük bir kümenin neredeyse tamamen sessiz kaldığı bir oylamada tek bir kişi contested sonucunu tetikleyebilir (T1 satırı). Etki erteleyicidir (bir uzlaşma turu, sonra ω).`,
  "",
  "## (e) Küçük topluluklar ve soğuk başlangıç",
  "",
  `Tohum: \`${MASTER_SEED}|e|<|E|>|<tekrar>\`; her |E| için ${E_REPS} farklı geçmiş (30 öneri) ve küme anlık görüntüsü; her görüntüde öneri tipi başına ${E_PER} öneri; katılım %65; T0.`,
  "",
  ...table(["|E|", "Bloklar A/B/C", "Gerekli katılım (T0)", "floor_abs", "Ort. K", "Köprü uygulanabilir", "C anlamlı kümeyle temsil"], eInfo),
  "",
  ...table(["|E|", "Öneri tipi", "Basit çoğunluk: kabul", "1. turda uzatma", "KÇ 1. tur kabul", "KÇ 1. tur contested", "KÇ nihai kabul"], eRows),
  "",
  "**Yorum.** |E| = 8 iken n_C < 12 olduğundan köprü testi hiç uygulanmaz (soğuk başlangıç). Bu durumda T0 eşiği %60'a yükselir ve `≥` ile karşılaştırılır. Dar çoğunluklu önerilerin kabul oranı bu nedenle basit çoğunluğa göre düşer. Mutlak taban `floor_abs = ⌈1,5·√|E|⌉` küçük gruplarda q·|E|'den büyüktür (|E| = 8 için 5 kişi). Gerekli katılımın |E|'yi aşmaması kuralı sayesinde kabul her zaman mümkündür. |E| = 15'te C bloğu 2 kişidir ve σ_min = 3 nedeniyle anlamlı küme oluşturamaz. Küçük gruplarda azınlığın korunması bu yüzden soğuk başlangıçtaki nitelikli çoğunluğa ve itiraz kuralına kalır. |E| = 30'da C (3 kişi, %10) sınırda anlamlıdır. C'nin ayrı ve anlamlı bir kümeyle temsil edildiği tekrarlarda KÇ, C'ye zararlı önerileri contested yapar.",
  "",
  "## (f) Vekâlet yoğunlaşması ve sınır (cap)",
  "",
  `Tohum: \`${MASTER_SEED}|f\`; standart nüfus; ${F_PROPOSALS} karışık öneri; doğrudan katılım %30 (ünlü delegeler %95). Üyelerin ~%60'ı vekâlet verir: %70'i Zipf ağırlıklı 15 "ünlü" delegeden birine (12'si A, 2'si B, 1'i C), %15'i kendi bloğundaki bir ünlüye, %15'i rastgele bir üyeye (zincirler). Kapsam "*", H = 3. Sınır: cap = max(2, ⌈0,05·300⌉) = ${fCap}.`,
  "",
  ...table(
    ["Durum", "En yüklü delege (ort.)", "En yüklü / |E|", "Delege yükü Gini", "Yönlendirilemeyen (ort.)", "Etkin katılım", "KÇ 1. tur kabul", "KÇ 1. tur contested"],
    (["cap", "none"] as const).map((k) => {
      const s = fStats[k];
      return [k === "cap" ? `Sınır = ${fCap}` : "Sınırsız", num(mean(s.maxLoad), 1), pct(mean(s.top)), num(mean(s.gini), 2), num(mean(s.unrouted), 1), pct(mean(s.participation)), pct(s.accept / F_PROPOSALS), pct(s.contested / F_PROPOSALS)];
    }),
  ),
  "",
  `**Yorum.** Sınır olmadan tek bir delege |E|'nin ${pct(mean(fStats.none.top))}'ini taşıyabilir. Sınırla bu oran ${pct(mean(fStats.cap.top))} ile kalır. Sınırı aşan ortalama ${num(mean(fStats.cap.unrouted), 1)} kişinin oyu kullanılmaz ve bu kişilere bildirim gider. Bu kişiler ya doğrudan oy vermeli ya da başka bir delege seçmelidir. Sonucun sınır yüzünden değiştiği öneri oranı ${pct(fDiff / F_PROPOSALS)}'dir. Vekâlet edilen oy, **delegatörün kendi kümesine** sayılır. Ancak C üyelerinin vekâletlerinin ${pct(fCrossC)}'i C dışındaki delegelere gidiyor. Bu durumda C'nin kümesindeki "oy", başka bir bloğun delegesinin tercihidir. Köprü testi kümeyi korur ama C'nin kendi tercihini değil, C üyelerinin seçtiği delegelerin tercihini ölçer. Bu ödünleşim kullanıcıya açıkça gösterilmelidir.`,
  "",
  "## (g) Kalıcı kaybeden",
  "",
  `Tohum: \`${MASTER_SEED}|g|<tekrar>\`; ${G_REPS} bağımsız tekrar × ${G_DECISIONS} karar = ${G_TOTAL} karar; standart nüfus yapısı; T0. Öneri akışı: %25 ortak yarar (bütün bloklar benzer, olumlu), %75 bir blok tarafından yazılmış (yazar ∝ blok büyüklüğü; yazarın bloğu güçlü evet). Diğer blokların tutumu bir yakınlık matrisiyle belirlenir (A–B +0,2, A–C −0,6, B–C +0,4) ve gürültü eklenir. "Hayır" diyenler %50 olasılıkla itiraz imzalar. Kümeler her 50 kararda bir, birikmiş doğrudan oylardan yeniden hesaplanır. Bir blok, ilk turdaki üyelerinin çoğunluğu nihai sonucun tersini istediğinde o kararı **kaybetmiş** sayılır.`,
  "",
  ...table(
    ["Blok", "Basit çoğunluk: kaybetme", "KÇ: kaybetme", "Basit çoğunluk: istemediği kabul", "KÇ: istemediği kabul", "Basit çoğunluk: istediği red", "KÇ: istediği red"],
    [0, 1, 2].map((b) => [
      `${BLOCK[b]} (%${[60, 30, 10][b]})`,
      pct(gStats.sm.lost[b] / gStats.sm.decided[b]),
      pct(gStats.kc.lost[b] / gStats.kc.decided[b]),
      pct(gStats.sm.harmed[b] / G_TOTAL),
      pct(gStats.kc.harmed[b] / G_TOTAL),
      pct(gStats.sm.blocked[b] / G_TOTAL),
      pct(gStats.kc.blocked[b] / G_TOTAL),
    ]),
  ),
  "",
  `Toplam kabul: basit çoğunluk ${pct(gStats.sm.enacted / G_TOTAL)}, KÇ ${pct(gStats.kc.enacted / G_TOTAL)}. KÇ'de ilk tur contested ${pct(gContested / G_TOTAL)}, geçerli itiraz ${pct(gObjection / G_TOTAL)}, aşma (ω) ile kabul ${pct(gOverride / G_TOTAL)}; ortalama karar süresi ${num(mean(gHours) / 24, 1)} gün.`,
  "",
  `**Yorum.** Basit çoğunlukta küçük blok C, istemediği kararların kabul edilmesine en çok maruz kalan bloktur (${pct(gStats.sm.harmed[2] / G_TOTAL)}). KÇ bu oranı ${pct(gStats.kc.harmed[2] / G_TOTAL)}'e indirir. Bunun karşılığında çoğunluğun istediği bazı kararlar reddedilir (A'nın "istediği red" oranı ${pct(gStats.sm.blocked[0] / G_TOTAL)} → ${pct(gStats.kc.blocked[0] / G_TOTAL)}). KÇ, kaybetme yükünü bloklar arasında daha dengeli dağıtır. Statüko lehine bir eğilim de getirir: kabul oranı ${pct(gStats.sm.enacted / G_TOTAL)} → ${pct(gStats.kc.enacted / G_TOTAL)}.`,
  "",
  "## (h) Kümeleme sağlığı (§9.4 siluet kuralı)",
  "",
  `Tohum: \`${MASTER_SEED}|h|*\`; her satır ${H_SEEDS} tohum, |E| = 300, ${HIST} öneri geçmişi. "Sıfır modeli": her önerinin oyları kullanıcılar arasında rastgele karıştırılır (permütasyon). Bu işlem marjinalleri korur, kişiler arası bağıntıyı yok eder. Aynı boru hattının bu veride verdiği siluet ortalaması (3 permütasyon) raporlanır.`,
  "",
  ...table(["Nüfus", "Bulunan K (tohum başına)", "Siluet (ort.)", "Sıfır modeli siluet", "Fark", "Saflık"], hRows),
  "",
  `Homojen nüfuslarda bulunan (sahte) kümelerle alınan ${hDecisions} kararda contested oranı ${pct(hSpuriousContested / hDecisions)}. Sonucun soğuk başlangıç kuralından (K = 1) farklı olduğu kararların oranı ${pct(hColdDiff / hDecisions)}.`,
  "",
  "**Yorum (önemli bulgu).** k-means'in 2 boyutlu PCA koordinatlarında bulduğu en iyi ortalama siluet, yapısız (tek tepeli) veride de tipik olarak 0,34–0,6 arasındadır. Bu nedenle §9.4'teki \"siluet < 0,25 ise K = 1\" kuralı neredeyse hiç tetiklenmez. Homojen bir toplulukta gürültüden sahte kümeler oluşur. Bu durumda köprü testi rastgele bölünmüş gruplar arasında uygulanır ve soğuk başlangıçtaki nitelikli çoğunluk (%60) devre dışı kalır. Sahte kümeler benzer tercihlere sahip olduğundan contested oranı düşüktür; asıl etki eşik farkıdır. Gerçek blok yapısı ise sıfır modeline göre belirgin bir siluet farkı üretir. **Öneri (KC-1.1):** K ≥ 2 ancak `siluet − siluet_sıfır ≥ 0,10` ise kabul edilsin. Burada `siluet_sıfır`, aynı tohumdan türetilen birkaç permütasyonun ortalamasıdır. Alternatif olarak mutlak eşik 2 boyut için yeniden ayarlanabilir; ancak tek bir mutlak eşik, gürültü düzeyine göre ya yapıyı kaçırır ya da sahte küme üretir.",
  "",
  "## Sınırlılıklar",
  "",
  "- Oy modeli bloklar içinde bağımsızdır; stratejik oy, koordineli kampanya ve zaman içinde tercih değişimi modellenmemiştir.",
  "- Uzlaşma turunun ikna etkisi yalnızca (a)'daki bir satırda, varsayılan bir değişiklikle gösterilmiştir. Diğer yeniden oylamalarda tercihler aynıdır (kötümser varsayım).",
  "- Yeter sayı, eşik ve tabanlar ALGORITMA §2 varsayılanlarıdır. Ontoloji denetiminin ürettiği parametreler farklıysa sonuçlar değişir.",
  "- Süre hesapları yalnız oylama, uzatma, itiraz ve uzlaşma evrelerini içerir (destekçi toplama ve tartışma hariç).",
  "",
);

writeFileSync(OUT, out.join("\n"), "utf8");
log(`Yazıldı: ${OUT} (${Math.round(performance.now() - t0)} ms)`);
