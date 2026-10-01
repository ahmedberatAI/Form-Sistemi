// Senaryo 5 (yönetmelik yaması → enacted → yeni sürüm + BYLAW_VERSION; değiştirilemez hedef → inadmissible) ve
// senaryo 6 (aynı konuya iki düzenleme teklifi: ikincisi "Sürüm çakışması" ile reddedilir) + alt konu.
import { beforeAll, describe, expect, it, vi } from "vitest";
import { fy, type RegulationPatch } from "@forum/shared";
import type { AuthUser } from "../../src/core/contracts";
import { CAT, endPhase, insertTopic, LONG_BODY, makeForum, toDeliberation, toVoting, type ForumHarness } from "./harness";

describe("forum: yönetmelik değişikliği ve konu sürümleri", () => {
  let h: ForumHarness;
  let m: AuthUser[];

  beforeAll(async () => {
    h = await makeForum();
    m = h.users("uye", 30);
  });

  it("senaryo 5: yönetmelik yaması T2 ile oylanır; yürürlükte yeni sürüm ve BYLAW_VERSION", async () => {
    const patch: RegulationPatch = { ops: [{ op: "setParam", rule: fy("KatmanT0"), param: "sureTartisma", value: 48 }], rationale: "Olağan kararlar hızlansın." };
    const pre = await h.forum.proposals.precheck(m[0], { kind: "regulation", title: "Tartışma süresi kısalsın", body: "Olağan kararlarda tartışma süresi 72 saatten 48 saate indirilsin.", categories: [], regulationPatch: patch });
    expect(pre.audit.tier).toBe("T2");
    expect(pre.audit.admissible).toBe(true);
    expect(pre.classification.aiLabel).toMatch(/^Yapay zekâ ile üretildi · çevrimdışı sezgisel mod/);

    const id = await toDeliberation(h, m[0], m.slice(1), {
      kind: "regulation",
      title: "Tartışma süresi kısalsın",
      body: "Olağan kararlarda tartışma süresi 72 saatten 48 saate indirilsin.",
      categories: [],
      regulationPatch: patch,
    });
    let d = h.forum.proposals.get(id, null);
    expect(d.tier).toBe("T2");
    expect(d.categories).toEqual([CAT.yonetmelik]);
    expect(d.phaseEndsAt! - h.ctx.clock.now()).toBe(168 * 3_600_000);
    await toVoting(h, id);
    for (let i = 0; i < 27; i++) await h.forum.proposals.vote(m[i], id, i < 25 ? "yes" : "no");
    await endPhase(h, id);
    d = h.forum.proposals.get(id, null);
    expect(d.status).toBe("objection_window");
    // Eşik, oylama açılışında sabitlenen parametredir (T2: en az 2/3; nitelikli hükümde ontoloji 3/4 ister)
    const th = d.results[0].thresholdUsed;
    expect(th.num * 3).toBeGreaterThanOrEqual(2 * th.den);
    expect(d.params?.tier).toBe("T2");
    await endPhase(h, id);
    d = h.forum.proposals.get(id, null);
    expect(d.status).toBe("enacted");
    expect(d.enactedEntityId).toBe("2");
    expect(h.ontology.current().version).toBe(2);
    expect(h.ontology.current().viaProposalId).toBe(id);
    const bv = h.ledger.findTxs({ type: "BYLAW_VERSION" });
    expect(bv).toHaveLength(1);
    expect(bv[0].payload).toMatchObject({ version: 2, proposalId: id, hash: h.ontology.current().hash });
    expect(h.ctx.db.get<{ t: string }>("SELECT ledger_tx AS t FROM bylaw_versions WHERE version = 2")!.t).toBe(bv[0].hash);

    // Yeni yönetmelik yeni önerilere uygulanır (tartışma 48 saat); oylamadaki öneriler sabitlenmiş parametreyle sürer
    const id2 = await toDeliberation(h, m[3], m.slice(4), { title: "Kütüphaneye kitap bağışı kutusu", body: "Kütüphane girişine bağış kutusu konsun ve okuma etkinlikleri düzenlensin.", categories: [fy("Kutuphane")] });
    expect(h.forum.proposals.get(id2, null).phaseEndsAt! - h.ctx.clock.now()).toBe(48 * 3_600_000);
  });

  it("değiştirilemez maddeyi hedefleyen yama T3 → inadmissible (oylanamaz)", async () => {
    const patch: RegulationPatch = { ops: [{ op: "setProtection", article: fy("Madde_3_1"), protection: "Olagan" }], rationale: "Eşit oy kuralı esnetilsin." };
    const id = await toDeliberation(h, m[5], m.slice(6), {
      kind: "regulation",
      title: "Eşit oy maddesi değişsin",
      body: "Madde 3 (1) koruması olağan maddeye dönüştürülsün ve değiştirilebilsin.",
      categories: [],
      regulationPatch: patch,
    });
    const d = h.forum.proposals.get(id, null);
    expect(d.status).toBe("inadmissible");
    expect(d.audit?.tier).toBe("T3");
    expect(d.audit?.violations.map((v) => v.code)).toContain("immutable_target");
    expect(d.results).toEqual([]);
    expect(h.ontology.current().version).toBe(2);
  });

  it("senaryo 6: aynı konuya iki düzenleme — ikincisi “Sürüm çakışması” ile reddedilir; alt konu üst konudan miras alır", async () => {
    const topicId = insertTopic(h, "Mahalle parkı");
    const make = (author: AuthUser, n: number) =>
      toDeliberation(h, author, m.filter((u) => u.id !== author.id).slice(n * 3), {
        kind: "amendment",
        parentTopicId: topicId,
        amendment: { baseVersion: 1, newTitle: "", newBody: "" },
        title: `Mahalle parkı (düzenleme ${n})`,
        body: `Parkın açılış saatleri ve bakım düzeni yeniden belirlensin; düzenleme ${n}.`,
        categories: [],
      });
    const a1 = await make(m[10], 1);
    const a2 = await make(m[11], 2);
    expect(h.forum.proposals.get(a1, null).tier).toBe("T1");
    expect(h.forum.proposals.get(a1, null).amendment).toMatchObject({ baseVersion: 1, newTitle: "Mahalle parkı (düzenleme 1)" });
    // Eski sürüme dayanan teklif oluşturulamaz
    await expect(
      h.forum.proposals.create(m[12], { kind: "amendment", parentTopicId: topicId, amendment: { baseVersion: 7, newTitle: "", newBody: "" }, title: "Mahalle parkı yeni", body: "Bu teklif hatalı bir sürüme dayanıyor ve reddedilmeli.", categories: [] }),
    ).rejects.toMatchObject({ status: 409, code: "version_conflict" });

    await toVoting(h, a1);
    expect(h.forum.proposals.get(a2, null).status).toBe("voting");
    for (const id of [a1, a2]) for (let i = 0; i < 28; i++) await h.forum.proposals.vote(m[i], id, i < 26 ? "yes" : "no");
    await endPhase(h, a1); // her ikisi de itiraz süresine
    expect(h.forum.proposals.get(a2, null).status).toBe("objection_window");
    await endPhase(h, a1); // a1 önce (seq sırası) yürürlüğe girer; a2 çakışır
    const d1 = h.forum.proposals.get(a1, null);
    const d2 = h.forum.proposals.get(a2, null);
    expect(d1.status).toBe("enacted");
    expect(d1.enactedEntityId).toBe(topicId);
    expect(d2.status).toBe("rejected");
    expect(d2.events.at(-1)?.reason).toMatch(/^Sürüm çakışması/);
    const t = h.forum.topics.get(topicId, null);
    expect(t.version).toBe(2);
    expect(t.title).toBe("Mahalle parkı (düzenleme 1)");
    expect(t.revisions.map((r) => [r.version, r.viaProposalId])).toEqual([
      [1, null],
      [2, a1],
    ]);

    // Alt konu: kategoriler üst konudan miras + ekleme
    const sub = await h.forum.proposals.create(m[13], {
      kind: "subtopic",
      parentTopicId: topicId,
      title: "Parkta köpek gezdirme alanı",
      body: "Parkın kuzey köşesinde çitle ayrılmış bir köpek gezdirme alanı oluşturulsun.",
      categories: [CAT.spor],
    });
    expect(sub.categories).toEqual([CAT.park, CAT.spor]);
    expect(sub.parentTopic).toEqual({ id: topicId, title: "Mahalle parkı (düzenleme 1)" });
    expect(h.forum.topics.get(topicId, m[13]).openProposals.map((p) => p.id)).toContain(sub.id);
    expect(h.forum.topics.get(topicId, null).openProposals.map((p) => p.id)).not.toContain(sub.id); // taslak
  });

  it("yürürlük etkisi uygulanamazsa öneri gerekçeli reddedilir (sonsuz yeniden deneme yok)", async () => {
    const parent = insertTopic(h, "Arşivlenecek konu");
    const id = await toDeliberation(h, m[20], m.slice(21), { kind: "subtopic", parentTopicId: parent, title: "Arşivlenecek konunun alt konusu", body: LONG_BODY, categories: [] });
    await toVoting(h, id);
    for (let i = 0; i < 25; i++) await h.forum.proposals.vote(m[i], id, "yes");
    await endPhase(h, id);
    expect(h.forum.proposals.get(id, null).status).toBe("objection_window");
    h.ctx.db.run("UPDATE topics SET status = 'archived' WHERE id = ?", parent);
    const err = vi.spyOn(console, "error").mockImplementation(() => undefined);
    await endPhase(h, id);
    const d = h.forum.proposals.get(id, null);
    expect(d.status).toBe("rejected");
    expect(d.events.at(-1)?.reason).toMatch(/^Yürürlük etkisi uygulanamadı: Üst konu yürürlükte değil/);
    expect(h.forum.topics.get(parent, null).childCount).toBe(0);
    err.mockRestore();
  });
});
