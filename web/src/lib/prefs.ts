// Cihazda kalıcı ayar deposu. Asenkron arayüz:
// - Capacitor yerel platformda (Android) @capacitor/preferences,
// - web'de localStorage (erişilemezse bellek içi yedek).
import { Capacitor } from "@capacitor/core";
import { Preferences } from "@capacitor/preferences";

/** Bilinen anahtarlar (tek yerde, çakışma olmasın diye). */
export const PREF_KEYS = {
  token: "forum.token",
  serverUrl: "forum.serverUrl",
  theme: "forum.theme",
  /** Görünüm yoğunluğu: "sade" (varsayılan) | "tam". Bkz. lib/detailLevel.tsx */
  detail: "forum.detail",
  receipts: "forum.receipts",
  validators: "forum.validators",
  /** 'Notu gizle' ile bu cihazda gizlenen notların anahtarları (JSON dizi). Bkz. getDismissed/addDismissed, components/home/SetupNotes */
  dismissed: "forum.dismissed",
  /**
   * Son açılan öneriler (kişisel sıralamanın geçici girdisi): anahtar `forum.sonAcilanlar:<kullanıcı kimliği>`, JSON dizi, en çok 20
   * öneri kimliği. YALNIZ bu cihazda; çıkışta silinir. Bkz. lib/recentOpened
   */
  recentOpened: "forum.sonAcilanlar",
  /** Öneriler › Sırala: 'Size göre' seçimi bu cihazda hatırlanır; anahtar `forum.oneriSirasi:<kullanıcı kimliği>`. Bkz. lib/personalSort */
  proposalSort: "forum.oneriSirasi",
} as const;

const memory = new Map<string, string>();

export function isNativePlatform(): boolean {
  try {
    return Capacitor.isNativePlatform();
  } catch {
    return false;
  }
}

export function platformName(): string {
  try {
    return Capacitor.getPlatform(); // "web" | "android" | "ios"
  } catch {
    return "web";
  }
}

function lsGet(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return memory.get(key) ?? null;
  }
}

function lsSet(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    memory.set(key, value);
  }
}

function lsRemove(key: string): void {
  try {
    window.localStorage.removeItem(key);
  } catch {
    memory.delete(key);
  }
}

export async function getPref(key: string): Promise<string | null> {
  if (isNativePlatform()) {
    try {
      const { value } = await Preferences.get({ key });
      return value;
    } catch {
      return lsGet(key);
    }
  }
  return lsGet(key);
}

export async function setPref(key: string, value: string): Promise<void> {
  if (isNativePlatform()) {
    try {
      await Preferences.set({ key, value });
      return;
    } catch {
      /* yedeğe düş */
    }
  }
  lsSet(key, value);
}

export async function removePref(key: string): Promise<void> {
  if (isNativePlatform()) {
    try {
      await Preferences.remove({ key });
    } catch {
      /* yok say */
    }
  }
  lsRemove(key);
}

export async function getJsonPref<T>(key: string, fallback: T): Promise<T> {
  const raw = await getPref(key);
  if (raw == null) return fallback;
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

export async function setJsonPref(key: string, value: unknown): Promise<void> {
  await setPref(key, JSON.stringify(value));
}

/** Eşzamanlı okuma (yalnızca localStorage). Tema gibi ilk boyamadan önce gereken değerler için. */
export function getPrefSync(key: string): string | null {
  return lsGet(key);
}

/** Eşzamanlı yazma (yalnızca localStorage aynası). */
export function setPrefSync(key: string, value: string): void {
  lsSet(key, value);
}

// ───────────── Gizlenen notlar (forum.dismissed) ─────────────
// Tek seferlik bilgi notlarını ('Notu gizle') cihazda hatırlar. Okuma/yazma hiçbir zaman fırlatmaz: kayıt bozuksa ya da depo
// erişilemezse liste boş sayılır ve not yeniden görünür (bilgi kaybolmaz). İlk çizimde eşzamanlı ayna, sonra kalıcı depo okunur.

/** Saklanan en çok anahtar sayısı (en eskiler düşer). */
export const MAX_DISMISSED = 50;

/** Kayıtlı JSON metnini doğrular: yalnız dize elemanlar kalır; boş, bozuk ya da dizi olmayan kayıt boş liste. */
export function parseDismissed(raw: string | null | undefined): string[] {
  if (!raw) return [];
  try {
    const v: unknown = JSON.parse(raw);
    return Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.length > 0) : [];
  } catch {
    return [];
  }
}

/** Eşzamanlı okuma (localStorage aynası); ilk çizimde notun bir an görünüp kaybolmaması için. */
export function getDismissedSync(): string[] {
  try {
    return parseDismissed(getPrefSync(PREF_KEYS.dismissed));
  } catch {
    return [];
  }
}

/** Kalıcı depo (Android'de Preferences) ile aynanın birleşimi: biri temizlenmiş olsa da gizleme korunur. */
export async function getDismissed(): Promise<string[]> {
  let stored: string[] = [];
  try {
    stored = parseDismissed(await getPref(PREF_KEYS.dismissed));
  } catch {
    /* aynayla yetin */
  }
  return [...new Set([...stored, ...getDismissedSync()])];
}

/** Anahtarları gizlenenlere ekler (ayna + kalıcı depo) ve yeni listeyi döner. Yazılamazsa yalnız bu oturumda geçerli olur. */
export async function addDismissed(keys: string[]): Promise<string[]> {
  const next = [...new Set([...(await getDismissed()), ...keys.filter(Boolean)])].slice(-MAX_DISMISSED);
  const raw = JSON.stringify(next);
  try {
    setPrefSync(PREF_KEYS.dismissed, raw);
  } catch {
    /* yok say */
  }
  try {
    await setPref(PREF_KEYS.dismissed, raw);
  } catch {
    /* yok say */
  }
  return next;
}
