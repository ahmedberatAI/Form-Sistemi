import { describe, it, expect } from "vitest";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { verifyInclusionProof } from "@forum/shared";
import { makeCtx } from "../helpers/fakes";
import { createInProcessLedger } from "../../src/ledger";
import { FAST, IDS, chainOf, sleep, waitFor } from "./util";

describe("defter / kalıcılık", () => {
  it("yeniden başlatmada zincir ve anahtarlar korunur, yeni işlemler kaldığı yerden eklenir", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "defter-"));
    try {
      const l1 = createInProcessLedger(makeCtx({ dataDir: dir }), FAST);
      expect(l1.persist).toBe(true);
      await l1.start();
      const a = await l1.submitAndWait("BYLAW_VERSION", { version: 1, ttlHash: "a".repeat(64) });
      for (let i = 0; i < 5; i++) l1.submit("DELEGATION", { delegationId: `d${i}`, scope: "*" });
      await l1.flush();
      const top = l1.latestBlock();
      const keys = l1.validatorKeys();
      const appKey = l1.appPublicKey;
      // Durdurulmadan hemen önce gönderilen işlem kalıcı havuzla korunur.
      const late = l1.submit("DELEGATION", { delegationId: "son-an", scope: "*" });
      await l1.stop();

      for (const n of ["app", ...IDS]) {
        const st = fs.statSync(path.join(dir, "keys", "ledger", `${n}.key`));
        expect(st.mode & 0o777).toBe(0o600);
      }
      for (const id of IDS) expect(fs.existsSync(path.join(dir, "ledger", `${id}.db`))).toBe(true);

      const l2 = createInProcessLedger(makeCtx({ dataDir: dir }), FAST);
      try {
        expect(l2.latestBlock().height).toBeGreaterThanOrEqual(top.height);
        expect(l2.getBlock(top.height)!.hash).toBe(top.hash);
        expect(l2.validatorKeys()).toEqual(keys);
        expect(l2.appPublicKey).toBe(appKey);
        await l2.start();
        expect(l2.getTx(a.hash)!.payload).toEqual({ version: 1, ttlHash: "a".repeat(64) });
        await waitFor(() => l2.getTx(late.txHash) !== null, "kalıcı havuzdaki işlem");

        const b = await l2.submitAndWait("BYLAW_VERSION", { version: 2, ttlHash: "b".repeat(64) });
        expect(b.height).toBeGreaterThan(top.height);
        await l2.flush();
        const ref = chainOf(l2, "v0");
        expect(ref[top.height - 1]).toBe(top.hash);
        for (const id of IDS) expect(chainOf(l2, id)).toEqual(ref);
        expect(l2.verifyChain().every((v) => v.ok)).toBe(true);
        expect(verifyInclusionProof(l2.proof(a.hash)!, keys.validators).ok).toBe(true);
        expect(verifyInclusionProof(l2.proof(b.hash)!, keys.validators).ok).toBe(true);
      } finally {
        await l2.stop();
      }
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("konsensüs ortasında durdurup başlatınca çatallanma olmaz, havuz işlenir", async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), "defter-"));
    try {
      const hashes: string[] = [];
      for (let round = 0; round < 3; round++) {
        const l = createInProcessLedger(makeCtx({ dataDir: dir }), FAST);
        await l.start();
        try {
          for (let i = 0; i < 15; i++) hashes.push(l.submit("MESSAGE_POSTED", { topicId: `t${round}`, contentHash: `${round}-${i}` }).txHash);
          await sleep(3 + round * 4);
        } finally {
          await l.stop();
        }
      }
      const l = createInProcessLedger(makeCtx({ dataDir: dir }), FAST);
      await l.start();
      try {
        await l.flush(20_000);
        for (const h of hashes) expect(l.getTx(h)).not.toBeNull();
        const ref = chainOf(l, "v0");
        for (const id of IDS) expect(chainOf(l, id)).toEqual(ref);
        expect(l.verifyChain().every((v) => v.ok)).toBe(true);
      } finally {
        await l.stop();
      }
    } finally {
      fs.rmSync(dir, { recursive: true, force: true });
    }
  });

  it("bellek kipinde (dataDir :memory:) dosya yazılmaz, anahtarlar her açılışta farklıdır", async () => {
    const a = createInProcessLedger(makeCtx(), FAST);
    const b = createInProcessLedger(makeCtx(), FAST);
    expect(a.persist).toBe(false);
    expect(a.validatorKeys()).not.toEqual(b.validatorKeys());
    await a.stop();
    await b.stop();
  });
});
