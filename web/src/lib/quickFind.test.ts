// 'Hızlı bul' saf mantığı: tetikleme kuralı, gruplama (sunucu sırası korunur), seçenek listesi ve bağlantılar, Türkçe duyarsız
// başlık işaretleme, durum iletisi ve WAI-ARIA combobox klavye davranışı (↑ ↓ Enter Esc Tab, Alt+↓, ← → Home End).
import type { ProposalSearchHit, SearchHit, TopicSearchHit } from "@forum/shared";
import { describe, expect, it } from "vitest";
import {
  allProposalsHref,
  comboKey,
  COMBO_CLOSED,
  groupHits,
  highlightTitle,
  hitHref,
  hitRef,
  quickFindOptions,
  quickFindQuery,
  quickFindStatus,
  QUICK_FIND_DELAY_MS,
  QUICK_FIND_LIMIT,
  QUICK_FIND_MAX_CHARS,
  currentResults,
  submitDecision,
  submitTarget,
  type ComboState,
} from "./quickFind";

const P = (seq: number, title: string, over: Partial<ProposalSearchHit> = {}): ProposalSearchHit => ({
  type: "proposal",
  id: `p${seq}`,
  seq,
  title,
  kind: "topic",
  status: "voting",
  match: "contains",
  open: true,
  createdAt: 1000 + seq,
  ...over,
});
const T = (seq: number, title: string, over: Partial<TopicSearchHit> = {}): TopicSearchHit => ({
  type: "topic",
  id: `t${seq}`,
  seq,
  title,
  status: "active",
  match: "contains",
  open: true,
  createdAt: 500 + seq,
  ...over,
});
const joined = (parts: { text: string }[]) => parts.map((p) => p.text).join("");
const marked = (parts: { text: string; hit: boolean }[]) => parts.filter((p) => p.hit).map((p) => p.text);

describe("sabitler", () => {
  it("150 ms gecikme, en çok 8 sonuç, en çok 100 karakter (sunucu sınırlarıyla aynı)", () => {
    expect(QUICK_FIND_DELAY_MS).toBe(150);
    expect(QUICK_FIND_LIMIT).toBe(8);
    expect(QUICK_FIND_MAX_CHARS).toBe(100);
  });
});

describe("quickFindQuery: ne zaman aranır", () => {
  it("2 anlamlı karakterden sonra; boşluk sayılmaz", () => {
    expect(quickFindQuery("")).toBeNull();
    expect(quickFindQuery("a")).toBeNull();
    expect(quickFindQuery("   a  ")).toBeNull();
    expect(quickFindQuery("ab")).toBe("ab");
    expect(quickFindQuery("  çevre ")).toBe("çevre");
  });

  it("numara hemen aranır (#K12, K-12, #T3, tek rakam)", () => {
    expect(quickFindQuery("#K12")).toBe("#K12");
    expect(quickFindQuery("K-12")).toBe("K-12");
    expect(quickFindQuery("#T3")).toBe("#T3");
    expect(quickFindQuery("7")).toBe("7");
  });

  it("100 karakterde kesilir (sunucu daha uzununu 400 ile reddederdi)", () => {
    const q = quickFindQuery("x".repeat(150))!;
    expect(q).toHaveLength(100);
  });
});

describe("groupHits: türe göre gruplar, sırayı korur", () => {
  it("grup içinde sunucu sırası aynen; gruplar ilk sonuçlarının yerine göre", () => {
    const items: SearchHit[] = [P(12, "Bisiklet yolu"), T(3, "Ulaşım"), P(4, "Bisiklet park"), T(1, "Bisiklet")];
    const g = groupHits(items);
    expect(g.map((x) => x.label)).toEqual(["Öneriler", "Konular"]);
    expect(g[0].hits.map((h) => h.seq)).toEqual([12, 4]);
    expect(g[1].hits.map((h) => h.seq)).toEqual([3, 1]);
    // Konu önce gelirse Konular grubu önce
    expect(groupHits([T(3, "a"), P(1, "b")]).map((x) => x.label)).toEqual(["Konular", "Öneriler"]);
    expect(groupHits([])).toEqual([]);
  });

  it("numara ve bağlantı biçimi", () => {
    expect(hitRef(P(12, "x"))).toBe("#K-12");
    expect(hitRef(T(3, "x"))).toBe("#T-3");
    expect(hitHref(P(12, "x"))).toBe("/oneriler/p12");
    expect(hitHref(T(3, "x"))).toBe("/konular/t3");
  });
});

