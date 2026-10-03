// Konular ve konu ayrıntısı sayfalarının sunucu tarafı çizimi (DOM gerekmez): tek satır sayaçlar, ağaç satırı kuralları (sürüm,
// kategori '+n', rozet bütçesi), konu ayrıntısında bölüm sırası (metin → açık öneriler → tartışma | alt konular → sürüm geçmişi),
// açık öneri yokken tek satırlık kart, kapalı sürüm geçmişi ve e2e'nin aradığı ad/bölge dizeleriyle çakışma olmaması.
import { PROPOSAL_KIND_LABELS, type ProposalSummary, type TopicDetail, type TopicSummary } from "@forum/shared";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DetailLevelProvider } from "../../lib/detailLevel";
import { PREF_KEYS, removePref, setPrefSync } from "../../lib/prefs";
import { OPEN_PROPOSALS_EMPTY_HINT, OpenProposalsCard, TopicDetailView } from "../../pages/TopicDetailPage";
import { proposalRowDetails } from "./ProposalCard";
import { TopicCounters, TopicFilters, type TopicFiltersProps } from "../../pages/TopicsPage";
import { ToastProvider } from "../../ui/Toast";
import { TopicTree } from "./TopicTree";

vi.mock("../../auth/AuthContext", () => ({
  useAuth: () => ({ user: { id: "u-ben", status: "verified" }, can: (p: string) => p === "V", now: () => Date.UTC(2026, 9, 2, 12) }),
  useServerNow: () => () => Date.UTC(2026, 9, 2, 12),
}));

const render = (el: React.ReactElement) =>
  renderToStaticMarkup(
    <DetailLevelProvider>
      <ToastProvider>
        <MemoryRouter>{el}</MemoryRouter>
      </ToastProvider>
    </DetailLevelProvider>,
  );

beforeEach(async () => {
  await removePref(PREF_KEYS.detail);
});

/**
 * e2e'nin aradığı adlarla çakışan alt dizeler (plan 'Test sözleşmeleri'; büyük/küçük harf duyarsız, Playwright gibi):
 * (b) düğme, bağlantı ve etiket adları ile (d) yeni bölge (region) adları. Öneri satırının başlık/durum metni (ör. 'Oylamada')
 * bir bağlantı adıdır, bölge adı değildir: yalnız (b) listesine bakılır.
 */
const FORBIDDEN_CONTROLS = ["Destekle", "Oyumu ver", "Daha fazla", "Sayımı kendim doğrulayayım", "Kapat"];
const FORBIDDEN_REGIONS = ["Oylama", "Uzlaşma turu", "Azınlık raporları", "Destekçiler (", "1. tur sonucu", "Azınlık itirazı", ...FORBIDDEN_CONTROLS];
const lower = (s: string) => s.toLocaleLowerCase("tr");

function namesOf(html: string, tag: "a" | "summary" | "button" | "h2" | "h3"): string[] {
  return [...html.matchAll(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, "g"))].map((m) => m[1].replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim());
}
const labelsOf = (html: string) => [...html.matchAll(/aria-label="([^"]*)"/g)].map((m) => m[1]);

/** Bu sayfalarda çıkan düğme/bağlantı/özet adları (aria-label dahil) ve bölge adları (başlıklar) yasak dizeleri içermemeli. */
const expectNoForbidden = (html: string, existing: string[] = []) => {
  const controls = [...namesOf(html, "a"), ...namesOf(html, "button"), ...namesOf(html, "summary"), ...labelsOf(html)].filter((n) => !existing.includes(n));
  for (const name of controls) for (const bad of FORBIDDEN_CONTROLS) expect(lower(name).includes(lower(bad)), `“${name}” adı “${bad}” içeriyor`).toBe(false);
  for (const name of [...namesOf(html, "h2"), ...namesOf(html, "h3")]) for (const bad of FORBIDDEN_REGIONS) expect(lower(name).includes(lower(bad)), `bölge “${name}” “${bad}” içeriyor`).toBe(false);
};

