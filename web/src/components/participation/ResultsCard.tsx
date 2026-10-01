// Kesin bir oylama turunun sonucu (ALGORITMA §4): toplamlar, onay oranı ve eşik, yeter sayı, görüş grupları tablosu
// (P_g ve taban φ), GAC göstergesi, "Neden bu sonuç?" listesi, gerekçe ve azınlık raporları.
import type { ClusterResult, DecisionResult, MinorityReport } from "@forum/shared";
import { clusterLabel } from "@forum/shared";
import { formatNumber, formatPercent } from "../../lib/format";
import { Card, cx, HashText, OutcomeBadge, ProgressBar, Table, Time, VoteBadge } from "../../ui";
import { UserLink } from "../UserLink";
import { fmtDecimal, PlainText, SubHeading, Tick } from "./common";

export interface ResultsCardProps {
  result: DecisionResult;
  minorityReports?: MinorityReport[];
  reconciliationOrigin?: "contested" | "objection" | null;
  myEffectiveVia?: { delegateNickname: string; choice: "yes" | "no" | "abstain" } | null;
}

export function ResultsCard({ result: r, minorityReports, reconciliationOrigin, myEffectiveVia }: ResultsCardProps) {
  const t = r.thresholdUsed;
  const tVal = t.den ? t.num / t.den : 0;
  const op = r.thresholdStrict ? ">" : "≥";
  const decided = r.totals.yes + r.totals.no;
  const tone = r.outcome === "accept" ? "success" : r.outcome === "reject" ? "danger" : "warning";

  return (
    <Card
      title={r.round === 1 ? "1. tur sonucu" : "Yeniden oylama sonucu"}
      subtitle={r.round === 2 && reconciliationOrigin ? (reconciliationOrigin === "objection" ? "İtiraz sonrası yeniden oylama" : "Tartışmalı sonuç sonrası yeniden oylama") : undefined}
      actions={<OutcomeBadge outcome={r.outcome} />}
      tone={tone}
    >
      <div className="stack">
        <p className="result-reason">
          <strong>Gerekçe:</strong> {r.reason}
        </p>

        {myEffectiveVia ? (
          <p className="small via-note">
            Doğrudan oy vermediniz; oyunuz vekâletle <strong>@{myEffectiveVia.delegateNickname}</strong> üzerinden <VoteBadge choice={myEffectiveVia.choice} /> olarak
            sayıldı (ağırlık her zaman 1).
          </p>
        ) : null}

        <dl className="result-totals">
          <Total label="Uygun seçmen" value={r.totals.eligible} />
          <Total label="Katılım" value={r.totals.participants} tone={r.quorumMet ? "success" : "danger"} />
          <Total label="Kabul" value={r.totals.yes} tone="success" />
          <Total label="Red" value={r.totals.no} tone="danger" />
          <Total label="Çekimser" value={r.totals.abstain} />
          <Total label="Vekâletle" value={r.totals.delegated} tone="info" title="Doğrudan oy vermeyen, oyu vekâlet zinciriyle sayılan kişi" />
          <Total label="Yönlendirilemeyen" value={r.totals.unrouted} title="Delegenin vekâlet sınırı aşıldığı için oyu kullanılamayan kişi" />
        </dl>

        <ProgressBar
          label="Katılım"
          value={r.totals.participants}
          max={Math.max(1, r.totals.eligible)}
          valueText={`${r.totals.participants}/${r.totals.eligible}`}
          marker={r.quorumRequired}
          markerLabel={`Yeter sayı: en az ${r.quorumRequired} katılım`}
          tone={r.quorumMet ? "success" : "danger"}
        />
        <ProgressBar
          label="Onay oranı (kabul / (kabul + red))"
          value={r.approval}
          valueText={`${formatPercent(r.approval)} (${r.totals.yes}/${decided})`}
          marker={tVal}
          markerLabel={`Eşik: ${op} ${formatPercent(tVal)}${r.bridgeApplicable ? "" : " (soğuk başlangıç: nitelikli çoğunluk)"}`}
          tone={r.thresholdMet ? "success" : "danger"}
        />
        {!r.bridgeApplicable ? (
          <p className="small muted">Yeterli görüş verisi yok; köprü testi yerine nitelikli çoğunluk arandı (eşik δ kadar yükseltildi, en fazla 2/3).</p>
        ) : null}

        <ClustersTable result={r} />

        <section aria-label="Neden bu sonuç?" className="stack-sm">
          <SubHeading>Neden bu sonuç?</SubHeading>
          <ul className="why-list">
            {r.checks.map((c) => (
              <li key={c.key} className={c.passed ? "why-ok" : "why-fail"}>
                <Tick ok={c.passed} />
                <div className="why-text">
                  <div>
                    <strong>{c.label}</strong>: {c.value} <span className="muted">(gerekli {c.required})</span>
                  </div>
                  {c.detail ? <div className="small muted">{c.detail}</div> : null}
                </div>
              </li>
            ))}
          </ul>
        </section>

        {minorityReports && minorityReports.length ? (
          <section aria-label="Azınlık raporları" className="stack-sm">
            <SubHeading>Azınlık raporları ({minorityReports.length})</SubHeading>
            <p className="small muted">Karar kaydına kalıcı olarak eklenir.</p>
            <MinorityReportList reports={minorityReports} />
          </section>
        ) : null}

        <p className="small muted result-meta">
          Algoritma {r.algoVersion} · hesaplandı <Time at={r.computedAt} mode="absolute" /> · girdi özeti <HashText hash={r.inputsHash} chars={10} label="Girdi özeti" />
        </p>
      </div>
    </Card>
  );
}

