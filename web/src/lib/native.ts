// Android (Capacitor) yerel davranışları.
// Capacitor 3'ten beri donanım geri tuşu @capacitor/app eklentisi olmadan uygulamayı kapatır.
// Beklenen Android davranışı sırasıyla: (1) açık pencere/alt sayfa varsa onu kapat, (2) açık açılır menü ya da 'Hızlı bul' sonuç
// listesi varsa onu kapat (sayfa içi adımlar: lib/backButton.ts, birim testli), (3) uygulama içi geçmişte geri git, (4) geçmiş
// yoksa uygulamadan çık.
import { App } from "@capacitor/app";
import { closeTopLayer } from "./backButton";
import { isNativePlatform } from "./prefs";

export function setupNativeBackButton(): void {
  if (!isNativePlatform()) return;
  void App.addListener("backButton", ({ canGoBack }) => {
    if (closeTopLayer()) return;
    if (canGoBack && window.history.length > 1) window.history.back();
    else void App.exitApp();
  });
}
