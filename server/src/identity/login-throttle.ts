// Hesap başına giriş kilidi (#226): IP başına hız sınırından AYRI olarak, aynı tanımlayıcıya (takma ad ya da e-posta) karşı
// art arda başarısız denemeler sınırlanır. Farklı adreslerden tek bir hesabın şifresini denemek böylece yavaşlar.
//
// Sızıntı yok: anahtar hesabın kendisi değil, NORMALLEŞTİRİLMİŞ TANIMLAYICIDIR ve var olmayan bir ad için de aynı sayaç/kilit
// işler; yanıt (429 + Retry-After) hesabın var olup olmadığını ele vermez. Hesap kimliğine göre sayılsaydı, takma adla kilitlenen
// hesabın e-postasıyla deneme de 429 alır ve e-postanın hangi takma ada ait olduğu öğrenilirdi.
//
// Süreler GERÇEK duvar saatiyle ölçülür (simüle saat değil): demo hızlandırması kilidi kısaltmaz. Sayaçlar yalnız bellekte
// tutulur (yeniden başlatmada sıfırlanır) ve sayısı sınırlıdır; tanımlayıcılar düz metin olarak saklanmaz (özet).
import { createHash } from "node:crypto";
import { AppError } from "../core/errors";

/** 15 dakikalık pencerede en çok 5 başarısız deneme; aşılınca 15 dakika kilit. */
export const LOGIN_MAX_FAILURES = 5;
export const LOGIN_WINDOW_MS = 15 * 60_000;
export const LOGIN_LOCK_MS = 15 * 60_000;
/** Bellekte tutulan en çok tanımlayıcı sayısı (rastgele adlarla bellek doldurmaya karşı). */
export const LOGIN_THROTTLE_MAX_ENTRIES = 10_000;

export interface LoginThrottleOptions {
  /** Gerçek duvar saati (ms); varsayılan Date.now. */
  now?: () => number;
  maxFailures?: number;
  windowMs?: number;
  lockMs?: number;
  maxEntries?: number;
}

export interface LoginThrottle {
  /**
   * Şifre denetiminden ÖNCE çağrılır: tanımlayıcı kilitliyse 429 login_locked (details.retryAfterSeconds → Retry-After başlığı)
   * fırlatır; değilse denemeyi sonucu beklenmeden sayar. Böylece aynı anda gönderilen çok sayıda istek de sınırı aşamaz.
   */
  begin(key: string): void;
  /** Başarılı giriş: sayaç sıfırlanır. */
  succeeded(key: string): void;
  /** Başarısız giriş. Bu başarısızlık kilidi başlattıysa (kilit başına bir kez) true döner — denetim kaydı için. */
  failed(key: string): boolean;
}

interface Entry {
  /** Penceredeki sayılan denemeler (başarısız + sonucu henüz belli olmayan). */
  attempts: number;
  windowStart: number;
  /** 0: kilit yok. */
  lockedUntil: number;
  lockReported: boolean;
}

/** Tanımlayıcının sayaç anahtarı: düz metin bellekte tutulmasın (ör. ad alanına yanlışlıkla yazılmış bir şifre). */
export function throttleKey(kind: "nickname" | "email", normalized: string): string {
  return createHash("sha256").update(`${kind}:${normalized}`, "utf8").digest("base64url");
}

export function lockedError(remainingMs: number): AppError {
  const sec = Math.max(1, Math.ceil(remainingMs / 1000));
  const min = Math.max(1, Math.ceil(sec / 60));
  return new AppError(
    429,
    "login_locked",
    `Bu takma ad ya da e-posta ile çok fazla başarısız giriş denemesi yapıldı. Güvenliğiniz için giriş geçici olarak durduruldu; lütfen ${min} dakika sonra tekrar deneyin.`,
    { retryAfterSeconds: sec },
  );
}

export function createLoginThrottle(opts: LoginThrottleOptions = {}): LoginThrottle {
  const now = opts.now ?? Date.now;
  const maxFailures = opts.maxFailures ?? LOGIN_MAX_FAILURES;
  const windowMs = opts.windowMs ?? LOGIN_WINDOW_MS;
  const lockMs = opts.lockMs ?? LOGIN_LOCK_MS;
  const maxEntries = opts.maxEntries ?? LOGIN_THROTTLE_MAX_ENTRIES;
  const entries = new Map<string, Entry>();

  const expired = (e: Entry, t: number) => e.lockedUntil <= t && t - e.windowStart >= windowMs;

  /**
   * Yer açar: önce süresi dolmuşlar atılır; hâlâ doluysa KİLİTSİZ kayıtlardan en az denemesi olan (eşitlikte en eski) atılır.
   * Kilitli kayıtlar ancak hepsi kilitliyse (kilidi en erken bitecek olan) atılır: çok adresli bir saldırgan rastgele adlarla
   * belleği doldurarak hedef hesabın kilidini sildiremez ve kilitlemeye yaklaşmış sayacı da tek denemelik kayıtlardan önce atılmaz.
   */
  function makeRoom(t: number): void {
    if (entries.size < maxEntries) return;
    for (const [k, e] of entries) if (expired(e, t)) entries.delete(k);
    while (entries.size >= maxEntries) {
      let victim: string | null = null;
      let best: Entry | null = null;
      let lockedVictim: string | null = null;
      let lockedBest: Entry | null = null;
      for (const [k, e] of entries) {
        if (e.lockedUntil > t) {
          if (!lockedBest || e.lockedUntil < lockedBest.lockedUntil) [lockedVictim, lockedBest] = [k, e];
        } else if (!best || e.attempts < best.attempts) {
          [victim, best] = [k, e];
          if (e.attempts <= 1) break; // daha azı olamaz; ekleme sırasıyla ilk (en eski) bu
        }
      }
      const k = victim ?? lockedVictim;
      if (k === null) break;
      entries.delete(k);
    }
  }

  /** Geçerli kayıt; kilidi ya da penceresi dolmuşsa sıfırlanmış sayılır. */
  function live(key: string, t: number): Entry | undefined {
    const e = entries.get(key);
    if (!e) return undefined;
    if (e.lockedUntil > t) return e;
    if (e.lockedUntil > 0 || t - e.windowStart >= windowMs) {
      entries.delete(key);
      return undefined;
    }
    return e;
  }

  return {
    begin(key) {
      const t = now();
      let e = live(key, t);
      if (e && e.lockedUntil > t) throw lockedError(e.lockedUntil - t);
      if (!e) {
        makeRoom(t);
        e = { attempts: 0, windowStart: t, lockedUntil: 0, lockReported: false };
        entries.set(key, e);
      }
      e.attempts++;
      // Sınıra ulaşan deneme yine de denetlenir (doğruysa sayaç sıfırlanır); sonrakiler kilit bitene kadar reddedilir.
      if (e.attempts >= maxFailures) e.lockedUntil = t + lockMs;
    },

    succeeded(key) {
      entries.delete(key);
    },

    failed(key) {
      const t = now();
      const e = entries.get(key);
      if (!e || e.lockedUntil <= t || e.lockReported) return false;
      e.lockReported = true;
      return true;
    },
  };
}
