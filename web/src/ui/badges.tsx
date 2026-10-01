// Alan rozetleri: öneri durumu, katman, tür, oy, görüş, sonuç, rol. Renk + metin (+ simge) birlikte.
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
import { Badge, type Tone } from "./basic";
import type { IconName } from "./Icon";

const STATUS_TONE: Record<ProposalStatus, { tone: Tone; icon?: IconName }> = {
  draft: { tone: "neutral" },
  sponsoring: { tone: "info", icon: "users" },
  inadmissible: { tone: "danger", icon: "error" },
  deliberation: { tone: "info", icon: "topics" },
  voting: { tone: "accent", icon: "vote" },
  objection_window: { tone: "warning", icon: "clock" },
  reconciliation: { tone: "warning", icon: "users" },
  revote: { tone: "accent", icon: "vote" },
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

const TIER_TONE: Record<Tier, Tone> = { T0: "neutral", T1: "info", T2: "accent", T3: "danger", DEL: "warning" };

/** "T1 · Nitelikli karar" (short → yalnızca "T1", açıklama title'da) */
export function TierBadge({ tier, short }: { tier: Tier | null | undefined; short?: boolean }) {
  if (!tier) return <Badge tone="neutral">Katman belirlenmedi</Badge>;
  return (
    <Badge tone={TIER_TONE[tier]} title={TIER_LABELS[tier]}>
      {short ? tier : `${tier} · ${TIER_LABELS[tier]}`}
    </Badge>
  );
}

export function KindBadge({ kind }: { kind: ProposalKind }) {
  return <Badge tone={kind === "deletion" ? "warning" : kind === "regulation" ? "accent" : "neutral"}>{PROPOSAL_KIND_LABELS[kind] ?? kind}</Badge>;
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

export function StanceBadge({ stance }: { stance: Stance }) {
  const tone: Tone = stance === "pro" ? "success" : stance === "con" ? "danger" : stance === "question" ? "info" : "neutral";
  return <Badge tone={tone}>{STANCE_LABELS[stance] ?? stance}</Badge>;
}

export function OutcomeBadge({ outcome }: { outcome: DecisionOutcome }) {
  const tone: Tone = outcome === "accept" ? "success" : outcome === "reject" ? "danger" : "warning";
  return <Badge tone={tone}>{OUTCOME_LABELS[outcome] ?? outcome}</Badge>;
}

export function RoleBadge({ role }: { role: Role }) {
  if (role === "member") return null;
  return <Badge tone={role === "admin" ? "danger" : role === "auditor" ? "accent" : "info"}>{ROLE_LABELS[role]}</Badge>;
}

export function UserStatusBadge({ status }: { status: UserStatus }) {
  const tone: Tone = status === "verified" ? "success" : status === "pending" ? "warning" : status === "erased" ? "neutral" : "danger";
  return <Badge tone={tone}>{USER_STATUS_LABELS[status] ?? status}</Badge>;
}

export function ExpertStatusBadge({ status }: { status: ExpertStatus }) {
  const tone: Tone = status === "active" ? "success" : status === "applied" ? "info" : status === "suspended" ? "warning" : "danger";
  return <Badge tone={tone}>{EXPERT_STATUS_LABELS[status] ?? status}</Badge>;
}
