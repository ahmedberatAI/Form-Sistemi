import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import {
  CATEGORY_VOCAB,
  CONTENT_LABEL_VOCAB,
  DELETION_GROUND_VOCAB,
  FY_NS,
  GENERAL_PARAMS_IRI,
  OBJECTION_GROUND_VOCAB,
  PROPOSAL_TEXT_LIMITS,
  RIGHT_VOCAB,
  TIER_IRIS,
  fy,
} from "@forum/shared";
import { makeCtx } from "../helpers/fakes";
import { createOntologyService } from "../../src/ontology";
import { BylawModel } from "../../src/ontology/model";
import { parseN3, parseTurtle } from "../../src/ontology/rdf";
import type { OntologyService } from "../../src/core/contracts";

const DIR = makeCtx().config.ontologyDir;
const read = (f: string) => readFileSync(join(DIR, f), "utf8");
const tbox = parseTurtle(read("fy-schema.ttl"));
const abox = parseTurtle(read("yonetmelik.ttl"));
const model = new BylawModel(tbox, abox);
const subjects = new Set([...tbox, ...abox].map((q) => q.subject.value));

let svc: OntologyService;
beforeAll(async () => {
  svc = createOntologyService(makeCtx());
  await svc.init();
});

describe("kelime dağarcığı (vocab.ts) ↔ TTL tutarlılığı", () => {
  it("vocab.ts'deki her IRI TTL'de tanımlı", () => {
    const iris = [
      ...CATEGORY_VOCAB.map((c) => fy(c.local)),
      ...RIGHT_VOCAB.map((r) => fy(r.local)),
      ...DELETION_GROUND_VOCAB.map((g) => fy(g.local)),
      ...OBJECTION_GROUND_VOCAB.map((g) => fy(g.local)),
      ...CONTENT_LABEL_VOCAB.map((l) => fy(l.local)),
      ...Object.values(TIER_IRIS),
      GENERAL_PARAMS_IRI,
    ];
    const missing = iris.filter((i) => !subjects.has(i));
    expect(missing).toEqual([]);
  });

  it("kategoriler: etiket, üst sınıf, bilirkişi bayrağı ve anahtar kelimeler aynı", () => {
    expect(model.categories.size).toBe(CATEGORY_VOCAB.length);
    for (const c of CATEGORY_VOCAB) {
      const m = model.categories.get(fy(c.local));
      expect(m, c.local).toBeDefined();
      expect(m!.label).toBe(c.label);
      expect(m!.parent).toBe(c.parent ? fy(c.parent) : null);
      expect(m!.requiresExpert, c.local).toBe(c.requiresExpert === true);
      expect([...m!.keywords].sort()).toEqual([...c.keywords].sort());
    }
  });

  it("haklar: etiket ve coreImmutable aynı", () => {
    expect(model.rights.size).toBe(RIGHT_VOCAB.length);
    for (const r of RIGHT_VOCAB) {
      const m = model.rights.get(fy(r.local));
      expect(m, r.local).toBeDefined();
      expect(m!.label).toBe(r.label);
      expect(m!.coreImmutable).toBe(r.coreImmutable === true);
      expect([...m!.keywords].sort()).toEqual([...r.keywords].sort());
    }
  });

  it("silme gerekçeleri: urgent / sealed / invalid bayrakları aynı", () => {
    expect(model.deletionGrounds.size).toBe(DELETION_GROUND_VOCAB.length);
    for (const g of DELETION_GROUND_VOCAB) {
      const m = model.deletionGrounds.get(fy(g.local));
      expect(m, g.local).toBeDefined();
      expect(m!.label).toBe(g.label);
      expect(m!.urgent).toBe(g.urgent === true);
      expect(m!.sealed).toBe(g.sealed === true);
      expect(m!.invalid).toBe(g.invalid === true);
    }
  });

  it("itiraz gerekçeleri ve içerik etiketleri aynı", () => {
    expect(model.objectionGrounds.size).toBe(OBJECTION_GROUND_VOCAB.length);
    for (const g of OBJECTION_GROUND_VOCAB) expect(model.objectionGrounds.get(fy(g.local))?.label).toBe(g.label);
    expect(model.contentLabels.size).toBe(CONTENT_LABEL_VOCAB.length);
    for (const l of CONTENT_LABEL_VOCAB) expect(model.contentLabels.get(fy(l.local))?.label).toBe(l.label);
  });

  it("katman IRI'leri doğru katman kodunu taşır", () => {
    for (const [code, iri] of Object.entries(TIER_IRIS)) expect(model.tierByIri(iri)?.tierCode).toBe(code);
  });
});

