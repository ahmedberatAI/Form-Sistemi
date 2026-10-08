// 'Listeme ekle' (☆ / ★): öneri ve konu sayfasının başlığında aç/kapa düğmesi (aria-pressed). Adı sabittir ('Listeme ekle'),
// durum aria-pressed ve dolu yıldızla söylenir (WCAG 2.5.3: görünen etiket adın içinde). Kayıt yalnız sahibine görünür; KVKK
// dökümüne girer, hesap silmede silinir (sunucu). PUT/DELETE /api/me/saved/:type/:id idempotenttir: yanıt belirsiz kalıp yeniden
// gönderilen istek çift kayıt üretmez. İlk durum ProposalDetail.saved / TopicDetail.saved'den gelir (yalnız oturumlu istekte vardır);
// alan yoksa (oturum, sayfa verisinden sonra yüklendiyse) Listem bir kez okunur.
// Ad, e2e'nin aradığı 'Kaydet', 'Taslak kaydet', 'Destekle', 'Ekle' (tam ad) ile çakışmaz.
import { useEffect, useState } from "react";
import type { SavedTargetType } from "@forum/shared";
import { getSaved, saveItem, unsaveItem } from "../../api/endpoints";
import { useAuth } from "../../auth/AuthContext";
import { Button, cx, useToast } from "../../ui";
import "./discovery.css";

export const SAVE_LABEL = "Listeme ekle";

/** Düğmenin ipucu (title) ve bildirim metinleri (saf; birim testli). */
export function saveToggleText(saved: boolean, type: SavedTargetType): { title: string; done: string } {
  const noun = type === "proposal" ? "Öneri" : "Konu";
  return saved
    ? { title: `${noun} listenizde; çıkarmak için yeniden dokunun (Profil › Listem)`, done: `${noun} listenize eklendi.` }
    : { title: `${noun} listenizde değil; eklemek için dokunun. Liste yalnız size görünür.`, done: `${noun} listenizden çıkarıldı.` };
}

export interface SaveToggleProps {
  type: SavedTargetType;
  id: string;
  /** Sunucunun bildirdiği durum (ProposalDetail.saved / TopicDetail.saved); oturum yoksa ya da bilinmiyorsa undefined */
  saved: boolean | undefined;
  className?: string;
}

export function SaveToggle({ type, id, saved: initial, className }: SaveToggleProps) {
  const auth = useAuth();
  const toast = useToast();
  const userId = auth.user?.id ?? null;
  const [saved, setSaved] = useState<boolean | null>(initial ?? null);
  const [busy, setBusy] = useState(false);

  // Sayfa verisi yenilenince (yoklama, başka sekmede değişiklik) sunucunun durumu esas alınır.
  useEffect(() => {
    if (initial !== undefined) setSaved(initial);
  }, [initial, id]);

  // Durum bilinmiyorsa (oturum sayfa verisinden sonra geldi) Listem bir kez okunur.
  useEffect(() => {
    if (!userId || initial !== undefined) return;
    let live = true;
    getSaved().then(
      (list) => live && setSaved(list.items.some((x) => x.type === type && x.id === id)),
      () => live && setSaved(false),
    );
    return () => {
      live = false;
    };
  }, [userId, initial, type, id]);

  if (!userId) return null;
  const pressed = saved === true;
  const text = saveToggleText(pressed, type);

  const toggle = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const next = pressed ? await unsaveItem(type, id) : await saveItem(type, id);
      setSaved(next.saved);
      toast.success(saveToggleText(next.saved, type).done);
    } catch (e) {
      toast.error(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Button
      size="sm"
      variant="ghost"
      icon={pressed ? "starFilled" : "star"}
      className={cx("save-toggle", pressed && "is-saved", className)}
      aria-pressed={pressed}
      title={text.title}
      loading={busy || saved === null}
      onClick={() => void toggle()}
    >
      {SAVE_LABEL}
    </Button>
  );
}
