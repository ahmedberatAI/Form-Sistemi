import { describe, it, expect } from "vitest";
import { ed25519PublicKey, ed25519RandomSecretKey, ed25519Sign, hashCanonical, hexToBytes, type LedgerTxType } from "@forum/shared";
import { AppError } from "../../src/core/errors";
import { makeCtx } from "../helpers/fakes";
import { createInProcessLedger, createLedgerService, type InProcessLedger } from "../../src/ledger";
import { checkTx, findPiiKey } from "../../src/ledger/tx";
import type { SignedTx } from "../../src/ledger/types";
import { FAST, IDS, chainOf, startLedger } from "./util";

function signedTx(type: string, payload: Record<string, unknown>, sk: string): SignedTx {
  const nonce = hashCanonical({ type, payload }).slice(0, 32);
  const hash = hashCanonical({ type, payload, nonce });
  return { type: type as LedgerTxType, payload, nonce, submittedAt: 0, sig: ed25519Sign(hexToBytes(hash), sk), hash };
}

const catchErr = (fn: () => unknown): AppError => {
  try {
    fn();
  } catch (e) {
    return e as AppError;
  }
  throw new Error("hata bekleniyordu");
};

describe("defter / kurallar", () => {
  it("kişisel veri anahtarı içeren yük reddedilir (iç içe ve dizilerde de)", async () => {
    const l = await startLedger();
    try {
      const bad: Record<string, unknown>[] = [
        { email: "a@b.c" },
        { proposalId: "p", nested: { deep: [{ firstName: "Ali" }] } },
        { TCKN: "10000000146" },
        { body: "ham metin" },
        { x: [{ y: { nickname: "z" } }] },
        { a: { phone: null } },
        { list: [[{ password: "x" }]] },
        { lastName: "Y", birthDate: "2000-01-01", address: "Z", text: "t" },
      ];
      for (const payload of bad) {
        const e = catchErr(() => l.submit("MESSAGE_POSTED", payload));
        expect(e).toBeInstanceOf(AppError);
        expect(e.status).toBe(422);
        expect(e.code).toBe("ledger_pii");
        expect(e.message).toMatch(/kişisel veri/);
      }
      expect(findPiiKey({ a: [{ b: { Email: 1 } }] })).toBe("a[0].b.Email");
      // Özet alanları serbest
      const ok = await l.submitAndWait("MESSAGE_POSTED", { topicId: "t", bodyHash: "x", textHash: "y", contentHash: "z", undefinedField: undefined });
      expect(ok.payload).toEqual({ topicId: "t", bodyHash: "x", textHash: "y", contentHash: "z" });
      expect(l.status().mempool).toBe(0);

      expect(catchErr(() => l.submit("YOK" as LedgerTxType, {}))).toMatchObject({ status: 422, code: "ledger_bad_type" });
      expect(catchErr(() => l.submit("TALLY", { x: Number.NaN }))).toMatchObject({ status: 422, code: "ledger_bad_payload" });
      expect(catchErr(() => l.submit("TALLY", [] as unknown as Record<string, unknown>))).toMatchObject({ code: "ledger_bad_payload" });
      expect(catchErr(() => l.submit("EVIDENCE", { validator: "v1", height: 1, round: 0, voteA: {}, voteB: {} }))).toMatchObject({ code: "ledger_bad_evidence" });
    } finally {
      await l.stop();
    }
  });

  it("doğrulayıcılar da (derinlemesine savunma) kişisel veri, geçersiz tür ve sahte imzalı işlemi reddeder", async () => {
    const l = await startLedger();
    try {
      const appSk = (l as unknown as { appSecretKey: string }).appSecretKey;
      const v0 = l.validator("v0");
      const ctx = { appPublicKey: l.appPublicKey, validators: new Map(l.validatorKeys().validators.map((v) => [v.id, v.publicKey])) };

      const pii = signedTx("TALLY", { proposalId: "p9", sonuc: { email: "x@y.z" } }, appSk);
      expect(checkTx(structuredClone(pii), ctx)).toMatch(/Kişisel veri/);
      expect(v0.receiveClientTx(pii)).toBe("invalid");

      expect(v0.receiveClientTx(signedTx("UYDURMA", { a: 1 }, appSk))).toBe("invalid");
      expect(v0.receiveClientTx(signedTx("TALLY", { a: 1 }, ed25519RandomSecretKey()))).toBe("invalid"); // uygulama anahtarı değil
      const forged = { ...signedTx("TALLY", { a: 1 }, appSk), payload: { a: 2 } }; // imzadan sonra değiştirilmiş
      expect(v0.receiveClientTx(forged)).toBe("invalid");
      expect(v0.mempool.size).toBe(0);

      const clean = signedTx("TALLY", { proposalId: "p9", yes: 3 }, appSk);
      expect(v0.receiveClientTx(clean)).toBe("added");
      await l.flush();
      expect(l.getTx(clean.hash)).not.toBeNull();
      expect(l.latestBlock().height).toBe(1);
    } finally {
      await l.stop();
    }
  });

  it("stop() sonrası açık zamanlayıcı kalmaz; durdurulmuş defter işlem kabul etmez ama okunabilir", async () => {
    const timers = () => process.getActiveResourcesInfo().filter((r) => r === "Timeout" || r === "Immediate").length;
    const base = timers();
    const l = createLedgerService(makeCtx(), FAST);
    await l.start();
    for (let i = 0; i < 20; i++) l.submit("AI_ANALYSIS", { analysisId: `a${i}`, outputHash: `h${i}` });
    l.setFault("v2", "crash");
    l.setFault("v1", "byzantine");
    const pending = l.submitAndWait("AI_ANALYSIS", { analysisId: "son" }, 60_000);
    expect(timers()).toBeGreaterThan(base);
    await pending;
    await l.stop();
    expect(timers()).toBeLessThanOrEqual(base);
    await l.stop(); // iki kez durdurmak güvenli
    expect(catchErr(() => l.submit("AI_ANALYSIS", { analysisId: "x" }))).toMatchObject({ status: 503, code: "ledger_stopped" });
    // Durdurulmuş defterde flush asılı kalmaz: ya hemen biter ya da ledger_stopped ile reddedilir.
    await l.flush().catch((e: AppError) => expect(e.code).toBe("ledger_stopped"));
    expect(timers()).toBeLessThanOrEqual(base);
    expect(l.latestBlock().height).toBeGreaterThan(0);
    expect(l.verifyChain().filter((v) => v.nodeId !== "v2").every((v) => v.ok)).toBe(true);
  });

  it("gecikmeli, sırası bozuk ve kayıplı ağda güvenlik ve canlılık korunur", async () => {
    const l: InProcessLedger = await startLedger({ timeoutMs: 150, network: { delayMs: 1, jitterMs: 6, dropRate: 0.1, seed: "kayıplı-ağ" } });
    try {
      const hashes = Array.from({ length: 25 }, (_, i) => l.submit("VOTE_COMMIT", { proposalId: "pn", ballotId: `b${i}` }).txHash);
      await l.flush(40_000);
      for (const h of hashes) expect(l.getTx(h)).not.toBeNull();
      const ref = chainOf(l, "v0");
      for (const id of IDS) expect(chainOf(l, id)).toEqual(ref);
      expect(l.verifyChain().every((v) => v.ok)).toBe(true);
      expect(l.transport.stats.dropped).toBeGreaterThan(0);
    } finally {
      await l.stop();
    }
  });

  it("blok başına işlem sınırı uygulanır; saat geri gitse de zincir ilerler", async () => {
    const ctx = makeCtx();
    const l = await startLedger({ maxTxsPerBlock: 4 }, ctx);
    try {
      const hashes = Array.from({ length: 13 }, (_, i) => l.submit("SPONSORED", { proposalId: "pm", n: i }).txHash);
      await l.flush();
      const blocks = l.listBlocks({ limit: 50 });
      expect(blocks.every((b) => b.txCount <= 4)).toBe(true);
      expect(blocks.reduce((s, b) => s + b.txCount, 0)).toBe(13);
      for (const h of hashes) expect(l.getTx(h)).not.toBeNull();

      ctx.clock.advance(3_600_000); // simüle saat ileri: blok zamanı saatten gelir
      const a = await l.submitAndWait("SPONSORED", { proposalId: "pm", n: "ileri" });
      expect(a.blockTime).toBe(ctx.clock.now());
      ctx.clock.set(ctx.clock.now() - 2 * 3_600_000); // saat geri gitti (ör. ofset kaybı)
      const b = await l.submitAndWait("SPONSORED", { proposalId: "pm", n: "geri" });
      expect(b.blockTime).toBe(a.blockTime + 1); // zaman tekdüze artar
    } finally {
      await l.stop();
    }
  });

  it("tek doğrulayıcı ve yedi doğrulayıcı ile de çalışır", async () => {
    for (const n of [1, 7]) {
      const l = createInProcessLedger(makeCtx(), { ...FAST, validatorCount: n });
      await l.start();
      try {
        const c = await l.submitAndWait("GRAPH_RUN", { run: n });
        await l.flush();
        expect(l.status()).toMatchObject({ quorum: Math.floor((2 * n) / 3) + 1, faultTolerance: Math.floor((n - 1) / 3) });
        expect(l.getBlock(c.height)!.commitSigs.length).toBeGreaterThanOrEqual(Math.floor((2 * n) / 3) + 1);
        expect(l.verifyChain()).toHaveLength(n);
        expect(l.verifyChain().every((v) => v.ok)).toBe(true);
      } finally {
        await l.stop();
      }
    }
    expect(() => createInProcessLedger(makeCtx(), { validatorCount: 0 })).toThrow(/Doğrulayıcı sayısı/);
    expect(ed25519PublicKey(ed25519RandomSecretKey())).toMatch(/^[0-9a-f]{64}$/);
  });
});
