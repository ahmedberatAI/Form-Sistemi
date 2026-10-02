// Öneriler listesinin sekme modeli (saf: React/DOM yok, birim testli). 4 üst sekme (Açık · Sonuçlanan · Tümü · Benim) ve
// Açık/Sonuçlanan içinde 7 evre çipi; URL'de TEK parametre: ?sekme=<kimlik>. Kimlik ya bir üst sekmedir (acik, sonuc, tumu,
// benim) ya da bir evre çipidir (destek, tartisma, oylama, itiraz, kabul, red, kapanan). Eski 9 sekme kimliğinin hepsi geçerli
// kalır: ana sayfa, ilke metinleri ve dış bağlantılar değişmeden çalışır. Parametre yoksa ya da geçersizse liste ASLA boş
// açılmaz: Açık doluysa Açık, değilse Sonuçlanan (o da boşsa Tümü) seçilir; bu seçim URL'ye yazılmaz.
import type { ProposalStatus } from "@forum/shared";

export type TopTabId = "acik" | "sonuc" | "tumu" | "benim";
export type PhaseId = "destek" | "tartisma" | "oylama" | "itiraz" | "kabul" | "red" | "kapanan";

export interface TopTabDef {
  id: TopTabId;
  label: string;
  /** Çipi olmayan sekmelerin tek satırlık açıklaması (Açık/Sonuçlanan'da açıklama yalnız seçili çipte görünür) */
  info: string | null;
}

export interface PhaseDef {
  id: PhaseId;
  /** Çipin ait olduğu üst sekme */
  tab: "acik" | "sonuc";
  label: string;
  statuses: ProposalStatus[];
  /** Çip seçiliyken görünen tek paragraf */
  info: string;
}

export const TOP_TABS: TopTabDef[] = [
  { id: "acik", label: "Açık", info: null },
  { id: "sonuc", label: "Sonuçlanan", info: null },
  { id: "tumu", label: "Tümü", info: "Geri çekilen ve süresi dolan öneriler dahil tüm öneriler." },
  { id: "benim", label: "Benim", info: "Yazdığınız öneriler (yalnızca sizin görebildiğiniz taslaklar dahil)." },
];

/** Açık sekmesi: henüz sonuçlanmamış, herkese açık evreler (taslaklar hariç). */
export const OPEN_PHASE_STATUSES: ProposalStatus[] = ["sponsoring", "deliberation", "voting", "objection_window", "reconciliation", "revote"];
/** Sonuçlanan sekmesi: kapanmış her evre (kabul, ret, yönetmeliğe aykırı, geri çekilen, süresi dolan). */
export const CLOSED_PHASE_STATUSES: ProposalStatus[] = ["enacted", "rejected", "inadmissible", "withdrawn", "expired"];

export const PHASES: PhaseDef[] = [
  {
    id: "destek",
    tab: "acik",
    label: "Destek bekleyen",
    statuses: ["sponsoring"],
    info: "Yazar dışında yeterli sayıda doğrulanmış üyenin eş imzasını bekliyor; süre dolarsa öneri düşer. Destek, oy değildir: yalnızca tartışmaya değer olduğunu gösterir.",
  },
  {
    id: "tartisma",
    tab: "acik",
    label: "Tartışmada",
    statuses: ["deliberation"],
    info: "Ontoloji denetiminden geçti. Metin önerileri yapılabilir; bilirkişi görüşü ve YZ özeti (danışma) bu evrede gelir.",
  },
  {
    id: "oylama",
    tab: "acik",
    label: "Oylamada",
    statuses: ["voting", "revote"],
    info: "Gizli oylama sürüyor; ara sonuç gösterilmez, yalnızca katılım görünür. Oyunuzu süre bitene kadar değiştirebilirsiniz.",
  },
  {
    id: "itiraz",
    tab: "acik",
    label: "İtiraz ve uzlaşma",
    statuses: ["objection_window", "reconciliation"],
    info: "Kabul edilen kararlar itiraz süresindedir; köprü testini geçemeyen ya da geçerli itiraz alan öneriler uzlaşma turundadır. Azınlığın gücü erteleyicidir ve tek seferliktir.",
  },
  { id: "kabul", tab: "sonuc", label: "Kabul edilen", statuses: ["enacted"], info: "Yürürlüğe girmiş kararlar." },
  {
    id: "red",
    tab: "sonuc",
    label: "Reddedilen ve aykırı",
    statuses: ["rejected", "inadmissible"],
    info: "Oylamada reddedilen ya da yönetmeliğe aykırı bulunduğu için oylamaya giremeyen öneriler. Kayıtları herkese açık kalır.",
  },
  {
    id: "kapanan",
    tab: "sonuc",
    label: "Geri çekilen ve süresi dolan",
    statuses: ["withdrawn", "expired"],
    info: "Yazarının geri çektiği ya da destekçi toplama süresi dolan öneriler.",
  },
];

const TOP_TAB_BY_ID = new Map<string, TopTabDef>(TOP_TABS.map((t) => [t.id, t]));
const PHASE_BY_ID = new Map<string, PhaseDef>(PHASES.map((p) => [p.id, p]));

