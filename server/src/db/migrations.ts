// Şema sürümleme ve göç (migration) çalıştırıcısı (#31, #204, #271, #344).
//
// Model: schema.sql her zaman ŞEMANIN SON HÂLİDİR (CREATE ... IF NOT EXISTS; sıfırdan kurulumda tek başına yeter).
// Sürüm 1 = ilk yayımlanan şema (taban). Sonraki her şema değişikliği, mevcut veritabanlarını yükseltmek için BURADAKİ listeye sıralı
// bir göç olarak eklenir (version = bir önceki + 1) VE schema.sql da son hâle göre güncellenir.
//
// Açılışta (migrate):
//   - Veritabanı boşsa: schema.sql çalışır, sürüm = en son sürüm yazılır (göçler çalışmaz; schema.sql zaten son hâldir).
//   - Sürüm < en son sürüm: eksik göçler sırayla çalışır, sonra schema.sql yeniden uygulanır (yeni tablo/indeksleri ekler);
//     hepsi TEK işlemde — herhangi bir adım patlarsa veritabanı eski hâlinde kalır.
//   - Sürüm > en son sürüm (veritabanı daha yeni bir yazılımla yazılmış): sessizce açılmaz, Türkçe hatayla REDDEDİLİR.
//
// Kurallar: göçler yalnızca toparlayıcı değişiklikler yapmalıdır (ADD COLUMN, yeni tablo/indeks, veri doldurma). İşlem içinde
// PRAGMA foreign_keys değiştirilemediğinden tablo yeniden kurma gerektiren göçler ayrıca ele alınmalıdır.
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { Db } from "./index";

const here = dirname(fileURLToPath(import.meta.url));

/** schema.sql'in temsil ettiği ilk sürüm (taban). */
export const BASELINE_VERSION = 1;
export const SCHEMA_VERSION_KEY = "schema_version";

export interface Migration {
  /** Bu göçten SONRAKİ şema sürümü; listede sıkı artan ve ardışık olmalıdır (2, 3, 4, ...). */
  version: number;
  /** Kısa açıklama (hata iletilerinde görünür). */
  description: string;
  /** Göçü uygular. Çağıran bir işlem (SAVEPOINT) açmıştır; hata fırlatılırsa tüm yükseltme geri alınır. */
  up(db: Db): void;
}

/** Sürüm 2'nin tablosu; schema.sql'deki tanımla birebir aynıdır (orada da bulunur, çünkü schema.sql son hâldir). */
const LEDGER_OUTBOX_SQL = `CREATE TABLE IF NOT EXISTS ledger_outbox (
  hash TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  payload TEXT NOT NULL,
  nonce TEXT NOT NULL,
  submitted_at INTEGER NOT NULL
);`;

/**
 * Sürüm 3: "Listem" kayıtları ve kişisel sıralamanın sinyal sorgusu için destekçi indeksi. schema.sql'deki tanımlarla birebir aynıdır.
 * Kayıtlar yalnız sahibine görünür, KVKK dökümüne girer ve hesap silmede (aynı işlemde) silinir.
 */
const SAVED_ITEMS_SQL = `CREATE TABLE IF NOT EXISTS saved_items (
  user_id TEXT NOT NULL REFERENCES users(id),
  target_type TEXT NOT NULL CHECK (target_type IN ('proposal', 'topic')),
  target_id TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, target_type, target_id)
);
CREATE INDEX IF NOT EXISTS idx_saved_items_user_created ON saved_items(user_id, created_at);
CREATE INDEX IF NOT EXISTS idx_sponsors_user ON proposal_sponsors(user_id, at);`;

/**
 * Sürüm 4: users.personal_ranking ("Kişisel sıralama" tercihi; varsayılan 1 = açık). schema.sql'deki sütunla birebir aynıdır.
 * ALTER TABLE ... ADD COLUMN SQLite'ta "IF NOT EXISTS" almaz: sütun zaten varsa (yeniden çalıştırma) dokunulmaz.
 */
function addPersonalRanking(db: Db): void {
  const cols = db.all<{ name: string }>("PRAGMA table_info(users)").map((c) => c.name);
  if (!cols.includes("personal_ranking")) db.exec("ALTER TABLE users ADD COLUMN personal_ranking INTEGER NOT NULL DEFAULT 1");
}

/**
 * Sıralı göç listesi (sürüm 1 = taban).
 * Örnek: { version: 3, description: "users.locale sütunu", up: (db) => db.exec("ALTER TABLE users ADD COLUMN locale TEXT") }
 */
