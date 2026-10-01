// Yönetmelik (ontoloji) görünümleri: maddeler, kategori ağacı, haklar, gerekçeler, katmanlar, parametreler, sürümler, Turtle.
import { useMemo, useState } from "react";
import { Link } from "react-router-dom";
import { compactIri, TIER_LABELS, type ArticleInfo, type CategoryNode, type GroundInfo, type OntologyOverview, type ProtectionLevel } from "@forum/shared";
import { getOntologyVersions, getTurtle } from "../../api/endpoints";
import { downloadText } from "../../lib/download";
import { formatDateTime, formatNumber, formatPercent, normalizeSearch } from "../../lib/format";
import { routes } from "../../lib/routes";
import { useAsync } from "../../lib/useAsync";
import { Alert, Badge, Button, Card, CopyButton, EmptyState, ErrorView, HashText, Input, Select, Spinner, Table, TierBadge, type Tone } from "../../ui";
import "./system.css";

const PROTECTION: Record<ProtectionLevel, { label: string; tone: Tone; hint: string }> = {
  Degistirilemez: { label: "Değiştirilemez", tone: "danger", hint: "Oylanamaz: hedefleyen öneri kural gereği geçersizdir (T3)." },
  Nitelikli: { label: "Nitelikli", tone: "warning", hint: "Değişikliği 3/4 eşik ve 0,50 yeter sayı ister." },
  Olagan: { label: "Olağan", tone: "neutral", hint: "Yönetmelik değişikliği (T2) kurallarıyla değiştirilebilir." },
};

export function ProtectionBadge({ level }: { level: ProtectionLevel }) {
  const p = PROTECTION[level] ?? PROTECTION.Olagan;
  return (
    <Badge tone={p.tone} title={p.hint} icon={level === "Degistirilemez" ? "warning" : undefined}>
      {p.label}
    </Badge>
  );
}

export function ArticlesView({ articles }: { articles: ArticleInfo[] }) {
  const [q, setQ] = useState("");
  const [level, setLevel] = useState("");
  const nq = normalizeSearch(q.trim());
  const filtered = articles.filter(
    (a) => (!level || a.protection === level) && (!nq || normalizeSearch(`${a.number} ${a.title} ${a.text}`).includes(nq)),
  );
  const parts = useMemo(() => {
    const m = new Map<string, ArticleInfo[]>();
    for (const a of filtered) {
      const k = a.part ?? "Diğer hükümler";
      m.set(k, [...(m.get(k) ?? []), a]);
    }
    return [...m.entries()];
  }, [filtered]);
  const counts = (["Degistirilemez", "Nitelikli", "Olagan"] as ProtectionLevel[]).map((l) => [l, articles.filter((a) => a.protection === l).length] as const);

  return (
    <div className="stack">
      <div className="row">
        {counts.map(([l, n]) => (
          <span key={l} className="row">
            <ProtectionBadge level={l} /> <span className="small muted">{n} fıkra</span>
          </span>
        ))}
      </div>
      <div className="form-grid">
        <Input label="Maddelerde ara" type="search" value={q} onChange={(e) => setQ(e.target.value)} />
        <Select
          label="Koruma düzeyi"
          value={level}
          onChange={(e) => setLevel(e.target.value)}
          options={[{ value: "", label: "Tümü" }, ...(Object.keys(PROTECTION) as ProtectionLevel[]).map((l) => ({ value: l, label: PROTECTION[l].label }))]}
        />
      </div>
      {!filtered.length ? <EmptyState title="Eşleşen madde yok" /> : null}
      {parts.map(([part, list]) => (
        <section key={part} className="stack-sm" aria-label={part}>
          <h3 className="h3 mt-0">{part}</h3>
          <ul className="list">
            {list.map((a) => (
              <li key={a.iri} className="list-item">
                <article className={a.protection === "Degistirilemez" ? "sy-article is-immutable" : a.protection === "Nitelikli" ? "sy-article is-qualified" : "sy-article"}>
                  <div className="row-between">
                    <strong>
                      {a.number}
                      {a.title ? ` — ${a.title}` : ""}
                    </strong>
                    <ProtectionBadge level={a.protection} />
                  </div>
                  <p className="sy-article-text">{a.text}</p>
                  <code className="small muted">{compactIri(a.iri)}</code>
                </article>
              </li>
            ))}
          </ul>
        </section>
      ))}
    </div>
  );
}

