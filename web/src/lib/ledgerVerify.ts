// Sunucuya güvenmeden doğrulama için defterden "bağlı" veri yükleme.
// Sunucudan gelen her işlem içeriği (1) istenen özete gerçekten ait mi (ledgerTxHash), (2) o özetin dahil olma kanıtı
// cihazda sabitlenmiş doğrulayıcı anahtarlarıyla geçerli mi — ikisi de denetlenir. Böylece sunucu bülteni (hazır
// "commitments" haritası, açıklama listesi, sayım yükü) değiştirse bile doğrulama bunu yakalar.
//
// İstek bütçesi (bulgu: büyük oylamada hız sınırı → sahte "BAŞARISIZ"): oy taahhütleri tek tek (işlem + kanıt = 2 istek) değil
// BLOK BLOK doğrulanır. Taahhüdün hangi blokta olduğu defter listesinden (ipucu; güvenilmez) ya da işlemin kendisinden öğrenilir,
// blok bir kez indirilir ve verifyBlock ile (blok özeti, Merkle kökü, her işlemin içerik-özet bağı, sabitlenmiş anahtarlarla
// 2f+1 imza) denetlenir; o bloktaki bütün taahhütler bu tek doğrulamayla bağlanır. Hız sınırı (429), ağ ve 5xx hataları
// GEÇİCİDİR: Retry-After kadar beklenip yeniden denenir; yine alınamazsa sonuç "unavailable" (kesin değil) olur — asla
// kurcalama anlamına gelen "fail" sayılmaz ve eksik taahhüt haritasıyla sayım yapılmaz.
import {
  ed25519Verify,
  hexToBytes,
  ledgerTxHash,
  txMatchesHash,
  verifyInclusionProof,
  type BlockView,
  type BulletinRound,
  type CommittedTxView,
  type InclusionProof,
  type RevealEntry,
  type TallyPayload,
} from "@forum/shared";
import { isApiError } from "../api/client";
import { getBlock, getProof, getTx, listTxs } from "../api/endpoints";
import { verifyBlock } from "./blockVerify";
import type { PinnedValidators } from "./validators";

export type BoundResult<T> =
  | {
      state: "ok";
      payload: T;
      height: number;
      index: number;
      /** İşlemin bloğunu bağlayan doğrulayıcı imzası sayısı */
      sigCount: number;
      /** Tek işlem kanıtla yüklendiyse kanıt (blok blok doğrulamada yok) */
      proof?: InclusionProof;
    }
  | { state: "pending" } // henüz bloğa girmedi (404)
  /** Geçici: hız sınırı (429), ağ/zaman aşımı ya da 5xx — sonuç alınamadı. Kurcalama DEĞİLDİR; yeniden denenir. */
  | { state: "unavailable"; reason: string; retryAfterSec?: number }
  | { state: "fail"; reason: string };

/** İşlem özetinin adres çubuğundaki hâli: sunucu da özeti küçük harfe çevirerek arar (hashParams), karşılaştırma buna göre yapılır. */
export function normalizeTxHash(raw: string): string {
  return String(raw ?? "").trim().toLowerCase();
}

export interface TxPageCheck {
  /** Adresteki (istenen) özet, normalleştirilmiş */
  expected: string;
  /** Sunucunun verdiği içerikten yeniden hesaplanan özet ("" → hesaplanamadı) */
  recomputed: string;
  /** İçerik adresteki özete ait mi: yeniden hesaplanan özet VE sunucunun `hash` iddiası adrestekiyle aynı */
  contentOk: boolean;
  /** Dahil olma kanıtı, sabitlenmiş anahtarlarla ve ADRESTEKİ işlem için geçerli mi (null: kanıt ya da anahtarlar henüz yok) */
  proof: { ok: boolean; reasons: string[] } | null;
  /** Uygulama imzası adresteki özet üzerinde geçerli mi (null: sabitlenmiş uygulama anahtarı yok) */
  sigOk: boolean | null;
}

