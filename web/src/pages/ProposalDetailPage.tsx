// Öneri ayrıntısı — sistemin vitrini: başlık ve evre, zaman çizelgesi, evreye göre eylem paneli (destek, metin önerileri,
// oy, itiraz, uzlaşma), kesin sonuçlar ve tarayıcıda yeniden sayım, denetim/parametre kartları, bilirkişi paneli,
// YZ özeti, sürüm geçmişi, defter kayıtları ve tartışma.
import { useCallback, useState } from "react";
import { Link, useParams } from "react-router-dom";
import {
  LEDGER_TX_LABELS,
  type AiAnalysisInfo,
  type LedgerTxType,
  type MessageView,
  type MinorityReport,
  type ProposalDetail,
  type ProposalStatus,
  type Suggestion,
} from "@forum/shared";
import { getProposal } from "../api/endpoints";
import { useAuth } from "../auth/AuthContext";
import { UserLink } from "../components/UserLink";
import { AiSummaryCard } from "../components/participation/AiSummaryCard";
import { AuditCard } from "../components/participation/AuditCard";
import { Discussion } from "../components/participation/Discussion";
import { ExpertPanelCard } from "../components/participation/ExpertPanelCard";
import { IntegrityCard } from "../components/participation/IntegrityCard";
import { ObjectionPanel } from "../components/participation/ObjectionPanel";
import { ParamsCard } from "../components/participation/ParamsCard";
import { PhaseStrip, PhaseTimeline } from "../components/participation/PhaseTimeline";
import { ProposalEditor } from "../components/participation/ProposalEditor";
import { AmendmentDiff, DeletionTargets, EnactedEffect, RegulationPatchView } from "../components/participation/ProposalSubject";
import { MinorityReportForm, ReconciliationPanel } from "../components/participation/ReconciliationPanel";
import { MinorityReportList, ResultsCard } from "../components/participation/ResultsCard";
import { RightsFlags } from "../components/participation/RightsFlags";
import { SponsorPanel, WithdrawButton } from "../components/participation/SponsorPanel";
import { SuggestionsPanel } from "../components/participation/SuggestionsPanel";
import { VerifyTallyPanel } from "../components/participation/VerifyTallyPanel";
import { VersionHistory } from "../components/participation/VersionHistory";
import { VotePanel } from "../components/participation/VotePanel";
import { PlainText, SubHeading } from "../components/participation/common";
import { useOntology } from "../lib/categories";
import { proposalRef } from "../lib/format";
import { routes } from "../lib/routes";
import { useAsync } from "../lib/useAsync";
import { Alert, Badge, Button, Card, Countdown, ErrorView, HashText, KindBadge, PageHeader, Section, Spinner, StatusBadge, TierBadge, Time } from "../ui";

const TERMINAL: ProposalStatus[] = ["enacted", "rejected", "withdrawn", "expired", "inadmissible"];

const PHASE_PREFIX: Partial<Record<ProposalStatus, string>> = {
  sponsoring: "Destek süresi",
  deliberation: "Tartışma",
  voting: "Oylama",
  objection_window: "İtiraz süresi",
  reconciliation: "Uzlaşma",
  revote: "Yeniden oylama",
};

