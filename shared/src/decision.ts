// "Köprülü Çoğunluk" (KC-1.0) karar fonksiyonu — docs/ALGORITMA.md §4 ve §6.
// SAF ve BELİRLENİMCİ: Date.now()/Math.random() YOK, kayan nokta karşılaştırması YOK (rasyonel).
// Sunucu sayımı bu fonksiyonla yapar; tarayıcı/Android aynı fonksiyonla defterdeki bülteni yeniden sayar.
import type {
  ClusterResult,
  DecisionCheck,
  DecisionParams,
  DecisionResult,
  ObjectionEvaluation,
  Rational,
  VoteChoice,
} from "./types";
import { hashCanonical, voteCommitment } from "./crypto";
import { ceilMul, fracAtLeast, fracGreater, rat, ratAdd, ratMax, ratMin, ratToNumber, ratToPercent } from "./rational";
import { clusterLabel } from "./labels";

export const ALGO_VERSION = "KC-1.0";

/** Bir kişinin etkin oyu (doğrudan ya da vekâletle). Her kişi tam 1 sayılır. */
export interface EffectiveVote {
  /** Oy anahtarı. Sunucu da sayımı ballotId ile yapar; böylece defterden yeniden sayımda inputsHash birebir tutar. */
  voterKey: string;
  choice: VoteChoice;
  via: "direct" | "delegated";
  clusterId: string | null;
}

export interface DecisionInput {
  params: DecisionParams;
  round: 1 | 2;
  eligibleCount: number; // |E|
  votes: EffectiveVote[];
  /** Anlık görüntüdeki küme büyüklükleri n_g (oy verip vermediğine bakılmaksızın). */
  clusterSizes: Record<string, number>;
  /** n_C: kümelenmiş toplam üye */
  clusteredTotal: number;
  /** Anlık görüntünün K değeri (1 ise köprü uygulanamaz) */
  k: number;
  /** Bu tur için uzatma hâlâ kullanılabilir mi? */
  extensionAvailable: boolean;
  /** Yalnızca DEL: hedef mesaj yazarının kümesi */
  authorClusterId?: string | null;
  /** Yalnızca round=2 */
  revote?: { origin: "contested" | "objection"; strongObjection: boolean } | null;
  /** Vekâlet sınırı nedeniyle yönlendirilemeyen kişi sayısı (yalnız raporlama) */
  unrouted?: number;
  /** Sonuca yazılacak zaman damgası (çağıran verir; fonksiyon saat okumaz) */
  now: number;
}

// ───────────── Yardımcı hesaplar (sunucu ve istemci aynı formülleri kullanır) ─────────────

/** floor_abs = ⌈1,5·√|E|⌉ — tamsayı aritmetiğiyle: en küçük f, 4f² ≥ 9|E|. */
export function floorAbs(eligible: number): number {
  if (eligible <= 0) return 0;
  let f = Math.ceil(1.5 * Math.sqrt(eligible));
  while (f > 0 && 4 * (f - 1) * (f - 1) >= 9 * eligible) f--;
  while (4 * f * f < 9 * eligible) f++;
  return f;
}

/** Gerekli katılım: max(⌈q·|E|⌉, floor_abs); ancak |E|'yi aşamaz (küçük topluluklarda kabul imkânsız olmasın). */
export function quorumRequired(quorum: Rational, eligible: number): number {
  return Math.min(eligible, Math.max(ceilMul(quorum, eligible), floorAbs(eligible)));
}

/** K_s = max(2, min(5, ⌈√|M|/2⌉)); DEL için 1. */
export function sponsorsRequired(verifiedMembers: number, tier: string | null): number {
  if (tier === "DEL") return 1;
  // ⌈√M / 2⌉ = en küçük k, 4k² ≥ M
  let k = 0;
  while (4 * k * k < verifiedMembers) k++;
  return Math.max(2, Math.min(5, k));
}

