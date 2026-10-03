// Ana sayfa parçaları: sayaç haplarının bağlantıları ve sayıları, azınlık koruması hükmü ve açılış durumu, ilke akordeonu,
// vitrin karoları; Faz 2'de selam ve özet satırı, 'Sizi bekleyenler', rol ipucu, hızlı eylemler, oy hakkı notu ('Notu gizle',
// forum.dismissed), 'Şu an açık', 'Son kararlar', hesap durumu kartı ve öneri satırı (ProposalRow). Sunucu tarafı çizimle
// denetlenir (DOM gerekmez). Yeni düğme/bağlantı adları e2e'nin aradığı adlarla çakışmamalıdır (alt dize, büyük/küçük harf duyarsız).
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { PROPOSAL_KIND_LABELS, type Dashboard, type DashboardTask, type Me, type ProposalStatus, type ProposalSummary, type SystemInfo } from "@forum/shared";
import { beforeEach, describe, expect, it } from "vitest";
import { DetailLevelProvider } from "../../lib/detailLevel";
import { addDismissed, getDismissed, getDismissedSync, MAX_DISMISSED, parseDismissed, PREF_KEYS, removePref, setPrefSync } from "../../lib/prefs";
import { ProposalRow, ProposalRowList, proposalRowSpec } from "../proposals/ProposalCard";
import { AccountStatus } from "./AccountStatus";
import { CountPills, countPillSpecs } from "./CountPills";
import { Greeting, greetingSummary, VISITOR_SLOGAN, WHY_REGISTER } from "./Greeting";
import { HomeLayout, type HomeLayoutProps, type HomePermission } from "./HomeLayout";
import { MinorityProtection, minorityVerdict } from "./MinorityProtection";
import { OPEN_ALL_HREF, OPEN_ROWS, OpenNow, openCount } from "./OpenNow";
import { PRINCIPLES, PrinciplesAccordion } from "./PrinciplesAccordion";
import { QuickActions, quickActionSpecs, type QuickActionsInput } from "./QuickActions";
import { RecentDecisions } from "./RecentDecisions";
import { SetupNotes, setupNotes } from "./SetupNotes";
import { scaleText, ShowcaseTiles, showcaseTiles } from "./ShowcaseTiles";
import { RoleHint, roleHint, TASK_META, TaskList, taskHref, TASKS_SHOWN } from "./TaskList";

const render = (el: React.ReactElement) => renderToStaticMarkup(<MemoryRouter>{el}</MemoryRouter>);

/** Bir HTML parçasındaki bağlantı/özet/düğme görünür adları (etiketler atılmış). */
function namesOf(html: string, tag: "a" | "summary" | "button"): string[] {
  return [...html.matchAll(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "g"))].map((m) => m[1].replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim());
}

// e2e/tests/*.spec.ts'in düğme/bağlantı/bölge adı olarak aradığı dizeler: yeni adlar bunları içermemeli.
const RESERVED = ["destekle", "oyumu ver", "daha fazla", "sayımı kendim doğrulayayım", "kapat"];
const clean = (names: string[]) => names.filter((n) => RESERVED.some((r) => n.toLowerCase().includes(r)));

const counts = (over: Partial<Dashboard["counts"]> = {}): Dashboard["counts"] => ({
  draft: 0,
  sponsoring: 0,
  inadmissible: 0,
  deliberation: 0,
  voting: 0,
  objection_window: 0,
  reconciliation: 0,
  revote: 0,
  enacted: 0,
  rejected: 0,
  withdrawn: 0,
  expired: 0,
  ...over,
});

const system = (over: Partial<SystemInfo> = {}): SystemInfo => ({
  version: "1.4.0",
  now: Date.UTC(2026, 9, 2, 12, 0),
  clockOffsetMs: 0,
  timeScale: 10,
  aiMode: "offline",
  aiModel: "claude-x",
  ledger: { height: 345, validators: 4, healthy: 4 },
  bylawVersion: 2,
  members: { verified: 57, pending: 3 },
  ...over,
});

describe("CountPills", () => {
  it("panonun dokuz sayısı ve eski ?sekme= bağlantıları aynen durur", () => {
    const specs = countPillSpecs({
      counts: counts({ sponsoring: 1, deliberation: 2, voting: 2, revote: 1, objection_window: 1, reconciliation: 2, enacted: 21, rejected: 6, inadmissible: 3 }),
      topics: 17,
    });
    expect(specs.map((s) => [s.label, s.count, s.to])).toEqual([
      ["Açık öneri", 9, "/oneriler"],
      ["Destek bekleyen", 1, "/oneriler?sekme=destek"],
      ["Tartışmada", 2, "/oneriler?sekme=tartisma"],
      ["Oylamada", 3, "/oneriler?sekme=oylama"],
      ["İtiraz ve uzlaşma", 3, "/oneriler?sekme=itiraz"],
      ["Kabul", 21, "/oneriler?sekme=kabul"],
      ["Red/aykırı", 9, "/oneriler?sekme=red"],
      ["Yürürlükteki konu", 17, "/konular"],
    ]);
  });

  it("sıfır hap soluk (is-zero) ama bağlantı olarak görünür; dolu hap değil", () => {
    const html = render(<CountPills dashboard={{ counts: counts({ enacted: 5 }), topics: 0 }} />);
    expect(html.match(/<a /g)).toHaveLength(8);
    expect(html.match(/is-zero/g)).toHaveLength(7);
    expect(html).toContain('class="count-pill count-pill-success" title="Kabul edilen öneriler" href="/oneriler?sekme=kabul"');
    expect(html).toContain('aria-label="Öneri ve konu sayıları"');
  });

  it("bağlantı adları ayrılmış e2e adlarıyla çakışmaz", () => {
    expect(clean(namesOf(render(<CountPills dashboard={{ counts: counts(), topics: 1 }} />), "a"))).toEqual([]);
  });
});

