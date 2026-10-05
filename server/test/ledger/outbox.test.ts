// Defter giden kutusu (#273): gönderilmiş ama blokta onaylanmamış işlemler ana veritabanında tutulur; onaylanınca silinir,
// sert kapanıştan sonra açılışta yeniden gönderilir. ForumCore satırı kaydın kendisiyle aynı DB işleminde yazar (işlemsel outbox).
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ManualClock } from "../../src/core/clock";
import { testConfig } from "../../src/core/config";
import type { CoreContext } from "../../src/core/contracts";
import type { ForumDeps } from "../../src/core/forum-contracts";
import { openDb } from "../../src/db";
import { ForumCore } from "../../src/forum/util";
import { createInProcessLedger, type InProcessLedger } from "../../src/ledger";
import { loadOutbox, recordOutbox } from "../../src/ledger/outbox";
import { prepareTx } from "../../src/ledger/tx";
import { makeCtx } from "../helpers/fakes";
import { FAST, IDS, sleep, startLedger, waitFor } from "./util";

const cleanup: (() => unknown)[] = [];
afterEach(async () => {
  vi.restoreAllMocks();
  while (cleanup.length) await cleanup.pop()!();
});

const outbox = (ctx: Pick<CoreContext, "db">): string[] => loadOutbox(ctx.db).map((r) => r.hash);

function entry(type: "DELEGATION", payload: Record<string, unknown>, submittedAt = Date.UTC(2026, 9, 1)) {
  const p = prepareTx(type, payload);
  return { hash: p.hash, type, payload: p.payload, nonce: p.nonce, submittedAt };
}

/** Kalıcı (dosya) veritabanı + doğrulayıcı depoları olan bağlam; aynı klasörle yeniden açılabilir. */
function diskCtx(dir: string): CoreContext {
  const dbPath = path.join(dir, "forum.db");
  const ctx: CoreContext = { config: testConfig({ dataDir: dir, dbPath }), db: openDb(dbPath), clock: new ManualClock() };
  cleanup.push(() => {
    try {
      ctx.db.close();
    } catch {
      /* zaten kapalı */
    }
  });
  return ctx;
}

function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "defter-giden-"));
  cleanup.unshift(() => fs.rmSync(dir, { recursive: true, force: true })); // en son (tutamaklar kapandıktan sonra) silinir
  return dir;
}

/**
 * Sert kapanış benzetimi (taskkill /F): doğrulayıcı depoları kapanış yazımları YAPILMADAN kapatılır (havuz ve konsensüs durumu
 * kalıcılaşmaz); ardından yalnız zamanlayıcılar durdurulur (stop'un kalıcılaştırma adımları kapalı depoya etki etmez).
 */
async function hardKill(l: InProcessLedger): Promise<void> {
  for (const id of l.ids) l.validator(id).store.close();
  await l.stop();
}

/** Doğrulayıcının kalıcı havuz kaydı (node_state.mempool); yoksa null. */
function persistedMempool(dir: string, id: string): string | null {
  const db = new DatabaseSync(path.join(dir, "ledger", `${id}.db`), { readOnly: true });
  try {
    return (db.prepare("SELECT v FROM node_state WHERE k = 'mempool'").get() as { v: string } | undefined)?.v ?? null;
  } finally {
    db.close();
  }
}

function forumCore(ctx: CoreContext, ledger: InProcessLedger, audit = { log: vi.fn() }): ForumCore {
  return new ForumCore({ ctx, ledger, audit } as unknown as ForumDeps);
}

