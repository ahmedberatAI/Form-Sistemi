// Mesaj sürüm geçmişi panelinin yükleme kararı. Panel açıkken sürümler sıfırlanırsa (ör. düzenleme sonrası) yeniden
// istenmelidir; aksi halde "Sürümler yükleniyor…" göstergesi sonsuza dek döner. Bkz. bulgu #127.
import type { MessageVersionView } from "@forum/shared";

/** Panel açık, veri yok ve önceki istek hata vermemişse sürümler (yeniden) istenmelidir. */
export function shouldLoadVersions(open: boolean, versions: MessageVersionView[] | null, error: unknown): boolean {
  return open && versions === null && !error;
}
