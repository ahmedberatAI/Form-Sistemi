// Modüller arası SÖZLEŞMELER. Her modül kendi arayüzünü uygular; diğer modüllere yalnızca
// bu arayüzler üzerinden (bağımlılık enjeksiyonuyla) erişir. Böylece modüller paralel geliştirilip
// sahte (fake) uygulamalarla test edilebilir.
import type {
  AiAnalysisInfo,
  AiTask,
  ArticleInfo,
  AuditReport,
  BlockView,
  BylawVersionInfo,
  CategoryNode,
  ChainVerification,
  ClusterSnapshotView,
  CorrectionRequestInput,
  CorrectionRequestView,
  CorrectionReview,
  CorrectionStatus,
  DelegationView,
  DiscussionSummary,
  EdgeType,
  ExpertAssessment,
  ExpertInfo,
  ExpertPanelInfo,
  ExpertQuestion,
  ExpertReportView,
  GraphEdgeView,
  GraphStats,
  GraphVisEdge,
  GraphVisNode,
  GroundInfo,
  InclusionProof,
  LedgerStatus,
  LedgerTxType,
  LedgerTxView,
  Me,
  PiiRecord,
  ProposalKind,
  RegistrationInput,
  RegulationPatch,
  RightInfo,
  Role,
  Tier,
  VoteChoice,
} from "@forum/shared";
import type { EffectiveVote } from "@forum/shared";
import type { Clock } from "./clock";
import type { Db } from "../db";
import type { Config } from "./config";

// ═════════════════════════ Dağıtık defter ═════════════════════════

export interface CommittedTx extends LedgerTxView {
  height: number;
  index: number;
  blockHash: string;
  blockTime: number;
}

export interface LedgerService {
  /** Uygulama sunucusunun işlem imzalama açık anahtarı (hex). tx.sig = Ed25519(hexToBytes(tx.hash)). */
  readonly appPublicKey: string;
  start(): Promise<void>;
  stop(): Promise<void>;
  /**
   * İşlemi uygulama anahtarıyla imzalar ve havuza (mempool) ekler. Hemen döner (bloğa girmesini beklemez).
   * Aynı (type, payload, nonce) iki kez gönderilirse aynı hash döner (tekilleştirme).
   */
  submit(type: LedgerTxType, payload: Record<string, unknown>, nonce?: string): { txHash: string };
  /** Gönderir ve ≥2f+1 doğrulayıcı tarafından işlenene (commit) kadar bekler. */
  submitAndWait(type: LedgerTxType, payload: Record<string, unknown>, timeoutMs?: number): Promise<CommittedTx>;
  /** Havuzdaki her şey işlenene kadar bekler (testler ve tohumlama için). */
  flush(timeoutMs?: number): Promise<void>;
  getTx(txHash: string): CommittedTx | null;
  /**
   * En yeniden eskiye işlemler. `ballotId` / `round` verilirse yük alanına göre süzülür ("Oyum kayıtlı mı?" son taahhüt denetimi:
   * yalnız bu pusulanın taahhütleri; liste kesilmez). Çağıran bunları `proposalId` ile birlikte verir (öneri dizini üzerinden taranır).
   */
  findTxs(filter: { type?: LedgerTxType; proposalId?: string; ballotId?: string; round?: number; limit?: number }): CommittedTx[];
  getBlock(height: number, nodeId?: string): BlockView | null;
  listBlocks(opts: { from?: number; limit?: number }): BlockView[];
  /** En son işlenmiş (kanonik) blok; zincir boşsa genesis. */
  latestBlock(): { height: number; hash: string; time: number };
  proof(txHash: string): InclusionProof | null;
  status(): LedgerStatus;
  verifyChain(nodeId?: string): ChainVerification[];
  /** Demo/test: bir doğrulayıcının yerel kopyasında bloğu bozar (tamper). */
  tamper(nodeId: string, height: number): void;
  /** Bozulmuş/geride kalmış düğümü eşlerinden onarır. */
  repair(nodeId: string): Promise<ChainVerification>;
  /** Demo/test: hata enjeksiyonu. byzantine: çift imza / geçersiz öneri. */
  setFault(nodeId: string, fault: "none" | "crash" | "byzantine"): void;
}