const topic = (over: Partial<TopicSummary> = {}): TopicSummary => ({
  id: "t1",
  seq: 1,
  parentId: null,
  title: "Ulaşım",
  categories: [],
  version: 1,
  status: "active",
  createdAt: Date.UTC(2026, 8, 1),
  updatedAt: Date.UTC(2026, 8, 1),
  childCount: 0,
  messageCount: 0,
  openProposalCount: 0,
  ...over,
});

const proposal = (over: Partial<ProposalSummary> = {}): ProposalSummary => ({
  id: "p1",
  seq: 12,
  kind: "amendment",
  title: "Bisiklet yollarını genişletelim",
  status: "voting",
  tier: "T0",
  authorId: "u-yazar",
  authorNickname: "yazar",
  categories: [],
  parentTopicId: "t1",
  createdAt: Date.UTC(2026, 9, 1),
  phaseEndsAt: Date.UTC(2099, 0, 1),
  sponsorCount: 0,
  sponsorsRequired: 4,
  messageCount: 3,
  participation: { voted: 23, eligible: 57 },
  integrityWarningCount: 0,
  ...over,
});

const detail = (over: Partial<TopicDetail> = {}): TopicDetail => ({
  ...topic({ version: 2, childCount: 2, messageCount: 5, openProposalCount: 1 }),
  body: "Kent içi ulaşımın ilkeleri.\nİkinci satır.",
  originProposalId: "p-kurucu",
  revisions: [
    { version: 1, title: "Ulaşım", body: "İlk metin", viaProposalId: "p-kurucu", createdAt: Date.UTC(2026, 8, 1), contentHash: "a".repeat(64) },
    { version: 2, title: "Ulaşım", body: "Kent içi ulaşımın ilkeleri.", viaProposalId: "p12", createdAt: Date.UTC(2026, 8, 20), contentHash: "b".repeat(64) },
  ],
  children: [topic({ id: "t2", seq: 2, parentId: "t1", title: "Bisiklet", messageCount: 2 }), topic({ id: "t3", seq: 3, parentId: "t1", title: "Toplu taşıma" })],
  ancestors: [],
  openProposals: [proposal()],
  ...over,
});

describe("TopicCounters (Konular: tek satır sayaçlar)", () => {
  const topics = [topic({ id: "a", messageCount: 10, openProposalCount: 2 }), topic({ id: "b", parentId: "a", messageCount: 5 }), topic({ id: "c", status: "archived", openProposalCount: 9 })];

  it("dört sayaç tek listede; yalnız 'Konulara açık öneri' Öneriler sayfasına bağlanan bir bağlantıdır", () => {
    const html = render(<TopicCounters topics={topics} />);
    expect(html).toContain('<ul class="topic-counts" aria-label="Konu sayıları">');
    expect(html.match(/<li>/g)).toHaveLength(4);
    expect(namesOf(html, "a")).toEqual(["Konulara açık öneri 2"]);
    expect(html).toContain('href="/oneriler"');
    // Ana konu, Alt konu ve Mesaj düz sayıdır (bağlantı değil)
    expect(html).toMatch(/<span class="topic-count"><span>Ana konu<\/span> <span class="topic-count-n">1<\/span><\/span>/);
    expect(html).toMatch(/<span>Alt konu<\/span> <span class="topic-count-n">1<\/span>/);
    expect(html).toMatch(/<span>Mesaj<\/span> <span class="topic-count-n">15<\/span>/);
  });

  it("sıfır olan sayaç soluk ama görünür kalır; eski dört kutu (.stat) artık yok", () => {
    const html = render(<TopicCounters topics={[topic()]} />);
    // Ana konu 1, öteki üçü sıfır
    expect(html.match(/is-zero/g)).toHaveLength(3);
    expect(html).not.toContain('class="stat');
    expectNoForbidden(html);
  });
});

