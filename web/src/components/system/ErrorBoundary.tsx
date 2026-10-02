// Hata sınırı: bir sayfanın çizim hatası ya da tembel yüklenen paket parçasının indirilememesi tüm uygulamayı
// beyaz ekrana çevirmesin. Bileşen bilerek yönlendirici/oturum/bildirim bağlamına BAĞIMLI DEĞİLDİR (kök düzeyde de
// çalışabilsin diye); "Ana sayfaya dön" düz bir HashRouter bağlantısıdır (#/).
import { Component, type ErrorInfo, type ReactNode } from "react";

/** Aynı sekmede art arda yeniden yükleme döngüsüne girmemek için iki otomatik yenileme arası asgari süre. */
const RELOAD_WINDOW_MS = 30_000;
const RELOAD_KEY = "forum.chunkReloadAt";

/** Dağıtımdan sonra açık kalan sekmede eski paket parçası indirilemediğinde tarayıcıların verdiği hata iletileri. */
const CHUNK_ERROR = /ChunkLoadError|Failed to fetch dynamically imported module|error loading dynamically imported module|Importing a module script failed|Loading (?:CSS )?chunk [\w-]+ failed|Unable to preload CSS/i;

export function isChunkLoadError(e: unknown): boolean {
  if (e instanceof Error) return CHUNK_ERROR.test(`${e.name} ${e.message}`);
  return typeof e === "string" && CHUNK_ERROR.test(e);
}

/**
 * Paket parçası hatasında TEK otomatik yeniden yükleme hakkını alır: son yenilemeden bu yana yeterli süre geçtiyse
 * zaman damgasını yazar ve true döner. Depo erişilemezse (özel pencere vb.) döngüyü önlemek için false döner.
 */
export function claimChunkReload(now: number, read: () => string | null, write: (value: string) => void): boolean {
  try {
    const last = Number(read());
    if (Number.isFinite(last) && last > 0 && now - last < RELOAD_WINDOW_MS) return false;
    write(String(now));
    return true;
  } catch {
    return false;
  }
}

function reloadPage(): void {
  window.location.reload();
}

interface Props {
  children: ReactNode;
  /** Değişince hata durumu sıfırlanır (ör. yönlendirmede konum yolu). */
  resetKey?: string;
}

interface State {
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: unknown): State {
    return { error: error instanceof Error ? error : new Error(String(error)) };
  }

  componentDidCatch(error: unknown, info: ErrorInfo): void {
    console.error("Arayüz hatası:", error, info.componentStack);
    if (isChunkLoadError(error)) {
      const ok = claimChunkReload(
        Date.now(),
        () => window.sessionStorage.getItem(RELOAD_KEY),
        (v) => window.sessionStorage.setItem(RELOAD_KEY, v),
      );
      if (ok) reloadPage();
    }
  }

  componentDidUpdate(prev: Props): void {
    if (this.state.error && prev.resetKey !== this.props.resetKey) this.setState({ error: null });
  }

  render(): ReactNode {
    const { error } = this.state;
    if (!error) return this.props.children;
    const chunk = isChunkLoadError(error);
    return (
      <div className="page" role="alert">
        <div className="empty">
          <p className="empty-title">{chunk ? "Uygulamanın yeni bir sürümü yayımlanmış olabilir" : "Bir şeyler ters gitti"}</p>
          <div className="empty-body">
            <p>
              {chunk
                ? "Sayfanın bir parçası yüklenemedi. Sayfayı yeniden yüklemek genellikle sorunu giderir."
                : "Sayfa görüntülenirken beklenmeyen bir hata oluştu. Sayfayı yeniden yükleyebilir ya da ana sayfaya dönebilirsiniz."}
            </p>
          </div>
          <div className="empty-action">
            <button type="button" className="btn btn-primary" onClick={reloadPage}>
              Sayfayı yeniden yükle
            </button>{" "}
            <a className="btn btn-secondary" href="#/" onClick={() => this.setState({ error: null })}>
              Ana sayfaya dön
            </a>
          </div>
        </div>
      </div>
    );
  }
}
