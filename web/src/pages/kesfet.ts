// 'Keşfet ve doğrula' sayfasının saf modeli (React/DOM yok, birim testli: kesfet.test.ts).
//   • Yedi bileşen: defter, oy doğrulama, bilirkişi, yapay zekâ, graf, yönetmelik (ontoloji), azınlık koruması; her biri canlı
//     durumuyla (auth.system + /api/dashboard) ve bir dokunuşla.
//   • Gösterim rehberi: 7 adım. Adımlar YALNIZ mevcut veriden türetilir, sabit öneri numarası yoktur: son kabul edilen karar
//     (Dashboard.recentEnacted[0]), listedeki ilk yönetmeliğe aykırı öneri (GET /api/proposals?status=inadmissible) ve sabit
//     rotalar. Veri yoksa adım genel sayfaya düşer ve bunu bir notla söyler.
//   • Öneri özetinde bilirkişi paneli ve YZ özeti alanı yoktur (shared/types.ts › ProposalSummary): 'bilirkişili öneri' ya da
//     'YZ özetli öneri' adımı kurulmaz. YZ özeti kartı her (taslak dışı) öneride çizildiği için YZ satırı son karara bağlanır.
//   • Derin bağlantılar gerçek çapa ve sekme kimlikleriyle yazılır: öneri sayfasında ?bolum=dogrula|sonuclar|ontoloji|yz,
//     /defter?sekme=dogrulama|demo (pages/LedgerPage.tsx; 'dogrula' DEĞİL), /graf?sekme=istatistik.
// Bağlantı ve bölge adları e2e'nin ayrılmış adlarını ('Destekle', 'Oyumu ver', 'Daha fazla', 'Sayımı kendim doğrulayayım',
// 'Kapat'; bölgede 'Oylama', 'Uzlaşma turu' …) içermez; testle kilitlidir.
import type { Dashboard, ProposalSummary, SystemInfo } from "@forum/shared";
import { minorityVerdict } from "../components/home/MinorityProtection";
import { formatNumber, normalizeSearch, proposalRef } from "../lib/format";
import { searchGlossary, termAnchor, type TermId } from "../lib/glossary";
import { routes } from "../lib/routes";
import type { IconName } from "../ui/Icon";

// ───────────── Bölümler ─────────────

/** Sayfanın bölüm çapaları ('Bu sayfada' gezinmesi ve ?bolum= derin bağlantısı; Ana sayfa vitrini 'rehber'e gelir). */
export const KESFET_SECTIONS = [
  { anchor: "bilesenler", label: "Bileşenler", title: "Yedi bileşen" },
  { anchor: "rehber", label: "Rehber", title: "Gösterim rehberi" },
  { anchor: "ilkeler", label: "İlkeler", title: "Temel ilkeler" },
  { anchor: "sozluk", label: "Sözlük", title: "Sözlük" },
] as const;

export type KesfetAnchor = (typeof KESFET_SECTIONS)[number]["anchor"];

/** Sözlük teriminin çapası: `terim-<kimlik>` (routes.kesfet({ bolum }) ile derin bağlantı); tanım lib/glossary.ts'tedir (Term penceresi de kullanır). */
export { termAnchor };

/**
 * ?bolum=terim-<kimlik> ile gelinince sözlük araması: hedef terim etkin süzgeçte görünmüyorsa arama temizlenir (yoksa terim
 * çizilmez, derin bağlantı hedefi bulamaz ve 'Sözlükte ›' sessizce boşa düşer); görünüyorsa ya da hedef terim değilse aynen kalır.
 */
export function glossaryQueryForTarget(target: string | null | undefined, q: string): string {
  if (!target || !target.startsWith(termAnchor("")) || !normalizeSearch(q.trim())) return q;
  return searchGlossary(q).some((e) => termAnchor(e.id) === target) ? q : "";
}

// ───────────── Yedi bileşen ─────────────