// ═════════════════════════ Ontoloji / yönetmelik ═════════════════════════

export interface ProposalAuditInput {
  id?: string;
  kind: ProposalKind;
  title: string;
  body: string;
  /** Yazarın seçtiği + YZ'nin (yalnız yükseltme) eklediği kategori IRI'leri */
  categories: string[];
  /** Etkilenen temel haklar (IRI) ve yönü. "member"/"ai" kaynaklı bayraklar yalnızca yükseltir (en çok T1 + uyarı); T3 yalnız "author"/"expert" ile. */
  rightsAffected?: { right: string; direction: "restrict" | "expand"; source: "author" | "ai" | "expert" | "member" }[];
  /**
   * İçerik etiketleri (ör. fy:KisiselVeriIfsasi, fy:NefretSoylemi). Yüksek güvende yalnız "rule" (kural tabanlı tespit)
   * ve "expert" (bilirkişi teyidi) ihlal doğurur; "ai" etiketi her güvende danışmadır: uyarı + bilirkişi (Madde 12 (2), 14 (1)).
   */
  contentLabels?: { label: string; confidence: number; source: "ai" | "rule" | "expert" }[];
  parentTopic?: { id: string; categories: string[]; status: string } | null;
  amendment?: { baseVersion: number; currentVersion: number } | null;
  deletion?: { ground: string; messageCount: number } | null;
  regulationPatch?: RegulationPatch | null;
  requestExpert?: boolean;
  /** Toplam doğrulanmış üye sayısı (K_s hesabı için) */
  verifiedMembers: number;
}

export interface OntologyService {
  init(): Promise<void>;
  current(): BylawVersionInfo;
  versions(): BylawVersionInfo[];
  categories(): CategoryNode[]; // ağaç (kökler)
  categoryLabel(iri: string): string;
  /** iri ve tüm üst sınıfları (rdfs:subClassOf kapanışı) */
  ancestors(iri: string): string[];
  /** a, b'nin kendisi ya da alt sınıfı mı? */
  isSubCategoryOf(a: string, b: string): boolean;
  /** Ontolojide ağaç derinliği (kök = 0); vekâlet kapsam sıralaması için */
  depth(iri: string): number;
  rights(): RightInfo[];
  articles(): ArticleInfo[];
  deletionGrounds(): GroundInfo[];
  objectionGrounds(): GroundInfo[];
  /** İçerik etiketleri (fy:IcerikEtiketi) — moderasyon ve denetim için */
  contentLabels(): { iri: string; label: string }[];
  /** Yönetmelik yaması oluşturucusu için ayarlanabilir parametreler (değiştirilemez olanlar işaretli) */
  adjustableParams(): { rule: string; param: string; label: string; value: number | boolean | string; immutable: boolean }[];
  tiers(): { tier: Tier; label: string; quorum: number; threshold: number; clusterFloor: number }[];
  /** Kategori anahtar kelimeleri (çevrimdışı sınıflandırma için) */
  keywordIndex(): { iri: string; keywords: string[] }[];
  /** Tam denetim: N3 çıkarım + SHACL + parametre birleştirme. Saf okuma, yan etkisiz. */
  audit(input: ProposalAuditInput): Promise<AuditReport>;
  /** Yönetmelik yaması geçerli mi (değiştirilemez maddeler, meta-şekiller, döngüsüz overrides)? */
  validatePatch(patch: RegulationPatch): Promise<AuditReport>;
  /** Kabul edilen yamayı uygular → yeni sürüm (bylaw_versions), BYLAW_VERSION defter kaydı çağıran tarafından yapılır. */
  applyPatch(patch: RegulationPatch, proposalId: string): Promise<BylawVersionInfo>;
  /** BYLAW_VERSION defter kaydının hash'ini sürüme bağlar. */
  setLedgerTx(version: number, txHash: string): void;
  /** Yürürlükteki yönetmeliğin Turtle çıktısı */
  exportTurtle(version?: number): string;
}

