// Senaryo 3 — Silme (karartma) talebi arayüzden: mesaj → "Silme talebi aç" → "Görüş ayrılığı" seçilemez, acil gerekçe
// ("Tehdit") mesajı talep anında daraltır → destek (K_s = 1) → DEL oylaması (2/3 + köprü + yazarın kümesi) → mezar taşı;
// yazar karartılamayan tek bir cevap ekler; denetçi gizli metni okur ve okuma denetim günlüğüne yazılır.
import { expect, test } from "@playwright/test";
import type { AuditLogEntry, MessageView, ProposalDetail, TopicSummary } from "@forum/shared";
import { HttpError } from "../support/api";
import { BLOCKS } from "../support/env";
import { useSeededServer } from "../support/fixtures";
import { confirmDialog, expectToast, gotoApp, openSession, reloadApp, type Session } from "../support/ui";

const ctx = useSeededServer("silme");

/** Testin açtığı tarayıcı bağlamları (başarısızlıkta da kapatılır). */
const sessions: Session[] = [];
test.afterEach(async () => {
  await Promise.all(sessions.splice(0).map((s) => s.close()));
});

const AUTHOR = "sert_kaan"; // B bloğu
const REQUESTER = "ayse"; // A bloğu
const SPONSOR = "mehmet";
const BODY = "Bu otopark kararını savunanlar akşamları sokakta tek başına yürürken iki kez düşünsün, sonra başlarına gelenden şikâyet etmesinler.";
const STATEMENT = "Mesaj, karara destek veren üyelere açıkça zarar görecekleri imasıyla gözdağı veriyor; görüş bildirmek değil tehdit niteliğinde.";
const REBUTTAL = "Sözlerim mecazdı, kimseyi tehdit etmek istemedim; üslubum için özür dilerim ama otopark konusundaki itirazımı koruyorum.";

/** DEL oyu verenler: yazar hariç her bloktan en az μ_votes = 2 kişi, tamamı "kabul" (≥ 2/3 ve yazarın kümesinde P ≥ 1/2). */
const VOTERS = [...BLOCKS.A.slice(1, 11), "mehmet", "serkan_u", "gokhan_r", "zeynep", "nur_a", "ismail_g"];

