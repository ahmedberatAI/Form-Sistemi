// İki metin sürümü arasındaki farkı gösterir (satır + satır içi kelime vurgusu).
// Renk dışında da ayırt edilebilir: satır başında "+" / "−" işareti ve <ins>/<del> öğeleri.
import { useMemo, type ReactNode } from "react";
import { diffStats, diffText, diffWords } from "../lib/diff";
import { cx } from "./basic";

export interface DiffViewProps {
  before: string;
  after: string;
  /** lines: satır satır (varsayılan) · inline: tek akışta kelime farkı */
  mode?: "lines" | "inline";
  /** Değişmeyen satırları daralt (bağlam satırı sayısı); undefined → hepsini göster */
  context?: number;
  className?: string;
  /** Erişilebilir ad (ör. "Sürüm 2 → 3 farkı") */
  label?: string;
}

export function DiffView({ before, after, mode = "lines", context, className, label = "Metin farkı" }: DiffViewProps) {
  const lines = useMemo(() => (mode === "lines" ? diffText(before, after) : []), [before, after, mode]);
  const words = useMemo(() => (mode === "inline" ? diffWords(before, after) : []), [before, after, mode]);

  if (mode === "inline") {
    return (
      <div className={cx("diff diff-inline", className)} role="region" aria-label={label}>
        {words.map((p, i) =>
          p.type === "add" ? (
            <ins key={i} className="diff-add-word">
              {p.text}
            </ins>
          ) : p.type === "del" ? (
            <del key={i} className="diff-del-word">
              {p.text}
            </del>
          ) : (
            <span key={i}>{p.text}</span>
          ),
        )}
      </div>
    );
  }

  const stats = diffStats(lines);
  const visible = lines.map((l, i) => {
    if (context === undefined || l.type !== "same") return true;
    for (let k = Math.max(0, i - context); k <= Math.min(lines.length - 1, i + context); k++) if (lines[k].type !== "same") return true;
    return false;
  });

  const rows: ReactNode[] = [];
  let skipped = 0;
  lines.forEach((l, i) => {
    if (!visible[i]) {
      skipped++;
      return;
    }
    if (skipped) {
      rows.push(
        <div key={`s${i}`} className="diff-skip">
          … {skipped} değişmeyen satır …
        </div>,
      );
      skipped = 0;
    }
    const sign = l.type === "add" ? "+" : l.type === "del" ? "−" : " ";
    rows.push(
      <div key={i} className={cx("diff-line", `diff-${l.type}`)}>
        <span className="diff-sign" aria-hidden="true">
          {sign}
        </span>
        <span className="sr-only">{l.type === "add" ? "Eklendi: " : l.type === "del" ? "Silindi: " : ""}</span>
        <span className="diff-text">
          {l.words
            ? l.words.map((w, j) =>
                w.type === "same" ? (
                  <span key={j}>{w.text}</span>
                ) : l.type === "add" ? (
                  <ins key={j} className="diff-add-word">
                    {w.text}
                  </ins>
                ) : (
                  <del key={j} className="diff-del-word">
                    {w.text}
                  </del>
                ),
              )
            : l.text || " "}
        </span>
      </div>,
    );
  });
  if (skipped)
    rows.push(
      <div key="s-end" className="diff-skip">
        … {skipped} değişmeyen satır …
      </div>,
    );

  return (
    <div className={cx("diff", className)} role="region" aria-label={label}>
      <div className="diff-stats">
        <span className="diff-stat-add">+{stats.added} satır eklendi</span>
        <span className="diff-stat-del">−{stats.removed} satır silindi</span>
      </div>
      <div className="diff-body">{rows.length ? rows : <div className="diff-skip">Fark yok.</div>}</div>
    </div>
  );
}
