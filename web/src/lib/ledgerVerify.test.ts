// İşlem sayfası (/islem/<özet>) doğrulaması: her denetim sunucunun söylediği özete değil ADRESTEKİ özete bağlanır.
// Sunucu başka bir işlemin kendi içinde tutarlı içeriğini, kanıtını ya da imzasını döndürürse sayfa 'Tutuyor / Geçerli' göstermez.
import {
  blockHash,
  ed25519PublicKey,
  ed25519RandomSecretKey,
  ed25519Sign,
  hexToBytes,
  ledgerTxHash,
  merkleLeaf,
  merkleProof,
  merkleRoot,
  precommitSignBytes,
  type CommittedTxView,
  type InclusionProof,
  type LedgerTxType,
} from "@forum/shared";
import { describe, expect, it } from "vitest";
import { checkTxPage, normalizeTxHash } from "./ledgerVerify";

const validators = Array.from({ length: 4 }, (_, i) => {
  const secret = ed25519RandomSecretKey();
  return { id: `d${i + 1}`, secret, publicKey: ed25519PublicKey(secret) };
});
const appSecret = ed25519RandomSecretKey();
const appPublicKey = ed25519PublicKey(appSecret);
const pinned = { validators: validators.map(({ id, publicKey }) => ({ id, publicKey })), appPublicKey };

interface Draft {
  type: LedgerTxType;
  payload: Record<string, unknown>;
  nonce: string;
}
const A: Draft = { type: "SPONSORED", payload: { proposalId: "p-1", n: 1 }, nonce: "nonce-a" };
const B: Draft = { type: "TALLY", payload: { proposalId: "p-2", n: 2 }, nonce: "nonce-b" };
const hashes = [ledgerTxHash(A), ledgerTxHash(B)];

/** İki işlemli bir blok; her işlem için sunucunun döndüreceği (içerik, kanıt) çifti. */
function chain() {
  const head = { height: 9, round: 0, prevHash: "ab".repeat(32), time: 1_700_000_000_000, proposer: "d1", txRoot: merkleRoot(hashes), txCount: 2 };
  const hash = blockHash(head);
  const msg = precommitSignBytes(head.height, head.round, hash);
  const header = { ...head, hash, commitSigs: validators.slice(0, 3).map((v) => ({ validator: v.id, sig: ed25519Sign(msg, v.secret) })) };
  const view = (d: Draft, index: number): CommittedTxView => {
    const h = ledgerTxHash(d);
    return { ...d, submittedAt: 1_700_000_000_000, hash: h, sig: ed25519Sign(hexToBytes(h), appSecret), height: head.height, index, blockHash: hash, blockTime: head.time };
  };
  const proof = (index: number): InclusionProof => ({
    txHash: hashes[index],
    height: head.height,
    index,
    leafHash: merkleLeaf(hashes[index]),
    path: merkleProof(hashes, index),
    txRoot: head.txRoot,
    header,
    validators: pinned.validators,
  });
  return { txA: view(A, 0), txB: view(B, 1), proofA: proof(0), proofB: proof(1) };
}

const { txA, txB, proofA, proofB } = chain();
const [hashA, hashB] = hashes;

describe("checkTxPage: dürüst sunucu", () => {
  it("içerik adresteki özete ait, kanıt geçerli, uygulama imzası geçerli", () => {
    const c = checkTxPage(hashA, txA, proofA, pinned);
    expect(c).toMatchObject({ expected: hashA, recomputed: hashA, contentOk: true, sigOk: true });
    expect(c.proof).toEqual({ ok: true, reasons: [] });
  });

  it("adresteki özet büyük harfle yazılsa da (sunucu küçük harfe çevirir) doğrulama tutar", () => {
    const c = checkTxPage(`  ${hashA.toUpperCase()} `, txA, proofA, pinned);
    expect(c.expected).toBe(hashA);
    expect(c.contentOk).toBe(true);
    expect(c.proof?.ok).toBe(true);
    expect(c.sigOk).toBe(true);
    expect(normalizeTxHash(` ${hashA.toUpperCase()}\n`)).toBe(hashA);
  });
});

