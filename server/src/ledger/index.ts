// Dağıtık defter servisi: aynı süreçte N (varsayılan 4) Tendermint tarzı doğrulayıcı, bellek içi mesaj ağı.
// Uygulama sunucusu işlemleri kendi Ed25519 anahtarıyla imzalar ve bir doğrulayıcıya iletir; işlem gossip ile
// yayılır, 2f+1 precommit ile işlenir. Okumalar sağlıklı çoğunluk düğümünden (kanonik görünüm) yapılır.
// Bekleyen (onaylanmamış) işlemler ana veritabanındaki giden kutusunda da tutulur ve açılışta yeniden gönderilir (./outbox.ts).
// Bir DB işlemi içinden yapılan gönderim, işlem COMMIT olana dek doğrulayıcılara iletilmez (geri alınan işlem deftere hayalet kayıt
// bırakmaz); giden kutusu satırı ise o işlemin parçasıdır ve yazılamazsa işlem asıl hatayla geri alınır.
import { join } from "node:path";
import {
  CHAIN_ID,
  ed25519PublicKey,
  merkleLeaf,
  merkleProof,
  type BlockView,
  type ChainVerification,
  type InclusionProof,
  type LedgerStatus,
  type LedgerTxType,
  type ValidatorKeys,
} from "@forum/shared";
import type { CommittedTx, CoreContext, LedgerService } from "../core/contracts";
import { AppError, badRequest, notFound, unprocessable } from "../core/errors";
import { loadLedgerKeys } from "./keys";
import { ValidatorNode } from "./node";
import { MemoryBlockStore, SqliteBlockStore, type BlockStore } from "./store";
import { forgetOutbox, loadOutbox, recordOutbox } from "./outbox";
import { MemoryTransport, type LinkConditions } from "./transport";
import { checkEvidence, prepareTx, signTxHash } from "./tx";
import { faultToleranceOf, quorumOf, type ChainParams } from "./verify";
import { MAX_TXS_PER_BLOCK, OPERATOR_NOTICE, type EvidencePayload, type Fault, type SignedTx, type StoredBlock } from "./types";

export { MemoryTransport, type LinkConditions, type Transport } from "./transport";
export { LEDGER_TX_TYPES, PII_KEYS } from "./tx";
export type { EvidencePayload } from "./types";

export interface LedgerOptions {
  persist?: boolean;
  validatorCount?: number;
  blockIntervalMs?: number;
  /** Tur zaman aşımı tabanı (ms). Varsayılan: max(150, 4 × blok aralığı). */
  timeoutMs?: number;
  maxTxsPerBlock?: number;
  /** Bellek içi ağ koşulları (gecikme / titreşim / kayıp) ve RNG tohumu */
  network?: LinkConditions & { seed?: string };
  /** Aynı doğrulayıcı için iki EVIDENCE arasında en az kaç yükseklik (varsayılan 100) */
  evidenceCooldown?: number;
}

interface Waiter {
  resolve(tx: CommittedTx): void;
  reject(e: unknown): void;
  timer: NodeJS.Timeout;
}

interface FlushWaiter {
  resolve(): void;
  reject(e: unknown): void;
  timer: NodeJS.Timeout;
}

const FAULTS: Fault[] = ["none", "crash", "byzantine"];
const stoppedError = () => new AppError(503, "ledger_stopped", "Defter durduruldu; işlem kabul edilmiyor.");

/**
 * Günlük için güvenli hata özeti: node:sqlite hatalarında `code` hep "ERR_SQLITE_ERROR"dır; asıl neden SQLite'ın sayısal kodu
 * (`errcode`) ve genel açıklaması (`errstr`, ör. "database or disk is full") alanlarındadır. Hata iletisi YAZILMAZ.
 */
export function safeErrorInfo(e: unknown): string {
  const o = (typeof e === "object" && e !== null ? e : {}) as { code?: unknown; errcode?: unknown; errstr?: unknown; name?: unknown };
  const parts = [typeof o.code === "string" ? o.code : typeof o.name === "string" ? o.name : "bilinmiyor"];
  if (typeof o.errcode === "number") parts.push(`errcode=${o.errcode}`);
  if (typeof o.errstr === "string" && o.errstr) parts.push(o.errstr);
  return parts.join(", ");
}

