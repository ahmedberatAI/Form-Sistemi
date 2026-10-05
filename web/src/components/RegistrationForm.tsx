// Kayıt formu: RegistrationInput'un tüm alanları, istemci tarafı doğrulama (TCKN algoritması dahil),
// aydınlatma metni onayı ile AYRI açık rıza kutuları (siyasi görüş — oy için gerekli; YZ — varsayılan kapalı).
// Hem /kayit (mode="self") hem kayıt memurunun "Üyeyi sisteme gir" ekranında (mode="registrar") kullanılır.
// Kurallar sunucudakiyle (server/src/identity/validation.ts) aynıdır: önce NFKC normalizasyonu (tam genişlikli 'ａｌｉｃｅ' → 'alice'),
// sonra desen ve uzunluk sınırları. Sunucunun kabul edeceği girdiyi istemci reddetmez; sapma registrationForm.test.ts'te (sunucu şemasıyla karşılaştırma) yakalanır.
import { useId, useState, type FormEvent } from "react";
import { ageOn, isValidTckn, type RegistrationInput } from "@forum/shared";
import { ApiError } from "../api/client";
import { useServerNow } from "../auth/AuthContext";
import { Alert, Button, Checkbox, Details, ErrorView, Input, Textarea } from "../ui";
import { KvkkNotice } from "./KvkkNotice";

export interface RegistrationFormProps {
  /** Gönderim; hata fırlatırsa form hatayı gösterir (ApiError ayrıntıları alanlara eşlenir). */
  onSubmit: (input: RegistrationInput) => Promise<void>;
  /** self: kişinin kendi kaydı · registrar: kayıt memuru yüz yüze giriyor */
  mode?: "self" | "registrar";
  submitLabel?: string;
  /** Başarıdan sonra formu temizle (kayıt memuru art arda üye girerken) */
  resetOnSuccess?: boolean;
  initial?: Partial<RegistrationInput>;
}

export type FieldKey =
  | "nickname"
  | "password"
  | "password2"
  | "firstName"
  | "lastName"
  | "tckn"
  | "birthDate"
  | "email"
  | "phone"
  | "il"
  | "ilce"
  | "mahalle"
  | "acikAdres"
  | "postaKodu"
  | "kvkkNoticeAccepted";

export interface FormState {
  nickname: string;
  password: string;
  password2: string;
  firstName: string;
  lastName: string;
  tckn: string;
  birthDate: string;
  email: string;
  phone: string;
  il: string;
  ilce: string;
  mahalle: string;
  acikAdres: string;
  postaKodu: string;
  kvkkNoticeAccepted: boolean;
  politicalConsent: boolean;
  aiConsent: boolean;
}

function initialState(i?: Partial<RegistrationInput>): FormState {
  return {
    nickname: i?.nickname ?? "",
    password: i?.password ?? "",
    password2: i?.password ?? "",
    firstName: i?.firstName ?? "",
    lastName: i?.lastName ?? "",
    tckn: i?.tckn ?? "",
    birthDate: i?.birthDate ?? "",
    email: i?.email ?? "",
    phone: i?.phone ?? "",
    il: i?.address?.il ?? "",
    ilce: i?.address?.ilce ?? "",
    mahalle: i?.address?.mahalle ?? "",
    acikAdres: i?.address?.acikAdres ?? "",
    postaKodu: i?.address?.postaKodu ?? "",
    kvkkNoticeAccepted: i?.kvkkNoticeAccepted ?? false,
    politicalConsent: i?.politicalConsent ?? false,
    aiConsent: i?.aiConsent ?? false, // varsayılan KAPALI
  };
}

// ───────────── Kurallar (server/src/identity/validation.ts ile aynı) ─────────────

