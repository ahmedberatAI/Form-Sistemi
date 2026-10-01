import { beforeAll, describe, expect, it } from "vitest";
import { PROPOSAL_TEXT_LIMITS, fy, rat, sponsorsRequired, type AuditReport } from "@forum/shared";
import { makeCtx, type TestCtx } from "../helpers/fakes";
import { createOntologyService } from "../../src/ontology";
import type { OntologyService, ProposalAuditInput } from "../../src/core/contracts";

let ctx: TestCtx;
let svc: OntologyService;
beforeAll(async () => {
  ctx = makeCtx();
  svc = createOntologyService(ctx);
  await svc.init();
});

const BODY = "Mahallemizde bu konuda somut bir iyileştirme yapılmasını öneriyorum.";

function topic(over: Partial<ProposalAuditInput> = {}): ProposalAuditInput {
  return { kind: "topic", title: "Otobüs seferleri artırılsın", body: BODY, categories: [fy("TopluTasima")], verifiedMembers: 40, ...over };
}

const codes = (fs: AuditReport["violations"]) => fs.map((f) => f.code);

describe("katman belirleme", () => {
  it("konu → T0, kabul edilebilir, parametreler T0 tablosu", async () => {
    const r = await svc.audit(topic());
    expect(r.tier).toBe("T0");
    expect(r.admissible).toBe(true);
    expect(r.violations).toEqual([]);
    expect(r.params).toMatchObject({
      tier: "T0",
      quorum: rat(1, 5),
      threshold: rat(1, 2),
      thresholdStrict: true,
      clusterFloor: rat(3, 10),
      authorClusterFloor: null,
      overrideThreshold: rat(2, 3),
      revoteThreshold: rat(3, 5),
      significantShare: rat(1, 10),
      significantMinMembers: 3,
      minVotesPerCluster: 2,
      minClusteredForBridge: 12,
      coldStartBump: rat(1, 10),
      delegationCapFraction: rat(1, 20),
      delegationMaxHops: 3,
      requiresExpert: false,
      expertCount: 3,
      expertDomains: [],
      durationsHours: { sponsoring: 168, deliberation: 72, voting: 72, extension: 24, objection: 48, reconciliation: 72 },
    });
    expect(r.appliedRules.map((a) => a.iri)).toContain(fy("KuralKonuOnerisi"));
    expect(r.appliedRules.find((a) => a.iri === fy("KuralKonuOnerisi"))!.articleLabel).toBe("Madde 9 (1)");
    expect(r.bylawVersion).toBe(1);
    expect(r.bylawHash).toMatch(/^[0-9a-f]{64}$/);
    expect(r.checkedAt).toBe(ctx.clock.now());
  });

  it("alt konu (etkin üst konu) → T0, düzenleme → T1, yönetmelik → T2, silme → DEL", async () => {
    const sub = await svc.audit(topic({ kind: "subtopic", parentTopic: { id: "k1", categories: [fy("Ulasim")], status: "active" } }));
    expect(sub.tier).toBe("T0");
    expect(sub.admissible).toBe(true);
    const am = await svc.audit(topic({ kind: "amendment", parentTopic: { id: "k1", categories: [], status: "active" }, amendment: { baseVersion: 2, currentVersion: 2 } }));
    expect(am.tier).toBe("T1");
    expect(am.admissible).toBe(true);
    expect(am.warnings).toEqual([]);
    expect(am.params!.threshold).toEqual(rat(3, 5));
    const reg = await svc.audit(
      topic({
        kind: "regulation",
        categories: [],
        regulationPatch: {
          ops: [
            { op: "setParam", rule: fy("KuralImar"), param: "sureTartisma", value: 144 },
            // Madde 23 (1): değeri metninde anan dayanak madde aynı yamada güncellenir
            { op: "amendArticleText", article: fy("Madde_24_2"), text: "İmar ve kentsel dönüşüm kategorisindeki (deprem güvenliği dahil) önerilerde tartışma süresi en az 144 saattir." },
          ],
          rationale: "x",
        },
      }),
    );
    expect(reg.tier).toBe("T2");
    expect(reg.admissible).toBe(true);
    expect(reg.categories).toContain(fy("ForumYonetmeligi"));
    const del = await svc.audit({ kind: "deletion", title: "Tehdit içeren mesaj gizlensin", body: BODY, categories: [], verifiedMembers: 40, deletion: { ground: fy("Tehdit"), messageCount: 2 } });
    expect(del.tier).toBe("DEL");
    expect(del.admissible).toBe(true);
  });

  it("bir temel hak kısıtlanıyorsa konu T1 olur; genişletme katmanı değiştirmez", async () => {
    const r = await svc.audit(topic({ rightsAffected: [{ right: fy("IfadeOzgurlugu"), direction: "restrict", source: "author" }] }));
    expect(r.tier).toBe("T1");
    expect(r.admissible).toBe(true);
    expect(r.rightsAffected).toEqual([fy("IfadeOzgurlugu")]);
    expect(r.inferredClasses).toContain(fy("HakKisitlayanOneri"));
    expect(r.appliedRules.map((a) => a.iri)).toContain(fy("KuralHakKisitlamasi"));
    expect(r.params).toMatchObject({ tier: "T1", quorum: rat(3, 10), threshold: rat(3, 5), thresholdStrict: false, clusterFloor: rat(2, 5) });
    const e = await svc.audit(topic({ rightsAffected: [{ right: fy("ErisimHakki"), direction: "expand", source: "author" }] }));
    expect(e.tier).toBe("T0");
  });

  it("özü oylanamaz hakkın yazar/bilirkişi kaynaklı kısıtlaması → T3 ihlali (maddeye atıf)", async () => {
    for (const source of ["author", "expert"] as const) {
      const r = await svc.audit(topic({ rightsAffected: [{ right: fy("EsitlikAyrimcilikYasagi"), direction: "restrict", source }] }));
      expect(r.tier).toBe("T3");
      expect(r.admissible).toBe(false);
      expect(r.params).toBeNull();
      const v = r.violations.find((f) => f.code === "core_right_restricted")!;
      expect(v).toBeDefined();
      expect(v.message).toMatch(/^Madde 4 \(1\):/);
      expect(v.message).toMatch(/Eşitlik ve ayrımcılık yasağı/);
      expect(v.article).toBe(fy("Madde_4_1"));
      expect(v.articleLabel).toBe("Madde 4 (1)");
    }
  });

  it("YZ ya da üye kaynaklı bayrak yalnızca yükseltir: T1 + uyarı + bilirkişi, asla T3", async () => {
    for (const source of ["ai", "member"] as const) {
      const r = await svc.audit(topic({ rightsAffected: [{ right: fy("KatilimHakki"), direction: "restrict", source }] }));
      expect(r.tier).toBe("T1");
      expect(r.admissible).toBe(true);
      expect(r.violations).toEqual([]);
      const w = r.warnings.find((f) => f.code === "advisory_core_right_flag")!;
      expect(w.message).toMatch(/^Madde 14 \(2\):/);
      expect(r.requiresExpert).toBe(true);
      expect(r.params!.requiresExpert).toBe(true);
      expect(r.params!.expertDomains).toEqual([fy("TopluTasima")]);
    }
  });

  it("bağlayıcı ve danışma kaynağı birlikteyse bağlayıcı kazanır (T3)", async () => {
    const r = await svc.audit(
      topic({
        rightsAffected: [
          { right: fy("KatilimHakki"), direction: "restrict", source: "ai" },
          { right: fy("KatilimHakki"), direction: "restrict", source: "author" },
        ],
      }),
    );
    expect(r.tier).toBe("T3");
  });
});