/** Vekâlet sınırı: max(2, ⌈0,05·|E|⌉) */
export function delegationCap(eligible: number, capFraction: Rational = rat(1, 20)): number {
  return Math.max(2, ceilMul(capFraction, eligible));
}

/** Laplace yumuşatmalı küme desteği P_g = (1+Y)/(2+Y+N) */
export function laplaceSupport(yes: number, no: number): Rational {
  return rat(1 + yes, 2 + yes + no);
}

function ratGe(a: Rational, b: Rational): boolean {
  return a.num * b.den >= b.num * a.den;
}

function fmtRat(r: Rational): string {
  return (ratToNumber(r)).toFixed(2).replace(".", ",");
}

function fmtPct(x: number): string {
  return "%" + (x * 100).toFixed(1).replace(".", ",");
}

function isSignificant(size: number, clusteredTotal: number, p: DecisionParams): boolean {
  return clusteredTotal > 0 && size >= p.significantMinMembers && fracAtLeast(size, clusteredTotal, p.significantShare);
}

/** Soğuk başlangıç ve tur kurallarına göre kullanılacak eşik. */
export function effectiveThreshold(p: DecisionParams, bridgeApplicable: boolean): { threshold: Rational; strict: boolean } {
  if (bridgeApplicable) return { threshold: p.threshold, strict: p.thresholdStrict };
  return { threshold: ratMin(ratAdd(p.threshold, p.coldStartBump), rat(2, 3)), strict: false };
}

function sortedVotes(votes: EffectiveVote[]): EffectiveVote[] {
  return votes.slice().sort((a, b) => (a.voterKey < b.voterKey ? -1 : a.voterKey > b.voterKey ? 1 : 0));
}

function computeInputsHash(input: DecisionInput): string {
  return hashCanonical({
    algoVersion: ALGO_VERSION,
    params: input.params,
    round: input.round,
    eligibleCount: input.eligibleCount,
    votes: sortedVotes(input.votes).map((v) => ({ k: v.voterKey, c: v.choice, v: v.via, g: v.clusterId })),
    clusterSizes: input.clusterSizes,
    clusteredTotal: input.clusteredTotal,
    k: input.k,
    extensionAvailable: input.extensionAvailable,
    authorClusterId: input.authorClusterId ?? null,
    revote: input.revote ?? null,
    unrouted: input.unrouted ?? 0,
  });
}

/**
 * ALGORITMA.md §4.1 (round=1) ve §4.3 (round=2) uyarınca karar verir.
 * - outcome: "needs_more_votes" yalnızca extensionAvailable=true iken dönebilir.
 * - round=2'de "contested" dönmez (enacted/rejected için "accept"/"reject").
 * - checks[]: Türkçe, kullanıcıya gösterilecek açıklama listesi.
 * - inputsHash: girdilerin kanonik özeti (oylar voterKey'e göre sıralanmış).
 */
