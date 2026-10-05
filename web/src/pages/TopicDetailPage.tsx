// Konu ayrıntısı: üst konular (yol), gövde, açık öneriler, tartışma, alt konular, sürüm geçmişi + fark, kaynak öneri.
// Faz 3 sırası (telefonda DOM sırası = okuma sırası): metin (kırpılmış) → Açık öneriler (satırlar; boşsa tek satır) → Tartışma →
// Alt konular → 'Sürüm geçmişi (n)' (katlanabilir, kapalı). Masaüstünde yan sütun korunur: ana sütunda metin, açık öneriler ve
// tartışma; yan sütunda alt konular ve sürüm geçmişi. Tartışma hiçbir zaman açılır içine alınmaz (?mesaj= ve sayfa içi arama çalışır).
// Derin bağlantı: ?bolum=konu-metni|acik-oneriler|tartisma|alt-konular|surumler (kartı açar, kaydırır, odağı taşır).
import { useCallback, useEffect, useState } from "react";
import { Link, useParams, useSearchParams } from "react-router-dom";
import type { MessageView, ProposalSummary, TopicDetail } from "@forum/shared";
import { getTopic } from "../api/endpoints";
import { useAuth } from "../auth/AuthContext";
import { Discussion } from "../components/participation/Discussion";
import { VersionHistory } from "../components/participation/VersionHistory";
import { ProposalRowList } from "../components/proposals/ProposalCard";
import { openProposalKinds, revisionsSummary, sectionWaitsForThread, THREAD_WAIT_MS, TOPIC_ANCHORS, topicSectionHref } from "../components/proposals/topicsLogic";
import "../components/proposals/topics.css";
import { useOntology } from "../lib/categories";
import { formatNumber, topicRef } from "../lib/format";
import { routes } from "../lib/routes";
import { parseSectionParam, SECTION_PARAM, useSectionParam } from "../lib/sectionParam";
import { useAsync } from "../lib/useAsync";
import { Badge, Card, ClampText, Icon, LinkButton, PageErrorView, PageHeader, Spinner, Time } from "../ui";

export default function TopicDetailPage() {
  const { id = "" } = useParams();
  const { data: t, error, loading, reload } = useAsync(() => getTopic(id), [id]);

  if (loading && !t) return <Spinner block label="Konu yükleniyor…" />;
  if (error && !t) return <PageErrorView error={error} onRetry={reload} subject="Konu" />;
  if (!t) return null;
  return <TopicDetailView key={t.id} t={t} />;
}

