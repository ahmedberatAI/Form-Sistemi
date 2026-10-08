// Topluluk: kullanıcı arama, herkese açık profil, vekâletler, bildirimler, denetim günlüğü, sistem bilgisi, pano ve görevler.
import {
  clusterLabel,
  delegationCap,
  nicknameKey,
  SURUM,
  type AdminUserRow,
  type AuditLogEntry,
  type Dashboard,
  type DashboardTask,
  type DelegationView,
  type Me,
  type MyDelegations,
  type Notification,
  type ProposalStatus,
  type PublicProfile,
  type PublicUser,
} from "@forum/shared";
import type { AuthUser } from "../core/contracts";
import { notFound } from "../core/errors";
import { renderNotificationRows } from "../core/notification-text";
import type { CommunityService, DiscoveryService, Viewer } from "../core/forum-contracts";
import { json } from "../db";
import { latestClusterOf } from "./clusters";
import { canObject, canVote, canWriteMinorityReport } from "./eligibility";
import { ALL_STATUSES, hasRole, jsonList, proposalLink, proposalRef, safe, type ForumCore } from "./util";
import { publicUsers, publicUsersByIds, querySummaries } from "./views";

interface UserRow {
  id: string;
  nickname: string;
  status: string;
  roles: string;
  reputation: number;
  created_at: number;
}

const bare = (key: string): string => (key.startsWith("user:") ? key.slice(5) : key);

/** Ana sayfa "Şu an açık" satır sayısı. */
const DASHBOARD_OPEN_LIMIT = 10;

