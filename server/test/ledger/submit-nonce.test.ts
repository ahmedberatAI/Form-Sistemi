// Regresyon (#272): ledger.submit isteğe bağlı `nonce` alır; özet (type, payload, nonce) üzerinden deterministiktir ve
// ForumCore'un işlem içinde önceden hesapladığı özetle (prepareTx) birebir aynıdır. Kurala uymayan nonce reddedilir.
import { afterEach, describe, expect, it } from "vitest";
import type { InProcessLedger } from "../../src/ledger";
import { prepareTx } from "../../src/ledger/tx";
import { startLedger } from "./util";

let ledger: InProcessLedger | null = null;
afterEach(async () => {
  await ledger?.stop();
  ledger = null;
});

const payload = { messageId: "m-1", proposalId: "p-1", ground: "g" };

describe("ledger.submit: isteğe bağlı nonce", () => {
  it("prepareTx özeti ile submit özeti aynıdır; nonce verilse de verilmese de", async () => {
    ledger = await startLedger();
    const prepared = prepareTx("MESSAGE_HIDDEN", payload);
    const a = ledger.submit("MESSAGE_HIDDEN", payload).txHash;
    const b = ledger.submit("MESSAGE_HIDDEN", prepared.payload, prepared.nonce).txHash; // aynı işlem → tekilleştirilir
    expect(a).toBe(prepared.hash);
    expect(b).toBe(prepared.hash);
    await ledger.flush(20_000);
    expect(ledger.getTx(prepared.hash)?.nonce).toBe(prepared.nonce);
    expect(ledger.findTxs({ type: "MESSAGE_HIDDEN" })).toHaveLength(1);
  });

  it("kurala uymayan nonce 422 ledger_bad_nonce ile reddedilir ve havuza girmez", async () => {
    ledger = await startLedger();
    expect(() => ledger!.submit("MESSAGE_HIDDEN", payload, "keyfi-nonce")).toThrowError(expect.objectContaining({ status: 422, code: "ledger_bad_nonce" }));
    await ledger.flush(20_000);
    expect(ledger.findTxs({ type: "MESSAGE_HIDDEN" })).toHaveLength(0);
  });

  it("yükteki _nonce kuralı: hazırlanan nonce ona eşittir ve submit kabul eder", async () => {
    ledger = await startLedger();
    const p = { ...payload, _nonce: "n-42" };
    const prepared = prepareTx("MESSAGE_HIDDEN", p);
    expect(prepared.nonce).toBe("n-42");
    expect(ledger.submit("MESSAGE_HIDDEN", p, prepared.nonce).txHash).toBe(prepared.hash);
  });
});
