// FORUM SÖZLEŞMELERİ: forum çekirdeği (öneri, konu, tartışma, küme, topluluk, yaşam döngüsü). Çekirdek dışı modüllerin sözleşmeleri core/contracts.ts'tedir.
// Uygulama: server/src/forum/ — fabrika: createForumServices(deps: ForumDeps): ForumServices
// HTTP katmanı (server/src/http/) forum servislerine bu arayüzlerle erişir (çekirdek dışı servisler core/contracts.ts; istisnalar
// docs/MIMARI.md §2.2).
import type {
  AdminUserRow,
  AiAnalysisInfo,
  AuditLogEntry,
  BallotReceipt,
  BulletinResponse,
  ClusterSnapshotView,
  CreateProposalRequest,
  Dashboard,
  DashboardTask,
  ExpertQuestion,
  HiddenMessageResponse,
  Me,
  MessagePrecheckResponse,
  MessageVersionView,
  MessageView,
  MinorityReport,
  MyDelegations,
  Notification,
  ObjectionRequest,
  PostMessageRequest,
  PrecheckResponse,
  ProposalDetail,
  ProposalListQuery,
  ProposalStatus,
  ProposalSummary,
  PublicProfile,
  PublicUser,
  RightsFlagRequest,
  Suggestion,
  SystemInfo,
  ThreadType,
  TopicDetail,
  TopicSummary,
  VoteChoice,
  VoterListResponse,
} from "@forum/shared";
import type {
  AiRecordSink,
  AiService,
  AuthUser,
  CoreContext,
  ExpertService,
  GovernanceMath,
  GraphService,
  IdentityService,
  LedgerService,
  Notifier,
  OntologyService,
} from "./contracts";
import type { AuditLogger } from "./audit";

/** Oturum açmamış görüntüleyici için null. */
export type Viewer = AuthUser | null;

export interface ForumDeps {
  ctx: CoreContext;
  ledger: LedgerService;
  ontology: OntologyService;
  graph: GraphService;
  math: GovernanceMath;
  identity: IdentityService;
  ai: AiService;
  aiSink: AiRecordSink;
  experts: ExpertService;
  notifier: Notifier;
  audit: AuditLogger;
}

// ═════════════════════════ Öneriler ═════════════════════════