export function decide(input: DecisionInput): DecisionResult {
  const p = input.params;
  if (p.tier === "T3") throw new Error("decide: T3 (değiştirilemez) öneriler oylanamaz");
  if (input.round === 2 && !input.revote) throw new Error("decide: round=2 için revote bilgisi gerekli");

  const E = input.eligibleCount;
  let Y = 0;
  let N = 0;
  let A = 0;
  let delegated = 0;
  const seen = new Set<string>();
  const perCluster: Record<string, { yes: number; no: number; abstain: number }> = {};
  for (const v of input.votes) {
    if (seen.has(v.voterKey)) throw new Error(`decide: yinelenen oy anahtarı ${v.voterKey}`);
    seen.add(v.voterKey);
    if (v.choice === "yes") Y++;
    else if (v.choice === "no") N++;
    else A++;
    if (v.via === "delegated") delegated++;
    if (v.clusterId) {
      const c = (perCluster[v.clusterId] ??= { yes: 0, no: 0, abstain: 0 });
      if (v.choice === "yes") c.yes++;
      else if (v.choice === "no") c.no++;
      else c.abstain++;
    }
  }
  const P = Y + N + A;
  const checks: DecisionCheck[] = [];

  // 1. Katılım
  const qReq = quorumRequired(p.quorum, E);
  const quorumMet = P >= qReq && P > 0;
  checks.push({
    key: "quorum",
    label: "Katılım (yeter sayı)",
    passed: quorumMet,
    value: `${P}/${E}`,
    required: `≥ ${qReq}`,
    detail: `Gerekli katılım, %${Math.round(ratToNumber(p.quorum) * 100)} yeter sayı ile mutlak taban ⌈1,5·√${E}⌉ = ${floorAbs(E)} değerlerinin büyüğüdür.`,
  });

  // 2. Köprü uygulanabilir mi? (soğuk başlangıç §4.4)
  const clusterIds = Object.keys(input.clusterSizes).sort();
  const significant = clusterIds.filter((g) => isSignificant(input.clusterSizes[g], input.clusteredTotal, p));
  const bridgeApplicable = input.clusteredTotal >= p.minClusteredForBridge && input.k >= 2 && significant.length > 0;
  const { threshold, strict } = effectiveThreshold(p, bridgeApplicable);
  const approval = Y + N > 0 ? Y / (Y + N) : 0;
  const thresholdMet = strict ? fracGreater(Y, Y + N, threshold) : fracAtLeast(Y, Y + N, threshold);
  if (!bridgeApplicable) {
    checks.push({
      key: "cold_start",
      label: "Görüş verisi (soğuk başlangıç)",
      passed: true,
      value: `kümelenmiş ${input.clusteredTotal} kişi, K=${input.k}`,
      required: `≥ ${p.minClusteredForBridge} kişi ve K ≥ 2`,
      detail: "Yeterli görüş verisi yok; köprü testi yerine nitelikli çoğunluk arandı.",
    });
  }
  checks.push({
    key: "threshold",
    label: "Onay oranı",
    passed: thresholdMet,
    value: `${fmtPct(approval)} (${Y} kabul / ${N} red)`,
    required: `${strict ? ">" : "≥"} ${ratToPercent(threshold)}`,
    detail: "Çekimser oylar katılıma sayılır, onay oranına sayılmaz.",
  });

  // 3. Küme sonuçları
  const clusters: ClusterResult[] = [];
  const pgs: Rational[] = [];
  let allSigPass = true;
  let shortfall = false;
  for (const g of clusterIds) {
    const c = perCluster[g] ?? { yes: 0, no: 0, abstain: 0 };
    const sig = significant.includes(g);
    const pg = laplaceSupport(c.yes, c.no);
    const passes = ratGe(pg, p.clusterFloor);
    if (sig) {
      pgs.push(pg);
      if (!passes) allSigPass = false;
      if (c.yes + c.no < p.minVotesPerCluster) shortfall = true;
    }
    clusters.push({
      clusterId: g,
      label: clusterLabel(g),
      members: input.clusterSizes[g],
      significant: sig,
      yes: c.yes,
      no: c.no,
      abstain: c.abstain,
      voted: c.yes + c.no + c.abstain,
      pg: ratToNumber(pg),
      floor: sig ? ratToNumber(p.clusterFloor) : null,
      passed: sig && bridgeApplicable ? passes : null,
    });
  }

  // Köprü testi kontrol satırları
  if (bridgeApplicable) {
    for (const cr of clusters) {
      if (!cr.significant) continue;
      checks.push({
        key: `bridge:${cr.clusterId}`,
        label: `${cr.label} desteği (köprü testi)`,
        passed: cr.passed === true,
        value: `P=${fmtRat(laplaceSupport(cr.yes, cr.no))} (${cr.yes} kabul / ${cr.no} red)`,
        required: `≥ ${fmtRat(p.clusterFloor)}`,
        detail:
          cr.yes + cr.no < p.minVotesPerCluster
            ? "Küme yeterince katılmadı; Laplace yumuşatması nedeniyle nötr sayıldı."
            : `P = (1+${cr.yes})/(2+${cr.yes}+${cr.no})`,
      });
    }
  }

  // DEL: yazarın kümesi koruması (yazar kümelenmişse; köprü uygulanamasa bile — en koruyucu yorum)
  let authorOk: boolean | null = null;
  if (p.authorClusterFloor && input.authorClusterId) {
    const c = perCluster[input.authorClusterId] ?? { yes: 0, no: 0, abstain: 0 };
    const pa = laplaceSupport(c.yes, c.no);
    authorOk = ratGe(pa, p.authorClusterFloor);
    checks.push({
      key: "author_cluster",
      label: `Mesaj yazarının kümesi (${clusterLabel(input.authorClusterId)})`,
      passed: authorOk,
      value: `P=${fmtRat(pa)} (${c.yes} kabul / ${c.no} red)`,
      required: `≥ ${fmtRat(p.authorClusterFloor)}`,
      detail: "Silme kararı, yazarın kendi görüş grubunun çoğunluğu karşı çıkıyorsa geçemez.",
    });
  }

  const bridgeEvaluated = bridgeApplicable || authorOk !== null;
  const bridgeMet: boolean | null = bridgeEvaluated ? (bridgeApplicable ? allSigPass : true) && authorOk !== false : null;
  const gac = pgs.length > 0 ? Math.pow(pgs.reduce((acc, r) => acc * ratToNumber(r), 1), 1 / pgs.length) : null;

  // 4. Uzatma koşulu: köprü kararda kullanılıyorsa küme oy eksiği de sayılır
  const bridgeUsedInRule = input.round === 1 || input.revote?.origin === "contested";
  const clusterShortfall = bridgeApplicable && bridgeUsedInRule && shortfall;
  if (clusterShortfall) {
    checks.push({
      key: "participation_shortfall",
      label: "Anlamlı kümelerde asgari oy",
      passed: false,
      value: "en az bir kümede eksik",
      required: `her anlamlı kümede ≥ ${p.minVotesPerCluster} kabul/red oyu`,
      detail: input.extensionAvailable ? "Oylama bir kez uzatılır." : "Uzatma kullanıldı; eksik küme nötr sayıldı.",
    });
  }

  // 5. Karar
  let outcome: DecisionResult["outcome"];
  let overrideMet: boolean | null = null;
  let reason: string;
  if ((!quorumMet || clusterShortfall) && input.extensionAvailable) {
    outcome = "needs_more_votes";
    reason = !quorumMet
      ? `Katılım yetersiz (${P}/${qReq}); oylama bir kez uzatılıyor.`
      : "Bazı görüş gruplarında yeterli oy yok; oylama bir kez uzatılıyor.";
  } else if (!quorumMet) {
    outcome = "reject";
    reason = `Yeter sayıya ulaşılamadı (${P} katılım, gerekli ${qReq}).`;
  } else if (input.round === 1) {
    if (!thresholdMet) {
      outcome = "reject";
      reason = `Onay oranı (${fmtPct(approval)}) gerekli eşiğin (${strict ? ">" : "≥"} ${ratToPercent(threshold)}) altında kaldı.`;
    } else if (bridgeMet === false) {
      outcome = "contested";
      const failing = clusters.filter((c) => c.passed === false).map((c) => c.label);
      if (authorOk === false) failing.push("mesaj yazarının kümesi");
      reason = `Genel çoğunluk sağlandı ancak ${failing.join(", ")} tabanın altında kaldı; uzlaşma turu başlıyor.`;
    } else {
      outcome = "accept";
      reason = bridgeApplicable
        ? `Genel onay (${fmtPct(approval)}) ve tüm anlamlı görüş gruplarında köprü desteği sağlandı.`
        : `Nitelikli çoğunluk (${fmtPct(approval)} ≥ ${ratToPercent(threshold)}) sağlandı (soğuk başlangıç).`;
    }
  } else {
    const rv = input.revote!;
    if (rv.origin === "contested") {
      overrideMet = fracAtLeast(Y, Y + N, p.overrideThreshold);
      checks.push({
        key: "override",
        label: "Aşma eşiği (yeniden oylama)",
        passed: overrideMet,
        value: fmtPct(approval),
        required: `≥ ${ratToPercent(p.overrideThreshold)}`,
        detail: "Köprü testi yeniden sağlanamazsa nitelikli çoğunluk tabanı aşabilir; azınlığın gücü erteleyicidir.",
      });
      const pass = (thresholdMet && bridgeMet !== false) || overrideMet;
      outcome = pass ? "accept" : "reject";
      reason = pass
        ? overrideMet && !(thresholdMet && bridgeMet !== false)
          ? `Yeniden oylamada aşma eşiği (${ratToPercent(p.overrideThreshold)}) sağlandı.`
          : "Yeniden oylamada genel onay ve köprü desteği sağlandı."
        : "Yeniden oylamada ne köprü desteği ne de aşma eşiği sağlandı.";
    } else {
      const rho = rv.strongObjection ? ratMax(p.revoteThreshold, rat(2, 3)) : p.revoteThreshold;
      const met = fracAtLeast(Y, Y + N, rho);
      checks.push({
        key: "revote_threshold",
        label: "Yeniden oylama eşiği (itiraz sonrası)",
        passed: met,
        value: fmtPct(approval),
        required: `≥ ${ratToPercent(rho)}`,
        detail: rv.strongObjection
          ? "İtiraz, ilgili kümenin üyelerinin en az 2/3'ünce imzalandığı için eşik 2/3'e yükseltildi."
          : "Küme tabanları bu turda uygulanmaz, yalnızca gösterilir.",
      });
      outcome = met ? "accept" : "reject";
      reason = met
        ? `İtiraz sonrası yeniden oylamada ${ratToPercent(rho)} eşiği sağlandı.`
        : `İtiraz sonrası yeniden oylamada ${ratToPercent(rho)} eşiği sağlanamadı.`;
    }
  }

  return {
    algoVersion: ALGO_VERSION,
    round: input.round,
    outcome,
    totals: { eligible: E, participants: P, yes: Y, no: N, abstain: A, delegated, unrouted: input.unrouted ?? 0 },
    approval,
    quorumRequired: qReq,
    thresholdUsed: threshold,
    thresholdStrict: strict,
    quorumMet,
    thresholdMet,
    bridgeApplicable,
    bridgeMet,
    overrideMet,
    gac,
    clusters,
    checks,
    reason,
    inputsHash: computeInputsHash(input),
    computedAt: input.now,
  };
}

