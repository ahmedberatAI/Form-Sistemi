// Yapılandırma: ortam değişkeni doğrulaması, gizli anahtar biçimi, kayıp anahtar dosyasında açılışın durması ve anahtar parmak izleri.
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createApp } from "../../src/app";
import { assertValidSecrets, loadConfig, parseEnvBool, parseEnvInt, parseEnvNumber, testConfig, type Config } from "../../src/core/config";
import { keyFingerprint } from "../../src/core/keycheck";
import { openDb } from "../../src/db";

const ENV_NAMES = ["PORT", "TIME_SCALE", "LEDGER_BLOCK_MS", "AI_ENABLED", "MASTER_KEY", "TOKEN_KEY", "VOTE_KEY", "DATA_DIR", "DB_PATH", "HOST", "AI_MODEL", "TRUST_PROXY"];
const saved: Record<string, string | undefined> = {};
let dir = "";

beforeEach(() => {
  for (const n of ENV_NAMES) {
    saved[n] = process.env[n];
    delete process.env[n];
  }
  dir = mkdtempSync(join(tmpdir(), "forum-config-"));
});

afterEach(() => {
  for (const n of ENV_NAMES) {
    if (saved[n] === undefined) delete process.env[n];
    else process.env[n] = saved[n];
  }
  rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
});

const appOpts = { startTimers: false, aiClient: null, rateLimit: false } as const;
const quick = (c: Config): Config => ({ ...c, ledgerBlockIntervalMs: 20 });

describe("ortam değişkeni ayrıştırıcıları", () => {
  it("tamsayı: boş → varsayılan; geçersiz ve aralık dışı → Türkçe hata", () => {
    expect(parseEnvInt("PORT", undefined, 4000, 1, 65535)).toBe(4000);
    expect(parseEnvInt("PORT", "", 4000, 1, 65535)).toBe(4000);
    expect(parseEnvInt("PORT", "  8080 ", 4000, 1, 65535)).toBe(8080);
    for (const bad of ["abc", "12abc", "1e3", "0x10", "-1", "80.5"]) {
      expect(() => parseEnvInt("PORT", bad, 4000, 1, 65535)).toThrow(/PORT/);
    }
    expect(() => parseEnvInt("PORT", "0", 4000, 1, 65535)).toThrow(/aralık dışı/);
    expect(() => parseEnvInt("PORT", "70000", 4000, 1, 65535)).toThrow(/aralık dışı/);
  });

  it("sayı (TIME_SCALE): ondalık olur; NaN, sıfır ve devasa değer olmaz", () => {
    expect(parseEnvNumber("TIME_SCALE", "", 60, 0.001, 1_000_000)).toBe(60);
    expect(parseEnvNumber("TIME_SCALE", "0.5", 60, 0.001, 1_000_000)).toBe(0.5);
    for (const bad of ["abc", "0", "NaN", "Infinity", "-3", "1e400"]) {
      expect(() => parseEnvNumber("TIME_SCALE", bad, 60, 0.001, 1_000_000)).toThrow(/TIME_SCALE/);
    }
  });

  it("mantıksal (AI_ENABLED): büyük/küçük harf duyarsız, yes/no/hayır; tanımsız değer hata", () => {
    for (const f of ["false", "False", "FALSE", "0", "no", "NO", "off", "Off", "hayır", "HAYIR", "hayir"]) {
      expect(parseEnvBool("AI_ENABLED", f, true)).toBe(false);
    }
    for (const t of ["true", "TRUE", "1", "yes", "on", "evet", "EVET", "auto", "AUTO", "", undefined]) {
      expect(parseEnvBool("AI_ENABLED", t, true)).toBe(true);
    }
    expect(() => parseEnvBool("AI_ENABLED", "belki", true)).toThrow(/AI_ENABLED/);
  });
});

describe("loadConfig: ortam doğrulaması", () => {
  it("boş değerler varsayılanı kullanır; AI_ENABLED=False kapatır", () => {
    process.env.PORT = "";
    process.env.TIME_SCALE = "";
    process.env.LEDGER_BLOCK_MS = "";
    process.env.HOST = "";
    process.env.AI_ENABLED = "False";
    const c = loadConfig({ dataDir: dir });
    expect(c).toMatchObject({ port: 4000, timeScale: 60, ledgerBlockIntervalMs: 400, host: "0.0.0.0", aiEnabled: false });
  });

  it("geçersiz PORT / TIME_SCALE / LEDGER_BLOCK_MS hepsi birlikte bildirilir ve diske hiçbir anahtar yazılmaz", () => {
    process.env.PORT = "abc";
    process.env.TIME_SCALE = "0";
    process.env.LEDGER_BLOCK_MS = "x";
    let msg = "";
    try {
      loadConfig({ dataDir: dir });
    } catch (e) {
      msg = (e as Error).message;
    }
    expect(msg).toMatch(/PORT/);
    expect(msg).toMatch(/TIME_SCALE/);
    expect(msg).toMatch(/LEDGER_BLOCK_MS/);
    expect(existsSync(join(dir, "keys"))).toBe(false);
  });
});

