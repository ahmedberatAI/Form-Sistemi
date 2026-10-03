// 'Keşfet ve doğrula' (Faz 3 / madde 7): yedi bileşenin canlı satırları, mevcut veriden türetilen yedi adımlı gösterim rehberi
// (sabit öneri numarası yok; gerçek çapa ve sekme kimlikleri), sayfa iskeleti (bölgeler, 'Bu sayfada', 8 ilkenin tam metni,
// 34 terimlik sözlük ve çapaları), 'Tam' görünümde açık sözlük ve gezinme sözleşmesi (üst gezinme 8 öğe, Keşfet 'Daha fazla'da).
// Sunucu tarafı çizimle denetlenir (DOM gerekmez).
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import type { Dashboard, ProposalSummary, SystemInfo } from "@forum/shared";
import { afterEach, describe, expect, it } from "vitest";
import { AuthProvider } from "../auth/AuthContext";
import { PRINCIPLES } from "../components/home/PrinciplesAccordion";
import { NAV_ITEMS, topNavSections, TOP_NAV_GROUPS } from "../components/layout/nav";
import { DetailLevelProvider } from "../lib/detailLevel";
import { GLOSSARY, GLOSSARY_GROUPS } from "../lib/glossary";
import { PREF_KEYS, removePref, setPrefSync } from "../lib/prefs";
import { routes } from "../lib/routes";
import { parseSectionParam } from "../lib/sectionParam";
import { evidenceRows, glossaryQueryForTarget, guideSteps, KESFET_SECTIONS, termAnchor } from "./kesfet";
import KesfetPage from "./KesfetPage";

// e2e/tests/*.spec.ts'in aradığı adlar: yeni düğme/bağlantı adları bunları, yeni bölge adları ikinci listeyi içermemeli.
const RESERVED = ["destekle", "oyumu ver", "daha fazla", "sayımı kendim doğrulayayım", "kapat"];
const RESERVED_REGIONS = ["oylama", "uzlaşma turu", "azınlık raporları", "destekçiler (", "1. tur sonucu", "azınlık itirazı"];
const clash = (names: string[], reserved = RESERVED) => names.filter((n) => reserved.some((r) => n.toLocaleLowerCase("tr").includes(r)));

const system = (over: Partial<SystemInfo> = {}): SystemInfo => ({
  version: "1.4.0",
  now: Date.UTC(2026, 9, 2, 12, 0),
  clockOffsetMs: 0,
  timeScale: 10,
  aiMode: "offline",
  aiModel: "claude-x",
  ledger: { height: 1345, validators: 4, healthy: 4 },
  bylawVersion: 2,
  members: { verified: 57, pending: 3 },
  ...over,
});

const proposal = (over: Partial<ProposalSummary> = {}): ProposalSummary => ({
  id: "p7",
  seq: 7,
  kind: "topic",
  title: "Kütüphane hafta sonu açık olsun",
  status: "enacted",
  tier: "T0",
  authorId: "u1",
  authorNickname: "yazar",
  categories: [],
  parentTopicId: null,
  createdAt: Date.UTC(2026, 9, 1),
  phaseEndsAt: null,
  sponsorCount: 4,
  sponsorsRequired: 4,
  messageCount: 3,
  participation: null,
  integrityWarningCount: 0,
  ...over,
});

const dashboard = (over: Partial<Dashboard> = {}): Pick<Dashboard, "ledger" | "permanentLoser" | "recentEnacted"> => ({
  ledger: { height: 9, validators: 4, healthy: 4 },
  permanentLoser: [
    { clusterId: "g0", label: "A kümesi", lostShare: 0.2, decisions: 8 },
    { clusterId: "g1", label: "B kümesi", lostShare: 0.3, decisions: 8 },
  ],
  recentEnacted: [proposal(), proposal({ id: "p5", seq: 5 })],
  ...over,
});

const row = (rows: ReturnType<typeof evidenceRows>, key: string) => rows.find((r) => r.key === key)!;

afterEach(async () => {
  await removePref(PREF_KEYS.detail);
});