describe("MinorityProtection", () => {
  const item = (clusterId: string, lostShare: number, decisions: number) => ({ clusterId, label: `Küme ${clusterId}`, lostShare, decisions });

  beforeEach(async () => {
    await removePref(PREF_KEYS.detail);
  });

  it("hüküm: yeterli karar yok / kaybeden yok / uyarı (tekil ve çoğul)", () => {
    expect(minorityVerdict([])).toMatchObject({ tone: "pending", text: "Henüz yeterli karar yok" });
    expect(minorityVerdict([item("a", 0.9, 2)])).toMatchObject({ tone: "pending", text: "Henüz yeterli karar yok" });
    expect(minorityVerdict([item("a", 0.2, 10), item("b", 0.4, 10), item("c", 0.1, 1)])).toMatchObject({
      tone: "ok",
      text: "✔ Kalıcı kaybeden küme yok · 3 küme izleniyor",
    });
    expect(minorityVerdict([item("a", 0.8, 10), item("b", 0.4, 10)])).toMatchObject({ tone: "warning", warnCount: 1, text: "⚠ Bir görüş kümesi kararların çoğunda kaybediyor" });
    expect(minorityVerdict([item("a", 0.8, 10), item("b", 0.9, 5)])).toMatchObject({ tone: "warning", warnCount: 2, text: "⚠ 2 görüş kümesi kararların çoğunda kaybediyor" });
  });

  it("olağan durumda 'sade' kipte kapalı: hüküm kapalı özette görünür, ayrıntı DOM'da", () => {
    const html = render(<MinorityProtection items={[item("a", 0.2, 10)]} />);
    expect(html).toContain('<details class="details minority" id="azinlik">');
    expect(html).toContain('<span class="details-summary-text">Azınlık koruması</span>');
    expect(html).toContain('<span class="minority-verdict minority-verdict-ok">✔ Kalıcı kaybeden küme yok · 1 küme izleniyor</span>');
    expect(html).not.toContain("minority-warn");
    expect(html).not.toContain("<details class=\"details minority\" id=\"azinlik\" open");
    // Bugünkü çubuklar, eşik ve graf bağlantısı hâlâ içeride
    expect(html).toContain('role="progressbar"');
    expect(html).toContain("Uyarı eşiği");
    expect(html).toContain('href="/graf"');
  });

  it("uyarıda kendiliğinden açık ve uyarı tonunda gelir; 'Tam' kipte olağan durum da açık", () => {
    const warn = render(<MinorityProtection items={[item("a", 0.8, 10)]} />);
    expect(warn).toContain('class="details minority minority-warn"');
    expect(warn).toMatch(/<details[^>]*id="azinlik"[^>]*\bopen=""/);
    expect(warn).toContain('<span class="minority-verdict minority-verdict-warning">⚠ Bir görüş kümesi');
    expect(warn).toContain('role="alert"');

    setPrefSync(PREF_KEYS.detail, "tam");
    const full = render(
      <DetailLevelProvider>
        <MinorityProtection items={[item("a", 0.2, 10)]} />
      </DetailLevelProvider>,
    );
    expect(full).toMatch(/<details[^>]*id="azinlik"[^>]*\bopen=""/);
  });

  it("kümesiz durumda eski boş durum metni korunur", () => {
    expect(render(<MinorityProtection items={[]} />)).toContain("Henüz görüş kümesi oluşmadı ya da sonuçlanan karar yok.");
  });

  it("özet ve bağlantı adları ayrılmış e2e adlarıyla çakışmaz", () => {
    const html = render(<MinorityProtection items={[item("a", 0.8, 10)]} />);
    expect(clean([...namesOf(html, "a"), ...namesOf(html, "summary")])).toEqual([]);
  });
});

