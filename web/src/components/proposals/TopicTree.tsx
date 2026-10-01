// Konu ağacı: GET /api/topics düz listesini (parentId) iç içe, açılır/kapanır ağaca çevirir.
// Arama/kategori süzgeci verildiğinde eşleşenler ve bağlam için üst konuları gösterilir (hepsi açık).
import { useId, useMemo, useState, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { expandIri, type TopicSummary } from "@forum/shared";
import { useOntology } from "../../lib/categories";
import { normalizeSearch, topicRef } from "../../lib/format";
import { routes } from "../../lib/routes";
import { Badge, Button, cx, Icon } from "../../ui";

export interface TopicTreeProps {
  topics: TopicSummary[];
  /** Başlıkta aranacak metin */
  query?: string;
  /** Kategori IRI'si (alt kategorileri de kapsar) */
  category?: string;
  /** Arşivlenmiş konuları da göster */
  showArchived?: boolean;
}

interface Node {
  topic: TopicSummary;
  children: Node[];
}

/** Bir kategorinin kendisi + tüm alt kategorileri (genişletilmiş IRI). */
export function useCategoryDescendants(category: string | undefined): Set<string> | null {
  const { flat } = useOntology();
  return useMemo(() => {
    if (!category) return null;
    const root = expandIri(category);
    const parentOf = new Map(flat.map((c) => [expandIri(c.iri), c.parent ? expandIri(c.parent) : null]));
    const out = new Set<string>([root]);
    for (const c of flat) {
      let p: string | null = expandIri(c.iri);
      const seen = new Set<string>();
      while (p && !seen.has(p)) {
        if (p === root) {
          out.add(expandIri(c.iri));
          break;
        }
        seen.add(p);
        p = parentOf.get(p) ?? null;
      }
    }
    return out;
  }, [flat, category]);
}

export function TopicTree({ topics, query = "", category, showArchived = false }: TopicTreeProps) {
  const { categoryLabel, categoryPath } = useOntology();
  const catSet = useCategoryDescendants(category);
  const nq = normalizeSearch(query.trim());
  const filtering = !!nq || !!catSet;

  const { roots, matched, all } = useMemo(() => {
    const pool = topics.filter((t) => showArchived || t.status === "active");
    const byId = new Map(pool.map((t) => [t.id, t]));
    const isMatch = (t: TopicSummary) =>
      (!nq || normalizeSearch(`${topicRef(t.seq)} ${t.title}`).includes(nq)) && (!catSet || t.categories.some((c) => catSet.has(expandIri(c))));
    const matched = new Set<string>();
    const keep = new Set<string>();
    for (const t of pool) {
      if (!filtering || isMatch(t)) {
        matched.add(t.id);
        let cur: TopicSummary | undefined = t;
        const seen = new Set<string>();
        while (cur && !seen.has(cur.id)) {
          seen.add(cur.id);
          keep.add(cur.id);
          cur = cur.parentId ? byId.get(cur.parentId) : undefined;
        }
      }
    }
    const nodes = new Map<string, Node>();
    for (const t of pool) if (keep.has(t.id)) nodes.set(t.id, { topic: t, children: [] });
    const roots: Node[] = [];
    for (const n of nodes.values()) {
      const parent = n.topic.parentId ? nodes.get(n.topic.parentId) : undefined;
      if (parent && parent !== n) parent.children.push(n);
      else roots.push(n);
    }
    const sort = (xs: Node[]) => {
      xs.sort((a, b) => a.topic.seq - b.topic.seq);
      xs.forEach((x) => sort(x.children));
    };
    sort(roots);
    return { roots, matched, all: [...nodes.values()] };
  }, [topics, showArchived, nq, catSet, filtering]);

  const withChildren = useMemo(() => all.filter((n) => n.children.length > 0).map((n) => n.topic.id), [all]);
  // Varsayılan: kök konular açık (birinci düzey alt konular görünür).
  const [expanded, setExpanded] = useState<Set<string> | null>(null);
  const openSet = expanded ?? new Set(roots.filter((r) => r.children.length).map((r) => r.topic.id));
  const isOpen = (id: string) => filtering || openSet.has(id);
  const toggle = (id: string) => {
    const next = new Set(openSet);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setExpanded(next);
  };

  const render = (n: Node, depth: number) => (
    <TopicTreeItem
      key={n.topic.id}
      node={n}
      depth={depth}
      open={isOpen(n.topic.id)}
      onToggle={toggle}
      toggleDisabled={filtering}
      highlight={filtering && matched.has(n.topic.id)}
      categoryLabel={categoryLabel}
      categoryPath={categoryPath}
      renderChild={render}
    />
  );

  if (!roots.length) return null;
  return (
    <div className="ttree-wrap">
      {withChildren.length && !filtering ? (
        <div className="row ttree-tools">
          <Button size="sm" variant="ghost" icon="chevronDown" onClick={() => setExpanded(new Set(withChildren))}>
            Tümünü aç
          </Button>
          <Button size="sm" variant="ghost" icon="chevronRight" onClick={() => setExpanded(new Set())}>
            Tümünü kapat
          </Button>
        </div>
      ) : null}
      {filtering ? <p className="small muted">{matched.size} konu eşleşti; bağlam için üst konuları da gösteriliyor.</p> : null}
      <ul className="ttree" aria-label="Konu ağacı">
        {roots.map((r) => render(r, 0))}
      </ul>
    </div>
  );
}

interface ItemProps {
  node: Node;
  depth: number;
  open: boolean;
  onToggle: (id: string) => void;
  toggleDisabled: boolean;
  highlight: boolean;
  categoryLabel: (iri: string) => string;
  categoryPath: (iri: string) => string;
  renderChild: (n: Node, depth: number) => ReactNode;
}

function TopicTreeItem({ node, depth, open, onToggle, toggleDisabled, highlight, categoryLabel, categoryPath, renderChild }: ItemProps) {
  const t = node.topic;
  const listId = useId();
  const has = node.children.length > 0;
  return (
    <li className={cx("ttree-item", highlight && "ttree-hit", t.status === "archived" && "ttree-archived")}>
      <div className="ttree-row">
        {has ? (
          <button
            type="button"
            className="icon-btn ttree-toggle"
            aria-expanded={open}
            aria-controls={open ? listId : undefined}
            aria-label={`“${t.title}” alt konularını ${open ? "gizle" : "göster"}`}
            onClick={() => onToggle(t.id)}
            disabled={toggleDisabled}
          >
            <Icon name={open ? "chevronDown" : "chevronRight"} size={18} />
          </button>
        ) : (
          <span className="ttree-spacer" aria-hidden="true" />
        )}
        <div className="ttree-main">
          <Link to={routes.topic(t.id)} className="ttree-title">
            <span className="ttree-ref">{topicRef(t.seq)}</span> {t.title}
          </Link>
          <div className="ttree-meta">
            <Badge tone="neutral" title={`Yürürlükteki metin sürümü ${t.version}`}>
              sürüm {t.version}
            </Badge>
            {t.childCount > 0 ? <Badge tone="neutral">{t.childCount} alt konu</Badge> : null}
            <span className="small muted">
              <Icon name="topics" size={13} /> {t.messageCount} mesaj
            </span>
            {t.openProposalCount > 0 ? (
              <Badge tone="accent" icon="proposals" title="Bu konuyu hedefleyen açık öneriler (düzenleme, alt konu, silme)">
                {t.openProposalCount} açık öneri
              </Badge>
            ) : null}
            {t.status === "archived" ? <Badge tone="warning">Arşivlendi</Badge> : null}
          </div>
          {t.categories.length ? (
            <div className="cat-tags">
              {t.categories.map((c) => (
                <span className="cat-tag" key={c} title={categoryPath(c)}>
                  {categoryLabel(c)}
                </span>
              ))}
            </div>
          ) : null}
        </div>
      </div>
      {has && open ? (
        <ul id={listId} className="ttree-children" aria-label={`“${t.title}” alt konuları`}>
          {node.children.map((c) => renderChild(c, depth + 1))}
        </ul>
      ) : null}
    </li>
  );
}

export default TopicTree;
