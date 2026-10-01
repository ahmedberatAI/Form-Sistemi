// REST API istek / yanıt tipleri (docs/API.md ile birebir).
// Alan tipleri types.ts'dedir; burada yalnızca uç noktalara özgü sarmalayıcılar bulunur.
import type {
  AddressInput,
  ArticleInfo,
  AuditReport,
  BallotReceipt,
  BlockHeaderView,
  BylawVersionInfo,
  CategoryNode,
  CreateProposalInput,
  DelegationView,
  ExpertAssessment,
  ExpertInfo,
  GroundInfo,
  LedgerTxType,
  LedgerTxView,
  MessageView,
  Notification,
  ProposalKind,
  ProposalStatus,
  ProposalSummary,
  PublicUser,
  RegulationPatch,
  RightInfo,
  Role,
  Stance,
  ThreadType,
  Tier,
  VoteChoice,
} from "./types";
import type { RevealEntry, TallyPayload } from "./decision";

// ───────────── Kimlik ─────────────

export interface LoginRequest {
  /** Takma ad ya da e-posta */
  login: string;
  password: string;
}

export interface ConsentsRequest {
  aiConsent?: boolean;
  politicalConsent?: boolean;
}

export interface ChangePasswordRequest {
  oldPassword: string;
  newPassword: string;
}

/** PATCH /api/me/nickname — takma ad değişikliği (30 günde bir; şifre teyidi zorunlu). */
export interface ChangeNicknameRequest {
  nickname: string;
  /** Mevcut şifre (hesabı ele geçiren birinin takma adı değiştirmesine karşı yeniden doğrulama) */
  password: string;
}

export interface EraseRequest {
  /** Kullanıcı onay için tam olarak "SİL" yazmalıdır. */
  confirm: string;
  password: string;
}

export interface PendingUser {
  id: string;
  nickname: string;
  createdAt: number;
}

export interface PiiRequest {
  /** Görüntüleme amacı (zorunlu, erişim kaydına yazılır) */
  purpose: string;
}

export interface VerifyUserRequest {
  decision: "approve" | "reject";
  note?: string;
}

// ───────────── Kimlik verisi düzeltme talebi (KVKK md. 11/1-d) ─────────────

/** Düzeltilebilen kimlik alanları (takma ad ve şifre bu akışın konusu değildir; üye onları Profil'den kendisi değiştirir). */
export type CorrectableField = "firstName" | "lastName" | "tckn" | "birthDate" | "email" | "phone" | "address";

/** Önerilen (ya da incelemede gösterilen) değerler; yalnız düzeltilen alanlar bulunur. İncelemede TCKN maskelidir. */
export interface IdentityCorrectionValues {
  firstName?: string;
  lastName?: string;
  tckn?: string;
  birthDate?: string; // YYYY-AA-GG
  email?: string;
  phone?: string;
  address?: AddressInput;
}

/** POST /api/me/corrections */
export interface CorrectionRequestInput {
  changes: IdentityCorrectionValues;
  /** Gerekçe (zorunlu, 10–2000 karakter); şifreli saklanır, yalnız amaç belirten personel ve kişinin kendisi görür. */
  reason: string;
}

export type CorrectionStatus = "pending" | "approved" | "rejected" | "withdrawn";

/** Talep özeti: değer İÇERMEZ (yalnız alan adları). */
export interface CorrectionRequestView {
  id: string;
  userId: string;
  nickname: string;
  fields: CorrectableField[];
  status: CorrectionStatus;
  createdAt: number;
  /** Bir personel talebi amaç belirterek incelediyse son inceleme zamanı */
  reviewedAt: number | null;
  decidedAt: number | null;
  /** Kayıt memurunun karar notu (kişisel veri yazılmaz) */
  decisionNote: string | null;
  /** Yalnız talep sahibinin kendi listesinde: kendi gerekçesi */
  reason?: string | null;
}

