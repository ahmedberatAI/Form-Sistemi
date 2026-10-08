// Keşif arayüzü (sunucu tarafı çizim; DOM gerekmez): 'Hızlı bul' combobox'ının ARIA sözleşmesi (role, aria-expanded, aria-controls
// → var olan listbox, etiket), büyüteç düğmesi, 'Listeme ekle' aç/kapa düğmesi (aria-pressed, sabit ad), gerekçe çipi, Ana sayfa
// 'Şu an açık' kişisel kipi, Profil › Listem yardımcıları ve PageHeader `tools` satırı. Yeni adlar e2e'nin aradığı adlarla (alt dize,
// büyük/küçük harf duyarsız) çakışmaz; üst çubukta role="search" yoktur (e2e sayfadaki search bölgesini liste süzgeci sayar).
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import type { ProposalSummary, RankReason, SavedItem, TopicSummary } from "@forum/shared";
import { describe, expect, it, vi } from "vitest";
import { DetailLevelProvider } from "../../lib/detailLevel";
import { PageHeader } from "../../ui";
import { ToastProvider } from "../../ui/Toast";

const auth = vi.hoisted(() => ({ user: null as null | { id: string; nickname: string; politicalConsent?: boolean; personalRanking?: boolean } }));
vi.mock("../../auth/AuthContext", () => ({
  useAuth: () => ({ user: auth.user, can: () => true, now: () => Date.UTC(2026, 9, 8), loading: false }),
  useServerNow: () => () => Date.UTC(2026, 9, 8),
}));

import { OPEN_ALL_HREF, OPEN_ALL_PERSONAL_HREF, OPEN_PERSONAL_NOTE, OpenNow } from "../home/OpenNow";
import { ProposalCard, ProposalRow } from "../proposals/ProposalCard";
import { QuickFind, QuickFindButton, QuickFindInline, QUICK_FIND_LABEL } from "./QuickFind";
import { ReasonChip, showsReason } from "./ReasonChip";
import { nextFocusAfterRemove, SavedListCard, SavedRowItem, savedRow, savedSummary, SAVED_PROPOSALS_HREF, visualOrder } from "./SavedListCard";
import { PersonalSortNote, personalSortLine, personalSortOff } from "../../pages/ProposalsPage";
import { SAVE_LABEL, SaveToggle, saveToggleText } from "./SaveToggle";

/** Sağlayıcılarla çizer; ToastProvider'ın boş bildirim bölgesi çıktıdan atılır. */
const render = (el: React.ReactElement) =>
  renderToStaticMarkup(
    <DetailLevelProvider>
      <ToastProvider>
        <MemoryRouter>{el}</MemoryRouter>
      </ToastProvider>
    </DetailLevelProvider>,
  ).replace(/<div class="toast-region"[^>]*><\/div>/, "");
