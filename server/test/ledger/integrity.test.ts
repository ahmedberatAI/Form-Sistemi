import { describe, it, expect } from "vitest";
import { ed25519PublicKey, ed25519RandomSecretKey, merkleLeaf, sha256Hex, verifyInclusionProof } from "@forum/shared";
import { IDS, chainOf, startLedger, waitFor } from "./util";

describe("defter / bütünlük", () => {
  it("kurcalama: verifyChain hatayı bulur, kanonik okuma etkilenmez; repair temizler", async () => {
    const l = await startLedger();
    try {
      const c = await l.submitAndWait("TALLY", { proposalId: "p6", yes: 10, no: 3 });
      await l.submitAndWait("TALLY", { proposalId: "p6b", yes: 1, no: 0 });
      await l.flush();
      const original = l.getBlock(c.height, "v2")!;

      l.tamper("v2", c.height);
      const tampered = l.getBlock(c.height, "v2")!;
      expect(tampered.txs[0].payload).not.toEqual(original.txs[0].payload);
      expect(l.getBlock(c.height, "v0")!.txs[0].payload).toEqual(original.txs[0].payload); // yalnız v2'nin kopyası

      const [bad] = l.verifyChain("v2");
      expect(bad.ok).toBe(false);
      expect(bad.nodeId).toBe("v2");
      expect(bad.errors.length).toBeGreaterThan(0);
      expect(bad.errors.every((e) => e.height === c.height)).toBe(true);
      expect(bad.errors.map((e) => e.error).join(" | ")).toMatch(/özeti yeniden hesaplanınca tutmuyor/);
      expect(l.verifyChain().filter((v) => v.nodeId !== "v2").every((v) => v.ok)).toBe(true);
      expect(l.status().validators.find((v) => v.id === "v2")!.healthy).toBe(false);

      // Kanonik düğümü (v0) de bozsak okumalar sağlıklı başka düğümden yapılır.
      l.tamper("v0", c.height);
      expect(l.getTx(c.hash)!.payload).toEqual({ proposalId: "p6", yes: 10, no: 3 });
      expect(verifyInclusionProof(l.proof(c.hash)!).ok).toBe(true);
      expect(l.getBlock(c.height)!.txs[0].payload).toEqual(original.txs[0].payload);

      for (const id of ["v2", "v0"]) {
        const r = await l.repair(id);
        expect(r).toEqual({ nodeId: id, ok: true, checkedBlocks: l.latestBlock().height, errors: [] });
        // Her düğüm kendi ≥2f+1 precommit kümesini toplar; onarılan blok eşten gelir (imza kümesi farklı olabilir).
        const fixed = l.getBlock(c.height, id)!;
        expect(fixed.hash).toBe(original.hash);
        expect(fixed.txs).toEqual(original.txs);
        expect(fixed.commitSigs.length).toBeGreaterThanOrEqual(3);
      }
      expect(l.verifyChain().every((v) => v.ok)).toBe(true);
      expect(l.status().validators.every((v) => v.healthy)).toBe(true);

      // Onarılan düğüm konsensüse katılmaya devam eder.
      await l.submitAndWait("TALLY", { proposalId: "p6c", yes: 2, no: 2 });
      await l.flush();
      const ref = chainOf(l, "v1");
      for (const id of IDS) expect(chainOf(l, id)).toEqual(ref);
      expect(() => l.tamper("v1", 999)).toThrow(/bulunamadı/);
      expect(() => l.tamper("v9", 1)).toThrow(/Doğrulayıcı/);
    } finally {
      await l.stop();
    }
  });

  it("repair geride kalan (çökmüş) düğümün eksik bloklarını imzaları doğrulayarak ekler", async () => {
    const l = await startLedger();
    try {
      await l.submitAndWait("CLUSTER_SNAPSHOT", { snapshotId: "s0" });
      l.setFault("v3", "crash");
      for (let i = 1; i <= 3; i++) await l.submitAndWait("CLUSTER_SNAPSHOT", { snapshotId: `s${i}` });
      await l.flush();
      expect(l.validator("v3").height()).toBeLessThan(l.latestBlock().height);
      const r = await l.repair("v3");
      expect(r.ok).toBe(true);
      expect(r.checkedBlocks).toBe(l.latestBlock().height);
      expect(chainOf(l, "v3")).toEqual(chainOf(l, "v0"));
      l.setFault("v3", "none");
      await l.submitAndWait("CLUSTER_SNAPSHOT", { snapshotId: "s4" });
      await l.flush();
      await waitFor(() => l.validator("v3").height() === l.latestBlock().height, "v3");
      expect(chainOf(l, "v3")).toEqual(chainOf(l, "v0"));
    } finally {
      await l.stop();
    }
  });

  it("proof() çıktısı verifyInclusionProof ile doğrulanır; sahte tx ve yanlış anahtarlar reddedilir", async () => {
    const l = await startLedger();
    try {
      const hashes = Array.from({ length: 9 }, (_, i) => l.submit("VOTE_COMMIT", { proposalId: "p7", ballotId: `b${i}`, commitment: sha256Hex(`c${i}`) }).txHash);
      await l.flush();
      const keys = l.validatorKeys();
      expect(keys.chainId).toBe("forum-sistemi-1");
      const pinned = l.status().validators.map((v) => ({ id: v.id, publicKey: v.publicKey }));
      expect(keys.validators).toEqual(pinned);

      for (const h of hashes) {
        const p = l.proof(h)!;
        expect(p.txHash).toBe(h);
        expect(p.leafHash).toBe(merkleLeaf(h));
        expect(p.header.txRoot).toBe(p.txRoot);
        expect(p.validators).toEqual(pinned);
        expect(verifyInclusionProof(p)).toEqual({ ok: true, reasons: [] });
        expect(verifyInclusionProof(p, pinned).ok).toBe(true);
        expect(verifyInclusionProof(JSON.parse(JSON.stringify(p)), pinned).ok).toBe(true); // HTTP üzerinden gelmiş gibi
      }
      const multi = hashes.map((h) => l.proof(h)!).find((p) => p.path.length >= 2);
      expect(multi).toBeDefined(); // çok işlemli blok: önemsiz olmayan Merkle yolu
      const p = multi!;

      const fake = verifyInclusionProof({ ...p, txHash: sha256Hex("sahte") }, pinned);
      expect(fake.ok).toBe(false);
      expect(fake.reasons.join(" ")).toMatch(/Merkle/);

      const wrong = pinned.map((v) => ({ id: v.id, publicKey: ed25519PublicKey(ed25519RandomSecretKey()) }));
      const w = verifyInclusionProof(p, wrong);
      expect(w.ok).toBe(false);
      expect(w.reasons.join(" ")).toMatch(/imza/);

      expect(verifyInclusionProof({ ...p, header: { ...p.header, time: p.header.time + 1 } }, pinned).ok).toBe(false);
      expect(verifyInclusionProof({ ...p, header: { ...p.header, commitSigs: p.header.commitSigs.slice(0, 2) } }, pinned).ok).toBe(false);
      const dup = { ...p, header: { ...p.header, commitSigs: [p.header.commitSigs[0], p.header.commitSigs[0], p.header.commitSigs[0]] } };
      expect(verifyInclusionProof(dup, pinned).ok).toBe(false);

      expect(l.proof("00".repeat(32))).toBeNull();
    } finally {
      await l.stop();
    }
  });
});