describe("TopicFilters (Konular: telefonda 'Süz' açılırı)", () => {
  const props = (over: Partial<TopicFiltersProps> = {}): TopicFiltersProps => ({
    narrow: true,
    q: "",
    onQ: () => undefined,
    category: "",
    onCategory: () => undefined,
    categories: [
      { iri: "fy:Ulasim", label: "Ulaşım", depth: 0 },
      { iri: "fy:Bisiklet", label: "Bisiklet", depth: 1 },
    ],
    showArchived: false,
    onShowArchived: () => undefined,
    archivedCount: 2,
    ...over,
  });

  it("telefonda arama görünür kalır; Kategori ve Arşiv 'Süz' açılırının içindedir (kapalı özet: 'Süz')", () => {
    const html = render(<TopicFilters {...props()} />);
    expect(html).toContain('role="search"');
    expect(html).toContain("Konu ara");
    expect(namesOf(html, "summary")).toEqual(["Süz"]);
    // Kategori ve Arşiv DOM'da, açılırın gövdesindedir
    const body = html.slice(html.indexOf('<div class="details-body">'));
    expect(body).toContain("Kategori");
    expect(body).toContain("Arşivlenenleri göster (2)");
    // arama açılırın dışındadır
    expect(html.indexOf("Konu ara")).toBeLessThan(html.indexOf("<details"));
    expectNoForbidden(html);
  });

  it("etkin süzgeç sayısı kapalı özette yazar; adresten gelen kategori varsa açılır ilk çizimde açık gelir", () => {
    expect(namesOf(render(<TopicFilters {...props({ category: "fy:Ulasim" })} />), "summary")).toEqual(["Süz (1 etkin)"]);
    expect(namesOf(render(<TopicFilters {...props({ category: "fy:Ulasim", showArchived: true })} />), "summary")).toEqual(["Süz (2 etkin)"]);
    expect(render(<TopicFilters {...props({ category: "fy:Ulasim", openAtStart: true })} />)).toMatch(/<details[^>]* open=""/);
    expect(render(<TopicFilters {...props()} />)).not.toMatch(/<details[^>]* open=""/);
  });

  it("'Tam' görünümde açılır açık gelir (içerik gizlenmez, yalnız varsayılan açıklık değişir)", () => {
    setPrefSync(PREF_KEYS.detail, "tam");
    expect(render(<TopicFilters {...props()} />)).toMatch(/<details[^>]* open=""/);
  });

  it("masaüstünde süzgeçler hep görünür: açılır yok; Arşiv onay kutusu yalnız arşivlenmiş konu varsa", () => {
    const html = render(<TopicFilters {...props({ narrow: false })} />);
    expect(html).not.toContain("<details");
    expect(html).toContain("Kategori");
    expect(html).toContain("Arşivlenenleri göster (2)");
    expect(html).toContain("list-filter-wide");
    expect(render(<TopicFilters {...props({ narrow: false, archivedCount: 0 })} />)).not.toContain("Arşivlenenleri göster");
    expect(render(<TopicFilters {...props({ archivedCount: 0 })} />)).not.toContain("Arşivlenenleri göster");
  });

  it("kategori seçeneği alt kategorileri girintiyle gösterir", () => {
    const html = render(<TopicFilters {...props({ narrow: false })} />);
    expect(html).toContain("Tüm kategoriler");
    expect(html).toContain("— Bisiklet");
  });
});

