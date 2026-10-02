// Gizli anahtar parmak izleri: anahtarlar veritabanıyla eşleşmiyorsa sunucu AÇILMAZ.
// Anahtar dosyası kaybolur/değiştirilirse sessizce yeni anahtar kullanmak kimlik kasasını, oy kimliklerini ve oturumları
// kalıcı olarak okunamaz kılar; bunun yerine ilk açılışta meta tablosuna HMAC parmak izi yazılır, her açılışta doğrulanır.
// Parmak izi anahtarın kendisini ele vermez (HMAC-SHA256, anahtar = gizli, ileti = sabit ad).
import { createHmac } from "node:crypto";
import { existsSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import type { Db } from "../db";

export type SecretName = "master" | "token" | "vote";

export const SECRET_ENV: Record<SecretName, string> = { master: "MASTER_KEY", token: "TOKEN_KEY", vote: "VOTE_KEY" };

const metaKey = (name: SecretName): string => `key_check_${name}`;

/** HMAC-SHA256(anahtar, "forum-anahtar-denetimi:<ad>") — hex. */
export function keyFingerprint(name: SecretName, key: string): string {
  return createHmac("sha256", key).update(`forum-anahtar-denetimi:${name}`, "utf8").digest("hex");
}

/** Parmak izini yazar/günceller (yalnız ilk açılış ve ana anahtar dönüşümü). */
export function setKeyFingerprint(db: Db, name: SecretName, key: string): void {
  db.run(
    "INSERT INTO meta(key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
    metaKey(name),
    keyFingerprint(name, key),
  );
}

/**
 * Yapılandırmadaki anahtarlar bu veritabanını oluşturan anahtarlarla aynı mı? İlk açılışta (kayıt yok) parmak izleri yazılır;
 * sonraki açılışlarda uyuşmazlık Türkçe bir hatayla reddedilir. Hiçbir anahtar değeri hataya/loga yazılmaz.
 */
export function verifyKeyFingerprints(db: Db, keys: Record<SecretName, string>): void {
  const mismatched: SecretName[] = [];
  db.tx(() => {
    for (const name of Object.keys(SECRET_ENV) as SecretName[]) {
      const expected = keyFingerprint(name, keys[name]);
      const row = db.get<{ value: string }>("SELECT value FROM meta WHERE key = ?", metaKey(name));
      if (!row) db.run("INSERT OR IGNORE INTO meta(key, value) VALUES (?, ?)", metaKey(name), expected);
      else if (row.value !== expected) mismatched.push(name);
    }
  });
  if (mismatched.length) {
    const names = mismatched.map((n) => SECRET_ENV[n]).join(", ");
    throw new Error(
      `Anahtar uyuşmazlığı: ${names} bu veritabanını oluşturan anahtarla aynı değil. Yanlış anahtarla açmak kimlik kasasını, oy kimliklerini ` +
        "ve oturumları okunamaz hâle getirir; sunucu başlatılmadı. Doğru anahtarı (ortam değişkeni ya da DATA_DIR/keys/ dosyası) geri yükleyin. " +
        "Ana anahtarı bilinçli döndürdüyseniz scripts/rotate-master-key.ts betiğini kullanın.",
    );
  }
}

/**
 * Veritabanı DOSYASINDA anahtara bağlı veri (parmak izi, üye, kasa satırı ya da oy) var mı? Dosya yoksa/boşsa false.
 * Dosya okunamıyorsa (kilitli/bozuk) temkinli davranıp true döner: anahtar üretmemek, yanlış anahtar üretmekten iyidir.
 */
export function databaseFileHasKeyBoundData(dbPath: string): boolean {
  if (dbPath === ":memory:" || !existsSync(dbPath)) return false;
  let raw: DatabaseSync | undefined;
  try {
    raw = new DatabaseSync(dbPath, { readOnly: true });
    const probes = ["SELECT 1 AS x FROM meta WHERE key LIKE 'key_check_%' LIMIT 1", ...["identity_vault", "users", "ballots"].map((t) => `SELECT 1 AS x FROM ${t} LIMIT 1`)];
    for (const sql of probes) {
      try {
        if (raw.prepare(sql).get() !== undefined) return true;
      } catch (e) {
        if (!/no such table/i.test(e instanceof Error ? e.message : String(e))) throw e;
      }
    }
    return false;
  } catch {
    return true;
  } finally {
    try {
      raw?.close();
    } catch {
      /* yok say */
    }
  }
}
