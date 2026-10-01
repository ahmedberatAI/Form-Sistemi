// Kimlik doğrulama kancası (Bearer) ve yetki yardımcıları (U, V, VV, R/D/A, E).
import type { FastifyInstance, FastifyRequest } from "fastify";
import { ROLE_LABELS, type Role } from "@forum/shared";
import type { AuthUser, ExpertService, IdentityService } from "../core/contracts";
import { AppError, unauthorized } from "../core/errors";

const BEARER = /^Bearer\s+(\S{1,4096})\s*$/i;

export function installAuth(app: FastifyInstance, identity: IdentityService): void {
  app.decorateRequest("user", null);
  app.decorateRequest("authToken", null);
  app.addHook("onRequest", async (req) => {
    req.user = null;
    req.authToken = null;
    const header = req.headers.authorization;
    if (!header) return;
    const m = BEARER.exec(header);
    if (!m) return;
    req.authToken = m[1];
    try {
      req.user = identity.authenticate(m[1]);
    } catch (err) {
      req.log.warn({ err }, "Belirteç doğrulanamadı");
      req.user = null;
    }
  });
}

const denied = (message: string, reason: string) => new AppError(403, "forbidden", message, { reason });

export function hasRole(user: AuthUser, role: Role): boolean {
  return user.roles.includes("admin") || user.roles.includes(role);
}

/** U: oturum açmış herhangi bir kullanıcı (doğrulama bekleyen dahil). */
export function requireUser(req: FastifyRequest): AuthUser {
  if (!req.user) throw unauthorized();
  return req.user;
}

/** V: doğrulanmış üye. */
export function requireVerified(req: FastifyRequest): AuthUser {
  const user = requireUser(req);
  if (user.status === "verified") return user;
  if (user.status === "pending") {
    throw denied("Bu işlem için üyeliğinizin kayıt memuru tarafından doğrulanmış olması gerekir.", "not_verified");
  }
  if (user.status === "suspended") throw denied("Hesabınız askıya alınmış; bu işlemi yapamazsınız.", "suspended");
  throw denied("Hesabınız etkin değil; bu işlemi yapamazsınız.", "inactive");
}

/** VV: doğrulanmış + 18 yaşından büyük + siyasi görüş açık rızası (uygun seçmenlik ayrıca servis içinde denetlenir). */
export function requireVoter(req: FastifyRequest): AuthUser {
  const user = requireVerified(req);
  if (!user.isAdult) throw denied("Oy kullanmak ve itiraz etmek için 18 yaşını doldurmuş olmanız gerekir.", "not_adult");
  if (!user.politicalConsent) {
    throw denied(
      "Oy kullanmak ve itiraz etmek için oy/görüş verilerinizin işlenmesine açık rıza vermeniz gerekir (Hesabım → Rızalar).",
      "political_consent_required",
    );
  }
  return user;
}

/**
 * R / D / A: verilen rollerden birine sahip, doğrulanmış personel. Yönetici her role sahip sayılır.
 * Denetçinin kayıt memurunun okuma uçlarını kullanabilmesi için çağıran taraf ("registrar", "auditor") verir.
 */
export function requireRole(req: FastifyRequest, ...roles: Role[]): AuthUser {
  const user = requireUser(req);
  if (!roles.some((r) => hasRole(user, r))) {
    const names = roles.map((r) => ROLE_LABELS[r]).concat(roles.includes("admin") ? [] : [ROLE_LABELS.admin]);
    throw denied(`Bu işlem yalnızca şu rollere açıktır: ${names.join(", ")}.`, "role_required");
  }
  if (user.status !== "verified") throw denied("Hesabınız etkin değil; yetkili işlem yapamazsınız.", "inactive");
  return user;
}

/** E: etkin bilirkişi (experts.status = active). */
export function requireExpert(req: FastifyRequest, experts: ExpertService): AuthUser {
  const user = requireVerified(req);
  if (experts.get(user.id)?.status !== "active") throw denied("Bu işlem yalnızca etkin bilirkişilere açıktır.", "expert_required");
  return user;
}
