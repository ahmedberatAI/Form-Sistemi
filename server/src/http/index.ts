// HTTP katmanı: Fastify sunucusu, kimlik doğrulama/yetki yardımcıları, hata biçimi, rotalar.
export { buildServer, BODY_LIMIT, DEFAULT_RATE_LIMIT, rateLimitFromEnv } from "./server";
export { hasRole, requireExpert, requireRole, requireUser, requireVerified, requireVoter } from "./auth";
export { errorBody, toAppError } from "./errors";
export type { AppServices, HttpOptions, RateLimitOptions, RouteDeps } from "./types";
