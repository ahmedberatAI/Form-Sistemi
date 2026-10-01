// Öneri türüne özgü içerik: düzenleme teklifinin konu farkı, silme talebinin hedef mesajları, yönetmelik yamasının işlemleri
// ve yürürlük etkisi (oluşan konu / gizlenen mesajlar / yeni yönetmelik sürümü).
import { Link } from "react-router-dom";
import type { DeletionPayload, MessageView, ProposalDetail, RegulationPatch, RegulationPatchOp } from "@forum/shared";
import { getMessage, getTopic } from "../../api/endpoints";
import { useOntology } from "../../lib/categories";
import { routes } from "../../lib/routes";
import { useAsync } from "../../lib/useAsync";
import { Alert, Badge, Card, Details, DiffView, ErrorView, LinkButton, Spinner, StanceBadge, Time } from "../../ui";
import { UserLink } from "../UserLink";
import { PlainText, SubHeading } from "./common";

const PROTECTION_LABELS: Record<string, string> = { Degistirilemez: "Değiştirilemez", Nitelikli: "Nitelikli", Olagan: "Olağan" };

export function messageLink(m: Pick<MessageView, "id" | "threadType" | "threadId">): string {
  const base = m.threadType === "topic" ? routes.topic(m.threadId) : routes.proposal(m.threadId);
  return `${base}?mesaj=${encodeURIComponent(m.id)}`;
}

type Loaded = { id: string; m: MessageView | null; error: unknown };

export function DeletionTargets({ deletion, enacted }: { deletion: DeletionPayload; enacted?: boolean }) {
  const { groundLabel } = useOntology();
  const ids = deletion.messageIds;
  const { data, error, loading, reload } = useAsync<Loaded[]>(
    () => Promise.all(ids.map((id) => getMessage(id).then((m) => ({ id, m, error: null }), (e: unknown) => ({ id, m: null, error: e })))),
    [ids.join(",")],
  );
  return (
    <div className="stack-sm">
      <p>
        <strong>Gerekçe:</strong> <Badge tone="warning">{groundLabel(deletion.ground)}</Badge>
      </p>
      {deletion.statement ? <PlainText text={deletion.statement} /> : null}
      <p className="small muted">
        Görüş ayrılığı silme gerekçesi olamaz (değiştirilemez madde). Kabul edilirse mesajlar silinmez, karartılır: mezar taşı kalır, asıl metin denetçiye açıktır ve
        yazar karartılamayan bir cevap ekleyebilir.
      </p>
      <SubHeading level={4}>
        {enacted ? "Gizlenen mesajlar" : "Hedef mesajlar"} ({ids.length})
      </SubHeading>
      {loading && !data ? <Spinner label="Hedef mesajlar yükleniyor…" /> : null}
      {error ? <ErrorView error={error} onRetry={reload} compact /> : null}
      <ul className="list">
        {(data ?? []).map(({ id, m, error: e }) =>
          m ? (
            <li key={id} className="list-item stack-sm">
              <div className="row small">
                <UserLink id={m.authorId} nickname={m.authorNickname} />
                <StanceBadge stance={m.stance} />
                <Time at={m.createdAt} className="muted" />
                <Badge tone={m.visibility === "visible" ? "neutral" : m.visibility === "collapsed" ? "warning" : "danger"}>
                  {m.visibility === "visible" ? "Görünür" : m.visibility === "collapsed" ? "Daraltıldı (inceleniyor)" : m.visibility === "sealed" ? "Mühürlendi" : "Gizlendi"}
                </Badge>
                <Link to={messageLink(m)}>Tartışmada göster</Link>
              </div>
              {m.body === null ? (
                <p className="small msg-tombstone-text">{m.tombstone}</p>
              ) : (
                <Details summary={m.visibility === "collapsed" ? "Daraltılmış mesajı göster" : "Mesaj metnini göster"}>
                  <PlainText text={m.body} />
                </Details>
              )}
            </li>
          ) : (
            <li key={id} className="list-item small muted">
              Mesaj yüklenemedi ({e instanceof Error ? e.message : "bilinmeyen hata"}).
            </li>
          ),
        )}
      </ul>
    </div>
  );
}

function PatchOp({ op }: { op: RegulationPatchOp }) {
  const { ontology, articleLabel, categoryLabel } = useOntology();
  switch (op.op) {
    case "setParam": {
      const cur = ontology?.params.find((x) => x.rule === op.rule && x.param === op.param);
      return (
        <li>
          <strong>Parametre:</strong> {cur?.label ?? `${op.rule} · ${op.param}`} — şu an <code className="mono">{cur ? String(cur.value) : "?"}</code> → önerilen{" "}
          <code className="mono">{String(op.value)}</code>
          {cur?.immutable ? <Badge tone="danger">değiştirilemez</Badge> : null}
        </li>
      );
    }
    case "addCategory":
      return (
        <li>
          <strong>Yeni kategori:</strong> {op.label} (üst: {categoryLabel(op.parent)}){op.requiresExpert ? " · bilirkişi gerekli" : ""}
          {op.keywords.length ? <span className="small muted"> · anahtar kelimeler: {op.keywords.join(", ")}</span> : null}
        </li>
      );
    case "amendArticleText": {
      const cur = ontology?.articles.find((a) => a.iri === op.article);
      return (
        <li className="stack-sm">
          <span>
            <strong>Madde metni değişikliği:</strong> {articleLabel(op.article)}
          </span>
          {cur ? <DiffView before={cur.text} after={op.text} mode="inline" label="Madde metni farkı" /> : <PlainText text={op.text} />}
        </li>
      );
    }
    case "addArticle":
      return (
        <li className="stack-sm">
          <span>
            <strong>Yeni madde:</strong> {op.number} — {op.title} (koruma: {PROTECTION_LABELS[op.protection] ?? op.protection})
          </span>
          <PlainText text={op.text} />
        </li>
      );
    case "setProtection":
      return (
        <li>
          <strong>Koruma düzeyi:</strong> {articleLabel(op.article)} → {PROTECTION_LABELS[op.protection] ?? op.protection}
        </li>
      );
  }
}

