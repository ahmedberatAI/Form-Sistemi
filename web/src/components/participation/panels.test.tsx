// Eylem panelleri ('eylem önce'): oy, destek, itiraz, uzlaşma, metin önerileri ve hak etkisi. Saf işlevler (hüküm cümleleri, sıra,
// kısaltma) ve sunucu tarafı çizimle DOM sırası, açılırların yeri ve e2e sözleşmeleri denetlenir (DOM gerekmez).
// e2e/tests/02-oylama, 03-silme ve 04-itiraz-uzlasma'nın dayandığı adlar (bölge, düğme, etiket, metin) burada da kilitlenir.
import type { DecisionParams, ProposalDetail } from "@forum/shared";
import { renderToStaticMarkup } from "react-dom/server";
import { MemoryRouter } from "react-router-dom";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { DetailLevelProvider } from "../../lib/detailLevel";
import { PREF_KEYS, removePref, setPrefSync } from "../../lib/prefs";
import { ToastProvider } from "../../ui/Toast";
import { ObjectionPanel, objectionRules, OBJECTION_INTRO } from "./ObjectionPanel";
import { MinorityReportForm, ReconciliationPanel, reconciliationBlockOrder, reconciliationOriginNotice } from "./ReconciliationPanel";
import { groupRightsFlags, RightsFlags, rightsFlagSummary } from "./RightsFlags";
import { SponsorPanel } from "./SponsorPanel";
import { previewSuggestions, SUGGESTION_PREVIEW, SuggestionsPanel } from "./SuggestionsPanel";
import { delegationNote, VotePanel, voteFormHint } from "./VotePanel";

const NOW = Date.UTC(2026, 9, 2, 12);

const h = vi.hoisted(() => ({
  auth: { user: null as { id: string } | null, can: (_perm: string): boolean => true, isExpert: false, isAdmin: false },
}));

vi.mock("../../auth/AuthContext", () => ({
  useAuth: () => ({ ...h.auth, now: () => Date.UTC(2026, 9, 2, 12) }),
  useServerNow: () => () => Date.UTC(2026, 9, 2, 12),
}));

const R = (num: number, den: number) => ({ num, den });
const params = {
  tier: "T0",
  overrideThreshold: R(2, 3),
  revoteThreshold: R(3, 5),
  delegationMaxHops: 3,
  requiresExpert: false,
} as unknown as DecisionParams;

const noop = () => undefined;
const proposal = (over: Record<string, unknown> = {}): ProposalDetail =>
  ({
    id: "p1",
    seq: 7,
    title: "Kütüphane hafta sonu açık olsun",
    body: "Belediye kütüphanesi cumartesi ve pazar günleri de açık kalsın.",
    kind: "topic",
    version: 2,
    parentTopicId: null,
    status: "voting",
    authorId: "u-author",
    authorNickname: "yazar",
    phaseEndsAt: NOW + 3_600_000,
    sponsors: [],
    sponsorCount: 1,
    sponsorsRequired: 3,
    canVote: true,
    canObject: false,
    myBallot: null,
    participation: { voted: 3, eligible: 10 },
    params,
    expertPanel: null,
    reconciliationOrigin: null,
    objections: [],
    objectionEvaluation: null,
    minorityReports: [],
    canWriteMinorityReport: false,
    aiAnalyses: [],
    suggestions: [],
    versions: [],
    rightsFlags: [],
    audit: null,
    ...over,
  }) as unknown as ProposalDetail;

const ballot = {
  choice: "yes",
  receipt: { ballotId: "b".repeat(64), commitment: "c".repeat(64), txHash: "d".repeat(64), castAt: NOW - 60_000, choice: "yes" },
};

const evaluation = (over: Record<string, unknown> = {}) => ({
  valid: true,
  rule: "cluster",
  strong: false,
  signers: 7,
  crossClusterRequired: 6,
  explanation: "Sunucu açıklaması.",
  perCluster: [{ clusterId: "A", signers: 4, noVoters: 5, required: 4 }],
  ...over,
});

const objection = (id: string, over: Record<string, unknown> = {}) => ({
  id,
  userId: null,
  nickname: "Anonim imzacı",
  clusterId: "A",
  ground: "https://forumsistemi.org/ont#OrantisizAzinlikEtkisi",
  statement: "Gerekçeli açıklama metni.",
  at: NOW - 1000,
  ...over,
});

const suggestion = (id: string, status: string, createdAt: number) => ({
  id,
  authorId: `u-${id}`,
  authorNickname: `yazar_${id}`,
  body: "Önerilen yeni metin.",
  status,
  createdAt,
});

const render = (el: React.ReactElement) =>
  renderToStaticMarkup(
    <DetailLevelProvider>
      <ToastProvider>
        <MemoryRouter>{el}</MemoryRouter>
      </ToastProvider>
    </DetailLevelProvider>,
  );

const text = (s: string) => s.replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
const namesOf = (html: string, tag: "a" | "button" | "summary") =>
  [...html.matchAll(new RegExp(`<${tag}\\b[^>]*>([\\s\\S]*?)</${tag}>`, "g"))].map((m) => text(m[1]));
