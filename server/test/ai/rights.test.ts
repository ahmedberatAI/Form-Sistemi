// Hak etkisi kalibrasyonu: forum modülü restrict ≥ 0,5 bulgularını otomatik "hak etkisi bayrağı" yapar (T1 + bilirkişi).
import { describe, expect, it } from "vitest";
import { fy } from "@forum/shared";
import { createAiService } from "../../src/ai";
import { makeCtx } from "../helpers/fakes";
import { classifyCtx, fakeClient, jsonResponse } from "./fixtures";

const ai = createAiService(makeCtx(), { client: null });
const FLAG = 0.5;

async function rights(title: string, body = "") {
  const r = await ai.classifyProposal({ title, body }, classifyCtx);
  return r.rightsAffected;
}
const restrictConf = (rs: { right: string; direction: string; confidence: number }[], local: string) =>
  rs.filter((x) => x.right === fy(local) && x.direction === "restrict").reduce((m, x) => Math.max(m, x.confidence), 0);
const maxRestrict = (rs: { direction: string; confidence: number }[]) => rs.filter((x) => x.direction === "restrict").reduce((m, x) => Math.max(m, x.confidence), 0);

describe("zararsız öneriler bayrak üretmez (niceleyici/fiil tek başına ≤ 0,3)", () => {
  const benign = [
    "Hafta sonları sadece gece 00:00-03:00 arasında ek otobüs seferi konulsun. Gece çalışanların eve dönüşü kolaylaşır.",
    "Mahalle parkının yalnızca kuzey köşesine çitle çevrili köpek gezdirme alanı yapılsın.",
    "Cumhuriyet Caddesi boyunca korumalı bisiklet yolu yapılsın, otoparkın bir kısmı kaldırılsın.",
    "Pazar hariç her gün kütüphane 22:00'ye kadar açık olsun.",
    "Spor salonu yalnızca hafta içi akşamları kullanıma açılsın.",
    "Kaçak reklam panoları kaldırılsın.",
    "Hava kalitesi ölçüm istasyonları kurulsun ve hava kalitesi sürekli izlensin.",
    "Öğrencilerden okul servisi ücreti alınmasın.",
    "Gençler için katılımcı bütçeden kaynak ayrılsın.",
    "Sağlık ocağı kapatılmasın, aksine hafta sonu da açık olsun.",
  ];
  for (const t of benign) {
    it(t, async () => {
      const rs = await rights(t);
      expect(maxRestrict(rs)).toBeLessThan(FLAG);
      expect(restrictConf(rs, "EsitlikAyrimcilikYasagi")).toBeLessThanOrEqual(0.3);
    });
  }

  it("koordinatör örnekleri: eşitlik ≤ 0,3, erişim < 0,5", async () => {
    expect(restrictConf(await rights(benign[0]), "EsitlikAyrimcilikYasagi")).toBeLessThanOrEqual(0.3);
    expect(restrictConf(await rights(benign[1]), "EsitlikAyrimcilikYasagi")).toBeLessThanOrEqual(0.3);
    expect(restrictConf(await rights(benign[2]), "ErisimHakki")).toBeLessThan(0.5);
  });
});

describe("kişi/grup hedefli dışlama → eşitlik kısıtlaması ≥ 0,8", () => {
  const cases = [
    "Parka yalnızca bizim mahalleden olanlar girebilsin, yabancılar giremesin.",
    "Parka yalnızca X mahallesinden olanlar girebilsin.",
    "Yalnızca Türk vatandaşları sosyal yardımdan yararlanabilsin.",
    "Suriyeli aileler bu mahalleye taşınamasın.",
    "Kadınlar ve erkekler parkta ayrı tutulsun.",
    "Kiracılar site toplantısında oy kullanamasın.",
    "Göçmenlerin kütüphaneye girişi yasaklansın.",
    "Engelliler hariç tutulsun, etkinliğe sadece sağlıklı olanlar katılsın.",
  ];
  for (const t of cases) {
    it(t, async () => {
      expect(restrictConf(await rights(t), "EsitlikAyrimcilikYasagi")).toBeGreaterThanOrEqual(0.8);
    });
  }
  it("niceleyici + dışlama fiili + grup → 0,9", async () => {
    expect(restrictConf(await rights(cases[0]), "EsitlikAyrimcilikYasagi")).toBe(0.9);
  });
});

