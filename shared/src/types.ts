// Sunucu ve istemci (web + Android) arasında paylaşılan alan tipleri ve API sözleşmesi.
// Kod tanımlayıcıları İngilizce, kullanıcıya görünen metinler Türkçedir (bkz. labels.ts).

// ───────────────────────── Kimlik / kullanıcı ─────────────────────────

export type Role = "member" | "registrar" | "auditor" | "admin";
export type UserStatus = "pending" | "verified" | "suspended" | "rejected" | "erased";

/** Herkese açık profil: yalnızca takma ad ve kamusal bilgiler. Gerçek kimlik ASLA yok. */
export interface PublicUser {
  id: string;
  nickname: string;
  status: UserStatus;
  roles: Role[];
  isExpert: boolean;
  expertDomains: string[]; // ontoloji kategori IRI'leri
  reputation: number;
  joinedAt: number;
  clusterId?: string | null; // yalnızca kullanıcının kendisine gösterilir
}

export interface Me extends PublicUser {
  isAdult: boolean;
  aiConsent: boolean;
  politicalConsent: boolean;
  regionIl?: string | null;
  regionIlce?: string | null;
}

export interface AddressInput {
  il: string;
  ilce: string;
  mahalle: string;
  acikAdres: string;
  postaKodu?: string;
}

export interface RegistrationInput {
  nickname: string;
  password: string;
  firstName: string;
  lastName: string;
  tckn: string;
  birthDate: string; // YYYY-MM-DD
  email: string;
  phone: string;
  address: AddressInput;
  kvkkNoticeAccepted: boolean; // aydınlatma metni okundu (rıza değil)
  politicalConsent: boolean; // oy/görüş (özel nitelikli veri) için açık rıza
  aiConsent: boolean; // içeriğin yapay zekâ analizine gönderilmesine açık rıza (varsayılan kapalı)
}

/** Yalnızca kayıt memuru / denetçi görebilir; her erişim kayıt altına alınır. */
export interface PiiRecord {
  userId: string;
  firstName: string;
  lastName: string;
  tcknMasked: string; // 123******90
  birthDate: string;
  email: string;
  phone: string;
  address: AddressInput;
}

export interface AuthResponse {
  token: string;
  user: Me;
}

// ───────────────────────── Ontoloji / yönetmelik ─────────────────────────

export type Tier = "T0" | "T1" | "T2" | "T3" | "DEL";
export type ProtectionLevel = "Degistirilemez" | "Nitelikli" | "Olagan";
export type Severity = "violation" | "warning" | "info";

export interface CategoryNode {
  iri: string;
  label: string;
  parent: string | null;
  children: CategoryNode[];
  requiresExpert: boolean;
  keywords: string[];
}

export interface ArticleInfo {
  iri: string;
  number: string; // "Madde 3 (2) a)"
  title: string;
  text: string;
  protection: ProtectionLevel;
  part?: string;
}

export interface GroundInfo {
  iri: string;
  label: string;
  description: string;
  urgent?: boolean; // silme gerekçesi için: talep anında daraltılır
  legal?: boolean; // bilirkişi görüşü bağlayıcı
  sealed?: boolean; // silme kabulünde "sealed" (kişisel veri)
  invalid?: boolean; // geçersiz gerekçe (ör. görüş ayrılığı) — seçilemez
  article?: string; // dayanak madde IRI'si
}

export interface RightInfo {
  iri: string;
  label: string;
  description: string;
  article?: string;
}

export interface Finding {
  severity: Severity;
  code: string;
  message: string; // Türkçe
  article?: string; // ilgili madde IRI'si
  articleLabel?: string;
  focus?: string;
}

export interface Rational {
  num: number;
  den: number;
}

/** Ontoloji denetiminin ürettiği, oylama açılışında öneriye sabitlenen parametreler. */
export interface DecisionParams {
  tier: Tier;
  quorum: Rational; // q
  threshold: Rational; // τ
  thresholdStrict: boolean; // true: a > τ ; false: a ≥ τ
  clusterFloor: Rational; // φ
  authorClusterFloor: Rational | null; // yalnızca DEL: 1/2
  overrideThreshold: Rational; // ω
  revoteThreshold: Rational; // ρ
  significantShare: Rational; // σ_share
  significantMinMembers: number; // σ_min
  minVotesPerCluster: number; // μ_votes
  minClusteredForBridge: number; // n_C,min
  coldStartBump: Rational; // δ_cold
  delegationCapFraction: Rational; // 0,05
  delegationMaxHops: number; // H
  sponsorsRequired: number; // K_s
  requiresExpert: boolean;
  expertCount: number;
  expertDomains: string[];
  durationsHours: {
    sponsoring: number;
    deliberation: number;
    voting: number;
    extension: number;
    objection: number;
    reconciliation: number;
  };
}

