// Gezinme öğeleri (üst gezinme, alt gezinme ve "Daha fazla" menüsü aynı listeden beslenir), masaüstü üst gezinmenin
// grup sırası ve "Daha fazla" sayfasındaki "Sistem durumu" bloğunun saf biçimlendirmesi (görünümden ayrı, birim testli).
// 'Keşfet ve doğrula' sayfası (/kesfet) bir gezinme öğesi DEĞİLDİR (topNav: false): üst gezinme 8 öğe kalır; sayfaya Ana sayfa
// vitrininden ('Gösterim rehberi'), masaüstü alt bilgisinden ve mobil 'Daha fazla' sayfasının 'Keşfet ve doğrula' grubundan gidilir.
import type { SystemInfo } from "@forum/shared";
import type { AuthContextValue } from "../../auth/AuthContext";
import { formatDateTime, formatDuration, formatNumber } from "../../lib/format";
import { routes } from "../../lib/routes";
import type { IconName } from "../../ui/Icon";

export interface NavItem {
  to: string;
  label: string;
  /** Alt gezinmedeki kısa etiket */
  short?: string;
  icon: IconName;
  /** Yalnızca tam eşleşmede etkin (ana sayfa) */
  end?: boolean;
  group: "main" | "explore" | "duty" | "account";
  /** Mobil alt gezinmede gösterilsin mi */
  bottom?: boolean;
  /** false → masaüstü üst gezinmede yok (yalnız 'Daha fazla' sayfasında ve sayfa içi bağlantılarda) */
  topNav?: boolean;
  visible?: (a: AuthContextValue) => boolean;
}

export const NAV_ITEMS: NavItem[] = [
  { to: "/", label: "Ana sayfa", short: "Ana sayfa", icon: "home", end: true, group: "main", bottom: true },
  { to: "/konular", label: "Konular", icon: "topics", group: "main", bottom: true },
  { to: "/oneriler", label: "Öneriler", icon: "proposals", group: "main", bottom: true },
  { to: "/oy-dogrula", label: "Oyum kayıtlı mı?", short: "Oy doğrula", icon: "verify", group: "main", bottom: true },
  { to: "/bilirkisiler", label: "Bilirkişiler", icon: "experts", group: "explore" },
  { to: "/graf", label: "Graf", icon: "graph", group: "explore" },
  { to: "/defter", label: "Defter", icon: "ledger", group: "explore" },
  { to: "/yonetmelik", label: "Yönetmelik", icon: "book", group: "explore" },
  // Gösterim rehberi ve sözlük: grubun SONUNDA durur (üst gezinmedeki 4+4 öğe ve sıraları değişmez).
  { to: routes.kesfet(), label: "Gösterim rehberi ve sözlük", icon: "info", group: "explore", topNav: false },
  { to: "/kayit-memuru", label: "Kayıt memuru", icon: "registrar", group: "duty", visible: (a) => a.can("R") || a.can("D") },
  { to: "/yonetim", label: "Yönetim", icon: "admin", group: "duty", visible: (a) => a.can("A") || a.can("D") },
  { to: "/profil", label: "Profil", icon: "user", group: "account", visible: (a) => !!a.user },
  { to: "/bildirimler", label: "Bildirimler", icon: "bell", group: "account", visible: (a) => !!a.user },
  { to: "/ayarlar", label: "Ayarlar", icon: "settings", group: "account" },
];

export const GROUP_LABELS: Record<NavItem["group"], string> = {
  main: "Katılım",
  explore: "Keşfet ve doğrula",
  duty: "Görevler",
  account: "Hesap",
};

export function visibleItems(a: AuthContextValue): NavItem[] {
  return NAV_ITEMS.filter((i) => !i.visible || i.visible(a));
}

/** Masaüstü üst gezinmede görünen gruplar, soldan sağa. Görev ve hesap öğeleri kullanıcı menüsünde ve "Daha fazla"dadır. */
export const TOP_NAV_GROUPS: ReadonlyArray<NavItem["group"]> = ["main", "explore"];

/**
 * Üst gezinme öğelerini grup grup verir (boş gruplar ve `topNav: false` öğeler atılır); gruplar arasına görsel ayraç çizilir.
 * Öğelerin hiçbiri kalkmaz, etiketleri değişmez; yalnız araya çizgi girer.
 */
export function topNavSections(items: NavItem[]): NavItem[][] {
  return TOP_NAV_GROUPS.map((g) => items.filter((i) => i.group === g && i.topNav !== false)).filter((s) => s.length > 0);
}

// ───────────── "Daha fazla" sayfası: Sistem durumu bloğu ─────────────

/**
 * Zaman ölçeği metni; Ana sayfa vitrinindeki söz dizimiyle aynıdır (components/home/ShowcaseTiles.scaleText):
 * 1 → "gerçek zamanlı", 10 → "demo: 1 saat = 6 dakika".
 */
export function scaleLabel(scale: number): string {
  if (!scale || scale === 1) return "gerçek zamanlı";
  const sec = 3600 / scale;
  const fmt = (n: number) => (Number.isInteger(n) ? String(n) : formatNumber(n, 1));
  return sec >= 60 ? `demo: 1 saat = ${fmt(sec / 60)} dakika` : `demo: 1 saat = ${fmt(sec)} saniye`;
}

export interface SystemRow {
  key: "defter" | "yz" | "saat" | "yonetmelik" | "istemci";
  label: string;
  value: string;
  /** Verilirse değer bu rotaya bağlantıdır */
  to?: string;
  /** Verilirse satır uyarı renginde çizilir ve bu metin değerin altına eklenir */
  warning?: string;
}

/**
 * "Sistem durumu" satırları, masaüstü alt bilgisinin ve Ana sayfa vitrininin mobildeki karşılığı:
 * defter (yükseklik ve doğrulayıcı sağlığı), YZ kipi, simüle saat ve ölçek, yönetmelik sürümü, istemci sürümü.
 * Sistem bilgisi yoksa (sunucuya ulaşılamadı) yalnız istemci sürümü kalır. `now`, sunucunun simüle saatidir (ms).
 */
export function systemRows(sys: SystemInfo | null, now: number, clientVersion: string): SystemRow[] {
  const client: SystemRow = { key: "istemci", label: "İstemci sürümü", value: `v${clientVersion}` };
  if (!sys) return [client];
  const { ledger } = sys;
  const unhealthy = Math.max(0, ledger.validators - ledger.healthy);
  const offset = sys.clockOffsetMs > 0 ? `; yönetici ${formatDuration(sys.clockOffsetMs, false)} ileri aldı` : "";
  return [
    {
      key: "defter",
      label: "Defter",
      value: `${formatNumber(ledger.height)}. blok · ${ledger.healthy}/${ledger.validators} doğrulayıcı sağlıklı`,
      to: routes.ledger(),
      warning: unhealthy > 0 ? `${unhealthy} doğrulayıcı sağlıksız` : undefined,
    },
    { key: "yz", label: "YZ kipi", value: sys.aiMode === "claude" ? `Claude (${sys.aiModel})` : "Çevrimdışı sezgisel mod" },
    { key: "saat", label: "Simüle saat", value: `${formatDateTime(now, true)} (${scaleLabel(sys.timeScale)}${offset})` },
    { key: "yonetmelik", label: "Yönetmelik sürümü", value: `v${sys.bylawVersion}` },
    client,
  ];
}
