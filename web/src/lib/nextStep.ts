// Sıradaki adım motoru (SAF): öneri sayfasının ilk ekranındaki "Sıradaki adım" kartının içeriğini üretir —
// "ne oldu / benden ne bekleniyor / nereye gideyim?". Karar mantığı SUNUCUDA kalır: bu dosya yalnız sunucunun gönderdiği
// bayrakları (canVote, canObject, canWriteMinorityReport, myBallot) ve ProposalDetail alanlarını (authorId, sponsors,
// expertPanel.assignments, suggestions, objections, minorityReports, results, events, integrityWarnings) okur; kimin seçmen
// olduğu, kimin itiraz edebileceği gibi kurallar ASLA tahmin edilmez. Oy verememe nedeni VotePanel'deki ayrımın aynısıdır
// (doğrulanmamış / 18 yaş / siyasi görüş rızası / dondurulmuş seçmen listesi).
// Bağlantı hedefleri `?bolum=<çapa>` çapalarıdır (lib/sectionParam.ts); `nextStepHref` bunları yola çevirir.
// Etiketler e2e sözleşmelerine dokunmaz: 'Destekle', 'Oyumu ver', 'Daha fazla', 'Sayımı kendim doğrulayayım', 'Kapat' geçmez.
// Kullanım:
//   const viewer = viewerOf(auth);                          // auth yüklendikten sonra (auth.loading false)
//   const step = proposalNextStep(p, viewer);
//   <Link to={nextStepHref(p.id, step.cta)}>{step.cta.label}</Link>
import { VOTE_LABELS, type AssignmentStatus, type Me, type PhaseEvent, type ProposalDetail, type ProposalStatus, type UserStatus } from "@forum/shared";
import { routes } from "./routes";

// ───────────────────────── Tipler ─────────────────────────

/**
 * Kartın rengi. Renk rolleri (plan): mavi = eylem ve 'şu an', yeşil/kırmızı = sonuç, turuncu = dikkat ve süre.
 *  - action:  benden bir iş bekleniyor (mavi, vurgulu)
 *  - info:    bilgi / bekleme (mavi, sakin)
 *  - warning: dikkat ya da süre baskısı (turuncu)
 *  - success: kabul edildi (yeşil)
 *  - danger:  reddedildi ya da yönetmeliğe aykırı (kırmızı)
 *  - neutral: nötr kapanış (geri çekildi, süresi doldu) ya da yapılacak bir şey yok (gri)
 */
export type NextStepTone = "action" | "info" | "warning" | "success" | "danger" | "neutral";

/** Öneri sayfasında bulunması gereken `?bolum=` çapaları (kart/bölüm id'si). */
export type StepAnchor = "eylem" | "tartisma" | "bilirkisi" | "sonuclar" | "dogrula" | "ontoloji" | "butunluk";

/** Bu motorun kullandığı çapaların tam listesi (öneri sayfası bu id'leri taşımalıdır). */
export const STEP_ANCHORS: readonly StepAnchor[] = ["eylem", "tartisma", "bilirkisi", "sonuclar", "dogrula", "ontoloji", "butunluk"];

/** Bağlantı hedefi: ya bu sayfadaki bir çapa (`bolum`) ya da uygulama içi bir yol (`to`). */
export type NextStepTarget = { bolum: StepAnchor; to?: undefined } | { to: string; bolum?: undefined };

export type NextStepLink = NextStepTarget & { label: string };

export interface NextStep {
  tone: NextStepTone;
  /** Tek cümle: ne oldu / benden ne bekleniyor */
  headline: string;
  /** İsteğe bağlı ikinci cümle (panel metnini tekrar etmez) */
  detail?: string;
  /** Birincil eylem bağlantısı (düğme DEĞİL, bağlantıdır) */
  cta?: NextStepLink;
  /** İkincil 'soru' bağlantıları; en çok 2 */
  links: NextStepLink[];
}

