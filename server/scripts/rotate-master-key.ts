// Ana anahtar dönüşümü (KVKK.md §8): kimlik kasasındaki her canlı DEK'i yeni ana anahtardan türetilen KEK ile yeniden sarar,
// kör indeksleri yeniden hesaplar ve işlemi bitirmeden her satırı yeni anahtarla çözerek doğrular.
//
// Çalıştırma (SUNUCU KAPALIYKEN; server klasöründen):
//   npx tsx scripts/rotate-master-key.ts --dry-run       # yalnız dener: hesaplar + doğrular, veritabanını değiştirmez
//   npx tsx scripts/rotate-master-key.ts                 # uygular
//   npx tsx scripts/rotate-master-key.ts --keep-old      # eski anahtar dosyasını master.key.eski-<zaman> olarak saklar
//
// Anahtar kaynakları:
//   - Eski anahtar: MASTER_KEY ortam değişkeni; yoksa DATA_DIR/keys/master.key (dosya yoksa betik durur, YENİ ANAHTAR ÜRETMEZ).
//   - Yeni anahtar: NEW_MASTER_KEY ortam değişkeni (64+ hex). Eski anahtar ortam değişkeninden geliyorsa ZORUNLUDUR (yeni anahtarı
//     gizli deponuza/KMS'e siz koyarsınız; betik anahtarı ekrana yazmaz). Dosya kipinde verilmezse rastgele üretilir.
// Dosya kipinde sıra: (1) yeni anahtar keys/master.key.yeni'ye yazılır, (2) veritabanı tek işlemde dönüştürülür ve doğrulanır,
// (3) master.key.yeni → master.key. (2) ile (3) arasında kesilirse: master.key.yeni'yi master.key yapın (betik bunu algılar).
import { randomBytes } from "node:crypto";
import { copyFileSync, existsSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { SERVER_ROOT } from "../src/core/config";
import { acquireDataDirLock, type DataDirLock } from "../src/core/lock";
import { json, openDb } from "../src/db";
import { rotateMasterKey, verifyVaultDecryptable, type RotationReport } from "../src/identity/rotate";

function fail(msg: string): never {
  console.error(`\n✘ ${msg}\n`);
  process.exit(1);
}

const held: { lock: DataDirLock | null } = { lock: null };

function main(): void {
  const args = new Set(process.argv.slice(2));
  const unknown = [...args].filter((a) => !["--dry-run", "--keep-old", "--help", "-h"].includes(a));
  if (unknown.length) fail(`Bilinmeyen seçenek: ${unknown.join(", ")} (geçerli: --dry-run, --keep-old)`);
  if (args.has("--help") || args.has("-h")) {
    console.log("Kullanım: npx tsx scripts/rotate-master-key.ts [--dry-run] [--keep-old]   (ayrıntı: docs/KVKK.md §8)");
    return;
  }
  const dryRun = args.has("--dry-run");
  const keepOld = args.has("--keep-old");
  const dataDir = resolve(process.env.DATA_DIR || join(SERVER_ROOT, "data"));
  const dbPath = process.env.DB_PATH || join(dataDir, "forum.db");
  const keyFile = join(dataDir, "keys", "master.key");
  const pendingFile = join(dataDir, "keys", "master.key.yeni");

  // Sunucu çalışırken dönüşüm, sunucunun bellekteki eski anahtarla yazmaya devam etmesine yol açar: veri klasörü kilidi.
  try {
    held.lock = acquireDataDirLock(dataDir);
  } catch (e) {
    fail(e instanceof Error ? e.message : String(e));
  }
  if (!existsSync(dbPath)) fail(`Veritabanı bulunamadı: ${dbPath}`);
  const envMode = typeof process.env.MASTER_KEY === "string" && process.env.MASTER_KEY.length > 0;
  if (!envMode && existsSync(pendingFile)) {
    fail(
      `Yarım kalmış bir dönüşüm dosyası var: ${pendingFile}. Önceki çalıştırma veritabanını dönüştürdükten sonra kesildiyse bu dosya ` +
        "YENİ anahtardır: master.key'i yedekleyip bu dosyayı master.key olarak adlandırın. Dönüştürmeden kesildiyse dosyayı silin.",
    );
  }
  let oldKey: string;
  if (envMode) oldKey = process.env.MASTER_KEY!.trim();
  else if (existsSync(keyFile)) oldKey = readFileSync(keyFile, "utf8").trim();
  else fail(`Ana anahtar bulunamadı: MASTER_KEY tanımlı değil ve ${keyFile} yok.`);

  let newKey = process.env.NEW_MASTER_KEY?.trim() ?? "";
  if (!newKey) {
    if (envMode) fail("MASTER_KEY ortam değişkeninden okunuyor: yeni anahtarı NEW_MASTER_KEY ortam değişkeniyle verin (64+ hex karakter).");
    newKey = randomBytes(32).toString("hex");
  }

  const db = openDb(dbPath);
  let now: number;
  try {
    // Denetim kaydının zamanı sunucunun simüle saatiyle tutarlı olsun (meta.sim_clock); yoksa gerçek saat.
    const sim = json<{ simNow?: number } | null>(db.get<{ value: string }>("SELECT value FROM meta WHERE key = 'sim_clock'")?.value, null);
    now = typeof sim?.simNow === "number" ? sim.simNow : Date.now();
  } catch {
    now = Date.now();
  }

  console.log(`Ana anahtar dönüşümü${dryRun ? " (DENEME — veritabanı değişmez)" : ""}`);
  console.log(`  Veritabanı : ${dbPath}`);
  console.log(`  Anahtar    : ${envMode ? "MASTER_KEY → NEW_MASTER_KEY (ortam değişkeni)" : keyFile}`);
  console.log("  Uyarı      : sunucu bu sırada ÇALIŞMAMALIDIR (bellekteki eski anahtarla yazmaya devam eder).");

  if (!envMode && !dryRun) writeFileSync(pendingFile, newKey, { mode: 0o600 });
  let report: RotationReport;
  try {
    report = rotateMasterKey(db, oldKey, newKey, { now, dryRun });
  } catch (e) {
    db.close();
    if (!envMode && !dryRun) rmSync(pendingFile, { force: true });
    fail(`Dönüşüm yapılmadı (işlem geri alındı): ${e instanceof Error ? e.message : String(e)}`);
  }
  console.log(`  Kasa satırı: ${report.total} · yeniden sarılan DEK: ${report.rewrapped} · kripto-imha edilmiş (atlandı): ${report.erased}`);
  console.log(`  Yeni anahtarla doğrulanan satır (işlem içinde): ${report.verified}`);

  if (dryRun) {
    db.close();
    console.log("\n✔ Deneme başarılı. Uygulamak için --dry-run olmadan çalıştırın.");
    return;
  }

  // İşlem sonrası bağımsız denetim (veritabanından yeniden okuyarak).
  const after = verifyVaultDecryptable(db, newKey);
  db.close();
  if (after.failed.length) {
    fail(
      `İşlem sonrası denetimde ${after.failed.length} satır yeni anahtarla açılamadı. ` +
        (envMode ? "Eski MASTER_KEY'i saklayın ve sorunu inceleyin." : `Anahtarlar: eski ${keyFile}, yeni ${pendingFile} — ikisini de saklayın.`),
    );
  }
  console.log(`  İşlem sonrası denetim: ${after.checked}/${after.checked} satır yeni anahtarla çözüldü.`);

  if (envMode) {
    console.log("\n✔ Dönüşüm tamam. Sunucuyu MASTER_KEY = (NEW_MASTER_KEY değeri) ile başlatın ve eski anahtarı gizli depodan imha edin.");
  } else {
    if (keepOld) {
      const stamp = new Date().toISOString().replace(/[:.]/g, "-");
      const backup = join(dataDir, "keys", `master.key.eski-${stamp}`);
      copyFileSync(keyFile, backup);
      console.log(`  Eski anahtar yedeklendi: ${backup} (dönüşümün amacı için bunu güvenli yere taşıyıp sonra imha edin).`);
    }
    renameSync(pendingFile, keyFile);
    console.log(`\n✔ Dönüşüm tamam. Yeni anahtar: ${keyFile}${keepOld ? "" : " (eski anahtar dosyası kalmadı)"}.`);
  }
  console.log("  Not: defterdeki memberRef takma referansları da ana anahtardan türetilir; bundan sonraki kayıtlar yeni referansla yazılır.");
}

try {
  main();
} finally {
  held.lock?.release();
}
