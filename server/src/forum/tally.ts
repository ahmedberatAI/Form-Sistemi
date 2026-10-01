// Sayım (ALGORITMA.md §4–§6): etkin oylar → decide() → BALLOT_REVEAL + TALLY. Oy anahtarı = ballotId, böylece
// herkes defterdeki bültenden verifyTally ile AYNI inputsHash'i yeniden üretir.
import {
  decide,
  delegationCap,
  evaluateObjection,
  revealHash,
  sortReveals,
  type BulletinRound,
  type DecisionInput,
  type DecisionParams,
  type DecisionResult,
  type EffectiveVote,
  type ObjectionEvaluation,
  type RevealEntry,
  type TallyPayload,
  type VoteChoice,
} from "@forum/shared";
import { json } from "../db";
import type { ClusterServiceImpl } from "./clusters";
import { parseProposal, type BallotRow, type ForumCore, type ProposalRow, type TallyRow } from "./util";

const cmp = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/** Kapsam sırası: önerinin kategorileri + tüm üst sınıfları, derinlik ↓ (en özelden genele), eşitlikte IRI ↑, sonra "*". */
export function scopeOrderFor(core: ForumCore, categories: string[]): string[] {
  const o = core.deps.ontology;
  const all = new Set<string>();
  for (const c of categories) {
    all.add(c);
    try {
      for (const a of o.ancestors(c)) all.add(a);
    } catch {
      // bilinmeyen kategori: yalnız kendisi
    }
  }
  all.delete("*");
  const depth = new Map<string, number>();
  for (const c of all) {
    let d = 0;
    try {
      d = o.depth(c);
    } catch {
      d = 0;
    }
    depth.set(c, Number.isFinite(d) ? d : 0);
  }
  return [...all].sort((a, b) => depth.get(b)! - depth.get(a)! || cmp(a, b)).concat("*");
}

export interface RoundComputation {
  round: 1 | 2;
  input: DecisionInput;
  result: DecisionResult;
  reveals: RevealEntry[];
  payload: TallyPayload;
  unrouted: string[];
  /** delegatör → oyu uygulanan delege (governance.resolveEffectiveVotes().delegateOf); tallies.delegation_trace'e yazılır. */
  trace: Record<string, string>;
  directVoters: string[];
  eligible: string[];
}

/** Bir oylama turunun sayımını hesaplar (yan etkisiz). */
export function computeRound(core: ForumCore, clusters: ClusterServiceImpl, p: ProposalRow, now: number): RoundComputation {
  const round = (p.voting_round === 2 ? 2 : 1) as 1 | 2;
  const parsed = parseProposal(p);
  const params = parsed.fixedParams;
  if (!params) throw new Error(`Öneri ${p.id}: sabitlenmiş parametre yok`);
  const eligible = core.db.all<{ user_id: string }>("SELECT user_id FROM eligible_voters WHERE proposal_id = ? ORDER BY user_id", p.id).map((r) => r.user_id);
  const ballots = core.db.all<BallotRow>("SELECT * FROM ballots WHERE proposal_id = ? AND round = ? ORDER BY user_id", p.id, round);
  const eligibleSet = new Set(eligible);
  const byUser = new Map(ballots.filter((b) => eligibleSet.has(b.user_id)).map((b) => [b.user_id, b] as const));
  const direct = new Map<string, VoteChoice>([...byUser].map(([u, b]) => [u, b.choice]));

  const snap = p.cluster_snapshot_id ? clusters.data(p.cluster_snapshot_id) : null;
  const assignments = snap?.assignments ?? {};
  const clusterOf = (u: string): string | null => assignments[u] ?? null;
  const scopeOrder = scopeOrderFor(core, parsed.categories);
  const delegations = core.deps.graph.delegations();
  const resolved = core.deps.math.resolveEffectiveVotes({
    eligible,
    direct,
    delegations,
    scopeOrder,
    cap: delegationCap(eligible.length, params.delegationCapFraction),
    maxHops: params.delegationMaxHops,
    clusterOf,
  });

  const reveals = sortReveals(
    resolved.votes.map((v): RevealEntry => {
      if (v.via === "direct") {
        const b = byUser.get(v.voterKey);
        if (!b) throw new Error(`Doğrudan oyun pusulası yok: ${v.voterKey}`);
        return { ballotId: b.ballot_id, choice: b.choice, salt: b.salt, clusterId: v.clusterId ?? null, via: "direct" };
      }
      return { ballotId: core.ballotId(v.voterKey, p.id, round), choice: v.choice, salt: "", clusterId: v.clusterId ?? null, via: "delegated" };
    }),
  );
  const votes: EffectiveVote[] = reveals.map((r) => ({ voterKey: r.ballotId, choice: r.choice, via: r.via, clusterId: r.clusterId }));
  let authorClusterId: string | null = null;
  if (p.kind === "deletion") {
    const target = deletionTargetAuthor(core, p);
    authorClusterId = target ? clusterOf(target) : null;
  }
  const revote = round === 2 ? { origin: p.reconciliation_origin ?? "contested", strongObjection: p.strong_objection === 1 } : null;
  const input: DecisionInput = {
    params,
    round,
    eligibleCount: eligible.length,
    votes,
    clusterSizes: snap?.sizes ?? {},
    clusteredTotal: snap?.clusteredTotal ?? 0,
    k: snap?.k ?? 1,
    extensionAvailable: p.extension_used === 0,
    authorClusterId,
    revote,
    unrouted: resolved.unrouted.length,
    now,
  };
  const result = decide(input);
  const payload: TallyPayload = {
    proposalId: p.id,
    round,
    algoVersion: result.algoVersion,
    params,
    eligibleCount: input.eligibleCount,
    clusterSizes: input.clusterSizes,
    clusteredTotal: input.clusteredTotal,
    k: input.k,
    extensionAvailable: input.extensionAvailable,
    authorClusterId,
    revote,
    unrouted: input.unrouted ?? 0,
    clusterSnapshotHash: snap?.outputHash ?? "",
    revealHash: revealHash(reveals),
    outcome: result.outcome,
    totals: result.totals,
    inputsHash: result.inputsHash,
    computedAt: now,
  };
  // Vekâlet izi (myEffectiveVia için; yalnız sunucuda): sayımı yapan aramanın kendi çıktısı — ayrı bir kopya yok.
  return { round, input, result, reveals, payload, unrouted: resolved.unrouted, trace: { ...resolved.delegateOf }, directVoters: [...direct.keys()], eligible };
}

