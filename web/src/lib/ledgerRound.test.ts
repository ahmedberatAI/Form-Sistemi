// Tarayıcıdaki sayım doğrulaması (loadRoundFromLedger, shared verifyTally):
//  • İstek bütçesi: taahhütler blok blok doğrulanır (N taahhüt → 1 liste + blok sayısı kadar istek; işlem başına 2 istek değil).
//  • Hız sınırı (429), ağ ve 5xx GEÇİCİDİR: Retry-After kadar beklenip yeniden denenir; yine alınamazsa "unavailable" (sonuç
//    alınamadı) olur — kurcalama anlamına gelen uyuşmazlık (commitProblems) ASLA üretilmez, eksik haritayla sayım yapılmaz.
//  • Sıkı sayım (artık shared verifyTally'de; sunucu/tohum da aynı denetimi yapar): taahhüdü olan pusulanın "delegated"
//    açıklanması ve |E|'yi aşan açıklama uyuşmazlıktır.
import {
  ALGO_VERSION,
  blockHash,
  decide,
  decisionInputFromTally,
  ed25519PublicKey,
  ed25519RandomSecretKey,
  ed25519Sign,
  ledgerTxHash,
  merkleRoot,
  precommitSignBytes,
  revealHash,
  verifyTally,
  voteCommitment,
  type BlockView,
  type BulletinRound,
  type CommittedTxView,
  type DecisionParams,
  type RevealEntry,
  type TallyPayload,
  type VoteChoice,
} from "@forum/shared";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../api/client";
import * as ep from "../api/endpoints";
import { checkFetchedBlock, isTransientError, LedgerFetcher, loadBoundTx, loadRoundFromLedger } from "./ledgerVerify";
import type { PinnedValidators } from "./validators";

vi.mock("../api/endpoints", () => ({ getTx: vi.fn(), getProof: vi.fn(), getBlock: vi.fn(), listTxs: vi.fn() }));
const api = vi.mocked(ep);

const validators = Array.from({ length: 4 }, (_, i) => {
  const secret = ed25519RandomSecretKey();
  return { id: `d${i + 1}`, secret, publicKey: ed25519PublicKey(secret) };
});
const pinned: PinnedValidators = {
  chainId: "test",
  validators: validators.map(({ id, publicKey }) => ({ id, publicKey })),
  pinnedAt: 0,
  serverUrl: "",
};

const PROPOSAL = "p-1";

interface Commit {
  ballotId: string;
  commitment: string;
  tx: { type: "VOTE_COMMIT"; payload: Record<string, unknown>; nonce: string };
  hash: string;
}

function commit(i: number, choice: VoteChoice = "yes"): Commit {
  const ballotId = `ballot-${i}`;
  const commitment = voteCommitment(PROPOSAL, 1, ballotId, choice, `tuz-${i}`);
  const tx = { type: "VOTE_COMMIT" as const, payload: { proposalId: PROPOSAL, round: 1, ballotId, commitment }, nonce: `n-${i}` };
  return { ballotId, commitment, tx, hash: ledgerTxHash(tx) };
}

function block(height: number, commits: Commit[], signers = 3): BlockView {
  const hashes = commits.map((c) => c.hash);
  const head = { height, round: 0, prevHash: "ab".repeat(32), time: 1_700_000_000_000 + height, proposer: "d1", txRoot: merkleRoot(hashes), txCount: hashes.length };
  const hash = blockHash(head);
  const msg = precommitSignBytes(height, 0, hash);
  return {
    ...head,
    hash,
    commitSigs: validators.slice(0, signers).map((v) => ({ validator: v.id, sig: ed25519Sign(msg, v.secret) })),
    txs: commits.map((c, index) => ({ ...c.tx, submittedAt: 0, sig: "00", hash: c.hash, height, index })),
  };
}

/** n taahhüt, her blokta `per` tane; yükseklikler 10'dan başlar. */
function chain(n: number, per: number) {
  const commits = Array.from({ length: n }, (_, i) => commit(i));
  const blocks = new Map<number, BlockView>();
  const heightOf = new Map<string, number>();
  for (let i = 0; i < n; i += per) {
    const h = 10 + i / per;
    const part = commits.slice(i, i + per);
    blocks.set(h, block(h, part));
    for (const c of part) heightOf.set(c.hash, h);
  }
  const bulletin: BulletinRound = {
    round: 1,
    tally: {} as TallyPayload,
    tallyTx: null,
    reveals: [],
    revealTx: null,
    commitments: Object.fromEntries(commits.map((c) => [c.ballotId, c.commitment])),
    commitTxs: commits.map((c) => ({ ballotId: c.ballotId, txHash: c.hash, commitment: c.commitment })),
  };
  const view = (c: Commit): CommittedTxView => {
    const h = heightOf.get(c.hash)!;
    const b = blocks.get(h)!;
    const index = b.txs.findIndex((t) => t.hash === c.hash);
    return { ...c.tx, submittedAt: 0, sig: "00", hash: c.hash, height: h, index, blockHash: b.hash, blockTime: b.time };
  };
  return { commits, blocks, heightOf, bulletin, view };
}

