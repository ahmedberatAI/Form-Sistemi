// Senaryo 2 — Kayıttan kesin sayıma tam akış:
// kayıt → kayıt memuru amaç belirterek kişisel veriyi görür (erişim kaydı) ve onaylar → giriş → yeni öneri (canlı ön denetim T0)
// → destekçiler (K_s = 4) → yönetici saati +72/+24 sa ileri alır (oylama) → oy + makbuz cihazda → "Oyum kayıtlı mı?" (4 ✔ + 2 henüz)
// → +72 sa (kapanış, kabul) → "Sayımı kendim doğrulayayım" ✔ → "Oyum kayıtlı mı?" 6/6 ✔.
import { expect, test, type Page } from "@playwright/test";
import type { AuditLogEntry } from "@forum/shared";
import { newMember } from "../support/data";
import { useSeededServer } from "../support/fixtures";
import { expectToast, gotoApp, openSession, reloadApp, waitSettled, type Session } from "../support/ui";

const ctx = useSeededServer("oylama");

/** Testin açtığı tarayıcı bağlamları (başarısızlıkta da kapatılır). */
const sessions: Session[] = [];
test.afterEach(async () => {
  await Promise.all(sessions.splice(0).map((s) => s.close()));
});

const PROPOSAL = {
  title: "Mahalle Kütüphanesinde Haftalık Ücretsiz Satranç Atölyesi",
  body:
    "Mahalle kütüphanesinin çok amaçlı salonunda her cumartesi öğleden sonra iki saatlik ücretsiz satranç atölyesi düzenlenmesini öneriyorum. " +
    "Atölye her yaştan katılımcıya açık olur, gönüllü eğitmenlerle yürütülür ve kütüphanenin mevcut masaları kullanılır; ek bütçe gerekmez.",
  category: "Kütüphane ve yaşam boyu öğrenme",
};

/** Diğer üyelerin oyları (API ile): her görüş bloğundan en az μ_votes = 2 oy, toplam yeter sayının (⌈1,5·√|E|⌉ = 11) üstünde. */
const OTHER_VOTERS = ["ayse", "deniz_k", "elif_d", "burak_s", "selin_a", "emre_t", "mehmet", "serkan_u", "gokhan_r", "zeynep", "nur_a", "ismail_g"];
/** Yazarın dışındaki destekçiler: biri arayüzden (ayse), kalanlar API ile. */
const API_SPONSORS = ["deniz_k", "mehmet", "zeynep", "elif_d"];

async function verifySteps(page: Page) {
  const steps = page.locator("ol.vsteps > li.vstep");
  await expect(steps).toHaveCount(6);
  return steps;
}

/** Yönetim → Saat: hızlı ileri alma düğmesi; sonuç kartı ("Saat 3 gün ileri alındı") ve evre geçişleri listesi beklenir. */
async function adminAdvance(admin: Page, hours: 24 | 72) {
  const human = hours === 72 ? "3 gün" : "1 gün";
  await admin.getByRole("button", { name: `+${hours} saat` }).click();
  await expectToast(admin, `Simüle saat ${human} ileri alındı`);
  const card = admin.getByRole("region", { name: `Saat ${human} ileri alındı` });
  await expect(card).toBeVisible();
  await expect(admin.getByRole("button", { name: `+${hours} saat` })).toBeEnabled();
  return card;
}

