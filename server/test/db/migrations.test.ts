// Şema göçü (#31, #204, #271, #344): schema_version okunur; eski veritabanı yükseltilir; daha yeni veritabanı reddedilir.
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Db, MIGRATIONS, SCHEMA_VERSION, SchemaVersionError, migrate, openDb, openMemoryDb, type Migration } from "../../src/db";

const versionOf = (db: Db): string | undefined => db.get<{ value: string }>("SELECT value FROM meta WHERE key = 'schema_version'")?.value;
const hasColumn = (db: Db, table: string, col: string): boolean => db.all<{ name: string }>(`PRAGMA table_info(${table})`).some((c) => c.name === col);

// Test göçleri gerçek listenin (MIGRATIONS) ÜSTÜNE eklenir: veritabanı her zaman en son gerçek sürümle kurulur.
const NEXT = SCHEMA_VERSION + 1;
const addLocale: Migration = { version: NEXT, description: "users.locale sütunu", up: (db) => db.exec("ALTER TABLE users ADD COLUMN locale TEXT") };
const addTheme: Migration = { version: NEXT + 1, description: "users.theme sütunu", up: (db) => db.exec("ALTER TABLE users ADD COLUMN theme TEXT") };
const tableExists = (db: Db, name: string): boolean => db.get("SELECT 1 AS x FROM sqlite_master WHERE type = 'table' AND name = ?", name) !== undefined;

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
    migrate(fresh); // yinelenen çağrı zararsız
    expect(up).not.toHaveBeenCalled();
  });

  it("sonraki bir sütunu olmayan eski veritabanı yükseltilir; sürüm yazılır; yinelenen çağrı göçü yeniden çalıştırmaz", () => {
    const db = openMemoryDb(); // en son gerçek sürüm (users.locale yok)
    expect(hasColumn(db, "users", "locale")).toBe(false);
    const up = vi.fn(addLocale.up);
    migrate(db, [...MIGRATIONS, { ...addLocale, up }]);
    expect(hasColumn(db, "users", "locale")).toBe(true);
    expect(versionOf(db)).toBe(String(NEXT));
    migrate(db, [...MIGRATIONS, { ...addLocale, up }]);
    expect(up).toHaveBeenCalledTimes(1);
  });

  it("birden çok eksik göç sırayla uygulanır", () => {
    const db = openMemoryDb();
    migrate(db, [...MIGRATIONS, addLocale, addTheme]);
    expect(hasColumn(db, "users", "locale")).toBe(true);
    expect(hasColumn(db, "users", "theme")).toBe(true);
    expect(versionOf(db)).toBe(String(NEXT + 1));
  });

  it("sürümü yazılmamış eski veritabanı taban sürüm sayılır ve yükseltilir", () => {
    const db = openMemoryDb();
    db.run("DELETE FROM meta WHERE key = 'schema_version'");
    migrate(db, [...MIGRATIONS, addLocale]); // taban (1) sayılır: gerçek göçler (idempotent) ve test göçü sırayla çalışır
    expect(hasColumn(db, "users", "locale")).toBe(true);
    expect(versionOf(db)).toBe(String(NEXT));
  });

  it("göçlerden biri patlarsa yükseltmenin tamamı geri alınır (sürüm ve sütunlar eski hâlinde)", () => {
    const db = openMemoryDb();
    const broken: Migration = { version: NEXT + 1, description: "bozuk", up: () => { throw new Error("patladı"); } };
    expect(() => migrate(db, [...MIGRATIONS, addLocale, broken])).toThrow(new RegExp(`sürüm ${NEXT + 1}: bozuk.*patladı`));
    expect(hasColumn(db, "users", "locale")).toBe(false);
    expect(versionOf(db)).toBe(String(SCHEMA_VERSION));
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

describe("sürüm 2: ledger_outbox (#273)", () => {
  it("sürüm listesi: 2 = defter giden kutusu; yeni kurulum tabloyu içerir", () => {
    expect(SCHEMA_VERSION).toBeGreaterThanOrEqual(2);
    expect(MIGRATIONS[0]).toMatchObject({ version: 2, description: expect.stringMatching(/ledger_outbox/) });
    const db = openMemoryDb();
    expect(tableExists(db, "ledger_outbox")).toBe(true);
    expect(db.all<{ name: string }>("PRAGMA table_info(ledger_outbox)").map((c) => c.name)).toEqual(["hash", "type", "payload", "nonce", "submitted_at"]);
  });

  it("sürüm 1 dosya veritabanı açılışta sürüm 2'ye yükseltilir; mevcut veri korunur", () => {
    const file = join(dir, "forum.db");
    const old = openDb(file);
    old.run(
      "INSERT INTO users(id, nickname, nickname_norm, password_hash, created_at) VALUES ('u1', 'Ayşe', 'ayşe', 'x', 1)",
    );
    old.exec("DROP TABLE ledger_outbox");
    old.run("UPDATE meta SET value = '1' WHERE key = 'schema_version'");
    old.close();

    const db = openDb(file);
    try {
      expect(versionOf(db)).toBe(String(SCHEMA_VERSION));
      expect(tableExists(db, "ledger_outbox")).toBe(true);
      expect(db.get<{ nickname: string }>("SELECT nickname FROM users WHERE id = 'u1'")?.nickname).toBe("Ayşe");
      db.run("INSERT INTO ledger_outbox(hash, type, payload, nonce, submitted_at) VALUES ('h', 'DELEGATION', '{}', 'n', 1)");
    } finally {
      db.close();
    }
  });

  it("el ile geri dönüş (MIMARI §7): belgelenen SQL sonrası sürüm 1 yazılımı veritabanını açar; yeni yazılım yeniden yükseltir", () => {
    const file = join(dir, "forum.db");
    const v2 = openDb(file);
    v2.run("INSERT INTO users(id, nickname, nickname_norm, password_hash, created_at) VALUES ('u1', 'Ayşe', 'ayşe', 'x', 1)");
    // Sürüm 1 yazılımı (göç listesi boş) sürüm 2 veritabanını açmaz.
    expect(() => migrate(v2, [])).toThrow(SchemaVersionError);
    expect(Number(v2.get<{ c: number }>("SELECT COUNT(*) AS c FROM ledger_outbox")!.c)).toBe(0); // düzgün kapanış: giden kutusu boş
    v2.exec("BEGIN; DROP TABLE ledger_outbox; UPDATE meta SET value = '1' WHERE key = 'schema_version'; COMMIT;");
    expect(() => migrate(v2, [])).not.toThrow();
    v2.close();

    const db = openDb(file);
    try {
      expect(versionOf(db)).toBe(String(SCHEMA_VERSION));
      expect(tableExists(db, "ledger_outbox")).toBe(true);
      expect(db.get<{ nickname: string }>("SELECT nickname FROM users WHERE id = 'u1'")?.nickname).toBe("Ayşe");
    } finally {
      db.close();
    }
  });

  it("göç 2 idempotenttir (tablo zaten varsa hata vermez)", () => {
    const db = openMemoryDb();
    expect(() => MIGRATIONS[0].up(db)).not.toThrow();
  });
});

describe("sürüm 3: saved_items (Listem) ve destekçi indeksi", () => {
  const indexExists = (db: Db, name: string): boolean => db.get("SELECT 1 AS x FROM sqlite_master WHERE type = 'index' AND name = ?", name) !== undefined;

  it("sürüm listesi: 3 = saved_items; yeni kurulum tabloyu ve indeksleri içerir; tür beyaz listesi CHECK ile zorlanır", () => {
    expect(SCHEMA_VERSION).toBeGreaterThanOrEqual(3);
    expect(MIGRATIONS[1]).toMatchObject({ version: 3, description: expect.stringMatching(/saved_items/) });
    const db = openMemoryDb();
    expect(db.all<{ name: string }>("PRAGMA table_info(saved_items)").map((c) => c.name)).toEqual(["user_id", "target_type", "target_id", "created_at"]);
    expect(indexExists(db, "idx_saved_items_user_created")).toBe(true);
    expect(indexExists(db, "idx_sponsors_user")).toBe(true);
    db.run("INSERT INTO users(id, nickname, nickname_norm, password_hash, created_at) VALUES ('u1', 'Ayşe', 'ayşe', 'x', 1)");
    db.run("INSERT INTO saved_items(user_id, target_type, target_id, created_at) VALUES ('u1', 'topic', 't1', 1)");
    expect(() => db.run("INSERT INTO saved_items(user_id, target_type, target_id, created_at) VALUES ('u1', 'topic', 't1', 2)")).toThrow(/UNIQUE|PRIMARY/);
    expect(() => db.run("INSERT INTO saved_items(user_id, target_type, target_id, created_at) VALUES ('u1', 'user', 'u2', 1)")).toThrow(/CHECK/);
    expect(() => db.run("INSERT INTO saved_items(user_id, target_type, target_id, created_at) VALUES ('yok', 'topic', 't1', 1)")).toThrow(/FOREIGN KEY/);
  });

  it("sürüm 2 dosya veritabanı açılışta sürüm 3'e yükseltilir; mevcut veri korunur", () => {
    const file = join(dir, "forum.db");
    const old = openDb(file);
    old.run("INSERT INTO users(id, nickname, nickname_norm, password_hash, created_at) VALUES ('u1', 'Ayşe', 'ayşe', 'x', 1)");
    old.run("INSERT INTO ledger_outbox(hash, type, payload, nonce, submitted_at) VALUES ('h', 'DELEGATION', '{}', 'n', 1)");
    old.exec("DROP TABLE saved_items; DROP INDEX idx_sponsors_user;");
    old.run("UPDATE meta SET value = '2' WHERE key = 'schema_version'");
    old.close();

    const db = openDb(file);
    try {
      expect(versionOf(db)).toBe(String(SCHEMA_VERSION));
      expect(tableExists(db, "saved_items")).toBe(true);
      expect(indexExists(db, "idx_sponsors_user")).toBe(true);
      expect(db.get<{ nickname: string }>("SELECT nickname FROM users WHERE id = 'u1'")?.nickname).toBe("Ayşe");
      expect(Number(db.get<{ c: number }>("SELECT COUNT(*) AS c FROM ledger_outbox")!.c)).toBe(1);
      db.run("INSERT INTO saved_items(user_id, target_type, target_id, created_at) VALUES ('u1', 'proposal', 'p1', 1)");
    } finally {
      db.close();
    }
  });

  it("el ile geri dönüş (MIMARI §7): belgelenen SQL sonrası sürüm 2 yazılımı açar; yeni yazılım yeniden yükseltir (kayıtlar yeniden boş başlar)", () => {
    const file = join(dir, "forum.db");
    const v3 = openDb(file);
    v3.run("INSERT INTO users(id, nickname, nickname_norm, password_hash, created_at) VALUES ('u1', 'Ayşe', 'ayşe', 'x', 1)");
    v3.run("INSERT INTO saved_items(user_id, target_type, target_id, created_at) VALUES ('u1', 'proposal', 'p1', 1)");
    const v2List = MIGRATIONS.filter((m) => m.version <= 2);
    expect(() => migrate(v3, v2List)).toThrow(SchemaVersionError);
    v3.exec("BEGIN; DROP TABLE saved_items; DROP INDEX idx_sponsors_user; UPDATE meta SET value = '2' WHERE key = 'schema_version'; COMMIT;");
    expect(() => migrate(v3, v2List)).not.toThrow();
    v3.close();

    const db = openDb(file);
    try {
      expect(versionOf(db)).toBe(String(SCHEMA_VERSION));
      expect(Number(db.get<{ c: number }>("SELECT COUNT(*) AS c FROM saved_items")!.c)).toBe(0);
      expect(db.get<{ nickname: string }>("SELECT nickname FROM users WHERE id = 'u1'")?.nickname).toBe("Ayşe");
    } finally {
      db.close();
    }
  });

  it("göç 3 idempotenttir (tablo ve indeksler zaten varsa hata vermez)", () => {
    const db = openMemoryDb();
    expect(() => MIGRATIONS[1].up(db)).not.toThrow();
  });
});

describe("sürüm 4: users.personal_ranking (Kişisel sıralama tercihi)", () => {
  it("sürüm listesi: 4 = personal_ranking; yeni kurulumda sütun var ve varsayılanı 1 (açık)", () => {
    expect(SCHEMA_VERSION).toBeGreaterThanOrEqual(4);
    expect(MIGRATIONS[2]).toMatchObject({ version: 4, description: expect.stringMatching(/personal_ranking/) });
    const db = openMemoryDb();
    expect(hasColumn(db, "users", "personal_ranking")).toBe(true);
    db.run("INSERT INTO users(id, nickname, nickname_norm, password_hash, created_at) VALUES ('u1', 'Ayşe', 'ayşe', 'x', 1)");
    expect(db.get<{ v: number }>("SELECT personal_ranking AS v FROM users WHERE id = 'u1'")?.v).toBe(1);
  });

  it("sürüm 3 dosya veritabanı açılışta yükseltilir: mevcut üyelerde tercih açık (1), veri korunur", () => {
    const file = join(dir, "forum.db");
    const old = openDb(file);
    old.run("INSERT INTO users(id, nickname, nickname_norm, password_hash, created_at) VALUES ('u1', 'Ayşe', 'ayşe', 'x', 1)");
    old.run("INSERT INTO saved_items(user_id, target_type, target_id, created_at) VALUES ('u1', 'proposal', 'p1', 1)");
    old.exec("ALTER TABLE users DROP COLUMN personal_ranking");
    old.run("UPDATE meta SET value = '3' WHERE key = 'schema_version'");
    old.close();

    const db = openDb(file);
    try {
      expect(versionOf(db)).toBe(String(SCHEMA_VERSION));
      expect(db.get<{ v: number; nickname: string }>("SELECT personal_ranking AS v, nickname FROM users WHERE id = 'u1'")).toEqual({ v: 1, nickname: "Ayşe" });
      expect(Number(db.get<{ c: number }>("SELECT COUNT(*) AS c FROM saved_items")!.c)).toBe(1);
    } finally {
      db.close();
    }
  });

  it("el ile geri dönüş (MIMARI §7): sütun düşürülüp sürüm 3 yazılınca sürüm 3 yazılımı açar; yeni yazılım yeniden ekler (tercihler açık başlar)", () => {
    const file = join(dir, "forum.db");
    const v4 = openDb(file);
    v4.run("INSERT INTO users(id, nickname, nickname_norm, password_hash, created_at, personal_ranking) VALUES ('u1', 'Ayşe', 'ayşe', 'x', 1, 0)");
    const v3List = MIGRATIONS.filter((m) => m.version <= 3);
    expect(() => migrate(v4, v3List)).toThrow(SchemaVersionError);
    v4.exec("BEGIN; ALTER TABLE users DROP COLUMN personal_ranking; UPDATE meta SET value = '3' WHERE key = 'schema_version'; COMMIT;");
    expect(() => migrate(v4, v3List)).not.toThrow();
    v4.close();

    const db = openDb(file);
    try {
      expect(versionOf(db)).toBe(String(SCHEMA_VERSION));
      expect(db.get<{ v: number }>("SELECT personal_ranking AS v FROM users WHERE id = 'u1'")?.v).toBe(1);
    } finally {
      db.close();
    }
  });

  it("göç 4 idempotenttir (sütun zaten varsa dokunulmaz)", () => {
    const db = openMemoryDb();
    expect(() => MIGRATIONS[2].up(db)).not.toThrow();
    expect(db.all<{ name: string }>("PRAGMA table_info(users)").filter((c) => c.name === "personal_ranking")).toHaveLength(1);
  });
});