describe("PrinciplesAccordion", () => {
  beforeEach(async () => {
    await removePref(PREF_KEYS.detail);
  });

  it("8 ilke: başlık görünür, metin ve bağlantı DOM'da; sade kipte hepsi kapalı", () => {
    const html = render(<PrinciplesAccordion />);
    expect(PRINCIPLES).toHaveLength(8);
    expect(html).toContain("Sistem nasıl çalışır? (8 temel ilke)");
    expect(html.match(/<details /g)).toHaveLength(8);
    expect(html).not.toMatch(/<details[^>]*\bopen=""/);
    expect(namesOf(html, "summary")).toEqual(PRINCIPLES.map((p) => p.title));
    expect(namesOf(html, "a")).toEqual(PRINCIPLES.map((p) => p.link));
    for (const p of PRINCIPLES) expect(html).toContain(p.text.replace(/'/g, "&#x27;"));
    // Eski derin bağlantılar aynen
    expect(html).toContain('href="/oneriler?sekme=itiraz"');
    expect(html).toContain('href="/oneriler?sekme=tumu&amp;tur=deletion"');
    expect(html).toContain('href="/oy-dogrula"');
    expect(html).toContain('href="/profil"');
  });

  it("'Tam' kipte 8 ilkenin hepsi açık gelir", () => {
    setPrefSync(PREF_KEYS.detail, "tam");
    const html = render(
      <DetailLevelProvider>
        <PrinciplesAccordion />
      </DetailLevelProvider>,
    );
    expect(html.match(/<details[^>]*\bopen=""/g)).toHaveLength(8);
  });

  it("özet ve bağlantı adları ayrılmış e2e adlarıyla çakışmaz", () => {
    const html = render(<PrinciplesAccordion />);
    expect(clean([...namesOf(html, "a"), ...namesOf(html, "summary")])).toEqual([]);
  });
});

describe("ShowcaseTiles", () => {
  it("zaman ölçeği metni", () => {
    expect(scaleText(1)).toBe("gerçek zamanlı");
    expect(scaleText(0)).toBe("gerçek zamanlı");
    expect(scaleText(10)).toBe("demo: 1 saat = 6 dakika");
    expect(scaleText(2.5)).toBe("demo: 1 saat = 24 dakika");
    expect(scaleText(600)).toBe("demo: 1 saat = 6 saniye");
  });

  it("6 karo, plandaki sırayla; yalnız yapay zekâ karosu bağlantı değildir", () => {
    const tiles = showcaseTiles(system());
    expect(tiles.map((t) => t.label)).toEqual(["Defter", "Oy doğrulama", "Bilirkişiler", "Yapay zekâ", "Graf", "Yönetmelik"]);
    expect(tiles.filter((t) => !t.to).map((t) => t.key)).toEqual(["yz"]);
    const html = render(<ShowcaseTiles system={system()} />);
    expect(html.match(/<li>/g)).toHaveLength(6);
    // Başlığın yanında 'Gösterim rehberi ›' (Faz 3: Keşfet ve doğrula), ardından beş karo bağlantısı
    expect(namesOf(html, "a").map((n) => n.split(" ")[0])).toEqual(["Gösterim", "Defter", "Oy", "Bilirkişiler", "Graf", "Yönetmelik"]);
    expect(html).toContain('href="/kesfet?bolum=rehber"');
    expect(html).toContain("345. blok");
    expect(html).toContain("4/4 doğrulayıcı sağlıklı");
    expect(html).toContain("sürüm 2");
    expect(html).toContain("Çevrimdışı");
    expect(html).toContain("kural tabanlı sezgisel mod · danışma niteliğinde");
  });

  it("Claude kipinde model adı görünür", () => {
    const html = render(<ShowcaseTiles system={system({ aiMode: "claude", aiModel: "claude-sonnet" })} />);
    expect(html).toContain("claude-sonnet · danışma niteliğinde");
  });

  it("sağlıksız doğrulayıcıda uyarı simgesi ve metni (yalnız renk değil)", () => {
    const html = render(<ShowcaseTiles system={system({ ledger: { height: 9, validators: 4, healthy: 3 } })} />);
    expect(html).toContain('<span class="showcase-warn"><span aria-hidden="true">⚠ </span><span class="sr-only">Uyarı: </span>3/4 doğrulayıcı sağlıklı</span>');
  });

  it("alt satır: simüle saat, ölçek, ileri alma, üye sayıları ve sürüm", () => {
    const html = render(<ShowcaseTiles system={system({ clockOffsetMs: 3 * 86_400_000 })} />);
    expect(html).toContain("Simüle saat <time");
    expect(html).toContain("(demo: 1 saat = 6 dakika; yönetici 3 gün ileri aldı)");
    expect(html).toContain("57 doğrulanmış, 3 bekleyen üye");
    expect(html).toContain("v1.4.0");
  });

  it("sistem bilgisi yokken karolar yine çizilir, defter özeti panodan gelir, 'Yenile' çıkar", () => {
    const html = render(<ShowcaseTiles system={null} dashboard={{ ledger: { height: 7, validators: 4, healthy: 4 }, members: { verified: 5, pending: 1 } }} onRetry={() => undefined} />);
    expect(html.match(/<li>/g)).toHaveLength(6);
    expect(html).toContain("7. blok");
    expect(html).toContain("Sistem bilgisi alınamadı. 5 doğrulanmış, 1 bekleyen üye.");
    expect(html).toContain("Yenile");
  });

  it("bağlantı adları ayrılmış e2e adlarıyla çakışmaz", () => {
    const html = render(<ShowcaseTiles system={system()} onRetry={() => undefined} />);
    expect(clean(namesOf(html, "a"))).toEqual([]);
    expect(html.toLowerCase()).not.toContain("daha fazla");
  });
});

// ───────────── Faz 2: role göre 'senden beklenenler' ─────────────

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

const task = (over: Partial<DashboardTask> = {}): DashboardTask => ({
  kind: "vote",
  title: "#K-31 “Kütüphane” için oy verin",
  link: "/oneriler/p1",
  dueAt: Date.UTC(2099, 0, 1),
  ...over,
});

/** Tüm ad türleri (bağlantı, düğme, özet) ve aria-label değerleri (region/grup/liste adları) birlikte. */
const allNames = (html: string) => [
  ...namesOf(html, "a"),
  ...namesOf(html, "button"),
  ...namesOf(html, "summary"),
  ...[...html.matchAll(/aria-label="([^"]*)"/g)].map((m) => m[1]),
];

describe("Greeting", () => {
  it("canlı özet: iş sayısı · oylamadaki / açık öneri", () => {
    expect(greetingSummary({ tasks: 2, voting: 3, open: 6 })).toBe("2 iş sizi bekliyor · 3 öneri oylamada");
    expect(greetingSummary({ tasks: 0, voting: 0, open: 0 })).toBe("Bekleyen işiniz yok · şu an açık öneri yok");
    expect(greetingSummary({ tasks: 0, voting: 0, open: 4 })).toBe("Bekleyen işiniz yok · 4 açık öneri");
    expect(greetingSummary({ tasks: 1, voting: 0, open: 0 })).toBe("1 iş sizi bekliyor · şu an açık öneri yok");
  });

  it("ziyaretçi: başlık, en çok 14 kelimelik slogan, giriş/kayıt bağlantıları, 'Neden kayıt gerekir?' (bugünkü metin içeride)", () => {
    expect(VISITOR_SLOGAN.split(/\s+/).length).toBeLessThanOrEqual(14);
    const html = render(<Greeting user={null} />);
    expect(html).toContain('<h1 class="page-title">Forum Sistemi</h1>');
    expect(html).toContain(VISITOR_SLOGAN);
    expect(namesOf(html, "a")).toEqual(["Giriş yap", "Kayıt ol"]);
    // İlk ekranda tek birincil eylem: dolu 'Giriş yap' üst çubuktakidir, başlıktakiler ikincil
    expect(html).not.toContain("btn-primary");
    expect(html).toContain('href="/giris"');
    expect(html).toContain('href="/kayit"');
    expect(html).toContain("Okumak için hesap gerekmez.");
    expect(namesOf(html, "summary")).toEqual(["Neden kayıt gerekir?"]);
    expect(html).not.toMatch(/<details[^>]*\bopen=""/);
    expect(html).toContain(WHY_REGISTER);
  });

  it("üye: 'Merhaba, @ad' ve özet; slogan yok. Yüklenirken yer tutucu (aria-busy) ve tek H1", () => {
    const html = render(<Greeting user={{ nickname: "ayse" }} summary="2 iş sizi bekliyor · 3 öneri oylamada" />);
    expect(html).toContain('<h1 class="page-title">Merhaba, @ayse</h1>');
    expect(html).toContain('<p class="home-summary">2 iş sizi bekliyor · 3 öneri oylamada</p>');
    expect(html).not.toContain(VISITOR_SLOGAN);
    const loading = render(<Greeting user={null} loading />);
    expect(loading).toContain('aria-busy="true"');
    expect(loading.match(/<h1/g)).toHaveLength(1);
    expect(loading).not.toContain("Giriş yap");
  });

  it("'Tam' kipte 'Neden kayıt gerekir?' açık gelir", async () => {
    setPrefSync(PREF_KEYS.detail, "tam");
    const html = render(
      <DetailLevelProvider>
        <Greeting user={null} />
      </DetailLevelProvider>,
    );
    expect(html).toMatch(/<details[^>]*\bopen=""/);
    await removePref(PREF_KEYS.detail);
  });

  it("adlar ayrılmış e2e adlarıyla çakışmaz", () => {
    expect(clean(allNames(render(<Greeting user={null} />)))).toEqual([]);
    expect(clean(allNames(render(<Greeting user={{ nickname: "ayse" }} summary="x" />)))).toEqual([]);
  });
});

describe("TaskList ve rol ipucu", () => {
  beforeEach(async () => {
    await removePref(PREF_KEYS.detail);
  });

  it("görev bağlantısı ilgili panele yönelir: ?bolum=eylem, bilirkişi ?bolum=bilirkisi; öneri dışı aynen", () => {
    expect(taskHref(task())).toBe("/oneriler/p1?bolum=eylem");
    expect(taskHref(task({ kind: "sponsor" }))).toBe("/oneriler/p1?bolum=eylem");
    expect(taskHref(task({ kind: "object" }))).toBe("/oneriler/p1?bolum=eylem");
    expect(taskHref(task({ kind: "reconciliation" }))).toBe("/oneriler/p1?bolum=eylem");
    expect(taskHref(task({ kind: "author" }))).toBe("/oneriler/p1?bolum=eylem");
    expect(taskHref(task({ kind: "expert" }))).toBe("/oneriler/p1?bolum=bilirkisi");
    expect(taskHref(task({ link: "/proposals/p%202" }))).toBe("/oneriler/p%202?bolum=eylem");
    expect(taskHref(task({ link: "#/oneriler/p1" }))).toBe("/oneriler/p1?bolum=eylem");
    expect(taskHref(task({ kind: "registrar", link: "/kayit-memuru" }))).toBe("/kayit-memuru");
    expect(taskHref(task({ link: "/oneriler/yeni" }))).toBe("/oneriler/yeni");
    expect(taskHref(task({ link: "" }))).toBeNull();
    expect(taskHref(task({ link: "https://example.org/x" }))).toBeNull();
    // Yedi görev türünün hepsinin etiketi var
    expect(Object.keys(TASK_META).sort()).toEqual(["author", "expert", "object", "reconciliation", "registrar", "sponsor", "vote"]);
  });

  it("en yakın 3 görev görünür, kalanı 'Tümünü göster (n)' ile; satırın tamamı bağlantı, geri sayım içinde", () => {
    const tasks = [1, 2, 3, 4, 5].map((i) => task({ title: `Görev ${i}`, link: `/oneriler/p${i}`, kind: i === 2 ? "expert" : "vote" }));
    const html = render(<TaskList tasks={tasks} />);
    expect(html).toContain("Sizi bekleyenler (5)");
    expect(html.match(/<li/g)).toHaveLength(5);
    expect(html.match(/<li hidden=""/g)).toHaveLength(5 - TASKS_SHOWN);
    expect(html).toContain('href="/oneriler/p1?bolum=eylem"');
    expect(html).toContain('href="/oneriler/p2?bolum=bilirkisi"');
    expect(html.match(/<a class="home-task"[^>]*>[\s\S]*?<time/g)?.length).toBe(5);
    const id = /<ul class="home-task-list" id="([^"]+)"/.exec(html)?.[1];
    expect(id).toBeTruthy();
    expect(html).toMatch(new RegExp(`<button[^>]*aria-expanded="false"[^>]*aria-controls="${id}"`));
    expect(namesOf(html, "button")).toEqual(["Tümünü göster (5)"]);
  });

  it("'Tam' kipte hepsi açık gelir; 3 ve daha az görevde düğme yok; görev yoksa hiç çizilmez", () => {
    setPrefSync(PREF_KEYS.detail, "tam");
    const tasks = [1, 2, 3, 4].map((i) => task({ title: `Görev ${i}` }));
    const full = render(
      <DetailLevelProvider>
        <TaskList tasks={tasks} />
      </DetailLevelProvider>,
    );
    expect(full).not.toContain('hidden=""');
    expect(full).toContain('aria-expanded="true"');
    expect(namesOf(full, "button")).toEqual(["Listeyi kısalt"]);
    expect(namesOf(render(<TaskList tasks={tasks.slice(0, 3)} />), "button")).toEqual([]);
    expect(render(<TaskList tasks={[]} />)).toBe("");
  });

  it("rol ipucu: yönetici → simüle saat; doğrulanmış üye → öneri aç / tartışma; diğerleri → son kararlar", () => {
    expect(roleHint({ admin: true, member: true, open: 0, deliberation: 0 })).toEqual({
      text: "Süreleri ilerletmek için simüle saati ileri alın.",
      link: { label: "Yönetim", to: "/yonetim" },
    });
    expect(roleHint({ admin: false, member: true, open: 0, deliberation: 0 })).toEqual({ text: "İlk öneriyi siz açın.", link: { label: "Öneri aç", to: "/oneriler/yeni" } });
    expect(roleHint({ admin: false, member: true, open: 3, deliberation: 2 }).link.to).toBe("/oneriler?sekme=tartisma");
    expect(roleHint({ admin: false, member: true, open: 3, deliberation: 0 }).link.to).toBe("/oneriler/yeni");
    expect(roleHint({ admin: false, member: false, open: 3, deliberation: 2 })).toEqual({
      text: "Son kararlara göz atın.",
      link: { label: "Sonuçlanan öneriler", to: "/oneriler?sekme=sonuc" },
    });
    const html = render(<RoleHint hint={roleHint({ admin: true, member: true, open: 0, deliberation: 0 })} />);
    expect(html).toContain('href="/yonetim"');
    expect(namesOf(html, "a")).toEqual(["Yönetim"]);
  });

  it("adlar ayrılmış e2e adlarıyla çakışmaz (her görev türü, ipucu)", () => {
    const kinds = Object.keys(TASK_META) as DashboardTask["kind"][];
    const html = render(<TaskList tasks={kinds.map((kind) => task({ kind }))} />);
    expect(clean(allNames(html))).toEqual([]);
    for (const admin of [true, false]) {
      for (const member of [true, false]) {
        expect(clean(allNames(render(<RoleHint hint={roleHint({ admin, member, open: 1, deliberation: 1 })} />)))).toEqual([]);
      }
    }
  });
});

