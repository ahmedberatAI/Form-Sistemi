// Önerinin defter kayıtları: türe göre sayılar, son 8 kayıt ve "Tümünü göster". Öneri sayfasında katlanabilir kartın
// (LedgerCard) içinde durur; kart başlığının yanındaki tek satırlık hüküm ledgerSummary ile üretilir.
import { useState } from "react";
import { LEDGER_TX_LABELS, type LedgerTxType, type ProposalDetail } from "@forum/shared";
import { formatNumber } from "../../lib/format";
import { routes } from "../../lib/routes";
import { Button, Card, HashText, Time } from "../../ui";
import { SubHeading } from "./common";
import "./participation.css";

type LedgerTxs = ProposalDetail["ledgerTxs"];
type LedgerTotals = ProposalDetail["ledgerTxCounts"];

/** Listede ilk gösterilen kayıt sayısı (gerisi "Tümünü göster" ile). */
const PREVIEW_COUNT = 8;

const labelOf = (t: string) => LEDGER_TX_LABELS[t as LedgerTxType] ?? t;

/** En yeni kayıt önce. */
const newestFirst = (txs: LedgerTxs): LedgerTxs => txs.slice().sort((a, b) => b.at - a.at);

/**
 * Türe göre TOPLAM sayılar. Sunucu oy taahhütlerini kısaltabilir (en yeni N); sayılar listenin değil defterin toplamıdır.
 * Sunucu toplamları göndermediyse (eski sürüm) listeden sayılır.
 */
function countsOf(txs: LedgerTxs, totals: LedgerTotals): Map<string, number> {
  const counts = new Map<string, number>(totals ? Object.entries(totals) : []);
  if (!totals) for (const t of txs) counts.set(t.type, (counts.get(t.type) ?? 0) + 1);
  return counts;
}

/** Kart başlığının yanındaki hüküm: "64 işlem · son: Sayım sonucu". */
export function ledgerSummary(txs: LedgerTxs, totals?: LedgerTotals): string {
  if (!txs.length) return "Henüz defter kaydı yok";
  const total = [...countsOf(txs, totals).values()].reduce((a, b) => a + b, 0);
  return `${formatNumber(total)} işlem · son: ${labelOf(newestFirst(txs)[0].type)}`;
}

export function LedgerList({ txs, totals }: { txs: LedgerTxs; totals?: LedgerTotals }) {
  const [all, setAll] = useState(false);
  if (!txs.length) return <p className="small muted">Henüz defter kaydı yok.</p>;
  const sorted = newestFirst(txs);
  const counts = countsOf(txs, totals);
  const shown = all ? sorted : sorted.slice(0, PREVIEW_COUNT);
  return (
    <div className="stack-sm">
      <p className="small muted">{[...counts.entries()].map(([t, n]) => `${labelOf(t)}: ${n}`).join(" · ")}</p>
      <SubHeading level={4}>Son kayıtlar</SubHeading>
      <ul className="plain-list stack-sm small ledger-list">
        {shown.map((t) => (
          <li key={t.txHash}>
            <div className="row-between">
              <span>{labelOf(t.type)}</span>
              <Time at={t.at} className="muted" />
            </div>
            <HashText hash={t.txHash} chars={12} to={routes.tx(t.txHash)} copy={false} label="İşlem özeti" />
          </li>
        ))}
      </ul>
      {sorted.length > PREVIEW_COUNT ? (
        <Button size="sm" variant="ghost" onClick={() => setAll((x) => !x)}>
          {all ? "Daha az göster" : `Tümünü göster (${sorted.length})`}
        </Button>
      ) : null}
    </div>
  );
}

/** "Defter kayıtları" kartı: başlıkta hüküm, gövde kapalı (1 dokunuşla açılır; 'Tam' görünümde açık gelir). */
export function LedgerCard({ txs, totals }: { txs: LedgerTxs; totals?: LedgerTotals }) {
  return (
    <Card
      title="Defter kayıtları"
      subtitle="Bu öneriyle ilgili dağıtık defter işlemleri (kişisel veri içermez)."
      collapsible
      summary={ledgerSummary(txs, totals)}
      anchor="defter"
    >
      <LedgerList txs={txs} totals={totals} />
    </Card>
  );
}
