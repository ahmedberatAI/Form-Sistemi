// Keşif servisi (forum/discovery.ts): önerili arama (sıra, Türkçe eşleşme, görünürlük, 'Tüm önerilerde ara' sayısı), Listem
// (idempotentlik, yetki, gizlilik), kişisel sıra (aynı küme, soğuk başlangıç, son açılanlar, katılınmış öneri, açık bölüm = pano,
// rıza ve "Kişisel sıralama" tercihi), pano ("Sizi bekleyenler" etkilenmez), oy verisinden bağımsızlık, sinyal önbelleği (imha
// kancası, süre), KVKK dökümü ve hesap silme (aynı işlemde).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { type ProposalDetail, type ProposalSummary } from "@forum/shared";
import { HOUR } from "../../src/core/clock";
import { SIGNAL_CACHE_TTL_MS } from "../../src/forum/discovery";
import { STALE_PENDING_MS } from "../../src/identity";
import { SERVER_ROOT } from "../../src/core/config";
import type { AuthUser } from "../../src/core/contracts";
import { regInput } from "../identity/fixtures";
import { CAT, insertTopic, LONG_BODY, makeForum, toDeliberation, toVoting, type ForumHarness } from "./harness";

const create = (h: ForumHarness, author: AuthUser, title: string, categories: string[], submit = true): Promise<ProposalDetail> =>
  h.forum.proposals.create(author, { kind: "topic", title, body: LONG_BODY, categories, submit });

const sorted = (xs: string[]) => [...xs].sort();