/** Görüntüleyenin motorun ihtiyaç duyduğu özeti (AuthContext'ten `viewerOf` ile). */
export interface Viewer {
  /** Oturum yoksa null (anonim) */
  id: string | null;
  status: UserStatus | null;
  /** auth.can(...) sonuçları: V doğrulanmış, VV oy verebilir (doğrulanmış + 18 yaş + siyasi rıza), D denetçi/yönetici, A yönetici */
  can: { V: boolean; VV: boolean; D: boolean; A: boolean };
  politicalConsent: boolean;
  isAdult: boolean;
}

/** `viewerOf`un okuduğu kısım; AuthContextValue bunu karşılar. */
export interface ViewerSource {
  user: Pick<Me, "id" | "status" | "politicalConsent" | "isAdult"> | null;
  can(perm: "V" | "VV" | "D" | "A"): boolean;
}

/** Oturumsuz görüntüleyen (auth.loading sürerken de bunu kullanmayın: yüklemeyi bekleyin). */
export const ANONYMOUS_VIEWER: Viewer = {
  id: null,
  status: null,
  can: { V: false, VV: false, D: false, A: false },
  politicalConsent: false,
  isAdult: false,
};

/** Oturum bağlamından yalnız gerekli alanları alır. */
export function viewerOf(auth: ViewerSource): Viewer {
  const u = auth.user;
  return {
    id: u?.id ?? null,
    status: u?.status ?? null,
    can: { V: auth.can("V"), VV: auth.can("VV"), D: auth.can("D"), A: auth.can("A") },
    politicalConsent: !!u?.politicalConsent,
    isAdult: !!u?.isAdult,
  };
}

/** Bağlantının gideceği yol: çapa ise `/oneriler/<id>?bolum=<çapa>`, değilse `to`. */
export function nextStepHref(proposalId: string, target: NextStepTarget): string {
  return target.bolum !== undefined ? routes.proposal(proposalId, { bolum: target.bolum }) : target.to;
}

// ───────────────────────── Ortak parçalar ─────────────────────────

const MAX_LINKS = 2;

type Draft = Omit<NextStep, "links"> & { links?: NextStepLink[] };

const list = <T>(x: readonly T[] | null | undefined): readonly T[] => x ?? [];

const go = (label: string, bolum: StepAnchor): NextStepLink => ({ label, bolum });

const GO_ACTION = (label: string): NextStepLink => go(label, "eylem");
const GO_DISCUSSION = go("Tartışmaya git", "tartisma");
const LOGIN: NextStepLink = { label: "Giriş yap", to: routes.login() };
const HOW_DECIDED = go("Nasıl karar verildi?", "sonuclar");
const VERIFY_TALLY = go("Sayımı doğrula", "dogrula");
const WHICH_ARTICLE = go("Hangi madde?", "ontoloji");
const INTEGRITY = go("Bütünlük uyarısını incele", "butunluk");

const sameTarget = (a: NextStepLink, b: NextStepLink): boolean => a.bolum === b.bolum && a.to === b.to;

/** Son evre olayı (en yeni `at`; eşitlikte sonraki). EnactedEffect ve sayfadaki lastEvent ile aynı kayıt. */
function lastEventOf(p: ProposalDetail): PhaseEvent | null {
  let last: PhaseEvent | null = null;
  for (const e of list(p.events)) if (!last || e.at >= last.at) last = e;
  return last;
}

/** Bu görüntüleyen için bekleyen bilirkişi ataması (davet edildi / görevi kabul etti); sunucudaki Ana sayfa görevleriyle aynı iki durum. */
function pendingAssignment(p: ProposalDetail, v: Viewer) {
  if (!v.id) return null;
  return list(p.expertPanel?.assignments).find((a) => a.expertId === v.id && (a.status === "invited" || a.status === "accepted")) ?? null;
}

