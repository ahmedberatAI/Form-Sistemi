// Blok ve zincir doğrulama (Türkçe hata metinleri). Hem düğümler (senkron/onarım) hem verifyChain kullanır.
import { blockHash, hexToBytes, merkleRoot, precommitSignBytes, type BlockHeaderView } from "@forum/shared";
import { computeTxHash, isHash, verifySig } from "./tx";
import { GENESIS_HASH, type StoredBlock } from "./types";

export interface ChainParams {
  ids: string[];
  validators: Map<string, string>; // id → publicKey
  appPublicKey: string;
  quorum: number;
}

export interface PrevInfo {
  hash: string;
  time: number;
}

export const GENESIS: PrevInfo = { hash: GENESIS_HASH, time: 0 };

export function proposerOf(height: number, round: number, ids: string[]): string {
  return ids[(height + round) % ids.length];
}

/** > 2/3 oy gücü: N = 3f+1 için 2f+1. */
export function quorumOf(n: number): number {
  return Math.floor((2 * n) / 3) + 1;
}

export function faultToleranceOf(n: number): number {
  return Math.floor((n - 1) / 3);
}

function safe<T>(fn: () => T, fallback: T): T {
  try {
    return fn();
  } catch {
    return fallback;
  }
}

/** Ucuz yapısal denetim (imzalar hariç): yükseklik, bağlantı, blok özeti, öneren, işlem özetleri, Merkle kökü. */
export function structuralErrors(b: StoredBlock, height: number, prev: PrevInfo, ids: string[]): string[] {
  const e: string[] = [];
  const h = b.header;
  if (h.height !== height) e.push("Yükseklik sırası bozuk");
  if (h.prevHash !== prev.hash) e.push("Önceki blok özeti (prevHash) zincirle eşleşmiyor");
  if (!(h.time > prev.time)) e.push("Blok zamanı önceki bloktan büyük değil");
  if (!Number.isInteger(h.round) || h.round < 0 || h.proposer !== proposerOf(h.height, h.round, ids)) {
    e.push("Öneren, (yükseklik + tur) sırasına uymuyor");
  }
  if (safe(() => blockHash(h), "") !== h.hash) e.push("Blok özeti yeniden hesaplanınca tutmuyor");
  if (h.txCount !== b.txs.length) e.push("İşlem sayısı başlıkla uyuşmuyor");
  if (b.txs.length === 0) e.push("Boş blok (işlemsiz blok üretilmez)");
  b.txs.forEach((tx, i) => {
    if (safe(() => computeTxHash(tx.type, tx.payload, tx.nonce), "") !== tx.hash) {
      e.push(`İşlem #${i} özeti yeniden hesaplanınca tutmuyor (içerik değiştirilmiş)`);
    }
  });
  if (safe(() => merkleRoot(b.txs.map((t) => t.hash)), "") !== h.txRoot) e.push("Merkle kökü (txRoot) işlem özetleriyle eşleşmiyor");
  return e;
}

/** Geçerli ve farklı doğrulayıcılardan gelen precommit imzası sayısı (blok özeti yeniden hesaplanarak). */
export function countCommitSigs(h: BlockHeaderView, validators: Map<string, string>): number {
  const computed = safe(() => blockHash(h), "");
  if (!computed) return 0;
  const bytes = precommitSignBytes(h.height, h.round, computed);
  const seen = new Set<string>();
  for (const s of h.commitSigs ?? []) {
    const pk = validators.get(s.validator);
    if (!pk || seen.has(s.validator)) continue;
    if (verifySig(s.sig, bytes, pk)) seen.add(s.validator);
  }
  return seen.size;
}

export function signatureErrors(b: StoredBlock, p: ChainParams): string[] {
  const e: string[] = [];
  b.txs.forEach((tx, i) => {
    if (!isHash(tx.hash) || !verifySig(tx.sig, hexToBytes(tx.hash), p.appPublicKey)) e.push(`İşlem #${i} uygulama imzası geçersiz`);
  });
  const n = countCommitSigs(b.header, p.validators);
  if (n < p.quorum) e.push(`Yeterli geçerli doğrulayıcı imzası yok (${n}/${p.quorum})`);
  return e;
}

/** Tam blok denetimi: yapısal + imzalar. */
export function blockErrors(b: StoredBlock, height: number, prev: PrevInfo, p: ChainParams): string[] {
  const e = structuralErrors(b, height, prev, p.ids);
  return e.concat(signatureErrors(b, p));
}
