// Bütünlük (denetim) uyarıları — ALGORITMA §12.10: kesin sayımda kilit adım (lockstep) oy grupları işaretlenir.
// Uyarı KARARI DEĞİŞTİRMEZ; yalnızca denetim içindir. Herkes tur ve grup büyüklüğünü görür; grup üyelerinin takma adlarını
// sunucu yalnız denetçi ve yöneticiye gönderir. Kimin hangi seçeneği oyladığı hiçbir zaman gösterilmez.
import { Link } from "react-router-dom";
import type { IntegrityWarning, ProposalSummary } from "@forum/shared";
import { listProposals } from "../../api/endpoints";
import { formatNumber, proposalRef } from "../../lib/format";
import { routes } from "../../lib/routes";
import { useAsync } from "../../lib/useAsync";
import { Badge, Button, Card, Details, EmptyState, ErrorView, Spinner, StatusBadge, Table, Time } from "../../ui";
import { UserLink } from "../UserLink";

const KIND_LABELS: Record<IntegrityWarning["kind"], string> = { lockstep: "Kilit adım oy grubu" };

export function IntegrityWarningList({ warnings }: { warnings: IntegrityWarning[] }) {
  return (
    <ul className="list">
      {warnings.map((w, i) => (
        <li key={`${w.round}-${w.detectedAt}-${i}`} className="list-item stack-sm">
          <div className="row small">
            <Badge tone="warning" icon="warning">
              {KIND_LABELS[w.kind] ?? w.kind}
            </Badge>
            <span>{w.round}. tur</span>
            <span>{formatNumber(w.groupSize)} kişi</span>
            <Time at={w.detectedAt} className="muted" />
          </div>
          <p className="small">{w.message}</p>
          {w.members ? (
            <Details summary={`Grup üyeleri (${w.members.length}) — yalnız denetçi ve yönetici görür`}>
              <ul className="chips plain-list" aria-label="Kilit adım grubu üyeleri">
                {w.members.map((m) => (
                  <li key={m.userId}>
                    <UserLink id={m.userId} nickname={m.nickname} />
                  </li>
                ))}
              </ul>
              <p className="small muted">Liste, grubun hangi seçeneği oyladığını içermez. İnceleme sonucunu denetim günlüğüne not edin.</p>
            </Details>
          ) : null}
        </li>
      ))}
    </ul>
  );
}

export function IntegrityCard({ warnings }: { warnings: IntegrityWarning[] }) {
  if (!warnings.length) return null;
  return (
    <Card title={`Bütünlük uyarıları (${warnings.length})`} subtitle="Kesin sayımda otomatik tarama · karar değiştirilmedi" tone="warning">
      <div className="stack-sm">
        <p className="small">
          Çok kısa aralıklarla aynı oyu veren ve geçmişte de büyük ölçüde birlikte oy kullanan yoğun gruplar (kilit adım) işaretlenir. Bu bir kanıt değil, denetçi
          incelemesi için bir göstergedir; sonucu, eşikleri ve sayımı etkilemez.
        </p>
        <IntegrityWarningList warnings={warnings} />
      </div>
    </Card>
  );
}

/** Liste ucundaki en fazla kayıt (sunucu sınırı); daha eskiler için öneri sayfaları tek tek açılabilir. */
const OVERVIEW_LIMIT = 1000;

/**
 * Yönetim/denetim görünümü: bütünlük uyarısı olan öneriler. Yeni bir uç gerektirmez; mevcut öneri listesindeki
 * `integrityWarningCount` alanıyla süzülür. Grup üyeleri öneri sayfasındaki karttan (yalnız denetçi/yönetici) görülür.
 */
export function IntegrityOverview() {
  const { data, error, loading, reload } = useAsync(() => listProposals({ limit: OVERVIEW_LIMIT }), []);
  const rows: ProposalSummary[] = (data ?? []).filter((p) => (p.integrityWarningCount ?? 0) > 0);
  const total = rows.reduce((n, p) => n + p.integrityWarningCount, 0);
  return (
    <Card
      title="Bütünlük uyarıları"
      subtitle="Kesin sayımlarda işaretlenen kilit adım oy grupları. Uyarılar kararı değiştirmez; denetçi incelemesi içindir."
      actions={
        <Button size="sm" variant="ghost" icon="refresh" loading={loading} onClick={() => void reload()}>
          Yenile
        </Button>
      }
    >
      {loading && !data ? (
        <Spinner block label="Öneriler taranıyor…" />
      ) : error && !data ? (
        <ErrorView error={error} onRetry={reload} compact />
      ) : !rows.length ? (
        <EmptyState title="Bütünlük uyarısı yok" icon="success">
          Kesin sayımlarda kilit adım oy grubu bulunmadı. Tarama her oylama turunun kapanışında otomatik yapılır.
        </EmptyState>
      ) : (
        <div className="stack-sm">
          <p className="small muted">
            {formatNumber(rows.length)} öneride toplam {formatNumber(total)} uyarı. Grup üyelerini görmek için öneriyi açın (Bütünlük uyarıları kartı).
          </p>
          <Table
            caption="Bütünlük uyarısı olan öneriler"
            rowKey={(p) => p.id}
            rows={rows}
            columns={[
              {
                key: "p",
                header: "Öneri",
                render: (p) => (
                  <Link to={routes.proposal(p.id)}>
                    {proposalRef(p.seq)} {p.title}
                  </Link>
                ),
              },
              { key: "s", header: "Durum", render: (p) => <StatusBadge status={p.status} /> },
              { key: "n", header: "Uyarı", align: "right", render: (p) => formatNumber(p.integrityWarningCount) },
              { key: "t", header: "Oluşturma", hideOnMobile: true, render: (p) => <Time at={p.createdAt} mode="absolute" /> },
            ]}
          />
        </div>
      )}
    </Card>
  );
}
