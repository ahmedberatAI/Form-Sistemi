// Çevrimdışı sezgisel mod: anahtar yokken (ya da Claude başarısız olunca) tam işlevsel, belirlenimci çıktılar.
import { clusterLabel, compactIri, fy, type DiscussionSummary, type AiCitedPoint } from "@forum/shared";
import type { ClassificationResult, ModerationResult, PiiFinding, SummaryInput, SummaryInputMessage } from "../core/contracts";
import {
  ACCUSATION_WORDS,
  COPYRIGHT_CUES,
  LABEL_ARTICLE_KEYWORDS,
  LEGAL_MESSAGE,
  LEGAL_QUALIFICATION_PATTERNS,
  OVERCLAIM_MESSAGE,
  OVERCLAIM_PATTERNS,
  OUT_OF_DOMAIN_MESSAGE,
  OUT_OF_DOMAIN_PATTERNS,
  SPAM_STRONG,
  SPAM_WEAK,
  THREAT_PHRASES,
} from "./lexicons";
import { detectPii, PseudonymMasker, redactPii } from "./pii";
import { detectRights } from "./rights";
import { detectHate, detectInsults } from "./targeting";
import { clamp01, contentTokens, f5, findPhrase, lowerTr, normalizeTr, round3, sentences, STOPWORDS, tokenize, truncate, type Token } from "./text";

export interface ClassifyContext {
  categories: { iri: string; label: string; keywords: string[] }[];
  rights: { iri: string; label: string }[];
  contentLabels: { iri: string; label: string }[];
}

export interface ModerateContext {
  articles: { iri: string; number: string; title: string }[];
  contentLabels: { iri: string; label: string }[];
}

export type Offline<T> = Omit<T, "offline" | "model">;

/** IRI'nin yerel adı ("https://…#Tehdit" / "fy:Tehdit" → "Tehdit"). */
export function localOf(iri: string): string {
  const c = compactIri(iri);
  if (c.startsWith("fy:")) return c.slice(3);
  const i = Math.max(iri.lastIndexOf("#"), iri.lastIndexOf("/"));
  return i >= 0 ? iri.slice(i + 1) : iri;
}

export function labelIri(local: string, contentLabels: { iri: string }[]): string {
  return contentLabels.find((c) => localOf(c.iri) === local)?.iri ?? fy(local);
}

const LABEL_NAMES: Record<string, string> = {
  Tehdit: "Tehdit",
  NefretSoylemi: "Nefret söylemi",
  KisiselVeriIfsasi: "Kişisel veri ifşası",
  HakaretIftira: "Hakaret / iftira",
  Spam: "Spam / reklam",
  TelifIhlali: "Telif ihlali",
};

const PII_NAMES: Record<PiiFinding["kind"], string> = {
  tckn: "T.C. kimlik numarası",
  iban: "IBAN",
  phone: "telefon numarası",
  email: "e-posta adresi",
  address: "açık adres",
};

const RISK_NAMES = ["yok", "düşük", "orta", "yüksek"] as const;

// ───────────────────────── İçerik sinyalleri (moderasyon + sınıflandırma) ─────────────────────────

interface Span {
  start: number;
  end: number;
}

export interface LabelHit {
  local: string;
  confidence: number;
  severity: 0 | 1 | 2 | 3;
  spans: Span[];
  evidence: string[];
}

function phraseHits(tokens: Token[], text: string, phrases: string[], strict = false): { spans: Span[]; quotes: string[] } {
  const spans: Span[] = [];
  const quotes: string[] = [];
  for (const p of phrases) {
    for (const [a, b] of findPhrase(tokens, p, { strict })) {
      const s = { start: tokens[a].start, end: tokens[b].end };
      if (spans.some((x) => x.start === s.start && x.end === s.end)) continue;
      spans.push(s);
      quotes.push(text.slice(s.start, s.end));
    }
  }
  return { spans, quotes };
}

/**
 * İçerik sinyalleri. `criticism`: nesneye (proje, karar, kurum) yönelik olduğu için hakaret SAYILMAYAN sert ifadeler;
 * yalnız gerekçede şeffaflık için anılır.
 */
