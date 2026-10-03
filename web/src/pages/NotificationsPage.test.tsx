// Bildirimler sayfasının satır ve grup işaretlemesi: satırın tamamı tek bağlantı, satır başına en çok 1 düğme
// ('Okundu işaretle: <başlık>'), tür simgesi + ekran okuyucu metni, tarih grupları h2, ilk main tablist yalnız süzgeç.
// Sunucu tarafı çizimle denetlenir (DOM gerekmez). Bkz. docs/ARAYUZ_PLANI.md (Faz 3 / madde 6).
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import type { Notification } from "@forum/shared";
import { describe, expect, it } from "vitest";
import { groupByAge } from "../lib/notificationKinds";
import { NotificationGroups, NotificationRow } from "./NotificationsPage";

const render = (el: React.ReactElement) => renderToStaticMarkup(<MemoryRouter>{el}</MemoryRouter>);
const text = (html: string) =>
  html
    .replace(/<[^>]*>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
const tags = (html: string, tag: string) => [...html.matchAll(new RegExp(`<${tag}\\b([^>]*)>([\\s\\S]*?)</${tag}>`, "g"))].map((m) => ({ attrs: m[1], text: text(m[2]), html: m[2] }));
const attr = (attrs: string, name: string) => new RegExp(`\\b${name}="([^"]*)"`).exec(attrs)?.[1];

// e2e/tests/*.spec.ts'in düğme/bağlantı/bölge adı olarak aradığı dizeler: sabit adlar bunları içermemeli (küçük harfle).
const RESERVED_NAMES = ["destekle", "oyumu ver", "daha fazla", "sayımı kendim doğrulayayım", "kapat", "gerekçe", "açıklama", "azınlık raporu", "düğüm"];

const NOW = new Date(2026, 9, 3, 15, 30).getTime();
const make = (id: string, over: Partial<Notification> = {}): Notification => ({
  id,
  kind: "vote_open",
  title: `#K-${id} oylamada`,
  body: "Oyunuz bekleniyor.",
  link: `/oneriler/${id}`,
  read: false,
  createdAt: NOW - 60_000,
  ...over,
});
const noop = () => undefined;
const row = (n: Notification, busy = false) => render(<ul><NotificationRow n={n} busy={busy} onOpen={noop} onMarkRead={noop} /></ul>);

describe("NotificationRow", () => {
  it("satırın tamamı TEK bağlantı; okunmamışta yanında TEK düğme: 'Okundu işaretle: <başlık>'", () => {
    const html = row(make("7"));
    const links = tags(html, "a");
    expect(links).toHaveLength(1);
    expect(attr(links[0].attrs, "href")).toBe("/oneriler/7");
    expect(attr(links[0].attrs, "class")).toContain("notif-content");
    const buttons = tags(html, "button");
    expect(buttons).toHaveLength(1);
    expect(attr(buttons[0].attrs, "aria-label")).toBe("Okundu işaretle: #K-7 oylamada");
    expect(attr(buttons[0].attrs, "class")).toContain("notif-read");
    // Düğme bağlantının İÇİNDE değil (etkileşimli öğe iç içe konmaz).
    expect(links[0].text).not.toContain("Okundu işaretle");
    // Bağlantının görünür/okunur içeriği başlık, gövde, zaman ve tür metnini taşır.
    expect(links[0].text).toContain("#K-7 oylamada");
    expect(links[0].text).toContain("Oyunuz bekleniyor.");
    expect(links[0].text).toMatch(/Git:/);
    expect(links[0].text).toContain("Yeni");
    expect(html).toContain("<time");
  });

  it("okunmuş satırda düğme yok; yalnız bağlantı (satır başına düğme 2'den 1'e → 0/1) ve 'Okundu.' metni", () => {
    const html = row(make("7", { read: true }));
    expect(tags(html, "button")).toHaveLength(0);
    expect(tags(html, "a")).toHaveLength(1);
    expect(html).toContain('<span class="sr-only">Okundu.</span>');
    expect(html).not.toContain("notif-unread");
    expect(html).not.toContain(">Yeni<");
  });

  it("okunmamış satır: 'Yeni' rozeti metinle gelir, satır notif-unread", () => {
    const html = row(make("7"));
    expect(html).toContain("notif-unread");
    expect(html).toMatch(/badge badge-info[^>]*>Yeni</);
  });

  it("tür sınıfı: simge (aria-hidden) + ekran okuyucu metni + data-kind; tanınmayan tür varsayılan 'Bildirim'", () => {
    const vote = row(make("1", { kind: "vote_open" }));
    expect(vote).toContain('<span class="sr-only">Oylama.</span>');
    expect(vote).toContain('data-kind="vote_open"');
    expect(vote).toContain("notif-oylama");
    expect(vote).toMatch(/class="notif-icon notif-tone-info"[^>]*aria-hidden="true"/);
    expect(vote).toContain("<svg");

    expect(row(make("2", { kind: "deletion_request" }))).toContain('<span class="sr-only">Tartışma.</span>');
    expect(row(make("3", { kind: "delegation_unrouted" }))).toContain('<span class="sr-only">Vekâlet.</span>');
    expect(row(make("4", { kind: "registration_pending" }))).toContain('<span class="sr-only">Yönetim görevi.</span>');
    expect(row(make("5", { kind: "password_changed" }))).toContain('<span class="sr-only">Hesap.</span>');

    const unknown = row(make("6", { kind: "bilinmeyen_tur" }));
    expect(unknown).toContain('<span class="sr-only">Bildirim.</span>');
    expect(unknown).toContain("notif-diger");
    expect(unknown).toContain("notif-tone-neutral");
  });

  it("bağlantısı olmayan bildirim düz kutudur: bağlantı ve 'Git' yok, okundu düğmesi var", () => {
    const html = row(make("8", { link: null, kind: "account_rejected" }));
    expect(tags(html, "a")).toHaveLength(0);
    expect(html).toContain('<div class="notif-content">');
    expect(html).not.toContain("Git:");
    expect(tags(html, "button")).toHaveLength(1);
  });

  it("sunucunun İngilizce yolları uygulama yoluna çevrilir; dış bağlantı yeni sekmede, güvenli ve belirtilmiş", () => {
    expect(attr(tags(row(make("9", { link: "/profile" })), "a")[0].attrs, "href")).toBe("/profil");
    const external = tags(row(make("10", { link: "https://ornek.example/kaynak" })), "a")[0];
    expect(attr(external.attrs, "href")).toBe("https://ornek.example/kaynak");
    expect(attr(external.attrs, "target")).toBe("_blank");
    expect(attr(external.attrs, "rel")).toBe("noopener noreferrer");
    expect(external.text).toContain("yeni sekmede açılır");
  });

  it("metin olduğu gibi gösterilir: {{uye:…}} belirteçleri istemcide DEĞİŞTİRİLMEZ (sunucu çözer), HTML kaçırılır", () => {
    const html = row(make("11", { body: "{{uye:u-1}} destek verdi <b>kalın</b>", title: "Başlık <script>x</script>" }));
    expect(html).toContain("{{uye:u-1}} destek verdi &lt;b&gt;kalın&lt;/b&gt;");
    expect(html).toContain("Başlık &lt;script&gt;x&lt;/script&gt;");
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<b>kalın");
  });

  it("okundu isteği sürerken düğme aria-busy olur ve içinde yükleniyor göstergesi çizilir", () => {
    const html = row(make("12"), true);
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain("spinner");
  });

  it("gövdesiz bildirimde gövde öğesi çizilmez", () => {
    expect(row(make("13", { body: "" }))).not.toContain("notif-body");
  });

  it("sabit adlar e2e'nin aradığı adlarla çakışmaz", () => {
    const html = row(make("14", { title: "Sıradan başlık" }));
    const names = [attr(tags(html, "button")[0].attrs, "aria-label") ?? "", ...[...html.matchAll(/class="sr-only">([^<]*)</g)].map((m) => m[1])];
    for (const name of names) for (const reserved of RESERVED_NAMES) expect(name.toLowerCase(), `${name} ~ ${reserved}`).not.toContain(reserved);
  });
});

describe("NotificationGroups", () => {
  const items = [
    make("a", { createdAt: NOW - 60_000 }),
    make("b", { createdAt: new Date(2026, 9, 1, 10).getTime(), read: true }),
    make("c", { createdAt: new Date(2026, 7, 1).getTime(), kind: "password_changed", link: "/profil" }),
  ];

  it("her grup bir h2 başlığı + adlandırılmış liste: Bugün / Bu hafta / Daha eski", () => {
    const html = render(<NotificationGroups groups={groupByAge(items, NOW)} onOpen={noop} onMarkRead={noop} />);
    const h2 = tags(html, "h2");
    expect(h2.map((h) => h.text)).toEqual(["Bugün", "Bu hafta", "Daha eski"]);
    const uls = tags(html, "ul");
    expect(uls).toHaveLength(3);
    expect(uls.map((u) => attr(u.attrs, "aria-labelledby"))).toEqual(h2.map((h) => attr(h.attrs, "id")));
    expect(tags(html, "li")).toHaveLength(3);
  });

  it("boş grup başlığı çizilmez; hiç grup yoksa hiçbir şey çizilmez", () => {
    const only = render(<NotificationGroups groups={groupByAge([items[0]], NOW)} onOpen={noop} onMarkRead={noop} />);
    expect(tags(only, "h2").map((h) => h.text)).toEqual(["Bugün"]);
    expect(render(<NotificationGroups groups={[]} onOpen={noop} onMarkRead={noop} />)).toBe("");
  });

  it("tarih başlıkları sekme listesi DEĞİLDİR (ilk main tablist 'Bildirim filtresi' kalır) ve düğme sayısı satır başına ≤ 1", () => {
    const html = render(<NotificationGroups groups={groupByAge(items, NOW)} onOpen={noop} onMarkRead={noop} />);
    expect(html).not.toContain('role="tablist"');
    expect(html).not.toContain('role="tab"');
    // 3 satır: yalnız okunmamış olan ('a' ve 'c') düğme taşır.
    expect(tags(html, "button")).toHaveLength(2);
    for (const li of tags(html, "li")) expect(tags(li.html, "button").length).toBeLessThanOrEqual(1);
  });

  it("meşgul satırın düğmesi işaretlenir, diğerleri değil", () => {
    const html = render(<NotificationGroups groups={groupByAge(items, NOW)} busyId="a" onOpen={noop} onMarkRead={noop} />);
    expect([...html.matchAll(/aria-busy="true"/g)]).toHaveLength(1);
  });
});
