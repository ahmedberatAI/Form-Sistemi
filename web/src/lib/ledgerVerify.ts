// Sunucuya güvenmeden doğrulama için defterden "bağlı" veri yükleme.
// Sunucudan gelen her işlem içeriği (1) istenen özete gerçekten ait mi (ledgerTxHash), (2) o özetin dahil olma kanıtı
// cihazda sabitlenmiş doğrulayıcı anahtarlarıyla geçerli mi — ikisi de denetlenir. Böylece sunucu bülteni (hazır
// "commitments" haritası, açıklama listesi, sayım yükü) değiştirse bile doğrulama bunu yakalar.
import { txMatchesHash, verifyInclusionProof, type BulletinRound, type InclusionProof, type RevealEntry, type TallyPayload } from "@forum/shared";
import { isApiError } from "../api/client";
import { getProof, getTx } from "../api/endpoints";
import type { PinnedValidators } from "./validators";

export type BoundResult<T> =
  | { state: "ok"; payload: T; proof: InclusionProof; height: number; index: number }
  | { state: "pending" } // henüz bloğa girmedi (404)
  | { state: "fail"; reason: string };

/** Tek bir işlemi defterden alır; içerik-özet bağını ve dahil olma kanıtını denetler. */
export async function loadBoundTx<T = Record<string, unknown>>(txHash: string, pinned: PinnedValidators, expectedType?: string): Promise<BoundResult<T>> {
  try {
    const [tx, proof] = await Promise.all([getTx(txHash), getProof(txHash)]);
    if (!txMatchesHash(tx, txHash)) return { state: "fail", reason: "İşlem içeriği özetiyle eşleşmiyor (içerik değiştirilmiş olabilir)." };
    if (expectedType && tx.type !== expectedType) return { state: "fail", reason: `Beklenen işlem türü ${expectedType}, defterde ${tx.type}.` };
    const v = verifyInclusionProof(proof, pinned.validators, txHash);
    if (!v.ok) return { state: "fail", reason: v.reasons.join("; ") };
    return { state: "ok", payload: tx.payload as T, proof, height: proof.height, index: proof.index };
  } catch (e) {
    if (isApiError(e) && e.status === 404) return { state: "pending" };
    return { state: "fail", reason: e instanceof Error ? e.message : String(e) };
  }
}

async function mapLimit<T, R>(items: T[], limit: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const i = next++;
      out[i] = await fn(items[i]);
    }
  });
  await Promise.all(workers);
  return out;
}

export interface LedgerRound {
  /** Defterden doğrulanmış sayım yükü (yoksa bülten yükü) */
  tally: TallyPayload;
  /** Defterden doğrulanmış açıklama listesi (yoksa bülten listesi) */
  reveals: RevealEntry[];
  /** Defterden tek tek doğrulanmış VOTE_COMMIT işlemlerinden kurulan "pusula → son taahhüt" haritası */
  commitments: Record<string, string>;
  tallyCheck: BoundResult<TallyPayload> | { state: "missing" };
  revealCheck: BoundResult<{ reveals?: RevealEntry[] }> | { state: "missing" };
  commitsChecked: number;
  commitsPending: number;
  /** Bağ kurulamayan / tutarsız taahhüt işlemleri */
  commitProblems: string[];
  /** Sunucunun bültende verdiği taahhüt haritası defterden kurulanla aynı mı */
  bulletinCommitmentsMatch: boolean;
}

/** Bir oylama turunun sayım, açıklama ve taahhüt verilerini defterden bağlı olarak yükler. */
export async function loadRoundFromLedger(proposalId: string, b: BulletinRound, pinned: PinnedValidators): Promise<LedgerRound> {
  const tallyCheck = b.tallyTx ? await loadBoundTx<TallyPayload>(b.tallyTx, pinned, "TALLY") : ({ state: "missing" } as const);
  const revealCheck = b.revealTx ? await loadBoundTx<{ reveals?: RevealEntry[] }>(b.revealTx, pinned, "BALLOT_REVEAL") : ({ state: "missing" } as const);

  const commitProblems: string[] = [];
  let commitsPending = 0;
  const latest = new Map<string, { commitment: string; height: number; index: number }>();
  const results = await mapLimit(b.commitTxs, 6, async (c) => ({ c, r: await loadBoundTx<{ proposalId?: string; round?: number; ballotId?: string; commitment?: string }>(c.txHash, pinned, "VOTE_COMMIT") }));
  for (const { c, r } of results) {
    if (r.state === "pending") {
      commitsPending++;
      continue;
    }
    if (r.state === "fail") {
      commitProblems.push(`Taahhüt işlemi ${c.txHash.slice(0, 10)}…: ${r.reason}`);
      continue;
    }
    const p = r.payload;
    if (p.proposalId !== proposalId || Number(p.round) !== b.round || p.ballotId !== c.ballotId || typeof p.commitment !== "string") {
      commitProblems.push(`Taahhüt işlemi ${c.txHash.slice(0, 10)}… başka bir öneriye, tura ya da pusulaya ait.`);
      continue;
    }
    const prev = latest.get(p.ballotId);
    if (!prev || r.height > prev.height || (r.height === prev.height && r.index > prev.index)) latest.set(p.ballotId, { commitment: p.commitment, height: r.height, index: r.index });
  }
  const commitments: Record<string, string> = {};
  for (const [ballot, v] of latest) commitments[ballot] = v.commitment;

  const bulletinKeys = Object.keys(b.commitments);
  const bulletinCommitmentsMatch =
    commitsPending === 0 && bulletinKeys.length === latest.size && bulletinKeys.every((k) => b.commitments[k] === commitments[k]);

  return {
    tally: tallyCheck.state === "ok" ? tallyCheck.payload : b.tally,
    reveals: revealCheck.state === "ok" ? (revealCheck.payload.reveals ?? []) : b.reveals,
    commitments: commitsPending > 0 ? { ...b.commitments, ...commitments } : commitments,
    tallyCheck,
    revealCheck,
    commitsChecked: latest.size,
    commitsPending,
    commitProblems,
    bulletinCommitmentsMatch,
  };
}