function CategoryTreeNode({ n }: { n: CategoryNode }) {
  return (
    <li className="tree-item">
      <div className="row">
        <strong>{n.label}</strong>
        {n.requiresExpert ? (
          <Badge tone="info" icon="experts" title="Bu kategorideki öneriler için bilirkişi görüşü gerekir">
            bilirkişi gerekli
          </Badge>
        ) : null}
        <code className="small muted">{compactIri(n.iri)}</code>
      </div>
      {n.keywords?.length ? <div className="sy-keywords">Anahtar kelimeler: {n.keywords.join(", ")}</div> : null}
      {n.children.length ? (
        <ul>
          {n.children.map((c) => (
            <CategoryTreeNode key={c.iri} n={c} />
          ))}
        </ul>
      ) : null}
    </li>
  );
}

export function CategoriesView({ roots }: { roots: CategoryNode[] }) {
  if (!roots.length) return <EmptyState title="Kategori yok" />;
  return (
    <div className="stack-sm">
      <p className="mt-0 small muted">
        Kategoriler bir sınıf ağacıdır (alt sınıf ilişkisi). Bir öneri alt kategoriye girerse üst kategorilerin kuralları da uygulanır; bilirkişi gereksinimi
        miras alınır.
      </p>
      <ul className="tree sy-tree">
        {roots.map((r) => (
          <CategoryTreeNode key={r.iri} n={r} />
        ))}
      </ul>
    </div>
  );
}

export function RightsView({ o, articleLabel }: { o: OntologyOverview; articleLabel: (iri: string) => string }) {
  return (
    <div className="stack-sm">
      <p className="mt-0 small muted">
        Temel hakları kısıtlayan öneriler en az T1 (nitelikli) katmanda oylanır ve bilirkişi incelemesi gerektirir; özü oylanamaz hakların kısıtlanması
        geçersizdir. Herkes hak etkisi bayrağı ekleyebilir (yalnızca yükseltme); bayrağı yalnızca bilirkişi ya da yönetici kaldırabilir.
      </p>
      <ul className="list">
        {o.rights.map((r) => (
          <li key={r.iri} className="list-item">
            <strong>{r.label}</strong>
            <p className="sy-article-text">{r.description}</p>
            {r.article ? <span className="small muted">Dayanak: {articleLabel(r.article)}</span> : null}
          </li>
        ))}
      </ul>
    </div>
  );
}

function GroundList({ grounds, kind }: { grounds: GroundInfo[]; kind: "deletion" | "objection" }) {
  return (
    <ul className="list">
      {grounds.map((g) => {
        const invalid = /GorusAyriligi$/.test(g.iri);
        return (
          <li key={g.iri} className="list-item">
            <div className="row">
              <strong>{g.label}</strong>
              {invalid ? (
                <Badge tone="danger" icon="error">
                  geçersiz gerekçe
                </Badge>
              ) : null}
              {kind === "deletion" && g.urgent ? (
                <Badge tone="warning" icon="clock" title="Talep anında ilgili mesaj daraltılır (gizlenmez)">
                  acil — talep anında daraltılır
                </Badge>
              ) : null}
              {g.legal ? (
                <Badge tone="info" title="Bilirkişi görüşü bağlayıcıdır">
                  hukuki
                </Badge>
              ) : null}
            </div>
            <p className="sy-article-text">{g.description}</p>
          </li>
        );
      })}
    </ul>
  );
}

export function GroundsView({ o }: { o: OntologyOverview }) {
  return (
    <div className="stack">
      <section className="stack-sm" aria-label="Silme gerekçeleri">
        <h3 className="h3 mt-0">Silme (karartma) gerekçeleri</h3>
        <Alert tone="warning" title="“Görüş ayrılığı” geçersiz bir gerekçedir">
          Bir mesaja katılmamak onu karartmak için gerekçe olamaz. Bu kural değiştirilemez bir maddedir ve SHACL ile denetlenir; bu gerekçeyle açılan talep
          oylamaya hiç girmez. Kabul edilen karartmada mesaj silinmez, gizlenir; asıl metin denetçiye (erişim kaydıyla) açık kalır.
        </Alert>
        <GroundList grounds={o.deletionGrounds} kind="deletion" />
      </section>
      <section className="stack-sm" aria-label="İtiraz gerekçeleri">
        <h3 className="h3 mt-0">Azınlık itirazı gerekçeleri</h3>
        <p className="mt-0 small muted">
          İlk turda kabul edilen bir öneriye “hayır” oyu vermiş üyeler, bu gerekçelerden biriyle itiraz imzalayabilir. Geçerli itiraz bir kez uzlaşma ve
          yeniden oylama başlatır (erteleyici, mutlak değil).
        </p>
        <GroundList grounds={o.objectionGrounds} kind="objection" />
      </section>
    </div>
  );
}