describe("defter giden kutusu: yaşam döngüsü", () => {
  it("submit satırı yazar; işlem blokta onaylanınca satır silinir", async () => {
    const ctx = makeCtx();
    const l = await startLedger({}, ctx);
    cleanup.push(() => l.stop());
    const a = l.submit("DELEGATION", { delegationId: "d1", scope: "*" }).txHash;
    const b = l.submit("DELEGATION", { delegationId: "d2", scope: "*" }).txHash;
    expect(outbox(ctx)).toEqual([a, b]);
    const row = loadOutbox(ctx.db)[0];
    expect(JSON.parse(row.payload)).toEqual({ delegationId: "d1", scope: "*" });
    expect(row.submitted_at).toBe(ctx.clock.now());
    await l.flush(20_000);
    expect(l.getTx(a)).not.toBeNull();
    expect(l.getTx(b)).not.toBeNull();
    expect(outbox(ctx)).toEqual([]);
  });

  it("sert kapanış: kalıcı havuz yazılmadan ölen süreçteki bekleyen işlem açılışta giden kutusundan gönderilir", async () => {
    const dir = tempDir();
    const ctx1 = diskCtx(dir);
    const l1 = createInProcessLedger(ctx1, FAST);
    await l1.start();
    const before = await l1.submitAndWait("DELEGATION", { delegationId: "önce", scope: "*" });
    // Çoğunluk yok (4 doğrulayıcının 2'si çökük): işlem havuzda bekler, bloğa giremez.
    l1.setFault("v2", "crash");
    l1.setFault("v3", "crash");
    const late = l1.submit("DELEGATION", { delegationId: "son-an", scope: "*" }).txHash;
    await sleep(60);
    expect(l1.getTx(late)).toBeNull();
    expect(l1.validator("v0").mempool.has(late)).toBe(true);
    // Onaylanan işlemin satırı, doğrulayıcı depoları diske indirildikten (bir sonraki tick) sonra silinir.
    await waitFor(() => !outbox(ctx1).includes(before.hash), "onaylanan işlemin giden kutusu satırının silinmesi");
    expect(outbox(ctx1)).toEqual([late]);
    await hardKill(l1);
    ctx1.db.close();
    // Doğrulayıcı havuzları kalıcılaşmadı: kurtaran yalnız giden kutusu.
    for (const id of IDS) expect(persistedMempool(dir, id)).toBeNull();

    const ctx2 = diskCtx(dir);
    expect(outbox(ctx2)).toEqual([late]);
    const l2 = createInProcessLedger(ctx2, FAST);
    cleanup.push(() => l2.stop());
    await l2.start();
    await waitFor(() => l2.getTx(late) !== null, "giden kutusundan yeniden gönderilen işlem");
    await l2.flush(20_000);
    expect(l2.getTx(before.hash)!.height).toBe(before.height);
    expect(l2.findTxs({ type: "DELEGATION" }).map((t) => t.hash).sort()).toEqual([before.hash, late].sort());
    expect(outbox(ctx2)).toEqual([]);
    expect(l2.verifyChain().every((v) => v.ok)).toBe(true);
  });

  it("zincirde olan işlemin artık satırı (onaydan hemen sonra kesilmiş) açılışta yeniden gönderilmeden silinir", async () => {
    const ctx = makeCtx();
    const l = await startLedger({}, ctx);
    cleanup.push(() => l.stop());
    const e = entry("DELEGATION", { delegationId: "d1", scope: "*" });
    l.submit(e.type, e.payload);
    await l.flush(20_000);
    await l.stop();
    recordOutbox(ctx.db, e);
    await l.start(); // bellek kipi: aynı örnek, aynı zincir
    expect(outbox(ctx)).toEqual([]);
    await l.flush(20_000);
    expect(l.findTxs({ type: "DELEGATION" })).toHaveLength(1);
  });

  it("bozuk satırlar (özet tutmuyor, bilinmeyen tür, bozuk JSON) açılışta atılır, deftere girmez", async () => {
    const ctx = makeCtx();
    const good = entry("DELEGATION", { delegationId: "iyi", scope: "*" });
    recordOutbox(ctx.db, good);
    recordOutbox(ctx.db, { ...entry("DELEGATION", { delegationId: "x", scope: "*" }), hash: "f".repeat(64) });
    ctx.db.run("INSERT INTO ledger_outbox(hash, type, payload, nonce, submitted_at) VALUES (?, 'YOK', '{}', 'n', 1)", "e".repeat(64));
    ctx.db.run("INSERT INTO ledger_outbox(hash, type, payload, nonce, submitted_at) VALUES (?, 'DELEGATION', '{bozuk', 'n', 1)", "d".repeat(64));
    const l = await startLedger({}, ctx);
    cleanup.push(() => l.stop());
    expect(outbox(ctx)).toEqual([good.hash]);
    await l.flush(20_000);
    expect(l.findTxs({ type: "DELEGATION" }).map((t) => t.hash)).toEqual([good.hash]);
    expect(l.getTx(good.hash)!.submittedAt).toBe(good.submittedAt); // özgün gönderim zamanı korunur
    expect(outbox(ctx)).toEqual([]);
  });

  it("zaten zincirde olan işlem yeniden gönderilirse (ör. işlem içinde yazılmış satır) satırı silinir", async () => {
    const ctx = makeCtx();
    const l = await startLedger({}, ctx);
    cleanup.push(() => l.stop());
    const e = entry("DELEGATION", { delegationId: "d1", scope: "*" });
    l.submit(e.type, e.payload);
    await l.flush(20_000);
    recordOutbox(ctx.db, e);
    expect(l.submit(e.type, e.payload, e.nonce).txHash).toBe(e.hash);
    expect(outbox(ctx)).toEqual([]);
  });

  it("giden kutusuna yazılamazsa gönderim yine yapılır; log yükü ve hata iletisini içermez", async () => {
    const ctx = makeCtx();
    const l = await startLedger({}, ctx);
    cleanup.push(() => l.stop());
    ctx.db.exec("DROP TABLE ledger_outbox");
    const err = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const { txHash } = l.submit("DELEGATION", { delegationId: "gizli-deger", scope: "*" });
    await l.flush(20_000);
    expect(l.getTx(txHash)).not.toBeNull();
    expect(err).toHaveBeenCalledTimes(1);
    const line = String(err.mock.calls[0][0]);
    expect(line).toContain(txHash);
    expect(line).not.toContain("gizli-deger");
    expect(line).not.toMatch(/no such table/i);
    expect(line).toMatch(/errcode=\d+/); // node:sqlite kodu hep ERR_SQLITE_ERROR: asıl neden SQLite kodundadır
  });
});

