// Profil ve Ayarlar sayfalarının saf mantığı (bileşenden ayrı, birim testli): oy hakkı durumu ve tek eylemi, kapalı kartların
// tek satırlık hükümleri ('Kapalı başlık cevap verir') ve ?bolum= çapaları. Karar mantığı sunucuda kalır: oy hakkı koşulları
// (doğrulanmış hesap, 18 yaş, siyasi görüş rızası) server/src/forum/eligibility.ts ile aynıdır; burada yalnız kullanıcıya SÖYLENİR.
import { EXPERT_STATUS_LABELS, type CorrectionStatus, type ExpertStatus, type Me } from "@forum/shared";
import { routes } from "../../lib/routes";
import { sectionSearch } from "../../lib/sectionParam";

// ───────────── Derin bağlantı çapaları (?bolum=<çapa>) ─────────────

/** Profil sayfasındaki kartların çapaları: katlanabilir olanlar (kvkk, duzeltme …) bağlantıyla kendiliğinden açılır. */
export const PROFILE_ANCHORS = {
  oyHakki: "oy-hakki",
  hesap: "hesap",
  rizalar: "rizalar",
  vekaletler: "vekaletler",
  bilirkisilik: "bilirkisilik",
  takmaAd: "takma-ad",
  sifre: "sifre",
  kvkk: "kvkk",
  duzeltme: "duzeltme",
} as const;

/** Ayarlar sayfasının çapaları: `anahtarlar` ve `hakkinda` 'Gelişmiş' altındaki katlanabilir kartlardır. */
export const SETTINGS_ANCHORS = {
  gorunum: "gorunum",
  sunucu: "sunucu",
  makbuzlar: "makbuzlar",
  gelismis: "gelismis",
  anahtarlar: "anahtarlar",
  hakkinda: "hakkinda",
} as const;

export type ProfileAnchor = (typeof PROFILE_ANCHORS)[keyof typeof PROFILE_ANCHORS];
export type SettingsAnchor = (typeof SETTINGS_ANCHORS)[keyof typeof SETTINGS_ANCHORS];

/** `/profil` ya da `/profil?bolum=<çapa>`. */
export const profileHref = (anchor?: ProfileAnchor): string => routes.profile() + sectionSearch(anchor);

/** `/ayarlar` ya da `/ayarlar?bolum=<çapa>`. */
export const settingsHref = (anchor?: SettingsAnchor): string => routes.settings() + sectionSearch(anchor);

// ───────────── Oy hakkı ─────────────

export interface VoteRight {
  /** Oy kullanma koşullarının üçü de tamam mı? */
  can: boolean;
  /** Eksik koşullar, önem sırasıyla (oy hakkı varsa boş) */
  missing: string[];
  /** Üyenin kendi yapabileceği TEK eylem; yoksa null (kayıt memuru onayı, askı, 18 yaş gibi engeller üyenin elinde değildir) */
  action: "consent" | null;
}

export const PENDING_TEXT = "Kayıt memuru onayı bekleniyor. Kimliğiniz doğrulanınca öneri açabilir, oy verebilir ve vekâlet verebilirsiniz.";
export const SUSPENDED_TEXT = "Hesabınız askıya alındı; askı süresince oy kullanamazsınız. Ayrıntı için bildirimlerinizi kontrol edin.";
export const REJECTED_TEXT = "Kimlik doğrulamanız reddedildi; bu hesapla oy kullanılamaz.";
export const ERASED_TEXT = "Bu hesap silinmiş; oy kullanılamaz.";
export const MINOR_TEXT = "18 yaşından küçük üyeler oy veremez; öneri açabilir, destekleyebilir ve tartışmalara katılabilirsiniz.";
export const CONSENT_TEXT = "Siyasi görüş verisine açık rıza verilmemiş; oy kullanmak için gereklidir.";

const STATUS_TEXT: Record<Exclude<Me["status"], "verified">, string> = {
  pending: PENDING_TEXT,
  suspended: SUSPENDED_TEXT,
  rejected: REJECTED_TEXT,
  erased: ERASED_TEXT,
};

/**
 * Oy hakkı: hesap doğrulanmış, 18 yaşından büyük ve siyasi görüş rızası var. Askıdaki, reddedilmiş ve silinmiş hesapta yalnız
 * hesap durumu söylenir (rıza vermek bir şeyi değiştirmez); 18 yaşından küçük üyeye rıza istenmez. Eksik rıza, bekleyen
 * hesapta da verilebilir: onay beklerken yapılabilecek tek iştir.
 */