export interface ProposalService {
  list(query: ProposalListQuery, viewer: Viewer): ProposalSummary[];
  /** Oylama sürerken sonuçlar GİZLİDİR: results[] yalnızca kapanmış turları içerir; katılım (participation) gösterilir. */
  get(id: string, viewer: Viewer): ProposalDetail;
  /** Canlı ön denetim: ontoloji denetimi + YZ sınıflandırma (yalnız danışma) + benzerler + kişisel veri + salam uyarıları. Yan etkisiz. */
  precheck(actor: AuthUser, input: CreateProposalRequest): Promise<PrecheckResponse>;
  /** Taslak oluşturur (input.submit=true ise hemen sponsoring'e geçer). PROPOSAL_CREATED defter kaydı. */
  create(actor: AuthUser, input: CreateProposalRequest): Promise<ProposalDetail>;
  /** draft → sponsoring (yalnız yazar) */
  submit(actor: AuthUser, id: string): Promise<ProposalDetail>;
  /** Eş imzacı (destekçi). Yazar kendini destekleyemez. K_s'ye ulaşınca denetim bir sonraki tick'te yapılır. */
  sponsor(actor: AuthUser, id: string): Promise<ProposalDetail>;
  /** Yazar, oylama başlamadan önce geri çekebilir. */
  withdraw(actor: AuthUser, id: string): Promise<ProposalDetail>;
  /** Yeni sürüm (yalnız draft/deliberation/reconciliation; yazar). PROPOSAL_VERSION defter kaydı. Reconciliation'da yeniden denetlenir; ihlal varsa reddedilir. */
  update(actor: AuthUser, id: string, input: { title: string; body: string; acknowledgePii?: boolean }): Promise<ProposalDetail>;
  /** Tartışma içi metin önerisi (deliberation). */
  suggest(actor: AuthUser, id: string, body: string): Suggestion;
  /** Yazar kabul ederse yeni sürüm oluşur (öneren anılır); reddedilen öneri herkese açık kalır. */
  decideSuggestion(actor: AuthUser, id: string, suggestionId: string, decision: "accept" | "reject"): Promise<ProposalDetail>;
  /** Hak etkisi bayrağı: "yalnızca yükseltme" — herkes ekler, yalnızca bilirkişi/yönetici kaldırır. Deliberation'da yeniden denetim. */
  flagRight(actor: AuthUser, id: string, input: RightsFlagRequest): Promise<ProposalDetail>;
  /** Oy (voting/revote). Süre bitene kadar değiştirilebilir. VOTE_COMMIT defter kaydı. */
  vote(actor: AuthUser, id: string, choice: VoteChoice): Promise<BallotReceipt>;
  /** Azınlık itirazı (objection_window). İmzacı E içinde, ilk turda etkin oyu "no"; 30 günde 2 imza bütçesi. OBJECTION defter kaydı. */
  object(actor: AuthUser, id: string, input: ObjectionRequest): Promise<ProposalDetail>;
  /** Azınlık raporu (reconciliation; ya da objection_window'da "no" oyu verenler). MINORITY_REPORT defter kaydı. */
  minorityReport(actor: AuthUser, id: string, body: string): MinorityReport;
  /** Bilirkişi talebi: uygun seçmenlerin ≥%10'u ya da yazar → panel; karşı panel talebi (reconciliation). */
  requestExpert(actor: AuthUser, id: string, kind: "panel" | "counter"): Promise<ProposalDetail>;
  /** Bilirkişiye soru. Azınlık kümesinden gelen ilk soru "azınlık güvenceli" işaretlenir. */
  expertQuestion(actor: AuthUser, id: string, body: string): ExpertQuestion;
  /** Herkese açık bülten: her tur için TALLY + BALLOT_REVEAL + son taahhütler (yalnız kapanmış turlar). */
  bulletin(id: string): BulletinResponse;
  /** Uygun seçmen listesi (takma adlar). */
  voters(id: string): VoterListResponse;
  /** Tartışma özeti (YZ ya da çevrimdışı). Yazarlar K1, K2… olarak maskelenir; aiConsent vermeyenlerin mesajları gönderilmez. */
  aiSummary(actor: AuthUser, id: string): Promise<AiAnalysisInfo>;
  /** Köprü taslakları (reconciliation). */
  aiBridging(actor: AuthUser, id: string): Promise<AiAnalysisInfo>;
  /** Yazar bir YZ çıktısını onaylar; bridging_drafts + draftIndex ise taslak yeni sürüm olarak uygulanır (reconciliation). */
  approveAi(actor: AuthUser, analysisId: string, draftIndex?: number): Promise<AiAnalysisInfo>;
  /** Görüntüleyenin bu öneri için oy makbuzları (tur başına son). */
  receipts(actor: AuthUser, id: string): BallotReceipt[];
}

// ═════════════════════════ Konular ═════════════════════════

export interface TopicService {
  /** Tüm konular (düz liste; istemci parentId ile ağaç kurar). */
  list(): TopicSummary[];
  get(id: string, viewer: Viewer): TopicDetail;
  /** Yürürlük etkisi (lifecycle çağırır): topic/subtopic önerisinden yeni konu + revizyon 1 + TOPIC_REVISION. */
  createFromProposal(proposalId: string): { topicId: string; txHash: string };
  /** Yürürlük etkisi: amendment. baseVersion güncel değilse { conflict: true } döner (lifecycle reddeder). */
  reviseFromProposal(proposalId: string): { topicId: string; version: number; txHash: string } | { conflict: true; currentVersion: number };
}

// ═════════════════════════ Tartışma ═════════════════════════

export interface MessageService {
  list(threadType: ThreadType, threadId: string, viewer: Viewer): MessageView[];
  /** Kişisel veri (ai.detectPii) bulunursa ve acknowledgePii yoksa 422 pii_detected. MESSAGE_POSTED defter kaydı. */
  post(actor: AuthUser, threadType: ThreadType, threadId: string, input: PostMessageRequest): Promise<MessageView>;
  /** Yalnız yazar; yeni sürüm (message_versions), MESSAGE_EDITED. Gizlenmiş mesaj düzenlenemez. */
  edit(actor: AuthUser, messageId: string, body: string, acknowledgePii?: boolean): Promise<MessageView>;
  /** Sürüm geçmişi (gizli/mühürlü mesajlarda yalnız denetçi). */
  versions(viewer: Viewer, messageId: string): MessageVersionView[];
  /** +1 katılıyorum, -1 katılmıyorum, 0 geri al. Yazar kendi mesajını destekleyemez. */
  endorse(actor: AuthUser, messageId: string, value: -1 | 0 | 1): MessageView;
  /** Gizlenmiş mesajın yazarı karartılamayan TEK bir cevap ekleyebilir. */
  rebuttal(actor: AuthUser, messageId: string, body: string): MessageView;
  /** Denetçi gizli metni okur; hidden_access_log kaydı yapılır. */
  readHidden(actor: AuthUser, messageId: string): HiddenMessageResponse;
  precheck(actor: AuthUser, body: string): Promise<MessagePrecheckResponse>;
  get(messageId: string, viewer: Viewer): MessageView;
  // ── Yaşam döngüsü kancaları ──
  /** Acil gerekçeli silme talebi (kişisel veri, tehdit): talep anında "collapsed" (süreli). */
  collapse(messageIds: string[], proposalId: string): void;
  /** Silme talebi reddedilir/düşerse daraltma kaldırılır. */
  uncollapse(messageIds: string[], proposalId: string): void;
  /** Silme kararı yürürlüğe girince: hidden (kişisel veri gerekçesinde sealed). MESSAGE_HIDDEN defter kaydı. */
  hide(messageIds: string[], proposalId: string, groundIri: string, sealed: boolean): string[];
}

