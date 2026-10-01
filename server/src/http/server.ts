// Fastify 5 sunucusunu kurar: eklentiler (CORS, hız sınırı, statik dosyalar), kimlik doğrulama, hata biçimi, rotalar.
import { existsSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import Fastify, { type FastifyInstance, type onRequestHookHandler } from "fastify";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import fastifyStatic from "@fastify/static";
import type { Config } from "../core/config";
import { AppError } from "../core/errors";
import { installAuth } from "./auth";
import { installErrorHandling, rateLimitedError } from "./errors";
import { registerRoutes } from "./routes";
import type { AppServices, HttpOptions, RateLimitOptions, RouteDeps } from "./types";

export const BODY_LIMIT = 1024 * 1024;
export const DEFAULT_RATE_LIMIT = { global: 300, auth: 20 } as const;
const MINUTE = 60_000;

/**
 * Hız sınırını ortam değişkenlerinden okur: RATE_LIMIT_GLOBAL (varsayılan 300) ve RATE_LIMIT_AUTH (varsayılan 20), istek/dk/IP.
 * 0 → o sınırlayıcı kapalı; ikisi de 0 → hız sınırı tamamen kapalı (false). Geçersiz değer açık bir hatayla durdurur.
 */
export function rateLimitFromEnv(env: Record<string, string | undefined> = process.env): RateLimitOptions {
  const read = (name: string, fallback: number): number => {
    const raw = env[name]?.trim();
    if (raw === undefined || raw === "") return fallback;
    const n = Number(raw);
    if (!Number.isInteger(n) || n < 0) throw new Error(`${name} negatif olmayan bir tam sayı olmalıdır (istek/dakika; 0 = kapalı), verilen: "${raw}".`);
    return n;
  };
  const global = read("RATE_LIMIT_GLOBAL", DEFAULT_RATE_LIMIT.global);
  const auth = read("RATE_LIMIT_AUTH", DEFAULT_RATE_LIMIT.auth);
  return global === 0 && auth === 0 ? false : { global, auth };
}

function isDir(p: string): boolean {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}

export async function buildServer(services: AppServices, config: Config, opts: HttpOptions = {}): Promise<FastifyInstance> {
  // Günlük: LOG_LEVEL (varsayılan "warn": yalnız uyarı ve hatalar; her isteği görmek için LOG_LEVEL=info).
  const app = Fastify({ logger: opts.logger ? { level: process.env.LOG_LEVEL ?? "warn" } : false, bodyLimit: BODY_LIMIT });

  // Boş gövdeli JSON isteklerini kabul et (gövde yok sayılır); geri kalanı Fastify'ın güvenli ayrıştırıcısında.
  // API yalnız JSON kabul eder (text/plain → 415).
  const defaultJson = app.getDefaultJsonParser("error", "ignore");
  app.removeContentTypeParser(["application/json", "text/plain"]);
  app.addContentTypeParser("application/json", { parseAs: "string" }, (req, body, done) => {
    const raw = typeof body === "string" ? body : body.toString("utf8");
    if (raw.trim() === "") return done(null, undefined);
    defaultJson(req, raw, (err, parsed) => {
      if (err) return done(new AppError(400, "validation", "İstek gövdesi geçerli bir JSON değil."), undefined);
      done(null, parsed);
    });
  });

  // Hata işleyici ve 404/SPA geri dönüşü, rotalar (statik dahil) kaydedilmeden ÖNCE kurulmalı.
  const webDist = config.webDist ? resolve(config.webDist) : "";
  const serveStatic = webDist !== "" && isDir(webDist);
  installErrorHandling(app, { spaIndex: () => (serveStatic && existsSync(join(webDist, "index.html")) ? webDist : null) });

  app.addHook("onSend", async (req, reply, payload) => {
    reply.header("x-content-type-options", "nosniff");
    if (req.url.startsWith("/api/") && !reply.hasHeader("cache-control")) reply.header("cache-control", "no-store");
    return payload;
  });

  await app.register(cors, {
    origin: config.corsOrigins.includes("*") ? true : config.corsOrigins,
    methods: ["GET", "POST", "PATCH", "PUT", "DELETE", "OPTIONS"],
    allowedHeaders: ["Authorization", "Content-Type", "Accept"],
    exposedHeaders: ["Retry-After", "X-RateLimit-Limit", "X-RateLimit-Remaining", "X-RateLimit-Reset"],
    maxAge: 600,
  });

  // Statik dosyalar hız sınırının dışında kalsın diye sınırlayıcıdan önce kaydedilir.
  if (serveStatic) {
    await app.register(fastifyStatic, { root: webDist, prefix: "/", index: ["index.html"], wildcard: true });
  }

  const authLimiter: onRequestHookHandler[] = [];
  const rl = opts.rateLimit ?? DEFAULT_RATE_LIMIT;
  const globalMax = rl === false ? 0 : (rl.global ?? DEFAULT_RATE_LIMIT.global);
  const authMax = rl === false ? 0 : (rl.auth ?? DEFAULT_RATE_LIMIT.auth);
  if (globalMax > 0 || authMax > 0) {
    // 0: o sınırlayıcı kapalı (yalnız test/uçtan uca ortamı). Genel sınır kapalıyken eklenti yalnız auth sayacı için kaydedilir.
    await app.register(rateLimit, {
      global: globalMax > 0,
      max: globalMax > 0 ? globalMax : DEFAULT_RATE_LIMIT.global,
      timeWindow: MINUTE,
      errorResponseBuilder: (_req, ctx) => rateLimitedError(ctx.ttl),
    });
    // /api/auth/* uçları ortak, daha sıkı bir sayaç kullanır (genel sayaçtan ayrı).
    if (authMax > 0) authLimiter.push(app.rateLimit({ max: authMax, timeWindow: MINUTE }) as onRequestHookHandler);
  }

  installAuth(app, services.identity);

  const deps: RouteDeps = { services, config, authLimiter };
  registerRoutes(app, deps);
  return app;
}
