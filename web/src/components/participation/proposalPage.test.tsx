// Öneri sayfası iskeleti (Faz 2 / madde 2): 'Bu sayfada' bölüm listesi, eylem alanı ve ?bolum=eylem odağı, kanıt sütununun
// sırası ve 'Tümünü aç' düğmesi, Sıradaki adım kartının çizimi (sunucu tarafı çizim, DOM gerekmez).
// e2e sözleşmeleri: kartın bölge adı 'Sıradaki adım', kartta <button> yok, yeni ad ve etiketlerde yasak alt dizeler yok.
import type { ExpertPanelInfo, ProposalDetail, ProposalStatus, Suggestion } from "@forum/shared";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DetailLevelProvider } from "../../lib/detailLevel";
import { proposalNextStep, type NextStep, type Viewer } from "../../lib/nextStep";
import { PREF_KEYS, removePref, setPrefSync } from "../../lib/prefs";
import { NextStepCard, nextStepCtaVariant, nextStepLinkIcon } from "../common/NextStepCard";
import { allSectionsOpen, EvidenceColumn, evidenceOrder, toggleAllLabel } from "./EvidenceColumn";
import { actionFocusSelector, hasActionArea, OnThisPage, PAGE_ANCHORS, proposalPageSections, showsExpertCard, SUGGESTION_DECISION } from "./OnThisPage";

vi.mock("../../auth/AuthContext", () => ({
  useAuth: () => ({ can: () => true, user: null, now: () => Date.UTC(2026, 9, 2) }),
  useServerNow: () => () => Date.UTC(2026, 9, 2),
}));

const render = (el: React.ReactElement) =>
  renderToStaticMarkup(
    <DetailLevelProvider>
      <MemoryRouter>{el}</MemoryRouter>
    </DetailLevelProvider>,
  );

const ALL_STATUSES: ProposalStatus[] = [
  "draft",
  "sponsoring",
  "deliberation",
  "voting",
  "objection_window",
  "reconciliation",
  "revote",
  "enacted",
  "rejected",
  "withdrawn",
  "expired",
  "inadmissible",
];
const TERMINAL: ProposalStatus[] = ["enacted", "rejected", "withdrawn", "expired", "inadmissible"];

/** e2e'nin aradığı adlarla çakışan alt dizeler (plan 'Test sözleşmeleri' b, d); büyük/küçük harf duyarsız (Playwright gibi). */
const FORBIDDEN_NAMES = ["Destekle", "Oyumu ver", "Daha fazla", "Sayımı kendim doğrulayayım", "Kapat", "Oylama", "Uzlaşma turu", "Azınlık raporları", "Destekçiler (", "1. tur sonucu", "Azınlık itirazı"];
const contains = (s: string, part: string) => s.toLocaleLowerCase("tr").includes(part.toLocaleLowerCase("tr"));

type Over = Partial<ProposalDetail>;
const proposal = (over: Over = {}): ProposalDetail =>
  ({
    id: "p1",
    status: "voting",
    kind: "topic",
    authorId: "u-yazar",
    expertPanel: null,
    results: [],
    suggestions: [],
    ...over,
  }) as ProposalDetail;

const suggestion = (status: Suggestion["status"]): Suggestion =>
  ({ id: `s-${status}`, proposalId: "p1", authorId: "u-diger", authorNickname: "diger", body: "x", status, createdAt: 1, decidedAt: null }) as Suggestion;