export class InProcessLedger implements LedgerService {
  readonly ids: string[];
  readonly persist: boolean;
  readonly blockIntervalMs: number;
  readonly timeoutMs: number;
  readonly appPublicKey: string;
  transport: MemoryTransport;
  private nodes: ValidatorNode[] = [];
  private readonly maxTxs: number;
  private readonly appSecretKey: string;
  private readonly secretKeys: Map<string, string>;
  private readonly params: ChainParams;
  private running = false;
  private stopped = false;
  private readonly pending = new Map<string, { tx: SignedTx; age: number }>();
  private readonly waiters = new Map<string, Set<Waiter>>();
  private readonly flushWaiters = new Set<FlushWaiter>();
  private tickTimer: NodeJS.Timeout | null = null;
  private cursor = 0;
  /**
   * Kalıcı kipte blokta onaylanmış ama doğrulayıcı depoları henüz diske indirilmemiş (sync) işlemlerin özetleri. Giden kutusu
   * satırları ancak depolar sync() edildikten sonra silinir: elektrik kesintisinde son blok kaybolsa bile satır kalır ve işlem
   * açılışta yeniden gönderilir.
   */
  private readonly unsynced = new Set<string>();

  constructor(
    private readonly ctx: CoreContext,
    private readonly opts: LedgerOptions = {},
  ) {
    const n = opts.validatorCount ?? 4;
    if (!Number.isInteger(n) || n < 1 || n > 64) throw badRequest("ledger_validators", "Doğrulayıcı sayısı 1 ile 64 arasında olmalı.");
    this.ids = Array.from({ length: n }, (_, i) => `v${i}`);
    this.persist = opts.persist ?? ctx.config.dataDir !== ":memory:";
    this.blockIntervalMs = Math.max(0, opts.blockIntervalMs ?? ctx.config.ledgerBlockIntervalMs);
    this.timeoutMs = Math.max(1, opts.timeoutMs ?? Math.max(150, 4 * this.blockIntervalMs));
    this.maxTxs = Math.max(1, opts.maxTxsPerBlock ?? MAX_TXS_PER_BLOCK);
    const keys = loadLedgerKeys(this.persist ? ctx.config.dataDir : null, this.ids);
    this.appSecretKey = keys.app;
    this.appPublicKey = ed25519PublicKey(keys.app);
    this.secretKeys = keys.validators;
    const validators = new Map(this.ids.map((id) => [id, ed25519PublicKey(keys.validators.get(id)!)] as const));
    this.params = { ids: this.ids, validators, appPublicKey: this.appPublicKey, quorum: quorumOf(n) };
    this.transport = new MemoryTransport(opts.network);
    this.build();
  }

  private build(): void {
    this.nodes = this.ids.map((id) => {
      const store: BlockStore = this.persist ? new SqliteBlockStore(join(this.ctx.config.dataDir, "ledger", `${id}.db`)) : new MemoryBlockStore();
      return new ValidatorNode(
        {
          id,
          secretKey: this.secretKeys.get(id)!,
          params: this.params,
          blockIntervalMs: this.blockIntervalMs,
          timeoutMs: this.timeoutMs,
          maxTxsPerBlock: this.maxTxs,
          evidenceCooldown: this.opts.evidenceCooldown ?? 100,
        },
        store,
        {
          now: () => this.ctx.clock.now(),
          onCommit: (node, block) => this.onCommit(node, block),
          onEvidence: (p) => this.onEvidence(p),
        },
      );
    });
  }

  // ───────────── Yaşam döngüsü ─────────────

  async start(): Promise<void> {
    if (this.running) return;
    if (this.stopped) {
      if (this.persist) this.build(); // depolar kapatıldı: diskten yeniden yükle
      this.transport = new MemoryTransport(this.opts.network);
      this.stopped = false;
    }
    this.recoverOutbox();
    this.running = true;
    for (const n of this.nodes) n.start(this.transport);
    for (const p of this.pending.values()) this.deliver(p.tx);
    this.scheduleTick();
  }

