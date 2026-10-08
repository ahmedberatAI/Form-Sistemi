// Senaryo 1 — 360 px sayfa taraması: tüm rotalar (ziyaretçi, üye, bekleyen üye, bilirkişi, kayıt memuru, denetçi, yönetici),
// sekmeli sayfalarda her sekme ve tohumdaki her öneri sayfası. Her görünümde:
//   document.documentElement.scrollWidth - innerWidth === 0 (yatay taşma yok) ve sayfa/konsol hatası yok.
// Faz 2 ekleri: tartışmadaki, oylamadaki ve kabul edilmiş birer öneride (sade ve 'Tam' görünümde) 'Bu sayfada' gezinmesinin her
// bağlantısına tıklanır (hedef bölüm görünür alana gelir, üst çubuğun altında kalmaz, odak içine taşınır, ?bolum silinir) ve
// 'Daha fazla' sayfasında Sistem durumu bloğu aranır.
// Faz 3 ekleri: 'Keşfet ve doğrula' (/kesfet; ziyaretçi, 'Tam' görünüm ve yönetici; 'Bu sayfada' tıklamaları, sözlük araması, Term
// penceresi), Term pencereleri ve sembol/formül anahtarı açıkken Karar parametreleri, Konular 'Süz' açılırı, konu ayrıntısı çapaları
// (?bolum=surumler|alt-konular), Profil/Ayarlar çapaları, canlı ön denetim paneli, silme talebi formu ve üyenin 'Tam' görünümü.
// Keşif ekleri: 'Hızlı bul' telefon paneli (boş, sonuçlarla, 'Sonuç yok'; ziyaretçi ve üye), Öneriler'de 5 sekme ve Listem sekmesi,
// 'Size göre' sıralama (gerekçe çipleri, 'nasıl sıralar' açık), Profil › Listem (dolu) ve 'Listeme ekle' düğmeli öneri/konu sayfaları.
import { expect, test, type Browser, type Page } from "@playwright/test";
import type { CommittedTxView, LedgerStatus, ProposalSummary, PublicUser, ThreadResponse, TopicSummary } from "@forum/shared";
import { useSeededServer } from "../support/fixtures";
import { clickEveryOnThisPage } from "../support/sade";
import { gotoApp, measureOverflow, openSession, waitSettled, type Session } from "../support/ui";

const ctx = useSeededServer("tarama");

const PHONE = { viewport: { width: 360, height: 780 }, deviceScaleFactor: 2, hasTouch: true };

interface View {
  label: string;
  path: string;
  /** Sayfadaki ilk sekme listesinin her sekmesini de tara */
  tabs?: boolean;
  /** Görünüm yüklendikten sonra yapılacak ek etkileşim (ör. alt sayfa / pencere açma); ayrı görünüm olarak ölçülür */
  extra?: { label: string; run: (page: Page) => Promise<void> };
}

interface Problem {
  view: string;
  issue: string;
}

let scanned = 0;
const problems: Problem[] = [];

async function check(page: Page, label: string, s: Session, errorsBefore: number): Promise<void> {
  scanned++;
  const o = await measureOverflow(page);
  if (o.overflow !== 0) problems.push({ view: label, issue: `yatay taşma ${o.overflow} px (scrollWidth ${o.scrollWidth}, innerWidth ${o.innerWidth}): ${o.offenders.join("; ")}` });
  for (const e of s.errors.slice(errorsBefore)) problems.push({ view: label, issue: e });
}

async function scan(s: Session, role: string, views: View[]): Promise<void> {
  const { page } = s;
  for (const v of views) {
    const label = `${role} · ${v.label} (${v.path})`;
    let errorsBefore = s.errors.length;
    await gotoApp(page, v.path);
    await check(page, label, s, errorsBefore);
    if (v.tabs) {
      const tabs = page.locator("main [role=tablist]").first().getByRole("tab");
      const n = await tabs.count();
      for (let i = 0; i < n; i++) {
        const tab = tabs.nth(i);
        if ((await tab.getAttribute("aria-selected")) === "true" || (await tab.isDisabled())) continue;
        const name = (await tab.innerText()).trim().replace(/\s+/g, " ");
        errorsBefore = s.errors.length;
        await tab.click();
        await expect(tab).toHaveAttribute("aria-selected", "true");
        await waitSettled(page);
        await check(page, `${label} › sekme "${name}"`, s, errorsBefore);
      }
    }
    if (v.extra) {
      await gotoApp(page, v.path);
      errorsBefore = s.errors.length;
      await v.extra.run(page);
      await waitSettled(page);
      await check(page, `${label} › ${v.extra.label}`, s, errorsBefore);
    }
  }
}

