// fetch sarmalayıcı: sunucu adresi, Bearer belirteç, JSON gövde, Türkçe hata nesnesi.
// Sayfalar bunu doğrudan değil, ./endpoints içindeki tipli fonksiyonlarla kullanır.
import { getPref, isNativePlatform, PREF_KEYS, removePref, setPref } from "../lib/prefs";

/** Android emülatöründen bilgisayardaki sunucuya erişim adresi. */
export const NATIVE_DEFAULT_SERVER = "http://10.0.2.2:4000";
const DEFAULT_TIMEOUT_MS = 30_000;

/**
 * Sunucu hatası. `{error:{code,message,details}}` gövdesinden üretilir.
 * status = 0 → ağ hatası / zaman aşımı (code: "network" | "timeout").
 */
export class ApiError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details: unknown;
  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
  get isNetwork(): boolean {
    return this.status === 0;
  }
}

export function isApiError(e: unknown): e is ApiError {
  return e instanceof ApiError;
}

/** Her türlü hatadan kullanıcıya gösterilecek Türkçe metin. */
export function errorMessage(e: unknown): string {
  if (e instanceof ApiError) return e.message;
  if (e instanceof Error && e.message) return e.message;
  if (typeof e === "string") return e;
  return "Beklenmeyen bir hata oluştu.";
}

// ───────────── Sunucu adresi ─────────────

let serverUrl: string | null = null; // kullanıcı ayarı (null → varsayılan)
let configLoaded: Promise<void> | null = null;

export function defaultServerUrl(): string {
  return isNativePlatform() ? NATIVE_DEFAULT_SERVER : "";
}

export function normalizeServerUrl(url: string): string {
  return url.trim().replace(/\/+$/, "").replace(/\/api$/, "");
}

function loadConfig(): Promise<void> {
  configLoaded ??= getPref(PREF_KEYS.serverUrl).then(
    (v) => {
      serverUrl = v && v.trim() ? normalizeServerUrl(v) : null;
    },
    () => {
      serverUrl = null;
    },
  );
  return configLoaded;
}

/** Etkin sunucu adresi ("" = web'de aynı köken). */
export async function getServerUrl(): Promise<string> {
  await loadConfig();
  return serverUrl ?? defaultServerUrl();
}

/** Kullanıcının kaydettiği adres (yoksa null). */
export async function getSavedServerUrl(): Promise<string | null> {
  await loadConfig();
  return serverUrl;
}

/** Sunucu adresini kaydeder; null/boş → varsayılana döner. */
export async function setServerUrl(url: string | null): Promise<void> {
  await loadConfig();
  const v = url ? normalizeServerUrl(url) : "";
  if (v) {
    serverUrl = v;
    await setPref(PREF_KEYS.serverUrl, v);
  } else {
    serverUrl = null;
    await removePref(PREF_KEYS.serverUrl);
  }
}

/** Yolu tam URL'ye çevirir (ör. "/api/health" → "http://10.0.2.2:4000/api/health"). */
export async function apiUrl(path: string): Promise<string> {
  return (await getServerUrl()) + path;
}

// ───────────── Oturum belirteci ve 401 olayı ─────────────

let authToken: string | null = null;
const unauthorizedTarget = new EventTarget();

/** AuthContext belirteci buraya verir; sonraki isteklere Bearer olarak eklenir. */
export function setAuthToken(token: string | null): void {
  authToken = token;
}

export function getAuthToken(): string | null {
  return authToken;
}

/** Belirteçli bir istek 401 aldığında çağrılır (AuthContext oturumu temizler). Aboneliği kaldıran fonksiyon döner. */
export function onUnauthorized(listener: (e: ApiError) => void): () => void {
  const h = (ev: Event) => listener((ev as CustomEvent<ApiError>).detail);
  unauthorizedTarget.addEventListener("unauthorized", h);
  return () => unauthorizedTarget.removeEventListener("unauthorized", h);
}

// ───────────── İstek ─────────────

export type QueryValue = string | number | boolean | null | undefined | readonly (string | number)[];

/**
 * Sorgu dizesi üretir. undefined/null/""/false atlanır, true → "1", diziler virgülle birleştirilir.
 * Örn. qs({ status: "open", mine: true, limit: 20 }) → "?status=open&mine=1&limit=20"; boşsa "".
 */
export function qs(params?: Record<string, QueryValue> | object | null): string {
  if (!params) return "";
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params as Record<string, QueryValue>)) {
    if (v === undefined || v === null || v === "" || v === false) continue;
    if (Array.isArray(v)) {
      if (v.length) sp.set(k, v.join(","));
    } else if (v === true) sp.set(k, "1");
    else sp.set(k, String(v));
  }
  const s = sp.toString();
  return s ? "?" + s : "";
}

/** Yol parçasını güvenle kodlar. */
export const seg = (v: string | number): string => encodeURIComponent(String(v));

export interface RequestOptions {
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE";
  body?: unknown;
  query?: Record<string, QueryValue> | object;
  /** "json" (varsayılan) | "text" */
  responseType?: "json" | "text";
  signal?: AbortSignal;
  timeoutMs?: number;
  /** false → Authorization başlığı eklenmez */
  auth?: boolean;
  headers?: Record<string, string>;
}

function parseErrorBody(status: number, text: string): ApiError {
  let parsed: unknown = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = null;
  }
  const err = (parsed as { error?: { code?: unknown; message?: unknown; details?: unknown } } | null)?.error;
  if (err && typeof err === "object") {
    const code = typeof err.code === "string" ? err.code : `http_${status}`;
    const message = typeof err.message === "string" && err.message ? err.message : defaultMessage(status);
    return new ApiError(status, code, message, err.details);
  }
  // JSON olmayan hata (ör. vekil sunucu arka uca ulaşamadı)
  if (status === 502 || status === 503 || status === 504 || (status === 500 && !text)) {
    return new ApiError(status, "unreachable", "Sunucuya ulaşılamıyor. Sunucunun çalıştığından emin olun.");
  }
  return new ApiError(status, `http_${status}`, defaultMessage(status));
}

