// Öneri ayrıntısı — sistemin vitrini. Sayfa SEKMESİZ tek akıştır (DOM sırası = okuma sırası):
//   1) Başlık: #K-n, durum ve tür; T0 dışı katman, uzatma ve bütünlük uyarısı koşullu; yazar · zaman · sürüm; ilk 3 kategori ve '+n'.
//   2) Evre şeridi (telefonda kompakt).
//   3) Sıradaki adım kartı: tek cümle, kalan süre (süre dolunca otomatik yenileme), birincil eylem BAĞLANTISI ve en çok 2 soru
//      bağlantısı (lib/nextStep.ts). Terminal evrelerde karar/ret/aykırılık/geri çekilme/süre dolması bildirimi buradadır.
//   4) 'Bu sayfada' gezinmesi (yalnız var olan bölümler).
//   5) Ana akış: öneri metni (kırpılmış) → eylem alanı (id="eylem") → Sonuçlar (id="sonuclar"; içinde #dogrula) → pasif itiraz
//      ve uzlaşma → bilirkişi görüşü (#bilirkisi) → (terminalde) metin önerileri → YZ özeti → TARTIŞMA (#tartisma, hep bağlı).
//   6) 'Kanıtlar ve denetim' sütunu (#kanitlar): masaüstünde sağda, telefonda tartışmadan sonra; bütünlük uyarısı ve yönetmeliğe
//      aykırılık varsa ilgili kart en üstte ve açık gelir; başlıktaki düğme bütün kartları açar/katlar.
// Derin bağlantı: ?bolum=<çapa> (lib/sectionParam.ts) veri ve oturum yüklendikten sonra kartı açar, kaydırır, odağı taşır.
// Hiçbir kart kaldırılmadı; değişen yalnız sıra ve varsayılan açıklıktır ('Tam' görünümde her şey açık gelir).
import { Fragment, useCallback, useEffect, useId, useMemo, useState, type ReactNode } from "react";
import { Link, useParams } from "react-router-dom";
import {
  expandIri,
  type AiAnalysisInfo,
  type MessageView,
  type MinorityReport,
  type ProposalDetail,
  type ProposalStatus,
  type Suggestion,
} from "@forum/shared";
import { getProposal } from "../api/endpoints";
import { useAuth } from "../auth/AuthContext";
import { NextStepCard } from "../components/common/NextStepCard";
import { UserLink } from "../components/UserLink";
import { AiSummaryCard } from "../components/participation/AiSummaryCard";
import { AuditCard, auditHasProblem } from "../components/participation/AuditCard";
import { Discussion } from "../components/participation/Discussion";
import { evidenceOrder, EvidenceColumn, type EvidenceKey } from "../components/participation/EvidenceColumn";
import { ExpertPanelCard } from "../components/participation/ExpertPanelCard";
import { IntegrityCard } from "../components/participation/IntegrityCard";
import { LedgerCard } from "../components/participation/LedgerList";
import { ObjectionPanel } from "../components/participation/ObjectionPanel";
import { actionFocusSelector, hasActionArea, OnThisPage, PAGE_ANCHORS, proposalPageSections, showsExpertCard } from "../components/participation/OnThisPage";
import { ParamsCard } from "../components/participation/ParamsCard";
import { PhaseStrip, PhaseTimelineCard } from "../components/participation/PhaseTimeline";
import { ProposalEditor } from "../components/participation/ProposalEditor";
import { AmendmentDiff, DeletionTargets, RegulationPatchView } from "../components/participation/ProposalSubject";
import { MinorityReportForm, ReconciliationPanel } from "../components/participation/ReconciliationPanel";
import { MinorityReportList, ResultsCard } from "../components/participation/ResultsCard";
import { RightsFlags } from "../components/participation/RightsFlags";
import { SponsorPanel, WithdrawButton } from "../components/participation/SponsorPanel";
import { SuggestionsPanel } from "../components/participation/SuggestionsPanel";
import { VerifyTallyPanel } from "../components/participation/VerifyTallyPanel";
import { VersionHistory, versionHistorySummary } from "../components/participation/VersionHistory";
import { VotePanel } from "../components/participation/VotePanel";
import "../components/participation/proposal-page.css";
import { useOntology } from "../lib/categories";
import { useDetailLevel } from "../lib/detailLevel";
import { proposalRef } from "../lib/format";
import { proposalNextStep, viewerOf } from "../lib/nextStep";
import { routes } from "../lib/routes";
import { useSectionParam } from "../lib/sectionParam";
import { useAsync } from "../lib/useAsync";
import {
  Badge,
  Button,
  Card,
  ClampText,
  Countdown,
  Details,
  ErrorView,
  HashText,
  Icon,
  KindBadge,
  PageHeader,
  Section,
  Spinner,
  StatusBadge,
  statusTone,
  TierBadge,
  Time,
} from "../ui";

