// Giriş noktası: yapılandırmayı yükler, uygulamayı kurar ve dinlemeye başlar.
import { loadConfig } from "./core/config";
import { createApp } from "./app";

async function main(): Promise<void> {
  const cfg = loadConfig();
  const { app, services, close } = await createApp(cfg, { logger: true });

  let stopping = false;
  const shutdown = (signal: string) => {
    if (stopping) return;
    stopping = true;
    console.log(`\n${signal} alındı; sunucu kapatılıyor…`);
    close()
      .then(() => {
        console.log("Sunucu düzgünce kapatıldı.");
        process.exit(0);
      })
      .catch((err) => {
        console.error("Kapatma sırasında hata:", err);
        process.exit(1);
      });
  };
  process.once("SIGINT", () => shutdown("SIGINT"));
  process.once("SIGTERM", () => shutdown("SIGTERM"));

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
      `  Simüle saat    : ${new Date(services.clock.now()).toISOString()}`,
      `  Veri klasörü   : ${cfg.dataDir}`,
      "Durdurmak için Ctrl+C.",
      "",
    ].join("\n"),
  );
}

main().catch((err) => {
  console.error("Sunucu başlatılamadı:", err);
  process.exit(1);
});
