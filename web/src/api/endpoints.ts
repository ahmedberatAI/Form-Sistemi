// docs/API.md'deki HER uç nokta için tipli istemci fonksiyonu.
// Tüm fonksiyonlar Promise döner; hata durumunda ./client içindeki ApiError fırlatılır.
import type {
  AdminUserRow,
  AiAnalysisInfo,
  AiApproveRequest,
  AssignmentRespondRequest,
  AuditLogEntry,
  AuditReport,
  AuthResponse,
  BallotReceipt,
  BlockListResponse,
  BlockView,
  BulletinResponse,
  BylawVersionInfo,
  ChainVerification,
  ChangePasswordRequest,
  ClusterSnapshotView,
  CommittedTxView,
  ConsentsRequest,
  CreateProposalRequest,
  Dashboard,
  DashboardTask,
  DelegateRequest,
  DelegationView,
  EdgeType,
  EditMessageRequest,
  EraseRequest,
  ExpertApplyRequest,
  ExpertDecisionRequest,
  ExpertInfo,
  ExpertPanelInfo,
  ExpertQuestion,
  ExpertReportRequest,
  ExpertReportView,
  ExpertSanctionRequest,
  ExpertStatus,
  FaultRequest,
  GraphStats,
  GraphVisEdge,
  GraphVisNode,
  HiddenMessageResponse,
  InclusionProof,
  LedgerStatus,
  LedgerTxListQuery,
  LintResponse,
  LoginRequest,
  Me,
  MessagePrecheckResponse,
  MessageVersionView,
  MessageView,
  MinorityReport,
  MyAssignment,
  MyDelegations,
  NotificationList,
  ObjectionRequest,
  OkResponse,
  OntologyOverview,
  PendingUser,
  PiiRecord,
  PostMessageRequest,
  PrecheckResponse,
  ProposalDetail,
  ProposalListQuery,
  ProposalSummary,
  PublicProfile,
  PublicUser,
  RegistrationInput,
  RegulationPatch,
  RelateRequest,
  RepairRequest,
  Role,
  Suggestion,
  SystemInfo,
  TamperRequest,
  ThreadResponse,
  ThreadType,
  TickResponse,
  TopicDetail,
  TopicSummary,
  UpdateProposalRequest,
  ValidatorKeys,
  VerifyUserRequest,
  VoteChoice,
  VoterListResponse,
  VouchRequest,
} from "@forum/shared";
import { http, seg } from "./client";

// ───────────── Sistem ─────────────

export const getHealth = () => http.get<{ ok: true }>("/api/health");
export const getSystem = () => http.get<SystemInfo>("/api/system");
export const getDashboard = () => http.get<Dashboard>("/api/dashboard");

// ───────────── Kimlik ve hesap ─────────────

export const register = (input: RegistrationInput) => http.post<AuthResponse>("/api/auth/register", input);
export const login = (req: LoginRequest) => http.post<AuthResponse>("/api/auth/login", req);
export const logout = () => http.post<OkResponse>("/api/auth/logout");
export const getMe = () => http.get<Me>("/api/me");
export const updateConsents = (req: ConsentsRequest) => http.patch<Me>("/api/me/consents", req);
export const changePassword = (req: ChangePasswordRequest) => http.post<OkResponse>("/api/me/password", req);
/** KVKK döküm: kişinin kendi (şifresi çözülmüş) verisi. Biçim sunucuya bağlıdır. */
export const exportMyData = () => http.get<Record<string, unknown>>("/api/me/export");
/** Kripto-imha. `confirm` tam olarak "SİL" olmalıdır. */
export const eraseMe = (req: EraseRequest) => http.post<OkResponse>("/api/me/erase", req);
export const getMyDelegations = () => http.get<MyDelegations>("/api/me/delegations");
export const delegate = (req: DelegateRequest) => http.post<DelegationView>("/api/me/delegations", req);
/** Vekâleti geri alır (kenar silinmez, geri alındı olarak işaretlenir). */
export const revokeDelegation = (id: string) => http.del<OkResponse>(`/api/me/delegations/${seg(id)}`);
export const getFollowing = () => http.get<PublicUser[]>("/api/me/following");
export const getNotifications = (opts?: { unread?: boolean }) => http.get<NotificationList>("/api/me/notifications", { unread: opts?.unread });
/** ids boş/verilmemişse tüm bildirimler okundu işaretlenir. */
export const markNotificationsRead = (ids?: string[]) => http.post<OkResponse>("/api/me/notifications/read", ids && ids.length ? { ids } : {});
export const getMyTasks = () => http.get<DashboardTask[]>("/api/me/tasks");
export const getMyAssignments = () => http.get<MyAssignment[]>("/api/me/assignments");

