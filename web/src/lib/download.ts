// Dosya indirme yardımcıları (KVKK dökümü, Turtle, makbuz yedeği).
// Android uygulamasında (Capacitor WebView) blob/`<a download>` indirmeleri sessizce yok sayılır: WebView'e indirme dinleyicisi
// bağlı değildir ve dosya sistemi eklentisi yoktur. Bu yüzden yerel platformda indirme DENENMEZ ve `false` döner; sayfalar
// `canDownloadFiles()` ile "İndir" düğmesini gizler ve kopyalama (`CopyButton`) seçeneğini öne çıkarır. Hiçbir zaman başarısız
// bir indirme için "indirildi" denmez.
import { isNativePlatform } from "./prefs";

/** Bu ortamda tarayıcı dosya indirmesi çalışır mı? (web: evet; Android uygulaması: hayır → kopyalama kullanın) */
export function canDownloadFiles(): boolean {
  return !isNativePlatform();
}

/** Dosyayı indirir; indirme bu ortamda desteklenmiyorsa ya da başarısızsa `false` döner (çağıran kopyalama seçeneğini göstermeli). */
export function downloadText(filename: string, content: string, mime = "text/plain;charset=utf-8"): boolean {
  if (!canDownloadFiles()) return false;
  try {
    const blob = new Blob([content], { type: mime });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.rel = "noopener";
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    window.setTimeout(() => URL.revokeObjectURL(url), 2000);
    return true;
  } catch {
    return false;
  }
}

export function downloadJson(filename: string, data: unknown): boolean {
  return downloadText(filename, JSON.stringify(data, null, 2), "application/json;charset=utf-8");
}
