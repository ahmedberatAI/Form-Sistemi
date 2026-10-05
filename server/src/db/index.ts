// node:sqlite üzerinde ince bir sarmalayıcı (yerel derleme gerektirmez).
import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";
import { migrate } from "./migrations";

// Şema sürümleme / göç çalıştırıcısı ./migrations.ts içindedir (migrate, MIGRATIONS, SCHEMA_VERSION, SchemaVersionError).
export { migrate, MIGRATIONS, SCHEMA_VERSION, SchemaVersionError, type Migration } from "./migrations";

export type SqlValue = string | number | bigint | null | Uint8Array;
export type Row = Record<string, SqlValue>;

/**
 * Asgari Node sürümü: Db.tx'in canlılık denetimi `DatabaseSync.isTransaction`'a dayanır. Özellik Node 22.16.0 ve 24.0.0'da geldi;
 * 22.13–22.15 ve 23.x'te yoktur (undefined) ve her işlem içi deyim "işlem beklenmedik biçimde sonlandı" hatasıyla düşerdi (göçler
 * bile çalışmazdı). Bu yüzden açılışta anlaşılır bir iletiyle durulur.
 */
export function assertSqliteSupport(raw: { readonly isTransaction?: unknown }): void {
  if (typeof raw.isTransaction !== "boolean") {
    throw new Error(
      `Bu sunucu Node.js 22.16 ya da üstü (22.x serisinde) veya Node.js 24+ gerektirir: node:sqlite DatabaseSync.isTransaction bu sürümde yok (çalışan sürüm ${process.version}).`,
    );
  }
}

const isPromiseLike = (v: unknown): v is PromiseLike<unknown> =>
  (typeof v === "object" || typeof v === "function") && v !== null && typeof (v as { then?: unknown }).then === "function";

export class Db {
  readonly raw: DatabaseSync;
  private depth = 0;
  /** En dıştaki işlem COMMIT olunca çalışacak görevler (savepoint düzeyine göre kapsamlı; bkz. afterCommit). */
  private commitJobs: (() => void)[] = [];
  /**
   * İşlem içindeyken SQLite işlemi KENDİLİĞİNDEN geri aldıysa (SQLITE_FULL, G/Ç hatası, bellek yetmezliği) asıl hata. Hatayı
   * yakalayıp devam eden kod otomatik kayıt (autocommit) kipinde yazmaya düşmesin: işlem bitene dek her deyim bu hatayı fırlatır.
   */
  private aborted: unknown = null;

  constructor(path: string) {
    if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
    this.raw = new DatabaseSync(path);
    try {
      assertSqliteSupport(this.raw);
    } catch (e) {
      this.raw.close();
      throw e;
    }
    this.raw.exec("PRAGMA journal_mode = WAL;");
    this.raw.exec("PRAGMA foreign_keys = ON;");
    this.raw.exec("PRAGMA busy_timeout = 5000;");
  }

  /** Bir Db.tx işleminin içinde miyiz (en az bir savepoint açık)? */
  get inTransaction(): boolean {
    return this.depth > 0;
  }

  exec(sql: string): void {
    this.guarded(() => this.raw.exec(sql));
  }

  run(sql: string, ...params: SqlValue[]): { changes: number; lastInsertRowid: number | bigint } {
    const r = this.guarded(() => this.raw.prepare(sql).run(...params));
    return { changes: Number(r.changes), lastInsertRowid: r.lastInsertRowid };
  }

  get<T = Row>(sql: string, ...params: SqlValue[]): T | undefined {
    return this.guarded(() => this.raw.prepare(sql).get(...params) as T | undefined);
  }

  all<T = Row>(sql: string, ...params: SqlValue[]): T[] {
    return this.guarded(() => this.raw.prepare(sql).all(...params) as T[]);
  }

  /** İşlem içindeyken işlem artık yoksa deyim çalıştırılmaz (asıl hata fırlar); deyim işlemi düşürürse hata saklanır. */
  private guarded<T>(fn: () => T): T {
    this.assertTxAlive();
    try {
      return fn();
    } catch (e) {
      if (this.depth > 0 && this.aborted === null && !this.raw.isTransaction) this.aborted = e;
      throw e;
    }
  }

