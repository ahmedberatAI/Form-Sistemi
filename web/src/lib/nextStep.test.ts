// Sıradaki adım motoru: 12 evre × rol matrisi, kullanıcı durumları, anonim, denetçi ve bütünlük uyarısı, e2e sözleşmeleri.
// Bkz. lib/nextStep.ts ve docs/ARAYUZ_PLANI.md (Faz 2 / madde 1).
import { describe, expect, it } from "vitest";
import type {
  AssignmentStatus,
  BallotReceipt,
  DecisionResult,
  ExpertPanelInfo,
  IntegrityWarning,
  MinorityReport,
  ObjectionInfo,
  PhaseEvent,
  ProposalDetail,
  ProposalKind,
  ProposalStatus,
  Suggestion,
  VoteChoice,
} from "@forum/shared";
import { ANONYMOUS_VIEWER, nextStepHref, proposalNextStep, STEP_ANCHORS, viewerOf, type NextStep, type NextStepLink, type Viewer, type ViewerSource } from "./nextStep";
import { parseSectionParam } from "./sectionParam";

// ───────────────────────── Düzenekler ─────────────────────────

const AUTHOR_ID = "u-yazar";
const ME = "u-ben";
const OTHER = "u-baskasi";

type ViewerOver = Partial<Omit<Viewer, "can">> & { can?: Partial<Viewer["can"]> };

function viewer(over: ViewerOver = {}): Viewer {
  return {
    id: ME,
    status: "verified",
    politicalConsent: true,
    isAdult: true,
    ...over,
    can: { V: false, VV: false, D: false, A: false, ...over.can },
  };
}

const anon = ANONYMOUS_VIEWER;
const pending = viewer({ status: "pending", politicalConsent: true });
const suspended = viewer({ status: "suspended" });
const rejected = viewer({ status: "rejected" });
/** Doğrulanmış ama siyasi görüş rızası yok → V var, VV yok. */
const noConsent = viewer({ politicalConsent: false, can: { V: true } });
const minor = viewer({ isAdult: false, can: { V: true } });
const member = viewer({ can: { V: true } });
const voter = viewer({ can: { V: true, VV: true } });
const author = viewer({ id: AUTHOR_ID, can: { V: true, VV: true } });
const auditor = viewer({ can: { V: true, VV: true, D: true } });
const admin = viewer({ can: { V: true, VV: true, D: true, A: true } });

const NAMED_VIEWERS: Record<string, Viewer> = { anon, pending, suspended, rejected, noConsent, minor, member, voter, author, auditor, admin };

function ballot(choice: VoteChoice, round: 1 | 2 = 1): NonNullable<ProposalDetail["myBallot"]> {
  const receipt: BallotReceipt = { proposalId: "p1", round, ballotId: "b1", choice, salt: "s", commitment: "c", txHash: null, castAt: 1 };
  return { choice, receipt };
}

const result = (round: 1 | 2 = 1): DecisionResult => ({ round, outcome: "accept" }) as DecisionResult;

function suggestion(status: Suggestion["status"], id = "s1"): Suggestion {
  return { id, proposalId: "p1", authorId: OTHER, authorNickname: "digeri", body: "Yeni metin", status, createdAt: 1, decidedAt: null };
}

function panel(assignments: { expertId: string; status: AssignmentStatus }[], reports = 0): ExpertPanelInfo {
  return {
    assignments: assignments.map((a, i) => ({ id: `a${i}`, expertId: a.expertId, nickname: `bk${i}`, status: a.status, dueAt: 1 })),
    reports: Array.from({ length: reports }, (_, i) => ({ id: `r${i}` })),
  } as unknown as ExpertPanelInfo;
}

function warning(): IntegrityWarning {
  return { kind: "lockstep", round: 1, groupSize: 3, message: "Kilit adım", detectedAt: 1, members: null };
}

function objection(userId: string): ObjectionInfo {
  return { id: `o-${userId || "anon"}`, userId, nickname: userId ? "ben" : "Anonim imzacı", ground: "g", statement: "x", clusterId: "g0", at: 1 };
}

function report(authorId: string): MinorityReport {
  return { id: `m-${authorId}`, proposalId: "p1", authorId, authorNickname: "n", clusterId: "g0", body: "Rapor", createdAt: 1 };
}

function event(to: ProposalStatus, at: number, reason: string): PhaseEvent {
  return { from: null, to, at, reason, ledgerTx: null };
}

function proposal(over: Partial<ProposalDetail> = {}): ProposalDetail {
  return {
    id: "p1",
    seq: 7,
    kind: "topic",
    title: "Kütüphane hafta sonu açık olsun",
    status: "deliberation",
    tier: "T0",
    authorId: AUTHOR_ID,
    authorNickname: "yazar",
    categories: [],
    parentTopicId: null,
    createdAt: 1,
    phaseEndsAt: 1_000,
    sponsorCount: 1,
    sponsorsRequired: 3,
    messageCount: 4,
    participation: null,
    integrityWarningCount: 0,
    body: "Metin",
    version: 1,
    versions: [],
    amendment: null,
    deletion: null,
    regulationPatch: null,
    audit: null,
    params: null,
    phaseStartedAt: 0,
    votingRound: 0,
    reconciliationOrigin: null,
    extensionUsed: false,
    sponsors: [],
    events: [],
    suggestions: [],
    results: [],
    objections: [],
    objectionEvaluation: null,
    minorityReports: [],
    expertPanel: null,
    expertQuestions: [],
    aiAnalyses: [],
    myBallot: null,
    myEffectiveVia: null,
    canVote: false,
    canObject: false,
    canWriteMinorityReport: false,
    rightsFlags: [],
    integrityWarnings: [],
    parentTopic: null,
    enactedEntityId: null,
    ledgerTxs: [],
    ...over,
  };
}