const ariaLabels = (html: string) => [...html.matchAll(/aria-label="([^"]*)"/g)].map((m) => m[1]);
/** Düğme/bağlantı/özet adları ve aria-label'lar: e2e'nin aradığı adlarla çakışma denetimi için. */
const allNames = (html: string) => [...namesOf(html, "a"), ...namesOf(html, "button"), ...namesOf(html, "summary"), ...ariaLabels(html)];
const at = (html: string, needle: string) => {
  const i = html.indexOf(needle);
  expect(i, `'${needle}' çıktıda bulunamadı`).toBeGreaterThanOrEqual(0);
  return i;
};
const firstDetails = (html: string) => {
  const i = html.indexOf("<details");
  return i < 0 ? html.length : i;
};

beforeEach(async () => {
  await removePref(PREF_KEYS.detail);
  h.auth.user = { id: "u-me" };
  h.auth.can = () => true;
  h.auth.isExpert = false;
  h.auth.isAdmin = false;
});

describe("saf işlevler", () => {
  it("voteFormHint ve delegationNote: değiştirme kuralı ve doğrudan oy önceliği ipucunda, vekâlet ayrıntısı (adım sayısı) açıklamada", () => {
    const hint = voteFormHint();
    expect(hint).toContain("Süre bitene kadar değiştirebilirsiniz");
    expect(hint).toContain("Doğrudan oy vekâletin önüne geçer");
    expect(delegationNote(3)).toContain("varsa vekâletiniz uygulanır (en fazla 3 adım)");
    expect(delegationNote(5)).toContain("en fazla 5 adım");
    expect(delegationNote(3)).toContain("bu oylamada askıya alınır");
  });

  it("rightsFlagSummary: işaretli hak yok / n hak (aynı hak iki yönde bir sayılır)", () => {
    expect(rightsFlagSummary([])).toBe("İşaretlenmiş hak yok");
    expect(rightsFlagSummary([{ right: "a" }])).toBe("1 hak işaretli · katmanı yükseltir");
    expect(rightsFlagSummary([{ right: "a" }, { right: "a" }, { right: "b" }])).toBe("2 hak işaretli · katmanı yükseltir");
  });

  it("groupRightsFlags: (hak, yön) çiftine göre gruplar, kaynaklar sabit sırada", () => {
    const g = groupRightsFlags([
      { right: "a", direction: "restrict", source: "member" },
      { right: "a", direction: "restrict", source: "author" },
      { right: "a", direction: "expand", source: "ai" },
    ] as never);
    expect(g).toEqual([
      { right: "a", direction: "restrict", sources: ["author", "member"] },
      { right: "a", direction: "expand", sources: ["ai"] },
    ]);
  });

  it("previewSuggestions: en çok 3 öneri görünür; karar bekleyenler gizlenmez; açılınca hepsi", () => {
    const list = ["a", "b", "c", "d", "e"];
    expect(SUGGESTION_PREVIEW).toBe(3);
    expect(previewSuggestions(list.slice(0, 3), { expanded: false })).toEqual({ shown: ["a", "b", "c"], hidden: 0 });
    expect(previewSuggestions(list, { expanded: false })).toEqual({ shown: ["a", "b", "c"], hidden: 2 });
    expect(previewSuggestions(list, { expanded: true })).toEqual({ shown: list, hidden: 0 });
    // sıra korunur; 'e' karar bekliyor → kısaltmada da görünür
    expect(previewSuggestions(list, { expanded: false, keep: (s) => s === "e" })).toEqual({ shown: ["a", "b", "c", "e"], hidden: 1 });
    expect(previewSuggestions(list, { expanded: false, keep: () => true })).toEqual({ shown: list, hidden: 0 });
  });

  it("reconciliationBlockOrder: etkin uzlaşmada yazar taslaklarla, rapor yazabilen üye raporlarla başlar", () => {
    expect(reconciliationBlockOrder({ active: true, isAuthor: false, canWriteReport: false })).toEqual(["reports", "drafts"]);
    expect(reconciliationBlockOrder({ active: true, isAuthor: false, canWriteReport: true })).toEqual(["reports", "drafts"]);
    expect(reconciliationBlockOrder({ active: true, isAuthor: true, canWriteReport: false })).toEqual(["drafts", "reports"]);
    expect(reconciliationBlockOrder({ active: true, isAuthor: true, canWriteReport: true })).toEqual(["reports", "drafts"]);
    expect(reconciliationBlockOrder({ active: false, isAuthor: true, canWriteReport: false })).toEqual(["reports", "drafts"]);
  });

  it("reconciliationOriginNotice: itiraz kökeni ve tartışmalı sonuç; oranlar parametrelerden", () => {
    const o = reconciliationOriginNotice("objection", params);
    expect(o.title).toBe("Köken: geçerli azınlık itirazı");
    expect(o.requirement).toBe("Yeniden oylamada onay oranı en az %60 olmalı (güçlü itirazda en az 2/3).");
    expect(o.cause).toContain("geçerli bir azınlık itirazı geldi");
    const c = reconciliationOriginNotice("contested", params);
    expect(c.title).toBe("Köken: tartışmalı sonuç (köprü testi sağlanamadı)");
    expect(c.requirement).toContain("köprü testi ya da en az %66,7 onay gerekir");
    // parametre yoksa simge; bilinmeyen köken tartışmalı sayılır
    expect(reconciliationOriginNotice("objection", null).requirement).toContain("en az ρ");
    expect(reconciliationOriginNotice(null, undefined).requirement).toContain("en az ω");
  });

  it("objectionRules: (a), (b), güçlü itiraz; (b)'deki sayı değerlendirme yoksa yazılmaz", () => {
    const withN = objectionRules(12);
    expect(withN).toHaveLength(3);
    expect(withN[0]).toMatch(/^\(a\)/);
    expect(withN[1]).toContain("≥ 12");
    expect(withN[2]).toContain("güçlü itiraz");
    expect(objectionRules(undefined)[1]).not.toContain("≥");
  });
});