describe("nesne gerektiren hak kuralları", () => {
  it("kamu hizmetinin kapatılması/kaldırılması/ücretlendirilmesi → erişim ≥ 0,5", async () => {
    for (const t of ["Mahalledeki sağlık ocağı kapatılsın.", "Kütüphane hafta sonları ücretli olsun.", "42 numaralı otobüs hattı kaldırılsın.", "Parktaki engelli rampası kaldırılsın."]) {
      expect(restrictConf(await rights(t), "ErisimHakki"), t).toBeGreaterThanOrEqual(0.5);
    }
  });

  it("kısmi düzenleme ve azaltma < 0,5", async () => {
    expect(restrictConf(await rights("Parkın bir kısmı otopark olarak düzenlensin, oyun alanının bir bölümü kaldırılsın."), "ErisimHakki")).toBeLessThan(0.5);
    expect(restrictConf(await rights("Gece otobüs seferleri azaltılsın."), "ErisimHakki")).toBeLessThan(0.5);
  });

  it("diğer haklar: ifade, gizlilik, katılım, mülkiyet, toplanma, sağlık", async () => {
    expect(restrictConf(await rights("Forumda yönetimi eleştiren yorumlar silinsin."), "IfadeOzgurlugu")).toBeGreaterThanOrEqual(0.5);
    expect(restrictConf(await rights("Muhalif üyeler susturulsun."), "IfadeOzgurlugu")).toBeGreaterThanOrEqual(0.5);
    expect(restrictConf(await rights("Üyelerin ev adresleri herkese açık olarak yayımlansın."), "OzelHayatinGizliligi")).toBeGreaterThanOrEqual(0.5);
    expect(restrictConf(await rights("Kiracıların oy hakkı kaldırılsın."), "KatilimHakki")).toBeGreaterThanOrEqual(0.8);
    expect(restrictConf(await rights("Dere kenarındaki evler kamulaştırılsın ve yıkılsın."), "MulkiyetHakki")).toBeGreaterThanOrEqual(0.5);
    expect(restrictConf(await rights("Mahallede gösteri ve yürüyüşler yasaklansın."), "ToplanmaHakki")).toBeGreaterThanOrEqual(0.5);
    expect(restrictConf(await rights("Grip aşısı tüm çalışanlar için zorunlu olsun."), "SaglikHakki")).toBeGreaterThanOrEqual(0.5);
    // Nesne yoksa aynı fiiller bayrak üretmez.
    const noObj = await rights("Bu kural yasaklansın ve kaldırılsın.");
    expect(maxRestrict(noObj)).toBeLessThan(FLAG);
    expect(restrictConf(await rights("Parkta yüksek sesle müzik çalmak yasaklansın."), "IfadeOzgurlugu")).toBeLessThan(FLAG);
  });

  it("olumsuz fiil (koruma talebi) kısıtlama sayılmaz; genişletme ayrı yön", async () => {
    expect(restrictConf(await rights("Hastane kapatılmasın."), "ErisimHakki")).toBe(0);
    const rs = await rights("Engelliler için rampa ve asansör yapılsın, kütüphane erişilebilir olsun.");
    expect(rs.find((x) => x.right === fy("ErisimHakki"))?.direction).toBe("expand");
    expect(maxRestrict(rs)).toBeLessThan(FLAG);
  });

  it("gerekçe hak değerlendirmesini ve zayıf ipucunu belirtir", async () => {
    const r = await ai.classifyProposal({ title: "Spor salonu yalnızca hafta içi açık olsun", body: "" }, classifyCtx);
    expect(r.rationale).toContain("zayıf ipucu");
    const s = await ai.classifyProposal({ title: "Parka yabancılar giremesin", body: "" }, classifyCtx);
    expect(s.rationale).toContain("Eşitlik ve ayrımcılık yasağı");
    expect(s.rationale).toContain("kısıtlama");
  });
});

describe("lintExpertReport: out_of_domain", () => {
  it("çevrimdışı: bilirkişinin kendi beyanıyla alan dışı ifadesi işaretlenir", async () => {
    const r = await ai.lintExpertReport("Zemin etüdüne göre bina güçlendirilebilir. Uzmanlık alanım dışında olmakla birlikte projenin bütçesi de yetersizdir.");
    expect(r.issues).toEqual([
      expect.objectContaining({ kind: "out_of_domain", quote: "Uzmanlık alanım dışında olmakla birlikte projenin bütçesi de yetersizdir." }),
    ]);
    expect(r.issues[0].message).toContain("Uzmanlık alanı dışı");
  });

  it("Claude: şemada out_of_domain var, uzmanlık alanları iletilir, bulgu korunur", async () => {
    const { client, calls } = fakeClient(() => jsonResponse({ issues: [{ quote: "Bütçe yetersizdir.", kind: "out_of_domain", message: "Mali değerlendirme alan dışı." }] }));
    const svc = createAiService(makeCtx(), { client });
    const r = await svc.lintExpertReport("Zemin sağlam. Bütçe yetersizdir.", { domains: ["Deprem güvenliği"] });
    expect(r.offline).toBe(false);
    expect(r.issues.map((i) => i.kind)).toEqual(["out_of_domain"]);
    const p = calls[0].params;
    expect(p.output_config.format.schema.properties.issues.items.properties.kind.enum).toContain("out_of_domain");
    expect(p.messages[0].content).toContain("<uzmanlik_alanlari>");
    expect(p.messages[0].content).toContain("Deprem güvenliği");
    expect(p.system).toContain("out_of_domain");
  });
});
