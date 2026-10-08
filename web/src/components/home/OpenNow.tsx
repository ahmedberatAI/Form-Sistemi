// Ana sayfa › 'Şu an açık (n)': süren öneriler sunucunun bitiş sırasıyla (en yakın önce), ProposalRow satırlarıyla. İlk 5 görünür
// ('Tam' görünümde panonun gönderdiği hepsi); tamamı 'Tümü (süreye göre)' ile Öneriler › Açık sekmesinde aynı sırayla.
// Oturumdaki üyenin ilgi profili varsa (`openPersonalized`) sunucu açık önerileri KİŞİSEL sıraya dizer: her satırda kısa gerekçe
// çipi ('Listenizde', '… ile ilgilendiğiniz için', 'Süresi yaklaşıyor' …), başlığın altında tek satırlık not ve bağlantı 'Tümü (size göre)'.
// Kişisel sıra, bağlantının açtığı Öneriler › Açık › 'Size göre' sırasıyla birebir aynıdır (sunucu açık önerileri aynı girdi ve
// ağırlıklarla sıralar).
// Hiçbir öneri gizlenmez; 'Sizi bekleyenler' (oy/itiraz görevleri) ayrı ve en üstte kalır, kişiselleştirmeden etkilenmez.
// Bölge adı her iki kipte de 'Şu an açık (n)' (e2e). Boşsa tek satır (boş kart yok).
import { Link } from "react-router-dom";
import type { Dashboard, DashboardOpenProposal, ProposalStatus } from "@forum/shared";
import { useDetailLevel } from "../../lib/detailLevel";
import { formatNumber } from "../../lib/format";
import { routes } from "../../lib/routes";
import { Icon, Section } from "../../ui";
import { ProposalRowList } from "../proposals/ProposalCard";
import "./home.css";

/** Sade görünümde gösterilen satır sayısı. */
export const OPEN_ROWS = 5;

/** Süren evreler (taslak hariç): Öneriler › Açık sekmesiyle aynı küme. */
const OPEN_PHASES: ProposalStatus[] = ["sponsoring", "deliberation", "voting", "objection_window", "reconciliation", "revote"];

/** Panonun evre sayılarından açık öneri toplamı. */
export function openCount(counts: Dashboard["counts"]): number {
  return OPEN_PHASES.reduce((n, s) => n + (counts[s] ?? 0), 0);
}

/** 'Tümü (süreye göre)' hedefi: Açık sekmesi, bitişi en yakın önce (ProposalsPage ?sirala=sure). */
export const OPEN_ALL_HREF = `${routes.proposals()}?sekme=acik&sirala=sure`;
/** Kişisel kipte 'Tümü (size göre)' hedefi: Açık sekmesi, kişisel sırayla (ProposalsPage ?sirala=sana-gore). */
export const OPEN_ALL_PERSONAL_HREF = `${routes.proposals()}?sekme=acik&sirala=sana-gore`;

/** Kişisel kipteki tek satırlık not (bölge adının dışında; e2e 'Şu an açık (n)' adını arar). */
export const OPEN_PERSONAL_NOTE =
  "Size göre sıralandı: ilgi alanlarınıza uyanlar, listenizdekiler ve son açtıklarınız öne alınır, süresi yaklaşanlar ve yeniler de öne çıkar; oy bilgisi kullanılmaz, hiçbir öneri gizlenmez.";

export interface OpenNowProps {
  /** Pano: süren öneriler, bitiş sırasıyla ya da kişisel sırada (en çok 10) */
  open: readonly DashboardOpenProposal[];
  /** Açık öneri toplamı (başlıktaki sayı) */
  total: number;
  myId?: string | null;
  /** true: `open` kişisel sırada (Dashboard.openPersonalized); satırlar gerekçe çipi taşır */
  personalized?: boolean;
}

export function OpenNow({ open, total, myId, personalized = false }: OpenNowProps) {
  const { full } = useDetailLevel();
  if (!open.length) return <p className="home-empty-line">Şu an açık öneri yok.</p>;
  const rows = (full ? open : open.slice(0, OPEN_ROWS)).map((p) => (personalized ? p : { ...p, reason: null }));
  return (
    <Section
      title={`Şu an açık (${formatNumber(Math.max(total, open.length))})`}
      description={personalized ? OPEN_PERSONAL_NOTE : undefined}
      id="acik"
      className="home-section"
      actions={
        <Link to={personalized ? OPEN_ALL_PERSONAL_HREF : OPEN_ALL_HREF} className="home-inline-link small">
          {personalized ? "Tümü (size göre)" : "Tümü (süreye göre)"} <Icon name="chevronRight" size={14} />
        </Link>
      }
    >
      <ProposalRowList proposals={rows} myId={myId} label="Şu an açık öneriler" />
    </Section>
  );
}