describe("VotePanel", () => {
  it("oy formu bilgi kutularının üstünde: katılım → tek satır not → radyolar → Oyumu ver → açılır", () => {
    const html = render(<VotePanel proposal={proposal()} setProposal={noop} reload={noop} />);
    const order = ["Katılım", "Ara sonuç gösterilmez; yalnız katılım görünür.", 'type="radio"', "Oyumu ver", "Gizli oy ve vekâlet nasıl işler?"].map((s) => at(html, s));
    expect(order).toEqual([...order].sort((a, b) => a - b));
    // eski bilgi Alert'i ve altyazı yok; açıklama paragrafı açılırın içinde
    expect(html).not.toContain("alert-info");
    expect(at(html, "Gizli oy: oyunuz deftere yalnızca taahhüt")).toBeGreaterThan(at(html, "<details"));
    // form ilk açılırdan önce
    expect(at(html, "Oyumu ver")).toBeLessThan(firstDetails(html));
    // vekâlet cümlesi RadioGroup ipucunda; adım sayısı ve ayrıntı açılırda (alttaki ayrı görünür paragraf yok)
    expect(html).toContain(voteFormHint());
    expect(at(html, delegationNote(3))).toBeGreaterThan(at(html, "<details"));
  });

  it("oy verilmişse makbuz satırı Details DIŞINDA, hash'ler 'Makbuz ayrıntıları' açılırında", () => {
    const html = render(<VotePanel proposal={proposal({ myBallot: ballot })} setProposal={noop} reload={noop} />);
    const firstDetail = firstDetails(html);
    expect(at(html, "Oyumu değiştir")).toBeLessThan(at(html, "Geçerli oyunuz"));
    expect(at(html, "Geçerli oyunuz")).toBeLessThan(firstDetail);
    // 'Oyum kayıtlı mı?' bağlantısı (02:216) ve makbuz kaydı düğmesi/işareti açılır dışında
    expect(at(html, "Oyum kayıtlı mı?")).toBeLessThan(firstDetail);
    expect(at(html, "Makbuzu bu cihaza kaydet")).toBeLessThan(firstDetail);
    expect(html).toContain('class="receipt-box');
    // hash'ler açılırın içinde
    expect(namesOf(html, "summary")).toContain("Makbuz ayrıntıları (pusula, taahhüt, defter işlemi)");
    expect(at(html, "Oy pusulası kimliği")).toBeGreaterThan(at(html, "Makbuz ayrıntıları"));
    expect(at(html, "Taahhüt")).toBeGreaterThan(at(html, "Makbuz ayrıntıları"));
  });

  it("anonim ve oy veremeyen üye: form yok, açıklama Alert'i var", () => {
    h.auth.user = null;
    const anon = render(<VotePanel proposal={proposal()} setProposal={noop} reload={noop} />);
    expect(anon).toContain("Oy vermek için giriş yapın");
    expect(anon).not.toContain("Oyumu ver");
    h.auth.user = { id: "u-me" };
    h.auth.can = (perm) => perm !== "VV";
    const blocked = render(<VotePanel proposal={proposal({ canVote: false })} setProposal={noop} reload={noop} />);
    expect(blocked).toContain("Bu oylamada oy veremiyorsunuz");
    expect(blocked).toContain("Profil → Rızalar");
    expect(blocked).not.toContain('type="radio"');
  });

  it("bölge adı ve yeniden oylama: 'Oylama' / 'Yeniden oylama', eşik paragrafı ve 'Sonuç kesindir.' görünür", () => {
    expect(render(<VotePanel proposal={proposal()} setProposal={noop} reload={noop} />)).toMatch(/<h2[^>]*>Oylama<\/h2>/);
    const html = render(<VotePanel proposal={proposal({ status: "revote", reconciliationOrigin: "objection" })} setProposal={noop} reload={noop} />);
    expect(html).toMatch(/<h2[^>]*>Yeniden oylama<\/h2>/);
    expect(html).toContain("en az %60 olmalı");
    expect(at(html, "Sonuç kesindir.")).toBeLessThan(firstDetails(html));
  });

  it("bilirkişi askı uyarısı ve 'rapor gelmedi' uyarısı görünür kalır", () => {
    const susp = render(<VotePanel proposal={proposal({ expertPanel: { suspensiveFlag: true, reports: [] } })} setProposal={noop} reload={noop} />);
    expect(susp).toContain("Bilirkişi askı uyarısı");
    const missing = render(<VotePanel proposal={proposal({ params: { ...params, requiresExpert: true }, expertPanel: { suspensiveFlag: false, reports: [] } })} setProposal={noop} reload={noop} />);
    expect(missing).toContain("süre içinde rapor gelmedi");
  });
});

