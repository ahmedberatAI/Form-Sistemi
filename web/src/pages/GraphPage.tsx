// Graf: insanlar grafı (kenar türü süzgeci, düğüm kartı), görüş haritası (PCA + k-means), graf istatistikleri.
// Grafik bileşeni ağırdır: yalnızca "İnsanlar" sekmesinde React.lazy ile yüklenir.
import { lazy, Suspense, useState } from "react";
import { EDGE_LABELS, type EdgeType, type GraphVisNode } from "@forum/shared";
import { getGraph, getGraphStats, getLatestClusters } from "../api/endpoints";
import { useAuth } from "../auth/AuthContext";
import { UserLink } from "../components/UserLink";
import { ClusterMap } from "../components/community/ClusterMap";
import { ClusterGlyph, clusterLabel } from "../components/community/vizColors";
import "../components/community/community.css";
import { formatDateTime, formatNumber, formatPercent } from "../lib/format";
import { useQueryState } from "../lib/hooks";
import { routes } from "../lib/routes";
import { useAsync } from "../lib/useAsync";
import { Alert, Badge, Card, Checkbox, Details, EmptyState, ErrorView, HashText, KeyValue, LinkButton, PageHeader, Spinner, Stat, StatGrid, Table, Tabs } from "../ui";

const PeopleGraph = lazy(() => import("../components/community/PeopleGraph"));

type TabId = "insanlar" | "harita" | "istatistik";
const FILTER_TYPES: EdgeType[] = ["FOLLOWS", "VOUCHES", "DELEGATES_TO", "REPLIED_TO"];
const DEFAULT_TYPES: EdgeType[] = ["FOLLOWS", "VOUCHES", "DELEGATES_TO"];

export default function GraphPage() {
  const [tabRaw, setTab] = useQueryState("sekme", "insanlar");
  const tab = (["insanlar", "harita", "istatistik"].includes(tabRaw) ? tabRaw : "insanlar") as TabId;
  return (
    <div className="page">
      <PageHeader
        title="Graf ve görüş kümeleri"
        subtitle="Üyeler arasındaki herkese açık ilişkiler ve oy örüntülerinden çıkarılan görüş kümeleri. Kümeler köprü testinde kullanılır; graf göstergeleri yalnızca bilgi amaçlıdır."
      />
      <Tabs
        label="Graf bölümleri"
        value={tab}
        onChange={(v) => setTab(v)}
        tabs={[
          { id: "insanlar", label: "İnsanlar grafı" },
          { id: "harita", label: "Görüş haritası" },
          { id: "istatistik", label: "İstatistikler" },
        ]}
      >
        {tab === "harita" ? <OpinionMap /> : tab === "istatistik" ? <StatsView /> : <PeopleTab />}
      </Tabs>
    </div>
  );
}

// ───────────── İnsanlar grafı ─────────────

