// Öneri sayfasının bölüm haritası ve 'Bu sayfada' gezinmesi. Sayfa sekmesiz tek akıştır; gezinme yalnız VAR OLAN bölümleri
// listeler (Metin · evreye göre eylem · Sonuç · Bilirkişi · Tartışma (n) · Kanıtlar) ve satıra sarar (360 px'de taşma yok).
// Bağlantılar `?bolum=<çapa>` ile çalışır (lib/sectionParam.ts: kartı açar, kaydırır, odağı taşır ve parametreyi replace ile
// siler); kendileri de `replace` ile gider, böylece sayfa içi atlamalar geçmişi kirletmez ve Android geri tuşu önceki sayfaya döner.
// Saf yardımcılar (bölüm listesi, eylem alanının varlığı, ?bolum=eylem odağı) burada durur ve birim testlidir.
import { Link } from "react-router-dom";
import type { ProposalDetail, ProposalStatus } from "@forum/shared";
import { routes } from "../../lib/routes";
import "./proposal-page.css";

/** Öneri sayfasındaki bölüm çapaları (kart/bölüm id'leri). lib/nextStep.ts'deki STEP_ANCHORS bunların alt kümesidir. */
export const PAGE_ANCHORS = {
  text: "metin",
  action: "eylem",
  results: "sonuclar",
  verify: "dogrula",
  expert: "bilirkisi",
  /** YZ özeti kartı (AiSummaryCard); 'Bu sayfada' listesinde yer almaz, derin bağlantıyla açılır. */
  ai: "yz",
  discussion: "tartisma",
  evidence: "kanitlar",
} as const;

const TERMINAL: ProposalStatus[] = ["enacted", "rejected", "withdrawn", "expired", "inadmissible"];

/** Evreye göre eylem alanının 'Bu sayfada' etiketi. Listede olmayan evrede (terminal) eylem alanı yoktur. */
const ACTION_LABELS: Partial<Record<ProposalStatus, string>> = {
  draft: "Taslak",
  sponsoring: "Destek",
  deliberation: "Metin önerileri",
  voting: "Oy ver",
  revote: "Oy ver",
  objection_window: "İtiraz",
  reconciliation: "Uzlaşma",
};

/** Bu evrede eylem alanı (id="eylem": oy, destek, itiraz, uzlaşma, tartışma evresi ya da taslak paneli) çizilir mi? */
export function hasActionArea(status: ProposalStatus): boolean {
  return !!ACTION_LABELS[status];
}

/** Bilirkişi kartı çizilir mi: taslak değil ve (panel var ya da açık, silme dışı bir öneri — panel talep edilebilir). */
export function showsExpertCard(p: Pick<ProposalDetail, "status" | "kind" | "expertPanel">): boolean {
  return p.status !== "draft" && (!!p.expertPanel || (!TERMINAL.includes(p.status) && p.kind !== "deletion"));
}

export interface PageSection {
  anchor: string;
  label: string;
}

/**
 * 'Bu sayfada' listesi: yalnız sayfada gerçekten bulunan bölümler, sayfadaki sırayla.
 * `messageCount`: tartışmadaki mesaj sayısı (tartışma yüklendiyse oradan, değilse öneri özetinden).
 */
export function proposalPageSections(p: Pick<ProposalDetail, "status" | "kind" | "expertPanel" | "results">, messageCount: number): PageSection[] {
  const out: PageSection[] = [{ anchor: PAGE_ANCHORS.text, label: "Metin" }];
  const action = ACTION_LABELS[p.status];
  if (action) out.push({ anchor: PAGE_ANCHORS.action, label: action });
  if (p.results.length) out.push({ anchor: PAGE_ANCHORS.results, label: "Sonuç" });
  if (showsExpertCard(p)) out.push({ anchor: PAGE_ANCHORS.expert, label: "Bilirkişi" });
  out.push({ anchor: PAGE_ANCHORS.discussion, label: `Tartışma (${messageCount})` });
  out.push({ anchor: PAGE_ANCHORS.evidence, label: "Kanıtlar" });
  return out;
}

/** Oy formunun ilk seçeneği (Kabul). */
const FIRST_RADIO = 'input[type="radio"]:not([disabled])';
/** İtiraz formunun 'Gerekçe' alanı (formun ilk alanı; itiraz hakkı yoksa form ve alan yoktur). */
const FIRST_SELECT = "select:not([disabled])";
/** Yazarın yanıt beklediği ilk metin önerisindeki 'Kabul et' düğmesi (DeliberationPanel bu sarmalayıcıyı verir). */
export const SUGGESTION_DECISION = ".deliberation-suggestions .list-item button.btn-primary:not([disabled])";

/**
 * `?bolum=eylem` ile gelindiğinde odağın gideceği denetim (useSectionParam `focus`). Verilmezse (undefined) varsayılan kural
 * işler: eylem alanındaki ilk görünür denetim. Seçici eşleşmezse (ör. oy hakkı yok, radyo yok) yine varsayılana düşülür.
 *  - Oylama / yeniden oylama → ilk radyo (Kabul)
 *  - İtiraz süresi → itiraz formunun 'Gerekçe' alanı
 *  - Tartışma evresi, yazar ve yanıt bekleyen metin önerisi varsa → ilk açık önerinin 'Kabul et' düğmesi (onay penceresi açar)
 */
export function actionFocusSelector(p: Pick<ProposalDetail, "status" | "authorId" | "suggestions">, viewerId: string | null): string | undefined {
  switch (p.status) {
    case "voting":
    case "revote":
      return FIRST_RADIO;
    case "objection_window":
      return FIRST_SELECT;
    case "deliberation":
      return viewerId && viewerId === p.authorId && p.suggestions.some((s) => s.status === "open") ? SUGGESTION_DECISION : undefined;
    default:
      return undefined;
  }
}

/** 'Bu sayfada' gezinmesi (Sıradaki adım kartının altında; masaüstünde de görünür). */
export function OnThisPage({ proposalId, sections }: { proposalId: string; sections: PageSection[] }) {
  if (!sections.length) return null;
  return (
    <nav className="on-this-page" aria-label="Bu sayfada">
      <span className="on-this-page-title" aria-hidden="true">
        Bu sayfada:
      </span>
      <ul className="on-this-page-list">
        {sections.map((s, i) => (
          <li key={s.anchor}>
            {i > 0 ? (
              <span className="on-this-page-sep" aria-hidden="true">
                ·
              </span>
            ) : null}
            <Link to={routes.proposal(proposalId, { bolum: s.anchor })} replace>
              {s.label}
            </Link>
          </li>
        ))}
      </ul>
    </nav>
  );
}
