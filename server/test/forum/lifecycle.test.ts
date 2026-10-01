// LifecycleEngine: sıralı kuyruk (yeniden giriş yok), öneri başına hata yalıtımı, bilirkişi askı kuralı, zamanlayıcı,
// günlük bakım; vekâlet izi (resolveEffectiveVotes().delegateOf) ile sayımın birebir uyumu; ForumCore işlem-sonrası yan etkiler.
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import { createRng, type VoteChoice } from "@forum/shared";
import type { AuthUser, DelegationEdge } from "../../src/core/contracts";
import { ForumCore } from "../../src/forum";
import { createGovernanceMath } from "../../src/governance";
import { CAT, endPhase, LONG_BODY, makeForum, toDeliberation, toVoting, type ForumHarness } from "./harness";

describe("forum: yaşam döngüsü motoru", () => {
  let h: ForumHarness;
  let m: AuthUser[];
  let admin: AuthUser;
  let expert: AuthUser;

  beforeAll(async () => {
    h = await makeForum();
    m = h.users("uye", 12);
    admin = h.user("yonetici", { roles: ["admin"] });
    expert = h.user("bilirkisi");
    h.experts.apply(expert.id, [CAT.enerji], "Enerji sistemleri mühendisi.");
    h.experts.decideApplication(admin.id, expert.id, "approve");
  });
  afterEach(() => vi.restoreAllMocks());

  it("eşzamanlı tick/poke çağrıları sıraya girer; aynı geçiş iki kez olmaz", async () => {
    const ids = [];
    for (let i = 0; i < 3; i++) ids.push(await toDeliberation(h, m[i], m.slice(3), { title: `Eşzamanlılık önerisi ${i}`, body: LONG_BODY }));
    h.ctx.clock.advance(73 * 3_600_000);
    const results = await Promise.all([h.forum.lifecycle.tick(), h.forum.lifecycle.tick(), h.forum.lifecycle.poke(ids[0]), h.forum.lifecycle.tick()]);
    const all = results.flat();
    expect(all.filter((t) => t.to === "voting").map((t) => t.proposalId).sort()).toEqual([...ids].sort());
    for (const id of ids) {
      expect(h.ctx.db.get<{ c: number }>("SELECT COUNT(*) AS c FROM phase_events WHERE proposal_id = ? AND to_status = 'voting'", id)!.c).toBe(1);
    }
  });

  it("bir önerideki hata diğerlerini durdurmaz (öneri başına try/catch)", async () => {
    const a = await toDeliberation(h, m[3], m.slice(4), { title: "Bozulacak öneri", body: LONG_BODY });
    const b = await toDeliberation(h, m[4], m.slice(5), { title: "Sağlam öneri", body: LONG_BODY });
    await toVoting(h, a);
    h.ctx.db.run("UPDATE proposals SET params = 'null' WHERE id = ?", a);
    const err = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const eventsA = h.forum.proposals.get(a, null).events.length;
    const t = await endPhase(h, b);
    // b kapanışı işlendi (oy yok → bir kez uzatma); a hata verdi ama b'yi engellemedi
    expect(t.filter((x) => x.proposalId === b).map((x) => [x.from, x.to])).toEqual([["voting", "voting"]]);
    expect(t.some((x) => x.proposalId === a)).toBe(false);
    expect(h.forum.proposals.get(a, null).events).toHaveLength(eventsA);
    expect(h.forum.proposals.get(b, null).extensionUsed).toBe(true);
    expect(err).toHaveBeenCalled();
    h.ctx.db.run("UPDATE proposals SET status = 'withdrawn', phase_ends_at = NULL WHERE id = ?", a); // testin geri kalanını etkilemesin
  });

  it("bilirkişi askı kuralı: raporların ≥2/3'ü uygulanamaz → tartışma bir kez uzatılır; oylamada uyarı", async () => {
    const id = await toDeliberation(h, m[5], m.slice(6), { title: "Okula rüzgâr türbini", body: "Okul bahçesine küçük bir rüzgâr türbini kurulsun ve elektrik üretilsin.", categories: [CAT.enerji] });
    await h.tick();
    const panel = h.forum.proposals.get(id, null).expertPanel!;
    expect(panel.assignments).toHaveLength(1);
    const asg = panel.assignments[0];
    await h.experts.respond(asg.id, expert.id, "accept");
    await h.experts.submitReport(asg.id, expert.id, {
      assessment: "infeasible",
      confidence: 0.9,
      risks: ["Rüzgâr hızı yetersiz"],
      answers: [],
      body: "Bölgedeki ortalama rüzgâr hızı küçük türbinlerin verimli çalışması için yetersizdir; yatırım geri dönmez.",
    });
    expect(h.experts.suspensiveFlag(id)).toBe(true);
    const t1 = (await endPhase(h, id)).filter((x) => x.proposalId === id);
    expect(t1.map((x) => [x.from, x.to])).toEqual([["deliberation", "deliberation"]]);
    expect(t1[0].reason).toMatch(/askı kuralı/);
    const d = h.forum.proposals.get(id, null);
    expect(d.status).toBe("deliberation");
    const t2 = (await endPhase(h, id)).filter((x) => x.proposalId === id);
    expect(t2.map((x) => x.to)).toEqual(["voting"]);
    expect(t2[0].reason).toMatch(/Uyarı/);
  });

  it("zamanlayıcı: start() periyodik tick çalıştırır; stop() durdurur", async () => {
    const id = await toDeliberation(h, m[6], m.slice(7), { title: "Zamanlayıcı önerisi", body: LONG_BODY });
    h.ctx.clock.advance(73 * 3_600_000);
    h.forum.lifecycle.start(20);
    h.forum.lifecycle.start(20); // ikinci çağrı etkisiz
    await vi.waitFor(() => expect(h.forum.proposals.get(id, null).status).toBe("voting"), { timeout: 15_000, interval: 20 });
    h.forum.lifecycle.stop();
  });

  it("günlük bakım: kimlik bakım işleri simüle günde bir kez; bilirkişi gecikmeleri her tick", async () => {
    const id = h.identity as unknown as { refreshAdulthood: () => number; purgeStalePending: () => number };
    const adult = vi.spyOn(id, "refreshAdulthood");
    const purge = vi.spyOn(id, "purgeStalePending");
    const overdue = vi.spyOn(h.experts, "markOverdue");
    await h.tick();
    await h.tick();
    const n = adult.mock.calls.length;
    expect(n).toBeLessThanOrEqual(1);
    await h.advance(25);
    expect(adult.mock.calls.length).toBe(n + 1);
    expect(purge.mock.calls.length).toBe(adult.mock.calls.length);
    expect(overdue.mock.calls.length).toBeGreaterThanOrEqual(3);
  });
});

