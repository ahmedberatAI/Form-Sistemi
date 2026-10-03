// Senaryo 4 — Azınlık koruması:
//  (a) İtiraz (#K-29, itiraz süresinde): ilk turda "Red" diyen uygun seçmen arayüzden itiraz imzalar; imzacı başkalarına
//      anonimdir; küme kuralı (a) sağlanınca itiraz geçerli olur.
//  (b) Uzlaşma (#K-28): ilk turda "Red" diyen üye azınlık raporu yazar; yazar YZ köprü taslağı üretir ve birini benimser
//      (yeni sürüm, yeniden ontoloji denetimi).
//  (c) Saat ileri: geçerli itiraz → uzlaşma turu (köken: itiraz); uzlaşma süresi biten öneri → yeniden oylama.
import { expect, test } from "@playwright/test";
import type { ProposalDetail, ProposalSummary } from "@forum/shared";
import { BLOCKS } from "../support/env";
import { useSeededServer } from "../support/fixtures";
import { confirmDialog, expectToast, gotoApp, openSession, type Session } from "../support/ui";

const ctx = useSeededServer("itiraz-uzlasma");
const FY = "https://forumsistemi.org/ont#";

const OBJECTION_TEXT = "Hafta sonu uzatması için gereken ek personel bütçesi öğle kapanışıyla karşılanıyor; bu yük emeklilere ve vardiyalı çalışanlara biniyor.";
const MINORITY_REPORT =
  "Işıksız geçitlerin kaldırılması tekerlekli sandalye kullanan ve yavaş yürüyen yaşlılar için yürüme mesafesini üç katına çıkarıyor. " +
  "Toplu taşımadaki kazanç, erişilebilirlik kaybını haklı çıkarmıyor; en azından iki geçit sesli sinyalizasyonla korunmalı.";

let k29: ProposalSummary;
let k28: ProposalSummary;
const sessions: Session[] = [];

// Öneriler, herhangi bir durum değişikliğinden önce evrelerine göre bulunur (tohumda #K-29 ve #K-28).
test.beforeAll(async () => {
  k29 = await ctx.api.proposalInStatus("objection_window");
  k28 = await ctx.api.proposalInStatus("reconciliation");
});

test.afterAll(async () => {
  await Promise.all(sessions.splice(0).map((s) => s.close()));
});

