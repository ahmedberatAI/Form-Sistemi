// İstek gövdesi / sorgu / yol parametresi şemaları (zod 4). Tipler shared/src/api.ts ile uyumludur;
// dosyanın sonundaki derleme zamanı denetimleri bu uyumu güvenceye alır.
// Not: şemalar yalnızca biçimi denetler; iş kuralları (TCKN, şifre gücü, evre, yetki…) servislerdedir.
import { z } from "zod";
import {
  expandIri,
  type AiApproveRequest,
  type AssignmentRespondRequest,
  type ChangePasswordRequest,
  type ClockAdvanceRequest,
  type ConsentsRequest,
  type CreateProposalRequest,
  type DelegateRequest,
  type EdgeType,
  type EditMessageRequest,
  type EndorseRequest,
  type EraseRequest,
  type ExpertApplyRequest,
  type ExpertDecisionRequest,
  type ExpertQuestionRequest,
  type ExpertReportRequest,
  type ExpertRequestRequest,
  type ExpertSanctionRequest,
  type ExpertStatus,
  type FaultRequest,
  type LedgerTxType,
  type LintRequest,
  type LoginRequest,
  type MarkReadRequest,
  type MessagePrecheckRequest,
  type MinorityReportRequest,
  type ObjectionRequest,
  type PiiRequest,
  type PostMessageRequest,
  type ProposalKind,
  type ProposalListQuery,
  type ProposalStatus,
  type RebuttalRequest,
  type RegulationPatch,
  type RelateRequest,
  type RepairRequest,
  type RightsFlagRequest,
  type Role,
  type SetRolesRequest,
  type Stance,
  type SuggestionDecisionRequest,
  type SuggestionRequest,
  type TamperRequest,
  type ThreadType,
  type UpdateProposalRequest,
  type ValidatePatchRequest,
  type VerifyUserRequest,
  type VoteChoice,
  type VoteRequest,
  type VouchRequest,
} from "@forum/shared";

// ───────────── Sabit kümeler (shared tipleriyle birebir; aşağıda derleme zamanı denetimi) ─────────────

export const ROLES = ["member", "registrar", "auditor", "admin"] as const;
export const PROPOSAL_KINDS = ["topic", "subtopic", "amendment", "deletion", "regulation"] as const;
export const PROPOSAL_STATUSES = [
  "draft",
  "sponsoring",
  "inadmissible",
  "deliberation",
  "voting",
  "objection_window",
  "reconciliation",
  "revote",
  "enacted",
  "rejected",
  "withdrawn",
  "expired",
] as const;
export const VOTE_CHOICES = ["yes", "no", "abstain"] as const;
export const STANCES = ["pro", "con", "neutral", "question"] as const;
export const THREAD_TYPES = ["topic", "proposal"] as const;
export const EXPERT_STATUSES = ["applied", "active", "suspended", "removed", "rejected"] as const;
export const EDGE_TYPES = ["FOLLOWS", "VOUCHES", "DELEGATES_TO", "RELATED_TO", "REPLIED_TO", "ENDORSED", "AUTHORED", "EXPERT_IN", "AGREES"] as const;
export const LEDGER_TX_TYPES = [
  "MEMBER_REGISTERED",
  "MEMBER_VERIFIED",
  "MEMBER_ERASED",
  "PROPOSAL_CREATED",
  "PROPOSAL_VERSION",
  "SPONSORED",
  "PHASE_CHANGED",
  "VOTE_COMMIT",
  "BALLOT_REVEAL",
  "TALLY",
  "OBJECTION",
  "MINORITY_REPORT",
  "MESSAGE_POSTED",
  "MESSAGE_EDITED",
  "MESSAGE_HIDDEN",
  "TOPIC_REVISION",
  "EXPERT_DRAW",
  "EXPERT_REPORT",
  "AI_ANALYSIS",
  "BYLAW_VERSION",
  "CLUSTER_SNAPSHOT",
  "GRAPH_RUN",
  "DELEGATION",
  "EVIDENCE",
] as const;

// ───────────── Yapı taşları ─────────────

const text = (max: number) => z.string().max(max);
const requiredText = (max: number) => z.string().min(1).max(max);
/** Ontoloji IRI'si: kısa ad ("fy:Ulasim") tam IRI'ye genişletilir. */
const iri = z.string().min(1).max(300).transform(expandIri);
const id = z.string().min(1).max(200);
const qBool = z.enum(["1", "0", "true", "false"]).transform((v) => v === "1" || v === "true");
const qInt = (min: number, max: number) => z.coerce.number().int().min(min).max(max);
const qText = (max: number) => z.string().max(max);

