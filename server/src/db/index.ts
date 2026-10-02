// node:sqlite üzerinde ince bir sarmalayıcı (yerel derleme gerektirmez).
import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { migrate } from "./migrations";

// Şema sürümleme / göç çalıştırıcısı ./migrations.ts içindedir (migrate, MIGRATIONS, SCHEMA_VERSION, SchemaVersionError).
export { migrate, MIGRATIONS, SCHEMA_VERSION, SchemaVersionError, type Migration } from "./migrations";

export type SqlValue = string | number | bigint | null | Uint8Array;
export type Row = Record<string, SqlValue>;

export class Db {
  readonly raw: DatabaseSync;
  private depth = 0;

  constructor(path: string) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.raw = new DatabaseSync(path);
    this.raw.exec("PRAGMA journal_mode = WAL;");
    this.raw.exec("PRAGMA foreign_keys = ON;");
    this.raw.exec("PRAGMA busy_timeout = 5000;");
  }

  exec(sql: string): void {
    this.raw.exec(sql);
  }

  run(sql: string, ...params: SqlValue[]): { changes: number; lastInsertRowid: number | bigint } {
    const r = this.raw.prepare(sql).run(...params);
    return { changes: Number(r.changes), lastInsertRowid: r.lastInsertRowid };
  }

  get<T = Row>(sql: string, ...params: SqlValue[]): T | undefined {
    return this.raw.prepare(sql).get(...params) as T | undefined;
  }

  all<T = Row>(sql: string, ...params: SqlValue[]): T[] {
    return this.raw.prepare(sql).all(...params) as T[];
  }

  /** İç içe çağrılabilir işlem (SAVEPOINT). Hata olursa geri alınır ve hata yeniden fırlatılır. */
  tx<T>(fn: () => T): T {
    const name = `sp${this.depth++}`;
    this.raw.exec(`SAVEPOINT ${name}`);
    try {
      const out = fn();
      this.raw.exec(`RELEASE ${name}`);
      return out;
    } catch (e) {
      this.raw.exec(`ROLLBACK TO ${name}`);
      this.raw.exec(`RELEASE ${name}`);
      throw e;
    } finally {
      this.depth--;
    }
  }

  /** Sıradaki insan-dostu numara (seq) — tablo başına. */
  nextSeq(table: "proposals" | "topics" | "messages"): number {
    const r = this.get<{ m: number | null }>(`SELECT MAX(seq) AS m FROM ${table}`);
    return (r?.m ?? 0) + 1;
  }

  close(): void {
    this.raw.close();
  }
}

export function openDb(path: string): Db {
  const db = new Db(path);
  try {
    migrate(db);
  } catch (e) {
    // Şema kurulamadı/sürüm uyumsuz: tutamak sızdırılmaz (WAL dosyaları ve kilit serbest kalsın).
    try {
      db.close();
    } catch {
      /* asıl hata önemlidir */
    }
    throw e;
  }
  return db;
}

/** Testler için: şeması kurulmuş bellek içi veritabanı. */
export function openMemoryDb(): Db {
  return openDb(":memory:");
}

export function json<T>(v: SqlValue | undefined, fallback: T): T {
  if (v === null || v === undefined) return fallback;
  try {
    return JSON.parse(String(v)) as T;
  } catch {
    return fallback;
  }
}