describe("önerili arama", () => {
  let h: ForumHarness;
  let ayse: AuthUser;
  let bora: AuthUser;
  let isik: ProposalDetail;
  let sokak: ProposalDetail;
  let park: ProposalDetail;
  let taslak: ProposalDetail;
  let konu: string;

  beforeAll(async () => {
    h = await makeForum();
    ayse = h.user("ayse_arama");
    bora = h.user("bora_arama");
    isik = await create(h, ayse, "Işıklandırma projesi için güneş paneli", [CAT.enerji]);
    h.ctx.clock.advance(HOUR);
    sokak = await create(h, ayse, "Sokak ışıklarının bakımı", [CAT.enerji]);
    h.ctx.clock.advance(HOUR);
    park = await create(h, ayse, "Parka gölgelik ve bank", [CAT.park]);
    taslak = await create(h, bora, "Gizli ışık taslağı", [CAT.enerji], false);
    konu = insertTopic(h, "Işık kirliliği ilkeleri", [CAT.cevre]);
  });
  afterAll(() => h.close());

  it("Türkçe duyarsız eşleşme ve sıra: başlıyor > kelime başı > içinde geçiyor; eşitlikte açık ve yeni önce", () => {
    const r = h.forum.discovery.search("ISIK", undefined, ayse);
    expect(r.q).toBe("ISIK");
    expect(r.items.map((i) => [i.type, i.title, i.match])).toEqual([
      ["topic", "Işık kirliliği ilkeleri", "prefix"],
      ["proposal", "Işıklandırma projesi için güneş paneli", "prefix"],
      ["proposal", "Sokak ışıklarının bakımı", "word"],
    ]);
    expect(r.total).toEqual({ proposals: 2, topics: 1 });
    // Aynı arama farklı yazımlarla aynı sonucu verir.
    for (const q of ["ışık", "isik", "IŞIK", "Işık"]) expect(h.forum.discovery.search(q, undefined, ayse).items.map((i) => i.id)).toEqual(r.items.map((i) => i.id));
    expect(h.forum.discovery.search("gölge", undefined, null).items.map((i) => [i.id, i.match])).toEqual([[park.id, "word"]]);
    expect(h.forum.discovery.search("arka", undefined, null).items.map((i) => [i.id, i.match])).toEqual([[park.id, "contains"]]);
  });

  it("numara araması: #K, K-, #T; açık numara başlıkta aranmaz; numara eşleşmesi en üstte", () => {
    const k = h.forum.discovery.search(`#K${sokak.seq}`, undefined, null);
    expect(k.items).toEqual([expect.objectContaining({ type: "proposal", id: sokak.id, match: "ref", status: "sponsoring", kind: "topic", open: true })]);
    expect(h.forum.discovery.search(`k-${park.seq}`, undefined, null).items.map((i) => i.id)).toEqual([park.id]);
    const t = h.forum.discovery.search("#T1", undefined, null);
    expect(t.items).toEqual([expect.objectContaining({ type: "topic", id: konu, match: "ref", status: "active", open: true })]);
    expect(h.forum.discovery.search("#K9999", undefined, null).items).toEqual([]);
    // Yalın rakam: hem numara hem başlık (numara eşleşmesi önce).
    const bare = h.forum.discovery.search(String(isik.seq), undefined, null);
    expect(bare.items[0]).toMatchObject({ match: "ref", seq: isik.seq });
  });

  it("görünürlük: başkasının taslağı hiç çıkmaz (numarayla da); yazar kendi taslağını bulur", () => {
    const seen = (viewer: AuthUser | null, q: string) => h.forum.discovery.search(q, undefined, viewer).items.map((i) => i.id);
    expect(seen(null, "gizli")).toEqual([]);
    expect(seen(ayse, "gizli")).toEqual([]);
    expect(seen(ayse, `#K${taslak.seq}`)).toEqual([]);
    expect(h.forum.discovery.search("ışık", undefined, ayse).total.proposals).toBe(2);
    expect(seen(bora, "gizli")).toEqual([taslak.id]);
    expect(h.forum.discovery.search(`#K-${taslak.seq}`, undefined, bora).items).toEqual([expect.objectContaining({ id: taslak.id, status: "draft", open: true })]);
  });

  it("'Tüm önerilerde ara' sayısı (total.proposals) Öneriler sayfasının süzgeciyle aynı kural: kelimeler sırasız, yazar adı da sayılır", () => {
    // "panel güneş" başlıkta ters sırada geçer: sonuç da toplam da 1
    const reversed = h.forum.discovery.search("panel güneş", undefined, null);
    expect(reversed.items.map((i) => i.id)).toEqual([isik.id]);
    expect(reversed.total.proposals).toBe(1);
    // Yazar adı başlıkta yok: sonuç satırı çıkmaz ama Öneriler sayfasında listelenecek 3 öneri sayılır (bora'nın taslağı ayşe'ye görünmez)
    const byAuthor = h.forum.discovery.search("ayse_ara", undefined, ayse);
    expect(byAuthor.items).toEqual([]);
    expect(byAuthor.total.proposals).toBe(3);
    expect(h.forum.discovery.search("bora_ara", undefined, ayse).total.proposals).toBe(0);
    expect(h.forum.discovery.search("bora_ara", undefined, bora).total.proposals).toBe(1);
  });

  it("2 karakterden kısa metin boş; limit en çok 8 ve sonucu keser (toplam kesilmez)", () => {
    expect(h.forum.discovery.search("ı", undefined, null)).toEqual({ q: "ı", items: [], total: { proposals: 0, topics: 0 } });
    expect(h.forum.discovery.search("  ", undefined, null).items).toEqual([]);
    const one = h.forum.discovery.search("ışık", 1, ayse);
    expect(one.items).toHaveLength(1);
    expect(one.total).toEqual({ proposals: 2, topics: 1 });
    expect(h.forum.discovery.search("ışık", 50, ayse).items).toHaveLength(3);
  });
});

