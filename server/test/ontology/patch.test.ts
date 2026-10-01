import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { fy, rat, type AuditReport, type RegulationPatch, type RegulationPatchOp } from "@forum/shared";
import { SERVER_ROOT } from "../../src/core/config";
import { makeCtx, type TestCtx } from "../helpers/fakes";
import { createOntologyService } from "../../src/ontology";
import { AppError } from "../../src/core/errors";
import { hashQuads, parseTurtle, writeTurtle } from "../../src/ontology/rdf";
import type { OntologyService } from "../../src/core/contracts";

async function fresh(c: TestCtx = makeCtx()): Promise<{ ctx: TestCtx; svc: OntologyService }> {
  const svc = createOntologyService(c);
  await svc.init();
  return { ctx: c, svc };
}

const RATIONALE = "Bu değişiklik topluluğun karar süreçlerini iyileştirmek için önerilmektedir.";
const patch = (...ops: RegulationPatchOp[]): RegulationPatch => ({ ops, rationale: RATIONALE });
const codes = (r: AuditReport) => r.violations.map((v) => v.code);
const BODY = "Mahallemizde bu konuda somut bir iyileştirme yapılmasını öneriyorum.";

describe("validatePatch — meta-kurallar", () => {
  let svc: OntologyService;
  beforeAll(async () => {
    ({ svc } = await fresh());
  });

  it("olağan bir parametre değişikliği T2'de kabul edilebilir; nitelikli hükümde 3/4 ve 0,50", async () => {
    const r = await svc.validatePatch(
      patch(
        { op: "setParam", rule: fy("KuralImar"), param: "sureTartisma", value: 144 },
        { op: "amendArticleText", article: fy("Madde_24_2"), text: "İmar ve kentsel dönüşüm kategorisindeki (deprem güvenliği dahil) önerilerde tartışma süresi en az 144 saattir." },
      ),
    );
    expect(r.tier).toBe("T2");
    expect(r.admissible).toBe(true);
    expect(r.params).toMatchObject({ tier: "T2", quorum: rat(2, 5), threshold: rat(2, 3) });
    const q = await svc.validatePatch(patch({ op: "setParam", rule: fy("KatmanT0"), param: "yeterSayi", value: 0.25 }));
    expect(q.admissible).toBe(true);
    expect(q.params).toMatchObject({ quorum: rat(1, 2), threshold: rat(3, 4) });
    expect(q.inferredClasses).toContain(fy("NitelikliHukumDegisikligi"));
    expect(q.appliedRules.map((a) => a.iri)).toContain(fy("KuralNitelikliDegisiklik"));
  });

  it("0 < yeter sayı ≤ 1", async () => {
    for (const value of [0, -0.1, 1.2]) {
      const r = await svc.validatePatch(patch({ op: "setParam", rule: fy("KatmanT1"), param: "yeterSayi", value }));
      expect(r.admissible, String(value)).toBe(false);
      expect(codes(r)).toContain("param_range");
      expect(r.violations.find((v) => v.code === "param_range")!.message).toMatch(/^Madde 23 \(2\):/);
      expect(["T2", "T3"]).toContain(r.tier);
    }
  });

  it("0,5 ≤ eşik ≤ 1", async () => {
    const low = await svc.validatePatch(patch({ op: "setParam", rule: fy("KatmanT1"), param: "esik", value: 0.4 }));
    expect(low.tier).toBe("T2");
    expect(codes(low)).toContain("param_range");
    const high = await svc.validatePatch(patch({ op: "setParam", rule: fy("KatmanT1"), param: "esik", value: 1.1 }));
    expect(codes(high)).toContain("param_range");
    const ok = await svc.validatePatch(patch({ op: "setParam", rule: fy("KatmanT1"), param: "esik", value: 0.55 }));
    expect(ok.admissible).toBe(true);
  });

  it("değiştirilemez maddeyi değiştirmek ya da koruma düzeyini düşürmek → T3", async () => {
    const cases: RegulationPatchOp[] = [
      { op: "amendArticleText", article: fy("Madde_20_2"), text: "Görüş ayrılığı da bir silme gerekçesidir." },
      { op: "setProtection", article: fy("Madde_3_1"), protection: "Olagan" },
      { op: "setProtection", article: "fy:Madde_15_1", protection: "Nitelikli" },
      { op: "setParam", rule: fy("KuralHakKisitlamasi"), param: "asgariKatman", value: fy("KatmanT0") },
      { op: "setParam", rule: fy("EsitOySinirlari"), param: "oyAgirligi", value: 2 },
      { op: "setParam", rule: fy("AzinlikKorumaSinirlari"), param: "kumeTabaniAsgari", value: 0.05 },
    ];
    for (const op of cases) {
      const r = await svc.validatePatch(patch(op));
      expect(r.tier, JSON.stringify(op)).toBe("T3");
      expect(r.admissible).toBe(false);
      expect(r.params).toBeNull();
      const v = r.violations.find((f) => f.code === "immutable_target")!;
      expect(v, JSON.stringify(op)).toBeDefined();
      expect(v.message).toMatch(/^Madde 6 \(1\):/);
    }
  });

  it("yeni değiştirilemez hüküm üretilemez (doğrudan ya da dayanak/katman yoluyla)", async () => {
    const cases: RegulationPatchOp[][] = [
      [{ op: "setProtection", article: fy("Madde_24_1"), protection: "Degistirilemez" }],
      [{ op: "addArticle", iri: fy("Madde_25_1"), number: "Madde 25 (1)", title: "Kalıcı politika", text: "Bütçe önerileri her zaman reddedilir.", protection: "Degistirilemez" as never }],
      [
        { op: "setParam", rule: fy("KuralYeni"), param: "dayanak", value: fy("Madde_4_1") },
        { op: "setParam", rule: fy("KuralYeni"), param: "uygulanirSinif", value: fy("Spor") },
      ],
      [{ op: "setParam", rule: fy("KuralButce"), param: "dayanak", value: fy("Madde_19_1") }],
      [{ op: "setParam", rule: fy("KuralButce"), param: "asgariKatman", value: fy("KatmanT3") }],
    ];
    for (const ops of cases) {
      const r = await svc.validatePatch(patch(...ops));
      expect(r.tier, JSON.stringify(ops)).toBe("T3");
      const v = r.violations.find((f) => f.code === "new_immutable")!;
      expect(v, JSON.stringify(ops)).toBeDefined();
      expect(v.message).toMatch(/^Madde 6 \(2\):/);
    }
  });

  it("iki adımlı atlatma: değiştirilemez hükmü overrides eden yeni madde ya da kural → T3", async () => {
    const viaArticle = await svc.validatePatch(
      patch(
        { op: "addArticle", iri: fy("Madde_25_1"), number: "Madde 25 (1)", title: "Serbest silme", text: "Her gerekçe ile silme talep edilebilir.", protection: "Olagan" },
        { op: "setParam", rule: fy("Madde_25_1"), param: "overrides", value: fy("Madde_20_2") },
      ),
    );
    expect(viaArticle.tier).toBe("T3");
    expect(codes(viaArticle)).toContain("immutable_bypass");
    const viaRule = await svc.validatePatch(patch({ op: "setParam", rule: fy("KuralButce"), param: "overrides", value: fy("KuralHakKisitlamasi") }));
    expect(viaRule.tier).toBe("T3");
    expect(codes(viaRule)).toContain("immutable_bypass");
  });

  it("korumalı parametreyi taban altına çekmek → T3 (azınlık koruması)", async () => {
    const cases: [RegulationPatchOp, string][] = [
      [{ op: "setParam", rule: fy("KatmanT0"), param: "kumeTabani", value: 0.1 }, "Madde 5 (1)"],
      [{ op: "setParam", rule: fy("KatmanDEL"), param: "yazarKumesiTabani", value: 0.4 }, "Madde 5 (1)"],
      [{ op: "setParam", rule: fy("KatmanT1"), param: "asmaEsigi", value: 0.6 }, "Madde 5 (2)"],
      [{ op: "setParam", rule: fy("KatmanT0"), param: "sureItiraz", value: 12 }, "Madde 5 (3)"],
      [{ op: "setParam", rule: fy("GenelParametreler"), param: "anlamliKumePayi", value: 0.3 }, "Madde 5 (1)"],
      [{ op: "setParam", rule: fy("GenelParametreler"), param: "kopruIcinAsgariKumelenmis", value: 500 }, "Madde 5 (1)"],
    ];
    for (const [op, art] of cases) {
      const r = await svc.validatePatch(patch(op));
      expect(r.tier, JSON.stringify(op)).toBe("T3");
      const v = r.violations.find((f) => f.code === "protection_floor")!;
      expect(v, JSON.stringify(op)).toBeDefined();
      expect(v.articleLabel).toBe(art);
    }
    const ok = await svc.validatePatch(patch({ op: "setParam", rule: fy("KatmanT0"), param: "kumeTabani", value: 0.25 }));
    expect(ok.admissible).toBe(true);
  });

  it("köprü testi dolaylı yoldan kapatılamaz: μ_votes üst sınırı ve süre tabanları (denetim bulgusu 1) → T3", async () => {
    const cases: [RegulationPatchOp, string][] = [
      // μ_votes her kümeden büyük olursa her küme uzatmadan sonra "nötr" sayılır ve köprü testi fiilen kapanır
      [{ op: "setParam", rule: fy("GenelParametreler"), param: "kumeBasinaAsgariOy", value: 50 }, "Madde 5 (1)"],
      [{ op: "setParam", rule: fy("GenelParametreler"), param: "kumeBasinaAsgariOy", value: 4 }, "Madde 5 (1)"],
      [{ op: "setParam", rule: fy("KatmanT0"), param: "sureUzlasma", value: 0 }, "Madde 5 (2)"],
      [{ op: "setParam", rule: fy("KatmanT2"), param: "sureUzlasma", value: 12 }, "Madde 5 (2)"],
      [{ op: "setParam", rule: fy("KatmanT0"), param: "sureUzatma", value: 0 }, "Madde 5 (1)"],
      [{ op: "setParam", rule: fy("KatmanT1"), param: "sureTartisma", value: 0 }, "Madde 5 (1)"],
      [{ op: "setParam", rule: fy("KatmanT0"), param: "sureOylama", value: 12 }, "Madde 5 (1)"],
      [{ op: "setParam", rule: fy("KatmanDEL"), param: "sureTartisma", value: 0 }, "Madde 5 (1)"],
    ];
    for (const [op, art] of cases) {
      const r = await svc.validatePatch(patch(op));
      expect(r.tier, JSON.stringify(op)).toBe("T3");
      expect(r.admissible, JSON.stringify(op)).toBe(false);
      const v = r.violations.find((f) => f.code === "protection_floor")!;
      expect(v, JSON.stringify(op)).toBeDefined();
      expect(v.articleLabel, JSON.stringify(op)).toBe(art);
    }
    // Sınırın içindeki değişiklikler olağandır; DEL'in tasarım gereği 0 olan uzlaşma süresi sınırın dışındadır
    for (const op of [
      { op: "setParam", rule: fy("GenelParametreler"), param: "kumeBasinaAsgariOy", value: 3 },
      { op: "setParam", rule: fy("KatmanT0"), param: "sureUzlasma", value: 24 },
      { op: "setParam", rule: fy("KatmanT0"), param: "sureUzatma", value: 48 },
      { op: "setParam", rule: fy("KatmanDEL"), param: "sureOylama", value: 24 },
    ] as RegulationPatchOp[]) {
      const r = await svc.validatePatch(patch(op));
      expect(r.admissible, JSON.stringify(op)).toBe(true);
      expect(r.tier).toBe("T2");
    }
  });

  it("sınır üçlüsü olmayan eski bir sürümde de μ_votes ve süre sınırları kod varsayılanıyla uygulanır", async () => {
    const c = makeCtx();
    const ttl = readFileSync(join(SERVER_ROOT, "ontology", "yonetmelik.ttl"), "utf8")
      .replace(/ ; fy:kumeBasinaAsgariOyAzami 3 ;\s*fy:sureTartismaAsgari 24 ; fy:sureOylamaAsgari 24 ; fy:sureUzatmaAsgari 24 ; fy:sureUzlasmaAsgari 24 \./, " .");
    expect(ttl).not.toContain("kumeBasinaAsgariOyAzami");
    c.db.run("INSERT INTO bylaw_versions(version, ttl, hash, via_proposal_id, ledger_tx, created_at) VALUES (1, ?, ?, NULL, NULL, ?)", ttl, hashQuads(parseTurtle(ttl)), c.clock.now());
    const { svc: old } = await fresh(c);
    const mu = await old.validatePatch(patch({ op: "setParam", rule: fy("GenelParametreler"), param: "kumeBasinaAsgariOy", value: 50 }));
    expect(mu.tier).toBe("T3");
    expect(codes(mu)).toContain("protection_floor");
    const rec = await old.validatePatch(patch({ op: "setParam", rule: fy("KatmanT0"), param: "sureUzlasma", value: 0 }));
    expect(codes(rec)).toContain("protection_floor");
  });

  it("madde metni parametreyle çelişemez: değeri metinde geçen kural değişirse aynı yamada madde metni de güncellenmeli (Madde 23 (1))", async () => {
    // Madde 24 (4): "… oylama süresi en az 96 saattir." — değer düşürülürse metin yanlış olurdu
    const stale = await svc.validatePatch(patch({ op: "setParam", rule: fy("KuralSaglik"), param: "sureOylama", value: 72 }));
    expect(stale.admissible).toBe(false);
    expect(stale.tier).toBe("T2");
    const v = stale.violations.find((f) => f.code === "article_text_stale")!;
    expect(v).toBeDefined();
    expect(v.articleLabel).toBe("Madde 23 (1)");
    expect(v.message).toMatch(/Madde 24 \(4\) metni/);
    expect(v.message).toMatch(/96/);
    expect(v.message).toMatch(/amendArticleText/);
    // Aynı yamada metin de güncellenirse kabul edilebilir
    const fixed = await svc.validatePatch(
      patch(
        { op: "setParam", rule: fy("KuralSaglik"), param: "sureOylama", value: 72 },
        { op: "amendArticleText", article: fy("Madde_24_4"), text: "Sağlık kategorisindeki önerilerde oylama süresi en az 72 saattir." },
      ),
    );
    expect(fixed.admissible).toBe(true);
    // Oran parametreleri Türkçe ondalıkla eşleşir: Madde 12 (2) "(0,70)"; Madde 24 (1) "0,30"
    expect(codes(await svc.validatePatch(patch({ op: "setParam", rule: fy("KuralIcerikEtiketi"), param: "yuksekGuvenEsigi", value: 0.8 })))).toContain("article_text_stale");
    expect(codes(await svc.validatePatch(patch({ op: "setParam", rule: fy("KuralButce"), param: "yeterSayi", value: 0.35 })))).toContain("article_text_stale");
    // Metninde sayı geçmeyen dayanak (Madde 9 (2)) için ek adım gerekmez
    expect(codes(await svc.validatePatch(patch({ op: "setParam", rule: fy("KatmanT0"), param: "sureTartisma", value: 96 })))).not.toContain("article_text_stale");
  });

  it("kalıcılaştırma sınırları ve eşit oy sınırları → T3", async () => {
    const cap = await svc.validatePatch(patch({ op: "setParam", rule: fy("KuralButce"), param: "esik", value: 1 }));
    expect(cap.tier).toBe("T3");
    expect(codes(cap)).toContain("entrenchment_cap");
    const dur = await svc.validatePatch(patch({ op: "setParam", rule: fy("KuralImar"), param: "sureTartisma", value: 2000 }));
    expect(codes(dur)).toContain("entrenchment_cap");
    const deleg = await svc.validatePatch(patch({ op: "setParam", rule: fy("GenelParametreler"), param: "vekaletSiniriOrani", value: 0.5 }));
    expect(deleg.tier).toBe("T3");
    expect(codes(deleg)).toContain("equal_vote_limit");
  });

  it("overrides döngüsüz olmalı ve var olan hükmü göstermeli", async () => {
    const cyc = await svc.validatePatch(
      patch(
        { op: "setParam", rule: fy("KuralButce"), param: "overrides", value: fy("KuralImar") },
        { op: "setParam", rule: fy("KuralImar"), param: "overrides", value: fy("KuralButce") },
      ),
    );
    expect(cyc.tier).toBe("T2");
    expect(cyc.admissible).toBe(false);
    const v = cyc.violations.find((f) => f.code === "overrides_cycle")!;
    expect(v.message).toMatch(/^Madde 6 \(3\):/);
    expect(v.message).toMatch(/KuralButce → KuralImar → KuralButce/);
    const dangling = await svc.validatePatch(patch({ op: "setParam", rule: fy("KuralButce"), param: "overrides", value: fy("KuralYok") }));
    expect(codes(dangling)).toContain("overrides_target");
  });

  it("yapısal hatalar: bilinmeyen parametre / işlem / madde, uygunsuz parametre, dayanaksız yeni kural", async () => {
    expect(codes(await svc.validatePatch(patch({ op: "setParam", rule: fy("KatmanT0"), param: "uydurma", value: 1 })))).toContain("patch_unknown_param");
    expect(codes(await svc.validatePatch(patch({ op: "setParam", rule: fy("GenelParametreler"), param: "esik", value: 0.6 })))).toContain("patch_param_not_applicable");
    expect(codes(await svc.validatePatch(patch({ op: "amendArticleText", article: fy("Madde_99"), text: "Yeni bir madde metni burada." })))).toContain("patch_article_missing");
    expect(codes(await svc.validatePatch(patch({ op: "silHepsini" } as never)))).toContain("patch_unknown_op");
    expect(codes(await svc.validatePatch(patch({ op: "setParam", rule: fy("KatmanT0"), param: "sureOylama", value: 1.5 })))).toContain("patch_value_type");
    const noBasis = await svc.validatePatch(patch({ op: "setParam", rule: fy("KuralYeni"), param: "uygulanirSinif", value: fy("Spor") }, { op: "setParam", rule: fy("KuralYeni"), param: "esik", value: 0.7 }));
    expect(codes(noBasis)).toContain("rule_without_article");
    expect(codes(await svc.validatePatch(patch()))).toContain("patch_empty");
    expect(codes(await svc.validatePatch(patch({ op: "addCategory", iri: fy("Saglik"), label: "Sağlık", parent: fy("Kategori"), keywords: [] })))).toContain("patch_category_exists");
  });
});

