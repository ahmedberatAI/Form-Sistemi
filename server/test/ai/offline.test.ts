import { describe, expect, it } from "vitest";
import { fy, generateTckn, OFFLINE_MODEL } from "@forum/shared";
import { createAiService } from "../../src/ai";
import type { SummaryInputMessage } from "../../src/core/contracts";
import { makeCtx } from "../helpers/fakes";
import { classifyCtx, moderateCtx } from "./fixtures";

const ai = createAiService(makeCtx(), { client: null });

describe("çevrimdışı mod", () => {
  it("mode/model çevrimdışını gösterir; anahtar yoksa ya da AI kapalıysa istemci kurulmaz", () => {
    expect(ai.mode()).toBe("offline");
    expect(ai.model()).toBe(OFFLINE_MODEL);
    const saved = process.env.ANTHROPIC_API_KEY;
    try {
      delete process.env.ANTHROPIC_API_KEY;
      expect(createAiService(makeCtx({ aiEnabled: true })).mode()).toBe("offline");
      process.env.ANTHROPIC_API_KEY = "sk-ant-test-yalnizca-kurulum";
      expect(createAiService(makeCtx({ aiEnabled: false })).mode()).toBe("offline");
      const live = createAiService(makeCtx({ aiEnabled: true }));
      expect(live.mode()).toBe("claude");
      expect(live.model()).toBe("claude-opus-5-5");
    } finally {
      if (saved === undefined) delete process.env.ANTHROPIC_API_KEY;
      else process.env.ANTHROPIC_API_KEY = saved;
    }
  });
});

describe("classifyProposal (çevrimdışı)", () => {
  it("'Otobüs seferleri artırılsın' → Toplu taşıma", async () => {
    const r = await ai.classifyProposal({ title: "Otobüs seferleri artırılsın", body: "Akşam saatlerinde otobüs çok seyrek geliyor, bekleme süresi uzun." }, classifyCtx);
    expect(r.offline).toBe(true);
    expect(r.model).toBe(OFFLINE_MODEL);
    expect(r.categories[0].iri).toBe(fy("TopluTasima"));
    expect(r.categories.length).toBeGreaterThanOrEqual(1);
    expect(r.categories.length).toBeLessThanOrEqual(3);
    for (const c of r.categories) expect(c.confidence).toBeGreaterThan(0), expect(c.confidence).toBeLessThanOrEqual(1);
    expect(r.rightsAffected).toEqual([]);
    expect(r.rationale).toContain("otobüs");
  });

  it("'Parka yalnızca X mahallesinden olanlar girebilsin' → Eşitlik hakkı kısıtlaması", async () => {
    const r = await ai.classifyProposal({ title: "Parka yalnızca X mahallesinden olanlar girebilsin", body: "Diğer mahallelerden gelenler parkı kalabalıklaştırıyor." }, classifyCtx);
    expect(r.categories.map((c) => c.iri)).toContain(fy("YesilAlan"));
    const eq = r.rightsAffected.find((x) => x.right === fy("EsitlikAyrimcilikYasagi"));
    expect(eq).toBeDefined();
    expect(eq!.direction).toBe("restrict");
    expect(r.rationale).toMatch(/kısıtlama/);
  });

  it("genişletme ipucu → expand; kişisel veri → içerik etiketi", async () => {
    const r = await ai.classifyProposal({ title: "Kütüphane herkese açık ve ücretsiz olsun", body: "Kütüphaneye erişim tüm sakinler için ücretsiz olmalı." }, classifyCtx);
    expect(r.categories[0].iri).toBe(fy("Kutuphane"));
    expect(r.rightsAffected.find((x) => x.right === fy("ErisimHakki"))?.direction).toBe("expand");
    const p = await ai.classifyProposal({ title: "Komşum hakkında", body: `Kimlik numarası ${generateTckn("234567891")} olan kişi parka çöp atıyor.` }, classifyCtx);
    expect(p.contentLabels.find((l) => l.label === fy("KisiselVeriIfsasi"))?.confidence).toBeGreaterThanOrEqual(0.9);
  });

  it("eşleşme yoksa kategori uydurmaz; aynı girdi aynı çıktı (belirlenimci)", async () => {
    const r = await ai.classifyProposal({ title: "Merhaba", body: "Genel bir düşünce." }, classifyCtx);
    expect(r.categories).toEqual([]);
    const a = await ai.classifyProposal({ title: "Okul servisleri ücretsiz olsun", body: "Öğrenci servis ücretleri yüksek." }, classifyCtx);
    const b = await ai.classifyProposal({ title: "Okul servisleri ücretsiz olsun", body: "Öğrenci servis ücretleri yüksek." }, classifyCtx);
    expect(a).toEqual(b);
  });
});

