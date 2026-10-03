// Senaryo 6 — Sade arayüz (Faz 2) sözleşmeleri. Tohumlu sunucuda YALNIZ OKUR (hiçbir oy, destek ya da mesaj göndermez); yeni
// davranışı kilitler, 01–05'in beklentilerine dokunmaz:
//  • Ana sayfa: üyede selam + canlı özet + 'Sizi bekleyenler' ilk ekranda (375×812), görevden panele 1 dokunuş; ziyaretçide slogan,
//    giriş/kayıt ve vitrin; oy hakkı notu 'Notu gizle' ile cihazda gizlenir.
//  • Öneriler: parametresiz açılışta bir sekme seçili ve en az bir kart görünür.
//  • Öneri sayfası: başlık (T0 katmanı yok), kompakt evre şeridi, 'Sıradaki adım' kartı (ilk ekranda, düğmesiz), 'Bu sayfada'
//    kısa yolları (telefon ve masaüstü), ?bolum= derin bağlantıları, ?mesaj=, kanıt sütununun kapalı kartları ve hükümleri,
//    'Tümünü aç/katla', 'Tam' görünümde her şeyin açık gelmesi, kapalı yazma kutusu, uyarının kendiliğinden açılması.
//  • Kabuk: 'Daha fazla' sayfasındaki Sistem durumu bloğu ve masaüstü gezinme ayracı.
//  • Ölçüm: ekran boyu, kelime, tıklanabilir öğe, rozet ve tartışmanın başladığı ekran annotation olarak kaydedilir (kesin beklenti değil).
// Faz 3 ekleri (aynı dosya; yukarıdakilere dokunulmaz):
//  • Sade dil: Term düğmesi pencere açar, Esc kapatır ve odak terime döner; 'Yönetmelikte ›' ve 'Sözlükte ›'; sembol anahtarı
//    (klavyeyle) ve 'Tam' kipte açık gelmesi; Term düğmelerinin yerleşim ve ad sözleşmesi; katman rozeti penceresi.
//  • 'Keşfet ve doğrula' (/kesfet): yedi bileşen canlı durumuyla ve bağlantılarıyla, yedi adımlı rehberin her bağlantısı,
//    erişim yolları (vitrin, alt bilgi, 'Daha fazla'), 8 ilke, sözlük (arama, Tam, derin bağlantı).
//  • Görev sayısı rozeti ('Ana sayfa') ile Ana sayfa görevlerinin tutarlılığı, kartta 'Sizden bekleniyor'.
//  • Yeni öneri formunda sözlük penceresi formu terk ettirmez (bağlantılar yeni sekmede); 'YZ önerileri' ilk 'Ekle'de kapanmaz.
//  • Bildirimler (tarih grupları, satırın tamamı bağlantı, tek 'Okundu işaretle' düğmesi), yeni öneri formu (kompakt tür, hüküm önce
//    ön denetim, kapalı açılırlar, silme kuralları satırı), Profil, Ayarlar, Konular ve Konu ayrıntısı düzeni.
//  • Kontrast ve taşma: yeni/değişen sayfalar ve Term penceresi, açık ve iki koyu tema yolunda.
//  • Veri üreten Faz 3 testleri (rozetin yenilenmesi, bildirimin okundu işaretlenmesi) dosyanın en sonundadır.
import { expect, test, type Browser, type BrowserContextOptions, type Page } from "@playwright/test";
import type { Dashboard, DashboardTask, NotificationList, ProposalDetail, ProposalSummary, ThreadResponse, TopicSummary } from "@forum/shared";
import { BLOCKS } from "../support/env";
import { useSeededServer } from "../support/fixtures";
import {
  clickEveryOnThisPage,
  describeMetrics,
  expectSectionReached,
  GREEK,
  measurePage,
  notificationGroupOf,
  onThisPage,
  reservedParts,
  scanContrast,
  visibleAreaBottom,
  waitScrollSettled,
} from "../support/sade";
import { expectToast, gotoApp, measureOverflow, openSession, waitSettled, type Session } from "../support/ui";

const ctx = useSeededServer("sadelik");

const PHONE: BrowserContextOptions = { viewport: { width: 375, height: 812 }, deviceScaleFactor: 2, hasTouch: true };
const PHONE_360: BrowserContextOptions = { viewport: { width: 360, height: 780 }, deviceScaleFactor: 2, hasTouch: true };
const DESKTOP: BrowserContextOptions = { viewport: { width: 1280, height: 860 } };

/** 'Tam' görünüm tercihi (lib/prefs.ts + lib/detailLevel.tsx ile aynı anahtar ve değer). */
const DETAIL_KEY = "forum.detail";
const DETAIL_FULL = "tam";

const sessions: Session[] = [];
test.afterEach(async () => {
  await Promise.all(sessions.splice(0).map((s) => s.close()));
});

async function open(browser: Browser, as?: string, contextOptions?: BrowserContextOptions, opts: { full?: boolean } = {}): Promise<Session> {
  const s = await openSession(browser, ctx.api, { as, contextOptions });
  sessions.push(s);
  if (opts.full) {
    // Tercih belge yüklenmeden yazılır: arayüz ilk çizimde 'tam' kipini eşzamanlı aynadan (localStorage) okur.
    await s.context.addInitScript(
      ([key, value]) => {
        try {
          window.localStorage.setItem(key, value);
        } catch {
          /* erişilemezse sade kalır; aşağıdaki denetimler bunu yakalar */
        }
      },
      [DETAIL_KEY, DETAIL_FULL],
    );
  }
  return s;
}

function expectClean(...list: Session[]): void {
  for (const s of list) expect(s.errors, "sayfa/konsol hatası olmamalı").toEqual([]);
}

async function expectNoOverflow(page: Page, label: string): Promise<void> {
  const o = await measureOverflow(page);
  expect(o.overflow, `${label}: yatay taşma ${o.overflow} px (${o.offenders.join("; ")})`).toBe(0);
}

/** Koşul tohumda/akışta oluşmadığı için atlanan denetim: görünür olsun diye annotation ve konsol satırı. */
function skipped(reason: string): void {
  test.info().annotations.push({ type: "atlandı", description: reason });
  console.log(`[atlandı] ${test.info().title}: ${reason}`);
}

/** Ölçümü annotation olarak kaydeder ve konsola yazar (kesin beklenti değil; tohum ve tarayıcı değişince oynar). */
async function recordMetrics(page: Page, label: string): Promise<void> {
  await waitScrollSettled(page);
  const summary = describeMetrics(await measurePage(page));
  test.info().annotations.push({ type: "ölçüm", description: `${label}: ${summary}` });
  console.log(`[ölçüm] ${label}: ${summary}`);
}

let proposals: ProposalSummary[];
/** Oylamadaki konu önerisi; "ayse" henüz oy vermedi (tohum). */
let voting: ProposalSummary;
/** Tartışmadaki öneri. */
let deliberation: ProposalSummary;
/** Kabul edilmiş, kesin sayımlı, bilirkişi raporlu, bütünlük uyarısı olmayan öneri (K-7 benzeri). */
let enacted: ProposalDetail;
/** Mesajı olan (görünür gövdeli) bir öneri ve mesajı. */
let threaded: { proposalId: string; messageId: string };

test.beforeAll(async () => {
  const { api } = ctx;
  proposals = await api.proposals();
  expect(proposals.length).toBeGreaterThan(30);
  voting = proposals.find((p) => p.status === "voting" && p.kind === "topic")!;
  deliberation = proposals.find((p) => p.status === "deliberation")!;
  expect(voting, "oylamada bir konu önerisi olmalı").toBeTruthy();
  expect(deliberation, "tartışmada bir öneri olmalı").toBeTruthy();

  for (const s of proposals.filter((p) => p.status === "enacted" && p.integrityWarningCount === 0)) {
    const d = await api.proposal(s.id);
    if (d.results.length > 0 && d.expertPanel && d.expertPanel.reports.length > 0 && d.events.length >= 3) {
      enacted = d;
      break;
    }
  }
  expect(enacted, "kabul edilmiş, sayımlı ve bilirkişi raporlu bir öneri olmalı").toBeTruthy();

  for (const s of [enacted, ...proposals.filter((p) => p.messageCount > 0)]) {
    const t = await api.get<ThreadResponse>(`/api/threads/proposal/${s.id}`);
    const m = t.messages.find((x) => x.visibility === "visible" && !!x.body);
    if (m) {
      threaded = { proposalId: s.id, messageId: m.id };
      break;
    }
  }
  expect(threaded, "görünür mesajı olan bir öneri olmalı").toBeTruthy();
});

// ───────────────────────────── Ana sayfa ─────────────────────────────

test("ana sayfa (üye, 375×812): selam, canlı özet ve görevler ilk ekranda; görev tek dokunuşla panele götürür", async ({ browser }) => {
  const { api } = ctx;
  const s = await open(browser, "ayse", PHONE);
  const { page } = s;
  await gotoApp(page, "/");
  await expect(page.getByRole("heading", { level: 1, name: "Merhaba, @ayse" })).toBeVisible();
  const bottom = await visibleAreaBottom(page);
  expect(bottom, "alt gezinme görünür olmalı (telefon)").toBeLessThan(812);

  // Canlı özet satırı ilk ekranda (plan: boundingBox.y < 812 − 62)
  const summary = page.locator(".home-summary");
  await expect(summary).toHaveText(/iş sizi bekliyor|Bekleyen işiniz yok/);
  const sBox = (await summary.boundingBox())!;
  expect(sBox.y, "canlı özet ilk ekranda olmalı").toBeLessThan(bottom);

  const tasks = (await api.get<Dashboard>("/api/dashboard", "ayse")).tasks;
  test.info().annotations.push({ type: "görev", description: `ayse: ${tasks.length} görev (${tasks.map((t) => t.kind).join(", ") || "yok"})` });
  const voteTask = tasks.find((t) => t.kind === "vote");
  expect(voteTask, "ayse oylamadaki öneride henüz oy vermedi: 'Oy ver' görevi olmalı").toBeTruthy();

  // 'Sizi bekleyenler (n)': ilk görev ilk ekranda, satırın tamamı bağlantı
  const card = page.getByRole("region", { name: `Sizi bekleyenler (${tasks.length})`, exact: true });
  await expect(card).toBeVisible();
  const firstTask = card.getByRole("link").first();
  const tBox = (await firstTask.boundingBox())!;
  expect(tBox.y + tBox.height, "ilk görev ilk ekranda olmalı").toBeLessThanOrEqual(bottom);
  await expect(firstTask).toHaveAttribute("href", /bolum=(eylem|bilirkisi)$/);
  // İlk 3 görünür, fazlası 'Tümünü göster (n)' ile
  const rows = card.locator("li:not([hidden]) a.home-task");
  expect(await rows.count()).toBe(Math.min(3, tasks.length));
  if (tasks.length > 3) {
    const more = card.getByRole("button", { name: `Tümünü göster (${tasks.length})` });
    await expect(more).toHaveAttribute("aria-expanded", "false");
    await more.click();
    // Düğme 'Listeyi kısalt' olur; odak yeni görünen ilk göreve taşınır
    await expect(card.getByRole("button", { name: "Listeyi kısalt" })).toHaveAttribute("aria-expanded", "true");
    await expect(card.getByRole("link").nth(3)).toBeFocused();
    expect(await card.locator("li:not([hidden]) a.home-task").count()).toBe(tasks.length);
  }

  // Ad sözleşmesi: 'Daha fazla' yalnız alt gezinmedeki düğmenin adıdır
  await expect(page.getByRole("button", { name: /Daha fazla/ })).toHaveCount(1);
  await expect(page.getByRole("link", { name: /Daha fazla/ })).toHaveCount(0);
  // Hızlı eylemler, makbuz bağlantısı, Şu an açık ve Son kararlar
  await expect(page.getByRole("group", { name: "Hızlı eylemler" }).getByRole("link", { name: /Oyum kayıtlı mı\?/ })).toBeVisible();
  await expect(page.getByRole("region", { name: /^Şu an açık \(\d+\)$/ })).toBeVisible();
  await expect(page.getByRole("region", { name: "Son kararlar", exact: true })).toBeVisible();
  await expectNoOverflow(page, "ana sayfa (üye, 375)");

  // Görevden panele 1 dokunuş ve 0 kaydırma: oy görevi → odak 'Oylama' bölgesinin ilk radyosunda, ?bolum silinmiş
  await card.getByRole("link").filter({ hasText: "Oy ver" }).first().click();
  await expect(page).toHaveURL(/#\/oneriler\/[0-9a-f-]{36}$/);
  const vote = page.getByRole("region", { name: "Oylama", exact: true });
  await expect(vote).toBeVisible();
  const radio = vote.getByRole("radio").first();
  await expect(radio).toBeFocused();
  await waitScrollSettled(page);
  await expect(radio).toBeInViewport();
  expectClean(s);
});

test("ana sayfa (üye, 1280×860): yan sütunda önce vitrin, sonra Topluluk durumu; vitrinin tamamı ilk ekranda", async ({ browser }) => {
  const s = await open(browser, "ayse", DESKTOP);
  const { page } = s;
  await gotoApp(page, "/");
  await expect(page.getByRole("heading", { level: 1, name: "Merhaba, @ayse" })).toBeVisible();
  const side = page.locator(".home-side");
  const showcase = side.getByRole("region", { name: "Neyi doğrulayabilirsiniz?" });
  const community = side.getByRole("region", { name: "Topluluk durumu", exact: true });
  await expect(showcase).toBeVisible();
  await expect(community).toBeVisible();
  const sBox = (await showcase.boundingBox())!;
  const cBox = (await community.boundingBox())!;
  expect(sBox.y, "vitrin topluluk durumunun üstünde (taslak D)").toBeLessThan(cBox.y);
  expect(sBox.y + sBox.height, "vitrinin tamamı ilk ekranda").toBeLessThanOrEqual(860);
  await expectNoOverflow(page, "ana sayfa (üye, 1280)");
  expectClean(s);
});

test("ana sayfa (ziyaretçi, 375×812): slogan, giriş/kayıt ve vitrin ilk ekranda; 'Neden kayıt gerekir?' kapalı açılır", async ({ browser }) => {
  const s = await open(browser, undefined, PHONE);
  const { page } = s;
  await gotoApp(page, "/");
  await expect(page.getByRole("heading", { level: 1, name: "Forum Sistemi" })).toBeVisible();
  const bottom = await visibleAreaBottom(page);
  const slogan = page.locator(".home-slogan");
  const words = (await slogan.innerText()).trim().split(/\s+/).length;
  expect(words, "slogan en çok 14 kelime").toBeLessThanOrEqual(14);

  const main = page.locator("main");
  for (const name of ["Giriş yap", "Kayıt ol"]) {
    const link = main.getByRole("link", { name, exact: true });
    await expect(link).toBeVisible();
    const box = (await link.boundingBox())!;
    expect(box.y + box.height, `'${name}' ilk ekranda olmalı`).toBeLessThanOrEqual(bottom);
  }
  await expect(page.getByText("Okumak için hesap gerekmez.", { exact: true })).toBeVisible();
  // İlk ekranda tek birincil (dolu) eylem: üst çubuktaki 'Giriş yap'; başlıktaki giriş/kayıt ikincil düğmedir
  const primaries = await page.locator(".btn-primary").evaluateAll(
    (els, limit) => els.filter((el) => el.getClientRects().length > 0 && el.getBoundingClientRect().top < limit).map((el) => (el as HTMLElement).innerText.trim()),
    bottom,
  );
  expect(primaries, "ilk ekranda tek birincil eylem").toEqual(["Giriş yap"]);

  // Eski çağrı kartının metni 'Neden kayıt gerekir?' açılırında; varsayılan kapalı
  const why = page.locator("details.home-why");
  await expect(why).not.toHaveAttribute("open", /.*/);
  await why.locator("summary").click();
  await expect(why).toHaveAttribute("open", /.*/);
  await expect(why).toContainText("kimliğinizi kayıt memuruna doğrulatmanız gerekir");

  // Vitrin başlığı ve ilk kutu (Defter) ilk ekranda
  const showcase = page.getByRole("region", { name: "Neyi doğrulayabilirsiniz?" });
  await expect(showcase).toBeVisible();
  const heading = (await showcase.getByRole("heading").first().boundingBox())!;
  expect(heading.y, "vitrin başlığı ilk ekranda olmalı").toBeLessThan(bottom);
  await expect(showcase.getByRole("link", { name: /Defter/ }).first()).toBeVisible();
  // Ziyaretçide görev kartı ve hızlı eylemler yok
  await expect(page.getByRole("region", { name: /Sizi bekleyenler/ })).toHaveCount(0);
  await expect(page.getByRole("group", { name: "Hızlı eylemler" })).toHaveCount(0);
  await expectNoOverflow(page, "ana sayfa (ziyaretçi, 375)");
  expectClean(s);
});

test("ana sayfa: oy hakkı notu 'Notu gizle' ile bu cihazda gizlenir; açıklama oy panelinde ve sıradaki adımda kalır", async ({ browser }) => {
  const s = await open(browser, "ozan_v", PHONE); // siyasi görüş rızası vermemiş doğrulanmış üye (tohum)
  const { page } = s;
  await gotoApp(page, "/");
  const note = page.getByRole("note");
  await expect(note).toContainText(/siyasi görüş/i);
  await expect(note.getByRole("link", { name: /Profil/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /Kapat/ }), "'Kapat' adı yalnız penceresiz sayfada hiç geçmemeli").toHaveCount(0);
  await note.getByRole("button", { name: "Notu gizle" }).click();
  await expect(note).toHaveCount(0);
  const stored = await page.evaluate(() => window.localStorage.getItem("forum.dismissed"));
  expect(stored, "gizleme tercihi forum.dismissed'da tutulmalı").toBeTruthy();
  // Yenileyince gizli kalır
  await gotoApp(page, "/");
  await expect(page.getByRole("heading", { level: 1, name: "Merhaba, @ozan_v" })).toBeVisible();
  await expect(page.getByRole("note")).toHaveCount(0);

  // Bilgi her zaman görünür: oylamadaki öneride Sıradaki adım ve Oylama paneli (not yalnız Ana sayfa tekrarıdır)
  await gotoApp(page, `/oneriler/${voting.id}`);
  const step = page.getByRole("region", { name: "Sıradaki adım", exact: true });
  await expect(step).toContainText("siyasi görüş rızası gerekir");
  await expect(step.getByRole("link", { name: /Profil › Rızalar/ })).toBeVisible();
  await expect(page.getByRole("region", { name: "Oylama", exact: true })).toContainText("siyasi görüş verisi için açık rıza");
  expectClean(s);
});

// ───────────────────────────── Öneriler listesi ─────────────────────────────

test("Öneriler: parametresiz açılışta bir sekme seçili ve en az bir kart görünür (telefon ve masaüstü)", async ({ browser }) => {
  for (const [label, options] of [
    ["telefon", PHONE_360],
    ["masaüstü", DESKTOP],
  ] as const) {
    const s = await open(browser, undefined, options);
    const { page } = s;
    await gotoApp(page, "/oneriler");
    const tablist = page.locator("main [role=tablist]").first();
    await expect(tablist.getByRole("tab", { selected: true }), `${label}: tam bir sekme seçili olmalı`).toHaveCount(1);
    await expect(page.locator("main article.pcard").first(), `${label}: en az bir öneri kartı görünmeli`).toBeVisible();
    expect(page.url(), `${label}: akıllı varsayılan adrese yazılmaz`).not.toMatch(/sekme=/);
    await expectNoOverflow(page, `Öneriler (${label})`);
    expectClean(s);
  }
});

// ───────────────────────────── Öneri sayfası: ilk ekran ─────────────────────────────

test("oylamadaki öneri (375×812): Sıradaki adım ilk ekranda; 'Oy bölümüne git' odağı ilk radyoya taşır ve ?bolum silinir", async ({ browser }) => {
  const s = await open(browser, "ayse", PHONE);
  const { page } = s;
  await gotoApp(page, `/oneriler/${voting.id}`);
  const bottom = await visibleAreaBottom(page);
  await expect(page.getByRole("heading", { level: 1, name: voting.title })).toBeVisible();

  // Başlık: #K-n düz metin, durum rozeti; kalan süre başlıkta değil kartta
  await expect(page.locator(".page-meta")).toContainText(`#K-${voting.seq}`);
  await expect(page.locator(".page-meta")).toContainText("Oylamada");
  await expect(page.locator(".header-countdown")).toHaveCount(0);

  // Kompakt evre şeridi: yalnız güncel evrenin etiketi görünür, diğerleri ekran okuyucuya okunur
  const strip = page.getByRole("list", { name: "Evreler" });
  const widths = await strip.locator(".phase-label").evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().width)));
  expect(widths.filter((w) => w > 4), "telefonda yalnız güncel evrenin etiketi görünmeli").toHaveLength(1);
  expect(await strip.evaluate((el) => el.textContent ?? "")).toContain("Destek");
  expect(await strip.evaluate((el) => el.textContent ?? "")).toContain("(şu anki evre)");

  // Sıradaki adım: tek cümle, kalan süre, birincil eylem bağlantısı; kartta düğme yok; ilk ekranda
  const step = page.getByRole("region", { name: "Sıradaki adım", exact: true });
  await expect(step).toBeVisible();
  await expect(step).toContainText("Oyunuz bekleniyor");
  await expect(step.locator(".next-step-deadline")).toContainText(/\d/);
  await expect(step.getByRole("button")).toHaveCount(0);
  const cta = step.getByRole("link", { name: "Oy bölümüne git" });
  await expect(cta).toBeVisible();
  const box = (await cta.boundingBox())!;
  expect(box.y + box.height, "birincil eylem ilk ekranda olmalı (0 kaydırma)").toBeLessThanOrEqual(bottom);
  // Kart panel metinlerini tekrarlamaz (02: '✔ Makbuz bu cihazda kayıtlı' tek eşleşme)
  await expect(step).not.toContainText("Makbuz bu cihazda kayıtlı");

  // 'Bu sayfada' gezinmesi ilk ekranda ve var olan bölümleri listeler
  const nav = onThisPage(page);
  await expect(nav).toBeVisible();
  await expect(nav.getByRole("link", { name: "Oy ver", exact: true })).toBeVisible();
  const navBox = (await nav.boundingBox())!;
  expect(navBox.y, "'Bu sayfada' ilk ekranda olmalı").toBeLessThan(bottom);

  // 1 dokunuş: odak 'Oylama' bölgesindeki ilk radyoda, adreste ?bolum yok
  await cta.click();
  await expect(page).not.toHaveURL(/[?&]bolum=/);
  const vote = page.getByRole("region", { name: "Oylama", exact: true });
  const radio = vote.getByRole("radio").first();
  await expect(radio).toBeFocused();
  await waitScrollSettled(page);
  await expect(radio).toBeInViewport();
  await expect(vote.getByRole("button", { name: "Oyumu ver" })).toBeVisible();
  await expectNoOverflow(page, "oylamadaki öneri (375)");
  expectClean(s);
});

