// Öneri türü seçimi: beş tür, açıklamalı kartlar (erişilebilir radyo grubu).
import { PROPOSAL_KIND_LABELS, type ProposalKind, type Tier } from "@forum/shared";
import { Badge, Icon, RadioGroup, type IconName } from "../../ui";

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

export interface KindPickerProps {
  value: ProposalKind | null;
  onChange: (k: ProposalKind) => void;
  disabled?: boolean;
  label?: string;
}

export function KindPicker({ value, onChange, disabled, label = "Öneri türü" }: KindPickerProps) {
  return (
    <RadioGroup<ProposalKind>
      label={label}
      layout="cards"
      value={value}
      onChange={onChange}
      disabled={disabled}
      required
      options={KIND_ORDER.map((k) => ({
        value: k,
        label: (
          <span className="kind-label">
            <Icon name={KIND_INFO[k].icon} size={18} />
            <span>{PROPOSAL_KIND_LABELS[k]}</span>
            {KIND_INFO[k].tiers.map((t) => (
              <Badge key={t} tone={t === "DEL" ? "warning" : t === "T2" ? "accent" : t === "T1" ? "info" : "neutral"}>
                {t}
              </Badge>
            ))}
          </span>
        ),
        hint: (
          <>
            {KIND_INFO[k].short} <span className="kind-tier">{KIND_INFO[k].tierText}</span>
          </>
        ),
      }))}
    />
  );
}

export default KindPicker;