describe("SponsorPanel", () => {
  it("'Destekle' düğmesi ilerleme çubuğunun hemen altında, K_s formülü açılırda", () => {
    const html = render(<SponsorPanel proposal={proposal({ status: "sponsoring" })} onUpdated={noop} />);
    const order = ["Destekçi", "Destekle", "Destek oy değildir", "Kaç destekçi gerekir?"].map((s) => at(html, s));
    expect(order).toEqual([...order].sort((a, b) => a - b));
    expect(at(html, "Destekle")).toBeLessThan(firstDetails(html));
    expect(at(html, "K_s = max(2, min(5")).toBeGreaterThan(at(html, "<details"));
    expect(at(html, "Yeterli destekçi gelince")).toBeGreaterThan(at(html, "<details"));
  });

  it("sayfada tek 'Destekle' düğmesi; desteklemiş üyede '✔ Bu öneriyi desteklediniz.' bir kez, düğme yok", () => {
    const fresh = render(<SponsorPanel proposal={proposal({ status: "sponsoring" })} onUpdated={noop} />);
    expect(namesOf(fresh, "button").filter((n) => n.toLowerCase().includes("destekle"))).toEqual(["Destekle"]);
    expect(fresh).not.toContain("✔ Bu öneriyi desteklediniz.");
    const done = render(<SponsorPanel proposal={proposal({ status: "sponsoring", sponsors: [{ userId: "u-me", nickname: "ben", at: NOW }] })} onUpdated={noop} />);
    expect(done.match(/✔ Bu öneriyi desteklediniz\./g)).toHaveLength(1);
    expect(namesOf(done, "button").filter((n) => n.toLowerCase().includes("destekle"))).toEqual([]);
  });

  it("yazar, anonim ve doğrulanmamış üye için düğme çıkmaz", () => {
    h.auth.user = { id: "u-author" };
    const author = render(<SponsorPanel proposal={proposal({ status: "sponsoring" })} onUpdated={noop} />);
    expect(author).toContain("Kendi önerinizi destekleyemezsiniz");
    expect(namesOf(author, "button")).toEqual(["Geri çek"]);
    h.auth.user = null;
    expect(render(<SponsorPanel proposal={proposal({ status: "sponsoring" })} onUpdated={noop} />)).toContain("Desteklemek için giriş yapın");
    h.auth.user = { id: "u-me" };
    h.auth.can = () => false;
    expect(render(<SponsorPanel proposal={proposal({ status: "sponsoring" })} onUpdated={noop} />)).toContain("Yalnızca doğrulanmış üyeler destek verebilir");
  });

  it("taslak: işlem düğmeleri açıklama paragrafının önünde", () => {
    h.auth.user = { id: "u-author" };
    const html = render(<SponsorPanel proposal={proposal({ status: "draft" })} onUpdated={noop} />);
    expect(at(html, "Destekçi toplamaya gönder")).toBeLessThan(at(html, "Gönderdiğinizde öneri destekçi toplamaya başlar"));
    expect(namesOf(html, "button")).toEqual(["Destekçi toplamaya gönder", "Metni düzenle", "Geri çek"]);
  });
});

