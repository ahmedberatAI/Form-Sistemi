// Testler için ortak yardımcılar: bellek içi bağlam, sahte defter, doğrudan kullanıcı ekleme.
// Modül testleri gerçek defter yerine FakeLedger kullanabilir (anında "commit").
import {
  blockHash,
  hashCanonical,
  merkleProof,
  merkleRoot,
  type BlockView,
  type ChainVerification,
  type InclusionProof,
  type LedgerStatus,
  type LedgerTxType,
  type Role,
} from "@forum/shared";
import { ManualClock } from "../../src/core/clock";
import { testConfig, type Config } from "../../src/core/config";
import type { CommittedTx, CoreContext, LedgerService } from "../../src/core/contracts";
import { openMemoryDb, type Db } from "../../src/db";
import { newId } from "../../src/core/ids";

export interface TestCtx extends CoreContext {
  clock: ManualClock;
}

export function makeCtx(overrides: Partial<Config> = {}): TestCtx {
  return { config: testConfig(overrides), db: openMemoryDb(), clock: new ManualClock() };
}

/** Kimlik modülünü atlayarak doğrudan `users` satırı ekler (yalnız testler). */
export function insertUser(
  db: Db,
  u: {
    id?: string;
    nickname: string;
    roles?: Role[];
    status?: "pending" | "verified" | "suspended" | "rejected" | "erased";
    isAdult?: boolean;
    politicalConsent?: boolean;
    aiConsent?: boolean;
    createdAt?: number;
    verifiedAt?: number | null;
  },
): string {
  const id = u.id ?? newId();
  const created = u.createdAt ?? Date.UTC(2026, 0, 1);
  db.run(
    `INSERT INTO users(id, nickname, nickname_norm, password_hash, roles, status, is_adult, political_consent, ai_consent, created_at, verified_at)
     VALUES (?, ?, ?, 'x', ?, ?, ?, ?, ?, ?, ?)`,
    id,
    u.nickname,
    u.nickname.toLocaleLowerCase("tr-TR"),
    JSON.stringify(u.roles ?? ["member"]),
    u.status ?? "verified",
    u.isAdult === false ? 0 : 1,
    u.politicalConsent === false ? 0 : 1,
    u.aiConsent ? 1 : 0,
    created,
    u.verifiedAt === undefined ? created : u.verifiedAt,
  );
  return id;
}

/**
 * Sahte defter: her submit anında tek işlemli bir "blok" oluşturur. İmza/konsensüs yoktur.
 * findTxs, getTx, latestBlock, proof (imzasız) çalışır — modül testleri için yeterlidir.
 */
export class FakeLedger implements LedgerService {
  readonly appPublicKey = "00".repeat(32);
  readonly txs: CommittedTx[] = [];
  private byHash = new Map<string, CommittedTx>();
  private prev = "0".repeat(64);
  constructor(private readonly clock: { now(): number } = { now: () => Date.UTC(2026, 9, 1) }) {}

  async start(): Promise<void> {}
  async stop(): Promise<void> {}

  submit(type: LedgerTxType, payload: Record<string, unknown>): { txHash: string } {
    const nonce = hashCanonical({ type, payload }).slice(0, 32);
    const hash = hashCanonical({ type, payload, nonce });
    if (this.byHash.has(hash)) return { txHash: hash };
    const height = this.txs.length + 1;
    const time = this.clock.now();
    const txRoot = merkleRoot([hash]);
    const bh = blockHash({ height, round: 0, prevHash: this.prev, time, proposer: "fake", txRoot, txCount: 1 });
    this.prev = bh;
    const tx: CommittedTx = { type, payload, nonce, submittedAt: time, sig: "", hash, height, index: 0, blockHash: bh, blockTime: time };
    this.txs.push(tx);
    this.byHash.set(hash, tx);
    return { txHash: hash };
  }
  async submitAndWait(type: LedgerTxType, payload: Record<string, unknown>): Promise<CommittedTx> {
    const { txHash } = this.submit(type, payload);
    return this.byHash.get(txHash)!;
  }
  async flush(): Promise<void> {}
  getTx(txHash: string): CommittedTx | null {
    return this.byHash.get(txHash) ?? null;
  }
  findTxs(filter: { type?: LedgerTxType; proposalId?: string; limit?: number }): CommittedTx[] {
    let out = this.txs.filter((t) => (!filter.type || t.type === filter.type) && (!filter.proposalId || t.payload.proposalId === filter.proposalId));
    out = out.slice().reverse();
    return filter.limit ? out.slice(0, filter.limit) : out;
  }
  getBlock(height: number): BlockView | null {
    const t = this.txs[height - 1];
    if (!t) return null;
    return {
      height,
      round: 0,
      hash: t.blockHash,
      prevHash: height === 1 ? "0".repeat(64) : this.txs[height - 2].blockHash,
      time: t.blockTime,
      proposer: "fake",
      txRoot: merkleRoot([t.hash]),
      txCount: 1,
      commitSigs: [],
      txs: [{ ...t }],
    };
  }
  listBlocks(opts: { from?: number; limit?: number }): BlockView[] {
    const out: BlockView[] = [];
    const from = opts.from ?? this.txs.length;
    for (let h = from; h >= 1 && out.length < (opts.limit ?? 20); h--) out.push(this.getBlock(h)!);
    return out;
  }
  latestBlock(): { height: number; hash: string; time: number } {
    const t = this.txs[this.txs.length - 1];
    return t ? { height: t.height, hash: t.blockHash, time: t.blockTime } : { height: 0, hash: "0".repeat(64), time: 0 };
  }
  proof(txHash: string): InclusionProof | null {
    const t = this.byHash.get(txHash);
    if (!t) return null;
    const b = this.getBlock(t.height)!;
    return {
      txHash,
      height: t.height,
      index: 0,
      leafHash: "",
      path: merkleProof([txHash], 0),
      txRoot: b.txRoot,
      header: { ...b, txs: undefined } as never,
      validators: [],
    };
  }
  status(): LedgerStatus {
    return { mode: "in-process", validators: [], height: this.txs.length, mempool: 0, quorum: 1, faultTolerance: 0, sameMachineNotice: true };
  }
  verifyChain(): ChainVerification[] {
    return [{ nodeId: "fake", ok: true, checkedBlocks: this.txs.length, errors: [] }];
  }
  tamper(): void {}
  async repair(nodeId: string): Promise<ChainVerification> {
    return { nodeId, ok: true, checkedBlocks: this.txs.length, errors: [] };
  }
  setFault(): void {}
}
