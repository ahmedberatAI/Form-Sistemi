// Bildirimler: tür sınıfı (ikon + ekran okuyucu metni), tarih grupları (Bugün / Bu hafta / Daha eski), süzgeç ve odak yardımcıları.
// SAF mantık: bileşenden ayrıdır ve birim testlidir (notificationKinds.test.ts). Bkz. docs/ARAYUZ_PLANI.md (Faz 3 / madde 6).
//
// Neden açık bir eşleme tablosu? Sunucudaki bildirim türleri (notifications.kind) tek bir önek düzenine uymaz:
// `proposal_*`, `expert_*`, `vote_*`, `message_*` önekli; `deletion_request`, `delegation_unrouted`, `minority_report`,
// `registration_pending`, `identity_correction`, `password_changed`, `nickname_changed`… öneksizdir. Önek eşlemesi bunları
// sessizce yanlış sınıfa atardı. Bu yüzden her tür tabloda tek tek yazılır; tabloda olmayan tür varsayılan sınıfa düşer.
// Tablonun sunucuyla ayrışmaması notificationKinds.test.ts'te kilitlidir: sunucu kaynağındaki her notify() çağrısının
// `kind` değeri burada yer almalıdır (yeni tür eklenip tabloya yazılmazsa test düşer).
import type { Notification, NotificationList } from "@forum/shared";
import type { IconName } from "../ui/Icon";

// ───────────────────────── Tür sınıfları ─────────────────────────

export type NotificationClassId = "oylama" | "oneri" | "tartisma" | "bilirkisi" | "vekalet" | "hesap" | "yonetim" | "diger";

/**
 * Simgenin rengi (renk tek başına anlam taşımaz: her satırda simge ve ekran okuyucu metni vardır):
 * info = mavi, 'sizden eylem bekleyen' (oy, görev); warning = turuncu, dikkat; neutral = gri, tür.
 */
export type NotificationTone = "neutral" | "info" | "warning";

export interface NotificationClass {
  id: NotificationClassId;
  /** Ekran okuyucu metni ve masaüstü fare ipucu ('Öneri', 'Oylama'…) */
  label: string;
  icon: IconName;
  tone: NotificationTone;
}

export const NOTIFICATION_CLASSES: Readonly<Record<NotificationClassId, NotificationClass>> = {
  oylama: { id: "oylama", label: "Oylama", icon: "vote", tone: "info" },
  oneri: { id: "oneri", label: "Öneri", icon: "proposals", tone: "neutral" },
  tartisma: { id: "tartisma", label: "Tartışma", icon: "topics", tone: "neutral" },
  bilirkisi: { id: "bilirkisi", label: "Bilirkişi", icon: "experts", tone: "neutral" },
  vekalet: { id: "vekalet", label: "Vekâlet", icon: "users", tone: "warning" },
  hesap: { id: "hesap", label: "Hesap", icon: "user", tone: "neutral" },
  yonetim: { id: "yonetim", label: "Yönetim görevi", icon: "registrar", tone: "info" },
  diger: { id: "diger", label: "Bildirim", icon: "bell", tone: "neutral" },
};

/** Tanınmayan türün düştüğü sınıf. */
export const DEFAULT_NOTIFICATION_CLASS: NotificationClass = NOTIFICATION_CLASSES.diger;

/**
 * notifications.kind → sınıf. Sunucudaki TÜM türler (server/src altında notify()/notifyMany() çağrıları) burada tek tek yazılıdır.
 * Önek yetmez: öneksiz türler de vardır (deletion_request, delegation_*, registration_pending, identity_correction*, …).
 */
