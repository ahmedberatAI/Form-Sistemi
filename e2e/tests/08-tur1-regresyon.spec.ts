// Senaryo 8 — Test döngüsü tur 1 regresyonları (gerçek sunucu süreci + tarayıcı):
//   a) Çerçeveleme koruması: index.html ve API yanıtlarında X-Frame-Options / CSP frame-ancestors; başka kökendeki bir sayfa
//      uygulamayı iframe içinde açamaz (görünmez çerçeveyle oy/destek tıklatma yok).
//   b) Bilirkişi hesabını silince kayıt kapanır: herkese açık listede, Bilirkişiler sayfasında ve profilde görünmez; silinmiş
//      hesaba takip/kefalet 409.
//   c) Graf: hiçbir ilişki türü seçilmeyince istek `types=` ile gider ve kenar gelmez (eskiden varsayılan türler geliyordu).
//   d) "Oyum kayıtlı mı?": son taahhüt denetimi pusula süzgeciyle (ballotId + round) yapılır; eski makbuz kesin olarak
//      "daha yeni oyunuz var" alır, güncel makbuz doğru taahhüt sayısını görür.
//   e) Ayarlar › sunucu adresi değişince eski sunucunun belirteci yeni adrese hiç gitmez; eski sunucudaki oturum kapanır.
//   f) Kayıt formu: yalnız noktalamadan oluşan ad, takma ad ve adres alanı satır içinde reddedilir (sunucuyla aynı kural).
//   g) Şifre teyidi kilidi: oturumla 5 yanlış şifreden sonra 429 login_locked; giriş kilidinden bağımsızdır.
import { expect, test, type Route } from "@playwright/test";
import type { BallotReceipt, CommittedTxView, ExpertInfo, PublicProfile, PublicUser, VoterListResponse } from "@forum/shared";
import { HttpError } from "../support/api";
import { passwordOf } from "../support/env";
import { useSeededServer } from "../support/fixtures";
import { expectToast, gotoApp, openSession } from "../support/ui";

const ctx = useSeededServer("tur1-regresyon");

const userId = async (nickname: string): Promise<string> => {
  const found = await ctx.api.get<PublicUser[]>(`/api/users?q=${encodeURIComponent(nickname)}`);
  const u = found.find((x) => x.nickname === nickname);
  if (!u) throw new Error(`${nickname} bulunamadı`);
  return u.id;
};

test("çerçeveleme koruması: başlıklar her yanıtta, başka kökenden iframe içinde uygulama açılmaz", async ({ browser }) => {
  const { server } = ctx;
  for (const path of ["/", "/api/health", "/api/yok"]) {
    const res = await fetch(server.baseURL + path);
    expect(res.headers.get("x-frame-options"), path).toBe("DENY");
    expect(res.headers.get("content-security-policy"), path).toBe("frame-ancestors 'none'");
  }

  const s = await openSession(browser, ctx.api, { as: "ayse" });
  try {
    const { page } = s;
    // Başka bir köken (saldırganın sitesi): uygulamayı tam ekran, saydam bir çerçevede açmaya çalışır.
    await page.route("http://cerceve.test/**", (route: Route) =>
      route.fulfill({
        contentType: "text/html; charset=utf-8",
        body: `<!doctype html><title>çerçeve</title><iframe id="f" src="${server.baseURL}/#/oneriler" style="width:800px;height:600px"></iframe>`,
      }),
    );
    await page.goto("http://cerceve.test/");
    await page.waitForLoadState("load");
    const frame = page.frames().find((f) => f !== page.mainFrame());
    expect(frame, "iframe oluşturuldu").toBeTruthy();
    // Tarayıcı çerçeveyi engeller: çerçevedeki belge uygulamanın index.html'i değildir (#root yok; Chromium hata sayfası gösterir),
    // yani oturumlu sayfa ve düğmeler çerçevede hiç oluşmaz. Aynı adres doğrudan açılınca #root vardır (karşılaştırma).
    const framed = async () => frame!.evaluate(() => ({ href: location.href, root: document.querySelector("#root") !== null })).catch(() => ({ href: "", root: false }));
    await expect.poll(async () => (await framed()).href, { timeout: 10_000 }).not.toBe("about:blank");
    expect(await framed()).toMatchObject({ root: false });
    const direct = await s.context.newPage();
    await direct.goto(`${server.baseURL}/#/oneriler`);
    await expect(direct.locator("#root")).toHaveCount(1);
    await direct.close();
  } finally {
    await s.close();
  }
});