export const NICKNAME_RE = /^[A-Za-z0-9çğıöşüÇĞİÖŞÜâîûÂÎÛ._-]{3,32}$/;
export const NAME_RE = /^[\p{L}\p{M}' .-]+$/u;
/** Ad/soyad en az bir harf içerir ("-", "'", ". ." ya da yalnız birleştirici işaret olamaz). */
export const HAS_LETTER = /\p{L}/u;
/** Takma ad ve adres alanları en az bir harf ya da rakam içerir (yalnız ayraç/noktalama olamaz). */
export const HAS_LETTER_OR_DIGIT = /[\p{L}\p{N}]/u;
/** Sunucudaki z.email() deseni (zod 4) */
export const EMAIL_RE = /^(?:[A-Za-z0-9_'+\-]+\.)*[A-Za-z0-9_'+\-]*[A-Za-z0-9_+-]@(?:[A-Za-z0-9][A-Za-z0-9\-]*\.)+[A-Za-z]{2,}$/;
/** [en az, en çok] karakter (NFKC ve boşluk sadeleştirmesinden sonra) */
export const REGISTRATION_LIMITS = {
  nickname: [3, 32],
  name: [1, 64],
  email: [1, 254],
  il: [2, 64],
  ilce: [2, 64],
  mahalle: [2, 128],
  acikAdres: [5, 500],
} as const;

/** Takma ad: NFKC + kırpma (sunucudaki nicknameSchema'nın ilk adımı). */
export function normalizeNicknameInput(raw: string): string {
  return raw.normalize("NFKC").trim();
}

/** Ad, soyad ve adres alanları: NFKC, kırpma ve ardışık boşlukların teke indirilmesi (sunucudaki requiredText). */
export function normalizeTextInput(raw: string): string {
  return raw.normalize("NFKC").trim().replace(/\s+/g, " ");
}

/** 05XX…, +90…, 0090… biçimlerini kabul eder (sunucu +90XXXXXXXXXX'e çevirir). */
function isValidPhone(raw: string): boolean {
  const s = raw.normalize("NFKC").replace(/[\s().-]/g, "");
  return /^0(5\d{9})$/.test(s) || /^\+90([2-5]\d{9})$/.test(s) || /^0090([2-5]\d{9})$/.test(s);
}

/** Takvimde var olan bir YYYY-AA-GG tarihi mi (sunucudaki isValidIsoDate). */
function isRealIsoDate(s: string): boolean {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return false;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}

/** Boş / çok kısa / çok uzun metin için hata iletisi (normalleştirilmiş değer üzerinden); sorun yoksa undefined. */
function boundedTextError(label: string, raw: string, [min, max]: readonly [number, number]): string | undefined {
  const v = normalizeTextInput(raw);
  if (!v) return `${label} zorunludur.`;
  if (v.length < min) return `${label} en az ${min} karakter olmalıdır.`;
  if (v.length > max) return `${label} en fazla ${max} karakter olabilir.`;
  return undefined;
}

/** Ad / soyad: uzunluk sınırları, sonra harf deseni, sonra en az bir harf. */
function personNameError(label: string, raw: string): string | undefined {
  const bounded = boundedTextError(label, raw, REGISTRATION_LIMITS.name);
  if (bounded) return bounded;
  const v = normalizeTextInput(raw);
  if (!NAME_RE.test(v)) return `${label} yalnızca harf, boşluk, kesme işareti ve tire içerebilir.`;
  return HAS_LETTER.test(v) ? undefined : `${label} en az bir harf içermelidir.`;
}

/** Adres alanı: uzunluk sınırları, sonra en az bir harf ya da rakam ("..", "--" gibi yalnız noktalama değil). */
function addressTextError(label: string, raw: string, limits: readonly [number, number]): string | undefined {
  return boundedTextError(label, raw, limits) ?? (HAS_LETTER_OR_DIGIT.test(normalizeTextInput(raw)) ? undefined : `${label} en az bir harf ya da rakam içermelidir.`);
}

/** Takma ad kuralı (kayıt ve Profil'deki değişiklik aynı kural; sunucudaki nicknameSchema ile aynı sıra ve iletiler). */
export function nicknameError(raw: string): string | undefined {
  const nick = normalizeNicknameInput(raw);
  if (nick.length < REGISTRATION_LIMITS.nickname[0] || nick.length > REGISTRATION_LIMITS.nickname[1]) return "Takma ad 3–32 karakter olmalıdır.";
  if (!NICKNAME_RE.test(nick)) return "Takma ad yalnızca harf (Türkçe harfler dahil), rakam, nokta, alt çizgi ve tire içerebilir; boşluk olamaz.";
  if (!HAS_LETTER_OR_DIGIT.test(nick)) return "Takma ad en az bir harf ya da rakam içermelidir.";
  return undefined;
}

const ORDER: FieldKey[] = ["nickname", "password", "password2", "firstName", "lastName", "tckn", "birthDate", "email", "phone", "il", "ilce", "mahalle", "acikAdres", "postaKodu", "kvkkNoticeAccepted"];

/** Alan hataları (boş nesne → geçerli). `today`: YYYY-AA-GG, sunucu saatine göre bugün. */
export function validate(s: FormState, mode: "self" | "registrar", today: string): Partial<Record<FieldKey, string>> {
  const e: Partial<Record<FieldKey, string>> = {};
  const set = (k: FieldKey, msg: string | undefined) => {
    if (msg) e[k] = msg;
  };
  set("nickname", nicknameError(s.nickname));
  if (s.password.length < 8) e.password = "Şifre en az 8 karakter olmalıdır.";
  else if (s.password.length > 128) e.password = "Şifre en fazla 128 karakter olabilir.";
  else if (!/\p{L}/u.test(s.password) || !/\p{N}/u.test(s.password)) e.password = "Şifre en az bir harf ve bir rakam içermelidir.";
  if (mode === "self" && s.password2 !== s.password) e.password2 = "Şifreler eşleşmiyor.";
  set("firstName", personNameError("Ad", s.firstName));
  set("lastName", personNameError("Soyad", s.lastName));
  const tckn = s.tckn.replace(/\D/g, "");
  if (tckn.length !== 11) e.tckn = "T.C. kimlik numarası 11 haneli olmalıdır.";
  else if (!isValidTckn(tckn)) e.tckn = "T.C. kimlik numarası geçerli değil (algoritma denetimi başarısız).";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s.birthDate)) e.birthDate = "Doğum tarihini girin.";
  else if (!isRealIsoDate(s.birthDate)) e.birthDate = "Doğum tarihi geçerli değil.";
  else if (s.birthDate >= today) e.birthDate = "Doğum tarihi geçmişte olmalıdır.";
  else if (s.birthDate < "1900-01-01") e.birthDate = "Doğum tarihi geçerli değil.";
  const email = s.email.normalize("NFKC").trim();
  if (email.length > REGISTRATION_LIMITS.email[1]) e.email = "E-posta adresi çok uzun.";
  else if (!EMAIL_RE.test(email)) e.email = "Geçerli bir e-posta adresi girin.";
  if (!isValidPhone(s.phone)) e.phone = "Telefon numarası 05XX XXX XX XX ya da +90 ile başlayan biçimde olmalıdır.";
  set("il", addressTextError("İl", s.il, REGISTRATION_LIMITS.il));
  set("ilce", addressTextError("İlçe", s.ilce, REGISTRATION_LIMITS.ilce));
  set("mahalle", addressTextError("Mahalle", s.mahalle, REGISTRATION_LIMITS.mahalle));
  set("acikAdres", addressTextError("Açık adres", s.acikAdres, REGISTRATION_LIMITS.acikAdres));
  if (s.postaKodu.trim() && !/^\d{5}$/.test(s.postaKodu.trim())) e.postaKodu = "Posta kodu 5 haneli olmalıdır.";
  if (!s.kvkkNoticeAccepted) e.kvkkNoticeAccepted = mode === "self" ? "Devam etmek için aydınlatma metnini okuduğunuzu onaylayın." : "Üyenin aydınlatma metnini okuduğunu onaylayın.";
  return e;
}