// ───────────── Kayıt memuru ─────────────

export const getPendingUsers = () => http.get<PendingUser[]>("/api/registrar/pending");
/** Kişisel veri görüntüleme: amaç zorunlu, erişim kaydedilir. */
export const getUserPii = (userId: string, purpose: string) => http.post<PiiRecord>(`/api/registrar/users/${seg(userId)}/pii`, { purpose });
export const verifyUser = (userId: string, req: VerifyUserRequest) => http.post<Me>(`/api/registrar/users/${seg(userId)}/verify`, req);
/** "Üyeyi sisteme gir": kayıt memuru yüz yüze kaydeder, üye doğrudan doğrulanmış olur. */
export const registrarCreateUser = (input: RegistrationInput) => http.post<{ user: Me }>("/api/registrar/users", input);

// ───────────── Yönetim ─────────────

/** Simüle saati ileri alır ve zamanlayıcıyı çalıştırır. Sonrasında useAuth().refreshSystem() çağırın. */
export const advanceClock = (hours: number) => http.post<TickResponse>("/api/admin/clock/advance", { hours });
export const runTick = () => http.post<TickResponse>("/api/admin/tick");
export const adminListUsers = (q?: string) => http.get<AdminUserRow[]>("/api/admin/users", { q });
export const setUserRoles = (userId: string, roles: Role[]) => http.put<Me>(`/api/admin/users/${seg(userId)}/roles`, { roles });
export const getAuditLog = (query?: { action?: string; actorId?: string; limit?: number }) => http.get<AuditLogEntry[]>("/api/admin/audit-log", query);
export const recomputeClusters = () => http.post<ClusterSnapshotView>("/api/admin/clusters/recompute");

// ───────────── Kullanıcılar ve graf ilişkileri ─────────────

export const listUsers = (query?: { q?: string; limit?: number }) => http.get<PublicUser[]>("/api/users", query);
export const getUser = (userId: string) => http.get<PublicProfile>(`/api/users/${seg(userId)}`);
export const followUser = (userId: string) => http.post<PublicProfile>(`/api/users/${seg(userId)}/follow`);
export const unfollowUser = (userId: string) => http.del<PublicProfile>(`/api/users/${seg(userId)}/follow`);
export const vouchUser = (userId: string, level: VouchRequest["level"]) => http.post<PublicProfile>(`/api/users/${seg(userId)}/vouch`, { level });
/** Çıkar çatışması beyanı (aile / iş / hane). */
export const relateUser = (userId: string, kind: RelateRequest["kind"]) => http.post<PublicProfile>(`/api/users/${seg(userId)}/relate`, { kind });

// ───────────── Ontoloji (yönetmelik) ─────────────

export const getOntology = () => http.get<OntologyOverview>("/api/ontology");
export const getOntologyVersions = () => http.get<BylawVersionInfo[]>("/api/ontology/versions");
/** Yönetmeliğin Turtle (text/turtle) dökümü; sürüm verilmezse güncel sürüm. */
export const getTurtle = (version?: number) => http.text("/api/ontology/turtle", { version });
export const validatePatch = (patch: RegulationPatch) => http.post<AuditReport>("/api/ontology/validate-patch", { patch });

// ───────────── Öneriler ─────────────

