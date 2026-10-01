// Demo tohum verisi: `npm run seed -w server [-- --reset [--force]]`
// Bileşim kökünü (createApp) HTTP dinlemeden kurar; tüm veri servisler üzerinden, simüle saat 1 Eylül 2026'dan
// "bugün"e ilerletilerek üretilir. Defter kayıtları gerçek BFT defterden geçer.
import { existsSync, readdirSync, rmSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { createApp } from "./app";
import { DAY, HOUR, ScaledClock } from "./core/clock";
import { loadConfig, SERVER_ROOT } from "./core/config";
import { runSeed } from "./seed/index";

const SIM_START = Date.UTC(2026, 8, 1, 9, 0);
/** Senaryonun sığması için gereken asgari simüle süre (başlangıçtan bitişe). */
const MIN_SPAN = 27 * DAY;
const RESETTABLE = new Set(["forum.db", "forum.db-wal", "forum.db-shm", "ledger", "keys"]);

function fail(msg: string): never {
  console.error(`\n✘ ${msg}\n`);
  process.exit(1);
}

function hasData(dataDir: string, dbPath: string): boolean {
  if (existsSync(join(dataDir, "ledger")) && readdirSync(join(dataDir, "ledger")).length > 0) return true;
  if (!existsSync(dbPath)) return false;
  try {
    const db = new DatabaseSync(dbPath, { readOnly: true });
    try {
      return Number((db.prepare("SELECT COUNT(*) AS n FROM users").get() as { n: number } | undefined)?.n ?? 0) > 0;
    } finally {
      db.close();
    }
  } catch {
    return true; // okunamayan bir veritabanı: güvenli tarafta kal
  }
}

/** Yalnız DATA_DIR içindeki tohum dosyalarını siler. Klasör "data" değilse ve başka dosyalar içeriyorsa --force gerekir. */
function resetDataDir(dataDir: string, force: boolean): void {
  if (!existsSync(dataDir)) return;
  const entries = readdirSync(dataDir);
  const foreign = entries.filter((n) => !RESETTABLE.has(n) && !n.startsWith("."));
  if (basename(dataDir) !== "data" && foreign.length > 0 && !force) {
    fail(
      `Güvenlik: "${dataDir}" bir "data" klasörü değil ve tohuma ait olmayan dosyalar içeriyor (${foreign.slice(0, 5).join(", ")}). ` +
        "Yine de sıfırlamak için --reset --force kullanın.",
    );
  }
  for (const n of RESETTABLE) {
    const p = join(dataDir, n);
    if (existsSync(p)) rmSync(p, { recursive: true, force: true });
  }
  console.log(`Veri klasörü sıfırlandı: ${dataDir} (forum.db*, ledger/, keys/)`);
}

async function main(): Promise<void> {
  const args = new Set(process.argv.slice(2));
  const reset = args.has("--reset");
  const force = args.has("--force");
  const quiet = args.has("--quiet");
  const dataDir = resolve(process.env.DATA_DIR ?? join(SERVER_ROOT, "data"));
  const dbPath = process.env.DB_PATH ?? join(dataDir, "forum.db");

  if (reset) resetDataDir(dataDir, force);
  else if (hasData(dataDir, dbPath)) {
    fail(`Veritabanı boş değil (${dataDir}). Mevcut verinin üzerine tohum yazılmaz; sıfırlayıp yeniden üretmek için: npm run seed -w server -- --reset`);
  }

  // Tohumlama sırasında blok aralığı kısaltılır (her adımda ledger.flush beklenir); sunucu kendi ayarıyla çalışır.
  const config = loadConfig({ dataDir, ledgerBlockIntervalMs: Number(process.env.LEDGER_BLOCK_MS ?? 30) });
  const realNow = Date.now();
  let end = realNow - 3 * HOUR;
  if (end - SIM_START < MIN_SPAN) {
    end = SIM_START + MIN_SPAN;
    console.warn(`Uyarı: senaryo için 1 Eylül'den bu yana yeterli süre yok; simüle saat bugünün ilerisinde (${new Date(end).toISOString()}) bitecek.`);
  }
  const clock = new ScaledClock({ scale: config.timeScale > 0 ? config.timeScale : 1, startSim: SIM_START });

  console.log(`Tohum verisi üretiliyor → ${dataDir}`);
  console.log(`Simüle zaman: ${new Date(SIM_START).toISOString()} → ${new Date(end).toISOString()} (TIME_SCALE=${config.timeScale})`);
  const { services, close } = await createApp(config, { startTimers: false, aiClient: null, clock, logger: false, rateLimit: false });
  let ok = false;
  try {
    const result = await runSeed(services, clock, { start: SIM_START, end, log: quiet ? undefined : (m) => console.log(m) });
    ok = result.ok;
    // createApp dışarıdan verilen saati kalıcılaştırmaz: sunucunun kaldığı yerden sürmesi için meta.sim_clock yazılır.
    services.ctx.db.run(
      "INSERT INTO meta(key, value) VALUES ('sim_clock', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      JSON.stringify(clock.snapshot()),
    );
  } finally {
    await close();
  }
  if (!ok) fail("Tohum doğrulaması başarısız; ayrıntılar yukarıdaki özette (✘ ile işaretli satırlar).");
  console.log("\n✔ Tohum verisi hazır. Sunucuyu başlatmak için: npm run dev -w server");
}

main().catch((err) => {
  console.error("Tohum verisi üretilemedi:", err);
  process.exit(1);
});