/** POST /api/registrar/corrections/:id/review yanıtı (erişim pii_access_log'a yazılır). */
export interface CorrectionReview {
  request: CorrectionRequestView;
  reason: string;
  /** Düzeltilen alanların kasadaki mevcut değerleri (TCKN maskeli) */
  current: IdentityCorrectionValues;
  /** Önerilen değerler (TCKN maskeli). Karar verilmiş taleplerde boştur: öneri karar anında imha edilir. */
  proposed: IdentityCorrectionValues;
}

export interface CorrectionDecisionRequest {
  decision: "approve" | "reject";
  note?: string;
}

export interface CorrectionListQuery {
  /** Varsayılan "pending" */
  status?: CorrectionStatus | "all";
}

export interface SetRolesRequest {
  roles: Role[];
}

export interface AdminUserRow extends PublicUser {
  verifiedAt: number | null;
  isAdult: boolean;
  politicalConsent: boolean;
}

// ───────────── Topluluk / profil ─────────────

export interface PublicProfile extends PublicUser {
  stats: {
    proposals: number;
    enacted: number;
    messages: number;
    followers: number;
    following: number;
    vouchedBy: number;
    delegatorsCount: number; // bu kişiye vekâlet veren aktif kişi sayısı
  };
  /** Görüntüleyen kişiye göre ilişki bilgisi (oturum yoksa null) */
  viewer: {
    isSelf: boolean;
    following: boolean;
    vouched: "known" | "close" | "just_met" | "suspicious" | null;
    delegations: DelegationView[]; // görüntüleyenin bu kişiye verdiği aktif vekâletler
    related: ("family" | "business" | "household")[];
    /** related içinden görüntüleyenin KENDİ beyan ettikleri (yalnız bunları geri alabilir) */
    relatedByMe?: ("family" | "business" | "household")[];
  } | null;
  recentProposals: ProposalSummary[];
}

export interface VouchRequest {
  level: "known" | "close" | "just_met" | "suspicious";
}

export interface RelateRequest {
  kind: "family" | "business" | "household";
}

/** DELETE /api/users/:id/relate sorgusu: kind verilmezse görüntüleyenin bu kişiye dair tüm beyanları geri alınır. */
export interface UnrelateQuery {
  kind?: "family" | "business" | "household";
}

export interface DelegateRequest {
  to: string; // userId
  scope: string; // "*" veya kategori IRI
  rank: number; // 1..3
}

export interface MyDelegations {
  outgoing: DelegationView[];
  incoming: (DelegationView & { fromNickname: string })[];
  cap: number; // güncel vekâlet sınırı (bilgi)
}

export interface AuditLogEntry {
  id: string;
  actorId: string | null;
  actorNickname: string | null;
  action: string;
  target: string | null;
  meta: Record<string, unknown> | null;
  at: number;
}

// ───────────── Ontoloji ─────────────

export interface OntologyOverview {
  version: BylawVersionInfo;
  categories: CategoryNode[];
  rights: RightInfo[];
  articles: ArticleInfo[];
  deletionGrounds: GroundInfo[];
  objectionGrounds: GroundInfo[];
  contentLabels: { iri: string; label: string }[];
  tiers: { tier: Tier; label: string; quorum: number; threshold: number; clusterFloor: number }[];
  /** Yönetmelik yaması oluşturucusu için ayarlanabilir parametreler */
  params: { rule: string; param: string; label: string; value: number | boolean | string; immutable: boolean }[];
}

export interface ValidatePatchRequest {
  patch: RegulationPatch;
}

// ───────────── Öneriler ─────────────

export interface ProposalListQuery {
  status?: ProposalStatus | "open" | "closed";
  kind?: ProposalKind;
  q?: string;
  topicId?: string;
  authorId?: string;
  mine?: boolean;
  limit?: number;
}

