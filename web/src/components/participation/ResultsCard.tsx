// Kesin bir oylama turunun sonucu (ALGORİTMA §4): ÖNCE HÜKÜM (başlıkta sonuç rozeti, hemen altında gerekçe), sonra tek satır
// toplamlar, işaretli iki çubuk ve "Neden bu sonuç?" kontrolleri. Görüş grupları/köprü testi tablosu ve yedi sayı kutusu
// adlandırılmış açılırlardadır; köprü sağlanmadıysa, bir grup tabanı geçemediyse ya da bir grup nötr sayıldıysa köprü açılırı
// kendiliğinden AÇIK gelir ('Tam' görünümde her zaman açık). Hiçbir sayı ya da açıklama silinmez.
// Sade dil: 'Neden bu sonuç?' kontrol satırlarının etiketi sözlük terimidir (sunucunun etiketi aynen yazılır, dokununca terimin
// günlük karşılığı açılır); P_g, GAC ve 'girdi özeti' de öyle. Kapalı başlıkların (Details özeti) içine Term konmaz.
import { useId, useState, type ReactNode } from "react";
import type { ClusterResult, DecisionCheck, DecisionResult, MinorityReport } from "@forum/shared";
import { clusterLabel } from "@forum/shared";
import { useDetailLevel } from "../../lib/detailLevel";
import { formatNumber, formatPercent } from "../../lib/format";
import { getTerm, termForDecisionCheck } from "../../lib/glossary";
import { Button, Card, cx, Details, HashText, OutcomeBadge, ProgressBar, Table, Term, Time, VoteBadge } from "../../ui";
import { UserLink } from "../UserLink";
import { fmtDecimal, PlainText, SubHeading, Tick } from "./common";
import "./results.css";

export interface ResultsCardProps {
  result: DecisionResult;
  minorityReports?: MinorityReport[];
  reconciliationOrigin?: "contested" | "objection" | null;
  myEffectiveVia?: { delegateNickname: string; choice: "yes" | "no" | "abstain" } | null;
}

/** Sonuç kartında ilk gösterilen azınlık raporu sayısı (fazlası "Tümünü göster" ile). */
export const MINORITY_PREVIEW = 2;

// ───────────── Saf yardımcılar (birim testli) ─────────────

/** Tek satır toplamlar: "57 uygun · 41 katıldı · Kabul 30 · Red 8 · Çekimser 3". */
export function totalsLine(t: DecisionResult["totals"]): string {
  return `${formatNumber(t.eligible)} uygun · ${formatNumber(t.participants)} katıldı · Kabul ${formatNumber(t.yes)} · Red ${formatNumber(t.no)} · Çekimser ${formatNumber(t.abstain)}`;
}

/**
 * Köprü testi bu turun karar kuralında MI? İtiraz sonrası yeniden oylamada küme tabanları uygulanmaz, yalnız gösterilir
 * (ALGORİTMA §4.3); diğer turlarda (ilk tur, tartışmalı sonuç sonrası yeniden oylama) kuralın parçasıdır.
 */
export function bridgeIsInformational(r: Pick<DecisionResult, "round">, origin?: "contested" | "objection" | null): boolean {
  return r.round === 2 && origin === "objection";
}

export type BridgeVerdict = "failed" | "neutral" | "passed" | "none";

/**
 * Köprü açılırının hükmü: "failed" = köprü sağlanmadı ya da bir anlamlı grup tabanı geçemedi; "neutral" = bir anlamlı grup
 * yeterince katılmadığı için nötr sayıldı (muaf); "passed" = tüm sınanan gruplar tabanı aştı; "none" = köprü sınanmadı
 * (soğuk başlangıç, yalnız bilgi ya da grup bilgisi yok). failed/neutral açılırı kendiliğinden açar.
 */
export function bridgeVerdict(r: Pick<DecisionResult, "bridgeApplicable" | "bridgeMet" | "clusters">, informational = false): BridgeVerdict {
  if (!r.clusters.length) return "none";
  if (!informational && (r.bridgeMet === false || r.clusters.some((c) => c.passed === false))) return "failed";
  if (r.bridgeApplicable && r.clusters.some((c) => c.significant && c.passed === null)) return "neutral";
  return r.bridgeApplicable && !informational ? "passed" : "none";
}

