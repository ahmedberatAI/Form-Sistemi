// Oturum, kullanıcı, yetki yardımcıları ve sunucu saati (simüle) senkronu.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { LoginRequest, Me, RegistrationInput, Role, SystemInfo } from "@forum/shared";
import { ApiError, isSessionRejected, onServerChange, onUnauthorized, setAuthToken, toConnectionError } from "../api/client";
import * as api from "../api/endpoints";
import { syncOntologyWithBylawVersion } from "../lib/categories";
import { getPref, PREF_KEYS, removePref, setPref } from "../lib/prefs";
import { setReceiptOwner } from "../lib/receipts";
import { clearRecentOpened, setRecentOwner } from "../lib/recentOpened";
import { clearTasks, getTasksLoadedAt, isStale, setTasks } from "../lib/taskStore";

/**
 * docs/API.md yetki kısaltmaları:
 * U oturum açmış · V doğrulanmış · VV oy verebilir (doğrulanmış + reşit + siyasi görüş rızası)
 * R kayıt memuru · D denetçi · A yönetici · E etkin bilirkişi.
 * Yönetici (A) R ve D yetkilerini de kapsar. R, D, A ve E yalnızca DOĞRULANMIŞ hesapta geçerlidir (sunucudaki requireRole ve
 * requireExpert gibi): kayıt memuru onayını bekleyen bir üyeye rol verilmiş olsa bile menüde ve sayfalarda görev yetkisi görünmez.
 */
export type Permission = "U" | "V" | "VV" | "R" | "D" | "A" | "E";

export interface AuthContextValue {
  user: Me | null;
  token: string | null;
  /** İlk yükleme (belirteç okunuyor / /api/me bekleniyor) */
  loading: boolean;
  /** Son /api/system yanıtı (sürüm, simüle saat, YZ kipi, defter özeti…) */
  system: SystemInfo | null;
  /** Açılışta sunucuya ulaşılamadıysa (belirteç var ama kullanıcı yüklenemedi) */
  connectionError: ApiError | null;
  /** Oturum 401 ile sona erdiyse true (giriş yapılınca sıfırlanır) */
  sessionExpired: boolean;
  /** Okunmamış bildirim sayısı (60 sn'de bir yenilenir) */
  unread: number;
  // Bekleyen işler (GET /api/me/tasks) bağlamda değil lib/taskStore'dadır: 60 sn'lik yoklama bütün uygulamayı yeniden çizdirmesin.
  // Okuma: useTaskCount() (kabuk rozeti), useProposalExpectations(id) (öneri kartı).

  login(req: LoginRequest): Promise<Me>;
  register(input: RegistrationInput): Promise<Me>;
  logout(): Promise<void>;
  /** /api/me'yi yeniden yükler (oturum yoksa null) */
  refresh(): Promise<Me | null>;
  /** /api/system'i yeniden yükler; yönetici saati ileri aldıktan sonra çağırın */
  refreshSystem(): Promise<SystemInfo | null>;
  refreshUnread(): Promise<void>;
  /**
   * Bekleyen işleri yeniden yükler (lib/taskStore). `maxAgeMs` verilirse yalnız son yükleme o kadar eskiyse istek gider
   * (sayfa değişiminde kullanılır). Aynı anda tek istek; `maxAgeMs` olmadan (eylem sonrası) süren bir isteğe denk gelirse o istek
   * bitince bir kez daha sorulur. Oturum yoksa depo boşalır. Fırlatmaz.
   */
  refreshTasks(opts?: { maxAgeMs?: number }): Promise<void>;
  /** Sunucudan dönen güncel Me ile durumu günceller (ör. rıza değişikliği sonrası) */
  setUser(me: Me): void;

  /** Sunucunun simüle saatine göre düzeltilmiş "şimdi" (ms). Geri sayımlar bunu kullanır. */
  now(): number;
  can(perm: Permission): boolean;
  /** Hesapta bu rol var mı? Görev rolleri (kayıt memuru, denetçi, yönetici) yalnızca doğrulanmış hesapta sayılır; "member" her zaman. */
  hasRole(role: Role): boolean;
  isVerified: boolean;
  isVoter: boolean;
  /** Etkin bilirkişi (doğrulanmış hesapta) */
  isExpert: boolean;
  /** Doğrulanmış yönetici */
  isAdmin: boolean;
}

export type Permissions = Pick<AuthContextValue, "can" | "hasRole" | "isVerified" | "isVoter" | "isExpert" | "isAdmin">;

/** Görev rolleri: sunucuda requireRole bunları doğrulanmış hesaba bağlar. */
const DUTY_ROLES: readonly Role[] = ["registrar", "auditor", "admin"];

/**
 * Kullanıcının yetkileri (saf işlev; birim testli). Sunucudaki denetimlerin aynası: oy verme, görev rolleri ve bilirkişilik
 * hesap durumuna bağlıdır. Arayüzün can("R"/"D"/"A") denetimi bununla sunucudaki requireRole ile aynı sonucu verir; böylece
 * doğrulanmamış (bekleyen) bir hesapta görev menüsü görünüp sayfalar "Hesabınız etkin değil" hatası vermez.
 */
