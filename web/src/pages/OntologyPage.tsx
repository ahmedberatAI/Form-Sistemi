// Yönetmelik (ontoloji): maddeler, kategoriler, haklar, gerekçeler, katmanlar, parametreler, sürümler, Turtle ve model açıklaması.
import { useState } from "react";
import { getOntologyVersions } from "../api/endpoints";
import {
  ArticlesView,
  CategoriesView,
  GroundsView,
  ModelExplainer,
  ParamsView,
  RightsView,
  TiersView,
  TurtleView,
  VersionsView,
} from "../components/system/ontology";
import "../components/system/system.css";
import { useOntology } from "../lib/categories";
import { formatDateTime } from "../lib/format";
import { useQueryState } from "../lib/hooks";
import { useAsync } from "../lib/useAsync";
import { Badge, ErrorView, HashText, PageHeader, Spinner, Tabs } from "../ui";

type TabId = "maddeler" | "kategoriler" | "haklar" | "gerekceler" | "katmanlar" | "parametreler" | "surumler" | "turtle";

export default function OntologyPage() {
  const ont = useOntology();
  const o = ont.ontology;
  const [tabRaw, setTab] = useQueryState("sekme", "maddeler");
  const [turtleVersion, setTurtleVersion] = useState<number | null>(null);
  const versions = useAsync(() => getOntologyVersions(), [], { enabled: tabRaw === "turtle" });

  const tabs: { id: TabId; label: string; count?: number }[] = [
    { id: "maddeler", label: "Maddeler", count: o?.articles.length },
    { id: "kategoriler", label: "Kategoriler", count: ont.flat.length || undefined },
    { id: "haklar", label: "Haklar", count: o?.rights.length },
    { id: "gerekceler", label: "Gerekçeler" },
    { id: "katmanlar", label: "Katmanlar" },
    { id: "parametreler", label: "Parametreler" },
    { id: "surumler", label: "Sürümler" },
    { id: "turtle", label: "Turtle" },
  ];
  const tab = (tabs.some((t) => t.id === tabRaw) ? tabRaw : "maddeler") as TabId;

  const body = () => {
    if (tab === "surumler")
      return (
        <VersionsView
          onShowTurtle={(v) => {
            setTurtleVersion(v);
            setTab("turtle");
          }}
        />
      );
    if (tab === "turtle") return <TurtleView versions={(versions.data ?? []).map((v) => v.version).sort((a, b) => b - a)} version={turtleVersion} onVersion={setTurtleVersion} />;
    if (ont.loading && !o) return <Spinner block label="Yönetmelik yükleniyor…" />;
    if (ont.error && !o) return <ErrorView error={ont.error} onRetry={ont.reload} />;
    if (!o) return null;
    switch (tab) {
      case "kategoriler":
        return <CategoriesView roots={ont.categories} />;
      case "haklar":
        return <RightsView o={o} articleLabel={ont.articleLabel} />;
      case "gerekceler":
        return <GroundsView o={o} />;
      case "katmanlar":
        return <TiersView o={o} />;
      case "parametreler":
        return <ParamsView o={o} />;
      default:
        return <ArticlesView articles={o.articles} />;
    }
  };

  return (
    <div className="page">
      <PageHeader
        title="Yönetmelik"
        subtitle="Forum Yönetmeliği makinece okunabilir bir ontoloji (RDF) olarak tutulur; her öneri oylamadan önce buna göre otomatik denetlenir."
        meta={
          o ? (
            <>
              <Badge tone="accent">Sürüm v{o.version.version}</Badge>
              <span className="small muted">{formatDateTime(o.version.createdAt, true)}</span>
              <HashText hash={o.version.hash} label="Sürüm özeti" />
            </>
          ) : null
        }
      />
      <Tabs tabs={tabs} value={tab} onChange={(v) => setTab(v)} label="Yönetmelik bölümleri">
        {body()}
      </Tabs>
      <ModelExplainer />
    </div>
  );
}