test("oylamadaki öneri (ziyaretçi): 'Oy için giriş yapın' ve giriş bağlantısı; destek bekleyen öneride üye için 'Destekle' odağı", async ({ browser }) => {
  const { api } = ctx;
  // Ziyaretçi
  const v = await open(browser, undefined, PHONE);
  await gotoApp(v.page, `/oneriler/${voting.id}`);
  const vstep = v.page.getByRole("region", { name: "Sıradaki adım", exact: true });
  await expect(vstep).toContainText("Oy için giriş yapın");
  await expect(vstep.getByRole("link", { name: "Giriş yap" })).toHaveAttribute("href", "#/giris");
  await expect(vstep.getByRole("button")).toHaveCount(0);

  // Üye: destek bekleyen, kendisinin yazmadığı ve henüz desteklemediği öneri
  const ayseId = (await api.get<{ id: string }>("/api/me", "ayse")).id;
  let sponsoring: ProposalDetail | undefined;
  for (const p of proposals.filter((x) => x.status === "sponsoring")) {
    const d = await api.proposal(p.id, "ayse");
    if (d.authorId !== ayseId && !d.sponsors.some((x) => x.userId === ayseId)) {
      sponsoring = d;
      break;
    }
  }
  if (!sponsoring) {
    skipped("tohumda ayse'nin henüz desteklemediği destek toplayan öneri yok");
    expectClean(v);
    return;
  }
  const m = await open(browser, "ayse", PHONE);
  const { page } = m;
  await gotoApp(page, `/oneriler/${sponsoring.id}`);
  const step = page.getByRole("region", { name: "Sıradaki adım", exact: true });
  await expect(step).toContainText(/Destekçi bekleniyor \(\d+\/\d+\)/);
  await expect(step.getByRole("button")).toHaveCount(0);
  await step.getByRole("link", { name: "Destek bölümüne git" }).click();
  await expect(page).not.toHaveURL(/[?&]bolum=/);
  const support = page.getByRole("button", { name: "Destekle", exact: true });
  await expect(support).toBeFocused();
  await waitScrollSettled(page);
  await expect(support).toBeInViewport();
  // Bilgi tekrarı yok: '✔ Bu öneriyi desteklediniz.' henüz görünmez (destek verilmedi), tek 'Destekle' düğmesi
  await expect(page.getByRole("button", { name: "Destekle" })).toHaveCount(1);
  expectClean(v, m);
});

