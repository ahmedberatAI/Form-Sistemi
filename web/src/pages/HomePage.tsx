// Ana sayfa: role göre "senden beklenenler". Bu dosya yalnız veriyi bağlar (oturum, pano, cihazdaki makbuz sayısı, ekran
// genişliği); düzen ve sıra components/home/HomeLayout'tadır. Hesap durumu (bekleyen, askıda, reddedilmiş) yalnız burada kartla
// söylenir; kabuktaki şeritler bu rotada gizlenir (layout/AppLayout).
import { useEffect, useState } from "react";
import { getDashboard } from "../api/endpoints";
import { useAuth } from "../auth/AuthContext";
import { HomeLayout } from "../components/home/HomeLayout";
import { listReceipts } from "../lib/receipts";
import { useAsync } from "../lib/useAsync";

/** Masaüstü düzeninin eşiği (styles.css .split ile aynı). */
const WIDE_QUERY = "(min-width: 900px)";

function useWideScreen(): boolean {
  const [wide, setWide] = useState(() => typeof window !== "undefined" && !!window.matchMedia?.(WIDE_QUERY).matches);
  useEffect(() => {
    const mq = window.matchMedia?.(WIDE_QUERY);
    if (!mq) return;
    const update = () => setWide(mq.matches);
    update();
    mq.addEventListener?.("change", update);
    return () => mq.removeEventListener?.("change", update);
  }, []);
  return wide;
}

export default function HomePage() {
  const auth = useAuth();
  const userId = auth.user?.id;
  // Oturum yüklenmeden pano istenmez: önce ziyaretçi verisi gelip sonra üyeninkiyle değişmesin.
  const dashboard = useAsync(() => getDashboard(), [userId], { pollMs: 30_000, enabled: !auth.loading });
  const receipts = useAsync(() => listReceipts(), [userId], { enabled: !auth.loading && !!userId });
  const wide = useWideScreen();

  return (
    <HomeLayout
      authLoading={auth.loading}
      user={auth.user}
      can={auth.can}
      system={auth.system}
      data={dashboard.data}
      dataLoading={dashboard.loading}
      dataError={dashboard.error}
      onReload={() => void dashboard.reload()}
      onRetrySystem={() => void auth.refreshSystem()}
      receipts={receipts.data?.length ?? null}
      wide={wide}
    />
  );
}
