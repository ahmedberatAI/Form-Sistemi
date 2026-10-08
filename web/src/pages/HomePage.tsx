// Ana sayfa: role göre "senden beklenenler". Bu dosya yalnız veriyi bağlar (oturum, pano, cihazdaki makbuz sayısı, ekran
// genişliği); düzen ve sıra components/home/HomeLayout'tadır. Hesap durumu (bekleyen, askıda, reddedilmiş) yalnız burada kartla
// söylenir; kabuktaki şeritler bu rotada gizlenir (layout/AppLayout). Pano her geldiğinde görev deposu (lib/taskStore) onunla
// eşitlenir: 'Sizi bekleyenler' listesi ile kabuktaki 'Ana sayfa' sayı rozeti aynı sunucu kuralını (community.tasks) okur ve
// birbirleriyle çelişmez.
import { useEffect, useState } from "react";
import { getDashboard } from "../api/endpoints";
import { useAuth } from "../auth/AuthContext";
import { HomeLayout } from "../components/home/HomeLayout";
import { listReceipts } from "../lib/receipts";
import { getRecentOpened } from "../lib/recentOpened";
import { setTasks } from "../lib/taskStore";
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
  // Oturum yüklenmeden pano istenmez: önce ziyaretçi verisi gelip sonra üyeninkiyle değişmesin. Üyede 'Şu an açık' kişisel sıraya
  // girebilir: bu cihazdaki son açılanlar (lib/recentOpened; en çok 20 öneri kimliği) her istekte geçici girdi olarak gider.
  const dashboard = useAsync(() => getDashboard(userId ? getRecentOpened() : undefined), [userId], { pollMs: 30_000, enabled: !auth.loading });
  const receipts = useAsync(() => listReceipts(), [userId], { enabled: !auth.loading && !!userId });
  const wide = useWideScreen();

  // Yalnız yeni pano gelince çalışır (oturum değişince eski pano yeniden yazılmaz: useAsync eski kişinin geç yanıtını atar,
  // AuthProvider de depoyu boşaltır). Ziyaretçi panosunda görev olmaz; depo oturumsuzken zaten boştur.
  const data = dashboard.data;
  useEffect(() => {
    if (data && userId) setTasks(data.tasks);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [data]);

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