describe("Listem", () => {
  let h: ForumHarness;
  let ayse: AuthUser;
  let bora: AuthUser;
  let p1: ProposalDetail;
  let taslak: ProposalDetail;
  let konu: string;

  beforeAll(async () => {
    h = await makeForum();
    ayse = h.user("ayse_liste");
    bora = h.user("bora_liste");
    p1 = await create(h, bora, "Kütüphane çalışma saatleri", [CAT.cevre]);
    taslak = await create(h, bora, "Bora'nın taslağı", [CAT.spor], false);
    konu = insertTopic(h, "Mahalle kütüphanesi", [CAT.cevre]);
  });
  afterAll(() => h.close());

  it("ekleme idempotenttir: ikinci istek savedAt'i değiştirmez; detayda 'saved' yalnız sahibine", () => {
    const t0 = h.ctx.clock.now();
    expect(h.forum.discovery.setSaved(ayse, "proposal", p1.id, true)).toEqual({ type: "proposal", id: p1.id, saved: true, savedAt: t0 });
    h.ctx.clock.advance(HOUR);
    expect(h.forum.discovery.setSaved(ayse, "proposal", p1.id, true)).toEqual({ type: "proposal", id: p1.id, saved: true, savedAt: t0 });
    expect(h.forum.discovery.setSaved(ayse, "topic", konu, true).saved).toBe(true);
    expect(h.forum.proposals.get(p1.id, ayse).saved).toBe(true);
    expect(h.forum.proposals.get(p1.id, bora).saved).toBe(false);
    expect("saved" in h.forum.proposals.get(p1.id, null)).toBe(false);
    expect(h.forum.topics.get(konu, ayse).saved).toBe(true);
    expect(h.forum.topics.get(konu, bora).saved).toBe(false);
    expect(Number(h.ctx.db.get<{ c: number }>("SELECT COUNT(*) AS c FROM saved_items WHERE user_id = ?", ayse.id)!.c)).toBe(2);
  });

  it("başkasının taslağı ve olmayan hedef eklenemez (404); yazar kendi taslağını ekleyebilir", () => {
    expect(() => h.forum.discovery.setSaved(ayse, "proposal", taslak.id, true)).toThrow(expect.objectContaining({ status: 404, code: "not_found" }));
    expect(() => h.forum.discovery.setSaved(ayse, "topic", "yok-boyle-konu", true)).toThrow(expect.objectContaining({ status: 404 }));
    expect(() => h.forum.discovery.setSaved(ayse, "proposal", konu, true)).toThrow(expect.objectContaining({ status: 404 })); // tür karışmaz
    expect(h.forum.discovery.setSaved(bora, "proposal", taslak.id, true).saved).toBe(true);
  });

  it("liste yalnız sahibine: herkes kendi kayıtlarını görür (en son eklenen önce)", () => {
    const mine = h.forum.discovery.saved(ayse.id);
    expect(mine.items.map((i) => [i.type, i.id])).toEqual([
      ["topic", konu],
      ["proposal", p1.id],
    ]);
    const first = mine.items[1];
    expect(first.type === "proposal" && first.proposal.title).toBe("Kütüphane çalışma saatleri");
    const theirs = h.forum.discovery.saved(bora.id);
    expect(theirs.items.map((i) => i.id)).toEqual([taslak.id]);
    expect(h.forum.discovery.saved(h.user("bos_liste").id).items).toEqual([]);
  });

  it("çıkarma idempotenttir ve hedefin varlığını belli etmez", () => {
    expect(h.forum.discovery.setSaved(ayse, "proposal", p1.id, false)).toEqual({ type: "proposal", id: p1.id, saved: false, savedAt: null });
    expect(h.forum.discovery.setSaved(ayse, "proposal", p1.id, false)).toEqual({ type: "proposal", id: p1.id, saved: false, savedAt: null });
    expect(h.forum.discovery.setSaved(ayse, "proposal", taslak.id, false).saved).toBe(false);
    expect(h.forum.discovery.saved(ayse.id).items.map((i) => i.id)).toEqual([konu]);
    // Başkasının çıkarma isteği sahibinin kaydına dokunmaz.
    expect(h.forum.discovery.setSaved(ayse, "proposal", taslak.id, false).saved).toBe(false);
    expect(h.forum.discovery.saved(bora.id).items.map((i) => i.id)).toEqual([taslak.id]);
  });

  it("liste dolunca 422 saved_limit", () => {
    const u = h.user("dolu_liste");
    for (let i = 0; i < 500; i++) h.ctx.db.run("INSERT INTO saved_items(user_id, target_type, target_id, created_at) VALUES (?, 'topic', ?, 1)", u.id, `x${i}`);
    expect(() => h.forum.discovery.setSaved(u, "topic", konu, true)).toThrow(expect.objectContaining({ status: 422, code: "saved_limit" }));
    h.ctx.db.run("DELETE FROM saved_items WHERE user_id = ? AND target_id = 'x0'", u.id);
    expect(h.forum.discovery.setSaved(u, "topic", konu, true).saved).toBe(true);
  });
});

