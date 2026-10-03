// Sözlük: yapısal sözleşmeler (kimlikler, tanım uzunluğu, bağlantılar), plandaki zorunlu terimlerin varlığı, e2e'nin yasakladığı
// düğme adı alt dizeleri ve arama/gruplama yardımcıları. Metin içeriği (tanımların doğruluğu) docs/YONETMELIK.md ve ALGORITMA.md ile
// elle denetlenir; burada kalıp bozulmasın diye kurallar kilitlenir.
import { TIER_LABELS } from "@forum/shared";
import { describe, expect, it } from "vitest";
import {
  findTerm,
  getTerm,
  GLOSSARY,
  GLOSSARY_GROUPS,
  glossaryByGroup,
  searchGlossary,
  termForDecisionCheck,
  termForTier,
  type BylawTab,
  type TermId,
} from "./glossary";

const BYLAW_TABS: BylawTab[] = ["maddeler", "kategoriler", "haklar", "gerekceler", "katmanlar", "parametreler", "surumler", "turtle"];

/** Terim düğmesinin adı olabilecek metinlerde geçmemesi gereken alt dizeler (e2e: Playwright adı büyük/küçük harf duyarsız alt dizeyle eşler). */
const FORBIDDEN_NAMES = ["Destekle", "Oyumu ver", "Daha fazla", "Sayımı kendim doğrulayayım", "Kapat", "Gerekçe", "Açıklama", "Azınlık raporu", "Düğüm"];

const sentences = (text: string): number => text.split(/(?<=[.!?])\s+/).filter(Boolean).length;

describe("sözlük yapısı", () => {
  it("kimlikler benzersiz ve ASCII kebab-case", () => {
    const ids = GLOSSARY.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const id of ids) expect(id, id).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
  });

  it("her girdinin terimi, günlük karşılığı ve tanımı dolu; karşılık küçük harfle başlar, noktasızdır", () => {
    for (const e of GLOSSARY) {
      expect(e.term.trim(), e.id).not.toBe("");
      expect(e.plain.trim(), e.id).not.toBe("");
      expect(e.definition.trim(), e.id).not.toBe("");
      // Pencerede "Günlük dille: <karşılık>." diye okunur: nokta çiftlenmesin, cümle küçük harfle sürsün.
      expect(e.plain, `${e.id}: karşılık küçük harfle başlar`).toBe(e.plain.charAt(0).toLocaleLowerCase("tr-TR") + e.plain.slice(1));
      expect(e.plain.endsWith("."), `${e.id}: karşılık noktasız`).toBe(false);
    }
  });

  it("tanımlar 1-3 cümle ve kısa; yönetmelikle değişebilecek parametre değeri (%60 gibi) içermez", () => {
    for (const e of GLOSSARY) {
      expect(sentences(e.definition), `${e.id}: cümle sayısı`).toBeLessThanOrEqual(3);
      expect(e.definition.length, `${e.id}: uzunluk`).toBeLessThanOrEqual(420);
      expect(e.definition, `${e.id}: yüzde değeri yazılmaz`).not.toMatch(/%\s?\d/);
    }
  });

  it("her girdi tanımlı bir konu bölümünde; her bölümde en az bir girdi var", () => {
    const groups = new Set(GLOSSARY_GROUPS.map((g) => g.id));
    for (const e of GLOSSARY) expect(groups.has(e.group), e.id).toBe(true);
    for (const g of GLOSSARY_GROUPS) expect(GLOSSARY.some((e) => e.group === g.id), g.id).toBe(true);
  });

  it("'Yönetmelikte ›' bağlantısı gerçek bir Yönetmelik sekmesine gider ve dayanak madde yazılıdır", () => {
    const withLink = GLOSSARY.filter((e) => e.bylawLink);
    expect(withLink.length).toBeGreaterThan(20);
    for (const e of withLink) {
      const m = /^\/yonetmelik\?sekme=([a-z]+)$/.exec(e.bylawLink!.to);
      expect(m, `${e.id}: ${e.bylawLink!.to}`).not.toBeNull();
      expect(BYLAW_TABS, e.id).toContain(m![1]);
      expect(e.bylawLink!.label, e.id).toMatch(/^Madde \d+ — \S/);
    }
  });

  it("terim düğmesinin varsayılan adı e2e'nin yasakladığı alt dizeleri içermez", () => {
    for (const e of GLOSSARY) for (const bad of FORBIDDEN_NAMES) expect(e.term.toLocaleLowerCase("tr-TR"), `${e.id} / ${bad}`).not.toContain(bad.toLocaleLowerCase("tr-TR"));
  });
});