// ═════════════════════════ Graf ═════════════════════════

export interface NewEdge {
  src: string; // "user:<id>" vb.
  dst: string;
  type: EdgeType;
  weight?: number;
  scope?: string | null;
  rank?: number | null;
  meta?: Record<string, unknown> | null;
}

export interface DelegationEdge {
  id: string;
  from: string; // userId (önek yok)
  to: string;
  scope: string; // "*" | kategori IRI
  rank: number;
  createdAt: number;
}

export interface ConflictCheck {
  hard: boolean;
  soft: number; // 0 | 0.5 | 1
  distance: number | null;
  reasons: string[]; // Türkçe
}

export interface GraphService {
  /** SQLite'tan bellek içi graphology grafını yeniden kurar. */
  rebuild(): void;
  addEdge(e: NewEdge): GraphEdgeView;
  /** Kenar silinmez; revoked_at doldurulur. */
  revokeEdge(id: string): void;
  listEdges(filter: { src?: string; dst?: string; type?: EdgeType; includeRevoked?: boolean }): GraphEdgeView[];
  follow(userId: string, targetUserId: string): GraphEdgeView;
  unfollow(userId: string, targetUserId: string): void;
  vouch(userId: string, targetUserId: string, level: "known" | "close" | "just_met" | "suspicious"): GraphEdgeView;
  relate(userA: string, userB: string, kind: "family" | "business" | "household"): GraphEdgeView;
  /** Döngü oluşturursa ya da sıra/kapsam kuralı ihlal edilirse AppError fırlatır. */
  delegate(from: string, to: string, scope: string, rank: number): DelegationView;
  revokeDelegation(id: string, byUserId: string): void;
  delegations(userId?: string): DelegationEdge[];
  /** Belirli kenar tipleri üzerinden yönsüz en kısa mesafe (maxDepth'e kadar), yoksa null. */
  distance(a: string, b: string, types: EdgeType[], maxDepth: number): number | null;
  /** ALGORITMA.md §8 adım 3-4 */
  conflictOfInterest(expertUserId: string, authorUserId: string, opts?: { householdOf?: (userId: string) => string | null }): ConflictCheck;
  /** Kapanmış önerilerdeki oy uzlaşısından AGREES kenarları + Louvain toplulukları (tohumlu). */
  agreementCommunities(seed: string): { communities: Record<string, number>; modularity: number; count: number };
  pagerank(): Record<string, number>;
  brokers(limit: number): { userId: string; score: number }[];
  /** SybilRank benzeri güven yayılımı (kefil kenarları, doğrulanmış tohumlar). */
  sybilRank(): { scores: Record<string, number>; flagged: string[] };
  /** Kilit adım (lockstep) oy tespiti: bir öneride benzer zamanlarda aynı oyu veren yoğun gruplar. */
  lockstep(proposalId: string): { groups: string[][] };
  stats(): GraphStats;
  /**
   * Yalnız kalıcı kaybeden göstergesi (stats().permanentLoser ile aynı değer), önbellekli: ana sayfa panosu bunu kullanır;
   * uzlaşı (Louvain), aracı ve sybil hesaplarını tetiklemez.
   */
  permanentLoser(): GraphStats["permanentLoser"];
  /**
   * Graf görselleştirme verisi. Görünürlük politikası hizmetin KENDİSİNDE uygulanır ve varsayılan olarak KAPALIDIR:
   *  - AGREES (oy gizliliği) hiçbir koşulda verilmez;
   *  - RELATED_TO (aile/iş/hane yakınlık beyanı) yalnız `includePrivate === true` iken verilir. Çağıran bunu YALNIZ yetkili
   *    görüntüleyen (doğrulanmış denetçi/yönetici) için açar; verilmezse özel kenar istense bile dönmez;
   *  - siyasi görüş alanları (cluster, community, x, y — KVKK md. 6) yalnız `viewerId` ile eşleşen KENDİ düğümünde bulunur
   *    (cluster/community null, x/y yok); `viewerId` verilmezse hiçbir düğümde bulunmaz.
   */
  visualization(opts: {
    /** İstenen kenar türleri: verilmezse varsayılan (FOLLOWS, VOUCHES, DELEGATES_TO); BOŞ dizi → hiç kenar. */
    includeEdgeTypes?: EdgeType[];
    limit?: number;
    /** Özel nitelikli (RELATED_TO) kenarları da ver; varsayılan false. */
    includePrivate?: boolean;
    /** Siyasi görüş alanlarının görünebileceği tek kullanıcı (görüntüleyenin kendisi); varsayılan yok. */
    viewerId?: string | null;
  }): { nodes: GraphVisNode[]; edges: GraphVisEdge[] };
}

