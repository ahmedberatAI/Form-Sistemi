// Ontoloji (yönetmelik) önbelleği ve kategori ağacı yardımcıları.
// /api/ontology yanıtı uygulama boyunca bir kez yüklenir; invalidateOntology() ile tazelenir.
import { useCallback, useEffect, useMemo, useState } from "react";
import { CATEGORY_VOCAB, compactIri, DELETION_GROUND_VOCAB, expandIri, fy, OBJECTION_GROUND_VOCAB, RIGHT_VOCAB, type CategoryNode, type OntologyOverview } from "@forum/shared";
import { getOntology } from "../api/endpoints";

export interface FlatCategory {
  iri: string;
  label: string;
  parent: string | null;
  depth: number;
  /** Kökten bu düğüme etiketler: ["Çevre", "Enerji"] */
  path: string[];
  requiresExpert: boolean;
  keywords: string[];
}

let cache: OntologyOverview | null = null;
let inflight: Promise<OntologyOverview> | null = null;
const listeners = new Set<() => void>();

/** Ontolojiyi yükler (önbellekli). force → yeniden ister. */
export function loadOntology(force = false): Promise<OntologyOverview> {
  if (cache && !force) return Promise.resolve(cache);
  if (inflight && !force) return inflight;
  const p = getOntology().then(
    (o) => {
      cache = o;
      inflight = null;
      listeners.forEach((l) => l());
      return o;
    },
    (e) => {
      inflight = null;
      throw e;
    },
  );
  inflight = p;
  return p;
}

/** Yönetmelik sürümü değişince (ör. regulation yürürlüğe girdi) çağırın. */
export function invalidateOntology(): void {
  cache = null;
  void loadOntology(true).catch(() => undefined);
}

/**
 * Sunucu ağacı iç içe (children) ya da düz (parent) gönderebilir; ikisini de tek biçime çevirir:
 * kök düğümler, her düğümün children'ı dolu, etikete göre sıralı.
 */
export function normalizeCategoryTree(nodes: CategoryNode[]): CategoryNode[] {
  const all = new Map<string, CategoryNode>();
  const visit = (n: CategoryNode, parent: string | null) => {
    const key = expandIri(n.iri);
    if (!all.has(key)) all.set(key, { ...n, iri: n.iri, parent: n.parent ?? parent, children: [] });
    for (const c of n.children ?? []) visit(c, n.iri);
  };
  nodes.forEach((n) => visit(n, null));
  const roots: CategoryNode[] = [];
  for (const n of all.values()) {
    const p = n.parent ? all.get(expandIri(n.parent)) : undefined;
    if (p && p !== n) p.children.push(n);
    else roots.push(n);
  }
  const sort = (xs: CategoryNode[]) => {
    xs.sort((a, b) => a.label.localeCompare(b.label, "tr"));
    xs.forEach((x) => sort(x.children));
  };
  sort(roots);
  return roots;
}

export function flattenCategories(roots: CategoryNode[]): FlatCategory[] {
  const out: FlatCategory[] = [];
  const walk = (n: CategoryNode, depth: number, path: string[]) => {
    const p = [...path, n.label];
    out.push({ iri: n.iri, label: n.label, parent: n.parent, depth, path: p, requiresExpert: n.requiresExpert, keywords: n.keywords ?? [] });
    n.children.forEach((c) => walk(c, depth + 1, p));
  };
  roots.forEach((r) => walk(r, 0, []));
  return out;
}

const vocabCategoryLabels = new Map(CATEGORY_VOCAB.map((c) => [fy(c.local), c.label]));
const vocabRightLabels = new Map(RIGHT_VOCAB.map((r) => [fy(r.local), r.label]));
const vocabGroundLabels = new Map([...DELETION_GROUND_VOCAB, ...OBJECTION_GROUND_VOCAB].map((g) => [fy(g.local), g.label]));

/** IRI'nin son parçası ("…#Ulasim" → "Ulasim") — etiket bulunamazsa son çare */
const localName = (iri: string) => compactIri(iri).replace(/^fy:/, "").replace(/^.*[#/]/, "");

export interface OntologyHook {
  ontology: OntologyOverview | null;
  loading: boolean;
  error: unknown;
  reload: () => void;
  /** Normalleştirilmiş kategori ağacı (kökler) */
  categories: CategoryNode[];
  /** Ağacın derinlik öncelikli düz listesi */
  flat: FlatCategory[];
  categoryLabel: (iri: string) => string;
  /** Kategori kökten yol: "Çevre › Enerji" */
  categoryPath: (iri: string) => string;
  rightLabel: (iri: string) => string;
  groundLabel: (iri: string) => string;
  articleLabel: (iri: string) => string;
  contentLabel: (iri: string) => string;
}

/**
 * const { categories, flat, categoryLabel, loading } = useOntology();
 * Sunucuya ulaşılamazsa etiketler shared/vocab.ts'teki sabit sözlükten gelir.
 */
export function useOntology(): OntologyHook {
  const [ontology, setOntology] = useState<OntologyOverview | null>(cache);
  const [loading, setLoading] = useState(!cache);
  const [error, setError] = useState<unknown>(null);

  useEffect(() => {
    const l = () => setOntology(cache);
    listeners.add(l);
    if (!cache) {
      setLoading(true);
      loadOntology()
        .then((o) => {
          setOntology(o);
          setError(null);
        })
        .catch((e) => setError(e))
        .finally(() => setLoading(false));
    }
    return () => {
      listeners.delete(l);
    };
  }, []);

  const reload = useCallback(() => {
    setLoading(true);
    loadOntology(true)
      .then((o) => {
        setOntology(o);
        setError(null);
      })
      .catch((e) => setError(e))
      .finally(() => setLoading(false));
  }, []);

  return useMemo<OntologyHook>(() => {
    const categories = ontology ? normalizeCategoryTree(ontology.categories) : [];
    const flat = flattenCategories(categories);
    const byIri = new Map(flat.map((c) => [expandIri(c.iri), c]));
    const rights = new Map((ontology?.rights ?? []).map((r) => [expandIri(r.iri), r.label]));
    const grounds = new Map([...(ontology?.deletionGrounds ?? []), ...(ontology?.objectionGrounds ?? [])].map((g) => [expandIri(g.iri), g.label]));
    const articles = new Map((ontology?.articles ?? []).map((a) => [expandIri(a.iri), `${a.number} — ${a.title}`]));
    const contents = new Map((ontology?.contentLabels ?? []).map((c) => [expandIri(c.iri), c.label]));
    const look = (m: Map<string, string>, fallback: Map<string, string> | null, iri: string) => {
      const k = expandIri(iri);
      return m.get(k) ?? fallback?.get(k) ?? localName(iri);
    };
    return {
      ontology,
      loading,
      error,
      reload,
      categories,
      flat,
      categoryLabel: (iri) => byIri.get(expandIri(iri))?.label ?? vocabCategoryLabels.get(expandIri(iri)) ?? localName(iri),
      categoryPath: (iri) => byIri.get(expandIri(iri))?.path.join(" › ") ?? vocabCategoryLabels.get(expandIri(iri)) ?? localName(iri),
      rightLabel: (iri) => look(rights, vocabRightLabels, iri),
      groundLabel: (iri) => look(grounds, vocabGroundLabels, iri),
      articleLabel: (iri) => look(articles, null, iri),
      contentLabel: (iri) => look(contents, null, iri),
    };
  }, [ontology, loading, error, reload]);
}