export interface AppliedRule {
  iri: string;
  label: string;
  article?: string;
  articleLabel?: string;
}

export interface AuditReport {
  admissible: boolean;
  tier: Tier;
  params: DecisionParams | null; // admissible değilse null olabilir
  categories: string[]; // açık + çıkarılmış (üst sınıflar dahil)
  inferredClasses: string[];
  rightsAffected: string[];
  requiresExpert: boolean;
  violations: Finding[];
  warnings: Finding[];
  infos: Finding[];
  appliedRules: AppliedRule[];
  bylawVersion: number;
  bylawHash: string;
  checkedAt: number;
}

/** Yönetmelik değişikliği önerisinin yapılandırılmış yaması. */
export type RegulationPatchOp =
  | { op: "setParam"; rule: string; param: string; value: number | boolean | string }
  | { op: "addCategory"; iri: string; label: string; parent: string; keywords: string[]; requiresExpert?: boolean }
  | { op: "amendArticleText"; article: string; text: string }
  | { op: "addArticle"; iri: string; number: string; title: string; text: string; protection: Exclude<ProtectionLevel, "Degistirilemez"> }
  | { op: "setProtection"; article: string; protection: ProtectionLevel };

export interface RegulationPatch {
  ops: RegulationPatchOp[];
  rationale: string;
}

export interface BylawVersionInfo {
  version: number;
  hash: string;
  createdAt: number;
  viaProposalId: string | null;
  ledgerTx: string | null;
}

// ───────────────────────── Öneriler ─────────────────────────

export type ProposalKind = "topic" | "subtopic" | "amendment" | "deletion" | "regulation";

export type ProposalStatus =
  | "draft"
  | "sponsoring"
  | "inadmissible"
  | "deliberation"
  | "voting"
  | "objection_window"
  | "reconciliation"
  | "revote"
  | "enacted"
  | "rejected"
  | "withdrawn"
  | "expired";

export type VoteChoice = "yes" | "no" | "abstain";
export type DecisionOutcome = "accept" | "contested" | "reject" | "needs_more_votes";

export interface ProposalSummary {
  id: string;
  seq: number;
  kind: ProposalKind;
  title: string;
  status: ProposalStatus;
  tier: Tier | null;
  authorId: string;
  authorNickname: string;
  categories: string[];
  parentTopicId: string | null;
  createdAt: number;
  phaseEndsAt: number | null;
  sponsorCount: number;
  sponsorsRequired: number;
  messageCount: number;
  participation?: { voted: number; eligible: number } | null;
}

export interface ProposalVersion {
  version: number;
  title: string;
  body: string;
  createdAt: number;
  authorId: string;
  authorNickname: string;
  viaSuggestionId: string | null;
  contentHash: string;
}

export interface AmendmentPayload {
  baseVersion: number;
  newTitle: string;
  newBody: string;
}

export interface DeletionPayload {
  messageIds: string[];
  ground: string; // fy:SilmeGerekcesi IRI
  statement: string;
}

export interface PhaseEvent {
  from: ProposalStatus | null;
  to: ProposalStatus;
  at: number;
  reason: string;
  ledgerTx: string | null;
}

export interface Suggestion {
  id: string;
  proposalId: string;
  authorId: string;
  authorNickname: string;
  body: string;
  status: "open" | "accepted" | "rejected";
  createdAt: number;
  decidedAt: number | null;
}

export interface DecisionCheck {
  key: string; // quorum | threshold | bridge:g0 | author_cluster | override | revote_threshold | cold_start ...
  label: string; // Türkçe açıklama
  passed: boolean;
  value: string; // "18/40"
  required: string; // "≥ 10"
  detail?: string;
}

export interface ClusterResult {
  clusterId: string; // g0, g1 ...
  label: string; // "Görüş Grubu A"
  members: number; // n_g
  significant: boolean;
  yes: number;
  no: number;
  abstain: number;
  voted: number;
  pg: number; // P_g (gösterim için float)
  floor: number | null;
  passed: boolean | null; // anlamlı değilse null
}