const TERMINAL: ProposalStatus[] = ["enacted", "rejected", "withdrawn", "expired", "inadmissible"];

/** Sıradaki adım kartındaki geri sayımın öneki (Countdown ekran okuyucuya sonuna "kaldı" ekler). */
const DEADLINE_PREFIX: Partial<Record<ProposalStatus, string>> = {
  sponsoring: "Destek toplamanın bitmesine",
  deliberation: "Oylamaya",
  voting: "Oylamanın bitmesine",
  objection_window: "İtiraz süresinin bitmesine",
  reconciliation: "Uzlaşmanın bitmesine",
  revote: "Yeniden oylamanın bitmesine",
};

/** Başlıkta görünen kategori sayısı; fazlası '+n' ile satır içinde açılır ('Tam' görünümde açık gelir). */
const HEADER_CATEGORIES = 3;

const EMPTY_MESSAGES: Map<string, MessageView> = new Map();

export default function ProposalDetailPage() {
  const { id = "" } = useParams();
  const auth = useAuth();
  const { data: p, error, loading, reload, setData } = useAsync(() => getProposal(id), [id], { pollMs: 30_000 });
  // Tartışma yüklenince dolar (YZ alıntıları ve 'Tartışma (n)' sayısı); yüklenene kadar null → öneri özetindeki sayı kullanılır.
  const [threadMessages, setThreadMessages] = useState<Map<string, MessageView> | null>(null);
  const onMessages = useCallback((ms: MessageView[]) => setThreadMessages(new Map(ms.map((m) => [m.id, m] as const))), []);
  useEffect(() => setThreadMessages(null), [id]);

  // Oturum yüklenirken görüntüleyen anonim görünür: kart ve ?bolum= oturum yüklenince çalışır.
  const viewer = useMemo(() => viewerOf({ user: auth.user, can: auth.can }), [auth.user, auth.can]);
  const ready = !!p && !auth.loading;
  const actionFocus = p ? actionFocusSelector(p, viewer.id) : undefined;
  useSectionParam(ready, actionFocus ? { focus: { [PAGE_ANCHORS.action]: actionFocus } } : {});

  if (loading && !p) return <Spinner block label="Öneri yükleniyor…" />;
  if (error && !p) return <ErrorView error={error} onRetry={reload} />;
  if (!p) return null;

  // Görüntüleyenin kendi eylemi (oy, destek, itiraz, rapor, bilirkişi görüşü …) bekleyen işlerini değiştirebilir: kabuktaki
  // 'Ana sayfa' rozeti ve kartlardaki 'Sizden bekleniyor' 60 sn'lik yoklamayı beklemeden yenilenir (lib/taskStore).
  const tasksChanged = () => void auth.refreshTasks();
  const update = (d: ProposalDetail) => {
    setData(d);
    tasksChanged();
  };
  const setProposal: typeof setData = (next) => {
    setData(next);
    tasksChanged();
  };
  const addAnalysis = (a: AiAnalysisInfo) => setData((prev) => (prev ? { ...prev, aiAnalyses: [a, ...prev.aiAnalyses.filter((x) => x.id !== a.id)] } : prev));
  // Rapor yalnız görüntüleyenin kendisi tarafından eklenir → tek rapor kuralı gereği form kapanır.
  const addMinority = (r: MinorityReport) => {
    setData((prev) => (prev ? { ...prev, minorityReports: [...prev.minorityReports.filter((x) => x.id !== r.id), r], canWriteMinorityReport: false } : prev));
    tasksChanged();
  };
  const addSuggestion = (s: Suggestion) => setData((prev) => (prev ? { ...prev, suggestions: [...prev.suggestions.filter((x) => x.id !== s.id), s] } : prev));
  const refresh = () => {
    void reload();
    tasksChanged();
  };

  const terminal = TERMINAL.includes(p.status);
  // Eski sunucu sürümüyle (ör. güncellenmemiş Android istemcisi) uyum: alan yoksa boş say.
  const integrityWarnings = p.integrityWarnings ?? [];
  const lastEvent = p.events.length ? p.events.slice().sort((a, b) => a.at - b.at)[p.events.length - 1] : null;
  const currentVersion = p.versions.find((v) => v.version === p.version);
  const results = p.results.slice().sort((a, b) => a.round - b.round);
  const messageCount = threadMessages ? threadMessages.size : p.messageCount;
  // Motor saf kalır; yalnız mesaj sayısı tartışmanın canlı sayısıyla verilir ('Bu sayfada' ve 'Tartışma (n)' ile aynı sayı).
  const step = auth.loading ? null : proposalNextStep({ ...p, messageCount }, viewer);

  const evidence: Record<EvidenceKey, ReactNode> = {
    butunluk: <IntegrityCard warnings={integrityWarnings} headingLevel={3} />,
    destekciler: (
      // Hep açık (e2e: 'Destekçiler (n/m)' bölgesi görünür).
      <Card title={`Destekçiler (${p.sponsorCount}/${p.sponsorsRequired})`} headingLevel={3} anchor="destekciler">
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
    ),
    evreler: <PhaseTimelineCard proposal={p} headingLevel={3} />,
    ontoloji: <AuditCard audit={p.audit} headingLevel={3} />,
    parametreler: (
      <ParamsCard
        params={p.params}
        status={p.status}
        votingRound={p.votingRound}
        eligible={p.participation?.eligible}
        resultQuorum={results.length ? results[results.length - 1].quorumRequired : null}
        headingLevel={3}
      />
    ),
    surumler: (
      <Card
        title="Sürüm geçmişi"
        subtitle="Eski sürümler silinmez; iki sürüm seçip farkı görün."
        headingLevel={3}
        collapsible
        summary={versionHistorySummary(p.versions, auth.now())}
        anchor="surumler"
      >
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
    ),
    defter: <LedgerCard txs={p.ledgerTxs} totals={p.ledgerTxCounts} headingLevel={3} />,
  };
  const evidenceKeys = evidenceOrder({ integrity: integrityWarnings.length > 0, auditProblem: !!p.audit && auditHasProblem(p.audit) });

  return (
    <div className="page proposal-page">
      {/* Başlık, kategoriler ve evre şeridi tek blok: aralarında sayfa boşluğundan dar boşluk (ilk ekran yer kazanır). */}
      <div className="proposal-head">
        <PageHeader
          title={p.title}
          docTitle={`${proposalRef(p.seq)} ${p.title}`}
          back={{ to: routes.proposals(), label: "Öneriler" }}
          meta={
            <>
              {/* Rozet bütçesi: tek renkli durum rozeti; no düz metin, katman yalnız T0 dışındaysa (T0 ontoloji hükmünde yazar). */}
              <span className="proposal-ref">{proposalRef(p.seq)}</span>
              <StatusBadge status={p.status} />
              <KindBadge kind={p.kind} />
              {p.tier && p.tier !== "T0" ? <TierBadge tier={p.tier} neutral={statusTone(p.status) !== "neutral"} explain /> : null}
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
        />
        <CategoryTags categories={p.categories} />
        <PhaseStrip proposal={p} />
      </div>

      <NextStepCard
        proposalId={p.id}
        step={step}
        deadline={
          !terminal && p.phaseEndsAt ? (
            <Countdown
              to={p.phaseEndsAt}
              prefix={DEADLINE_PREFIX[p.status]}
              doneText="süre doldu — evre geçişi bekleniyor"
              onDone={() => window.setTimeout(refresh, 2500)}
            />
          ) : null
        }
        when={
          terminal && lastEvent ? (
            <p className="next-step-when">
              <Icon name="clock" size={14} />
              <Time at={lastEvent.at} mode="both" />
            </p>
          ) : null
        }
      >
        {p.status === "inadmissible" ? <InadmissibleExplainer proposal={p} shown={step?.detail ?? null} /> : null}
      </NextStepCard>

      <OnThisPage proposalId={p.id} sections={proposalPageSections(p, messageCount)} />

      <div className="split proposal-split">
        <div className="stack proposal-main">
          <Card
            title={p.kind === "deletion" ? "Silme talebi" : p.kind === "regulation" ? "Yönetmelik değişikliği" : "Öneri metni"}
            anchor={PAGE_ANCHORS.text}
            footer={
              currentVersion ? (
                <span className="small muted">
                  Sürüm {p.version} özeti <HashText hash={currentVersion.contentHash} chars={10} label="Metin özeti" />
                </span>
              ) : undefined
            }
          >
            <div className="stack">
              <ClampText text={p.body} />
              {p.kind === "amendment" ? <AmendmentDiff proposal={p} /> : null}
              {p.deletion ? <DeletionTargets deletion={p.deletion} enacted={p.status === "enacted"} bodyShown={p.body} /> : null}
              {p.regulationPatch ? <RegulationPatchView patch={p.regulationPatch} /> : null}
            </div>
          </Card>

          {hasActionArea(p.status) ? (
            // ?bolum=eylem hedefi: evrenin paneli (oy, destek, itiraz, uzlaşma, tartışma evresi, taslak); paneller 'eylem önce'.
            <div id={PAGE_ANCHORS.action} className="stack action-area">
              <ActionArea proposal={p} onUpdated={update} onReload={refresh} setData={setProposal} onSuggestion={addSuggestion} onMinority={addMinority} onAnalysis={addAnalysis} />
            </div>
          ) : null}

          {results.length ? (
            <Section title="Sonuçlar" description="Kesin turların sonuçları. Ara sayım hiçbir zaman açıklanmaz." id={PAGE_ANCHORS.results}>
              {results.map((r, i) => (
                <ResultsCard
                  key={r.round}
                  result={r}
                  reconciliationOrigin={p.reconciliationOrigin}
                  minorityReports={i === results.length - 1 && !["reconciliation", "objection_window"].includes(p.status) ? p.minorityReports : undefined}
                  myEffectiveVia={i === results.length - 1 ? p.myEffectiveVia : null}
                />
              ))}
              {/* Kartın kendisi #dogrula çapasını taşır ('Sayımı doğrula' bağlantısı). */}
              <VerifyTallyPanel proposalId={p.id} results={results} />
            </Section>
          ) : null}

          {/* Pasif itiraz ve uzlaşma kayıtları (katlanmaz; e2e uzlaşma evresinde itiraz kartının içine bakar). */}
          {p.status !== "objection_window" && (p.objectionEvaluation || p.objections.length) ? <ObjectionPanel proposal={p} onUpdated={update} /> : null}
          {p.reconciliationOrigin && p.status !== "reconciliation" && p.status !== "revote" ? (
            <ReconciliationPanel proposal={p} onUpdated={update} onReload={refresh} onMinorityReport={addMinority} onNewAnalysis={addAnalysis} />
          ) : null}

          {showsExpertCard(p) ? <ExpertPanelCard proposal={p} onUpdated={update} /> : null}
          {p.status !== "deliberation" && p.suggestions.length ? (
            <Card title={`Metin önerileri (${p.suggestions.length})`}>
              <SuggestionsPanel proposal={p} onUpdated={update} onAdded={addSuggestion} showHeading={false} />
            </Card>
          ) : null}
          {/* YZ özeti tartışmanın hemen önünde: alıntılar aşağıdaki mesajlara kaydırır. */}
          {p.status !== "draft" ? <AiSummaryCard proposal={p} messages={threadMessages ?? EMPTY_MESSAGES} onNewAnalysis={addAnalysis} /> : null}

          <Discussion
            threadType="proposal"
            threadId={p.id}
            onMessagesChange={onMessages}
            closedReason={p.status === "draft" ? "Taslak önerinin tartışması, öneri destekçi toplamaya gönderilince açılır." : null}
          />
        </div>

        <EvidenceColumn id={PAGE_ANCHORS.evidence}>
          {evidenceKeys.map((k) => (
            <Fragment key={k}>{evidence[k]}</Fragment>
          ))}
        </EvidenceColumn>
      </div>
    </div>
  );
}

/** Başlıktaki kategoriler: ilk 3 etiket ve '+n' (satır içinde açılır; 'Tam' görünümde açık gelir). */
function CategoryTags({ categories }: { categories: string[] }) {
  const { categoryLabel, categoryPath } = useOntology();
  const { full } = useDetailLevel();
  const listId = useId();
  // null: kullanıcı dokunmadı → görünüm yoğunluğunu izler.
  const [open, setOpen] = useState<boolean | null>(null);
  if (!categories.length) return null;
  const extra = categories.length - HEADER_CATEGORIES;
  const expanded = open ?? full;
  return (
    <ul className="cat-tags proposal-cats" id={listId} aria-label="Kategoriler">
      {categories.map((c, i) => (
        <li key={c} className="cat-tag" title={categoryPath(c)} hidden={i >= HEADER_CATEGORIES && !expanded}>
          {categoryLabel(c)}
        </li>
      ))}
      {extra > 0 ? (
        <li>
          <button type="button" className="cat-tag cat-tag-more cat-tag-toggle" aria-expanded={expanded} aria-controls={listId} onClick={() => setOpen(!expanded)}>
            {expanded ? (
              <>
                Kısalt<span className="sr-only"> (kategori listesi)</span>
              </>
            ) : (
              <>
                +{extra}
                <span className="sr-only"> kategori daha göster</span>
              </>
            )}
          </button>
        </li>
      ) : null}
    </ul>
  );
}

/** Değiştirilemez hükümlere dayanan bulgu kodları (ontoloji henüz yüklenmemişse yedek olarak kullanılır). */
const ENTRENCHED_CODES = new Set([
  "core_right_restricted",
  "immutable_target",
  "new_immutable",
  "immutable_bypass",
  "protection_floor",
  "entrenchment_cap",
  "equal_vote_limit",
  "deletion_ground_invalid",
]);

/**
 * "Yönetmeliğe aykırı" bildiriminin Sıradaki adım kartındaki gövdesi (başlık ve ilk cümle motordan gelir): bulguların listesi
 * (kartta zaten yazılan tek bulgu tekrarlanmaz) ve 'Bu ne demek?' açılırında açıklama. Açıklama, ihlalin dayandığı maddenin
 * koruma düzeyine göre seçilir: yalnız değiştirilemez bir hükme aykırılık "kural gereği geçersiz" (Anayasa md. 4 modeli)
 * sayılır; olağan ya da nitelikli bir hükme aykırı öneri (ör. Madde 12 (2) içerik etiketi, Madde 10 (1) üst konu) düzeltilip
 * yeniden sunulabilir. Ayrıntılar ontoloji denetimi kartındadır (aykırılıkta açık gelir).
 */
function InadmissibleExplainer({ proposal: p, shown }: { proposal: ProposalDetail; shown: string | null }) {
  const { ontology } = useOntology();
  const violations = p.audit?.violations ?? [];
  const immutableArticles = new Set((ontology?.articles ?? []).filter((a) => a.protection === "Degistirilemez").map((a) => expandIri(a.iri)));
  const entrenched =
    p.audit?.tier === "T3" || violations.some((v) => ENTRENCHED_CODES.has(v.code) || (!!v.article && immutableArticles.has(expandIri(v.article))));
  const articles = [...new Set(violations.map((v) => v.articleLabel).filter((l): l is string => !!l))];
  const where = articles.length ? ` (${articles.join(", ")})` : "";
  const listed = violations.length === 1 && violations[0].message === shown ? [] : violations;
  return (
    <>
      {listed.length ? (
        <ul className="next-step-findings">
          {listed.map((v, i) => (
            <li key={i}>{v.message}</li>
          ))}
        </ul>
      ) : null}
      <Details summary="Bu ne demek?">
        {entrenched ? (
          <p className="small">
            Öneri değiştirilemez bir hükme aykırı{where}. Böyle öneriler oylamaya hiç girmeden kural gereği geçersizdir (Anayasa md. 4 modeli). Ayrıntılar ontoloji
            denetimi kartında.
          </p>
        ) : (
          <p className="small">
            Öneri, değiştirilemez olmayan bir yönetmelik hükmüne aykırı bulundu{where}. Bu bir oylama sonucu değil, otomatik denetimin sonucudur; yazar metni düzeltip
            yeni bir öneri olarak yeniden sunabilir. Ayrıntılar ontoloji denetimi kartında.
          </p>
        )}
      </Details>
    </>
  );
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

/**
 * Evrenin eylem paneli ('eylem önce': evrenin asıl işi her zaman ilk paneldir). ?bolum=eylem odağı bu alanın ilk görünür
 * denetimine gider (oyda ilk radyo, itirazda 'Gerekçe'; bkz. actionFocusSelector).
 */
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

/**
 * Tartışma evresi paneli ('eylem önce'): yazarın düğmeleri (metni düzenle, geri çek) en üstte; ardından metin önerileri
 * (yazar için karar düğmeleri, üyeler için öneri formu) ve hak etkisi bayrakları; evrenin kuralını anlatan cümle en altta.
 * Oylamaya kalan süre başlıkta.
 */
function DeliberationPanel({ proposal: p, onUpdated, onSuggestion }: { proposal: ProposalDetail; onUpdated: (p: ProposalDetail) => void; onSuggestion: (s: Suggestion) => void }) {
  const auth = useAuth();
  const [editing, setEditing] = useState(false);
  const isAuthor = auth.user?.id === p.authorId;
  return (
    <Card title="Tartışma evresi" actions={<Countdown to={p.phaseEndsAt} prefix="Oylamaya" />}>
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
        {/* ?bolum=eylem ile gelen yazarın odağı yanıt bekleyen ilk önerinin karar düğmesine gider (actionFocusSelector). */}
        <div className="deliberation-suggestions">
          <SuggestionsPanel proposal={p} onUpdated={onUpdated} onAdded={onSuggestion} />
        </div>
        {p.kind !== "deletion" ? <RightsFlags proposal={p} onUpdated={onUpdated} /> : null}
        <p className="small muted">Metin bu evrede değişebilir; oylama başlarken kilitlenir. Her değişiklik yeni sürüm üretir.</p>
      </div>
    </Card>
  );
}