export function createCommunityService(core: ForumCore, parts: { discovery: DiscoveryService }): CommunityService {
  const { db, deps } = core;

  function delegationViews(edges: { id: string; from: string; to: string; scope: string; rank: number; createdAt: number }[]): DelegationView[] {
    const nick = core.nicknames(edges.map((e) => e.to));
    return edges.map((e) => ({ id: e.id, from: e.from, to: e.to, toNickname: nick.get(e.to) ?? "", scope: e.scope, rank: e.rank, createdAt: e.createdAt }));
  }

  function memberCounts(): { verified: number; pending: number } {
    const r = db.get<{ v: number; p: number }>(
      "SELECT SUM(CASE WHEN status = 'verified' THEN 1 ELSE 0 END) AS v, SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END) AS p FROM users",
    );
    return { verified: Number(r?.v ?? 0), pending: Number(r?.p ?? 0) };
  }

  function ledgerSummary(): { height: number; validators: number; healthy: number } {
    return safe(
      () => {
        const s = deps.ledger.status();
        return { height: Number(s.height), validators: s.validators.length, healthy: s.validators.filter((v) => v.healthy).length };
      },
      { height: 0, validators: 0, healthy: 0 },
    );
  }

  /** Görüntüleyenin uygun seçmen listesinde olduğu, verilen evrelerdeki öneriler (aday kümesi; yetki kararı eligibility.ts'tedir). */
  function openAsVoter(userId: string, statuses: ProposalStatus[]): { id: string; seq: number; title: string; status: ProposalStatus; phase_ends_at: number | null }[] {
    return db.all<{ id: string; seq: number; title: string; status: ProposalStatus; phase_ends_at: number | null }>(
      `SELECT p.id, p.seq, p.title, p.status, p.phase_ends_at
         FROM proposals p
         JOIN eligible_voters e ON e.proposal_id = p.id AND e.user_id = ?
        WHERE p.status IN (SELECT value FROM json_each(?))
        ORDER BY p.phase_ends_at ASC`,
      userId,
      JSON.stringify(statuses),
    );
  }

  const service: CommunityService = {
    searchUsers(q: string, limit = 20): PublicUser[] {
      const needle = nicknameKey(String(q ?? "")).slice(0, 100); // nickname_norm ile aynı anahtar (I/ı katlamalı)
      const lim = Math.min(100, Math.max(1, Math.floor(Number(limit) || 20)));
      const escaped = needle.replace(/[\\%_]/g, (c) => "\\" + c);
      const rows = db.all<UserRow>(
        `SELECT id, nickname, status, roles, reputation, created_at FROM users
          WHERE status = 'verified' AND nickname_norm LIKE ? ESCAPE '\\'
          ORDER BY CASE WHEN nickname_norm = ? THEN 0 WHEN nickname_norm LIKE ? ESCAPE '\\' THEN 1 ELSE 2 END, nickname_norm, id
          LIMIT ?`,
        `%${escaped}%`,
        needle,
        `${escaped}%`,
        lim,
      );
      return publicUsers(core, rows);
    },

    adminUsers(q?: string, limit = 500): AdminUserRow[] {
      const term = nicknameKey(q ?? ""); // nickname_norm ile aynı anahtar (I/ı katlamalı)
      const like = `%${term.replace(/[\\%_]/g, (c) => "\\" + c)}%`;
      const lim = Math.min(500, Math.max(1, Math.floor(Number(limit) || 500)));
      const rows = db.all<UserRow & { verified_at: number | null; is_adult: number; political_consent: number }>(
        `SELECT id, nickname, status, roles, reputation, created_at, verified_at, is_adult, political_consent
           FROM users
          WHERE ? = '' OR nickname_norm LIKE ? ESCAPE '\\' OR id = ?
          ORDER BY created_at DESC, id
          LIMIT ?`,
        term,
        like,
        term,
        lim,
      );
      // Ortak kullanıcı izdüşümü (rol ayrıştırma + bilirkişi bilgisi); yönetici kesin katılım zamanını görür.
      return publicUsers(core, rows).map((u, i) => ({
        ...u,
        joinedAt: Number(rows[i].created_at),
        verifiedAt: rows[i].verified_at === null ? null : Number(rows[i].verified_at),
        isAdult: rows[i].is_adult === 1,
        politicalConsent: rows[i].political_consent === 1,
      }));
    },

    publicProfile(userId: string, viewer: Viewer): PublicProfile {
      const u = db.get<UserRow>("SELECT id, nickname, status, roles, reputation, created_at FROM users WHERE id = ?", userId);
      if (!u) throw notFound("Kullanıcı");
      const [pub] = publicUsers(core, [u]);
      const key = `user:${userId}`;
      const edges = (dst: boolean, type: "FOLLOWS" | "VOUCHES" | "DELEGATES_TO") =>
        safe(() => deps.graph.listEdges(dst ? { dst: key, type } : { src: key, type }), []);
      const counts = db.get<{ proposals: number; enacted: number }>(
        "SELECT SUM(CASE WHEN status <> 'draft' THEN 1 ELSE 0 END) AS proposals, SUM(CASE WHEN status = 'enacted' THEN 1 ELSE 0 END) AS enacted FROM proposals WHERE author_id = ?",
        userId,
      );
      const messages = Number(db.get<{ c: number }>("SELECT COUNT(*) AS c FROM messages WHERE author_id = ?", userId)?.c ?? 0);
      const isSelf = viewer?.id === userId;
      let viewerInfo: PublicProfile["viewer"] = null;
      if (viewer) {
        const out = safe(() => deps.graph.listEdges({ src: `user:${viewer.id}`, dst: key }), []);
        const back = safe(() => deps.graph.listEdges({ src: key, dst: `user:${viewer.id}`, type: "RELATED_TO" }), []);
        const vouch = out.find((e) => e.type === "VOUCHES");
        const level = (vouch?.meta as { level?: string } | null)?.level;
        const related = [...out.filter((e) => e.type === "RELATED_TO"), ...back]
          .map((e) => (e.meta as { kind?: string } | null)?.kind)
          .filter((k): k is "family" | "business" | "household" => k === "family" || k === "business" || k === "household");
        viewerInfo = {
          isSelf,
          following: out.some((e) => e.type === "FOLLOWS"),
          vouched: level === "known" || level === "close" || level === "just_met" || level === "suspicious" ? level : null,
          delegations: delegationViews(safe(() => deps.graph.delegations(viewer.id), []).filter((d) => d.to === userId)),
          related: [...new Set(related)],
        };
      }
      const recentProposals = querySummaries(
        core,
        "p.author_id = ? AND (p.status <> 'draft' OR p.author_id = ?)",
        [userId, viewer?.id ?? null],
        "ORDER BY p.seq DESC LIMIT 10",
      );
      return {
        ...pub,
        ...(isSelf ? { clusterId: latestClusterOf(core, [userId]).get(userId) ?? null } : {}),
        stats: {
          proposals: Number(counts?.proposals ?? 0),
          enacted: Number(counts?.enacted ?? 0),
          messages,
          followers: edges(true, "FOLLOWS").length,
          following: edges(false, "FOLLOWS").length,
          vouchedBy: edges(true, "VOUCHES").filter((e) => (e.meta as { level?: string } | null)?.level !== "suspicious").length,
          delegatorsCount: new Set(edges(true, "DELEGATES_TO").map((e) => bare(e.src))).size,
        },
        viewer: viewerInfo,
        recentProposals,
      };
    },

    me(userId: string): Me {
      const me = deps.identity.me(userId);
      return { ...me, clusterId: latestClusterOf(core, [userId]).get(userId) ?? null };
    },

    following(userId: string): PublicUser[] {
      const ids = safe(() => deps.graph.listEdges({ src: `user:${userId}`, type: "FOLLOWS" }), []).map((e) => bare(e.dst));
      return publicUsersByIds(core, [...new Set(ids)]);
    },

    delegations(userId: string): MyDelegations {
      const all = safe(() => deps.graph.delegations(), []);
      const outgoing = delegationViews(all.filter((d) => d.from === userId));
      const incomingEdges = all.filter((d) => d.to === userId);
      const fromNick = core.nicknames(incomingEdges.map((d) => d.from));
      const incoming = delegationViews(incomingEdges).map((v) => ({ ...v, fromNickname: fromNick.get(v.from) ?? "" }));
      return { outgoing, incoming, cap: delegationCap(core.verifiedCount()) };
    },

    notifications(userId: string, opts: { unreadOnly?: boolean; limit?: number } = {}): { items: Notification[]; unread: number } {
      const limit = Math.min(500, Math.max(1, Math.floor(Number(opts.limit) || 100)));
      const rows = db.all<{ id: string; kind: string; title: string; body: string; link: string | null; read: number; created_at: number }>(
        `SELECT id, kind, title, body, link, read, created_at FROM notifications WHERE user_id = ? ${opts.unreadOnly ? "AND read = 0" : ""}
          ORDER BY created_at DESC, rowid DESC LIMIT ?`,
        userId,
        limit,
      );
      const unread = Number(db.get<{ c: number }>("SELECT COUNT(*) AS c FROM notifications WHERE user_id = ? AND read = 0", userId)?.c ?? 0);
      return {
        // Üye belirteçleri ({{uye:<kimlik>}}) okunurken güncel takma adla çözülür (kayıtlı metin takma ad taşımaz).
        items: renderNotificationRows(db, rows).map((r) => ({ id: r.id, kind: r.kind, title: r.title, body: r.body, link: r.link, read: r.read === 1, createdAt: Number(r.created_at) })),
        unread,
      };
    },

    markRead(userId: string, ids?: string[]): void {
      if (ids && ids.length > 0) {
        db.run("UPDATE notifications SET read = 1 WHERE user_id = ? AND read = 0 AND id IN (SELECT value FROM json_each(?))", userId, jsonList(ids));
      } else {
        db.run("UPDATE notifications SET read = 1 WHERE user_id = ? AND read = 0", userId);
      }
    },

    auditLog(filter: { actorId?: string; action?: string; limit?: number }): AuditLogEntry[] {
      const where: string[] = [];
      const params: (string | number)[] = [];
      if (filter.actorId) {
        where.push("a.actor_id = ?");
        params.push(filter.actorId);
      }
      if (filter.action) {
        where.push("a.action = ?");
        params.push(filter.action);
      }
      const limit = Math.min(1000, Math.max(1, Math.floor(Number(filter.limit) || 100)));
      return db
        .all<{ id: string; actor_id: string | null; nickname: string | null; action: string; target: string | null; meta: string | null; at: number }>(
          `SELECT a.id, a.actor_id, u.nickname, a.action, a.target, a.meta, a.at FROM audit_log a LEFT JOIN users u ON u.id = a.actor_id
           ${where.length ? `WHERE ${where.join(" AND ")}` : ""} ORDER BY a.at DESC, a.rowid DESC LIMIT ?`,
          ...params,
          limit,
        )
        .map((r) => ({
          id: r.id,
          actorId: r.actor_id,
          actorNickname: r.nickname ?? null,
          action: r.action,
          target: r.target,
          meta: json<Record<string, unknown> | null>(r.meta, null),
          at: Number(r.at),
        }));
    },

    systemInfo() {
      return {
        version: SURUM,
        now: core.now(),
        clockOffsetMs: deps.ctx.clock.offset(),
        timeScale: Number(core.config.timeScale),
        aiMode: deps.ai.mode(),
        aiModel: deps.ai.model(),
        ledger: ledgerSummary(),
        bylawVersion: safe(() => deps.ontology.current().version, 0),
        members: memberCounts(),
      };
    },

    dashboard(viewer: Viewer, opts: { recent?: readonly string[] } = {}): Dashboard {
      const counts = Object.fromEntries(ALL_STATUSES.map((s) => [s, 0])) as Record<ProposalStatus, number>;
      for (const r of db.all<{ status: ProposalStatus; c: number }>("SELECT status, COUNT(*) AS c FROM proposals WHERE status <> 'draft' GROUP BY status")) {
        counts[r.status] = Number(r.c);
      }
      const topics = Number(db.get<{ c: number }>("SELECT COUNT(*) AS c FROM topics WHERE status = 'active'")?.c ?? 0);
      const recentEnacted = querySummaries(core, "p.status = 'enacted'", [], "ORDER BY p.updated_at DESC, p.seq DESC LIMIT 5");
      // "Şu an açık": profil varsa kişisel sıra (gerekçeli); "Sizi bekleyenler" (tasks) ayrı ve kişiselleştirmeden bağımsızdır.
      const open = parts.discovery.openForDashboard(viewer, DASHBOARD_OPEN_LIMIT, opts.recent ?? []);
      // Yalnız kalıcı kaybeden göstergesi (önbellekli): pano her yoklamada uzlaşı/aracı/sybil hesaplarını tetiklemez.
      const loser = safe(() => deps.graph.permanentLoser(), []);
      const l = ledgerSummary();
      return {
        counts,
        topics,
        members: memberCounts(),
        recentEnacted,
        open: open.items,
        openPersonalized: open.personalized,
        tasks: viewer ? service.tasks(viewer) : [],
        permanentLoser: loser.map((x) => ({ clusterId: x.clusterId, label: clusterLabel(x.clusterId), lostShare: x.lostShare, decisions: x.decisions })),
        ledger: { height: l.height, healthy: l.healthy, validators: l.validators },
      };
    },

    tasks(viewer: AuthUser): DashboardTask[] {
      const out: DashboardTask[] = [];
      const me = core.user(viewer.id);
      if (!me) return out;
      const now = core.now();
      const verified = me.status === "verified";
      if (verified) {
        // Görev koşulları öneri sayfasındaki bayraklarla AYNIDIR (canVote / canObject / canWriteMinorityReport: eligibility.ts):
        // rızası geri çekilmiş ya da itiraz bütçesi dolmuş üyeye, sayfada yapamayacağı bir eylem görev diye gösterilmez.
        // Oy bekleyenler: oy verebilen, bu turda doğrudan oy vermemiş.
        for (const p of db.all<{ id: string; seq: number; title: string; status: ProposalStatus; phase_ends_at: number | null }>(
          `SELECT p.id, p.seq, p.title, p.status, p.phase_ends_at FROM proposals p
             JOIN eligible_voters e ON e.proposal_id = p.id AND e.user_id = ?
            WHERE p.status IN ('voting', 'revote')
              AND NOT EXISTS (SELECT 1 FROM ballots b WHERE b.proposal_id = p.id AND b.round = p.voting_round AND b.user_id = ?)
            ORDER BY p.phase_ends_at ASC`,
          viewer.id,
          viewer.id,
        )) {
          if (!canVote(core, p, viewer.id, now)) continue;
          out.push({ kind: "vote", title: `${proposalRef(p)} “${p.title}” için oy verin${p.status === "revote" ? " (yeniden oylama)" : ""}`, link: proposalLink(p.id), dueAt: Number(p.phase_ends_at) });
        }
        // İtiraz hakkı olanlar (tur-1 etkin oyu "red", süre sürüyor, rıza ve 30 günlük itiraz bütçesi uygun).
        for (const p of openAsVoter(viewer.id, ["objection_window"])) {
          if (!canObject(core, p, viewer.id, now)) continue;
          out.push({ kind: "object", title: `${proposalRef(p)} kabul edildi; itiraz hakkınız var`, link: proposalLink(p.id), dueAt: p.phase_ends_at });
        }
        // Uzlaşmada azınlık raporu.
        for (const p of openAsVoter(viewer.id, ["reconciliation"])) {
          if (!canWriteMinorityReport(core, p, viewer.id)) continue;
          out.push({ kind: "reconciliation", title: `${proposalRef(p)} uzlaşma turunda: azınlık raporu yazabilirsiniz`, link: proposalLink(p.id), dueAt: p.phase_ends_at });
        }
        // Destek bekleyenler (en çok 5).
        for (const p of db.all<{ id: string; seq: number; title: string; phase_ends_at: number }>(
          `SELECT p.id, p.seq, p.title, p.phase_ends_at FROM proposals p
            WHERE p.status = 'sponsoring' AND p.author_id <> ? AND p.phase_ends_at > ?
              AND NOT EXISTS (SELECT 1 FROM proposal_sponsors s WHERE s.proposal_id = p.id AND s.user_id = ?)
            ORDER BY p.phase_ends_at ASC LIMIT 5`,
          viewer.id,
          now,
          viewer.id,
        )) {
          out.push({ kind: "sponsor", title: `${proposalRef(p)} “${p.title}” destekçi arıyor`, link: proposalLink(p.id), dueAt: Number(p.phase_ends_at) });
        }
      }
      // Bilirkişi görevleri.
      const assignments = safe(() => deps.experts.assignmentsFor(viewer.id), []).filter((a) => a.status === "invited" || a.status === "accepted");
      if (assignments.length > 0) {
        const seqs = new Map(
          db
            .all<{ id: string; seq: number }>("SELECT id, seq FROM proposals WHERE id IN (SELECT value FROM json_each(?))", jsonList(assignments.map((a) => a.proposalId)))
            .map((r) => [r.id, Number(r.seq)] as const),
        );
        for (const a of assignments) {
          out.push({
            kind: "expert",
            title: `#K-${seqs.get(a.proposalId) ?? "?"} bilirkişi görevi: ${a.status === "invited" ? "daveti yanıtlayın" : "raporunuzu verin"}`,
            link: proposalLink(a.proposalId),
            dueAt: a.dueAt,
          });
        }
      }
      // Kayıt memuru.
      if (hasRole(viewer, "registrar", "admin")) {
        const pending = memberCounts().pending;
        if (pending > 0) out.push({ kind: "registrar", title: `${pending} üye kimlik doğrulaması bekliyor`, link: "/kayit-memuru", dueAt: null });
      }
      // Yazar görevleri.
      for (const p of db.all<{ id: string; seq: number; title: string; status: string; phase_ends_at: number | null; open_s: number }>(
        `SELECT p.id, p.seq, p.title, p.status, p.phase_ends_at,
                (SELECT COUNT(*) FROM proposal_suggestions s WHERE s.proposal_id = p.id AND s.status = 'open') AS open_s
           FROM proposals p WHERE p.author_id = ? AND p.status IN ('draft', 'deliberation', 'reconciliation') ORDER BY p.seq DESC`,
        viewer.id,
      )) {
        if (p.status === "draft") out.push({ kind: "author", title: `${proposalRef(p)} taslağınızı gönderin`, link: proposalLink(p.id), dueAt: null });
        else if (Number(p.open_s) > 0) {
          out.push({ kind: "author", title: `${proposalRef(p)} için ${p.open_s} metin önerisi kararınızı bekliyor`, link: proposalLink(p.id), dueAt: p.phase_ends_at });
        }
        if (p.status === "reconciliation") {
          out.push({ kind: "author", title: `${proposalRef(p)} uzlaşma turunda: metni azınlık görüşleriyle gözden geçirin`, link: proposalLink(p.id), dueAt: p.phase_ends_at });
        }
      }
      return out.sort((a, b) => (a.dueAt ?? Number.MAX_SAFE_INTEGER) - (b.dueAt ?? Number.MAX_SAFE_INTEGER));
    },
  };
  return service;
}