describe("içerik etiketleri", () => {
  const withLabel = (confidence: number, source: "ai" | "rule" | "expert" = "ai") => topic({ contentLabels: [{ label: fy("NefretSoylemi"), confidence, source }] });
  it("kural tabanlı tespit ya da bilirkişi teyidi, güven ≥ 0,70 → ihlal (Madde 12 (2))", async () => {
    for (const source of ["rule", "expert"] as const) {
      for (const c of [0.7, 0.95]) {
        const r = await svc.audit(withLabel(c, source));
        expect(r.admissible, `${source} ${c}`).toBe(false);
        const v = r.violations.find((f) => f.code === "content_label_high")!;
        expect(v.message).toMatch(/^Madde 12 \(2\):/);
        expect(v.message).toMatch(/Nefret söylemi/);
        expect(r.warnings.map((w) => w.code)).not.toContain("content_label_ai_high");
      }
    }
  });
  it("YZ etiketi, güven ≥ 0,70 olsa bile öneriyi tek başına durduramaz: uyarı + bilirkişi (Madde 14 (1))", async () => {
    for (const c of [0.7, 0.95]) {
      const r = await svc.audit(withLabel(c, "ai"));
      expect(r.admissible, String(c)).toBe(true);
      expect(r.violations).toEqual([]);
      expect(r.tier).toBe("T0");
      const w = r.warnings.find((f) => f.code === "content_label_ai_high")!;
      expect(w.message).toMatch(/^Madde 12 \(2\):/);
      expect(w.message).toMatch(/Nefret söylemi/);
      expect(r.requiresExpert).toBe(true);
      expect(r.params!.requiresExpert).toBe(true);
      expect(r.params!.expertDomains).toEqual([fy("TopluTasima")]);
    }
    // YZ ve bilirkişi teyidi birlikteyse teyit kazanır (ihlal)
    const both = await svc.audit(
      topic({
        contentLabels: [
          { label: fy("NefretSoylemi"), confidence: 0.9, source: "ai" },
          { label: fy("NefretSoylemi"), confidence: 0.9, source: "expert" },
        ],
      }),
    );
    expect(both.admissible).toBe(false);
  });
  it("0,40 ≤ güven < 0,70 → uyarı + bilirkişi", async () => {
    for (const c of [0.4, 0.55, 0.6999]) {
      const r = await svc.audit(withLabel(c));
      expect(r.admissible).toBe(true);
      expect(codes(r.warnings)).toContain("content_label_medium");
      expect(r.requiresExpert).toBe(true);
      expect(r.params!.requiresExpert).toBe(true);
    }
  });
  it("güven < 0,40 → etkisiz", async () => {
    const r = await svc.audit(withLabel(0.39));
    expect(r.admissible).toBe(true);
    expect(r.warnings).toEqual([]);
    expect(r.requiresExpert).toBe(false);
  });
});

