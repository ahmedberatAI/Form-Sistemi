// Ana anahtar (MASTER_KEY) dönüşümü: her canlı DEK eski ana anahtarın KEK'iyle açılır ve YENİ ana anahtardan türetilen KEK'le
// yeniden sarılır. Alan şifreli metinleri değişmez (DEK aynı kalır; zarf şifrelemenin amacı budur). Kör indeksler (TCKN,
// e-posta, hane) de ana anahtardan türetildiği için çözülen değerlerden yeniden hesaplanır. Tüm iş tek bir SQLite işleminde
// yapılır; işlem bitmeden her satır yeni anahtarla yeniden çözülerek doğrulanır, herhangi bir hata tüm değişikliği geri alır.
// Kripto-imha edilmiş satırlar (wrapped_dek NULL) atlanır: onların DEK'i zaten yoktur.
import { createAuditLogger } from "../core/audit";
import type { Db } from "../db";
import { createVault, openField, parseMasterKey, VAULT_FIELDS, VaultIntegrityError, type Vault, type VaultField } from "./vault";
import type { AddressInput } from "@forum/shared";

export interface RotationReport {
  dryRun: boolean;
  /** identity_vault satır sayısı */
  total: number;
  /** DEK'i yeniden sarılan (canlı) satırlar */
  rewrapped: number;
  /** Kripto-imha edilmiş, atlanan satırlar */
  erased: number;
  /** Yeni anahtarla yeniden çözülerek doğrulanan satırlar (işlem içinde) */
  verified: number;
}

interface Row {
  user_id: string;
  wrapped_dek: string | null;
  key_version: number;
  tckn_bidx: string | null;
  email_bidx: string | null;
  household_bidx: string | null;
  [col: string]: string | number | null;
}

class DryRunRollback extends Error {}

type Plain = Record<VaultField, string>;

function decryptAll(vault: Vault, r: Row): { dek: Buffer; plain: Plain } {
  const dek = vault.unwrapDek(r.user_id, r.key_version, r.wrapped_dek!);
  const plain = {} as Plain;
  for (const f of VAULT_FIELDS) {
    const sealed = r[`enc_${f}`];
    if (typeof sealed !== "string") throw new VaultIntegrityError(`Kasa alanı eksik (${f}).`);
    plain[f] = openField(dek, r.user_id, f, r.key_version, sealed);
  }
  return { dek, plain };
}

function indexes(vault: Vault, p: Plain): { tckn: string; email: string; household: string } {
  return {
    tckn: vault.tcknIndex(p.tckn),
    email: vault.emailIndex(p.email),
    household: vault.householdIndex(JSON.parse(p.address) as AddressInput),
  };
}

/**
 * Ana anahtarı döndürür. `dryRun`: her şey hesaplanır ve doğrulanır ama işlem geri alınır (veritabanı değişmez).
 * Eski anahtar bir satırı açamazsa (yanlış anahtar ya da bozuk satır) hiçbir değişiklik yapılmadan hata fırlatılır.
 */