function PeopleTab() {
  const auth = useAuth();
  const [types, setTypes] = useState<EdgeType[]>(DEFAULT_TYPES);
  const { data, error, loading, reload } = useAsync(() => getGraph({ types, limit: 500 }), [types.join(",")]);
  const [selected, setSelected] = useState<GraphVisNode | null>(null);

  const toggle = (t: EdgeType, on: boolean) => setTypes((xs) => (on ? FILTER_TYPES.filter((x) => xs.includes(x) || x === t) : xs.filter((x) => x !== t)));
  const clusters = [...new Set((data?.nodes ?? []).map((n) => n.cluster ?? ""))].sort();
  const sel = selected && data?.nodes.find((n) => n.id === selected.id) ? selected : null;

  return (
    <div className="stack">
      <fieldset className="cm-edge-filters">
        <legend className="field-label">Gösterilecek ilişkiler</legend>
        {FILTER_TYPES.map((t) => (
          <Checkbox key={t} label={EDGE_LABELS[t]} checked={types.includes(t)} onChange={(e) => toggle(t, e.target.checked)} />
        ))}
      </fieldset>

      {loading && !data ? (
        <Spinner block label="Graf yükleniyor…" />
      ) : error ? (
        <ErrorView error={error} onRetry={reload} />
      ) : !data?.nodes.length ? (
        <EmptyState title="Grafta henüz düğüm yok" icon="graph" />
      ) : (
        <>
          <Suspense fallback={<Spinner block label="Grafik bileşeni yükleniyor…" />}>
            <PeopleGraph nodes={data.nodes} edges={data.edges} selectedId={sel?.id ?? null} meId={auth.user?.id ?? null} onSelect={setSelected} />
          </Suspense>
          <ul className="cm-legend" aria-label="Lejant">
            {clusters.map((c) => (
              <li key={c || "none"}>
                <ClusterGlyph clusterId={c || null} /> {clusterLabel(c || null)}
              </li>
            ))}
            <li>büyüklük = PageRank (etki)</li>
            <li>
              <svg width="14" height="14" aria-hidden="true">
                <circle cx="7" cy="7" r="5.5" fill="none" stroke="var(--viz-ring)" strokeWidth="1.6" />
              </svg>
              halka = bilirkişi
            </li>
            <li>
              <svg width="14" height="14" aria-hidden="true">
                <circle cx="7" cy="7" r="5.5" fill="none" stroke="var(--danger)" strokeWidth="1.6" strokeDasharray="2 2" />
              </svg>
              kesikli kırmızı halka = sahte hesap şüphesi
            </li>
            <li>
              <span className="cm-swatch-line" /> takip / vekâlet (oklu)
            </li>
            <li>
              <span className="cm-swatch-line is-dashed" /> kefalet · noktalı: yanıt
            </li>
          </ul>
          <p className="small muted mt-0">
            {formatNumber(data.nodes.length)} düğüm, {formatNumber(data.edges.length)} kenar. Bir düğüme dokunarak ayrıntısını görün; sürükleyerek ve
            iki parmakla yakınlaştırarak gezinin. Yakınlık (aile/iş/hane) beyanları gizlidir ve grafta gösterilmez.
          </p>
          {sel ? <NodeCard n={sel} isMe={sel.id === auth.user?.id} onClose={() => setSelected(null)} /> : null}
          <Details summary="Düğüm listesi (tablo görünümü)">
            <Table
              caption="Graf düğümleri"
              rows={[...data.nodes].sort((a, b) => b.pagerank - a.pagerank)}
              rowKey={(n) => n.id}
              columns={[
                { key: "n", header: "Üye", render: (n) => <UserLink id={n.id} nickname={n.label} isExpert={n.isExpert} /> },
                { key: "c", header: "Küme", render: (n) => <span className="row"><ClusterGlyph clusterId={n.cluster} /> {clusterLabel(n.cluster)}</span> },
                { key: "pr", header: "PageRank", align: "right", render: (n) => formatNumber(n.pagerank, 4) },
                { key: "co", header: "Topluluk", align: "right", hideOnMobile: true, render: (n) => (n.community ?? "—") },
                { key: "s", header: "İşaret", render: (n) => (n.sybilFlag ? <Badge tone="danger">şüpheli</Badge> : null) },
              ]}
            />
          </Details>
        </>
      )}
    </div>
  );
}

function NodeCard({ n, isMe, onClose }: { n: GraphVisNode; isMe: boolean; onClose: () => void }) {
  return (
    <Card
      title={
        <span className="row">
          <ClusterGlyph clusterId={n.cluster} /> @{n.label}
          {isMe ? <Badge tone="info">siz</Badge> : null}
        </span>
      }
      actions={
        <div className="row">
          <LinkButton size="sm" variant="primary" to={routes.user(n.id)}>
            Profili aç
          </LinkButton>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>
            Kapat
          </button>
        </div>
      }
      headingLevel={3}
    >
      <KeyValue
        compact
        items={[
          { label: "Görüş kümesi", value: clusterLabel(n.cluster) },
          { label: "Topluluk (Louvain)", value: n.community ?? "—" },
          { label: "PageRank", value: formatNumber(n.pagerank, 4) },
          n.isExpert ? { label: "Bilirkişi", value: <Badge tone="accent">evet</Badge> } : null,
          n.sybilFlag
            ? {
                label: "Sahte hesap şüphesi",
                value: <Badge tone="danger" icon="warning">işaretli</Badge>,
                hint: "Graf yapısına dayalı otomatik bir uyarıdır, kesin yargı değildir; kayıt memuru incelemesi gerekir.",
              }
            : null,
        ]}
      />
    </Card>
  );
}

// ───────────── Görüş haritası ─────────────