describe("moderate (çevrimdışı)", () => {
  it("tehdit → risk 3, Tehdit etiketi, ilgili madde ve alıntı", async () => {
    const t = "Bu kararı verenleri seni bulacağım diye uyarıyorum, canını yakarım!";
    const r = await ai.moderate(t, moderateCtx);
    expect(r.risk).toBe(3);
    expect(r.labels).toContain(fy("Tehdit"));
    expect(r.articleIds).toContain(fy("Madde7"));
    expect(r.spans.map((s) => s.quote)).toEqual(expect.arrayContaining(["seni bulacağım", "canını yakarım"]));
    for (const s of r.spans) expect(t.slice(s.start, s.end)).toBe(s.quote);
    expect(r.offline).toBe(true);
  });

  it("hakaret → HakaretIftira, risk 2", async () => {
    const r = await ai.moderate("Bunu savunan herkes aptal ve şerefsiz.", moderateCtx);
    expect(r.labels).toEqual([fy("HakaretIftira")]);
    expect(r.risk).toBe(2);
    expect(r.articleIds).toEqual([fy("Madde4")]);
  });

  it("nefret söylemi: korunan grup + aşağılama aynı cümlede", async () => {
    const r = await ai.moderate("Göçmenler pislik, hepsi defolsun bu mahalleden.", moderateCtx);
    expect(r.labels).toContain(fy("NefretSoylemi"));
    expect(r.risk).toBe(3);
    const ok = await ai.moderate("Göçmenler için dil kursu açılsın.", moderateCtx);
    expect(ok.labels).not.toContain(fy("NefretSoylemi"));
  });

  it("spam: tekrarlı bağlantı + reklam sözcükleri", async () => {
    const t = "Büyük indirim! Hemen tıklayın: http://ucuz.example.com/kampanya http://ucuz.example.com/kampanya";
    const r = await ai.moderate(t, moderateCtx);
    expect(r.labels).toContain(fy("Spam"));
    expect(r.risk).toBeGreaterThanOrEqual(1);
    expect(r.articleIds).toContain(fy("Madde12"));
    expect(r.spans.some((s) => s.quote.startsWith("http://ucuz.example.com"))).toBe(true);
  });

  it("kişisel veri: pii bulguları, maskeli alıntı, risk 3 (TCKN)", async () => {
    const tckn = generateTckn("456789123");
    const t = `Şikâyet ettiğim kişinin TC'si ${tckn}, telefonu 0533 222 11 00.`;
    const r = await ai.moderate(t, moderateCtx);
    expect(r.labels).toContain(fy("KisiselVeriIfsasi"));
    expect(r.pii.map((p) => p.kind)).toEqual(["tckn", "phone"]);
    expect(r.risk).toBe(3);
    expect(r.articleIds).toContain(fy("Madde9"));
    expect(JSON.stringify(r.spans)).not.toContain(tckn);
    expect(r.rationale).toContain("T.C. kimlik numarası");
  });

  it("sert ama meşru eleştiri risk 0", async () => {
    const r = await ai.moderate("Bu öneriye kesinlikle karşıyım; bütçe hesabı yanlış ve yönetim şeffaf davranmadı.", moderateCtx);
    expect(r.risk).toBe(0);
    expect(r.labels).toEqual([]);
    expect(r.spans).toEqual([]);
    expect(r.articleIds).toEqual([]);
  });

  it("metindeki 'Madde N' atfı ilgili maddeyi ekler", async () => {
    const r = await ai.moderate("Madde 9 uyarınca e-posta adresimi (ali@ornek.com) paylaşmayın.", moderateCtx);
    expect(r.articleIds).toEqual([fy("Madde9")]);
  });

  it("etiket başına sezgiselin kendi güveni döner (risk düzeyinden türetilmez)", async () => {
    const t = await ai.moderate("Bu kararı verenleri seni bulacağım diye uyarıyorum, canını yakarım!", moderateCtx);
    expect(t.labelConfidences).toEqual([{ label: fy("Tehdit"), confidence: 0.95 }]);
    const h = await ai.moderate("Mahallemizde göçmen istemiyoruz.", moderateCtx);
    expect(h.risk).toBe(3);
    expect(h.labelConfidences).toEqual([{ label: fy("NefretSoylemi"), confidence: 0.85 }]);
    const ok = await ai.moderate("Göçmenler için dil kursu açılsın.", moderateCtx);
    expect(ok.labelConfidences).toEqual([]);
  });
});

