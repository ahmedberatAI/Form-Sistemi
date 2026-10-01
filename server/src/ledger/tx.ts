// İşlem kimliği, imza baytları, kişisel veri savunması ve çift imza kanıtı denetimi.
import {
  CHAIN_ID,
  LEDGER_TX_LABELS,
  canonicalJson,
  ed25519Sign,
  ed25519Verify,
  hashCanonical,
  hexToBytes,
  precommitSignBytes,
  sha256Hex,
  utf8ToBytes,
  type LedgerTxType,
} from "@forum/shared";
import { MAX_TX_BYTES, type EvidencePayload, type SignedTx, type VoteMsg } from "./types";

export const LEDGER_TX_TYPES = Object.keys(LEDGER_TX_LABELS) as LedgerTxType[];
const TYPE_SET = new Set<string>(LEDGER_TX_TYPES);

/** Defter yükünde (iç içe dahil) bulunması YASAK anahtarlar. Karşılaştırma büyük/küçük harf duyarsızdır. */
export const PII_KEYS = [
  "firstName",
  "lastName",
  "tckn",
  "birthDate",
  "address",
  "email",
  "phone",
  "body",
  "text",
  "password",
  "nickname",
] as const;
const PII_SET = new Set<string>(PII_KEYS.map((k) => k.toLowerCase()));

const HEX64 = /^[0-9a-f]{64}$/;
export const isHash = (v: unknown): v is string => typeof v === "string" && HEX64.test(v);

export function isTxType(t: unknown): t is LedgerTxType {
  return typeof t === "string" && TYPE_SET.has(t);
}

export function isPlainObject(v: unknown): v is Record<string, unknown> {
  return typeof v === "object" && v !== null && !Array.isArray(v);
}

/** Yasak anahtarın yolunu döner (ör. "a.b[0].email"), yoksa null. */
export function findPiiKey(value: unknown, path = "", depth = 0): string | null {
  if (depth > 64) return path || "(çok derin)";
  if (Array.isArray(value)) {
    for (let i = 0; i < value.length; i++) {
      const r = findPiiKey(value[i], `${path}[${i}]`, depth + 1);
      if (r) return r;
    }
    return null;
  }
  if (isPlainObject(value)) {
    for (const k of Object.keys(value)) {
      const p = path ? `${path}.${k}` : k;
      if (PII_SET.has(k.toLowerCase())) return p;
      const r = findPiiKey(value[k], p, depth + 1);
      if (r) return r;
    }
  }
  return null;
}

/** Yükü saf JSON'a indirger (undefined atılır, bigint → string). Kanonik olmayan değerlerde hata fırlatır. */
export function normalizePayload(payload: Record<string, unknown>): Record<string, unknown> {
  return JSON.parse(canonicalJson(payload)) as Record<string, unknown>;
}

export function txNonce(type: string, payload: Record<string, unknown>): string {
  const n = payload._nonce;
  if (typeof n === "string") return n;
  if (typeof n === "number") return String(n);
  return hashCanonical({ type, payload }).slice(0, 32);
}

/** submittedAt ve sig özete GİRMEZ → aynı (type, payload, nonce) her zaman aynı özet. */
export function computeTxHash(type: string, payload: Record<string, unknown>, nonce: string): string {
  return hashCanonical({ type, payload, nonce });
}

/** Uygulama imzası, işlem özetinin 32 baytı üzerindedir. */
export function signTxHash(hash: string, appSecretKey: string): string {
  return ed25519Sign(hexToBytes(hash), appSecretKey);
}

// ───────────── İmza doğrulama önbelleği ─────────────
// ed25519Verify saf bir fonksiyondur; (anahtar, imza, mesaj özeti) üçlüsüyle önbelleğe almak sonucu değiştirmez.
// Aynı süreçteki dört doğrulayıcının aynı imzayı dört kez doğrulamasını önler.
const verifyMemo = new Map<string, boolean>();
const MEMO_LIMIT = 50_000;

export function verifySig(sig: unknown, message: Uint8Array, publicKey: string): boolean {
  if (typeof sig !== "string" || sig.length !== 128) return false;
  const key = publicKey + sig + sha256Hex(message);
  const hit = verifyMemo.get(key);
  if (hit !== undefined) return hit;
  const ok = ed25519Verify(sig, message, publicKey);
  if (verifyMemo.size >= MEMO_LIMIT) verifyMemo.clear();
  verifyMemo.set(key, ok);
  return ok;
}

