// Kabuk: masaüstü üst gezinmenin grup ayracı ve mobil "Daha fazla" sayfasındaki "Sistem durumu" bloğu.
// Sunucu tarafı çizimle denetlenir (DOM gerekmez). Yeni düğme/bağlantı/bölge adları e2e'nin aradığı adlarla çakışmamalıdır
// (alt dize, büyük/küçük harf duyarsız): 'Daha fazla' düğmesi ve penceresi aynen kalır.
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import type { SystemInfo } from "@forum/shared";
import { describe, expect, it } from "vitest";
import { SystemStatus } from "./AppLayout";
import { NAV_ITEMS, scaleLabel, systemRows, topNavSections, TOP_NAV_GROUPS, type NavItem } from "./nav";

const render = (el: React.ReactElement) => renderToStaticMarkup(<MemoryRouter>{el}</MemoryRouter>);

/** Bir HTML parçasındaki bağlantı/düğme görünür adları (etiketler atılmış). */
function namesOf(html: string, tag: "a" | "button"): string[] {
  return [...html.matchAll(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "g"))].map((m) => m[1].replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim());
}

// e2e/tests/*.spec.ts'in düğme/bağlantı/bölge adı olarak aradığı dizeler: yeni adlar bunları içermemeli.
const RESERVED = ["destekle", "oyumu ver", "daha fazla", "sayımı kendim doğrulayayım", "kapat"];
const reserved = (names: string[]) => names.filter((n) => RESERVED.some((r) => n.toLowerCase().includes(r)));

