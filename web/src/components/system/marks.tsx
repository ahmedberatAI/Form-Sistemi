// Küçük gösterim bileşenleri: doğrulama işareti (✔/✘), defter işlem türü rozeti, faz geçişleri listesi.
import { Link } from "react-router-dom";
import { LEDGER_TX_LABELS, PROPOSAL_STATUS_LABELS, type LedgerTxType, type TickResponse } from "@forum/shared";
import { proposalRef } from "../../lib/format";
import { routes } from "../../lib/routes";
import { Badge, cx, type Tone } from "../../ui";
import "./system.css";

/** Doğrulama sonucu: ok → "✔ geçerli", false → "✘ geçersiz", null → "— denetlenmedi" (renk + simge + metin). */
export function VerifyMark({ ok, okText = "Geçerli", failText = "Geçersiz", naText = "Denetlenmedi", className }: { ok: boolean | null | undefined; okText?: string; failText?: string; naText?: string; className?: string }) {
  if (ok == null) {
    return (
      <span className={cx("sy-mark sy-mark-na", className)}>
        <span className="sy-mark-sym" aria-hidden="true">
          —
        </span>
        {naText}
      </span>
    );
  }
  return (
    <span className={cx("sy-mark", ok ? "sy-mark-ok" : "sy-mark-fail", className)}>
      <span className="sy-mark-sym" aria-hidden="true">
        {ok ? "✔" : "✘"}
      </span>
      {ok ? okText : failText}
    </span>
  );
}

const TX_TONE: Partial<Record<LedgerTxType, Tone>> = {
  VOTE_COMMIT: "accent",
  BALLOT_REVEAL: "accent",
  TALLY: "success",
  PHASE_CHANGED: "info",
  MESSAGE_HIDDEN: "warning",
  MEMBER_ERASED: "warning",
  EVIDENCE: "danger",
  BYLAW_VERSION: "accent",
  OBJECTION: "warning",
};

export function txTypeLabel(t: string): string {
  return LEDGER_TX_LABELS[t as LedgerTxType] ?? t;
}

export function TxTypeBadge({ type, count }: { type: string; count?: number }) {
  return (
    <Badge tone={TX_TONE[type as LedgerTxType] ?? "neutral"} title={type}>
      {txTypeLabel(type)}
      {count && count > 1 ? ` ×${count}` : ""}
    </Badge>
  );
}

/** Blok içindeki işlem türlerinin sayımlı rozetleri. */
export function TxTypeBadges({ types }: { types: string[] }) {
  if (!types.length) return <span className="muted small">boş blok</span>;
  const counts = new Map<string, number>();
  for (const t of types) counts.set(t, (counts.get(t) ?? 0) + 1);
  return (
    <span className="sy-types">
      {[...counts.entries()].map(([t, n]) => (
        <TxTypeBadge key={t} type={t} count={n} />
      ))}
    </span>
  );
}

/** Zamanlayıcı sonucu: faz geçişleri. */
export function TransitionsList({ result }: { result: TickResponse }) {
  if (!result.transitions.length) return <p className="muted mt-0">Bu adımda evre değişikliği olmadı.</p>;
  return (
    <ul className="list">
      {result.transitions.map((t, i) => (
        <li className="list-item" key={`${t.proposalId}-${i}`}>
          <div className="row">
            <Link to={routes.proposal(t.proposalId)}>
              <strong>{proposalRef(t.seq)}</strong>
            </Link>
            <span>
              {PROPOSAL_STATUS_LABELS[t.from] ?? t.from} → <strong>{PROPOSAL_STATUS_LABELS[t.to] ?? t.to}</strong>
            </span>
          </div>
          {t.reason ? <div className="small muted">{t.reason}</div> : null}
        </li>
      ))}
    </ul>
  );
}
