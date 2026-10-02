// Dağıtık defter: durum ve doğrulayıcılar, bloklar, zincir doğrulama, işlem arama, kurcalama / hata demosu (yönetici).
import { useState } from "react";
import type { ChainVerification } from "@forum/shared";
import { getLedgerStatus } from "../api/endpoints";
import { useAuth } from "../auth/AuthContext";
import { BlockList, ChainVerifyPanel, LedgerDemo, LedgerExplainer, LedgerStatusView, TxSearch } from "../components/system/ledger";
import "../components/system/system.css";
import { useQueryState } from "../lib/hooks";
import { useAsync } from "../lib/useAsync";
import { ErrorView, PageHeader, Spinner, Tabs } from "../ui";

type TabId = "durum" | "bloklar" | "dogrulama" | "islemler" | "demo";

export default function LedgerPage() {
  const auth = useAuth();
  const isAdmin = auth.can("A");
  const [tabRaw, setTab] = useQueryState("sekme", "durum");
  const status = useAsync(() => getLedgerStatus(), [], { pollMs: 5000 });
  const [results, setResults] = useState<ChainVerification[] | null>(null);

  const tabs: { id: TabId; label: string }[] = [
    { id: "durum", label: "Durum" },
    { id: "bloklar", label: "Bloklar" },
    { id: "dogrulama", label: "Zincir doğrulama" },
    { id: "islemler", label: "İşlem arama" },
    ...(isAdmin ? [{ id: "demo" as TabId, label: "Kurcalama demosu" }] : []),
  ];
  const tab = (tabs.some((t) => t.id === tabRaw) ? tabRaw : "durum") as TabId;
  const s = status.data;

  const body = () => {
    if (tab === "bloklar") return <BlockList />;
    if (tab === "islemler") return <TxSearch />;
    if (status.loading && !s) return <Spinner block label="Defter durumu yükleniyor…" />;
    if (status.error && !s) return <ErrorView error={status.error} onRetry={status.reload} />;
    if (!s) return null;
    if (tab === "dogrulama") return <ChainVerifyPanel validators={s.validators} results={results} onResults={setResults} />;
    if (tab === "demo") return <LedgerDemo status={s} onStatus={(x) => status.setData(x)} results={results} onResults={setResults} />;
    return <LedgerStatusView status={s} />;
  };

  return (
    <div className="page">
      <PageHeader
        title="Dağıtık defter"
        subtitle="Kararların, oy taahhütlerinin ve içerik özetlerinin değiştirilemez kaydı. Dört doğrulayıcı Tendermint benzeri uzlaşıyla blok üretir; herkes zinciri tarayıcısında doğrulayabilir."
      />
      <LedgerExplainer />
      <Tabs tabs={tabs} value={tab} onChange={(v) => setTab(v)} label="Defter bölümleri">
        {body()}
      </Tabs>
    </div>
  );
}
