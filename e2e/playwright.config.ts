// Tarayıcı uçtan uca testleri (Playwright, Chromium). Çalıştırma: kökte `npm run e2e`.
// Küresel kurulum web'i (gerekirse) derler ve geçici bir klasörde demo verisini tohumlar; her test dosyası bu şablonun
// kopyasıyla kendi sunucusunu 4100 portunda başlatır (kullanıcının 4000'deki sunucusuna dokunulmaz).
import { defineConfig, devices } from "@playwright/test";

export default defineConfig({
  testDir: "./tests",
  outputDir: "./test-results",
  globalSetup: "./global-setup.ts",
  // Sunucu ağır (4 doğrulayıcılı defter, ontoloji) ve senaryolar saati ileri alıyor: dosyalar sırayla, tek işçide.
  fullyParallel: false,
  workers: 1,
  retries: 0,
  forbidOnly: !!process.env.CI,
  timeout: 240_000,
  expect: { timeout: 20_000 },
  reporter: [["list"], ["html", { outputFolder: "playwright-report", open: "never" }]],
  use: {
    ...devices["Desktop Chrome"],
    locale: "tr-TR",
    timezoneId: "Europe/Istanbul",
    actionTimeout: 20_000,
    navigationTimeout: 30_000,
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
  },
});
