// KVKK md. 11/1-d: kimlik verisinin düzeltilmesi. Üye gerekçeli talep açar; kayıt memuru talebi AMAÇ BELİRTEREK inceler
// (pii_access_log + audit_log), sonra onaylar ya da reddeder. Onayda yalnız değişen kasa alanları kişinin DEK'iyle yeni IV'lerle
// yeniden şifrelenir, kör indeksler (TCKN, e-posta, hane) yeniden hesaplanır. Önerilen değerler talep tablosunda yalnız şifreli
// durur ve karar/geri çekme anında imha edilir; denetim günlüğüne yalnız alan ADLARI yazılır, değerler asla.
import { ageOn, maskTckn, type AddressInput, type CorrectableField, type CorrectionRequestView, type CorrectionReview, type CorrectionStatus, type IdentityCorrectionValues, type Role } from "@forum/shared";
import type { AuditLogger } from "../core/audit";
import type { Clock } from "../core/clock";
import type { Notifier } from "../core/contracts";
import { badRequest, conflict, forbidden, notFound } from "../core/errors";
import { newId } from "../core/ids";
import { memberToken } from "../core/notification-text";
import { json, type Db } from "../db";
import type { UserRow } from "./users";
import { CORRECTABLE_FIELDS, parseCorrection, type ValidCorrection } from "./validation";
import { normalizeEmail, openField, openRecord, sealField, sealRecord, tcknDigits, VaultIntegrityError, type Vault, type VaultField } from "./vault";

/** Kasadaki çözülmüş kimlik verisi (index.ts readPii ile aynı biçim). */
export interface PlainIdentity {
  firstName: string;
  lastName: string;
  tckn: string;
  birthDate: string;
  email: string;
  phone: string;
  address: AddressInput;
}

export interface CorrectionDeps {
  db: Db;
  clock: Clock;
  vault: Vault;
  audit: AuditLogger;
  notifier: Notifier;
  readPii(userId: string): PlainIdentity;
  requireRow(userId: string): UserRow;
  requireActor(actorId: string, roles: Role[], msg: string): UserRow;
  registrarIds(): string[];
  isClosed(row: Pick<UserRow, "status">): boolean;
  normalizePurpose(purpose: unknown): string;
  logPiiAccess(actorId: string, userId: string, purpose: string, meta: Record<string, unknown>): void;
  erasedError(): Error;
  integrityError(): Error;
  closedAccount(): Error;
  dupTckn(): Error;
  dupEmail(): Error;
}

interface CorrectionRow {
  id: string;
  user_id: string;
  fields: string;
  enc_payload: string | null;
  enc_reason: string | null;
  key_version: number;
  status: CorrectionStatus;
  reviewed_by: string | null;
  reviewed_at: number | null;
  decided_by: string | null;
  decided_at: number | null;
  decision_note: string | null;
  created_at: number;
  nickname?: string;
}

const RECORD_KIND = "duzeltme";
const STAFF_DECIDE: Role[] = ["registrar", "admin"];
const STAFF_READ: Role[] = ["registrar", "auditor", "admin"];
const NOTE_MAX = 1000;

/** Alan → kasa sütunu (enc_<sütun>) */
const FIELD_COLUMN: Record<CorrectableField, VaultField> = {
  firstName: "first_name",
  lastName: "last_name",
  tckn: "tckn",
  birthDate: "birth_date",
  email: "email",
  phone: "phone",
  address: "address",
};

export const CORRECTABLE_FIELD_LABELS: Record<CorrectableField, string> = {
  firstName: "ad",
  lastName: "soyad",
  tckn: "T.C. kimlik no",
  birthDate: "doğum tarihi",
  email: "e-posta",
  phone: "telefon",
  address: "adres",
};

const fieldOrder = (f: string) => (CORRECTABLE_FIELDS as readonly string[]).indexOf(f);

function sameAddress(a: AddressInput, b: AddressInput): boolean {
  const k = (x: AddressInput) => JSON.stringify([x.il, x.ilce, x.mahalle, x.acikAdres, x.postaKodu ?? ""]);
  return k(a) === k(b);
}

function sameValue(field: CorrectableField, current: PlainIdentity, next: ValidCorrection): boolean {
  switch (field) {
    case "tckn":
      return tcknDigits(current.tckn) === tcknDigits(next.tckn ?? "");
    case "email":
      return normalizeEmail(current.email) === normalizeEmail(next.email ?? "");
    case "address":
      return !!next.address && sameAddress(current.address, next.address);
    default:
      return current[field] === next[field];
  }
}