  /**
   * Açılış uzlaştırması (#273): giden kutusunda kalan satırlar (sert kapanışta havuzdan kaybolmuş ya da COMMIT sonrası gönderilememiş
   * işlemler) yeniden imzalanıp bekleyenlere eklenir. Zaten zincirde olanların satırı silinir (onaylandıktan hemen sonra kesilmiş);
   * doğrulamadan geçmeyen bozuk satır atılır. Özet (type, payload, nonce) üzerinden hesaplandığından aynı işlem iki kez yazılamaz.
   */
  private recoverOutbox(): void {
    let rows: ReturnType<typeof loadOutbox>;
    try {
      rows = loadOutbox(this.ctx.db);
    } catch {
      return; // veritabanı okunamıyor: yalnız bellekteki bekleyenlerle devam (eski davranış)
    }
    const canon = this.canonical();
    const drop: string[] = [];
    const inChain: string[] = [];
    for (const r of rows) {
      if (this.pending.has(r.hash)) continue;
      if (canon.hasTx(r.hash)) {
        inChain.push(r.hash);
        continue;
      }
      let prepared: ReturnType<typeof prepareTx>;
      try {
        prepared = prepareTx(r.type, JSON.parse(r.payload));
      } catch {
        drop.push(r.hash);
        continue;
      }
      if (prepared.hash !== r.hash || prepared.nonce !== r.nonce || (r.type === "EVIDENCE" && checkEvidence(prepared.payload, this.params.validators))) {
        drop.push(r.hash);
        continue;
      }
      const submittedAt = Number.isFinite(r.submitted_at) ? Number(r.submitted_at) : this.ctx.clock.now();
      const tx: SignedTx = { type: r.type as LedgerTxType, payload: prepared.payload, nonce: prepared.nonce, submittedAt, sig: signTxHash(prepared.hash, this.appSecretKey), hash: prepared.hash };
      this.pending.set(prepared.hash, { tx, age: 0 });
    }
    this.forget(drop);
    this.retire(inChain);
  }

  /** Bir Db.tx işleminin içinden mi çağrıldık? (Sahte bağlamlarda alan yoksa: hayır.) */
  private inDbTx(): boolean {
    return this.ctx.db.inTransaction === true;
  }

  /**
   * Giden kutusu satırlarını siler. Otomatik kayıt kipinde hata yutulur: kalan satır bir sonraki açılışta zincirde bulunup yine
   * silinir. Çağıran bir DB işlemi içindeyse hata YUTULMAZ: SQLite işlemi kendiliğinden geri almış olabilir (disk dolu …) ve
   * çağıranın işlemi asıl hatayla geri alınmalıdır (yutulsa sonraki yazımlar işlemin dışına taşardı).
   */
  private forget(hashes: readonly string[]): void {
    if (hashes.length === 0) return;
    if (this.inDbTx()) {
      forgetOutbox(this.ctx.db, hashes);
      return;
    }
    try {
      forgetOutbox(this.ctx.db, hashes);
    } catch {
      /* veritabanı kapalı/meşgul: açılış uzlaştırması temizler */
    }
  }

  /** Blokta onaylanan işlemlerin satırlarını siler: bellek kipinde hemen, kalıcı kipte depolar sync() edildikten sonra. */
  private retire(hashes: readonly string[]): void {
    if (hashes.length === 0) return;
    if (!this.persist) {
      this.forget(hashes);
      return;
    }
    for (const h of hashes) this.unsynced.add(h);
  }

  /**
   * Doğrulayıcı depolarını diske indirir (fsync), ardından onaylanmış işlemlerin giden kutusu satırlarını tek deyimle siler.
   * Bir depo indirilemezse satırlar kalır (sonraki tick yeniden dener; açılış uzlaştırması zincirdekileri zaten siler).
   */
  private syncRetired(): void {
    if (this.unsynced.size === 0) return;
    try {
      for (const n of this.nodes) n.store.sync();
    } catch (e) {
      console.error(`[defter] doğrulayıcı deposu diske indirilemedi (${safeErrorInfo(e)}); giden kutusu satırları korunuyor.`);
      return;
    }
    const hashes = [...this.unsynced];
    this.unsynced.clear();
    this.forget(hashes);
  }

