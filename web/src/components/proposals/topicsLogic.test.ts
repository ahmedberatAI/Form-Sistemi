// Konular ve konu ayrıntısı saf mantığı (Faz 3 / madde 4): tek satır sayaçlar, 'Süz' hükmü, ağaç satırı kuralları,
// açık önerilerin tür dökümü, sürüm geçmişi hükmü ve derin bağlantı çapaları.
import type { TopicSummary } from "@forum/shared";
import { describe, expect, it } from "vitest";
import { parseSectionParam } from "../../lib/sectionParam";
import {
  MAX_TREE_CATEGORIES,
  openProposalKinds,
  revisionsSummary,
  sectionWaitsForThread,
  showVersionBadge,
  splitCategories,
  THREAD_WAIT_MS,
  TOPIC_ANCHORS,
  topicCounters,
  topicFilterCount,
  topicFilterSummary,
  topicSectionHref,
  TOPICS_NARROW_QUERY,
} from "./topicsLogic";

const topic = (over: Partial<TopicSummary> = {}): TopicSummary => ({
  id: "t1",
  seq: 1,
  parentId: null,
  title: "Ulaşım",
  categories: [],
  version: 1,
  status: "active",
  createdAt: 0,
  updatedAt: 0,
  childCount: 0,
  messageCount: 0,
  openProposalCount: 0,
  ...over,
});

describe("topicCounters (tek satır sayaçlar)", () => {
  it("eski dört kutunun aynı etiketleri ve sırası; yalnız 'Konulara açık öneri' Öneriler'e bağlanır", () => {
    const c = topicCounters([topic()]);
    expect(c.map((x) => [x.key, x.label])).toEqual([
      ["roots", "Ana konu"],
      ["subs", "Alt konu"],
      ["messages", "Mesaj"],
      ["open", "Konulara açık öneri"],
    ]);
    expect(c.filter((x) => x.to).map((x) => [x.key, x.to])).toEqual([["open", "/oneriler"]]);
  });

  it("yürürlükteki konular sayılır: ana/alt konu ayrımı, mesaj ve açık öneri toplamı; arşivlenenler sayılmaz", () => {
    const c = topicCounters([
      topic({ id: "a", messageCount: 10, openProposalCount: 2 }),
      topic({ id: "b", parentId: "a", messageCount: 5, openProposalCount: 1 }),
      topic({ id: "c", parentId: "a", messageCount: 1 }),
      topic({ id: "d", status: "archived", messageCount: 99, openProposalCount: 9 }),
    ]);
    expect(Object.fromEntries(c.map((x) => [x.key, x.count]))).toEqual({ roots: 1, subs: 2, messages: 16, open: 3 });
  });

  it("konu yokken hepsi sıfır (kutular yine de tutarlı)", () => {
    expect(topicCounters([]).map((x) => x.count)).toEqual([0, 0, 0, 0]);
  });
});

describe("'Süz' açılırı (telefon)", () => {
  it("etkin süzgeç sayısı yalnız Kategori ve Arşivi sayar", () => {
    expect(topicFilterCount({ category: "", showArchived: false })).toBe(0);
    expect(topicFilterCount({ category: "fy:Ulasim", showArchived: false })).toBe(1);
    expect(topicFilterCount({ category: "fy:Ulasim", showArchived: true })).toBe(2);
    expect(topicFilterCount({ category: "", showArchived: true })).toBe(1);
  });

  it("özet 'Süz' ya da 'Süz (n etkin)'; adında e2e'nin aradığı dizeler yok", () => {
    expect(topicFilterSummary(0)).toBe("Süz");
    expect(topicFilterSummary(2)).toBe("Süz (2 etkin)");
    for (const bad of ["Destekle", "Oyumu ver", "Daha fazla", "Sayımı kendim doğrulayayım", "Kapat"]) {
      expect(topicFilterSummary(0).toLowerCase()).not.toContain(bad.toLowerCase());
      expect(topicFilterSummary(2).toLowerCase()).not.toContain(bad.toLowerCase());
    }
  });

  it("dar ekran eşiği list-filters'ın üç sütuna geçtiği 640 px'in altıdır", () => {
    expect(TOPICS_NARROW_QUERY).toBe("(max-width: 639px)");
  });
});

