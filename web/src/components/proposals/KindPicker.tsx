// Öneri türü seçimi: beş tür, açıklamalı kartlar (erişilebilir radyo grubu).
import { PROPOSAL_KIND_LABELS, type ProposalKind, type Tier } from "@forum/shared";
import { Badge, Icon, RadioGroup, type IconName } from "../../ui";

export const KIND_ORDER: ProposalKind[] = ["topic", "subtopic", "amendment", "deletion", "regulation"];

export const KIND_INFO: Record<ProposalKind, { icon: IconName; text: string; tiers: Tier[]; tierText: string }> = {
  topic: {
    icon: "topics",
    text: "Forumda yeni bir tartışma başlığı açılmasını önerir. Kabul edilirse konu ağacına eklenir ve kendi tartışma alanı olur.",
    tiers: ["T0"],
    tierText: "Olağan karar; temel bir hakkı kısıtlıyorsa nitelikli (T1).",
  },
  subtopic: {
    icon: "chevronRight",
    text: "Yürürlükteki bir konunun altına daha özel bir başlık önerir. Üst konunun kategorilerini miras alır.",
    tiers: ["T0"],
    tierText: "Olağan karar; temel bir hakkı kısıtlıyorsa nitelikli (T1).",
  },
  amendment: {
    icon: "refresh",
    text: "Yürürlükteki bir konunun metnini değiştirmeyi önerir. Teklif konunun belirli bir sürümüne dayanır; kabul anında konu değişmişse sürüm çakışmasıyla reddedilir.",
    tiers: ["T1"],
    tierText: "Nitelikli karar.",
  },
  deletion: {
    icon: "warning",
    text: "Kurallara aykırı bir mesajın karartılmasını ister. Tartışma silinmez: kabul edilirse mesaj gizlenir, yerinde mezar taşı kalır. Görüş ayrılığı gerekçe olamaz.",
    tiers: ["DEL"],
    tierText: "Silme kararı: 2/3 onay + köprü testi + yazarın kümesinde %50.",
  },
  regulation: {
    icon: "book",
    text: "Forum yönetmeliğinin parametrelerini, maddelerini ya da kategorilerini değiştirir. Değiştirilemez maddeler hiç oylanamaz.",
    tiers: ["T2"],
    tierText: "Yönetmelik değişikliği; değiştirilemez hükme dokunursa geçersiz (T3).",
  },
};

export interface KindPickerProps {
  value: ProposalKind | null;
  onChange: (k: ProposalKind) => void;
  disabled?: boolean;
}

export function KindPicker({ value, onChange, disabled }: KindPickerProps) {
  return (
    <RadioGroup<ProposalKind>
      label="Öneri türü"
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
            {KIND_INFO[k].text} <span className="kind-tier">{KIND_INFO[k].tierText}</span>
          </>
        ),
      }))}
    />
  );
}

export default KindPicker;