describe("ObjectionPanel", () => {
  const objectionProposal = (over: Record<string, unknown> = {}) =>
    proposal({
      status: "objection_window",
      canObject: true,
      objectionEvaluation: evaluation(),
      objections: [objection("o1"), objection("o2", { userId: "u-me", nickname: "ben" })],
      ...over,
    });

  it("hak sahibinde itiraz formu en üstte; değerlendirme, kurallar açılırı ve imza listesi sonra", () => {
    const html = render(<ObjectionPanel proposal={objectionProposal()} onUpdated={noop} />);
    const order = ["İtiraz imzala", "Gerekçe", "Açıklama", "İtirazı imzala", "İtiraz geçerli — uzlaşma turu", "Toplam geçerli imza: 7", "Geçerlilik nasıl hesaplanır?", "İtiraz imzaları (2)"].map((s) => at(html, s));
    expect(order).toEqual([...order].sort((a, b) => a - b));
    // form kendi içindeki açıklama açılırından önce; formun bilgi kutusu tek cümle
    expect(at(html, "İmzanız anonim; son 30 günde en çok 2 itiraz imzalayabilirsiniz.")).toBeLessThan(at(html, "İtirazı imzala"));
    expect(namesOf(html, "summary")).toEqual(expect.arrayContaining(["İtiraz hakkı nasıl işler?", "Geçerlilik nasıl hesaplanır?"]));
    // rozetler (04:88-89) ve toplam açılır dışında
    const verdict = at(html, "İtiraz geçerli — uzlaşma turu");
    expect(html.slice(0, verdict).match(/<details/g)?.length ?? 0).toBe(html.slice(0, verdict).match(/<\/details>/g)?.length ?? 0);
    expect(html).toContain("Küme kuralı (a)");
    expect(html.match(/Küme kuralı \(a\)/g)).toHaveLength(1);
  });

  it("grup tablosu ve kurallar açılırda; amaç cümlesi açılırın ilk paragrafı", () => {
    const html = render(<ObjectionPanel proposal={objectionProposal()} onUpdated={noop} />);
    const d = at(html, "Geçerlilik nasıl hesaplanır?");
    expect(at(html, OBJECTION_INTRO)).toBeGreaterThan(d);
    expect(at(html, "Görüş gruplarına göre itiraz imzaları")).toBeGreaterThan(d);
    expect(at(html, "(a) Tek bir anlamlı grupta")).toBeGreaterThan(d);
    expect(html).not.toContain('class="card-subtitle');
  });

  it("açık evrede imza listesi tam ve görünür; (sizin imzanız…) ve Anonim imzacı metinleri bir kez", () => {
    const html = render(<ObjectionPanel proposal={objectionProposal({ canObject: false })} onUpdated={noop} />);
    expect(html.match(/\(sizin imzanız; başkalarına anonim görünür\)/g)).toHaveLength(1);
    expect(html.match(/Anonim imzacı/g)).toHaveLength(1);
    expect(html).not.toContain("İtirazı imzala");
    expect(html).toContain("Yalnızca ilk turda etkin oyu");
    // liste açılırların dışında: imza listesi başlığından önceki tüm <details> kapanmış
    const list = at(html, "İtiraz imzaları (2)");
    expect(html.slice(0, list).match(/<details/g)?.length ?? 0).toBe(html.slice(0, list).match(/<\/details>/g)?.length ?? 0);
  });

  it("uzlaşmada kart katlanmaz, rozet ve imza listesi görünür; kesinleşmişte imzalar 'İtiraz imzaları (n)' açılırında", () => {
    const rec = render(<ObjectionPanel proposal={objectionProposal({ status: "reconciliation", canObject: false })} onUpdated={noop} />);
    expect(rec).not.toContain("card-collapsible");
    expect(rec).toContain("İtiraz geçerli — uzlaşma turu");
    expect(rec).not.toContain("İtiraz süresi"); // geri sayım yalnız açık evrede
    expect(rec).toMatch(/<h3[^>]*>İtiraz imzaları \(2\)<\/h3>/);
    expect(namesOf(rec, "summary")).not.toContain("İtiraz imzaları (2)");

    const done = render(<ObjectionPanel proposal={objectionProposal({ status: "enacted", canObject: false })} onUpdated={noop} />);
    expect(namesOf(done, "summary")).toContain("İtiraz imzaları (2)");
    expect(done).not.toMatch(/<h3[^>]*>İtiraz imzaları/);
    expect(at(done, "Anonim imzacı")).toBeGreaterThan(at(done, "İtiraz imzaları (2)"));
    // rozet ve toplam açılırların dışında
    expect(done.slice(0, at(done, "İtiraz geçerli — uzlaşma turu")).match(/<details/g)?.length ?? 0).toBe(
      done.slice(0, at(done, "İtiraz geçerli — uzlaşma turu")).match(/<\/details>/g)?.length ?? 0,
    );
  });

  it("aria-label olarak 'Gerekçe', 'Açıklama' ya da 'Azınlık raporu' kullanılmaz (04: getByLabel tek eşleşme)", () => {
    const html = render(<ObjectionPanel proposal={objectionProposal()} onUpdated={noop} />);
    expect(ariaLabels(html).filter((l) => /gerekçe|açıklama|azınlık raporu/i.test(l))).toEqual([]);
    expect(html.match(/<label[^>]*>[^<]*Gerekçe/g)).toHaveLength(1);
  });

  it("değerlendirme yokken de çizilir (eski sunucu): form, kurallar açılırı, sayı yazılmayan kural", () => {
    const html = render(<ObjectionPanel proposal={objectionProposal({ objectionEvaluation: null })} onUpdated={noop} />);
    expect(html).toContain("İtirazı imzala");
    expect(html).toContain("Geçerlilik nasıl hesaplanır?");
    expect(html).not.toContain("Toplam geçerli imza");
  });
});