export type EvidenceKey = "defter" | "oy" | "bilirkisi" | "yz" | "graf" | "yonetmelik" | "azinlik";

export interface EvidenceRow {
  key: EvidenceKey;
  label: string;
  icon: IconName;
  /** Canlı durum, tek satır ("345. blok · 4/4 doğrulayıcı sağlıklı") */
  live: string;
  /** Hüküm tonu: warning → uyarı rengi + ⚠ + 'Uyarı:'; ok → ✔ yeşil (renk her zaman metinle). Verilmezse nötr. */
  tone?: "warning" | "ok";
  /** Bileşenin ne yaptığı, tek cümle */
  about: string;
  /** Bir dokunuşla gidilen yer; yoksa satır bağlantı değildir */
  to?: string;
  /** Yapay zekâ satırı (mor YALNIZ yapay zekâ içindir) */
  ai?: boolean;
}

export interface EvidenceInput {
  /** Sunucu sistem bilgisi (useAuth().system); henüz yoksa null */
  system: SystemInfo | null;
  /** Ana sayfa verisi (defter yedeği, kümeler, son karar); gelmeden null */
  dashboard?: Pick<Dashboard, "ledger" | "permanentLoser" | "recentEnacted"> | null;
  /** Bu cihazdaki makbuz sayısı (üye); bilinmiyorsa ya da ziyaretçiyse null */
  receipts?: number | null;
}

const LEADING_MARK = /^[✔⚠]\s*/u;

/** Yedi bileşen, canlı durumlarıyla. Veri yoksa satır yine çizilir; canlı değer yerine genel ifade gelir. */
export function evidenceRows({ system, dashboard, receipts }: EvidenceInput): EvidenceRow[] {
  const ledger = system?.ledger ?? dashboard?.ledger ?? null;
  const unhealthy = ledger ? Math.max(0, ledger.validators - ledger.healthy) : 0;
  const latest = dashboard?.recentEnacted?.[0] ?? null;
  const clusters = dashboard?.permanentLoser ?? null;
  const verdict = clusters ? minorityVerdict(clusters) : null;
  return [
    {
      key: "defter",
      label: "Defter",
      icon: "ledger",
      live: ledger ? `${formatNumber(ledger.height)}. blok · ${ledger.healthy}/${ledger.validators} doğrulayıcı sağlıklı` : "dağıtık defter",
      tone: unhealthy ? "warning" : undefined,
      about: "Her karar, oy taahhüdü ve evre geçişi imzalı bloklara yazılır; geçmiş sonradan değiştirilemez.",
      to: routes.ledger(),
    },
    {
      key: "oy",
      label: "Oy doğrulama",
      icon: "verify",
      live: receipts && receipts > 0 ? `bu cihazda ${formatNumber(receipts)} makbuz` : "makbuzla, cihazınızda",
      about: "Oyunuz gizli kalır; makbuzla deftere değiştirilmeden yazıldığını kendiniz denetlersiniz.",
      to: routes.verifyVote(),
    },
    {
      key: "bilirkisi",
      label: "Bilirkişiler",
      icon: "experts",
      live: "kurayla seçilir · danışman niteliğinde",
      about: "Alanına göre kurayla atanan uzmanlar rapor yazar; görüşleri danışmandır, oyları 1'dir.",
      to: routes.experts(),
    },
    {
      key: "yz",
      label: "Yapay zekâ",
      icon: "ai",
      live: `${!system ? "" : system.aiMode === "claude" ? `Claude (${system.aiModel}) · ` : "Çevrimdışı sezgisel mod · "}danışma niteliğinde`,
      about: "Özet, sınıflandırma ve köprü taslağı önerir; hiçbir durumu değiştirmez, her çıktısı etiketlidir.",
      // YZ özeti kartı her (taslak dışı) öneride vardır: son kararın kartına bir dokunuş. Karar yoksa satır bağlantı değildir.
      to: latest ? routes.proposal(latest.id, { bolum: "yz" }) : undefined,
      ai: true,
    },
    {
      key: "graf",
      label: "Graf",
      icon: "graph",
      live: clusters && clusters.length ? `${formatNumber(clusters.length)} görüş kümesi izleniyor` : "görüş kümeleri",
      about: "Görüş kümeleri üyelerin oy geçmişinden çıkarılır; köprü testi bu kümelere dayanır.",
      to: routes.graph(),
    },
    {
      key: "yonetmelik",
      label: "Yönetmelik",
      icon: "book",
      live: system ? `sürüm ${system.bylawVersion} · ontoloji ile denetlenir` : "ontoloji ile denetlenir",
      about: "Maddeler makinece okunur bir ontolojidir; her öneri oylanmadan önce bu kurallarla denetlenir.",
      to: routes.ontology(),
    },
    {
      key: "azinlik",
      label: "Azınlık koruması",
      icon: "users",
      // Ana sayfadaki hükümle aynı cümle; baştaki ✔/⚠ işaretini satır kendi tonuyla koyar (çift işaret olmasın).
      live: verdict ? verdict.text.replace(LEADING_MARK, "") : "kalıcı kaybeden küme göstergesi",
      tone: verdict?.tone === "warning" ? "warning" : verdict?.tone === "ok" ? "ok" : undefined,
      about: "Bir görüş kümesi kararların çoğunda kaybediyorsa erken uyarı verir; hiçbir kararı değiştirmez.",
      to: `${routes.graph()}?sekme=istatistik`,
    },
  ];
}

