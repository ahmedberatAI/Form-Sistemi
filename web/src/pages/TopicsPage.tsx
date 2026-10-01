// Konular: GET /api/topics düz listesinden konu ağacı; başlık araması ve kategori süzgeci.
// Konular yalnızca oylamayla açılır ve değişir (yeni konu / alt konu / düzenleme teklifi).
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { expandIri } from "@forum/shared";
import { listTopics } from "../api/endpoints";
import { useAuth } from "../auth/AuthContext";
import { TopicTree, useCategoryDescendants } from "../components/proposals/TopicTree";
import { useOntology } from "../lib/categories";
import { normalizeSearch, topicRef } from "../lib/format";
import { useDebounced, useQueryState } from "../lib/hooks";
import { routes } from "../lib/routes";
import { useAsync } from "../lib/useAsync";
import { Button, Checkbox, EmptyState, ErrorView, Input, LinkButton, PageHeader, Select, Spinner, Stat, StatGrid } from "../ui";

export default function TopicsPage() {
  const auth = useAuth();
  const { flat } = useOntology();
  const { data, error, loading, reload } = useAsync(() => listTopics(), [], { pollMs: 120_000 });
  const [q, setQ] = useState("");
  const dq = useDebounced(q, 200);
  const [cat, setCat] = useQueryState("kategori", "");
  const [showArchived, setShowArchived] = useState(false);
  const catSet = useCategoryDescendants(cat || undefined);

  const topics = data ?? [];
  const archivedCount = topics.filter((t) => t.status === "archived").length;
  const active = topics.filter((t) => t.status === "active");
  const stats = useMemo(
    () => ({
      roots: active.filter((t) => !t.parentId).length,
      subs: active.filter((t) => !!t.parentId).length,
      open: active.reduce((s, t) => s + t.openProposalCount, 0),
      messages: active.reduce((s, t) => s + t.messageCount, 0),
    }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [data],
  );

  const pool = topics.filter((t) => showArchived || t.status === "active");
  const nq = normalizeSearch(dq.trim());
  const matchCount = pool.filter(
    (t) => (!nq || normalizeSearch(`${topicRef(t.seq)} ${t.title}`).includes(nq)) && (!catSet || t.categories.some((c) => catSet.has(expandIri(c)))),
  ).length;
  const filtering = !!nq || !!catSet;

  const newTopic = auth.can("V") ? (
    <LinkButton to={routes.newProposal({ kind: "topic" })} variant="primary" icon="plus">
      Yeni konu öner
    </LinkButton>
  ) : !auth.user ? (
    <LinkButton to={routes.login()} icon="login" state={{ from: routes.newProposal({ kind: "topic" }) }}>
      Konu önermek için giriş yapın
    </LinkButton>
  ) : null;

  return (
    <div className="page">
      <PageHeader
        title="Konular"
        subtitle="Yürürlükteki konu ağacı. Konular yalnızca oylamayla açılır ve değişir; her değişiklik yeni bir sürüm olarak saklanır."
        actions={newTopic}
      />

      {loading && !data ? <Spinner block label="Konular yükleniyor…" /> : null}
      {error ? <ErrorView error={error} onRetry={reload} /> : null}

      {data && !topics.length ? (
        <EmptyState title="Henüz yürürlükte bir konu yok" icon="topics" action={newTopic}>
          <p>
            Konular yalnızca oylamayla açılır: bir üye “Yeni konu” önerir, öneri destekçi toplar, ontoloji denetiminden geçer, tartışılır ve köprülü
            çoğunlukla kabul edilirse konu ağacına eklenir. Açık önerileri <Link to={routes.proposals()}>Öneriler</Link> sayfasında görebilirsiniz.
          </p>
        </EmptyState>
      ) : null}

      {topics.length ? (
        <>
          <StatGrid>
            <Stat label="Ana konu" value={stats.roots} />
            <Stat label="Alt konu" value={stats.subs} />
            <Stat label="Mesaj" value={stats.messages} />
            <Stat label="Konulara açık öneri" value={stats.open} tone={stats.open ? "accent" : "neutral"} to={routes.proposals()} />
          </StatGrid>

          <div className="list-filters" role="search">
            <Input label="Konu ara" type="search" placeholder="Başlık ya da #T-numara…" value={q} onChange={(e) => setQ(e.target.value)} fieldClassName="list-filter-q" />
            <Select
              label="Kategori"
              value={cat}
              onChange={(e) => setCat(e.target.value)}
              options={[{ value: "", label: "Tüm kategoriler" }, ...flat.map((c) => ({ value: c.iri, label: `${"— ".repeat(c.depth)}${c.label}` }))]}
              hint="Alt kategoriler de dahil edilir."
            />
            {archivedCount ? (
              <Checkbox label={`Arşivlenenleri göster (${archivedCount})`} checked={showArchived} onChange={(e) => setShowArchived(e.target.checked)} />
            ) : null}
          </div>

          {filtering && !matchCount ? (
            <EmptyState
              title="Süzgece uyan konu yok"
              icon="search"
              action={
                <Button
                  size="sm"
                  icon="close"
                  onClick={() => {
                    setQ("");
                    setCat("");
                  }}
                >
                  Süzgeci temizle
                </Button>
              }
            />
          ) : (
            <TopicTree topics={topics} query={dq} category={cat || undefined} showArchived={showArchived} />
          )}
        </>
      ) : null}
    </div>
  );
}