describe("defter giden kutusu: ForumCore işlemsel outbox", () => {
  it("satır kayıtla aynı işlemde yazılır; gönderim COMMIT sonrasıdır; onaylanınca silinir", async () => {
    const ctx = makeCtx();
    const l = await startLedger({}, ctx);
    cleanup.push(() => l.stop());
    const core = forumCore(ctx, l);
    let inside: string[] = [];
    let mempoolInside = -1;
    const hash = core.tx(() => {
      const h = core.submit("DELEGATION", { delegationId: "f1", scope: "*" });
      inside = outbox(ctx);
      mempoolInside = l.status().mempool;
      return h;
    });
    expect(inside).toEqual([hash]); // işlem içinde, kayıtla birlikte
    expect(mempoolInside).toBe(0); // deftere henüz gönderilmedi
    await l.flush(20_000);
    expect(l.getTx(hash)).not.toBeNull();
    expect(outbox(ctx)).toEqual([]);
  });

  it("geri alınan işlem giden kutusunda satır ve defterde kayıt bırakmaz", async () => {
    const ctx = makeCtx();
    const l = await startLedger({}, ctx);
    cleanup.push(() => l.stop());
    const core = forumCore(ctx, l);
    let hash = "";
    expect(() =>
      core.tx(() => {
        hash = core.submit("DELEGATION", { delegationId: "geri", scope: "*" });
        throw new Error("geri al");
      }),
    ).toThrow("geri al");
    expect(outbox(ctx)).toEqual([]);
    await l.flush(20_000);
    expect(l.getTx(hash)).toBeNull();
  });

  it("COMMIT sonrası gönderim başarısızsa (defter durmuş) satır kalır ve defter bir sonraki açılışta işler", async () => {
    const ctx = makeCtx();
    const l1 = createInProcessLedger(ctx, FAST);
    await l1.start();
    await l1.stop();
    const audit = { log: vi.fn() };
    const err = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const core = forumCore(ctx, l1, audit);
    const hash = core.tx(() => core.submit("DELEGATION", { delegationId: "durmuş", scope: "*" }));
    expect(err).toHaveBeenCalled();
    expect(audit.log).toHaveBeenCalledWith(null, "system.ledger_submit_failed", null, expect.objectContaining({ txHash: hash, code: "ledger_stopped" }));
    expect(outbox(ctx)).toEqual([hash]);

    const l2 = createInProcessLedger(ctx, FAST);
    cleanup.push(() => l2.stop());
    await l2.start();
    await waitFor(() => l2.getTx(hash) !== null, "yeniden gönderilen forum kaydı");
    await l2.flush(20_000);
    expect(outbox(ctx)).toEqual([]);
  });
});