describe("QuickActions", () => {
  const base: QuickActionsInput = { canPropose: true, voting: 3, receipts: 2, registrar: false, auditor: false };

  it("doğrulanmış üye: Yeni öneri + Oylamadakiler (n) + 'Oyum kayıtlı mı? (n makbuz)'", () => {
    const s = quickActionSpecs(base);
    expect(s.buttons.map((b) => [b.label, b.to, b.variant])).toEqual([
      ["Yeni öneri", "/oneriler/yeni", "primary"],
      ["Oylamadakiler (3)", "/oneriler?sekme=oylama", "secondary"],
    ]);
    expect(s.receipts).toEqual({ label: "Oyum kayıtlı mı? (2 makbuz)", to: "/oy-dogrula" });
  });

  it("oylama yoksa 'Tüm öneriler'; pano gelmeden sayısız; makbuz yoksa sayısız; doğrulanmamışta yeni öneri yok", () => {
    expect(quickActionSpecs({ ...base, voting: 0 }).buttons.map((b) => [b.label, b.to])).toEqual([
      ["Yeni öneri", "/oneriler/yeni"],
      ["Tüm öneriler", "/oneriler"],
    ]);
    expect(quickActionSpecs({ ...base, voting: null }).buttons[1].label).toBe("Oylamadakiler");
    expect(quickActionSpecs({ ...base, receipts: 0 }).receipts.label).toBe("Oyum kayıtlı mı?");
    expect(quickActionSpecs({ ...base, receipts: null }).receipts.label).toBe("Oyum kayıtlı mı?");
    expect(quickActionSpecs({ ...base, canPropose: false }).buttons.map((b) => b.key)).toEqual(["oylama"]);
  });

  it("rol eylemi en çok 1: kayıt memuru (ve yönetici) 'Bekleyen üyeler', yalnız denetçi 'Denetim günlüğü'", () => {
    expect(quickActionSpecs({ ...base, registrar: true, auditor: true, pendingMembers: 3 }).buttons.map((b) => b.label)).toEqual([
      "Yeni öneri",
      "Oylamadakiler (3)",
      "Bekleyen üyeler (3)",
    ]);
    expect(quickActionSpecs({ ...base, registrar: true, pendingMembers: 0 }).buttons[2]).toMatchObject({ label: "Bekleyen üyeler", to: "/kayit-memuru" });
    expect(quickActionSpecs({ ...base, auditor: true }).buttons[2]).toMatchObject({ label: "Denetim günlüğü", to: "/yonetim?sekme=gunluk" });
  });

  it("grup adı ve bağlantılar; ayrılmış adlarla çakışmaz", () => {
    const html = render(<QuickActions {...base} registrar auditor pendingMembers={2} />);
    expect(html).toContain('role="group" aria-label="Hızlı eylemler"');
    expect(namesOf(html, "a")).toEqual(["Yeni öneri", "Oylamadakiler (3)", "Bekleyen üyeler (2)", "Oyum kayıtlı mı? (2 makbuz)"]);
    expect(clean(allNames(html))).toEqual([]);
    expect(render(<QuickActions {...base} placement="head" />)).toContain("home-actions-head");
  });
});