describe("silme (karartma)", () => {
  const del = (ground: string, messageCount = 1): ProposalAuditInput => ({
    kind: "deletion",
    title: "Mesajın gizlenmesi talebi",
    body: BODY,
    categories: [],
    verifiedMembers: 40,
    deletion: { ground, messageCount },
  });

  it("“Görüş ayrılığı” geçersiz → değiştirilemez maddeye atıflı ihlal", async () => {
    const r = await svc.audit(del(fy("GorusAyriligi")));
    expect(r.tier).toBe("DEL");
    expect(r.admissible).toBe(false);
    const v = r.violations.find((f) => f.code === "deletion_ground_invalid")!;
    expect(v.message).toMatch(/Madde/);
    expect(v.message).toMatch(/^Madde 20 \(2\):/);
    expect(v.article).toBe(fy("Madde_20_2"));
    expect(r.appliedRules.map((a) => a.iri)).toContain(fy("KuralGorusAyriligi"));
  });

  it("geçerli acil gerekçe: DEL parametreleri, K_s = 1, daraltma ve mühür bilgisi", async () => {
    const r = await svc.audit(del(fy("KisiselVeriIfsasi"), 3));
    expect(r.admissible).toBe(true);
    expect(r.params).toMatchObject({
      tier: "DEL",
      quorum: rat(3, 10),
      threshold: rat(2, 3),
      thresholdStrict: false,
      clusterFloor: rat(3, 10),
      authorClusterFloor: rat(1, 2),
      overrideThreshold: rat(3, 4),
      revoteThreshold: rat(3, 4),
      sponsorsRequired: 1,
      durationsHours: { sponsoring: 72, deliberation: 24, voting: 48, extension: 24, objection: 0, reconciliation: 0 },
    });
    expect(codes(r.infos)).toEqual(expect.arrayContaining(["deletion_urgent", "deletion_sealed"]));
    expect(r.inferredClasses).toEqual(expect.arrayContaining([fy("AcilSilmeTalebi"), fy("MuhurluSilmeTalebi")]));
  });

  it("Tehdit acildir ama mühürlenmez; diğer gerekçeler ne acil ne mühürlü (N3 eşleşme hatasına karşı olumsuz test)", async () => {
    const t = await svc.audit(del(fy("Tehdit"), 1));
    expect(t.admissible).toBe(true);
    expect(t.inferredClasses).toContain(fy("AcilSilmeTalebi"));
    expect(t.inferredClasses).not.toContain(fy("MuhurluSilmeTalebi"));
    expect(codes(t.infos)).toContain("deletion_urgent");
    expect(codes(t.infos)).not.toContain("deletion_sealed");
    for (const g of ["Spam", "HakaretIftira", "NefretSoylemi", "TelifIhlali"]) {
      const r = await svc.audit(del(fy(g), 1));
      expect(r.inferredClasses, g).not.toContain(fy("AcilSilmeTalebi"));
      expect(r.inferredClasses, g).not.toContain(fy("MuhurluSilmeTalebi"));
      expect(codes(r.infos), g).not.toEqual(expect.arrayContaining(["deletion_urgent"]));
    }
  });

  it("kategori kuralları ve kategori bilirkişi gereksinimi silme talebine uygulanmaz", async () => {
    const r = await svc.audit({ ...del(fy("Spam"), 1), categories: [fy("HalkSagligi"), fy("KatilimciButce")] });
    expect(r.tier).toBe("DEL");
    expect(r.requiresExpert).toBe(false);
    expect(r.params!.quorum).toEqual(rat(3, 10));
    expect(r.params!.durationsHours.voting).toBe(48);
    expect(r.inferredClasses).not.toContain(fy("Saglik"));
    expect(r.categories).toEqual(expect.arrayContaining([fy("HalkSagligi"), fy("KatilimciButce")]));
  });

  it("mesaj yok, gerekçe bilinmiyor ya da hiç silme bilgisi yok → ihlal", async () => {
    expect(codes((await svc.audit(del(fy("Spam"), 0))).violations)).toContain("deletion_no_messages");
    expect(codes((await svc.audit(del(fy("Sikici"), 1))).violations)).toContain("deletion_ground_unknown");
    const none = await svc.audit({ ...del(fy("Spam")), deletion: null });
    expect(codes(none.violations)).toEqual(expect.arrayContaining(["deletion_ground_count", "deletion_no_messages"]));
  });
});

