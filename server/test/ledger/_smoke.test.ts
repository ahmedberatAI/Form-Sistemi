import { it, expect } from "vitest";
import { makeCtx } from "../helpers/fakes";
import { createInProcessLedger } from "../../src/ledger";
it("smoke", async () => {
  const l = createInProcessLedger(makeCtx(), { blockIntervalMs: 5, timeoutMs: 100 });
  await l.start();
  const t0 = performance.now();
  const c = await l.submitAndWait("PHASE_CHANGED", { proposalId: "p1", phase: "x" });
  console.log("first commit ms", performance.now() - t0, c.height);
  for (let i = 0; i < 50; i++) l.submit("VOTE_COMMIT", { proposalId: "p1", i });
  await l.flush();
  console.log("flush ms", performance.now() - t0, l.status());
  console.log(l.verifyChain().map(v => [v.nodeId, v.ok, v.checkedBlocks]));
  console.log(l.listBlocks({}).map(b => [b.height, b.round, b.txCount, b.commitSigs.length]));
  await l.stop();
});
