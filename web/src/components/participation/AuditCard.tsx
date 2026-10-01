// Ontoloji (yönetmelik) denetim raporu: katman ve gerekçesi, ihlal/uyarı/bilgi bulguları (madde atıflarıyla),
// uygulanan kurallar, çıkarılan sınıflar, yönetmelik sürümü ve özeti.
import { Link } from "react-router-dom";
import { expandIri, type AuditReport, type Finding, type Tier } from "@forum/shared";
import { useOntology } from "../../lib/categories";
import { routes } from "../../lib/routes";
import { Badge, Card, Details, HashText, TierBadge, Time } from "../../ui";
import { SubHeading } from "./common";

export const TIER_REASONS: Record<Tier, string> = {
  T0: "Olağan karar: yeni konu ya da alt konu; bir temel hakkı kısıtlamıyor.",
  T1: "Nitelikli karar: yürürlükteki bir konunun düzenlenmesi ya da bir temel hakkı kısıtlayan öneri.",
  T2: "Yönetmelik değişikliği (değiştirilemez olmayan madde ya da parametre).",
  T3: "Değiştirilemez bir maddeye dokunuyor: oylanamaz, kural gereği geçersizdir.",
  DEL: "Silme (karartma) kararı: 2/3 onay, köprü testi ve mesaj yazarının görüş grubunda P ≥ 0,50 gerekir.",
};

function FindingList({ title, items, tone }: { title: string; items: Finding[]; tone: "danger" | "warning" | "info" }) {
  const { ontology, articleLabel } = useOntology();
  /** Madde etiketi; ileti madde numarasını zaten içeriyorsa yalnızca başlık. */
  const ref = (f: Finding): string | null => {
    if (!f.article) return f.articleLabel ?? null;
    const a = ontology?.articles.find((x) => expandIri(x.iri) === expandIri(f.article!));
    if (a && f.message.includes(a.number)) return a.title;
    return articleLabel(f.article);
  };
  if (!items.length) return null;
  return (
    <div className="stack-sm">
      <SubHeading level={4}>
        {title} ({items.length})
      </SubHeading>
      <ul className={`finding-list finding-${tone}`}>
        {items.map((f, i) => (
          <li key={`${f.code}-${i}`} title={f.code}>
            <span>{f.message}</span>
            {ref(f) ? <span className="small muted finding-article"> — {ref(f)}</span> : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

export function AuditCard({ audit }: { audit: AuditReport | null }) {
  const { categoryLabel, rightLabel, articleLabel } = useOntology();
  if (!audit) {
    return (
      <Card title="Ontoloji denetimi" headingLevel={2}>
        <p className="small muted">Denetim, destekçiler toplanınca yapılır: katman, eşikler ve yönetmeliğe uygunluk o anda belirlenir.</p>
      </Card>
    );
  }
  const explicitAndInferred = audit.categories;
  return (
    <Card title="Ontoloji denetimi" subtitle="Yönetmelik ontolojisinin otomatik denetimi (OWL/SHACL/N3 kuralları)" tone={audit.admissible ? "default" : "danger"}>
      <div className="stack">
        <div className="row">
          <TierBadge tier={audit.tier} />
          <Badge tone={audit.admissible ? "success" : "danger"} icon={audit.admissible ? "check" : "error"}>
            {audit.admissible ? "Yönetmeliğe uygun" : "Yönetmeliğe aykırı"}
          </Badge>
          {audit.requiresExpert ? <Badge tone="accent">Bilirkişi gerekli</Badge> : null}
        </div>
        <p className="small">
          <strong>Katman gerekçesi:</strong> {TIER_REASONS[audit.tier]}
        </p>

        <FindingList title="İhlaller" items={audit.violations} tone="danger" />
        <FindingList title="Uyarılar" items={audit.warnings} tone="warning" />
        <FindingList title="Bilgiler" items={audit.infos} tone="info" />

        {audit.rightsAffected.length ? (
          <p className="small">
            <strong>Etkilenen temel haklar:</strong> {audit.rightsAffected.map(rightLabel).join(", ")}
          </p>
        ) : null}

        {audit.appliedRules.length ? (
          <Details summary={`Uygulanan kurallar (${audit.appliedRules.length})`}>
            <ul className="small stack-sm rule-list">
              {audit.appliedRules.map((r) => (
                <li key={r.iri}>
                  {r.label}
                  {r.article || r.articleLabel ? <span className="muted"> — {r.article ? articleLabel(r.article) : r.articleLabel}</span> : null}
                </li>
              ))}
            </ul>
          </Details>
        ) : null}

        <Details summary="Sınıflandırma">
          <div className="stack-sm small">
            <div>
              <strong>Kategoriler (üst sınıflar dahil):</strong> {explicitAndInferred.length ? explicitAndInferred.map(categoryLabel).join(", ") : "—"}
            </div>
            <div>
              <strong>Çıkarılan sınıflar:</strong> {audit.inferredClasses.length ? audit.inferredClasses.map(categoryLabel).join(", ") : "—"}
            </div>
          </div>
        </Details>

        <p className="small muted">
          <Link to={routes.ontology()}>Yönetmelik</Link> sürüm {audit.bylawVersion} · özet <HashText hash={audit.bylawHash} chars={8} label="Yönetmelik özeti" /> · denetim{" "}
          <Time at={audit.checkedAt} />
        </p>
      </div>
    </Card>
  );
}
