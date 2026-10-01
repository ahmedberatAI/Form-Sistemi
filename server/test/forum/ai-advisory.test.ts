// YZ danışmanlığının öneri akışındaki etkisi (kabul denetimi bulguları 3, 15, 26):
// - içerik etiketi güveni modelin/sezgiselin KENDİ güvenidir (risk düzeyinden türetilmez);
// - grupları destekleyen ya da bir projeyi eleştiren metinler içerik etiketi almaz;
// - YZ özetinin azınlık bölümü nüfusa göre en küçük anlamlı kümeyi, azınlık raporunu ve köprü testini geçemeyen
//   kümenin "hayır" tarafını gösterir (#K-28 vitrin örneği).
import { beforeAll, describe, expect, it } from "vitest";
import { clusterLabel, fy, type AiCitedPoint } from "@forum/shared";
import type { AuthUser } from "../../src/core/contracts";
import { CAT, closeVoting, LONG_BODY, makeBlocks, makeForum, seedHistory, toDeliberation, toVoting, type Blocks, type ForumHarness } from "./harness";

const labelsOf = (h: ForumHarness, id: string) =>
  JSON.parse(h.ctx.db.get<{ c: string }>("SELECT content_labels AS c FROM proposals WHERE id = ?", id)!.c) as { label: string; confidence: number; source: string }[];

describe("forum: YZ içerik etiketleri (çevrimdışı)", () => {
  let h: ForumHarness;
  let m: AuthUser[];

  beforeAll(async () => {
    h = await makeForum();
    m = h.users("uye", 6);
  });

  const audited: [string, string, string][] = [
    [
      "göçmen çocuklar",
      "Göçmen çocuklar için hafta sonu Türkçe kursu",
      "Göçmen çocukların okul dışında kalmasını istemiyoruz. Hafta sonları mahalle kütüphanesinde ücretsiz Türkçe kursu açılsın.",
    ],
    ["kadınlar", "Parklarda gece aydınlatması", "Kadınların gece parktan geçerken kendini güvensiz hissetmesini istemiyoruz. Park yollarına ek aydınlatma yapılsın."],
    ["proje eleştirisi", "Park projesi yerine oyun alanı", "Belediyenin bu saçma ve aptalca park projesi durdurulsun, yerine çocuk oyun alanı yapılsın lütfen."],
  ];
  for (const [name, title, body] of audited) {
    it(`denetim metni etiket almaz ve ön denetimde içerik bulgusu üretmez: ${name}`, async () => {
      const input = { kind: "topic" as const, title, body, categories: [CAT.park] };
      const pre = await h.forum.proposals.precheck(m[0], input);
      expect([...pre.audit.violations, ...pre.audit.warnings].filter((f) => f.code.startsWith("content_label"))).toEqual([]);
      expect(pre.classification.contentLabels).toEqual([]);
      const d = await h.forum.proposals.create(m[0], input);
      expect(labelsOf(h, d.id)).toEqual([]);
    });
  }

  it("gerçek nefret söylemi etiketlenir; güven sezgiselin kendi güvenidir (eski risk formülü 0,95 verirdi)", async () => {
    const d = await h.forum.proposals.create(m[1], { kind: "topic", title: "Mahalle parkının kullanımı", body: `${LONG_BODY} Mahallemizde göçmen istemiyoruz.`, categories: [CAT.park] });
    expect(labelsOf(h, d.id)).toEqual([{ label: fy("NefretSoylemi"), confidence: 0.85, source: "ai" }]);
    const t = await h.forum.proposals.create(m[2], {
      kind: "topic",
      title: "Park kuralları",
      body: `${LONG_BODY} Bu kurala uymayanları seni bulacağım diye uyarıyorum, canını yakarım.`,
      categories: [CAT.park],
    });
    expect(labelsOf(h, t.id)).toEqual([{ label: fy("Tehdit"), confidence: 0.95, source: "ai" }]);
    const i = await h.forum.proposals.create(m[3], { kind: "topic", title: "Park bakımı", body: `${LONG_BODY} Bu öneriye karşı çıkan herkes aptal.`, categories: [CAT.park] });
    expect(labelsOf(h, i.id)).toEqual([{ label: fy("HakaretIftira"), confidence: 0.8, source: "ai" }]);
  });
});