export function TiersView({ o }: { o: OntologyOverview }) {
  const hasT3 = o.tiers.some((t) => t.tier === "T3");
  const rows = hasT3 ? o.tiers : [...o.tiers, { tier: "T3" as const, label: TIER_LABELS.T3, quorum: NaN, threshold: NaN, clusterFloor: NaN }];
  return (
    <div className="stack-sm">
      <Table
        caption="Karar katmanları"
        rows={rows}
        rowKey={(t) => t.tier}
        columns={[
          { key: "tier", header: "Katman", render: (t) => <TierBadge tier={t.tier} /> },
          { key: "q", header: "Yeter sayı q", align: "right", render: (t) => (t.tier === "T3" ? "—" : formatPercent(t.quorum)) },
          { key: "tau", header: "Eşik τ", align: "right", render: (t) => (t.tier === "T3" ? "—" : formatPercent(t.threshold)) },
          { key: "phi", header: "Küme tabanı φ", align: "right", render: (t) => (t.tier === "T3" ? "—" : formatPercent(t.clusterFloor)) },
          {
            key: "note",
            header: "Not",
            render: (t) =>
              t.tier === "T3" ? (
                <Badge tone="danger">oylanamaz — kural gereği geçersiz</Badge>
              ) : t.tier === "DEL" ? (
                <span className="small">+ yazarın kümesinde P ≥ 0,50</span>
              ) : t.tier === "T0" ? (
                <span className="small">a &gt; τ (kesin)</span>
              ) : (
                <span className="small">a ≥ τ</span>
              ),
          },
        ]}
      />
      <p className="small muted mt-0">
        q: katılım oranı (uygun seçmenlere göre); τ: kabul oranı a = Evet / (Evet + Hayır); φ: her anlamlı görüş kümesinden aranan asgari Laplace
        yumuşatmalı destek (köprü testi). Parametreler oylama açılırken öneriye sabitlenir; sonradan yönetmelik değişse de geriye etkili olmaz.
      </p>
    </div>
  );
}

export function ParamsView({ o }: { o: OntologyOverview }) {
  const fmt = (v: number | boolean | string) => (typeof v === "boolean" ? (v ? "evet" : "hayır") : typeof v === "number" ? (Number.isInteger(v) ? formatNumber(v) : formatNumber(v, 4).replace(/0+$/, "")) : v);
  return (
    <Table
      caption="Yönetmelik parametreleri"
      rows={o.params}
      rowKey={(p) => `${p.rule}|${p.param}`}
      empty={<EmptyState title="Parametre yok" />}
      columns={[
        { key: "label", header: "Parametre", render: (p) => p.label },
        { key: "value", header: "Değer", align: "right", render: (p) => <strong>{fmt(p.value)}</strong> },
        {
          key: "lock",
          header: "Durum",
          render: (p) =>
            p.immutable ? (
              <Badge tone="danger" title="Değiştirilemez maddeye dayanır">
                kilitli
              </Badge>
            ) : (
              <Badge tone="neutral">ayarlanabilir</Badge>
            ),
        },
        { key: "iri", header: "Kural / alan", hideOnMobile: true, render: (p) => <code className="small">{compactIri(p.rule)} · {p.param}</code> },
      ]}
    />
  );
}

