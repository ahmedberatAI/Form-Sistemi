// Kayıt girdisi doğrulaması (zod 4). Hata mesajları Türkçe; AppError 400 "validation", details alan bazlı.
import { z } from "zod";
import { isValidTckn, nicknameKey, type RegistrationInput } from "@forum/shared";
import { badRequest } from "../core/errors";

const trLocale = z.locales.tr();

/** Şema düzeyinde mesaj verilmemiş hatalar için Türkçe yedek mesajlar. */
const fallbackError: z.core.$ZodErrorMap = (iss) => {
  if (iss.code === "invalid_type" && iss.input === undefined) return "Bu alan zorunludur.";
  if (iss.code === "invalid_type") return "Bu alanın türü geçersiz.";
  return trLocale.localeError(iss);
};

const NICKNAME_RE = /^[A-Za-z0-9çğıöşüÇĞİÖŞÜâîûÂÎÛ._-]{3,32}$/;
const NAME_RE = /^[\p{L}\p{M}' .-]+$/u;
/** Ad/soyad en az bir harf içerir ("-", "'", ". ." ya da yalnız birleştirici işaretlerden oluşamaz). */
const HAS_LETTER = /\p{L}/u;
/** Takma ad ve adres alanları en az bir harf ya da rakam içerir (yalnız ayraç/noktalama olamaz). */
const HAS_LETTER_OR_DIGIT = /[\p{L}\p{N}]/u;

/**
 * Metin alanının tür iletisi: değer hiç verilmemişse (undefined/null) "<alan> zorunludur.", verilmiş ama metin değilse
 * "<alan> metin olmalıdır." (dolu alana "zorunludur" denmesin; şema düzeyi ileti fallbackError'daki ayrımı ezer).
 */
const stringOf = (label: string) => z.string({ error: (iss) => (iss.input === undefined || iss.input === null ? `${label} zorunludur.` : `${label} metin olmalıdır.`) });

export function normalizeNicknameDisplay(nickname: string): string {
  return nickname.normalize("NFKC").trim();
}

/**
 * Benzersizlik (ve giriş/arama) anahtarı: NFKC + tr-TR küçük harf + I/ı/İ/i katlaması (shared `nicknameKey`).
 * "YONETICI", "Yonetici" ve "yonetici" aynı anahtarı alır. Benzerlik (taklit) denetimi ayrıca `nicknameSkeleton` ile yapılır.
 */
export function normalizeNickname(nickname: string): string {
  return nicknameKey(nickname);
}

/** Türkiye telefon numarasını +90XXXXXXXXXX biçimine getirir; geçersizse null. */
export function normalizePhone(raw: string): string | null {
  const s = raw.normalize("NFKC").replace(/[\s().-]/g, "");
  let m = /^0(5\d{9})$/.exec(s);
  if (m) return `+90${m[1]}`;
  m = /^\+90([2-5]\d{9})$/.exec(s);
  if (m) return `+90${m[1]}`;
  m = /^0090([2-5]\d{9})$/.exec(s);
  if (m) return `+90${m[1]}`;
  return null;
}

export function isValidIsoDate(s: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return false;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}

export const passwordSchema = stringOf("Şifre")
  .min(8, { error: "Şifre en az 8 karakter olmalıdır." })
  .max(128, { error: "Şifre en fazla 128 karakter olabilir." })
  .refine((s) => /\p{L}/u.test(s) && /\p{N}/u.test(s), { error: "Şifre en az bir harf ve bir rakam içermelidir." });

const requiredText = (label: string, min: number, max: number) =>
  stringOf(label)
    .transform((s) => s.normalize("NFKC").trim().replace(/\s+/g, " "))
    .pipe(
      z
        .string()
        .min(1, { error: `${label} boş bırakılamaz.` })
        .min(min, { error: `${label} en az ${min} karakter olmalıdır.` })
        .max(max, { error: `${label} en fazla ${max} karakter olabilir.` }),
    );

const personName = (label: string) =>
  requiredText(label, 1, 64)
    .refine((s) => NAME_RE.test(s), { error: `${label} yalnızca harf, boşluk, kesme işareti ve tire içerebilir.`, abort: true })
    .refine((s) => HAS_LETTER.test(s), { error: `${label} en az bir harf içermelidir.` });

/** Adres alanı: uzunluk kuralına ek olarak en az bir harf ya da rakam ("..", "--" gibi yalnız noktalama değil). */
const addressText = (label: string, min: number, max: number) =>
  requiredText(label, min, max).refine((s) => HAS_LETTER_OR_DIGIT.test(s), { error: `${label} en az bir harf ya da rakam içermelidir.` });

export const addressSchema = z.object(
  {
    il: addressText("İl", 2, 64),
    ilce: addressText("İlçe", 2, 64),
    mahalle: addressText("Mahalle", 2, 128),
    acikAdres: addressText("Açık adres", 5, 500),
    postaKodu: z
      .string({ error: "Posta kodu metin olmalıdır." })
      .transform((s) => s.trim())
      .refine((s) => s === "" || /^\d{5}$/.test(s), { error: "Posta kodu 5 haneli olmalıdır." })
      .optional()
      .transform((s) => (s ? s : undefined)),
  },
  {
    error: (iss) =>
      iss.input === undefined || iss.input === null
        ? "Adres bilgileri zorunludur."
        : "Adres bilgileri il, ilçe, mahalle ve açık adres alanlarını içeren bir nesne olmalıdır.",
  },
);

/** Takma ad kuralı (kayıt ve takma ad değişikliği aynı kuralı kullanır). */
const nicknameSchema = stringOf("Takma ad")
  .transform(normalizeNicknameDisplay)
  .refine((s) => s.length >= 3 && s.length <= 32, { error: "Takma ad 3–32 karakter olmalıdır." })
  .refine((s) => NICKNAME_RE.test(s), {
    error: "Takma ad yalnızca harf (Türkçe harfler dahil), rakam, nokta, alt çizgi ve tire içerebilir.",
    abort: true,
  })
  // Yalnız ayraçtan ("...", "-_-") oluşan ad: benzerlik iskeleti boşa iner ve sonraki tüm ayraçlı adları "benzer" sayar.
  .refine((s) => HAS_LETTER_OR_DIGIT.test(s), { error: "Takma ad en az bir harf ya da rakam içermelidir." });

/** Takma ad değişikliği girdisi: kayıt formuyla aynı kural; görüntülenecek (NFKC, kırpılmış) biçimi döndürür. */
export function parseNickname(raw: unknown, field = "nickname"): string {
  const r = nicknameSchema.safeParse(raw, { error: fallbackError });
  if (!r.success) throw validationError({ [field]: r.error.issues[0].message });
  return r.data;
}

export function registrationSchema(now: number) {
  const today = new Date(now).toISOString().slice(0, 10);
  return z.object({
    nickname: nicknameSchema,
    password: passwordSchema,
    firstName: personName("Ad"),
    lastName: personName("Soyad"),
    tckn: stringOf("T.C. kimlik numarası")
      .transform((s) => s.trim())
      .refine((s) => /^\d{11}$/.test(s) && isValidTckn(s), { error: "Geçersiz T.C. kimlik numarası." }),
    birthDate: stringOf("Doğum tarihi")
      .transform((s) => s.trim())
      .refine(isValidIsoDate, { error: "Doğum tarihi YYYY-AA-GG biçiminde geçerli bir tarih olmalıdır.", abort: true })
      .refine((s) => s < today, { error: "Doğum tarihi geçmişte olmalıdır." })
      .refine((s) => s >= "1900-01-01", { error: "Doğum tarihi geçersiz." }),
    email: stringOf("E-posta")
      .transform((s) => s.normalize("NFKC").trim())
      .pipe(z.email({ error: "Geçerli bir e-posta adresi girin." }).max(254, { error: "E-posta adresi çok uzun." })),
    phone: stringOf("Telefon")
      .refine((s) => normalizePhone(s) !== null, { error: "Telefon numarası 05XX XXX XX XX ya da +90 ile başlayan biçimde olmalıdır.", abort: true })
      .transform((s) => normalizePhone(s) as string),
    address: addressSchema,
    kvkkNoticeAccepted: z.literal(true, { error: "Kişisel verilerin işlenmesine ilişkin aydınlatma metnini okuduğunuzu onaylamalısınız." }),
    politicalConsent: z.boolean({ error: "Siyasi görüş rızası evet/hayır olmalıdır." }).default(false),
    aiConsent: z.boolean({ error: "Yapay zekâ rızası evet/hayır olmalıdır." }).default(false),
  });
}

export type ValidRegistration = Omit<RegistrationInput, "address"> & {
  address: { il: string; ilce: string; mahalle: string; acikAdres: string; postaKodu?: string };
};

/** Zod hatalarını alan bazında (`address.il` gibi) ilk mesaja indirger. */
export function fieldErrors(issues: readonly z.core.$ZodIssue[]): Record<string, string> {
  const out: Record<string, string> = {};
  for (const iss of issues) {
    const key = iss.path.length ? iss.path.map(String).join(".") : "_";
    if (!(key in out)) out[key] = iss.message;
  }
  return out;
}

export function validationError(details: Record<string, string>) {
  const keys = Object.keys(details);
  const msg = keys.length === 1 ? details[keys[0]] : `Formda ${keys.length} hatalı alan var.`;
  return badRequest("validation", msg, details);
}

export function parseRegistration(input: unknown, now: number): ValidRegistration {
  const r = registrationSchema(now).safeParse(input ?? {}, { error: fallbackError });
  if (!r.success) throw validationError(fieldErrors(r.error.issues));
  return r.data as ValidRegistration;
}

/** Düzeltme talebinde değiştirilebilen alanlar (kayıt şemasıyla aynı kurallar). */
export const CORRECTABLE_FIELDS = ["firstName", "lastName", "tckn", "birthDate", "email", "phone", "address"] as const;
export type CorrectableFieldName = (typeof CORRECTABLE_FIELDS)[number];
export type ValidCorrection = Partial<Pick<ValidRegistration, CorrectableFieldName>>;

const REASON_MIN = 10;
const REASON_MAX = 2000;

/**
 * Düzeltme talebi girdisi: { changes: {alan: yeni değer}, reason }. Alanlar kayıt formuyla aynı kurallarla doğrulanır
 * (ad/soyad, TCKN algoritması, tarih, e-posta, telefon normalleştirme, adres). Bilinmeyen alan (takma ad, şifre…) reddedilir.
 * Hata ayrıntıları alan adlarıyla döner (ör. "tckn", "address.il", "reason").
 */
export function parseCorrection(input: unknown, now: number): { changes: ValidCorrection; reason: string } {
  const obj = input && typeof input === "object" ? (input as Record<string, unknown>) : {};
  const details: Record<string, string> = {};
  const rawReason = typeof obj.reason === "string" ? obj.reason.normalize("NFKC").trim().replace(/\s+/g, " ") : "";
  if (rawReason.length < REASON_MIN) details.reason = `Gerekçe en az ${REASON_MIN} karakter olmalıdır (ör. "Evlilik nedeniyle soyadım değişti").`;
  else if (rawReason.length > REASON_MAX) details.reason = `Gerekçe en fazla ${REASON_MAX} karakter olabilir.`;
  const rawChanges = obj.changes && typeof obj.changes === "object" && !Array.isArray(obj.changes) ? (obj.changes as Record<string, unknown>) : null;
  if (!rawChanges) {
    details.changes = "Düzeltilecek en az bir alan belirtin.";
    throw validationError(details);
  }
  for (const k of Object.keys(rawChanges)) {
    if (!(CORRECTABLE_FIELDS as readonly string[]).includes(k)) details[k] = "Bu alan düzeltme talebiyle değiştirilemez (takma adınızı ve şifrenizi Profil sayfasından kendiniz değiştirebilirsiniz).";
  }
  const present = Object.fromEntries(Object.entries(rawChanges).filter(([k, v]) => (CORRECTABLE_FIELDS as readonly string[]).includes(k) && v !== undefined && v !== null));
  if (Object.keys(present).length === 0 && !Object.keys(details).some((k) => k !== "reason")) details.changes = "Düzeltilecek en az bir alan belirtin.";
  const schema = registrationSchema(now)
    .pick({ firstName: true, lastName: true, tckn: true, birthDate: true, email: true, phone: true, address: true })
    .partial();
  const r = schema.safeParse(present, { error: fallbackError });
  if (!r.success) Object.assign(details, fieldErrors(r.error.issues));
  if (Object.keys(details).length) throw validationError(details);
  return { changes: r.data as ValidCorrection, reason: rawReason };
}

export function parsePassword(pw: unknown, field = "password"): string {
  const r = passwordSchema.safeParse(pw, { error: fallbackError });
  if (!r.success) throw validationError({ [field]: r.error.issues[0].message });
  return r.data;
}