export function rotateMasterKey(db: Db, oldMasterHex: string, newMasterHex: string, opts: { now: number; dryRun?: boolean }): RotationReport {
  const oldKey = parseMasterKey(oldMasterHex);
  const newKey = parseMasterKey(newMasterHex);
  if (oldKey.equals(newKey)) throw new Error("Yeni ana anahtar eskisiyle aynı olamaz.");
  const oldVault = createVault(oldMasterHex);
  const newVault = createVault(newMasterHex);
  const dryRun = opts.dryRun === true;
  const report: RotationReport = { dryRun, total: 0, rewrapped: 0, erased: 0, verified: 0 };

  try {
    db.tx(() => {
      const rows = db.all<Row>("SELECT * FROM identity_vault ORDER BY user_id");
      report.total = rows.length;
      const expected = new Map<string, { plain: Plain; idx: ReturnType<typeof indexes> }>();
      const failures: string[] = [];

      // 1) Yeniden sarma + kör indeksler
      for (const r of rows) {
        if (!r.wrapped_dek) {
          report.erased++;
          continue;
        }
        let dek: Buffer | null = null;
        try {
          const opened = decryptAll(oldVault, r);
          dek = opened.dek;
          const idx = indexes(newVault, opened.plain);
          db.run(
            "UPDATE identity_vault SET wrapped_dek = ?, tckn_bidx = ?, email_bidx = ?, household_bidx = ?, updated_at = ? WHERE user_id = ?",
            newVault.wrapDek(r.user_id, r.key_version, dek),
            idx.tckn,
            idx.email,
            idx.household,
            opts.now,
            r.user_id,
          );
          expected.set(r.user_id, { plain: opened.plain, idx });
          report.rewrapped++;
        } catch (e) {
          failures.push(`${r.user_id}: ${e instanceof Error ? e.message : String(e)}`);
        } finally {
          dek?.fill(0);
        }
      }
      if (failures.length) {
        throw new Error(
          `${failures.length} kasa satırı eski anahtarla açılamadı (yanlış MASTER_KEY ya da bozuk satır); hiçbir değişiklik yapılmadı. İlk: ${failures[0]}`,
        );
      }

      // 2) Doğrulama: işlem içinde, yalnız YENİ anahtarla yeniden oku ve karşılaştır; eski anahtar artık açamamalı.
      for (const r of db.all<Row>("SELECT * FROM identity_vault WHERE wrapped_dek IS NOT NULL ORDER BY user_id")) {
        const exp = expected.get(r.user_id);
        if (!exp) throw new Error(`Doğrulama: beklenmeyen satır ${r.user_id}.`);
        const { dek, plain } = decryptAll(newVault, r);
        dek.fill(0);
        for (const f of VAULT_FIELDS) if (plain[f] !== exp.plain[f]) throw new Error(`Doğrulama: ${r.user_id} satırının ${f} alanı uyuşmuyor.`);
        if (r.tckn_bidx !== exp.idx.tckn || r.email_bidx !== exp.idx.email || r.household_bidx !== exp.idx.household) {
          throw new Error(`Doğrulama: ${r.user_id} satırının kör indeksleri uyuşmuyor.`);
        }
        let oldStillOpens = true;
        try {
          oldVault.unwrapDek(r.user_id, r.key_version, r.wrapped_dek!).fill(0);
        } catch {
          oldStillOpens = false;
        }
        if (oldStillOpens) throw new Error(`Doğrulama: ${r.user_id} satırı hâlâ eski anahtarla açılabiliyor.`);
        report.verified++;
      }

      if (dryRun) throw new DryRunRollback();
      // Denetim kaydı: kişisel veri ve anahtar içermez.
      createAuditLogger({ db, clock: { now: () => opts.now, advance: () => undefined, offset: () => 0 } }).log(null, "identity.master_key_rotated", null, {
        rewrapped: report.rewrapped,
        erased: report.erased,
      });
    });
  } catch (e) {
    if (!(e instanceof DryRunRollback)) throw e;
  }
  return report;
}

/** İşlem sonrası bağımsız denetim: tüm canlı satırlar verilen anahtarla açılıyor mu? Açılamayan kullanıcı kimliklerini döndürür. */
export function verifyVaultDecryptable(db: Db, masterHex: string): { checked: number; failed: string[] } {
  const vault = createVault(masterHex);
  const failed: string[] = [];
  let checked = 0;
  for (const r of db.all<Row>("SELECT * FROM identity_vault WHERE wrapped_dek IS NOT NULL ORDER BY user_id")) {
    checked++;
    try {
      const { dek, plain } = decryptAll(vault, r);
      dek.fill(0);
      if (r.tckn_bidx !== vault.tcknIndex(plain.tckn) || r.email_bidx !== vault.emailIndex(plain.email)) failed.push(r.user_id);
    } catch {
      failed.push(r.user_id);
    }
  }
  return { checked, failed };
}