/** Bilirkişi raporu yayımlandıysa 'Bilirkişi: n rapor' bağlantısı. */
function expertReportsLink(p: ProposalDetail): NextStepLink[] {
  const n = list(p.expertPanel?.reports).length;
  return n > 0 ? [go(`Bilirkişi: ${n} rapor`, "bilirkisi")] : [];
}

/** Sonuç kartının var olduğu evrelerde (kesin tur sayımı yapılmış) 'soru' bağlantıları. */
function decisionLinks(p: ProposalDetail): NextStepLink[] {
  return list(p.results).length > 0 ? [HOW_DECIDED, VERIFY_TALLY] : [];
}

// ───────────────────────── Evre × rol ─────────────────────────

interface Ctx {
  p: ProposalDetail;
  v: Viewer;
  isAuthor: boolean;
}

function draftStep({ isAuthor }: Ctx): Draft {
  if (isAuthor) {
    return { tone: "action", headline: "Taslak yalnız size görünür", detail: "Hazır olduğunuzda destekçi toplamaya gönderin.", cta: GO_ACTION("Taslak işlemlerine git") };
  }
  return { tone: "neutral", headline: "Bu öneri henüz taslak", detail: "Yazar destekçi toplamaya gönderince herkese açılır." };
}

function sponsoringStep({ p, v, isAuthor }: Ctx): Draft {
  const have = p.sponsorCount;
  const need = p.sponsorsRequired;
  if (isAuthor) {
    return { tone: "info", headline: "Kendi önerinizi destekleyemezsiniz; destekçi bekleniyor", detail: `Şu an ${have}/${need} destekçi var; tamamlanınca tartışma açılır.` };
  }
  if (!v.id) return { tone: "info", headline: "Destek vermek için giriş yapın", cta: LOGIN };
  if (!v.can.V) {
    if (v.status === "pending") return { tone: "neutral", headline: "Doğrulandıktan sonra destek verebilirsiniz" };
    if (v.status === "rejected") return { tone: "neutral", headline: "Kimlik doğrulamanız reddedildi; destek veremezsiniz" };
    return { tone: "neutral", headline: "Hesabınız askıda; destek veremezsiniz" };
  }
  if (list(p.sponsors).some((s) => s.userId === v.id)) {
    return { tone: "info", headline: "Desteğiniz kayıtlı; destekçiler tamamlanınca tartışma açılır", detail: `Şu an ${have}/${need} destekçi var.` };
  }
  return {
    tone: "action",
    headline: `Destekçi bekleniyor (${have}/${need})`,
    detail: need > have ? `${need - have} destekçi daha gerekiyor.` : undefined,
    cta: GO_ACTION("Destek bölümüne git"),
  };
}

/** Atanmış bilirkişi: davet yanıtı ya da rapor. Görevi yanıtlama ve rapor formu Bilirkişiler › Görevlerim sekmesindedir. */
function expertStep(status: AssignmentStatus): Draft {
  const tasks: NextStepLink = { label: "Bilirkişi görevlerim", to: `${routes.experts()}?sekme=gorevlerim` };
  if (status === "invited") {
    return {
      tone: "action",
      headline: "Bilirkişi davetini yanıtlamanız bekleniyor",
      detail: "Görevi kabul edin ya da gerekçenizi yazarak çekinin; kabul ederseniz raporunuzu yazarsınız.",
      cta: go("Bilirkişi bölümüne git", "bilirkisi"),
      links: [tasks],
    };
  }
  return {
    tone: "action",
    headline: "Raporunuz bekleniyor",
    detail: "Raporunuzu Bilirkişiler sayfasındaki Görevlerim sekmesinden gönderirsiniz.",
    cta: go("Bilirkişi bölümüne git", "bilirkisi"),
    links: [tasks],
  };
}

