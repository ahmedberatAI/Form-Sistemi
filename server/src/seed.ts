// Demo tohum verisi: `npm run seed -w server [-- --reset [--force]]`
// Bileşim kökünü (createApp) HTTP dinlemeden kurar; tüm veri servisler üzerinden, simüle saat 1 Eylül 2026'dan
// "bugün"e ilerletilerek üretilir. Defter kayıtları gerçek BFT defterden geçer.
import { existsSync, readdirSync, rmSync, statSync } from "node:fs";
import { basename, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";
import { DatabaseSync } from "node:sqlite";
import { createApp } from "./app";
import { DAY, HOUR, ScaledClock } from "./core/clock";
import { loadConfig, SERVER_ROOT } from "./core/config";
import { acquireDataDirLock, type DataDirLock } from "./core/lock";
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

/**
 * DB_PATH, DATA_DIR/forum.db dışında bir dosyaysa (ör. ortamda DB_PATH ayarlıysa) --reset onu da (+ -wal/-shm) silmelidir;
 * yoksa eski veritabanı kalır, defter/anahtarlar sıfırlanır ve tohum tutarsız bir veritabanına yazılırdı (#342).
 * ":memory:" ve DATA_DIR/forum.db zaten RESETTABLE kapsamındadır → boş döner.
 */
export function extraDbFiles(dataDir: string, dbPath: string): string[] {
  if (dbPath === ":memory:" || dbPath === "") return [];
  const main = resolve(dbPath);
  if (main === join(resolve(dataDir), "forum.db")) return [];
  return [main, main + "-wal", main + "-shm"];
}

/** Yapılandırılmış DB_PATH (DATA_DIR/forum.db değilse) dosyalarını siler; dizin ise reddeder. */
function resetExtraDb(dataDir: string, dbPath: string): void {
  const files = extraDbFiles(dataDir, dbPath);
  if (files.length === 0) return;
  if (existsSync(files[0]) && statSync(files[0]).isDirectory()) fail(`DB_PATH bir dosya olmalı, dizin bulundu: ${files[0]}`);
  for (const f of files) if (existsSync(f)) rmSync(f, { force: true });
  console.log(`Veritabanı sıfırlandı: ${files[0]} (DB_PATH)`);
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
  const dataDir = resolve(process.env.DATA_DIR ?? join(SERVER_ROOT, "data"));
  // Sunucu (ya da başka bir betik) aynı klasörü kullanırken tohumlama/sıfırlama defter kayıtlarını bozar: tek-örnek kilidi.
  let lock: DataDirLock;
  try {
    lock = acquireDataDirLock(dataDir);
  } catch (e) {
    fail(e instanceof Error ? e.message : String(e));
  }
  try {
    await seedInto(dataDir, lock);
  } finally {
    lock.release();
  }
}

async function seedInto(dataDir: string, lock: DataDirLock): Promise<void> {
  const args = new Set(process.argv.slice(2));
  const reset = args.has("--reset");
  const force = args.has("--force");
  const quiet = args.has("--quiet");
  const dbPath = process.env.DB_PATH ?? join(dataDir, "forum.db");

  if (reset) {
    resetDataDir(dataDir, force);
    resetExtraDb(dataDir, dbPath);
  } else if (hasData(dataDir, dbPath)) {
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
  // Tohumun zamanı ilerletmesi "yönetici ileri aldı" sayılmaz (countAdvances: false → advancedTotal 0 kalır).
  // createApp, dışarıdan verilen ScaledClock'u kapanışta meta.sim_clock'a yazar: sunucu tohumun bittiği andan sürer.
  const clock = new ScaledClock({ scale: config.timeScale > 0 ? config.timeScale : 1, startSim: SIM_START, countAdvances: false });

  console.log(`Tohum verisi üretiliyor → ${dataDir}`);
  console.log(`Simüle zaman: ${new Date(SIM_START).toISOString()} → ${new Date(end).toISOString()} (TIME_SCALE=${config.timeScale})`);
  const { services, close } = await createApp(config, { startTimers: false, aiClient: null, clock, logger: false, rateLimit: false, dataLock: lock });
  let ok = false;
  try {
    const result = await runSeed(services, clock, { start: SIM_START, end, log: quiet ? undefined : (m) => console.log(m) });
    ok = result.ok;
  } finally {
    await close();
  }
  if (!ok) fail("Tohum doğrulaması başarısız; ayrıntılar yukarıdaki özette (✘ ile işaretli satırlar).");
  console.log("\n✔ Tohum verisi hazır. Sunucuyu başlatmak için: npm run dev -w server");
}

// Yalnızca doğrudan çalıştırıldığında (tsx src/seed.ts); içe aktarıldığında hiçbir şey yapmaz.
if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  main().catch((err) => {
    console.error("Tohum verisi üretilemedi:", err);
    process.exit(1);
  });
}