describe("TopicTree satırı (rozet bütçesi)", () => {
  const rows = (html: string) => html.split('<li class="ttree-item').slice(1);
  const colored = (row: string) => (row.match(/badge badge-(?:info|success|warning|danger|accent)/g) ?? []).length;

  it("'sürüm n' yalnız n > 1 ise görünür", () => {
    const html = render(<TopicTree topics={[topic({ id: "a", version: 1 }), topic({ id: "b", seq: 2, version: 3 })]} />);
    expect(html).not.toContain("sürüm 1");
    expect(html).toContain("sürüm 3");
  });

  it("kategoriler en çok 2 ve '+n'; kalan kategoriler ipucunda", () => {
    const cats = ["fy:Ulasim", "fy:Cevre", "fy:Egitim", "fy:Saglik"];
    const html = render(<TopicTree topics={[topic({ categories: cats })]} />);
    expect(html.match(/class="cat-tag"/g)).toHaveLength(2);
    expect(html).toContain("+2");
    expect(html).toContain("kategori daha");
    // Üç kategoriden biri '+1' olur; iki kategori hiç '+n' üretmez
    expect(render(<TopicTree topics={[topic({ categories: cats.slice(0, 2) })]} />)).not.toContain("cat-tag-more");
    expect(render(<TopicTree topics={[topic({ categories: cats.slice(0, 3) })]} />)).toContain("+1");
  });

  it("açık öneri sayısı mavi (info), Arşivlendi ve sayılar gri; mor ve turuncu rozet yok; satırda en çok bir renkli rozet", () => {
    const html = render(
      <TopicTree
        showArchived
        topics={[
          topic({ id: "a", version: 2, childCount: 1, openProposalCount: 3, messageCount: 4 }),
          topic({ id: "b", seq: 2, parentId: "a", status: "archived", openProposalCount: 1 }),
          topic({ id: "c", seq: 3, status: "archived" }),
        ]}
      />,
    );
    expect(html).toMatch(/badge badge-info[^>]*>(?:<svg[\s\S]*?<\/svg>)?3 açık öneri/);
    expect(html).not.toContain("badge-accent");
    expect(html).not.toContain("badge-warning");
    expect(html).toMatch(/badge badge-neutral[^>]*>Arşivlendi/);
    expect(rows(html).length).toBeGreaterThan(0);
    for (const row of rows(html)) expect(colored(row)).toBeLessThanOrEqual(1);
  });

  it("Tümünü aç / Tümünü kapat ve ağaç, alt konu düğmesi aria-expanded ile korunur", () => {
    const html = render(<TopicTree topics={[topic({ id: "a", childCount: 1 }), topic({ id: "b", seq: 2, parentId: "a" })]} />);
    expect(namesOf(html, "button")).toEqual(expect.arrayContaining(["Tümünü aç", "Tümünü kapat"]));
    expect(html).toContain('aria-label="Konu ağacı"');
    expect(html).toContain('aria-expanded="true"');
    // 'Tümünü aç/kapat' Faz 3 öncesinden vardır ve değişmez (yalnız /konular'da; e2e bu sayfada 'Kapat' düğmesi aramaz).
    expectNoForbidden(html, ["Tümünü aç", "Tümünü kapat"]);
  });
});