/** Köprü açılırının özet satırı: "3/3 anlamlı grup tabanı aştı · GAC 0,71". */
export function bridgeSummary(r: Pick<DecisionResult, "bridgeApplicable" | "clusters" | "gac">, informational = false): string {
  const parts: string[] = [];
  if (!r.bridgeApplicable) {
    parts.push("Köprü testi uygulanmadı (soğuk başlangıç)");
  } else {
    const significant = r.clusters.filter((c) => c.significant);
    const tested = significant.filter((c) => c.passed !== null);
    const passed = tested.filter((c) => c.passed === true).length;
    const neutral = significant.length - tested.length;
    if (tested.length) parts.push(`${passed}/${tested.length} anlamlı grup tabanı aştı`);
    if (neutral) parts.push(tested.length ? `${neutral} grup nötr sayıldı` : "Anlamlı grupların hiçbiri sınanamadı (nötr sayıldı)");
    if (informational) parts.push("bu turda yalnız bilgi");
  }
  if (r.gac !== null) parts.push(`GAC ${fmtDecimal(r.gac)}`);
  return parts.join(" · ");
}

/**
 * "Neden bu sonuç?" listesinde TAM SATIR (değer, gerekli, açıklama) görünen kontroller: başarısız olanlar, nötr sayılan (muaf)
 * kümenin köprü satırı ve kümelerde asgari oy kontrolü. Diğerleri rozet olur; tam metinleri "Kontrol ayrıntıları" açılırındadır.
 */
export function checkShowsNote(c: Pick<DecisionCheck, "key" | "passed">, clusters: Pick<ClusterResult, "clusterId" | "significant" | "passed">[]): boolean {
  if (!c.passed || c.key === "participation_shortfall") return true;
  if (c.key.startsWith("bridge:")) {
    const g = clusters.find((x) => x.clusterId === c.key.slice("bridge:".length));
    return !!g && g.significant && g.passed === null;
  }
  return false;
}

/** "Neden bu sonuç?" satırının görünümü: tam satır (başarısız/nötr), tek rozet (geçti) ya da birleşik köprü rozeti. */
export type CheckView =
  | { kind: "row"; check: DecisionCheck }
  | { kind: "chip"; check: DecisionCheck }
  | { kind: "bridge"; checks: DecisionCheck[] };

/**
 * Kontrolleri görünüme ayırır. Başarısız/nötr kontroller TAM SATIR (etiket, değer, gerekli, açıklama); geçenler yalnız ✔ ve
 * etiketle rozet olur (sayıları zaten çubuklarda görünür); geçen iki ya da daha çok küme köprü satırı tek rozette ("Köprü testi: 3
 * grup tabanı aştı") birleşir. Rozete inen her kontrolün tam metni "Kontrol ayrıntıları" açılırında durur. Küme tabanlarının uygulanmadığı
 * turda (`informational`) köprü satırları birleştirilmez: "geçti" demek yanıltıcı olur.
 */
export function planChecks(checks: DecisionCheck[], clusters: Pick<ClusterResult, "clusterId" | "significant" | "passed">[], informational = false): CheckView[] {
  const views: CheckView[] = [];
  let group: { kind: "bridge"; checks: DecisionCheck[] } | null = null;
  for (const c of checks) {
    if (checkShowsNote(c, clusters)) {
      views.push({ kind: "row", check: c });
    } else if (!informational && c.key.startsWith("bridge:")) {
      if (!group) {
        group = { kind: "bridge", checks: [] };
        views.push(group);
      }
      group.checks.push(c);
    } else {
      views.push({ kind: "chip", check: c });
    }
  }
  return views.map((v): CheckView => (v.kind === "bridge" && v.checks.length === 1 ? { kind: "chip", check: v.checks[0] } : v));
}

/** Rozete inen kontroller (tam metni açılırda durur), sırayla. */
export function collapsedChecks(views: CheckView[]): DecisionCheck[] {
  return views.flatMap((v) => (v.kind === "chip" ? [v.check] : v.kind === "bridge" ? v.checks : []));
}

// ───────────── Bileşenler ─────────────

