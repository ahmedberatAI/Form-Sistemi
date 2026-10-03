// Karar parametreleri (ALGORITMA §2): oylama açılınca öneriye sabitlenir, sonradan yönetmelik değişse de geriye etkili olmaz.
// Katlanabilir kart: kapalıyken başlığın yanında tek satırlık hüküm ("Onay eşiği ≥ %60 · yeter sayı … · oylamada sabitlendi") durur.
import { quorumRequired, type DecisionParams, type ProposalStatus, type Rational } from "@forum/shared";
import { useOntology } from "../../lib/categories";
import { formatHours, formatNumber, formatPercent } from "../../lib/format";
import { Card, Details, KeyValue, TierBadge } from "../../ui";

const FIXED_FROM: ProposalStatus[] = ["voting", "objection_window", "reconciliation", "revote", "enacted", "rejected"];

const pct = (r: Rational) => (r.den ? formatPercent(r.num / r.den) : "—");
const frac = (r: Rational) => (r.den ? `${r.num}/${r.den} (${pct(r)})` : "—");

/**
 * Yeter sayının mutlak değeri. q bir ORANDIR; kişi sayısı yalnız biliniyorsa yazılır: oylamadaki uygun seçmen sayısından
 * (sunucuyla aynı ortak formül) ya da en son sonuçtaki `quorumRequired` değerinden. Bilinmiyorsa null.
 */
export function quorumCount(params: Pick<DecisionParams, "quorum">, eligible?: number | null, resultQuorum?: number | null): number | null {
  if (params.quorum.den > 0 && eligible && eligible > 0) return quorumRequired(params.quorum, eligible);
  return resultQuorum && resultQuorum > 0 ? resultQuorum : null;
}

/** Kart başlığının yanındaki hüküm: "Onay eşiği ≥ %60 · yeter sayı: uygun seçmen oranı %20 · oylamada sabitlendi". */
export function paramsSummary(p: DecisionParams, fixed: boolean, quorumAbs?: number | null): string {
  return [
    `Onay eşiği ${p.thresholdStrict ? ">" : "≥"} ${pct(p.threshold)}`,
    quorumAbs ? `yeter sayı: en az ${formatNumber(quorumAbs)} kişi (uygun seçmen oranı ${pct(p.quorum)})` : `yeter sayı: uygun seçmen oranı ${pct(p.quorum)}`,
    fixed ? "oylamada sabitlendi" : "henüz sabitlenmedi",
  ].join(" · ");
}

export interface ParamsCardProps {
  params: DecisionParams | null;
  status: ProposalStatus;
  votingRound: number;
  /** Oylamadaki uygun seçmen sayısı (participation.eligible); verilirse yeter sayının kişi karşılığı yazılır */
  eligible?: number | null;
  /** En son sonuçtaki gerekli katılım (DecisionResult.quorumRequired) */
  resultQuorum?: number | null;
  /** Kart başlığının düzeyi (öneri sayfasında 'Kanıtlar ve denetim' sütununun altında 3) */
  headingLevel?: 2 | 3;
}

export function ParamsCard({ params: p, status, votingRound, eligible, resultQuorum, headingLevel = 2 }: ParamsCardProps) {
  const { categoryLabel } = useOntology();
  if (!p) {
    return (
      <Card title="Karar parametreleri" headingLevel={headingLevel} anchor="parametreler">
        <p className="small muted">Parametreler ontoloji denetimiyle belirlenir (destekçiler toplanınca).</p>
      </Card>
    );
  }
  const fixed = FIXED_FROM.includes(status) || votingRound > 0;
  const d = p.durationsHours;
  return (
    <Card
      title="Karar parametreleri"
      subtitle={fixed ? "Oylama açılırken sabitlendi; geriye etkili değişmez." : "Henüz sabitlenmedi: oylama açılırken güncel yönetmelikle kesinleşir."}
      headingLevel={headingLevel}
      collapsible
      summary={paramsSummary(p, fixed, quorumCount(p, eligible, resultQuorum))}
      anchor="parametreler"
    >
      <div className="stack-sm">
        <KeyValue
          compact
          items={[
            { label: "Katman", value: <TierBadge tier={p.tier} /> },
            { label: "Yeter sayı q", value: pct(p.quorum), hint: "Gerekli katılım: max(⌈q·|E|⌉, ⌈1,5·√|E|⌉), en fazla |E|" },
            { label: "Onay eşiği τ", value: `${p.thresholdStrict ? ">" : "≥"} ${pct(p.threshold)}`, hint: p.thresholdStrict ? "kesin büyüktür" : "büyük ya da eşit" },
            { label: "Küme tabanı φ", value: pct(p.clusterFloor), hint: "Her anlamlı görüş grubunda P_g ≥ φ (köprü testi)" },
            p.authorClusterFloor ? { label: "Yazarın grubu tabanı", value: pct(p.authorClusterFloor), hint: "Silmede mesaj yazarının görüş grubunda P ≥ 1/2" } : null,
            { label: "Aşma eşiği ω", value: frac(p.overrideThreshold), hint: "Tartışmalı sonuç sonrası yeniden oylamada tabanı aşan nitelikli çoğunluk" },
            { label: "Yeniden oy eşiği ρ", value: frac(p.revoteThreshold), hint: "İtiraz sonrası; güçlü itirazda en az 2/3" },
            { label: "Anlamlı küme σ", value: `pay ≥ ${pct(p.significantShare)} ve ≥ ${p.significantMinMembers} üye` },
            { label: "Küme başına asgari oy μ", value: String(p.minVotesPerCluster), hint: "Altındaysa oylama bir kez uzatılır" },
            { label: "Köprü için asgari kümelenmiş üye n_C,min", value: String(p.minClusteredForBridge) },
            { label: "Soğuk başlangıç artışı δ", value: `+${pct(p.coldStartBump)} (en fazla 2/3)` },
            { label: "Vekâlet sınırı", value: `max(2, ⌈${pct(p.delegationCapFraction)} · |E|⌉) başkasına ait oy` },
            { label: "Vekâlet zinciri H", value: `en fazla ${p.delegationMaxHops} adım` },
            { label: "Gerekli destekçi K_s", value: String(p.sponsorsRequired) },
            {
              label: "Bilirkişi",
              value: p.requiresExpert ? `gerekli (${p.expertCount} kişi)` : "zorunlu değil",
              hint: p.expertDomains.length ? `Alanlar: ${p.expertDomains.map(categoryLabel).join(", ")}` : undefined,
            },
          ]}
        />
        <Details summary="Süreler">
          <KeyValue
            compact
            items={[
              { label: "Destekçi toplama (azami)", value: formatHours(d.sponsoring) },
              { label: "Tartışma", value: formatHours(d.deliberation) },
              { label: "Oylama", value: formatHours(d.voting) },
              { label: "Uzatma (bir kez)", value: formatHours(d.extension) },
              { label: "İtiraz penceresi", value: d.objection ? formatHours(d.objection) : "yok" },
              { label: "Uzlaşma (soğuma)", value: d.reconciliation ? formatHours(d.reconciliation) : "yok" },
            ]}
          />
          <p className="small muted">Demo modunda süreler zaman ölçeğiyle kısaltılabilir.</p>
        </Details>
      </div>
    </Card>
  );
}
