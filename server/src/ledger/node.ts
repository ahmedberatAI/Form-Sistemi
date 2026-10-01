// Tek bir doğrulayıcı: Tendermint tarzı BFT (propose → prevote → precommit → commit), kendi anahtarı,
// kendi blok deposu, kendi işlem havuzu (gossip), blok senkronu ve hata enjeksiyonu (crash/byzantine).
//
// Değer/kimlik: Tendermint'teki soyut v değeri burada {prevHash, time, txs} gövdesidir. r turundaki oylar
// id_r(v) = blockHash({height, round: r, proposer: proposerOf(h, r), prevHash, time, txRoot, txCount}) üzerinedir;
// böylece işlenen bloğun başlığındaki tur, precommit imzalarının turuyla aynıdır (istemci doğrulaması için şart).
// Kilit karşılaştırmaları turdan bağımsız içerik kimliği (vid) ile yapılır.
import { blockHash, ed25519PublicKey, ed25519Sign, hashCanonical, merkleRoot, type BlockView } from "@forum/shared";
import type { CommittedTx } from "../core/contracts";
import { notFound } from "../core/errors";
import type { BlockStore } from "./store";
import type { Transport } from "./transport";
import { checkTx, computeTxHash, isHash, isPlainObject, makeEvidence, proposalSignBytes, verifySig, voteSignBytes, type TxCheckContext } from "./tx";
import { GENESIS, blockErrors, faultToleranceOf, proposerOf, quorumOf, structuralErrors, type ChainParams, type PrevInfo } from "./verify";
import {
  MAX_FUTURE_MS,
  type EvidencePayload,
  type Fault,
  type NetMessage,
  type ProposalMsg,
  type SignedTx,
  type StoredBlock,
  type ValueBody,
  type VoteMsg,
  type VoteType,
} from "./types";
import type { ChainVerification, LedgerTxType } from "@forum/shared";

type Step = "propose" | "prevote" | "precommit";

interface Value {
  prevHash: string;
  time: number;
  txs: SignedTx[];
  txRoot: string;
  txCount: number;
  /** Turdan bağımsız içerik kimliği */
  vid: string;
}

interface RoundState {
  proposal: { msg: ProposalMsg; value: Value; blockHash: string } | null;
  prevotes: Map<string, VoteMsg>;
  precommits: Map<string, VoteMsg>;
}

interface PersistedState {
  height: number;
  round: number;
  lockedRound: number;
  lockedValue: ValueBody | null;
  validRound: number;
  validValue: ValueBody | null;
  signed: (ProposalMsg | VoteMsg)[];
}

export interface NodeHooks {
  now(): number;
  onCommit(node: ValidatorNode, block: StoredBlock): void;
  onEvidence(payload: EvidencePayload): void;
}

export interface NodeOptions {
  id: string;
  secretKey: string;
  params: ChainParams;
  blockIntervalMs: number;
  timeoutMs: number;
  maxTxsPerBlock: number;
  /** Aynı doğrulayıcı için iki kanıt arasında en az kaç yükseklik (spam koruması) */
  evidenceCooldown: number;
}

class TimerSet {
  private readonly set = new Set<NodeJS.Timeout>();
  after(ms: number, fn: () => void): void {
    const t = setTimeout(() => {
      this.set.delete(t);
      fn();
    }, Math.max(0, ms));
    this.set.add(t);
  }
  clear(): void {
    for (const t of this.set) clearTimeout(t);
    this.set.clear();
  }
}

const bodyOf = (v: Value): ValueBody => ({ prevHash: v.prevHash, time: v.time, txs: v.txs });

function push<K>(m: Map<K, string[]>, k: K, v: string): void {
  const a = m.get(k);
  if (a) a.push(v);
  else m.set(k, [v]);
}

function toCommitted(b: StoredBlock, tx: SignedTx, index: number): CommittedTx {
  return structuredClone({
    type: tx.type,
    payload: tx.payload,
    nonce: tx.nonce,
    submittedAt: tx.submittedAt,
    sig: tx.sig,
    hash: tx.hash,
    height: b.header.height,
    index,
    blockHash: b.header.hash,
    blockTime: b.header.time,
  });
}

/** Kurcalama demosu: yükteki ilk düz alanı değiştirir (özet/imza artık tutmaz). */
function alterPayload(p: Record<string, unknown>): Record<string, unknown> {
  const out = { ...p };
  const key = Object.keys(out)
    .filter((k) => !k.startsWith("_"))
    .sort()
    .find((k) => typeof out[k] === "number" || typeof out[k] === "string");
  if (key && typeof out[key] === "number") out[key] = (out[key] as number) + 1;
  else if (key) out[key] = `${String(out[key])}·kurcalandı`;
  else out.kurcalandi = true;
  return out;
}

export class ValidatorNode {
  readonly id: string;
  readonly publicKey: string;
  fault: Fault = "none";
  readonly mempool = new Map<string, SignedTx>();