describe("katman ve genel parametreler (docs/ALGORITMA.md §2 ile birebir)", () => {
  const P = (code: "T0" | "T1" | "T2" | "DEL") => Object.fromEntries(model.tierHolder(code)!.params);
  it("T0", () => {
    expect(P("T0")).toMatchObject({ yeterSayi: 0.2, esik: 0.5, esikKesin: true, kumeTabani: 0.3, yenidenOyEsigi: 0.6 });
    expect(P("T0").asmaEsigi).toBeCloseTo(2 / 3, 3);
    expect(P("T0")).toMatchObject({ sureDestek: 168, sureTartisma: 72, sureOylama: 72, sureUzatma: 24, sureItiraz: 48, sureUzlasma: 72 });
  });
  it("T1", () => {
    expect(P("T1")).toMatchObject({ yeterSayi: 0.3, esik: 0.6, esikKesin: false, kumeTabani: 0.4, yenidenOyEsigi: 0.6 });
    expect(P("T1").asmaEsigi).toBeCloseTo(2 / 3, 3);
    expect(P("T1")).toMatchObject({ sureDestek: 168, sureTartisma: 96, sureOylama: 96, sureUzatma: 24, sureItiraz: 72, sureUzlasma: 120 });
  });
  it("T2", () => {
    expect(P("T2")).toMatchObject({ yeterSayi: 0.4, esikKesin: false, kumeTabani: 0.4, asmaEsigi: 0.75 });
    expect(P("T2").esik).toBeCloseTo(2 / 3, 3);
    expect(P("T2").yenidenOyEsigi).toBeCloseTo(2 / 3, 3);
    expect(P("T2")).toMatchObject({ sureDestek: 168, sureTartisma: 168, sureOylama: 120, sureUzatma: 48, sureItiraz: 72, sureUzlasma: 168 });
  });
  it("DEL", () => {
    expect(P("DEL")).toMatchObject({ yeterSayi: 0.3, esikKesin: false, kumeTabani: 0.3, yazarKumesiTabani: 0.5, asmaEsigi: 0.75, yenidenOyEsigi: 0.75 });
    expect(P("DEL").esik).toBeCloseTo(2 / 3, 3);
    expect(P("DEL")).toMatchObject({ sureDestek: 72, sureTartisma: 24, sureOylama: 48, sureUzatma: 24, sureItiraz: 0, sureUzlasma: 0 });
  });
  it("T3 oylanamaz ve parametre taşımaz", () => {
    expect(model.tierHolder("T3")!.params.size).toBe(0);
  });
  it("genel parametreler", () => {
    expect(Object.fromEntries(model.generalParams()!.params)).toEqual({
      anlamliKumePayi: 0.1,
      anlamliKumeAsgariUye: 3,
      kumeBasinaAsgariOy: 2,
      kopruIcinAsgariKumelenmis: 12,
      sogukBaslangicArtisi: 0.1,
      vekaletSiniriOrani: 0.05,
      vekaletAzamiAdim: 3,
      bilirkisiSayisi: 3,
    });
  });
  it("tiers() tabloyu döndürür", () => {
    const t = Object.fromEntries(svc.tiers().map((x) => [x.tier, x]));
    expect(Object.keys(t)).toEqual(["T0", "T1", "T2", "T3", "DEL"]);
    expect(t.T0).toMatchObject({ label: "Olağan karar", quorum: 0.2, threshold: 0.5, clusterFloor: 0.3 });
    expect(t.T1).toMatchObject({ quorum: 0.3, threshold: 0.6, clusterFloor: 0.4 });
    expect(t.DEL).toMatchObject({ quorum: 0.3, clusterFloor: 0.3 });
    expect(t.T3).toMatchObject({ quorum: 0, threshold: 0, clusterFloor: 0 });
  });
});