// ═════════════════════════ Yönetişim matematiği (saf) ═════════════════════════

export interface VoteMatrixEntry {
  userId: string;
  proposalId: string;
  value: 1 | -1 | 0;
}

export interface ClusterComputation {
  algo: string; // "pca2-kmeans-silhouette-null/2" (KC-1.0 r2, sıfır modeli)
  k: number;
  silhouette: number;
  assignments: Record<string, string>; // userId → "g0"
  coords: Record<string, [number, number]>;
  sizes: Record<string, number>;
  clusteredTotal: number;
  excluded: string[]; // yeterli oyu olmayanlar
  inputHash: string;
  outputHash: string;
  seed: string;
}

export interface GovernanceMath {
  computeClusters(entries: VoteMatrixEntry[], seed: string, opts?: { minVotes?: number; kMax?: number }): ClusterComputation;
  resolveEffectiveVotes(input: {
    eligible: string[];
    direct: Map<string, VoteChoice>;
    delegations: DelegationEdge[];
    /** önerinin kategorileri, en özelden genele; sonuna "*" eklenir */
    scopeOrder: string[];
    cap: number;
    maxHops: number;
    clusterOf: (userId: string) => string | null;
  }): {
    votes: EffectiveVote[];
    unrouted: string[];
    capped: string[];
    loads: Record<string, number>;
    /**
     * Vekâletle sayılan her oy için oyu uygulanan (zincirin sonundaki, doğrudan oy veren) delege: delegatör → delege.
     * Yalnız sunucuda saklanır (myEffectiveVia); defterde YOKTUR. Sınırı aşan (unrouted) kişiler burada yer almaz.
     */
    delegateOf: Record<string, string>;
  };
  /** Tohumlu ağırlıklı yerine koymadan örnekleme (bilirkişi kurası) */
  drawWeighted<T extends { id: string; weight: number }>(candidates: T[], k: number, seed: string): T[];
}

// ═════════════════════════ Kimlik ═════════════════════════

export interface AuthUser {
  id: string;
  nickname: string;
  roles: Role[];
  status: Me["status"];
  isAdult: boolean;
  politicalConsent: boolean;
  aiConsent: boolean;
}