  private readonly params: ChainParams;
  private readonly txCtx: TxCheckContext;
  private readonly q: number;
  private readonly f: number;
  private readonly T: number;
  private readonly timers = new TimerSet();
  private transport: Transport | null = null;
  private running = false;

  private readonly txIndex = new Map<string, { height: number; index: number }>();
  private readonly byProposal = new Map<string, string[]>();
  private readonly byType = new Map<string, string[]>();
  private verifiedUpTo = 0;
  private corruptAt: number | null = null;

  private h: number;
  private round = 0;
  private step: Step = "propose";
  private started = false;
  private waiting = false;
  private lockedValue: Value | null = null;
  private lockedRound = -1;
  private validValue: Value | null = null;
  private validRound = -1;
  private readonly logs = new Map<number, Map<number, RoundState>>();
  private readonly flags = new Set<string>();
  private signed = new Map<string, ProposalMsg | VoteMsg>();
  private readonly validity = new WeakMap<Value, boolean>();
  private evaluating = false;
  private again = false;
  private readonly lastEvidence = new Map<string, number>();
  private readonly syncAsked = new Map<string, number>();
  private readonly lagSeen = new Map<string, number>();
  private tick = 0;

  constructor(
    private readonly opts: NodeOptions,
    readonly store: BlockStore,
    private readonly hooks: NodeHooks,
  ) {
    this.id = opts.id;
    this.publicKey = ed25519PublicKey(opts.secretKey);
    this.params = opts.params;
    this.txCtx = { appPublicKey: opts.params.appPublicKey, validators: opts.params.validators };
    this.q = quorumOf(opts.params.ids.length);
    this.f = faultToleranceOf(opts.params.ids.length);
    this.T = Math.max(1, opts.timeoutMs);
    this.rebuildIndexes();
    this.h = store.height() + 1;
  }

  // ───────────── Yaşam döngüsü ─────────────

  start(transport: Transport): void {
    if (this.running) return;
    this.transport = transport;
    this.running = true;
    transport.attach(this.id, (from, msg) => this.onMessage(from, msg));
    this.restore();
    if (this.fault !== "crash") this.resume();
  }

  stop(): void {
    if (!this.running) return;
    if (this.store.persistent) {
      this.persistState();
      this.store.setState("mempool", JSON.stringify([...this.mempool.values()]));
    }
    this.running = false;
    this.timers.clear();
    this.transport?.detach(this.id);
    this.transport = null;
  }

  setFault(f: Fault): void {
    const prev = this.fault;
    this.fault = f;
    if (f === "crash" && prev !== "crash") this.timers.clear();
    else if (prev === "crash" && f !== "crash" && this.running) this.resume();
  }

  private resume(): void {
    this.heartbeat();
    if (this.started) this.startRound(this.round);
    else this.scheduleHeightStart(0);
    this.broadcast({ kind: "status", height: this.height(), hash: this.lastInfo().hash });
    for (const peer of this.peers()) {
      this.send(peer, { kind: "sync_request", from: this.height() + 1 });
      this.send(peer, { kind: "mempool_request" });
    }
    this.evaluate();
  }

  private restore(): void {
    const mp = this.store.getState("mempool");
    if (mp) {
      try {
        for (const tx of JSON.parse(mp) as SignedTx[]) this.addTx(tx);
      } catch {
        // kalıcı havuz okunamadı: işlemler kaybolur (belgelenmiş sınırlama)
      }
    }
    const raw = this.store.getState("consensus");
    if (raw) {
      try {
        const s = JSON.parse(raw) as PersistedState;
        if (s.height === this.h) {
          this.lockedRound = s.lockedRound;
          this.lockedValue = s.lockedValue ? this.buildValue(s.lockedValue) : null;
          this.validRound = s.validRound;
          this.validValue = s.validValue ? this.buildValue(s.validValue) : null;
          if (this.lockedRound >= 0 && !this.lockedValue) this.lockedRound = -1;
          if (this.validRound >= 0 && !this.validValue) this.validRound = -1;
          for (const m of s.signed) {
            this.signed.set(m.kind === "proposal" ? `proposal:${m.round}` : `${m.type}:${m.round}`, m);
            this.ingestOwn(m);
          }
          this.round = s.round;
          this.started = true;
        }
      } catch {
        // bozuk durum kaydı: kilitsiz devam (yalnız canlılık etkilenir; imzalı oylar yoksa güvenlik etkilenmez)
      }
    }
  }

  private ingestOwn(m: ProposalMsg | VoteMsg): void {
    const rs = this.rs(m.height, m.round);
    if (m.kind === "proposal") {
      const value = this.buildValue(m.value);
      if (value && !rs.proposal) rs.proposal = { msg: m, value, blockHash: this.blockId(m.height, m.round, value) };
    } else {
      (m.type === "prevote" ? rs.prevotes : rs.precommits).set(this.id, m);
    }
  }

