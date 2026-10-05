// Öneriler: 4 üst sekme (Açık · Sonuçlanan · Tümü · Benim), Açık/Sonuçlanan içinde evre çipleri (URL'de TEK parametre:
// ?sekme=), tür süzgeci, arama ve sıralama. Sekme modeli pages/proposalsTabs.ts'tedir (saf, birim testli): parametre yoksa
// liste asla boş açılmaz. Liste bir kez çekilir, süzme istemcide yapılır (sekme ve çip sayıları anında görünür); 60 sn'de bir
// sessizce yenilenir.
import { useEffect, useMemo, useState } from "react";
import { PROPOSAL_KIND_LABELS, type ProposalKind, type ProposalSummary } from "@forum/shared";
import { listProposals } from "../api/endpoints";
import { useAuth } from "../auth/AuthContext";
import { KIND_ORDER } from "../components/proposals/KindPicker";
import { ProposalList } from "../components/proposals/ProposalCard";
import { normalizeSearch, proposalRef } from "../lib/format";
import { useDebounced, useQueryState } from "../lib/hooks";
import { routes } from "../lib/routes";
import { useAsync } from "../lib/useAsync";
import { Button, Details, EmptyState, ErrorView, Input, LinkButton, PageHeader, Select, Spinner, Tabs, type TabItem } from "../ui";
import {
  autoTabNote,
  countPhases,
  countTabs,
  inPhase,
  inTopTab,
  listTabParam,
  phaseDef,
  phasesOf,
  resolveListTab,
  topTabDef,
  TOP_TABS,
  type ListView,
  type PhaseDef,
  type PhaseId,
  type TopTabId,
} from "./proposalsTabs";

type SortId = "yeni" | "sure" | "mesaj" | "eski";
const SORTS: { value: SortId; label: string }[] = [
  { value: "yeni", label: "En yeni" },
  { value: "sure", label: "Süresi en yakın" },
  { value: "mesaj", label: "En çok mesaj" },
  { value: "eski", label: "En eski" },
];

// Tek istekte istenen öneri sayısı. Sunucu en çok 1000 kabul eder (http şeması); arayüz 500 ile yetinir. Liste dolarsa 'İlk 500 öneri gösteriliyor' uyarısı çıkar.
const LIMIT = 500;

/** Bu genişliğin altında (list-filters'ın üç sütuna geçtiği 640 px'in altı) Tür ve Sırala 'Süz ve sırala' açılırına girer. */
const NARROW_QUERY = "(max-width: 639px)";

function useNarrowScreen(): boolean {
  const [narrow, setNarrow] = useState(() => typeof window !== "undefined" && !!window.matchMedia?.(NARROW_QUERY).matches);
  useEffect(() => {
    const mq = window.matchMedia?.(NARROW_QUERY);
    if (!mq) return;
    const update = () => setNarrow(mq.matches);
    update();
    mq.addEventListener?.("change", update);
    return () => mq.removeEventListener?.("change", update);
  }, []);
  return narrow;
}

interface PhaseChipsProps {
  tab: "acik" | "sonuc";
  phase: PhaseId | null;
  counts: Record<PhaseId, number>;
  total: number;
  /** ?sekme= değerini yazar: çip kimliği ya da (Hepsi) sekme kimliği */
  onSelect: (param: string) => void;
}

/** Evre çipleri: aria-pressed düğmeler ve sayılar. Seçili çipe yeniden dokunmak 'Hepsi'ne döner; sayısı 0 olan çip soluk ama erişilebilir. */
function PhaseChips({ tab, phase, counts, total, onSelect }: PhaseChipsProps) {
  const chip = (key: string, label: string, count: number, pressed: boolean, onClick: () => void) => (
    <button key={key} type="button" className={`phase-chip${count === 0 ? " phase-chip-empty" : ""}`} aria-pressed={pressed} onClick={onClick}>
      {label}
      <span className="phase-chip-count">{count}</span>
    </button>
  );
  return (
    <div className="phase-chips" role="group" aria-label="Evre">
      {chip("hepsi", "Hepsi", total, phase === null, () => onSelect(tab))}
      {phasesOf(tab).map((ph: PhaseDef) => chip(ph.id, ph.label, counts[ph.id], phase === ph.id, () => onSelect(phase === ph.id ? tab : ph.id)))}
    </div>
  );
}

