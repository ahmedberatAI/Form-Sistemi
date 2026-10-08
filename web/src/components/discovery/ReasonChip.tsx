// Kişisel sıradaki öneri satırının/kartının kısa gerekçesi ('Listenizde', 'Farklı bir alandan', 'Enerji (Çevre) ile ilgilendiğiniz için',
// 'Süresi yaklaşıyor', 'Katıldığınız öneri', 'Yeni'). Metin sunucudandır (shared/src/recommend.ts). Gri çiptir (rozet değil; rozet bütçesi bozulmaz,
// renk taşımaz); 'Genel sıralama' gösterilmez (bilgi vermez). Ekran okuyucuya "Sıralama nedeni: …" diye okunur.
import type { RankReason } from "@forum/shared";
import { cx, Icon } from "../../ui";
import "./discovery.css";

/** Çip gösterilecek mi (saf): gerekçe yoksa ya da 'Genel sıralama' ise hayır. */
export const showsReason = (r: RankReason | null | undefined): r is RankReason => !!r && r.kind !== "general" && !!r.text;

export function ReasonChip({ reason, className }: { reason: RankReason | null | undefined; className?: string }) {
  if (!showsReason(reason)) return null;
  return (
    <span className={cx("reason-chip", `reason-chip-${reason.kind}`, className)}>
      {reason.kind === "saved" ? <Icon name="starFilled" size={12} /> : null}
      <span className="sr-only">Sıralama nedeni: </span>
      {reason.text}
    </span>
  );
}