export interface DecisionResult {
  algoVersion: string; // "KC-1.0"
  round: 1 | 2;
  outcome: DecisionOutcome;
  totals: {
    eligible: number;
    participants: number;
    yes: number;
    no: number;
    abstain: number;
    delegated: number;
    unrouted: number;
  };
  approval: number; // a (gösterim)
  quorumRequired: number;
  thresholdUsed: Rational;
  thresholdStrict: boolean;
  quorumMet: boolean;
  thresholdMet: boolean;
  bridgeApplicable: boolean;
  bridgeMet: boolean | null;
  overrideMet: boolean | null;
  gac: number | null;
  clusters: ClusterResult[];
  checks: DecisionCheck[];
  reason: string; // Türkçe özet
  inputsHash: string;
  computedAt: number;
}

export interface ObjectionInfo {
  id: string;
  userId: string;
  nickname: string;
  ground: string;
  statement: string;
  clusterId: string | null;
  at: number;
}

export interface ObjectionEvaluation {
  valid: boolean;
  rule: "cluster" | "cross_cluster" | null;
  signers: number;
  perCluster: { clusterId: string; signers: number; noVoters: number; required: number }[];
  crossClusterRequired: number;
  strong: boolean; // imzacılar kümenin tüm üyelerinin ≥ 2/3'ü → ρ' = max(ρ, 2/3)
  explanation: string;
}

export interface MinorityReport {
  id: string;
  proposalId: string;
  authorId: string;
  authorNickname: string;
  clusterId: string | null;
  body: string;
  createdAt: number;
}

export interface BallotReceipt {
  proposalId: string;
  round: 1 | 2;
  ballotId: string;
  choice: VoteChoice;
  salt: string;
  commitment: string;
  txHash: string | null;
  castAt: number;
}

export interface ProposalDetail extends ProposalSummary {
  body: string;
  version: number;
  versions: ProposalVersion[];
  amendment: AmendmentPayload | null;
  deletion: DeletionPayload | null;
  regulationPatch: RegulationPatch | null;
  audit: AuditReport | null;
  params: DecisionParams | null;
  phaseStartedAt: number | null;
  votingRound: 0 | 1 | 2;
  reconciliationOrigin: "contested" | "objection" | null;
  extensionUsed: boolean;
  sponsors: { userId: string; nickname: string; at: number }[];
  events: PhaseEvent[];
  suggestions: Suggestion[];
  results: DecisionResult[]; // tur sırasıyla
  objections: ObjectionInfo[];
  objectionEvaluation: ObjectionEvaluation | null;
  minorityReports: MinorityReport[];
  expertPanel: ExpertPanelInfo | null;
  aiAnalyses: AiAnalysisInfo[];
  myBallot: { choice: VoteChoice; receipt: BallotReceipt } | null;
  myEffectiveVia: { delegateNickname: string; choice: VoteChoice } | null;
  canVote: boolean;
  canObject: boolean;
  parentTopic: { id: string; title: string } | null;
  enactedEntityId: string | null;
  ledgerTxs: { type: string; txHash: string; at: number }[];
}

export interface CreateProposalInput {
  kind: ProposalKind;
  title: string;
  body: string;
  categories: string[];
  parentTopicId?: string; // subtopic / amendment hedefi
  amendment?: AmendmentPayload;
  deletion?: DeletionPayload;
  regulationPatch?: RegulationPatch;
  requestExpert?: boolean;
}

// ───────────────────────── Konular & tartışma ─────────────────────────

export interface TopicSummary {
  id: string;
  seq: number;
  parentId: string | null;
  title: string;
  categories: string[];
  version: number;
  status: "active" | "archived";
  createdAt: number;
  updatedAt: number;
  childCount: number;
  messageCount: number;
  openProposalCount: number;
}

export interface TopicRevision {
  version: number;
  title: string;
  body: string;
  viaProposalId: string | null;
  createdAt: number;
  contentHash: string;
}

export interface TopicDetail extends TopicSummary {
  body: string;
  originProposalId: string | null;
  revisions: TopicRevision[];
  children: TopicSummary[];
  ancestors: { id: string; title: string }[];
  openProposals: ProposalSummary[];
}

export type ThreadType = "topic" | "proposal";
export type Stance = "pro" | "con" | "neutral" | "question";
export type MessageVisibility = "visible" | "collapsed" | "hidden" | "sealed";