const at = (status: ProposalStatus, over: Partial<ProposalDetail> = {}) => proposal({ status, ...over });
const step = (p: ProposalDetail, v: Viewer): NextStep => proposalNextStep(p, v);
const labels = (s: NextStep): string[] => s.links.map((l) => l.label);

// ───────────────────────── viewerOf ─────────────────────────

describe("viewerOf", () => {
  const source = (user: ViewerSource["user"], perms: string[]): ViewerSource => ({ user, can: (perm) => perms.includes(perm) });

  it("oturum yoksa anonim görüntüleyen verir", () => {
    expect(viewerOf(source(null, []))).toEqual(ANONYMOUS_VIEWER);
    expect(ANONYMOUS_VIEWER.id).toBeNull();
    expect(Object.values(ANONYMOUS_VIEWER.can).every((x) => x === false)).toBe(true);
  });

  it("oy verebilen üyeyi id, durum, yetkiler, rıza ve yaşla özetler", () => {
    const v = viewerOf(source({ id: ME, status: "verified", politicalConsent: true, isAdult: true }, ["V", "VV"]));
    expect(v).toEqual({ id: ME, status: "verified", can: { V: true, VV: true, D: false, A: false }, politicalConsent: true, isAdult: true });
  });

  it("yönetici D ve A yetkisini taşır; bekleyen üyede hiçbiri yoktur", () => {
    expect(viewerOf(source({ id: "a", status: "verified", politicalConsent: false, isAdult: true }, ["V", "D", "A"])).can).toEqual({ V: true, VV: false, D: true, A: true });
    expect(viewerOf(source({ id: "p", status: "pending", politicalConsent: true, isAdult: true }, [])).can).toEqual({ V: false, VV: false, D: false, A: false });
  });

  it("yalnız beş alan verir ve yalnız V, VV, D, A yetkilerini sorar", () => {
    const asked: string[] = [];
    const v = viewerOf({ user: { id: ME, status: "verified", politicalConsent: true, isAdult: true }, can: (perm) => (asked.push(perm), true) });
    expect(Object.keys(v).sort()).toEqual(["can", "id", "isAdult", "politicalConsent", "status"]);
    expect(Object.keys(v.can).sort()).toEqual(["A", "D", "V", "VV"]);
    expect(asked.sort()).toEqual(["A", "D", "V", "VV"]);
  });
});

// ───────────────────────── Evre × rol ─────────────────────────

describe("taslak", () => {
  it("yazar: 'Taslak yalnız size görünür' → 'Taslak işlemlerine git'", () => {
    const s = step(at("draft"), author);
    expect(s).toMatchObject({ tone: "action", headline: "Taslak yalnız size görünür", cta: { label: "Taslak işlemlerine git", bolum: "eylem" } });
    expect(s.links).toEqual([]);
  });

  it("yazar olmayan görüntüleyen için eylem çıkmaz", () => {
    const s = step(at("draft"), member);
    expect(s.tone).toBe("neutral");
    expect(s.cta).toBeUndefined();
  });
});

describe("destek toplama (sponsoring)", () => {
  const p = (over: Partial<ProposalDetail> = {}) => at("sponsoring", { sponsorCount: 1, sponsorsRequired: 3, ...over });

  it("V, yazar değil, desteklememiş: 'Destekçi bekleniyor (x/y)' → 'Destek bölümüne git'", () => {
    const s = step(p(), member);
    expect(s).toMatchObject({ tone: "action", headline: "Destekçi bekleniyor (1/3)", detail: "2 destekçi daha gerekiyor.", cta: { label: "Destek bölümüne git", bolum: "eylem" } });
  });

  it("destekçi sayısı tamamsa 'daha gerekiyor' yazmaz", () => {
    expect(step(p({ sponsorCount: 3 }), member).detail).toBeUndefined();
  });

  it("desteklemiş: kayıtlı olduğunu söyler, bağlantı vermez ve panel metnini tekrar etmez", () => {
    const s = step(p({ sponsors: [{ userId: ME, nickname: "ben", at: 1 }] }), member);
    expect(s.headline).toBe("Desteğiniz kayıtlı; destekçiler tamamlanınca tartışma açılır");
    expect(s.cta).toBeUndefined();
    expect(`${s.headline} ${s.detail}`).not.toContain("Bu öneriyi desteklediniz");
  });

  it("başkasının desteği görüntüleyeni 'desteklemiş' yapmaz", () => {
    const s = step(p({ sponsors: [{ userId: OTHER, nickname: "o", at: 1 }] }), member);
    expect(s.headline).toBe("Destekçi bekleniyor (1/3)");
  });

  it("yazar: 'Kendi önerinizi destekleyemezsiniz; destekçi bekleniyor'", () => {
    const s = step(p(), author);
    expect(s.headline).toBe("Kendi önerinizi destekleyemezsiniz; destekçi bekleniyor");
    expect(s.cta).toBeUndefined();
    expect(s.detail).toContain("1/3");
  });

  it("V değil (bekleyen): 'Doğrulandıktan sonra destek verebilirsiniz'", () => {
    const s = step(p(), pending);
    expect(s.headline).toBe("Doğrulandıktan sonra destek verebilirsiniz");
    expect(s.cta).toBeUndefined();
  });

  it("askıdaki ve reddedilmiş hesap yanıltıcı 'doğrulandıktan sonra' vaadi almaz", () => {
    expect(step(p(), suspended).headline).toBe("Hesabınız askıda; destek veremezsiniz");
    expect(step(p(), rejected).headline).toBe("Kimlik doğrulamanız reddedildi; destek veremezsiniz");
  });

  it("anonim: giriş bağlantısı", () => {
    const s = step(p(), anon);
    expect(s.headline).toBe("Destek vermek için giriş yapın");
    expect(s.cta).toEqual({ label: "Giriş yap", to: "/giris" });
  });
});