export default function ProposalDetailPage() {
  const { id = "" } = useParams();
  const { categoryLabel, categoryPath } = useOntology();
  const { data: p, error, loading, reload, setData } = useAsync(() => getProposal(id), [id], { pollMs: 30_000 });
  const [threadMessages, setThreadMessages] = useState<Map<string, MessageView>>(() => new Map());
  const onMessages = useCallback((ms: MessageView[]) => setThreadMessages(new Map(ms.map((m) => [m.id, m] as const))), []);

  if (loading && !p) return <Spinner block label="Öneri yükleniyor…" />;
  if (error && !p) return <ErrorView error={error} onRetry={reload} />;
  if (!p) return null;

  const update = (d: ProposalDetail) => setData(d);
  const addAnalysis = (a: AiAnalysisInfo) => setData((prev) => (prev ? { ...prev, aiAnalyses: [a, ...prev.aiAnalyses.filter((x) => x.id !== a.id)] } : prev));
  // Rapor yalnız görüntüleyenin kendisi tarafından eklenir → tek rapor kuralı gereği form kapanır.
  const addMinority = (r: MinorityReport) =>
    setData((prev) => (prev ? { ...prev, minorityReports: [...prev.minorityReports.filter((x) => x.id !== r.id), r], canWriteMinorityReport: false } : prev));
  const addSuggestion = (s: Suggestion) => setData((prev) => (prev ? { ...prev, suggestions: [...prev.suggestions.filter((x) => x.id !== s.id), s] } : prev));
  const refresh = () => void reload();

  const terminal = TERMINAL.includes(p.status);
  // Eski sunucu sürümüyle (ör. güncellenmemiş Android istemcisi) uyum: alan yoksa boş say.
  const integrityWarnings = p.integrityWarnings ?? [];
  const lastEvent = p.events.length ? p.events.slice().sort((a, b) => a.at - b.at)[p.events.length - 1] : null;
  const currentVersion = p.versions.find((v) => v.version === p.version);
  const results = p.results.slice().sort((a, b) => a.round - b.round);

  return (
    <div className="page proposal-page">
      <PageHeader
        title={p.title}
        docTitle={`${proposalRef(p.seq)} ${p.title}`}
        back={{ to: routes.proposals(), label: "Öneriler" }}
        meta={
          <>
            <Badge tone="neutral">{proposalRef(p.seq)}</Badge>
            <KindBadge kind={p.kind} />
            <StatusBadge status={p.status} />
            {p.tier ? <TierBadge tier={p.tier} /> : null}
            {p.extensionUsed ? <Badge tone="warning">Süre uzatıldı</Badge> : null}
            {integrityWarnings.length ? (
              <Badge tone="warning" icon="warning" title="Kilit adım taraması: karar değişmez, denetim içindir (ayrıntı: Bütünlük uyarıları kartı)">
                Bütünlük uyarısı ({integrityWarnings.length})
              </Badge>
            ) : null}
          </>
        }
        subtitle={
          <>
            <UserLink id={p.authorId} nickname={p.authorNickname} /> · <Time at={p.createdAt} /> · sürüm {p.version}
            {p.parentTopic ? (
              <>
                {" "}
                · Üst konu: <Link to={routes.topic(p.parentTopic.id)}>{p.parentTopic.title}</Link>
              </>
            ) : null}
          </>
        }
        actions={
          !terminal && p.phaseEndsAt ? (
            <Countdown to={p.phaseEndsAt} prefix={PHASE_PREFIX[p.status]} onDone={() => window.setTimeout(refresh, 2500)} className="header-countdown" />
          ) : null
        }
      />
      {p.categories.length ? (
        <div className="chips" aria-label="Kategoriler">
          {p.categories.map((c) => (
            <span key={c} className="badge badge-info" title={categoryPath(c)}>
              {categoryLabel(c)}
            </span>
          ))}
        </div>
      ) : null}
      <PhaseStrip proposal={p} />

      <StatusNotice proposal={p} lastReason={lastEvent?.reason ?? null} />

      <div className="split">
        <div className="stack">
          <Card
            title={p.kind === "deletion" ? "Silme talebi" : p.kind === "regulation" ? "Yönetmelik değişikliği" : "Öneri metni"}
            footer={
              currentVersion ? (
                <span className="small muted">
                  Sürüm {p.version} özeti <HashText hash={currentVersion.contentHash} chars={10} label="Metin özeti" />
                </span>
              ) : undefined
            }
          >
            <div className="stack">
              <PlainText text={p.body} />
              {p.kind === "amendment" ? <AmendmentDiff proposal={p} /> : null}
              {p.deletion ? <DeletionTargets deletion={p.deletion} enacted={p.status === "enacted"} bodyShown={p.body} /> : null}
              {p.regulationPatch ? <RegulationPatchView patch={p.regulationPatch} /> : null}
            </div>
          </Card>

          <ActionArea proposal={p} onUpdated={update} onReload={refresh} setData={setData} onSuggestion={addSuggestion} onMinority={addMinority} onAnalysis={addAnalysis} />

          {results.length ? (
            <Section title="Sonuçlar" description="Kesin turların sonuçları. Ara sayım hiçbir zaman açıklanmaz." id="sonuclar">
              {results.map((r, i) => (
                <ResultsCard
                  key={r.round}
                  result={r}
                  reconciliationOrigin={p.reconciliationOrigin}
                  minorityReports={i === results.length - 1 && !["reconciliation", "objection_window"].includes(p.status) ? p.minorityReports : undefined}
                  myEffectiveVia={i === results.length - 1 ? p.myEffectiveVia : null}
                />
              ))}
              <VerifyTallyPanel proposalId={p.id} results={results} />
            </Section>
          ) : null}

          {p.status !== "objection_window" && (p.objectionEvaluation || p.objections.length) ? <ObjectionPanel proposal={p} onUpdated={update} /> : null}
          {p.reconciliationOrigin && p.status !== "reconciliation" && p.status !== "revote" ? (
            <ReconciliationPanel proposal={p} onUpdated={update} onReload={refresh} onMinorityReport={addMinority} onNewAnalysis={addAnalysis} />
          ) : null}

          {p.status !== "draft" ? <AiSummaryCard proposal={p} messages={threadMessages} onNewAnalysis={addAnalysis} /> : null}
          {p.status !== "draft" && (p.expertPanel || (!terminal && p.kind !== "deletion")) ? <ExpertPanelCard proposal={p} onUpdated={update} /> : null}
          {p.status !== "deliberation" && p.suggestions.length ? (
            <Card title={`Metin önerileri (${p.suggestions.length})`}>
              <SuggestionsPanel proposal={p} onUpdated={update} onAdded={addSuggestion} showHeading={false} />
            </Card>
          ) : null}
        </div>

        <aside className="stack" aria-label="Öneri bilgileri">
          <Card title="Zaman çizelgesi" subtitle="Her evre geçişi dağıtık deftere yazılır.">
            <PhaseTimeline proposal={p} />
          </Card>
          <AuditCard audit={p.audit} />
          <IntegrityCard warnings={integrityWarnings} />
          <ParamsCard params={p.params} status={p.status} votingRound={p.votingRound} />
          <Card title={`Destekçiler (${p.sponsorCount}/${p.sponsorsRequired})`}>
            {p.sponsors.length ? (
              <ul className="plain-list stack-sm small">
                {p.sponsors.map((s) => (
                  <li key={s.userId} className="row-between">
                    <UserLink id={s.userId} nickname={s.nickname} />
                    <Time at={s.at} className="muted" />
                  </li>
                ))}
              </ul>
            ) : (
              <p className="small muted">Henüz destekçi yok.</p>
            )}
          </Card>
          <Card title="Sürüm geçmişi" subtitle="Eski sürümler silinmez; iki sürüm seçip farkı görün.">
            <VersionHistory
              label="Öneri"
              current={p.version}
              versions={p.versions.map((v) => {
                const s = v.viaSuggestionId ? p.suggestions.find((x) => x.id === v.viaSuggestionId) : null;
                return {
                  version: v.version,
                  title: v.title,
                  body: v.body,
                  createdAt: v.createdAt,
                  contentHash: v.contentHash,
                  note: s ? (
                    <>
                      <UserLink id={s.authorId} nickname={s.authorNickname} /> önerisiyle (yazar kabul etti)
                    </>
                  ) : (
                    <>
                      Yazan: <UserLink id={v.authorId} nickname={v.authorNickname} />
                    </>
                  ),
                };
              })}
            />
          </Card>
          <Card title="Defter kayıtları" subtitle="Bu öneriyle ilgili dağıtık defter işlemleri (kişisel veri içermez).">
            <LedgerList txs={p.ledgerTxs} />
          </Card>
        </aside>
      </div>

      <Discussion
        threadType="proposal"
        threadId={p.id}
        onMessagesChange={onMessages}
        closedReason={p.status === "draft" ? "Taslak önerinin tartışması, öneri destekçi toplamaya gönderilince açılır." : null}
      />
    </div>
  );
}