export interface MessageView {
  id: string;
  seq: number;
  threadType: ThreadType;
  threadId: string;
  parentId: string | null;
  authorId: string;
  authorNickname: string;
  stance: Stance;
  body: string | null; // gizliyse null (denetçi hariç)
  version: number;
  visibility: MessageVisibility;
  tombstone: string | null; // "[#K-12 kararıyla gizlendi — gerekçe: ...]"
  hiddenByProposalId: string | null;
  rebuttal: { body: string; at: number } | null;
  aiFlag: { risk: number; labels: string[] } | null;
  endorsements: { agree: number; disagree: number; mine: -1 | 0 | 1 };
  bridgingScore: number | null;
  createdAt: number;
  updatedAt: number;
  contentHash: string;
  ledgerTx: string | null;
  pendingDeletionProposalId: string | null;
}

export interface MessageVersionView {
  version: number;
  body: string;
  createdAt: number;
  contentHash: string;
}

// ───────────────────────── Bilirkişi ─────────────────────────

export type ExpertStatus = "applied" | "active" | "suspended" | "removed" | "rejected";
export type ExpertAssessment = "feasible" | "infeasible" | "uncertain";
export type AssignmentStatus = "invited" | "accepted" | "recused" | "reported" | "overdue" | "replaced";

export interface ExpertInfo {
  userId: string;
  nickname: string;
  domains: string[];
  credentials: string;
  status: ExpertStatus;
  reputation: number;
  activeAssignments: number;
  completedReports: number;
}

export interface ExpertQuestion {
  id: string;
  proposalId: string;
  authorId: string;
  authorNickname: string;
  body: string;
  minorityGuaranteed: boolean;
  createdAt: number;
}

export interface ExpertReportView {
  id: string;
  assignmentId: string;
  expertId: string;
  expertNickname: string;
  assessment: ExpertAssessment;
  confidence: number;
  risks: string[];
  answers: { questionId: string; answer: string }[];
  body: string;
  dissent: string | null;
  lintIssues: { quote: string; kind: string; message: string }[];
  contentHash: string;
  ledgerTx: string | null;
  createdAt: number;
}

export interface ExpertPanelInfo {
  panelId: string;
  proposalId: string;
  round: number;
  isCounterPanel: boolean;
  seed: string;
  seedSource: { blockHash: string; blockHeight: number; proposalId: string; round: number };
  candidates: { userId: string; nickname: string; weight: number; softConflict: number; excludedReason?: string }[];
  assignments: { id: string; expertId: string; nickname: string; status: AssignmentStatus; dueAt: number }[];
  reports: ExpertReportView[];
  questions: ExpertQuestion[];
  suspensiveFlag: boolean;
  noExpertAvailable: boolean;
  ledgerTx: string | null;
  createdAt: number;
}

// ───────────────────────── Graf ─────────────────────────

export type EdgeType =
  | "FOLLOWS"
  | "VOUCHES"
  | "DELEGATES_TO"
  | "RELATED_TO"
  | "REPLIED_TO"
  | "ENDORSED"
  | "AUTHORED"
  | "EXPERT_IN"
  | "AGREES";

export interface GraphEdgeView {
  id: string;
  src: string;
  dst: string;
  type: EdgeType;
  weight: number;
  scope: string | null;
  meta: Record<string, unknown> | null;
  createdAt: number;
}

export interface GraphVisNode {
  id: string; // user id
  label: string; // nickname
  cluster: string | null;
  community: number | null; // Louvain
  pagerank: number;
  isExpert: boolean;
  sybilFlag: boolean;
  x?: number;
  y?: number; // PCA koordinatları (görüş haritası)
}

export interface GraphVisEdge {
  source: string;
  target: string;
  type: EdgeType;
  weight: number;
}

export interface GraphStats {
  nodes: number;
  edges: number;
  communities: number;
  modularity: number;
  delegationGini: number;
  maxDelegationLoad: number;
  brokers: { userId: string; nickname: string; score: number }[];
  sybilFlagged: number;
  permanentLoser: { clusterId: string; lostShare: number; decisions: number }[];
}

export interface DelegationView {
  id: string;
  from: string;
  to: string;
  toNickname: string;
  scope: string; // "*" veya kategori IRI
  rank: number;
  createdAt: number;
}