const href = (to: string) => `href="${to.replace(/&/g, "&amp;")}"`;
const text = (html: string) => html.replace(/<[^>]*>/g, " ").replace(/&#x27;/g, "'").replace(/&quot;/g, '"').replace(/&amp;/g, "&").replace(/\s+/g, " ").trim();
const attr = (html: string, tag: string, name: string): string[] =>
  [...html.matchAll(new RegExp(`<${tag}\\b[^>]*\\s${name}="([^"]*)"`, "g"))].map((m) => m[1]);

/** e2e'nin page düzeyinde alt dize olarak aradığı adlar (getByLabel ve getByRole adları) + ayrılmış parçalar (sade.ts). */
const E2E_NAMES = [
  "Ara",
  "Konu ara",
  "Başlık",
  "Sözlükte ara",
  "Öneri metni",
  "Mesajınız",
  "Şifre",
  "Kategori",
  "Gerekçe",
  "Açıklama",
  "Eylem",
  "Düğüm",
  "Kaydet",
  "Taslak kaydet",
  "Destekle",
  "Oyumu ver",
  "Daha fazla",
  "Sayımı kendim doğrulayayım",
  "Kapat",
  "Azınlık raporu",
  "Vazgeç",
  "Hızlı eylemler",
];
const collides = (name: string) => E2E_NAMES.filter((r) => name.toLocaleLowerCase("tr-TR").includes(r.toLocaleLowerCase("tr-TR")));

const summary = (over: Partial<ProposalSummary> = {}): ProposalSummary => ({
  id: "p1",
  seq: 31,
  kind: "topic",
  title: "Kütüphane hafta sonu açık olsun",
  status: "voting",
  tier: "T0",
  authorId: "u-yazar",
  authorNickname: "yazar",
  categories: [],
  parentTopicId: null,
  createdAt: Date.UTC(2026, 9, 1),
  phaseEndsAt: Date.UTC(2099, 0, 1),
  sponsorCount: 0,
  sponsorsRequired: 4,
  messageCount: 3,
  participation: null,
  integrityWarningCount: 0,
  ...over,
});
const topic = (over: Partial<TopicSummary> = {}): TopicSummary => ({
  id: "t1",
  seq: 3,
  parentId: null,
  title: "Ulaşım",
  categories: [],
  version: 1,
  status: "active",
  createdAt: 1,
  updatedAt: 1,
  childCount: 0,
  messageCount: 0,
  openProposalCount: 0,
  ...over,
});
const reason = (kind: RankReason["kind"], t: string): RankReason => ({ kind, text: t, categories: [] });

describe("Hızlı bul: combobox ARIA sözleşmesi", () => {
  it("üst çubuk kutusu: etiket 'Hızlı bul', role=combobox, kapalıyken aria-expanded=false, aria-controls var olan listbox'a", () => {
    const html = render(<QuickFindInline />);
    expect(html).toMatch(/<label[^>]*class="sr-only"[^>]*>Hızlı bul<\/label>/);
    const [input] = html.match(/<input[^>]*>/g)!;
    expect(input).toContain('role="combobox"');
    expect(input).toContain('aria-expanded="false"');
    expect(input).toContain('aria-autocomplete="list"');
    expect(input).toContain('maxLength="100"');
    expect(input).toContain('type="text"'); // type=search değil: tarayıcının kendi Esc/temizle davranışı combobox'la çakışmaz
    expect(input).not.toContain("aria-activedescendant");
    const controls = /aria-controls="([^"]+)"/.exec(input)![1];
    expect(html).toContain(`id="${controls}"`);
    expect(html).toMatch(new RegExp(`role="listbox" id="${controls.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}" aria-label="Hızlı bul sonuçları"`));
    // Etiketin for'u metin kutusunu gösterir
    const id = /\sid="([^"]+)"/.exec(input)![1];
    expect(html).toContain(`for="${id}"`);
    // Sonuç alanı kapalıyken gizli; üst çubukta search bölgesi yok
    expect(html).toMatch(/class="qf-results qf-popup" hidden=""/);
    expect(html).not.toContain('role="search"');
    expect(html).not.toContain("<search");
  });

  it("telefon paneli: ipucu metin kutusuna aria-describedby ile bağlı; sonuçlar açılır değil panelin gövdesi", () => {
    const html = render(<QuickFind variant="panel" />);
    const [input] = html.match(/<input[^>]*>/g)!;
    const hint = /aria-describedby="([^"]+)"/.exec(input)![1];
    expect(html).toContain(`id="${hint}"`);
    expect(text(html)).toContain("en az 2 harf ya da #K12, #T3 gibi bir numara");
    expect(html).not.toContain("qf-popup");
  });

  it("büyüteç düğmesi: ad 'Hızlı bul', aria-haspopup=dialog, kapalıyken pencere çizilmez", () => {
    const html = render(<QuickFindButton />);
    expect(html).toMatch(/<button type="button" class="icon-btn header-search-btn" aria-label="Hızlı bul" aria-haspopup="dialog" aria-expanded="false">/);
    expect(html).not.toContain("<dialog");
  });

  it("etiket/aria-label adları e2e'nin aradığı adlarla çakışmaz; seçenek adları ayrılmış parçaları içermez", () => {
    // getByLabel'in de bulduğu adlar (label, aria-label): hiçbir e2e adını alt dize olarak içermez
    for (const n of [QUICK_FIND_LABEL, `${QUICK_FIND_LABEL} sonuçları`, "Geri", "Öneri ya da konu bul (#K12)"]) expect(collides(n), n).toEqual([]);
    // Seçenek ve grup adları içerikten gelir (getByLabel bulmaz): yalnız ayrılmış parçalar (sade.ts) denetlenir
    const reserved = ["Destekle", "Oyumu ver", "Daha fazla", "Sayımı kendim doğrulayayım", "Kapat", "Gerekçe", "Açıklama", "Azınlık raporu", "Düğüm"];
    for (const n of ["Konular", "Öneriler", "Tüm önerilerde ara", "Sonuç yok", "Aranıyor…"]) {
      expect(reserved.filter((r) => n.toLocaleLowerCase("tr-TR").includes(r.toLocaleLowerCase("tr-TR"))), n).toEqual([]);
    }
  });
});