function StatusNotice({ proposal: p, lastReason }: { proposal: ProposalDetail; lastReason: string | null }) {
  switch (p.status) {
    case "enacted":
      return <EnactedEffect proposal={p} />;
    case "rejected":
      return (
        <Alert tone="error" title="Öneri reddedildi">
          {lastReason ? <p>{lastReason}</p> : null}
          {p.kind === "deletion" ? <p className="small">Silme talebi herkese açık olarak arşivlendi; hedef mesajlar görünür kalır.</p> : null}
        </Alert>
      );
    case "inadmissible":
      return (
        <Alert tone="error" title="Yönetmeliğe aykırı — oylanamaz">
          {lastReason ? <p>{lastReason}</p> : null}
          {p.audit?.violations.length ? (
            <ul>
              {p.audit.violations.map((v, i) => (
                <li key={i}>{v.message}</li>
              ))}
            </ul>
          ) : null}
          <p className="small">Değiştirilemez maddelere aykırı öneriler kural gereği geçersizdir (Anayasa md. 4 modeli). Ayrıntılar ontoloji denetimi kartında.</p>
        </Alert>
      );
    case "withdrawn":
      return (
        <Alert tone="info" title="Öneri geri çekildi">
          {lastReason ?? "Yazar öneriyi geri çekti."} Kayıt herkese açık arşivde kalır.
        </Alert>
      );
    case "expired":
      return (
        <Alert tone="info" title="Süresi doldu">
          {lastReason ?? "Destekçi toplama süresinde yeterli destek gelmedi."}
        </Alert>
      );
    default:
      return null;
  }
}