export const listProposals = (query?: ProposalListQuery) => http.get<ProposalSummary[]>("/api/proposals", query);
/** Yan etkisiz ön denetim (katman, parametreler, bulgular, YZ önerileri, benzerler, kişisel veri). */
export const precheckProposal = (req: CreateProposalRequest) => http.post<PrecheckResponse>("/api/proposals/precheck", req);
export const createProposal = (req: CreateProposalRequest) => http.post<ProposalDetail>("/api/proposals", req);
export const getProposal = (id: string) => http.get<ProposalDetail>(`/api/proposals/${seg(id)}`);
export const updateProposal = (id: string, req: UpdateProposalRequest) => http.patch<ProposalDetail>(`/api/proposals/${seg(id)}`, req);
export const submitProposal = (id: string) => http.post<ProposalDetail>(`/api/proposals/${seg(id)}/submit`);
export const sponsorProposal = (id: string) => http.post<ProposalDetail>(`/api/proposals/${seg(id)}/sponsor`);
export const withdrawProposal = (id: string) => http.post<ProposalDetail>(`/api/proposals/${seg(id)}/withdraw`);
export const addSuggestion = (id: string, body: string) => http.post<Suggestion>(`/api/proposals/${seg(id)}/suggestions`, { body });
export const decideSuggestion = (id: string, suggestionId: string, decision: "accept" | "reject") =>
  http.post<ProposalDetail>(`/api/proposals/${seg(id)}/suggestions/${seg(suggestionId)}/decide`, { decision });
/** Hak etkisi bayrağı: herkes ekleyebilir (yalnızca yükseltme); `remove: true` yalnızca bilirkişi/yönetici. */
export const flagRight = (id: string, req: { right: string; direction: "restrict" | "expand"; remove?: boolean }) =>
  http.post<ProposalDetail>(`/api/proposals/${seg(id)}/rights-flags`, req);
/** Oy verir ya da süre bitene kadar oyunu değiştirir. Dönen makbuzu lib/receipts.saveReceipt ile saklayın. */
export const vote = (id: string, choice: VoteChoice) => http.post<BallotReceipt>(`/api/proposals/${seg(id)}/vote`, { choice });
export const getReceipts = (id: string) => http.get<BallotReceipt[]>(`/api/proposals/${seg(id)}/receipts`);
export const submitObjection = (id: string, req: ObjectionRequest) => http.post<ProposalDetail>(`/api/proposals/${seg(id)}/objections`, req);
export const addMinorityReport = (id: string, body: string) => http.post<MinorityReport>(`/api/proposals/${seg(id)}/minority-reports`, { body });
export const requestExperts = (id: string, kind: "panel" | "counter") => http.post<ProposalDetail>(`/api/proposals/${seg(id)}/expert-request`, { kind });
export const askExpertQuestion = (id: string, body: string) => http.post<ExpertQuestion>(`/api/proposals/${seg(id)}/expert-questions`, { body });
/** Herkese açık bülten: TALLY + BALLOT_REVEAL + taahhütler → shared verifyTally ile yeniden sayılır. */
export const getBulletin = (id: string) => http.get<BulletinResponse>(`/api/proposals/${seg(id)}/bulletin`);
export const getVoters = (id: string) => http.get<VoterListResponse>(`/api/proposals/${seg(id)}/voters`);
export const requestAiSummary = (id: string) => http.post<AiAnalysisInfo>(`/api/proposals/${seg(id)}/ai/summary`);
export const requestAiBridging = (id: string) => http.post<AiAnalysisInfo>(`/api/proposals/${seg(id)}/ai/bridging`);
export const approveAiAnalysis = (analysisId: string, req: AiApproveRequest = {}) => http.post<AiAnalysisInfo>(`/api/ai/analyses/${seg(analysisId)}/approve`, req);

// ───────────── Konular ve tartışma ─────────────

export const listTopics = () => http.get<TopicSummary[]>("/api/topics");
export const getTopic = (id: string) => http.get<TopicDetail>(`/api/topics/${seg(id)}`);
export const getThread = (type: ThreadType, id: string) => http.get<ThreadResponse>(`/api/threads/${seg(type)}/${seg(id)}`);
/** Kişisel veri tespit edilirse 422 `pii_detected` (details.pii); onaylamak için acknowledgePii: true ile yeniden gönderin. */
export const postMessage = (type: ThreadType, id: string, req: PostMessageRequest) => http.post<MessageView>(`/api/threads/${seg(type)}/${seg(id)}`, req);
export const precheckMessage = (body: string) => http.post<MessagePrecheckResponse>("/api/messages/precheck", { body });
export const getMessage = (id: string) => http.get<MessageView>(`/api/messages/${seg(id)}`);
export const editMessage = (id: string, req: EditMessageRequest) => http.patch<MessageView>(`/api/messages/${seg(id)}`, req);
export const getMessageVersions = (id: string) => http.get<MessageVersionView[]>(`/api/messages/${seg(id)}/versions`);
/** value: 1 katılıyorum, -1 katılmıyorum, 0 geri al */
export const endorseMessage = (id: string, value: -1 | 0 | 1) => http.post<MessageView>(`/api/messages/${seg(id)}/endorse`, { value });
export const postRebuttal = (id: string, body: string) => http.post<MessageView>(`/api/messages/${seg(id)}/rebuttal`, { body });
/** Yalnızca denetçi: gizlenmiş mesajın metni (erişim kaydedilir). */
export const getHiddenMessage = (id: string) => http.get<HiddenMessageResponse>(`/api/messages/${seg(id)}/hidden`);