describe("Forum Yönetmeliği", () => {
  const arts = model.sortedArticles();
  it("20–25 madde, fıkra numaraları \"Madde 9 (2)\" biçiminde ve tekil", () => {
    const articleNos = new Set(arts.map((a) => a.number.match(/^Madde (\d+)/)![1]));
    expect(articleNos.size).toBeGreaterThanOrEqual(20);
    expect(articleNos.size).toBeLessThanOrEqual(25);
    for (const a of arts) expect(a.number).toMatch(/^Madde \d+( \(\d+\))?$/);
    expect(new Set(arts.map((a) => a.number)).size).toBe(arts.length);
    for (const a of arts) {
      expect(a.text.length).toBeGreaterThan(20);
      expect(a.part).toBeTruthy();
    }
  });

  it("üç koruma düzeyi de kullanılır", () => {
    const levels = new Set(arts.map((a) => a.protection));
    expect(levels).toEqual(new Set(["Degistirilemez", "Nitelikli", "Olagan"]));
  });

  it("zorunlu değiştirilemez hükümler var", () => {
    const imm = (n: string) => arts.find((a) => a.number === n)!;
    const required: [string, RegExp][] = [
      ["Madde 3 (1)", /bir ve yalnızca bir oyu/],
      ["Madde 4 (1)", /Eşitlik ve ayrımcılık yasağı ile katılım ve oy hakkının özü oylamaya konulamaz/],
      ["Madde 5 (1)", /köprü testi.*0,20/s],
      ["Madde 5 (3)", /itiraz hakkı kaldırılamaz/],
      ["Madde 6 (1)", /değiştirilemez/],
      ["Madde 6 (2)", /yeni bir “Değiştirilemez” hüküm üretilemez/i],
      ["Madde 6 (3)", /döngü içeremez/],
      ["Madde 13 (2)", /Bilirkişi danışmandır/],
      ["Madde 14 (1)", /Yapay zekâ yalnızca danışmandır/],
      ["Madde 15 (1)", /Oylar gizlidir/],
      ["Madde 15 (2)", /kimliği arasındaki bağ/],
      ["Madde 19 (1)", /Tartışma kayıtları silinmez/],
      ["Madde 20 (2)", /Görüş ayrılığı.*silme gerekçesi olamaz/],
      ["Madde 21 (1)", /dağıtık defterde tutulmaz/],
    ];
    for (const [no, re] of required) {
      const a = imm(no);
      expect(a, no).toBeDefined();
      expect(a.protection, no).toBe("Degistirilemez");
      expect(a.text, no).toMatch(re);
    }
  });

  it("her kural ve parametre taşıyıcısı var olan bir maddeye dayanır", () => {
    for (const h of model.holders.values()) {
      expect(h.article, h.iri).toBeTruthy();
      expect(model.articles.has(h.article!), h.iri).toBe(true);
    }
  });

  it("koruma sınırları değiştirilemez maddelere dayanır", () => {
    for (const local of ["EsitOySinirlari", "AzinlikKorumaSinirlari", "KalicilastirmaSinirlari"]) expect(model.isImmutable(fy(local)), local).toBe(true);
    expect(model.setParam("kumeTabaniAsgari")).toBe(0.2);
    expect(model.setParam("yazarKumesiTabaniAsgari")).toBe(0.5);
    expect(model.setParam("oyAgirligi")).toBe(1);
  });

  it("N3 kural dosyası ayrıştırılır ve log:implies kuralları içerir", () => {
    const rules = parseN3(read("yonetmelik-kurallar.n3")).filter((q) => q.predicate.value === "http://www.w3.org/2000/10/swap/log#implies");
    expect(rules.length).toBeGreaterThanOrEqual(20);
  });

  it("yürürlükteki yönetmelik SHACL meta-şekillerine uyar (init hata vermez)", () => {
    expect(svc.current().version).toBe(1);
  });

  it("başlık/metin uzunluk sınırları tek kaynaktan: PROPOSAL_TEXT_LIMITS = SHACL şekilleri = Madde 7 (1)", () => {
    const shapes = parseTurtle(read("yonetmelik-sekiller.ttl"));
    const SH = "http://www.w3.org/ns/shacl#";
    const bound = (code: string, pred: string): number => {
      const node = shapes.find((q) => q.predicate.value === FY_NS + "bulguKodu" && q.object.value === code)!.subject;
      return Number(shapes.find((q) => q.subject.equals(node) && q.predicate.value === SH + pred)!.object.value);
    };
    const L = PROPOSAL_TEXT_LIMITS;
    expect([bound("title_length", "minLength"), bound("title_length", "maxLength")]).toEqual([L.titleMin, L.titleMax]);
    expect([bound("body_length", "minLength"), bound("body_length", "maxLength")]).toEqual([L.bodyMin, L.bodyMax]);
    const m71 = model.articles.get(fy("Madde_7_1"))!.text;
    expect(m71).toContain(`${L.titleMin} ile ${L.titleMax} karakter`);
    expect(m71).toContain(`${L.bodyMin} ile ${L.bodyMax} karakter`);
  });

  it("azınlık koruma sınırları μ_votes üst sınırını ve süre tabanlarını içerir (Madde 5)", () => {
    expect(model.setParam("kumeBasinaAsgariOyAzami")).toBe(3);
    for (const k of ["sureTartismaAsgari", "sureOylamaAsgari", "sureUzatmaAsgari", "sureUzlasmaAsgari"]) expect(model.setParam(k), k).toBe(24);
    // Varsayılan değerler sınırların içindedir
    const g = model.generalParams()!;
    expect(g.params.get("kumeBasinaAsgariOy")).toBeLessThanOrEqual(3);
  });
});