  private heartbeat(): void {
    this.timers.after(this.T, () => {
      if (!this.running || this.fault === "crash") return;
      this.tick++;
      this.broadcast({ kind: "status", height: this.height(), hash: this.lastInfo().hash });
      // Kayıplı ağda canlılık için kendi oy/önerilerini yeniden yayınla.
      if (this.started && !this.waiting) for (const m of this.signed.values()) if (m.round >= this.round - 1) this.broadcast(m);
      this.heartbeat();
    });
  }

  // ───────────── Sorgular ─────────────

  height(): number {
    return this.store.height();
  }

  lastInfo(): PrevInfo {
    const b = this.store.get(this.store.height());
    return b ? { hash: b.header.hash, time: b.header.time } : GENESIS;
  }

  private prevInfo(height: number): PrevInfo {
    if (height <= 1) return GENESIS;
    const p = this.store.get(height - 1);
    return p ? { hash: p.header.hash, time: p.header.time } : GENESIS;
  }

  isRunning(): boolean {
    return this.running;
  }

  consensusInfo(): { height: number; round: number; step: Step; started: boolean; waiting: boolean; lockedRound: number } {
    return { height: this.h, round: this.round, step: this.step, started: this.started, waiting: this.waiting, lockedRound: this.lockedRound };
  }

  hasTx(hash: string): boolean {
    return this.txIndex.has(hash);
  }

  committedTx(hash: string): CommittedTx | null {
    const loc = this.txIndex.get(hash);
    if (!loc) return null;
    const b = this.store.get(loc.height);
    const tx = b?.txs[loc.index];
    return b && tx ? toCommitted(b, tx, loc.index) : null;
  }

  findTxs(filter: { type?: LedgerTxType; proposalId?: string; limit?: number }): CommittedTx[] {
    const limit = filter.limit && filter.limit > 0 ? filter.limit : Infinity;
    const out: CommittedTx[] = [];
    const hashes = filter.proposalId !== undefined ? (this.byProposal.get(filter.proposalId) ?? []) : filter.type ? (this.byType.get(filter.type) ?? []) : null;
    if (hashes) {
      for (let i = hashes.length - 1; i >= 0 && out.length < limit; i--) {
        const loc = this.txIndex.get(hashes[i]);
        const b = loc && this.store.get(loc.height);
        const tx = b && b.txs[loc.index];
        if (!b || !tx || (filter.type && tx.type !== filter.type)) continue;
        out.push(toCommitted(b, tx, loc.index));
      }
      return out;
    }
    for (let hh = this.height(); hh >= 1 && out.length < limit; hh--) {
      const b = this.store.get(hh)!;
      for (let i = b.txs.length - 1; i >= 0 && out.length < limit; i--) out.push(toCommitted(b, b.txs[i], i));
    }
    return out;
  }

  blockView(height: number): BlockView | null {
    const b = this.store.get(height);
    if (!b) return null;
    const v = structuredClone(b);
    return { ...v.header, txs: v.txs.map((t, i) => ({ ...t, height: v.header.height, index: i })) };
  }

  exportBlock(height: number): StoredBlock | null {
    const b = this.store.get(height);
    return b ? structuredClone(b) : null;
  }

  /** Ucuz, artımlı yapısal bütünlük denetimi (kurcalanmış düğüm kanonik okumadan dışlanır). */
  integrityOk(): boolean {
    if (this.corruptAt !== null) return false;
    const n = this.store.height();
    for (let hh = this.verifiedUpTo + 1; hh <= n; hh++) {
      if (structuralErrors(this.store.get(hh)!, hh, this.prevInfo(hh), this.params.ids).length) {
        this.corruptAt = hh;
        return false;
      }
      this.verifiedUpTo = hh;
    }
    return true;
  }

  /** Tam doğrulama: bağlantı, blok özeti, Merkle kökü, işlem özetleri ve imzaları, ≥ 2f+1 precommit imzası. */
  verifyFull(): ChainVerification {
    const errors: { height: number; error: string }[] = [];
    const n = this.store.height();
    for (let hh = 1; hh <= n; hh++) {
      for (const error of blockErrors(this.store.get(hh)!, hh, this.prevInfo(hh), this.params)) errors.push({ height: hh, error });
    }
    return { nodeId: this.id, ok: errors.length === 0, checkedBlocks: n, errors };
  }

  // ───────────── Demo: kurcalama ve onarım ─────────────

  tamper(height: number): void {
    const b = this.store.get(height);
    if (!b || !b.txs.length) throw notFound("Blok");
    const copy = structuredClone(b);
    copy.txs[0].payload = alterPayload(copy.txs[0].payload);
    this.store.put(copy);
    this.markDirty(height);
  }

