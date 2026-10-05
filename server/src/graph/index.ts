// İnsanlar grafı: takip, kefalet, yakınlık (çıkar çatışması), vekâlet (likit demokrasi) ve graf analizleri.
// Kalıcılık graph_edges tablosundadır (kenarlar silinmez, revoked_at doldurulur); bellek içi graphology grafı
// yalnızca aktif kenarları tutar ve her yazımda güncellenir. Ağır hesaplar sürüm sayacına bağlı önbellektedir.
import { createHmac } from "node:crypto";
import { DirectedGraph, MultiDirectedGraph, UndirectedGraph } from "graphology";
import louvain from "graphology-communities-louvain";
import pagerankMetric from "graphology-metrics/centrality/pagerank.js";
import betweennessMetric from "graphology-metrics/centrality/betweenness.js";
import {
  createRng,
  expandIri,
  hashCanonical,
  type DecisionResult,
  type DelegationView,
  type EdgeType,
  type GraphEdgeView,
  type GraphStats,
  type GraphVisEdge,
  type GraphVisNode,
} from "@forum/shared";
import type { ConflictCheck, CoreContext, DelegationEdge, GraphService, LedgerService, NewEdge } from "../core/contracts";
import { badRequest, conflict, forbidden, notFound, unprocessable } from "../core/errors";
import { newId } from "../core/ids";
import { json } from "../db";
import { agreementPairs, canonicalCommunities, classifySybil, gini, kCoreComponents, round6, SYBIL_PARAMS, type VoteRow } from "./analytics";

export const EDGE_TYPES: readonly EdgeType[] = [
  "FOLLOWS",
  "VOUCHES",
  "DELEGATES_TO",
  "RELATED_TO",
  "REPLIED_TO",
  "ENDORSED",
  "AUTHORED",
  "EXPERT_IN",
  "AGREES",
];

export const VOUCH_WEIGHTS = { close: 1.0, known: 0.7, just_met: 0.3, suspicious: -1 } as const;
export type VouchLevel = keyof typeof VOUCH_WEIGHTS;
const RELATION_KINDS = ["family", "business", "household"] as const;
const RELATION_LABELS: Record<string, string> = { family: "aile", business: "iş", household: "hane" };

/** Yumuşak çıkar çatışması ve aracılık hesaplarında kullanılan sosyal kenarlar. */
const SOCIAL_TYPES: ReadonlySet<EdgeType> = new Set(["FOLLOWS", "DELEGATES_TO", "VOUCHES"]);
const DEFAULT_VIS_TYPES: EdgeType[] = ["FOLLOWS", "VOUCHES", "DELEGATES_TO"];
/** Görselleştirmede herkese açık kenar tipleri (RELATED_TO özel, AGREES hiçbir zaman). */
const VIS_PUBLIC_TYPES: ReadonlySet<EdgeType> = new Set(["FOLLOWS", "VOUCHES", "DELEGATES_TO", "REPLIED_TO", "ENDORSED", "AUTHORED", "EXPERT_IN"]);
const PRIVILEGED_ROLES = new Set(["admin", "registrar", "auditor"]);

export const AGREEMENT_ALGO = "louvain-agreement";
export const AGREEMENT_VERSION = "1";
const AGREEMENT_PARAMS = { minCommon: 3, minAgreement: "> 1/2", resolution: 1 };
const DEFAULT_AGREEMENT_SEED = "forum-graph:louvain";

const LOCKSTEP_WINDOW_MS = 60_000;
const LOCKSTEP_MIN_COMMON = 3;
const LOCKSTEP_MIN_GROUP = 4;
/** Güvenlik sınırı: bir taramada en çok bu kadar çift karşılaştırılır (aynı dakikada binlerce aynı seçim, kapanış işlemini kilitlemesin). */
export const LOCKSTEP_MAX_PAIR_CHECKS = 2_000_000;

const NODE_PREFIXES = ["user:", "cat:", "proposal:", "msg:", "topic:"];

/** Önekli düğüm anahtarı: bilinen önek yoksa kullanıcı kimliği kabul edilir. */
export function nodeKey(id: string): string {
  return NODE_PREFIXES.some((p) => id.startsWith(p)) ? id : `user:${id}`;
}
export const userKey = (id: string): string => (id.startsWith("user:") ? id : `user:${id}`);
export const bareUser = (key: string): string => (key.startsWith("user:") ? key.slice(5) : key);
const isUserKey = (key: string): boolean => key.startsWith("user:");

interface EdgeRow {
  id: string;
  src: string;
  dst: string;
  type: string;
  weight: number;
  scope: string | null;
  rank: number | null;
  meta: string | null;
  created_at: number;
  revoked_at: number | null;
  ledger_tx: string | null;
}

interface EdgeAttrs {
  type: EdgeType;
  weight: number;
  scope: string | null;
  rank: number | null;
  meta: Record<string, unknown> | null;
  createdAt: number;
}

interface UserRow {
  id: string;
  nickname: string;
  status: string;
  roles: string;
  verified_at: number | null;
  created_at: number;
}

interface SnapshotRow {
  id: string;
  seed: string;
  assignments: string;
  coords: string;
}

/** DELEGATION taahhüdü: HMAC-SHA256(voteKey, from|to|scope|rank|edgeId), hex. */
export function delegationCommitment(
  voteKey: string,
  e: { id: string; src: string; dst: string; scope: string | null; rank: number | null },
): string {
  return createHmac("sha256", voteKey).update(`${bareUser(e.src)}|${bareUser(e.dst)}|${e.scope}|${e.rank}|${e.id}`, "utf8").digest("hex");
}

interface CommunityResult {
  communities: Record<string, number>;
  modularity: number;
  count: number;
}