  async stop(): Promise<void> {
    if (this.stopped) return;
    this.running = false;
    this.stopped = true;
    if (this.tickTimer) clearTimeout(this.tickTimer);
    this.tickTimer = null;
    for (const set of this.waiters.values()) {
      for (const w of set) {
        clearTimeout(w.timer);
        w.reject(stoppedError());
      }
    }
    this.waiters.clear();
    for (const w of this.flushWaiters) {
      clearTimeout(w.timer);
      w.reject(stoppedError());
    }
    this.flushWaiters.clear();
    for (const n of this.nodes) n.stop();
    this.transport.close();
    this.syncRetired(); // depolar kapanmadan: onaylananların satırları diske indirildikten sonra silinir
    if (this.persist) for (const n of this.nodes) n.store.close();
  }

  private scheduleTick(): void {
    this.tickTimer = setTimeout(() => {
      this.tickTimer = null;
      if (!this.running) return;
      this.onTick();
      this.scheduleTick();
    }, this.timeoutMs);
  }

  /** Havuzdan düşmüş olabilecek (ör. kayıplı ağ, çöken giriş düğümü) bekleyen işlemleri yeniden iletir. */
  private onTick(): void {
    const canon = this.canonical();
    const settled: string[] = [];
    for (const [hash, p] of this.pending) {
      if (canon.hasTx(hash)) {
        this.settle(hash, canon, settled);
        continue;
      }
      if (++p.age % 3 === 0) this.deliver(p.tx, true);
    }
    this.retire(settled);
    this.syncRetired();
    this.checkFlush();
  }

  // ───────────── İşlem gönderme ─────────────

  /**
   * `nonce` isteğe bağlıdır: verilirse kurala (txNonce) uymak ZORUNDADIR — ForumCore, işlem içinde önceden hesapladığı özetle
   * gerçek gönderimin aynı işlemi üreteceğini böyle doğrular. Verilmezse nonce kuraldan türetilir.
   *
   * Bir Db.tx işleminin İÇİNDEN çağrılırsa (ör. graf vekâleti, bilirkişi kurası, hesap silme kaskadı) özet hemen hesaplanır ve
   * döndürülür, giden kutusu satırı işlemin parçası olarak yazılır; işlemin bekleyenlere eklenmesi ve doğrulayıcılara iletilmesi
   * EN DIŞTAKİ işlem COMMIT olana dek ertelenir (Db.afterCommit). İşlem geri alınırsa satır da gönderim de geri alınır: defterde
   * veritabanında karşılığı olmayan kayıt kalmaz.
   */
  submit(type: LedgerTxType, payload: Record<string, unknown>, nonce?: string): { txHash: string } {
    if (this.stopped) throw stoppedError();
    const prepared = prepareTx(type, payload);
    const normalized = prepared.payload;
    if (nonce !== undefined && nonce !== prepared.nonce) throw unprocessable("ledger_bad_nonce", "Nonce kurala uymuyor.");
    if (type === "EVIDENCE") {
      const e = checkEvidence(normalized, this.params.validators);
      if (e) throw unprocessable("ledger_bad_evidence", e);
    }
    const hash = prepared.hash;
    if (this.pending.has(hash)) return { txHash: hash };
    if (this.canonical().hasTx(hash)) {
      this.retire([hash]); // ForumCore işlem içinde satır yazmış olabilir: işlem zaten zincirde (kalıcı kipte sync sonrası silinir)
      return { txHash: hash };
    }
    const tx: SignedTx = { type, payload: normalized, nonce: prepared.nonce, submittedAt: this.ctx.clock.now(), sig: signTxHash(hash, this.appSecretKey), hash };
    this.persistPending(tx);
    if (this.inDbTx()) this.ctx.db.afterCommit(() => this.enqueue(tx));
    else this.enqueue(tx);
    return { txHash: hash };
  }