describe("applyPatch — sürümleme", () => {
  it("yeni sürüm, yeni özet; sonraki denetimler yeni değeri kullanır; Turtle dışa aktarımı", async () => {
    const { ctx, svc } = await fresh();
    const v1 = svc.current();
    const p = patch({ op: "setParam", rule: fy("KatmanT0"), param: "yeterSayi", value: 0.25 }, { op: "amendArticleText", article: fy("Madde_24_4"), text: "Sağlık kategorisindeki önerilerde oylama süresi en az 120 saattir." }, { op: "setParam", rule: fy("KuralSaglik"), param: "sureOylama", value: 120 });
    ctx.clock.advance(3_600_000);
    const v2 = await svc.applyPatch(p, "oneri-42");
    expect(v2).toMatchObject({ version: 2, viaProposalId: "oneri-42", ledgerTx: null, createdAt: ctx.clock.now() });
    expect(v2.hash).not.toBe(v1.hash);
    expect(svc.current()).toEqual(v2);
    expect(svc.versions().map((v) => v.version)).toEqual([1, 2]);

    const r = await svc.audit({ kind: "topic", title: "Aşı kampanyası", body: BODY, categories: [fy("HalkSagligi")], verifiedMembers: 40 });
    expect(r.bylawVersion).toBe(2);
    expect(r.bylawHash).toBe(v2.hash);
    expect(r.params!.quorum).toEqual(rat(1, 4));
    expect(r.params!.durationsHours.voting).toBe(120);
    expect(svc.articles().find((a) => a.iri === fy("Madde_24_4"))!.text).toMatch(/120 saattir/);

    // Turtle: sürüm 2 yeniden ayrıştırıldığında aynı özeti verir; sürüm 1 özgün dosyadır
    const ttl2 = svc.exportTurtle();
    expect(ttl2).toBe(svc.exportTurtle(2));
    expect(hashQuads(parseTurtle(ttl2))).toBe(v2.hash);
    expect(hashQuads(parseTurtle(svc.exportTurtle(1)))).toBe(v1.hash);
    expect(svc.exportTurtle(1)).toMatch(/FORUM YÖNETMELİĞİ/);
    expect(() => svc.exportTurtle(9)).toThrow(AppError);

    // Yeniden başlatma: aynı veritabanından son sürüm yüklenir
    const again = createOntologyService(ctx);
    await again.init();
    expect(again.current().version).toBe(2);
    const r2 = await again.audit({ kind: "topic", title: "Aşı kampanyası", body: BODY, categories: [fy("HalkSagligi")], verifiedMembers: 40 });
    expect(r2.params!.quorum).toEqual(rat(1, 4));
  });

  it("geçersiz yama uygulanmaz (422) ve sürüm değişmez", async () => {
    const { svc } = await fresh();
    await expect(svc.applyPatch(patch({ op: "setProtection", article: fy("Madde_6_2"), protection: "Olagan" }), "p1")).rejects.toMatchObject({ status: 422, code: "bylaw_patch_invalid" });
    expect(svc.current().version).toBe(1);
  });

  it("iki adımlı atlatma iki ayrı yamaya bölünse de yakalanır", async () => {
    const { svc } = await fresh();
    await svc.applyPatch(patch({ op: "addArticle", iri: fy("Madde_25_1"), number: "Madde 25 (1)", title: "Özel hüküm", text: "Bu madde kategoriye özgü özel bir hükümdür.", protection: "Olagan" }), "p1");
    expect(svc.articles().find((a) => a.iri === fy("Madde_25_1"))).toMatchObject({ number: "Madde 25 (1)", protection: "Olagan" });
    const step2 = await svc.validatePatch(patch({ op: "setParam", rule: fy("Madde_25_1"), param: "overrides", value: fy("Madde_5_1") }));
    expect(step2.tier).toBe("T3");
    expect(codes(step2)).toContain("immutable_bypass");
    // Önce koruma düzeyini yükseltip sonra kalıcılaştırmak da mümkün değil
    const step2b = await svc.validatePatch(patch({ op: "setProtection", article: fy("Madde_25_1"), protection: "Degistirilemez" }));
    expect(codes(step2b)).toContain("new_immutable");
  });

  it("overrides anlamı: özel kural genel kuralın parametre katkısını devre dışı bırakır", async () => {
    const { svc } = await fresh();
    await svc.applyPatch(
      patch(
        { op: "setParam", rule: fy("KuralKatilimciButce"), param: "dayanak", value: fy("Madde_24_1") },
        { op: "setParam", rule: fy("KuralKatilimciButce"), param: "uygulanirSinif", value: fy("KatilimciButce") },
        { op: "setParam", rule: fy("KuralKatilimciButce"), param: "overrides", value: fy("KuralButce") },
        { op: "setParam", rule: fy("KuralKatilimciButce"), param: "sureTartisma", value: 80 },
      ),
      "p1",
    );
    const r = await svc.audit({ kind: "topic", title: "Mahalle bütçesi", body: BODY, categories: [fy("KatilimciButce")], verifiedMembers: 40 });
    const rules = r.appliedRules.map((a) => a.iri);
    expect(rules).toContain(fy("KuralKatilimciButce"));
    expect(rules).not.toContain(fy("KuralButce"));
    expect(r.params!.quorum).toEqual(rat(1, 5));
    expect(r.params!.durationsHours.deliberation).toBe(80);
    expect(r.infos.map((i) => i.code)).toContain("rule_overridden");
    // Nitelikli kuralı (bilirkişi kategorisi, Madde 13 (1)) devre dışı bırakmak nitelikli çoğunluk ister
    const q = await svc.validatePatch(
      patch(
        { op: "setParam", rule: fy("KuralSporBilirkisiz"), param: "dayanak", value: fy("Madde_24_1") },
        { op: "setParam", rule: fy("KuralSporBilirkisiz"), param: "uygulanirSinif", value: fy("Butce") },
        { op: "setParam", rule: fy("KuralSporBilirkisiz"), param: "overrides", value: fy("KuralBilirkisiKategorisi") },
      ),
    );
    expect(q.admissible).toBe(true);
    expect(q.inferredClasses).toContain(fy("NitelikliHukumDegisikligi"));
    expect(q.params).toMatchObject({ threshold: rat(3, 4), quorum: rat(1, 2) });
    await svc.applyPatch(
      patch(
        { op: "setParam", rule: fy("KuralSporBilirkisiz"), param: "dayanak", value: fy("Madde_24_1") },
        { op: "setParam", rule: fy("KuralSporBilirkisiz"), param: "uygulanirSinif", value: fy("Butce") },
        { op: "setParam", rule: fy("KuralSporBilirkisiz"), param: "overrides", value: fy("KuralBilirkisiKategorisi") },
      ),
      "p2",
    );
    const b = await svc.audit({ kind: "topic", title: "Mahalle bütçesi", body: BODY, categories: [fy("KatilimciButce")], verifiedMembers: 40 });
    expect(b.requiresExpert).toBe(false);
    expect(b.appliedRules.map((a) => a.iri)).not.toContain(fy("KuralBilirkisiKategorisi"));
    // Değiştirilemez maddeye dayanan kural hiçbir zaman devre dışı kalmaz
    const t = await svc.audit({ kind: "topic", title: "Mahalle bütçesi", body: BODY, categories: [fy("KatilimciButce")], verifiedMembers: 40, rightsAffected: [{ right: fy("MulkiyetHakki"), direction: "restrict", source: "author" }] });
    expect(t.tier).toBe("T1");
  });

  it("yeni kategori eklenir ve hemen kullanılabilir", async () => {
    const { svc } = await fresh();
    await svc.applyPatch(patch({ op: "addCategory", iri: "fy:HayvanRefahi", label: "Hayvan refahı", parent: fy("Cevre"), keywords: ["Kedi", "köpek", "barınak"], requiresExpert: false }), "p1");
    expect(svc.ancestors("fy:HayvanRefahi")).toEqual([fy("HayvanRefahi"), fy("Cevre")]);
    expect(svc.depth(fy("HayvanRefahi"))).toBe(1);
    expect(svc.keywordIndex().find((k) => k.iri === fy("HayvanRefahi"))!.keywords).toEqual(["barınak", "kedi", "köpek"]);
    const r = await svc.audit({ kind: "topic", title: "Barınak", body: BODY, categories: ["fy:HayvanRefahi"], verifiedMembers: 40 });
    expect(r.categories).toEqual([fy("HayvanRefahi"), fy("Cevre")]);
  });

  it("Turtle yazımı belirlenimci ve özet kararlı", async () => {
    const { svc } = await fresh();
    const quads = parseTurtle(svc.exportTurtle(1));
    const a = writeTurtle(quads);
    const b = writeTurtle([...quads].reverse());
    expect(a).toBe(b);
    expect(hashQuads(parseTurtle(a))).toBe(hashQuads(quads));
  });
});