describe("moderate (çevrimdışı): denetimde bulunan yanlış pozitifler (hedef çözümlemesi)", () => {
  // Kabul denetiminde (gap 3 ve 15) canlı ortamda öneriyi "yönetmeliğe aykırı" kapatan metinler.
  const falsePositives: [string, string][] = [
    [
      "göçmen çocukları DESTEKLEYEN öneri",
      "Göçmen çocuklar için hafta sonu Türkçe kursu\nGöçmen çocukların okul dışında kalmasını istemiyoruz. Hafta sonları mahalle kütüphanesinde ücretsiz Türkçe kursu açılsın.",
    ],
    [
      "kadınların güvenliğini gözeten öneri",
      "Parklarda gece aydınlatması\nKadınların gece parktan geçerken kendini güvensiz hissetmesini istemiyoruz. Park yollarına ek aydınlatma yapılsın.",
    ],
    ["engellileri gözeten öneri", "Engellilerin otobüse binerken zorlanmasını istemiyoruz; rampa yapılsın."],
    ["projeye yönelik sert eleştiri", "Park projesi yerine oyun alanı\nBelediyenin bu saçma ve aptalca park projesi durdurulsun, yerine çocuk oyun alanı yapılsın lütfen."],
    ["kuruma yönelik sert eleştiri", "Bu aptal belediye düzeni yüzünden otobüsler hep geç kalıyor."],
    ["karara yönelik yüklem", "Bu karar gerçekten çok aptal; bütçe yeniden hesaplanmalı."],
    ["niteleyicili ad öbeği", "Bu aptal kişisel veri politikası değişmeli."],
    ["'aptal yerine koymak' deyimi", "Yolcuları aptal yerine koyan bu tarife değişsin."],
    ["'alçak' sözcüğünün olağan anlamı", "Gece seferlerinde alçak tabanlı araç kullanılıyor mu?"],
    ["olumsuzlanmış niteleme", "Kadınlar ikinci sınıf vatandaş değildir; parklarda eşit erişim sağlansın."],
    ["ayrımcılığa karşı çıkan cümle", "Engelliler ikinci sınıf vatandaş muamelesi görmesin."],
    ["'pis' grup adına bitişik değil", "Göçmen çocukların oynadığı park çok pis, temizlik ekibi gönderilsin."],
    ["grup adı aynı cümlede, hedef başka", "Engelliler için kaldırımdaki engeller yok edilsin."],
    ["grup konuşanın kendisi (özne)", "Biz kadınlar artık istemiyoruz, parklar aydınlatılsın."],
  ];
  for (const [name, text] of falsePositives) {
    it(`etiket yok: ${name}`, async () => {
      const r = await ai.moderate(text, moderateCtx);
      expect(r.labels).toEqual([]);
      expect(r.risk).toBe(0);
      expect(r.labelConfidences).toEqual([]);
    });
  }

  it("nesneye yönelik eleştiri gerekçede açıkça anılır", async () => {
    const r = await ai.moderate("Belediyenin bu saçma ve aptalca park projesi durdurulsun, yerine çocuk oyun alanı yapılsın lütfen.", moderateCtx);
    expect(r.rationale).toContain("«aptalca»");
    expect(r.rationale).toMatch(/kişiye hakaret sayılmadı/);
  });

  // Gerçek pozitifler korunur: gruba yönelik dışlama, bitişik aşağılama, açık düşmanlık ve kişiye hakaret.
  const truePositives: [string, string, string][] = [
    ["doğrudan dışlama", "Mahallemizde göçmen istemiyoruz.", "NefretSoylemi"],
    ["belirteçle ayrılmış dışlama", "Suriyelileri burada istemiyoruz!", "NefretSoylemi"],
    ["yer bildiren sözcükle ayrılmış dışlama", "Suriyeliler mahalleye sokulmasın.", "NefretSoylemi"],
    ["grup + baş ad", "Göçmen çocuklar okuldan atılsın.", "NefretSoylemi"],
    ["bitişik niteleme (sıfat)", "Pis göçmenler parkı mahvetti.", "NefretSoylemi"],
    ["bitişik niteleme (yüklem)", "Göçmenler pistir.", "NefretSoylemi"],
    ["açık düşmanlık çağrısı", "Kürtler hain, hepsi defolsun.", "NefretSoylemi"],
    ["kişiye hakaret", "Bunu savunan herkes aptal ve şerefsiz.", "HakaretIftira"],
    ["ikinci tekil kişiye hakaret", "Sen aptalsın, proje de kötü.", "HakaretIftira"],
    ["görevliye hakaret", "Aptal belediye başkanı yine yanlış karar verdi.", "HakaretIftira"],
    ["kişilere hakaret", "Aptal kişiler bu öneriyi savunuyor.", "HakaretIftira"],
    ["soru biçiminde hakaret", "Sen aptal mısın, plan ne?", "HakaretIftira"],
    ["yalnız kişiye kullanılan sözcük", "Bu kararı alan şerefsiz yöneticiler istifa etsin.", "HakaretIftira"],
  ];
  for (const [name, text, local] of truePositives) {
    it(`etiket var: ${name}`, async () => {
      const r = await ai.moderate(text, moderateCtx);
      expect(r.labels).toContain(fy(local));
      const own = r.labelConfidences?.find((c) => c.label === fy(local))?.confidence ?? 0;
      expect(own).toBeGreaterThanOrEqual(0.75);
      expect(own).toBeLessThanOrEqual(0.95);
    });
  }

  it("sınıflandırmadaki içerik etiketleri de aynı hedef çözümlemesini kullanır", async () => {
    const r = await ai.classifyProposal(
      { title: "Parklarda gece aydınlatması", body: "Kadınların gece parktan geçerken kendini güvensiz hissetmesini istemiyoruz. Park yollarına ek aydınlatma yapılsın." },
      classifyCtx,
    );
    expect(r.contentLabels).toEqual([]);
  });
});