describe("ağaç satırı kuralları", () => {
  it("'sürüm n' yalnız n > 1 ise görünür", () => {
    expect(showVersionBadge(1)).toBe(false);
    expect(showVersionBadge(2)).toBe(true);
    expect(showVersionBadge(7)).toBe(true);
  });

  it("kategoriler en çok 2; kalanı '+n' için ayrılır, sıra korunur", () => {
    expect(MAX_TREE_CATEGORIES).toBe(2);
    expect(splitCategories([])).toEqual({ shown: [], hidden: [] });
    expect(splitCategories(["a"])).toEqual({ shown: ["a"], hidden: [] });
    expect(splitCategories(["a", "b"])).toEqual({ shown: ["a", "b"], hidden: [] });
    expect(splitCategories(["a", "b", "c", "d"])).toEqual({ shown: ["a", "b"], hidden: ["c", "d"] });
    expect(splitCategories(["a", "b", "c"], 1)).toEqual({ shown: ["a"], hidden: ["b", "c"] });
  });
});

describe("açık önerilerin tür dökümü", () => {
  it("türlerine ayırır; sıra sabittir (düzenleme, alt konu, silme, yeni konu, yönetmelik)", () => {
    expect(openProposalKinds([])).toBe("");
    expect(openProposalKinds([{ kind: "amendment" }])).toBe("1 düzenleme teklifi");
    expect(openProposalKinds([{ kind: "deletion" }, { kind: "subtopic" }, { kind: "amendment" }, { kind: "amendment" }])).toBe(
      "2 düzenleme teklifi · 1 alt konu önerisi · 1 silme talebi",
    );
    expect(openProposalKinds([{ kind: "regulation" }, { kind: "topic" }])).toBe("1 yeni konu önerisi · 1 yönetmelik değişikliği");
  });
});

describe("sürüm geçmişi hükmü", () => {
  const rev = (version: number, at: number) => ({ version, createdAt: at });
  const now = Date.UTC(2026, 9, 2, 12);

  it("tek sürümde değişiklik yok; sürüm yoksa kayıt yok", () => {
    expect(revisionsSummary([rev(1, Date.UTC(2026, 8, 10))])).toBe("Tek sürüm · değişiklik yok");
    expect(revisionsSummary([])).toBe("Sürüm kaydı yok");
  });

  it("birden çok sürümde güncel sürüm ve son değişiklik günü; sayı başlıktadır, hükümde tekrarlanmaz", () => {
    const text = revisionsSummary([rev(1, Date.UTC(2026, 7, 1, 12)), rev(3, Date.UTC(2026, 8, 10, 12)), rev(2, Date.UTC(2026, 8, 2, 12))], now);
    expect(text).toMatch(/^Güncel sürüm 3 · son değişiklik 10 Eyl$/);
    expect(text).not.toMatch(/\d sürüm ·/);
  });

  it("son değişiklik başka yıldaysa yıl da yazılır", () => {
    expect(revisionsSummary([rev(1, Date.UTC(2025, 0, 5, 12)), rev(2, Date.UTC(2025, 11, 20, 12))], now)).toBe("Güncel sürüm 2 · son değişiklik 20 Ara 2025");
  });
});

describe("derin bağlantı çapaları", () => {
  it("hepsi ?bolum= için geçerli, benzersiz ve ASCII; 'tartisma' Discussion bileşeninin kendi kimliği", () => {
    const anchors = Object.values(TOPIC_ANCHORS);
    for (const a of anchors) expect(parseSectionParam(a)).toBe(a);
    expect(new Set(anchors).size).toBe(anchors.length);
    expect(TOPIC_ANCHORS.discussion).toBe("tartisma");
  });

  it("topicSectionHref konu yolunu ve çapayı kurar (kimlik kaçırılır)", () => {
    expect(topicSectionHref("abc-123", TOPIC_ANCHORS.children)).toBe("/konular/abc-123?bolum=alt-konular");
    expect(topicSectionHref("a/b", TOPIC_ANCHORS.versions)).toBe("/konular/a%2Fb?bolum=surumler");
  });

  it("tartışmanın altındaki çapalar (alt konular, sürüm geçmişi) tartışma yüklenince çalışır; üstündekiler ve tartışma beklemez", () => {
    expect(sectionWaitsForThread(TOPIC_ANCHORS.children)).toBe(true);
    expect(sectionWaitsForThread(TOPIC_ANCHORS.versions)).toBe(true);
    for (const a of [TOPIC_ANCHORS.text, TOPIC_ANCHORS.open, TOPIC_ANCHORS.discussion, "olmayan", "", null, undefined]) expect(sectionWaitsForThread(a)).toBe(false);
    // tartışma hiç gelmezse (hata) bağlantı yine çalışır: sınırlı bekleme
    expect(THREAD_WAIT_MS).toBeGreaterThan(0);
    expect(THREAD_WAIT_MS).toBeLessThanOrEqual(10_000);
  });
});
