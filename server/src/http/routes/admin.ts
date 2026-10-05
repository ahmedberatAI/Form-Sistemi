// Yönetim: simüle saat, zamanlayıcı, kullanıcılar ve roller, denetim günlüğü, görüş kümesi yeniden hesabı.
import type { FastifyInstance } from "fastify";
import { HOUR } from "../../core/clock";
import type { AdminUserRow, AuditLogEntry, ClusterSnapshotView, Me, TickResponse } from "@forum/shared";
import type { Transition } from "../../core/forum-contracts";
import { failedProposalIds, tickDeferred } from "../../forum/lifecycle";
import { requireRole } from "../auth";
import { adminUsersQuery, auditLogQuery, clockAdvanceBody, idParams, setRolesBody } from "../schemas";
import type { AppServices, RouteDeps } from "../types";
import { parseBody, parseParams, parseQuery } from "../validation";

/** Yaşam döngüsü bir turda yeni geçişlere yol açabilir (ör. uzlaşma süresi 0 olan DEL); en çok 5 tur ilerletilir. */
export const MAX_TICK_ROUNDS = 5;
/**
 * Yönetici isteğinin geçişlere ayırabileceği en uzun süre (ms): web istemcisinin 30 sn'lik zaman aşımından kısa. Yüzlerce önerinin
 * aynı anda vadesi geldiğinde kalan geçişler zamanlayıcıya (ya da bir sonraki "tick" isteğine) bırakılır; yanıt `pending: true` olur.
 */
export const ADMIN_TICK_BUDGET_MS = 20_000;

/** `failed`: yaşam döngüsünün ilerletemediği (hata/geri çekilme) öneri kimlikleri — yalnızca varsa döner. */
export async function tickUntilSettled(services: AppServices, budgetMs = ADMIN_TICK_BUDGET_MS): Promise<TickResponse & { failed?: string[] }> {
  const all: Transition[] = [];
  const failed = new Set<string>();
  const deadline = performance.now() + budgetMs;
  let pending = false;
  for (let i = 0; i < MAX_TICK_ROUNDS; i++) {
    const remaining = deadline - performance.now();
    if (i > 0 && remaining <= 0) {
      pending = true;
      break;
    }
    const t = await services.forum.lifecycle.tick({ budgetMs: Math.max(0, remaining) });
    all.push(...t);
    for (const id of failedProposalIds(t)) failed.add(id);
    if (tickDeferred(t)) {
      pending = true;
      break;
    }
    if (t.length === 0) break;
  }
  return {
    transitions: all.map(({ proposalId, seq, from, to, reason }) => ({ proposalId, seq, from, to, reason })),
    now: services.clock.now(),
    ...(failed.size > 0 ? { failed: [...failed] } : {}),
    ...(pending ? { pending: true } : {}),
  };
}

export function registerAdminRoutes(app: FastifyInstance, { services }: RouteDeps): void {
  const { clock, forum, identity, audit } = services;

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
    audit.log(actor.id, "admin.tick", null, { transitions: res.transitions.length, ...(res.failed ? { failed: res.failed } : {}) });
    return res;
  });

  app.get("/api/admin/users", async (req): Promise<AdminUserRow[]> => {
    requireRole(req, "admin");
    const { q } = parseQuery(adminUsersQuery, req.query);
    return forum.community.adminUsers(q);
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
    // snapshot() anonim görünüm döner (kimlik/takma ad yok; KVKK md. 6) — yönetici de siyasi görüş kümesini kişiyle eşleştiremez.
    const snap = await forum.clusters.snapshot("yönetici");
    audit.log(actor.id, "admin.clusters_recompute", snap.id, { k: snap.k, members: snap.members });
    return snap;
  });
}
