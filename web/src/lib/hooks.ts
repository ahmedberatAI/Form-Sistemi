// Küçük genel kancalar.
import { useCallback, useEffect, useRef, useState } from "react";
import { useLocation, useSearchParams } from "react-router-dom";
import { useServerNow } from "../auth/AuthContext";

/** Sunucu (simüle) saatine göre "şimdi"; her intervalMs'de yeniden çizdirir. */
export function useNow(intervalMs = 1000): number {
  const now = useServerNow();
  const [t, setT] = useState(() => now());
  useEffect(() => {
    setT(now());
    const id = window.setInterval(() => setT(now()), intervalMs);
    return () => window.clearInterval(id);
  }, [now, intervalMs]);
  return t;
}

/** setInterval kancası (delay null → durur). */
export function useInterval(fn: () => void, delay: number | null): void {
  const ref = useRef(fn);
  ref.current = fn;
  useEffect(() => {
    if (delay == null) return;
    const id = window.setInterval(() => ref.current(), delay);
    return () => window.clearInterval(id);
  }, [delay]);
}

/** Değeri ms kadar geciktirir (arama kutuları, canlı ön denetim). */
export function useDebounced<T>(value: T, ms = 400): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const id = window.setTimeout(() => setV(value), ms);
    return () => window.clearTimeout(id);
  }, [value, ms]);
  return v;
}

/**
 * Henüz işlenmemiş (aynı olay/tik içinde istenmiş) sorgu güncellemeleri. react-router'ın setSearchParams'ı işlevsel
 * güncellemede bile `prev` olarak ÇİZİM ANINDAKİ parametreleri verir; aynı olayda iki anahtar güncellenince ikinci
 * navigate birincisini ezer (ör. setTab("x"); setKind("y") → yalnız tur=y kalır). Çözüm: bekleyen sonucu modül düzeyinde
 * tutup sonraki güncellemeyi onun üzerine uygulamak. Kayıt, çizim anındaki yol+sorgu ile anahtarlanır ve mikro görevde
 * temizlenir: yönlendirme işlendikten sonra yeni çizim zaten güncel parametreleri verir.
 */
let pendingQuery: { base: string; next: URLSearchParams } | null = null;

/** Saf yardımcı: anahtarı ayarlar ya da (varsayılan/boş değerde) siler. */
export function applyQueryValue(params: URLSearchParams, key: string, value: string, defaultValue: string): URLSearchParams {
  const p = new URLSearchParams(params);
  if (value === defaultValue || value === "") p.delete(key);
  else p.set(key, value);
  return p;
}

/**
 * Aynı tik içindeki güncellemeleri birleştirir: `base` (çizim anındaki yol+sorgu) bekleyen kaydınkiyle aynıysa güncelleme
 * bekleyen sonucun üzerine, değilse `prev` üzerine uygulanır. Dışa açık yalnız denetlenebilirlik için.
 */
export function composeQueryUpdate(base: string, prev: URLSearchParams, update: (p: URLSearchParams) => URLSearchParams): URLSearchParams {
  const start = pendingQuery && pendingQuery.base === base ? pendingQuery.next : prev;
  const next = update(start);
  const first = pendingQuery === null;
  pendingQuery = { base, next };
  if (first) queueMicrotask(() => (pendingQuery = null));
  return next;
}

/**
 * URL sorgu parametresine bağlı durum (ör. sekme): const [tab, setTab] = useQueryState("sekme", "acik").
 * Varsayılan değer URL'ye yazılmaz; geçmişe yeni kayıt eklemez (replace). Aynı olayda birden çok anahtar güncellenebilir
 * (ör. sekme + tür birlikte): güncellemeler birbirini ezmez.
 */
export function useQueryState(key: string, defaultValue: string): [string, (v: string) => void] {
  const [params, setParams] = useSearchParams();
  const { pathname } = useLocation();
  const value = params.get(key) ?? defaultValue;
  const set = useCallback(
    (v: string) => {
      setParams((prev) => composeQueryUpdate(`${pathname}?${prev.toString()}`, prev, (p) => applyQueryValue(p, key, v, defaultValue)), { replace: true });
    },
    [key, defaultValue, setParams, pathname],
  );
  return [value, set];
}