describe("ReconciliationPanel", () => {
  const rec = (over: Record<string, unknown> = {}) =>
    proposal({
      status: "reconciliation",
      reconciliationOrigin: "contested",
      canWriteMinorityReport: false,
      minorityReports: [{ id: "m1", authorId: "u-x", authorNickname: "x", clusterId: "B", body: "Rapor gövdesi.", createdAt: NOW - 5000 }],
      ...over,
    });
  const panel = (p: ProposalDetail) => render(<ReconciliationPanel proposal={p} onUpdated={noop} onReload={noop} onMinorityReport={noop} onNewAnalysis={noop} />);

  it("köken bildirimi (role=status) en üstte ve kısa; nedeni ve anlık görüntü cümlesi açılırda", () => {
    const html = panel(rec());
    expect(at(html, 'role="status"')).toBeLessThan(at(html, 'aria-label="Azınlık raporları"'));
    expect(html).toContain("Köken: tartışmalı sonuç (köprü testi sağlanamadı)");
    expect(at(html, "Yeniden oylamada köprü testi ya da en az")).toBeLessThan(at(html, 'aria-label="Azınlık raporları"'));
    const d = at(html, "Uzlaşma süreci nasıl işler?");
    expect(at(html, "Genel çoğunluk sağlandı")).toBeGreaterThan(d);
    expect(at(html, "anlık görüntüleri ilk turla aynıdır")).toBeGreaterThan(d);
    expect(at(html, "Azınlığın gücü erteleyicidir")).toBeGreaterThan(d);
    expect(html).not.toContain('class="card-subtitle');
  });

  it("bölge adları aynen: Azınlık raporları, Köprü taslakları, Bilirkişi ve revizyon", () => {
    const html = panel(rec());
    expect(ariaLabels(html)).toEqual(["Azınlık raporları", "Köprü taslakları", "Bilirkişi ve revizyon"]);
    expect(html).toContain("Azınlık raporları (1)");
    expect(html).toMatch(/<h2[^>]*>Uzlaşma turu<\/h2>/); // kart başlığı (bölge adı)
  });

  it("rapor yazabilen üyede 'Azınlık raporu yaz' listenin ve taslakların önünde", () => {
    const html = panel(rec({ canWriteMinorityReport: true }));
    const order = ["Azınlık raporları (1)", "Azınlık raporu yaz", "Rapor gövdesi.", "Yapay zekâ köprü taslakları"].map((s) => at(html, s));
    expect(order).toEqual([...order].sort((a, b) => a - b));
  });

  it("yazarda 'Köprü taslakları' bloğu ilk; üret düğmesi taslak açıklamasının önünde", () => {
    h.auth.user = { id: "u-author" };
    const html = panel(rec());
    expect(at(html, "Yapay zekâ köprü taslakları")).toBeLessThan(at(html, "Azınlık raporları (1)"));
    expect(at(html, "YZ köprü taslakları üret")).toBeLessThan(at(html, "Köprü taslakları nedir?"));
    expect(namesOf(html, "button").filter((n) => /taslak(lar)?ı? üret/i.test(n))).toEqual(["YZ köprü taslakları üret"]);
    expect(at(html, "Çoğunluk ve azınlık gerekçelerini")).toBeGreaterThan(at(html, "Köprü taslakları nedir?"));
    expect(namesOf(html, "button")).toContain("Metni revize et");
  });

  it("etkin olmayan panelde (sonuçlanmış) azınlık raporları görünür, taslak setleri açılırda; rapor formu ve düğmeler yok", () => {
    const analysis = { id: "a1", task: "bridging_drafts", createdAt: NOW, output: { drafts: [{ title: "T", body: "Taslak gövdesi" }] }, model: "m", offline: true };
    const html = panel(rec({ status: "enacted", aiAnalyses: [analysis] }));
    expect(html).not.toContain("Azınlık raporu yaz");
    expect(html).not.toContain("Karşı bilirkişi");
    expect(at(html, "Rapor gövdesi.")).toBeLessThan(at(html, "<details"));
    expect(namesOf(html, "summary")).toContain("Köprü taslak setleri (1)");
    expect(at(html, "Taslak gövdesi")).toBeGreaterThan(at(html, "Köprü taslak setleri (1)"));
    expect(namesOf(html, "button").filter((n) => /üret/i.test(n))).toEqual([]);
  });

  it("MinorityReportForm: yazma hakkı yoksa tek cümlelik açıklama, hakkı varsa 'Azınlık raporu yaz' düğmesi", () => {
    const denied = render(<MinorityReportForm proposal={rec()} onAdded={noop} />);
    expect(denied).toContain("Azınlık raporunu yalnızca ilk turda etkin oyu");
    const allowed = render(<MinorityReportForm proposal={rec({ canWriteMinorityReport: true })} onAdded={noop} />);
    expect(namesOf(allowed, "button")).toEqual(["Azınlık raporu yaz"]);
  });
});