describe("alt konu ve düzenleme", () => {
  it("üst konu etkin değilse ya da yoksa ihlal", async () => {
    const inactive = await svc.audit(topic({ kind: "subtopic", parentTopic: { id: "k9", categories: [], status: "archived" } }));
    expect(inactive.admissible).toBe(false);
    const v = inactive.violations.find((f) => f.code === "parent_inactive")!;
    expect(v.message).toMatch(/^Madde 10 \(1\):/);
    const missing = await svc.audit(topic({ kind: "subtopic", parentTopic: null }));
    expect(codes(missing.violations)).toContain("parent_missing");
  });

  it("alt konu üst konunun kategorilerini miras alır (kurallar dahil)", async () => {
    const r = await svc.audit(topic({ kind: "subtopic", categories: [fy("Spor")], parentTopic: { id: "k1", categories: [fy("KatilimciButce")], status: "active" } }));
    expect(r.categories).toEqual(expect.arrayContaining([fy("Spor"), fy("KulturSpor"), fy("KatilimciButce"), fy("Butce")]));
    expect(codes(r.infos)).toContain("inherited_categories");
    expect(r.params!.quorum).toEqual(rat(3, 10)); // Madde 24 (1) bütçe kuralı
    expect(r.requiresExpert).toBe(true); // Bütçe bilirkişi gerektirir
    expect(r.params!.expertDomains).toEqual([fy("KatilimciButce")]);
  });

  it("taban sürüm güncel değilse uyarı (sürüm çakışması)", async () => {
    const r = await svc.audit(topic({ kind: "amendment", parentTopic: { id: "k1", categories: [], status: "active" }, amendment: { baseVersion: 2, currentVersion: 3 } }));
    expect(r.admissible).toBe(true);
    const w = r.warnings.find((f) => f.code === "version_conflict")!;
    expect(w.message).toMatch(/^Madde 10 \(2\):/);
    expect(w.message).toMatch(/taban sürüm: 2, güncel sürüm: 3/);
    const noBase = await svc.audit(topic({ kind: "amendment", parentTopic: { id: "k1", categories: [], status: "active" }, amendment: null }));
    expect(codes(noBase.violations)).toContain("amendment_base_missing");
  });
});

describe("parametre birleştirme — en koruyucu kazanır", () => {
  it("kişisel veri kuralı: τ ve φ yükselir, T0'ın kesinliği korunur", async () => {
    const r = await svc.audit(topic({ categories: [fy("VeriKoruma")] }));
    expect(r.tier).toBe("T0");
    expect(r.params).toMatchObject({ quorum: rat(1, 5), threshold: rat(3, 5), thresholdStrict: true, clusterFloor: rat(2, 5) });
    expect(r.appliedRules.map((a) => a.iri)).toContain(fy("KuralVeriKoruma"));
  });

  it("birden çok kategori kuralı: her parametre için en büyük/en uzun", async () => {
    const r = await svc.audit(topic({ categories: [fy("KatilimciButce"), fy("DepremGuvenligi"), fy("HalkSagligi")] }));
    expect(r.params!.quorum).toEqual(rat(3, 10)); // bütçe
    expect(r.params!.durationsHours.deliberation).toBe(120); // imar 120 > bütçe 96 > T0 72
    expect(r.params!.durationsHours.voting).toBe(96); // sağlık
    expect(r.params!.durationsHours.objection).toBe(48); // T0
    const rules = r.appliedRules.map((a) => a.iri);
    expect(rules).toEqual(expect.arrayContaining([fy("KuralButce"), fy("KuralImar"), fy("KuralSaglik"), fy("KuralBilirkisiKategorisi")]));
  });

  it("katman ile kural birleşimi: T1 + kişisel veri kuralı", async () => {
    const r = await svc.audit(topic({ categories: [fy("VeriKoruma")], rightsAffected: [{ right: fy("OzelHayatinGizliligi"), direction: "restrict", source: "author" }] }));
    expect(r.tier).toBe("T1");
    expect(r.params).toMatchObject({ quorum: rat(3, 10), threshold: rat(3, 5), thresholdStrict: false, clusterFloor: rat(2, 5) });
  });
});

