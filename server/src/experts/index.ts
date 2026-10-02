// Bilirkişi modülü: başvuru/onay/yaptırım, tohumlu ağırlıklı kura (ALGORITMA.md §8), raporlar ve itibar.
// Bilirkişi DANIŞMANDIR: oy ağırlığı yoktur, durum değiştirmez; askı bayrağını yalnızca yaşam döngüsü motoru kullanır.
import {
  ASSESSMENT_LABELS,
  ASSIGNMENT_STATUS_LABELS,
  aiLabel,
  compactIri,
  contentHash,
  expandIri,
  fy,
  TEXT_LIMITS,
  type AssignmentStatus,
  type ExpertAssessment,
  type ExpertDrawRecord,
  type ExpertInfo,
  type ExpertPanelInfo,
  type ExpertQuestion,
  type ExpertReportView,
  type ExpertStatus,
  type Role,
} from "@forum/shared";
import type { AuditLogger } from "../core/audit";
import type {
  AiService,
  ConflictCheck,
  CoreContext,
  ExpertReportInput,
  ExpertService,
  ExpertViewer,
  GovernanceMath,
  GraphService,
  LedgerService,
  Notifier,
  OntologyService,
} from "../core/contracts";
import { badRequest, conflict, forbidden, notFound } from "../core/errors";
import { newId } from "../core/ids";
import { json } from "../db";
import {
  REPUTATION_START,
  WARN_PENALTY,
  candidateRef,
  drawSeed,
  expertWeight,
  reportScore,
  roundReputation,
  substituteSeed,
  suspensive,
  updatedReputation,
} from "./draw";

export * from "./draw";

export interface ExpertDeps {
  ledger: LedgerService;
  graph: GraphService;
  math: GovernanceMath;
  ai: AiService;
  notifier: Notifier;
  audit: AuditLogger;
  ontology: Pick<OntologyService, "isSubCategoryOf" | "ancestors" | "categoryLabel">;
  householdOf: (userId: string) => string | null;
}

interface ExpertRow {
  user_id: string;
  domains: string;
  credentials: string;
  status: ExpertStatus;
  reputation: number;
  approved_by: string | null;
  approved_at: number | null;
  sanction_note: string | null;
  created_at: number;
}

interface PanelRow {
  id: string;
  proposal_id: string;
  round: number;
  is_counter: number;
  seed: string;
  seed_source: string;
  candidates: string;
  selected: string;
  no_expert: number;
  ledger_tx: string | null;
  created_at: number;
}

interface AssignmentRow {
  id: string;
  panel_id: string;
  proposal_id: string;
  expert_id: string;
  status: AssignmentStatus;
  recuse_reason: string | null;
  due_at: number;
  created_at: number;
  updated_at: number;
}

interface ReportRow {
  id: string;
  assignment_id: string;
  proposal_id: string;
  expert_id: string;
  assessment: ExpertAssessment;
  confidence: number;
  risks: string;
  answers: string;
  body: string;
  dissent: string | null;
  lint: string;
  score: number | null;
  content_hash: string;
  ledger_tx: string | null;
  created_at: number;
}

interface QuestionRow {
  id: string;
  proposal_id: string;
  author_id: string;
  body: string;
  minority_guaranteed: number;
  created_at: number;
}

/** expert_panels.candidates satırı (çekilişteki sırayla: kullanıcı kimliğine göre artan) */
interface StoredCandidate {
  userId: string;
  weight: number;
  softConflict: number;
  excludedReason?: string;
}

interface LintIssue {
  quote: string;
  kind: string;
  message: string;
}

/** expert_reports.lint: YZ denetimi danışma çıktısıdır; etiketiyle saklanır. */
interface StoredLint {
  issues: LintIssue[];
  model: string;
  offline: boolean;
  label: string;
}

const ASSESSMENTS: readonly ExpertAssessment[] = ["feasible", "infeasible", "uncertain"];
const PENDING_SQL = "('invited','accepted')";
const MAX_DOMAINS = 10;
const MAX_PANEL = 15;
/** Azınlık güvenceli soruya verilecek yanıtın asgari uzunluğu (soru da en az 10 karakterdir). */
export const MIN_GUARANTEED_ANSWER = 10;
/** Genişletmede kullanılmayan kök sınıflar (her bilirkişiyi kapsardı). */
const ROOT_CATEGORIES = new Set([fy("Kategori"), "http://www.w3.org/2002/07/owl#Thing", "http://www.w3.org/2000/01/rdf-schema#Resource"]);

const byId = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
const clamp01 = (x: number): number => (Number.isFinite(x) ? Math.min(1, Math.max(0, x)) : 0);
const isPending = (s: string): boolean => s === "invited" || s === "accepted";
const fmtTime = (t: number): string => new Date(t).toISOString().slice(0, 16).replace("T", " ") + " UTC";

/** Yeterlilik beyanını (credentials) tam görebilen roller; ayrıca bilirkişinin kendisi. */
const CREDENTIAL_ROLES: readonly Role[] = ["admin", "registrar", "auditor"];

/**
 * Kesin çıkar çatışması dışlaması: ayrıntılı gerekçe (yakınlık türü, zincir uzunluğu, hane) özel bir beyana ve adresten
 * türetilmiş bir çıkarıma dayanır; yalnız personele gösterilir, herkese açık panelde genel ifade yer alır.
 */
const CONFLICT_REASON = "Yazarla kesin çıkar çatışması";
const PUBLIC_CONFLICT_REASON = "Çıkar çatışması nedeniyle dışlandı";
const publicReason = (reason: string): string => (reason.startsWith(CONFLICT_REASON) ? PUBLIC_CONFLICT_REASON : reason);

/** Panelde dışlama gerekçesinin ayrıntısını görebilir mi? (yönetici, kayıt memuru, denetçi) */
export function canSeeExclusionDetail(viewer: ExpertViewer | undefined): boolean {
  return !!viewer && viewer.roles.some((r) => CREDENTIAL_ROLES.includes(r));
}

/** Kimlik belirlemeyen, herkese açık yeterlilik özeti için durum metinleri. */
const STATUS_SUMMARY: Record<ExpertStatus, string> = {
  active: "Yönetici onaylı bilirkişi",
  applied: "Bilirkişilik başvurusu (karar bekliyor)",
  suspended: "Bilirkişi (askıda)",
  removed: "Bilirkişi listesinden çıkarıldı",
  rejected: "Bilirkişilik başvurusu reddedildi",
};

