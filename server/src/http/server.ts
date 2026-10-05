// Fastify 5 sunucusunu kurar: eklentiler (CORS, hız sınırı, statik dosyalar), kimlik doğrulama, hata biçimi, rotalar.
import { existsSync, statSync } from "node:fs";
import { join, resolve } from "node:path";
import Fastify, { type FastifyInstance, type onRequestHookHandler } from "fastify";
import cors from "@fastify/cors";
import rateLimit from "@fastify/rate-limit";
import fastifyStatic from "@fastify/static";
import type { Config, TrustProxy } from "../core/config";
import { AppError } from "../core/errors";
import { installAuth } from "./auth";
import { installErrorHandling, rateLimitedError } from "./errors";
import { IDEMPOTENCY_KEY_HEADER, IDEMPOTENT_REPLAYED_HEADER, installIdempotency, type IdempotencyOptions } from "./idempotency";
import { registerRoutes } from "./routes";
import type { AppServices, HttpOptions, RateLimitOptions, RouteDeps } from "./types";

export const BODY_LIMIT = 1024 * 1024;
/** Kapanışta uçuştaki isteklerin bitmesi için beklenen azami süre; sonra kalan bağlantılar zorla kapatılır. */
export const HTTP_DRAIN_MS = 3_000;
/** Kapanış sırasında boşa düşen keep-alive bağlantılarının kapatılma yoklaması. */
const IDLE_SWEEP_MS = 100;

export interface BuildServerOptions extends HttpOptions {
  /** Kapanışta uçuştaki isteklere tanınan süre (ms); varsayılan HTTP_DRAIN_MS. */
  drainMs?: number;
  /** Idempotency-Key saklama sınırları (varsayılan DEFAULT_IDEMPOTENCY; testler küçültür). */
  idempotency?: IdempotencyOptions;
}
export const DEFAULT_RATE_LIMIT = { global: 300, auth: 20 } as const;
const MINUTE = 60_000;

/**
 * Hız sınırını ortam değişkenlerinden okur: RATE_LIMIT_GLOBAL (varsayılan 300) ve RATE_LIMIT_AUTH (varsayılan 20), istek/dk/IP.
 * IP, ters vekil arkasında TRUST_PROXY ile doğru okunur (bkz. config.ts parseTrustProxy).
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

/**
 * Config.trustProxy → Fastify trustProxy. Fastify 5 sayıyı (atlama sayısı) artık "hiçbir şeye güvenme" sayar; TRUST_PROXY=n'nin
 * belgelenen anlamı korunsun diye sayı, en yakın n atlamaya güvenen işleve çevrilir (uyarı: config.ts trustProxyWarning).
 */
export function fastifyTrustProxy(tp: TrustProxy | undefined): boolean | string[] | ((address: string, hop: number) => boolean) {
  if (typeof tp === "number") return (_address, hop) => hop < tp;
  return tp ?? false;
}

function isDir(p: string): boolean {
  try {
    return statSync(p).isDirectory();
  } catch {
    return false;
  }
}

export async function buildServer(services: AppServices, config: Config, opts: BuildServerOptions = {}): Promise<FastifyInstance> {
  // Günlük: LOG_LEVEL (varsayılan "warn": yalnız uyarı ve hatalar; her isteği görmek için LOG_LEVEL=info).
  // trustProxy (TRUST_PROXY): ters vekil arkasında req.ip, güvenilen vekillerin X-Forwarded-For'undan okunur; kapalıyken
  // (varsayılan) doğrudan bağlantının adresidir. Hız sınırı req.ip'ye göre sayar: vekil arkasında kapalı kalırsa herkes tek IP olur.
  const app = Fastify({
    logger: opts.logger ? { level: process.env.LOG_LEVEL ?? "warn" } : false,
    bodyLimit: BODY_LIMIT,
    trustProxy: fastifyTrustProxy(config.trustProxy),
  });

  // Kapanış: yeni bağlantı kabul edilmez, uçuştaki istekler bitene kadar beklenir. İstek bitince bağlantı keep-alive'a düşer ve
  // Fastify'ın varsayılan 72 sn'lik keepAliveTimeout'u close()'u ~70 sn tutardı; bu yüzden boşa düşenleri yoklayıp kapatırız,
  // süre dolunca (drainMs) kalanları zorla koparırız.
  let sweeper: ReturnType<typeof setInterval> | null = null;
  let hardStop: ReturnType<typeof setTimeout> | null = null;
  app.addHook("preClose", async () => {
    sweeper = setInterval(() => app.server.closeIdleConnections(), IDLE_SWEEP_MS);
    sweeper.unref();
    hardStop = setTimeout(() => app.server.closeAllConnections(), opts.drainMs ?? HTTP_DRAIN_MS);
    hardStop.unref();
  });
  app.addHook("onClose", async () => {
    if (sweeper) clearInterval(sweeper);
    if (hardStop) clearTimeout(hardStop);
  });

  // Yeniden gönderimde çift kayıt önleme (Idempotency-Key): kancaları rotalardan önce kurulur; ham gövde özeti ayrıştırıcıdan gelir.
  const idempotency = installIdempotency(app, opts.idempotency);

  // Boş gövdeli JSON isteklerini kabul et (gövde yok sayılır); geri kalanı Fastify'ın güvenli ayrıştırıcısında.
  // API yalnız JSON kabul eder (text/plain → 415).
  const defaultJson = app.getDefaultJsonParser("error", "ignore");
  app.removeContentTypeParser(["application/json", "text/plain"]);
  app.addContentTypeParser("application/json", { parseAs: "string" }, (req, body, done) => {
    const raw = typeof body === "string" ? body : body.toString("utf8");
    idempotency.noteRawBody(req, raw);
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
    allowedHeaders: ["Authorization", "Content-Type", "Accept", IDEMPOTENCY_KEY_HEADER],
    exposedHeaders: ["Retry-After", "X-RateLimit-Limit", "X-RateLimit-Remaining", "X-RateLimit-Reset", IDEMPOTENT_REPLAYED_HEADER],
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
