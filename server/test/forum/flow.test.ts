// Senaryo 1: konu önerisi baştan sona (GERÇEK defter): create → submit → sponsor(K_s) → deliberation → voting → oylar →
// accept → objection_window → enacted → konu oluştu; defterde PHASE_CHANGED/VOTE_COMMIT/BALLOT_REVEAL/TALLY; verifyTally ✔.
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { verifyInclusionProof, verifyTally, voteCommitment, type ProposalDetail } from "@forum/shared";
import { CAT, closeVoting, LONG_BODY, makeForum, toVoting, type ForumHarness } from "./harness";
import type { AuthUser } from "../../src/core/contracts";

describe("forum: konu önerisi baştan sona (gerçek defter)", () => {
  let h: ForumHarness;
  let members: AuthUser[];
  let id: string;

  beforeAll(async () => {
    h = await makeForum({ realLedger: true });
    members = h.users("uye", 30);
  });
  afterAll(async () => {
    await h.close();
  });

  it("taslak oluşturur ve gönderir; PROPOSAL_CREATED defterde", async () => {
    const [author] = members;
    const draft = await h.forum.proposals.create(author, { kind: "topic", title: "Parka gölgelik ve bank", body: LONG_BODY, categories: [CAT.park] });
    expect(draft.status).toBe("draft");
    expect(draft.version).toBe(1);
    expect(draft.seq).toBe(1);
    // Taslak yalnız yazara görünür
    expect(() => h.forum.proposals.get(draft.id, null)).toThrow(/bulunamadı/);
    expect(h.forum.proposals.list({}, null)).toHaveLength(0);
    expect(h.forum.proposals.list({}, author)).toHaveLength(1);

    const sent = await h.forum.proposals.submit(author, draft.id);
    id = sent.id;
    expect(sent.status).toBe("sponsoring");
    expect(sent.tier).toBe("T0");
    expect(sent.sponsorsRequired).toBe(3);
    expect(sent.phaseEndsAt).toBe(h.ctx.clock.now() + 168 * 3_600_000);
    await h.flush();
    const types = h.ledger.findTxs({ proposalId: id }).map((t) => t.type);
    expect(types).toContain("PROPOSAL_CREATED");
    expect(types).toContain("PHASE_CHANGED");
  });

  it("yazar kendini destekleyemez; K_s destekle tartışmaya geçer", async () => {
    const [author, s1, s2, s3] = members;
    await expect(h.forum.proposals.sponsor(author, id)).rejects.toMatchObject({ status: 422, code: "own_proposal" });
    await h.forum.proposals.sponsor(s1, id);
    await expect(h.forum.proposals.sponsor(s1, id)).rejects.toMatchObject({ status: 409, code: "already_sponsored" });
    const d2 = await h.forum.proposals.sponsor(s2, id);
    expect(d2.status).toBe("sponsoring");
    expect(d2.sponsorCount).toBe(2);
    const d3 = await h.forum.proposals.sponsor(s3, id);
    expect(d3.status).toBe("deliberation");
    expect(d3.sponsors.map((s) => s.nickname)).toEqual(["uye02", "uye03", "uye04"]);
    expect(d3.events.map((e) => e.to)).toEqual(["sponsoring", "deliberation"]);
    // sponsoring'de metin değiştirilemezdi; tartışmada değiştirilebilir
    const upd = await h.forum.proposals.update(author, id, { title: "Parka gölgelik ve oturma bankı", body: LONG_BODY + " Gölgelikler ahşap olsun." });
    expect(upd.version).toBe(2);
    expect(upd.versions.map((v) => v.version)).toEqual([1, 2]);
  });

  it("tartışma bitince oylama açılır; uygun seçmen listesi dondurulur", async () => {
    // Oylama açılışından sonra doğrulanan üye seçmen olamaz (öneri oluşturulmadan önce doğrulanmış olmalı)
    const late = h.user("gec_gelen", { verifiedAt: h.ctx.clock.now() });
    await toVoting(h, id);
    const d = h.forum.proposals.get(id, members[5]);
    expect(d.status).toBe("voting");
    expect(d.votingRound).toBe(1);
    expect(d.params?.tier).toBe("T0");
    expect(d.canVote).toBe(true);
    expect(h.forum.proposals.voters(id).eligibleCount).toBe(30);
    await expect(h.forum.proposals.vote(late, id, "yes")).rejects.toMatchObject({ status: 422, code: "not_eligible" });
    // Metin oylama başlarken kilitlenir
    await expect(h.forum.proposals.update(members[0], id, { title: "Yeni başlık burada", body: LONG_BODY })).rejects.toMatchObject({ status: 409 });
  });

  it("oy verilir, değiştirilir; oylama sürerken sonuç SIZMAZ", async () => {
    const receipts = new Map<string, Awaited<ReturnType<ForumHarness["forum"]["proposals"]["vote"]>>>();
    for (let i = 0; i < 12; i++) receipts.set(members[i].id, await h.forum.proposals.vote(members[i], id, i < 10 ? "yes" : "no"));
    // 11. üye fikrini değiştirir (son taahhüt geçerli)
    const changed = await h.forum.proposals.vote(members[10], id, "yes");
    expect(changed.ballotId).toBe(receipts.get(members[10].id)!.ballotId);
    expect(changed.commitment).not.toBe(receipts.get(members[10].id)!.commitment);
    expect(voteCommitment(id, 1, changed.ballotId, "yes", changed.salt)).toBe(changed.commitment);
    await h.flush();

    const d: ProposalDetail = h.forum.proposals.get(id, members[0]);
    expect(d.results).toEqual([]);
    expect(d.participation).toEqual({ voted: 12, eligible: 30 });
    expect(d.myBallot?.choice).toBe("yes");
    expect(h.forum.proposals.bulletin(id).rounds).toEqual([]);
    expect(h.ledger.findTxs({ type: "TALLY", proposalId: id })).toHaveLength(0);
    expect(h.ledger.findTxs({ type: "BALLOT_REVEAL", proposalId: id })).toHaveLength(0);
    expect(h.forum.proposals.receipts(members[10], id)).toHaveLength(1);
  });

  it("kapanış: accept → itiraz süresi; bülten istemcide verifyTally ile doğrulanır", async () => {
    const t = await closeVoting(h, id);
    expect(t.map((x) => [x.from, x.to])).toEqual([["voting", "objection_window"]]);
    await h.flush();
    const d = h.forum.proposals.get(id, members[0]);
    expect(d.status).toBe("objection_window");
    expect(d.results).toHaveLength(1);
    const r = d.results[0];
    expect(r.outcome).toBe("accept");
    expect(r.totals).toMatchObject({ eligible: 30, participants: 12, yes: 11, no: 1, abstain: 0 });
    expect(r.bridgeApplicable).toBe(false); // soğuk başlangıç

    const b = h.forum.proposals.bulletin(id);
    expect(b.rounds).toHaveLength(1);
    const round = b.rounds[0];
    expect(round.reveals).toHaveLength(12);
    expect(Object.keys(round.commitments)).toHaveLength(12);
    expect(round.commitTxs).toHaveLength(13); // 12 oy + 1 değişiklik
    const v = verifyTally(round.tally, round.reveals, round.commitments);
    expect(v.mismatches).toEqual([]);
    expect(v.ok).toBe(true);
    expect(v.recomputed.inputsHash).toBe(r.inputsHash);
    expect(round.tally.inputsHash).toBe(r.inputsHash);

    // Makbuz: defterdeki taahhüdün dahil olma kanıtı + doğrulayıcı imzaları
    const rc = h.forum.proposals.receipts(members[10], id)[0];
    const proof = h.ledger.proof(rc.txHash!);
    expect(proof).not.toBeNull();
    expect(verifyInclusionProof(proof!).ok).toBe(true);
    expect(round.reveals.find((x) => x.ballotId === rc.ballotId)).toMatchObject({ choice: "yes", salt: rc.salt, via: "direct" });
  });

  it("itiraz süresi dolunca yürürlüğe girer ve konu oluşur", async () => {
    const t = await h.advance(49);
    expect(t.map((x) => x.to)).toEqual(["enacted"]);
    const d = h.forum.proposals.get(id, null);
    expect(d.status).toBe("enacted");
    expect(d.enactedEntityId).toBeTruthy();
    const topic = h.forum.topics.get(d.enactedEntityId!, null);
    expect(topic.title).toBe("Parka gölgelik ve oturma bankı");
    expect(topic.originProposalId).toBe(id);
    expect(topic.revisions).toHaveLength(1);
    expect(topic.revisions[0].viaProposalId).toBe(id);
    expect(h.forum.topics.list().map((x) => x.id)).toEqual([topic.id]);
    await h.flush();
    const types = new Set(h.ledger.findTxs({ proposalId: id }).map((x) => x.type));
    for (const t of ["PROPOSAL_CREATED", "PROPOSAL_VERSION", "SPONSORED", "PHASE_CHANGED", "VOTE_COMMIT", "BALLOT_REVEAL", "TALLY"]) expect(types).toContain(t);
    expect(h.ledger.findTxs({ type: "TOPIC_REVISION" })).toHaveLength(1);
    expect(d.ledgerTxs.length).toBeGreaterThan(10);
    expect(d.events.map((e) => e.to)).toEqual(["sponsoring", "deliberation", "voting", "objection_window", "enacted"]);
    // Her geçişin defter kaydı var
    expect(d.events.every((e) => !!e.ledgerTx)).toBe(true);
    // Bildirim: yazar sonucu aldı
    const notes = h.forum.community.notifications(members[0].id);
    expect(notes.items.some((n) => n.title.includes("Kabul edildi"))).toBe(true);
  });
});
