// MessageService ve TopicService: iş parçacıkları, yanıtlar, sürümler, katılım/köprü skoru, konu ağacı ve sayılar.
import { beforeAll, describe, expect, it } from "vitest";
import type { AuthUser } from "../../src/core/contracts";
import { CAT, insertTopic, LONG_BODY, makeForum, type ForumHarness } from "./harness";

describe("forum: tartışma ve konular", () => {
  let h: ForumHarness;
  let m: AuthUser[];
  let root: string;
  let child: string;
  let grandchild: string;

  beforeAll(async () => {
    h = await makeForum();
    m = h.users("uye", 8);
    root = insertTopic(h, "Çevre", [CAT.cevre]);
    child = insertTopic(h, "Parklar", [CAT.park], root);
    grandchild = insertTopic(h, "Köpek parkı", [CAT.park], child);
  });

  it("mesaj yazma, yanıt, bildirim ve REPLIED_TO kenarı; başka tartışmadaki mesaja yanıt verilemez", async () => {
    const a = await h.forum.messages.post(m[0], "topic", child, { body: "Parklara daha çok ağaç dikilmeli.", stance: "pro" });
    expect(a).toMatchObject({ seq: 1, version: 1, visibility: "visible", authorNickname: "uye01", parentId: null, stance: "pro" });
    expect(a.contentHash).toMatch(/^[0-9a-f]{64}$/);
    expect(a.ledgerTx).toBeTruthy();
    const b = await h.forum.messages.post(m[1], "topic", child, { body: "Sulama maliyeti ne olacak?", stance: "question", parentId: a.id });
    expect(b.parentId).toBe(a.id);
    expect(h.forum.community.notifications(m[0].id).items[0]).toMatchObject({ kind: "message_reply", link: `/konular/${child}` });
    expect(h.graph.listEdges({ src: `user:${m[1].id}`, type: "REPLIED_TO" }).map((e) => e.dst)).toEqual([`user:${m[0].id}`]);
    // Kendine yanıt: bildirim/kenar yok
    await h.forum.messages.post(m[0], "topic", child, { body: "Sulama için yağmur suyu toplanabilir.", stance: "neutral", parentId: b.id });
    const err = await h.forum.messages.post(m[2], "topic", root, { body: "Yanlış yere yanıt", stance: "neutral", parentId: a.id }).catch((e) => e);
    expect(err).toMatchObject({ status: 400, code: "validation" });
    expect(err.details).toHaveProperty("parentId");
    await expect(h.forum.messages.post(m[2], "topic", child, { body: "   ", stance: "neutral" })).rejects.toMatchObject({ status: 400 });
    await expect(h.forum.messages.post(m[2], "topic", child, { body: "x", stance: "kızgın" as never })).rejects.toMatchObject({ status: 400 });
    await expect(h.forum.messages.post(m[2], "topic", "yok", { body: "x", stance: "pro" })).rejects.toMatchObject({ status: 404 });
    await expect(h.forum.messages.post({ ...m[2], status: "pending" }, "topic", child, { body: "x", stance: "pro" })).rejects.toMatchObject({ status: 403 });
    const list = h.forum.messages.list("topic", child, null);
    expect(list.map((x) => x.seq)).toEqual([1, 2, 3]);
    expect(h.ledger.findTxs({ type: "MESSAGE_POSTED" })).toHaveLength(3);
  });

  it("düzenleme yeni sürüm üretir (yeni tuz) ve MESSAGE_EDITED; yalnız yazar", async () => {
    const msg = await h.forum.messages.post(m[3], "topic", root, { body: "İlk metin.", stance: "neutral" });
    await expect(h.forum.messages.edit(m[4], msg.id, "Başkasının düzenlemesi")).rejects.toMatchObject({ status: 403 });
    const same = await h.forum.messages.edit(m[3], msg.id, "İlk metin.");
    expect(same.version).toBe(1);
    const e = await h.forum.messages.edit(m[3], msg.id, "Düzeltilmiş metin.");
    expect(e.version).toBe(2);
    expect(e.body).toBe("Düzeltilmiş metin.");
    expect(e.contentHash).not.toBe(msg.contentHash);
    const versions = h.forum.messages.versions(null, msg.id);
    expect(versions.map((v) => [v.version, v.body])).toEqual([
      [1, "İlk metin."],
      [2, "Düzeltilmiş metin."],
    ]);
    expect(h.ledger.findTxs({ type: "MESSAGE_EDITED" })).toHaveLength(1);
  });

  it("katılım bildirme: kendi mesajı yok; 0 geri alır (satır silinmez); köprü skoru küme yokken null", async () => {
    const msg = await h.forum.messages.post(m[0], "topic", root, { body: "Geri dönüşüm kutuları artırılmalı.", stance: "pro" });
    expect(() => h.forum.messages.endorse(m[0], msg.id, 1)).toThrow(/Kendi mesajınıza/);
    h.forum.messages.endorse(m[1], msg.id, 1);
    h.forum.messages.endorse(m[2], msg.id, -1);
    let v = h.forum.messages.endorse(m[3], msg.id, 1);
    expect(v.endorsements).toEqual({ agree: 2, disagree: 1, mine: 1 });
    expect(v.bridgingScore).toBeNull();
    v = h.forum.messages.endorse(m[3], msg.id, 0);
    expect(v.endorsements).toEqual({ agree: 1, disagree: 1, mine: 0 });
    expect(h.forum.messages.get(msg.id, m[2]).endorsements.mine).toBe(-1);
    expect(h.ctx.db.get<{ c: number }>("SELECT COUNT(*) AS c FROM message_endorsements WHERE message_id = ?", msg.id)!.c).toBe(3);
    expect(() => h.forum.messages.endorse(m[1], msg.id, 2 as never)).toThrow();
  });

  it("öneri tartışması: taslakta kapalı; yazar dışındakiler taslak tartışmasını göremez", async () => {
    const d = await h.forum.proposals.create(m[5], { kind: "topic", title: "Taslak öneri", body: LONG_BODY, categories: [CAT.park] });
    expect(() => h.forum.messages.list("proposal", d.id, m[6])).toThrow(/bulunamadı/);
    expect(h.forum.messages.list("proposal", d.id, m[5])).toEqual([]);
    await expect(h.forum.messages.post(m[5], "proposal", d.id, { body: "Taslağa yorum", stance: "neutral" })).rejects.toMatchObject({ status: 409 });
    await h.forum.proposals.submit(m[5], d.id);
    const msg = await h.forum.messages.post(m[6], "proposal", d.id, { body: "Destekliyorum.", stance: "pro" });
    expect(h.forum.proposals.get(d.id, null).messageCount).toBe(1);
    expect(msg.threadType).toBe("proposal");
  });

  it("mesaj ön denetimi: kişisel veri ve moderasyon (YZ etiketiyle, yalnız danışma)", async () => {
    const r = await h.forum.messages.precheck(m[0], "Seni bulup öldüreceğim, numaram 0532 111 22 33");
    expect(r.pii.length).toBeGreaterThan(0);
    expect(r.risk).toBe(3);
    expect(r.labels.length).toBeGreaterThan(0);
    expect(r.aiLabel).toMatch(/çevrimdışı sezgisel mod/);
    // Riskli içerik gizlenmez (YZ yalnız danışman): yalnız aiFlag taşır
    const msg = await h.forum.messages.post(m[0], "topic", root, { body: "Bu kararı verenler hepsi aptal ve geri zekalı!", stance: "con" });
    expect(msg.visibility).toBe("visible");
    expect(msg.body).not.toBeNull();
    expect(msg.aiFlag?.risk).toBeGreaterThanOrEqual(1);
  });

  it("konu ağacı: sayılar, çocuklar, kökten atalar, açık öneriler", async () => {
    await h.forum.proposals.create(m[7], { kind: "subtopic", parentTopicId: child, title: "Parklara spor aletleri", body: LONG_BODY, categories: [], submit: true });
    const list = h.forum.topics.list();
    expect(list.map((t) => t.id)).toEqual([root, child, grandchild]);
    const c = list.find((t) => t.id === child)!;
    expect(c).toMatchObject({ parentId: root, childCount: 1, messageCount: 3, openProposalCount: 1, version: 1, status: "active" });
    const g = h.forum.topics.get(grandchild, null);
    expect(g.ancestors.map((a) => a.title)).toEqual(["Çevre", "Parklar"]);
    const cd = h.forum.topics.get(child, null);
    expect(cd.children.map((x) => x.id)).toEqual([grandchild]);
    expect(cd.openProposals).toHaveLength(1);
    expect(cd.revisions).toHaveLength(1);
    expect(() => h.forum.topics.get("yok", null)).toThrow(/bulunamadı/);
  });
});
