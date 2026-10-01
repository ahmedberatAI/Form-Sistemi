// Kayıt formu: RegistrationInput'un tüm alanları, istemci tarafı doğrulama (TCKN algoritması dahil),
// aydınlatma metni onayı ile AYRI açık rıza kutuları (siyasi görüş — oy için gerekli; YZ — varsayılan kapalı).
// Hem /kayit (mode="self") hem kayıt memurunun "Üyeyi sisteme gir" ekranında (mode="registrar") kullanılır.
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

type FieldKey =
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

interface FormState {
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

// Sunucudaki kurallarla (server/src/identity/validation.ts) aynı
const NICKNAME_RE = /^[A-Za-z0-9çğıöşüÇĞİÖŞÜâîûÂÎÛ._-]{3,32}$/;
const NAME_RE = /^[\p{L}\p{M}' .-]+$/u;

/** 05XX…, +90…, 0090… biçimlerini kabul eder (sunucu +90XXXXXXXXXX'e çevirir). */
function isValidPhone(raw: string): boolean {
  const s = raw.normalize("NFKC").replace(/[\s().-]/g, "");
  return /^0(5\d{9})$/.test(s) || /^\+90([2-5]\d{9})$/.test(s) || /^0090([2-5]\d{9})$/.test(s);
}

const ORDER: FieldKey[] = ["nickname", "password", "password2", "firstName", "lastName", "tckn", "birthDate", "email", "phone", "il", "ilce", "mahalle", "acikAdres", "postaKodu", "kvkkNoticeAccepted"];

function validate(s: FormState, mode: "self" | "registrar", today: string): Partial<Record<FieldKey, string>> {
  const e: Partial<Record<FieldKey, string>> = {};
  const nick = s.nickname.trim();
  if (nick.length < 3 || nick.length > 32) e.nickname = "Takma ad 3–32 karakter olmalıdır.";
  else if (!NICKNAME_RE.test(nick)) e.nickname = "Takma ad yalnızca harf (Türkçe harfler dahil), rakam, nokta, alt çizgi ve tire içerebilir; boşluk olamaz.";
  if (s.password.length < 8) e.password = "Şifre en az 8 karakter olmalıdır.";
  else if (s.password.length > 128) e.password = "Şifre en fazla 128 karakter olabilir.";
  else if (!/\p{L}/u.test(s.password) || !/\p{N}/u.test(s.password)) e.password = "Şifre en az bir harf ve bir rakam içermelidir.";
  if (mode === "self" && s.password2 !== s.password) e.password2 = "Şifreler eşleşmiyor.";
  if (!s.firstName.trim()) e.firstName = "Ad zorunludur.";
  else if (!NAME_RE.test(s.firstName.trim())) e.firstName = "Ad yalnızca harf, boşluk, kesme işareti ve tire içerebilir.";
  if (!s.lastName.trim()) e.lastName = "Soyad zorunludur.";
  else if (!NAME_RE.test(s.lastName.trim())) e.lastName = "Soyad yalnızca harf, boşluk, kesme işareti ve tire içerebilir.";
  const tckn = s.tckn.replace(/\D/g, "");
  if (tckn.length !== 11) e.tckn = "T.C. kimlik numarası 11 haneli olmalıdır.";
  else if (!isValidTckn(tckn)) e.tckn = "T.C. kimlik numarası geçerli değil (algoritma denetimi başarısız).";
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s.birthDate)) e.birthDate = "Doğum tarihini girin.";
  else if (s.birthDate >= today) e.birthDate = "Doğum tarihi geçmişte olmalıdır.";
  else if (s.birthDate < "1900-01-01") e.birthDate = "Doğum tarihi geçerli değil.";
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(s.email.trim())) e.email = "Geçerli bir e-posta adresi girin.";
  if (!isValidPhone(s.phone)) e.phone = "Telefon numarası 05XX XXX XX XX ya da +90 ile başlayan biçimde olmalıdır.";
  if (s.il.trim().length < 2) e.il = s.il.trim() ? "İl en az 2 karakter olmalıdır." : "İl zorunludur.";
  if (s.ilce.trim().length < 2) e.ilce = s.ilce.trim() ? "İlçe en az 2 karakter olmalıdır." : "İlçe zorunludur.";
  if (s.mahalle.trim().length < 2) e.mahalle = s.mahalle.trim() ? "Mahalle en az 2 karakter olmalıdır." : "Mahalle zorunludur.";
  if (s.acikAdres.trim().length < 5) e.acikAdres = s.acikAdres.trim() ? "Açık adres en az 5 karakter olmalıdır." : "Açık adres zorunludur.";
  if (s.postaKodu.trim() && !/^\d{5}$/.test(s.postaKodu.trim())) e.postaKodu = "Posta kodu 5 haneli olmalıdır.";
  if (!s.kvkkNoticeAccepted) e.kvkkNoticeAccepted = mode === "self" ? "Devam etmek için aydınlatma metnini okuduğunuzu onaylayın." : "Üyenin aydınlatma metnini okuduğunu onaylayın.";
  return e;
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
    const input: RegistrationInput = {
      nickname: s.nickname.trim(),
      password: s.password,
      firstName: s.firstName.trim(),
      lastName: s.lastName.trim(),
      tckn: s.tckn.replace(/\D/g, ""),
      birthDate: s.birthDate,
      email: s.email.trim(),
      phone: s.phone.trim(),
      address: {
        il: s.il.trim(),
        ilce: s.ilce.trim(),
        mahalle: s.mahalle.trim(),
        acikAdres: s.acikAdres.trim(),
        ...(s.postaKodu.trim() ? { postaKodu: s.postaKodu.trim() } : {}),
      },
      kvkkNoticeAccepted: s.kvkkNoticeAccepted,
      politicalConsent: s.politicalConsent,
      aiConsent: s.aiConsent,
    };
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