test("itiraz: Red oyu veren üye arayüzden imzalar, imzacı anonim kalır, geçerli itiraz uzlaşma turunu başlatır", async ({ browser }) => {
  const { api } = ctx;
  const before = await api.proposal(k29.id);
  expect(before.objectionEvaluation?.valid).toBe(false);

  // İtiraz hakkı olanları bul (oy gizli: hak yalnızca kişinin kendi görünümünde, canObject ile görünür).
  const eligible: string[] = [];
  for (const n of [...BLOCKS.B, ...BLOCKS.C, ...BLOCKS.A]) {
    if ((await api.proposal(k29.id, n)).canObject) eligible.push(n);
    // Tohumun zamana bağlı küçük farkları yüzünden gereken imza sayısı değişebilir (kural a: kümede %75; kural b: iki kümeden 6 imza): 3'te kesmeyiz.
    if (eligible.length >= 8) break;
  }
  expect(eligible.length, "ilk turda Red oyu veren ve henüz imzalamamış en az bir uygun seçmen olmalı").toBeGreaterThan(0);
  const signer = eligible[0];

  const s = await openSession(browser, api, { as: signer });
  sessions.push(s);
  const { page } = s;
  await gotoApp(page, `/oneriler/${k29.id}`);
  await expect(page.locator(".page-meta")).toContainText("İtiraz süresinde");
  const panel = page.getByRole("region", { name: "Azınlık itirazı (alarm zili)" });
  await expect(panel.getByRole("button", { name: "İtirazı imzala" })).toBeDisabled();
  await panel.getByLabel("Gerekçe").selectOption(`${FY}OrantisizAzinlikEtkisi`);
  await panel.getByLabel("Açıklama").fill(OBJECTION_TEXT);
  await panel.getByRole("button", { name: "İtirazı imzala" }).click();
  await expectToast(page, "İtirazınız imzalandı ve deftere kaydedildi.");
  await expect(panel.getByText("(sizin imzanız; başkalarına anonim görünür)")).toBeVisible();
  await expect(panel.getByRole("button", { name: "İtirazı imzala" })).toHaveCount(0); // bir kez
  await expect(panel).toContainText(`Toplam geçerli imza: ${(before.objectionEvaluation?.signers ?? 0) + 1}`);

  // Başka bir görüntüleyen için imzacılar anonim
  const anon = await openSession(browser, api);
  sessions.push(anon);
  await gotoApp(anon.page, `/oneriler/${k29.id}`);
  const anonPanel = anon.page.getByRole("region", { name: "Azınlık itirazı (alarm zili)" });
  await expect(anonPanel.getByText("Anonim imzacı")).toHaveCount(before.objections.length + 1);
  await expect(anonPanel).not.toContainText(`@${signer}`);
  const pub = await api.proposal(k29.id);
  expect(pub.objections.every((o) => !o.userId && o.nickname === "Anonim imzacı")).toBe(true);

  // Küme kuralı (a) için gereken imzalar tamamlanana kadar diğer hak sahipleri de imzalar (API).
  let ev = pub.objectionEvaluation!;
  for (const n of eligible.slice(1)) {
    if (ev.valid) break;
    await api.post(`/api/proposals/${k29.id}/objections`, { ground: pub.objections[0].ground, statement: OBJECTION_TEXT }, n);
    ev = (await api.proposal(k29.id)).objectionEvaluation!;
  }
  expect(ev.valid, ev.explanation).toBe(true);
  // Geçerli itiraz süre dolmadan kararı durdurur: zamanlayıcının bir sonraki turunda uzlaşmaya geçer (köken: itiraz).
  await expect.poll(async () => (await api.proposal(k29.id)).status, { timeout: 15_000 }).toBe("reconciliation");
  expect((await api.proposal(k29.id)).reconciliationOrigin).toBe("objection");
  await gotoApp(page, `/oneriler/${k29.id}`);
  await expect(page.locator(".page-meta")).toContainText("Uzlaşma sürecinde");
  await expect(page.getByRole("region", { name: "Uzlaşma turu" }).getByRole("status").filter({ hasText: "Köken: geçerli azınlık itirazı" })).toBeVisible();
  await expect(panel.getByText("İtiraz geçerli — uzlaşma turu")).toBeVisible();
  await expect(panel.getByText(ev.rule === "cluster" ? "Küme kuralı (a)" : "Çapraz küme kuralı (b)")).toBeVisible();
  test.info().annotations.push({ type: "itiraz", description: `geçerlilik kuralı: ${ev.rule}, imza: ${ev.signers}` });
  console.log(`[itiraz] #K-${k29.seq}: geçerlilik kuralı ${ev.rule}, ${ev.signers} imza`);
  expect(s.errors).toEqual([]);
  expect(anon.errors).toEqual([]);
});