export const MIGRATIONS: readonly Migration[] = [
  // #273: gönderilmiş ama blokta onaylanmamış defter işlemleri sert kapanışta kaybolmasın (işlemsel outbox; ledger/outbox.ts).
  { version: 2, description: "ledger_outbox tablosu (defter giden kutusu)", up: (db) => db.exec(LEDGER_OUTBOX_SQL) },
  // Önerili arama ve kişisel sıralama: "Listeme ekle" kayıtları (saved_items) + destekçi (user_id) indeksi.
  { version: 3, description: "saved_items tablosu (Listem) ve destekçi indeksi", up: (db) => db.exec(SAVED_ITEMS_SQL) },
  // KVKK md. 6/3-a: kişisel sıralama siyasi görüş rızasına ek olarak ayrıca kapatılabilir (users.personal_ranking).
  { version: 4, description: "users.personal_ranking sütunu (Kişisel sıralama tercihi)", up: addPersonalRanking },
];

/** Veritabanı sürümü yazılımın desteklediğinden yeniyse ya da sürüm bozuksa fırlatılır. */
export class SchemaVersionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "SchemaVersionError";
  }
}

/** Verilen göç listesiyle desteklenen en son şema sürümü. */
export function latestSchemaVersion(migrations: readonly Migration[] = MIGRATIONS): number {
  return migrations.length === 0 ? BASELINE_VERSION : migrations[migrations.length - 1].version;
}

/** Geçerli sürüm (varsayılan listeyle desteklenen en son sürüm). */
export const SCHEMA_VERSION = latestSchemaVersion();

function assertMigrationList(migrations: readonly Migration[]): void {
  let expected = BASELINE_VERSION + 1;
  for (const m of migrations) {
    if (m.version !== expected) {
      throw new Error(`Göç listesi geçersiz: "${m.description}" sürümü ${m.version}, beklenen ${expected} (sürümler ${BASELINE_VERSION + 1}'den başlayıp ardışık artmalı).`);
    }
    expected++;
  }
}

function tableExists(db: Db, name: string): boolean {
  return db.get("SELECT 1 AS x FROM sqlite_master WHERE type = 'table' AND name = ?", name) !== undefined;
}

/** Kayıtlı şema sürümü; veritabanı boşsa (hiç kurulmamışsa) null. Sürümü yazılmamış ama tabloları olan eski veritabanı = taban sürüm. */
export function readSchemaVersion(db: Db): number | null {
  if (tableExists(db, "meta")) {
    const row = db.get<{ value: string }>("SELECT value FROM meta WHERE key = ?", SCHEMA_VERSION_KEY);
    if (row) {
      const v = Number(row.value);
      if (!Number.isInteger(v) || v < BASELINE_VERSION) {
        throw new SchemaVersionError(`Veritabanı şema sürümü okunamadı ("${row.value}"). Veritabanı dosyası bozuk olabilir; yedekten geri yükleyin.`);
      }
      return v;
    }
  }
  return tableExists(db, "users") ? BASELINE_VERSION : null;
}

function writeSchemaVersion(db: Db, version: number): void {
  db.run(
    "INSERT INTO meta(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    SCHEMA_VERSION_KEY,
    String(version),
  );
}

/**
 * Şemayı kurar ya da yükseltir (bkz. dosya başı). Yinelenen çağrı zararsızdır (schema.sql idempotent; eksik indeksleri tamamlar).
 * @param migrations Yalnızca testler için: varsayılan {@link MIGRATIONS}.
 */
export function migrate(db: Db, migrations: readonly Migration[] = MIGRATIONS): void {
  assertMigrationList(migrations);
  const latest = latestSchemaVersion(migrations);
  const current = readSchemaVersion(db);
  if (current !== null && current > latest) {
    throw new SchemaVersionError(
      `Veritabanı şema sürümü (${current}), bu yazılımın desteklediği en yeni sürümden (${latest}) daha yeni. ` +
        `Veritabanı daha yeni bir yazılım sürümüyle yazılmış; yazılımı güncelleyin ya da uyumlu bir yedeği kullanın. Veritabanına dokunulmadı.`,
    );
  }
  const schema = readFileSync(join(here, "schema.sql"), "utf8");
  db.tx(() => {
    if (current !== null) {
      for (const m of migrations) {
        if (m.version <= current) continue;
        try {
          m.up(db);
        } catch (e) {
          throw new Error(`Şema göçü başarısız (sürüm ${m.version}: ${m.description}): ${e instanceof Error ? e.message : String(e)}`, { cause: e });
        }
        writeSchemaVersion(db, m.version);
      }
    }
    // Sıfırdan kurulumda tüm şema; yükseltmede yalnız eksik tablo/indeksler (göçlerden sonra, sütunlar hazırken).
    db.exec(schema);
    writeSchemaVersion(db, latest);
  });
}