  /** Bozuk blokları eşlerden (tam doğrulayarak) yeniden yazar, eksikleri ekler. */
  repairFrom(peers: ValidatorNode[]): void {
    const n = this.store.height();
    for (let hh = 1; hh <= n; hh++) {
      const prev = this.prevInfo(hh);
      if (blockErrors(this.store.get(hh)!, hh, prev, this.params).length === 0) continue;
      const next = this.store.get(hh + 1);
      for (const p of peers) {
        const cand = p.exportBlock(hh);
        if (!cand || blockErrors(cand, hh, prev, this.params).length) continue;
        if (next && next.header.prevHash !== cand.header.hash) continue;
        this.store.put(cand);
        break;
      }
    }
    this.markDirty(1);
    this.rebuildIndexes();
    for (;;) {
      const hh = this.height() + 1;
      const cand = peers.map((p) => p.exportBlock(hh)).find((b) => b && this.incomingErrors(b).length === 0);
      if (!cand) break;
      this.applyBlock(cand);
    }
  }

  private markDirty(height: number): void {
    this.verifiedUpTo = Math.min(this.verifiedUpTo, height - 1);
    this.corruptAt = null;
  }

  private rebuildIndexes(): void {
    this.txIndex.clear();
    this.byProposal.clear();
    this.byType.clear();
    for (let hh = 1; hh <= this.store.height(); hh++) this.indexBlock(this.store.get(hh)!);
  }

  private indexBlock(b: StoredBlock): void {
    b.txs.forEach((tx, i) => {
      this.txIndex.set(tx.hash, { height: b.header.height, index: i });
      push(this.byType, tx.type, tx.hash);
      const pid = isPlainObject(tx.payload) ? tx.payload.proposalId : undefined;
      if (typeof pid === "string") push(this.byProposal, pid, tx.hash);
    });
  }

  // ───────────── Ağ ─────────────

  private peers(): string[] {
    return this.params.ids.filter((x) => x !== this.id);
  }

  private send(to: string, msg: NetMessage): void {
    if (this.running && this.fault !== "crash") this.transport?.send(this.id, to, msg);
  }

  private broadcast(msg: NetMessage): void {
    if (this.running && this.fault !== "crash") this.transport?.broadcast(this.id, msg);
  }

  private sign(bytes: Uint8Array): string {
    return ed25519Sign(bytes, this.opts.secretKey);
  }

  /** Uygulama sunucusundan (RPC) gelen işlem. */
  receiveClientTx(tx: SignedTx): "added" | "known" | "invalid" | "unavailable" {
    if (!this.running || this.fault === "crash") return "unavailable";
    const r = this.addTx(tx);
    if (r === "added") this.broadcast({ kind: "tx", tx });
    return r;
  }

  private addTx(tx: SignedTx): "added" | "known" | "invalid" {
    if (!isPlainObject(tx)) return "invalid";
    let hash: string;
    try {
      hash = computeTxHash(tx.type, tx.payload, tx.nonce);
    } catch {
      return "invalid";
    }
    if (this.mempool.has(hash) || this.txIndex.has(hash)) return "known";
    if (checkTx(tx, this.txCtx)) return "invalid";
    this.mempool.set(hash, tx);
    this.evaluate();
    return "added";
  }

  private onMessage(from: string, msg: NetMessage): void {
    if (!this.running || this.fault === "crash" || !this.params.validators.has(from) || typeof msg !== "object" || msg === null) return;
    switch (msg.kind) {
      case "tx":
        if (this.addTx(msg.tx) === "added") this.broadcast(msg);
        break;
      case "proposal":
        this.onProposal(from, msg);
        break;
      case "vote":
        this.onVote(from, msg);
        break;
      case "status":
        this.onStatus(from, msg.height);
        break;
      case "sync_request":
        this.onSyncRequest(from, msg.from);
        break;
      case "sync_response":
        this.onSyncResponse(from, msg.blocks, msg.tip);
        break;
      case "mempool_request":
        this.send(from, { kind: "mempool_response", txs: [...this.mempool.values()].slice(0, 5000) });
        break;
      case "mempool_response":
        if (Array.isArray(msg.txs)) for (const tx of msg.txs) this.addTx(tx);
        break;
    }
  }

  private onStatus(from: string, height: number): void {
    if (!Number.isInteger(height)) return;
    const mine = this.height();
    if (height <= mine) {
      this.lagSeen.delete(from);
      return;
    }
    // Bir blok gerideysek ve bu ilk duyumsa bekle (eş az önce işlemiş olabilir, biz de işlemek üzereyiz).
    if (height > mine + 1 || this.lagSeen.get(from) === height) this.requestSync(from);
    else this.lagSeen.set(from, height);
  }

  private requestSync(peer: string, force = false): void {
    if (!force && this.syncAsked.get(peer) === this.tick) return;
    this.syncAsked.set(peer, this.tick);
    this.send(peer, { kind: "sync_request", from: this.height() + 1 });
  }

  private onSyncRequest(from: string, start: number): void {
    if (!Number.isInteger(start) || start < 1) return;
    const top = this.integrityOk() ? this.height() : (this.corruptAt ?? 1) - 1;
    const blocks: StoredBlock[] = [];
    for (let hh = start; hh <= top && blocks.length < 50; hh++) blocks.push(this.store.get(hh)!);
    if (blocks.length) this.send(from, { kind: "sync_response", blocks, tip: top });
  }

