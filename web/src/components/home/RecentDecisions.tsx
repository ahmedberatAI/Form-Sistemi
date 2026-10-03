// Ana sayfa › 'Son kararlar': panonun son yürürlüğe giren 5 önerisi, ✔/✘ işaretli tek satırlar (ProposalRow). İşaret ve durum
// metni öneri durumundan gelir; pano ileride ret kararlarını da gönderirse ✘ ile aynı listede görünür. 'Tüm kabul edilenler'
// Öneriler › Kabul edilen çipine gider (eski ?sekme=kabul bağlantısı).
import { Link } from "react-router-dom";
import type { ProposalSummary } from "@forum/shared";
import { routes } from "../../lib/routes";
import { Icon, Section } from "../../ui";
import { ProposalRowList } from "../proposals/ProposalCard";
import "./home.css";

/** Gösterilen karar sayısı (pano 5 gönderir: '5'in 5'i'). */
export const RECENT_ROWS = 5;

export function RecentDecisions({ items, myId }: { items: ProposalSummary[]; myId?: string | null }) {
  return (
    <Section
      title="Son kararlar"
      id="son-kararlar"
      className="home-section"
      actions={
        <Link to={`${routes.proposals()}?sekme=kabul`} className="home-inline-link small">
          Tüm kabul edilenler <Icon name="chevronRight" size={14} />
        </Link>
      }
    >
      {items.length ? (
        <ProposalRowList proposals={items.slice(0, RECENT_ROWS)} myId={myId} label="Son karara bağlanan öneriler" />
      ) : (
        <p className="muted mt-0">Henüz yürürlüğe giren karar yok.</p>
      )}
    </Section>
  );
}