const rateLimited = (sec = 2) => new ApiError(429, "rate_limited", `Çok fazla istek gönderdiniz. Lütfen ${sec} saniye sonra tekrar deneyin.`, { retryAfterSeconds: sec });

/** Testte gerçek bekleme yok: saat sleep ile ilerler. */
function fakeClock() {
  let t = 1_000_000;
  const slept: number[] = [];
  return {
    now: () => t,
    sleep: async (ms: number) => {
      slept.push(ms);
      t += ms;
    },
    slept,
  };
}

beforeEach(() => {
  vi.resetAllMocks();
});

describe("loadRoundFromLedger: istek bütçesi (blok blok doğrulama)", () => {
  it("200 taahhüt / 4 blok: 1 liste + 4 blok isteği; hepsi doğrulanır, harita bültenle aynı", async () => {
    const c = chain(200, 50);
    api.listTxs.mockResolvedValue(c.commits.map(c.view));
    api.getBlock.mockImplementation(async (h: number) => c.blocks.get(h)!);
    const L = await loadRoundFromLedger(PROPOSAL, c.bulletin, pinned);
    expect(L.commitProblems).toEqual([]);
    expect(L.complete).toBe(true);
    expect(L.commitsChecked).toBe(200);
    expect(L.bulletinCommitmentsMatch).toBe(true);
    expect(L.commitments).toEqual(c.bulletin.commitments);
    expect(api.getBlock).toHaveBeenCalledTimes(4);
    expect(api.getTx).not.toHaveBeenCalled();
    expect(api.getProof).not.toHaveBeenCalled();
    expect(L.requests).toBe(5); // önceki yükleyici 2 × 200 = 400 istek gönderiyordu (300/dk sınırını aşar)
  });

  it("liste ipucu yoksa (ör. 500'den eski taahhüt) işlemin yeri işlemden öğrenilir; her blok YALNIZ BİR KEZ indirilir", async () => {
    const c = chain(120, 40);
    api.listTxs.mockResolvedValue([]);
    api.getTx.mockImplementation(async (h: string) => c.view(c.commits.find((x) => x.hash === h)!));
    api.getBlock.mockImplementation(async (h: number) => c.blocks.get(h)!);
    const L = await loadRoundFromLedger(PROPOSAL, c.bulletin, pinned);
    expect(L.complete).toBe(true);
    expect(L.commitsChecked).toBe(120);
    expect(L.bulletinCommitmentsMatch).toBe(true);
    expect(api.getBlock).toHaveBeenCalledTimes(3);
    expect(api.getProof).not.toHaveBeenCalled();
    // Doğrulanmış blokta görülen taahhüt için işlem ayrıca sorulmaz (120 değil, yalnız her bloğun ilk birkaç işlemi)
    expect(api.getTx.mock.calls.length).toBeLessThan(20);
  });

  it("yanlış ipucu (işlem o blokta yok): işlemin kendisi sorulur, doğru blokla doğrulanır", async () => {
    const c = chain(4, 2); // bloklar 10 ve 11
    api.listTxs.mockResolvedValue(c.commits.map((x) => ({ ...c.view(x), height: 10 })));
    api.getTx.mockImplementation(async (h: string) => c.view(c.commits.find((x) => x.hash === h)!));
    api.getBlock.mockImplementation(async (h: number) => c.blocks.get(h)!);
    const L = await loadRoundFromLedger(PROPOSAL, c.bulletin, pinned);
    expect(L.commitProblems).toEqual([]);
    expect(L.commitsChecked).toBe(4);
    expect(api.getTx).toHaveBeenCalledTimes(2); // yalnız 11. bloktaki iki işlem
  });

  it("kurcalanmış blok (içerik değişmiş) gerçek uyuşmazlıktır: commitProblems dolar", async () => {
    const c = chain(4, 4);
    const bad = c.blocks.get(10)!;
    const tampered: BlockView = { ...bad, txs: bad.txs.map((t, i) => (i === 0 ? { ...t, payload: { ...t.payload, commitment: "00".repeat(32) } } : t)) };
    api.listTxs.mockResolvedValue(c.commits.map(c.view));
    api.getBlock.mockResolvedValue(tampered);
    const L = await loadRoundFromLedger(PROPOSAL, c.bulletin, pinned);
    expect(L.commitProblems.length).toBe(4);
    expect(L.commitProblems[0]).toContain("doğrulanamadı");
    expect(L.complete).toBe(true); // geçici hata değil: kesin sonuç (BAŞARISIZ)
  });

  it("imzası eksik blok (2f+1'den az) kabul edilmez", () => {
    const c = chain(2, 2);
    const weak = block(10, c.commits, 2);
    const r = checkFetchedBlock(10, weak, pinned);
    expect(r.state).toBe("fail");
    expect(checkFetchedBlock(10, c.blocks.get(10)!, pinned).state).toBe("ok");
    expect(checkFetchedBlock(11, c.blocks.get(10)!, pinned).state).toBe("fail"); // istenen yükseklik değil
  });
});

