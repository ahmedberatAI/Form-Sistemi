// Kullanıcıya görünen Türkçe etiketler.
import type {
  AssignmentStatus,
  DecisionOutcome,
  EdgeType,
  ExpertAssessment,
  ExpertStatus,
  LedgerTxType,
  ProposalKind,
  ProposalStatus,
  Role,
  Stance,
  Tier,
  UserStatus,
  VoteChoice,
} from "./types";

export const ROLE_LABELS: Record<Role, string> = {
  member: "Üye",
  registrar: "Kayıt Memuru",
  auditor: "Denetçi",
  admin: "Yönetici",
};

export const USER_STATUS_LABELS: Record<UserStatus, string> = {
  pending: "Doğrulama bekliyor",
  verified: "Doğrulanmış",
  suspended: "Askıya alınmış",
  rejected: "Reddedildi",
  erased: "Silinmiş üye",
};

export const PROPOSAL_KIND_LABELS: Record<ProposalKind, string> = {
  topic: "Yeni Konu",
  subtopic: "Alt Konu",
  amendment: "Düzenleme Teklifi",
  deletion: "Silme (Karartma) Talebi",
  regulation: "Yönetmelik Değişikliği",
};

export const PROPOSAL_STATUS_LABELS: Record<ProposalStatus, string> = {
  draft: "Taslak",
  sponsoring: "Destekçi toplanıyor",
  inadmissible: "Yönetmeliğe aykırı",
  deliberation: "Tartışmada",
  voting: "Oylamada",
  objection_window: "İtiraz süresinde",
  reconciliation: "Uzlaşma sürecinde",
  revote: "Yeniden oylamada",
  enacted: "Kabul edildi",
  rejected: "Reddedildi",
  withdrawn: "Geri çekildi",
  expired: "Süresi doldu",
};

export const TIER_LABELS: Record<Tier, string> = {
  T0: "Olağan karar",
  T1: "Nitelikli karar",
  T2: "Yönetmelik değişikliği",
  T3: "Değiştirilemez hüküm",
  DEL: "Silme (karartma) kararı",
};

export const VOTE_LABELS: Record<VoteChoice, string> = {
  yes: "Kabul",
  no: "Red",
  abstain: "Çekimser",
};

export const OUTCOME_LABELS: Record<DecisionOutcome, string> = {
  accept: "Kabul",
  contested: "Tartışmalı (uzlaşma gerekli)",
  reject: "Red",
  needs_more_votes: "Daha fazla oy gerekli (uzatma)",
};

export const STANCE_LABELS: Record<Stance, string> = {
  pro: "Lehte",
  con: "Aleyhte",
  neutral: "Nötr",
  question: "Soru",
};

export const EXPERT_STATUS_LABELS: Record<ExpertStatus, string> = {
  applied: "Başvuru yaptı",
  active: "Listede (aktif)",
  suspended: "Askıda",
  removed: "Listeden çıkarıldı",
  rejected: "Başvuru reddedildi",
};

export const ASSESSMENT_LABELS: Record<ExpertAssessment, string> = {
  feasible: "Uygulanabilir",
  infeasible: "Uygulanamaz",
  uncertain: "Belirsiz",
};

export const ASSIGNMENT_STATUS_LABELS: Record<AssignmentStatus, string> = {
  invited: "Davet edildi",
  accepted: "Görevi kabul etti",
  recused: "Çekildi (çekinme)",
  reported: "Rapor verdi",
  overdue: "Süresi geçti",
  replaced: "Yerine başkası seçildi",
};

export const EDGE_LABELS: Record<EdgeType, string> = {
  FOLLOWS: "Takip ediyor",
  VOUCHES: "Kefil oluyor",
  DELEGATES_TO: "Vekâlet veriyor",
  RELATED_TO: "Yakınlık (aile/iş/hane)",
  REPLIED_TO: "Yanıtladı",
  ENDORSED: "Yorumunu destekledi",
  AUTHORED: "Yazdı",
  EXPERT_IN: "Uzmanlık alanı",
  AGREES: "Oylarda uzlaşıyor",
};

export const LEDGER_TX_LABELS: Record<LedgerTxType, string> = {
  MEMBER_REGISTERED: "Üye kaydı",
  MEMBER_VERIFIED: "Üye doğrulandı",
  MEMBER_ERASED: "Üye verisi imha edildi",
  PROPOSAL_CREATED: "Öneri oluşturuldu",
  PROPOSAL_VERSION: "Öneri sürümü",
  SPONSORED: "Destek imzası",
  PHASE_CHANGED: "Evre değişti",
  VOTE_COMMIT: "Oy taahhüdü",
  BALLOT_REVEAL: "Oy pusulaları açıklandı",
  TALLY: "Sayım sonucu",
  OBJECTION: "Azınlık itirazı",
  MINORITY_REPORT: "Azınlık raporu",
  MESSAGE_POSTED: "Mesaj yazıldı",
  MESSAGE_EDITED: "Mesaj düzenlendi",
  MESSAGE_HIDDEN: "Mesaj karartıldı",
  TOPIC_REVISION: "Konu sürümü",
  EXPERT_DRAW: "Bilirkişi kurası",
  EXPERT_REPORT: "Bilirkişi raporu",
  AI_ANALYSIS: "Yapay zekâ analizi",
  BYLAW_VERSION: "Yönetmelik sürümü",
  CLUSTER_SNAPSHOT: "Görüş kümesi görüntüsü",
  GRAPH_RUN: "Graf analizi",
  DELEGATION: "Vekâlet",
  EVIDENCE: "Hatalı doğrulayıcı kanıtı",
};

export function clusterLabel(clusterId: string | null | undefined): string {
  if (!clusterId) return "Kümelenmemiş";
  const n = Number(clusterId.replace(/^g/, ""));
  if (Number.isNaN(n)) return clusterId;
  return "Görüş Grubu " + String.fromCharCode(65 + (n % 26));
}

export const AI_LABEL_PREFIX = "Yapay zekâ ile üretildi";
