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