function Total({ label, value, tone, title }: { label: string; value: number; tone?: "success" | "danger" | "info"; title?: string }) {
  return (
    <div className={cx("result-total", tone && `result-total-${tone}`)} title={title}>
      <dt>{label}</dt>
      <dd>{formatNumber(value)}</dd>
    </div>
  );
}

function ClustersTable({ result: r }: { result: DecisionResult }) {
  if (!r.clusters.length) {
    return <p className="small muted">Bu oylamada görüş grubu (küme) bilgisi yok; yalnızca genel çoğunluk değerlendirildi.</p>;
  }
  return (
    <section aria-label="Görüş grupları" className="stack-sm">
      <SubHeading>Görüş grupları (köprü testi)</SubHeading>
      <Table<ClusterResult>
        caption="Görüş gruplarına göre oylar, P_g desteği ve taban"
        rowKey={(c) => c.clusterId}
        rows={r.clusters}
        columns={[
          {
            key: "label",
            header: "Grup",
            render: (c) => (
              <span>
                {c.label || clusterLabel(c.clusterId)}
                <span className="small muted cluster-sig">{c.significant ? "anlamlı" : "anlamlı değil"}</span>
              </span>
            ),
          },
          { key: "members", header: "Üye (n_g)", align: "right", render: (c) => formatNumber(c.members) },
          { key: "yes", header: "Kabul", align: "right", render: (c) => formatNumber(c.yes) },
          { key: "no", header: "Red", align: "right", render: (c) => formatNumber(c.no) },
          { key: "abstain", header: "Çekimser", align: "right", render: (c) => formatNumber(c.abstain) },
          { key: "pg", header: "P_g", align: "right", render: (c) => <strong>{fmtDecimal(c.pg)}</strong> },
          { key: "floor", header: "Taban φ", align: "right", render: (c) => (c.floor !== null ? fmtDecimal(c.floor) : "—") },
          {
            key: "passed",
            header: "Geçti mi?",
            align: "center",
            render: (c) => <Tick ok={c.passed} label={c.passed === null ? "köprü testine girmedi" : c.passed ? "taban sağlandı" : "taban sağlanmadı"} />,
          },
        ]}
      />
      <p className="small muted">
        P_g = (1 + Kabul) / (2 + Kabul + Red). Hiç oy vermeyen grup 0,50 sayılır: boykot bir engel aracı değildir; bir grup kararı ancak etkin biçimde “Red” diyerek
        durdurabilir. Kümelenmemiş (yeni) üyeler genel orana sayılır, köprü testine girmez.
      </p>
      {r.gac !== null ? (
        <p className="small">
          <strong>Grup bilgili uzlaşı (GAC): {fmtDecimal(r.gac)}</strong> <span className="muted">— anlamlı grupların P_g değerlerinin geometrik ortalaması; yalnızca gösterge.</span>
        </p>
      ) : null}
    </section>
  );
}

export function MinorityReportList({ reports }: { reports: MinorityReport[] }) {
  return (
    <ul className="list">
      {reports.map((m) => (
        <li key={m.id} className="list-item stack-sm">
          <div className="row small">
            <UserLink id={m.authorId} nickname={m.authorNickname} />
            <span className="muted">{clusterLabel(m.clusterId)}</span>
            <Time at={m.createdAt} className="muted" />
          </div>
          <PlainText text={m.body} />
        </li>
      ))}
    </ul>
  );
}