export interface ObjectionSignature {
  voterKey: string;
  clusterId: string | null;
}

export interface ObjectionInput {
  eligibleCount: number;
  /** İlk turdaki etkin oylar (imzacıların `no` oyu vermiş olması gerekir; fonksiyon ayrıca süzer) */
  firstRoundVotes: EffectiveVote[];
  signatures: ObjectionSignature[];
  clusterSizes: Record<string, number>;
  clusteredTotal: number;
  params: DecisionParams;
}

/** ALGORITMA.md §6: alarm zili itirazının geçerliliği. */
export function evaluateObjection(input: ObjectionInput): ObjectionEvaluation {
  const p = input.params;
  const noVoters = new Set(input.firstRoundVotes.filter((v) => v.choice === "no").map((v) => v.voterKey));
  const uniq = new Map<string, ObjectionSignature>();
  for (const s of input.signatures) if (noVoters.has(s.voterKey) && !uniq.has(s.voterKey)) uniq.set(s.voterKey, s);
  const signers = [...uniq.values()];

  const noPerCluster: Record<string, number> = {};
  for (const v of input.firstRoundVotes) if (v.choice === "no" && v.clusterId) noPerCluster[v.clusterId] = (noPerCluster[v.clusterId] ?? 0) + 1;
  const signPerCluster: Record<string, number> = {};
  for (const s of signers) if (s.clusterId) signPerCluster[s.clusterId] = (signPerCluster[s.clusterId] ?? 0) + 1;

  const clusterIds = Object.keys(input.clusterSizes).sort();
  const perCluster: ObjectionEvaluation["perCluster"] = [];
  let clusterRule = false;
  let strong = false;
  let triggering: string | null = null;
  for (const g of clusterIds) {
    const n = noPerCluster[g] ?? 0;
    const sgn = signPerCluster[g] ?? 0;
    const required = Math.max(3, ceilMul(rat(3, 4), n));
    perCluster.push({ clusterId: g, signers: sgn, noVoters: n, required });
    if (isSignificant(input.clusterSizes[g], input.clusteredTotal, p)) {
      if (sgn >= required && sgn > 0) {
        clusterRule = true;
        triggering ??= g;
      }
      if (sgn > 0 && sgn >= ceilMul(rat(2, 3), input.clusterSizes[g])) strong = true;
    }
  }

  const crossClusterRequired = Math.max(1, ceilMul(rat(1, 10), input.eligibleCount));
  const distinctClusters = new Set(signers.map((s) => s.clusterId).filter((g): g is string => !!g)).size;
  const crossRule = signers.length >= crossClusterRequired && distinctClusters >= 2;

  const valid = clusterRule || crossRule;
  const rule: ObjectionEvaluation["rule"] = clusterRule ? "cluster" : crossRule ? "cross_cluster" : null;
  let explanation: string;
  if (clusterRule) {
    explanation = `${clusterLabel(triggering)} içinde red oyu verenlerin en az %75'i (ve en az 3 kişi) itirazı imzaladı; uzlaşma turu açılır.`;
  } else if (crossRule) {
    explanation = `Uygun seçmenlerin en az %10'u (${signers.length} ≥ ${crossClusterRequired}) en az iki farklı görüş grubundan itirazı imzaladı; uzlaşma turu açılır.`;
  } else {
    explanation = `İtiraz henüz geçerli değil: tek bir anlamlı kümede red verenlerin %75'i (en az 3) ya da iki farklı kümeden toplam ${crossClusterRequired} imza gerekir (şu an ${signers.length} imza, ${distinctClusters} küme).`;
  }
  if (strong) explanation += " İmzacılar ilgili kümenin üyelerinin en az 2/3'ü olduğundan yeniden oylama eşiği en az 2/3 olur.";

  return { valid, rule, signers: signers.length, perCluster, crossClusterRequired, strong: valid && strong, explanation };
}

