// Sunucu ve istemcinin AYNI sonucu üretmesi gereken kriptografik yardımcılar.
// Saf JavaScript (@noble) kullanılır: Node, tarayıcı ve Android WebView'de aynı çalışır.
import { sha256 } from "@noble/hashes/sha2.js";
import { bytesToHex, concatBytes, hexToBytes, utf8ToBytes } from "@noble/hashes/utils.js";
import { ed25519 } from "@noble/curves/ed25519.js";
import type { BlockHeaderView, InclusionProof, VoteChoice } from "./types";

/**
 * Kanonik JSON: nesne anahtarları sözlük sırasına (UTF-16 kod birimi) göre sıralanır,
 * `undefined` alanlar atlanır, boşluk kullanılmaz. Sonlu olmayan sayılar hata verir.
 * İmzalanan / özeti alınan her şey bu fonksiyondan geçmelidir.
 */
export function canonicalJson(value: unknown): string {
  if (value === null) return "null";
  switch (typeof value) {
    case "number":
      if (!Number.isFinite(value)) throw new Error("canonicalJson: sonlu olmayan sayı");
      return JSON.stringify(value);
    case "boolean":
      return value ? "true" : "false";
    case "string":
      return JSON.stringify(value);
    case "bigint":
      return JSON.stringify(value.toString());
    case "object": {
      if (Array.isArray(value)) {
        return "[" + value.map((v) => (v === undefined ? "null" : canonicalJson(v))).join(",") + "]";
      }
      const obj = value as Record<string, unknown>;
      const keys = Object.keys(obj)
        .filter((k) => obj[k] !== undefined)
        .sort();
      return "{" + keys.map((k) => JSON.stringify(k) + ":" + canonicalJson(obj[k])).join(",") + "}";
    }
    default:
      throw new Error(`canonicalJson: desteklenmeyen tip ${typeof value}`);
  }
}

export function sha256Hex(data: string | Uint8Array): string {
  return bytesToHex(sha256(typeof data === "string" ? utf8ToBytes(data) : data));
}

export function hashCanonical(value: unknown): string {
  return sha256Hex(canonicalJson(value));
}

export { bytesToHex, hexToBytes, utf8ToBytes };

// ───────────── Merkle ağacı (RFC 6962 alan ayrımı: yaprak 0x00, iç düğüm 0x01) ─────────────

const LEAF = new Uint8Array([0]);
const NODE = new Uint8Array([1]);

export function merkleLeaf(txHashHex: string): string {
  return bytesToHex(sha256(concatBytes(LEAF, hexToBytes(txHashHex))));
}

function merkleNode(leftHex: string, rightHex: string): string {
  return bytesToHex(sha256(concatBytes(NODE, hexToBytes(leftHex), hexToBytes(rightHex))));
}

function largestPowerOfTwoBelow(n: number): number {
  let k = 1;
  while (k * 2 < n) k *= 2;
  return k;
}

const EMPTY_ROOT = sha256Hex(new Uint8Array(0));

/** RFC 6962 MTH. Girdi: tx özetleri (hex). */
export function merkleRoot(txHashes: string[]): string {
  if (txHashes.length === 0) return EMPTY_ROOT;
  return mth(txHashes.map(merkleLeaf));
}

function mth(leaves: string[]): string {
  if (leaves.length === 1) return leaves[0];
  const k = largestPowerOfTwoBelow(leaves.length);
  return merkleNode(mth(leaves.slice(0, k)), mth(leaves.slice(k)));
}

/** `index` numaralı yaprağın denetim yolu (kökten uzağa doğru değil, yapraktan köke doğru). */
export function merkleProof(txHashes: string[], index: number): { hash: string; side: "L" | "R" }[] {
  if (index < 0 || index >= txHashes.length) throw new Error("merkleProof: geçersiz indeks");
  const leaves = txHashes.map(merkleLeaf);
  const path: { hash: string; side: "L" | "R" }[] = [];
  const walk = (ls: string[], i: number) => {
    if (ls.length === 1) return;
    const k = largestPowerOfTwoBelow(ls.length);
    if (i < k) {
      walk(ls.slice(0, k), i);
      path.push({ hash: mth(ls.slice(k)), side: "R" });
    } else {
      walk(ls.slice(k), i - k);
      path.push({ hash: mth(ls.slice(0, k)), side: "L" });
    }
  };
  walk(leaves, index);
  return path;
}

