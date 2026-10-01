// Öneriler: oluşturma, sürümler, destek, oy (commit), itiraz, azınlık raporu, bilirkişi talebi, YZ danışmanlığı.
// Faz geçişleri LifecycleEngine'dedir; burada yalnızca yazarın submit/withdraw eylemleri geçiş yapar.
import {
  aiLabel,
  ceilMul,
  clusterLabel,
  fracAtLeast,
  fy,
  hashCanonical,
  rat,
  voteCommitment,
  type AiAnalysisInfo,
  type AuditReport,
  type BallotReceipt,
  type BulletinResponse,
  type CategoryNode,
  type CreateProposalRequest,
  type DecisionParams,
  type DeletionPayload,
  type ExpertQuestion,
  type Finding,
  type MinorityReport,
  type ObjectionRequest,
  type PrecheckResponse,
  type ProposalDetail,
  type ProposalListQuery,
  type ProposalSummary,
  type RightsFlagRequest,
  type Suggestion,
  type VoteChoice,
  type VoterListResponse,
} from "@forum/shared";
import { z } from "zod";
import { approveAnalysis, getAnalysis, PROMPT_VERSION } from "../ai";
import { DAY } from "../core/clock";
import type { AuthUser, ClassificationResult, ModerationResult, ProposalAuditInput, SummaryInputMessage } from "../core/contracts";
import { AppError, badRequest, conflict, forbidden, notFound, unprocessable } from "../core/errors";
import type { LifecycleEngine, MessageService, ProposalService, Viewer } from "../core/forum-contracts";
import { newId, newSalt } from "../core/ids";
import { json, type SqlValue } from "../db";
import { latestClusterOf, type ClusterServiceImpl } from "./clusters";
import { buildProposalDetail, receiptOf, visibleProposal } from "./detail";
import { applyTransition, auditInputFor, findingsSummary } from "./lifecycle";
import { assertNoPii, moderationContext } from "./messages";
import { bulletinRounds, evaluateObjections, firstRoundChoice } from "./tally";
import {
  ACTIVE_SQL,
  ALL_STATUSES,
  CLOSED_SQL,
  GORUS_AYRILIGI,
  checkLength,
  createProposalSchema,
  durationsOf,
  groundIsUrgent,
  hasRole,
  hoursToMs,
  isClosed,
  jsonList,
  normIri,
  parseInput,
  parseProposal,
  proposalLink,
  proposalRef,
  requireVerified,
  safe,
  textHash,
  voteChoiceSchema,
  type BallotRow,
  type ContentLabel,
  type CreateInput,
  type ForumCore,
  type MessageRow,
  type ProposalRow,
  type RightsFlag,
  type TopicRow,
} from "./util";
import { querySummaries, SUMMARY_COLUMNS, proposalSummaries, sponsorsNeeded, type SummaryRow } from "./views";

const OBJECTION_WINDOW_MS = 30 * DAY;
const OBJECTION_BUDGET = 2;
const SALAMI_WINDOW_MS = 30 * DAY;
const SALAMI_SCORE = 0.35;
const MAX_OPEN_DELETIONS = 3;
const MAX_DELETIONS_PER_DAY = 5;
const MAX_OPEN_SUGGESTIONS = 5;

interface Normalized {
  kind: CreateInput["kind"];
  title: string;
  body: string;
  categories: string[];
  parentTopicId: string | null;
  amendment: { baseVersion: number; newTitle: string; newBody: string } | null;
  deletion: DeletionPayload | null;
  patch: CreateInput["regulationPatch"] | null;
  requestExpert: boolean;
  parentTopic: TopicRow | null;
}

export interface ProposalParts {
  clusters: ClusterServiceImpl;
  messages: MessageService;
  lifecycle: () => LifecycleEngine;
}

const uniq = <T>(xs: T[]): T[] => [...new Set(xs)];

function flattenCategories(nodes: CategoryNode[], out: CategoryNode[] = []): CategoryNode[] {
  for (const n of nodes) {
    out.push(n);
    flattenCategories(n.children ?? [], out);
  }
  return out;
}

