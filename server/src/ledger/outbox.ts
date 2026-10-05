// Defter giden kutusu (#273): gönderilmiş ama henüz bir blokta onaylanmamış işlemler ANA veritabanındaki ledger_outbox
// tablosunda tutulur. Doğrulayıcı havuzları yalnız düzgün kapanışta (stop) kalıcılaşır; sert kapanışta (çökme, taskkill /F,
// elektrik kesintisi) bellekteki bekleyen işlemler kaybolurdu: DB satırı COMMIT olmuş, defter kaydı hiç yazılmamış olurdu.
// (Ana veritabanı varsayılan synchronous=FULL ile yazar: satırın kendisi elektrik kesintisinde de kalır.)
//
//   - ForumCore, DB işlemi içinde satırı kaydın kendisiyle AYNI işlemde yazar (işlemsel outbox): COMMIT ikisini birlikte kalıcılaştırır,
//     geri alma ikisini birlikte siler. Böylece COMMIT ile ertelenmiş gönderim arasındaki pencere de kapanır.
//   - InProcessLedger.submit bir Db.tx içinden çağrılırsa (graf, bilirkişi, hesap silme) satırı yine o işlemde yazar ve iletimi
//     COMMIT sonrasına erteler; işlem dışındaki gönderimleri (kimlik, YZ kaydı ...) anında yazar.
//   - İşlem kanonik zincirde bir bloğa girince satır silinir; kalıcı kipte ancak doğrulayıcı depoları diske indirildikten (fsync)
//     sonra: elektrik kesintisinde kaybolan son bloğun işlemleri de açılışta yeniden gönderilir. Açılışta (start) kalan satırlar
//     yeniden imzalanıp gönderilir.
//
// Yük deftere yazılacak yükün aynısıdır (prepareTx kişisel veriyi reddeder); imza saklanmaz (Ed25519 deterministiktir, açılışta
// uygulama anahtarıyla yeniden üretilir).
import { canonicalJson, type LedgerTxType } from "@forum/shared";
import type { Db } from "../db";

export interface OutboxEntry {
  hash: string;
  type: LedgerTxType;
  /** Normalleştirilmiş (prepareTx) yük. */
  payload: Record<string, unknown>;
  nonce: string;
  /** Simüle saat (ms). */
  submittedAt: number;
}

/** Ham satır: tür ve yük açılışta prepareTx ile yeniden doğrulanır (bozuk satır atılır). */
export interface OutboxRow {
  hash: string;
  type: string;
  payload: string;
  nonce: string;
  submitted_at: number;
}

/** Satırı ekler; aynı özet zaten varsa (ör. ForumCore işlem içinde yazmışsa) dokunmaz. */
export function recordOutbox(db: Db, e: OutboxEntry): void {
  db.run(
    "INSERT OR IGNORE INTO ledger_outbox(hash, type, payload, nonce, submitted_at) VALUES (?, ?, ?, ?, ?)",
    e.hash,
    e.type,
    canonicalJson(e.payload),
    e.nonce,
    e.submittedAt,
  );
}

/** Blokta onaylanan (ya da kalıcı olarak reddedilen) işlemlerin satırlarını tek deyimle siler. */
export function forgetOutbox(db: Db, hashes: readonly string[]): void {
  if (hashes.length === 0) return;
  db.run("DELETE FROM ledger_outbox WHERE hash IN (SELECT value FROM json_each(?))", JSON.stringify(hashes));
}

/** Bekleyen satırlar, gönderim sırasıyla. */
export function loadOutbox(db: Db): OutboxRow[] {
  return db.all<OutboxRow>("SELECT hash, type, payload, nonce, submitted_at FROM ledger_outbox ORDER BY rowid");
}