/** Mobil alt gezinmedeki "Daha fazla" alt sayfası (en altında 'Sistem durumu' bloğu: her sayfadan 1 dokunuşla sistem bilgisi). */
const moreSheet: View["extra"] = {
  label: "“Daha fazla” alt sayfası",
  run: async (page) => {
    await page.getByRole("button", { name: /Daha fazla/ }).click();
    const dialog = page.getByRole("dialog", { name: "Daha fazla" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("region", { name: "Sistem durumu", exact: true })).toBeVisible();
  },
};

/** Öneri sayfasında 'Bu sayfada' gezinmesinin her bağlantısına tıklar (kısa yollar: Metin · eylem · Sonuç · Bilirkişi · Tartışma · Kanıtlar). */
const onThisPageLinks: View["extra"] = {
  label: "‘Bu sayfada’ bağlantı tıklamaları",
  run: async (page) => {
    await clickEveryOnThisPage(page);
  },
};

/** Açık bir sözlük terimi penceresi (Term): ilk eşleşen terim düğmesine dokunulur; açık pencere de 360 px'e sığmalı (measureOverflow pencereyi de ölçer). */
function openTerm(selector: string): View["extra"] {
  return {
    label: "Term penceresi açık",
    run: async (page) => {
      await page.locator(selector).first().click();
      await expect(page.getByRole("dialog")).toBeVisible();
    },
  };
}

/** Yeni konu formunu doldurur: tür kompakt şeride iner ve canlı ön denetim paneli (hüküm, açılırlar) dolar. Hiçbir şey kaydedilmez. */
const fillPrecheck: View["extra"] = {
  label: "canlı ön denetim paneli dolu",
  run: async (page) => {
    await page.getByRole("radio", { name: /Yeni Konu/ }).click();
    await page.getByLabel("Başlık").fill("Mahalle Kütüphanesinde Haftalık Ücretsiz Satranç Atölyesi");
    await page
      .getByLabel("Öneri metni")
      .fill(
        "Mahalle kütüphanesinin çok amaçlı salonunda her cumartesi öğleden sonra iki saatlik ücretsiz satranç atölyesi düzenlenmesini öneriyorum. " +
          "Atölye her yaştan katılımcıya açık olur, gönüllü eğitmenlerle yürütülür ve kütüphanenin mevcut masaları kullanılır; ek bütçe gerekmez.",
      );
    await page.getByLabel("Kütüphane ve yaşam boyu öğrenme", { exact: true }).check();
    await expect(page.locator(".pre-summary")).toContainText("Yönetmeliğe uygun", { timeout: 30_000 });
  },
};

/** 'Karar parametreleri' kartında 'Sembolleri ve formülleri göster' anahtarı açık: Yunan harfleri ve formüller 360 px'e sığmalı. */
const symbolsOn: View["extra"] = {
  label: "semboller ve formüller açık",
  run: async (page) => {
    await page.getByRole("switch", { name: "Sembolleri ve formülleri göster" }).click();
    await expect(page.locator(".param-symbol").first()).toBeVisible();
  },
};

/** 'Hızlı bul' telefon paneli: büyüteç düğmesi tam ekran paneli açar (yerel dialog). Panel de 360 px'e sığmalı (measureOverflow pencereyi de ölçer). */
async function openQuickFind(page: Page) {
  await page.getByRole("button", { name: "Hızlı bul", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Hızlı bul", exact: true });
  await expect(dialog).toBeVisible();
  return { dialog, box: dialog.getByRole("combobox", { name: "Hızlı bul", exact: true }) };
}

/** Panel açık, henüz yazılmadı: ipucu metni görünür. */
const quickFindEmpty: View["extra"] = {
  label: "‘Hızlı bul’ paneli açık (boş)",
  run: async (page) => {
    const { dialog } = await openQuickFind(page);
    await expect(dialog).toContainText("en az 2 harf");
  },
};

/** Panel açık, 'mahalle' yazıldı: gruplu sonuçlar (en çok 8) ve 'Tüm önerilerde ara' seçeneği, ilk seçenek etkin. */
const quickFindResults: View["extra"] = {
  label: "‘Hızlı bul’ paneli açık (sonuçlarla)",
  run: async (page) => {
    const { dialog, box } = await openQuickFind(page);
    await box.pressSequentially("mahalle");
    await expect(dialog.locator("[role=option]:has(.qf-ref)").first()).toBeVisible();
    await expect(dialog.getByRole("option").last()).toContainText("Tüm önerilerde ara");
    await box.press("ArrowDown");
  },
};

/** Panel açık, eşleşmeyen metin: 'Sonuç yok' ve yalnız 'Tüm önerilerde ara' seçeneği. */
const quickFindNone: View["extra"] = {
  label: "‘Hızlı bul’ paneli açık (Sonuç yok)",
  run: async (page) => {
    const { dialog, box } = await openQuickFind(page);
    await box.pressSequentially("zzqxw");
    await expect(dialog.locator(".qf-empty")).toHaveText("Sonuç yok");
  },
};

/** Öneriler › Size göre: 'Size göre nasıl sıralar?' açılırı açık (eğitici metin 360 px'e sığmalı). */
const personalNoteOpen: View["extra"] = {
  label: "‘Size göre nasıl sıralar?’ açık",
  run: async (page) => {
    await expect(page.locator("ul.pcard-list > li .reason-chip").first()).toBeVisible();
    await page.getByText("‘Size göre’ nasıl sıralar?").click();
    await expect(page.locator(".personal-note")).toContainText("itiraz imzalarınız kullanılmaz");
  },
};

/** Konular sayfasında telefon genişliğinde 'Süz' açılırı (Kategori ve Arşiv süzgeçleri) açık. */
const filtersOpen: View["extra"] = {
  label: "‘Süz’ açılırı açık",
  run: async (page) => {
    await page.getByRole("search").locator("summary", { hasText: /^Süz/ }).click();
    await expect(page.getByRole("search").locator("details[open]")).toHaveCount(1);
  },
};

/** Sözlük araması: eşleşen konuların hepsi açılır (terim gövdeleri 360 px'e sığmalı). */
const glossarySearch: View["extra"] = {
  label: "sözlük araması (konular açık)",
  run: async (page) => {
    await page.getByLabel("Sözlükte ara").fill("köprü");
    await expect(page.getByRole("region", { name: "Sözlük", exact: true }).getByRole("status")).toHaveText(/terim bulundu/);
  },
};

/** Tercih belge yüklenmeden yazılır: arayüz ilk çizimde 'tam' kipini eşzamanlı aynadan (localStorage) okur. */
async function enableFullView(s: Session): Promise<void> {
  await s.context.addInitScript(
    ([key, value]) => {
      try {
        window.localStorage.setItem(key, value);
      } catch {
        /* erişilemezse sade kalır; Ayarlar denetimi bunu yakalar */
      }
    },
    [DETAIL_KEY, DETAIL_FULL],
  );
}

const sessions: Session[] = [];
let data: {
  topics: TopicSummary[];
  proposals: ProposalSummary[];
  ayse: PublicUser;
  expert: PublicUser;
  height: number;
  tx: CommittedTxView;
  /** Silme talebi formunun ?mesaj= ile açılacağı görünür gövdeli bir mesaj */
  messageId: string;
  /** Ayşe'nin Listem'ine eklenenler: en uzun başlıklı öneri, ikinci bir öneri ve en uzun başlıklı konu (satır ve başlık taşması ölçülsün) */
  saved: { longProposal: ProposalSummary; otherProposal: ProposalSummary; longTopic: TopicSummary };
};

test.beforeAll(async () => {
  const { api } = ctx;
  const [topics, proposals, users, experts, status, txs] = await Promise.all([
    api.get<TopicSummary[]>("/api/topics"),
    api.proposals(),
    api.get<PublicUser[]>("/api/users?q=ayse"),
    api.get<PublicUser[]>("/api/users?q=bk_saglik1"),
    api.get<LedgerStatus>("/api/ledger/status"),
    api.get<CommittedTxView[]>("/api/ledger/txs?type=TALLY&limit=1"),
  ]);
  data = {
    topics,
    proposals,
    ayse: users.find((u) => u.nickname === "ayse")!,
    expert: experts.find((u) => u.nickname === "bk_saglik1")!,
    height: status.height,
    tx: txs[0],
    messageId: "",
    saved: { longProposal: proposals[0], otherProposal: proposals[1], longTopic: topics[0] },
  };
  expect(data.proposals.length).toBeGreaterThan(30);
  // Listem dolu olsun: Profil › Listem, Öneriler › Listem, basılı 'Listeme ekle' ve 'Listenizde' çipi gerçek uzun başlıklarla ölçülür.
  const longest = <T extends { title: string }>(list: T[]): T => [...list].sort((a, b) => b.title.length - a.title.length)[0];
  const longProposal = longest(data.proposals.filter((p) => p.status !== "draft"));
  const otherProposal = data.proposals.find((p) => p.status === "voting" && p.id !== longProposal.id)!;
  const longTopic = longest(topics);
  data.saved = { longProposal, otherProposal, longTopic };
  for (const [type, id] of [
    ["proposal", longProposal.id],
    ["proposal", otherProposal.id],
    ["topic", longTopic.id],
  ] as const) {
    await api.request("PUT", `/api/me/saved/${type}/${id}`, { as: "ayse" });
  }
  const thread = await api.get<ThreadResponse>(`/api/threads/topic/${data.topics[0].id}`);
  data.messageId = thread.messages.find((m) => m.visibility === "visible" && !!m.body)?.id ?? "";
  expect(data.messageId, "ilk konunun tartışmasında görünür bir mesaj olmalı").toBeTruthy();
});

/** 'Bu sayfada' tıklamaları için tartışmadaki, oylamadaki ve kabul edilmiş birer öneri. */
function featured(): Set<string> {
  const list = data.proposals;
  const ids = [list.find((p) => p.status === "deliberation"), list.find((p) => p.status === "voting" && p.kind === "topic"), list.find((p) => p.status === "enacted")].map((p) => p?.id);
  expect(ids.every(Boolean), "tartışmada, oylamada ve kabul edilmiş birer öneri olmalı").toBe(true);
  return new Set(ids as string[]);
}

test.afterAll(async () => {
  await Promise.all(sessions.splice(0).map((s) => s.close()));
});

/** Testin kendi görünümlerinde bulunan sorunları raporlar (taşma ya da sayfa/konsol hatası olmamalı). */
function expectNoProblems(fromIndex: number, scannedBefore: number): void {
  const mine = problems.slice(fromIndex);
  const summary = `${scanned - scannedBefore} görünüm tarandı (toplam ${scanned}), ${mine.length} sorun`;
  test.info().annotations.push({ type: "tarama", description: summary });
  console.log(`[tarama] ${test.info().title}: ${summary}`);
  expect(mine, mine.map((p) => `${p.view}: ${p.issue}`).join("\n")).toEqual([]);
}

async function phone(browser: Browser, as?: string): Promise<Session> {
  const s = await openSession(browser, ctx.api, { as, contextOptions: PHONE });
  sessions.push(s);
  return s;
}

test("ziyaretçi: tüm genel sayfalar ve her öneri (360 px)", async ({ browser }) => {
  test.setTimeout(420_000);
  const [p0, n0] = [problems.length, scanned];
  const s = await phone(browser);
  const t = data.topics;
  const withSub = t.find((x) => t.some((y) => y.parentId === x.id)) ?? t[0];
  const pick = featured();
  const enacted = data.proposals.find((p) => p.status === "enacted")!;
  const views: View[] = [
    { label: "Ana sayfa", path: "/", extra: moreSheet },
    { label: "Ana sayfa › Hızlı bul paneli (boş)", path: "/", extra: quickFindEmpty },
    { label: "Ana sayfa › Hızlı bul paneli (sonuçlarla)", path: "/", extra: quickFindResults },
    { label: "Ana sayfa › Hızlı bul paneli (Sonuç yok)", path: "/", extra: quickFindNone },
    { label: "Giriş", path: "/giris" },
    { label: "Kayıt", path: "/kayit" },
    { label: "Konular", path: "/konular" },
    { label: "Konular: Süz açılırı", path: "/konular", extra: filtersOpen },
    { label: "Konular: kategori süzgeci (adresten)", path: `/konular?kategori=${encodeURIComponent(t.find((x) => x.categories.length)?.categories[0] ?? "")}` },
    { label: "Konu ayrıntısı (gizlenmiş mesajlı)", path: `/konular/${t[0].id}` },
    { label: "Konu ayrıntısı (alt konulu)", path: `/konular/${withSub.id}` },
    { label: "Konu ayrıntısı (sürüm geçmişi açık)", path: `/konular/${withSub.id}?bolum=surumler` },
    { label: "Konu ayrıntısı (alt konular çapası)", path: `/konular/${withSub.id}?bolum=alt-konular` },
    { label: "Öneriler", path: "/oneriler", tabs: true },
    ...data.proposals.map((p): View => ({ label: `Öneri #K-${p.seq} (${p.status})`, path: `/oneriler/${p.id}`, ...(pick.has(p.id) ? { extra: onThisPageLinks } : {}) })),
    { label: "Kabul edilmiş öneri › Karar parametreleri: semboller ve formüller", path: `/oneriler/${enacted.id}?bolum=parametreler`, extra: symbolsOn },
    { label: "Kabul edilmiş öneri › Karar parametreleri: Term penceresi", path: `/oneriler/${enacted.id}?bolum=parametreler`, extra: openTerm("button.term") },
    { label: "Oyum kayıtlı mı?", path: "/oy-dogrula" },
    { label: "Bilirkişiler", path: "/bilirkisiler", tabs: true },
    { label: "Üye profili", path: `/uyeler/${data.ayse.id}` },
    { label: "Bilirkişi profili", path: `/uyeler/${data.expert.id}` },
    { label: "Ayarlar", path: "/ayarlar" },
    { label: "Ayarlar: Doğrulayıcı anahtarları açık", path: "/ayarlar?bolum=anahtarlar" },
    { label: "Keşfet ve doğrula", path: "/kesfet", extra: onThisPageLinks },
    { label: "Keşfet ve doğrula › Term penceresi", path: "/kesfet", extra: openTerm("ol.kesfet-steps button.term") },
    { label: "Keşfet ve doğrula › sözlük araması", path: "/kesfet?bolum=sozluk", extra: glossarySearch },
    { label: "Keşfet ve doğrula › sözlükte terim (derin bağlantı)", path: "/kesfet?bolum=terim-kopru-testi" },
    { label: "Graf", path: "/graf", tabs: true },
    { label: "Defter", path: "/defter", tabs: true },
    { label: "Blok", path: `/defter/blok/${data.height}` },
    { label: "İşlem (TALLY)", path: `/defter/islem/${data.tx.hash}` },
    { label: "Yönetmelik", path: "/yonetmelik", tabs: true },
    { label: "Bulunamadı", path: "/olmayan-bir-sayfa" },
  ];
  await scan(s, "ziyaretçi", views);
  expect(scanned - n0).toBeGreaterThan(50);
  expectNoProblems(p0, n0);
});

// 'Tam' görünüm tercihi (Ayarlar › Görünüm yoğunluğu): kapalı kartlar, "Ayrıntı" açılırları ve kırpılmış metinler varsayılan AÇIK gelir.
// Sade görünümde kapalı duran bu içerikler (Kura kayıtları, Aday havuzu, Oy taahhüdü işlemleri, Yönetmelik bölümleri…) yukarıdaki
// taramada hiç ölçülmez; bu test onları açık hâlleriyle ölçer. Anahtar ve değer lib/prefs.ts + lib/detailLevel.tsx ile aynıdır.
const DETAIL_KEY = "forum.detail";
const DETAIL_FULL = "tam";

test("ziyaretçi (Tam görünüm): her öneri ve açık ayrıntılı sayfalar (360 px)", async ({ browser }) => {
  test.setTimeout(420_000);
  const [p0, n0] = [problems.length, scanned];
  const s = await phone(browser);
  // Tercih belge yüklenmeden önce yazılır: arayüz ilk çizimde 'tam' kipini eşzamanlı aynadan (localStorage) okur.
  await s.context.addInitScript(
    ([key, value]) => {
      try {
        window.localStorage.setItem(key, value);
      } catch {
        /* erişilemezse sade kalır; aşağıdaki Ayarlar denetimi bunu yakalar */
      }
    },
    [DETAIL_KEY, DETAIL_FULL],
  );
  const t = data.topics;
  const withSub = t.find((x) => t.some((y) => y.parentId === x.id)) ?? t[0];
  const pick = featured();
  const views: View[] = [
    { label: "Ana sayfa", path: "/" },
    { label: "Konu ayrıntısı (gizlenmiş mesajlı)", path: `/konular/${t[0].id}` },
    { label: "Konu ayrıntısı (alt konulu)", path: `/konular/${withSub.id}` },
    ...data.proposals.map((p): View => ({ label: `Öneri #K-${p.seq} (${p.status})`, path: `/oneriler/${p.id}`, ...(pick.has(p.id) ? { extra: onThisPageLinks } : {}) })),
    { label: "Bilirkişiler", path: "/bilirkisiler", tabs: true },
    { label: "Graf", path: "/graf", tabs: true },
    { label: "Defter", path: "/defter", tabs: true },
    { label: "Yönetmelik", path: "/yonetmelik", tabs: true },
    // Faz 3: 'Tam' görünümde sözlüğün bütün konuları, Karar parametreleri sembolleri/formülleri ve Konular süzgeçleri açık gelir
    { label: "Keşfet ve doğrula", path: "/kesfet", extra: onThisPageLinks },
    { label: "Keşfet ve doğrula › Term penceresi", path: "/kesfet", extra: openTerm("ol.kesfet-steps button.term") },
    { label: "Konular", path: "/konular" },
    { label: "Ayarlar", path: "/ayarlar" },
  ];
  await scan(s, "ziyaretçi (Tam)", views);

  // Tarama gerçekten 'Tam' kipte yapıldı mı? Ayarlar'daki yoğunluk seçimi 'Tam' olmalı; aksi halde bu test sade kipi ölçer.
  await gotoApp(s.page, "/ayarlar");
  await expect(s.page.getByRole("radio", { name: "Tam — tüm ayrıntılar açık" })).toBeChecked();
  // Bir öneri sayfasında hiçbir katlanabilir kart kapalı kalmamalı (tam kipte hepsi açık gelir).
  await gotoApp(s.page, `/oneriler/${data.proposals[0].id}`);
  await expect(s.page.locator("button.card-toggle").first()).toBeVisible();
  await expect(s.page.locator("button.card-toggle[aria-expanded=false]")).toHaveCount(0);
  // Aynı sayfadaki "Ayrıntı" açılırları (Details) de açık gelir; en az biri var ve hiçbiri kapalı kalmaz.
  await expect(s.page.locator("main details").first()).toBeAttached();
  await expect(s.page.locator("main details:not([open])")).toHaveCount(0);
  // Faz 3: Keşfet sözlüğünün bütün konuları, Ayarlar › Gelişmiş kartları ve Karar parametreleri anahtarı 'Tam' kipte açık gelir
  await gotoApp(s.page, "/kesfet");
  await expect(s.page.locator("details.kesfet-gloss-group")).not.toHaveCount(0);
  await expect(s.page.locator("details.kesfet-gloss-group:not([open])")).toHaveCount(0);
  await gotoApp(s.page, "/ayarlar");
  await expect(s.page.locator("button.card-toggle[aria-expanded=false]")).toHaveCount(0);

  expect(scanned - n0).toBeGreaterThan(data.proposals.length + 10);
  expectNoProblems(p0, n0);
});

test("üye ve bekleyen üye: profil, bildirimler, yeni öneri formları, oy paneli (360 px)", async ({ browser }) => {
  test.setTimeout(300_000);
  const [p0, n0] = [problems.length, scanned];
  const voting = data.proposals.find((p) => p.status === "voting" && p.kind === "topic")!;
  const s = await phone(browser, "ayse");
  await scan(s, "üye (ayse)", [
    { label: "Ana sayfa (görevler)", path: "/", extra: moreSheet },
    { label: "Ana sayfa › Hızlı bul paneli (sonuçlarla; kendi taslağı da aranır)", path: "/", extra: quickFindResults },
    { label: "Profil", path: "/profil" },
    { label: "Profil: Listem (dolu)", path: "/profil?bolum=listem" },
    { label: "Profil: Kişisel verilerim (KVKK) açık", path: "/profil?bolum=kvkk" },
    { label: "Profil: Kimlik bilgilerimi düzelt açık", path: "/profil?bolum=duzeltme" },
    { label: "Bildirimler", path: "/bildirimler", tabs: true },
    { label: "Keşfet ve doğrula", path: "/kesfet", extra: onThisPageLinks },
    { label: "Öneriler: oylamadakiler (Sizden bekleniyor)", path: "/oneriler?sekme=oylama" },
    { label: "Öneriler (5 sekme: Açık · Sonuçlanan · Tümü · Benim · Listem)", path: "/oneriler", tabs: true },
    { label: "Öneriler: Listem sekmesi (dolu)", path: "/oneriler?sekme=listem" },
    { label: "Öneriler: Sırala › Size göre (gerekçe çipleri)", path: "/oneriler?sekme=tumu&sirala=sana-gore" },
    { label: "Öneriler: Size göre › ‘nasıl sıralar?’ açık", path: "/oneriler?sekme=tumu&sirala=sana-gore", extra: personalNoteOpen },
    { label: "Öneri sayfası (Listeme ekle: listede, en uzun başlık)", path: `/oneriler/${data.saved.longProposal.id}` },
    { label: "Öneri sayfası (Listeme ekle: listede değil)", path: `/oneriler/${data.proposals.find((p) => p.status === "enacted" && p.id !== data.saved.longProposal.id)!.id}` },
    { label: "Konu ayrıntısı (Listeme ekle: listede, en uzun başlık)", path: `/konular/${data.saved.longTopic.id}` },
    { label: "Yeni öneri", path: "/oneriler/yeni" },
    { label: "Yeni öneri: yeni konu", path: "/oneriler/yeni?tur=topic" },
    { label: "Yeni öneri: ön denetim paneli", path: "/oneriler/yeni", extra: fillPrecheck },
    { label: "Yeni öneri: alt konu", path: `/oneriler/yeni?tur=subtopic&konu=${data.topics[0].id}` },
    { label: "Yeni öneri: düzenleme teklifi", path: `/oneriler/yeni?tur=amendment&konu=${data.topics[0].id}` },
    { label: "Yeni öneri: silme talebi", path: "/oneriler/yeni?tur=deletion" },
    { label: "Yeni öneri: silme talebi (mesajdan)", path: `/oneriler/yeni?tur=deletion&mesaj=${data.messageId}` },
    { label: "Yeni öneri: yönetmelik değişikliği", path: "/oneriler/yeni?tur=regulation" },
    { label: `Oylamadaki öneri #K-${voting.seq} (oy paneli)`, path: `/oneriler/${voting.id}`, extra: onThisPageLinks },
    { label: "Oyum kayıtlı mı?", path: "/oy-dogrula" },
    { label: "Graf (kendi görüş haritası)", path: "/graf", tabs: true },
  ]);
  const pending = await phone(browser, "berk_n");
  await scan(pending, "bekleyen üye (berk_n)", [
    { label: "Ana sayfa (onay bekleniyor şeridi)", path: "/" },
    { label: "Yeni öneri (doğrulama gerekli)", path: "/oneriler/yeni" },
    { label: "Profil", path: "/profil" },
    { label: "Profil: Listem (boş)", path: "/profil?bolum=listem" },
    { label: "Öneriler (5 sekme)", path: "/oneriler", tabs: true },
    { label: "Öneriler: Listem sekmesi (boş)", path: "/oneriler?sekme=listem" },
  ]);
  expectNoProblems(p0, n0);
});

test("üye (Tam görünüm): profil, ayarlar, bildirimler, yeni öneri formları, ön denetim paneli ve Keşfet (360 px)", async ({ browser }) => {
  test.setTimeout(300_000);
  const [p0, n0] = [problems.length, scanned];
  const s = await phone(browser, "ayse");
  await enableFullView(s);
  await scan(s, "üye (ayse, Tam)", [
    { label: "Ana sayfa (görevler)", path: "/", extra: moreSheet },
    { label: "Profil", path: "/profil" },
    { label: "Profil: Listem (dolu, Tam)", path: "/profil?bolum=listem" },
    { label: "Ayarlar", path: "/ayarlar" },
    { label: "Bildirimler", path: "/bildirimler", tabs: true },
    { label: "Konular", path: "/konular" },
    { label: "Öneriler: oylamadakiler", path: "/oneriler?sekme=oylama" },
    { label: "Öneriler: Size göre (Tam)", path: "/oneriler?sekme=tumu&sirala=sana-gore" },
    { label: "Öneriler: Listem sekmesi (Tam)", path: "/oneriler?sekme=listem" },
    { label: "Yeni öneri: yeni konu (ön denetim paneli)", path: "/oneriler/yeni", extra: fillPrecheck },
    { label: "Yeni öneri: alt konu", path: `/oneriler/yeni?tur=subtopic&konu=${data.topics[0].id}` },
    { label: "Yeni öneri: düzenleme teklifi", path: `/oneriler/yeni?tur=amendment&konu=${data.topics[0].id}` },
    { label: "Yeni öneri: silme talebi (mesajdan)", path: `/oneriler/yeni?tur=deletion&mesaj=${data.messageId}` },
    { label: "Yeni öneri: yönetmelik değişikliği", path: "/oneriler/yeni?tur=regulation" },
    { label: "Keşfet ve doğrula", path: "/kesfet", extra: onThisPageLinks },
  ]);
  // Tarama gerçekten 'Tam' kipte yapıldı mı? Profil'de katlı kartların hiçbiri kapalı kalmaz.
  await gotoApp(s.page, "/profil");
  await expect(s.page.locator("button.card-toggle").first()).toBeVisible();
  await expect(s.page.locator("button.card-toggle[aria-expanded=false]")).toHaveCount(0);
  expectNoProblems(p0, n0);
});

test("görevliler: kayıt memuru, denetçi, yönetici, bilirkişi (360 px)", async ({ browser }) => {
  test.setTimeout(300_000);
  const [p0, n0] = [problems.length, scanned];
  const deliberation = data.proposals.find((p) => p.status === "deliberation")!;
  const registrar = await phone(browser, "kayitmemuru");
  await scan(registrar, "kayıt memuru", [
    {
      label: "Kayıt memuru",
      path: "/kayit-memuru",
      tabs: true,
      extra: {
        label: "amaçlı kişisel veri penceresi",
        run: async (page) => {
          const item = page.getByRole("list", { name: "Doğrulama bekleyen üyeler" }).locator("li.list-item").first();
          await item.getByRole("button", { name: "Kişisel veriyi görüntüle…" }).click();
          const dialog = page.getByRole("dialog", { name: /Kişisel veri: @/ });
          await dialog.getByRole("button", { name: "Kimlik doğrulaması: yüz yüze belge kontrolü" }).click();
          await dialog.getByRole("button", { name: "Amacı kaydet ve görüntüle" }).click();
          await expect(dialog.getByText("T.C. kimlik no (maskeli)")).toBeVisible();
        },
      },
    },
  ]);
  const auditor = await phone(browser, "denetci");
  await scan(auditor, "denetçi", [
    { label: "Denetim günlüğü", path: "/yonetim" },
    { label: "Kayıt memuru (salt okunur)", path: "/kayit-memuru" },
    { label: "Konu (gizli metni oku düğmesi)", path: `/konular/${data.topics[0].id}` },
  ]);
  const admin = await phone(browser, "yonetici");
  await scan(admin, "yönetici", [
    { label: "Keşfet ve doğrula (Kurcalama demosu bağlantısı)", path: "/kesfet?bolum=rehber" },
    { label: "Yönetim", path: "/yonetim", tabs: true },
    { label: "Defter (kurcalama demosu dahil)", path: "/defter", tabs: true },
    { label: "Bilirkişiler (yönetim)", path: "/bilirkisiler", tabs: true },
  ]);
  const expert = await phone(browser, "bk_saglik1");
  await scan(expert, "bilirkişi (bk_saglik1)", [
    { label: "Ana sayfa (görevler)", path: "/" },
    { label: "Profil", path: "/profil" },
    { label: `Tartışmadaki öneri #K-${deliberation.seq} (bilirkişi paneli)`, path: `/oneriler/${deliberation.id}` },
  ]);
  expectNoProblems(p0, n0);
});