export function ResultsCard({ result: r, minorityReports, reconciliationOrigin, myEffectiveVia }: ResultsCardProps) {
  const t = r.thresholdUsed;
  const tVal = t.den ? t.num / t.den : 0;
  const op = r.thresholdStrict ? ">" : "≥";
  const decided = r.totals.yes + r.totals.no;
  const tone = r.outcome === "accept" ? "success" : r.outcome === "reject" ? "danger" : "warning";
  const informational = bridgeIsInformational(r, reconciliationOrigin);

  return (
    <Card
      title={r.round === 1 ? "1. tur sonucu" : "Yeniden oylama sonucu"}
      subtitle={r.round === 2 && reconciliationOrigin ? (reconciliationOrigin === "objection" ? "İtiraz sonrası yeniden oylama" : "Tartışmalı sonuç sonrası yeniden oylama") : undefined}
      actions={<OutcomeBadge outcome={r.outcome} />}
      tone={tone}
    >
      <div className="stack result-summary">
        <p className="result-reason">
          <strong>Gerekçe:</strong> {r.reason}
        </p>

        <p className="result-line">{totalsLine(r.totals)}</p>

        <div className="result-bars">
          <ProgressBar
            label="Katılım"
            value={r.totals.participants}
            max={Math.max(1, r.totals.eligible)}
            valueText={`${r.totals.participants}/${r.totals.eligible}`}
            marker={r.quorumRequired}
            markerLabel={`Yeter sayı: en az ${r.quorumRequired} katılım`}
            tone={r.quorumMet ? "success" : "danger"}
          />
          <ProgressBar
            label="Onay oranı (kabul / (kabul + red))"
            value={r.approval}
            valueText={`${formatPercent(r.approval)} (${r.totals.yes}/${decided})`}
            marker={tVal}
            markerLabel={`Eşik: ${op} ${formatPercent(tVal)}${r.bridgeApplicable ? "" : " (soğuk başlangıç: nitelikli çoğunluk)"}`}
            tone={r.thresholdMet ? "success" : "danger"}
          />
        </div>

        <WhyChecks result={r} informational={informational} />

        <BridgeSection result={r} informational={informational} />

        <CountsDetails result={r} />

        {myEffectiveVia ? (
          <p className="small via-note">
            Doğrudan oy vermediniz; oyunuz vekâletle <strong>@{myEffectiveVia.delegateNickname}</strong> üzerinden <VoteBadge choice={myEffectiveVia.choice} /> olarak
            sayıldı (ağırlık her zaman 1).
          </p>
        ) : null}

        {minorityReports && minorityReports.length ? (
          <section aria-label="Azınlık raporları" className="stack-sm">
            <SubHeading>Azınlık raporları ({minorityReports.length})</SubHeading>
            <p className="small muted">Karar kaydına kalıcı olarak eklenir.</p>
            <MinorityReportList reports={minorityReports} initialCount={MINORITY_PREVIEW} />
          </section>
        ) : null}

        <p className="small muted result-meta">
          Algoritma {r.algoVersion} · hesaplandı <Time at={r.computedAt} mode="absolute" /> ·{" "}
          <Term id="ozet">girdi özeti</Term> <HashText hash={r.inputsHash} chars={10} label="Girdi özeti" />
        </p>
      </div>
    </Card>
  );
}

