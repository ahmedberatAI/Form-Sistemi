// Ortam değişkenlerinden yapılandırma. Gizli anahtarlar ASLA koda/veritabanına/loga yazılmaz.
import { randomBytes } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { databaseFileHasKeyBoundData, SECRET_ENV, type SecretName } from "./keycheck";

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

// ───────────── Ortam değişkeni ayrıştırma ─────────────
// Boş dize "tanımsız" sayılır (varsayılan kullanılır); geçersiz değer sessizce yutulmaz, açılışta Türkçe hatayla reddedilir.

function envText(name: string): string | undefined {
  const v = process.env[name]?.trim();
  return v ? v : undefined;
}

/** Tamsayı ortam değişkeni: yalnız onluk rakamlar ("1e3", "0x10", "12abc", ondalık kabul edilmez); aralık dışı reddedilir. */
export function parseEnvInt(name: string, raw: string | undefined, def: number, min: number, max: number): number {
  const v = raw?.trim();
  if (!v) return def;
  if (!/^\d+$/.test(v)) throw new Error(`${name}="${v}" geçersiz: ${min} ile ${max} arasında bir tamsayı olmalıdır.`);
  const n = Number(v);
  if (!Number.isSafeInteger(n) || n < min || n > max) throw new Error(`${name}=${v} aralık dışı: ${min} ile ${max} arasında olmalıdır.`);
  return n;
}

/** Ondalıklı sayı ortam değişkeni (ör. TIME_SCALE=0.5): sonlu ve [min, max] aralığında olmalıdır. */
export function parseEnvNumber(name: string, raw: string | undefined, def: number, min: number, max: number): number {
  const v = raw?.trim();
  if (!v) return def;
  if (!/^\d+(\.\d+)?$/.test(v)) throw new Error(`${name}="${v}" geçersiz: ${min} ile ${max} arasında bir sayı olmalıdır.`);
  const n = Number(v);
  if (!Number.isFinite(n) || n < min || n > max) throw new Error(`${name}=${v} aralık dışı: ${min} ile ${max} arasında olmalıdır.`);
  return n;
}

const TRUE_WORDS = new Set(["true", "1", "yes", "on", "evet", "auto"]);
const FALSE_WORDS = new Set(["false", "0", "no", "off", "hayır", "hayir"]);

/** Mantıksal ortam değişkeni (büyük/küçük harf duyarsız): true/1/yes/on/evet/auto ↔ false/0/no/off/hayır. */
export function parseEnvBool(name: string, raw: string | undefined, def: boolean): boolean {
  const v = raw?.trim().toLocaleLowerCase("tr-TR");
  if (!v) return def;
  if (TRUE_WORDS.has(v)) return true;
  if (FALSE_WORDS.has(v)) return false;
  throw new Error(`${name}="${raw?.trim()}" geçersiz: true/false, 1/0, evet/hayır, yes/no, on/off ya da auto olmalıdır.`);
}

// ───────────── Gizli anahtarlar ─────────────

/**
 * Anahtar biçimi: MASTER_KEY en az 32 bayt hex; TOKEN_KEY/VOTE_KEY en az 32 hex karakter (16 bayt) ya da en az 16 baytlık metin.
 * Hata iletisi ya da null; anahtar değeri iletiye yazılmaz.
 */
export function secretProblem(name: SecretName, value: string): string | null {
  const label = SECRET_ENV[name];
  if (!value) return `${label} boş olamaz.`;
  if (name === "master") {
    return /^[0-9a-fA-F]{64,}$/.test(value) && value.length % 2 === 0 ? null : `${label} en az 32 baytlık (64+ karakter) onaltılık (hex) dize olmalıdır.`;
  }
  const bytes = /^[0-9a-fA-F]+$/.test(value) && value.length >= 32 && value.length % 2 === 0 ? value.length / 2 : Buffer.byteLength(value, "utf8");
  return bytes >= 16 ? null : `${label} en az 16 bayt (32 hex karakter) olmalıdır.`;
}

/** Üç gizli anahtarı da denetler; geçersizlerin hepsini tek hatada bildirir. */
export function assertValidSecrets(keys: Record<SecretName, string>): void {
  const problems = (Object.keys(SECRET_ENV) as SecretName[]).map((n) => secretProblem(n, keys[n])).filter((p): p is string => p !== null);
  if (problems.length) throw new Error(`Geçersiz gizli anahtar yapılandırması:\n  - ${problems.join("\n  - ")}`);
}

const SECRET_FILE: Record<SecretName, string> = { master: "master.key", token: "token.key", vote: "vote.key" };

type SecretSource = { value: string } | { create: string };

