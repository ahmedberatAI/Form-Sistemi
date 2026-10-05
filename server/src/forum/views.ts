// Görünüm birleştirme: ProposalSummary, TopicSummary, MessageView, PublicUser — toplu sorgularla (N+1 yok).
import {
  clusterLabel,
  fy,
  isSignificant,
  publicJoinDay,
  sponsorsRequired,
  toRational,
  type DecisionParams,
  type MessageView,
  type ProposalSummary,
  type PublicUser,
  type Role,
  type Stance,
  type Tier,
  type TopicSummary,
  type UserStatus,
} from "@forum/shared";
import { json } from "../db";
import { defaultDecisionParams } from "../governance/params";
import { integrityWarningCounts } from "./integrity";
import {
  ACTIVE_SQL,
  GORUS_AYRILIGI,
  groundIsUrgent,
  groundLabel,
  isVotingStatus,
  jsonList,
  safe,
  type ForumCore,
  type MessageRow,
  type ProposalRow,
  type TopicRow,
} from "./util";

const ROLE_ORDER: Role[] = ["member", "registrar", "auditor", "admin"];

export function parseRoles(raw: string | null | undefined): Role[] {
  const arr = json<unknown[]>(raw ?? null, []);
  const set = new Set<Role>(["member"]);
  for (const r of arr) if (typeof r === "string" && (ROLE_ORDER as string[]).includes(r)) set.add(r as Role);
  return ROLE_ORDER.filter((r) => set.has(r));
}

// ───────────── Kullanıcılar ─────────────

interface PublicUserRow {
  id: string;
  nickname: string;
  status: string;
  roles: string;
  reputation: number;
  created_at: number;
}

/** users satırlarından PublicUser (bilirkişi bilgisiyle; tek sorgu). Kişisel veri yok. */
export function publicUsers(core: ForumCore, rows: PublicUserRow[]): PublicUser[] {
  if (rows.length === 0) return [];
  const experts = new Map(
    core.db
      .all<{ user_id: string; status: string; domains: string }>(
        "SELECT user_id, status, domains FROM experts WHERE user_id IN (SELECT value FROM json_each(?))",
        jsonList(rows.map((r) => r.id)),
      )
      .map((e) => [e.user_id, e] as const),
  );
  return rows.map((r) => {
    const e = experts.get(r.id);
    const active = e?.status === "active";
    return {
      id: r.id,
      nickname: r.nickname,
      status: r.status as UserStatus,
      roles: parseRoles(r.roles),
      isExpert: active,
      expertDomains: active ? json<string[]>(e!.domains, []) : [],
      reputation: Number(r.reputation ?? 0),
      joinedAt: publicJoinDay(Number(r.created_at)), // güne yuvarlanır (defterle zaman eşleştirmesine karşı)
    };
  });
}

export function publicUsersByIds(core: ForumCore, ids: string[]): PublicUser[] {
  if (ids.length === 0) return [];
  const rows = core.db.all<PublicUserRow>(
    "SELECT id, nickname, status, roles, reputation, created_at FROM users WHERE id IN (SELECT value FROM json_each(?))",
    jsonList(ids),
  );
  const byId = new Map(publicUsers(core, rows).map((u) => [u.id, u] as const));
  return ids.map((id) => byId.get(id)).filter((u): u is PublicUser => !!u);
}

// ───────────── Öneri özetleri ─────────────

/** ProposalSummary için gereken sütunlar (gövde ve denetim raporu hariç; K_s json_extract ile). */
export const SUMMARY_COLUMNS = `p.id, p.seq, p.kind, p.title, p.status, p.tier, p.author_id, p.categories, p.parent_topic_id,
  p.created_at, p.phase_ends_at, p.voting_round, p.eligible_count, p.updated_at,
  json_extract(p.audit_report, '$.params.sponsorsRequired') AS ks`;