test("uzlaşma: azınlık raporu ve YZ köprü taslağının benimsenmesi (yeni sürüm)", async ({ browser }) => {
  const { api } = ctx;
  const start = await api.proposal(k28.id);
  expect(start.reconciliationOrigin).toBe("contested");

  // Raporu yazabilecek üye: ilk turda etkin oyu "Red" olan ve henüz rapor yazmamış uygun seçmen.
  let reporter: string | null = null;
  for (const n of [...BLOCKS.C, ...BLOCKS.B]) {
    const d = (await api.proposal(k28.id, n)) as ProposalDetail & { canWriteMinorityReport?: boolean };
    const can = d.canWriteMinorityReport ?? (d.myBallot?.choice === "no" && !d.minorityReports.some((r) => r.authorNickname === n));
    if (can) {
      reporter = n;
      break;
    }
  }
  expect(reporter, "azınlık raporu yazabilecek bir üye olmalı").toBeTruthy();

  await test.step("azınlık raporu (arayüz)", async () => {
    const s = await openSession(browser, api, { as: reporter! });
    sessions.push(s);
    await gotoApp(s.page, `/oneriler/${k28.id}`);
    await expect(s.page.locator(".page-meta")).toContainText("Uzlaşma sürecinde");
    const panel = s.page.getByRole("region", { name: "Uzlaşma turu" });
    await expect(panel.getByRole("status").filter({ hasText: "Köken: tartışmalı sonuç" })).toBeVisible();
    await panel.getByRole("button", { name: "Azınlık raporu yaz" }).click();
    await panel.getByLabel("Azınlık raporu").fill(MINORITY_REPORT);
    await panel.getByRole("button", { name: "Raporu ekle" }).click();
    await expectToast(s.page, "Azınlık raporunuz karar kaydına eklendi.");
    const reports = panel.getByRole("region", { name: "Azınlık raporları" });
    await expect(reports).toContainText(MINORITY_REPORT.slice(0, 60));
    await expect(reports).toContainText(`@${reporter}`);
    await expect(reports.getByRole("heading", { name: `Azınlık raporları (${start.minorityReports.length + 1})` })).toBeVisible();
    expect(s.errors).toEqual([]);
  });

  await test.step("yazar YZ köprü taslakları üretir ve birini benimser", async () => {
    const author = start.authorNickname;
    const s = await openSession(browser, api, { as: author });
    sessions.push(s);
    const { page } = s;
    await gotoApp(page, `/oneriler/${k28.id}`);
    const panel = page.getByRole("region", { name: "Uzlaşma turu" });
    const drafts = panel.getByRole("region", { name: "Köprü taslakları" });
    await drafts.getByRole("button", { name: /taslak(lar)?ı? üret/i }).click();
    await expectToast(page, "Köprü taslakları üretildi.");
    await expect(drafts.locator("[data-ai-generated='true']").first()).toContainText("Yapay zekâ ile üretildi");
    const latest = (await api.proposal(k28.id, author)).aiAnalyses.filter((a) => a.task === "bridging_drafts").sort((a, b) => b.createdAt - a.createdAt)[0];
    const draft0 = (latest.output as { drafts: { title: string; body: string }[] }).drafts[0];
    await drafts.getByRole("button", { name: "Bu taslağı benimse" }).first().click();
    await confirmDialog(page, "Taslak 1'i benimse", "Benimse");
    await expectToast(page, "Taslak yeni sürüm olarak uygulandı (yeniden denetlendi).");
    await expect(page.locator(".page-subtitle")).toContainText(`sürüm ${start.version + 1}`);
    const after = await api.proposal(k28.id);
    expect(after.version).toBe(start.version + 1);
    expect(after.body).toBe(draft0.body);
    expect(after.status).toBe("reconciliation");
    expect(s.errors).toEqual([]);
  });
});

test("saat ileri: uzlaşma süresi biten öneri benimsenen metinle yeniden oylamaya girer", async ({ browser }) => {
  const { api } = ctx;
  const adopted = await api.proposal(k28.id);
  const p28 = await api.advancePastPhase(k28.id);
  expect(p28.status).toBe("revote");
  expect(p28.votingRound).toBe(2);
  expect(p28.body).toBe(adopted.body);
  // #K-29'un uzlaşma turu (72 sa) henüz sürüyor
  expect((await api.proposal(k29.id)).status).toBe("reconciliation");

  const s = await openSession(browser, api, { as: "ayse" });
  sessions.push(s);
  await gotoApp(s.page, `/oneriler/${k28.id}`);
  await expect(s.page.locator(".page-meta")).toContainText("Yeniden oylamada");
  const vote = s.page.getByRole("region", { name: "Yeniden oylama", exact: true });
  await expect(vote).toBeVisible();
  await expect(vote).toContainText("Sonuç kesindir.");
  expect(s.errors).toEqual([]);
});