// ───────────── Bilirkişi ─────────────

export const listExperts = (query?: { status?: ExpertStatus; domain?: string }) => http.get<ExpertInfo[]>("/api/experts", query);
export const applyExpert = (req: ExpertApplyRequest) => http.post<ExpertInfo>("/api/experts/apply", req);
export const decideExpert = (userId: string, req: ExpertDecisionRequest) => http.post<ExpertInfo>(`/api/experts/${seg(userId)}/decide`, req);
export const sanctionExpert = (userId: string, req: ExpertSanctionRequest) => http.post<ExpertInfo>(`/api/experts/${seg(userId)}/sanction`, req);
export const respondAssignment = (assignmentId: string, req: AssignmentRespondRequest) =>
  http.post<ExpertPanelInfo>(`/api/experts/assignments/${seg(assignmentId)}/respond`, req);
export const submitExpertReport = (assignmentId: string, req: ExpertReportRequest) =>
  http.post<ExpertReportView>(`/api/experts/assignments/${seg(assignmentId)}/report`, req);
/** Hukuki nitelendirme denetimi (bilirkişi raporu taslağı için). */
export const lintExpertText = (text: string) => http.post<LintResponse>("/api/experts/lint", { text });

// ───────────── Graf ve görüş kümeleri ─────────────

export interface GraphResponse {
  nodes: GraphVisNode[];
  edges: GraphVisEdge[];
}

export const getGraph = (query?: { types?: EdgeType[]; limit?: number }) => http.get<GraphResponse>("/api/graph", { types: query?.types, limit: query?.limit });
export const getGraphStats = () => http.get<GraphStats>("/api/graph/stats");
export const getLatestClusters = () => http.get<ClusterSnapshotView | null>("/api/clusters/latest");
export const getClusterSnapshot = (id: string) => http.get<ClusterSnapshotView>(`/api/clusters/${seg(id)}`);

// ───────────── Dağıtık defter ─────────────

export const getLedgerStatus = () => http.get<LedgerStatus>("/api/ledger/status");
/** Doğrulayıcı açık anahtarları (istemci ilk kullanımda sabitler: lib/validators). */
export const getValidators = () => http.get<ValidatorKeys>("/api/ledger/validators");
export const listBlocks = (query?: { from?: number; limit?: number }) => http.get<BlockListResponse>("/api/ledger/blocks", query);
export const getBlock = (height: number, node?: string) => http.get<BlockView>(`/api/ledger/blocks/${seg(height)}`, { node });
export const listTxs = (query?: LedgerTxListQuery) => http.get<CommittedTxView[]>("/api/ledger/txs", query);
export const getTx = (hash: string) => http.get<CommittedTxView>(`/api/ledger/txs/${seg(hash)}`);
/** Dahil olma kanıtı → shared verifyInclusionProof(proof, pinnedValidators) ile doğrulanır. */
export const getProof = (txHash: string) => http.get<InclusionProof>(`/api/ledger/proofs/${seg(txHash)}`);
export const verifyChain = (node?: string) => http.get<ChainVerification[]>("/api/ledger/verify", { node });
/** Demo (yönetici): bir düğümde bloğu kurcalar. */
export const tamperBlock = (req: TamperRequest) => http.post<ChainVerification[]>("/api/ledger/tamper", req);
export const repairNode = (req: RepairRequest) => http.post<ChainVerification>("/api/ledger/repair", req);
export const setNodeFault = (req: FaultRequest) => http.post<LedgerStatus>("/api/ledger/fault", req);

// ───────────── Yapay zekâ ─────────────

export const getAiStatus = () => http.get<{ mode: "claude" | "offline"; model: string }>("/api/ai/status");