export function VersionsView({ onShowTurtle }: { onShowTurtle: (v: number) => void }) {
  const { data, error, loading, reload } = useAsync(() => getOntologyVersions(), []);
  if (loading && !data) return <Spinner block />;
  if (error) return <ErrorView error={error} onRetry={reload} />;
  const rows = [...(data ?? [])].sort((a, b) => b.version - a.version);
  return (
    <Table
      caption="Yönetmelik sürümleri"
      rows={rows}
      rowKey={(v) => String(v.version)}
      empty={<EmptyState title="Sürüm kaydı yok" />}
      columns={[
        { key: "v", header: "Sürüm", render: (v) => <strong>v{v.version}</strong> },
        { key: "hash", header: "Özet", render: (v) => <HashText hash={v.hash} /> },
        { key: "at", header: "Tarih", render: (v) => <span className="nowrap">{formatDateTime(v.createdAt, true)}</span> },
        { key: "via", header: "Kaynak öneri", render: (v) => (v.viaProposalId ? <Link to={routes.proposal(v.viaProposalId)}>Öneriyi aç</Link> : <span className="muted">ilk sürüm</span>) },
        { key: "tx", header: "Defter", hideOnMobile: true, render: (v) => (v.ledgerTx ? <HashText hash={v.ledgerTx} to={routes.tx(v.ledgerTx)} /> : <span className="muted">—</span>) },
        {
          key: "ttl",
          header: "Turtle",
          render: (v) => (
            <Button size="sm" variant="ghost" onClick={() => onShowTurtle(v.version)}>
              Turtle
            </Button>
          ),
        },
      ]}
    />
  );
}

export function TurtleView({ versions, version, onVersion }: { versions: number[]; version: number | null; onVersion: (v: number | null) => void }) {
  const { data, error, loading, reload } = useAsync(() => getTurtle(version ?? undefined), [version]);
  const name = `yonetmelik${version ? `-v${version}` : ""}.ttl`;
  return (
    <Card
      title="Turtle (RDF) dökümü"
      subtitle="Yönetmeliğin makinece okunabilir A-kutusu. Sürüm özeti, sıralı N-Triples satırlarının SHA-256'sıdır."
      actions={
        data ? (
          <div className="row">
            <CopyButton text={data} />
            <Button size="sm" variant="ghost" onClick={() => downloadText(name, data, "text/turtle;charset=utf-8")}>
              İndir
            </Button>
          </div>
        ) : null
      }
    >
      <div className="stack">
        <div className="sy-narrow-field">
          <Select
            label="Sürüm"
            value={version === null ? "" : String(version)}
            onChange={(e) => onVersion(e.target.value ? Number(e.target.value) : null)}
            options={[{ value: "", label: "Güncel sürüm" }, ...versions.map((v) => ({ value: String(v), label: `v${v}` }))]}
          />
        </div>
        {loading && !data ? <Spinner block /> : error ? <ErrorView error={error} onRetry={reload} compact /> : data ? <pre className="sy-pre">{data}</pre> : null}
      </div>
    </Card>
  );
}

export function ModelExplainer() {
  return (
    <Card title="Yönetmelik nasıl çalışır?" tone="muted">
      <ul className="steps">
        <li>
          <strong>T-kutusu (şema):</strong> madde, kategori, temel hak, gerekçe, katman ve kural sınıfları ile özellikleri. Kodla birlikte gelir, oylanmaz.
        </li>
        <li>
          <strong>A-kutusu (bilgi):</strong> maddeler, kategori ağacı, haklar, gerekçeler ve parametreler. Yalnızca kabul edilmiş bir yönetmelik değişikliği
          önerisiyle, yeni sürüm olarak değişir; her sürümün özeti deftere yazılır.
        </li>
        <li>
          <strong>N3 kuralları:</strong> öneri bir RDF alt grafına çevrilir ve ileri zincirleme çıkarımla kategori kalıtımı, bilirkişi gereksinimi, hak
          kısıtlaması, değiştirilemez hedef gibi sonuçlar türetilir.
        </li>
        <li>
          <strong>SHACL şekilleri:</strong> ihlal ve uyarıları maddeye atıflı Türkçe mesajlarla üretir. İhlal varsa öneri oylamaya girmez.
        </li>
        <li>
          <strong>“En koruyucu kazanır”:</strong> birden çok kural uygulanırsa her parametre için en koruyucu değer seçilir (q, τ, φ için en büyüğü, süreler
          için en uzunu; bilirkişi gereksinimi “veya”).
        </li>
        <li>
          <strong>Meta-kurallar:</strong> değiştirilemez çekirdek değiştirilemez; yeni değiştirilemez hüküm üretilemez (bugünkü çoğunluk kendini
          kalıcılaştıramaz); koruma tabanları ve kalıcılaştırma sınırları aşılamaz; iki adımlı atlatma yasaktır.
        </li>
      </ul>
    </Card>
  );
}
