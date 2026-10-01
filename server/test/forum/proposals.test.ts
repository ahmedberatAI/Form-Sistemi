// ProposalService ayrıntıları: doğrulama biçimi, durum kuralları, sürümler, metin önerileri, hak bayrakları, bilirkişi
// talebi, liste filtreleri, ön denetim (salam uyarısı), YZ özeti, süre dolumu ve geri çekme.
import { beforeAll, describe, expect, it } from "vitest";
import { fy } from "@forum/shared";
import type { AuthUser } from "../../src/core/contracts";
import { CAT, endPhase, insertTopic, LONG_BODY, makeForum, toDeliberation, toVoting, type ForumHarness } from "./harness";

const topic = (title: string, body = LONG_BODY) => ({ kind: "topic" as const, title, body, categories: [CAT.park] });

describe("forum: öneri hizmeti ayrıntıları", () => {
  let h: ForumHarness;
  let m: AuthUser[];
  let admin: AuthUser;

  beforeAll(async () => {
    h = await makeForum();
    m = h.users("uye", 20);
    admin = h.user("yonetici", { roles: ["admin"] });
  });

  it("doğrulama hataları 400 validation ve { alan: Türkçe ileti } ayrıntısı", async () => {
    const e1 = await h.forum.proposals.create(m[0], topic("ab")).catch((e) => e);
    expect(e1).toMatchObject({ status: 400, code: "validation" });
    expect(e1.details).toEqual({ title: "Başlık en az 5 karakter olmalıdır (şu an 2)." });
    expect(e1.message).toBe("Başlık en az 5 karakter olmalıdır (şu an 2).");
    const e2 = await h.forum.proposals.create(m[0], { ...topic("Geçerli başlık"), kind: "foo" as never }).catch((e) => e);
    expect(e2.details.kind).toMatch(/Öneri türü/);
    const e3 = await h.forum.proposals.create(m[0], { ...topic("Geçerli başlık"), categories: ["fy:Yok"] }).catch((e) => e);
    expect(Object.keys(e3.details)).toEqual(["categories"]);
    const e4 = await h.forum.proposals.create(m[0], { ...topic("Geçerli başlık"), categories: 5 as never }).catch((e) => e);
    expect(e4.details.categories).toMatch(/Kategoriler geçersiz/);
    const e5 = await h.forum.proposals.create(m[0], { kind: "deletion", title: "", body: "", categories: [], deletion: { messageIds: [], ground: fy("Spam"), statement: "x" } }).catch((e) => e);
    expect(e5.details).toEqual({ "deletion.messageIds": "En az bir mesaj seçilmelidir." });
    const e6 = await h.forum.proposals.create(m[0], { kind: "subtopic", parentTopicId: "yok", title: "Alt konu başlığı", body: LONG_BODY, categories: [] }).catch((e) => e);
    expect(e6).toMatchObject({ status: 404 });
    // Doğrulanmamış üye
    await expect(h.forum.proposals.create({ ...m[0], status: "pending" }, topic("Geçerli başlık"))).rejects.toMatchObject({ status: 403 });
    // Kısa ad IRI genişletilir
    const ok = await h.forum.proposals.create(m[0], { ...topic("Kısa adla kategori"), categories: ["fy:YesilAlan"] });
    expect(ok.categories).toEqual([CAT.park]);
  });

  it("durum kuralları: destek toplamada metin kilitli; geri çekme; oylamada geri çekilemez; süre dolumu", async () => {
    const d = await h.forum.proposals.create(m[1], { ...topic("Geri çekilecek öneri"), submit: true });
    await expect(h.forum.proposals.update(m[1], d.id, { title: "Yeni başlık burada", body: LONG_BODY })).rejects.toMatchObject({ status: 409, code: "invalid_state" });
    await expect(h.forum.proposals.update(m[2], d.id, { title: "Yeni başlık burada", body: LONG_BODY })).rejects.toMatchObject({ status: 403 });
    await h.forum.proposals.sponsor(m[2], d.id);
    const w = await h.forum.proposals.withdraw(m[1], d.id);
    expect(w.status).toBe("withdrawn");
    expect(w.events.at(-1)?.reason).toBe("Yazar öneriyi geri çekti.");
    expect(h.forum.community.notifications(m[2].id).items.some((n) => n.title.includes("geri çekildi"))).toBe(true);
    await expect(h.forum.proposals.withdraw(m[1], d.id)).rejects.toMatchObject({ status: 409 });

    const e = await h.forum.proposals.create(m[3], { ...topic("Destek bulamayacak öneri"), submit: true });
    await h.forum.proposals.sponsor(m[4], e.id);
    const t = await h.advance(169);
    expect(t.find((x) => x.proposalId === e.id)?.to).toBe("expired");
    const ex = h.forum.proposals.get(e.id, null);
    expect(ex.status).toBe("expired");
    expect(ex.events.at(-1)?.reason).toMatch(/1\/3 destekçi/);
    await expect(h.forum.proposals.sponsor(m[5], e.id)).rejects.toMatchObject({ status: 409 });

    const v = await toDeliberation(h, m[5], m.slice(6), topic("Oylamaya girecek öneri"));
    await toVoting(h, v);
    await expect(h.forum.proposals.withdraw(m[5], v)).rejects.toMatchObject({ status: 409 });
    await endPhase(h, v);
  });

  it("revizyon: yeni sürüm + PROPOSAL_VERSION; yönetmeliğe aykırı revizyon reddedilir, eski metin kalır", async () => {
    const id = await toDeliberation(h, m[6], m.slice(7), topic("Parka su sebili"));
    const r = await h.forum.proposals.update(m[6], id, { title: "Parka iki su sebili", body: LONG_BODY + " İki sebil olsun." });
    expect(r.version).toBe(2);
    expect(h.ledger.findTxs({ type: "PROPOSAL_VERSION", proposalId: id })).toHaveLength(1);
    // YZ kaynaklı içerik etiketi revizyonu tek başına reddedemez (Madde 12 (2), 14 (1)): uyarı + bilirkişi incelemesi
    const ai = await h.forum.proposals.update(m[6], id, { title: "Parka iki su sebili", body: "Bu parka gelen herkesi öldüreceğim, kimse kurtulamaz; sebil falan olmaz." });
    expect(ai.version).toBe(3);
    expect(ai.audit!.admissible).toBe(true);
    expect(ai.audit!.violations).toEqual([]);
    expect(ai.audit!.warnings.some((w) => w.code.startsWith("content_label"))).toBe(true);
    expect(ai.audit!.requiresExpert).toBe(true);
    // Gerçek bir yönetmelik ihlali (üst konu artık etkin değil, Madde 10 (1)) revizyonu reddeder; eski metin kalır
    const parent = insertTopic(h, "Sebil ana konusu");
    const sub = await toDeliberation(h, m[6], m.slice(7), { kind: "subtopic", parentTopicId: parent, title: "Sebil alt konusu", body: LONG_BODY, categories: [] });
    h.ctx.db.run("UPDATE topics SET status = 'archived' WHERE id = ?", parent);
    const bad = await h.forum.proposals.update(m[6], sub, { title: "Sebil alt konusu (revize)", body: LONG_BODY + " İki sebil olsun." }).catch((e) => e);
    expect(bad).toMatchObject({ status: 422, code: "inadmissible_revision" });
    expect(bad.message).toMatch(/önceki metin geçerli kalır/);
    expect(bad.details.violations.map((v: { code: string }) => v.code)).toContain("parent_inactive");
    const after = h.forum.proposals.get(sub, null);
    expect(after.version).toBe(1);
    expect(after.body).toBe(LONG_BODY);
    // Kişisel veri revizyonda da denetlenir
    await expect(h.forum.proposals.update(m[6], id, { title: "Parka iki su sebili", body: LONG_BODY + " Bilgi: 0532 999 88 77" })).rejects.toMatchObject({ code: "pii_detected" });
  });

  it("metin önerisi: yazar kabul ederse öneren anılır; red herkese açık kalır", async () => {
    const id = await toDeliberation(h, m[7], m.slice(8), topic("Parka çeşme"));
    expect(() => h.forum.proposals.suggest(m[7], id, "Yazarın kendi önerisi olamaz.")).toThrow(/doğrudan düzenleyebilirsiniz/);
    const s1 = h.forum.proposals.suggest(m[9], id, LONG_BODY + " Çeşme engelli erişimine uygun olsun.");
    const s2 = h.forum.proposals.suggest(m[10], id, LONG_BODY + " Çeşme altın kaplama olsun.");
    expect(h.forum.community.tasks(m[7]).some((t) => t.kind === "author" && t.title.includes("2 metin önerisi"))).toBe(true);
    await expect(h.forum.proposals.decideSuggestion(m[9], id, s1.id, "accept")).rejects.toMatchObject({ status: 403 });
    const acc = await h.forum.proposals.decideSuggestion(m[7], id, s1.id, "accept");
    expect(acc.version).toBe(2);
    expect(acc.versions[1]).toMatchObject({ viaSuggestionId: s1.id, authorId: m[9].id, authorNickname: m[9].nickname });
    const rej = await h.forum.proposals.decideSuggestion(m[7], id, s2.id, "reject");
    expect(rej.suggestions.map((s) => s.status)).toEqual(["accepted", "rejected"]);
    expect(rej.version).toBe(2);
    await expect(h.forum.proposals.decideSuggestion(m[7], id, s2.id, "accept")).rejects.toMatchObject({ code: "already_decided" });
    expect(h.forum.community.notifications(m[10].id).items.some((n) => n.body.includes("ayrı bir öneri"))).toBe(true);
  });

  it("hak bayrağı: yalnızca yükseltme (üye ekler → T1; üye kaldıramaz; yönetici kaldırır)", async () => {
    const id = await toDeliberation(h, m[11], m.slice(12), topic("Parka bisiklet parkı"));
    const right = fy("MulkiyetHakki");
    const a = await h.forum.proposals.flagRight(m[12], id, { right, direction: "restrict" });
    expect(a.tier).toBe("T1");
    expect(JSON.parse(h.ctx.db.get<{ f: string }>("SELECT rights_flags AS f FROM proposals WHERE id = ?", id)!.f)).toEqual([
      { right, direction: "restrict", source: "member" },
    ]);
    await expect(h.forum.proposals.flagRight(m[12], id, { right, direction: "restrict", remove: true })).rejects.toMatchObject({ status: 403 });
    await expect(h.forum.proposals.flagRight(m[12], id, { right: fy("Yok"), direction: "restrict" })).rejects.toMatchObject({ status: 400 });
    const b = await h.forum.proposals.flagRight(admin, id, { right, direction: "restrict", remove: true });
    expect(b.tier).toBe("T0");
    expect(h.forum.community.notifications(m[11].id).items.some((n) => n.kind === "proposal_rights_flag")).toBe(true);
  });

  it("YZ: ayrımcı içerik çevrimdışı sınıflandırmayla hak bayrağı alır (ai kaynaklı, yalnız yükseltme)", async () => {
    const d = await h.forum.proposals.create(m[12], { ...topic("Parka kadın girişi", "Parka yalnızca kadınlar girebilsin ve diğerleri hariç tutulsun diye öneriyoruz."), submit: true });
    const flags = JSON.parse(h.ctx.db.get<{ f: string }>("SELECT rights_flags AS f FROM proposals WHERE id = ?", d.id)!.f);
    expect(flags).toContainEqual({ right: fy("EsitlikAyrimcilikYasagi"), direction: "restrict", source: "ai" });
    expect(d.tier).toBe("T1"); // YZ bayrağı T3'e çıkaramaz; en çok T1 + uyarı
  });

  it("bilirkişi talebi: yazar talep ederse panel gereksinimi oluşur ve kura yüksekliği taahhüt edilir", async () => {
    const id = await toDeliberation(h, m[13], m.slice(14), topic("Parka oyun alanı"));
    expect(h.ctx.db.get<{ r: number; e: number | null }>("SELECT request_expert AS r, expert_draw_height AS e FROM proposals WHERE id = ?", id)).toEqual({ r: 0, e: null });
    await h.forum.proposals.requestExpert(m[14], id, "panel");
    await expect(h.forum.proposals.requestExpert(m[14], id, "panel")).rejects.toMatchObject({ code: "already_requested" });
    await expect(h.forum.proposals.requestExpert(m[14], id, "counter")).rejects.toMatchObject({ status: 409 });
    const before = h.ledger.latestBlock().height;
    await h.forum.proposals.requestExpert(m[13], id, "panel");
    const row = h.ctx.db.get<{ r: number; e: number | null }>("SELECT request_expert AS r, expert_draw_height AS e FROM proposals WHERE id = ?", id)!;
    expect(row.r).toBe(1);
    expect(row.e).toBe(before + 1);
  });

  it("liste filtreleri: durum, tür, Türkçe büyük/küçük harf duyarsız arama, konu, yazar, benimkiler, sınır", async () => {
    const t = insertTopic(h, "Şehir meydanı");
    await h.forum.proposals.create(m[15], { kind: "subtopic", parentTopicId: t, title: "ŞEHİR meydanına ağaç", body: LONG_BODY, categories: [], submit: true });
    const all = h.forum.proposals.list({}, null);
    expect(all.map((p) => p.seq)).toEqual([...all.map((p) => p.seq)].sort((a, b) => b - a));
    expect(all.every((p) => p.status !== "draft")).toBe(true);
    expect(h.forum.proposals.list({ q: "şehir" }, null).map((p) => p.title)).toEqual(["ŞEHİR meydanına ağaç"]);
    expect(h.forum.proposals.list({ topicId: t }, null)).toHaveLength(1);
    const subs = h.forum.proposals.list({ kind: "subtopic" }, null);
    expect(subs.every((p) => p.kind === "subtopic")).toBe(true);
    expect(subs.map((p) => p.title)).toContain("ŞEHİR meydanına ağaç");
    expect(h.forum.proposals.list({ status: "closed" }, null).every((p) => ["enacted", "rejected", "inadmissible", "withdrawn", "expired"].includes(p.status))).toBe(true);
    expect(h.forum.proposals.list({ status: "open" }, null).every((p) => !["enacted", "rejected", "inadmissible", "withdrawn", "expired", "draft"].includes(p.status))).toBe(true);
    expect(h.forum.proposals.list({ status: "open" }, m[0]).some((p) => p.status === "draft")).toBe(true);
    expect(h.forum.proposals.list({ mine: true }, null)).toEqual([]);
    expect(h.forum.proposals.list({ mine: "false" as never }, m[0]).length).toBeGreaterThan(1);
    expect(h.forum.proposals.list({ mine: true }, m[15]).map((p) => p.authorId)).toEqual([m[15].id]);
    expect(h.forum.proposals.list({ authorId: m[15].id }, null)).toHaveLength(1);
    expect(h.forum.proposals.list({ limit: 2 }, null)).toHaveLength(2);
    await expect(async () => h.forum.proposals.list({ status: "bilinmeyen" as never }, null)).rejects.toMatchObject({ status: 400 });
  });

  it("ön denetim: salam taktiği uyarısı, benzerler, YZ etiketi, K_s; yan etkisiz", async () => {
    const txBefore = h.fake!.txs.length;
    const rowsBefore = h.ctx.db.get<{ c: number }>("SELECT COUNT(*) AS c FROM proposals")!.c;
    await h.forum.proposals.create(m[16], { ...topic("Parka bank konsun", "Mahalle parkına yaşlılar için yeni bank konsun ve gölgelik yapılsın."), submit: true });
    const pre = await h.forum.proposals.precheck(m[16], topic("Parka bank konsun lütfen", "Mahalle parkına yaşlılar için yeni bank konsun ve gölgelik yapılsın lütfen."));
    expect(pre.warnings.some((w) => w.includes("salam taktiği"))).toBe(true);
    expect(pre.similar[0]).toMatchObject({ sameAuthor: true });
    expect(pre.sponsorsRequired).toBe(3);
    expect(pre.classification.aiLabel).toMatch(/^Yapay zekâ ile üretildi/);
    expect(pre.audit.tier).toBe("T0");
    // Başka yazar için salam uyarısı yok
    const other = await h.forum.proposals.precheck(m[17], topic("Parka bank konsun lütfen", "Mahalle parkına yaşlılar için yeni bank konsun ve gölgelik yapılsın lütfen."));
    expect(other.warnings.some((w) => w.includes("salam"))).toBe(false);
    expect(other.similar[0].sameAuthor).toBe(false);
    // Hoşgörülü: kısa başlık hata değil
    await expect(h.forum.proposals.precheck(m[17], topic("ab", "kısa"))).resolves.toBeTruthy();
    expect(h.ctx.db.get<{ c: number }>("SELECT COUNT(*) AS c FROM proposals")!.c).toBe(rowsBefore + 1);
    expect(h.fake!.txs.length).toBe(txBefore + 2); // yalnız create+submit
  });

  it("YZ özeti: yazarlar K1, K2… olarak maskelenir; kayıt AI_ANALYSIS ile defterde; öneri ayrıntısında listelenir", async () => {
    const id = await toDeliberation(h, m[18], m.slice(0, 5), topic("Parka kamelya"));
    await h.forum.messages.post(m[1], "proposal", id, { body: "Kamelya yaz aylarında çok işe yarar.", stance: "pro" });
    await h.forum.messages.post(m[2], "proposal", id, { body: "Bakım maliyeti yüksek olur.", stance: "con" });
    await h.forum.messages.post(m[1], "proposal", id, { body: "Bakımı gönüllüler üstlenebilir.", stance: "pro" });
    const a = await h.forum.proposals.aiSummary(m[3], id);
    expect(a.task).toBe("summarize");
    expect(a.offline).toBe(true);
    expect(a.label).toMatch(/^Yapay zekâ ile üretildi · çevrimdışı sezgisel mod/);
    expect((a.output as { messageCount: number }).messageCount).toBe(3);
    expect(JSON.stringify(a.output)).not.toContain(m[1].nickname);
    const d = h.forum.proposals.get(id, null);
    expect(d.aiAnalyses.map((x) => x.id)).toContain(a.id);
    expect(h.ledger.findTxs({ type: "AI_ANALYSIS" }).some((t) => t.payload.analysisId === a.id)).toBe(true);
    // Onay: yalnız yazar; taslak seçimi yalnız köprü taslaklarında
    await expect(h.forum.proposals.approveAi(m[3], a.id)).rejects.toMatchObject({ status: 403 });
    await expect(h.forum.proposals.approveAi(m[18], a.id, 0)).rejects.toMatchObject({ status: 400 });
    expect((await h.forum.proposals.approveAi(m[18], a.id)).approvedBy).toBe(m[18].id);
    // Köprü taslakları uzlaşma dışında üretilemez
    await expect(h.forum.proposals.aiBridging(m[3], id)).rejects.toMatchObject({ status: 409 });
  });

  it("metin önerisi: karar verilmeden oylama başlarsa ya da öneri geri çekilirse 'lapsed' olur; ret de evre kuralına bağlı", async () => {
    // Oylama başlarken karar verilmemiş öneri kapanır; reddedilen öneri reddedilmiş kalır.
    const id = await toDeliberation(h, m[19], m.slice(0, 5), topic("Parka su oyun alanı"));
    const open = h.forum.proposals.suggest(m[3], id, LONG_BODY + " Su oyun alanı yazın her gün açık olsun.");
    const rej = h.forum.proposals.suggest(m[4], id, LONG_BODY + " Su oyun alanı yerine havuz yapılsın.");
    await h.forum.proposals.decideSuggestion(m[19], id, rej.id, "reject");
    await toVoting(h, id);
    const d = h.forum.proposals.get(id, null);
    expect(d.status).toBe("voting");
    expect(d.suggestions.map((s) => [s.id, s.status])).toEqual([
      [open.id, "lapsed"],
      [rej.id, "rejected"],
    ]);
    expect(d.suggestions[0].decidedAt).toBe(d.events.at(-1)?.at);
    // Kapanmış öneriye karar verilemez (ne kabul ne ret); oylamada yeni öneri de yapılamaz.
    await expect(h.forum.proposals.decideSuggestion(m[19], id, open.id, "reject")).rejects.toMatchObject({ status: 409, code: "suggestion_lapsed" });
    await expect(h.forum.proposals.decideSuggestion(m[19], id, open.id, "accept")).rejects.toMatchObject({ status: 409, code: "suggestion_lapsed" });
    expect(() => h.forum.proposals.suggest(m[5], id, LONG_BODY + " Oylamada yeni öneri olmaz.")).toThrow(/tartışma evresinde/);
    // Öneren kişiye bildirim: ayrı öneri olarak açabilir (yazarın sessiz vetosu yoktur).
    const note = h.forum.community.notifications(m[3].id).items.find((n) => n.title.includes("karar verilmeden kapandı"));
    expect(note?.body).toMatch(/Oylama başladığı için.*ayrı bir öneri/);
    expect(h.forum.community.notifications(m[4].id).items.some((n) => n.title.includes("karar verilmeden kapandı"))).toBe(false);

    // Eski veri: evre kapandığı hâlde "open" kalmış satır "lapsed" gösterilir ve ret evre kuralına takılır.
    h.ctx.db.run("UPDATE proposal_suggestions SET status = 'open', decided_at = NULL WHERE id = ?", open.id);
    expect(h.forum.proposals.get(id, null).suggestions.find((s) => s.id === open.id)?.status).toBe("lapsed");
    await expect(h.forum.proposals.decideSuggestion(m[19], id, open.id, "reject")).rejects.toMatchObject({ status: 409, code: "invalid_state" });

    // Geri çekilen öneride de açık öneriler kapanır.
    const w = await toDeliberation(h, m[13], m.slice(5, 10), topic("Parka kitap kutusu"));
    const s = h.forum.proposals.suggest(m[6], w, LONG_BODY + " Kitap kutusu yağmura dayanıklı olsun.");
    await h.forum.proposals.withdraw(m[13], w);
    expect(h.forum.proposals.get(w, null).suggestions.map((x) => [x.id, x.status])).toEqual([[s.id, "lapsed"]]);
    expect(h.forum.community.notifications(m[6].id).items.find((n) => n.title.includes("karar verilmeden kapandı"))?.body).toMatch(/Geri çekildi/);
  });
});