// ───────────── Yol parametreleri ─────────────

export const idParams = z.object({ id });
export const userIdParams = z.object({ userId: id });
export const suggestionParams = z.object({ id, sid: id });
export const threadParams = z.object({ type: z.enum(THREAD_TYPES), id });
export const heightParams = z.object({ height: qInt(0, Number.MAX_SAFE_INTEGER) });
export const hashParams = z.object({ hash: z.string().regex(/^[0-9a-fA-F]{64}$/, "Geçersiz özet: 64 karakterlik onaltılık değer bekleniyordu.").transform((h) => h.toLowerCase()) });

// ───────────── Kimlik ve hesap ─────────────

/** Kayıt formunun ayrıntılı (Türkçe, alan bazlı) doğrulaması kimlik modülündedir; burada yalnız nesne olduğu denetlenir. */
export const registrationBody = z.record(z.string(), z.unknown());
export const loginBody = z.object({ login: text(320), password: text(1024) });
export const consentsBody = z.object({ aiConsent: z.boolean().optional(), politicalConsent: z.boolean().optional() });
export const changePasswordBody = z.object({ oldPassword: text(1024), newPassword: text(1024) });
export const eraseBody = z.object({ confirm: text(20), password: text(1024) });
export const delegateBody = z.object({
  to: id,
  scope: z.string().min(1).max(300).transform((s) => (s.trim() === "*" ? "*" : expandIri(s.trim()))),
  rank: z.number().int().min(1).max(3),
});
export const markReadBody = z.object({ ids: z.array(id).max(1000).optional() });
export const notificationsQuery = z.object({ unread: qBool.optional() });

// ───────────── Kayıt memuru / yönetim ─────────────

export const piiBody = z.object({ purpose: text(500) });
export const verifyUserBody = z.object({ decision: z.enum(["approve", "reject"]), note: text(1000).optional() });
export const setRolesBody = z.object({ roles: z.array(z.enum(ROLES)).max(ROLES.length) });
export const clockAdvanceBody = z.object({ hours: z.number().min(1).max(24 * 30) });
export const adminUsersQuery = z.object({ q: qText(100).optional() });
export const auditLogQuery = z.object({ action: qText(100).optional(), actorId: qText(200).optional(), limit: qInt(1, 1000).optional() });

// ───────────── Kullanıcılar / graf ─────────────

export const usersQuery = z.object({ q: qText(100).optional(), limit: qInt(1, 200).optional() });
export const vouchBody = z.object({ level: z.enum(["known", "close", "just_met", "suspicious"]) });
export const relateBody = z.object({ kind: z.enum(["family", "business", "household"]) });
export const graphQuery = z.object({
  types: z
    .string()
    .max(500)
    .transform((s, ctx) => {
      const parts = s.split(",").map((p) => p.trim()).filter(Boolean);
      const bad = parts.filter((p) => !(EDGE_TYPES as readonly string[]).includes(p));
      if (bad.length) {
        ctx.addIssue({ code: "custom", message: `Bilinmeyen kenar türü: ${bad.join(", ")}. Geçerli türler: ${EDGE_TYPES.join(", ")}.` });
        return z.NEVER;
      }
      return parts as EdgeType[];
    })
    .optional(),
  limit: qInt(1, 5000).optional(),
});

// ───────────── Ontoloji ─────────────

export const turtleQuery = z.object({ version: qInt(1, 1_000_000).optional() });

const patchOp = z.discriminatedUnion("op", [
  z.object({ op: z.literal("setParam"), rule: iri, param: requiredText(200), value: z.union([z.number(), z.boolean(), z.string().max(1000)]) }),
  z.object({
    op: z.literal("addCategory"),
    iri,
    label: requiredText(200),
    parent: iri,
    keywords: z.array(requiredText(100)).max(50),
    requiresExpert: z.boolean().optional(),
  }),
  z.object({ op: z.literal("amendArticleText"), article: iri, text: requiredText(20_000) }),
  z.object({
    op: z.literal("addArticle"),
    iri,
    number: requiredText(100),
    title: requiredText(300),
    text: requiredText(20_000),
    protection: z.enum(["Nitelikli", "Olagan"]),
  }),
  z.object({ op: z.literal("setProtection"), article: iri, protection: z.enum(["Degistirilemez", "Nitelikli", "Olagan"]) }),
]);
export const regulationPatchSchema = z.object({ ops: z.array(patchOp).min(1).max(50), rationale: text(10_000) });
export const validatePatchBody = z.object({ patch: regulationPatchSchema });