export interface IdentityService {
  register(input: RegistrationInput): Promise<{ user: Me }>;
  /** Kurulum: sistemde hiç yönetici yokken ilk yöneticiyi doğrulanmış olarak oluşturur (yoksa 409 admin_exists). */
  bootstrapAdmin(input: RegistrationInput): Promise<{ user: Me }>;
  /** "Sistem tarafından girilir": kayıt memuru üyeyi doğrudan doğrulanmış olarak oluşturur. */
  createByRegistrar(actorId: string, input: RegistrationInput): Promise<{ user: Me }>;
  verify(actorId: string, userId: string, decision: "approve" | "reject", note?: string): Promise<Me>;
  listPending(): { id: string; nickname: string; createdAt: number }[];
  login(nicknameOrEmail: string, password: string): Promise<{ token: string; user: Me }>;
  logout(token: string): void;
  authenticate(token: string): AuthUser | null;
  me(userId: string): Me;
  getPii(actorId: string, userId: string, purpose: string): PiiRecord;
  householdOf(userId: string): string | null;
  /** Rızalar ve kişisel sıralama tercihi (personalRanking; yalnız siyasi görüş rızasıyla birlikte etkilidir). */
  setConsents(userId: string, c: { aiConsent?: boolean; politicalConsent?: boolean; personalRanking?: boolean }): Me;
  setRoles(actorId: string, userId: string, roles: Role[]): Me;
  exportOwnData(userId: string): Record<string, unknown>;
  /**
   * KVKK: kripto-imha. Oylamaya konmaz. Ön koşullar (hesap açık, son yönetici değil) HER yan etkiden önce denetlenir ve hata
   * EŞZAMANLI fırlatılır (Promise reddi değil; 409 last_admin / already_erased); çağıran bunu kendi işleminin başında çağırarak
   * ardından gelen yazımları (vekâlet iptali vb.) aynı işlemde toplayabilir. Hesap satırı + denetim kaydı tek işlemde yazılır;
   * MEMBER_ERASED defter kaydı ve WAL denetim noktası işlem tamamlandıktan SONRA yapılır (işlem geri alınırsa yazılmaz).
   * Dönen söz yalnız başarıda, bu son adımlardan sonra çözülür.
   */
  eraseSelf(userId: string): Promise<void>;
  /** keepToken: verilen oturum açık kalır, diğerleri iptal edilir. */
  changePassword(userId: string, oldPw: string, newPw: string, keepToken?: string): Promise<void>;
  /**
   * Takma ad değişikliği (şifre teyidiyle): kayıt kuralı, tekillik (I/ı katlamalı anahtar) ve benzerlik denetimi,
   * 30 günde en çok bir kez (422 nickname_change_limit); `identity.nickname_change` denetim kaydı (eski/yeni ad yazılmaz).
   */
  changeNickname(userId: string, nickname: string, password: string): Promise<Me>;
  /** Silme gibi geri dönüşsüz işlemlerden önce şifre teyidi. */
  verifyPassword(userId: string, password: string): Promise<boolean>;
  /** Sonradan 18 yaşını dolduranların bayrağını günceller (zamanlayıcı çağırır). */
  refreshAdulthood(): number;
  /**
   * Süresi geçmiş bekleyen başvuruları kripto-imha eder (zamanlayıcı çağırır). Süre GERÇEK duvar saatiyle ölçülür (simüle saat
   * ve TIME_SCALE etkilemez; demo hızlandırması gerçek kişilerin verisini yok etmemeli); başlangıç anı meta tablosunda tutulur.
   */
  purgeStalePending(maxAgeMs?: number): number;

  // ── KVKK md. 11/1-d: kimlik verisi düzeltme talebi (üye → kayıt memuru; gerekçeli, amaç kayıtlı inceleme, denetim izli) ──
  /** Üye gerekçeli düzeltme talebi açar (aynı anda tek bekleyen talep). Önerilen değerler kişinin DEK'iyle şifreli saklanır. */
  requestCorrection(userId: string, input: CorrectionRequestInput): CorrectionRequestView;
  /** Üyenin kendi talepleri (en yeni önce; kendi gerekçesiyle). */
  myCorrections(userId: string): CorrectionRequestView[];
  /** Bekleyen kendi talebini geri çeker; önerilen değerler imha edilir. */
  withdrawCorrection(userId: string, correctionId: string): CorrectionRequestView;
  /** Kayıt memuru / denetçi / yönetici: talepler (değer içermez). Varsayılan yalnız bekleyenler. */
  listCorrections(actorId: string, status?: CorrectionStatus | "all"): CorrectionRequestView[];
  /** Amaç belirterek inceleme: pii_access_log + audit_log; mevcut ve önerilen değerler (TCKN maskeli) ve gerekçe döner. */
  reviewCorrection(actorId: string, correctionId: string, purpose: string): CorrectionReview;
  /** Kayıt memuru / yönetici (önce incelemiş olmalı, kendi talebine karar veremez). Onayda kasa alanları yeniden şifrelenir. */
  decideCorrection(actorId: string, correctionId: string, decision: "approve" | "reject", note?: string): CorrectionRequestView;
}

