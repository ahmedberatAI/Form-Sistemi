// Öneriler listesi sekme modeli: eski 9 ?sekme= kimliğinin eşlenmesi, asla boş açılmayan akıllı varsayılan, sekme/çip üyeliği
// ve sayıları, görünüm ↔ parametre gidiş-dönüşü, test sözleşmesi adları. Saf işlevler; React/DOM gerekmez. Dosya sonunda sade
// öneri kartının (rozet bütçesi) sunucu tarafı çizim sözleşmesi de denetlenir.
import { PROPOSAL_STATUS_LABELS, type ProposalStatus, type ProposalSummary } from "@forum/shared";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { describe, expect, it } from "vitest";
import { ProposalCard } from "../components/proposals/ProposalCard";
import {
  autoTabNote,
  CLOSED_PHASE_STATUSES,
  countPhases,
  countTabs,
  inPhase,
  inTopTab,
  listTabParam,
  OPEN_PHASE_STATUSES,
  PHASES,
  phasesOf,
  resolveListTab,
  TOP_TABS,
  type ListCounts,
  type PhaseId,
  type TabProposal,
  type TopTabId,
} from "./proposalsTabs";

const ALL_STATUSES = Object.keys(PROPOSAL_STATUS_LABELS) as ProposalStatus[];
const counts = (acik: number, sonuc: number, tumu = acik + sonuc, benim: number | null = 0): ListCounts => ({ acik, sonuc, tumu, benim });
const prop = (status: ProposalStatus, authorId = "u1"): TabProposal => ({ status, authorId });

describe("resolveListTab: eski ?sekme= kimlikleri", () => {
  // Eski 9 sekme: acik, destek, tartisma, oylama, itiraz, kabul, red, tumu, benim → yeni (üst sekme, çip)
  const legacy: [string, TopTabId, PhaseId | null][] = [
    ["acik", "acik", null],
    ["destek", "acik", "destek"],
    ["tartisma", "acik", "tartisma"],
    ["oylama", "acik", "oylama"],
    ["itiraz", "acik", "itiraz"],
    ["kabul", "sonuc", "kabul"],
    ["red", "sonuc", "red"],
    ["tumu", "tumu", null],
    ["benim", "benim", null],
  ];

  it.each(legacy)("%s → %s / %s", (param, tab, phase) => {
    expect(resolveListTab(param, counts(5, 5))).toEqual({ tab, phase, auto: false });
  });

  it("yeni kimlikler: sonuc ve kapanan Sonuçlanan altında", () => {
    expect(resolveListTab("sonuc", counts(5, 5))).toEqual({ tab: "sonuc", phase: null, auto: false });
    expect(resolveListTab("kapanan", counts(5, 5))).toEqual({ tab: "sonuc", phase: "kapanan", auto: false });
  });

  it("açıkça istenen görünüm sayı 0 olsa da değişmez (kullanıcı ya da bağlantı ne istediyse o)", () => {
    expect(resolveListTab("acik", counts(0, 30))).toEqual({ tab: "acik", phase: null, auto: false });
    expect(resolveListTab("oylama", counts(0, 30))).toEqual({ tab: "acik", phase: "oylama", auto: false });
    expect(resolveListTab("tumu", counts(0, 0, 0))).toEqual({ tab: "tumu", phase: null, auto: false });
  });

  it("Benim üyede (sayı 0 olsa da) geçerli; ziyaretçide geçersiz sayılıp akıllı varsayılana düşer", () => {
    expect(resolveListTab("benim", counts(0, 3, 3, 0))).toEqual({ tab: "benim", phase: null, auto: false });
    expect(resolveListTab("benim", counts(2, 3, 5, null))).toEqual({ tab: "acik", phase: null, auto: true });
    expect(resolveListTab("benim", counts(0, 3, 3, null))).toEqual({ tab: "sonuc", phase: null, auto: true });
  });
});

