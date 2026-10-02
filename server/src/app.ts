// Bileşim kökü: veritabanı, saat ve tüm servisleri kurar, HTTP sunucusunu bunlara bağlar.
import type { FastifyInstance } from "fastify";
import { ScaledClock, type Clock } from "./core/clock";
import { assertValidSecrets, type Config } from "./core/config";
import { verifyKeyFingerprints } from "./core/keycheck";
import type { CoreContext } from "./core/contracts";
import { createAuditLogger } from "./core/audit";
import { DbNotifier } from "./core/notifier";
import { acquireDataDirLock, type DataDirLock } from "./core/lock";
import { json, openDb, type Db } from "./db";
import { createLedgerService } from "./ledger";
import { anchorFoundingBylaw, createOntologyService } from "./ontology";
import { createGovernanceMath } from "./governance";
import { createGraphService } from "./graph";
import { createIdentityService } from "./identity";
import { createAiRecordSink, createAiService, type AnthropicLike } from "./ai";
import { createExpertService } from "./experts";
import { createForumServices } from "./forum";
import { buildServer } from "./http";
import type { AppServices, RateLimitOptions } from "./http/types";

export type { AppServices } from "./http/types";

export interface CreateAppOptions {
  /**
   * Verilmezse meta tablosundan sürdürülen hızlandırılmış simüle saat (ScaledClock) kullanılır.
   * Dışarıdan bir ScaledClock verilirse durumu kapanışta meta.sim_clock'a yazılır (sunucu kaldığı yerden sürer);
   * diğer saatler (ManualClock, SimClock) kalıcılaştırılmaz.
   */
  clock?: Clock;
  /** false: dışarıdan verilen ScaledClock kapanışta kalıcılaştırılmaz (varsayılan: kalıcılaştırılır). */
  persistClock?: boolean;
  /** false: yaşam döngüsü ve bakım zamanlayıcıları başlatılmaz (testler). */
  startTimers?: boolean;
  /** YZ istemcisi (testlerde sahte ya da null); undefined ise YZ modülü kendisi karar verir. */
  aiClient?: unknown;
  logger?: boolean;
  /** Hız sınırı (istek/dk/IP); false: kapalı. Varsayılan: genel 300, /api/auth/* 20. */
  rateLimit?: RateLimitOptions;
  /**
   * Veri klasörü kilidi (DATA_DIR/.lock) çağıran tarafından zaten alındıysa (ör. tohum betiği) verilir: createApp yeniden almaz
   * ve kapanışta bırakmaz (sahibi çağırandır). Verilmezse createApp kilidi kendisi alır ve close()'ta bırakır.
   */
  dataLock?: DataDirLock;
  /** Kapanışta uçuştaki HTTP isteklerine tanınan süre (ms); varsayılan 3000. */
  httpDrainMs?: number;
}

export interface App {
  app: FastifyInstance;
  services: AppServices;
  close(): Promise<void>;
}

const CLOCK_META_KEY = "sim_clock";
const CLOCK_PERSIST_MS = 5_000;
const LIFECYCLE_INTERVAL_MS = 1_000;
const MAINTENANCE_INTERVAL_MS = 10 * 60_000;
/** Kapanışta bekleyen deftere yazımların işlenmesi için azami bekleme (sonra defter yine de durdurulur). */
const LEDGER_FLUSH_MS = 2_000;

interface ClockState {
  simNow: number;
  advancedTotal: number;
}

function loadClockState(db: Db): ClockState | null {
  const row = db.get<{ value: string }>("SELECT value FROM meta WHERE key = ?", CLOCK_META_KEY);
  const v = json<Partial<ClockState> | null>(row?.value, null);
  if (!v || typeof v.simNow !== "number" || !Number.isFinite(v.simNow)) return null;
  const adv = typeof v.advancedTotal === "number" && Number.isFinite(v.advancedTotal) ? v.advancedTotal : 0;
  return { simNow: v.simNow, advancedTotal: adv };
}

function saveClockState(db: Db, s: ClockState): void {
  db.run(
    "INSERT INTO meta(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    CLOCK_META_KEY,
    JSON.stringify({ simNow: s.simNow, advancedTotal: s.advancedTotal }),
  );
}

