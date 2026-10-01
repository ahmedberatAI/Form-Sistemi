// Takma ad bağlantısı → /uyeler/:id. Silinmiş (verisi imha edilmiş) üye için düz metin.
// Hiçbir zaman gerçek ad / kişisel veri göstermez; yalnızca takma ad.
import type { PublicUser, UserStatus } from "@forum/shared";
import { Link } from "react-router-dom";
import { routes } from "../lib/routes";
import { cx } from "../ui";

export interface UserLinkProps {
  /** Kullanıcı kimliği (yoksa düz metin) */
  id?: string | null;
  nickname?: string | null;
  status?: UserStatus;
  isExpert?: boolean;
  /** Kolaylık: PublicUser verilirse id/nickname/status/isExpert oradan alınır */
  user?: Pick<PublicUser, "id" | "nickname" | "status" | "isExpert"> | null;
  /** Bilirkişi işaretini göster */
  showExpert?: boolean;
  className?: string;
}

export function UserLink({ id, nickname, status, isExpert, user, showExpert = true, className }: UserLinkProps) {
  const uid = user?.id ?? id ?? null;
  const name = user?.nickname ?? nickname ?? "";
  const st = user?.status ?? status;
  const expert = user?.isExpert ?? isExpert;
  if (st === "erased" || !uid || !name) {
    return (
      <span className={cx("user-link user-erased", className)} title={st === "erased" ? "Bu üyenin kişisel verisi imha edildi" : undefined}>
        {name || "Silinmiş üye"}
      </span>
    );
  }
  return (
    <Link className={cx("user-link", className)} to={routes.user(uid)}>
      <span className="user-nick">@{name}</span>
      {showExpert && expert ? (
        <span className="user-expert" title="Bilirkişi">
          {" "}
          · bilirkişi
        </span>
      ) : null}
    </Link>
  );
}

export default UserLink;