/**
 * Bağımsız kâhin (oracle): ALGORITMA §5 / §12.16 arama sırasının (kapsam sırası, rank ↑, oluşturma ↑, kimlik ↑; derinlik öncelikli,
 * en çok H adım, E dışındaki delege atlanır) doğrudan yazımı. Eskiden forum/tally.ts'de bulunan `traceDelegations` kopyasının
 * birebir aynısıdır; artık yalnız testte, üretim kodundaki tek aramanın (`delegateOf`) eşdeğerliğini kanıtlamak için durur.
 */
function oracleTrace(input: {
  eligible: string[];
  direct: Map<string, VoteChoice>;
  delegations: DelegationEdge[];
  scopeOrder: string[];
  maxHops: number;
  delegatedVotes: { userId: string; choice: VoteChoice }[];
}): Record<string, string> {
  const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
  const eligible = new Set(input.eligible);
  const scopes: string[] = [];
  for (const s of input.scopeOrder) if (s !== "*" && !scopes.includes(s)) scopes.push(s);
  scopes.push("*");
  const scopeIdx = new Map(scopes.map((s, i) => [s, i]));
  const out = new Map<string, DelegationEdge[]>();
  for (const e of input.delegations) {
    if (!scopeIdx.has(e.scope) || e.from === e.to) continue;
    const list = out.get(e.from) ?? [];
    list.push(e);
    out.set(e.from, list);
  }
  for (const list of out.values()) {
    list.sort((a, b) => scopeIdx.get(a.scope)! - scopeIdx.get(b.scope)! || a.rank - b.rank || a.createdAt - b.createdAt || cmp(a.id, b.id));
  }
  const maxHops = Math.max(0, Math.floor(input.maxHops));
  const hasDirect = (u: string) => eligible.has(u) && input.direct.has(u);
  const path = new Set<string>();
  const dfs = (x: string, hops: number): string | null => {
    for (const e of out.get(x) ?? []) {
      const d = e.to;
      if (path.has(d) || !eligible.has(d)) continue;
      if (hasDirect(d)) return d;
      if (hops + 1 < maxHops) {
        path.add(d);
        const r = dfs(d, hops + 1);
        path.delete(d);
        if (r) return r;
      }
    }
    return null;
  };
  const trace: Record<string, string> = {};
  for (const v of input.delegatedVotes) {
    if (maxHops < 1) break;
    path.clear();
    path.add(v.userId);
    const t = dfs(v.userId, 0);
    if (t && input.direct.get(t) === v.choice) trace[v.userId] = t;
  }
  return trace;
}