  private onSyncResponse(from: string, blocks: StoredBlock[], tip: number): void {
    if (!Array.isArray(blocks)) return;
    let applied = 0;
    for (const b of blocks) {
      if (!isPlainObject(b) || !isPlainObject(b.header) || b.header.height !== this.height() + 1) continue;
      if (this.incomingErrors(b).length) break;
      this.applyBlock(b);
      applied++;
    }
    this.syncAsked.delete(from);
    if (applied && Number.isInteger(tip) && tip > this.height()) this.requestSync(from, true);
  }

  /** Eşten gelen işlenmiş bloğun tam denetimi (imzalar + her işlemin kuralları + yineleme). */
  private incomingErrors(b: StoredBlock): string[] {
    if (!Array.isArray(b.txs)) return ["İşlem listesi yok"];
    const errs = blockErrors(b, this.height() + 1, this.lastInfo(), this.params);
    if (errs.length) return errs;
    const seen = new Set<string>();
    for (const tx of b.txs) {
      if (seen.has(tx.hash) || this.txIndex.has(tx.hash)) return ["Yinelenen işlem"];
      seen.add(tx.hash);
      const e = checkTx(tx, this.txCtx);
      if (e) return [e];
    }
    return [];
  }

  private applyBlock(b: StoredBlock): void {
    const block = structuredClone(b);
    this.store.append(block);
    this.indexBlock(block);
    if (this.corruptAt === null && this.verifiedUpTo === block.header.height - 1) this.verifiedUpTo = block.header.height;
    for (const tx of block.txs) this.mempool.delete(tx.hash);
    this.enterHeight(block.header.height + 1);
    this.broadcast({ kind: "status", height: block.header.height, hash: block.header.hash });
    this.hooks.onCommit(this, block);
  }

  // ───────────── Konsensüs ─────────────

  private rs(height: number, round: number): RoundState {
    let log = this.logs.get(height);
    if (!log) this.logs.set(height, (log = new Map()));
    let s = log.get(round);
    if (!s) log.set(round, (s = { proposal: null, prevotes: new Map(), precommits: new Map() }));
    return s;
  }

  private hasMessages(height: number, round: number): boolean {
    const s = this.logs.get(height)?.get(round);
    return !!s && (!!s.proposal || s.prevotes.size > 0 || s.precommits.size > 0);
  }

  private acceptHeightRound(from: string, height: number, round: number): boolean {
    if (!Number.isInteger(height) || !Number.isInteger(round) || round < 0 || height < this.h) return false;
    if (height > this.h + 1) {
      this.requestSync(from);
      return false;
    }
    return round <= (height === this.h ? this.round : 0) + 64;
  }

  private blockId(height: number, round: number, v: Value): string {
    return blockHash({
      height,
      round,
      prevHash: v.prevHash,
      time: v.time,
      proposer: proposerOf(height, round, this.params.ids),
      txRoot: v.txRoot,
      txCount: v.txCount,
    });
  }

  private buildValue(body: ValueBody): Value | null {
    if (!isPlainObject(body) || typeof body.prevHash !== "string" || typeof body.time !== "number" || !Number.isFinite(body.time)) return null;
    if (!Array.isArray(body.txs) || body.txs.length > this.opts.maxTxsPerBlock) return null;
    try {
      const txs: SignedTx[] = body.txs.map((tx) => {
        if (!isPlainObject(tx)) throw new Error("tx");
        return { ...tx, hash: computeTxHash(tx.type, tx.payload, tx.nonce) };
      });
      const txRoot = merkleRoot(txs.map((t) => t.hash));
      const vid = hashCanonical({ prevHash: body.prevHash, time: body.time, txRoot, txCount: txs.length });
      return { prevHash: body.prevHash, time: body.time, txs, txRoot, txCount: txs.length, vid };
    } catch {
      return null;
    }
  }

  private isValid(v: Value): boolean {
    let ok = this.validity.get(v);
    if (ok === undefined) {
      ok = this.computeValidity(v);
      this.validity.set(v, ok);
    }
    return ok;
  }

  private computeValidity(v: Value): boolean {
    const last = this.lastInfo();
    // Üst sınır önceki bloğa da bağlıdır: simüle saat geri gitse (ör. ofset kaybı) zincir durmaz.
    const horizon = Math.max(this.hooks.now(), last.time + 1) + MAX_FUTURE_MS;
    if (v.prevHash !== last.hash || !(v.time > last.time) || v.time > horizon) return false;
    if (v.txCount < 1 || v.txCount > this.opts.maxTxsPerBlock) return false;
    const seen = new Set<string>();
    for (const tx of v.txs) {
      if (seen.has(tx.hash) || this.txIndex.has(tx.hash)) return false;
      seen.add(tx.hash);
      const m = this.mempool.get(tx.hash);
      if (m && m.sig === tx.sig) continue; // havuza alınırken denetlendi
      if (checkTx(tx, this.txCtx)) return false;
    }
    return true;
  }

