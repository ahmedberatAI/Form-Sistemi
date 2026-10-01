// Senaryo 4: silme (karartma) yolu — acil gerekçe → daraltma → DEL oylaması (yazar seçmen değil) → sealed + mezar taşı
// + tek cevap + denetçi okuma kaydı; "Görüş ayrılığı" → inadmissible; silme limiti; red → daraltma kalkar.
import { beforeAll, describe, expect, it } from "vitest";
import { fy } from "@forum/shared";
import type { AuthUser } from "../../src/core/contracts";
import { closeVoting, insertTopic, makeForum, toVoting, type ForumHarness } from "./harness";

describe("forum: silme (karartma) yolu", () => {
  let h: ForumHarness;
  let m: AuthUser[];
  let target: AuthUser;
  let auditor: AuthUser;
  let topicId: string;

  beforeAll(async () => {
    h = await makeForum();
    m = h.users("uye", 28);
    target = h.user("hedef");
    auditor = h.user("denetci", { roles: ["auditor"] });
    topicId = insertTopic(h, "Mahalle parkı");
  });

  const del = (actor: AuthUser, ids: string[], ground: string, submit = true) =>
    h.forum.proposals.create(actor, {
      kind: "deletion",
      title: "",
      body: "",
      categories: [],
      deletion: { messageIds: ids, ground: fy(ground), statement: "Bu mesaj bir komşunun telefonunu rızası olmadan paylaşıyor." },
      submit,
    });

  it("acil gerekçe: talep anında daraltılır; DEL oylamasında yazar seçmen değildir; kabulde mühürlenir", async () => {
    await expect(
      h.forum.messages.post(target, "topic", topicId, { body: "Şikâyet için Ayşe Hanım'ı arayın: 0532 123 45 67", stance: "con" }),
    ).rejects.toMatchObject({ status: 422, code: "pii_detected" });
    const msg = await h.forum.messages.post(target, "topic", topicId, { body: "Şikâyet için Ayşe Hanım'ı arayın: 0532 123 45 67", stance: "con", acknowledgePii: true });
    expect(msg.visibility).toBe("visible");

    // Kendi mesajı için silme talebi açılamaz
    await expect(del(target, [msg.id], "KisiselVeriIfsasi")).rejects.toMatchObject({ status: 422, code: "own_message" });

    const d = await del(m[0], [msg.id], "KisiselVeriIfsasi");
    expect(d.status).toBe("sponsoring");
    expect(d.tier).toBe("DEL");
    expect(d.title).toBe("Silme talebi: 1 mesaj");
    expect(d.sponsorsRequired).toBe(1);
    expect(d.parentTopicId).toBe(topicId);
    let mv = h.forum.messages.get(msg.id, null);
    expect(mv.visibility).toBe("collapsed");
    expect(mv.body).not.toBeNull();
    expect(mv.pendingDeletionProposalId).toBe(d.id);
    // Aynı mesaj için ikinci açık talep yok
    await expect(del(m[1], [msg.id], "Spam")).rejects.toMatchObject({ status: 409, code: "already_requested" });
    // Konu sayfasında açık talep görünür
    expect(h.forum.topics.get(topicId, null).openProposals.map((p) => p.id)).toContain(d.id);

    await h.forum.proposals.sponsor(m[1], d.id);
    expect(h.forum.proposals.get(d.id, null).status).toBe("deliberation");
    // Yazar tartışma süresinde mesajını düzenleyebilir (yeni sürüm)
    const edited = await h.forum.messages.edit(target, msg.id, "Şikâyet için muhtarlığa başvurun.");
    expect(edited.version).toBe(2);

    await toVoting(h, d.id);
    const voters = h.forum.proposals.voters(d.id);
    expect(voters.eligibleCount).toBe(29); // 28 üye + denetçi; hedef yazar hariç
    expect(voters.voters.some((v) => v.userId === target.id)).toBe(false);
    await expect(h.forum.proposals.vote(target, d.id, "no")).rejects.toMatchObject({ status: 422, code: "not_eligible" });
    for (let i = 0; i < 25; i++) await h.forum.proposals.vote(m[i], d.id, i < 20 ? "yes" : "no");
    const t = await closeVoting(h, d.id);
    expect(t.map((x) => [x.from, x.to])).toEqual([["voting", "enacted"]]); // DEL: itiraz penceresi yok

    mv = h.forum.messages.get(msg.id, m[3]);
    expect(mv.visibility).toBe("sealed");
    expect(mv.body).toBeNull();
    expect(mv.tombstone).toBe(`[#K-${d.seq} kararıyla gizlendi — gerekçe: Kişisel veri ifşası]`);
    expect(mv.hiddenByProposalId).toBe(d.id);
    expect(mv.pendingDeletionProposalId).toBeNull();
    expect(h.forum.messages.list("topic", topicId, null).find((x) => x.id === msg.id)?.body).toBeNull();
    expect(h.ledger.findTxs({ type: "MESSAGE_HIDDEN" })).toHaveLength(1);
    // Fiziksel silme yok: satır ve sürümler duruyor
    expect(h.ctx.db.get<{ c: number }>("SELECT COUNT(*) AS c FROM message_versions WHERE message_id = ?", msg.id)!.c).toBe(2);

    // Gizli mesaj düzenlenemez; sürümler yalnız denetçiye
    await expect(h.forum.messages.edit(target, msg.id, "deneme metni")).rejects.toMatchObject({ status: 409 });
    expect(() => h.forum.messages.versions(m[2], msg.id)).toThrow(/denetçi/);
    expect(() => h.forum.messages.versions(null, msg.id)).toThrow();

    // Tek cevap hakkı
    expect(() => h.forum.messages.rebuttal(m[2], msg.id, "Bu benim cevabım değil ama yazayım.")).toThrow(/yazarı/);
    const withReb = h.forum.messages.rebuttal(target, msg.id, "Numara herkese açık bir ilandaydı; yine de kararı saygıyla karşılıyorum.");
    expect(withReb.rebuttal?.body).toContain("saygıyla");
    expect(() => h.forum.messages.rebuttal(target, msg.id, "İkinci bir cevap yazmak istiyorum.")).toThrow(/zaten/);

    // Denetçi okuması kayıt altına alınır
    expect(() => h.forum.messages.readHidden(m[2], msg.id)).toThrow(/denetçi/);
    const hidden = h.forum.messages.readHidden(auditor, msg.id);
    expect(hidden.body).toBe("Şikâyet için muhtarlığa başvurun.");
    expect(hidden.versions.map((v) => v.version)).toEqual([1, 2]);
    expect(hidden.accessLogged).toBe(true);
    expect(h.ctx.db.get<{ c: number }>("SELECT COUNT(*) AS c FROM hidden_access_log WHERE message_id = ? AND actor_id = ?", msg.id, auditor.id)!.c).toBe(1);
    const log = h.forum.community.auditLog({ action: "message.read_hidden" });
    expect(log).toHaveLength(1);
    expect(log[0].actorNickname).toBe("denetci");
    // Yazara bildirim gitti
    expect(h.forum.community.notifications(target.id).items.some((n) => n.kind === "message_hidden")).toBe(true);
  });

  it("“Görüş ayrılığı” gerekçesi denetimde gerekçeli olarak reddedilir (inadmissible)", async () => {
    const msg = await h.forum.messages.post(target, "topic", topicId, { body: "Bence parka bank değil spor aleti konmalı.", stance: "con" });
    const pre = await h.forum.proposals.precheck(m[4], {
      kind: "deletion",
      title: "",
      body: "",
      categories: [],
      deletion: { messageIds: [msg.id], ground: fy("GorusAyriligi"), statement: "Bu görüşe katılmıyorum, kaldırılsın lütfen." },
    });
    expect(pre.audit.admissible).toBe(false);
    expect(pre.warnings.some((w) => w.includes("Görüş ayrılığı"))).toBe(true);
    const d = await del(m[4], [msg.id], "GorusAyriligi");
    expect(h.forum.messages.get(msg.id, null).visibility).toBe("visible"); // acil değil → daraltılmaz
    const after = await h.forum.proposals.sponsor(m[5], d.id);
    expect(after.status).toBe("inadmissible");
    expect(after.events.at(-1)?.reason).toMatch(/yönetmeliğe aykırı/);
    expect(after.audit?.violations.length).toBeGreaterThan(0);
  });

  it("acil talep reddedilirse daraltma kalkar", async () => {
    const msg = await h.forum.messages.post(target, "topic", topicId, { body: "Yarın toplantıda herkesi bekliyorum, gelmeyen pişman olur!", stance: "neutral" });
    const d = await del(m[6], [msg.id], "Tehdit");
    expect(h.forum.messages.get(msg.id, null).visibility).toBe("collapsed");
    await h.forum.proposals.sponsor(m[7], d.id);
    await toVoting(h, d.id);
    for (let i = 0; i < 20; i++) await h.forum.proposals.vote(m[i], d.id, i < 5 ? "yes" : "no");
    await closeVoting(h, d.id);
    expect(h.forum.proposals.get(d.id, null).status).toBe("rejected");
    const mv = h.forum.messages.get(msg.id, null);
    expect(mv.visibility).toBe("visible");
    expect(mv.pendingDeletionProposalId).toBeNull();
  });

  it("silme talebi sınırları: açık talep ≤ 3; tek yazar; aynı tartışma", async () => {
    const msgs = [];
    for (let i = 0; i < 5; i++) msgs.push(await h.forum.messages.post(target, "topic", topicId, { body: `Spam benzeri mesaj ${i}: indirim kodu!`, stance: "neutral" }));
    const other = await h.forum.messages.post(m[9], "topic", topicId, { body: "Başka bir yazarın mesajı.", stance: "pro" });
    await expect(del(m[8], [msgs[0].id, other.id], "Spam", false)).rejects.toMatchObject({ status: 422, code: "invalid_target" });
    for (let i = 0; i < 3; i++) await del(m[8], [msgs[i].id], "Spam", false);
    await expect(del(m[8], [msgs[3].id], "Spam", false)).rejects.toMatchObject({ status: 422, code: "deletion_limit" });
    // Taslağı geri çekince yer açılır
    const drafts = h.forum.proposals.list({ mine: true, kind: "deletion", status: "draft" }, m[8]);
    expect(drafts).toHaveLength(3);
    await h.forum.proposals.withdraw(m[8], drafts[0].id);
    await del(m[8], [msgs[3].id], "Spam", false);
  });
});
