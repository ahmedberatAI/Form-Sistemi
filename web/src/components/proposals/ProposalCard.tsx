// Öneri özeti kartı ve listesi: öneriler sayfası, ana sayfa, konu ve profil sayfaları için.
// Sade kart (rozet bütçesi): üst satırda #K-n ve TEK durum rozeti (+ T0 dışı katman ve 'Sizin'); tür, yazar, zaman ve mesaj
// sayısı rozet değil, noktayla ayrılmış düz metin meta satırıdır. Kategoriler en çok 2 ve '+n'.
import { useId } from "react";
import { Link } from "react-router-dom";
import { PROPOSAL_KIND_LABELS, type ProposalStatus, type ProposalSummary } from "@forum/shared";
import { useOntology } from "../../lib/categories";
import { formatPercent, proposalRef } from "../../lib/format";
import { routes } from "../../lib/routes";
import { Badge, Countdown, cx, ProgressBar, StatusBadge, TierBadge, Time } from "../../ui";
import { UserLink } from "../UserLink";
import "./proposals.css";

/** Evre geri sayımının önündeki metin ("Oylamanın bitmesine 2 sa 13 dk kaldı"). */
export const PHASE_DEADLINE_PREFIX: Partial<Record<ProposalStatus, string>> = {
  sponsoring: "Destek toplamanın bitmesine",
  deliberation: "Tartışmanın bitmesine",
  voting: "Oylamanın bitmesine",
  revote: "Yeniden oylamanın bitmesine",
  objection_window: "İtiraz süresinin bitmesine",
  reconciliation: "Uzlaşmanın bitmesine",
};

const MAX_CATS = 2;

/** Meta satırındaki noktalı ayraç (ekran okuyucuya okunmaz). */
const Dot = () => (
  <span className="pcard-dot" aria-hidden="true">
    ·
  </span>
);

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
  const noteId = useId();
  const H = `h${headingLevel}` as "h3";
  const mine = !!myId && p.authorId === myId;
  const prefix = PHASE_DEADLINE_PREFIX[p.status];
  const voting = p.status === "voting" || p.status === "revote";
  const part = voting && p.participation && p.participation.eligible > 0 ? p.participation : null;
  const cats = compact ? [] : p.categories.slice(0, MAX_CATS);
  const hiddenCats = compact ? [] : p.categories.slice(MAX_CATS);

  return (
    <article className={cx("pcard", mine && "pcard-mine")} aria-labelledby={hid} aria-describedby={part ? noteId : undefined}>
      <div className="pcard-top">
        <span className="pcard-ref">{proposalRef(p.seq)}</span>
        <StatusBadge status={p.status} />
        {p.tier && p.tier !== "T0" ? <TierBadge tier={p.tier} short /> : null}
        {mine ? (
          <Badge tone="neutral" icon="user">
            Sizin
          </Badge>
        ) : null}
      </div>

      <H className="pcard-title" id={hid}>
        <Link to={routes.proposal(p.id)}>{p.title}</Link>
      </H>

      <div className="pcard-meta pcard-meta-dots">
        <span>{PROPOSAL_KIND_LABELS[p.kind] ?? p.kind}</span>
        {!compact ? (
          <>
            <Dot />
            <span>
              <UserLink id={p.authorId} nickname={p.authorNickname} />
            </span>
          </>
        ) : null}
        <Dot />
        <span>
          <Time at={p.createdAt} />
        </span>
        <Dot />
        <span className="pcard-msgs" title="Tartışmadaki mesaj sayısı">
          {p.messageCount} mesaj
        </span>
      </div>

      {cats.length ? (
        <div className="cat-tags" aria-label="Kategoriler">
          {cats.map((c) => (
            <span className="cat-tag" key={c} title={categoryPath(c)}>
              {categoryLabel(c)}
            </span>
          ))}
          {hiddenCats.length ? (
            <span className="cat-tag cat-tag-more" title={hiddenCats.map(categoryLabel).join(", ")}>
              +{hiddenCats.length}
              <span className="sr-only"> kategori daha</span>
            </span>
          ) : null}
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
            label="Katılım (ara sonuç gizli)"
            value={part.voted}
            max={part.eligible}
            valueText={`${part.voted}/${part.eligible} (${formatPercent(part.voted / part.eligible)})`}
            tone="accent"
          />
          {/* Her kartta tekrarlanan cümle görünmez; ekran okuyucu için kartın açıklaması olarak kalır. */}
          <span id={noteId} className="sr-only">
            Ara sonuç oylama bitene kadar gizlidir.
          </span>
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
