// Oturum, kullanıcı, yetki yardımcıları ve sunucu saati (simüle) senkronu.
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from "react";
import type { LoginRequest, Me, RegistrationInput, Role, SystemInfo } from "@forum/shared";
import { ApiError, onUnauthorized, setAuthToken } from "../api/client";
import * as api from "../api/endpoints";
import { getPref, PREF_KEYS, removePref, setPref } from "../lib/prefs";
import { setReceiptOwner } from "../lib/receipts";

/**
 * docs/API.md yetki kısaltmaları:
 * U oturum açmış · V doğrulanmış · VV oy verebilir (doğrulanmış + reşit + siyasi görüş rızası)
 * R kayıt memuru · D denetçi · A yönetici · E etkin bilirkişi.
 * Yönetici (A) R ve D yetkilerini de kapsar; E yalnızca bilirkişi durumuna bağlıdır.
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

  login(req: LoginRequest): Promise<Me>;
  register(input: RegistrationInput): Promise<Me>;
  logout(): Promise<void>;
  /** /api/me'yi yeniden yükler (oturum yoksa null) */
  refresh(): Promise<Me | null>;
  /** /api/system'i yeniden yükler; yönetici saati ileri aldıktan sonra çağırın */
  refreshSystem(): Promise<SystemInfo | null>;
  refreshUnread(): Promise<void>;
  /** Sunucudan dönen güncel Me ile durumu günceller (ör. rıza değişikliği sonrası) */
  setUser(me: Me): void;

  /** Sunucunun simüle saatine göre düzeltilmiş "şimdi" (ms). Geri sayımlar bunu kullanır. */
  now(): number;
  can(perm: Permission): boolean;
  hasRole(role: Role): boolean;
  isVerified: boolean;
  isVoter: boolean;
  isExpert: boolean;
  isAdmin: boolean;
}

const AuthContext = createContext<AuthContextValue | null>(null);

const SYSTEM_REFRESH_MS = 30_000;
const UNREAD_REFRESH_MS = 60_000;

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUserState] = useState<Me | null>(null);
  const [token, setToken] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [system, setSystem] = useState<SystemInfo | null>(null);
  const [connectionError, setConnectionError] = useState<ApiError | null>(null);
  const [sessionExpired, setSessionExpired] = useState(false);
  const [unread, setUnread] = useState(0);
  const offsetRef = useRef(0);
  const tokenRef = useRef<string | null>(null);

  const applySession = useCallback(async (t: string | null, me: Me | null) => {
    tokenRef.current = t;
    setAuthToken(t);
    setToken(t);
    setUserState(me);
    setReceiptOwner(me?.id ?? null);
    if (t) await setPref(PREF_KEYS.token, t);
    else await removePref(PREF_KEYS.token);
  }, []);

  const refreshSystem = useCallback(async (): Promise<SystemInfo | null> => {
    try {
      const t0 = Date.now();
      const s = await api.getSystem();
      const t1 = Date.now();
      offsetRef.current = s.now - Math.round((t0 + t1) / 2);
      setSystem(s);
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

  const refresh = useCallback(async (): Promise<Me | null> => {
    if (!tokenRef.current) {
      setUserState(null);
      return null;
    }
    try {
      const me = await api.getMe();
      setUserState(me);
      setReceiptOwner(me.id);
      setConnectionError(null);
      return me;
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) {
        await applySession(null, null);
        return null;
      }
      if (e instanceof ApiError && e.isNetwork) setConnectionError(e);
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
          /* connectionError ayarlandı */
        }
        void refreshUnread();
      }
      if (!cancelled) setLoading(false);
    })();
    return () => {
      cancelled = true;
    };
  }, [refresh, refreshSystem, refreshUnread]);

  // 401 olayı: oturumu temizle.
  useEffect(
    () =>
      onUnauthorized(() => {
        if (!tokenRef.current) return;
        setSessionExpired(true);
        setUnread(0);
        void applySession(null, null);
      }),
    [applySession],
  );

  // Periyodik yenileme + sekmeye geri dönünce yenileme.
  useEffect(() => {
    const sys = window.setInterval(() => void refreshSystem(), SYSTEM_REFRESH_MS);
    const unr = window.setInterval(() => void refreshUnread(), UNREAD_REFRESH_MS);
    const onVisible = () => {
      if (document.visibilityState === "visible") {
        void refreshSystem();
        void refreshUnread();
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      window.clearInterval(sys);
      window.clearInterval(unr);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [refreshSystem, refreshUnread]);

  const login = useCallback(
    async (req: LoginRequest) => {
      await applySession(null, null);
      const res = await api.login(req);
      await applySession(res.token, res.user);
      setSessionExpired(false);
      setConnectionError(null);
      void refreshUnread();
      void refreshSystem();
      return res.user;
    },
    [applySession, refreshSystem, refreshUnread],
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
    await applySession(null, null);
  }, [applySession]);

  const setUser = useCallback((me: Me) => setUserState(me), []);
  const now = useCallback(() => Date.now() + offsetRef.current, []);

  const value = useMemo<AuthContextValue>(() => {
    const roles = user?.roles ?? [];
    const hasRole = (r: Role) => roles.includes(r);
    const isAdmin = hasRole("admin");
    const isVerified = user?.status === "verified";
    const isVoter = !!user && isVerified && user.isAdult && user.politicalConsent;
    const isExpert = !!user?.isExpert;
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
      setUser,
      now,
      can,
      hasRole,
      isVerified,
      isVoter,
      isExpert,
      isAdmin,
    };
  }, [user, token, loading, system, connectionError, sessionExpired, unread, login, register, logout, refresh, refreshSystem, refreshUnread, setUser, now]);

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