describe("tartışma (deliberation)", () => {
  const p = (over: Partial<ProposalDetail> = {}) => at("deliberation", { messageCount: 4, ...over });

  it("yazar: yanıt bekleyen metin önerisi sayısı", () => {
    const s = step(p({ suggestions: [suggestion("open", "a"), suggestion("open", "b"), suggestion("accepted", "c"), suggestion("rejected", "d"), suggestion("lapsed", "e")] }), author);
    expect(s).toMatchObject({ tone: "action", headline: "2 metin önerisi yanıtınızı bekliyor", cta: { label: "Metin önerilerine git", bolum: "eylem" } });
  });

  it("yazar: karara bağlanmış öneriler sayılmaz, tartışmaya yönlendirir", () => {
    const s = step(p({ suggestions: [suggestion("accepted")] }), author);
    expect(s.headline).toBe("Tartışma sürüyor (4 mesaj)");
    expect(s.cta).toEqual({ label: "Tartışmaya git", bolum: "tartisma" });
  });

  it("atanmış bilirkişi (görevi kabul etmiş): 'Raporunuz bekleniyor' → bilirkişi bölümü + Görevlerim", () => {
    const s = step(p({ expertPanel: panel([{ expertId: ME, status: "accepted" }]) }), member);
    expect(s).toMatchObject({ tone: "action", headline: "Raporunuz bekleniyor", cta: { label: "Bilirkişi bölümüne git", bolum: "bilirkisi" } });
    expect(s.links).toEqual([{ label: "Bilirkişi görevlerim", to: "/bilirkisiler?sekme=gorevlerim" }]);
  });

  it("atanmış bilirkişi (davet edilmiş): daveti yanıtlaması beklenir", () => {
    const s = step(p({ expertPanel: panel([{ expertId: ME, status: "invited" }]) }), member);
    expect(s.headline).toBe("Bilirkişi davetini yanıtlamanız bekleniyor");
    expect(s.cta?.bolum).toBe("bilirkisi");
  });

  it("çekinmiş, rapor vermiş, süresi geçmiş ya da yerine başkası seçilmiş bilirkişi özel adım almaz", () => {
    for (const status of ["recused", "reported", "overdue", "replaced", "cancelled"] as AssignmentStatus[]) {
      const s = step(p({ expertPanel: panel([{ expertId: ME, status }]) }), member);
      expect(s.headline, status).toBe("Tartışmaya katılın (4 mesaj)");
    }
  });

  it("başkasının atanması görüntüleyeni etkilemez", () => {
    const s = step(p({ expertPanel: panel([{ expertId: OTHER, status: "accepted" }]) }), member);
    expect(s.headline).toBe("Tartışmaya katılın (4 mesaj)");
  });

  it("diğer doğrulanmış üyeler: 'Tartışmaya katılın (n mesaj)' → tartışma", () => {
    const s = step(p(), member);
    expect(s).toMatchObject({ tone: "info", headline: "Tartışmaya katılın (4 mesaj)", cta: { label: "Tartışmaya git", bolum: "tartisma" } });
  });

  it("bilirkişi raporu yayımlandıysa 'Bilirkişi: n rapor' bağlantısı çıkar", () => {
    const s = step(p({ expertPanel: panel([{ expertId: OTHER, status: "reported" }], 2) }), member);
    expect(labels(s)).toEqual(["Bilirkişi: 2 rapor"]);
    expect(s.links[0]).toEqual({ label: "Bilirkişi: 2 rapor", bolum: "bilirkisi" });
  });

  it("anonim ve doğrulanmamış üye okuyabilir ama 'katılın' denmez", () => {
    for (const v of [anon, pending, suspended]) {
      const s = step(p(), v);
      expect(s.headline).toBe("Tartışma sürüyor (4 mesaj)");
      expect(s.headline).not.toContain("katılın");
      expect(s.detail).toContain("Okuyabilirsiniz");
    }
    expect(step(p(), anon).detail).toContain("giriş yapın");
    expect(step(p(), pending).detail).toContain("doğrulanması");
  });
});

