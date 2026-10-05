// Belgelenen asgari Node sürümü (README §1, kök package.json engines) kodun gerçekten gerektirdiğiyle aynı olmalı (regresyon):
// Db.tx canlılık denetimi DatabaseSync.isTransaction'a dayanır; özellik Node 22.16.0 ve 24.0.0'da geldi (23.x'te yok).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { describe, expect, it } from "vitest";
import { SERVER_ROOT } from "../../src/core/config";
import { assertSqliteSupport, Db } from "../../src/db";

const ROOT = join(SERVER_ROOT, "..");
const readme = readFileSync(join(ROOT, "README.md"), "utf8");
const mimari = readFileSync(join(ROOT, "docs", "MIMARI.md"), "utf8");
const pkg = JSON.parse(readFileSync(join(ROOT, "package.json"), "utf8")) as { engines?: { node?: string } };

describe("asgari Node sürümü", () => {
  it("çalışan Node'da DatabaseSync.isTransaction boolean (Db.tx canlılık denetimi buna dayanır)", () => {
    const db = new DatabaseSync(":memory:");
    try {
      expect(typeof db.isTransaction).toBe("boolean");
      db.exec("BEGIN");
      expect(db.isTransaction).toBe(true);
      db.exec("ROLLBACK");
      expect(db.isTransaction).toBe(false);
    } finally {
      db.close();
    }
  });

  it("README, MIMARI ve engines 22.16 / 24 der; eski 22.13 iddiası yok", () => {
    expect(readme).toContain("Node.js 22.16 ya da üstü (22.x serisinde) veya Node.js 24+");
    expect(readme).not.toMatch(/Node\.js ≥ 22\.1[0-5]\b/);
    expect(mimari).toContain("Sunucu (Node 22.16+ ya da 24+, Fastify 5)");
    expect(pkg.engines?.node).toBe("^22.16.0 || >=24");
  });

  it("isTransaction yoksa (22.13–22.15, 23.x) Db açılışta anlaşılır bir iletiyle durur; varsa açılır", () => {
    const raw = new DatabaseSync(":memory:");
    try {
      // Eski Node'daki gibi: özellik tanımsız (isTransaction örnekte yapılandırılamaz; Proxy ile benzetilir).
      const old = new Proxy(raw, { get: (t, k) => (k === "isTransaction" ? undefined : Reflect.get(t, k)) });
      expect(() => assertSqliteSupport(old)).toThrow(/Node\.js 22\.16 ya da üstü \(22\.x serisinde\) veya Node\.js 24\+/);
      expect(() => assertSqliteSupport(raw)).not.toThrow();
    } finally {
      raw.close();
    }
    const db = new Db(":memory:");
    db.exec("CREATE TABLE t(x)");
    db.tx(() => db.run("INSERT INTO t VALUES (1)"));
    expect(db.get<{ c: number }>("SELECT COUNT(*) AS c FROM t")?.c).toBe(1);
    db.close();
  });
});