export interface SummaryRow {
  id: string;
  seq: number;
  kind: ProposalRow["kind"];
  title: string;
  status: ProposalRow["status"];
  tier: string | null;
  author_id: string;
  categories: string;
  parent_topic_id: string | null;
  created_at: number;
  phase_ends_at: number | null;
  voting_round: number;
  eligible_count: number | null;
  updated_at: number;
  ks: number | null;
}

export function summaryRowOf(p: ProposalRow): SummaryRow {
  const ks = json<{ params?: { sponsorsRequired?: number } | null } | null>(p.audit_report, null)?.params?.sponsorsRequired ?? null;
  return {
    id: p.id,
    seq: p.seq,
    kind: p.kind,
    title: p.title,
    status: p.status,
    tier: p.tier,
    author_id: p.author_id,
    categories: p.categories,
    parent_topic_id: p.parent_topic_id,
    created_at: p.created_at,
    phase_ends_at: p.phase_ends_at,
    voting_round: p.voting_round,
    eligible_count: p.eligible_count,
    updated_at: p.updated_at,
    ks,
  };
}

/** K_s: denetim raporundaki değer, yoksa güncel doğrulanmış üye sayısından. */
export function sponsorsNeeded(core: ForumCore, row: { ks: number | null; tier: string | null; kind: string }, verified?: number): number {
  if (row.ks !== null && row.ks !== undefined && Number(row.ks) > 0) return Number(row.ks);
  const tier = row.kind === "deletion" ? "DEL" : row.tier;
  return sponsorsRequired(verified ?? core.verifiedCount(), tier);
}

/** Satırlar → ProposalSummary[] (sıra korunur). Toplu: takma adlar, destekçi/mesaj sayıları, katılım, bütünlük uyarısı sayısı. */
export function proposalSummaries(core: ForumCore, rows: SummaryRow[]): ProposalSummary[] {
  if (rows.length === 0) return [];
  const ids = jsonList(rows.map((r) => r.id));
  const nick = core.nicknames(rows.map((r) => r.author_id));
  const sponsors = new Map(
    core.db
      .all<{ proposal_id: string; c: number }>(
        "SELECT proposal_id, COUNT(*) AS c FROM proposal_sponsors WHERE proposal_id IN (SELECT value FROM json_each(?)) GROUP BY proposal_id",
        ids,
      )
      .map((r) => [r.proposal_id, Number(r.c)] as const),
  );
  const messages = new Map(
    core.db
      .all<{ thread_id: string; c: number }>(
        "SELECT thread_id, COUNT(*) AS c FROM messages WHERE thread_type = 'proposal' AND thread_id IN (SELECT value FROM json_each(?)) GROUP BY thread_id",
        ids,
      )
      .map((r) => [r.thread_id, Number(r.c)] as const),
  );
  const voting = rows.filter((r) => isVotingStatus(r.status));
  const ballots = new Map<string, number>();
  if (voting.length > 0) {
    for (const r of core.db.all<{ proposal_id: string; round: number; c: number }>(
      "SELECT proposal_id, round, COUNT(*) AS c FROM ballots WHERE proposal_id IN (SELECT value FROM json_each(?)) GROUP BY proposal_id, round",
      jsonList(voting.map((v) => v.id)),
    )) {
      ballots.set(`${r.proposal_id}|${r.round}`, Number(r.c));
    }
  }
  const verified = rows.some((r) => !(Number(r.ks) > 0)) ? core.verifiedCount() : 0;
  const integrity = integrityWarningCounts(core, rows.map((r) => r.id));
  return rows.map((r) => ({
    id: r.id,
    seq: Number(r.seq),
    kind: r.kind,
    title: r.title,
    status: r.status,
    tier: (r.tier as Tier | null) ?? null,
    authorId: r.author_id,
    authorNickname: nick.get(r.author_id) ?? "",
    categories: json<string[]>(r.categories, []),
    parentTopicId: r.parent_topic_id,
    createdAt: Number(r.created_at),
    phaseEndsAt: r.phase_ends_at === null ? null : Number(r.phase_ends_at),
    sponsorCount: sponsors.get(r.id) ?? 0,
    sponsorsRequired: sponsorsNeeded(core, r, verified),
    messageCount: messages.get(r.id) ?? 0,
    participation: isVotingStatus(r.status)
      ? { voted: ballots.get(`${r.id}|${r.voting_round}`) ?? 0, eligible: Number(r.eligible_count ?? 0) }
      : null,
    integrityWarningCount: integrity.get(r.id) ?? 0,
  }));
}