export function createGraphService(ctx: CoreContext, deps: { ledger: LedgerService | null }): GraphService {
  const { db, clock } = ctx;
  const g = new MultiDirectedGraph<Record<string, never>, EdgeAttrs>();
  let version = 0;
  const memo = new Map<string, { key: string; value: unknown }>();

  // ───────────── Bellek içi graf ─────────────

  function attrsOf(r: EdgeRow): EdgeAttrs {
    return {
      type: r.type as EdgeType,
      weight: Number(r.weight),
      scope: r.scope,
      rank: r.rank === null ? null : Number(r.rank),
      meta: json<Record<string, unknown> | null>(r.meta, null),
      createdAt: Number(r.created_at),
    };
  }

  function addToMemory(r: EdgeRow): void {
    g.mergeNode(r.src);
    g.mergeNode(r.dst);
    if (!g.hasEdge(r.id)) g.addDirectedEdgeWithKey(r.id, r.src, r.dst, attrsOf(r));
  }

  function rebuild(): void {
    g.clear();
    const rows = db.all<EdgeRow>("SELECT * FROM graph_edges WHERE revoked_at IS NULL ORDER BY created_at, rowid");
    for (const r of rows) addToMemory(r);
    version++;
  }

  /** SQLite işlemi içinde yazar; hata olursa bellek içi graf tablodan yeniden kurulur. */
  function write<T>(fn: () => T): T {
    try {
      return db.tx(fn);
    } catch (e) {
      rebuild();
      throw e;
    } finally {
      version++;
    }
  }

  function memoize<T>(name: string, key: string, compute: () => T): T {
    const hit = memo.get(name);
    if (hit && hit.key === key) return hit.value as T;
    const value = compute();
    memo.set(name, { key, value });
    return value;
  }

  /** Grafın sürümü + doğrulanmış üye kümesinin ucuz imzası. */
  function socialKey(): string {
    const r = db.get<{ c: number; v: number; r: number; m: number }>(
      `SELECT COUNT(*) AS c, COALESCE(MAX(verified_at), 0) AS v, COALESCE(SUM(LENGTH(roles)), 0) AS r, COALESCE(MAX(created_at), 0) AS m
       FROM users WHERE status = 'verified'`,
    );
    return `${version}|${r?.c}|${r?.v}|${r?.r}|${r?.m}`;
  }

  // ───────────── SQL yardımcıları ─────────────

  function getUser(id: string): UserRow | undefined {
    return db.get<UserRow>("SELECT id, nickname, status, roles, verified_at, created_at FROM users WHERE id = ?", id);
  }

  function requireUser(id: string): UserRow {
    const u = getUser(id);
    if (!u) throw notFound("Kullanıcı");
    return u;
  }

  function verifiedUsers(): UserRow[] {
    return db.all<UserRow>("SELECT id, nickname, status, roles, verified_at, created_at FROM users WHERE status = 'verified' ORDER BY id");
  }

  function getEdge(id: string): EdgeRow | undefined {
    return db.get<EdgeRow>("SELECT * FROM graph_edges WHERE id = ?", id);
  }

  function insertEdge(e: { src: string; dst: string; type: EdgeType; weight: number; scope: string | null; rank: number | null; meta: Record<string, unknown> | null }): EdgeRow {
    const row: EdgeRow = {
      id: newId(),
      src: e.src,
      dst: e.dst,
      type: e.type,
      weight: e.weight,
      scope: e.scope,
      rank: e.rank,
      meta: e.meta ? JSON.stringify(e.meta) : null,
      created_at: clock.now(),
      revoked_at: null,
      ledger_tx: null,
    };
    db.run(
      "INSERT INTO graph_edges(id, src, dst, type, weight, scope, rank, meta, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)",
      row.id,
      row.src,
      row.dst,
      row.type,
      row.weight,
      row.scope,
      row.rank,
      row.meta,
      row.created_at,
    );
    addToMemory(row);
    return row;
  }

  function revokeRow(r: EdgeRow): void {
    db.run("UPDATE graph_edges SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL", clock.now(), r.id);
    if (g.hasEdge(r.id)) g.dropEdge(r.id);
  }

  function activeEdges(src: string, dst: string, type: EdgeType): EdgeRow[] {
    return db.all<EdgeRow>(
      "SELECT * FROM graph_edges WHERE src = ? AND dst = ? AND type = ? AND revoked_at IS NULL ORDER BY created_at, rowid",
      src,
      dst,
      type,
    );
  }

  function view(r: EdgeRow): GraphEdgeView {
    return {
      id: r.id,
      src: r.src,
      dst: r.dst,
      type: r.type as EdgeType,
      weight: Number(r.weight),
      scope: r.scope,
      meta: json<Record<string, unknown> | null>(r.meta, null),
      createdAt: Number(r.created_at),
    };
  }

  // ───────────── Vekâlet ─────────────

  /**
   * Defterde ham kullanıcı kimliği yok: yalnızca kenar kimliği ve sunucu sırrıyla (voteKey) anahtarlı taahhüt.
   * Anahtarsız özet, üye çiftleri denenerek kaba kuvvetle çözülebilirdi; sunucu taahhüdü yine doğrulayabilir.
   */
  function recordDelegation(r: EdgeRow, action: "create" | "revoke"): string | null {
    if (!deps.ledger) return null;
    return deps.ledger.submit("DELEGATION", { edgeId: r.id, action, commitment: delegationCommitment(ctx.config.voteKey, r) }).txHash;
  }

  function normalizeScope(scope: string): string {
    const s = typeof scope === "string" ? scope.trim() : "";
    if (s === "*") return s;
    const iri = expandIri(s);
    if (!/^[A-Za-z][A-Za-z0-9+.-]*:[^\s<>"{}|\\^`]+$/.test(iri)) {
      throw badRequest("invalid_scope", "Vekâlet kapsamı \"*\" (genel) ya da bir kategori IRI'si olmalıdır.");
    }
    return iri;
  }

  /** Yönlü BFS/yönsüz BFS: a'dan b'ye, yalnız verilen tiplerdeki aktif kenarlarla en kısa adım sayısı. */
  function bfs(a: string, b: string, types: ReadonlySet<EdgeType>, maxDepth: number, directed: boolean): number | null {
    if (a === b) return 0;
    if (!g.hasNode(a) || !g.hasNode(b)) return null;
    const seen = new Set<string>([a]);
    let frontier = [a];
    for (let depth = 1; depth <= maxDepth && frontier.length > 0; depth++) {
      const next: string[] = [];
      for (const n of frontier) {
        const visit = (_key: string, attr: EdgeAttrs, s: string, t: string): void => {
          if (!types.has(attr.type)) return;
          const other = s === n ? t : s;
          if (seen.has(other)) return;
          seen.add(other);
          next.push(other);
        };
        if (directed) g.forEachOutEdge(n, visit);
        else g.forEachEdge(n, visit);
      }
      if (seen.has(b)) return depth;
      frontier = next;
    }
    return null;
  }

  function delegationView(r: EdgeRow, toNickname?: string): DelegationView {
    const to = bareUser(r.dst);
    return {
      id: r.id,
      from: bareUser(r.src),
      to,
      toNickname: toNickname ?? getUser(to)?.nickname ?? "",
      scope: r.scope ?? "*",
      rank: Number(r.rank ?? 1),
      createdAt: Number(r.created_at),
    };
  }

  function delegateRow(fromIn: string, toIn: string, scopeIn: string, rank: number): { row: EdgeRow; nickname: string } {
    const from = bareUser(fromIn);
    const to = bareUser(toIn);
    if (from === to) throw badRequest("self_delegation", "Kendinize vekâlet veremezsiniz.");
    if (!Number.isInteger(rank) || rank < 1 || rank > 3) throw badRequest("invalid_rank", "Vekâlet sırası 1, 2 ya da 3 olmalıdır.");
    const scope = normalizeScope(scopeIn);
    requireUser(from);
    const target = requireUser(to);
    if (target.status !== "verified") {
      throw unprocessable("delegate_not_verified", "Vekâlet yalnızca kimliği doğrulanmış bir üyeye verilebilir.");
    }
    const existing = db.all<EdgeRow>(
      "SELECT * FROM graph_edges WHERE src = ? AND type = 'DELEGATES_TO' AND scope = ? AND rank = ? AND revoked_at IS NULL ORDER BY created_at, rowid",
      userKey(from),
      scope,
      rank,
    );
    if (existing.length === 1 && existing[0].dst === userKey(to)) return { row: existing[0], nickname: target.nickname };
    if (bfs(userKey(to), userKey(from), new Set<EdgeType>(["DELEGATES_TO"]), Number.POSITIVE_INFINITY, true) !== null) {
      throw conflict(
        "delegation_cycle",
        "Bu vekâlet bir döngü oluşturur: seçtiğiniz üye, bir vekâlet zinciri üzerinden zaten size bağlı.",
      );
    }
    const row = write(() => {
      for (const old of existing) {
        revokeRow(old);
        recordDelegation(old, "revoke");
      }
      const created = insertEdge({ src: userKey(from), dst: userKey(to), type: "DELEGATES_TO", weight: 1, scope, rank, meta: null });
      const tx = recordDelegation(created, "create");
      if (tx) {
        db.run("UPDATE graph_edges SET ledger_tx = ? WHERE id = ?", tx, created.id);
        created.ledger_tx = tx;
      }
      return created;
    });
    return { row, nickname: target.nickname };
  }

  // ───────────── Türetilmiş graflar ─────────────

  /** Doğrulanmış kullanıcılar arasında, pozitif ağırlıklı sosyal kenarlardan yönlü basit graf (ağırlıklar toplanır). */
  function socialDirected(users: UserRow[]): DirectedGraph<Record<string, never>, { weight: number }> {
    const dg = new DirectedGraph<Record<string, never>, { weight: number }>();
    for (const u of users) dg.addNode(userKey(u.id));
    g.forEachEdge((_key, attr, s, t) => {
      if (!SOCIAL_TYPES.has(attr.type) || !(attr.weight > 0) || s === t) return;
      if (!dg.hasNode(s) || !dg.hasNode(t)) return;
      const k = dg.edge(s, t);
      if (k) dg.setEdgeAttribute(k, "weight", dg.getEdgeAttribute(k, "weight") + attr.weight);
      else dg.addEdge(s, t, { weight: attr.weight });
    });
    return dg;
  }

  function socialUndirected(users: UserRow[]): UndirectedGraph {
    const ug = new UndirectedGraph();
    for (const u of users) ug.addNode(userKey(u.id));
    g.forEachEdge((_key, attr, s, t) => {
      if (!SOCIAL_TYPES.has(attr.type) || !(attr.weight > 0) || s === t) return;
      if (!ug.hasNode(s) || !ug.hasNode(t) || ug.hasEdge(s, t)) return;
      ug.addEdge(s, t);
    });
    return ug;
  }

  function computePagerank(): Record<string, number> {
    return memoize("pagerank", socialKey(), () => {
      const users = verifiedUsers();
      const dg = socialDirected(users);
      const out: Record<string, number> = {};
      if (dg.order === 0) return out;
      let pr: Record<string, number>;
      try {
        pr = pagerankMetric(dg, { getEdgeWeight: "weight", alpha: 0.85, maxIterations: 500, tolerance: 1e-9 });
      } catch {
        pr = {};
        dg.forEachNode((n) => {
          pr[n] = 1 / dg.order;
        });
      }
      for (const u of users) out[u.id] = round6(pr[userKey(u.id)] ?? 0);
      return out;
    });
  }

  function computeBrokers(): { userId: string; score: number }[] {
    return memoize("brokers", socialKey(), () => {
      const ug = socialUndirected(verifiedUsers());
      if (ug.order < 3 || ug.size === 0) return [];
      const bc = betweennessMetric(ug, { getEdgeWeight: null, normalized: true });
      return Object.entries(bc)
        .filter(([n, s]) => isUserKey(n) && s > 0)
        .map(([n, s]) => ({ userId: bareUser(n), score: round6(s) }))
        .sort((x, y) => y.score - x.score || (x.userId < y.userId ? -1 : x.userId > y.userId ? 1 : 0));
    });
  }

  function computeSybil(): { scores: Record<string, number>; flagged: string[] } {
    // "Genç hesap" kuralı zamana bağlı: önbellek anahtarına saat dilimi (1 saat) eklenir.
    return memoize("sybil", `${socialKey()}|${Math.floor(clock.now() / 3_600_000)}`, () => {
      const users = verifiedUsers();
      const nodes = users.map((u) => u.id);
      const verified = new Set(nodes);
      const pairs: { a: string; b: string; w: number }[] = [];
      const suspicious = new Map<string, Set<string>>();
      const degree = new Map<string, number>();
      g.forEachEdge((_key, attr, s, t) => {
        if (attr.type !== "VOUCHES" || !isUserKey(s) || !isUserKey(t) || s === t) return;
        const a = bareUser(s);
        const b = bareUser(t);
        if (!verified.has(a)) return;
        if (attr.weight < 0) {
          const set = suspicious.get(b) ?? new Set<string>();
          set.add(a);
          suspicious.set(b, set);
          return;
        }
        if (!(attr.weight > 0) || !verified.has(b)) return;
        pairs.push({ a, b, w: attr.weight });
        degree.set(a, (degree.get(a) ?? 0) + attr.weight);
        degree.set(b, (degree.get(b) ?? 0) + attr.weight);
      });
      const privileged = users.filter((u) => json<string[]>(u.roles, []).some((r) => PRIVILEGED_ROLES.has(r))).map((u) => u.id);
      const seeds = new Set(privileged);
      if (!privileged.some((id) => (degree.get(id) ?? 0) > 0)) {
        // Yetkili tohumlar kefalet ağına bağlı değilse: en eski doğrulanmış N hesap (N = ⌈√n⌉).
        const n0 = Math.max(1, Math.ceil(Math.sqrt(users.length)));
        users
          .slice()
          .sort((x, y) => Number(x.verified_at ?? x.created_at) - Number(y.verified_at ?? y.created_at) || Number(x.created_at) - Number(y.created_at) || (x.id < y.id ? -1 : 1))
          .slice(0, n0)
          .forEach((u) => seeds.add(u.id));
      }
      const iterations = Math.max(1, Math.ceil(Math.log2(Math.max(2, nodes.length))));
      // Genç hesap: doğrulanalı SYBIL_PARAMS.youngMs'den az (doğrulama zamanı yoksa oluşturma zamanı).
      const now = clock.now();
      const young = new Set(users.filter((u) => now - Number(u.verified_at ?? u.created_at) < SYBIL_PARAMS.youngMs).map((u) => u.id));
      const result = classifySybil({
        nodes,
        pairs,
        seeds,
        suspicious: new Map([...suspicious].map(([id, set]) => [id, set.size] as const)),
        young,
        iterations,
      });
      const values = [...result.trust.values()];
      const max = values.reduce((m, v) => (v > m ? v : m), 0);
      const scores: Record<string, number> = {};
      for (const id of nodes) scores[id] = round6(max > 0 ? (result.trust.get(id) ?? 0) / max : 0);
      return { scores, flagged: result.flagged };
    });
  }

  // ───────────── Oy uzlaşısı (Louvain) ─────────────

  /** Kapanmış öneriler → değerlendirilecek tur. Ara sayımlar (needs_more_votes) kapanış sayılmaz. */
  function closedRounds(): Map<string, number> {
    const closed = new Map<string, number>();
    for (const t of db.all<{ proposal_id: string; round: number; result: string }>("SELECT proposal_id, round, result FROM tallies")) {
      const res = json<Partial<DecisionResult>>(t.result, {});
      if (res.outcome === "needs_more_votes") continue;
      closed.set(t.proposal_id, Math.max(closed.get(t.proposal_id) ?? 0, Number(t.round)));
    }
    const finals = db.all<{ id: string; r: number }>(
      `SELECT p.id AS id, MAX(b.round) AS r FROM proposals p JOIN ballots b ON b.proposal_id = p.id
       WHERE p.status IN ('enacted', 'rejected') GROUP BY p.id`,
    );
    for (const p of finals) if (!closed.has(p.id)) closed.set(p.id, Number(p.r));
    return closed;
  }

  function agreementInput(): { pairs: { a: string; b: string; same: number; common: number }[] } {
    const votes: VoteRow[] = [];
    for (const [proposal, round] of [...closedRounds()].sort((x, y) => (x[0] < y[0] ? -1 : 1))) {
      for (const b of db.all<{ user_id: string; choice: string }>(
        "SELECT user_id, choice FROM ballots WHERE proposal_id = ? AND round = ? ORDER BY user_id",
        proposal,
        round,
      )) {
        votes.push({ proposal, user: b.user_id, choice: b.choice });
      }
    }
    return { pairs: agreementPairs(votes, AGREEMENT_PARAMS.minCommon).filter((p) => p.same * 2 > p.common) };
  }

  /**
   * Önbellek anahtarı yalnızca agreementInput()'un okuduğu veriye bağlıdır: kesin sayımı olan turların ve
   * yürürlüğe girmiş/reddedilmiş önerilerin oyları. Oylama süren bir öneriye atılan oy anahtarı değiştirmez
   * (aksi halde her oy sonraki panel isteğinde O(P·V²) yeniden hesaplamayı tetikler).
   */
  function agreementDataKey(): string {
    const b = db.get<{ c: number; m: number }>(
      `SELECT COUNT(*) AS c, COALESCE(MAX(b.updated_at), 0) AS m FROM ballots b
       WHERE EXISTS (SELECT 1 FROM tallies t WHERE t.proposal_id = b.proposal_id AND t.round = b.round AND COALESCE(json_extract(t.result, '$.outcome'), '') <> 'needs_more_votes')
          OR b.proposal_id IN (SELECT id FROM proposals WHERE status IN ('enacted', 'rejected'))`,
    );
    const t = db.get<{ c: number; m: number }>("SELECT COUNT(*) AS c, COALESCE(MAX(created_at), 0) AS m FROM tallies");
    const p = db.get<{ c: number; m: number }>(
      "SELECT COUNT(*) AS c, COALESCE(MAX(updated_at), 0) AS m FROM proposals WHERE status IN ('enacted', 'rejected')",
    );
    return `${b?.c}|${b?.m}|${t?.c}|${t?.m}|${p?.c}|${p?.m}`;
  }

  function agreementCommunities(seed: string): CommunityResult {
    const result = memoize(`agreement:${seed}`, agreementDataKey(), () => computeAgreement(seed));
    return { communities: { ...result.communities }, modularity: result.modularity, count: result.count };
  }

  function computeAgreement(seed: string): CommunityResult {
    const { pairs } = agreementInput();
    if (pairs.length === 0) return { communities: {}, modularity: 0, count: 0 };
    const inputHash = hashCanonical({ algo: AGREEMENT_ALGO, version: AGREEMENT_VERSION, params: AGREEMENT_PARAMS, edges: pairs.map((p) => [p.a, p.b, p.same, p.common]) });
    const previous = db.get<{ result: string }>(
      "SELECT result FROM graph_runs WHERE algo = ? AND version = ? AND input_hash = ? AND seed = ? ORDER BY created_at DESC, rowid DESC LIMIT 1",
      AGREEMENT_ALGO,
      AGREEMENT_VERSION,
      inputHash,
      seed,
    );
    if (previous) return json<CommunityResult>(previous.result, { communities: {}, modularity: 0, count: 0 });

    const ug = new UndirectedGraph<Record<string, never>, { weight: number }>();
    const nodes = [...new Set(pairs.flatMap((p) => [p.a, p.b]))].sort();
    for (const n of nodes) ug.addNode(n);
    for (const p of pairs) ug.addEdge(p.a, p.b, { weight: p.same / p.common });
    const detailed = louvain.detailed(ug, { getEdgeWeight: "weight", rng: createRng(seed).next, resolution: AGREEMENT_PARAMS.resolution });
    const { communities, count } = canonicalCommunities(detailed.communities);
    const result: CommunityResult = { communities, modularity: round6(detailed.modularity), count };
    const outputHash = hashCanonical(result);
    const runId = newId();
    const ledgerTx = deps.ledger
      ? deps.ledger.submit("GRAPH_RUN", { runId, algo: AGREEMENT_ALGO, version: AGREEMENT_VERSION, inputHash, outputHash, seed }).txHash
      : null;
    db.run(
      "INSERT INTO graph_runs(id, algo, version, params, seed, input_hash, output_hash, result, ledger_tx, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
      runId,
      AGREEMENT_ALGO,
      AGREEMENT_VERSION,
      JSON.stringify(AGREEMENT_PARAMS),
      seed,
      inputHash,
      outputHash,
      JSON.stringify(result),
      ledgerTx,
      clock.now(),
    );
    return result;
  }

  function latestSnapshot(): SnapshotRow | undefined {
    return db.get<SnapshotRow>("SELECT id, seed, assignments, coords FROM cluster_snapshots ORDER BY created_at DESC, rowid DESC LIMIT 1");
  }

  /** stats/visualization için Louvain tohumu: son küme anlık görüntüsünün tohumu (ALGORITMA §9 madde 8: çapraz kontrol). */
  function defaultSeed(): string {
    return latestSnapshot()?.seed ?? DEFAULT_AGREEMENT_SEED;
  }

  // ───────────── Kalıcı kaybeden göstergesi ─────────────

  function permanentLoser(): GraphStats["permanentLoser"] {
    const snap = latestSnapshot();
    if (!snap) return [];
    const assignments = json<Record<string, string>>(snap.assignments, {});
    const clusterIds = [...new Set(Object.values(assignments))].sort(
      (x, y) => Number(x.replace(/\D/g, "")) - Number(y.replace(/\D/g, "")) || (x < y ? -1 : x > y ? 1 : 0),
    );
    const last = new Map<string, { round: number; result: string }>();
    for (const t of db.all<{ proposal_id: string; round: number; result: string }>(
      "SELECT proposal_id, round, result FROM tallies ORDER BY proposal_id, round, created_at, rowid",
    )) {
      last.set(t.proposal_id, { round: Number(t.round), result: t.result });
    }
    const tallyStats = new Map<string, { lost: number; decisions: number }>(clusterIds.map((c) => [c, { lost: 0, decisions: 0 }]));
    for (const [proposalId, t] of [...last].sort((x, y) => (x[0] < y[0] ? -1 : 1))) {
      const res = json<Partial<DecisionResult>>(t.result, {});
      if (res.outcome !== "accept" && res.outcome !== "reject") continue;
      const outcomeChoice = res.outcome === "accept" ? "yes" : "no";
      const counts = new Map<string, { yes: number; no: number }>();
      for (const b of db.all<{ user_id: string; choice: string }>(
        "SELECT user_id, choice FROM ballots WHERE proposal_id = ? AND round = ?",
        proposalId,
        t.round,
      )) {
        const c = assignments[b.user_id];
        if (!c) continue;
        const k = counts.get(c) ?? { yes: 0, no: 0 };
        if (b.choice === "yes") k.yes++;
        else if (b.choice === "no") k.no++;
        counts.set(c, k);
      }
      for (const c of clusterIds) {
        const k = counts.get(c);
        if (!k || k.yes === k.no) continue;
        const majority = k.yes > k.no ? "yes" : "no";
        const s = tallyStats.get(c)!;
        s.decisions++;
        if (majority !== outcomeChoice) s.lost++;
      }
    }
    return clusterIds.map((clusterId) => {
      const s = tallyStats.get(clusterId)!;
      return { clusterId, lostShare: s.decisions > 0 ? round6(s.lost / s.decisions) : 0, decisions: s.decisions };
    });
  }

  function incomingDelegationLoads(users: UserRow[]): Map<string, number> {
    const delegators = new Map<string, Set<string>>();
    g.forEachEdge((_key, attr, s, t) => {
      if (attr.type !== "DELEGATES_TO" || !isUserKey(s) || !isUserKey(t)) return;
      const set = delegators.get(bareUser(t)) ?? new Set<string>();
      set.add(bareUser(s));
      delegators.set(bareUser(t), set);
    });
    return new Map(users.map((u) => [u.id, delegators.get(u.id)?.size ?? 0] as const));
  }

  // ───────────── Hizmet ─────────────

  const service: GraphService = {
    rebuild,

    addEdge(e: NewEdge): GraphEdgeView {
      if (!EDGE_TYPES.includes(e.type)) throw badRequest("invalid_edge_type", "Geçersiz kenar türü.");
      if (typeof e.src !== "string" || !e.src || typeof e.dst !== "string" || !e.dst) {
        throw badRequest("invalid_edge", "Kenarın kaynak ve hedef düğümü belirtilmelidir.");
      }
      const src = nodeKey(e.src);
      const dst = nodeKey(e.dst);
      if (e.type === "DELEGATES_TO") {
        if (!isUserKey(src) || !isUserKey(dst)) throw badRequest("invalid_edge", "Vekâlet yalnızca iki üye arasında verilebilir.");
        return view(delegateRow(src, dst, e.scope ?? "*", e.rank ?? 1).row);
      }
      const weight = e.weight ?? 1;
      if (!Number.isFinite(weight)) throw badRequest("invalid_weight", "Kenar ağırlığı geçerli bir sayı olmalıdır.");
      return view(write(() => insertEdge({ src, dst, type: e.type, weight, scope: e.scope ?? null, rank: e.rank ?? null, meta: e.meta ?? null })));
    },

    revokeEdge(id: string): void {
      const r = getEdge(id);
      if (!r) throw notFound("Kenar");
      if (r.revoked_at !== null) return;
      write(() => {
        revokeRow(r);
        if (r.type === "DELEGATES_TO") recordDelegation(r, "revoke");
      });
    },

    listEdges(filter): GraphEdgeView[] {
      const where: string[] = [];
      const params: string[] = [];
      if (filter.src) {
        where.push("src = ?");
        params.push(nodeKey(filter.src));
      }
      if (filter.dst) {
        where.push("dst = ?");
        params.push(nodeKey(filter.dst));
      }
      if (filter.type) {
        where.push("type = ?");
        params.push(filter.type);
      }
      if (!filter.includeRevoked) where.push("revoked_at IS NULL");
      const sql = `SELECT * FROM graph_edges${where.length ? ` WHERE ${where.join(" AND ")}` : ""} ORDER BY created_at, rowid`;
      return db.all<EdgeRow>(sql, ...params).map(view);
    },

    follow(userId: string, targetUserId: string): GraphEdgeView {
      const a = bareUser(userId);
      const b = bareUser(targetUserId);
      if (a === b) throw badRequest("self_follow", "Kendinizi takip edemezsiniz.");
      requireUser(a);
      requireUser(b);
      const existing = activeEdges(userKey(a), userKey(b), "FOLLOWS");
      if (existing.length > 0) return view(existing[0]);
      return view(write(() => insertEdge({ src: userKey(a), dst: userKey(b), type: "FOLLOWS", weight: 1, scope: null, rank: null, meta: null })));
    },

    unfollow(userId: string, targetUserId: string): void {
      const existing = activeEdges(userKey(userId), userKey(targetUserId), "FOLLOWS");
      if (existing.length === 0) return;
      write(() => existing.forEach(revokeRow));
    },

    vouch(userId: string, targetUserId: string, level): GraphEdgeView {
      const a = bareUser(userId);
      const b = bareUser(targetUserId);
      if (a === b) throw badRequest("self_vouch", "Kendinize kefil olamazsınız.");
      if (!Object.hasOwn(VOUCH_WEIGHTS, level)) throw badRequest("invalid_vouch_level", "Geçersiz kefalet düzeyi.");
      requireUser(a);
      requireUser(b);
      const existing = activeEdges(userKey(a), userKey(b), "VOUCHES");
      if (existing.length === 1 && json<{ level?: string }>(existing[0].meta, {}).level === level) return view(existing[0]);
      return view(
        write(() => {
          existing.forEach(revokeRow);
          return insertEdge({ src: userKey(a), dst: userKey(b), type: "VOUCHES", weight: VOUCH_WEIGHTS[level], scope: null, rank: null, meta: { level } });
        }),
      );
    },

    relate(userA: string, userB: string, kind): GraphEdgeView {
      const a = bareUser(userA);
      const b = bareUser(userB);
      if (a === b) throw badRequest("self_relation", "Kendinizle yakınlık beyan edemezsiniz.");
      if (!RELATION_KINDS.includes(kind)) throw badRequest("invalid_relation", "Geçersiz yakınlık türü.");
      requireUser(a);
      requireUser(b);
      const existing = [...activeEdges(userKey(a), userKey(b), "RELATED_TO"), ...activeEdges(userKey(b), userKey(a), "RELATED_TO")].find(
        (r) => json<{ kind?: string }>(r.meta, {}).kind === kind,
      );
      if (existing) return view(existing);
      return view(write(() => insertEdge({ src: userKey(a), dst: userKey(b), type: "RELATED_TO", weight: 1, scope: null, rank: null, meta: { kind } })));
    },

    delegate(from: string, to: string, scope: string, rank: number): DelegationView {
      const { row, nickname } = delegateRow(from, to, scope, rank);
      return delegationView(row, nickname);
    },

    revokeDelegation(id: string, byUserId: string): void {
      const r = getEdge(id);
      if (!r || r.type !== "DELEGATES_TO") throw notFound("Vekâlet");
      if (r.src !== userKey(byUserId)) throw forbidden("Bu vekâleti yalnızca veren üye geri alabilir.");
      if (r.revoked_at !== null) return;
      write(() => {
        revokeRow(r);
        recordDelegation(r, "revoke");
      });
    },

    delegations(userId?: string): DelegationEdge[] {
      const rows = userId
        ? db.all<EdgeRow>(
            "SELECT * FROM graph_edges WHERE type = 'DELEGATES_TO' AND revoked_at IS NULL AND src = ? ORDER BY created_at, id",
            userKey(userId),
          )
        : db.all<EdgeRow>("SELECT * FROM graph_edges WHERE type = 'DELEGATES_TO' AND revoked_at IS NULL ORDER BY created_at, id");
      return rows.map((r) => ({
        id: r.id,
        from: bareUser(r.src),
        to: bareUser(r.dst),
        scope: r.scope ?? "*",
        rank: Number(r.rank ?? 1),
        createdAt: Number(r.created_at),
      }));
    },

    distance(a: string, b: string, types: EdgeType[], maxDepth: number): number | null {
      return bfs(nodeKey(a), nodeKey(b), new Set(types), Math.max(0, Math.floor(maxDepth)), false);
    },

    conflictOfInterest(expertUserId: string, authorUserId: string, opts): ConflictCheck {
      const e = userKey(expertUserId);
      const a = userKey(authorUserId);
      const reasons: string[] = [];
      let hard = false;
      if (e === a) {
        return { hard: true, soft: 1, distance: 0, reasons: ["Bilirkişi adayı, önerinin yazarıdır."] };
      }
      // Kesin çatışma yalnız bilirkişi ile yazar ARASINDAKİ doğrudan RELATED_TO kenarıdır (kenarı ikisinden biri beyan eder).
      // Üçüncü kişilerin tek taraflı beyanlarıyla kurulan 2-3 adımlık zincirler rıza dışı dışlamaya yol açmasın diye yalnız
      // yumuşak çatışmadır (ağırlığı yarıya indirir); hedef bunları geri alamaz.
      const related = bfs(e, a, new Set<EdgeType>(["RELATED_TO"]), 3, false);
      let chainSoft = 0;
      if (related === 1) {
        hard = true;
        const kinds = new Set<string>();
        g.forEachEdge(e, (_key, attr, s, t) => {
          if (attr.type === "RELATED_TO" && (s === a || t === a)) kinds.add(RELATION_LABELS[String(attr.meta?.kind)] ?? "yakınlık");
        });
        reasons.push(`Yazarla doğrudan beyan edilmiş yakınlık var (${[...kinds].sort().join(", ")}).`);
      } else if (related !== null) {
        chainSoft = 0.5;
        reasons.push(`Yazarla ${related} adımlık aile/iş/hane yakınlığı zinciri var (üçüncü kişi beyanlarına dayanabilir; yumuşak çatışma).`);
      }
      const household = opts?.householdOf;
      if (household) {
        const he = household(bareUser(e));
        const ha = household(bareUser(a));
        if (he && ha && he === ha) {
          hard = true;
          reasons.push("Yazarla aynı hanede yaşıyor.");
        }
      }
      const distance = bfs(e, a, SOCIAL_TYPES, 2, false);
      let soft = 0;
      if (distance === 1) {
        soft = 1;
        reasons.push("Yazarla doğrudan bağlantısı var (takip, kefalet ya da vekâlet).");
      } else if (distance === 2) {
        soft = 0.5;
        reasons.push("Yazarla iki adımlık dolaylı bağlantısı var.");
      }
      return { hard, soft: Math.max(soft, chainSoft), distance, reasons };
    },

    agreementCommunities,

    pagerank(): Record<string, number> {
      return { ...computePagerank() };
    },

    brokers(limit: number): { userId: string; score: number }[] {
      return computeBrokers()
        .slice(0, Math.max(0, Math.floor(limit)))
        .map((b) => ({ ...b }));
    },

    sybilRank(): { scores: Record<string, number>; flagged: string[] } {
      const r = computeSybil();
      return { scores: { ...r.scores }, flagged: r.flagged.slice() };
    },

    lockstep(proposalId: string): { groups: string[][] } {
      const top = db.get<{ r: number | null }>("SELECT MAX(round) AS r FROM ballots WHERE proposal_id = ?", proposalId);
      if (!top || top.r === null) return { groups: [] };
      const ballots = db.all<{ user_id: string; choice: string; t: number }>(
        "SELECT user_id, choice, updated_at AS t FROM ballots WHERE proposal_id = ? AND round = ? ORDER BY updated_at, user_id",
        proposalId,
        top.r,
      );
      // Seçime göre (zaman sıralı) listeler: push() ile, her oyda tüm listeyi kopyalamadan (eski: [...liste, oy] → O(n²)).
      const byChoice = new Map<string, { user_id: string; t: number }[]>();
      for (const b of ballots) {
        const list = byChoice.get(b.choice);
        if (list) list.push(b);
        else byChoice.set(b.choice, [b]);
      }
      // Kayan pencere: yalnız penceredeki (bir komşusu 60 sn içinde olan) oylar çift adayıdır; tek başına duran oylar elenir.
      const windowed = new Set<string>();
      for (const list of byChoice.values()) {
        for (let i = 0; i + 1 < list.length; i++) {
          if (Number(list[i + 1].t) - Number(list[i].t) <= LOCKSTEP_WINDOW_MS) {
            windowed.add(list[i].user_id);
            windowed.add(list[i + 1].user_id);
          }
        }
      }
      if (windowed.size < LOCKSTEP_MIN_GROUP) return { groups: [] };
      const history = new Map<string, Map<string, string>>();
      for (const h of db.all<{ p: string; u: string; c: string }>(
        `SELECT b.proposal_id AS p, b.user_id AS u, b.choice AS c FROM ballots b
         JOIN (SELECT proposal_id, MAX(round) AS r FROM ballots GROUP BY proposal_id) lr ON lr.proposal_id = b.proposal_id AND lr.r = b.round
         WHERE b.proposal_id <> ? AND b.user_id IN (SELECT value FROM json_each(?))`,
        proposalId,
        JSON.stringify([...windowed]),
      )) {
        const m = history.get(h.u) ?? new Map<string, string>();
        m.set(h.p, h.c);
        history.set(h.u, m);
      }
      // Başka ≥ LOCKSTEP_MIN_COMMON oyu olmayan kişi hiçbir çiftle "ortak ≥ eşik" sağlayamaz: baştan elenir.
      const agrees = (x: string, y: string): boolean => {
        const hx = history.get(x);
        const hy = history.get(y);
        if (!hx || !hy) return false;
        const [small, large] = hx.size <= hy.size ? [hx, hy] : [hy, hx];
        let common = 0;
        let same = 0;
        for (const [p, c] of small) {
          const other = large.get(p);
          if (other === undefined) continue;
          common++;
          if (other === c) same++;
        }
        return common >= LOCKSTEP_MIN_COMMON && same * 10 >= common * 9;
      };
      // Çiftler üretilirken hemen değerlendirilir (hepsi bellekte tutulmaz); yalnız kilit adım kenarları saklanır.
      const locked: [string, string][] = [];
      let checks = 0;
      scan: for (const all of byChoice.values()) {
        const list = all.filter((b) => windowed.has(b.user_id) && (history.get(b.user_id)?.size ?? 0) >= LOCKSTEP_MIN_COMMON);
        for (let i = 0; i < list.length; i++) {
          for (let j = i + 1; j < list.length && Number(list[j].t) - Number(list[i].t) <= LOCKSTEP_WINDOW_MS; j++) {
            if (++checks > LOCKSTEP_MAX_PAIR_CHECKS) break scan;
            if (agrees(list[i].user_id, list[j].user_id)) locked.push([list[i].user_id, list[j].user_id]);
          }
        }
      }
      return { groups: kCoreComponents(locked, LOCKSTEP_MIN_GROUP - 1, LOCKSTEP_MIN_GROUP) };
    },

    stats(): GraphStats {
      const users = verifiedUsers();
      const nick = new Map(users.map((u) => [u.id, u.nickname] as const));
      let edges = 0;
      g.forEachEdge((_key, _attr, s, t) => {
        if (isUserKey(s) && isUserKey(t)) edges++;
      });
      const comm = agreementCommunities(defaultSeed());
      const loads = [...incomingDelegationLoads(users).values()];
      return {
        nodes: users.length,
        edges,
        communities: comm.count,
        modularity: comm.modularity,
        delegationGini: round6(gini(loads)),
        maxDelegationLoad: loads.length ? Math.max(...loads) : 0,
        brokers: computeBrokers()
          .slice(0, 5)
          .map((b) => ({ userId: b.userId, nickname: nick.get(b.userId) ?? "", score: b.score })),
        sybilFlagged: computeSybil().flagged.length,
        permanentLoser: permanentLoser(),
      };
    },

    visualization(opts): { nodes: GraphVisNode[]; edges: GraphVisEdge[] } {
      // Görünürlük politikası burada uygulanır (varsayılan kapalı; sözleşme: GraphService.visualization):
      // AGREES (oy gizliliği) hiç verilmez; RELATED_TO (aile/iş/hane) yalnız includePrivate === true iken;
      // siyasi görüş alanları (cluster, community, x, y — KVKK md. 6) yalnız viewerId'nin KENDİ düğümünde bulunur.
      const includePrivate = opts.includePrivate === true;
      const viewerId = opts.viewerId ?? null;
      const requested = opts.includeEdgeTypes?.length ? opts.includeEdgeTypes : DEFAULT_VIS_TYPES;
      const types = new Set<EdgeType>(requested.filter((t) => VIS_PUBLIC_TYPES.has(t) || (t === "RELATED_TO" && includePrivate)));
      const limit = Math.min(5000, Math.max(1, Math.floor(opts.limit ?? 500)));
      const users = verifiedUsers();
      const pr = computePagerank();
      const sybil = new Set(computeSybil().flagged);
      const comm = agreementCommunities(defaultSeed()).communities;
      const snap = latestSnapshot();
      const assignments = snap ? json<Record<string, string>>(snap.assignments, {}) : {};
      const coords = snap ? json<Record<string, [number, number]>>(snap.coords, {}) : {};
      const experts = new Set(db.all<{ user_id: string }>("SELECT user_id FROM experts WHERE status = 'active'").map((r) => r.user_id));
      const chosen = users
        .slice()
        .sort((x, y) => (pr[y.id] ?? 0) - (pr[x.id] ?? 0) || (x.id < y.id ? -1 : x.id > y.id ? 1 : 0))
        .slice(0, limit);
      const included = new Set(chosen.map((u) => u.id));
      const nodes: GraphVisNode[] = chosen.map((u) => {
        const own = viewerId !== null && u.id === viewerId;
        const node: GraphVisNode = {
          id: u.id,
          label: u.nickname,
          cluster: own ? (assignments[u.id] ?? null) : null,
          community: own ? (comm[u.id] ?? null) : null,
          pagerank: pr[u.id] ?? 0,
          isExpert: experts.has(u.id),
          sybilFlag: sybil.has(u.id),
        };
        const xy = coords[u.id];
        if (own && Array.isArray(xy) && xy.length >= 2) {
          node.x = Number(xy[0]);
          node.y = Number(xy[1]);
        }
        return node;
      });
      const edges: GraphVisEdge[] = [];
      g.forEachEdge((_key, attr, s, t) => {
        if (!types.has(attr.type) || !isUserKey(s) || !isUserKey(t)) return;
        const source = bareUser(s);
        const target = bareUser(t);
        if (!included.has(source) || !included.has(target)) return;
        edges.push({ source, target, type: attr.type, weight: attr.weight });
      });
      return { nodes, edges };
    },
  };

  rebuild();
  return service;
}
