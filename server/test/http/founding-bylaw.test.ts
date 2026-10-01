// Kurucu yönetmelik (sürüm 1) deftere sabitlenir (denetim bulgusu 23): createApp ilk açılışta BYLAW_VERSION
// {version: 1, hash, proposalId: null} gönderir ve bylaw_versions.ledger_tx'e bağlar; yeniden açılışta tekrar göndermez.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import type { BylawVersionInfo } from "@forum/shared";
import { createApp } from "../../src/app";
import { testConfig } from "../../src/core/config";
import { anchorFoundingBylaw } from "../../src/ontology";
import { boot } from "./harness";

const TIMEOUT = 60_000;

describe("kurucu yönetmeliğin deftere sabitlenmesi", () => {
  it("ilk açılışta sürüm 1 için BYLAW_VERSION yazılır ve sürüme bağlanır", async () => {
    const h = await boot();
    try {
      const versions = await h.ok<BylawVersionInfo[]>("GET", "/api/ontology/versions");
      const v1 = versions.find((v) => v.version === 1)!;
      expect(v1.ledgerTx).toMatch(/^[0-9a-f]{64}$/);
      await h.services.ledger.flush();
      const tx = h.services.ledger.getTx(v1.ledgerTx!)!;
      expect(tx.type).toBe("BYLAW_VERSION");
      expect(tx.payload).toEqual({ version: 1, hash: v1.hash, proposalId: null });
      expect(h.services.ledger.findTxs({ type: "BYLAW_VERSION" }).map((t) => t.payload.version)).toEqual([1]);
    } finally {
      await h.close();
    }
  }, TIMEOUT);

  it("idempotent: kayıt varsa yeniden gönderilmez; kalıcı veritabanında yeniden açılışta aynı kayıt kalır", async () => {
    const dir = mkdtempSync(join(tmpdir(), "forum-bylaw-"));
    const cfg = testConfig({ dataDir: dir, dbPath: join(dir, "forum.db"), ledgerBlockIntervalMs: 5 });
    try {
      const first = await createApp(cfg, { startTimers: false, aiClient: null, rateLimit: false });
      const tx1 = first.services.ontology.versions()[0].ledgerTx;
      expect(tx1).toBeTruthy();
      let submits = 0;
      expect(anchorFoundingBylaw(first.services.ontology, { submit: () => (submits++, { txHash: "x".repeat(64) }) })).toBeNull();
      expect(submits).toBe(0);
      await first.services.ledger.flush();
      await first.close();
      const second = await createApp(cfg, { startTimers: false, aiClient: null, rateLimit: false });
      try {
        expect(second.services.ontology.versions()[0].ledgerTx).toBe(tx1);
        await second.services.ledger.flush();
        expect(second.services.ledger.findTxs({ type: "BYLAW_VERSION" })).toHaveLength(1);
      } finally {
        await second.close();
      }
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, TIMEOUT);
});
