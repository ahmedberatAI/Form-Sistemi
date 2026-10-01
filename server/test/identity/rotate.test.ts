// Ana anahtar dönüşümü: DEK'ler yeni KEK ile yeniden sarılır, kör indeksler yeniden hesaplanır, işlem atomik ve doğrulanır.
import { spawnSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { createAuditLogger } from "../../src/core/audit";
import { ManualClock } from "../../src/core/clock";
import { SERVER_ROOT, testConfig } from "../../src/core/config";
import { MemoryNotifier } from "../../src/core/notifier";
import { openDb } from "../../src/db";
import { createIdentityService, rotateMasterKey, verifyVaultDecryptable } from "../../src/identity";
import { FakeLedger, insertUser, makeCtx } from "../helpers/fakes";
import { dumpDb, expectAppError, regInput } from "./fixtures";

const OLD = "11".repeat(32);
const NEW = "44".repeat(32);

function serviceFor(ctx: ReturnType<typeof makeCtx>, masterKey: string) {
  const c = { ...ctx, config: { ...ctx.config, masterKey } };
  return createIdentityService(c, { ledger: new FakeLedger(ctx.clock), notifier: new MemoryNotifier(), audit: createAuditLogger(ctx) });
}

async function populated() {
  const ctx = makeCtx({ masterKey: OLD });
  const identity = serviceFor(ctx, OLD);
  const registrarId = insertUser(ctx.db, { nickname: "memur", roles: ["member", "registrar"] });
  const a = (await identity.createByRegistrar(registrarId, regInput({ email: "bir@ornek.com.tr" }))).user.id;
  const b = (await identity.register(regInput({ email: "iki@ornek.com.tr" }))).user.id; // bekleyen başvuru da dönüştürülür
  const erased = (await identity.createByRegistrar(registrarId, regInput())).user.id;
  await identity.eraseSelf(erased);
  const pendingCorrection = identity.requestCorrection(a, { changes: { lastName: "Kaya" }, reason: "Soyadım mahkeme kararıyla değişti." });
  return { ctx, identity, registrarId, a, b, erased, pendingCorrection };
}

describe("ana anahtar dönüşümü (rotateMasterKey)", () => {
  it("canlı DEK'ler yeni anahtarla sarılır; alanlar aynen kalır; kör indeksler yenilenir; eski anahtar artık açamaz", async () => {
    const { ctx, identity, registrarId, a, b, pendingCorrection } = await populated();
    const piiBefore = identity.getPii(registrarId, a, "Dönüşüm öncesi kontrol");
    const rowsBefore = ctx.db.all<Record<string, string | null>>("SELECT * FROM identity_vault ORDER BY user_id");

    const report = rotateMasterKey(ctx.db, OLD, NEW, { now: ctx.clock.now() });
    expect(report).toEqual({ dryRun: false, total: 3, rewrapped: 2, erased: 1, verified: 2 });

    const rowsAfter = ctx.db.all<Record<string, string | null>>("SELECT * FROM identity_vault ORDER BY user_id");
    for (const [i, r] of rowsAfter.entries()) {
      const prev = rowsBefore[i];
      expect(r.enc_tckn).toBe(prev.enc_tckn); // alan şifreli metinleri değişmez (DEK aynı)
      expect(r.key_version).toBe(prev.key_version);
      if (prev.wrapped_dek) {
        expect(r.wrapped_dek).not.toBe(prev.wrapped_dek);
        expect(r.tckn_bidx).not.toBe(prev.tckn_bidx);
        expect(r.email_bidx).not.toBe(prev.email_bidx);
      } else {
        expect(r.wrapped_dek).toBeNull();
      }
    }

    // Yeni anahtarlı servis her şeyi okur; e-postayla giriş ve TCKN tekilliği yeni kör indekslerle çalışır.
    const fresh = serviceFor(ctx, NEW);
    expect(fresh.getPii(registrarId, a, "Dönüşüm sonrası kontrol")).toEqual(piiBefore);
    expect(fresh.getPii(registrarId, b, "Dönüşüm sonrası kontrol").email).toBe("iki@ornek.com.tr");
    expect((await fresh.login("bir@ornek.com.tr", "Gizli1234")).user.id).toBe(a);
    const tcknA = (fresh.exportOwnData(a).personalData as { tckn: string }).tckn;
    await expectAppError(fresh.register(regInput({ tckn: tcknA })), 409, "duplicate_tckn");
    // Bekleyen düzeltme talebi (kişinin DEK'iyle şifreli) dönüşümden etkilenmez.
    expect(fresh.reviewCorrection(registrarId, pendingCorrection.id, "Dönüşüm sonrası kontrol").proposed.lastName).toBe("Kaya");
    // Eski anahtarlı servis artık çözemez.
    await expectAppError(() => serviceFor(ctx, OLD).getPii(registrarId, a, "Eski anahtarla deneme"), 500, "vault_integrity");

    expect(verifyVaultDecryptable(ctx.db, NEW)).toEqual({ checked: 2, failed: [] });
    expect(verifyVaultDecryptable(ctx.db, OLD).failed).toHaveLength(2);
    const audit = ctx.db.all<{ action: string; meta: string }>("SELECT action, meta FROM audit_log WHERE action = 'identity.master_key_rotated'");
    expect(audit).toHaveLength(1);
    expect(JSON.parse(audit[0].meta)).toEqual({ rewrapped: 2, erased: 1 });
    expect(dumpDb(ctx)).not.toContain(NEW);
  });

  it("deneme kipi (dryRun) her şeyi doğrular ama veritabanını değiştirmez", async () => {
    const { ctx } = await populated();
    const before = dumpDb(ctx);
    const report = rotateMasterKey(ctx.db, OLD, NEW, { now: ctx.clock.now(), dryRun: true });
    expect(report).toMatchObject({ dryRun: true, rewrapped: 2, verified: 2 });
    expect(dumpDb(ctx)).toBe(before);
  });

  it("yanlış eski anahtar, aynı anahtar ve geçersiz anahtar reddedilir; hiçbir satır değişmez", async () => {
    const { ctx } = await populated();
    const before = dumpDb(ctx);
    expect(() => rotateMasterKey(ctx.db, "22".repeat(32), NEW, { now: 0 })).toThrow(/eski anahtarla açılamadı/);
    expect(() => rotateMasterKey(ctx.db, OLD, OLD, { now: 0 })).toThrow(/aynı olamaz/);
    expect(() => rotateMasterKey(ctx.db, OLD, "kisa", { now: 0 })).toThrow(/MASTER_KEY/);
    expect(dumpDb(ctx)).toBe(before);
  });
});

describe("rotate-master-key betiği (dosya kipi)", () => {
  it("--dry-run veritabanını ve anahtarı değiştirmez; gerçek çalıştırma anahtar dosyasını değiştirir ve veriler yeni anahtarla açılır", async () => {
    const dir = mkdtempSync(join(tmpdir(), "forum-rotate-"));
    try {
      const dataDir = join(dir, "data");
      mkdirSync(join(dataDir, "keys"), { recursive: true });
      writeFileSync(join(dataDir, "keys", "master.key"), OLD);
      const dbPath = join(dataDir, "forum.db");
      const clock = new ManualClock();
      {
        const db = openDb(dbPath);
        const ctx = { config: testConfig({ masterKey: OLD }), db, clock };
        const identity = createIdentityService(ctx, { ledger: null, notifier: new MemoryNotifier(), audit: createAuditLogger(ctx) });
        const registrarId = insertUser(db, { nickname: "memur", roles: ["member", "registrar"] });
        await identity.createByRegistrar(registrarId, regInput({ email: "betik@ornek.com.tr" }));
        db.close();
      }
      const baseEnv: NodeJS.ProcessEnv = { ...process.env, DATA_DIR: dataDir };
      for (const k of ["DB_PATH", "MASTER_KEY", "NEW_MASTER_KEY"]) delete baseEnv[k];
      const script = [join(SERVER_ROOT, "..", "node_modules", "tsx", "dist", "cli.mjs"), join(SERVER_ROOT, "scripts", "rotate-master-key.ts")];
      const run = (...args: string[]) =>
        spawnSync(process.execPath, [...script, ...args], { cwd: SERVER_ROOT, env: baseEnv, encoding: "utf8", timeout: 60_000 });

      const dry = run("--dry-run");
      expect(dry.status, dry.stderr + dry.stdout).toBe(0);
      expect(dry.stdout).toContain("Deneme başarılı");
      expect(readFileSync(join(dataDir, "keys", "master.key"), "utf8")).toBe(OLD);
      expect(existsSync(join(dataDir, "keys", "master.key.yeni"))).toBe(false);

      const real = run("--keep-old");
      expect(real.status, real.stderr + real.stdout).toBe(0);
      const newKey = readFileSync(join(dataDir, "keys", "master.key"), "utf8").trim();
      expect(newKey).toMatch(/^[0-9a-f]{64}$/);
      expect(newKey).not.toBe(OLD);
      expect(real.stdout).not.toContain(newKey); // anahtar ekrana yazılmaz
      expect(readdirSync(join(dataDir, "keys")).some((n) => n.startsWith("master.key.eski-"))).toBe(true);
      const db = openDb(dbPath);
      try {
        expect(verifyVaultDecryptable(db, newKey)).toEqual({ checked: 1, failed: [] });
      } finally {
        db.close();
      }

      // Ortam değişkeni kipinde NEW_MASTER_KEY zorunlu
      const envRun = spawnSync(process.execPath, script, { cwd: SERVER_ROOT, env: { ...baseEnv, MASTER_KEY: newKey }, encoding: "utf8", timeout: 60_000 });
      expect(envRun.status).toBe(1);
      expect(envRun.stderr).toContain("NEW_MASTER_KEY");
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  }, 120_000);
});