describe("Listeme ekle (☆ / ★)", () => {
  it("oturum yoksa çizilmez", () => {
    auth.user = null;
    expect(render(<SaveToggle type="proposal" id="p1" saved={undefined} />)).toBe("");
  });

  it("ad her durumda 'Listeme ekle'; durum aria-pressed ve dolu yıldızla", () => {
    auth.user = { id: "u1", nickname: "ayse" };
    const on = render(<SaveToggle type="proposal" id="p1" saved />);
    expect(on).toContain('aria-pressed="true"');
    expect(on).toContain("save-toggle is-saved");
    expect(text(on)).toBe(SAVE_LABEL);
    expect(on).toContain('fill="currentColor"'); // dolu yıldız (renk tek başına durum değil)
    const off = render(<SaveToggle type="topic" id="t1" saved={false} />);
    expect(off).toContain('aria-pressed="false"');
    expect(off).not.toContain("is-saved");
    expect(text(off)).toBe("Listeme ekle");
    // Durum bilinmiyorsa (oturum sayfadan sonra yüklendi) düğme meşgul görünür, yanlış durum söylemez
    const unknown = render(<SaveToggle type="proposal" id="p1" saved={undefined} />);
    expect(unknown).toContain('aria-busy="true"');
    auth.user = null;
  });

  it("ipucu ve bildirim metinleri; ad e2e adlarıyla çakışmaz ('Kaydet', 'Destekle', 'Ekle' tam ad)", () => {
    expect(saveToggleText(false, "proposal").done).toBe("Öneri listenizden çıkarıldı.");
    expect(saveToggleText(true, "topic").done).toBe("Konu listenize eklendi.");
    expect(saveToggleText(true, "proposal").title).toContain("Profil › Listem");
    expect(collides(SAVE_LABEL)).toEqual([]);
    expect(SAVE_LABEL).not.toBe("Ekle");
  });
});

