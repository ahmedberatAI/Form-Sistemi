// Giriş noktası: yapılandırmayı yükler, uygulamayı kurar ve dinlemeye başlar.
import { loadConfig } from "./core/config";
import { createApp } from "./app";
import { DataDirLockedError } from "./core/lock";
import { createShutdown } from "./core/shutdown";
import { rateLimitFromEnv } from "./http";

async function main(): Promise<void> {
  const cfg = loadConfig();
  // RATE_LIMIT_GLOBAL / RATE_LIMIT_AUTH (istek/dk/IP; varsayılan 300 / 20; 0 = kapalı — yalnız uçtan uca testler için).
  const rateLimit = rateLimitFromEnv();
  const { app, services, close } = await createApp(cfg, { logger: true, rateLimit });

  // Kapanış: HTTP boşaltılır → yaşam döngüsü → defter → saat → veritabanı; toplam süre sınırlıdır (varsayılan 8 sn, Docker SIGKILL'inden önce).
  const shutdown = createShutdown({ close });
  process.once("SIGINT", () => shutdown("SIGINT"));
  process.once("SIGTERM", () => shutdown("SIGTERM"));
  // Beklenmeyen hata: kaydedip düzgünce kapatmayı dene (kapanış takılırsa zaman sınırı süreci sonlandırır); çıkış kodu 1.
  process.on("uncaughtException", (err) => {
    console.error("Yakalanmamış hata:", err);
    shutdown("uncaughtException", 1);
  });
  process.on("unhandledRejection", (reason) => {
    console.error("İşlenmemiş söz reddi:", reason);
    shutdown("unhandledRejection", 1);
  });

  try {
    await app.listen({ port: cfg.port, host: cfg.host });
  } catch (err) {
    await close().catch(() => undefined);
    throw err;
  }

  const shownHost = cfg.host === "0.0.0.0" || cfg.host === "::" ? "localhost" : cfg.host;
  const ledger = services.ledger.status();
  const aiMode = services.ai.mode() === "claude" ? `Claude (${services.ai.model()})` : "çevrimdışı sezgisel mod (ANTHROPIC_API_KEY yok)";
  const minutesPerSimHour = 60 / cfg.timeScale;
  console.log(
    [
      "",
      "Forum Sistemi sunucusu çalışıyor.",
      `  Adres          : http://${shownHost}:${cfg.port}  (dinlenen arayüz: ${cfg.host})`,
      `  API            : http://${shownHost}:${cfg.port}/api/health`,
      `  Yapay zekâ     : ${aiMode}`,
      `  Dağıtık defter : ${ledger.validators.length} doğrulayıcı (${ledger.mode}), yükseklik ${ledger.height}`,
      `  TIME_SCALE     : ${cfg.timeScale} (1 simüle saat ≈ ${Number(minutesPerSimHour.toFixed(2)).toLocaleString("tr-TR")} gerçek dakika)`,
      `  Hız sınırı     : ${
        rateLimit === false
          ? "KAPALI (RATE_LIMIT_GLOBAL=0, RATE_LIMIT_AUTH=0)"
          : `genel ${rateLimit.global ? `${rateLimit.global}/dk` : "kapalı"}, giriş ${rateLimit.auth ? `${rateLimit.auth}/dk` : "kapalı"}`
      }`,
      `  Simüle saat    : ${new Date(services.clock.now()).toISOString()}`,
      `  Veri klasörü   : ${cfg.dataDir}`,
      "Durdurmak için Ctrl+C.",
      "",
    ].join("\n"),
  );
}

main().catch((err) => {
  console.error("Sunucu başlatılamadı:", err instanceof DataDirLockedError ? err.message : err);
  process.exit(1);
});