export default function ProposalsPage() {
  const auth = useAuth();
  const myId = auth.user?.id ?? null;
  // Varsayılan '' (Açık DEĞİL): 'Açık' sekmesine dokunmak ?sekme=acik yazar, akıllı varsayılan geri gelmez (hooks.ts varsayılanı URL'den siler).
  const [tabParam, setTab] = useQueryState("sekme", "");
  const [kindParam, setKind] = useQueryState("tur", "");
  const [qParam, setQParam] = useQueryState("ara", "");
  const [sortParam, setSort] = useQueryState("sirala", "yeni");
  const [q, setQ] = useState(qParam);
  const dq = useDebounced(q, 300);
  useEffect(() => {
    if (dq !== qParam) setQParam(dq);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dq]);
  const narrow = useNarrowScreen();

  const kind = (KIND_ORDER as string[]).includes(kindParam) ? (kindParam as ProposalKind) : null;
  const sort: SortId = SORTS.some((s) => s.value === sortParam) ? (sortParam as SortId) : "yeni";

  const { data, error, loading, reload } = useAsync(() => listProposals({ limit: LIMIT }), [myId], { pollMs: 60_000 });

  // Akıllı varsayılan SÜZGEÇSİZ sayılara bakar: arama ya da tür yazarken sekme kendiliğinden değişmez.
  const view: ListView = useMemo(() => resolveListTab(tabParam, countTabs(data ?? [], myId)), [tabParam, data, myId]);
  const note = autoTabNote(view);

  const base = useMemo(() => {
    const nq = normalizeSearch(q.trim());
    return (data ?? []).filter(
      (p) => (!kind || p.kind === kind) && (!nq || normalizeSearch(`${proposalRef(p.seq)} ${p.title} ${p.authorNickname}`).includes(nq)),
    );
  }, [data, kind, q]);

  // Görünen sayılar süzgeçlidir (arama/tür sonuçları sekmelerde anında görünür).
  const counts = useMemo(() => countTabs(base, myId), [base, myId]);
  const phaseCounts = useMemo(() => countPhases(base), [base]);

  const tabs: TabItem<TopTabId>[] = TOP_TABS.filter((t) => t.id !== "benim" || myId).map((t) => ({ id: t.id, label: t.label, count: counts[t.id] ?? 0 }));
  const currentTab = topTabDef(view.tab);
  const currentPhase = view.phase ? phaseDef(view.phase) : null;
  const chipTab = view.tab === "acik" || view.tab === "sonuc" ? view.tab : null; // evre çipleri yalnız bu iki sekmede
  const listName = (currentPhase ?? currentTab).label;

  const shown = useMemo(() => {
    const list = base.filter((p) => inTopTab(p, view.tab, myId) && (!view.phase || inPhase(p, view.phase)));
    const far = Number.MAX_SAFE_INTEGER;
    const cmp: Record<SortId, (a: ProposalSummary, b: ProposalSummary) => number> = {
      yeni: (a, b) => b.seq - a.seq,
      eski: (a, b) => a.seq - b.seq,
      mesaj: (a, b) => b.messageCount - a.messageCount || b.seq - a.seq,
      sure: (a, b) => (a.phaseEndsAt ?? far) - (b.phaseEndsAt ?? far) || b.seq - a.seq,
    };
    return list.sort(cmp[sort]);
  }, [base, view.tab, view.phase, sort, myId]);

  const filtered = !!kind || !!q.trim();
  // Çiplerin altındaki tek satır: seçili çipin açıklaması; çipsiz sekmede (Tümü, Benim) sekmenin açıklaması.
  const info = currentPhase?.info ?? (chipTab ? null : currentTab.info);

  // Telefonda Tür ve Sırala bir açılırda; etkin süzgeç varsa ilk çizimde açık gelir (gizli bir süzgeç listeyi sessizce daraltmasın).
  const activeFilters = (kind ? 1 : 0) + (sort !== "yeni" ? 1 : 0);
  const [openFiltersAtStart] = useState<boolean | undefined>(() => (activeFilters > 0 ? true : undefined));
  const kindSelect = (
    <Select
      label="Tür"
      value={kind ?? ""}
      onChange={(e) => setKind(e.target.value)}
      options={[{ value: "", label: "Tüm türler" }, ...KIND_ORDER.map((k) => ({ value: k, label: PROPOSAL_KIND_LABELS[k] }))]}
    />
  );
  const sortSelect = <Select label="Sırala" value={sort} onChange={(e) => setSort(e.target.value)} options={SORTS} />;

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
        {narrow ? (
          <div className="list-filter-wide">
            <Details summary={activeFilters ? `Süz ve sırala (${activeFilters} etkin)` : "Süz ve sırala"} open={openFiltersAtStart}>
              <div className="proposals-filter-fields">
                {kindSelect}
                {sortSelect}
              </div>
            </Details>
          </div>
        ) : (
          <>
            {kindSelect}
            {sortSelect}
          </>
        )}
      </div>

      <Tabs<TopTabId> label="Öneri durumu" tabs={tabs} value={view.tab} onChange={(t) => setTab(t)} className="proposals-tabs">
        <div className="proposals-panel">
          {note ? <p className="small muted proposals-note">{note}</p> : null}
          {chipTab && data ? <PhaseChips tab={chipTab} phase={view.phase} counts={phaseCounts} total={counts[chipTab]} onSelect={(param) => setTab(param)} /> : null}
          {info && !note ? <p className="small muted proposals-note">{info}</p> : null}
          {loading && !data ? <Spinner block label="Öneriler yükleniyor…" /> : null}
          {error ? <ErrorView error={error} onRetry={reload} /> : null}
          {data && !shown.length ? (
            <EmptyState
              title={filtered ? "Süzgece uyan öneri yok" : view.tab === "benim" ? "Henüz öneri yazmadınız" : currentPhase ? "Bu evrede öneri yok" : "Bu sekmede öneri yok"}
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
                ) : currentPhase ? (
                  <Button size="sm" onClick={() => setTab(listTabParam({ tab: view.tab, phase: null }))}>
                    Evre süzgecini kaldır
                  </Button>
                ) : view.tab === "acik" && counts.sonuc > 0 ? (
                  <Button size="sm" onClick={() => setTab("sonuc")}>
                    Sonuçlanan önerileri göster
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
          {shown.length ? <ProposalList proposals={shown} myId={myId} label={`${listName} öneriler`} /> : null}
          {data && data.length >= LIMIT ? <p className="small muted">İlk {LIMIT} öneri gösteriliyor; daha eskiler için aramayı daraltın.</p> : null}
        </div>
      </Tabs>
    </div>
  );
}
