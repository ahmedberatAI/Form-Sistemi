// shared/src/search.ts: Türkçe duyarsız normalleştirme, numara ayrıştırma, başlık eşleşme düzeyi ve arama sırası (saf işlevler).
import { describe, expect, it } from "vitest";
import {
  compareSearchHits,
  matchTitle,
  normalizeSearch,
  parseSearchRef,
  proposalMatchesQuery,
  searchKey,
  searchReady,
  SEARCH_LIMIT_MAX,
  SEARCH_MIN_CHARS,
  type SearchRankable,
} from "@forum/shared";

describe("normalizeSearch: Türkçe büyük/küçük harf ve aksan duyarsız", () => {
  it.each([
    ["İstanbul", "istanbul"],
    ["ISIK", "isik"],
    ["Işık", "isik"],
    ["ışık", "isik"],
    ["ŞENLİK", "senlik"],
    ["Çevre", "cevre"],
    ["Gölge", "golge"],
    ["Ağaç", "agac"],
    ["Üçüncü", "ucuncu"],
    ["Ödenek", "odenek"],
    ["Kâğıt", "kagit"],
  ])("%s → %s", (input, out) => {
    expect(normalizeSearch(input)).toBe(out);
  });

  it("aynı kelimenin farklı yazımları aynı anahtarı verir", () => {
    const forms = ["Yeşil Alan", "YEŞİL ALAN", "yesil alan", "YESIL ALAN", "yeşil alan"];
    expect(new Set(forms.map(normalizeSearch)).size).toBe(1);
  });

  it("searchKey boşlukları sadeleştirir; boş/null güvenli", () => {
    expect(searchKey("  Parka   gölgelik \t ve bank ")).toBe("parka golgelik ve bank");
    expect(searchKey(undefined as unknown as string)).toBe("");
  });
});

describe("parseSearchRef: numara araması", () => {
  it.each([
    ["#K12", { kind: "proposal", seq: 12, explicit: true }],
    ["K-12", { kind: "proposal", seq: 12, explicit: true }],
    ["#K-12", { kind: "proposal", seq: 12, explicit: true }],
    ["k 7", { kind: "proposal", seq: 7, explicit: true }],
    ["#T3", { kind: "topic", seq: 3, explicit: true }],
    ["T-3", { kind: "topic", seq: 3, explicit: true }],
    ["#12", { kind: null, seq: 12, explicit: true }],
    ["2026", { kind: null, seq: 2026, explicit: false }],
  ])("%s", (q, ref) => {
    expect(parseSearchRef(q)).toEqual(ref);
  });

  it.each(["park", "#K", "K-", "#0", "K12a", "#X5", "", "12 ağaç"])("%s numara değildir", (q) => {
    expect(parseSearchRef(q)).toBeNull();
  });

  it("searchReady: 2 karakterden sonra ya da numarada hemen", () => {
    expect(SEARCH_MIN_CHARS).toBe(2);
    expect(SEARCH_LIMIT_MAX).toBe(8);
    expect(searchReady("p")).toBe(false);
    expect(searchReady("pa")).toBe(true);
    expect(searchReady(" ı ")).toBe(false);
    expect(searchReady("5")).toBe(true);
    expect(searchReady("#K1")).toBe(true);
  });
});

describe("matchTitle: eşleşme düzeyi", () => {
  const title = "Parka gölgelik ve bank";
  it.each([
    ["parka", "prefix"],
    ["PARKA GÖLGE", "prefix"],
    ["gölge", "word"],
    ["golgelik", "word"],
    ["bank golge", "word"],
    ["elik", "contains"],
    ["arka", "contains"],
    ["ank lik", "contains"],
    ["otobüs", null],
    ["", null],
  ])("%s → %s", (q, m) => {
    expect(matchTitle(title, q)).toBe(m);
  });

  it("Türkçe harfler iki yönde eşleşir (ı/i, İ/i, ş/s)", () => {
    expect(matchTitle("Işıklandırma projesi", "isik")).toBe("prefix");
    expect(matchTitle("Sokak ışıklandırması", "IŞIK")).toBe("word");
    expect(matchTitle("İstasyon önü düzenlemesi", "istasyon")).toBe("prefix");
    expect(matchTitle("Mahalle şenliği", "ŞENLİ")).toBe("word");
    expect(matchTitle("Mahalle şenlik alanı", "senlik")).toBe("word");
  });

  it("kelime başı: tırnak ve noktalama sonrası da kelime başıdır", () => {
    expect(matchTitle("“Temiz hava” kampanyası", "temiz")).toBe("word");
    expect(matchTitle("Hava-kalitesi ölçümü", "kalite")).toBe("word");
  });
});

