// Yeni öneri formu (Faz 3 / madde 3): kompakt tür seçici, hüküm önce ön denetim, kurallar duruma göre açık.
// Saf işlevler (açılırların kendiliğinden açılması, sayaçlar, sınır düzeyi) ve sunucu tarafı çizimle görünür/katlı bölümler,
// 'Tam' görünüm ve e2e sözleşmeleri denetlenir (DOM gerekmez). e2e/tests/02-oylama ve 03-silme'nin dayandığı adlar burada da kilitlenir:
// radyo /Yeni Konu/, .pre-summary 'T0'/'DEL' + 'Yönetmeliğe uygun', aside 'Gerekli destekçi', 'Görüş ayrılığı' devre dışı ve
// 'Değiştirilemez madde…' tek, role=alert yalnız 'Acil gerekçe…' (kurallar satırı role=status), 'Talebin açıklaması'.
import type { AuditReport, DecisionParams, Finding, PrecheckResponse } from "@forum/shared";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DetailLevelProvider } from "../../lib/detailLevel";
import { PREF_KEYS, removePref, setPrefSync } from "../../lib/prefs";
import { ToastProvider } from "../../ui/Toast";
import { CategoryPicker, categoryPickerMeta } from "../CategoryPicker";
import { DeletionForm, deletionLimitLevel, deletionLimitLine, deletionLimits, MAX_DELETIONS_PER_DAY, MAX_OPEN_DELETIONS } from "./DeletionForm";
import { KIND_INFO, KIND_ORDER, KindPicker, kindPickerLayout } from "./KindPicker";
import { TermLinksProvider, type TermLinkMode } from "../../ui/Term";
import { FindingList, findingCounts, HIGH_SIMILARITY, precheckCounts, precheckDisclosure, PrecheckPanel, PrecheckSummary } from "./PrecheckPanel";

const NOW = Date.UTC(2026, 9, 3, 12);

vi.mock("../../auth/AuthContext", () => ({
  useAuth: () => ({ user: { id: "u-me" }, can: () => true, system: null, now: () => Date.UTC(2026, 9, 3, 12) }),
  useServerNow: () => () => Date.UTC(2026, 9, 3, 12),
}));

const render = (el: React.ReactElement) =>
  renderToStaticMarkup(
    <DetailLevelProvider>
      <ToastProvider>
        <MemoryRouter>{el}</MemoryRouter>
      </ToastProvider>
    </DetailLevelProvider>,
  );

const text = (s: string) =>
  s
    .replace(/<[^>]*>/g, " ")
    .replace(/&#x27;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/\s+/g, " ")
    .trim();
const namesOf = (html: string, tag: "a" | "button" | "summary") =>
  [...html.matchAll(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, "g"))].map((m) => text(m[1]));