export const NOTIFICATION_KINDS: Readonly<Record<string, NotificationClassId>> = {
  // Oylama: oy sizi bekliyor / süre uzadı
  vote_open: "oylama",
  vote_extended: "oylama",

  // Öneri: evre, metin, destek, öneri sahibine gelen girdiler
  proposal_phase: "oneri",
  proposal_version: "oneri",
  proposal_sponsored: "oneri",
  proposal_suggestion: "oneri",
  proposal_rights_flag: "oneri",
  minority_report: "oneri",

  // Tartışma: yanıt, gizleme kararı, silme talebi
  message_reply: "tartisma",
  message_hidden: "tartisma",
  deletion_request: "tartisma",

  // Bilirkişi: panel çağrısı, rapor, süre, yaptırım
  expert_invited: "bilirkisi",
  expert_decision: "bilirkisi",
  expert_sanction: "bilirkisi",
  expert_unavailable: "bilirkisi",
  expert_report: "bilirkisi",
  expert_overdue: "bilirkisi",
  expert_panel: "bilirkisi",
  expert_request: "bilirkisi",

  // Vekâlet: kullanılamayan ya da düşen vekâlet (dikkat)
  delegation_unrouted: "vekalet",
  delegation_revoked: "vekalet",

  // Hesap: üyelik, rol, şifre, takma ad, kimlik düzeltme sonucu
  account_verified: "hesap",
  account_rejected: "hesap",
  roles_changed: "hesap",
  password_changed: "hesap",
  nickname_changed: "hesap",
  nickname_conflict: "hesap",
  identity_correction: "hesap",

  // Yönetim görevi: kayıt memuru ve yönetici kuyruğu
  registration_pending: "yonetim",
  identity_correction_pending: "yonetim",
  expert_application: "yonetim",

  // Sunucu bugün bildirim olarak GÖNDERMEYEN ama plan listesinde geçen adlar (bütünlük uyarısı ve panel çağrısı):
  // ileride bildirime dönüşürse varsayılan sınıfa düşmesin diye önceden eşlenir.
  lockstep: "yonetim",
  panel: "bilirkisi",
};

/** Sunucunun bugün gerçekten gönderdiği türler değil, yalnız ileriye dönük ayrılmış adlar (testte sunucu taramasının dışında tutulur). */
export const RESERVED_KINDS: readonly string[] = ["lockstep", "panel"];

/** Tablodaki tüm türler (sıra: tabloda yazıldığı gibi). */
export const KNOWN_KINDS: readonly string[] = Object.keys(NOTIFICATION_KINDS);

/** Türün sınıfı. Tanınmayan, boş ya da `constructor`/`__proto__` gibi nesne adlarına denk gelen tür varsayılan sınıfa düşer. */
export function classifyKind(kind: string | null | undefined): NotificationClass {
  const key = typeof kind === "string" ? kind.trim() : "";
  if (!key || !Object.hasOwn(NOTIFICATION_KINDS, key)) return DEFAULT_NOTIFICATION_CLASS;
  return NOTIFICATION_CLASSES[NOTIFICATION_KINDS[key]];
}

/** Tür tabloda açıkça yazılı mı? (Tanınmayan türler çizilir ama varsayılan sınıftadır.) */
export function isKnownKind(kind: string | null | undefined): boolean {
  return typeof kind === "string" && Object.hasOwn(NOTIFICATION_KINDS, kind.trim());
}

// ───────────────────────── Tarih grupları ─────────────────────────

export type AgeGroupId = "bugun" | "hafta" | "eski";

export const AGE_GROUP_LABELS: Readonly<Record<AgeGroupId, string>> = {
  bugun: "Bugün",
  hafta: "Bu hafta",
  eski: "Daha eski",
};

/** Grup sırası (en yeniden en eskiye). */
export const AGE_GROUP_ORDER: readonly AgeGroupId[] = ["bugun", "hafta", "eski"];

/**
 * Bildirimin hangi gruba girdiği, CİHAZIN yerel takvimiyle ve verilen `now` (sunucu/simüle saati) ile:
 * - Bugün: yerel gece yarısından itibaren (gelecekteki zaman damgası, ör. saat ileri alınmışsa, da Bugün sayılır).
 * - Bu hafta: Bugün hariç, bugün dahil son yedi takvim günü (dün Pazar, bugün Pazartesi ise 'Bu hafta'dır).
 * - Daha eski: geri kalan (geçersiz zaman damgası dahil).
 */
export function ageGroupOf(createdAt: number, now: number): AgeGroupId {
  if (!Number.isFinite(createdAt)) return "eski";
  const today = new Date(Number.isFinite(now) ? now : Date.now());
  const startOfToday = new Date(today.getFullYear(), today.getMonth(), today.getDate()).getTime();
  if (createdAt >= startOfToday) return "bugun";
  // Gün sayısıyla geri gitmek yaz/kış saati geçişinde 23 ya da 25 saatlik günlerde bile doğru takvim gününe iner.
  const startOfWeek = new Date(today.getFullYear(), today.getMonth(), today.getDate() - 6).getTime();
  return createdAt >= startOfWeek ? "hafta" : "eski";
}

