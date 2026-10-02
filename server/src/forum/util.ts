// Forum çekirdeğinin ortak yardımcıları: satır tipleri, durum kümeleri, doğrulama, işlem sonrası yan etkiler.
import { createHmac } from "node:crypto";
import { z } from "zod";
import {
  DELETION_GROUND_VOCAB,
  expandIri,
  fy,
  hashCanonical,
  type AmendmentPayload,
  type AuditReport,
  type DecisionParams,
  type DeletionPayload,
  type LedgerTxType,
  type ProposalKind,
  type ProposalStatus,
  type RegulationPatch,
  type Role,
} from "@forum/shared";
import type { AuditLogger } from "../core/audit";
import { HOUR } from "../core/clock";
import type { Config } from "../core/config";
import type { AuthUser } from "../core/contracts";
import { AppError, badRequest, forbidden, notFound } from "../core/errors";
import type { ForumDeps } from "../core/forum-contracts";
import { json, type Db, type SqlValue } from "../db";
import { prepareTx } from "../ledger/tx";

// ───────────── Durumlar ─────────────

export const CLOSED_STATUSES: readonly ProposalStatus[] = ["enacted", "rejected", "inadmissible", "withdrawn", "expired"];
/** Zamanlayıcının yönettiği (taslak ve kapanmış dışındaki) durumlar. */
export const ACTIVE_STATUSES: readonly ProposalStatus[] = ["sponsoring", "deliberation", "voting", "objection_window", "reconciliation", "revote"];
export const ALL_STATUSES: readonly ProposalStatus[] = ["draft", ...ACTIVE_STATUSES, ...CLOSED_STATUSES];
const CLOSED = new Set<string>(CLOSED_STATUSES);
const ACTIVE = new Set<string>(ACTIVE_STATUSES);

export const isClosed = (s: string): boolean => CLOSED.has(s);
export const isActive = (s: string): boolean => ACTIVE.has(s);
export const isVotingStatus = (s: string): boolean => s === "voting" || s === "revote";

/** SQL `IN (...)` için sabit durum listesi (kullanıcı girdisi değildir). */
export const sqlList = (items: readonly string[]): string => "(" + items.map((s) => `'${s}'`).join(", ") + ")";
export const ACTIVE_SQL = sqlList(ACTIVE_STATUSES);
export const CLOSED_SQL = sqlList(CLOSED_STATUSES);

// ───────────── Satır tipleri ─────────────

export interface ProposalRow {
  id: string;
  seq: number;
  kind: ProposalKind;
  title: string;
  body: string;
  author_id: string;
  parent_topic_id: string | null;
  amendment_payload: string | null;
  deletion_payload: string | null;
  regulation_patch: string | null;
  categories: string;
  rights_flags: string;
  request_expert: number;
  tier: string | null;
  status: ProposalStatus;
  version: number;
  audit_report: string | null;
  params: string | null;
  bylaw_version: number | null;
  phase_started_at: number | null;
  phase_ends_at: number | null;
  voting_round: number;
  extension_used: number;
  reconciliation_used: number;
  reconciliation_origin: "contested" | "objection" | null;
  strong_objection: number;
  expert_extension_used: number;
  cluster_snapshot_id: string | null;
  eligible_count: number | null;
  enacted_entity_id: string | null;
  expert_draw_height: number | null;
  content_labels: string;
  final_reason: string | null;
  created_at: number;
  updated_at: number;
}

export interface MessageRow {
  id: string;
  seq: number;
  thread_type: "topic" | "proposal";
  thread_id: string;
  parent_id: string | null;
  author_id: string;
  stance: string;
  body: string;
  version: number;
  visibility: "visible" | "collapsed" | "hidden" | "sealed";
  hidden_by_proposal_id: string | null;
  hidden_ground: string | null;
  content_salt: string;
  content_hash: string;
  ledger_tx: string | null;
  ai_flags: string | null;
  created_at: number;
  updated_at: number;
}

export interface TopicRow {
  id: string;
  seq: number;
  parent_id: string | null;
  title: string;
  body: string;
  categories: string;
  origin_proposal_id: string | null;
  current_version: number;
  status: "active" | "archived";
  created_at: number;
  updated_at: number;
}