/** Sunucuya giden girdi: alanlar sunucudaki normalleştirmeyle aynı biçimde (NFKC, kırpma, boşluk sadeleştirme) gönderilir. */
export function buildRegistrationInput(s: FormState): RegistrationInput {
  const postaKodu = s.postaKodu.trim();
  return {
    nickname: normalizeNicknameInput(s.nickname),
    password: s.password,
    firstName: normalizeTextInput(s.firstName),
    lastName: normalizeTextInput(s.lastName),
    tckn: s.tckn.replace(/\D/g, ""),
    birthDate: s.birthDate,
    email: s.email.normalize("NFKC").trim(),
    phone: s.phone.trim(),
    address: {
      il: normalizeTextInput(s.il),
      ilce: normalizeTextInput(s.ilce),
      mahalle: normalizeTextInput(s.mahalle),
      acikAdres: normalizeTextInput(s.acikAdres),
      ...(postaKodu ? { postaKodu } : {}),
    },
    kvkkNoticeAccepted: s.kvkkNoticeAccepted,
    politicalConsent: s.politicalConsent,
    aiConsent: s.aiConsent,
  };
}

/**
 * Sunucu hatasını alanlara eşler. Sunucu details biçimi: { "nickname": "…", "address.il": "…" }
 * (zod issues dizisi de desteklenir); ayrıca hata kodundan tahmin (duplicate_nickname → nickname).
 */