/** WHERE koşuluyla öneri özetleri (sıralama ve sınır çağırandan). */
export function querySummaries(core: ForumCore, where: string, params: (string | number | null)[], tail = "ORDER BY p.seq DESC"): ProposalSummary[] {
  const rows = core.db.all<SummaryRow>(`SELECT ${SUMMARY_COLUMNS} FROM proposals p ${where ? `WHERE ${where}` : ""} ${tail}`, ...params);
  return proposalSummaries(core, rows);
}

// ───────────── Konular ─────────────

export function topicSummaries(core: ForumCore, rows: TopicRow[]): TopicSummary[] {
  if (rows.length === 0) return [];
  const ids = jsonList(rows.map((r) => r.id));
  const children = new Map(
    core.db
      .all<{ parent_id: string; c: number }>(
        "SELECT parent_id, COUNT(*) AS c FROM topics WHERE parent_id IN (SELECT value FROM json_each(?)) GROUP BY parent_id",
        ids,
      )
      .map((r) => [r.parent_id, Number(r.c)] as const),
  );
  const messages = new Map(
    core.db
      .all<{ thread_id: string; c: number }>(
        "SELECT thread_id, COUNT(*) AS c FROM messages WHERE thread_type = 'topic' AND thread_id IN (SELECT value FROM json_each(?)) GROUP BY thread_id",
        ids,
      )
      .map((r) => [r.thread_id, Number(r.c)] as const),
  );
  const open = new Map(
    core.db
      .all<{ parent_topic_id: string; c: number }>(
        `SELECT parent_topic_id, COUNT(*) AS c FROM proposals WHERE status IN ${ACTIVE_SQL}
           AND parent_topic_id IN (SELECT value FROM json_each(?)) GROUP BY parent_topic_id`,
        ids,
      )
      .map((r) => [r.parent_topic_id, Number(r.c)] as const),
  );
  return rows.map((t) => ({
    id: t.id,
    seq: Number(t.seq),
    parentId: t.parent_id,
    title: t.title,
    categories: json<string[]>(t.categories, []),
    version: Number(t.current_version),
    status: t.status,
    createdAt: Number(t.created_at),
    updatedAt: Number(t.updated_at),
    childCount: children.get(t.id) ?? 0,
    messageCount: messages.get(t.id) ?? 0,
    openProposalCount: open.get(t.id) ?? 0,
  }));
}

// ───────────── Mesajlar ─────────────

/** Son küme anlık görüntüsünün köprü skoru için gereken kısmı. */
export interface BridgeContext {
  assignments: Record<string, string>;
  significant: Set<string>;
}

/** Anlamlı küme kuralının iki parametresi (σ_share, σ_min): `DecisionParams`'ın ilgili alt kümesi. */
export type SignificanceParams = Pick<DecisionParams, "significantShare" | "significantMinMembers">;

/**
 * Anlamlı küme kuralının YÜRÜRLÜKTEKİ parametreleri: yönetmeliğin genel parametreleri (`fy:GenelParametreler`; yama kabul
 * edilince hemen değişir). Ontoloji denetimi de `significantShare`/`significantMinMembers` değerlerini aynı kaynaktan alır.
 * Okunamazsa ya da değer geçersizse kurucu yönetmeliğin varsayılanları (`defaultDecisionParams`) kullanılır; böylece kural
 * hiçbir yerde sabit (1/10, 3) yazılmaz ve görünümler sayımla ayrışmaz.
 */
