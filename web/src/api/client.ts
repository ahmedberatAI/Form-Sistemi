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

/** Oturumun sunucuca reddedildiği tek durum: 401. Diğer hatalar (5xx, ulaşılamıyor, ağ) oturumu bitirmez. */
export function isSessionRejected(e: unknown): boolean {
  return e instanceof ApiError && e.status === 401;
}

/** 401 dışındaki bir hatayı "bağlantı sorunu" olarak gösterilecek ApiError'a çevirir (açılışta /api/me başarısızsa). */
export function toConnectionError(e: unknown): ApiError {
  return e instanceof ApiError ? e : new ApiError(0, "network", errorMessage(e));
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

/**
 * İki sunucu adresi aynı sunucuyu mu gösterir? "" (web'de aynı köken) sayfanın kökenine çözülür; büyük/küçük harf ve sondaki
 * "/" ya da "/api" farkı sayılmaz (saf işlev; birim testli).
 */
export function sameServer(a: string, b: string, origin: string = typeof window !== "undefined" && window.location ? window.location.origin : ""): boolean {
  const resolve = (u: string) => (normalizeServerUrl(u) || origin).toLowerCase();
  return resolve(a) === resolve(b);
}

/**
 * Sunucu adresini kaydeder; null/boş → varsayılana döner. Etkin adres DEĞİŞİRSE oturum belirteci hemen unutulur (bellekte ve
 * cihazda) ve "serverchange" olayı yayılır (AuthContext oturumu kapatır): bir sunucunun belirteci başka bir adrese ASLA gönderilmez
 * (yanlış yazılmış ya da kötü niyetli birinin söylettiği adres hesabı ele geçiremez). Eski sunucuda oturumu kapatmak (logout)
 * çağıranın işidir ve adres değişmeden ÖNCE yapılmalıdır (SettingsPage).
 */
export async function setServerUrl(url: string | null): Promise<void> {
  await loadConfig();
  const before = serverUrl ?? defaultServerUrl();
  const v = url ? normalizeServerUrl(url) : "";
  // Adres ve belirteç aynı anda (aynı eşzamanlı adımda) değişir: süren bir istek ya eski adres+eski belirteç ya da yeni adres+belirteçsiz görür.
  serverUrl = v || null;
  const changed = !sameServer(before, serverUrl ?? defaultServerUrl());
  const hadToken = authToken !== null;
  if (changed && hadToken) {
    authToken = null;
    pendingAttempts.clear();
  }
  if (v) await setPref(PREF_KEYS.serverUrl, v);
  else await removePref(PREF_KEYS.serverUrl);
  if (changed && hadToken) {
    await removePref(PREF_KEYS.token);
    serverChangeTarget.dispatchEvent(new Event("serverchange"));
  }
}

const serverChangeTarget = new EventTarget();

/** Etkin sunucu adresi oturum açıkken değişti (belirteç unutuldu). AuthContext oturumu kapatır. Aboneliği kaldıran fonksiyon döner. */
export function onServerChange(listener: () => void): () => void {
  serverChangeTarget.addEventListener("serverchange", listener);
  return () => serverChangeTarget.removeEventListener("serverchange", listener);
}

/** Yolu tam URL'ye çevirir (ör. "/api/health" → "http://10.0.2.2:4000/api/health"). */
export async function apiUrl(path: string): Promise<string> {
  return (await getServerUrl()) + path;
}

// ───────────── Yeniden gönderim anahtarı (Idempotency-Key) ─────────────
// Yanıtı belirsiz kalan bir gönderim (zaman aşımı, bağlantı kopması, vekilden 502/503/504) sunucuda işlenmiş olabilir.
// Her gönderim denemesine bir anahtar verilir; aynı istek (yöntem + adres + gövde) yeniden gönderilirse AYNI anahtar kullanılır
// ve sunucu işlemi tekrarlamadan ilk yanıtı döndürür (server/src/http/idempotency.ts). Kesin bir yanıt (başarı ya da sunucunun
// verdiği hata) gelince anahtar unutulur: sonraki gönderim yeni bir işlemdir. Bkz. bulgu #275.
// Anahtar yalnız o kaynağa yapılan EN SON istek bu belirsiz denemeyse yeniden kullanılır: aynı kaynağa (ya da doğrudan üst/alt
// kaynağına) başka bir değiştiren istek gönderilince eski belirsiz deneme unutulur. Yoksa "Evet (belirsiz) → Hayır (başarılı) →
// Evet" dizisinde üçüncü istek ilk anahtarı taşır, sunucu eski "Evet" makbuzunu yeniden döndürür ve oy sessizce "Hayır" kalırdı
// (takip/bırak, destek, taslak A→B→A ve vekâlet ver/geri al için de aynı).

export const IDEMPOTENCY_HEADER = "Idempotency-Key";
/** Sunucu başarılı yanıtı ilk isteğin gelişinden itibaren 10 dk saklar; daha eski belirsiz denemenin anahtarı kullanılmaz. */
const RETRY_KEY_TTL_MS = 10 * 60_000;
const MAX_PENDING_ATTEMPTS = 50;
/** Yanıtı belirsiz kalmış denemeler: istek parmak izi → anahtar, kaynak (sorgusuz adres) ve zaman */
const pendingAttempts = new Map<string, { key: string; at: number; resource: string }>();
const RESEND_IS_SAFE = " Aynı içeriği yeniden gönderirseniz çift kayıt oluşmaz.";

/** Rastgele UUID v4. Güvenli olmayan bağlamda (ör. yerel ağdan http://) randomUUID yoktur; getRandomValues her yerde vardır. */
export function newIdempotencyKey(): string {
  const c = globalThis.crypto;
  if (typeof c.randomUUID === "function") return c.randomUUID();
  const b = c.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = Array.from(b, (x) => x.toString(16).padStart(2, "0")).join("");
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/** İsteğin hedef kaynağı: sorgu dizesi ve sondaki "/" olmadan adres (ör. POST …/relate ile DELETE …/relate?kind=x aynı kaynak). */
function resourceOf(url: string): string {
  return url.split("?")[0].replace(/\/+$/, "");
}

/** Aynı kaynak ya da doğrudan üst/alt kaynak mı? (ör. POST /api/me/delegations ile DELETE /api/me/delegations/:id) */
function relatedResources(a: string, b: string): boolean {
  if (a === b) return true;
  const [short, long] = a.length < b.length ? [a, b] : [b, a];
  return long.startsWith(short + "/") && !long.slice(short.length + 1).includes("/");
}

/** Bu kaynağa (ya da doğrudan üst/alt kaynağına) ait, parmak izi farklı belirsiz denemeleri unutur: yeni istek onları geçersiz kılar. */
function supersedeAttempts(resource: string, keep: string | null): void {
  for (const [k, a] of pendingAttempts) if (k !== keep && relatedResources(a.resource, resource)) pendingAttempts.delete(k);
}

/**
 * Aynı istek için yanıtı belirsiz kalmış bir deneme varsa (ve o kaynağa ondan sonra başka bir istek gönderilmediyse) onun anahtarı,
 * yoksa yeni anahtar (belirsiz kalırsa diye kaydedilir).
 */
function attemptKey(fingerprint: string, resource: string): string {
  const now = Date.now();
  for (const [k, a] of pendingAttempts) if (now - a.at > RETRY_KEY_TTL_MS) pendingAttempts.delete(k);
  supersedeAttempts(resource, fingerprint);
  const prev = pendingAttempts.get(fingerprint);
  if (prev) return prev.key;
  const key = newIdempotencyKey();
  pendingAttempts.set(fingerprint, { key, at: now, resource });
  for (const k of pendingAttempts.keys()) {
    if (pendingAttempts.size <= MAX_PENDING_ATTEMPTS) break;
    pendingAttempts.delete(k);
  }
  return key;
}

/** Sunucunun işlemi yapıp yapmadığı bilinmeyen yanıtlar: vekil hataları ve "ilk istek hâlâ işleniyor". */
function outcomeUncertain(err: ApiError): boolean {
  return err.status === 0 || err.status === 502 || err.status === 503 || err.status === 504 || err.code === "idempotency_in_progress";
}

// ───────────── Oturum belirteci ve 401 olayı ─────────────

let authToken: string | null = null;
const unauthorizedTarget = new EventTarget();

/** AuthContext belirteci buraya verir; sonraki isteklere Bearer olarak eklenir. Oturum değişince belirsiz denemeler unutulur. */
export function setAuthToken(token: string | null): void {
  if (token !== authToken) pendingAttempts.clear();
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
  /**
   * Idempotency-Key: varsayılan olarak oturumlu her POST/PUT/PATCH/DELETE isteğine (/api/auth/* hariç) otomatik verilir;
   * yanıtı belirsiz kalan aynı istek yeniden gönderilince aynısı kullanılır. Metin → bu anahtar; false → başlık eklenmez.
   */
  idempotencyKey?: string | false;
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
  // Yol kendi sorgusunu taşıyabilir (ör. boş liste için açık `?types=`): ek sorgu o durumda `&` ile eklenir.
  const query = qs(opts.query);
  const url = base + path + (query && path.includes("?") ? "&" + query.slice(1) : query);
  const method = opts.method ?? "GET";
  const headers: Record<string, string> = { Accept: opts.responseType === "text" ? "text/plain, text/turtle, */*" : "application/json", ...opts.headers };
  let body: string | undefined;
  if (opts.body !== undefined) {
    headers["Content-Type"] = "application/json";
    body = JSON.stringify(opts.body);
  }
  const sentToken = opts.auth === false ? null : authToken;
  if (sentToken) headers.Authorization = `Bearer ${sentToken}`;

  // Değiştiren istekte anahtar (sunucu yalnız oturumlu istekte kullanır). attempt: yanıt belirsiz kalırsa anahtarın saklandığı iz.
  let attempt: string | null = null;
  const keyGiven = Object.keys(headers).some((h) => h.toLowerCase() === IDEMPOTENCY_HEADER.toLowerCase());
  if (method !== "GET" && sentToken && opts.idempotencyKey !== false && !keyGiven && !path.startsWith("/api/auth/")) {
    if (typeof opts.idempotencyKey === "string") headers[IDEMPOTENCY_HEADER] = opts.idempotencyKey;
    else {
      attempt = `${method} ${url}\n${body ?? ""}`;
      headers[IDEMPOTENCY_HEADER] = attemptKey(attempt, resourceOf(url));
    }
  }
  // Anahtarı elle verilmiş ya da anahtarsız değiştiren istek de aynı kaynaktaki eski belirsiz denemeleri geçersiz kılar.
  if (method !== "GET" && attempt === null) supersedeAttempts(resourceOf(url), null);
  const resendNote = headers[IDEMPOTENCY_HEADER] ? RESEND_IS_SAFE : "";

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

  // Zaman aşımı sayacı yanıt GÖVDESİ tamamen okunana kadar açık kalır: başlıklardan sonra bağlantı donarsa da istek bitmeli.
  let res: Response;
  let text: string;
  try {
    try {
      res = await fetch(url, { method, headers, body, signal: ctrl.signal });
    } catch (e) {
      if (opts.signal?.aborted) throw e;
      if (timedOut) throw new ApiError(0, "timeout", "Sunucu zamanında yanıt vermedi. Lütfen tekrar deneyin." + resendNote);
      throw new ApiError(0, "network", "Sunucuya ulaşılamıyor. İnternet bağlantınızı ve Ayarlar'daki sunucu adresini kontrol edin.");
    }
    try {
      text = await res.text();
    } catch (e) {
      if (opts.signal?.aborted) throw e;
      if (timedOut) throw new ApiError(0, "timeout", "Sunucu zamanında yanıt vermedi. Lütfen tekrar deneyin." + resendNote);
      throw new ApiError(0, "network", "Sunucu yanıtı okunamadı (bağlantı kesildi)." + resendNote);
    }
  } finally {
    clearTimeout(timer);
    opts.signal?.removeEventListener("abort", onOuterAbort);
  }

  if (!res.ok) {
    const err = parseErrorBody(res.status, text);
    if (attempt && !outcomeUncertain(err)) pendingAttempts.delete(attempt);
    if (res.status === 401 && sentToken && !path.startsWith("/api/auth/")) {
      unauthorizedTarget.dispatchEvent(new CustomEvent("unauthorized", { detail: err }));
    }
    throw err;
  }
  if (attempt) pendingAttempts.delete(attempt);
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