export function createProposalService(core: ForumCore, parts: ProposalParts): ProposalService {
  const { db, deps } = core;
  const { clusters, messages } = parts;

  // ───────────── Ontoloji / YZ bağlamı ─────────────

  function categoryList(): CategoryNode[] {
    return safe(() => flattenCategories(deps.ontology.categories()), []);
  }
  function classifyContext() {
    return {
      categories: categoryList().map((c) => ({ iri: c.iri, label: c.label, keywords: c.keywords ?? [] })),
      rights: safe(() => deps.ontology.rights(), []).map((r) => ({ iri: r.iri, label: r.label })),
      contentLabels: safe(() => deps.ontology.contentLabels(), []),
    };
  }
  async function moderate(actor: AuthUser, text: string): Promise<ModerationResult | null> {
    try {
      return await deps.ai.moderate(text, moderationContext(core), { forceOffline: !actor.aiConsent });
    } catch (e) {
      console.error("[forum] öneri moderasyonu başarısız:", e);
      return null;
    }
  }
  async function classify(actor: AuthUser, title: string, body: string): Promise<ClassificationResult | null> {
    try {
      return await deps.ai.classifyProposal({ title, body }, classifyContext(), { forceOffline: !actor.aiConsent });
    } catch (e) {
      console.error("[forum] öneri sınıflandırması başarısız:", e);
      return null;
    }
  }
  /** İçerik etiketleri: risk ≥ 1 ise her etiket için güven = min(0,95; 0,4 + 0,2·risk). Yalnız danışma. */
  function contentLabelsOf(m: ModerationResult | null): ContentLabel[] {
    if (!m || m.risk < 1) return [];
    const confidence = Math.min(0.95, Math.round((0.4 + 0.2 * m.risk) * 100) / 100);
    return uniq(m.labels).map((label) => ({ label, confidence, source: "ai" as const }));
  }
  /** YZ'nin kısıtlayıcı bulduğu haklar (güven ≥ 0,5) — "yalnızca yükseltme". */
  function aiRightsOf(c: ClassificationResult | null): RightsFlag[] {
    if (!c) return [];
    const out: RightsFlag[] = [];
    for (const r of c.rightsAffected) {
      if (r.direction === "restrict" && r.confidence >= 0.5 && !out.some((x) => x.right === r.right)) out.push({ right: r.right, direction: "restrict", source: "ai" });
    }
    return out;
  }
  function mergeFlags(base: RightsFlag[], add: RightsFlag[]): RightsFlag[] {
    const out = base.slice();
    for (const f of add) if (!out.some((x) => x.right === f.right && x.direction === f.direction && x.source === f.source)) out.push(f);
    return out;
  }

  function topicRow(id: string | null | undefined): TopicRow | null {
    if (!id) return null;
    return db.get<TopicRow>("SELECT * FROM topics WHERE id = ?", id) ?? null;
  }

  function activeExpertIn(userId: string, categories: string[]): boolean {
    const e = safe(() => deps.experts.get(userId), null);
    if (!e || e.status !== "active") return false;
    return e.domains.some((d) =>
      categories.some((c) => safe(() => deps.ontology.isSubCategoryOf(c, d) || deps.ontology.isSubCategoryOf(d, c), c === d)),
    );
  }

  // ───────────── Girdi normalleştirme ─────────────

  /** strict=false: ön denetim için hoşgörülü (uzunluk/başvuru hataları atlanır, ontoloji bulgu olarak gösterir). */
  function normalize(actor: AuthUser, input: CreateInput, strict: boolean): Normalized {
    const kind = input.kind;
    let title = input.title.trim();
    let body = input.body.trim();
    const known = new Set(categoryList().map((c) => c.iri));
    let categories = uniq(input.categories.map(normIri));
    const unknown = categories.filter((c) => !known.has(c));
    if (unknown.length > 0) {
      if (strict) throw badRequest("validation", `Bilinmeyen kategori: ${unknown.join(", ")}`, [{ path: "categories", message: "bilinmeyen kategori" }]);
      categories = categories.filter((c) => known.has(c));
    }
    let parentTopic: TopicRow | null = null;
    let parentTopicId: string | null = null;
    let amendment: Normalized["amendment"] = null;
    let deletion: DeletionPayload | null = null;
    let patch: Normalized["patch"] = null;

    if (kind === "subtopic" || kind === "amendment") {
      parentTopic = topicRow(input.parentTopicId);
      if (!parentTopic) {
        if (strict) throw notFound(kind === "subtopic" ? "Üst konu" : "Hedef konu");
      } else {
        if (strict && parentTopic.status !== "active") throw conflict("invalid_state", "Hedef konu yürürlükte (etkin) değil.");
        parentTopicId = parentTopic.id;
        categories = uniq([...json<string[]>(parentTopic.categories, []), ...categories]);
      }
      if (kind === "amendment") {
        const current = Number(parentTopic?.current_version ?? 1);
        const base = input.amendment?.baseVersion ?? (strict ? undefined : current);
        if (base === undefined) throw badRequest("validation", "Düzenleme teklifi için dayandığı konu sürümü (amendment.baseVersion) zorunludur.", [{ path: "amendment.baseVersion", message: "zorunlu" }]);
        if (strict && base !== current) {
          throw conflict("version_conflict", `Konu bu arada güncellendi (güncel sürüm ${current}); teklifinizi güncel metne göre yeniden hazırlayın.`, { currentVersion: current });
        }
        amendment = { baseVersion: base, newTitle: title, newBody: body };
      }
    } else if (kind === "deletion") {
      const d = input.deletion;
      if (!d) throw badRequest("validation", "Silme talebi için mesajlar ve gerekçe (deletion) zorunludur.", [{ path: "deletion", message: "zorunlu" }]);
      const ground = normIri(d.ground);
      const grounds = safe(() => deps.ontology.deletionGrounds(), []).map((g) => g.iri);
      if (!grounds.includes(ground) && ground !== GORUS_AYRILIGI) {
        throw badRequest("validation", "Geçersiz silme gerekçesi; yönetmelikteki gerekçelerden biri seçilmelidir.", [{ path: "deletion.ground", message: "geçersiz" }]);
      }
      const ids = uniq(d.messageIds);
      const rows = db.all<MessageRow>("SELECT * FROM messages WHERE id IN (SELECT value FROM json_each(?))", jsonList(ids));
      if (rows.length !== ids.length) throw notFound("Hedef mesaj");
      const first = rows[0];
      if (strict) {
        if (rows.some((m) => m.thread_type !== first.thread_type || m.thread_id !== first.thread_id)) {
          throw unprocessable("invalid_target", "Bir silme talebindeki tüm mesajlar aynı tartışmada olmalıdır.");
        }
        if (rows.some((m) => m.author_id !== first.author_id)) {
          throw unprocessable("invalid_target", "Bir silme talebi yalnızca tek bir yazarın mesajlarını kapsayabilir.");
        }
        if (rows.some((m) => m.visibility === "hidden" || m.visibility === "sealed")) throw conflict("invalid_state", "Seçilen mesajlardan biri zaten gizlenmiş.");
        if (first.author_id === actor.id) throw unprocessable("own_message", "Kendi mesajınız için silme talebi açamazsınız; mesajınızı düzenleyebilirsiniz.");
        const open = db.all<{ seq: number; deletion_payload: string }>(
          `SELECT seq, deletion_payload FROM proposals WHERE kind = 'deletion' AND status IN ${ACTIVE_SQL}`,
        );
        for (const o of open) {
          const targets = new Set(json<{ messageIds?: string[] }>(o.deletion_payload, {}).messageIds ?? []);
          if (ids.some((id) => targets.has(id))) throw conflict("already_requested", `Bu mesaj için zaten açık bir silme talebi var (#K-${o.seq}).`);
        }
        const now = core.now();
        const lim = db.get<{ open: number; day: number }>(
          `SELECT SUM(CASE WHEN status NOT IN ${CLOSED_SQL} THEN 1 ELSE 0 END) AS open,
                  SUM(CASE WHEN created_at > ? THEN 1 ELSE 0 END) AS day
             FROM proposals WHERE kind = 'deletion' AND author_id = ?`,
          now - DAY,
          actor.id,
        );
        if (Number(lim?.open ?? 0) >= MAX_OPEN_DELETIONS) {
          throw unprocessable("deletion_limit", `Aynı anda en çok ${MAX_OPEN_DELETIONS} açık silme talebiniz olabilir.`);
        }
        if (Number(lim?.day ?? 0) >= MAX_DELETIONS_PER_DAY) {
          throw unprocessable("deletion_limit", `Son 24 saatte en çok ${MAX_DELETIONS_PER_DAY} silme talebi açabilirsiniz.`);
        }
      }
      let threadCats: string[] = [];
      if (first.thread_type === "topic") {
        const t = topicRow(first.thread_id);
        threadCats = json<string[]>(t?.categories ?? null, []);
        parentTopicId = t?.id ?? null;
      } else {
        threadCats = json<string[]>(db.get<{ categories: string }>("SELECT categories FROM proposals WHERE id = ?", first.thread_id)?.categories ?? null, []);
      }
      categories = uniq([...threadCats, ...categories]);
      const statement = d.statement.trim();
      if (strict) checkLength(statement, 20, 5000, "deletion.statement", "Silme gerekçesi açıklaması");
      if (!title) title = `Silme talebi: ${ids.length} mesaj`;
      if (!body) body = statement;
      deletion = { messageIds: ids, ground, statement };
    } else if (kind === "regulation") {
      patch = input.regulationPatch ?? null;
      if (!patch && strict) throw badRequest("validation", "Yönetmelik değişikliği için yama (regulationPatch) zorunludur.", [{ path: "regulationPatch", message: "zorunlu" }]);
      const reg = fy("ForumYonetmeligi");
      if (categories.length === 0 && known.has(reg)) categories = [reg];
    }
    if (strict) {
      title = checkLength(title, 5, 200, "title", "Başlık");
      body = checkLength(body, 20, 20000, "body", "Metin");
      if (categories.length === 0) throw badRequest("validation", "En az bir geçerli kategori seçilmelidir.", [{ path: "categories", message: "boş" }]);
    }
    if (amendment) amendment = { ...amendment, newTitle: title, newBody: body };
    return { kind, title, body, categories, parentTopicId, amendment, deletion, patch, requestExpert: !!input.requestExpert, parentTopic };
  }

  function auditInputOf(n: Normalized, rights: RightsFlag[], labels: ContentLabel[]): ProposalAuditInput {
    return {
      kind: n.kind,
      title: n.title,
      body: n.body,
      categories: n.categories,
      rightsAffected: rights,
      contentLabels: labels,
      parentTopic: n.parentTopic ? { id: n.parentTopic.id, categories: json<string[]>(n.parentTopic.categories, []), status: n.parentTopic.status } : null,
      amendment: n.amendment ? { baseVersion: n.amendment.baseVersion, currentVersion: Number(n.parentTopic?.current_version ?? 0) } : null,
      deletion: n.deletion ? { ground: n.deletion.ground, messageCount: n.deletion.messageIds.length } : null,
      regulationPatch: n.patch ?? null,
      requestExpert: n.requestExpert,
      verifiedMembers: core.verifiedCount(),
    };
  }

  // ───────────── Yardımcılar ─────────────

  const detail = (id: string, viewer: Viewer): ProposalDetail => buildProposalDetail(core, clusters, visibleProposal(core, id, viewer), viewer);

  function requireAuthor(p: ProposalRow, actor: AuthUser): void {
    if (p.author_id !== actor.id) throw forbidden("Bu işlemi yalnızca önerinin yazarı yapabilir.");
  }

  function requireStatus(p: ProposalRow, allowed: string[], msg: string): void {
    if (!allowed.includes(p.status)) throw conflict("invalid_state", msg, { status: p.status });
  }

  function isEligible(proposalId: string, userId: string): boolean {
    return !!db.get("SELECT 1 FROM eligible_voters WHERE proposal_id = ? AND user_id = ?", proposalId, userId);
  }

  /** Oy/itiraz için güncel seçmen koşulları (rıza geri çekilmiş olabilir; askıdaki üye oy veremez). */
  function requireVoter(p: ProposalRow, actor: AuthUser): void {
    requireVerified(actor, "Oy vermek");
    const me = core.user(actor.id);
    if (!me || me.status !== "verified") throw forbidden("Askıdaki ya da silinmiş üye bu işlemi yapamaz.");
    if (!isEligible(p.id, actor.id)) {
      throw unprocessable("not_eligible", "Bu oylamanın uygun seçmen listesinde değilsiniz (liste oylama açılışında dondurulur).");
    }
    if (me.political_consent !== 1) {
      throw unprocessable("consent_required", "Oy ve görüş bildirmek için siyasi görüş açık rızası gerekir; rızanızı ayarlardan verebilirsiniz.");
    }
  }

  function phaseOpen(p: ProposalRow): boolean {
    return p.phase_ends_at !== null && core.now() < p.phase_ends_at;
  }

  function threadMessagesForAi(p: ProposalRow): { rows: MessageRow[]; consent: Map<string, boolean> } {
    const rows = db.all<MessageRow>(
      "SELECT * FROM messages WHERE thread_type = 'proposal' AND thread_id = ? AND visibility = 'visible' ORDER BY seq ASC",
      p.id,
    );
    const consent = new Map(
      db
        .all<{ id: string; ai_consent: number }>("SELECT id, ai_consent FROM users WHERE id IN (SELECT value FROM json_each(?))", jsonList([...rows.map((r) => r.author_id), p.author_id]))
        .map((u) => [u.id, u.ai_consent === 1] as const),
    );
    return { rows, consent };
  }

  /** Yeni sürüm (update, öneri kabulü, YZ taslağı onayı). deliberation/reconciliation'da yeniden denetim. */
  async function applyRevision(
    actor: AuthUser,
    p: ProposalRow,
    rev: { title: string; body: string; acknowledgePii?: boolean; viaSuggestionId?: string | null; versionAuthorId?: string; onCommit?: () => void },
  ): Promise<void> {
    requireStatus(p, ["draft", "deliberation", "reconciliation"], p.status === "sponsoring"
      ? "Destekçi toplama sürerken metin değiştirilemez: destekçiler belirli bir metni imzaladı. Değiştirmek için öneriyi geri çekip yeniden açın."
      : "Metin yalnızca taslakta, tartışma ve uzlaşma evrelerinde değiştirilebilir (oylama başlarken kilitlenir).");
    const title = checkLength(rev.title, 5, 200, "title", "Başlık");
    const body = checkLength(rev.body, 20, 20000, "body", "Metin");
    if (title === p.title && body === p.body) return;
    assertNoPii(core, `${title}\n${body}`, rev.acknowledgePii);
    const mod = await moderate(actor, `${title}\n${body}`);
    const labels = contentLabelsOf(mod);
    const parsed = parseProposal(p);
    const rights = mergeFlags(parsed.rightsFlags, aiRightsOf(await classify(actor, title, body)));
    let report: AuditReport | null = null;
    if (p.status !== "draft") {
      report = await deps.ontology.audit(auditInputFor(core, p, { title, body, rightsFlags: rights, contentLabels: labels }));
      if (!report.admissible) {
        throw unprocessable("inadmissible_revision", `Revizyon yönetmeliğe aykırı; önceki metin geçerli kalır. ${findingsSummary(report)}`, {
          violations: report.violations,
        });
      }
      const fixed = parsed.fixedParams;
      if (p.status === "reconciliation" && fixed && report.tier !== fixed.tier) {
        throw unprocessable(
          "inadmissible_revision",
          `Revizyon kararın katmanını değiştiriyor (${fixed.tier} → ${report.tier}); uzlaşma revizyonu sabitlenmiş parametreleri değiştiremez. Önceki metin geçerli kalır.`,
          { violations: [], tier: report.tier },
        );
      }
    }
    core.tx(() => {
      const cur = core.requireProposal(p.id);
      if (cur.version !== p.version || cur.status !== p.status) throw conflict("version_conflict", "Öneri bu arada değişti; sayfayı yenileyip tekrar deneyin.");
      const now = core.now();
      const version = cur.version + 1;
      const hash = textHash(title, body);
      db.run(
        "INSERT INTO proposal_versions(proposal_id, version, title, body, author_id, via_suggestion_id, content_hash, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)",
        p.id,
        version,
        title,
        body,
        rev.versionAuthorId ?? actor.id,
        rev.viaSuggestionId ?? null,
        hash,
        now,
      );
      const set: Record<string, SqlValue> = {
        title,
        body,
        version,
        content_labels: JSON.stringify(labels),
        rights_flags: JSON.stringify(rights),
        updated_at: now,
      };
      if (report) {
        set.audit_report = JSON.stringify(report);
        if (!parsed.fixedParams) set.tier = report.tier;
      }
      if (cur.kind === "amendment" && parsed.amendment) set.amendment_payload = JSON.stringify({ ...parsed.amendment, newTitle: title, newBody: body });
      core.updateProposal(p.id, set);
      const tx = core.submit("PROPOSAL_VERSION", { proposalId: p.id, version, contentHash: hash });
      db.run("UPDATE proposal_versions SET ledger_tx = ? WHERE proposal_id = ? AND version = ?", tx, p.id, version);
      rev.onCommit?.();
      if (cur.status !== "draft") {
        const sponsors = db.all<{ user_id: string }>("SELECT user_id FROM proposal_sponsors WHERE proposal_id = ?", p.id).map((r) => r.user_id);
        core.notify(
          sponsors.filter((u) => u !== actor.id),
          { kind: "proposal_version", title: `${proposalRef(cur)} metni güncellendi`, body: `“${title}” için sürüm ${version} yayımlandı.`, link: proposalLink(p.id) },
        );
      }
    });
  }

  async function pokeSafely(id: string): Promise<void> {
    try {
      await parts.lifecycle().poke(id);
    } catch (e) {
      console.error("[forum] lifecycle.poke başarısız:", e);
    }
  }

  // ───────────── Hizmet ─────────────

  const service: ProposalService = {
    list(query: ProposalListQuery, viewer: Viewer): ProposalSummary[] {
      const q = parseInput(
        z.object({
          status: z.enum(["open", "closed", ...ALL_STATUSES] as unknown as [string, ...string[]]).optional(),
          kind: z.enum(["topic", "subtopic", "amendment", "deletion", "regulation"]).optional(),
          q: z.string().max(200).optional(),
          topicId: z.string().max(200).optional(),
          authorId: z.string().max(200).optional(),
          mine: z.coerce.boolean().optional(),
          limit: z.coerce.number().int().min(1).max(1000).optional(),
        }),
        query ?? {},
      );
      const where: string[] = ["(p.status <> 'draft' OR p.author_id = ?)"];
      const params: (string | number | null)[] = [viewer?.id ?? null];
      if (q.status === "open") where.push(`(p.status IN ${ACTIVE_SQL} OR p.status = 'draft')`);
      else if (q.status === "closed") where.push(`p.status IN ${CLOSED_SQL}`);
      else if (q.status) {
        where.push("p.status = ?");
        params.push(q.status);
      }
      if (q.kind) {
        where.push("p.kind = ?");
        params.push(q.kind);
      }
      if (q.topicId) {
        where.push("p.parent_topic_id = ?");
        params.push(q.topicId);
      }
      if (q.authorId) {
        where.push("p.author_id = ?");
        params.push(q.authorId);
      }
      if (q.mine) {
        if (!viewer) return [];
        where.push("p.author_id = ?");
        params.push(viewer.id);
      }
      const limit = q.limit ?? 200;
      const needle = q.q?.trim().toLocaleLowerCase("tr-TR");
      if (!needle) return querySummaries(core, where.join(" AND "), params, `ORDER BY p.seq DESC LIMIT ${limit}`);
      // Türkçe büyük/küçük harf duyarsız arama (SQLite LIKE yalnız ASCII'yi katlar).
      const rows = db
        .all<SummaryRow>(`SELECT ${SUMMARY_COLUMNS} FROM proposals p WHERE ${where.join(" AND ")} ORDER BY p.seq DESC`, ...params)
        .filter((r) => r.title.toLocaleLowerCase("tr-TR").includes(needle))
        .slice(0, limit);
      return proposalSummaries(core, rows);
    },

    get(id: string, viewer: Viewer): ProposalDetail {
      return detail(id, viewer);
    },

    async precheck(actor: AuthUser, raw: CreateProposalRequest): Promise<PrecheckResponse> {
      requireVerified(actor, "Ön denetim");
      const input = parseInput(createProposalSchema, raw);
      const n = normalize(actor, input, false);
      const now = core.now();
      const text = `${n.title}\n${n.body}${n.deletion ? `\n${n.deletion.statement}` : ""}`;
      const [mod, cls] = await Promise.all([moderate(actor, text), classify(actor, n.title, n.body)]);
      const labels = contentLabelsOf(mod);
      const aiRights = aiRightsOf(cls);
      let audit = await deps.ontology.audit(auditInputOf(n, aiRights, labels));
      if (n.kind === "regulation" && n.patch) {
        const pr = await deps.ontology.validatePatch(n.patch);
        const key = (f: Finding) => `${f.code}|${f.message}`;
        const merge = (a: Finding[], b: Finding[]) => [...a, ...b.filter((f) => !a.some((x) => key(x) === key(f)))];
        audit = {
          ...audit,
          admissible: audit.admissible && pr.admissible,
          violations: merge(audit.violations, pr.violations),
          warnings: merge(audit.warnings, pr.warnings),
          infos: merge(audit.infos, pr.infos),
        };
      }
      const model = cls?.model ?? deps.ai.model();
      const labelOf = (iri: string) => safe(() => deps.ontology.categoryLabel(iri), iri);
      const rightLabels = new Map(safe(() => deps.ontology.rights(), []).map((r) => [r.iri, r.label] as const));

      // Benzer öneriler (taslaklar yalnız yazarına).
      const corpusRows = db.all<{ id: string; seq: number; title: string; body: string; status: ProposalRow["status"]; author_id: string; created_at: number }>(
        "SELECT id, seq, title, body, status, author_id, created_at FROM proposals WHERE status <> 'draft' OR author_id = ? ORDER BY seq",
        actor.id,
      );
      const byId = new Map(corpusRows.map((r) => [r.id, r] as const));
      const corpus = corpusRows.map((r) => ({ id: r.id, title: r.title, body: r.body }));
      const similar = (corpus.length ? deps.ai.similar({ title: n.title, body: n.body }, corpus, 5) : [])
        .filter((s) => byId.has(s.id))
        .map((s) => {
          const r = byId.get(s.id)!;
          return { id: r.id, seq: Number(r.seq), title: r.title, status: r.status, score: Math.round(s.score * 1000) / 1000, sameAuthor: r.author_id === actor.id };
        });

      const warnings: string[] = [];
      const recentOwn = corpusRows.filter((r) => r.author_id === actor.id && r.created_at >= now - SALAMI_WINDOW_MS);
      if (recentOwn.length > 0 && (n.title || n.body)) {
        const own = deps.ai
          .similar({ title: n.title, body: n.body }, recentOwn.map((r) => ({ id: r.id, title: r.title, body: r.body })), recentOwn.length)
          .filter((s) => s.score >= SALAMI_SCORE);
        if (own.length > 0) {
          const refs = own.map((s) => `#K-${byId.get(s.id)?.seq}`).join(", ");
          warnings.push(
            `Aynı yazarın benzer önerileri var (${refs}): büyük bir değişikliği küçük parçalara bölmek (salam taktiği) bilirkişi ve topluluk incelemesini zayıflatır. Bu öneriler birlikte değerlendirilmeli; hak etkisi bayrakları ve katman, toplam etkiye göre belirlenebilir.`,
          );
        }
      }
      const pii = deps.ai.detectPii(text).map((f) => ({ kind: f.kind, start: f.start, end: f.end, masked: f.masked }));
      if (pii.length > 0) warnings.push("Metinde kişisel veri olabilecek ifadeler var; göndermeden önce kaldırmanız önerilir.");
      if (aiRights.length > 0) {
        warnings.push(
          `Yapay zekâ bu önerinin şu hakları kısıtlayabileceğini değerlendirdi: ${aiRights.map((r) => rightLabels.get(r.right) ?? r.right).join(", ")}. Hak etkisi bayrakları yalnızca yükseltir; yalnızca bilirkişi kaldırabilir.`,
        );
      }
      if (n.kind === "amendment" && n.parentTopic && n.amendment && n.amendment.baseVersion !== Number(n.parentTopic.current_version)) {
        warnings.push(`Konu bu arada güncellendi (güncel sürüm ${n.parentTopic.current_version}); teklif güncel sürüme dayanmalıdır.`);
      }
      if (n.kind === "deletion" && n.deletion?.ground === GORUS_AYRILIGI) {
        warnings.push("Görüş ayrılığı geçerli bir silme gerekçesi değildir (değiştirilemez madde); talep denetimde reddedilir.");
      }
      return {
        audit,
        classification: {
          categories: (cls?.categories ?? []).map((c) => ({ iri: c.iri, label: labelOf(c.iri), confidence: c.confidence })),
          rightsAffected: (cls?.rightsAffected ?? []).map((r) => ({ right: r.right, label: rightLabels.get(r.right) ?? r.right, direction: r.direction, confidence: r.confidence })),
          contentLabels: (cls?.contentLabels ?? []).map((c) => ({ label: c.label, confidence: c.confidence })),
          rationale: cls?.rationale ?? "Sınıflandırma şu an yapılamadı.",
          offline: cls?.offline ?? true,
          model,
          aiLabel: aiLabel(model, now),
        },
        similar,
        pii,
        warnings,
        sponsorsRequired: sponsorsNeeded(core, { ks: audit.params?.sponsorsRequired ?? null, tier: audit.tier, kind: n.kind }),
      };
    },

    async create(actor: AuthUser, raw: CreateProposalRequest): Promise<ProposalDetail> {
      requireVerified(actor, "Öneri oluşturmak");
      const input = parseInput(createProposalSchema, raw);
      const n = normalize(actor, input, true);
      assertNoPii(core, `${n.title}\n${n.body}${n.deletion ? `\n${n.deletion.statement}` : ""}`, input.acknowledgePii);
      const [mod, cls] = await Promise.all([moderate(actor, `${n.title}\n${n.body}`), classify(actor, n.title, n.body)]);
      const labels = contentLabelsOf(mod);
      const rights = aiRightsOf(cls);
      const id = newId();
      core.tx(() => {
        const now = core.now();
        const seq = db.nextSeq("proposals");
        const hash = textHash(n.title, n.body);
        db.run(
          `INSERT INTO proposals(id, seq, kind, title, body, author_id, parent_topic_id, amendment_payload, deletion_payload, regulation_patch,
             categories, rights_flags, request_expert, status, version, content_labels, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'draft', 1, ?, ?, ?)`,
          id,
          seq,
          n.kind,
          n.title,
          n.body,
          actor.id,
          n.parentTopicId,
          n.amendment ? JSON.stringify(n.amendment) : null,
          n.deletion ? JSON.stringify(n.deletion) : null,
          n.patch ? JSON.stringify(n.patch) : null,
          JSON.stringify(n.categories),
          JSON.stringify(rights),
          n.requestExpert ? 1 : 0,
          JSON.stringify(labels),
          now,
          now,
        );
        db.run(
          "INSERT INTO proposal_versions(proposal_id, version, title, body, author_id, content_hash, created_at) VALUES (?, 1, ?, ?, ?, ?, ?)",
          id,
          n.title,
          n.body,
          actor.id,
          hash,
          now,
        );
        const tx = core.submit("PROPOSAL_CREATED", { proposalId: id, seq, kind: n.kind, contentHash: hash, parentTopicId: n.parentTopicId });
        db.run("UPDATE proposal_versions SET ledger_tx = ? WHERE proposal_id = ? AND version = 1", tx, id);
      });
      if (input.submit) return service.submit(actor, id);
      return detail(id, actor);
    },

    async submit(actor: AuthUser, id: string): Promise<ProposalDetail> {
      requireVerified(actor, "Öneri göndermek");
      const p = visibleProposal(core, id, actor);
      requireAuthor(p, actor);
      requireStatus(p, ["draft"], "Yalnızca taslak öneri gönderilebilir.");
      const report = await deps.ontology.audit(auditInputFor(core, p));
      core.tx(() => {
        const cur = core.requireProposal(id);
        if (cur.status !== "draft" || cur.version !== p.version) throw conflict("version_conflict", "Öneri bu arada değişti; tekrar deneyin.");
        const now = core.now();
        const hours = report.params?.durationsHours.sponsoring ?? durationsOf(cur).sponsoring;
        applyTransition(core, cur, "sponsoring", "Yazar öneriyi destekçi toplamaya gönderdi.", {
          now,
          endsAt: now + hoursToMs(hours),
          set: { audit_report: JSON.stringify(report), tier: report.tier },
        });
        const d = parseProposal(cur).deletion;
        if (cur.kind === "deletion" && d) {
          if (groundIsUrgent(deps, d.ground)) messages.collapse(d.messageIds, cur.id);
          const target = db.get<{ author_id: string }>("SELECT author_id FROM messages WHERE id = ?", d.messageIds[0])?.author_id;
          if (target) {
            core.notify([target], {
              kind: "deletion_request",
              title: "Mesajınız için silme talebi açıldı",
              body: `${proposalRef(cur)} mesajınızın gizlenmesini istiyor. Mesajınızı düzenleyebilir ve tartışmaya katılabilirsiniz; karar oylamayla verilir.`,
              link: proposalLink(cur.id),
            });
          }
        }
      });
      return detail(id, actor);
    },

    async sponsor(actor: AuthUser, id: string): Promise<ProposalDetail> {
      requireVerified(actor, "Öneriyi desteklemek");
      const p = visibleProposal(core, id, actor);
      requireStatus(p, ["sponsoring"], "Öneri destekçi toplama evresinde değil.");
      if (!phaseOpen(p)) throw conflict("invalid_state", "Destekçi toplama süresi doldu.");
      if (p.author_id === actor.id) throw unprocessable("own_proposal", "Kendi önerinizi destekleyemezsiniz.");
      let count = 0;
      core.tx(() => {
        const exists = db.get("SELECT 1 FROM proposal_sponsors WHERE proposal_id = ? AND user_id = ?", id, actor.id);
        if (exists) throw conflict("already_sponsored", "Bu öneriyi zaten desteklediniz.");
        const now = core.now();
        db.run("INSERT INTO proposal_sponsors(proposal_id, user_id, at) VALUES (?, ?, ?)", id, actor.id, now);
        count = Number(db.get<{ c: number }>("SELECT COUNT(*) AS c FROM proposal_sponsors WHERE proposal_id = ?", id)?.c ?? 0);
        const tx = core.submit("SPONSORED", { proposalId: id, count });
        db.run("UPDATE proposal_sponsors SET ledger_tx = ? WHERE proposal_id = ? AND user_id = ?", tx, id, actor.id);
        const need = sponsorsNeeded(core, { ks: parseProposal(p).audit?.params?.sponsorsRequired ?? null, tier: p.tier, kind: p.kind });
        core.notify([p.author_id], {
          kind: "proposal_sponsored",
          title: `${proposalRef(p)} yeni destek aldı`,
          body: `“${p.title}” ${count}/${need} destekçiye ulaştı.`,
          link: proposalLink(id),
        });
      });
      const need = sponsorsNeeded(core, { ks: parseProposal(p).audit?.params?.sponsorsRequired ?? null, tier: p.tier, kind: p.kind });
      if (count >= need) await pokeSafely(id);
      return detail(id, actor);
    },

    async withdraw(actor: AuthUser, id: string): Promise<ProposalDetail> {
      requireVerified(actor, "Öneriyi geri çekmek");
      const p = visibleProposal(core, id, actor);
      requireAuthor(p, actor);
      requireStatus(p, ["draft", "sponsoring", "deliberation"], "Öneri yalnızca oylama başlamadan önce geri çekilebilir.");
      core.tx(() => {
        const cur = core.requireProposal(id);
        if (!["draft", "sponsoring", "deliberation"].includes(cur.status)) throw conflict("invalid_state", "Öneri yalnızca oylama başlamadan önce geri çekilebilir.");
        const reason = "Yazar öneriyi geri çekti.";
        applyTransition(core, cur, "withdrawn", reason, { now: core.now(), endsAt: null, set: { final_reason: reason } });
        const d = parseProposal(cur).deletion;
        if (cur.kind === "deletion" && d) messages.uncollapse(d.messageIds, cur.id);
        const sponsors = db.all<{ user_id: string }>("SELECT user_id FROM proposal_sponsors WHERE proposal_id = ?", id).map((r) => r.user_id);
        core.notify(sponsors, { kind: "proposal_phase", title: `${proposalRef(cur)} geri çekildi`, body: `“${cur.title}” yazarı tarafından geri çekildi.`, link: proposalLink(id) });
      });
      return detail(id, actor);
    },

    async update(actor: AuthUser, id: string, input: { title: string; body: string; acknowledgePii?: boolean }): Promise<ProposalDetail> {
      requireVerified(actor, "Öneriyi düzenlemek");
      const data = parseInput(z.object({ title: z.string().max(1000), body: z.string().max(40000), acknowledgePii: z.boolean().optional() }), input);
      const p = visibleProposal(core, id, actor);
      requireAuthor(p, actor);
      await applyRevision(actor, p, { title: data.title, body: data.body, acknowledgePii: data.acknowledgePii });
      return detail(id, actor);
    },

    suggest(actor: AuthUser, id: string, bodyIn: string): Suggestion {
      requireVerified(actor, "Metin önerisi");
      const p = visibleProposal(core, id, actor);
      requireStatus(p, ["deliberation"], "Metin önerileri yalnızca tartışma evresinde yapılabilir.");
      if (p.author_id === actor.id) throw unprocessable("own_proposal", "Yazar olarak metni doğrudan düzenleyebilirsiniz.");
      const body = checkLength(String(bodyIn ?? ""), 10, 20000, "body", "Önerilen metin");
      assertNoPii(core, body, false);
      const open = Number(
        db.get<{ c: number }>("SELECT COUNT(*) AS c FROM proposal_suggestions WHERE proposal_id = ? AND author_id = ? AND status = 'open'", id, actor.id)?.c ?? 0,
      );
      if (open >= MAX_OPEN_SUGGESTIONS) throw unprocessable("suggestion_limit", `Bu öneride en çok ${MAX_OPEN_SUGGESTIONS} açık metin öneriniz olabilir.`);
      const sid = newId();
      const now = core.now();
      core.tx(() => {
        db.run("INSERT INTO proposal_suggestions(id, proposal_id, author_id, body, status, created_at) VALUES (?, ?, ?, ?, 'open', ?)", sid, id, actor.id, body, now);
        core.notify([p.author_id], {
          kind: "proposal_suggestion",
          title: `${proposalRef(p)} için metin önerisi`,
          body: `${actor.nickname} metne bir değişiklik önerdi. Kabul ederseniz yeni sürüm oluşur ve öneren anılır.`,
          link: proposalLink(id),
        });
      });
      return { id: sid, proposalId: id, authorId: actor.id, authorNickname: actor.nickname, body, status: "open", createdAt: now, decidedAt: null };
    },

    async decideSuggestion(actor: AuthUser, id: string, suggestionId: string, decision: "accept" | "reject"): Promise<ProposalDetail> {
      requireVerified(actor, "Metin önerisi kararı");
      if (decision !== "accept" && decision !== "reject") throw badRequest("validation", "Karar 'accept' ya da 'reject' olmalıdır.");
      const p = visibleProposal(core, id, actor);
      requireAuthor(p, actor);
      const s = db.get<{ id: string; author_id: string; body: string; status: string }>(
        "SELECT id, author_id, body, status FROM proposal_suggestions WHERE id = ? AND proposal_id = ?",
        suggestionId,
        id,
      );
      if (!s) throw notFound("Metin önerisi");
      if (s.status !== "open") throw conflict("already_decided", "Bu metin önerisi için zaten karar verildi.");
      const mark = (status: "accepted" | "rejected") => {
        const r = db.run("UPDATE proposal_suggestions SET status = ?, decided_at = ? WHERE id = ? AND status = 'open'", status, core.now(), suggestionId);
        if (r.changes !== 1) throw conflict("already_decided", "Bu metin önerisi için zaten karar verildi.");
        core.notify([s.author_id], {
          kind: "proposal_suggestion",
          title: status === "accepted" ? `${proposalRef(p)}: öneriniz kabul edildi` : `${proposalRef(p)}: öneriniz reddedildi`,
          body:
            status === "accepted"
              ? "Metin öneriniz yeni sürüm olarak eklendi; sürüm geçmişinde adınızla anılıyor."
              : "Öneriniz herkese açık kalır. İsterseniz bunu ayrı bir öneri olarak açabilirsiniz.",
          link: proposalLink(id),
        });
      };
      if (decision === "reject") {
        core.tx(() => mark("rejected"));
      } else {
        requireStatus(p, ["deliberation", "reconciliation"], "Metin önerisi yalnızca tartışma ya da uzlaşma evresinde kabul edilebilir.");
        await applyRevision(actor, p, { title: p.title, body: s.body, viaSuggestionId: s.id, versionAuthorId: s.author_id, onCommit: () => mark("accepted") });
      }
      return detail(id, actor);
    },

    async flagRight(actor: AuthUser, id: string, input: RightsFlagRequest): Promise<ProposalDetail> {
      requireVerified(actor, "Hak etkisi bayrağı");
      const data = parseInput(z.object({ right: z.string().min(1).max(500), direction: z.enum(["restrict", "expand"]), remove: z.boolean().optional() }), input);
      const right = normIri(data.right);
      if (!safe(() => deps.ontology.rights(), []).some((r) => r.iri === right)) {
        throw badRequest("validation", "Bilinmeyen temel hak.", [{ path: "right", message: "bilinmeyen" }]);
      }
      const p = visibleProposal(core, id, actor);
      requireStatus(p, ["sponsoring", "deliberation"], "Hak etkisi bayrakları destekçi toplama ve tartışma evrelerinde değiştirilebilir.");
      const parsed = parseProposal(p);
      const isExpert = activeExpertIn(actor.id, parsed.categories);
      let flags: RightsFlag[];
      let source: RightsFlag["source"] | null = null;
      if (data.remove) {
        if (!isExpert && !hasRole(actor, "admin")) {
          throw forbidden("Hak etkisi bayrağını yalnızca ilgili alandaki bilirkişi ya da yönetici kaldırabilir (yalnızca yükseltme kuralı).");
        }
        flags = parsed.rightsFlags.filter((f) => !(f.right === right && f.direction === data.direction));
        if (flags.length === parsed.rightsFlags.length) return detail(id, actor);
      } else {
        source = actor.id === p.author_id ? "author" : isExpert ? "expert" : "member";
        if (parsed.rightsFlags.some((f) => f.right === right && f.direction === data.direction && f.source === source)) return detail(id, actor);
        flags = [...parsed.rightsFlags, { right, direction: data.direction, source }];
      }
      const report = await deps.ontology.audit(auditInputFor(core, p, { rightsFlags: flags }));
      core.tx(() => {
        const cur = core.requireProposal(id);
        if (cur.rights_flags !== p.rights_flags || cur.status !== p.status) throw conflict("version_conflict", "Öneri bu arada değişti; tekrar deneyin.");
        const set: Record<string, SqlValue> = { rights_flags: JSON.stringify(flags), audit_report: JSON.stringify(report), updated_at: core.now() };
        if (!parsed.fixedParams) set.tier = report.tier;
        if (cur.status === "deliberation" && report.params?.requiresExpert && cur.expert_draw_height === null && !safe(() => deps.experts.panel(id), null)) {
          set.expert_draw_height = deps.ledger.latestBlock().height + 1;
        }
        core.updateProposal(id, set);
        core.audit.log(actor.id, data.remove ? "proposal.rights_flag_removed" : "proposal.rights_flag_added", id, { right, direction: data.direction, source });
        if (actor.id !== p.author_id) {
          core.notify([p.author_id], {
            kind: "proposal_rights_flag",
            title: `${proposalRef(p)} hak etkisi bayrağı ${data.remove ? "kaldırıldı" : "eklendi"}`,
            body: `Denetim yeniden hesaplandı: katman ${report.tier}${report.admissible ? "" : " (yönetmeliğe aykırılık bulgusu var)"}.`,
            link: proposalLink(id),
          });
        }
      });
      return detail(id, actor);
    },

    async vote(actor: AuthUser, id: string, choiceIn: VoteChoice): Promise<BallotReceipt> {
      const choice = parseInput(voteChoiceSchema, choiceIn);
      requireVerified(actor, "Oy vermek");
      const p = visibleProposal(core, id, actor);
      requireStatus(p, ["voting", "revote"], "Bu öneri şu an oylamada değil.");
      if (!phaseOpen(p)) throw conflict("invalid_state", "Oylama süresi doldu.");
      requireVoter(p, actor);
      const round = Number(p.voting_round);
      const ballotId = core.ballotId(actor.id, id, round);
      const salt = newSalt();
      const commitment = voteCommitment(id, round, ballotId, choice, salt);
      return core.tx(() => {
        const cur = core.requireProposal(id);
        if (cur.status !== p.status || cur.voting_round !== p.voting_round || !phaseOpen(cur)) throw conflict("invalid_state", "Oylama bu arada kapandı.");
        const now = core.now();
        db.run(
          `INSERT INTO ballots(proposal_id, round, user_id, ballot_id, choice, salt, commitment, cast_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
           ON CONFLICT(proposal_id, round, user_id) DO UPDATE SET choice = excluded.choice, salt = excluded.salt,
             commitment = excluded.commitment, ledger_tx = NULL, updated_at = excluded.updated_at`,
          id,
          round,
          actor.id,
          ballotId,
          choice,
          salt,
          commitment,
          now,
          now,
        );
        const tx = core.submit("VOTE_COMMIT", { proposalId: id, round, ballotId, commitment });
        db.run("UPDATE ballots SET ledger_tx = ? WHERE proposal_id = ? AND round = ? AND user_id = ?", tx, id, round, actor.id);
        return receiptOf(db.get<BallotRow>("SELECT * FROM ballots WHERE proposal_id = ? AND round = ? AND user_id = ?", id, round, actor.id)!);
      });
    },

    async object(actor: AuthUser, id: string, input: ObjectionRequest): Promise<ProposalDetail> {
      requireVerified(actor, "İtiraz");
      const data = parseInput(z.object({ ground: z.string().min(1).max(500), statement: z.string().max(5000) }), input);
      const p = visibleProposal(core, id, actor);
      requireStatus(p, ["objection_window"], "İtiraz yalnızca itiraz süresinde yapılabilir.");
      if (!phaseOpen(p)) throw conflict("invalid_state", "İtiraz süresi doldu.");
      requireVoter(p, actor);
      const ground = normIri(data.ground);
      if (!safe(() => deps.ontology.objectionGrounds(), []).some((g) => g.iri === ground)) {
        throw badRequest("validation", "Geçersiz itiraz gerekçesi; yönetmelikteki itiraz gerekçelerinden biri seçilmelidir.", [{ path: "ground", message: "geçersiz" }]);
      }
      const statement = checkLength(data.statement, 20, 2000, "statement", "İtiraz açıklaması");
      assertNoPii(core, statement, false);
      if (firstRoundChoice(core, p, actor.id) !== "no") {
        throw unprocessable("not_eligible", "Yalnızca ilk turda etkin oyu “Red” olan seçmenler itiraz edebilir (vekâletle verilen oylar dahil).");
      }
      core.tx(() => {
        if (db.get("SELECT 1 FROM objections WHERE proposal_id = ? AND user_id = ?", id, actor.id)) {
          throw conflict("already_objected", "Bu karara zaten itiraz ettiniz.");
        }
        const now = core.now();
        const used = json<number[]>(db.get<{ v: string }>("SELECT objection_budget_used AS v FROM users WHERE id = ?", actor.id)?.v ?? null, []).filter(
          (t) => Number.isFinite(t) && t > now - OBJECTION_WINDOW_MS,
        );
        if (used.length >= OBJECTION_BUDGET) {
          throw unprocessable("objection_budget", `Son 30 günde en çok ${OBJECTION_BUDGET} itiraz imzalayabilirsiniz; bütçeniz doldu.`, {
            nextAvailableAt: Math.min(...used) + OBJECTION_WINDOW_MS,
          });
        }
        db.run("UPDATE users SET objection_budget_used = ? WHERE id = ?", JSON.stringify([...used, now]), actor.id);
        const oid = newId();
        const clusterId = p.cluster_snapshot_id ? clusters.clusterOf(p.cluster_snapshot_id, actor.id) : null;
        db.run(
          "INSERT INTO objections(id, proposal_id, user_id, ground, statement, cluster_id, at) VALUES (?, ?, ?, ?, ?, ?, ?)",
          oid,
          id,
          actor.id,
          ground,
          statement,
          clusterId,
          now,
        );
        const tx = core.submit("OBJECTION", { proposalId: id, objectionId: oid, ground, clusterId });
        db.run("UPDATE objections SET ledger_tx = ? WHERE id = ?", tx, oid);
      });
      const ev = evaluateObjections(core, clusters, core.requireProposal(id));
      if (ev?.valid) await pokeSafely(id);
      return detail(id, actor);
    },

    minorityReport(actor: AuthUser, id: string, bodyIn: string): MinorityReport {
      requireVerified(actor, "Azınlık raporu");
      const p = visibleProposal(core, id, actor);
      requireStatus(p, ["reconciliation", "objection_window"], "Azınlık raporu yalnızca itiraz süresinde ve uzlaşma turunda yazılabilir.");
      requireVoter(p, actor);
      if (firstRoundChoice(core, p, actor.id) !== "no") {
        throw unprocessable("not_eligible", "Azınlık raporunu yalnızca ilk turda etkin oyu “Red” olan seçmenler yazabilir.");
      }
      const body = checkLength(String(bodyIn ?? ""), 50, 5000, "body", "Azınlık raporu");
      assertNoPii(core, body, false);
      const rid = newId();
      const now = core.now();
      const clusterId = p.cluster_snapshot_id ? clusters.clusterOf(p.cluster_snapshot_id, actor.id) : null;
      core.tx(() => {
        if (db.get("SELECT 1 FROM minority_reports WHERE proposal_id = ? AND author_id = ?", id, actor.id)) {
          throw conflict("already_reported", "Bu karar için zaten bir azınlık raporu yazdınız.");
        }
        db.run("INSERT INTO minority_reports(id, proposal_id, author_id, cluster_id, body, created_at) VALUES (?, ?, ?, ?, ?, ?)", rid, id, actor.id, clusterId, body, now);
        const tx = core.submit("MINORITY_REPORT", { proposalId: id, reportId: rid, contentHash: hashCanonical({ proposalId: id, body }), clusterId });
        db.run("UPDATE minority_reports SET ledger_tx = ? WHERE id = ?", tx, rid);
        core.notify([p.author_id], {
          kind: "minority_report",
          title: `${proposalRef(p)} için azınlık raporu`,
          body: `${clusterLabel(clusterId)} üyesi bir seçmen azınlık raporu yazdı; rapor karar kaydına kalıcı olarak eklenir.`,
          link: proposalLink(id),
        });
      });
      return { id: rid, proposalId: id, authorId: actor.id, authorNickname: actor.nickname, clusterId, body, createdAt: now };
    },

    async requestExpert(actor: AuthUser, id: string, kind: "panel" | "counter"): Promise<ProposalDetail> {
      requireVerified(actor, "Bilirkişi talebi");
      if (kind !== "panel" && kind !== "counter") throw badRequest("validation", "Talep türü 'panel' ya da 'counter' olmalıdır.");
      const p = visibleProposal(core, id, actor);
      if (kind === "panel") requireStatus(p, ["sponsoring", "deliberation"], "Bilirkişi paneli destekçi toplama ve tartışma evrelerinde talep edilebilir.");
      else requireStatus(p, ["reconciliation"], "Karşı bilirkişi talebi yalnızca uzlaşma turunda yapılabilir.");
      core.tx(() => {
        if (db.get("SELECT 1 FROM expert_requests WHERE proposal_id = ? AND user_id = ? AND kind = ?", id, actor.id, kind)) {
          throw conflict("already_requested", "Bu talebi zaten yaptınız.");
        }
        db.run("INSERT INTO expert_requests(proposal_id, user_id, kind, at) VALUES (?, ?, ?, ?)", id, actor.id, kind, core.now());
        const count = Number(db.get<{ c: number }>("SELECT COUNT(*) AS c FROM expert_requests WHERE proposal_id = ? AND kind = ?", id, kind)?.c ?? 0);
        const byAuthor = actor.id === p.author_id || !!db.get("SELECT 1 FROM expert_requests WHERE proposal_id = ? AND kind = ? AND user_id = ?", id, kind, p.author_id);
        const cur = core.requireProposal(id);
        const panel = safe(() => deps.experts.panel(id), null);
        const latest = deps.ledger.latestBlock().height;
        if (kind === "panel") {
          const threshold = Math.max(1, ceilMul(rat(1, 10), core.verifiedCount()));
          if ((byAuthor || count >= threshold) && cur.request_expert === 0) {
            const set: Record<string, SqlValue> = { request_expert: 1 };
            if (cur.status === "deliberation" && !panel && cur.expert_draw_height === null) set.expert_draw_height = latest + 1;
            core.updateProposal(id, set);
            core.notify([p.author_id], { kind: "expert_request", title: `${proposalRef(p)} için bilirkişi paneli çekilecek`, body: "Bilirkişi talebi eşiğe ulaştı; kura zamanlayıcı tarafından önceden taahhüt edilen blokla yapılır.", link: proposalLink(id) });
          }
        } else if ((byAuthor || count >= 3) && cur.expert_draw_height === null && !(panel?.isCounterPanel && panel.createdAt >= Number(cur.phase_started_at ?? 0))) {
          core.updateProposal(id, { expert_draw_height: latest + 1 });
          core.notify([p.author_id], { kind: "expert_request", title: `${proposalRef(p)} için karşı bilirkişi paneli çekilecek`, body: "Karşı bilirkişi talebi eşiğe ulaştı.", link: proposalLink(id) });
        }
      });
      return detail(id, actor);
    },

    expertQuestion(actor: AuthUser, id: string, bodyIn: string): ExpertQuestion {
      requireVerified(actor, "Bilirkişiye soru");
      const p = visibleProposal(core, id, actor);
      if (isClosed(p.status)) throw conflict("invalid_state", "Kapanmış öneri için bilirkişiye soru sorulamaz.");
      const body = checkLength(String(bodyIn ?? ""), 10, 2000, "body", "Soru");
      assertNoPii(core, body, false);
      let minorityGuaranteed = false;
      const snap = clusters.latest();
      if (snap) {
        const params: DecisionParams | null = parseProposal(p).fixedParams ?? parseProposal(p).audit?.params ?? null;
        const share = params?.significantShare ?? rat(1, 10);
        const minMembers = params?.significantMinMembers ?? 3;
        const sizes = clusters.sizes(snap.id);
        const sig = Object.keys(sizes.sizes).filter((g) => sizes.sizes[g] >= minMembers && fracAtLeast(sizes.sizes[g], sizes.clusteredTotal, share));
        const mine = clusters.clusterOf(snap.id, actor.id);
        if (mine && sig.length >= 2 && sig.includes(mine)) {
          const smallest = Math.min(...sig.map((g) => sizes.sizes[g]));
          if (sizes.sizes[mine] === smallest) {
            // Okuma: bu öneride bu kümeden daha önce soru soruldu mu?
            const prior = db.all<{ author_id: string }>("SELECT author_id FROM expert_questions WHERE proposal_id = ?", id);
            minorityGuaranteed = !prior.some((q) => clusters.clusterOf(snap.id, q.author_id) === mine);
          }
        }
      }
      return deps.experts.addQuestion(id, actor.id, body, minorityGuaranteed);
    },

    bulletin(id: string): BulletinResponse {
      const p = visibleProposal(core, id, null);
      return { proposalId: p.id, rounds: bulletinRounds(core, p.id) };
    },

    voters(id: string): VoterListResponse {
      const p = visibleProposal(core, id, null);
      const voters = db.all<{ user_id: string; nickname: string }>(
        "SELECT e.user_id, u.nickname FROM eligible_voters e JOIN users u ON u.id = e.user_id WHERE e.proposal_id = ? ORDER BY u.nickname_norm, u.id",
        id,
      );
      const opened = db.get<{ at: number }>("SELECT at FROM phase_events WHERE proposal_id = ? AND to_status = 'voting' ORDER BY at ASC, rowid ASC LIMIT 1", id);
      return {
        proposalId: p.id,
        eligibleCount: Number(p.eligible_count ?? voters.length),
        snapshotAt: opened ? Number(opened.at) : null,
        voters: voters.map((v) => ({ userId: v.user_id, nickname: v.nickname })),
      };
    },

    async aiSummary(actor: AuthUser, id: string): Promise<AiAnalysisInfo> {
      requireVerified(actor, "Tartışma özeti");
      const p = visibleProposal(core, id, actor);
      if (p.status === "draft") throw conflict("invalid_state", "Taslak önerinin tartışması yok.");
      const claude = deps.ai.mode() === "claude";
      const { rows, consent } = threadMessagesForAi(p);
      const assign = latestClusterOf(core, rows.map((r) => r.author_id));
      const pseudo = new Map<string, string>();
      const input: SummaryInputMessage[] = [];
      let skipped = 0;
      for (const m of rows) {
        if (claude && !consent.get(m.author_id)) {
          skipped++;
          continue;
        }
        if (!pseudo.has(m.author_id)) pseudo.set(m.author_id, `K${pseudo.size + 1}`);
        input.push({ id: m.id, pseudonym: pseudo.get(m.author_id)!, clusterId: assign.get(m.author_id) ?? null, stance: m.stance, body: m.body });
      }
      const topicTitle = !claude || consent.get(p.author_id) ? p.title : `Öneri ${proposalRef(p)}`;
      const out = await deps.ai.summarize({ topicTitle, messages: input });
      const notes: string[] = [];
      if (skipped > 0) notes.push(`${skipped} mesaj, yazarları yapay zekâ analizine rıza vermediği için özete dahil edilmedi.`);
      const collapsed = Number(db.get<{ c: number }>("SELECT COUNT(*) AS c FROM messages WHERE thread_type = 'proposal' AND thread_id = ? AND visibility <> 'visible'", id)?.c ?? 0);
      if (collapsed > 0) notes.push(`${collapsed} gizlenmiş ya da incelemedeki mesaj özete dahil edilmedi.`);
      const output = { ...out, messageCount: input.length, excludedMessages: skipped + collapsed, note: notes.join(" ") || null };
      const inputHash = hashCanonical({ topicTitle, messages: input });
      return deps.aiSink.record({
        task: "summarize",
        targetType: "proposal",
        targetId: id,
        model: out.model,
        offline: out.offline,
        output,
        approvedBy: null,
        inputHash,
        outputHash: hashCanonical(output),
        promptVersion: PROMPT_VERSION,
      });
    },

    async aiBridging(actor: AuthUser, id: string): Promise<AiAnalysisInfo> {
      requireVerified(actor, "Köprü taslakları");
      const p = visibleProposal(core, id, actor);
      const contested = db.get("SELECT 1 FROM tallies WHERE proposal_id = ? AND interim = 0 AND json_extract(result, '$.outcome') = 'contested'", id);
      if (p.status !== "reconciliation" && !contested) throw conflict("invalid_state", "Köprü taslakları uzlaşma turunda (ya da tartışmalı sonuçtan sonra) üretilebilir.");
      const claude = deps.ai.mode() === "claude";
      const { rows, consent } = threadMessagesForAi(p);
      let skipped = 0;
      const ok = (authorId: string) => {
        if (!claude || consent.get(authorId)) return true;
        skipped++;
        return false;
      };
      const majorityPoints = rows.filter((m) => m.stance === "pro" && ok(m.author_id)).map((m) => m.body);
      const minorityPoints = rows.filter((m) => m.stance === "con" && ok(m.author_id)).map((m) => m.body);
      const reports = db.all<{ author_id: string; body: string }>("SELECT author_id, body FROM minority_reports WHERE proposal_id = ? ORDER BY created_at, rowid", id);
      const reportConsent = new Map(
        db
          .all<{ id: string; ai_consent: number }>("SELECT id, ai_consent FROM users WHERE id IN (SELECT value FROM json_each(?))", jsonList(reports.map((r) => r.author_id)))
          .map((u) => [u.id, u.ai_consent === 1] as const),
      );
      for (const r of reports) {
        if (!claude || reportConsent.get(r.author_id)) minorityPoints.push(r.body);
        else skipped++;
      }
      const authorOk = !claude || !!consent.get(p.author_id);
      const input = { title: authorOk ? p.title : `Öneri ${proposalRef(p)}`, body: authorOk ? p.body : "", majorityPoints, minorityPoints };
      const out = await deps.ai.bridgingDrafts(input, { forceOffline: !authorOk });
      const output = { ...out, baseVersion: p.version, excludedItems: skipped, note: skipped > 0 ? `${skipped} katkı, yazarları yapay zekâ analizine rıza vermediği için kullanılmadı.` : null };
      return deps.aiSink.record({
        task: "bridging_drafts",
        targetType: "proposal",
        targetId: id,
        model: out.model,
        offline: out.offline,
        output,
        approvedBy: null,
        inputHash: hashCanonical(input),
        outputHash: hashCanonical(output),
        promptVersion: PROMPT_VERSION,
      });
    },

    async approveAi(actor: AuthUser, analysisId: string, draftIndex?: number): Promise<AiAnalysisInfo> {
      requireVerified(actor, "YZ çıktısı onayı");
      const a = getAnalysis(deps.ctx, analysisId);
      if (!a) throw notFound("Yapay zekâ analizi");
      if (a.targetType !== "proposal") throw unprocessable("invalid_target", "Yalnızca öneriye ait analizler onaylanabilir.");
      const p = visibleProposal(core, a.targetId, actor);
      requireAuthor(p, actor);
      if (draftIndex !== undefined && draftIndex !== null) {
        if (a.task !== "bridging_drafts") throw badRequest("validation", "Taslak seçimi yalnızca köprü taslakları için geçerlidir.");
        requireStatus(p, ["reconciliation"], "Köprü taslağı yalnızca uzlaşma turunda yeni sürüm olarak uygulanabilir.");
        const drafts = (a.output as { drafts?: { title: string; body: string }[] } | null)?.drafts ?? [];
        const d = Number.isInteger(draftIndex) ? drafts[draftIndex] : undefined;
        if (!d) throw badRequest("validation", "Geçersiz taslak numarası.", [{ path: "draftIndex", message: "aralık dışı" }]);
        await applyRevision(actor, p, { title: d.title?.trim() || p.title, body: d.body });
      }
      return approveAnalysis(deps.ctx, analysisId, actor.id);
    },

    receipts(actor: AuthUser, id: string): BallotReceipt[] {
      visibleProposal(core, id, actor);
      return db.all<BallotRow>("SELECT * FROM ballots WHERE proposal_id = ? AND user_id = ? ORDER BY round ASC", id, actor.id).map(receiptOf);
    },
  };

  return service;
}

export type { AppError };
