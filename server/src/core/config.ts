// Ortam değişkenlerinden yapılandırma. Gizli anahtarlar ASLA koda/veritabanına/loga yazılmaz.
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
export const SERVER_ROOT = resolve(here, "..", "..");

export interface Config {
  port: number;
  host: string;
  dataDir: string;
  dbPath: string;
  /** Kimlik kasası ana anahtarı (32 bayt hex). Üretimde KMS/ortam değişkeninden gelir. */
  masterKey: string;
  /** Oturum belirteci imza anahtarı */
  tokenKey: string;
  /** ballotId = HMAC(voteKey, …) */
  voteKey: string;
  /** Demo: gerçek süreler bu katsayıya bölünür (60 → 1 saat = 1 dakika). */
  timeScale: number;
  aiModel: string;
  aiEnabled: boolean;
  /** Yalnızca "in-process" desteklenir: dört doğrulayıcı aynı süreçte, bellek içi ağla çalışır (MIMARI.md §4). */
  ledgerMode: "in-process" | "multi-process";
  ledgerBlockIntervalMs: number;
  corsOrigins: string[];
  webDist: string;
  ontologyDir: string;
}

/** LEDGER_MODE ortam değişkeni: desteklenmeyen değer sessizce yok sayılmaz, uyarıyla "in-process" kullanılır. */
function ledgerModeFromEnv(): Config["ledgerMode"] {
  const v = process.env.LEDGER_MODE?.trim();
  if (v && v !== "in-process") {
    console.warn(`[yapılandırma] LEDGER_MODE=${v} desteklenmiyor; defter doğrulayıcıları uygulama sunucusuyla aynı süreçte çalışır (in-process).`);
  }
  return "in-process";
}

function loadOrCreateSecret(dir: string, name: string): string {
  const p = join(dir, "keys", name);
  if (existsSync(p)) return readFileSync(p, "utf8").trim();
  mkdirSync(dirname(p), { recursive: true });
  const k = randomBytes(32).toString("hex");
  writeFileSync(p, k, { mode: 0o600 });
  return k;
}

export function loadConfig(overrides: Partial<Config> = {}): Config {
  const dataDir = overrides.dataDir ?? process.env.DATA_DIR ?? join(SERVER_ROOT, "data");
  const cfg: Config = {
    port: Number(process.env.PORT ?? 4000),
    host: process.env.HOST ?? "0.0.0.0",
    dataDir,
    dbPath: process.env.DB_PATH ?? join(dataDir, "forum.db"),
    masterKey: process.env.MASTER_KEY ?? loadOrCreateSecret(dataDir, "master.key"),
    tokenKey: process.env.TOKEN_KEY ?? loadOrCreateSecret(dataDir, "token.key"),
    voteKey: process.env.VOTE_KEY ?? loadOrCreateSecret(dataDir, "vote.key"),
    timeScale: Number(process.env.TIME_SCALE ?? 60),
    aiModel: process.env.AI_MODEL ?? "claude-opus-5-5",
    aiEnabled: (process.env.AI_ENABLED ?? "auto") !== "false",
    ledgerMode: ledgerModeFromEnv(),
    ledgerBlockIntervalMs: Number(process.env.LEDGER_BLOCK_MS ?? 400),
    corsOrigins: (process.env.CORS_ORIGINS ?? "http://localhost,http://localhost:5173,capacitor://localhost,https://localhost")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean),
    webDist: process.env.WEB_DIST ?? resolve(SERVER_ROOT, "..", "web", "dist"),
    ontologyDir: process.env.ONTOLOGY_DIR ?? join(SERVER_ROOT, "ontology"),
    ...overrides,
  };
  return cfg;
}

/** Testler için sabit anahtarlı, bellek içi yapılandırma. */
export function testConfig(overrides: Partial<Config> = {}): Config {
  return {
    port: 0,
    host: "127.0.0.1",
    dataDir: ":memory:",
    dbPath: ":memory:",
    masterKey: "11".repeat(32),
    tokenKey: "22".repeat(32),
    voteKey: "33".repeat(32),
    timeScale: 1,
    aiModel: "claude-opus-5-5",
    aiEnabled: false,
    ledgerMode: "in-process",
    ledgerBlockIntervalMs: 20,
    corsOrigins: ["*"],
    webDist: "",
    ontologyDir: join(SERVER_ROOT, "ontology"),
    ...overrides,
  };
}