  private createValue(): Value | null {
    const txs: SignedTx[] = [];
    for (const tx of this.mempool.values()) {
      if (txs.length >= this.opts.maxTxsPerBlock) break;
      if (!this.txIndex.has(tx.hash)) txs.push(tx);
    }
    if (!txs.length) return null;
    const last = this.lastInfo();
    return this.buildValue({ prevHash: last.hash, time: Math.max(last.time + 1, this.hooks.now()), txs });
  }

  private onProposal(from: string, m: ProposalMsg): void {
    if (!this.acceptHeightRound(from, m.height, m.round)) return;
    if (m.proposer !== proposerOf(m.height, m.round, this.params.ids)) return;
    if (!Number.isInteger(m.polRound) || m.polRound < -1 || m.polRound >= m.round) return;
    const rs = this.rs(m.height, m.round);
    if (rs.proposal) return;
    const value = this.buildValue(m.value);
    if (!value) return;
    const bh = this.blockId(m.height, m.round, value);
    if (!verifySig(m.sig, proposalSignBytes(m.height, m.round, m.polRound, bh), this.params.validators.get(m.proposer)!)) return;
    rs.proposal = { msg: m, value, blockHash: bh };
    this.evaluate();
  }

  private onVote(from: string, v: VoteMsg): void {
    if (v.type !== "prevote" && v.type !== "precommit") return;
    const pk = this.params.validators.get(v.validator);
    if (!pk || !(v.blockHash === null || isHash(v.blockHash))) return;
    if (v.type === "precommit" && v.height === this.h - 1) {
      const prev = this.logs.get(v.height)?.get(v.round)?.precommits.get(v.validator);
      if (prev && prev.blockHash !== v.blockHash && verifySig(v.sig, voteSignBytes(v.type, v.height, v.round, v.blockHash), pk)) {
        this.reportEquivocation(prev, v);
      }
      return;
    }
    if (!this.acceptHeightRound(from, v.height, v.round)) return;
    const rs = this.rs(v.height, v.round);
    const map = v.type === "prevote" ? rs.prevotes : rs.precommits;
    const prev = map.get(v.validator);
    if (prev && prev.sig === v.sig && prev.blockHash === v.blockHash) return;
    if (!verifySig(v.sig, voteSignBytes(v.type, v.height, v.round, v.blockHash), pk)) return;
    if (prev) {
      if (v.type === "precommit" && prev.blockHash !== v.blockHash) this.reportEquivocation(prev, v);
      return;
    }
    map.set(v.validator, v);
    this.evaluate();
  }

  private reportEquivocation(a: VoteMsg, b: VoteMsg): void {
    if (this.fault === "byzantine") return;
    const last = this.lastEvidence.get(a.validator);
    if (last !== undefined && a.height - last < this.opts.evidenceCooldown) return;
    this.lastEvidence.set(a.validator, a.height);
    const payload = makeEvidence(a, b);
    this.timers.after(0, () => {
      if (this.running && this.fault !== "crash") this.hooks.onEvidence(payload);
    });
  }

  private scheduleHeightStart(delay: number): void {
    const hh = this.h;
    this.timers.after(delay, () => {
      if (!this.running || this.fault === "crash" || this.h !== hh || this.started) return;
      this.started = true;
      this.startRound(0);
      this.evaluate();
    });
  }

  private enterHeight(next: number): void {
    this.h = next;
    this.round = 0;
    this.step = "propose";
    this.started = false;
    this.waiting = false;
    this.lockedValue = this.validValue = null;
    this.lockedRound = this.validRound = -1;
    this.flags.clear();
    this.signed.clear();
    // Bir önceki yüksekliğin kaydı yalnız geç gelen çelişkili precommit'leri (çift imza) yakalamak için tutulur.
    for (const k of [...this.logs.keys()]) if (k < next - 1) this.logs.delete(k);
    this.persistState();
    this.scheduleHeightStart(this.opts.blockIntervalMs);
  }

  private startRound(r: number): void {
    this.round = r;
    this.step = "propose";
    this.waiting = false;
    for (const k of ["pv", "pc", "polka"]) this.flags.delete(`${k}:${r}`);
    this.persistState();
    // Boş blok üretilmez: havuz boşsa, kilitli/geçerli değer ve bu tura ait mesaj yoksa beklenir.
    if (this.mempool.size === 0 && !this.validValue && !this.hasMessages(this.h, r)) {
      this.waiting = true;
      return;
    }
    this.proceedRound();
  }

  private proceedRound(): void {
    const r = this.round;
    if (proposerOf(this.h, r, this.params.ids) === this.id) {
      const prev = this.signed.get(`proposal:${r}`);
      if (prev) this.broadcast(prev);
      else {
        const value = this.validValue ?? this.createValue();
        if (value) this.propose(value, this.validValue ? this.validRound : -1);
      }
    }
    this.schedule("propose", r, this.T + r * Math.ceil(this.T / 2));
  }