describe("yedi bileşen", () => {
  it("plandaki yedi bileşen bu sırayla; her biri bir dokunuşla (YZ: son kararın YZ özeti kartı)", () => {
    const rows = evidenceRows({ system: system(), dashboard: dashboard(), receipts: null });
    expect(rows.map((r) => r.label)).toEqual(["Defter", "Oy doğrulama", "Bilirkişiler", "Yapay zekâ", "Graf", "Yönetmelik", "Azınlık koruması"]);
    expect(rows.map((r) => r.to)).toEqual(["/defter", "/oy-dogrula", "/bilirkisiler", "/oneriler/p7?bolum=yz", "/graf", "/yonetmelik", "/graf?sekme=istatistik"]);
    expect(rows.filter((r) => r.ai).map((r) => r.key)).toEqual(["yz"]);
    for (const r of rows) expect(r.about.length, r.key).toBeGreaterThan(20);
  });

  it("canlı değerler: defter yüksekliği ve doğrulayıcı sağlığı, YZ kipi, küme sayısı, yönetmelik sürümü, azınlık koruması hükmü", () => {
    const rows = evidenceRows({ system: system(), dashboard: dashboard(), receipts: null });
    expect(row(rows, "defter").live).toBe("1.345. blok · 4/4 doğrulayıcı sağlıklı");
    expect(row(rows, "defter").tone).toBeUndefined();
    expect(row(rows, "yz").live).toBe("Çevrimdışı sezgisel mod · danışma niteliğinde");
    expect(row(rows, "graf").live).toBe("2 görüş kümesi izleniyor");
    expect(row(rows, "yonetmelik").live).toBe("sürüm 2 · ontoloji ile denetlenir");
    // Ana sayfadaki hükümle aynı cümle; baştaki işareti satır kendi tonuyla koyar
    expect(row(rows, "azinlik").live).toBe("Kalıcı kaybeden küme yok · 2 küme izleniyor");
    expect(row(rows, "azinlik").tone).toBe("ok");
    expect(row(evidenceRows({ system: system({ aiMode: "claude", aiModel: "claude-sonnet" }) }), "yz").live).toBe("Claude (claude-sonnet) · danışma niteliğinde");
  });

  it("uyarı yalnız gerektiğinde: sağlıksız doğrulayıcı ve kalıcı kaybeden küme uyarı tonunda", () => {
    const rows = evidenceRows({
      system: system({ ledger: { height: 9, validators: 4, healthy: 3 } }),
      dashboard: dashboard({ permanentLoser: [{ clusterId: "g0", label: "A", lostShare: 0.9, decisions: 10 }] }),
    });
    expect(row(rows, "defter").tone).toBe("warning");
    expect(row(rows, "defter").live).toBe("9. blok · 3/4 doğrulayıcı sağlıklı");
    expect(row(rows, "azinlik").tone).toBe("warning");
    expect(row(rows, "azinlik").live).not.toMatch(/^[⚠✔]/u);
  });

  it("makbuz sayısı yalnız üyede ve sıfırdan büyükse; veri yokken satırlar genel ifadeyle çizilir, YZ satırı bağlantı değildir", () => {
    expect(row(evidenceRows({ system: system(), receipts: 3 }), "oy").live).toBe("bu cihazda 3 makbuz");
    expect(row(evidenceRows({ system: system(), receipts: 0 }), "oy").live).toBe("makbuzla, cihazınızda");
    const bare = evidenceRows({ system: null, dashboard: null });
    expect(bare).toHaveLength(7);
    expect(row(bare, "defter").live).toBe("dağıtık defter");
    expect(row(bare, "yz").live).toBe("danışma niteliğinde");
    expect(row(bare, "yz").to).toBeUndefined();
    expect(row(bare, "graf").live).toBe("görüş kümeleri");
    expect(row(bare, "azinlik").live).toBe("kalıcı kaybeden küme göstergesi");
    // Sistem bilgisi yokken defter panodan gelir
    expect(row(evidenceRows({ system: null, dashboard: dashboard() }), "defter").live).toBe("9. blok · 4/4 doğrulayıcı sağlıklı");
  });
});