export interface TallyRow {
  id: string;
  proposal_id: string;
  round: number;
  result: string;
  tally_payload: string | null;
  reveal_payload: string | null;
  ledger_tx: string | null;
  reveal_ledger_tx: string | null;
  interim: number;
  delegation_trace: string | null;
  created_at: number;
}

export interface BallotRow {
  proposal_id: string;
  round: number;
  user_id: string;
  ballot_id: string;
  choice: "yes" | "no" | "abstain";
  salt: string;
  commitment: string;
  ledger_tx: string | null;
  cast_at: number;
  updated_at: number;
}

export interface UserRowLite {
  id: string;
  nickname: string;
  status: string;
  roles: string;
  reputation: number;
  created_at: number;
  verified_at: number | null;
  is_adult: number;
  political_consent: number;
  ai_consent: number;
}

export interface RightsFlag {
  right: string;
  direction: "restrict" | "expand";
  source: "author" | "ai" | "expert" | "member";
}

export interface ContentLabel {
  label: string;
  confidence: number;
  source: "ai" | "rule";
}

/** Bir öneri satırının JSON alanlarının çözülmüş hâli. */
export interface ParsedProposal {
  categories: string[];
  rightsFlags: RightsFlag[];
  contentLabels: ContentLabel[];
  audit: AuditReport | null;
  /** Oylama açılışında sabitlenen parametreler (yoksa null) */
  fixedParams: DecisionParams | null;
  amendment: AmendmentPayload | null;
  deletion: DeletionPayload | null;
  patch: RegulationPatch | null;
}

export function parseProposal(p: ProposalRow): ParsedProposal {
  return {
    categories: json<string[]>(p.categories, []),
    rightsFlags: json<RightsFlag[]>(p.rights_flags, []),
    contentLabels: json<ContentLabel[]>(p.content_labels, []),
    audit: json<AuditReport | null>(p.audit_report, null),
    fixedParams: json<DecisionParams | null>(p.params, null),
    amendment: json<AmendmentPayload | null>(p.amendment_payload, null),
    deletion: json<DeletionPayload | null>(p.deletion_payload, null),
    patch: json<RegulationPatch | null>(p.regulation_patch, null),
  };
}

export const proposalRef = (p: { seq: number }): string => `#K-${p.seq}`;
export const proposalLink = (id: string): string => `/oneriler/${id}`;
export const topicLink = (id: string): string => `/konular/${id}`;
export const textHash = (title: string, body: string): string => hashCanonical({ title, body });
export const hoursToMs = (h: number): number => Math.max(0, h) * HOUR;

// ───────────── Süreler (parametre yoksa ALGORITMA.md §2 varsayılanları) ─────────────

const DEFAULT_DURATIONS: Record<"DEL" | "T0", DecisionParams["durationsHours"]> = {
  T0: { sponsoring: 168, deliberation: 72, voting: 72, extension: 24, objection: 48, reconciliation: 72 },
  DEL: { sponsoring: 72, deliberation: 24, voting: 48, extension: 24, objection: 0, reconciliation: 0 },
};

export function durationsOf(p: ProposalRow, parsed: ParsedProposal = parseProposal(p)): DecisionParams["durationsHours"] {
  return parsed.fixedParams?.durationsHours ?? parsed.audit?.params?.durationsHours ?? DEFAULT_DURATIONS[p.kind === "deletion" ? "DEL" : "T0"];
}

// ───────────── Silme gerekçeleri ─────────────

export const GORUS_AYRILIGI = fy("GorusAyriligi");
export const KISISEL_VERI = fy("KisiselVeriIfsasi");

export function groundIsUrgent(deps: Pick<ForumDeps, "ontology">, iri: string): boolean {
  const g = safe(() => deps.ontology.deletionGrounds(), []).find((x) => x.iri === iri);
  if (g && g.urgent !== undefined) return !!g.urgent;
  return DELETION_GROUND_VOCAB.some((v) => fy(v.local) === iri && v.urgent);
}