const ariaLabels = (html: string) => [...html.matchAll(/aria-label="([^"]*)"/g)].map((m) => m[1]);
const allNames = (html: string) => [...namesOf(html, "a"), ...namesOf(html, "button"), ...namesOf(html, "summary"), ...ariaLabels(html)];
/** e2e sözleşmesi: yeni düğme, bağlantı, özet ve etiket adları bunları içermez (büyük/küçük harf duyarsız alt dize). */
const FORBIDDEN = ["Destekle", "Oyumu ver", "Daha fazla", "Sayımı kendim doğrulayayım", "Kapat"];
const expectNoForbidden = (html: string) => {
  for (const n of allNames(html)) for (const f of FORBIDDEN) expect(n.toLocaleLowerCase("tr"), n).not.toContain(f.toLocaleLowerCase("tr"));
};
const toneOf = (html: string): string[] => [...html.matchAll(/class="badge badge-([a-z]+)/g)].map((m) => m[1]);
const firstDetails = (html: string) => {
  const i = html.indexOf("<details");
  return i < 0 ? html.length : i;
};
/** `<details …>` açılış etiketleri ve özet metinleri sırasıyla. */
const detailsOf = (html: string) =>
  [...html.matchAll(/<details\b([^>]*)>\s*<summary\b[^>]*>([\s\S]*?)<\/summary>/g)].map((m) => ({ open: /\sopen=""/.test(m[1]), summary: text(m[2]) }));
const count = (html: string, needle: string) => html.split(needle).length - 1;

beforeEach(async () => {
  await removePref(PREF_KEYS.detail);
});

// ───────────── Tür seçici ─────────────

describe("KindPicker: seçimden sonra kompakt radyolar", () => {
  it("görünüm: tür seçilmeden kartlar, seçildikten sonra kompakt", () => {
    expect(kindPickerLayout(null)).toBe("cards");
    for (const k of KIND_ORDER) expect(kindPickerLayout(k), k).toBe("compact");
  });

  it("seçim yokken 5 açıklamalı kart; 'Türler ne demek?' yok", () => {
    const html = render(<KindPicker value={null} onChange={() => undefined} label="1. Öneri türü" />);
    expect(html).toContain("radio-cards");
    expect(html).not.toContain("kind-picker-compact");
    expect(count(html, 'type="radio"')).toBe(5);
    expect(html).not.toContain(" checked");
    for (const k of KIND_ORDER) expect(text(html), k).toContain(KIND_INFO[k].short);
    expect(html).not.toContain("<details");
  });

  it("seçimden sonra: 5 radyo DOM'da, yalnız seçili işaretli; uzun açıklamalar 'Türler ne demek?' açılırında (sade kipte kapalı)", () => {
    const html = render(<KindPicker value="topic" onChange={() => undefined} label="1. Öneri türü" />);
    expect(html).toContain("kind-picker-compact");
    expect(html).toContain("radio-inline");
    expect(count(html, 'type="radio"')).toBe(5);
    expect(count(html, 'checked=""')).toBe(1);
    expect(html).toMatch(/checked="" value="topic"/);
    // Radyonun üstünde kısa açıklama yok; uzun açıklamalar açılırda
    const before = html.slice(0, firstDetails(html));
    for (const k of KIND_ORDER) {
      expect(text(before), k).not.toContain(KIND_INFO[k].short);
      expect(text(html.slice(firstDetails(html))), k).toContain(KIND_INFO[k].text);
    }
    expect(detailsOf(html)).toEqual([{ open: false, summary: "Türler ne demek?" }]);
    expectNoForbidden(html);
  });

  it("e2e 02: /Yeni Konu/ tek radyo etiketinde geçer; katman rozetleri gri (renk yalnız seçili hapın çerçevesinde)", () => {
    const html = render(<KindPicker value="deletion" onChange={() => undefined} />);
    const labels = [...html.matchAll(/<label\b[^>]*class="check-label"[^>]*>([\s\S]*?)<\/label>/g)].map((m) => text(m[1]));
    expect(labels).toHaveLength(5);
    expect(labels.filter((l) => /Yeni Konu/.test(l))).toHaveLength(1);
    expect(labels.find((l) => /Silme/.test(l))).toContain("DEL");
    expect(toneOf(html).length).toBe(5);
    expect(new Set(toneOf(html))).toEqual(new Set(["neutral"]));
  });

  it("'Tam' görünümde 'Türler ne demek?' açık gelir", () => {
    setPrefSync(PREF_KEYS.detail, "tam");
    const html = render(<KindPicker value="regulation" onChange={() => undefined} />);
    expect(detailsOf(html)).toEqual([{ open: true, summary: "Türler ne demek?" }]);
  });
});

// ───────────── Ön denetim ─────────────

const R = (num: number, den: number) => ({ num, den });
const params = {
  tier: "T0",
  quorum: R(1, 5),
  threshold: R(1, 2),
  thresholdStrict: true,
  clusterFloor: R(2, 5),
  authorClusterFloor: null,
  overrideThreshold: R(2, 3),
  revoteThreshold: R(3, 5),
  significantShare: R(1, 10),
  significantMinMembers: 3,
  minVotesPerCluster: 2,
  minClusteredForBridge: 12,
  coldStartBump: R(1, 10),
  delegationCapFraction: R(1, 20),
  delegationMaxHops: 3,
  sponsorsRequired: 3,
  requiresExpert: false,
  expertCount: 3,
  expertDomains: [],
  durationsHours: { sponsoring: 168, deliberation: 72, voting: 72, extension: 24, objection: 48, reconciliation: 72 },
} as unknown as DecisionParams;

const finding = (severity: Finding["severity"], i = 0): Finding => ({ code: `${severity}-${i}`, severity, message: `${severity} iletisi ${i}` }) as Finding;

const audit = (over: Partial<AuditReport> = {}): AuditReport =>
  ({
    admissible: true,
    tier: "T0",
    params,
    categories: [],
    inferredClasses: [],
    rightsAffected: [],
    requiresExpert: false,
    violations: [],
    warnings: [],
    infos: [],
    appliedRules: [],
    bylawVersion: 3,
    bylawHash: "ab".repeat(32),
    checkedAt: NOW,
    ...over,
  }) as AuditReport;

const precheck = (over: Partial<PrecheckResponse> = {}, a: Partial<AuditReport> = {}): PrecheckResponse => ({
  audit: audit(a),
  classification: { categories: [], rightsAffected: [], contentLabels: [], rationale: "", offline: true, model: "sezgisel", aiLabel: "Yapay zekâ ile üretildi · sezgisel" },
  similar: [],
  pii: [],
  warnings: [],
  sponsorsRequired: 3,
  ...over,
});

const FY = "https://forumsistemi.org/ont#";
const aiCats = (iris: string[]) => ({
  categories: iris.map((iri) => ({ iri, label: iri.slice(FY.length), confidence: 0.8 })),
  rightsAffected: [],
  contentLabels: [],
  rationale: "Gerekçe.",
  offline: true,
  model: "sezgisel",
  aiLabel: "Yapay zekâ ile üretildi · sezgisel",
});

describe("ön denetim: saf yardımcılar", () => {
  it("bulgu sayıları ve özet sayaçları (ihlal + denetim ve genel uyarılar)", () => {
    expect(findingCounts(audit())).toBe("");
    expect(findingCounts(audit({ violations: [finding("violation")], warnings: [finding("warning"), finding("warning", 1)], infos: [finding("info")] }))).toBe(
      "1 ihlal · 2 uyarı · 1 bilgi",
    );
    expect(precheckCounts(precheck())).toBe("");
    expect(precheckCounts(precheck({ warnings: ["salam"] }, { violations: [finding("violation")], warnings: [finding("warning")] }))).toBe("1 ihlal · 2 uyarı");
  });

  it("Bulgular: ihlal ya da uyarı varsa kendiliğinden açık; yalnız bilgi varsa kapalı", () => {
    expect(precheckDisclosure(precheck()).findings).toEqual({ count: 0, open: false, meta: "bulgu yok" });
    expect(precheckDisclosure(precheck({}, { infos: [finding("info")] })).findings).toEqual({ count: 1, open: false, meta: "1 bilgi" });
    expect(precheckDisclosure(precheck({}, { warnings: [finding("warning")] })).findings.open).toBe(true);
    expect(precheckDisclosure(precheck({}, { admissible: false, violations: [finding("violation")] })).findings).toEqual({ count: 1, open: true, meta: "1 ihlal" });
  });

  it("YZ önerileri: eklenebilir bir kategori önerisi varken ve henüz hiç kategori seçilmemişken açık", () => {
    const r = precheckDisclosure;
    const res = precheck({ classification: aiCats([`${FY}Kutuphane`, `${FY}Egitim`]) });
    expect(r(res).ai).toEqual({ open: false, meta: "2 kategori" }); // eklenemiyor (silme, yönetmelik)
    expect(r(res, { canAddCategory: true }).ai.open).toBe(true);
    // Bir kategori seçildikten sonra kalan öneri formdaki seçicide görünür; panel yeniden büyümez
    expect(r(res, { canAddCategory: true, selectedCategories: ["fy:Kutuphane"] }).ai.open).toBe(false);
    expect(r(res, { canAddCategory: true, selectedCategories: ["fy:Kutuphane", `${FY}Egitim`] }).ai.open).toBe(false);
    expect(precheckDisclosure(precheck(), { canAddCategory: true }).ai).toEqual({ open: false, meta: "öneri yok" });
  });

  it("Benzer öneriler: en az biri yüksek benzerlikteyse açık", () => {
    const s = (score: number) => ({ id: `p${score}`, seq: 4, title: "Benzer", status: "deliberation" as const, score, sameAuthor: false });
    expect(precheckDisclosure(precheck()).similar).toEqual({ count: 0, open: false, meta: "" });
    expect(precheckDisclosure(precheck({ similar: [s(0.2), s(HIGH_SIMILARITY - 0.01)] })).similar.open).toBe(false);
    const high = precheckDisclosure(precheck({ similar: [s(0.2), s(0.62)] })).similar;
    expect(high).toEqual({ count: 2, open: true, meta: "en yüksek %62" });
  });
});

describe("PrecheckPanel: önce hüküm, ayrıntı açılırda", () => {
  const panel = (r: PrecheckResponse, over: Record<string, unknown> = {}) =>
    render(<PrecheckPanel result={r} loading={false} error={null} stale={false} idleText={null} selectedCategories={[]} onAddCategory={() => undefined} {...over} />);

  it("sade: hüküm, katman ve 'Gerekli destekçi (Kₛ)' görünür; dört açılır bu sırayla ve olağan durumda kapalı", () => {
    const html = panel(precheck({ similar: [{ id: "p9", seq: 9, title: "Benzer öneri", status: "voting", score: 0.3, sameAuthor: true }] }));
    const visible = text(html.slice(0, firstDetails(html)));
    expect(visible).toContain("Yönetmeliğe uygun görünüyor");
    expect(visible).toContain("Katman");
    expect(visible).toMatch(/Katman T0 /);
    expect(visible).toContain("Olağan karar (yeni konu, alt konu).");
    expect(visible).toContain("Gerekli destekçi (Kₛ) 3 doğrulanmış üye (yazar dışında)");
    // Bilirkişi zorunlu değilse satır panelde değil, parametre listesinde
    expect(visible).not.toContain("Bilirkişi");
    expect(visible.indexOf("Yönetmeliğe uygun görünüyor")).toBeLessThan(visible.indexOf("Gerekli destekçi"));
    // İlk okumada Yunan sembolü ve formül yok (semboller 'Karar parametreleri' içinde anahtarın arkasında)
    expect(visible).not.toMatch(/[α-ωΑ-Ω]/);
    const d = detailsOf(html).filter((x) => x.summary !== "Süreler" && !x.summary.startsWith("Uygulanan kurallar"));
    expect(d.map((x) => x.summary)).toEqual(["Bulgular (0) bulgu yok", "Karar parametreleri Onay eşiği > %50", "YZ önerileri öneri yok", "Benzer öneriler (1) en yüksek %30"]);
    expect(d.every((x) => !x.open)).toBe(true);
    // Rozet bütçesi: görünür kısımda renkli rozet yok (hüküm Alert'tir); 'Güncel' ve 'Sizin öneriniz' gri
    expect(new Set(toneOf(html.slice(0, firstDetails(html))))).toEqual(new Set(["neutral"]));
    // Benzer öneri satırında tek renkli rozet durumdur; 'Sizin öneriniz' gri
    expect(toneOf(html.slice(html.indexOf('class="pre-similar"')))).toEqual(["info", "neutral"]);
    expectNoForbidden(html);
  });

  it("aykırı + ihlal: Bulgular açık gelir; eklenmemiş YZ kategori önerisi YZ'yi, yüksek benzerlik Benzer öneriler'i açar", () => {
    const html = panel(
      precheck(
        {
          classification: aiCats([`${FY}Kutuphane`]),
          similar: [{ id: "p2", seq: 2, title: "Çok benzer öneri", status: "deliberation", score: 0.71, sameAuthor: false }],
        },
        { admissible: false, violations: [finding("violation")], infos: [finding("info")] },
      ),
    );
    expect(text(html)).toContain("Bu haliyle yönetmeliğe aykırı");
    const d = Object.fromEntries(detailsOf(html).map((x) => [x.summary.split(" ")[0], x.open]));
    expect(d).toMatchObject({ Bulgular: true, Karar: false, YZ: true, Benzer: true });
    // 'Bilgi' bulgusu gri, ihlal kırmızı
    expect(html).toMatch(/pre-finding-info"><span class="badge badge-neutral/);
    expect(html).toMatch(/pre-finding-violation"><span class="badge badge-danger/);
  });

  it("benzer öneri yokken tek satır; uyarı ve kişisel veri kutuları yalnız varken ve açıkta", () => {
    const quiet = panel(precheck());
    expect(text(quiet)).toContain("Benzer öneri bulunmadı.");
    expect(quiet).not.toContain('role="alert"');
    const loud = panel(precheck({ warnings: ["Aynı yazarın benzer önerileri var."], pii: [{ kind: "phone", start: 0, end: 5, masked: "05**" }] }));
    const visible = text(loud.slice(0, firstDetails(loud)));
    expect(visible).toContain("Aynı yazarın benzer önerileri var.");
    expect(visible).toContain("Kişisel veri olabilecek ifadeler");
  });

  it("karar parametreleri: katman ve gerekli destekçi orada tekrar edilmez; parametreler ve süreler korunur", () => {
    const inside = (html: string) => {
      const params = html.slice(html.indexOf("Karar parametreleri</span>"));
      return text(params.slice(0, params.indexOf("YZ önerileri")));
    };
    const html = panel(precheck());
    for (const label of ["Yeter sayı", "Onay eşiği", "Küme tabanı", "Aşma eşiği", "Yeniden oy eşiği", "Vekâlet sınırı", "Bilirkişi zorunlu değil", "Süreler"])
      expect(inside(html), label).toContain(label);
    expect(inside(html)).not.toContain("Gerekli destekçi");
    expect(inside(html)).toContain("Sembolleri ve formülleri göster");
    expect(count(text(html), "Gerekli destekçi")).toBe(1);
    // Bilirkişi gerekliyse satır panelde görünür ve listede tekrar edilmez
    const expert = panel(precheck({}, { requiresExpert: true, params: { ...params, requiresExpert: true } as DecisionParams }));
    expect(text(expert.slice(0, firstDetails(expert)))).toContain("Bilirkişi Gerekli · 3 kişilik panel");
    expect(inside(expert)).not.toContain("Bilirkişi");
  });

  it("'Tam' görünümde bütün açılırlar açık", () => {
    setPrefSync(PREF_KEYS.detail, "tam");
    const html = panel(precheck({ similar: [{ id: "p9", seq: 9, title: "Benzer", status: "voting", score: 0.2, sameAuthor: false }] }));
    expect(detailsOf(html).length).toBeGreaterThanOrEqual(5);
    expect(detailsOf(html).every((x) => x.open)).toBe(true);
  });

  it("boşta, yüklenirken ve hata durumları aynen", () => {
    expect(text(panel(precheck(), { result: undefined, idleText: "Önce öneri türünü seçin." }))).toContain("Önce öneri türünü seçin.");
    expect(text(panel(precheck(), { result: undefined, loading: true }))).toContain("Ön denetim yapılıyor…");
  });

  it("başlık düzeyi atlanmaz: kartın başlığı h2, YZ bloğundaki alt başlıklar h3 (h4 yok)", () => {
    const html = panel(
      precheck({
        classification: {
          ...aiCats([`${FY}Kutuphane`]),
          rightsAffected: [{ right: `${FY}Ifade`, label: "İfade özgürlüğü", direction: "expand", confidence: 0.6 }],
          contentLabels: [{ label: "Kamu hizmeti", confidence: 0.7 }],
        } as PrecheckResponse["classification"],
      }),
    );
    expect(html).toMatch(/<h2[^>]*>Canlı ön denetim<\/h2>/);
    expect(html).not.toContain("<h4");
    for (const h of ["Önerilen kategoriler", "Olası hak etkileri", "İçerik işaretleri"]) expect(html, h).toContain(`<h3 class="pre-h4">${h}</h3>`);
    // 'genişletebilir' gri (mavi eylem içindir); öneri sayfasındaki hak etkisi bayrağıyla aynı rol
    expect(html).toMatch(/badge badge-neutral[^>]*>genişletebilir/);
  });
});

describe("ön denetim formu terk ettirmez: madde atfı Term bağlantı kipine uyar", () => {
  const list = (mode: TermLinkMode) =>
    render(
      <TermLinksProvider mode={mode}>
        <FindingList findings={[{ ...finding("warning"), articleLabel: "Madde 9 — Deneme" } as Finding]} />
      </TermLinksProvider>,
    );

  it("varsayılan (öneri sayfası): aynı sekmede Yönetmelik bağlantısı", () => {
    const html = list("page");
    expect(html).toMatch(/<a [^>]*href="\/yonetmelik"[^>]*>\(Madde 9 — Deneme\)<\/a>/);
    expect(html).not.toContain("target=");
  });

  it("yeni öneri formunun yanında (web): yeni sekmede ve adında not; yerel uygulamada bağlantısız düz metin", () => {
    const web = list("newTab");
    expect(web).toContain('target="_blank"');
    expect(web).toContain('rel="noopener"');
    expect(text(web)).toContain("(Madde 9 — Deneme) (yeni sekmede açılır)");
    const native = list("none");
    expect(native).not.toContain("<a ");
    expect(text(native)).toContain("(Madde 9 — Deneme)");
  });
});

describe("PrecheckSummary (.pre-summary): e2e metinleri ve tek renkli rozet", () => {
  it("T0 + 'Yönetmeliğe uygun'; sayaçlar düz metin; katman gri", () => {
    const html = render(<PrecheckSummary result={precheck({ warnings: ["x"] }, { warnings: [finding("warning")] })} loading={false} stale={false} />);
    expect(html).toContain('class="pre-summary"');
    expect(text(html)).toContain("T0");
    expect(text(html)).toContain("Yönetmeliğe uygun");
    expect(text(html)).toContain("2 uyarı");
    expect(text(html)).toContain("3 destekçi gerekir");
    expect(toneOf(html)).toEqual(["neutral", "success"]);
  });

  it("DEL ve T3: aykırı hüküm kırmızı, katman (T3 dahil) gri; kişisel veri turuncu yalnız varken", () => {
    const del = render(<PrecheckSummary result={precheck({}, { tier: "DEL" })} loading={false} stale={false} />);
    expect(text(del)).toContain("DEL");
    const t3 = render(<PrecheckSummary result={precheck({ pii: [{ kind: "tckn", start: 0, end: 11, masked: "1*********1" }] }, { tier: "T3", admissible: false })} loading={false} stale={false} />);
    expect(toneOf(t3)).toEqual(["neutral", "danger", "warning"]);
  });
});

// ───────────── Silme talebi formu ─────────────

describe("DeletionForm: sayaçlar ve sınır düzeyi (saf)", () => {
  const DAY = 86_400_000;
  const p = (status: string, ageMs: number) => ({ status, createdAt: NOW - ageMs }) as { status: never; createdAt: number };

  it("açık talepler sonuçlanmamışlardır (taslak dahil); günlük sayaç son 24 saat", () => {
    const mine = [p("draft", 3 * DAY), p("sponsoring", 1000), p("voting", 2 * DAY), p("enacted", 1000), p("rejected", 5 * DAY), p("withdrawn", 2000)];
    expect(deletionLimits(mine, NOW)).toEqual({ open: 3, day: 3 });
    expect(deletionLimits([], NOW)).toEqual({ open: 0, day: 0 });
  });

  it("düzey: sınırda 'at', sınıra 1 kala 'near', aksi 'ok'; sayaç yokken 'ok'", () => {
    expect(deletionLimitLevel(null)).toBe("ok");
    expect(deletionLimitLevel({ open: 0, day: 0 })).toBe("ok");
    expect(deletionLimitLevel({ open: MAX_OPEN_DELETIONS - 2, day: MAX_DELETIONS_PER_DAY - 2 })).toBe("ok");
    expect(deletionLimitLevel({ open: MAX_OPEN_DELETIONS - 1, day: 0 })).toBe("near");
    expect(deletionLimitLevel({ open: 0, day: MAX_DELETIONS_PER_DAY - 1 })).toBe("near");
    expect(deletionLimitLevel({ open: MAX_OPEN_DELETIONS, day: 0 })).toBe("at");
    expect(deletionLimitLevel({ open: 1, day: MAX_DELETIONS_PER_DAY })).toBe("at");
  });

  it("tek satır: canlı sayaçlı; yüklenmeden yalnız sınırlar", () => {
    expect(deletionLimitLine({ open: 1, day: 2 })).toBe(`Açık talepleriniz 1/${MAX_OPEN_DELETIONS} · son 24 saatte 2/${MAX_DELETIONS_PER_DAY}`);
    expect(deletionLimitLine(null)).toBe(`en çok ${MAX_OPEN_DELETIONS} açık talep · 24 saatte en çok ${MAX_DELETIONS_PER_DAY} talep`);
  });
});

describe("DeletionForm: kurallar tek satır, ayrıntı açılırda; e2e 03 sözleşmeleri", () => {
  const form = (messageIds: string[] = []) => render(<DeletionForm value={{ messageIds, ground: "", statement: "" }} onChange={() => undefined} />);

  it("'Tartışma silinmez' tek cümle + 'Karartma nasıl işler?'; kurallar satırı role=status, dört kural kapalı açılırda", () => {
    const html = form();
    const visible = text(html.slice(0, firstDetails(html)));
    expect(visible).toMatch(/Talep kabul edilirse mesaj karartılır ?: yerinde mezar taşı kalır\./);
    expect(visible).not.toContain("erişim kaydıyla");
    expect(html).toMatch(/<p class="del-limits-line" role="status">[\s\S]*Kurallar ve sınırlar:/);
    const d = detailsOf(html).map((x) => x.summary);
    expect(d).toEqual(["Karartma nasıl işler?", "Silme kuralları (4)"]);
    expect(detailsOf(html).every((x) => !x.open)).toBe(true);
    const rules = html.slice(html.indexOf("Silme kuralları (4)"));
    expect(count(rules, "<li>")).toBe(4);
  });

  it("'Görüş ayrılığı' devre dışı ve 'Değiştirilemez madde…' tek; uyarı kutusu (role=alert) yok; 'Talebin açıklaması' tek etiket", () => {
    const html = form();
    expect(html).toMatch(/<input type="radio" id="[^"]*#GorusAyriligi" disabled=""/);
    expect(count(html, "Değiştirilemez madde: görüş ayrılığı silme gerekçesi olamaz.")).toBe(1);
    expect(html).not.toContain('role="alert"');
    expect(count(html, ">Talebin açıklaması<")).toBe(1);
    // Acil gerekçelerin anlamı görünür ipucu metninde (rozet title'ı yalnız masaüstünde okunur); rozet turuncu
    expect(count(text(html), "Acil: talep açılınca mesaj hemen daraltılır.")).toBe(2);
    expect(html).not.toMatch(/badge-danger[^>]*>acil/);
    expectNoForbidden(html);
  });

  it("hedef boşken 'Mesaj kimliğiyle ekle' açıkta; talep bir mesajdan başladıysa açılırda", () => {
    const empty = form();
    expect(empty.indexOf(">Mesaj kimliğiyle ekle<")).toBeLessThan(empty.indexOf("Silme gerekçesi"));
    expect(detailsOf(empty).map((x) => x.summary)).not.toContain("Başka bir mesajı kimliğiyle ekle");
    const prefilled = form(["m-1"]);
    expect(detailsOf(prefilled).map((x) => x.summary)).toContain("Başka bir mesajı kimliğiyle ekle");
    const inside = prefilled.slice(prefilled.indexOf("Başka bir mesajı kimliğiyle ekle"));
    expect(inside).toContain(">Mesaj kimliğiyle ekle<");
  });

  it("'Tam' görünümde kurallar ve ayrıntılar açık", () => {
    setPrefSync(PREF_KEYS.detail, "tam");
    expect(detailsOf(form()).every((x) => x.open)).toBe(true);
  });
});

// ───────────── Kategori seçici ─────────────

describe("CategoryPicker: isteğe bağlı 'Ek kategoriler' kapalı başlar", () => {
  it("özet satırı: seçili sayısı ve YZ önerisi", () => {
    expect(categoryPickerMeta(0, 0)).toBe("seçilmedi");
    expect(categoryPickerMeta(2, 0)).toBe("2 seçili");
    expect(categoryPickerMeta(0, 1)).toBe("seçilmedi · 1 YZ önerisi");
  });

  it("collapsible: açılırda kapalı, grubun adı legend'da (ekran okuyucu); 'Tam' görünümde açık", () => {
    const el = <CategoryPicker label="Ek kategoriler (isteğe bağlı)" collapsible value={["fy:Kutuphane"]} onChange={() => undefined} />;
    const html = render(el);
    expect(detailsOf(html)).toEqual([{ open: false, summary: "Ek kategoriler (isteğe bağlı) 1 seçili" }]);
    expect(html).toMatch(/<legend class="sr-only">Ek kategoriler \(isteğe bağlı\)<\/legend>/);
    setPrefSync(PREF_KEYS.detail, "tam");
    expect(detailsOf(render(el))[0].open).toBe(true);
  });

  it("zorunlu seçim (yeni konu) açılırsız ve açık: görünür legend", () => {
    const html = render(<CategoryPicker value={[]} onChange={() => undefined} required />);
    expect(html).not.toContain("<details");
    expect(html).toMatch(/<legend class="field-label">Kategoriler/);
  });
});
