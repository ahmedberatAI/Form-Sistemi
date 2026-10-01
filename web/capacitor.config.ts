import type { CapacitorConfig } from "@capacitor/cli";

const config: CapacitorConfig = {
  appId: "tr.edu.forumsistemi",
  appName: "Forum Sistemi",
  webDir: "dist",
  server: {
    // Emülatörde bilgisayardaki sunucuya 10.0.2.2 üzerinden erişilir (http).
    androidScheme: "http",
    cleartext: true,
  },
  android: {
    allowMixedContent: true,
  },
};

export default config;
