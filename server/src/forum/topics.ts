// Konular: yürürlükteki konu ağacı ve sürüm geçmişi. Konular yalnızca kabul edilen önerilerle oluşur/değişir.
import type { TopicDetail, TopicRevision, TopicSummary } from "@forum/shared";
import { conflict, notFound, unprocessable } from "../core/errors";
import type { TopicService, Viewer } from "../core/forum-contracts";
import { newId } from "../core/ids";
import { isSavedBy } from "./detail";
import { ACTIVE_SQL, textHash, type ForumCore, type TopicRow } from "./util";
import { querySummaries, topicSummaries } from "./views";

export function createTopicService(core: ForumCore): TopicService {
  const { db } = core;

  function row(id: string): TopicRow | undefined {
    return db.get<TopicRow>("SELECT * FROM topics WHERE id = ?", id);
  }

  return {
    list(): TopicSummary[] {
      return topicSummaries(core, db.all<TopicRow>("SELECT * FROM topics ORDER BY seq ASC"));
    },

    get(id: string, viewer: Viewer): TopicDetail {
      const t = row(id);
      if (!t) throw notFound("Konu");
      const [summary] = topicSummaries(core, [t]);
      const revisions: TopicRevision[] = db
        .all<{ version: number; title: string; body: string; via_proposal_id: string | null; created_at: number; content_hash: string }>(
          "SELECT version, title, body, via_proposal_id, created_at, content_hash FROM topic_revisions WHERE topic_id = ? ORDER BY version ASC",
          id,
        )
        .map((r) => ({
          version: Number(r.version),
          title: r.title,
          body: r.body,
          viaProposalId: r.via_proposal_id,
          createdAt: Number(r.created_at),
          contentHash: r.content_hash,
        }));
      const children = topicSummaries(core, db.all<TopicRow>("SELECT * FROM topics WHERE parent_id = ? ORDER BY seq ASC", id));
      const ancestors: { id: string; title: string }[] = [];
      const seen = new Set<string>([id]);
      let parent = t.parent_id;
      while (parent && !seen.has(parent)) {
        seen.add(parent);
        const pr = db.get<{ id: string; title: string; parent_id: string | null }>("SELECT id, title, parent_id FROM topics WHERE id = ?", parent);
        if (!pr) break;
        ancestors.unshift({ id: pr.id, title: pr.title });
        parent = pr.parent_id;
      }
      const viewerId = viewer?.id ?? null;
      const openProposals = querySummaries(
        core,
        `p.parent_topic_id = ? AND (p.status IN ${ACTIVE_SQL} OR (p.status = 'draft' AND p.author_id = ?))`,
        [id, viewerId],
      );
      return {
        ...summary,
        body: t.body,
        originProposalId: t.origin_proposal_id,
        revisions,
        children,
        ancestors,
        openProposals,
        ...(viewerId ? { saved: isSavedBy(core, viewerId, "topic", id) } : {}),
      };
    },

    createFromProposal(proposalId: string) {
      const p = core.requireProposal(proposalId);
      if (p.kind !== "topic" && p.kind !== "subtopic") throw unprocessable("invalid_kind", "Yalnızca konu ve alt konu önerileri yeni konu oluşturur.");
      const existing = db.get<{ id: string; ledger_tx: string | null }>(
        "SELECT t.id, r.ledger_tx FROM topics t LEFT JOIN topic_revisions r ON r.topic_id = t.id AND r.version = 1 WHERE t.origin_proposal_id = ?",
        proposalId,
      );
      if (existing) return { topicId: existing.id, txHash: existing.ledger_tx ?? "" };
      if (p.kind === "subtopic") {
        const parent = p.parent_topic_id ? row(p.parent_topic_id) : undefined;
        if (!parent || parent.status !== "active") throw conflict("invalid_state", "Üst konu yürürlükte değil.");
      }
      return core.tx(() => {
        const now = core.now();
        const id = newId();
        const seq = db.nextSeq("topics");
        const hash = textHash(p.title, p.body);
        db.run(
          `INSERT INTO topics(id, seq, parent_id, title, body, categories, origin_proposal_id, current_version, status, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, 1, 'active', ?, ?)`,
          id,
          seq,
          p.kind === "subtopic" ? p.parent_topic_id : null,
          p.title,
          p.body,
          p.categories,
          proposalId,
          now,
          now,
        );
        db.run(
          "INSERT INTO topic_revisions(topic_id, version, title, body, via_proposal_id, content_hash, created_at) VALUES (?, 1, ?, ?, ?, ?, ?)",
          id,
          p.title,
          p.body,
          proposalId,
          hash,
          now,
        );
        const txHash = core.submit("TOPIC_REVISION", { topicId: id, version: 1, contentHash: hash, proposalId });
        db.run("UPDATE topic_revisions SET ledger_tx = ? WHERE topic_id = ? AND version = 1", txHash, id);
        return { topicId: id, txHash };
      });
    },

    reviseFromProposal(proposalId: string) {
      const p = core.requireProposal(proposalId);
      if (p.kind !== "amendment") throw unprocessable("invalid_kind", "Yalnızca düzenleme teklifleri konuyu değiştirir.");
      const t = p.parent_topic_id ? row(p.parent_topic_id) : undefined;
      if (!t) throw notFound("Hedef konu");
      const done = db.get<{ version: number; ledger_tx: string | null }>(
        "SELECT version, ledger_tx FROM topic_revisions WHERE topic_id = ? AND via_proposal_id = ?",
        t.id,
        proposalId,
      );
      if (done) return { topicId: t.id, version: Number(done.version), txHash: done.ledger_tx ?? "" };
      const payload = JSON.parse(p.amendment_payload ?? "{}") as { baseVersion?: number };
      const current = Number(t.current_version);
      if (payload.baseVersion !== current) return { conflict: true as const, currentVersion: current };
      return core.tx(() => {
        const now = core.now();
        const version = current + 1;
        const hash = textHash(p.title, p.body);
        db.run(
          "INSERT INTO topic_revisions(topic_id, version, title, body, via_proposal_id, content_hash, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)",
          t.id,
          version,
          p.title,
          p.body,
          proposalId,
          hash,
          now,
        );
        const r = db.run(
          "UPDATE topics SET title = ?, body = ?, current_version = ?, updated_at = ? WHERE id = ? AND current_version = ?",
          p.title,
          p.body,
          version,
          now,
          t.id,
          current,
        );
        if (r.changes !== 1) throw conflict("version_conflict", "Konu aynı anda değişti; tekrar deneyin.");
        const txHash = core.submit("TOPIC_REVISION", { topicId: t.id, version, contentHash: hash, proposalId });
        db.run("UPDATE topic_revisions SET ledger_tx = ? WHERE topic_id = ? AND version = ?", txHash, t.id, version);
        return { topicId: t.id, version, txHash };
      });
    },
  };
}
