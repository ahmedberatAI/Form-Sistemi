// Regresyon: yönetmelik yamasında IRI enjeksiyonu (#216) ve geçersiz IRI ile veritabanının zehirlenmesi (#217).
import { describe, expect, it } from "vitest";
import { fy, type AuditReport, type RegulationPatch, type RegulationPatchOp } from "@forum/shared";
import { makeCtx } from "../helpers/fakes";
import { createOntologyService } from "../../src/ontology";
import { AppError } from "../../src/core/errors";
import { hashQuads, parseTurtle, quad, namedNode, writeTurtle } from "../../src/ontology/rdf";
import { regulationPatchSchema } from "../../src/http/schemas";
import { isNewTermIri, isSafeIri } from "../../src/ontology/iri";

const RATIONALE = "Bu değişiklik topluluğun karar süreçlerini iyileştirmek için önerilmektedir.";
const patch = (...ops: RegulationPatchOp[]): RegulationPatch => ({ ops, rationale: RATIONALE });
const codes = (r: AuditReport) => r.violations.map((v) => v.code);

/** Bulgudaki saldırı dizgesi: tek bir "kategori ekle" işlemiyle KatmanT1 eşiğini 0,01'e çeken üçlü enjekte eder. */
const INJECTION =
  "https://forumsistemi.org/ont#Enj> <http://www.w3.org/2000/01/rdf-schema#subClassOf> <https://forumsistemi.org/ont#Kategori> . " +
  "<https://forumsistemi.org/ont#KatmanT1> <https://forumsistemi.org/ont#esik> '0.01'^^<http://www.w3.org/2001/XMLSchema#decimal> . " +
  "<https://forumsistemi.org/ont#Enj2";
const WHITESPACE = "https://forumsistemi.org/ont#Boş luk";

const addCategory = (iri: string): RegulationPatchOp => ({ op: "addCategory", iri, label: "Enjeksiyon", parent: fy("Kategori"), keywords: [] });

async function fresh() {
  const ctx = makeCtx();
  const svc = createOntologyService(ctx);
  await svc.init();
  return { ctx, svc };
}

describe("IRI biçim denetimi", () => {
  it("güvenli IRI'ler kabul edilir; boşluk ve yasak karakterler reddedilir", () => {
    expect(isSafeIri(fy("Ulasim"))).toBe(true);
    expect(isSafeIri("http://example.org/a?b=c#d")).toBe(true);
    for (const bad of [INJECTION, WHITESPACE, "javascript:alert(1)", "fy:Ulasim", "https://x.org/a<b", 'https://x.org/a"b', "https://x.org/{a}", "https://x.org/a|b", "https://x.org/a^b", "https://x.org/a`b", "https://x.org/a\\b", "https://x.org/a\nb", "*", ""])
      expect(isSafeIri(bad), JSON.stringify(bad)).toBe(false);
    expect(isNewTermIri(fy("YeniKategori_1"))).toBe(true);
    expect(isNewTermIri("https://example.org/ont#Yeni")).toBe(false);
    expect(isNewTermIri(fy("A.B"))).toBe(false);
  });

  it("HTTP şeması saldırı dizgelerini ve fy: dışı biçimleri reddeder", () => {
    expect(regulationPatchSchema.safeParse(patch(addCategory(INJECTION))).success).toBe(false);
    expect(regulationPatchSchema.safeParse(patch(addCategory(WHITESPACE))).success).toBe(false);
    expect(regulationPatchSchema.safeParse(patch({ op: "setParam", rule: INJECTION, param: "esik", value: 0.1 })).success).toBe(false);
    expect(regulationPatchSchema.safeParse(patch({ op: "amendArticleText", article: WHITESPACE, text: "x" })).success).toBe(false);
    const ok = regulationPatchSchema.safeParse(patch(addCategory("fy:YeniKategori")));
    expect(ok.success).toBe(true);
    if (ok.success) expect((ok.data.ops[0] as { iri: string }).iri).toBe(fy("YeniKategori"));
  });

  it("writeTurtle kaçışsız yazılamayan IRI'yi yazmaz", () => {
    const q = quad(namedNode(INJECTION), namedNode(fy("p")), namedNode(fy("o")));
    expect(() => writeTurtle([q])).toThrow(/yazılamayan IRI/);
    expect(() => writeTurtle([quad(namedNode(WHITESPACE), namedNode(fy("p")), namedNode(fy("o")))])).toThrow();
  });
});

describe("yama doğrulaması ve uygulaması", () => {
  it("saldırı dizgesi doğrulamada reddedilir (meta-kural atlatılamaz)", async () => {
    const { svc } = await fresh();
    for (const iri of [INJECTION, WHITESPACE, "https://example.org/ont#Yabanci"]) {
      const r = await svc.validatePatch(patch(addCategory(iri)));
      expect(r.admissible, iri).toBe(false);
      expect(codes(r), iri).toContain("patch_iri_invalid");
    }
    const p = await svc.validatePatch(patch({ op: "addArticle", iri: INJECTION, number: "Madde 25 (1)", title: "Enj", text: "Enjeksiyon.", protection: "Olagan" }));
    expect(p.admissible).toBe(false);
    expect(codes(p)).toContain("patch_iri_invalid");
  });

  it("yasak karakterli koruma düzeyi ve bağlantı değeri de Turtle'a ulaşmaz", async () => {
    const { svc } = await fresh();
    const prot = await svc.validatePatch(
      patch({ op: "addArticle", iri: fy("Madde_25_1"), number: "Madde 25 (1)", title: "Enj", text: "Enjeksiyon.", protection: "Olagan> <x:y> <x:z" as never }),
    );
    expect(prot.admissible).toBe(false);
    expect(codes(prot)).toContain("patch_invalid_protection");
    const link = await svc.validatePatch(patch({ op: "setParam", rule: fy("KuralImar"), param: "uygulanirSinif", value: INJECTION }));
    expect(link.admissible).toBe(false);
    expect(codes(link)).toContain("patch_iri_invalid");
  });

  it("uygulama reddedilince veritabanına sürüm yazılmaz; sonraki geçerli yama uygulanır", async () => {
    const { ctx, svc } = await fresh();
    const before = svc.adjustableParams().find((p) => p.rule === fy("KatmanT1") && p.param === "esik")!.value;
    for (const iri of [INJECTION, WHITESPACE]) {
      const err = await svc.applyPatch(patch(addCategory(iri)), "p-bad").catch((e) => e);
      expect(err, iri).toBeInstanceOf(AppError);
      expect((err as AppError).code).toBe("bylaw_patch_invalid");
      expect(svc.versions().map((v) => v.version)).toEqual([1]);
      expect(ctx.db.all<{ version: number }>("SELECT version FROM bylaw_versions").map((r) => r.version)).toEqual([1]);
      expect(svc.current().version).toBe(1);
    }
    expect(svc.adjustableParams().find((p) => p.rule === fy("KatmanT1") && p.param === "esik")!.value).toBe(before);
    expect(svc.exportTurtle()).not.toContain("Enj");

    const v2 = await svc.applyPatch(patch({ op: "addCategory", iri: "fy:HayvanRefahi", label: "Hayvan refahı", parent: fy("Cevre"), keywords: ["kedi"] }), "p-ok");
    expect(v2.version).toBe(2);
    // Yeniden başlatma: yeni bir hizmet son sürümü sorunsuz yükler
    const again = createOntologyService(ctx);
    await again.init();
    expect(again.current().version).toBe(2);
    expect(hashQuads(parseTurtle(again.exportTurtle(2)))).toBe(v2.hash);
  });
});
