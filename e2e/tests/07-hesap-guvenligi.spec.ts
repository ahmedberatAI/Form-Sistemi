// Senaryo 7 — Hesap ve istek güvenliği (gerçek sunucu süreci, API düzeyinde + giriş sayfası):
//   a) Hesap başına giriş kilidi: aynı tanımlayıcıya karşı art arda başarısız denemeler 429 login_locked + Retry-After ile kilitlenir;
//      kilitliyken DOĞRU şifre de reddedilir; var olmayan ad için aynı davranış (hesabın varlığı sızmaz); başarılı giriş sayacı sıfırlar;
//      başka hesaplar etkilenmez; kilit denetim günlüğüne yazılır ve tanımlayıcıyı içermez; giriş sayfası kilidi okunur gösterir.
//   b) Hesap silme (POST /api/me/erase): vekâletler tek işlemde düşer, veren üyeye yalnız bir bildirim gider, hesap kapanır.
//   c) Idempotency-Key: bağlantı kopması sonrası aynı anahtarla yeniden gönderilen mesaj ikinci kez yayımlanmaz.
// Mevcut senaryoların oturum açma akışları (Api.token) doğru şifreyle olduğu için kilide takılmaz.
import { expect, test } from "@playwright/test";
import type { AuditLogEntry, DelegationView, MessageView, MyDelegations, NotificationList, PublicUser, TopicSummary } from "@forum/shared";
import { passwordOf } from "../support/env";
import { useSeededServer } from "../support/fixtures";
import { gotoApp, openSession } from "../support/ui";

const ctx = useSeededServer("hesap-guvenligi");

interface LoginResult {
  status: number;
  retryAfter: string | null;
  body: { error?: { code?: string; message?: string; details?: { retryAfterSeconds?: number } }; token?: string };
}