describe("kişisel sıra ve pano", () => {
  let h: ForumHarness;
  let yazar: AuthUser;
  /** Enerji konusunu listesine eklemiş (önerilerin hiçbirine katılmamış) okur: ilgi profili Enerji */
  let okuyucu: AuthUser;
  let enerjiler: ProposalDetail[];
  let park: ProposalDetail;
  let spor: ProposalDetail;
  let list: ProposalSummary[];

  beforeAll(async () => {
    h = await makeForum();
    yazar = h.user("enerji_yazari");
    okuyucu = h.user("enerji_okuyucu");
    const diger = h.user("diger_yazar");
    park = await create(h, diger, "Parka yeni fidanlar", [CAT.park]);
    h.ctx.clock.advance(HOUR);
    spor = await create(h, diger, "Spor sahası aydınlatması", [CAT.spor]);
    h.ctx.clock.advance(HOUR);
    enerjiler = [];
    for (let i = 0; i < 3; i++) enerjiler.push(await create(h, yazar, `Güneş enerjisi önerisi ${i + 1}`, [CAT.enerji]));
    h.ctx.clock.advance(HOUR);
    h.forum.discovery.setSaved(okuyucu, "topic", insertTopic(h, "Mahallede enerji verimliliği", [CAT.enerji]), true);
    list = h.forum.proposals.list({}, null);
  });
  afterAll(() => h.close());

  it("oturum yok ya da profil boş: varsayılan sıra aynen (personalized: false)", () => {
    for (const viewer of [null, h.user("yeni_uye")]) {
      const r = h.forum.discovery.personalize(viewer, list);
      expect(r.personalized).toBe(false);
      expect(r.items.map((i) => i.id)).toEqual(list.map((p) => p.id));
      expect(r.items.every((i) => i.score === null && i.reason === null)).toBe(true);
    }
  });

  it("profil varsa yalnız sıra değişir: aynı küme, ilgi alanı önde, her öğede gerekçe", () => {
    const r = h.forum.discovery.personalize(okuyucu, list);
    expect(r.personalized).toBe(true);
    expect(sorted(r.items.map((i) => i.id))).toEqual(sorted(list.map((p) => p.id)));
    expect(r.items.slice(0, 3).map((i) => i.id).sort()).toEqual(enerjiler.map((p) => p.id).sort());
    expect(r.items[0].reason).toEqual(expect.objectContaining({ kind: "interest", text: "Enerji (Çevre) ile ilgilendiğiniz için" }));
    expect(r.items.every((i) => i.reason !== null && typeof i.score === "number")).toBe(true);
    // Özet alanları korunur.
    expect(r.items[0]).toMatchObject({ title: expect.stringContaining("Güneş enerjisi"), authorNickname: "enerji_yazari" });
  });

  it("katılınmış öneri (kendi yazdıkları) ilgi puanı almaz: kişiye zaten bildiği başta gösterilmez; gerekçesi 'Katıldığınız öneri'", () => {
    const r = h.forum.discovery.personalize(yazar, list);
    expect(r.personalized).toBe(true);
    expect(sorted(r.items.map((i) => i.id))).toEqual(sorted(list.map((p) => p.id)));
    // Yazarın profili Enerji (Çevre): görülmemiş Çevre önerisi (park) kendi önerilerinin önündedir
    expect(r.items[0].id).toBe(park.id);
    for (const p of enerjiler) expect(["engaged", "urgent"]).toContain(r.items.find((i) => i.id === p.id)?.reason?.kind);
    expect(r.items.filter((i) => i.reason?.kind === "engaged").length).toBeGreaterThan(0);
  });

  it("açık (süren) öneriler önce ve panodaki 'Şu an açık' ile AYNI sırada; kapanmış öneriler arkada", async () => {
    const kapali = await create(h, h.user("kapanan_yazar"), "Enerji tasarrufu (geri çekildi)", [CAT.enerji]);
    h.ctx.db.run("UPDATE proposals SET status = 'withdrawn', phase_ends_at = NULL WHERE id = ?", kapali.id);
    const all = h.forum.proposals.list({}, null);
    const r = h.forum.discovery.personalize(okuyucu, all);
    const statuses = r.items.map((i) => i.status);
    const firstClosed = statuses.findIndex((s) => s === "withdrawn");
    expect(firstClosed).toBe(statuses.length - 1);
    const dash = h.forum.community.dashboard(okuyucu);
    expect(dash.openPersonalized).toBe(true);
    expect(dash.open.map((p) => [p.id, p.score, p.reason])).toEqual(
      r.items.filter((i) => i.status !== "withdrawn").slice(0, 10).map((p) => [p.id, p.score, p.reason]),
    );
  });

  it("son açılanlar (cihazdan geçici girdi) profili oluşturur; başkasının taslağı ve bilinmeyen kimlik yok sayılır", async () => {
    const okur = h.user("okur");
    expect(h.forum.discovery.personalize(okur, list, [park.id]).items[0].id).toBe(park.id);
    expect(h.forum.discovery.personalize(okur, list, [spor.id]).items[0].id).toBe(spor.id);
    const gizli = await create(h, h.user("taslakci"), "Gizli spor taslağı", [CAT.spor], false);
    expect(h.forum.discovery.personalize(okur, list, [gizli.id, "00000000-0000-4000-8000-000000000000"]).personalized).toBe(false);
    // Sunucuda iz kalmaz: okurun sinyal kaynakları boş.
    expect(h.forum.discovery.saved(okur.id).items).toEqual([]);
  });

  it("listeye ekleme önbelleği hemen düşürür ve 'Listenizde' gerekçesi verir", () => {
    const u = h.user("listeci");
    expect(h.forum.discovery.personalize(u, list).personalized).toBe(false);
    h.forum.discovery.setSaved(u, "proposal", spor.id, true);
    const r = h.forum.discovery.personalize(u, list);
    expect(r.personalized).toBe(true);
    expect(r.items[0]).toMatchObject({ id: spor.id, reason: { kind: "saved", text: "Listenizde" } });
  });

  it("siyasi görüş rızası yoksa ya da 'Kişisel sıralama' kapalıysa: varsayılan sıra (son açılanlar tek başına da); açılınca hemen kişisel", () => {
    const rizasiz = h.user("rizasiz_okur", { politicalConsent: false });
    h.forum.discovery.setSaved(rizasiz, "proposal", spor.id, true);
    const cached = h.forum.discovery.signalCacheSize();
    for (const recent of [[], [park.id]]) {
      const r = h.forum.discovery.personalize(rizasiz, list, recent);
      expect(r.personalized).toBe(false);
      expect(r.items.map((i) => i.id)).toEqual(list.map((p) => p.id));
      expect(r.items.every((i) => i.score === null && i.reason === null)).toBe(true);
      expect(h.forum.community.dashboard(rizasiz, { recent }).openPersonalized).toBe(false);
    }
    expect(h.forum.discovery.signalCacheSize(), "rızası olmayanın sinyali hiç okunmaz").toBe(cached);

    const tercihli = h.user("tercih_kapatan");
    h.forum.discovery.setSaved(tercihli, "proposal", spor.id, true);
    expect(h.forum.discovery.personalize(tercihli, list).personalized).toBe(true);
    expect(h.identity.setConsents(tercihli.id, { personalRanking: false }).personalRanking).toBe(false);
    expect(h.forum.discovery.personalize(tercihli, list, [park.id]).personalized).toBe(false);
    expect(h.forum.community.dashboard(tercihli).openPersonalized).toBe(false);
    expect(h.identity.setConsents(tercihli.id, { personalRanking: true }).personalRanking).toBe(true);
    expect(h.forum.discovery.personalize(tercihli, list).personalized).toBe(true);
    // Rıza geri alınınca tercih açık olsa da kişisel sıra yok
    h.identity.setConsents(tercihli.id, { politicalConsent: false });
    expect(h.forum.discovery.personalize(tercihli, list).personalized).toBe(false);
    // Tercih değişikliği denetim günlüğünde (rıza değişiklikleriyle aynı kayıt)
    const logs = h.ctx.db.all<{ meta: string | null }>("SELECT meta FROM audit_log WHERE action = 'identity.consents' AND actor_id = ?", tercihli.id);
    expect(logs.some((l) => (l.meta ?? "").includes("personalRanking"))).toBe(true);
  });

  it("pano: 'Şu an açık' profil varsa kişisel sırada (gerekçeli), yoksa evre bitişine göre; 'Sizi bekleyenler' etkilenmez", () => {
    const cold = h.forum.community.dashboard(h.user("soguk"));
    expect(cold.openPersonalized).toBe(false);
    const ends = cold.open.map((p) => p.phaseEndsAt ?? Number.MAX_SAFE_INTEGER);
    expect(ends).toEqual([...ends].sort((a, b) => a - b));
    expect(cold.open.every((p) => p.reason === undefined)).toBe(true);

    const anon = h.forum.community.dashboard(null);
    expect(anon.openPersonalized).toBe(false);
    expect(anon.open.map((p) => p.id)).toEqual(cold.open.map((p) => p.id));

    const warm = h.forum.community.dashboard(okuyucu, { recent: [] });
    expect(warm.openPersonalized).toBe(true);
    expect(sorted(warm.open.map((p) => p.id))).toEqual(sorted(cold.open.map((p) => p.id)));
    expect(warm.open.slice(0, 3).map((p) => p.id).sort()).toEqual(enerjiler.map((p) => p.id).sort());
    expect(warm.open.every((p) => p.reason && typeof p.score === "number")).toBe(true);
    expect(warm.tasks).toEqual(h.forum.community.tasks(okuyucu));
    expect(warm.counts).toEqual(cold.counts);
  });
});

