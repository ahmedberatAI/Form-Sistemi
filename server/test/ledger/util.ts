// Defter testleri için yardımcılar (gerçek zamanlayıcılar, küçük blok aralığı).
import { makeCtx, type TestCtx } from "../helpers/fakes";
import { createInProcessLedger, type InProcessLedger, type LedgerOptions } from "../../src/ledger";

export const FAST: LedgerOptions = { blockIntervalMs: 5, timeoutMs: 120 };

export async function startLedger(opts: LedgerOptions = {}, ctx: TestCtx = makeCtx()): Promise<InProcessLedger> {
  const l = createInProcessLedger(ctx, { ...FAST, ...opts });
  await l.start();
  return l;
}

export const sleep = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

export async function waitFor(cond: () => boolean, label: string, timeoutMs = 15_000): Promise<void> {
  const t0 = performance.now();
  while (!cond()) {
    if (performance.now() - t0 > timeoutMs) throw new Error(`Zaman aşımı: ${label}`);
    await sleep(5);
  }
}

/** Bir düğümün KENDİ kopyasındaki blok özetleri (1..yükseklik). */
export function chainOf(l: InProcessLedger, nodeId: string): string[] {
  const out: string[] = [];
  for (let h = 1; ; h++) {
    const b = l.getBlock(h, nodeId);
    if (!b) return out;
    out.push(b.hash);
  }
}

export const IDS = ["v0", "v1", "v2", "v3"];