test("sonuçlanmış öneri (masaüstü): başlık, Sıradaki adım, kanıt sütunu ve kapalı kartların tek satırlık hükümleri", async ({ browser }) => {
  const s = await open(browser, undefined, DESKTOP);
  const { page } = s;
  await gotoApp(page, `/oneriler/${enacted.id}`);

  // Başlık: #K-n düz metin + durum; T0 katmanı başlıkta yok (ontoloji hükmünde yazar), alt başlık aynen
  const meta = page.locator(".page-meta");
  await expect(meta).toContainText(`#K-${enacted.seq}`);
  await expect(meta).toContainText("Kabul edildi");
  await expect(meta).not.toContainText(/\bT0\b/);
  await expect(page.locator(".page-subtitle")).toContainText(/sürüm \d+/);
  await expect(page.locator(".header-countdown")).toHaveCount(0);

  // Sıradaki adım: yürürlük cümlesi, 2 soru bağlantısı, düğmesiz; ilk ekranda
  const step = page.getByRole("region", { name: "Sıradaki adım", exact: true });
  await expect(step).toContainText("Karar yürürlükte");
  await expect(step.getByRole("button")).toHaveCount(0);
  await expect(step.getByRole("link", { name: /Nasıl karar verildi\?/ })).toBeVisible();
  await expect(step.getByRole("link", { name: /Sayımı doğrula/ })).toBeVisible();
  await expect(step).toBeInViewport({ ratio: 1 });
  // Terminal evrede son evre geçişinin zamanı
  await expect(step.locator(".next-step-when")).toBeVisible();

  // Sütun düzeni: tartışma ana sütunda (solda), kanıtlar sağda ve ilk ekranda
  const aside = page.locator("aside#kanitlar");
  await expect(aside.getByRole("heading", { level: 2, name: "Kanıtlar ve denetim" })).toBeInViewport();
  const asideBox = (await aside.boundingBox())!;
  const discBox = (await page.locator("#tartisma").boundingBox())!;
  expect(discBox.x + discBox.width, "tartışma kanıt sütununun solunda olmalı").toBeLessThanOrEqual(asideBox.x + 1);

  // Sıra ve hepsi kapalı + hüküm: Destekçiler (hep açık) · Zaman çizelgesi · Ontoloji · Parametreler · Sürüm · Defter
  const headings = (await aside.locator("h3").allInnerTexts()).map((t) => t.trim());
  expect(headings).toEqual([expect.stringMatching(/^Destekçiler \(\d+\/\d+\)$/), "Zaman çizelgesi", "Ontoloji denetimi", "Karar parametreleri", "Sürüm geçmişi", "Defter kayıtları"]);
  await expect(aside.getByRole("region", { name: /^Destekçiler \(\d+\/\d+\)$/ })).toBeVisible();
  for (const name of ["Zaman çizelgesi", "Ontoloji denetimi", "Karar parametreleri", "Sürüm geçmişi", "Defter kayıtları"]) {
    const card = aside.getByRole("region", { name, exact: true });
    const toggle = card.getByRole("button", { name, exact: true });
    await expect(toggle, `${name}: sade kipte kapalı`).toHaveAttribute("aria-expanded", "false");
    const controls = await toggle.getAttribute("aria-controls");
    expect(await page.evaluate((id) => !!document.getElementById(id!), controls), `${name}: aria-controls hedefi var`).toBe(true);
    const verdict = card.locator("p.card-summary");
    await expect(verdict, `${name}: kapalı başlık hükmü gösterir`).toBeVisible();
    expect((await verdict.innerText()).trim().length, `${name}: hüküm boş değil`).toBeGreaterThan(8);
    await expect(card.locator(".card-body")).toBeHidden();
  }
  // T0 katmanı ontoloji hükmünde
  await expect(aside.getByRole("region", { name: "Ontoloji denetimi" }).locator("p.card-summary")).toContainText("T0");

  // Tek bir kartı açmak diğerlerine dokunmaz; ikinci tıklama yeniden katlar
  const ledger = aside.getByRole("region", { name: "Defter kayıtları", exact: true });
  await ledger.getByRole("button", { name: "Defter kayıtları", exact: true }).click();
  await expect(ledger.getByRole("button", { name: "Defter kayıtları", exact: true })).toHaveAttribute("aria-expanded", "true");
  await expect(ledger.locator(".card-body")).toBeVisible();
  await expect(aside.getByRole("region", { name: "Sürüm geçmişi", exact: true }).getByRole("button", { name: "Sürüm geçmişi", exact: true })).toHaveAttribute("aria-expanded", "false");
  await ledger.getByRole("button", { name: "Defter kayıtları", exact: true }).click();
  await expect(ledger.locator(".card-body")).toBeHidden();

  // Sade kipte kapalı duran ayrıntılar: sayı kutuları, bilirkişi rapor gövdeleri; e2e'nin içine baktığı bölgeler açık
  const results = page.getByRole("region", { name: "1. tur sonucu" });
  await expect(results).toBeVisible();
  await expect(results.locator(".card-actions")).toContainText("Kabul");
  await expect(results.getByRole("region", { name: "Neden bu sonuç?" })).toBeVisible();
  const detailsOf = (summary: string) => page.locator("details").filter({ has: page.locator("summary", { hasText: summary }) });
  await expect(detailsOf("Ayrıntılı sayılar").first()).not.toHaveAttribute("open", /.*/);
  const verify = page.getByRole("region", { name: "Sayımı kendim doğrulayayım" });
  await expect(verify.getByRole("button", { name: "Sayımı kendim doğrulayayım" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Raporu oku" }).first()).toHaveAttribute("aria-expanded", "false");
  await expectNoOverflow(page, "sonuçlanmış öneri (masaüstü)");
  expectClean(s);
});

test("kanıt sütunu: 'Tümünü aç' hepsini açar, 'Tümünü katla' geri toplar; etiket kartların gerçek durumunu izler", async ({ browser }) => {
  const s = await open(browser, undefined, DESKTOP);
  const { page } = s;
  await gotoApp(page, `/oneriler/${enacted.id}`);
  const aside = page.locator("aside#kanitlar");
  const toggles = aside.locator("button.card-toggle");
  const total = await toggles.count();
  expect(total).toBe(5);
  const all = aside.getByRole("button", { name: /^Tümünü (aç|katla)$/ });
  await expect(all).toHaveText("Tümünü aç");

  await all.click();
  await expect(aside.locator("button.card-toggle[aria-expanded=true]")).toHaveCount(total);
  await expect(all).toHaveText("Tümünü katla");
  await expect(all, "odak düğmede kalır").toBeFocused();

  // Tek bir kartı elle katlayınca etiket yeniden 'Tümünü aç' olur (MutationObserver gerçek durumu izler)
  await aside.getByRole("button", { name: "Defter kayıtları", exact: true }).click();
  await expect(all).toHaveText("Tümünü aç");
  await all.click();
  await expect(all).toHaveText("Tümünü katla");
  await all.click();
  await expect(aside.locator("button.card-toggle[aria-expanded=false]")).toHaveCount(total);
  await expect(all).toHaveText("Tümünü aç");
  // 'Kapat' sözcüğü hiçbir düğmede geçmez (e2e /Kapat/ seçicisi)
  await expect(page.getByRole("button", { name: /Kapat/ })).toHaveCount(0);
  expectClean(s);
});

// ───────────────────────────── Derin bağlantılar ve 'Bu sayfada' ─────────────────────────────

test("bilirkişi rapor satırı (375 ve 360 px): [Raporu oku] meta ile aynı satırda kalır, meta kendi içinde sarar", async ({ browser }) => {
  for (const [opts, label] of [
    [PHONE, "375"],
    [PHONE_360, "360"],
  ] as const) {
    const s = await open(browser, undefined, opts);
    const { page } = s;
    await gotoApp(page, `/oneriler/${enacted.id}?bolum=bilirkisi`);
    const heads = page.locator("#bilirkisi .expert-report-head");
    await expect(heads.first()).toBeVisible();
    const rows = await heads.evaluateAll((els) =>
      els.map((h) => {
        const meta = h.querySelector(".expert-report-meta")!.getBoundingClientRect();
        const btn = h.querySelector(":scope > .btn")!.getBoundingClientRect();
        return { sameLine: btn.top < meta.bottom && btn.left >= meta.right - 1, height: Math.round(h.getBoundingClientRect().height) };
      }),
    );
    test.info().annotations.push({ type: "ölçüm", description: `${label} px rapor satırı yükseklikleri: ${rows.map((r) => r.height).join(", ")} px` });
    for (const r of rows) expect(r.sameLine, `${label} px: düğme meta ile aynı satırda olmalı`).toBe(true);
    await expectNoOverflow(page, `bilirkişi rapor satırı (${label})`);
    expectClean(s);
  }
});

test("?bolum= derin bağlantıları: kartı açar, kaydırır, odağı taşır ve parametreyi siler; ?mesaj= korunur", async ({ browser }) => {
  const s = await open(browser, undefined, DESKTOP);
  const { page } = s;
  const base = `/oneriler/${enacted.id}`;

  // Katlanabilir kanıt kartları
  for (const [bolum, name] of [
    ["defter", "Defter kayıtları"],
    ["ontoloji", "Ontoloji denetimi"],
    ["surumler", "Sürüm geçmişi"],
    ["parametreler", "Karar parametreleri"],
    ["evreler", "Zaman çizelgesi"],
  ] as const) {
    await gotoApp(page, `${base}?bolum=${bolum}`);
    const toggle = page.getByRole("button", { name, exact: true });
    await expect(toggle, `?bolum=${bolum}: '${name}' açılmalı`).toHaveAttribute("aria-expanded", "true");
    await expect(toggle).toBeFocused();
    await expect(page).not.toHaveURL(/[?&]bolum=/);
    await expectSectionReached(page, page.locator(`#${bolum}`), `?bolum=${bolum}`);
  }

  // Sonuç, doğrulama ve diğer çapalar
  await gotoApp(page, `${base}?bolum=sonuclar`);
  await expectSectionReached(page, page.locator("#sonuclar"), "?bolum=sonuclar");
  await gotoApp(page, `${base}?bolum=dogrula`);
  await expectSectionReached(page, page.locator("#dogrula"), "?bolum=dogrula");
  await expect(page.getByRole("button", { name: "Sayımı kendim doğrulayayım" }), "odak doğrulama düğmesine gider").toBeFocused();
  for (const bolum of ["metin", "bilirkisi", "yz", "tartisma", "kanitlar"]) {
    await gotoApp(page, `${base}?bolum=${bolum}`);
    await expectSectionReached(page, page.locator(`#${bolum}`), `?bolum=${bolum}`);
  }

  // Bilinmeyen çapa sessizce silinir (hata yok); ?mesaj= diğer parametrelere dokunulmaz
  await gotoApp(page, `${base}?bolum=olmayan-bir-bolum`);
  await expect(page).not.toHaveURL(/[?&]bolum=/);
  await gotoApp(page, `${base}?bolum=defter&mesaj=${threaded.messageId}`);
  await expect(page).not.toHaveURL(/[?&]bolum=/);
  await expect(page).toHaveURL(new RegExp(`mesaj=${threaded.messageId}`));
  expectClean(s);
});

test("?mesaj=<id>: mesaj görünür alana gelir, odak gövdesine iner; adres korunur (telefon ve masaüstü)", async ({ browser }) => {
  for (const [label, options] of [
    ["telefon", PHONE],
    ["masaüstü", DESKTOP],
  ] as const) {
    const s = await open(browser, undefined, options);
    const { page } = s;
    await gotoApp(page, `/oneriler/${threaded.proposalId}?mesaj=${threaded.messageId}`);
    const article = page.locator(`#mesaj-${threaded.messageId}`);
    await expect(article, `${label}: #mesaj-<id> görünür olmalı`).toBeVisible();
    await waitScrollSettled(page);
    await expect(article).toBeInViewport();
    await expect(article.locator(".msg-body"), `${label}: odak mesaj gövdesinde`).toBeFocused();
    await expect(page).toHaveURL(new RegExp(`mesaj=${threaded.messageId}`));
    // Mesajı çevreleyen tartışma bölümü sayfada ve 'Bu sayfada' sayısıyla uyumlu
    const heading = page.locator("#tartisma").getByRole("heading", { level: 2 }).first();
    await expect(heading).toHaveText(/^Tartışma \(\d+\)$/);
    expectClean(s);
  }
});

test("'Bu sayfada': telefonda ve masaüstünde her kısa yol ilgili bölüme götürür (oylamada, tartışmada, kabul edilmişte)", async ({ browser }) => {
  test.setTimeout(180_000);
  const cases: { label: string; as?: string; options: BrowserContextOptions; id: string; expect: string[]; absent?: string[] }[] = [
    { label: "oylama (ayse, telefon)", as: "ayse", options: PHONE, id: voting.id, expect: ["Metin", "Oy ver", "Tartışma (", "Kanıtlar"] },
    { label: "tartışma (ziyaretçi, telefon)", options: PHONE, id: deliberation.id, expect: ["Metin", "Metin önerileri", "Tartışma (", "Kanıtlar"], absent: ["Sonuç"] },
    { label: "kabul edilmiş (ziyaretçi, telefon)", options: PHONE, id: enacted.id, expect: ["Metin", "Sonuç", "Bilirkişi", "Tartışma (", "Kanıtlar"], absent: ["Oy ver", "İtiraz", "Destek"] },
    { label: "kabul edilmiş (ziyaretçi, masaüstü)", options: DESKTOP, id: enacted.id, expect: ["Metin", "Sonuç", "Bilirkişi", "Tartışma (", "Kanıtlar"], absent: ["Oy ver"] },
  ];
  for (const c of cases) {
    const s = await open(browser, c.as, c.options);
    const { page } = s;
    await gotoApp(page, `/oneriler/${c.id}`);
    // Yalnız var olan bölümler listelenir
    const links = (await onThisPage(page).getByRole("link").allInnerTexts()).map((t) => t.trim());
    for (const want of c.expect) expect(links.some((l) => l.startsWith(want)), `${c.label}: '${want}' bağlantısı olmalı (var: ${links.join(" · ")})`).toBe(true);
    for (const no of c.absent ?? []) expect(links.includes(no), `${c.label}: '${no}' bağlantısı olmamalı`).toBe(false);
    // 360/375 px'de gezinme satıra sarar, taşmaz
    const nav = (await onThisPage(page).boundingBox())!;
    expect(nav.x + nav.width).toBeLessThanOrEqual((c.options.viewport?.width ?? 1280) + 1);
    const clicked = await clickEveryOnThisPage(page);
    expect(clicked.length).toBe(links.length);
    await expectNoOverflow(page, c.label);
    expectClean(s);
  }
});

test("'Bu sayfada ▸ Tartışma' (375×812): tartışma görünür alana girer; yazma kutusu kapalı, kurallar en altta", async ({ browser }) => {
  const s = await open(browser, "ayse", PHONE);
  const { page } = s;
  await gotoApp(page, `/oneriler/${voting.id}`);
  const disc = page.locator("#tartisma");
  const before = await disc.evaluate((el) => el.getBoundingClientRect().top + window.scrollY);
  test.info().annotations.push({ type: "ölçüm", description: `tartışma sayfanın ${Math.round(before)} px altında (${(before / 812 + 1).toFixed(1).replace(".", ",")}. ekran)` });
  await onThisPage(page).getByRole("link", { name: /^Tartışma \(\d+\)$/ }).click();
  await expect(page).not.toHaveURL(/[?&]bolum=/);
  await waitScrollSettled(page);
  await expect(disc).toBeInViewport();
  await expect(disc.getByRole("heading", { level: 2 }).first()).toBeInViewport();

  // Yazma kutusu: doğrulanmış üyede kapalı başlar, dokununca açılır ve odak metin alanına geçer; Vazgeç odağı geri verir
  const trigger = disc.getByRole("button", { name: /Görüşünüzü yazın/ });
  await expect(trigger).toHaveAttribute("aria-expanded", "false");
  await expect(disc.getByLabel("Mesajınız")).toHaveCount(0);
  await trigger.click();
  const field = disc.getByLabel("Mesajınız");
  await expect(field).toBeFocused();
  await expect(disc.getByRole("button", { name: "Gönder" })).toBeDisabled(); // boş metin gönderilmez
  await disc.getByRole("button", { name: "Vazgeç" }).click();
  await expect(field).toHaveCount(0);
  await expect(trigger).toBeFocused();
  // Yazılmış metin varken kutu açık kalır (taslak kaybolmaz)
  await trigger.click();
  await disc.getByLabel("Mesajınız").fill("Taslak metin — gönderilmeyecek.");
  await disc.getByRole("button", { name: "Vazgeç" }).click();
  await expect(trigger).toBeFocused();
  await trigger.click();
  await expect(disc.getByLabel("Mesajınız")).toHaveValue("");
  await disc.getByRole("button", { name: "Vazgeç" }).click();

  // 'Tartışma kuralları ve köprü skoru' kapalı ve mesajların ALTINDA
  const guide = disc.locator("details.discussion-guide");
  await expect(guide).not.toHaveAttribute("open", /.*/);
  const guideBox = (await guide.boundingBox())!;
  const thread = disc.locator(".msg-thread");
  if (await thread.count()) {
    const tBox = (await thread.boundingBox())!;
    expect(guideBox.y, "kurallar mesajlardan sonra gelir").toBeGreaterThanOrEqual(tBox.y + tBox.height - 1);
  }
  // İstatistik satırı ve sade hash alt satırı
  if (await thread.count()) {
    await expect(disc.locator(".discussion-stats")).toContainText(/Lehte|Aleyhte|Soru|Tarafsız/);
    await expect(disc.locator(".msg").first()).toContainText(/özet [0-9a-f]{4,}/);
  }
  await expectNoOverflow(page, "tartışma (375)");
  expectClean(s);
});

// ───────────────────────────── Tam görünüm ─────────────────────────────

test("'Tam' görünüm (Ayarlar'dan seçilir): kanıt kartları, açılırlar, rapor gövdeleri ve yazma kutusu açık gelir", async ({ browser }) => {
  const s = await open(browser, "ayse", DESKTOP);
  const { page } = s;
  // Önce sade: kapalı kartlar var
  await gotoApp(page, `/oneriler/${enacted.id}`);
  await expect(page.locator("button.card-toggle[aria-expanded=false]").first()).toBeVisible();
  // Ayarlar › Görünüm yoğunluğu › Tam
  await gotoApp(page, "/ayarlar");
  await page.getByRole("radio", { name: "Tam — tüm ayrıntılar açık" }).check();
  await expect(page.getByRole("radio", { name: "Tam — tüm ayrıntılar açık" })).toBeChecked();
  expect(await page.evaluate((k) => window.localStorage.getItem(k), DETAIL_KEY)).toBe(DETAIL_FULL);

  await gotoApp(page, `/oneriler/${enacted.id}`);
  const aside = page.locator("aside#kanitlar");
  await expect(aside.locator("button.card-toggle").first()).toBeVisible();
  await expect(page.locator("button.card-toggle[aria-expanded=false]"), "kanıt kartlarının hepsi açık gelmeli").toHaveCount(0);
  await expect(aside.getByRole("button", { name: /^Tümünü (aç|katla)$/ })).toHaveText("Tümünü katla");
  await expect(page.locator("main details").first()).toBeAttached();
  await expect(page.locator("main details:not([open])"), "açılırların hepsi açık gelmeli").toHaveCount(0);
  await expect(page.locator(".clamp-text-toggle[aria-expanded=false]"), "kırpılmış metinler açık gelmeli").toHaveCount(0);
  await expect(page.getByRole("button", { name: "Raporu oku" }), "bilirkişi raporları açık gelmeli").toHaveCount(0);
  await expect(page.getByRole("button", { name: "Raporu gizle" }).first()).toHaveAttribute("aria-expanded", "true");
  // Kapalı hüküm satırları açıkken de görünür kalır
  await expect(aside.getByRole("region", { name: "Ontoloji denetimi", exact: true }).locator("p.card-summary")).toBeVisible();

  // Oylamadaki öneride yazma kutusu ve oy paneli açık; kategori '+n' (varsa) açık
  await gotoApp(page, `/oneriler/${voting.id}`);
  await expect(page.locator("#tartisma").getByLabel("Mesajınız"), "yazma kutusu 'Tam' kipte açık gelir (odak çalmaz)").toBeVisible();
  await expect(page.locator("#tartisma").getByLabel("Mesajınız")).not.toBeFocused();
  await expect(page.locator("details.discussion-guide")).toHaveAttribute("open", /.*/);
  const more = page.locator(".proposal-cats .cat-tag-toggle");
  if (await more.count()) await expect(more).toHaveAttribute("aria-expanded", "true");
  expectClean(s);

  // Sade'ye dön: tercih yalnız varsayılanı değiştirir
  await gotoApp(page, "/ayarlar");
  await page.getByRole("radio", { name: /^Sade/ }).check();
  await gotoApp(page, `/oneriler/${enacted.id}`);
  await expect(page.locator("button.card-toggle[aria-expanded=false]").first()).toBeVisible();
});

test("'Tam' görünüm (başlangıç tercihi): Ana sayfada bütün görevler açık gelir", async ({ browser }) => {
  const { api } = ctx;
  const s = await open(browser, "ayse", PHONE, { full: true });
  const { page } = s;
  await gotoApp(page, "/");
  const tasks = (await api.get<Dashboard>("/api/dashboard", "ayse")).tasks;
  expect(tasks.length, "ayse'nin 3'ten fazla görevi olmalı (tohum): 'Tümünü göster' sınanır").toBeGreaterThan(3);
  const card = page.getByRole("region", { name: `Sizi bekleyenler (${tasks.length})`, exact: true });
  expect(await card.locator("li:not([hidden]) a.home-task").count(), "'Tam' kipte tüm görevler açık gelir").toBe(tasks.length);
  await expect(card.getByRole("button", { name: "Listeyi kısalt" })).toHaveAttribute("aria-expanded", "true");
  expectClean(s);
});

// ───────────────────────────── Uyarı yalnız gerektiğinde bağırır ─────────────────────────────

test("yönetmeliğe aykırı öneri: Ontoloji denetimi kanıt sütununda en üstte ve açık; 'Hangi madde?' oraya götürür", async ({ browser }) => {
  const bad = proposals.find((p) => p.status === "inadmissible");
  expect(bad, "tohumda yönetmeliğe aykırı bir öneri olmalı").toBeTruthy();
  const s = await open(browser, undefined, DESKTOP);
  const { page } = s;
  await gotoApp(page, `/oneriler/${bad!.id}`);
  const step = page.getByRole("region", { name: "Sıradaki adım", exact: true });
  await expect(step).toContainText("Yönetmeliğe aykırı — oylanamaz");
  await expect(step.getByRole("button")).toHaveCount(0);
  // Anayasa md. 4 açıklaması 'Bu ne demek?' açılırında (varsayılan kapalı)
  const why = step.locator("details").filter({ has: page.locator("summary", { hasText: "Bu ne demek?" }) });
  await expect(why).not.toHaveAttribute("open", /.*/);
  await why.locator("summary").click();
  await expect(why).toContainText(/yönetmelik|Anayasa/i);

  // Ontoloji denetimi Destekçiler'in önünde, açık ve (ihlal) kırmızı hükümle
  const aside = page.locator("aside#kanitlar");
  const headings = (await aside.locator("h3").allInnerTexts()).map((t) => t.trim());
  const iAudit = headings.indexOf("Ontoloji denetimi");
  const iSponsors = headings.findIndex((h) => h.startsWith("Destekçiler"));
  expect(iAudit, "Ontoloji denetimi kartı olmalı").toBeGreaterThanOrEqual(0);
  expect(iAudit, `Ontoloji denetimi Destekçiler'in önünde olmalı (sıra: ${headings.join(" · ")})`).toBeLessThan(iSponsors);
  const toggle = aside.getByRole("button", { name: "Ontoloji denetimi", exact: true });
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await expect(aside.getByRole("region", { name: "Ontoloji denetimi", exact: true }).locator("p.card-summary")).toContainText(/aykırı|ihlal/i);

  // 'Hangi madde?' → ontoloji kartına gider (kapatılmış olsa da açılır), adreste ?bolum kalmaz
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await step.getByRole("link", { name: /Hangi madde\?/ }).click();
  await expect(page).not.toHaveURL(/[?&]bolum=/);
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await expect(toggle).toBeFocused();
  expectClean(s);
});

test("bilirkişi görevi: Ana sayfadaki görev ?bolum=bilirkisi ile Bilirkişi görüşü kartına götürür; Sıradaki adım davet/rapor der", async ({ browser }) => {
  const { api } = ctx;
  // Davet edilmiş ya da görevi kabul etmiş (rapor bekleyen) bir bilirkişi ve onun önerisi (tohumdaki panellerden)
  let found: { nickname: string; proposalId: string } | undefined;
  for (const p of proposals.filter((x) => ["deliberation", "voting", "revote", "reconciliation"].includes(x.status))) {
    const a = (await api.proposal(p.id)).expertPanel?.assignments.find((x) => x.status === "invited" || x.status === "accepted");
    if (a) {
      found = { nickname: a.nickname, proposalId: p.id };
      break;
    }
  }
  if (!found) {
    skipped("tohumda davet edilmiş ya da rapor bekleyen bilirkişi ataması yok");
    return;
  }
  const tasks = (await api.get<Dashboard>("/api/dashboard", found.nickname)).tasks;
  expect(tasks.some((t) => t.kind === "expert"), `@${found.nickname} için Ana sayfada bilirkişi görevi olmalı`).toBe(true);
  const s = await open(browser, found.nickname, PHONE);
  const { page } = s;
  await gotoApp(page, "/");
  const row = page.getByRole("link").filter({ hasText: "Bilirkişi görevi" }).first();
  await expect(row).toHaveAttribute("href", /bolum=bilirkisi$/);
  await row.click();
  await expect(page).not.toHaveURL(/[?&]bolum=/);
  await expectSectionReached(page, page.locator("#bilirkisi"), "bilirkişi görevi");
  await expect(page.getByRole("region", { name: "Bilirkişi görüşü", exact: true })).toBeVisible();
  const step = page.getByRole("region", { name: "Sıradaki adım", exact: true });
  await expect(step).toContainText(/Bilirkişi davetini yanıtlamanız bekleniyor|Raporunuz bekleniyor/);
  await expect(step.getByRole("link", { name: "Bilirkişi görevlerim" })).toBeVisible();
  expectClean(s);
});

// ───────────────────────────── Kabuk ─────────────────────────────

test("kabuk: 'Daha fazla' sayfasının en altında Sistem durumu bloğu (her sayfadan), masaüstünde gezinme ayracı", async ({ browser }) => {
  const m = await open(browser, undefined, PHONE_360);
  await gotoApp(m.page, "/oneriler"); // Ana sayfa dışı
  await m.page.getByRole("button", { name: /Daha fazla/ }).click();
  const dialog = m.page.getByRole("dialog", { name: "Daha fazla" });
  await expect(dialog).toBeVisible();
  const sys = dialog.getByRole("region", { name: "Sistem durumu", exact: true });
  await expect(sys).toBeVisible();
  for (const label of ["Defter", "YZ kipi", "Simüle saat", "Yönetmelik sürümü", "İstemci sürümü"]) {
    await expect(sys.getByText(label, { exact: true }), `Sistem durumu: '${label}' satırı`).toBeVisible();
  }
  const ledger = sys.getByRole("link", { name: /\d+\. blok · \d+\/\d+ doğrulayıcı sağlıklı/ });
  await expect(ledger).toBeVisible();
  await expectNoOverflow(m.page, "Daha fazla (360, sistem durumu)");
  // Sistem durumu, sayfa listesinin ALTINDA
  const navBox = (await dialog.getByRole("navigation", { name: "Diğer sayfalar" }).boundingBox())!;
  const sysBox = (await sys.boundingBox())!;
  expect(sysBox.y, "Sistem durumu sayfa bağlantılarından sonra gelir").toBeGreaterThanOrEqual(navBox.y + navBox.height - 1);
  await ledger.click();
  await expect(m.page).toHaveURL(/#\/defter$/);
  await expect(dialog, "bağlantıya dokununca sayfa kapanır").toBeHidden();
  expectClean(m);

  const d = await open(browser, undefined, DESKTOP);
  await gotoApp(d.page, "/");
  const topNav = d.page.getByRole("navigation", { name: "Ana gezinme" });
  await expect(topNav.getByRole("link")).toHaveCount(8);
  const divider = topNav.locator(".nav-divider");
  await expect(divider).toHaveCount(1);
  await expect(divider).toHaveAttribute("aria-hidden", "true");
  const left = (await topNav.getByRole("link", { name: "Oyum kayıtlı mı?" }).boundingBox())!;
  const right = (await topNav.getByRole("link", { name: "Bilirkişiler" }).boundingBox())!;
  const mid = (await divider.boundingBox())!;
  expect(mid.x, "ayraç 'Katılım' ile 'Keşfet ve doğrula' grupları arasında").toBeGreaterThan(left.x + left.width - 1);
  expect(mid.x).toBeLessThan(right.x + 1);
  expectClean(d);
});

// ───────────────────────────── Ölçüm (annotation) ─────────────────────────────

test("ölçüm: ekran boyu, kelime, tıklanabilir öğe, rozet ve tartışmanın başladığı ekran kaydedilir (kesin beklenti değil)", async ({ browser }) => {
  test.setTimeout(240_000);
  const views: { label: string; as?: string; options: BrowserContextOptions; path: string; full?: boolean }[] = [
    { label: "Ana sayfa · üye (ayse) · telefon 375×812", as: "ayse", options: PHONE, path: "/" },
    { label: "Ana sayfa · ziyaretçi · telefon 375×812", options: PHONE, path: "/" },
    { label: "Ana sayfa · üye (ayse) · masaüstü 1280×860", as: "ayse", options: DESKTOP, path: "/" },
    { label: `Öneri #K-${enacted.seq} (kabul, bilirkişili) · telefon 375×812`, options: PHONE, path: `/oneriler/${enacted.id}` },
    { label: `Öneri #K-${enacted.seq} (kabul, bilirkişili) · masaüstü 1280×860`, options: DESKTOP, path: `/oneriler/${enacted.id}` },
    { label: `Öneri #K-${enacted.seq} (kabul) · telefon 375×812 · Tam`, options: PHONE, path: `/oneriler/${enacted.id}`, full: true },
    { label: `Öneri #K-${voting.seq} (oylama, ayse) · telefon 375×812`, as: "ayse", options: PHONE, path: `/oneriler/${voting.id}` },
    { label: `Öneri #K-${deliberation.seq} (tartışma) · telefon 375×812`, options: PHONE, path: `/oneriler/${deliberation.id}` },
    // Faz 3: ikincil sayfalar ve yeni sayfa (önce/sonra karşılaştırması için aynı ölçüm)
    { label: "Profil · üye (ayse) · telefon 375×812", as: "ayse", options: PHONE, path: "/profil" },
    { label: "Profil · üye (ayse) · telefon 375×812 · Tam", as: "ayse", options: PHONE, path: "/profil", full: true },
    { label: "Ayarlar · ziyaretçi · telefon 375×812", options: PHONE, path: "/ayarlar" },
    { label: "Konular · ziyaretçi · telefon 375×812", options: PHONE, path: "/konular" },
    { label: "Konu ayrıntısı (ilk konu) · telefon 375×812", options: PHONE, path: `/konular/${(await ctx.api.get<TopicSummary[]>("/api/topics"))[0].id}` },
    { label: "Bildirimler · üye (ayse) · telefon 375×812", as: "ayse", options: PHONE, path: "/bildirimler" },
    { label: "Yeni öneri: yeni konu · üye (ayse) · telefon 375×812", as: "ayse", options: PHONE, path: "/oneriler/yeni?tur=topic" },
    { label: "Yeni öneri: silme talebi · üye (ayse) · telefon 375×812", as: "ayse", options: PHONE, path: `/oneriler/yeni?tur=deletion&mesaj=${threaded.messageId}` },
    { label: "Keşfet ve doğrula · ziyaretçi · telefon 375×812", options: PHONE, path: "/kesfet" },
    { label: "Keşfet ve doğrula · ziyaretçi · masaüstü 1280×860", options: DESKTOP, path: "/kesfet" },
  ];
  for (const v of views) {
    const s = await open(browser, v.as, v.options, { full: v.full });
    await gotoApp(s.page, v.path);
    await recordMetrics(s.page, v.label);
    await expectNoOverflow(s.page, v.label);
    expectClean(s);
  }
});

// ───────────────────────────── Erişilebilirlik: kontrast ve taşma (açık ve koyu tema) ─────────────────────────────

test("kontrast ve taşma: açık ve koyu temada Ana sayfa ile öneri sayfalarında metin kontrastı WCAG AA, 360 px'de yatay taşma yok", async ({ browser }) => {
  test.setTimeout(240_000);
  const views: { label: string; as?: string; path: string }[] = [
    { label: "Ana sayfa (üye)", as: "ayse", path: "/" },
    { label: "Ana sayfa (ziyaretçi)", path: "/" },
    { label: `Öneri #K-${enacted.seq} (kabul, bilirkişili)`, path: `/oneriler/${enacted.id}` },
    { label: `Öneri #K-${voting.seq} (oylama)`, as: "ayse", path: `/oneriler/${voting.id}` },
    { label: `Öneri #K-${deliberation.seq} (tartışma)`, as: "ayse", path: `/oneriler/${deliberation.id}` },
  ];
  const bad = proposals.find((p) => p.status === "inadmissible");
  if (bad) views.push({ label: `Öneri #K-${bad.seq} (yönetmeliğe aykırı)`, path: `/oneriler/${bad.id}` });
  const problems: string[] = [];
  // Üç koyu/açık yol: açık tema; sistem koyu (prefers-color-scheme bloğu); Ayarlar'dan seçilen koyu ([data-theme="dark"] bloğu)
  const variants = [
    { name: "açık", colorScheme: "light", theme: null, dark: false },
    { name: "koyu (sistem)", colorScheme: "dark", theme: null, dark: true },
    { name: "koyu (Ayarlar)", colorScheme: "light", theme: "dark", dark: true },
  ] as const;
  for (const variant of variants) {
    for (const v of views) {
      const sess = await open(browser, v.as, { ...PHONE_360, colorScheme: variant.colorScheme });
      const { page } = sess;
      const tag = `[${variant.name}] ${v.label}`;
      await gotoApp(page, v.path);
      // 'Tam' kipte kapalı kartlar ve açılırlar da denetlenir (hepsi açık gelir)
      await page.evaluate(
        ([theme]) => {
          window.localStorage.setItem("forum.detail", "tam");
          if (theme) window.localStorage.setItem("forum.theme", theme);
        },
        [variant.theme],
      );
      await gotoApp(page, v.path);
      const dark = await page.evaluate(() => document.documentElement.style.colorScheme === "dark");
      expect(dark, `${tag}: koyu tema durumu`).toBe(variant.dark);
      const o = await measureOverflow(page);
      if (o.overflow !== 0) problems.push(`${tag}: yatay taşma ${o.overflow} px (${o.offenders.join("; ")})`);
      for (const i of await scanContrast(page)) problems.push(`${tag}: ${i.element} “${i.text}” kontrast ${i.ratio} < ${i.need} (${i.fg} / ${i.bg})`);
      if (sess.errors.length) problems.push(`${tag}: ${sess.errors.join("; ")}`);
      await sess.close();
      sessions.splice(sessions.indexOf(sess), 1);
    }
  }
  expect(problems, problems.join("\n")).toEqual([]);
});

// ───────────────────────────── Faz 3: sade dil (Term, sembol anahtarı) ─────────────────────────────

/** Karar parametreleri kartı ('?bolum=parametreler' açar, kaydırır ve odağı taşır); sade kipte kapalı gelir. */
function paramsCard(page: Page) {
  return page.getByRole("region", { name: "Karar parametreleri", exact: true });
}

test("Term: terim düğmesi pencere açar; Esc kapatır ve odak terime döner; ‘Yönetmelikte ›’ ve ‘Sözlükte ›’ çalışır (dokunmatik, 360 px)", async ({ browser }) => {
  const s = await open(browser, undefined, PHONE_360);
  const { page } = s;
  const url = `/oneriler/${enacted.id}?bolum=parametreler`;
  await gotoApp(page, url);
  const term = paramsCard(page).getByRole("button", { name: "Onay eşiği", exact: true });
  await expect(term).toBeVisible();
  await expect(term).toHaveAttribute("aria-haspopup", "dialog");
  await expect(term, "açılan şey modal penceredir, katlanan bölüm değil").not.toHaveAttribute("aria-expanded", /.*/);

  // Dokunuş: günlük karşılık, tanım ve iki bağlantı; pencere 360 px'e sığar
  await term.tap();
  const dialog = page.getByRole("dialog", { name: "Onay eşiği", exact: true });
  await expect(dialog).toBeVisible();
  await expect(dialog.locator(".term-plain")).toContainText("Günlük dille:");
  await expect(dialog.locator(".term-definition")).not.toBeEmpty();
  await expect(dialog.getByRole("link", { name: "Yönetmelikte ›" })).toBeVisible();
  await expect(dialog.getByRole("link", { name: "Sözlükte ›" })).toBeVisible();
  await expect.poll(() => page.evaluate(() => !!document.activeElement?.closest("dialog")), { message: "odak pencerenin içine taşınmalı" }).toBe(true);
  await expectNoOverflow(page, "Term penceresi (360)");

  // Klavye: Esc kapatır, odak terime döner; Enter yeniden açar
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(term, "kapanınca odak terime döner").toBeFocused();
  await page.keyboard.press("Enter");
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(term).toBeFocused();

  // 'Yönetmelikte ›' yönetmelik sayfasına götürür ve pencere kapanır
  await term.click();
  await dialog.getByRole("link", { name: "Yönetmelikte ›" }).click();
  await expect(page).toHaveURL(/#\/yonetmelik/);
  await expect(page.getByRole("dialog")).toHaveCount(0);

  // 'Sözlükte ›' terimin Keşfet sözlüğündeki yerine götürür: grup açılır, ad odaklanır, ?bolum silinir
  await gotoApp(page, url);
  await paramsCard(page).getByRole("button", { name: "Onay eşiği", exact: true }).click();
  await page.getByRole("dialog", { name: "Onay eşiği", exact: true }).getByRole("link", { name: "Sözlükte ›" }).click();
  await expect(page).toHaveURL(/#\/kesfet$/);
  await expectSectionReached(page, page.locator("#terim-onay-esigi"), "Sözlükte ›");
  await expect(page.locator("#terim-onay-esigi .kesfet-term-name")).toBeVisible();
  await expect(page.locator("#terim-onay-esigi .kesfet-term-name")).toBeFocused();
  expectClean(s);
});

test("‘Karar parametreleri’: Yunan sembolü ve formül ilk okumada yok; anahtar (klavyeyle) hepsini açar; ‘Tam’ kipte açık gelir", async ({ browser }) => {
  const s = await open(browser, undefined, DESKTOP);
  const { page } = s;
  await gotoApp(page, `/oneriler/${enacted.id}?bolum=parametreler`);
  const card = paramsCard(page);
  const sw = card.getByRole("switch", { name: "Sembolleri ve formülleri göster" });
  await expect(sw).toHaveAttribute("aria-checked", "false");
  await expect(card.locator(".param-symbol"), "ilk okumada sembol yok").toHaveCount(0);
  await expect(card.locator(".param-formula"), "ilk okumada formül yok").toHaveCount(0);
  expect(await card.innerText(), "ilk okumada Yunan harfi yok").not.toMatch(GREEK);
  // Sade adlar: etiketler okunur Türkçe, sözlük terimi
  for (const label of ["Yeter sayı", "Onay eşiği", "Küme tabanı", "Gerekli destekçi"]) {
    await expect(card.getByRole("button", { name: label, exact: true }), `'${label}' sözlük terimi`).toHaveAttribute("aria-haspopup", "dialog");
  }

  await sw.focus();
  await page.keyboard.press("Space");
  await expect(sw).toHaveAttribute("aria-checked", "true");
  expect(await card.locator(".param-symbol").count(), "anahtar sembolleri açar").toBeGreaterThan(0);
  expect(await card.locator(".param-formula").count(), "anahtar formülleri açar").toBeGreaterThan(0);
  expect(await card.innerText()).toMatch(GREEK);
  await expect(sw, "odak anahtarda kalır").toBeFocused();
  await page.keyboard.press("Space");
  await expect(sw).toHaveAttribute("aria-checked", "false");
  await expect(card.locator(".param-symbol")).toHaveCount(0);

  const f = await open(browser, undefined, DESKTOP, { full: true });
  await gotoApp(f.page, `/oneriler/${enacted.id}`);
  const fcard = paramsCard(f.page);
  await expect(fcard.getByRole("switch", { name: "Sembolleri ve formülleri göster" }), "'Tam' kipte anahtar açık gelir").toHaveAttribute("aria-checked", "true");
  expect(await fcard.locator(".param-symbol").count()).toBeGreaterThan(0);
  expectClean(s, f);
});

test("Term düğmeleri (‘Tam’ görünüm): ayrılmış ad parçası yok; başlık, bağlantı, düğme, <summary>, etiket ve Uzlaşma/İtiraz panelleri içinde değil", async ({ browser }) => {
  test.setTimeout(180_000);
  const s = await open(browser, "ayse", DESKTOP, { full: true });
  const { page } = s;
  const ids = [enacted.id, voting.id, deliberation.id];
  for (const status of ["objection_window", "reconciliation", "revote", "inadmissible"] as const) {
    const p = proposals.find((x) => x.status === status);
    if (p) ids.push(p.id);
    else skipped(`tohumda '${status}' durumunda öneri yok (Term yerleşim denetimi o evre için atlandı)`);
  }
  let total = 0;
  for (const id of ids) {
    await gotoApp(page, `/oneriler/${id}`);
    const found = await page.evaluate(() =>
      Array.from(document.querySelectorAll<HTMLElement>("button.term")).map((el) => {
        const hosts: string[] = [];
        const inline = el.parentElement?.closest("h1,h2,h3,h4,h5,h6,a,button,summary,label,legend");
        if (inline) hosts.push(inline.tagName.toLowerCase());
        for (let a = el.parentElement; a; a = a.parentElement) {
          if (a.tagName !== "SECTION" || !a.getAttribute("aria-labelledby")) continue;
          const title = document.getElementById(a.getAttribute("aria-labelledby")!)?.textContent?.trim() ?? "";
          if (/Azınlık itirazı|Uzlaşma turu/.test(title)) hosts.push(`bölge:${title}`);
        }
        return { name: (el.textContent ?? "").trim(), haspopup: el.getAttribute("aria-haspopup"), hosts };
      }),
    );
    total += found.length;
    for (const t of found) {
      expect(t.haspopup, `Term '${t.name}': aria-haspopup=dialog`).toBe("dialog");
      expect(reservedParts(t.name), `Term '${t.name}': ayrılmış ad parçası içermemeli`).toEqual([]);
      expect(t.hosts, `Term '${t.name}' yasak bir kabın içinde`).toEqual([]);
    }
  }
  expect(total, "Tam kipte öneri sayfalarında Term düğmeleri bulunmalı").toBeGreaterThan(10);
  expectClean(s);
});

test("katman rozeti (T1 ve üstü): başlıktaki rozet katmanın sözlük penceresini açar", async ({ browser }) => {
  const tiered = proposals.find((p) => p.tier && p.tier !== "T0" && p.status !== "draft");
  if (!tiered) {
    skipped("tohumda T0 dışı katmanlı öneri yok");
    return;
  }
  const s = await open(browser, undefined, DESKTOP);
  const { page } = s;
  await gotoApp(page, `/oneriler/${tiered.id}`);
  const badge = page.locator(".page-meta button.term");
  await expect(badge).toHaveCount(1);
  await expect(badge).toContainText(tiered.tier!);
  await badge.click();
  const dialog = page.getByRole("dialog", { name: new RegExp(`^${tiered.tier}`) });
  await expect(dialog).toBeVisible();
  await expect(dialog.locator(".term-plain")).toContainText("Günlük dille:");
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(badge).toBeFocused();
  // Rozet bütçesi: başlıkta durum rozeti dışında renkli rozet yalnız uyarı gerektirenler için (süre uzatıldı, bütünlük uyarısı)
  const colored = await page.locator(".page-meta .badge").evaluateAll((els) => els.filter((e) => /badge-(info|success|warning|danger|accent)\b/.test(e.className)).length);
  expect(colored, "başlıkta en çok bir renkli durum rozeti + varsa uyarı rozetleri").toBeLessThanOrEqual(3);
  expectClean(s);
});

// ───────────────────────────── Faz 3: 'Keşfet ve doğrula' (/kesfet) ─────────────────────────────

/** Sayfanın bölgeleri (ui/Section ile aynı işaretleme: bölge adı = bölüm başlığı). */
const kesfetRegion = (page: Page, name: string | RegExp) => page.getByRole("region", { name, exact: typeof name === "string" });

test("Keşfet ve doğrula › Yedi bileşen: yedisi de canlı durumuyla listelenir, uyarı yalnız gerekince çıkar, mor yalnız YZ satırındadır", async ({ browser }) => {
  const { api } = ctx;
  const [sys, dash] = await Promise.all([api.system(), api.get<Dashboard>("/api/dashboard")]);
  const s = await open(browser, undefined, DESKTOP);
  const { page } = s;
  await gotoApp(page, "/kesfet");
  await expect(page.getByRole("heading", { level: 1, name: "Keşfet ve doğrula" })).toBeVisible();
  const region = kesfetRegion(page, "Yedi bileşen");
  await expect(region).toBeVisible();
  const rows = region.locator(".kesfet-ev");
  await expect(rows, "ödevin yedi bileşeni").toHaveCount(7);
  const labels = (await region.locator(".kesfet-ev-label").allInnerTexts()).map((t) => t.trim());
  expect(labels).toEqual(["Defter", "Oy doğrulama", "Bilirkişiler", "Yapay zekâ", "Graf", "Yönetmelik", "Azınlık koruması"]);
  const live = (await region.locator(".kesfet-ev-live").allInnerTexts()).map((t) => t.replace(/\s+/g, " ").trim());
  expect(live).toHaveLength(7);
  for (const [i, t] of live.entries()) expect(t.length, `${labels[i]}: canlı durum boş olmamalı`).toBeGreaterThan(8);
  await expect(region.locator(".kesfet-ev-about")).toHaveCount(7);

  // Canlı değerler sunucunun verisiyle aynı
  const ledger = /^(?:✔ |⚠ )?(?:Uyarı: )?([\d.]+)\. blok · (\d+)\/(\d+) doğrulayıcı sağlıklı$/.exec(live[0]);
  expect(ledger, `Defter satırı: '${live[0]}'`).toBeTruthy();
  expect(Number(ledger![1].replace(/\./g, "")), "blok yüksekliği sunucudakinden geri kalmaz").toBeGreaterThanOrEqual(sys.ledger.height);
  expect([Number(ledger![2]), Number(ledger![3])]).toEqual([sys.ledger.healthy, sys.ledger.validators]);
  expect(live[2]).toContain("kurayla seçilir");
  expect(live[3]).toContain(sys.aiMode === "claude" ? `Claude (${sys.aiModel})` : "Çevrimdışı sezgisel mod");
  expect(live[3]).toContain("danışma niteliğinde");
  if (dash.permanentLoser.length) expect(live[4]).toContain(`${dash.permanentLoser.length} görüş kümesi izleniyor`);
  expect(live[5]).toContain(`sürüm ${sys.bylawVersion}`);

  // Uyarı yalnız gerekince: ⚠ + 'Uyarı:' metni birlikte; sağlıksız doğrulayıcı yoksa Defter satırı uyarı taşımaz
  const warned = region.locator(".kesfet-ev.is-warning");
  for (let i = 0; i < (await warned.count()); i++) {
    await expect(warned.nth(i).locator(".sr-only")).toContainText("Uyarı:");
    await expect(warned.nth(i)).toContainText("⚠");
  }
  const unhealthy = sys.ledger.validators > sys.ledger.healthy;
  await expect(rows.nth(0), "Defter satırı yalnız sağlıksız doğrulayıcı varken uyarır").toHaveClass(unhealthy ? /is-warning/ : /^(?!.*is-warning).*$/);
  // Mor yalnız yapay zekâ
  await expect(region.locator(".is-ai")).toHaveCount(1);
  await expect(rows.nth(3).locator(".is-ai")).toHaveCount(1);
  await expectNoOverflow(page, "Keşfet (1280)");
  expectClean(s);
});

test("Keşfet ve doğrula › Yedi bileşen: her satır tek dokunuşla ilgili yere götürür", async ({ browser }) => {
  test.setTimeout(120_000);
  const { api } = ctx;
  const latest = (await api.get<Dashboard>("/api/dashboard")).recentEnacted[0];
  expect(latest, "son karar olmalı (tohum)").toBeTruthy();
  const s = await open(browser, undefined, DESKTOP);
  const { page } = s;
  const targets: { label: string; url: RegExp; reached?: (p: Page) => Promise<void> }[] = [
    { label: "Defter", url: /#\/defter(\?.*)?$/ },
    { label: "Oy doğrulama", url: /#\/oy-dogrula(\?.*)?$/ },
    { label: "Bilirkişiler", url: /#\/bilirkisiler(\?.*)?$/ },
    { label: "Yapay zekâ", url: new RegExp(`#/oneriler/${latest.id}$`), reached: (p) => expectSectionReached(p, p.locator("#yz"), "YZ satırı › #yz") },
    { label: "Graf", url: /#\/graf(\?.*)?$/ },
    { label: "Yönetmelik", url: /#\/yonetmelik(\?.*)?$/ },
    { label: "Azınlık koruması", url: /#\/graf\?sekme=istatistik$/ },
  ];
  for (const t of targets) {
    await gotoApp(page, "/kesfet");
    const row = kesfetRegion(page, "Yedi bileşen").locator(".kesfet-ev").filter({ has: page.locator(".kesfet-ev-label", { hasText: t.label }) });
    await row.getByRole("link").click();
    await expect(page, `${t.label}: adres`).toHaveURL(t.url);
    await waitSettled(page);
    await expect(page.locator("main h1").first(), `${t.label}: sayfa bulunamadı olmamalı`).not.toHaveText(/bulunamadı/i);
    if (t.reached) await t.reached(page);
  }
  expectClean(s);
});

test("Keşfet ve doğrula › Gösterim rehberi: yedi adım mevcut veriden kurulur; her adımın bağlantısı doğru yere gider; ‘Sözlükte’ terimi pencere açar", async ({ browser }) => {
  test.setTimeout(180_000);
  const { api } = ctx;
  const latest = (await api.get<Dashboard>("/api/dashboard")).recentEnacted[0];
  const bad = (await api.proposals({ status: "inadmissible", limit: "1" }))[0];
  expect(latest && bad, "tohumda kabul edilmiş ve yönetmeliğe aykırı birer öneri olmalı").toBeTruthy();
  const s = await open(browser, "ayse", DESKTOP);
  const { page } = s;

  // ?bolum=rehber: bölüm başlığına kaydırır, odak başlıkta, parametre silinir
  await gotoApp(page, "/kesfet?bolum=rehber");
  await expect(page).not.toHaveURL(/[?&]bolum=/);
  const region = kesfetRegion(page, "Gösterim rehberi");
  await expectSectionReached(page, page.locator("#rehber"), "?bolum=rehber");
  await expect(region.getByRole("heading", { level: 2, name: "Gösterim rehberi" })).toBeFocused();
  const steps = region.locator("ol.kesfet-steps > li");
  await expect(steps, "yedi adım").toHaveCount(7);
  // Sıra numarası sabit seq'e değil mevcut veriye dayanır: adım 1, 4 ve 6 gerçek önerilerin numarasını yazar
  await expect(steps.nth(0)).toContainText(`#K-${latest.seq}`);
  await expect(steps.nth(3)).toContainText(`#K-${latest.seq}`);
  await expect(steps.nth(5)).toContainText(`#K-${bad.seq}`);
  // Her adımın tek birincil bağlantısı ve bir sözlük terimi var (üyede 'Kurcalama demosu' yok)
  for (let i = 0; i < 7; i++) {
    await expect(steps.nth(i).locator("h3")).not.toBeEmpty();
    await expect(steps.nth(i).locator("a.kesfet-step-link"), `adım ${i + 1}: tek bağlantı`).toHaveCount(1);
    await expect(steps.nth(i).locator("button.term"), `adım ${i + 1}: bir sözlük terimi`).toHaveCount(1);
  }
  await expect(page.getByRole("link", { name: "Kurcalama demosu" })).toHaveCount(0);

  const cases: { title: RegExp; link: string; url: RegExp; reached: (p: Page) => Promise<void> }[] = [
    {
      title: /sayım/i,
      link: "Sayımı doğrula",
      url: new RegExp(`#/oneriler/${latest.id}$`),
      reached: async (p) => {
        await expectSectionReached(p, p.locator("#dogrula"), "adım 1 › #dogrula");
        await expect(p.getByRole("button", { name: "Sayımı kendim doğrulayayım" }), "odak doğrulama düğmesinde").toBeFocused();
      },
    },
    {
      title: /makbuz/i,
      link: "Oy doğrulamaya git",
      url: /#\/oy-dogrula$/,
      reached: async (p) => void (await expect(p.locator("main h1").first()).toBeVisible()),
    },
    {
      title: /zincir/i,
      link: "Zincir doğrulamaya git",
      url: /#\/defter\?sekme=dogrulama$/,
      reached: async (p) => void (await expect(p.getByRole("tab", { name: "Zincir doğrulama" })).toHaveAttribute("aria-selected", "true")),
    },
    {
      title: /köprü/i,
      link: "Sonuç kartına git",
      url: new RegExp(`#/oneriler/${latest.id}$`),
      reached: (p) => expectSectionReached(p, p.locator("#sonuclar"), "adım 4 › #sonuclar"),
    },
    {
      title: /kura/i,
      link: "Bilirkişilere git",
      url: /#\/bilirkisiler(\?.*)?$/,
      reached: async (p) => void (await expect(p.locator("main h1").first()).toBeVisible()),
    },
    {
      title: /ontoloji/i,
      link: "Denetim kartına git",
      url: new RegExp(`#/oneriler/${bad.id}$`),
      reached: async (p) => {
        const toggle = p.getByRole("button", { name: "Ontoloji denetimi", exact: true });
        await expect(toggle).toHaveAttribute("aria-expanded", "true");
        await expect(toggle).toBeFocused();
      },
    },
    {
      title: /kaybeden/i,
      link: "İstatistiklere git",
      url: /#\/graf\?sekme=istatistik$/,
      reached: async (p) => void (await expect(p.getByRole("tab", { name: "İstatistikler" })).toHaveAttribute("aria-selected", "true")),
    },
  ];
  for (const [i, c] of cases.entries()) {
    await gotoApp(page, "/kesfet");
    const step = kesfetRegion(page, "Gösterim rehberi").locator("ol.kesfet-steps > li").nth(i);
    await expect(step.locator("h3"), `adım ${i + 1}: başlık`).toHaveText(c.title);
    await step.getByRole("link", { name: c.link }).click();
    await expect(page, `adım ${i + 1} (${c.link}): adres`).toHaveURL(c.url);
    await waitSettled(page);
    await expect(page.locator("main h1").first(), `adım ${i + 1}: sayfa bulunamadı olmamalı`).not.toHaveText(/bulunamadı/i);
    await c.reached(page);
  }

  // 'Sözlükte: …' terimi pencere açar (ilk adım: Taahhüt); Esc kapatır
  await gotoApp(page, "/kesfet");
  const term = kesfetRegion(page, "Gösterim rehberi").locator("ol.kesfet-steps > li").nth(0).locator("button.term");
  await term.click();
  const dialog = page.getByRole("dialog", { name: "Taahhüt", exact: true });
  await expect(dialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(term).toBeFocused();
  expectClean(s);

  // Yönetici: defter adımında ek 'Kurcalama demosu' bağlantısı
  const a = await open(browser, "yonetici", DESKTOP);
  await gotoApp(a.page, "/kesfet?bolum=rehber");
  const demo = a.page.getByRole("link", { name: "Kurcalama demosu" });
  await expect(demo).toHaveCount(1);
  await expect(a.page.locator("ol.kesfet-steps > li").nth(2).getByRole("link", { name: "Kurcalama demosu" }), "ek bağlantı defter adımında").toBeVisible();
  await demo.click();
  await expect(a.page).toHaveURL(/#\/defter\?sekme=demo$/);
  await expect(a.page.getByRole("tab", { name: "Kurcalama demosu" })).toHaveAttribute("aria-selected", "true");
  expectClean(a);
});

test("Keşfet ve doğrula › erişim yolları: vitrin, masaüstü alt bilgisi ve mobil ‘Daha fazla’; üst gezinme 8 öğe kalır", async ({ browser }) => {
  // Masaüstü: Ana sayfa vitrini → ?bolum=rehber
  const d = await open(browser, "ayse", DESKTOP);
  await gotoApp(d.page, "/");
  const topNav = d.page.getByRole("navigation", { name: "Ana gezinme" });
  await expect(topNav.getByRole("link")).toHaveCount(8);
  await expect(topNav.getByRole("link", { name: /Keşfet|Gösterim|sözlük/i }), "sayfa bir gezinme öğesi değildir").toHaveCount(0);
  const showcase = d.page.getByRole("region", { name: "Neyi doğrulayabilirsiniz?" });
  await showcase.getByRole("link", { name: "Gösterim rehberi" }).click();
  await expect(d.page).toHaveURL(/#\/kesfet$/);
  await expect(d.page.getByRole("heading", { level: 1, name: "Keşfet ve doğrula" })).toBeVisible();
  await expectSectionReached(d.page, d.page.locator("#rehber"), "vitrin › Gösterim rehberi");

  // Masaüstü alt bilgisi
  await gotoApp(d.page, "/oneriler");
  await d.page.locator("footer").getByRole("link", { name: "Gösterim rehberi ve sözlük" }).click();
  await expect(d.page).toHaveURL(/#\/kesfet$/);
  await expect(d.page.getByRole("heading", { level: 1, name: "Keşfet ve doğrula" })).toBeVisible();
  expectClean(d);

  // Telefon: 'Daha fazla' › 'Keşfet ve doğrula' grubunun sonunda
  const m = await open(browser, undefined, PHONE_360);
  await gotoApp(m.page, "/oneriler");
  await m.page.getByRole("button", { name: /Daha fazla/ }).click();
  const sheet = m.page.getByRole("dialog", { name: "Daha fazla" });
  await expect(sheet).toBeVisible();
  const group = sheet.locator(".more-group").filter({ has: m.page.getByRole("heading", { level: 3, name: "Keşfet ve doğrula" }) });
  const names = (await group.locator("a.more-link").allInnerTexts()).map((t) => t.trim());
  expect(names.at(-1), `grubun sonunda (${names.join(" · ")})`).toBe("Gösterim rehberi ve sözlük");
  expect(names.slice(0, 4)).toEqual(["Bilirkişiler", "Graf", "Defter", "Yönetmelik"]);
  await expectNoOverflow(m.page, "Daha fazla (360)");
  await group.getByRole("link", { name: "Gösterim rehberi ve sözlük" }).click();
  await expect(m.page).toHaveURL(/#\/kesfet$/);
  await expect(sheet, "bağlantıya dokununca sayfa kapanır").toBeHidden();
  await expect(m.page.getByRole("heading", { level: 1, name: "Keşfet ve doğrula" })).toBeVisible();
  // Alt gezinme değişmedi: 4 sayfa + Daha fazla
  await expect(m.page.getByRole("navigation", { name: "Alt gezinme" }).getByRole("link")).toHaveCount(4);
  expectClean(m);
});

test("Keşfet ve doğrula › Temel ilkeler ve ‘Bu sayfada’: 8 ilkenin tam metni; dört bölüm kısa yolu odağı bölüm başlığına taşır", async ({ browser }) => {
  const s = await open(browser, undefined, PHONE);
  const { page } = s;
  await gotoApp(page, "/kesfet");
  const principles = kesfetRegion(page, /^Temel ilkeler \(8\)$/);
  await expect(principles).toBeVisible();
  const tenets = principles.locator("ol.kesfet-tenets > li");
  await expect(tenets).toHaveCount(8);
  for (let i = 0; i < 8; i++) {
    expect((await tenets.nth(i).locator(".kesfet-tenet-text").innerText()).length, `ilke ${i + 1}: tam metin (akordeon değil)`).toBeGreaterThan(60);
    await expect(tenets.nth(i).getByRole("link")).toHaveCount(1);
  }
  const links = await clickEveryOnThisPage(page);
  expect(links).toEqual(["Bileşenler", "Rehber", "İlkeler", "Sözlük"]);
  // Odak bölüm başlığındadır (okuma sayfası: ilk denetime atlanmaz)
  await onThisPage(page).getByRole("link", { name: "Sözlük" }).click();
  await expect(page.getByRole("heading", { level: 2, name: "Sözlük", exact: true })).toBeFocused();
  await expectNoOverflow(page, "Keşfet (375)");
  expectClean(s);
});

test("Keşfet ve doğrula › Sözlük: arama Türkçe duyarsızdır ve eşleşen konuları açar; ‘özet’ terimi aynen kalır, günlük karşılığı ‘parmak izi’; derin bağlantı terimi açar", async ({ browser }) => {
  const s = await open(browser, undefined, DESKTOP);
  const { page } = s;
  await gotoApp(page, "/kesfet");
  const gloss = kesfetRegion(page, "Sözlük");
  const status = gloss.getByRole("status");
  const groups = gloss.locator("details.kesfet-gloss-group");
  await expect(status).toHaveText(/^\d+ terim, \d+ konu\.$/);
  const nGroups = await groups.count();
  expect(nGroups).toBeGreaterThanOrEqual(5);
  await expect(gloss.locator("details.kesfet-gloss-group[open]"), "'Sade' görünümde konular kapalı").toHaveCount(0);
  const total = Number(/^(\d+) terim/.exec((await status.innerText()).trim())![1]);
  expect(total, "sözlük 25+ terim içerir").toBeGreaterThanOrEqual(25);

  // Bir konuyu açınca terimler, günlük karşılık ve tanım okunur
  await groups.first().locator("summary").click();
  await expect(groups.first()).toHaveAttribute("open", /.*/);
  await expect(groups.first().locator(".term-plain").first()).toContainText("Günlük dille:");

  const search = page.getByLabel("Sözlükte ara");
  await search.fill("köprü");
  await expect(status).toHaveText(/^\d+ terim bulundu\.$/);
  await expect(gloss.locator("dt.kesfet-term-name", { hasText: "Köprü testi" })).toBeVisible();
  await expect(gloss.locator("details.kesfet-gloss-group:not([open])"), "aramada eşleşen konuların hepsi açık").toHaveCount(0);
  await search.fill("KOPRU");
  await expect(gloss.locator("dt.kesfet-term-name", { hasText: "Köprü testi" }), "Türkçe duyarsız arama (ASCII)").toBeVisible();
  // 'özet' sözcüğü hash anlamında yeniden adlandırılmaz; günlük karşılığı 'parmak izi' sözlükte bulunur
  await search.fill("parmak izi");
  const hash = gloss.locator("dt.kesfet-term-name", { hasText: "Özet (hash)" });
  await expect(hash).toBeVisible();
  await expect(hash.locator("xpath=following-sibling::dd[1]")).toContainText("parmak izi");
  await search.fill("τ");
  await expect(gloss.locator("dt.kesfet-term-name", { hasText: "Onay eşiği" }), "sembolle arama").toBeVisible();
  await search.fill("zzzzyy");
  await expect(status).toHaveText("Eşleşen terim yok.");
  await expect(groups).toHaveCount(0);
  await search.fill("");
  await expect(status).toHaveText(/^\d+ terim, \d+ konu\.$/);
  await expect(groups).toHaveCount(nGroups);
  await expect(gloss.locator("details.kesfet-gloss-group[open]"), "arama temizlenince konular yeniden kapalı").toHaveCount(0);

  // Derin bağlantı: kapalı konudaki terimi açar, kaydırır, ada odaklanır, ?bolum silinir
  await gotoApp(page, "/kesfet?bolum=terim-kopru-testi");
  await expect(page).not.toHaveURL(/[?&]bolum=/);
  await expectSectionReached(page, page.locator("#terim-kopru-testi"), "?bolum=terim-kopru-testi");
  await expect(page.locator("#terim-kopru-testi .kesfet-term-name")).toBeFocused();
  await expect(page.locator("#terim-kopru-testi .kesfet-term-name")).toBeVisible();
  // Bilinmeyen terim çapası sessizce silinir
  await gotoApp(page, "/kesfet?bolum=terim-olmayan");
  await expect(page).not.toHaveURL(/[?&]bolum=/);
  await expect(page.getByRole("heading", { level: 1, name: "Keşfet ve doğrula" })).toBeVisible();

  // 'Tam' görünüm: bütün konular açık gelir
  const f = await open(browser, undefined, DESKTOP, { full: true });
  await gotoApp(f.page, "/kesfet");
  await expect(f.page.locator("details.kesfet-gloss-group")).toHaveCount(nGroups);
  await expect(f.page.locator("details.kesfet-gloss-group:not([open])"), "'Tam' görünümde bütün konular açık").toHaveCount(0);
  await expect(f.page.locator("main details:not([open])")).toHaveCount(0);
  expectClean(s, f);
});

test("Keşfet ve doğrula (360 px, ‘Tam’ görünüm): yatay taşma yok; Term penceresi sığar", async ({ browser }) => {
  const s = await open(browser, undefined, PHONE_360, { full: true });
  const { page } = s;
  await gotoApp(page, "/kesfet");
  await expectNoOverflow(page, "Keşfet (360, Tam)");
  await kesfetRegion(page, "Gösterim rehberi").locator("button.term").first().click();
  await expect(page.getByRole("dialog")).toBeVisible();
  await expectNoOverflow(page, "Keşfet › Term penceresi (360)");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  expectClean(s);
});

// ───────────────────────────── Faz 3: görev sayısı rozeti ve 'Sizden bekleniyor' ─────────────────────────────

/** Görev bağlantısındaki öneri kimliği ('/oneriler/<id>'). */
const taskProposalId = (t: DashboardTask): string | null => /\/oneriler\/([0-9a-f-]{36})(?:[/?#]|$)/.exec(t.link)?.[1] ?? null;

test("görev rozeti: ‘Ana sayfa’ rozeti sunucunun görev sayısıyla ve Ana sayfadaki ‘Sizi bekleyenler’ ile aynı; bağlantı adı değişmez; ziyaretçide yok", async ({ browser }) => {
  const { api } = ctx;
  const tasks = await api.get<DashboardTask[]>("/api/me/tasks", "ayse");
  const dash = (await api.get<Dashboard>("/api/dashboard", "ayse")).tasks;
  expect(tasks.length, "Ana sayfa görevleri ile /api/me/tasks aynı kuraldan gelir").toBe(dash.length);
  const n = tasks.length;
  expect(n, "ayse'nin görevi olmalı (tohum)").toBeGreaterThan(0);
  const text = n > 99 ? "99+" : String(n);

  // Masaüstü: Ana sayfaya girmeden de (Öneriler sayfasında) rozet güncel; ad 'Ana sayfa' kalır, sayı açıklamada
  const d = await open(browser, "ayse", DESKTOP);
  await gotoApp(d.page, "/oneriler");
  const topHome = d.page.getByRole("navigation", { name: "Ana gezinme" }).getByRole("link", { name: "Ana sayfa", exact: true });
  await expect(topHome.locator(".count-badge")).toHaveText(text);
  await expect(topHome.locator(".count-badge"), "rozet ekran okuyucuya ayrıca okunmaz").toHaveAttribute("aria-hidden", "true");
  await expect(topHome).toHaveAccessibleDescription(`${n} iş sizi bekliyor`);
  await expect(d.page.getByRole("link", { name: "Ana sayfa", exact: true }), "bağlantı adı rozet yüzünden değişmez").toHaveCount(1);
  // Ana sayfa özeti ve 'Sizi bekleyenler (n)' aynı sayıyı söyler
  await topHome.click();
  await expect(d.page.getByRole("heading", { level: 1, name: "Merhaba, @ayse" })).toBeVisible();
  await expect(d.page.locator(".home-summary")).toContainText(`${n} iş sizi bekliyor`);
  await expect(d.page.getByRole("region", { name: `Sizi bekleyenler (${n})`, exact: true })).toBeVisible();
  await expect(topHome.locator(".count-badge")).toHaveText(text);
  expectClean(d);

  // Telefon: alt gezinmede rozet görünür (taşmaz, kesilmez) ve aynı sayıyı yazar
  const m = await open(browser, "ayse", PHONE_360);
  await gotoApp(m.page, "/konular");
  const bottomHome = m.page.getByRole("navigation", { name: "Alt gezinme" }).getByRole("link", { name: "Ana sayfa", exact: true });
  const badge = bottomHome.locator(".count-badge");
  await expect(badge).toHaveText(text);
  await expect(badge, "rozet kesilmeden görünür").toBeVisible();
  const [bb, lb] = [(await badge.boundingBox())!, (await bottomHome.boundingBox())!];
  expect(bb.width, "rozet kesilmemiş").toBeGreaterThanOrEqual(12);
  expect(bb.x + bb.width, "rozet bağlantının içinde").toBeLessThanOrEqual(lb.x + lb.width + 1);
  await expect(bottomHome).toHaveAccessibleDescription(`${n} iş sizi bekliyor`);
  await expectNoOverflow(m.page, "alt gezinme rozeti (360)");
  expectClean(m);

  // Ziyaretçi: görev yok, rozet yok
  const v = await open(browser, undefined, DESKTOP);
  await gotoApp(v.page, "/oneriler");
  await expect(v.page.locator(".app-header .count-badge, .nav .count-badge, nav .count-badge")).toHaveCount(0);
  await expect(v.page.getByRole("navigation", { name: "Ana gezinme" }).getByRole("link", { name: "Ana sayfa", exact: true })).not.toHaveAccessibleDescription(/iş sizi bekliyor/);
  expectClean(v);
});

test("Öneriler listesi: oy bekleyen öneri kartında ‘Sizden bekleniyor’ satırı; görevi olmayan kartta ve ziyaretçide yok", async ({ browser }) => {
  const { api } = ctx;
  const tasks = await api.get<DashboardTask[]>("/api/me/tasks", "ayse");
  const vote = tasks.find((t) => t.kind === "vote" && taskProposalId(t));
  expect(vote, "ayse'nin oy görevi olmalı (tohum)").toBeTruthy();
  const votingId = taskProposalId(vote!)!;
  const s = await open(browser, "ayse", DESKTOP);
  const { page } = s;
  await gotoApp(page, "/oneriler?sekme=oylama");
  const card = page.locator("article.pcard").filter({ has: page.locator(`a[href$="/oneriler/${votingId}"]`) });
  await expect(card).toHaveCount(1);
  const expect_ = card.locator(".pcard-expect");
  await expect(expect_).toContainText("Sizden bekleniyor:");
  await expect(expect_).toContainText("Oy");
  // Düz metin (rozet değil) ve kartın açıklamasına bağlı
  await expect(expect_.locator(".badge")).toHaveCount(0);
  const describedBy = await card.getAttribute("aria-describedby");
  expect(describedBy ?? "").toContain((await expect_.getAttribute("id"))!);
  // Görevi olmayan kartlarda satır yok: satır sayısı, görevi olan öneri sayısını aşmaz
  const taskIds = new Set(tasks.map(taskProposalId).filter(Boolean));
  const cards = await page.locator("article.pcard").count();
  const lines = await page.locator("article.pcard .pcard-expect").count();
  expect(lines, `${cards} kartın ${lines} tanesinde 'Sizden bekleniyor' var (görevli öneri sayısı en çok ${taskIds.size})`).toBeLessThanOrEqual(taskIds.size);
  expect(lines).toBeGreaterThan(0);
  expectClean(s);

  const v = await open(browser, undefined, DESKTOP);
  await gotoApp(v.page, "/oneriler?sekme=oylama");
  await expect(v.page.locator("article.pcard").first()).toBeVisible();
  await expect(v.page.locator(".pcard-expect")).toHaveCount(0);
  expectClean(v);
});

// ───────────────────────────── Faz 3: Bildirimler ─────────────────────────────

test("Bildirimler: okunmamış varsa ‘Okunmamış’ açılır; tarih grupları h2; satırın tamamı bağlantı; satır başına tek ‘Okundu işaretle’ düğmesi", async ({ browser }) => {
  const { api } = ctx;
  const list = await api.get<NotificationList>("/api/me/notifications", "ayse");
  const unreadItems = list.items.filter((n) => !n.read);
  expect(unreadItems.length, "ayse'nin okunmamış bildirimi olmalı (tohum)").toBeGreaterThan(5);
  const byId = new Map(list.items.map((n) => [n.id, n]));
  const s = await open(browser, "ayse", DESKTOP);
  const { page } = s;
  await gotoApp(page, "/bildirimler");

  // Süzgeç: tek tablist 'Bildirim filtresi'; okunmamış varken 'Okunmamış' seçili açılır
  const tablists = page.locator("main [role=tablist]");
  await expect(tablists, "tarih başlıkları sekme listesi değildir").toHaveCount(1);
  await expect(tablists.first()).toHaveAccessibleName("Bildirim filtresi");
  await expect(tablists.first().getByRole("tab", { selected: true })).toHaveText(/Okunmamış/);

  // Gruplar: Bugün / Bu hafta / Daha eski sırasıyla h2; her liste kendi başlığına bağlı; satır grubu tarihle uyumlu
  const headings = page.locator("main h2.notif-group-title");
  const names = (await headings.allInnerTexts()).map((t) => t.trim());
  const order = ["Bugün", "Bu hafta", "Daha eski"];
  expect(names.length).toBeGreaterThanOrEqual(1);
  expect(names, `başlıklar sıralı alt küme olmalı (${names.join(", ")})`).toEqual(order.filter((o) => names.includes(o)));
  // Sayfa 'şimdi'yi sunucu (simüle) saatinden alır; grup sınırları da onunla hesaplanır
  const now = (await api.system()).now;
  let rows = 0;
  for (const name of names) {
    const group = page.locator(".notif-group").filter({ has: page.locator("h2", { hasText: new RegExp(`^${name}$`) }) });
    const ul = group.locator("ul.notif-list");
    await expect(ul).toHaveAttribute("aria-labelledby", /notif-grup-/);
    const ids = await ul.locator("li[data-notif-id]").evaluateAll((els) => els.map((e) => (e as HTMLElement).dataset.notifId!));
    expect(ids.length, `${name}: en az bir satır`).toBeGreaterThan(0);
    rows += ids.length;
    let prev = Number.POSITIVE_INFINITY;
    for (const id of ids) {
      const n = byId.get(id)!;
      expect(notificationGroupOf(n.createdAt, now), `'${n.title}' ${name} grubunda olmalı`).toBe(name);
      expect(n.createdAt, `${name}: en yeni önce`).toBeLessThanOrEqual(prev);
      prev = n.createdAt;
    }
  }
  expect(rows, "Okunmamış sekmesinde her okunmamış bildirim bir satırdır").toBe(unreadItems.length);

  // Satır: tek bağlantı (adı 'Git: …'), tür metni ve simge; tek düğme 'Okundu işaretle: <başlık>'
  const first = page.locator("li[data-notif-id]").first();
  const n0 = byId.get((await first.getAttribute("data-notif-id"))!)!;
  await expect(first.getByRole("link")).toHaveCount(1);
  await expect(first.getByRole("link")).toHaveAccessibleName(/^Git: /);
  await expect(first.getByRole("link")).toHaveAttribute("href", /#\/oneriler\//);
  await expect(first.getByRole("button"), "satır başına tek düğme").toHaveCount(1);
  await expect(first.getByRole("button")).toHaveAccessibleName(`Okundu işaretle: ${n0.title}`);
  await expect(first.locator(".notif-icon svg")).toHaveCount(1);
  await expect(first.locator(".sr-only", { hasText: /^(Oylama|Öneri|Tartışma|Bilirkişi|Vekâlet|Hesap|Yönetim görevi|Bildirim)\.$/ }), "sınıf metni ekran okuyucuya okunur").toHaveCount(1);
  for (const li of await page.locator("li[data-notif-id]").all()) {
    await expect(li.getByRole("button")).toHaveCount(1);
    await expect(li.getByRole("link")).toHaveCount(1);
  }
  await expect(page.getByRole("button", { name: "Tümünü okundu işaretle" })).toBeVisible();

  // 'Tümü': okunmuş satırların düğmesi yok (burada hepsi okunmamış); satır sayısı tüm bildirimler kadar
  await tablists.first().getByRole("tab", { name: /Tümü/ }).click();
  await expect(page.locator("li[data-notif-id]")).toHaveCount(list.items.length);
  await expectNoOverflow(page, "Bildirimler (1280)");
  expectClean(s);

  // Telefon: satırın tamamı dokunma hedefi, taşma yok
  const m = await open(browser, "ayse", PHONE_360);
  await gotoApp(m.page, "/bildirimler");
  const row = m.page.locator("li[data-notif-id]").first();
  const [rb, lb, bb] = [(await row.boundingBox())!, (await row.getByRole("link").boundingBox())!, (await row.getByRole("button").boundingBox())!];
  expect(lb.width, "bağlantı satırın çoğunu kaplar").toBeGreaterThan(rb.width * 0.7);
  expect(bb.width, "Okundu düğmesi dokunma hedefi (≥ 40 px)").toBeGreaterThanOrEqual(40);
  expect(bb.height).toBeGreaterThanOrEqual(40);
  await expectNoOverflow(m.page, "Bildirimler (360)");
  expectClean(m);
});

// ───────────────────────────── Faz 3: yeni öneri formu ─────────────────────────────

const NEW_TOPIC = {
  title: "Mahalle Kütüphanesinde Haftalık Ücretsiz Satranç Atölyesi",
  body:
    "Mahalle kütüphanesinin çok amaçlı salonunda her cumartesi öğleden sonra iki saatlik ücretsiz satranç atölyesi düzenlenmesini öneriyorum. " +
    "Atölye her yaştan katılımcıya açık olur, gönüllü eğitmenlerle yürütülür ve kütüphanenin mevcut masaları kullanılır; ek bütçe gerekmez.",
  category: "Kütüphane ve yaşam boyu öğrenme",
};

/** Yeni konu formunu doldurur (hiçbir şey kaydedilmez, yalnız ön denetim çalışır) ve ön denetim hükmünü bekler. */
async function fillNewTopic(page: Page): Promise<void> {
  await gotoApp(page, "/oneriler/yeni");
  await page.getByRole("radio", { name: /Yeni Konu/ }).click();
  await expect(page).toHaveURL(/tur=topic/);
  await page.getByLabel("Başlık").fill(NEW_TOPIC.title);
  await page.getByLabel("Öneri metni").fill(NEW_TOPIC.body);
  await page.getByLabel(NEW_TOPIC.category, { exact: true }).check();
  await expect(page.locator(".pre-summary")).toContainText("Yönetmeliğe uygun", { timeout: 30_000 });
}

test("yeni öneri: tür seçilince 5 radyo kompakt şeride iner; ön denetim paneli ‘önce hüküm’; ayrıntılar adlandırılmış açılırlarda", async ({ browser }) => {
  test.setTimeout(120_000);
  const s = await open(browser, "ayse", PHONE_360);
  const { page } = s;

  // Tür seçilmeden: 5 açıklamalı kart
  await gotoApp(page, "/oneriler/yeni");
  await expect(page.getByRole("radio")).toHaveCount(5);
  await expect(page.locator(".kind-picker")).not.toHaveClass(/kind-picker-compact/);
  await expect(page.locator(".kind-picker .radio-hint, .kind-picker .kind-tier").first()).toBeVisible();

  // Seçilince: radyolar DOM'da ve işaretli kalır, şerit daralır, 'Başlık' alanı hemen altında
  const radio = page.getByRole("radio", { name: /Yeni Konu/ });
  await radio.click();
  await expect(radio).toBeChecked();
  await expect(page).toHaveURL(/tur=topic/);
  await expect(page.locator(".kind-picker")).toHaveClass(/kind-picker-compact/);
  await expect(page.getByRole("radio")).toHaveCount(5);
  for (const r of await page.getByRole("radio").all()) await expect(r).toBeVisible();
  const [rBox, tBox] = [(await radio.boundingBox())!, (await page.getByLabel("Başlık").boundingBox())!];
  const gap = Math.round(tBox.y - rBox.y);
  test.info().annotations.push({ type: "ölçüm", description: `seçili radyodan 'Başlık' alanına ${gap} px (telefon 360)` });
  expect(gap, "seçili radyodan ilk alana uzaklık (önceki düzende 812 px)").toBeLessThan(600);
  // Ok tuşuyla tür değişir ve odak radyoda kalır
  await radio.focus();
  await page.keyboard.press("ArrowDown");
  await expect(page.getByRole("radio", { name: /Alt Konu/ })).toBeChecked();
  await expect(page.getByRole("radio", { name: /Alt Konu/ })).toBeFocused();
  // Uzun açıklamalar 'Türler ne demek?' açılırında (sade kipte kapalı)
  const kinds = page.locator("details", { has: page.locator("summary", { hasText: "Türler ne demek?" }) });
  await expect(kinds).not.toHaveAttribute("open", /.*/);
  await kinds.locator("summary").click();
  await expect(kinds.locator(".kind-help-item")).toHaveCount(5);
  await expectNoOverflow(page, "yeni öneri (kompakt tür, 360)");

  // Gönderim notu: tek satır + 'Gönderince ne olur?' açılırı (kapalı)
  await radio.click();
  const submitMore = page.locator("details", { has: page.locator("summary", { hasText: "Gönderince ne olur?" }) });
  await expect(submitMore).not.toHaveAttribute("open", /.*/);

  // Ön denetim paneli: hüküm → katman/destekçi satırları → açılırlar
  await page.getByLabel("Başlık").fill(NEW_TOPIC.title);
  await page.getByLabel("Öneri metni").fill(NEW_TOPIC.body);
  await page.getByLabel(NEW_TOPIC.category, { exact: true }).check();
  await expect(page.locator(".pre-summary")).toContainText("Yönetmeliğe uygun", { timeout: 30_000 });
  const aside = page.getByRole("complementary", { name: "Ön denetim" });
  const verdict = aside.getByText("Yönetmeliğe uygun görünüyor");
  await expect(verdict).toBeVisible();
  await expect(aside).toContainText("Gerekli destekçi");
  const keyRows = aside.locator(".pre-key");
  const detailsEls = aside.locator("details.pre-details");
  expect(await detailsEls.count(), "Bulgular · Karar parametreleri · YZ önerileri (+ Benzer öneriler)").toBeGreaterThanOrEqual(3);
  const [vY, kY, dY] = [(await verdict.boundingBox())!.y, (await keyRows.boundingBox())!.y, (await detailsEls.first().boundingBox())!.y];
  expect(vY, "hüküm en üstte").toBeLessThan(kY);
  expect(kY, "katman ve destekçi satırları açılırlardan önce").toBeLessThan(dY);
  const summaries = (await detailsEls.locator("> summary").allInnerTexts()).map((t) => t.replace(/\s+/g, " ").trim());
  expect(summaries[0]).toMatch(/^Bulgular \(\d+\)/);
  expect(summaries.some((t) => t.startsWith("Karar parametreleri"))).toBe(true);
  expect(summaries.some((t) => t.startsWith("YZ önerileri"))).toBe(true);
  // Sade kipte kapalı gelir (bu temiz öneride ihlal/uyarı yok, kategori seçili, benzerlik düşük); 'Tam' kipte hepsi açık
  for (const d of await detailsEls.all()) {
    const label = (await d.locator("> summary").innerText()).trim();
    if (label.startsWith("Karar parametreleri")) await expect(d, label).not.toHaveAttribute("open", /.*/);
  }
  const panelHeight = Math.round((await aside.boundingBox())!.height);
  test.info().annotations.push({ type: "ölçüm", description: `ön denetim paneli ${panelHeight} px (telefon 360, sade)` });

  // Katman rozeti ve 'Gerekli destekçi' sözlük terimidir
  const tier = aside.getByRole("button", { name: "T0", exact: true });
  await tier.click();
  const tierDialog = page.getByRole("dialog", { name: /^T0/ });
  await expect(tierDialog).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(tierDialog).toBeHidden();
  await expect(tier).toBeFocused();
  await expect(aside.getByRole("button", { name: "Gerekli destekçi", exact: true })).toHaveAttribute("aria-haspopup", "dialog");

  // Karar parametreleri açılınca sade satırlar (Yunan harfi yok), anahtar sembolleri açar
  const params = detailsEls.filter({ has: page.locator("summary", { hasText: "Karar parametreleri" }) });
  await params.locator("> summary").click();
  await expect(params).toHaveAttribute("open", /.*/);
  expect(await params.innerText(), "ön denetimde ilk okumada Yunan harfi yok").not.toMatch(GREEK);
  await params.getByRole("switch", { name: "Sembolleri ve formülleri göster" }).click();
  expect(await params.innerText()).toMatch(GREEK);
  await expectNoOverflow(page, "ön denetim paneli (360, parametreler açık)");
  expectClean(s);

  // 'Tam' kip: açılırların hepsi açık, sembol anahtarı açık
  const f = await open(browser, "ayse", DESKTOP, { full: true });
  await fillNewTopic(f.page);
  const faside = f.page.getByRole("complementary", { name: "Ön denetim" });
  await expect(faside.locator("details.pre-details").first()).toBeVisible();
  await expect(faside.locator("details:not([open])"), "'Tam' kipte ön denetim açılırlarının hepsi açık").toHaveCount(0);
  await expect(f.page.locator("details", { has: f.page.locator("summary", { hasText: "Gönderince ne olur?" }) })).toHaveAttribute("open", /.*/);
  expectClean(f);
});

test("yeni öneri: alt konu ve düzenlemede ‘Ek kategoriler (isteğe bağlı)’ kapalı başlar; yeni konuda kategori ağacı açık", async ({ browser }) => {
  const topic = (await ctx.api.get<TopicSummary[]>("/api/topics")).find((t) => t.status === "active")!.id;
  const s = await open(browser, "ayse", DESKTOP);
  const { page } = s;
  for (const tur of ["subtopic", "amendment"]) {
    await gotoApp(page, `/oneriler/yeni?tur=${tur}&konu=${topic}`);
    const extra = page.locator("details", { has: page.locator("summary", { hasText: "Ek kategoriler (isteğe bağlı)" }) });
    await expect(extra, `${tur}: ek kategoriler`).toHaveCount(1);
    await expect(extra).not.toHaveAttribute("open", /.*/);
    await extra.locator("summary").click();
    await expect(extra).toHaveAttribute("open", /.*/);
    await expect(extra.getByRole("checkbox").first()).toBeVisible();
  }
  await gotoApp(page, "/oneriler/yeni?tur=topic");
  await expect(page.locator("details", { has: page.locator("summary", { hasText: "Ek kategoriler" }) })).toHaveCount(0);
  await expect(page.getByLabel(NEW_TOPIC.category, { exact: true }), "yeni konuda kategori ağacı açık").toBeVisible();
  expectClean(s);
});

test("yeni öneri: ön denetimdeki sözlük penceresi formu terk ettirmez (bağlantılar yeni sekmede, form yerinde); ‘YZ önerileri’ ilk ‘Ekle’de kapanmaz", async ({ browser }) => {
  test.setTimeout(120_000);
  const s = await open(browser, "ayse", DESKTOP);
  const { page } = s;
  await fillNewTopic(page);
  const aside = page.getByRole("complementary", { name: "Ön denetim" });

  // Form yalnız bellekte: pencerenin iki bağlantısı da yeni sekmede açılır ve adında bunu söyler
  const term = aside.getByRole("button", { name: "Gerekli destekçi", exact: true });
  await term.click();
  const dialog = page.getByRole("dialog", { name: "Gerekli destekçi", exact: true });
  await expect(dialog).toBeVisible();
  const links = dialog.getByRole("link");
  await expect(links).toHaveCount(2);
  for (const l of await links.all()) {
    await expect(l).toHaveAttribute("target", "_blank");
    await expect(l).toContainText("(yeni sekmede açılır)");
  }
  const [tab] = await Promise.all([page.context().waitForEvent("page"), dialog.getByRole("link", { name: /^Yönetmelikte ›/ }).click()]);
  await tab.waitForLoadState();
  await expect(tab).toHaveURL(/#\/yonetmelik/);
  await tab.close();
  await expect(page, "form sayfasından ayrılınmadı").toHaveURL(/#\/oneriler\/yeni\?tur=topic/);
  await expect(page.getByLabel("Başlık")).toHaveValue(NEW_TOPIC.title);
  await expect(page.getByLabel("Öneri metni")).toHaveValue(NEW_TOPIC.body);
  await page.keyboard.press("Escape");
  await expect(dialog).toBeHidden();
  await expect(term, "kapanınca odak terime döner").toBeFocused();
  // Bulgulardaki madde atfı da (varsa) aynı kurala uyar
  for (const a of await aside.locator("a.pre-article").all()) await expect(a).toHaveAttribute("target", "_blank");

  // 'YZ önerileri': hiç kategori seçilmemişken kendiliğinden açık; ilk 'Ekle' açılırı kapatmaz ve odak body'ye düşmez
  await gotoApp(page, "/oneriler/yeni?tur=topic");
  await page.getByLabel("Başlık").fill(NEW_TOPIC.title);
  await page.getByLabel("Öneri metni").fill(NEW_TOPIC.body);
  await expect(page.locator(".pre-summary")).toContainText(/Yönetmeliğe (uygun|aykırı)/, { timeout: 30_000 });
  const ai = aside.locator("details.pre-details").filter({ has: page.locator("summary", { hasText: "YZ önerileri" }) });
  const add = ai.getByRole("button", { name: "Ekle", exact: true });
  if (!(await add.count())) {
    skipped("YZ bu metin için forma eklenebilir bir kategori önermedi");
  } else {
    await expect(ai).toHaveAttribute("open", /.*/);
    const n = await add.count();
    await add.first().click();
    await expect(ai, "ilk 'Ekle' açılırı kapatmaz").toHaveAttribute("open", /.*/);
    if (n > 1) await expect(add.first(), "odak sıradaki 'Ekle'de").toBeFocused();
    else await expect(ai.locator("> summary"), "son öneri eklenince odak açılırın başlığında").toBeFocused();
    // Ön denetim yeni kategoriyle yenilendikten sonra da açık kalır
    await expect(aside.locator(".pre-status")).toContainText("Güncel", { timeout: 30_000 });
    await expect(ai).toHaveAttribute("open", /.*/);
  }
  expectClean(s);
});

test("yeni öneri › silme talebi: ‘Tartışma silinmez’ tek cümle; kurallar canlı sayaçlı tek satır (role=status); dört kural açılırda", async ({ browser }) => {
  const s = await open(browser, "ayse", PHONE_360);
  const { page } = s;
  await gotoApp(page, `/oneriler/yeni?tur=deletion&mesaj=${threaded.messageId}`);
  await expect(page.getByRole("heading", { level: 1, name: "Yeni öneri" })).toBeVisible();
  const line = page.getByRole("status").filter({ hasText: "Kurallar ve sınırlar" });
  await expect(line).toHaveCount(1);
  await expect(line).toContainText(/Açık talepleriniz \d+\/\d+/);
  await expect(page.getByRole("alert").filter({ hasText: "Kurallar ve sınırlar" }), "role=alert yalnız acil gerekçe uyarısı içindir (kurallar satırı değil)").toHaveCount(0);
  const rules = page.locator("details", { has: page.locator("summary", { hasText: "Silme kuralları (4)" }) });
  await expect(rules).toHaveCount(1);
  const more = page.locator("details", { has: page.locator("summary", { hasText: "Karartma nasıl işler?" }) });
  await expect(more).not.toHaveAttribute("open", /.*/);
  // Sınırdan uzaktayken kurallar kapalı; açılınca dört madde okunur
  if (!(await rules.getAttribute("open"))) {
    await rules.locator("summary").click();
  }
  await expect(rules).toHaveAttribute("open", /.*/);
  await expect(rules.locator("li")).toHaveCount(4);
  await expectNoOverflow(page, "silme talebi formu (360)");
  expectClean(s);
});

// ───────────────────────────── Faz 3: Profil, Ayarlar, Konular ─────────────────────────────

/** Profilde başlığı görünür, gövdesi katlı olan kartlar (sade kipte kapalı, 'Tam' kipte açık). */
const FOLDED_PROFILE_CARDS = ["Bilirkişilik", "Takma ad değiştir", "Şifre değiştir", "Kişisel verilerim (KVKK)", "Kimlik bilgilerimi düzelt"];

test("Profil: ‘Oy hakkınız’ kartı en üstte; hesap, rızalar ve vekâletler açık; seyrek işler başlığı görünür katlı kartlarda; ?bolum= kartı açar", async ({ browser }) => {
  const s = await open(browser, "ayse", DESKTOP);
  const { page } = s;
  await gotoApp(page, "/profil");
  const main = page.locator("main");
  await expect(main.getByRole("region").first(), "ilk kart oy hakkıdır").toHaveAccessibleName("Oy hakkınız: Var");
  await expect(main.getByRole("region").first()).toContainText("Oy kullanma koşullarının üçü de tamam");
  // Açık kalan kartlar katlanamaz
  for (const name of ["Hesap özeti", "Açık rızalar", "Vekâletler"]) {
    await expect(page.getByRole("region", { name, exact: true }), name).toBeVisible();
    await expect(page.getByRole("button", { name, exact: true }), `${name}: katlanır değil`).toHaveCount(0);
  }
  // Katlı kartlar: başlık (h2) görünür, düğme aria-expanded=false, tek satırlık hüküm görünür, gövde gizli
  for (const name of FOLDED_PROFILE_CARDS) {
    const card = page.getByRole("region", { name, exact: true });
    await expect(card.getByRole("heading", { level: 2, name, exact: true }), `${name}: başlık görünür`).toBeVisible();
    const toggle = card.getByRole("button", { name, exact: true });
    await expect(toggle, `${name}: sade kipte kapalı`).toHaveAttribute("aria-expanded", "false");
    const controls = await toggle.getAttribute("aria-controls");
    expect(await page.evaluate((id) => !!document.getElementById(id!), controls), `${name}: aria-controls hedefi var`).toBe(true);
    expect((await card.locator("p.card-summary").innerText()).trim().length, `${name}: kapalı başlık hüküm verir`).toBeGreaterThan(8);
    await expect(card.locator(".card-body")).toBeHidden();
  }
  // Hüküm örnekleri: takma ad kartı mevcut takma adı ve kuralı söyler
  await expect(page.getByRole("region", { name: "Takma ad değiştir", exact: true }).locator("p.card-summary")).toContainText("@ayse");
  await expectNoOverflow(page, "Profil (1280)");

  // Derin bağlantılar: kartı açar, odak başlık düğmesinde, ?bolum silinir
  for (const [bolum, name] of [
    ["kvkk", "Kişisel verilerim (KVKK)"],
    ["duzeltme", "Kimlik bilgilerimi düzelt"],
  ] as const) {
    await gotoApp(page, `/profil?bolum=${bolum}`);
    const toggle = page.getByRole("button", { name, exact: true });
    await expect(toggle, `?bolum=${bolum}`).toHaveAttribute("aria-expanded", "true");
    await expect(toggle).toBeFocused();
    await expect(page).not.toHaveURL(/[?&]bolum=/);
    await expectSectionReached(page, page.locator(`#${bolum}`), `?bolum=${bolum}`);
  }

  // 'Tam' kip: hiçbir katlı kart kapalı kalmaz
  const f = await open(browser, "ayse", DESKTOP, { full: true });
  await gotoApp(f.page, "/profil");
  await expect(f.page.locator("button.card-toggle").first()).toBeVisible();
  await expect(f.page.locator("button.card-toggle[aria-expanded=false]"), "'Tam' kipte katlı kartlar açık").toHaveCount(0);
  expectClean(s, f);
});

test("Profil: oy hakkı yoksa eksik koşullar yazılır ve üyenin elindeki TEK eylem çıkar (rıza); bekleyen üyede yalnız durum cümlesi", async ({ browser }) => {
  const consent = await open(browser, "ozan_v", PHONE_360); // doğrulanmış, siyasi görüş rızası vermemiş
  await gotoApp(consent.page, "/profil");
  const card = consent.page.getByRole("region", { name: "Oy hakkınız: Yok", exact: true });
  await expect(card).toBeVisible();
  await expect(card).toContainText("Siyasi görüş verisine açık rıza verilmemiş");
  await expect(card.getByRole("button"), "tek eylem").toHaveCount(1);
  await expect(card.getByRole("button", { name: "Siyasi görüş rızası ver" })).toBeVisible();
  await expectNoOverflow(consent.page, "Profil › oy hakkı yok (360)");
  expectClean(consent);

  const pending = await open(browser, "berk_n", PHONE_360); // kayıt memuru onayı bekleyen üye
  await gotoApp(pending.page, "/profil");
  const pcard = pending.page.getByRole("region", { name: "Oy hakkınız: Yok", exact: true });
  await expect(pcard).toContainText("Kayıt memuru onayı bekleniyor");
  await expectNoOverflow(pending.page, "Profil › bekleyen üye (360)");
  expectClean(pending);
});

test("Ayarlar: sıra Görünüm → Sunucu → Makbuzlar → Gelişmiş; TOFU ve Ed25519 ilk okumada yok; ‘Gelişmiş’ kartları katlı; ?bolum=anahtarlar açar", async ({ browser }) => {
  const s = await open(browser, undefined, DESKTOP);
  const { page } = s;
  await gotoApp(page, "/ayarlar");
  const h2 = (await page.locator("main h2").allInnerTexts()).map((t) => t.trim());
  expect(h2).toEqual(["Görünüm", "Sunucu bağlantısı", "Bu cihazdaki oy makbuzları", "Gelişmiş"]);
  const h3 = (await page.locator("main h3").allInnerTexts()).map((t) => t.trim());
  expect(h3).toEqual(["Doğrulayıcı anahtarları", "Uygulama hakkında"]);
  // Dokunulmaz adlar: tema/yoğunluk radyoları ve bağlantı sınama (Sıfırla yalnız sabitlenmiş anahtar varken, kartın altlığında)
  await expect(page.getByRole("radio", { name: "Tam — tüm ayrıntılar açık" })).toBeVisible();
  await expect(page.getByRole("radio", { name: /^Sade/ })).toBeVisible();
  await expect(page.getByRole("button", { name: "Bağlantıyı sına" })).toBeVisible();
  // Gelişmiş kartları başlığıyla görünür, kapalı; TOFU/Ed25519 görünmez
  for (const name of ["Doğrulayıcı anahtarları", "Uygulama hakkında"]) {
    await expect(page.getByRole("button", { name, exact: true }), name).toHaveAttribute("aria-expanded", "false");
  }
  for (const hit of await page.getByText(/TOFU|Ed25519/).all()) expect(await hit.isVisible(), "TOFU/Ed25519 ilk okumada görünmemeli").toBe(false);
  // Açınca terimler Term düğmesidir
  await page.getByRole("button", { name: "Doğrulayıcı anahtarları", exact: true }).click();
  await expect(page.getByRole("button", { name: /^TOFU/ })).toBeVisible();
  await expect(page.getByRole("button", { name: /^TOFU/ })).toHaveAttribute("aria-haspopup", "dialog");

  await gotoApp(page, "/ayarlar?bolum=anahtarlar");
  const toggle = page.getByRole("button", { name: "Doğrulayıcı anahtarları", exact: true });
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await expect(toggle).toBeFocused();
  await expect(page).not.toHaveURL(/[?&]bolum=/);
  await gotoApp(page, "/ayarlar?bolum=hakkinda");
  await expect(page.getByRole("button", { name: "Uygulama hakkında", exact: true })).toHaveAttribute("aria-expanded", "true");
  await expectNoOverflow(page, "Ayarlar (1280)");

  // Telefonda ilk ekran: Görünüm ve Sunucu; Gelişmiş aşağıda
  const m = await open(browser, undefined, PHONE_360);
  await gotoApp(m.page, "/ayarlar");
  await expectNoOverflow(m.page, "Ayarlar (360)");
  const bottom = await visibleAreaBottom(m.page);
  const adv = (await m.page.getByRole("region", { name: "Gelişmiş", exact: true }).boundingBox())!;
  expect(adv.y, "Gelişmiş bölümü ilk ekranın dışında").toBeGreaterThan(bottom - 60);

  // 'Tam' kip: Gelişmiş kartları açık
  const f = await open(browser, undefined, DESKTOP, { full: true });
  await gotoApp(f.page, "/ayarlar");
  await expect(f.page.locator("button.card-toggle[aria-expanded=false]")).toHaveCount(0);
  expectClean(s, m, f);
});

test("Konular: sayaçlar tek satır; telefonda Kategori ve Arşiv ‘Süz’ açılırında, arama görünür; masaüstünde süzgeçler hep görünür", async ({ browser }) => {
  const m = await open(browser, undefined, PHONE_360);
  await gotoApp(m.page, "/konular");
  const counts = m.page.getByRole("list", { name: "Konu sayıları" });
  await expect(counts.getByRole("listitem")).toHaveCount(4);
  const heights = await counts.getByRole("listitem").evaluateAll((els) => els.map((e) => Math.round(e.getBoundingClientRect().height)));
  expect(Math.max(...heights), "sayaçlar küçük hap (eski kutular 70+ px)").toBeLessThan(60);
  const filters = m.page.getByRole("search");
  await expect(filters.getByRole("searchbox").or(filters.locator("input[type=search]")).first(), "arama kutusu görünür kalır").toBeVisible();
  const suz = filters.locator("details", { has: m.page.locator("summary", { hasText: /^Süz/ }) });
  await expect(suz).toHaveCount(1);
  await expect(suz).not.toHaveAttribute("open", /.*/);
  await suz.locator("summary").click();
  await expect(suz).toHaveAttribute("open", /.*/);
  await expect(suz.getByLabel(/Kategori/).first()).toBeVisible();
  await expectNoOverflow(m.page, "Konular (360)");
  // Adresten gelen kategori süzgeci 'Süz' açılırını açık getirir ve etkin sayıyı yazar
  const { api } = ctx;
  const topics = await api.get<TopicSummary[]>("/api/topics");
  const cat = topics.find((t) => t.categories.length)?.categories[0];
  if (cat) {
    await gotoApp(m.page, `/konular?kategori=${encodeURIComponent(cat)}`);
    const open2 = m.page.locator("details", { has: m.page.locator("summary", { hasText: /^Süz/ }) });
    await expect(open2).toHaveAttribute("open", /.*/);
    await expect(open2.locator("summary")).toContainText("1 etkin");
  }
  expectClean(m);

  const d = await open(browser, undefined, DESKTOP);
  await gotoApp(d.page, "/konular");
  await expect(d.page.locator(".list-filters details"), "masaüstünde 'Süz' açılırı yok").toHaveCount(0);
  await expect(d.page.getByLabel(/Kategori/).first()).toBeVisible();
  await expect(d.page.getByRole("button", { name: /Tümünü aç/ })).toBeVisible();
  expectClean(d);
});

test("Konu ayrıntısı (375 px): sıra metin → açık öneriler → tartışma → alt konular → sürüm geçmişi; sürüm geçmişi katlı; ?bolum= çapaları", async ({ browser }) => {
  const { api } = ctx;
  const topics = await api.get<TopicSummary[]>("/api/topics");
  const withSub = topics.find((x) => topics.some((y) => y.parentId === x.id) && x.status === "active") ?? topics[0];
  const s = await open(browser, undefined, PHONE);
  const { page } = s;
  await gotoApp(page, `/konular/${withSub.id}`);
  const region = (name: RegExp | string) => page.getByRole("region", { name, exact: typeof name === "string" });
  const ys: number[] = [];
  for (const name of ["Konu metni", /^Açık öneriler \(\d+\)$/, /^Tartışma \(\d+\)$/, /^Alt konular \(\d+\)$/, /^Sürüm geçmişi \(\d+\)$/]) {
    const box = await region(name).boundingBox();
    expect(box, String(name)).toBeTruthy();
    ys.push(box!.y);
  }
  expect(ys, "telefonda sıra: metin, açık öneriler, tartışma, alt konular, sürüm geçmişi").toEqual([...ys].sort((a, b) => a - b));
  const discussion = (await region(/^Tartışma \(\d+\)$/).boundingBox())!.y;
  const pageH = await page.evaluate(() => window.innerHeight);
  test.info().annotations.push({ type: "ölçüm", description: `tartışma ${(discussion / pageH + 1).toFixed(1).replace(".", ",")}. ekranda (375×812)` });

  // Sürüm geçmişi katlı ve kapalı başlık hüküm verir
  const versions = region(/^Sürüm geçmişi \(\d+\)$/);
  const toggle = versions.getByRole("button", { name: /^Sürüm geçmişi \(\d+\)$/ });
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(versions.locator("p.card-summary")).toContainText(/Tek sürüm|Güncel sürüm \d+/);
  // 'N alt konu' kısa yolu telefonda görünür ve Alt konular'a götürür
  const jump = page.locator(".topic-jump");
  await expect(jump).toBeVisible();
  await jump.click();
  await expect(page).not.toHaveURL(/[?&]bolum=/);
  await expectSectionReached(page, page.locator("#alt-konular"), "N alt konu");
  await expectNoOverflow(page, "Konu ayrıntısı (375)");

  // ?bolum=surumler kartı açar
  await gotoApp(page, `/konular/${withSub.id}?bolum=surumler`);
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await expect(toggle).toBeFocused();
  await expect(page).not.toHaveURL(/[?&]bolum=/);
  await gotoApp(page, `/konular/${withSub.id}?bolum=tartisma`);
  await expectSectionReached(page, page.locator("#tartisma"), "?bolum=tartisma");
  expectClean(s);

  // Masaüstü: yan sütun korunur (alt konular ve sürüm geçmişi tartışmanın sağında), kısa yol gizli
  const d = await open(browser, undefined, DESKTOP);
  await gotoApp(d.page, `/konular/${withSub.id}`);
  const dd = (await d.page.getByRole("region", { name: /^Tartışma \(\d+\)$/ }).boundingBox())!;
  const sub = (await d.page.getByRole("region", { name: /^Alt konular \(\d+\)$/ }).boundingBox())!;
  expect(sub.x, "yan sütun tartışmanın sağında").toBeGreaterThan(dd.x + dd.width - 1);
  await expect(d.page.locator(".topic-jump"), "kısa yol masaüstünde gizli").toBeHidden();
  expectClean(d);

  // 'Tam' kip: sürüm geçmişi açık
  const f = await open(browser, undefined, PHONE, { full: true });
  await gotoApp(f.page, `/konular/${withSub.id}`);
  await expect(f.page.getByRole("button", { name: /^Sürüm geçmişi \(\d+\)$/ })).toHaveAttribute("aria-expanded", "true");
  expectClean(f);
});

// ───────────────────────────── Faz 3: kontrast ve taşma (yeni ve değişen sayfalar) ─────────────────────────────

test("kontrast ve taşma (Faz 3): Keşfet, Öneriler, Konular, Bildirimler, Profil, Ayarlar, yeni öneri ve Term penceresi — açık ve iki koyu temada WCAG AA, 360 px'de taşma yok", async ({ browser }) => {
  test.setTimeout(420_000);
  const { api } = ctx;
  const topics = await api.get<TopicSummary[]>("/api/topics");
  const withSub = topics.find((x) => topics.some((y) => y.parentId === x.id)) ?? topics[0];
  const problems: string[] = [];
  const variants = [
    { name: "açık", colorScheme: "light", theme: null, dark: false },
    { name: "koyu (sistem)", colorScheme: "dark", theme: null, dark: true },
    { name: "koyu (Ayarlar)", colorScheme: "light", theme: "dark", dark: true },
  ] as const;
  for (const variant of variants) {
    // 'Tam' kip: kapalı kartlar ve açılırlar da denetlenir. Tercihler belge yüklenmeden yazılır (her gezinmede).
    const sess = await open(browser, "ayse", { ...PHONE_360, colorScheme: variant.colorScheme }, { full: true });
    if (variant.theme) await sess.context.addInitScript((t) => window.localStorage.setItem("forum.theme", t), variant.theme);
    const { page } = sess;
    const check = async (label: string, scope = "body") => {
      const tag = `[${variant.name}] ${label}`;
      const o = await measureOverflow(page);
      if (o.overflow !== 0) problems.push(`${tag}: yatay taşma ${o.overflow} px (${o.offenders.join("; ")})`);
      for (const i of await scanContrast(page, scope)) problems.push(`${tag}: ${i.element} “${i.text}” kontrast ${i.ratio} < ${i.need} (${i.fg} / ${i.bg})`);
    };
    const views: { label: string; path: string; run?: () => Promise<void> }[] = [
      { label: "Keşfet", path: "/kesfet" },
      { label: "Öneriler (görev rozeti, Sizden bekleniyor)", path: "/oneriler?sekme=oylama" },
      { label: "Konular", path: "/konular" },
      { label: "Konu ayrıntısı", path: `/konular/${withSub.id}` },
      { label: "Bildirimler", path: "/bildirimler" },
      { label: "Profil", path: "/profil" },
      { label: "Ayarlar", path: "/ayarlar" },
      { label: "Yeni öneri: silme talebi", path: `/oneriler/yeni?tur=deletion&mesaj=${threaded.messageId}` },
      {
        label: "Yeni öneri: ön denetim paneli",
        path: "/oneriler/yeni",
        run: async () => {
          await page.getByRole("radio", { name: /Yeni Konu/ }).click();
          await page.getByLabel("Başlık").fill(NEW_TOPIC.title);
          await page.getByLabel("Öneri metni").fill(NEW_TOPIC.body);
          await page.getByLabel(NEW_TOPIC.category, { exact: true }).check();
          await expect(page.locator(".pre-summary")).toContainText("Yönetmeliğe uygun", { timeout: 30_000 });
          await waitSettled(page);
        },
      },
    ];
    for (const v of views) {
      await gotoApp(page, v.path);
      if (v.run) await v.run();
      if (variant.theme === null) {
        const dark = await page.evaluate(() => document.documentElement.style.colorScheme === "dark");
        expect(dark, `[${variant.name}] ${v.label}: koyu tema durumu`).toBe(variant.dark);
      }
      await check(v.label);
      if (sess.errors.length) problems.push(`[${variant.name}] ${v.label}: ${sess.errors.splice(0).join("; ")}`);
    }
    // Term penceresi (ayrı katman): metni ve bağlantıları da AA olmalı
    await gotoApp(page, "/kesfet");
    await kesfetRegion(page, "Gösterim rehberi").locator("button.term").first().click();
    await expect(page.getByRole("dialog")).toBeVisible();
    await check("Term penceresi", "dialog[open]");
    await page.keyboard.press("Escape");
    await sess.close();
    sessions.splice(sessions.indexOf(sess), 1);
  }
  expect(problems, problems.join("\n")).toEqual([]);
});

// ───────────────────────────── Veri üreten testler (en sonda: sunucunun durumunu değiştirir) ─────────────────────────────

test("taslak (yazar, 375×812): başlıkta ilk 3 kategori ve '+n'; 'Taslak işlemlerine git' odağı gönder düğmesine taşır; 'Tam' kipte hepsi açık", async ({ browser }) => {
  const { api } = ctx;
  const cats = [...new Set(proposals.flatMap((p) => p.categories))].slice(0, 5);
  expect(cats.length, "tohumda en az 5 farklı kategori olmalı").toBe(5);
  const draft = await api.post<ProposalDetail>(
    "/api/proposals",
    {
      kind: "topic",
      title: "Sade arayüz denemesi: beş kategorili taslak",
      body: "Bu taslak yalnız arayüz testi içindir: başlıktaki kategori etiketlerinin ilk üçünün görünmesini, kalanının '+n' düğmesiyle açılmasını ve yazarın Sıradaki adım kartındaki bağlantıyla taslak işlemlerine gitmesini sınar.",
      categories: cats,
    },
    "ayse",
  );
  expect(draft.status).toBe("draft");

  const s = await open(browser, "ayse", PHONE);
  const { page } = s;
  await gotoApp(page, `/oneriler/${draft.id}`);
  const list = page.getByRole("list", { name: "Kategoriler" });
  const toggle = list.getByRole("button");
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await expect(toggle).toContainText("+2");
  await expect(list.locator("li.cat-tag:visible")).toHaveCount(3);
  const controls = await toggle.getAttribute("aria-controls");
  expect(await page.evaluate((id) => !!document.getElementById(id!), controls)).toBe(true);
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await expect(list.locator("li.cat-tag:visible")).toHaveCount(5);
  await expectNoOverflow(page, "kategoriler açık (375)");

  // Yazar: Sıradaki adım → taslak işlemleri (düğmeler 'eylem önce'), tek dokunuş
  const step = page.getByRole("region", { name: "Sıradaki adım", exact: true });
  await expect(step).toContainText("Taslak yalnız size görünür");
  await expect(step.getByRole("button")).toHaveCount(0);
  await step.getByRole("link", { name: "Taslak işlemlerine git" }).click();
  await expect(page).not.toHaveURL(/[?&]bolum=/);
  const submit = page.getByRole("button", { name: "Destekçi toplamaya gönder" });
  await expect(submit).toBeFocused();
  await waitScrollSettled(page);
  await expect(submit).toBeInViewport();
  expectClean(s);

  // 'Tam' kipte '+n' açık gelir
  const f = await open(browser, "ayse", PHONE, { full: true });
  await gotoApp(f.page, `/oneriler/${draft.id}`);
  await expect(f.page.getByRole("list", { name: "Kategoriler" }).getByRole("button")).toHaveAttribute("aria-expanded", "true");
  await expect(f.page.getByRole("list", { name: "Kategoriler" }).locator("li.cat-tag:visible")).toHaveCount(5);
  expectClean(f);
});

test("bütünlük uyarısı: başlıkta rozet, kanıt sütununda en üstte açık kart; denetçiye 'Bütünlük uyarısını incele' bağlantısı", async ({ browser }) => {
  test.setTimeout(240_000);
  const { api } = ctx;
  let warned = proposals.find((p) => p.integrityWarningCount > 0);
  if (!warned) {
    // Tohumda yok: oylamadaki öneride bir görüş bloğunun üyeleri saniyeler içinde aynı oyu verir (geçmiş oylarda da birlikte oy
    // kullandıkları için kilit adım örüntüsü sayılır), saat ilerletilir ve kesin sayımda tarama çalışır.
    for (const n of BLOCKS.A.slice(1, 15)) await api.vote(voting.id, n, "yes");
    await api.advancePastPhase(voting.id);
    const list = await api.proposals();
    warned = list.find((p) => p.id === voting.id && p.integrityWarningCount > 0);
  }
  if (!warned) {
    skipped("bütünlük uyarısı üretilemedi (kilit adım örüntüsü oluşmadı); uyarı kuralı sunucu ve birim testlerinde");
    return;
  }
  const s = await open(browser, "denetci", DESKTOP);
  const { page } = s;
  await gotoApp(page, `/oneriler/${warned.id}`);
  await expect(page.locator(".page-meta")).toContainText(/Bütünlük uyarısı \(\d+\)/);
  const aside = page.locator("aside#kanitlar");
  await expect(aside.locator("h3").first()).toContainText("Bütünlük uyarıları");
  const toggle = aside.getByRole("button", { name: /^Bütünlük uyarıları/ });
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  const link = page.getByRole("region", { name: "Sıradaki adım", exact: true }).getByRole("link", { name: "Bütünlük uyarısını incele" });
  await expect(link).toBeVisible();
  await toggle.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "false");
  await link.click();
  await expect(toggle).toHaveAttribute("aria-expanded", "true");
  await expect(toggle).toBeFocused();

  // Herkese açık görünümde uyarı var ama üye takma adları yok (yalnız denetçi ve yönetici görür)
  const v = await open(browser, undefined, DESKTOP);
  await gotoApp(v.page, `/oneriler/${warned.id}`);
  await expect(v.page.locator(".page-meta")).toContainText(/Bütünlük uyarısı \(\d+\)/);
  await expect(v.page.locator("aside#kanitlar h3").first()).toContainText("Bütünlük uyarıları");
  await expect(v.page.getByRole("region", { name: "Sıradaki adım", exact: true }).getByRole("link", { name: "Bütünlük uyarısını incele" })).toHaveCount(0);
  expectClean(s, v);
});

// ───────────────────────────── Faz 3: veri üreten testler (en sonda) ─────────────────────────────

test("görev rozeti güncellenir: sunucuda bir iş tamamlanınca rozet, Ana sayfaya girmeden, sayfa gezinince yenilenir", async ({ browser }) => {
  test.setTimeout(120_000);
  const { api } = ctx;
  const before = await api.get<DashboardTask[]>("/api/me/tasks", "ayse");
  // Tamamlanabilir görev: önce destek, sonra oy (evreler önceki testlerde ilerlemiş olabilir)
  const candidates = [...before.filter((t) => t.kind === "sponsor"), ...before.filter((t) => t.kind === "vote")].filter((t) => taskProposalId(t));
  if (!candidates.length) {
    skipped("ayse'nin tamamlanabilir (destek ya da oy) görevi kalmadı");
    return;
  }
  const s = await open(browser, "ayse", DESKTOP);
  const { page } = s;
  await gotoApp(page, "/konular");
  const nav = page.getByRole("navigation", { name: "Ana gezinme" });
  const badge = nav.getByRole("link", { name: "Ana sayfa", exact: true }).locator(".count-badge");
  await expect(badge).toHaveText(String(before.length));

  let done = false;
  for (const t of candidates) {
    const id = taskProposalId(t)!;
    try {
      if (t.kind === "sponsor") await api.sponsor(id, "ayse");
      else await api.vote(id, "ayse", "yes");
      done = true;
      break;
    } catch {
      /* bu görev artık tamamlanamıyor (evre değişti); sıradakini dene */
    }
  }
  if (!done) {
    skipped("hiçbir görev API ile tamamlanamadı");
    expectClean(s);
    return;
  }
  const after = (await api.get<DashboardTask[]>("/api/me/tasks", "ayse")).length;
  expect(after, "iş tamamlanınca sunucudaki görev sayısı azalır").toBeLessThan(before.length);

  // Sayfa gezindikçe (veri 10 sn'den eskiyse) rozet yenilenir; Ana sayfaya girilmez
  const pages = ["Öneriler", "Konular"];
  let i = 0;
  await expect
    .poll(
      async () => {
        await nav.getByRole("link", { name: pages[i++ % 2], exact: true }).click();
        await waitSettled(page);
        return (await badge.count()) ? ((await badge.innerText()).trim() || "0") : "0";
      },
      { timeout: 60_000, intervals: [2_000], message: "rozet sunucudaki görev sayısına inmeli" },
    )
    .toBe(String(after));
  expectClean(s);
});

test("görev rozeti Ana sayfa listesiyle eşitlenir: iş tamamlanıp hemen Ana sayfaya dönülünce rozet ‘Sizi bekleyenler’ ile aynı sayıyı yazar (yoklamayı beklemez)", async ({ browser }) => {
  test.setTimeout(120_000);
  const { api } = ctx;
  // Tamamlanabilir (destek ya da oy) görevi olan bir üye: ayse'nin görevleri yukarıdaki testlerde tükenmiş olabilir
  let member: string | null = null;
  let before: DashboardTask[] = [];
  let candidates: DashboardTask[] = [];
  for (const nick of [...BLOCKS.B, ...BLOCKS.C, ...BLOCKS.A.filter((n) => n !== "ayse")]) {
    const list = await api.get<DashboardTask[]>("/api/me/tasks", nick);
    const c = [...list.filter((t) => t.kind === "sponsor"), ...list.filter((t) => t.kind === "vote")].filter((t) => taskProposalId(t));
    if (c.length) {
      [member, before, candidates] = [nick, list, c];
      break;
    }
  }
  if (!member) {
    skipped("tamamlanabilir görevi olan üye kalmadı");
    return;
  }
  const badgeText = (n: number) => (n > 99 ? "99+" : String(n));
  const s = await open(browser, member, DESKTOP);
  const { page } = s;
  await gotoApp(page, "/konular");
  const home = page.getByRole("navigation", { name: "Ana gezinme" }).getByRole("link", { name: "Ana sayfa", exact: true });
  const badge = home.locator(".count-badge");
  await expect(badge).toHaveText(badgeText(before.length));

  let done = false;
  for (const t of candidates) {
    const id = taskProposalId(t)!;
    try {
      if (t.kind === "sponsor") await api.sponsor(id, member);
      else await api.vote(id, member, "yes");
      done = true;
      break;
    } catch {
      /* bu görev artık tamamlanamıyor (evre değişti); sıradakini dene */
    }
  }
  if (!done) {
    skipped("hiçbir görev API ile tamamlanamadı");
    expectClean(s);
    return;
  }
  const after = (await api.get<DashboardTask[]>("/api/me/tasks", member)).length;
  expect(after).toBeLessThan(before.length);

  // Ana sayfa panoyu yükler; görev deposu onunla eşitlenir (sayfa değişimi yenilemesi veri tazeyken çalışmaz, yoklama 60 sn'dedir)
  await home.click();
  await expect(page.getByRole("heading", { level: 1, name: `Merhaba, @${member}` })).toBeVisible();
  if (after) await expect(page.getByRole("region", { name: `Sizi bekleyenler (${after})`, exact: true })).toBeVisible();
  await expect
    .poll(async () => ((await badge.count()) ? (await badge.innerText()).trim() : "0"), { timeout: 8_000, message: "rozet Ana sayfa listesiyle aynı" })
    .toBe(after ? badgeText(after) : "0");
  expectClean(s);
});

test("Bildirimler: ‘Okundu işaretle’ satırı süzgeçten çıkarır ve odağı sıradaki satırın düğmesine taşır; satır bağlantısı okundu işaretler ve gezindirir; ‘Tümünü okundu işaretle’", async ({ browser }) => {
  test.setTimeout(120_000);
  const { api } = ctx;
  const before = await api.get<NotificationList>("/api/me/notifications", "ayse");
  const byId = new Map(before.items.map((n) => [n.id, n]));
  const s = await open(browser, "ayse", DESKTOP);
  const { page } = s;
  await gotoApp(page, "/bildirimler");
  const rows = page.locator("li[data-notif-id]");
  const ids = await rows.evaluateAll((els) => els.slice(0, 3).map((e) => (e as HTMLElement).dataset.notifId!));
  const [firstId, secondId, thirdId] = ids;
  const row = (id: string) => page.locator(`li[data-notif-id="${id}"]`);

  // 1) Düğme: satır 'Okunmamış' süzgecinden çıkar, odak sıradaki satırın düğmesine geçer, çandaki sayı bir azalır
  await row(firstId).getByRole("button", { name: `Okundu işaretle: ${byId.get(firstId)!.title}` }).click();
  await expect(row(firstId)).toHaveCount(0);
  await expect(row(secondId).locator("button.notif-read"), "odak sıradaki satırın düğmesinde").toBeFocused();
  await expect(page.getByRole("link", { name: `Bildirimler (${before.unread - 1} okunmamış)` })).toBeVisible();
  expect((await api.get<NotificationList>("/api/me/notifications", "ayse")).items.find((n) => n.id === firstId)!.read).toBe(true);

  // 2) Satır bağlantısı: tıklayınca okundu işaretler ve bağlantıya gider
  const link = row(secondId).locator("a.notif-content");
  const href = (await link.getAttribute("href"))!;
  await link.click();
  await expect(page).toHaveURL(new RegExp(href.replace(/[.*+?^${}()|[\]\\]/g, "\\$&") + "$"));
  await waitSettled(page);
  await expect.poll(async () => (await api.get<NotificationList>("/api/me/notifications", "ayse")).items.find((n) => n.id === secondId)!.read).toBe(true);

  // 'Tümü': okunmuş satırların düğmesi yok ve ‘Okundu.’ okunur; okunmamışın düğmesi var
  await gotoApp(page, "/bildirimler");
  await page.locator("main [role=tablist]").first().getByRole("tab", { name: /Tümü/ }).click();
  await expect(row(firstId).getByRole("button")).toHaveCount(0);
  await expect(row(firstId).locator(".sr-only", { hasText: "Okundu." })).toHaveCount(1);
  await expect(row(thirdId).getByRole("button")).toHaveCount(1);

  // 3) Tümünü okundu işaretle: başka bir üyede (ayse'nin kalan bildirimleri bozulmasın)
  const other = await open(browser, "deniz_k", DESKTOP);
  await gotoApp(other.page, "/bildirimler");
  await other.page.getByRole("button", { name: "Tümünü okundu işaretle" }).click();
  await expectToast(other.page, "Tüm bildirimler okundu olarak işaretlendi.");
  await expect(other.page.getByRole("button", { name: "Tümünü okundu işaretle" })).toHaveCount(0);
  expect((await api.get<NotificationList>("/api/me/notifications", "deniz_k")).unread).toBe(0);
  await other.page.locator("main [role=tablist]").first().getByRole("tab", { name: /Okunmamış/ }).click();
  await expect(other.page.getByText("Okunmamış bildiriminiz yok")).toBeVisible();
  // Okunmamışı kalmayan üyede sayfa 'Tümü' ile açılır (boş bir 'Okunmamış' sekmesiyle değil)
  await gotoApp(other.page, "/bildirimler");
  await expect(other.page.locator("main [role=tablist]").first().getByRole("tab", { selected: true })).toHaveText(/Tümü/);
  await expect(other.page.locator("li[data-notif-id]").first()).toBeVisible();
  await expect(other.page.locator("li[data-notif-id] button.notif-read"), "okunmuş satırlarda düğme yok").toHaveCount(0);
  expectClean(s, other);
});