function deliberationStep({ p, v, isAuthor }: Ctx): Draft {
  const messages = p.messageCount;
  if (isAuthor) {
    const open = list(p.suggestions).filter((s) => s.status === "open").length;
    if (open > 0) {
      return {
        tone: "action",
        headline: `${open} metin önerisi yanıtınızı bekliyor`,
        detail: "Oylama başlamadan karar vermezseniz bu öneriler karar verilmeden kapanır.",
        cta: GO_ACTION("Metin önerilerine git"),
        links: expertReportsLink(p),
      };
    }
    return {
      tone: "info",
      headline: `Tartışma sürüyor (${messages} mesaj)`,
      detail: "Yeni metin önerileri gelirse burada görünür; oylama başlarken metin kilitlenir.",
      cta: GO_DISCUSSION,
      links: expertReportsLink(p),
    };
  }
  const assignment = pendingAssignment(p, v);
  if (assignment) return expertStep(assignment.status);
  if (v.can.V) {
    return {
      tone: "info",
      headline: `Tartışmaya katılın (${messages} mesaj)`,
      detail: "Görüş yazabilir ya da metne değişiklik önerebilirsiniz; süre bitince oylama başlar.",
      cta: GO_DISCUSSION,
      links: expertReportsLink(p),
    };
  }
  const why = !v.id
    ? "Okuyabilirsiniz; yazmak için giriş yapın."
    : v.status === "pending"
      ? "Okuyabilirsiniz; yazmak için hesabınızın doğrulanması gerekir."
      : "Okuyabilirsiniz; hesabınızla bu öneriye yazamazsınız.";
  return { tone: "info", headline: `Tartışma sürüyor (${messages} mesaj)`, detail: why, cta: GO_DISCUSSION, links: expertReportsLink(p) };
}

/** canVote=false iken neden: VotePanel'deki ayrımla aynı (doğrulanmamış → 18 yaş → siyasi rıza → dondurulmuş liste). */
function cannotVoteStep(v: Viewer): Draft {
  if (!v.can.V) {
    if (v.status === "pending") return { tone: "neutral", headline: "Oy vermek için doğrulanmış üye olmanız gerekir" };
    if (v.status === "rejected") return { tone: "neutral", headline: "Kimlik doğrulamanız reddedildi; oy veremezsiniz" };
    return { tone: "neutral", headline: "Hesabınız askıda; oy veremezsiniz" };
  }
  if (!v.can.VV) {
    if (!v.isAdult) return { tone: "neutral", headline: "Oy vermek için 18 yaşını doldurmuş olmanız gerekir" };
    if (!v.politicalConsent) {
      return {
        tone: "warning",
        headline: "Oy vermek için siyasi görüş rızası gerekir",
        detail: "Rızanızı Profil sayfasındaki Rızalar bölümünden yönetebilirsiniz.",
        cta: { label: "Profil › Rızalar", to: routes.profile() },
      };
    }
  }
  return {
    tone: "neutral",
    headline: "Bu oylamada oy kullanamıyorsunuz",
    detail: "Uygun seçmen listesi oylama açılırken dondurulur; sonradan doğrulanan üyeler ve (silme taleplerinde) hedef mesajın yazarı listede yer almaz.",
  };
}

function votingStep({ p, v }: Ctx): Draft {
  const revote = p.status === "revote";
  const links = [...(revote && list(p.results).length > 0 ? [go("İlk turun sonucu", "sonuclar")] : []), ...expertReportsLink(p)];
  if (!v.id) {
    return { tone: "info", headline: "Oy için giriş yapın", detail: "Öneriyi ve tartışmayı giriş yapmadan okuyabilirsiniz.", cta: LOGIN, links };
  }
  const ballot = p.myBallot;
  if (ballot) {
    const choice = VOTE_LABELS[ballot.choice];
    return p.canVote
      ? { tone: "info", headline: `Oyunuz kayıtlı (${choice}); süre bitene kadar değiştirebilirsiniz`, links }
      : { tone: "info", headline: `Oyunuz kayıtlı (${choice})`, detail: "Bu oylamada yeni oy kullanamıyorsunuz.", links };
  }
  if (p.canVote) {
    return {
      tone: "action",
      headline: "Oyunuz bekleniyor",
      detail: revote ? "Yeniden oylama: süre bitene kadar oyunuzu değiştirebilirsiniz." : "Oy gizlidir; süre bitene kadar değiştirebilirsiniz.",
      cta: GO_ACTION("Oy bölümüne git"),
      links,
    };
  }
  return { ...cannotVoteStep(v), links };
}