describe("quickFindOptions ve 'Tüm önerilerde ara'", () => {
  it("görsel sırayla düz liste; son seçenek her zaman 'Tüm önerilerde ara'; anahtarlar benzersiz", () => {
    const opts = quickFindOptions(groupHits([P(1, "a"), T(1, "b"), P(2, "c")]), "bi");
    expect(opts.map((o) => (o.kind === "hit" ? `${o.hit.type}${o.hit.seq}` : "tumu"))).toEqual(["proposal1", "proposal2", "topic1", "tumu"]);
    expect(new Set(opts.map((o) => o.key)).size).toBe(opts.length);
    // Sonuç yokken de (yalnız) 'Tüm önerilerde ara' vardır
    expect(quickFindOptions([], "bisiklet").map((o) => o.kind)).toEqual(["all"]);
    // Arama tetiklenmiyorsa seçenek yok
    expect(quickFindOptions([], "b")).toEqual([]);
  });

  it("Öneriler › Tümü sekmesine ?ara= ile gider; numara '#K-12' biçimine çevrilir", () => {
    expect(allProposalsHref("bisiklet yolu")).toBe("/oneriler?sekme=tumu&ara=bisiklet+yolu");
    expect(allProposalsHref("K12")).toBe("/oneriler?sekme=tumu&ara=%23K-12");
    expect(allProposalsHref("#12")).toBe("/oneriler?sekme=tumu&ara=%23K-12");
    expect(allProposalsHref("#T3")).toBe("/oneriler?sekme=tumu&ara=%23T3");
    // Yalın sayı başlıkta da aranır: olduğu gibi gider
    expect(allProposalsHref("2026")).toBe("/oneriler?sekme=tumu&ara=2026");
    // Özel karakterler kodlanır (adres bozulmaz)
    expect(new URLSearchParams(allProposalsHref("a&b=c #x").split("?")[1]).get("ara")).toBe("a&b=c #x");
  });

  it("seçeneksiz Enter: ilk sonuç AYNI numaranın (ve türün) tam eşleşmesiyse ona, değilse 'Tüm önerilerde ara'ya", () => {
    expect(submitTarget({ items: [P(12, "x", { match: "ref" }), P(120, "y")] }, "K12")).toBe("/oneriler/p12");
    expect(submitTarget({ items: [P(12, "Bisiklet", { match: "prefix" })] }, "bis")).toBe("/oneriler?sekme=tumu&ara=bis");
    expect(submitTarget({ items: [] }, "b")).toBeNull();
    // Başka numaranın eşleşmesi (eski sorgudan kalmış olsa bile) hedef olmaz
    expect(submitTarget({ items: [P(1, "x", { match: "ref" })] }, "#K12")).toBe("/oneriler?sekme=tumu&ara=%23K-12");
    // Tür uyuşmazlığı: "#T3" bir öneri eşleşmesine gitmez; "#3" (türsüz) ikisine de gidebilir
    expect(submitTarget({ items: [P(3, "x", { match: "ref" })] }, "#T3")).toBe("/oneriler?sekme=tumu&ara=%23T3");
    expect(submitTarget({ items: [T(3, "x", { match: "ref" })] }, "#T3")).toBe("/konular/t3");
    expect(submitTarget({ items: [T(3, "x", { match: "ref" })] }, "3")).toBe("/konular/t3");
  });

  it("güncel sonuç: yalnız sonuçların sorgusu metnin sorgusuyla aynıysa (kırpma ve 100 karakter kuralıyla)", () => {
    const res = { items: [P(1, "x", { match: "ref" })] };
    expect(currentResults("#K1", "#K1", res)).toBe(res);
    expect(currentResults("  #K1 ", "#K1", res)).toBe(res);
    expect(currentResults("#K12", "#K1", res)).toBeNull();
    expect(currentResults("b", "b", res)).toBeNull();
    expect(currentResults("#K1", null, res)).toBeNull();
  });

  it("seçeneksiz Enter kararı: '#K1' sonuçları ekrandayken '2' yazılıp hemen Enter → #K-1'e GİDİLMEZ, #K-12 sonucu beklenir", () => {
    const k1 = { items: [P(1, "Bir", { match: "ref" })] };
    const k12 = { items: [P(12, "On iki", { match: "ref" })] };
    // Yanıt gelmeden: eski (#K1) sonuçlar güncel sayılmaz → bekle
    expect(submitDecision("#K12", currentResults("#K12", "#K1", k1))).toEqual({ kind: "wait" });
    // Yanıt gelince: #K-12
    expect(submitDecision("#K12", currentResults("#K12", "#K12", k12))).toEqual({ kind: "go", href: "/oneriler/p12" });
    // "12" → "12 park": numara değil; beklemeden 'Tüm önerilerde ara' (eski '12' sonucuna değil)
    expect(submitDecision("12 park", currentResults("12 park", "12", { items: [P(12, "x", { match: "ref" })] }))).toEqual({
      kind: "go",
      href: "/oneriler?sekme=tumu&ara=12+park",
    });
    // Arama hata verdiyse numarada da 'Tüm önerilerde ara'
    expect(submitDecision("#K12", null, true)).toEqual({ kind: "go", href: "/oneriler?sekme=tumu&ara=%23K-12" });
    // Tetiklenmeyen metin: hiçbir şey
    expect(submitDecision("b", null)).toBeNull();
    expect(submitDecision("zzqxw", null)).toEqual({ kind: "go", href: "/oneriler?sekme=tumu&ara=zzqxw" });
  });
});

