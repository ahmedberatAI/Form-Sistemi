// Önerinin yaşam döngüsü (ALGORITMA §3): tamamlanan evreler (defter kaydıyla), şu anki evre ve beklenen sonraki evreler.
import { PROPOSAL_STATUS_LABELS, type DecisionParams, type ProposalDetail, type ProposalStatus } from "@forum/shared";
import { formatHours } from "../../lib/format";
import { routes } from "../../lib/routes";
import { cx, HashText, Time } from "../../ui";

const TERMINAL: ProposalStatus[] = ["enacted", "rejected", "withdrawn", "expired", "inadmissible"];

const PHASE_HINT: Partial<Record<ProposalStatus, string>> = {
  sponsoring: "Destekçiler metnin oylanmaya hazır olduğunu onaylar; yeterli destek gelince ontoloji denetimi yapılır.",
  deliberation: "Tartışma, metin önerileri ve (gerekirse) bilirkişi görüşü. Metin bu evrede değişebilir.",
  voting: "Gizli oylama (taahhüt–açıklama). Sonuç: kabul → itiraz süresi; tartışmalı → uzlaşma; red → kapanır.",
  objection_window: "İlk turda Red oyu verenler itiraz edebilir; geçerli itiraz uzlaşma turu başlatır.",
  reconciliation: "Azınlık raporları, YZ köprü taslakları ve metin revizyonu; ardından yeniden oylama.",
  revote: "Tek seferlik yeniden oylama; sonuç kesindir.",
  enacted: "Karar yürürlüğe girer.",
};

function durationOf(status: ProposalStatus, params: DecisionParams | null): number | null {
  if (!params) return null;
  const d = params.durationsHours;
  switch (status) {
    case "sponsoring":
      return d.sponsoring;
    case "deliberation":
      return d.deliberation;
    case "voting":
    case "revote":
      return d.voting;
    case "objection_window":
      return d.objection;
    case "reconciliation":
      return d.reconciliation;
    default:
      return null;
  }
}

function objectionApplies(p: ProposalDetail): boolean {
  if (p.kind === "deletion") return false;
  if (p.params && p.params.durationsHours.objection === 0) return false;
  return true;
}

/** Şu anki durumdan sonra beklenen (olağan) evreler. */
function expectedNext(p: ProposalDetail): ProposalStatus[] {
  const obj = objectionApplies(p) ? (["objection_window"] as ProposalStatus[]) : [];
  switch (p.status) {
    case "draft":
      return ["sponsoring", "deliberation", "voting", ...obj, "enacted"];
    case "sponsoring":
      return ["deliberation", "voting", ...obj, "enacted"];
    case "deliberation":
      return ["voting", ...obj, "enacted"];
    case "voting":
      return [...obj, "enacted"];
    case "objection_window":
      return ["enacted"];
    case "reconciliation":
      return ["revote", "enacted"];
    case "revote":
      return ["enacted"];
    default:
      return [];
  }
}

function eventLabel(from: ProposalStatus | null, to: ProposalStatus): string {
  if (from === null) return `Oluşturuldu — ${PROPOSAL_STATUS_LABELS[to]}`;
  if (from === to) return `${PROPOSAL_STATUS_LABELS[to]} — süre uzatıldı`;
  return PROPOSAL_STATUS_LABELS[to] ?? to;
}

export function PhaseTimeline({ proposal: p }: { proposal: ProposalDetail }) {
  const events = p.events.slice().sort((a, b) => a.at - b.at);
  const terminal = TERMINAL.includes(p.status);
  const next = expectedNext(p);
  return (
    <ol className="timeline phase-timeline">
      {events.length === 0 ? (
        <li className="timeline-item is-current">
          <strong>{PROPOSAL_STATUS_LABELS[p.status]}</strong>
          <div className="small muted">
            <Time at={p.createdAt} mode="both" />
          </div>
        </li>
      ) : null}
      {events.map((e, i) => {
        const last = i === events.length - 1;
        return (
          <li key={`${e.at}-${i}`} className={cx("timeline-item", last && !terminal ? "is-current" : "is-done", last && terminal && `is-final is-${e.to}`)}>
            <div className="row-between">
              <strong>{eventLabel(e.from, e.to)}</strong>
              <Time at={e.at} mode="absolute" className="small muted" />
            </div>
            {e.reason ? <p className="small timeline-reason">{e.reason}</p> : null}
            {last && !terminal && p.phaseEndsAt ? (
              <p className="small muted">
                Evre bitişi: <Time at={p.phaseEndsAt} mode="both" />
              </p>
            ) : null}
            {e.ledgerTx ? (
              <div className="small muted">
                Defter: <HashText hash={e.ledgerTx} chars={8} to={routes.tx(e.ledgerTx)} copy={false} label="Evre değişikliği işlemi" />
              </div>
            ) : null}
          </li>
        );
      })}
      {next.map((s) => {
        const h = durationOf(s, p.params);
        return (
          <li key={`next-${s}`} className="timeline-item is-future">
            <strong>{PROPOSAL_STATUS_LABELS[s]}</strong>
            <span className="small muted"> · beklenen{h ? ` · ${formatHours(h)}` : ""}</span>
            {PHASE_HINT[s] ? <p className="small muted">{PHASE_HINT[s]}</p> : null}
          </li>
        );
      })}
    </ol>
  );
}

/** Başlığın altında kısa evre şeridi (mobilde de görünür). */
export function PhaseStrip({ proposal: p }: { proposal: ProposalDetail }) {
  const visited = new Set(p.events.map((e) => e.to));
  visited.add(p.status);
  const terminal = TERMINAL.includes(p.status);
  const reconciled = visited.has("reconciliation") || visited.has("revote");
  const pastVoting = reconciled || terminal || p.status === "objection_window";
  const steps: { key: ProposalStatus | "result"; label: string }[] = [
    ...(p.status === "draft" ? [{ key: "draft" as const, label: "Taslak" }] : []),
    { key: "sponsoring", label: "Destek" },
    { key: "deliberation", label: "Tartışma" },
    { key: "voting", label: "Oylama" },
  ];
  if (objectionApplies(p) && (visited.has("objection_window") || !pastVoting)) steps.push({ key: "objection_window", label: "İtiraz" });
  if (reconciled) {
    steps.push({ key: "reconciliation", label: "Uzlaşma" });
    steps.push({ key: "revote", label: "Yeniden oylama" });
  }
  steps.push({ key: "result", label: terminal ? PROPOSAL_STATUS_LABELS[p.status] : "Sonuç" });

  const order = steps.map((s) => s.key);
  const curIndex = terminal ? order.length - 1 : order.indexOf(p.status);

  return (
    <ol className="phase-strip" aria-label="Evreler">
      {steps.map((s, i) => {
        const state = terminal ? (i === order.length - 1 ? "final" : visited.has(s.key as ProposalStatus) ? "done" : "skipped") : i < curIndex ? "done" : i === curIndex ? "current" : "todo";
        const srState = state === "done" ? "tamamlandı" : state === "current" ? "şu anki evre" : state === "final" ? "sonuç" : state === "skipped" ? "yaşanmadı" : "sırada";
        return (
          <li key={s.key} className={cx("phase-step", `phase-${state}`, s.key === "result" && terminal && `phase-result-${p.status}`)} aria-current={state === "current" ? "step" : undefined}>
            <span className="phase-dot" aria-hidden="true">
              {state === "done" ? "✔" : i + 1}
            </span>
            <span className="phase-label">{s.label}</span>
            <span className="sr-only"> ({srState})</span>
          </li>
        );
      })}
    </ol>
  );
}
