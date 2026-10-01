// Canlı ön denetim paneli (POST /api/proposals/precheck — yan etkisiz):
// katman, karar parametreleri, ontoloji bulguları, YZ önerileri (danışma), benzer öneriler, salam taktiği
// uyarıları, kişisel veri bulguları ve gerekli destekçi sayısı. Parametre ve bulgu görünümleri dışa da açıktır.
import type { ReactNode } from "react";
import { Link } from "react-router-dom";
import { expandIri, type DecisionParams, type Finding, type PrecheckResponse, type Severity, type Tier } from "@forum/shared";
import { useAuth } from "../../auth/AuthContext";
import { useOntology } from "../../lib/categories";
import { formatDuration, formatHours, formatPercent, formatRational, proposalRef } from "../../lib/format";
import { routes } from "../../lib/routes";
import { AiLabel, Alert, Badge, Button, Card, Details, ErrorView, KeyValue, Spinner, StatusBadge, TierBadge, type Tone } from "../../ui";

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

const SEVERITY: Record<Severity, { label: string; tone: Tone }> = {
  violation: { label: "İhlal", tone: "danger" },
  warning: { label: "Uyarı", tone: "warning" },
  info: { label: "Bilgi", tone: "info" },
};

const DURATION_ROWS: { key: keyof DecisionParams["durationsHours"]; label: string }[] = [
  { key: "sponsoring", label: "Destekçi toplama (azami)" },
  { key: "deliberation", label: "Tartışma" },
  { key: "voting", label: "Oylama" },
  { key: "extension", label: "Uzatma (bir kez)" },
  { key: "objection", label: "İtiraz penceresi" },
  { key: "reconciliation", label: "Uzlaşma (soğuma)" },
];

/** Ontoloji bulguları: önem derecesi rozeti + Türkçe ileti + madde atfı. */
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
                  <Link to={routes.ontology()} className="pre-article">
                    ({art})
                  </Link>
                </>
              ) : null}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

/** Oylama açılışında sabitlenecek karar parametreleri (q, τ, φ, ω, ρ, süreler, K_s). */
export function DecisionParamsView({ params, sponsorsRequired }: { params: DecisionParams; sponsorsRequired?: number }) {
  const { system } = useAuth();
  const { categoryLabel } = useOntology();
  const scale = system?.timeScale && system.timeScale > 0 ? system.timeScale : 1;
  const cmp = params.thresholdStrict ? ">" : "≥";
  const dur = (h: number) => {
    if (!h) return "yok";
    const sim = formatHours(h);
    return scale !== 1 ? `${sim} (demo: ${formatDuration((h * 3_600_000) / scale, false)})` : sim;
  };
  return (
    <div className="stack-sm">
      <KeyValue
        compact
        items={[
          {
            label: "Yeter sayı (q)",
            value: formatRational(params.quorum),
            hint: "Uygun seçmenlerin en az bu oranı katılmalı (mutlak taban ⌈1,5·√|E|⌉ ile büyük olan geçerli).",
          },
          { label: "Onay eşiği (τ)", value: `a ${cmp} ${formatRational(params.threshold)}`, hint: "a = kabul / (kabul + red)" },
          {
            label: "Küme tabanı (φ)",
            value: formatRational(params.clusterFloor),
            hint: "Her anlamlı görüş kümesinde yumuşatılmış destek bu değerin altına düşmemeli (köprü testi).",
          },
          params.authorClusterFloor
            ? { label: "Yazar kümesi tabanı", value: formatRational(params.authorClusterFloor), hint: "Mesaj yazarının kendi kümesinde aranan asgari destek." }
            : null,
          { label: "Aşma eşiği (ω)", value: formatRational(params.overrideThreshold), hint: "Tartışmalı sonuçtan sonra yeniden oylamada köprü testini aşan onay." },
          { label: "Yeniden oy eşiği (ρ)", value: formatRational(params.revoteThreshold), hint: "Geçerli azınlık itirazından sonraki yeniden oylamada aranan onay." },
          {
            label: "Gerekli destekçi (Kₛ)",
            value: sponsorsRequired ?? params.sponsorsRequired,
            hint: "Yazar dışında eş imzacı doğrulanmış üye sayısı.",
          },
          {
            label: "Bilirkişi",
            value: params.requiresExpert ? `Gerekli · ${params.expertCount} kişilik panel` : "Zorunlu değil (talep edilebilir)",
            hint: params.expertDomains.length ? `Alanlar: ${params.expertDomains.map(categoryLabel).join(", ")}` : undefined,
          },
        ]}
      />
      <Details summary="Süreler">
        <KeyValue compact items={DURATION_ROWS.map((d) => ({ label: d.label, value: dur(params.durationsHours[d.key]) }))} />
        <p className="small muted mt-0">Süreler simüle saat cinsindendir; evre geçişlerini sunucudaki zamanlayıcı yapar.</p>
      </Details>
    </div>
  );
}