export function RegulationPatchView({ patch }: { patch: RegulationPatch }) {
  return (
    <div className="stack-sm">
      <SubHeading level={4}>Yönetmelik yaması ({patch.ops.length} işlem)</SubHeading>
      <ol className="patch-ops stack-sm">
        {patch.ops.map((op, i) => (
          <PatchOp key={i} op={op} />
        ))}
      </ol>
      {patch.rationale ? (
        <p className="small">
          <strong>Gerekçe:</strong> {patch.rationale}
        </p>
      ) : null}
      <p className="small muted">Değiştirilemez maddelere dokunan yamalar oylanamaz (T3). Kabul edilirse yeni yönetmelik sürümü oluşur ve deftere yazılır.</p>
    </div>
  );
}

export function AmendmentDiff({ proposal: p }: { proposal: ProposalDetail }) {
  const a = p.amendment;
  const topicId = p.parentTopicId;
  const { data: topic, error, loading } = useAsync(() => getTopic(topicId!), [topicId], { enabled: !!topicId && !!a });
  if (!a || !topicId) return null;
  const base = topic?.revisions.find((r) => r.version === a.baseVersion);
  const closed = ["enacted", "rejected", "withdrawn", "expired", "inadmissible"].includes(p.status);
  return (
    <div className="stack-sm">
      <SubHeading level={4}>Konu metnine önerilen değişiklik (sürüm {a.baseVersion} temel alınarak)</SubHeading>
      {loading && !topic ? <Spinner label="Konu sürümü yükleniyor…" /> : null}
      {error ? <ErrorView error={error} compact /> : null}
      {topic && !closed && topic.version !== a.baseVersion ? (
        <Alert tone="warning">
          Konu bu arada güncellendi (güncel sürüm {topic.version}). Kabul anında sürüm çakışması nedeniyle düzenleme uygulanamaz ve öneri reddedilir.
        </Alert>
      ) : null}
      {base ? (
        <>
          {base.title !== a.newTitle ? (
            <div className="small">
              <strong>Başlık:</strong> <DiffView before={base.title} after={a.newTitle} mode="inline" label="Başlık farkı" />
            </div>
          ) : null}
          <DiffView before={base.body} after={a.newBody} context={2} label="Konu metni farkı" />
        </>
      ) : topic ? (
        <PlainText text={a.newBody} />
      ) : null}
    </div>
  );
}

export function EnactedEffect({ proposal: p }: { proposal: ProposalDetail }) {
  const last = p.events[p.events.length - 1];
  return (
    <Card title="Karar yürürlükte" tone="success" subtitle={last ? <Time at={last.at} mode="both" /> : undefined}>
      <div className="stack-sm">
        {last?.reason ? <p>{last.reason}</p> : null}
        {(p.kind === "topic" || p.kind === "subtopic") && p.enactedEntityId ? (
          <div className="row">
            <span>{p.kind === "topic" ? "Yeni konu oluşturuldu." : "Alt konu oluşturuldu."}</span>
            <LinkButton size="sm" variant="primary" to={routes.topic(p.enactedEntityId)} icon="topics">
              Oluşan konuya git
            </LinkButton>
          </div>
        ) : null}
        {p.kind === "amendment" && p.enactedEntityId ? (
          <div className="row">
            <span>Konu metni yeni sürümle güncellendi.</span>
            <LinkButton size="sm" variant="primary" to={routes.topic(p.enactedEntityId)} icon="topics">
              Konuya git
            </LinkButton>
          </div>
        ) : null}
        {p.kind === "deletion" && p.deletion ? <p>{p.deletion.messageIds.length} mesaj karartıldı (silinmedi); yerlerinde mezar taşı görünür.</p> : null}
        {p.kind === "regulation" ? (
          <div className="row">
            <span>{p.enactedEntityId ? `Yönetmeliğin ${p.enactedEntityId}. sürümü yürürlüğe girdi.` : "Yeni yönetmelik sürümü yürürlüğe girdi."}</span>
            <LinkButton size="sm" to={routes.ontology()} icon="book">
              Yönetmeliği görüntüle
            </LinkButton>
          </div>
        ) : null}
      </div>
    </Card>
  );
}
