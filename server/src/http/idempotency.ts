// Idempotency-Key: yanıtı belirsiz kalan bir gönderimin yeniden denenmesinde işlemin iki kez yapılmasını önler (bulgu #275).
//
// Zayıf bağlantıda ya da yavaş yanıtta (ör. yapay zekâ moderasyonu 30 sn'yi aşarsa) istemci vazgeçip "tekrar deneyin" der;
// oysa sunucu işlemi bitirmiş olabilir. İstemci her gönderim denemesine bir anahtar (UUID) verir ve yeniden denemede AYNI
// anahtarı gönderir. Sunucu, oturum açmış kullanıcı + yöntem + yol + anahtar için ilk BAŞARILI (2xx) yanıtı sınırlı süre ve
// boyutta bellekte saklar; yeniden gönderimde işlemi tekrarlamadan aynı yanıtı döndürür (Idempotent-Replayed: true).
//   - Aynı anahtar aynı uçta farklı gövde/sorgu ile → 422 idempotency_key_reused.
//   - İlk istek hâlâ sürerken gelen kopya onun sonucunu bekler; bekleme süresi dolarsa 409 idempotency_in_progress.
//   - 2xx olmayan yanıt saklanmaz: anahtar serbest kalır, yeniden gönderim baştan işlenir.
//   - İstemci bağlantıyı koparsa da (zaman aşımı) işlem bitince yanıt saklanır: onSend, yanıt yazılmadan önce çalışır.
//   - Anonim istekler, /api/auth/* ve yalnız okuma yapan ya da çözülmüş kişisel veri döndüren uçlarda başlık yok sayılır:
//     kişisel veri bellekte tutulmaz ve her okuma erişim kaydına (pii_access_log) yeniden yazılır.
// Saklama süreç belleğindedir (yeniden başlatmada silinir) ve duvar saatiyle ölçülür (simüle saat değil). İstek gövdeleri
// saklanmaz; yalnız süreç başına rastgele anahtarla HMAC özeti tutulur.
import { createHmac, randomBytes } from "node:crypto";
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { AppError } from "../core/errors";

export const IDEMPOTENCY_KEY_HEADER = "Idempotency-Key";
export const IDEMPOTENT_REPLAYED_HEADER = "Idempotent-Replayed";

export const DEFAULT_IDEMPOTENCY = {
  /** Başarılı yanıtın saklanma süresi: ilk isteğin gelişinden itibaren 10 dk. */
  ttlMs: 10 * 60_000,
  /** En çok saklanan anahtar sayısı (aşılınca en eski tamamlanmış kayıt atılır). */
  maxEntries: 5_000,
  /** Saklanan yanıt gövdelerinin toplam boyutu. */
  maxBytes: 32 * 1024 * 1024,
  /** Tek yanıtın en büyük boyutu; daha büyük yanıt saklanmaz, yeniden gönderim 409 idempotency_replay_unavailable alır. */
  maxEntryBytes: 1024 * 1024,
  /** Uçuştaki ilk isteğin sonucunu bekleme süresi (istemcinin 30 sn'lik zaman aşımından kısa). */
  waitMs: 25_000,
} as const;

export interface IdempotencyOptions {
  ttlMs?: number;
  maxEntries?: number;
  maxBytes?: number;
  maxEntryBytes?: number;
  waitMs?: number;
  /** Saklama süresi için duvar saati (ms); testler için değiştirilebilir. */
  now?: () => number;
}

/** 8–128 karakter; harf, rakam ve - _ . : (UUID uyar). */
const KEY_PATTERN = /^[A-Za-z0-9_.:-]{8,128}$/;
const METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
/**
 * Kapsam dışı rota kalıpları: şifre içeren, çözülmüş kişisel veri döndüren (yanıt bellekte tutulmaz, her okuma erişim kaydına
 * yazılır) ya da yalnız okuma/denetim yapan (tekrarı zararsız; saklamak önbelleği boşuna doldururdu) uçlar.
 */
const EXCLUDED_ROUTES = new Set([
  "/api/me/password",
  "/api/registrar/users/:id/pii",
  "/api/registrar/corrections/:id/review",
  "/api/proposals/precheck",
  "/api/messages/precheck",
  "/api/experts/lint",
  "/api/ontology/validate-patch",
]);
const isExcluded = (route: string): boolean => route.startsWith("/api/auth/") || EXCLUDED_ROUTES.has(route);

