// Ana sayfa › hesap durumu (yalnız doğrulanmamış hesaplar). '/' rotasında kabuk şeritleri gizlidir (layout/AppLayout); hesap
// mesajı burada BİR kez verilir. Bekleyen üye: kısaltılmış 3 adım, 2. adım "şimdi"; ikincil bağlantı 'Profil ve rızalar'.
// Askıdaki ve reddedilmiş üye: neyin yapılamadığını söyleyen uyarı (ret metni çıkmaz bir yol vaat etmez).
import { Link } from "react-router-dom";
import type { Me } from "@forum/shared";
import { routes } from "../../lib/routes";
import { Alert, Card, Icon } from "../../ui";
import "./home.css";

export function AccountStatus({ user }: { user: Pick<Me, "nickname" | "status"> | null }) {
  if (!user) return null;
  if (user.status === "pending") {
    return (
      <Card tone="warning" title="Hesabınız doğrulama bekliyor" className="home-account">
        <ol className="steps home-steps mt-0">
          <li className="home-step-done">
            <span className="sr-only">Tamamlandı: </span>
            <strong>Kayıt alındı.</strong> Takma adınız: @{user.nickname}
          </li>
          <li className="home-step-now" aria-current="step">
            <span className="home-step-tag">Şimdi</span> <strong>Kimlik doğrulama:</strong> kayıt memuru bilgilerinizi amaç belirterek (erişim kaydıyla)
            inceler ve onaylar.
          </li>
          <li>
            <strong>Sonra</strong> öneri açabilir, destekleyebilir ve tartışabilirsiniz. Oy için ayrıca 18 yaş ve siyasi görüş açık rızası gerekir.
          </li>
        </ol>
        <p className="small muted">Bu sırada tartışmaları okuyabilir, defteri ve sayımları doğrulayabilirsiniz.</p>
        <Link to={routes.profile()} className="home-inline-link small">
          Profil ve rızalar <Icon name="chevronRight" size={14} />
        </Link>
      </Card>
    );
  }
  if (user.status === "suspended") {
    return (
      <Alert tone="error" title="Hesabınız askıya alınmış">
        Askıdaki hesaplar öneri açamaz, destekleyemez ve oy veremez. Ayrıntılar için bildirimlerinizi kontrol edin.
      </Alert>
    );
  }
  if (user.status === "rejected") {
    // Reddedilen hesap kapalıdır: düzeltme talebi sunucuda reddedilir ve Profil'de form yoktur; çıkmaz bir yol vaat edilmez.
    return (
      <Alert tone="error" title="Kimlik doğrulamanız reddedildi">
        Bu hesapla öneri açılamaz, destek ve oy verilemez, düzeltme talebi yapılamaz. Ayrıntı için kayıt memuruyla iletişime geçin.
      </Alert>
    );
  }
  return null;
}
