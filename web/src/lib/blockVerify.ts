// Blok doğrulaması (saf işlev): özet, Merkle kökü, işlem özetleri ve commit imzaları.
// İmzalar YALNIZCA cihazda sabitlenmiş anahtarlarla doğrulanır; anahtar yoksa (yükleniyor/alınamadı) doğrulama kapalı kalır
// (fail-closed): imza satırları ve genel sonuç "doğrulandı" sayılmaz. Sunucunun aynı yanıtta bildirdiği anahtarlara
// güvenmek döngüsel güven olurdu (kurcalanmış sunucu kendi anahtarlarıyla imzalayıp "Yeterli" gösterebilirdi).
import { blockHash, ed25519Verify, hashCanonical, merkleRoot, precommitSignBytes, type BlockView } from "@forum/shared";

export interface PinnedKey {
  id: string;
  publicKey: string;
}

export interface BlockSigCheck {
  validator: string;
  sig: string;
  /** null: sabitlenmiş anahtarlar yokken denetlenemedi */
  ok: boolean | null;
  known: boolean;
}

export interface BlockCheck {
  computed: string;
  hashOk: boolean;
  rootOk: boolean;
  txs: { index: number; type: string; hash: string; ok: boolean }[];
  txBad: number;
  txOk: boolean;
  sigs: BlockSigCheck[];
  validSigs: number;
  /** Gerekli en az imza sayısı (2f + 1); anahtarlar yokken bilinmez. */
  need: number | null;
  /** null: sabitlenmiş anahtarlar olmadığı için imzalar denetlenemedi (doğrulanmış sayılmaz). */
  sigsOk: boolean | null;
  /** false: bir denetim tutmadı; true: hepsi tuttu; null: kalanlar tuttu ama imzalar denetlenemedi. */
  allOk: boolean | null;
}

function safe<T>(fn: () => T, fallback: T): T {
  try {
    return fn();
  } catch {
    return fallback;
  }
}

export function verifyBlock(b: BlockView, pinned: PinnedKey[] | null): BlockCheck {
  const computed = safe(() => blockHash(b), "");
  const hashOk = computed === b.hash;
  const rootOk = safe(() => merkleRoot(b.txs.map((t) => t.hash)) === b.txRoot, false);
  const txs = b.txs.map((t, i) => ({
    index: t.index ?? i,
    type: t.type,
    hash: t.hash,
    ok: safe(() => hashCanonical({ type: t.type, payload: t.payload, nonce: t.nonce }) === t.hash, false),
  }));
  const txBad = txs.filter((t) => !t.ok).length;
  const msg = safe(() => precommitSignBytes(b.height, b.round, computed), new Uint8Array());
  const seen = new Set<string>();
  const sigs: BlockSigCheck[] = b.commitSigs.map((s) => {
    if (!pinned) return { ...s, ok: null, known: false };
    const v = pinned.find((x) => x.id === s.validator);
    const ok = v ? ed25519Verify(s.sig, msg, v.publicKey) : false;
    if (ok && v) seen.add(v.id);
    return { ...s, ok, known: !!v };
  });
  const need = pinned ? 2 * Math.floor((pinned.length - 1) / 3) + 1 : null;
  const sigsOk = pinned && need !== null ? seen.size >= need : null;
  const rest = hashOk && rootOk && txBad === 0;
  return { computed, hashOk, rootOk, txs, txBad, txOk: txBad === 0, sigs, validSigs: seen.size, need, sigsOk, allOk: !rest || sigsOk === false ? false : sigsOk === null ? null : true };
}