const invalidKey = () =>
  new AppError(400, "idempotency_key_invalid", `${IDEMPOTENCY_KEY_HEADER} başlığı geçersiz: 8–128 karakterlik harf, rakam ya da - _ . : karakterlerinden oluşmalıdır (ör. bir UUID).`);
const reusedKey = () =>
  new AppError(422, "idempotency_key_reused", `Bu ${IDEMPOTENCY_KEY_HEADER} aynı uçta farklı bir istek gövdesiyle zaten kullanıldı. Yeni bir istek için yeni bir anahtar üretin.`);
const inProgress = () => new AppError(409, "idempotency_in_progress", "Aynı istek hâlâ işleniyor. Birkaç saniye sonra yeniden deneyin; işlem iki kez yapılmaz.");
const replayUnavailable = () =>
  new AppError(409, "idempotency_replay_unavailable", "Bu istek zaten işlendi, ancak yanıtı yeniden gönderilemiyor. Sonucu görmek için sayfayı yenileyin.");

interface Entry {
  readonly fingerprint: string;
  readonly expiresAt: number;
  done: boolean;
  status: number;
  contentType: string | undefined;
  /** null: işlem başarılı ama yanıt saklanamadı (çok büyük ya da akış) */
  payload: string | Buffer | null;
  bytes: number;
  readonly settled: Promise<void>;
  readonly settle: () => void;
}

type Limits = Required<IdempotencyOptions>;

/** Anahtar → kayıt. Map ekleme sırası = oluşturma sırası; süre dolumu ve atma en eskiden başlar. */
class IdempotencyStore {
  private readonly entries = new Map<string, Entry>();
  private bytes = 0;
  constructor(private readonly o: Limits) {}

  get(key: string): Entry | undefined {
    this.prune();
    return this.entries.get(key);
  }

  claim(key: string, fingerprint: string): Entry {
    let settle!: () => void;
    const settled = new Promise<void>((r) => (settle = r));
    const e: Entry = { fingerprint, expiresAt: this.o.now() + this.o.ttlMs, done: false, status: 0, contentType: undefined, payload: null, bytes: 0, settled, settle };
    this.entries.set(key, e);
    this.evict();
    return e;
  }

  complete(key: string, e: Entry, status: number, contentType: string | undefined, payload: string | Buffer | null): void {
    // Kayıt bu arada süresi dolup atıldıysa (ve anahtar yeniden alındıysa) dokunulmaz.
    if (this.entries.get(key) === e) {
      e.done = true;
      e.status = status;
      e.contentType = contentType;
      const bytes = payload === null ? 0 : typeof payload === "string" ? Buffer.byteLength(payload) : payload.length;
      if (payload !== null && bytes <= this.o.maxEntryBytes) {
        e.payload = payload;
        e.bytes = bytes;
        this.bytes += bytes;
      }
      this.evict();
    }
    e.settle();
  }

  release(key: string, e: Entry): void {
    if (this.entries.get(key) === e) this.remove(key, e);
    else e.settle();
  }

  private remove(key: string, e: Entry): void {
    this.entries.delete(key);
    this.bytes -= e.bytes;
    e.settle();
  }

  private prune(): void {
    const now = this.o.now();
    for (const [k, e] of this.entries) {
      if (e.expiresAt > now) break;
      this.remove(k, e);
    }
  }

  /** Sınır aşılırsa en eski TAMAMLANMIŞ kayıtlar atılır; uçuştakiler (eşzamanlı istek sayısıyla sınırlı) korunur. */
  private evict(): void {
    const over = () => this.entries.size > this.o.maxEntries || this.bytes > this.o.maxBytes;
    if (!over()) return;
    for (const [k, e] of this.entries) {
      if (!over()) break;
      if (e.done) this.remove(k, e);
    }
  }
}