describe("gizli anahtar biçimi", () => {
  it("boş ya da kısa VOTE_KEY ortam değişkeni açılışta reddedilir", () => {
    process.env.VOTE_KEY = "";
    expect(() => loadConfig({ dataDir: dir })).toThrow(/VOTE_KEY/);
    process.env.VOTE_KEY = "x";
    expect(() => loadConfig({ dataDir: dir })).toThrow(/VOTE_KEY.*16 bayt/);
    process.env.VOTE_KEY = "ab".repeat(16);
    expect(loadConfig({ dataDir: dir }).voteKey).toBe("ab".repeat(16));
  });

  it("boş ya da bozuk anahtar dosyası yeni anahtar üretmeden reddedilir", () => {
    mkdirSync(join(dir, "keys"), { recursive: true });
    writeFileSync(join(dir, "keys", "vote.key"), "");
    expect(() => loadConfig({ dataDir: dir })).toThrow(/vote\.key.*geçersiz/);
    expect(readFileSync(join(dir, "keys", "vote.key"), "utf8")).toBe("");
  });

  it("assertValidSecrets: createApp da boş/kısa anahtarla açılmaz", async () => {
    expect(() => assertValidSecrets({ master: "11".repeat(32), token: "22".repeat(32), vote: "" })).toThrow(/VOTE_KEY/);
    expect(() => assertValidSecrets({ master: "11".repeat(32), token: "22".repeat(32), vote: "33".repeat(32) })).not.toThrow();
    await expect(createApp(testConfig({ voteKey: "" }), appOpts)).rejects.toThrow(/VOTE_KEY/);
    await expect(createApp(testConfig({ voteKey: "kisa" }), appOpts)).rejects.toThrow(/VOTE_KEY/);
  });
});

describe("anahtar–veritabanı bağı", () => {
  it("anahtar dosyası kayboluyken veritabanı doluysa yeni anahtar ÜRETİLMEZ; dosya geri gelince açılır", async () => {
    const cfg = quick(loadConfig({ dataDir: dir }));
    const first = await createApp(cfg, appOpts);
    await first.close();

    for (const f of ["master.key", "vote.key", "token.key"]) {
      const p = join(dir, "keys", f);
      const content = readFileSync(p, "utf8");
      rmSync(p);
      expect(() => loadConfig({ dataDir: dir })).toThrow(new RegExp(`${f.replace(".", "\\.")}.*ÜRETİLMEZ`));
      expect(existsSync(p)).toBe(false); // sessizce yeniden üretilmedi
      writeFileSync(p, content);
    }
    const again = await createApp(quick(loadConfig({ dataDir: dir })), appOpts);
    await again.close();
  }, 60_000);

  it("boş/yeni veri klasöründe anahtarlar üretilir (ilk açılış)", () => {
    const cfg = loadConfig({ dataDir: dir });
    for (const k of [cfg.masterKey, cfg.tokenKey, cfg.voteKey]) expect(k).toMatch(/^[0-9a-f]{64}$/);
    expect(readFileSync(join(dir, "keys", "vote.key"), "utf8")).toBe(cfg.voteKey);
  });

  it("parmak izi meta tablosuna yazılır; farklı anahtarla açılış Türkçe hatayla reddedilir (anahtar değeri sızmaz)", async () => {
    const cfg = quick(loadConfig({ dataDir: dir }));
    await (await createApp(cfg, appOpts)).close();

    const db = openDb(cfg.dbPath);
    const stored = db.get<{ value: string }>("SELECT value FROM meta WHERE key = 'key_check_vote'")?.value;
    db.close();
    expect(stored).toBe(keyFingerprint("vote", cfg.voteKey));
    expect(stored).not.toContain(cfg.voteKey);

    const otherVote = "ab".repeat(32);
    let msg = "";
    try {
      await createApp({ ...cfg, voteKey: otherVote }, appOpts);
    } catch (e) {
      msg = (e as Error).message;
    }
    expect(msg).toMatch(/Anahtar uyuşmazlığı: VOTE_KEY/);
    expect(msg).not.toContain(otherVote);
    await expect(createApp({ ...cfg, masterKey: "cd".repeat(32) }, appOpts)).rejects.toThrow(/MASTER_KEY/);
    // Aynı anahtarlarla yeniden açılış sorunsuz
    await (await createApp(cfg, appOpts)).close();
  }, 60_000);
});
