// `npm run ledger:node` — tek doğrulayıcıyı ayrı süreçte (HTTP taşıyıcıyla) çalıştırma girişi.
// Çok süreçli kip ŞU AN DESTEKLENMİYOR: dört doğrulayıcı aynı süreçte, bellek içi ağ üzerinden çalışır
// (LEDGER_MODE=in-process). Ayrı süreç için gereken parçalar hazırdır: `Transport` arayüzü (src/ledger/transport.ts)
// HTTP üzerinden uygulanıp `ValidatorNode` (src/ledger/node.ts) ayrı süreçte başlatılabilir; doğrulayıcı başına
// anahtar ve SQLite deposu zaten ayrıdır (${DATA_DIR}/keys/ledger/vN.key, ${DATA_DIR}/ledger/vN.db).
console.error(
  [
    "Çok süreçli defter kipi şu an desteklenmiyor.",
    "Doğrulayıcılar uygulama sunucusuyla aynı süreçte çalışır (LEDGER_MODE=in-process).",
    "Ayrıntı: server/src/ledger/standalone.ts",
  ].join("\n"),
);
process.exitCode = 1;