describe("defter giden kutusu: Db.tx içinden doğrudan gönderim (graf, bilirkişi, hesap silme)", () => {
  it("satır işlemle birlikte yazılır; işlem COMMIT olana dek doğrulayıcılara iletilmez", async () => {
    const ctx = makeCtx();
    const l = await startLedger({}, ctx);
    cleanup.push(() => l.stop());
    let mempoolInside = -1;
    let inside: string[] = [];
    const hash = ctx.db.tx(() => {
      const h = l.submit("DELEGATION", { edgeId: "e1", action: "create", commitment: "c1" }).txHash;
      inside = outbox(ctx);
      mempoolInside = l.status().mempool;
      return h;
    });
    expect(inside).toEqual([hash]);
    expect(mempoolInside).toBe(0);
    expect(l.status().mempool).toBe(1); // COMMIT sonrası bekleyenlere eklendi
    await l.flush(20_000);
    expect(l.getTx(hash)).not.toBeNull();
    expect(outbox(ctx)).toEqual([]);
  });

  it("işlem geri alınırsa (ör. sonraki adım hata verir) ne satır ne defter kaydı kalır", async () => {
    const ctx = makeCtx();
    const l = await startLedger({}, ctx);
    cleanup.push(() => l.stop());
    let hash = "";
    expect(() =>
      ctx.db.tx(() => {
        hash = l.submit("DELEGATION", { edgeId: "e2", action: "revoke", commitment: "c2" }).txHash;
        throw new Error("ikinci adım başarısız");
      }),
    ).toThrow("ikinci adım başarısız");
    expect(outbox(ctx)).toEqual([]);
    await l.flush(20_000);
    expect(l.getTx(hash)).toBeNull();
    expect(l.findTxs({ type: "DELEGATION" })).toEqual([]);
  });

  it("disk dolu: giden kutusu yazım hatası yutulmaz; asıl hata çıkar, satır/kayıt ve sonraki yazım kalıcı olmaz", async () => {
    const ctx = makeCtx();
    const l = await startLedger({}, ctx);
    cleanup.push(() => l.stop());
    const db = ctx.db;
    db.exec("CREATE TABLE demo_once (x BLOB); CREATE TABLE demo_sonra (v TEXT);");
    const err = vi.spyOn(console, "error").mockImplementation(() => undefined);
    let submitErr: unknown;
    let outer: unknown;
    try {
      db.tx(() => {
        for (let i = 0; i < 50; i++) db.run("INSERT INTO demo_once VALUES (?)", new Uint8Array(600));
        db.exec(`PRAGMA max_page_count = ${Number(db.get<{ page_count: number }>("PRAGMA page_count")!.page_count)}`);
        try {
          l.submit("DELEGATION", { edgeId: "e3", action: "revoke", commitment: "x".repeat(20_000) });
        } catch (e) {
          submitErr = e; // çağıran hatayı yakalayıp devam etse bile
        }
        db.run("INSERT INTO demo_sonra VALUES ('işlem dışına taşmamalı')");
      });
    } catch (e) {
      outer = e;
    }
    db.exec("PRAGMA max_page_count = 1073741823");
    expect((submitErr as Error).message).toMatch(/full/i);
    expect((outer as Error).message).toMatch(/full/i);
    expect((outer as Error).message).not.toMatch(/no such savepoint/i);
    expect(Number(db.get<{ c: number }>("SELECT COUNT(*) AS c FROM demo_once")!.c)).toBe(0);
    expect(Number(db.get<{ c: number }>("SELECT COUNT(*) AS c FROM demo_sonra")!.c)).toBe(0);
    expect(outbox(ctx)).toEqual([]);
    await l.flush(20_000);
    expect(l.findTxs({ type: "DELEGATION" })).toEqual([]);
    expect(err).not.toHaveBeenCalled(); // işlem içinde yutulup günlüğe düşmedi; asıl hata çağırana gitti
  });

  it("kalıcı kip: onaylanan işlemin satırı doğrulayıcı depoları diske indirilmeden (sync) silinmez", async () => {
    const dir = tempDir();
    const ctx = diskCtx(dir);
    // Tick seyrek: silme yalnız flush/tick'teki sync'ten sonra olur.
    const l = createInProcessLedger(ctx, { ...FAST, timeoutMs: 60_000 });
    cleanup.push(() => l.stop());
    await l.start();
    const seen: number[] = [];
    for (const id of l.ids) {
      const store = l.validator(id).store;
      const real = store.sync.bind(store);
      vi.spyOn(store, "sync").mockImplementation(() => {
        seen.push(outbox(ctx).length); // sync anında satır hâlâ duruyor olmalı
        real();
      });
    }
    const c = await l.submitAndWait("DELEGATION", { edgeId: "e4", action: "create", commitment: "c4" });
    expect(l.getTx(c.hash)).not.toBeNull();
    expect(outbox(ctx)).toEqual([c.hash]); // blokta, ama depolar henüz diske indirilmedi
    await l.flush(20_000);
    expect(seen).toEqual([1, 1, 1, 1]); // dört depo da satır silinmeden önce indirildi
    expect(outbox(ctx)).toEqual([]);
  });
});