describe("planın zorunlu terimleri", () => {
  // Plan (Faz 3 / madde 2): köprü testi, görüş kümesi, katman T0–T3/DEL, yeter sayı, onay eşiği, φ, ω, K_s, taahhüt, makbuz,
  // doğrulayıcı, 2f+1, Merkle yolu, TOFU, ontoloji, karartma/mezar taşı, vekâlet, bilirkişi kurası, P_g, GAC.
  const required: TermId[] = [
    "kopru-testi",
    "gorus-kumesi",
    "katman",
    "katman-t0",
    "katman-t1",
    "katman-t2",
    "katman-t3",
    "katman-del",
    "yeter-sayi",
    "onay-esigi",
    "kume-tabani",
    "asma-esigi",
    "gerekli-destekci",
    "taahhut",
    "makbuz",
    "dogrulayici",
    "2f1",
    "merkle-yolu",
    "tofu",
    "ontoloji",
    "karartma",
    "vekalet",
    "kura",
    "p-g",
    "gac",
    "ozet",
  ];

  it("hepsi sözlükte", () => {
    for (const id of required) expect(findTerm(id), id).toBeDefined();
    expect(GLOSSARY.length).toBeGreaterThanOrEqual(25);
  });

  it("semboller: yeter sayı q, onay eşiği τ, küme tabanı φ, aşma eşiği ω, gerekli destekçi K_s", () => {
    expect(getTerm("yeter-sayi").symbol).toBe("q");
    expect(getTerm("onay-esigi").symbol).toBe("τ");
    expect(getTerm("kume-tabani").symbol).toBe("φ");
    expect(getTerm("asma-esigi").symbol).toBe("ω");
    expect(getTerm("gerekli-destekci").symbol).toBe("K_s");
  });

  it("'özet' hash anlamında yeniden adlandırılmaz: terim 'Özet (hash)' kalır, günlük karşılığı 'parmak izi'dir", () => {
    const e = getTerm("ozet");
    expect(e.term).toBe("Özet (hash)");
    expect(e.plain).toContain("parmak izi");
    expect(e.definition).toContain("parmak izi");
  });

  it("her katman için bir girdi var ve termForTier ona gider", () => {
    for (const tier of Object.keys(TIER_LABELS)) {
      const entry = getTerm(termForTier(tier));
      expect(entry.term.startsWith(tier), tier).toBe(true);
    }
    expect(termForTier(null)).toBe("katman");
    expect(termForTier(undefined)).toBe("katman");
    expect(termForTier("T9")).toBe("katman");
  });
});

describe("yardımcılar", () => {
  it("findTerm bilinmeyen kimlik için undefined; getTerm tipli kimlikte her zaman bulur", () => {
    expect(findTerm("yok-boyle-bir-terim")).toBeUndefined();
    expect(getTerm("kopru-testi").term).toBe("Köprü testi");
  });

  it("glossaryByGroup: bölüm sırası sabit, her girdi bir kez, boş bölüm yok", () => {
    const groups = glossaryByGroup();
    expect(groups.map((g) => g.group.id)).toEqual(GLOSSARY_GROUPS.map((g) => g.id));
    expect(groups.flatMap((g) => g.entries.map((e) => e.id)).sort()).toEqual(GLOSSARY.map((e) => e.id).sort());
    expect(glossaryByGroup([getTerm("tofu")]).map((g) => g.group.id)).toEqual(["defter"]);
  });

  it("searchGlossary: Türkçe duyarsız; terim, karşılık, tanım ve sembolde arar; boş sorgu hepsini döner", () => {
    expect(searchGlossary("").length).toBe(GLOSSARY.length);
    expect(searchGlossary("   ").length).toBe(GLOSSARY.length);
    expect(searchGlossary("kopru").map((e) => e.id)).toContain("kopru-testi");
    expect(searchGlossary("KÖPRÜ").map((e) => e.id)).toContain("kopru-testi");
    expect(searchGlossary("PARMAK IZI").map((e) => e.id)).toContain("ozet");
    expect(searchGlossary("φ").map((e) => e.id)).toContain("kume-tabani");
    expect(searchGlossary("merkle").map((e) => e.id)).toEqual(expect.arrayContaining(["merkle-yolu"]));
    expect(searchGlossary("olmayan bir sözcük xyz")).toEqual([]);
  });

  it("termForDecisionCheck: sunucunun kontrol anahtarları (shared/decision.ts) terimlere eşlenir", () => {
    expect(termForDecisionCheck("quorum")).toBe("yeter-sayi");
    expect(termForDecisionCheck("threshold")).toBe("onay-esigi");
    expect(termForDecisionCheck("cold_start")).toBe("soguk-baslangic");
    expect(termForDecisionCheck("bridge:g0")).toBe("kopru-testi");
    expect(termForDecisionCheck("bridge:g12")).toBe("kopru-testi");
    expect(termForDecisionCheck("participation_shortfall")).toBe("kume-basina-asgari-oy");
    expect(termForDecisionCheck("author_cluster")).toBe("kume-tabani");
    expect(termForDecisionCheck("override")).toBe("asma-esigi");
    expect(termForDecisionCheck("revote_threshold")).toBe("yeniden-oy-esigi");
    expect(termForDecisionCheck("recount_error")).toBeNull();
    expect(termForDecisionCheck("")).toBeNull();
    // eşlenen her terim sözlükte vardır
    for (const key of ["quorum", "threshold", "cold_start", "bridge:g0", "participation_shortfall", "author_cluster", "override", "revote_threshold"]) {
      expect(findTerm(termForDecisionCheck(key)!), key).toBeDefined();
    }
  });
});
