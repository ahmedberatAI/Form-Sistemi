// "Köprülü Çoğunluk" (KC-1.0) karar fonksiyonu — docs/ALGORITMA.md §4 ve §6.
// SAF ve BELİRLENİMCİ: Date.now()/Math.random() YOK, kayan nokta karşılaştırması YOK (rasyonel).
// Sunucu sayımı bu fonksiyonla yapar; tarayıcı/Android aynı fonksiyonla defterdeki bülteni yeniden sayar.
import type {
  DecisionParams,
  DecisionResult,
  ObjectionEvaluation,
  VoteChoice,
} from "./types";

export const ALGO_VERSION = "KC-1.0";

/** Bir kişinin etkin oyu (doğrudan ya da vekâletle). Her kişi tam 1 sayılır. */
export interface EffectiveVote {
  /** Sunucuda userId; defter bülteninden yeniden sayımda ballotId kullanılır. */
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

/**
 * ALGORITMA.md §4.1 (round=1) ve §4.3 (round=2) uyarınca karar verir.
 * - outcome: "needs_more_votes" yalnızca extensionAvailable=true iken dönebilir.
 * - round=2'de "contested" dönmez (enacted/rejected için "accept"/"reject").
 * - checks[]: Türkçe, kullanıcıya gösterilecek açıklama listesi.
 * - inputsHash: girdilerin kanonik özeti (oylar voterKey'e göre sıralanmış).
 */
export function decide(input: DecisionInput): DecisionResult {
  void input;
  throw new Error("decide: henüz uygulanmadı");
}

export interface ObjectionSignature {
  voterKey: string;
  clusterId: string | null;
}

export interface ObjectionInput {
  eligibleCount: number;
  /** İlk turdaki etkin oylar (imzacıların `no` oyu vermiş olması gerekir; çağıran filtreler) */
  firstRoundVotes: EffectiveVote[];
  signatures: ObjectionSignature[];
  clusterSizes: Record<string, number>;
  clusteredTotal: number;
  params: DecisionParams;
}

/** ALGORITMA.md §6: alarm zili itirazının geçerliliği. */
export function evaluateObjection(input: ObjectionInput): ObjectionEvaluation {
  void input;
  throw new Error("evaluateObjection: henüz uygulanmadı");
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
  revealHash: string; // BALLOT_REVEAL yükünün özeti
  outcome: DecisionResult["outcome"];
  totals: DecisionResult["totals"];
  inputsHash: string;
  computedAt: number;
}

/**
 * Defterdeki TALLY + BALLOT_REVEAL'den sonucu bağımsızca yeniden hesaplar.
 * Ayrıca (commitments verilmişse) her açıklanan oyun, defterdeki SON VOTE_COMMIT ile eşleştiğini denetler.
 */
export function verifyTally(
  tally: TallyPayload,
  reveals: RevealEntry[],
  commitments?: Record<string, string>, // ballotId → son commitment
): { ok: boolean; recomputed: DecisionResult; mismatches: string[] } {
  void tally;
  void reveals;
  void commitments;
  throw new Error("verifyTally: henüz uygulanmadı");
}