// ═════════════════════════ Yapay zekâ ═════════════════════════

/**
 * YZ analiz kayıtları (ai_analyses + AI_ANALYSIS defter girdisi). Forum ve diğer modüller YZ kayıtlarına YALNIZCA bu
 * arayüzle erişir (../ai iç yardımcılarını doğrudan içe aktarmaz).
 */
export interface AiRecordSink {
  /**
   * ai_analyses tablosuna yazar ve (isteğe bağlı) AI_ANALYSIS defter kaydı oluşturur.
   * promptVersion verilmezse YZ modülünün güncel istem sürümü kullanılır.
   */
  record(a: Omit<AiAnalysisInfo, "id" | "label" | "ledgerTx" | "createdAt"> & { inputHash: string; outputHash: string; promptVersion?: string }): AiAnalysisInfo;
  /** Tek analiz (yoksa null). */
  get(id: string): AiAnalysisInfo | null;
  /** Hedefin (ör. "proposal", id) tüm analizleri, en yeniden eskiye. */
  list(targetType: string, targetId: string): AiAnalysisInfo[];
  /** Aynı görev + hedef + girdi özetiyle üretilmiş en son analiz (yoksa null): aynı istek yeniden üretilmek yerine yeniden kullanılır. */
  findByInput(task: AiTask, targetType: string, targetId: string, inputHash: string): AiAnalysisInfo | null;
  /** İnsan onayı (yetki denetimi çağıranındır). İlk onay kalıcıdır; tekrar çağrı mevcut kaydı döndürür. Yoksa 404. */
  approve(id: string, userId: string): AiAnalysisInfo;
}

export interface ClassificationResult {
  categories: { iri: string; confidence: number }[];
  rightsAffected: { right: string; direction: "restrict" | "expand"; confidence: number }[];
  contentLabels: { label: string; confidence: number }[];
  rationale: string;
  offline: boolean;
  model: string;
}

export interface PiiFinding {
  kind: "tckn" | "iban" | "phone" | "email" | "address";
  start: number;
  end: number;
  masked: string;
}

export interface ModerationResult {
  risk: 0 | 1 | 2 | 3;
  labels: string[]; // ontoloji içerik etiketi IRI'leri
  articleIds: string[];
  spans: { start: number; end: number; quote: string }[];
  pii: PiiFinding[];
  rationale: string;
  offline: boolean;
  model: string;
  /**
   * Etiket başına modelin ya da çevrimdışı sezgiselin KENDİ güveni (0–1). Öneri içerik etiketleri bu güveni taşır;
   * risk düzeyinden türetilmez. Eksikse (eski kayıt, sahte servis) çağıran temkinli varsayılan kullanır.
   */
  labelConfidences?: { label: string; confidence: number }[];
}

export interface SummaryInputMessage {
  id: string;
  pseudonym: string; // K1, K2 … (takma ad bile gönderilmez)
  clusterId: string | null;
  stance: string;
  body: string;
}