/** Söz `ms` içinde çözülürse true, süre dolarsa false. */
function settledWithin(p: Promise<void>, ms: number): Promise<boolean> {
  if (ms <= 0) return Promise.resolve(false);
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<boolean>((r) => {
    timer = setTimeout(() => r(false), ms);
    timer.unref(); // bekleyen kopya kapanışı geciktirmesin
  });
  return Promise.race([p.then(() => true), timeout]).finally(() => clearTimeout(timer));
}

export interface Idempotency {
  /** JSON ayrıştırıcısı ham gövdeyi buraya verir (yalnız başlıklı isteklerde özeti tutulur; gövdenin kendisi saklanmaz). */
  noteRawBody(req: FastifyRequest, raw: string): void;
}

/** Idempotency-Key kancalarını kurar. Rotalardan ÖNCE çağrılmalıdır; kimlik doğrulama (onRequest) bu kancalardan önce çalışır. */
export function installIdempotency(app: FastifyInstance, opts: IdempotencyOptions = {}): Idempotency {
  const limits: Limits = { ...DEFAULT_IDEMPOTENCY, now: Date.now, ...opts };
  const store = new IdempotencyStore(limits);
  const secret = randomBytes(32);
  const digest = (s: string): string => createHmac("sha256", secret).update(s).digest("base64url");
  const bodyDigests = new WeakMap<FastifyRequest, string>();
  const claims = new WeakMap<FastifyRequest, { key: string; entry: Entry }>();
  const headerName = IDEMPOTENCY_KEY_HEADER.toLowerCase();

  const replay = (reply: FastifyReply, e: Entry): FastifyReply => {
    if (e.payload === null) throw replayUnavailable();
    reply.code(e.status).header(IDEMPOTENT_REPLAYED_HEADER, "true");
    if (e.contentType) reply.header("content-type", e.contentType);
    return reply.send(e.payload);
  };

  app.addHook("preHandler", async (req, reply) => {
    const raw = req.headers[headerName];
    if (raw === undefined || !METHODS.has(req.method)) return;
    const route = req.routeOptions.url;
    const user = req.user;
    // Anonim istekte, bilinmeyen yolda ve kapsam dışı uçta başlık yok sayılır.
    if (!user || !route || !route.startsWith("/api/") || isExcluded(route)) return;
    const value = typeof raw === "string" ? raw.trim() : "";
    if (!KEY_PATTERN.test(value)) throw invalidKey();

    const q = req.url.indexOf("?");
    const path = q < 0 ? req.url : req.url.slice(0, q);
    const query = q < 0 ? "" : req.url.slice(q + 1);
    const key = `${user.id}\n${req.method}\n${path}\n${value}`;
    const fingerprint = digest(`${query}\n${bodyDigests.get(req) ?? ""}`);
    const deadline = Date.now() + limits.waitMs;
    for (;;) {
      const e = store.get(key);
      if (!e) {
        claims.set(req, { key, entry: store.claim(key, fingerprint) });
        return;
      }
      if (e.fingerprint !== fingerprint) throw reusedKey();
      if (e.done) return replay(reply, e);
      // İlk istek sürüyor: sonucunu bekle (başarılıysa aynı yanıt döner; başarısızsa anahtar boşalır ve bu istek işlenir).
      if (!(await settledWithin(e.settled, deadline - Date.now()))) throw inProgress();
    }
  });

  app.addHook("onSend", async (req, reply, payload) => {
    const c = claims.get(req);
    if (!c) return payload;
    claims.delete(req);
    const status = reply.statusCode;
    if (status < 200 || status >= 300) {
      store.release(c.key, c.entry);
      return payload;
    }
    const ct = reply.getHeader("content-type");
    const body = payload === undefined || payload === null ? "" : typeof payload === "string" || Buffer.isBuffer(payload) ? payload : null;
    store.complete(c.key, c.entry, status, typeof ct === "string" ? ct : undefined, body);
    return payload;
  });

  // Güvenlik ağı: yanıt onSend'e hiç uğramadan bittiyse anahtar uçuşta takılı kalmasın.
  app.addHook("onResponse", async (req) => {
    const c = claims.get(req);
    if (!c) return;
    claims.delete(req);
    store.release(c.key, c.entry);
  });

  return {
    noteRawBody(req, raw) {
      if (req.headers[headerName] !== undefined && METHODS.has(req.method)) bodyDigests.set(req, digest(raw));
    },
  };
}
