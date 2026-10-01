// Öneriler: durum sekmeleri (URL'de ?sekme=), tür süzgeci, arama ve sıralama. Liste bir kez çekilir,
// süzme istemcide yapılır (sekme sayıları anında görünür); 60 sn'de bir sessizce yenilenir.
import { useEffect, useMemo, useState } from "react";
import { PROPOSAL_KIND_LABELS, type ProposalKind, type ProposalStatus, type ProposalSummary } from "@forum/shared";
import { listProposals } from "../api/endpoints";
import { useAuth } from "../auth/AuthContext";
import { KIND_ORDER } from "../components/proposals/KindPicker";
import { ProposalList } from "../components/proposals/ProposalCard";
import { normalizeSearch, proposalRef } from "../lib/format";
import { useDebounced, useQueryState } from "../lib/hooks";
import { routes } from "../lib/routes";
import { useAsync } from "../lib/useAsync";
import { Button, EmptyState, ErrorView, Input, LinkButton, PageHeader, Select, Spinner, Tabs, type TabItem } from "../ui";

type TabId = "acik" | "destek" | "tartisma" | "oylama" | "itiraz" | "kabul" | "red" | "tumu" | "benim";

interface TabDef {
  id: TabId;
  label: string;
  statuses: ProposalStatus[] | null; // null → durum süzgeci yok
  info: string;
}

const TABS: TabDef[] = [
  {
    id: "acik",
    label: "Açık",
    statuses: ["sponsoring", "deliberation", "voting", "objection_window", "reconciliation", "revote"],
    info: "Henüz sonuçlanmamış, herkese açık öneriler (taslaklar hariç).",
  },
  {
    id: "destek",
    label: "Destek bekleyen",
    statuses: ["sponsoring"],
    info: "Yazar dışında yeterli sayıda doğrulanmış üyenin eş imzasını bekliyor; süre dolarsa öneri düşer. Destek, oy değildir: yalnızca tartışmaya değer olduğunu gösterir.",
  },
  {
    id: "tartisma",
    label: "Tartışmada",
    statuses: ["deliberation"],
    info: "Ontoloji denetiminden geçti. Metin önerileri yapılabilir, bilirkişi görüşü ve YZ özeti (danışma) bu evrede gelir.",
  },
  {
    id: "oylama",
    label: "Oylamada",
    statuses: ["voting", "revote"],
    info: "Gizli oylama sürüyor; ara sonuç gösterilmez, yalnızca katılım görünür. Oyunuzu süre bitene kadar değiştirebilirsiniz.",
  },
  {
    id: "itiraz",
    label: "İtiraz ve uzlaşma",
    statuses: ["objection_window", "reconciliation"],
    info: "Kabul edilen kararlar itiraz süresindedir; köprü testini geçemeyen ya da geçerli itiraz alan öneriler uzlaşma turundadır. Azınlığın gücü erteleyicidir ve tek seferliktir.",
  },
  { id: "kabul", label: "Kabul edilen", statuses: ["enacted"], info: "Yürürlüğe girmiş kararlar." },
  {
    id: "red",
    label: "Reddedilen",
    statuses: ["rejected", "inadmissible"],
    info: "Oylamada reddedilen ya da yönetmeliğe aykırı bulunduğu için oylamaya giremeyen öneriler. Kayıtları herkese açık kalır.",
  },
  { id: "tumu", label: "Tümü", statuses: null, info: "Geri çekilen ve süresi dolan öneriler dahil tüm öneriler." },
  { id: "benim", label: "Benim", statuses: null, info: "Yazdığınız öneriler (yalnızca sizin görebildiğiniz taslaklar dahil)." },
];

type SortId = "yeni" | "sure" | "mesaj" | "eski";
const SORTS: { value: SortId; label: string }[] = [
  { value: "yeni", label: "En yeni" },
  { value: "sure", label: "Süresi en yakın" },
  { value: "mesaj", label: "En çok mesaj" },
  { value: "eski", label: "En eski" },
];

const LIMIT = 500; // sunucunun izin verdiği en büyük sayfa (http şeması)