describe("oylama ve yeniden oylama (voting, revote)", () => {
  const voting = (over: Partial<ProposalDetail> = {}) => at("voting", { votingRound: 1, canVote: true, ...over });
  const revote = (over: Partial<ProposalDetail> = {}) => at("revote", { votingRound: 2, canVote: true, results: [result(1)], ...over });

  it("canVote ve oy yok: 'Oyunuz bekleniyor' → 'Oy bölümüne git'", () => {
    const s = step(voting(), voter);
    expect(s).toMatchObject({ tone: "action", headline: "Oyunuz bekleniyor", cta: { label: "Oy bölümüne git", bolum: "eylem" } });
    expect(s.detail).toContain("değiştirebilirsiniz");
  });

  it("myBallot var: 'Oyunuz kayıtlı (Kabul); süre bitene kadar değiştirebilirsiniz' ve bağlantı yok", () => {
    const s = step(voting({ myBallot: ballot("yes") }), voter);
    expect(s.headline).toBe("Oyunuz kayıtlı (Kabul); süre bitene kadar değiştirebilirsiniz");
    expect(s.cta).toBeUndefined();
    expect(step(voting({ myBallot: ballot("no") }), voter).headline).toContain("(Red)");
    expect(step(voting({ myBallot: ballot("abstain") }), voter).headline).toContain("(Çekimser)");
  });

  it("makbuz metinlerini tekrar etmez", () => {
    const s = step(voting({ myBallot: ballot("yes") }), voter);
    expect(`${s.headline} ${s.detail ?? ""}`).not.toContain("Makbuz");
  });

  it("oyu var ama sunucu artık oy kullandırmıyor (canVote false): değiştirebilirsiniz denmez", () => {
    const s = step(voting({ myBallot: ballot("yes"), canVote: false }), voter);
    expect(s.headline).toBe("Oyunuz kayıtlı (Kabul)");
    expect(s.detail).toBe("Bu oylamada yeni oy kullanamıyorsunuz.");
  });

  it("V ama siyasi görüş rızası yok: neden ve 'Profil › Rızalar'", () => {
    const s = step(voting({ canVote: false }), noConsent);
    expect(s.headline).toBe("Oy vermek için siyasi görüş rızası gerekir");
    expect(s.cta).toEqual({ label: "Profil › Rızalar", to: "/profil" });
  });

  it("V ama 18 yaşından küçük: yaş nedeni, rıza bağlantısı yok", () => {
    const s = step(voting({ canVote: false }), minor);
    expect(s.headline).toBe("Oy vermek için 18 yaşını doldurmuş olmanız gerekir");
    expect(s.cta).toBeUndefined();
  });

  it("oy verebilir üye ama seçmen listesi donmuş (canVote false): dondurulmuş liste açıklaması", () => {
    const s = step(voting({ canVote: false }), voter);
    expect(s.headline).toBe("Bu oylamada oy kullanamıyorsunuz");
    expect(s.detail).toContain("dondurulur");
  });

  it("doğrulanmamış hesaplar için ayrı metinler", () => {
    expect(step(voting({ canVote: false }), pending).headline).toBe("Oy vermek için doğrulanmış üye olmanız gerekir");
    expect(step(voting({ canVote: false }), suspended).headline).toBe("Hesabınız askıda; oy veremezsiniz");
    expect(step(voting({ canVote: false }), rejected).headline).toBe("Kimlik doğrulamanız reddedildi; oy veremezsiniz");
  });

  it("anonim: 'Oy için giriş yapın'", () => {
    const s = step(voting({ canVote: false }), anon);
    expect(s.headline).toBe("Oy için giriş yapın");
    expect(s.cta).toEqual({ label: "Giriş yap", to: "/giris" });
  });

  it("oylama sürerken bilirkişi raporu bağlantısı; sonuç olmadığı için sayım bağlantısı yok", () => {
    const s = step(voting({ expertPanel: panel([], 2) }), voter);
    expect(labels(s)).toEqual(["Bilirkişi: 2 rapor"]);
  });

  it("yeniden oylama: aynı 'Oyunuz bekleniyor', yeniden oylama açıklaması ve ilk tur sonucu bağlantısı", () => {
    const s = step(revote(), voter);
    expect(s).toMatchObject({ tone: "action", headline: "Oyunuz bekleniyor", cta: { label: "Oy bölümüne git", bolum: "eylem" } });
    expect(s.detail).toContain("Yeniden oylama");
    expect(s.links).toEqual([{ label: "İlk turun sonucu", bolum: "sonuclar" }]);
  });

  it("yeniden oylamada oyu kayıtlı olan için kayıt cümlesi", () => {
    expect(step(revote({ myBallot: ballot("no", 2) }), voter).headline).toBe("Oyunuz kayıtlı (Red); süre bitene kadar değiştirebilirsiniz");
  });
});

describe("itiraz süresi (objection_window)", () => {
  const results = [result(1)];
  const p = (over: Partial<ProposalDetail> = {}) => at("objection_window", { votingRound: 1, results, ...over });

  it("canObject: 'İlk turda Red dediğiniz için itiraz hakkınız var' → 'İtiraz bölümüne git'", () => {
    const s = step(p({ canObject: true }), voter);
    expect(s).toMatchObject({ tone: "action", headline: "İlk turda Red dediğiniz için itiraz hakkınız var", cta: { label: "İtiraz bölümüne git", bolum: "eylem" } });
    expect(labels(s)).toEqual(["Nasıl karar verildi?", "Sayımı doğrula"]);
  });

  it("diğerleri: 'Karar itiraz süresinde'", () => {
    for (const v of [anon, pending, member, voter, author]) {
      const s = step(p(), v);
      expect(s).toMatchObject({ tone: "warning", headline: "Karar itiraz süresinde" });
      expect(s.cta).toBeUndefined();
    }
  });

  it("itirazını imzalamış görüntüleyen (kendi imzası userId ile görünür) bunu görür; anonim imzalar sayılmaz", () => {
    expect(step(p({ objections: [objection(ME)] }), voter).headline).toBe("İtirazınız imzalandı");
    expect(step(p({ objections: [objection("")] }), voter).headline).toBe("Karar itiraz süresinde");
  });

  it("sonuç kaydı yoksa 'Nasıl karar verildi?' bağlantıları çıkmaz (hedef sayfada yok)", () => {
    expect(step(p({ results: [] }), voter).links).toEqual([]);
  });
});

