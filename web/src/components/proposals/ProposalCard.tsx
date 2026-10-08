// Öneri özeti kartı ve listesi: öneriler sayfası, konu ve profil sayfaları için.
// Sade kart (rozet bütçesi): üst satırda #K-n ve TEK durum rozeti (+ T0 dışı katman ve 'Sizin'); tür, yazar, zaman ve mesaj
// sayısı rozet değil, noktayla ayrılmış düz metin meta satırıdır. Kategoriler en çok 2 ve '+n'.
// Satır görünümü (ProposalRow, ana sayfa): satırın tamamı bağlantıdır; işaret + #K-n + başlık + durum · ilerleme · kalan süre.
// Oturumdaki üyenin bu öneride bekleyen işi varsa (lib/taskStore, sunucunun görev listesi) kartta 'Sizden bekleniyor: Oy'
// satırı çıkar; rozet değil düz metindir (rozet bütçesi), renk yalnız simgededir. Katman rozeti, renkli bir durum rozeti
// yanında griye döner (nesne başına tek renkli durum rozeti).
import { Fragment, useId } from "react";
import { Link } from "react-router-dom";
import { PROPOSAL_KIND_LABELS, PROPOSAL_STATUS_LABELS, type ProposalStatus, type ProposalSummary, type RankReason } from "@forum/shared";
import { useOntology } from "../../lib/categories";
import { formatPercent, proposalRef } from "../../lib/format";
import { routes } from "../../lib/routes";
import { expectationText, useProposalExpectations, type ExpectationKind } from "../../lib/taskStore";
import { Badge, Countdown, cx, Icon, ProgressBar, StatusBadge, statusTone, TierBadge, Time, type IconName } from "../../ui";
import { UserLink } from "../UserLink";
import { ReasonChip, showsReason } from "../discovery/ReasonChip";
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

/** 'Sizden bekleniyor' satırının simgesi (Ana sayfa görev satırlarıyla aynı simgeler). */
const EXPECT_ICON: Record<ExpectationKind, IconName> = {
  vote: "vote",
  sponsor: "users",
  object: "warning",
  reconciliation: "users",
  expert: "experts",
  author: "proposals",
};
/** Turuncu (dikkat ve süre) simgeli işler; diğerleri mavi (eylem). Ana sayfadaki görev tonlarıyla aynı. */
const ATTENTION_KINDS: readonly ExpectationKind[] = ["object", "reconciliation"];

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
  /** Kişisel sırada ('Size göre') kısa gerekçe: başlığın altında gri çip ('Genel sıralama' gösterilmez) */
  reason?: RankReason | null;
}

export function ProposalCard({ proposal: p, compact, myId, headingLevel = 3, reason }: ProposalCardProps) {
  const { categoryLabel, categoryPath } = useOntology();
  const hid = useId();
  const noteId = useId();
  const expectId = useId();
  const H = `h${headingLevel}` as "h3";
  const mine = !!myId && p.authorId === myId;
  const prefix = PHASE_DEADLINE_PREFIX[p.status];
  const voting = p.status === "voting" || p.status === "revote";
  const part = voting && p.participation && p.participation.eligible > 0 ? p.participation : null;
  const cats = compact ? [] : p.categories.slice(0, MAX_CATS);
  const hiddenCats = compact ? [] : p.categories.slice(MAX_CATS);
  const expectations = useProposalExpectations(p.id);
  const describedBy = [part ? noteId : null, expectations.length ? expectId : null].filter(Boolean).join(" ") || undefined;

  return (
    <article className={cx("pcard", mine && "pcard-mine")} aria-labelledby={hid} aria-describedby={describedBy}>
      <div className="pcard-top">
        <span className="pcard-ref">{proposalRef(p.seq)}</span>
        <StatusBadge status={p.status} />
        {p.tier && p.tier !== "T0" ? <TierBadge tier={p.tier} short neutral={statusTone(p.status) !== "neutral"} /> : null}
        {mine ? (
          <Badge tone="neutral" icon="user">
            Sizin
          </Badge>
        ) : null}
      </div>

      <H className="pcard-title" id={hid}>
        <Link to={routes.proposal(p.id)}>{p.title}</Link>
      </H>

      {showsReason(reason) ? (
        <div className="pcard-reason">
          <ReasonChip reason={reason} />
        </div>
      ) : null}

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
            tone="primary"
          />
          {/* Her kartta tekrarlanan cümle görünmez; ekran okuyucu için kartın açıklaması olarak kalır. */}
          <span id={noteId} className="sr-only">
            Ara sonuç oylama bitene kadar gizlidir.
          </span>
        </div>
      ) : null}

      {expectations.length ? (
        <p className={cx("pcard-expect", ATTENTION_KINDS.includes(expectations[0].kind) && "pcard-expect-attention")} id={expectId}>
          <Icon name={EXPECT_ICON[expectations[0].kind]} size={14} className="pcard-expect-icon" />
          <span>
            <strong>Sizden bekleniyor:</strong> {expectationText(expectations)}
          </span>
        </p>
      ) : null}

      {prefix && p.phaseEndsAt ? (
        <div className="pcard-deadline">
          <Countdown to={p.phaseEndsAt} prefix={prefix} doneText="süre doldu — evre geçişi bekleniyor" />
        </div>
      ) : null}
    </article>
  );
}

