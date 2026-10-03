// Cihazda sabitlenmiş doğrulayıcı anahtarları (TOFU): tarayıcı içi doğrulamalar bunlarla yapılır. Sıfırlama Ayarlar › Gelişmiş altındaki
// 'Doğrulayıcı anahtarları' kartındadır; bildirimdeki bağlantı (?bolum=anahtarlar) o kartı açar.
import { Link } from "react-router-dom";
import { describeValidatorDiff, ensurePinnedValidators } from "../../lib/validators";
import { useAsync } from "../../lib/useAsync";
import { Alert, Term } from "../../ui";
import { settingsHref } from "./accountLogic";

export function usePinnedValidators() {
  return useAsync(() => ensurePinnedValidators(), []);
}

export function PinNotice({ pin }: { pin: Awaited<ReturnType<typeof ensurePinnedValidators>> | undefined }) {
  if (!pin) return null;
  if (pin.status === "changed") {
    return (
      <Alert tone="error" title="Doğrulayıcı anahtarları değişmiş">
        {describeValidatorDiff(pin.diff)} Sabitlemeyi <Link to={settingsHref("anahtarlar")}>Ayarlar › Gelişmiş</Link> bölümünden sıfırlayabilirsiniz.
      </Alert>
    );
  }
  if (pin.status === "pinned_now") {
    return (
      <Alert tone="info">
        Doğrulayıcı açık anahtarları bu cihaza ilk kez sabitlendi (<Term id="tofu">ilk kullanımda güven</Term>). Sonraki doğrulamalar bu anahtarlarla
        yapılır; sunucu anahtarları değiştirirse uyarılırsınız.
      </Alert>
    );
  }
  return null;
}