test("bilirkişi hesabını silince kayıt kapanır: liste, Bilirkişiler sayfası ve profil; silinmiş hesaba ilişki 409", async ({ browser }) => {
  const { api } = ctx;
  const nickname = "bk_enerji2";
  const id = await userId(nickname);
  expect((await api.get<ExpertInfo[]>("/api/experts")).map((e) => e.userId)).toContain(id);

  expect(await api.post("/api/me/erase", { confirm: "SİL", password: passwordOf(nickname) }, nickname)).toEqual({ ok: true });

  expect((await api.get<ExpertInfo[]>("/api/experts")).map((e) => e.userId)).not.toContain(id);
  expect((await api.get<ExpertInfo[]>("/api/experts?status=active")).map((e) => e.userId)).not.toContain(id);
  const profile = await api.get<PublicProfile>(`/api/users/${id}`);
  expect(profile.status).toBe("erased");
  expect(profile.isExpert).toBe(false);
  expect(profile.expertDomains ?? []).toEqual([]);
  // Kayıt memuru görünümünde de yeterlilik beyanı kalmaz (kayıt listelenmez).
  expect((await api.get<ExpertInfo[]>("/api/experts", "kayitmemuru")).find((e) => e.userId === id)).toBeUndefined();

  for (const [path, body] of [
    [`/api/users/${id}/follow`, {}],
    [`/api/users/${id}/vouch`, { level: "close" }],
  ] as const) {
    const err = await api.post(path, body, "mehmet").then(
      () => null,
      (e: unknown) => e,
    );
    expect(err, path).toBeInstanceOf(HttpError);
    expect((err as HttpError).status).toBe(409);
    expect((err as HttpError).code).toBe("invalid_state");
  }

  const s = await openSession(browser, api);
  try {
    await gotoApp(s.page, "/bilirkisiler");
    await expect(s.page.getByRole("heading", { level: 1 })).toBeVisible();
    await expect(s.page.getByText(profile.nickname, { exact: false })).toHaveCount(0);
  } finally {
    await s.close();
  }
});

test("graf: hiçbir ilişki türü seçilmeyince istek types= ile gider ve kenar gelmez", async ({ browser }) => {
  const s = await openSession(browser, ctx.api);
  try {
    const { page } = s;
    await gotoApp(page, "/graf");
    const filters = page.getByRole("group", { name: "Gösterilecek ilişkiler" });
    await expect(filters).toBeVisible();
    const boxes = filters.getByRole("checkbox");
    const n = await boxes.count();
    expect(n).toBeGreaterThan(0);
    const checked: number[] = [];
    for (let i = 0; i < n; i++) if (await boxes.nth(i).isChecked()) checked.push(i);
    expect(checked.length).toBeGreaterThan(0);
    // Sonuncusu dışındakileri kaldır (her biri yeni bir istek); sonuncusu kalkınca liste boşalır.
    for (const i of checked.slice(0, -1)) {
      const next = page.waitForResponse((r) => r.url().includes("/api/graph?") && r.request().method() === "GET");
      await boxes.nth(i).uncheck();
      await next;
    }
    const final = page.waitForResponse((r) => /\/api\/graph\?types=(&|$)/.test(r.url()));
    await boxes.nth(checked[checked.length - 1]).uncheck();
    const res = await final;
    const body = (await res.json()) as { nodes: unknown[]; edges: unknown[] };
    expect(new URL(res.url()).searchParams.get("types")).toBe("");
    expect(body.edges).toEqual([]);
    expect(body.nodes.length).toBeGreaterThan(0);
  } finally {
    await s.close();
  }
});