interface ActionAreaProps {
  proposal: ProposalDetail;
  onUpdated: (p: ProposalDetail) => void;
  onReload: () => void;
  setData: (fn: (prev: ProposalDetail | undefined) => ProposalDetail | undefined) => void;
  onSuggestion: (s: Suggestion) => void;
  onMinority: (r: MinorityReport) => void;
  onAnalysis: (a: AiAnalysisInfo) => void;
}

function ActionArea({ proposal: p, onUpdated, onReload, setData, onSuggestion, onMinority, onAnalysis }: ActionAreaProps) {
  switch (p.status) {
    case "draft":
      return <SponsorPanel proposal={p} onUpdated={onUpdated} />;
    case "sponsoring":
      return (
        <>
          <SponsorPanel proposal={p} onUpdated={onUpdated} />
          {p.kind !== "deletion" ? (
            <Card title="Hak etkisi">
              <RightsFlags proposal={p} onUpdated={onUpdated} showHeading={false} />
            </Card>
          ) : null}
        </>
      );
    case "deliberation":
      return <DeliberationPanel proposal={p} onUpdated={onUpdated} onSuggestion={onSuggestion} />;
    case "voting":
      return <VotePanel proposal={p} setProposal={setData} reload={onReload} />;
    case "revote":
      return (
        <>
          <VotePanel proposal={p} setProposal={setData} reload={onReload} />
          <ReconciliationPanel proposal={p} onUpdated={onUpdated} onReload={onReload} onMinorityReport={onMinority} onNewAnalysis={onAnalysis} />
        </>
      );
    case "objection_window":
      return (
        <>
          <ObjectionPanel proposal={p} onUpdated={onUpdated} />
          <Card title={`Azınlık raporları (${p.minorityReports.length})`} subtitle="Karşı görüştekilerin gerekçeleri karar kaydına kalıcı olarak eklenir.">
            <div className="stack-sm">
              {p.minorityReports.length ? <MinorityReportList reports={p.minorityReports} /> : <p className="small muted">Henüz azınlık raporu yok.</p>}
              <MinorityReportForm proposal={p} onAdded={onMinority} />
            </div>
          </Card>
        </>
      );
    case "reconciliation":
      return <ReconciliationPanel proposal={p} onUpdated={onUpdated} onReload={onReload} onMinorityReport={onMinority} onNewAnalysis={onAnalysis} />;
    default:
      return null;
  }
}

