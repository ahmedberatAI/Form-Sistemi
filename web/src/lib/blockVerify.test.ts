// #196: blok imzaları yalnızca cihazda sabitlenmiş anahtarlarla doğrulanır; anahtar yokken (yükleniyor/alınamadı)
// sunucunun bildirdiği anahtarlara düşülmez ve imzalar "doğrulandı" sayılmaz (fail-closed).
import { blockHash, ed25519PublicKey, ed25519RandomSecretKey, ed25519Sign, merkleRoot, precommitSignBytes, type BlockView } from "@forum/shared";
import { describe, expect, it } from "vitest";
import { verifyBlock } from "./blockVerify";

function validatorSet(n: number) {
  return Array.from({ length: n }, (_, i) => {
    const secret = ed25519RandomSecretKey();
    return { id: `d${i + 1}`, secret, publicKey: ed25519PublicKey(secret) };
  });
}

function signedBlock(signers: { id: string; secret: string }[]): BlockView {
  const head = { height: 7, round: 0, prevHash: "ab".repeat(32), time: 1_700_000_000_000, proposer: signers[0].id, txRoot: merkleRoot([]), txCount: 0 };
  const hash = blockHash(head);
  const msg = precommitSignBytes(head.height, head.round, hash);
  return { ...head, hash, txs: [], commitSigs: signers.map((s) => ({ validator: s.id, sig: ed25519Sign(msg, s.secret) })) };
}

const pub = (v: { id: string; publicKey: string }[]) => v.map(({ id, publicKey }) => ({ id, publicKey }));

describe("blok doğrulaması: sabitlenmiş anahtarlar yoksa kapalı kalır", () => {
  it("sabitlenmiş anahtarlarla: yeterli imza → doğrulandı", () => {
    const set = validatorSet(4);
    const c = verifyBlock(signedBlock(set.slice(0, 3)), pub(set));
    expect(c).toMatchObject({ hashOk: true, rootOk: true, txOk: true, validSigs: 3, need: 3, sigsOk: true, allOk: true });
    expect(c.sigs.every((s) => s.ok === true)).toBe(true);
  });

  it("anahtarlar yokken (null): imzalar denetlenmez, 'Yeterli' ya da genel 'doğrulandı' üretilmez", () => {
    const set = validatorSet(4);
    const c = verifyBlock(signedBlock(set.slice(0, 3)), null);
    expect(c.sigsOk).toBeNull();
    expect(c.allOk).toBeNull();
    expect(c.need).toBeNull();
    expect(c.validSigs).toBe(0);
    expect(c.sigs.map((s) => s.ok)).toEqual([null, null, null]);
    expect(c.sigs.some((s) => s.known)).toBe(false);
  });

  it("kurcalanmış sunucu kendi anahtarlarıyla imzalarsa: sabitlenmiş (gerçek) anahtarlara karşı yetersiz; anahtarsız halde de onaylanmaz", () => {
    const real = validatorSet(4);
    const attacker = validatorSet(4).map((v, i) => ({ ...v, id: real[i].id })); // aynı kimlikler, farklı anahtarlar
    const forged = signedBlock(attacker.slice(0, 3));
    const pinned = verifyBlock(forged, pub(real));
    expect(pinned).toMatchObject({ validSigs: 0, sigsOk: false, allOk: false });
    expect(pinned.sigs.every((s) => s.ok === false && s.known)).toBe(true);
    // Eski (açık) davranış sunucunun anahtarlarıyla "Yeterli" derdi; artık anahtar yokken hiçbir imza onaylanmaz.
    expect(verifyBlock(forged, null)).toMatchObject({ sigsOk: null, allOk: null, validSigs: 0 });
  });

  it("başlık/özet tutmuyorsa anahtarlar olmasa da genel sonuç başarısızdır", () => {
    const set = validatorSet(4);
    const tampered = { ...signedBlock(set.slice(0, 3)), txRoot: "00".repeat(32) };
    const c = verifyBlock(tampered, null);
    expect(c.hashOk).toBe(false); // txRoot başlık özetine girer: yeniden hesaplanan özet başlıktakiyle uyuşmaz
    expect(c.allOk).toBe(false);
  });
});