describe("highlightTitle: Türkçe duyarsız işaretleme", () => {
  it("büyük/küçük harf ve Türkçe karakter duyarsız; parçalar birleşince başlığın kendisi", () => {
    const parts = highlightTitle("İstanbul Çevre Yolu", "cevre");
    expect(marked(parts)).toEqual(["Çevre"]);
    expect(joined(parts)).toBe("İstanbul Çevre Yolu");
    expect(marked(highlightTitle("İSTANBUL ışıkları", "istanbul ISIK"))).toEqual(["İSTANBUL", "ışık"]);
    expect(marked(highlightTitle("Gölge ve Şenlik", "golge senlik"))).toEqual(["Gölge", "Şenlik"]);
  });

  it("kelime başındaki geçiş öncelikli; yoksa ilk geçtiği yer", () => {
    expect(joined(highlightTitle("Parkta park yeri", "park"))).toBe("Parkta park yeri");
    const p1 = highlightTitle("Otopark ve park alanı", "park");
    // "Otopark" içinde de geçer ama kelime başı olan "park" işaretlenir
    expect(p1.findIndex((x) => x.hit)).toBe(1);
    expect(p1[0].text).toBe("Otopark ve ");
    const p2 = highlightTitle("Otopark düzeni", "park");
    expect(marked(p2)).toEqual(["park"]);
    expect(p2[0]).toEqual({ text: "Oto", hit: false });
  });

  it("çakışan ve bitişik parçalar birleşir; eşleşme yoksa tek düz parça", () => {
    expect(marked(highlightTitle("Bisiklet yolu", "bisik bisiklet"))).toEqual(["Bisiklet"]);
    expect(highlightTitle("Bisiklet yolu", "tramvay")).toEqual([{ text: "Bisiklet yolu", hit: false }]);
    expect(highlightTitle("", "x")).toEqual([]);
  });

  it("numara aramasında başlık işaretlenmez; yalın sayı başlıkta işaretlenir", () => {
    expect(highlightTitle("K12 bütçesi", "#K12")).toEqual([{ text: "K12 bütçesi", hit: false }]);
    expect(marked(highlightTitle("2026 bütçesi", "2026"))).toEqual(["2026"]);
  });

  it("ayrık yazılmış birleşen işaret (c + U+0327) parçaya dahil edilir", () => {
    const title = "Yeni çevre planı";
    const parts = highlightTitle(title, "cevre");
    expect(marked(parts)).toEqual(["çevre"]);
    expect(joined(parts)).toBe(title);
  });
});

describe("quickFindStatus: ekran okuyucuya durum", () => {
  const res = (items: SearchHit[]) => ({ items });
  it("aranmıyorsa boş; ilk aramada 'Aranıyor…'; hata; 'Sonuç yok'; sayılar", () => {
    expect(quickFindStatus({ query: null, loading: false, error: false, res: null })).toBe("");
    expect(quickFindStatus({ query: "bi", loading: true, error: false, res: null })).toBe("Aranıyor…");
    expect(quickFindStatus({ query: "bi", loading: false, error: true, res: null })).toMatch(/^Arama yapılamadı/);
    expect(quickFindStatus({ query: "bi", loading: false, error: false, res: res([]) })).toBe("Sonuç yok");
    expect(quickFindStatus({ query: "bi", loading: false, error: false, res: res([T(1, "a"), P(2, "b"), P(3, "c")]) })).toBe("3 sonuç: 1 konu, 2 öneri");
    expect(quickFindStatus({ query: "bi", loading: false, error: false, res: res([P(2, "b")]) })).toBe("1 sonuç: 1 öneri");
  });
});

