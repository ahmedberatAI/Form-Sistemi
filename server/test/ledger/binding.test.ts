import { describe, it, expect } from "vitest";
import { ledgerTxHash, sha256Hex, txMatchesHash, verifyInclusionProof } from "@forum/shared";
import { startLedger } from "./util";

// Sunucuya güvenmeden doğrulama: istemci, sunucunun verdiği içeriğin istediği işlem özetine ait olduğunu
// ve kanıtın o işleme ait olduğunu denetler (denetim bulgusu #2).
describe("defter / içerik–özet bağı", () => {
  it("istemci formülü sunucu işlem özetiyle aynıdır; değiştirilmiş içerik ve başka işlemin kanıtı reddedilir", async () => {
    const l = await startLedger();
    try {
      const a = await l.submitAndWait("VOTE_COMMIT", { proposalId: "p1", round: 1, ballotId: "b1", commitment: sha256Hex("c1") });
      const b = await l.submitAndWait("VOTE_COMMIT", { proposalId: "p1", round: 1, ballotId: "b2", commitment: sha256Hex("c2") });
      const txA = l.getTx(a.hash)!;

      // 1) Aynı formül
      expect(ledgerTxHash(txA)).toBe(a.hash);
      expect(txMatchesHash(txA, a.hash)).toBe(true);

      // 2) Sunucu içeriği değiştirirse (ör. taahhüdü başka bir oyunkiyle değiştirirse) özet tutmaz
      const forged = { ...txA, payload: { ...txA.payload, commitment: sha256Hex("sahte") } };
      expect(txMatchesHash(forged, a.hash)).toBe(false);
      // Başka işlemin içeriği bu özetin yerine verilirse de tutmaz
      expect(txMatchesHash(l.getTx(b.hash)!, a.hash)).toBe(false);

      // 3) Geçerli ama BAŞKA bir işleme ait kanıt, beklenen özetle reddedilir
      const proofB = l.proof(b.hash)!;
      expect(verifyInclusionProof(proofB).ok).toBe(true);
      const wrong = verifyInclusionProof(proofB, undefined, a.hash);
      expect(wrong.ok).toBe(false);
      expect(wrong.reasons.join(" ")).toContain("istenen işleme ait değil");
      expect(verifyInclusionProof(l.proof(a.hash)!, undefined, a.hash).ok).toBe(true);
    } finally {
      await l.stop();
    }
  });
});

describe("defter / boş doğrulayıcı kümesi", () => {
  it("doğrulayıcı listesi boşsa imzasız kanıt kabul edilmez (fail-closed)", async () => {
    const l = await startLedger();
    try {
      const a = await l.submitAndWait("VOTE_COMMIT", { proposalId: "p2", round: 1, ballotId: "b9", commitment: sha256Hex("c9") });
      const proof = l.proof(a.hash)!;
      const forged = { ...proof, validators: [], header: { ...proof.header, commitSigs: [] } };
      expect(verifyInclusionProof(forged).ok).toBe(false);
      expect(verifyInclusionProof(proof, []).ok).toBe(false);
      expect(verifyInclusionProof(proof, [], a.hash).reasons.join(" ")).toContain("Doğrulayıcı anahtarı yok");
    } finally {
      await l.stop();
    }
  });
});