/** Ham giriş isteği (Api.request 429'u bekleyip yeniden dener; kilit testinde istenen şey tam olarak 429'un kendisidir). */
async function rawLogin(login: string, password: string): Promise<LoginResult> {
  const res = await fetch(`${ctx.server.baseURL}/api/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ login, password }),
  });
  return { status: res.status, retryAfter: res.headers.get("retry-after"), body: await res.json() };
}

const WRONG = "Yanlis-Sifre-123";

/** Eşik: 5 başarısız denemeden sonra kilit (5. deneme hâlâ denetlenir, 6. reddedilir). */
async function fail(login: string, times: number): Promise<LoginResult[]> {
  const out: LoginResult[] = [];
  for (let i = 0; i < times; i++) out.push(await rawLogin(login, WRONG));
  return out;
}

test.describe("hesap başına giriş kilidi", () => {
  test("5 başarısız denemeden sonra 429 login_locked; doğru şifre de kilitliyken reddedilir; başka hesaplar etkilenmez", async () => {
    const { api } = ctx;
    const target = "levent_c";

    const first = await fail(target, 5);
    expect(first.map((r) => r.status)).toEqual([401, 401, 401, 401, 401]);
    expect(first.every((r) => r.body.error?.code === "invalid_credentials")).toBe(true);

    const locked = await rawLogin(target, WRONG);
    expect(locked.status).toBe(429);
    expect(locked.body.error?.code).toBe("login_locked");
    expect(locked.body.error?.message).toMatch(/dakika sonra tekrar deneyin/);
    const sec = Number(locked.retryAfter);
    expect(sec).toBeGreaterThan(14 * 60);
    expect(sec).toBeLessThanOrEqual(15 * 60);
    expect(locked.body.error?.details?.retryAfterSeconds).toBe(sec);

    // Doğru şifre de kilitliyken denenmez.
    const correct = await rawLogin(target, passwordOf(target));
    expect(correct.status).toBe(429);
    expect(correct.body.token).toBeUndefined();

    // Başka hesap etkilenmez (kilit tanımlayıcı başınadır).
    expect(await api.token("deniz_k")).toBeTruthy();
  });

  test("var olmayan ad için de aynı davranış: hesabın var olup olmadığı yanıttan anlaşılmaz", async () => {
    const ghost = "olmayan_kisi_xq";
    const first = await fail(ghost, 5);
    expect(first.map((r) => r.status)).toEqual([401, 401, 401, 401, 401]);
    expect(first.every((r) => r.body.error?.code === "invalid_credentials")).toBe(true);
    const locked = await rawLogin(ghost, WRONG);
    expect(locked.status).toBe(429);
    expect(locked.body.error?.code).toBe("login_locked");

    // Var olan hesabın kilidiyle aynı biçim ve aynı ileti (süre farkı saniye mertebesindedir).
    const real = await rawLogin("levent_c", WRONG);
    expect(real.status).toBe(429);
    expect(real.body.error?.message).toBe(locked.body.error?.message);
    expect(Math.abs(Number(real.retryAfter) - Number(locked.retryAfter))).toBeLessThanOrEqual(5);
  });

  test("başarılı giriş sayacı sıfırlar", async () => {
    const who = "deniz_k";
    expect((await fail(who, 3)).map((r) => r.status)).toEqual([401, 401, 401]);
    const ok = await rawLogin(who, passwordOf(who));
    expect(ok.status).toBe(200);
    // Sayaç sıfırlanmadıysa bu dört deneme 3 + 1 ile eşiği aşar ve sonuncusu 429 olurdu.
    expect((await fail(who, 4)).map((r) => r.status)).toEqual([401, 401, 401, 401]);
    expect((await rawLogin(who, passwordOf(who))).status).toBe(200);
  });

  test("kilit denetim günlüğüne yazılır ve tanımlayıcıyı içermez", async () => {
    const log = await ctx.api.get<AuditLogEntry[]>("/api/admin/audit-log?action=identity.login_locked&limit=50", "denetci");
    // Kilit başına bir kayıt: levent_c (var) ve olmayan ad.
    expect(log.length).toBeGreaterThanOrEqual(2);
    const raw = JSON.stringify(log);
    expect(raw).not.toContain("levent_c");
    expect(raw).not.toContain("olmayan_kisi_xq");
    expect(log.every((e) => e.meta && (e.meta as { via?: string }).via === "nickname")).toBe(true);
    // Var olmayan ad için hedef boştur.
    expect(log.some((e) => e.target === null)).toBe(true);
  });

  test("giriş sayfası kilidi okunur bir iletiyle gösterir (doğru şifre girilse de)", async ({ browser }) => {
    const { api } = ctx;
    const session = await openSession(browser, api);
    try {
      const { page } = session;
      await gotoApp(page, "/giris");
      await page.getByLabel("Takma ad ya da e-posta").fill("levent_c");
      await page.getByLabel("Şifre").fill(passwordOf("levent_c"));
      await page.getByRole("button", { name: "Giriş yap" }).click();
      const alert = page.getByRole("alert").filter({ hasText: "Giriş geçici olarak durduruldu" });
      await expect(alert).toBeVisible();
      await expect(alert).toContainText(/dakika sonra tekrar deneyin/);
      await expect(page).toHaveURL(/#\/giris/);
    } finally {
      await session.close();
    }
  });
});

test.describe("hesap silme", () => {
  test("vekâletler tek işlemde düşer; veren üyeye tek bildirim gider; silinen hesapla giriş yapılamaz", async () => {
    const { api } = ctx;
    const giver = "figen_s";
    const target = "tarik_o";
    const found = await api.get<PublicUser[]>(`/api/users?q=${target}`);
    const targetId = found.find((u) => u.nickname === target)!.id;
    const revokedNotices = async () => (await api.get<NotificationList>("/api/me/notifications", giver)).items.filter((n) => n.kind === "delegation_revoked").length;

    // Aynı üyeye iki ayrı vekâlet: bildirim yine de tek olmalı.
    await api.post<DelegationView>("/api/me/delegations", { to: targetId, scope: "*", rank: 1 }, giver);
    await api.post<DelegationView>("/api/me/delegations", { to: targetId, scope: "*", rank: 2 }, giver);
    expect((await api.get<MyDelegations>("/api/me/delegations", giver)).outgoing.filter((d) => d.to === targetId)).toHaveLength(2);
    const noticesBefore = await revokedNotices();

    // Yanlış şifre ve onay metni eksik: hiçbir yan etki yok (vekâletler yerinde).
    await expect(api.post("/api/me/erase", { confirm: "SİL", password: "Yanlis-Sifre-123" }, target)).rejects.toMatchObject({ status: 400 });
    expect((await api.get<MyDelegations>("/api/me/delegations", giver)).outgoing.filter((d) => d.to === targetId)).toHaveLength(2);
    expect(await revokedNotices()).toBe(noticesBefore);

    expect(await api.post("/api/me/erase", { confirm: "SİL", password: passwordOf(target) }, target)).toEqual({ ok: true });

    expect((await api.get<MyDelegations>("/api/me/delegations", giver)).outgoing.filter((d) => d.to === targetId)).toHaveLength(0);
    expect(await revokedNotices()).toBe(noticesBefore + 1);
    // Silinen hesap artık giriş yapamaz.
    expect((await rawLogin(target, passwordOf(target))).status).toBe(401);
  });
});

test.describe("Idempotency-Key", () => {
  test("aynı anahtarla yeniden gönderilen mesaj ikinci kez yayımlanmaz (bağlantı kopması sonrası 'tekrar dene')", async () => {
    const { api, server } = ctx;
    const author = "sert_kaan";
    const topics = await api.get<TopicSummary[]>("/api/topics");
    const topic = topics.find((t) => t.status === "active")!;
    const url = `${server.baseURL}/api/threads/topic/${topic.id}`;
    const token = await api.token(author);
    const body = JSON.stringify({ body: "Bu mesaj ağ koptuktan sonra aynı anahtarla yeniden gönderildi; yine de tek kez yayımlanmalı.", stance: "pro" });
    const key = "e2e00000-0000-4000-8000-0000000000a1";
    const send = (k: string | null, b = body) =>
      fetch(url, { method: "POST", headers: { "content-type": "application/json", authorization: `Bearer ${token}`, ...(k ? { "idempotency-key": k } : {}) }, body: b });

    const first = await send(key);
    expect(first.status).toBe(200);
    expect(first.headers.get("idempotent-replayed")).toBeNull();
    const created = (await first.json()) as MessageView;

    const again = await send(key);
    expect(again.status).toBe(200);
    expect(again.headers.get("idempotent-replayed")).toBe("true");
    expect(((await again.json()) as MessageView).id).toBe(created.id);

    // Aynı anahtar farklı gövdeyle: 422.
    const changed = await send(key, JSON.stringify({ body: "Başka bir metin; aynı anahtar.", stance: "pro" }));
    expect(changed.status).toBe(422);
    expect(((await changed.json()) as { error: { code: string } }).error.code).toBe("idempotency_key_reused");

    const thread = await api.get<{ messages: MessageView[] }>(`/api/threads/topic/${topic.id}`);
    expect(thread.messages.filter((m) => m.body === created.body)).toHaveLength(1);
  });
});