function objectionStep({ p, v }: Ctx): Draft {
  const links = decisionLinks(p);
  if (p.canObject) {
    return { tone: "action", headline: "İlk turda Red dediğiniz için itiraz hakkınız var", cta: GO_ACTION("İtiraz bölümüne git"), links };
  }
  if (v.id && list(p.objections).some((o) => !!o.userId && o.userId === v.id)) {
    return { tone: "info", headline: "İtirazınız imzalandı", detail: "Süre bitince karar kesinleşir ya da geçerli itiraz varsa uzlaşma sürecine gider.", links };
  }
  return { tone: "warning", headline: "Karar itiraz süresinde", detail: "Süre bitince karar kesinleşir ya da geçerli itiraz varsa uzlaşma sürecine gider.", links };
}

function reconciliationStep({ p, v, isAuthor }: Ctx): Draft {
  const assignment = pendingAssignment(p, v);
  if (assignment) return expertStep(assignment.status);
  const links = decisionLinks(p);
  if (p.canWriteMinorityReport) {
    return {
      tone: "action",
      headline: "Azınlık raporunuzu yazabilirsiniz",
      detail: isAuthor
        ? "Yazar olarak köprü taslaklarını inceleyebilir ya da metni revize edebilirsiniz."
        : "İlk turdaki etkin oyunuz Red olduğu için rapor yazabilirsiniz; rapor karar kaydına eklenir.",
      cta: GO_ACTION("Uzlaşma bölümüne git"),
      links,
    };
  }
  if (isAuthor) {
    return { tone: "action", headline: "Köprü taslaklarını inceleyin ya da metni revize edin", cta: GO_ACTION("Uzlaşma bölümüne git"), links };
  }
  if (v.id && list(p.minorityReports).some((r) => r.authorId === v.id)) {
    return { tone: "info", headline: "Azınlık raporunuz kayıtlı; uzlaşma süreci sürüyor", detail: "Süre bitince metin yeniden oylanır.", links };
  }
  return { tone: "warning", headline: "Uzlaşma süreci sürüyor", detail: "Süre bitince metin yeniden oylanır; azınlık raporları ve köprü taslakları uzlaşma bölümünde.", links };
}

/** EnactedEffect'teki kurala birebir: türe göre etki cümlesi ve (varsa) bağlantı. */
function enactedEffect(p: ProposalDetail): { text: string | null; cta?: NextStepLink } {
  switch (p.kind) {
    case "topic":
    case "subtopic":
      return p.enactedEntityId
        ? {
            text: p.kind === "topic" ? "Yeni konu oluşturuldu." : "Alt konu oluşturuldu.",
            cta: { label: "Oluşan konuya git", to: routes.topic(p.enactedEntityId) },
          }
        : { text: null };
    case "amendment":
      return p.enactedEntityId
        ? { text: "Konu metni yeni sürümle güncellendi.", cta: { label: "Konuya git", to: routes.topic(p.enactedEntityId) } }
        : { text: null };
    case "deletion":
      return { text: p.deletion ? `${p.deletion.messageIds.length} mesaj karartıldı (silinmedi); yerlerinde mezar taşı görünür.` : null };
    case "regulation":
      return {
        text: p.enactedEntityId ? `Yönetmeliğin ${p.enactedEntityId}. sürümü yürürlüğe girdi.` : "Yeni yönetmelik sürümü yürürlüğe girdi.",
        cta: { label: "Yönetmeliği görüntüle", to: routes.ontology() },
      };
    default:
      return { text: null };
  }
}

