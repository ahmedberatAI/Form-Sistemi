// Oy / itiraz / azınlık raporu yetkisinin TEK kaynağı. ProposalDetail bayrakları (canVote, canObject, canWriteMinorityReport) ve
// Ana sayfa görevleri (vote, object, reconciliation) AYNI koşulları buradan alır: Ana sayfa "itiraz hakkınız var" derken öneri
// sayfası formu göstermemesin (rıza geri çekilmiş, 30 günlük itiraz bütçesi dolmuş, hesap askıda…). ProposalService'in yaptırımı
// (requireVoter vb.) aynı koşulları hata iletileriyle ayrı ayrı denetler; bayraklar o yaptırımın "olur" yanıtıdır.
import type { RevealEntry } from "@forum/shared";
import { objectionBudgetOf } from "./objection-budget";
import { firstRoundChoice } from "./tally";
import { isVotingStatus, type ForumCore, type ProposalRow, type UserRowLite } from "./util";

/** Yetki kararı için gereken öneri alanları. */
export type PhaseRow = Pick<ProposalRow, "id" | "status" | "phase_ends_at">;

/** Üyenin bu öneride seçmen olarak GÜNCEL durumu (oy, itiraz ve azınlık raporu üçü de üçünü birden ister). */
export interface VoterStanding {
  /** Uygun seçmen listesinde (liste oylama açılışında dondurulur) */
  eligible: boolean;
  /** Hesap doğrulanmış: askıdaki, bekleyen, reddedilen ya da silinmiş üye oy veremez */
  active: boolean;
  /** Siyasi görüş açık rızası var (geri çekilmiş olabilir) */
  consent: boolean;
}

export function voterStandingOf(me: Pick<UserRowLite, "status" | "political_consent"> | undefined, eligible: boolean): VoterStanding {
  return { eligible, active: me?.status === "verified", consent: me?.political_consent === 1 };
}

export function voterStanding(core: ForumCore, proposalId: string, userId: string): VoterStanding {
  const eligible = !!core.db.get("SELECT 1 FROM eligible_voters WHERE proposal_id = ? AND user_id = ?", proposalId, userId);
  return voterStandingOf(core.user(userId), eligible);
}

export const isCurrentVoter = (s: VoterStanding): boolean => s.eligible && s.active && s.consent;

const phaseOpen = (p: Pick<PhaseRow, "phase_ends_at">, now: number): boolean => p.phase_ends_at !== null && now < p.phase_ends_at;

/** Oy evresi sürüyor (oylama ya da yeniden oylama, süre dolmadı). */
export const votingOpen = (p: Pick<PhaseRow, "status" | "phase_ends_at">, now: number): boolean => isVotingStatus(p.status) && phaseOpen(p, now);

/** İtiraz süresi sürüyor. */
export const objectionOpen = (p: Pick<PhaseRow, "status" | "phase_ends_at">, now: number): boolean => p.status === "objection_window" && phaseOpen(p, now);

/** Azınlık raporu yazılabilen evre (süre denetlenmez: sunucu da denetlemez). */
export const minorityReportStage = (p: Pick<PhaseRow, "status">): boolean => p.status === "reconciliation" || p.status === "objection_window";

/** Çağıranın zaten elinde olan bilgiler; verilmezse yardımcı kendisi okur. */
export interface RightsHints {
  standing?: VoterStanding;
  /** Tur-1 sayımının açıklanan oyları (tembel: yalnız gerekirse ayrıştırılır) */
  reveals?: () => RevealEntry[];
  /** Üye bu öneriye zaten itiraz etti */
  hasObjected?: boolean;
  /** Üye bu öneri için zaten azınlık raporu yazdı */
  hasReport?: boolean;
}

function standingOf(core: ForumCore, p: PhaseRow, userId: string, hints: RightsHints): VoterStanding {
  return hints.standing ?? voterStanding(core, p.id, userId);
}

/** Oy verebilir mi (kullanmış olması önemsiz: oy son taahhüde kadar değiştirilebilir). */
export function canVote(core: ForumCore, p: PhaseRow, userId: string, now: number, hints: RightsHints = {}): boolean {
  return votingOpen(p, now) && isCurrentVoter(standingOf(core, p, userId, hints));
}

/** İtiraz imzalayabilir mi: tur-1 etkin oyu "red", henüz imzalamamış, 30 günlük itiraz bütçesi dolmamış (tek kaynak: objection-budget.ts). */
export function canObject(core: ForumCore, p: PhaseRow, userId: string, now: number, hints: RightsHints = {}): boolean {
  if (!objectionOpen(p, now) || !isCurrentVoter(standingOf(core, p, userId, hints))) return false;
  if (firstRoundChoice(core, p, userId, hints.reveals?.()) !== "no") return false;
  const objected = hints.hasObjected ?? !!core.db.get("SELECT 1 FROM objections WHERE proposal_id = ? AND user_id = ?", p.id, userId);
  return !objected && !objectionBudgetOf(core.db, userId, now).exhausted;
}

/** Azınlık raporu yazabilir mi: tur-1 ETKİN oyu "red" (vekâletle dahil), tek rapor. */
export function canWriteMinorityReport(core: ForumCore, p: PhaseRow, userId: string, hints: RightsHints = {}): boolean {
  if (!minorityReportStage(p) || !isCurrentVoter(standingOf(core, p, userId, hints))) return false;
  if (firstRoundChoice(core, p, userId, hints.reveals?.()) !== "no") return false;
  const reported = hints.hasReport ?? !!core.db.get("SELECT 1 FROM minority_reports WHERE proposal_id = ? AND author_id = ?", p.id, userId);
  return !reported;
}