export function groundIsSealed(deps: Pick<ForumDeps, "ontology">, iri: string): boolean {
  const g = safe(() => deps.ontology.deletionGrounds(), []).find((x) => x.iri === iri);
  if (g && g.sealed !== undefined) return !!g.sealed;
  return DELETION_GROUND_VOCAB.some((v) => fy(v.local) === iri && v.sealed);
}

export function groundLabel(deps: Pick<ForumDeps, "ontology">, iri: string | null): string {
  if (!iri) return "belirtilmemiş";
  const g = safe(() => deps.ontology.deletionGrounds(), []).find((x) => x.iri === iri);
  if (g) return g.label;
  const v = DELETION_GROUND_VOCAB.find((x) => fy(x.local) === iri);
  return v?.label ?? iri;
}

export function safe<T>(fn: () => T, fallback: T): T {
  try {
    return fn();
  } catch {
    return fallback;
  }
}

/** Kısa ad ("fy:Ulasim") dahil IRI'yi tam biçime çevirir. */
export const normIri = (iri: string): string => expandIri(String(iri).trim());

// ───────────── Yetki ─────────────

export function hasRole(actor: { roles: readonly Role[] } | null | undefined, ...roles: Role[]): boolean {
  return !!actor && roles.some((r) => actor.roles.includes(r));
}

/** Doğrulanmış ve etkin (askıda/silinmiş olmayan) üye şartı. */
export function requireVerified(actor: AuthUser | null | undefined, what = "Bu işlem"): asserts actor is AuthUser {
  if (!actor) throw forbidden("Oturum açmanız gerekiyor.");
  if (actor.status !== "verified") throw forbidden(`${what} için kimliği doğrulanmış (askıda olmayan) üye olmanız gerekir.`);
}

// ───────────── Doğrulama ─────────────

/** 400 validation: `details` = { "<alan.yolu>": "<kullanıcıya gösterilecek Türkçe ileti>" } (kimlik/HTTP ile aynı biçim). */
export function fieldError(field: string, message: string, summary?: string): AppError {
  return badRequest("validation", summary ?? message, { [field]: message });
}

const FIELD_LABELS: Record<string, string> = {
  kind: "Öneri türü",
  title: "Başlık",
  body: "Metin",
  categories: "Kategoriler",
  parentTopicId: "Hedef konu",
  amendment: "Düzenleme bilgisi",
  "amendment.baseVersion": "Dayanılan konu sürümü",
  deletion: "Silme talebi",
  "deletion.messageIds": "Hedef mesajlar",
  "deletion.ground": "Silme gerekçesi",
  "deletion.statement": "Gerekçe açıklaması",
  regulationPatch: "Yönetmelik yaması",
  "regulationPatch.ops": "Yama işlemleri",
  "regulationPatch.rationale": "Yama gerekçesi",
  requestExpert: "Bilirkişi talebi",
  submit: "Gönder seçeneği",
  acknowledgePii: "Kişisel veri onayı",
  stance: "Tutum",
  parentId: "Yanıtlanan mesaj",
  choice: "Oy",
  ground: "Gerekçe",
  statement: "Açıklama",
  right: "Temel hak",
  direction: "Etki yönü",
  remove: "Kaldırma seçeneği",
  status: "Durum",
  q: "Arama metni",
  topicId: "Konu",
  authorId: "Yazar",
  mine: "Yalnız benimkiler",
  limit: "Sınır",
  rule: "Kural",
  param: "Parametre",
  value: "Değer",
  op: "Yama işlemi",
  iri: "IRI",
  label: "Etiket",
  parent: "Üst kategori",
  keywords: "Anahtar kelimeler",
  article: "Madde",
  number: "Madde numarası",
  text: "Madde metni",
  protection: "Koruma düzeyi",
};

const TYPE_TR: Record<string, string> = { string: "metin", number: "sayı", int: "tam sayı", boolean: "evet/hayır", array: "liste", object: "nesne" };

function fieldLabel(path: readonly PropertyKey[]): string {
  const keys = path.filter((k) => typeof k === "string") as string[];
  return FIELD_LABELS[keys.join(".")] ?? FIELD_LABELS[keys[keys.length - 1] ?? ""] ?? "Alan";
}