describe("comboKey: WAI-ARIA combobox klavye davranışı", () => {
  const inline = { mode: "inline" as const, hasText: true };
  const panel = { mode: "panel" as const, hasText: true };
  const at = (active: number, open = true): ComboState => ({ open, active });

  it("↓ kapalı listeyi açar ve ilk seçeneği etkinleştirir; açıkken sonrakine geçer, sondan başa döner", () => {
    expect(comboKey(COMBO_CLOSED, "ArrowDown", 3, inline)).toEqual({ state: at(0), action: null, handled: true });
    expect(comboKey(at(-1), "ArrowDown", 3, inline).state).toEqual(at(0));
    expect(comboKey(at(0), "ArrowDown", 3, inline).state).toEqual(at(1));
    expect(comboKey(at(2), "ArrowDown", 3, inline).state).toEqual(at(0));
  });

  it("Alt+↓ listeyi yalnız açar (etkin seçenek değişmez)", () => {
    expect(comboKey(COMBO_CLOSED, "ArrowDown", 3, { ...inline, altKey: true }).state).toEqual(at(-1));
    expect(comboKey(at(1), "ArrowDown", 3, { ...inline, altKey: true }).state).toEqual(at(1));
  });

  it("↑ kapalı listeyi açar ve son seçeneği etkinleştirir; açıkken öncekine geçer, baştan sona döner", () => {
    expect(comboKey(COMBO_CLOSED, "ArrowUp", 3, inline).state).toEqual(at(2));
    expect(comboKey(at(2), "ArrowUp", 3, inline).state).toEqual(at(1));
    expect(comboKey(at(0), "ArrowUp", 3, inline).state).toEqual(at(2));
    expect(comboKey(at(-1), "ArrowUp", 3, inline).state).toEqual(at(2));
  });

  it("seçenek yokken oklar yalnız listeyi açar ('Sonuç yok' görünür); metin yoksa açmaz", () => {
    expect(comboKey(COMBO_CLOSED, "ArrowDown", 0, inline)).toEqual({ state: at(-1), action: null, handled: true });
    expect(comboKey(COMBO_CLOSED, "ArrowUp", 0, { ...inline, hasText: false }).state).toEqual(at(-1, false));
  });

  it("Enter: etkin seçenek varsa seçer; yoksa submit; metin yoksa dokunmaz", () => {
    expect(comboKey(at(1), "Enter", 3, inline)).toEqual({ state: at(1), action: "select", handled: true });
    expect(comboKey(at(-1), "Enter", 3, inline).action).toBe("submit");
    expect(comboKey(COMBO_CLOSED, "Enter", 3, inline).action).toBe("submit");
    // Liste kapalıyken eski etkin seçenek seçilmez
    expect(comboKey(at(1, false), "Enter", 3, inline).action).toBe("submit");
    expect(comboKey(COMBO_CLOSED, "Enter", 0, { ...inline, hasText: false })).toEqual({ state: COMBO_CLOSED, action: null, handled: false });
  });

  it("Esc (üst çubuk): açık listeyi kapatır; kapalıyken metni siler; metin de yoksa dokunmaz", () => {
    expect(comboKey(at(1), "Escape", 3, inline)).toEqual({ state: COMBO_CLOSED, action: null, handled: true });
    expect(comboKey(COMBO_CLOSED, "Escape", 3, inline)).toEqual({ state: COMBO_CLOSED, action: "clear", handled: true });
    expect(comboKey(COMBO_CLOSED, "Escape", 0, { ...inline, hasText: false }).handled).toBe(false);
  });

  it("Esc (telefon paneli): paneli bitirir; engellenmez (yerel <dialog> da Esc ile kapanır)", () => {
    expect(comboKey(at(1), "Escape", 3, panel)).toEqual({ state: COMBO_CLOSED, action: "dismiss", handled: false });
    expect(comboKey(COMBO_CLOSED, "Escape", 3, panel).action).toBe("dismiss");
  });

  it("Tab listeyi kapatır ama odağın ilerlemesini engellemez", () => {
    expect(comboKey(at(2), "Tab", 3, inline)).toEqual({ state: COMBO_CLOSED, action: null, handled: false });
  });

  it("← → Home End: yazma imleci metin kutusunda; etkin seçenek bırakılır, varsayılan davranış engellenmez", () => {
    for (const key of ["ArrowLeft", "ArrowRight", "Home", "End"]) {
      expect(comboKey(at(1), key, 3, inline), key).toEqual({ state: at(-1), action: null, handled: false });
      expect(comboKey(at(-1), key, 3, inline), key).toEqual({ state: at(-1), action: null, handled: false });
    }
  });

  it("diğer tuşlar (harf) durumu değiştirmez ve engellenmez", () => {
    expect(comboKey(at(1), "a", 3, inline)).toEqual({ state: at(1), action: null, handled: false });
  });
});