/** Bülten (BALLOT_REVEAL) girdisi */
export interface RevealEntry {
  ballotId: string;
  choice: VoteChoice;
  salt: string;
  clusterId: string | null;
  via: "direct" | "delegated";
}

/** TALLY işleminin yükü: yeniden sayım için gereken her şey. */
export interface TallyPayload {
  proposalId: string;
  round: 1 | 2;
  algoVersion: string;
  params: DecisionParams;
  eligibleCount: number;
  clusterSizes: Record<string, number>;
  clusteredTotal: number;
  k: number;
  extensionAvailable: boolean;
  authorClusterId: string | null;
  revote: { origin: "contested" | "objection"; strongObjection: boolean } | null;
  unrouted: number;
  clusterSnapshotHash: string;
  revealHash: string; // BALLOT_REVEAL yükünün özeti: hashCanonical(sortReveals(reveals))
  outcome: DecisionResult["outcome"];
  totals: DecisionResult["totals"];
  inputsHash: string;
  computedAt: number;
}

/** Açıklama listesini ballotId'ye göre sıralar (deftere bu sırayla yazılır). */
export function sortReveals(reveals: RevealEntry[]): RevealEntry[] {
  return reveals
    .slice()
    .sort((a, b) => (a.ballotId < b.ballotId ? -1 : a.ballotId > b.ballotId ? 1 : 0))
    .map((r) => ({ ballotId: r.ballotId, choice: r.choice, salt: r.salt, clusterId: r.clusterId ?? null, via: r.via }));
}

