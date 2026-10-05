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
import { ceilMul, fracAtLeast, fracGreater, rat, ratAdd, ratMax, ratMin, ratToNumber } from "./rational";
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

function fmtPct(x: number): string {
  return "%" + (x * 100).toFixed(1).replace(".", ",");
}

/**
 * Değeri ve karşılaştırıldığı sınırı BİRLİKTE, karşılaştırmayla GÖRSEL OLARAK TUTARLI yazar (ALGORITMA §12.15):
 *  - değer: yuvarlanmış hâli sınırınkiyle aynı görünüyor ama değerler eşit değilse hassasiyet artırılır (en çok +3 basamak);
 *    yine ayırt edilemezse null döner (çağıran kesir yazar);
 *  - sınır: varsayılan hassasiyetle yazılır; gösterilen iki sayının karşılaştırması gerçek karşılaştırmayla çelişiyorsa
 *    (ör. 2/3 → "66,7" iken değer "66,68": 66,68 < 66,7 görünür ama değer ≥ 2/3) sınırın hassasiyeti de değerinkine kadar artırılır
 *    ("%66,68 ≥ %66,67").
 * Böylece "P=0,30 < 0,30 ✘", "%66,68 ≥ %66,7 ✔" ya da "%50,00 ≥ %50,0 ✘" gibi çelişkili satırlar oluşmaz.
 */
function fmtPair(x: number, bound: number, equal: boolean, digits: number, scale: number): { value: string | null; bound: string } {
  let vd: number | null = null;
  for (let d = digits; d <= digits + 3; d++) {
    if (equal || (x * scale).toFixed(d) !== (bound * scale).toFixed(d)) {
      vd = d;
      break;
    }
  }
  let bd = digits;
  if (vd !== null && !equal) {
    const sign = x < bound ? -1 : 1;
    const shownX = Number((x * scale).toFixed(vd));
    while (bd < vd) {
      const shownB = Number((bound * scale).toFixed(bd));
      if ((shownX < shownB ? -1 : shownX > shownB ? 1 : 0) === sign) break;
      bd++;
    }
  }
  return { value: vd === null ? null : (x * scale).toFixed(vd).replace(".", ","), bound: (bound * scale).toFixed(bd).replace(".", ",") };
}

/** Laplace desteği P_g ve taban, tutarlı gösterim (varsayılan 2 ondalık). */
function fmtRatVs(r: Rational, bound: Rational): { value: string; bound: string } {
  const equal = r.num * bound.den === bound.num * r.den;
  const p = fmtPair(ratToNumber(r), ratToNumber(bound), equal, 2, 1);
  return { value: p.value ?? `${r.num}/${r.den}`, bound: p.bound };
}

/** Onay oranı Y/(Y+N) ve eşik, tutarlı gösterim (varsayılan %, 1 ondalık). */
function fmtApprovalVs(yes: number, total: number, bound: Rational): { value: string; bound: string } {
  const a = total > 0 ? yes / total : 0;
  const equal = total > 0 && yes * bound.den === bound.num * total;
  const p = fmtPair(a, ratToNumber(bound), equal, 1, 100);
  return { value: p.value === null ? `${yes}/${total}` : "%" + p.value, bound: "%" + p.bound };
}

/**
 * "Anlamlı görüş grubu" kuralı (ALGORITMA.md §1): küme büyüklüğü ≥ σ_min ve ≥ σ_share · kümelenmiş toplam.
 * Kural tek yerdedir: sayım (`decide`; yeniden oylama da `decide` ile, `round = 2` + `revote`) ve sayım dışındaki her görünüm
 * (ör. mesajların köprü puanı, bilirkişi "azınlık güvenceli soru", YZ özeti) bunu çağırır; eşikler yönetmelikle değişebildiği
 * için dışarıdan sabit 1/10 ve 3 yazılmaz, yürürlükteki parametreler (`significantShare`, `significantMinMembers`) verilir.
 */
export function isSignificant(size: number, clusteredTotal: number, p: Pick<DecisionParams, "significantShare" | "significantMinMembers">): boolean {
  return clusteredTotal > 0 && size >= p.significantMinMembers && fracAtLeast(size, clusteredTotal, p.significantShare);
}

