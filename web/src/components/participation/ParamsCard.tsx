// Karar parametreleri (ALGORİTMA §2): oylama açılınca öneriye sabitlenir, sonradan yönetmelik değişse de geriye etkili olmaz.
// Katlanabilir kart: kapalıyken başlığın yanında tek satırlık hüküm ("Onay eşiği ≥ %60 · yeter sayı … · oylamada sabitlendi") durur.
// Sade dil: satırlar sade adla başlar ('Onay eşiği: %60'); etiket sözlük terimidir (dokununca günlük karşılığı açılır). Yunan
// sembolleri (τ, φ, ω …) ve formüller 'Sembolleri ve formülleri göster' anahtarının arkasındadır; 'Tam' görünümde açık gelir.
import { useState, type ReactNode } from "react";
import { quorumRequired, type DecisionParams, type ProposalStatus, type Rational } from "@forum/shared";
import { useOntology } from "../../lib/categories";
import { useDetailLevel } from "../../lib/detailLevel";
import { formatHours, formatNumber, formatPercent } from "../../lib/format";
import type { TermId } from "../../lib/glossary";
import { Card, Details, KeyValue, Term, TierBadge, type KeyValueItem } from "../../ui";

const FIXED_FROM: ProposalStatus[] = ["voting", "objection_window", "reconciliation", "revote", "enacted", "rejected"];

const pct = (r: Rational) => (r.den ? formatPercent(r.num / r.den) : "—");
const frac = (r: Rational) => (r.den ? `${r.num}/${r.den} (${pct(r)})` : "—");

/** Sembol anahtarının erişilebilir adı (düğme adı; 'Daha fazla', 'Kapat' gibi yasak alt dizeler içermez). */
export const SYMBOLS_SWITCH_LABEL = "Sembolleri ve formülleri göster";

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

// ───────────── Satırlar (saf; birim testli) ─────────────

/** Parametre listesinin bir satırı: sade ad + değer; sembol ve formül anahtarın arkasında. */
export interface ParamRow {
  key: string;
  /** Sade ad ('Onay eşiği'); sembol etikete değil değerin yanına yazılır */
  label: string;
  /** Etiketin sözlük terimi (dokununca günlük karşılığı açılır) */
  term?: TermId;
  /** Yunan harfi ya da kısaltma ('τ', 'K_s'); yalnız anahtar açıkken görünür */
  symbol?: string;
  /** null → değer özel çizilir (katman rozeti) */
  value: string | null;
  /** Düz Türkçe ipucu; her zaman görünür */
  hint?: string;
  /** Formül; yalnız anahtar açıkken görünür */
  formula?: string;
}

export function paramRows(p: DecisionParams, categoryLabel: (iri: string) => string = (iri) => iri): ParamRow[] {
  const rows: (ParamRow | null)[] = [
    { key: "tier", label: "Katman", term: "katman", value: null },
    {
      key: "quorum",
      label: "Yeter sayı",
      term: "yeter-sayi",
      symbol: "q",
      value: pct(p.quorum),
      hint: "Oylamanın geçerli olması için katılması gereken en az uygun seçmen oranı",
      formula: "Gerekli katılım: max(⌈q·|E|⌉, ⌈1,5·√|E|⌉), en fazla |E|",
    },
    {
      key: "threshold",
      label: "Onay eşiği",
      term: "onay-esigi",
      symbol: "τ",
      value: `${p.thresholdStrict ? ">" : "≥"} ${pct(p.threshold)}`,
      hint: p.thresholdStrict ? "kesin büyüktür" : "büyük ya da eşit",
    },
    {
      key: "clusterFloor",
      label: "Küme tabanı",
      term: "kume-tabani",
      symbol: "φ",
      value: pct(p.clusterFloor),
      hint: "Her anlamlı görüş grubunun öneriyi en az bu oranda desteklemesi gerekir (köprü testi)",
      formula: "Her anlamlı görüş grubunda P_g ≥ φ",
    },
    p.authorClusterFloor
      ? {
          key: "authorClusterFloor",
          label: "Yazarın grubu tabanı",
          term: "kume-tabani",
          value: pct(p.authorClusterFloor),
          hint: "Silmede mesaj yazarının kendi görüş grubundan en az bu oranda destek aranır",
          formula: `Yazarın görüş grubunda P_g ≥ ${pct(p.authorClusterFloor)}`,
        }
      : null,
    {
      key: "override",
      label: "Aşma eşiği",
      term: "asma-esigi",
      symbol: "ω",
      value: frac(p.overrideThreshold),
      hint: "Tartışmalı sonuç sonrası yeniden oylamada tabanı aşan nitelikli çoğunluk",
    },
    {
      key: "revote",
      label: "Yeniden oy eşiği",
      term: "yeniden-oy-esigi",
      symbol: "ρ",
      value: frac(p.revoteThreshold),
      hint: "İtiraz sonrası; güçlü itirazda en az 2/3",
    },
    {
      key: "significant",
      label: "Anlamlı küme",
      term: "anlamli-kume",
      symbol: "σ",
      value: `pay ≥ ${pct(p.significantShare)} ve ≥ ${p.significantMinMembers} üye`,
    },
    {
      key: "minVotes",
      label: "Küme başına asgari oy",
      term: "kume-basina-asgari-oy",
      symbol: "μ",
      value: String(p.minVotesPerCluster),
      hint: "Altındaysa oylama bir kez uzatılır",
    },
    {
      key: "minClustered",
      label: "Köprü için asgari kümelenmiş üye",
      term: "soguk-baslangic",
      symbol: "n_C,min",
      value: String(p.minClusteredForBridge),
    },
    { key: "coldStart", label: "Soğuk başlangıç artışı", term: "soguk-baslangic", symbol: "δ", value: `+${pct(p.coldStartBump)} (en fazla 2/3)` },
    {
      key: "delegationCap",
      label: "Vekâlet sınırı",
      term: "vekalet",
      value: `uygun seçmenin ${pct(p.delegationCapFraction)} oranı (en az 2 oy)`,
      hint: "Bir delegenin taşıyabileceği başkasına ait oy sayısının üst sınırı",
      formula: `max(2, ⌈${pct(p.delegationCapFraction)} · |E|⌉)`,
    },
    { key: "delegationHops", label: "Vekâlet zinciri", term: "vekalet", symbol: "H", value: `en fazla ${p.delegationMaxHops} adım` },
    { key: "sponsors", label: "Gerekli destekçi", term: "gerekli-destekci", symbol: "K_s", value: String(p.sponsorsRequired) },
    {
      key: "expert",
      label: "Bilirkişi",
      term: "bilirkisi",
      value: p.requiresExpert ? `gerekli (${p.expertCount} kişi)` : "zorunlu değil",
      hint: p.expertDomains.length ? `Alanlar: ${p.expertDomains.map(categoryLabel).join(", ")}` : undefined,
    },
  ];
  return rows.filter((r): r is ParamRow => !!r);
}