describe("gerekçe çipi", () => {
  it("'Genel sıralama' ve boş gerekçe gösterilmez", () => {
    expect(showsReason(null)).toBe(false);
    expect(showsReason(reason("general", "Genel sıralama"))).toBe(false);
    expect(render(<ReasonChip reason={reason("general", "Genel sıralama")} />)).toBe("");
    expect(render(<ReasonChip reason={undefined} />)).toBe("");
  });

  it("gri çip, ekran okuyucuya 'Sıralama nedeni:' önekiyle; 'Listenizde' yıldızlı", () => {
    const html = render(<ReasonChip reason={reason("saved", "Listenizde")} />);
    expect(html).toContain("reason-chip reason-chip-saved");
    expect(text(html)).toBe("Sıralama nedeni: Listenizde");
    expect(html).not.toMatch(/badge-(info|success|warning|danger|accent)/);
    expect(text(render(<ReasonChip reason={reason("interest", "Enerji (Çevre) ile ilgilendiğiniz için")} />))).toBe(
      "Sıralama nedeni: Enerji (Çevre) ile ilgilendiğiniz için",
    );
  });

  it("öneri satırında başlığın altında kendi satırında (meta satırının dışında), kartta başlığın altında", () => {
    const row = render(<ProposalRow proposal={summary()} reason={reason("urgent", "Süresi yaklaşıyor")} />);
    expect(row).toMatch(/<span class="prow-why"><span class="reason-chip reason-chip-urgent">/);
    const meta = /<span class="prow-meta">([\s\S]*?)<\/span><\/span>/.exec(row)?.[0] ?? "";
    expect(meta).not.toContain("reason-chip");
    expect(text(render(<ProposalRow proposal={summary()} />))).not.toContain("Sıralama nedeni");
    const card = render(<ProposalCard proposal={summary()} reason={reason("diverse", "Farklı bir alandan")} />);
    expect(card).toMatch(/<\/h3><div class="pcard-reason"><span class="reason-chip reason-chip-diverse">/);
  });
});

describe("Ana sayfa › 'Şu an açık' kişisel kipi", () => {
  const open = [
    { ...summary({ id: "a", seq: 1 }), score: 0.9, reason: reason("saved", "Listenizde") },
    { ...summary({ id: "b", seq: 2 }), score: 0.5, reason: reason("interest", "Ulaşım ile ilgilendiğiniz için") },
  ];

  it("bölge adı aynı ('Şu an açık (n)'); not başlığın dışında; satırlarda gerekçe; bağlantı 'Tümü (size göre)'", () => {
    const html = render(<OpenNow open={open} total={2} personalized />);
    expect(html).toMatch(/<h2 class="section-title" id="[^"]+">Şu an açık \(2\)<\/h2>/);
    expect(html).toContain(`<p class="section-description">${OPEN_PERSONAL_NOTE}</p>`);
    expect(OPEN_PERSONAL_NOTE).toContain("oy bilgisi kullanılmaz");
    expect(text(html)).toContain("Sıralama nedeni: Listenizde");
    expect(text(html)).toContain("Sıralama nedeni: Ulaşım ile ilgilendiğiniz için");
    expect(html).toContain(href(OPEN_ALL_PERSONAL_HREF));
    expect(OPEN_ALL_PERSONAL_HREF).toBe("/oneriler?sekme=acik&sirala=sana-gore");
    expect(text(html)).toContain("Tümü (size göre)");
  });

  it("kişisel değilse eskisi gibi: not yok, gerekçe yok (gelse bile), 'Tümü (süreye göre)'", () => {
    const html = render(<OpenNow open={open} total={2} />);
    expect(html).not.toContain("section-description");
    expect(html).not.toContain("reason-chip");
    expect(html).toContain(href(OPEN_ALL_HREF));
    expect(text(html)).toContain("Tümü (süreye göre)");
  });
});

