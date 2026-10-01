// Öneri özeti kartı ve listesi: öneriler sayfası, ana sayfa, konu ve profil sayfaları için.
import { useId } from "react";
import { Link } from "react-router-dom";
import type { ProposalStatus, ProposalSummary } from "@forum/shared";
import { useOntology } from "../../lib/categories";
import { formatPercent, proposalRef } from "../../lib/format";
import { routes } from "../../lib/routes";
import { Badge, Countdown, cx, Icon, KindBadge, ProgressBar, StatusBadge, TierBadge, Time } from "../../ui";
import { UserLink } from "../UserLink";

/** Evre geri sayımının önündeki metin ("Oylamanın bitmesine 2 sa 13 dk kaldı"). */
export const PHASE_DEADLINE_PREFIX: Partial<Record<ProposalStatus, string>> = {
  sponsoring: "Destek toplamanın bitmesine",
  deliberation: "Tartışmanın bitmesine",
  voting: "Oylamanın bitmesine",
  revote: "Yeniden oylamanın bitmesine",
  objection_window: "İtiraz süresinin bitmesine",
  reconciliation: "Uzlaşmanın bitmesine",
};

const MAX_CATS = 4;

export interface ProposalCardProps {
  proposal: ProposalSummary;
  /** Kategori etiketlerini ve yazar satırını gizle (ana sayfa listeleri) */
  compact?: boolean;
  /** Oturumdaki kullanıcının kimliği: kendi önerisi "Sizin" rozetiyle işaretlenir */
  myId?: string | null;
  headingLevel?: 2 | 3 | 4;
}

export function ProposalCard({ proposal: p, compact, myId, headingLevel = 3 }: ProposalCardProps) {
  const { categoryLabel, categoryPath } = useOntology();
  const hid = useId();
  const H = `h${headingLevel}` as "h3";
  const mine = !!myId && p.authorId === myId;
  const prefix = PHASE_DEADLINE_PREFIX[p.status];
  const voting = p.status === "voting" || p.status === "revote";
  const part = voting && p.participation && p.participation.eligible > 0 ? p.participation : null;
  const cats = compact ? [] : p.categories.slice(0, MAX_CATS);
  const more = compact ? 0 : Math.max(0, p.categories.length - MAX_CATS);

  return (
    <article className={cx("pcard", mine && "pcard-mine")} aria-labelledby={hid}>
      <div className="pcard-top">
        <span className="pcard-ref">{proposalRef(p.seq)}</span>
        <KindBadge kind={p.kind} />
        <StatusBadge status={p.status} />
        {p.tier ? <TierBadge tier={p.tier} short /> : null}
        {mine ? (
          <Badge tone="info" icon="user">
            Sizin
          </Badge>
        ) : null}
      </div>

      <H className="pcard-title" id={hid}>
        <Link to={routes.proposal(p.id)}>{p.title}</Link>
      </H>

      <div className="pcard-meta">
        {!compact ? (
          <span>
            <UserLink id={p.authorId} nickname={p.authorNickname} />
          </span>
        ) : null}
        <span>
          <Time at={p.createdAt} />
        </span>
        <span className="pcard-msgs" title="Tartışmadaki mesaj sayısı">
          <Icon name="topics" size={14} /> {p.messageCount} mesaj
        </span>
      </div>

      {cats.length ? (
        <div className="cat-tags" aria-label="Kategoriler">
          {cats.map((c) => (
            <span className="cat-tag" key={c} title={categoryPath(c)}>
              {categoryLabel(c)}
            </span>
          ))}
          {more ? <span className="cat-tag cat-tag-more">+{more}</span> : null}
        </div>
      ) : null}

      {p.status === "sponsoring" ? (
        <ProgressBar
          label="Destekçi (eş imzacı)"
          value={Math.min(p.sponsorCount, Math.max(1, p.sponsorsRequired))}
          max={Math.max(1, p.sponsorsRequired)}
          valueText={`${p.sponsorCount}/${p.sponsorsRequired}`}
          tone={p.sponsorCount >= p.sponsorsRequired ? "success" : "primary"}
        />
      ) : null}

      {part ? (
        <div className="pcard-part">
          <ProgressBar
            label="Katılım"
            value={part.voted}
            max={part.eligible}
            valueText={`${part.voted}/${part.eligible} (${formatPercent(part.voted / part.eligible)})`}
            tone="accent"
          />
          <span className="small muted">Ara sonuç oylama bitene kadar gizlidir.</span>
        </div>
      ) : null}

      {prefix && p.phaseEndsAt ? (
        <div className="pcard-deadline">
          <Countdown to={p.phaseEndsAt} prefix={prefix} doneText="süre doldu — evre geçişi bekleniyor" />
        </div>
      ) : null}
    </article>
  );
}

export interface ProposalListProps {
  proposals: ProposalSummary[];
  compact?: boolean;
  myId?: string | null;
  headingLevel?: 2 | 3 | 4;
  /** Liste için erişilebilir ad */
  label?: string;
}

/** Öneri kartlarının duyarlı ızgarası (mobilde tek sütun). */
export function ProposalList({ proposals, compact, myId, headingLevel, label }: ProposalListProps) {
  return (
    <ul className={cx("pcard-list", compact && "pcard-list-compact")} aria-label={label}>
      {proposals.map((p) => (
        <li key={p.id}>
          <ProposalCard proposal={p} compact={compact} myId={myId} headingLevel={headingLevel} />
        </li>
      ))}
    </ul>
  );
}

export default ProposalCard;
