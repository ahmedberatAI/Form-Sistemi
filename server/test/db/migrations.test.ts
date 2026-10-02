// Şema göçü (#31, #204, #271, #344): schema_version okunur; eski veritabanı yükseltilir; daha yeni veritabanı reddedilir.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Db, MIGRATIONS, SCHEMA_VERSION, SchemaVersionError, migrate, openDb, openMemoryDb, type Migration } from "../../src/db";

const versionOf = (db: Db): string | undefined => db.get<{ value: string }>("SELECT value FROM meta WHERE key = 'schema_version'")?.value;
const hasColumn = (db: Db, table: string, col: string): boolean => db.all<{ name: string }>(`PRAGMA table_info(${table})`).some((c) => c.name === col);

const addLocale: Migration = { version: 2, description: "users.locale sütunu", up: (db) => db.exec("ALTER TABLE users ADD COLUMN locale TEXT") };
const addTheme: Migration = { version: 3, description: "users.theme sütunu", up: (db) => db.exec("ALTER TABLE users ADD COLUMN theme TEXT") };

let dir: string;
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "forum-migr-"));
});
afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("şema göçü", () => {
  it("boş veritabanı en son sürümle kurulur; göçler çalışmaz (schema.sql zaten son hâl)", () => {
    expect(SCHEMA_VERSION).toBe(MIGRATIONS.length === 0 ? 1 : MIGRATIONS[MIGRATIONS.length - 1].version);
    const db = openMemoryDb();
    expect(versionOf(db)).toBe(String(SCHEMA_VERSION));
    const up = vi.fn();
    const fresh = openMemoryDb();
    expect(versionOf(fresh)).toBe(String(SCHEMA_VERSION));
    migrate(fresh, []); // yinelenen çağrı zararsız
    expect(up).not.toHaveBeenCalled();
  });

  it("sonraki bir sütunu olmayan eski veritabanı yükseltilir; sürüm yazılır; yinelenen çağrı göçü yeniden çalıştırmaz", () => {
    const db = openMemoryDb(); // sürüm 1 (users.locale yok)
    expect(hasColumn(db, "users", "locale")).toBe(false);
    const up = vi.fn(addLocale.up);
    migrate(db, [{ ...addLocale, up }]);
    expect(hasColumn(db, "users", "locale")).toBe(true);
    expect(versionOf(db)).toBe("2");
    migrate(db, [{ ...addLocale, up }]);
    expect(up).toHaveBeenCalledTimes(1);
  });

  it("birden çok eksik göç sırayla uygulanır", () => {
    const db = openMemoryDb();
    migrate(db, [addLocale, addTheme]);
    expect(hasColumn(db, "users", "locale")).toBe(true);
    expect(hasColumn(db, "users", "theme")).toBe(true);
    expect(versionOf(db)).toBe("3");
  });

  it("sürümü yazılmamış eski veritabanı taban sürüm sayılır ve yükseltilir", () => {
    const db = openMemoryDb();
    db.run("DELETE FROM meta WHERE key = 'schema_version'");
    migrate(db, [addLocale]);
    expect(hasColumn(db, "users", "locale")).toBe(true);
    expect(versionOf(db)).toBe("2");
  });

  it("göçlerden biri patlarsa yükseltmenin tamamı geri alınır (sürüm ve sütunlar eski hâlinde)", () => {
    const db = openMemoryDb();
    const broken: Migration = { version: 3, description: "bozuk", up: () => { throw new Error("patladı"); } };
    expect(() => migrate(db, [addLocale, broken])).toThrow(/sürüm 3: bozuk.*patladı/);
    expect(hasColumn(db, "users", "locale")).toBe(false);
    expect(versionOf(db)).toBe("1");
  });

  it("kod sürümünden DAHA YENİ veritabanı Türkçe hatayla reddedilir ve değiştirilmez", () => {
    const file = join(dir, "forum.db");
    const db = openDb(file);
    db.run("UPDATE meta SET value = '99' WHERE key = 'schema_version'");
    db.close();
    expect(() => openDb(file)).toThrow(SchemaVersionError);
    expect(() => openDb(file)).toThrow(/şema sürümü \(99\).*daha yeni/);
    const again = new Db(file); // doğrudan açılır (migrate yok): sürüm değişmemiş olmalı
    expect(versionOf(again)).toBe("99");
    again.close();
  });

  it("bozuk sürüm değeri reddedilir", () => {
    const db = openMemoryDb();
    db.run("UPDATE meta SET value = 'abc' WHERE key = 'schema_version'");
    expect(() => migrate(db)).toThrow(SchemaVersionError);
  });

  it("geçersiz (ardışık olmayan) göç listesi reddedilir", () => {
    const db = openMemoryDb();
    expect(() => migrate(db, [addTheme])).toThrow(/Göç listesi geçersiz/);
  });
});
