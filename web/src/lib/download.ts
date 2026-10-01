// Dosya indirme yardımcıları (KVKK dökümü, Turtle, makbuz yedeği).
// Not: Android WebView'de indirme her zaman desteklenmeyebilir; sayfalar ayrıca "Kopyala" seçeneği sunmalıdır.

export function downloadText(filename: string, content: string, mime = "text/plain;charset=utf-8"): boolean {
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