/** Silme talebinin hedef mesaj yazarı (tüm hedefler aynı yazara aittir). */
export function deletionTargetAuthor(core: ForumCore, p: ProposalRow): string | null {
  const ids = json<{ messageIds?: string[] }>(p.deletion_payload, {}).messageIds ?? [];
  if (ids.length === 0) return null;
  return core.db.get<{ author_id: string }>("SELECT author_id FROM messages WHERE id = ?", ids[0])?.author_id ?? null;
}

// ───────────── Kesin tur sonuçları ─────────────

export function finalTallies(core: ForumCore, proposalId: string): TallyRow[] {
  return core.db.all<TallyRow>("SELECT * FROM tallies WHERE proposal_id = ? AND interim = 0 ORDER BY round ASC, created_at ASC, rowid ASC", proposalId);
}

export function finalTally(core: ForumCore, proposalId: string, round: number): TallyRow | undefined {
  return core.db.get<TallyRow>(
    "SELECT * FROM tallies WHERE proposal_id = ? AND round = ? AND interim = 0 ORDER BY created_at DESC, rowid DESC LIMIT 1",
    proposalId,
    round,
  );
}

/** Kişinin tur-1 ETKİN oyu (BALLOT_REVEAL'deki kendi ballotId'si; vekâletle gelen dahil). */
export function firstRoundChoice(core: ForumCore, p: Pick<ProposalRow, "id">, userId: string, reveals?: RevealEntry[]): VoteChoice | null {
  const list = reveals ?? json<RevealEntry[]>(finalTally(core, p.id, 1)?.reveal_payload ?? null, []);
  const bid = core.ballotId(userId, p.id, 1);
  return list.find((r) => r.ballotId === bid)?.choice ?? null;
}

/** §6 itiraz geçerliliği (tur-1 açıklamasından; imzacı anahtarı = tur-1 ballotId). */
export function evaluateObjections(core: ForumCore, clusters: ClusterServiceImpl, p: ProposalRow): ObjectionEvaluation | null {
  const t1 = finalTally(core, p.id, 1);
  const params = json<DecisionParams | null>(p.params, null);
  if (!t1 || !params) return null;
  const reveals = json<RevealEntry[]>(t1.reveal_payload, []);
  const snap = p.cluster_snapshot_id ? clusters.data(p.cluster_snapshot_id) : null;
  const signatures = core.db
    .all<{ user_id: string; cluster_id: string | null }>("SELECT user_id, cluster_id FROM objections WHERE proposal_id = ? ORDER BY at, id", p.id)
    .map((o) => ({ voterKey: core.ballotId(o.user_id, p.id, 1), clusterId: o.cluster_id }));
  return evaluateObjection({
    eligibleCount: Number(p.eligible_count ?? json<TallyPayload | null>(t1.tally_payload, null)?.eligibleCount ?? 0),
    firstRoundVotes: reveals.map((r) => ({ voterKey: r.ballotId, choice: r.choice, via: r.via, clusterId: r.clusterId })),
    signatures,
    clusterSizes: snap?.sizes ?? {},
    clusteredTotal: snap?.clusteredTotal ?? 0,
    params,
  });
}

// ───────────── Bülten ─────────────

export function bulletinRounds(core: ForumCore, proposalId: string): BulletinRound[] {
  const tallies = finalTallies(core, proposalId);
  if (tallies.length === 0) return [];
  const commits = core.deps.ledger
    .findTxs({ type: "VOTE_COMMIT", proposalId, limit: 1_000_000 })
    .filter((t) => t.type === "VOTE_COMMIT" && t.payload.proposalId === proposalId)
    .sort((a, b) => a.height - b.height || a.index - b.index);
  return tallies.map((t) => {
    const round = Number(t.round) as 1 | 2;
    const commitTxs: BulletinRound["commitTxs"] = [];
    const commitments: Record<string, string> = {};
    for (const c of commits) {
      if (Number(c.payload.round) !== round) continue;
      const ballotId = String(c.payload.ballotId);
      const commitment = String(c.payload.commitment);
      commitTxs.push({ ballotId, txHash: c.hash, commitment });
      commitments[ballotId] = commitment; // yükseklik/indeks sırasıyla: son taahhüt kazanır
    }
    return {
      round,
      tally: json<TallyPayload>(t.tally_payload, null as unknown as TallyPayload),
      tallyTx: t.ledger_tx,
      reveals: json<RevealEntry[]>(t.reveal_payload, []),
      revealTx: t.reveal_ledger_tx,
      commitments,
      commitTxs,
    };
  });
}