  private schedule(kind: Step, r: number, ms: number): void {
    const hh = this.h;
    this.timers.after(ms, () => {
      if (!this.running || this.fault === "crash" || this.h !== hh || this.round !== r) return;
      if (kind === "propose") {
        if (this.step !== "propose" || this.waiting) return;
        this.castVote("prevote", null);
        this.step = "prevote";
      } else if (kind === "prevote") {
        if (this.step !== "prevote") return;
        this.castVote("precommit", null);
        this.step = "precommit";
      } else {
        this.startRound(r + 1);
      }
      this.evaluate();
    });
  }

  private propose(value: Value, polRound: number): void {
    const h = this.h;
    const r = this.round;
    const bh = this.blockId(h, r, value);
    const msg: ProposalMsg = { kind: "proposal", height: h, round: r, polRound, proposer: this.id, value: bodyOf(value), sig: this.sign(proposalSignBytes(h, r, polRound, bh)) };
    if (this.fault === "byzantine") {
      this.proposeByzantine(value, polRound);
      this.rs(h, r).proposal = { msg, value, blockHash: bh }; // kendi kopyası; kimseye gönderilmez
      return;
    }
    this.signed.set(`proposal:${r}`, msg);
    this.rs(h, r).proposal = { msg, value, blockHash: bh };
    this.persistState();
    this.broadcast(msg);
  }

  /** Bizans öneren: her eşe FARKLI blok (çift öneri), birine de geçersiz blok (imzası tutmayan işlem) gönderir. */
  private proposeByzantine(value: Value, polRound: number): void {
    const h = this.h;
    const r = this.round;
    this.peers().forEach((peer, i) => {
      let body: ValueBody = { prevHash: value.prevHash, time: value.time + i + 1, txs: value.txs };
      if (i === 0) {
        const [first, ...rest] = value.txs;
        body = { ...body, txs: [{ ...first, payload: { ...first.payload, _bizans: true } }, ...rest] };
      }
      const v = this.buildValue(body);
      if (!v) return;
      const bh = this.blockId(h, r, v);
      this.send(peer, { kind: "proposal", height: h, round: r, polRound, proposer: this.id, value: body, sig: this.sign(proposalSignBytes(h, r, polRound, bh)) });
    });
  }

  private castVote(type: VoteType, blockHash: string | null): void {
    const h = this.h;
    const r = this.round;
    const key = `${type}:${r}`;
    // Çift imza koruması: bu (yükseklik, tur, tür) için zaten imzalandıysa AYNI oy yeniden gönderilir.
    let msg = this.signed.get(key) as VoteMsg | undefined;
    if (!msg) {
      msg = { kind: "vote", type, height: h, round: r, blockHash, validator: this.id, sig: this.sign(voteSignBytes(type, h, r, blockHash)) };
      this.signed.set(key, msg);
      this.persistState();
    }
    const rs = this.rs(h, r);
    const map = type === "prevote" ? rs.prevotes : rs.precommits;
    if (!map.has(this.id)) map.set(this.id, msg);
    this.broadcast(msg);
    if (type === "precommit" && this.fault === "byzantine") {
      // Bizans: aynı yükseklik/turda başka bir blok için de precommit imzalar (çift imza).
      const fake = hashCanonical({ bizans: this.id, height: h, round: r, blockHash });
      this.broadcast({ kind: "vote", type, height: h, round: r, blockHash: fake, validator: this.id, sig: this.sign(voteSignBytes(type, h, r, fake)) });
    }
  }

  private persistState(): void {
    if (!this.store.persistent || !this.running) return;
    const s: PersistedState = {
      height: this.h,
      round: this.round,
      lockedRound: this.lockedRound,
      lockedValue: this.lockedValue && bodyOf(this.lockedValue),
      validRound: this.validRound,
      validValue: this.validValue && bodyOf(this.validValue),
      signed: [...this.signed.values()],
    };
    this.store.setState("consensus", JSON.stringify(s));
  }

  private evaluate(): void {
    if (!this.running || this.fault === "crash") return;
    if (this.evaluating) {
      this.again = true;
      return;
    }
    this.evaluating = true;
    try {
      do {
        this.again = false;
        for (let guard = 0; guard < 1000 && this.running; guard++) if (!this.applyRules()) break;
      } while (this.again);
    } finally {
      this.evaluating = false;
    }
  }

  private count(map: Map<string, VoteMsg>, hash: string | null): number {
    let n = 0;
    for (const v of map.values()) if (v.blockHash === hash) n++;
    return n;
  }

