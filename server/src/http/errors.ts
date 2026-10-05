// Tek tip hata yanıtı: {error:{code, message, details}}. Yanıtlarda asla yığın izi bulunmaz.
import type { FastifyError, FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import type { ApiError } from "@forum/shared";
import { AppError } from "../core/errors";
import { fieldErrors, isZodError, validationError } from "./validation";

const INTERNAL_MESSAGE = "Beklenmeyen bir hata oluştu. Lütfen daha sonra tekrar deneyin.";

export function errorBody(code: string, message: string, details?: unknown): ApiError {
  return details === undefined ? { error: { code, message } } : { error: { code, message, details } };
}

export function rateLimitedError(ttlMs: number): AppError {
  const sec = Math.max(1, Math.ceil(ttlMs / 1000));
  return new AppError(429, "rate_limited", `Çok fazla istek gönderdiniz. Lütfen ${sec} saniye sonra tekrar deneyin.`, { retryAfterSeconds: sec });
}

/**
 * Fastify'ın kendi (içerik türü, gövde boyutu vb.) hatalarını Türkçe tek tip hataya çevirir. 405 dalı yoktur: yönlendirici kayıtlı
 * bir yola desteklenmeyen yöntemle gelen isteği eşleşmeyen yol sayar ve 404 not_found verir (docs/API.md "Hata kodları").
 */
function fromFastifyError(err: FastifyError): AppError | null {
  const status = typeof err.statusCode === "number" ? err.statusCode : 0;
  if (status < 400 || status >= 500) return null;
  switch (err.code) {
    case "FST_ERR_CTP_INVALID_MEDIA_TYPE":
      return new AppError(415, "unsupported_media_type", "Desteklenmeyen içerik türü; istek gövdesi JSON (application/json) olmalıdır.");
    case "FST_ERR_CTP_BODY_TOO_LARGE":
      return new AppError(413, "payload_too_large", "İstek gövdesi çok büyük (en fazla 1 MB).");
    case "FST_ERR_CTP_INVALID_JSON_BODY":
      return new AppError(400, "validation", "İstek gövdesi geçerli bir JSON değil.");
    case "FST_ERR_CTP_EMPTY_JSON_BODY":
      return new AppError(400, "validation", "İstek gövdesi boş olamaz.");
    case "FST_ERR_CTP_INVALID_CONTENT_LENGTH":
      return new AppError(400, "validation", "İstek gövdesinin uzunluğu Content-Length başlığıyla uyuşmuyor.");
    default:
      break;
  }
  if (err instanceof SyntaxError) return new AppError(400, "validation", "İstek gövdesi geçerli bir JSON değil.");
  switch (status) {
    case 400:
      return new AppError(400, "bad_request", "Geçersiz istek.");
    case 401:
      return new AppError(401, "unauthorized", "Oturum açmanız gerekiyor.");
    case 403:
      return new AppError(403, "forbidden", "Bu işlem için yetkiniz yok.");
    case 404:
      return new AppError(404, "not_found", "İstenen kaynak bulunamadı.");
    case 413:
      return new AppError(413, "payload_too_large", "İstek gövdesi çok büyük (en fazla 1 MB).");
    case 415:
      return new AppError(415, "unsupported_media_type", "Desteklenmeyen içerik türü.");
    case 429:
      return rateLimitedError(60_000);
    default:
      return new AppError(status, "bad_request", "İstek işlenemedi.");
  }
}

/**
 * Yönlendirici (find-my-way) hataları setErrorHandler'a uğramaz; Fastify bunları `frameworkErrors` seçeneğine verir. Hepsi
 * belgelenen tek tip gövdeye çevrilir: bozuk yüzde kodlaması ve sınırı aşan yol parametresi 400 validation, gerisi 500.
 */
export function fromFrameworkError(err: FastifyError): AppError {
  switch (err.code) {
    case "FST_ERR_BAD_URL":
      return new AppError(400, "validation", "Geçersiz URL: adres bozuk bir yüzde kodlaması (%) içeriyor.");
    case "FST_ERR_MAX_PARAM_LENGTH":
      return new AppError(400, "validation", "Geçersiz URL: adresteki bir parametre (kimlik) çok uzun.");
    default:
      return new AppError(500, "internal", INTERNAL_MESSAGE);
  }
}

export function toAppError(err: unknown): AppError | null {
  if (err instanceof AppError) return err;
  if (isZodError(err)) return validationError(fieldErrors(err.issues));
  if (err && typeof err === "object" && "statusCode" in err) return fromFastifyError(err as FastifyError);
  return null;
}

export function installErrorHandling(app: FastifyInstance, opts: { spaIndex: () => string | null }): void {
  app.setErrorHandler((err: unknown, req: FastifyRequest, reply: FastifyReply) => {
    const appErr = toAppError(err);
    if (!appErr || appErr.status >= 500) {
      req.log.error({ err }, appErr ? appErr.message : "İşlenmeyen hata");
      if (!appErr) return reply.code(500).type("application/json; charset=utf-8").send(errorBody("internal", INTERNAL_MESSAGE));
    }
    const e = appErr!;
    if (e.status === 429 && !reply.hasHeader("retry-after")) {
      const sec = (e.details as { retryAfterSeconds?: number } | undefined)?.retryAfterSeconds;
      if (sec) reply.header("retry-after", String(sec));
    }
    return reply.code(e.status).type("application/json; charset=utf-8").send(errorBody(e.code, e.message, e.details));
  });

  app.setNotFoundHandler((req, reply) => {
    const path = req.url.split("?")[0];
    const isApi = path === "/api" || path.startsWith("/api/");
    const lastSegment = path.slice(path.lastIndexOf("/") + 1);
    const looksLikeFile = lastSegment.includes(".");
    const index = !isApi && !looksLikeFile && (req.method === "GET" || req.method === "HEAD") ? opts.spaIndex() : null;
    if (index) {
      return reply.header("cache-control", "no-cache").type("text/html; charset=utf-8").sendFile("index.html", index);
    }
    return reply
      .code(404)
      .type("application/json; charset=utf-8")
      .send(errorBody("not_found", isApi ? `İstenen uç nokta bulunamadı: ${req.method} ${path}` : "İstenen sayfa bulunamadı."));
  });
}
