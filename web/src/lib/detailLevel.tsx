// Görünüm yoğunluğu tercihi: "sade" (varsayılan) | "tam". Yalnız VARSAYILAN AÇIKLIĞI değiştirir, içerik gizlemez:
// - sade: katlanabilir kartlar, "Ayrıntı" açılırları ve kırpılmış uzun metinler kapalı/kısa başlar (1 dokunuşla açılır);
// - tam: hepsi açık gelir (bugünkü "her şey açık" düzen) — Ayarlar › Görünüm'den tek seçimle.
// Desen components/system/theme.ts ile aynı: ilk çizimde eşzamanlı ayna (localStorage), sonra kalıcı depo
// (Android'de Capacitor Preferences); yazarken ikisine birden.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import { getPref, getPrefSync, PREF_KEYS, setPref, setPrefSync } from "./prefs";

export type DetailLevel = "sade" | "tam";

export const DEFAULT_DETAIL_LEVEL: DetailLevel = "sade";

export const DETAIL_LEVEL_LABELS: Record<DetailLevel, string> = {
  sade: "Sade (önerilen)",
  tam: "Tam — tüm ayrıntılar açık",
};

/** Kayıtlı değeri doğrular; geçersiz/boş değer için null döner (varsayılana düşmek çağıranın işi). */
export function parseDetailLevel(v: unknown): DetailLevel | null {
  return v === "sade" || v === "tam" ? v : null;
}

/** Eşzamanlı okuma (ilk boyamadan önce): kayıt yoksa ya da bozuksa varsayılan. */
export function readDetailLevelSync(): DetailLevel {
  return parseDetailLevel(getPrefSync(PREF_KEYS.detail)) ?? DEFAULT_DETAIL_LEVEL;
}

/**
 * Okuma sırası: önce eşzamanlı ayna (`sync`), sonra kalıcı depo (`stored`). Kalıcı depoda GEÇERLİ bir değer varsa o kazanır
 * (Android'de WebView aynası temizlenmiş olabilir); yoksa ayna, o da yoksa varsayılan.
 */
export function resolveDetailLevel(sync: unknown, stored: unknown): DetailLevel {
  return parseDetailLevel(stored) ?? parseDetailLevel(sync) ?? DEFAULT_DETAIL_LEVEL;
}

/**
 * Bir bölümün (kart, Details, kırpılmış metin) varsayılan açıklığı.
 * `explicit` (defaultOpen / open) verilmişse o geçerlidir; verilmemişse 'tam' kipte açık, 'sade'de kapalı.
 * `openInFull=false` olan bölüm 'tam' kipte de kapalı gelir (ör. moderasyonla daraltılmış içerik).
 */
export function resolveDefaultOpen(explicit: boolean | undefined, level: DetailLevel, openInFull = true): boolean {
  if (explicit !== undefined) return explicit;
  return openInFull && level === "tam";
}

export interface DetailLevelApi {
  level: DetailLevel;
  /** level === "tam" kısayolu */
  full: boolean;
  /** Seçimi uygular ve kalıcılaştırır (eşzamanlı ayna + kalıcı depo). */
  setLevel: (level: DetailLevel) => void;
}

const Ctx = createContext<DetailLevelApi>({ level: DEFAULT_DETAIL_LEVEL, full: false, setLevel: () => undefined });

export function DetailLevelProvider({ children }: { children: ReactNode }) {
  const [level, setLevelState] = useState<DetailLevel>(readDetailLevelSync);
  const chosen = useRef(false);

  // Kalıcı depo (Android Preferences) aynadan farklı bir değer tutuyorsa ona geç (kullanıcı bu arada seçim yaptıysa dokunma).
  useEffect(() => {
    let alive = true;
    void getPref(PREF_KEYS.detail).then((v) => {
      if (alive && !chosen.current) setLevelState(resolveDetailLevel(getPrefSync(PREF_KEYS.detail), v));
    });
    return () => {
      alive = false;
    };
  }, []);

  const setLevel = useCallback((next: DetailLevel) => {
    chosen.current = true;
    setLevelState(next);
    setPrefSync(PREF_KEYS.detail, next);
    void setPref(PREF_KEYS.detail, next);
  }, []);

  const value = useMemo<DetailLevelApi>(() => ({ level, full: level === "tam", setLevel }), [level, setLevel]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

/** Geçerli görünüm yoğunluğu. Sağlayıcı yoksa 'sade' (bugünkü varsayılan). */
export function useDetailLevel(): DetailLevelApi {
  return useContext(Ctx);
}