describe("oy verisi kişisel sıraya HİÇ girmez", () => {
  it("aynı etkileşimler + farklı oylar (evet / hayır / oy yok) → aynı sıra, puan ve gerekçe", async () => {
    const h = await makeForum();
    try {
      const yazar = h.user("oy_yazar");
      const destekciler = h.users("oy_destek", 6);
      const [evetci, hayirci, oysuz] = [h.user("evetci"), h.user("hayirci"), h.user("oysuz")];
      const oylanan = await toDeliberation(h, yazar, destekciler, { title: "Parka bank ve çeşme", categories: [CAT.park] });
      await toVoting(h, oylanan);
      const enerji = await create(h, yazar, "Okul çatısına güneş paneli", [CAT.enerji]);
      const spor = await create(h, yazar, "Mahalle spor turnuvası", [CAT.spor]);
      const ulasim = await create(h, yazar, "Gece otobüs seferleri", [CAT.ulasim]);

      // Aynı anda, aynı etkileşimler (saat ilerlemez: zaman damgaları da aynı). Mesajların tutumu (stance) da farklıdır: tutum bir
      // görüş bildirimidir ve sıralamaya girmez — yalnız mesaj yazılmış olması sayılır.
      const stances = new Map([
        [evetci, "pro"],
        [hayirci, "con"],
        [oysuz, "question"],
      ] as const);
      for (const [u, stance] of stances) {
        h.forum.discovery.setSaved(u, "proposal", enerji.id, true);
        await h.forum.messages.post(u, "proposal", spor.id, { body: "Turnuva takvimi okul tatiline denk gelmeli.", stance });
      }
      // Yalnız oylar farklı: oylananın kategorisi (Park) profile oy yoluyla girerse sıra değişirdi.
      await h.forum.proposals.vote(evetci, oylanan, "yes");
      await h.forum.proposals.vote(hayirci, oylanan, "no");
      await h.forum.proposals.vote(hayirci, oylanan, "abstain");
      await h.forum.proposals.vote(hayirci, oylanan, "no");
      expect(Number(h.ctx.db.get<{ c: number }>("SELECT COUNT(*) AS c FROM ballots WHERE proposal_id = ?", oylanan)!.c)).toBe(2);

      const list = h.forum.proposals.list({}, null);
      const a = h.forum.discovery.personalize(evetci, list);
      const b = h.forum.discovery.personalize(hayirci, list);
      const c = h.forum.discovery.personalize(oysuz, list);
      expect(a.personalized).toBe(true);
      expect(b).toEqual(a);
      expect(c).toEqual(a);
      const dash = (u: AuthUser) => h.forum.community.dashboard(u).open.map((p) => [p.id, p.score, p.reason]);
      expect(dash(hayirci)).toEqual(dash(evetci));
      expect(dash(oysuz)).toEqual(dash(evetci));
      // Oylanan öneri (yalnız oy etkileşimi var) ilgi gerekçesi almaz.
      expect(a.items.find((i) => i.id === oylanan)?.reason?.kind).not.toBe("interest");
      expect(a.items.map((i) => i.id)).toContain(ulasim.id);
    } finally {
      await h.close();
    }
  });

  it("sinyal sorgusu ve saf işlev oy/itiraz/azınlık raporu/destek-tutum tablolarına hiç dokunmaz (kaynak taraması)", () => {
    const code = (rel: string) =>
      readFileSync(join(SERVER_ROOT, "..", rel), "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/^\s*\/\/.*$/gm, "")
        .replace(/\/\/[^\n"`]*$/gm, "");
    for (const rel of ["server/src/forum/discovery.ts", "shared/src/recommend.ts"]) {
      const src = code(rel);
      expect(src.length, rel).toBeGreaterThan(1000);
      expect(src, rel).not.toMatch(/\b(ballots?|eligible_voters|objections?|minority_reports?|message_endorsements|stance|choice|vote|tallies)\b/i);
    }
  });
});

describe("sinyal önbelleği: süre, temizlik ve imha kancası", () => {
  let h: ForumHarness;
  let p: ProposalDetail;
  let list: ProposalSummary[];

  beforeAll(async () => {
    h = await makeForum();
    p = await create(h, h.user("onbellek_yazar"), "Bisiklet park yerleri", [CAT.ulasim]);
    list = h.forum.proposals.list({}, null);
  });
  afterAll(() => h.close());

  it("önbellek kullanılır; süresi (simüle saat) dolunca yeniden okunur ve sweepCache süresi dolanları boşta da atar", () => {
    const u = h.user("onbellekli");
    h.forum.discovery.setSaved(u, "topic", insertTopic(h, "Ulaşım konusu", [CAT.ulasim]), true);
    expect(h.forum.discovery.personalize(u, list).personalized).toBe(true);
    const size = h.forum.discovery.signalCacheSize();
    expect(size).toBeGreaterThan(0);
    // Doğrudan veritabanına yazılan kayıt (önbellek düşürülmeden) süre dolana dek görünmez
    h.ctx.db.run("INSERT INTO saved_items(user_id, target_type, target_id, created_at) VALUES (?, 'proposal', ?, ?)", u.id, p.id, h.ctx.clock.now());
    expect(h.forum.discovery.personalize(u, list).items[0].reason?.kind).not.toBe("saved");
    h.forum.discovery.sweepCache();
    expect(h.forum.discovery.signalCacheSize(), "süresi dolmayan kayıt kalır").toBe(size);
    h.ctx.clock.advance(SIGNAL_CACHE_TTL_MS + 1);
    h.forum.discovery.sweepCache();
    expect(h.forum.discovery.signalCacheSize(), "süresi dolan kayıt istek beklemeden atılır").toBe(0);
    expect(h.forum.discovery.personalize(u, list).items[0]).toMatchObject({ id: p.id, reason: { kind: "saved" } });
  });

  it("gerçek saatle de sınırlı: simüle saat dursa bile 60 sn sonra geçersiz", () => {
    const u = h.user("gercek_saat");
    h.forum.discovery.setSaved(u, "topic", insertTopic(h, "Toplu taşıma konusu", [CAT.ulasim]), true);
    h.forum.discovery.personalize(u, list);
    expect(h.forum.discovery.signalCacheSize()).toBeGreaterThan(0);
    const real = Date.now();
    const spy = vi.spyOn(Date, "now").mockReturnValue(real + SIGNAL_CACHE_TTL_MS + 1);
    try {
      h.forum.discovery.sweepCache();
      expect(h.forum.discovery.signalCacheSize()).toBe(0);
    } finally {
      spy.mockRestore();
    }
  });

  it("hesap silme, kayıt memuru reddi ve bayat başvuru imhası önbelleği hemen düşürür (onErased kancası)", async () => {
    const forget = vi.spyOn(h.forum.discovery, "forgetCache");
    try {
      const silinen = h.user("onbellek_silinen");
      await h.identity.eraseSelf(silinen.id);
      expect(forget).toHaveBeenCalledWith(silinen.id);

      const memur = h.user("onbellek_memur", { roles: ["member", "registrar"] });
      const red = (await h.identity.register(regInput())).user;
      h.forum.discovery.setSaved({ ...silinen, id: red.id, status: "pending" }, "topic", insertTopic(h, "Başvuru sahibinin konusu", [CAT.ulasim]), true);
      await h.identity.verify(memur.id, red.id, "reject");
      expect(forget).toHaveBeenCalledWith(red.id);
      expect(Number(h.ctx.db.get<{ c: number }>("SELECT COUNT(*) AS c FROM saved_items WHERE user_id = ?", red.id)!.c)).toBe(0);

      const bayat = (await h.identity.register(regInput())).user;
      h.identity.purgeStalePending();
      expect(h.identity.purgeStalePending(-1)).toBeGreaterThanOrEqual(1);
      expect(forget).toHaveBeenCalledWith(bayat.id);
      expect(STALE_PENDING_MS).toBeGreaterThan(0);
    } finally {
      forget.mockRestore();
    }
  });
});

describe("KVKK dökümü ve hesap silme", () => {
  let h: ForumHarness;
  let u: AuthUser;
  let baska: AuthUser;
  let p: ProposalDetail;
  let konu: string;

  beforeAll(async () => {
    h = await makeForum();
    u = h.user("silinecek_uye");
    baska = h.user("kalan_uye");
    p = await create(h, baska, "Bisiklet yolu önerisi", [CAT.ulasim]);
    konu = insertTopic(h, "Bisiklet ağı", [CAT.ulasim]);
    h.forum.discovery.setSaved(u, "proposal", p.id, true);
    h.ctx.clock.advance(HOUR);
    h.forum.discovery.setSaved(u, "topic", konu, true);
    h.forum.discovery.setSaved(baska, "topic", konu, true);
  });
  afterAll(() => h.close());

  it("döküm Listem kayıtlarını, 'Kişisel sıralama' tercihini ve hukuki sebebi (md. 6/3-a) içerir (yalnız kişinin kendi kayıtları)", () => {
    const d = h.identity.exportOwnData(u.id) as {
      savedItems: { targetType: string; targetId: string; createdAt: number }[];
      consents: { personalRanking: boolean };
      processing: { data: string; legalBasis?: string }[];
    };
    expect(d.consents.personalRanking).toBe(true);
    const row = d.processing.find((x) => x.data.startsWith("Listem kayıtları"));
    expect(row?.legalBasis).toMatch(/md\. 6\/3-a/);
    expect(row?.legalBasis).not.toMatch(/5\/2-c/);
    expect(d.savedItems).toEqual([
      { targetType: "proposal", targetId: p.id, createdAt: expect.any(Number) },
      { targetType: "topic", targetId: konu, createdAt: expect.any(Number) },
    ]);
    const other = h.identity.exportOwnData(baska.id) as { savedItems: unknown[] };
    expect(other.savedItems).toHaveLength(1);
  });

  it("imha işlemi geri alınırsa kayıtlar da kalır (aynı işlem); imhada silinir, başkalarınınki kalır", async () => {
    const count = (id: string) => Number(h.ctx.db.get<{ c: number }>("SELECT COUNT(*) AS c FROM saved_items WHERE user_id = ?", id)!.c);
    let pending: Promise<void> | undefined;
    expect(() =>
      h.ctx.db.tx(() => {
        pending = h.identity.eraseSelf(u.id);
        expect(count(u.id)).toBe(0); // işlemin içinde silindi
        throw new Error("geri al");
      }),
    ).toThrow("geri al");
    await pending;
    expect(count(u.id)).toBe(2);
    expect(h.ctx.db.get<{ status: string }>("SELECT status FROM users WHERE id = ?", u.id)!.status).toBe("verified");

    await h.identity.eraseSelf(u.id);
    expect(count(u.id)).toBe(0);
    expect(count(baska.id)).toBe(1);
    expect(h.forum.discovery.saved(u.id).items).toEqual([]);
  });
});
