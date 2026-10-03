// Canlı ön denetim paneli (POST /api/proposals/precheck — yan etkisiz). 'Önce hüküm': yönetmeliğe uygunluk hükmü, katman,
// bilirkişi ve gerekli destekçi sayısı her zaman görünür. Ontoloji bulguları, karar parametreleri, YZ önerileri (danışma) ve
// benzer öneriler adlandırılmış açılırlardadır ve duruma göre AÇIK gelir: ihlal ya da uyarı → Bulgular, eklenmemiş YZ kategori
// önerisi → YZ önerileri, yüksek benzerlik → Benzer öneriler ('Tam' görünümde hepsi açık). Salam taktiği uyarıları ve kişisel
// veri bulguları yalnız varken, açık uyarı kutusu olarak görünür. Parametre ve bulgu görünümleri dışa da açıktır.
// YZ önerileri yalnız kullanıcı henüz hiç kategori seçmemişken açılır: seçtikten sonra kalan öneriler formdaki kategori seçicide
// ('Önerilen (YZ, danışma)') ve açılırın başlık yanı hükmünde görünür; panel her yazışta yeniden büyümez. Kendiliğinden açılan
// açılır ilk 'Ekle' ile kapanmaz (ikinci öneri de eklenebilsin); 'Ekle' rozete dönünce odak sıradaki 'Ekle'ye geçer.
// Rozet bütçesi: paneldeki tek renkli öğe uygunluk hükmüdür; katman, bilirkişi ve sayaçlar gridir.
import { useEffect, useState, type MouseEvent, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { expandIri, type AuditReport, type DecisionParams, type Finding, type PrecheckResponse, type Severity, type Tier } from "@forum/shared";
import { getProposal } from "../../api/endpoints";
import { useAuth } from "../../auth/AuthContext";
import { useOntology } from "../../lib/categories";
import { useDetailLevel } from "../../lib/detailLevel";
import { formatDuration, formatHours, formatPercent, proposalRef } from "../../lib/format";
import { isNativePlatform } from "../../lib/prefs";
import { routes } from "../../lib/routes";
import { useAsync } from "../../lib/useAsync";
import {
  AiLabel,
  Alert,
  Badge,
  Button,
  Card,
  Details,
  ErrorView,
  KeyValue,
  KindBadge,
  Modal,
  Spinner,
  StatusBadge,
  Term,
  TermLink,
  TierBadge,
  type KeyValueItem,
  type Tone,
} from "../../ui";
import { PlainText } from "../participation/common";
import { paramRows, SymbolsSwitch, toKeyValueItem } from "../participation/ParamsCard";
import "./new-proposal.css";

export const TIER_EXPLAIN: Record<Tier, string> = {
  T0: "Olağan karar (yeni konu, alt konu). Onay yarıdan fazla olmalı ve anlamlı her görüş kümesinden asgari destek gelmeli (köprü testi).",
  T1: "Nitelikli karar: yürürlükteki bir konunun düzenlenmesi ya da bir temel hakkı kısıtlayan öneri. Daha yüksek katılım, onay ve küme tabanı aranır.",
  T2: "Yönetmelik değişikliği: en yüksek eşikler (en az 2/3 onay), daha uzun tartışma ve oylama süreleri uygulanır.",
  T3: "Değiştirilemez hüküm: öneri değiştirilemez bir maddeye dokunuyor ya da korumayı zayıflatıyor. Oylamaya hiç girmeden geçersiz sayılır.",
  DEL: "Silme (karartma) kararı: en az 2/3 onay, köprü testi ve mesaj yazarının kendi görüş kümesinde en az %50 destek gerekir. Mesaj yazarı bu oylamada seçmen değildir.",
};

export const PII_KIND_LABELS: Record<string, string> = {
  tckn: "T.C. kimlik no",
  iban: "IBAN",
  phone: "Telefon",
  email: "E-posta",
  address: "Adres",
};

// İhlal kırmızı (sonuç: oylamaya giremez) · uyarı turuncu (dikkat) · bilgi gri (mavi eylem ve 'şu an' içindir).
const SEVERITY: Record<Severity, { label: string; tone: Tone }> = {
  violation: { label: "İhlal", tone: "danger" },
  warning: { label: "Uyarı", tone: "warning" },
  info: { label: "Bilgi", tone: "neutral" },
};

const DURATION_ROWS: { key: keyof DecisionParams["durationsHours"]; label: string }[] = [
  { key: "sponsoring", label: "Destekçi toplama (azami)" },
  { key: "deliberation", label: "Tartışma" },
  { key: "voting", label: "Oylama" },
  { key: "extension", label: "Uzatma (bir kez)" },
  { key: "objection", label: "İtiraz penceresi" },
  { key: "reconciliation", label: "Uzlaşma (soğuma)" },
];

/** 'Benzer öneriler' bu benzerlikten itibaren kendiliğinden açık gelir (yerel metin karşılaştırması; listeye girme eşiği 0,15). */
export const HIGH_SIMILARITY = 0.5;

// ───────────── Saf yardımcılar (birim testli: proposals/newProposal.test.tsx) ─────────────

/** Bulgu sayıları: "1 ihlal · 2 uyarı · 1 bilgi"; bulgu yoksa boş dizgi. */
export function findingCounts(audit: Pick<AuditReport, "violations" | "warnings" | "infos">): string {
  return [
    audit.violations.length ? `${audit.violations.length} ihlal` : null,
    audit.warnings.length ? `${audit.warnings.length} uyarı` : null,
    audit.infos.length ? `${audit.infos.length} bilgi` : null,
  ]
    .filter((x): x is string => !!x)
    .join(" · ");
}

/** Formun altındaki özet satırının sayaçları: ihlal ve (denetim + genel) uyarı sayısı, "2 ihlal · 1 uyarı"; yoksa boş dizgi. */
export function precheckCounts(result: Pick<PrecheckResponse, "audit" | "warnings">): string {
  const warnings = result.audit.warnings.length + result.warnings.length;
  return [result.audit.violations.length ? `${result.audit.violations.length} ihlal` : null, warnings ? `${warnings} uyarı` : null]
    .filter((x): x is string => !!x)
    .join(" · ");
}

/** Açılırların başlık yanı hükümleri ve hangisinin kendiliğinden açık geleceği ('Uyarı yalnız gerektiğinde bağırır'). */
export interface PrecheckDisclosure {
  /** 'Bulgular (n)': ihlal ya da uyarı varsa açık */
  findings: { count: number; open: boolean; meta: string };
  /** 'YZ önerileri': forma eklenebilen bir YZ kategori önerisi varsa ve henüz hiç kategori seçilmemişse açık */
  ai: { open: boolean; meta: string };
  /** 'Benzer öneriler (n)': en az bir öneri HIGH_SIMILARITY ve üstündeyse açık */
  similar: { count: number; open: boolean; meta: string };
}

export function precheckDisclosure(
  result: Pick<PrecheckResponse, "audit" | "classification" | "similar">,
  opts: { selectedCategories?: readonly string[]; canAddCategory?: boolean } = {},
): PrecheckDisclosure {
  const a = result.audit;
  const c = result.classification;
  const selected = new Set((opts.selectedCategories ?? []).map(expandIri));
  const pending = opts.canAddCategory ? c.categories.filter((s) => !selected.has(expandIri(s.iri))).length : 0;
  const ai = [
    c.categories.length ? `${c.categories.length} kategori` : null,
    c.rightsAffected.length ? `${c.rightsAffected.length} hak etkisi` : null,
    c.contentLabels.length ? `${c.contentLabels.length} içerik işareti` : null,
  ].filter((x): x is string => !!x);
  const top = result.similar.reduce((m, s) => Math.max(m, s.score), 0);
  return {
    findings: { count: a.violations.length + a.warnings.length + a.infos.length, open: a.violations.length + a.warnings.length > 0, meta: findingCounts(a) || "bulgu yok" },
    ai: { open: pending > 0 && selected.size === 0, meta: ai.length ? ai.join(" · ") : "öneri yok" },
    similar: { count: result.similar.length, open: top >= HIGH_SIMILARITY, meta: result.similar.length ? `en yüksek ${formatPercent(top, 0)}` : "" },
  };
}

/**
 * Panelde hep görünen satırların karar parametreleri listesindeki karşılıkları (orada tekrar edilmez). Bilirkişi satırı panelde
 * yalnız bilirkişi gerekliyse görünür; değilse 'zorunlu değil' bilgisi parametre listesinde kalır.
 */
export function panelParamRows(requiresExpert: boolean): string[] {
  return requiresExpert ? ["tier", "sponsors", "expert"] : ["tier", "sponsors"];
}

// ───────────── Parçalar ─────────────

/**
 * Ontoloji bulguları: önem derecesi rozeti + Türkçe ileti + madde atfı. Madde bağlantısı Term bağlantı kipine uyar
 * (yeni öneri formunun yanında yeni sekmede açılır, yerel uygulamada düz metindir; form kaybolmaz).
 */
export function FindingList({ findings, empty }: { findings: Finding[]; empty?: ReactNode }) {
  const { articleLabel } = useOntology();
  if (!findings.length) return empty ? <>{empty}</> : null;
  return (
    <ul className="pre-findings">
      {findings.map((f, i) => {
        const s = SEVERITY[f.severity] ?? SEVERITY.info;
        const label = f.articleLabel ?? (f.article ? articleLabel(f.article) : null);
        const art = label && !f.message.includes(label) ? label : null;
        return (
          <li key={`${f.code}-${i}`} className={`pre-finding pre-finding-${f.severity}`}>
            <Badge tone={s.tone}>{s.label}</Badge>
            <span className="pre-finding-text">
              {f.message}
              {art ? (
                <>
                  {" "}
                  <TermLink to={routes.ontology()} className="pre-article" fallback={<span className="pre-article">({art})</span>}>
                    ({art})
                  </TermLink>
                </>
              ) : null}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

/**
 * Oylama açılışında sabitlenecek karar parametreleri: öneri sayfasındaki 'Karar parametreleri' kartıyla aynı sade satırlar
 * (ParamsCard › paramRows: etiketler sözlük terimi; Yunan sembolleri ve formüller 'Sembolleri ve formülleri göster' anahtarının
 * arkasında, 'Tam' görünümde açık) ve demo ölçeğiyle süreler. `omit`: başka yerde görünen satırların anahtarları ('tier', 'sponsors' …).
 */
export function DecisionParamsView({ params, sponsorsRequired, omit = [] }: { params: DecisionParams; sponsorsRequired?: number; omit?: readonly string[] }) {
  const { system } = useAuth();
  const { categoryLabel } = useOntology();
  const { full } = useDetailLevel();
  const [choice, setChoice] = useState<boolean | null>(null);
  const shown = choice ?? full;
  const p = sponsorsRequired !== undefined ? { ...params, sponsorsRequired } : params;
  const rows = paramRows(p, categoryLabel).filter((r) => !omit.includes(r.key));
  const scale = system?.timeScale && system.timeScale > 0 ? system.timeScale : 1;
  const dur = (h: number) => {
    if (!h) return "yok";
    const sim = formatHours(h);
    return scale !== 1 ? `${sim} (demo: ${formatDuration((h * 3_600_000) / scale, false)})` : sim;
  };
  return (
    <div className="stack-sm">
      <SymbolsSwitch shown={shown} onToggle={() => setChoice(!shown)} />
      <KeyValue compact items={rows.map((r) => toKeyValueItem(r, shown, p.tier))} />
      {shown ? (
        // ParamsCard › ParamsList ile aynı açıklama (formüllerdeki kısaltmalar)
        <p className="small muted param-legend">
          |E|: oylamadaki uygun seçmen sayısı · P_g: bir görüş grubunun yumuşatılmış desteği, (1 + Kabul) / (2 + Kabul + Red).
        </p>
      ) : null}
      <Details summary="Süreler">
        <KeyValue compact items={DURATION_ROWS.map((d) => ({ label: d.label, value: dur(params.durationsHours[d.key]) }))} />
        <p className="small muted mt-0">Süreler simüle saat cinsindendir; evre geçişlerini sunucudaki zamanlayıcı yapar.</p>
      </Details>
    </div>
  );
}

/** Formun altında tek satırlık ön denetim özeti (mobilde ayrıntılı panel aşağıda kalır). Tek renkli rozet hükümdür. */
export function PrecheckSummary({ result, loading, stale }: { result: PrecheckResponse | undefined; loading: boolean; stale: boolean }) {
  if (!result) return loading ? <Spinner label="Ön denetim yapılıyor…" showLabel /> : null;
  const a = result.audit;
  const counts = precheckCounts(result);
  return (
    <div className="pre-summary" role="status" aria-live="polite">
      <span className="small muted">Ön denetim:</span>
      <TierBadge tier={a.tier} short neutral />
      {a.admissible ? (
        <Badge tone="success" icon="check">
          Yönetmeliğe uygun
        </Badge>
      ) : (
        <Badge tone="danger" icon="error">
          Yönetmeliğe aykırı
        </Badge>
      )}
      {counts ? <span className="small pre-summary-counts">{counts}</span> : null}
      {result.pii.length ? (
        <Badge tone="warning" icon="warning">
          Kişisel veri olabilir
        </Badge>
      ) : null}
      <span className="small muted">{result.sponsorsRequired} destekçi gerekir</span>
      {loading || stale ? <Spinner size="sm" label="Güncelleniyor…" /> : null}
    </div>
  );
}

/**
 * Benzer önerinin önizlemesi (alt sayfa). Android uygulamasında `target="_blank"` yeni pencere açmaz, bağlantı aynı görünümde
 * açılır ve yazılmakta olan öneri formu (yalnız bellekte tutulur) kaybolur. Bu yüzden yerel platformda benzer öneri sayfadan
 * ayrılmadan burada gösterilir; donanım geri tuşu önce bu alt sayfayı kapatır.
 */
export function SimilarProposalPreview({ id, onClose }: { id: string; onClose: () => void }) {
  const { categoryLabel } = useOntology();
  const { data: p, error, loading, reload } = useAsync(() => getProposal(id), [id]);
  return (
    <Modal
      open
      sheet
      size="lg"
      onClose={onClose}
      title={p ? `${proposalRef(p.seq)} ${p.title}` : "Benzer öneri"}
      footer={
        <Button variant="primary" onClick={onClose}>
          Forma dön
        </Button>
      }
    >
      {loading && !p ? <Spinner block label="Öneri yükleniyor…" /> : null}
      {error && !p ? <ErrorView error={error} title="Öneri yüklenemedi" onRetry={reload} compact /> : null}
      {p ? (
        <div className="stack-sm">
          <div className="row">
            <StatusBadge status={p.status} />
            <KindBadge kind={p.kind} />
            {p.categories.length ? <span className="small muted">{p.categories.map(categoryLabel).join(", ")}</span> : null}
          </div>
          <PlainText text={p.body} />
          <p className="small muted mt-0">
            Bu önizleme yazdığınız formu korur. Önerinin tartışmasına katılmak isterseniz önce formunuzu “Taslak kaydet” ile kaydedin, sonra
            öneriyi Öneriler sayfasından açın.
          </p>
        </div>
      ) : null}
    </Modal>
  );
}

export interface PrecheckPanelProps {
  result: PrecheckResponse | undefined;
  loading: boolean;
  error: unknown;
  /** Girdi son sonuçtan sonra değişti (yeni denetim bekleniyor) */
  stale?: boolean;
  /** Ön denetim henüz çalıştırılamıyorsa açıklama */
  idleText?: string | null;
  onRetry?: () => void;
  selectedCategories?: string[];
  /** YZ'nin önerdiği kategoriyi kullanıcı tıklayarak ekler (otomatik eklenmez) */
  onAddCategory?: (iri: string) => void;
}

export function PrecheckPanel({ result, loading, error, stale, idleText, onRetry, selectedCategories = [], onAddCategory }: PrecheckPanelProps) {
  const { categoryLabel, rightLabel } = useOntology();
  // Android: benzer öneri yeni pencerede açılamaz; formu kaybetmemek için alt sayfada önizlenir.
  const native = isNativePlatform();
  const [previewId, setPreviewId] = useState<string | null>(null);
  const busy = loading || !!stale;
  const selected = new Set(selectedCategories.map(expandIri));
  const d = result ? precheckDisclosure(result, { selectedCategories, canAddCategory: !!onAddCategory }) : null;
  // 'YZ önerileri' bir kez kendiliğinden açıldıysa açık kalır (Details `open` değişince ona uyar: true → undefined olsaydı Sade
  // görünümde ilk 'Ekle' dokunuşunda kapanırdı). Kullanıcı kapatırsa kapalı kalır; sonuç gidince (tür değişti) sıfırlanır.
  const aiAuto = !!d?.ai.open && !idleText;
  const [aiLatched, setAiLatched] = useState(false);
  useEffect(() => {
    if (!result) setAiLatched(false);
    else if (aiAuto) setAiLatched(true);
  }, [result, aiAuto]);

  // 'Ekle' düğmesi 'Seçili' rozetine döner: odak body'ye düşmesin; listede sonraki 'Ekle'ye, yoksa ilk 'Ekle'ye, o da yoksa
  // açılırın başlığına geçer.
  const addSuggested = (iri: string, e: MouseEvent<HTMLButtonElement>) => {
    const item = e.currentTarget.closest("li");
    const list = item?.parentElement;
    const details = e.currentTarget.closest("details");
    onAddCategory?.(iri);
    window.requestAnimationFrame(() => {
      const buttons = Array.from(list?.querySelectorAll<HTMLButtonElement>("button:not([disabled])") ?? []).filter((b) => b.isConnected && !item?.contains(b));
      const next = buttons.find((b) => item && item.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) ?? buttons[0];
      (next ?? details?.querySelector<HTMLElement>("summary"))?.focus();
    });
  };

  const header = (
    <span className="pre-status" aria-live="polite">
      {busy && !idleText ? (
        <Spinner size="sm" label="Denetleniyor…" showLabel />
      ) : result && !idleText ? (
        <Badge tone="neutral" icon="check">
          Güncel
        </Badge>
      ) : null}
    </span>
  );

  let content: ReactNode;
  if (idleText) {
    content = <p className="muted">{idleText}</p>;
  } else if (error && !result) {
    content = <ErrorView error={error} title="Ön denetim yapılamadı" onRetry={onRetry} compact />;
  } else if (!result) {
    content = <Spinner block label="Ön denetim yapılıyor…" />;
  } else if (d) {
    const a = result.audit;
    const c = result.classification;
    const allFindings = [...a.violations, ...a.warnings, ...a.infos];
    const expertDomains = a.params?.expertDomains ?? [];
    // Kısa satırlar (etiket | değer; telefonda da yan yana). Katman kısa rozettir (dokununca sözlük penceresi); adı ve anlamı
    // altlarındaki paragrafta (TIER_EXPLAIN katmanın adıyla başlar).
    const keyRows: (KeyValueItem | null)[] = [
      { label: "Katman", value: <TierBadge tier={a.tier} short neutral explain /> },
      {
        label: (
          <>
            <Term id="gerekli-destekci">Gerekli destekçi</Term> (Kₛ)
          </>
        ),
        value: `${result.sponsorsRequired} doğrulanmış üye (yazar dışında)`,
      },
      a.requiresExpert
        ? {
            label: <Term id="bilirkisi">Bilirkişi</Term>,
            value: a.params?.requiresExpert ? `Gerekli · ${a.params.expertCount} kişilik panel` : "Gerekli",
            hint: expertDomains.length ? `Alanlar: ${expertDomains.map(categoryLabel).join(", ")}` : undefined,
          }
        : null,
      a.rightsAffected.length ? { label: "Etkilenen temel haklar", value: a.rightsAffected.map(rightLabel).join(", ") } : null,
    ];
    const p = a.params;
    content = (
      <div className="stack pre-body">
        {error ? <ErrorView error={error} title="Son denetim başarısız; önceki sonuç gösteriliyor" onRetry={onRetry} compact /> : null}

        {a.admissible ? (
          <Alert tone="success" title="Yönetmeliğe uygun görünüyor">
            Destekçiler toplanınca ontoloji denetimi yeniden yapılır; metin değişirse sonuç da değişebilir.
          </Alert>
        ) : (
          <Alert tone="error" title="Bu haliyle yönetmeliğe aykırı">
            {a.tier === "T3"
              ? "Değiştirilemez bir hükme dokunduğu için bu öneri oylanamaz; destekçi toplasa bile geçersiz sayılır."
              : "Bulgulardaki ihlaller giderilmeden öneri oylamaya giremez."}
          </Alert>
        )}

        <div className="pre-key-block">
          <KeyValue compact className="pre-key" items={keyRows} />
          <p className="small muted pre-tier-explain">{TIER_EXPLAIN[a.tier]}</p>
        </div>

        {result.warnings.length ? (
          <Alert tone="warning" title="Dikkat">
            <ul className="pre-warnings">
              {result.warnings.map((w, i) => (
                <li key={i}>{w}</li>
              ))}
            </ul>
          </Alert>
        ) : null}

        {result.pii.length ? (
          <Alert tone="warning" title="Kişisel veri olabilecek ifadeler">
            <ul className="pre-pii">
              {result.pii.map((x, i) => (
                <li key={i}>
                  {PII_KIND_LABELS[x.kind] ?? x.kind}: <code className="mono">{x.masked}</code>
                </li>
              ))}
            </ul>
            <p className="small mt-0">Kaldırmanız önerilir. Kaldırmazsanız gönderirken ayrıca onayınız istenir.</p>
          </Alert>
        ) : null}

        <div className="pre-more">
          <Details summary={`Bulgular (${d.findings.count})`} meta={d.findings.meta} open={d.findings.open || undefined} className="pre-details">
            <div className="stack-sm">
              <FindingList findings={allFindings} empty={<p className="small muted mt-0">Ontoloji denetimi bulgu üretmedi.</p>} />
              {a.categories.length ? (
                <p className="small muted mt-0">Çıkarılan kategoriler (üst sınıflar dahil): {a.categories.map(categoryLabel).join(", ")}</p>
              ) : null}
              {a.appliedRules.length ? (
                <Details summary={`Uygulanan kurallar (${a.appliedRules.length})`}>
                  <ul className="pre-rules">
                    {a.appliedRules.map((r) => (
                      <li key={r.iri}>
                        {r.label}
                        {r.articleLabel ? <span className="muted"> — {r.articleLabel}</span> : null}
                      </li>
                    ))}
                  </ul>
                </Details>
              ) : null}
              <p className="small muted mt-0">Yönetmelik sürümü {a.bylawVersion}</p>
            </div>
          </Details>

          {p ? (
            <Details
              summary="Karar parametreleri"
              meta={`Onay eşiği ${p.thresholdStrict ? ">" : "≥"} ${p.threshold.den ? formatPercent(p.threshold.num / p.threshold.den) : "—"}`}
              className="pre-details"
            >
              <div className="stack-sm">
                <DecisionParamsView params={p} sponsorsRequired={result.sponsorsRequired} omit={panelParamRows(a.requiresExpert)} />
                <p className="small muted mt-0">Parametreler oylama açılışında öneriye sabitlenir; sonradan yönetmelik değişse de geriye etkili olmaz.</p>
              </div>
            </Details>
          ) : null}

          <Details summary="YZ önerileri" meta={d.ai.meta} open={aiLatched || d.ai.open ? true : undefined} className="pre-details">
            <AiLabel label={c.aiLabel} model={c.model} offline={c.offline}>
              <div className="stack-sm">
                {c.rationale ? <p className="small mt-0">{c.rationale}</p> : null}
                {c.categories.length ? (
                  <div>
                    <h3 className="pre-h4">Önerilen kategoriler</h3>
                    <ul className="pre-ai-list">
                      {c.categories.map((s) => {
                        const isSel = selected.has(expandIri(s.iri));
                        return (
                          <li key={s.iri}>
                            <span>
                              {s.label || categoryLabel(s.iri)} <span className="muted small">%{Math.round(s.confidence * 100)}</span>
                            </span>
                            {onAddCategory ? (
                              isSel ? (
                                <Badge tone="neutral" icon="check">
                                  Seçili
                                </Badge>
                              ) : (
                                <Button size="sm" variant="ghost" icon="plus" onClick={(e) => addSuggested(s.iri, e)}>
                                  Ekle
                                </Button>
                              )
                            ) : null}
                          </li>
                        );
                      })}
                    </ul>
                  </div>
                ) : null}
                {c.rightsAffected.length ? (
                  <div>
                    <h3 className="pre-h4">Olası hak etkileri</h3>
                    <ul className="pre-ai-list">
                      {c.rightsAffected.map((r) => (
                        <li key={r.right + r.direction}>
                          <span>
                            {r.label || rightLabel(r.right)}:{" "}
                            <Badge tone={r.direction === "restrict" ? "warning" : "neutral"}>{r.direction === "restrict" ? "kısıtlayabilir" : "genişletebilir"}</Badge>{" "}
                            <span className="muted small">%{Math.round(r.confidence * 100)}</span>
                          </span>
                        </li>
                      ))}
                    </ul>
                    <p className="small muted mt-0">Hak etkisi bayrakları katmanı yalnızca yükseltir (en fazla T1); bayrağı yalnızca bilirkişi kaldırabilir.</p>
                  </div>
                ) : null}
                {c.contentLabels.length ? (
                  <div>
                    <h3 className="pre-h4">İçerik işaretleri</h3>
                    <p className="small mt-0">{c.contentLabels.map((l) => `${l.label} (%${Math.round(l.confidence * 100)})`).join(", ")}</p>
                  </div>
                ) : null}
                {!c.categories.length && !c.rightsAffected.length && !c.contentLabels.length && !c.rationale ? (
                  <p className="small muted mt-0">Sınıflandırma önerisi yok.</p>
                ) : null}
              </div>
            </AiLabel>
          </Details>

          {d.similar.count ? (
            <Details summary={`Benzer öneriler (${d.similar.count})`} meta={d.similar.meta} open={d.similar.open || undefined} className="pre-details">
              <div className="stack-sm">
                <ul className="pre-similar">
                  {result.similar.map((s) => (
                    <li key={s.id}>
                      {native ? (
                        <button type="button" className="pre-similar-open" aria-haspopup="dialog" onClick={() => setPreviewId(s.id)}>
                          <span className="mono muted">{proposalRef(s.seq)}</span> {s.title}
                        </button>
                      ) : (
                        <Link to={routes.proposal(s.id)} target="_blank" rel="noopener">
                          <span className="mono muted">{proposalRef(s.seq)}</span> {s.title}
                        </Link>
                      )}
                      <span className="row">
                        <StatusBadge status={s.status} />
                        <span className="small muted">benzerlik {formatPercent(s.score, 0)}</span>
                        {s.sameAuthor ? <Badge tone="neutral">Sizin öneriniz</Badge> : null}
                      </span>
                    </li>
                  ))}
                </ul>
                <p className="small muted mt-0">
                  Benzerlik yerel metin karşılaştırmasıyla hesaplanır; aynı konuda açık bir öneri varsa orada tartışmaya katılmayı düşünün.
                </p>
              </div>
            </Details>
          ) : (
            <p className="small muted pre-empty">Benzer öneri bulunmadı.</p>
          )}
        </div>
      </div>
    );
  }

  return (
    <Card title="Canlı ön denetim" subtitle="Yazdıkça yönetmeliğe göre denetlenir; hiçbir şey kaydedilmez." actions={header} className="pre-panel">
      {content}
      {previewId ? <SimilarProposalPreview id={previewId} onClose={() => setPreviewId(null)} /> : null}
    </Card>
  );
}

export default PrecheckPanel;