describe("forum: vekâlet izi yönetişim çözümüyle birebir", () => {
  it("rastgele graflarda delegateOf, resolveEffectiveVotes'un atadığı oyu taşıyan delegeyi verir (bağımsız kâhinle birebir)", () => {
    const math = createGovernanceMath();
    const scopes = ["c:alt", "c:ust", "*"];
    let delegatedSeen = 0;
    let cappedSeen = 0;
    for (let trial = 0; trial < 300; trial++) {
      const rng = createRng(`iz-${trial}`);
      const users = Array.from({ length: 12 }, (_, i) => `u${String(i).padStart(2, "0")}`);
      const eligible = users.filter(() => rng.next() < 0.9);
      const direct = new Map<string, VoteChoice>();
      for (const u of eligible) if (rng.next() < 0.35) direct.set(u, (["yes", "no", "abstain"] as const)[rng.int(3)]);
      const delegations: DelegationEdge[] = [];
      for (const u of users) {
        const n = rng.int(3);
        for (let k = 0; k < n; k++) {
          const to = users[rng.int(users.length)];
          if (to === u) continue;
          delegations.push({ id: `e${delegations.length}`, from: u, to, scope: scopes[rng.int(3)], rank: 1 + rng.int(3), createdAt: rng.int(5) });
        }
      }
      const maxHops = 1 + rng.int(3);
      // Denemelerin bir kısmında vekâlet sınırı devrede: sınırı aşan (unrouted) kişi izde yer almamalı.
      const cap = trial % 3 === 0 ? 1 + rng.int(2) : 100;
      const res = math.resolveEffectiveVotes({ eligible, direct, delegations, scopeOrder: scopes, cap, maxHops, clusterOf: () => null });
      const delegated = res.votes.filter((v) => v.via === "delegated").map((v) => ({ userId: v.voterKey, choice: v.choice }));
      delegatedSeen += delegated.length;
      cappedSeen += res.unrouted.length;

      // 1) İz tam olarak vekâletle sayılan oyları kapsar; sınırı aşanlar ve doğrudan oy verenler yoktur.
      expect(Object.keys(res.delegateOf).sort()).toEqual(delegated.map((d) => d.userId).sort());
      for (const u of res.unrouted) expect(res.delegateOf[u]).toBeUndefined();
      // 2) Her delegatörün izi, oyu doğrudan veren ve seçimi delegatörün etkin oyuyla AYNI olan uygun bir delegedir.
      for (const d of delegated) {
        const t = res.delegateOf[d.userId];
        expect(eligible.includes(t)).toBe(true);
        expect(direct.get(t)).toBe(d.choice);
      }
      // 3) Yük (loads) iz ile tutarlı: her delegenin taşıdığı başkasına ait oy sayısı.
      const fromTrace: Record<string, number> = {};
      for (const t of Object.values(res.delegateOf)) fromTrace[t] = (fromTrace[t] ?? 0) + 1;
      expect(fromTrace).toEqual(res.loads);
      // 4) Bağımsız kâhinle (eski traceDelegations) birebir aynı delege.
      expect(oracleTrace({ eligible, direct, delegations, scopeOrder: scopes, maxHops, delegatedVotes: delegated })).toEqual(res.delegateOf);
    }
    // Özellik testinin boş geçmediğini güvenceye al.
    expect(delegatedSeen).toBeGreaterThan(200);
    expect(cappedSeen).toBeGreaterThan(0);
  });
});

describe("forum: ForumCore işlem semantiği", () => {
  it("işlem geri alınırsa bildirim gönderilmez; başarıda işlem sonunda gönderilir", async () => {
    const h = await makeForum();
    const u = h.user("kisi");
    const core = new ForumCore({ ...(h as never as Record<string, unknown>), ctx: h.ctx, notifier: h.notifier } as never);
    expect(() =>
      core.tx(() => {
        core.notify([u.id], { kind: "x", title: "geri alınacak", body: "-" });
        throw new Error("boom");
      }),
    ).toThrow("boom");
    expect(h.forum.community.notifications(u.id).items).toHaveLength(0);
    core.tx(() => {
      core.tx(() => core.notify([u.id, u.id], { kind: "x", title: "iç işlem", body: "-" }));
      expect(h.forum.community.notifications(u.id).items).toHaveLength(0); // dış işlem bitmeden gönderilmez
    });
    expect(h.forum.community.notifications(u.id).items.map((n) => n.title)).toEqual(["iç işlem"]);
    // ballotId öneriye ve tura özel
    expect(core.ballotId(u.id, "p1", 1)).not.toBe(core.ballotId(u.id, "p1", 2));
    expect(core.ballotId(u.id, "p1", 1)).not.toBe(core.ballotId(u.id, "p2", 1));
    expect(core.ballotId(u.id, "p1", 1)).toMatch(/^[0-9a-f]{64}$/);
  });
});
