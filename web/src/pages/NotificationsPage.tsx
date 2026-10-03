// Bildirimler: tür sınıfı (ikon + ekran okuyucu metni), 'Bugün / Bu hafta / Daha eski' grupları, satırın tamamı bağlantı
// (tıklayınca okundu işaretler) ve satır başına tek düğme ('Okundu işaretle: <başlık>'). Okunmamış bildirim varsa sayfa
// 'Okunmamış' süzgeciyle açılır. Mantık lib/notificationKinds.ts'te (saf, birim testli). Bkz. docs/ARAYUZ_PLANI.md (Faz 3 / madde 6).
// Bildirim metinleri sunucuda çözülür ({{uye:…}} belirteçleri); burada olduğu gibi gösterilir.
import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import type { Notification } from "@forum/shared";
import { getNotifications, markNotificationsRead } from "../api/endpoints";
import { useAuth } from "../auth/AuthContext";
import { useNow } from "../lib/hooks";
import {
  classifyKind,
  defaultFilter,
  filterNotifications,
  focusCandidates,
  groupByAge,
  markReadLocally,
  readButtonLabel,
  type NotificationFilter,
  type NotificationGroup,
} from "../lib/notificationKinds";
import { toAppPath } from "../lib/routes";
import { useAction, useAsync } from "../lib/useAsync";
import { Badge, Button, cx, EmptyState, ErrorView, Icon, PageHeader, Spinner, Tabs, Time } from "../ui";
import "./notifications.css";

export interface NotificationRowProps {
  n: Notification;
  /** Bu satırın okundu isteği sürüyor */
  busy?: boolean;
  /** Satır bağlantısına tıklandı (okunmamışsa okundu işaretlenir) */
  onOpen: (n: Notification) => void;
  onMarkRead: (n: Notification) => void;
}

/**
 * Tek bildirim satırı. Satırın tamamı (ikon, başlık, gövde, zaman) bir bağlantıdır; bağlantısı olmayan bildirimde düz
 * kutudur. Bağlantının içine düğme konamayacağı için 'Okundu işaretle' simge düğmesi bağlantının YANINDA durur.
 */
export function NotificationRow({ n, busy = false, onOpen, onMarkRead }: NotificationRowProps) {
  const cls = classifyKind(n.kind);
  const target = toAppPath(n.link);
  const external = target !== null && "external" in target;
  const content = (
    <>
      <span className={cx("notif-icon", `notif-tone-${cls.tone}`)} title={cls.label} aria-hidden="true">
        <Icon name={cls.icon} size={18} />
      </span>
      <span className="notif-main">
        <span className="notif-head">
          {target ? <span className="sr-only">Git: </span> : null}
          {!n.read ? <Badge tone="info">Yeni</Badge> : <span className="sr-only">Okundu.</span>}
          <span className="sr-only">{cls.label}.</span>
          <span className="notif-title">{n.title}</span>
        </span>
        {n.body ? <span className="notif-body">{n.body}</span> : null}
        <Time at={n.createdAt} mode="both" className="small muted" />
      </span>
      {target ? <Icon name={external ? "external" : "chevronRight"} size={16} className="notif-go" /> : null}
      {external ? <span className="sr-only"> (yeni sekmede açılır)</span> : null}
    </>
  );
  return (
    <li className={cx("list-item notif notif-row", `notif-${cls.id}`, !n.read && "notif-unread")} data-notif-id={n.id} data-kind={n.kind}>
      {target && "path" in target ? (
        <Link className="notif-content" to={target.path} onClick={() => onOpen(n)}>
          {content}
        </Link>
      ) : target ? (
        <a className="notif-content" href={target.external} target="_blank" rel="noopener noreferrer" onClick={() => onOpen(n)}>
          {content}
        </a>
      ) : (
        <div className="notif-content">{content}</div>
      )}
      {!n.read ? (
        <button
          type="button"
          className="icon-btn notif-read"
          aria-label={readButtonLabel(n.title)}
          aria-busy={busy || undefined}
          title="Okundu işaretle"
          onClick={() => onMarkRead(n)}
        >
          {busy ? <span className="spinner spinner-sm" aria-hidden="true" /> : <Icon name="check" size={18} />}
        </button>
      ) : null}
    </li>
  );
}

export interface NotificationGroupsProps {
  groups: NotificationGroup<Notification>[];
  busyId?: string | null;
  onOpen: (n: Notification) => void;
  onMarkRead: (n: Notification) => void;
}

/** Tarih gruplarını h2 başlığı + liste olarak çizer (sekme listesi DEĞİLDİR: ilk main tablist 'Bildirim filtresi' kalır). */
export function NotificationGroups({ groups, busyId = null, onOpen, onMarkRead }: NotificationGroupsProps) {
  return (
    <>
      {groups.map((g) => (
        <div key={g.id} className="notif-group">
          <h2 id={`notif-grup-${g.id}`} className="notif-group-title">
            {g.label}
          </h2>
          <ul className="list notif-list" aria-labelledby={`notif-grup-${g.id}`}>
            {g.items.map((n) => (
              <NotificationRow key={n.id} n={n} busy={busyId === n.id} onOpen={onOpen} onMarkRead={onMarkRead} />
            ))}
          </ul>
        </div>
      ))}
    </>
  );
}

