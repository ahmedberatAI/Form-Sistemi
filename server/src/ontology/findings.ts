// Bulgu (Finding) üretim yardımcıları: her bulgu bir maddeye atıf yapar ("Madde 9 (2): …").
import { FY_NS, compactIri, type Finding, type Severity } from "@forum/shared";
import type { BylawModel } from "./model";

/** Değiştirilemez korumaya dokunan bulgu kodları: biri bile varsa katman T3 olur. */
export const T3_CODES = new Set([
  "core_right_restricted",
  "immutable_target",
  "new_immutable",
  "immutable_bypass",
  "protection_floor",
  "entrenchment_cap",
  "equal_vote_limit",
]);

export function art(local: string): string {
  return FY_NS + local;
}

export function makeFinding(model: BylawModel, severity: Severity, code: string, article: string | null, text: string, focus?: string | null): Finding {
  const label = model.articleLabel(article);
  const f: Finding = { severity, code, message: label ? `${label}: ${text}` : text };
  if (article) f.article = article;
  if (label) f.articleLabel = label;
  if (focus) f.focus = compactIri(focus);
  return f;
}

/** Sayıyı Türkçe biçimde yazar (0,20 · 2/3 · 3/4 · 72). */
export function fmtNum(x: number | boolean | string): string {
  if (typeof x !== "number") return String(x);
  if (Math.abs(x - 2 / 3) < 5e-4) return "2/3";
  if (Math.abs(x - 1 / 3) < 5e-4) return "1/3";
  if (Number.isInteger(x)) return String(x);
  return x.toFixed(2).replace(".", ",");
}

export function dedupFindings(list: Finding[]): Finding[] {
  const seen = new Set<string>();
  const out: Finding[] = [];
  for (const f of list) {
    const k = `${f.severity}|${f.code}|${f.focus ?? ""}|${f.message}`;
    if (seen.has(k)) continue;
    seen.add(k);
    out.push(f);
  }
  return out;
}