describe("resolveListTab: asla boş açılmayan akıllı varsayılan", () => {
  it("Açık doluysa Açık, değilse Sonuçlanan, o da boşsa Tümü; hiçbiri doluysa Açık", () => {
    expect(resolveListTab(null, counts(4, 30))).toEqual({ tab: "acik", phase: null, auto: true });
    expect(resolveListTab("", counts(0, 30))).toEqual({ tab: "sonuc", phase: null, auto: true });
    expect(resolveListTab(undefined, counts(0, 0, 2))).toEqual({ tab: "tumu", phase: null, auto: true });
    expect(resolveListTab(null, counts(0, 0, 0))).toEqual({ tab: "acik", phase: null, auto: true });
  });

  it("ölçülen demo verisi (açık 0, sonuçlanan 30+) ilk açılışta Sonuçlanan'ı seçer", () => {
    const view = resolveListTab(null, counts(0, 33, 33));
    expect(view).toEqual({ tab: "sonuc", phase: null, auto: true });
  });

  it("geçersiz, büyük/küçük harf farklı ve prototip anahtarları varsayılana düşer (sızma yok)", () => {
    for (const bad of ["Acik", " acik", "acik ", "ACIK", "hepsi", "bilinmeyen", "constructor", "__proto__", "toString", "hasOwnProperty", "valueOf", "0", "%00"]) {
      expect(resolveListTab(bad, counts(0, 7))).toEqual({ tab: "sonuc", phase: null, auto: true });
    }
  });

  it("varsayılan seçim yalnız sayılara bakar (aynı sayılar → aynı sonuç)", () => {
    const a = resolveListTab(null, counts(1, 0));
    const b = resolveListTab(undefined, counts(1, 99));
    expect(a).toEqual(b);
  });
});

describe("autoTabNote", () => {
  it("yalnız akıllı varsayılan Açık'tan başka sekme seçtiyse görünür", () => {
    expect(autoTabNote(resolveListTab(null, counts(0, 30)))).toBe("Şu an açık öneri yok; sonuçlanan öneriler gösteriliyor.");
    expect(autoTabNote(resolveListTab(null, counts(0, 0, 3)))).toBe("Şu an açık ya da sonuçlanan öneri yok; tüm öneriler gösteriliyor.");
    expect(autoTabNote(resolveListTab(null, counts(2, 30)))).toBeNull();
    expect(autoTabNote(resolveListTab(null, counts(0, 0, 0)))).toBeNull();
    expect(autoTabNote(resolveListTab("sonuc", counts(0, 30)))).toBeNull(); // kullanıcı kendisi seçti
    expect(autoTabNote(resolveListTab("acik", counts(0, 30)))).toBeNull();
  });
});

describe("görünüm ↔ ?sekme= gidiş-dönüşü", () => {
  it("her üst sekme ve her çip kendi parametresine yazılıp aynı görünüme geri çözülür", () => {
    for (const t of TOP_TABS) {
      const view = { tab: t.id, phase: null as PhaseId | null };
      expect(resolveListTab(listTabParam(view), counts(1, 1))).toEqual({ ...view, auto: false });
    }
    for (const ph of PHASES) {
      const view = { tab: ph.tab, phase: ph.id as PhaseId | null };
      expect(listTabParam(view)).toBe(ph.id);
      expect(resolveListTab(listTabParam(view), counts(1, 1))).toEqual({ ...view, auto: false });
    }
  });

  it("'Açık' tıklaması varsayılana eşit değerle silinmez: parametre acik olarak yazılır (varsayılan '' olduğu için)", () => {
    // useQueryState("sekme", "") varsayılanı '' ; listTabParam hiçbir görünüm için '' üretmez
    for (const t of TOP_TABS) expect(listTabParam({ tab: t.id, phase: null })).not.toBe("");
    for (const ph of PHASES) expect(listTabParam({ tab: ph.tab, phase: ph.id })).not.toBe("");
  });
});

