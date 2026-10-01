// Dağıtık defter servisi: aynı süreçte N (varsayılan 4) Tendermint tarzı doğrulayıcı, bellek içi mesaj ağı.
// Uygulama sunucusu işlemleri kendi Ed25519 anahtarıyla imzalar ve bir doğrulayıcıya iletir; işlem gossip ile
// yayılır, 2f+1 precommit ile işlenir. Okumalar sağlıklı çoğunluk düğümünden (kanonik görünüm) yapılır.
import { join } from "node:path";
import {
  CHAIN_ID,
  canonicalJson,
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
import { MemoryTransport, type LinkConditions } from "./transport";
import { checkEvidence, computeTxHash, findPiiKey, isPlainObject, isTxType, signTxHash, txNonce } from "./tx";
import { faultToleranceOf, quorumOf, type ChainParams } from "./verify";
import { MAX_TXS_PER_BLOCK, MAX_TX_BYTES, OPERATOR_NOTICE, type EvidencePayload, type Fault, type SignedTx, type StoredBlock } from "./types";

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
    this.running = true;
    for (const n of this.nodes) n.start(this.transport);
    for (const p of this.pending.values()) this.deliver(p.tx);
    this.scheduleTick();
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
    for (const [hash, p] of this.pending) {
      if (canon.hasTx(hash)) {
        this.settle(hash, canon);
        continue;
      }
      if (++p.age % 3 === 0) this.deliver(p.tx, true);
    }
    this.checkFlush();
  }

  // ───────────── İşlem gönderme ─────────────

  submit(type: LedgerTxType, payload: Record<string, unknown>): { txHash: string } {
    if (this.stopped) throw stoppedError();
    if (!isTxType(type)) throw unprocessable("ledger_bad_type", `Geçersiz defter işlem türü: ${String(type)}`);
    if (!isPlainObject(payload)) throw unprocessable("ledger_bad_payload", "Defter yükü bir nesne olmalı.");
    let canon: string;
    try {
      canon = canonicalJson(payload);
    } catch {
      throw unprocessable("ledger_bad_payload", "Defter yükü kanonik JSON'a çevrilemiyor (sonlu olmayan sayı ya da desteklenmeyen tip).");
    }
    if (canon.length > MAX_TX_BYTES) throw unprocessable("ledger_too_large", "Defter kaydı çok büyük.");
    const normalized = JSON.parse(canon) as Record<string, unknown>;
    const pii = findPiiKey(normalized);
    if (pii) throw new AppError(422, "ledger_pii", `Defter kaydı kişisel veri içeremez (yasak alan: ${pii}).`, { key: pii });
    if (type === "EVIDENCE") {
      const e = checkEvidence(normalized, this.params.validators);
      if (e) throw unprocessable("ledger_bad_evidence", e);
    }
    const nonce = txNonce(type, normalized);
    const hash = computeTxHash(type, normalized, nonce);
    if (this.pending.has(hash) || this.canonical().hasTx(hash)) return { txHash: hash };
    const tx: SignedTx = { type, payload: normalized, nonce, submittedAt: this.ctx.clock.now(), sig: signTxHash(hash, this.appSecretKey), hash };
    this.pending.set(hash, { tx, age: 0 });
    if (this.running) this.deliver(tx);
    return { txHash: hash };
  }

  async submitAndWait(type: LedgerTxType, payload: Record<string, unknown>, timeoutMs = 10_000): Promise<CommittedTx> {
    const { txHash } = this.submit(type, payload);
    const done = this.getTx(txHash);
    if (done) {
      this.pending.delete(txHash);
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
    if (this.flushDone()) return Promise.resolve();
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
    const set = this.waiters.get(hash);
    this.waiters.delete(hash);
    for (const w of set ?? []) {
      clearTimeout(w.timer);
      w.reject(err);
    }
  }

  private onCommit(node: ValidatorNode, block: StoredBlock): void {
    if (this.eligible(node)) {
      for (const tx of block.txs) if (this.pending.has(tx.hash) || this.waiters.has(tx.hash)) this.settle(tx.hash, node);
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

  private settle(hash: string, node: ValidatorNode): void {
    this.pending.delete(hash);
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
    return { chainId: CHAIN_ID, validators: this.ids.map((id) => ({ id, publicKey: this.params.validators.get(id)! })) };
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