  private findValue(r: number, hash: string): Value | null {
    const cands: Value[] = [];
    const log = this.logs.get(this.h);
    const own = log?.get(r)?.proposal;
    if (own) cands.push(own.value);
    if (log) for (const s of log.values()) if (s.proposal && s.proposal !== own) cands.push(s.proposal.value);
    if (this.lockedValue) cands.push(this.lockedValue);
    if (this.validValue) cands.push(this.validValue);
    return cands.find((v) => this.blockId(this.h, r, v) === hash && this.isValid(v)) ?? null;
  }

  private skipRound(): number {
    const log = this.logs.get(this.h);
    let best = -1;
    if (!log) return best;
    for (const [r, s] of log) {
      if (r <= this.round || r <= best) continue;
      const senders = new Set<string>([...s.prevotes.keys(), ...s.precommits.keys()]);
      if (s.proposal) senders.add(s.proposal.msg.proposer);
      if (senders.size >= this.f + 1) best = r;
    }
    return best;
  }

  private commit(v: Value, r: number, hash: string): void {
    const commitSigs = [...this.rs(this.h, r).precommits.values()]
      .filter((x) => x.blockHash === hash)
      .map((x) => ({ validator: x.validator, sig: x.sig }))
      .sort((a, b) => (a.validator < b.validator ? -1 : a.validator > b.validator ? 1 : 0));
    const header = {
      height: this.h,
      round: r,
      hash,
      prevHash: v.prevHash,
      time: v.time,
      proposer: proposerOf(this.h, r, this.params.ids),
      txRoot: v.txRoot,
      txCount: v.txCount,
      commitSigs,
    };
    this.applyBlock({ header, txs: v.txs });
  }

  /** Tendermint kurallarından biri tetiklendiyse true döner (döngü yeniden değerlendirir). */
  private applyRules(): boolean {
    const h = this.h;
    const log = this.logs.get(h);

    // Karar: herhangi bir turda öneri + 2f+1 precommit(id_r(v)).
    if (log) {
      for (const [r, s] of log) {
        if (s.precommits.size < this.q) continue;
        const counts = new Map<string, number>();
        for (const x of s.precommits.values()) if (x.blockHash) counts.set(x.blockHash, (counts.get(x.blockHash) ?? 0) + 1);
        for (const [hash, c] of counts) {
          if (c < this.q) continue;
          const v = this.findValue(r, hash);
          if (v) {
            this.commit(v, r, hash);
            return true;
          }
        }
      }
    }
    if (!this.started) return false;

    // f+1 doğrulayıcı daha yüksek bir turdaysa o tura atla.
    const skip = this.skipRound();
    if (skip > this.round) {
      this.startRound(skip);
      return true;
    }
    if (this.waiting) {
      if (this.mempool.size > 0 || this.hasMessages(h, this.round)) {
        this.waiting = false;
        this.proceedRound();
        return true;
      }
      return false;
    }

    const r = this.round;
    const s = this.rs(h, r);
    const p = s.proposal;

    if (this.step === "propose" && p) {
      const vr = p.msg.polRound;
      if (vr === -1) {
        const ok = this.isValid(p.value) && (this.lockedRound === -1 || this.lockedValue!.vid === p.value.vid);
        this.castVote("prevote", ok ? p.blockHash : null);
        this.step = "prevote";
        return true;
      }
      if (vr >= 0 && vr < r && this.count(this.rs(h, vr).prevotes, this.blockId(h, vr, p.value)) >= this.q) {
        const ok = this.isValid(p.value) && (this.lockedRound <= vr || this.lockedValue!.vid === p.value.vid);
        this.castVote("prevote", ok ? p.blockHash : null);
        this.step = "prevote";
        return true;
      }
    }

    if (this.step === "prevote" && s.prevotes.size >= this.q && !this.flags.has(`pv:${r}`)) {
      this.flags.add(`pv:${r}`);
      this.schedule("prevote", r, Math.ceil(this.T / 2) + r * Math.ceil(this.T / 2));
    }

    if (p && this.step !== "propose" && !this.flags.has(`polka:${r}`) && this.count(s.prevotes, p.blockHash) >= this.q && this.isValid(p.value)) {
      this.flags.add(`polka:${r}`);
      if (this.step === "prevote") {
        this.lockedValue = p.value;
        this.lockedRound = r;
        this.castVote("precommit", p.blockHash);
        this.step = "precommit";
      }
      this.validValue = p.value;
      this.validRound = r;
      this.persistState();
      return true;
    }

    if (this.step === "prevote" && this.count(s.prevotes, null) >= this.q) {
      this.castVote("precommit", null);
      this.step = "precommit";
      return true;
    }

    if (s.precommits.size >= this.q && !this.flags.has(`pc:${r}`)) {
      this.flags.add(`pc:${r}`);
      this.schedule("precommit", r, Math.ceil(this.T / 2) + r * Math.ceil(this.T / 2));
    }

    // 2f+1 nil precommit: bekleme süresini atlayıp sonraki tura geç (Tendermint'te precommit-wait).
    if (this.count(s.precommits, null) >= this.q) {
      this.startRound(r + 1);
      return true;
    }
    return false;
  }
}