export interface PrecheckResponse {
  audit: AuditReport;
  /** Yapay zekâ (ya da çevrimdışı sezgisel) sınıflandırma önerileri — yalnızca danışma */
  classification: {
    categories: { iri: string; label: string; confidence: number }[];
    rightsAffected: { right: string; label: string; direction: "restrict" | "expand"; confidence: number }[];
    contentLabels: { label: string; confidence: number }[];
    rationale: string;
    offline: boolean;
    model: string;
    aiLabel: string; // "Yapay zekâ ile üretildi · model · tarih"
  };
  similar: { id: string; seq: number; title: string; status: ProposalStatus; score: number; sameAuthor: boolean }[];
  pii: { kind: string; start: number; end: number; masked: string }[];
  /** Salam taktiği vb. için uyarılar (Türkçe) */
  warnings: string[];
  sponsorsRequired: number;
}

export type CreateProposalRequest = CreateProposalInput & {
  /** true: taslak oluşturulur ve hemen destekçi toplamaya gönderilir */
  submit?: boolean;
  /** Kişisel veri uyarısı görüldü ve yine de gönderiliyor */
  acknowledgePii?: boolean;
};

export interface UpdateProposalRequest {
  title: string;
  body: string;
  acknowledgePii?: boolean;
}

export interface SuggestionRequest {
  body: string;
}

export interface SuggestionDecisionRequest {
  decision: "accept" | "reject";
}

export interface VoteRequest {
  choice: VoteChoice;
}

/** İtiraz isteği (decision.ts'teki ObjectionInput ile karışmasın diye bu ad kullanılır). */
export interface ObjectionRequest {
  ground: string; // fy:ItirazGerekcesi IRI
  statement: string;
}

export interface MinorityReportRequest {
  body: string;
}

export interface ExpertRequestRequest {
  kind: "panel" | "counter";
}

export interface ExpertQuestionRequest {
  body: string;
}

export interface RightsFlagRequest {
  /** "Yalnızca yükseltme" kuralı: herkes hak etkisi bayrağı ekleyebilir; yalnızca bilirkişi kaldırabilir. */
  right: string;
  direction: "restrict" | "expand";
  remove?: boolean;
}

export interface BulletinRound {
  round: 1 | 2;
  tally: TallyPayload;
  tallyTx: string | null;
  reveals: RevealEntry[];
  revealTx: string | null;
  /** ballotId → defterdeki SON VOTE_COMMIT taahhüdü */
  commitments: Record<string, string>;
  /** Her VOTE_COMMIT işleminin hash'i (bağımsız doğrulama için) */
  commitTxs: { ballotId: string; txHash: string; commitment: string }[];
}

export interface BulletinResponse {
  proposalId: string;
  rounds: BulletinRound[];
}

export interface VoterListResponse {
  proposalId: string;
  eligibleCount: number;
  snapshotAt: number | null;
  /** Yalnızca takma adlar; kimin oy verdiği gösterilmez. */
  voters: { userId: string; nickname: string }[];
}

export interface AiApproveRequest {
  /** bridging_drafts için: yazarın benimsediği taslak (yeni sürüm olarak uygulanır) */
  draftIndex?: number;
}

export interface Dashboard {
  counts: Record<ProposalStatus, number>;
  topics: number;
  members: { verified: number; pending: number };
  recentEnacted: ProposalSummary[];
  open: ProposalSummary[];
  /** Görüntüleyen kişiye özel bekleyen işler (oturum yoksa boş) */
  tasks: DashboardTask[];
  /** Kalıcı kaybeden küme göstergesi (çoğunluk tiranlığı erken uyarısı) */
  permanentLoser: { clusterId: string; label: string; lostShare: number; decisions: number }[];
  ledger: { height: number; healthy: number; validators: number };
}

export interface DashboardTask {
  kind: "vote" | "sponsor" | "object" | "expert" | "registrar" | "author" | "reconciliation";
  title: string;
  link: string;
  dueAt: number | null;
}