test("'Oyum kayıtlı mı?': pusula süzgeciyle eski makbuz kesin olarak 'daha yeni oyunuz var', güncel makbuz doğru taahhüt sayısı", async ({ browser }) => {
  test.setTimeout(180_000);
  const { api, server } = ctx;
  const proposal = await api.proposalInStatus("voting");
  const voters = (await api.get<VoterListResponse>(`/api/proposals/${proposal.id}/voters`)).voters.map((v) => v.nickname);
  const voter = voters.find((n) => !n.startsWith("bk_") && !["yonetici", "kayitmemuru", "denetci", "ayse", "mehmet"].includes(n)) ?? voters[0];
  const a = await api.vote(proposal.id, voter, "yes");
  const b = await api.vote(proposal.id, voter, "no");
  expect(b.ballotId).toBe(a.ballotId);

  const inBlock = async (hash: string | null) => !!hash && (await fetch(`${server.baseURL}/api/ledger/txs/${hash}`)).status === 200;
  await expect.poll(async () => (await inBlock(a.txHash)) && (await inBlock(b.txHash)), { timeout: 30_000 }).toBe(true);

  // Sunucu süzgeci: yalnız bu pusulanın bu turdaki taahhütleri (en yeni önce).
  const q = new URLSearchParams({ type: "VOTE_COMMIT", proposalId: proposal.id, ballotId: a.ballotId, round: String(a.round), limit: "500" });
  const mine = await api.get<CommittedTxView[]>(`/api/ledger/txs?${q}`);
  expect(mine.length).toBeGreaterThanOrEqual(2);
  expect(mine.every((t) => (t.payload as { ballotId: string }).ballotId === a.ballotId)).toBe(true);
  expect(mine[0].hash).toBe(b.txHash);
  expect(mine.map((t) => t.hash)).toContain(a.txHash);

  const s = await openSession(browser, api);
  try {
    const { page } = s;
    await gotoApp(page, "/oy-dogrula");
    const paste = async (r: BallotReceipt) => {
      await page.getByText("Makbuzu elle yapıştır (JSON)").click();
      await page.getByLabel("Makbuz JSON'u").fill(JSON.stringify(r));
      await page.getByRole("button", { name: "Bu makbuzu doğrula" }).click();
    };
    const latest = page.locator(".vstep").filter({ hasText: "Bu oy pusulası için defterdeki SON taahhüt bu makbuz" });

    await paste(a);
    await expect(latest).toContainText("daha yeni oyunuz var", { timeout: 60_000 });
    await expect(latest).toHaveClass(/vstep-fail/);

    await page.getByLabel("Makbuz JSON'u").fill(JSON.stringify(b));
    await page.getByRole("button", { name: "Bu makbuzu doğrula" }).click();
    await expect(latest).toHaveClass(/vstep-ok/, { timeout: 60_000 });
    await expect(latest).toContainText(`Bu pusula için ${mine.length} taahhüt var`);
  } finally {
    await s.close();
  }
});