/** Formun altında tek satırlık ön denetim özeti (mobilde ayrıntılı panel aşağıda kalır). */
export function PrecheckSummary({ result, loading, stale }: { result: PrecheckResponse | undefined; loading: boolean; stale: boolean }) {
  if (!result) return loading ? <Spinner label="Ön denetim yapılıyor…" showLabel /> : null;
  const a = result.audit;
  return (
    <div className="pre-summary" role="status" aria-live="polite">
      <span className="small muted">Ön denetim:</span>
      <TierBadge tier={a.tier} short />
      {a.admissible ? (
        <Badge tone="success" icon="check">
          Yönetmeliğe uygun
        </Badge>
      ) : (
        <Badge tone="danger" icon="error">
          Yönetmeliğe aykırı
        </Badge>
      )}
      {a.violations.length ? <Badge tone="danger">{a.violations.length} ihlal</Badge> : null}
      {a.warnings.length + result.warnings.length ? <Badge tone="warning">{a.warnings.length + result.warnings.length} uyarı</Badge> : null}
      {result.pii.length ? <Badge tone="warning">Kişisel veri olabilir</Badge> : null}
      <span className="small muted">{result.sponsorsRequired} destekçi gerekir</span>
      {loading || stale ? <Spinner size="sm" label="Güncelleniyor…" /> : null}
    </div>
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
  const busy = loading || !!stale;
  const selected = new Set(selectedCategories.map(expandIri));

  const header = (
    <span className="pre-status" aria-live="polite">
      {busy && !idleText ? <Spinner size="sm" label="Denetleniyor…" showLabel /> : result && !idleText ? <Badge tone="success">Güncel</Badge> : null}
    </span>
  );

  let content: ReactNode;
  if (idleText) {
    content = <p className="muted">{idleText}</p>;
  } else if (error && !result) {
    content = <ErrorView error={error} title="Ön denetim yapılamadı" onRetry={onRetry} compact />;
  } else if (!result) {
    content = <Spinner block label="Ön denetim yapılıyor…" />;
  } else {
    const a = result.audit;
    const c = result.classification;
    const allWarnings = [...a.violations, ...a.warnings, ...a.infos];
    content = (
      <div className="stack pre-body">
        {error ? <ErrorView error={error} title="Son denetim başarısız; önceki sonuç gösteriliyor" onRetry={onRetry} compact /> : null}

        {a.admissible ? (
          <Alert tone="success" title="Yönetmeliğe uygun görünüyor">
            Destekçi sayısına ulaşınca ontoloji denetimi yeniden yapılır; metin değişirse sonuç da değişebilir.
          </Alert>
        ) : (
          <Alert tone="error" title="Bu haliyle yönetmeliğe aykırı">
            {a.tier === "T3"
              ? "Değiştirilemez bir hükme dokunduğu için bu öneri oylanamaz; destekçi toplasa bile geçersiz sayılır."
              : "Aşağıdaki ihlaller giderilmeden öneri oylamaya giremez."}
          </Alert>
        )}

        <section className="pre-section" aria-label="Katman">
          <h3 className="pre-h">Katman</h3>
          <div className="row">
            <TierBadge tier={a.tier} />
            {a.requiresExpert ? (
              <Badge tone="info" icon="experts">
                Bilirkişi görüşü gerekli
              </Badge>
            ) : null}
          </div>
          <p className="small muted mt-0">{TIER_EXPLAIN[a.tier]}</p>
          {a.rightsAffected.length ? (
            <p className="small mt-0">
              <strong>Etkilenen temel haklar:</strong> {a.rightsAffected.map(rightLabel).join(", ")}
            </p>
          ) : null}
        </section>

        {a.params ? (
          <section className="pre-section" aria-label="Karar parametreleri">
            <h3 className="pre-h">Karar parametreleri</h3>
            <DecisionParamsView params={a.params} sponsorsRequired={result.sponsorsRequired} />
            <p className="small muted mt-0">Parametreler oylama açılışında öneriye sabitlenir; sonradan yönetmelik değişse de geriye etkili olmaz.</p>
          </section>
        ) : (
          <p className="small">
            <strong>Gerekli destekçi:</strong> {result.sponsorsRequired}
          </p>
        )}

        <section className="pre-section" aria-label="Bulgular">
          <h3 className="pre-h">Bulgular</h3>
          <FindingList findings={allWarnings} empty={<p className="small muted mt-0">Ontoloji denetimi bulgu üretmedi.</p>} />
          {a.categories.length ? (
            <p className="small muted mt-0">
              Çıkarılan kategoriler (üst sınıflar dahil): {a.categories.map(categoryLabel).join(", ")}
            </p>
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
        </section>

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
              {result.pii.map((p, i) => (
                <li key={i}>
                  {PII_KIND_LABELS[p.kind] ?? p.kind}: <code className="mono">{p.masked}</code>
                </li>
              ))}
            </ul>
            <p className="small mt-0">Kaldırmanız önerilir. Kaldırmazsanız gönderirken ayrıca onayınız istenir.</p>
          </Alert>
        ) : null}

        <AiLabel label={c.aiLabel} model={c.model} offline={c.offline}>
          <div className="stack-sm">
            {c.rationale ? <p className="small mt-0">{c.rationale}</p> : null}
            {c.categories.length ? (
              <div>
                <h4 className="pre-h4">Önerilen kategoriler</h4>
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
                            <Badge tone="success" icon="check">
                              Seçili
                            </Badge>
                          ) : (
                            <Button size="sm" variant="ghost" icon="plus" onClick={() => onAddCategory(s.iri)}>
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
                <h4 className="pre-h4">Olası hak etkileri</h4>
                <ul className="pre-ai-list">
                  {c.rightsAffected.map((r) => (
                    <li key={r.right + r.direction}>
                      <span>
                        {r.label || rightLabel(r.right)}:{" "}
                        <Badge tone={r.direction === "restrict" ? "warning" : "info"}>{r.direction === "restrict" ? "kısıtlayabilir" : "genişletebilir"}</Badge>{" "}
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
                <h4 className="pre-h4">İçerik işaretleri</h4>
                <p className="small mt-0">{c.contentLabels.map((l) => `${l.label} (%${Math.round(l.confidence * 100)})`).join(", ")}</p>
              </div>
            ) : null}
            {!c.categories.length && !c.rightsAffected.length && !c.contentLabels.length && !c.rationale ? (
              <p className="small muted mt-0">Sınıflandırma önerisi yok.</p>
            ) : null}
          </div>
        </AiLabel>

        <section className="pre-section" aria-label="Benzer öneriler">
          <h3 className="pre-h">Benzer öneriler</h3>
          {result.similar.length ? (
            <ul className="pre-similar">
              {result.similar.map((s) => (
                <li key={s.id}>
                  <Link to={routes.proposal(s.id)} target="_blank" rel="noopener">
                    <span className="mono muted">{proposalRef(s.seq)}</span> {s.title}
                  </Link>
                  <span className="row">
                    <StatusBadge status={s.status} />
                    <span className="small muted">benzerlik {formatPercent(s.score, 0)}</span>
                    {s.sameAuthor ? <Badge tone="warning">Sizin öneriniz</Badge> : null}
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="small muted mt-0">Benzer öneri bulunmadı.</p>
          )}
          <p className="small muted mt-0">Benzerlik yerel metin karşılaştırmasıyla hesaplanır; aynı konuda açık bir öneri varsa orada tartışmaya katılmayı düşünün.</p>
        </section>
      </div>
    );
  }

  return (
    <Card title="Canlı ön denetim" subtitle="Yazdıkça yönetmeliğe göre denetlenir; hiçbir şey kaydedilmez." actions={header} className="pre-panel">
      {content}
    </Card>
  );
}

export default PrecheckPanel;