describe("destekçi sayısı K_s ve bilirkişi alanları", () => {
  it("K_s = max(2, min(5, ⌈√|M|/2⌉)); DEL için 1", async () => {
    for (const [m, ks] of [[0, 2], [16, 2], [17, 3], [36, 3], [37, 4], [64, 4], [65, 5], [100, 5], [10000, 5]] as const) {
      const r = await svc.audit(topic({ verifiedMembers: m }));
      expect(r.params!.sponsorsRequired, `|M|=${m}`).toBe(ks);
      expect(sponsorsRequired(m, "T0")).toBe(ks);
    }
  });

  it("bilirkişi gerektiren kategori ve miras; yazar talebi", async () => {
    const hs = await svc.audit(topic({ categories: [fy("HalkSagligi")] }));
    expect(hs.requiresExpert).toBe(true);
    expect(hs.params!.expertDomains).toEqual([fy("HalkSagligi")]);
    expect(hs.inferredClasses).toEqual(expect.arrayContaining([fy("HalkSagligi"), fy("Saglik"), fy("Kategori"), fy("Oneri"), fy("BilirkisiGerektirenOneri")]));
    const konut = await svc.audit(topic({ categories: [fy("Konut")] }));
    expect(konut.requiresExpert).toBe(true);
    expect(konut.params!.expertDomains).toEqual([fy("Konut")]);
    const asked = await svc.audit(topic({ categories: [fy("Spor")], requestExpert: true }));
    expect(asked.requiresExpert).toBe(true);
    expect(asked.params!.expertDomains).toEqual([fy("Spor")]);
  });

  it("bilinmeyen kategori uyarıyla yok sayılır; kısa IRI kabul edilir", async () => {
    const r = await svc.audit(topic({ categories: ["fy:TopluTasima", "fy:Uydurma"] }));
    expect(r.categories).toEqual([fy("TopluTasima"), fy("Ulasim")]);
    expect(codes(r.warnings)).toContain("unknown_category");
  });

  it("çok kısa başlık ihlal, kategorisiz konu uyarı", async () => {
    expect(codes((await svc.audit(topic({ title: "ab" }))).violations)).toContain("title_length");
    expect(codes((await svc.audit(topic({ categories: [] }))).warnings)).toContain("no_category");
  });

  it("başlık/metin sınırları sunucunun kayıt denetimiyle aynı (PROPOSAL_TEXT_LIMITS): ön denetim ile kayıt uyuşur", async () => {
    const L = PROPOSAL_TEXT_LIMITS;
    expect(codes((await svc.audit(topic({ title: "x".repeat(L.titleMin - 1) }))).violations)).toContain("title_length");
    expect(codes((await svc.audit(topic({ title: "x".repeat(L.titleMin) }))).violations)).not.toContain("title_length");
    expect(codes((await svc.audit(topic({ title: "x".repeat(L.titleMax + 1) }))).violations)).toContain("title_length");
    expect(codes((await svc.audit(topic({ body: "y".repeat(L.bodyMin - 1) }))).violations)).toContain("body_length");
    expect(codes((await svc.audit(topic({ body: "y".repeat(L.bodyMin) }))).violations)).not.toContain("body_length");
    expect(codes((await svc.audit(topic({ body: "y".repeat(L.bodyMax + 1) }))).violations)).toContain("body_length");
  });
});

describe("performans", () => {
  it("tek denetim 300 ms'nin altında", async () => {
    await svc.audit(topic());
    const t = performance.now();
    await svc.audit(topic({ categories: [fy("KatilimciButce"), fy("HalkSagligi")], rightsAffected: [{ right: fy("IfadeOzgurlugu"), direction: "restrict", source: "ai" }] }));
    expect(performance.now() - t).toBeLessThan(300);
  });
});
