// Kimlik ve KVKK modülü: kayıt, doğrulama, oturum, şifreli kimlik kasası, rızalar, KVKK hakları (döküm, kripto-imha).
// Gerçek kimlik yalnızca identity_vault'ta, alan bazında AES-256-GCM ile şifreli durur; diğer modüller yalnızca
// rastgele üye kimliğini (users.id) ve takma adı görür. Deftere yalnızca memberRef (anahtarlı HMAC) yazılır.
import { ageOn, maskTckn, ROLE_LABELS, type AddressInput, type LedgerTxType, type Me, type PiiRecord, type Role } from "@forum/shared";
import type { AuditLogger } from "../core/audit";
import type { CoreContext, IdentityService, LedgerService, Notifier } from "../core/contracts";
import { AppError, badRequest, conflict, forbidden, notFound, unprocessable } from "../core/errors";
import { newId } from "../core/ids";
import { memberToken, renderNotificationRows } from "../core/notification-text";
import { json, type SqlValue } from "../db";
import { dummyVerify, hashPassword, INVALID_PASSWORD_HASH, verifyPassword } from "./password";
import { createTokenSigner, SESSION_TTL_MS } from "./sessions";
import {
  ALL_ROLES,
  hasAnyRole,
  loadExpertRow,
  loadUserRow,
  parseRoles,
  toAuthUser,
  toMe,
  type UserRow,
} from "./users";
import { normalizeNickname, parseNickname, parsePassword, parseRegistration, validationError } from "./validation";
import { createVault, CURRENT_KEY_VERSION, openField, sealField, VaultIntegrityError, type VaultField } from "./vault";
import { createCorrectionHandlers } from "./corrections";
import { DAY } from "../core/clock";
import { assertNotSimilar, isConflictKey, migrateNicknameKeys, NICKNAME_CHANGE_INTERVAL_MS } from "./nickname";

export { isVoter, loadPublicUser, parseRoles, toAuthUser, toMe, toPublicUser, ALL_ROLES, type UserRow } from "./users";
export { normalizeNickname, normalizePhone } from "./validation";
export { createVault, normalizeEmail, normalizeHousehold, type Vault } from "./vault";
export { rotateMasterKey, verifyVaultDecryptable, type RotationReport } from "./rotate";
export { SESSION_TTL_MS } from "./sessions";

export interface IdentityDeps {
  ledger: LedgerService | null;
  notifier: Notifier;
  audit: AuditLogger;
}

/** IdentityService + HTTP katmanı ve zamanlayıcı için ek yardımcılar. */
export interface IdentityServiceImpl extends IdentityService {
  /** Hesap silme gibi hassas işlemlerden önce şifre teyidi. */
  verifyPassword(userId: string, password: string): Promise<boolean>;
  /** keepToken verilirse o oturum açık kalır; diğer tüm oturumlar iptal edilir. */
  changePassword(userId: string, oldPw: string, newPw: string, keepToken?: string): Promise<void>;
  /** Doğrulama sonrası 18 yaşını dolduran üyelerin is_adult alanını günceller; güncellenen sayıyı döndürür. */
  refreshAdulthood(): number;
  /**
   * Periyodik imha: maxAgeMs'den uzun süredir doğrulanmamış başvuruları reddedilmiş sayar ve kasalarını kripto-imha eder.
   * Varsayılan 180 gün. İmha edilen başvuru sayısını döndürür.
   */
  purgeStalePending(maxAgeMs?: number): number;
  /** Defterdeki takma üye referansı (HMAC). Kişisel veri içermez. */
  memberRef(userId: string): string;
}

interface VaultRow {
  user_id: string;
  wrapped_dek: string | null;
  enc_first_name: string | null;
  enc_last_name: string | null;
  enc_tckn: string | null;
  enc_birth_date: string | null;
  enc_email: string | null;
  enc_phone: string | null;
  enc_address: string | null;
  tckn_bidx: string | null;
  email_bidx: string | null;
  household_bidx: string | null;
  key_version: number;
}

interface DecryptedPii {
  firstName: string;
  lastName: string;
  tckn: string;
  birthDate: string;
  email: string;
  phone: string;
  address: AddressInput;
}

const STAFF_REGISTRAR: Role[] = ["registrar", "admin"];
const STAFF_PII: Role[] = ["registrar", "auditor", "admin"];
const LOGIN_FAILED = "Takma ad/e-posta veya şifre hatalı.";
const STALE_PENDING_MS = 180 * 24 * 3_600_000;

const dupNickname = () => conflict("duplicate_nickname", "Bu takma ad zaten kullanılıyor.", { nickname: "Bu takma ad zaten kullanılıyor." });
const dupTckn = () =>
  conflict("duplicate_tckn", "Bu T.C. kimlik numarasıyla kayıtlı bir üyelik zaten var.", { tckn: "Bu T.C. kimlik numarasıyla kayıtlı bir üyelik zaten var." });
const dupEmail = () =>
  conflict("duplicate_email", "Bu e-posta adresiyle kayıtlı bir üyelik zaten var.", { email: "Bu e-posta adresiyle kayıtlı bir üyelik zaten var." });
const integrityError = () =>
  new AppError(500, "vault_integrity", "Kimlik kasası bütünlük denetimi başarısız: şifreli veri ya da bağlamı değiştirilmiş olabilir.");
const erasedError = () => conflict("pii_erased", "Bu üyenin kişisel verileri imha edilmiştir (kripto-imha).");
const closedAccount = () => conflict("invalid_state", "Bu hesap silinmiş ya da reddedilmiş; işlem yapılamaz.");

const isClosed = (row: Pick<UserRow, "status">) => row.status === "erased" || row.status === "rejected";

