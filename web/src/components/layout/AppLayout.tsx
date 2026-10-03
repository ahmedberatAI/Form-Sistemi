// Uygulama iskeleti: üst çubuk (logo, bildirimler, kullanıcı menüsü), masaüstünde grup ayraçlı üst gezinme,
// mobilde alt gezinme + "Daha fazla" sayfası (en altında "Sistem durumu"), genel uyarı şeritleri ve alt bilgi.
import { Fragment, useEffect, useId, useRef, useState, type ReactNode } from "react";
import { Link, NavLink, useLocation, useNavigate } from "react-router-dom";
import { SURUM, type SystemInfo } from "@forum/shared";
import { useAuth } from "../../auth/AuthContext";
import { formatDateTime } from "../../lib/format";
import { useNow } from "../../lib/hooks";
import { Alert, Button, cx, DropdownMenu, Icon, Modal } from "../../ui";
import { GROUP_LABELS, systemRows, topNavSections, visibleItems, type NavItem } from "./nav";

function UnreadBadge({ n }: { n: number }) {
  if (n <= 0) return null;
  return (
    <span className="count-badge" aria-hidden="true">
      {n > 99 ? "99+" : n}
    </span>
  );
}

function Brand() {
  return (
    <Link to="/" className="brand" aria-label="Forum Sistemi — ana sayfa">
      <span className="brand-mark" aria-hidden="true">
        FS
      </span>
      <span className="brand-name">Forum Sistemi</span>
    </Link>
  );
}

/**
 * "Daha fazla" sayfasının en altındaki "Sistem durumu": masaüstü alt bilgisinin mobildeki karşılığı, her sayfadan bir dokunuşla.
 * Veri auth.system'den gelir (AuthProvider 30 sn'de bir yeniler); saniyelik saat yalnız bu bloğu yeniden çizer.
 */
export function SystemStatus({ system, onNavigate, onRetry }: { system: SystemInfo | null; onNavigate?: () => void; onRetry?: () => void }) {
  const titleId = useId();
  const now = useNow(1000);
  const rows = systemRows(system, now, SURUM);
  return (
    <section className="more-system" aria-labelledby={titleId}>
      <h3 className="more-group-title" id={titleId}>
        Sistem durumu
      </h3>
      {system ? null : (
        <div className="more-system-empty" role="status">
          <span>Sistem bilgisi alınamadı.</span>
          {onRetry ? (
            <Button size="sm" variant="ghost" icon="refresh" onClick={onRetry}>
              Yenile
            </Button>
          ) : null}
        </div>
      )}
      <dl className="more-system-list">
        {rows.map((r) => (
          <div key={r.key} className={cx("more-system-row", r.warning && "is-warn")}>
            <dt>{r.label}</dt>
            <dd>
              {r.to ? (
                <Link className="more-system-link" to={r.to} onClick={onNavigate}>
                  <span>{r.value}</span>
                  <Icon name="chevronRight" size={14} />
                </Link>
              ) : (
                r.value
              )}
              {r.warning ? (
                <span className="more-system-warn">
                  <span aria-hidden="true">⚠ </span>
                  <span className="sr-only">Uyarı: </span>
                  {r.warning}
                </span>
              ) : null}
            </dd>
          </div>
        ))}
      </dl>
    </section>
  );
}

function MoreSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const auth = useAuth();
  const navigate = useNavigate();
  const items = visibleItems(auth).filter((i) => !i.bottom);
  const groups = (["explore", "duty", "account"] as const).map((g) => ({ g, items: items.filter((i) => i.group === g) })).filter((x) => x.items.length);
  return (
    <Modal open={open} onClose={onClose} title="Daha fazla" sheet size="sm">
      <nav aria-label="Diğer sayfalar" className="more-nav">
        {groups.map(({ g, items }) => (
          <div key={g} className="more-group">
            <h3 className="more-group-title">{GROUP_LABELS[g]}</h3>
            <ul>
              {items.map((i) => (
                <li key={i.to}>
                  <NavLink to={i.to} className="more-link" onClick={onClose}>
                    <Icon name={i.icon} size={18} />
                    <span>{i.label}</span>
                    {i.to === "/bildirimler" ? <UnreadBadge n={auth.unread} /> : null}
                  </NavLink>
                </li>
              ))}
            </ul>
          </div>
        ))}
        <div className="more-group">
          {auth.user ? (
            <Button
              block
              variant="ghost"
              icon="logout"
              onClick={async () => {
                onClose();
                await auth.logout();
                navigate("/");
              }}
            >
              Çıkış yap (@{auth.user.nickname})
            </Button>
          ) : (
            <div className="row">
              <Link className="btn btn-primary" to="/giris" onClick={onClose}>
                Giriş yap
              </Link>
              <Link className="btn btn-secondary" to="/kayit" onClick={onClose}>
                Kayıt ol
              </Link>
            </div>
          )}
        </div>
      </nav>
      <SystemStatus system={auth.system} onNavigate={onClose} onRetry={() => void auth.refreshSystem()} />
    </Modal>
  );
}