/** Tartışma özeti girdisi. Ek alanların tümü isteğe bağlıdır ve azınlık bölümünü besler. */
export interface SummaryInput {
  topicTitle: string;
  messages: SummaryInputMessage[];
  /**
   * Küme anlık görüntüsündeki ANLAMLI kümelerin nüfus büyüklükleri ({"g0": 21, "g2": 6}); tartışmaya yazan kişi sayısı
   * değildir. Verilmişse azınlık = en küçük anlamlı küme(ler). Boş nesne: anlık görüntü var ama iki anlamlı küme yok.
   */
  clusterSizes?: Record<string, number>;
  /** Kesin sayım "contested" ise köprü testini geçemeyen anlamlı kümeler (bülten verisi; kişisel veri yok). */
  failedClusters?: { clusterId: string; members: number; yes: number; no: number }[];
  /** Karar kaydına eklenen azınlık raporları (K-kodlu; kimlik rapor kimliğidir, mesaj kimliği değildir). */
  minorityReports?: { id: string; pseudonym: string; clusterId: string | null; body: string }[];
}

export interface AiCallOptions {
  forceOffline?: boolean;
  /** Yalnız lintExpertReport: bilirkişinin alanları (etiket ya da IRI) — "alan dışı" denetimi için */
  domains?: string[];
}

/** Claude çağrılarının sağlığı (içerik ya da kişisel veri içermez; yalnızca sayaç ve hata sınıfı). */
export interface AiHealth {
  /** Ardışık başarısızlık sayısı eşiği aştıysa (çağrılar sessizce çevrimdışı yedeğe düşüyor) true. */
  degraded: boolean;
  failures: number;
  lastError: string | null;
  lastErrorAt: number | null;
  lastOkAt: number | null;
}

export interface AiService {
  mode(): "claude" | "offline";
  model(): string;
  /** Claude kipinde çağrı sağlığı (çevrimdışı kipte tanımsız). */
  health?(): AiHealth;
  detectPii(text: string): PiiFinding[];
  // `opts.forceOffline`: içerik sahibi YZ rızası vermemişse (yurt dışına aktarım yok) çevrimdışı sezgisel kullanılır.
  classifyProposal(input: { title: string; body: string }, ctx: { categories: { iri: string; label: string; keywords: string[] }[]; rights: { iri: string; label: string }[]; contentLabels: { iri: string; label: string }[] }, opts?: AiCallOptions): Promise<ClassificationResult>;
  moderate(text: string, ctx: { articles: { iri: string; number: string; title: string }[]; contentLabels: { iri: string; label: string }[] }, opts?: AiCallOptions): Promise<ModerationResult>;
  summarize(input: SummaryInput, opts?: AiCallOptions): Promise<DiscussionSummary & { offline: boolean; model: string }>;
  similar(input: { title: string; body: string }, corpus: { id: string; title: string; body: string }[], limit?: number): { id: string; score: number }[];
  bridgingDrafts(input: { title: string; body: string; majorityPoints: string[]; minorityPoints: string[] }, opts?: AiCallOptions): Promise<{ drafts: { title: string; body: string; rationale: string }[]; offline: boolean; model: string }>;
  lintExpertReport(text: string, opts?: AiCallOptions): Promise<{ issues: { quote: string; kind: string; message: string }[]; offline: boolean; model: string }>;
  /** Sonuç kontrol listesini sade Türkçeye çevirir (şablon tabanlı; YZ gerekmez). */
  explainDecision(checks: { label: string; passed: boolean; value: string; required: string }[], outcomeLabel: string): string;
}

// ═════════════════════════ Bilirkişi ═════════════════════════

export interface ExpertReportInput {
  assessment: ExpertAssessment;
  confidence: number;
  risks: string[];
  answers: { questionId: string; answer: string }[];
  body: string;
  dissent?: string | null;
}

/** Bilirkişi çıktısını biçimlemek için görüntüleyen (oturum yoksa null). */
export type ExpertViewer = { id: string; roles: readonly Role[] } | null;