describe("sekme ve çip üyeliği", () => {
  it("4 üst sekme: Açık · Sonuçlanan · Tümü · Benim", () => {
    expect(TOP_TABS.map((t) => t.id)).toEqual(["acik", "sonuc", "tumu", "benim"]);
    expect(TOP_TABS.map((t) => t.label)).toEqual(["Açık", "Sonuçlanan", "Tümü", "Benim"]);
  });

  it("taslak dışındaki her durum Açık ya da Sonuçlanan'dan tam birindedir; taslak hiçbirinde değildir", () => {
    for (const st of ALL_STATUSES) {
      const p = prop(st, "baska");
      const inOpen = inTopTab(p, "acik", "u1");
      const inClosed = inTopTab(p, "sonuc", "u1");
      if (st === "draft") expect([inOpen, inClosed]).toEqual([false, false]);
      else expect(Number(inOpen) + Number(inClosed), st).toBe(1);
      expect(OPEN_PHASE_STATUSES.includes(st) || CLOSED_PHASE_STATUSES.includes(st) || st === "draft", st).toBe(true);
    }
  });

  it("yedi evre çipi taslak dışındaki her durumu tam bir kez kapsar ve kendi sekmesinin üyesidir", () => {
    expect(PHASES).toHaveLength(7);
    expect(phasesOf("acik").map((p) => p.id)).toEqual(["destek", "tartisma", "oylama", "itiraz"]);
    expect(phasesOf("sonuc").map((p) => p.id)).toEqual(["kabul", "red", "kapanan"]);
    expect(phasesOf("tumu")).toEqual([]);
    expect(phasesOf("benim")).toEqual([]);
    for (const st of ALL_STATUSES.filter((s) => s !== "draft")) {
      const owners = PHASES.filter((ph) => ph.statuses.includes(st));
      expect(owners, st).toHaveLength(1);
      expect(inTopTab(prop(st, "baska"), owners[0].tab, null), st).toBe(true);
    }
    expect(PHASES.some((ph) => ph.statuses.includes("draft"))).toBe(false);
  });

  it("evre eşlemesi eski sekmelerle aynı: oylama = voting+revote, itiraz = itiraz süresi+uzlaşma, red = reddedilen+aykırı", () => {
    const by = Object.fromEntries(PHASES.map((p) => [p.id, p.statuses]));
    expect(by.destek).toEqual(["sponsoring"]);
    expect(by.tartisma).toEqual(["deliberation"]);
    expect(by.oylama).toEqual(["voting", "revote"]);
    expect(by.itiraz).toEqual(["objection_window", "reconciliation"]);
    expect(by.kabul).toEqual(["enacted"]);
    expect(by.red).toEqual(["rejected", "inadmissible"]);
    expect(by.kapanan).toEqual(["withdrawn", "expired"]);
    expect(inPhase(prop("revote"), "oylama")).toBe(true);
    expect(inPhase(prop("voting"), "itiraz")).toBe(false);
  });

  it("taslak yalnız yazarına: Tümü ve Benim'de; başkasının taslağı hiçbir yerde, ziyaretçide hiçbir yerde", () => {
    const mine = prop("draft", "u1");
    expect(inTopTab(mine, "tumu", "u1")).toBe(true);
    expect(inTopTab(mine, "benim", "u1")).toBe(true);
    expect(inTopTab(mine, "acik", "u1")).toBe(false);
    expect(inTopTab(mine, "sonuc", "u1")).toBe(false);
    const theirs = prop("draft", "u2");
    for (const t of TOP_TABS) expect(inTopTab(theirs, t.id, "u1"), t.id).toBe(false);
    for (const t of TOP_TABS) expect(inTopTab(mine, t.id, null), t.id).toBe(false);
  });

  it("Benim, yazarın her evredeki önerisini toplar; Tümü başkalarının taslak olmayanlarını da içerir", () => {
    expect(inTopTab(prop("enacted", "u1"), "benim", "u1")).toBe(true);
    expect(inTopTab(prop("enacted", "u2"), "benim", "u1")).toBe(false);
    expect(inTopTab(prop("expired", "u2"), "tumu", "u1")).toBe(true);
    expect(inTopTab(prop("withdrawn", "u2"), "tumu", null)).toBe(true);
  });
});

