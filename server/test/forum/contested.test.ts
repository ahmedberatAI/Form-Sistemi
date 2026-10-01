// Senaryo 2 (tartışmalı → uzlaşma → yeniden oylama, ω ile aşma) ve senaryo 3 (azınlık itirazı → uzlaşma → ρ).
import { beforeAll, describe, expect, it } from "vitest";
import { fy, verifyTally, type ProposalDetail } from "@forum/shared";
import { CAT, closeVoting, endPhase, insertTopic, makeBlocks, makeForum, seedHistory, toDeliberation, toVoting, type Blocks, type ForumHarness } from "./harness";

async function voteBlocks(h: ForumHarness, id: string, b: Blocks, plan: { A: "yes" | "no"; B: "yes" | "no"; C: ("yes" | "no")[] | "yes" | "no" }) {
  for (const u of b.A) await h.forum.proposals.vote(u, id, plan.A);
  for (const u of b.B) await h.forum.proposals.vote(u, id, plan.B);
  for (const [i, u] of b.C.entries()) await h.forum.proposals.vote(u, id, Array.isArray(plan.C) ? plan.C[i] : plan.C);
}

describe("forum: görüş kümeleri, tartışmalı sonuç ve azınlık itirazı", () => {
  let h: ForumHarness;
  let b: Blocks;

  beforeAll(async () => {
    h = await makeForum();
    b = makeBlocks(h);
    await seedHistory(h, b, 10);
  }, 60_000);

  it("kapanmış oylardan üç küme oluşur (C en küçük anlamlı küme)", async () => {
    const snap = await h.forum.clusters.snapshot("test");
    expect(snap.k).toBe(3);
    expect(snap.members).toBe(30);
    const sizes = h.forum.clusters.sizes(snap.id);
    expect(Object.values(sizes.sizes).sort((x, y) => y - x)).toEqual([15, 9, 6]);
    const ofC = new Set(b.C.map((u) => h.forum.clusters.clusterOf(snap.id, u.id)));
    expect(ofC.size).toBe(1);
    expect([...ofC][0]).toBe("g2");
    // Aynı girdi → aynı anlık görüntü (yeni satır yok)
    const again = await h.forum.clusters.snapshot("tekrar");
    expect(again.id).toBe(snap.id);
    expect(h.ledger.findTxs({ type: "CLUSTER_SNAPSHOT" }).length).toBeGreaterThanOrEqual(1);
    expect(h.forum.community.me(b.C[0].id).clusterId).toBe("g2");
    // Görüntü: noktalar ve merkezler
    expect(snap.points).toHaveLength(30);
    expect(snap.clusters.map((c) => c.label)).toEqual(["Görüş Grubu A", "Görüş Grubu B", "Görüş Grubu C"]);
  });

  it("senaryo 2: azınlık kümesi aktif hayır → contested → uzlaşma → yeniden oylama → ω ile enacted", async () => {
    const id = await toDeliberation(h, b.A[0], b.all.slice(1), { title: "Gece pazarı kurulsun", body: "Mahallede cumartesi geceleri sokak pazarı kurulmasını ve trafiğe kapatılmasını öneriyoruz." });
    await toVoting(h, id);
    await voteBlocks(h, id, b, { A: "yes", B: "yes", C: "no" });
    const t = await closeVoting(h, id);
    expect(t.map((x) => x.to)).toEqual(["reconciliation"]);
    let d: ProposalDetail = h.forum.proposals.get(id, b.C[0]);
    const r1 = d.results[0];
    expect(r1.outcome).toBe("contested");
    expect(r1.bridgeApplicable).toBe(true);
    const failing = r1.clusters.filter((c) => c.passed === false).map((c) => c.clusterId);
    expect(failing).toEqual(["g2"]);
    expect(r1.checks.find((c) => c.key === "bridge:g2")?.passed).toBe(false);
    expect(d.reconciliationOrigin).toBe("contested");

    // Uzlaşma: azınlık raporu (tur-1 etkin oyu "no" olan), köprü taslakları, karşı bilirkişi talebi
    await expect(async () => h.forum.proposals.minorityReport(b.A[1], id, "x".repeat(60))).rejects.toMatchObject({ code: "not_eligible" });
    const rep = h.forum.proposals.minorityReport(
      b.C[0],
      id,
      "Gece pazarı mahallenin yaşlı sakinleri için gürültü ve otopark sorunu yaratır; hafta içi gündüz saatleri daha uygundur.",
    );
    expect(rep.clusterId).toBe("g2");
    const bridging = await h.forum.proposals.aiBridging(b.B[0], id);
    expect(bridging.task).toBe("bridging_drafts");
    expect(bridging.label).toMatch(/^Yapay zekâ ile üretildi/);
    const drafts = (bridging.output as { drafts: { title: string; body: string }[] }).drafts;
    expect(drafts.length).toBeGreaterThan(0);
    // Yazar dışındaki kişi taslağı uygulayamaz; yazar uygular → yeni sürüm
    await expect(h.forum.proposals.approveAi(b.B[0], bridging.id, 0)).rejects.toMatchObject({ status: 403 });
    const approved = await h.forum.proposals.approveAi(b.A[0], bridging.id, 0);
    expect(approved.approvedBy).toBe(b.A[0].id);
    d = h.forum.proposals.get(id, null);
    expect(d.version).toBe(2);
    expect(d.minorityReports).toHaveLength(1);

    // Revote: aynı seçmen listesi ve aynı küme görüntüsü
    const snapBefore = h.ctx.db.get<{ s: string }>("SELECT cluster_snapshot_id AS s FROM proposals WHERE id = ?", id)!.s;
    await endPhase(h, id);
    d = h.forum.proposals.get(id, null);
    expect(d.status).toBe("revote");
    expect(d.votingRound).toBe(2);
    expect(h.ctx.db.get<{ s: string }>("SELECT cluster_snapshot_id AS s FROM proposals WHERE id = ?", id)!.s).toBe(snapBefore);
    await voteBlocks(h, id, b, { A: "yes", B: "yes", C: "no" });
    await closeVoting(h, id);
    d = h.forum.proposals.get(id, null);
    expect(d.status).toBe("enacted");
    const r2 = d.results[1];
    expect(r2.round).toBe(2);
    expect(r2.outcome).toBe("accept");
    expect(r2.overrideMet).toBe(true);
    // Her iki tur da bültenden doğrulanır
    for (const round of h.forum.proposals.bulletin(id).rounds) expect(verifyTally(round.tally, round.reveals, round.commitments).ok).toBe(true);
  });

  it("senaryo 2b: yeniden oylamada ne köprü ne ω sağlanırsa reddedilir", async () => {
    const id = await toDeliberation(h, b.A[1], b.all.slice(2), { title: "Park saatleri kısaltılsın", body: "Mahalle parkı gece onda kapatılsın ve bekçi görevlendirilsin; gürültü azaltılsın." });
    await toVoting(h, id);
    await voteBlocks(h, id, b, { A: "yes", B: "yes", C: "no" });
    await closeVoting(h, id);
    expect(h.forum.proposals.get(id, null).status).toBe("reconciliation");
    await endPhase(h, id);
    await voteBlocks(h, id, b, { A: "yes", B: "no", C: "no" });
    await closeVoting(h, id);
    const d = h.forum.proposals.get(id, null);
    expect(d.status).toBe("rejected");
    expect(d.results[1].outcome).toBe("reject");
  });

  it("senaryo 3: kabul → itirazlar (kural a) → uzlaşma(objection) → yeniden oylama ρ", async () => {
    const id = await toDeliberation(h, b.A[2], b.all.slice(3), { title: "Otopark ücretli olsun", body: "Meydandaki otopark saatlik ücretli olsun; gelir park bakımına aktarılsın diye öneriyoruz." });
    await toVoting(h, id);
    // C kümesinde 3 evet / 3 hayır → P_C = 4/8 ≥ 0,3 → kabul
    await voteBlocks(h, id, b, { A: "yes", B: "yes", C: ["yes", "yes", "yes", "no", "no", "no"] });
    await closeVoting(h, id);
    let d = h.forum.proposals.get(id, b.C[3]);
    expect(d.status).toBe("objection_window");
    expect(d.results[0].outcome).toBe("accept");
    expect(d.canObject).toBe(true);
    expect(h.forum.proposals.get(id, b.C[0]).canObject).toBe(false);

    const ground = fy("OrantisizAzinlikEtkisi");
    const statement = "Ücretlendirme yalnızca meydan çevresindeki dar gelirli sakinleri etkiliyor.";
    // "no" olmayan seçmen itiraz edemez
    await expect(h.forum.proposals.object(b.C[0], id, { ground, statement })).rejects.toMatchObject({ status: 422, code: "not_eligible" });
    // Geçersiz gerekçe
    await expect(h.forum.proposals.object(b.C[3], id, { ground: fy("GorusAyriligi"), statement })).rejects.toMatchObject({ status: 400 });
    // Bütçe: son 30 günde 2 imza dolmuş
    const now = h.ctx.clock.now();
    h.ctx.db.run("UPDATE users SET objection_budget_used = ? WHERE id = ?", JSON.stringify([now - 1000, now - 2000]), b.C[5].id);
    await expect(h.forum.proposals.object(b.C[5], id, { ground, statement })).rejects.toMatchObject({ status: 422, code: "objection_budget" });
    // 30 günden eski imzalar bütçeyi tüketmez
    h.ctx.db.run("UPDATE users SET objection_budget_used = ? WHERE id = ?", JSON.stringify([now - 31 * 86_400_000, now - 1000]), b.C[5].id);

    d = await h.forum.proposals.object(b.C[3], id, { ground, statement });
    await expect(h.forum.proposals.object(b.C[3], id, { ground, statement })).rejects.toMatchObject({ status: 409, code: "already_objected" });
    expect(d.objectionEvaluation?.valid).toBe(false);
    d = await h.forum.proposals.object(b.C[4], id, { ground, statement });
    expect(d.status).toBe("objection_window");
    d = await h.forum.proposals.object(b.C[5], id, { ground, statement });
    // 3 imza ≥ max(3, ⌈0,75·3⌉) → kural (a) → hemen uzlaşma
    expect(d.objectionEvaluation?.valid).toBe(true);
    expect(d.objectionEvaluation?.rule).toBe("cluster");
    expect(d.status).toBe("reconciliation");
    expect(d.reconciliationOrigin).toBe("objection");
    expect(d.objections).toHaveLength(3);
    expect(JSON.parse(h.ctx.db.get<{ v: string }>("SELECT objection_budget_used AS v FROM users WHERE id = ?", b.C[5].id)!.v)).toHaveLength(2);
    expect(h.ledger.findTxs({ type: "OBJECTION", proposalId: id })).toHaveLength(3);

    await endPhase(h, id);
    expect(h.forum.proposals.get(id, null).status).toBe("revote");
    // ρ = 0,60: 17/30 evet ≈ %56,7 < %60 → red (genel çoğunluk olsa bile)
    for (const [i, u] of b.all.entries()) await h.forum.proposals.vote(u, id, i < 17 ? "yes" : "no");
    await closeVoting(h, id);
    d = h.forum.proposals.get(id, null);
    expect(d.status).toBe("rejected");
    const r2 = d.results[1];
    expect(r2.checks.find((c) => c.key === "revote_threshold")?.passed).toBe(false);
    for (const round of h.forum.proposals.bulletin(id).rounds) expect(verifyTally(round.tally, round.reveals, round.commitments).ok).toBe(true);
  });

  it("azınlık kümesinden ilk bilirkişi sorusu güvenceli işaretlenir", async () => {
    const id = await toDeliberation(h, b.A[3], b.all.slice(4), { title: "Spor sahasına ışıklandırma", body: "Spor sahasına gece aydınlatması kurulsun; maliyet katılımcı bütçeden karşılansın." });
    const q1 = h.forum.proposals.expertQuestion(b.C[1], id, "Aydınlatmanın komşu evlere ışık kirliliği etkisi ne olur?");
    expect(q1.minorityGuaranteed).toBe(true);
    const q2 = h.forum.proposals.expertQuestion(b.C[2], id, "Enerji tüketimi yıllık ne kadar olur?");
    expect(q2.minorityGuaranteed).toBe(false);
    const q3 = h.forum.proposals.expertQuestion(b.A[5], id, "Kurulum ne kadar sürer acaba?");
    expect(q3.minorityGuaranteed).toBe(false);
  });

  it("köprü skoru: son anlık görüntünün anlamlı kümelerinde en düşük Laplace desteği", async () => {
    const topicId = insertTopic(h, "Köprü konusu");
    const msg = await h.forum.messages.post(b.A[0], "topic", topicId, { body: "Parkın bakımını gönüllülerle birlikte yapalım.", stance: "pro" });
    for (const u of b.A.slice(1, 5)) h.forum.messages.endorse(u, msg.id, 1);
    for (const u of b.B.slice(0, 2)) h.forum.messages.endorse(u, msg.id, 1);
    for (const u of b.C.slice(0, 2)) h.forum.messages.endorse(u, msg.id, -1);
    const snap = h.forum.clusters.latest()!;
    const per = new Map<string, { a: number; d: number }>();
    for (const [u, v] of [...b.A.slice(1, 5).map((x) => [x, 1] as const), ...b.B.slice(0, 2).map((x) => [x, 1] as const), ...b.C.slice(0, 2).map((x) => [x, -1] as const)]) {
      const g = h.forum.clusters.clusterOf(snap.id, u.id)!;
      const c = per.get(g) ?? { a: 0, d: 0 };
      if (v > 0) c.a++;
      else c.d++;
      per.set(g, c);
    }
    const expected = Math.min(...snap.clusters.map((c) => per.get(c.clusterId) ?? { a: 0, d: 0 }).map((c) => (1 + c.a) / (2 + c.a + c.d)));
    const v = h.forum.messages.get(msg.id, null);
    expect(v.bridgingScore).toBeCloseTo(expected, 4);
    expect(v.bridgingScore).toBeLessThan(0.5);
  });

  it("itiraz ve oy süreleri: süre dolunca 409", async () => {
    const id = await toDeliberation(h, b.A[6], b.all.slice(7), { title: "Kütüphane hafta sonu açık", body: "Mahalle kütüphanesi cumartesi ve pazar günleri de açık olsun, öğrenciler çalışabilsin." });
    await toVoting(h, id);
    await voteBlocks(h, id, b, { A: "yes", B: "yes", C: ["yes", "yes", "yes", "no", "no", "no"] });
    const p = h.forum.proposals.get(id, null);
    h.ctx.clock.advance(p.phaseEndsAt! - h.ctx.clock.now());
    await expect(h.forum.proposals.vote(b.C[0], id, "no")).rejects.toMatchObject({ status: 409 });
    await h.tick();
    const d = h.forum.proposals.get(id, null);
    expect(d.status).toBe("objection_window");
    h.ctx.clock.advance(d.phaseEndsAt! - h.ctx.clock.now());
    await expect(h.forum.proposals.object(b.C[3], id, { ground: fy("UsulHatasi"), statement: "Süre dolduktan sonra yapılan itiraz denemesi." })).rejects.toMatchObject({ status: 409 });
    await h.tick();
    expect(h.forum.proposals.get(id, null).status).toBe("enacted");
  });

  it("uzlaşmada karşı bilirkişi talebi (≥3 kişi) → önceden taahhüt edilen blokla karşı panel", async () => {
    const admin = h.user("yonetici2", { roles: ["admin"] });
    const expert = h.user("bilirkisi2");
    h.experts.apply(expert.id, [CAT.enerji], "Enerji uzmanı.");
    h.experts.decideApplication(admin.id, expert.id, "approve");
    const id = await toDeliberation(h, b.A[7], b.all.slice(8), {
      title: "Spor salonuna güneş paneli",
      body: "Spor salonunun çatısına güneş paneli kurulsun; fazla elektrik şebekeye verilsin.",
      categories: [CAT.enerji],
    });
    await h.tick();
    const first = h.forum.proposals.get(id, null).expertPanel!;
    expect(first.isCounterPanel).toBe(false);
    expect(first.assignments.map((a) => a.expertId)).toEqual([expert.id]);
    await toVoting(h, id);
    await voteBlocks(h, id, b, { A: "yes", B: "yes", C: "no" });
    await closeVoting(h, id);
    expect(h.forum.proposals.get(id, null).status).toBe("reconciliation");
    await expect(h.forum.proposals.requestExpert(b.C[0], id, "panel")).rejects.toMatchObject({ status: 409 });
    for (const u of b.C.slice(0, 3)) await h.forum.proposals.requestExpert(u, id, "counter");
    h.forum.proposals.minorityReport(b.C[0], id, "Panel verimliliği bu çatı açısında düşük; bağımsız bir karşı bilirkişi görüşü alınmadan karar verilmemeli.");
    await h.tick();
    const panel = h.forum.proposals.get(id, null).expertPanel!;
    expect(panel.isCounterPanel).toBe(true);
    expect(panel.panelId).not.toBe(first.panelId);
    // Önceki panelist karşı panele giremez: tek bilirkişi olduğundan uygun aday yok
    expect(panel.assignments.map((a) => a.expertId)).not.toContain(expert.id);
    const committed = h.ledger.getBlock(panel.seedSource.blockHeight)!;
    expect(panel.seedSource.blockHash).toBe(committed.hash);
  });
});
