// AiService: Claude (anahtar varsa) + çevrimdışı sezgisel yedek. Asla hata fırlatmaz; YZ yalnızca danışmandır.
import Anthropic from "@anthropic-ai/sdk";
import { clusterLabel, OFFLINE_MODEL } from "@forum/shared";
import type { AiCallOptions, AiService, ClassificationResult, CoreContext, ModerationResult } from "../core/contracts";
import { bridgingRequest, callClaude, classifyRequest, DEFAULT_TIMEOUT_MS, lintRequest, moderateRequest, summarizeRequest, type AnthropicLike, type ClaudeRequest } from "./claude";
import {
  analyzeContent,
  computeCoverage,
  explainDecision,
  labelIri,
  offlineBridging,
  offlineClassify,
  offlineLint,
  offlineModerate,
  offlineSimilar,
  offlineSummarize,
} from "./heuristics";
import { detectPii, PseudonymMasker, sanitizeForModel } from "./pii";

/** Özet isteğine giren en fazla mesaj ve mesaj başına karakter (kalanlar çevrimdışı özetle kapsanır). */
const MAX_SUMMARY_MESSAGES = 400;
const MAX_MESSAGE_CHARS = 2000;

/**
 * Model bir etiket için güven bildirmediğinde kullanılan temkinli varsayılan: orta güven aralığında (0,40–0,70) kalır;
 * böylece güveni bilinmeyen bir etiket tek başına "yüksek güvenli etiket" sayılmaz.
 */
export const DEFAULT_LABEL_CONFIDENCE = 0.5;

/** lintExpertReport için ek seçenek: bilirkişinin uzmanlık alanları (etiket ya da IRI) "out_of_domain" denetimine verilir. */
export interface LintOptions extends AiCallOptions {
  domains?: string[];
}

/** AiService + uzmanlık alanı alan lint (sözleşme genişletilene dek somut tip üzerinden kullanılabilir). */
export interface AiServiceExt extends AiService {
  lintExpertReport(text: string, opts?: LintOptions): ReturnType<AiService["lintExpertReport"]>;
}

export interface AiServiceOptions {
  /** undefined: ortamdan (AI_ENABLED + ANTHROPIC_API_KEY); null: zorla çevrimdışı. */
  client?: AnthropicLike | null;
  timeoutMs?: number;
}

function defaultClient(ctx: CoreContext): AnthropicLike | null {
  if (!ctx.config.aiEnabled || !process.env.ANTHROPIC_API_KEY) return null;
  try {
    return new Anthropic({ timeout: DEFAULT_TIMEOUT_MS }) as unknown as AnthropicLike;
  } catch {
    return null;
  }
}

const OFF = { offline: true, model: OFFLINE_MODEL } as const;

