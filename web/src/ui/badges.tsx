// Alan rozetleri: öneri durumu, katman, tür, oy, görüş, sonuç, rol. Renk + metin (+ simge) birlikte.
// Görsel dil (src/README.md): mavi (info) eylem ve 'şu an' · yeşil/kırmızı sonuç · turuncu dikkat ve süre · mor (accent) YALNIZ
// yapay zekâ; bu dosyadaki hiçbir rozet mor değildir. Rozet bütçesi: nesne başına en çok 1 renkli DURUM rozeti; tür, katman
// (T3 dışında), rol ve görüş sorusu gridir (neutral).
import {
  EXPERT_STATUS_LABELS,
  OUTCOME_LABELS,
  PROPOSAL_KIND_LABELS,
  PROPOSAL_STATUS_LABELS,
  ROLE_LABELS,
  STANCE_LABELS,
  TIER_LABELS,
  USER_STATUS_LABELS,
  VOTE_LABELS,
  type DecisionOutcome,
  type ExpertStatus,
  type ProposalKind,
  type ProposalStatus,
  type Role,
  type Stance,
  type Tier,
  type UserStatus,
  type VoteChoice,
} from "@forum/shared";
import { termForTier } from "../lib/glossary";
import { Badge, type Tone } from "./basic";
import type { IconName } from "./Icon";
import { Term } from "./Term";

// Süren evre (destek, tartışma, oylama, yeniden oylama) mavi · itiraz ve uzlaşma turuncu · kabul yeşil · red ve aykırı kırmızı ·
// taslak, geri çekilen ve süresi dolan gri.
const STATUS_TONE: Record<ProposalStatus, { tone: Tone; icon?: IconName }> = {
  draft: { tone: "neutral" },
  sponsoring: { tone: "info", icon: "users" },
  inadmissible: { tone: "danger", icon: "error" },
  deliberation: { tone: "info", icon: "topics" },
  voting: { tone: "info", icon: "vote" },
  objection_window: { tone: "warning", icon: "clock" },
  reconciliation: { tone: "warning", icon: "users" },
  revote: { tone: "info", icon: "vote" },
  enacted: { tone: "success", icon: "check" },
  rejected: { tone: "danger", icon: "close" },
  withdrawn: { tone: "neutral", icon: "close" },
  expired: { tone: "neutral", icon: "clock" },
};

/** Açık (henüz sonuçlanmamış) durumlar */
export const OPEN_STATUSES: ProposalStatus[] = ["draft", "sponsoring", "deliberation", "voting", "objection_window", "reconciliation", "revote"];
export const CLOSED_STATUSES: ProposalStatus[] = ["enacted", "rejected", "withdrawn", "expired", "inadmissible"];

export function statusTone(status: ProposalStatus): Tone {
  return STATUS_TONE[status]?.tone ?? "neutral";
}

export function StatusBadge({ status }: { status: ProposalStatus }) {
  const m = STATUS_TONE[status] ?? { tone: "neutral" as Tone };
  return (
    <Badge tone={m.tone} icon={m.icon}>
      {PROPOSAL_STATUS_LABELS[status] ?? status}
    </Badge>
  );
}

/** Katman rozetinin tonu: yalnız T3 (değiştirilemez maddeye dokunur, oylanamaz) kırmızıdır; T0, T1, T2 ve DEL gridir. */
export function tierTone(tier: Tier | null | undefined): Tone {
  return tier === "T3" ? "danger" : "neutral";
}

/**
 * "T1 · Nitelikli karar" (short → yalnızca "T1", açıklama title'da).
 * neutral → T3'te de gri: aynı nesnede renkli bir durum rozeti zaten varken (ör. 'Yönetmeliğe aykırı') rozet bütçesi aşılmaz.
 * explain → rozet, katmanın açıklamasını (sözlük penceresi) açan bir düğme olur; title yalnız masaüstünde görünür, dokunmatikte bu
 *   pencere okunur. YALNIZ düz metin akışında kullanın: bağlantı, düğme, Card başlığı ya da <summary> içindeki rozet explain almaz.
 */
export function TierBadge({ tier, short, neutral, explain }: { tier: Tier | null | undefined; short?: boolean; neutral?: boolean; explain?: boolean }) {
  if (!tier) return <Badge tone="neutral">Katman belirlenmedi</Badge>;
  const badge = (
    // explain + tam etiket: fare ipucu düğmenin kendi açıklamasıdır (Term title); kısa etiketin ipucu katmanın adıdır.
    <Badge tone={neutral ? "neutral" : tierTone(tier)} title={explain && !short ? undefined : TIER_LABELS[tier]} icon={explain ? "info" : undefined}>
      {short ? tier : `${tier} · ${TIER_LABELS[tier]}`}
    </Badge>
  );
  return explain ? (
    <Term id={termForTier(tier)} className="term-badge">
      {badge}
    </Term>
  ) : (
    badge
  );
}

/** Tür bir durum değildir: her zaman gri (silme ve yönetmelik değişikliği dahil; ağırlığı katman ve durum söyler). */
export function KindBadge({ kind }: { kind: ProposalKind }) {
  return <Badge tone="neutral">{PROPOSAL_KIND_LABELS[kind] ?? kind}</Badge>;
}

export function VoteBadge({ choice }: { choice: VoteChoice }) {
  const tone: Tone = choice === "yes" ? "success" : choice === "no" ? "danger" : "neutral";
  const icon: IconName = choice === "yes" ? "check" : choice === "no" ? "close" : "more";
  return (
    <Badge tone={tone} icon={icon}>
      {VOTE_LABELS[choice]}
    </Badge>
  );
}

/** Lehte yeşil, karşı kırmızı (oy seçimiyle aynı dil); soru ve diğerleri gri (mavi eylem içindir). */
export function StanceBadge({ stance }: { stance: Stance }) {
  const tone: Tone = stance === "pro" ? "success" : stance === "con" ? "danger" : "neutral";
  return <Badge tone={tone}>{STANCE_LABELS[stance] ?? stance}</Badge>;
}

export function OutcomeBadge({ outcome }: { outcome: DecisionOutcome }) {
  const tone: Tone = outcome === "accept" ? "success" : outcome === "reject" ? "danger" : "warning";
  return <Badge tone={tone}>{OUTCOME_LABELS[outcome] ?? outcome}</Badge>;
}

/** Rol bir durum değildir: gri. Kullanıcının tek renkli rozeti hesap durumudur (UserStatusBadge). */
export function RoleBadge({ role }: { role: Role }) {
  if (role === "member") return null;
  return <Badge tone="neutral">{ROLE_LABELS[role]}</Badge>;
}

export function UserStatusBadge({ status }: { status: UserStatus }) {
  const tone: Tone = status === "verified" ? "success" : status === "pending" ? "warning" : status === "erased" ? "neutral" : "danger";
  return <Badge tone={tone}>{USER_STATUS_LABELS[status] ?? status}</Badge>;
}

export function ExpertStatusBadge({ status }: { status: ExpertStatus }) {
  const tone: Tone = status === "active" ? "success" : status === "applied" ? "info" : status === "suspended" ? "warning" : "danger";
  return <Badge tone={tone}>{EXPERT_STATUS_LABELS[status] ?? status}</Badge>;
}