function DeliberationPanel({ proposal: p, onUpdated, onSuggestion }: { proposal: ProposalDetail; onUpdated: (p: ProposalDetail) => void; onSuggestion: (s: Suggestion) => void }) {
  const auth = useAuth();
  const [editing, setEditing] = useState(false);
  const isAuthor = auth.user?.id === p.authorId;
  return (
    <Card
      title="Tartışma evresi"
      subtitle="Metin bu evrede değişebilir; oylama başlarken kilitlenir. Her değişiklik yeni sürüm üretir."
      actions={<Countdown to={p.phaseEndsAt} prefix="Oylamaya" />}
    >
      <div className="stack">
        {isAuthor ? (
          editing ? (
            <ProposalEditor
              proposal={p}
              note="Yeni sürüm yeniden ontoloji denetiminden geçer; ihlal çıkarsa kaydedilmez."
              onCancel={() => setEditing(false)}
              onSaved={(d) => {
                setEditing(false);
                onUpdated(d);
              }}
            />
          ) : (
            <div className="row">
              <Button variant="primary" onClick={() => setEditing(true)}>
                Metni düzenle (yeni sürüm)
              </Button>
              <WithdrawButton proposal={p} onUpdated={onUpdated} />
            </div>
          )
        ) : null}
        <SuggestionsPanel proposal={p} onUpdated={onUpdated} onAdded={onSuggestion} />
        {p.kind !== "deletion" ? <RightsFlags proposal={p} onUpdated={onUpdated} /> : null}
      </div>
    </Card>
  );
}

function LedgerList({ txs }: { txs: ProposalDetail["ledgerTxs"] }) {
  const [all, setAll] = useState(false);
  if (!txs.length) return <p className="small muted">Henüz defter kaydı yok.</p>;
  const sorted = txs.slice().sort((a, b) => b.at - a.at);
  const counts = new Map<string, number>();
  for (const t of txs) counts.set(t.type, (counts.get(t.type) ?? 0) + 1);
  const label = (t: string) => LEDGER_TX_LABELS[t as LedgerTxType] ?? t;
  const shown = all ? sorted : sorted.slice(0, 8);
  return (
    <div className="stack-sm">
      <p className="small muted">
        {[...counts.entries()].map(([t, n]) => `${label(t)}: ${n}`).join(" · ")}
      </p>
      <SubHeading level={4}>Son kayıtlar</SubHeading>
      <ul className="plain-list stack-sm small ledger-list">
        {shown.map((t) => (
          <li key={t.txHash}>
            <div className="row-between">
              <span>{label(t.type)}</span>
              <Time at={t.at} className="muted" />
            </div>
            <HashText hash={t.txHash} chars={12} to={routes.tx(t.txHash)} copy={false} label="İşlem özeti" />
          </li>
        ))}
      </ul>
      {sorted.length > 8 ? (
        <Button size="sm" variant="ghost" onClick={() => setAll((x) => !x)}>
          {all ? "Daha az göster" : `Tümünü göster (${sorted.length})`}
        </Button>
      ) : null}
    </div>
  );
}