/** zod'un varsayılan (İngilizce) iletilerini Türkçeleştirir; şemada açık Türkçe ileti varsa o kullanılır. */
function trIssue(iss: { code?: string; path?: readonly PropertyKey[]; input?: unknown; [k: string]: unknown }): string {
  const label = fieldLabel(iss.path ?? []);
  const origin = String(iss.origin ?? "");
  const unit = origin === "string" ? " karakter" : origin === "array" || origin === "set" ? " öğe" : "";
  switch (iss.code) {
    case "invalid_type":
      return iss.input === undefined || iss.input === null ? `${label} zorunludur.` : `${label} geçersiz: ${TYPE_TR[String(iss.expected)] ?? String(iss.expected)} bekleniyor.`;
    case "too_small":
      return origin === "array" && Number(iss.minimum) === 1 ? `${label} boş olamaz.` : `${label} en az ${String(iss.minimum)}${unit} olmalıdır.`;
    case "too_big":
      return `${label} en fazla ${String(iss.maximum)}${unit} olabilir.`;
    case "invalid_value":
      return `${label} şu değerlerden biri olmalıdır: ${((iss.values as unknown[]) ?? []).map(String).join(", ")}.`;
    case "invalid_union":
      return `${label} geçersiz.`;
    case "unrecognized_keys":
      return `Tanınmayan alan: ${((iss.keys as string[]) ?? []).join(", ")}.`;
    case "invalid_format":
      return `${label} biçimi geçersiz.`;
    default:
      return `${label} geçersiz.`;
  }
}

/** zod şeması ile ayrıştırır; hata → 400 validation, details = { alan.yolu: Türkçe ileti }. */
export function parseInput<T>(schema: z.ZodType<T>, value: unknown): T {
  const r = schema.safeParse(value, { error: (iss) => trIssue(iss as never) });
  if (r.success) return r.data;
  const details: Record<string, string> = {};
  for (const i of r.error.issues) {
    const path = i.path.map(String).join(".") || "_";
    if (!(path in details)) details[path] = i.message;
  }
  const first = Object.values(details)[0];
  throw badRequest("validation", first ?? "İstek geçersiz.", details);
}

/** Kırpılmış uzunluk denetimi (Türkçe ileti). */
export function checkLength(value: string, min: number, max: number, field: string, label: string): string {
  const v = value.trim();
  if (v.length < min) throw fieldError(field, `${label} en az ${min} karakter olmalıdır (şu an ${v.length}).`);
  if (v.length > max) throw fieldError(field, `${label} en fazla ${max} karakter olabilir (şu an ${v.length}).`);
  return v;
}

const patchOp = z.discriminatedUnion("op", [
  z.object({ op: z.literal("setParam"), rule: z.string().min(1).max(500), param: z.string().min(1).max(200), value: z.union([z.number(), z.boolean(), z.string().max(500)]) }),
  z.object({
    op: z.literal("addCategory"),
    iri: z.string().min(1).max(500),
    label: z.string().min(1).max(200),
    parent: z.string().min(1).max(500),
    keywords: z.array(z.string().max(100)).max(50),
    requiresExpert: z.boolean().optional(),
  }),
  z.object({ op: z.literal("amendArticleText"), article: z.string().min(1).max(500), text: z.string().min(1).max(20000) }),
  z.object({
    op: z.literal("addArticle"),
    iri: z.string().min(1).max(500),
    number: z.string().min(1).max(100),
    title: z.string().min(1).max(300),
    text: z.string().min(1).max(20000),
    protection: z.enum(["Nitelikli", "Olagan"]),
  }),
  z.object({ op: z.literal("setProtection"), article: z.string().min(1).max(500), protection: z.enum(["Degistirilemez", "Nitelikli", "Olagan"]) }),
]);

export const regulationPatchSchema = z.object({
  ops: z.array(patchOp).min(1, "Yama en az bir işlem içermelidir.").max(50, "Yama en fazla 50 işlem içerebilir."),
  rationale: z.string().max(10000).default(""),
});

