// Konular: GET /api/topics düz listesinden konu ağacı; başlık araması ve kategori süzgeci.
// Konular yalnızca oylamayla açılır ve değişir (yeni konu / alt konu / düzenleme teklifi).
// Faz 3: dört büyük sayaç kutusu tek satır sayaca indi; telefonda Kategori ve Arşiv süzgeçleri 'Süz' açılırında (arama görünür).
import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { expandIri, type TopicSummary } from "@forum/shared";
import { listTopics } from "../api/endpoints";
import { useAuth } from "../auth/AuthContext";
import { TopicTree, useCategoryDescendants } from "../components/proposals/TopicTree";
import { TOPICS_NARROW_QUERY, topicCounters, topicFilterCount, topicFilterSummary } from "../components/proposals/topicsLogic";
import "../components/proposals/topics.css";
import { useOntology } from "../lib/categories";
import { formatNumber, normalizeSearch, topicRef } from "../lib/format";
import { useDebounced, useQueryState } from "../lib/hooks";
import { routes } from "../lib/routes";
import { useAsync } from "../lib/useAsync";
import { Button, Checkbox, cx, Details, EmptyState, ErrorView, Input, LinkButton, PageHeader, Select, Spinner } from "../ui";

/** Telefon genişliği mi? (Süz açılırı yalnız burada kullanılır; masaüstünde süzgeçler hep görünür.) */
function useNarrowScreen(): boolean {
  const [narrow, setNarrow] = useState(() => typeof window !== "undefined" && !!window.matchMedia?.(TOPICS_NARROW_QUERY).matches);
  useEffect(() => {
    const mq = window.matchMedia?.(TOPICS_NARROW_QUERY);
    if (!mq) return;
    const update = () => setNarrow(mq.matches);
    update();
    mq.addEventListener?.("change", update);
    return () => mq.removeEventListener?.("change", update);
  }, []);
  return narrow;
}

/**
 * Tek satır sayaçlar (eski dört kutunun yerine): Ana konu · Alt konu · Mesaj · Konulara açık öneri. Gidecek yeri olan tek sayaç
 * 'Konulara açık öneri'dir (Öneriler sayfası); ötekiler düz sayıdır. Sıfır soluk ama görünür kalır.
 */
export function TopicCounters({ topics }: { topics: readonly TopicSummary[] }) {
  return (
    <ul className="topic-counts" aria-label="Konu sayıları">
      {topicCounters(topics).map((c) => {
        const inner = (
          <>
            <span>{c.label}</span> <span className="topic-count-n">{formatNumber(c.count)}</span>
          </>
        );
        return (
          <li key={c.key}>
            {c.to ? (
              <Link className={cx("topic-count", "topic-count-link", c.count === 0 && "is-zero")} to={c.to}>
                {inner}
              </Link>
            ) : (
              <span className={cx("topic-count", c.count === 0 && "is-zero")}>{inner}</span>
            )}
          </li>
        );
      })}
    </ul>
  );
}

export interface TopicFiltersProps {
  /** Telefon genişliği: Kategori ve Arşiv 'Süz' açılırına girer (arama kutusu her zaman görünür). */
  narrow: boolean;
  q: string;
  onQ: (value: string) => void;
  category: string;
  onCategory: (value: string) => void;
  /** Ontolojinin düz kategori listesi (girintili etiketle gösterilir) */
  categories: readonly { iri: string; label: string; depth: number }[];
  showArchived: boolean;
  onShowArchived: (value: boolean) => void;
  archivedCount: number;
  /** Açılır ilk çizimde açık mı? (adresten gelen kategori süzgeci gizli kalıp listeyi sessizce daraltmasın) */
  openAtStart?: boolean;
}

/**
 * Arama + Kategori + Arşiv. Masaüstünde üçü de hep görünür; telefonda yalnız arama görünür, Kategori ve Arşiv 'Süz' (etkin sayılı)
 * açılırındadır. Alanlar ve etiketler iki düzende de aynıdır.
 */
export function TopicFilters({ narrow, q, onQ, category, onCategory, categories, showArchived, onShowArchived, archivedCount, openAtStart }: TopicFiltersProps) {
  const categorySelect = (wide: boolean) => (
    <Select
      label="Kategori"
      value={category}
      onChange={(e) => onCategory(e.target.value)}
      options={[{ value: "", label: "Tüm kategoriler" }, ...categories.map((c) => ({ value: c.iri, label: `${"— ".repeat(c.depth)}${c.label}` }))]}
      hint="Alt kategoriler de dahil edilir."
      fieldClassName={wide ? "list-filter-wide" : undefined}
    />
  );
  const archivedCheckbox = (wide: boolean) =>
    archivedCount ? (
      <Checkbox
        label={`Arşivlenenleri göster (${archivedCount})`}
        checked={showArchived}
        onChange={(e) => onShowArchived(e.target.checked)}
        fieldClassName={wide ? "list-filter-wide" : undefined}
      />
    ) : null;
  return (
    <div className="list-filters" role="search">
      <Input label="Konu ara" type="search" placeholder="Başlık ya da #T-numara…" value={q} onChange={(e) => onQ(e.target.value)} fieldClassName="list-filter-q" />
      {narrow ? (
        <div className="list-filter-wide">
          <Details summary={topicFilterSummary(topicFilterCount({ category, showArchived }))} open={openAtStart}>
            <div className="topics-filter-fields">
              {categorySelect(false)}
              {archivedCheckbox(false)}
            </div>
          </Details>
        </div>
      ) : (
        <>
          {categorySelect(true)}
          {archivedCheckbox(true)}
        </>
      )}
    </div>
  );
}

export default function TopicsPage() {
  const auth = useAuth();
  const { flat } = useOntology();
  const { data, error, loading, reload } = useAsync(() => listTopics(), [], { pollMs: 120_000 });
  const [q, setQ] = useState("");
  const dq = useDebounced(q, 200);
  const [cat, setCat] = useQueryState("kategori", "");
  const [showArchived, setShowArchived] = useState(false);
  const catSet = useCategoryDescendants(cat || undefined);
  const narrow = useNarrowScreen();

  const topics = data ?? [];
  const archivedCount = topics.filter((t) => t.status === "archived").length;

  const pool = topics.filter((t) => showArchived || t.status === "active");
  const nq = normalizeSearch(dq.trim());
  const matchCount = pool.filter(
    (t) => (!nq || normalizeSearch(`${topicRef(t.seq)} ${t.title}`).includes(nq)) && (!catSet || t.categories.some((c) => catSet.has(expandIri(c)))),
  ).length;
  const filtering = !!nq || !!catSet;

  // Adresten gelen kategori süzgeci varsa 'Süz' açılırı ilk çizimde açık gelir; etkin süzgeç sayısı kapalı özetinde de yazar.
  const [openFiltersAtStart] = useState<boolean | undefined>(() => (cat ? true : undefined));

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
          <TopicCounters topics={topics} />

          <TopicFilters
            narrow={narrow}
            q={q}
            onQ={setQ}
            category={cat}
            onCategory={setCat}
            categories={flat}
            showArchived={showArchived}
            onShowArchived={setShowArchived}
            archivedCount={archivedCount}
            openAtStart={openFiltersAtStart}
          />

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