export function voteRightOf(me: Pick<Me, "status" | "isAdult" | "politicalConsent">): VoteRight {
  const missing: string[] = [];
  let action: VoteRight["action"] = null;
  if (me.status !== "verified") missing.push(STATUS_TEXT[me.status]);
  if (me.status === "verified" || me.status === "pending") {
    if (!me.isAdult) missing.push(MINOR_TEXT);
    else if (!me.politicalConsent) {
      missing.push(CONSENT_TEXT);
      action = "consent";
    }
  }
  return { can: missing.length === 0, missing, action };
}

// ───────────── Kapalı kartların hükümleri ─────────────

/** Bilirkişilik kartı: kullanıcının kendi bilirkişi kaydı (yoksa undefined). `loaded` false iken hüküm yoktur. */
export function expertSummary(own: { status: ExpertStatus; activeAssignments: number; completedReports: number } | undefined, loaded: boolean): string | undefined {
  if (!loaded) return undefined;
  if (!own) return "Bilirkişi değilsiniz.";
  return `${EXPERT_STATUS_LABELS[own.status] ?? own.status} · aktif görev ${own.activeAssignments} · tamamlanan rapor ${own.completedReports}`;
}

/** Kimlik düzeltme kartı: bekleyen talep var mı? Reddedilmiş/silinmiş hesapta düzeltme talebi açılamaz (sunucu da reddeder). */
export function correctionSummary(list: readonly { status: CorrectionStatus }[] | undefined, closed: boolean): string | undefined {
  if (closed) return "Bu hesap için düzeltme talebi açılamaz.";
  if (!list) return undefined;
  const pending = list.filter((c) => c.status === "pending").length;
  if (pending) return `Kayıt memurunda bekleyen ${pending} talebiniz var.`;
  return list.length ? `Açık talep yok · geçmiş talep: ${list.length}` : "Açık talep yok.";
}

/** Vekâletler kartı: iki liste de boşsa tek satır; yalnız biri boşsa o yönün kısa notu. */
export function emptyDelegationLine(outgoing: number, incoming: number): string | null {
  if (!outgoing && !incoming) return "Henüz vekâlet vermediniz ve size verilmiş vekâlet yok.";
  if (!outgoing) return "Henüz vekâlet vermediniz; oy vermediğiniz oylamalarda oyunuz kullanılmamış sayılır.";
  if (!incoming) return "Size verilmiş vekâlet yok.";
  return null;
}

/** Doğrulayıcı anahtarları kartı: cihazda sabitlenmiş sunucu ve anahtar sayısı. `null` = yükleniyor. */
export function pinsSummary(pins: readonly { validators: readonly unknown[] }[] | null): string | undefined {
  if (pins === null) return undefined;
  if (pins.length === 0) return "Henüz sabitlenmiş anahtar yok; ilk oy doğrulamasında sabitlenir.";
  const keys = pins.reduce((n, p) => n + p.validators.length, 0);
  return `${pins.length} sunucu için ${keys} doğrulayıcı anahtarı bu cihaza sabitlenmiş.`;
}

/** 'Web tarayıcısı' ya da 'Yerel uygulama (android)'. */
export const platformLabel = (platform: string): string => (platform === "web" ? "Web tarayıcısı" : `Yerel uygulama (${platform})`);

/** Uygulama hakkında kartı: istemci sürümü ve platform. */
export const aboutSummary = (version: string, platform: string): string => `İstemci sürümü ${version} · ${platformLabel(platform)}`;

/** Takma ad kartı: mevcut ad ve değiştirme sınırı; askıdaki hesapta değiştirilemez. */
export function nicknameSummary(nickname: string, suspended: boolean): string {
  return suspended ? "Hesabınız askıdayken takma adınız değiştirilemez." : `Şu an @${nickname} · 30 günde en çok bir kez değiştirilebilir.`;
}

export const PASSWORD_SUMMARY = "Değiştirince diğer cihazlardaki oturumlarınız kapanır.";
export const KVKK_SUMMARY = "Verinizi indirebilir, aydınlatma metnini okuyabilir ya da hesabınızı silebilirsiniz.";