/**
 * İşlem sayfasının (/islem/<özet>) tarayıcıda doğrulaması. Her denetim sunucunun söylediği özete değil ADRESTEKİ özete bağlanır
 * (loadBoundTx ile aynı desen): sunucu başka bir işlemin kendi içinde tutarlı içeriğini, kanıtını ve imzasını döndürse bile
 * içerik–özet bağı, kanıtın işlem özeti ve imza (adresteki özet üzerinde) tutmaz.
 */
export function checkTxPage(
  urlHash: string,
  tx: CommittedTxView | null | undefined,
  proof: InclusionProof | null | undefined,
  pinned: Pick<PinnedValidators, "validators" | "appPublicKey"> | null | undefined,
): TxPageCheck {
  const expected = normalizeTxHash(urlHash);
  let recomputed = "";
  let contentOk = false;
  if (tx) {
    try {
      recomputed = ledgerTxHash(tx);
    } catch {
      recomputed = "";
    }
    contentOk = recomputed !== "" && txMatchesHash(tx, expected);
  }
  let proofCheck: TxPageCheck["proof"] = null;
  if (proof && pinned) {
    try {
      proofCheck = verifyInclusionProof(proof, pinned.validators, expected);
    } catch {
      proofCheck = { ok: false, reasons: ["Kanıt doğrulanırken hata oluştu"] };
    }
  }
  let sigOk: boolean | null = null;
  if (tx && pinned?.appPublicKey) {
    try {
      sigOk = ed25519Verify(tx.sig, hexToBytes(expected), pinned.appPublicKey);
    } catch {
      sigOk = false;
    }
  }
  return { expected, recomputed, contentOk, proof: proofCheck, sigOk };
}

// ───────────── Geçici hatalar ve istek bütçesi ─────────────

const isAbort = (e: unknown): boolean => e instanceof Error && e.name === "AbortError";

/** Geçici hata: hız sınırı (429), ağ/zaman aşımı (status 0) ya da sunucu/vekil hatası (5xx). Kurcalama kanıtı DEĞİLDİR. */
export function isTransientError(e: unknown): boolean {
  return isApiError(e) && (e.status === 429 || e.status === 0 || e.status >= 500);
}

/** Yeniden denemeden önce beklenecek süre (ms): 429'da details.retryAfterSeconds (yoksa 5 sn); diğer geçici hatalarda artan kısa süre. */
export function retryDelayMs(e: unknown, attempt: number): number {
  if (isApiError(e) && e.status === 429) {
    const d = e.details as { retryAfterSeconds?: unknown } | null | undefined;
    const sec = typeof d?.retryAfterSeconds === "number" && Number.isFinite(d.retryAfterSeconds) ? d.retryAfterSeconds : 5;
    return Math.max(250, Math.ceil(sec * 1000));
  }
  return 1000 * (attempt + 1);
}

/** Geçici hatanın kullanıcıya gösterilen açıklaması: sonuç alınamadı (kurcalama değil). */
export function transientReason(e: unknown): string {
  if (isApiError(e) && e.status === 429) {
    return `Sunucunun hız sınırına takıldı; sonuç alınamadı. ${Math.ceil(retryDelayMs(e, 0) / 1000)} saniye kadar sonra yeniden deneyin.`;
  }
  if (isAbort(e)) return "Doğrulama yarıda bırakıldı; sonuç alınamadı.";
  if (isApiError(e) && e.status === 0) return "Sunucuya ulaşılamadı; sonuç alınamadı. Bağlantınızı denetleyip yeniden deneyin.";
  return `Sunucu geçici olarak yanıt veremedi${isApiError(e) ? ` (HTTP ${e.status})` : ""}; sonuç alınamadı, yeniden deneyin.`;
}

