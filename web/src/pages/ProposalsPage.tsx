// Öneriler: 5 üst sekme (Açık · Sonuçlanan · Tümü · Benim · Listem), Açık/Sonuçlanan içinde evre çipleri (URL'de TEK parametre:
// ?sekme=), tür süzgeci, arama ve sıralama. Sekme modeli pages/proposalsTabs.ts'tedir (saf, birim testli): parametre yoksa
// liste asla boş açılmaz. Liste bir kez çekilir, süzme istemcide yapılır (sekme ve çip sayıları anında görünür); 60 sn'de bir
// sessizce yenilenir.
// Sırala › 'Size göre' (yalnız oturumdaki üyeye; lib/personalSort): liste sunucunun kişisel sırasıyla gelir (GET /api/proposals
// ?sort=sana-gore; küme varsayılanla AYNI, yalnız sıra değişir; açık öneriler önce, ana sayfa 'Şu an açık'la aynı sırada) ve istemcide
// yeniden SIRALANMAZ; kartlarda kısa gerekçe çipi. Seçim bu cihazda hatırlanır; varsayılan sıralama değişmez ("En yeni").
// 'Listem' sekmesi: 'Listeme ekle' ile kaydedilen öneriler (liste yüklenene dek boş durum gösterilmez).
// Arama kutusu 'Hızlı bul' › 'Tüm önerilerde ara (N öneri)' ile AYNI kuralı kullanır (shared proposalMatchesQuery: numara, başlıkta
// sırasız kelimeler, yazar): seçenekteki sayı ile açılan liste tutarlıdır.
import { useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { PROPOSAL_KIND_LABELS, proposalMatchesQuery, type Me, type ProposalKind } from "@forum/shared";
import { getSaved, listProposals, listProposalsForYou } from "../api/endpoints";
import { useAuth } from "../auth/AuthContext";
import "../components/discovery/discovery.css";
import { KIND_ORDER } from "../components/proposals/KindPicker";
import { PROFILE_ANCHORS } from "../components/system/accountLogic";
import { ProposalList, type ProposalWithReason } from "../components/proposals/ProposalCard";
import { useDebounced, useQueryState } from "../lib/hooks";
import { PERSONAL_SORT, rememberedPersonalSort, rememberPersonalSort, resolveListSort, sortOptions, type ListSortId } from "../lib/personalSort";
import { getRecentOpened } from "../lib/recentOpened";
import { routes } from "../lib/routes";
import { useAsync } from "../lib/useAsync";
import { Button, Details, EmptyState, ErrorView, Input, LinkButton, LiveStatus, PageHeader, Select, Spinner, Tabs, type TabItem } from "../ui";
import {
  autoTabNote,
  countPhases,
  countTabs,
  inPhase,
  inTopTab,
  listTabParam,
  MEMBER_TABS,
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

/** İstemcide yapılan sıralamalar ('Size göre' sunucudadır). */
type ClientSortId = Exclude<ListSortId, typeof PERSONAL_SORT>;

/** Liste verisi: öneriler ve (yalnız 'Size göre' isteğinde) sunucunun kişisel sıra yapıp yapmadığı; diğer isteklerde null. */
interface ListData {
  items: ProposalWithReason[];
  personalized: boolean | null;
}

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

/** Kişisel sıra neden yok (saf): siyasi görüş rızası yok · 'Kişisel sıralama' kapalı · (null) yalnız etkinlik henüz yetersiz. */
export function personalSortOff(me: Pick<Me, "politicalConsent" | "personalRanking"> | null | undefined): "consent" | "preference" | null {
  if (!me) return null;
  if (!me.politicalConsent) return "consent";
  if (me.personalRanking === false) return "preference";
  return null;
}

/** 'Size göre' notunun ilk satırı (saf). */
export function personalSortLine(personalized: boolean, off: "consent" | "preference" | null): string {
  if (personalized) return "Size göre sıralandı. Hiçbir öneri gizlenmez; yalnız sıra değişir.";
  if (off === "preference") return "Kişisel sıralama kapalı; en yeni öneriler önce gösteriliyor.";
  if (off === "consent") return "Kişisel sıralama siyasi görüş rızanıza dayanır; rıza olmadan en yeni öneriler önce gösteriliyor.";
  return "Henüz size göre sıralayacak kadar etkinlik yok; en yeni öneriler önce gösteriliyor.";
}

/**
 * 'Size göre' seçiliyken listenin üstündeki tek satır + nasıl çalıştığını anlatan açılır (eğitici metin Details içinde).
 * Kişisel sıra yoksa nedeni söylenir: henüz yeterli etkinlik yok, 'Kişisel sıralama' kapalı ya da siyasi görüş rızası yok.
 */
export function PersonalSortNote({ personalized, off = null }: { personalized: boolean; off?: "consent" | "preference" | null }) {
  return (
    <div className="personal-note">
      <p className="small muted">
        {personalSortLine(personalized, off)}
        {off ? (
          <>
            {" "}
            <Link to={`${routes.profile()}?bolum=${off === "consent" ? PROFILE_ANCHORS.rizalar : PROFILE_ANCHORS.listem}`}>{off === "consent" ? "Açık rızalar" : "Profil › Listem"}</Link>
          </>
        ) : null}
      </p>
      <Details summary="‘Size göre’ nasıl sıralar?">
        <ul className="small mt-0">
          <li>
            Son 180 günde yazdığınız, listenize eklediğiniz, desteklediğiniz ve mesaj yazdığınız öneri ve konuların kategorilerinden bir ilgi
            profili çıkarılır; yeni etkileşimler daha ağır basar.
          </li>
          <li>
            Açık öneriler önce gelir ve ana sayfadaki ‘Şu an açık’ ile aynı sıradadır; süresi yaklaşan ve yeni öneriler de öne çıkar. Zaten
            katıldığınız öneriler ilgi puanı almaz.
          </li>
          <li>Düzenli aralıklarla ilgi alanlarınızın dışından bir öneri yer alır.</li>
          <li>Son açtığınız öneriler yalnız bu cihazda tutulur, sıralama isteğiyle geçici olarak gönderilir ve sunucuda saklanmaz; çıkış yapınca silinir.</li>
          <li>Oylarınız, oy verip vermediğiniz bilgisi ve itiraz imzalarınız kullanılmaz.</li>
          <li>Siyasi görüş rızanıza dayanır; Profil › Listem'deki ‘Kişisel sıralama’ ile istediğiniz zaman kapatabilirsiniz.</li>
        </ul>
      </Details>
    </div>
  );
}

/**
 * Liste sayfalarının durum iletisi (saf işlev; birim testli): yüklenince "N öneri listeleniyor" / "N öneri süzgece uyuyor", boşsa
 * boş durumun başlığı ("Süzgece uyan öneri yok"). Yüklenmeden boş (ilk çizimde duyuru yok).
 */
export function listStatusMessage(o: { loaded: boolean; count: number; filtered: boolean; emptyTitle: string; noun: string }): string {
  if (!o.loaded) return "";
  if (o.count === 0) return o.emptyTitle;
  return o.filtered ? `${o.count} ${o.noun} süzgece uyuyor` : `${o.count} ${o.noun} listeleniyor`;
}

export default function ProposalsPage() {
  const auth = useAuth();
  const myId = auth.user?.id ?? null;
  // Varsayılan '' (Açık DEĞİL): 'Açık' sekmesine dokunmak ?sekme=acik yazar, akıllı varsayılan geri gelmez (hooks.ts varsayılanı URL'den siler).
  const [tabParam, setTab] = useQueryState("sekme", "");
  const [kindParam, setKind] = useQueryState("tur", "");
  const [qParam, setQParam] = useQueryState("ara", "");
  const [sortParam, setSort] = useQueryState("sirala", "yeni");
  const [searchParams] = useSearchParams();
  const [q, setQ] = useState(qParam);
  const dq = useDebounced(q, 300);
  useEffect(() => {
    if (dq !== qParam) setQParam(dq);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dq]);
  // Adresteki ?ara= dışarıdan değişirse (üst çubuktaki 'Hızlı bul' › 'Tüm önerilerde ara' bu sayfadayken) kutu onu izler.
  useEffect(() => {
    if (qParam !== dq) setQ(qParam);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qParam]);
  const narrow = useNarrowScreen();

  const kind = (KIND_ORDER as string[]).includes(kindParam) ? (kindParam as ProposalKind) : null;
  // 'Size göre' bu cihazda hatırlanır (üye başına); adresteki ?sirala= her zaman önce gelir. Varsayılan "En yeni" değişmez.
  const [remembered, setRemembered] = useState(() => rememberedPersonalSort(myId));
  useEffect(() => setRemembered(rememberedPersonalSort(myId)), [myId]);
  const sort = resolveListSort(searchParams.has("sirala") ? sortParam : null, { loggedIn: !!myId, remembered });
  const personal = sort === PERSONAL_SORT;
  const onSort = (value: string) => {
    const on = value === PERSONAL_SORT;
    rememberPersonalSort(myId, on);
    setRemembered(on);
    setSort(value);
  };

  // 'Size göre': aynı küme (aynı limit) kişisel sırayla; son açılanlar (yalnız bu cihazda tutulur) geçici girdi olarak gider.
  const { data, error, loading, reload } = useAsync<ListData>(
    () =>
      personal
        ? listProposalsForYou({ limit: LIMIT }, getRecentOpened()).then((r) => ({ items: r.items, personalized: r.personalized }))
        : listProposals({ limit: LIMIT }).then((items) => ({ items, personalized: null })),
    [myId, personal],
    { pollMs: 60_000 },
  );
  const list = data?.items;
  // Listem (yalnız oturumdaki üyeye): öneri kimlikleri 'Listem' sekmesinin üyeliği ve sayısı için. Liste gelmeden (ya da hata
  // verince) 'Listem' sekmesi boş durum ve 0 sayısı göstermez: üye listesinin silindiğini sanmasın.
  const saved = useAsync(() => getSaved(), [myId], { enabled: !!myId });
  const savedIds = useMemo(() => new Set((saved.data?.items ?? []).filter((x) => x.type === "proposal").map((x) => x.id)), [saved.data]);
  const savedReady = !!saved.data;

  // Akıllı varsayılan SÜZGEÇSİZ sayılara bakar: arama ya da tür yazarken sekme kendiliğinden değişmez.
  const view: ListView = useMemo(() => resolveListTab(tabParam, countTabs(list ?? [], myId)), [tabParam, list, myId]);
  const note = autoTabNote(view);

  const base = useMemo(() => (list ?? []).filter((p) => (!kind || p.kind === kind) && proposalMatchesQuery(p, q)), [list, kind, q]);

  // Görünen sayılar süzgeçlidir (arama/tür sonuçları sekmelerde anında görünür).
  const counts = useMemo(() => countTabs(base, myId), [base, myId]);
  const listemCount = useMemo(() => base.filter((p) => inTopTab(p, "listem", myId, savedIds)).length, [base, myId, savedIds]);
  const phaseCounts = useMemo(() => countPhases(base), [base]);

  const tabs: TabItem<TopTabId>[] = TOP_TABS.filter((t) => !MEMBER_TABS.includes(t.id) || myId).map((t) => ({
    id: t.id,
    label: t.label,
    count: t.id === "listem" ? (savedReady ? listemCount : undefined) : (counts[t.id] ?? 0),
  }));
  const currentTab = topTabDef(view.tab);
  const currentPhase = view.phase ? phaseDef(view.phase) : null;
  const chipTab = view.tab === "acik" || view.tab === "sonuc" ? view.tab : null; // evre çipleri yalnız bu iki sekmede
  const listName = (currentPhase ?? currentTab).label;

  const shown = useMemo(() => {
    const inView = base.filter((p) => inTopTab(p, view.tab, myId, savedIds) && (!view.phase || inPhase(p, view.phase)));
    // 'Size göre': sunucunun sırası korunur (süzme göreli sırayı değiştirmez); diğer sıralamalar istemcidedir.
    if (sort === PERSONAL_SORT) return inView;
    const far = Number.MAX_SAFE_INTEGER;
    const cmp: Record<ClientSortId, (a: ProposalWithReason, b: ProposalWithReason) => number> = {
      yeni: (a, b) => b.seq - a.seq,
      eski: (a, b) => a.seq - b.seq,
      mesaj: (a, b) => b.messageCount - a.messageCount || b.seq - a.seq,
      sure: (a, b) => (a.phaseEndsAt ?? far) - (b.phaseEndsAt ?? far) || b.seq - a.seq,
    };
    // Kişisel listeden dönülürken (yeni istek sürerken) gerekçe çipleri görünmesin.
    return inView.sort(cmp[sort]).map((p) => (p.reason ? { ...p, reason: null } : p));
  }, [base, view.tab, view.phase, sort, myId, savedIds]);

  const filtered = !!kind || !!q.trim();
  const listemWaiting = view.tab === "listem" && !savedReady;
  const emptyTitle = filtered
    ? "Süzgece uyan öneri yok"
    : view.tab === "benim"
      ? "Henüz öneri yazmadınız"
      : view.tab === "listem"
        ? "Listenizde öneri yok"
        : currentPhase
          ? "Bu evrede öneri yok"
          : "Bu sekmede öneri yok";
  // Çiplerin altındaki tek satır: seçili çipin açıklaması; çipsiz sekmede (Tümü, Benim) sekmenin açıklaması.
  const info = currentPhase?.info ?? (chipTab ? null : currentTab.info);

  // Telefonda Tür ve Sırala bir açılırda; etkin süzgeç varsa ilk çizimde açık gelir (gizli bir süzgeç listeyi sessizce daraltmasın).
  // Hatırlanan 'Size göre' listeyi daraltmaz ve notu zaten görünür: açılırı her ziyarette açık getirmez (özetteki sayıya girer).
  const activeFilters = (kind ? 1 : 0) + (sort !== "yeni" ? 1 : 0);
  // 'Size göre' isteği yanıtlandıysa: kişisel sıra mı (true) yoksa varsayılan sıra mı (false).
  const personalState = personal && data && data.personalized !== null ? data.personalized : null;
  const [openFiltersAtStart] = useState<boolean | undefined>(() => (kind || (sort !== "yeni" && sort !== PERSONAL_SORT) ? true : undefined));
  const kindSelect = (
    <Select
      label="Tür"
      value={kind ?? ""}
      onChange={(e) => setKind(e.target.value)}
      options={[{ value: "", label: "Tüm türler" }, ...KIND_ORDER.map((k) => ({ value: k, label: PROPOSAL_KIND_LABELS[k] }))]}
    />
  );
  const sortSelect = <Select label="Sırala" value={sort} onChange={(e) => onSort(e.target.value)} options={sortOptions(!!myId)} />;

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

      {/* Arama/süzgeç/sekme sonucu odak değişmeden değişir: sayısı ya da 'Süzgece uyan öneri yok' ekran okuyucuya duyurulur (WCAG 4.1.3). */}
      <LiveStatus message={listStatusMessage({ loaded: !!list && !listemWaiting, count: shown.length, filtered, emptyTitle, noun: "öneri" })} />

      <Tabs<TopTabId> label="Öneri durumu" tabs={tabs} value={view.tab} onChange={(t) => setTab(t)} className="proposals-tabs">
        <div className="proposals-panel">
          {note ? <p className="small muted proposals-note">{note}</p> : null}
          {chipTab && list ? <PhaseChips tab={chipTab} phase={view.phase} counts={phaseCounts} total={counts[chipTab]} onSelect={(param) => setTab(param)} /> : null}
          {info && !note ? <p className="small muted proposals-note">{info}</p> : null}
          {personalState !== null ? <PersonalSortNote personalized={personalState} off={personalSortOff(auth.user)} /> : null}
          {loading && !data ? <Spinner block label="Öneriler yükleniyor…" /> : null}
          {error ? <ErrorView error={error} onRetry={reload} /> : null}
          {listemWaiting && saved.loading && list ? <Spinner block label="Listeniz yükleniyor…" /> : null}
          {listemWaiting && saved.error && !saved.loading ? <ErrorView error={saved.error} onRetry={() => void saved.reload()} /> : null}
          {list && !shown.length && !listemWaiting ? (
            <EmptyState
              title={emptyTitle}
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
              {filtered ? (
                <p>Arama metnini ya da tür süzgecini değiştirmeyi deneyin.</p>
              ) : view.tab === "listem" ? (
                <p>Bir öneri sayfasındaki ‘☆ Listeme ekle’ düğmesiyle ekleyin. Liste yalnız size görünür.</p>
              ) : (
                <p>Öneriler evre değiştirdikçe sekmeler arasında yer değiştirir.</p>
              )}
            </EmptyState>
          ) : null}
          {shown.length ? <ProposalList proposals={shown} myId={myId} label={`${listName} öneriler`} /> : null}
          {list && list.length >= LIMIT ? <p className="small muted">İlk {LIMIT} öneri gösteriliyor; daha eskiler için aramayı daraltın.</p> : null}
        </div>
      </Tabs>
    </div>
  );
}