describe("sayılar", () => {
  const list: TabProposal[] = [
    prop("sponsoring", "u2"),
    prop("voting", "u1"),
    prop("revote", "u2"),
    prop("enacted", "u2"),
    prop("enacted", "u1"),
    prop("rejected", "u2"),
    prop("withdrawn", "u2"),
    prop("expired", "u1"),
    prop("draft", "u1"),
    prop("draft", "u2"),
  ];

  it("üye için dört sekme sayısı; ziyaretçide benim null (sekme gösterilmez)", () => {
    expect(countTabs(list, "u1")).toEqual({ acik: 3, sonuc: 5, tumu: 9, benim: 4 });
    expect(countTabs(list, null)).toEqual({ acik: 3, sonuc: 5, tumu: 8, benim: null });
    expect(countTabs([], "u1")).toEqual({ acik: 0, sonuc: 0, tumu: 0, benim: 0 });
  });

  it("çip sayıları evre durumlarına göre; sekme sayısı çip sayılarının toplamıdır", () => {
    const c = countPhases(list);
    expect(c).toEqual({ destek: 1, tartisma: 0, oylama: 2, itiraz: 0, kabul: 2, red: 1, kapanan: 2 });
    const tabs = countTabs(list, "u1");
    expect(c.destek + c.tartisma + c.oylama + c.itiraz).toBe(tabs.acik);
    expect(c.kabul + c.red + c.kapanan).toBe(tabs.sonuc);
  });
});

describe("test sözleşmesi adları", () => {
  // Yeni düğme/bağlantı/region/label adları e2e'nin arayüz adlarıyla alt dize çakışmamalı (plan: yol gösteren ilkeler, b ve d).
  const NAMES = [...TOP_TABS.map((t) => t.label), ...PHASES.map((p) => p.label), "Hepsi", "Evre", "Öneri durumu", "Süz ve sırala", "Sonuçlanan önerileri göster", "Evre süzgecini kaldır"];
  const FORBIDDEN_BUTTON = ["Destekle", "Oyumu ver", "Daha fazla", "Sayımı kendim doğrulayayım", "Kapat"];
  const FORBIDDEN_REGION = ["Oylama", "Uzlaşma turu", "Azınlık raporları", "Destekçiler (", "1. tur sonucu", "Azınlık itirazı"];
  const FORBIDDEN_ARIA = ["Gerekçe", "Açıklama", "Azınlık raporu"];

  it("düğme/bağlantı adları yasak alt dizeleri içermez", () => {
    for (const name of NAMES) for (const bad of FORBIDDEN_BUTTON) expect(name.toLowerCase(), `${name} ⊃ ${bad}`).not.toContain(bad.toLowerCase());
  });

  it("region adı olabilecek metinler (üst sekme ve grup adları) yasak alt dizeleri içermez", () => {
    // 'Oylamada' çipi düğmedir, region değil; yine de bölge adı olarak kullanılabilecek sabitler denetlenir.
    for (const name of ["Öneri durumu", "Evre", "Süz ve sırala", ...TOP_TABS.map((t) => t.label)]) {
      for (const bad of FORBIDDEN_REGION) expect(name.toLowerCase(), `${name} ⊃ ${bad}`).not.toContain(bad.toLowerCase());
    }
  });

  it("aria-label olarak 'Gerekçe', 'Açıklama' ya da 'Azınlık raporu' kullanılmaz", () => {
    for (const name of ["Evre", "Öneri durumu"]) for (const bad of FORBIDDEN_ARIA) expect(name).not.toContain(bad);
  });

  it("çip açıklaması yalnız Oylamada çipinde 'ara sonuç gösterilmez' der", () => {
    for (const ph of PHASES) {
      const says = ph.info.toLowerCase().includes("ara sonuç gösterilmez");
      expect(says, ph.id).toBe(ph.id === "oylama");
    }
  });
});

// ───────────── Sade öneri kartı (rozet bütçesi): sunucu tarafı çizim, DOM gerekmez ─────────────