describe("checkTxPage: sunucu adresteki işlemden başka bir işlemi döndürürse", () => {
  it("başka işlemin kendi içinde tutarlı içeriği (özet ve imzasıyla): içerik-özet bağı tutmaz, imza adresteki özet için geçersiz", () => {
    // URL A'yı ister, sunucu B'nin tam (tutarlı) içeriğini verir.
    const c = checkTxPage(hashA, txB, proofA, pinned);
    expect(c.recomputed).toBe(hashB);
    expect(c.contentOk).toBe(false);
    expect(c.sigOk).toBe(false); // imza B'nin özeti üzerinde; adresteki A üzerinde değil
  });

  it("başka işlemin kanıtı: kanıt adresteki işleme ait değil (Merkle yolu ve imzalar kendi içinde geçerli olsa da)", () => {
    const c = checkTxPage(hashA, txA, proofB, pinned);
    expect(c.contentOk).toBe(true); // içerik doğru
    expect(c.proof?.ok).toBe(false);
    expect(c.proof?.reasons.join(" ")).toContain("istenen işleme ait değil");
  });

  it("içerik değiştirilmiş (özet ve imza A'nınki olarak bildiriliyor): yeniden hesaplanan özet tutmaz", () => {
    const tampered: CommittedTxView = { ...txA, payload: { ...txA.payload, n: 99 } };
    const c = checkTxPage(hashA, tampered, proofA, pinned);
    expect(c.recomputed).not.toBe(hashA);
    expect(c.contentOk).toBe(false);
    expect(c.sigOk).toBe(true); // imza adresteki özet üzerindeydi; asıl uyarı içerik-özet bağındadır
  });

  it("içerik doğru ama sunucunun 'hash' iddiası adrestekinden farklı: bağ tutmaz", () => {
    const c = checkTxPage(hashA, { ...txA, hash: hashB }, proofA, pinned);
    expect(c.recomputed).toBe(hashA);
    expect(c.contentOk).toBe(false);
  });

  it("tamamı başka işlem (içerik + kanıt): ne içerik ne kanıt adresteki özetle tutar", () => {
    const c = checkTxPage(hashA, txB, proofB, pinned);
    expect(c.contentOk).toBe(false);
    expect(c.proof?.ok).toBe(false);
    expect(c.sigOk).toBe(false);
  });
});

describe("checkTxPage: eksik veri ve sabitlenmiş anahtarlar", () => {
  it("kanıt ya da sabitlenmiş anahtarlar henüz yoksa kanıt sonucu null; uygulama anahtarı yoksa imza sonucu null", () => {
    expect(checkTxPage(hashA, txA, undefined, pinned).proof).toBeNull();
    expect(checkTxPage(hashA, txA, proofA, null).proof).toBeNull();
    expect(checkTxPage(hashA, txA, proofA, null).sigOk).toBeNull();
    expect(checkTxPage(hashA, txA, proofA, { validators: pinned.validators }).sigOk).toBeNull();
  });

  it("işlem henüz yüklenmediyse içerik tutmuyor sayılır (kanıt ayrıca denetlenir)", () => {
    const c = checkTxPage(hashA, undefined, proofA, pinned);
    expect(c.contentOk).toBe(false);
    expect(c.recomputed).toBe("");
    expect(c.sigOk).toBeNull();
    expect(c.proof?.ok).toBe(true);
  });

  it("sabitlenmiş anahtarlar farklıysa (ör. sunucu anahtar değiştirmiş) kanıt geçersiz", () => {
    const other = [{ id: "d1", publicKey: ed25519PublicKey(ed25519RandomSecretKey()) }, ...pinned.validators.slice(1)];
    const c = checkTxPage(hashA, txA, proofA, { ...pinned, validators: other });
    expect(c.proof?.ok).toBe(false);
  });

  it("geçersiz biçimli adres özeti çökmez, doğrulama başarısız sayılır", () => {
    const c = checkTxPage("zz-geçersiz", txA, proofA, pinned);
    expect(c.contentOk).toBe(false);
    expect(c.proof?.ok).toBe(false);
    expect(c.sigOk).toBe(false);
  });
});
