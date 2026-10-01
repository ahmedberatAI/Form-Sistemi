import { beforeAll, describe, expect, it } from "vitest";
import { CATEGORY_VOCAB, FY_NS, fy, type CategoryNode } from "@forum/shared";
import { makeCtx } from "../helpers/fakes";
import { createOntologyService } from "../../src/ontology";
import type { OntologyService } from "../../src/core/contracts";

let svc: OntologyService;
beforeAll(async () => {
  svc = createOntologyService(makeCtx());
  await svc.init();
});

function flatten(nodes: CategoryNode[]): CategoryNode[] {
  return nodes.flatMap((n) => [n, ...flatten(n.children)]);
}

describe("kategori ağacı", () => {
  it("kökler ve çocuklar etikete göre sıralı, IRI'ler tam", () => {
    const roots = svc.categories();
    expect(roots.length).toBe(CATEGORY_VOCAB.filter((c) => c.parent === null).length);
    const sorted = (arr: CategoryNode[]) => arr.map((n) => n.label).join("|") === [...arr].sort((a, b) => a.label.localeCompare(b.label, "tr")).map((n) => n.label).join("|");
    expect(sorted(roots)).toBe(true);
    const all = flatten(roots);
    expect(all.length).toBe(CATEGORY_VOCAB.length);
    for (const n of all) {
      expect(n.iri.startsWith(FY_NS)).toBe(true);
      expect(sorted(n.children)).toBe(true);
      for (const c of n.children) expect(c.parent).toBe(n.iri);
    }
    for (const r of roots) expect(r.parent).toBeNull();
  });

  it("bilirkişi gereksinimi üst kategoriden miras kalır", () => {
    const all = Object.fromEntries(flatten(svc.categories()).map((n) => [n.iri, n]));
    expect(all[fy("Imar")].requiresExpert).toBe(true);
    expect(all[fy("Konut")].requiresExpert).toBe(true); // Konut kendisi işaretli değil, İmar'dan miras
    expect(all[fy("KatilimciButce")].requiresExpert).toBe(true);
    expect(all[fy("Spor")].requiresExpert).toBe(false);
  });

  it("ancestors / depth / isSubCategoryOf", () => {
    expect(svc.ancestors(fy("HalkSagligi"))).toEqual([fy("HalkSagligi"), fy("Saglik")]);
    expect(svc.ancestors("fy:HalkSagligi")).toEqual([fy("HalkSagligi"), fy("Saglik")]);
    expect(svc.ancestors(fy("Saglik"))).toEqual([fy("Saglik")]);
    expect(svc.ancestors("*")).toEqual(["*"]);
    expect(svc.depth(fy("Saglik"))).toBe(0);
    expect(svc.depth(fy("HalkSagligi"))).toBe(1);
    expect(svc.depth("fy:YokBoyleKategori")).toBe(0);
    expect(svc.isSubCategoryOf(fy("HalkSagligi"), fy("Saglik"))).toBe(true);
    expect(svc.isSubCategoryOf("fy:HalkSagligi", "fy:HalkSagligi")).toBe(true);
    expect(svc.isSubCategoryOf(fy("Saglik"), fy("HalkSagligi"))).toBe(false);
    expect(svc.isSubCategoryOf(fy("TopluTasima"), fy("Saglik"))).toBe(false);
    expect(svc.isSubCategoryOf(fy("TopluTasima"), "*")).toBe(true);
    expect(svc.isSubCategoryOf(fy("TopluTasima"), fy("Kategori"))).toBe(true);
  });

  it("categoryLabel ve keywordIndex", () => {
    expect(svc.categoryLabel(fy("DepremGuvenligi"))).toBe("Deprem güvenliği");
    expect(svc.categoryLabel("fy:Imar")).toBe("İmar ve kentsel dönüşüm");
    expect(svc.categoryLabel("*")).toMatch(/Tüm kategoriler/);
    const idx = svc.keywordIndex();
    expect(idx.length).toBe(CATEGORY_VOCAB.length);
    expect(idx.find((x) => x.iri === fy("TopluTasima"))!.keywords).toContain("otobüs");
  });
});