describe("SuggestionsPanel", () => {
  const withSuggestions = (n: number, over: Record<string, unknown> = {}) =>
    proposal({
      status: "deliberation",
      suggestions: Array.from({ length: n }, (_, i) => suggestion(`s${i + 1}`, "rejected", NOW - (n - i) * 1000)),
      ...over,
    });
  const panel = (p: ProposalDetail, showHeading = true) => render(<SuggestionsPanel proposal={p} onUpdated={noop} onAdded={noop} showHeading={showHeading} />);

  it("boş durum tek satır: 'Henüz metin önerisi yok.' + [Metin önerisi gönder]; açıklama 'Metin önerileri nasıl işler?' açılırında", () => {
    const html = panel(withSuggestions(0));
    expect(html).not.toContain('class="empty');
    expect(at(html, "Metin önerileri (0)")).toBeLessThan(at(html, "Henüz metin önerisi yok."));
    expect(at(html, "Henüz metin önerisi yok.")).toBeLessThan(at(html, "Metin önerisi gönder"));
    expect(namesOf(html, "button")).toEqual(["Metin önerisi gönder"]);
    expect(namesOf(html, "summary")).toEqual(["Metin önerileri nasıl işler?"]);
    expect(at(html, "yazarın tek başına veto hakkı yoktur")).toBeGreaterThan(at(html, "Metin önerileri nasıl işler?"));
    // yazar öneri gönderemez: yalnız tek satır
    h.auth.user = { id: "u-author" };
    expect(namesOf(panel(withSuggestions(0)), "button")).toEqual([]);
  });

  it("3 ya da daha az öneri: hepsi görünür, 'Tümünü göster' yok", () => {
    const html = panel(withSuggestions(3));
    expect(html.match(/<li\b/g)).toHaveLength(3);
    expect(html).not.toContain("Tümünü göster");
  });

  it("3'ten uzun liste: ilk 3 (en yeni önce) görünür, 'Tümünü göster (n)' aria-expanded=false", () => {
    const html = panel(withSuggestions(5));
    expect(html.match(/<li\b/g)).toHaveLength(3);
    expect(html).toContain("Tümünü göster (5)");
    expect(html).toMatch(/aria-expanded="false"[^>]*aria-controls="[^"]+"|aria-controls="[^"]+"[^>]*aria-expanded="false"/);
    expect(html).toContain("yazar_s5"); // en yeni
    expect(html).not.toContain("yazar_s1"); // en eski kısaltılmış
    // düğme listenin önünde değil, arkasında
    expect(at(html, "Tümünü göster (5)")).toBeGreaterThan(at(html, "yazar_s5"));
  });

  it("'Tam' görünümde liste baştan tam: 5 önerinin hepsi DOM'da, düğme 'Daha az göster' (aria-expanded=true)", () => {
    setPrefSync(PREF_KEYS.detail, "tam");
    const html = panel(withSuggestions(5));
    expect(html.match(/<li\b/g)).toHaveLength(5);
    expect(html).toContain("yazar_s1"); // en eski de çizilir (sayfa içi arama ve ekran okuyucu bulur)
    expect(namesOf(html, "button")).toContain("Daha az göster");
    expect(html).not.toContain("Tümünü göster");
    expect(html).toMatch(/aria-expanded="true"[^>]*aria-controls="[^"]+"|aria-controls="[^"]+"[^>]*aria-expanded="true"/);
  });

  it("yazarın karar bekleyen önerileri kısaltmada da görünür", () => {
    h.auth.user = { id: "u-author" };
    const p = withSuggestions(5);
    p.suggestions[0] = suggestion("s1", "open", NOW - 5000) as never; // en eskisi açık
    const html = panel(p);
    expect(html).toContain("yazar_s1");
    expect(html).toContain("Kabul et (yeni sürüm)");
    expect(html.match(/<li\b/g)).toHaveLength(4);
    expect(html).toContain("Tümünü göster (5)");
  });

  it("metin önerisi düğmesi listenin ve başlığın önünde (yalnız tartışmada, doğrulanmış, yazar değil)", () => {
    const html = panel(withSuggestions(1));
    expect(at(html, "Metin önerisi gönder")).toBeLessThan(at(html, "Metin önerileri (1)"));
    const closed = panel(withSuggestions(1, { status: "voting" }));
    expect(closed).not.toContain("Metin önerisi gönder");
    h.auth.can = () => false;
    expect(panel(withSuggestions(1))).not.toContain("Metin önerisi gönder");
  });

  it("kart başlığı varsa (showHeading=false) alt başlık çizilmez", () => {
    expect(panel(withSuggestions(2), false)).not.toContain("Metin önerileri (2)");
  });
});

describe("RightsFlags", () => {
  const flagged = (flags: unknown[], over: Record<string, unknown> = {}) => proposal({ status: "sponsoring", rightsFlags: flags, ...over });

  it("bayrak yokken tek satır özet ve [Hak etkisi bayrağı ekle] düğmesi; form kapalı", () => {
    const html = render(<RightsFlags proposal={flagged([])} onUpdated={noop} showHeading={false} />);
    expect(html).toContain("İşaretlenmiş hak yok");
    expect(namesOf(html, "button")).toEqual(["Hak etkisi bayrağı ekle"]);
    expect(html).not.toContain("<form");
    expect(html).not.toContain("<h3");
  });

  it("bayrak varsa özet sayıyı ve katman etkisini söyler; işaretli haklar görünür; başlık varsayılan olarak çizilir", () => {
    const html = render(
      <RightsFlags
        proposal={flagged([
          { right: "https://forumsistemi.org/ont#ifade", direction: "restrict", source: "member" },
          { right: "https://forumsistemi.org/ont#ifade", direction: "expand", source: "ai" },
          { right: "https://forumsistemi.org/ont#mulkiyet", direction: "restrict", source: "author" },
        ])}
        onUpdated={noop}
      />,
    );
    expect(html).toContain("2 hak işaretli · katmanı yükseltir");
    expect(html).toContain("Hak etkisi</h3>");
    expect(html.match(/<li\b/g)).toHaveLength(3);
    expect(html).toContain('data-ai-generated="true"');
  });

  it("düzenlenemeyen evrede ya da doğrulanmamış üyede ekleme düğmesi çıkmaz; kaldırma yalnız bilirkişi/yönetici", () => {
    const flags = [{ right: "https://forumsistemi.org/ont#ifade", direction: "restrict", source: "member" }];
    expect(namesOf(render(<RightsFlags proposal={flagged(flags, { status: "voting" })} onUpdated={noop} />), "button")).toEqual([]);
    h.auth.can = () => false;
    expect(namesOf(render(<RightsFlags proposal={flagged(flags)} onUpdated={noop} />), "button")).toEqual([]);
    h.auth.can = () => true;
    expect(namesOf(render(<RightsFlags proposal={flagged(flags)} onUpdated={noop} />), "button")).toEqual(["Hak etkisi bayrağı ekle"]);
    h.auth.isExpert = true;
    expect(namesOf(render(<RightsFlags proposal={flagged(flags)} onUpdated={noop} />), "button")).toEqual(["Hak etkisi bayrağı ekle", "Kaldır"]);
  });
});