/** Görüntüleyen yeterlilik beyanının tamamını görebilir mi? (yönetici, kayıt memuru, denetçi ya da kişinin kendisi) */
export function canSeeCredentials(viewer: ExpertViewer | undefined, expertUserId: string): boolean {
  if (!viewer) return false;
  return viewer.id === expertUserId || viewer.roles.some((r) => CREDENTIAL_ROLES.includes(r));
}

/** Uygulama içi tam görünüm (başvuran kendisi, karar veren/yaptırım uygulayan yönetici). */
const SELF_VIEW = (userId: string): ExpertViewer => ({ id: userId, roles: [] });

export function createExpertService(ctx: CoreContext, deps: ExpertDeps): ExpertService {
  const { db, clock } = ctx;
  const { ledger, graph, math, ai, notifier, audit, ontology, householdOf } = deps;

  // ───────────── yardımcılar ─────────────

  const userRow = (id: string) =>
    db.get<{ id: string; nickname: string; status: string; roles: string }>("SELECT id, nickname, status, roles FROM users WHERE id = ?", id);

  const nicknameOf = (id: string): string => userRow(id)?.nickname ?? "(bilinmeyen üye)";

  const isAdmin = (id: string): boolean => {
    const u = userRow(id);
    return !!u && json<Role[]>(u.roles, []).includes("admin");
  };

  const requireAdmin = (actorId: string): void => {
    if (!isAdmin(actorId)) throw forbidden("Bu işlemi yalnızca yöneticiler yapabilir.");
  };

  const adminIds = (): string[] =>
    db
      .all<{ id: string; roles: string }>("SELECT id, roles FROM users WHERE roles LIKE '%admin%' AND status <> 'erased'")
      .filter((u) => json<Role[]>(u.roles, []).includes("admin"))
      .map((u) => u.id);

  const expertRow = (userId: string) => db.get<ExpertRow>("SELECT * FROM experts WHERE user_id = ?", userId);

  const requireExpert = (userId: string): ExpertRow => {
    const r = expertRow(userId);
    if (!r) throw notFound("Bilirkişi kaydı");
    return r;
  };

  const domainsOf = (r: Pick<ExpertRow, "domains">): string[] => json<string[]>(r.domains, []);

  const label = (iri: string): string => {
    try {
      return ontology.categoryLabel(iri) || compactIri(iri);
    } catch {
      return compactIri(iri);
    }
  };

  /** a, b'nin kendisi ya da alt sınıfı mı? (bilinmeyen IRI'de false) */
  const sub = (a: string, b: string): boolean => {
    if (a === b) return true;
    try {
      return ontology.isSubCategoryOf(a, b);
    } catch {
      return false;
    }
  };

  const ancestorsOf = (iri: string): string[] => {
    try {
      return ontology.ancestors(iri);
    } catch {
      return [iri];
    }
  };

  const proposalExists = (id: string): boolean => !!db.get("SELECT id FROM proposals WHERE id = ?", id);

  const activeCount = (userId: string): number =>
    db.get<{ n: number }>(`SELECT COUNT(*) AS n FROM expert_assignments WHERE expert_id = ? AND status IN ${PENDING_SQL}`, userId)?.n ?? 0;

  const reportCount = (userId: string): number =>
    db.get<{ n: number }>("SELECT COUNT(*) AS n FROM expert_reports WHERE expert_id = ?", userId)?.n ?? 0;

  /** Herkese açık özet: durum + alan etiketleri (+ rapor sayısı). Serbest metin beyandan hiçbir şey alınmaz. */
  const qualificationSummary = (r: ExpertRow, reports: number): string => {
    const labels = domainsOf(r).map(label);
    const shown = labels.slice(0, 3).join(", ") + (labels.length > 3 ? ` ve ${labels.length - 3} alan daha` : "");
    return [STATUS_SUMMARY[r.status] ?? "Bilirkişi", shown ? `uzmanlık: ${shown}` : null, reports > 0 ? `${reports} rapor` : null]
      .filter(Boolean)
      .join(" · ");
  };

  /**
   * ExpertInfo; `viewer` yeterlilik beyanını görme yetkisine göre biçimlenir (verilmezse herkese açık görünüm).
   * Beyan serbest metindir (kurum, unvan, sicil gibi kimliği belirleyebilecek bilgi içerebilir) → yalnız yetkiliye.
   */
  const toInfo = (r: ExpertRow, viewer?: ExpertViewer): ExpertInfo => {
    const completedReports = reportCount(r.user_id);
    return {
      userId: r.user_id,
      nickname: nicknameOf(r.user_id),
      domains: domainsOf(r),
      credentials: canSeeCredentials(viewer, r.user_id) ? r.credentials : null,
      qualificationSummary: qualificationSummary(r, completedReports),
      status: r.status,
      reputation: r.reputation,
      activeAssignments: activeCount(r.user_id),
      completedReports,
    };
  };

  /** experts.reputation ve onu yansıtan users.reputation birlikte güncellenir. */
  const setReputation = (userId: string, r: number): void => {
    const v = roundReputation(r);
    db.run("UPDATE experts SET reputation = ? WHERE user_id = ?", v, userId);
    db.run("UPDATE users SET reputation = ? WHERE id = ?", v, userId);
  };

  /** EXPERT_IN kenarlarını alan listesiyle eşitler (kenarlar silinmez, iptal edilir). */
  const syncExpertEdges = (userId: string, domains: string[]): void => {
    const src = `user:${userId}`;
    const want = new Set(domains.map((d) => `cat:${d}`));
    const have = new Set<string>();
    for (const e of graph.listEdges({ src, type: "EXPERT_IN" })) {
      if (want.has(e.dst) && !have.has(e.dst)) have.add(e.dst);
      else graph.revokeEdge(e.id);
    }
    for (const dst of want) if (!have.has(dst)) graph.addEdge({ src, dst, type: "EXPERT_IN" });
  };

  const normalizeDomains = (domains: unknown): string[] => {
    if (!Array.isArray(domains)) return [];
    const out: string[] = [];
    for (const d of domains) {
      if (typeof d !== "string" || !d.trim()) continue;
      const iri = expandIri(d.trim());
      if (!out.includes(iri)) out.push(iri);
    }
    return out;
  };

  const panelRow = (id: string) => db.get<PanelRow>("SELECT * FROM expert_panels WHERE id = ?", id);

  const assignmentRow = (id: string) => db.get<AssignmentRow>("SELECT * FROM expert_assignments WHERE id = ?", id);

  const questionRows = (proposalId: string) =>
    db.all<QuestionRow>("SELECT * FROM expert_questions WHERE proposal_id = ? ORDER BY created_at, rowid", proposalId);

  const reportRows = (proposalId: string) =>
    db.all<ReportRow>("SELECT * FROM expert_reports WHERE proposal_id = ? ORDER BY created_at, rowid", proposalId);

  const parseLint = (v: string): StoredLint => {
    const raw = json<unknown>(v, []);
    if (Array.isArray(raw)) return { issues: raw as LintIssue[], model: "", offline: true, label: "" };
    const o = raw as Partial<StoredLint>;
    return { issues: Array.isArray(o.issues) ? o.issues : [], model: o.model ?? "", offline: !!o.offline, label: o.label ?? "" };
  };

  const toQuestion = (q: QuestionRow): ExpertQuestion => ({
    id: q.id,
    proposalId: q.proposal_id,
    authorId: q.author_id,
    authorNickname: nicknameOf(q.author_id),
    body: q.body,
    minorityGuaranteed: !!q.minority_guaranteed,
    createdAt: q.created_at,
  });

  const toReport = (r: ReportRow): ExpertReportView => ({
    id: r.id,
    assignmentId: r.assignment_id,
    expertId: r.expert_id,
    expertNickname: nicknameOf(r.expert_id),
    assessment: r.assessment,
    confidence: r.confidence,
    risks: json<string[]>(r.risks, []),
    answers: json<{ questionId: string; answer: string }[]>(r.answers, []),
    body: r.body,
    dissent: r.dissent,
    lintIssues: parseLint(r.lint).issues,
    contentHash: r.content_hash,
    ledgerTx: r.ledger_tx,
    createdAt: r.created_at,
  });

  const suspensiveFor = (proposalId: string): boolean =>
    suspensive(
      db.all<{ assessment: ExpertAssessment; confidence: number }>(
        "SELECT assessment, confidence FROM expert_reports WHERE proposal_id = ?",
        proposalId,
      ),
    );

  /**
   * Önerinin EXPERT_DRAW defter kayıtları (ilk kura, karşı panel, yedek kuralar), defter sırasıyla.
   * Yalnızca defterdeki kamusal alanlar okunur (aday referansları zaten öneriye özel takma değerlerdir).
   */
  const drawRecords = (proposalId: string): ExpertDrawRecord[] => {
    let txs: ReturnType<LedgerService["findTxs"]>;
    try {
      txs = ledger.findTxs({ type: "EXPERT_DRAW", proposalId, limit: 1000 });
    } catch {
      return [];
    }
    return txs
      .filter((t) => t.type === "EXPERT_DRAW" && t.payload.proposalId === proposalId)
      .sort((a, b) => a.height - b.height || a.index - b.index)
      .map((t): ExpertDrawRecord => {
        const pl = t.payload;
        const sub = typeof pl.substitute === "number" && pl.substitute > 0 ? pl.substitute : null;
        const reason = pl.reason === "recused" || pl.reason === "replaced" ? pl.reason : null;
        return {
          round: Number(pl.round) || 1,
          kind: sub !== null ? "substitute" : pl.isCounter ? "counter" : "panel",
          reason: sub !== null ? reason : null,
          substitute: sub,
          selected: Array.isArray(pl.selected) ? pl.selected.length : 0,
          txHash: t.hash,
          at: Number(t.blockTime),
        };
      });
  };

  /** `detailed` yalnız personel ve iç çağrılar içindir; varsayılan görünümde çatışma gerekçesi genel ifadeye indirgenir. */
  const buildPanel = (p: PanelRow, detailed = false): ExpertPanelInfo => {
    const nick = new Map<string, string>();
    const nn = (id: string): string => {
      let v = nick.get(id);
      if (v === undefined) nick.set(id, (v = nicknameOf(id)));
      return v;
    };
    const cands = json<StoredCandidate[]>(p.candidates, []);
    return {
      panelId: p.id,
      proposalId: p.proposal_id,
      round: p.round,
      isCounterPanel: !!p.is_counter,
      seed: p.seed,
      seedSource: json(p.seed_source, { blockHash: "", blockHeight: 0, proposalId: p.proposal_id, round: p.round }),
      candidates: cands.map((c) => ({
        userId: c.userId,
        nickname: nn(c.userId),
        weight: c.weight,
        softConflict: c.softConflict,
        ...(c.excludedReason ? { excludedReason: detailed ? c.excludedReason : publicReason(c.excludedReason) } : {}),
      })),
      assignments: db
        .all<AssignmentRow>("SELECT * FROM expert_assignments WHERE panel_id = ? ORDER BY created_at, rowid", p.id)
        .map((a) => ({
          id: a.id,
          expertId: a.expert_id,
          nickname: nn(a.expert_id),
          status: a.status,
          dueAt: a.due_at,
          ...(a.status === "recused" ? { recuseReason: a.recuse_reason ?? null } : {}),
        })),
      draws: drawRecords(p.proposal_id),
      reports: reportRows(p.proposal_id).map(toReport),
      questions: questionRows(p.proposal_id).map(toQuestion),
      suspensiveFlag: suspensiveFor(p.proposal_id),
      noExpertAvailable: !!p.no_expert,
      ledgerTx: p.ledger_tx,
      createdAt: p.created_at,
    };
  };

  const notifyInvite = (expertId: string, proposalId: string, dueAt: number): void => {
    notifier.notify(expertId, {
      kind: "expert_invited",
      title: "Bilirkişi paneline seçildiniz",
      body: `Bir öneri için bilirkişi kurasında seçildiniz. Görevi kabul edin ya da çıkar çatışmanız varsa çekinme beyan edin. Son teslim: ${fmtTime(dueAt)}.`,
      link: `/oneriler/${proposalId}`,
    });
  };

  /**
   * Boşalan yer için yedek çekiliş: aynı panelin kayıtlı aday listesinden, bu panelde henüz görev almamış ve
   * hâlâ etkin olan adaylar arasından, tohum = seed|yedek|n ile 1 kişi. Sonuç EXPERT_DRAW (substitute) olarak deftere yazılır.
   * Çağıran, boşalan atamanın durumunu önceden güncellemiş olmalıdır.
   */
  const substitute = (vacated: AssignmentRow, reason: "recused" | "replaced"): string | null => {
    const p = panelRow(vacated.panel_id);
    if (!p) return null;
    const now = clock.now();
    const assigned = new Set(
      db.all<{ expert_id: string }>("SELECT expert_id FROM expert_assignments WHERE panel_id = ?", p.id).map((r) => r.expert_id),
    );
    const active = new Set(
      db
        .all<{ user_id: string }>(
          "SELECT e.user_id FROM experts e JOIN users u ON u.id = e.user_id WHERE e.status = 'active' AND u.status = 'verified'",
        )
        .map((r) => r.user_id),
    );
    const remaining = json<StoredCandidate[]>(p.candidates, [])
      .filter((c) => c.weight > 0 && !c.excludedReason && !assigned.has(c.userId) && active.has(c.userId))
      .sort((a, b) => byId(a.userId, b.userId));
    const n =
      db.get<{ n: number }>("SELECT COUNT(*) AS n FROM expert_assignments WHERE panel_id = ? AND status IN ('recused','replaced')", p.id)?.n ?? 1;
    const seed = substituteSeed(p.seed, n);
    const pick = remaining.length > 0 ? math.drawWeighted(remaining.map((c) => ({ id: c.userId, weight: c.weight })), 1, seed)[0] : undefined;
    if (pick) {
      db.run(
        "INSERT INTO expert_assignments(id, panel_id, proposal_id, expert_id, status, due_at, created_at, updated_at) VALUES (?, ?, ?, ?, 'invited', ?, ?, ?)",
        newId(),
        p.id,
        p.proposal_id,
        pick.id,
        vacated.due_at,
        now,
        now,
      );
      notifyInvite(pick.id, p.proposal_id, vacated.due_at);
    }
    ledger.submit("EXPERT_DRAW", {
      proposalId: p.proposal_id,
      panelId: p.id,
      round: p.round,
      isCounter: !!p.is_counter,
      substitute: n,
      reason,
      vacated: candidateRef(vacated.expert_id, p.id),
      seed,
      candidates: remaining.map((c) => ({ ref: candidateRef(c.userId, p.id), weight: c.weight })),
      selected: pick ? [candidateRef(pick.id, p.id)] : [],
    });
    return pick?.id ?? null;
  };

  /** Askıya alınan/çıkarılan bilirkişinin bekleyen görevleri "replaced" olur ve her biri için yedek çekilir. */
  const replacePending = (expertId: string): number => {
    const rows = db.all<AssignmentRow>(
      `SELECT * FROM expert_assignments WHERE expert_id = ? AND status IN ${PENDING_SQL} ORDER BY created_at, rowid`,
      expertId,
    );
    for (const a of rows) {
      db.run("UPDATE expert_assignments SET status = 'replaced', updated_at = ? WHERE id = ?", clock.now(), a.id);
      substitute(a, "replaced");
    }
    return rows.length;
  };

  /**
   * Tohum öğütmeye karşı: verilen blok defterdeki blokla eşleşmeli. Henüz işlenmemiş (geleceğe taahhüt edilmiş)
   * bir yüksekliğin hash'i bilinemeyeceğinden reddedilir.
   */
  const resolveSeedBlock = (sb?: { height: number; hash: string }): { height: number; hash: string } => {
    const latest = ledger.latestBlock();
    if (!sb) return { height: latest.height, hash: latest.hash };
    if (!Number.isInteger(sb.height) || sb.height < 0 || typeof sb.hash !== "string" || !sb.hash) {
      throw badRequest("invalid_seed_block", "Tohum bloğu geçersiz.");
    }
    if (sb.height === latest.height && sb.hash === latest.hash) return { height: sb.height, hash: sb.hash };
    const b = ledger.getBlock(sb.height);
    if (!b) throw conflict("seed_block_pending", "Tohum için taahhüt edilen blok henüz işlenmedi; kura bu blok işlendikten sonra yapılabilir.");
    if (b.hash !== sb.hash) throw badRequest("seed_block_mismatch", "Tohum bloğunun özeti defterdeki blokla eşleşmiyor.");
    return { height: sb.height, hash: sb.hash };
  };

  /** Üst kategorilere genişletme düzeyleri: düzey L'de her kategori yerine L'inci üst sınıfı (kök hariç). */
  const widenLevels = (categories: string[]): string[][] => {
    const chains = categories.map((c) =>
      ancestorsOf(c)
        .filter((a) => a !== c && !ROOT_CATEGORIES.has(a))
        .sort((a, b) => ancestorsOf(b).length - ancestorsOf(a).length || byId(a, b)),
    );
    const max = Math.max(0, ...chains.map((ch) => ch.length));
    const levels: string[][] = [];
    for (let L = 1; L <= max; L++) {
      const lvl: string[] = [];
      chains.forEach((ch, i) => {
        const iri = ch.length === 0 ? categories[i] : ch[Math.min(L, ch.length) - 1];
        if (!lvl.includes(iri)) lvl.push(iri);
      });
      levels.push(lvl);
    }
    return levels;
  };

  // ───────────── servis ─────────────

  const service: ExpertService = {
    apply(userId, domains, credentials) {
      const u = userRow(userId);
      if (!u) throw notFound("Kullanıcı");
      if (u.status !== "verified") throw forbidden("Bilirkişi başvurusu için üyeliğinizin doğrulanmış olması gerekir.");
      const doms = normalizeDomains(domains);
      if (doms.length === 0) throw badRequest("domains_required", "En az bir uzmanlık alanı seçmelisiniz.");
      if (doms.length > MAX_DOMAINS) throw badRequest("too_many_domains", `En fazla ${MAX_DOMAINS} uzmanlık alanı seçilebilir.`);
      const cred = typeof credentials === "string" ? credentials.trim() : "";
      const credLim = TEXT_LIMITS.expertCredentials;
      if (cred.length < credLim.min || cred.length > credLim.max) {
        throw badRequest("invalid_credentials", `Yeterlilik bilgisi ${credLim.min} ile ${credLim.max} karakter arasında olmalıdır.`);
      }
      const existing = expertRow(userId);
      if (existing?.status === "active") throw conflict("already_expert", "Zaten etkin bir bilirkişisiniz.");
      if (existing?.status === "applied") throw conflict("already_applied", "Karar bekleyen bir başvurunuz zaten var.");
      if (existing?.status === "suspended") throw conflict("expert_suspended", "Bilirkişiliğiniz askıda; yeni başvuru yapılamaz.");
      const now = clock.now();
      db.tx(() => {
        if (existing) {
          // Reddedilmiş ya da listeden çıkarılmış başvurucu yeniden başvurabilir; itibar sıfırlanmaz.
          db.run(
            "UPDATE experts SET domains = ?, credentials = ?, status = 'applied', approved_by = NULL, approved_at = NULL WHERE user_id = ?",
            JSON.stringify(doms),
            cred,
            userId,
          );
        } else {
          db.run(
            "INSERT INTO experts(user_id, domains, credentials, status, reputation, created_at) VALUES (?, ?, ?, 'applied', ?, ?)",
            userId,
            JSON.stringify(doms),
            cred,
            REPUTATION_START,
            now,
          );
        }
        for (const admin of adminIds()) {
          if (admin === userId) continue;
          notifier.notify(admin, {
            kind: "expert_application",
            title: "Yeni bilirkişi başvurusu",
            body: `${u.nickname} bilirkişi olmak için başvurdu. Alanlar: ${doms.map(label).join(", ")}.`,
            link: "/bilirkisiler",
          });
        }
        audit.log(userId, "expert.apply", `user:${userId}`, { domains: doms });
      });
      return toInfo(requireExpert(userId), SELF_VIEW(userId));
    },

    decideApplication(actorId, userId, decision, note) {
      requireAdmin(actorId);
      if (actorId === userId) throw forbidden("Kendi başvurunuz hakkında karar veremezsiniz.");
      if (decision !== "approve" && decision !== "reject") {
        throw badRequest("invalid_decision", "Karar 'approve' (onay) ya da 'reject' (ret) olmalıdır.");
      }
      const e = requireExpert(userId);
      if (e.status !== "applied") throw conflict("not_pending", "Bu başvuru karar bekleyen durumda değil.");
      const now = clock.now();
      const text = typeof note === "string" && note.trim() ? note.trim() : null;
      const approve = decision === "approve";
      db.tx(() => {
        if (approve) {
          db.run(
            "UPDATE experts SET status = 'active', approved_by = ?, approved_at = ? WHERE user_id = ?",
            actorId,
            now,
            userId,
          );
          setReputation(userId, e.reputation);
        } else {
          db.run("UPDATE experts SET status = 'rejected' WHERE user_id = ?", userId);
        }
        notifier.notify(userId, {
          kind: "expert_decision",
          title: approve ? "Bilirkişi başvurunuz onaylandı" : "Bilirkişi başvurunuz reddedildi",
          body: (approve ? "Artık bilirkişi kuralarına katılabilirsiniz." : "Başvurunuz yönetici tarafından reddedildi.") + (text ? ` Not: ${text}` : ""),
          link: "/bilirkisiler",
        });
        audit.log(actorId, approve ? "expert.approve" : "expert.reject", `user:${userId}`, text ? { note: text } : null);
      });
      if (approve) syncExpertEdges(userId, domainsOf(e));
      return toInfo(requireExpert(userId), { id: actorId, roles: ["admin"] });
    },

    sanction(actorId, userId, action, note) {
      requireAdmin(actorId);
      if (actorId === userId) throw forbidden("Kendinize yaptırım uygulayamazsınız.");
      const text = typeof note === "string" ? note.trim() : "";
      if (!text) throw badRequest("note_required", "Yaptırım için gerekçe yazılmalıdır.");
      const e = requireExpert(userId);
      let replaced = 0;
      db.tx(() => {
        let title = "";
        switch (action) {
          case "warn":
            if (e.status !== "active" && e.status !== "suspended") {
              throw conflict("invalid_state", "Yalnızca etkin ya da askıdaki bilirkişiye uyarı verilebilir.");
            }
            setReputation(userId, e.reputation - WARN_PENALTY);
            title = "Bilirkişi uyarısı";
            break;
          case "suspend":
            if (e.status !== "active") throw conflict("invalid_state", "Yalnızca etkin bir bilirkişi askıya alınabilir.");
            db.run("UPDATE experts SET status = 'suspended' WHERE user_id = ?", userId);
            replaced = replacePending(userId);
            title = "Bilirkişiliğiniz askıya alındı";
            break;
          case "remove":
            if (e.status !== "active" && e.status !== "suspended") {
              throw conflict("invalid_state", "Yalnızca etkin ya da askıdaki bilirkişi listeden çıkarılabilir.");
            }
            db.run("UPDATE experts SET status = 'removed' WHERE user_id = ?", userId);
            replaced = replacePending(userId);
            title = "Bilirkişi listesinden çıkarıldınız";
            break;
          case "reinstate":
            if (e.status !== "suspended" && e.status !== "removed") {
              throw conflict("invalid_state", "Yalnızca askıdaki ya da listeden çıkarılmış bilirkişi yeniden etkinleştirilebilir.");
            }
            db.run("UPDATE experts SET status = 'active' WHERE user_id = ?", userId);
            title = "Bilirkişiliğiniz yeniden etkin";
            break;
          default:
            throw badRequest("invalid_action", "Yaptırım türü warn, suspend, remove ya da reinstate olmalıdır.");
        }
        db.run("UPDATE experts SET sanction_note = ? WHERE user_id = ?", text, userId);
        notifier.notify(userId, { kind: "expert_sanction", title, body: `Gerekçe: ${text}`, link: "/bilirkisiler" });
        audit.log(actorId, `expert.sanction.${action}`, `user:${userId}`, { note: text, replacedAssignments: replaced });
      });
      if (action === "remove") syncExpertEdges(userId, []);
      if (action === "reinstate") syncExpertEdges(userId, domainsOf(e));
      return toInfo(requireExpert(userId), { id: actorId, roles: ["admin"] });
    },

    list(filter = {}, viewer = null) {
      let rows = filter.status
        ? db.all<ExpertRow>("SELECT * FROM experts WHERE status = ?", filter.status)
        : db.all<ExpertRow>("SELECT * FROM experts");
      if (filter.domain) {
        const d = expandIri(filter.domain);
        rows = rows.filter((r) => domainsOf(r).some((x) => sub(x, d)));
      }
      return rows
        .map((r) => toInfo(r, viewer))
        .sort((a, b) => a.nickname.localeCompare(b.nickname, "tr") || byId(a.userId, b.userId));
    },

    get(userId, viewer = null) {
      const r = expertRow(userId);
      return r ? toInfo(r, viewer) : null;
    },

    addQuestion(proposalId, userId, body, minorityGuaranteed = false) {
      if (!userRow(userId)) throw notFound("Kullanıcı");
      if (!proposalExists(proposalId)) throw notFound("Öneri");
      const text = typeof body === "string" ? body.trim() : "";
      const qLim = TEXT_LIMITS.expertQuestion;
      if (text.length < qLim.min || text.length > qLim.max) {
        throw badRequest("invalid_question", `Bilirkişiye soru ${qLim.min} ile ${qLim.max} karakter arasında olmalıdır.`);
      }
      const q: QuestionRow = {
        id: newId(),
        proposal_id: proposalId,
        author_id: userId,
        body: text,
        minority_guaranteed: minorityGuaranteed ? 1 : 0,
        created_at: clock.now(),
      };
      db.run(
        "INSERT INTO expert_questions(id, proposal_id, author_id, body, minority_guaranteed, created_at) VALUES (?, ?, ?, ?, ?, ?)",
        q.id,
        q.proposal_id,
        q.author_id,
        q.body,
        q.minority_guaranteed,
        q.created_at,
      );
      return toQuestion(q);
    },

    async drawPanel(proposalId, opts) {
      if (!proposalExists(proposalId)) throw notFound("Öneri");
      const now = clock.now();
      if (!Number.isInteger(opts.k) || opts.k < 1 || opts.k > MAX_PANEL) {
        throw badRequest("invalid_panel_size", `Panel büyüklüğü 1 ile ${MAX_PANEL} arasında bir tamsayı olmalıdır.`);
      }
      if (!Number.isFinite(opts.dueAt) || opts.dueAt <= now) {
        throw badRequest("invalid_due", "Rapor teslim zamanı gelecekte olmalıdır.");
      }
      if (typeof opts.authorId !== "string" || !opts.authorId) throw badRequest("invalid_author", "Öneri yazarı belirtilmelidir.");
      const categories = normalizeDomains(opts.categories);
      const counter = !!opts.counter;
      const block = resolveSeedBlock(opts.seedBlock);
      const round = (db.get<{ n: number }>("SELECT COUNT(*) AS n FROM expert_panels WHERE proposal_id = ?", proposalId)?.n ?? 0) + 1;
      const panelId = newId();
      const seed = drawSeed(block.hash, proposalId, round);
      const seedSource = { blockHash: block.hash, blockHeight: block.height, proposalId, round };

      const experts = db
        .all<{ user_id: string; domains: string; reputation: number }>(
          `SELECT e.user_id, e.domains, e.reputation FROM experts e JOIN users u ON u.id = e.user_id
           WHERE e.status = 'active' AND u.status = 'verified'`,
        )
        .sort((a, b) => byId(a.user_id, b.user_id));
      const prior = db.all<{ expert_id: string; status: string }>(
        "SELECT expert_id, status FROM expert_assignments WHERE proposal_id = ?",
        proposalId,
      );
      const priorPanelists = new Set(prior.map((r) => r.expert_id));
      const recused = new Set(prior.filter((r) => r.status === "recused").map((r) => r.expert_id));
      const loads = new Map(
        db
          .all<{ expert_id: string; n: number }>(
            `SELECT expert_id, COUNT(*) AS n FROM expert_assignments WHERE status IN ${PENDING_SQL} GROUP BY expert_id`,
          )
          .map((r) => [r.expert_id, r.n] as const),
      );
      const coiCache = new Map<string, ConflictCheck>();
      const coi = (id: string): ConflictCheck => {
        let c = coiCache.get(id);
        if (!c) coiCache.set(id, (c = graph.conflictOfInterest(id, opts.authorId, { householdOf })));
        return c;
      };

      const evaluate = (e: { user_id: string; reputation: number }): StoredCandidate => {
        const id = e.user_id;
        if (id === opts.authorId) return { userId: id, weight: 0, softConflict: 0, excludedReason: "Önerinin yazarı" };
        const c = coi(id);
        const soft = clamp01(c.soft);
        let reason: string | undefined;
        if (c.hard) {
          const why = c.reasons.map((r) => r.trim().replace(/\.$/, "")).filter(Boolean);
          reason = CONFLICT_REASON + (why.length ? ` (${why.join("; ")})` : " (aile, iş ya da hane bağı)");
        } else if (recused.has(id)) {
          reason = "Bu öneride daha önce çekinme beyan etti";
        } else if (priorPanelists.has(id)) {
          reason = counter ? "Önceki panelde görev aldı; karşı panele giremez" : "Bu önerinin önceki panelinde görev aldı";
        }
        if (reason) return { userId: id, weight: 0, softConflict: soft, excludedReason: reason };
        return { userId: id, weight: expertWeight(e.reputation, loads.get(id) ?? 0, soft), softConflict: soft };
      };

      const poolFor = (cats: string[]): StoredCandidate[] =>
        experts.filter((e) => domainsOf(e).some((d) => cats.some((c) => sub(d, c) || sub(c, d)))).map(evaluate);

      let candidates = poolFor(categories);
      let selected: string[] = [];
      let widened = 0;
      const levels = [categories, ...widenLevels(categories)];
      for (let L = 0; L < levels.length; L++) {
        const pool = L === 0 ? candidates : poolFor(levels[L]);
        const eligible = pool.filter((c) => c.weight > 0);
        if (eligible.length === 0) continue;
        candidates = pool;
        widened = L;
        selected = math
          .drawWeighted(eligible.map((c) => ({ id: c.userId, weight: c.weight })), opts.k, seed)
          .map((c) => c.id);
        break;
      }
      const noExpert = selected.length === 0;

      const p: PanelRow = {
        id: panelId,
        proposal_id: proposalId,
        round,
        is_counter: counter ? 1 : 0,
        seed,
        seed_source: JSON.stringify(seedSource),
        candidates: JSON.stringify(candidates),
        selected: JSON.stringify(selected),
        no_expert: noExpert ? 1 : 0,
        ledger_tx: null,
        created_at: now,
      };
      db.tx(() => {
        db.run(
          `INSERT INTO expert_panels(id, proposal_id, round, is_counter, seed, seed_source, candidates, selected, no_expert, ledger_tx, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)`,
          p.id,
          p.proposal_id,
          p.round,
          p.is_counter,
          p.seed,
          p.seed_source,
          p.candidates,
          p.selected,
          p.no_expert,
          p.created_at,
        );
        for (const expertId of selected) {
          db.run(
            "INSERT INTO expert_assignments(id, panel_id, proposal_id, expert_id, status, due_at, created_at, updated_at) VALUES (?, ?, ?, ?, 'invited', ?, ?, ?)",
            newId(),
            panelId,
            proposalId,
            expertId,
            opts.dueAt,
            now,
            now,
          );
        }
        const { txHash } = ledger.submit("EXPERT_DRAW", {
          proposalId,
          panelId,
          round,
          isCounter: counter,
          k: opts.k,
          widened,
          seed,
          seedSource,
          candidates: candidates.map((c) => ({
            ref: candidateRef(c.userId, panelId),
            weight: c.weight,
            softConflict: c.softConflict,
            excluded: !!c.excludedReason,
          })),
          selected: selected.map((id) => candidateRef(id, panelId)),
        });
        p.ledger_tx = txHash;
        db.run("UPDATE expert_panels SET ledger_tx = ? WHERE id = ?", txHash, panelId);
        for (const expertId of selected) notifyInvite(expertId, proposalId, opts.dueAt);
        if (noExpert) {
          notifier.notify(opts.authorId, {
            kind: "expert_unavailable",
            title: "Bilirkişi bulunamadı",
            body: "Önerinizin alanında (üst kategoriler dahil) uygun bilirkişi bulunamadı. Süreç raporsuz devam edecek.",
            link: `/oneriler/${proposalId}`,
          });
        }
        audit.log(null, "expert.draw", `proposal:${proposalId}`, { panelId, round, counter, widened, selected: selected.length, noExpert });
      });
      return buildPanel(p, true); // iç çağrı (zamanlayıcı); HTTP'ye çıkmaz
    },

    async respond(assignmentId, expertId, decision, reason) {
      const a = assignmentRow(assignmentId);
      if (!a) throw notFound("Görev");
      if (a.expert_id !== expertId) throw forbidden("Bu görev size atanmamış.");
      const now = clock.now();
      if (decision === "accept") {
        if (a.status !== "invited") {
          throw conflict("invalid_state", `Bu görev kabul edilemez (durum: ${ASSIGNMENT_STATUS_LABELS[a.status] ?? a.status}).`);
        }
        db.tx(() => {
          db.run("UPDATE expert_assignments SET status = 'accepted', updated_at = ? WHERE id = ?", now, a.id);
          audit.log(expertId, "expert.accept", `assignment:${a.id}`, { proposalId: a.proposal_id });
        });
      } else if (decision === "recuse") {
        if (!isPending(a.status)) {
          throw conflict("invalid_state", `Bu görevden çekinme beyan edilemez (durum: ${ASSIGNMENT_STATUS_LABELS[a.status] ?? a.status}).`);
        }
        const why = typeof reason === "string" && reason.trim() ? reason.trim() : null;
        if (why && why.length > TEXT_LIMITS.expertRecuseReason.max) {
          throw badRequest("reason_too_long", `Çekinme gerekçesi en fazla ${TEXT_LIMITS.expertRecuseReason.max} karakter olabilir.`);
        }
        db.tx(() => {
          db.run("UPDATE expert_assignments SET status = 'recused', recuse_reason = ?, updated_at = ? WHERE id = ?", why, now, a.id);
          const substitutedBy = substitute(a, "recused");
          audit.log(expertId, "expert.recuse", `assignment:${a.id}`, { proposalId: a.proposal_id, substituted: !!substitutedBy });
        });
      } else {
        throw badRequest("invalid_decision", "Yanıt 'accept' (kabul) ya da 'recuse' (çekinme) olmalıdır.");
      }
      return buildPanel(panelRow(a.panel_id)!);
    },

    async submitReport(assignmentId, expertId, input) {
      const a = assignmentRow(assignmentId);
      if (!a) throw notFound("Görev");
      if (a.expert_id !== expertId) throw forbidden("Bu görev size atanmamış.");
      if (!isPending(a.status)) {
        throw conflict("invalid_state", `Bu görev için rapor verilemez (durum: ${ASSIGNMENT_STATUS_LABELS[a.status] ?? a.status}).`);
      }
      if (!input || typeof input !== "object") throw badRequest("invalid_report", "Rapor içeriği eksik.");
      if (!ASSESSMENTS.includes(input.assessment)) {
        throw badRequest("invalid_assessment", "Değerlendirme 'feasible', 'infeasible' ya da 'uncertain' olmalıdır.");
      }
      if (typeof input.confidence !== "number" || !Number.isFinite(input.confidence) || input.confidence < 0 || input.confidence > 1) {
        throw badRequest("invalid_confidence", "Güven değeri 0 ile 1 arasında olmalıdır.");
      }
      const body = typeof input.body === "string" ? input.body.trim() : "";
      if (body.length < TEXT_LIMITS.expertReportBody.min) {
        throw badRequest("body_too_short", `Rapor metni en az ${TEXT_LIMITS.expertReportBody.min} karakter olmalıdır.`);
      }
      if (body.length > TEXT_LIMITS.expertReportBody.max) {
        throw badRequest("body_too_long", `Rapor metni en fazla ${TEXT_LIMITS.expertReportBody.max} karakter olabilir.`);
      }
      if (!Array.isArray(input.risks) || input.risks.some((r) => typeof r !== "string")) {
        throw badRequest("invalid_risks", "Riskler metin dizisi olmalıdır.");
      }
      const risks = input.risks.map((r) => r.trim()).filter(Boolean);
      if (risks.length > 50 || risks.some((r) => r.length > TEXT_LIMITS.expertReportRisk.max)) {
        throw badRequest("invalid_risks", `En fazla 50 risk yazılabilir; her biri en fazla ${TEXT_LIMITS.expertReportRisk.max} karakter olmalıdır.`);
      }
      if (!Array.isArray(input.answers)) throw badRequest("invalid_answers", "Yanıtlar dizi olmalıdır.");
      const questions = questionRows(a.proposal_id);
      const qIds = new Set(questions.map((q) => q.id));
      const answers: { questionId: string; answer: string }[] = [];
      for (const x of input.answers) {
        if (!x || typeof x.questionId !== "string" || typeof x.answer !== "string") {
          throw badRequest("invalid_answers", "Her yanıt bir soru kimliği ve metin içermelidir.");
        }
        if (!qIds.has(x.questionId)) throw badRequest("foreign_question", "Yanıtlanan soru bu öneriye ait değil.");
        if (answers.some((y) => y.questionId === x.questionId)) {
          throw badRequest("duplicate_answer", "Aynı soru birden fazla kez yanıtlanamaz.");
        }
        const answer = x.answer.trim();
        if (answer.length > TEXT_LIMITS.expertReportAnswer.max) {
          throw badRequest("answer_too_long", `Bir yanıt en fazla ${TEXT_LIMITS.expertReportAnswer.max} karakter olabilir.`);
        }
        answers.push({ questionId: x.questionId, answer });
      }
      // Azınlık güvenceli soru (öneride en küçük anlamlı kümeden sorulan ilk soru) yanıtlanmadan rapor kabul edilmez:
      // arayüzün verdiği "yanıtlanması zorunludur" güvencesi sunucuda uygulanır. Diğer sorular yalnız itibar ölçütüdür.
      const unanswered = questions.filter(
        (q) => q.minority_guaranteed === 1 && (answers.find((x) => x.questionId === q.id)?.answer.length ?? 0) < MIN_GUARANTEED_ANSWER,
      );
      if (unanswered.length > 0) {
        throw badRequest(
          "minority_question_unanswered",
          unanswered.length === 1
            ? `Azınlık güvenceli soru yanıtlanmadan rapor gönderilemez (yanıt en az ${MIN_GUARANTEED_ANSWER} karakter olmalıdır).`
            : `${unanswered.length} azınlık güvenceli soru yanıtlanmadan rapor gönderilemez (her yanıt en az ${MIN_GUARANTEED_ANSWER} karakter olmalıdır).`,
          { questionIds: unanswered.map((q) => q.id) },
        );
      }
      if (input.dissent !== undefined && input.dissent !== null && typeof input.dissent !== "string") {
        throw badRequest("invalid_dissent", "Karşı görüş metin olmalıdır.");
      }
      const dissent = typeof input.dissent === "string" && input.dissent.trim() ? input.dissent.trim() : null;
      if (dissent && dissent.length > TEXT_LIMITS.expertReportDissent.max) {
        throw badRequest("dissent_too_long", `Karşı görüş en fazla ${TEXT_LIMITS.expertReportDissent.max} karakter olabilir.`);
      }

      // YZ denetimi danışmadır: hata verirse rapor yine kabul edilir.
      let lint: StoredLint;
      try {
        const er = expertRow(expertId);
        const aiOk = db.get<{ ai_consent: number }>("SELECT ai_consent FROM users WHERE id = ?", expertId)?.ai_consent === 1;
        const r = await ai.lintExpertReport(dissent ? `${body}\n\n${dissent}` : body, {
          forceOffline: !aiOk,
          domains: er ? domainsOf(er).map((d) => ontology.categoryLabel(d)) : [],
        });
        lint = { issues: Array.isArray(r.issues) ? r.issues : [], model: r.model, offline: r.offline, label: aiLabel(r.model, clock.now()) };
      } catch {
        lint = { issues: [], model: "", offline: true, label: "" };
      }

      const now = clock.now();
      const answered = new Set(answers.filter((x) => x.answer.length > 0).map((x) => x.questionId));
      const score = reportScore({
        timely: now <= a.due_at,
        allAnswered: questions.every((q) => answered.has(q.id)),
        inDomain: !lint.issues.some((i) => i.kind === "out_of_domain"),
        noLegalQualification: !lint.issues.some((i) => i.kind === "legal_qualification"),
      });
      const reportId = newId();
      // Tuz olarak herkese açık rapor kimliği kullanılır: rapor metni zaten kamusaldır ve böylece
      // herkes contentHash(id, body) ile defterdeki özeti doğrulayabilir.
      const hash = contentHash(reportId, body);

      return db.tx(() => {
        const cur = assignmentRow(a.id);
        if (!cur || !isPending(cur.status)) throw conflict("invalid_state", "Bu görev için rapor zaten verilmiş ya da görev kapanmış.");
        const row: ReportRow = {
          id: reportId,
          assignment_id: a.id,
          proposal_id: a.proposal_id,
          expert_id: expertId,
          assessment: input.assessment,
          confidence: input.confidence,
          risks: JSON.stringify(risks),
          answers: JSON.stringify(answers),
          body,
          dissent,
          lint: JSON.stringify(lint),
          score,
          content_hash: hash,
          ledger_tx: null,
          created_at: now,
        };
        db.run(
          `INSERT INTO expert_reports(id, assignment_id, proposal_id, expert_id, assessment, confidence, risks, answers, body, dissent, lint, score, content_hash, ledger_tx, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, ?)`,
          row.id,
          row.assignment_id,
          row.proposal_id,
          row.expert_id,
          row.assessment,
          row.confidence,
          row.risks,
          row.answers,
          row.body,
          row.dissent,
          row.lint,
          row.score,
          row.content_hash,
          row.created_at,
        );
        db.run("UPDATE expert_assignments SET status = 'reported', updated_at = ? WHERE id = ?", now, a.id);
        const e = expertRow(expertId);
        if (e) setReputation(expertId, updatedReputation(e.reputation, score));
        const { txHash } = ledger.submit("EXPERT_REPORT", {
          proposalId: a.proposal_id,
          reportId,
          assessment: input.assessment,
          confidence: input.confidence,
          contentHash: hash,
        });
        row.ledger_tx = txHash;
        db.run("UPDATE expert_reports SET ledger_tx = ? WHERE id = ?", txHash, reportId);
        const author = db.get<{ author_id: string }>("SELECT author_id FROM proposals WHERE id = ?", a.proposal_id)?.author_id;
        if (author) {
          notifier.notify(author, {
            kind: "expert_report",
            title: "Önerinize bilirkişi raporu geldi",
            body: `Bir bilirkişi raporu eklendi (değerlendirme: ${ASSESSMENT_LABELS[input.assessment]}).`,
            link: `/oneriler/${a.proposal_id}`,
          });
        }
        audit.log(expertId, "expert.report", `assignment:${a.id}`, { proposalId: a.proposal_id, reportId, score });
        return toReport(row);
      });
    },

    panel(proposalId, viewer) {
      const p = db.get<PanelRow>("SELECT * FROM expert_panels WHERE proposal_id = ? ORDER BY round DESC LIMIT 1", proposalId);
      return p ? buildPanel(p, canSeeExclusionDetail(viewer)) : null;
    },

    suspensiveFlag(proposalId) {
      return suspensiveFor(proposalId);
    },

    cancelPending(proposalId) {
      const n = db.run(
        `UPDATE expert_assignments SET status = 'cancelled', updated_at = ? WHERE proposal_id = ? AND status IN ${PENDING_SQL}`,
        clock.now(),
        proposalId,
      ).changes;
      if (n > 0) audit.log(null, "expert.cancel_pending", `proposal:${proposalId}`, { count: n });
      return n;
    },

    markOverdue(now) {
      const rows = db.all<AssignmentRow>(
        `SELECT * FROM expert_assignments WHERE status IN ${PENDING_SQL} AND due_at < ? ORDER BY due_at, rowid`,
        now,
      );
      if (rows.length === 0) return 0;
      db.tx(() => {
        for (const a of rows) {
          db.run("UPDATE expert_assignments SET status = 'overdue', updated_at = ? WHERE id = ?", clock.now(), a.id);
          const e = expertRow(a.expert_id);
          if (e) setReputation(a.expert_id, updatedReputation(e.reputation, 0));
          notifier.notify(a.expert_id, {
            kind: "expert_overdue",
            title: "Bilirkişi raporunun süresi geçti",
            body: "Rapor süresi içinde teslim edilmedi; görev gecikmiş olarak işaretlendi ve itibarınız düşürüldü.",
            link: `/oneriler/${a.proposal_id}`,
          });
        }
      });
      return rows.length;
    },

    assignmentsFor(expertId) {
      return db
        .all<AssignmentRow>("SELECT * FROM expert_assignments WHERE expert_id = ? ORDER BY created_at DESC, rowid DESC", expertId)
        .map((a) => ({ assignmentId: a.id, proposalId: a.proposal_id, status: a.status, dueAt: a.due_at }));
    },
  };

  return service;
}
