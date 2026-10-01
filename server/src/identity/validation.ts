// Kayıt girdisi doğrulaması (zod 4). Hata mesajları Türkçe; AppError 400 "validation", details alan bazlı.
import { z } from "zod";
import { isValidTckn, type RegistrationInput } from "@forum/shared";
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

export function normalizeNicknameDisplay(nickname: string): string {
  return nickname.normalize("NFKC").trim();
}

/** Benzersizlik anahtarı: NFKC + tr-TR küçük harf */
export function normalizeNickname(nickname: string): string {
  return normalizeNicknameDisplay(nickname).toLocaleLowerCase("tr-TR");
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

export const passwordSchema = z
  .string({ error: "Şifre zorunludur." })
  .min(8, { error: "Şifre en az 8 karakter olmalıdır." })
  .max(128, { error: "Şifre en fazla 128 karakter olabilir." })
  .refine((s) => /\p{L}/u.test(s) && /\p{N}/u.test(s), { error: "Şifre en az bir harf ve bir rakam içermelidir." });

const requiredText = (label: string, min: number, max: number) =>
  z
    .string({ error: `${label} zorunludur.` })
    .transform((s) => s.normalize("NFKC").trim().replace(/\s+/g, " "))
    .pipe(
      z
        .string()
        .min(1, { error: `${label} boş bırakılamaz.` })
        .min(min, { error: `${label} en az ${min} karakter olmalıdır.` })
        .max(max, { error: `${label} en fazla ${max} karakter olabilir.` }),
    );

const personName = (label: string) =>
  requiredText(label, 1, 64).refine((s) => NAME_RE.test(s), { error: `${label} yalnızca harf, boşluk, kesme işareti ve tire içerebilir.` });

export const addressSchema = z.object(
  {
    il: requiredText("İl", 2, 64),
    ilce: requiredText("İlçe", 2, 64),
    mahalle: requiredText("Mahalle", 2, 128),
    acikAdres: requiredText("Açık adres", 5, 500),
    postaKodu: z
      .string()
      .transform((s) => s.trim())
      .refine((s) => s === "" || /^\d{5}$/.test(s), { error: "Posta kodu 5 haneli olmalıdır." })
      .optional()
      .transform((s) => (s ? s : undefined)),
  },
  { error: "Adres bilgileri zorunludur." },
);

export function registrationSchema(now: number) {
  const today = new Date(now).toISOString().slice(0, 10);
  return z.object({
    nickname: z
      .string({ error: "Takma ad zorunludur." })
      .transform(normalizeNicknameDisplay)
      .refine((s) => s.length >= 3 && s.length <= 32, { error: "Takma ad 3–32 karakter olmalıdır." })
      .refine((s) => NICKNAME_RE.test(s), {
        error: "Takma ad yalnızca harf (Türkçe harfler dahil), rakam, nokta, alt çizgi ve tire içerebilir.",
        abort: true,
      }),
    password: passwordSchema,
    firstName: personName("Ad"),
    lastName: personName("Soyad"),
    tckn: z
      .string({ error: "T.C. kimlik numarası zorunludur." })
      .transform((s) => s.trim())
      .refine((s) => /^\d{11}$/.test(s) && isValidTckn(s), { error: "Geçersiz T.C. kimlik numarası." }),
    birthDate: z
      .string({ error: "Doğum tarihi zorunludur." })
      .transform((s) => s.trim())
      .refine(isValidIsoDate, { error: "Doğum tarihi YYYY-AA-GG biçiminde geçerli bir tarih olmalıdır.", abort: true })
      .refine((s) => s < today, { error: "Doğum tarihi geçmişte olmalıdır." })
      .refine((s) => s >= "1900-01-01", { error: "Doğum tarihi geçersiz." }),
    email: z
      .string({ error: "E-posta zorunludur." })
      .transform((s) => s.normalize("NFKC").trim())
      .pipe(z.email({ error: "Geçerli bir e-posta adresi girin." }).max(254, { error: "E-posta adresi çok uzun." })),
    phone: z
      .string({ error: "Telefon zorunludur." })
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
    if (!(CORRECTABLE_FIELDS as readonly string[]).includes(k)) details[k] = "Bu alan düzeltme talebiyle değiştirilemez (takma ad ve şifre profil ayarlarındadır).";
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