function OpinionMap() {
  const auth = useAuth();
  const { data, error, loading, reload } = useAsync(() => getLatestClusters(), []);
  if (loading && data === undefined) return <Spinner block label="Görüş haritası yükleniyor…" />;
  if (error) return <ErrorView error={error} onRetry={reload} />;
  if (!data) {
    return (
      <EmptyState title="Henüz kümeleme yapılmadı" icon="graph">
        <p>Kümeleme, kapanmış önerilerdeki oylar yeterli olduğunda yapılır.</p>
      </EmptyState>
    );
  }
  return (
    <div className="stack">
      {data.k <= 1 ? (
        <Alert tone="info" title="Tek küme">
          Siluet değeri düşük olduğu ya da veri yetersiz kaldığı için tek küme kabul edildi; köprü testi uygulanmaz, bunun yerine eşik yükseltilir (soğuk
          başlangıç).
        </Alert>
      ) : null}
      <ClusterMap snapshot={data} meId={auth.user?.id ?? null} />
      <Card title="Bu görüntü hakkında" tone="muted">
        <div className="stack-sm">
          <KeyValue
            compact
            items={[
              { label: "Küme sayısı (K)", value: data.k },
              { label: "Siluet", value: formatNumber(data.silhouette, 3), hint: "−1 ile 1 arası; 0,25'in altı tek küme sayılır." },
              { label: "Kümelenen üye", value: data.members },
              { label: "Oluşturulma", value: formatDateTime(data.createdAt) },
              { label: "Tohum", value: <HashText hash={data.seed} label="Tohum" /> },
              { label: "Girdi özeti", value: <HashText hash={data.inputHash} label="Girdi özeti" /> },
              { label: "Defter kaydı", value: data.ledgerTx ? <HashText hash={data.ledgerTx} to={routes.tx(data.ledgerTx)} label="Defter kaydı" /> : "—" },
            ]}
          />
          <p className="small mt-0">
            Her nokta bir üyedir: kapanmış önerilerdeki oylar (+1 kabul, −1 red, 0 çekimser) temel bileşen analiziyle (PCA) iki boyuta indirilir, k-means ile
            kümelenir. Eksenlerin kesin bir anlamı yoktur; yakın noktalar benzer oy veren üyelerdir. Hesap tohumlu ve belirlenimcidir; girdi özeti ve sonuç
            deftere yazılır.
          </p>
          <p className="small muted mt-0">
            Gizlilik: haritada diğer üyelerin takma adları gösterilmez. Kendi kümeniz Profil sayfanızda yalnızca size gösterilir.
          </p>
        </div>
      </Card>
    </div>
  );
}

// ───────────── İstatistikler ─────────────

function StatsView() {
  const { data, error, loading, reload } = useAsync(() => getGraphStats(), []);
  if (loading && !data) return <Spinner block label="İstatistikler yükleniyor…" />;
  if (error) return <ErrorView error={error} onRetry={reload} />;
  if (!data) return null;
  return (
    <div className="stack-lg">
      <StatGrid>
        <Stat label="Düğüm" value={formatNumber(data.nodes)} />
        <Stat label="Kenar" value={formatNumber(data.edges)} />
        <Stat label="Topluluk (Louvain)" value={data.communities} hint="çapraz kontrol göstergesi" />
        <Stat label="Modülerlik" value={formatNumber(data.modularity, 3)} hint="Louvain — çapraz kontrol göstergesi" />
        <Stat label="Vekâlet Gini katsayısı" value={formatNumber(data.delegationGini, 3)} hint="0 = eşit dağılım, 1 = tek kişide toplanma" tone={data.delegationGini > 0.6 ? "warning" : "neutral"} />
        <Stat label="En yüksek vekâlet yükü" value={data.maxDelegationLoad} hint="bir delegeye verilen vekâlet" />
        <Stat label="Sahte hesap şüphesi" value={data.sybilFlagged} tone={data.sybilFlagged ? "danger" : "neutral"} hint="işaretli hesap" />
      </StatGrid>
      <p className="small muted mt-0">
        Louvain toplulukları, görüş kümelerinin (PCA + k-means) bağımsız bir çapraz kontrolüdür; karar hesabında kullanılmaz. Vekâlet Gini katsayısı oy
        gücünün birkaç kişide toplanıp toplanmadığını izler; her delegenin taşıyabileceği oy ayrıca sınırlıdır.
      </p>

      <Card title="Aracılar (köprü kuran üyeler)" subtitle="Farklı toplulukları birbirine bağlayan üyeler (aracılık puanına göre).">
        <Table
          caption="Aracılar"
          rows={data.brokers}
          rowKey={(b) => b.userId}
          empty={<EmptyState title="Aracı bulunamadı" />}
          columns={[
            { key: "n", header: "Üye", render: (b) => <UserLink id={b.userId} nickname={b.nickname} /> },
            { key: "s", header: "Puan", align: "right", render: (b) => formatNumber(b.score, 3) },
          ]}
        />
      </Card>

      <Card title="Kalıcı kaybeden küme göstergesi" subtitle="Çoğunluk tiranlığı için erken uyarı: bir görüş kümesinin kararların çoğunda kaybeden tarafta kalıp kalmadığı.">
        {data.permanentLoser.length ? (
          <Table
            caption="Kümelere göre kaybedilen karar payı"
            rows={[...data.permanentLoser].sort((a, b) => b.lostShare - a.lostShare)}
            rowKey={(r) => r.clusterId}
            columns={[
              { key: "c", header: "Küme", render: (r) => <span className="row"><ClusterGlyph clusterId={r.clusterId} /> {clusterLabel(r.clusterId)}</span> },
              {
                key: "l",
                header: "Kaybedilen pay",
                align: "right",
                render: (r) => formatPercent(r.lostShare),
              },
              { key: "d", header: "Karar sayısı", align: "right", render: (r) => r.decisions },
            ]}
          />
        ) : (
          <EmptyState title="Henüz yeterli karar yok" />
        )}
      </Card>
    </div>
  );
}