export const topTabDef = (id: TopTabId): TopTabDef => TOP_TAB_BY_ID.get(id)!;
export const phaseDef = (id: PhaseId): PhaseDef => PHASE_BY_ID.get(id)!;
/** Bir üst sekmenin evre çipleri (Tümü ve Benim'de çip yoktur). */
export const phasesOf = (tab: TopTabId): PhaseDef[] => PHASES.filter((p) => p.tab === tab);

/** Sekme ve çip sayıları için gereken en küçük öneri biçimi. */
export interface TabProposal {
  status: ProposalStatus;
  authorId: string;
}

/**
 * Önerinin üst sekmede yer alıp almadığı. Taslaklar yalnız yazarına görünür: Tümü ve Benim'de. "Benim" yazarın bütün
 * önerilerini (taslak dahil) toplar. `myId` yoksa (ziyaretçi) Benim sekmesi boştur.
 */
export function inTopTab(p: TabProposal, tab: TopTabId, myId: string | null): boolean {
  if (tab === "benim") return !!myId && p.authorId === myId;
  if (p.status === "draft") return tab === "tumu" && !!myId && p.authorId === myId;
  if (tab === "acik") return OPEN_PHASE_STATUSES.includes(p.status);
  if (tab === "sonuc") return CLOSED_PHASE_STATUSES.includes(p.status);
  return true;
}

export function inPhase(p: TabProposal, phase: PhaseId): boolean {
  return phaseDef(phase).statuses.includes(p.status);
}

/**
 * Üst sekme sayıları. `benim`, oturum yoksa null'dır: Benim sekmesi yalnız üyeye gösterilir (üyede 0 olsa da görünür).
 */
export interface ListCounts {
  acik: number;
  sonuc: number;
  tumu: number;
  benim: number | null;
}

export function countTabs(list: TabProposal[], myId: string | null): ListCounts {
  const n = (tab: TopTabId) => list.filter((p) => inTopTab(p, tab, myId)).length;
  return { acik: n("acik"), sonuc: n("sonuc"), tumu: n("tumu"), benim: myId ? n("benim") : null };
}

/** Evre çiplerinin sayıları. Evre durumları taslak içermediği için çip sayısı sekme üyeliğini de içerir. */
export function countPhases(list: TabProposal[]): Record<PhaseId, number> {
  const out = {} as Record<PhaseId, number>;
  for (const ph of PHASES) out[ph.id] = list.filter((p) => ph.statuses.includes(p.status)).length;
  return out;
}

/** Çözülmüş görünüm: üst sekme + (varsa) evre çipi; `auto` → URL'de geçerli parametre yoktu, akıllı varsayılan seçildi. */
export interface ListView {
  tab: TopTabId;
  phase: PhaseId | null;
  auto: boolean;
}

/**
 * ?sekme= değerini görünüme çevirir.
 * - Geçerli kimlik (eski 9 sekme dahil) olduğu gibi uygulanır; sayı 0 olsa da başka sekmeye atlanmaz (açıkça istenen görünüm).
 * - "benim" ziyaretçide geçersizdir (`counts.benim === null`).
 * - Parametre yok / bilinmeyen: Açık sayısı 0'dan büyükse Açık, değilse Sonuçlanan, o da boşsa Tümü; hiçbiri doluysa Açık.
 * Sayılar SÜZGEÇSİZ olmalıdır (arama ya da tür yazarken sekme kendiliğinden değişmesin). Bu seçim URL'ye yazılmaz.
 */
export function resolveListTab(param: string | null | undefined, counts: ListCounts): ListView {
  // Map araması: "constructor", "__proto__" gibi anahtarlar nesne prototipinden sızmaz.
  const top = param ? TOP_TAB_BY_ID.get(param) : undefined;
  const phase = param ? PHASE_BY_ID.get(param) : undefined;
  if (top && (top.id !== "benim" || counts.benim !== null)) return { tab: top.id, phase: null, auto: false };
  if (phase) return { tab: phase.tab, phase: phase.id, auto: false };
  if (counts.acik > 0) return { tab: "acik", phase: null, auto: true };
  if (counts.sonuc > 0) return { tab: "sonuc", phase: null, auto: true };
  if (counts.tumu > 0) return { tab: "tumu", phase: null, auto: true };
  return { tab: "acik", phase: null, auto: true };
}

/** Görünümü ?sekme= değerine çevirir (resolveListTab'ın tersi): çip seçiliyse çipin kimliği, değilse sekmenin kimliği. */
export const listTabParam = (view: Pick<ListView, "tab" | "phase">): string => view.phase ?? view.tab;

/** Akıllı varsayılan Açık'tan başka bir sekme seçtiğinde listenin üstündeki gri tek satır; aksi halde null. */
export function autoTabNote(view: ListView): string | null {
  if (!view.auto) return null;
  if (view.tab === "sonuc") return "Şu an açık öneri yok; sonuçlanan öneriler gösteriliyor.";
  if (view.tab === "tumu") return "Şu an açık ya da sonuçlanan öneri yok; tüm öneriler gösteriliyor.";
  return null;
}