// ───────────── Öneriler ─────────────

export const proposalListQuery = z.object({
  status: z.enum([...PROPOSAL_STATUSES, "open", "closed"]).optional(),
  kind: z.enum(PROPOSAL_KINDS).optional(),
  q: qText(200).optional(),
  topicId: qText(200).optional(),
  authorId: qText(200).optional(),
  mine: qBool.optional(),
  limit: qInt(1, 500).optional(),
});

export const createProposalBody = z.object({
  kind: z.enum(PROPOSAL_KINDS),
  title: requiredText(300),
  body: text(50_000),
  categories: z.array(iri).max(30).default([]),
  parentTopicId: id.optional(),
  amendment: z.object({ baseVersion: z.number().int().min(1), newTitle: requiredText(300), newBody: text(50_000) }).optional(),
  deletion: z.object({ messageIds: z.array(id).min(1).max(100), ground: iri, statement: text(5_000) }).optional(),
  regulationPatch: regulationPatchSchema.optional(),
  requestExpert: z.boolean().optional(),
  submit: z.boolean().optional(),
  acknowledgePii: z.boolean().optional(),
});
export const updateProposalBody = z.object({ title: requiredText(300), body: text(50_000), acknowledgePii: z.boolean().optional() });
export const suggestionBody = z.object({ body: requiredText(10_000) });
export const suggestionDecisionBody = z.object({ decision: z.enum(["accept", "reject"]) });
export const voteBody = z.object({ choice: z.enum(VOTE_CHOICES) });
export const objectionBody = z.object({ ground: iri, statement: requiredText(5_000) });
export const minorityReportBody = z.object({ body: requiredText(20_000) });
export const expertRequestBody = z.object({ kind: z.enum(["panel", "counter"]) });
export const expertQuestionBody = z.object({ body: requiredText(2_000) });
export const rightsFlagBody = z.object({ right: iri, direction: z.enum(["restrict", "expand"]), remove: z.boolean().optional() });
export const aiApproveBody = z.object({ draftIndex: z.number().int().min(0).max(100).optional() });

// ───────────── Tartışma ─────────────

export const postMessageBody = z.object({
  body: requiredText(10_000),
  stance: z.enum(STANCES),
  parentId: id.nullable().optional(),
  acknowledgePii: z.boolean().optional(),
});
export const editMessageBody = z.object({ body: requiredText(10_000), acknowledgePii: z.boolean().optional() });
export const endorseBody = z.object({ value: z.union([z.literal(-1), z.literal(0), z.literal(1)]) });
export const rebuttalBody = z.object({ body: requiredText(5_000) });
export const messagePrecheckBody = z.object({ body: text(10_000) });

// ───────────── Bilirkişi ─────────────

export const expertsQuery = z.object({ status: z.enum(EXPERT_STATUSES).optional(), domain: z.string().min(1).max(300).transform(expandIri).optional() });
export const expertApplyBody = z.object({ domains: z.array(iri).min(1).max(10), credentials: requiredText(5_000) });
export const expertDecisionBody = z.object({ decision: z.enum(["approve", "reject"]), note: text(2_000).optional() });
export const expertSanctionBody = z.object({ action: z.enum(["warn", "suspend", "remove", "reinstate"]), note: requiredText(2_000) });
export const assignmentRespondBody = z.object({ decision: z.enum(["accept", "recuse"]), reason: text(2_000).optional() });
export const expertReportBody = z.object({
  assessment: z.enum(["feasible", "infeasible", "uncertain"]),
  confidence: z.number().min(0).max(1),
  risks: z.array(requiredText(2_000)).max(50),
  answers: z.array(z.object({ questionId: id, answer: text(10_000) })).max(100),
  body: requiredText(50_000),
  dissent: text(20_000).nullable().optional(),
});
export const lintBody = z.object({ text: text(50_000) });

// ───────────── Defter ─────────────

export const blocksQuery = z.object({ from: qInt(0, Number.MAX_SAFE_INTEGER).optional(), limit: qInt(1, 100).optional() });
export const nodeQuery = z.object({ node: qText(100).optional() });
export const txsQuery = z.object({ type: z.enum(LEDGER_TX_TYPES).optional(), proposalId: qText(200).optional(), limit: qInt(1, 500).optional() });
export const tamperBody = z.object({ nodeId: requiredText(100), height: z.number().int().min(1) });
export const repairBody = z.object({ nodeId: requiredText(100) });
export const faultBody = z.object({ nodeId: requiredText(100), fault: z.enum(["none", "crash", "byzantine"]) });

