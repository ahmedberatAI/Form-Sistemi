// Ana sayfa › hızlı eylemler (üye): [+ Yeni öneri] (doğrulanmış üye), [Oylamadakiler (n)] (n = 0 ise [Tüm öneriler]),
// en çok 1 rol eylemi (kayıt memuru → 'Bekleyen üyeler', denetçi → 'Denetim günlüğü') ve 'Oyum kayıtlı mı? (n makbuz)'
// bağlantısı (makbuzlar cihazda sayılır: lib/receipts listReceipts). Telefonda görevlerin altında, masaüstünde selamın sağında.
import { Link } from "react-router-dom";
import { formatNumber } from "../../lib/format";
import { routes } from "../../lib/routes";
import { cx, Icon, LinkButton, type ButtonVariant, type IconName } from "../../ui";
import "./home.css";

export interface QuickActionsInput {
  /** auth.can("V"): öneri açabilir */
  canPropose: boolean;
  /** Oylamadaki (ve yeniden oylamadaki) öneri sayısı; pano gelmeden null */
  voting: number | null;
  /** Bu cihazdaki makbuz sayısı; okunmadan null */
  receipts: number | null;
  /** auth.can("R"): kayıt memuru ya da yönetici */
  registrar: boolean;
  /** auth.can("D"): denetçi ya da yönetici */
  auditor: boolean;
  /** Doğrulama bekleyen üye sayısı (biliniyorsa) */
  pendingMembers?: number | null;
}

export interface QuickActionSpec {
  key: string;
  label: string;
  to: string;
  icon: IconName;
  variant: ButtonVariant;
}

export interface QuickActionsSpec {
  buttons: QuickActionSpec[];
  receipts: { label: string; to: string };
}

/** Hızlı eylemlerin listesi (saf; birim testli). Rol eylemi en çok 1: önce kayıt memuru, sonra denetçi. */
export function quickActionSpecs(i: QuickActionsInput): QuickActionsSpec {
  const buttons: QuickActionSpec[] = [];
  if (i.canPropose) buttons.push({ key: "yeni", label: "Yeni öneri", to: routes.newProposal(), icon: "plus", variant: "primary" });
  if (i.voting === 0) buttons.push({ key: "tumu", label: "Tüm öneriler", to: routes.proposals(), icon: "proposals", variant: "secondary" });
  else {
    const label = i.voting == null ? "Oylamadakiler" : `Oylamadakiler (${formatNumber(i.voting)})`;
    buttons.push({ key: "oylama", label, to: `${routes.proposals()}?sekme=oylama`, icon: "vote", variant: "secondary" });
  }
  if (i.registrar) {
    const pending = i.pendingMembers ?? 0;
    const label = pending > 0 ? `Bekleyen üyeler (${formatNumber(pending)})` : "Bekleyen üyeler";
    buttons.push({ key: "uyeler", label, to: routes.registrar(), icon: "registrar", variant: "ghost" });
  } else if (i.auditor) {
    buttons.push({ key: "gunluk", label: "Denetim günlüğü", to: `${routes.admin()}?sekme=gunluk`, icon: "admin", variant: "ghost" });
  }
  const receipts = i.receipts ?? 0;
  return {
    buttons,
    receipts: { label: receipts > 0 ? `Oyum kayıtlı mı? (${formatNumber(receipts)} makbuz)` : "Oyum kayıtlı mı?", to: routes.verifyVote() },
  };
}

export function QuickActions({ placement = "flow", ...input }: QuickActionsInput & { placement?: "flow" | "head" }) {
  const spec = quickActionSpecs(input);
  return (
    <div className={cx("home-actions", placement === "head" && "home-actions-head")} role="group" aria-label="Hızlı eylemler">
      <div className="row home-actions-buttons">
        {spec.buttons.map((b) => (
          <LinkButton key={b.key} to={b.to} variant={b.variant} icon={b.icon}>
            {b.label}
          </LinkButton>
        ))}
      </div>
      <Link to={spec.receipts.to} className="home-inline-link home-receipts">
        <Icon name="verify" size={16} />
        {spec.receipts.label}
        <Icon name="chevronRight" size={14} />
      </Link>
    </div>
  );
}