function mapServerError(err: unknown): Partial<Record<FieldKey, string>> {
  const out: Partial<Record<FieldKey, string>> = {};
  if (!(err instanceof ApiError)) return out;
  const det = err.details as unknown;
  if (det && typeof det === "object" && !Array.isArray(det)) {
    for (const [k, v] of Object.entries(det as Record<string, unknown>)) {
      const last = k.split(".").pop() as FieldKey;
      if (typeof v === "string" && ORDER.includes(last)) out[last] ??= v;
    }
  }
  const issues = Array.isArray(det) ? det : Array.isArray((det as { issues?: unknown })?.issues) ? (det as { issues: unknown[] }).issues : [];
  for (const it of issues) {
    const o = it as { path?: unknown; message?: unknown };
    if (!Array.isArray(o.path) || typeof o.message !== "string") continue;
    const last = String(o.path[o.path.length - 1]) as FieldKey;
    if (ORDER.includes(last)) out[last] ??= o.message;
  }
  const code = err.code.toLowerCase();
  for (const k of ["nickname", "tckn", "email", "phone", "password"] as FieldKey[]) {
    if (code.includes(k.toLowerCase()) && !out[k]) out[k] = err.message;
  }
  return out;
}

export function RegistrationForm({ onSubmit, mode = "self", submitLabel, resetOnSuccess, initial }: RegistrationFormProps) {
  const base = useId();
  const now = useServerNow();
  const [s, setS] = useState<FormState>(() => initialState(initial));
  const [errors, setErrors] = useState<Partial<Record<FieldKey, string>>>({});
  const [serverError, setServerError] = useState<unknown>(null);
  const [submitting, setSubmitting] = useState(false);
  const [showPw, setShowPw] = useState(false);
  const self = mode === "self";

  const fid = (k: FieldKey) => `${base}-${k}`;
  const set = <K extends keyof FormState>(k: K, v: FormState[K]) => {
    setS((p) => ({ ...p, [k]: v }));
    if (errors[k as FieldKey]) setErrors((p) => ({ ...p, [k]: undefined }));
  };
  const today = new Date(now()).toISOString().slice(0, 10);
  const age = /^\d{4}-\d{2}-\d{2}$/.test(s.birthDate) ? ageOn(s.birthDate, now()) : null;

  const focusFirst = (errs: Partial<Record<FieldKey, string>>) => {
    const first = ORDER.find((k) => errs[k]);
    if (first) window.setTimeout(() => document.getElementById(fid(first))?.focus(), 0);
  };

  const submit = async (ev: FormEvent) => {
    ev.preventDefault();
    setServerError(null);
    const errs = validate(s, mode, today);
    setErrors(errs);
    if (Object.values(errs).some(Boolean)) {
      focusFirst(errs);
      return;
    }
    const input = buildRegistrationInput(s);
    setSubmitting(true);
    try {
      await onSubmit(input);
      if (resetOnSuccess) {
        setS(initialState());
        setErrors({});
      }
    } catch (e) {
      setServerError(e);
      const mapped = mapServerError(e);
      setErrors(mapped);
      focusFirst(mapped);
    } finally {
      setSubmitting(false);
    }
  };

  const errorCount = Object.values(errors).filter(Boolean).length;

  return (
    <form className="stack registration-form" onSubmit={submit} noValidate>
      <Alert tone="info">
        {self
          ? "Gerçek kimlik bilgileriniz şifreli olarak saklanır ve yalnızca kayıt memuru tarafından doğrulama amacıyla görülebilir. Herkese açık sayfalarda yalnızca takma adınız görünür."
          : "Üyenin kimliğini belgesinden yüz yüze doğruladıktan sonra bilgileri girin. Bu yolla kaydedilen üye doğrudan doğrulanmış olur."}
      </Alert>

      {errorCount > 0 ? (
        <Alert tone="error" title="Formda düzeltilmesi gereken alanlar var">
          {errorCount} alan hatalı ya da eksik. Hatalı alanların altında açıklama yazıyor.
        </Alert>
      ) : null}

      <fieldset className="form-section">
        <legend>Hesap</legend>
        <div className="form-grid">
          <Input
            id={fid("nickname")}
            label="Takma ad"
            required
            autoComplete="username"
            autoCapitalize="none"
            spellCheck={false}
            value={s.nickname}
            onChange={(e) => set("nickname", e.target.value)}
            error={errors.nickname}
            hint="Forumda herkesin göreceği tek ad budur. Gerçek adınızı kullanmanız gerekmez. Kayıtlı bir takma ada çok benzeyenler (büyük/küçük harf, ş/s, 0/o farkı) kabul edilmez; sonradan Profil'den 30 günde bir değiştirebilirsiniz."
            maxLength={32}
          />
          <div />
          <Input
            id={fid("password")}
            label={self ? "Şifre" : "Geçici şifre"}
            required
            type={showPw ? "text" : "password"}
            autoComplete="new-password"
            value={s.password}
            onChange={(e) => set("password", e.target.value)}
            error={errors.password}
            hint={self ? "En az 8 karakter; harf ve rakam içermeli." : "Üyeye iletin; ilk girişte değiştirmesini önerin."}
          />
          {self ? (
            <Input
              id={fid("password2")}
              label="Şifre (tekrar)"
              required
              type={showPw ? "text" : "password"}
              autoComplete="new-password"
              value={s.password2}
              onChange={(e) => set("password2", e.target.value)}
              error={errors.password2}
            />
          ) : (
            <div />
          )}
        </div>
        <Checkbox label="Şifreyi göster" checked={showPw} onChange={(e) => setShowPw(e.target.checked)} />
      </fieldset>

      <fieldset className="form-section">
        <legend>Kimlik bilgileri</legend>
        <div className="form-grid">
          <Input id={fid("firstName")} label="Ad" required autoComplete={self ? "given-name" : "off"} value={s.firstName} onChange={(e) => set("firstName", e.target.value)} error={errors.firstName} />
          <Input id={fid("lastName")} label="Soyad" required autoComplete={self ? "family-name" : "off"} value={s.lastName} onChange={(e) => set("lastName", e.target.value)} error={errors.lastName} />
          <Input
            id={fid("tckn")}
            label="T.C. kimlik numarası"
            required
            inputMode="numeric"
            autoComplete="off"
            maxLength={11}
            value={s.tckn}
            onChange={(e) => set("tckn", e.target.value.replace(/\D/g, "").slice(0, 11))}
            error={errors.tckn}
            hint="Yalnızca biçim denetlenir; kimlik doğrulamasını kayıt memuru yapar. Numara şifreli saklanır, hiçbir yerde açık gösterilmez."
          />
          <Input
            id={fid("birthDate")}
            label="Doğum tarihi"
            required
            type="date"
            autoComplete={self ? "bday" : "off"}
            max={today}
            value={s.birthDate}
            onChange={(e) => set("birthDate", e.target.value)}
            error={errors.birthDate}
            hint={age !== null && age >= 0 && age < 18 ? "18 yaşından küçükler tartışmalara katılabilir ancak oy kullanamaz." : undefined}
          />
        </div>
      </fieldset>

      <fieldset className="form-section">
        <legend>İletişim</legend>
        <div className="form-grid">
          <Input id={fid("email")} label="E-posta" required type="email" autoComplete={self ? "email" : "off"} inputMode="email" value={s.email} onChange={(e) => set("email", e.target.value)} error={errors.email} />
          <Input id={fid("phone")} label="Telefon" required type="tel" autoComplete={self ? "tel" : "off"} inputMode="tel" placeholder="05xx xxx xx xx" value={s.phone} onChange={(e) => set("phone", e.target.value)} error={errors.phone} />
        </div>
      </fieldset>

      <fieldset className="form-section">
        <legend>Adres</legend>
        <div className="form-grid">
          <Input id={fid("il")} label="İl" required autoComplete={self ? "address-level1" : "off"} value={s.il} onChange={(e) => set("il", e.target.value)} error={errors.il} />
          <Input id={fid("ilce")} label="İlçe" required autoComplete={self ? "address-level2" : "off"} value={s.ilce} onChange={(e) => set("ilce", e.target.value)} error={errors.ilce} />
          <Input id={fid("mahalle")} label="Mahalle" required autoComplete="off" value={s.mahalle} onChange={(e) => set("mahalle", e.target.value)} error={errors.mahalle} />
          <Input
            id={fid("postaKodu")}
            label="Posta kodu (isteğe bağlı)"
            inputMode="numeric"
            autoComplete={self ? "postal-code" : "off"}
            maxLength={5}
            value={s.postaKodu}
            onChange={(e) => set("postaKodu", e.target.value.replace(/\D/g, "").slice(0, 5))}
            error={errors.postaKodu}
          />
        </div>
        <Textarea
          id={fid("acikAdres")}
          label="Açık adres"
          required
          rows={2}
          autoComplete={self ? "street-address" : "off"}
          value={s.acikAdres}
          onChange={(e) => set("acikAdres", e.target.value)}
          error={errors.acikAdres}
          hint="İl ve ilçe dışında hiçbir adres bilgisi herkese açık sayfalarda kullanılmaz."
        />
      </fieldset>

      <fieldset className="form-section">
        <legend>Aydınlatma metni ve açık rıza</legend>
        <Details summary="KVKK aydınlatma metnini oku">
          <KvkkNotice />
        </Details>
        <Checkbox
          id={fid("kvkkNoticeAccepted")}
          label={self ? "Aydınlatma metnini okudum ve anladım." : "Üye aydınlatma metnini okudu (bilgilendirildi)."}
          hint="Bu bir rıza değil, bilgilendirildiğinizin teyididir."
          checked={s.kvkkNoticeAccepted}
          onChange={(e) => set("kvkkNoticeAccepted", e.target.checked)}
          error={errors.kvkkNoticeAccepted}
          required
        />
        <div className="consent-box">
          <Checkbox
            label={
              self
                ? "Oy ve görüş verilerimin (siyasi görüşümü ortaya koyabilecek özel nitelikli veri) işlenmesine açık rıza veriyorum."
                : "Üye, oy ve görüş verilerinin işlenmesine açık rıza verdi."
            }
            hint="Oy kullanabilmek için gereklidir. Vermezseniz konu açabilir, tartışabilir ve öneri verebilirsiniz ancak oylamalara katılamazsınız. Rızanızı Profil sayfasından istediğiniz zaman geri alabilirsiniz."
            checked={s.politicalConsent}
            onChange={(e) => set("politicalConsent", e.target.checked)}
          />
        </div>
        <div className="consent-box">
          <Checkbox
            label={self ? "Yazdığım içeriğin yapay zekâ ile analiz edilmesine açık rıza veriyorum (isteğe bağlı)." : "Üye, içeriğinin yapay zekâ ile analiz edilmesine açık rıza verdi (isteğe bağlı)."}
            hint="Varsayılan olarak kapalıdır. Rıza verilirse içerik, kişisel veriler maskelendikten sonra özet ve sınıflandırma için yapay zekâ hizmetine gönderilebilir. Vermemeniz hiçbir hakkınızı kısıtlamaz."
            checked={s.aiConsent}
            onChange={(e) => set("aiConsent", e.target.checked)}
          />
        </div>
      </fieldset>

      {serverError ? <ErrorView error={serverError} title={self ? "Kayıt tamamlanamadı" : "Üye kaydedilemedi"} /> : null}

      <div className="form-actions">
        <Button type="submit" variant="primary" loading={submitting}>
          {submitLabel ?? (self ? "Kaydol" : "Üyeyi sisteme gir")}
        </Button>
      </div>
    </form>
  );
}

export default RegistrationForm;
