// Yönetim: simüle saat, zamanlayıcı, kullanıcılar ve roller, denetim günlüğü, görüş kümesi yeniden hesabı.
import type { FastifyInstance } from "fastify";
import { HOUR } from "../../core/clock";
import { nicknameKey, type AdminUserRow, type AuditLogEntry, type ClusterSnapshotView, type Me, type Role, type TickResponse, type UserStatus } from "@forum/shared";
import type { Transition } from "../../core/forum-contracts";
import { json, type Db } from "../../db";
import { requireRole } from "../auth";
import { adminUsersQuery, auditLogQuery, clockAdvanceBody, idParams, ROLES, setRolesBody } from "../schemas";
import type { AppServices, RouteDeps } from "../types";
import { parseBody, parseParams, parseQuery } from "../validation";

/** Yaşam döngüsü bir turda yeni geçişlere yol açabilir (ör. uzlaşma süresi 0 olan DEL); en çok 5 tur ilerletilir. */
export const MAX_TICK_ROUNDS = 5;

export async function tickUntilSettled(services: AppServices): Promise<TickResponse> {
  const all: Transition[] = [];
  for (let i = 0; i < MAX_TICK_ROUNDS; i++) {
    const t = await services.forum.lifecycle.tick();
    all.push(...t);
    if (t.length === 0) break;
  }
  return {
    transitions: all.map(({ proposalId, seq, from, to, reason }) => ({ proposalId, seq, from, to, reason })),
    now: services.clock.now(),
  };
}

interface AdminUserDbRow {
  id: string;
  nickname: string;
  status: UserStatus;
  roles: string;
  reputation: number;
  created_at: number;
  verified_at: number | null;
  is_adult: number;
  political_consent: number;
  expert_status: string | null;
  expert_domains: string | null;
}

function parseRoles(raw: string): Role[] {
  const set = new Set<Role>(["member"]);
  for (const r of json<unknown[]>(raw, [])) if ((ROLES as readonly unknown[]).includes(r)) set.add(r as Role);
  return ROLES.filter((r) => set.has(r));
}

/** Yönetici kullanıcı listesi: yalnız takma ad ve hesap durumu; kişisel veri YOK. */
export function listAdminUsers(db: Db, q: string | undefined, limit = 500): AdminUserRow[] {
  const term = nicknameKey(q ?? ""); // nickname_norm ile aynı anahtar (I/ı katlamalı)
  const like = `%${term.replace(/[\\%_]/g, (c) => "\\" + c)}%`;
  const rows = db.all<AdminUserDbRow>(
    `SELECT u.id, u.nickname, u.status, u.roles, u.reputation, u.created_at, u.verified_at, u.is_adult, u.political_consent,
            e.status AS expert_status, e.domains AS expert_domains
       FROM users u LEFT JOIN experts e ON e.user_id = u.id
      WHERE ? = '' OR u.nickname_norm LIKE ? ESCAPE '\\' OR u.id = ?
      ORDER BY u.created_at DESC, u.id
      LIMIT ?`,
    term,
    like,
    term,
    limit,
  );
  return rows.map((r) => {
    const active = r.expert_status === "active";
    return {
      id: r.id,
      nickname: r.nickname,
      status: r.status,
      roles: parseRoles(r.roles),
      isExpert: active,
      expertDomains: active ? json<string[]>(r.expert_domains, []) : [],
      reputation: Number(r.reputation ?? 0),
      joinedAt: Number(r.created_at),
      verifiedAt: r.verified_at === null ? null : Number(r.verified_at),
      isAdult: r.is_adult === 1,
      politicalConsent: r.political_consent === 1,
    };
  });
}

export function registerAdminRoutes(app: FastifyInstance, { services }: RouteDeps): void {
  const { clock, forum, identity, audit, ctx } = services;

  app.post("/api/admin/clock/advance", async (req): Promise<TickResponse> => {
    const actor = requireRole(req, "admin");
    const { hours } = parseBody(clockAdvanceBody, req.body);
    const before = clock.now();
    clock.advance(Math.round(hours * HOUR));
    const res = await tickUntilSettled(services);
    audit.log(actor.id, "admin.clock_advance", null, { hours, from: before, to: res.now, transitions: res.transitions.length });
    return res;
  });

  app.post("/api/admin/tick", async (req): Promise<TickResponse> => {
    const actor = requireRole(req, "admin");
    const res = await tickUntilSettled(services);
    audit.log(actor.id, "admin.tick", null, { transitions: res.transitions.length });
    return res;
  });

  app.get("/api/admin/users", async (req): Promise<AdminUserRow[]> => {
    requireRole(req, "admin");
    const { q } = parseQuery(adminUsersQuery, req.query);
    return listAdminUsers(ctx.db, q);
  });

  app.put("/api/admin/users/:id/roles", async (req): Promise<Me> => {
    const actor = requireRole(req, "admin");
    const { id } = parseParams(idParams, req.params);
    const { roles } = parseBody(setRolesBody, req.body);
    return identity.setRoles(actor.id, id, roles);
  });

  app.get("/api/admin/audit-log", async (req): Promise<AuditLogEntry[]> => {
    requireRole(req, "admin", "auditor");
    const q = parseQuery(auditLogQuery, req.query);
    return forum.community.auditLog({ action: q.action, actorId: q.actorId, limit: q.limit });
  });

  app.post("/api/admin/clusters/recompute", async (req): Promise<ClusterSnapshotView> => {
    const actor = requireRole(req, "admin");
    const snap = await forum.clusters.snapshot("yönetici");
    audit.log(actor.id, "admin.clusters_recompute", snap.id, { k: snap.k, members: snap.members });
    return snap;
  });
}