// ───────────── Konular / tartışma ─────────────

export interface PostMessageRequest {
  body: string;
  stance: Stance;
  parentId?: string | null;
  acknowledgePii?: boolean;
}

export interface EditMessageRequest {
  body: string;
  acknowledgePii?: boolean;
}

export interface EndorseRequest {
  value: -1 | 0 | 1;
}

export interface RebuttalRequest {
  body: string;
}

export interface MessagePrecheckRequest {
  body: string;
}

export interface MessagePrecheckResponse {
  pii: { kind: string; start: number; end: number; masked: string }[];
  risk: 0 | 1 | 2 | 3;
  labels: string[];
  rationale: string;
  offline: boolean;
  aiLabel: string;
}

export interface HiddenMessageResponse {
  messageId: string;
  body: string;
  versions: { version: number; body: string; createdAt: number; contentHash: string }[];
  accessLogged: true;
}

export interface ThreadResponse {
  threadType: ThreadType;
  threadId: string;
  messages: MessageView[];
}

// ───────────── Bilirkişi ─────────────

export interface ExpertApplyRequest {
  domains: string[];
  credentials: string;
}

export interface ExpertDecisionRequest {
  decision: "approve" | "reject";
  note?: string;
}

export interface ExpertSanctionRequest {
  action: "warn" | "suspend" | "remove" | "reinstate";
  note: string;
}

export interface AssignmentRespondRequest {
  decision: "accept" | "recuse";
  reason?: string;
}

export interface ExpertReportRequest {
  assessment: ExpertAssessment;
  confidence: number;
  risks: string[];
  answers: { questionId: string; answer: string }[];
  body: string;
  dissent?: string | null;
}

export interface MyAssignment {
  assignmentId: string;
  proposalId: string;
  proposalTitle: string;
  proposalSeq: number;
  status: string;
  dueAt: number;
  questions: { id: string; body: string; minorityGuaranteed: boolean }[];
}

export interface LintRequest {
  text: string;
}

export interface LintResponse {
  issues: { quote: string; kind: string; message: string }[];
  offline: boolean;
  model: string;
  aiLabel: string;
}

export type ExpertList = ExpertInfo[];

// ───────────── Graf ─────────────

export interface GraphQuery {
  types?: string; // virgülle ayrılmış EdgeType listesi
  limit?: number;
}

// ───────────── Defter ─────────────

export interface LedgerTxListQuery {
  type?: LedgerTxType;
  proposalId?: string;
  limit?: number;
}

export interface CommittedTxView extends LedgerTxView {
  height: number;
  index: number;
  blockHash: string;
  blockTime: number;
}

export interface BlockListResponse {
  blocks: (BlockHeaderView & { txTypes: LedgerTxType[] })[];
  height: number;
}

export interface TamperRequest {
  nodeId: string;
  height: number;
}

export interface RepairRequest {
  nodeId: string;
}

export interface FaultRequest {
  nodeId: string;
  fault: "none" | "crash" | "byzantine";
}

export interface ValidatorKeys {
  chainId: string;
  validators: { id: string; publicKey: string }[];
  /** Uygulama sunucusunun işlem imzalama açık anahtarı (tx.sig = Ed25519(hexToBytes(tx.hash))) */
  appPublicKey: string;
}

// ───────────── Yönetim ─────────────

export interface ClockAdvanceRequest {
  /** İleri alınacak simüle süre (saat). */
  hours: number;
}

export interface TickResponse {
  transitions: { proposalId: string; seq: number; from: ProposalStatus; to: ProposalStatus; reason: string }[];
  now: number;
}

// ───────────── Genel ─────────────

export interface OkResponse {
  ok: true;
}

export interface NotificationList {
  items: Notification[];
  unread: number;
}

export interface MarkReadRequest {
  ids?: string[]; // boşsa tümü
}