export function prevoteSignBytes(height: number, round: number, blockHash: string | null): Uint8Array {
  return utf8ToBytes(canonicalJson({ chainId: CHAIN_ID, type: "prevote", height, round, blockHash }));
}

export function proposalSignBytes(height: number, round: number, polRound: number, blockHash: string): Uint8Array {
  return utf8ToBytes(canonicalJson({ chainId: CHAIN_ID, type: "proposal", height, round, polRound, blockHash }));
}

export function voteSignBytes(type: "prevote" | "precommit", height: number, round: number, blockHash: string | null): Uint8Array {
  return type === "prevote" ? prevoteSignBytes(height, round, blockHash) : precommitSignBytes(height, round, blockHash);
}

// ───────────── İşlem denetimi (CheckTx) ─────────────

export interface TxCheckContext {
  appPublicKey: string;
  validators: Map<string, string>; // id → publicKey
}

/**
 * Bir işlemin kendi başına geçerliliği. Başarılıysa tx.hash yeniden hesaplanmış değere ayarlanır ve null döner;
 * aksi halde Türkçe hata metni döner.
 */
export function checkTx(tx: SignedTx, c: TxCheckContext): string | null {
  if (!isPlainObject(tx)) return "İşlem biçimi geçersiz";
  if (!isTxType(tx.type)) return `Geçersiz işlem türü: ${String(tx.type)}`;
  if (!isPlainObject(tx.payload)) return "İşlem yükü bir nesne olmalı";
  if (typeof tx.nonce !== "string") return "Nonce eksik";
  if (typeof tx.submittedAt !== "number" || !Number.isFinite(tx.submittedAt)) return "Gönderim zamanı geçersiz";
  const pii = findPiiKey(tx.payload);
  if (pii) return `Kişisel veri alanı içeriyor: ${pii}`;
  let hash: string;
  try {
    const canon = canonicalJson({ type: tx.type, payload: tx.payload, nonce: tx.nonce });
    if (canon.length > MAX_TX_BYTES) return "İşlem çok büyük";
    hash = sha256Hex(canon);
  } catch {
    return "İşlem yükü kanonik JSON'a çevrilemiyor";
  }
  if (tx.nonce !== txNonce(tx.type, tx.payload)) return "Nonce kurala uymuyor";
  if (!verifySig(tx.sig, hexToBytes(hash), c.appPublicKey)) return "Uygulama imzası geçersiz";
  if (tx.type === "EVIDENCE") {
    const e = checkEvidence(tx.payload, c.validators);
    if (e) return e;
  }
  tx.hash = hash;
  return null;
}

export function checkEvidence(p: Record<string, unknown>, validators: Map<string, string>): string | null {
  const pk = typeof p.validator === "string" ? validators.get(p.validator) : undefined;
  if (!pk) return "Kanıt: bilinmeyen doğrulayıcı";
  if (!Number.isInteger(p.height) || (p.height as number) < 1) return "Kanıt: yükseklik geçersiz";
  if (!Number.isInteger(p.round) || (p.round as number) < 0) return "Kanıt: tur geçersiz";
  const a = p.voteA as Record<string, unknown> | undefined;
  const b = p.voteB as Record<string, unknown> | undefined;
  if (!isPlainObject(a) || !isPlainObject(b)) return "Kanıt: oylar eksik";
  for (const v of [a, b]) {
    if (!(v.blockHash === null || isHash(v.blockHash))) return "Kanıt: blok özeti geçersiz";
  }
  if (a.blockHash === b.blockHash) return "Kanıt: iki oy aynı bloğa ait";
  for (const v of [a, b]) {
    const bytes = precommitSignBytes(p.height as number, p.round as number, v.blockHash as string | null);
    if (!verifySig(v.sig, bytes, pk)) return "Kanıt: oy imzası geçersiz";
  }
  return null;
}

/** İki çelişkili precommit'ten kanonik (sıralı) kanıt yükü üretir: aynı ihlal → aynı işlem özeti. */
export function makeEvidence(a: VoteMsg, b: VoteMsg): EvidencePayload {
  const [x, y] = (a.blockHash ?? "") < (b.blockHash ?? "") ? [a, b] : [b, a];
  return {
    validator: a.validator,
    height: a.height,
    round: a.round,
    voteA: { blockHash: x.blockHash, sig: x.sig },
    voteB: { blockHash: y.blockHash, sig: y.sig },
  };
}