describe("SetupNotes ve forum.dismissed", () => {
  const user = (over: Partial<{ id: string; status: "verified" | "pending"; politicalConsent: boolean; isAdult: boolean }> = {}) => ({
    id: "u1",
    status: "verified" as "verified" | "pending",
    politicalConsent: false,
    isAdult: true,
    ...over,
  });

  beforeEach(async () => {
    await removePref(PREF_KEYS.dismissed);
  });

  it("notlar: rıza yoksa Profil bağlantılı not; 18 yaş notu; ikisi birden ise bağlantı tek; doğrulanmamışta not yok", () => {
    expect(setupNotes(user())).toEqual([
      { key: "consent:u1", text: "Oy verebilmek için siyasi görüş açık rızası gerekir.", link: { label: "Profil'de verin", to: "/profil" } },
    ]);
    const both = setupNotes(user({ isAdult: false }));
    expect(both.map((n) => n.key)).toEqual(["consent:u1", "minor:u1"]);
    expect(both.filter((n) => n.link)).toHaveLength(1);
    expect(setupNotes(user({ politicalConsent: true, isAdult: false }))[0].link).toEqual({ label: "Profil", to: "/profil" });
    expect(setupNotes(user({ politicalConsent: true }))).toEqual([]);
    expect(setupNotes(user({ status: "pending" }))).toEqual([]);
    expect(setupNotes(null)).toEqual([]);
  });

  it("tek not kutusu, 'Notu gizle' düğmesi (adında 'Kapat' yok); gizlenen not bir daha çizilmez", async () => {
    const html = render(<SetupNotes user={user({ isAdult: false })} />);
    expect(html).toContain('role="note"');
    expect(namesOf(html, "button")).toEqual(["Notu gizle"]);
    expect(html.match(/<p>/g)).toHaveLength(2);
    expect(clean(allNames(html))).toEqual([]);
    await addDismissed(["consent:u1"]);
    const after = render(<SetupNotes user={user({ isAdult: false })} />);
    expect(after).toContain("18 yaşından küçük");
    expect(after).not.toContain("siyasi görüş");
    await addDismissed(["minor:u1"]);
    expect(render(<SetupNotes user={user({ isAdult: false })} />)).toBe("");
    // Aynı cihazdaki başka üyenin notu etkilenmez
    expect(render(<SetupNotes user={user({ id: "u2" })} />)).toContain("Notu gizle");
  });

  it("forum.dismissed: bozuk kayıt boş liste; tekrarsız; en çok MAX_DISMISSED anahtar", async () => {
    expect(parseDismissed(null)).toEqual([]);
    expect(parseDismissed("{bozuk")).toEqual([]);
    expect(parseDismissed('{"a":1}')).toEqual([]);
    expect(parseDismissed('["a", 3, null, "", "b"]')).toEqual(["a", "b"]);
    setPrefSync(PREF_KEYS.dismissed, "{bozuk");
    expect(getDismissedSync()).toEqual([]);
    expect(await addDismissed(["x", "x", "y"])).toEqual(["x", "y"]);
    expect(await getDismissed()).toEqual(["x", "y"]);
    const many = await addDismissed(Array.from({ length: MAX_DISMISSED + 10 }, (_, i) => `k${i}`));
    expect(many).toHaveLength(MAX_DISMISSED);
    expect(many.at(-1)).toBe(`k${MAX_DISMISSED + 9}`);
  });
});

