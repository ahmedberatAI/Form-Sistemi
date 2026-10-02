// Regresyon (#289, #223): kimliksiz GET /api/ledger/verify her çağrıda tüm zinciri yeniden doğrulamaz.
import { describe, expect, it } from "vitest";
import { sha256Hex } from "@forum/shared";
import { startLedger } from "./util";

const NODES = 4;

describe("defter: verifyChain önbelleği", () => {
  it("ardışık iki çağrı yeniden doğrulama yapmaz; zincir büyürse yalnız yeni bloklar doğrulanır", async () => {
    const l = await startLedger();
    try {
      for (let i = 0; i < 6; i++) await l.submitAndWait("VOTE_COMMIT", { proposalId: "p1", ballotId: `b${i}`, commitment: sha256Hex(`c${i}`) });
      await l.flush();
      const first = l.verifyChain();
      expect(first.every((v) => v.ok)).toBe(true);
      const height = l.latestBlock().height;
      expect(first.every((v) => v.checkedBlocks === height)).toBe(true);
      const work = l.verifiedBlockCount();
      expect(work).toBe(height * NODES);

      const second = l.verifyChain();
      expect(second).toEqual(first);
      expect(l.verifiedBlockCount()).toBe(work); // O(1): hiç blok yeniden doğrulanmadı

      await l.submitAndWait("VOTE_COMMIT", { proposalId: "p1", ballotId: "yeni", commitment: sha256Hex("yeni") });
      await l.flush();
      const grown = l.latestBlock().height;
      expect(grown).toBeGreaterThan(height);
      const third = l.verifyChain();
      expect(third.every((v) => v.ok && v.checkedBlocks === grown)).toBe(true);
      expect(l.verifiedBlockCount() - work).toBe((grown - height) * NODES); // yalnız yeni bloklar
    } finally {
      await l.stop();
    }
  });

  it("kurcalama önbelleği geçersiz kılar (✘), onarım yeniden ✔ yapar ve sonuç yine önbelleğe alınır", async () => {
    const l = await startLedger();
    try {
      for (let i = 0; i < 4; i++) await l.submitAndWait("VOTE_COMMIT", { proposalId: "p2", ballotId: `b${i}`, commitment: sha256Hex(`d${i}`) });
      await l.flush();
      expect(l.verifyChain().every((v) => v.ok)).toBe(true); // ✔ önbellekte
      const target = l.latestBlock().height;
      l.tamper("v2", target);
      const bad = l.verifyChain().find((v) => v.nodeId === "v2")!;
      expect(bad.ok).toBe(false);
      expect(bad.errors.every((e) => e.height === target)).toBe(true);
      const afterTamper = l.verifiedBlockCount();
      expect(l.verifyChain().find((v) => v.nodeId === "v2")!.ok).toBe(false);
      expect(l.verifiedBlockCount()).toBe(afterTamper); // ✘ sonucu da önbellekte

      const fixed = await l.repair("v2");
      expect(fixed.ok).toBe(true);
      const afterRepair = l.verifiedBlockCount();
      expect(l.verifyChain().every((v) => v.ok)).toBe(true);
      expect(l.verifiedBlockCount()).toBe(afterRepair);

      // Çağıran sonucu değiştirse bile önbellek bozulmaz
      const r = l.verifyChain();
      r[0].errors.push({ height: 1, error: "sahte" });
      expect(l.verifyChain()[0].errors).toEqual([]);
    } finally {
      await l.stop();
    }
  });
});