export function revealHash(reveals: RevealEntry[]): string {
  return hashCanonical(sortReveals(reveals));
}

/** Bülten girdilerinden decide() girdisini kurar (sunucu da aynı yolu kullanır). */
export function decisionInputFromTally(tally: TallyPayload, reveals: RevealEntry[]): DecisionInput {
  return {
    params: tally.params,
    round: tally.round,
    eligibleCount: tally.eligibleCount,
    votes: sortReveals(reveals).map((r) => ({ voterKey: r.ballotId, choice: r.choice, via: r.via, clusterId: r.clusterId })),
    clusterSizes: tally.clusterSizes,
    clusteredTotal: tally.clusteredTotal,
    k: tally.k,
    extensionAvailable: tally.extensionAvailable,
    authorClusterId: tally.authorClusterId,
    revote: tally.revote,
    unrouted: tally.unrouted,
    now: tally.computedAt,
  };
}

/**
 * Defterdeki TALLY + BALLOT_REVEAL'den sonucu bağımsızca yeniden hesaplar.
 * Ayrıca (commitments verilmişse) her açıklanan doğrudan oyun, defterdeki SON VOTE_COMMIT ile eşleştiğini denetler.
 */
export function verifyTally(
  tally: TallyPayload,
  reveals: RevealEntry[],
  commitments?: Record<string, string>, // ballotId → son commitment
): { ok: boolean; recomputed: DecisionResult; mismatches: string[] } {
  const mismatches: string[] = [];
  const ids = new Set<string>();
  for (const r of reveals) {
    if (ids.has(r.ballotId)) mismatches.push(`Aynı oy pusulası iki kez açıklanmış: ${r.ballotId.slice(0, 12)}…`);
    ids.add(r.ballotId);
  }
  const unique = reveals.filter((r, i) => reveals.findIndex((x) => x.ballotId === r.ballotId) === i);
  const recomputed = decide(decisionInputFromTally(tally, unique));

  if (tally.algoVersion !== ALGO_VERSION) mismatches.push(`Algoritma sürümü farklı: ${tally.algoVersion} ≠ ${ALGO_VERSION}`);
  if (revealHash(reveals) !== tally.revealHash) mismatches.push("Açıklanan oyların özeti TALLY kaydındaki revealHash ile eşleşmiyor");
  if (recomputed.outcome !== tally.outcome) mismatches.push(`Sonuç farklı: defterde ${tally.outcome}, yeniden sayımda ${recomputed.outcome}`);
  for (const key of Object.keys(recomputed.totals) as (keyof DecisionResult["totals"])[]) {
    if (recomputed.totals[key] !== tally.totals[key]) mismatches.push(`Toplam "${key}" farklı: ${tally.totals[key]} ≠ ${recomputed.totals[key]}`);
  }
  if (recomputed.inputsHash !== tally.inputsHash) mismatches.push("Girdi özeti (inputsHash) eşleşmiyor");

  if (commitments) {
    for (const r of unique) {
      if (r.via !== "direct") continue;
      const c = commitments[r.ballotId];
      if (!c) {
        mismatches.push(`Doğrudan oyun taahhüdü defterde yok: ${r.ballotId.slice(0, 12)}…`);
        continue;
      }
      if (voteCommitment(tally.proposalId, tally.round, r.ballotId, r.choice, r.salt) !== c) {
        mismatches.push(`Açıklanan oy taahhütle eşleşmiyor: ${r.ballotId.slice(0, 12)}…`);
      }
    }
    for (const b of Object.keys(commitments)) {
      if (!ids.has(b)) mismatches.push(`Taahhüdü olan oy açıklanmamış: ${b.slice(0, 12)}…`);
    }
  }
  return { ok: mismatches.length === 0, recomputed, mismatches };
}
