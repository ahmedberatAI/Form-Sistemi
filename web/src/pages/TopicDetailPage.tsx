// Konu ayrıntısı: üst konular (yol), gövde, sürüm geçmişi + fark, kaynak öneri, alt konular, açık öneriler, tartışma.
import { Link, useParams } from "react-router-dom";
import type { ProposalSummary, TopicDetail } from "@forum/shared";
import { getTopic } from "../api/endpoints";
import { useAuth } from "../auth/AuthContext";
import { Discussion } from "../components/participation/Discussion";
import { PlainText } from "../components/participation/common";
import { VersionHistory } from "../components/participation/VersionHistory";
import { useOntology } from "../lib/categories";
import { formatNumber, proposalRef, topicRef } from "../lib/format";
import { routes } from "../lib/routes";
import { useAsync } from "../lib/useAsync";
import { Badge, Card, Countdown, EmptyState, ErrorView, Icon, KindBadge, LinkButton, PageHeader, Spinner, StatusBadge, Time } from "../ui";

export default function TopicDetailPage() {
  const { id = "" } = useParams();
  const auth = useAuth();
  const { categoryLabel, categoryPath } = useOntology();
  const { data: t, error, loading, reload } = useAsync(() => getTopic(id), [id]);

  if (loading && !t) return <Spinner block label="Konu yükleniyor…" />;
  if (error && !t) return <ErrorView error={error} onRetry={reload} />;
  if (!t) return null;

  const active = t.status === "active";

  return (
    <div className="page">
      <Breadcrumb topic={t} />
      <PageHeader
        title={t.title}
        meta={
          <>
            <Badge tone="neutral">{topicRef(t.seq)}</Badge>
            <Badge tone={active ? "success" : "neutral"}>{active ? "Yürürlükte" : "Arşivlendi"}</Badge>
            <Badge tone="info">Sürüm {t.version}</Badge>
            <span>
              Son güncelleme <Time at={t.updatedAt} />
            </span>
          </>
        }
        actions={
          active ? (
            <>
              <LinkButton to={routes.newProposal({ kind: "subtopic", parentTopicId: t.id })} icon="plus" size="sm">
                Alt konu öner
              </LinkButton>
              <LinkButton to={routes.newProposal({ kind: "amendment", parentTopicId: t.id })} icon="proposals" size="sm" variant="primary">
                Düzenleme teklif et
              </LinkButton>
            </>
          ) : null
        }
      />
      {active && auth.user && !auth.can("V") ? (
        <p className="small muted">Alt konu ve düzenleme teklifleri doğrulanmış üyelerce verilebilir; teklifler destekçi toplar ve oylanır.</p>
      ) : null}

      <div className="split">
        <div className="stack">
          <Card title="Konu metni" subtitle={t.originProposalId ? undefined : "Kurucu konu"}>
            <div className="stack-sm">
              {t.categories.length ? (
                <div className="chips" aria-label="Kategoriler">
                  {t.categories.map((c) => (
                    <span key={c} className="badge badge-info" title={categoryPath(c)}>
                      {categoryLabel(c)}
                    </span>
                  ))}
                </div>
              ) : null}
              <PlainText text={t.body} />
              {t.originProposalId ? (
                <p className="small muted">
                  Bu konu bir karar ile oluşturuldu: <Link to={routes.proposal(t.originProposalId)}>kaynak öneriyi görüntüle</Link>. Metin yalnızca oylanan düzenleme
                  teklifleriyle değişir.
                </p>
              ) : null}
            </div>
          </Card>

          <Card title={`Açık öneriler (${t.openProposals.length})`} subtitle="Bu konuya bağlı, henüz sonuçlanmamış öneriler">
            {t.openProposals.length ? (
              <ul className="list">
                {t.openProposals.map((p) => (
                  <ProposalRow key={p.id} p={p} />
                ))}
              </ul>
            ) : (
              <EmptyState title="Açık öneri yok" icon="proposals">
                {active ? <p>Metinde bir değişiklik gerekiyorsa “Düzenleme teklif et”, ayrıntılandırmak için “Alt konu öner”i kullanın.</p> : null}
              </EmptyState>
            )}
          </Card>
        </div>

        <aside className="stack" aria-label="Konu bilgileri">
          <Card title={`Alt konular (${t.children.length})`}>
            {t.children.length ? (
              <ul className="list">
                {t.children.map((c) => (
                  <li key={c.id} className="list-item">
                    <Link to={routes.topic(c.id)} className="topic-child-link">
                      <span className="muted small">{topicRef(c.seq)}</span> {c.title}
                    </Link>
                    <div className="small muted">
                      {formatNumber(c.childCount)} alt konu · {formatNumber(c.messageCount)} mesaj · {formatNumber(c.openProposalCount)} açık öneri
                      {c.status === "archived" ? " · arşiv" : ""}
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="small muted">Henüz alt konu yok.</p>
            )}
          </Card>

          <Card title="Sürüm geçmişi" subtitle="İki sürüm seçip farkı görün; eski sürümler silinmez.">
            <VersionHistory
              label="Konu"
              current={t.version}
              versions={t.revisions.map((r) => ({
                version: r.version,
                title: r.title,
                body: r.body,
                createdAt: r.createdAt,
                contentHash: r.contentHash,
                note: r.viaProposalId ? (
                  <>
                    <Link to={routes.proposal(r.viaProposalId)}>{r.version === 1 ? "Kuruluş kararı" : "Düzenleme kararı"}</Link> ile
                  </>
                ) : r.version === 1 ? (
                  "İlk sürüm"
                ) : null,
              }))}
            />
          </Card>
        </aside>
      </div>

      <Discussion threadType="topic" threadId={t.id} closedReason={active ? null : "Bu konu arşivlendi; yeni mesaj yazılamaz."} />
    </div>
  );
}

function Breadcrumb({ topic }: { topic: TopicDetail }) {
  return (
    <nav aria-label="Konu yolu" className="breadcrumb small">
      <ol>
        <li>
          <Link to={routes.topics()}>Konular</Link>
        </li>
        {topic.ancestors.map((a) => (
          <li key={a.id}>
            <Icon name="chevronRight" size={12} />
            <Link to={routes.topic(a.id)}>{a.title}</Link>
          </li>
        ))}
        <li aria-current="page">
          <Icon name="chevronRight" size={12} />
          <span>{topic.title}</span>
        </li>
      </ol>
    </nav>
  );
}

function ProposalRow({ p }: { p: ProposalSummary }) {
  return (
    <li className="list-item">
      <Link to={routes.proposal(p.id)} className="list-item-link proposal-row">
        <span className="row">
          <span className="muted small">{proposalRef(p.seq)}</span>
          <KindBadge kind={p.kind} />
          <StatusBadge status={p.status} />
        </span>
        <span className="proposal-row-title">{p.title}</span>
        <span className="small muted row">
          <span>@{p.authorNickname}</span>
          {p.status === "sponsoring" ? <span>{`destek ${p.sponsorCount}/${p.sponsorsRequired}`}</span> : null}
          {p.participation ? <span>{`katılım ${p.participation.voted}/${p.participation.eligible}`}</span> : null}
          {p.phaseEndsAt ? <Countdown to={p.phaseEndsAt} plain /> : null}
        </span>
      </Link>
    </li>
  );
}