export function verifyMerklePath(txHashHex: string, path: { hash: string; side: "L" | "R" }[], root: string): boolean {
  let acc = merkleLeaf(txHashHex);
  for (const step of path) {
    acc = step.side === "R" ? merkleNode(acc, step.hash) : merkleNode(step.hash, acc);
  }
  return acc === root;
}

// ───────────── Blok başlığı ve doğrulayıcı imzaları ─────────────

export const CHAIN_ID = "forum-sistemi-1";

/** Blok özeti: imzalar HARİÇ başlık alanlarının kanonik JSON'unun SHA-256'sı. */
export function blockHash(h: Pick<BlockHeaderView, "height" | "round" | "prevHash" | "time" | "proposer" | "txRoot" | "txCount">): string {
  return hashCanonical({
    chainId: CHAIN_ID,
    height: h.height,
    round: h.round,
    prevHash: h.prevHash,
    time: h.time,
    proposer: h.proposer,
    txRoot: h.txRoot,
    txCount: h.txCount,
  });
}

/** Tendermint "precommit" oyunun imzalanan baytları. */
export function precommitSignBytes(height: number, round: number, blockHashHex: string | null): Uint8Array {
  return utf8ToBytes(canonicalJson({ chainId: CHAIN_ID, type: "precommit", height, round, blockHash: blockHashHex }));
}

export function ed25519Verify(sigHex: string, message: Uint8Array, publicKeyHex: string): boolean {
  try {
    return ed25519.verify(hexToBytes(sigHex), message, hexToBytes(publicKeyHex));
  } catch {
    return false;
  }
}

export function ed25519Sign(message: Uint8Array, secretKeyHex: string): string {
  return bytesToHex(ed25519.sign(message, hexToBytes(secretKeyHex)));
}

export function ed25519PublicKey(secretKeyHex: string): string {
  return bytesToHex(ed25519.getPublicKey(hexToBytes(secretKeyHex)));
}

export function ed25519RandomSecretKey(): string {
  return bytesToHex(ed25519.utils.randomSecretKey());
}

/** Bir dahil olma kanıtının tam doğrulaması: Merkle yolu + blok özeti + ≥ 2f+1 geçerli precommit imzası. */
export function verifyInclusionProof(
  proof: InclusionProof,
  pinnedValidators?: { id: string; publicKey: string }[],
): { ok: boolean; reasons: string[] } {
  const reasons: string[] = [];
  const validators = pinnedValidators ?? proof.validators;
  if (!verifyMerklePath(proof.txHash, proof.path, proof.txRoot)) reasons.push("Merkle yolu kökle eşleşmiyor");
  if (proof.header.txRoot !== proof.txRoot) reasons.push("Başlıktaki txRoot kanıttakiyle aynı değil");
  const computed = blockHash(proof.header);
  if (computed !== proof.header.hash) reasons.push("Blok özeti yeniden hesaplanınca tutmuyor");
  const n = validators.length;
  const f = Math.floor((n - 1) / 3);
  const need = 2 * f + 1;
  const seen = new Set<string>();
  for (const s of proof.header.commitSigs) {
    const v = validators.find((x) => x.id === s.validator);
    if (!v || seen.has(v.id)) continue;
    if (ed25519Verify(s.sig, precommitSignBytes(proof.header.height, proof.header.round, computed), v.publicKey)) seen.add(v.id);
  }
  if (seen.size < need) reasons.push(`Yeterli doğrulayıcı imzası yok (${seen.size}/${need})`);
  return { ok: reasons.length === 0, reasons };
}

// ───────────── Oy taahhüdü (commit–reveal) ─────────────

export function voteCommitment(proposalId: string, round: number, ballotId: string, choice: VoteChoice, salt: string): string {
  return sha256Hex(canonicalJson({ proposalId, round, ballotId, choice, salt }));
}

/** Mesaj içerik özeti: SHA256(tuz ‖ metin). Tuz silinirse metin özetten geri kazanılamaz. */
export function contentHash(salt: string, text: string): string {
  return sha256Hex(salt + "\u0000" + text);
}
