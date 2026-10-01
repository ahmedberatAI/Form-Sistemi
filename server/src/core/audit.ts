// Denetim günlüğü (audit_log): yetkili işlemlerin değiştirilemez kaydı (satırlar silinmez).
import type { CoreContext } from "./contracts";
import { newId } from "./ids";

export interface AuditLogger {
  log(actorId: string | null, action: string, target?: string | null, meta?: Record<string, unknown> | null): void;
}

export function createAuditLogger(ctx: Pick<CoreContext, "db" | "clock">): AuditLogger {
  return {
    log(actorId, action, target = null, meta = null) {
      ctx.db.run(
        "INSERT INTO audit_log(id, actor_id, action, target, meta, at) VALUES (?, ?, ?, ?, ?, ?)",
        newId(),
        actorId,
        action,
        target,
        meta ? JSON.stringify(meta) : null,
        ctx.clock.now(),
      );
    },
  };
}
