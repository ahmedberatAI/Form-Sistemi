// Gezinme öğeleri (üst gezinme, alt gezinme ve "Daha fazla" menüsü aynı listeden beslenir).
import type { AuthContextValue } from "../../auth/AuthContext";
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
