// Tartışma: mesajlar ASLA fiziksel olarak silinmez. Silme = karartma (hidden/sealed + mezar taşı); sürümler saklanır.
import { aiLabel, contentHash, type HiddenMessageResponse, type MessagePrecheckResponse, type MessageVersionView, type MessageView, type PostMessageRequest, type ThreadType } from "@forum/shared";
import { z } from "zod";
import type { AuthUser, ModerationResult } from "../core/contracts";
import { badRequest, conflict, forbidden, notFound, unprocessable } from "../core/errors";
import type { MessageService, Viewer } from "../core/forum-contracts";
import { newId, newSalt } from "../core/ids";
import {
  ACTIVE_SQL,
  checkLength,
  fieldError,
  groundIsUrgent,
  hasRole,
  jsonList,
  parseInput,
  proposalLink,
  proposalRef,
  requireVerified,
  stanceSchema,
  topicLink,
  type ForumCore,
  type MessageRow,
} from "./util";
import { messageViews } from "./views";

const postSchema = z.object({
  body: z.string().max(20000),
  stance: stanceSchema.default("neutral"),
  parentId: z.string().max(200).nullish(),
  acknowledgePii: z.boolean().optional(),
});

export function moderationContext(core: ForumCore) {
  const o = core.deps.ontology;
  return {
    articles: o.articles().map((a) => ({ iri: a.iri, number: a.number, title: a.title })),
    contentLabels: o.contentLabels(),
  };
}

/** Kişisel veri bulgusu → 422 pii_detected (acknowledgePii yoksa). */
export function assertNoPii(core: ForumCore, text: string, acknowledged: boolean | undefined): void {
  const pii = core.deps.ai.detectPii(text);
  if (pii.length > 0 && !acknowledged) {
    throw unprocessable(
      "pii_detected",
      "Metinde kişisel veri olabilecek ifadeler bulundu (ör. T.C. kimlik no, telefon, e-posta, IBAN, adres). Lütfen kaldırın ya da bilerek paylaştığınızı onaylayın.",
      { pii: pii.map((f) => ({ kind: f.kind, start: f.start, end: f.end, masked: f.masked })) },
    );
  }
}