  /** İşlemi bekleyenlere ekler ve iletir (işlem dışında hemen, işlem içinden gönderimde COMMIT sonrası). */
  private enqueue(tx: SignedTx): void {
    // Durdurulduysa satır giden kutusunda kalır ve bir sonraki açılışta gönderilir.
    if (this.stopped || this.pending.has(tx.hash)) return;
    if (this.canonical().hasTx(tx.hash)) {
      this.retire([tx.hash]);
      return;
    }
    this.pending.set(tx.hash, { tx, age: 0 });
    if (this.running) this.deliver(tx);
  }

  /**
   * Bekleyen işlemi giden kutusuna yazar (sert kapanışta kaybolmasın; #273). Çağıran bir DB işlemi içindeyse satır o işleme katılır
   * ve yazım hatası YUTULMAZ: çağıranın işlemi asıl hatayla (ör. disk dolu) geri alınır, işlem doğrulayıcılara hiç iletilmez.
   * İşlem dışında yazılamazsa (veritabanı kapalı, disk dolu) gönderim yine yapılır: işlem bellekte bekler (eski davranış).
   * Günlüğe yalnız özet ve hata kodu yazılır (yük ve hata iletisi yazılmaz).
   */
  private persistPending(tx: SignedTx): void {
    const row = { hash: tx.hash, type: tx.type, payload: tx.payload, nonce: tx.nonce, submittedAt: tx.submittedAt };
    if (this.inDbTx()) {
      recordOutbox(this.ctx.db, row);
      return;
    }
    try {
      recordOutbox(this.ctx.db, row);
    } catch (e) {
      console.error(`[defter] bekleyen işlem giden kutusuna yazılamadı (${tx.hash}, ${safeErrorInfo(e)}); yalnız bellekte bekliyor.`);
    }
  }

  async submitAndWait(type: LedgerTxType, payload: Record<string, unknown>, timeoutMs = 10_000): Promise<CommittedTx> {
    const { txHash } = this.submit(type, payload);
    const done = this.getTx(txHash);
    if (done) {
      if (this.pending.delete(txHash)) this.retire([txHash]);
      return done;
    }
    return new Promise<CommittedTx>((resolve, reject) => {
      const w: Waiter = {
        resolve,
        reject,
        timer: setTimeout(() => {
          const set = this.waiters.get(txHash);
          set?.delete(w);
          if (set && !set.size) this.waiters.delete(txHash);
          reject(new AppError(504, "ledger_timeout", "İşlem süresi içinde deftere işlenemedi."));
        }, timeoutMs),
      };
      let set = this.waiters.get(txHash);
      if (!set) this.waiters.set(txHash, (set = new Set()));
      set.add(w);
    });
  }

  flush(timeoutMs = 30_000): Promise<void> {
    if (this.flushDone()) {
      this.syncRetired();
      return Promise.resolve();
    }
    if (!this.running) return Promise.reject(this.stopped ? stoppedError() : new AppError(503, "ledger_not_running", "Defter başlatılmadı."));
    return new Promise<void>((resolve, reject) => {
      const w: FlushWaiter = {
        resolve,
        reject,
        timer: setTimeout(() => {
          this.flushWaiters.delete(w);
          reject(new AppError(504, "ledger_timeout", "Defter havuzu süresi içinde boşalmadı."));
        }, timeoutMs),
      };
      this.flushWaiters.add(w);
    });
  }

  /** İşlemi bir doğrulayıcıya (RPC) iletir; önce sağlıklı düğümler denenir. */
  private deliver(tx: SignedTx, rotate = false): void {
    const rank = (n: ValidatorNode) => (n.fault === "none" ? 0 : n.fault === "byzantine" ? 1 : 2);
    const start = rotate ? this.cursor++ : 0;
    const order = this.nodes.map((_, i) => this.nodes[(start + i) % this.nodes.length]).sort((a, b) => rank(a) - rank(b));
    for (const node of order) {
      const r = node.receiveClientTx(structuredClone(tx));
      if (r === "unavailable") continue;
      if (r === "invalid") this.rejectPending(tx.hash, unprocessable("ledger_rejected", "Doğrulayıcılar işlemi geçersiz buldu."));
      return;
    }
  }

