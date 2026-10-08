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
  TopicSummary,
  VoteChoice,
} from "./types";
import type { RevealEntry, TallyPayload } from "./decision";
import type { RankReason } from "./recommend";
import type { SearchMatch } from "./search";

// ───────────── Kimlik ─────────────

export interface LoginRequest {
  /** Takma ad ya da e-posta */
  login: string;
  password: string;
}

export interface ConsentsRequest {
  aiConsent?: boolean;
  politicalConsent?: boolean;
  /** Kişisel sıralama tercihi (rıza değil; yalnız siyasi görüş rızasıyla birlikte etkilidir) */
  personalRanking?: boolean;
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
  /**
   * "sana-gore": kişisel sıra — yanıt `PersonalizedProposalList` olur (dizi değil). Küme varsayılan listeyle AYNIDIR (aynı süzgeç ve
   * `limit`); yalnız sıra değişir: önce süren (açık) öneriler (ana sayfa "Şu an açık"la aynı sıra), sonra diğerleri. Oturum yoksa,
   * kişisel sıralamaya izin yoksa (siyasi görüş rızası ya da "Kişisel sıralama" tercihi) ya da profil boşsa varsayılan sıra döner
   * (`personalized: false`). İstemcinin cihazındaki son açılanlar sorgu dizesinde DEĞİL, {@link REC_RECENT_HEADER} başlığıyla gider.
   */
  sort?: ProposalSort;
}

/** Öneri listesi sıralama parametresi (sunucu tarafında yalnız kişisel sıra; diğer sıralamalar istemcidedir). */
export type ProposalSort = "sana-gore";

/** Kişisel sıradaki öneri: özet + kişisel puan + kısa gerekçe (algoritma: shared/src/recommend.ts). */
export interface RankedProposalSummary extends ProposalSummary {
  /** Kişisel puan [0, 1]; kişisel sıra yoksa (soğuk başlangıç, oturum yok) null */
  score: number | null;
  /** Kısa gerekçe çipi; kişisel sıra yoksa null */
  reason: RankReason | null;
}

/** GET /api/proposals?sort=sana-gore yanıtı. */
export interface PersonalizedProposalList {
  /** false: oturum yok ya da ilgi profili boş (soğuk başlangıç) — `items` varsayılan sıradadır, puan ve gerekçe null */
  personalized: boolean;
  /** Varsayılan listeyle AYNI küme (hiçbir öneri gizlenmez ya da düşmez), kişisel sırada */
  items: RankedProposalSummary[];
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

/** Ana sayfa "Şu an açık" satırı: kişisel sıradaysa puan ve gerekçe taşır. */
export type DashboardOpenProposal = ProposalSummary & Partial<Pick<RankedProposalSummary, "score" | "reason">>;

export interface Dashboard {
  counts: Record<ProposalStatus, number>;
  topics: number;
  members: { verified: number; pending: number };
  recentEnacted: ProposalSummary[];
  /**
   * Açık öneriler (en çok 10). Varsayılan: evre bitişi en yakın olanlar. Oturumlu ve ilgi profili olan görüntüleyende TÜM açık
   * öneriler kişisel sıraya dizilip ilk 10'u gelir (`openPersonalized: true`; her satırda `score` ve `reason`). "Sizi bekleyenler"
   * (`tasks`) kişiselleştirmeden etkilenmez.
   */
  open: DashboardOpenProposal[];
  /** true: `open` kişisel sırada (sunucu her zaman gönderir; isteğe bağlı olması yalnız eski istemci/fikstür uyumu içindir) */
  openPersonalized?: boolean;
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

// ───────────── Önerili arama ("Hızlı bul") ─────────────

/** GET /api/search sorgusu. */
export interface SearchQuery {
  /** Arama metni (en çok 100 karakter). 2 karakterden kısaysa ve numara değilse sonuç boştur. "#K12", "K-12", "#T3", "12" numara aramasıdır. */
  q: string;
  /** 1–8 (varsayılan 8) */
  limit?: number;
}

interface SearchHitBase {
  id: string;
  seq: number;
  title: string;
  /** Eşleşme düzeyi: ref (numara) > prefix (başlık yazılanla başlıyor) > word (kelime başı) > contains (içinde geçiyor) */
  match: SearchMatch;
  /** Açık/etkin: öneride taslak ya da işleyen evre; konuda yürürlükte (active) */
  open: boolean;
  createdAt: number;
}

export interface ProposalSearchHit extends SearchHitBase {
  type: "proposal";
  kind: ProposalKind;
  status: ProposalStatus;
}

export interface TopicSearchHit extends SearchHitBase {
  type: "topic";
  status: "active" | "archived";
}

export type SearchHit = ProposalSearchHit | TopicSearchHit;

export interface SearchResponse {
  /** Aranan metin (kırpılmış) */
  q: string;
  /** En çok `limit` sonuç, sıralı (compareSearchHits); istemci türe göre gruplar */
  items: SearchHit[];
  /** Kesilmeden önceki toplam eşleşme sayıları ("Tüm önerilerde ara (23)" için) */
  total: { proposals: number; topics: number };
}

// ───────────── Listem (kayıtlı öneri ve konular) ─────────────

/** Listeye eklenebilen hedef türleri (yol parametresi `:type`). */
export type SavedTargetType = "proposal" | "topic";

/** PUT / DELETE /api/me/saved/:type/:id yanıtı (ikisi de idempotent). */
export interface SavedState {
  type: SavedTargetType;
  id: string;
  saved: boolean;
  /** Listeye ilk eklenme anı (yinelenen PUT değiştirmez); listede değilse null */
  savedAt: number | null;
}

export type SavedItem =
  | { type: "proposal"; id: string; savedAt: number; proposal: ProposalSummary }
  | { type: "topic"; id: string; savedAt: number; topic: TopicSummary };

/** GET /api/me/saved yanıtı: yalnız sahibine; en son eklenen önce. Artık görülemeyen hedefler listelenmez. */
export interface SavedList {
  items: SavedItem[];
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
  /** Yalnız bu pusulanın işlemleri (yük alanı `ballotId`); `proposalId` ile birlikte verilir. */
  ballotId?: string;
  /** Yalnız bu turun işlemleri (yük alanı `round`); `proposalId` ile birlikte verilir. */
  round?: number;
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
  /**
   * true: isteğin süre bütçesi (yaklaşık 20 sn) doldu ve vadesi gelmiş geçişler henüz bitmedi; kalanlar zamanlayıcıyla (ya da yeni
   * bir "tick" isteğiyle) sürer. Yalnız gerektiğinde bulunur.
   */
  pending?: boolean;
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