describe("gösterim rehberi", () => {
  const latest = proposal();
  const bad = proposal({ id: "p31", seq: 31, title: "Aykırı öneri", status: "inadmissible" });

  it("yedi adım, gösterim sırasıyla; bağlantılar mevcut veriden ve gerçek kimliklerle", () => {
    const steps = guideSteps({ latest, inadmissible: bad, admin: false });
    expect(steps.map((s) => s.key)).toEqual(["sayim", "makbuz", "zincir", "kopru", "kura", "ontoloji", "azinlik"]);
    expect(steps.map((s) => s.link.to)).toEqual([
      "/oneriler/p7?bolum=dogrula",
      "/oy-dogrula",
      "/defter?sekme=dogrulama",
      "/oneriler/p7?bolum=sonuclar",
      "/bilirkisiler",
      "/oneriler/p31?bolum=ontoloji",
      "/graf?sekme=istatistik",
    ]);
    // Gerçek öneri adıyla anılır; veri varken 'genel sayfaya düştü' notu yok
    expect(steps[0].text).toContain("#K-7 “Kütüphane hafta sonu açık olsun”");
    expect(steps[5].text).toContain("#K-31 “Aykırı öneri”");
    expect(steps.filter((s) => s.fallback)).toEqual([]);
    expect(steps.every((s) => !s.extra)).toBe(true);
  });

  it("derin bağlantı çapaları sectionParam'ın kabul ettiği biçimde; defter sekmesi 'dogrulama' ('dogrula' sessizce Durum'a düşerdi)", () => {
    for (const s of guideSteps({ latest, inadmissible: bad, admin: true })) {
      for (const l of [s.link, s.extra].filter(Boolean)) {
        const bolum = /[?&]bolum=([^&]+)/.exec(l!.to)?.[1];
        if (bolum) expect(parseSectionParam(bolum), l!.to).toBe(bolum);
      }
    }
    const ledger = guideSteps({ latest, inadmissible: bad, admin: false }).find((s) => s.key === "zincir")!;
    expect(ledger.link.to).toMatch(/sekme=dogrulama$/);
  });

  it("yöneticiye defter adımında ek 'Kurcalama demosu' (?sekme=demo); başkasına yok", () => {
    const admin = guideSteps({ latest, inadmissible: bad, admin: true }).find((s) => s.key === "zincir")!;
    expect(admin.extra).toEqual({ to: "/defter?sekme=demo", label: "Kurcalama demosu" });
    expect(guideSteps({ latest, inadmissible: bad, admin: false }).find((s) => s.key === "zincir")!.extra).toBeUndefined();
  });

  it("veri yoksa: sayım sonuçlanan önerilere, köprü testi grafa, ontoloji yönetmeliğe düşer ve bunu notla söyler", () => {
    const steps = guideSteps({ latest: null, inadmissible: null, admin: false });
    expect(steps).toHaveLength(7);
    const by = (k: string) => steps.find((s) => s.key === k)!;
    expect(by("sayim").link.to).toBe("/oneriler?sekme=sonuc");
    expect(by("kopru").link.to).toBe("/graf");
    expect(by("ontoloji").link.to).toBe("/yonetmelik");
    expect(steps.filter((s) => s.fallback).map((s) => s.key)).toEqual(["sayim", "kopru", "ontoloji"]);
    for (const s of steps) expect(s.text).not.toMatch(/#K-/);
  });

  it("her adımın sözlük terimi var; bağlantı adları ayrılmış e2e adlarını içermez", () => {
    for (const admin of [false, true]) {
      for (const input of [{ latest, inadmissible: bad }, { latest: null, inadmissible: null }]) {
        const steps = guideSteps({ ...input, admin });
        expect(steps.every((s) => s.term && GLOSSARY.some((e) => e.id === s.term))).toBe(true);
        expect(clash(steps.flatMap((s) => [s.link.label, s.extra?.label ?? "", s.title]))).toEqual([]);
      }
    }
  });
});

// ───────────── Sayfa iskeleti ─────────────

const page = (url = "/kesfet") =>
  renderToStaticMarkup(
    <DetailLevelProvider>
      <MemoryRouter initialEntries={[url]}>
        <AuthProvider>
          <KesfetPage />
        </AuthProvider>
      </MemoryRouter>
    </DetailLevelProvider>,
  );

/** Metnin sunucu çizimindeki (HTML kaçışlı) hâli. */
const esc = (t: string) => t.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;").replace(/'/g, "&#x27;");

/** Bir HTML parçasındaki bağlantı/düğme/özet görünür adları (etiketler atılmış). */
const namesOf = (html: string, tag: "a" | "button" | "summary") =>
  [...html.matchAll(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "g"))].map((m) => m[1].replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim());

