// ExpertPanelInfo.draws: kuranın/yedek kuranın yanıtı, henüz bloğa girmemiş KENDİ EXPERT_DRAW kaydını da içerir.
// Sahte defter (FakeLedger) eşzamanlı işlediği için bu sorunu gizler; burada gerçek süreç içi defter kullanılır.
import { afterEach, describe, expect, it } from "vitest";
import { createAuditLogger } from "../../src/core/audit";
import type { AiService, GraphService } from "../../src/core/contracts";
import { MemoryNotifier } from "../../src/core/notifier";
import { createExpertService } from "../../src/experts";
import { createInProcessLedger } from "../../src/ledger";
import { insertUser, makeCtx } from "../helpers/fakes";
import { CAT, FakeAi, FakeGraph, fakeMath, fakeOntology } from "./fixtures";

const stops: (() => Promise<void>)[] = [];
afterEach(async () => {
  while (stops.length) await stops.pop()!();
});

async function realWorld() {
  const ctx = makeCtx();
  const ledger = createInProcessLedger(ctx, { persist: false, blockIntervalMs: 20 });
  await ledger.start();
  stops.push(() => ledger.stop());
  const svc = createExpertService(ctx, {
    ledger,
    graph: new FakeGraph() as unknown as GraphService,
    math: fakeMath,
    ai: new FakeAi() as unknown as AiService,
    notifier: new MemoryNotifier(),
    audit: createAuditLogger(ctx),
    ontology: fakeOntology,
    householdOf: () => null,
  });
  const admin = insertUser(ctx.db, { id: "admin-0", nickname: "Yönetici", roles: ["member", "admin"] });
  for (const id of ["author", "e-1", "e-2", "e-3", "e-4"]) insertUser(ctx.db, { id, nickname: id });
  for (const id of ["e-1", "e-2", "e-3", "e-4"]) {
    svc.apply(id, [CAT.toplu], "Alanında deneyimli uzman");
    svc.decideApplication(admin, id, "approve");
  }
  const now = ctx.clock.now();
  ctx.db.run(
    "INSERT INTO proposals(id, seq, kind, title, body, author_id, categories, created_at, updated_at) VALUES ('p-1', 1, 'topic', 'Öneri', 'Metin', 'author', ?, ?, ?)",
    JSON.stringify([CAT.toplu]),
    now,
    now,
  );
  return { ctx, ledger, svc };
}

describe("panel: bekleyen (henüz bloğa girmemiş) EXPERT_DRAW kayıtları", () => {
  it("drawPanel ve yedek kura yanıtı kendi kaydını içerir; blok işlenince kayıtlar tekrarlanmaz", async () => {
    const { ctx, ledger, svc } = await realWorld();
    const panel = await svc.drawPanel("p-1", { categories: [CAT.toplu], authorId: "author", k: 2, dueAt: ctx.clock.now() + 7 * 86_400_000 });
    expect(ledger.findTxs({ type: "EXPERT_DRAW", proposalId: "p-1" })).toHaveLength(0); // henüz bloğa girmedi
    expect(panel.ledgerTx).toBeTruthy();
    expect(panel.draws).toEqual([{ round: 1, kind: "panel", reason: null, substitute: null, selected: 2, txHash: panel.ledgerTx, at: expect.any(Number) }]);

    const [a1] = panel.assignments;
    const after = await svc.respond(a1.id, a1.expertId, "recuse", "Çıkar çatışması");
    expect(after.draws).toHaveLength(2);
    expect(after.draws?.[0].txHash).toBe(panel.ledgerTx);
    expect(after.draws?.[1]).toMatchObject({ round: 1, kind: "substitute", reason: "recused", substitute: 1 });

    await ledger.flush();
    const committed = ledger.findTxs({ type: "EXPERT_DRAW", proposalId: "p-1" });
    expect(committed).toHaveLength(2);
    const settled = svc.panel("p-1")!;
    // Defter kaydı öncelikli: aynı iki hash, aynı sırada, çift kayıt yok.
    expect(settled.draws?.map((d) => d.txHash)).toEqual(after.draws?.map((d) => d.txHash));
    expect(settled.draws).toHaveLength(2);
    expect(settled.draws?.[0].at).toBe(Number(committed.find((t) => t.hash === panel.ledgerTx)!.blockTime));
  });

  it("başka önerinin bekleyen kaydı karışmaz", async () => {
    const { ctx, svc } = await realWorld();
    const now = ctx.clock.now();
    ctx.db.run(
      "INSERT INTO proposals(id, seq, kind, title, body, author_id, categories, created_at, updated_at) VALUES ('p-2', 2, 'topic', 'Öneri 2', 'Metin', 'author', ?, ?, ?)",
      JSON.stringify([CAT.toplu]),
      now,
      now,
    );
    const p1 = await svc.drawPanel("p-1", { categories: [CAT.toplu], authorId: "author", k: 2, dueAt: now + 86_400_000 });
    const p2 = await svc.drawPanel("p-2", { categories: [CAT.toplu], authorId: "author", k: 2, dueAt: now + 86_400_000 });
    expect(p1.draws?.map((d) => d.txHash)).toEqual([p1.ledgerTx]);
    expect(p2.draws?.map((d) => d.txHash)).toEqual([p2.ledgerTx]);
  });
});