test("silme talebi → daraltma → DEL oylaması → mezar taşı, yazarın tek cevabı ve denetçinin kayıtlı okuması", async ({ browser }) => {
  test.setTimeout(300_000);
  const { api } = ctx;
  const open = async (as?: string) => {
    const s = await openSession(browser, api, { as });
    sessions.push(s);
    return s;
  };

  // Hazırlık: yazar (B bloğu) yürürlükteki bir konunun tartışmasına mesaj yazar.
  const topics = await api.get<TopicSummary[]>("/api/topics");
  const topic = topics.find((t) => t.status === "active")!;
  const msg = await api.post<MessageView>(`/api/threads/topic/${topic.id}`, { body: BODY, stance: "con" }, AUTHOR);
  const topicPath = `/konular/${topic.id}?mesaj=${msg.id}`;
  let proposalId = "";

  const { page } = await open(REQUESTER);

  await test.step("1. mesajın menüsünden 'Silme talebi aç' → talep formu (hedef mesaj önceden dolu)", async () => {
    await gotoApp(page, topicPath);
    const article = page.locator(`#mesaj-${msg.id}`);
    await expect(article).toContainText(BODY);
    await article.getByRole("button", { name: `Mesaj #${msg.seq} için diğer işlemler` }).click();
    await article.getByRole("button", { name: "Silme talebi aç" }).click();
    await confirmDialog(page, "Silme (karartma) talebi aç", "Talep formuna git");
    await expect(page).toHaveURL(/#\/oneriler\/yeni\?.*tur=deletion/);
    await expect(page.locator(".del-msg")).toContainText(BODY.slice(0, 40));
  });

  await test.step("2. 'Görüş ayrılığı' seçilemez; acil gerekçe (Tehdit) daraltma uyarısı gösterir; talep gönderilir", async () => {
    const opinion = page.getByRole("radio", { name: /Görüş ayrılığı/ });
    await expect(opinion).toBeDisabled();
    await expect(page.getByText("Değiştirilemez madde: görüş ayrılığı silme gerekçesi olamaz.")).toBeVisible();
    const threat = page.getByRole("radio", { name: /^Tehdit/ });
    await threat.check();
    await expect(page.getByRole("alert").filter({ hasText: "Acil gerekçe: mesaj talep anında daraltılır" })).toBeVisible();
    await page.getByLabel("Talebin açıklaması").fill(STATEMENT);
    const summary = page.locator(".pre-summary");
    await expect(summary).toContainText("DEL", { timeout: 30_000 });
    await expect(summary).toContainText("Yönetmeliğe uygun");
    await page.getByRole("button", { name: "Kaydet ve destekçi toplamaya gönder" }).click();
    await expectToast(page, "Öneri kaydedildi ve destekçi toplamaya gönderildi.");
    await expect(page).toHaveURL(/#\/oneriler\/[0-9a-f-]{36}$/);
    proposalId = page.url().split("/").pop()!;
    await expect(page.locator(".page-meta")).toContainText("Destekçi toplanıyor");
    const p = await api.proposal(proposalId);
    expect(p).toMatchObject({ kind: "deletion", tier: "DEL", sponsorsRequired: 1 });
    expect(p.deletion?.ground).toMatch(/#Tehdit$/);
  });

  await test.step("3. mesaj silinmez, 'Gözden geçiriliyor' olarak katlanır (acil daraltma)", async () => {
    await gotoApp(page, topicPath);
    const article = page.locator(`#mesaj-${msg.id}`);
    const bar = article.locator(".msg-collapsed-bar");
    await expect(bar).toContainText("Gözden geçiriliyor");
    await expect(article.locator(".msg-body")).toHaveCount(0);
    await bar.getByRole("button", { name: "Mesajı göster" }).click();
    await expect(article.locator(".msg-body")).toContainText(BODY);
    expect((await api.get<MessageView>(`/api/messages/${msg.id}`)).visibility).toBe("collapsed");
  });

  await test.step("4. destek (K_s = 1) → tartışma → oylama → DEL oyu → kabul", async () => {
    const sponsor = await open(SPONSOR);
    await gotoApp(sponsor.page, `/oneriler/${proposalId}`);
    await sponsor.page.getByRole("button", { name: "Destekle" }).click();
    await expectToast(sponsor.page, "Desteğiniz kaydedildi");
    await expect.poll(async () => (await api.proposal(proposalId)).status).toBe("deliberation");
    expect((await api.advancePastPhase(proposalId)).status).toBe("voting");
    // Mesaj yazarı DEL oylamasında seçmen değildir
    const authorView = await api.proposal(proposalId, AUTHOR);
    expect(authorView.canVote).toBe(false);
    for (const n of VOTERS) await api.vote(proposalId, n, "yes");
    const closed: ProposalDetail = await api.advancePastPhase(proposalId);
    expect(closed.results[0]).toMatchObject({ outcome: "accept", quorumMet: true, thresholdMet: true });
    expect(closed.status).toBe("enacted");
    await reloadApp(sponsor.page);
    await expect(sponsor.page.locator(".page-meta")).toContainText("Kabul edildi");
  });

  await test.step("5. mezar taşı: asıl metin herkese kapalı", async () => {
    await gotoApp(page, topicPath);
    const article = page.locator(`#mesaj-${msg.id}`);
    await expect(article.locator(".msg-tombstone-text")).toContainText("gizlendi");
    await expect(article).not.toContainText(BODY);
    await expect(article.getByRole("link", { name: "Kararı görüntüle" })).toBeVisible();
    const anon = await open();
    await gotoApp(anon.page, topicPath);
    await expect(anon.page.locator(`#mesaj-${msg.id}`).locator(".msg-tombstone")).toBeVisible();
    await expect(anon.page.locator("main")).not.toContainText(BODY);
    const pub = await api.get<MessageView>(`/api/messages/${msg.id}`);
    expect(pub.visibility).toBe("hidden");
    expect(pub.body ?? null).toBeNull();
  });

  await test.step("6. yazar karartılamayan tek bir cevap ekler; ikinci cevap reddedilir", async () => {
    const author = await open(AUTHOR);
    await gotoApp(author.page, topicPath);
    const article = author.page.locator(`#mesaj-${msg.id}`);
    await article.getByRole("button", { name: "Cevap ekle (bir kez)" }).click();
    await article.getByLabel("Cevabınız (yalnızca bir kez eklenebilir)").fill(REBUTTAL);
    await article.getByRole("button", { name: "Cevabı ekle" }).click();
    await expectToast(author.page, "Cevabınız eklendi. Bu cevap karartılamaz.");
    await expect(article.locator(".msg-rebuttal")).toContainText(REBUTTAL);
    await expect(article.getByRole("button", { name: "Cevap ekle (bir kez)" })).toHaveCount(0);
    const second = await api.post(`/api/messages/${msg.id}/rebuttal`, { body: "İkinci bir cevap eklemeyi deniyorum, reddedilmeli." }, AUTHOR).catch((e: unknown) => e);
    expect(second).toBeInstanceOf(HttpError);
    expect((second as HttpError).status).toBeGreaterThanOrEqual(400);
  });

  await test.step("7. denetçi gizli metni okur (onaylı) ve erişim denetim günlüğüne yazılır", async () => {
    const auditor = await open("denetci");
    await gotoApp(auditor.page, topicPath);
    const article = auditor.page.locator(`#mesaj-${msg.id}`);
    await article.getByRole("button", { name: "Gizli metni oku (erişim kaydedilir)" }).click();
    await confirmDialog(auditor.page, /(Gizli|Gizlenmiş) metni oku/, "Oku (erişim kaydedilsin)");
    await expect(article.getByRole("alert").filter({ hasText: "Gizli metin (erişiminiz kaydedildi)" })).toContainText(BODY);

    await gotoApp(auditor.page, "/yonetim");
    await auditor.page.getByLabel("Eylem").selectOption("message.read_hidden");
    const rows = auditor.page.getByRole("region", { name: "Denetim kayıtları (en yeni önce)" }).locator("tbody tr");
    await expect(rows.filter({ hasText: "@denetci" }).filter({ hasText: msg.id.slice(0, 20) }).first()).toBeVisible();
    const log = await api.get<AuditLogEntry[]>("/api/admin/audit-log?action=message.read_hidden&limit=50", "denetci");
    expect(log.some((e) => e.actorNickname === "denetci" && e.target === msg.id)).toBe(true);
  });

  for (const s of sessions) expect(s.errors, "sayfa/konsol hatası olmamalı").toEqual([]);
});