  private assertTxAlive(): void {
    if (this.depth > 0 && !this.raw.isTransaction) {
      throw this.aborted ?? new Error("Veritabanı işlemi beklenmedik biçimde sonlandı (geri alındı); işlem tamamlanamadı.");
    }
  }

  /**
   * İç içe çağrılabilir işlem (SAVEPOINT). Hata olursa geri alınır ve ASIL hata yeniden fırlatılır (#212, #283).
   * Geri çağrı eşzamanlı olmalıdır: Promise döndürürse ilk `await`'ten önceki yazımlar geri alınır ve TypeError fırlatılır
   * (await'ten sonraki yazımlar işlemin dışında kalırdı).
   * SQLite işlemin tamamını kendiliğinden geri alırsa (disk dolu …) iç hatayı yakalayıp devam eden kod da asıl hatayı alır;
   * hiçbir yazım işlemin dışına (autocommit) taşmaz.
   */
  tx<T>(fn: () => T): T {
    this.assertTxAlive();
    const outer = this.depth === 0;
    const name = `sp${this.depth++}`;
    const mark = this.commitJobs.length;
    let open = false;
    let out: T;
    try {
      this.raw.exec(`SAVEPOINT ${name}`);
      open = true;
      out = fn();
      if (isPromiseLike(out)) {
        // Reddedilen sözün işlenmemiş ret olarak süreci düşürmemesi için yutulur; çağırana asıl hata (TypeError) gider.
        Promise.resolve(out).catch(() => undefined);
        throw new TypeError("Db.tx geri çağrısı eşzamanlı olmalı (Promise döndürdü); işlem geri alındı.");
      }
      this.assertTxAlive();
      this.raw.exec(`RELEASE ${name}`);
    } catch (e) {
      this.commitJobs.length = mark; // bu düzeyde kuyruğa alınan COMMIT sonrası görevler de geri alınır
      if (open) this.rollbackQuietly(name);
      throw e;
    } finally {
      this.depth--;
      if (outer) this.aborted = null;
    }
    if (outer) this.runCommitJobs();
    return out;
  }

  /**
   * İşlem içindeyse görev EN DIŞTAKİ işlem başarıyla bitince (COMMIT sonrası) çalışır; işlem — ya da görevin kuyruğa alındığı
   * iç savepoint — geri alınırsa atılır. İşlem dışında hemen çalışır. Geri alınamayan yan etkiler (ör. defter gönderimi) içindir.
   */
  afterCommit(job: () => void): void {
    if (this.depth > 0) this.commitJobs.push(job);
    else job();
  }

  private runCommitJobs(): void {
    const jobs = this.commitJobs;
    this.commitJobs = [];
    for (const job of jobs) {
      try {
        job();
      } catch (e) {
        // COMMIT oldu; görev hatası işlemi geri almaz. Yalnız hata türü yazılır (ileti kişisel veri içerebilir).
        const code = typeof (e as { code?: unknown })?.code === "string" ? (e as { code: string }).code : e instanceof Error ? e.name : typeof e;
        console.error(`[db] COMMIT sonrası görev başarısız (${code}).`);
      }
    }
  }

  /**
   * Savepoint'i geri alır; kendi hatası yutulur. SQLite bazı hatalarda (SQLITE_FULL, G/Ç hatası, bellek yetmezliği) işlemin
   * TAMAMINI kendiliğinden geri alır: savepoint artık yoktur ve "ROLLBACK TO" "no such savepoint" fırlatır. O hata asıl
   * nedeni (ör. "disk dolu") gizlememelidir; veri zaten geri alınmıştır.
   */
  private rollbackQuietly(name: string): void {
    try {
      this.raw.exec(`ROLLBACK TO ${name}`);
      this.raw.exec(`RELEASE ${name}`);
    } catch {
      /* asıl hata önemlidir */
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
