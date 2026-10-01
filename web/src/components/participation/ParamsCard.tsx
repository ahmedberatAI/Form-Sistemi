// Karar parametreleri (ALGORITMA §2): oylama açılınca öneriye sabitlenir, sonradan yönetmelik değişse de geriye etkili olmaz.
import type { DecisionParams, ProposalStatus, Rational } from "@forum/shared";
import { useOntology } from "../../lib/categories";
import { formatHours, formatPercent } from "../../lib/format";
import { Card, Details, KeyValue, TierBadge } from "../../ui";

const FIXED_FROM: ProposalStatus[] = ["voting", "objection_window", "reconciliation", "revote", "enacted", "rejected"];

const pct = (r: Rational) => (r.den ? formatPercent(r.num / r.den) : "—");
const frac = (r: Rational) => (r.den ? `${r.num}/${r.den} (${pct(r)})` : "—");

export function ParamsCard({ params: p, status, votingRound }: { params: DecisionParams | null; status: ProposalStatus; votingRound: number }) {
  const { categoryLabel } = useOntology();
  if (!p) {
    return (
      <Card title="Karar parametreleri">
        <p className="small muted">Parametreler ontoloji denetimiyle belirlenir (destekçiler toplanınca).</p>
      </Card>
    );
  }
  const fixed = FIXED_FROM.includes(status) || votingRound > 0;
  const d = p.durationsHours;
  return (
    <Card title="Karar parametreleri" subtitle={fixed ? "Oylama açılırken sabitlendi; geriye etkili değişmez." : "Henüz sabitlenmedi: oylama açılırken güncel yönetmelikle kesinleşir."}>
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