export const createProposalSchema = z.object({
  kind: z.enum(["topic", "subtopic", "amendment", "deletion", "regulation"], { error: "Öneri türü topic, subtopic, amendment, deletion ya da regulation olmalıdır." }),
  title: z.string().max(1000, "Başlık çok uzun.").default(""),
  body: z.string().max(40000, "Metin çok uzun.").default(""),
  categories: z.array(z.string().min(1).max(500)).max(30, "En fazla 30 kategori seçilebilir.").default([]),
  parentTopicId: z.string().max(200).nullish(),
  amendment: z.object({ baseVersion: z.number().int().min(1), newTitle: z.string().optional(), newBody: z.string().optional() }).nullish(),
  deletion: z
    .object({
      messageIds: z.array(z.string().min(1).max(200)).min(1, "En az bir mesaj seçilmelidir.").max(20, "Bir talepte en fazla 20 mesaj seçilebilir."),
      ground: z.string().min(1).max(500),
      statement: z.string().max(5000).default(""),
    })
    .nullish(),
  regulationPatch: regulationPatchSchema.nullish(),
  requestExpert: z.boolean().optional(),
  submit: z.boolean().optional(),
  acknowledgePii: z.boolean().optional(),
});
export type CreateInput = z.infer<typeof createProposalSchema>;

export const voteChoiceSchema = z.enum(["yes", "no", "abstain"], { error: "Oy “yes” (kabul), “no” (red) ya da “abstain” (çekimser) olmalıdır." });
export const stanceSchema = z.enum(["pro", "con", "neutral", "question"], { error: "Tutum “pro”, “con”, “neutral” ya da “question” olmalıdır." });

// ───────────── Çekirdek bağlam ─────────────

export interface Notice {
  kind: string;
  title: string;
  body: string;
  link?: string | null;
}

/** Forum servislerinin paylaştığı bağlam: işlem (tx) + işlem sonrası yan etkiler (bildirim, graf). */
export class ForumCore {
  readonly db: Db;
  readonly config: Config;
  readonly audit: AuditLogger;
  private pending: (() => void)[] | null = null;

  constructor(readonly deps: ForumDeps) {
    this.db = deps.ctx.db;
    this.config = deps.ctx.config;
    this.audit = deps.audit;
  }

  now(): number {
    return this.deps.ctx.clock.now();
  }

  /**
   * Tek bir SQLite işlemi. İç içe çağrılabilir (SAVEPOINT). `after` ile kuyruğa alınan yan etkiler (bildirimler, ertelenmiş defter
   * gönderimleri) yalnızca EN DIŞTAKİ işlem başarıyla bittiğinde (COMMIT sonrası) çalışır. Kuyruk savepoint'e göre kapsamlıdır:
   * iç işlem geri alınırsa o düzeyde kuyruğa alınanlar atılır (dış işlem iç hatayı yakalayıp devam etse bile); başarılıysa üst
   * düzeyin kuyruğuna katılır. Dış işlem geri alınırsa kuyruğun tamamı atılır.
   */
  tx<T>(fn: () => T): T {
    const outer = this.pending === null;
    if (outer) this.pending = [];
    const mark = this.pending!.length;
    let out: T;
    try {
      out = this.db.tx(fn);
    } catch (e) {
      if (outer) this.pending = null;
      else this.pending!.length = mark; // iç savepoint geri alındı: bu düzeyin yan etkileri de geri alınır
      throw e;
    }
    if (outer) {
      const jobs = this.pending ?? [];
      this.pending = null;
      for (const job of jobs) {
        try {
          job();
        } catch (e) {
          console.error("[forum] işlem sonrası görev başarısız:", e);
        }
      }
    }
    return out;
  }

  /** İşlem içindeyse işlem sonrasına ertelenir; değilse hemen çalışır. */
  after(job: () => void): void {
    if (this.pending) this.pending.push(job);
    else {
      try {
        job();
      } catch (e) {
        console.error("[forum] görev başarısız:", e);
      }
    }
  }