describe("forum: YZ özeti azınlık bölümü (#K-28 benzeri tartışmalı öneri)", () => {
  let h: ForumHarness;
  let b: Blocks;

  beforeAll(async () => {
    h = await makeForum();
    b = makeBlocks(h);
    await seedHistory(h, b, 10);
  }, 60_000);

  it("en küçük anlamlı küme (nüfusa göre), azınlık raporu ve köprüyü geçemeyen kümenin 'hayır' tarafı özette görünür", async () => {
    const id = await toDeliberation(h, b.A[0], b.all.slice(1), {
      title: "Ana caddedeki yaya geçitleri yükseltilsin",
      body: "Ana caddedeki yaya geçitleri yükseltilsin ve okul önlerinde araç hızı düşürülsün; bazı geçitler birleştirilsin.",
    });
    // Her kümeden iki yazar: eski sürüm küme büyüklüğünü buradan (2/2/2) hesaplayıp azınlık bulamıyordu.
    const post = (u: AuthUser, stance: "pro" | "con" | "neutral" | "question", body: string) => h.forum.messages.post(u, "proposal", id, { body, stance });
    await post(b.A[1], "pro", "Yükseltilmiş geçitler okul önünde araçları yavaşlatır, çocuklar için güvenli olur.");
    await post(b.B[0], "pro", "Geçit sayısı azalsa da her biri daha güvenli olur.");
    const c1 = await post(b.C[0], "con", "Yaşlılar için 300 metre ek yürüme demek; mevcut geçitler kapatılmamalı.");
    const c2 = await post(b.C[1], "con", "Esnafın yükleme alanları kalkıyor, dükkânlara mal taşımak zorlaşır.");
    await post(b.B[1], "question", "Birleştirilecek geçitlerin yeri nasıl belirlenecek?");
    await post(b.A[2], "neutral", "Önce trafik ölçümü yapılırsa karar kolaylaşır.");

    await toVoting(h, id);
    for (const u of [...b.A, ...b.B]) await h.forum.proposals.vote(u, id, "yes");
    for (const u of b.C) await h.forum.proposals.vote(u, id, "no");
    await closeVoting(h, id);
    const d = h.forum.proposals.get(id, null);
    expect(d.status).toBe("reconciliation");
    expect(d.results[0].outcome).toBe("contested");
    const failing = d.results[0].clusters.filter((c) => c.passed === false);
    expect(failing).toHaveLength(1);
    const cLabel = clusterLabel(failing[0].clusterId);

    h.forum.proposals.minorityReport(b.C[0], id, "Yaşlı ve engelli sakinler için geçitler arası mesafe kısa kalmalı. Uygulama önce pilot olarak denenmeli.");
    const a = await h.forum.proposals.aiSummary(b.B[2], id);
    const out = a.output as { minorityViews: AiCitedPoint[]; minorityReportCount: number; messageCount: number };
    const texts = out.minorityViews.map((p) => p.text);
    expect(texts.join("\n")).not.toMatch(/saptanmadı/);
    expect(out.minorityReportCount).toBe(1);
    expect(out.messageCount).toBe(6);
    // 1) Azınlık raporu (C[0] tartışmada üçüncü yazar → K3)
    expect(texts[0]).toBe(`Azınlık raporu (${cLabel}) — K3: "Yaşlı ve engelli sakinler için geçitler arası mesafe kısa kalmalı. Uygulama önce pilot olarak denenmeli."`);
    // 2) Köprü testini geçemeyen küme (aynı zamanda nüfusa göre en küçük anlamlı küme: 6 üye)
    expect(texts[1]).toBe(
      `${cLabel} (en küçük anlamlı görüş grubu, 6 üye) kesin sayımda köprü testini geçemedi: 0 evet, 6 hayır. Bu grubun "hayır" tarafı azınlıkta kaldı; tartışmada aleyhte yazanlar: K3, K4.`,
    );
    // 3) "Hayır" tarafının mesajları alıntılanır
    expect(out.minorityViews.flatMap((p) => p.cites)).toEqual([c1.id, c2.id]);
    // Özet çıktısında takma ad yok
    expect(JSON.stringify(a.output)).not.toContain(b.C[0].nickname);
  });
});