const system = (over: Partial<SystemInfo> = {}): SystemInfo => ({
  version: "1.0.0",
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

const NOW = Date.UTC(2026, 9, 2, 12, 0);
const row = (rows: ReturnType<typeof systemRows>, key: string) => rows.find((r) => r.key === key)!;

describe("masaüstü üst gezinme ayracı", () => {
  const top = NAV_ITEMS.filter((i) => TOP_NAV_GROUPS.includes(i.group));

  it("sekiz öğe iki grupta: Katılım (4) | Keşfet ve doğrula (4); etiketler ve sıra aynen", () => {
    const sections = topNavSections(top);
    expect(sections.map((s) => s.map((i) => i.group))).toEqual([Array(4).fill("main"), Array(4).fill("explore")]);
    expect(sections.flat().map((i) => i.label)).toEqual(["Ana sayfa", "Konular", "Öneriler", "Oyum kayıtlı mı?", "Bilirkişiler", "Graf", "Defter", "Yönetmelik"]);
    expect(sections.flat()).toHaveLength(8);
  });

  it("görev ve hesap öğeleri üst gezinmeye girmez (kullanıcı menüsü ve 'Daha fazla'da kalır)", () => {
    const all = topNavSections(NAV_ITEMS).flat();
    expect(all.some((i) => i.group === "duty" || i.group === "account")).toBe(false);
  });

  it("tek grup kalırsa ya da öğe yoksa ayraç için bölüm üretilmez (baştaki/sondaki ayraç yok)", () => {
    expect(topNavSections(top.filter((i) => i.group === "main"))).toHaveLength(1);
    expect(topNavSections(top.filter((i) => i.group === "explore"))).toHaveLength(1);
    expect(topNavSections([])).toEqual([]);
  });

  it("öğelerin dizilişinden bağımsız: karışık sıradaki öğeler yine gruplanır", () => {
    const mixed: NavItem[] = [top[4], top[0], top[5], top[1]];
    expect(topNavSections(mixed).map((s) => s.map((i) => i.label))).toEqual([["Ana sayfa", "Konular"], ["Bilirkişiler", "Graf"]]);
  });
});

describe("zaman ölçeği metni", () => {
  it("Ana sayfa vitrinindeki söz dizimiyle aynıdır", () => {
    expect(scaleLabel(1)).toBe("gerçek zamanlı");
    expect(scaleLabel(0)).toBe("gerçek zamanlı");
    expect(scaleLabel(10)).toBe("demo: 1 saat = 6 dakika");
    expect(scaleLabel(2.5)).toBe("demo: 1 saat = 24 dakika");
    expect(scaleLabel(600)).toBe("demo: 1 saat = 6 saniye");
  });
});

describe("systemRows", () => {
  it("beş satır, plandaki sırayla: Defter, YZ kipi, Simüle saat, Yönetmelik sürümü, İstemci sürümü", () => {
    const rows = systemRows(system(), NOW, "1.0.0");
    expect(rows.map((r) => [r.key, r.label])).toEqual([
      ["defter", "Defter"],
      ["yz", "YZ kipi"],
      ["saat", "Simüle saat"],
      ["yonetmelik", "Yönetmelik sürümü"],
      ["istemci", "İstemci sürümü"],
    ]);
  });

  it("defter satırı blok yüksekliği ve doğrulayıcı sağlığını verir, /defter'e bağlanır; sağlıklıysa uyarı yok", () => {
    const d = row(systemRows(system(), NOW, "1.0.0"), "defter");
    expect(d.value).toBe("345. blok · 4/4 doğrulayıcı sağlıklı");
    expect(d.to).toBe("/defter");
    expect(d.warning).toBeUndefined();
  });

  it("sağlıksız doğrulayıcı varsa uyarı metni gelir", () => {
    const d = row(systemRows(system({ ledger: { height: 1234, validators: 4, healthy: 2 } }), NOW, "1.0.0"), "defter");
    expect(d.value).toBe("1.234. blok · 2/4 doğrulayıcı sağlıklı");
    expect(d.warning).toBe("2 doğrulayıcı sağlıksız");
  });

  it("YZ kipi: çevrimdışıysa sezgisel mod, claude ise model adı", () => {
    expect(row(systemRows(system(), NOW, "1.0.0"), "yz").value).toBe("Çevrimdışı sezgisel mod");
    expect(row(systemRows(system({ aiMode: "claude", aiModel: "claude-sonnet" }), NOW, "1.0.0"), "yz").value).toBe("Claude (claude-sonnet)");
  });

  it("simüle saat ölçeği ve yönetici ileri almasını söyler", () => {
    const plain = row(systemRows(system({ timeScale: 10 }), NOW, "1.0.0"), "saat").value;
    expect(plain.endsWith("(demo: 1 saat = 6 dakika)")).toBe(true);
    const shifted = row(systemRows(system({ timeScale: 1, clockOffsetMs: 3 * 86_400_000 }), NOW, "1.0.0"), "saat").value;
    expect(shifted.endsWith("(gerçek zamanlı; yönetici 3 gün ileri aldı)")).toBe(true);
  });

  it("yönetmelik ve istemci sürümü", () => {
    const rows = systemRows(system({ bylawVersion: 3 }), NOW, "1.4.0");
    expect(row(rows, "yonetmelik").value).toBe("v3");
    expect(row(rows, "istemci").value).toBe("v1.4.0");
  });

  it("sistem bilgisi yokken yalnız istemci sürümü kalır", () => {
    expect(systemRows(null, NOW, "1.0.0").map((r) => r.key)).toEqual(["istemci"]);
  });
});

describe("SystemStatus (Daha fazla sayfasının sistem bloğu)", () => {
  it("'Sistem durumu' başlığı altında beş satır; yalnız defter satırı bağlantı", () => {
    const html = render(<SystemStatus system={system()} onRetry={() => undefined} />);
    expect(html).toContain('<section class="more-system" aria-labelledby=');
    expect(html).toContain(">Sistem durumu</h3>");
    expect(html.match(/<dt>/g)).toHaveLength(5);
    for (const label of ["Defter", "YZ kipi", "Simüle saat", "Yönetmelik sürümü", "İstemci sürümü"]) expect(html).toContain(`<dt>${label}</dt>`);
    expect(html).toContain("345. blok");
    expect(html).toContain("4/4 doğrulayıcı sağlıklı");
    expect(html).toContain("Çevrimdışı sezgisel mod");
    expect(html).toContain("v2");
    expect(html.match(/<a /g)).toHaveLength(1);
    expect(html).toContain('href="/defter"');
    expect(html).not.toContain("is-warn");
    expect(html).not.toContain("Uyarı:");
  });

  it("sağlıksız doğrulayıcıda satır uyarı renginde ve metinlidir (ekran okuyucuya 'Uyarı:' söylenir)", () => {
    const html = render(<SystemStatus system={system({ ledger: { height: 9, validators: 4, healthy: 3 } })} />);
    expect(html).toContain("more-system-row is-warn");
    expect(html).toContain('<span class="sr-only">Uyarı: </span>1 doğrulayıcı sağlıksız');
    expect(html).toContain("3/4 doğrulayıcı sağlıklı");
  });

  it("sistem bilgisi yokken 'Sistem bilgisi alınamadı.', 'Yenile' ve istemci sürümü çıkar; bağlantı yok", () => {
    const html = render(<SystemStatus system={null} onRetry={() => undefined} />);
    expect(html).toContain("Sistem bilgisi alınamadı.");
    expect(html).toContain('role="status"');
    expect(namesOf(html, "button")).toEqual(["Yenile"]);
    expect(html.match(/<dt>/g)).toHaveLength(1);
    expect(html).toContain("<dt>İstemci sürümü</dt>");
    expect(html.match(/<a /g)).toBeNull();
  });

  it("bağlantı ve düğme adları ayrılmış e2e adlarıyla çakışmaz; metinde 'Daha fazla' yok", () => {
    for (const sys of [system(), system({ ledger: { height: 1, validators: 4, healthy: 0 } }), null]) {
      const html = render(<SystemStatus system={sys} onRetry={() => undefined} />);
      expect(reserved([...namesOf(html, "a"), ...namesOf(html, "button")])).toEqual([]);
      expect(html.toLowerCase()).not.toContain("daha fazla");
    }
  });
});