describe("proposalMatchesQuery: Öneriler sayfasının süzgeci = 'Tüm önerilerde ara (N öneri)' sayısı", () => {
  const p = { seq: 12, title: "Kent içi ulaşımın kütüphane atölyelerine bağlanması", authorNickname: "Ayşe_K" };

  it("çok kelimeli arama sırasız eşleşir (matchTitle ile aynı kural); çift boşluk ve Türkçe harfler önemsizdir", () => {
    for (const q of ["ulaşım kent", "kütüphane atölye", "ATOLYE  KUTUPHANE", "kent içi", "  bağlanması  "]) {
      expect(proposalMatchesQuery(p, q), q).toBe(true);
      expect(matchTitle(p.title, q), q).not.toBeNull();
    }
    expect(proposalMatchesQuery(p, "ulaşım otobüs")).toBe(false);
  });

  it("numara: '#K-12', 'K12' yalnız 12'yi; yalın '12' numara ya da başlık; konu numarası öneriyle eşleşmez", () => {
    expect(proposalMatchesQuery(p, "#K-12")).toBe(true);
    expect(proposalMatchesQuery(p, "k12")).toBe(true);
    expect(proposalMatchesQuery({ ...p, seq: 120 }, "#K-12")).toBe(false);
    expect(proposalMatchesQuery({ ...p, seq: 1 }, "#K-1")).toBe(true);
    expect(proposalMatchesQuery({ ...p, seq: 12 }, "#T12")).toBe(false);
    expect(proposalMatchesQuery({ seq: 3, title: "2026 bütçesi" }, "2026")).toBe(true);
  });

  it("yazar takma adı içeriyorsa eşleşir (Türkçe duyarsız); boş arama her öneriyi geçirir", () => {
    expect(proposalMatchesQuery(p, "ayse")).toBe(true);
    expect(proposalMatchesQuery({ seq: 1, title: "Başka" }, "ayse")).toBe(false);
    expect(proposalMatchesQuery(p, "")).toBe(true);
    expect(proposalMatchesQuery(p, "   ")).toBe(true);
  });
});

describe("compareSearchHits: sıra", () => {
  const hit = (over: Partial<SearchRankable>): SearchRankable => ({ type: "proposal", id: "x", seq: 1, match: "contains", open: false, createdAt: 0, ...over });

  it("numara > başlangıç > kelime başı > içinde; eşitlikte açık olanlar, sonra yeniler önce", () => {
    const list = [
      hit({ id: "icinde-yeni", match: "contains", createdAt: 9, seq: 9 }),
      hit({ id: "kelime-kapali", match: "word", open: false, createdAt: 5, seq: 5 }),
      hit({ id: "kelime-acik-eski", match: "word", open: true, createdAt: 1, seq: 1 }),
      hit({ id: "kelime-acik-yeni", match: "word", open: true, createdAt: 3, seq: 3 }),
      hit({ id: "baslangic", match: "prefix", createdAt: 0, seq: 2 }),
      hit({ id: "numara", match: "ref", createdAt: 0, seq: 4 }),
    ];
    expect([...list].sort(compareSearchHits).map((h) => h.id)).toEqual(["numara", "baslangic", "kelime-acik-yeni", "kelime-acik-eski", "kelime-kapali", "icinde-yeni"]);
  });

  it("toplam sıra: her şey eşitse konu önce, sonra kimlik (belirlenimci)", () => {
    const a = hit({ type: "proposal", id: "b" });
    const b = hit({ type: "topic", id: "a" });
    const c = hit({ type: "proposal", id: "a" });
    expect([a, b, c].sort(compareSearchHits).map((h) => `${h.type}:${h.id}`)).toEqual(["topic:a", "proposal:a", "proposal:b"]);
    expect([c, a, b].sort(compareSearchHits).map((h) => `${h.type}:${h.id}`)).toEqual(["topic:a", "proposal:a", "proposal:b"]);
  });
});