describe("sözleşmeler: adlar ve 'Tam' görünüm", () => {
  const RESERVED = ["daha fazla", "sayımı kendim doğrulayayım", "kapat"];
  const everything = (): string[] => {
    const rec = proposal({ status: "reconciliation", reconciliationOrigin: "objection", canWriteMinorityReport: true });
    const html = [
      render(<VotePanel proposal={proposal({ myBallot: ballot, expertPanel: { suspensiveFlag: true, reports: [] } })} setProposal={noop} reload={noop} />),
      render(<VotePanel proposal={proposal()} setProposal={noop} reload={noop} />),
      render(<SponsorPanel proposal={proposal({ status: "sponsoring" })} onUpdated={noop} />),
      render(<ObjectionPanel proposal={proposal({ status: "objection_window", canObject: true, objectionEvaluation: evaluation(), objections: [objection("o1")] })} onUpdated={noop} />),
      render(<ReconciliationPanel proposal={rec} onUpdated={noop} onReload={noop} onMinorityReport={noop} onNewAnalysis={noop} />),
      render(<SuggestionsPanel proposal={proposal({ status: "deliberation" })} onUpdated={noop} onAdded={noop} />),
      render(<RightsFlags proposal={proposal({ status: "sponsoring" })} onUpdated={noop} />),
    ];
    return html.flatMap(allNames);
  };

  it("yeni düğme, bağlantı, özet ve aria-label adları ayrılmış dizeleri içermez; 'Destekle' ve 'Oyumu ver' yalnız asıl düğmelerdir", () => {
    const names = everything();
    expect(names.filter((n) => RESERVED.some((r) => n.toLowerCase().includes(r)))).toEqual([]);
    expect(names.filter((n) => n.toLowerCase().includes("destekle"))).toEqual(["Destekle"]);
    expect(names.filter((n) => n.toLowerCase().includes("oyumu ver"))).toEqual(["Oyumu ver"]);
  });

  it("açılır özetleri bölge adlarıyla çakışmaz (Oylama, Uzlaşma turu, Azınlık raporları, Destekçiler (…)", () => {
    const summaries = [
      ...namesOf(render(<VotePanel proposal={proposal({ myBallot: ballot })} setProposal={noop} reload={noop} />), "summary"),
      ...namesOf(render(<SponsorPanel proposal={proposal({ status: "sponsoring" })} onUpdated={noop} />), "summary"),
      ...namesOf(render(<ObjectionPanel proposal={proposal({ status: "enacted", objectionEvaluation: evaluation(), objections: [objection("o1")] })} onUpdated={noop} />), "summary"),
      ...namesOf(render(<ReconciliationPanel proposal={proposal({ status: "reconciliation" })} onUpdated={noop} onReload={noop} onMinorityReport={noop} onNewAnalysis={noop} />), "summary"),
    ];
    expect(summaries.length).toBeGreaterThan(6);
    for (const s of summaries) expect(s).not.toMatch(/oylama|uzlaşma turu|azınlık raporları|destekçiler \(|1\. tur sonucu|azınlık itirazı/i);
  });

  it("'Sade' görünümde açılırlar kapalı, 'Tam' görünümde hepsi açık gelir (e2e'nin içine baktığı bölümler hiç gömülmez)", () => {
    const ui = () => (
      <>
        <VotePanel proposal={proposal({ myBallot: ballot })} setProposal={noop} reload={noop} />
        <SponsorPanel proposal={proposal({ status: "sponsoring" })} onUpdated={noop} />
        <ObjectionPanel proposal={proposal({ status: "enacted", objectionEvaluation: evaluation(), objections: [objection("o1")] })} onUpdated={noop} />
        <ReconciliationPanel proposal={proposal({ status: "reconciliation" })} onUpdated={noop} onReload={noop} onMinorityReport={noop} onNewAnalysis={noop} />
        <SuggestionsPanel proposal={proposal({ status: "deliberation" })} onUpdated={noop} onAdded={noop} />
      </>
    );
    const sade = render(ui());
    const all = sade.match(/<details\b[^>]*>/g) ?? [];
    expect(all.length).toBeGreaterThan(5);
    expect(all.filter((d) => /\sopen=""/.test(d))).toEqual([]);
    // e2e'nin okuduğu içerik sade kipte de DOM'da ve açılır dışında
    expect(sade).toContain("Oyumu değiştir");
    expect(sade).toContain("Azınlık raporları (0)");

    setPrefSync(PREF_KEYS.detail, "tam");
    const tam = render(ui());
    const tamAll = tam.match(/<details\b[^>]*>/g) ?? [];
    expect(tamAll).toHaveLength(all.length);
    expect(tamAll.filter((d) => !/\sopen=""/.test(d))).toEqual([]);
  });
});
