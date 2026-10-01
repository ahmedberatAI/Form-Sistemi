// Saat kalıcılığı: createApp dışarıdan verilen ScaledClock'u kapanışta meta.sim_clock'a yazar; tohumun zamanı ilerletmesi
// "yönetici ileri aldı" (advancedTotal) sayılmaz; sunucu yeniden açıldığında kaldığı yerden sürer.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it } from "vitest";
import { createApp } from "../../src/app";
import { DAY, HOUR, ManualClock, ScaledClock } from "../../src/core/clock";
import { testConfig } from "../../src/core/config";

const dirs: string[] = [];
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

function tempDb(): string {
  const dir = mkdtempSync(join(tmpdir(), "forum-saat-"));
  dirs.push(dir);
  return join(dir, "forum.db");
}

function readSimClock(dbPath: string): { simNow: number; advancedTotal: number } | null {
  const db = new DatabaseSync(dbPath, { readOnly: true });
  try {
    const row = db.prepare("SELECT value FROM meta WHERE key = 'sim_clock'").get() as { value: string } | undefined;
    return row ? JSON.parse(row.value) : null;
  } finally {
    db.close();
  }
}

const opts = { startTimers: false, aiClient: null, logger: false, rateLimit: false } as const;

describe("ScaledClock: countAdvances", () => {
  it("varsayılan: advance yönetici ileri alması sayılır; countAdvances:false → saat ilerler, toplam 0 kalır", () => {
    let real = 1_000;
    const admin = new ScaledClock({ scale: 60, startSim: 0, realNow: () => real });
    admin.advance(2 * HOUR);
    expect(admin.offset()).toBe(2 * HOUR);
    const seed = new ScaledClock({ scale: 60, startSim: 0, countAdvances: false, realNow: () => real });
    seed.advance(3 * DAY);
    real += 1_000; // 1 gerçek saniye = 60 simüle saniye
    expect(seed.now()).toBe(3 * DAY + 60_000);
    expect(seed.offset()).toBe(0);
    expect(seed.snapshot()).toEqual({ simNow: 3 * DAY + 60_000, advancedTotal: 0 });
  });
});

describe("createApp: dışarıdan verilen saatin kalıcılığı", () => {
  it("ScaledClock kapanışta meta.sim_clock'a yazılır; yeni açılış kaldığı yerden ve aynı ileri alma toplamıyla sürer", async () => {
    const dbPath = tempDb();
    const start = Date.UTC(2026, 8, 1, 9, 0);
    let real = 50_000;
    const clock = new ScaledClock({ scale: 60, startSim: start, realNow: () => real });
    const app = await createApp(testConfig({ dbPath, ledgerBlockIntervalMs: 5 }), { ...opts, clock });
    expect(readSimClock(dbPath)).toBeNull(); // dış saat açılışta yazılmaz
    clock.advance(26 * HOUR);
    real += 10_000;
    const expected = clock.snapshot();
    await app.close();
    expect(readSimClock(dbPath)).toEqual(expected);
    expect(expected).toEqual({ simNow: start + 26 * HOUR + 600_000, advancedTotal: 26 * HOUR });

    // Saat verilmeden açılış: kalıcı durumdan sürer (sunucu kapalıyken simüle zaman ilerlemez).
    const again = await createApp(testConfig({ dbPath, ledgerBlockIntervalMs: 5 }), opts);
    try {
      expect(again.services.clock.now()).toBeGreaterThanOrEqual(expected.simNow);
      expect(again.services.clock.now()).toBeLessThan(expected.simNow + HOUR);
      expect(again.services.clock.offset()).toBe(26 * HOUR);
    } finally {
      await again.close();
    }
  });

  it("tohum kipi (countAdvances:false): ilerletilmiş saat kaydedilir ama advancedTotal 0", async () => {
    const dbPath = tempDb();
    const start = Date.UTC(2026, 8, 1, 9, 0);
    const clock = new ScaledClock({ scale: 60, startSim: start, countAdvances: false, realNow: () => 0 });
    const app = await createApp(testConfig({ dbPath, ledgerBlockIntervalMs: 5 }), { ...opts, clock });
    clock.advance(27 * DAY);
    await app.close();
    expect(readSimClock(dbPath)).toEqual({ simNow: start + 27 * DAY, advancedTotal: 0 });
  });

  it("persistClock:false ve ScaledClock olmayan saatler kalıcılaştırılmaz", async () => {
    const a = tempDb();
    const scaled = new ScaledClock({ scale: 60, startSim: Date.UTC(2026, 8, 1), realNow: () => 0 });
    await (await createApp(testConfig({ dbPath: a, ledgerBlockIntervalMs: 5 }), { ...opts, clock: scaled, persistClock: false })).close();
    expect(readSimClock(a)).toBeNull();

    const b = tempDb();
    const manual = new ManualClock();
    manual.advance(DAY);
    await (await createApp(testConfig({ dbPath: b, ledgerBlockIntervalMs: 5 }), { ...opts, clock: manual })).close();
    expect(readSimClock(b)).toBeNull();
  });
});
