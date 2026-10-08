// Senaryo 9 — Keşif: önerili arama ('Hızlı bul'), 'Listeme ekle' / Listem ve kişisel sıralama ('Size göre').
//   Bulgu düzeltmeleri: Enter eski sorgunun sonuçlarıyla karar vermez; 'Tüm önerilerde ara (N öneri)' = Öneriler sayfasının süzgeci
//   (çok kelimeli); ana sayfa 'Şu an açık' ilk 5 = Açık › Size göre ilk 5; 720 px aşılınca metin ve odak korunur; son açılanlar adres
//   satırında değil X-Forum-Recent başlığında; 'Kişisel sıralama' tercihi; Listem sekmesi yüklenirken/hata verince yanlış boş durum yok;
//   sekmeler büyük yazıda kırpılmaz; hatırlanan 'Size göre' telefonda süzgeç açılırını açık getirmez.
//   a) Hızlı bul (masaüstü ≥ 720 px): üst çubuktaki kutuya büyük harfle ve Türkçe harfsiz yazılan başlık öneriyi bulur; ↓ + Enter
//      klavyeyle öneri sayfasına götürür; combobox ARIA bağları (aria-expanded/controls/activedescendant, listbox, grup); 2 karakterden
//      önce istek yok; Esc önce listeyi kapatır, sonra metni siler; numara (#K12, K-12, #T3) ve 'Sonuç yok'; son seçenek 'Tüm önerilerde ara'.
//   b) Görünürlük: başkasının taslağı numarayla bile aranamaz; yazarın kendi taslağı 'Taslak' rozetiyle çıkar.
//   c) Hızlı bul (telefon 375): büyüteç düğmesi → tam ekran panel; yazıp ↓ + Enter ile gitme; Esc, 'Geri' ve Android geri tuşu (cancel olayı)
//      paneli kapatır, odak büyüteçe döner; alt gezinme (4 bağlantı + 'Daha fazla') aynen kalır; taşma yok. Kırılma noktası 719/720 px.
//   d) Listeme ekle: öneri ve konu sayfasında aç/kapa (aria-pressed), sunucuda kalıcı, Profil › Listem'de görünür, Öneriler › Listem
//      sekmesi, 'Çıkar'; ziyaretçide düğme yok, başkasının listesi görünmez, KVKK dökümüne girer.
//   e) Kişisel sıralama: soğuk başlangıçta varsayılan sıra ve gerekçe yok; listeye ekleyince 'Listenizde' gerekçesi; 'Size göre' seçilince
//      küme AYNI kalır (hiçbir öneri düşmez), gerekçe çipleri görünür, seçim cihazda hatırlanır, varsayılan "En yeni" değişmez; son
//      açılanlar yalnız cihazda tutulur, yalnız sıralama isteklerinde geçici parametre olarak gider ve çıkışta silinir.
//   f) Ana sayfa 'Şu an açık': profil varsa kişisel sırada ve gerekçe çipiyle; 'Sizi bekleyenler' kişiselleştirmeden etkilenmez ve üstte kalır.
//   g) Kontrast ve taşma: yeni görünümler açık ve iki koyu temada WCAG AA, 360 px'de yatay taşma yok.
// Oy gizliliğinin (oy içeriği, oy verip vermediği, itiraz imzası ve azınlık raporu sıralamaya HİÇ girmemesi) birebir doğrulaması
// sunucu birim testlerindedir (server/test/forum/discovery.test.ts, shared-recommend.test.ts); burada kullanıcıya görünen yüz sınanır.
import { expect, test, type Browser, type BrowserContextOptions, type Locator, type Page } from "@playwright/test";
import type { AuthResponse, Dashboard, DashboardTask, PersonalizedProposalList, ProposalSummary, SavedList, SearchResponse, TopicSummary } from "@forum/shared";
import { HttpError, type Api } from "../support/api";
import { newMember } from "../support/data";
import { passwordOf } from "../support/env";
import { useSeededServer } from "../support/fixtures";
import { reservedParts, scanContrast } from "../support/sade";
import { expectToast, gotoApp, measureOverflow, openSession, waitSettled, type Session } from "../support/ui";

const ctx = useSeededServer("arama-kisisel");

const DESKTOP: BrowserContextOptions = { viewport: { width: 1280, height: 860 } };
const PHONE: BrowserContextOptions = { viewport: { width: 375, height: 812 }, deviceScaleFactor: 2, hasTouch: true };
const PHONE_360: BrowserContextOptions = { viewport: { width: 360, height: 780 }, deviceScaleFactor: 2, hasTouch: true };

const sessions: Session[] = [];
test.afterEach(async () => {
  await Promise.all(sessions.splice(0).map((s) => s.close()));
});

async function open(browser: Browser, as?: string, contextOptions?: BrowserContextOptions): Promise<Session> {
  const s = await openSession(browser, ctx.api, { as, contextOptions });
  sessions.push(s);
  return s;
}

function expectClean(...list: Session[]): void {
  for (const s of list) expect(s.errors, "sayfa/konsol hatası olmamalı").toEqual([]);
}

async function expectNoOverflow(page: Page, label: string): Promise<void> {
  const o = await measureOverflow(page);
  expect(o.overflow, `${label}: yatay taşma ${o.overflow} px (scrollWidth ${o.scrollWidth}, innerWidth ${o.innerWidth}) ${o.offenders.join("; ")}`).toBe(0);
}

// ───────────────────────────── Yardımcılar ─────────────────────────────

/** Türkçe duyarsız katlama: küçük harf (tr-TR) + Türkçe harflerin ASCII karşılığı ("Ulaşımın" → "ulasimin"). */
function fold(s: string): string {
  const map: Record<string, string> = { ç: "c", ğ: "g", ı: "i", ö: "o", ş: "s", ü: "u", â: "a", î: "i", û: "u" };
  return s.toLocaleLowerCase("tr-TR").replace(/[çğıöşüâîû]/g, (c) => map[c] ?? c);
}

const TR_SPECIFIC = /[çğıöşüÇĞİÖŞÜ]/g;
const firstWords = (title: string, n: number): string => title.split(/\s+/).slice(0, n).join(" ");

/**
 * Hızlı bul sınaması için hedef öneri: başlığının ilk `n` sözcüğünde Türkçe'ye özgü harf var ve aynı ilk sözcüklerle başlayan başlık
 * sayısı (öneri + konu) en çok 6; yani yazılan metin sonuç listesinin 8'lik sınırına sığar. Türkçe harfi en çok olan önce gelir.
 */
function pickTitleTarget(n: number, accept: (p: ProposalSummary) => boolean = () => true): ProposalSummary {
  const titles = [...data.proposals.map((p) => p.title), ...data.topics.map((t) => t.title)];
  const sharing = (p: ProposalSummary) => titles.filter((t) => fold(t).startsWith(fold(firstWords(p.title, n)))).length;
  const letters = (p: ProposalSummary) => firstWords(p.title, n).match(TR_SPECIFIC)?.length ?? 0;
  const pick = data.proposals.filter((p) => accept(p) && letters(p) > 0 && sharing(p) <= 6).sort((a, b) => letters(b) - letters(a) || a.seq - b.seq)[0];
  expect(pick, "tohumda başlığın ilk sözcüklerinde Türkçe harf olan, az başlıkla paylaşılan bir öneri olmalı").toBeTruthy();
  return pick;
}

/** Hızlı bul kutusu (combobox). Ad: 'Hızlı bul' (e2e'nin aradığı 'Ara', 'Konu ara', 'Başlık' … adlarıyla alt dize çakışması yok). */
const findBox = (scope: Page | Locator): Locator => scope.getByRole("combobox", { name: "Hızlı bul", exact: true });
const findList = (scope: Page | Locator): Locator => scope.getByRole("listbox", { name: "Hızlı bul sonuçları", exact: true });
const findOptions = (scope: Page | Locator): Locator => findList(scope).getByRole("option");
/** Yalnız sonuç satırları (numara taşıyan seçenekler); sunucu yanıtı gelmeden yalnız 'Tüm önerilerde ara' seçeneği vardır. */
const findHits = (scope: Page | Locator): Locator => findList(scope).locator("[role=option]:has(.qf-ref)");

/** Etkin seçeneğin (aria-activedescendant) metni; yoksa null. */
async function activeOptionText(page: Page, box: Locator): Promise<string | null> {
  const id = await box.getAttribute("aria-activedescendant");
  if (!id) return null;
  return page.locator(`[id="${id}"]`).innerText();
}

/** ↓ ile, metni verilen numarayı (ör. "#K-12") taşıyan seçenek etkin olana kadar iner. */
async function arrowDownTo(page: Page, box: Locator, ref: string): Promise<void> {
  const re = new RegExp(`${ref.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?!\\d)`);
  const seen: string[] = [];
  for (let i = 0; i < 12; i++) {
    await box.press("ArrowDown");
    const t = await activeOptionText(page, box);
    if (t && re.test(t)) return;
    seen.push((t ?? "—").replace(/\s+/g, " ").slice(0, 40));
  }
  throw new Error(`↓ ile ${ref} seçeneğine ulaşılamadı; görülen seçenekler: ${seen.join(" | ")}`);
}