describe("ProposalRow (satır görünümü)", () => {
  it("durum özeti: renk rolü, işaret ve kısa metin", () => {
    expect(proposalRowSpec(summary({ status: "sponsoring", sponsorCount: 2, sponsorsRequired: 4 }))).toEqual({ tone: "now", mark: "●", status: "Destek 2/4", extra: null });
    expect(proposalRowSpec(summary({ status: "deliberation" }))).toEqual({ tone: "now", mark: "●", status: "Tartışmada", extra: null });
    expect(proposalRowSpec(summary({ participation: { voted: 23, eligible: 57 } }))).toEqual({ tone: "now", mark: "●", status: "Oylamada", extra: "katılım 23/57" });
    expect(proposalRowSpec(summary({ status: "revote", participation: { voted: 0, eligible: 0 } }))).toMatchObject({ status: "Yeniden oylamada", extra: null });
    expect(proposalRowSpec(summary({ status: "objection_window" }))).toMatchObject({ tone: "attention", mark: "●", status: "İtiraz süresinde" });
    expect(proposalRowSpec(summary({ status: "reconciliation" }))).toMatchObject({ tone: "attention", status: "Uzlaşma sürecinde" });
    expect(proposalRowSpec(summary({ status: "enacted" }))).toEqual({ tone: "success", mark: "✔", status: "Kabul edildi", extra: PROPOSAL_KIND_LABELS.topic });
    expect(proposalRowSpec(summary({ status: "rejected", kind: "deletion" }))).toMatchObject({ tone: "danger", mark: "✘", status: "Reddedildi" });
    expect(proposalRowSpec(summary({ status: "inadmissible" }))).toMatchObject({ tone: "danger", mark: "✘", status: "Yönetmeliğe aykırı" });
    expect(proposalRowSpec(summary({ status: "withdrawn" }))).toMatchObject({ tone: "neutral", mark: "–", status: "Geri çekildi" });
    expect(proposalRowSpec(summary({ status: "expired" }))).toMatchObject({ tone: "neutral", mark: "–", status: "Süresi doldu" });
  });

  it("satırın tamamı bağlantı; işaret ekran okuyucudan gizli; kalan süre ve 'sizin' meta satırında", () => {
    const html = render(<ProposalRow proposal={summary({ participation: { voted: 23, eligible: 57 } })} myId="u-yazar" />);
    expect(html.match(/<a /g)).toHaveLength(1);
    expect(html).toContain('class="prow prow-now" href="/oneriler/p1"');
    expect(html).toContain('<span class="prow-mark" aria-hidden="true">●</span>');
    expect(html).toContain("#K-31");
    expect(html).toContain("katılım 23/57");
    expect(html).toContain("sizin");
    expect(html).toContain("<time");
    // Sonuçlanmışta geri sayım yok
    expect(render(<ProposalRow proposal={summary({ status: "enacted", phaseEndsAt: null })} />)).not.toContain("<time");
  });

  it("liste adı ve satır sayısı; adlar ayrılmış adlarla çakışmaz", () => {
    const statuses: ProposalStatus[] = ["sponsoring", "deliberation", "voting", "objection_window", "reconciliation", "revote", "enacted", "rejected"];
    const html = render(<ProposalRowList proposals={statuses.map((status, i) => summary({ id: `p${i}`, status }))} label="Deneme" />);
    expect(html).toContain('<ul class="prow-list" aria-label="Deneme">');
    expect(html.match(/<li>/g)).toHaveLength(statuses.length);
    expect(clean(allNames(html))).toEqual([]);
  });
});