export interface ExpertService {
  apply(userId: string, domains: string[], credentials: string): ExpertInfo;
  decideApplication(actorId: string, userId: string, decision: "approve" | "reject", note?: string): ExpertInfo;
  sanction(actorId: string, userId: string, action: "warn" | "suspend" | "remove" | "reinstate", note: string): ExpertInfo;
  /**
   * Görüntüleyene göre biçimlenir: `credentials` (serbest metin yeterlilik beyanı, kişisel veri içerebilir) yalnız yönetici,
   * kayıt memuru, denetçi ve bilirkişinin kendisine; diğerlerine (viewer verilmezse de) null + `qualificationSummary`.
   */
  list(filter?: { status?: string; domain?: string }, viewer?: ExpertViewer): ExpertInfo[];
  get(userId: string, viewer?: ExpertViewer): ExpertInfo | null;
  addQuestion(proposalId: string, userId: string, body: string, minorityGuaranteed?: boolean): ExpertQuestion;
  /**
   * ALGORITMA.md §8. Tohum = SHA256(sonBlokHash ‖ proposalId ‖ round). EXPERT_DRAW defter kaydı yapılır.
   * opts.counter: karşı panel (önceki panelistler hariç).
   */
  drawPanel(
    proposalId: string,
    opts: {
      categories: string[];
      authorId: string;
      k: number;
      dueAt: number;
      counter?: boolean;
      /**
       * Tohum öğütmeye karşı: çekilişi zamanlayıcı başlatır ve tohum, ÖNCEDEN taahhüt edilmiş yükseklikteki
       * bloğun hash'inden alınır (ör. tartışma açılışında "o anki yükseklik + 1"; bkz. forum/lifecycle SEED_COMMIT_LEAD).
       * Verilmezse son blok kullanılır.
       */
      seedBlock?: { height: number; hash: string };
    },
  ): Promise<ExpertPanelInfo>;
  respond(assignmentId: string, expertId: string, decision: "accept" | "recuse", reason?: string): Promise<ExpertPanelInfo>;
  submitReport(assignmentId: string, expertId: string, input: ExpertReportInput): Promise<ExpertReportView>;
  /** `viewer` yoksa ya da personel (yönetici/kayıt memuru/denetçi) değilse dışlama gerekçeleri genel ifadeyle döner. */
  panel(proposalId: string, viewer?: ExpertViewer): ExpertPanelInfo | null;
  /** §8 adım 9: rapor verenlerin ≥2/3'ü infeasible ve güven medyanı ≥0,8 */
  suspensiveFlag(proposalId: string): boolean;
  /** Öneri kapandığında (geri çekildi, düştü, kabul/red) bekleyen atamaları itibar cezası olmadan iptal eder. */
  cancelPending(proposalId: string): number;
  /** Süresi geçen atamaları işaretler, itibarı günceller. */
  markOverdue(now: number): number;
  assignmentsFor(expertId: string): { assignmentId: string; proposalId: string; status: string; dueAt: number }[];
  /**
   * Hesabı kapanan (KVKK silme) üyenin bilirkişi kaydını kapatır: bekleyen görevler yedeğe devredilir, kayıt "removed" olur,
   * yeterlilik beyanı ve yaptırım notu imha edilir, alanlar ve EXPERT_IN kenarları kaldırılır. Kayıt yoksa bir şey yapmaz.
   * Hesap silme rotası bunu imha ile AYNI db.tx içinde çağırır. Yedeğe devredilen görev sayısını döndürür.
   */
  closeForClosedAccount(userId: string): number;
}

// ═════════════════════════ Ortak bağlam ═════════════════════════

export interface Notifier {
  notify(userId: string, n: { kind: string; title: string; body: string; link?: string | null }): void;
  /** Aynı bildirimi birçok kişiye TEK işlemde gönderir (yinelenenler atlanır); uygulamayan notifier'lar için notify() döngüsü kullanılır. */
  notifyMany?(userIds: Iterable<string>, n: { kind: string; title: string; body: string; link?: string | null }): void;
}

export interface CoreContext {
  config: Config;
  db: Db;
  clock: Clock;
}

export type { AiTask };
