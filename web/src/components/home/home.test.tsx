// Ana sayfa parçaları: sayaç haplarının bağlantıları ve sayıları, azınlık koruması hükmü ve açılış durumu, ilke akordeonu,
// vitrin karoları. Sunucu tarafı çizimle denetlenir (DOM gerekmez). Yeni düğme/bağlantı adları e2e'nin aradığı adlarla
// çakışmamalıdır (alt dize, büyük/küçük harf duyarsız).
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import type { Dashboard, SystemInfo } from "@forum/shared";
import { beforeEach, describe, expect, it } from "vitest";
import { DetailLevelProvider } from "../../lib/detailLevel";
import { PREF_KEYS, removePref, setPrefSync } from "../../lib/prefs";
import { CountPills, countPillSpecs } from "./CountPills";
import { MinorityProtection, minorityVerdict } from "./MinorityProtection";
import { PRINCIPLES, PrinciplesAccordion } from "./PrinciplesAccordion";
import { scaleText, ShowcaseTiles, showcaseTiles } from "./ShowcaseTiles";

const render = (el: React.ReactElement) => renderToStaticMarkup(<MemoryRouter>{el}</MemoryRouter>);

/** Bir HTML parçasındaki bağlantı/özet görünür adları (etiketler atılmış). */
function namesOf(html: string, tag: "a" | "summary"): string[] {
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
    expect(namesOf(html, "a").map((n) => n.split(" ")[0])).toEqual(["Defter", "Oy", "Bilirkişiler", "Graf", "Yönetmelik"]);
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