describe("OpenNow ve RecentDecisions", () => {
  beforeEach(async () => {
    await removePref(PREF_KEYS.detail);
  });

  it("açık öneri toplamı yalnız süren evreleri sayar", () => {
    expect(openCount(counts({ draft: 4, sponsoring: 1, deliberation: 2, voting: 2, revote: 1, objection_window: 1, reconciliation: 1, enacted: 9, rejected: 3 }))).toBe(8);
  });

  it("sade kipte ilk 5 satır, 'Tam' kipte hepsi; başlıkta toplam; 'Tümü (süreye göre)' Açık sekmesine süre sırasıyla", () => {
    const open = Array.from({ length: 7 }, (_, i) => summary({ id: `p${i}`, seq: i + 1 }));
    const html = render(<OpenNow open={open} total={9} />);
    expect(html).toContain("Şu an açık (9)");
    expect(html.match(/<li>/g)).toHaveLength(OPEN_ROWS);
    expect(OPEN_ALL_HREF).toBe("/oneriler?sekme=acik&sirala=sure");
    expect(html).toContain('href="/oneriler?sekme=acik&amp;sirala=sure"');
    expect(namesOf(html, "a").at(0)).toBe("Tümü (süreye göre)");
    // Sıra korunur (sunucunun bitiş sırası)
    expect([...html.matchAll(/href="\/oneriler\/(p\d)"/g)].map((m) => m[1])).toEqual(["p0", "p1", "p2", "p3", "p4"]);

    setPrefSync(PREF_KEYS.detail, "tam");
    const full = render(
      <DetailLevelProvider>
        <OpenNow open={open} total={7} />
      </DetailLevelProvider>,
    );
    expect(full.match(/<li>/g)).toHaveLength(7);
  });

  it("boşsa tek satır (boş kart ya da başlık yok)", () => {
    expect(render(<OpenNow open={[]} total={0} />)).toBe('<p class="home-empty-line">Şu an açık öneri yok.</p>');
  });

  it("son kararlar: 5 satır ✔/✘, 'Tüm kabul edilenler' bağlantısı; boşsa eski metin", () => {
    const items = [0, 1, 2, 3, 4].map((i) => summary({ id: `e${i}`, status: i === 4 ? "rejected" : "enacted", phaseEndsAt: null }));
    const html = render(<RecentDecisions items={items} />);
    expect(html).toContain("Son kararlar");
    expect(html.match(/<li>/g)).toHaveLength(5);
    expect(html.match(/✔/g)).toHaveLength(4);
    expect(html.match(/✘/g)).toHaveLength(1);
    expect(html).toContain('href="/oneriler?sekme=kabul"');
    expect(clean(allNames(html))).toEqual([]);
    expect(render(<RecentDecisions items={[]} />)).toContain("Henüz yürürlüğe giren karar yok.");
  });
});

describe("AccountStatus", () => {
  it("bekleyen üye: 3 adım, 2. adım 'Şimdi' (aria-current), 'Profil ve rızalar' bağlantısı", () => {
    const html = render(<AccountStatus user={{ nickname: "yeni", status: "pending" }} />);
    expect(html).toContain("Hesabınız doğrulama bekliyor");
    expect(html.match(/<li/g)).toHaveLength(3);
    expect(html).toMatch(/<li class="home-step-now" aria-current="step"><span class="home-step-tag">Şimdi<\/span>/);
    expect(html).toContain("@yeni");
    expect(namesOf(html, "a")).toEqual(["Profil ve rızalar"]);
    expect(clean(allNames(html))).toEqual([]);
  });

  it("askı ve ret: neyin yapılamadığını söyleyen uyarı; doğrulanmış üyede kart yok", () => {
    expect(render(<AccountStatus user={{ nickname: "a", status: "suspended" }} />)).toContain("Askıdaki hesaplar öneri açamaz");
    const rejected = render(<AccountStatus user={{ nickname: "a", status: "rejected" }} />);
    expect(rejected).toContain("düzeltme talebi yapılamaz");
    expect(rejected).not.toContain("Kapat");
    expect(render(<AccountStatus user={{ nickname: "a", status: "verified" }} />)).toBe("");
    expect(render(<AccountStatus user={null} />)).toBe("");
  });
});