/** Yüklenmiş konunun sayfası (veri çekmez; birim testlerde doğrudan çizilir). */
export function TopicDetailView({ t }: { t: TopicDetail }) {
  const auth = useAuth();
  const { categoryLabel, categoryPath } = useOntology();
  const active = t.status === "active";

  // ?bolum=<çapa>: ilgili kartı açar, kaydırır, odağı taşır (parametreyi siler). Tartışmanın altındaki çapalar (Alt konular,
  // Sürüm geçmişi) tartışma yüklenince çalışır; yoksa tartışma gelince yükseklik değişir ve hedef görünür alanın dışında kalır.
  const [params] = useSearchParams();
  const waits = sectionWaitsForThread(parseSectionParam(params.get(SECTION_PARAM)));
  const [threadSettled, setThreadSettled] = useState(false);
  useEffect(() => {
    if (!waits || threadSettled) return;
    const timer = window.setTimeout(() => setThreadSettled(true), THREAD_WAIT_MS);
    return () => window.clearTimeout(timer);
  }, [waits, threadSettled]);
  useSectionParam(!waits || threadSettled);
  const onThread = useCallback((_messages: MessageView[]) => setThreadSettled(true), []);

  return (
    <div className="page">
      <Breadcrumb topic={t} />
      <PageHeader
        title={t.title}
        meta={
          <>
            {/* Rozet bütçesi: tek renkli durum rozeti (Yürürlükte); numara ve sürüm gri. */}
            <Badge tone="neutral">{topicRef(t.seq)}</Badge>
            <Badge tone={active ? "success" : "neutral"}>{active ? "Yürürlükte" : "Arşivlendi"}</Badge>
            <Badge tone="neutral">Sürüm {t.version}</Badge>
            <span>
              Son güncelleme <Time at={t.updatedAt} />
            </span>
            {/* Telefonda Alt konular tartışmanın altındadır: tek dokunuşla oraya götürür (masaüstünde yan sütundadır, gizlenir). */}
            {t.children.length ? (
              <Link className="topic-jump" to={topicSectionHref(t.id, TOPIC_ANCHORS.children)} replace>
                {t.children.length} alt konu
                <span className="sr-only"> bölümüne git</span>
                <Icon name="chevronDown" size={14} />
              </Link>
            ) : null}
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

      <div className="split topic-split">
        <div className="stack topic-main">
          <Card title="Konu metni" subtitle={t.originProposalId ? undefined : "Kurucu konu"} anchor={TOPIC_ANCHORS.text}>
            <div className="stack-sm">
              {t.categories.length ? (
                <div className="cat-tags" aria-label="Kategoriler">
                  {t.categories.map((c) => (
                    <span key={c} className="cat-tag" title={categoryPath(c)}>
                      {categoryLabel(c)}
                    </span>
                  ))}
                </div>
              ) : null}
              <ClampText text={t.body} />
              {t.originProposalId ? (
                <p className="small muted">
                  Bu konu bir karar ile oluşturuldu: <Link to={routes.proposal(t.originProposalId)}>kaynak öneriyi görüntüle</Link>. Metin yalnızca oylanan düzenleme
                  teklifleriyle değişir.
                </p>
              ) : null}
            </div>
          </Card>

          <OpenProposalsCard proposals={t.openProposals} myId={auth.user?.id ?? null} active={active} />

          <Discussion threadType="topic" threadId={t.id} onMessagesChange={onThread} closedReason={active ? null : "Bu konu arşivlendi; yeni mesaj yazılamaz."} />
        </div>

        <aside className="stack topic-aside" aria-label="Konu bilgileri">
          <Card title={`Alt konular (${t.children.length})`} anchor={TOPIC_ANCHORS.children}>
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

          <Card
            title={`Sürüm geçmişi (${t.revisions.length})`}
            subtitle="İki sürüm seçip farkı görün; eski sürümler silinmez."
            collapsible
            summary={revisionsSummary(t.revisions, auth.now())}
            anchor={TOPIC_ANCHORS.versions}
          >
            <VersionHistory
              label="Konu"
              current={t.version}
              diffDefaultOpen={false}
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
    </div>
  );
}

/** Açık öneri yokken yürürlükteki konuda yönlendirme (düğmeler sayfa başlığındadır; adları aynen geçer). */
export const OPEN_PROPOSALS_EMPTY_HINT = "Metinde bir değişiklik gerekiyorsa “Düzenleme teklif et”, ayrıntılandırmak için “Alt konu öner”i kullanın.";

/**
 * Konuya bağlı sonuçlanmamış öneriler: satırların tamamı bağlantıdır (Ana sayfanın ProposalRow'u: işaret + #K-n + başlık + durum ·
 * katılım · tür · @yazar · kalan süre). Başlıktaki sayıyı alt satır türlerine ayırır ("2 düzenleme teklifi · 1 alt konu önerisi").
 * Açık öneri yoksa kart tek satırlık başlığa iner; yürürlükteki konuda alt başlık yeni öneri düğmelerine yönlendirir.
 */
export function OpenProposalsCard({ proposals, myId, active = true }: { proposals: ProposalSummary[]; myId: string | null; active?: boolean }) {
  const n = proposals.length;
  const empty = active ? `Bu konuya bağlı sonuçlanmamış öneri yok. ${OPEN_PROPOSALS_EMPTY_HINT}` : "Bu konuya bağlı sonuçlanmamış öneri yok.";
  return (
    <Card
      title={`Açık öneriler (${n})`}
      subtitle={n ? openProposalKinds(proposals) : empty}
      anchor={TOPIC_ANCHORS.open}
      className={n ? "topic-open" : "topic-open topic-open-empty"}
    >
      {n ? <ProposalRowList proposals={proposals} myId={myId} label="Konunun açık önerileri" showKind showAuthor /> : null}
    </Card>
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