/** Sayfadaki kart listesinin öneri kimlikleri (görünür sırayla). */
async function listedIds(page: Page): Promise<string[]> {
  return page.locator("ul.pcard-list > li").evaluateAll((lis) =>
    lis.map((li) => /#\/oneriler\/([0-9a-f-]{36})/.exec(li.querySelector<HTMLAnchorElement>("a[href*='/oneriler/']")?.getAttribute("href") ?? "")?.[1] ?? ""),
  );
}

/** Sayfa isteklerini (adres olarak) toplar: sonradan bakılır. */
function trackRequests(page: Page): string[] {
  const urls: string[] = [];
  page.on("request", (r) => urls.push(r.url()));
  return urls;
}

/** API isteklerini adresi ve 'son açılanlar' başlığıyla (X-Forum-Recent; yoksa null) toplar. */
function trackRecent(page: Page): { url: string; recent: string | null }[] {
  const out: { url: string; recent: string | null }[] = [];
  page.on("request", (r) => {
    if (r.url().includes("/api/")) out.push({ url: r.url(), recent: r.headers()["x-forum-recent"] ?? null });
  });
  return out;
}

const decoded = (url: string): string => {
  try {
    return decodeURIComponent(url);
  } catch {
    return url;
  }
};

async function viewerId(api: Api, nickname: string): Promise<string> {
  return (await api.get<{ id: string }>("/api/me", nickname)).id;
}

/** Yeni, doğrulama bekleyen bir üye kaydeder (hiçbir etkileşimi yok: ilgi profili boş). Oturum belirteci api'ye tanıtılır. */
async function registerFresh(api: Api, prefix: string): Promise<{ nickname: string; id: string }> {
  const m = newMember(prefix);
  const res = await api.request<AuthResponse>("POST", "/api/auth/register", {
    body: {
      nickname: m.nickname,
      password: m.password,
      firstName: m.firstName,
      lastName: m.lastName,
      tckn: m.tckn,
      birthDate: m.birthDate,
      email: m.email,
      phone: m.phone,
      address: { il: m.il, ilce: m.ilce, mahalle: m.mahalle, acikAdres: m.acikAdres },
      kvkkNoticeAccepted: true,
      politicalConsent: true,
      aiConsent: false,
    },
  });
  api.setToken(m.nickname, res.token);
  return { nickname: m.nickname, id: res.user.id };
}

const putSaved = (api: Api, as: string, type: "proposal" | "topic", id: string) => api.request<{ saved: boolean; savedAt: number | null }>("PUT", `/api/me/saved/${type}/${id}`, { as });

interface Data {
  /** Ziyaretçiye açık öneriler */
  proposals: ProposalSummary[];
  topics: TopicSummary[];
  /** Ayşe'nin gördüğü öneriler (kendi taslağı dahil) */
  ayse: ProposalSummary[];
  draft: ProposalSummary;
  fresh: { nickname: string; id: string };
}
let data: Data;

test.beforeAll(async () => {
  const { api } = ctx;
  const [proposals, topics, ayse] = await Promise.all([api.proposals(), api.get<TopicSummary[]>("/api/topics"), api.get<ProposalSummary[]>("/api/proposals?limit=200", "ayse")]);
  const draft = ayse.find((p) => p.status === "draft" && p.authorNickname === "ayse");
  expect(draft, "tohumda Ayşe'nin bir taslağı olmalı").toBeTruthy();
  expect(proposals.length).toBeGreaterThan(30);
  expect(proposals.some((p) => p.id === draft!.id), "taslak herkese açık listede olmamalı").toBe(false);
  data = { proposals, topics, ayse, draft: draft!, fresh: await registerFresh(api, "liste") };
});

// ───────────────────────────── a) Hızlı bul (masaüstü) ─────────────────────────────

test("Hızlı bul (masaüstü): büyük harfli ve Türkçe harfsiz yazı başlığı bulur; ↓ + Enter öneri sayfasına götürür; combobox ARIA bağları", async ({ browser }) => {
  const s = await open(browser, undefined, DESKTOP);
  const { page } = s;
  // Başlığın ilk üç sözcüğünde en çok Türkçe'ye özgü harf olan öneri: yazı "KENT ICI ULASIMIN" gibi (İ→I, ı→I, ş→S).
  const target = pickTitleTarget(3);
  const typed = fold(firstWords(target.title, 3)).toUpperCase();
  expect(typed).not.toBe(firstWords(target.title, 3));

  await gotoApp(page, "/");
  const header = page.locator(".app-header");
  const box = findBox(header);
  await expect(box, "geniş ekranda üst çubukta metin kutusu").toBeVisible();
  await expect(header.getByRole("button", { name: "Hızlı bul", exact: true }), "büyüteç düğmesi yalnız dar ekranda").toHaveCount(0);
  await expect(box).toHaveAttribute("aria-expanded", "false");
  await expect(box).toHaveAttribute("aria-autocomplete", "list");
  const requests = trackRequests(page);

  // 2 karakterden önce istek gitmez ve liste açılmaz
  await box.click();
  await box.pressSequentially(typed.slice(0, 1));
  await page.waitForTimeout(450); // 150 ms gecikmenin çok üstü: istek gitseydi giderdi
  expect(requests.filter((u) => u.includes("/api/search")), "1 karakterde arama isteği olmamalı").toEqual([]);
  await expect(box).toHaveAttribute("aria-expanded", "false");

  await box.pressSequentially(typed.slice(1), { delay: 15 });
  const options = findOptions(page);
  await expect(findHits(page).first()).toBeVisible();
  await expect(box).toHaveAttribute("aria-expanded", "true");
  const listId = await box.getAttribute("aria-controls");
  expect(listId).toBeTruthy();
  expect(await findList(page).getAttribute("id"), "aria-controls listbox'ı göstermeli").toBe(listId);

  // En çok 8 sonuç + son seçenek 'Tüm önerilerde ara'; sonuçlar Konular / Öneriler diye gruplanır
  const count = await options.count();
  expect(count).toBeGreaterThanOrEqual(2);
  expect(count).toBeLessThanOrEqual(9);
  await expect(options.last()).toContainText("Tüm önerilerde ara");
  await expect(findList(page).getByRole("group", { name: "Öneriler", exact: true })).toBeVisible();
  const targetOption = options.filter({ hasText: new RegExp(`#K-${target.seq}(?!\\d)`) });
  await expect(targetOption, "yazılan başlığın önerisi listede").toHaveCount(1);
  await expect(targetOption.locator("mark").first(), "eşleşen kelime işaretlenir").toBeVisible();

  // Klavye: ↓ ile hedefe in; aria-activedescendant etkin seçeneği gösterir, yalnız o seçili
  await arrowDownTo(page, box, `#K-${target.seq}`);
  const activeId = await box.getAttribute("aria-activedescendant");
  await expect(page.locator(`[id="${activeId}"]`)).toHaveAttribute("aria-selected", "true");
  await expect(findList(page).locator("[aria-selected=true]")).toHaveCount(1);
  expect(await activeOptionText(page, box)).toContain(target.title);

  // Açık liste de sayfaya sığar (masaüstü)
  await expectNoOverflow(page, "Hızlı bul listesi açık (1280)");
  const pop = (await page.locator(".qf-popup").boundingBox())!;
  expect(pop.x).toBeGreaterThanOrEqual(0);
  expect(pop.x + pop.width, "liste pencere genişliğinin içinde").toBeLessThanOrEqual(1280);

  await box.press("Enter");
  await expect(page).toHaveURL(new RegExp(`#/oneriler/${target.id}$`));
  await waitSettled(page); // gezinmeyi bitir: sonraki tam sayfa yüklemesi süren istekleri yarıda kesmesin
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(target.title);
  await expect(box, "gidince kutu boşalır").toHaveValue("");
  await expect(box).toHaveAttribute("aria-expanded", "false");
  expect(requests.filter((u) => u.includes("/api/search")).every((u) => /[?&]limit=8(&|$)/.test(u)), "arama en çok 8 sonuç ister").toBe(true);
  expectClean(s);
});

test("Hızlı bul (masaüstü): numara aramaları (#K12, K-12, #T3), Esc, 'Sonuç yok' ve 'Tüm önerilerde ara'", async ({ browser }) => {
  const s = await open(browser, undefined, DESKTOP);
  const { page } = s;
  const p12 = data.proposals.find((p) => p.seq === 12)!;
  const t3 = data.topics.find((t) => t.seq === 3)!;
  await gotoApp(page, "/");
  const box = findBox(page.locator(".app-header"));
  const status = page.locator(".qf [role=status]");

  // Numara: tek karakter bile yeter; "#K12" ve "K-12" aynı öneriyi bulur; seçenek seçilmeden Enter doğrudan numaraya gider
  for (const typed of ["#K12", "k-12"]) {
    await gotoApp(page, "/");
    await box.click();
    await box.pressSequentially(typed);
    await expect(findOptions(page).first()).toContainText(`#K-12`);
    await expect(findOptions(page).first()).toContainText(p12.title);
    await expect(box, "henüz seçenek seçilmedi").not.toHaveAttribute("aria-activedescendant", /.+/);
    await box.press("Enter");
    await expect(page, `${typed} + Enter`).toHaveURL(new RegExp(`#/oneriler/${p12.id}$`));
    await waitSettled(page);
  }

  // Eski sonuçlarla Enter yok: '#K1' sonuçları ekrandayken '2' yazılıp HEMEN Enter → #K-1'e değil, #K-12'ye (yanıt beklenir)
  const p1 = data.proposals.find((p) => p.seq === 1)!;
  expect(p1, "tohumda #K-1 olmalı").toBeTruthy();
  await gotoApp(page, "/");
  await box.click();
  await box.pressSequentially("#K1");
  await expect(findOptions(page).first()).toContainText(/#K-1(?!\d)/);
  await box.press("2");
  await box.press("Enter");
  await expect(page, "#K1 → 2 → Enter: yazılan numaranın önerisi").toHaveURL(new RegExp(`#/oneriler/${p12.id}$`));
  await waitSettled(page);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(p12.title);

  // Konu numarası: 'Konular' grubu; fareyle tıklama da gider
  await gotoApp(page, "/");
  await box.click();
  await box.pressSequentially("#T3");
  const topicOption = findOptions(page).filter({ hasText: /#T-3(?!\d)/ });
  await expect(topicOption).toHaveCount(1);
  await expect(findList(page).getByRole("group", { name: "Konular", exact: true })).toBeVisible();
  await expect(topicOption).toContainText(t3.title);
  await topicOption.click();
  await expect(page).toHaveURL(new RegExp(`#/konular/${t3.id}$`));
  await waitSettled(page);
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(t3.title);

  // Esc: önce listeyi kapatır (metin kalır), ikincide metni siler
  await gotoApp(page, "/");
  await box.click();
  await box.pressSequentially("mahalle");
  await expect(findHits(page).first()).toBeVisible();
  await box.press("Escape");
  await expect(box).toHaveAttribute("aria-expanded", "false");
  await expect(box).toHaveValue("mahalle");
  await box.press("Escape");
  await expect(box).toHaveValue("");

  // 'Sonuç yok': liste açık kalır, yalnız 'Tüm önerilerde ara' seçeneği vardır; durum ekran okuyucuya söylenir
  await box.pressSequentially("zzqxw");
  await expect(page.locator(".qf-empty")).toHaveText("Sonuç yok");
  await expect(status).toHaveText("Sonuç yok");
  await expect(findOptions(page)).toHaveCount(1);
  await expect(findOptions(page)).toContainText("Tüm önerilerde ara");
  await box.press("Enter");
  await expect(page).toHaveURL(/#\/oneriler\?sekme=tumu&ara=zzqxw$/);
  await waitSettled(page);
  await expect(page.getByLabel("Ara", { exact: true })).toHaveValue("zzqxw");
  await expect(page.locator(".empty-title")).toHaveText("Süzgece uyan öneri yok");

  // 'Tüm önerilerde ara': ↑ son seçeneğe (döngü) iner; Enter Öneriler'i Tümü sekmesinde, arama kutusu dolu açar
  await gotoApp(page, "/konular");
  await box.click();
  await box.pressSequentially("mahalle");
  await expect(findHits(page).first()).toBeVisible();
  await box.press("ArrowUp");
  expect(await activeOptionText(page, box)).toContain("Tüm önerilerde ara");
  await box.press("Enter");
  await expect(page).toHaveURL(/#\/oneriler\?sekme=tumu&ara=mahalle$/);
  await waitSettled(page);
  await expect(page.getByLabel("Ara", { exact: true })).toHaveValue("mahalle");
  await expect(page.getByRole("tab", { name: /^Tümü/ })).toHaveAttribute("aria-selected", "true");
  const ids = await listedIds(page);
  expect(ids.length, "mahalle geçen öneriler listelenir").toBeGreaterThan(0);

  // Öneriler sayfasındayken yeniden 'Tüm önerilerde ara': sayfanın kendi kutusu da yeni terimi gösterir
  await box.click();
  await box.pressSequentially("park");
  await expect(findHits(page).first()).toBeVisible();
  await box.press("ArrowUp");
  await box.press("Enter");
  await expect(page).toHaveURL(/#\/oneriler\?sekme=tumu&ara=park$/);
  await waitSettled(page);
  await expect(page.getByLabel("Ara", { exact: true })).toHaveValue("park");
  expectClean(s);
});

test("Hızlı bul: çok kelimeli arama (sırasız) — 'Tüm önerilerde ara' seçeneğindeki sayı ile açılan Öneriler listesi aynı kuralla eşleşir", async ({ browser }) => {
  // Başlığının 1. ve 3. sözcüğü ters sırada ve Türkçe harfsiz yazılır: sunucu matchTitle ile bulur; Öneriler sayfası da aynı kuralla süzmeli
  const target = data.proposals.find((p) => p.title.split(/\s+/).filter((w) => w.length >= 4).length >= 3)!;
  const words = target.title.split(/\s+/).filter((w) => w.length >= 4);
  const typed = fold(`${words[2]}  ${words[0]}`).toUpperCase(); // çift boşluk da sadeleşir
  const expected = await ctx.api.get<SearchResponse>(`/api/search?q=${encodeURIComponent(typed)}`);
  expect(expected.items.map((h) => h.id), "sunucu ters sıradaki kelimelerle bulur").toContain(target.id);

  const s = await open(browser, undefined, DESKTOP);
  const { page } = s;
  await gotoApp(page, "/konular");
  const box = findBox(page.locator(".app-header"));
  await box.click();
  await box.pressSequentially(typed);
  await expect(findHits(page).first()).toBeVisible();
  const all = findOptions(page).last();
  await expect(all).toContainText("Tüm önerilerde ara");
  const label = await all.innerText();
  const shownProposals = expected.items.filter((h) => h.type === "proposal").length;
  const n = Number(/\((\d+) öneri\)/.exec(label)?.[1] ?? shownProposals);
  expect(n, `seçenek etiketi: ${label}`).toBe(expected.total.proposals);
  await box.press("ArrowUp");
  await box.press("Enter");
  await expect(page).toHaveURL(/#\/oneriler\?sekme=tumu&ara=/);
  await waitSettled(page);
  await expect(page.getByLabel("Ara", { exact: true })).toHaveValue(typed);
  await expect.poll(async () => (await listedIds(page)).length, "açılan liste seçenekteki sayıyla aynı").toBe(n);
  expect(await listedIds(page)).toContain(target.id);
  await expect(page.locator(".empty-title")).toHaveCount(0);
  expectClean(s);
});

// ───────────────────────────── b) Görünürlük ─────────────────────────────

test("Hızlı bul görünürlüğü: başkasının taslağı numarayla bile çıkmaz; yazarın kendi taslağı 'Taslak' rozetiyle çıkar", async ({ browser }) => {
  const { api } = ctx;
  const { draft } = data;
  const word = fold(firstWords(draft.title, 2));
  const find = (q: string, as?: string) => api.get<SearchResponse>(`/api/search?q=${encodeURIComponent(q)}`, as);
  for (const q of [word, `#K${draft.seq}`, `K-${draft.seq}`]) {
    expect((await find(q)).items.map((h) => h.id), `ziyaretçi: ${q}`).not.toContain(draft.id);
    expect((await find(q, "mehmet")).items.map((h) => h.id), `başka üye: ${q}`).not.toContain(draft.id);
    expect((await find(q, "ayse")).items.map((h) => h.id), `yazar: ${q}`).toContain(draft.id);
  }
  // Aynı arama ziyaretçide 0 toplam gösterir (sayı da sızmaz)
  expect((await find(`#K${draft.seq}`)).total).toEqual({ proposals: 0, topics: 0 });

  const s = await open(browser, "ayse", DESKTOP);
  const { page } = s;
  await gotoApp(page, "/");
  const box = findBox(page.locator(".app-header"));
  await box.click();
  await box.pressSequentially(word.toUpperCase());
  const option = findOptions(page).filter({ hasText: new RegExp(`#K-${draft.seq}(?!\\d)`) });
  await expect(option).toHaveCount(1);
  await expect(option.locator(".badge")).toHaveText("Taslak");
  await expect(option, "taslak yalnız yazarına: durum rozeti tek").toContainText(draft.title);
  expectClean(s);
});

// ───────────────────────────── c) Hızlı bul (telefon) ─────────────────────────────

test("Hızlı bul (telefon 375): büyüteç düğmesi → tam ekran panel; ↓ + Enter ile gitme; Esc, 'Geri' ve geri tuşu kapatır; alt gezinme değişmez", async ({ browser }) => {
  const s = await open(browser, undefined, PHONE);
  const { page } = s;
  const p12 = data.proposals.find((p) => p.seq === 12)!;
  const target = pickTitleTarget(2, (p) => p.status === "enacted");
  await gotoApp(page, "/");
  const header = page.locator(".app-header");
  const magnifier = header.getByRole("button", { name: "Hızlı bul", exact: true });
  await expect(magnifier, "telefonda üst çubukta büyüteç düğmesi").toBeVisible();
  await expect(magnifier).toHaveAttribute("aria-haspopup", "dialog");
  await expect(magnifier).toHaveAttribute("aria-expanded", "false");
  await expect(findBox(header), "telefonda üst çubukta metin kutusu yok").toHaveCount(0);

  // Alt gezinme AYNEN: 4 bağlantı + 'Daha fazla' düğmesi (büyüteç alt gezinmeye eklenmez)
  const bottom = page.getByRole("navigation", { name: "Alt gezinme" });
  await expect(bottom.getByRole("link")).toHaveCount(4);
  await expect(page.getByRole("button", { name: /Daha fazla/ })).toHaveCount(1);
  await expect(bottom.getByRole("button", { name: "Hızlı bul" })).toHaveCount(0);

  // Aç: panel yerel dialog, odak metin kutusunda, ipucu görünür
  await magnifier.click();
  const dialog = page.getByRole("dialog", { name: "Hızlı bul", exact: true });
  await expect(dialog).toBeVisible();
  const box = findBox(dialog);
  await expect(box).toBeFocused();
  await expect(dialog).toContainText("en az 2 harf");
  await expect(dialog.getByRole("button", { name: "Geri", exact: true })).toBeVisible();
  await expect(magnifier).toHaveAttribute("aria-expanded", "true");
  await expectNoOverflow(page, "Hızlı bul paneli (375, boş)");

  // Yaz: sonuçlar panelin gövdesinde (açılır liste değil); ↓ + Enter ile gidilir ve panel kapanır
  const typed = fold(firstWords(target.title, 2)).toUpperCase();
  await box.pressSequentially(typed, { delay: 15 });
  await expect(findHits(dialog).first()).toBeVisible();
  await expect(box).toHaveAttribute("aria-expanded", "true");
  await expect(findOptions(dialog).last()).toContainText("Tüm önerilerde ara");
  expect(await findOptions(dialog).count()).toBeLessThanOrEqual(9);
  await expectNoOverflow(page, "Hızlı bul paneli (375, sonuçlarla)");
  await arrowDownTo(page, box, `#K-${target.seq}`);
  await box.press("Enter");
  await expect(page).toHaveURL(new RegExp(`#/oneriler/${target.id}$`));
  await waitSettled(page);
  await expect(dialog, "gidince panel kapanır").toBeHidden();
  await expect(page.getByRole("heading", { level: 1 })).toHaveText(target.title);

  // Numara (#K12) + Enter doğrudan öneriye gider
  await gotoApp(page, "/konular");
  await magnifier.click();
  await findBox(dialog).pressSequentially("#K12");
  await expect(findOptions(dialog).first()).toContainText("#K-12");
  await findBox(dialog).press("Enter");
  await expect(page).toHaveURL(new RegExp(`#/oneriler/${p12.id}$`));
  await waitSettled(page);
  await expect(dialog).toBeHidden();

  // 'Sonuç yok'
  await magnifier.click();
  await findBox(dialog).pressSequentially("zzqxw");
  await expect(dialog.locator(".qf-empty")).toHaveText("Sonuç yok");
  await expectNoOverflow(page, "Hızlı bul paneli (375, sonuç yok)");

  // Esc kapatır ve odak büyüteçe döner
  await findBox(dialog).press("Escape");
  await expect(dialog).toBeHidden();
  await expect(magnifier).toBeFocused();
  await expect(magnifier).toHaveAttribute("aria-expanded", "false");

  // 'Geri' düğmesi kapatır; yeniden açılınca metin boş başlar
  await magnifier.click();
  await expect(findBox(dialog)).toHaveValue("");
  await dialog.getByRole("button", { name: "Geri", exact: true }).click();
  await expect(dialog).toBeHidden();
  await expect(magnifier).toBeFocused();

  // Android geri tuşu: lib/native.ts açık dialog'a 'cancel' olayı gönderir (donanım tuşu burada taklit edilir)
  await magnifier.click();
  await expect(dialog).toBeVisible();
  await page.evaluate(() => {
    const open = document.querySelectorAll<HTMLDialogElement>("dialog[open]");
    open[open.length - 1]?.dispatchEvent(new Event("cancel", { cancelable: true }));
  });
  await expect(dialog).toBeHidden();
  await expect(page.locator("body")).not.toHaveClass(/modal-open/);
  expectClean(s);
});

test("Hızlı bul: kırılma noktası 720 px (altı büyüteç, üstü kutu); 720 ve 800 px'de açık liste yatay taşma yapmaz", async ({ browser }) => {
  const s = await open(browser, undefined, { viewport: { width: 719, height: 800 } });
  const { page } = s;
  await gotoApp(page, "/");
  const header = page.locator(".app-header");
  await expect(header.getByRole("button", { name: "Hızlı bul", exact: true }), "719 px: büyüteç").toBeVisible();
  await expect(findBox(header)).toHaveCount(0);
  for (const width of [720, 800]) {
    await page.setViewportSize({ width, height: 800 });
    await expect(findBox(header), `${width} px: kutu`).toBeVisible();
    await expect(header.getByRole("button", { name: "Hızlı bul", exact: true })).toHaveCount(0);
    const box = findBox(header);
    await box.click();
    await box.fill("");
    await box.pressSequentially("mahalle");
    await expect(findHits(page).first()).toBeVisible();
    await expectNoOverflow(page, `Hızlı bul listesi açık (${width})`);
    const pop = (await page.locator(".qf-popup").boundingBox())!;
    expect(pop.x, `${width} px: liste sol kenarı görünür`).toBeGreaterThanOrEqual(0);
    expect(pop.x + pop.width, `${width} px: liste sağ kenarı görünür`).toBeLessThanOrEqual(width);
    await box.press("Escape");
    await box.press("Escape");
  }
  // Geri daralınca kutu gider, büyüteç döner
  await page.setViewportSize({ width: 600, height: 800 });
  const magnifier = header.getByRole("button", { name: "Hızlı bul", exact: true });
  await expect(magnifier).toBeVisible();

  // Panel açıkken genişleyen ekran (telefon yataya çevrildi): metin üst çubuk kutusuna geçer, odak ona taşınır, panel kalkar
  await magnifier.click();
  const dialog = page.getByRole("dialog", { name: "Hızlı bul", exact: true });
  await findBox(dialog).pressSequentially("mahalle");
  await expect(findHits(dialog).first()).toBeVisible();
  await page.setViewportSize({ width: 800, height: 800 });
  const inline = findBox(header);
  await expect(inline).toBeVisible();
  await expect(inline, "yazılan metin korunur").toHaveValue("mahalle");
  await expect(inline, "odak yeni kutuda (belgeye düşmez)").toBeFocused();
  await expect(dialog).toHaveCount(0);
  await expect(page.locator("body")).not.toHaveClass(/modal-open/);

  // Kutuda yazarken daralan ekran (dikeye çevrildi): panel metinle açılır, odak panelin kutusunda
  await inline.pressSequentially(" park");
  await page.setViewportSize({ width: 600, height: 800 });
  await expect(dialog).toBeVisible();
  await expect(findBox(dialog)).toHaveValue("mahalle park");
  await expect(findBox(dialog)).toBeFocused();
  // Kullanıcı kapatınca metin silinir, odak büyüteçe
  await findBox(dialog).press("Escape");
  await expect(dialog).toBeHidden();
  await expect(magnifier).toBeFocused();
  await magnifier.click();
  await expect(findBox(dialog)).toHaveValue("");
  await findBox(dialog).press("Escape");
  expectClean(s);
});

// ───────────────────────────── e) Kişisel sıralama: soğuk başlangıç ─────────────────────────────

test("Size göre (etkinliği olmayan yeni üye): varsayılan sıra, gerekçe yok, 'Henüz yeterli etkinlik yok' notu; küme aynı", async ({ browser }) => {
  const { api } = ctx;
  const { fresh } = data;
  const def = await api.get<ProposalSummary[]>("/api/proposals?limit=200", fresh.nickname);
  const cold = await api.get<PersonalizedProposalList>("/api/proposals?limit=200&sort=sana-gore", fresh.nickname);
  expect(cold.personalized, "ilgi profili boş").toBe(false);
  expect(cold.items.map((p) => p.id), "soğuk başlangıçta sıra varsayılanla birebir aynı").toEqual(def.map((p) => p.id));
  expect(cold.items.every((p) => p.reason === null && p.score === null)).toBe(true);
  // Ziyaretçi de aynı yanıtı alır (kişisel sıra yok)
  const visitor = await api.get<PersonalizedProposalList>("/api/proposals?limit=200&sort=sana-gore");
  expect(visitor.personalized).toBe(false);
  expect(visitor.items.map((p) => p.id)).toEqual(data.proposals.map((p) => p.id));

  const s = await open(browser, fresh.nickname, DESKTOP);
  const { page } = s;
  await gotoApp(page, "/oneriler?sekme=tumu");
  const sort = page.getByLabel("Sırala", { exact: true });
  await expect(sort).toHaveValue("yeni");
  const byDefault = await listedIds(page);
  await sort.selectOption("sana-gore");
  await expect(page.locator(".personal-note")).toContainText("Henüz size göre sıralayacak kadar etkinlik yok");
  await waitSettled(page);
  expect(await listedIds(page), "soğuk başlangıç: yalnız en yeni önce, küme aynı").toEqual(byDefault);
  await expect(page.locator(".reason-chip"), "soğuk başlangıçta gerekçe çipi yok").toHaveCount(0);
  expectClean(s);

  // Ziyaretçi: Sırala'da 'Size göre' yok; adreste istense de varsayılan "En yeni" kalır
  const v = await open(browser, undefined, DESKTOP);
  await gotoApp(v.page, "/oneriler?sekme=tumu&sirala=sana-gore");
  const vsort = v.page.getByLabel("Sırala", { exact: true });
  await expect(vsort).toHaveValue("yeni");
  expect(await vsort.locator("option").allTextContents()).toEqual(["En yeni", "Süresi en yakın", "En çok mesaj", "En eski"]);
  await expect(v.page.locator(".reason-chip")).toHaveCount(0);
  expectClean(v);
});

// ───────────────────────────── d) Listeme ekle / Listem ─────────────────────────────

test("Listeme ekle: öneri sayfasında aç/kapa, kalıcı, Profil › Listem ve Öneriler › Listem'de görünür, 'Listenizde' gerekçesi; yalnız sahibine", async ({ browser }) => {
  const { api } = ctx;
  const { fresh } = data;
  const prop = data.proposals.find((p) => p.status === "enacted" && p.categories.length > 0)!;
  const before = await api.get<PersonalizedProposalList>("/api/proposals?limit=200&sort=sana-gore", fresh.nickname);

  // Ziyaretçide düğme yok; liste ucu oturum ister
  const v = await open(browser, undefined, DESKTOP);
  await gotoApp(v.page, `/oneriler/${prop.id}`);
  await expect(v.page.getByRole("button", { name: "Listeme ekle" })).toHaveCount(0);
  const unauthorized = await api.get("/api/me/saved").then(
    () => null,
    (e: unknown) => e,
  );
  expect(unauthorized).toBeInstanceOf(HttpError);
  expect((unauthorized as HttpError).status).toBe(401);
  expectClean(v);

  const s = await open(browser, fresh.nickname, DESKTOP);
  const { page } = s;
  await gotoApp(page, `/oneriler/${prop.id}`);
  const toggle = page.getByRole("button", { name: "Listeme ekle", exact: true });
  await expect(toggle).toBeVisible();
  await expect(toggle, "ilk durum: listede değil").toHaveAttribute("aria-pressed", "false");
  expect(reservedParts("Listeme ekle"), "ad e2e'nin ayrılmış parçalarını içermemeli").toEqual([]);

  // Ekle: basılı olur, bildirim çıkar, sunucuda kalıcıdır
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-pressed", "true");
  await expectToast(page, "Öneri listenize eklendi.");
  const mid = await api.get<SavedList>("/api/me/saved", fresh.nickname);
  expect(mid.items).toHaveLength(1);
  expect(mid.items[0]).toMatchObject({ type: "proposal", id: prop.id });
  await gotoApp(page, `/oneriler/${prop.id}`);
  await expect(page.getByRole("button", { name: "Listeme ekle", exact: true }), "yenileyince durum sunucudan gelir").toHaveAttribute("aria-pressed", "true");

  // PUT idempotent: yinelenen istek çift kayıt üretmez, ilk eklenme anı değişmez
  const again = await putSaved(api, fresh.nickname, "proposal", prop.id);
  expect(again.saved).toBe(true);
  expect(again.savedAt).toBe(mid.items[0].savedAt);
  expect((await api.get<SavedList>("/api/me/saved", fresh.nickname)).items).toHaveLength(1);

  // Konu sayfasında da (kendi düğmesi); arşivlenmiş konu dahil her konu eklenebilir
  const topic = data.topics.find((t) => t.status === "active")!;
  await gotoApp(page, `/konular/${topic.id}`);
  const topicToggle = page.getByRole("button", { name: "Listeme ekle", exact: true });
  await expect(topicToggle).toHaveAttribute("aria-pressed", "false");
  await topicToggle.click();
  await expect(topicToggle).toHaveAttribute("aria-pressed", "true");
  await expectToast(page, "Konu listenize eklendi.");

  // Profil › Listem: iki grup (Öneriler, Konular), her satır sayfaya bağlantı; çapa ?bolum=listem
  await gotoApp(page, "/profil?bolum=listem");
  const card = page.getByRole("region", { name: "Listem", exact: true });
  await expect(card).toBeVisible();
  await expect(card).toContainText("1 öneri ve 1 konu");
  await expect(card.getByRole("heading", { name: "Öneriler (1)" })).toBeVisible();
  await expect(card.getByRole("heading", { name: "Konular (1)" })).toBeVisible();
  await expect(card.getByRole("link", { name: new RegExp(prop.title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")) })).toHaveAttribute("href", `#/oneriler/${prop.id}`);
  await expect(card.getByRole("link", { name: new RegExp(topic.title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")) })).toHaveAttribute("href", `#/konular/${topic.id}`);

  // Öneriler › Listem sekmesi yalnız öneriyi gösterir (sekme etiketinde sayı)
  await gotoApp(page, "/oneriler?sekme=listem");
  await expect(page.getByRole("tab", { name: /^Listem/ })).toHaveAttribute("aria-selected", "true");
  expect(await listedIds(page)).toEqual([prop.id]);
  await expect(page.getByRole("tab", { name: /^Benim/ }), "'Benim' sekmesinin yanında").toBeVisible();

  // 'Size göre': profil artık boş değil → kişisel sıra; AYNI küme; listedeki öneri 'Listenizde' gerekçesini taşır
  const mine = await api.get<PersonalizedProposalList>("/api/proposals?limit=200&sort=sana-gore", fresh.nickname);
  expect(mine.personalized).toBe(true);
  expect(mine.items.map((p) => p.id).sort(), "hiçbir öneri düşmez ya da eklenmez").toEqual(before.items.map((p) => p.id).sort());
  expect(mine.items.find((p) => p.id === prop.id)?.reason).toMatchObject({ kind: "saved", text: "Listenizde" });
  await gotoApp(page, "/oneriler?sekme=tumu");
  await page.getByLabel("Sırala", { exact: true }).selectOption("sana-gore");
  await expect(page.locator(".personal-note")).toContainText("Size göre sıralandı. Hiçbir öneri gizlenmez; yalnız sıra değişir.");
  const card1 = page.locator("ul.pcard-list > li").filter({ has: page.locator(`a[href="#/oneriler/${prop.id}"]`) });
  await expect(card1.locator(".reason-chip")).toContainText("Listenizde");

  // KVKK dökümü ve gizlilik: kayıtlar sahibinin dökümünde; başkasının listesinde bu kayıt yok
  const dump = await api.get<{ savedItems?: { targetType: string; targetId: string; createdAt: number }[] }>("/api/me/export", fresh.nickname);
  expect(dump.savedItems?.map((x) => `${x.targetType}:${x.targetId}`).sort()).toEqual([`proposal:${prop.id}`, `topic:${topic.id}`].sort());
  const others = await api.get<SavedList>("/api/me/saved", "mehmet");
  expect(others.items.map((x) => x.id)).not.toContain(prop.id);
  expect(others.items.map((x) => x.id)).not.toContain(topic.id);

  // Çıkar: Profil'de 'Çıkar' (konu), öneri sayfasında yeniden dokunma (öneri)
  await gotoApp(page, "/profil?bolum=listem");
  // Düğmenin adı 'Çıkar' + ekran okuyucuya özel ': <numara>' (başlık değil: başlıklar 'Kapat' gibi ayrılmış parçalar içerebilir;
  // başlık aria-describedby ile okunur). Tarayıcı araya boşluk koyabilir: "Çıkar : #T-3".
  const removeTopic = page.getByRole("region", { name: "Listem", exact: true }).getByRole("button", { name: new RegExp(`^Çıkar\\s*:\\s*#T-${topic.seq}$`) });
  await expect(removeTopic).toHaveAccessibleDescription(topic.title);
  await removeTopic.click();
  await expectToast(page, "Konu listenizden çıkarıldı.");
  await expect(page.getByRole("region", { name: "Listem", exact: true }).getByRole("heading", { name: /^Konular/ })).toHaveCount(0);
  await gotoApp(page, `/oneriler/${prop.id}`);
  const off = page.getByRole("button", { name: "Listeme ekle", exact: true });
  await expect(off).toHaveAttribute("aria-pressed", "true");
  await off.click();
  await expect(off).toHaveAttribute("aria-pressed", "false");
  await expectToast(page, "Öneri listenizden çıkarıldı.");
  expect((await api.get<SavedList>("/api/me/saved", fresh.nickname)).items).toEqual([]);
  // DELETE idempotent
  const del = await api.request<{ saved: boolean }>("DELETE", `/api/me/saved/proposal/${prop.id}`, { as: fresh.nickname });
  expect(del.saved).toBe(false);
  // Boş durum
  await gotoApp(page, "/profil?bolum=listem");
  await expect(page.getByRole("region", { name: "Listem", exact: true })).toContainText("Listeniz boş");
  await gotoApp(page, "/oneriler?sekme=listem");
  await expect(page.locator(".empty-title")).toHaveText("Listenizde öneri yok");

  // Listem yüklenirken ya da hata verince 'Listenizde öneri yok' denmez (liste silinmiş sanılmasın); hata 'Tekrar dene' ile
  await putSaved(api, fresh.nickname, "proposal", prop.id);
  let release: () => void = () => undefined;
  const held = new Promise<void>((r) => (release = r));
  await page.route("**/api/me/saved", async (route) => {
    await held;
    await route.continue();
  });
  await page.goto("/?_=listem-yukleniyor#/oneriler?sekme=listem"); // gotoApp beklerdi: istek bilerek bekletiliyor
  await expect(page.getByText("Listeniz yükleniyor…").first()).toBeVisible();
  await expect(page.locator(".empty-title")).toHaveCount(0);
  await expect(page.getByRole("tab", { name: /^Listem/ })).toHaveText(/^Listem$/);
  release();
  await expect.poll(() => listedIds(page)).toEqual([prop.id]);
  await page.unroute("**/api/me/saved");
  await page.route("**/api/me/saved", (route) => route.fulfill({ status: 500, contentType: "application/json", body: JSON.stringify({ error: { code: "internal", message: "Sunucu hatası" } }) }));
  const errorsBefore = s.errors.length;
  await gotoApp(page, "/oneriler?sekme=listem");
  await expect(page.getByRole("button", { name: /Tekrar dene/ })).toBeVisible();
  await expect(page.locator(".empty-title")).toHaveCount(0);
  await page.unroute("**/api/me/saved");
  // Bilerek üretilen 500 yanıtının tarayıcı günlüğü dışında hata yok
  const injected = s.errors.splice(errorsBefore);
  expect(injected.every((e) => /status of 500/.test(e)), injected.join(" | ")).toBe(true);

  // 'Kişisel sıralama' tercihi (Profil › Listem): kapatılınca kişisel sıra yok, not nedenini söyler; açılınca hemen döner
  await gotoApp(page, "/profil?bolum=listem");
  const ranking = page.getByRole("region", { name: "Listem", exact: true }).getByRole("checkbox", { name: "Kişisel sıralama" });
  await expect(ranking).toBeChecked();
  await ranking.uncheck();
  await expectToast(page, "Kişisel sıralama kapatıldı");
  expect((await api.get<PersonalizedProposalList>("/api/proposals?limit=200&sort=sana-gore", fresh.nickname)).personalized, "tercih kapalı").toBe(false);
  expect((await api.get<{ consents: { personalRanking: boolean } }>("/api/me/export", fresh.nickname)).consents.personalRanking, "dökümde").toBe(false);
  await gotoApp(page, "/oneriler?sekme=tumu&sirala=sana-gore");
  await expect(page.locator(".personal-note")).toContainText("Kişisel sıralama kapalı");
  await expect(page.locator(".reason-chip")).toHaveCount(0);
  await gotoApp(page, "/profil?bolum=listem");
  await page.getByRole("region", { name: "Listem", exact: true }).getByRole("checkbox", { name: "Kişisel sıralama" }).check();
  await expectToast(page, "Kişisel sıralama açıldı.");
  expect((await api.get<PersonalizedProposalList>("/api/proposals?limit=200&sort=sana-gore", fresh.nickname)).personalized, "tercih açık").toBe(true);
  expectClean(s);
});

// ───────────────────────────── e) Kişisel sıralama: etkinliği olan üye ─────────────────────────────

test("Size göre (Ayşe, masaüstü): hiçbir öneri düşmez, gerekçe çipleri çıkar, seçim cihazda hatırlanır, varsayılan 'En yeni' değişmez", async ({ browser }) => {
  const { api } = ctx;
  const aid = await viewerId(api, "ayse");
  const def = data.ayse;
  const personal = await api.get<PersonalizedProposalList>("/api/proposals?limit=200&sort=sana-gore", "ayse");
  expect(personal.personalized, "Ayşe'nin tohumda yazarlık/destek/mesaj etkinliği var").toBe(true);
  expect([...personal.items.map((p) => p.id)].sort(), "AYNI küme: hiçbir öneri düşmez ya da eklenmez").toEqual([...def.map((p) => p.id)].sort());
  expect(personal.items.map((p) => p.id), "yalnız sıra değişir").not.toEqual(def.map((p) => p.id));

  const s = await open(browser, "ayse", DESKTOP);
  const { page } = s;
  const requests = trackRequests(page);
  const apiRequests = trackRecent(page);

  // Varsayılan: "En yeni", gerekçe yok, yeniden eskiye
  await gotoApp(page, "/oneriler?sekme=tumu");
  const sort = page.getByLabel("Sırala", { exact: true });
  await expect(sort).toHaveValue("yeni");
  expect(await sort.locator("option").allTextContents(), "'Size göre' 'En yeni'nin hemen altında").toEqual(["En yeni", "Size göre", "Süresi en yakın", "En çok mesaj", "En eski"]);
  const byDefault = await listedIds(page);
  expect(byDefault, "varsayılan: yeniden eskiye (#K numarası azalır)").toEqual([...def].sort((a, b) => b.seq - a.seq).map((p) => p.id));
  await expect(page.locator(".reason-chip")).toHaveCount(0);
  await expect(page.locator(".personal-note")).toHaveCount(0);

  // 'Size göre': istek sort=sana-gore ile gider, liste sunucunun sırasıyla, aynı küme, her kartta gerekçe
  const asked = page.waitForResponse((r) => r.url().includes("sort=sana-gore") && r.request().method() === "GET");
  await sort.selectOption("sana-gore");
  await asked;
  await expect(page.locator(".personal-note")).toContainText("Size göre sıralandı. Hiçbir öneri gizlenmez; yalnız sıra değişir.");
  await waitSettled(page);
  const ranked = await listedIds(page);
  expect(ranked.length, "hiçbir öneri düşmedi").toBe(byDefault.length);
  expect([...ranked].sort()).toEqual([...byDefault].sort());
  expect(ranked, "sıra değişti").not.toEqual(byDefault);
  expect(ranked, "istemci sunucunun sırasını bozmaz").toEqual(personal.items.map((p) => p.id));
  const chips = await page.locator("ul.pcard-list > li .reason-chip").allTextContents();
  expect(chips.length, "kişisel sırada çoğu kartta gerekçe çipi var").toBeGreaterThan(10);
  for (const c of chips)
    expect(c.replace(/^Sıralama nedeni:\s*/, ""), "gerekçe metni dolu ve bilinen biçimde").toMatch(/ilgilendiğiniz için$|^Listenizde$|^Süresi yaklaşıyor$|^Katıldığınız öneri$|^Yeni$|^Farklı bir alandan$/);
  // Virgüllü etiket gerekçeyi belirsizleştirmez ("Spor, Kültür, sanat ve spor …" yok); üst-alt çifti "Alt (Üst)" biçiminde
  for (const c of chips) expect(c, "gerekçede virgülle sıralanmış etiketler yok").not.toMatch(/^Sıralama nedeni:\s*[^‘(]*,[^‘]* ile ilgilendiğiniz için$/);
  expect(chips.some((c) => c.includes("Farklı bir alandan")), "çeşitlilik: ilgi alanı dışından öneriler araya girer").toBe(true);
  expect(chips.some((c) => c.includes("ilgilendiğiniz için")), "ilgi alanı gerekçesi").toBe(true);
  // Çipin sr-only öneki: ekran okuyucu 'Sıralama nedeni: …' okur
  await expect(page.locator(".reason-chip .sr-only").first()).toHaveText("Sıralama nedeni: ");
  // Nasıl çalıştığı bir açılırda; oy bilgisinin kullanılmadığı açıkça yazar
  await page.getByText("‘Size göre’ nasıl sıralar?").click();
  await expect(page.locator(".personal-note")).toContainText("Oylarınız, oy verip vermediğiniz bilgisi ve itiraz imzalarınız kullanılmaz.");
  await expectNoOverflow(page, "Öneriler › Size göre (1280)");

  // Seçim bu cihazda üye başına hatırlanır (adreste parametre olmasa da); 'En yeni' seçilince unutulur
  expect(await page.evaluate((id) => window.localStorage.getItem(`forum.oneriSirasi:${id}`), aid)).toBe("sana-gore");
  await gotoApp(page, "/oneriler?sekme=tumu");
  await expect(page.getByLabel("Sırala", { exact: true })).toHaveValue("sana-gore");
  await expect(page.locator(".personal-note")).toBeVisible();
  // Adresteki ?sirala= her zaman önce gelir
  await gotoApp(page, "/oneriler?sekme=tumu&sirala=eski");
  await expect(page.getByLabel("Sırala", { exact: true })).toHaveValue("eski");
  await page.getByLabel("Sırala", { exact: true }).selectOption("yeni");
  expect(await page.evaluate((id) => window.localStorage.getItem(`forum.oneriSirasi:${id}`), aid), "başka sıralama seçilince unutulur").toBeNull();
  await gotoApp(page, "/oneriler?sekme=tumu");
  await expect(page.getByLabel("Sırala", { exact: true })).toHaveValue("yeni");

  // Başka bir cihaz (yeni bağlam): seçim orada yok → varsayılan "En yeni"
  const other = await open(browser, "ayse", DESKTOP);
  await gotoApp(other.page, "/oneriler");
  await expect(other.page.getByLabel("Sırala", { exact: true })).toHaveValue("yeni");
  await expect(other.page.locator(".reason-chip")).toHaveCount(0);

  // Süzgeçler 'Size göre' kümesini daraltır ama göreli sırayı korur (tür ve arama)
  await gotoApp(page, "/oneriler?sekme=tumu&sirala=sana-gore");
  const rankedAgain = await listedIds(page);
  await page.getByLabel("Ara", { exact: true }).fill("mahalle");
  await expect.poll(async () => (await listedIds(page)).length).toBeLessThan(rankedAgain.length);
  const filtered = await listedIds(page);
  expect(filtered, "süzülen liste kişisel sıranın alt dizisi").toEqual(rankedAgain.filter((id) => filtered.includes(id)));
  expect(apiRequests.filter((r) => r.recent !== null).length, "hiç öneri açılmadıysa son açılanlar başlığı gönderilmez").toBe(0);
  expect(requests.filter((u) => decoded(u).includes("recent=")), "son açılanlar adres satırında hiç gitmez").toEqual([]);
  expectClean(s, other);
});

test("Size göre (Ayşe, telefon 375): 'Süz ve sırala' açılırından seçilir; küme aynı; taşma yok", async ({ browser }) => {
  const { api } = ctx;
  const personal = await api.get<PersonalizedProposalList>("/api/proposals?limit=200&sort=sana-gore", "ayse");
  const s = await open(browser, "ayse", PHONE);
  const { page } = s;
  await gotoApp(page, "/oneriler?sekme=tumu");
  const filters = page.getByRole("search");
  await filters.locator("summary", { hasText: /^Süz ve sırala/ }).click();
  const sort = filters.getByLabel("Sırala", { exact: true });
  await expect(sort).toBeVisible();
  await sort.selectOption("sana-gore");
  await expect(page.locator(".personal-note")).toBeVisible();
  await waitSettled(page);
  const ids = await listedIds(page);
  expect([...ids].sort()).toEqual([...personal.items.map((p) => p.id)].sort());
  await expect(page.locator("ul.pcard-list > li .reason-chip").first()).toBeVisible();
  // Etkin süzgeç sayılır: "Süz ve sırala (1 etkin)"
  await expect(filters.locator("summary", { hasText: /Süz ve sırala/ })).toContainText("1 etkin");
  await expectNoOverflow(page, "Öneriler › Size göre (375)");
  // 5 sekme (Açık · Sonuçlanan · Tümü · Benim · Listem) telefonda taşma yapmaz
  await expect(page.getByRole("tablist", { name: "Öneri durumu" }).getByRole("tab")).toHaveCount(5);

  // Hatırlanan 'Size göre' listeyi daraltmaz: sonraki ziyarette açılır kapalı gelir (özet yine '1 etkin'), not görünür
  await gotoApp(page, "/oneriler?sekme=tumu");
  await expect(page.locator(".personal-note")).toBeVisible();
  const details = filters.locator("details", { has: page.locator("summary", { hasText: /Süz ve sırala/ }) });
  await expect(details.locator("summary")).toContainText("1 etkin");
  await expect(details, "hatırlanan kişisel sıra açılırı her ziyarette açık getirmez").not.toHaveAttribute("open", /.*/);
  // Tür süzgeci (listeyi daraltır) ise ilk çizimde açık getirir
  await gotoApp(page, "/oneriler?sekme=tumu&tur=topic");
  await expect(details).toHaveAttribute("open", /.*/);

  // Sekmeler büyütülmüş yazıda (Android sistem yazısı %130; 360 px) da kırpılmaz: sekme listesi kendi içinde kaymaz, 'Listem' görünür
  await page.setViewportSize({ width: 360, height: 780 });
  await gotoApp(page, "/oneriler?sekme=listem");
  await page.addStyleTag({ content: "html { font-size: 130% !important; }" });
  const tablist = page.getByRole("tablist", { name: "Öneri durumu" });
  const m = await tablist.evaluate((el) => ({ scroll: el.scrollWidth, client: el.clientWidth }));
  expect(m.scroll, `sekme listesi yatay kaymaz (${m.scroll} > ${m.client})`).toBeLessThanOrEqual(m.client + 1);
  for (const tab of await tablist.getByRole("tab").all()) {
    const b = (await tab.boundingBox())!;
    expect(b.x, `${await tab.innerText()}: sol kenar görünür`).toBeGreaterThanOrEqual(0);
    expect(b.x + b.width, `${await tab.innerText()}: sağ kenar görünür`).toBeLessThanOrEqual(360);
  }
  await expectNoOverflow(page, "Öneriler sekmeleri (%130 yazı, 360)");
  expectClean(s);
});

test("Son açılanlar yalnız cihazda: öneri açılınca cihaza yazılır, yalnız sıralama isteklerine geçici girdi olur, çıkışta silinir", async ({ browser }) => {
  const { api } = ctx;
  const aid = await viewerId(api, "ayse");
  const opened = data.proposals.filter((p) => p.status === "voting").slice(0, 2);
  expect(opened.length).toBe(2);
  // Çıkış sunucudaki oturumu kapatır: Ayşe'nin ortak (önbellekli) belirteci bozulmasın diye bu test kendi oturumunu açar.
  const login = await api.request<{ token: string }>("POST", "/api/auth/login", { body: { login: "ayse", password: passwordOf("ayse") } });
  const s = await openSession(browser, api, { token: login.token, contextOptions: DESKTOP });
  sessions.push(s);
  const { page } = s;
  const requests = trackRecent(page);

  for (const p of opened) await gotoApp(page, `/oneriler/${p.id}`);
  const stored = await page.evaluate((id) => window.localStorage.getItem(`forum.sonAcilanlar:${id}`), aid);
  expect(JSON.parse(stored!), "yeniden eskiye, tekrarsız").toEqual([opened[1].id, opened[0].id]);

  // Öneriler › Size göre: son açılanlar isteğe geçici BAŞLIK olarak gider (adres satırında değil: vekil günlüklerine düşmez)
  await gotoApp(page, "/oneriler?sekme=tumu&sirala=sana-gore");
  await expect(page.locator(".personal-note")).toBeVisible();
  // Ana sayfa panosu: 'Şu an açık' kişisel sırası için aynı geçici girdi
  await gotoApp(page, "/");
  await expect(page.getByRole("region", { name: /^Şu an açık \(\d+\)$/ })).toBeVisible();

  const withRecent = requests.filter((r) => r.recent !== null);
  expect(withRecent.length, "sıralama istekleri son açılanları taşır").toBeGreaterThanOrEqual(2);
  for (const r of withRecent) {
    const u = decoded(r.url);
    expect(/\/api\/(proposals\?.*sort=sana-gore|dashboard($|\?))/.test(u), `son açılanlar başlığı yalnız kişisel sıra ve pano isteklerinde: ${u}`).toBe(true);
    expect(r.recent!.split(",")).toEqual([opened[1].id, opened[0].id]);
    expect(u, "kimlikler adres satırında yok").not.toMatch(new RegExp(`${opened[0].id}|${opened[1].id}`));
  }
  expect(requests.map((r) => decoded(r.url)).filter((u) => u.includes("recent=")), "son açılanlar hiçbir adreste gitmez").toEqual([]);
  // Başka hiçbir uç bu kimlikleri almaz (ör. arama, Listem)
  for (const r of requests) {
    if (/\/api\/(search|me\/saved)/.test(r.url)) {
      expect(r.recent, "arama ve Listem istekleri son açılanları taşımaz").toBeNull();
      expect(decoded(r.url)).not.toMatch(new RegExp(`${opened[0].id}|${opened[1].id}`));
    }
  }

  // Çıkış: cihazdaki kayıt silinir
  await page.getByRole("button", { name: /^Kullanıcı menüsü/ }).click();
  await page.getByRole("button", { name: "Çıkış yap" }).click();
  await expect(page.getByRole("link", { name: "Giriş yap" }).first()).toBeVisible();
  expect(await page.evaluate((id) => window.localStorage.getItem(`forum.sonAcilanlar:${id}`), aid), "çıkışta cihazdaki son açılanlar silinir").toBeNull();
  expectClean(s);
});

// ───────────────────────────── f) Ana sayfa ─────────────────────────────

test("Ana sayfa 'Şu an açık': profil varsa kişisel sırada ve gerekçe çipiyle; 'Sizi bekleyenler' etkilenmez ve üstte kalır; ziyaretçide süreye göre", async ({ browser }) => {
  const { api } = ctx;
  const mine = await api.get<Dashboard>("/api/dashboard", "ayse");
  const visitor = await api.get<Dashboard>("/api/dashboard");
  expect(mine.openPersonalized).toBe(true);
  expect(visitor.openPersonalized, "ziyaretçide kişisel sıra yok").toBeFalsy();
  expect(mine.open.length).toBeLessThanOrEqual(10);
  expect([...mine.open.map((p) => p.id)].sort(), "açık öneriler gizlenmez: aynı küme").toEqual([...visitor.open.map((p) => p.id)].sort());
  const taskKey = (t: DashboardTask): string[] => [t.kind, t.link, t.title, String(t.dueAt)];
  const tasksOf = (d: Dashboard): string => JSON.stringify(d.tasks.map(taskKey));
  expect(tasksOf(mine), "görevler kişiselleştirmeden etkilenmez (kişisel pano = görev uçu)").toBe(
    JSON.stringify((await api.get<DashboardTask[]>("/api/me/tasks", "ayse")).map(taskKey)),
  );
  expect(mine.tasks.length, "Ayşe'nin bekleyen oyu var").toBeGreaterThan(0);

  const s = await open(browser, "ayse", DESKTOP);
  const { page } = s;
  await gotoApp(page, "/");
  const tasks = page.getByRole("region", { name: `Sizi bekleyenler (${mine.tasks.length})`, exact: true });
  const openNow = page.getByRole("region", { name: /^Şu an açık \(\d+\)$/ });
  await expect(tasks).toBeVisible();
  await expect(openNow).toBeVisible();
  await expect(openNow.locator(".reason-chip").first(), "satırlarda gerekçe çipi").toBeVisible();
  await expect(openNow).toContainText("oy bilgisi kullanılmaz");
  await expect(openNow.getByRole("link", { name: /Tümü \(size göre\)/ })).toHaveAttribute("href", /#\/oneriler\?sekme=acik&sirala=sana-gore$/);
  const [ty, oy] = [(await tasks.boundingBox())!.y, (await openNow.boundingBox())!.y];
  expect(ty, "'Sizi bekleyenler' her zaman 'Şu an açık'ın üstünde").toBeLessThan(oy);
  // Satır sırası sunucunun kişisel sırasıdır
  const rowIds = await openNow.locator("a[href*='/oneriler/']").evaluateAll((as) => as.map((a) => /#\/oneriler\/([0-9a-f-]{36})/.exec(a.getAttribute("href") ?? "")?.[1] ?? ""));
  expect(rowIds.filter(Boolean).slice(0, 5)).toEqual(mine.open.slice(0, 5).map((p) => p.id));

  // 'Tümü (size göre)' Öneriler'i Açık sekmesinde, Size göre seçili açar
  await openNow.getByRole("link", { name: /Tümü \(size göre\)/ }).click();
  await expect(page).toHaveURL(/#\/oneriler\?sekme=acik&sirala=sana-gore$/);
  await waitSettled(page);
  await expect(page.getByLabel("Sırala", { exact: true })).toHaveValue("sana-gore");
  await expect(page.locator("ul.pcard-list > li .reason-chip").first()).toBeVisible();
  // Aynı sıra: ana sayfadaki ilk 5 = Açık sekmesinin (Size göre) ilk 5'i; çeşitlilik notu süzgeçten bağımsız
  expect((await listedIds(page)).slice(0, 5), "Şu an açık ↔ Açık › Size göre aynı sıra").toEqual(rowIds.filter(Boolean).slice(0, 5));
  await page.getByText("‘Size göre’ nasıl sıralar?").click();
  await expect(page.locator(".personal-note")).toContainText("Düzenli aralıklarla");
  await expect(page.locator(".personal-note")).not.toContainText("Her dördüncü");
  expectClean(s);

  const v = await open(browser, undefined, DESKTOP);
  await gotoApp(v.page, "/");
  const vopen = v.page.getByRole("region", { name: /^Şu an açık \(\d+\)$/ });
  await expect(vopen.getByRole("link", { name: /Tümü \(süreye göre\)/ })).toBeVisible();
  await expect(vopen.getByRole("link", { name: /Tümü \(size göre\)/ })).toHaveCount(0);
  await expect(vopen.locator(".reason-chip")).toHaveCount(0);
  expect(visitor.open.map((p) => p.id), "ziyaretçide bitişi en yakın önce").toEqual([...visitor.open].sort((a, b) => (a.phaseEndsAt ?? Infinity) - (b.phaseEndsAt ?? Infinity)).map((p) => p.id));
  expectClean(v);
});

// ───────────────────────────── g) Kontrast ve taşma ─────────────────────────────

test("kontrast ve taşma: Hızlı bul (panel ve açılır liste), Listeme ekle, Listem, gerekçe çipleri — açık ve iki koyu temada WCAG AA, 360 px'de taşma yok", async ({ browser }) => {
  test.setTimeout(420_000);
  const { api } = ctx;
  // Ayşe'nin Listem'i dolu olsun: basılı düğme, dolu Listem kartı ve 'Listenizde' çipi ölçülür
  const savedProposals = data.proposals.filter((p) => p.status === "enacted").slice(0, 2);
  const unsaved = data.proposals.find((p) => p.status === "voting")!;
  const topic = data.topics.find((t) => t.status === "active" && t.childCount > 0) ?? data.topics[0];
  for (const p of savedProposals) await putSaved(api, "ayse", "proposal", p.id);
  await putSaved(api, "ayse", "topic", topic.id);

  const problems: string[] = [];
  const variants = [
    { name: "açık", colorScheme: "light", theme: null, dark: false },
    { name: "koyu (sistem)", colorScheme: "dark", theme: null, dark: true },
    { name: "koyu (Ayarlar)", colorScheme: "light", theme: "dark", dark: true },
  ] as const;
  for (const variant of variants) {
    const sess = await open(browser, "ayse", { ...PHONE_360, colorScheme: variant.colorScheme });
    if (variant.theme) await sess.context.addInitScript((t) => window.localStorage.setItem("forum.theme", t), variant.theme);
    const { page } = sess;
    const check = async (label: string, scope = "body") => {
      const tag = `[${variant.name}] ${label}`;
      const o = await measureOverflow(page);
      if (o.overflow !== 0) problems.push(`${tag}: yatay taşma ${o.overflow} px (${o.offenders.join("; ")})`);
      for (const i of await scanContrast(page, scope)) problems.push(`${tag}: ${i.element} “${i.text}” kontrast ${i.ratio} < ${i.need} (${i.fg} / ${i.bg})`);
      if (sess.errors.length) problems.push(`${tag}: ${sess.errors.splice(0).join("; ")}`);
    };
    const views: { label: string; path: string; run?: () => Promise<void>; scope?: string }[] = [
      { label: "Ana sayfa (kişisel Şu an açık, çipler)", path: "/" },
      {
        label: "Öneriler › Size göre (çipler, nasıl sıralar açık)",
        path: "/oneriler?sekme=tumu&sirala=sana-gore",
        run: async () => {
          await expect(page.locator("ul.pcard-list > li .reason-chip").first()).toBeVisible();
          await page.getByText("‘Size göre’ nasıl sıralar?").click();
        },
      },
      { label: "Öneriler › Listem (dolu)", path: "/oneriler?sekme=listem" },
      { label: "Profil › Listem (dolu)", path: "/profil?bolum=listem" },
      { label: "Öneri sayfası (Listede: dolu yıldız)", path: `/oneriler/${savedProposals[0].id}` },
      { label: "Öneri sayfası (Listede değil)", path: `/oneriler/${unsaved.id}` },
      { label: "Konu sayfası (Listede)", path: `/konular/${topic.id}` },
      {
        label: "Hızlı bul paneli (sonuçlarla, etkin seçenek)",
        path: "/",
        scope: "dialog[open]",
        run: async () => {
          await page.getByRole("button", { name: "Hızlı bul", exact: true }).click();
          const dialog = page.getByRole("dialog", { name: "Hızlı bul", exact: true });
          await findBox(dialog).pressSequentially("mahalle");
          await expect(findHits(dialog).first()).toBeVisible();
          await findBox(dialog).press("ArrowDown");
          await waitSettled(page);
        },
      },
      {
        label: "Hızlı bul paneli (Sonuç yok)",
        path: "/",
        scope: "dialog[open]",
        run: async () => {
          await page.getByRole("button", { name: "Hızlı bul", exact: true }).click();
          const dialog = page.getByRole("dialog", { name: "Hızlı bul", exact: true });
          await findBox(dialog).pressSequentially("zzqxw");
          await expect(dialog.locator(".qf-empty")).toHaveText("Sonuç yok");
        },
      },
      {
        label: "Hızlı bul açılır listesi (1280 px, etkin seçenek)",
        path: "/",
        scope: ".app-header",
        run: async () => {
          await page.setViewportSize({ width: 1280, height: 860 });
          const box = findBox(page.locator(".app-header"));
          await box.click();
          await box.pressSequentially("mahalle");
          await expect(findHits(page).first()).toBeVisible();
          await box.press("ArrowDown");
          await waitSettled(page);
        },
      },
    ];
    for (const v of views) {
      await page.setViewportSize({ width: 360, height: 780 });
      await gotoApp(page, v.path);
      if (v.run) await v.run();
      if (variant.theme === null) {
        const dark = await page.evaluate(() => document.documentElement.style.colorScheme === "dark");
        expect(dark, `[${variant.name}] ${v.label}: koyu tema durumu`).toBe(variant.dark);
      }
      await check(v.label, v.scope);
    }
    await sess.close();
    sessions.splice(sessions.indexOf(sess), 1);
  }
  expect(problems, problems.join("\n")).toEqual([]);
});

// ───────────────────────────── Ad sözleşmesi ─────────────────────────────

test("yeni düğme, bağlantı ve bölge adları ayrılmış parçaları içermez; adlar e2e'nin aradığı adlarla çakışmaz", async ({ browser }) => {
  const names = [
    "Hızlı bul",
    "Hızlı bul sonuçları",
    "Geri",
    "Listeme ekle",
    "Listem",
    "Çıkar",
    "Çıkar: #K-12",
    "Size göre",
    "Tüm önerilerde ara",
    "Sıralama nedeni",
    "‘Size göre’ nasıl sıralar?",
    "Tümü (size göre)",
    "Sizin",
    "Kişisel sıralama",
    "Katıldığınız öneri",
  ];
  for (const n of names) expect(reservedParts(n), n).toEqual([]);
  // Üst çubuktaki kutu sayfanın kendi arama alanlarının adlarıyla ('Ara', 'Konu ara', 'Sözlükte ara', 'Kaydet' …) çakışmaz:
  // büyük/küçük harf duyarsız alt dize eşleşmesinde de yalnız sayfa içeriğindeki alanlar bulunur; tek 'search' bölgesi kalır.
  const s = await open(browser, "ayse", DESKTOP);
  const { page } = s;
  for (const [path, label] of [
    ["/oneriler", "Ara"],
    ["/konular", "Konu ara"],
    ["/kesfet?bolum=sozluk", "Sözlükte ara"],
  ] as const) {
    await gotoApp(page, path);
    await expect(findBox(page.locator(".app-header")), `${path}: üst çubukta Hızlı bul var`).toBeVisible();
    expect(await page.getByLabel(/ara/i).count(), `${path}: 'ara' içeren etiketler yalnız sayfa içeriğinde`).toBe(await page.locator("main").getByLabel(/ara/i).count());
    await expect(page.getByLabel(label, { exact: true }), `${path}: ${label}`).toHaveCount(1);
    await expect(page.getByRole("textbox", { name: /ara/i }).or(page.getByRole("searchbox", { name: /ara/i }))).toHaveCount(1);
    await expect(page.getByRole("button", { name: /kaydet/i })).toHaveCount(0);
    await expect(page.getByRole("link", { name: /^ekle$/i })).toHaveCount(0);
  }
  await gotoApp(page, "/oneriler");
  await expect(page.getByRole("search"), "tek search bölgesi: liste süzgeci").toHaveCount(1);
  await expect(page.locator(".app-header").getByRole("search")).toHaveCount(0);
  expectClean(s);
});
