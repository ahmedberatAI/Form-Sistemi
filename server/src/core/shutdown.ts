// Sunucu kapanışı: bir kez çalışır, genel zaman sınırı vardır (Docker/systemd ~10 sn sonra SIGKILL gönderir).
export const SHUTDOWN_TIMEOUT_MS = 8_000;

export interface ShutdownOptions {
  close: () => Promise<void>;
  timeoutMs?: number;
  exit?: (code: number) => void;
  log?: (msg: string) => void;
  error?: (msg: string, err?: unknown) => void;
}

/**
 * Kapanış tetikleyicisi döndürür. İlk çağrı close()'u başlatır; sonrakiler yok sayılır.
 * close() zaman sınırı içinde bitmezse süreç kodu 1 ile zorla sonlanır (kapanış adımları yarım kalmış olabilir).
 */
export function createShutdown(opts: ShutdownOptions): (reason: string, exitCode?: number) => void {
  const timeoutMs = opts.timeoutMs ?? SHUTDOWN_TIMEOUT_MS;
  const exit = opts.exit ?? ((code: number) => process.exit(code));
  const log = opts.log ?? ((m: string) => console.log(m));
  const error = opts.error ?? ((m: string, e?: unknown) => (e === undefined ? console.error(m) : console.error(m, e)));
  let stopping = false;
  return (reason, exitCode = 0) => {
    if (stopping) return;
    stopping = true;
    log(`\n${reason} alındı; sunucu kapatılıyor…`);
    const killer = setTimeout(() => {
      error(`Kapanış ${timeoutMs} ms içinde tamamlanamadı; süreç zorla sonlandırılıyor.`);
      exit(1);
    }, timeoutMs);
    killer.unref();
    opts
      .close()
      .then(() => {
        clearTimeout(killer);
        log("Sunucu düzgünce kapatıldı.");
        exit(exitCode);
      })
      .catch((err) => {
        clearTimeout(killer);
        error("Kapatma sırasında hata:", err);
        exit(1);
      });
  };
}