  private rejectPending(hash: string, err: AppError): void {
    this.pending.delete(hash);
    this.forget([hash]); // doğrulayıcılar geçersiz buldu: yeniden göndermek aynı sonucu verir
    const set = this.waiters.get(hash);
    this.waiters.delete(hash);
    for (const w of set ?? []) {
      clearTimeout(w.timer);
      w.reject(err);
    }
  }

  private onCommit(node: ValidatorNode, block: StoredBlock): void {
    if (this.eligible(node)) {
      const settled: string[] = [];
      for (const tx of block.txs) if (this.pending.has(tx.hash) || this.waiters.has(tx.hash)) this.settle(tx.hash, node, settled);
      // Yalnız bekleyenden ilk çıkışta (her düğümün commit'inde değil). Kalıcı kipte satırlar depolar sync() edilince silinir.
      this.retire(settled);
    }
    this.checkFlush();
  }

  private onEvidence(p: EvidencePayload): void {
    try {
      this.submit("EVIDENCE", p as unknown as Record<string, unknown>);
    } catch {
      // defter durduruluyorsa kanıt düşer; bir sonraki çift imzada yeniden üretilir
    }
  }

  /** `settled`: bekleyenlerden yeni çıkan özetler eklenir (çağıran giden kutusundan toplu siler). */
  private settle(hash: string, node: ValidatorNode, settled: string[]): void {
    if (this.pending.delete(hash)) settled.push(hash);
    const set = this.waiters.get(hash);
    if (!set) return;
    const c = node.committedTx(hash) ?? this.canonical().committedTx(hash);
    if (!c) return;
    this.waiters.delete(hash);
    for (const w of set) {
      clearTimeout(w.timer);
      w.resolve(structuredClone(c));
    }
  }

  private flushDone(): boolean {
    if (this.pending.size) return false;
    const healthy = this.nodes.filter((n) => n.fault === "none");
    const pool = healthy.length ? healthy : this.nodes.filter((n) => n.fault !== "crash");
    const top = Math.max(0, ...this.nodes.map((n) => n.height()));
    return pool.every((n) => n.mempool.size === 0 && n.height() === top);
  }

  private checkFlush(): void {
    if (!this.flushWaiters.size || !this.flushDone()) return;
    this.syncRetired();
    for (const w of this.flushWaiters) {
      clearTimeout(w.timer);
      w.resolve();
    }
    this.flushWaiters.clear();
  }

  // ───────────── Kanonik görünüm ─────────────

  private healthy(n: ValidatorNode): boolean {
    return n.fault === "none" && n.integrityOk();
  }

  private eligible(node: ValidatorNode): boolean {
    return this.healthy(node) || !this.nodes.some((n) => this.healthy(n));
  }

  /** En yüksek, yapısal olarak doğrulanmış ve hata enjekte edilmemiş düğüm. */
  private canonical(): ValidatorNode {
    let pool = this.nodes.filter((n) => this.healthy(n));
    if (!pool.length) pool = this.nodes.filter((n) => n.integrityOk());
    if (!pool.length) pool = this.nodes;
    return pool.reduce((a, b) => (b.height() > a.height() ? b : a));
  }

  private node(id: string): ValidatorNode {
    const n = this.nodes.find((x) => x.id === id);
    if (!n) throw notFound("Doğrulayıcı");
    return n;
  }

  /** Test/demo: doğrudan düğüm erişimi. */
  validator(id: string): ValidatorNode {
    return this.node(id);
  }

  getTx(txHash: string): CommittedTx | null {
    return this.canonical().committedTx(txHash);
  }

  findTxs(filter: { type?: LedgerTxType; proposalId?: string; limit?: number }): CommittedTx[] {
    return this.canonical().findTxs(filter);
  }

  getBlock(height: number, nodeId?: string): BlockView | null {
    return (nodeId ? this.node(nodeId) : this.canonical()).blockView(height);
  }

