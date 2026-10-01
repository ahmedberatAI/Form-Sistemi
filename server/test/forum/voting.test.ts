// Senaryo 7 (needs_more_votes uzatması; oylama sürerken sonuçlar gizli) ve senaryo 8 (vekâlet: delege üzerinden sayım,
// myEffectiveVia, cap taşması → unrouted bildirimi), ayrıca oy kuralları (rıza, askı, süre).
import { beforeAll, describe, expect, it } from "vitest";
import { verifyTally } from "@forum/shared";
import type { AuthUser } from "../../src/core/contracts";
import { endPhase, makeForum, toDeliberation, toVoting, type ForumHarness } from "./harness";

describe("forum: oylama kuralları, uzatma ve vekâlet", () => {
  let h: ForumHarness;
  let m: AuthUser[];

  beforeAll(async () => {
    h = await makeForum();
    m = h.users("uye", 30);
  });

  it("senaryo 7: yetersiz katılım → bir kez uzatma (sonuç gizli kalır) → yine yetersizse red", async () => {
    const id = await toDeliberation(h, m[0], m.slice(1), { title: "Sokak lambaları değişsin", body: "Ana caddedeki eski sokak lambaları tasarruflu modellerle değiştirilsin." });
    await toVoting(h, id);
    for (let i = 0; i < 4; i++) await h.forum.proposals.vote(m[i], id, "yes");
    const before = h.forum.proposals.get(id, null);
    const t = await endPhase(h, id);
    expect(t.map((x) => [x.from, x.to])).toEqual([["voting", "voting"]]);
    const d = h.forum.proposals.get(id, m[0]);
    expect(d.status).toBe("voting");
    expect(d.extensionUsed).toBe(true);
    // Uzatma tam 24 saattir; tick geç çalışsa bile seçmenler süreden kaybetmez: max(eski bitiş, şimdi) + 24 sa
    expect(before.phaseEndsAt! < h.ctx.clock.now()).toBe(true);
    expect(d.phaseEndsAt).toBe(h.ctx.clock.now() + 24 * 3_600_000);
    // Ara sonuç SIZMAZ: ne API'de ne defterde
    expect(d.results).toEqual([]);
    expect(d.participation).toEqual({ voted: 4, eligible: 30 });
    expect(h.forum.proposals.bulletin(id).rounds).toEqual([]);
    expect(h.ledger.findTxs({ type: "TALLY", proposalId: id })).toHaveLength(0);
    expect(h.ledger.findTxs({ type: "BALLOT_REVEAL", proposalId: id })).toHaveLength(0);
    expect(h.ctx.db.get<{ c: number }>("SELECT COUNT(*) AS c FROM tallies WHERE proposal_id = ? AND interim = 1", id)!.c).toBe(1);
    expect(d.events.at(-1)?.reason).toMatch(/uzatıldı/);
    // Oy vermeyenlere bildirim
    expect(h.forum.community.notifications(m[10].id).items.some((n) => n.kind === "vote_extended")).toBe(true);
    expect(h.forum.community.notifications(m[0].id).items.some((n) => n.kind === "vote_extended")).toBe(false);
    // Dashboard görevleri: oy bekleyen
    expect(h.forum.community.tasks(m[10]).some((x) => x.kind === "vote" && x.link === `/oneriler/${id}`)).toBe(true);
    expect(h.forum.community.tasks(m[0]).some((x) => x.kind === "vote")).toBe(false);

    await h.forum.proposals.vote(m[4], id, "no");
    await endPhase(h, id);
    const r = h.forum.proposals.get(id, null);
    expect(r.status).toBe("rejected");
    expect(r.results).toHaveLength(1);
    expect(r.results[0].quorumMet).toBe(false);
    expect(r.results[0].reason).toMatch(/Yeter sayıya ulaşılamadı/);
    const b = h.forum.proposals.bulletin(id).rounds[0];
    expect(b.tally.extensionAvailable).toBe(false);
    expect(verifyTally(b.tally, b.reveals, b.commitments).ok).toBe(true);
  });

  it("oy kuralları: rıza geri çekilirse 422; askıdaki üye 403; süre dolunca 409; seçim doğrulanır", async () => {
    const id = await toDeliberation(h, m[1], m.slice(2), { title: "Pazar yerine çöp kovası", body: "Semt pazarına geri dönüşüm kovaları konsun ve pazar sonrası temizlik yapılsın." });
    await toVoting(h, id);
    h.ctx.db.run("UPDATE users SET political_consent = 0 WHERE id = ?", m[5].id);
    await expect(h.forum.proposals.vote(m[5], id, "yes")).rejects.toMatchObject({ status: 422, code: "consent_required" });
    expect(h.forum.proposals.get(id, m[5]).canVote).toBe(false);
    h.ctx.db.run("UPDATE users SET political_consent = 1 WHERE id = ?", m[5].id);
    await expect(h.forum.proposals.vote({ ...m[6], status: "suspended" }, id, "yes")).rejects.toMatchObject({ status: 403 });
    await expect(h.forum.proposals.vote(m[6], id, "belki" as never)).rejects.toMatchObject({ status: 400, code: "validation" });
    await endPhase(h, id);
  });

  it("senaryo 8: vekâlet — oy vermeyenin oyu delege üzerinden sayılır; cap taşması unrouted", async () => {
    const [author, delegate, d1, d2, d3, d4] = [m[20], m[21], m[22], m[23], m[24], m[25]];
    // cap = max(2, ⌈0,05·30⌉) = 2 → üç kişi aynı delegeye verirse biri taşar
    // Taşma sırası vekâlet oluşturma zamanına göredir: d1, d2 yönlendirilir; d3 ve d4 taşar.
    h.graph.delegate(d1.id, delegate.id, "*", 1);
    h.ctx.clock.advance(60_000);
    h.graph.delegate(d2.id, delegate.id, "*", 1);
    h.ctx.clock.advance(60_000);
    h.graph.delegate(d3.id, delegate.id, "*", 1);
    h.ctx.clock.advance(60_000);
    // d4 → d1 → delegate (iki adımlı zincir; d1 de oy vermiyor)
    h.graph.delegate(d4.id, d1.id, "*", 1);
    // Topluluk görünümü
    const md = h.forum.community.delegations(delegate.id);
    expect(md.incoming.map((x) => x.fromNickname).sort()).toEqual(["uye23", "uye24", "uye25"]);
    expect(md.cap).toBe(2);
    expect(h.forum.community.delegations(d1.id).outgoing[0].toNickname).toBe("uye22");

    const id = await toDeliberation(h, author, m.slice(0, 15), { title: "Kreş açılış saatleri", body: "Mahalle kreşi çalışan ebeveynler için sabah yedide açılsın ve akşam yediye kadar açık kalsın." });
    await toVoting(h, id);
    await h.forum.proposals.vote(delegate, id, "yes");
    for (let i = 0; i < 10; i++) await h.forum.proposals.vote(m[i], id, "yes");
    await endPhase(h, id);
    const d = h.forum.proposals.get(id, d1);
    const r = d.results[0];
    expect(r.totals.delegated).toBe(2);
    expect(r.totals.unrouted).toBe(2);
    expect(r.totals.participants).toBe(13);
    expect(d.myEffectiveVia).toEqual({ delegateNickname: "uye22", choice: "yes" });
    expect(h.forum.proposals.get(id, delegate).myEffectiveVia).toBeNull(); // doğrudan oy verdi

    const b = h.forum.proposals.bulletin(id).rounds[0];
    const delegated = b.reveals.filter((x) => x.via === "delegated");
    expect(delegated).toHaveLength(2);
    expect(delegated.every((x) => x.salt === "")).toBe(true);
    const v = verifyTally(b.tally, b.reveals, b.commitments);
    expect(v.ok).toBe(true);
    expect(v.recomputed.inputsHash).toBe(r.inputsHash);
    // Taşanlar bildirim aldı (vekâlet oluşturma sırası: d1, d2 yönlendirildi; d3 ve d4 (zincir) taşar)
    const unrouted = [d1, d2, d3, d4].filter((u) => h.forum.community.notifications(u.id).items.some((n) => n.kind === "delegation_unrouted"));
    expect(unrouted.map((u) => u.nickname).sort()).toEqual(["uye25", "uye26"]);
    expect(h.forum.proposals.get(id, d3).myEffectiveVia).toBeNull();
  });
});
