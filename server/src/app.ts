// Bileşim kökü: veritabanı, saat ve tüm servisleri kurar, HTTP sunucusunu bunlara bağlar.
import type { FastifyInstance } from "fastify";
import { ScaledClock, type Clock } from "./core/clock";
import { assertValidSecrets, type Config } from "./core/config";
import { verifyKeyFingerprints } from "./core/keycheck";
import type { CoreContext } from "./core/contracts";
import { createAuditLogger } from "./core/audit";
import { DbNotifier } from "./core/notifier";
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
  const db = openDb(config.dbPath);
  try {
    verifyKeyFingerprints(db, secrets);
  } catch (err) {
    db.close();
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
  let ledgerStarted = false;
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
    ledgerStarted = true;

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

    const app = await buildServer(services, config, { logger: opts.logger ?? false, rateLimit: opts.rateLimit });

    let closing: Promise<void> | null = null;
    const close = (): Promise<void> => {
      closing ??= (async () => {
        forum.lifecycle.stop();
        for (const t of timers) clearInterval(t);
        try {
          await led.stop();
        } finally {
          persistClock();
          try {
            await app.close();
          } finally {
            dbOpen = false;
            db.close();
          }
        }
      })();
      return closing;
    };

    return { app, services, close };
  } catch (err) {
    lifecycle?.stop();
    for (const t of timers) clearInterval(t);
    if (ledger && ledgerStarted) await ledger.stop().catch(() => undefined);
    persistClock();
    dbOpen = false;
    db.close();
    throw err;
  }
}
