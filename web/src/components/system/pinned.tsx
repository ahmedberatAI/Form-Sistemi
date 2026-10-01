// Cihazda sabitlenmiş doğrulayıcı anahtarları (TOFU): tarayıcı içi doğrulamalar bunlarla yapılır.
import { Link } from "react-router-dom";
import { describeValidatorDiff, ensurePinnedValidators } from "../../lib/validators";
import { routes } from "../../lib/routes";
import { useAsync } from "../../lib/useAsync";
import { Alert } from "../../ui";

export function usePinnedValidators() {
  return useAsync(() => ensurePinnedValidators(), []);
}

export function PinNotice({ pin }: { pin: Awaited<ReturnType<typeof ensurePinnedValidators>> | undefined }) {
  if (!pin) return null;
  if (pin.status === "changed") {
    return (
      <Alert tone="error" title="Doğrulayıcı anahtarları değişmiş">
        {describeValidatorDiff(pin.diff)} Sabitlemeyi <Link to={routes.settings()}>Ayarlar</Link> sayfasından sıfırlayabilirsiniz.
      </Alert>
    );
  }
  if (pin.status === "pinned_now") {
    return (
      <Alert tone="info">
        Doğrulayıcı açık anahtarları bu cihaza ilk kez sabitlendi (ilk kullanımda güven). Sonraki doğrulamalar bu anahtarlarla yapılır; sunucu anahtarları
        değiştirirse uyarılırsınız.
      </Alert>
    );
  }
  return null;
}