describe("summarize (çevrimdışı)", () => {
  const msgs: SummaryInputMessage[] = [
    { id: "m1", pseudonym: "K1", clusterId: "g0", stance: "pro", body: "Akşam seferleri artarsa işe gidiş dönüş kolaylaşır. Bekleme süresi çok uzun." },
    { id: "m2", pseudonym: "K2", clusterId: "g0", stance: "pro", body: "Öğrenciler için akşam seferleri şart, bekleme süresi azalmalı." },
    { id: "m3", pseudonym: "K3", clusterId: "g0", stance: "pro", body: "Bütçe zaten ayrılmış, durak bakımı da yapılabilir." },
    { id: "m4", pseudonym: "K4", clusterId: "g1", stance: "con", body: "Bütçe yetersiz; durak bakımı ve güvenliği öncelikli olmalı." },
    { id: "m5", pseudonym: "K5", clusterId: "g1", stance: "con", body: "Gece gürültü artacak. Bana 0532 123 45 67 numarasından ulaşın @ahmet_b." },
    { id: "m6", pseudonym: "K6", clusterId: "g0", stance: "question", body: "Bu ek seferlerin yıllık maliyeti ne kadar olacak?" },
    { id: "m7", pseudonym: "K7", clusterId: "g0", stance: "neutral", body: "Durak güvenliği ve aydınlatma konusunda herkes hemfikir gibi." },
  ];

  it("azınlık bölümü dolu, alıntılar geçerli kimlikler, kapsama doğru", async () => {
    const s = await ai.summarize({ topicTitle: "Otobüs seferleri artırılsın", messages: msgs });
    const ids = new Set(msgs.map((m) => m.id));
    expect(s.offline).toBe(true);
    expect(s.model).toBe(OFFLINE_MODEL);
    expect(s.minorityViews.length).toBeGreaterThan(0);
    expect(s.minorityViews.flatMap((p) => p.cites).every((c) => ["m4", "m5"].includes(c))).toBe(true);
    expect(s.minorityViews[0].text).toContain("Görüş Grubu B");
    for (const p of [...s.commonGround, ...s.contested, ...s.minorityViews, ...s.openQuestions]) {
      expect(p.text.length).toBeGreaterThan(0);
      for (const c of p.cites) expect(ids.has(c)).toBe(true);
    }
    expect(s.openQuestions[0]).toEqual({ text: 'K6 soruyor: "Bu ek seferlerin yıllık maliyeti ne kadar olacak?"', cites: ["m6"] });
    expect(s.contested.length).toBeGreaterThan(0);
    expect(s.commonGround.length).toBeGreaterThan(0);
    const cited = new Set([...s.commonGround, ...s.contested, ...s.minorityViews, ...s.openQuestions].flatMap((p) => p.cites));
    expect(s.coverage).toBeCloseTo(cited.size / msgs.length, 3);
    // Özet çıktısında kişisel veri ve takma ad yer almaz.
    const out = JSON.stringify(s);
    expect(out).not.toContain("0532");
    expect(out).not.toContain("ahmet_b");
  });

  it("küme yoksa sayıca az olan tutum azınlık sayılır; azınlık yoksa açıklayıcı tek madde", async () => {
    const noCluster = msgs.map((m) => ({ ...m, clusterId: null }));
    const s = await ai.summarize({ topicTitle: "Otobüs", messages: noCluster });
    expect(s.minorityViews.length).toBeGreaterThan(0);
    expect(s.minorityViews.flatMap((p) => p.cites).every((c) => ["m4", "m5"].includes(c))).toBe(true);
    const allPro = msgs.slice(0, 3);
    const t = await ai.summarize({ topicTitle: "Otobüs", messages: allPro });
    expect(t.minorityViews).toHaveLength(1);
    expect(t.minorityViews[0].cites).toEqual([]);
    expect(t.minorityViews[0].text).toMatch(/azınlık/);
    const e = await ai.summarize({ topicTitle: "Boş", messages: [] });
    expect(e.coverage).toBe(0);
    expect(e.minorityViews).toHaveLength(1);
  });

  // #K-28 benzeri vitrin örneği (gap 26): her kümeden 2 yazar, 2 lehte / 2 aleyhte; nüfus ise 21/13/6 ve C kümesi
  // köprü testini geçemedi. Eski sürüm küme büyüklüğünü tartışmaya yazan kişi sayısından hesapladığı için
  // "belirgin bir azınlık görüşü saptanmadı" diyordu.
  const k28: SummaryInputMessage[] = [
    { id: "c1", pseudonym: "K1", clusterId: "g0", stance: "pro", body: "Yaya geçitleri yükseltilirse okul önünde araçlar yavaşlar. Çocuklar için güvenli olur." },
    { id: "c2", pseudonym: "K2", clusterId: "g1", stance: "pro", body: "Ana caddede yaya geçidi sayısı artarsa kazalar azalır." },
    { id: "c3", pseudonym: "K3", clusterId: "g2", stance: "con", body: "Yaşlılar için 300 metre ek yürüme demek; mevcut geçitler kapatılmamalı." },
    { id: "c4", pseudonym: "K4", clusterId: "g2", stance: "con", body: "Esnafın yükleme alanları kalkıyor, dükkânlara mal taşımak zorlaşır." },
    { id: "c5", pseudonym: "K5", clusterId: "g1", stance: "question", body: "Geçitlerin yeri nasıl belirlenecek?" },
    { id: "c6", pseudonym: "K6", clusterId: "g0", stance: "neutral", body: "Trafik ölçümü yapılırsa karar kolaylaşır." },
  ];
  const report = { id: "r1", pseudonym: "K3", clusterId: "g2", body: "Yaşlı ve engelli sakinler için geçitler arası mesafe kısa kalmalı. Uygulama önce pilot olarak denenmeli." };

  it("eski davranış: nüfus bilgisi yokken eşit yazar sayısı azınlık bulamaz", async () => {
    const s = await ai.summarize({ topicTitle: "Ana caddedeki yaya geçitleri", messages: k28 });
    expect(s.minorityViews).toHaveLength(1);
    expect(s.minorityViews[0].text).toMatch(/saptanmadı/);
  });

  it("#K-28: nüfusa göre en küçük anlamlı küme, azınlık raporu ve köprüyü geçemeyen kümenin 'hayır' tarafı", async () => {
    const s = await ai.summarize({
      topicTitle: "Ana caddedeki yaya geçitleri",
      messages: k28,
      clusterSizes: { g0: 21, g1: 13, g2: 6 },
      failedClusters: [{ clusterId: "g2", members: 6, yes: 0, no: 6 }],
      minorityReports: [report],
    });
    const texts = s.minorityViews.map((p) => p.text);
    expect(texts.join("\n")).not.toMatch(/saptanmadı/);
    expect(texts[0]).toBe('Azınlık raporu (Görüş Grubu C) — K3: "Yaşlı ve engelli sakinler için geçitler arası mesafe kısa kalmalı. Uygulama önce pilot olarak denenmeli."');
    expect(s.minorityViews[0].cites).toEqual([]);
    expect(texts[1]).toBe(
      'Görüş Grubu C (en küçük anlamlı görüş grubu, 6 üye) kesin sayımda köprü testini geçemedi: 0 evet, 6 hayır. Bu grubun "hayır" tarafı azınlıkta kaldı; tartışmada aleyhte yazanlar: K3, K4.',
    );
    // "Hayır" tarafının mesajları alıntılanır; tekrarsız ve yalnız C kümesinden.
    const cited = s.minorityViews.flatMap((p) => p.cites);
    expect(cited).toEqual(["c3", "c4"]);
    expect(texts[2]).toMatch(/^Görüş Grubu C \(köprü testini geçemeyen grup, aleyhte\) — K3: "Yaşlılar için 300 metre ek yürüme/);
    // Belirlenimci
    const again = await ai.summarize({ topicTitle: "Ana caddedeki yaya geçitleri", messages: k28, clusterSizes: { g0: 21, g1: 13, g2: 6 }, failedClusters: [{ clusterId: "g2", members: 6, yes: 0, no: 6 }], minorityReports: [report] });
    expect(again).toEqual(s);
  });

  it("nüfus büyüklüğü tartışmaya yazan kişi sayısına üstün gelir", async () => {
    // Tartışmada g1'den 1, g0'dan 3 yazar var; ama nüfusta en küçük anlamlı küme g0 (5 üye).
    const msgs: SummaryInputMessage[] = [
      { id: "x1", pseudonym: "K1", clusterId: "g0", stance: "con", body: "Bu düzenleme küçük işletmeleri zorlar." },
      { id: "x2", pseudonym: "K2", clusterId: "g0", stance: "con", body: "Kira yardımı olmadan uygulanamaz." },
      { id: "x3", pseudonym: "K3", clusterId: "g0", stance: "neutral", body: "Önce bir anket yapılsın." },
      { id: "x4", pseudonym: "K4", clusterId: "g1", stance: "pro", body: "Düzenleme mahalleye nefes aldırır." },
    ];
    const s = await ai.summarize({ topicTitle: "Düzenleme", messages: msgs, clusterSizes: { g0: 5, g1: 30 } });
    expect(s.minorityViews.flatMap((p) => p.cites)).toEqual(["x1", "x2", "x3"]);
    expect(s.minorityViews[0].text).toMatch(/^Görüş Grubu A \(en küçük anlamlı görüş grubu, 5 üye\) — K1:/);
    // Nüfuslar eşitse küme yolu sonuç vermez; sayıca az tutum (lehte) azınlıktır.
    const eq = await ai.summarize({ topicTitle: "Düzenleme", messages: msgs, clusterSizes: { g0: 10, g1: 10 } });
    expect(eq.minorityViews.flatMap((p) => p.cites)).toEqual(["x4"]);
    // Anlık görüntü var ama iki anlamlı küme yok (boş nesne) ve tutumlar dengeli → açıklayıcı tek madde.
    const none = await ai.summarize({ topicTitle: "Düzenleme", messages: msgs.slice(0, 1).concat(msgs[3]), clusterSizes: {} });
    expect(none.minorityViews).toHaveLength(1);
    expect(none.minorityViews[0].text).toMatch(/nüfusları eşit ya da tek bir anlamlı grup var/);
  });

  it("azınlık raporu metnindeki kişisel veri ve @takma ad özete geçmez", async () => {
    const s = await ai.summarize({
      topicTitle: "X",
      messages: [],
      minorityReports: [{ id: "r9", pseudonym: "K1", clusterId: null, body: "Bana 0532 123 45 67 numarasından ulaşın @ahmet_b. Karar azınlığı yok sayıyor." }],
    });
    expect(s.minorityViews[0].text).toMatch(/^Azınlık raporu — K1:/);
    const out = JSON.stringify(s);
    expect(out).not.toContain("0532");
    expect(out).not.toContain("ahmet_b");
  });
});

describe("similar (TF-IDF)", () => {
  it("benzerlik sırası, eşik ve belirlenimci eşitlik bozma", () => {
    const corpus = [
      { id: "p-park", title: "Parka bank konulsun", body: "Parkta oturacak yer yok." },
      { id: "p-gece", title: "Gece otobüs seferleri", body: "Gece saatlerinde otobüs seferi olsun." },
      { id: "p-metro", title: "Metro seferleri artırılsın", body: "Metro seferleri akşam yetersiz." },
      { id: "p-b", title: "Otobüs seferleri artırılsın", body: "Akşam otobüs seferleri yetersiz." },
      { id: "p-a", title: "Otobüs seferleri artırılsın", body: "Akşam otobüs seferleri yetersiz." },
    ];
    const r = ai.similar({ title: "Otobüs seferleri artırılsın", body: "Akşam saatlerinde otobüs seferleri yetersiz kalıyor." }, corpus, 10);
    expect(r.map((x) => x.id)).toEqual(["p-a", "p-b", "p-gece", "p-metro"]);
    expect(r[0].score).toBe(r[1].score);
    for (let i = 1; i < r.length; i++) expect(r[i].score).toBeLessThanOrEqual(r[i - 1].score);
    expect(r.every((x) => x.score >= 0.15 && x.score <= 1)).toBe(true);
    expect(ai.similar({ title: "Otobüs seferleri", body: "" }, corpus, 2)).toHaveLength(2);
    expect(ai.similar({ title: "x", body: "" }, [])).toEqual([]);
  });
});

describe("bridgingDrafts (çevrimdışı)", () => {
  it("4–8 taslak; çoğunluk ve azınlık noktalarını birleştirir", async () => {
    const r = await ai.bridgingDrafts({
      title: "Akşam seferleri artırılsın",
      body: "…",
      majorityPoints: ["İşten dönüş kolaylaşır", "Öğrenciler yararlanır"],
      minorityPoints: ["Gece gürültüsü artar", "Bütçe yetersiz"],
    });
    expect(r.offline).toBe(true);
    expect(r.drafts.length).toBeGreaterThanOrEqual(4);
    expect(r.drafts.length).toBeLessThanOrEqual(8);
    const all = JSON.stringify(r.drafts);
    expect(all).toContain("Gece gürültüsü artar");
    expect(all).toContain("İşten dönüş kolaylaşır");
    for (const d of r.drafts) {
      expect(d.title.length).toBeGreaterThan(0);
      expect(d.body.length).toBeGreaterThan(20);
      expect(d.rationale.length).toBeGreaterThan(10);
    }
    expect(new Set(r.drafts.map((d) => d.title.split(":")[0])).size).toBe(r.drafts.length);
    const none = await ai.bridgingDrafts({ title: "X", body: "", majorityPoints: [], minorityPoints: [] });
    expect(none.drafts).toHaveLength(4);
    const many = await ai.bridgingDrafts({ title: "X", body: "", majorityPoints: Array(10).fill("a"), minorityPoints: Array(10).fill("b") });
    expect(many.drafts).toHaveLength(8);
  });
});

describe("lintExpertReport (çevrimdışı)", () => {
  it("hukuki nitelendirmeyi ve aşırı kesinliği işaretler", async () => {
    const r = await ai.lintExpertReport(
      "Ölçümlere göre gürültü 65 dB düzeyindedir. Belediyenin uygulaması hukuka aykırıdır. Yüklenici kusurludur ve tazminat ödemelidir. Proje kesinlikle %100 başarılı olur.",
    );
    expect(r.offline).toBe(true);
    const legal = r.issues.filter((i) => i.kind === "legal_qualification");
    expect(legal.map((i) => i.quote)).toEqual(["Belediyenin uygulaması hukuka aykırıdır.", "Yüklenici kusurludur ve tazminat ödemelidir."]);
    expect(legal[0].message).toContain("6754 sayılı Bilirkişilik Kanunu md. 3/2");
    expect(r.issues.filter((i) => i.kind === "overclaim").map((i) => i.quote)).toEqual(["Proje kesinlikle %100 başarılı olur."]);
    expect((await ai.lintExpertReport("Ölçümler 65 dB gösteriyor; belirsizlik ±3 dB.")).issues).toEqual([]);
  });
});

describe("explainDecision", () => {
  it("kontrol listesini sade Türkçe paragrafa çevirir", () => {
    const s = ai.explainDecision(
      [
        { label: "Katılım (yeter sayı)", passed: true, value: "%62", required: "%40" },
        { label: "Görüş Grubu B desteği", passed: false, value: "0,31", required: "0,35" },
      ],
      "Tartışmalı (uzlaşma gerekli)",
    );
    expect(s).toContain("Sonuç: Tartışmalı (uzlaşma gerekli).");
    expect(s).toContain("Katılım (yeter sayı) koşulu sağlandı (gerçekleşen: %62; gerekli: %40).");
    expect(s).toContain("Görüş Grubu B desteği koşulu sağlanamadı");
    expect(s).toContain("kararı yapay zekâ vermez");
    expect(ai.explainDecision([{ label: "A", passed: true, value: "1", required: "1" }], "Kabul")).toContain("tamamı sağlandı");
  });
});