describe("haklar, maddeler, gerekçeler, etiketler, parametreler", () => {
  it("rights(): çekirdek haklar Madde 4 (1)'e dayanır", () => {
    const r = Object.fromEntries(svc.rights().map((x) => [x.iri, x]));
    expect(r[fy("EsitlikAyrimcilikYasagi")].article).toBe(fy("Madde_4_1"));
    expect(r[fy("KatilimHakki")].article).toBe(fy("Madde_4_1"));
    expect(r[fy("IfadeOzgurlugu")].article).toBe(fy("Madde_4_2"));
    expect(r[fy("IfadeOzgurlugu")].description.length).toBeGreaterThan(10);
  });

  it("articles(): sıralı, koruma düzeyli, bölümlü", () => {
    const a = svc.articles();
    expect(a[0].number).toBe("Madde 1 (1)");
    expect(a.find((x) => x.iri === fy("Madde_20_2"))).toMatchObject({ number: "Madde 20 (2)", protection: "Degistirilemez", title: "Silme (karartma)" });
    expect(a.every((x) => !!x.part)).toBe(true);
  });

  it("deletionGrounds(): geçersiz gerekçe de döner ama açıklamada geçersiz olduğu yazar", () => {
    const g = svc.deletionGrounds();
    const ga = g.find((x) => x.iri === fy("GorusAyriligi"))! as { description: string; invalid?: boolean };
    expect(ga.description).toMatch(/GEÇERSİZ/);
    expect(ga.description).toMatch(/Madde 20 \(2\)/);
    expect(ga.invalid).toBe(true);
    expect(g[g.length - 1].iri).toBe(fy("GorusAyriligi"));
    const kv = g.find((x) => x.iri === fy("KisiselVeriIfsasi"))! as { urgent?: boolean; sealed?: boolean };
    expect(kv.urgent).toBe(true);
    expect(kv.sealed).toBe(true);
    expect(g.find((x) => x.iri === fy("Tehdit"))!.urgent).toBe(true);
    expect(g.find((x) => x.iri === fy("Spam"))!.urgent).toBeFalsy();
  });

  it("objectionGrounds() ve contentLabels()", () => {
    expect(svc.objectionGrounds().map((x) => x.iri)).toContain(fy("TemelHakIhlali"));
    const cl = svc.contentLabels();
    expect(cl.find((x) => x.iri === fy("NefretSoylemi"))!.label).toBe("Nefret söylemi");
    expect(cl.length).toBe(6);
  });

  it("adjustableParams(): değiştirilemez olanlar işaretli", () => {
    const ps = svc.adjustableParams();
    const find = (rule: string, param: string) => ps.find((p) => p.rule === fy(rule) && p.param === param);
    expect(find("KatmanT0", "yeterSayi")).toMatchObject({ value: 0.2, immutable: false });
    expect(find("KatmanT0", "yeterSayi")!.label).toMatch(/Olağan karar · Yeter sayı \(q\)/);
    expect(find("GenelParametreler", "bilirkisiSayisi")).toMatchObject({ value: 3, immutable: false });
    expect(find("KuralButce", "yeterSayi")).toMatchObject({ value: 0.3, immutable: false });
    expect(find("KuralIcerikEtiketi", "yuksekGuvenEsigi")).toMatchObject({ value: 0.7, immutable: false });
    expect(find("AzinlikKorumaSinirlari", "kumeTabaniAsgari")).toMatchObject({ value: 0.2, immutable: true });
    expect(find("EsitOySinirlari", "oyAgirligi")).toMatchObject({ value: 1, immutable: true });
    expect(find("KuralDanismaYukseltmesi", "bilirkisiGerekli")).toMatchObject({ value: true, immutable: true });
    expect(ps[0].rule).toBe(fy("KatmanT0"));
  });
});