// ═════════════════════════ Görüş kümeleri ═════════════════════════

export interface ClusterService {
  /**
   * Kapanmış önerilerin doğrudan oylarından math.computeClusters (tohum: SHA256(sonBlokHash‖"cluster"‖zaman)).
   * Girdi özeti son anlık görüntüyle aynıysa onu döndürür. cluster_snapshots + CLUSTER_SNAPSHOT defter kaydı.
   */
  snapshot(reason: string): Promise<ClusterSnapshotView>;
  latest(): ClusterSnapshotView | null;
  get(id: string): ClusterSnapshotView | null;
  /** Anlık görüntüdeki küme (yoksa null) */
  clusterOf(snapshotId: string, userId: string): string | null;
  sizes(snapshotId: string): { k: number; sizes: Record<string, number>; clusteredTotal: number; hash: string };
}

// ═════════════════════════ Topluluk ═════════════════════════

export interface CommunityService {
  searchUsers(q: string, limit?: number): PublicUser[];
  /** Yönetici kullanıcı listesi (yalnız takma ad/hesap durumu; kişisel veri yok). Yetkilendirme çağıranın işidir. */
  adminUsers(q?: string, limit?: number): AdminUserRow[];
  publicProfile(userId: string, viewer: Viewer): PublicProfile;
  /** Me + kullanıcının kendi kümesi (son anlık görüntü) */
  me(userId: string): Me;
  following(userId: string): PublicUser[];
  delegations(userId: string): MyDelegations;
  notifications(userId: string, opts?: { unreadOnly?: boolean; limit?: number }): { items: Notification[]; unread: number };
  markRead(userId: string, ids?: string[]): void;
  auditLog(filter: { actorId?: string; action?: string; limit?: number }): AuditLogEntry[];
  systemInfo(): SystemInfo;
  dashboard(viewer: Viewer): Dashboard;
  tasks(viewer: AuthUser): DashboardTask[];
}

// ═════════════════════════ Yaşam döngüsü ═════════════════════════

export interface Transition {
  proposalId: string;
  seq: number;
  from: ProposalStatus;
  to: ProposalStatus;
  reason: string;
}

export interface LifecycleEngine {
  /** Gerçek zamanlı zamanlayıcıyı başlatır (ör. 1 sn'de bir tick). */
  start(intervalMs?: number): void;
  /** Zamanlayıcıyı durdurur; uçuştaki tick/poke tamamlanınca çözülür. */
  stop(): Promise<void>;
  /**
   * Süresi dolan evreleri ilerletir (ALGORITMA.md §3): zamanlayıcının faz geçişleri burada olur. Yazarın submit/withdraw eylemleri
   * (ProposalService) zamanlayıcıyı beklemeden, aynı `applyTransition` ile geçiş yapar. Eşzamanlı çağrılar sıraya alınır (yeniden giriş yok).
   * Öneriler arasında olay döngüsüne düzenli yol verilir (TICK_SLICE_MS). `budgetMs` verilirse süre dolunca kalan öneriler sonraki
   * tick'e bırakılır (en az bir öneri işlenir); sonuç `tickDeferred()` ile işaretlenir.
   */
  tick(opts?: { budgetMs?: number }): Promise<Transition[]>;
  /** Tek bir öneri için hemen değerlendirme (ör. K_s'ye ulaşınca). */
  poke(proposalId: string): Promise<Transition[]>;
}

export interface ForumServices {
  proposals: ProposalService;
  topics: TopicService;
  messages: MessageService;
  clusters: ClusterService;
  community: CommunityService;
  lifecycle: LifecycleEngine;
}
