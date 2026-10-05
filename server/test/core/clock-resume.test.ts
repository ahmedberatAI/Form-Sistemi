// Simüle saat sert kapanıştan sonra geri gitmez (#281): çalışırken yazılan saat kaydı bir kira üst sınırı (leaseUntil) taşır;
// açılışta saat kayıtlı andan, kiradan ve veritabanındaki en son olay zamanından geride başlamaz. Düzgün kapanış saati tam kaydeder.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { CLOCK_LEASE_REAL_MS, createApp, latestRecordedSimTime } from "../../src/app";
import { HOUR, ScaledClock, resumeSimTime } from "../../src/core/clock";
import { testConfig } from "../../src/core/config";
import { openDb, openMemoryDb, type Db } from "../../src/db";

const dirs: string[] = [];
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

function tempDb(): string {
  const dir = mkdtempSync(join(tmpdir(), "forum-saat-geri-"));
  dirs.push(dir);
  return join(dir, "forum.db");
}

const S = Date.UTC(2026, 8, 10, 12, 0);
const SCALE = 60;
const LEASE = CLOCK_LEASE_REAL_MS * SCALE;
const opts = { startTimers: false, aiClient: null, logger: false, rateLimit: false } as const;
const config = (dbPath: string) => testConfig({ dbPath, timeScale: SCALE, ledgerBlockIntervalMs: 5 });

function readClock(db: Db): Record<string, number> | null {
  const row = db.get<{ value: string }>("SELECT value FROM meta WHERE key = 'sim_clock'");
  return row ? (JSON.parse(row.value) as Record<string, number>) : null;
}

function withDb(dbPath: string, fn: (db: Db) => void): void {
  const db = openDb(dbPath);
  try {
    fn(db);
  } finally {
    db.close();
  }
}

function writeClock(db: Db, v: Record<string, number>): void {
  db.run("INSERT INTO meta(key, value) VALUES ('sim_clock', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value", JSON.stringify(v));
}

function insertGraphRun(db: Db, id: string, createdAt: number): void {
  db.run(
    "INSERT INTO graph_runs(id, algo, version, params, seed, input_hash, output_hash, result, ledger_tx, created_at) VALUES (?, 'a', '1', '{}', NULL, 'i', 'o', '{}', NULL, ?)",
    id,
    createdAt,
  );
}

describe("resumeSimTime", () => {
  const real = Date.UTC(2026, 9, 5);
  it("ilk açılış: gerçek saat; yine de mevcut kayıtların gerisine düşmez", () => {
    expect(resumeSimTime(null, null, real)).toBe(real);
    expect(resumeSimTime(null, real - 1000, real)).toBe(real);
    expect(resumeSimTime(null, real + 5000, real)).toBe(real + 5001);
  });

  it("düzgün kapanış sonrası kayıtlı an aynen sürer (sunucu kapalıyken simüle zaman ilerlemez)", () => {
    expect(resumeSimTime({ simNow: S, advancedTotal: 0 }, null, real)).toBe(S);
    expect(resumeSimTime({ simNow: S, advancedTotal: 0 }, S - 10, real)).toBe(S);
  });

  it("sert kapanış: kira üst sınırı ve en son olay zamanının büyüğü", () => {
    expect(resumeSimTime({ simNow: S, advancedTotal: 0, leaseUntil: S + LEASE }, S + 1000, real)).toBe(S + LEASE);
    expect(resumeSimTime({ simNow: S, advancedTotal: 0, leaseUntil: S + LEASE }, S + 2 * LEASE, real)).toBe(S + 2 * LEASE + 1);
    expect(resumeSimTime({ simNow: S, advancedTotal: 0 }, S + 3 * HOUR, real)).toBe(S + 3 * HOUR + 1);
    expect(resumeSimTime({ simNow: S, advancedTotal: 0, leaseUntil: Number.NaN }, null, real)).toBe(S);
  });
});

describe("ScaledClock: çalışırken geri gitmez", () => {
  it("duvar saati geri adım atarsa simüle saat azalmaz; duvar saati yetişince yeniden akar", () => {
    let real = Date.UTC(2026, 9, 5, 12);
    const c = new ScaledClock({ scale: SCALE, startSim: S, realNow: () => real });
    real += 10_000;
    const t1 = c.now();
    expect(t1).toBe(S + 10_000 * SCALE);
    real -= 2_000; // ör. zaman eşitlemesi saati 2 sn geri aldı (×60 = 120 simüle sn)
    expect(c.now()).toBe(t1);
    expect(c.snapshot().simNow).toBe(t1);
    real += 1_000; // henüz yetişmedi
    expect(c.now()).toBe(t1);
    real += 1_500; // yetişti ve geçti: yeniden akar
    expect(c.now()).toBe(S + 10_500 * SCALE);
    // Azalan bir gerçek saat dizisinde hiçbir okuma bir öncekinden küçük değildir.
    let prev = c.now();
    for (const d of [-5_000, 300, -50, -1, 7_000, -7_000, 10]) {
      real += d;
      const t = c.now();
      expect(t).toBeGreaterThanOrEqual(prev);
      prev = t;
    }
  });

  it("saat geri adım yüzünden beklerken ileri alma tam süre kadar etkilidir", () => {
    let real = Date.UTC(2026, 9, 5, 12);
    const c = new ScaledClock({ scale: SCALE, startSim: S, realNow: () => real });
    real += 10_000;
    const t1 = c.now();
    real -= 5_000;
    c.advance(HOUR);
    expect(c.now()).toBe(t1 + HOUR);
    expect(c.offset()).toBe(HOUR);
  });
});

