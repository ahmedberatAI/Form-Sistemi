// Sert kapanış uçtan uca (#273, #281): taskkill /F gibi SIGKILL ile ölen bir sunucu sürecinden sonra, aynı veri klasörüyle açılan
// uygulama (1) blokta onaylanmamış defter işlemlerini giden kutusundan yeniden gönderir ve işler, (2) simüle saati son kayıtların
// gerisinden başlatmaz. Alt süreç: hard-kill-child.ts.
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp } from "../../src/app";
import { SERVER_ROOT, testConfig } from "../../src/core/config";
import { openDb } from "../../src/db";
import { loadOutbox } from "../../src/ledger/outbox";
import { IDS, waitFor } from "./util";

const dirs: string[] = [];
afterEach(() => {
  vi.restoreAllMocks();
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

const CHILD = join(SERVER_ROOT, "test", "ledger", "hard-kill-child.ts");

function persistedMempool(dir: string, id: string): string | null {
  const db = new DatabaseSync(join(dir, "ledger", `${id}.db`), { readOnly: true });
  try {
    return (db.prepare("SELECT v FROM node_state WHERE k = 'mempool'").get() as { v: string } | undefined)?.v ?? null;
  } finally {
    db.close();
  }
}

describe("sert kapanış (SIGKILL) sonrası açılış", () => {
  it("bekleyen defter işlemleri işlenir, saat son kaydın gerisine düşmez", { timeout: 180_000 }, async () => {
    const dir = mkdtempSync(join(tmpdir(), "forum-sert-kapanis-"));
    dirs.push(dir);
    const r = spawnSync(process.execPath, ["--import", "tsx", CHILD, dir], { cwd: SERVER_ROOT, encoding: "utf8", timeout: 150_000 });
    expect(r.error).toBeUndefined();
    let out: { direct: string; forum: string; at: number };
    try {
      out = JSON.parse(readFileSync(join(dir, "child.json"), "utf8"));
    } catch {
      throw new Error(`alt süreç sonuç yazmadı (çıkış ${r.status}/${r.signal}):\n${r.stderr}`);
    }
    expect(r.status === 0).toBe(false); // düzgün çıkmadı: öldürüldü

    // Ölümden sonraki disk durumu: havuzlar kalıcılaşmadı, işlemler yalnız giden kutusunda; saat kaydı kiralı ve son kaydın gerisinde.
    for (const id of IDS) expect(persistedMempool(dir, id)).toBeNull();
    const dbPath = join(dir, "forum.db");
    const before = openDb(dbPath);
    try {
      expect(loadOutbox(before).map((x) => x.hash).sort()).toEqual([out.direct, out.forum].sort());
      const saved = JSON.parse(before.get<{ value: string }>("SELECT value FROM meta WHERE key = 'sim_clock'")!.value) as {
        simNow: number;
        leaseUntil: number;
      };
      expect(saved.simNow).toBeLessThan(out.at); // yalnız kayıtlı an kullanılsaydı saat geri giderdi
      expect(saved.leaseUntil).toBeGreaterThanOrEqual(out.at);
    } finally {
      before.close();
    }

    const warn = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const config = testConfig({ dataDir: dir, dbPath, timeScale: 60, ledgerBlockIntervalMs: 5 });
    const app = await createApp(config, { startTimers: false, aiClient: null, logger: false, rateLimit: false });
    try {
      expect(warn).toHaveBeenCalledWith(expect.stringMatching(/bayat bir kilitti/)); // ölü sürecin kilidi devralındı
      expect(app.services.clock.now()).toBeGreaterThan(out.at);
      const ledger = app.services.ledger;
      await waitFor(() => ledger.getTx(out.direct) !== null && ledger.getTx(out.forum) !== null, "giden kutusundaki işlemler");
      await ledger.flush(20_000);
      expect(loadOutbox(app.services.ctx.db)).toEqual([]);
      expect(ledger.findTxs({ type: "DELEGATION" })).toHaveLength(2);
      expect(ledger.verifyChain().every((v) => v.ok)).toBe(true);
    } finally {
      await app.close();
    }
  });
});