export default function NotificationsPage() {
  const auth = useAuth();
  const now = useNow(60_000);
  const { data, error, loading, reload, setData } = useAsync(() => getNotifications(), [], { pollMs: 60_000 });
  // Seçili süzgeç ilk veri geldiğinde BİR KEZ belirlenir (okunmamış varsa 'Okunmamış'); sonraki 60 sn'lik yoklamalar
  // kullanıcının seçimini değiştirmez. Çizim sırasında durum ayarlamak React'in desteklediği türetilmiş durum kalıbıdır.
  const [picked, setPicked] = useState<NotificationFilter | null>(null);
  if (picked === null && data) setPicked(defaultFilter(data));
  const filter: NotificationFilter = picked ?? "all";
  const [busyId, setBusyId] = useState<string | null>(null);

  // Odak yönetimi: 'Okundu işaretle' düğmesi (ve süzgeç 'Okunmamış' iken satırın kendisi) kalkınca odak sayfa başına düşmesin.
  const bodyRef = useRef<HTMLDivElement>(null);
  const orderRef = useRef<string[]>([]);
  const focusNext = useRef<string[] | null>(null);

  const applyRead = (ids: string[] | null) => {
    setData((prev) => (prev ? markReadLocally(prev, ids) : prev));
    void auth.refreshUnread();
  };

  const markOne = useAction(async (id: string) => {
    await markNotificationsRead([id]);
    focusNext.current = focusCandidates(orderRef.current, id, filter === "all");
    applyRead([id]);
  });
  const markAll = useAction(
    async () => {
      await markNotificationsRead();
      focusNext.current = [];
      applyRead(null);
    },
    { success: "Tüm bildirimler okundu olarak işaretlendi." },
  );

  const onMarkRead = (n: Notification) => {
    if (markOne.loading) return;
    setBusyId(n.id);
    void markOne.run(n.id).finally(() => setBusyId(null));
  };

  // Satıra tıklamak okundu işaretler; gezinmeyi bağlantının kendisi yapar (yeni sekmede açma, kopyalama da çalışır).
  const onOpen = (n: Notification) => {
    if (n.read) return;
    void markNotificationsRead([n.id])
      .then(() => applyRead([n.id]))
      .catch(() => undefined);
  };

  const items = data?.items ?? [];
  const unread = data?.unread ?? items.filter((n) => !n.read).length;
  const groups = groupByAge(filterNotifications(items, filter), now);
  const order = groups.flatMap((g) => g.items.map((n) => n.id));

  useEffect(() => {
    orderRef.current = order;
  });
  useEffect(() => {
    const wanted = focusNext.current;
    if (!wanted) return;
    focusNext.current = null;
    const body = bodyRef.current;
    if (!body) return;
    const rows = Array.from(body.querySelectorAll<HTMLElement>("[data-notif-id]"));
    for (const id of wanted) {
      // Önce okundu düğmesi (ardışık Enter ile sırayla işaretlenebilsin), yoksa satır bağlantısı.
      const row = rows.find((r) => r.dataset.notifId === id);
      const el = row?.querySelector<HTMLElement>("button.notif-read") ?? row?.querySelector<HTMLElement>("a.notif-content");
      if (el) {
        el.focus();
        return;
      }
    }
    (body.closest<HTMLElement>('[role="tabpanel"]') ?? body).focus();
  });

  return (
    <div className="page page-narrow">
      <PageHeader
        title="Bildirimler"
        subtitle="Önerileriniz, oylamalar, görevleriniz ve hesabınızla ilgili gelişmeler."
        actions={
          unread > 0 ? (
            <Button size="sm" icon="check" onClick={() => void markAll.run()} loading={markAll.loading}>
              Tümünü okundu işaretle
            </Button>
          ) : null
        }
      />
      <Tabs<NotificationFilter>
        label="Bildirim filtresi"
        value={filter}
        onChange={setPicked}
        tabs={[
          { id: "all", label: "Tümü", count: items.length },
          { id: "unread", label: "Okunmamış", count: unread },
        ]}
      >
        <div ref={bodyRef} className="notif-body-wrap">
          {loading && !data ? <Spinner block /> : null}
          {error ? <ErrorView error={error} onRetry={reload} /> : null}
          {data && !groups.length ? (
            <EmptyState title={filter === "unread" ? "Okunmamış bildiriminiz yok" : "Henüz bildiriminiz yok"} icon="bell">
              <p>Önerilerinizdeki gelişmeler ve size düşen görevler burada görünür.</p>
            </EmptyState>
          ) : null}
          <NotificationGroups groups={groups} busyId={busyId} onOpen={onOpen} onMarkRead={onMarkRead} />
        </div>
      </Tabs>
    </div>
  );
}
