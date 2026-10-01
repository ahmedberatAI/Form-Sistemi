// Senaryo 5 — Dağıtık defter: bir düğümde blok kurcala → zincir ✘ → düğümü onar → ✔;
// bir doğrulayıcıyı çökert → kalan 3 düğüm (2f+1) blok üretmeye devam eder → düğüm geri gelir ve yetişir.
import { expect, test } from "@playwright/test";
import type { LedgerStatus } from "@forum/shared";
import { useSeededServer } from "../support/fixtures";
import { expectToast, gotoApp, openSession, type Session } from "../support/ui";

const ctx = useSeededServer("defter");
let admin: Session | null = null;
test.afterEach(async () => {
  await admin?.close();
  admin = null;
});

test("kurcalama ✘ → onarım ✔, düğüm çökmesinde blok üretimi sürer ve düğüm yetişir", async ({ browser }) => {
  const { api } = ctx;
  admin = await openSession(browser, api, { as: "yonetici" });
  const { page, errors } = admin;

  await test.step("kurcalama demosu: bloğu kurcala → doğrulama ✘", async () => {
    await gotoApp(page, "/defter?sekme=demo");
    const demo = page.getByRole("region", { name: "Kurcalama demosu", exact: true });
    await expect(demo).toBeVisible();
    await demo.getByLabel("Düğüm").selectOption("v2");
    await demo.getByLabel("Blok yüksekliği").fill("120");
    await demo.getByRole("button", { name: "Bloğu kurcala" }).click();
    await expectToast(page, "v2 düğümünde #120 bloğu kurcalandı");
    const alert = demo.getByRole("alert").filter({ hasText: "v2 düğümünde #120 kurcalandı" });
    await expect(alert).toContainText("✘");
    await expect(alert).toContainText("bozuk");
    const results = demo.getByRole("list", { name: "Düğüm doğrulama sonuçları" });
    await expect(results.locator("li.list-item").filter({ hasText: "v2" })).toContainText("Zincir bozuk");
    await expect(results.locator("li.list-item").filter({ hasText: "v0" })).toContainText("Zincir geçerli");
  });

  await test.step("düğümü onar → doğrulama ✔", async () => {
    const demo = page.getByRole("region", { name: "Kurcalama demosu", exact: true });
    await demo.getByRole("button", { name: "Düğümü onar" }).click();
    await expectToast(page, "v2 onarıldı; zincir yeniden geçerli.");
    await expect(demo.getByRole("status").filter({ hasText: "v2 onarımı" })).toContainText(/✔\s*Zincir yeniden geçerli/);
  });

  await test.step("zincir doğrulama sekmesi: dört düğümün hepsi ✔", async () => {
    await page.getByRole("tab", { name: "Zincir doğrulama" }).click();
    await page.getByRole("button", { name: "Zinciri doğrula" }).click();
    await expectToast(page, "Tüm denetlenen düğümlerde zincir geçerli.");
    const results = page.getByRole("list", { name: "Düğüm doğrulama sonuçları" }).locator("li.list-item");
    await expect(results).toHaveCount(4);
    await expect(results.filter({ hasText: "Zincir geçerli" })).toHaveCount(4);
  });

  await test.step("v3'ü çökert → yeni işlemler 3 düğümle bloklara girer", async () => {
    await page.getByRole("tab", { name: "Kurcalama demosu" }).click();
    const faults = page.getByRole("region", { name: "Doğrulayıcı hata durumları" });
    const v3 = faults.locator("tr").filter({ hasText: "v3" });
    await v3.getByRole("button", { name: "Çökert" }).click();
    await expectToast(page, "v3: Çökmüş.");
    await expect(v3).toContainText("Çökmüş");
    const warning = page.getByRole("alert").filter({ hasText: "Hatalı düğüm var" });
    await expect(warning).toBeVisible();
    const before = await api.get<LedgerStatus>("/api/ledger/status");

    // Hata sürerken bir işlem üret: bir üye tartışmaya mesaj yazar (içerik özeti deftere girer).
    const topics = await api.get<{ id: string }[]>("/api/topics");
    await api.post(`/api/threads/topic/${topics[0].id}`, { body: "Düğüm çökmüşken de kararlarımız deftere yazılıyor mu, merak ettim.", stance: "question" }, "ayse");

    // Durum 5 sn'de bir yoklanır: arayüz yeni blokların üretildiğini gösterene kadar bekle.
    await expect(warning).toContainText(/hata sürerken \d+ yeni blok üretildi/, { timeout: 30_000 });
    const during = await api.get<LedgerStatus>("/api/ledger/status");
    expect(during.height).toBeGreaterThan(before.height);
    const crashed = during.validators.find((v) => v.id === "v3")!;
    expect(crashed.fault).toBe("crash");
    expect(crashed.height).toBeLessThan(during.height);
  });

  await test.step("v3'ü normale döndür → eksik blokları alıp yetişir", async () => {
    const faults = page.getByRole("region", { name: "Doğrulayıcı hata durumları" });
    const v3 = faults.locator("tr").filter({ hasText: "v3" });
    await v3.getByRole("button", { name: "Normale döndür" }).click();
    await expectToast(page, "v3: Normal.");
    await expect(page.getByRole("alert").filter({ hasText: "Hatalı düğüm var" })).toBeHidden();
    // Yetişme bir sonraki blokla olur: yeni bir işlem üret ve v3'ün diğerleriyle aynı yüksekliğe gelmesini bekle.
    const topics = await api.get<{ id: string }[]>("/api/topics");
    await api.post(`/api/threads/topic/${topics[0].id}`, { body: "Düğüm geri geldi; zincirin yetiştiğini doğrulamak için bir mesaj daha.", stance: "neutral" }, "ayse");
    await expect
      .poll(
        async () => {
          const s = await api.get<LedgerStatus>("/api/ledger/status");
          const v = s.validators.find((x) => x.id === "v3")!;
          return v.healthy && v.fault === "none" && v.height === s.height;
        },
        { timeout: 30_000, message: "v3 yetişmedi" },
      )
      .toBe(true);
    await page.getByRole("tab", { name: "Zincir doğrulama" }).click();
    await page.getByRole("button", { name: "Zinciri doğrula" }).click();
    await expect(page.getByRole("list", { name: "Düğüm doğrulama sonuçları" }).locator("li.list-item").filter({ hasText: "Zincir geçerli" })).toHaveCount(4);
  });

  expect(errors, "sayfa/konsol hatası olmamalı").toEqual([]);
});
