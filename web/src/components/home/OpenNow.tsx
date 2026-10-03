// Ana sayfa › 'Şu an açık (n)': süren öneriler sunucunun bitiş sırasıyla (en yakın önce), ProposalRow satırlarıyla. İlk 5 görünür
// ('Tam' görünümde panonun gönderdiği hepsi); tamamı 'Tümü (süreye göre)' ile Öneriler › Açık sekmesinde aynı sırayla.
// Boşsa tek satır (boş kart yok).
import { Link } from "react-router-dom";
import type { Dashboard, ProposalStatus, ProposalSummary } from "@forum/shared";
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

export interface OpenNowProps {
  /** Pano: süren öneriler, bitiş sırasıyla (en çok 10) */
  open: ProposalSummary[];
  /** Açık öneri toplamı (başlıktaki sayı) */
  total: number;
  myId?: string | null;
}

export function OpenNow({ open, total, myId }: OpenNowProps) {
  const { full } = useDetailLevel();
  if (!open.length) return <p className="home-empty-line">Şu an açık öneri yok.</p>;
  const rows = full ? open : open.slice(0, OPEN_ROWS);
  return (
    <Section
      title={`Şu an açık (${formatNumber(Math.max(total, open.length))})`}
      id="acik"
      className="home-section"
      actions={
        <Link to={OPEN_ALL_HREF} className="home-inline-link small">
          Tümü (süreye göre) <Icon name="chevronRight" size={14} />
        </Link>
      }
    >
      <ProposalRowList proposals={rows} myId={myId} label="Şu an açık öneriler" />
    </Section>
  );
}