function serialize(field: CorrectableField, v: ValidCorrection): string {
  if (field === "address") {
    const a = v.address!;
    return JSON.stringify({ il: a.il, ilce: a.ilce, mahalle: a.mahalle, acikAdres: a.acikAdres, ...(a.postaKodu ? { postaKodu: a.postaKodu } : {}) });
  }
  return String(v[field]);
}

/** Yalnız istenen alanları seçer; TCKN maskelenir (incelemede tam TCKN gösterilmez). */
function pickMasked(src: IdentityCorrectionValues, fields: CorrectableField[]): IdentityCorrectionValues {
  const out: IdentityCorrectionValues = {};
  for (const f of fields) {
    const v = src[f];
    if (v === undefined) continue;
    if (f === "tckn") out.tckn = maskTckn(String(v));
    else if (f === "address") out.address = { ...(v as AddressInput) };
    else (out as Record<string, unknown>)[f] = v;
  }
  return out;
}

export function createCorrectionHandlers(d: CorrectionDeps) {
  const { db, clock, vault, audit, notifier } = d;

  const getRow = (id: string) =>
    db.get<CorrectionRow>(
      "SELECT c.*, u.nickname AS nickname FROM identity_corrections c JOIN users u ON u.id = c.user_id WHERE c.id = ?",
      id,
    );
  const requireCorrection = (id: string): CorrectionRow => {
    const r = typeof id === "string" && id ? getRow(id) : undefined;
    if (!r) throw notFound("Düzeltme talebi");
    return r;
  };
  const fieldsOf = (r: CorrectionRow): CorrectableField[] =>
    json<string[]>(r.fields, [])
      .filter((f): f is CorrectableField => (CORRECTABLE_FIELDS as readonly string[]).includes(f))
      .sort((a, b) => fieldOrder(a) - fieldOrder(b));

  function view(r: CorrectionRow, reason?: string | null): CorrectionRequestView {
    return {
      id: r.id,
      userId: r.user_id,
      nickname: r.nickname ?? "",
      fields: fieldsOf(r),
      status: r.status,
      createdAt: Number(r.created_at),
      reviewedAt: r.reviewed_at === null ? null : Number(r.reviewed_at),
      decidedAt: r.decided_at === null ? null : Number(r.decided_at),
      decisionNote: r.decision_note,
      ...(reason !== undefined ? { reason } : {}),
    };
  }

  /** Kişinin DEK'ini açar; fn bitince DEK sıfırlanır. İmha edilmişse 409 pii_erased, bütünlük bozuksa 500. */
  function withDek<T>(userId: string, fn: (dek: Buffer, keyVersion: number) => T): T {
    const v = db.get<{ wrapped_dek: string | null; key_version: number }>("SELECT wrapped_dek, key_version FROM identity_vault WHERE user_id = ?", userId);
    if (!v || !v.wrapped_dek) throw d.erasedError();
    let dek: Buffer | null = null;
    try {
      dek = vault.unwrapDek(userId, v.key_version, v.wrapped_dek);
      return fn(dek, v.key_version);
    } catch (e) {
      if (e instanceof VaultIntegrityError) {
        audit.log(null, "identity.vault_integrity_failure", userId);
        throw d.integrityError();
      }
      throw e;
    } finally {
      dek?.fill(0);
    }
  }

  const openPayload = (dek: Buffer, r: CorrectionRow): ValidCorrection =>
    r.enc_payload ? (JSON.parse(openRecord(dek, r.user_id, RECORD_KIND, r.id, r.key_version, r.enc_payload)) as ValidCorrection) : {};
  const openReason = (dek: Buffer, r: CorrectionRow): string =>
    r.enc_reason ? openRecord(dek, r.user_id, `${RECORD_KIND}-gerekce`, r.id, r.key_version, r.enc_reason) : "";

  /** Önerilen TCKN/e-posta başka bir üyede kayıtlı mı? (kör indeksle; düz metne dokunmadan) */
  function duplicateKinds(userId: string, changes: ValidCorrection): { kind: "tckn" | "email"; otherId: string }[] {
    const out: { kind: "tckn" | "email"; otherId: string }[] = [];
    if (changes.tckn !== undefined) {
      const t = db.get<{ user_id: string }>("SELECT user_id FROM identity_vault WHERE tckn_bidx = ? AND user_id <> ?", vault.tcknIndex(changes.tckn), userId);
      if (t) out.push({ kind: "tckn", otherId: t.user_id });
    }
    if (changes.email !== undefined) {
      const e = db.get<{ user_id: string }>("SELECT user_id FROM identity_vault WHERE email_bidx = ? AND user_id <> ?", vault.emailIndex(changes.email), userId);
      if (e) out.push({ kind: "email", otherId: e.user_id });
    }
    return out;
  }

  /**
   * Yalnız personelin KARAR anında (onay) çağrılır: çakışma 409 duplicate_tckn/duplicate_email. Talep anında çağrılmaz; üyeye dönen
   * ayrık 409, herhangi bir hesapla (bekleyen dahil) bir e-postanın ya da TCKN'nin üye olup olmadığını sorgulatan bir kâhin olurdu
   * (KVKK.md §4.4). Talep anındaki çakışma yalnız denetim günlüğüne yazılır.
   */
  function assertUniqueFor(userId: string, changes: ValidCorrection): void {
    const dup = duplicateKinds(userId, changes)[0];
    if (!dup) return;
    audit.log(userId, "identity.duplicate_attempt", dup.otherId, { kind: dup.kind, via: "correction" });
    throw dup.kind === "tckn" ? d.dupTckn() : d.dupEmail();
  }

  function notifyMember(userId: string, title: string, body: string): void {
    notifier.notify(userId, { kind: "identity_correction", title, body, link: "/profil" });
  }

  return {
    requestCorrection(userId: string, input: unknown): CorrectionRequestView {
      const user = d.requireRow(userId);
      if (d.isClosed(user)) throw d.closedAccount();
      const now = clock.now();
      const { changes, reason } = parseCorrection(input, now);
      if (db.get("SELECT 1 FROM identity_corrections WHERE user_id = ? AND status = 'pending'", userId)) {
        throw conflict("correction_pending", "Bekleyen bir düzeltme talebiniz var; sonuçlanmasını bekleyin ya da önce geri çekin.");
      }
      const current = d.readPii(userId);
      const fields = (Object.keys(changes) as CorrectableField[])
        .filter((f) => changes[f] !== undefined && !sameValue(f, current, changes))
        .sort((a, b) => fieldOrder(a) - fieldOrder(b));
      if (fields.length === 0) {
        throw badRequest("validation", "Önerdiğiniz değerler kayıtlı bilgilerinizle aynı; düzeltilecek bir fark yok.", {
          changes: "Önerdiğiniz değerler kayıtlı bilgilerinizle aynı.",
        });
      }
      const proposed: ValidCorrection = {};
      for (const f of fields) (proposed as Record<string, unknown>)[f] = changes[f];
      // Çakışma burada REDDEDİLMEZ (üyelik kâhini olmasın); kayıt memuru karar anında 409 duplicate_tckn/duplicate_email alır.
      const duplicates = duplicateKinds(userId, proposed);
      const id = newId();
      withDek(userId, (dek, kv) => {
        db.run(
          `INSERT INTO identity_corrections(id, user_id, fields, enc_payload, enc_reason, key_version, status, created_at)
           VALUES (?, ?, ?, ?, ?, ?, 'pending', ?)`,
          id,
          userId,
          JSON.stringify(fields),
          sealRecord(dek, userId, RECORD_KIND, id, kv, JSON.stringify(proposed)),
          sealRecord(dek, userId, `${RECORD_KIND}-gerekce`, id, kv, reason),
          kv,
          now,
        );
      });
      audit.log(userId, "identity.correction_requested", userId, { correctionId: id, fields });
      for (const dup of duplicates) audit.log(userId, "identity.duplicate_attempt", dup.otherId, { kind: dup.kind, via: "correction", correctionId: id });
      for (const rid of d.registrarIds()) {
        if (rid === userId) continue;
        notifier.notify(rid, {
          kind: "identity_correction_pending",
          title: "Kimlik verisi düzeltme talebi",
          body: `"${memberToken(userId)}" takma adlı üye ${fields.map((f) => CORRECTABLE_FIELD_LABELS[f]).join(", ")} için düzeltme talep etti.`,
          link: "/kayit-memuru?sekme=duzeltmeler",
        });
      }
      return view(requireCorrection(id), reason);
    },

    myCorrections(userId: string): CorrectionRequestView[] {
      const rows = db.all<CorrectionRow>(
        `SELECT c.*, u.nickname AS nickname FROM identity_corrections c JOIN users u ON u.id = c.user_id
         WHERE c.user_id = ? ORDER BY c.created_at DESC, c.rowid DESC`,
        userId,
      );
      if (rows.length === 0) return [];
      let reasons: Map<string, string> | null = null;
      try {
        reasons = withDek(userId, (dek) => new Map(rows.map((r) => [r.id, openReason(dek, r)] as const)));
      } catch {
        reasons = null; // imha edilmiş kasa: gerekçeler artık çözülemez
      }
      return rows.map((r) => view(r, reasons?.get(r.id) ?? null));
    },

    withdrawCorrection(userId: string, correctionId: string): CorrectionRequestView {
      const r = requireCorrection(correctionId);
      if (r.user_id !== userId) throw notFound("Düzeltme talebi");
      if (r.status !== "pending") throw conflict("invalid_state", "Yalnızca bekleyen bir düzeltme talebi geri çekilebilir.");
      const now = clock.now();
      db.run(
        "UPDATE identity_corrections SET status = 'withdrawn', enc_payload = NULL, decided_by = ?, decided_at = ? WHERE id = ? AND status = 'pending'",
        userId,
        now,
        r.id,
      );
      audit.log(userId, "identity.correction_withdrawn", userId, { correctionId: r.id, fields: fieldsOf(r) });
      let reason: string | null = null;
      try {
        reason = withDek(userId, (dek) => openReason(dek, r));
      } catch {
        reason = null;
      }
      return view(requireCorrection(r.id), reason);
    },

    listCorrections(actorId: string, status: CorrectionStatus | "all" = "pending"): CorrectionRequestView[] {
      d.requireActor(actorId, STAFF_READ, "Düzeltme taleplerini yalnızca kayıt memuru, denetçi ya da yönetici görebilir.");
      const valid = ["pending", "approved", "rejected", "withdrawn", "all"];
      if (!valid.includes(status)) throw badRequest("validation", "Geçersiz durum süzgeci.", { status: "Geçersiz durum süzgeci." });
      const rows =
        status === "all"
          ? db.all<CorrectionRow>(
              `SELECT c.*, u.nickname AS nickname FROM identity_corrections c JOIN users u ON u.id = c.user_id
               ORDER BY CASE c.status WHEN 'pending' THEN 0 ELSE 1 END, c.created_at DESC, c.rowid DESC LIMIT 500`,
            )
          : db.all<CorrectionRow>(
              `SELECT c.*, u.nickname AS nickname FROM identity_corrections c JOIN users u ON u.id = c.user_id
               WHERE c.status = ? ORDER BY c.created_at ASC, c.rowid ASC LIMIT 500`,
              status,
            );
      return rows.map((r) => view(r));
    },

    reviewCorrection(actorId: string, correctionId: string, purpose: string): CorrectionReview {
      d.requireActor(actorId, STAFF_READ, "Düzeltme taleplerini yalnızca kayıt memuru, denetçi ya da yönetici inceleyebilir.");
      const p = d.normalizePurpose(purpose);
      const r = requireCorrection(correctionId);
      const fields = fieldsOf(r);
      const now = clock.now();
      // Önce erişim kaydı (amaç), sonra çözme: kayıt düşmeden kişisel veri gösterilmez.
      d.logPiiAccess(actorId, r.user_id, p, { correctionId: r.id, fields });
      const { proposed, reason } = withDek(r.user_id, (dek) => ({ proposed: openPayload(dek, r), reason: openReason(dek, r) }));
      const current = d.readPii(r.user_id);
      if (r.status === "pending") {
        db.run("UPDATE identity_corrections SET reviewed_by = ?, reviewed_at = ? WHERE id = ?", actorId, now, r.id);
      }
      return {
        request: view(requireCorrection(r.id)),
        reason,
        current: pickMasked(current, fields),
        proposed: pickMasked(proposed as IdentityCorrectionValues, fields),
      };
    },

    decideCorrection(actorId: string, correctionId: string, decision: "approve" | "reject", note?: string): CorrectionRequestView {
      d.requireActor(actorId, STAFF_DECIDE, "Düzeltme talebine yalnızca kayıt memuru ya da yönetici karar verebilir.");
      if (decision !== "approve" && decision !== "reject") {
        throw badRequest("validation", "Karar 'approve' ya da 'reject' olmalıdır.", { decision: "Karar 'approve' ya da 'reject' olmalıdır." });
      }
      const r = requireCorrection(correctionId);
      if (r.user_id === actorId) throw forbidden("Kendi düzeltme talebinize karar veremezsiniz; başka bir kayıt memuru incelemelidir.");
      if (r.status !== "pending") throw conflict("invalid_state", "Bu düzeltme talebi zaten sonuçlanmış.");
      if (r.reviewed_by !== actorId) {
        throw conflict("review_required", "Karar vermeden önce talebi amaç belirterek inceleyin (erişim kayda geçer).");
      }
      const user = d.requireRow(r.user_id);
      if (d.isClosed(user)) throw d.closedAccount();
      const cleanNote = typeof note === "string" ? note.normalize("NFKC").trim().slice(0, NOTE_MAX) : "";
      const fields = fieldsOf(r);
      const now = clock.now();

      if (decision === "reject") {
        db.run(
          `UPDATE identity_corrections SET status = 'rejected', enc_payload = NULL, decided_by = ?, decided_at = ?, decision_note = ?
           WHERE id = ? AND status = 'pending'`,
          actorId,
          now,
          cleanNote || null,
          r.id,
        );
        audit.log(actorId, "identity.correction_rejected", r.user_id, { correctionId: r.id, fields, hasNote: cleanNote.length > 0 });
        notifyMember(
          r.user_id,
          "Düzeltme talebiniz reddedildi",
          `Kimlik verisi düzeltme talebiniz (${fields.map((f) => CORRECTABLE_FIELD_LABELS[f]).join(", ")}) kayıt memuru tarafından reddedildi; kayıtlı bilgileriniz değişmedi.` +
            (cleanNote ? ` Not: ${cleanNote}` : ""),
        );
        return view(requireCorrection(r.id));
      }

      try {
        db.tx(() => {
          withDek(r.user_id, (dek, kv) => {
            const proposed = openPayload(dek, r);
            assertUniqueFor(r.user_id, proposed);
            const sets: string[] = [];
            const params: (string | number | null)[] = [];
            for (const f of fields) {
              if (proposed[f] === undefined) continue;
              const col = FIELD_COLUMN[f];
              // Yeni rastgele IV ile yeniden şifreleme (alan anahtarı ve AAD kasa alanıyla aynı).
              sets.push(`enc_${col} = ?`);
              params.push(sealField(dek, r.user_id, col, kv, serialize(f, proposed)));
            }
            if (proposed.tckn !== undefined) {
              sets.push("tckn_bidx = ?");
              params.push(vault.tcknIndex(proposed.tckn));
            }
            if (proposed.email !== undefined) {
              sets.push("email_bidx = ?");
              params.push(vault.emailIndex(proposed.email));
            }
            if (proposed.address !== undefined) {
              sets.push("household_bidx = ?");
              params.push(vault.householdIndex(proposed.address));
            }
            sets.push("updated_at = ?");
            params.push(now);
            db.run(`UPDATE identity_vault SET ${sets.join(", ")} WHERE user_id = ?`, ...params, r.user_id);
            if (proposed.address !== undefined) {
              db.run("UPDATE users SET region_il = ?, region_ilce = ? WHERE id = ?", proposed.address.il, proposed.address.ilce, r.user_id);
            }
            if (proposed.birthDate !== undefined) {
              db.run("UPDATE users SET is_adult = ? WHERE id = ?", ageOn(proposed.birthDate, now) >= 18 ? 1 : 0, r.user_id);
            }
            // Doğrulama: yeni alanlar aynı DEK ile çözülebiliyor mu?
            const v = db.get<Record<string, string | null>>("SELECT * FROM identity_vault WHERE user_id = ?", r.user_id)!;
            for (const f of fields) {
              const col = FIELD_COLUMN[f];
              if (proposed[f] === undefined) continue;
              if (openField(dek, r.user_id, col, kv, String(v[`enc_${col}`])) !== serialize(f, proposed)) {
                throw new VaultIntegrityError("Yeniden şifrelenen alan doğrulanamadı.");
              }
            }
          });
          db.run(
            `UPDATE identity_corrections SET status = 'approved', enc_payload = NULL, decided_by = ?, decided_at = ?, decision_note = ?
             WHERE id = ? AND status = 'pending'`,
            actorId,
            now,
            cleanNote || null,
            r.id,
          );
        });
      } catch (e) {
        const msg = e instanceof Error ? e.message : "";
        if (msg.includes("UNIQUE") && msg.includes("tckn_bidx")) throw d.dupTckn();
        if (msg.includes("UNIQUE") && msg.includes("email_bidx")) throw d.dupEmail();
        throw e;
      }
      audit.log(actorId, "identity.correction_approved", r.user_id, { correctionId: r.id, fields, hasNote: cleanNote.length > 0 });
      notifyMember(
        r.user_id,
        "Kimlik bilgileriniz düzeltildi",
        `Düzeltme talebiniz onaylandı; ${fields.map((f) => CORRECTABLE_FIELD_LABELS[f]).join(", ")} bilgileriniz güncellendi.` + (cleanNote ? ` Not: ${cleanNote}` : ""),
      );
      return view(requireCorrection(r.id));
    },
  };
}