export function analyzeContent(text: string): { hits: LabelHit[]; pii: PiiFinding[]; criticism: string[] } {
  const hits: LabelHit[] = [];
  const tokens = tokenize(text);

  const threat = phraseHits(tokens, text, THREAT_PHRASES);
  if (threat.spans.length) {
    hits.push({ local: "Tehdit", confidence: threat.spans.length > 1 ? 0.95 : 0.9, severity: 3, spans: threat.spans, evidence: threat.quotes });
  }

  // Nefret söylemi: yalnız gruba bitişik niteleme, grubu doğrudan hedef alan dışlama ya da açık düşmanlık çağrısı
  // (bkz. targeting.ts). Güven sinyalin hedefliliğine göre: hedefli 0,85; yalnız düşmanlık çağrısı 0,75; birden çok sinyal 0,9.
  const hate = detectHate(text, tokens);
  if (hate.spans.length) {
    const confidence = hate.signals > 1 ? 0.9 : hate.targeted ? 0.85 : 0.75;
    hits.push({ local: "NefretSoylemi", confidence, severity: 3, spans: hate.spans, evidence: hate.evidence });
  }

  // Hakaret: yalnız kişiye yönelen sözcükler; "aptalca proje", "aptal bir karar" gibi nesneye yönelik eleştiri sayılmaz.
  const insult = detectInsults(text, tokens);
  const accusation = phraseHits(tokens, text, ACCUSATION_WORDS);
  if (insult.spans.length || accusation.spans.length) {
    const conf = insult.spans.length ? (insult.spans.length > 1 ? 0.9 : 0.8) : 0.5;
    hits.push({
      local: "HakaretIftira",
      confidence: conf,
      severity: conf >= 0.7 ? 2 : 1,
      spans: [...insult.spans, ...accusation.spans],
      evidence: [...insult.quotes, ...accusation.quotes],
    });
  }

  const urls = [...text.matchAll(/(?:https?:\/\/|www\.)[^\s<>"')]+/giu)];
  const urlSpans = urls.map((u) => ({ start: u.index!, end: u.index! + u[0].length }));
  const outsideUrls = tokens.filter((t) => !urlSpans.some((u) => t.start >= u.start && t.end <= u.end));
  const strong = phraseHits(outsideUrls, text, SPAM_STRONG);
  const weak = phraseHits(outsideUrls, text, SPAM_WEAK);
  let spamScore = urls.length + strong.spans.length + 0.5 * weak.spans.length;
  const urlSet = new Set(urls.map((u) => lowerTr(u[0])));
  if (urls.length > urlSet.size) spamScore += 1;
  const words = tokens.map((t) => t.norm).filter((t) => t.length > 2);
  if (words.length >= 6) {
    const freq = new Map<string, number>();
    for (const w of words) freq.set(w, (freq.get(w) ?? 0) + 1);
    const top = Math.max(...freq.values());
    if (top / words.length >= 0.4) spamScore += 1.5;
  }
  if (/!{3,}/.test(text)) spamScore += 0.5;
  if (spamScore >= 2) {
    const conf = Math.min(0.9, 0.4 + 0.15 * spamScore);
    hits.push({
      local: "Spam",
      confidence: round3(conf),
      severity: conf >= 0.7 ? 2 : 1,
      spans: [...urlSpans, ...strong.spans, ...weak.spans],
      evidence: [...new Set([...urls.map((u) => u[0]), ...strong.quotes, ...weak.quotes].map((q) => (/^(https?:|www\.)/i.test(q) ? q : lowerTr(q))))],
    });
  }

  const copy = phraseHits(tokens, text, COPYRIGHT_CUES);
  const copyrightSign = text.indexOf("©");
  if (copy.spans.length || copyrightSign >= 0) {
    const spans = [...copy.spans];
    if (copyrightSign >= 0) spans.push({ start: copyrightSign, end: copyrightSign + 1 });
    hits.push({ local: "TelifIhlali", confidence: spans.length > 1 ? 0.65 : 0.5, severity: 1, spans, evidence: [...copy.quotes, ...(copyrightSign >= 0 ? ["©"] : [])] });
  }

  const pii = detectPii(text);
  if (pii.length) {
    const hard = pii.some((p) => p.kind === "tckn" || p.kind === "iban" || p.kind === "address");
    const conf = Math.max(...pii.map((p) => (p.kind === "tckn" || p.kind === "iban" ? 0.95 : p.kind === "address" ? 0.7 : 0.85)));
    hits.push({
      local: "KisiselVeriIfsasi",
      confidence: conf,
      severity: hard ? 3 : 2,
      spans: pii.map((p) => ({ start: p.start, end: p.end })),
      evidence: [...new Set(pii.map((p) => PII_NAMES[p.kind]))],
    });
  }

  hits.sort((a, b) => b.severity - a.severity || b.confidence - a.confidence || a.local.localeCompare(b.local));
  return { hits, pii, criticism: insult.objectDirected };
}

function matchArticles(labels: string[], text: string, articles: ModerateContext["articles"]): string[] {
  const out = new Set<string>();
  for (const local of labels) {
    const kws = (LABEL_ARTICLE_KEYWORDS[local] ?? []).map(normalizeTr);
    for (const a of articles) {
      const title = normalizeTr(a.title);
      if (kws.some((k) => title.includes(k))) out.add(a.iri);
    }
  }
  for (const m of text.matchAll(/madde\s*(\d+)/giu)) {
    const n = m[1];
    for (const a of articles) {
      if (new RegExp(`^madde\\s*${n}(?!\\d)`, "iu").test(a.number.trim())) out.add(a.iri);
    }
  }
  return articles.filter((a) => out.has(a.iri)).map((a) => a.iri);
}

export function offlineModerate(text: string, ctx: ModerateContext): Offline<ModerationResult> {
  const { hits, pii, criticism } = analyzeContent(text);
  const risk = hits.reduce<0 | 1 | 2 | 3>((r, h) => (h.severity > r ? h.severity : r), 0);
  const piiByStart = new Map(pii.map((p) => [p.start, p]));
  const spanMap = new Map<string, { start: number; end: number; quote: string }>();
  for (const h of hits) {
    for (const s of h.spans) {
      const p = h.local === "KisiselVeriIfsasi" ? piiByStart.get(s.start) : undefined;
      spanMap.set(`${s.start}:${s.end}`, { start: s.start, end: s.end, quote: p ? p.masked : text.slice(s.start, s.end) });
    }
  }
  const all = [...spanMap.values()];
  // Başka bir aralığın içinde kalan aralıklar atılır.
  const spans = all
    .filter((s) => !all.some((o) => o !== s && o.start <= s.start && o.end >= s.end && o.end - o.start > s.end - s.start))
    .sort((a, b) => a.start - b.start || a.end - b.end);
  const locals = hits.map((h) => h.local);
  const critique = criticism.length
    ? ` ${criticism.map((q) => `«${truncate(q, 40)}»`).join(", ")} ifadesi bir projeye, karara ya da kuruma yönelik sert eleştiri olarak değerlendirildi; kişiye hakaret sayılmadı.`
    : "";
  const rationale = hits.length
    ? `Saptanan sinyaller: ${hits.map((h) => `${LABEL_NAMES[h.local] ?? h.local} (${(h.local === "KisiselVeriIfsasi" ? h.evidence : h.evidence.slice(0, 3)).map((e) => (h.local === "KisiselVeriIfsasi" ? e : `«${truncate(e, 60)}»`)).join(", ")})`).join("; ")}. Risk düzeyi: ${risk}/3 (${RISK_NAMES[risk]}).${critique} Bu değerlendirme çevrimdışı sezgisel yöntemle yapılmıştır; içerik gizlenmez, karar insanlara aittir.`
    : `Belirgin bir risk sinyali (tehdit, hakaret, nefret söylemi, spam, kişisel veri) saptanmadı. Risk düzeyi: 0/3.${critique} Bu değerlendirme çevrimdışı sezgisel yöntemle yapılmıştır.`;
  return {
    risk,
    labels: locals.map((l) => labelIri(l, ctx.contentLabels)),
    // Etiket başına sezgiselin kendi güveni (risk düzeyinden türetilmez).
    labelConfidences: hits.map((h) => ({ label: labelIri(h.local, ctx.contentLabels), confidence: h.confidence })),
    articleIds: matchArticles(locals, text, ctx.articles),
    spans,
    pii,
    rationale,
  };
}

// ───────────────────────── Sınıflandırma ─────────────────────────

export function offlineClassify(input: { title: string; body: string }, ctx: ClassifyContext): Offline<ClassificationResult> {
  // Kategori eşleştirmesinde durak sözcükler ("hatta", "ama" …) atlanır.
  const titleTokens = tokenize(input.title ?? "").filter((t) => !STOPWORDS.has(t.norm));
  const bodyTokens = tokenize(input.body ?? "").filter((t) => !STOPWORDS.has(t.norm));
  const fullText = `${input.title ?? ""}\n${input.body ?? ""}`;

  const scored = ctx.categories
    .map((c) => {
      let score = 0;
      const matched: string[] = [];
      for (const kw of c.keywords) {
        const th = findPhrase(titleTokens, kw).length;
        const bh = Math.min(3, findPhrase(bodyTokens, kw).length);
        if (th + bh === 0) continue;
        matched.push(kw);
        score += (th > 0 ? 2 : 0) + bh + (kw.includes(" ") ? 0.5 : 0);
      }
      return { c, score, matched };
    })
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score || a.c.iri.localeCompare(b.c.iri));
  const best = scored[0]?.score ?? 0;
  const chosen = scored.filter((x) => x.score >= Math.max(1, best * 0.5)).slice(0, 3);
  const categories = chosen.map((x) => ({ iri: x.c.iri, confidence: round3(Math.min(0.9, 0.25 + 0.12 * x.score)) }));

  const found = detectRights(fullText, ctx.rights, localOf);
  const rightsAffected: ClassificationResult["rightsAffected"] = found.map((f) => ({ right: f.right, direction: f.direction, confidence: round3(f.confidence) }));
  const labelOfRight = new Map(ctx.rights.map((r) => [r.iri, r.label]));
  const rightNotes = found.map(
    (f) =>
      `«${labelOfRight.get(f.right) ?? f.right}» (${f.direction === "restrict" ? "kısıtlama" : "genişletme"}, güven ${f.confidence.toFixed(2).replace(".", ",")}${f.confidence < 0.5 ? ", zayıf ipucu" : ""}; ${f.evidence
        .slice(0, 2)
        .map((e) => `«${truncate(e, 80)}»`)
        .join(", ")})`,
  );

  const { hits } = analyzeContent(fullText);
  const contentLabels = hits.map((h) => ({ label: labelIri(h.local, ctx.contentLabels), confidence: h.confidence }));

  const parts: string[] = [];
  if (chosen.length) {
    parts.push(`Anahtar kelime eşleşmeleri: ${chosen.map((x) => `${x.c.label} (${x.matched.map((m) => `«${m}»`).join(", ")})`).join("; ")}.`);
  } else {
    parts.push("Kategori anahtar kelimeleriyle eşleşme bulunamadı; kategoriyi yazar seçmelidir.");
  }
  if (rightNotes.length) parts.push(`Hak etkisi değerlendirmesi: ${rightNotes.join("; ")}.`);
  if (hits.length) parts.push(`İçerik uyarıları: ${hits.map((h) => LABEL_NAMES[h.local] ?? h.local).join(", ")}.`);
  parts.push("Bu sınıflandırma çevrimdışı sezgisel yöntemle yapılmıştır ve yalnızca öneri niteliğindedir; etiketler yalnızca yükseltilebilir.");
  return { categories, rightsAffected, contentLabels, rationale: parts.join(" ") };
}

// ───────────────────────── Benzerlik (TF-IDF kosinüs) ─────────────────────────

function termsOf(title: string, body: string): Map<string, number> {
  const tf = new Map<string, number>();
  const add = (t: string, w: number) => tf.set(t, (tf.get(t) ?? 0) + w);
  for (const t of contentTokens(title ?? "")) add(f5(t), 2);
  for (const t of contentTokens(body ?? "")) add(f5(t), 1);
  return tf;
}

export function offlineSimilar(
  input: { title: string; body: string },
  corpus: { id: string; title: string; body: string }[],
  limit = 5,
  minScore = 0.15,
): { id: string; score: number }[] {
  if (!corpus.length) return [];
  const q = termsOf(input.title, input.body);
  const docs = corpus.map((d) => ({ id: d.id, tf: termsOf(d.title, d.body) }));
  const n = docs.length + 1;
  const df = new Map<string, number>();
  for (const tf of [q, ...docs.map((d) => d.tf)]) for (const t of tf.keys()) df.set(t, (df.get(t) ?? 0) + 1);
  const idf = (t: string) => Math.log((n + 1) / ((df.get(t) ?? 0) + 1)) + 1;
  const vec = (tf: Map<string, number>) => {
    const v = new Map<string, number>();
    let norm = 0;
    for (const [t, c] of tf) {
      const w = (1 + Math.log(c)) * idf(t);
      v.set(t, w);
      norm += w * w;
    }
    return { v, norm: Math.sqrt(norm) };
  };
  const qv = vec(q);
  if (qv.norm === 0) return [];
  return docs
    .map((d) => {
      const dv = vec(d.tf);
      if (dv.norm === 0) return { id: d.id, score: 0 };
      let dot = 0;
      for (const [t, w] of qv.v) dot += w * (dv.v.get(t) ?? 0);
      return { id: d.id, score: Math.round((dot / (qv.norm * dv.norm)) * 10_000) / 10_000 };
    })
    .filter((x) => x.score >= minScore)
    .sort((a, b) => b.score - a.score || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0))
    .slice(0, Math.max(0, limit));
}

// ───────────────────────── Tartışma özeti (çıkarımsal) ─────────────────────────

interface SMsg extends SummaryInputMessage {
  stems: Set<string>;
  surfaces: Map<string, string>;
}

function maxPseudonymIndex(msgs: Pick<SummaryInputMessage, "pseudonym">[]): number {
  let max = 0;
  for (const m of msgs) {
    const r = /^K(\d+)$/.exec(m.pseudonym);
    if (r) max = Math.max(max, Number(r[1]));
  }
  return max;
}

const uniq = <T>(xs: T[]): T[] => [...new Set(xs)];
const listAuthors = (ms: SMsg[], max = 4): string => {
  const a = uniq(ms.map((m) => m.pseudonym));
  return a.length > max ? `${a.slice(0, max).join(", ")} ve ${a.length - max} kişi daha` : a.join(", ");
};

export function offlineSummarize(input: SummaryInput): DiscussionSummary {
  const masker = new PseudonymMasker(maxPseudonymIndex([...input.messages, ...(input.minorityReports ?? [])]) + 1);
  const safe = (s: string, max = 140) => truncate(masker.mask(redactPii(s)), max);
  const firstSentence = (body: string, stem?: string) => {
    const ss = sentences(body);
    const hit = stem ? ss.find((s) => contentTokens(s.text).some((t) => f5(t) === stem)) : undefined;
    return safe((hit ?? ss[0])?.text ?? body);
  };

  const titleStems = new Set(contentTokens(input.topicTitle ?? "").map(f5));
  const msgs: SMsg[] = input.messages.map((m) => {
    const stems = new Set<string>();
    const surfaces = new Map<string, string>();
    for (const t of contentTokens(m.body ?? "")) {
      if (t.length < 4) continue;
      const s = f5(t);
      if (titleStems.has(s)) continue;
      stems.add(s);
      const prev = surfaces.get(s);
      if (!prev || t.length < prev.length) surfaces.set(s, t);
    }
    return { ...m, stems, surfaces };
  });

  const clusterIds = uniq(msgs.map((m) => m.clusterId).filter((c): c is string => !!c)).sort();
  const multiCluster = clusterIds.length >= 2;

  interface Theme {
    stems: string[];
    msgs: SMsg[];
    clusters: Set<string>;
    authors: Set<string>;
  }
  const byStem = new Map<string, SMsg[]>();
  for (const m of msgs) {
    for (const s of m.stems) {
      const list = byStem.get(s);
      if (list) list.push(m);
      else byStem.set(s, [m]);
    }
  }
  let themes: Theme[] = [...byStem.entries()]
    .filter(([, ms]) => ms.length >= 2)
    .map(([s, ms]) => ({
      stems: [s],
      msgs: ms,
      clusters: new Set(ms.map((m) => m.clusterId).filter((c): c is string => !!c)),
      authors: new Set(ms.map((m) => m.pseudonym)),
    }))
    .sort((a, b) => b.clusters.size - a.clusters.size || b.authors.size - a.authors.size || b.msgs.length - a.msgs.length || (a.stems[0] < b.stems[0] ? -1 : 1));
  // Aynı mesaj kümesini kapsayan temaları birleştir.
  const merged: Theme[] = [];
  const mergedIds: Set<string>[] = []; // birleşik temaların kimlik kümeleri bir kez kurulur (her karşılaştırmada yeniden değil)
  for (const t of themes) {
    const ids = new Set(t.msgs.map((m) => m.id));
    let same: Theme | undefined;
    for (let k = 0; k < merged.length && !same; k++) {
      const xi = mergedIds[k];
      let inter = 0;
      for (const i of ids) if (xi.has(i)) inter++;
      if (inter / (ids.size + xi.size - inter) >= 0.8) same = merged[k];
    }
    if (same) {
      if (same.stems.length < 3) same.stems.push(...t.stems);
    } else {
      merged.push({ ...t, stems: [...t.stems] });
      mergedIds.push(ids);
    }
  }
  themes = merged;
  const themeWords = (t: Theme) =>
    t.stems.map((s) => t.msgs.find((m) => m.surfaces.has(s))?.surfaces.get(s) ?? s).join(", ");

  // Tartışmalı: hem lehte hem aleyhte mesajlarda geçen temalar.
  const contested: AiCitedPoint[] = [];
  const usedThemes = new Set<Theme>();
  const contestedThemes = themes
    .map((t) => ({ t, pro: t.msgs.filter((m) => m.stance === "pro"), con: t.msgs.filter((m) => m.stance === "con") }))
    .filter((x) => x.pro.length && x.con.length)
    .sort((a, b) => Math.min(b.pro.length, b.con.length) - Math.min(a.pro.length, a.con.length) || b.t.msgs.length - a.t.msgs.length)
    .slice(0, 3);
  for (const { t, pro, con } of contestedThemes) {
    usedThemes.add(t);
    contested.push({
      text: `«${themeWords(t)}» konusunda görüşler ayrışıyor: lehte (${listAuthors(pro)}) ve aleyhte (${listAuthors(con)}) değerlendirmeler var.`,
      cites: uniq([...pro.slice(0, 3), ...con.slice(0, 3)].map((m) => m.id)),
    });
  }
  const allPro = msgs.filter((m) => m.stance === "pro");
  const allCon = msgs.filter((m) => m.stance === "con");
  if (!contested.length && allPro.length && allCon.length) {
    contested.push({
      text: `Öneri genel olarak tartışmalı: ${allPro.length} lehte ve ${allCon.length} aleyhte mesaj var. Örneğin ${allCon[0].pseudonym}: "${firstSentence(allCon[0].body)}"`,
      cites: uniq([...allPro.slice(0, 3), ...allCon.slice(0, 3)].map((m) => m.id)),
    });
  }

  // Ortak zemin: birden çok kümede (küme yoksa birden çok kişide) tekrar eden temalar.
  const commonGround: AiCitedPoint[] = [];
  for (const t of themes) {
    if (commonGround.length >= 3) break;
    if (usedThemes.has(t)) continue;
    if (multiCluster ? t.clusters.size < 2 : t.authors.size < 2) continue;
    const ex = t.msgs[0];
    commonGround.push({
      text: multiCluster
        ? `«${themeWords(t)}» konusu ${t.clusters.size} farklı görüş grubunda dile getirildi (${listAuthors(t.msgs)}). Örnek: "${firstSentence(ex.body, t.stems[0])}"`
        : `«${themeWords(t)}» konusu birden çok katılımcı tarafından dile getirildi (${listAuthors(t.msgs)}). Örnek: "${firstSentence(ex.body, t.stems[0])}"`,
      cites: t.msgs.slice(0, 5).map((m) => m.id),
    });
  }

  // Azınlık görüşleri (tekrarsız, şu sırayla):
  //  1) azınlık raporları — karar kaydına eklenen, karşı kümelerin yazdığı metinler (mesaj değildir, alıntı kimliği yok);
  //  2) kesin sayım "tartışmalı" ise köprü testini geçemeyen kümelerin "hayır" (aleyhte) tarafı;
  //  3) küme anlık görüntüsündeki NÜFUSA göre en küçük anlamlı küme(ler)in mesajları (verilmemişse, eski davranışla,
  //     tartışmaya yazan farklı kişi sayısına göre en küçük küme);
  //  4) bunlardan mesaj çıkmadıysa sayıca az olan tutum (lehte/aleyhte).
  const minorityViews: AiCitedPoint[] = [];
  const excerpt = (body: string) => {
    const ss = sentences(body);
    return safe(ss.length ? ss.slice(0, 2).map((s) => s.text).join(" ") : body, 240);
  };
  for (const r of (input.minorityReports ?? []).slice(0, 3)) {
    const group = r.clusterId ? ` (${clusterLabel(r.clusterId)})` : "";
    minorityViews.push({ text: `Azınlık raporu${group} — ${r.pseudonym}: "${excerpt(r.body)}"`, cites: [] });
  }

  const minorityMsgs: { m: SMsg; why: string }[] = [];
  const addMinority = (m: SMsg, why: string) => {
    if (!minorityMsgs.some((x) => x.m.id === m.id)) minorityMsgs.push({ m, why });
  };

  const failed = input.failedClusters ?? [];
  const popSizes = input.clusterSizes ? Object.entries(input.clusterSizes) : null;
  const smallest = new Map<string, number>();
  if (popSizes) {
    if (popSizes.length >= 2) {
      const min = Math.min(...popSizes.map(([, n]) => n));
      const max = Math.max(...popSizes.map(([, n]) => n));
      if (min < max) for (const [c, n] of popSizes) if (n === min) smallest.set(c, n);
    }
  }
  for (const f of failed) {
    const con = msgs.filter((m) => m.clusterId === f.clusterId && m.stance === "con");
    const size = smallest.has(f.clusterId) ? `en küçük anlamlı görüş grubu, ${f.members} üye` : `${f.members} üye`;
    minorityViews.push({
      text: `${clusterLabel(f.clusterId)} (${size}) kesin sayımda köprü testini geçemedi: ${f.yes} evet, ${f.no} hayır. Bu grubun "hayır" tarafı azınlıkta kaldı${
        con.length ? `; tartışmada aleyhte yazanlar: ${listAuthors(con)}.` : "; tartışmada bu gruptan aleyhte mesaj yok."
      }`,
      cites: [],
    });
    for (const m of con) addMinority(m, `${clusterLabel(f.clusterId)} (köprü testini geçemeyen grup, aleyhte)`);
  }
  if (popSizes) {
    for (const m of msgs) {
      if (!m.clusterId || !smallest.has(m.clusterId) || m.stance === "question") continue;
      addMinority(m, `${clusterLabel(m.clusterId)} (en küçük anlamlı görüş grubu, ${smallest.get(m.clusterId)} üye)`);
    }
  } else if (multiCluster) {
    const sizes = clusterIds.map((c) => ({ c, n: new Set(msgs.filter((m) => m.clusterId === c).map((m) => m.pseudonym)).size }));
    const min = Math.min(...sizes.map((s) => s.n));
    const max = Math.max(...sizes.map((s) => s.n));
    if (min < max) {
      const small = new Set(sizes.filter((s) => s.n === min).map((s) => s.c));
      for (const m of msgs) {
        if (m.clusterId && small.has(m.clusterId) && m.stance !== "question") addMinority(m, `${clusterLabel(m.clusterId)} (azınlıktaki görüş grubu)`);
      }
    }
  }
  if (!minorityMsgs.length && allPro.length && allCon.length && allPro.length !== allCon.length) {
    const side = allPro.length < allCon.length ? allPro : allCon;
    const label = side === allPro ? "lehte" : "aleyhte";
    for (const m of side) addMinority(m, `Sayıca az olan ${label} görüş`);
  }
  for (const { m, why } of minorityMsgs.slice(0, 6)) {
    minorityViews.push({ text: `${why} — ${m.pseudonym}: "${firstSentence(m.body)}"`, cites: [m.id] });
  }
  if (!minorityViews.length) {
    minorityViews.push({
      text: msgs.length
        ? popSizes
          ? "Bu tartışmada belirgin bir azınlık görüşü saptanmadı: topluluktaki anlamlı görüş gruplarının nüfusları eşit ya da tek bir anlamlı grup var ve lehte/aleyhte mesaj sayıları dengeli. Azınlık görüşleri ayrıca gözetilmelidir."
          : "Bu tartışmada belirgin bir azınlık görüşü saptanmadı: mesajlar tek bir görüş grubunda toplanıyor ya da gruplar eşit büyüklükte. Azınlık görüşleri ayrıca gözetilmelidir."
        : "Henüz mesaj olmadığı için azınlık görüşü özetlenemedi.",
      cites: [],
    });
  }

  // Açık sorular: soru tutumundaki mesajlar, ardından soru işaretli cümleler.
  const openQuestions: AiCitedPoint[] = [];
  for (const m of msgs.filter((x) => x.stance === "question")) {
    if (openQuestions.length >= 5) break;
    const q = sentences(m.body).find((s) => s.text.endsWith("?"));
    openQuestions.push({ text: `${m.pseudonym} soruyor: "${safe(q?.text ?? m.body)}"`, cites: [m.id] });
  }
  for (const m of msgs.filter((x) => x.stance !== "question")) {
    if (openQuestions.length >= 5) break;
    const q = sentences(m.body).find((s) => s.text.endsWith("?"));
    if (q) openQuestions.push({ text: `${m.pseudonym} soruyor: "${safe(q.text)}"`, cites: [m.id] });
  }

  const summary: DiscussionSummary = { commonGround, contested, minorityViews, openQuestions, coverage: 0 };
  return { ...summary, coverage: computeCoverage(summary, input.messages) };
}

export function computeCoverage(s: Omit<DiscussionSummary, "coverage">, messages: { id: string }[]): number {
  if (!messages.length) return 0;
  const ids = new Set(messages.map((m) => m.id));
  const cited = new Set<string>();
  for (const p of [...s.commonGround, ...s.contested, ...s.minorityViews, ...s.openQuestions]) for (const c of p.cites) if (ids.has(c)) cited.add(c);
  return round3(clamp01(cited.size / ids.size));
}

// ───────────────────────── Köprü taslakları ─────────────────────────

export function offlineBridging(input: { title: string; body: string; majorityPoints: string[]; minorityPoints: string[] }): {
  drafts: { title: string; body: string; rationale: string }[];
} {
  const masker = new PseudonymMasker();
  const clean = (s: string) => truncate(masker.mask(redactPii(s ?? "")), 160).replace(/[.!?…]+$/u, "");
  const title = clean(input.title) || "Öneri";
  const maj = input.majorityPoints.map(clean).filter(Boolean);
  const min = input.minorityPoints.map(clean).filter(Boolean);
  const M = (i: number) => (maj.length ? `«${maj[i % maj.length]}»` : "çoğunluğun temel beklentisi");
  const m = (i: number) => (min.length ? `«${min[i % min.length]}»` : "azınlığın dile getirdiği kaygılar");
  const templates: ((i: number) => { title: string; body: string; rationale: string })[] = [
    (i) => ({
      title: `Pilot uygulama: ${title}`,
      body: `Öneri önce sınırlı bir bölgede ve 3 aylık bir süre için pilot olarak uygulanır. Pilot süresince azınlığın kaygısı ölçülebilir göstergelerle izlenir: ${m(i)}. Pilot sonunda sonuçlar foruma raporlanır ve kalıcı uygulama yeniden oylanır.`,
      rationale: `Çoğunluğun beklentisi (${M(i)}) gecikmeden denenirken azınlığın kaygısı (${m(i)}) gerçek verilerle sınanır.`,
    }),
    (i) => ({
      title: `Kademeli geçiş: ${title}`,
      body: `Öneri tek seferde değil, üç aşamada uygulanır ve her aşamadan önce etkiler değerlendirilir. İlk aşama çoğunluğun önceliğine odaklanır (${M(i)}). Sonraki aşamaya geçmeden önce azınlığın kaygısına ilişkin etkiler gözden geçirilir (${m(i)}).`,
      rationale: "Kademeli geçiş, çoğunluğun hedefini korurken azınlığın uyum sağlaması için zaman tanır ve geri dönüşü kolaylaştırır.",
    }),
    (i) => ({
      title: `Muafiyet ve telafi: ${title}`,
      body: `Öneri kabul edilir; ancak orantısız biçimde etkilenenler için muafiyet ya da telafi mekanizması tanımlanır. Mekanizma özellikle şu kaygıyı gözetir: ${m(i)}. Muafiyet başvuruları önceden ilan edilen açık ölçütlerle değerlendirilir.`,
      rationale: `Kararın yükü azınlığa yığılmadan çoğunluğun amacı (${M(i)}) gerçekleştirilir.`,
    }),
    (i) => ({
      title: `Süreli karar ve gözden geçirme maddesi: ${title}`,
      body: `Öneri 12 aylık bir süre için yürürlüğe girer. Sürenin sonunda karar kendiliğinden yeniden değerlendirmeye açılır. Değerlendirme raporunda hem çoğunluğun hedefine ne ölçüde ulaşıldığı (${M(i)}) hem de azınlığın kaygısına ilişkin gözlemler (${m(i)}) yer alır.`,
      rationale: "Süreli karar, azınlığın endişelerinin kalıcı hâle gelmesini önler; çoğunluğa ise uygulamayı deneme olanağı verir.",
    }),
    (i) => ({
      title: `Bağımsız izleme kurulu: ${title}`,
      body: `Uygulamayı, farklı görüş gruplarından üyelerin yer aldığı bağımsız bir izleme kurulu takip eder. Kurul üç ayda bir herkese açık rapor yayımlar ve şu konudaki gelişmeleri ayrıca izler: ${m(i)}.`,
      rationale: `İzleme kurulu, çoğunluğun hedefi (${M(i)}) ile azınlığın kaygıları arasında güven köprüsü kurar ve şeffaflık sağlar.`,
    }),
    (i) => ({
      title: `Kapsamı daraltılmış öneri: ${title}`,
      body: `Öneri, tartışmada geniş destek gören çekirdek unsurla sınırlandırılır: ${M(i)}. Tartışmalı kalan unsurlar ayrı bir öneri olarak yeniden tartışmaya açılır; bu tartışmada azınlığın kaygısı öncelikle ele alınır: ${m(i)}.`,
      rationale: "Ortak zemin hemen hayata geçirilirken ayrışılan noktalar için ayrı ve odaklı bir karar süreci korunur.",
    }),
    (i) => ({
      title: `Azınlık temsilinin güvenceye alınması: ${title}`,
      body: `Öneri uygulanırken alınacak uygulama kararlarında azınlıktaki görüş grubundan en az bir temsilcinin görüşü alınır ve kayda geçirilir. Temsilci özellikle şu konuda söz sahibidir: ${m(i)}.`,
      rationale: `Azınlığın sesi uygulama aşamasında da duyulur; çoğunluğun hedefi (${M(i)}) daha geniş meşruiyet kazanır.`,
    }),
    (i) => ({
      title: `Gönüllü katılımlı uygulama: ${title}`,
      body: `Öneri, katılmak isteyen birimler ve kişiler için gönüllülük esasına göre uygulanır; katılmayanlar için mevcut durum korunur. Böylece azınlığın kaygısı zorlayıcı olmaktan çıkar: ${m(i)}.`,
      rationale: `Çoğunluk hedefini (${M(i)}) isteyenlerle gerçekleştirebilir; azınlık üzerinde zorlayıcı bir etki oluşmaz.`,
    }),
  ];
  const n = Math.max(4, Math.min(8, 4 + Math.floor((maj.length + min.length) / 2)));
  return { drafts: templates.slice(0, n).map((t, i) => t(i)) };
}

// ───────────────────────── Bilirkişi raporu denetimi ─────────────────────────

/**
 * Bulgu türleri: legal_qualification, overclaim, out_of_domain. Çevrimdışı "out_of_domain" yalnızca bilirkişinin
 * kendi beyanıyla alan dışına çıktığı cümleleri ("uzmanlık alanım dışında olmakla birlikte …") yakalar; alan
 * karşılaştırmasına dayalı tespit yalnızca Claude modunda yapılır (çevrimdışında üretilmeyebilir).
 */
export function offlineLint(text: string): { issues: { quote: string; kind: string; message: string }[] } {
  const issues: { quote: string; kind: string; message: string }[] = [];
  const seen = new Set<string>();
  for (const s of sentences(text ?? "")) {
    const low = lowerTr(s.text).replace(/\s+/g, " ");
    const quote = truncate(s.text, 220);
    const legal = LEGAL_QUALIFICATION_PATTERNS.filter((p) => low.includes(p));
    if (legal.length && !seen.has(`L:${quote}`)) {
      seen.add(`L:${quote}`);
      issues.push({ quote, kind: "legal_qualification", message: `${LEGAL_MESSAGE} (Saptanan ifade: «${legal[0]}».)` });
    }
    const over = OVERCLAIM_PATTERNS.filter((p) => low.includes(p));
    if (over.length && !seen.has(`O:${quote}`)) {
      seen.add(`O:${quote}`);
      issues.push({ quote, kind: "overclaim", message: `${OVERCLAIM_MESSAGE} (Saptanan ifade: «${over[0]}».)` });
    }
    const ood = OUT_OF_DOMAIN_PATTERNS.filter((p) => low.includes(p));
    if (ood.length && !seen.has(`D:${quote}`)) {
      seen.add(`D:${quote}`);
      issues.push({ quote, kind: "out_of_domain", message: `${OUT_OF_DOMAIN_MESSAGE} (Saptanan ifade: «${ood[0]}».)` });
    }
  }
  return { issues };
}

// ───────────────────────── Karar açıklaması (şablon) ─────────────────────────

export function explainDecision(checks: { label: string; passed: boolean; value: string; required: string }[], outcomeLabel: string): string {
  if (!checks.length) return `Sonuç: ${outcomeLabel}. Bu sonuç için değerlendirilen bir koşul listesi bulunmuyor.`;
  const passed = checks.filter((c) => c.passed);
  const failed = checks.filter((c) => !c.passed);
  const parts = [`Sonuç: ${outcomeLabel}.`];
  parts.push(
    failed.length === 0
      ? `Değerlendirilen ${checks.length} koşulun tamamı sağlandı.`
      : `Değerlendirilen koşul sayısı ${checks.length}; sağlanan ${passed.length}, sağlanamayan ${failed.length}.`,
  );
  for (const c of checks) {
    parts.push(
      c.passed
        ? `${c.label} koşulu sağlandı (gerçekleşen: ${c.value}; gerekli: ${c.required}).`
        : `${c.label} koşulu sağlanamadı (gerçekleşen: ${c.value}; gerekli: ${c.required}).`,
    );
  }
  parts.push("Bu açıklama karar kontrol listesinden şablonla üretilmiştir; kararı yapay zekâ vermez, sonuç yönetmelikteki kurallara göre hesaplanır.");
  return parts.join(" ");
}