describe("'Bu sayfada' bölüm listesi", () => {
  it("yalnız var olan bölümler, sayfadaki sırayla; tartışma sayısı başlıkta", () => {
    const voting = proposalPageSections(proposal({ status: "voting" }), 6);
    expect(voting.map((s) => s.label)).toEqual(["Metin", "Oy ver", "Bilirkişi", "Tartışma (6)", "Kanıtlar"]);
    expect(voting.map((s) => s.anchor)).toEqual(["metin", "eylem", "bilirkisi", "tartisma", "kanitlar"]);

    const enacted = proposalPageSections(proposal({ status: "enacted", results: [{ round: 1 }] as ProposalDetail["results"], expertPanel: {} as ExpertPanelInfo }), 4);
    expect(enacted.map((s) => s.label)).toEqual(["Metin", "Sonuç", "Bilirkişi", "Tartışma (4)", "Kanıtlar"]);

    // Bilirkişisiz kapanmış öneri ve taslak: bilirkişi kartı yok, sonuç yok.
    expect(proposalPageSections(proposal({ status: "rejected" }), 0).map((s) => s.anchor)).toEqual(["metin", "tartisma", "kanitlar"]);
    expect(proposalPageSections(proposal({ status: "draft" }), 0).map((s) => s.label)).toEqual(["Metin", "Taslak", "Tartışma (0)", "Kanıtlar"]);
  });

  it("eylem etiketi evreye göre; terminal evrelerde eylem alanı yok", () => {
    const label = (status: ProposalStatus) => proposalPageSections(proposal({ status }), 0).find((s) => s.anchor === "eylem")?.label;
    expect(label("sponsoring")).toBe("Destek");
    expect(label("deliberation")).toBe("Metin önerileri");
    expect(label("voting")).toBe("Oy ver");
    expect(label("revote")).toBe("Oy ver");
    expect(label("objection_window")).toBe("İtiraz");
    expect(label("reconciliation")).toBe("Uzlaşma");
    for (const s of ALL_STATUSES) {
      expect(hasActionArea(s), s).toBe(!TERMINAL.includes(s));
      expect(label(s) !== undefined, s).toBe(!TERMINAL.includes(s));
    }
  });

  it("bilirkişi kartı: taslakta yok; panel varsa hep; panel yoksa yalnız açık ve silme dışı öneride (talep edilebilir)", () => {
    expect(showsExpertCard(proposal({ status: "draft", expertPanel: {} as ExpertPanelInfo }))).toBe(false);
    expect(showsExpertCard(proposal({ status: "enacted", expertPanel: {} as ExpertPanelInfo }))).toBe(true);
    expect(showsExpertCard(proposal({ status: "enacted" }))).toBe(false);
    expect(showsExpertCard(proposal({ status: "deliberation" }))).toBe(true);
    expect(showsExpertCard(proposal({ status: "deliberation", kind: "deletion" }))).toBe(false);
  });

  it("etiketler e2e adlarıyla çakışmaz; çapalar geçerli ve benzersiz", () => {
    for (const status of ALL_STATUSES) {
      const list = proposalPageSections(proposal({ status, results: [{ round: 1 }] as ProposalDetail["results"], expertPanel: {} as ExpertPanelInfo }), 12);
      expect(new Set(list.map((s) => s.anchor)).size).toBe(list.length);
      for (const s of list) {
        expect(s.anchor).toMatch(/^[a-z]+$/);
        for (const bad of FORBIDDEN_NAMES) expect(contains(s.label, bad), `${status}: ${s.label} ⊃ ${bad}`).toBe(false);
      }
    }
  });

  it("gezinme: nav 'Bu sayfada', bağlantılar ?bolum= ile", () => {
    const html = render(<OnThisPage proposalId="p1" sections={proposalPageSections(proposal({ status: "voting" }), 3)} />);
    expect(html).toContain('<nav class="on-this-page" aria-label="Bu sayfada">');
    expect(html).toContain('href="/oneriler/p1?bolum=tartisma"');
    expect(html).toContain("Tartışma (3)");
    expect(html).not.toContain("<button");
    expect(render(<OnThisPage proposalId="p1" sections={[]} />)).toBe("");
  });
});