test("kayıt → onay → öneri → destek → oylama → makbuz → kapanış → sayım ve makbuz doğrulaması", async ({ browser }) => {
  test.setTimeout(300_000);
  const { api } = ctx;
  const m = newMember();
  const open = async (as?: string) => {
    const s = await openSession(browser, api, { as });
    sessions.push(s);
    return s;
  };
  let proposalId = "";

  await test.step("1. ziyaretçi /kayit formuyla kaydolur (aydınlatma ≠ açık rıza; YZ rızası verilmez)", async () => {
    const { page } = await open();
    await gotoApp(page, "/kayit");
    const f = (suffix: string) => page.locator(`[id$="-${suffix}"]`).first();
    await f("nickname").fill(m.nickname);
    await f("password").fill(m.password);
    await f("password2").fill(m.password);
    await f("firstName").fill(m.firstName);
    await f("lastName").fill(m.lastName);
    await f("tckn").fill(m.tckn);
    await f("birthDate").fill(m.birthDate);
    await f("email").fill(m.email);
    await f("phone").fill(m.phone);
    await f("il").fill(m.il);
    await f("ilce").fill(m.ilce);
    await f("mahalle").fill(m.mahalle);
    await f("acikAdres").fill(m.acikAdres);
    await page.getByLabel("Aydınlatma metnini okudum ve anladım.").check();
    await page.getByLabel(/Oy ve görüş verilerimin .* açık rıza veriyorum/).check();
    await expect(page.getByLabel(/yapay zekâ ile analiz edilmesine açık rıza/)).not.toBeChecked();
    await page.getByRole("button", { name: "Kaydol" }).click();
    await expect(page.getByRole("heading", { name: "Kaydınız alındı" })).toBeVisible();
    await expect(page.getByText("Kayıt memuru onayı bekleniyor.")).toBeVisible();
    await expect(page.getByText(`Hoş geldiniz, @${m.nickname}!`)).toBeVisible();
  });

  await test.step("2. kayıt memuru amaç belirterek kişisel veriyi görür (maskeli TCKN) ve başvuruyu onaylar", async () => {
    const { page } = await open("kayitmemuru");
    await gotoApp(page, "/kayit-memuru");
    const item = page.getByRole("list", { name: "Doğrulama bekleyen üyeler" }).locator("li.list-item").filter({ hasText: `@${m.nickname}` });
    await expect(item).toBeVisible();
    await item.getByRole("button", { name: "Kişisel veriyi görüntüle…" }).click();
    const dialog = page.getByRole("dialog", { name: `Kişisel veri: @${m.nickname}` });
    await expect(dialog).toBeVisible();
    // Amaçsız erişim engellenir
    await dialog.getByRole("button", { name: "Amacı kaydet ve görüntüle" }).click();
    await expect(dialog.getByText("Erişim amacını yazın (en az 5 karakter).")).toBeVisible();
    await dialog.getByRole("button", { name: "Kimlik doğrulaması: yüz yüze belge kontrolü" }).click();
    await dialog.getByRole("button", { name: "Amacı kaydet ve görüntüle" }).click();
    await expect(dialog.getByText("Bu erişim amacıyla birlikte kayıt altına alındı.", { exact: false })).toBeVisible();
    await expect(dialog).toContainText(m.firstName);
    await expect(dialog).toContainText(m.lastName);
    await expect(dialog).toContainText(m.email);
    await expect(dialog).not.toContainText(m.tckn); // TCKN yalnızca maskeli
    await expect(dialog).toContainText(m.tckn.slice(-2));
    await dialog.getByRole("button", { name: "Kapat ve gizle" }).click();
    await expect(dialog).toBeHidden();
    await item.getByRole("button", { name: "Onayla" }).click();
    await expectToast(page, `@${m.nickname} doğrulandı.`);
    await expect(item).toBeHidden();

    // Erişim, amacıyla birlikte denetim günlüğünde (yönetici/denetçi görür)
    const log = await api.get<AuditLogEntry[]>("/api/admin/audit-log?action=identity.pii_access&limit=20", "denetci");
    const entry = log.find((e) => e.actorNickname === "kayitmemuru" && JSON.stringify(e.meta ?? {}).includes("Kimlik doğrulaması: yüz yüze belge kontrolü"));
    expect(entry, "identity.pii_access kaydı amaçla birlikte yazılmalı").toBeTruthy();
    expect(JSON.stringify(entry)).not.toContain(m.tckn);
  });

  const member = await open();
  const page = member.page;

  await test.step("3. yeni üye giriş yapar; hesap doğrulanmış", async () => {
    await gotoApp(page, "/giris");
    await page.getByLabel("Takma ad ya da e-posta").fill(m.nickname);
    await page.getByLabel("Şifre").fill(m.password);
    await page.getByRole("button", { name: "Giriş yap" }).click();
    await expect(page).toHaveURL(/#\/$/);
    await waitSettled(page);
    const token = await page.evaluate(() => localStorage.getItem("forum.token"));
    expect(token).toBeTruthy();
    api.setToken(m.nickname, token!);
    const me = await api.get<{ status: string; politicalConsent: boolean; aiConsent: boolean }>("/api/me", m.nickname);
    expect(me).toMatchObject({ status: "verified", politicalConsent: true, aiConsent: false });
  });

  await test.step("4. yeni öneri: tür, başlık, metin, kategori → canlı ön denetim T0 → destekçi toplamaya gönder", async () => {
    await gotoApp(page, "/oneriler/yeni");
    // Tür seçimi adres çubuğundaki ?tur= parametresine yazılır (durum yönlendirmeden sonra güncellenir): tıkla ve bekle.
    const kind = page.getByRole("radio", { name: /Yeni Konu/ });
    await kind.click();
    await expect(kind).toBeChecked();
    await expect(page).toHaveURL(/tur=topic/);
    await page.getByLabel("Başlık").fill(PROPOSAL.title);
    await page.getByLabel("Öneri metni").fill(PROPOSAL.body);
    await page.getByLabel(PROPOSAL.category, { exact: true }).check();
    const summary = page.locator(".pre-summary");
    await expect(summary).toContainText("T0", { timeout: 30_000 });
    await expect(summary).toContainText("Yönetmeliğe uygun");
    const aside = page.getByRole("complementary", { name: "Ön denetim" });
    await expect(aside).toContainText("Gerekli destekçi");
    await page.getByRole("button", { name: "Kaydet ve destekçi toplamaya gönder" }).click();
    await expectToast(page, "Öneri kaydedildi ve destekçi toplamaya gönderildi.");
    await expect(page).toHaveURL(/#\/oneriler\/[0-9a-f-]{36}$/);
    proposalId = page.url().split("/").pop()!;
    await waitSettled(page);
    await expect(page.getByRole("heading", { level: 1, name: PROPOSAL.title })).toBeVisible();
    await expect(page.locator(".page-meta")).toContainText("Destekçi toplanıyor");
    const p = await api.proposal(proposalId);
    expect(p).toMatchObject({ status: "sponsoring", tier: "T0", sponsorsRequired: 4, kind: "topic" });
  });

  await test.step("5. destek: bir üye arayüzden, diğerleri API ile → ontoloji denetimi → tartışma", async () => {
    const { page: ayse } = await open("ayse");
    await gotoApp(ayse, `/oneriler/${proposalId}`);
    await ayse.getByRole("button", { name: "Destekle" }).click();
    await expectToast(ayse, "Desteğiniz kaydedildi ve deftere imza olarak yazıldı.");
    await expect(ayse.getByText("✔ Bu öneriyi desteklediniz.")).toBeVisible();
    const required = (await api.proposal(proposalId)).sponsorsRequired;
    for (const n of API_SPONSORS.slice(0, required - 1)) await api.sponsor(proposalId, n);
    await expect.poll(async () => (await api.proposal(proposalId)).status).toBe("deliberation");
    await reloadApp(page);
    await expect(page.locator(".page-meta")).toContainText("Tartışmada");
    await expect(page.getByRole("region", { name: /Destekçiler \(4\/4\)/ })).toBeVisible();
  });

  let admin: Page;
  await test.step("6. yönetici saati +72 sa ve +24 sa ileri alır → oylama açılır", async () => {
    admin = (await open("yonetici")).page;
    await gotoApp(admin, "/yonetim");
    await adminAdvance(admin, 72);
    expect((await api.proposal(proposalId)).status).toBe("deliberation");
    const card = await adminAdvance(admin, 24);
    const p = await api.proposal(proposalId);
    await expect(card.locator("li.list-item").filter({ hasText: `#K-${p.seq}` })).toContainText("Tartışmada → Oylamada");
    expect(p.status).toBe("voting");
    expect(p.participation?.eligible ?? 0).toBeGreaterThan(40);
  });

  await test.step("7. yeni üye arayüzden oy verir; makbuz cihaza kaydedilir", async () => {
    await reloadApp(page);
    const panel = page.getByRole("region", { name: "Oylama" });
    await expect(panel).toBeVisible();
    await panel.getByRole("radio", { name: "Kabul" }).check();
    await panel.getByRole("button", { name: "Oyumu ver" }).click();
    await expectToast(page, "Oyunuz (Kabul) kaydedildi; makbuz bu cihaza kaydedildi.");
    await expect(panel.getByText("✔ Makbuz bu cihazda kayıtlı")).toBeVisible();
    const stored = await page.evaluate(() => JSON.parse(localStorage.getItem("forum.receipts") ?? "[]") as { proposalId: string; choice: string; salt: string }[]);
    const mine = stored.filter((r) => r.proposalId === proposalId);
    expect(mine).toHaveLength(1);
    expect(mine[0]).toMatchObject({ choice: "yes" });
    expect(mine[0].salt).toBeTruthy();
    // Oylama sürerken sonuç gösterilmez, yalnızca katılım
    await expect(page.getByRole("heading", { name: "1. tur sonucu" })).toHaveCount(0);
  });

  await test.step("8. diğer üyeler oy verir (API)", async () => {
    for (const n of OTHER_VOTERS) await api.vote(proposalId, n, "yes");
    const p = await api.proposal(proposalId);
    expect(p.participation?.voted).toBe(OTHER_VOTERS.length + 1);
    expect(p.results).toHaveLength(0);
  });

  await test.step("9. 'Oyum kayıtlı mı?' oylama sürerken: 4 adım ✔, açıklama ve sayım henüz yapılamaz", async () => {
    await reloadApp(page);
    await page.getByRole("region", { name: "Oylama" }).getByRole("link", { name: "Oyum kayıtlı mı?" }).click();
    await expect(page).toHaveURL(new RegExp(`#/oy-dogrula\\?oneri=${proposalId}$`));
    await waitSettled(page);
    await verifySteps(page);
    // Oy işlemi henüz bir bloğa girmediyse kanıt adımı "henüz" kalabilir: doğrulama bitince gerekirse yeniden doğrula.
    await expect(async () => {
      await expect(page.locator("li.vstep-running")).toHaveCount(0, { timeout: 10_000 });
      if ((await page.locator("li.vstep-ok").count()) < 4) await page.getByRole("button", { name: "Yeniden doğrula" }).click();
      await expect(page.locator("li.vstep-ok")).toHaveCount(4, { timeout: 5_000 });
    }).toPass({ timeout: 40_000 });
    await expect(page.locator("li.vstep-pending")).toHaveCount(2);
    await expect(page.locator("li.vstep-fail")).toHaveCount(0);
    await expect(page.getByRole("status").filter({ hasText: "Şimdilik doğrulandı" })).toBeVisible();
  });

  await test.step("10. yönetici +72 sa → oylama kapanır, sonuç kabul (köprü testi dahil)", async () => {
    const card = await adminAdvance(admin, 72);
    const p = await api.proposal(proposalId);
    await expect(card.locator("li.list-item").filter({ hasText: `#K-${p.seq}` })).toContainText("Oylamada → İtiraz süresinde");
    expect(p.status).toBe("objection_window");
    expect(p.results).toHaveLength(1);
    expect(p.results[0]).toMatchObject({ outcome: "accept", quorumMet: true, thresholdMet: true });
    // Doğrudan 13 oy + vekâletle sayılanlar (deniz_k, ayse… delegedir; vekâlet sınırı aşanlar "yönlendirilemeyen")
    const t = p.results[0].totals;
    expect(t.no).toBe(0);
    expect(t.yes).toBe(OTHER_VOTERS.length + 1 + t.delegated);
  });

  await test.step("11. 'Sayımı kendim doğrulayayım': sayım tarayıcıda yeniden yapılır ✔", async () => {
    // Bülten kapanışta yayımlanır; TALLY/BALLOT_REVEAL işlemleri bir sonraki blokla deftere girer.
    await api.waitBulletinCommitted(proposalId);
    await gotoApp(page, `/oneriler/${proposalId}`);
    await expect(page.locator(".page-meta")).toContainText("İtiraz süresinde");
    const result = page.getByRole("region", { name: "1. tur sonucu" });
    await expect(result).toBeVisible();
    await expect(result.locator(".card-actions")).toContainText("Kabul");
    const verify = page.getByRole("region", { name: "Sayımı kendim doğrulayayım" });
    await verify.getByRole("button", { name: "Sayımı kendim doğrulayayım" }).click();
    await expect(verify.getByRole("status").filter({ hasText: "1. tur: sayım doğrulandı" })).toBeVisible({ timeout: 30_000 });
    await expect(verify.locator("li.vstep-fail")).toHaveCount(0);
    expect(await verify.locator("li.vstep-ok").count()).toBeGreaterThanOrEqual(5);
    await expect(verify).toContainText("Bu hesap sunucuya güvenmeden tarayıcınızda yapıldı.");
  });

  await test.step("12. 'Oyum kayıtlı mı?' kapanıştan sonra: 6/6 ✔; kurcalanmış makbuz ✘", async () => {
    await gotoApp(page, `/oy-dogrula?oneri=${proposalId}`);
    await verifySteps(page);
    await expect(page.locator("li.vstep-ok")).toHaveCount(6, { timeout: 30_000 });
    await expect(page.getByRole("status").filter({ hasText: "Oyunuz kayıtlı ve sayıma girdi" })).toBeVisible();
    // Demo: makbuzdaki seçimi değiştir → taahhüt tutmaz → kurcalama yakalanır
    await page.getByLabel("Bir makbuzu kurcala (demo)").check();
    await expect(page.getByRole("alert").filter({ hasText: "Kurcalama yakalandı" })).toBeVisible({ timeout: 30_000 });
    await expect(page.locator("li.vstep-fail").first()).toBeVisible();
  });

  for (const s of sessions) expect(s.errors, "sayfa/konsol hatası olmamalı").toEqual([]);
});