export function derivePermissions(user: Me | null): Permissions {
  const roles = user?.roles ?? [];
  const isVerified = user?.status === "verified";
  const hasRole = (r: Role) => roles.includes(r) && (isVerified || !DUTY_ROLES.includes(r));
  const isAdmin = hasRole("admin");
  const isVoter = !!user && isVerified && user.isAdult && user.politicalConsent;
  const isExpert = isVerified && !!user?.isExpert;
  const can = (p: Permission): boolean => {
    if (!user) return false;
    switch (p) {
      case "U":
        return true;
      case "V":
        return isVerified;
      case "VV":
        return isVoter;
      case "R":
        return isAdmin || hasRole("registrar");
      case "D":
        return isAdmin || hasRole("auditor");
      case "A":
        return isAdmin;
      case "E":
        return isExpert;
    }
  };
  return { can, hasRole, isVerified, isVoter, isExpert, isAdmin };
}

const AuthContext = createContext<AuthContextValue | null>(null);

const SYSTEM_REFRESH_MS = 30_000;
/** Okunmamış bildirimler ve bekleyen işler (lib/taskStore) aynı yoklamada yenilenir. */
const UNREAD_REFRESH_MS = 60_000;

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUserState] = useState<Me | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [system, setSystem] = useState<SystemInfo | null>(null);
  const [connectionError, setConnectionError] = useState<ApiError | null>(null);
  const [sessionExpired, setSessionExpired] = useState(false);
  const [unread, setUnread] = useState(0);
  // Sunucu saati simüle ve TIME_SCALE kat hızlı akar: now() = simAnchor + (Date.now() − realAnchor) × scale
  const clockRef = useRef<{ simAnchor: number; realAnchor: number; scale: number } | null>(null);
  const tokenRef = useRef<string | null>(null);
  const tasksInflight = useRef<Promise<void> | null>(null);
  // Süren istek bir eylemden önce başlamış olabilir: zorunlu yenileme (maxAgeMs yok) o sırada gelirse istek bitince bir kez daha sorulur.
  const tasksAgain = useRef(false);

  const applySession = useCallback(async (t: string | null, me: Me | null) => {
    tokenRef.current = t;
    // Oturum değişti: önceki kişinin bekleyen işleri hiçbir ekranda görünmesin (yeni liste refreshTasks ile gelir).
    tasksInflight.current = null;
    tasksAgain.current = false;
    clearTasks();
    setAuthToken(t);
    setToken(t);
    setUserState(me);
    setReceiptOwner(me?.id ?? null);
    setRecentOwner(me?.id ?? null);
    if (t) await setPref(PREF_KEYS.token, t);
    else await removePref(PREF_KEYS.token);
  }, []);

  const refreshSystem = useCallback(async (): Promise<SystemInfo | null> => {
    try {
      const t0 = Date.now();
      const s = await api.getSystem();
      const t1 = Date.now();
      clockRef.current = { simAnchor: s.now, realAnchor: Math.round((t0 + t1) / 2), scale: s.timeScale > 0 ? s.timeScale : 1 };
      setSystem(s);
      syncOntologyWithBylawVersion(s.bylawVersion); // yönetmelik sürümü değiştiyse ontoloji önbelleği bayatlamasın (bulgu #145)
      return s;
    } catch {
      return null;
    }
  }, []);

  const refreshUnread = useCallback(async () => {
    if (!tokenRef.current) {
      setUnread(0);
      return;
    }
    try {
      const n = await api.getNotifications({ unread: true });
      setUnread(n.unread);
    } catch {
      /* sessizce geç */
    }
  }, []);

  const refreshTasks = useCallback(async (opts?: { maxAgeMs?: number }): Promise<void> => {
    const t = tokenRef.current;
    if (!t) {
      clearTasks();
      return;
    }
    if (tasksInflight.current) {
      if (opts?.maxAgeMs === undefined) tasksAgain.current = true;
      return tasksInflight.current;
    }
    if (opts?.maxAgeMs !== undefined && !isStale(getTasksLoadedAt(), Date.now(), opts.maxAgeMs)) return;
    tasksAgain.current = false;
    // await Promise.resolve(): istek her zaman zaman uyumsuz başlar, böylece `finally` çalıştığında `run` atanmış olur.
    const run: Promise<void> = (async () => {
      await Promise.resolve();
      do {
        tasksAgain.current = false;
        try {
          const list = await api.getMyTasks();
          // Yanıt gelene kadar oturum kapandıysa ya da değiştiyse eski kişinin işleri yazılmaz.
          if (tokenRef.current === t) setTasks(list);
        } catch {
          /* sessizce geç: rozet bir sonraki yoklamada güncellenir */
        }
      } while (tasksAgain.current && tokenRef.current === t);
    })().finally(() => {
      if (tasksInflight.current === run) tasksInflight.current = null;
    });
    tasksInflight.current = run;
    return run;
  }, []);

  const refresh = useCallback(async (): Promise<Me | null> => {
    if (!tokenRef.current) {
      setUserState(null);
      return null;
    }
    try {
      const me = await api.getMe();
      setUserState(me);
      setReceiptOwner(me.id);
      setRecentOwner(me.id);
      setConnectionError(null);
      return me;
    } catch (e) {
      // Yalnızca 401 oturumu bitirir; 5xx / ulaşılamıyor / ağ hatasında belirteç korunur ve bağlantı sorunu gösterilir.
      if (isSessionRejected(e)) {
        await applySession(null, null);
        return null;
      }
      setConnectionError(toConnectionError(e));
      throw e;
    }
  }, [applySession]);

  // Açılış: belirteci oku, sistem bilgisini ve kullanıcıyı yükle.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const saved = await getPref(PREF_KEYS.token);
      if (cancelled) return;
      tokenRef.current = saved;
      setAuthToken(saved);
      setToken(saved);
      void refreshSystem();
      if (saved) {
        try {
          await refresh();
        } catch {
          /* 401 dışı hatada connectionError ayarlandı; belirteç korunur, oturum kapatılmaz */
        }
        void refreshUnread();
        void refreshTasks();
      }
      if (!cancelled) setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [refresh, refreshSystem, refreshUnread, refreshTasks]);

  // 401 olayı: oturumu temizle.
  useEffect(
    () =>
      onUnauthorized(() => {
        if (!tokenRef.current) return;
        setSessionExpired(true);
        setUnread(0);
        void applySession(null, null); // bekleyen işleri de boşaltır
      }),
    [applySession],
  );

  // Sunucu adresi oturum açıkken değişti: belirteç client'ta zaten unutuldu; yerel oturum da kapanır (yeni sunucuda yeniden giriş).
  useEffect(
    () =>
      onServerChange(() => {
        if (!tokenRef.current) return;
        setUnread(0);
        setSessionExpired(false);
        setConnectionError(null);
        void applySession(null, null);
      }),
    [applySession],
  );

  // Periyodik yenileme + sekmeye geri dönünce yenileme. Bekleyen işler okunmamış bildirimlerle aynı 60 sn'lik yoklamadadır;
  // böylece 'Ana sayfa' rozeti Ana sayfaya girilmeden de güncel kalır.
  useEffect(() => {
    const sys = window.setInterval(() => void refreshSystem(), SYSTEM_REFRESH_MS);
    const unr = window.setInterval(() => {
      void refreshUnread();
      void refreshTasks();
    }, UNREAD_REFRESH_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") {
        void refreshSystem();
        void refreshUnread();
        void refreshTasks();
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(sys);
      window.clearInterval(unr);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [refreshSystem, refreshUnread, refreshTasks]);

  const login = useCallback(
    async (req: LoginRequest) => {
      await applySession(null, null);
      const res = await api.login(req);
      await applySession(res.token, res.user);
      setSessionExpired(false);
      setConnectionError(null);
      void refreshUnread();
      void refreshTasks();
      void refreshSystem();
      return res.user;
    },
    [applySession, refreshSystem, refreshUnread, refreshTasks],
  );

  const register = useCallback(
    async (input: RegistrationInput) => {
      await applySession(null, null);
      const res = await api.register(input);
      await applySession(res.token, res.user);
      setSessionExpired(false);
      setConnectionError(null);
      return res.user;
    },
    [applySession],
  );

  const logout = useCallback(async () => {
    if (tokenRef.current) {
      try {
        await api.logout();
      } catch {
        /* sunucuya ulaşılamasa da yerelde çıkış yapılır */
      }
    }
    setUnread(0);
    setSessionExpired(false);
    // Kişisel sıralamanın cihazdaki geçici girdisi ("son açılanlar") çıkışta silinir (hesap silme de bu yoldan geçer).
    clearRecentOpened();
    await applySession(null, null); // bekleyen işleri de boşaltır
  }, [applySession]);

  const setUser = useCallback((me: Me) => setUserState(me), []);
  const now = useCallback(() => {
    const c = clockRef.current;
    return c ? Math.floor(c.simAnchor + (Date.now() - c.realAnchor) * c.scale) : Date.now();
  }, []);

  const value = useMemo<AuthContextValue>(() => {
    const perms = derivePermissions(user);
    return {
      user,
      token,
      loading,
      system,
      connectionError,
      sessionExpired,
      unread,
      login,
      register,
      logout,
      refresh,
      refreshSystem,
      refreshUnread,
      refreshTasks,
      setUser,
      now,
      ...perms,
    };
  }, [user, token, loading, system, connectionError, sessionExpired, unread, login, register, logout, refresh, refreshSystem, refreshUnread, refreshTasks, setUser, now]);

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

/** Oturum bağlamı. AuthProvider dışında kullanılırsa hata fırlatır. */
export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth() yalnızca <AuthProvider> içinde kullanılabilir.");
  return ctx;
}

/** Sağlayıcı yoksa da çalışan saat (ui bileşenleri için): sunucu saati ya da istemci saati. */
export function useServerNow(): () => number {
  const ctx = useContext(AuthContext);
  return ctx?.now ?? Date.now;
}
