// Android (Capacitor) yerel davranışları.
// Capacitor 3'ten beri donanım geri tuşu @capacitor/app eklentisi olmadan uygulamayı kapatır.
// Beklenen Android davranışı sırasıyla: (1) açık pencere/alt sayfa varsa onu kapat, (2) açık açılır menü
// varsa onu kapat, (3) uygulama içi geçmişte geri git, (4) geçmiş yoksa uygulamadan çık.
import { App } from "@capacitor/app";
import { isNativePlatform } from "./prefs";

/** En üstteki açık <dialog>'u (ui/Modal) kendi "cancel" yoluyla kapatır; kapattıysa true döner. */
function closeTopDialog(): boolean {
  const open = document.querySelectorAll<HTMLDialogElement>("dialog[open]");
  const top = open[open.length - 1];
  if (!top) return false;
  // Modal, onCancel içinde preventDefault + onClose çağırır (Esc ile aynı yol; kapatılamaz pencereler kapanmaz).
  top.dispatchEvent(new Event("cancel", { cancelable: true }));
  return true;
}

/** Açık açılır menü (ui/Menu) Esc ile kapanır; açıksa Esc gönderir. */
function closeOpenMenu(): boolean {
  if (!document.querySelector('[role="menu"]')) return false;
  document.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape", bubbles: true }));
  return true;
}

export function setupNativeBackButton(): void {
  if (!isNativePlatform()) return;
  void App.addListener("backButton", ({ canGoBack }) => {
    if (closeTopDialog() || closeOpenMenu()) return;
    if (canGoBack && window.history.length > 1) window.history.back();
    else void App.exitApp();
  });
}
