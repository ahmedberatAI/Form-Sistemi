// Duman testi: küçültülmüş tohum (tüm hesaplar + graf + iki öneri) bellek içinde, gerçek servislerle çalışır.
import { describe, expect, it } from "vitest";
import { createRng, fy, verifyTally } from "@forum/shared";
import { createApp } from "../../src/app";
import { DAY, HOUR, ManualClock } from "../../src/core/clock";
import { testConfig } from "../../src/core/config";
import { SEED, SeedEngine, setupAccounts, setupGraph } from "../../src/seed/index";
import { P1, P3, type ProposalSpec } from "../../src/seed/content";
import type { PhaseEvent, VoteSpec } from "../../src/seed/engine";
import { PEOPLE } from "../../src/seed/people";

describe("tohum verisi (küçültülmüş)", () => {
  it("hesapları, grafı ve iki öneriyi servisler üzerinden üretir; defter ve sayımlar doğrulanır", async () => {
    const start = Date.UTC(2026, 8, 1, 9, 0);
    const clock = new ManualClock(start);
    const app = await createApp(testConfig({ ledgerBlockIntervalMs: 5 }), { startTimers: false, aiClient: null, clock, rateLimit: false });
    try {
      const s = app.services;
      const e = new SeedEngine(s, clock, createRng(SEED), () => undefined);
      await setupAccounts(e);
      setupGraph(e);
      clock.advance(6 * HOUR); // uygun seçmen: öneriden ÖNCE doğrulanmış olmalı

      const plans: [ProposalSpec, VoteSpec][] = [
        [P1, { A: 0.97, B: 0.25, C: 0.9 }],
        [P3, { A: 0.9, B: 0.03, C: 0.05 }],
      ];
      for (const [spec, votes] of plans) {
        const d = await s.forum.proposals.create(e.auth(spec.author), {
          kind: spec.kind,
          title: spec.title,
          body: spec.body,
          categories: spec.categories.map((c) => fy(c)),
          submit: true,
        });
        e.register(spec.key, d.id, async (ev: PhaseEvent) => {
          if (ev.to === "deliberation" && spec.messages) await e.postThread(spec.key, "proposal", d.id, spec.messages);
          if (ev.to === "voting" && ev.from === "deliberation") await e.castVotes(spec.key, 1, votes);
        });
        await e.sponsor(spec.key, spec.author);
      }
      await e.runUntil(start + 9 * DAY);

      expect(e.problems).toEqual([]);
      expect(e.status("P1")).toBe("enacted");
      expect(e.status("P3")).toBe("rejected");
      expect(s.forum.topics.list().map((t) => t.title)).toEqual([P1.title]);

      const verified = PEOPLE.filter((p) => p.kind !== "pending" && p.kind !== "rejected").length;
      expect(s.ctx.db.get<{ n: number }>("SELECT COUNT(*) AS n FROM users WHERE status = 'verified'")?.n).toBe(verified);
      expect(s.experts.list({ status: "active" })).toHaveLength(7);
      expect(s.graph.delegations().length).toBeGreaterThanOrEqual(8);

      for (const key of ["P1", "P3"]) {
        const rounds = s.forum.proposals.bulletin(e.proposalId(key)).rounds;
        expect(rounds).toHaveLength(1);
        for (const r of rounds) expect(verifyTally(r.tally, r.reveals, r.commitments).ok).toBe(true);
      }
      expect(s.ledger.verifyChain().every((c) => c.ok)).toBe(true);
    } finally {
      await app.close();
    }
  }, 120_000);
});