export interface NotificationGroup<T> {
  id: AgeGroupId;
  label: string;
  items: T[];
}

/**
 * Öğeleri tarih gruplarına böler (boş grup dönmez). Grup içinde en yeni önce; eşit zamanlıların sunucu sırası korunur.
 * Geçersiz zaman damgaları en sona (Daha eski) düşer.
 */
export function groupByAge<T extends { createdAt: number }>(items: readonly T[], now: number): NotificationGroup<T>[] {
  const time = (x: T): number => (Number.isFinite(x.createdAt) ? x.createdAt : Number.NEGATIVE_INFINITY);
  const sorted = [...items].sort((a, b) => {
    const ta = time(a);
    const tb = time(b);
    return ta === tb ? 0 : ta < tb ? 1 : -1;
  });
  const buckets: Record<AgeGroupId, T[]> = { bugun: [], hafta: [], eski: [] };
  for (const item of sorted) buckets[ageGroupOf(item.createdAt, now)].push(item);
  return AGE_GROUP_ORDER.filter((id) => buckets[id].length > 0).map((id) => ({ id, label: AGE_GROUP_LABELS[id], items: buckets[id] }));
}

// ───────────────────────── Süzgeç ve yerel okundu durumu ─────────────────────────

export type NotificationFilter = "all" | "unread";

/**
 * Sayfa ilk açıldığında seçili süzgeç: ekranda gösterilebilen okunmamış bildirim varsa 'Okunmamış', yoksa 'Tümü'.
 * Sunucudaki sayı listeye sığmayan eski okunmamışları da sayabilir; boş bir 'Okunmamış' sekmesiyle açılmamak için
 * yüklenen öğelerde de okunmamış aranır.
 */
export function defaultFilter(list: Pick<NotificationList, "items" | "unread">): NotificationFilter {
  return list.unread > 0 && list.items.some((n) => !n.read) ? "unread" : "all";
}

export function filterNotifications<T extends Pick<Notification, "read">>(items: readonly T[], filter: NotificationFilter): T[] {
  return filter === "unread" ? items.filter((n) => !n.read) : [...items];
}

/**
 * Sunucuya okundu bildirildikten sonra yerel listeyi günceller. `ids === null` hepsini okundu yapar.
 * Okunmamış SAYISI listeden yeniden sayılmaz: sunucu sayısı yüklenen 100 öğeden fazlasını da kapsayabilir, bu yüzden
 * yalnız gerçekten okunmamıştan okunmuşa dönen öğe kadar azaltılır (`ids === null` ise 0).
 */
export function markReadLocally(list: NotificationList, ids: readonly string[] | null): NotificationList {
  let flipped = 0;
  const wanted = ids === null ? null : new Set(ids);
  const items = list.items.map((n) => {
    if (n.read || (wanted !== null && !wanted.has(n.id))) return n;
    flipped++;
    return { ...n, read: true };
  });
  return { items, unread: ids === null ? 0 : Math.max(0, list.unread - flipped) };
}

// ───────────────────────── Erişilebilir adlar ve odak ─────────────────────────

/** 'Okundu işaretle' simge düğmesinin erişilebilir adı. */
export const readButtonLabel = (title: string): string => `Okundu işaretle: ${title}`;

/**
 * Bir satır okundu işaretlenince odağın gideceği satırlar, öncelik sırasıyla: önce satırın kendisi (süzgeç 'Tümü' ise satır
 * listede kalır), sonra aşağıdaki, en sonda yukarıdaki satırlar. Hiçbirinde odaklanacak öğe yoksa sayfa panelinin kendisine gidilir.
 * Düğme silindiği için odak sessizce sayfa başına düşmesin diye kullanılır.
 */
export function focusCandidates(order: readonly string[], id: string, rowStays: boolean): string[] {
  const at = order.indexOf(id);
  if (at < 0) return rowStays ? [id] : [];
  const after = order.slice(at + 1);
  const before = order.slice(0, at).reverse();
  return [...(rowStays ? [id] : []), ...after, ...before];
}