describe("Profil › Listem", () => {
  const items: SavedItem[] = [
    { type: "proposal", id: "p1", savedAt: 3, proposal: summary({ status: "enacted" }) },
    { type: "topic", id: "t1", savedAt: 2, topic: topic({ status: "archived" }) },
    { type: "proposal", id: "p2", savedAt: 1, proposal: summary({ id: "p2", seq: 7 }) },
  ];

  it("özet: '2 öneri ve 1 konu' / 'Listeniz boş'", () => {
    expect(savedSummary(items)).toBe("2 öneri ve 1 konu");
    expect(savedSummary(items.slice(1, 2))).toBe("1 konu");
    expect(savedSummary([])).toBe("Listeniz boş");
  });

  it("satır: bağlantı, numara, durum metni (rozet değil)", () => {
    expect(savedRow(items[0])).toEqual({ href: "/oneriler/p1", ref: "#K-31", title: "Kütüphane hafta sonu açık olsun", status: "Kabul edildi" });
    expect(savedRow(items[1])).toEqual({ href: "/konular/t1", ref: "#T-3", title: "Ulaşım", status: "Arşivlendi" });
    expect(SAVED_PROPOSALS_HREF).toBe("/oneriler?sekme=listem");
  });

  it("'Çıkar'dan sonra odak EKRANDAKİ sıradaki satıra: Öneriler grubu bitince Konular'a; yoksa öncekine; boşalınca null", () => {
    // Sunucu sırası (eklenme zamanı): p1, t1, p2 — ekranda: Öneriler (p1, p2), Konular (t1)
    expect(visualOrder(items).map((x) => x.id)).toEqual(["p1", "p2", "t1"]);
    expect(nextFocusAfterRemove(items, items[0])?.id, "p1 çıkınca görsel sıradaki p2").toBe("p2");
    expect(nextFocusAfterRemove(items, items[2])?.id, "p2 (son öneri) çıkınca Konular'daki t1").toBe("t1");
    expect(nextFocusAfterRemove(items, items[1])?.id, "t1 (en son) çıkınca önceki: p2").toBe("p2");
    expect(nextFocusAfterRemove([items[1]], items[1])).toBeNull();
  });

  it("satır: 'Çıkar: #K-31' (başlık adda değil, aria-describedby ile); meta '<durum> · <zaman> eklendi'", () => {
    const kapat = { type: "proposal" as const, id: "p9", savedAt: Date.UTC(2026, 9, 7), proposal: summary({ id: "p9", seq: 31, title: "Çarşının Araç Trafiğine Kapatılması" }) };
    const html = render(
      <ul>
        <SavedRowItem item={kapat} titleId="t-p9" onRemove={() => undefined} />
      </ul>,
    );
    const button = /<button[^>]*>([\s\S]*?)<\/button>/.exec(html)!;
    expect(text(button[1])).toBe("Çıkar : #K-31");
    expect(button[0]).toContain('aria-describedby="t-p9"');
    expect(html).toContain('id="t-p9"');
    expect(collides(text(button[1]))).toEqual([]);
    expect(text(html)).toMatch(/Kabul edildi|Oylamada/);
    expect(text(html)).toMatch(/Oylamada · .+ eklendi Çıkar/);
  });

  it("kart başlığı 'Listem', çapa #listem, katlanmaz (Profil 'Tam' sözleşmesi)", () => {
    auth.user = { id: "u1", nickname: "ayse" };
    const html = render(<SavedListCard />);
    expect(html).toMatch(/<section[^>]*id="listem"/);
    expect(html).toContain(">Listem</h2>");
    expect(html).not.toContain("card-toggle");
    auth.user = null;
  });

  it("'Kişisel sıralama' tercihi kartta: varsayılan açık; rıza yoksa etkisiz olduğu söylenir; ad e2e adlarıyla çakışmaz", () => {
    auth.user = { id: "u1", nickname: "ayse", politicalConsent: true };
    const on = render(<SavedListCard />);
    expect(on).toMatch(/<input[^>]*type="checkbox"[^>]*checked=""/);
    expect(text(on)).toContain("Kişisel sıralama");
    expect(text(on)).toContain("Siyasi görüş rızanıza dayanır");
    expect(collides("Kişisel sıralama")).toEqual([]);
    auth.user = { id: "u1", nickname: "ayse", politicalConsent: true, personalRanking: false };
    expect(render(<SavedListCard />)).not.toMatch(/<input[^>]*type="checkbox"[^>]*checked=""/);
    auth.user = { id: "u1", nickname: "ayse", politicalConsent: false };
    expect(text(render(<SavedListCard />))).toContain("Siyasi görüş rızanız olmadığı için kişisel sıralama yapılmaz");
    auth.user = null;
  });
});