function NavLinkItem({ item, unread }: { item: NavItem; unread: number }) {
  return (
    <NavLink to={item.to} end={item.end} className={({ isActive }) => cx("nav-link", isActive && "nav-link-active")}>
      <Icon name={item.icon} size={16} />
      <span>{item.label}</span>
      {item.to === "/bildirimler" ? <UnreadBadge n={unread} /> : null}
    </NavLink>
  );
}

export function AppLayout({ children }: { children: ReactNode }) {
  const auth = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [moreOpen, setMoreOpen] = useState(false);
  const mainRef = useRef<HTMLElement>(null);
  const firstRender = useRef(true);
  const [dismissExpired, setDismissExpired] = useState(false);

  // Sayfa değişince başa kaydır ve odağı içeriğe taşı (ekran okuyucular için).
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    window.scrollTo(0, 0);
    mainRef.current?.focus({ preventScroll: true });
  }, [location.pathname]);

  useEffect(() => {
    if (auth.sessionExpired) setDismissExpired(false);
  }, [auth.sessionExpired]);

  const items = visibleItems(auth);
  // Görev sayfaları (kayıt memuru, yönetim) masaüstünde kullanıcı menüsünde, mobilde "Daha fazla"da.
  // Üst gezinme iki gruptur (Katılım | Keşfet ve doğrula); araya görsel ayraç girer.
  const topSections = topNavSections(items);
  const bottomItems = items.filter((i) => i.bottom);
  const user = auth.user;
  const sys = auth.system;
  // Ana sayfa hesap durumunu (bekleyen, askıda, reddedilmiş) kendi kartında söyler; çift mesaj olmasın diye şeritler yalnız '/' rotasında gizlenir.
  const onHome = location.pathname === "/";

  return (
    <div className="app">
      <a className="skip-link" href="#main" onClick={(e) => (e.preventDefault(), mainRef.current?.focus())}>
        İçeriğe geç
      </a>
      <header className="app-header">
        <div className="app-header-inner">
          <Brand />
          <div className="header-actions">
            {user ? (
              <>
                <Link to="/bildirimler" className="icon-btn header-bell" aria-label={auth.unread ? `Bildirimler (${auth.unread} okunmamış)` : "Bildirimler"}>
                  <Icon name="bell" size={20} />
                  <UnreadBadge n={auth.unread} />
                </Link>
                <DropdownMenu
                  ariaLabel={`Kullanıcı menüsü: @${user.nickname}`}
                  buttonClassName="user-menu-button"
                  label={
                    <>
                      <Icon name="user" size={18} />
                      <span className="user-menu-name">@{user.nickname}</span>
                    </>
                  }
                  items={[
                    { label: "Profil", to: "/profil", icon: "user" },
                    { label: "Bildirimler", to: "/bildirimler", icon: "bell", badge: <UnreadBadge n={auth.unread} /> },
                    auth.can("R") || auth.can("D") ? { label: "Kayıt memuru", to: "/kayit-memuru", icon: "registrar" } : null,
                    auth.can("A") || auth.can("D") ? { label: "Yönetim", to: "/yonetim", icon: "admin" } : null,
                    { label: "Ayarlar", to: "/ayarlar", icon: "settings" },
                    "divider",
                    {
                      label: "Çıkış yap",
                      icon: "logout",
                      danger: true,
                      onClick: async () => {
                        await auth.logout();
                        navigate("/");
                      },
                    },
                  ]}
                />
              </>
            ) : (
              <>
                <Link to="/ayarlar" className="icon-btn hide-mobile" aria-label="Ayarlar">
                  <Icon name="settings" size={20} />
                </Link>
                <Link to="/kayit" className="btn btn-ghost btn-sm hide-mobile">
                  Kayıt ol
                </Link>
                <Link to="/giris" className="btn btn-primary btn-sm">
                  <Icon name="login" size={16} /> Giriş yap
                </Link>
              </>
            )}
          </div>
        </div>
        <nav className="app-nav" aria-label="Ana gezinme">
          <div className="app-nav-inner">
            {topSections.map((section, n) => (
              <Fragment key={section[0].group}>
                {n > 0 ? <span className="nav-divider" aria-hidden="true" /> : null}
                {section.map((i) => (
                  <NavLinkItem key={i.to} item={i} unread={auth.unread} />
                ))}
              </Fragment>
            ))}
          </div>
        </nav>
      </header>

      <div className="app-banners">
        {auth.sessionExpired && !user && !dismissExpired ? (
          <Alert
            tone="warning"
            title="Oturumunuz sona erdi"
            onClose={() => setDismissExpired(true)}
            actions={
              <Link className="btn btn-primary btn-sm" to="/giris" state={{ from: location.pathname }}>
                Yeniden giriş yap
              </Link>
            }
          >
            Güvenliğiniz için oturumunuz kapatıldı.
          </Alert>
        ) : null}
        {auth.connectionError && !user ? (
          <Alert
            tone="error"
            title="Sunucuya ulaşılamıyor"
            actions={
              <>
                <Button size="sm" icon="refresh" onClick={() => void auth.refresh().catch(() => undefined)}>
                  Tekrar dene
                </Button>
                <Link className="btn btn-ghost btn-sm" to="/ayarlar">
                  Sunucu ayarları
                </Link>
              </>
            }
          >
            {auth.connectionError.message}
          </Alert>
        ) : null}
        {user?.status === "pending" && !onHome ? (
          <Alert tone="info" title="Hesabınız kayıt memuru onayı bekliyor">
            Onaylanana kadar içerikleri okuyabilir, öneri ve oy işlemlerini ise doğrulamadan sonra yapabilirsiniz.
          </Alert>
        ) : null}
        {user && (user.status === "suspended" || user.status === "rejected") && !onHome ? (
          <Alert tone="warning" title={user.status === "suspended" ? "Hesabınız askıya alındı" : "Kaydınız reddedildi"}>
            Ayrıntı için kayıt memuruyla iletişime geçin.
          </Alert>
        ) : null}
      </div>

      <main id="main" className="app-main" ref={mainRef} tabIndex={-1}>
        {children}
      </main>

      <footer className="app-footer">
        <div className="app-footer-inner">
          <span>Forum Sistemi · istemci v{SURUM}</span>
          {sys ? (
            <>
              <span title="Tüm süreler sunucunun simüle saatine göredir">Sunucu saati: {formatDateTime(sys.now, true)}</span>
              <span>YZ: {sys.aiMode === "claude" ? sys.aiModel : "çevrimdışı sezgisel mod"}</span>
              <span>
                Defter: blok {sys.ledger.height} · {sys.ledger.healthy}/{sys.ledger.validators} doğrulayıcı sağlıklı
              </span>
            </>
          ) : null}
        </div>
      </footer>

      <nav className="bottom-nav" aria-label="Alt gezinme">
        {bottomItems.map((i) => (
          <NavLink key={i.to} to={i.to} end={i.end} className={({ isActive }) => cx("bottom-link", isActive && "bottom-link-active")}>
            <Icon name={i.icon} size={22} />
            <span>{i.short ?? i.label}</span>
          </NavLink>
        ))}
        <button type="button" className={cx("bottom-link", moreOpen && "bottom-link-active")} onClick={() => setMoreOpen(true)} aria-haspopup="dialog">
          <span className="bottom-icon-wrap">
            <Icon name="menu" size={22} />
            <UnreadBadge n={auth.unread} />
          </span>
          <span>Daha fazla</span>
        </button>
      </nav>
      <MoreSheet open={moreOpen} onClose={() => setMoreOpen(false)} />
    </div>
  );
}
