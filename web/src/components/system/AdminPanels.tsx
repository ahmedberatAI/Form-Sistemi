// Yönetim panelleri: simüle saat ve zamanlayıcı, kümeleri yeniden hesaplama, roller, denetim günlüğü.
import { useState, type FormEvent } from "react";
import { Link } from "react-router-dom";
import { ROLE_LABELS, type AdminUserRow, type AuditLogEntry, type ClusterSnapshotView, type Role, type TickResponse } from "@forum/shared";
import { adminListUsers, advanceClock, getAuditLog, recomputeClusters, runTick, setUserRoles } from "../../api/endpoints";
import { useAuth } from "../../auth/AuthContext";
import { formatDateTime, formatDuration, formatHours, formatNumber } from "../../lib/format";
import { useDebounced, useNow } from "../../lib/hooks";
import { routes } from "../../lib/routes";
import { useAsync } from "../../lib/useAsync";
import { Alert, Badge, Button, Card, Checkbox, Details, EmptyState, ErrorView, HashText, Input, KeyValue, Select, Spinner, Table, Time, useConfirm, useToast, UserStatusBadge } from "../../ui";
import { UserLink } from "../UserLink";
import { TransitionsList } from "./marks";
import "./system.css";

const QUICK_HOURS = [1, 6, 24, 72, 168];

export function ClockPanel() {
  const auth = useAuth();
  const toast = useToast();
  const sys = auth.system;
  const now = useNow(1000);
  const [hours, setHours] = useState("12");
  const [busy, setBusy] = useState<string | null>(null);
  const [result, setResult] = useState<{ title: string; res: TickResponse } | null>(null);
  const [snap, setSnap] = useState<ClusterSnapshotView | null>(null);

  const advance = async (h: number, key = `adv-${h}`) => {
    if (!Number.isFinite(h) || h < 1 || h > 720) {
      toast.warning("1 ile 720 saat arasında bir değer girin.");
      return;
    }
    setBusy(key);
    try {
      const res = await advanceClock(h);
      setResult({ title: `Saat ${formatHours(h)} ileri alındı`, res });
      await auth.refreshSystem();
      toast.success(`Simüle saat ${formatHours(h)} ileri alındı; ${res.transitions.length} evre geçişi.`);
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(null);
    }
  };

  const tick = async () => {
    setBusy("tick");
    try {
      const res = await runTick();
      setResult({ title: "Zamanlayıcı çalıştırıldı", res });
      await auth.refreshSystem();
      toast.success(`Zamanlayıcı çalıştı; ${res.transitions.length} evre geçişi.`);
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(null);
    }
  };

  const recompute = async () => {
    setBusy("clusters");
    try {
      const s = await recomputeClusters();
      setSnap(s);
      toast.success(`Kümeler yeniden hesaplandı: K = ${s.k}.`);
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(null);
    }
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    void advance(Number(hours.replace(",", ".")), "adv-custom");
  };

  return (
    <div className="stack-lg">
      <Card title="Simüle saat" subtitle="Demo için zaman ileri alınır; evre geçişlerinin tek otoritesi sunucudaki zamanlayıcıdır.">
        <div className="stack">
          {sys ? (
            <KeyValue
              items={[
                { label: "Şu anki simüle zaman", value: <strong>{formatDateTime(now)}</strong> },
                { label: "Zaman ölçeği (TIME_SCALE)", value: `${formatNumber(sys.timeScale)}×`, hint: sys.timeScale > 1 ? "Simüle zaman gerçek zamandan bu kat hızlı akar." : "Simüle zaman gerçek zamanla aynı hızda akar." },
                { label: "Toplam ileri alma", value: formatDuration(sys.clockOffsetMs, false) },
              ]}
            />
          ) : (
            <Spinner label="Sistem bilgisi yükleniyor…" showLabel />
          )}
          <div className="stack-sm">
            <span className="field-label">Hızlı ileri al</span>
            <div className="sy-quick">
              {QUICK_HOURS.map((h) => (
                <Button key={h} size="sm" loading={busy === `adv-${h}`} disabled={!!busy} onClick={() => void advance(h)}>
                  +{h} saat
                </Button>
              ))}
            </div>
          </div>
          <form className="sy-inline-form" onSubmit={submit}>
            <Input label="Saat" type="number" inputMode="decimal" min={1} max={720} step={1} value={hours} onChange={(e) => setHours(e.target.value)} hint="1–720 saat" />
            <Button type="submit" variant="primary" loading={busy === "adv-custom"} disabled={!!busy}>
              {`${hours || "?"} saat ileri al`}
            </Button>
          </form>
          <div className="row">
            <Button icon="refresh" loading={busy === "tick"} disabled={!!busy} onClick={() => void tick()}>
              Zamanlayıcıyı çalıştır
            </Button>
            <Button icon="graph" loading={busy === "clusters"} disabled={!!busy} onClick={() => void recompute()}>
              Kümeleri yeniden hesapla
            </Button>
          </div>
        </div>
      </Card>

      {result ? (
        <Card title={result.title} subtitle={`Yeni simüle zaman: ${formatDateTime(result.res.now)}`} actions={<Badge tone="neutral">{result.res.transitions.length} geçiş</Badge>}>
          <TransitionsList result={result.res} />
        </Card>
      ) : null}

      {snap ? (
        <Card title="Yeni küme anlık görüntüsü">
          <KeyValue
            compact
            items={[
              { label: "Küme sayısı (K)", value: snap.k },
              { label: "Siluet", value: formatNumber(snap.silhouette, 3) },
              { label: "Kümelenen üye", value: snap.members },
              { label: "Tohum", value: <HashText hash={snap.seed} /> },
              { label: "Girdi özeti", value: <HashText hash={snap.inputHash} /> },
              { label: "Defter kaydı", value: snap.ledgerTx ? <HashText hash={snap.ledgerTx} to={routes.tx(snap.ledgerTx)} /> : "—" },
            ]}
          />
          <p className="small muted">
            Oylaması açık önerilerin küme görüntüsü açılışta dondurulmuştur; yeni görüntü yalnızca bundan sonra açılan oylamalarda kullanılır.{" "}
            <Link to={`${routes.graph()}?sekme=harita`}>Görüş haritasını aç</Link>
          </p>
        </Card>
      ) : null}
    </div>
  );
}

