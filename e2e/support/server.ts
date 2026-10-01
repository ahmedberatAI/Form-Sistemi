// Test sunucusu: tohumlanmış şablon veri klasörünün taze bir kopyasıyla gerçek sunucuyu (server/src/index.ts) başlatır,
// /api/system yanıt verene kadar bekler ve testten sonra süreç ağacını (Windows'ta taskkill /T /F) kapatır.
// Her test dosyası kendi sunucusunu kullanır: senaryolar saati ileri aldığı için birbirlerinin verisini bozmazlar.
import { spawn, type ChildProcess } from "node:child_process";
import { cpSync, createWriteStream, existsSync, mkdirSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { BASE_PORT, ENV_KEYS, SERVER_DIR } from "./env";
import { isPortInUse, killTree, pollUntil, tailFile, tsxLoader } from "./proc";

export interface TestServer {
  /** http://127.0.0.1:<port> */
  baseURL: string;
  port: number;
  dataDir: string;
  logFile: string;
  stop(): Promise<void>;
}

let counter = 0;

function requireEnv(key: string): string {
  const v = process.env[key];
  if (!v) throw new Error(`${key} tanımlı değil: testler "npm run e2e" (playwright.config.ts küresel kurulumu) ile çalıştırılmalı.`);
  return v;
}

/**
 * Şablonun kopyasıyla sunucu başlatır. Port: BASE_PORT + paralel işçi sırası (tek işçide 4100).
 * Zaman ölçeği 1'dir (simüle saat gerçek saatle aynı hızda akar): evre geçişleri yalnızca testteki
 * "saati ileri al" işlemleriyle olur, test süresi tohumdaki açık önerilerin takvimini kaydırmaz.
 */
export async function startServer(opts: { name: string; parallelIndex?: number }): Promise<TestServer> {
  const tmpRoot = requireEnv(ENV_KEYS.tmpRoot);
  const template = requireEnv(ENV_KEYS.template);
  const port = BASE_PORT + (opts.parallelIndex ?? 0);
  const runDir = join(tmpRoot, "runs", `${String(++counter).padStart(2, "0")}-${opts.name}-${process.pid}`);
  const dataDir = join(runDir, "data");
  const logFile = join(runDir, "server.log");
  mkdirSync(runDir, { recursive: true });
  cpSync(template, dataDir, { recursive: true });

  if (await isPortInUse(port)) {
    throw new Error(`Port ${port} kullanımda. Önceki bir test sunucusu açık kalmış olabilir; kapatın ya da E2E_PORT ile başka bir taban port verin.`);
  }

  // Yüksek hız sınırı: testler kısa sürede çok sayıda giriş/istek yapar (varsayılan genel 300/dk, giriş 20/dk).
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    PORT: String(port),
    HOST: "127.0.0.1",
    DATA_DIR: dataDir,
    TIME_SCALE: "1",
    AI_ENABLED: "false",
    LOG_LEVEL: "warn",
    RATE_LIMIT_GLOBAL: process.env.RATE_LIMIT_GLOBAL ?? "100000",
    RATE_LIMIT_AUTH: process.env.RATE_LIMIT_AUTH ?? "10000",
  };
  delete env.DB_PATH;
  delete env.ANTHROPIC_API_KEY;

  // Gerçek giriş noktası (npm start ile aynı: tsx src/index.ts), tek süreç.
  const entry = join(SERVER_DIR, "src", "index.ts");
  const log = createWriteStream(logFile);
  const child: ChildProcess = spawn(process.execPath, ["--import", tsxLoader(), entry], {
    cwd: SERVER_DIR,
    env,
    shell: false,
    windowsHide: true,
    detached: process.platform !== "win32",
    stdio: ["ignore", "pipe", "pipe"],
  });
  child.stdout?.pipe(log);
  child.stderr?.pipe(log);
  let exited: number | null | undefined;
  child.on("exit", (code) => {
    exited = code;
  });
  const pidFile = join(tmpRoot, "pids", String(child.pid));
  mkdirSync(join(tmpRoot, "pids"), { recursive: true });
  writeFileSync(pidFile, String(port));

  const baseURL = `http://127.0.0.1:${port}`;
  const stop = async () => {
    if (exited === undefined) {
      killTree(child);
      await pollUntil(async () => exited !== undefined, { timeoutMs: 15_000, what: "Test sunucusunun kapanması" }).catch(() => undefined);
    }
    await pollUntil(async () => !(await isPortInUse(port)), { timeoutMs: 15_000, what: `Port ${port} serbest kalması` }).catch(() => undefined);
    rmSync(pidFile, { force: true });
    log.end();
  };

  try {
    await pollUntil(
      async () => {
        if (exited !== undefined) throw new Error(`sunucu süreci çıktı (kod ${exited})`);
        const r = await fetch(`${baseURL}/api/system`).catch(() => null);
        return r?.ok ? true : null;
      },
      { timeoutMs: 90_000, intervalMs: 250, what: `Test sunucusu (${baseURL}) açılışı`, onTimeout: () => `Sunucu günlüğü:\n${tailFile(logFile)}` },
    );
  } catch (err) {
    await stop();
    const msg = err instanceof Error ? err.message : String(err);
    throw new Error(`${msg}\nSunucu günlüğü (${logFile}):\n${tailFile(logFile)}`);
  }
  return { baseURL, port, dataDir, logFile, stop };
}

/** Küresel temizlikte: kayıtlı (açık kalmış) test sunucusu süreçlerini öldürür. */
export function killLeftoverServers(tmpRoot: string): void {
  const dir = join(tmpRoot, "pids");
  if (!existsSync(dir)) return;
  for (const name of readdirSync(dir)) {
    const pid = Number(name);
    if (Number.isInteger(pid) && pid > 0) killTree(pid);
  }
}