function defaultMessage(status: number): string {
  switch (status) {
    case 400:
      return "İstek geçersiz.";
    case 401:
      return "Oturum açmanız gerekiyor.";
    case 403:
      return "Bu işlem için yetkiniz yok.";
    case 404:
      return "Kayıt bulunamadı.";
    case 409:
      return "İşlem mevcut durumla çakışıyor.";
    case 422:
      return "İşlem kurallara uygun değil.";
    case 429:
      return "Çok fazla istek gönderildi; lütfen biraz bekleyin.";
    default:
      return status >= 500 ? `Sunucu hatası (HTTP ${status}).` : `Beklenmeyen sunucu yanıtı (HTTP ${status}).`;
  }
}

/**
 * Temel istek fonksiyonu. Başarısızlıkta her zaman ApiError fırlatır
 * (çağıranın kendi AbortSignal'i ile iptal edilirse AbortError'u aynen fırlatır).
 */
export async function request<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const base = await getServerUrl();
  const url = base + path + qs(opts.query);
  const headers: Record<string, string> = { Accept: opts.responseType === "text" ? "text/plain, text/turtle, */*" : "application/json", ...opts.headers };
  let body: BodyInit | undefined;
  if (opts.body !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(opts.body);
  }
  const sentToken = opts.auth === false ? null : authToken;
  if (sentToken) headers.Authorization = `Bearer ${sentToken}`;

  const ctrl = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    ctrl.abort();
  }, opts.timeoutMs ?? DEFAULT_TIMEOUT_MS);
  const onOuterAbort = () => ctrl.abort();
  if (opts.signal) {
    if (opts.signal.aborted) ctrl.abort();
    else opts.signal.addEventListener("abort", onOuterAbort, { once: true });
  }

  let res: Response;
  try {
    res = await fetch(url, { method: opts.method ?? "GET", headers, body, signal: ctrl.signal });
  } catch (e) {
    if (opts.signal?.aborted) throw e;
    if (timedOut) throw new ApiError(0, "timeout", "Sunucu zamanında yanıt vermedi. Lütfen tekrar deneyin.");
    throw new ApiError(0, "network", "Sunucuya ulaşılamıyor. İnternet bağlantınızı ve Ayarlar'daki sunucu adresini kontrol edin.");
  } finally {
    clearTimeout(timer);
    opts.signal?.removeEventListener("abort", onOuterAbort);
  }

  let text: string;
  try {
    text = await res.text();
  } catch {
    throw new ApiError(0, "network", "Sunucu yanıtı okunamadı (bağlantı kesildi).");
  }

  if (!res.ok) {
    const err = parseErrorBody(res.status, text);
    if (res.status === 401 && sentToken && !path.startsWith("/api/auth/")) {
      unauthorizedTarget.dispatchEvent(new CustomEvent("unauthorized", { detail: err }));
    }
    throw err;
  }
  if (opts.responseType === "text") return text as T;
  if (!text) return undefined as T;
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new ApiError(res.status, "bad_response", "Sunucudan beklenmeyen biçimde yanıt geldi (JSON değil). Sunucu adresini kontrol edin.");
  }
}

export const http = {
  get: <T>(path: string, query?: RequestOptions["query"], opts?: RequestOptions) => request<T>(path, { ...opts, method: "GET", query }),
  post: <T>(path: string, body?: unknown, opts?: RequestOptions) => request<T>(path, { ...opts, method: "POST", body: body ?? {} }),
  put: <T>(path: string, body?: unknown, opts?: RequestOptions) => request<T>(path, { ...opts, method: "PUT", body: body ?? {} }),
  patch: <T>(path: string, body?: unknown, opts?: RequestOptions) => request<T>(path, { ...opts, method: "PATCH", body: body ?? {} }),
  del: <T>(path: string, opts?: RequestOptions) => request<T>(path, { ...opts, method: "DELETE" }),
  text: (path: string, query?: RequestOptions["query"], opts?: RequestOptions) => request<string>(path, { ...opts, method: "GET", query, responseType: "text" }),
};

/**
 * Bağlantı sınaması: `${url}/api/health`. url verilmezse etkin adres kullanılır.
 * Hata fırlatmaz; sonucu döndürür.
 */
export async function pingServer(url?: string): Promise<{ ok: boolean; ms: number; message: string }> {
  const base = url === undefined ? await getServerUrl() : normalizeServerUrl(url);
  const t0 = performance.now();
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  try {
    const res = await fetch(base + "/api/health", { headers: { Accept: "application/json" }, signal: ctrl.signal });
    const ms = Math.round(performance.now() - t0);
    const body = (await res.json().catch(() => null)) as { ok?: boolean } | null;
    if (res.ok && body?.ok) return { ok: true, ms, message: `Bağlantı başarılı (${ms} ms).` };
    return { ok: false, ms, message: `Sunucu yanıt verdi ancak beklenen biçimde değil (HTTP ${res.status}).` };
  } catch {
    const ms = Math.round(performance.now() - t0);
    return {
      ok: false,
      ms,
      message: ctrl.signal.aborted ? "Sunucu 8 saniye içinde yanıt vermedi." : "Sunucuya ulaşılamıyor (adres yanlış, sunucu kapalı ya da CORS engeli).",
    };
  } finally {
    clearTimeout(timer);
  }
}