/** Liste öğesi: kişisel sıradaki öneriler gerekçe taşır (RankedProposalSummary / DashboardOpenProposal). */
export type ProposalWithReason = ProposalSummary & { reason?: RankReason | null };

export interface ProposalListProps {
  proposals: readonly ProposalWithReason[];
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
          <ProposalCard proposal={p} compact={compact} myId={myId} headingLevel={headingLevel} reason={p.reason} />
        </li>
      ))}
    </ul>
  );
}

// ───────────── Satır görünümü (ProposalRow) ─────────────

/** Renk rolü (plan): mavi şu an süren evre, turuncu dikkat (itiraz/uzlaşma), yeşil ve kırmızı sonuç, gri nötr kapanış. */
export type ProposalRowTone = "now" | "attention" | "success" | "danger" | "neutral";

export interface ProposalRowSpec {
  tone: ProposalRowTone;
  /** Görsel işaret (ekran okuyucuya okunmaz; anlamı durum metni verir): ● süren evre, ✔ kabul, ✘ ret/aykırı, – kapanış */
  mark: string;
  /** Durum metni: "Oylamada", "Destek 2/4", "Kabul edildi" … */
  status: string;
  /** İkincil bilgi: oylamada katılım, sonuçlanmışta öneri türü; yoksa null */
  extra: string | null;
}

const ROW_TONE: Record<ProposalStatus, ProposalRowTone> = {
  draft: "neutral",
  sponsoring: "now",
  deliberation: "now",
  voting: "now",
  revote: "now",
  objection_window: "attention",
  reconciliation: "attention",
  enacted: "success",
  rejected: "danger",
  inadmissible: "danger",
  withdrawn: "neutral",
  expired: "neutral",
};

/** Satırın durum özeti (saf): ProposalRow ve testler kullanır. Yeni rozet yok; renk her zaman işaret ve metinle birliktedir. */
export function proposalRowSpec(p: Pick<ProposalSummary, "status" | "kind" | "sponsorCount" | "sponsorsRequired" | "participation">): ProposalRowSpec {
  const tone = ROW_TONE[p.status] ?? "neutral";
  const mark = tone === "success" ? "✔" : tone === "danger" ? "✘" : p.status === "withdrawn" || p.status === "expired" ? "–" : "●";
  const label = PROPOSAL_STATUS_LABELS[p.status] ?? p.status;
  if (p.status === "sponsoring") return { tone, mark, status: `Destek ${p.sponsorCount}/${p.sponsorsRequired}`, extra: null };
  if (p.status === "voting" || p.status === "revote") {
    const part = p.participation && p.participation.eligible > 0 ? p.participation : null;
    return { tone, mark, status: label, extra: part ? `katılım ${part.voted}/${part.eligible}` : null };
  }
  // Sonuçlanmış satırda "ne karara bağlandı" sorusunun cevabı türdür (yeni konu, düzenleme, silme talebi …).
  const closed = tone === "success" || tone === "danger" || mark === "–";
  return { tone, mark, status: label, extra: closed ? (PROPOSAL_KIND_LABELS[p.kind] ?? null) : null };
}

/**
 * Satırın ek meta parçaları (saf): `kind` → öneri türü (sonuçlanmış satırda tür zaten `extra`'dadır, tekrar yazılmaz), `author` →
 * '@takma ad' (kendi önerinde 'sizin' yazıldığı için yazılmaz). Rozet değil, düz metindir (rozet bütçesi bozulmaz).
 */