describe("uzlaşma (reconciliation)", () => {
  const p = (over: Partial<ProposalDetail> = {}) => at("reconciliation", { votingRound: 1, reconciliationOrigin: "contested", results: [result(1)], ...over });

  it("canWriteMinorityReport: 'Azınlık raporunuzu yazabilirsiniz' → uzlaşma bölümü", () => {
    const s = step(p({ canWriteMinorityReport: true }), voter);
    expect(s).toMatchObject({ tone: "action", headline: "Azınlık raporunuzu yazabilirsiniz", cta: { label: "Uzlaşma bölümüne git", bolum: "eylem" } });
    expect(s.detail).toContain("Red");
  });

  it("yazar: 'Köprü taslaklarını inceleyin ya da metni revize edin'", () => {
    const s = step(p(), author);
    expect(s).toMatchObject({ tone: "action", headline: "Köprü taslaklarını inceleyin ya da metni revize edin", cta: { label: "Uzlaşma bölümüne git", bolum: "eylem" } });
  });

  it("hem rapor yazabilen hem yazar olan: rapor önce, yazar işi ayrıntıda", () => {
    const s = step(p({ canWriteMinorityReport: true }), author);
    expect(s.headline).toBe("Azınlık raporunuzu yazabilirsiniz");
    expect(s.detail).toContain("köprü taslaklarını");
  });

  it("raporunu yazmış üye: kayıtlı olduğunu görür, bağlantı yok", () => {
    const s = step(p({ minorityReports: [report(ME)] }), voter);
    expect(s.headline).toBe("Azınlık raporunuz kayıtlı; uzlaşma süreci sürüyor");
    expect(s.cta).toBeUndefined();
  });

  it("diğerleri: uzlaşma süreci sürüyor", () => {
    for (const v of [anon, pending, member, voter]) {
      const s = step(p({ minorityReports: [report(OTHER)] }), v);
      expect(s).toMatchObject({ tone: "warning", headline: "Uzlaşma süreci sürüyor" });
      expect(s.cta).toBeUndefined();
    }
  });

  it("karşı panelden atanmış bilirkişi raporu beklenir", () => {
    const s = step(p({ expertPanel: panel([{ expertId: ME, status: "accepted" }]) }), voter);
    expect(s.headline).toBe("Raporunuz bekleniyor");
    expect(s.cta?.bolum).toBe("bilirkisi");
  });

  it("köken ne olursa olsun aynı metinler (itiraz kökenli uzlaşma)", () => {
    expect(step(p({ reconciliationOrigin: "objection", canWriteMinorityReport: true }), voter).headline).toBe("Azınlık raporunuzu yazabilirsiniz");
  });
});

