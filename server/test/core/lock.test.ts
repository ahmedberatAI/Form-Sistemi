// Veri klasörü tek-örnek kilidi (#329): iki süreç aynı DATA_DIR'i paylaşırsa defter kayıtları sessizce kaybolur.
import { existsSync, mkdtempSync, readFileSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../../src/app";
import { testConfig } from "../../src/core/config";
import { acquireDataDirLock, DataDirLockedError, LOCK_FILE_NAME } from "../../src/core/lock";

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "forum-lock-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const lockPath = () => join(dir, LOCK_FILE_NAME);
const appOpts = { startTimers: false, aiClient: null, rateLimit: false } as const;
const fileCfg = () => testConfig({ dataDir: dir, dbPath: join(dir, "forum.db"), ledgerBlockIntervalMs: 5 });

describe("acquireDataDirLock", () => {
  it("kilit dosyasını PID ile oluşturur; ikinci alım Türkçe hatayla reddedilir; bırakınca yeniden alınabilir", () => {
    const lock = acquireDataDirLock(dir);
    expect(JSON.parse(readFileSync(lockPath(), "utf8")).pid).toBe(process.pid);
    expect(() => acquireDataDirLock(dir)).toThrow(DataDirLockedError);
    expect(() => acquireDataDirLock(dir)).toThrow(/başka bir süreç tarafından kullanılıyor/);
    lock.release();
    expect(existsSync(lockPath())).toBe(false);
    lock.release(); // ikinci bırakma zararsız
    acquireDataDirLock(dir).release();
  });

  it("başka bir CANLI sürecin kilidi devralınmaz", () => {
    writeFileSync(lockPath(), JSON.stringify({ pid: process.ppid, startedAt: Date.now(), token: "x" }));
    let err: unknown;
    try {
      acquireDataDirLock(dir);
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(DataDirLockedError);
    expect((err as DataDirLockedError).holderPid).toBe(process.ppid);
    expect(existsSync(lockPath())).toBe(true); // başkasının kilidi silinmedi
  });

  it("ölü PID'e ait bayat kilit uyarıyla devralınır", () => {
    writeFileSync(lockPath(), JSON.stringify({ pid: 2_000_000_000, startedAt: 1, token: "eski" }));
    const warn = vi.fn();
    const lock = acquireDataDirLock(dir, { warn });
    expect(warn).toHaveBeenCalledOnce();
    expect(warn.mock.calls[0][0]).toMatch(/bayat/);
    expect(JSON.parse(readFileSync(lockPath(), "utf8")).pid).toBe(process.pid);
    lock.release();
    expect(existsSync(lockPath())).toBe(false);
  });

  it("eski bozuk kilit dosyası bayat sayılır; yeni oluşturulmuş boş dosya (yazım sürüyor olabilir) kilitli sayılır", () => {
    writeFileSync(lockPath(), "");
    expect(() => acquireDataDirLock(dir, { warn: () => undefined })).toThrow(DataDirLockedError);
    const old = new Date(Date.now() - 60_000);
    utimesSync(lockPath(), old, old);
    acquireDataDirLock(dir, { warn: () => undefined }).release();
  });

  it("başkasının devraldığı kilidi bırakırken silmez (belirteç eşleşmesi)", () => {
    const lock = acquireDataDirLock(dir);
    writeFileSync(lockPath(), JSON.stringify({ pid: process.ppid, startedAt: Date.now(), token: "baska" }));
    lock.release();
    expect(existsSync(lockPath())).toBe(true);
  });

  it('":memory:" için kilit alınmaz', () => {
    const lock = acquireDataDirLock(":memory:");
    lock.release();
    expect(existsSync(":memory:")).toBe(false);
    acquireDataDirLock(":memory:").release();
  });
});

describe("createApp veri klasörü kilidi", () => {
  it("aynı klasörde ikinci örnek açılmaz; kapanışta kilit bırakılır ve yeniden açılabilir", async () => {
    const first = await createApp(fileCfg(), appOpts);
    try {
      expect(existsSync(lockPath())).toBe(true);
      await expect(createApp(fileCfg(), appOpts)).rejects.toThrow(DataDirLockedError);
      expect(existsSync(lockPath())).toBe(true); // reddedilen örnek birincinin kilidini silmedi
    } finally {
      await first.close();
    }
    expect(existsSync(lockPath())).toBe(false);
    const again = await createApp(fileCfg(), appOpts);
    await again.close();
  }, 30_000);

  it("dataLock verilirse createApp kilidi almaz ve kapanışta bırakmaz (sahibi çağıran)", async () => {
    const lock = acquireDataDirLock(dir);
    const app = await createApp(fileCfg(), { ...appOpts, dataLock: lock });
    await app.close();
    expect(existsSync(lockPath())).toBe(true);
    lock.release();
    expect(existsSync(lockPath())).toBe(false);
  }, 30_000);

  it("kurulum hatasında kilit bırakılır ve defter/DB tutamakları serbest kalır (klasör silinebilir)", async () => {
    const cfg = { ...fileCfg(), ontologyDir: join(dir, "yok-boyle-bir-klasor") };
    await expect(createApp(cfg, appOpts)).rejects.toThrow();
    expect(existsSync(lockPath())).toBe(false);
    // Windows'ta açık SQLite tutamakları (v0.db-wal …) silmeyi EPERM ile engellerdi (#79).
    expect(existsSync(join(dir, "ledger"))).toBe(true);
    expect(() => rmSync(join(dir, "ledger"), { recursive: true })).not.toThrow();
    const ok = await createApp(fileCfg(), appOpts);
    await ok.close();
  }, 30_000);
});