/** Sembol ve formül anahtarı açıkken görünen, kapalıyken görünmeyen öğe sayıları (testler ve ölçüm için). */
export function symbolCount(rows: ParamRow[]): { symbols: number; formulas: number } {
  return { symbols: rows.filter((r) => r.symbol).length, formulas: rows.filter((r) => r.formula).length };
}

/** Satırı KeyValue öğesine çevirir; sembol değerin yanına, formül ipucunun altına yalnız `showSymbols` iken yazılır. */
export function toKeyValueItem(row: ParamRow, showSymbols: boolean, tier: DecisionParams["tier"]): KeyValueItem {
  let value: ReactNode = row.value;
  if (row.key === "tier") value = <TierBadge tier={tier} explain />;
  else if (showSymbols && row.symbol)
    value = (
      <>
        {row.value} <span className="param-symbol">({row.symbol})</span>
      </>
    );
  const formula = showSymbols && row.formula ? <span className="param-formula">{row.formula}</span> : null;
  const hint = row.hint || formula ? (
    <>
      {row.hint}
      {formula}
    </>
  ) : undefined;
  return { label: row.term ? <Term id={row.term}>{row.label}</Term> : row.label, value, hint };
}

// ───────────── Liste (kartın ve ön denetim panelinin ortak parçası) ─────────────

/** 'Sembolleri ve formülleri göster' anahtarı (role=switch). Durumu üst bileşen tutar. */
export function SymbolsSwitch({ shown, onToggle }: { shown: boolean; onToggle: () => void }) {
  return (
    <div className="param-tools">
      <button type="button" role="switch" aria-checked={shown} className="param-switch" onClick={onToggle}>
        <span className="param-switch-track" aria-hidden="true" />
        <span>{SYMBOLS_SWITCH_LABEL}</span>
      </button>
    </div>
  );
}

/**
 * Karar parametrelerinin sade listesi: anahtar + satırlar (+ açıkken |E| ve P_g açıklaması). Etiketler sözlük terimidir.
 * Anahtar, dokunulmadıkça görünüm yoğunluğuna uyar ('Tam' görünümde açık gelir); dokununca seçim korunur.
 * Başka bir panelde (ör. yeni öneri ön denetimi) aynı liste doğrudan kullanılabilir.
 */
export function ParamsList({ params, categoryLabel: label }: { params: DecisionParams; categoryLabel?: (iri: string) => string }) {
  const ontology = useOntology();
  const { full } = useDetailLevel();
  const [choice, setChoice] = useState<boolean | null>(null);
  const shown = choice ?? full;
  const rows = paramRows(params, label ?? ontology.categoryLabel);
  return (
    <>
      <SymbolsSwitch shown={shown} onToggle={() => setChoice(!shown)} />
      <KeyValue compact items={rows.map((r) => toKeyValueItem(r, shown, params.tier))} />
      {shown ? (
        <p className="small muted param-legend">
          |E|: oylamadaki uygun seçmen sayısı · P_g: bir görüş grubunun yumuşatılmış desteği, (1 + Kabul) / (2 + Kabul + Red).
        </p>
      ) : null}
    </>
  );
}

// ───────────── Kart ─────────────

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
        <ParamsList params={p} />
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