describe("terminal evreler", () => {
  const events = [event("voting", 10, "Oylama açıldı"), event("enacted", 20, "Kabul: eşik ve köprü testi sağlandı.")];
  const results = [result(1)];

  it("kabul edildi: EnactedEffect başlığı + son olay gerekçesi + soru bağlantıları", () => {
    const s = step(at("enacted", { events, results }), member);
    expect(s).toMatchObject({ tone: "success", headline: "Karar yürürlükte", detail: "Kabul: eşik ve köprü testi sağlandı." });
    expect(s.cta).toBeUndefined();
    expect(s.links).toEqual([
      { label: "Nasıl karar verildi?", bolum: "sonuclar" },
      { label: "Sayımı doğrula", bolum: "dogrula" },
    ]);
  });

  it("kabul edilen konu: etki cümlesi ve 'Oluşan konuya git' hedefi", () => {
    const s = step(at("enacted", { kind: "topic", events, results, enactedEntityId: "konu 1" }), member);
    expect(s.detail).toBe("Kabul: eşik ve köprü testi sağlandı. Yeni konu oluşturuldu.");
    expect(s.cta).toEqual({ label: "Oluşan konuya git", to: "/konular/konu%201" });
  });

  it("kabul edilen alt konu, düzenleme, silme ve yönetmelik: EnactedEffect ile aynı cümleler ve bağlantılar", () => {
    const sub = step(at("enacted", { kind: "subtopic", events: [], enactedEntityId: "t2" }), member);
    expect(sub.detail).toBe("Alt konu oluşturuldu.");
    expect(sub.cta).toEqual({ label: "Oluşan konuya git", to: "/konular/t2" });

    const amend = step(at("enacted", { kind: "amendment", events: [], enactedEntityId: "t3" }), member);
    expect(amend.detail).toBe("Konu metni yeni sürümle güncellendi.");
    expect(amend.cta).toEqual({ label: "Konuya git", to: "/konular/t3" });

    const del = step(at("enacted", { kind: "deletion", events: [], deletion: { messageIds: ["a", "b", "c"], ground: "g", statement: "s" } }), member);
    expect(del.detail).toBe("3 mesaj karartıldı (silinmedi); yerlerinde mezar taşı görünür.");
    expect(del.cta).toBeUndefined();

    const reg = step(at("enacted", { kind: "regulation", events: [], enactedEntityId: "5" }), member);
    expect(reg.detail).toBe("Yönetmeliğin 5. sürümü yürürlüğe girdi.");
    expect(reg.cta).toEqual({ label: "Yönetmeliği görüntüle", to: "/yonetmelik" });
    expect(step(at("enacted", { kind: "regulation", events: [] }), member).detail).toBe("Yeni yönetmelik sürümü yürürlüğe girdi.");
  });

  it("oluşan varlık kimliği yoksa konu bağlantısı ve etki cümlesi çıkmaz", () => {
    const s = step(at("enacted", { kind: "topic", events: [] }), member);
    expect(s.cta).toBeUndefined();
    expect(s.detail).toBeUndefined();
  });

  it("son olay en yeni 'at' ile seçilir (dizi sırası önemsiz)", () => {
    const s = step(at("enacted", { events: [event("enacted", 20, "En yeni"), event("voting", 10, "Eski")], results }), member);
    expect(s.detail).toBe("En yeni");
  });

  it("sonuç kaydı olmayan kabulde 'Nasıl karar verildi?' bağlantıları çıkmaz", () => {
    expect(step(at("enacted", { events, results: [] }), member).links).toEqual([]);
  });

  it("reddedildi: bildirim başlığı + gerekçe; silme talebinde arşiv notu", () => {
    const s = step(at("rejected", { events: [event("rejected", 5, "Red: onay oranı eşiğin altında.")], results }), member);
    expect(s).toMatchObject({ tone: "danger", headline: "Öneri reddedildi", detail: "Red: onay oranı eşiğin altında." });
    expect(labels(s)).toEqual(["Nasıl karar verildi?", "Sayımı doğrula"]);
    const del = step(at("rejected", { kind: "deletion", events: [event("rejected", 5, "Red.")], results }), member);
    expect(del.detail).toBe("Red. Silme talebi herkese açık olarak arşivlendi; hedef mesajlar görünür kalır.");
  });

  it("yönetmeliğe aykırı: 'Hangi madde?' ontoloji bağlantısı, sayım bağlantıları yok", () => {
    const s = step(at("inadmissible", { events: [event("inadmissible", 5, "Madde 4'e aykırı.")] }), member);
    expect(s).toMatchObject({ tone: "danger", headline: "Yönetmeliğe aykırı — oylanamaz", detail: "Madde 4'e aykırı." });
    expect(s.links).toEqual([{ label: "Hangi madde?", bolum: "ontoloji" }]);
  });

  it("yönetmeliğe aykırı ve gerekçe yoksa ilk ihlal iletisi kullanılır", () => {
    const audit = { violations: [{ code: "x", message: "Değiştirilemez hükme aykırı." }] } as unknown as ProposalDetail["audit"];
    expect(step(at("inadmissible", { events: [], audit }), member).detail).toBe("Değiştirilemez hükme aykırı.");
    expect(step(at("inadmissible", { events: [] }), member).detail).toBe("Otomatik denetim öneriyi yönetmeliğe aykırı buldu.");
  });

  it("geri çekildi ve süresi doldu: varsayılan metinler birebir", () => {
    expect(step(at("withdrawn", { events: [] }), member)).toMatchObject({ tone: "neutral", headline: "Öneri geri çekildi", detail: "Yazar öneriyi geri çekti. Kayıt herkese açık arşivde kalır." });
    expect(step(at("withdrawn", { events: [event("withdrawn", 1, "Yazar geri çekti (x).")] }), member).detail).toBe("Yazar geri çekti (x). Kayıt herkese açık arşivde kalır.");
    expect(step(at("expired", { events: [] }), member)).toMatchObject({ tone: "neutral", headline: "Süresi doldu", detail: "Destekçi toplama süresinde yeterli destek gelmedi." });
    expect(step(at("expired", { events: [event("expired", 1, "Süre doldu.")] }), member).detail).toBe("Süre doldu.");
  });

  it("terminal evrelerin rolü ayırt etmeden aynı metni verir (anonim dahil)", () => {
    for (const status of ["enacted", "rejected", "inadmissible", "withdrawn", "expired"] as ProposalStatus[]) {
      const p = at(status, { events, results });
      expect(step(p, anon), status).toEqual(step(p, author));
    }
  });
});

