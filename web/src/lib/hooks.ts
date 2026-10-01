// Küçük genel kancalar.
import { useCallback, useEffect, useRef, useState } from "react";
import { useSearchParams } from "react-router-dom";
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
 * URL sorgu parametresine bağlı durum (ör. sekme): const [tab, setTab] = useQueryState("sekme", "acik").
 * Varsayılan değer URL'ye yazılmaz; geçmişe yeni kayıt eklemez (replace).
 */
export function useQueryState(key: string, defaultValue: string): [string, (v: string) => void] {
  const [params, setParams] = useSearchParams();
  const value = params.get(key) ?? defaultValue;
  const set = useCallback(
    (v: string) => {
      setParams(
        (prev) => {
          const p = new URLSearchParams(prev);
          if (v === defaultValue || v === "") p.delete(key);
          else p.set(key, v);
          return p;
        },
        { replace: true },
      );
    },
    [key, defaultValue, setParams],
  );
  return [value, set];
}
