// Db.tx (#212, #283): asıl hata korunur (SQLite işlemi kendiliğinden geri aldığında "ROLLBACK TO" hatası onu ezmez), SAVEPOINT
// hatası derinlik sayacını bozmaz, Promise döndüren geri çağrı reddedilir ve ilk await'e kadarki yazımlar geri alınır.
import { afterEach, describe, expect, it, vi } from "vitest";
import { openMemoryDb, type Db } from "../../src/db";

const count = (db: Db): number => Number(db.get<{ c: number }>("SELECT COUNT(*) AS c FROM t")?.c ?? 0);

function freshDb(): Db {
  const db = openMemoryDb();
  db.exec("CREATE TABLE t (x BLOB)");
  return db;
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe("Db.tx: asıl hatanın korunması", () => {
  it("disk dolu (SQLITE_FULL): dışarı 'database or disk is full' çıkar, 'no such savepoint' değil; veri geri alınır, db kullanılabilir kalır", () => {
    const db = freshDb();
    db.run("INSERT INTO t VALUES (?)", new Uint8Array(10));
    db.exec("PRAGMA max_page_count = 40");
    let err: unknown;
    try {
      db.tx(() => {
        for (let i = 0; i < 500; i++) db.run("INSERT INTO t VALUES (?)", new Uint8Array(4000));
      });
    } catch (e) {
      err = e;
    }
    expect(err).toBeInstanceOf(Error);
    expect((err as Error).message).toMatch(/full/i);
    expect((err as Error).message).not.toMatch(/no such savepoint/i);
    expect(db.raw.isTransaction).toBe(false);
    expect(count(db)).toBe(1); // yarım kalan ekler kalıcı olmadı

    db.exec("PRAGMA max_page_count = 1073741823");
    expect(db.tx(() => db.run("INSERT INTO t VALUES (?)", new Uint8Array(10)).changes)).toBe(1);
    expect(count(db)).toBe(2);
  });

  it("iç içe işlemde SQLite tüm işlemi geri almışsa her düzey asıl hatayı iletir", () => {
    const db = freshDb();
    const asil = new Error("asıl neden");
    expect(() =>
      db.tx(() => {
        db.run("INSERT INTO t VALUES (?)", new Uint8Array(1));
        db.tx(() => {
          db.run("INSERT INTO t VALUES (?)", new Uint8Array(1));
          db.exec("ROLLBACK"); // SQLite'ın kendiliğinden geri almasını taklit eder: tüm savepoint'ler yok olur
          throw asil;
        });
      }),
    ).toThrow(asil);
    expect(db.raw.isTransaction).toBe(false);
    expect(count(db)).toBe(0);
    // Derinlik sayacı sıfırlandı: yeni dış işlem yine sp0 adını kullanır ve çalışır.
    const exec = vi.spyOn(db.raw, "exec");
    db.tx(() => db.run("INSERT INTO t VALUES (?)", new Uint8Array(1)));
    expect(exec).toHaveBeenCalledWith("SAVEPOINT sp0");
    expect(count(db)).toBe(1);
  });

  it("iç işlem hatası (işlem canlıyken) yalnız iç düzeyi geri alır; dış işlem sürer", () => {
    const db = freshDb();
    db.tx(() => {
      db.run("INSERT INTO t VALUES (?)", new Uint8Array(1));
      expect(() =>
        db.tx(() => {
          db.run("INSERT INTO t VALUES (?)", new Uint8Array(1));
          throw new Error("iç");
        }),
      ).toThrow("iç");
      expect(count(db)).toBe(1);
    });
    expect(count(db)).toBe(1);
  });

  it("SAVEPOINT açılamazsa hata iletilir, ROLLBACK denenmez ve derinlik sayacı bozulmaz", () => {
    const db = freshDb();
    const real = db.raw.exec.bind(db.raw);
    const exec = vi.spyOn(db.raw, "exec").mockImplementationOnce(() => {
      throw new Error("kilitli");
    });
    expect(() => db.tx(() => 1)).toThrow("kilitli");
    expect(exec.mock.calls.map((c) => c[0])).toEqual(["SAVEPOINT sp0"]);
    exec.mockImplementation(real);
    exec.mockClear();
    expect(db.tx(() => 7)).toBe(7);
    expect(exec.mock.calls.map((c) => c[0])).toEqual(["SAVEPOINT sp0", "RELEASE sp0"]);
  });

  it("RELEASE (COMMIT) başarısız olursa işlem geri alınır ve RELEASE hatası iletilir", () => {
    const db = freshDb();
    const real = db.raw.exec.bind(db.raw);
    let failed = false;
    vi.spyOn(db.raw, "exec").mockImplementation((sql: string) => {
      if (sql === "RELEASE sp0" && !failed) {
        failed = true; // yalnız ilk RELEASE (COMMIT) başarısız; geri almadaki RELEASE çalışır
        throw new Error("commit başarısız");
      }
      return real(sql);
    });
    expect(() => db.tx(() => db.run("INSERT INTO t VALUES (?)", new Uint8Array(1)))).toThrow("commit başarısız");
    expect(db.raw.isTransaction).toBe(false);
    expect(count(db)).toBe(0);
  });
});

describe("Db.tx: eşzamanlı geri çağrı zorunluluğu", () => {
  it("Promise döndüren geri çağrı TypeError ile reddedilir; ilk await'ten önceki yazım geri alınır", async () => {
    const db = freshDb();
    let resume!: () => void;
    const gate = new Promise<void>((r) => (resume = r));
    const fn = async (): Promise<void> => {
      db.run("INSERT INTO t VALUES (?)", new Uint8Array(1));
      await gate;
    };
    expect(() => db.tx(fn)).toThrow(TypeError);
    expect(() => db.tx(fn)).toThrow(/eşzamanlı olmalı/);
    expect(db.raw.isTransaction).toBe(false);
    expect(count(db)).toBe(0);
    resume();
    await gate;
  });

  it("reddedilen Promise işlenmemiş ret üretmez", async () => {
    const db = freshDb();
    const unhandled = vi.fn();
    process.on("unhandledRejection", unhandled);
    try {
      expect(() => db.tx(() => Promise.reject(new Error("geç hata")))).toThrow(TypeError);
      await new Promise((r) => setTimeout(r, 10));
      expect(unhandled).not.toHaveBeenCalled();
    } finally {
      process.off("unhandledRejection", unhandled);
    }
  });

  it("thenable olmayan nesneler normal döner", () => {
    const db = freshDb();
    expect(db.tx(() => ({ a: 1 }))).toEqual({ a: 1 });
    expect(db.tx(() => null)).toBeNull();
  });
});

describe("Db.tx: SQLite işlemi kendiliğinden geri aldığında yazım işlemin dışına taşmaz", () => {
  it("iç hata yakalanıp devam edilirse sonraki deyim ve dış RELEASE asıl hatayı fırlatır; hiçbir satır kalıcı olmaz", () => {
    const db = freshDb();
    db.exec("CREATE TABLE sonra (v TEXT)");
    let inner: unknown;
    let after: unknown;
    let outer: unknown;
    try {
      db.tx(() => {
        for (let i = 0; i < 20; i++) db.run("INSERT INTO t VALUES (?)", new Uint8Array(600));
        db.exec(`PRAGMA max_page_count = ${Number(db.get<{ page_count: number }>("PRAGMA page_count")!.page_count)}`);
        try {
          db.run("INSERT INTO t VALUES (?)", new Uint8Array(50_000)); // SQLITE_FULL: SQLite işlemin tamamını geri alır
        } catch (e) {
          inner = e; // çağıran hatayı yutup devam ediyor
        }
        try {
          db.run("INSERT INTO sonra VALUES ('işlem dışına taşmamalı')");
        } catch (e) {
          after = e;
        }
      });
    } catch (e) {
      outer = e;
    }
    db.exec("PRAGMA max_page_count = 1073741823");
    expect((inner as Error).message).toMatch(/full/i);
    expect(after).toBe(inner); // autocommit'e düşmedi: aynı asıl hata
    expect(outer).toBe(inner); // "no such savepoint" değil
    expect(count(db)).toBe(0);
    expect(Number(db.get<{ c: number }>("SELECT COUNT(*) AS c FROM sonra")!.c)).toBe(0);
    // İşlem bitti: veritabanı yeniden kullanılabilir.
    db.tx(() => db.run("INSERT INTO sonra VALUES ('yeni')"));
    expect(Number(db.get<{ c: number }>("SELECT COUNT(*) AS c FROM sonra")!.c)).toBe(1);
  });

  it("işlem hatasız ama dışarıdan sonlandırılmışsa (ROLLBACK) iç işlem açılmaz, autocommit yazımı yapılmaz", () => {
    const db = freshDb();
    expect(() =>
      db.tx(() => {
        db.run("INSERT INTO t VALUES (?)", new Uint8Array(1));
        db.exec("ROLLBACK");
        db.tx(() => db.run("INSERT INTO t VALUES (?)", new Uint8Array(1)));
      }),
    ).toThrow(/beklenmedik biçimde sonlandı/);
    expect(count(db)).toBe(0);
    expect(db.inTransaction).toBe(false);
  });
});

describe("Db.afterCommit", () => {
  it("işlem dışında hemen; işlem içinde EN DIŞTAKİ COMMIT'ten sonra, sırayla çalışır", () => {
    const db = freshDb();
    const log: string[] = [];
    db.afterCommit(() => log.push("hemen"));
    expect(log).toEqual(["hemen"]);
    db.tx(() => {
      db.afterCommit(() => log.push(`dış:${count(db)}`));
      db.tx(() => {
        db.run("INSERT INTO t VALUES (?)", new Uint8Array(1));
        db.afterCommit(() => log.push(`iç:${db.inTransaction}`));
      });
      expect(log).toEqual(["hemen"]); // iç işlem bitti ama dış işlem sürüyor
    });
    expect(log).toEqual(["hemen", "dış:1", "iç:false"]);
  });

  it("geri alınan işlemin görevleri atılır; iç savepoint geri alınırsa yalnız onun görevleri atılır", () => {
    const db = freshDb();
    const log: string[] = [];
    expect(() =>
      db.tx(() => {
        db.afterCommit(() => log.push("geri alınan"));
        throw new Error("geri al");
      }),
    ).toThrow("geri al");
    db.tx(() => {
      db.afterCommit(() => log.push("kalan"));
      try {
        db.tx(() => {
          db.afterCommit(() => log.push("iç geri alınan"));
          throw new Error("iç");
        });
      } catch {
        /* dış işlem sürer */
      }
    });
    expect(log).toEqual(["kalan"]);
  });

  it("görev hatası COMMIT'i bozmaz; günlüğe yalnız hata türü yazılır", () => {
    const db = freshDb();
    const err = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const ran: string[] = [];
    db.tx(() => {
      db.run("INSERT INTO t VALUES (?)", new Uint8Array(1));
      db.afterCommit(() => {
        throw new Error("gizli kişisel veri");
      });
      db.afterCommit(() => ran.push("ikinci"));
    });
    expect(count(db)).toBe(1);
    expect(ran).toEqual(["ikinci"]);
    expect(err).toHaveBeenCalledTimes(1);
    expect(String(err.mock.calls[0][0])).not.toContain("gizli");
  });
});