/** Soğuk başlangıç ve tur kurallarına göre kullanılacak eşik: τ' = max(τ, min(τ+δ_cold, 2/3)), `≥` (§4.4, r2). */
export function effectiveThreshold(p: DecisionParams, bridgeApplicable: boolean): { threshold: Rational; strict: boolean } {
  if (bridgeApplicable) return { threshold: p.threshold, strict: p.thresholdStrict };
  return { threshold: ratMax(p.threshold, ratMin(ratAdd(p.threshold, p.coldStartBump), rat(2, 3))), strict: false };
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
  const qPct = Math.round(ratToNumber(p.quorum) * 100);
  const qBase = Math.max(ceilMul(p.quorum, E), floorAbs(E));
  checks.push({
    key: "quorum",
    label: "Katılım (yeter sayı)",
    passed: quorumMet,
    value: `${P}/${E}`,
    required: `≥ ${qReq}`,
    detail:
      qBase > E
        ? `Gerekli katılım normalde %${qPct} yeter sayı (${ceilMul(p.quorum, E)} kişi) ile mutlak taban ⌈1,5·√${E}⌉ = ${floorAbs(E)} değerlerinin büyüğüdür (${qBase}); ancak uygun seçmen sayısını (|E| = ${E}) aşamaz.`
        : `Gerekli katılım, %${qPct} yeter sayı (${ceilMul(p.quorum, E)} kişi) ile mutlak taban ⌈1,5·√${E}⌉ = ${floorAbs(E)} değerlerinin büyüğüdür.`,
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
  const shownApproval = fmtApprovalVs(Y, Y + N, threshold);
  checks.push({
    key: "threshold",
    label: "Onay oranı",
    passed: thresholdMet,
    value: `${shownApproval.value} (${Y} kabul / ${N} red)`,
    required: `${strict ? ">" : "≥"} ${shownApproval.bound}`,
    detail: "Çekimser oylar katılıma sayılır, onay oranına sayılmaz.",
  });

  // 3. Küme sonuçları. Köprünün karar kuralında kullanıldığı turlarda (ilk tur, contested yeniden oylaması)
  //    uzatma KULLANILDIKTAN sonra hâlâ μ_votes'un altında kalan anlamlı küme nötr sayılır ve tabandan muaftır
  //    (§4.1 r2): böylece neredeyse sessiz bir kümede tek bir oy kararı ertelemeye zorlayamaz.
  const bridgeUsedInRule = input.round === 1 || input.revote?.origin === "contested";
  const exemptionActive = bridgeApplicable && bridgeUsedInRule && !input.extensionAvailable;
  const clusters: ClusterResult[] = [];
  const pgs: Rational[] = [];
  const shortClusters: string[] = [];
  const exempt = new Set<string>();
  let allSigPass = true;
  for (const g of clusterIds) {
    const c = perCluster[g] ?? { yes: 0, no: 0, abstain: 0 };
    const sig = significant.includes(g);
    const pg = laplaceSupport(c.yes, c.no);
    const passes = ratGe(pg, p.clusterFloor);
    const short = c.yes + c.no < p.minVotesPerCluster;
    if (sig) {
      pgs.push(pg);
      if (short) shortClusters.push(g);
      if (short && exemptionActive) exempt.add(g);
      else if (!passes) allSigPass = false;
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
      passed: sig && bridgeApplicable && !exempt.has(g) ? passes : null,
    });
  }

  // Köprü testi kontrol satırları
  if (bridgeApplicable) {
    for (const cr of clusters) {
      if (!cr.significant) continue;
      const pg = laplaceSupport(cr.yes, cr.no);
      const passes = ratGe(pg, p.clusterFloor);
      const shown = fmtRatVs(pg, p.clusterFloor);
      const formula = `P = (1+${cr.yes})/(2+${cr.yes}+${cr.no})`;
      let label = `${cr.label} desteği (köprü testi)`;
      let passed = cr.passed === true;
      let detail = formula;
      if (!bridgeUsedInRule) {
        label = `${cr.label} desteği (bilgi — bu turda uygulanmaz)`;
        passed = true;
        detail = `${formula} ${passes ? "≥" : "<"} ${shown.bound}. İtiraz sonrası yeniden oylamada küme tabanları uygulanmaz, yalnızca gösterilir.`;
      } else if (exempt.has(cr.clusterId)) {
        passed = true;
        // Dürüst gösterim: muafiyetin sonucu değiştirip değiştirmediği de yazılır.
        detail =
          `Küme yeterince katılmadı (en az ${p.minVotesPerCluster} kabul/red oyu toplanamadı); uzatmadan sonra nötr sayıldı ve köprü tabanından muaf tutuldu. ` +
          `Bilgi: ${formula} ${passes ? "≥" : "<"} ${shown.bound}${passes ? "." : "; muafiyet olmasaydı bu grup tabanın altında kalırdı."}`;
      } else if (cr.yes + cr.no < p.minVotesPerCluster) {
        detail = `Küme yeterince katılmadı; oylama bir kez uzatılır. ${formula}`;
      }
      checks.push({
        key: `bridge:${cr.clusterId}`,
        label,
        passed,
        value: `P=${shown.value} (${cr.yes} kabul / ${cr.no} red)`,
        required: `≥ ${shown.bound}`,
        detail,
      });
    }
  }

  // DEL: yazarın kümesi koruması (yazar kümelenmişse; köprü uygulanamasa bile — en koruyucu yorum).
  // Nötr küme muafiyeti burada UYGULANMAZ: yazarın kümesinden tek bir "hayır" bile silmeyi ertelemeye yeter.
  let authorOk: boolean | null = null;
  if (p.authorClusterFloor && input.authorClusterId) {
    const c = perCluster[input.authorClusterId] ?? { yes: 0, no: 0, abstain: 0 };
    const pa = laplaceSupport(c.yes, c.no);
    authorOk = ratGe(pa, p.authorClusterFloor);
    const shown = fmtRatVs(pa, p.authorClusterFloor);
    checks.push({
      key: "author_cluster",
      // Grup adı etikette anılmaz: yazarın görüş grubu özel nitelikli veridir (KVKK.md §4.3). authorClusterId yalnız
      // yeniden sayım için TALLY'de durur (zorunlu istisna).
      label: "Mesaj yazarının kendi görüş grubu",
      passed: authorOk,
      value: `P=${shown.value} (${c.yes} kabul / ${c.no} red)`,
      required: `≥ ${shown.bound}`,
      detail: "Silme kararı, yazarın kendi görüş grubunun çoğunluğu karşı çıkıyorsa geçemez.",
    });
  }

  const bridgeEvaluated = bridgeApplicable || authorOk !== null;
  const bridgeMet: boolean | null = bridgeEvaluated ? (bridgeApplicable ? allSigPass : true) && authorOk !== false : null;
  const gac = pgs.length > 0 ? Math.pow(pgs.reduce((acc, r) => acc * ratToNumber(r), 1), 1 / pgs.length) : null;

  // 4. Uzatma koşulu: köprü kararda kullanılıyorsa küme oy eksiği de sayılır
  const clusterShortfall = bridgeApplicable && bridgeUsedInRule && shortClusters.length > 0;
  if (clusterShortfall) {
    const list = shortClusters
      .map((g) => {
        const c = perCluster[g] ?? { yes: 0, no: 0, abstain: 0 };
        return `${clusterLabel(g)}: ${c.yes + c.no}`;
      })
      .join(", ");
    checks.push({
      key: "participation_shortfall",
      label: "Anlamlı kümelerde asgari oy",
      passed: !input.extensionAvailable,
      value: list,
      required: `her anlamlı kümede ≥ ${p.minVotesPerCluster} kabul/red oyu`,
      detail: input.extensionAvailable
        ? "Oylama bir kez uzatılır."
        : "Uzatma kullanıldı; eksik kalan küme nötr sayıldı ve köprü tabanından muaf tutuldu.",
    });
  }

  // Nötr sayılan (muaf) anlamlı kümeler: gerekçe metni bunları açıkça anar, "tüm gruplarda destek" demez.
  const neutralNames = clusters.filter((c) => exempt.has(c.clusterId)).map((c) => c.label);

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
      reason = `Onay oranı (${shownApproval.value}) gerekli eşiğin (${strict ? ">" : "≥"} ${shownApproval.bound}) altında kaldı.`;
    } else if (bridgeMet === false) {
      outcome = "contested";
      const failing = clusters.filter((c) => c.passed === false).map((c) => c.label);
      if (authorOk === false) failing.push("mesaj yazarının kümesi");
      reason = `Genel çoğunluk sağlandı ancak ${failing.join(", ")} tabanın altında kaldı; uzlaşma turu başlıyor.`;
    } else {
      outcome = "accept";
      reason = !bridgeApplicable
        ? `Nitelikli çoğunluk (${shownApproval.value} ≥ ${shownApproval.bound}) sağlandı (soğuk başlangıç).`
        : neutralNames.length === 0
          ? `Genel onay (${fmtPct(approval)}) ve tüm anlamlı görüş gruplarında köprü desteği sağlandı.`
          : neutralNames.length >= significant.length
            ? `Genel onay (${fmtPct(approval)}) sağlandı. Anlamlı görüş gruplarının hiçbiri uzatmadan sonra da yeterli oya ulaşmadığı için hepsi nötr sayıldı; köprü desteği hiçbir grupta sınanamadı.`
            : `Genel onay (${fmtPct(approval)}) sağlandı; köprü desteği yalnız yeterince katılan anlamlı görüş gruplarında arandı ve sağlandı. ${neutralNames.join(", ")} uzatmadan sonra da yeterli oya ulaşmadığı için nötr sayıldı.`;
    }
  } else {
    const rv = input.revote!;
    if (rv.origin === "contested") {
      overrideMet = fracAtLeast(Y, Y + N, p.overrideThreshold);
      const shown = fmtApprovalVs(Y, Y + N, p.overrideThreshold);
      checks.push({
        key: "override",
        label: "Aşma eşiği (yeniden oylama)",
        passed: overrideMet,
        value: shown.value,
        required: `≥ ${shown.bound}`,
        detail: "Köprü testi yeniden sağlanamazsa nitelikli çoğunluk tabanı aşabilir; azınlığın gücü erteleyicidir.",
      });
      const pass = (thresholdMet && bridgeMet !== false) || overrideMet;
      outcome = pass ? "accept" : "reject";
      reason = pass
        ? overrideMet && !(thresholdMet && bridgeMet !== false)
          ? `Yeniden oylamada aşma eşiği (${shown.bound}) sağlandı.`
          : neutralNames.length === 0
            ? "Yeniden oylamada genel onay ve köprü desteği sağlandı."
            : `Yeniden oylamada genel onay sağlandı; köprü desteği yalnız yeterince katılan anlamlı gruplarda arandı (${neutralNames.join(", ")} nötr sayıldı).`
        : "Yeniden oylamada ne köprü desteği ne de aşma eşiği sağlandı.";
    } else {
      const rho = rv.strongObjection ? ratMax(p.revoteThreshold, rat(2, 3)) : p.revoteThreshold;
      const met = fracAtLeast(Y, Y + N, rho);
      const shown = fmtApprovalVs(Y, Y + N, rho);
      checks.push({
        key: "revote_threshold",
        label: "Yeniden oylama eşiği (itiraz sonrası)",
        passed: met,
        value: shown.value,
        required: `≥ ${shown.bound}`,
        detail: rv.strongObjection
          ? "İtiraz, ilgili kümenin üyelerinin en az 2/3'ünce imzalandığı için eşik 2/3'e yükseltildi."
          : "Küme tabanları bu turda uygulanmaz, yalnızca gösterilir.",
      });
      outcome = met ? "accept" : "reject";
      reason = met
        ? `İtiraz sonrası yeniden oylamada ${shown.bound} eşiği sağlandı.`
        : `İtiraz sonrası yeniden oylamada ${shown.bound} eşiği sağlanamadı.`;
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

/**
 * ALGORITMA.md §6: alarm zili itirazının geçerliliği.
 * İmzacının kümesi ilk tur oyundan (bülten) alınır; imzadaki `clusterId` yalnızca oy kaydında yoksa kullanılır.
 */
export function evaluateObjection(input: ObjectionInput): ObjectionEvaluation {
  const p = input.params;
  const noVoters = new Set(input.firstRoundVotes.filter((v) => v.choice === "no").map((v) => v.voterKey));
  const voteCluster = new Map(input.firstRoundVotes.map((v) => [v.voterKey, v.clusterId ?? null] as const));
  const uniq = new Map<string, ObjectionSignature>();
  for (const s of input.signatures) {
    if (!noVoters.has(s.voterKey) || uniq.has(s.voterKey)) continue;
    uniq.set(s.voterKey, { voterKey: s.voterKey, clusterId: voteCluster.has(s.voterKey) ? voteCluster.get(s.voterKey)! : s.clusterId });
  }
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

/** Yeniden sayım hata verdiğinde (bozuk/uyumsuz TALLY) dönen yer tutucu sonuç; `ok` her zaman false olur. */
function failedRecount(tally: TallyPayload, message: string): DecisionResult {
  return {
    algoVersion: ALGO_VERSION,
    round: tally.round === 2 ? 2 : 1,
    outcome: "reject",
    totals: { eligible: Number(tally.eligibleCount) || 0, participants: 0, yes: 0, no: 0, abstain: 0, delegated: 0, unrouted: 0 },
    approval: 0,
    quorumRequired: 0,
    thresholdUsed: rat(0, 1),
    thresholdStrict: false,
    quorumMet: false,
    thresholdMet: false,
    bridgeApplicable: false,
    bridgeMet: null,
    overrideMet: null,
    gac: null,
    clusters: [],
    checks: [{ key: "recount_error", label: "Bağımsız yeniden sayım", passed: false, value: "yapılamadı", required: "—", detail: message }],
    reason: `Yeniden sayım yapılamadı: ${message}`,
    inputsHash: "",
    computedAt: Number(tally.computedAt) || 0,
  };
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
 *
 * Yapısal denetimler (ALGORITMA.md §11, §12): açıklanan pusula sayısı uygun seçmen sayısını (|E|) aşamaz; defterde taahhüdü
 * (VOTE_COMMIT) olan bir pusula vekâletle (`via` ≠ "direct") açıklanamaz — doğrudan oy her zaman önceliklidir (§5.1) ve sunucu
 * yalnız pusulası olmayan seçmen için vekâlet açıklaması üretir. Bu denetim olmasa sahte bir bülten, taahhütlü bir oyu yalnız
 * `via` etiketini değiştirerek taahhüt karşılaştırmasının dışına çıkarıp seçimini değiştirebilirdi.
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
  if (typeof tally.eligibleCount === "number" && unique.length > tally.eligibleCount) {
    mismatches.push(`Açıklanan oy sayısı (${unique.length}) uygun seçmen sayısını (${tally.eligibleCount}) aşıyor`);
  }
  let recomputed: DecisionResult;
  let recomputeError: string | null = null;
  try {
    recomputed = decide(decisionInputFromTally(tally, unique));
  } catch (e) {
    recomputeError = e instanceof Error ? e.message : String(e);
    recomputed = failedRecount(tally, recomputeError);
  }

  if (tally.algoVersion !== ALGO_VERSION) mismatches.push(`Algoritma sürümü farklı: ${tally.algoVersion} ≠ ${ALGO_VERSION}`);
  if (revealHash(reveals) !== tally.revealHash) mismatches.push("Açıklanan oyların özeti TALLY kaydındaki revealHash ile eşleşmiyor");
  if (recomputeError !== null) {
    mismatches.push(`Yeniden sayım yapılamadı: ${recomputeError}`);
  } else {
    if (recomputed.outcome !== tally.outcome) mismatches.push(`Sonuç farklı: defterde ${tally.outcome}, yeniden sayımda ${recomputed.outcome}`);
    for (const key of Object.keys(recomputed.totals) as (keyof DecisionResult["totals"])[]) {
      if (recomputed.totals[key] !== tally.totals?.[key]) mismatches.push(`Toplam "${key}" farklı: ${tally.totals?.[key]} ≠ ${recomputed.totals[key]}`);
    }
    if (recomputed.inputsHash !== tally.inputsHash) mismatches.push("Girdi özeti (inputsHash) eşleşmiyor");
  }

  if (commitments) {
    for (const r of unique) {
      if (r.via !== "direct") {
        if (Object.prototype.hasOwnProperty.call(commitments, r.ballotId)) {
          mismatches.push(`Defterde taahhüdü olan pusula vekâletle açıklanmış (doğrudan oy önceliklidir): ${r.ballotId.slice(0, 12)}…`);
        }
        continue;
      }
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
