// Öneri türü seçimi: beş tür (erişilebilir radyo grubu).
// Tür seçilmeden önce açıklamalı büyük kartlar; seçildikten sonra tek satırlık küçük radyolara (ad + katman) daralır. Radyolar
// DOM'da ve işaretli kalır (tür değiştirmek 1 dokunuş); türlerin uzun açıklamaları 'Türler ne demek?' açılırında okunur.
// Görsel dil: katman rozetleri gridir (tierTone; bu türlerin hiçbiri T3 değildir); renk yalnız seçili radyonun mavi çerçevesindedir.
import { PROPOSAL_KIND_LABELS, type ProposalKind, type Tier } from "@forum/shared";
import { cx, Details, Icon, RadioGroup, TierBadge, type IconName } from "../../ui";
import "./new-proposal.css";

export const KIND_ORDER: ProposalKind[] = ["topic", "subtopic", "amendment", "deletion", "regulation"];

export const KIND_INFO: Record<ProposalKind, { icon: IconName; short: string; text: string; tiers: Tier[]; tierText: string }> = {
  topic: {
    icon: "topics",
    short: "Yeni bir tartışma başlığı açar.",
    text: "Forumda yeni bir tartışma başlığı açılmasını önerir. Kabul edilirse konu ağacına eklenir ve kendi tartışma alanı olur.",
    tiers: ["T0"],
    tierText: "Olağan; hak kısıtlıyorsa T1",
  },
  subtopic: {
    icon: "chevronRight",
    short: "Yürürlükteki bir konunun altına özel bir başlık açar.",
    text: "Yürürlükteki bir konunun altına daha özel bir başlık önerir. Üst konunun kategorilerini miras alır; yalnızca ekleme yapılabilir.",
    tiers: ["T0"],
    tierText: "Olağan; hak kısıtlıyorsa T1",
  },
  amendment: {
    icon: "refresh",
    short: "Yürürlükteki bir konunun metnini değiştirir.",
    text: "Yürürlükteki bir konunun metnini değiştirmeyi önerir. Teklif konunun belirli bir sürümüne dayanır; kabul anında konu başka bir kararla değişmişse “sürüm çakışması” ile reddedilir.",
    tiers: ["T1"],
    tierText: "Nitelikli karar",
  },
  deletion: {
    icon: "warning",
    short: "Kurala aykırı bir mesajın karartılmasını ister.",
    text: "Kurallara aykırı bir mesajın karartılmasını ister. Tartışma silinmez: kabul edilirse mesaj gizlenir, yerinde mezar taşı kalır. Görüş ayrılığı hiçbir zaman gerekçe olamaz.",
    tiers: ["DEL"],
    tierText: "2/3 onay + yazarın kümesinde %50",
  },
  regulation: {
    icon: "book",
    short: "Yönetmeliğin parametre, madde ya da kategorilerini değiştirir.",
    text: "Forum yönetmeliğinin parametrelerini, maddelerini ya da kategorilerini yapılandırılmış bir yamayla değiştirir. Değiştirilemez maddelere dokunan yamalar oylanamaz (T3, geçersiz).",
    tiers: ["T2"],
    tierText: "Değiştirilemez hükme dokunursa T3 (geçersiz)",
  },
};

/** Seçicinin görünümü (saf): tür seçilmeden önce açıklamalı kartlar, seçildikten sonra kompakt radyo şeridi. */
export function kindPickerLayout(value: ProposalKind | null): "cards" | "compact" {
  return value ? "compact" : "cards";
}

export interface KindPickerProps {
  value: ProposalKind | null;
  onChange: (k: ProposalKind) => void;
  disabled?: boolean;
  label?: string;
}

export function KindPicker({ value, onChange, disabled, label = "Öneri türü" }: KindPickerProps) {
  const compact = kindPickerLayout(value) === "compact";
  return (
    // Sarmalayıcı iki görünümde de aynı öğedir: radyolar yeniden bağlanmaz, ok tuşlarıyla tür değiştirirken odak radyoda kalır.
    <div className={cx("kind-picker", compact && "kind-picker-compact")}>
      <RadioGroup<ProposalKind>
        label={label}
        layout={compact ? "inline" : "cards"}
        value={value}
        onChange={onChange}
        disabled={disabled}
        required
        options={KIND_ORDER.map((k) => ({
          value: k,
          label: (
            <span className="kind-label">
              {compact ? null : <Icon name={KIND_INFO[k].icon} size={18} />}
              <span>{PROPOSAL_KIND_LABELS[k]}</span>
              {KIND_INFO[k].tiers.map((t) => (
                <TierBadge key={t} tier={t} short />
              ))}
            </span>
          ),
          hint: compact ? undefined : (
            <>
              {KIND_INFO[k].short} <span className="kind-tier">{KIND_INFO[k].tierText}</span>
            </>
          ),
        }))}
      />
      {compact ? (
        <Details summary="Türler ne demek?" className="kind-help">
          <dl className="kind-help-list">
            {KIND_ORDER.map((k) => (
              <div key={k} className={cx("kind-help-item", k === value && "is-selected")}>
                <dt>
                  {PROPOSAL_KIND_LABELS[k]}
                  {k === value ? <span className="kind-help-mark"> (seçili)</span> : null}
                </dt>
                <dd>
                  {KIND_INFO[k].text}
                  <span className="kind-help-tier">
                    {KIND_INFO[k].tiers.join(", ")} · {KIND_INFO[k].tierText}
                  </span>
                </dd>
              </div>
            ))}
          </dl>
        </Details>
      ) : null}
    </div>
  );
}

export default KindPicker;
