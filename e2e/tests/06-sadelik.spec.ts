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
import { expect, test, type Browser, type BrowserContextOptions, type Page } from "@playwright/test";
import type { Dashboard, ProposalDetail, ProposalSummary, ThreadResponse } from "@forum/shared";
import { BLOCKS } from "../support/env";
import { useSeededServer } from "../support/fixtures";
import { clickEveryOnThisPage, describeMetrics, expectSectionReached, measurePage, onThisPage, scanContrast, visibleAreaBottom, waitScrollSettled } from "../support/sade";
import { gotoApp, measureOverflow, openSession, type Session } from "../support/ui";

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
  test.setTimeout(180_000);
  const views: { label: string; as?: string; options: BrowserContextOptions; path: string; full?: boolean }[] = [
    { label: "Ana sayfa · üye (ayse) · telefon 375×812", as: "ayse", options: PHONE, path: "/" },
    { label: "Ana sayfa · ziyaretçi · telefon 375×812", options: PHONE, path: "/" },
    { label: "Ana sayfa · üye (ayse) · masaüstü 1280×860", as: "ayse", options: DESKTOP, path: "/" },
    { label: `Öneri #K-${enacted.seq} (kabul, bilirkişili) · telefon 375×812`, options: PHONE, path: `/oneriler/${enacted.id}` },
    { label: `Öneri #K-${enacted.seq} (kabul, bilirkişili) · masaüstü 1280×860`, options: DESKTOP, path: `/oneriler/${enacted.id}` },
    { label: `Öneri #K-${enacted.seq} (kabul) · telefon 375×812 · Tam`, options: PHONE, path: `/oneriler/${enacted.id}`, full: true },
    { label: `Öneri #K-${voting.seq} (oylama, ayse) · telefon 375×812`, as: "ayse", options: PHONE, path: `/oneriler/${voting.id}` },
    { label: `Öneri #K-${deliberation.seq} (tartışma) · telefon 375×812`, options: PHONE, path: `/oneriler/${deliberation.id}` },
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