  listBlocks(opts: { from?: number; limit?: number }): BlockView[] {
    const c = this.canonical();
    const top = c.height();
    const from = Math.min(opts.from ?? top, top);
    const limit = Math.min(Math.max(1, opts.limit ?? 20), 500);
    const out: BlockView[] = [];
    for (let h = from; h >= 1 && out.length < limit; h--) out.push(c.blockView(h)!);
    return out;
  }

  latestBlock(): { height: number; hash: string; time: number } {
    const c = this.canonical();
    const last = c.lastInfo();
    return { height: c.height(), hash: last.hash, time: last.time };
  }

  proof(txHash: string): InclusionProof | null {
    const c = this.canonical();
    const tx = c.committedTx(txHash);
    if (!tx) return null;
    const block = c.exportBlock(tx.height)!;
    return {
      txHash,
      height: tx.height,
      index: tx.index,
      leafHash: merkleLeaf(txHash),
      path: merkleProof(
        block.txs.map((t) => t.hash),
        tx.index,
      ),
      txRoot: block.header.txRoot,
      header: block.header,
      validators: this.validatorKeys().validators,
    };
  }

  /** İstemcinin ilk kullanımda sabitleyeceği doğrulayıcı anahtarları (GET /api/ledger/validators). */
  validatorKeys(): ValidatorKeys {
    return { chainId: CHAIN_ID, validators: this.ids.map((id) => ({ id, publicKey: this.params.validators.get(id)! })), appPublicKey: this.appPublicKey };
  }

  status(): LedgerStatus {
    const c = this.canonical();
    return {
      mode: "in-process",
      validators: this.nodes.map((n) => ({
        id: n.id,
        publicKey: n.publicKey,
        height: n.height(),
        lastHash: n.lastInfo().hash,
        fault: n.fault,
        healthy: this.healthy(n),
        operator: OPERATOR_NOTICE,
      })),
      height: c.height(),
      mempool: Math.max(this.pending.size, c.mempool.size),
      quorum: quorumOf(this.ids.length),
      faultTolerance: faultToleranceOf(this.ids.length),
      sameMachineNotice: true,
    };
  }

  verifyChain(nodeId?: string): ChainVerification[] {
    return (nodeId ? [this.node(nodeId)] : this.nodes).map((n) => n.verifyFull());
  }

  /** Tanı: düğümlerde bugüne dek yapılan blok doğrulaması sayısı (verifyChain önbelleğinin etkisini ölçer). */
  verifiedBlockCount(): number {
    return this.nodes.reduce((sum, n) => sum + n.blockVerifications, 0);
  }

  tamper(nodeId: string, height: number): void {
    if (!Number.isInteger(height) || height < 1) throw badRequest("ledger_bad_height", "Geçersiz blok yüksekliği.");
    this.node(nodeId).tamper(height);
  }

  async repair(nodeId: string): Promise<ChainVerification> {
    const node = this.node(nodeId);
    const rank = (n: ValidatorNode) => (this.healthy(n) ? 0 : 1);
    const peers = this.nodes.filter((n) => n !== node && n.fault !== "crash").sort((a, b) => rank(a) - rank(b));
    node.repairFrom(peers);
    return node.verifyFull();
  }

  setFault(nodeId: string, fault: "none" | "crash" | "byzantine"): void {
    if (!FAULTS.includes(fault)) throw badRequest("ledger_bad_fault", "Hata türü none, crash ya da byzantine olmalı.");
    this.node(nodeId).setFault(fault);
  }
}

export function createLedgerService(
  ctx: CoreContext,
  opts?: { persist?: boolean; validatorCount?: number; blockIntervalMs?: number } & LedgerOptions,
): LedgerService {
  return new InProcessLedger(ctx, opts);
}

/** Testler ve demo için iç ayrıntılara (ağ, düğümler) erişimli fabrika. */
export function createInProcessLedger(ctx: CoreContext, opts?: LedgerOptions): InProcessLedger {
  return new InProcessLedger(ctx, opts);
}