export function createAiService(ctx: CoreContext, opts: AiServiceOptions = {}): AiServiceExt {
  const client = opts.client === undefined ? defaultClient(ctx) : opts.client;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const model = ctx.config.aiModel;

  async function ask<T>(o: AiCallOptions | undefined, build: () => ClaudeRequest<T>): Promise<{ data: T; model: string } | null> {
    if (!client || o?.forceOffline) return null;
    try {
      return await callClaude(client, model, build(), timeoutMs);
    } catch {
      return null;
    }
  }

  return {
    mode: () => (client ? "claude" : "offline"),
    model: () => (client ? model : OFFLINE_MODEL),
    detectPii,

    async classifyProposal(input, cctx, o): Promise<ClassificationResult> {
      const offline = offlineClassify(input, cctx);
      const r = await ask(o, () => {
        const masker = new PseudonymMasker();
        return classifyRequest({ title: sanitizeForModel(input.title, masker), body: sanitizeForModel(input.body, masker) }, cctx);
      });
      if (!r) return { ...offline, ...OFF };
      const categories = dedupeBy(r.data.categories, (c) => c.iri)
        .sort((a, b) => b.confidence - a.confidence)
        .slice(0, 3);
      const rights = new Map<string, ClassificationResult["rightsAffected"][number]>();
      for (const x of r.data.rightsAffected) {
        const prev = rights.get(x.right);
        // Aynı hak için kısıtlama genişletmeye üstün gelir (koruyucu yön).
        if (!prev || (x.direction === "restrict" && prev.direction === "expand") || (x.direction === prev.direction && x.confidence > prev.confidence)) rights.set(x.right, x);
      }
      const labels = new Map<string, number>();
      for (const l of r.data.contentLabels) labels.set(l.label, Math.max(labels.get(l.label) ?? 0, l.confidence));
      // Kişisel veriler Claude'a maskeli gittiği için yerel tespit her zaman eklenir.
      const pii = analyzeContent(`${input.title}\n${input.body}`).hits.find((h) => h.local === "KisiselVeriIfsasi");
      if (pii) {
        const iri = labelIri(pii.local, cctx.contentLabels);
        labels.set(iri, Math.max(labels.get(iri) ?? 0, pii.confidence));
      }
      return {
        categories,
        rightsAffected: [...rights.values()],
        contentLabels: [...labels.entries()].map(([label, confidence]) => ({ label, confidence })),
        rationale: r.data.rationale,
        offline: false,
        model: r.model,
      };
    },

    async moderate(text, mctx, o): Promise<ModerationResult> {
      const offline = offlineModerate(text, mctx);
      const r = await ask(o, () => moderateRequest(sanitizeForModel(text), mctx));
      if (!r) return { ...offline, ...OFF };
      const pii = offline.pii;
      const labels = new Set(r.data.labels);
      let risk = r.data.risk as ModerationResult["risk"];
      // Etiket başına güven: Claude'un kendi güveni; vermediyse aynı etiketi bulan yerel sezgiselin güveni; o da yoksa
      // temkinli varsayılan (orta güven: uyarı + insan/bilirkişi incelemesi, tek başına "yüksek güven" sayılmaz).
      const own = new Map<string, number>();
      for (const c of r.data.labelConfidences ?? []) own.set(c.label, Math.max(own.get(c.label) ?? 0, c.confidence));
      const local = new Map((offline.labelConfidences ?? []).map((c) => [c.label, c.confidence] as const));
      const piiHit = analyzeContent(text).hits.find((h) => h.local === "KisiselVeriIfsasi");
      if (piiHit) {
        const iri = labelIri(piiHit.local, mctx.contentLabels);
        labels.add(iri);
        own.set(iri, Math.max(own.get(iri) ?? 0, piiHit.confidence));
        if (piiHit.severity > risk) risk = piiHit.severity;
      }
      const labelConfidences = [...labels].map((label) => ({ label, confidence: own.get(label) ?? local.get(label) ?? DEFAULT_LABEL_CONFIDENCE }));
      const spanMap = new Map<string, { start: number; end: number; quote: string }>();
      for (const s of r.data.spans) {
        const q = s.quote.trim();
        if (!q) continue;
        const i = text.indexOf(q);
        if (i >= 0) spanMap.set(`${i}:${i + q.length}`, { start: i, end: i + q.length, quote: q });
      }
      for (const p of pii) spanMap.set(`${p.start}:${p.end}`, { start: p.start, end: p.end, quote: p.masked });
      return {
        risk,
        labels: [...labels],
        labelConfidences,
        articleIds: [...new Set(r.data.articleIds)],
        spans: [...spanMap.values()].sort((a, b) => a.start - b.start || a.end - b.end),
        pii,
        rationale: r.data.rationale,
        offline: false,
        model: r.model,
      };
    },

    async summarize(input, o) {
      const offline = offlineSummarize(input);
      if (!input.messages.length) return { ...offline, ...OFF };
      const subset = input.messages.slice(-MAX_SUMMARY_MESSAGES);
      const refToId = new Map<string, string>();
      const r = await ask(o, () => {
        let next = 1;
        const reports = input.minorityReports ?? [];
        for (const m of [...subset, ...reports]) {
          const k = /^K(\d+)$/.exec(m.pseudonym);
          if (k) next = Math.max(next, Number(k[1]) + 1);
        }
        const masker = new PseudonymMasker(next);
        const codes = new Map<string, string>();
        const codeOf = (pseudonym: string): string => {
          let code = /^K\d+$/.test(pseudonym) ? pseudonym : codes.get(pseudonym);
          if (!code) {
            code = `K${next++}`;
            codes.set(pseudonym, code);
          }
          return code;
        };
        const lines = subset.map((m, i) => {
          const ref = `m${i + 1}`;
          refToId.set(ref, m.id);
          return { ref, pseudonym: codeOf(m.pseudonym), group: clusterLabel(m.clusterId), stance: m.stance, body: sanitizeForModel((m.body ?? "").slice(0, MAX_MESSAGE_CHARS), masker) };
        });
        // Azınlık bağlamı: grup nüfusları (en küçük anlamlı grup işaretli), köprü testini geçemeyen gruplar, raporlar.
        const sizes = Object.entries(input.clusterSizes ?? {}).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
        const min = sizes.length >= 2 ? Math.min(...sizes.map(([, n]) => n)) : 0;
        const max = sizes.length >= 2 ? Math.max(...sizes.map(([, n]) => n)) : 0;
        const minority = {
          groups: sizes.length >= 2 ? sizes.map(([g, n]) => ({ group: clusterLabel(g), members: n, smallest: min < max && n === min })) : [],
          failed: (input.failedClusters ?? []).map((f) => ({ group: clusterLabel(f.clusterId), members: f.members, yes: f.yes, no: f.no })),
          reports: reports.map((r) => ({ pseudonym: codeOf(r.pseudonym), group: clusterLabel(r.clusterId), body: sanitizeForModel((r.body ?? "").slice(0, MAX_MESSAGE_CHARS), masker) })),
        };
        return summarizeRequest(sanitizeForModel(input.topicTitle, masker), lines, minority);
      });
      if (!r) return { ...offline, ...OFF };
      const mapPoints = (ps: { text: string; cites: string[] }[]) =>
        ps.map((p) => ({ text: p.text, cites: [...new Set(p.cites.map((c) => refToId.get(c)).filter((x): x is string => !!x))] }));
      const s = {
        commonGround: mapPoints(r.data.commonGround),
        contested: mapPoints(r.data.contested),
        minorityViews: mapPoints(r.data.minorityViews),
        openQuestions: mapPoints(r.data.openQuestions),
      };
      if (!s.minorityViews.length) s.minorityViews = offline.minorityViews;
      return { ...s, coverage: computeCoverage(s, input.messages), offline: false, model: r.model };
    },

    similar: (input, corpus, limit) => offlineSimilar(input, corpus, limit ?? 5),

    async bridgingDrafts(input, o) {
      const r = await ask(o, () => {
        const masker = new PseudonymMasker();
        const s = (x: string) => sanitizeForModel(x, masker);
        return bridgingRequest({ title: s(input.title), body: s(input.body), majorityPoints: input.majorityPoints.map(s), minorityPoints: input.minorityPoints.map(s) });
      });
      if (!r) return { ...offlineBridging(input), ...OFF };
      return { drafts: r.data.drafts, offline: false, model: r.model };
    },

    async lintExpertReport(text, o?: LintOptions) {
      const offline = offlineLint(text);
      const r = await ask(o, () => lintRequest(sanitizeForModel(text), (o?.domains ?? []).map((d) => sanitizeForModel(d))));
      if (!r) return { ...offline, ...OFF };
      // Hukuki nitelendirme kuralı belirlenimci olarak da uygulanır: yerel bulgular eklenir.
      const issues: { quote: string; kind: string; message: string }[] = [...r.data.issues];
      for (const x of offline.issues) {
        const dup = issues.some((y) => y.kind === x.kind && (y.quote.includes(x.quote) || x.quote.includes(y.quote) || overlaps(x.quote, y.quote)));
        if (!dup) issues.push(x);
      }
      return { issues, offline: false, model: r.model };
    },

    explainDecision,
  };
}

function dedupeBy<T>(xs: T[], key: (x: T) => string): T[] {
  const seen = new Map<string, T>();
  for (const x of xs) if (!seen.has(key(x))) seen.set(key(x), x);
  return [...seen.values()];
}

/** İki alıntı aynı ifadeyi mi gösteriyor (kısa olanın ilk 30 karakteri diğerinde geçiyorsa)? */
function overlaps(a: string, b: string): boolean {
  const [s, l] = a.length <= b.length ? [a, b] : [b, a];
  const head = s.replace(/[«»"…]/g, "").trim().slice(0, 30);
  return head.length >= 10 && l.includes(head);
}
