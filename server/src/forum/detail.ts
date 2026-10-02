// ProposalDetail birleştirme. Oylama sürerken sonuç SIZMAZ: results[] yalnız kesin (interim=0) turları içerir.
import type {
  BallotReceipt,
  DecisionResult,
  MinorityReport,
  ObjectionInfo,
  PhaseEvent,
  ProposalDetail,
  ProposalStatus,
  ProposalVersion,
  RevealEntry,
  Suggestion,
  VoteChoice,
} from "@forum/shared";
import type { Viewer } from "../core/forum-contracts";
import { notFound } from "../core/errors";
import { json } from "../db";
import type { ClusterServiceImpl } from "./clusters";
import { integrityWarnings } from "./integrity";
import { objectionBudgetOf } from "./objection-budget";
import { evaluateObjections, finalTallies, firstRoundChoice } from "./tally";
import { isVotingStatus, parseProposal, safe, type BallotRow, type ForumCore, type ProposalRow } from "./util";
import { proposalSummaries, summaryRowOf } from "./views";

export function receiptOf(b: BallotRow): BallotReceipt {
  return {
    proposalId: b.proposal_id,
    round: (Number(b.round) === 2 ? 2 : 1) as 1 | 2,
    ballotId: b.ballot_id,
    choice: b.choice,
    salt: b.salt,
    commitment: b.commitment,
    txHash: b.ledger_tx,
    castAt: Number(b.updated_at),
  };
}

/** Taslak yalnız yazarına görünür; diğerlerine 404. */
export function visibleProposal(core: ForumCore, id: string, viewer: Viewer): ProposalRow {
  const p = core.proposalRow(id);
  if (!p || (p.status === "draft" && p.author_id !== viewer?.id)) throw notFound("Öneri");
  return p;
}

