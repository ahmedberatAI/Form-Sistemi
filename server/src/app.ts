// Bileşim kökü: veritabanı, saat ve tüm servisleri kurar, HTTP sunucusunu bunlara bağlar.
import type { FastifyInstance } from "fastify";
import { ScaledClock, resumeSimTime, type Clock, type SimClockState } from "./core/clock";
import { assertValidSecrets, type Config } from "./core/config";
import { verifyKeyFingerprints } from "./core/keycheck";
import type { CoreContext, IdentityService } from "./core/contracts";
import { createAuditLogger, type AuditLogger } from "./core/audit";
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
/**
 * Çalışırken yazılan saat kaydının kirası (gerçek ms): bir sonraki periyodik kayda dek geçebilecek süre, zamanlayıcı gecikmesine
 * pay bırakmak için iki katı. Sert kapanıştan sonra saat en çok kira × ölçek kadar ileriden başlar, asla geriden değil (#281).
 */
export const CLOCK_LEASE_REAL_MS = 2 * CLOCK_PERSIST_MS;
const LIFECYCLE_INTERVAL_MS = 1_000;
const MAINTENANCE_INTERVAL_MS = 10 * 60_000;
/** Kişisel sıralama sinyal önbelleğinin düzenli temizlik aralığı (gerçek saat; önbellek ömrü 60 sn → kayıt en geç ~90 sn'de atılır). */
export const SIGNAL_CACHE_SWEEP_MS = 30_000;
/** Kapanışta bekleyen deftere yazımların işlenmesi için azami bekleme (sonra defter yine de durdurulur). */
const LEDGER_FLUSH_MS = 2_000;

/** Kimlik bakımı bağımlılıkları: yalnızca sözleşmede tanımlı iki bakım işlevi + denetim günlüğü. */
export interface IdentityMaintenanceDeps {
  identity: Pick<IdentityService, "refreshAdulthood" | "purgeStalePending">;
  audit: Pick<AuditLogger, "log">;
}

/**
 * Kimlik bakımı (gerçek zamanlı, tek sahip): reşit olanların bayrağı (refreshAdulthood) ve süresi geçmiş bekleyen başvuruların
 * kripto-imhası (purgeStalePending). Hemen bir kez, sonra her intervalMs'de bir çalışır; biri başarısız olsa da diğeri çalışır
 * ve hata denetim günlüğüne yazılır. Dönen zamanlayıcı çağıranın kapanışta temizlemesi içindir (unref edilmiştir).
 */
export function startIdentityMaintenance(deps: IdentityMaintenanceDeps, intervalMs = MAINTENANCE_INTERVAL_MS): ReturnType<typeof setInterval> {
  const guarded = (job: string, fn: () => unknown): void => {
    try {
      fn();
    } catch (err) {
      try {
        deps.audit.log(null, "system.maintenance_error", null, { job, error: err instanceof Error ? err.message : String(err) });
      } catch {
        /* günlük de yazılamıyorsa (ör. kapanış) sessizce geçilir; sonraki turda yeniden denenir */
      }
    }
  };
  const run = (): void => {
    guarded("refreshAdulthood", () => deps.identity.refreshAdulthood());
    guarded("purgeStalePending", () => deps.identity.purgeStalePending());
  };
  run();
  const t = setInterval(run, intervalMs);
  t.unref();
  return t;
}

function loadClockState(db: Db): SimClockState | null {
  const row = db.get<{ value: string }>("SELECT value FROM meta WHERE key = ?", CLOCK_META_KEY);
  const v = json<Partial<SimClockState> | null>(row?.value, null);
  if (!v || typeof v.simNow !== "number" || !Number.isFinite(v.simNow)) return null;
  const adv = typeof v.advancedTotal === "number" && Number.isFinite(v.advancedTotal) ? v.advancedTotal : 0;
  const lease = typeof v.leaseUntil === "number" && Number.isFinite(v.leaseUntil) ? v.leaseUntil : undefined;
  return lease === undefined ? { simNow: v.simNow, advancedTotal: adv } : { simNow: v.simNow, advancedTotal: adv, leaseUntil: lease };
}

/** leaseUntil yalnız çalışırken yazılan kayıtlarda bulunur; düzgün kapanış saati tam kaydeder ({simNow, advancedTotal}). */
function saveClockState(db: Db, s: SimClockState): void {
  db.run(
    "INSERT INTO meta(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    CLOCK_META_KEY,
    JSON.stringify(s.leaseUntil === undefined ? { simNow: s.simNow, advancedTotal: s.advancedTotal } : s),
  );
}