describe("Öneriler › 'Size göre' notu", () => {
  it("kişisel sıra yoksa nedeni: etkinlik yetersiz · tercih kapalı · rıza yok (siz hitabı)", () => {
    expect(personalSortOff(null)).toBeNull();
    expect(personalSortOff({ politicalConsent: true })).toBeNull();
    expect(personalSortOff({ politicalConsent: true, personalRanking: false })).toBe("preference");
    expect(personalSortOff({ politicalConsent: false, personalRanking: true })).toBe("consent");
    expect(personalSortLine(true, null)).toBe("Size göre sıralandı. Hiçbir öneri gizlenmez; yalnız sıra değişir.");
    expect(personalSortLine(false, null)).toMatch(/^Henüz size göre sıralayacak kadar etkinlik yok/);
    expect(personalSortLine(false, "preference")).toMatch(/^Kişisel sıralama kapalı/);
    expect(personalSortLine(false, "consent")).toMatch(/siyasi görüş rızanıza dayanır/);
  });

  it("açıklama süzgeçten bağımsız ('düzenli aralıklarla'), 'siz' hitabıyla; kapalıysa Profil › Listem bağlantısı", () => {
    const html = render(<PersonalSortNote personalized />);
    const t = text(html);
    expect(t).toContain("Düzenli aralıklarla ilgi alanlarınızın dışından bir öneri yer alır.");
    expect(t).not.toMatch(/Her dördüncü/);
    expect(t).toContain("Oylarınız, oy verip vermediğiniz bilgisi ve itiraz imzalarınız kullanılmaz.");
    expect(t).toContain("ana sayfadaki ‘Şu an açık’ ile aynı sıradadır");
    expect(t).not.toMatch(/(?<!\p{L})(yazdığın|listene|açtığın|vermediğin|imzaların|ilgilendiğin)(?!\p{L})/u);
    const off = render(<PersonalSortNote personalized={false} off="preference" />);
    expect(off).toContain(href("/profil?bolum=listem"));
    expect(render(<PersonalSortNote personalized={false} off="consent" />)).toContain(href("/profil?bolum=rizalar"));
  });
});

describe("PageHeader tools", () => {
  it("araç geri bağlantısıyla aynı satırda; araç yoksa yapı değişmez", () => {
    const withTools = render(<PageHeader title="Başlık" back={{ to: "/oneriler", label: "Öneriler" }} tools={<button type="button">X</button>} />);
    expect(withTools).toMatch(/<div class="page-header-top"><a class="page-back" href="\/oneriler"[^>]*>[\s\S]*?<\/a><div class="page-tools"><button type="button">X<\/button><\/div><\/div>/);
    const plain = render(<PageHeader title="Başlık" back={{ to: "/oneriler", label: "Öneriler" }} />);
    expect(plain).not.toContain("page-header-top");
    expect(plain).toMatch(/<header class="page-header"><a class="page-back"/);
  });

  it("araçlar geri bağlantısı yokken de kendi satırında sağa yaslanır", () => {
    const html = render(<PageHeader title="Konu" tools={<span>T</span>} />);
    expect(html).toContain('<div class="page-header-top"><span></span><div class="page-tools"><span>T</span></div></div>');
  });
});

describe("üretilen öğe öznitelikleri", () => {
  it("öneri listesi kimliği ve etiket kimliği benzersiz (iki kutu aynı sayfada çizilse de)", () => {
    const html = render(
      <>
        <QuickFindInline />
        <QuickFind variant="panel" />
      </>,
    );
    const ids = attr(html, "[a-z]+", "id");
    expect(new Set(ids).size).toBe(ids.length);
  });
});
