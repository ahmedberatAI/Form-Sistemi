// Ontoloji kategori ağacından çoklu seçim (arama + ağaç + seçili çipler).
// Üst kategoriler ontoloji tarafından zaten çıkarıldığı için en özel kategoriyi seçmek yeterlidir.
import { useId, useMemo, useState } from "react";
import { expandIri } from "@forum/shared";
import { useOntology } from "../lib/categories";
import { normalizeSearch } from "../lib/format";
import { Badge, Button, cx, ErrorView, Icon, Spinner } from "../ui";

export interface CategoryPickerProps {
  value: string[];
  onChange: (iris: string[]) => void;
  label?: string;
  hint?: string;
  error?: string;
  /** En fazla seçim */
  max?: number;
  disabled?: boolean;
  /** YZ/sezgisel öneriler: tek tıkla eklenebilir (danışma) */
  suggestions?: { iri: string; label?: string; confidence?: number }[];
  required?: boolean;
}

export function CategoryPicker({ value, onChange, label = "Kategoriler", hint, error, max, disabled, suggestions, required }: CategoryPickerProps) {
  const { flat, categoryLabel, categoryPath, loading, error: loadError, reload } = useOntology();
  const [q, setQ] = useState("");
  const id = useId();
  const selected = useMemo(() => new Set(value.map(expandIri)), [value]);
  const isSel = (iri: string) => selected.has(expandIri(iri));
  const full = max !== undefined && value.length >= max;

  const toggle = (iri: string) => {
    if (disabled) return;
    if (isSel(iri)) onChange(value.filter((v) => expandIri(v) !== expandIri(iri)));
    else if (!full) onChange([...value, iri]);
  };

  const nq = normalizeSearch(q.trim());
  const visible = useMemo(() => {
    if (!nq) return flat;
    const match = new Set<string>();
    for (const c of flat) {
      const hay = normalizeSearch([c.label, ...c.keywords].join(" "));
      if (hay.includes(nq)) match.add(c.iri);
    }
    // Eşleşenlerin üst düğümlerini de bağlam için göster
    const keep = new Set(match);
    for (const c of flat) if (match.has(c.iri)) {
      let p = c.parent;
      while (p) {
        keep.add(p);
        p = flat.find((x) => expandIri(x.iri) === expandIri(p!))?.parent ?? null;
      }
    }
    return flat.filter((c) => keep.has(c.iri));
  }, [flat, nq]);

  const pendingSuggestions = (suggestions ?? []).filter((s) => !isSel(s.iri));

  return (
    <fieldset className={cx("cat-picker", error && "field-invalid")} disabled={disabled} aria-describedby={hint ? id + "-hint" : undefined}>
      <legend className="field-label">
        {label}
        {required ? <span className="sr-only"> (zorunlu)</span> : null}
      </legend>
      {hint ? (
        <div className="field-hint" id={id + "-hint"}>
          {hint}
        </div>
      ) : null}

      <div className="chips" aria-live="polite">
        {value.length === 0 ? <span className="muted">Henüz kategori seçilmedi.</span> : null}
        {value.map((iri) => (
          <span className="chip" key={iri}>
            <span title={categoryPath(iri)}>{categoryLabel(iri)}</span>
            <button type="button" className="chip-remove" onClick={() => toggle(iri)} aria-label={`${categoryLabel(iri)} kategorisini kaldır`}>
              <Icon name="close" size={12} />
            </button>
          </span>
        ))}
      </div>

      {pendingSuggestions.length ? (
        <div className="cat-suggestions">
          <span className="muted small">Önerilen (YZ, danışma):</span>
          {pendingSuggestions.map((s) => (
            <Button key={s.iri} size="sm" variant="ghost" icon="plus" onClick={() => toggle(s.iri)} disabled={full}>
              {s.label ?? categoryLabel(s.iri)}
              {s.confidence !== undefined ? <span className="muted"> (%{Math.round(s.confidence * 100)})</span> : null}
            </Button>
          ))}
        </div>
      ) : null}

      <div className="cat-search">
        <label className="sr-only" htmlFor={id + "-q"}>
          Kategori ara
        </label>
        <Icon name="search" size={16} />
        <input id={id + "-q"} className="input" type="search" placeholder="Kategori ya da anahtar kelime ara…" value={q} onChange={(e) => setQ(e.target.value)} />
      </div>

      {loading ? <Spinner label="Kategoriler yükleniyor…" block /> : null}
      {loadError && !flat.length ? <ErrorView error={loadError} onRetry={reload} compact /> : null}

      {flat.length ? (
        <ul className="cat-tree" aria-label="Kategori ağacı">
          {visible.map((c, i) => {
            const sel = isSel(c.iri);
            const cid = `${id}-c${i}`;
            return (
              <li key={c.iri} className={cx("cat-item", sel && "cat-selected")} style={{ paddingInlineStart: `${c.depth * 1.1 + 0.25}rem` }}>
                <input type="checkbox" id={cid} checked={sel} onChange={() => toggle(c.iri)} disabled={!sel && full} />
                <label htmlFor={cid}>
                  {c.label}
                  {c.requiresExpert ? (
                    <Badge tone="info" className="cat-expert" title="Bu alandaki öneriler için bilirkişi görüşü gerekir">
                      bilirkişi
                    </Badge>
                  ) : null}
                </label>
              </li>
            );
          })}
          {!visible.length ? <li className="muted cat-item">“{q}” ile eşleşen kategori yok.</li> : null}
        </ul>
      ) : null}

      {full ? <div className="field-hint">En fazla {max} kategori seçebilirsiniz.</div> : null}
      {error ? (
        <div className="field-error" role="alert">
          {error}
        </div>
      ) : null}
    </fieldset>
  );
}

export default CategoryPicker;