export function createMessageService(core: ForumCore): MessageService {
  const { db, deps } = core;

  function row(id: string): MessageRow | undefined {
    return db.get<MessageRow>("SELECT * FROM messages WHERE id = ?", id);
  }
  function requireRow(id: string): MessageRow {
    const m = row(id);
    if (!m) throw notFound("Mesaj");
    return m;
  }
  function view(id: string, viewer: Viewer): MessageView {
    return messageViews(core, [requireRow(id)], viewer?.id ?? null)[0];
  }

  /** İş parçacığı var mı ve görüntüleyen için açık mı? Bağlantı ve başlık döner. */
  function thread(threadType: ThreadType, threadId: string, viewer: Viewer, forWrite: boolean): { link: string; ref: string; authorId: string | null } {
    if (threadType === "topic") {
      const t = db.get<{ id: string; status: string; seq: number; title: string }>("SELECT id, status, seq, title FROM topics WHERE id = ?", threadId);
      if (!t) throw notFound("Konu");
      if (forWrite && t.status !== "active") throw conflict("invalid_state", "Arşivlenmiş konuya mesaj yazılamaz.");
      return { link: topicLink(t.id), ref: `“${t.title}”`, authorId: null };
    }
    if (threadType === "proposal") {
      const p = db.get<{ id: string; status: string; author_id: string; seq: number }>("SELECT id, status, author_id, seq FROM proposals WHERE id = ?", threadId);
      if (!p || (p.status === "draft" && p.author_id !== viewer?.id)) throw notFound("Öneri");
      if (forWrite && p.status === "draft") throw conflict("invalid_state", "Taslak önerinin tartışması henüz açılmadı; önce öneriyi gönderin.");
      return { link: proposalLink(p.id), ref: proposalRef(p), authorId: p.author_id };
    }
    throw fieldError("threadType", "İş parçacığı türü “topic” ya da “proposal” olmalıdır.");
  }

  async function moderate(actor: AuthUser, text: string): Promise<ModerationResult | null> {
    try {
      return await deps.ai.moderate(text, moderationContext(core), { forceOffline: !actor.aiConsent });
    } catch (e) {
      console.error("[forum] moderasyon başarısız:", e);
      return null;
    }
  }

  const flagsJson = (m: ModerationResult | null): string | null => (m ? JSON.stringify({ risk: m.risk, labels: m.labels, offline: m.offline, model: m.model }) : null);

  const service: MessageService = {
    list(threadType: ThreadType, threadId: string, viewer: Viewer): MessageView[] {
      thread(threadType, threadId, viewer, false);
      const rows = db.all<MessageRow>("SELECT * FROM messages WHERE thread_type = ? AND thread_id = ? ORDER BY seq ASC", threadType, threadId);
      return messageViews(core, rows, viewer?.id ?? null);
    },

    async post(actor: AuthUser, threadType: ThreadType, threadId: string, input: PostMessageRequest): Promise<MessageView> {
      requireVerified(actor, "Mesaj yazmak");
      const data = parseInput(postSchema, input);
      const t = thread(threadType, threadId, actor, true);
      const body = checkLength(data.body, 1, 10000, "body", "Mesaj");
      let parent: MessageRow | undefined;
      if (data.parentId) {
        parent = row(data.parentId);
        if (!parent || parent.thread_type !== threadType || parent.thread_id !== threadId) {
          throw fieldError("parentId", "Yanıtlanan mesaj bu tartışmada bulunamadı.");
        }
      }
      assertNoPii(core, body, data.acknowledgePii);
      const mod = await moderate(actor, body);
      const id = newId();
      const result = core.tx(() => {
        const now = core.now();
        const seq = db.nextSeq("messages");
        const salt = newSalt();
        const hash = contentHash(salt, body);
        db.run(
          `INSERT INTO messages(id, seq, thread_type, thread_id, parent_id, author_id, stance, body, version, visibility, content_salt, content_hash, ai_flags, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, 1, 'visible', ?, ?, ?, ?, ?)`,
          id,
          seq,
          threadType,
          threadId,
          parent?.id ?? null,
          actor.id,
          data.stance,
          body,
          salt,
          hash,
          flagsJson(mod),
          now,
          now,
        );
        db.run(
          "INSERT INTO message_versions(message_id, version, body, content_salt, content_hash, created_at) VALUES (?, 1, ?, ?, ?, ?)",
          id,
          body,
          salt,
          hash,
          now,
        );
        const tx = core.submit("MESSAGE_POSTED", { messageId: id, seq, threadType, threadId, contentHash: hash, parentId: parent?.id ?? null });
        db.run("UPDATE messages SET ledger_tx = ? WHERE id = ?", tx, id);
        db.run("UPDATE message_versions SET ledger_tx = ? WHERE message_id = ? AND version = 1", tx, id);
        if (parent && parent.author_id !== actor.id) {
          core.notify([parent.author_id], {
            kind: "message_reply",
            title: "Mesajınıza yanıt geldi",
            body: `${actor.nickname}, ${t.ref} tartışmasında mesajınızı yanıtladı.`,
            link: t.link,
          });
        }
        return view(id, actor);
      });
      if (parent && parent.author_id !== actor.id) {
        // Graf yazısı dış işlemin DIŞINDA (graf kendi işlemini ve bellek içi kopyasını yönetir).
        try {
          deps.graph.addEdge({ src: `user:${actor.id}`, dst: `user:${parent.author_id}`, type: "REPLIED_TO", meta: { messageId: id } });
        } catch (e) {
          console.error("[forum] REPLIED_TO kenarı eklenemedi:", e);
        }
      }
      return result;
    },

    async edit(actor: AuthUser, messageId: string, bodyIn: string, acknowledgePii?: boolean): Promise<MessageView> {
      requireVerified(actor, "Mesaj düzenlemek");
      const m = requireRow(messageId);
      if (m.author_id !== actor.id) throw forbidden("Yalnızca mesajın yazarı düzenleyebilir.");
      if (m.visibility === "hidden" || m.visibility === "sealed") throw conflict("invalid_state", "Karar ile gizlenmiş mesaj düzenlenemez.");
      const body = checkLength(String(bodyIn ?? ""), 1, 10000, "body", "Mesaj");
      if (body === m.body) return view(messageId, actor);
      assertNoPii(core, body, acknowledgePii);
      const mod = await moderate(actor, body);
      return core.tx(() => {
        const cur = requireRow(messageId);
        if (cur.version !== m.version) throw conflict("version_conflict", "Mesaj bu arada değişti; sayfayı yenileyip tekrar deneyin.");
        if (cur.visibility === "hidden" || cur.visibility === "sealed") throw conflict("invalid_state", "Karar ile gizlenmiş mesaj düzenlenemez.");
        const now = core.now();
        const version = cur.version + 1;
        const salt = newSalt();
        const hash = contentHash(salt, body);
        db.run(
          "INSERT INTO message_versions(message_id, version, body, content_salt, content_hash, created_at) VALUES (?, ?, ?, ?, ?, ?)",
          messageId,
          version,
          body,
          salt,
          hash,
          now,
        );
        const tx = core.submit("MESSAGE_EDITED", { messageId, version, contentHash: hash });
        db.run("UPDATE message_versions SET ledger_tx = ? WHERE message_id = ? AND version = ?", tx, messageId, version);
        db.run(
          "UPDATE messages SET body = ?, version = ?, content_salt = ?, content_hash = ?, ai_flags = ?, updated_at = ? WHERE id = ?",
          body,
          version,
          salt,
          hash,
          flagsJson(mod),
          now,
          messageId,
        );
        return view(messageId, actor);
      });
    },

    versions(viewer: Viewer, messageId: string): MessageVersionView[] {
      const m = requireRow(messageId);
      const hidden = m.visibility === "hidden" || m.visibility === "sealed";
      if (m.thread_type === "proposal") thread("proposal", m.thread_id, viewer, false);
      if (hidden) {
        if (!hasRole(viewer, "auditor", "admin")) throw forbidden("Gizlenmiş mesajın sürümlerini yalnızca denetçi görebilir.");
        logHiddenAccess(viewer!.id, m, "versions");
      }
      return db
        .all<{ version: number; body: string; created_at: number; content_hash: string }>(
          "SELECT version, body, created_at, content_hash FROM message_versions WHERE message_id = ? ORDER BY version ASC",
          messageId,
        )
        .map((v) => ({ version: Number(v.version), body: v.body, createdAt: Number(v.created_at), contentHash: v.content_hash }));
    },

    endorse(actor: AuthUser, messageId: string, value: -1 | 0 | 1): MessageView {
      requireVerified(actor, "Mesaja katılım bildirmek");
      if (value !== -1 && value !== 0 && value !== 1) throw fieldError("value", "Değer -1 (katılmıyorum), 0 (geri al) ya da 1 (katılıyorum) olmalıdır.");
      const m = requireRow(messageId);
      if (m.author_id === actor.id) throw unprocessable("own_message", "Kendi mesajınıza katılım bildiremezsiniz.");
      if (m.visibility === "hidden" || m.visibility === "sealed") throw conflict("invalid_state", "Gizlenmiş mesaj desteklenemez.");
      core.tx(() => {
        db.run(
          `INSERT INTO message_endorsements(message_id, user_id, value, at) VALUES (?, ?, ?, ?)
           ON CONFLICT(message_id, user_id) DO UPDATE SET value = excluded.value, at = excluded.at`,
          messageId,
          actor.id,
          value,
          core.now(),
        );
      });
      return view(messageId, actor);
    },

    rebuttal(actor: AuthUser, messageId: string, bodyIn: string): MessageView {
      const m = requireRow(messageId);
      if (m.author_id !== actor.id) throw forbidden("Yalnızca gizlenen mesajın yazarı cevap ekleyebilir.");
      if (m.visibility !== "hidden" && m.visibility !== "sealed") throw conflict("invalid_state", "Cevap yalnızca karar ile gizlenmiş mesaja eklenebilir.");
      if (actor.status === "suspended") throw forbidden("Askıdaki üye cevap ekleyemez.");
      const body = checkLength(String(bodyIn ?? ""), 10, 2000, "body", "Cevap metni");
      assertNoPii(core, body, false);
      core.tx(() => {
        const exists = db.get("SELECT 1 FROM message_rebuttals WHERE message_id = ?", messageId);
        if (exists) throw conflict("already_rebutted", "Bu mesaj için cevap hakkınızı zaten kullandınız.");
        db.run("INSERT INTO message_rebuttals(message_id, author_id, body, created_at) VALUES (?, ?, ?, ?)", messageId, actor.id, body, core.now());
      });
      return view(messageId, actor);
    },

    readHidden(actor: AuthUser, messageId: string): HiddenMessageResponse {
      if (!hasRole(actor, "auditor", "admin")) throw forbidden("Gizlenmiş metni yalnızca denetçi okuyabilir.");
      const m = requireRow(messageId);
      if (m.visibility !== "hidden" && m.visibility !== "sealed") throw conflict("invalid_state", "Bu mesaj gizlenmemiş; normal görünümden okunabilir.");
      logHiddenAccess(actor.id, m, "read");
      const versions = db
        .all<{ version: number; body: string; created_at: number; content_hash: string }>(
          "SELECT version, body, created_at, content_hash FROM message_versions WHERE message_id = ? ORDER BY version ASC",
          messageId,
        )
        .map((v) => ({ version: Number(v.version), body: v.body, createdAt: Number(v.created_at), contentHash: v.content_hash }));
      return { messageId, body: m.body, versions, accessLogged: true };
    },

    async precheck(actor: AuthUser, body: string): Promise<MessagePrecheckResponse> {
      const text = String(body ?? "").slice(0, 20000);
      const pii = deps.ai.detectPii(text).map((f) => ({ kind: f.kind, start: f.start, end: f.end, masked: f.masked }));
      const mod = await moderate(actor, text);
      const model = mod?.model ?? deps.ai.model();
      return {
        pii,
        risk: mod?.risk ?? 0,
        labels: mod?.labels ?? [],
        rationale: mod?.rationale ?? "Moderasyon şu an yapılamadı.",
        offline: mod?.offline ?? true,
        aiLabel: aiLabel(model, core.now()),
      };
    },

    get(messageId: string, viewer: Viewer): MessageView {
      const m = requireRow(messageId);
      if (m.thread_type === "proposal") thread("proposal", m.thread_id, viewer, false);
      return view(messageId, viewer);
    },

    collapse(messageIds: string[], proposalId: string): void {
      if (messageIds.length === 0) return;
      core.tx(() => {
        db.run(
          "UPDATE messages SET visibility = 'collapsed' WHERE visibility = 'visible' AND id IN (SELECT value FROM json_each(?))",
          jsonList(messageIds),
        );
      });
      void proposalId;
    },

    uncollapse(messageIds: string[], proposalId: string): void {
      if (messageIds.length === 0) return;
      core.tx(() => {
        // Başka bir açık ACİL silme talebi hâlâ hedefliyorsa daraltma sürer.
        const stillTargeted = new Set<string>();
        for (const r of db.all<{ deletion_payload: string | null }>(
          `SELECT deletion_payload FROM proposals WHERE kind = 'deletion' AND id <> ? AND status IN ${ACTIVE_SQL}`,
          proposalId,
        )) {
          const d = JSON.parse(r.deletion_payload ?? "{}") as { messageIds?: string[]; ground?: string };
          if (d.ground && groundIsUrgent(deps, d.ground)) for (const id of d.messageIds ?? []) stillTargeted.add(id);
        }
        const ids = messageIds.filter((id) => !stillTargeted.has(id));
        if (ids.length > 0) {
          db.run("UPDATE messages SET visibility = 'visible' WHERE visibility = 'collapsed' AND id IN (SELECT value FROM json_each(?))", jsonList(ids));
        }
      });
    },

    hide(messageIds: string[], proposalId: string, groundIri: string, sealed: boolean): string[] {
      const p = core.requireProposal(proposalId);
      const txs: string[] = [];
      core.tx(() => {
        const now = core.now();
        for (const id of messageIds) {
          const m = row(id);
          if (!m || m.visibility === "hidden" || m.visibility === "sealed") continue;
          db.run(
            "UPDATE messages SET visibility = ?, hidden_by_proposal_id = ?, hidden_ground = ?, updated_at = ? WHERE id = ?",
            sealed ? "sealed" : "hidden",
            proposalId,
            groundIri,
            now,
            id,
          );
          txs.push(core.submit("MESSAGE_HIDDEN", { messageId: id, proposalId, ground: groundIri }));
          core.notify([m.author_id], {
            kind: "message_hidden",
            title: "Mesajınız karar ile gizlendi",
            body: `${proposalRef(p)} silme kararıyla mesajınız gizlendi. Metin silinmedi; karartılamayan tek bir cevap ekleyebilirsiniz.`,
            link: m.thread_type === "topic" ? topicLink(m.thread_id) : proposalLink(m.thread_id),
          });
        }
      });
      return txs;
    },
  };

  function logHiddenAccess(actorId: string, m: MessageRow, purpose: "read" | "versions"): void {
    core.tx(() => {
      db.run("INSERT INTO hidden_access_log(id, actor_id, message_id, at) VALUES (?, ?, ?, ?)", newId(), actorId, m.id, core.now());
      core.audit.log(actorId, "message.read_hidden", m.id, { purpose, proposalId: m.hidden_by_proposal_id, visibility: m.visibility });
    });
  }

  return service;
}
