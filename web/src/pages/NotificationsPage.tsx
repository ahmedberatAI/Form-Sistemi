import { useState } from "react";
import { useNavigate } from "react-router-dom";
import type { Notification } from "@forum/shared";
import { getNotifications, markNotificationsRead } from "../api/endpoints";
import { useAuth } from "../auth/AuthContext";
import { toAppPath } from "../lib/routes";
import { useAction, useAsync } from "../lib/useAsync";
import { Badge, Button, cx, EmptyState, ErrorView, PageHeader, Spinner, Tabs, Time } from "../ui";

type Filter = "all" | "unread";

export default function NotificationsPage() {
  const auth = useAuth();
  const navigate = useNavigate();
  const [filter, setFilter] = useState<Filter>("all");
  const { data, error, loading, reload, setData } = useAsync(() => getNotifications(), [], { pollMs: 60_000 });

  const applyRead = (ids: string[] | null) => {
    setData((prev) => {
      if (!prev) return prev;
      const items = prev.items.map((n) => (ids === null || ids.includes(n.id) ? { ...n, read: true } : n));
      return { items, unread: items.filter((n) => !n.read).length };
    });
    void auth.refreshUnread();
  };

  const markOne = useAction(async (id: string) => {
    await markNotificationsRead([id]);
    applyRead([id]);
  });
  const markAll = useAction(
    async () => {
      await markNotificationsRead();
      applyRead(null);
    },
    { success: "Tüm bildirimler okundu olarak işaretlendi." },
  );

  const open = async (n: Notification) => {
    const target = toAppPath(n.link);
    if (!n.read) {
      void markNotificationsRead([n.id]).then(() => applyRead([n.id])).catch(() => undefined);
    }
    if (!target) return;
    if ("external" in target) window.open(target.external, "_blank", "noopener,noreferrer");
    else navigate(target.path);
  };

  const items = data?.items ?? [];
  const shown = filter === "unread" ? items.filter((n) => !n.read) : items;
  const unread = data?.unread ?? items.filter((n) => !n.read).length;

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
      <Tabs<Filter>
        label="Bildirim filtresi"
        value={filter}
        onChange={setFilter}
        tabs={[
          { id: "all", label: "Tümü", count: items.length },
          { id: "unread", label: "Okunmamış", count: unread },
        ]}
      >
        {loading && !data ? <Spinner block /> : null}
        {error ? <ErrorView error={error} onRetry={reload} /> : null}
        {data && !shown.length ? (
          <EmptyState title={filter === "unread" ? "Okunmamış bildiriminiz yok" : "Henüz bildiriminiz yok"} icon="bell">
            <p>Önerilerinizdeki gelişmeler ve size düşen görevler burada görünür.</p>
          </EmptyState>
        ) : null}
        {shown.length ? (
          <ul className="list notif-list">
            {shown.map((n) => {
              const target = toAppPath(n.link);
              return (
                <li key={n.id} className={cx("list-item notif", !n.read && "notif-unread")}>
                  <div className="notif-main">
                    <div className="notif-head">
                      {!n.read ? <Badge tone="info">Yeni</Badge> : <span className="sr-only">Okundu.</span>}
                      <span className="notif-title">{n.title}</span>
                    </div>
                    {n.body ? <p className="notif-body">{n.body}</p> : null}
                    <Time at={n.createdAt} mode="both" className="small muted" />
                  </div>
                  <div className="notif-actions">
                    {target ? (
                      <Button size="sm" variant="primary" icon={"external" in target ? "external" : "chevronRight"} onClick={() => void open(n)}>
                        Git
                      </Button>
                    ) : null}
                    {!n.read ? (
                      <Button size="sm" variant="ghost" icon="check" onClick={() => void markOne.run(n.id)} loading={markOne.loading}>
                        Okundu
                      </Button>
                    ) : null}
                  </div>
                </li>
              );
            })}
          </ul>
        ) : null}
      </Tabs>
    </div>
  );
}
