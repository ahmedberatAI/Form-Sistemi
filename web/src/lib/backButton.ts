// Android geri tuşunun sayfa içi adımları (Capacitor'dan bağımsız; birim testli: backButton.test.ts). ARAYUZ_PLANI ilkesi: geri tuşu
// önce açık pencereyi ya da menüyü kapatır, sonra geri gider. Sırasıyla:
//   1. en üstteki açık <dialog> (ui/Modal, 'Hızlı bul' paneli) kendi "cancel" yoluyla kapanır (Esc ile aynı yol),
//   2. açık açılır menü (ui/Menu) Esc ile kapanır,
//   3. üst çubuktaki 'Hızlı bul' kutusunun açık sonuç listesi (≥ 720 px: yatay telefon, tablet) kutuya gönderilen Esc ile kapanır
//      (lib/quickFind › comboKey: açık listede Esc yalnız listeyi kapatır, metin kalır).
// Hiçbiri yoksa null: çağıran (lib/native.ts) geçmişte geri gider ya da uygulamadan çıkar.

/** Gereken en küçük DOM yüzeyi (testte sahte belge verilir). */
export interface BackDom {
  querySelector(selector: string): Element | null;
  querySelectorAll(selector: string): ArrayLike<Element>;
  dispatchEvent(event: Event): boolean;
}

export type BackStep = "dialog" | "menu" | "quickfind";

/**
 * Açık açılır menünün DOM işareti: ui/Menu listeyi (<ul class="menu-list">) yalnız açıkken çizer. Menu bilinçli olarak disclosure
 * (düğme + liste) desenidir ve role="menu" taşımaz (e2e menü öğelerini düğme/bağlantı rolüyle arar). Sınıf adı ui/Menu.tsx ile değişir.
 */
export const OPEN_MENU_SELECTOR = ".menu-list";
/** Üst çubuktaki 'Hızlı bul' kutusunun açık sonuç listesi (components/discovery/QuickFind.tsx: kapalıyken `hidden`). */
export const OPEN_QUICK_FIND_SELECTOR = ".qf-inline .qf-popup:not([hidden])";

const escapeKey = (): Event => new KeyboardEvent("keydown", { key: "Escape", bubbles: true, cancelable: true });

/** Sayfa içinde kapatılacak en üstteki katmanı kapatır; kapattığı katmanı (yoksa null) döndürür. */
export function closeTopLayer(doc: BackDom = document): BackStep | null {
  const open = doc.querySelectorAll("dialog[open]");
  const top = open.length ? open[open.length - 1] : null;
  if (top) {
    // Modal, onCancel içinde preventDefault + onClose çağırır (Esc ile aynı yol; kapatılamaz pencereler kapanmaz).
    top.dispatchEvent(new Event("cancel", { cancelable: true }));
    return "dialog";
  }
  if (doc.querySelector(OPEN_MENU_SELECTOR)) {
    doc.dispatchEvent(escapeKey());
    return "menu";
  }
  const input = doc.querySelector(OPEN_QUICK_FIND_SELECTOR)?.closest(".qf")?.querySelector("input.qf-input");
  if (input) {
    input.dispatchEvent(escapeKey());
    return "quickfind";
  }
  return null;
}