export async function createApp(config: Config, opts: CreateAppOptions = {}): Promise<App> {
  // Gizli anahtarlar geçerli biçimde olmalı (boş/kısa VOTE_KEY vb. reddedilir) ve bu veritabanını oluşturan anahtarlarla eşleşmeli.
  const secrets = { master: config.masterKey, token: config.tokenKey, vote: config.voteKey };
  assertValidSecrets(secrets);
  // Aynı veri klasörünü iki süreç paylaşırsa defter kayıtları sessizce kaybolur: tek-örnek kilidi (":memory:" için kilit yok).
  const ownLock = opts.dataLock ? null : acquireDataDirLock(config.dataDir);
  const releaseLock = () => ownLock?.release();
  let opened: Db;
  try {
    opened = openDb(config.dbPath);
  } catch (err) {
    releaseLock();
    throw err;
  }
  const db = opened;
  try {
    verifyKeyFingerprints(db, secrets);
  } catch (err) {
    try {
      db.close();
    } finally {
      releaseLock();
    }
    throw err;
  }
  const timers: ReturnType<typeof setInterval>[] = [];
  let scaled: ScaledClock | null = null;
  let dbOpen = true;

  const persistClock = () => {
    if (!scaled || !dbOpen) return;
    try {
      saveClockState(db, scaled.snapshot());
    } catch {
      /* kapanış sırasında yazılamazsa bir sonraki kalıcılaştırmada denenir */
    }
  };

  let clock: Clock;
  if (opts.clock) {
    clock = opts.clock;
    // Dışarıdan verilen hızlandırılmış saat (ör. tohum verisi): kapanışta kaydedilir; periyodik yazım yapılmaz.
    if (opts.clock instanceof ScaledClock && opts.persistClock !== false) scaled = opts.clock;
  } else {
    const saved = loadClockState(db);
    // Sunucu kapalıyken simüle zaman ilerlemez: kaldığı yerden sürer. İlk açılışta gerçek saatten başlar.
    scaled = new ScaledClock({
      scale: config.timeScale > 0 ? config.timeScale : 1,
      startSim: saved?.simNow ?? Date.now(),
      advancedTotal: saved?.advancedTotal ?? 0,
      onChange: (s) => {
        if (!dbOpen) return;
        try {
          saveClockState(db, s);
        } catch {
          /* yok say */
        }
      },
    });
    clock = scaled;
    persistClock();
    const t = setInterval(persistClock, CLOCK_PERSIST_MS);
    t.unref();
    timers.push(t);
  }

  const ctx: CoreContext = { config, db, clock };
  let ledger: AppServices["ledger"] | null = null;
  let lifecycle: AppServices["forum"]["lifecycle"] | null = null;

  try {
    const notifier = new DbNotifier(ctx);
    const audit = createAuditLogger(ctx);
    const led = createLedgerService(ctx);
    ledger = led;
    const ontology = createOntologyService(ctx);
    await ontology.init();
    // Kurucu yönetmelik (sürüm 1) deftere sabitlenir (ilk açılış/tohumlama; kayıt varsa bir şey yapılmaz).
    anchorFoundingBylaw(ontology, led);
    const graph = createGraphService(ctx, { ledger: led });
    const math = createGovernanceMath();
    const identity = createIdentityService(ctx, { ledger: led, notifier, audit });
    // client undefined: YZ modülü ortamdan karar verir (AI_ENABLED + ANTHROPIC_API_KEY); null: zorla çevrimdışı.
    const ai = createAiService(ctx, { client: opts.aiClient as AnthropicLike | null | undefined });
    const aiSink = createAiRecordSink(ctx, { ledger: led });
    const experts = createExpertService(ctx, {
      ledger: led,
      graph,
      math,
      ai,
      notifier,
      audit,
      ontology,
      householdOf: (userId) => identity.householdOf(userId),
    });
    const forum = createForumServices({ ctx, ledger: led, ontology, graph, math, identity, ai, aiSink, experts, notifier, audit });

    const services: AppServices = { ctx, clock, ledger: led, ontology, graph, math, identity, ai, aiSink, experts, notifier, audit, forum };

    await led.start();

    if (opts.startTimers !== false) {
      forum.lifecycle.start(LIFECYCLE_INTERVAL_MS);
      lifecycle = forum.lifecycle;
      // Kimlik bakımı (gerçek zamanlı): reşit olanların bayrağı, süresi geçmiş bekleyen başvuruların kripto-imhası.
      const maintenance = () => {
        try {
          identity.refreshAdulthood();
          identity.purgeStalePending();
        } catch (err) {
          audit.log(null, "system.maintenance_error", null, { error: err instanceof Error ? err.message : String(err) });
        }
      };
      maintenance();
      const t = setInterval(maintenance, MAINTENANCE_INTERVAL_MS);
      t.unref();
      timers.push(t);
    }

    const app = await buildServer(services, config, { logger: opts.logger ?? false, rateLimit: opts.rateLimit, drainMs: opts.httpDrainMs });

    let closing: Promise<void> | null = null;
    const close = (): Promise<void> => {
      closing ??= (async () => {
        // Sıra önemlidir: önce HTTP (yeni bağlantı yok, uçuştaki istekler biter — bunlar hâlâ deftere yazar), sonra yaşam döngüsü
        // (uçuştaki tick biter), sonra defter, saat, veritabanı, kilit. Bir adımın hatası sonrakileri engellemez; ilk hata fırlatılır.
        const errors: unknown[] = [];
        const step = async (fn: () => unknown): Promise<void> => {
          try {
            await fn();
          } catch (e) {
            errors.push(e);
          }
        };
        for (const t of timers) clearInterval(t);
        await step(() => app.close());
        await step(() => forum.lifecycle.stop());
        await step(() => led.flush(LEDGER_FLUSH_MS).catch(() => undefined));
        await step(() => led.stop());
        persistClock();
        dbOpen = false;
        await step(() => db.close());
        releaseLock();
        if (errors.length > 0) throw errors[0];
      })();
      return closing;
    };

    return { app, services, close };
  } catch (err) {
    // Kurulum yarıda kaldı: açılmış her şey kapatılır (defter hiç başlamamış olsa bile depoları açıktır).
    for (const t of timers) clearInterval(t);
    await lifecycle?.stop().catch(() => undefined);
    if (ledger) await ledger.stop().catch(() => undefined);
    persistClock();
    dbOpen = false;
    try {
      db.close();
    } finally {
      releaseLock();
    }
    throw err;
  }
}