// ───────────── Derleme zamanı uyum denetimleri ─────────────

type Same<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;
type Fits<A, B> = [A] extends [B] ? true : false;
type Check<T extends true> = T;

export type _SetChecks = [
  Check<Same<(typeof ROLES)[number], Role>>,
  Check<Same<(typeof PROPOSAL_KINDS)[number], ProposalKind>>,
  Check<Same<(typeof PROPOSAL_STATUSES)[number], ProposalStatus>>,
  Check<Same<(typeof VOTE_CHOICES)[number], VoteChoice>>,
  Check<Same<(typeof STANCES)[number], Stance>>,
  Check<Same<(typeof THREAD_TYPES)[number], ThreadType>>,
  Check<Same<(typeof EXPERT_STATUSES)[number], ExpertStatus>>,
  Check<Same<(typeof EDGE_TYPES)[number], EdgeType>>,
  Check<Same<(typeof LEDGER_TX_TYPES)[number], LedgerTxType>>,
];

export type _BodyChecks = [
  Check<Fits<z.output<typeof loginBody>, LoginRequest>>,
  Check<Fits<z.output<typeof consentsBody>, ConsentsRequest>>,
  Check<Fits<z.output<typeof changePasswordBody>, ChangePasswordRequest>>,
  Check<Fits<z.output<typeof eraseBody>, EraseRequest>>,
  Check<Fits<z.output<typeof delegateBody>, DelegateRequest>>,
  Check<Fits<z.output<typeof markReadBody>, MarkReadRequest>>,
  Check<Fits<z.output<typeof piiBody>, PiiRequest>>,
  Check<Fits<z.output<typeof verifyUserBody>, VerifyUserRequest>>,
  Check<Fits<z.output<typeof setRolesBody>, SetRolesRequest>>,
  Check<Fits<z.output<typeof clockAdvanceBody>, ClockAdvanceRequest>>,
  Check<Fits<z.output<typeof vouchBody>, VouchRequest>>,
  Check<Fits<z.output<typeof relateBody>, RelateRequest>>,
  Check<Fits<z.output<typeof regulationPatchSchema>, RegulationPatch>>,
  Check<Fits<z.output<typeof validatePatchBody>, ValidatePatchRequest>>,
  Check<Fits<z.output<typeof proposalListQuery>, ProposalListQuery>>,
  Check<Fits<z.output<typeof createProposalBody>, CreateProposalRequest>>,
  Check<Fits<z.output<typeof updateProposalBody>, UpdateProposalRequest>>,
  Check<Fits<z.output<typeof suggestionBody>, SuggestionRequest>>,
  Check<Fits<z.output<typeof suggestionDecisionBody>, SuggestionDecisionRequest>>,
  Check<Fits<z.output<typeof voteBody>, VoteRequest>>,
  Check<Fits<z.output<typeof objectionBody>, ObjectionRequest>>,
  Check<Fits<z.output<typeof minorityReportBody>, MinorityReportRequest>>,
  Check<Fits<z.output<typeof expertRequestBody>, ExpertRequestRequest>>,
  Check<Fits<z.output<typeof expertQuestionBody>, ExpertQuestionRequest>>,
  Check<Fits<z.output<typeof rightsFlagBody>, RightsFlagRequest>>,
  Check<Fits<z.output<typeof aiApproveBody>, AiApproveRequest>>,
  Check<Fits<z.output<typeof postMessageBody>, PostMessageRequest>>,
  Check<Fits<z.output<typeof editMessageBody>, EditMessageRequest>>,
  Check<Fits<z.output<typeof endorseBody>, EndorseRequest>>,
  Check<Fits<z.output<typeof rebuttalBody>, RebuttalRequest>>,
  Check<Fits<z.output<typeof messagePrecheckBody>, MessagePrecheckRequest>>,
  Check<Fits<z.output<typeof expertApplyBody>, ExpertApplyRequest>>,
  Check<Fits<z.output<typeof expertDecisionBody>, ExpertDecisionRequest>>,
  Check<Fits<z.output<typeof expertSanctionBody>, ExpertSanctionRequest>>,
  Check<Fits<z.output<typeof assignmentRespondBody>, AssignmentRespondRequest>>,
  Check<Fits<z.output<typeof expertReportBody>, ExpertReportRequest>>,
  Check<Fits<z.output<typeof lintBody>, LintRequest>>,
  Check<Fits<z.output<typeof tamperBody>, TamperRequest>>,
  Check<Fits<z.output<typeof repairBody>, RepairRequest>>,
  Check<Fits<z.output<typeof faultBody>, FaultRequest>>,
];