/** Bölge adları: <section aria-labelledby> başlıkları. */
const regionNames = (html: string) =>
  [...html.matchAll(/<section[^>]*aria-labelledby="([^"]+)"/g)].map((m) => {
    const h = new RegExp(`id="${m[1].replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"[^>]*>([\\s\\S]*?)</h[1-4]>`).exec(html);
    return h ? h[1].replace(/<[^>]*>/g, "").trim() : "";
  });

describe("KesfetPage", () => {
  it("tek H1 ve dört bölüm (plandaki sırayla, çapalarıyla); 'Bu sayfada' bu çapalara ?bolum ile gider; başlıklar odaklanabilir", () => {
    const html = page();
    expect(html.match(/<h2 class="section-title kesfet-section-title" id="[^"]+" tabindex="-1">/g)).toHaveLength(KESFET_SECTIONS.length);
    expect(html.match(/<h1/g)).toHaveLength(1);
    expect(html).toContain('<h1 class="page-title">Keşfet ve doğrula</h1>');
    expect(regionNames(html)).toEqual(["Yedi bileşen", "Gösterim rehberi", `Temel ilkeler (${PRINCIPLES.length})`, "Sözlük"]);
    const ids = KESFET_SECTIONS.map((s) => html.indexOf(`id="${s.anchor}"`));
    expect(ids.every((x, i) => x > 0 && (i === 0 || x > ids[i - 1])), String(ids)).toBe(true);
    const nav = html.slice(html.indexOf('aria-label="Bu sayfada"'), html.indexOf("</nav>"));
    expect(namesOf(nav, "a")).toEqual(["Bileşenler", "Rehber", "İlkeler", "Sözlük"]);
    for (const s of KESFET_SECTIONS) expect(nav).toContain(`href="${routes.kesfet({ bolum: s.anchor })}"`);
  });

  it("yedi bileşen satırı ve 8 ilkenin tam metni (akordeon değil, metin ve bağlantı görünür)", () => {
    const html = page();
    const evidence = html.slice(html.indexOf('class="kesfet-evidence"'), html.indexOf('id="rehber"'));
    expect(evidence.match(/<li>/g)).toHaveLength(7);
    for (const p of PRINCIPLES) {
      expect(html).toContain(`<h3 class="kesfet-tenet-title">${esc(p.title)}</h3>`);
      expect(html).toContain(esc(p.text));
    }
    const tenets = html.slice(html.indexOf('class="kesfet-tenets"'), html.indexOf('id="sozluk"'));
    expect(tenets).not.toContain("<details");
    expect(namesOf(tenets, "a")).toEqual(PRINCIPLES.map((p) => p.link));
  });

  it("rehber veri gelene kadar yer tutucu (Spinner) gösterir; sayfanın geri kalanı hemen çizilir", () => {
    const html = page();
    const guide = html.slice(html.indexOf('id="rehber"'), html.indexOf('id="ilkeler"'));
    expect(guide).toContain("Rehber hazırlanıyor…");
    expect(html).toContain('id="sozluk"');
  });

  it("sözlük: arama alanı, altı konu açılırı (Sade'de kapalı) ve 34 terim, her biri terim-<kimlik> çapasıyla", () => {
    const html = page();
    expect(html).toContain(">Sözlükte ara</label>");
    expect(html).toContain('type="search"');
    expect(namesOf(html, "summary").map((n) => n.replace(/\s*\d+ terim$/, ""))).toEqual(GLOSSARY_GROUPS.map((g) => g.label));
    expect(html).not.toMatch(/<details[^>]*\bopen=""/);
    expect(html.match(/class="kesfet-term"/g)).toHaveLength(GLOSSARY.length);
    for (const e of GLOSSARY) {
      expect(html).toContain(`id="${termAnchor(e.id)}"`);
      expect(parseSectionParam(termAnchor(e.id)), e.id).toBe(termAnchor(e.id));
    }
    // Terim aynen, günlük karşılık ve tanım; 'özet' terimi hash anlamında yeniden adlandırılmaz (günlük karşılığı 'parmak izi')
    const ozet = GLOSSARY.find((e) => e.id === "ozet")!;
    expect(html).toContain(`<dt class="kesfet-term-name" tabindex="-1">${esc(ozet.term)}</dt>`);
    expect(html).toContain(esc(ozet.plain));
  });

  it("'Tam' görünümde sözlük konuları açık gelir", () => {
    setPrefSync(PREF_KEYS.detail, "tam");
    const html = page();
    expect(html.match(/<details[^>]*\bopen=""/g)).toHaveLength(GLOSSARY_GROUPS.length);
  });

  it("adlar ayrılmış e2e adlarıyla çakışmaz; bölge adları yasak alt dizeleri içermez; 'Daha fazla' ve 'Kapat' yok", () => {
    const html = page();
    expect(clash([...namesOf(html, "a"), ...namesOf(html, "button"), ...namesOf(html, "summary")])).toEqual([]);
    expect(clash(regionNames(html), RESERVED_REGIONS)).toEqual([]);
    expect(html.toLocaleLowerCase("tr")).not.toContain("daha fazla");
    expect(html).not.toMatch(/>\s*Kapat/);
  });
});

describe("gezinme sözleşmesi", () => {
  it("Keşfet bir gezinme öğesi değildir: üst gezinme 8 öğe kalır; 'Daha fazla'daki Keşfet ve doğrula grubunun sonunda durur", () => {
    const top = topNavSections(NAV_ITEMS.filter((i) => TOP_NAV_GROUPS.includes(i.group))).flat();
    expect(top).toHaveLength(8);
    expect(top.some((i) => i.to === "/kesfet")).toBe(false);
    const explore = NAV_ITEMS.filter((i) => i.group === "explore");
    expect(explore.map((i) => i.to)).toEqual(["/bilirkisiler", "/graf", "/defter", "/yonetmelik", "/kesfet"]);
    const item = explore[explore.length - 1];
    expect(item.topNav).toBe(false);
    expect(item.bottom).toBeFalsy();
    expect(clash([item.label])).toEqual([]);
  });

  it("sözlük araması: süzgecin gizlediği terime derin bağlantı aramayı temizler; görünen terimde ve diğer bölümlerde arama kalır", () => {
    const target = termAnchor("taahhut");
    expect(glossaryQueryForTarget(target, "köprü")).toBe(""); // 'Taahhüt' bu süzgeçte yok: hedef çizilmezdi
    expect(glossaryQueryForTarget(target, "taahhüt")).toBe("taahhüt"); // hedef süzgeçte görünüyor
    expect(glossaryQueryForTarget(termAnchor("kopru-testi"), "köprü")).toBe("köprü");
    expect(glossaryQueryForTarget("sozluk", "köprü")).toBe("köprü"); // terim değil, bölüm
    expect(glossaryQueryForTarget(null, "köprü")).toBe("köprü");
    expect(glossaryQueryForTarget(target, "  ")).toBe("  "); // süzgeç yok
  });

  it("routes.kesfet: düz ve ?bolum'lu", () => {
    expect(routes.kesfet()).toBe("/kesfet");
    expect(routes.kesfet({ bolum: "rehber" })).toBe("/kesfet?bolum=rehber");
    expect(routes.kesfet({ bolum: termAnchor("kopru-testi") })).toBe("/kesfet?bolum=terim-kopru-testi");
  });
});