export interface ClusterSnapshotView {
  id: string;
  k: number;
  silhouette: number;
  members: number;
  createdAt: number;
  seed: string;
  inputHash: string;
  ledgerTx: string | null;
  clusters: { clusterId: string; label: string; size: number; centroid: [number, number] }[];
  points: { userId: string; nickname: string; clusterId: string; x: number; y: number }[];
}

// ───────────────────────── Dağıtık defter ─────────────────────────

export type LedgerTxType =
  | "MEMBER_REGISTERED"
  | "MEMBER_VERIFIED"
  | "MEMBER_ERASED"
  | "PROPOSAL_CREATED"
  | "PROPOSAL_VERSION"
  | "SPONSORED"
  | "PHASE_CHANGED"
  | "VOTE_COMMIT"
  | "BALLOT_REVEAL"
  | "TALLY"
  | "OBJECTION"
  | "MINORITY_REPORT"
  | "MESSAGE_POSTED"
  | "MESSAGE_EDITED"
  | "MESSAGE_HIDDEN"
  | "TOPIC_REVISION"
  | "EXPERT_DRAW"
  | "EXPERT_REPORT"
  | "AI_ANALYSIS"
  | "BYLAW_VERSION"
  | "CLUSTER_SNAPSHOT"
  | "GRAPH_RUN"
  | "DELEGATION"
  | "EVIDENCE";

export interface LedgerTx {
  type: LedgerTxType;
  payload: Record<string, unknown>;
  nonce: string; // tekilleştirme
  submittedAt: number;
  sig: string; // uygulama sunucusu anahtarı ile Ed25519 imzası (hex)
}

export interface LedgerTxView extends LedgerTx {
  hash: string;
  height: number | null;
  index: number | null;
}

export interface BlockHeaderView {
  height: number;
  round: number;
  hash: string;
  prevHash: string;
  time: number;
  proposer: string; // doğrulayıcı kimliği
  txRoot: string;
  txCount: number;
  commitSigs: { validator: string; sig: string }[];
}

export interface BlockView extends BlockHeaderView {
  txs: LedgerTxView[];
}

export interface InclusionProof {
  txHash: string;
  height: number;
  index: number;
  leafHash: string;
  path: { hash: string; side: "L" | "R" }[];
  txRoot: string;
  header: BlockHeaderView;
  validators: { id: string; publicKey: string }[];
}

export interface ValidatorStatus {
  id: string;
  publicKey: string;
  height: number;
  lastHash: string;
  fault: "none" | "crash" | "byzantine";
  healthy: boolean;
  operator: string;
}

export interface LedgerStatus {
  mode: "in-process" | "multi-process";
  validators: ValidatorStatus[];
  height: number;
  mempool: number;
  quorum: number;
  faultTolerance: number;
  sameMachineNotice: boolean;
}

export interface ChainVerification {
  nodeId: string;
  ok: boolean;
  checkedBlocks: number;
  errors: { height: number; error: string }[];
}

// ───────────────────────── Yapay zekâ ─────────────────────────

export type AiTask =
  | "classify"
  | "moderate"
  | "summarize"
  | "similar"
  | "bridging_drafts"
  | "lint_expert_report"
  | "explain_decision";

export interface AiCitedPoint {
  text: string;
  cites: string[]; // mesaj kimlikleri
}

export interface DiscussionSummary {
  commonGround: AiCitedPoint[];
  contested: AiCitedPoint[];
  minorityViews: AiCitedPoint[];
  openQuestions: AiCitedPoint[];
  coverage: number; // 0..1
}

export interface AiAnalysisInfo {
  id: string;
  task: AiTask;
  targetType: string;
  targetId: string;
  model: string; // "claude-opus-5-5" veya "offline-heuristic"
  offline: boolean;
  output: unknown;
  label: string; // "Yapay zekâ ile üretildi · model · tarih"
  approvedBy: string | null;
  createdAt: number;
  ledgerTx: string | null;
}

// ───────────────────────── Genel ─────────────────────────

export interface ApiError {
  error: { code: string; message: string; details?: unknown };
}

export interface Notification {
  id: string;
  kind: string;
  title: string;
  body: string;
  link: string | null;
  read: boolean;
  createdAt: number;
}

export interface SystemInfo {
  version: string;
  now: number; // sunucu (simüle) saati
  clockOffsetMs: number;
  timeScale: number;
  aiMode: "claude" | "offline";
  aiModel: string;
  ledger: { height: number; validators: number; healthy: number };
  bylawVersion: number;
  members: { verified: number; pending: number };
}