const camel = (k: string) => k.replace(/_([a-z])/g, (_, c: string) => c.toUpperCase());
const EXPORT_JSON_COLS = new Set(["categories", "rights_flags", "domains", "meta", "ai_flags", "risks", "answers", "lint"]);

export function createIdentityService(ctx: CoreContext, deps: IdentityDeps): IdentityServiceImpl {
  const { db, clock } = ctx;
  const vault = createVault(ctx.config.masterKey);
  const signer = createTokenSigner(ctx.config.tokenKey);
  // Silinen/üzerine yazılan kayıtların eski baytları sayfalarda kalmasın (kripto-imhayı destekler).
  try {
    db.exec("PRAGMA secure_delete = ON;");
  } catch {
    /* desteklenmiyorsa yok say */
  }
  // Takma ad anahtarı kuralı değiştiyse (I/ı katlaması) kayıtlı nickname_norm değerlerini bir kez yeniden hesapla.
  migrateNicknameKeys(db, deps.audit, deps.notifier);

  const getRow = (id: string) => loadUserRow(db, id);
  const requireRow = (id: string): UserRow => {
    const r = getRow(id);
    if (!r) throw notFound("Kullanıcı");
    return r;
  };
  const meOf = (row: UserRow): Me => toMe(row, loadExpertRow(db, row.id));

  function requireActor(actorId: string, roles: Role[], msg: string): UserRow {
    const a = getRow(actorId);
    if (!a || a.status !== "verified" || !hasAnyRole(parseRoles(a.roles), roles)) throw forbidden(msg);
    return a;
  }

  function submitLedger(type: LedgerTxType, payload: Record<string, unknown>): void {
    if (!deps.ledger) return;
    try {
      deps.ledger.submit(type, payload);
    } catch (e) {
      deps.audit.log(null, "identity.ledger_error", null, { type, error: e instanceof Error ? e.message : String(e) });
    }
  }

  function registrarIds(): string[] {
    return db
      .all<{ id: string; roles: string }>("SELECT id, roles FROM users WHERE status = 'verified' AND roles LIKE '%registrar%'")
      .filter((r) => parseRoles(r.roles).includes("registrar"))
      .map((r) => r.id);
  }

  function vaultRow(userId: string): VaultRow | undefined {
    return db.get<VaultRow>("SELECT * FROM identity_vault WHERE user_id = ?", userId);
  }

  /** Kasayı çözer. İmha edilmişse 409 pii_erased; bütünlük bozuksa 500 vault_integrity. */
  function readPii(userId: string): DecryptedPii {
    const v = vaultRow(userId);
    if (!v || !v.wrapped_dek) throw erasedError();
    let dek: Buffer | null = null;
    try {
      dek = vault.unwrapDek(userId, v.key_version, v.wrapped_dek);
      const open = (f: VaultField): string => {
        const sealed = v[`enc_${f}` as keyof VaultRow] as string | null;
        if (sealed == null) throw new VaultIntegrityError("Kasa alanı eksik.");
        return openField(dek!, userId, f, v.key_version, sealed);
      };
      return {
        firstName: open("first_name"),
        lastName: open("last_name"),
        tckn: open("tckn"),
        birthDate: open("birth_date"),
        email: open("email"),
        phone: open("phone"),
        address: JSON.parse(open("address")) as AddressInput,
      };
    } catch (e) {
      if (e instanceof VaultIntegrityError) {
        deps.audit.log(null, "identity.vault_integrity_failure", userId);
        throw integrityError();
      }
      throw e;
    } finally {
      dek?.fill(0);
    }
  }

  function assertUnique(nicknameNorm: string, tcknBidx: string, emailBidx: string): void {
    if (db.get("SELECT 1 FROM users WHERE nickname_norm = ?", nicknameNorm)) throw dupNickname();
    const t = db.get<{ user_id: string }>("SELECT user_id FROM identity_vault WHERE tckn_bidx = ?", tcknBidx);
    if (t) {
      deps.audit.log(null, "identity.duplicate_attempt", t.user_id, { kind: "tckn" });
      throw dupTckn();
    }
    const e = db.get<{ user_id: string }>("SELECT user_id FROM identity_vault WHERE email_bidx = ?", emailBidx);
    if (e) {
      deps.audit.log(null, "identity.duplicate_attempt", e.user_id, { kind: "email" });
      throw dupEmail();
    }
  }

  function mapUniqueError(e: unknown): unknown {
    const msg = e instanceof Error ? e.message : "";
    if (!msg.includes("UNIQUE")) return e;
    if (msg.includes("nickname_norm")) return dupNickname();
    if (msg.includes("tckn_bidx")) return dupTckn();
    if (msg.includes("email_bidx")) return dupEmail();
    return e;
  }

  async function createAccount(input: unknown, verifiedBy: string | null): Promise<UserRow> {
    const now = clock.now();
    const v = parseRegistration(input, now);
    const nicknameNorm = normalizeNickname(v.nickname);
    const tcknBidx = vault.tcknIndex(v.tckn);
    const emailBidx = vault.emailIndex(v.email);
    assertUnique(nicknameNorm, tcknBidx, emailBidx);
    assertNotSimilar(db, v.nickname, null);

    const passwordHash = await hashPassword(v.password);
    const id = newId();
    const kv = CURRENT_KEY_VERSION;
    const isAdult = ageOn(v.birthDate, now) >= 18;
    const address: AddressInput = {
      il: v.address.il,
      ilce: v.address.ilce,
      mahalle: v.address.mahalle,
      acikAdres: v.address.acikAdres,
      ...(v.address.postaKodu ? { postaKodu: v.address.postaKodu } : {}),
    };
    const { dek, wrapped } = vault.newDek(id, kv);
    try {
      const seal = (f: VaultField, s: string) => sealField(dek, id, f, kv, s);
      db.tx(() => {
        assertUnique(nicknameNorm, tcknBidx, emailBidx);
        assertNotSimilar(db, v.nickname, null);
        db.run(
          `INSERT INTO users(id, nickname, nickname_norm, password_hash, roles, status, is_adult, region_il, region_ilce,
             political_consent, ai_consent, kvkk_notice_at, created_at, verified_at, verified_by)
           VALUES (?, ?, ?, ?, '["member"]', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          id,
          v.nickname,
          nicknameNorm,
          passwordHash,
          verifiedBy ? "verified" : "pending",
          isAdult ? 1 : 0,
          address.il,
          address.ilce,
          v.politicalConsent ? 1 : 0,
          v.aiConsent ? 1 : 0,
          now,
          now,
          verifiedBy ? now : null,
          verifiedBy,
        );
        db.run(
          `INSERT INTO identity_vault(user_id, wrapped_dek, enc_first_name, enc_last_name, enc_tckn, enc_birth_date, enc_email,
             enc_phone, enc_address, tckn_bidx, email_bidx, household_bidx, key_version, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          id,
          wrapped,
          seal("first_name", v.firstName),
          seal("last_name", v.lastName),
          seal("tckn", v.tckn),
          seal("birth_date", v.birthDate),
          seal("email", v.email),
          seal("phone", v.phone),
          seal("address", JSON.stringify(address)),
          tcknBidx,
          emailBidx,
          vault.householdIndex(address),
          kv,
          now,
          now,
        );
      });
    } catch (e) {
      throw mapUniqueError(e);
    } finally {
      dek.fill(0);
    }
    return requireRow(id);
  }

  /** Son-yönetici değişmezi (setRoles ve eraseSelf için ortak): doğrulanmış başka yönetici yoksa bu kullanıcı yönetici olmaktan çıkarılamaz. */
  function assertNotLastAdmin(userId: string, message: string): void {
    const others = db
      .all<{ id: string; roles: string }>("SELECT id, roles FROM users WHERE status = 'verified' AND id != ? AND roles LIKE '%admin%'", userId)
      .filter((r) => parseRoles(r.roles).includes("admin"));
    if (others.length === 0) throw conflict("last_admin", message);
  }

  /**
   * Kripto-imha: DEK ve tüm şifreli alanlar, kör indeksler silinir; hesap takma adsızlaştırılır. Başkalarına giden bildirimler
   * takma adı metin olarak taşımaz ({{uye:<kimlik>}} belirteci), okunurken güncel (anonim) adla çözülür; metin yeniden yazılmaz.
   */
  function shred(userId: string, status: "erased" | "rejected"): void {
    const now = clock.now();
    const short = userId.replace(/-/g, "").slice(0, 6);
    const nickname = status === "erased" ? `Silinmiş üye #${short}` : `Reddedilen başvuru #${short}`;
    db.tx(() => {
      db.run(
        `UPDATE identity_vault SET wrapped_dek = NULL, enc_first_name = NULL, enc_last_name = NULL, enc_tckn = NULL,
           enc_birth_date = NULL, enc_email = NULL, enc_phone = NULL, enc_address = NULL,
           tckn_bidx = NULL, email_bidx = NULL, household_bidx = NULL, updated_at = ?
         WHERE user_id = ?`,
        now,
        userId,
      );
      db.run(
        `UPDATE users SET status = ?, nickname = ?, nickname_norm = ?, password_hash = ?, roles = '["member"]',
           political_consent = 0, ai_consent = 0, region_il = NULL, region_ilce = NULL
         WHERE id = ?`,
        status,
        nickname,
        `${status}:${userId}`,
        INVALID_PASSWORD_HASH,
        userId,
      );
      db.run("UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL", now, userId);
      // Düzeltme talepleri: öneri ve gerekçe (DEK'le şifreli, artık zaten çözülemez) NULL; bekleyenler geri çekilmiş sayılır.
      db.run(
        `UPDATE identity_corrections SET enc_payload = NULL, enc_reason = NULL,
           status = CASE WHEN status = 'pending' THEN 'withdrawn' ELSE status END, decided_at = COALESCE(decided_at, ?)
         WHERE user_id = ?`,
        now,
        userId,
      );
    });
    try {
      db.exec("PRAGMA wal_checkpoint(TRUNCATE);");
    } catch {
      /* bellek içi veritabanı ya da meşgul: yok say */
    }
  }

  /** Erişim amacı: NFKC, kırpılmış, 5–500 karakter (zorunlu). */
  function normalizePurpose(purpose: unknown): string {
    const p = typeof purpose === "string" ? purpose.normalize("NFKC").trim().replace(/\s+/g, " ") : "";
    if (p.length < 5) {
      throw badRequest("validation", "Erişim amacı en az 5 karakter olmalıdır.", { purpose: "Erişim amacı en az 5 karakter olmalıdır." });
    }
    if (p.length > 500) throw badRequest("validation", "Erişim amacı en fazla 500 karakter olabilir.", { purpose: "Erişim amacı en fazla 500 karakter olabilir." });
    return p;
  }

  /** Kişisel veri erişim kaydı: pii_access_log (aktör, üye, amaç, zaman) + audit_log (identity.pii_access). */
  function logPiiAccess(actorId: string, userId: string, purpose: string, meta: Record<string, unknown>): void {
    db.run("INSERT INTO pii_access_log(id, actor_id, user_id, purpose, at) VALUES (?, ?, ?, ?, ?)", newId(), actorId, userId, purpose, clock.now());
    deps.audit.log(actorId, "identity.pii_access", userId, { purpose, ...meta });
  }

  /**
   * KVKK dökümü için satır okuma. SQL hatası SESSİZCE boş bölüm döndürmez (eksik döküm "tam" görünüp denetim kaydına
   * "identity.export" diye yazılırdı): hata kaydedilir ve yayılır (500); döküm üretilmez.
   */
  function exportRows(sql: string, ...params: SqlValue[]): Record<string, unknown>[] {
    try {
      return db.all(sql, ...params).map((r) => {
        const o: Record<string, unknown> = {};
        for (const [k, val] of Object.entries(r)) o[camel(k)] = EXPORT_JSON_COLS.has(k) ? json<unknown>(val, val) : val;
        return o;
      });
    } catch (cause) {
      const table = /\bFROM\s+([A-Za-z_]+)/i.exec(sql)?.[1] ?? "?";
      try {
        deps.audit.log(null, "identity.export_failed", null, { table });
      } catch {
        /* denetim kaydı da yazılamıyorsa asıl hata yine de yayılır */
      }
      throw new Error(`KVKK dökümü oluşturulamadı: "${table}" bölümü okunamadı.`, { cause });
    }
  }

  /**
   * Üyenin KENDİ görüş kümesi (siyasi görüş çıkarımı — özel nitelikli veri; docs/KVKK.md §4) ve haritadaki konumu.
   * Yalnızca verilen üyenin girdisi okunur; başka üyelerin ataması dökümde yer almaz.
   */
  function exportOpinionCluster(userId: string): Record<string, unknown> | null {
    const path = `$."${userId.replace(/["\\]/g, "")}"`;
    const r = db.get<{ id: string; created_at: number; cluster_id: string | null; position: string | null }>(
      `SELECT id, created_at, json_extract(assignments, ?) AS cluster_id, json_extract(coords, ?) AS position
       FROM cluster_snapshots ORDER BY created_at DESC, rowid DESC LIMIT 1`,
      path,
      path,
    );
    if (!r) return null;
    return { snapshotId: r.id, snapshotAt: Number(r.created_at), clusterId: r.cluster_id ?? null, position: r.position === null ? null : json<unknown>(r.position, null) };
  }

  const corrections = createCorrectionHandlers({
    db,
    clock,
    vault,
    audit: deps.audit,
    notifier: deps.notifier,
    readPii,
    requireRow,
    requireActor,
    registrarIds,
    isClosed,
    normalizePurpose,
    logPiiAccess,
    erasedError,
    integrityError,
    closedAccount,
    dupTckn,
    dupEmail,
  });

  const svc: IdentityServiceImpl = {
    ...corrections,

    async register(input) {
      const row = await createAccount(input, null);
      // Yükte zaman yok: blok zamanı yeterli; tam kayıt anı herkese açık katılım tarihiyle eşleştirilip memberRef takma ada bağlanmasın.
      submitLedger("MEMBER_REGISTERED", { memberRef: vault.memberRef(row.id) });
      for (const rid of registrarIds()) {
        deps.notifier.notify(rid, {
          kind: "registration_pending",
          title: "Yeni üye doğrulama bekliyor",
          body: `"${memberToken(row.id)}" takma adlı yeni üyenin kimlik doğrulaması bekleniyor.`,
          link: "/kayit-memuru",
        });
      }
      deps.audit.log(row.id, "identity.register", row.id, { via: "self" });
      return { user: meOf(row) };
    },

    async createByRegistrar(actorId, input) {
      requireActor(actorId, STAFF_REGISTRAR, "Üyeyi sisteme yalnızca kayıt memuru ya da yönetici girebilir.");
      const row = await createAccount(input, actorId);
      const memberRef = vault.memberRef(row.id);
      submitLedger("MEMBER_REGISTERED", { memberRef });
      submitLedger("MEMBER_VERIFIED", { memberRef });
      deps.notifier.notify(row.id, {
        kind: "account_verified",
        title: "Hesabınız oluşturuldu ve doğrulandı",
        body: "Hesabınız kayıt memuru tarafından oluşturuldu ve kimliğiniz doğrulandı. İlk girişte şifrenizi değiştirmeniz önerilir.",
        link: "/profil",
      });
      deps.audit.log(actorId, "identity.create_by_registrar", row.id, { via: "registrar" });
      return { user: meOf(row) };
    },

    async bootstrapAdmin(input) {
      const existing = db.get<{ n: number }>(
        `SELECT COUNT(*) AS n FROM users WHERE status = 'verified' AND EXISTS (SELECT 1 FROM json_each(users.roles) WHERE value = 'admin')`,
      );
      if ((existing?.n ?? 0) > 0) {
        throw conflict("admin_exists", "Sistemde zaten bir yönetici var; ilk yönetici yalnızca kurulumda oluşturulabilir.");
      }
      const row = await createAccount(input, "kurulum");
      db.run(`UPDATE users SET roles = '["member","admin"]' WHERE id = ?`, row.id);
      const memberRef = vault.memberRef(row.id);
      submitLedger("MEMBER_REGISTERED", { memberRef });
      submitLedger("MEMBER_VERIFIED", { memberRef });
      deps.audit.log(null, "identity.bootstrap_admin", row.id, { via: "kurulum" });
      return { user: meOf(requireRow(row.id)) };
    },

    async verify(actorId, userId, decision, note) {
      requireActor(actorId, STAFF_REGISTRAR, "Üye doğrulamasını yalnızca kayıt memuru ya da yönetici yapabilir.");
      if (decision !== "approve" && decision !== "reject") {
        throw badRequest("validation", "Karar 'approve' ya da 'reject' olmalıdır.", { decision: "Karar 'approve' ya da 'reject' olmalıdır." });
      }
      if (actorId === userId) throw forbidden("Kendi hesabınızı doğrulayamazsınız.");
      const row = requireRow(userId);
      if (row.status !== "pending") {
        throw conflict("invalid_state", "Yalnızca doğrulama bekleyen başvurular onaylanabilir ya da reddedilebilir.");
      }
      const cleanNote = typeof note === "string" ? note.trim().slice(0, 1000) : "";
      const now = clock.now();
      const memberRef = vault.memberRef(userId);
      if (decision === "approve") {
        const isAdult = ageOn(readPii(userId).birthDate, now) >= 18;
        db.run(
          "UPDATE users SET status = 'verified', verified_at = ?, verified_by = ?, is_adult = ? WHERE id = ? AND status = 'pending'",
          now,
          actorId,
          isAdult ? 1 : 0,
          userId,
        );
        submitLedger("MEMBER_VERIFIED", { memberRef });
        const canVote = isAdult && row.political_consent === 1;
        deps.notifier.notify(userId, {
          kind: "account_verified",
          title: "Hesabınız doğrulandı",
          body:
            "Kimliğiniz kayıt memuru tarafından doğrulandı. Artık konu açabilir ve tartışmalara katılabilirsiniz" +
            (canVote ? "; oy da kullanabilirsiniz." : ".") +
            (cleanNote ? ` Not: ${cleanNote}` : ""),
          link: "/profil",
        });
        deps.audit.log(actorId, "identity.verify", userId, { decision: "approve", hasNote: cleanNote.length > 0 });
      } else {
        shred(userId, "rejected");
        submitLedger("MEMBER_ERASED", { memberRef });
        deps.notifier.notify(userId, {
          kind: "account_rejected",
          title: "Üyelik başvurunuz reddedildi",
          body:
            "Başvurunuz kayıt memuru tarafından reddedildi. İşleme amacı ortadan kalktığı için kişisel verileriniz kripto-imha yöntemiyle silindi." +
            (cleanNote ? ` Not: ${cleanNote}` : ""),
          link: null,
        });
        deps.audit.log(actorId, "identity.verify", userId, { decision: "reject", hasNote: cleanNote.length > 0 });
      }
      return meOf(requireRow(userId));
    },

    listPending() {
      return db
        .all<{ id: string; nickname: string; created_at: number }>(
          "SELECT id, nickname, created_at FROM users WHERE status = 'pending' ORDER BY created_at ASC, id ASC",
        )
        .map((r) => ({ id: r.id, nickname: r.nickname, createdAt: r.created_at }));
    },

    async login(nicknameOrEmail, password) {
      const ident = typeof nicknameOrEmail === "string" ? nicknameOrEmail.trim() : "";
      const pw = typeof password === "string" && password.length <= 1024 ? password : "";
      let row: UserRow | undefined;
      if (ident.includes("@")) {
        const v = db.get<{ user_id: string }>("SELECT user_id FROM identity_vault WHERE email_bidx = ?", vault.emailIndex(ident));
        row = v ? getRow(v.user_id) : undefined;
      } else if (ident) {
        row = db.get<UserRow>("SELECT * FROM users WHERE nickname_norm = ?", normalizeNickname(ident));
      }
      const usable = row && !isClosed(row) && pw.length > 0;
      const ok = usable ? await verifyPassword(row!.password_hash, pw) : await dummyVerify(pw);
      if (!row || !ok) {
        if (row && !isClosed(row)) deps.audit.log(null, "identity.login_failed", row.id);
        throw new AppError(401, "invalid_credentials", LOGIN_FAILED);
      }
      const now = clock.now();
      const sid = signer.newSessionId();
      db.run("INSERT INTO sessions(id, user_id, created_at, expires_at, revoked_at) VALUES (?, ?, ?, ?, NULL)", sid, row.id, now, now + SESSION_TTL_MS);
      deps.audit.log(row.id, "identity.login", row.id);
      return { token: signer.sign(sid), user: meOf(row) };
    },

    logout(token) {
      const sid = signer.verify(token);
      if (!sid) return;
      db.run("UPDATE sessions SET revoked_at = ? WHERE id = ? AND revoked_at IS NULL", clock.now(), sid);
    },

    authenticate(token) {
      const sid = signer.verify(token);
      if (!sid) return null;
      const s = db.get<{ user_id: string; expires_at: number; revoked_at: number | null }>(
        "SELECT user_id, expires_at, revoked_at FROM sessions WHERE id = ?",
        sid,
      );
      if (!s || s.revoked_at !== null || s.expires_at <= clock.now()) return null;
      const row = getRow(s.user_id);
      if (!row || isClosed(row)) return null;
      return toAuthUser(row);
    },

    me(userId) {
      return meOf(requireRow(userId));
    },

    getPii(actorId, userId, purpose) {
      requireActor(actorId, STAFF_PII, "Kişisel verileri yalnızca kayıt memuru, denetçi ya da yönetici görüntüleyebilir.");
      const p = normalizePurpose(purpose);
      requireRow(userId);
      const v = vaultRow(userId);
      if (!v || !v.wrapped_dek) throw erasedError();
      logPiiAccess(actorId, userId, p, {});
      const pii = readPii(userId);
      const rec: PiiRecord = {
        userId,
        firstName: pii.firstName,
        lastName: pii.lastName,
        tcknMasked: maskTckn(pii.tckn),
        birthDate: pii.birthDate,
        email: pii.email,
        phone: pii.phone,
        address: pii.address,
      };
      return rec;
    },

    householdOf(userId) {
      return db.get<{ household_bidx: string | null }>("SELECT household_bidx FROM identity_vault WHERE user_id = ?", userId)?.household_bidx ?? null;
    },

    setConsents(userId, consents) {
      const c = consents ?? {};
      const row = requireRow(userId);
      if (isClosed(row)) throw closedAccount();
      const details: Record<string, string> = {};
      if (c.politicalConsent !== undefined && typeof c.politicalConsent !== "boolean") details.politicalConsent = "Siyasi görüş rızası evet/hayır olmalıdır.";
      if (c.aiConsent !== undefined && typeof c.aiConsent !== "boolean") details.aiConsent = "Yapay zekâ rızası evet/hayır olmalıdır.";
      if (Object.keys(details).length) throw validationError(details);
      const changes: Record<string, boolean> = {};
      if (typeof c.politicalConsent === "boolean" && (row.political_consent === 1) !== c.politicalConsent) changes.politicalConsent = c.politicalConsent;
      if (typeof c.aiConsent === "boolean" && (row.ai_consent === 1) !== c.aiConsent) changes.aiConsent = c.aiConsent;
      if (Object.keys(changes).length === 0) return meOf(row);
      db.run(
        "UPDATE users SET political_consent = ?, ai_consent = ? WHERE id = ?",
        (changes.politicalConsent ?? row.political_consent === 1) ? 1 : 0,
        (changes.aiConsent ?? row.ai_consent === 1) ? 1 : 0,
        userId,
      );
      deps.audit.log(userId, "identity.consents", userId, changes);
      return meOf(requireRow(userId));
    },

    setRoles(actorId, userId, roles) {
      requireActor(actorId, ["admin"], "Rolleri yalnızca yönetici değiştirebilir.");
      if (!Array.isArray(roles)) throw validationError({ roles: "Roller bir liste olmalıdır." });
      const invalid = roles.filter((r) => !(ALL_ROLES as readonly unknown[]).includes(r));
      if (invalid.length) {
        const msg = `Geçersiz rol: ${invalid.map(String).join(", ")}. Geçerli roller: ${ALL_ROLES.join(", ")}.`;
        throw badRequest("validation", msg, { roles: msg });
      }
      const row = requireRow(userId);
      if (isClosed(row)) throw conflict("invalid_state", "Silinmiş ya da reddedilmiş bir hesaba rol verilemez.");
      const prev = parseRoles(row.roles);
      const next = ALL_ROLES.filter((r) => r === "member" || roles.includes(r));
      if (prev.includes("admin") && !next.includes("admin")) assertNotLastAdmin(userId, "Sistemde en az bir yönetici kalmalıdır.");
      if (prev.join(",") !== next.join(",")) {
        db.run("UPDATE users SET roles = ? WHERE id = ?", JSON.stringify(next), userId);
        deps.audit.log(actorId, "identity.roles", userId, { from: prev, to: next });
        deps.notifier.notify(userId, {
          kind: "roles_changed",
          title: "Rolleriniz güncellendi",
          body: `Güncel rolleriniz: ${next.map((r) => ROLE_LABELS[r]).join(", ")}.`,
          link: "/profil",
        });
      }
      return meOf(requireRow(userId));
    },

    exportOwnData(userId) {
      const row = requireRow(userId);
      const now = clock.now();
      let personalData: DecryptedPii | null = null;
      try {
        personalData = readPii(userId);
      } catch (e) {
        if (!(e instanceof AppError && e.code === "pii_erased")) throw e;
      }
      const userNode = `user:${userId}`;
      const out: Record<string, unknown> = {
        format: "forum-sistemi/kvkk-dokum/1",
        generatedAt: now,
        legalBasis: "6698 sayılı KVKK md. 11 — ilgili kişinin kendi verisine erişim ve bilgi talep etme hakkı",
        account: {
          id: row.id,
          nickname: row.nickname,
          status: row.status,
          roles: parseRoles(row.roles),
          isAdult: row.is_adult === 1,
          regionIl: row.region_il,
          regionIlce: row.region_ilce,
          reputation: row.reputation,
          createdAt: row.created_at,
          verifiedAt: row.verified_at,
        },
        personalData,
        consents: {
          kvkkNoticeAcceptedAt: row.kvkk_notice_at,
          politicalConsent: row.political_consent === 1,
          aiConsent: row.ai_consent === 1,
        },
        processing: [
          { data: "Ad, soyad, T.C. kimlik no, doğum tarihi, e-posta, telefon, adres", purpose: "Kimlik doğrulama, tek kişi–tek oy, reşitlik ve çıkar çatışması denetimi", storage: "Alan bazında AES-256-GCM ile şifreli kimlik kasası" },
          { data: "Oylar, öneriler, mesajlar (siyasi görüş — özel nitelikli veri)", purpose: "Katılımcı karar alma", legalBasis: "Açık rıza (KVKK md. 6/3-a)" },
          { data: "İçeriğin yapay zekâ analizi", purpose: "Danışma niteliğinde özet ve sınıflandırma", legalBasis: "Ayrı açık rıza (varsayılan kapalı); yurt dışına aktarım KVKK md. 9" },
        ],
        sessions: exportRows("SELECT created_at, expires_at, revoked_at FROM sessions WHERE user_id = ? ORDER BY created_at", userId),
        piiAccessLog: exportRows(
          `SELECT l.at, l.purpose, l.actor_id, u.nickname AS actor_nickname FROM pii_access_log l LEFT JOIN users u ON u.id = l.actor_id
           WHERE l.user_id = ? ORDER BY l.at`,
          userId,
        ),
        accountEvents: exportRows("SELECT action, actor_id, meta, at FROM audit_log WHERE target = ? ORDER BY at LIMIT 1000", userId),
        identityCorrections: exportRows(
          "SELECT id, fields, status, created_at, reviewed_at, decided_at, decision_note FROM identity_corrections WHERE user_id = ? ORDER BY created_at",
          userId,
        ).map((r) => ({ ...r, fields: json<string[]>(r.fields as string, []) })),
        proposals: exportRows(
          "SELECT id, seq, kind, title, body, status, categories, version, created_at, updated_at FROM proposals WHERE author_id = ? ORDER BY created_at",
          userId,
        ),
        proposalSuggestions: exportRows("SELECT id, proposal_id, body, status, created_at, decided_at FROM proposal_suggestions WHERE author_id = ? ORDER BY created_at", userId),
        sponsorships: exportRows("SELECT proposal_id, at, ledger_tx FROM proposal_sponsors WHERE user_id = ? ORDER BY at", userId),
        opinionCluster: exportOpinionCluster(userId),
        eligibleVoterRolls: exportRows("SELECT proposal_id FROM eligible_voters WHERE user_id = ? ORDER BY proposal_id", userId).map((r) => r.proposalId),
        messages: exportRows(
          `SELECT id, seq, thread_type, thread_id, parent_id, stance, body, version, visibility, created_at, updated_at
           FROM messages WHERE author_id = ? ORDER BY created_at`,
          userId,
        ),
        messageVersions: exportRows(
          `SELECT v.message_id, v.version, v.body, v.created_at FROM message_versions v JOIN messages m ON m.id = v.message_id
           WHERE m.author_id = ? ORDER BY v.message_id, v.version`,
          userId,
        ),
        rebuttals: exportRows("SELECT message_id, body, created_at FROM message_rebuttals WHERE author_id = ?", userId),
        endorsements: exportRows("SELECT message_id, value, at FROM message_endorsements WHERE user_id = ? ORDER BY at", userId),
        ballots: exportRows(
          "SELECT proposal_id, round, ballot_id, choice, salt, commitment, ledger_tx, cast_at, updated_at FROM ballots WHERE user_id = ? ORDER BY cast_at",
          userId,
        ),
        objections: exportRows("SELECT proposal_id, ground, statement, ledger_tx, at FROM objections WHERE user_id = ? ORDER BY at", userId),
        minorityReports: exportRows("SELECT proposal_id, body, ledger_tx, created_at FROM minority_reports WHERE author_id = ? ORDER BY created_at", userId),
        expertRequests: exportRows("SELECT proposal_id, kind, at FROM expert_requests WHERE user_id = ? ORDER BY at", userId),
        expertQuestions: exportRows("SELECT id, proposal_id, body, created_at FROM expert_questions WHERE author_id = ? ORDER BY created_at", userId),
        delegations: {
          outgoing: exportRows(
            `SELECT id, dst, scope, rank, created_at, revoked_at FROM graph_edges
             WHERE type = 'DELEGATES_TO' AND src IN (?, ?) ORDER BY created_at`,
            userNode,
            userId,
          ),
          incomingActiveCount:
            db.get<{ n: number }>(
              "SELECT COUNT(*) AS n FROM graph_edges WHERE type = 'DELEGATES_TO' AND dst IN (?, ?) AND revoked_at IS NULL",
              userNode,
              userId,
            )?.n ?? 0,
        },
        relations: exportRows(
          `SELECT id, type, dst, weight, meta, created_at, revoked_at FROM graph_edges
           WHERE type IN ('FOLLOWS', 'VOUCHES', 'RELATED_TO') AND src IN (?, ?) ORDER BY created_at`,
          userNode,
          userId,
        ),
        expert: {
          profile: exportRows("SELECT domains, credentials, status, reputation, approved_at, created_at FROM experts WHERE user_id = ?", userId)[0] ?? null,
          assignments: exportRows("SELECT id, proposal_id, status, recuse_reason, due_at, created_at FROM expert_assignments WHERE expert_id = ?", userId),
          reports: exportRows(
            "SELECT id, proposal_id, assessment, confidence, risks, answers, body, dissent, created_at FROM expert_reports WHERE expert_id = ?",
            userId,
          ),
        },
        notifications: renderNotificationRows(
          db,
          exportRows("SELECT kind, title, body, link, read, created_at FROM notifications WHERE user_id = ? ORDER BY created_at", userId) as { title: string; body: string }[],
        ),
      };
      deps.audit.log(userId, "identity.export", userId);
      return out;
    },

    async eraseSelf(userId) {
      const row = requireRow(userId);
      if (isClosed(row)) throw conflict("already_erased", "Bu hesabın kişisel verileri zaten imha edilmiş.");
      // shred rolleri sıfırlar: son yönetici kendini silerse sistemde yönetici kalmazdı (setRoles ile aynı değişmez).
      if (parseRoles(row.roles).includes("admin")) {
        assertNotLastAdmin(userId, "Sistemdeki son yöneticisiniz; hesabınızı silmeden önce başka bir üyeye yönetici rolü verin.");
      }
      shred(userId, "erased");
      submitLedger("MEMBER_ERASED", { memberRef: vault.memberRef(userId) });
      deps.audit.log(userId, "identity.erase", userId, { method: "crypto-shredding" });
    },

    async changePassword(userId, oldPw, newPw, keepToken) {
      const row = requireRow(userId);
      if (isClosed(row)) throw closedAccount();
      const old = typeof oldPw === "string" && oldPw.length <= 1024 ? oldPw : "";
      if (!old || !(await verifyPassword(row.password_hash, old))) {
        throw new AppError(400, "wrong_password", "Mevcut şifre hatalı.", { oldPassword: "Mevcut şifre hatalı." });
      }
      const next = parsePassword(newPw, "newPassword");
      if (next === old) throw validationError({ newPassword: "Yeni şifre mevcut şifreyle aynı olamaz." });
      const hash = await hashPassword(next);
      const keepSid = keepToken ? signer.verify(keepToken) : null;
      const now = clock.now();
      db.tx(() => {
        db.run("UPDATE users SET password_hash = ? WHERE id = ?", hash, userId);
        db.run("UPDATE sessions SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL AND id != ?", now, userId, keepSid ?? "");
      });
      deps.audit.log(userId, "identity.password_change", userId);
      deps.notifier.notify(userId, {
        kind: "password_changed",
        title: "Şifreniz değiştirildi",
        body: "Hesabınızın şifresi değiştirildi ve diğer oturumlarınız kapatıldı. Bu işlemi siz yapmadıysanız kayıt memuruna başvurun.",
        link: "/profil",
      });
    },

    async changeNickname(userId, nicknameIn, password) {
      const row = requireRow(userId);
      if (isClosed(row)) throw closedAccount();
      if (row.status === "suspended") throw forbidden("Askıdaki bir hesabın takma adı değiştirilemez.");
      const pw = typeof password === "string" && password.length <= 1024 ? password : "";
      if (!pw || !(await verifyPassword(row.password_hash, pw))) {
        throw new AppError(400, "wrong_password", "Şifre hatalı.", { password: "Şifre hatalı." });
      }
      const nickname = parseNickname(nicknameIn);
      if (nickname === row.nickname) throw validationError({ nickname: "Yeni takma ad mevcut takma adınızla aynı." });
      const now = clock.now();
      // Sıklık sınırı: 30 günde bir (taklit ve kimlik karmaşasına karşı). Göçte çakışan hesap bu sınırdan muaftır.
      if (!isConflictKey(row.nickname_norm)) {
        const last = db.get<{ at: number | null }>("SELECT MAX(at) AS at FROM audit_log WHERE action = 'identity.nickname_change' AND target = ?", userId)?.at ?? null;
        if (last !== null && now - Number(last) < NICKNAME_CHANGE_INTERVAL_MS) {
          const nextAt = Number(last) + NICKNAME_CHANGE_INTERVAL_MS;
          const days = Math.ceil((nextAt - now) / DAY);
          const msg = `Takma adınızı 30 günde en çok bir kez değiştirebilirsiniz; bir sonraki değişiklik ${days} gün sonra yapılabilir.`;
          throw unprocessable("nickname_change_limit", msg, { nickname: msg, nextAllowedAt: nextAt });
        }
      }
      const norm = normalizeNickname(nickname);
      const assertFree = () => {
        if (db.get("SELECT 1 FROM users WHERE nickname_norm = ? AND id != ?", norm, userId)) throw dupNickname();
        assertNotSimilar(db, nickname, userId);
      };
      assertFree();
      try {
        db.tx(() => {
          assertFree();
          db.run("UPDATE users SET nickname = ?, nickname_norm = ? WHERE id = ?", nickname, norm, userId);
        });
      } catch (e) {
        throw mapUniqueError(e);
      }
      // Eski ve yeni takma ad günlüğe yazılmaz: hesap sonradan silinirse eski takma ad kimliğe geri bağlanamasın (KVKK.md §6).
      deps.audit.log(userId, "identity.nickname_change", userId, { caseOnly: norm === row.nickname_norm });
      deps.notifier.notify(userId, {
        kind: "nickname_changed",
        title: "Takma adınız değiştirildi",
        body: "Takma adınız değiştirildi; mesajlarınız ve önerileriniz yeni takma adınızla görünür. Bir sonraki değişiklik en erken 30 gün sonra yapılabilir. Bu işlemi siz yapmadıysanız şifrenizi değiştirip kayıt memuruna başvurun.",
        link: "/profil",
      });
      return meOf(requireRow(userId));
    },

    async verifyPassword(userId, password) {
      const row = getRow(userId);
      if (!row || isClosed(row) || typeof password !== "string" || password.length > 1024) {
        await dummyVerify(typeof password === "string" ? password.slice(0, 1024) : "");
        return false;
      }
      return verifyPassword(row.password_hash, password);
    },

    refreshAdulthood() {
      const now = clock.now();
      let n = 0;
      const candidates = db.all<{ id: string }>(
        "SELECT u.id FROM users u JOIN identity_vault v ON v.user_id = u.id WHERE u.is_adult = 0 AND u.status IN ('pending', 'verified', 'suspended') AND v.wrapped_dek IS NOT NULL",
      );
      for (const { id } of candidates) {
        let birthDate: string;
        try {
          birthDate = readPii(id).birthDate;
        } catch {
          continue; // bütünlük hatası zaten denetim günlüğüne yazıldı
        }
        if (ageOn(birthDate, now) >= 18) {
          db.run("UPDATE users SET is_adult = 1 WHERE id = ?", id);
          n++;
        }
      }
      return n;
    },

    purgeStalePending(maxAgeMs = STALE_PENDING_MS) {
      const cutoff = clock.now() - maxAgeMs;
      const stale = db.all<{ id: string }>("SELECT id FROM users WHERE status = 'pending' AND created_at < ?", cutoff);
      for (const { id } of stale) {
        shred(id, "rejected");
        submitLedger("MEMBER_ERASED", { memberRef: vault.memberRef(id) });
        deps.audit.log(null, "identity.purge_stale", id, { method: "crypto-shredding" });
      }
      return stale.length;
    },

    memberRef(userId) {
      return vault.memberRef(userId);
    },
  };
  return svc;
}