describe("loadRoundFromLedger: hız sınırı ve geçici hatalar kurcalama sayılmaz", () => {
  it("429 alınınca Retry-After kadar beklenir ve yeniden denenir: sonuç ✔", async () => {
    const c = chain(30, 10);
    const clock = fakeClock();
    api.listTxs.mockResolvedValue(c.commits.map(c.view));
    let first = true;
    api.getBlock.mockImplementation(async (h: number) => {
      if (first) {
        first = false;
        throw rateLimited(7);
      }
      return c.blocks.get(h)!;
    });
    const L = await loadRoundFromLedger(PROPOSAL, c.bulletin, pinned, { now: clock.now, sleep: clock.sleep });
    expect(L.complete).toBe(true);
    expect(L.commitProblems).toEqual([]);
    expect(L.bulletinCommitmentsMatch).toBe(true);
    expect(clock.slept[0]).toBe(7000);
  });

  it("hız sınırı sürerse: 'unavailable' — commitProblems BOŞ, eksik harita bültenle karşılaştırılmaz, sayım yapılmamalı (complete=false)", async () => {
    const c = chain(160, 1); // her taahhüt ayrı blokta (en kötü durum)
    const clock = fakeClock();
    api.listTxs.mockResolvedValue(c.commits.map(c.view));
    let served = 0;
    api.getBlock.mockImplementation(async (h: number) => {
      if (++served > 100) throw rateLimited(59);
      return c.blocks.get(h)!;
    });
    const L = await loadRoundFromLedger(PROPOSAL, c.bulletin, pinned, { now: clock.now, sleep: clock.sleep, maxTotalMs: 60_000 });
    expect(L.commitProblems).toEqual([]);
    expect(L.commitsUnavailable).toBeGreaterThan(0);
    expect(L.complete).toBe(false);
    expect(L.bulletinCommitmentsMatch).toBe(false);
    expect(L.unavailableReason).toMatch(/hız sınırı/);
  });

  it("TALLY/BALLOT_REVEAL işlemi 429/503/ağ hatasında 'unavailable', 404'te 'pending', 400'de 'fail'", async () => {
    const f = () => new LedgerFetcher({ maxRetries: 0 });
    for (const e of [rateLimited(), new ApiError(503, "unreachable", "x"), new ApiError(0, "network", "x")]) {
      api.getTx.mockRejectedValue(e);
      api.getProof.mockRejectedValue(e);
      expect((await loadBoundTx("ab", pinned, "TALLY", f())).state, `HTTP ${e.status}`).toBe("unavailable");
      expect(isTransientError(e)).toBe(true);
    }
    api.getTx.mockRejectedValue(new ApiError(404, "not_found", "yok"));
    expect((await loadBoundTx("ab", pinned, "TALLY", f())).state).toBe("pending");
    api.getTx.mockRejectedValue(new ApiError(400, "validation", "geçersiz"));
    expect((await loadBoundTx("ab", pinned, "TALLY", f())).state).toBe("fail");
  });

  it("bir 429 bütün işçileri bekletir (sınır zorlanmaya devam etmez)", async () => {
    const clock = fakeClock();
    const fetcher = new LedgerFetcher({ now: clock.now, sleep: clock.sleep });
    let calls = 0;
    const fn = async () => {
      calls++;
      if (calls === 1) throw rateLimited(3);
      return calls;
    };
    await Promise.all([fetcher.call(fn), fetcher.call(fn), fetcher.call(fn)]);
    expect(clock.slept.length).toBeGreaterThan(0);
    expect(clock.slept.every((ms) => ms <= 3000)).toBe(true);
  });
});

// ───────────── Sıkı sayım: via etiketi ve |E| ─────────────

