// ProposalDetail.ledgerTxs: VOTE_COMMIT dışındaki kayıtların HEPSİ listelenir, yalnız VOTE_COMMIT kısaltılır (toplam sayıyla).
// Eski davranış: tüm kayıtlardan en yeni 1000'i alınırdı; 1000'den fazla oy taahhüdünde PROPOSAL_CREATED gibi en eski kayıtlar düşerdi.
import { describe, expect, it } from "vitest";
import { DETAIL_VOTE_COMMIT_LIMIT } from "../../src/forum/detail";
import { CAT, LONG_BODY, makeForum } from "./harness";

describe("forum: öneri ayrıntısı defter kayıtları", () => {
  it("1000'den fazla VOTE_COMMIT olsa da PROPOSAL_CREATED ve diğer kayıtlar listede kalır; sayılar toplamdır", async () => {
    const h = await makeForum();
    const [author] = h.users("yazar", 1);
    const created = await h.forum.proposals.create(author, { kind: "topic", title: "Defter kaydı sınaması", body: LONG_BODY, categories: [CAT.park], submit: true });
    const before = h.forum.proposals.get(created.id, author);
    const structural = before.ledgerTxs.filter((t) => t.type !== "VOTE_COMMIT");
    expect(structural.map((t) => t.type)).toContain("PROPOSAL_CREATED");

    const total = DETAIL_VOTE_COMMIT_LIMIT + 150;
    for (let i = 0; i < total; i++) h.ledger.submit("VOTE_COMMIT", { proposalId: created.id, round: 1, ballotId: `b${i}`, commitment: `c${i}` });
    // Başka bir önerinin kaydı karışmaz.
    h.ledger.submit("VOTE_COMMIT", { proposalId: "baska-oneri", round: 1, ballotId: "x", commitment: "y" });
    h.ledger.submit("PHASE_CHANGED", { proposalId: created.id, from: "sponsoring", to: "deliberation" });

    const d = h.forum.proposals.get(created.id, author);
    const types = d.ledgerTxs.map((t) => t.type);
    // Yapısal kayıtların hepsi var (oy taahhütleri yüzünden düşmez)...
    expect(types.filter((t) => t !== "VOTE_COMMIT").sort()).toEqual([...structural.map((t) => t.type), "PHASE_CHANGED"].sort());
    expect(types[0]).toBe(structural[0].type);
    // ...oy taahhütleri sınırlanır, toplam sayı ise gerçek değerdir.
    expect(types.filter((t) => t === "VOTE_COMMIT")).toHaveLength(DETAIL_VOTE_COMMIT_LIMIT);
    expect(d.ledgerTxCounts?.VOTE_COMMIT).toBe(total);
    expect(d.ledgerTxCounts?.PROPOSAL_CREATED).toBe(1);
    expect(d.ledgerTxCounts?.PHASE_CHANGED).toBe(1 + structural.filter((t) => t.type === "PHASE_CHANGED").length);
  });

  it("sınırın altındaki oy taahhütlerinin hepsi listelenir ve sayısı eşittir", async () => {
    const h = await makeForum();
    const [author] = h.users("yazar", 1);
    const created = await h.forum.proposals.create(author, { kind: "topic", title: "Küçük defter sınaması", body: LONG_BODY, categories: [CAT.park], submit: true });
    for (let i = 0; i < 5; i++) h.ledger.submit("VOTE_COMMIT", { proposalId: created.id, round: 1, ballotId: `b${i}`, commitment: `c${i}` });
    const d = h.forum.proposals.get(created.id, author);
    expect(d.ledgerTxs.filter((t) => t.type === "VOTE_COMMIT")).toHaveLength(5);
    expect(d.ledgerTxCounts?.VOTE_COMMIT).toBe(5);
    expect(d.ledgerTxs.length).toBe(Object.values(d.ledgerTxCounts ?? {}).reduce((a, b) => a + b, 0));
  });
});