const ALL_ROLES: Role[] = ["member", "registrar", "auditor", "admin"];

export function RoleManager() {
  const auth = useAuth();
  const toast = useToast();
  const confirm = useConfirm();
  const [q, setQ] = useState("");
  const dq = useDebounced(q.trim(), 350);
  const { data, error, loading, reload, setData } = useAsync(() => adminListUsers(dq || undefined), [dq]);
  const [busyId, setBusyId] = useState<string | null>(null);

  const toggle = async (u: AdminUserRow, role: Role, on: boolean) => {
    if (role === "member") return;
    const next = on ? [...new Set([...u.roles, role])] : u.roles.filter((r) => r !== role);
    if (u.id === auth.user?.id && role === "admin" && !on) {
      const ok = await confirm({ title: "Kendi yönetici rolünüzü kaldırıyorsunuz", message: "Bu sayfaya erişiminizi kaybedersiniz.", tone: "danger", confirmLabel: "Kaldır" });
      if (!ok) return;
    }
    setBusyId(u.id);
    try {
      const me = await setUserRoles(u.id, next);
      setData((rows) => rows?.map((r) => (r.id === u.id ? { ...r, roles: me.roles } : r)));
      toast.success(`@${u.nickname}: ${ROLE_LABELS[role]} rolü ${on ? "verildi" : "kaldırıldı"}.`);
      if (u.id === auth.user?.id) void auth.refresh();
    } catch (e) {
      toast.error(e);
    } finally {
      setBusyId(null);
    }
  };

  return (
    <Card title="Roller" subtitle="Kayıt memuru kimlik doğrular; denetçi kayıtları okur (kişisel veri erişimi kayıtlıdır); yönetici tüm yetkilere sahiptir. Rol değişiklikleri denetim günlüğüne yazılır.">
      <div className="stack">
        <Input label="Üye ara" type="search" placeholder="Takma ad…" value={q} onChange={(e) => setQ(e.target.value)} />
        {loading && !data ? (
          <Spinner block />
        ) : error ? (
          <ErrorView error={error} onRetry={reload} compact />
        ) : (
          <Table
            caption="Üyeler ve rolleri"
            rows={data ?? []}
            rowKey={(u) => u.id}
            empty={<EmptyState title="Eşleşen üye yok" />}
            columns={[
              { key: "nick", header: "Üye", render: (u) => <UserLink id={u.id} nickname={u.nickname} status={u.status} /> },
              { key: "status", header: "Durum", render: (u) => <UserStatusBadge status={u.status} /> },
              {
                key: "vote",
                header: "Oy hakkı",
                hideOnMobile: true,
                render: (u) => (u.status === "verified" && u.isAdult && u.politicalConsent ? <Badge tone="success">var</Badge> : <Badge tone="neutral">yok</Badge>),
              },
              {
                key: "roles",
                header: "Roller",
                render: (u) => (
                  <div className="sy-roles" role="group" aria-label={`@${u.nickname} rolleri`}>
                    {ALL_ROLES.map((r) => (
                      <Checkbox
                        key={r}
                        label={ROLE_LABELS[r]}
                        checked={r === "member" || u.roles.includes(r)}
                        disabled={r === "member" || busyId === u.id || u.status === "erased" || u.status === "rejected"}
                        onChange={(e) => void toggle(u, r, e.target.checked)}
                      />
                    ))}
                  </div>
                ),
              },
            ]}
          />
        )}
      </div>
    </Card>
  );
}