/**
 * Yalnız simüle saatle yazılan olay zamanı sütunları: "en son kayıt" seçimleri (created_at DESC, rowid DESC) ve olay sıraları
 * bunlara dayanır. Gelecekteki son tarihler (phase_ends_at, due_at, expires_at) ve gerçek saat kullanabilen kimlik/oturum/denetim
 * tabloları bilerek dışarıdadır.
 */
const RECORDED_TIME_COLUMNS: readonly (readonly [table: string, column: string])[] = [
  ["phase_events", "at"],
  ["proposals", "updated_at"],
  ["messages", "updated_at"],
  ["ballots", "updated_at"],
  ["tallies", "created_at"],
  ["cluster_snapshots", "created_at"],
  ["graph_runs", "created_at"],
  ["ai_analyses", "created_at"],
  ["expert_assignments", "updated_at"],
  ["expert_reports", "created_at"],
  ["notifications", "created_at"],
  ["ledger_outbox", "submitted_at"],
];

/** Veritabanındaki en son olay zamanı (simüle ms); kayıt yoksa null. Sert kapanış sonrası saatin tabanıdır (#281). */
export function latestRecordedSimTime(db: Db): number | null {
  const union = RECORDED_TIME_COLUMNS.map(([t, c]) => `SELECT MAX(${c}) AS m FROM ${t}`).join(" UNION ALL ");
  const r = db.get<{ m: number | bigint | null }>(`SELECT MAX(m) AS m FROM (${union})`);
  return r?.m === null || r?.m === undefined ? null : Number(r.m);
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

  // Çalışırken (periyodik / ileri alma) kira ile, düzgün kapanışta tam kaydedilir. Kira yalnız saati bu süreç kuruyorsa yazılır:
  // dışarıdan verilen saat (tohum) yalnız kapanışta kaydedilir.
  let leaseSimMs = 0;
  const withLease = (s: { simNow: number; advancedTotal: number }): SimClockState =>
    leaseSimMs > 0 ? { ...s, leaseUntil: s.simNow + leaseSimMs } : s;
  const persistClock = (final = false) => {
    if (!scaled || !dbOpen) return;
    try {
      const s = scaled.snapshot();
      saveClockState(db, final ? s : withLease(s));
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
    const scale = config.timeScale > 0 ? config.timeScale : 1;
    leaseSimMs = CLOCK_LEASE_REAL_MS * scale;
    // Sunucu kapalıyken simüle zaman ilerlemez: kaldığı yerden sürer. İlk açılışta gerçek saatten başlar. Sert kapanıştan sonra
    // saat geri gitmez: kira üst sınırından ve veritabanındaki en son olay zamanından geride başlamaz (#281).
    let latest: number | null = null;
    try {
      latest = latestRecordedSimTime(db);
    } catch {
      /* okunamazsa yalnız kayıtlı durum ve kira kullanılır */
    }
    scaled = new ScaledClock({
      scale,
      startSim: resumeSimTime(saved, latest, Date.now()),
      advancedTotal: saved?.advancedTotal ?? 0,
      onChange: (s) => {
        if (!dbOpen) return;
        try {
          saveClockState(db, withLease(s));
        } catch {
          /* yok say */
        }
      },
    });
    clock = scaled;
    persistClock();
    const t = setInterval(() => persistClock(), CLOCK_PERSIST_MS);
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
    // İmha sonrası bellek temizliği (hesap silme, başvuru reddi, bayat başvuru imhası): kişisel sıralamanın sinyal önbelleği. Forum
    // servisleri kimlikten sonra kurulduğu için kanca geç bağlanır.
    let forgetSignals: (userId: string) => void = () => {};
    const identity = createIdentityService(ctx, { ledger: led, notifier, audit, onErased: (userId) => forgetSignals(userId) });
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
    forgetSignals = (userId) => forum.discovery.forgetCache(userId);

    const services: AppServices = { ctx, clock, ledger: led, ontology, graph, math, identity, ai, aiSink, experts, notifier, audit, forum };

    await led.start();

    if (opts.startTimers !== false) {
      forum.lifecycle.start(LIFECYCLE_INTERVAL_MS);
      lifecycle = forum.lifecycle;
      // Kimlik bakımı: TEK zamanlayıcı burada (yaşam döngüsü motoru kimlik bakımı yapmaz).
      timers.push(startIdentityMaintenance({ identity, audit }));
      // Kişisel sıralamanın sinyal önbelleği: süresi dolan kayıtlar boşta da atılır (en geç TTL + bu aralık; docs/KVKK.md §4.5).
      const sweep = setInterval(() => forum.discovery.sweepCache(), SIGNAL_CACHE_SWEEP_MS);
      sweep.unref();
      timers.push(sweep);
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
        persistClock(true);
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
    persistClock(true);
    dbOpen = false;
    try {
      db.close();
    } finally {
      releaseLock();
    }
    throw err;
  }
}