function unavailable(e: unknown): { state: "unavailable"; reason: string; retryAfterSec?: number } {
  return { state: "unavailable", reason: transientReason(e), retryAfterSec: isApiError(e) && e.status === 429 ? Math.ceil(retryDelayMs(e, 0) / 1000) : undefined };
}

export interface LedgerProgress {
  /** Doğrulanan taahhüt işlemi */
  done: number;
  /** Toplam taahhüt işlemi */
  total: number;
  /** Hız sınırı nedeniyle bekleniyorsa kalan süre (ms) */
  waitingMs: number;
}

export interface FetchPolicy {
  /** Geçici hatada istek başına en çok kaç kez yeniden denenir (varsayılan 3). */
  maxRetries?: number;
  /** İlk istekten itibaren en çok bu kadar beklenir (ms; varsayılan 150 sn). Daha uzun Retry-After beklenmez: sonuç "unavailable". */
  maxTotalMs?: number;
  /** Aynı anda en çok kaç istek (varsayılan 4). */
  concurrency?: number;
  signal?: AbortSignal;
  /** Testler için saat ve bekleme. */
  now?: () => number;
  sleep?: (ms: number) => Promise<void>;
  /** İlerleme bildirimi (taahhüt sayısı ve hız sınırı beklemesi). */
  onProgress?: (p: LedgerProgress) => void;
}

function abortError(): Error {
  const e = new Error("İptal edildi");
  e.name = "AbortError";
  return e;
}

const realSleep = (ms: number, signal?: AbortSignal) =>
  new Promise<void>((resolve, reject) => {
    if (signal?.aborted) return reject(abortError());
    const onAbort = () => {
      clearTimeout(t);
      reject(abortError());
    };
    const t = setTimeout(() => {
      signal?.removeEventListener("abort", onAbort);
      resolve();
    }, ms);
    signal?.addEventListener("abort", onAbort, { once: true });
  });

/**
 * Bir doğrulama çalıştırmasının istekleri: geçici hatada (429'da Retry-After kadar) bekleyip yeniden dener. Bir istek 429 alınca
 * BÜTÜN işçiler o süre bekler (sınırı zorlamaya devam etmez). Toplam süre bütçesi aşılacaksa hata çağırana geçer (→ "unavailable").
 */
export class LedgerFetcher {
  private resumeAt = 0;
  private readonly start: number;
  private readonly now: () => number;
  private readonly sleep: (ms: number) => Promise<void>;
  readonly concurrency: number;
  /** Gönderilen istek sayısı (tanılama ve testler) */
  requests = 0;
  /** Hız sınırı beklemesi başlarken çağrılır (ilerleme göstergesi için) */
  onWait?: (ms: number) => void;

  constructor(private readonly policy: FetchPolicy = {}) {
    this.now = policy.now ?? Date.now;
    this.sleep = policy.sleep ?? ((ms) => realSleep(ms, policy.signal));
    this.start = this.now();
    this.concurrency = Math.max(1, policy.concurrency ?? 4);
  }

  /** Hız sınırı nedeniyle bekleniyorsa kalan süre (ms). */
  waitingMs(): number {
    return Math.max(0, this.resumeAt - this.now());
  }