const joinSentences = (...parts: (string | null | undefined)[]): string | undefined => {
  const s = parts.filter((x): x is string => !!x).join(" ");
  return s || undefined;
};

/** Terminal evre metinleri StatusNotice / EnactedEffect / InadmissibleNotice ile birebir aynıdır (başlık = bildirim başlığı). */
function terminalStep(p: ProposalDetail): Draft {
  const reason = lastEventOf(p)?.reason || null;
  switch (p.status) {
    case "enacted": {
      const effect = enactedEffect(p);
      return { tone: "success", headline: "Karar yürürlükte", detail: joinSentences(reason, effect.text), cta: effect.cta, links: decisionLinks(p) };
    }
    case "rejected":
      return {
        tone: "danger",
        headline: "Öneri reddedildi",
        detail: joinSentences(reason, p.kind === "deletion" ? "Silme talebi herkese açık olarak arşivlendi; hedef mesajlar görünür kalır." : null),
        links: decisionLinks(p),
      };
    case "inadmissible":
      return {
        tone: "danger",
        headline: "Yönetmeliğe aykırı — oylanamaz",
        detail: reason ?? list(p.audit?.violations)[0]?.message ?? "Otomatik denetim öneriyi yönetmeliğe aykırı buldu.",
        links: [WHICH_ARTICLE],
      };
    case "withdrawn":
      return { tone: "neutral", headline: "Öneri geri çekildi", detail: `${reason ?? "Yazar öneriyi geri çekti."} Kayıt herkese açık arşivde kalır.` };
    default:
      return { tone: "neutral", headline: "Süresi doldu", detail: reason ?? "Destekçi toplama süresinde yeterli destek gelmedi." };
  }
}

function stepFor(ctx: Ctx): Draft {
  const status: ProposalStatus = ctx.p.status;
  switch (status) {
    case "draft":
      return draftStep(ctx);
    case "sponsoring":
      return sponsoringStep(ctx);
    case "deliberation":
      return deliberationStep(ctx);
    case "voting":
    case "revote":
      return votingStep(ctx);
    case "objection_window":
      return objectionStep(ctx);
    case "reconciliation":
      return reconciliationStep(ctx);
    case "enacted":
    case "rejected":
    case "inadmissible":
    case "withdrawn":
    case "expired":
      return terminalStep(ctx.p);
    default:
      return { tone: "neutral", headline: "Öneri" };
  }
}

/**
 * Önerinin sayfasında görüntüleyen için 'sıradaki adım'. İkincil bağlantılar en çok 2'dir; denetçi/yönetici (D) için
 * bütünlük uyarısı varsa 'Bütünlük uyarısını incele' başa alınır (üst sınır nedeniyle sondaki bağlantı düşer).
 */
export function proposalNextStep(p: ProposalDetail, v: Viewer): NextStep {
  const draft = stepFor({ p, v, isAuthor: !!v.id && v.id === p.authorId });
  const links: NextStepLink[] = [];
  const push = (l: NextStepLink) => {
    // Aynı yere giden ikinci bağlantı (birincil eylemle ya da öncekilerle) gereksizdir.
    if (links.some((x) => sameTarget(x, l)) || (draft.cta && sameTarget(draft.cta, l))) return;
    links.push(l);
  };
  if (v.can.D && list(p.integrityWarnings).length > 0) push(INTEGRITY);
  for (const l of draft.links ?? []) push(l);
  const step: NextStep = { tone: draft.tone, headline: draft.headline, links: links.slice(0, MAX_LINKS) };
  if (draft.detail) step.detail = draft.detail;
  if (draft.cta) step.cta = draft.cta;
  return step;
}