/**
 * Anahtarı çözer: ortam değişkeni (boş dahil tanımlıysa doğrulanır) > DATA_DIR/keys/<dosya>. Dosya yoksa ve veritabanında zaten
 * anahtara bağlı veri varsa YENİ ANAHTAR ÜRETİLMEZ (kimlik kasası kalıcı olarak okunamaz olurdu); açılış hatayla durur.
 * Üretim, tüm doğrulamalar geçtikten sonra yapılır (hata varken diske hiçbir şey yazılmaz).
 */
function resolveSecret(name: SecretName, dataDir: string, dbPath: string, problems: string[], given?: string): SecretSource {
  // Çağıran anahtarı açıkça verdiyse (ör. test/araç) dosya aranmaz; biçimi createApp başlangıcında denetlenir.
  if (given !== undefined) return { value: given };
  const envName = SECRET_ENV[name];
  const fromEnv = process.env[envName];
  if (fromEnv !== undefined) {
    const value = fromEnv.trim();
    const bad = secretProblem(name, value);
    if (bad) problems.push(bad);
    return { value };
  }
  const p = join(dataDir, "keys", SECRET_FILE[name]);
  if (existsSync(p)) {
    const value = readFileSync(p, "utf8").trim();
    const bad = secretProblem(name, value);
    if (bad) problems.push(`${p} dosyası geçersiz (boş ya da bozuk): ${bad} Dosyayı yedekten geri yükleyin; sunucu yeni anahtar üretmez.`);
    return { value };
  }
  if (databaseFileHasKeyBoundData(dbPath)) {
    problems.push(
      `${p} bulunamadı, ancak veritabanında (${dbPath}) bu anahtara bağlı veri var; yeni anahtar ÜRETİLMEZ (kimlik kasası, oy kimlikleri ve oturumlar okunamaz hâle gelirdi). ` +
        `Anahtar dosyasını yedekten geri yükleyin ya da ${envName} ortam değişkenini verin.`,
    );
    return { value: "" };
  }
  return { create: p };
}

function writeNewSecret(p: string): string {
  mkdirSync(dirname(p), { recursive: true });
  const k = randomBytes(32).toString("hex");
  try {
    writeFileSync(p, k, { mode: 0o600, flag: "wx" });
    return k;
  } catch (e) {
    // Yarış: başka bir süreç aynı anda üretmiş olabilir; onun yazdığını kullan.
    if ((e as NodeJS.ErrnoException).code === "EEXIST") return readFileSync(p, "utf8").trim();
    throw e;
  }
}

export function loadConfig(overrides: Partial<Config> = {}): Config {
  const dataDir = overrides.dataDir ?? process.env.DATA_DIR ?? join(SERVER_ROOT, "data");
  const dbPath = overrides.dbPath ?? process.env.DB_PATH ?? join(dataDir, "forum.db");
  // Önce tüm ortam değerleri doğrulanır, hatalar toplanır; diske ancak hepsi geçerliyse dokunulur.
  const problems: string[] = [];
  const take = <T>(fallback: T, fn: () => T): T => {
    try {
      return fn();
    } catch (e) {
      problems.push(e instanceof Error ? e.message : String(e));
      return fallback;
    }
  };
  const port = take(4000, () => parseEnvInt("PORT", process.env.PORT, 4000, 1, 65535));
  const timeScale = take(60, () => parseEnvNumber("TIME_SCALE", process.env.TIME_SCALE, 60, 0.001, 1_000_000));
  const ledgerBlockIntervalMs = take(400, () => parseEnvInt("LEDGER_BLOCK_MS", process.env.LEDGER_BLOCK_MS, 400, 1, 600_000));
  const aiEnabled = take(true, () => parseEnvBool("AI_ENABLED", process.env.AI_ENABLED, true));
  const names: SecretName[] = ["master", "token", "vote"];
  const sources = Object.fromEntries(names.map((n) => [n, resolveSecret(n, dataDir, dbPath, problems, overrides[`${n}Key` as const])])) as Record<SecretName, SecretSource>;
  if (problems.length) throw new Error(`Yapılandırma geçersiz, sunucu başlatılmadı:\n  - ${problems.join("\n  - ")}`);
  const secret = (n: SecretName): string => {
    const s = sources[n];
    return "value" in s ? s.value : writeNewSecret(s.create);
  };
  const cfg: Config = {
    port,
    host: envText("HOST") ?? "0.0.0.0",
    dataDir,
    dbPath,
    masterKey: secret("master"),
    tokenKey: secret("token"),
    voteKey: secret("vote"),
    timeScale,
    aiModel: envText("AI_MODEL") ?? "claude-opus-5-5",
    aiEnabled,
    ledgerMode: ledgerModeFromEnv(),
    ledgerBlockIntervalMs,
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