/** "Neden bu sonuç?": başarısız/nötr kontrol tam satır, geçenler rozet; rozetlerin tam metni bir açılırda. */
function WhyChecks({ result: r, informational }: { result: DecisionResult; informational: boolean }) {
  const views = planChecks(r.checks, r.clusters, informational);
  const collapsed = collapsedChecks(views);
  // Etiket sunucudan gelir ve aynen yazılır; ilgili bir sözlük terimi varsa etiketin tamamı o terimin düğmesi olur.
  const labelOf = (c: DecisionCheck): ReactNode => {
    const term = termForDecisionCheck(c.key);
    return term ? <Term id={term}>{c.label}</Term> : c.label;
  };
  return (
    <section aria-label="Neden bu sonuç?" className="stack-sm">
      <SubHeading>Neden bu sonuç?</SubHeading>
      <ul className="why-list">
        {views.map((v) =>
          v.kind === "row" ? (
            <li key={v.check.key} className={cx("why-row", v.check.passed ? "why-ok" : "why-fail")}>
              <Tick ok={v.check.passed} />
              <div className="why-text">
                <div>
                  <strong>{labelOf(v.check)}</strong>: {v.check.value} <span className="muted">(gerekli {v.check.required})</span>
                </div>
                {v.check.detail ? <div className="small muted">{v.check.detail}</div> : null}
              </div>
            </li>
          ) : v.kind === "bridge" ? (
            <li key="bridge-group" className="why-chip why-ok">
              <Tick ok />
              <span>
                <Term id="kopru-testi">Köprü testi: {v.checks.length} grup tabanı aştı</Term>
              </span>
            </li>
          ) : (
            <li key={v.check.key} className="why-chip why-ok">
              <Tick ok={v.check.passed} />
              <span>{labelOf(v.check)}</span>
            </li>
          ),
        )}
      </ul>
      {collapsed.length ? (
        <Details summary="Kontrol ayrıntıları" meta={`${collapsed.length} kontrol`}>
          <ul className="result-explain-list small">
            {collapsed.map((c) => (
              <li key={c.key}>
                <strong>{c.label}:</strong> {c.value} <span className="muted">(gerekli {c.required})</span>
                {c.detail ? <div className="muted">{c.detail}</div> : null}
              </li>
            ))}
          </ul>
        </Details>
      ) : null}
    </section>
  );
}

/** 'Görüş grupları ve köprü testi' açılırı; grup bilgisi yoksa tek satır not. */
function BridgeSection({ result: r, informational }: { result: DecisionResult; informational: boolean }) {
  if (!r.clusters.length) {
    return <p className="small muted">Bu oylamada görüş grubu (küme) bilgisi yok; yalnızca genel çoğunluk değerlendirildi.</p>;
  }
  const verdict = bridgeVerdict(r, informational);
  const attention = verdict === "failed" || verdict === "neutral";
  return (
    <Details
      className="result-bridge"
      summary="Görüş grupları ve köprü testi"
      // Sorun yoksa open verilmez: 'Tam' görünümde açılır yine açık gelir.
      open={attention ? true : undefined}
      meta={
        <span className={cx(verdict === "failed" && "result-verdict-fail", verdict === "neutral" && "result-verdict-warn", verdict === "passed" && "result-verdict-ok")}>
          {verdict === "none" ? null : (
            <span className="result-verdict-icon" aria-hidden="true">
              {verdict === "failed" ? "✘" : verdict === "neutral" ? "⚠" : "✔"}
            </span>
          )}
          {bridgeSummary(r, informational)}
        </span>
      }
    >
      <section aria-label="Görüş grupları" className="stack-sm">
        {/* Terim korunur, günlük karşılığı yanına yazılır (açılırın başlığında Term olamaz; burada görünür metin) */}
        <p className="small muted">
          <Term id="kopru-testi">Köprü testi</Term> — {getTerm("kopru-testi").plain}.
        </p>
        <Table<ClusterResult>
          caption="Görüş gruplarına göre oylar, P_g desteği ve taban"
          rowKey={(c) => c.clusterId}
          rows={r.clusters}
          columns={[
            {
              key: "label",
              header: "Grup",
              render: (c) => (
                <span>
                  {c.label || clusterLabel(c.clusterId)}
                  <span className="small muted cluster-sig">{c.significant ? "anlamlı" : "anlamlı değil"}</span>
                </span>
              ),
            },
            { key: "members", header: "Üye (n_g)", align: "right", render: (c) => formatNumber(c.members) },
            { key: "yes", header: "Kabul", align: "right", render: (c) => formatNumber(c.yes) },
            { key: "no", header: "Red", align: "right", render: (c) => formatNumber(c.no) },
            { key: "abstain", header: "Çekimser", align: "right", render: (c) => formatNumber(c.abstain) },
            { key: "pg", header: "P_g", align: "right", render: (c) => <strong>{fmtDecimal(c.pg)}</strong> },
            { key: "floor", header: "Taban φ", align: "right", render: (c) => (c.floor !== null ? fmtDecimal(c.floor) : "—") },
            {
              key: "passed",
              header: "Geçti mi?",
              align: "center",
              render: (c) => <Tick ok={c.passed} label={c.passed === null ? "köprü testine girmedi" : c.passed ? "taban sağlandı" : "taban sağlanmadı"} />,
            },
          ]}
        />
        <p className="small muted">
          <Term id="p-g">P_g</Term> = (1 + Kabul) / (2 + Kabul + Red). Hiç oy vermeyen grup 0,50 sayılır: boykot bir engel aracı değildir; bir grup kararı ancak etkin biçimde “Red” diyerek
          durdurabilir. Kümelenmemiş (yeni) üyeler genel orana sayılır, köprü testine girmez.
        </p>
        {r.gac !== null ? (
          <p className="small">
            <strong>
              <Term id="gac">Grup bilgili uzlaşı (GAC)</Term>: {fmtDecimal(r.gac)}
            </strong> <span className="muted">— anlamlı grupların P_g değerlerinin geometrik ortalaması; yalnızca gösterge.</span>
          </p>
        ) : null}
      </section>
    </Details>
  );
}