export function buildProposalDetail(core: ForumCore, clusters: ClusterServiceImpl, p: ProposalRow, viewer: Viewer): ProposalDetail {
  const { db, deps } = core;
  const parsed = parseProposal(p);
  const now = core.now();
  const [summary] = proposalSummaries(core, [summaryRowOf(p)]);

  const versionRows = db.all<{ version: number; title: string; body: string; author_id: string; via_suggestion_id: string | null; content_hash: string; created_at: number }>(
    "SELECT version, title, body, author_id, via_suggestion_id, content_hash, created_at FROM proposal_versions WHERE proposal_id = ? ORDER BY version ASC",
    p.id,
  );
  const sponsorRows = db.all<{ user_id: string; at: number }>("SELECT user_id, at FROM proposal_sponsors WHERE proposal_id = ? ORDER BY at ASC, rowid ASC", p.id);
  const eventRows = db.all<{ from_status: string | null; to_status: string; at: number; reason: string; ledger_tx: string | null }>(
    "SELECT from_status, to_status, at, reason, ledger_tx FROM phase_events WHERE proposal_id = ? ORDER BY at ASC, rowid ASC",
    p.id,
  );
  const suggestionRows = db.all<{ id: string; author_id: string; body: string; status: string; created_at: number; decided_at: number | null }>(
    "SELECT id, author_id, body, status, created_at, decided_at FROM proposal_suggestions WHERE proposal_id = ? ORDER BY created_at ASC, rowid ASC",
    p.id,
  );
  const objectionRows = db.all<{ id: string; user_id: string; ground: string; statement: string; cluster_id: string | null; at: number }>(
    "SELECT id, user_id, ground, statement, cluster_id, at FROM objections WHERE proposal_id = ? ORDER BY at ASC, rowid ASC",
    p.id,
  );
  const reportRows = db.all<{ id: string; author_id: string; cluster_id: string | null; body: string; created_at: number }>(
    "SELECT id, author_id, cluster_id, body, created_at FROM minority_reports WHERE proposal_id = ? ORDER BY created_at ASC, rowid ASC",
    p.id,
  );
  const tallies = finalTallies(core, p.id);
  const nick = core.nicknames([
    ...versionRows.map((r) => r.author_id),
    ...sponsorRows.map((r) => r.user_id),
    ...suggestionRows.map((r) => r.author_id),
    ...objectionRows.map((r) => r.user_id),
    ...reportRows.map((r) => r.author_id),
    ...tallies.flatMap((t) => Object.values(json<Record<string, string>>(t.delegation_trace, {}))),
  ]);

  const versions: ProposalVersion[] = versionRows.map((v) => ({
    version: Number(v.version),
    title: v.title,
    body: v.body,
    createdAt: Number(v.created_at),
    authorId: v.author_id,
    authorNickname: nick.get(v.author_id) ?? "",
    viaSuggestionId: v.via_suggestion_id,
    contentHash: v.content_hash,
  }));
  const events: PhaseEvent[] = eventRows.map((e) => ({
    from: (e.from_status as ProposalStatus | null) ?? null,
    to: e.to_status as ProposalStatus,
    at: Number(e.at),
    reason: e.reason,
    ledgerTx: e.ledger_tx,
  }));
  const suggestions: Suggestion[] = suggestionRows.map((s) => ({
    id: s.id,
    proposalId: p.id,
    authorId: s.author_id,
    authorNickname: nick.get(s.author_id) ?? "",
    body: s.body,
    // Eski veritabanlarında evre kapanırken "open" kalmış satırlar da "karar verilmeden kapandı" olarak gösterilir.
    status: (s.status === "open" && p.status !== "deliberation" && p.status !== "reconciliation" ? "lapsed" : s.status) as Suggestion["status"],
    createdAt: Number(s.created_at),
    decidedAt: s.decided_at === null ? null : Number(s.decided_at),
  }));
  // Oy gizliliği: itiraz imzacısı tur-1'de zorunlu olarak "red" oyu vermiştir; kimliği yalnız kendisine gösterilir.
  const objections: ObjectionInfo[] = objectionRows.map((o) => ({
    id: o.id,
    userId: o.user_id === viewer?.id ? o.user_id : "",
    nickname: o.user_id === viewer?.id ? (nick.get(o.user_id) ?? "") : "Anonim imzacı",
    ground: o.ground,
    statement: o.statement,
    clusterId: o.cluster_id,
    at: Number(o.at),
  }));
  const minorityReports: MinorityReport[] = reportRows.map((r) => ({
    id: r.id,
    proposalId: p.id,
    authorId: r.author_id,
    authorNickname: nick.get(r.author_id) ?? "",
    clusterId: r.cluster_id,
    body: r.body,
    createdAt: Number(r.created_at),
  }));
  const results: DecisionResult[] = tallies
    .map((t) => json<DecisionResult>(t.result, null as unknown as DecisionResult))
    .filter(Boolean)
    // Eski kayıtlarda DEL yazar satırı grubu adıyla anıyordu; artık anmaz (KVKK.md §4.3). Sayım değeri değişmez.
    .map((r) => ({ ...r, checks: (r.checks ?? []).map((c) => (c.key === "author_cluster" ? { ...c, label: "Mesaj yazarının kendi görüş grubu" } : c)) }));

  // ── Görüntüleyene özel ──
  let myBallot: ProposalDetail["myBallot"] = null;
  let myEffectiveVia: ProposalDetail["myEffectiveVia"] = null;
  let canVote = false;
  let canObject = false;
  let canWriteMinorityReport = false;
  if (viewer) {
    const eligible = !!db.get("SELECT 1 FROM eligible_voters WHERE proposal_id = ? AND user_id = ?", p.id, viewer.id);
    const me = core.user(viewer.id);
    const active = me?.status === "verified";
    if (p.voting_round > 0) {
      const b = db.get<BallotRow>("SELECT * FROM ballots WHERE proposal_id = ? AND round = ? AND user_id = ?", p.id, p.voting_round, viewer.id);
      if (b) myBallot = { choice: b.choice, receipt: receiptOf(b) };
    }
    canVote =
      eligible && active && me?.political_consent === 1 && isVotingStatus(p.status) && p.phase_ends_at !== null && now < p.phase_ends_at;
    const last = tallies[tallies.length - 1];
    if (last) {
      const hasDirect = !!db.get("SELECT 1 FROM ballots WHERE proposal_id = ? AND round = ? AND user_id = ?", p.id, last.round, viewer.id);
      const delegate = json<Record<string, string>>(last.delegation_trace, {})[viewer.id];
      if (!hasDirect && delegate) {
        const bid = core.ballotId(viewer.id, p.id, Number(last.round));
        const mine = json<RevealEntry[]>(last.reveal_payload, []).find((r) => r.ballotId === bid && r.via === "delegated");
        if (mine) myEffectiveVia = { delegateNickname: nick.get(delegate) ?? "", choice: mine.choice as VoteChoice };
      }
    }
    if (p.status === "objection_window" && eligible && active && p.phase_ends_at !== null && now < p.phase_ends_at) {
      const t1 = tallies.find((t) => Number(t.round) === 1);
      const bid = core.ballotId(viewer.id, p.id, 1);
      const first = json<RevealEntry[]>(t1?.reveal_payload ?? null, []).find((r) => r.ballotId === bid);
      // ProposalService.object() ile aynı kural: 30 günlük itiraz imza bütçesi de dahil (tek kaynak: objection-budget.ts).
      canObject =
        first?.choice === "no" &&
        !objectionRows.some((o) => o.user_id === viewer.id) &&
        me?.political_consent === 1 &&
        !objectionBudgetOf(db, viewer.id, now).exhausted;
    }
    // ProposalService.minorityReport ile aynı koşullar: evre, güncel seçmen koşulları, tur-1 ETKİN oyu "red" (vekâletle dahil), tek rapor.
    if ((p.status === "reconciliation" || p.status === "objection_window") && eligible && active && me?.political_consent === 1) {
      const t1 = tallies.find((t) => Number(t.round) === 1);
      canWriteMinorityReport =
        firstRoundChoice(core, p, viewer.id, json<RevealEntry[]>(t1?.reveal_payload ?? null, [])) === "no" &&
        !reportRows.some((r) => r.author_id === viewer.id);
    }
  }

  const showEvaluation = p.status === "objection_window" || objectionRows.length > 0;
  const parentTopic = p.parent_topic_id
    ? (db.get<{ id: string; title: string }>("SELECT id, title FROM topics WHERE id = ?", p.parent_topic_id) ?? null)
    : null;

  return {
    ...summary,
    body: p.body,
    version: Number(p.version),
    versions,
    amendment: parsed.amendment,
    deletion: parsed.deletion,
    regulationPatch: parsed.patch,
    audit: parsed.audit,
    params: parsed.fixedParams ?? parsed.audit?.params ?? null,
    phaseStartedAt: p.phase_started_at === null ? null : Number(p.phase_started_at),
    votingRound: (Number(p.voting_round) as 0 | 1 | 2) ?? 0,
    reconciliationOrigin: p.reconciliation_origin,
    extensionUsed: p.extension_used === 1,
    sponsors: sponsorRows.map((s) => ({ userId: s.user_id, nickname: nick.get(s.user_id) ?? "", at: Number(s.at) })),
    events,
    suggestions,
    results,
    objections,
    objectionEvaluation: showEvaluation ? evaluateObjections(core, clusters, p) : null,
    minorityReports,
    expertQuestions: db
      .all<{ id: string; author_id: string; body: string; minority_guaranteed: number; created_at: number }>(
        "SELECT id, author_id, body, minority_guaranteed, created_at FROM expert_questions WHERE proposal_id = ? ORDER BY created_at, rowid",
        p.id,
      )
      .map((q) => ({
        id: q.id,
        proposalId: p.id,
        authorId: q.author_id,
        authorNickname: nick.get(q.author_id) ?? core.nicknames([q.author_id]).get(q.author_id) ?? "",
        body: q.body,
        minorityGuaranteed: q.minority_guaranteed === 1,
        createdAt: Number(q.created_at),
      })),
    expertPanel: safe(() => deps.experts.panel(p.id, viewer?.status === "verified" ? viewer : null), null),
    aiAnalyses: safe(() => deps.aiSink.list("proposal", p.id), []),
    myBallot,
    myEffectiveVia,
    canVote,
    canObject,
    canWriteMinorityReport,
    rightsFlags: parsed.rightsFlags.map((f) => ({ right: f.right, direction: f.direction, source: f.source })),
    integrityWarnings: safe(() => integrityWarnings(core, p.id, viewer), []),
    parentTopic: parentTopic ? { id: parentTopic.id, title: parentTopic.title } : null,
    enactedEntityId: p.enacted_entity_id,
    ledgerTxs: safe(
      () =>
        deps.ledger
          .findTxs({ proposalId: p.id, limit: 1000 })
          .filter((t) => t.payload.proposalId === p.id)
          .sort((a, b) => a.height - b.height || a.index - b.index)
          .map((t) => ({ type: t.type, txHash: t.hash, at: Number(t.blockTime) })),
      [],
    ),
  };
}