describe("denetçi ve bütünlük uyarısı", () => {
  const warnings = [warning()];

  it("D rolü ve uyarı varsa 'Bütünlük uyarısını incele' ilk bağlantı olur", () => {
    const p = at("objection_window", { results: [result(1)], integrityWarnings: warnings });
    const s = step(p, auditor);
    expect(s.links[0]).toEqual({ label: "Bütünlük uyarısını incele", bolum: "butunluk" });
    expect(s.links).toHaveLength(2);
  });

  it("terminal evrede üst sınır: 2 bağlantı (bütünlük + 'Nasıl karar verildi?'), 'Sayımı doğrula' düşer", () => {
    const p = at("enacted", { events: [], results: [result(1)], integrityWarnings: warnings });
    expect(labels(step(p, admin))).toEqual(["Bütünlük uyarısını incele", "Nasıl karar verildi?"]);
  });

  it("yönetici (A, D) ile denetçi (D) aynı bağlantıyı alır", () => {
    const p = at("voting", { votingRound: 1, canVote: true, integrityWarnings: warnings });
    expect(step(p, admin).links[0]?.label).toBe("Bütünlük uyarısını incele");
    expect(step(p, auditor).links[0]?.label).toBe("Bütünlük uyarısını incele");
  });

  it("D olmayanlar bağlantıyı görmez", () => {
    const p = at("enacted", { events: [], results: [result(1)], integrityWarnings: warnings });
    for (const v of [anon, member, voter, author]) expect(labels(step(p, v))).not.toContain("Bütünlük uyarısını incele");
  });

  it("uyarı yoksa D için de bağlantı çıkmaz; eski sunucu alanı göndermezse çökmez", () => {
    expect(labels(step(at("enacted", { events: [], results: [result(1)] }), auditor))).toEqual(["Nasıl karar verildi?", "Sayımı doğrula"]);
    const legacy = at("enacted", { events: [], results: [] }) as Partial<ProposalDetail>;
    delete legacy.integrityWarnings;
    expect(() => step(legacy as ProposalDetail, auditor)).not.toThrow();
    expect(step(legacy as ProposalDetail, auditor).links).toEqual([]);
  });

  it("evre ne olursa olsun D için ilk bağlantı bütünlük uyarısıdır (taslak hariç hepsi)", () => {
    for (const status of ["sponsoring", "deliberation", "voting", "objection_window", "reconciliation", "revote", "enacted", "rejected", "withdrawn", "expired"] as ProposalStatus[]) {
      const s = step(at(status, { integrityWarnings: warnings, results: [result(1)] }), auditor);
      expect(s.links[0]?.label, status).toBe("Bütünlük uyarısını incele");
    }
  });
});

// ───────────────────────── Sözleşmeler ─────────────────────────

/** Her evre × her görüntüleyen × bayrak bileşimi × zengin/boş veri. */
function allCases(): { name: string; p: ProposalDetail; v: Viewer }[] {
  const statuses: ProposalStatus[] = ["draft", "sponsoring", "inadmissible", "deliberation", "voting", "objection_window", "reconciliation", "revote", "enacted", "rejected", "withdrawn", "expired"];
  const kinds: ProposalKind[] = ["topic", "subtopic", "amendment", "deletion", "regulation"];
  const out: { name: string; p: ProposalDetail; v: Viewer }[] = [];
  for (const status of statuses) {
    for (const [vn, v] of Object.entries(NAMED_VIEWERS)) {
      for (const flags of [0, 1, 2, 3, 4, 5, 6, 7]) {
        for (const kind of kinds) {
          for (const rich of [false, true]) {
            const base: Partial<ProposalDetail> = {
              status,
              kind,
              canVote: !!(flags & 1),
              canObject: !!(flags & 2),
              canWriteMinorityReport: !!(flags & 4),
            };
            const richer: Partial<ProposalDetail> = rich
              ? {
                  sponsors: v.id ? [{ userId: v.id, nickname: "ben", at: 1 }] : [],
                  suggestions: [suggestion("open")],
                  results: [result(1)],
                  objections: [objection(v.id ?? "")],
                  minorityReports: [report(v.id ?? OTHER)],
                  expertPanel: panel([{ expertId: v.id ?? OTHER, status: flags % 2 ? "accepted" : "invited" }], 2),
                  integrityWarnings: [warning()],
                  myBallot: ballot("yes"),
                  enactedEntityId: "e1",
                  deletion: { messageIds: ["m"], ground: "g", statement: "s" },
                  events: [event(status, 5, "Gerekçe")],
                }
              : {};
            out.push({ name: `${status}/${vn}/bayrak${flags}/${kind}/${rich ? "zengin" : "boş"}`, p: proposal({ ...base, ...richer }), v });
          }
        }
      }
    }
  }
  return out;
}

const CASES = allCases();

/** Etiketlerde geçmeyecek alt dizeler (e2e adlarıyla çakışma; plan 'Test sözleşmeleri' b, c). */
const FORBIDDEN_IN_LABELS = ["Destekle", "Oyumu ver", "Daha fazla", "Sayımı kendim doğrulayayım", "Kapat", "Gerekçe", "Açıklama", "Azınlık raporu"];
/** Başlık ve ayrıntıda geçmeyecek sayfa metinleri (getByText ve toContainText ile çakışırlar). */
const FORBIDDEN_IN_TEXT = [
  "Bu öneriyi desteklediniz",
  "Makbuz bu cihazda kayıtlı",
  "Oyumu ver",
  "Daha fazla",
  "Sayımı kendim doğrulayayım",
  "Toplam geçerli imza",
  "Anonim imzacı",
  "Oyunuz kayıtlı ve sayıma girdi",
  "Şimdilik doğrulandı",
  "Kurcalama yakalandı",
  "İtiraz geçerli — uzlaşma turu",
  "Küme kuralı",
  "Sonuç kesindir.",
  "1. tur sonucu",
  "Uzlaşma turu",
  "Köken:",
  "kapat",
];

const contains = (s: string, part: string) => s.toLocaleLowerCase("tr").includes(part.toLocaleLowerCase("tr"));
const allLinks = (s: NextStep): NextStepLink[] => (s.cta ? [s.cta, ...s.links] : s.links);

