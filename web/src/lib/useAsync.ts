// Veri yükleme ve eylem kancaları.
import { useCallback, useEffect, useRef, useState, type DependencyList } from "react";
import { useToast } from "../ui/Toast";

export interface AsyncState<T> {
  data: T | undefined;
  error: unknown;
  /** İlk yükleme ya da reload sürerken true */
  loading: boolean;
  /** Veriyi yeniden yükler (önceki veri ekranda kalır) */
  reload: () => Promise<void>;
  /** Yerel güncelleme (ör. eylem yanıtıyla gelen yeni nesne) */
  setData: (next: T | ((prev: T | undefined) => T)) => void;
}

/**
 * const { data, error, loading, reload } = useAsync(() => getProposal(id), [id]);
 * - deps değişince yeniden yükler; eski isteklerin geç gelen yanıtları yok sayılır.
 * - opts.enabled === false → istek yapılmaz (ör. oturum yokken).
 * - opts.pollMs → bu aralıkla sessizce yeniler (loading değişmez).
 */
export function useAsync<T>(fn: () => Promise<T>, deps: DependencyList, opts?: { enabled?: boolean; pollMs?: number }): AsyncState<T> {
  const [data, setDataState] = useState<T | undefined>(undefined);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState<boolean>(opts?.enabled !== false);
  const reqId = useRef(0);
  const fnRef = useRef(fn);
  fnRef.current = fn;
  const enabled = opts?.enabled !== false;

  const run = useCallback(async (silent: boolean) => {
    const id = ++reqId.current;
    if (!silent) setLoading(true);
    try {
      const result = await fnRef.current();
      if (id !== reqId.current) return;
      setDataState(result);
      setError(null);
    } catch (e) {
      if (id !== reqId.current) return;
      if (e instanceof DOMException && e.name === "AbortError") return;
      if (!silent) setError(e);
    } finally {
      if (id === reqId.current && !silent) setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!enabled) {
      reqId.current++;
      setLoading(false);
      return;
    }
    void run(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, enabled]);

  useEffect(() => {
    if (!enabled || !opts?.pollMs) return;
    const t = window.setInterval(() => void run(true), opts.pollMs);
    return () => window.clearInterval(t);
  }, [enabled, opts?.pollMs, run]);

  const reload = useCallback(() => run(false), [run]);
  const setData = useCallback((next: T | ((prev: T | undefined) => T)) => {
    setDataState((prev) => (typeof next === "function" ? (next as (p: T | undefined) => T)(prev) : next));
  }, []);

  return { data, error, loading, reload, setData };
}

export interface ActionOptions<R> {
  /** Başarıda gösterilecek bildirim */
  success?: string | ((result: R) => string);
  onSuccess?: (result: R) => void;
  /** false → hata bildirimi gösterilmez (hata yine `error` alanına yazılır) */
  toastError?: boolean;
}

export interface ActionState<A extends unknown[], R> {
  /** Eylemi çalıştırır; hata olursa undefined döner (fırlatmaz) */
  run: (...args: A) => Promise<R | undefined>;
  loading: boolean;
  error: unknown;
  reset: () => void;
}

/**
 * Düğme eylemleri için: yükleniyor durumu + başarı/hata bildirimi.
 * const sponsor = useAction(() => sponsorProposal(id), { success: "Desteğiniz kaydedildi", onSuccess: setData });
 * <Button loading={sponsor.loading} onClick={() => sponsor.run()}>Destekle</Button>
 */
export function useAction<A extends unknown[], R>(fn: (...args: A) => Promise<R>, opts: ActionOptions<R> = {}): ActionState<A, R> {
  const toast = useToast();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const fnRef = useRef(fn);
  fnRef.current = fn;
  const optsRef = useRef(opts);
  optsRef.current = opts;
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const run = useCallback(
    async (...args: A) => {
      setLoading(true);
      setError(null);
      try {
        const r = await fnRef.current(...args);
        const o = optsRef.current;
        if (o.success) toast.success(typeof o.success === "function" ? o.success(r) : o.success);
        o.onSuccess?.(r);
        return r;
      } catch (e) {
        if (mounted.current) setError(e);
        if (optsRef.current.toastError !== false) toast.error(e);
        return undefined;
      } finally {
        if (mounted.current) setLoading(false);
      }
    },
    [toast],
  );

  return { run, loading, error, reset: () => setError(null) };
}