/** 'Ayrıntılı sayılar': yedi kutu, görünür açıklamalar ve soğuk başlangıç notu. */
function CountsDetails({ result: r }: { result: DecisionResult }) {
  return (
    <Details
      className="result-counts"
      summary="Ayrıntılı sayılar"
      meta={`vekâletle ${formatNumber(r.totals.delegated)} · yönlendirilemeyen ${formatNumber(r.totals.unrouted)}`}
    >
      <div className="stack-sm">
        <dl className="result-totals">
          <Total label="Uygun seçmen" value={r.totals.eligible} />
          <Total label="Katılım" value={r.totals.participants} tone={r.quorumMet ? "success" : "danger"} />
          <Total label="Kabul" value={r.totals.yes} tone="success" />
          <Total label="Red" value={r.totals.no} tone="danger" />
          <Total label="Çekimser" value={r.totals.abstain} />
          <Total label="Vekâletle" value={r.totals.delegated} tone="info" />
          <Total label="Yönlendirilemeyen" value={r.totals.unrouted} />
        </dl>
        <ul className="result-notes small muted">
          <li>
            <strong>Vekâletle:</strong> doğrudan oy vermeyen, oyu vekâlet zinciriyle sayılan kişi.
          </li>
          <li>
            <strong>Yönlendirilemeyen:</strong> delegenin vekâlet sınırı aşıldığı için oyu kullanılamayan kişi.
          </li>
        </ul>
        {!r.bridgeApplicable ? (
          <p className="small muted">Yeterli görüş verisi yok; köprü testi yerine nitelikli çoğunluk arandı (eşik δ kadar yükseltildi, en fazla 2/3).</p>
        ) : null}
      </div>
    </Details>
  );
}

function Total({ label, value, tone }: { label: string; value: number; tone?: "success" | "danger" | "info" }) {
  return (
    <div className={cx("result-total", tone && `result-total-${tone}`)}>
      <dt>{label}</dt>
      <dd>{formatNumber(value)}</dd>
    </div>
  );
}

/**
 * Azınlık raporları. `initialCount` verilirse ilk bu kadarı görünür, fazlası "Tümünü göster (n)" ile açılır ('Tam'
 * görünümde hepsi açık gelir); verilmezse (Uzlaşma paneli gibi) hepsi görünür.
 */
export function MinorityReportList({ reports, initialCount }: { reports: MinorityReport[]; initialCount?: number }) {
  const { full } = useDetailLevel();
  const listId = useId();
  const [expanded, setExpanded] = useState<boolean | null>(null); // null: dokunulmadı → görünüm yoğunluğuna uyar
  const limited = initialCount !== undefined && reports.length > initialCount;
  const showAll = !limited || (expanded ?? full);
  const shown = showAll ? reports : reports.slice(0, initialCount);
  return (
    <>
      <ul className="list" id={listId}>
        {shown.map((m) => (
          <li key={m.id} className="list-item stack-sm">
            <div className="row small">
              <UserLink id={m.authorId} nickname={m.authorNickname} />
              <span className="muted">{clusterLabel(m.clusterId)}</span>
              <Time at={m.createdAt} className="muted" />
            </div>
            <PlainText text={m.body} />
          </li>
        ))}
      </ul>
      {limited ? (
        <Button variant="ghost" size="sm" className="result-more" aria-expanded={showAll} aria-controls={listId} onClick={() => setExpanded(!showAll)}>
          {showAll ? "Daha az göster" : `Tümünü göster (${reports.length})`}
        </Button>
      ) : null}
    </>
  );
}