const AUDIT_ACTIONS: [string, string][] = [
  ["identity.pii_access", "Kişisel veri erişimi"],
  ["identity.verify", "Üye doğrulama kararı"],
  ["identity.create_by_registrar", "Kayıt memurunca üye girişi"],
  ["identity.register", "Kayıt"],
  ["identity.roles", "Rol değişikliği"],
  ["identity.consents", "Rıza değişikliği"],
  ["identity.export", "KVKK dökümü"],
  ["identity.erase", "Kripto-imha (hesap silme)"],
  ["identity.password_change", "Şifre değişikliği"],
  ["identity.login_failed", "Başarısız giriş"],
  ["identity.duplicate_attempt", "Mükerrer kayıt denemesi"],
  ["message.read_hidden", "Gizlenmiş mesajı okuma"],
  ["admin.clock_advance", "Saat ileri alma"],
  ["admin.tick", "Zamanlayıcı çalıştırma"],
  ["admin.clusters_recompute", "Kümeleri yeniden hesaplama"],
  ["expert.apply", "Bilirkişi başvurusu"],
  ["expert.approve", "Bilirkişi onayı"],
  ["expert.reject", "Bilirkişi reddi"],
  ["expert.sanction.warn", "Bilirkişi uyarısı"],
  ["expert.sanction.suspend", "Bilirkişi askıya alma"],
  ["expert.sanction.remove", "Bilirkişi listeden çıkarma"],
  ["expert.sanction.reinstate", "Bilirkişi yeniden etkinleştirme"],
  ["expert.draw", "Bilirkişi kurası"],
  ["expert.report", "Bilirkişi raporu"],
  ["ledger.tamper", "Defter kurcalama (demo)"],
  ["ledger.repair", "Defter onarımı"],
  ["ledger.fault", "Hata enjeksiyonu (demo)"],
];

export function AuditLogView() {
  const [action, setAction] = useState("");
  const [actorId, setActorId] = useState("");
  const [actorName, setActorName] = useState<string | null>(null);
  const { data, error, loading, reload } = useAsync(() => getAuditLog({ action: action || undefined, actorId: actorId || undefined, limit: 200 }), [action, actorId]);

  const filterActor = (e: AuditLogEntry) => {
    if (!e.actorId) return;
    setActorId(e.actorId);
    setActorName(e.actorNickname);
  };

  return (
    <Card title="Denetim günlüğü" subtitle="Yetkili işlemler ve kişisel veri erişimleri. Kayıtlar silinmez." actions={<Button size="sm" variant="ghost" icon="refresh" onClick={() => void reload()}>Yenile</Button>}>
      <div className="stack">
        <div className="sy-inline-form">
          <Select
            label="Eylem"
            value={action}
            onChange={(e) => setAction(e.target.value)}
            options={[{ value: "", label: "Tüm eylemler" }, ...AUDIT_ACTIONS.map(([v, l]) => ({ value: v, label: `${l} (${v})` }))]}
          />
        </div>
        {actorId ? (
          <div className="row">
            <span className="small">Aktör süzgeci:</span>
            <Badge tone="info">@{actorName ?? actorId}</Badge>
            <Button
              size="sm"
              variant="ghost"
              icon="close"
              onClick={() => {
                setActorId("");
                setActorName(null);
              }}
            >
              Kaldır
            </Button>
          </div>
        ) : (
          <p className="small muted mt-0">Bir aktöre göre süzmek için tablodaki “süz” düğmesini kullanın.</p>
        )}
        {loading && !data ? (
          <Spinner block />
        ) : error ? (
          <ErrorView error={error} onRetry={reload} compact />
        ) : (
          <Table
            caption="Denetim kayıtları (en yeni önce)"
            rows={data ?? []}
            rowKey={(e) => e.id}
            empty={<EmptyState title="Kayıt bulunamadı" />}
            columns={[
              { key: "at", header: "Zaman", render: (e) => <span className="nowrap"><Time at={e.at} mode="absolute" /></span> },
              {
                key: "actor",
                header: "Aktör",
                render: (e) =>
                  e.actorId ? (
                    <span className="row">
                      <UserLink id={e.actorId} nickname={e.actorNickname ?? "?"} showExpert={false} />
                      {e.actorId !== actorId ? (
                        <Button size="sm" variant="ghost" onClick={() => filterActor(e)} aria-label={`@${e.actorNickname ?? e.actorId} kayıtlarını süz`}>
                          süz
                        </Button>
                      ) : null}
                    </span>
                  ) : (
                    <span className="muted">sistem</span>
                  ),
              },
              { key: "action", header: "Eylem", render: (e) => <code>{e.action}</code> },
              { key: "target", header: "Hedef", render: (e) => (e.target ? <code className="truncate" title={e.target}>{e.target.length > 40 ? e.target.slice(0, 40) + "…" : e.target}</code> : <span className="muted">—</span>) },
              {
                key: "meta",
                header: "Ayrıntı",
                render: (e) =>
                  e.meta && Object.keys(e.meta).length ? (
                    <Details summary="JSON">
                      <pre className="sy-meta-json">{JSON.stringify(e.meta, null, 2)}</pre>
                    </Details>
                  ) : (
                    <span className="muted">—</span>
                  ),
              },
            ]}
          />
        )}
        {data && data.length >= 200 ? <Alert tone="info">En yeni 200 kayıt gösteriliyor; daha eski kayıtlar için süzgeç kullanın.</Alert> : null}
      </div>
    </Card>
  );
}