describe("OpenProposalsCard (Konu ayrıntısı › Açık öneriler)", () => {
  it("açık öneri varsa satırlar bağlantıdır; başlık sayıyı, alt satır türleri söyler", () => {
    const html = render(<OpenProposalsCard myId={null} proposals={[proposal(), proposal({ id: "p2", seq: 13, kind: "subtopic", title: "Kargo bisikleti alt konusu", status: "deliberation", participation: null })]} />);
    expect(html).toContain("Açık öneriler (2)</h2>");
    expect(html).toContain("1 düzenleme teklifi · 1 alt konu önerisi");
    expect(html).toContain('<ul class="prow-list" aria-label="Konunun açık önerileri">');
    expect(html.match(/<a class="prow /g)).toHaveLength(2);
    expect(html).toContain('href="/oneriler/p1"');
    expect(html).toContain("katılım 23/57");
    expect(html).not.toContain("topic-open-empty");
  });

  it("açık öneri yoksa kart tek satırlık başlığa iner: başlık (0) + tek cümle, boş gövde ve liste yok", () => {
    const html = render(<OpenProposalsCard myId={null} proposals={[]} />);
    expect(html).toContain("Açık öneriler (0)</h2>");
    expect(html).toContain("Bu konuya bağlı sonuçlanmamış öneri yok.");
    expect(html).toContain("topic-open-empty");
    expect(html).not.toContain("<ul");
    expect(html).not.toContain('class="empty"');
  });

  it("kendi önerim satırda 'sizin' diye işaretlenir (rozet değil)", () => {
    expect(render(<OpenProposalsCard myId="u-yazar" proposals={[proposal()]} />)).toContain("sizin");
  });

  it("her satır türünü ve yazarını düz metinle söyler (rozet değil); kendi önerimde yazar yerine 'sizin'", () => {
    const html = render(<OpenProposalsCard myId={null} proposals={[proposal(), proposal({ id: "p2", seq: 13, kind: "deletion", title: "Silme talebi: 1 mesaj", status: "sponsoring", participation: null })]} />);
    const rows = [...html.matchAll(/<a class="prow [^"]*"[^>]*>([\s\S]*?)<\/a>/g)].map((m) => m[1].replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim());
    expect(rows[0]).toContain(PROPOSAL_KIND_LABELS.amendment);
    expect(rows[0]).toContain("@yazar");
    expect(rows[1]).toContain(PROPOSAL_KIND_LABELS.deletion);
    expect(rows[1]).toContain("@yazar");
    expect(html).not.toContain("badge");
    const mine = render(<OpenProposalsCard myId="u-yazar" proposals={[proposal()]} />);
    expect(mine).not.toContain("@yazar");
    expect(mine).toContain("prow-detailed");
  });

  it("açık öneri yokken yürürlükteki konuda yönlendirme cümlesi alt başlıkta kalır; arşivde yalnız tek cümle", () => {
    expect(render(<OpenProposalsCard myId={null} proposals={[]} />)).toContain(OPEN_PROPOSALS_EMPTY_HINT);
    expect(render(<OpenProposalsCard myId={null} proposals={[]} active={false} />)).not.toContain("Düzenleme teklif et");
  });

  it("proposalRowDetails (saf): sonuçlanmış satırda tür tekrar edilmez; seçenek yoksa ek parça yok", () => {
    const spec = { extra: null };
    expect(proposalRowDetails(proposal(), spec, {})).toEqual([]);
    expect(proposalRowDetails(proposal(), spec, { kind: true, author: true })).toEqual([PROPOSAL_KIND_LABELS.amendment, "@yazar"]);
    expect(proposalRowDetails(proposal(), { extra: PROPOSAL_KIND_LABELS.amendment }, { kind: true })).toEqual([]);
    expect(proposalRowDetails(proposal(), spec, { author: true, mine: true })).toEqual([]);
  });
});

describe("TopicDetailView (Konu ayrıntısı)", () => {
  const at = (html: string, needle: string) => {
    const i = html.indexOf(needle);
    expect(i, `“${needle}” bulunamadı`).toBeGreaterThanOrEqual(0);
    return i;
  };

  it("bölüm sırası = okuma sırası: metin → Açık öneriler → Tartışma → Alt konular → Sürüm geçmişi", () => {
    const html = render(<TopicDetailView t={detail()} />);
    const order = ['id="konu-metni"', 'id="acik-oneriler"', 'id="tartisma"', 'id="alt-konular"', 'id="surumler"'].map((n) => at(html, n));
    expect([...order].sort((a, b) => a - b)).toEqual(order);
  });

  it("masaüstü yerleşimi: metin, açık öneriler ve tartışma ana sütunda; alt konular ve sürüm geçmişi yan sütunda (aside 'Konu bilgileri')", () => {
    const html = render(<TopicDetailView t={detail()} />);
    const split = at(html, 'class="split topic-split"');
    const main = at(html, 'class="stack topic-main"');
    const aside = at(html, '<aside class="stack topic-aside" aria-label="Konu bilgileri">');
    expect(split).toBeLessThan(main);
    expect(main).toBeLessThan(at(html, 'id="konu-metni"'));
    expect(at(html, 'id="tartisma"')).toBeLessThan(aside);
    expect(aside).toBeLessThan(at(html, 'id="alt-konular"'));
    expect(aside).toBeLessThan(at(html, 'id="surumler"'));
  });

  it("sürüm geçmişi katlanabilir ve sade kipte KAPALI; başlıkta sayı, başlığın dışında hüküm; 'Tam' kipte açık", () => {
    const html = render(<TopicDetailView t={detail()} />);
    expect(html).toMatch(/<button type="button" class="card-toggle" aria-expanded="false"[^>]*>Sürüm geçmişi \(2\)<\/button>/);
    expect(html).toContain("Güncel sürüm 2 · son değişiklik 20 Eyl");
    // gövde DOM'da kalır (hidden): sürüm listesi ve fark kontrolü kaybolmaz
    expect(html).toContain("Sürümleri karşılaştır");
    setPrefSync(PREF_KEYS.detail, "tam");
    expect(render(<TopicDetailView t={detail()} />)).toMatch(/class="card-toggle" aria-expanded="true"[^>]*>Sürüm geçmişi \(2\)/);
  });

  it("metin ClampText ile kısaltılır (DOM'da tam), kategoriler gri etiket; kaynak öneri bağlantısı korunur", () => {
    const html = render(<TopicDetailView t={detail({ categories: ["fy:Ulasim"] })} />);
    expect(html).toContain("clamp-text");
    expect(html).toContain("Kent içi ulaşımın ilkeleri.");
    expect(html).toMatch(/<span class="cat-tag"/);
    expect(html).not.toContain("badge-info");
    expect(html).toContain('href="/oneriler/p-kurucu"');
    expect(html).toContain("kaynak öneriyi görüntüle");
  });

  it("rozet bütçesi: tek renkli durum rozeti (Yürürlükte); numara ve sürüm gri; arşivde hiç renkli rozet yok", () => {
    const meta = (html: string) => html.slice(html.indexOf('class="page-meta"'), html.indexOf("</h1>"));
    const live = meta(render(<TopicDetailView t={detail()} />));
    expect(live.match(/badge badge-(?:info|success|warning|danger|accent)/g)).toEqual(["badge badge-success"]);
    expect(live).toMatch(/badge badge-neutral[^>]*>Sürüm 2/);
    const archived = meta(render(<TopicDetailView t={detail({ status: "archived" })} />));
    expect(archived).not.toMatch(/badge badge-(?:info|success|warning|danger|accent)/);
    expect(archived).toContain("Arşivlendi");
  });

  it("alt konu kısa yolu: alt konu varsa sayfa başlığında ?bolum=alt-konular bağlantısı (replace), yoksa hiç çıkmaz", () => {
    const html = render(<TopicDetailView t={detail()} />);
    expect(html).toContain('class="topic-jump"');
    expect(html).toContain('href="/konular/t1?bolum=alt-konular"');
    expect(namesOf(html, "a")).toContain("2 alt konu bölümüne git");
    expect(render(<TopicDetailView t={detail({ children: [], childCount: 0 })} />)).not.toContain("topic-jump");
  });

  it("'Alt konu öner' ve 'Düzenleme teklif et' yalnız yürürlükteki konuda; alt konular listesi ve kaynak bağlantılar korunur", () => {
    const html = render(<TopicDetailView t={detail()} />);
    expect(namesOf(html, "a")).toEqual(expect.arrayContaining(["Alt konu öner", "Düzenleme teklif et"]));
    expect(html).toContain("Alt konular (2)</h2>");
    expect(html).toContain('href="/konular/t2"');
    expect(html).toContain("0 alt konu · 2 mesaj · 0 açık öneri");
    const archived = render(<TopicDetailView t={detail({ status: "archived" })} />);
    expect(namesOf(archived, "a")).not.toContain("Alt konu öner");
    expect(archived).toContain("Bu konu arşivlendi; yeni mesaj yazılamaz.");
  });

  it("alt konu yokken 'Henüz alt konu yok.'; açık öneri yokken tek satırlık kart", () => {
    const html = render(<TopicDetailView t={detail({ children: [], childCount: 0, openProposals: [], openProposalCount: 0 })} />);
    expect(html).toContain("Henüz alt konu yok.");
    expect(html).toContain("Açık öneriler (0)</h2>");
    expect(html).toContain("topic-open-empty");
  });

  it("tartışma açılır içine alınmaz (Section #tartisma, başlık 'Tartışma'); e2e'nin aradığı ad ve bölge dizeleri çakışmaz", () => {
    const html = render(<TopicDetailView t={detail()} />);
    expect(html).toMatch(/<section class="section" id="tartisma"/);
    expect(html).not.toMatch(/<details[^>]*id="tartisma"/);
    expectNoForbidden(html);
  });
});