describe("latestRecordedSimTime", () => {
  it("yalnız simüle olay sütunlarını sayar; gelecekteki son tarihler ve kimlik/oturum tabloları sayılmaz", () => {
    const db = openMemoryDb();
    expect(latestRecordedSimTime(db)).toBeNull();
    db.run("INSERT INTO users(id, nickname, nickname_norm, password_hash, created_at) VALUES ('u1', 'a', 'a', 'x', ?)", S + 100 * HOUR);
    db.run("INSERT INTO sessions(id, user_id, created_at, expires_at) VALUES ('s1', 'u1', ?, ?)", S, S + 1000 * HOUR);
    expect(latestRecordedSimTime(db)).toBeNull();
    insertGraphRun(db, "g1", S + HOUR);
    db.run("INSERT INTO notifications(id, user_id, kind, title, body, created_at) VALUES ('n1', 'u1', 'k', 't', 'b', ?)", S + 2 * HOUR);
    db.run("INSERT INTO ledger_outbox(hash, type, payload, nonce, submitted_at) VALUES ('h', 'DELEGATION', '{}', 'n', ?)", S + 90 * 60_000);
    expect(latestRecordedSimTime(db)).toBe(S + 2 * HOUR);
  });
});

describe("createApp: sert kapanış sonrası saat", () => {
  it("çalışırken yazılan kayıt kira taşır (açılış ve ileri alma); düzgün kapanış kirasız tam kaydeder", async () => {
    const dbPath = tempDb();
    withDb(dbPath, (db) => writeClock(db, { simNow: S, advancedTotal: 0 }));
    const app = await createApp(config(dbPath), opts);
    try {
      const running = readClock(app.services.ctx.db)!;
      expect(running.leaseUntil).toBe(running.simNow + LEASE);
      expect(running.simNow).toBeGreaterThanOrEqual(S);
      app.services.clock.advance(HOUR);
      const advanced = readClock(app.services.ctx.db)!;
      expect(advanced.advancedTotal).toBe(HOUR);
      expect(advanced.leaseUntil).toBe(advanced.simNow + LEASE);
    } finally {
      await app.close();
    }
    withDb(dbPath, (db) => {
      const closed = readClock(db)!;
      expect(Object.keys(closed).sort()).toEqual(["advancedTotal", "simNow"]);
      expect(closed.simNow).toBeGreaterThanOrEqual(S + HOUR);
    });
  });

  it("çökme sonrası (kayıt kiralı): saat kira üst sınırından başlar, ileri alma toplamı korunur", async () => {
    const dbPath = tempDb();
    withDb(dbPath, (db) => writeClock(db, { simNow: S, advancedTotal: 7, leaseUntil: S + LEASE }));
    const app = await createApp(config(dbPath), opts);
    try {
      expect(app.services.clock.now()).toBeGreaterThanOrEqual(S + LEASE);
      expect(app.services.clock.now()).toBeLessThan(S + LEASE + HOUR);
      expect(app.services.clock.offset()).toBe(7);
    } finally {
      await app.close();
    }
  });

  it("kayıtlı saat olay kayıtlarının gerisindeyse (eski biçim, kira yok) en son kaydın ilerisinden başlar", async () => {
    const dbPath = tempDb();
    withDb(dbPath, (db) => {
      writeClock(db, { simNow: S, advancedTotal: 0 });
      insertGraphRun(db, "eski", S - HOUR);
      insertGraphRun(db, "yeni", S + 3 * HOUR);
    });
    const app = await createApp(config(dbPath), opts);
    try {
      expect(app.services.clock.now()).toBeGreaterThan(S + 3 * HOUR);
      // Yeni kayıt, "en son kayıt" seçiminde eskilerin önüne geçer.
      insertGraphRun(app.services.ctx.db, "sonraki", app.services.clock.now());
      const latest = app.services.ctx.db.get<{ id: string }>("SELECT id FROM graph_runs ORDER BY created_at DESC, rowid DESC LIMIT 1");
      expect(latest?.id).toBe("sonraki");
    } finally {
      await app.close();
    }
  });

  it("dışarıdan verilen saat (tohum) kira yazmaz; açılış tabanı yalnız kendi kurduğu saate uygulanır", async () => {
    const dbPath = tempDb();
    withDb(dbPath, (db) => insertGraphRun(db, "ileri", S + 10 * HOUR));
    const clock = new ScaledClock({ scale: SCALE, startSim: S, realNow: () => 0 });
    const app = await createApp(config(dbPath), { ...opts, clock });
    try {
      expect(app.services.clock.now()).toBe(S);
      expect(readClock(app.services.ctx.db)).toBeNull();
    } finally {
      await app.close();
    }
    withDb(dbPath, (db) => expect(readClock(db)).toEqual({ simNow: S, advancedTotal: 0 }));
  });
});
