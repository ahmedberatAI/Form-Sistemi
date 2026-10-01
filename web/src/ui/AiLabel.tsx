// Her yapay zekâ çıktısının üstünde zorunlu etiket: "Yapay zekâ ile üretildi · model · tarih".
// data-ai-generated="true" taşır; çevrimdışı sezgisel mod ayrıca vurgulanır. YZ yalnızca danışmandır.
import type { ReactNode } from "react";
import { aiLabel, OFFLINE_MODEL, type AiAnalysisInfo } from "@forum/shared";
import { cx } from "./basic";
import { Icon } from "./Icon";

export interface AiLabelProps {
  /** Sunucunun ürettiği etiket metni (varsa doğrudan kullanılır) */
  label?: string;
  model?: string;
  at?: number;
  offline?: boolean;
  /** Kolaylık: AiAnalysisInfo verilirse label/model/offline/at oradan alınır */
  info?: Pick<AiAnalysisInfo, "label" | "model" | "offline" | "createdAt" | "approvedBy">;
  /** YZ içeriği. Verilirse etiket + içerik + danışma notu bir çerçeve içinde gösterilir. */
  children?: ReactNode;
  /** Danışma notunu gizle (yalnızca etiket satırı) */
  hideNote?: boolean;
  className?: string;
}

export function AiLabel({ label, model, at, offline, info, children, hideNote, className }: AiLabelProps) {
  const m = info?.model ?? model ?? "";
  const isOffline = info?.offline ?? offline ?? m === OFFLINE_MODEL;
  const text = info?.label ?? label ?? (m && at ? aiLabel(m, at) : "Yapay zekâ ile üretildi");
  const approved = info?.approvedBy ? <span className="ai-approved">Yazar tarafından benimsendi</span> : null;

  const header = (
    <div className="ai-label">
      <Icon name="ai" size={14} />
      <span className="ai-label-text">{text}</span>
      {isOffline ? (
        <span className="ai-offline" title="Claude API anahtarı tanımlı değil ya da yanıt alınamadı; kural tabanlı sezgisel analiz kullanıldı.">
          çevrimdışı sezgisel mod
        </span>
      ) : null}
      {approved}
    </div>
  );

  if (!children)
    return (
      <div className={cx("ai-inline", className)} data-ai-generated="true">
        {header}
      </div>
    );
  return (
    <section className={cx("ai-block", isOffline && "ai-block-offline", className)} data-ai-generated="true" aria-label="Yapay zekâ çıktısı (danışma niteliğinde)">
      {header}
      <div className="ai-content">{children}</div>
      {hideNote ? null : <p className="ai-note">Bu içerik yalnızca danışma niteliğindedir; hiçbir durumu değiştirmez. Kararı üyeler verir.</p>}
    </section>
  );
}