export default function ProposalsPage() {
  const auth = useAuth();
  const myId = auth.user?.id ?? null;
  const [tabParam, setTab] = useQueryState("sekme", "acik");
  const [kindParam, setKind] = useQueryState("tur", "");
  const [qParam, setQParam] = useQueryState("ara", "");
  const [sortParam, setSort] = useQueryState("sirala", "yeni");
  const [q, setQ] = useState(qParam);
  const dq = useDebounced(q, 300);
  useEffect(() => {
    if (dq !== qParam) setQParam(dq);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dq]);

  const tabId: TabId = TABS.some((t) => t.id === tabParam) && (tabParam !== "benim" || myId) ? (tabParam as TabId) : "acik";
  const kind = (KIND_ORDER as string[]).includes(kindParam) ? (kindParam as ProposalKind) : null;
  const sort: SortId = SORTS.some((s) => s.value === sortParam) ? (sortParam as SortId) : "yeni";

  const { data, error, loading, reload } = useAsync(() => listProposals({ limit: LIMIT }), [myId], { pollMs: 60_000 });

  const base = useMemo(() => {
    const nq = normalizeSearch(q.trim());
    return (data ?? []).filter(
      (p) => (!kind || p.kind === kind) && (!nq || normalizeSearch(`${proposalRef(p.seq)} ${p.title} ${p.authorNickname}`).includes(nq)),
    );
  }, [data, kind, q]);

  const inTab = (p: ProposalSummary, t: TabDef) => {
    if (t.id === "benim") return !!myId && p.authorId === myId;
    if (p.status === "draft") return t.id === "tumu" && p.authorId === myId;
    return !t.statuses || t.statuses.includes(p.status);
  };

  const tabs: TabItem<TabId>[] = TABS.filter((t) => t.id !== "benim" || myId).map((t) => ({ id: t.id, label: t.label, count: base.filter((p) => inTab(p, t)).length }));
  const current = TABS.find((t) => t.id === tabId)!;

  const shown = useMemo(() => {
    const list = base.filter((p) => inTab(p, current));
    const far = Number.MAX_SAFE_INTEGER;
    const cmp: Record<SortId, (a: ProposalSummary, b: ProposalSummary) => number> = {
      yeni: (a, b) => b.seq - a.seq,
      eski: (a, b) => a.seq - b.seq,
      mesaj: (a, b) => b.messageCount - a.messageCount || b.seq - a.seq,
      sure: (a, b) => (a.phaseEndsAt ?? far) - (b.phaseEndsAt ?? far) || b.seq - a.seq,
    };
    return list.sort(cmp[sort]);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [base, current, sort, myId]);

  const filtered = !!kind || !!q.trim();

  return (
    <div className="page">
      <PageHeader
        title="Öneriler"
        subtitle="Her karar bir öneriyle başlar: destekçi toplar, tartışılır, köprülü çoğunlukla oylanır."
        actions={
          auth.can("V") ? (
            <LinkButton to={routes.newProposal()} variant="primary" icon="plus">
              Yeni öneri
            </LinkButton>
          ) : !auth.user ? (
            <LinkButton to={routes.login()} icon="login" state={{ from: "/oneriler/yeni" }}>
              Öneri açmak için giriş yapın
            </LinkButton>
          ) : null
        }
      />

      <div className="list-filters" role="search">
        <Input
          label="Ara"
          type="search"
          placeholder="Başlık, #K-numara ya da yazar…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          fieldClassName="list-filter-q"
        />
        <Select
          label="Tür"
          value={kind ?? ""}
          onChange={(e) => setKind(e.target.value)}
          options={[{ value: "", label: "Tüm türler" }, ...KIND_ORDER.map((k) => ({ value: k, label: PROPOSAL_KIND_LABELS[k] }))]}
        />
        <Select label="Sırala" value={sort} onChange={(e) => setSort(e.target.value)} options={SORTS} />
      </div>

      <Tabs<TabId> label="Öneri durumu" tabs={tabs} value={tabId} onChange={(t) => setTab(t)}>
        <div className="stack">
          <p className="small muted mt-0">{current.info}</p>
          {loading && !data ? <Spinner block label="Öneriler yükleniyor…" /> : null}
          {error ? <ErrorView error={error} onRetry={reload} /> : null}
          {data && !shown.length ? (
            <EmptyState
              title={filtered ? "Süzgece uyan öneri yok" : tabId === "benim" ? "Henüz öneri yazmadınız" : "Bu sekmede öneri yok"}
              icon="proposals"
              action={
                filtered ? (
                  <Button
                    size="sm"
                    icon="close"
                    onClick={() => {
                      setQ("");
                      setKind("");
                    }}
                  >
                    Süzgeci temizle
                  </Button>
                ) : auth.can("V") ? (
                  <LinkButton to={routes.newProposal()} size="sm" icon="plus">
                    Yeni öneri
                  </LinkButton>
                ) : null
              }
            >
              {filtered ? <p>Arama metnini ya da tür süzgecini değiştirmeyi deneyin.</p> : <p>Öneriler evre değiştirdikçe sekmeler arasında yer değiştirir.</p>}
            </EmptyState>
          ) : null}
          {shown.length ? <ProposalList proposals={shown} myId={myId} label={`${current.label} öneriler`} /> : null}
          {data && data.length >= LIMIT ? <p className="small muted">İlk {LIMIT} öneri gösteriliyor; daha eskiler için aramayı daraltın.</p> : null}
        </div>
      </Tabs>
    </div>
  );
}