test("Ayarlar › sunucu adresi değişince eski belirteç yeni adrese gitmez; eski sunucudaki oturum kapanır", async ({ browser }) => {
  const { api, server } = ctx;
  const who = "onur_h";
  const token = await api.token(who);
  const s = await openSession(browser, api, { token });
  const fake = "http://127.0.0.1:4199";
  const seen: { method: string; path: string; authorization: string | null }[] = [];
  try {
    const { page } = s;
    await s.context.route(`${fake}/**`, async (route: Route) => {
      const req = route.request();
      const url = new URL(req.url());
      seen.push({ method: req.method(), path: url.pathname, authorization: (await req.allHeaders()).authorization ?? null });
      const cors = { "access-control-allow-origin": "*", "access-control-allow-headers": "authorization, content-type, accept, idempotency-key", "access-control-allow-methods": "GET, POST, PUT, PATCH, DELETE" };
      if (req.method() === "OPTIONS") return route.fulfill({ status: 204, headers: cors });
      // Sahte sunucu gerçek sunucunun herkese açık yanıtlarını taklit eder (belirteç İLETİLMEZ).
      const real = await fetch(server.baseURL + url.pathname + url.search, { method: req.method() === "GET" ? "GET" : req.method(), headers: { accept: "application/json" } });
      return route.fulfill({ status: real.status, headers: { ...cors, "content-type": real.headers.get("content-type") ?? "application/json" }, body: Buffer.from(await real.arrayBuffer()) });
    });
    await gotoApp(page, "/ayarlar");
    await page.getByLabel("Sunucu adresi").fill(fake);
    await page.getByRole("button", { name: "Kaydet" }).click();
    await expectToast(page, "Sunucu adresi değişti; güvenliğiniz için oturumunuz kapatıldı");
    await expect.poll(() => seen.length, { timeout: 10_000 }).toBeGreaterThan(0);
    expect(seen.filter((r) => r.authorization), JSON.stringify(seen)).toEqual([]);
    // Eski sunucuda oturum kapatıldı (belirteç iptal).
    const me = await fetch(`${server.baseURL}/api/me`, { headers: { authorization: `Bearer ${token}` } });
    expect(me.status).toBe(401);
  } finally {
    await s.close();
  }
});

test("kayıt formu: yalnız noktalamadan oluşan ad, takma ad ve adres alanı satır içinde reddedilir", async ({ browser }) => {
  const s = await openSession(browser, ctx.api);
  try {
    const { page } = s;
    await gotoApp(page, "/kayit");
    const f = (suffix: string) => page.locator(`[id$="-${suffix}"]`).first();
    await f("nickname").fill("...");
    await f("firstName").fill("-");
    await f("lastName").fill("'");
    await f("il").fill("..");
    await f("acikAdres").fill(".....");
    let registerCalls = 0;
    page.on("request", (r) => {
      if (r.url().includes("/api/auth/register")) registerCalls++;
    });
    await page.getByRole("button", { name: "Kaydol" }).click();
    for (const msg of [
      "Takma ad en az bir harf ya da rakam içermelidir.",
      "Ad en az bir harf içermelidir.",
      "Soyad en az bir harf içermelidir.",
      "İl en az bir harf ya da rakam içermelidir.",
      "Açık adres en az bir harf ya da rakam içermelidir.",
    ]) {
      await expect(page.getByText(msg, { exact: true }).first(), msg).toBeVisible();
    }
    expect(registerCalls, "geçersiz form sunucuya gönderilmez").toBe(0);
  } finally {
    await s.close();
  }
});

test("şifre teyidi kilidi: oturumla 5 yanlış şifreden sonra 429 login_locked; giriş ayrı sayılır", async () => {
  const { api, server } = ctx;
  const who = "ceren_m";
  const token = await api.token(who);
  const change = (oldPassword: string) =>
    fetch(`${server.baseURL}/api/me/password`, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
      body: JSON.stringify({ oldPassword, newPassword: "YeniSifre2026x" }),
    });
  for (let i = 0; i < 5; i++) {
    const r = await change(`Yanlis-${i}-abc1`);
    expect(r.status).toBe(400);
    expect(((await r.json()) as { error: { code: string } }).error.code).toBe("wrong_password");
  }
  const locked = await change("Yanlis-6-abc1");
  expect(locked.status).toBe(429);
  const body = (await locked.json()) as { error: { code: string; message: string; details: { retryAfterSeconds: number } } };
  expect(body.error.code).toBe("login_locked");
  expect(body.error.message).toMatch(/Şifre teyidinde çok fazla başarısız deneme/);
  expect(Number(locked.headers.get("retry-after"))).toBe(body.error.details.retryAfterSeconds);
  // Kilitliyken doğru şifre de denetlenmez.
  expect((await change(passwordOf(who))).status).toBe(429);
  // Giriş kilidi ayrıdır: aynı hesap doğru şifreyle giriş yapabilir.
  const login = await fetch(`${server.baseURL}/api/auth/login`, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ login: who, password: passwordOf(who) }) });
  expect(login.status).toBe(200);
});