describe("?bolum=eylem odağı", () => {
  it("oylamada ilk radyo, itirazda 'Gerekçe' alanı, diğer evrelerde varsayılan (ilk görünür denetim)", () => {
    expect(actionFocusSelector(proposal({ status: "voting" }), "u-ben")).toBe('input[type="radio"]:not([disabled])');
    expect(actionFocusSelector(proposal({ status: "revote" }), null)).toBe('input[type="radio"]:not([disabled])');
    expect(actionFocusSelector(proposal({ status: "objection_window" }), "u-ben")).toBe("select:not([disabled])");
    for (const s of ["draft", "sponsoring", "reconciliation", ...TERMINAL] as ProposalStatus[]) {
      expect(actionFocusSelector(proposal({ status: s }), "u-ben"), s).toBeUndefined();
    }
  });

  it("tartışma evresinde yalnız yazar ve yanıt bekleyen öneri varsa önerinin karar düğmesi", () => {
    const open = proposal({ status: "deliberation", suggestions: [suggestion("rejected"), suggestion("open")] });
    expect(actionFocusSelector(open, "u-yazar")).toBe(SUGGESTION_DECISION);
    expect(actionFocusSelector(open, "u-ben")).toBeUndefined();
    expect(actionFocusSelector(open, null)).toBeUndefined();
    expect(actionFocusSelector(proposal({ status: "deliberation", suggestions: [suggestion("accepted")] }), "u-yazar")).toBeUndefined();
  });

  it("çapa adları motorun beklediği id'lerle aynı", () => {
    expect(PAGE_ANCHORS).toMatchObject({ action: "eylem", results: "sonuclar", verify: "dogrula", expert: "bilirkisi", discussion: "tartisma" });
  });
});

describe("kanıt sütunu", () => {
  beforeEach(async () => {
    await removePref(PREF_KEYS.detail);
  });

  it("olağan sıra: Destekçiler · zaman çizelgesi · ontoloji · parametreler · sürüm · defter", () => {
    expect(evidenceOrder({ integrity: false, auditProblem: false })).toEqual(["destekciler", "evreler", "ontoloji", "parametreler", "surumler", "defter"]);
  });

  it("uyarı yalnız gerektiğinde bağırır: bütünlük uyarısı en üstte, aykırılıkta ontoloji Destekçiler'in önünde; her kart bir kez", () => {
    expect(evidenceOrder({ integrity: true, auditProblem: false })).toEqual(["butunluk", "destekciler", "evreler", "ontoloji", "parametreler", "surumler", "defter"]);
    expect(evidenceOrder({ integrity: false, auditProblem: true })).toEqual(["ontoloji", "destekciler", "evreler", "parametreler", "surumler", "defter"]);
    const both = evidenceOrder({ integrity: true, auditProblem: true });
    expect(both.slice(0, 2)).toEqual(["butunluk", "ontoloji"]);
    expect(new Set(both).size).toBe(both.length);
  });

  it("'Tümünü aç' / 'Tümünü katla': gerçek kart durumundan; adında 'Kapat' yok", () => {
    const root = (cards: number, closed: number) =>
      ({
        querySelector: (sel: string) => (sel.includes(":not(.is-open)") ? (closed ? {} : null) : cards ? {} : null),
      }) as unknown as ParentNode;
    expect(allSectionsOpen(root(0, 0))).toBeNull();
    expect(allSectionsOpen(root(3, 1))).toBe(false);
    expect(allSectionsOpen(root(3, 0))).toBe(true);
    expect(toggleAllLabel(false)).toBe("Tümünü aç");
    expect(toggleAllLabel(true)).toBe("Tümünü katla");
    for (const l of [toggleAllLabel(false), toggleAllLabel(true)]) for (const bad of FORBIDDEN_NAMES) expect(contains(l, bad)).toBe(false);
  });

  it("sütun: complementary bölge 'Kanıtlar ve denetim' (#kanitlar); sade kipte 'Tümünü aç', tam kipte 'Tümünü katla'", () => {
    const html = render(
      <EvidenceColumn>
        <p>kart</p>
      </EvidenceColumn>,
    );
    expect(html).toMatch(/<aside class="stack evidence" id="kanitlar" aria-labelledby="[^"]+">/);
    expect(html).toContain("Kanıtlar ve denetim</h2>");
    expect(html).toContain("Tümünü aç</button>");
    setPrefSync(PREF_KEYS.detail, "tam");
    expect(
      render(
        <EvidenceColumn>
          <p>kart</p>
        </EvidenceColumn>,
      ),
    ).toContain("Tümünü katla</button>");
  });
});

const step = (over: Partial<NextStep> = {}): NextStep => ({ tone: "action", headline: "Oyunuz bekleniyor", links: [], ...over });