describe("sözleşmeler: tüm evre × kullanıcı × bayrak bileşimleri", () => {
  it("kapsam: 12 evre, 11 kullanıcı durumu, binlerce bileşim", () => {
    expect(CASES.length).toBeGreaterThan(5000);
    expect(new Set(CASES.map((c) => c.p.status)).size).toBe(12);
  });

  it("hep dolu bir başlık ve geçerli bir ton döner; ikincil bağlantılar en çok 2'dir ve birincil eylemle ya da birbiriyle çakışmaz", () => {
    const tones = new Set(["action", "info", "warning", "success", "danger", "neutral"]);
    for (const c of CASES) {
      const s = step(c.p, c.v);
      expect(s.headline.length, c.name).toBeGreaterThan(0);
      expect(tones.has(s.tone), c.name).toBe(true);
      expect(s.links.length, c.name).toBeLessThanOrEqual(2);
      const targets = allLinks(s).map((l) => `${l.bolum ?? ""}|${l.to ?? ""}`);
      expect(new Set(targets).size, c.name).toBe(targets.length);
    }
  });

  it("bağlantı etiketlerinde e2e adlarıyla çakışan alt dize yoktur", () => {
    for (const c of CASES) {
      for (const l of allLinks(step(c.p, c.v))) {
        for (const bad of FORBIDDEN_IN_LABELS) expect(contains(l.label, bad), `${c.name}: "${l.label}" ⊃ "${bad}"`).toBe(false);
      }
    }
  });

  it("başlık ve ayrıntıda sayfadaki test metinleri geçmez; 'destekle' yalnız planın yazar cümlesinde geçer", () => {
    for (const c of CASES) {
      const s = step(c.p, c.v);
      for (const text of [s.headline, s.detail ?? ""]) {
        for (const bad of FORBIDDEN_IN_TEXT) expect(contains(text, bad), `${c.name}: "${text}" ⊃ "${bad}"`).toBe(false);
      }
      if (contains(s.headline, "destekle")) expect(s.headline, c.name).toBe("Kendi önerinizi destekleyemezsiniz; destekçi bekleniyor");
      expect(contains(s.detail ?? "", "destekle"), c.name).toBe(false);
    }
  });

  it("her bağlantı ya geçerli bir çapa ya da uygulama içi yoldur; çapalar STEP_ANCHORS içindedir", () => {
    for (const c of CASES) {
      for (const l of allLinks(step(c.p, c.v))) {
        expect(Number(l.bolum !== undefined) + Number(l.to !== undefined), `${c.name}: ${l.label}`).toBe(1);
        if (l.bolum !== undefined) {
          expect(parseSectionParam(l.bolum), `${c.name}: ${l.bolum}`).toBe(l.bolum);
          expect(STEP_ANCHORS).toContain(l.bolum);
        } else {
          expect(l.to!.startsWith("/"), `${c.name}: ${l.to}`).toBe(true);
        }
      }
    }
  });

  it("girdileri değiştirmez (derin dondurulmuş öneri ve görüntüleyen ile çalışır) ve aynı girdiye aynı çıktıyı verir", () => {
    const freeze = <T>(o: T): T => {
      if (o && typeof o === "object" && !Object.isFrozen(o)) {
        Object.freeze(o);
        for (const k of Object.keys(o)) freeze((o as Record<string, unknown>)[k]);
      }
      return o;
    };
    for (const c of CASES.filter((_, i) => i % 7 === 0)) {
      const p = freeze(structuredClone(c.p));
      const v = freeze(structuredClone(c.v));
      const first = step(p, v);
      expect(step(p, v), c.name).toEqual(first);
      expect(step(p, v), c.name).toEqual(step(c.p, c.v));
    }
  });

  it("detail yoksa anahtar hiç yoktur (undefined alanı sızmaz)", () => {
    for (const c of CASES.filter((_, i) => i % 11 === 0)) {
      const s = step(c.p, c.v);
      expect(Object.keys(s).sort(), c.name).toEqual(["headline", ...(s.cta ? ["cta"] : []), ...(s.detail ? ["detail"] : []), "links", "tone"].sort());
    }
  });
});

describe("çapalar ve bağlantı yolları", () => {
  it("STEP_ANCHORS planın çapalarıdır ve hepsi ?bolum= olarak geçerlidir", () => {
    expect([...STEP_ANCHORS].sort()).toEqual(["bilirkisi", "butunluk", "dogrula", "eylem", "ontoloji", "sonuclar", "tartisma"]);
    for (const a of STEP_ANCHORS) expect(parseSectionParam(a)).toBe(a);
  });

  it("nextStepHref çapayı routes.proposal'a, yolu olduğu gibi verir", () => {
    expect(nextStepHref("abc", { bolum: "eylem" })).toBe("/oneriler/abc?bolum=eylem");
    expect(nextStepHref("a b", { bolum: "sonuclar" })).toBe("/oneriler/a%20b?bolum=sonuclar");
    expect(nextStepHref("abc", { to: "/profil" })).toBe("/profil");
    const s = step(at("voting", { id: "p-9", votingRound: 1, canVote: true }), voter);
    expect(nextStepHref("p-9", s.cta!)).toBe("/oneriler/p-9?bolum=eylem");
  });
});