  notify(userIds: Iterable<string>, n: Notice): void {
    const ids = [...new Set(userIds)];
    if (ids.length === 0) return;
    this.after(() => {
      const notice = { kind: n.kind, title: n.title, body: n.body, link: n.link ?? null };
      const notifier = this.deps.notifier;
      // Toplu gönderim tek işlemde (alıcı başına otomatik işlem = fsync, yaşam döngüsü tick'ini bloklar).
      if (notifier.notifyMany) notifier.notifyMany(ids, notice);
      else for (const u of ids) notifier.notify(u, notice);
    });
  }

  /**
   * Deftere yazar ve işlem özetini döndürür. Yük kişisel veri ve kullanıcı kimliği içermemelidir.
   * Bir DB işleminin (tx) İÇİNDEYSE özet önceden hesaplanır ve gerçek gönderim EN DIŞTAKİ işlem COMMIT olduktan sonraya ertelenir:
   * defter kaydı geri alınamaz, bu yüzden geri alınan işlem deftere "hayalet" kayıt bırakmamalıdır. Yük doğrulaması (tür, kişisel
   * veri, boyut) yine hemen yapılır; hatası işlemi geri alır. İşlem dışındaysa hemen gönderilir.
   */
  submit(type: LedgerTxType, payload: Record<string, unknown>): string {
    if (this.pending === null) return this.deps.ledger.submit(type, payload).txHash;
    const tx = prepareTx(type, payload);
    this.after(() => {
      try {
        const sent = this.deps.ledger.submit(type, tx.payload, tx.nonce).txHash;
        if (sent !== tx.hash) throw new Error("defter özeti önceden hesaplanan özetle eşleşmiyor");
      } catch (e) {
        // COMMIT sonrası: DB işlemi geri alınamaz; kayıt eksik kalır, durum denetim günlüğüne ve loga düşer (yük yazılmaz).
        console.error(`[forum] ${type} defter kaydı COMMIT sonrası gönderilemedi (${tx.hash}):`, e);
        try {
          this.audit.log(null, "system.ledger_submit_failed", null, { type, txHash: tx.hash, code: e instanceof AppError ? e.code : "internal" });
        } catch {
          /* denetim yazılamıyorsa log yeterli */
        }
      }
    });
    return tx.hash;
  }

  /** ballotId = HMAC-SHA256(voteKey, userId|proposalId|round) — öneriye ve tura özel; defterden kişiye bağlanamaz. */
  ballotId(userId: string, proposalId: string, round: number): string {
    return createHmac("sha256", this.config.voteKey).update(`${userId}|${proposalId}|${round}`).digest("hex");
  }

  verifiedCount(): number {
    return Number(this.db.get<{ c: number }>("SELECT COUNT(*) AS c FROM users WHERE status = 'verified'")?.c ?? 0);
  }

  proposalRow(id: string): ProposalRow | undefined {
    return this.db.get<ProposalRow>("SELECT * FROM proposals WHERE id = ?", id);
  }

  requireProposal(id: string): ProposalRow {
    const p = this.proposalRow(id);
    if (!p) throw notFound("Öneri");
    return p;
  }

  user(id: string): UserRowLite | undefined {
    return this.db.get<UserRowLite>(
      "SELECT id, nickname, status, roles, reputation, created_at, verified_at, is_adult, political_consent, ai_consent FROM users WHERE id = ?",
      id,
    );
  }

  nicknames(ids: Iterable<string>): Map<string, string> {
    const list = [...new Set(ids)].filter(Boolean);
    const out = new Map<string, string>();
    if (list.length === 0) return out;
    for (const r of this.db.all<{ id: string; nickname: string }>(
      "SELECT id, nickname FROM users WHERE id IN (SELECT value FROM json_each(?))",
      JSON.stringify(list),
    )) {
      out.set(r.id, r.nickname);
    }
    return out;
  }

  /** UPDATE proposals SET ... — yalnızca sabit sütun adlarıyla çağrılır. */
  updateProposal(id: string, set: Record<string, SqlValue>): void {
    const keys = Object.keys(set);
    if (keys.length === 0) return;
    this.db.run(`UPDATE proposals SET ${keys.map((k) => `${k} = ?`).join(", ")} WHERE id = ?`, ...keys.map((k) => set[k]), id);
  }
}

export const jsonList = (ids: Iterable<string>): string => JSON.stringify([...new Set(ids)]);