// ───────────── Gösterim rehberi ─────────────

export interface GuideLink {
  to: string;
  label: string;
}

export type GuideStepKey = "sayim" | "makbuz" | "zincir" | "kopru" | "kura" | "ontoloji" | "azinlik";

export interface GuideStep {
  key: GuideStepKey;
  title: string;
  /** Bu adımda ne görülür (gerçek öneri varsa numarası ve başlığıyla) */
  text: string;
  link: GuideLink;
  /** Ek bağlantı (yönetici: defterde kurcalama demosu) */
  extra?: GuideLink;
  /** Veri yoksa: adımın genel sayfaya düştüğünü söyleyen not */
  fallback?: string;
  /** Adımın altında 'Sözlükte:' ile açılan terim */
  term?: TermId;
}

type ProposalRef = Pick<ProposalSummary, "id" | "seq" | "title">;

export interface GuideInput {
  /** Son kabul edilen karar (Dashboard.recentEnacted[0]); yoksa null */
  latest: ProposalRef | null;
  /** Listedeki ilk yönetmeliğe aykırı öneri; yoksa null */
  inadmissible: ProposalRef | null;
  /** Yönetici: defterin 'Kurcalama demosu' sekmesi yalnız ona görünür */
  admin: boolean;
}

const named = (p: ProposalRef) => `${proposalRef(p.seq)} “${p.title}”`;