  async call<T>(fn: () => Promise<T>): Promise<T> {
    const maxRetries = this.policy.maxRetries ?? 3;
    const maxTotal = this.policy.maxTotalMs ?? 150_000;
    for (let attempt = 0; ; attempt++) {
      for (let wait = this.waitingMs(); wait > 0; wait = this.waitingMs()) {
        this.onWait?.(wait);
        await this.sleep(wait);
      }
      if (this.policy.signal?.aborted) throw abortError();
      try {
        this.requests++;
        return await fn();
      } catch (e) {
        if (!isTransientError(e) || attempt >= maxRetries) throw e;
        const until = this.now() + retryDelayMs(e, attempt);
        if (until - this.start > maxTotal) throw e;
        this.resumeAt = Math.max(this.resumeAt, until);
      }
    }
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

// ───────────── Tek işlem (kanıtla) ─────────────

/** Tek bir işlemi defterden alır; içerik-özet bağını ve dahil olma kanıtını denetler. Geçici hata "unavailable" döner, "fail" değil. */
export async function loadBoundTx<T = Record<string, unknown>>(
  txHash: string,
  pinned: PinnedValidators,
  expectedType?: string,
  fetcher: LedgerFetcher = new LedgerFetcher(),
): Promise<BoundResult<T>> {
  try {
    const [tx, proof] = await Promise.all([fetcher.call(() => getTx(txHash)), fetcher.call(() => getProof(txHash))]);
    if (!txMatchesHash(tx, txHash)) return { state: "fail", reason: "İşlem içeriği özetiyle eşleşmiyor (içerik değiştirilmiş olabilir)." };
    if (expectedType && tx.type !== expectedType) return { state: "fail", reason: `Beklenen işlem türü ${expectedType}, defterde ${tx.type}.` };
    const v = verifyInclusionProof(proof, pinned.validators, txHash);
    if (!v.ok) return { state: "fail", reason: v.reasons.join("; ") };
    return { state: "ok", payload: tx.payload as T, proof, height: proof.height, index: proof.index, sigCount: proof.header.commitSigs.length };
  } catch (e) {
    if (isApiError(e) && e.status === 404) return { state: "pending" };
    if (isTransientError(e) || isAbort(e)) return unavailable(e);
    return { state: "fail", reason: e instanceof Error ? e.message : String(e) };
  }
}

// ───────────── Blok blok doğrulama ─────────────

export type VerifiedBlock =
  | { state: "ok"; height: number; sigCount: number; txs: Map<string, { index: number; type: string; payload: Record<string, unknown> }> }
  | { state: "fail"; reason: string }
  | { state: "unavailable"; reason: string; retryAfterSec?: number };

/**
 * İndirilen bloğu sabitlenmiş anahtarlarla doğrular (saf işlev): istenen yükseklik, blok özeti, Merkle kökü, her işlemin
 * içerik-özet bağı ve 2f+1 imza. Bir işlemin dahil olma kanıtıyla aynı güvenceyi verir; bloktaki bütün işlemler için tek seferde.
 */
export function checkFetchedBlock(height: number, b: BlockView, pinned: Pick<PinnedValidators, "validators">): VerifiedBlock {
  if (!b || b.height !== height) return { state: "fail", reason: `İstenen blok #${height}, sunucunun verdiği #${b?.height ?? "?"}.` };
  const c = verifyBlock(b, pinned.validators);
  if (c.allOk !== true) {
    const why = [
      !c.hashOk && "blok özeti tutmuyor",
      !c.rootOk && "Merkle kökü tutmuyor",
      c.txBad > 0 && `${c.txBad} işlemin içeriği özetiyle eşleşmiyor`,
      c.sigsOk !== true && `yeterli doğrulayıcı imzası yok (${c.validSigs}/${c.need ?? "?"})`,
    ].filter(Boolean);
    return { state: "fail", reason: `Blok #${height} doğrulanamadı: ${why.join(", ") || "denetim tutmadı"}.` };
  }
  const txs = new Map<string, { index: number; type: string; payload: Record<string, unknown> }>();
  b.txs.forEach((t, i) => txs.set(t.hash, { index: i, type: t.type, payload: t.payload }));
  return { state: "ok", height, sigCount: c.validSigs, txs };
}

export interface LedgerRound {
  /** Defterden doğrulanmış sayım yükü (yoksa bülten yükü) */
  tally: TallyPayload;
  /** Defterden doğrulanmış açıklama listesi (yoksa bülten listesi) */
  reveals: RevealEntry[];
  /** Defterden doğrulanmış VOTE_COMMIT işlemlerinden kurulan "pusula → son taahhüt" haritası */
  commitments: Record<string, string>;
  tallyCheck: BoundResult<TallyPayload> | { state: "missing" };
  revealCheck: BoundResult<{ reveals?: RevealEntry[] }> | { state: "missing" };
  commitsChecked: number;
  commitsPending: number;
  /** Geçici hata (hız sınırı/ağ/5xx) yüzünden doğrulanamayan taahhüt işlemi: sonuç KESİN DEĞİL (kurcalama değil) */
  commitsUnavailable: number;
  /** Bir şey geçici hata yüzünden alınamadıysa gerekçesi (ör. hız sınırı) */
  unavailableReason: string | null;
  /** Bağ kurulamayan / tutarsız taahhüt işlemleri (gerçek uyuşmazlık) */
  commitProblems: string[];
  /** Sunucunun bültende verdiği taahhüt haritası defterden kurulanla aynı mı (yalnız bütün taahhütler doğrulandıysa anlamlı) */
  bulletinCommitmentsMatch: boolean;
  /** Sayım, açıklama ve bütün taahhütler kesin olarak alındı mı (geçici hata yok). false iken yeniden sayım YAPILMAZ. */
  complete: boolean;
  /** Gönderilen API isteği sayısı (tanılama) */
  requests: number;
}

type CommitPayload = { proposalId?: string; round?: number; ballotId?: string; commitment?: string };
/** Sunucunun /api/ledger/txs için verdiği en büyük sayfa. */
export const LEDGER_LIST_LIMIT = 500;

/** Bir oylama turunun sayım, açıklama ve taahhüt verilerini defterden bağlı olarak yükler. */
export async function loadRoundFromLedger(proposalId: string, b: BulletinRound, pinned: PinnedValidators, policy: FetchPolicy = {}): Promise<LedgerRound> {
  const fetcher = new LedgerFetcher(policy);
  const tallyCheck = b.tallyTx ? await loadBoundTx<TallyPayload>(b.tallyTx, pinned, "TALLY", fetcher) : ({ state: "missing" } as const);
  const revealCheck = b.revealTx ? await loadBoundTx<{ reveals?: RevealEntry[] }>(b.revealTx, pinned, "BALLOT_REVEAL", fetcher) : ({ state: "missing" } as const);

  // Hangi taahhüt hangi blokta? Defter listesi (en yeni 500) yalnız İPUCUDUR: blok yine sabitlenmiş anahtarlarla doğrulanır,
  // işlem o blokta yoksa işlemin kendisi sorulur. Liste alınamazsa her işlem tek tek sorulur.
  const wanted = new Set(b.commitTxs.map((c) => normalizeTxHash(c.txHash)));
  const hint = new Map<string, number>();
  if (b.commitTxs.length > 1) {
    try {
      const list = await fetcher.call(() => listTxs({ type: "VOTE_COMMIT", proposalId, limit: LEDGER_LIST_LIMIT }));
      for (const t of Array.isArray(list) ? list : []) {
        if (t && typeof t.hash === "string" && wanted.has(t.hash) && Number.isInteger(t.height)) hint.set(t.hash, t.height);
      }
    } catch {
      /* ipucu yok: işlemler tek tek sorulur */
    }
  }

  const blocks = new Map<number, Promise<VerifiedBlock>>();
  // Doğrulanmış bloklarda görülen işlemler → yükseklik: aynı bloktaki öteki taahhütler için işlem ayrıca sorulmaz.
  const located = new Map<string, number>();
  const blockAt = (height: number): Promise<VerifiedBlock> => {
    let p = blocks.get(height);
    if (!p) {
      p = fetcher.call(() => getBlock(height)).then(
        (blk) => {
          const v = checkFetchedBlock(height, blk, pinned);
          if (v.state === "ok") for (const h of v.txs.keys()) located.set(h, height);
          return v;
        },
        (e: unknown): VerifiedBlock =>
          isTransientError(e) || isAbort(e) ? unavailable(e) : { state: "fail", reason: `Blok #${height} alınamadı: ${e instanceof Error ? e.message : String(e)}` },
      );
      blocks.set(height, p);
    }
    return p;
  };

  const loadCommit = async (txHashRaw: string): Promise<BoundResult<CommitPayload>> => {
    const txHash = normalizeTxHash(txHashRaw);
    const fromBlock = async (height: number): Promise<BoundResult<CommitPayload> | null> => {
      const blk = await blockAt(height);
      if (blk.state !== "ok") return blk;
      const t = blk.txs.get(txHash);
      if (!t) return null;
      if (t.type !== "VOTE_COMMIT") return { state: "fail", reason: `Beklenen işlem türü VOTE_COMMIT, defterde ${t.type}.` };
      return { state: "ok", payload: t.payload as CommitPayload, height, index: t.index, sigCount: blk.sigCount };
    };
    const seen = located.get(txHash);
    if (seen !== undefined) {
      const r = await fromBlock(seen);
      if (r) return r;
    }
    const hinted = hint.get(txHash);
    if (hinted !== undefined && hinted !== seen) {
      const r = await fromBlock(hinted);
      if (r) return r;
    }
    let height: number | null;
    try {
      const tx = await fetcher.call(() => getTx(txHash));
      height = typeof tx.height === "number" && Number.isInteger(tx.height) ? tx.height : null;
    } catch (e) {
      if (isApiError(e) && e.status === 404) return { state: "pending" };
      if (isTransientError(e) || isAbort(e)) return unavailable(e);
      return { state: "fail", reason: e instanceof Error ? e.message : String(e) };
    }
    if (height === null) return { state: "pending" };
    return (await fromBlock(height)) ?? { state: "fail", reason: `İşlem, sunucunun bildirdiği blokta (#${height}) yok.` };
  };

  let done = 0;
  const total = b.commitTxs.length;
  const progress = () => policy.onProgress?.({ done, total, waitingMs: fetcher.waitingMs() });
  fetcher.onWait = progress;
  progress();
  const results = await mapLimit(b.commitTxs, fetcher.concurrency, async (c) => {
    const r = await loadCommit(c.txHash);
    done++;
    progress();
    return { c, r };
  });

  const commitProblems: string[] = [];
  let commitsPending = 0;
  let commitsUnavailable = 0;
  let unavailableReason: string | null = null;
  const latest = new Map<string, { commitment: string; height: number; index: number }>();
  for (const { c, r } of results) {
    if (r.state === "pending") {
      commitsPending++;
      continue;
    }
    if (r.state === "unavailable") {
      commitsUnavailable++;
      unavailableReason ??= r.reason;
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

  if (!unavailableReason && tallyCheck.state === "unavailable") unavailableReason = tallyCheck.reason;
  if (!unavailableReason && revealCheck.state === "unavailable") unavailableReason = revealCheck.reason;
  const complete = commitsUnavailable === 0 && tallyCheck.state !== "unavailable" && revealCheck.state !== "unavailable";

  const bulletinKeys = Object.keys(b.commitments);
  const bulletinCommitmentsMatch =
    commitsPending === 0 && commitsUnavailable === 0 && bulletinKeys.length === latest.size && bulletinKeys.every((k) => b.commitments[k] === commitments[k]);

  return {
    tally: tallyCheck.state === "ok" ? tallyCheck.payload : b.tally,
    reveals: revealCheck.state === "ok" ? (revealCheck.payload.reveals ?? []) : b.reveals,
    commitments: commitsPending > 0 ? { ...b.commitments, ...commitments } : commitments,
    tallyCheck,
    revealCheck,
    commitsChecked: latest.size,
    commitsPending,
    commitsUnavailable,
    unavailableReason,
    commitProblems,
    bulletinCommitmentsMatch,
    complete,
    requests: fetcher.requests,
  };
}