describe("Sıradaki adım kartı", () => {
  it("bölge adı 'Sıradaki adım'; birincil eylem bir BAĞLANTIDIR (düğme yok), çapa ?bolum= ile", () => {
    const html = render(
      <NextStepCard
        proposalId="p1"
        step={step({ detail: "Oy gizlidir.", cta: { label: "Oy bölümüne git", bolum: "eylem" }, links: [{ label: "Bilirkişi: 2 rapor", bolum: "bilirkisi" }] })}
      />,
    );
    const id = /<section class="next-step next-step-action" aria-labelledby="([^"]+)">/.exec(html)?.[1];
    expect(id).toBeTruthy();
    expect(html).toContain(`<h2 class="next-step-label" id="${id}">Sıradaki adım</h2>`);
    expect(html).not.toContain("<button");
    expect(html).toMatch(/<a class="btn btn-primary btn-sm next-step-cta" href="\/oneriler\/p1\?bolum=eylem"[^>]*>Oy bölümüne git/);
    expect(html).toContain('href="/oneriler/p1?bolum=bilirkisi"');
    expect(html).toContain("Oy gizlidir.");
  });

  it("uygulama içi hedefler olduğu gibi; nötr/bilgi tonunda birincil eylem ikincil görünümde", () => {
    const html = render(<NextStepCard proposalId="p1" step={step({ tone: "info", headline: "Oy için giriş yapın", cta: { label: "Giriş yap", to: "/giris" } })} />);
    expect(html).toMatch(/<a class="btn btn-secondary btn-sm next-step-cta" href="\/giris"/);
    expect(nextStepCtaVariant("action")).toBe("primary");
    expect(nextStepCtaVariant("success")).toBe("primary");
    expect(nextStepCtaVariant("warning")).toBe("secondary");
    expect(nextStepLinkIcon({ label: "x", bolum: "eylem" })).toBe("chevronDown");
    expect(nextStepLinkIcon({ label: "x", to: "/giris" })).toBe("login");
    expect(nextStepLinkIcon({ label: "x", to: "/konular/t1" })).toBe("topics");
    expect(nextStepLinkIcon({ label: "x", to: "/yonetmelik" })).toBe("book");
    expect(nextStepLinkIcon({ label: "x", to: "/profil" })).toBe("user");
    expect(nextStepLinkIcon({ label: "x", to: "/bilirkisiler?sekme=gorevlerim" })).toBe("experts");
  });

  it("oturum yüklenirken cümle çizilmez (anonim görünmesin); süre satırı yine durur", () => {
    const html = render(<NextStepCard proposalId="p1" step={null} deadline={<span>Kalan 2 sa</span>} />);
    expect(html).toContain('aria-busy="true"');
    expect(html).toContain("Durumunuz yükleniyor…");
    expect(html).toContain("Kalan 2 sa");
    expect(html).not.toContain("next-step-headline");
  });

  it("motorun ürettiği her adım düğmesiz çizilir ve e2e metinlerini tekrarlamaz", () => {
    const viewers: Viewer[] = [
      { id: null, status: null, can: { V: false, VV: false, D: false, A: false }, politicalConsent: false, isAdult: false },
      { id: "u-ben", status: "verified", can: { V: true, VV: true, D: false, A: false }, politicalConsent: true, isAdult: true },
      { id: "u-yazar", status: "verified", can: { V: true, VV: true, D: true, A: false }, politicalConsent: true, isAdult: true },
    ];
    for (const status of ALL_STATUSES) {
      for (const v of viewers) {
        const p = {
          ...proposal({ status }),
          sponsorCount: 1,
          sponsorsRequired: 3,
          sponsors: [],
          messageCount: 2,
          events: [{ from: "voting", to: status, at: 5, reason: "Sonuç açıklandı.", ledgerTx: null }],
          objections: [],
          minorityReports: [],
          integrityWarnings: [],
          audit: null,
          myBallot: null,
          canVote: true,
          canObject: false,
          canWriteMinorityReport: false,
          enactedEntityId: "t1",
          deletion: null,
        } as unknown as ProposalDetail;
        const html = render(<NextStepCard proposalId="p1" step={proposalNextStep(p, v)} />);
        expect(html, status).not.toContain("<button");
        expect(html, status).toContain(">Sıradaki adım</h2>");
        for (const t of ["✔ Bu öneriyi desteklediniz.", "✔ Makbuz bu cihazda kayıtlı", "1. tur sonucu", "Uzlaşma turu"]) expect(html, `${status}: ${t}`).not.toContain(t);
      }
    }
  });
});