describe("HomeLayout (sayfa düzeni)", () => {
  const me = (over: Partial<Me> = {}): Me => ({
    id: "u-ayse",
    nickname: "ayse",
    status: "verified",
    roles: ["member"],
    isExpert: false,
    expertDomains: [],
    reputation: 0,
    joinedAt: 0,
    isAdult: true,
    aiConsent: false,
    politicalConsent: true,
    ...over,
  });
  const dashboard = (over: Partial<Dashboard> = {}): Dashboard => ({
    counts: counts({ sponsoring: 1, deliberation: 2, voting: 3, enacted: 5 }),
    topics: 4,
    members: { verified: 57, pending: 3 },
    recentEnacted: [0, 1, 2, 3, 4].map((i) => summary({ id: `e${i}`, seq: 10 + i, status: "enacted", phaseEndsAt: null })),
    open: [0, 1, 2, 3, 4, 5].map((i) => summary({ id: `o${i}`, seq: 20 + i })),
    tasks: [task(), task({ kind: "sponsor", link: "/oneriler/o2" })],
    permanentLoser: [],
    ledger: { height: 345, healthy: 4, validators: 4 },
    ...over,
  });
  const perms = (...granted: HomePermission[]) => (p: HomePermission) => granted.includes(p);
  const layout = (over: Partial<HomeLayoutProps> = {}) =>
    render(
      <HomeLayout
        authLoading={false}
        user={me()}
        can={perms("V")}
        system={system()}
        data={dashboard()}
        dataLoading={false}
        dataError={null}
        onReload={() => undefined}
        onRetrySystem={() => undefined}
        receipts={2}
        wide={false}
        {...over}
      />,
    );
  /** Metinlerin sayfadaki sırası (her biri bulunmalı). */
  const order = (html: string, texts: string[]) => texts.map((t) => html.indexOf(t));
  const ascending = (xs: number[]) => xs.every((x, i) => x >= 0 && (i === 0 || x > xs[i - 1]));

  beforeEach(async () => {
    await removePref(PREF_KEYS.detail);
    await removePref(PREF_KEYS.dismissed);
  });

  it("üye (telefon): selam ve özet → görevler → hızlı eylemler → şu an açık → son kararlar → topluluk → vitrin → ilkeler", () => {
    const html = layout();
    expect(html.match(/<h1/g)).toHaveLength(1);
    expect(html).toContain("2 iş sizi bekliyor · 3 öneri oylamada");
    const pos = order(html, [
      "Merhaba, @ayse",
      "Sizi bekleyenler (2)",
      'aria-label="Hızlı eylemler"',
      "Oyum kayıtlı mı? (2 makbuz)",
      "Şu an açık (6)",
      "Son kararlar",
      "Topluluk durumu",
      "Neyi doğrulayabilirsiniz?",
      "Sistem nasıl çalışır?",
    ]);
    expect(ascending(pos), String(pos)).toBe(true);
    expect(html).not.toContain(VISITOR_SLOGAN);
    expect(html).not.toContain("Giriş yap");
    // Görev bağlantısı panele 1 dokunuş
    expect(html).toContain('href="/oneriler/p1?bolum=eylem"');
  });

  it("üye (masaüstü): hızlı eylemler selamın yanında (DOM'da da görevlerden önce), tek kopya", () => {
    const html = layout({ wide: true });
    expect(html.match(/aria-label="Hızlı eylemler"/g)).toHaveLength(1);
    expect(ascending(order(html, ["Merhaba, @ayse", 'aria-label="Hızlı eylemler"', "Sizi bekleyenler (2)"]))).toBe(true);
    expect(html).toContain("home-head-wide");
  });

  it("üye (masaüstü): yan sütunda önce vitrin, sonra topluluk durumu (taslak D; DOM sırası = görsel sıra), tek kopya", () => {
    const html = layout({ wide: true });
    const side = html.slice(html.indexOf('class="home-side"'));
    expect(ascending(order(side, ["Neyi doğrulayabilirsiniz?", "Topluluk durumu"]))).toBe(true);
    expect(html.match(/Neyi doğrulayabilirsiniz\?/g)).toHaveLength(1);
    expect(html.match(/>Topluluk durumu</g)).toHaveLength(1);
    expect(ascending(order(html, ["Son kararlar", "Neyi doğrulayabilirsiniz?", "Topluluk durumu", "Sistem nasıl çalışır?"]))).toBe(true);
  });

  it("ziyaretçi: başlık ve giriş/kayıt → vitrin → şu an açık → son kararlar → topluluk → ilkeler; hızlı eylem ve görev yok", () => {
    const html = layout({ user: null, can: perms(), data: dashboard({ tasks: [] }), receipts: null });
    const pos = order(html, ["Forum Sistemi", "Giriş yap", "Neden kayıt gerekir?", "Neyi doğrulayabilirsiniz?", "Şu an açık (6)", "Son kararlar", "Topluluk durumu", "Sistem nasıl çalışır?"]);
    expect(ascending(pos), String(pos)).toBe(true);
    expect(html).not.toContain("Hızlı eylemler");
    expect(html).not.toContain("Merhaba");
    expect(html).not.toContain("Bekleyen işiniz yok");
  });

  it("işi olmayan yönetici, açık öneri yok, rıza yok: ipucu, tek satır not, 'Tüm öneriler', boş liste tek satır", () => {
    const html = layout({
      user: me({ nickname: "admin", roles: ["admin"], politicalConsent: false }),
      can: perms("V", "R", "D", "A"),
      data: dashboard({ tasks: [], open: [], counts: counts({ enacted: 5 }) }),
      receipts: 0,
    });
    expect(html).toContain("Bekleyen işiniz yok · şu an açık öneri yok");
    expect(html).not.toContain("Sizi bekleyenler");
    const pos = order(html, ["Süreleri ilerletmek için simüle saati ileri alın.", "Notu gizle", "Tüm öneriler", "Bekleyen üyeler (3)", "Şu an açık öneri yok.", "Son kararlar"]);
    expect(ascending(pos), String(pos)).toBe(true);
    expect(html).not.toContain("Oylamadakiler");
    expect(html).not.toContain("Denetim günlüğü");
  });

  it("bekleyen üye: hesap mesajı bir kez (kart), ipucu 'Son kararlara göz atın', yeni öneri ve not yok", () => {
    const html = layout({ user: me({ status: "pending", politicalConsent: false }), can: perms(), data: dashboard({ tasks: [] }) });
    expect(html.match(/Hesabınız doğrulama bekliyor/g)).toHaveLength(1);
    expect(html).toContain("Son kararlara göz atın.");
    expect(html).not.toContain("Yeni öneri");
    expect(html).not.toContain("Notu gizle");
  });

  it("yüklenirken: başlık yeri tutulur, Spinner yalnız liste alanında, ziyaretçi/üye içeriği yok", () => {
    const html = layout({ authLoading: true, user: null, data: undefined, dataLoading: false });
    expect(html).toContain('aria-busy="true"');
    expect(html.match(/role="status"/g)?.length).toBeGreaterThanOrEqual(1);
    expect(html).toContain("Pano yükleniyor…");
    expect(html).not.toContain("Giriş yap");
    expect(html).not.toContain("Hızlı eylemler");
    // Pano gelmeden üye selamı özetsiz ama yer tutucu satırla
    const noData = layout({ data: undefined, dataLoading: true });
    expect(noData).toContain('<p class="home-summary">\u00a0</p>');
    expect(noData).toContain("Oylamadakiler");
  });

  it("'Daha fazla' adı hiçbir yerde yok; bütün adlar ayrılmış e2e adlarıyla çakışmaz (her rol, her iki genişlik)", () => {
    const views = [
      layout(),
      layout({ wide: true }),
      layout({ user: null, can: perms(), receipts: null }),
      layout({ user: me({ politicalConsent: false, isAdult: false }), can: perms("V", "R", "D", "A"), data: dashboard({ tasks: [] }) }),
      layout({ user: me({ status: "pending" }), can: perms() }),
    ];
    for (const html of views) {
      expect(html.toLowerCase()).not.toContain("daha fazla");
      expect(clean(allNames(html))).toEqual([]);
    }
  });

  it("'Tam' kipte gizlenen her şey açık: görevlerin hepsi, açık önerilerin hepsi, ilkeler", () => {
    setPrefSync(PREF_KEYS.detail, "tam");
    const many = dashboard({
      tasks: [1, 2, 3, 4, 5].map((i) => task({ title: `Görev ${i}` })),
      open: Array.from({ length: 9 }, (_, i) => summary({ id: `o${i}` })),
      counts: counts({ voting: 9 }),
    });
    const html = render(
      <DetailLevelProvider>
        <HomeLayout
          authLoading={false}
          user={me()}
          can={perms("V")}
          system={system()}
          data={many}
          dataLoading={false}
          dataError={null}
          onReload={() => undefined}
          onRetrySystem={() => undefined}
          receipts={0}
          wide={false}
        />
      </DetailLevelProvider>,
    );
    expect(html).not.toMatch(/<li hidden=""/);
    expect(html.match(/class="prow prow-/g)).toHaveLength(9 + 5);
    expect(html.match(/<details[^>]*\bopen=""/g)?.length).toBeGreaterThanOrEqual(PRINCIPLES.length);
  });
});