export function inForceSignificance(core: ForumCore): SignificanceParams {
  const fallback = defaultDecisionParams("T0");
  const general = fy("GenelParametreler");
  const params = safe(() => core.deps.ontology.adjustableParams(), []);
  const num = (name: string): number | null => {
    const v = params.find((p) => p.rule === general && p.param === name)?.value;
    return typeof v === "number" && Number.isFinite(v) && v >= 0 ? v : null;
  };
  const share = num("anlamliKumePayi");
  const min = num("anlamliKumeAsgariUye");
  return {
    significantShare: share !== null ? toRational(share) : fallback.significantShare,
    significantMinMembers: min ?? fallback.significantMinMembers,
  };
}

/** Önerinin kendi (denetimde/oylama açılışında belirlenen) parametreleri varsa onlar; yoksa yürürlükteki yönetmeliğin değerleri. */
export function significanceFor(core: ForumCore, params: SignificanceParams | null | undefined): SignificanceParams {
  return params ?? inForceSignificance(core);
}

export function bridgeContext(core: ForumCore): BridgeContext | null {
  const s = core.db.get<{ assignments: string; sizes: string; clustered_total: number; k: number }>(
    "SELECT assignments, sizes, clustered_total, k FROM cluster_snapshots ORDER BY created_at DESC, rowid DESC LIMIT 1",
  );
  if (!s) return null;
  const sizes = json<Record<string, number>>(s.sizes, {});
  const total = Number(s.clustered_total);
  const rule = inForceSignificance(core);
  const significant = new Set(Object.keys(sizes).filter((g) => isSignificant(sizes[g], total, rule)));
  if (significant.size < 2) return null;
  return { assignments: json<Record<string, string>>(s.assignments, {}), significant };
}