/** Yedi adım, gösterim sırasıyla. Her adımın tek birincil bağlantısı vardır (yöneticide defter adımına ek olarak demo). */
export function guideSteps({ latest, inadmissible, admin }: GuideInput): GuideStep[] {
  const noDecision = "Henüz kabul edilmiş karar yok; bağlantı sonuçlanan önerilere gider.";
  return [
    latest
      ? {
          key: "sayim",
          title: "Son kararın sayımını yeniden yapın",
          text: `${named(latest)}: oy taahhütleri ve sayım bülteni tarayıcınıza iner; sonuç yeniden hesaplanıp defterdeki sonuçla karşılaştırılır.`,
          link: { to: routes.proposal(latest.id, { bolum: "dogrula" }), label: "Sayımı doğrula" },
          term: "taahhut",
        }
      : {
          key: "sayim",
          title: "Son kararın sayımını yeniden yapın",
          text: "Sonuçlanmış bir önerinin 'Sonuçlar' bölümünde oy taahhütleri ve sayım bülteni tarayıcınıza iner; sonuç yeniden hesaplanır.",
          link: { to: `${routes.proposals()}?sekme=sonuc`, label: "Sonuçlanan öneriler" },
          fallback: noDecision,
          term: "taahhut",
        },
    {
      key: "makbuz",
      title: "Oyunuzu makbuzla doğrulayın",
      text: "Oy verince cihazınıza kaydedilen makbuz, oyunuzun deftere değiştirilmeden yazıldığını kanıtlar; kurcalanmış bir makbuzun nasıl yakalandığı da aynı sayfada denenir.",
      link: { to: routes.verifyVote(), label: "Oy doğrulamaya git" },
      term: "makbuz",
    },
    {
      key: "zincir",
      title: "Defter zincirini doğrulayın",
      text: "Blokların özetleri ve doğrulayıcı imzaları tarayıcınızda yeniden hesaplanır; tek bir kayıt değişse zincir kırılır.",
      link: { to: `${routes.ledger()}?sekme=dogrulama`, label: "Zincir doğrulamaya git" },
      extra: admin ? { to: `${routes.ledger()}?sekme=demo`, label: "Kurcalama demosu" } : undefined,
      term: "dagitik-defter",
    },
    latest
      ? {
          key: "kopru",
          title: "Köprü testine ve görüş gruplarına bakın",
          text: `${named(latest)}: sonuç kartı genel onayın yanında her görüş grubunun desteğini ve tabanı geçip geçmediğini gösterir.`,
          link: { to: routes.proposal(latest.id, { bolum: "sonuclar" }), label: "Sonuç kartına git" },
          term: "kopru-testi",
        }
      : {
          key: "kopru",
          title: "Köprü testine ve görüş gruplarına bakın",
          text: "Bir öneri genel onayın yanında her büyük görüş grubundan da asgari destek almalıdır; gruplar graf sayfasındadır.",
          link: { to: routes.graph(), label: "Görüş kümelerine git" },
          fallback: "Henüz kabul edilmiş karar yok; bağlantı görüş kümelerine gider.",
          term: "kopru-testi",
        },
    {
      key: "kura",
      title: "Bilirkişi kurasını inceleyin",
      text: "Bilirkişiler alanına göre, herkesin yeniden üretebildiği bir kurayla seçilir; bilirkişili bir önerinin 'Kura ve adillik kanıtı' bölümü tohumu ve aday havuzunu gösterir.",
      link: { to: routes.experts(), label: "Bilirkişilere git" },
      term: "kura",
    },
    inadmissible
      ? {
          key: "ontoloji",
          title: "Ontoloji denetimini görün",
          text: `${named(inadmissible)} yönetmeliğe aykırı bulundu; denetim kartı hangi kurala takıldığını gösterir.`,
          link: { to: routes.proposal(inadmissible.id, { bolum: "ontoloji" }), label: "Denetim kartına git" },
          term: "ontoloji-denetimi",
        }
      : {
          key: "ontoloji",
          title: "Ontoloji denetimini görün",
          text: "Yönetmelik maddeleri makinece okunur bir ontolojidir; her öneri oylanmadan önce bu kurallarla denetlenir.",
          link: { to: routes.ontology(), label: "Yönetmeliğe git" },
          fallback: "Yönetmeliğe aykırı öneri yok; bağlantı yönetmeliğin kendisine gider.",
          term: "ontoloji-denetimi",
        },
    {
      key: "azinlik",
      title: "Kalıcı kaybeden küme göstergesine bakın",
      text: "Her görüş kümesinin kararların ne kadarında kaybettiği görünür; bir küme sürekli kaybediyorsa erken uyarı çıkar.",
      link: { to: `${routes.graph()}?sekme=istatistik`, label: "İstatistiklere git" },
      term: "gorus-kumesi",
    },
  ];
}