const T0: DecisionParams = {
  tier: "T0",
  quorum: { num: 1, den: 5 },
  threshold: { num: 1, den: 2 },
  thresholdStrict: true,
  clusterFloor: { num: 3, den: 10 },
  authorClusterFloor: null,
  overrideThreshold: { num: 2, den: 3 },
  revoteThreshold: { num: 3, den: 5 },
  significantShare: { num: 1, den: 10 },
  significantMinMembers: 3,
  minVotesPerCluster: 2,
  minClusteredForBridge: 12,
  coldStartBump: { num: 1, den: 10 },
  delegationCapFraction: { num: 1, den: 20 },
  delegationMaxHops: 3,
  sponsorsRequired: 2,
  requiresExpert: false,
  expertCount: 3,
  expertDomains: [],
  durationsHours: { sponsoring: 168, deliberation: 72, voting: 72, extension: 24, objection: 48, reconciliation: 72 },
};

/** Açıklamalardan tutarlı bir TALLY yükü (revealHash, sonuç, toplamlar, inputsHash) kurar — kötü niyetli sunucunun yapacağı gibi. */
function publish(reveals: RevealEntry[]): TallyPayload {
  const base: TallyPayload = {
    proposalId: "p1",
    round: 1,
    algoVersion: ALGO_VERSION,
    params: T0,
    eligibleCount: 5,
    clusterSizes: {},
    clusteredTotal: 0,
    k: 1,
    extensionAvailable: false,
    authorClusterId: null,
    revote: null,
    unrouted: 0,
    clusterSnapshotHash: "snap",
    revealHash: revealHash(reveals),
    outcome: "reject",
    totals: { eligible: 5, participants: 0, yes: 0, no: 0, abstain: 0, delegated: 0, unrouted: 0 },
    inputsHash: "",
    computedAt: Date.UTC(2026, 9, 1),
  };
  const r = decide(decisionInputFromTally(base, reveals));
  return { ...base, outcome: r.outcome, totals: r.totals, inputsHash: r.inputsHash };
}

describe("verifyTally (tarayıcıda): taahhüt denetimi via etiketiyle atlatılamaz", () => {
  const honest: RevealEntry[] = (["no", "no", "no", "yes", "yes"] as VoteChoice[]).map((choice, i) => ({
    ballotId: `b${i + 1}`,
    choice,
    salt: `s${i + 1}`,
    clusterId: null,
    via: "direct",
  }));
  const commitments = Object.fromEntries(honest.map((r) => [r.ballotId, voteCommitment("p1", 1, r.ballotId, r.choice, r.salt)]));

  it("dürüst bülten ✔ (sonuç red)", () => {
    const tally = publish(honest);
    const v = verifyTally(tally, honest, commitments);
    expect(tally.outcome).toBe("reject");
    expect(v.mismatches).toEqual([]);
    expect(v.ok).toBe(true);
  });

  it("taahhüdü olan b1 ve b2 'vekâletle Kabul' açıklanınca sonuç kabule döner ama doğrulama ✘", () => {
    const forged = honest.map((r) => (r.ballotId === "b1" || r.ballotId === "b2" ? { ...r, choice: "yes" as const, salt: "", via: "delegated" as const } : r));
    const tally = publish(forged);
    expect(tally.outcome).toBe("accept"); // sahte bülten kendi içinde tutarlı
    const v = verifyTally(tally, forged, commitments);
    expect(v.ok).toBe(false);
    expect(v.mismatches.filter((m) => m.includes("vekâletle açıklanmış"))).toHaveLength(2);
  });

  it("taahhütsüz 4 hayali 'vekâlet' pusulası: katılım 9 > |E| 5 → ✘", () => {
    const phantom = [
      ...honest,
      ...[1, 2, 3, 4].map((i): RevealEntry => ({ ballotId: `ph${i}`, choice: "yes", salt: "", clusterId: null, via: "delegated" })),
    ];
    const tally = publish(phantom);
    expect(tally.totals.participants).toBe(9);
    const v = verifyTally(tally, phantom, commitments);
    expect(v.ok).toBe(false);
    expect(v.mismatches.join(" ")).toContain("uygun seçmen sayısını (5) aşıyor");
  });

  it("gerçek vekâlet oyu (taahhüdü yok, |E| içinde) uyuşmazlık değildir", () => {
    const four = honest.slice(0, 4);
    const withDelegated = [...four, { ballotId: "b5", choice: "yes" as const, salt: "", clusterId: null, via: "delegated" as const }];
    const fourCommitments = Object.fromEntries(four.map((r) => [r.ballotId, commitments[r.ballotId]]));
    const tally = publish(withDelegated);
    expect(verifyTally(tally, withDelegated, fourCommitments).ok).toBe(true);
  });
});