/** Satırlar → MessageView[] (sıra korunur). Toplu: takma adlar, destekler, cevaplar, mezar taşları, bekleyen silme talepleri. */
export function messageViews(core: ForumCore, rows: MessageRow[], viewerId: string | null): MessageView[] {
  if (rows.length === 0) return [];
  const ids = jsonList(rows.map((r) => r.id));
  const nick = core.nicknames(rows.map((r) => r.author_id));

  const endorsements = new Map<string, { user_id: string; value: number }[]>();
  for (const e of core.db.all<{ message_id: string; user_id: string; value: number }>(
    "SELECT message_id, user_id, value FROM message_endorsements WHERE value <> 0 AND message_id IN (SELECT value FROM json_each(?))",
    ids,
  )) {
    const list = endorsements.get(e.message_id) ?? [];
    list.push({ user_id: e.user_id, value: Number(e.value) });
    endorsements.set(e.message_id, list);
  }
  const rebuttals = new Map(
    core.db
      .all<{ message_id: string; body: string; created_at: number }>(
        "SELECT message_id, body, created_at FROM message_rebuttals WHERE message_id IN (SELECT value FROM json_each(?))",
        ids,
      )
      .map((r) => [r.message_id, r] as const),
  );
  const hiddenBy = rows.map((r) => r.hidden_by_proposal_id).filter((x): x is string => !!x);
  const seqOf = new Map<string, number>();
  if (hiddenBy.length > 0) {
    for (const r of core.db.all<{ id: string; seq: number }>("SELECT id, seq FROM proposals WHERE id IN (SELECT value FROM json_each(?))", jsonList(hiddenBy))) {
      seqOf.set(r.id, Number(r.seq));
    }
  }
  const pending = pendingDeletionMap(core);
  const bridge = bridgeContext(core);

  return rows.map((m) => {
    const ends = endorsements.get(m.id) ?? [];
    let agree = 0;
    let disagree = 0;
    let mine: -1 | 0 | 1 = 0;
    for (const e of ends) {
      if (e.value > 0) agree++;
      else disagree++;
      if (viewerId && e.user_id === viewerId) mine = e.value > 0 ? 1 : -1;
    }
    let bridgingScore: number | null = null;
    if (bridge) {
      const per = new Map<string, { a: number; d: number }>([...bridge.significant].map((g) => [g, { a: 0, d: 0 }]));
      for (const e of ends) {
        const g = bridge.assignments[e.user_id];
        const c = g ? per.get(g) : undefined;
        if (!c) continue;
        if (e.value > 0) c.a++;
        else c.d++;
      }
      let min = Infinity;
      for (const c of per.values()) min = Math.min(min, (1 + c.a) / (2 + c.a + c.d));
      bridgingScore = Number.isFinite(min) ? Math.round(min * 10000) / 10000 : null;
    }
    const hidden = m.visibility === "hidden" || m.visibility === "sealed";
    const flags = json<{ risk?: number; labels?: string[] } | null>(m.ai_flags, null);
    const reb = rebuttals.get(m.id);
    const seq = m.hidden_by_proposal_id ? seqOf.get(m.hidden_by_proposal_id) : undefined;
    return {
      id: m.id,
      seq: Number(m.seq),
      threadType: m.thread_type,
      threadId: m.thread_id,
      parentId: m.parent_id,
      authorId: m.author_id,
      authorNickname: nick.get(m.author_id) ?? "",
      stance: m.stance as Stance,
      body: hidden ? null : m.body,
      version: Number(m.version),
      visibility: m.visibility,
      tombstone: hidden ? `[#K-${seq ?? "?"} kararıyla gizlendi — gerekçe: ${groundLabel(core.deps, m.hidden_ground)}]` : null,
      hiddenByProposalId: m.hidden_by_proposal_id,
      rebuttal: reb ? { body: reb.body, at: Number(reb.created_at) } : null,
      aiFlag: flags && Number(flags.risk ?? 0) >= 1 ? { risk: Number(flags.risk), labels: flags.labels ?? [] } : null,
      endorsements: { agree, disagree, mine },
      bridgingScore,
      createdAt: Number(m.created_at),
      updatedAt: Number(m.updated_at),
      contentHash: m.content_hash,
      ledgerTx: m.ledger_tx,
      pendingDeletionProposalId: hidden ? null : (pending.get(m.id) ?? null),
    };
  });
}

/**
 * Açık (taslak dışı, kapanmamış) silme taleplerinin hedeflediği mesajlar: messageId → proposalId. Bir mesajı birden çok talep
 * hedefliyorsa öncelik: daraltmanın nedeni olan acil talep, sonra geçerli olağan talep, en son geçersiz ("Görüş ayrılığı" ya da
 * denetimde aykırı) talep; eşitlikte en eski talep.
 */
export function pendingDeletionMap(core: ForumCore): Map<string, string> {
  const out = new Map<string, { id: string; rank: number }>();
  for (const r of core.db.all<{ id: string; tier: string | null; deletion_payload: string | null; audit_report: string | null }>(
    `SELECT id, tier, deletion_payload, audit_report FROM proposals WHERE kind = 'deletion' AND status IN ${ACTIVE_SQL} ORDER BY seq`,
  )) {
    const d = json<{ messageIds?: string[]; ground?: string }>(r.deletion_payload, {});
    const invalid = d.ground === GORUS_AYRILIGI || r.tier === "T3" || json<{ admissible?: boolean }>(r.audit_report, {}).admissible === false;
    const rank = invalid ? 0 : d.ground && groundIsUrgent(core.deps, d.ground) ? 2 : 1;
    for (const mid of d.messageIds ?? []) {
      const cur = out.get(mid);
      if (!cur || rank > cur.rank) out.set(mid, { id: r.id, rank });
    }
  }
  return new Map([...out].map(([mid, v]) => [mid, v.id]));
}

export { clusterLabel };