const card = (over: Partial<ProposalSummary>, props: { myId?: string | null; compact?: boolean } = {}): string => {
  const proposal: ProposalSummary = {
    id: "p1",
    seq: 7,
    kind: "topic",
    title: "Örnek başlık",
    status: "enacted",
    tier: "T0",
    authorId: "u2",
    authorNickname: "ayse",
    categories: [],
    parentTopicId: null,
    createdAt: Date.now() - 2 * 86_400_000,
    phaseEndsAt: null,
    sponsorCount: 0,
    sponsorsRequired: 0,
    messageCount: 4,
    participation: null,
    integrityWarningCount: 0,
    ...over,
  };
  return renderToStaticMarkup(createElement(MemoryRouter, null, createElement(ProposalCard, { proposal, ...props })));
};
const badges = (html: string): string[] => html.match(/class="badge badge-[a-z]+/g) ?? [];

describe("sade öneri kartı (rozet bütçesi)", () => {
  it("olağan (T0) kararda yalnız TEK durum rozeti vardır; tür rozet değil, meta satırında düz metindir", () => {
    const html = card({ kind: "amendment" });
    expect(badges(html)).toHaveLength(1);
    expect(html).toContain("Kabul edildi");
    expect(html).toMatch(/pcard-meta[^"]*">\s*<span>Düzenleme Teklifi<\/span>/);
    expect(html).not.toMatch(/class="badge[^>]*>[^<]*Düzenleme Teklifi/);
  });

  it("T0 dışı katman rozeti görünür; katman (T3 dışı) ve 'Sizin' nötr olduğundan renkli rozet yalnız durumdur (rozet bütçesi)", () => {
    const html = card({ status: "voting", tier: "T1", authorId: "u1" }, { myId: "u1" });
    const all = badges(html);
    expect(all).toHaveLength(3); // durum + katman + Sizin
    expect(all.filter((b) => !b.endsWith("badge-neutral"))).toEqual(['class="badge badge-info']);
    expect(html).toContain("pcard-mine");
    expect(html).toContain("Sizin");
  });

  it("kategoriler en çok 2 gösterilir, kalan '+n' olur (kalanlar title'da, ekran okuyucuya 'kategori daha')", () => {
    const html = card({ categories: ["fy:Cevre", "fy:Ulasim", "fy:Saglik", "fy:Egitim"] });
    expect(html.match(/class="cat-tag"/g)).toHaveLength(2);
    expect(html).toMatch(/cat-tag cat-tag-more"[^>]*>\+2<span class="sr-only"> kategori daha<\/span>/);
    expect(card({ categories: ["fy:Cevre", "fy:Ulasim"] })).not.toContain("cat-tag-more");
    expect(card({ categories: ["fy:Cevre", "fy:Ulasim", "fy:Saglik", "fy:Egitim"] }, { compact: true })).not.toContain("cat-tag");
  });

  it("katılım çubuğunun etiketi 'Katılım (ara sonuç gizli)'; tekrar eden cümle görünmez, kartın açıklaması olarak kalır", () => {
    const html = card({ status: "voting", participation: { voted: 12, eligible: 40 }, phaseEndsAt: Date.now() + 3_600_000 });
    expect(html).toContain("Katılım (ara sonuç gizli)");
    expect(html).toMatch(/<article[^>]*aria-describedby="([^"]+)"/);
    const id = /<article[^>]*aria-describedby="([^"]+)"/.exec(html)![1];
    expect(html).toContain(`<span id="${id}" class="sr-only">Ara sonuç oylama bitene kadar gizlidir.</span>`);
    expect(html).not.toMatch(/class="small muted">Ara sonuç/);
    expect(card({ status: "enacted" })).not.toContain("aria-describedby");
  });

  it("kompakt kartta yazar satırı yoktur; mesaj sayısı meta satırında", () => {
    const html = card({}, { compact: true });
    expect(html).not.toContain("user-link");
    expect(html).toContain("4 mesaj");
  });
});