export function proposalRowDetails(
  p: Pick<ProposalSummary, "kind" | "authorNickname">,
  spec: Pick<ProposalRowSpec, "extra">,
  opts: { kind?: boolean; author?: boolean; mine?: boolean },
): string[] {
  const kind = PROPOSAL_KIND_LABELS[p.kind] ?? p.kind;
  return [opts.kind && spec.extra !== kind ? kind : null, opts.author && !opts.mine && p.authorNickname ? `@${p.authorNickname}` : null].filter(
    (x): x is string => !!x,
  );
}

export interface ProposalRowProps {
  proposal: ProposalSummary;
  /** Oturumdaki kullanıcının kimliği: kendi önerisi meta satırında "sizin" diye işaretlenir (rozet değil) */
  myId?: string | null;
  /** Meta satırına öneri türünü yaz (konu sayfası: aynı konuya bağlı düzenleme, alt konu ve silme satırları ayırt edilsin) */
  showKind?: boolean;
  /** Meta satırına yazarı ('@takma ad') yaz */
  showAuthor?: boolean;
  /** Kişisel sırada kısa gerekçe (gri çip, meta satırının sonunda; 'Genel sıralama' gösterilmez) */
  reason?: RankReason | null;
}

/**
 * Tek satırlık öneri: satırın tamamı öneri sayfasına giden bağlantıdır. Bağlantının adı işaret dışındaki her şeydir
 * ("#K-31 Kütüphane … Oylamada katılım 23/57 2 sa 13 dk kaldı"). Başlık tek satırdır (…); telefonda meta alt satırda,
 * ≥ 600 px'de meta sağda.
 */
export function ProposalRow({ proposal: p, myId, showKind, showAuthor, reason }: ProposalRowProps) {
  const spec = proposalRowSpec(p);
  const mine = !!myId && p.authorId === myId;
  const details = proposalRowDetails(p, spec, { kind: showKind, author: showAuthor, mine });
  const deadline = PHASE_DEADLINE_PREFIX[p.status] && p.phaseEndsAt ? p.phaseEndsAt : null;
  // Parçalar arasındaki {" "} boşlukları flex/grid düzeninde görünmez; bağlantının erişilebilir adında sözcükleri ayırır.
  return (
    <Link className={cx("prow", `prow-${spec.tone}`, details.length > 0 && "prow-detailed")} to={routes.proposal(p.id)}>
      <span className="prow-mark" aria-hidden="true">
        {spec.mark}
      </span>{" "}
      <span className="prow-head">
        <span className="prow-ref">{proposalRef(p.seq)}</span> <span className="prow-title">{p.title}</span>
      </span>{" "}
      <span className="prow-meta">
        <span className="prow-status">{spec.status}</span>
        {spec.extra ? (
          <>
            {" "}
            <Dot /> <span>{spec.extra}</span>
          </>
        ) : null}
        {details.map((d) => (
          <Fragment key={d}>
            {" "}
            <Dot /> <span>{d}</span>
          </Fragment>
        ))}
        {mine ? (
          <>
            {" "}
            <Dot /> <span>sizin</span>
          </>
        ) : null}
        {deadline ? (
          <>
            {" "}
            <Dot /> <Countdown to={deadline} plain className="prow-due" doneText="süre doldu" />
          </>
        ) : null}
      </span>
      {showsReason(reason) ? (
        <>
          {" "}
          <span className="prow-why">
            <ReasonChip reason={reason} />
          </span>
        </>
      ) : null}
    </Link>
  );
}

export interface ProposalRowListProps extends Pick<ProposalRowProps, "showKind" | "showAuthor"> {
  proposals: readonly ProposalWithReason[];
  myId?: string | null;
  /** Liste için erişilebilir ad */
  label: string;
}

/** Kenarlıklı satır listesi (ana sayfa: 'Şu an açık', 'Son kararlar'; konu sayfası: 'Açık öneriler', tür ve yazarla). */
export function ProposalRowList({ proposals, myId, label, showKind, showAuthor }: ProposalRowListProps) {
  return (
    <ul className="prow-list" aria-label={label}>
      {proposals.map((p) => (
        <li key={p.id}>
          <ProposalRow proposal={p} myId={myId} showKind={showKind} showAuthor={showAuthor} reason={p.reason} />
        </li>
      ))}
    </ul>
  );
}

export default ProposalCard;
